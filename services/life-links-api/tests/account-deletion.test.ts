import { createHash, randomUUID } from "node:crypto";
import express, { type RequestHandler, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEMO_OWNER_ID } from "@life-links/core";
import { createAccountDeletionRouter, drainProviderRevocationCleanup } from "../src/account-deletion.js";
import type { ProviderRevocationCleanup } from "../src/account-deletion-state.js";
import { CalendarProviderGatewayError, type CalendarProviderGateway } from "../src/calendar-provider-gateway.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { RemoteAgentState } from "../src/remote-agent-state.js";
import { InMemoryLifeLinksStore } from "../src/store.js";

const tokenHash = () => createHash("sha256").update(randomUUID()).digest("hex");
const expiresAt = () => new Date(Date.now() + 3_600_000).toISOString();
const ownerInput = () => ({ displayName: "Synthetic deletion owner", email: `${randomUUID()}@example.test`,
  passwordHash: "synthetic-unused-password-hash", timeZone: "UTC" });
const appleIdentity = () => ({ provider: "apple", issuer: "https://appleid.apple.com", clientId: "synthetic.apple.web",
  subject: randomUUID(), email: null, emailVerified: false, displayName: null });

function gatewayFixture() {
  return {
    listConnections: vi.fn(async (): Promise<Array<{ connectionId: string; connectedAt: string }>> => []),
    removeCalendarConnection: vi.fn(async () => ({ removed: true })),
    executeCommand: vi.fn(async () => { throw new Error("Provider event writes must not run during account deletion"); })
  };
}

