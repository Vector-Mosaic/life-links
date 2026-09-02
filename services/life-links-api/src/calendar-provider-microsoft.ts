import { createHash } from "node:crypto";

import {
  assertStandaloneProviderWrite,
  normalizeProviderAccountEmail,
  CalendarProviderGatewayError,
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  ProviderTransientError,
  type CalendarProviderAdapter,
  type CalendarProviderDiscovery,
  type CalendarProviderCredentialHandle,
  type CalendarProviderSyncBatch,
  type ProviderEventContent,
  type ProviderEventSnapshot
} from "./calendar-provider-gateway.js";
import {
  bearerHeaders,
  resolveCalendarProviderCredential,
  type CalendarProviderCredentialResolver,
  type CalendarProviderCredentialRevoker,
  type CalendarProviderFetch,
  type ResolvedCalendarProviderCredential
} from "./calendar-provider-credentials.js";

export const MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY = "microsoft-graph-calendar";
const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const MAX_DISCOVERY_CALENDARS = 1_000;
const CURSOR_PREFIX = "mgraph1.";

export type MicrosoftCalendarSubscription = {
  id: string;
  resource: string;
  notificationUrl: string;
  creatorId: string;
  expiresAt: string;
};
type SubscriptionCredential = { credentialHandle: CalendarProviderCredentialHandle; providerAccountId: string };

type GraphCalendar = {
  id?: unknown;
  name?: unknown;
  canEdit?: unknown;
  canViewPrivateItems?: unknown;
  isDefaultCalendar?: unknown;
};

type GraphDateTimeTimeZone = {
  dateTime?: unknown;
  timeZone?: unknown;
};

type GraphEvent = {
  id?: unknown;
  "@odata.etag"?: unknown;
  "@removed"?: unknown;
  subject?: unknown;
  body?: unknown;
  bodyPreview?: unknown;
  start?: unknown;
  end?: unknown;
  originalStartTimeZone?: unknown;
  originalEndTimeZone?: unknown;
  isAllDay?: unknown;
  isCancelled?: unknown;
  showAs?: unknown;
  location?: unknown;
  seriesMasterId?: unknown;
  attendees?: unknown;
  isOnlineMeeting?: unknown;
  onlineMeeting?: unknown;
  onlineMeetingUrl?: unknown;
  type?: unknown;
  originalStart?: unknown;
  recurrence?: unknown;
};

type GraphCursor = {
  v: 1;
  mode: "delta" | "reconcile";
  startUtc: string;
  endUtc: string;
  deltaToken?: string;
};

export class MicrosoftGraphCalendarProviderAdapter implements CalendarProviderAdapter {
  readonly providerKey = MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY;
  readonly #resolver: CalendarProviderCredentialResolver;
  readonly #revoker: CalendarProviderCredentialRevoker;
  readonly #fetch: CalendarProviderFetch;
  readonly #apiBase: string;
  readonly #apiOrigin: string;
  readonly #apiPathPrefix: string;
  readonly #onRenewedCredentialUsed?: () => void;

