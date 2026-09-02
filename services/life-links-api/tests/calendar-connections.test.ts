import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createCalendarConnectionRouter } from "../src/calendar-connections.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { createLogger, type LogEvent } from "../src/logger.js";

const ownerId = "synthetic-calendar-owner";
const connectionId = "synthetic-connection-one";
const calendarId = "calendar-99999999-9999-4999-8999-999999999999";
const providerCalendarId = "synthetic-provider-calendar";
const vaultHandle = "synthetic-private-vault-handle-must-not-leak";
const writable = { read: true, create: true, update: true, delete: true };

async function fixture(options: { readOnly?: boolean; adapterAvailable?: boolean } = {}) {
  const store = new InMemoryCalendarProviderStateStore();
  const adapter = new DeterministicFakeCalendarProviderAdapter("google", "synthetic-provider-account", [{
    providerCalendarId, displayName: "Synthetic calendar", capabilities: options.readOnly
      ? { read: true, create: false, update: false, delete: false } : writable,
    events: [{ providerEventId: "synthetic-event", providerRevision: "revision-one", content: {
      title: "Synthetic event", description: null, location: null, status: "confirmed", providerSeriesId: null,
      span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" }
    } }]
  }]);
  const connectedGateway = new CalendarProviderGateway([adapter], store, { now: () => new Date("2026-09-01T12:00:00.000Z") });
  await connectedGateway.connectExternalAccount({
    ownerId, connectionId, providerKey: "google", expectedProviderAccountId: "synthetic-provider-account",
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
  app.use(createCalendarConnectionRouter({
    gateway, ownerId: selectedOwner,
    requireAuthenticated(req, res, next) {
      if (!selectedOwner(req)) { res.status(401).json({ error: "authentication_required" }); return; }
      next();
    },
    logger: createLogger("calendar_connection_test", { sink: (event) => logs.push(event) })
  }));
  return { app, store, gateway, adapter, logs };
}

const basePath = `/api/calendar-connections/${connectionId}`;

describe("owner Calendar connection management", () => {
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
