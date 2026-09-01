import { createHash } from "node:crypto";

import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  ProviderTransientError,
  type CalendarProviderAdapter,
  type CalendarProviderCapabilities,
  type CalendarProviderDiscovery,
  type CalendarProviderSyncBatch,
  type CalendarProviderWindow,
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

export const GOOGLE_CALENDAR_PROVIDER_KEY = "google-calendar";
const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
const MAX_DISCOVERY_CALENDARS = 1_000;
const CURSOR_PREFIX = "gcal1.";

type GoogleCalendarEntry = {
  id?: unknown;
  summary?: unknown;
  summaryOverride?: unknown;
  accessRole?: unknown;
  deleted?: unknown;
};

type GoogleEventDateTime = {
  date?: unknown;
  dateTime?: unknown;
  timeZone?: unknown;
};

type GoogleEvent = {
  id?: unknown;
  etag?: unknown;
  status?: unknown;
  summary?: unknown;
  description?: unknown;
  location?: unknown;
  start?: unknown;
  end?: unknown;
  recurringEventId?: unknown;
  attendees?: unknown;
  conferenceData?: unknown;
  extendedProperties?: unknown;
};

type GoogleCursor = {
  v: 1;
  startUtc: string;
  endUtc: string;
  syncToken: string;
};

export class GoogleCalendarProviderAdapter implements CalendarProviderAdapter {
  readonly providerKey = GOOGLE_CALENDAR_PROVIDER_KEY;
  readonly #resolver: CalendarProviderCredentialResolver;
  readonly #revoker: CalendarProviderCredentialRevoker;
  readonly #fetch: CalendarProviderFetch;
  readonly #apiBase: string;

  constructor(options: {
    credentialResolver: CalendarProviderCredentialResolver;
    credentialRevoker: CalendarProviderCredentialRevoker;
    fetch?: CalendarProviderFetch;
    apiBaseUrl?: string;
  }) {
    this.#resolver = options.credentialResolver;
    this.#revoker = options.credentialRevoker;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#apiBase = (options.apiBaseUrl ?? GOOGLE_API_BASE).replace(/\/$/, "");
  }