  constructor(options: {
    credentialResolver: CalendarProviderCredentialResolver;
    credentialRevoker: CalendarProviderCredentialRevoker;
    fetch?: CalendarProviderFetch;
    apiBaseUrl?: string;
    onRenewedCredentialUsed?: () => void;
  }) {
    this.#resolver = options.credentialResolver;
    this.#revoker = options.credentialRevoker;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onRenewedCredentialUsed = options.onRenewedCredentialUsed;
    this.#apiBase = (options.apiBaseUrl ?? GRAPH_API_BASE).replace(/\/$/, "");
    const parsedBase = new URL(this.#apiBase);
    this.#apiOrigin = parsedBase.origin;
    this.#apiPathPrefix = `${parsedBase.pathname.replace(/\/$/, "")}/`;
  }

  async discover(input: Parameters<CalendarProviderAdapter["discover"]>[0]): Promise<CalendarProviderDiscovery> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey
    });
    const identityResponse = await this.#request(`${this.#apiBase}/me?$select=id,mail,userPrincipalName`, credential);
    const identity = await jsonObject(identityResponse);
    if (requiredString(identity.id) !== credential.providerAccountId) {
      throw new ProviderTransientError("Microsoft Graph returned an account identity that did not match the credential binding.");
    }
    const signInEmail = normalizeProviderAccountEmail(identity.userPrincipalName);
    const accountEmail = normalizeProviderAccountEmail(identity.mail)
      ?? (signInEmail?.toUpperCase().includes("#EXT#") ? undefined : signInEmail);

    const calendars: CalendarProviderDiscovery["calendars"] = [];
    let url: string | null = `${this.#apiBase}/me/calendars?$top=100`;
    while (url) {
      const response = await this.#request(this.#validatedGraphUrl(url), credential);
      const body = await jsonObject(response);
      for (const raw of array(body.value)) {
        if (!isRecord(raw)) throw malformedGraphResponse();
        const calendar = raw as GraphCalendar;
        const writable = calendar.canEdit === true;
        calendars.push({
          providerCalendarId: requiredString(calendar.id),
          displayName: optionalString(calendar.name) ?? "Untitled calendar",
          isDefault: calendar.isDefaultCalendar === true,
          // Graph Calendar exposes no calendar-level time zone. Do not invent
          // one from an event, mailbox setting, or the UTC response preference.
          capabilities: { read: true, create: writable, update: writable, delete: writable }
        });
        if (calendars.length > MAX_DISCOVERY_CALENDARS) {
          throw new ProviderTransientError("Microsoft Graph discovery exceeded the bounded calendar limit.");
        }
      }
      url = optionalString(body["@odata.nextLink"]);
    }
    return { providerKey: this.providerKey, providerAccountId: credential.providerAccountId,
      ...(accountEmail === undefined ? {} : { accountEmail }), calendars };
  }

  async fetchChanges(input: Parameters<CalendarProviderAdapter["fetchChanges"]>[0]): Promise<CalendarProviderSyncBatch> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    const cursor = input.syncCursor ? decodeGraphCursor(input.syncCursor) : null;
    if (cursor && (cursor.startUtc !== input.window.startUtc || cursor.endUtc !== input.window.endUtc)) {
      throw new ProviderCursorExpiredError();
    }
    // Graph v1.0 documents calendarView delta only for the primary calendar.
    // A non-default calendar therefore uses bounded authoritative reconciliation;
    // its local cursor deliberately expires on the next run so the gateway can
    // compare the next complete snapshot and tombstone missing events.
    if (cursor?.mode === "reconcile") throw new ProviderCursorExpiredError();

    let mode: GraphCursor["mode"];
    let url: string;
    if (cursor?.mode === "delta") {
      mode = "delta";
      url = `${this.#apiBase}/me/calendarView/delta?$deltatoken=${encodeURIComponent(requiredString(cursor.deltaToken))}`;
    } else {
      const metadataResponse = await this.#request(
        `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}?$select=id,isDefaultCalendar`,
        credential
      );
      const metadata = await jsonObject(metadataResponse);
      if (requiredString(metadata.id) !== input.providerCalendarId) throw malformedGraphResponse();
      mode = metadata.isDefaultCalendar === true ? "delta" : "reconcile";
      const path = mode === "delta"
        ? "/me/calendarView/delta"
        : `/me/calendars/${encodeURIComponent(input.providerCalendarId)}/calendarView`;
      const initial = new URL(`${this.#apiBase}${path}`);
      initial.searchParams.set("startDateTime", input.window.startUtc);
      initial.searchParams.set("endDateTime", input.window.endUtc);
      url = initial.toString();
    }

    const upserts: ProviderEventSnapshot[] = [];
    const deletions: CalendarProviderSyncBatch["deletions"] = [];
    let deltaToken: string | null = null;
    let truncated = false;
    while (url) {
      const remaining = Math.max(input.maxEvents - upserts.length - deletions.length, 0);
      if (remaining === 0) {
        truncated = true;
        break;
      }
      const response = await this.#request(
        this.#validatedGraphUrl(url),
        credential,
        { headers: graphPreferHeaders(Math.min(remaining, 999)) },
        { cursorRequest: mode === "delta" }
      );
      const body = await jsonObject(response);
      const marker = optionalString(body["@odata.deltaLink"]) ?? optionalString(body["@odata.nextLink"]) ?? url;
      for (const raw of array(body.value)) {
        if (!isRecord(raw)) throw malformedGraphResponse();
        const event = raw as GraphEvent;
        const id = requiredString(event.id);
        if (isRecord(event["@removed"])) {
          deletions.push({
            providerEventId: id,
            providerRevision: `graph-deleted-${createHash("sha256").update(id).update("\0").update(marker).digest("hex")}`
          });
        } else {
          upserts.push(mapGraphEvent(event));
        }
      }
      const nextLink = optionalString(body["@odata.nextLink"]);
      const deltaLink = optionalString(body["@odata.deltaLink"]);
      if (upserts.length + deletions.length >= input.maxEvents && nextLink) {
        truncated = true;
        break;
      }
      if (nextLink) {
        url = this.#validatedGraphUrl(nextLink);
      } else {
        url = "";
        if (mode === "delta") deltaToken = deltaLink ? graphDeltaToken(deltaLink) : null;
      }
    }

    if (truncated) {
      return {
        upserts,
        deletions,
        nextSyncCursor: input.syncCursor ?? `${CURSOR_PREFIX}incomplete`,
        completeWindowSnapshot: false,
        truncated: true
      };
    }
    if (mode === "delta" && !deltaToken) throw malformedGraphResponse();
    return {
      upserts,
      deletions,
      nextSyncCursor: encodeGraphCursor({
        v: 1,
        mode,
        startUtc: input.window.startUtc,
        endUtc: input.window.endUtc,
        ...(deltaToken ? { deltaToken } : {})
      }),
      completeWindowSnapshot: cursor === null,
      truncated: false
    };
  }

  async readEvent(input: Parameters<CalendarProviderAdapter["readEvent"]>[0]): Promise<ProviderEventSnapshot | null> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    const event = await this.#readRawEvent(credential, input.providerCalendarId, input.providerEventId);
    return event ? mapGraphEvent(event) : null;
  }

  async createEvent(input: Parameters<CalendarProviderAdapter["createEvent"]>[0]): Promise<{ providerEventId: string }> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    assertWritableStatus(input.content);
    assertStandaloneProviderWrite(input.content);
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events`,
      credential,
      {
        method: "POST",
        headers: { ...graphPreferHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toGraphEventBody(input.content),
          isOnlineMeeting: false,
          transactionId: deterministicGraphTransactionId(input.commandId)
        })
      },
      { authorizeDispatch: input.authorizeDispatch }
    );
    const created = await jsonObject(response);
    return { providerEventId: requiredString(created.id) };
  }

  async updateEvent(input: Parameters<CalendarProviderAdapter["updateEvent"]>[0]): Promise<void> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    assertWritableStatus(input.content);
    const current = await this.#readRawEvent(credential, input.providerCalendarId, input.providerEventId);
    if (!current) throw new ProviderRevisionConflictError(null);
    assertGraphWriteEvidence(current);
    const currentContent = mapGraphEvent(current).content;
    assertStandaloneProviderWrite(currentContent);
    const currentRevision = graphRevision(current);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const patch = toGraphEventPatch(currentContent, input.content);
    if (!Object.keys(patch).length) {
      await input.authorizeDispatch?.();
      return;
    }
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`,
      credential,
      {
        method: "PATCH",
        headers: {
          ...graphPreferHeaders(),
          "Content-Type": "application/json",
          "If-Match": input.expectedProviderRevision
        },
        body: JSON.stringify(patch)
      },
      { allowedStatuses: [404, 412], authorizeDispatch: input.authorizeDispatch }
    );
    if (response.status === 404 || response.status === 412) {
      throw new ProviderRevisionConflictError(await this.#currentRevision(
        credential,
        input.providerCalendarId,
        input.providerEventId
      ));
    }
  }

  async deleteEvent(input: Parameters<CalendarProviderAdapter["deleteEvent"]>[0]): Promise<void> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    const current = await this.#readRawEvent(credential, input.providerCalendarId, input.providerEventId);
    if (!current) throw new ProviderRevisionConflictError(null);
    assertGraphWriteEvidence(current);
    assertStandaloneProviderWrite(mapGraphEvent(current).content);
    const currentRevision = graphRevision(current);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`,
      credential,
      {
        method: "DELETE",
        headers: { ...graphPreferHeaders(), "If-Match": input.expectedProviderRevision }
      },
      { allowedStatuses: [404, 412], authorizeDispatch: input.authorizeDispatch }
    );
    if (response.status === 404 || response.status === 412) {
      throw new ProviderRevisionConflictError(await this.#currentRevision(
        credential,
        input.providerCalendarId,
        input.providerEventId
      ));
    }
  }

  async revokeConnection(input: Parameters<CalendarProviderAdapter["revokeConnection"]>[0]): Promise<void> {
    await this.#revoker.revoke({
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      providerAccountId: input.providerAccountId
    });
  }

  async listSubscriptions(input: SubscriptionCredential): Promise<MicrosoftCalendarSubscription[]> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      ...input, providerKey: this.providerKey, expectedProviderAccountId: input.providerAccountId
    });
    const result: MicrosoftCalendarSubscription[] = [];
    let url: string | null = `${this.#apiBase}/subscriptions`;
    while (url) {
      const body = await jsonObject(await this.#request(this.#validatedGraphUrl(url), credential));
      for (const raw of array(body.value)) {
        // Listing can include other resources owned by this app. Do not inspect
        // their payloads or adopt them; lifecycle management matches exact URL,
        // resource and creator below the adapter boundary.
        result.push(graphSubscription(raw));
        if (result.length > 1_000) throw new ProviderTransientError("Subscription discovery exceeded its bounded limit.");
      }
      url = optionalString(body["@odata.nextLink"]);
    }
    return result;
  }

  async createSubscription(input: SubscriptionCredential & {
    notificationUrl: string; clientState: string; expiresAt: string;
  }): Promise<MicrosoftCalendarSubscription> {
    if (input.clientState.length < 32 || input.clientState.length > 128 || new URL(input.notificationUrl).protocol !== "https:") {
      throw new Error("Invalid Calendar notification binding.");
    }
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      ...input, providerKey: this.providerKey, expectedProviderAccountId: input.providerAccountId
    });
    const body = await jsonObject(await this.#request(`${this.#apiBase}/subscriptions`, credential, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        changeType: "created,updated,deleted", resource: `users/${encodeURIComponent(input.providerAccountId)}/events`,
        notificationUrl: input.notificationUrl, lifecycleNotificationUrl: input.notificationUrl,
        clientState: input.clientState, expirationDateTime: input.expiresAt, includeResourceData: false,
        latestSupportedTlsVersion: "v1_2"
      })
    }));
    return graphSubscription(body);
  }

  async renewSubscription(input: SubscriptionCredential & {
    subscriptionId: string; expiresAt: string;
  }): Promise<MicrosoftCalendarSubscription | null> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      ...input, providerKey: this.providerKey, expectedProviderAccountId: input.providerAccountId
    });
    const response = await this.#request(`${this.#apiBase}/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      credential, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expirationDateTime: input.expiresAt }) }, { allowedStatuses: [404] });
    return response.status === 404 ? null : graphSubscription(await jsonObject(response));
  }

  async deleteSubscription(input: SubscriptionCredential & { subscriptionId: string }): Promise<void> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      ...input, providerKey: this.providerKey, expectedProviderAccountId: input.providerAccountId
    });
    await this.#request(`${this.#apiBase}/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      credential, { method: "DELETE" }, { allowedStatuses: [404] });
  }

  async #readRawEvent(credential: ResolvedCalendarProviderCredential, calendarId: string, eventId: string): Promise<GraphEvent | null> {
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      credential,
      { headers: graphPreferHeaders() },
      { allowedStatuses: [404] }
    );
    if (response.status === 404) return null;
    return await jsonObject(response) as GraphEvent;
  }

  async #currentRevision(credential: ResolvedCalendarProviderCredential, calendarId: string, eventId: string): Promise<string | null> {
    const current = await this.#readRawEvent(credential, calendarId, eventId);
    return current ? graphRevision(current) : null;
  }

  #validatedGraphUrl(input: string): string {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw malformedGraphResponse();
    }
    if (parsed.origin !== this.#apiOrigin || !parsed.pathname.startsWith(this.#apiPathPrefix) || parsed.username || parsed.password || parsed.hash) {
      throw malformedGraphResponse();
    }
    return parsed.toString();
  }

  async #request(
    input: string | URL,
    credential: ResolvedCalendarProviderCredential,
    init: RequestInit = {},
    options: { allowedStatuses?: number[]; cursorRequest?: boolean; authorizeDispatch?: () => Promise<void> } = {}
  ): Promise<Response> {
    let response: Response;
    const headers = bearerHeaders(credential.accessToken);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    // The callback runs after credential resolution and source-event readback,
    // immediately before the mutating request. Keep its denial unchanged.
    await options.authorizeDispatch?.();
    try {
      response = await this.#fetch(input, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
    } catch {
      throw new ProviderTransientError("Microsoft Graph did not complete the request reliably.");
    }
    if (response.ok && credential.renewedAccessToken === true) {
      // This exact credential produced a successful Graph response. Consume
      // once even if the call paginates or the observer fails; no public DTOs.
      delete credential.renewedAccessToken;
      try { this.#onRenewedCredentialUsed?.(); } catch { /* Logging cannot change provider success. */ }
    }
    if (response.ok || options.allowedStatuses?.includes(response.status)) return response;
    if (options.cursorRequest && response.status === 410) throw new ProviderCursorExpiredError();
    if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new ProviderTransientError("Microsoft Graph returned a retryable response.");
    }
    throw new Error(`Microsoft Graph request failed with status ${response.status}.`);
  }
}

