import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsVerificationDeliveryError } from "@vmosaic/provider-sign-in/phone";
import * as verificationCode from "@vmosaic/provider-sign-in/verification-code";
import { origin, password, phoneNumber, smsConsent, verificationFixture } from "./contact-verification-fixture.js";

afterEach(() => vi.restoreAllMocks());

describe("phone possession HTTP", () => {
  it.each(["login", "register"])("admits a new phone-only owner from %s after proof, without fabricated email/password or grants", async intent => {
    const ctx = verificationFixture(), saved = vi.spyOn(ctx.store, "createContactVerificationAttempt");
    const started = await ctx.phoneStart(ctx.agent, intent), token = started.body.attemptToken;
    expect(started.status).toBe(202); expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    const phoneCode = ctx.smsDeliveries[0].code;
    expect(ctx.smsDeliveries[0]).toMatchObject({ phoneE164: phoneNumber, code: expect.stringMatching(/^\d{6}$/), operationId: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect((await ctx.phoneComplete(token)).status).toBe(400); expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    const verified = await ctx.phoneVerify(token);
    expect(verified.body).toEqual({ status: "profile_required", returnTo: "/calendar" });
    expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    const created = await ctx.phoneComplete(token); expect(created.status).toBe(201); expect(created.body).toEqual({ returnTo: "/calendar" });
    const user = (await ctx.agent.get("/api/me")).body.user; expect(user).toMatchObject({ email: null, displayName: "Phone Owner" });
    expect((await ctx.store.getUserById(user.id))?.passwordHash).toBeNull();
    expect((await ctx.agent.get("/api/life-links")).body.lifeLinks).toEqual([]);
    expect((await ctx.store.listCalendars(user.id)).items).toMatchObject([{ title: "My Calendar", timeZone: "America/New_York", agentAccess: "none" }]);
    const methods = await ctx.agent.get("/api/account-sign-in-methods");
    expect(methods.body.phone).toEqual({ enabled: true, linked: true, maskedNumber: "•••• 0123" });
    expect(methods.body).not.toHaveProperty("phoneHash");
    for (const value of [phoneNumber, phoneCode, token]) {
      expect(JSON.stringify(ctx.events)).not.toContain(value); expect(JSON.stringify(saved.mock.calls)).not.toContain(value);
    }
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    const returning = await ctx.phoneStart(), loggedIn = await ctx.phoneVerify(returning.body.attemptToken);
    expect(loggedIn.body).toEqual({ status: "signed_in", returnTo: "/calendar" });
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(user.id);
    expect((await ctx.phoneComplete(returning.body.attemptToken)).status).toBe(409);
  });

  it("requires explicit versioned verification consent, an allowed destination and browser Origin before delivery", async () => {
    const ctx = verificationFixture();
    for (const patch of [{ smsConsent: undefined }, { smsConsent: false }, { smsConsentVersion: "old-version" },
      { smsConsentVersion: "life-links-sms-verification-v1" },
      { phoneNumber: "2025550123" }, { phoneNumber: "+442071234567" }, { extra: true }]) {
      const response = await ctx.phoneStart(ctx.agent, "login", patch); expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect((await ctx.agent.post("/api/auth/phone/start").send({ phoneNumber, intent: "login", ...smsConsent })).status).toBe(403);
    expect(ctx.smsSend).not.toHaveBeenCalled();
    const disabled = verificationFixture({ phone: false }); expect((await disabled.phoneStart()).status).toBe(503);
    expect(disabled.smsSend).not.toHaveBeenCalled();
  });

  it("uses actual parsed regions rather than admitting every +1 destination", async () => {
    const ctx = verificationFixture(); ctx.config.contactVerification!.phone!.allowedRegions = ["US"];
    for (const number of ["+14165550123", "+12423651234", "+17875550123", "+1202", "+12025550123 ext 1", "Call +12025550123"]) {
      expect((await ctx.phoneStart(ctx.agent, "login", { phoneNumber: number })).status).toBeGreaterThanOrEqual(400);
    }
    expect(ctx.smsSend).not.toHaveBeenCalled();
    ctx.config.contactVerification!.phone!.allowedRegions = ["CA"];
    expect((await ctx.phoneStart(ctx.agent, "login", { phoneNumber: "+14165550123" })).status).toBe(202);
    expect(ctx.smsSend).toHaveBeenCalledTimes(1);
  });

  it("refuses wrong-browser/channel proofs and code guesses without account creation", async () => {
    const ctx = verificationFixture(), started = await ctx.phoneStart(), token = started.body.attemptToken, stranger = request.agent(ctx.app);
    const phoneCode = ctx.smsDeliveries[0].code;
    expect((await ctx.phoneVerify(token, phoneCode, stranger)).status).toBe(400);
    expect((await ctx.agent.post("/api/auth/email/verify").set("Origin", origin).send({ attemptToken: token, code: phoneCode })).status).toBe(400);
    expect((await ctx.phoneVerify(token, "1234")).status).toBe(400);
    const wrong = phoneCode === "000000" ? "111111" : "000000";
    for (let index = 0; index < 5; index++) expect((await ctx.phoneVerify(token, wrong)).status).toBe(400);
    expect((await ctx.phoneVerify(token)).status).toBe(400); expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    expect((await ctx.phoneComplete(token)).status).toBe(400); expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
  });

  it("refuses a delivered code from another address, purpose or channel attempt", async () => {
    vi.spyOn(verificationCode, "generateVerificationCode").mockReturnValueOnce("123456").mockReturnValueOnce("654321").mockReturnValueOnce("111111");
    const ctx = verificationFixture(), first = await ctx.phoneStart();
    const other = await ctx.phoneStart(ctx.agent, "register", { phoneNumber: "+14165550123" });
    const email = await ctx.emailStart();
    expect((await ctx.phoneVerify(other.body.attemptToken, "123456")).status).toBe(400);
    expect((await ctx.phoneVerify(first.body.attemptToken, "111111")).status).toBe(400);
    expect((await ctx.emailVerify(email.body.attemptToken, "654321")).status).toBe(400);
    expect((await ctx.phoneVerify(first.body.attemptToken, "123456")).body.status).toBe("profile_required");
    expect((await ctx.phoneVerify(other.body.attemptToken, "654321")).body.status).toBe("profile_required");
    expect((await ctx.emailVerify(email.body.attemptToken, "111111")).body.status).toBe("verified");
    expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
  });

  it("enforces manual resend cooldown under the original expiry and send quota", async () => {
    const ctx = verificationFixture(), started = await ctx.phoneStart(), token = started.body.attemptToken;
    const resend = () => ctx.agent.post("/api/auth/phone/resend").set("Origin", origin).send({ attemptToken: token });
    const first = ctx.smsDeliveries[0];
    expect((await resend()).status).toBe(429); expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    const sampled = Date.now(), now = vi.spyOn(Date, "now").mockReturnValue(sampled + 61_000);
    const newCode = first.code === "123456" ? "654321" : "123456";
    vi.spyOn(verificationCode, "generateVerificationCode").mockReturnValueOnce(newCode);
    const resent = await resend(); expect(resent.status).toBe(202); expect(resent.body.expiresAt).toBe(started.body.expiresAt);
    expect(ctx.smsSend).toHaveBeenCalledTimes(2); expect(ctx.smsDeliveries[1].operationId).not.toBe(first.operationId);
    expect((await ctx.phoneVerify(token, first.code)).status).toBe(400);
    expect((await ctx.phoneVerify(token, newCode)).body.status).toBe("profile_required");
    now.mockReturnValue(sampled + 601_000); expect((await ctx.phoneVerify(token)).status).toBe(400); expect((await resend()).status).toBe(400);
    expect((await ctx.phoneComplete(token)).status).toBe(400);
  });

  it("persists only the original minimal consent receipt before dispatch and reuses it for a resend", async () => {
    const ctx = verificationFixture(), recorded = vi.spyOn(ctx.store, "recordSmsVerificationConsent");
    const started = await ctx.phoneStart(), receipt = recorded.mock.calls[0][0];
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(recorded.mock.invocationCallOrder[0]).toBeLessThan(ctx.smsSend.mock.invocationCallOrder[0]);
    expect(await recorded.mock.results[0].value).toBe(true);
    expect(Object.keys(receipt).sort()).toEqual(["consentedAt", "disclosureVersion", "expiresAt", "phoneHash", "receiptHash"]);
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/); expect(receipt.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.disclosureVersion).toBe("life-links-sms-verification-v2");
    expect(Date.parse(receipt.expiresAt) - Date.parse(receipt.consentedAt)).toBe(90 * 24 * 60 * 60_000);
    expect(JSON.stringify(receipt)).not.toContain(phoneNumber);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const resent = await ctx.agent.post("/api/auth/phone/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    expect(resent.status).toBe(202); expect(recorded).toHaveBeenCalledTimes(2);
    expect(recorded.mock.calls[1][0]).toEqual(receipt); expect(await recorded.mock.results[1].value).toBe(false);
    expect(ctx.smsSend).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(ctx.events)).not.toContain(receipt.phoneHash);
  });

  it("blocks SMS transport when durable consent persistence fails without logging private diagnostics", async () => {
    const ctx = verificationFixture();
    vi.spyOn(ctx.store, "recordSmsVerificationConsent").mockRejectedValueOnce(new Error("restricted consent database details"));
    const started = await ctx.phoneStart();
    expect(started.status).toBe(503); expect(started.body).toEqual({ error: "verification_unavailable" });
    expect(ctx.smsSend).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.events)).not.toContain("restricted consent database details");
    expect(ctx.events.some(event => event.event === "life_links.verification.send_unknown")).toBe(false);
  });

  it("does not replay an unknown SMS send but accepts its original arrived code", async () => {
    const ctx = verificationFixture(), recorded = vi.spyOn(ctx.store, "recordSmsVerificationConsent");
    ctx.smsSend.mockImplementationOnce(async input => { ctx.smsDeliveries.push({ ...input }); throw new SmsVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const started = await ctx.phoneStart();
    expect(started.status).toBe(202); expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    expect((await ctx.phoneStart(ctx.agent, "register")).status).toBe(503);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const resend = await ctx.agent.post("/api/auth/phone/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    expect(resend.status).toBe(503); expect(resend.body).toEqual({ error: "send_outcome_unknown" });
    expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(await ctx.store.recordSmsVerificationConsent(recorded.mock.calls[0][0])).toBe(false);
    expect((await ctx.phoneVerify(started.body.attemptToken)).body.status).toBe("profile_required");
    expect((await ctx.phoneComplete(started.body.attemptToken)).status).toBe(201);
  });

  it("keeps the original consent receipt when the provider rejects a code", async () => {
    const ctx = verificationFixture(), recorded = vi.spyOn(ctx.store, "recordSmsVerificationConsent");
    ctx.smsSend.mockRejectedValueOnce(new SmsVerificationDeliveryError("rejected", "delivery_rejected"));
    expect((await ctx.phoneStart()).status).toBe(503);
    expect(recorded).toHaveBeenCalledTimes(1); expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    expect(await ctx.store.recordSmsVerificationConsent(recorded.mock.calls[0][0])).toBe(false);
  });

  it("keeps a resend with unknown outcome under the same code, expiry and no-replay rule", async () => {
    const ctx = verificationFixture(), started = await ctx.phoneStart(), original = ctx.smsDeliveries[0];
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const freshCode = original.code === "123456" ? "654321" : "123456";
    vi.spyOn(verificationCode, "generateVerificationCode").mockReturnValueOnce(freshCode);
    ctx.smsSend.mockImplementationOnce(async input => { ctx.smsDeliveries.push({ ...input }); throw new SmsVerificationDeliveryError("unknown", "delivery_outcome_unknown"); });
    const resend = () => ctx.agent.post("/api/auth/phone/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    const unknown = await resend(); expect(unknown.status).toBe(202); expect(unknown.body.expiresAt).toBe(started.body.expiresAt);
    expect((await ctx.phoneVerify(started.body.attemptToken, original.code)).status).toBe(400);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    expect((await resend()).body).toEqual({ error: "send_outcome_unknown" }); expect(ctx.smsSend).toHaveBeenCalledTimes(2);
    expect((await ctx.phoneVerify(started.body.attemptToken, freshCode)).body.status).toBe("profile_required");
  });

  it("serializes manual resends and refuses verification while a fresh delivery is pending", async () => {
    const ctx = verificationFixture(), started = await ctx.phoneStart(), oldCode = ctx.smsDeliveries[0].code;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    let entered!: () => void, release!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; }), completion = new Promise<void>(resolve => { release = resolve; });
    ctx.smsSend.mockImplementationOnce(async input => {
      ctx.smsDeliveries.push({ ...input }); entered(); await completion;
      return { provider: "telnyx", accepted: true, messageId: "synthetic-message-id", operationId: input.operationId };
    });
    const resend = () => ctx.agent.post("/api/auth/phone/resend").set("Origin", origin).send({ attemptToken: started.body.attemptToken });
    const sending = resend().then(response => response);
    try {
      await pending;
      expect((await resend()).status).toBe(429);
      expect((await ctx.phoneVerify(started.body.attemptToken, oldCode)).status).toBe(400);
      expect(ctx.smsSend).toHaveBeenCalledTimes(2);
    } finally { release(); }
    expect((await sending).status).toBe(202);
    expect((await ctx.phoneVerify(started.body.attemptToken)).body.status).toBe("profile_required");
  });

  it("reserves the global SMS budget before any billable delivery", async () => {
    const ctx = verificationFixture(); ctx.config.contactVerification!.phone!.maxSendsPerDay = 1;
    expect((await ctx.phoneStart()).status).toBe(202);
    expect((await ctx.phoneStart(ctx.agent, "register", { phoneNumber: "+14165550123" })).status).toBe(429);
    expect(ctx.smsSend).toHaveBeenCalledTimes(1);
  });

  it.each(["accepted", "rejected", "unknown"] as const)("keeps the rolling recipient cap across UTC midnight after an %s send", async outcome => {
    const ctx = verificationFixture(), first = Date.parse("2026-10-01T21:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(first);
    for (let index = 0; index < 10; index++) {
      now.mockReturnValue(first + index * 16 * 60_000);
      if (index === 9 && outcome !== "accepted") ctx.smsSend.mockRejectedValueOnce(
        new SmsVerificationDeliveryError(outcome, outcome === "unknown" ? "delivery_outcome_unknown" : "delivery_rejected"));
      expect((await ctx.phoneStart()).status).toBe(index === 9 && outcome === "rejected" ? 503 : 202);
    }
    // Each attempt/quarter-hour budget has expired, but midnight cannot reset
    // the recipient's rolling reservations, including unsuccessful deliveries.
    now.mockReturnValue(Date.parse("2026-10-02T00:01:00.000Z"));
    expect((await ctx.phoneStart()).status).toBe(429);
    now.mockReturnValue(first + 24 * 60 * 60_000 - 1);
    expect((await ctx.phoneStart()).status).toBe(429);
    expect(ctx.smsSend).toHaveBeenCalledTimes(10);
    now.mockReturnValue(first + 24 * 60 * 60_000);
    expect((await ctx.phoneStart()).status).toBe(202);
    expect((await ctx.phoneStart()).status).toBe(429);
    expect(ctx.smsSend).toHaveBeenCalledTimes(11);
  });

  it("consumes one verified local attempt only once during concurrent completion", async () => {
    const ctx = verificationFixture(), started = await ctx.phoneStart(); await ctx.phoneVerify(started.body.attemptToken);
    const results = await Promise.all([ctx.phoneComplete(started.body.attemptToken), ctx.phoneComplete(started.body.attemptToken)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    expect((await ctx.phoneVerify(started.body.attemptToken)).status).toBe(400);
    expect((await ctx.phoneComplete(started.body.attemptToken)).status).toBe(400);
  });

  it("keeps returning phone identity independent of delivery message IDs and browser session key rotation", async () => {
    const first = verificationFixture();
    const second = verificationFixture({ store: first.store, sessionSecret: "synthetic-rotated-contact-session-key" });
    const a = await first.phoneStart();
    expect((await first.phoneVerify(a.body.attemptToken)).status).toBe(200);
    expect((await first.phoneComplete(a.body.attemptToken)).status).toBe(201);
    const originalOwner = (await first.agent.get("/api/me")).body.user.id, b = await second.phoneStart();
    expect((await second.phoneVerify(b.body.attemptToken)).body.status).toBe("signed_in");
    expect((await second.agent.get("/api/me")).body.user.id).toBe(originalOwner);
    expect(second.smsSend).toHaveBeenCalledTimes(1);
  });

  it("recovers a lost returning session through fresh possession proof without another owner", async () => {
    const ctx = verificationFixture(), initial = await ctx.phoneStart();
    await ctx.phoneVerify(initial.body.attemptToken); await ctx.phoneComplete(initial.body.attemptToken);
    const originalOwner = (await ctx.agent.get("/api/me")).body.user.id;
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    const returning = await ctx.phoneStart(), issuing = vi.spyOn(ctx.store, "createSession").mockRejectedValueOnce(new Error("private session diagnostics"));
    expect((await ctx.phoneVerify(returning.body.attemptToken)).status).toBe(503);
    expect((await ctx.phoneVerify(returning.body.attemptToken)).status).toBe(400); issuing.mockRestore();
    const fresh = await ctx.phoneStart(); expect((await ctx.phoneVerify(fresh.body.attemptToken)).body.status).toBe("signed_in");
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(originalOwner);
    expect(await ctx.store.listPhoneBindings(originalOwner)).toHaveLength(1);
    expect(JSON.stringify(ctx.events)).not.toContain("private session diagnostics");
  });
});

describe("explicit phone linking HTTP", () => {
  it("links under the original owner session and preserves password/data/grants", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner(), started = await ctx.phoneStart(ctx.agent, "link");
    expect((await ctx.phoneVerify(started.body.attemptToken)).body).toEqual({ status: "linked", returnTo: "/calendar" });
    expect(await ctx.store.getUserById(owner.id)).toEqual(owner);
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(owner.id);
    expect((await ctx.store.listPhoneBindings(owner.id))).toHaveLength(1);
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    expect((await ctx.agent.post("/api/auth/login").set("Origin", origin).send({ email: owner.email, password })).status).toBe(200);
  });

  it.each(["logout", "switch"] as const)("refuses link completion after %s without spending a binding", async change => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner(), started = await ctx.phoneStart(ctx.agent, "link");
    await ctx.agent.post("/api/auth/logout").set("Origin", origin).send({});
    if (change === "switch") await ctx.existingOwner(ctx.agent, "other-owner@example.test");
    const response = await ctx.phoneVerify(started.body.attemptToken);
    expect(response.status).toBe(401); expect(response.body).toEqual({ error: "authentication_required" });
    expect(await ctx.store.listPhoneBindings(owner.id)).toEqual([]);
  });

  it("refuses a logout that commits after the router's live-session read but before atomic link finalization", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner(), started = await ctx.phoneStart(ctx.agent, "link");
    const finalize = ctx.store.finalizeVerifiedPhoneLink.bind(ctx.store);
    const pending = vi.spyOn(ctx.store, "finalizeVerifiedPhoneLink").mockImplementationOnce(async input => {
      await ctx.store.deleteSessionByTokenHash(input.sessionTokenHash); return finalize(input);
    });
    const response = await ctx.phoneVerify(started.body.attemptToken);
    expect(pending).toHaveBeenCalledTimes(1); expect(response.status).toBe(401);
    expect(await ctx.store.listPhoneBindings(owner.id)).toEqual([]);
  });

  it("never reassigns an already linked number to another owner", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner(), first = await ctx.phoneStart(ctx.agent, "link");
    await ctx.phoneVerify(first.body.attemptToken);
    const other = request.agent(ctx.app), otherOwner = await ctx.existingOwner(other, "other-owner@example.test");
    const conflicting = await ctx.phoneStart(other, "link"); expect((await ctx.phoneVerify(conflicting.body.attemptToken, ctx.smsDeliveries.at(-1)!.code, other)).status).toBe(400);
    expect(await ctx.store.listPhoneBindings(otherOwner.id)).toEqual([]); expect(await ctx.store.listPhoneBindings(owner.id)).toHaveLength(1);
  });
});
