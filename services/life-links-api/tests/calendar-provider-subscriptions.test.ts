import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, ProviderTransientError,
  calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY, type MicrosoftCalendarSubscription } from "../src/calendar-provider-microsoft.js";
import { CalendarProviderSubscriptionService, InMemoryCalendarProviderSubscriptionStore,
  createCalendarProviderNotificationRouter } from "../src/calendar-provider-subscriptions.js";

const OWNER = "subscription-owner", CONNECTION = "subscription-connection", ACCOUNT = "subscription-account";
const CALENDAR = "calendar-11111111-1111-4111-8111-111111111111";
const HANDLE = calendarProviderCredentialHandle("subscription-credential");
const WINDOW = { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-10-01T00:00:00.000Z" };

async function fixture() {
  let now = Date.parse("2026-09-01T12:00:00.000Z");
  const provider = new DeterministicFakeCalendarProviderAdapter(MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY, ACCOUNT, [{
    providerCalendarId: "secondary-agent-tests", displayName: "Agent Tests", capabilities: { read: true, create: true, update: true, delete: true }
  }]);
  const gateway = new CalendarProviderGateway([provider], new InMemoryCalendarProviderStateStore(), { now: () => new Date(now) });
  await gateway.connectExternalAccount({ ownerId: OWNER, connectionId: CONNECTION, expectedProviderAccountId: ACCOUNT,
    providerKey: MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY, credentialHandle: HANDLE, initialWindow: WINDOW,
    calendars: [{ calendarId: CALENDAR, providerCalendarId: "secondary-agent-tests", title: "Agent Tests", color: "#2f6f5f", timeZone: "UTC", isDefault: false }] });
  const store = new InMemoryCalendarProviderSubscriptionStore();
  let creates = 0, renewals = 0, deletes = 0, clientState = "", failCreate = false, failDelete = false;
  let remote: MicrosoftCalendarSubscription | null = null;
  const adapter = {
    async listSubscriptions() { return remote ? [{ ...remote }] : []; },
    async createSubscription(input: { notificationUrl: string; clientState: string; expiresAt: string }) {
      creates++; clientState = input.clientState;
      remote = { id: "provider-subscription", resource: `users/${ACCOUNT}/events`, notificationUrl: input.notificationUrl,
        creatorId: ACCOUNT, expiresAt: input.expiresAt };
      if (failCreate) { failCreate = false; throw new ProviderTransientError("Lost acknowledgement"); }
      return { ...remote };
    },
    async renewSubscription(input: { subscriptionId: string; expiresAt: string }) {
      renewals++; expect(input.subscriptionId).toBe(remote?.id);
      if (!remote) return null; remote.expiresAt = input.expiresAt; return { ...remote };
    },
    async deleteSubscription(input: { subscriptionId: string }) {
      deletes++; expect(input.subscriptionId).toBe(remote?.id);
      if (failDelete) throw new ProviderTransientError("Retry delete"); remote = null;
    }
  };
  const service = new CalendarProviderSubscriptionService({ gateway, store, adapter,
    notificationUrl: "https://life-links.example/api/calendar-notifications/microsoft", now: () => new Date(now) });
  return { gateway, provider, store, adapter, service, clientState: () => clientState,
    counts: () => ({ creates, renewals, deletes }), advance: (ms: number) => { now += ms; },
    failCreate: () => { failCreate = true; }, failDelete: (value: boolean) => { failDelete = value; } };
}

describe("Outlook Calendar subscription lifecycle", () => {
  it("stores only a nonce hash, authenticates hints, and reconciles only selected bindings", async () => {
    const f = await fixture();
    await f.service.ensureConnection(CONNECTION);
    const row = (await f.store.get(CONNECTION))!;
    expect(JSON.stringify(row)).not.toContain(f.clientState());
    expect(row.clientStateHash).toMatch(/^[a-f0-9]{64}$/);
    const notice = { subscriptionId: "provider-subscription", clientState: f.clientState(), changeType: "updated",
      resourceData: { subject: "UNTRUSTED NEVER PERSISTED" } };
    expect(await f.service.acceptNotifications(row.key, { value: [{ ...notice, clientState: "wrong" }] })).toBe(0);
    expect(await f.service.acceptNotifications(row.key, { value: [{ ...notice, subscriptionId: "other" }] })).toBe(0);
    const before = f.provider.metrics().fetchCalls.length;
    expect(await f.service.acceptNotifications(row.key, { value: [notice] })).toBe(1);
    expect(f.provider.metrics().fetchCalls).toHaveLength(before);
    expect(JSON.stringify([...f.store.records.values()])).not.toContain("UNTRUSTED");
    expect(await f.service.reconcileHints(WINDOW)).toBe(1);
    expect(f.provider.metrics().fetchCalls.at(-1)?.providerCalendarId).toBe("secondary-agent-tests");
    expect(await f.store.listHinted(20)).toEqual([]);
  });

  it("recovers an uncertain create by its exact URL instead of making a duplicate subscription", async () => {
    const f = await fixture(); f.failCreate();
    await expect(f.service.ensureConnection(CONNECTION)).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await f.store.get(CONNECTION))?.providerSubscriptionId).toBeNull();
    await f.service.ensureConnection(CONNECTION);
    expect((await f.store.get(CONNECTION))?.providerSubscriptionId).toBe("provider-subscription");
    expect(f.counts().creates).toBe(1);
  });

  it("renews before expiry and on authenticated lifecycle notice without changing event projections", async () => {
    const f = await fixture(); await f.service.ensureConnection(CONNECTION);
    f.advance(2.5 * 86_400_000); await f.service.ensureConnection(CONNECTION);
    expect(f.counts().renewals).toBe(1);
    const row = (await f.store.get(CONNECTION))!;
    await f.service.acceptNotifications(row.key, { value: [{ subscriptionId: row.providerSubscriptionId,
      clientState: f.clientState(), lifecycleEvent: "reauthorizationRequired" }] });
    await f.service.ensureConnection(CONNECTION);
    expect(f.counts().renewals).toBe(2);
    expect(await f.gateway.listProjections(OWNER, CONNECTION, CALENDAR)).toEqual([]);
  });

  it("closes locally before exact subscription cleanup, retains retry state on failure, then clears metadata", async () => {
    const f = await fixture(); await f.service.ensureConnection(CONNECTION);
    const row = (await f.store.get(CONNECTION))!;
    f.provider.revokeConnection = async () => f.service.cleanupConnection({ ownerId: OWNER, connectionId: CONNECTION,
      providerAccountId: ACCOUNT, credentialHandle: HANDLE });
    f.failDelete(true);
    const failed = await f.gateway.disconnectConnection({ ownerId: OWNER, connectionId: CONNECTION, localProjectionDisposition: "purge" });
    expect(failed).toMatchObject({ status: "disconnected", remoteRevocationStatus: "failed" });
    expect(await f.store.get(CONNECTION)).not.toBeNull();
    expect(await f.service.acceptNotifications(row.key, { value: [{ subscriptionId: row.providerSubscriptionId,
      clientState: f.clientState(), changeType: "updated" }] })).toBe(0);
    f.failDelete(false);
    expect(await f.gateway.disconnectConnection({ ownerId: OWNER, connectionId: CONNECTION,
      localProjectionDisposition: "purge" })).toMatchObject({ remoteRevocationStatus: "succeeded" });
    expect(await f.store.get(CONNECTION)).toBeNull();
    expect(f.provider.metrics().commandAttempts.delete).toBe(0);
  });

  it("validates Graph challenge and accepts only authenticated bounded notifications on its exact public route", async () => {
    const f = await fixture(); await f.service.ensureConnection(CONNECTION);
    let wakes = 0;
    const app = express(); app.use(createCalendarProviderNotificationRouter(f.service, () => { wakes++; }));
    const challenge = await request(app).post("/api/calendar-notifications/microsoft?validationToken=opaque%20challenge");
    expect(challenge.status).toBe(200); expect(challenge.type).toBe("text/plain"); expect(challenge.text).toBe("opaque challenge");
    expect(wakes).toBe(0);
    const row = (await f.store.get(CONNECTION))!;
    await request(app).post(`/api/calendar-notifications/microsoft?subscriptionKey=${row.key}`).send({ value: [{
      subscriptionId: row.providerSubscriptionId, clientState: f.clientState(), changeType: "created"
    }] }).expect(202);
    expect(wakes).toBe(1);
    await request(app).post("/api/calendar-notifications/microsoft?subscriptionKey=invalid").send({ value: [] }).expect(400);
    await request(app).post("/api/calendar-notifications/unknown?validationToken=opaque").expect(404);
    await request(app).post(`/api/calendar-notifications/microsoft?subscriptionKey=${row.key}`)
      .set("Content-Type","application/json").send("{malformed").expect(400);
    await request(app).post(`/api/calendar-notifications/microsoft?subscriptionKey=${row.key}`)
      .send({ value: [], padding: "x".repeat(270_000) }).expect(413);
  });

  it("finishes previously failed cleanup after proven subscription expiry without retaining an unusable credential forever", async () => {
    const f = await fixture(); await f.service.ensureConnection(CONNECTION);
    f.provider.revokeConnection = async () => f.service.cleanupConnection({ ownerId: OWNER, connectionId: CONNECTION,
      providerAccountId: ACCOUNT, credentialHandle: HANDLE });
    f.failDelete(true);
    expect(await f.gateway.disconnectConnection({ ownerId: OWNER, connectionId: CONNECTION,
      localProjectionDisposition: "purge" })).toMatchObject({ remoteRevocationStatus: "failed" });
    const attempts = f.counts().deletes;
    expect(await f.gateway.retryPendingRevocations()).toEqual({ attempted: 0, completed: 0 });
    f.advance(3 * 86_400_000 + 1);
    expect(await f.gateway.retryPendingRevocations()).toEqual({ attempted: 1, completed: 1 });
    expect(f.counts().deletes).toBe(attempts);
    expect(await f.store.get(CONNECTION)).toBeNull();
    expect((await f.gateway.store.getConnection(CONNECTION))?.credentialHandle).toBeNull();
  });
});
