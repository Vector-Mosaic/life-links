import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CalendarAuthorizationService } from "../src/calendar-authorization.js";
import { CalendarSecretCipher, InMemoryCalendarSecretStore } from "../src/calendar-secret-store.js";
import { calendarProviderCredentialHandle, calendarProviderLocalCalendarId, CalendarProviderGateway, InMemoryCalendarProviderStateStore } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { MsalMicrosoftCalendarAuth, type MicrosoftCalendarAuth } from "../src/calendar-microsoft-auth.js";
import type { GoogleCalendarAuth } from "../src/calendar-google-auth.js";
import express from "express";
import request from "supertest";
import { createCalendarConnectionRouter } from "../src/calendar-connections.js";
import { createLogger } from "../src/logger.js";
import { readConfig } from "../src/config.js";

const msal = vi.hoisted(() => ({
  acquireTokenSilent: vi.fn(),
  config: null as unknown as { system: { networkClient: {
    sendPostRequestAsync(url: string, options: { body: string }): Promise<unknown>;
  } } },
  cache: { deserialize: vi.fn(), serialize: () => "private-msal-serialized-cache",
    getAccountByHomeId: async () => ({ homeAccountId: "home-account", tenantId: "tenant-one" }) }
}));
vi.mock("@azure/msal-node", () => ({
  LogLevel: { Error: 0 },
  ConfidentialClientApplication: class {
    constructor(config: typeof msal.config) { msal.config = config; }
    getTokenCache() { return msal.cache; }
    acquireTokenSilent(input: unknown) { return msal.acquireTokenSilent(input); }
  }
}));

