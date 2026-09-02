import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { createCanonicalExternalCalendar } from "@life-links/core";

import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  ProviderTransientError,
  CalendarProviderGateway,
  InMemoryCalendarProviderStateStore,
  calendarProviderCredentialHandle,
  type ProviderEventContent
} from "../src/calendar-provider-gateway.js";
import {
  GOOGLE_CALENDAR_PROVIDER_KEY,
  GoogleCalendarProviderAdapter
} from "../src/calendar-provider-google.js";

const ACCOUNT_ID = "google-account-123";
const HANDLE = calendarProviderCredentialHandle("vault-google-one");
const WINDOW = {
  startUtc: "2026-09-01T00:00:00.000Z",
  endUtc: "2026-10-01T00:00:00.000Z"
};

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
  enqueue(body: unknown, status = 200) {
    this.responders.push(() => json(body, status));
  }
}

function adapter(http: HttpHarness, revoked: string[] = [], beforeResolve?: () => Promise<void>) {
  return new GoogleCalendarProviderAdapter({
    fetch: http.fetch,
    apiBaseUrl: "https://google.test/calendar/v3",
    credentialResolver: {
      async resolve({ providerKey }) {
        expect(providerKey).toBe(GOOGLE_CALENDAR_PROVIDER_KEY);
        await beforeResolve?.();
        return { accessToken: "secret-google-access-token", providerAccountId: ACCOUNT_ID };
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
    description: "Pack the warm layers",
    location: "Green Tub 02",
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

describe("Google Calendar provider adapter", () => {
  it("discovers exact calendar capabilities and maps complete timed/all-day synchronization", async () => {
    const http = new HttpHarness();
    http.enqueue({
      items: [
        { id: "primary@example.test", summary: "Primary", accessRole: "owner", primary: true },
        { id: "readonly@example.test", summary: "Read only", accessRole: "reader" },
        { id: "freebusy@example.test", summary: "Busy only", accessRole: "freeBusyReader" }
      ]
    });
    const google = adapter(http);
    const discovery = await google.discover({ credentialHandle: HANDLE });
    expect(discovery).toEqual({
      providerKey: GOOGLE_CALENDAR_PROVIDER_KEY,
      providerAccountId: ACCOUNT_ID,
      calendars: [
        {
          providerCalendarId: "primary@example.test",
          displayName: "Primary",
          isDefault: true,
          capabilities: { read: true, create: true, update: true, delete: true }
        },
        {
          providerCalendarId: "readonly@example.test",
          displayName: "Read only",
          isDefault: false,
          capabilities: { read: true, create: false, update: false, delete: false }
        }
      ]
    });
    expect(JSON.stringify(discovery)).not.toContain("secret-google-access-token");

    http.enqueue({
      items: [
        {
          id: "timed-one",
          etag: "\"r1\"",
          status: "confirmed",
          summary: "Morning workout",
          description: "Three working sets",
          location: "Home gym",
          start: { dateTime: "2026-09-14T09:30:00-04:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-09-14T10:30:00-04:00", timeZone: "America/New_York" }
        },
        {
          id: "all-day-one",
          etag: "\"r2\"",
          status: "tentative",
          summary: "Camping trip",
          start: { date: "2026-09-18" },
          end: { date: "2026-09-21" }
        }
      ],
      nextSyncToken: "sync-token-one"
    });
    const initial = await google.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      syncCursor: null,
      window: WINDOW,
      maxEvents: 100
    });
    expect(initial).toMatchObject({ completeWindowSnapshot: true, truncated: false, deletions: [] });
    expect(initial.upserts).toEqual([
      expect.objectContaining({
        providerEventId: "timed-one",
        providerRevision: "\"r1\"",
        content: expect.objectContaining({
          title: "Morning workout",
          providerRecurrence: { kind: "single", originalStartUtc: null },
          outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false },
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
        providerEventId: "all-day-one",
        content: expect.objectContaining({
          status: "tentative",
          span: { kind: "all_day", startDate: "2026-09-18", endDateExclusive: "2026-09-21" }
        })
      })
    ]);
    const initialUrl = new URL(http.calls[1]!.url);
    expect(initialUrl.searchParams.get("timeMin")).toBe(WINDOW.startUtc);
    expect(initialUrl.searchParams.get("timeMax")).toBe(WINDOW.endUtc);
    expect(initialUrl.searchParams.get("singleEvents")).toBe("true");

    http.enqueue({
      items: [{ id: "timed-one", etag: "\"r3\"", status: "cancelled" }],
      nextSyncToken: "sync-token-two"
    });
    const incremental = await google.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      syncCursor: initial.nextSyncCursor,
      window: WINDOW,
      maxEvents: 100
    });
    expect(incremental).toMatchObject({
      completeWindowSnapshot: false,
      deletions: [{ providerEventId: "timed-one", providerRevision: "\"r3\"" }]
    });
    const incrementalUrl = new URL(http.calls[2]!.url);
    expect(incrementalUrl.searchParams.get("syncToken")).toBe("sync-token-one");
    expect(incrementalUrl.searchParams.has("timeMin")).toBe(false);

    http.responders.push(() => new Response(null, { status: 410 }));
    await expect(google.fetchChanges({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      syncCursor: incremental.nextSyncCursor,
      window: WINDOW,
      maxEvents: 100
    })).rejects.toBeInstanceOf(ProviderCursorExpiredError);
  });

  it("uses deterministic create identities and ETag preconditions for exact update/delete", async () => {
    const http = new HttpHarness();
    const revoked: string[] = [];
    const google = adapter(http, revoked);
    const expectedId = `ll${createHash("sha256")
      .update("life-links-google-event-v1\0")
      .update("command-create-google")
      .digest("hex")}`;
    http.responders.push((_url, init) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        id: expectedId,
        summary: "Pack night",
        start: { dateTime: "2026-09-14T09:30:00", timeZone: "America/New_York" },
        extendedProperties: { private: { lifeLinksCommandId: "command-create-google" } }
      });
      return json({ id: body.id, etag: "\"r1\"", ...body }, 201);
    });
    expect(await google.createEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      commandId: "command-create-google",
      content: timed("Pack night")
    })).toEqual({ providerEventId: expectedId });

    http.enqueue(rawEvent(expectedId, "\"r1\"", "Pack night"));
    http.enqueue(rawEvent(expectedId, "\"r2\"", "Updated"));
    await google.updateEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      providerEventId: expectedId,
      commandId: "command-update-google",
      expectedProviderRevision: "\"r1\"",
      content: timed("Updated")
    });
    const updateCall = http.calls.at(-1)!;
    expect(updateCall.init.method).toBe("PATCH");
    expect(new Headers(updateCall.init.headers).get("If-Match")).toBe("\"r1\"");
    expect(new URL(updateCall.url).searchParams.get("sendUpdates")).toBe("none");

    http.enqueue(rawEvent(expectedId, "\"r3\"", "Provider changed"));
    await expect(google.updateEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      providerEventId: expectedId,
      commandId: "command-stale-google",
      expectedProviderRevision: "\"r2\"",
      content: timed("Must not overwrite")
    })).rejects.toEqual(new ProviderRevisionConflictError("\"r3\""));

    http.enqueue(rawEvent(expectedId, "\"r3\"", "Provider changed"));
    http.responders.push(() => new Response(null, { status: 204 }));
    await google.deleteEvent({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID,
      providerCalendarId: "primary@example.test",
      providerEventId: expectedId,
      commandId: "command-delete-google",
      expectedProviderRevision: "\"r3\""
    });
    const deleteCall = http.calls.at(-1)!;
    expect(deleteCall.init.method).toBe("DELETE");
    expect(new Headers(deleteCall.init.headers).get("If-Match")).toBe("\"r3\"");

    await google.revokeConnection({
      credentialHandle: HANDLE,
      providerAccountId: ACCOUNT_ID
    });
    expect(revoked).toEqual([`${GOOGLE_CALENDAR_PROVIDER_KEY}:${ACCOUNT_ID}`]);
    expect(http.responders).toHaveLength(0);
  });

  it("reads secondary-calendar pages and refuses reuse of a cursor for another window", async () => {
    const http = new HttpHarness(); const google = adapter(http);
    const calendarId = "secondary/calendar@group.calendar.google.com";
    http.enqueue({ items: [rawEvent("one", "\"r1\"", "One")], nextPageToken: "page-two" });
    http.enqueue({ items: [rawEvent("two", "\"r2\"", "Two")], nextSyncToken: "exact-sync" });
    const result = await google.fetchChanges({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: calendarId, syncCursor: null, window: WINDOW, maxEvents: 10 });
    expect(result.upserts.map((event) => event.providerEventId)).toEqual(["one", "two"]);
    expect(http.calls.every((call) => new URL(call.url).pathname === `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`)).toBe(true);
    expect(new URL(http.calls[1].url).searchParams.get("pageToken")).toBe("page-two");
    await expect(google.fetchChanges({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: calendarId, syncCursor: result.nextSyncCursor,
      window: { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-11-01T00:00:00.000Z" }, maxEvents: 10
    })).rejects.toBeInstanceOf(ProviderCursorExpiredError);
    expect(http.calls).toHaveLength(2);
  });

  it("preserves series/instance identity and source effects without exposing attendee details", async () => {
    const http = new HttpHarness(); const google = adapter(http);
    const instance = { ...rawEvent("instance", "\"r1\"", "Moved instance"), recurringEventId: "series-one",
      originalStartTime: { dateTime: "2026-09-13T09:30:00-04:00", timeZone: "America/New_York" },
      attendees: [{ email: "private-attendee@example.test" }], conferenceData: { conferenceId: "private-conference" } };
    http.enqueue(instance);
    const read = await google.readEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "instance" });
    expect(read).toMatchObject({ providerEventId: "instance", content: {
      providerSeriesId: "series-one", providerRecurrence: { kind: "occurrence", originalStartUtc: "2026-09-13T13:30:00.000Z" },
      outboundEffects: { attendeeCount: 1, hasOnlineMeeting: true }
    } });
    expect(JSON.stringify(read)).not.toContain("private-");
    http.enqueue({ ...rawEvent("series-one", "\"r2\"", "Series"), recurrence: ["RRULE:FREQ=DAILY"] });
    expect(await google.readEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "series-one" })).toMatchObject({ content: {
      providerRecurrence: { kind: "series_master", originalStartUtc: null }
    } });
    http.enqueue({ ...rawEvent("unknown-attendees", "\"r3\"", "Incomplete attendee list"), attendeesOmitted: true });
    const incomplete = await google.readEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "unknown-attendees" });
    expect(incomplete?.content.outboundEffects).toBeUndefined();
  });

  it.each(["update", "delete"] as const)("refuses %s of recurring, invitation, conferencing or unknown-effect source events", async (kind) => {
    const http = new HttpHarness(); const google = adapter(http);
    for (const extra of [
      { recurrence: ["RRULE:FREQ=DAILY"] },
      { recurringEventId: "series-one", originalStartTime: { dateTime: "2026-09-14T09:30:00-04:00" } },
      { attendees: [{ email: "private@example.test" }] },
      { conferenceData: {} }, { hangoutLink: "https://meet.google.com/private" },
      { attendeesOmitted: true }, { eventType: "focusTime" }, { locked: true }
    ]) {
      http.enqueue({ ...rawEvent("refused", "\"r1\"", "Before"), ...extra });
      const common = { credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
        providerCalendarId: "secondary-calendar", providerEventId: "refused", commandId: "refused-write", expectedProviderRevision: "\"r1\"" };
      await expect(kind === "update" ? google.updateEvent({ ...common, content: timed("After") }) : google.deleteEvent(common))
        .rejects.toMatchObject({ code: "provider_event_read_only" });
    }
    expect(http.calls.every((call) => !call.init.method || call.init.method === "GET")).toBe(true);
  });

  it("PATCHes only a changed title and preserves source rich text, location, timezone and fractional instants", async () => {
    const http = new HttpHarness(); const google = adapter(http);
    const source = { ...rawEvent("title-only", "\"r1\"", "Before"), description: "<b>Keep formatting</b>", location: "Keep location",
      start: { dateTime: "2026-09-14T09:30:00.500-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-09-14T10:30:00.500-04:00", timeZone: "America/New_York" } };
    http.enqueue(source);
    const projection = await google.readEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "title-only" });
    http.enqueue(source); http.enqueue({});
    await google.updateEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "title-only", commandId: "title-change",
      expectedProviderRevision: "\"r1\"", content: { ...projection!.content, title: "After" } });
    expect(JSON.parse(String(http.calls.at(-1)!.init.body))).toEqual({ summary: "After" });
    expect(new Headers(http.calls.at(-1)!.init.headers).get("If-Match")).toBe("\"r1\"");
  });

  it("sends intended field/time changes while treating equivalent timestamps as unchanged", async () => {
    const http = new HttpHarness(); const google = adapter(http);
    const source = { ...rawEvent("edited", "\"r1\"", "Workout"), description: "Pack the warm layers", location: "Green Tub 02" };
    const intended = timed("Workout");
    intended.description = null; intended.location = "New location"; intended.status = "tentative";
    if (intended.span.kind !== "timed") throw new Error("Expected timed fixture");
    intended.span = { ...intended.span, startUtc: "2026-09-14T09:30:00-04:00", endUtc: "2026-09-14T15:30:00.000Z", floatingLocalEnd: "2026-09-14T11:30:00" };
    http.enqueue(source); http.enqueue({});
    await google.updateEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "edited", commandId: "field-change",
      expectedProviderRevision: "\"r1\"", content: intended });
    expect(JSON.parse(String(http.calls.at(-1)!.init.body))).toEqual({ description: null, location: "New location", status: "tentative",
      end: { dateTime: "2026-09-14T11:30:00", timeZone: "America/New_York" } });
    http.enqueue(source);
    const unchanged = timed("Workout");
    if (unchanged.span.kind !== "timed") throw new Error("Expected timed fixture");
    unchanged.span = { ...unchanged.span, startUtc: "2026-09-14T09:30:00-04:00", endUtc: "2026-09-14T14:30:00Z" };
    const authorizeDispatch = vi.fn(async () => {});
    await google.updateEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: "edited", commandId: "unchanged",
      expectedProviderRevision: "\"r1\"", content: unchanged, authorizeDispatch });
    expect(http.calls).toHaveLength(3);
    expect(authorizeDispatch).toHaveBeenCalledOnce();
  });

  it("rechecks the canonical grant immediately before Google POST/PATCH/DELETE", async () => {
    for (const kind of ["create", "update", "delete"] as const) {
      const http = new HttpHarness(); const store = new InMemoryCalendarProviderStateStore();
      const ownerId = "dispatch-owner", connectionId = "dispatch-connection";
      const calendarId = "calendar-11111111-1111-4111-8111-111111111111";
      const revokeGrant = async () => gateway.setCalendarAgentGrant({ ownerId, connectionId, calendarId,
        agentGrant: "none", expectedUpdatedAt: (await store.getCanonicalCalendar(calendarId))!.updatedAt }).then(() => {});
      const google = adapter(http, [], kind === "create" ? revokeGrant : undefined);
      const gateway = new CalendarProviderGateway([google], store);
      await store.saveConnection({ ownerId, connectionId, providerKey: GOOGLE_CALENDAR_PROVIDER_KEY,
        providerAccountId: ACCOUNT_ID, credentialHandle: HANDLE, status: "active", connectedAt: "2026-09-01T00:00:00.000Z",
        disconnectedAt: null, remoteRevocationStatus: "not_required", remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null });
      await store.provisionCalendar(createCanonicalExternalCalendar({ id: calendarId, ownerId, title: "Agent Tests",
        timeZone: "UTC", color: "#2f6f5f", agentAccess: "write", createdAt: "2026-09-01T00:00:00.000Z" }), {
        ownerId, connectionId, providerKey: GOOGLE_CALENDAR_PROVIDER_KEY, providerAccountId: ACCOUNT_ID,
        calendarId, providerCalendarId: "secondary-calendar", providerDisplayName: "Agent Tests", agentGrant: "write", visible: true,
        capabilities: { read: true, create: true, update: true, delete: true }
      });
      if (kind !== "create") {
        http.enqueue(rawEvent("exact-event", "\"r1\"", "Before"));
        http.responders.push(async () => { await revokeGrant(); return json(rawEvent("exact-event", "\"r1\"", "Before")); });
      }
      const common = { ownerId, connectionId, calendarId, commandId: `late-revoke-${kind}`, actor: "agent" as const };
      const command = kind === "create" ? { ...common, kind, content: timed("After") }
        : kind === "update" ? { ...common, kind, providerEventId: "exact-event", expectedProviderRevision: "\"r1\"", content: timed("After") }
          : { ...common, kind, providerEventId: "exact-event", expectedProviderRevision: "\"r1\"" };
      await expect(gateway.executeCommand(command, { authorizeAgent: async () => {} })).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
      expect(http.calls).toHaveLength(kind === "create" ? 0 : 2);
      expect(http.calls.some((call) => ["POST", "PATCH", "DELETE"].includes(call.init.method ?? "GET"))).toBe(false);
    }
  });

  it("keeps deterministic create replay and rejects a mismatched source event identity", async () => {
    const http = new HttpHarness(); const google = adapter(http);
    const commandId = "same-create";
    const id = `ll${createHash("sha256").update("life-links-google-event-v1\0").update(commandId).digest("hex")}`;
    http.enqueue({}, 409);
    http.enqueue({ ...rawEvent(id, "\"r1\"", "Created"), extendedProperties: { private: { lifeLinksCommandId: commandId } } });
    expect(await google.createEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", commandId, content: timed("Created") })).toEqual({ providerEventId: id });
    http.enqueue(rawEvent("different-event", "\"r1\"", "Wrong identity"));
    await expect(google.updateEvent({ credentialHandle: HANDLE, providerAccountId: ACCOUNT_ID,
      providerCalendarId: "secondary-calendar", providerEventId: id, commandId: "identity-mismatch",
      expectedProviderRevision: "\"r1\"", content: timed("Must not write") })).rejects.toBeInstanceOf(ProviderTransientError);
    expect(http.calls.filter((call) => call.init.method === "PATCH")).toHaveLength(0);
  });

  it("bounds each Google request and suppresses underlying timeout details", async () => {
    const controller = new AbortController(); controller.abort(new Error("private-network-details"));
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      const http = new HttpHarness(); const google = adapter(http);
      http.responders.push((_url, init) => { init.signal?.throwIfAborted(); throw new Error("Expected aborted signal"); });
      await expect(google.discover({ credentialHandle: HANDLE })).rejects.toThrow("Google Calendar did not complete the request reliably.");
      expect(timeout).toHaveBeenCalledWith(20_000);
      expect(http.calls[0].init.signal).toBe(controller.signal);
    } finally { timeout.mockRestore(); }
  });
});

function rawEvent(id: string, etag: string, summary: string) {
  return {
    id,
    etag,
    status: "confirmed",
    summary,
    start: { dateTime: "2026-09-14T09:30:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-09-14T10:30:00-04:00", timeZone: "America/New_York" }
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
