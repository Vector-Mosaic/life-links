import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAgentState, PersistentRemoteApprovals } from "../src/remote-agent-state.js";
import { CalendarSecretCipher } from "../src/calendar-secret-store.js";
import { runWithRemoteAgentPrincipal, remoteAgentScopeAllows, type RemoteAgentPrincipal } from "../src/remote-agent-principal.js";

const principal = (): RemoteAgentPrincipal => ({ ownerId: "owner-one", clientId: "client-one", grantId: "grant-one",
  scopes: ["records:read", "records:write"], expiresAt: Date.now() + 3_600_000 });

afterEach(() => vi.useRealTimers());

describe("private remote protocol state", () => {
  it("bounds registration, prunes expired artifacts, and preserves owner-consented clients", async () => {
    vi.useFakeTimers();
    const state = new RemoteAgentState("synthetic-test-key", undefined, { registeredClients: 2 });
    await state.put("Client", "accepted-client", { client_id: "accepted-client" });
    await state.put("Grant", "accepted-grant", { accountId: "owner-one", clientId: "accepted-client" }, 90 * 86400);
    await state.put("Client", "abandoned-client", { client_id: "abandoned-client" });
    await expect(state.put("Client", "excess-client", { client_id: "excess-client" })).rejects.toThrow();
    await state.put("AuthorizationCode", "expired-code", { grantId: "accepted-grant" }, 60);
    vi.advanceTimersByTime(25 * 3600_000);
    expect(await state.pruneExpired()).toBe(2);
    expect(await state.get("Client", "accepted-client")).toBeTruthy();
    expect(await state.get("Client", "abandoned-client")).toBeUndefined();
    expect(await state.get("Grant", "accepted-grant")).toBeTruthy();
    await state.put("Client", "replacement-client", { client_id: "replacement-client" });
    expect(await state.get("Client", "replacement-client")).toBeTruthy();
    await state.revokeGrant("accepted-grant");
    vi.advanceTimersByTime(90 * 86400_000);
    await state.pruneExpired();
    expect(await state.get("Client", "accepted-client")).toBeUndefined();
    await expect(state.put("Grant", "orphan-grant", { accountId: "owner-one", clientId: "accepted-client" }, 3600)).rejects.toThrow();
    expect(await state.get("Grant", "orphan-grant")).toBeUndefined();
  });

  it("consumes a one-use credential exactly once, including concurrent attempts", async () => {
    const state = new RemoteAgentState("synthetic-test-key");
    const Adapter = state.adapter(); const codes = new Adapter("AuthorizationCode");
    await codes.upsert("synthetic-code", { accountId: "owner-one", grantId: "grant-one", jti: "synthetic-code" }, 60);
    const outcomes = await Promise.allSettled([codes.consume("synthetic-code"), codes.consume("synthetic-code")]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect((await codes.find("synthetic-code"))?.consumed).toBeTypeOf("number");
    await state.revokeGrant("grant-one");
    expect(await codes.find("synthetic-code")).toBeUndefined();
  });

  it("removes only the exact grant's credential and approval state", async () => {
    const state = new RemoteAgentState("synthetic-test-key");
    await state.put("Grant", "grant-one", { accountId: "owner-one", jti: "grant-one" }, 60);
    await state.put("AccessToken", "token-one", { accountId: "owner-one", grantId: "grant-one" }, 60);
    await state.put("AccessToken", "token-two", { accountId: "owner-one", grantId: "grant-two" }, 60);
    await state.put("Approval", "preview-one", { ownerId: "owner-one", grantId: "grant-one" }, 60);
    expect(await state.listOwned("AccessToken", "owner-one")).toHaveLength(2);
    await state.revokeGrant("grant-one");
    expect(await state.get("Grant", "grant-one")).toBeUndefined();
    expect(await state.get("Approval", "preview-one")).toBeUndefined();
    expect(await state.get("AccessToken", "token-two")).toBeTruthy();
  });

  it("keeps a confirmed command retryable after the pending consent window", async () => {
    vi.useFakeTimers();
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const input = { operation: "remove", payload: { targetId: "synthetic-item" }, effects: { removed: ["synthetic-item"] }, id: undefined };
    const preview = await approvals.prepare(owner, input);
    expect(preview.id).toBeTypeOf("string");
    await approvals.locked(owner, preview.id, () => approvals.approve(owner, preview.id, true));
    vi.advanceTimersByTime(16 * 60_000);
    expect((await approvals.get(owner, preview.id)).status).toBe("approved");
    await approvals.locked(owner, preview.id, () => approvals.complete(owner, preview.id, { saved: true }));
    expect((await approvals.get(owner, preview.id)).result).toEqual({ saved: true });
    await expect(approvals.get({ ...owner, clientId: "other-client" }, preview.id)).rejects.toThrow("remote_approval_unavailable");
    await expect(approvals.get({ ...owner, ownerId: "other-owner" }, preview.id)).rejects.toThrow("remote_approval_unavailable");
    await expect(approvals.prepare(owner, { ...input, id: preview.id, payload: { targetId: "other" } })).rejects.toThrow("remote_approval_conflict");
  });

  it("expires unconfirmed previews without consuming a durable command", async () => {
    vi.useFakeTimers();
    const approvals = new PersistentRemoteApprovals(new RemoteAgentState("synthetic-test-key"));
    const owner = principal(); const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["test"] } });
    vi.advanceTimersByTime(16 * 60_000);
    await expect(approvals.get(owner, preview.id)).rejects.toThrow("remote_approval_expired");
  });

  it("reuses authenticated encryption without changing the existing Calendar namespace", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const identity = { id: "synthetic-id", ownerId: "synthetic-owner", purpose: "credential" as const };
    const existing = new CalendarSecretCipher(key);
    const explicit = new CalendarSecretCipher(key, "life-links-calendar-v1");
    const remote = new CalendarSecretCipher(key, "life-links-remote-mcp-v1");
    const row = { ...identity, encryptedPayload: existing.seal(identity, { synthetic: true }), expiresAt: null };
    expect(explicit.open(row)).toEqual({ synthetic: true });
    expect(() => remote.open(row)).toThrow();
  });

  it("does not treat a page actor or another owner as an authenticated remote principal", async () => {
    expect(remoteAgentScopeAllows("owner-one", "records")).toBe(false);
    await runWithRemoteAgentPrincipal(principal(), async () => {
      expect(remoteAgentScopeAllows("owner-one", "records")).toBe(true);
      expect(() => remoteAgentScopeAllows("other-owner", "records")).toThrow();
      expect(() => remoteAgentScopeAllows("owner-one", "calendar")).toThrow();
    });
    expect(remoteAgentScopeAllows("owner-one", "records")).toBe(false);
  });
});