function harness() {
  const store = new InMemoryCalendarSecretStore();
  const cipher = new CalendarSecretCipher(randomBytes(32).toString("base64"));
  let now = new Date("2026-09-02T12:34:00Z");
  let captured: { state: string; nonce: string; codeChallenge: string };
  const auth: MicrosoftCalendarAuth = {
    authorizationUrl: vi.fn(async (input) => { captured = input; return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${input.state}`; }),
    redeem: vi.fn(async () => ({ cache: "private-test-cache", homeAccountId: "home-account", localAccountId: "local-account", providerAccountId: "account-one", tenantId: "tenant-one" })),
    refresh: vi.fn(async (state) => ({ state: { ...state, cache: "private-refreshed-cache" }, accessToken: "private-test-token" }))
  };
  const gateway = {
    store: { getConnection: vi.fn(async () => null) },
    discoverExternalCalendars: vi.fn(async () => ({ providerKey: "microsoft-graph-calendar", providerAccountId: "account-one", calendars: [
      { providerCalendarId: "agent-tests", displayName: "Agent Tests", capabilities: { read: true, create: true, update: true, delete: true } }
    ] })),
    connectExternalAccount: vi.fn(async () => ({})),
    reconnectConnection: vi.fn(async () => ({})),
    selectExternalCalendars: vi.fn(async () => ({})),
    getConnection: vi.fn(async () => ({ connectionId: "connection-one", providerAccountId: "account-one", providerKey: "microsoft-graph-calendar" })),
    listManagedCalendars: vi.fn(async () => [])
  };
  const service = new CalendarAuthorizationService(store, cipher, auth, () => gateway as unknown as CalendarProviderGateway, () => new Date(now));
  return { service, store, cipher, auth, gateway,
    advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    async start() { const result = await service.start("owner-one", "session-one"); return { result, captured: captured! }; },
    async authorized() {
      const { captured } = await this.start();
      return service.callback({ ownerId: "owner-one", sessionId: "session-one", state: captured.state, code: "one-use-test-code" });
    }
  };
}

function googleHarness() {
  const h = harness();
  const now = () => new Date("2026-09-02T12:34:00Z");
  const providerState = new InMemoryCalendarProviderStateStore();
  const definitions = ["agent-tests", "not-selected"].map((providerCalendarId) => ({
    providerCalendarId, displayName: providerCalendarId,
    capabilities: { read: true, create: true, update: true, delete: true }, events: []
  }));
  const google: GoogleCalendarAuth = {
    authorizationUrl: vi.fn(async ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    redeem: vi.fn(async () => ({ cache: "private-google-cache", providerAccountId: "google-sub-one" })),
    refresh: vi.fn(async (state) => ({ state: { ...state, cache: "private-google-refreshed-cache" }, accessToken: "private-google-token" }))
  };
  const adapter = new DeterministicFakeCalendarProviderAdapter("google-calendar", "google-sub-one", definitions);
  const gateway = new CalendarProviderGateway([adapter], providerState, { now });
  const service = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => gateway, now, google);
  async function authorized(reconnectConnectionId?: string) {
    const started = await service.start("owner-one", "session-one", reconnectConnectionId, "google");
    return service.callback({ ownerId: "owner-one", sessionId: "session-one", provider: "google", code: "private-google-code",
      state: new URL(started.authorizationUrl).searchParams.get("state")! });
  }
  return { ...h, service, gateway, providerState, adapter, definitions, google, now, authorized };
}

describe("Google authorization through the shared Calendar service", () => {
  it("leaves Google disabled unless configured and requires PostgreSQL plus its exact application HTTPS callback", () => {
    expect(readConfig({ NODE_ENV: "test" }).googleCalendar).toBeUndefined();
    expect(readConfig({ NODE_ENV: "test", LIFE_LINKS_GOOGLE_CALENDAR_ENABLED: "false",
      LIFE_LINKS_GOOGLE_CLIENT_ID: "invalid", LIFE_LINKS_GOOGLE_REDIRECT_URI: "invalid" }).googleCalendar).toBeUndefined();
    expect(() => readConfig({ NODE_ENV: "test", LIFE_LINKS_GOOGLE_CALENDAR_ENABLED: "true" })).toThrow(/PostgreSQL/);
    const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://synthetic.invalid/test", LIFE_LINKS_STORE: "postgres",
      QR_BASE_URL: "https://life-links.example", LIFE_LINKS_GOOGLE_CALENDAR_ENABLED: "true",
      LIFE_LINKS_GOOGLE_CLIENT_ID: "synthetic-client.apps.googleusercontent.com", LIFE_LINKS_GOOGLE_CLIENT_SECRET: "synthetic-private-client-secret",
      LIFE_LINKS_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      LIFE_LINKS_GOOGLE_REDIRECT_URI: "https://life-links.example/api/calendar-providers/google/callback" };
    expect(readConfig(env).googleCalendar).toMatchObject({ clientId: env.LIFE_LINKS_GOOGLE_CLIENT_ID,
      redirectUri: env.LIFE_LINKS_GOOGLE_REDIRECT_URI });
    expect(readConfig(env).microsoftCalendar).toBeUndefined();
    for (const redirect of ["http://life-links.example/api/calendar-providers/google/callback",
      "https://other.example/api/calendar-providers/google/callback", "https://life-links.example/api/calendar-providers/microsoft/callback",
      `${env.LIFE_LINKS_GOOGLE_REDIRECT_URI}?next=foreign`, `${env.LIFE_LINKS_GOOGLE_REDIRECT_URI}#fragment`]) {
      expect(() => readConfig({ ...env, LIFE_LINKS_GOOGLE_REDIRECT_URI: redirect })).toThrow(/callback/);
    }
    for (const invalid of [{ LIFE_LINKS_GOOGLE_CLIENT_ID: "not-a-google-client" }, { LIFE_LINKS_GOOGLE_CLIENT_SECRET: "" },
      { LIFE_LINKS_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }]) {
      expect(() => readConfig({ ...env, ...invalid })).toThrow(/credentials/);
    }
  });

  it("binds Google callback state to its provider, initiating owner and session before redeeming once", async () => {
    const h = googleHarness();
    const started = await h.service.start("owner-one", "session-one", undefined, "google");
    const callback = { ownerId: "owner-one", sessionId: "session-one", provider: "google" as const,
      code: "private-google-code", state: new URL(started.authorizationUrl).searchParams.get("state")! };
    await expect(h.service.callback({ ...callback, provider: "microsoft" })).rejects.toThrow("authorization_failed");
    await expect(h.service.callback({ ...callback, ownerId: "other-owner" })).rejects.toThrow("authorization_not_found");
    await expect(h.service.callback({ ...callback, sessionId: "different-session" })).rejects.toThrow("session_expired");
    await expect(h.service.callback({ ...callback, state: `${callback.state.split(".")[0]}.${"x".repeat(43)}` })).rejects.toThrow("authorization_failed");
    expect(h.google.redeem).not.toHaveBeenCalled();
    const id = await h.service.callback(callback);
    await expect(h.service.callback(callback)).rejects.toThrow("authorization_failed");
    expect(h.google.redeem).toHaveBeenCalledTimes(1);
    const authorize = vi.mocked(h.google.authorizationUrl).mock.calls[0][0];
    expect(authorize.codeChallenge).toMatch(/^[\w-]{43}$/);
    expect(h.google.redeem).toHaveBeenCalledWith({ code: callback.code, nonce: authorize.nonce, codeVerifier: expect.stringMatching(/^[\w-]{64}$/) });
    expect(await h.service.discover("owner-one", "session-one", id)).toMatchObject({ providerKey: "google", providerAccountId: "google-sub-one" });
    expect(h.auth.redeem).not.toHaveBeenCalled();
    expect(JSON.stringify([...h.store.rows.values()])).not.toMatch(/private-google-code|private-google-cache|codeVerifier|google-sub-one/);
    expect(await h.gateway.listConnections("owner-one")).toEqual([]);
  });

  it("selects only discovered Google calendars with default-none access and exact retry identity", async () => {
    const h = googleHarness(); const id = await h.authorized();
    const discover = h.adapter.discover.bind(h.adapter);
    vi.spyOn(h.adapter, "discover").mockImplementation(async (input) => {
      const result = await discover(input);
      return { ...result, calendars: result.calendars.map((calendar) => ({ ...calendar, timeZone: "America/New_York" })) };
    });
    expect((await h.service.discover("owner-one", "session-one", id)).calendars[0].timeZone).toBe("America/New_York");
    await expect(h.service.complete("owner-one", "session-one", id, ["foreign-calendar"])).rejects.toThrow("calendar_selection_invalid");
    expect(await h.gateway.listConnections("owner-one")).toEqual([]);
    const completed = await h.service.complete("owner-one", "session-one", id, ["agent-tests"]);
    expect(completed.connection).toMatchObject({ providerKey: "google-calendar", providerAccountId: "google-sub-one", status: "active" });
    expect(completed.calendars).toHaveLength(1);
    const calendarId = calendarProviderLocalCalendarId(completed.connection.connectionId, "agent-tests");
    expect(completed.calendars[0]).toMatchObject({ providerCalendarId: "agent-tests", calendar: { id: calendarId, agentAccess: "none", timeZone: "America/New_York" } });
    expect((await h.providerState.getCanonicalCalendar(calendarId))?.agentAccess).toBe("none");
    expect(await h.gateway.listCalendars("owner-one", completed.connection.connectionId, "agent")).toEqual([]);
    await expect(h.service.complete("owner-one", "session-one", id, ["agent-tests"])).resolves.toEqual(completed);
    await expect(h.service.complete("owner-one", "session-one", id, ["not-selected"])).rejects.toThrow("calendar_selection_invalid");
    expect(await h.gateway.listConnections("owner-one")).toHaveLength(1);
    expect(await h.gateway.listConnections("other-owner")).toEqual([]);
    expect([...h.store.rows.values()].find((row) => row.purpose === "credential")?.expiresAt).toBeNull();
  });

  it("reconnects only the same Google account without duplicating canonical calendar identity", async () => {
    const h = googleHarness(); const first = await h.service.complete("owner-one", "session-one", await h.authorized(), ["agent-tests"]);
    const connectionId = first.connection.connectionId;
    await expect(h.service.start("owner-one", "session-one", connectionId, "microsoft")).rejects.toThrow("authorization_failed");
    const failedStart = await h.service.start("owner-one", "session-one", connectionId, "google");
    vi.mocked(h.google.redeem).mockResolvedValueOnce({ cache: "private-wrong-account-cache", providerAccountId: "other-google-sub" });
    await expect(h.service.callback({ ownerId: "owner-one", sessionId: "session-one", provider: "google", code: "wrong-account-code",
      state: new URL(failedStart.authorizationUrl).searchParams.get("state")! })).rejects.toThrow("authorization_failed");
    expect((await h.gateway.getConnection("owner-one", connectionId)).status).toBe("active");
    expect([...h.store.rows.values()].filter((row) => row.purpose === "credential")).toHaveLength(1);
    await h.gateway.disconnectConnection({ ownerId: "owner-one", connectionId, localProjectionDisposition: "purge" });
    // The fake adapter's previous grant was revoked. A fresh provider authorization
    // reuses the durable state and the same provider account, like a process reload.
    const adapter = new DeterministicFakeCalendarProviderAdapter("google-calendar", "google-sub-one", h.definitions);
    const discover = adapter.discover.bind(adapter);
    vi.spyOn(adapter, "discover").mockImplementation(async (input) => {
      const result = await discover(input);
      return { ...result, calendars: result.calendars.map((calendar) => ({ ...calendar, timeZone: "America/New_York" })) };
    });
    const gateway = new CalendarProviderGateway([adapter], h.providerState, { now: h.now });
    const restarted = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => gateway, h.now, h.google);
    const started = await restarted.start("owner-one", "session-one", connectionId, "google");
    const id = await restarted.callback({ ownerId: "owner-one", sessionId: "session-one", provider: "google", code: "new-google-code",
      state: new URL(started.authorizationUrl).searchParams.get("state")! });
    const result = await restarted.complete("owner-one", "session-one", id, ["agent-tests"]);
    expect(result.connection).toMatchObject({ connectionId, providerKey: "google-calendar", providerAccountId: "google-sub-one", status: "active" });
    expect(result.calendars[0].calendar.id).toBe(first.calendars[0].calendar.id);
    expect(result.calendars[0].calendar.agentAccess).toBe("none");
    expect(first.calendars[0].calendar.timeZone).toBe("UTC");
    expect(result.calendars[0].calendar).toMatchObject({ ...first.calendars[0].calendar,
      timeZone: "America/New_York", updatedAt: expect.any(String) });
    expect(await gateway.listConnections("owner-one")).toHaveLength(1);
    expect((await h.providerState.getConnection(connectionId))?.credentialHandle).toBe(
      h.cipher.open<{ credentialId: string }>(h.store.rows.get(id)!).credentialId);
  });

  it("refuses cross-provider credential resolution and revocation even when account IDs match", async () => {
    const h = googleHarness(); await h.authorized();
    vi.mocked(h.auth.redeem).mockResolvedValueOnce({ cache: "private-microsoft-cache", homeAccountId: "home-account", localAccountId: "local-account",
      providerAccountId: "google-sub-one", tenantId: "tenant-one" });
    const started = await h.service.start("owner-one", "session-one");
    await h.service.callback({ ownerId: "owner-one", sessionId: "session-one", code: "microsoft-code",
      state: new URL(started.authorizationUrl).searchParams.get("state")! });
    const credentials = [...h.store.rows.values()].filter((row) => row.purpose === "credential");
    expect(credentials).toHaveLength(2);
    for (const credential of credentials) {
      const payload = h.cipher.open<{ provider: string }>(credential);
      const wrongKey = payload.provider === "google" ? "microsoft-graph-calendar" : "google-calendar";
      const input = { credentialHandle: calendarProviderCredentialHandle(credential.id), providerKey: wrongKey };
      await expect(h.service.resolve(input)).rejects.toThrow("authorization_failed");
      await expect(h.service.revoke({ ...input, providerAccountId: "google-sub-one" })).rejects.toThrow("authorization_failed");
      expect(h.store.rows.get(credential.id)).toEqual(credential);
    }
    expect(h.auth.refresh).not.toHaveBeenCalled();
    expect(h.google.refresh).not.toHaveBeenCalled();
    const googleCredential = credentials.find((row) => h.cipher.open<{ provider: string }>(row).provider === "google")!;
    expect(await h.service.resolve({ credentialHandle: calendarProviderCredentialHandle(googleCredential.id), providerKey: "google-calendar" }))
      .toEqual({ accessToken: "private-google-token", providerAccountId: "google-sub-one" });
  });

  it("keeps untagged deployed Microsoft authorization and credential records Microsoft-only across reload", async () => {
    const h = googleHarness();
    const started = await h.service.start("owner-one", "session-one");
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const authorizationRow = h.store.rows.get(state.split(".")[0])!;
    const authorization = h.cipher.open<Record<string, unknown>>(authorizationRow);
    delete authorization.provider;
    h.store.rows.set(authorizationRow.id, { ...authorizationRow, encryptedPayload: h.cipher.seal(authorizationRow, authorization) });
    const restarted = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => h.gateway, h.now, h.google);
    await expect(restarted.callback({ ownerId: "owner-one", sessionId: "session-one", state, code: "legacy-code", provider: "google" }))
      .rejects.toThrow("authorization_failed");
    await restarted.callback({ ownerId: "owner-one", sessionId: "session-one", state, code: "legacy-code" });
    const row = [...h.store.rows.values()].find((entry) => entry.purpose === "credential")!;
    const credential = h.cipher.open<Record<string, unknown>>(row);
    delete credential.provider;
    h.store.rows.set(row.id, { ...row, encryptedPayload: h.cipher.seal(row, credential) });
    const input = { credentialHandle: calendarProviderCredentialHandle(row.id), providerKey: "microsoft-graph-calendar" };
    await expect(restarted.resolve({ ...input, providerKey: "google-calendar" })).rejects.toThrow("authorization_failed");
    await expect(restarted.revoke({ ...input, providerKey: "google-calendar", providerAccountId: "account-one" })).rejects.toThrow("authorization_failed");
    expect(await restarted.resolve(input)).toEqual({ accessToken: "private-test-token", providerAccountId: "account-one" });
    expect(h.auth.refresh).toHaveBeenCalledWith(expect.objectContaining({ homeAccountId: "home-account", tenantId: "tenant-one" }));
    expect(h.cipher.open(h.store.rows.get(row.id)!)).toMatchObject({ provider: "microsoft", cache: "private-refreshed-cache" });
    expect(h.google.refresh).not.toHaveBeenCalled();
    await restarted.revoke({ ...input, providerAccountId: "account-one" });
    expect(h.store.rows.has(row.id)).toBe(false);
  });
});

