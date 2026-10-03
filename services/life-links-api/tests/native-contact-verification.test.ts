import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as verificationCode from "@vmosaic/provider-sign-in/verification-code";
import { origin, password, phoneNumber, smsConsent, verificationFixture } from "./contact-verification-fixture.js";

type Fixture = ReturnType<typeof verificationFixture>;
type Challenge = { attemptToken: string; verificationBinding: string };
const verificationHeader = "X-LifeLinks-Verification";
const returnTo = "/calendar?view=week";

// Use a fresh HTTP client for every request: native admission and subsequent
// bearer authentication must work without a browser cookie jar.
function nativePost(ctx: Fixture, path: string, input: Record<string, unknown>, challenge?: Challenge, bearer?: string) {
  const pending = request(ctx.app).post(path);
  if (challenge) pending.set(verificationHeader, challenge.verificationBinding);
  if (bearer) pending.set("Authorization", `Bearer ${bearer}`);
  return pending.send({ ...input, client: "native" });
}

function nativePhoneStart(ctx: Fixture, intent = "login", bearer?: string) {
  return nativePost(ctx, "/api/auth/phone/start", { phoneNumber, intent, returnTo, ...smsConsent }, undefined, bearer);
}

function nativePhoneVerify(ctx: Fixture, challenge: Challenge, bearer?: string) {
  return nativePost(ctx, "/api/auth/phone/verify", {
    attemptToken: challenge.attemptToken, code: ctx.smsDeliveries.at(-1)!.code,
  }, challenge, bearer);
}

function expectNoSessionCookie(response: { headers: Record<string, unknown> }) {
  const cookies = response.headers["set-cookie"];
  expect(cookies === undefined || (Array.isArray(cookies) && cookies.every(value =>
    typeof value === "string" && !value.startsWith("life_links_session=")))).toBe(true);
}

