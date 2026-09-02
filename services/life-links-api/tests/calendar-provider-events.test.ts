import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_QR_BASE_URL, DEMO_GUEST_ID, DEMO_PASSWORD, type ProviderEventContent } from "@life-links/core";
import { createLifeLinksApp } from "../src/server.js";
import { readConfig } from "../src/config.js";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { listProviderCalendarBindings } from "../src/calendar-provider-events.js";

const OWNER = "demo-owner";
const CONNECTION = "provider-http-test";
const CALENDAR = "calendar-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROVIDER_CALENDAR = "provider-calendar-one";
const projectionContent = (title = "Owner private event"): ProviderEventContent => ({
  title, description: "Private details", location: "Private location", status: "confirmed", providerSeriesId: null,
  span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" },
  providerRecurrence: { kind: "single", originalStartUtc: null }, outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false }
});
const writable = (title = "Owner private event") => {
  const { providerSeriesId: _series, providerRecurrence: _recurrence, outboundEffects: _effects, ...content } = projectionContent(title);
  return content;
};

async function fixture(content = projectionContent(), timeZone = "UTC") {
  const store = new InMemoryLifeLinksStore();
  await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
  const providerStore = new InMemoryCalendarProviderStateStore();
  const adapter = new DeterministicFakeCalendarProviderAdapter("test-provider", "test-provider-account", [{
    providerCalendarId: PROVIDER_CALENDAR, displayName: "Synthetic provider calendar",
    capabilities: { read: true, create: true, update: true, delete: true },
    events: [{ providerEventId: "event-one", providerRevision: "r1", content }]
  }]);
  const gateway = new CalendarProviderGateway([adapter], providerStore, { maxInitialWindowDays: 366 });
  await gateway.connectExternalAccount({ ownerId: OWNER, connectionId: CONNECTION, providerKey: "test-provider",
    expectedProviderAccountId: "test-provider-account", credentialHandle: calendarProviderCredentialHandle("private-test-vault-reference"),
    calendars: [{ calendarId: CALENDAR, providerCalendarId: PROVIDER_CALENDAR, title: "Private calendar", color: "#336699",
      timeZone, isDefault: false, agentGrant: "write" }],
    initialWindow: { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-09-03T00:00:00.000Z" }
  });
  const logs: LogEvent[] = [];
  const app = createLifeLinksApp({ store, calendarProviderGateway: gateway,
    config: readConfig({ NODE_ENV: "test", LIFE_LINKS_STORE: "memory", SESSION_SECRET: "provider-event-test-session-secret",
      QR_BASE_URL: DEFAULT_QR_BASE_URL, COOKIE_SECURE: "false", ORIGIN_CHECK_ENABLED: "true", ORIGIN_CHECK_ALLOW_MISSING: "false" }),
    logger: createLogger("calendar_provider_events_test", { env: "ci", sink: (event) => logs.push(event) }) });
  const agent = request.agent(app);
  const origin = new URL(DEFAULT_QR_BASE_URL).origin;
  expect((await agent.post("/api/auth/login").set("Origin", origin)
    .send({ email: (await store.getUserById(OWNER))!.email, password: DEMO_PASSWORD })).status).toBe(200);
  return { app, agent, origin, store, providerStore, adapter, gateway, logs };
}

const tuple = { authority: "provider", connectionId: CONNECTION, calendarId: CALENDAR };

describe("provider Calendar events through the existing owner HTTP boundary", () => {
  it("synchronizes a requested past window in the canonical Calendar zone rather than relying on the initial cache", async () => {
    const content = { ...projectionContent(), span: { kind: "timed" as const,
      startUtc: "2020-11-02T04:00:00.000Z", endUtc: "2020-11-02T04:30:00.000Z",
      sourceTimeZone: "America/New_York", floatingLocalStart: null, floatingLocalEnd: null } };
    const ctx = await fixture(content, "America/New_York");
    // The fake cursor is sequence-only; emulate the real adapter's explicit
    // cursor-expired signal when switching to a different requested window.
    ctx.adapter.expireCursor((await ctx.providerStore.getSyncState(CONNECTION, CALENDAR))!.syncCursor!);
    const fetch = vi.spyOn(ctx.adapter, "fetchChanges");
    await ctx.store.connectAgent(OWNER, "life-links-calendar-v2");
    const response = await ctx.agent.get("/api/calendar-events").set("X-Life-Links-Actor", "agent")
      .query({ ...tuple, startDate: "2020-11-01", endDate: "2020-11-01" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      window: { startUtc: "2020-11-01T04:00:00.000Z", endUtc: "2020-11-02T05:00:00.000Z" }
    }));
    expect(response.body.providerEvents).toHaveLength(1);
    await ctx.store.disconnectAgent(OWNER);
    const calls = fetch.mock.calls.length;
    expect((await ctx.agent.get("/api/calendar-events").set("X-Life-Links-Actor", "agent")
      .query({ ...tuple, startDate: "2020-11-02", endDate: "2020-11-02" })).status).toBe(403);
    expect(fetch.mock.calls).toHaveLength(calls);
    fetch.mockRestore();
  });

  it("queries exact bounded projections, privately reads details, and exposes only authorized binding metadata", async () => {
    const ctx = await fixture();
    const query = { ...tuple, startDate: "2026-09-01", endDate: "2026-09-02" };
    expect((await request(ctx.app).get("/api/calendar-events").query(query)).status).toBe(401);
    const page = await ctx.agent.get("/api/calendar-events").query(query);
    expect(page.status).toBe(200);
    expect(page.body.providerEvents).toHaveLength(1);
    expect(page.body.providerEvents[0]).toMatchObject({ providerEventId: "event-one", providerRevision: "r1", calendarId: CALENDAR });
    expect(page.body).not.toHaveProperty("calendarEvents");
    expect((await ctx.agent.get("/api/calendar-events").query({ ...query, startDate: "2026-09-03", endDate: "2026-09-04" })).body.providerEvents).toEqual([]);
    expect((await ctx.agent.get("/api/calendar-events").query({ ...query, endDate: "2030-09-01" })).status).toBe(400);
    const detail = await ctx.agent.get("/api/calendar-events/event-one").query(tuple);
    expect(detail.status).toBe(200);
    expect(detail.body.providerEvent).toEqual(page.body.providerEvents[0]);
    expect((await ctx.agent.get("/api/calendar-events/event-one").query({ ...tuple, connectionId: "guessed-connection" })).status).toBe(404);
    expect((await ctx.agent.get("/api/calendar-events/event-one").query(tuple).set("X-Life-Links-Actor", "agent")).status).toBe(403);
    await ctx.store.connectAgent(OWNER, "life-links-calendar-v2");
    expect((await ctx.agent.get("/api/calendar-events/event-one").query(tuple).set("X-Life-Links-Actor", "agent")).status).toBe(200);
    const calendar = (await ctx.providerStore.getCanonicalCalendar(CALENDAR))!;
    const metadata = await listProviderCalendarBindings({ gateway: ctx.gateway, calendars: [calendar], ownerId: OWNER, actor: "agent" });
    expect(metadata).toEqual([{ calendarId: CALENDAR, connectionId: CONNECTION, providerKey: "test-provider",
      providerAccountId: "test-provider-account", providerCalendarId: PROVIDER_CALENDAR,
      capabilities: { read: true, create: true, update: true, delete: true }, visible: true }]);
    expect(await listProviderCalendarBindings({ gateway: ctx.gateway, calendars: [], ownerId: OWNER, actor: "agent" })).toEqual([]);
    const serialized = JSON.stringify([page.body, detail.body, metadata, ctx.logs]);
    expect(serialized).not.toContain("private-test-vault-reference");
    expect(JSON.stringify(ctx.logs)).not.toContain("Owner private event");
    const guest = request.agent(ctx.app);
    expect((await guest.post("/api/auth/login").set("Origin", ctx.origin)
      .send({ email: (await ctx.store.getUserById(DEMO_GUEST_ID))!.email, password: DEMO_PASSWORD })).status).toBe(200);
    expect((await guest.get("/api/calendar-events/event-one").query(tuple)).status).toBe(404);
  });

  it("dispatches human and page-agent CRUD to the real gateway, preserves exact retries, and never writes native event rows", async () => {
    const ctx = await fixture();
    const create = { ...tuple, commandId: "http-create-one", content: writable("Created through HTTP") };
    expect((await ctx.agent.post("/api/calendar-events").set("Origin", "https://wrong.example").send(create)).status).toBe(403);
    const created = await ctx.agent.post("/api/calendar-events").set("Origin", ctx.origin).send(create);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const event = created.body.providerEvent;
    expect((await ctx.agent.post("/api/calendar-events").set("Origin", ctx.origin).send(create)).body).toEqual(created.body);
    await ctx.store.connectAgent(OWNER, "life-links-calendar-v2");
    const update = { ...tuple, commandId: "http-update-one", expectedProviderRevision: event.providerRevision, scope: "event",
      content: writable("Updated through shared agent boundary") };
    const updated = await ctx.agent.patch(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send(update);
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.providerEvent.content.title).toBe(update.content.title);
    expect((await ctx.agent.patch(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send(update)).body).toEqual(updated.body);
    const conflict = await ctx.agent.patch(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send({ ...update, content: writable("Changed retry") });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    const stale = await ctx.agent.patch(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send({ ...update, commandId: "http-stale-update" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("provider_revision_conflict");
    const deletion = { ...tuple, commandId: "http-delete-one", expectedProviderRevision: updated.body.providerEvent.providerRevision, scope: "event" };
    const deleted = await ctx.agent.delete(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send(deletion);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body).toMatchObject({ authority: "provider", kind: "delete", providerEventId: event.providerEventId });
    expect((await ctx.agent.delete(`/api/calendar-events/${event.providerEventId}`)
      .set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent").send(deletion)).body).toEqual(deleted.body);
    expect((await ctx.agent.get(`/api/calendar-events/${event.providerEventId}`).query(tuple)).status).toBe(404);
    expect((await ctx.store.listCalendarEvents(OWNER)).items).toEqual([]);
    expect(ctx.adapter.metrics().commandApplies).toEqual({ create: 1, update: 1, delete: 1 });
  });

  it.each(["recurrence", "attendees", "meeting"])("refuses unsupported provider %s effects without dispatch", async (unsupported) => {
    const content = projectionContent();
    if (unsupported === "recurrence") { content.providerSeriesId = "series-one"; content.providerRecurrence = { kind: "occurrence", originalStartUtc: "2026-09-01T00:00:00.000Z" }; }
    if (unsupported === "attendees") content.outboundEffects = { attendeeCount: 1, hasOnlineMeeting: false };
    if (unsupported === "meeting") content.outboundEffects = { attendeeCount: 0, hasOnlineMeeting: true };
    const ctx = await fixture(content);
    const denied = await ctx.agent.delete("/api/calendar-events/event-one").set("Origin", ctx.origin)
      .send({ ...tuple, commandId: "unsafe-delete", expectedProviderRevision: "r1", scope: "event" });
    expect(denied.status).toBe(400);
    expect(ctx.adapter.metrics().commandAttempts.delete).toBe(0);
    const forged = await ctx.agent.post("/api/calendar-events").set("Origin", ctx.origin)
      .send({ ...tuple, commandId: "unsafe-create", content: { ...writable(), attendees: ["someone@example.invalid"] } });
    expect(forged.status).toBe(400);
    expect(ctx.adapter.metrics().commandAttempts.create).toBe(0);
  });

  it("rechecks current agent connection after admission and before provider dispatch", async () => {
    const ctx = await fixture();
    await ctx.store.connectAgent(OWNER, "life-links-calendar-v2");
    const originalClaim = ctx.providerStore.claimOutbox.bind(ctx.providerStore);
    const claim = vi.spyOn(ctx.providerStore, "claimOutbox").mockImplementationOnce(async (input) => {
      const result = await originalClaim(input);
      await ctx.store.disconnectAgent(OWNER);
      return result;
    });
    const denied = await ctx.agent.post("/api/calendar-events").set("Origin", ctx.origin).set("X-Life-Links-Actor", "agent")
      .send({ ...tuple, commandId: "revoked-create", content: writable() });
    expect(claim).toHaveBeenCalledOnce();
    claim.mockRestore();
    expect(denied.status).toBe(403);
    expect(ctx.adapter.metrics().commandAttempts.create).toBe(0);
    expect((await ctx.store.listCalendarEvents(OWNER)).items).toEqual([]);
  });
});