describe("Calendar authorization and private MSAL cache", () => {
  it("leaves OAuth disabled by default and requires persistent storage and the exact HTTPS callback", () => {
    expect(readConfig({ NODE_ENV: "test" }).microsoftCalendar).toBeUndefined();
    expect(() => readConfig({ NODE_ENV: "test", LIFE_LINKS_MICROSOFT_CALENDAR_ENABLED: "true" })).toThrow(/Postgres|PostgreSQL/);
    const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://synthetic.invalid/test", LIFE_LINKS_STORE: "postgres",
      QR_BASE_URL: "https://life-links.example", LIFE_LINKS_MICROSOFT_CALENDAR_ENABLED: "true",
      LIFE_LINKS_MICROSOFT_CLIENT_ID: "11111111-1111-4111-8111-111111111111", LIFE_LINKS_MICROSOFT_CERTIFICATE_SHA256: "a".repeat(64),
      LIFE_LINKS_MICROSOFT_PRIVATE_KEY_BASE64: Buffer.from("-----BEGIN PRIVATE KEY-----\nsynthetic-test-only").toString("base64"),
      LIFE_LINKS_CALENDAR_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      LIFE_LINKS_MICROSOFT_REDIRECT_URI: "https://life-links.example/api/calendar-providers/microsoft/callback" };
    expect(readConfig(env).microsoftCalendar?.clientId).toBe(env.LIFE_LINKS_MICROSOFT_CLIENT_ID);
    for (const redirect of ["http://life-links.example/api/calendar-providers/microsoft/callback",
      "https://other.example/api/calendar-providers/microsoft/callback", `${env.LIFE_LINKS_MICROSOFT_REDIRECT_URI}?next=foreign`]) {
      expect(() => readConfig({ ...env, LIFE_LINKS_MICROSOFT_REDIRECT_URI: redirect })).toThrow(/callback/);
    }
  });

  it("provisions real canonical calendar identities and closes a partial completion before cancelling", async () => {
    const h = harness();
    const providerState = new InMemoryCalendarProviderStateStore();
    const adapter = new DeterministicFakeCalendarProviderAdapter("microsoft-graph-calendar", "account-one", [{
      providerCalendarId: "agent-tests", displayName: "Agent Tests", capabilities: { read: true, create: true, update: true, delete: true }, events: []
    }]);
    const gateway = new CalendarProviderGateway([adapter], providerState);
    const service = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => gateway);
    const started = await service.start("owner-one", "session-one");
    const id = await service.callback({ ownerId: "owner-one", sessionId: "session-one", code: "test-code",
      state: new URL(started.authorizationUrl).searchParams.get("state")! });
    const originalRead = gateway.listManagedCalendars.bind(gateway);
    vi.spyOn(gateway, "listManagedCalendars").mockRejectedValueOnce(new Error("synthetic-response-failure"));
    await expect(service.complete("owner-one", "session-one", id, ["agent-tests"])).rejects.toThrow("synthetic-response-failure");
    const connection = (await gateway.listConnections("owner-one"))[0];
    const calendars = await originalRead("owner-one", connection.connectionId);
    expect(calendars[0].calendar.id).toMatch(/^calendar-[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(calendars[0].calendar.agentAccess).toBe("none");
    await service.cancel("owner-one", "session-one", id);
    expect((await gateway.getConnection("owner-one", connection.connectionId)).status).toBe("disconnected");
    expect((await originalRead("owner-one", connection.connectionId))[0].calendar.agentAccess).toBe("none");
  });

  it.each(["retry", "cancel"] as const)("pins a partial reconnect selection while allowing the same selection to %s", async (resolution) => {
    const h = harness();
    const now = () => new Date("2026-09-02T12:34:00Z");
    const providerState = new InMemoryCalendarProviderStateStore();
    const definitions = ["existing", "selected-a", "selected-b"].map((providerCalendarId) => ({
      providerCalendarId, displayName: providerCalendarId, capabilities: { read: true, create: true, update: true, delete: true }, events: []
    }));
    const previousAdapter = new DeterministicFakeCalendarProviderAdapter("microsoft-graph-calendar", "account-one", definitions);
    const previousGateway = new CalendarProviderGateway([previousAdapter], providerState, { now });
    const connectionId = "11111111-1111-4111-8111-111111111111";
    const initialWindow = { startUtc: "2026-09-01T00:00:00Z", endUtc: "2026-09-03T00:00:00Z" };
    await previousGateway.connectExternalAccount({ ownerId: "owner-one", connectionId,
      providerKey: "microsoft-graph-calendar", expectedProviderAccountId: "account-one",
      credentialHandle: calendarProviderCredentialHandle("previous-credential"), initialWindow,
      calendars: [{ calendarId: calendarProviderLocalCalendarId(connectionId, "existing"), providerCalendarId: "existing",
        title: "Existing", color: "#4f8fbd", timeZone: "UTC", isDefault: false, agentGrant: "none" }] });
    await previousGateway.disconnectConnection({ ownerId: "owner-one", connectionId, localProjectionDisposition: "purge" });

    // Reconnect with a fresh fake authorization, retaining the real canonical store.
    const adapter = new DeterministicFakeCalendarProviderAdapter("microsoft-graph-calendar", "account-one", definitions);
    adapter.externalCreate("selected-a", "event-a", { title: "Selected event", description: null, location: null, status: "confirmed", providerSeriesId: null,
      span: { kind: "timed", startUtc: "2026-09-02T14:00:00Z", endUtc: "2026-09-02T15:00:00Z",
        sourceTimeZone: "UTC", floatingLocalStart: null, floatingLocalEnd: null } });
    const gateway = new CalendarProviderGateway([adapter], providerState, { now });
    const service = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => gateway, now);
    const started = await service.start("owner-one", "session-one", connectionId);
    const id = await service.callback({ ownerId: "owner-one", sessionId: "session-one", code: "test-code",
      state: new URL(started.authorizationUrl).searchParams.get("state")! });
    const fetchChanges = adapter.fetchChanges.bind(adapter);
    let failSelection = true;
    vi.spyOn(adapter, "fetchChanges").mockImplementation(async (input) => {
      if (input.providerCalendarId === "selected-a" && failSelection) {
        failSelection = false;
        throw new Error("synthetic-selection-sync-failure");
      }
      return fetchChanges(input);
    });
    await expect(service.complete("owner-one", "session-one", id, ["selected-a"])).rejects.toThrow("synthetic-selection-sync-failure");
    const selectedId = calendarProviderLocalCalendarId(connectionId, "selected-a");
    expect((await providerState.listCalendars(connectionId)).map((entry) => entry.providerCalendarId)).toEqual(["existing", "selected-a"]);
    expect(await providerState.listProjections(connectionId, selectedId)).toHaveLength(0);

    // A fresh service must enforce the committed selection, not process-local state.
    const restarted = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => gateway, now);
    await expect(restarted.complete("owner-one", "session-one", id, ["selected-b"])).rejects.toThrow("calendar_selection_invalid");
    expect((await providerState.listCalendars(connectionId)).map((entry) => entry.providerCalendarId)).toEqual(["existing", "selected-a"]);
    if (resolution === "retry") {
      const completed = await restarted.complete("owner-one", "session-one", id, ["selected-a"]);
      expect(completed.connection.status).toBe("active");
      expect(completed.calendars).toHaveLength(2);
      expect((await gateway.listProjections("owner-one", connectionId, selectedId)).map((entry) => entry.providerEventId)).toEqual(["event-a"]);
      await expect(restarted.complete("owner-one", "session-one", id, ["selected-a"])).resolves.toEqual(completed);
      expect([...h.store.rows.values()].find((row) => row.purpose === "credential")?.expiresAt).toBeNull();
    } else {
      await restarted.cancel("owner-one", "session-one", id);
      expect((await gateway.getConnection("owner-one", connectionId)).status).toBe("disconnected");
      expect(h.store.rows.size).toBe(0);
      expect(await providerState.listProjections(connectionId, selectedId)).toHaveLength(0);
    }
  });

  it("keeps HTTP initiation and selection human/session-only and strips credentials from callback redirects and logs", async () => {
    const h = harness(); const app = express(); const logs: unknown[] = [];
    app.use(express.json());
    app.use(createCalendarConnectionRouter({ gateway: h.gateway as unknown as CalendarProviderGateway,
      authorization: h.service, ownerId: (req) => req.get("X-Test-Owner") ?? null,
      sessionIdentity: (req) => req.get("X-Test-Session") ?? null,
      requireAuthenticated(req, res, next) { if (!req.get("X-Test-Owner")) { res.sendStatus(401); return; } next(); },
      logger: createLogger("calendar_auth_test", { sink: (event) => logs.push(event) }) }));
    const endpoint = "/api/calendar-providers/microsoft/authorize";
    expect((await request(app).post(endpoint).send({})).status).toBe(401);
    expect((await request(app).post(endpoint).set("X-Test-Owner", "owner-one").send({})).body.error).toBe("session_expired");
    const denied = await request(app).post(endpoint).set("X-Test-Owner", "owner-one").set("X-Test-Session", "session-one")
      .set("X-Life-Links-Actor", "agent").send({});
    expect(denied.status).toBe(403);
    const started = await request(app).post(endpoint).set("X-Test-Owner", "owner-one").set("X-Test-Session", "session-one").send({});
    expect(started.status).toBe(200); expect(started.headers["cache-control"]).toBe("no-store");
    const state = new URL(started.body.authorizationUrl).searchParams.get("state")!;
    const callback = await request(app).get("/api/calendar-providers/microsoft/callback")
      .set("X-Test-Owner", "owner-one").set("X-Test-Session", "session-one").query({ state, code: "private-test-code" });
    expect(callback.status).toBe(303); expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    const id = new URL(callback.headers.location, "https://life-links.example").searchParams.get("calendarAuthorization");
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const select = await request(app).post(`/api/calendar-authorizations/${id}/complete`)
      .set("X-Test-Owner", "owner-one").set("X-Test-Session", "session-one").set("X-Life-Links-Actor", "agent")
      .send({ selectedCalendarIds: ["agent-tests"] });
    expect(select.status).toBe(403); expect(h.gateway.connectExternalAccount).not.toHaveBeenCalled();
    const replay = await request(app).get("/api/calendar-providers/microsoft/callback")
      .set("X-Test-Owner", "owner-one").set("X-Test-Session", "session-one").query({ state, code: "private-test-code" });
    expect(replay.headers.location).toBe("/calendar?calendarConnectionError=authorization_failed");
    const loggedOut = await request(app).get("/api/calendar-providers/microsoft/callback").query({ state, code: "private-test-code" });
    expect(loggedOut.headers.location).toBe("/calendar?calendarConnectionError=session_expired");
    expect(JSON.stringify({ headers: callback.headers, logs })).not.toMatch(/private-test-code|private-test-cache|private-test-token/);
  });

  it("binds authenticated encryption to owner, identity and purpose and never stores cache plaintext", async () => {
    const h = harness();
    const id = await h.authorized();
    const rows = [...h.store.rows.values()];
    expect(JSON.stringify(rows)).not.toMatch(/private-test-cache|one-use-test-code|codeVerifier|home-account/);
    const credential = rows.find((row) => row.purpose === "credential")!;
    expect(() => h.cipher.open({ ...credential, ownerId: "owner-two" })).toThrow("unavailable");
    expect(() => h.cipher.open({ ...credential, id })).toThrow("unavailable");
    expect(() => h.cipher.open({ ...credential, purpose: "authorization" })).toThrow("unavailable");
    expect(() => h.cipher.open({ ...credential, encryptedPayload: credential.encryptedPayload.slice(0, -5) })).toThrow("unavailable");
  });

  it("validates PKCE/state, exact initiating owner/session, expiry and callback replay", async () => {
    const h = harness();
    const { captured, result } = await h.start();
    expect(captured.codeChallenge).toMatch(/^[\w-]{43}$/);
    expect(result).toEqual({ authorizationUrl: expect.stringContaining("https://login.microsoftonline.com/") });
    const callback = { ownerId: "owner-one", sessionId: "session-one", state: captured.state, code: "test-code" };
    await expect(h.service.callback({ ...callback, ownerId: "other-owner" })).rejects.toThrow("authorization_not_found");
    await expect(h.service.callback({ ...callback, sessionId: "new-session" })).rejects.toThrow("session_expired");
    await expect(h.service.callback({ ...callback, state: `${captured.state.split(".")[0]}.${"x".repeat(43)}` })).rejects.toThrow("authorization_failed");
    const id = await h.service.callback(callback);
    await expect(h.service.callback(callback)).rejects.toThrow("authorization_failed");
    expect(h.auth.redeem).toHaveBeenCalledTimes(1);
    await expect(h.service.discover("other-owner", "session-one", id)).rejects.toThrow("authorization_not_found");
    h.advance(31 * 60_000);
    await expect(h.service.discover("owner-one", "session-one", id)).rejects.toThrow("session_expired");
    await h.store.deleteExpired("2026-09-02T13:20:00Z");
    expect(h.store.rows.size).toBe(0);
  });

  it("consumes cancellation and failed redemption without connecting or retaining tokens", async () => {
    const h = harness();
    const { captured } = await h.start();
    const request = { ownerId: "owner-one", sessionId: "session-one", state: captured.state, error: "access_denied" };
    await expect(h.service.callback(request)).rejects.toThrow("cancelled");
    await expect(h.service.callback({ ...request, error: undefined, code: "test-code" })).rejects.toThrow("authorization_failed");
    expect(h.auth.redeem).not.toHaveBeenCalled();
    expect(h.gateway.connectExternalAccount).not.toHaveBeenCalled();
    const retry = await h.start();
    vi.mocked(h.auth.redeem).mockRejectedValueOnce(new Error("private-provider-error"));
    await expect(h.service.callback({ ownerId: "owner-one", sessionId: "session-one", state: retry.captured.state, code: "test" })).rejects.toThrow(/^authorization_failed$/);
    expect([...h.store.rows.values()].filter((row) => row.purpose === "credential")).toHaveLength(0);
  });

  it("selects discovered IDs with default-deny access and makes completion retry-safe", async () => {
    const h = harness(); const id = await h.authorized();
    await expect(h.service.complete("owner-one", "session-one", id, ["wrong-calendar"])).rejects.toThrow("calendar_selection_invalid");
    await h.service.complete("owner-one", "session-one", id, ["agent-tests"]);
    await h.service.complete("owner-one", "session-one", id, ["agent-tests"]);
    expect(h.gateway.connectExternalAccount).toHaveBeenCalledTimes(1);
    const command = vi.mocked(h.gateway.connectExternalAccount).mock.calls[0] as unknown as [{ calendars: Array<{ agentGrant: string; providerCalendarId: string }> }];
    expect(command[0].calendars[0]).toMatchObject({ agentGrant: "none", providerCalendarId: "agent-tests" });
    expect([...h.store.rows.values()].find((row) => row.purpose === "credential")?.expiresAt).toBeNull();
  });

  it("serializes refresh, preserves cache across service reload, and deletes only exact credentials", async () => {
    const h = harness(); await h.authorized();
    const credential = [...h.store.rows.values()].find((row) => row.purpose === "credential")!;
    const input = { credentialHandle: calendarProviderCredentialHandle(credential.id), providerKey: "microsoft-graph-calendar" };
    await h.service.resolve(input);
    const restarted = new CalendarAuthorizationService(h.store, h.cipher, h.auth, () => h.gateway as unknown as CalendarProviderGateway, () => new Date("2026-09-02T12:35:00Z"));
    expect(await restarted.resolve(input)).toEqual({ accessToken: "private-test-token", providerAccountId: "account-one" });
    expect(h.auth.refresh).toHaveBeenLastCalledWith(expect.objectContaining({ cache: "private-refreshed-cache" }));
    await expect(restarted.revoke({ ...input, providerAccountId: "other-account" })).rejects.toThrow("authorization_failed");
    expect(h.store.rows.has(credential.id)).toBe(true);
    await restarted.revoke({ ...input, providerAccountId: "account-one" });
    await restarted.revoke({ ...input, providerAccountId: "account-one" });
    expect(h.store.rows.has(credential.id)).toBe(false);
    await expect(restarted.resolve(input)).rejects.toThrow("authorization_failed");
  });

  it("carries renewal evidence only on the resolved credential, never into persisted state", async () => {
    const h = harness(); await h.authorized();
    const credential = [...h.store.rows.values()].find((row) => row.purpose === "credential")!;
    vi.mocked(h.auth.refresh).mockImplementationOnce(async (state) => ({ state, accessToken: "private-test-token", renewedAccessToken: true }));
    const resolved = await h.service.resolve({ credentialHandle: calendarProviderCredentialHandle(credential.id), providerKey: "microsoft-graph-calendar" });
    expect(resolved.renewedAccessToken).toBe(true);
    expect(h.cipher.open(h.store.rows.get(credential.id)!)).not.toHaveProperty("renewedAccessToken");
    expect(await h.service.resolve({ credentialHandle: calendarProviderCredentialHandle(credential.id), providerKey: "microsoft-graph-calendar" }))
      .not.toHaveProperty("renewedAccessToken");
  });

  it("requires reconnect to match the original Microsoft account", async () => {
    const h = harness();
    await h.service.start("owner-one", "session-one", "connection-one");
    vi.mocked(h.gateway.getConnection).mockResolvedValueOnce({ connectionId: "connection-one", providerAccountId: "different-account", providerKey: "microsoft-graph-calendar" });
    const result = await h.service.start("owner-one", "session-one", "connection-one");
    const state = new URL(result.authorizationUrl).searchParams.get("state")!;
    await expect(h.service.callback({ ownerId: "owner-one", sessionId: "session-one", state, code: "test" })).rejects.toThrow("authorization_failed");
    expect([...h.store.rows.values()].filter((row) => row.purpose === "credential")).toHaveLength(0);
  });
});