function graphSubscription(value: unknown): MicrosoftCalendarSubscription {
  if (!isRecord(value)) throw malformedGraphResponse();
  const expiresAt = requiredString(value.expirationDateTime);
  if (!Number.isFinite(Date.parse(expiresAt))) throw malformedGraphResponse();
  return { id: requiredString(value.id), resource: requiredString(value.resource),
    notificationUrl: requiredString(value.notificationUrl), creatorId: requiredString(value.creatorId),
    expiresAt: new Date(expiresAt).toISOString() };
}

function mapGraphEvent(event: GraphEvent): ProviderEventSnapshot {
  const providerEventId = requiredString(event.id);
  const start = graphDateTime(event.start);
  const end = graphDateTime(event.end);
  let span: ProviderEventContent["span"];
  if (event.isAllDay === true) {
    span = {
      kind: "all_day",
      startDate: calendarDate(start.dateTime),
      endDateExclusive: calendarDate(end.dateTime)
    };
  } else {
    const startUtc = graphUtcInstant(start);
    const endUtc = graphUtcInstant(end);
    const sourceTimeZone = optionalString(event.originalStartTimeZone) ?? start.timeZone;
    span = {
      kind: "timed",
      startUtc,
      endUtc,
      sourceTimeZone,
      floatingLocalStart: sourceTimeZone ? localDateTime(startUtc, sourceTimeZone) : null,
      floatingLocalEnd: sourceTimeZone ? localDateTime(endUtc, optionalString(event.originalEndTimeZone) ?? sourceTimeZone) : null
    };
  }
  const body = isRecord(event.body) ? optionalString(event.body.content) : null;
  const location = isRecord(event.location) ? optionalString(event.location.displayName) : null;
  return {
    providerEventId,
    providerRevision: graphRevision(event),
    content: {
      title: optionalString(event.subject) ?? "Untitled event",
      description: body ?? optionalString(event.bodyPreview),
      location,
      span,
      providerSeriesId: optionalString(event.seriesMasterId),
      status: event.isCancelled === true ? "canceled" : event.showAs === "tentative" ? "tentative" : "confirmed",
      providerRecurrence: {
        kind: graphRecurrenceKind(event),
        originalStartUtc: optionalString(event.originalStart) ? normalizedOriginalStart(requiredString(event.originalStart)) : null
      },
      outboundEffects: { attendeeCount: array(event.attendees).length,
        hasOnlineMeeting: event.isOnlineMeeting === true || isRecord(event.onlineMeeting) || Boolean(optionalString(event.onlineMeetingUrl)) }
    }
  };
}

