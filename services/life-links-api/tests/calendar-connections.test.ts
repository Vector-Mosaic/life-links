import express, { type Request } from "express";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createCalendarConnectionRouter } from "../src/calendar-connections.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, calendarProviderCredentialHandle, calendarProviderLocalCalendarId } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { CalendarAuthorizationService } from "../src/calendar-authorization.js";
import { CalendarSecretCipher, InMemoryCalendarSecretStore } from "../src/calendar-secret-store.js";
import type { GoogleCalendarAuth } from "../src/calendar-google-auth.js";

const ownerId = "synthetic-calendar-owner";
const connectionId = "synthetic-connection-one";
const providerCalendarId = "synthetic-provider-calendar";
const calendarId = calendarProviderLocalCalendarId(connectionId, providerCalendarId);
const vaultHandle = "synthetic-private-vault-handle-must-not-leak";
const writable = { read: true, create: true, update: true, delete: true };

async function fixture(options: { readOnly?: boolean; adapterAvailable?: boolean; googleAuthorization?: boolean; additionalCalendar?: boolean } = {}) {
  const store = new InMemoryCalendarProviderStateStore();
  const adapter = new DeterministicFakeCalendarProviderAdapter("google-calendar", "synthetic-provider-account", [{
    providerCalendarId, displayName: "Synthetic calendar", capabilities: options.readOnly
      ? { read: true, create: false, update: false, delete: false } : writable,
    events: [{ providerEventId: "synthetic-event", providerRevision: "revision-one", content: {
      title: "Synthetic event", description: null, location: null, status: "confirmed", providerSeriesId: null,
      span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" }
    } }]
  }, ...(options.additionalCalendar ? [{ providerCalendarId: "additional-calendar", displayName: "Additional calendar", capabilities: writable, events: [] }] : [])]);
  const connectedGateway = new CalendarProviderGateway([adapter], store, { now: () => new Date("2026-09-01T12:00:00.000Z") });
  await connectedGateway.connectExternalAccount({
    ownerId, connectionId, providerKey: "google-calendar", expectedProviderAccountId: "synthetic-provider-account",
    credentialHandle: calendarProviderCredentialHandle(vaultHandle),
    calendars: [{ calendarId, providerCalendarId, title: "Connected calendar", color: "#123456", timeZone: "UTC", isDefault: false }],
    initialWindow: { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-09-03T00:00:00.000Z" }
  });
  const gateway = options.adapterAvailable === false
    ? new CalendarProviderGateway([], store, { now: () => new Date("2026-09-01T12:00:00.000Z") })
    : connectedGateway;
  const app = express();
  const logs: LogEvent[] = [];
  app.use(express.json());
  app.use((_req, res, next) => { res.setHeader("X-Request-Id", "synthetic-calendar-request"); next(); });
  const selectedOwner = (req: Request) => req.get("X-Test-Owner") ?? null;
  const google: GoogleCalendarAuth = {
    authorizationUrl: vi.fn(async ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    redeem: vi.fn(async () => ({ cache: "private-google-test-cache", providerAccountId: "synthetic-provider-account" })),
    refresh: vi.fn(async (state) => ({ state, accessToken: "private-google-test-token" }))
  };
  const secretStore = new InMemoryCalendarSecretStore();
  const authorization = options.googleAuthorization ? new CalendarAuthorizationService(secretStore,
    new CalendarSecretCipher(randomBytes(32).toString("base64")), undefined, () => gateway,
    () => new Date("2026-09-01T12:00:00.000Z"), google) : undefined;
  app.use(createCalendarConnectionRouter({
    gateway, ownerId: selectedOwner, authorization,
    sessionIdentity: (req) => req.get("X-Test-Session") ?? null,
    requireAuthenticated(req, res, next) {
      if (!selectedOwner(req)) { res.status(401).json({ error: "authentication_required" }); return; }
      next();
    },
    logger: createLogger("calendar_connection_test", { sink: (event) => logs.push(event) })
  }));
  return { app, store, gateway, adapter, logs, google, secretStore };
}

const basePath = `/api/calendar-connections/${connectionId}`;

describe("owner Calendar connection management", () => {
  it("removes one local external Calendar, permits exact retry and preserves the provider original", async () => {
    const { app, gateway, store, adapter } = await fixture();
    const view = (await gateway.listManagedCalendars(ownerId, connectionId))[0];
    const headers = { "X-Test-Owner": ownerId };
    const endpoint = `${basePath}/calendars/${calendarId}`;
    expect((await request(app).delete(endpoint).set(headers).send({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
    for (let retry = 0; retry < 2; retry += 1) {
      expect((await request(app).delete(endpoint).set(headers).send({ expectedUpdatedAt: view.calendar.updatedAt })).status).toBe(204);
    }
    expect((await request(app).get(`${basePath}/calendars`).set(headers)).body.calendars).toEqual([]);
    expect((await request(app).get("/api/calendar-connections").set(headers)).body.connections).toHaveLength(1);
    expect(await store.listProjections(connectionId, calendarId)).toEqual([]);
    expect(adapter.metrics().commandApplies).toEqual({ create: 0, update: 0, delete: 0 });
    expect((await adapter.readEvent({ credentialHandle: calendarProviderCredentialHandle(vaultHandle),
      providerAccountId: "synthetic-provider-account", providerCalendarId, providerEventId: "synthetic-event" })).content.title).toBe("Synthetic event");
  });

  it.each([false, true])("removes an account locally after exact cleanup (already disconnected: %s)", async (disconnected) => {
    const { app, gateway, adapter } = await fixture();
    const connection = await gateway.getConnection(ownerId, connectionId);
    if (disconnected) await gateway.disconnectConnection({ ownerId, connectionId, localProjectionDisposition: "purge" });
    const headers = { "X-Test-Owner": ownerId };
    const body = { expectedConnectedAt: connection.connectedAt };
    expect((await request(app).delete(basePath).set(headers).send({ expectedConnectedAt: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
    expect((await request(app).delete(basePath).set(headers).send(body)).status).toBe(204);
    expect((await request(app).delete(basePath).set(headers).send(body)).status).toBe(204);
    expect((await request(app).get("/api/calendar-connections").set(headers)).body.connections).toEqual([]);
    expect(adapter.metrics().commandApplies).toEqual({ create: 0, update: 0, delete: 0 });
    expect(adapter.metrics().revokeCalls).toBe(1);
  });

  it.each(["account", "calendar"])("keeps %s removal owner-only with a closed exact-revision grammar", async (kind) => {
    const { app, gateway, adapter } = await fixture();
    const connection = await gateway.getConnection(ownerId, connectionId);
    const view = (await gateway.listManagedCalendars(ownerId, connectionId))[0];
    const endpoint = kind === "account" ? basePath : `${basePath}/calendars/${calendarId}`;
    const body = kind === "account" ? { expectedConnectedAt: connection.connectedAt } : { expectedUpdatedAt: view.calendar.updatedAt };
    expect((await request(app).delete(endpoint).send(body)).status).toBe(401);
    expect((await request(app).delete(endpoint).set("X-Test-Owner", "other-owner").send(body)).status).toBe(404);
    expect((await request(app).delete(endpoint).set("X-Test-Owner", ownerId).set("X-Life-Links-Actor", "agent").send(body)).status).toBe(403);
    expect((await request(app).delete(endpoint).set("X-Test-Owner", ownerId).send({ ...body, deleteAtProvider: true })).status).toBe(400);
    expect((await gateway.listManagedCalendars(ownerId, connectionId))).toHaveLength(1);
    expect(adapter.metrics().revokeCalls).toBe(0);
  });

  it("enriches active account email through normal refresh and exposes it only to the owner manager", async () => {
    const { app, gateway, adapter, logs } = await fixture({ googleAuthorization: true });
    const discover = adapter.discover.bind(adapter);
    const accountEmail = "private-owner@example.test";
    const observed = vi.spyOn(adapter, "discover").mockImplementation(async (input) => ({ ...await discover(input), accountEmail }));
    const headers = { "X-Test-Owner": ownerId };
    expect((await gateway.getConnection(ownerId, connectionId)).accountEmail).toBeUndefined();
    const refresh = await request(app).post(`${basePath}/refresh`).set(headers).send({});
    expect(refresh.status).toBe(200);
    expect(refresh.body).toEqual({ refreshed: true });
    const listed = await request(app).get("/api/calendar-connections").set(headers);
    expect(listed.body.connections[0]).toMatchObject({ providerAccountId: "synthetic-provider-account", accountEmail });
    const discovery = await request(app).get(`${basePath}/available-calendars`).set(headers);
    expect(discovery.body.accountEmail).toBe(accountEmail);
    expect((await request(app).get("/api/calendar-connections").set({ "X-Test-Owner": "other-owner" })).body.connections).toEqual([]);
    expect((await request(app).get("/api/calendar-connections").set(headers).set("X-Life-Links-Actor", "agent")).status).toBe(403);
    expect(JSON.stringify(logs)).not.toContain(accountEmail);
    await gateway.disconnectConnection({ ownerId, connectionId, localProjectionDisposition: "purge" });
    const calls = observed.mock.calls.length;
    const disconnected = await request(app).get("/api/calendar-connections").set(headers);
    expect(disconnected.body.connections[0]).toMatchObject({ status: "disconnected", accountEmail });
    expect(observed).toHaveBeenCalledTimes(calls);
  });

  it("refreshes supplied provider timezone on existing selection without resetting settings or inventing missing metadata", async () => {
    const { app, gateway, adapter } = await fixture({ googleAuthorization: true });
    const initial = (await gateway.listManagedCalendars(ownerId, connectionId))[0];
    const before = await gateway.updateCalendarSettings({ ownerId, connectionId, calendarId,
      expectedUpdatedAt: initial.calendar.updatedAt, patch: { visible: false, agentAccess: "write" } });
    const discover = adapter.discover.bind(adapter);
    let timeZone: string | undefined = "America/New_York";
    vi.spyOn(adapter, "discover").mockImplementation(async (input) => {
      const result = await discover(input);
      return { ...result, calendars: result.calendars.map((calendar) => ({ ...calendar, ...(timeZone === undefined ? {} : { timeZone }) })) };
    });
    const headers = { "X-Test-Owner": ownerId };
    expect((await request(app).get(`${basePath}/available-calendars`).set(headers)).body.calendars[0].timeZone).toBe(timeZone);
    const selected = await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId] });
    expect(selected.status).toBe(200);
    expect(selected.body.calendars[0]).toEqual({ ...before,
      calendar: { ...before.calendar, timeZone, updatedAt: expect.any(String) } });
    const updated = selected.body.calendars[0];
    expect(updated.calendar.updatedAt).not.toBe(before.calendar.updatedAt);
    expect((await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId] })).body.calendars[0]).toEqual(updated);
    timeZone = undefined;
    expect((await request(app).get(`${basePath}/available-calendars`).set(headers)).body.calendars[0]).not.toHaveProperty("timeZone");
    expect((await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId] })).body.calendars[0]).toEqual(updated);
    timeZone = "not-a-time-zone";
    expect((await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId] })).status).toBe(400);
    expect((await gateway.listManagedCalendars(ownerId, connectionId))[0]).toEqual(updated);
  });

  it.each([undefined, "write"] as const)("routes Google OAuth through owner/session selection with chosen/default access %s", async (grant) => {
    const { app, store, gateway, google, secretStore, logs } = await fixture({ googleAuthorization: true });
    const headers = { "X-Test-Owner": ownerId, "X-Test-Session": "google-session" };
    const endpoint = "/api/calendar-providers/google/authorize";
    const providers = await request(app).get("/api/calendar-providers").set(headers);
    expect(providers.body.providers).toEqual([
      { providerKey: "google", displayName: "Google Calendar", authorizationAvailable: true },
      { providerKey: "microsoft", displayName: "Microsoft Outlook", authorizationAvailable: false, reason: "authorization_not_configured" }
    ]);
    expect((await request(app).post(endpoint).send({})).status).toBe(401);
    expect((await request(app).post(endpoint).set("X-Test-Owner", ownerId).send({})).body.error).toBe("session_expired");
    expect((await request(app).post(endpoint).set(headers).set("X-Life-Links-Actor", "agent").send({})).status).toBe(403);
    expect(google.authorizationUrl).not.toHaveBeenCalled();
    const started = await request(app).post(endpoint).set(headers).send({});
    expect(started.status).toBe(200);
    expect(started.headers["cache-control"]).toBe("no-store");
    const state = new URL(started.body.authorizationUrl).searchParams.get("state")!;
    const callbackQuery = { state, code: "private-google-test-code" };
    const wrongProvider = await request(app).get("/api/calendar-providers/microsoft/callback").set(headers).query(callbackQuery);
    expect(wrongProvider.headers.location).toBe("/calendar?calendarConnectionError=authorization_failed");
    const wrongSession = await request(app).get("/api/calendar-providers/google/callback").set(headers)
      .set("X-Test-Session", "other-session").query(callbackQuery);
    expect(wrongSession.headers.location).toBe("/calendar?calendarConnectionError=session_expired");
    expect(google.redeem).not.toHaveBeenCalled();
    const callback = await request(app).get("/api/calendar-providers/google/callback").set(headers).query(callbackQuery);
    expect(callback.status).toBe(303);
    expect(callback.headers["referrer-policy"]).toBe("no-referrer");
    const id = new URL(callback.headers.location, "https://life-links.example").searchParams.get("calendarAuthorization")!;
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    const selectionPath = `/api/calendar-authorizations/${id}`;
    const discovery = await request(app).get(`${selectionPath}/calendars`).set(headers);
    expect(discovery.body).toMatchObject({ providerKey: "google", providerAccountId: "synthetic-provider-account",
      calendars: [{ providerCalendarId, displayName: "Synthetic calendar" }] });
    expect((await request(app).post(`${selectionPath}/complete`).set(headers).set("X-Life-Links-Actor", "agent")
      .send({ selectedCalendarIds: [providerCalendarId] })).status).toBe(403);
    expect((await request(app).post(`${selectionPath}/complete`).set(headers)
      .send({ selectedCalendarIds: [providerCalendarId], agentAccess: "write" })).status).toBe(400);
    expect((await request(app).post(`${selectionPath}/complete`).set(headers)
      .send({ selectedCalendarIds: ["not-discovered"] })).body.error).toBe("calendar_selection_invalid");
    for (const agentAccessByCalendarId of [{}, { [providerCalendarId]: "write", foreign: "none" }, { [providerCalendarId]: "owner" }]) {
      expect((await request(app).post(`${selectionPath}/complete`).set(headers)
        .send({ selectedCalendarIds: [providerCalendarId], agentAccessByCalendarId })).body.error).toBe("calendar_selection_invalid");
    }
    const selection = { selectedCalendarIds: [providerCalendarId],
      ...(grant === undefined ? {} : { agentAccessByCalendarId: { [providerCalendarId]: grant } }) };
    const complete = await request(app).post(`${selectionPath}/complete`).set(headers).send(selection);
    expect(complete.status).toBe(200);
    expect(complete.body.connection).toMatchObject({ providerKey: "google-calendar", status: "active" });
    expect(complete.body.calendars).toHaveLength(1);
    const selectedCalendar = complete.body.calendars[0].calendar;
    expect(selectedCalendar.agentAccess).toBe(grant ?? "none");
    expect((await store.getCanonicalCalendar(selectedCalendar.id))?.agentAccess).toBe(grant ?? "none");
    expect(await gateway.listCalendars(ownerId, complete.body.connection.connectionId, "agent")).toHaveLength(grant ? 1 : 0);
    const available = await request(app).get(`/api/calendar-connections/${complete.body.connection.connectionId}/available-calendars`).set(headers);
    expect(available.status).toBe(200);
    expect(available.body.providerKey).toBe("google");
    const retry = await request(app).post(`${selectionPath}/complete`).set(headers).send(selection);
    expect(retry.body).toEqual(complete.body);
    expect([...secretStore.rows.values()].filter((row) => row.purpose === "credential")).toHaveLength(1);
    const replay = await request(app).get("/api/calendar-providers/google/callback").set(headers).query(callbackQuery);
    expect(replay.headers.location).toBe("/calendar?calendarConnectionError=authorization_failed");
    expect(google.redeem).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ complete: complete.body, discovery: discovery.body, headers: callback.headers, logs,
      rows: [...secretStore.rows.values()] })).not.toMatch(/private-google-test-code|private-google-test-cache|private-google-test-token|credentialHandle/);
  });

  it("does not let additional selection change an existing grant, exceed capabilities, or accept foreign map keys", async () => {
    const { app, gateway } = await fixture({ googleAuthorization: true, readOnly: true });
    const headers = { "X-Test-Owner": ownerId };
    for (const agentAccessByCalendarId of [{ foreign: "read" }, {}]) {
      expect((await request(app).post(`${basePath}/select`).set(headers)
        .send({ selectedCalendarIds: [providerCalendarId], agentAccessByCalendarId })).body.error).toBe("calendar_selection_invalid");
    }
    expect((await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId],
      agentAccessByCalendarId: { [providerCalendarId]: "write" } })).status).toBe(400);
    expect((await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId],
      agentAccessByCalendarId: { [providerCalendarId]: "read" } })).status).toBe(409);
    const exact = await request(app).post(`${basePath}/select`).set(headers).send({ selectedCalendarIds: [providerCalendarId],
      agentAccessByCalendarId: { [providerCalendarId]: "none" } });
    expect(exact.status).toBe(200);
    expect((await gateway.listManagedCalendars(ownerId, connectionId))[0].calendar.agentAccess).toBe("none");
  });

  it("adds another calendar with chosen access through the same HTTP selection without changing the existing one", async () => {
    const { app, gateway } = await fixture({ googleAuthorization: true, additionalCalendar: true });
    const selected = await request(app).post(`${basePath}/select`).set("X-Test-Owner", ownerId).send({
      selectedCalendarIds: ["additional-calendar"], agentAccessByCalendarId: { "additional-calendar": "write" }
    });
    expect(selected.status).toBe(200);
    const calendars = await gateway.listManagedCalendars(ownerId, connectionId);
    expect(calendars.find((entry) => entry.providerCalendarId === "additional-calendar")?.calendar.agentAccess).toBe("write");
    expect(calendars.find((entry) => entry.providerCalendarId === providerCalendarId)?.calendar.agentAccess).toBe("none");
  });

  it("requires owner authentication, isolates connections, and returns only safe supported metadata", async () => {
    const { app, adapter } = await fixture();
    expect((await request(app).get("/api/calendar-providers")).status).toBe(401);
    expect((await request(app).get("/api/calendar-connections")).status).toBe(401);
    const foreign = await request(app).get("/api/calendar-connections").set("X-Test-Owner", "other-owner");
    expect(foreign.body).toEqual({ connections: [] });
    expect((await request(app).get(`${basePath}/calendars`).set("X-Test-Owner", "other-owner")).status).toBe(404);
    const own = await request(app).get("/api/calendar-connections").set("X-Test-Owner", ownerId);
    expect(own.body.connections).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain(vaultHandle);
    expect(JSON.stringify(own.body)).not.toContain("credentialHandle");
    const providers = await request(app).get("/api/calendar-providers").set("X-Test-Owner", ownerId);
    expect(providers.body.providers).toEqual([
      { providerKey: "google", displayName: "Google Calendar", authorizationAvailable: false, reason: "authorization_not_configured" },
      { providerKey: "microsoft", displayName: "Microsoft Outlook", authorizationAvailable: false, reason: "authorization_not_configured" }
    ]);
    expect(adapter.metrics().discoveryCalls).toBe(1); // No management read contacts the provider.
    for (const [method, url] of [
      ["get", "/api/calendar-providers"], ["get", "/api/calendar-connections"],
      ["get", `${basePath}/calendars`], ["patch", `${basePath}/calendars/${calendarId}`],
      ["post", `${basePath}/disconnect`]
    ] as const) {
      const denied = await request(app)[method](url).set("X-Test-Owner", ownerId).set("X-Life-Links-Actor", "agent");
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("calendar_access_denied");
    }
  });

  it("keeps visibility and canonical agent access independent and rejects stale/foreign writes", async () => {
    const { app, store, gateway } = await fixture();
    const initial = await request(app).get(`${basePath}/calendars`).set("X-Test-Owner", ownerId);
    const calendar = initial.body.calendars[0];
    expect(calendar.calendar.agentAccess).toBe("none");
    expect(calendar).not.toHaveProperty("agentGrant");
    const changed = await request(app).patch(`${basePath}/calendars/${calendarId}`).set("X-Test-Owner", ownerId)
      .send({ expectedUpdatedAt: calendar.calendar.updatedAt, visible: false, agentAccess: "read" });
    expect(changed.status).toBe(200);
    expect(changed.body.calendar).toMatchObject({ visible: false, calendar: { agentAccess: "read" } });
    expect(changed.body.calendar.calendar.updatedAt).not.toBe(calendar.calendar.updatedAt);
    expect((await store.getCanonicalCalendar(calendarId))?.agentAccess).toBe("read");
    expect((await store.getCalendar(connectionId, calendarId))?.agentGrant).toBe("read");
    expect(await gateway.listCalendars(ownerId, connectionId, "agent")).toHaveLength(1);
    const stale = await request(app).patch(`${basePath}/calendars/${calendarId}`).set("X-Test-Owner", ownerId)
      .send({ expectedUpdatedAt: calendar.calendar.updatedAt, agentAccess: "write" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("calendar_settings_conflict");
    expect((await request(app).patch(`${basePath}/calendars/${calendarId}`).set("X-Test-Owner", "other-owner")
      .send({ expectedUpdatedAt: changed.body.calendar.calendar.updatedAt, agentAccess: "write" })).status).toBe(404);
    expect((await request(app).patch(`${basePath}/calendars/${calendarId}`).set("X-Test-Owner", ownerId)
      .send({ expectedUpdatedAt: changed.body.calendar.calendar.updatedAt, agentAccess: "write", ownerId: "other-owner" })).status).toBe(400);
  });

  it("permits one concurrent settings update and never grants more authority than the provider", async () => {
    const { gateway, store } = await fixture({ readOnly: true });
    const initial = (await store.getCanonicalCalendar(calendarId))!;
    await expect(gateway.updateCalendarSettings({ ownerId, connectionId, calendarId, expectedUpdatedAt: initial.updatedAt,
      patch: { agentAccess: "write" } })).rejects.toMatchObject({ code: "invalid_input" });
    const outcomes = await Promise.allSettled([
      gateway.updateCalendarSettings({ ownerId, connectionId, calendarId, expectedUpdatedAt: initial.updatedAt, patch: { agentAccess: "read" } }),
      gateway.updateCalendarSettings({ ownerId, connectionId, calendarId, expectedUpdatedAt: initial.updatedAt, patch: { visible: false } })
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "calendar_settings_conflict" });
  });

  it("disconnects locally, purges projections only, and honestly leaves unavailable remote revocation pending", async () => {
    const { app, store, gateway, adapter, logs } = await fixture({ adapterAvailable: false });
    expect((await request(app).post(`${basePath}/disconnect`).set("X-Test-Owner", ownerId).send({})).status).toBe(400);
    const disconnected = await request(app).post(`${basePath}/disconnect`).set("X-Test-Owner", ownerId)
      .send({ localProjectionDisposition: "purge" });
    expect(disconnected.status).toBe(200);
    expect(disconnected.body.connection).toMatchObject({ status: "disconnected", remoteRevocationStatus: "pending", remoteRevocationAttemptedAt: null });
    expect(await store.listProjections(connectionId, calendarId)).toEqual([]);
    expect((await store.getCanonicalCalendar(calendarId))?.agentAccess).toBe("none");
    expect((await store.getCalendar(connectionId, calendarId))?.visible).toBe(false);
    await expect(gateway.listProjections(ownerId, connectionId, calendarId, "agent")).rejects.toMatchObject({ code: "connection_inactive" });
    expect(adapter.eventCount(providerCalendarId)).toBe(1);
    expect(adapter.metrics().revokeCalls).toBe(0);
    expect(adapter.metrics().commandApplies.delete).toBe(0);
    const readback = await request(app).get(`${basePath}/calendars`).set("X-Test-Owner", ownerId);
    expect(readback.status).toBe(200);
    expect(readback.body.connection.status).toBe("disconnected");
    expect(JSON.stringify({ body: disconnected.body, logs })).not.toContain(vaultHandle);
    expect(logs.some((event) => event.event === "life_links.calendar_connection.disconnected" && event.remote_revocation_status === "pending")).toBe(true);
  });
});