describe("MSAL passive renewal observation", () => {
  const state = { cache: "private-original-cache", homeAccountId: "home-account", localAccountId: "local-account",
    tenantId: "tenant-one", providerAccountId: "account-one" };
  const config = { clientId: "client-one", redirectUri: "https://life-links.example/callback",
    certificateThumbprint: "a".repeat(64), certificatePrivateKey: "private-certificate-fixture" };

  it.each([
    { name: "cache hit", exchange: false, fromCache: true, status: 200, grantType: "refresh_token", expected: false },
    { name: "renewed returned credential", exchange: true, fromCache: false, status: 200, grantType: "refresh_token", expected: true },
    { name: "proactive refresh returning old cache", exchange: true, fromCache: true, status: 200, grantType: "refresh_token", expected: false },
    { name: "authorization-code exchange", exchange: true, fromCache: false, status: 200, grantType: "authorization_code", expected: false },
    { name: "failed refresh exchange", exchange: true, fromCache: false, status: 400, grantType: "refresh_token", expected: false }
  ])("distinguishes $name without changing silent acquisition", async (scenario) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(scenario.status === 200
      ? { access_token: "private-provider-bearer" } : { error: "invalid_grant" }), { status: scenario.status }));
    vi.stubGlobal("fetch", fetcher);
    msal.acquireTokenSilent.mockReset().mockImplementation(async () => {
      if (scenario.exchange) await msal.config.system.networkClient.sendPostRequestAsync(
        "https://login.microsoftonline.com/tenant-one/oauth2/v2.0/token",
        { body: `grant_type=${scenario.grantType}&refresh_token=private-refresh-fixture&client_assertion=private-assertion-fixture` });
      return { account: { homeAccountId: "home-account" }, uniqueId: "local-account", tenantId: "tenant-one",
        accessToken: "private-provider-bearer", fromCache: scenario.fromCache };
    });
    try {
      const result = await new MsalMicrosoftCalendarAuth(config).refresh(state);
      expect(result.renewedAccessToken === true).toBe(scenario.expected);
      expect(result.state).not.toHaveProperty("renewedAccessToken");
      expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ account: { homeAccountId: "home-account", tenantId: "tenant-one" },
        scopes: ["https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Calendars.ReadWrite"] });
      expect(fetcher).toHaveBeenCalledTimes(scenario.exchange ? 1 : 0);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["wrong_account", "malformed_response", "network_failure"])("does not certify %s", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (failure === "network_failure") throw new Error("private-provider-error");
      return new Response(failure === "malformed_response" ? "not-json" : JSON.stringify({ access_token: "private-provider-bearer" }));
    }));
    msal.acquireTokenSilent.mockReset().mockImplementation(async () => {
      await msal.config.system.networkClient.sendPostRequestAsync("https://login.microsoftonline.com/tenant-one/oauth2/v2.0/token",
        { body: "grant_type=refresh_token&refresh_token=private-refresh-fixture" });
      return { account: { homeAccountId: "other-account" }, uniqueId: "local-account", tenantId: "tenant-one",
        accessToken: "private-provider-bearer", fromCache: false };
    });
    try { await expect(new MsalMicrosoftCalendarAuth(config).refresh(state)).rejects.toThrow("Microsoft calendar authorization needs reconnection."); }
    finally { vi.unstubAllGlobals(); }
  });
});
