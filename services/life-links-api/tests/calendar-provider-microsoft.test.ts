import { describe, expect, it } from "vitest";

import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  calendarProviderCredentialHandle,
  type ProviderEventContent
} from "../src/calendar-provider-gateway.js";
import {
  MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY,
  MicrosoftGraphCalendarProviderAdapter
} from "../src/calendar-provider-microsoft.js";

const ACCOUNT_ID = "graph-account-123";
const HANDLE = calendarProviderCredentialHandle("vault-graph-one");
const WINDOW = {
  startUtc: "2026-09-01T00:00:00.000Z",
  endUtc: "2026-10-01T00:00:00.000Z"
};
const API_BASE = "https://graph.test/v1.0";

class HttpHarness {
  readonly calls: Array<{ url: string; init: RequestInit }> = [];
  readonly responders: Array<(url: URL, init: RequestInit) => Response | Promise<Response>> = [];
  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    this.calls.push({ url, init });
    const responder = this.responders.shift();
    if (!responder) throw new Error(`Unexpected HTTP request: ${url}`);
    return await responder(new URL(url), init);
  };
  enqueue(body: unknown, status = 200) { this.responders.push(() => json(body, status)); }
}

function adapter(http: HttpHarness, revoked: string[] = []) {
  return new MicrosoftGraphCalendarProviderAdapter({
    fetch: http.fetch,
    apiBaseUrl: API_BASE,
    credentialResolver: {
      async resolve({ providerKey }) {
        expect(providerKey).toBe(MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY);
        return { accessToken: "secret-graph-access-token", providerAccountId: ACCOUNT_ID };
      }
    },
    credentialRevoker: {
      async revoke(input) { revoked.push(`${input.providerKey}:${input.providerAccountId}`); }
    }
  });
}

function timed(title: string): ProviderEventContent {
  return {
    title,
    description: "Three working sets",
    location: "Home gym",
    status: "confirmed",
    providerSeriesId: null,
    span: {
      kind: "timed",
      startUtc: "2026-09-14T13:30:00.000Z",
      endUtc: "2026-09-14T14:30:00.000Z",
      sourceTimeZone: "America/New_York",
      floatingLocalStart: "2026-09-14T09:30:00",
      floatingLocalEnd: "2026-09-14T10:30:00"
    }
  };
}

