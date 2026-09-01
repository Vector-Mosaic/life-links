import { createHash } from "node:crypto";

import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  ProviderTransientError,
  type CalendarProviderAdapter,
  type CalendarProviderDiscovery,
  type CalendarProviderSyncBatch,
  type ProviderEventContent,
  type ProviderEventSnapshot
} from "./calendar-provider-gateway.js";
import {
  bearerHeaders,
  resolveCalendarProviderCredential,
  type CalendarProviderCredentialResolver,
  type CalendarProviderCredentialRevoker,
  type CalendarProviderFetch
} from "./calendar-provider-credentials.js";

export const MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY = "microsoft-graph-calendar";
const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const MAX_DISCOVERY_CALENDARS = 1_000;
const CURSOR_PREFIX = "mgraph1.";

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

  constructor(options: {
    credentialResolver: CalendarProviderCredentialResolver;
    credentialRevoker: CalendarProviderCredentialRevoker;
    fetch?: CalendarProviderFetch;
    apiBaseUrl?: string;
  }) {
    this.#resolver = options.credentialResolver;
    this.#revoker = options.credentialRevoker;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
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
    const identityResponse = await this.#request(`${this.#apiBase}/me?$select=id`, credential.accessToken);
    const identity = await jsonObject(identityResponse);
    if (requiredString(identity.id) !== credential.providerAccountId) {
      throw new ProviderTransientError("Microsoft Graph returned an account identity that did not match the credential binding.");
    }

    const calendars: CalendarProviderDiscovery["calendars"] = [];
    let url: string | null = `${this.#apiBase}/me/calendars?$top=100`;
    while (url) {
      const response = await this.#request(this.#validatedGraphUrl(url), credential.accessToken);
      const body = await jsonObject(response);
      for (const raw of array(body.value)) {
        if (!isRecord(raw)) throw malformedGraphResponse();
        const calendar = raw as GraphCalendar;
        const writable = calendar.canEdit === true;
        calendars.push({
          providerCalendarId: requiredString(calendar.id),
          displayName: optionalString(calendar.name) ?? "Untitled calendar",
          capabilities: { read: true, create: writable, update: writable, delete: writable }
        });
        if (calendars.length > MAX_DISCOVERY_CALENDARS) {
          throw new ProviderTransientError("Microsoft Graph discovery exceeded the bounded calendar limit.");
        }
      }
      url = optionalString(body["@odata.nextLink"]);
    }
    return { providerKey: this.providerKey, providerAccountId: credential.providerAccountId, calendars };
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
        credential.accessToken
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
        credential.accessToken,
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
    const event = await this.#readRawEvent(credential.accessToken, input.providerCalendarId, input.providerEventId);
    return event ? mapGraphEvent(event) : null;
  }

  async createEvent(input: Parameters<CalendarProviderAdapter["createEvent"]>[0]): Promise<{ providerEventId: string }> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    assertWritableStatus(input.content);
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events`,
      credential.accessToken,
      {
        method: "POST",
        headers: { ...graphPreferHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toGraphEventBody(input.content),
          transactionId: deterministicGraphTransactionId(input.commandId)
        })
      }
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
    const current = await this.#readRawEvent(credential.accessToken, input.providerCalendarId, input.providerEventId);
    if (!current) throw new ProviderRevisionConflictError(null);
    const currentRevision = graphRevision(current);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`,
      credential.accessToken,
      {
        method: "PATCH",
        headers: {
          ...graphPreferHeaders(),
          "Content-Type": "application/json",
          "If-Match": input.expectedProviderRevision
        },
        body: JSON.stringify(toGraphEventBody(input.content))
      },
      { allowedStatuses: [404, 412] }
    );
    if (response.status === 404 || response.status === 412) {
      throw new ProviderRevisionConflictError(await this.#currentRevision(
        credential.accessToken,
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
    const current = await this.#readRawEvent(credential.accessToken, input.providerCalendarId, input.providerEventId);
    if (!current) throw new ProviderRevisionConflictError(null);
    const currentRevision = graphRevision(current);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`,
      credential.accessToken,
      {
        method: "DELETE",
        headers: { ...graphPreferHeaders(), "If-Match": input.expectedProviderRevision }
      },
      { allowedStatuses: [404, 412] }
    );
    if (response.status === 404 || response.status === 412) {
      throw new ProviderRevisionConflictError(await this.#currentRevision(
        credential.accessToken,
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

  async #readRawEvent(accessToken: string, calendarId: string, eventId: string): Promise<GraphEvent | null> {
    const response = await this.#request(
      `${this.#apiBase}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      accessToken,
      { headers: graphPreferHeaders() },
      { allowedStatuses: [404] }
    );
    if (response.status === 404) return null;
    return await jsonObject(response) as GraphEvent;
  }

  async #currentRevision(accessToken: string, calendarId: string, eventId: string): Promise<string | null> {
    const current = await this.#readRawEvent(accessToken, calendarId, eventId);
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
    accessToken: string,
    init: RequestInit = {},
    options: { allowedStatuses?: number[]; cursorRequest?: boolean } = {}
  ): Promise<Response> {
    let response: Response;
    try {
      const headers = bearerHeaders(accessToken);
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      response = await this.#fetch(input, { ...init, headers });
    } catch {
      throw new ProviderTransientError("Microsoft Graph did not complete the request reliably.");
    }
    if (response.ok || options.allowedStatuses?.includes(response.status)) return response;
    if (options.cursorRequest && response.status === 410) throw new ProviderCursorExpiredError();
    if (response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500) {
      throw new ProviderTransientError("Microsoft Graph returned a retryable response.");
    }
    throw new Error(`Microsoft Graph request failed with status ${response.status}.`);
  }
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
      status: event.isCancelled === true ? "canceled" : event.showAs === "tentative" ? "tentative" : "confirmed"
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
  if (encoded.length > 512) throw new ProviderTransientError("The Microsoft Graph synchronization cursor is too large to persist safely.");
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