  async discover(input: Parameters<CalendarProviderAdapter["discover"]>[0]): Promise<CalendarProviderDiscovery> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey
    });
    const calendars: CalendarProviderDiscovery["calendars"] = [];
    let pageToken: string | null = null;
    do {
      const url = new URL(`${this.#apiBase}/users/me/calendarList`);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showDeleted", "false");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.#request(url, credential.accessToken);
      const body = await jsonObject(response);
      for (const raw of array(body.items)) {
        if (!isRecord(raw)) throw malformedGoogleResponse();
        const entry = raw as GoogleCalendarEntry;
        if (entry.deleted === true || entry.accessRole === "freeBusyReader") continue;
        const providerCalendarId = requiredString(entry.id);
        const displayName = optionalString(entry.summaryOverride) ?? optionalString(entry.summary) ?? "Untitled calendar";
        calendars.push({
          providerCalendarId,
          displayName,
          capabilities: googleCapabilities(entry.accessRole)
        });
        if (calendars.length > MAX_DISCOVERY_CALENDARS) {
          throw new ProviderTransientError("Google Calendar discovery exceeded the bounded calendar limit.");
        }
      }
      pageToken = optionalString(body.nextPageToken);
    } while (pageToken);
    return { providerKey: this.providerKey, providerAccountId: credential.providerAccountId, calendars };
  }

  async fetchChanges(input: Parameters<CalendarProviderAdapter["fetchChanges"]>[0]): Promise<CalendarProviderSyncBatch> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    const cursor = input.syncCursor ? decodeGoogleCursor(input.syncCursor) : null;
    if (cursor && (cursor.startUtc !== input.window.startUtc || cursor.endUtc !== input.window.endUtc)) {
      throw new ProviderCursorExpiredError();
    }

    const upserts: ProviderEventSnapshot[] = [];
    const deletions: CalendarProviderSyncBatch["deletions"] = [];
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;
    let truncated = false;
    do {
      const remaining = Math.max(input.maxEvents - upserts.length - deletions.length, 0);
      if (remaining === 0) {
        truncated = true;
        break;
      }
      const url = new URL(`${this.#apiBase}/calendars/${encodeURIComponent(input.providerCalendarId)}/events`);
      url.searchParams.set("maxResults", String(Math.min(2_500, remaining)));
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      if (cursor) {
        url.searchParams.set("syncToken", cursor.syncToken);
      } else {
        url.searchParams.set("timeMin", input.window.startUtc);
        url.searchParams.set("timeMax", input.window.endUtc);
      }
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.#request(url, credential.accessToken, undefined, { cursorRequest: true });
      const body = await jsonObject(response);
      const items = array(body.items);
      for (const raw of items) {
        if (!isRecord(raw)) throw malformedGoogleResponse();
        const event = raw as GoogleEvent;
        const id = requiredString(event.id);
        const revision = googleRevision(event, id);
        if (event.status === "cancelled" || event.status === "canceled") {
          deletions.push({ providerEventId: id, providerRevision: revision });
        } else {
          upserts.push(mapGoogleEvent(event));
        }
      }
      pageToken = optionalString(body.nextPageToken);
      nextSyncToken = optionalString(body.nextSyncToken);
      if (upserts.length + deletions.length >= input.maxEvents && pageToken) {
        truncated = true;
        break;
      }
    } while (pageToken);

    if (truncated) {
      return {
        upserts,
        deletions,
        nextSyncCursor: input.syncCursor ?? `${CURSOR_PREFIX}incomplete`,
        completeWindowSnapshot: false,
        truncated: true
      };
    }
    if (!nextSyncToken) throw malformedGoogleResponse();
    return {
      upserts,
      deletions,
      nextSyncCursor: encodeGoogleCursor({
        v: 1,
        startUtc: input.window.startUtc,
        endUtc: input.window.endUtc,
        syncToken: nextSyncToken
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
    if (!event || event.status === "cancelled" || event.status === "canceled") return null;
    return mapGoogleEvent(event);
  }

  async createEvent(input: Parameters<CalendarProviderAdapter["createEvent"]>[0]): Promise<{ providerEventId: string }> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    assertWritableStatus(input.content);
    const providerEventId = deterministicGoogleEventId(input.commandId);
    const body = {
      id: providerEventId,
      ...toGoogleEventBody(input.content),
      extendedProperties: { private: { lifeLinksCommandId: input.commandId } }
    };
    const url = new URL(`${this.#apiBase}/calendars/${encodeURIComponent(input.providerCalendarId)}/events`);
    url.searchParams.set("sendUpdates", "none");
    const response = await this.#request(url, credential.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, { allowedStatuses: [409] });
    if (response.status === 409) {
      const existing = await this.#readRawEvent(credential.accessToken, input.providerCalendarId, providerEventId);
      const privateProperties = isRecord(existing?.extendedProperties) && isRecord(existing.extendedProperties.private)
        ? existing.extendedProperties.private
        : null;
      if (!existing || privateProperties?.lifeLinksCommandId !== input.commandId) {
        throw new ProviderTransientError("Google Calendar returned an event identity collision.");
      }
      return { providerEventId };
    }
    const created = await jsonObject(response);
    if (requiredString(created.id) !== providerEventId) throw malformedGoogleResponse();
    return { providerEventId };
  }

  async updateEvent(input: Parameters<CalendarProviderAdapter["updateEvent"]>[0]): Promise<void> {
    const credential = await resolveCalendarProviderCredential(this.#resolver, {
      credentialHandle: input.credentialHandle,
      providerKey: this.providerKey,
      expectedProviderAccountId: input.providerAccountId
    });
    assertWritableStatus(input.content);
    const current = await this.#readRawEvent(credential.accessToken, input.providerCalendarId, input.providerEventId);
    if (!current || current.status === "cancelled" || current.status === "canceled") {
      throw new ProviderRevisionConflictError(null);
    }
    const currentRevision = googleRevision(current, input.providerEventId);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const url = new URL(`${this.#apiBase}/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`);
    url.searchParams.set("sendUpdates", "none");
    const response = await this.#request(url, credential.accessToken, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "If-Match": input.expectedProviderRevision },
      body: JSON.stringify(toGoogleEventBody(input.content))
    }, { allowedStatuses: [404, 412] });
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
    if (!current || current.status === "cancelled" || current.status === "canceled") {
      throw new ProviderRevisionConflictError(null);
    }
    const currentRevision = googleRevision(current, input.providerEventId);
    if (currentRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(currentRevision);
    }
    const url = new URL(`${this.#apiBase}/calendars/${encodeURIComponent(input.providerCalendarId)}/events/${encodeURIComponent(input.providerEventId)}`);
    url.searchParams.set("sendUpdates", "none");
    const response = await this.#request(url, credential.accessToken, {
      method: "DELETE",
      headers: { "If-Match": input.expectedProviderRevision }
    }, { allowedStatuses: [404, 412] });
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

  async #readRawEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleEvent | null> {
    const url = `${this.#apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const response = await this.#request(url, accessToken, undefined, { allowedStatuses: [404] });
    if (response.status === 404) return null;
    return await jsonObject(response) as GoogleEvent;
  }

  async #currentRevision(accessToken: string, calendarId: string, eventId: string): Promise<string | null> {
    const current = await this.#readRawEvent(accessToken, calendarId, eventId);
    return current ? googleRevision(current, eventId) : null;
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
      throw new ProviderTransientError("Google Calendar did not complete the request reliably.");
    }
    if (response.ok || options.allowedStatuses?.includes(response.status)) return response;
    if (options.cursorRequest && response.status === 410) throw new ProviderCursorExpiredError();
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      throw new ProviderTransientError("Google Calendar returned a retryable response.");
    }
    throw new Error(`Google Calendar request failed with status ${response.status}.`);
  }
}

function googleCapabilities(accessRole: unknown): CalendarProviderCapabilities {
  const writable = accessRole === "writer" || accessRole === "owner" || accessRole === "writerWithoutPrivateAccess";
  return { read: true, create: writable, update: writable, delete: writable };
}

function mapGoogleEvent(event: GoogleEvent): ProviderEventSnapshot {
  const providerEventId = requiredString(event.id);
  const start = eventDateTime(event.start);
  const end = eventDateTime(event.end);
  let span: ProviderEventContent["span"];
  if (start.date && end.date) {
    span = { kind: "all_day", startDate: start.date, endDateExclusive: end.date };
  } else if (start.dateTime && end.dateTime) {
    const startUtc = utcInstant(start.dateTime);
    const endUtc = utcInstant(end.dateTime);
    const sourceTimeZone = start.timeZone ?? end.timeZone;
    span = {
      kind: "timed",
      startUtc,
      endUtc,
      sourceTimeZone,
      floatingLocalStart: sourceTimeZone ? localDateTime(start.dateTime, startUtc, sourceTimeZone) : null,
      floatingLocalEnd: sourceTimeZone ? localDateTime(end.dateTime, endUtc, sourceTimeZone) : null
    };
  } else {
    throw malformedGoogleResponse();
  }
  return {
    providerEventId,
    providerRevision: googleRevision(event, providerEventId),
    content: {
      title: optionalString(event.summary) ?? "Untitled event",
      description: optionalString(event.description),
      location: optionalString(event.location),
      span,
      providerSeriesId: optionalString(event.recurringEventId),
      status: event.status === "tentative" ? "tentative" : event.status === "cancelled" || event.status === "canceled" ? "canceled" : "confirmed"
    }
  };
}

function toGoogleEventBody(content: ProviderEventContent): Record<string, unknown> {
  const span = content.span.kind === "all_day"
    ? { start: { date: content.span.startDate }, end: { date: content.span.endDateExclusive } }
    : {
        start: googleTimedBoundary(content.span.startUtc, content.span.floatingLocalStart, content.span.sourceTimeZone),
        end: googleTimedBoundary(content.span.endUtc, content.span.floatingLocalEnd, content.span.sourceTimeZone)
      };
  return {
    summary: content.title,
    description: content.description,
    location: content.location,
    status: content.status === "tentative" ? "tentative" : "confirmed",
    ...span
  };
}

function googleTimedBoundary(utc: string, local: string | null, timeZone: string | null) {
  if (timeZone && local && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(local)) {
    return { dateTime: local, timeZone };
  }
  return { dateTime: utc, ...(timeZone ? { timeZone } : {}) };
}

function eventDateTime(value: unknown): { date: string | null; dateTime: string | null; timeZone: string | null } {
  if (!isRecord(value)) throw malformedGoogleResponse();
  return {
    date: optionalString(value.date),
    dateTime: optionalString(value.dateTime),
    timeZone: optionalString(value.timeZone)
  };
}

function googleRevision(event: GoogleEvent, eventId: string): string {
  const etag = optionalString(event.etag);
  if (etag) return etag;
  if (event.status === "cancelled" || event.status === "canceled") {
    return `google-deleted-${createHash("sha256").update(eventId).digest("hex")}`;
  }
  throw malformedGoogleResponse();
}

function deterministicGoogleEventId(commandId: string): string {
  return `ll${createHash("sha256").update("life-links-google-event-v1\0").update(commandId).digest("hex")}`;
}

function assertWritableStatus(content: ProviderEventContent): void {
  if (content.status === "canceled") {
    throw new Error("A canceled provider event must use the explicit delete operation.");
  }
}

function encodeGoogleCursor(cursor: GoogleCursor): string {
  const encoded = `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
  if (encoded.length > 512) throw new ProviderTransientError("The Google Calendar synchronization cursor is too large to persist safely.");
  return encoded;
}

function decodeGoogleCursor(cursor: string): GoogleCursor {
  try {
    if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), "base64url").toString("utf8"));
    if (!isRecord(value) || value.v !== 1 || typeof value.startUtc !== "string" || typeof value.endUtc !== "string" ||
        typeof value.syncToken !== "string" || !value.syncToken) throw new Error();
    return value as GoogleCursor;
  } catch {
    throw new ProviderCursorExpiredError();
  }
}

function localDateTime(providerDateTime: string, utc: string, timeZone: string): string | null {
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(providerDateTime)) return providerDateTime;
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

function utcInstant(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw malformedGoogleResponse();
  return new Date(parsed).toISOString();
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw malformedGoogleResponse();
  }
}

function malformedGoogleResponse(): ProviderTransientError {
  return new ProviderTransientError("Google Calendar returned a malformed response.");
}

function array(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformedGoogleResponse();
  return value;
}

function requiredString(value: unknown): string {
  const normalized = optionalString(value);
  if (!normalized) throw malformedGoogleResponse();
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
