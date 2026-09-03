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

  it("issues one private challenge per pending preview without changing canonical replay or expiry", async () => {
    vi.useFakeTimers();
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const input = { id: "preview-ui", operation: "remove", payload: { targetId: "synthetic-item" }, effects: { removed: ["synthetic-item"] } };
    const preview = await approvals.prepare(owner, input);
    const writes = vi.spyOn(state, "put");
    const issue = () => approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    const [first, concurrent] = await Promise.all([issue(), issue()]);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(concurrent).toBe(first);
    vi.advanceTimersByTime(5 * 60_000);
    expect(await issue()).toBe(first);
    expect(writes).toHaveBeenCalledTimes(1);
    const replay = await approvals.prepare(owner, input);
    expect(replay).toMatchObject({ ...preview, uiChallenge: first });
    expect(replay.expiresAt).toBe(preview.expiresAt);
    expect(replay.payload).toEqual(input.payload);
    expect(replay.effects).toEqual(input.effects);
    await approvals.locked(owner, preview.id, () => approvals.validateUiChallenge(owner, preview.id, first));
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it.each(["ownerId", "clientId", "grantId"] as const)("binds component challenge issue and validation to the exact %s", async (field) => {
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["test"] } });
    const challenge = await approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    const foreign = { ...owner, [field]: "other-identity" };
    await expect(approvals.issueUiChallenge(foreign, preview.id)).rejects.toThrow("remote_approval_unavailable");
    await expect(approvals.validateUiChallenge(foreign, preview.id, challenge)).rejects.toThrow("remote_approval_unavailable");
    expect(await approvals.get(owner, preview.id)).toMatchObject({ status: "pending", uiChallenge: challenge });
  });

  it("rejects missing, malformed, wrong and swapped proofs without declining or mutating a preview", async () => {
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["one"] } });
    const other = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["two"] } });
    const challenge = await approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    const otherChallenge = await approvals.locked(owner, other.id, () => approvals.issueUiChallenge(owner, other.id));
    const wrong = `${challenge[0] === "A" ? "B" : "A"}${challenge.slice(1)}`;
    const writes = vi.spyOn(state, "put");
    for (const proof of [undefined, null, true, { confirmed: true }, "", "!".repeat(43), wrong, otherChallenge]) {
      await expect(approvals.locked(owner, preview.id, () => approvals.validateUiChallenge(owner, preview.id, proof)))
        .rejects.toThrow("confirmation_invalid");
    }
    expect(writes).not.toHaveBeenCalled();
    expect(await approvals.get(owner, preview.id)).toMatchObject({ status: "pending", uiChallenge: challenge });
    await approvals.locked(owner, preview.id, () => approvals.validateUiChallenge(owner, preview.id, challenge));
  });

  it("refuses expired or revoked challenges without refreshing the pending consent window", async () => {
    vi.useFakeTimers();
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["test"] } });
    const challenge = await approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    await expect(approvals.validateUiChallenge({ ...owner, expiresAt: Date.now() }, preview.id, challenge))
      .rejects.toThrow("remote_agent_authorization_expired");
    vi.advanceTimersByTime(15 * 60_000);
    await expect(approvals.issueUiChallenge(owner, preview.id)).rejects.toThrow("remote_approval_expired");
    await expect(approvals.validateUiChallenge(owner, preview.id, challenge)).rejects.toThrow("remote_approval_expired");
    expect(await state.get("Approval", preview.id)).toMatchObject({ expiresAt: preview.expiresAt, status: "pending", uiChallenge: challenge });
    await state.revokeGrant(owner.grantId);
    await expect(approvals.issueUiChallenge(owner, preview.id)).rejects.toThrow("remote_approval_unavailable");
    await expect(approvals.validateUiChallenge(owner, preview.id, challenge)).rejects.toThrow("remote_approval_unavailable");
  });

  it.each([true, false])("atomically consumes UI proof with accepted=%s and preserves retry when the write fails", async (accepted) => {
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["test"] } });
    const challenge = await approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    const originalPut = state.put.bind(state);
    const writes = vi.spyOn(state, "put").mockRejectedValueOnce(new Error("synthetic write unavailable"));
    const consume = vi.spyOn(state, "consume");
    const confirm = () => approvals.locked(owner, preview.id, async () => {
      await approvals.validateUiChallenge(owner, preview.id, challenge);
      return approvals.approve(owner, preview.id, accepted);
    });
    await expect(confirm()).rejects.toThrow("synthetic write unavailable");
    expect(await approvals.get(owner, preview.id)).toMatchObject({ status: "pending", uiChallenge: challenge });
    writes.mockImplementation(async (kind, id, row, expiry) => {
      expect(row.status).toBe(accepted ? "approved" : "declined");
      expect(row).not.toHaveProperty("uiChallenge");
      await originalPut(kind, id, row, expiry);
    });
    const saved = await confirm();
    expect(saved.status).toBe(accepted ? "approved" : "declined");
    expect(saved).not.toHaveProperty("uiChallenge");
    expect(consume).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(2);
    await expect(approvals.validateUiChallenge(owner, preview.id, challenge)).rejects.toThrow("confirmation_invalid");
    await expect(approvals.issueUiChallenge(owner, preview.id)).rejects.toThrow("confirmation_invalid");
    expect(await approvals.locked(owner, preview.id, () => approvals.approve(owner, preview.id, !accepted))).toEqual(saved);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("recovers a committed approval after response loss without requiring or restoring the consumed proof", async () => {
    const state = new RemoteAgentState("synthetic-test-key"); const approvals = new PersistentRemoteApprovals(state);
    const owner = principal();
    const preview = await approvals.prepare(owner, { operation: "remove", payload: {}, effects: { removed: ["test"] } });
    const challenge = await approvals.locked(owner, preview.id, () => approvals.issueUiChallenge(owner, preview.id));
    const originalPut = state.put.bind(state);
    const writes = vi.spyOn(state, "put").mockImplementationOnce(async (...args) => {
      await originalPut(...args);
      throw new Error("synthetic response lost");
    });
    await expect(approvals.locked(owner, preview.id, async () => {
      await approvals.validateUiChallenge(owner, preview.id, challenge);
      return approvals.approve(owner, preview.id, true);
    })).rejects.toThrow("synthetic response lost");
    const recovered = await approvals.locked(owner, preview.id, () => approvals.approve(owner, preview.id, true));
    expect(recovered.status).toBe("approved");
    expect(recovered).not.toHaveProperty("uiChallenge");
    expect(writes).toHaveBeenCalledTimes(1);
    const applied = await approvals.locked(owner, preview.id, () => approvals.complete(owner, preview.id, { saved: true }));
    expect(applied).toMatchObject({ status: "applied", result: { saved: true } });
    expect(applied).not.toHaveProperty("uiChallenge");
    expect(await approvals.locked(owner, preview.id, () => approvals.complete(owner, preview.id, { saved: false }))).toEqual(applied);
    expect(writes).toHaveBeenCalledTimes(2);
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