describe("Microsoft Graph Calendar provider adapter", () => {
  it("discovers exact account/calendars and uses immutable primary-calendar delta paging", async () => {
    const http = new HttpHarness();
    const graph = adapter(http);
    http.enqueue({ id: ACCOUNT_ID });
    http.enqueue({
      value: [
        { id: "primary-calendar", name: "Primary", canEdit: true, isDefaultCalendar: true },
        { id: "shared-calendar", name: "Shared", canEdit: false, isDefaultCalendar: false }
      ]
    });
    const discovery = await graph.discover({ credentialHandle: HANDLE });
    expect(discovery).toEqual({
      providerKey: MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY,
      providerAccountId: ACCOUNT_ID,
      calendars: [
        {
          providerCalendarId: "primary-calendar",
          displayName: "Primary",
          capabilities: { read: true, create: true, update: true, delete: true }
        },
        {
          providerCalendarId: "shared-calendar",
          displayName: "Shared",
          capabilities: { read: true, create: false, update: false, delete: false }
        }
      ]
    });
    expect(JSON.stringify(discovery)).not.toContain("secret-graph-access-token");

    http.enqueue({ id: "primary-calendar", isDefaultCalendar: true });
    http.enqueue({
      value: [graphTimedEvent("event-one", "W/\"r1\"", "Morning workout")],
      "@odata.nextLink": `${API_BASE}/me/calendarView/delta?$skiptoken=page-two`
    });
    http.enqueue({
      value: [graphAllDayEvent("event-two", "W/\"r2\"")],
      "@odata.deltaLink": `${API_BASE}/me/calendarView/delta?$deltatoken=delta-one`
    });
    const initial = await graph.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      syncCursor: null,
      window: WINDOW,
      maxEvents: 100
    });
    expect(initial).toMatchObject({ completeWindowSnapshot: true, truncated: false, deletions: [] });
    expect(initial.upserts).toEqual([
      expect.objectContaining({
        providerEventId: "event-one",
        providerRevision: "W/\"r1\"",
        content: expect.objectContaining({
          title: "Morning workout",
          span: {
            kind: "timed",
            startUtc: "2026-09-14T13:30:00.000Z",
            endUtc: "2026-09-14T14:30:00.000Z",
            sourceTimeZone: "America/New_York",
            floatingLocalStart: "2026-09-14T09:30:00",
            floatingLocalEnd: "2026-09-14T10:30:00"
          }
        })
      }),
      expect.objectContaining({
        providerEventId: "event-two",
        content: expect.objectContaining({
          span: { kind: "all_day", startDate: "2026-09-18", endDateExclusive: "2026-09-21" }
        })
      })
    ]);
    const firstDeltaCall = http.calls[3]!;
    const prefer = new Headers(firstDeltaCall.init.headers).get("Prefer");
    expect(prefer).toContain("IdType=\"ImmutableId\"");
    expect(prefer).toContain("outlook.timezone=\"UTC\"");
    expect(new URL(firstDeltaCall.url).pathname).toBe("/v1.0/me/calendarView/delta");

    http.enqueue({
      value: [{ id: "event-one", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink": `${API_BASE}/me/calendarView/delta?$deltatoken=delta-two`
    });
    const incremental = await graph.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      syncCursor: initial.nextSyncCursor,
      window: WINDOW,
      maxEvents: 100
    });
    expect(incremental.completeWindowSnapshot).toBe(false);
    expect(incremental.deletions).toEqual([
      { providerEventId: "event-one", providerRevision: expect.stringMatching(/^graph-deleted-[a-f0-9]{64}$/) }
    ]);
    expect(new URL(http.calls.at(-1)!.url).searchParams.get("$deltatoken")).toBe("delta-one");

    http.responders.push(() => new Response(null, { status: 410 }));
    await expect(graph.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      syncCursor: incremental.nextSyncCursor,
      window: WINDOW,
      maxEvents: 100
    })).rejects.toBeInstanceOf(ProviderCursorExpiredError);
  });

  it("forces bounded full reconciliation for non-default calendars instead of using undocumented beta delta", async () => {
    const http = new HttpHarness();
    const graph = adapter(http);
    http.enqueue({ id: "shared-calendar", isDefaultCalendar: false });
    http.enqueue({ value: [graphTimedEvent("shared-event", "W/\"s1\"", "Shared appointment")] });
    const initial = await graph.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "shared-calendar",
      syncCursor: null,
      window: WINDOW,
      maxEvents: 100
    });
    expect(initial).toMatchObject({ completeWindowSnapshot: true, truncated: false });
    expect(new URL(http.calls[1]!.url).pathname).toBe("/v1.0/me/calendars/shared-calendar/calendarView");
    await expect(graph.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "shared-calendar",
      syncCursor: initial.nextSyncCursor,
      window: WINDOW,
      maxEvents: 100
    })).rejects.toBeInstanceOf(ProviderCursorExpiredError);
    expect(http.calls).toHaveLength(2);
  });

  it("uses Graph transaction IDs, immutable IDs, and ETag preconditions for exact CRUD", async () => {
    const http = new HttpHarness();
    const revoked: string[] = [];
    const graph = adapter(http, revoked);
    http.responders.push((_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        subject: "Workout",
        transactionId: expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/),
        start: { dateTime: "2026-09-14T09:30:00", timeZone: "America/New_York" }
      });
      return json({ id: "created-event", "@odata.etag": "W/\"r1\"", ...body }, 201);
    });
    expect(await graph.createEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      commandId: "command-create-graph",
      content: timed("Workout")
    })).toEqual({ providerEventId: "created-event" });
    expect(new Headers(http.calls[0]!.init.headers).get("Prefer")).toContain("IdType=\"ImmutableId\"");

    http.enqueue(graphTimedEvent("created-event", "W/\"r1\"", "Workout"));
    http.enqueue(graphTimedEvent("created-event", "W/\"r2\"", "Workout updated"));
    await graph.updateEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      providerEventId: "created-event",
      commandId: "command-update-graph",
      expectedProviderRevision: "W/\"r1\"",
      content: timed("Workout updated")
    });
    const updateCall = http.calls.at(-1)!;
    expect(updateCall.init.method).toBe("PATCH");
    expect(new Headers(updateCall.init.headers).get("If-Match")).toBe("W/\"r1\"");

    http.enqueue(graphTimedEvent("created-event", "W/\"r3\"", "Provider changed"));
    await expect(graph.updateEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      providerEventId: "created-event",
      commandId: "command-stale-graph",
      expectedProviderRevision: "W/\"r2\"",
      content: timed("Must not overwrite")
    })).rejects.toEqual(new ProviderRevisionConflictError("W/\"r3\""));

    http.enqueue(graphTimedEvent("created-event", "W/\"r3\"", "Provider changed"));
    http.responders.push(() => new Response(null, { status: 204 }));
    await graph.deleteEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary-calendar",
      providerEventId: "created-event",
      commandId: "command-delete-graph",
      expectedProviderRevision: "W/\"r3\""
    });
    const deleteCall = http.calls.at(-1)!;
    expect(deleteCall.init.method).toBe("DELETE");
    expect(new Headers(deleteCall.init.headers).get("If-Match")).toBe("W/\"r3\"");

    await graph.revokeConnection({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID });
    expect(revoked).toEqual([`${MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY}:${ACCOUNT_ID}`]);
    expect(http.responders).toHaveLength(0);
  });
});

function graphTimedEvent(id: string, etag: string, subject: string) {
  return {
    id,
    "@odata.etag": etag,
    subject,
    body: { contentType: "text", content: "Three working sets" },
    location: { displayName: "Home gym" },
    start: { dateTime: "2026-09-14T13:30:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-09-14T14:30:00.0000000", timeZone: "UTC" },
    originalStartTimeZone: "America/New_York",
    originalEndTimeZone: "America/New_York",
    isAllDay: false,
    isCancelled: false,
    showAs: "busy"
  };
}

function graphAllDayEvent(id: string, etag: string) {
  return {
    id,
    "@odata.etag": etag,
    subject: "Camping trip",
    start: { dateTime: "2026-09-18T00:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-09-21T00:00:00.0000000", timeZone: "UTC" },
    isAllDay: true,
    isCancelled: false,
    showAs: "busy"
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
