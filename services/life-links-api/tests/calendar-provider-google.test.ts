import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
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

function adapter(http: HttpHarness, revoked: string[] = []) {
  return new GoogleCalendarProviderAdapter({
    fetch: http.fetch,
    apiBaseUrl: "https://google.test/calendar/v3",
    credentialResolver: {
      async resolve({ providerKey }) {
        expect(providerKey).toBe(GOOGLE_CALENDAR_PROVIDER_KEY);
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
        { id: "primary@example.test", summary: "Primary", accessRole: "owner" },
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
          capabilities: { read: true, create: true, update: true, delete: true }
        },
        {
          providerCalendarId: "readonly@example.test",
          displayName: "Read only",
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
