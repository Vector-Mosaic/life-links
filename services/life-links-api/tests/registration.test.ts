import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailVerificationDeliveryError } from "@vmosaic/provider-sign-in/email";
import { invitationFingerprint } from "../src/registration.js";
import { verifyPassword } from "../src/password.js";
import { origin, password, verificationFixture } from "./contact-verification-fixture.js";

afterEach(() => vi.restoreAllMocks());

describe("public verified email registration", () => {
  it("advertises actual channels independently of invitations and sends nothing during discovery", async () => {
    const ctx = verificationFixture({ phone: false }); ctx.config.memberInvitationsEnabled = false;
    const response = await ctx.agent.get("/api/auth/registration");
    expect(response.body).toEqual({ enabled: true, emailVerificationEnabled: true, phoneVerificationEnabled: false });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(ctx.send).not.toHaveBeenCalled(); expect(ctx.smsSend).not.toHaveBeenCalled();
    const disabled = verificationFixture({ email: false, phone: false });
    expect((await disabled.emailStart()).body).toEqual({ error: "verification_unavailable" });
    expect(disabled.send).not.toHaveBeenCalled();
  });

  it("creates no owner or session before mailbox proof, then admits an isolated verified owner", async () => {
    const ctx = verificationFixture(), saved = vi.spyOn(ctx.store, "createContactVerificationAttempt");
    const started = await ctx.emailStart(ctx.agent, "  New-Owner@Example.Test  ");
    expect(started.status).toBe(202); expect(started.body.resendAfterSeconds).toBe(60);
    expect(started.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(started.headers["cache-control"]).toBe("private, no-store");
    expect(ctx.deliveries[0].email).toBe("new-owner@example.test");
    expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    expect((await ctx.register(started.body.attemptToken)).body).toEqual({ error: "invalid_verification" });
    expect((await ctx.emailVerify(started.body.attemptToken)).body).toEqual({ status: "verified" });
    expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    const created = await ctx.register(started.body.attemptToken, { displayName: "  Private Owner  " });
    expect(created.status).toBe(201); expect(created.body.user).toMatchObject({ email: "new-owner@example.test", displayName: "Private Owner" });
    expect(created.body).not.toHaveProperty("sessionToken"); expect(created.body.agentConnection.connected).toBe(false);
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(created.body.user.id);
    expect((await ctx.agent.get("/api/life-links")).body.lifeLinks).toEqual([]);
    const owner = (await ctx.store.getUserByEmail("new-owner@example.test"))!;
    expect(owner.emailVerifiedAt).toEqual(expect.any(String)); expect(await verifyPassword(password, owner.passwordHash)).toBe(true);
    expect((await ctx.store.listCalendars(owner.id)).items).toMatchObject([{ title: "My Calendar", timeZone: "America/New_York", isDefault: true, agentAccess: "none" }]);
    const sessionHash = vi.spyOn(ctx.store, "getSessionByTokenHash"); await ctx.agent.get("/api/me");
    expect((await sessionHash.mock.results.at(-1)!.value)?.user.emailVerifiedAt).toBe(owner.emailVerifiedAt);
    for (const value of ["new-owner@example.test", ctx.deliveries[0].code, started.body.attemptToken, password]) {
      expect(JSON.stringify(ctx.events)).not.toContain(value); expect(JSON.stringify(saved.mock.calls)).not.toContain(value);
    }
  });

  it("binds proof to its browser/address, refuses editable email, and consumes concurrent creation once", async () => {
    const ctx = verificationFixture(), started = await ctx.emailStart(), token = started.body.attemptToken, stranger = request.agent(ctx.app);
    expect((await ctx.emailVerify(token, ctx.deliveries[0].code, stranger)).status).toBe(400); await ctx.emailVerify(token);
    expect((await ctx.register(token, { email: "replacement@example.test" })).status).toBe(400);
    expect((await ctx.register(token, {}, stranger)).status).toBe(400);
    const results = await Promise.all([ctx.register(token), ctx.register(token)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    expect((await ctx.register(token)).body).toEqual({ error: "invalid_verification" });
    expect(await ctx.store.getUserByEmail("replacement@example.test")).toBeNull();
  });

  it("preserves existing owners and credentials on case-insensitive email collision", async () => {
    const ctx = verificationFixture(), existing = await ctx.existingOwner();
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    const started = await ctx.emailStart(ctx.agent, existing.email!.toUpperCase()); await ctx.emailVerify(started.body.attemptToken);
    const response = await ctx.register(started.body.attemptToken, { password: "never-replace-this-password" });
    expect(response.status).toBe(409); expect(response.body).toEqual({ error: "signup_failed" });
    expect(await ctx.store.getUserById(existing.id)).toEqual(existing);
    expect((await ctx.agent.post("/api/auth/login").set("Origin", origin).send({ email: existing.email, password })).status).toBe(200);
  });

  it("bounds code guesses, resend timing and expiry without creating an account", async () => {
    const ctx = verificationFixture(), started = await ctx.emailStart(), token = started.body.attemptToken;
    expect((await ctx.agent.post("/api/auth/email/resend").set("Origin", origin).send({ attemptToken: token })).body).toEqual({ error: "verification_rate_limited" });
    const wrong = ctx.deliveries[0].code === "000000" ? "111111" : "000000";
    for (let index = 0; index < 5; index++) expect((await ctx.emailVerify(token, wrong)).status).toBe(400);
    expect((await ctx.emailVerify(token)).status).toBe(400);
    expect(ctx.send).toHaveBeenCalledTimes(1); expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    const second = verificationFixture(), fresh = await second.emailStart(); await second.emailVerify(fresh.body.attemptToken);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
    expect((await second.register(fresh.body.attemptToken)).body).toEqual({ error: "invalid_verification" });
  });

  it("manually reconciles unknown email delivery using the same operation and payload without spending a second delivery budget", async () => {
    const ctx = verificationFixture();
    ctx.config.contactVerification!.email!.maxSendsPerDay = 1;
    ctx.send.mockImplementationOnce(async input => { ctx.deliveries.push({ ...input }); throw new EmailVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const started = await ctx.emailStart(), first = { ...ctx.deliveries[0] };
    expect(started.status).toBe(202); expect(ctx.send).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect((await ctx.agent.post("/api/auth/email/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken })).status).toBe(202);
    expect(ctx.send).toHaveBeenCalledTimes(2); expect(ctx.deliveries[1]).toEqual(first);
    expect((await ctx.emailVerify(started.body.attemptToken)).status).toBe(200);
  });

  it("keeps an arrived email code usable after an unknown gateway deadline without another send", async () => {
    const ctx = verificationFixture();
    ctx.send.mockImplementationOnce(async input => { ctx.deliveries.push({ ...input }); throw new EmailVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const started = await ctx.emailStart();
    expect(started.status).toBe(202); expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    expect((await ctx.emailStart()).status).toBe(503); expect(ctx.send).toHaveBeenCalledTimes(1);
    expect((await ctx.register(started.body.attemptToken)).status).toBe(400);
    expect((await ctx.emailVerify(started.body.attemptToken)).body).toEqual({ status: "verified" });
    expect((await ctx.register(started.body.attemptToken)).status).toBe(201);
    expect(ctx.send).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a definite gateway rejection and permits a separately budgeted fresh request", async () => {
    const ctx = verificationFixture();
    ctx.send.mockRejectedValueOnce(new EmailVerificationDeliveryError("rejected", "delivery_rejected"));
    const rejected = await ctx.emailStart();
    expect(rejected.status).toBe(503); expect(rejected.body).toEqual({ error: "verification_unavailable" });
    expect(rejected.body).not.toHaveProperty("attemptToken");
    expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    const fresh = await ctx.emailStart(); expect(fresh.status).toBe(202); expect(ctx.send).toHaveBeenCalledTimes(2);
    expect((await ctx.emailVerify(fresh.body.attemptToken)).body).toEqual({ status: "verified" });
  });

  it.each([
    { gatewayBaseUrl: "https://changed-communications.example.test" },
    { bearerToken: "synthetic-replacement-application-mail-token" },
    { senderMailbox: "changed-agents@example.test" },
    { appDisplayName: "Changed LifeLinks" },
  ])("refuses uncertain-operation reconciliation under changed sender or caller context %j", async emailSenderConfig => {
    const ctx = verificationFixture();
    ctx.send.mockImplementationOnce(async input => { ctx.deliveries.push({ ...input }); throw new EmailVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const started = await ctx.emailStart(), original = ctx.deliveries[0];
    const replacement = verificationFixture({ store: ctx.store, emailSenderConfig });
    const cookie = started.headers["set-cookie"].map((value: string) => value.split(";")[0]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const refused = await request(replacement.app).post("/api/auth/email/resend").set("Origin", origin).set("Cookie", cookie)
      .send({ attemptToken: started.body.attemptToken });
    expect(refused.status).toBe(503); expect(refused.body).toEqual({ error: "send_outcome_unknown" });
    expect(replacement.send).not.toHaveBeenCalled(); expect(ctx.send).toHaveBeenCalledTimes(1);
    const verified = await request(replacement.app).post("/api/auth/email/verify").set("Origin", origin).set("Cookie", cookie)
      .send({ attemptToken: started.body.attemptToken, code: original.code });
    expect(verified.body).toEqual({ status: "verified" });
    expect(await ctx.store.getUserByEmail("new-owner@example.test")).toBeNull();
    for (const value of Object.values(emailSenderConfig)) expect(JSON.stringify(replacement.events)).not.toContain(value);
  });

  it("serializes same-operation email reconciliation and refuses code checks while it is pending", async () => {
    const ctx = verificationFixture();
    ctx.send.mockImplementationOnce(async input => { ctx.deliveries.push({ ...input }); throw new EmailVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const started = await ctx.emailStart(), original = ctx.deliveries[0];
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    let entered!: () => void, release!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; }), completion = new Promise<void>(resolve => { release = resolve; });
    ctx.send.mockImplementationOnce(async input => {
      ctx.deliveries.push({ ...input }); entered(); await completion;
      return { provider: "agent_communications", accepted: true, messageId: "synthetic-message-id", operationId: input.operationId };
    });
    const resend = () => ctx.agent.post("/api/auth/email/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    const sending = resend().then(response => response);
    try {
      await pending;
      expect((await resend()).status).toBe(429);
      expect((await ctx.emailVerify(started.body.attemptToken)).status).toBe(400);
      expect(ctx.send).toHaveBeenCalledTimes(2); expect(ctx.deliveries[1]).toEqual(original);
    } finally { release(); }
    const reconciled = await sending;
    expect(reconciled.status).toBe(202); expect(reconciled.body.expiresAt).toBe(started.body.expiresAt);
    expect((await ctx.emailVerify(started.body.attemptToken)).body).toEqual({ status: "verified" });
  });

  it("resends only on request with the original expiry and reserves a global transport budget before sending", async () => {
    const ctx = verificationFixture(), started = await ctx.emailStart(), first = ctx.deliveries[0];
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const resent = await ctx.agent.post("/api/auth/email/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    expect(resent.status).toBe(202); expect(resent.body.expiresAt).toBe(started.body.expiresAt);
    expect(ctx.deliveries[1].operationId).not.toBe(first.operationId);
    expect((await ctx.emailVerify(started.body.attemptToken)).status).toBe(200);
    const bounded = verificationFixture(); bounded.config.contactVerification!.email!.maxSendsPerDay = 1;
    expect((await bounded.emailStart()).status).toBe(202);
    expect((await bounded.emailStart(bounded.agent, "different@example.test")).body).toEqual({ error: "verification_rate_limited" });
    expect(bounded.send).toHaveBeenCalledTimes(1);
  });

  it("requires explicit sign-out before new admission and keeps the existing owner unchanged", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner();
    expect((await ctx.emailStart()).body).toEqual({ error: "sign_out_required" });
    expect((await ctx.phoneStart()).body).toEqual({ error: "sign_out_required" });
    expect(ctx.send).not.toHaveBeenCalled(); expect(ctx.smsSend).not.toHaveBeenCalled();
    expect(await ctx.store.getUserById(owner.id)).toEqual(owner);
  });

  it("recovers a committed account after session failure through password login without recreating it", async () => {
    const ctx = verificationFixture(), started = await ctx.emailStart(); await ctx.emailVerify(started.body.attemptToken);
    const session = vi.spyOn(ctx.store, "createSession").mockRejectedValueOnce(new Error("private driver diagnostics"));
    const failed = await ctx.register(started.body.attemptToken);
    expect(failed.status).toBe(503); expect(failed.body).toEqual({ error: "verification_unavailable" }); session.mockRestore();
    expect((await ctx.agent.post("/api/auth/login").set("Origin", origin).send({ email: "new-owner@example.test", password })).status).toBe(200);
    expect(JSON.stringify(ctx.events)).not.toContain("private driver diagnostics");
  });

  it("requires browser origin, sanitizes parser failures and rejects retired unverified input", async () => {
    const ctx = verificationFixture();
    for (const route of ["/api/auth/email/start", "/API/AUTH/EMAIL/START/", "/api/auth/register/"]) {
      expect((await ctx.agent.post(route).send({ email: "new-owner@example.test" })).body).toEqual({ error: "origin_forbidden" });
      expect((await ctx.agent.post(route).set("Origin", "https://foreign.example.test").set("Referer", `${origin}/register`).send({})).status).toBe(403);
      expect((await ctx.agent.post(route).set("Origin", origin).set("Content-Type", "application/json").send(`{"password":"${password}",`)).body).toEqual({ error: "invalid_verification" });
    }
    expect((await ctx.agent.post("/api/auth/register").set("Origin", origin).send({ displayName: "Owner", email: "new-owner@example.test", password, invitationCode: "synthetic_old_invitation_1234567890" })).status).toBe(400);
    expect((await ctx.agent.post("/api/auth/register").set("Origin", origin).send({ password, displayName: "x".repeat(5000) })).body).toEqual({ error: "invalid_verification" });
    expect(ctx.send).not.toHaveBeenCalled(); expect(JSON.stringify(ctx.events)).not.toContain(password);
  });
});

describe("optional member invitation HTTP", () => {
  it("keeps invitation management owner-scoped and redeems a usable link with verified creation", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner();
    expect((await request(ctx.app).post("/api/account-invitations").set("Origin", origin).send({})).status).toBe(401);
    expect((await ctx.agent.post("/api/account-invitations").send({})).status).toBe(403);
    const created = await ctx.agent.post("/api/account-invitations").set("Origin", origin).send({}); expect(created.status).toBe(201);
    const code = created.body.invitationCode, recipient = request.agent(ctx.app);
    const started = await ctx.emailStart(recipient, "recipient@example.test", { invitationCode: code });
    await ctx.emailVerify(started.body.attemptToken, ctx.deliveries.at(-1)!.code, recipient);
    expect((await ctx.register(started.body.attemptToken, {}, recipient)).status).toBe(201);
    const listing = await ctx.agent.get("/api/account-invitations"); expect(listing.body.invitations[0].redeemedAt).not.toBeNull();
    for (const value of [code, "recipient@example.test", owner.id]) expect(JSON.stringify(listing.body)).not.toContain(value);
    expect((await recipient.delete(`/api/account-invitations/${created.body.invitation.id}`).set("Origin", origin)).status).toBe(404);
    expect((await recipient.post("/api/account-invitations").set("Origin", origin).send({})).status).toBe(201);
    expect(JSON.stringify(ctx.events)).not.toContain(code);
  });

  it.each(["missing", "cancelled", "closed"] as const)("allows public verified signup with a %s invitation", async state => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner();
    const created = await ctx.agent.post("/api/account-invitations").set("Origin", origin).send({});
    if (state === "cancelled") await ctx.agent.delete(`/api/account-invitations/${created.body.invitation.id}`).set("Origin", origin);
    if (state === "closed") ctx.config.memberInvitationsEnabled = false;
    const recipient = request.agent(ctx.app), extra = state === "missing" ? {} : { invitationCode: created.body.invitationCode };
    const started = await ctx.emailStart(recipient, "recipient@example.test", extra);
    await ctx.emailVerify(started.body.attemptToken, ctx.deliveries.at(-1)!.code, recipient);
    expect((await ctx.register(started.body.attemptToken, {}, recipient)).status).toBe(201);
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(owner.id);
    expect((await ctx.store.getMemberInvitation(invitationFingerprint(created.body.invitationCode)))?.redeemedAt).toBeNull();
  });
});