function toGraphEventBody(content: ProviderEventContent): Record<string, unknown> {
  const span = content.span.kind === "all_day"
    ? {
        isAllDay: true,
        start: { dateTime: `${content.span.startDate}T00:00:00`, timeZone: "UTC" },
        end: { dateTime: `${content.span.endDateExclusive}T00:00:00`, timeZone: "UTC" }
      }
    : {
        isAllDay: false,
        start: graphTimedBoundary(content.span.startUtc, content.span.floatingLocalStart, content.span.sourceTimeZone),
        end: graphTimedBoundary(content.span.endUtc, content.span.floatingLocalEnd, content.span.sourceTimeZone)
      };
  return {
    subject: content.title,
    body: { contentType: "text", content: content.description ?? "" },
    location: { displayName: content.location ?? "" },
    showAs: content.status === "tentative" ? "tentative" : "busy",
    ...span
  };
}

function toGraphEventPatch(current: ProviderEventContent, intended: ProviderEventContent): Record<string, unknown> {
  const body = toGraphEventBody(intended);
  const patch: Record<string, unknown> = {};
  if (current.title !== intended.title) patch.subject = body.subject;
  if ((current.description ?? "") !== (intended.description ?? "")) patch.body = body.body;
  if ((current.location ?? "") !== (intended.location ?? "")) patch.location = body.location;
  // "confirmed" is the app's projection of several Graph showAs values. Do
  // not turn free/out-of-office/etc. into busy when status was not edited.
  if (current.status !== intended.status) patch.showAs = body.showAs;
  if (current.span.kind !== intended.span.kind) {
    patch.isAllDay = body.isAllDay;
    patch.start = body.start;
    patch.end = body.end;
  } else if (current.span.kind === "timed" && intended.span.kind === "timed") {
    // Source zone names and floating-local mirrors are provenance, not a time
    // edit. Comparing instants also treats equivalent ISO spellings equally.
    if (Date.parse(current.span.startUtc) !== Date.parse(intended.span.startUtc)) patch.start = body.start;
    if (Date.parse(current.span.endUtc) !== Date.parse(intended.span.endUtc)) patch.end = body.end;
  } else if (current.span.kind === "all_day" && intended.span.kind === "all_day") {
    if (current.span.startDate !== intended.span.startDate) patch.start = body.start;
    if (current.span.endDateExclusive !== intended.span.endDateExclusive) patch.end = body.end;
  }
  return patch;
}