function expectChallenge(response: { status: number; body: Challenge; headers: Record<string, unknown> }) {
  expect(response.status).toBe(202);
  expect(response.body.attemptToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(response.body.verificationBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(response.body.verificationBinding).not.toBe(response.body.attemptToken);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["set-cookie"]).toBeUndefined();
}

async function nativeLogin(ctx: Fixture, email: string) {
  const result = await nativePost(ctx, "/api/auth/login", { email, password });
  expect(result.status).toBe(200);
  expect(result.body.sessionToken).toEqual(expect.any(String));
  expectNoSessionCookie(result);
  return result.body.sessionToken as string;
}

afterEach(() => vi.restoreAllMocks());

describe("native verified contact admission", () => {
  it("creates a private email owner only after possession and profile completion, then revokes its bearer on logout", async () => {
    const ctx = verificationFixture(), email = "native-owner@example.test";
    const sessions = vi.spyOn(ctx.store, "createSession"), finalize = vi.spyOn(ctx.store, "finalizeVerifiedRegistration");
    const started = await nativePost(ctx, "/api/auth/email/start", { email, returnTo });
    expectChallenge(started);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(await ctx.store.getUserByEmail(email)).toBeNull();
    const complete = (extra: Record<string, unknown> = {}) => nativePost(ctx, "/api/auth/register", {
      attemptToken: started.body.attemptToken, displayName: "Native Owner", password,
      timeZone: "America/New_York", ...extra,
    }, started.body);
    expect((await complete()).status).toBe(400);
    expect(sessions).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();

    const verified = await nativePost(ctx, "/api/auth/email/verify", {
      attemptToken: started.body.attemptToken, code: ctx.deliveries[0].code,
    }, started.body);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ status: "verified" });
    expectNoSessionCookie(verified);
    expect(await ctx.store.getUserByEmail(email)).toBeNull();
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
    expect(sessions).not.toHaveBeenCalled();
    expect((await complete({ timeZone: "invalid/time-zone" })).status).toBe(400);
    expect(finalize).not.toHaveBeenCalled();

    const created = await complete();
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ returnTo, user: { email, displayName: "Native Owner" },
      agentConnection: { connected: false, connectedAt: null, toolCatalogId: null }, qrBaseUrl: origin,
      sessionToken: expect.any(String) });
    expectNoSessionCookie(created);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveBeenCalledTimes(1);
    const owner = await ctx.store.getUserById(created.body.user.id);
    expect(owner?.emailVerifiedAt).toEqual(expect.any(String));
    const calendars = (await ctx.store.listCalendars(created.body.user.id)).items;
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({ title: "My Calendar", timeZone: "America/New_York", agentAccess: "none" });
    expect((await request(ctx.app).get("/api/life-links").set("Authorization", `Bearer ${created.body.sessionToken}`)).body.lifeLinks).toEqual([]);
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
    const me = await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${created.body.sessionToken}`);
    expect(me.body).toEqual({ user: created.body.user, agentConnection: created.body.agentConnection, qrBaseUrl: origin });
    expect((await complete()).status).toBe(400);
    expect(finalize).toHaveBeenCalledTimes(1);

    expect((await nativePost(ctx, "/api/auth/logout", {}, undefined, created.body.sessionToken)).status).toBe(204);
    expect((await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${created.body.sessionToken}`)).body.user).toBeNull();
    expect((await request(ctx.app).get("/api/life-links").set("Authorization", `Bearer ${created.body.sessionToken}`)).status).toBe(401);
    const returningToken = await nativeLogin(ctx, email);
    expect((await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${returningToken}`)).body.user.id).toBe(created.body.user.id);
    for (const secret of [started.body.attemptToken, started.body.verificationBinding, ctx.deliveries[0].code,
      created.body.sessionToken, returningToken]) expect(JSON.stringify(ctx.events)).not.toContain(secret);
  });

  it.each(["login", "register"])("admits a new phone owner from native %s, and returns to that owner after fresh possession", async intent => {
    const ctx = verificationFixture(), sessions = vi.spyOn(ctx.store, "createSession");
    const started = await nativePhoneStart(ctx, intent);
    expectChallenge(started);
    const complete = () => nativePost(ctx, "/api/auth/phone/complete", {
      attemptToken: started.body.attemptToken, displayName: "Native Phone Owner", timeZone: "America/New_York",
    }, started.body);
    expect((await complete()).status).toBe(400);
    expect(sessions).not.toHaveBeenCalled();
    const verified = await nativePhoneVerify(ctx, started.body);
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({ status: "profile_required", returnTo });
    expectNoSessionCookie(verified);
    expect(sessions).not.toHaveBeenCalled();
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
    const created = await complete();
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ returnTo, user: { email: null, displayName: "Native Phone Owner" },
      agentConnection: { connected: false, connectedAt: null, toolCatalogId: null }, qrBaseUrl: origin,
      sessionToken: expect.any(String) });
    expectNoSessionCookie(created);
    const owner = await ctx.store.getUserById(created.body.user.id);
    expect(owner?.passwordHash).toBeNull();
    expect(await ctx.store.listPhoneBindings(created.body.user.id)).toHaveLength(1);
    const calendars = (await ctx.store.listCalendars(created.body.user.id)).items;
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({ title: "My Calendar", timeZone: "America/New_York", agentAccess: "none" });
    const methods = await request(ctx.app).get("/api/account-sign-in-methods").set("Authorization", `Bearer ${created.body.sessionToken}`);
    expect(methods.body.phone).toEqual({ enabled: true, linked: true, maskedNumber: "•••• 0123" });
    expect(methods.body).not.toHaveProperty("phoneHash");
    expect((await request(ctx.app).get("/api/life-links").set("Authorization", `Bearer ${created.body.sessionToken}`)).body.lifeLinks).toEqual([]);

    await nativePost(ctx, "/api/auth/logout", {}, undefined, created.body.sessionToken);
    const returning = await nativePhoneStart(ctx), signedIn = await nativePhoneVerify(ctx, returning.body);
    expectChallenge(returning);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ status: "signed_in", returnTo, user: created.body.user,
      agentConnection: created.body.agentConnection, qrBaseUrl: origin, sessionToken: expect.any(String) });
    expectNoSessionCookie(signedIn);
    expect(signedIn.body.sessionToken).not.toBe(created.body.sessionToken);
    expect((await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${signedIn.body.sessionToken}`)).body.user.id).toBe(created.body.user.id);
    expect(sessions).toHaveBeenCalledTimes(2);
    expect(await ctx.store.listPhoneBindings(created.body.user.id)).toHaveLength(1);
    expect((await ctx.store.listCalendars(created.body.user.id)).items).toEqual(calendars);
    expect((await nativePhoneVerify(ctx, returning.body)).status).toBe(400);
  });

  it("requires the exact original native bearer for a phone link and preserves the owner's password, content and grants", async () => {
    const ctx = verificationFixture(), registered = await ctx.existingOwner();
    const owner = await ctx.store.connectAgent(registered.id, "life-links-calendar-v2");
    const item = await ctx.store.createLifeLink({ id: "native-link-private-item", ownerId: registered.id,
      title: "Retained private item", createdAt: "2026-10-01T12:00:00.000Z" });
    const calendars = (await ctx.store.listCalendars(registered.id)).items;
    const original = await nativeLogin(ctx, registered.email!), started = await nativePhoneStart(ctx, "link", original);
    expectChallenge(started);
    const differentSession = await nativeLogin(ctx, registered.email!);
    const refused = await nativePhoneVerify(ctx, started.body, differentSession);
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: "authentication_required" });
    expect(await ctx.store.listPhoneBindings(registered.id)).toEqual([]);
    const linked = await nativePhoneVerify(ctx, started.body, original);
    expect(linked.status).toBe(200);
    expect(linked.body).toEqual({ status: "linked", returnTo });
    expectNoSessionCookie(linked);
    expect(linked.body).not.toHaveProperty("sessionToken");
    expect(await ctx.store.listPhoneBindings(registered.id)).toHaveLength(1);
    expect(await ctx.store.getUserById(registered.id)).toEqual(owner);
    expect((await ctx.store.getLifeLinkDetail(registered.id, item.id))?.lifeLink).toEqual(item);
    expect((await ctx.store.listCalendars(registered.id)).items).toEqual(calendars);
    await nativePost(ctx, "/api/auth/logout", {}, undefined, original);
    const returning = await nativePhoneStart(ctx), signedIn = await nativePhoneVerify(ctx, returning.body);
    expect(signedIn.body).toMatchObject({ status: "signed_in", user: { id: registered.id },
      agentConnection: { connected: true, toolCatalogId: "life-links-calendar-v2" } });
    expectNoSessionCookie(signedIn);
    expect((await request(ctx.app).get(`/api/life-links/${item.id}`).set("Authorization", `Bearer ${signedIn.body.sessionToken}`)).body.detail.lifeLink).toEqual(item);
    expect(await nativeLogin(ctx, registered.email!)).toEqual(expect.any(String));
    expect(await ctx.store.getUserById(registered.id)).toEqual(owner);
  });

  it.each(["revoked", "different-owner", "missing"])("refuses native phone linking with a %s bearer without creating a binding", async change => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner();
    const original = await nativeLogin(ctx, owner.email!), started = await nativePhoneStart(ctx, "link", original);
    expectChallenge(started);
    let completing: string | undefined = original;
    let otherId: string | undefined;
    if (change === "revoked") await nativePost(ctx, "/api/auth/logout", {}, undefined, original);
    if (change === "missing") completing = undefined;
    if (change === "different-owner") {
      const other = await ctx.existingOwner(ctx.agent, "other-native-owner@example.test");
      otherId = other.id;
      completing = await nativeLogin(ctx, other.email!);
    }
    const finalized = vi.spyOn(ctx.store, "finalizeVerifiedPhoneLink"), result = await nativePhoneVerify(ctx, started.body, completing);
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "authentication_required" });
    expect(finalized).not.toHaveBeenCalled();
    expect(await ctx.store.listPhoneBindings(owner.id)).toEqual([]);
    if (otherId) expect(await ctx.store.listPhoneBindings(otherId)).toEqual([]);
  });

  it("does not accept a browser session cookie as native phone-link authority", async () => {
    const ctx = verificationFixture(), owner = await ctx.existingOwner();
    const started = await ctx.phoneStart(ctx.agent, "link");
    expect(started.status).toBe(202);
    // This agent owns a valid browser login, but deliberately has no bearer.
    const refused = await ctx.agent.post("/api/auth/phone/start").send({
      client: "native", phoneNumber, intent: "link", returnTo, ...smsConsent,
    });
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: "authentication_required" });
    expect(ctx.smsSend).toHaveBeenCalledTimes(1);
    expect(await ctx.store.listPhoneBindings(owner.id)).toEqual([]);
    expect((await ctx.phoneVerify(started.body.attemptToken)).body.status).toBe("linked");
  });

  it.each(["email", "phone"] as const)("binds %s attempts to their original transport and private native verification binding", async channel => {
    const ctx = verificationFixture(), sessions = vi.spyOn(ctx.store, "createSession");
    const started = channel === "email" ? await nativePost(ctx, "/api/auth/email/start", { email: "native-bound@example.test", returnTo }) :
      await nativePhoneStart(ctx);
    expectChallenge(started);
    const code = channel === "email" ? ctx.deliveries.at(-1)!.code : ctx.smsDeliveries.at(-1)!.code;
    const input = { attemptToken: started.body.attemptToken, code }, path = `/api/auth/${channel}/verify`;
    expect((await nativePost(ctx, path, input)).status).toBe(403);
    expect((await request(ctx.app).post(path).set("Cookie", `life_links_contact_verification=${started.body.verificationBinding}`)
      .send({ ...input, client: "native" })).status).toBe(403);
    expect((await nativePost(ctx, path, input, { ...started.body, verificationBinding: "A".repeat(43) })).status).toBe(400);
    // Even possession of both native values cannot turn the attempt into a
    // browser transaction by copying its binding into the browser cookie.
    expect((await request(ctx.app).post(path).set("Origin", origin)
      .set("Cookie", `life_links_contact_verification=${started.body.verificationBinding}`).send(input)).status).toBe(400);
    expect((await nativePost(ctx, path, input, started.body)).status).toBe(200);

    const browserStart = channel === "email" ? await ctx.emailStart(ctx.agent, "browser-bound@example.test") :
      await ctx.phoneStart(ctx.agent, "register", { phoneNumber: "+14165550123" });
    expect(browserStart.status).toBe(202);
    expect(browserStart.body).not.toHaveProperty("verificationBinding");
    const browserCookies = browserStart.headers["set-cookie"] as unknown as string[];
    const browserBinding = browserCookies.find(value => value.startsWith("life_links_contact_verification="))!
      .split(";", 1)[0].slice("life_links_contact_verification=".length);
    const browserCode = channel === "email" ? ctx.deliveries.at(-1)!.code : ctx.smsDeliveries.at(-1)!.code;
    expect((await nativePost(ctx, path, { attemptToken: browserStart.body.attemptToken, code: browserCode },
      { attemptToken: browserStart.body.attemptToken, verificationBinding: browserBinding })).status).toBe(400);
    const browserVerified = channel === "email" ? await ctx.emailVerify(browserStart.body.attemptToken, browserCode) :
      await ctx.phoneVerify(browserStart.body.attemptToken, browserCode);
    expect(browserVerified.status).toBe(200);
    expect(sessions).not.toHaveBeenCalled();
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
  });

  it.each(["email", "phone"] as const)("retains the native %s binding across an explicit resend and replaces the old code", async channel => {
    const ctx = verificationFixture();
    const started = channel === "email" ? await nativePost(ctx, "/api/auth/email/start", { email: "native-resend@example.test", returnTo }) :
      await nativePhoneStart(ctx);
    expectChallenge(started);
    const original = channel === "email" ? ctx.deliveries[0].code : ctx.smsDeliveries[0].code;
    const input = { attemptToken: started.body.attemptToken }, resendPath = `/api/auth/${channel}/resend`;
    expect((await nativePost(ctx, resendPath, input)).status).toBe(403);
    expect((await nativePost(ctx, resendPath, input, started.body)).status).toBe(429);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    const fresh = original === "123456" ? "654321" : "123456";
    vi.spyOn(verificationCode, "generateVerificationCode").mockReturnValueOnce(fresh);
    const resent = await nativePost(ctx, resendPath, input, started.body);
    expectChallenge(resent);
    expect(resent.body).toMatchObject({ attemptToken: started.body.attemptToken,
      verificationBinding: started.body.verificationBinding, expiresAt: started.body.expiresAt });
    expect(channel === "email" ? ctx.send : ctx.smsSend).toHaveBeenCalledTimes(2);
    const verifyPath = `/api/auth/${channel}/verify`;
    expect((await nativePost(ctx, verifyPath, { ...input, code: original }, started.body)).status).toBe(400);
    const verified = await nativePost(ctx, verifyPath, { ...input, code: fresh }, started.body);
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe(channel === "email" ? "verified" : "profile_required");
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
  });

  it.each([
    ["Origin", origin], ["Referer", `${origin}/register`], ["Sec-Fetch-Site", "same-origin"],
    ["Sec-Fetch-Mode", "cors"], ["Sec-Fetch-Dest", "empty"], ["Sec-Fetch-User", "?1"],
  ])("refuses a claimed native start carrying browser %s metadata before sending either code", async (header, value) => {
    // The fixture disables its general Origin guard; these contact-auth
    // boundaries must remain mandatory rather than inherit that test setting.
    const ctx = verificationFixture(), attempts = vi.spyOn(ctx.store, "createContactVerificationAttempt");
    const reservations = vi.spyOn(ctx.store, "reserveVerificationLimits"), consent = vi.spyOn(ctx.store, "recordSmsVerificationConsent");
    const email = await request(ctx.app).post("/api/auth/email/start").set(header, value)
      .send({ client: "native", email: "browser-claimed-native@example.test", returnTo });
    const phone = await request(ctx.app).post("/api/auth/phone/start").set(header, value)
      .send({ client: "native", phoneNumber, intent: "register", returnTo, ...smsConsent });
    expect([400, 403]).toContain(email.status);
    expect([400, 403]).toContain(phone.status);
    expect(ctx.send).not.toHaveBeenCalled();
    expect(ctx.smsSend).not.toHaveBeenCalled();
    expect(attempts).not.toHaveBeenCalled();
    expect(reservations).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
  });

  it("keeps disabled native phone signup unavailable without delivery, consent, budget or account effects", async () => {
    const ctx = verificationFixture({ phone: false });
    const attempts = vi.spyOn(ctx.store, "createContactVerificationAttempt"), reservations = vi.spyOn(ctx.store, "reserveVerificationLimits");
    const consent = vi.spyOn(ctx.store, "recordSmsVerificationConsent"), finalize = vi.spyOn(ctx.store, "finalizeVerifiedRegistration");
    const sessions = vi.spyOn(ctx.store, "createSession");
    expect((await request(ctx.app).get("/api/auth/registration")).body.phoneVerificationEnabled).toBe(false);
    const response = await nativePhoneStart(ctx, "register");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "verification_unavailable" });
    expectNoSessionCookie(response);
    expect(ctx.smsSend).not.toHaveBeenCalled();
    expect(attempts).not.toHaveBeenCalled();
    expect(reservations).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(sessions).not.toHaveBeenCalled();
    expect((await request(ctx.app).get("/api/me")).body.user).toBeNull();
  });
});