async function setup(options: {
  store?: InMemoryLifeLinksStore;
  ownerId?: string;
  calendarGateway?: CalendarProviderGateway;
  revokeProviderCredential?: (cleanup: ProviderRevocationCleanup) => Promise<void>;
  clearRemoteOwner?: (ownerId: string) => Promise<void>;
} = {}) {
  const store = options.store ?? new InMemoryLifeLinksStore();
  const owner = options.ownerId ? (await store.getUserById(options.ownerId))! : await store.registerOwner(ownerInput());
  const hash = tokenHash(), events: LogEvent[] = [];
  await store.createSession(owner.id, hash, expiresAt());
  const gateway = gatewayFixture();
  const clearSession = vi.fn((response: Response) => { response.clearCookie("life_links_session"); });
  const clearRemoteOwner = options.clearRemoteOwner ?? vi.fn(async (_ownerId: string) => {});
  const requireAuthenticated: RequestHandler = (req, res, next) => {
    // Fixture transport only: the router must still authenticate the exact
    // owner/session against the real store before any deletion side effects.
    if (!req.header("x-fixture-owner") || !req.header("x-fixture-session")) {
      res.status(401).json({ error: "authentication_required" }); return;
    }
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(createAccountDeletionRouter({ store, clearSession, clearRemoteOwner, requireAuthenticated,
    logger: createLogger("account_deletion_test", { env: "test", sink: event => events.push(event) }),
    ownerId: req => req.header("x-fixture-owner") ?? null,
    sessionTokenHash: req => req.header("x-fixture-session") ?? null,
    calendarGateway: options.calendarGateway ?? gateway as unknown as CalendarProviderGateway,
    revokeProviderCredential: options.revokeProviderCredential }));
  return { app, store, owner, hash, gateway, clearSession, clearRemoteOwner, events,
    remove(body: unknown = { confirmation: "DELETE" }, userId = owner.id, sessionHash = hash) {
      return request(app).delete("/api/account").set("x-fixture-owner", userId)
        .set("x-fixture-session", sessionHash).send(body);
    } };
}

describe("account deletion lifecycle", () => {
  it.each([{}, { confirmation: "delete" }, { confirmation: "DELETE", extra: true }, ["DELETE"]])
    ("requires the exact confirmation without side effects (%j)", async body => {
      const revoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => {}), ctx = await setup({ revokeProviderCredential: revoke });
      const response = await ctx.remove(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "account_deletion_confirmation_required" });
      expect(await ctx.store.getUserById(ctx.owner.id)).not.toBeNull();
      expect(await ctx.store.getSessionByTokenHash(ctx.hash)).not.toBeNull();
      expect(ctx.gateway.listConnections).not.toHaveBeenCalled();
      expect(ctx.gateway.removeCalendarConnection).not.toHaveBeenCalled();
      expect(ctx.clearRemoteOwner).not.toHaveBeenCalled();
      expect(ctx.clearSession).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    });

  it("rejects missing, foreign and expired sessions before Calendar or provider effects", async () => {
    const revoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => {}), ctx = await setup({ revokeProviderCredential: revoke });
    const other = await ctx.store.registerOwner(ownerInput()), expired = tokenHash();
    await ctx.store.createSession(ctx.owner.id, expired, new Date(Date.now() - 1000).toISOString());
    expect((await request(ctx.app).delete("/api/account").send({ confirmation: "DELETE" })).status).toBe(401);
    for (const [ownerId, hash] of [[other.id, ctx.hash], [ctx.owner.id, tokenHash()], [ctx.owner.id, expired]]) {
      const response = await ctx.remove({ confirmation: "DELETE" }, ownerId, hash);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "authentication_required", reason: "session_required" });
    }
    expect(await ctx.store.getUserById(ctx.owner.id)).not.toBeNull();
    expect(await ctx.store.getUserById(other.id)).not.toBeNull();
    expect(await ctx.store.getSessionByTokenHash(ctx.hash)).not.toBeNull();
    expect(ctx.gateway.listConnections).not.toHaveBeenCalled();
    expect(ctx.clearSession).not.toHaveBeenCalled();
    expect(ctx.clearRemoteOwner).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("protects the shared demo before even attempting Calendar removal", async () => {
    const store = new InMemoryLifeLinksStore();
    await store.seedDemo("synthetic-demo-password", "https://deletion.example.test");
    const ctx = await setup({ store, ownerId: DEMO_OWNER_ID });
    const before = (await store.listLifeLinks(DEMO_OWNER_ID, null)).items;
    const response = await ctx.remove();
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "account_deletion_unavailable", reason: "shared_demo_account" });
    expect((await store.listLifeLinks(DEMO_OWNER_ID, null)).items).toEqual(before);
    expect(await store.getSessionByTokenHash(ctx.hash)).not.toBeNull();
    expect(ctx.gateway.listConnections).not.toHaveBeenCalled();
    expect(ctx.gateway.removeCalendarConnection).not.toHaveBeenCalled();
    expect(ctx.gateway.executeCommand).not.toHaveBeenCalled();
    expect(ctx.clearSession).not.toHaveBeenCalled();
    expect(ctx.clearRemoteOwner).not.toHaveBeenCalled();
  });

  it("returns the public deletion result, erases owner data and sessions, and clears the browser session", async () => {
    const ctx = await setup(), other = await ctx.store.registerOwner(ownerInput());
    const secondHash = tokenHash(), otherHash = tokenHash();
    await ctx.store.createSession(ctx.owner.id, secondHash, expiresAt());
    await ctx.store.createSession(other.id, otherHash, expiresAt());
    const link = await ctx.store.createLifeLink({ id: randomUUID(), ownerId: ctx.owner.id,
      title: "Erase private content", body: "Synthetic private body", createdAt: new Date().toISOString() });
    const otherLink = await ctx.store.createLifeLink({ id: randomUUID(), ownerId: other.id,
      title: "Other owner content", createdAt: link.createdAt });
    const bytes = Buffer.from("synthetic attachment");
    const media = await ctx.store.createLifeLinkMedia(ctx.owner.id, link.id,
      { kind: "image", mimeType: "image/png", fileName: "private.png", sizeBytes: bytes.length, data: bytes });
    expect(media).not.toBeNull();
    expect((await ctx.store.getChangeHistory(ctx.owner.id)).entries.length).toBeGreaterThan(0);
    expect((await ctx.store.listCalendars(ctx.owner.id)).items.length).toBeGreaterThan(0);

    const response = await ctx.remove();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "deleted", appleRevocation: "not_required" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toEqual([expect.stringContaining("life_links_session=;")]);
    expect(ctx.clearSession).toHaveBeenCalledTimes(1);
    expect(ctx.clearRemoteOwner).toHaveBeenCalledWith(ctx.owner.id);
    expect(await ctx.store.getUserById(ctx.owner.id)).toBeNull();
    expect(await ctx.store.getUserByEmail(ctx.owner.email!)).toBeNull();
    expect(await ctx.store.getSessionByTokenHash(ctx.hash)).toBeNull();
    expect(await ctx.store.getSessionByTokenHash(secondHash)).toBeNull();
    expect(await ctx.store.getLifeLinkDetail(ctx.owner.id, link.id)).toBeNull();
    expect(await ctx.store.getLifeLinkMedia(ctx.owner.id, link.id, media!.id)).toBeNull();
    expect((await ctx.store.getChangeHistory(ctx.owner.id)).entries).toEqual([]);
    expect((await ctx.store.listCalendars(ctx.owner.id)).items).toEqual([]);
    expect(await ctx.store.getUserById(other.id)).not.toBeNull();
    expect(await ctx.store.getSessionByTokenHash(otherHash)).not.toBeNull();
    expect(await ctx.store.getLifeLinkDetail(other.id, otherLink.id)).not.toBeNull();
    await expect(ctx.store.createSession(ctx.owner.id, tokenHash(), expiresAt())).rejects.toMatchObject({ code: "authentication_required" });
    expect((await ctx.remove()).status).toBe(401);
    expect(ctx.clearSession).toHaveBeenCalledTimes(1);
  });

  it("leaves data and the session intact when Calendar dispatch is busy and never deletes provider events", async () => {
    const gateway = gatewayFixture(), connection = { connectionId: "synthetic-calendar-connection", connectedAt: new Date().toISOString() };
    gateway.listConnections.mockResolvedValue([connection]);
    gateway.removeCalendarConnection.mockRejectedValue(new CalendarProviderGatewayError("command_in_progress", "Synthetic active dispatch"));
    const revoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => {});
    const ctx = await setup({ calendarGateway: gateway as unknown as CalendarProviderGateway, revokeProviderCredential: revoke });
    const link = await ctx.store.createLifeLink({ id: randomUUID(), ownerId: ctx.owner.id, title: "Keep this", createdAt: connection.connectedAt });
    const response = await ctx.remove();
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "account_deletion_pending", reason: "calendar_write_in_progress" });
    expect(gateway.removeCalendarConnection).toHaveBeenCalledWith({ ownerId: ctx.owner.id,
      connectionId: connection.connectionId, expectedConnectedAt: connection.connectedAt });
    expect(gateway.executeCommand).not.toHaveBeenCalled();
    expect(await ctx.store.getUserById(ctx.owner.id)).not.toBeNull();
    expect(await ctx.store.getSessionByTokenHash(ctx.hash)).not.toBeNull();
    expect(await ctx.store.getLifeLinkDetail(ctx.owner.id, link.id)).not.toBeNull();
    expect(ctx.clearSession).not.toHaveBeenCalled();
    expect(ctx.clearRemoteOwner).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("erases locally during an Apple outage and retains only minimal protected material for a safe bounded retry", async () => {
    const ciphertext = "synthetic-protected-refresh-ciphertext", identity = appleIdentity();
    const revoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => { throw new Error(`Synthetic outage ${ciphertext}`); });
    const ctx = await setup({ revokeProviderCredential: revoke });
    await ctx.store.linkProviderIdentity(ctx.owner.id, identity, { encryptedPayload: ciphertext });
    const response = await ctx.remove();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "deleted", appleRevocation: "pending" });
    expect(await ctx.store.getUserById(ctx.owner.id)).toBeNull();
    expect(await ctx.store.getSessionByTokenHash(ctx.hash)).toBeNull();
    expect(await ctx.store.listProviderIdentities(ctx.owner.id)).toEqual([]);
    expect(ctx.clearSession).toHaveBeenCalledTimes(1);
    const cleanup = await ctx.store.listProviderRevocationCleanup(100);
    expect(cleanup).toHaveLength(1);
    expect(Object.keys(cleanup[0]).sort()).toEqual(["createdAt", "encryptedPayload", "id", "identity"]);
    expect(cleanup[0]).toEqual({ id: expect.any(String), createdAt: expect.any(String), encryptedPayload: ciphertext,
      identity: { provider: identity.provider, issuer: identity.issuer, clientId: identity.clientId, subject: identity.subject } });
    const publicEvidence = JSON.stringify({ body: response.body, events: ctx.events });
    for (const privateValue of [ciphertext, identity.subject, ctx.owner.id, ctx.owner.email!, ctx.hash, cleanup[0].id]) {
      expect(publicEvidence).not.toContain(privateValue);
    }
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(await drainProviderRevocationCleanup(ctx.store, revoke, 1)).toEqual([]);
    expect(await ctx.store.listProviderRevocationCleanup(100)).toEqual(cleanup);
    const recoveredRevoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => {});
    expect(await drainProviderRevocationCleanup(ctx.store, recoveredRevoke, 1)).toEqual([cleanup[0].id]);
    expect(recoveredRevoke).toHaveBeenCalledWith(cleanup[0]);
    expect(await ctx.store.listProviderRevocationCleanup(100)).toEqual([]);
    expect(await drainProviderRevocationCleanup(ctx.store, recoveredRevoke, 1)).toEqual([]);
    expect(recoveredRevoke).toHaveBeenCalledTimes(1);
  });

  it("reports manual Apple revocation for a historical identity without inventing credentials or preventing local deletion", async () => {
    const revoke = vi.fn(async (_cleanup: ProviderRevocationCleanup) => {}), ctx = await setup({ revokeProviderCredential: revoke });
    await ctx.store.linkProviderIdentity(ctx.owner.id, appleIdentity());
    const response = await ctx.remove();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "deleted", appleRevocation: "manual_required" });
    expect(await ctx.store.getUserById(ctx.owner.id)).toBeNull();
    expect(await ctx.store.getSessionByTokenHash(ctx.hash)).toBeNull();
    expect(await ctx.store.listProviderRevocationCleanup(100)).toEqual([]);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("purges remote owner and Grant descendants while preserving the shared client and another owner", async () => {
    const store = new InMemoryLifeLinksStore(), remote = new RemoteAgentState("synthetic-deletion-protocol-key");
    remote.setOwnerResolver(async ownerId => Boolean(await store.getUserById(ownerId)));
    const ctx = await setup({ store, clearRemoteOwner: ownerId => remote.clearOwner(ownerId) });
    const other = await store.registerOwner(ownerInput());
    await remote.put("Client", "shared-client", { client_id: "shared-client" });
    await remote.put("Grant", "owner-grant", { accountId: ctx.owner.id, clientId: "shared-client" }, 3600);
    await remote.put("Grant", "other-grant", { accountId: other.id, clientId: "shared-client" }, 3600);
    await remote.put("Approval", "owner-approval", { ownerId: ctx.owner.id, grantId: "owner-grant" }, 3600);
    await remote.put("AccessToken", "owner-descendant", { grantId: "owner-grant" }, 3600);
    await remote.put("Approval", "other-approval", { ownerId: other.id, grantId: "other-grant" }, 3600);
    const client = await remote.get("Client", "shared-client"), otherGrant = await remote.get("Grant", "other-grant");

    expect((await ctx.remove()).status).toBe(200);
    expect(await remote.get("Grant", "owner-grant")).toBeUndefined();
    expect(await remote.get("Approval", "owner-approval")).toBeUndefined();
    expect(await remote.get("AccessToken", "owner-descendant")).toBeUndefined();
    expect(await remote.listOwned("Grant", ctx.owner.id)).toEqual([]);
    expect(await remote.get("Client", "shared-client")).toEqual(client);
    expect(await remote.get("Grant", "other-grant")).toEqual(otherGrant);
    expect(await remote.get("Approval", "other-approval")).toBeTruthy();
    await expect(remote.put("Grant", "late-grant", { accountId: ctx.owner.id, clientId: "shared-client" }, 3600)).rejects.toThrow("invalid_grant");
    await expect(remote.put("AccessToken", "late-descendant", { grantId: "owner-grant" }, 3600)).rejects.toThrow("invalid_grant");
    expect(await remote.get("Grant", "late-grant")).toBeUndefined();
    expect(await remote.get("AccessToken", "late-descendant")).toBeUndefined();
  });
});