function graphTimedBoundary(utc: string, local: string | null, timeZone: string | null) {
  if (timeZone && local && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(local)) {
    return { dateTime: local, timeZone };
  }
  return { dateTime: utc.replace(/Z$/, ""), timeZone: "UTC" };
}

function graphDateTime(value: unknown): { dateTime: string; timeZone: string | null } {
  if (!isRecord(value)) throw malformedGraphResponse();
  return { dateTime: requiredString(value.dateTime), timeZone: optionalString(value.timeZone) };
}

function graphUtcInstant(value: { dateTime: string; timeZone: string | null }): string {
  const withZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(value.dateTime)
    ? value.dateTime
    : value.timeZone === "UTC" || value.timeZone === null
      ? `${value.dateTime}Z`
      : null;
  if (!withZone) throw new ProviderTransientError("Microsoft Graph returned a local event time without a safely convertible offset.");
  const parsed = Date.parse(withZone);
  if (!Number.isFinite(parsed)) throw malformedGraphResponse();
  return new Date(parsed).toISOString();
}

function calendarDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  if (!match) throw malformedGraphResponse();
  return match[1]!;
}

function graphRevision(event: GraphEvent): string {
  return requiredString(event["@odata.etag"]);
}

function graphPreferHeaders(pageSize?: number): Record<string, string> {
  const preferences = ["IdType=\"ImmutableId\"", "outlook.timezone=\"UTC\"", "outlook.body-content-type=\"text\""];
  if (pageSize !== undefined) preferences.push(`odata.maxpagesize=${Math.max(1, Math.min(999, pageSize))}`);
  return { Prefer: preferences.join(", "), "Content-Type": "application/json" };
}

function deterministicGraphTransactionId(commandId: string): string {
  const hash = createHash("sha256").update("life-links-graph-event-v1\0").update(commandId).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function graphDeltaToken(deltaLink: string): string {
  let parsed: URL;
  try {
    parsed = new URL(deltaLink);
  } catch {
    throw malformedGraphResponse();
  }
  return requiredString(parsed.searchParams.get("$deltatoken"));
}

function encodeGraphCursor(cursor: GraphCursor): string {
  const encoded = `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
  if (encoded.length > 65_536) throw new ProviderTransientError("The Microsoft Graph synchronization cursor is too large to persist safely.");
  return encoded;
}

function decodeGraphCursor(cursor: string): GraphCursor {
  try {
    if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
    if (!isRecord(value) || value.v !== 1 || (value.mode !== "delta" && value.mode !== "reconcile") ||
        typeof value.startUtc !== "string" || typeof value.endUtc !== "string" ||
        (value.mode === "delta" && (typeof value.deltaToken !== "string" || !value.deltaToken))) throw new Error();
    return value as GraphCursor;
  } catch {
    throw new ProviderCursorExpiredError();
  }
}

function localDateTime(utc: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(utc));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
  } catch {
    return null;
  }
}

function graphRecurrenceKind(event: GraphEvent): NonNullable<ProviderEventContent["providerRecurrence"]>["kind"] {
  if (event.type === "seriesMaster" || isRecord(event.recurrence)) return "series_master";
  if (event.type === "exception") return "exception";
  if (event.type === "occurrence" || optionalString(event.seriesMasterId)) return "occurrence";
  if (event.type === undefined || event.type === "singleInstance") return "single";
  throw malformedGraphResponse();
}

function assertGraphWriteEvidence(event: GraphEvent) {
  if (!Array.isArray(event.attendees) || typeof event.isOnlineMeeting !== "boolean" || event.type !== "singleInstance") {
    throw new CalendarProviderGatewayError("provider_event_read_only", "The event's standalone invitation-free source state is not established.");
  }
}

function normalizedOriginalStart(value: string): string {
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw malformedGraphResponse();
  return new Date(value).toISOString();
}

function assertWritableStatus(content: ProviderEventContent): void {
  if (content.status === "canceled") {
    throw new Error("A canceled provider event must use the explicit delete operation.");
  }
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw malformedGraphResponse();
  }
}

function malformedGraphResponse(): ProviderTransientError {
  return new ProviderTransientError("Microsoft Graph returned a malformed response.");
}

function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformedGraphResponse();
  return value;
}

function requiredString(value: unknown): string {
  const normalized = optionalString(value);
  if (!normalized) throw malformedGraphResponse();
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
