import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ProviderTransaction, VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { hashPassword } from "../src/password.js";
import { NATIVE_AUTH_REDIRECT_URI } from "../src/native-auth.js";
import { CalendarAuthorizationService } from "../src/calendar-authorization.js";
import { CalendarSecretCipher, InMemoryCalendarSecretStore } from "../src/calendar-secret-store.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import type { GoogleCalendarAuth } from "../src/calendar-google-auth.js";
import type { MicrosoftCalendarAuth } from "../src/calendar-microsoft-auth.js";

const origin = "https://native-sign-in.example.test";
const password = "synthetic-native-owner-password";
const verifier = "synthetic_native_pkce_verifier_" + "a".repeat(40);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const invitationCode = "synthetic_native_signup_invitation_123456789";

function calendarFixture() {
  const secretStore = new InMemoryCalendarSecretStore(), stateStore = new InMemoryCalendarProviderStateStore();
  const calendars = [{ providerCalendarId: "native-calendar", displayName: "Native Calendar",
    capabilities: { read: true, create: true, update: true, delete: true }, events: [] }];
  const gateway = new CalendarProviderGateway([
    new DeterministicFakeCalendarProviderAdapter("google-calendar", "synthetic-google-calendar-owner", calendars),
    new DeterministicFakeCalendarProviderAdapter("microsoft-graph-calendar", "synthetic-microsoft-calendar-owner", calendars)
  ], stateStore);
  const google: GoogleCalendarAuth = {
    authorizationUrl: vi.fn(async ({ state }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`),
    redeem: vi.fn(async () => ({ cache: "synthetic-private-google-calendar-cache", providerAccountId: "synthetic-google-calendar-owner" })),
    refresh: vi.fn(async value => ({ state: value, accessToken: "synthetic-private-google-calendar-access" }))
  };
  const microsoft: MicrosoftCalendarAuth = {
    authorizationUrl: vi.fn(async ({ state }) => `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${state}`),
    redeem: vi.fn(async () => ({ cache: "synthetic-private-microsoft-calendar-cache", homeAccountId: "synthetic-home-account",
      localAccountId: "synthetic-local-account", tenantId: "synthetic-tenant", providerAccountId: "synthetic-microsoft-calendar-owner" })),
    refresh: vi.fn(async value => ({ state: value, accessToken: "synthetic-private-microsoft-calendar-access" }))
  };
  const authorization = new CalendarAuthorizationService(secretStore, new CalendarSecretCipher(randomBytes(32).toString("base64")),
    microsoft, () => gateway, () => new Date(), google);
  return { gateway, authorization, google, microsoft, secretStore };
}

function setup(provider: "google" | "apple" = "google", patch: Partial<VerifiedProviderIdentity> = {}, withCalendar = false) {
  const store = new InMemoryLifeLinksStore(), events: LogEvent[] = [], transactions = new Map<string, ProviderTransaction>();
  const issuer = provider === "apple" ? "https://appleid.apple.com" : "https://accounts.google.com";
  const identity: VerifiedProviderIdentity = { provider, issuer, clientId: "synthetic-native-product-client",
    subject: `synthetic-native-${provider}-subject`, email: `${provider}-owner@example.test`,
    emailVerified: true, displayName: "Native Provider Owner", ...patch };
  const adapter: ProviderAdapter = {
    id: provider, displayName: provider === "apple" ? "Apple" : "Google", responseMode: provider === "apple" ? "form_post" : "query",
    authorizationUrl: vi.fn(async (transaction: ProviderTransaction) => {
      transactions.set(transaction.state, { ...transaction });
      const url = new URL(provider === "apple" ? "https://appleid.apple.com/auth/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", transaction.state); url.searchParams.set("nonce", transaction.nonce);
      url.searchParams.set("code_challenge", createHash("sha256").update(transaction.codeVerifier).digest("base64url"));
      return url.href;
    }),
    redeem: vi.fn(async ({ callbackUrl, transaction }: { callbackUrl: URL; transaction: ProviderTransaction }) => {
      expect(callbackUrl.origin).toBe(origin);
      expect(callbackUrl.pathname).toBe(`/api/auth/providers/${provider}/callback`);
      expect(callbackUrl.searchParams.getAll("state")).toEqual([transaction.state]);
      expect(callbackUrl.searchParams.get("code")).toBe(`synthetic-provider-code-${transaction.state}`);
      expect(callbackUrl.searchParams.get("iss")).toBe(issuer);
      expect(transaction).toEqual(transactions.get(transaction.state));
      return { ...identity };
    })
  };
  const config = readConfig({ NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory",
    SESSION_SECRET: "synthetic-native-session-secret", QR_BASE_URL: origin, COOKIE_SECURE: String(provider === "apple"),
    RATE_LIMIT_ENABLED: "false", ORIGIN_CHECK_ENABLED: "true", ORIGIN_CHECK_ALLOW_MISSING: "false",
    LIFE_LINKS_SIGN_IN_PROVIDERS: "", LIFE_LINKS_REGISTRATION_ENABLED: "true",
    LIFE_LINKS_REGISTRATION_INVITATION_CODE: invitationCode, LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "10",
    LIFE_LINKS_REGISTRATION_EXPIRES_AT: "2099-09-04T04:00:00.000Z", LIFE_LINKS_MEMBER_INVITATIONS_ENABLED: "true" });
  config.providerSignIn = provider === "apple"
    ? [{ id: "apple", clientId: identity.clientId, redirectUri: `${origin}/api/auth/providers/apple/callback`,
      teamId: "SYNTHETIC0", keyId: "FIXTURE000", privateKeyPem: "synthetic-unused-private-key" }]
    : [{ id: "google", clientId: identity.clientId, clientSecret: "synthetic-unused-client-secret",
      redirectUri: `${origin}/api/auth/providers/google/callback` }];
  const calendar = withCalendar ? calendarFixture() : undefined;
  const app = createLifeLinksApp({ store, config, signInAdapters: [adapter],
    ...(calendar ? { calendarProviderGateway: calendar.gateway, calendarAuthorizationService: calendar.authorization } : {}),
    logger: createLogger("native_auth_test", { sink: event => events.push(event) }) });
  return { store, events, transactions, adapter, identity, config, app, browser: request.agent(app), provider, issuer, calendar };
}

type Context = ReturnType<typeof setup>;
type Launch = { response: request.Response; state: string; ticket: string; cookies: string };
const baseRequest = (provider = "google") => ({ client: "native", provider, intent: "login",
  returnTo: "/calendar?view=week", codeChallenge: challenge, redirectUri: NATIVE_AUTH_REDIRECT_URI });

function cookieHeader(response: request.Response): string {
  return ((response.headers["set-cookie"] ?? []) as string[]).map(value => value.split(";")[0]).join("; ");
}
function hasSessionCookie(response: request.Response): boolean {
  return ((response.headers["set-cookie"] ?? []) as string[]).some(value => value.startsWith("life_links_session=") && !value.startsWith("life_links_session=;"));
}
function completionCode(url: string): string {
  const value = new URL(url);
  expect(`${value.protocol}//${value.host}${value.pathname}`).toBe(NATIVE_AUTH_REDIRECT_URI);
  expect([...value.searchParams.keys()]).toEqual(["code"]);
  expect(value.hash).toBe("");
  const code = value.searchParams.get("code")!;
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return code;
}
async function start(ctx: Context, extra: Record<string, unknown> = {}, bearer?: string) {
  const sent = request(ctx.app).post("/api/auth/native/start");
  if (bearer) sent.set("Authorization", `Bearer ${bearer}`);
  const response = await sent.send({ ...baseRequest(ctx.provider), ...extra });
  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(["browserUrl"]);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
  expect(hasSessionCookie(response)).toBe(false);
  const url = new URL(response.body.browserUrl);
  expect(url.origin).toBe(origin); expect(url.pathname).toBe("/api/auth/native/launch");
  expect([...url.searchParams.keys()]).toEqual(["ticket"]);
  expect(url.searchParams.get("ticket")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { browserPath: `${url.pathname}${url.search}`, ticket: url.searchParams.get("ticket")! };
}
async function launch(ctx: Context, extra: Record<string, unknown> = {}, bearer?: string): Promise<Launch> {
  const prepared = await start(ctx, extra, bearer), response = await ctx.browser.get(prepared.browserPath);
  expect(response.status).toBe(303);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  const authorization = new URL(response.headers.location);
  expect(authorization.origin).toBe(ctx.issuer);
  expect(authorization.searchParams.has("sessionToken")).toBe(false);
  expect(authorization.href).not.toContain(verifier);
  const flags = (response.headers["set-cookie"] as string[]).find(value => value.startsWith("life_links_sign_in_browser="))!;
  expect(flags).toContain("HttpOnly");
  if (ctx.provider === "apple") { expect(flags).toContain("Secure"); expect(flags).toContain("SameSite=None"); }
  return { response, state: authorization.searchParams.get("state")!, ticket: prepared.ticket, cookies: cookieHeader(response) };
}
function callback(ctx: Context, pending: Launch, cookies = pending.cookies, error?: string) {
  const values = { state: pending.state, ...(error ? { error } : { code: `synthetic-provider-code-${pending.state}`, iss: ctx.issuer }) };
  const sent = ctx.provider === "apple" ? request(ctx.app).post("/api/auth/providers/apple/callback").set("Origin", ctx.issuer).type("form")
    : request(ctx.app).get("/api/auth/providers/google/callback");
  if (cookies) sent.set("Cookie", cookies);
  return ctx.provider === "apple" ? sent.send(values) : sent.query(values);
}
function exchange(ctx: Context, code: string, codeVerifier = verifier) {
  return request(ctx.app).post("/api/auth/native/exchange").send({ client: "native", code, codeVerifier });
}
async function seedOwner(ctx: Context, linkProvider = false) {
  const owner = await ctx.store.registerOwner({ displayName: "Retained owner", email: "retained-owner@example.test",
    passwordHash: await hashPassword(password), timeZone: "America/New_York" });
  if (linkProvider) await ctx.store.linkProviderIdentity(owner.id, ctx.identity);
  return owner;
}
async function loginOwner(ctx: Context) {
  const owner = await seedOwner(ctx), loggedIn = await request(ctx.app).post("/api/auth/login")
    .send({ client: "native", email: owner.email, password });
  expect(loggedIn.status).toBe(200);
  expect(hasSessionCookie(loggedIn)).toBe(false);
  return { owner, token: loggedIn.body.sessionToken as string };
}
async function me(ctx: Context, bearer?: string) {
  const sent = request(ctx.app).get("/api/me");
  if (bearer) sent.set("Authorization", `Bearer ${bearer}`);
  return (await sent).body;
}

afterEach(() => vi.restoreAllMocks());

describe("native provider authentication HTTP boundary", () => {
  it.each(["google", "apple"] as const)("returns an existing %s owner only through one-use PKCE exchange, without creating a browser session", async provider => {
    const ctx = setup(provider), owner = await seedOwner(ctx, true), sessions = vi.spyOn(ctx.store, "createSession");
    const pending = await launch(ctx), completed = await callback(ctx, pending);
    expect(completed.status).toBe(303); expect(hasSessionCookie(pending.response)).toBe(false); expect(hasSessionCookie(completed)).toBe(false);
    expect(sessions).not.toHaveBeenCalled();
    expect((await me(ctx)).user).toBeNull();
    expect((await ctx.browser.get("/api/me")).body.user).toBeNull();
    const code = completionCode(completed.headers.location), signedIn = await exchange(ctx, code);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ status: "signed_in", user: { id: owner.id, email: owner.email },
      agentConnection: expect.any(Object), qrBaseUrl: origin, returnTo: "/calendar?view=week", sessionToken: expect.any(String) });
    expect(hasSessionCookie(signedIn)).toBe(false); expect(sessions).toHaveBeenCalledTimes(1);
    expect((await me(ctx, signedIn.body.sessionToken)).user.id).toBe(owner.id);
    expect((await me(ctx)).user).toBeNull();
    expect((await exchange(ctx, code)).status).toBe(400);
    expect(sessions).toHaveBeenCalledTimes(1);
    expect((await callback(ctx, pending)).headers.location).toContain("signin_error");
    expect(ctx.adapter.redeem).toHaveBeenCalledTimes(1);
  });

  it("admits a fresh Google owner using canonical registration and preserves native return and time zone", async () => {
    const ctx = setup(), pending = await launch(ctx, { intent: "register", timeZone: "America/New_York", invitationCode });
    const completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    expect(hasSessionCookie(completed)).toBe(false);
    const result = await exchange(ctx, code);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "signed_in", returnTo: "/calendar?view=week",
      user: { displayName: ctx.identity.displayName, email: ctx.identity.email } });
    const owner = await ctx.store.getUserById(result.body.user.id);
    expect(owner?.passwordHash).toBeNull(); expect(owner?.agentConnectedAt).toBeNull();
    expect((await ctx.store.getProviderUser(ctx.identity))?.id).toBe(owner!.id);
    expect((await ctx.store.listCalendars(owner!.id)).items).toMatchObject([{ source: "native", title: "My Calendar",
      isDefault: true, agentAccess: "none", timeZone: "America/New_York" }]);
    expect((await ctx.store.listLifeLinks(owner!.id, null)).items).toEqual([]);
    expect((await me(ctx, result.body.sessionToken)).user.id).toBe(owner!.id);
    expect((await me(ctx)).user).toBeNull();
  });

  it.each(["google", "apple"] as const)("retains browser proof through %s profile continuation and returns only a native exchange code", async provider => {
    const ctx = setup(provider, { displayName: null, email: null, emailVerified: false }), sessions = vi.spyOn(ctx.store, "createSession");
    const pending = await launch(ctx, { intent: "register", returnTo: "/routines" }), authorized = await callback(ctx, pending);
    expect(authorized.status).toBe(303); expect(authorized.headers.location).toMatch(/^\/register#signup=[A-Za-z0-9_-]{43}$/);
    const signupToken = authorized.headers.location.split("#signup=")[1];
    expect((await request(ctx.app).post("/api/auth/provider-signup/complete").set("Origin", origin)
      .send({ signupToken, displayName: "Native chosen name" })).status).toBe(400);
    const completed = await request(ctx.app).post("/api/auth/provider-signup/complete").set("Origin", origin).set("Cookie", pending.cookies)
      .send({ signupToken, displayName: "Native chosen name", timeZone: "America/New_York" });
    expect(completed.status).toBe(201); expect(completed.body.returnTo).toBe("/routines");
    expect(hasSessionCookie(completed)).toBe(false); expect(sessions).not.toHaveBeenCalled();
    expect(completed.body.sessionToken).toBeUndefined();
    const signedIn = await exchange(ctx, completionCode(completed.body.nativeCallbackUrl));
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ status: "signed_in", returnTo: "/routines", user: { displayName: "Native chosen name", email: null } });
    expect(sessions).toHaveBeenCalledTimes(1);
    expect((await request(ctx.app).post("/api/auth/provider-signup/complete").set("Origin", origin).set("Cookie", pending.cookies)
      .send({ signupToken, displayName: "Native chosen name" })).status).toBe(400);
  });

  it("requires the original PKCE verifier and does not consume a code on a wrong binding", async () => {
    const ctx = setup(); await seedOwner(ctx, true);
    const pending = await launch(ctx), completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    const sessions = vi.spyOn(ctx.store, "createSession");
    const wrongProof = await exchange(ctx, code, "b".repeat(64));
    expect(wrongProof.status).toBe(400); expect(wrongProof.body).toEqual({ error: "invalid_native_auth" });
    expect((await exchange(ctx, code, "too-short")).status).toBe(400);
    expect(sessions).not.toHaveBeenCalled();
    expect((await exchange(ctx, code)).status).toBe(200);
    expect((await exchange(ctx, code)).status).toBe(400);
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  it("rejects browser exchange at its transport boundary without consuming a native code", async () => {
    const ctx = setup(); await seedOwner(ctx, true);
    const pending = await launch(ctx), completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    const sessions = vi.spyOn(ctx.store, "createSession");
    // Browser requests without an origin are refused by the transport guard
    // before the native proof boundary. A valid origin still cannot turn a
    // browser client into the OS-native exchange transport.
    const originlessBrowser = await request(ctx.app).post("/api/auth/native/exchange")
      .send({ client: "browser", code, codeVerifier: verifier });
    expect(originlessBrowser.status).toBe(403); expect(originlessBrowser.body).toEqual({ error: "origin_forbidden" });
    const sameOriginBrowser = await request(ctx.app).post("/api/auth/native/exchange").set("Origin", origin)
      .send({ client: "browser", code, codeVerifier: verifier });
    expect(sameOriginBrowser.status).toBe(400); expect(sameOriginBrowser.body).toEqual({ error: "invalid_native_auth" });
    expect(sessions).not.toHaveBeenCalled();
    expect((await exchange(ctx, code)).status).toBe(200);
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  it("consumes launch tickets once and refuses expired launch and exchange codes", async () => {
    const ctx = setup(); await seedOwner(ctx, true);
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const pending = await launch(ctx), completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    expect((await request(ctx.app).get("/api/auth/native/launch").query({ ticket: pending.ticket })).status).toBe(400);
    expect(ctx.adapter.authorizationUrl).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 60_001);
    expect((await exchange(ctx, code)).status).toBe(400);
    expect((await me(ctx)).user).toBeNull();
    const untouched = await start(ctx);
    clock.mockReturnValue(now + 12 * 60_000);
    expect((await request(ctx.app).get(untouched.browserPath)).status).toBe(400);
    expect(ctx.adapter.authorizationUrl).toHaveBeenCalledTimes(1);
  });

  it("rejects alternate redirect targets, malformed challenges and unsafe return paths before creating a launch", async () => {
    const ctx = setup(), saved = vi.spyOn(ctx.store, "saveProviderSignInAttempt");
    for (const patch of [{ redirectUri: "other-app://auth/callback" }, { redirectUri: "lifelinks://foreign/callback" },
      { redirectUri: "lifelinks://auth/callback?token=anything" }, { codeChallenge: "short" }, { codeChallenge: "x".repeat(44) },
      { returnTo: "//foreign.example.test" }, { returnTo: "/\\foreign" }, { returnTo: "/calendar#token=anything" },
      { provider: "unconfigured-provider" }, { unexpected: true }]) {
      const refused = await request(ctx.app).post("/api/auth/native/start").send({ ...baseRequest(), ...patch });
      expect(refused.status).toBe(400); expect(refused.body).toEqual({ error: "invalid_native_auth" });
    }
    expect(saved).not.toHaveBeenCalled(); expect(ctx.adapter.authorizationUrl).not.toHaveBeenCalled();
  });

  it("refuses browser-origin and browser Fetch Metadata native calls, even with an otherwise valid client label", async () => {
    const ctx = setup(); await seedOwner(ctx, true);
    const pending = await launch(ctx), completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    for (const headers of [{ Origin: origin }, { Origin: "https://foreign.example.test" }, { Referer: `${origin}/register` },
      { "Sec-Fetch-Site": "same-origin" }]) {
      for (const [path, body] of [["/api/auth/native/start", baseRequest()],
        ["/api/auth/native/exchange", { client: "native", code, codeVerifier: verifier }]] as const) {
        const refused = await request(ctx.app).post(path).set(headers).send(body);
        expect([400, 403]).toContain(refused.status);
        expect(refused.body.sessionToken).toBeUndefined();
      }
    }
    expect((await exchange(ctx, code)).status).toBe(200);
  });

  it.each(["google", "apple"] as const)("does not redeem an unbound %s callback and keeps the bound attempt usable", async provider => {
    const ctx = setup(provider); await seedOwner(ctx, true);
    const pending = await launch(ctx), unbound = await callback(ctx, pending, "");
    expect(unbound.status).toBe(303); expect(unbound.headers.location).toContain("signin_error");
    expect(hasSessionCookie(unbound)).toBe(false); expect(ctx.adapter.redeem).not.toHaveBeenCalled();
    const bound = await callback(ctx, pending);
    expect((await exchange(ctx, completionCode(bound.headers.location))).status).toBe(200);
  });

  it("returns provider cancellation through the app exchange without issuing a session", async () => {
    const ctx = setup(), sessions = vi.spyOn(ctx.store, "createSession"), pending = await launch(ctx);
    const cancelled = await callback(ctx, pending, pending.cookies, "access_denied");
    expect(cancelled.status).toBe(303);
    const exchanged = await exchange(ctx, completionCode(cancelled.headers.location));
    expect(exchanged.status).toBe(400); expect(exchanged.body).toEqual({ error: "signin_failed" });
    expect(sessions).not.toHaveBeenCalled(); expect(ctx.adapter.redeem).not.toHaveBeenCalled();
  });

  it("does not grant owner access through a stolen link launch/code and links only after original app PKCE proof", async () => {
    const ctx = setup(), { owner, token } = await loginOwner(ctx), sessions = vi.spyOn(ctx.store, "createSession");
    const pending = await launch(ctx, { intent: "link" }, token);
    expect(hasSessionCookie(pending.response)).toBe(false);
    expect(pending.response.headers.location).not.toContain(token);
    expect((await ctx.browser.get("/api/me")).body.user).toBeNull();
    expect((await request(ctx.app).get("/api/account-sign-in-methods").set("Cookie", pending.cookies)).status).toBe(401);
    const completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    expect((await exchange(ctx, code, "b".repeat(64))).status).toBe(400);
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    expect((await ctx.browser.get("/api/me")).body.user).toBeNull();
    const linked = await exchange(ctx, code);
    expect(linked.status).toBe(200); expect(linked.body).toMatchObject({ status: "linked", user: { id: owner.id }, returnTo: "/calendar?view=week" });
    expect(linked.body.sessionToken).toBeUndefined(); expect(hasSessionCookie(linked)).toBe(false); expect(sessions).not.toHaveBeenCalled();
    expect((await ctx.store.getProviderUser(ctx.identity))?.id).toBe(owner.id);
    expect((await me(ctx, token)).user.id).toBe(owner.id);
    expect((await exchange(ctx, completionCode(completed.headers.location))).status).toBe(400);
    const passwordLogin = await request(ctx.app).post("/api/auth/login").send({ client: "native", email: owner.email, password });
    expect(passwordLogin.status).toBe(200); expect(passwordLogin.body.user.id).toBe(owner.id);
  });

  it("defers an Apple form-post native link until the app proves possession of its PKCE verifier", async () => {
    const ctx = setup("apple"), { owner, token } = await loginOwner(ctx), sessions = vi.spyOn(ctx.store, "createSession");
    const pending = await launch(ctx, { intent: "link" }, token);
    expect(hasSessionCookie(pending.response)).toBe(false);
    // Native OAuth installs only its browser proof, never owner authentication.
    const browserProof = pending.cookies.split("; ").filter(value => value.startsWith("life_links_sign_in_browser=")).join("; ");
    const authorized = await callback(ctx, pending, browserProof);
    expect(authorized.status).toBe(303);
    const code = completionCode(authorized.headers.location);
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    expect(hasSessionCookie(authorized)).toBe(false);
    expect((await request(ctx.app).get("/api/account-sign-in-methods").set("Cookie", browserProof)).status).toBe(401);
    expect((await exchange(ctx, code, "b".repeat(64))).status).toBe(400);
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    const linked = await exchange(ctx, code);
    expect(linked.status).toBe(200); expect(linked.body).toMatchObject({ status: "linked", user: { id: owner.id } });
    expect(linked.body.sessionToken).toBeUndefined(); expect(sessions).not.toHaveBeenCalled();
    expect((await me(ctx, token)).user.id).toBe(owner.id);
    expect((await ctx.store.getProviderUser(ctx.identity))?.id).toBe(owner.id);
  });

  it("requires an authenticated bearer for linking and refuses signed-in registration", async () => {
    const ctx = setup(), { owner, token } = await loginOwner(ctx);
    expect((await request(ctx.app).post("/api/auth/native/start").send({ ...baseRequest(), intent: "link" })).status).toBe(401);
    const webLogin = await request(ctx.app).post("/api/auth/login").set("Origin", origin).send({ email: owner.email, password });
    expect(webLogin.status).toBe(200);
    expect((await request(ctx.app).post("/api/auth/native/start").set("Cookie", cookieHeader(webLogin))
      .send({ ...baseRequest(), intent: "link" })).status).toBe(401);
    expect((await request(ctx.app).post("/api/auth/native/start").set("Authorization", `Bearer ${token}`)
      .send({ ...baseRequest(), intent: "register" })).status).toBe(409);
  });

  it("does not link after the original native session was logged out while the provider was open", async () => {
    const ctx = setup(), { owner, token } = await loginOwner(ctx), pending = await launch(ctx, { intent: "link" }, token);
    expect((await request(ctx.app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).send()).status).toBe(204);
    const completed = await callback(ctx, pending);
    expect([400, 303]).toContain(completed.status);
    if (completed.status === 303 && completed.headers.location.startsWith(NATIVE_AUTH_REDIRECT_URI)) {
      expect((await exchange(ctx, completionCode(completed.headers.location))).status).toBe(400);
    }
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    expect((await me(ctx, token)).user).toBeNull();
  });

  it("refuses a link exchange if its original native session was revoked after the callback", async () => {
    const ctx = setup(), { owner, token } = await loginOwner(ctx), pending = await launch(ctx, { intent: "link" }, token);
    const completed = await callback(ctx, pending), code = completionCode(completed.headers.location);
    expect((await request(ctx.app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).send()).status).toBe(204);
    const exchanged = await exchange(ctx, code);
    expect(exchanged.status).toBe(400); expect(exchanged.body.sessionToken).toBeUndefined();
    expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    expect((await me(ctx, token)).user).toBeNull();
  });

  it("does not create an owner when a delayed provider callback outlives the original native intent", async () => {
    const ctx = setup(), now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const prepared = await start(ctx, { intent: "register" });
    clock.mockReturnValue(now + 9 * 60_000);
    const response = await ctx.browser.get(prepared.browserPath), state = new URL(response.headers.location).searchParams.get("state")!;
    const pending = { response, state, ticket: prepared.ticket, cookies: cookieHeader(response) };
    clock.mockReturnValue(now + 10 * 60_000 + 1);
    const completed = await callback(ctx, pending);
    expect([400, 303]).toContain(completed.status);
    expect(await ctx.store.getProviderUser(ctx.identity)).toBeNull();
    expect((await me(ctx)).user).toBeNull();
  });

  it("does not create an owner through a profile continuation after the original native intent expires", async () => {
    const ctx = setup("google", { displayName: null }), now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const prepared = await start(ctx, { intent: "register" });
    clock.mockReturnValue(now + 9 * 60_000);
    const response = await ctx.browser.get(prepared.browserPath), state = new URL(response.headers.location).searchParams.get("state")!;
    const pending = { response, state, ticket: prepared.ticket, cookies: cookieHeader(response) };
    const callbackResponse = await callback(ctx, pending), signupToken = callbackResponse.headers.location.split("#signup=")[1];
    clock.mockReturnValue(now + 10 * 60_000 + 1);
    const completed = await request(ctx.app).post("/api/auth/provider-signup/complete").set("Origin", origin).set("Cookie", pending.cookies)
      .send({ signupToken, displayName: "Expired native profile" });
    expect(completed.status).toBe(400);
    expect(await ctx.store.getProviderUser(ctx.identity)).toBeNull();
  });

  it("keeps launch, exchange, bearer and provider material out of logs and plaintext persistence", async () => {
    const ctx = setup(), persisted = vi.spyOn(ctx.store, "saveProviderSignInAttempt");
    const pending = await launch(ctx, { intent: "register", invitationCode }), completed = await callback(ctx, pending);
    const code = completionCode(completed.headers.location), signedIn = await exchange(ctx, code), transaction = ctx.transactions.get(pending.state)!;
    expect(signedIn.status).toBe(200);
    const secrets = [pending.ticket, code, verifier, invitationCode, pending.state, transaction.nonce, transaction.codeVerifier,
      `synthetic-provider-code-${pending.state}`, signedIn.body.sessionToken, ctx.identity.subject, ctx.identity.email!, ctx.identity.displayName!];
    const logs = JSON.stringify(ctx.events);
    for (const value of secrets) {
      expect(logs).not.toContain(value);
      for (const [row] of persisted.mock.calls) expect(JSON.stringify(row)).not.toContain(value);
    }
    for (const [row] of persisted.mock.calls) {
      expect(row.stateHash).toMatch(/^[a-f0-9]{64}$/); expect(row.browserHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.encryptedPayload).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(ctx.events).toEqual(expect.arrayContaining([expect.objectContaining({ event: "life_links.sign_in.completed", provider: "google" })]));
  });

  it("sanitizes malformed and oversized native JSON without logging submitted verification material", async () => {
    const ctx = setup(), privateInput = "synthetic-parser-private-verifier", saved = vi.spyOn(ctx.store, "saveProviderSignInAttempt");
    for (const path of ["/api/auth/native/start", "/api/auth/native/exchange"]) {
      const malformed = await request(ctx.app).post(path).set("Content-Type", "application/json")
        .send(`{"client":"native","codeVerifier":"${privateInput}"`);
      expect(malformed.status).toBe(400); expect(malformed.body).toEqual({ error: "invalid_native_auth" });
      expect(malformed.headers["cache-control"]).toBe("no-store");
      const oversized = await request(ctx.app).post(path).set("Content-Type", "application/json")
        .send(JSON.stringify({ client: "native", codeVerifier: privateInput, padding: "x".repeat(5_000) }));
      expect(oversized.status).toBe(400); expect(oversized.body).toEqual({ error: "invalid_native_auth" });
    }
    expect(saved).not.toHaveBeenCalled(); expect(ctx.adapter.authorizationUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx.events)).not.toContain(privateInput);
    expect(JSON.stringify(ctx.events)).not.toContain("codeVerifier");
  });

  it("shares a native request budget across forged forwarded prefixes while retaining the configured trusted hop", async () => {
    const ctx = setup(); ctx.config.rateLimitEnabled = true; ctx.app.set("trust proxy", 1);
    const saved = vi.spyOn(ctx.store, "saveProviderSignInAttempt");
    for (let index = 0; index < 10; index += 1) {
      const response = await request(ctx.app).post("/api/auth/native/start")
        .set("X-Forwarded-For", `192.0.2.${index + 1}, 198.51.100.9`).send(baseRequest());
      expect(response.status).toBe(200);
    }
    const blocked = await request(ctx.app).post("/api/auth/native/start")
      .set("X-Forwarded-For", "203.0.113.20, 198.51.100.9").send(baseRequest());
    expect(blocked.status).toBe(429); expect(blocked.headers["retry-after"]).toBeDefined();
    const exchangeBlocked = await request(ctx.app).post("/api/auth/native/exchange")
      .set("X-Forwarded-For", "203.0.113.21, 198.51.100.9")
      .send({ client: "native", code: "a".repeat(43), codeVerifier: verifier });
    expect(exchangeBlocked.status).toBe(429); expect(saved).toHaveBeenCalledTimes(10);
    const distinctClient = await request(ctx.app).post("/api/auth/native/start")
      .set("X-Forwarded-For", "192.0.2.1, 198.51.100.10").send(baseRequest());
    expect(distinctClient.status).toBe(200);
  });
});

async function calendarLaunch(ctx: Context, token: string, provider: "google" | "microsoft" = "google") {
  const prepared = await start(ctx, { provider: undefined, calendarProvider: provider, intent: "calendar", returnTo: "/calendar?view=month" }, token);
  const response = await ctx.browser.get(prepared.browserPath);
  expect(response.status).toBe(303);
  const url = new URL(response.headers.location);
  expect(url.origin).toBe(provider === "google" ? "https://accounts.google.com" : "https://login.microsoftonline.com");
  expect(response.headers.location).not.toContain(token);
  expect(hasSessionCookie(response)).toBe(false);
  expect((await ctx.browser.get("/api/me")).body.user).toBeNull();
  expect((await request(ctx.app).get("/api/calendar-connections").set("Cookie", cookieHeader(response))).status).toBe(401);
  const flags = (response.headers["set-cookie"] as string[]).find(value => value.startsWith("life_links_native_calendar="))!;
  expect(flags).toContain("HttpOnly"); expect(flags).toContain("SameSite=Lax");
  return { state: url.searchParams.get("state")!, cookies: cookieHeader(response), response };
}
function calendarCallback(ctx: Context, pending: { state: string; cookies: string }, provider = "google", state = pending.state) {
  return request(ctx.app).get(`/api/calendar-providers/${provider}/callback`).set("Cookie", pending.cookies)
    .query({ state, code: "synthetic-calendar-authorization-code" });
}

describe("native Calendar authorization handoff", () => {
  it.each(["google", "microsoft"] as const)("authorizes %s Calendar through the original bearer and preserves owner-controlled selection", async provider => {
    const ctx = setup("google", {}, true), { owner, token } = await loginOwner(ctx), sessions = vi.spyOn(ctx.store, "createSession");
    const pending = await calendarLaunch(ctx, token, provider), completed = await calendarCallback(ctx, pending, provider);
    expect(completed.status).toBe(303);
    const code = completionCode(completed.headers.location), result = await exchange(ctx, code);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: "calendar_authorized", user: { id: owner.id },
      returnTo: "/calendar?view=month", calendarAuthorizationId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(result.body.sessionToken).toBeUndefined(); expect(hasSessionCookie(result)).toBe(false); expect(sessions).not.toHaveBeenCalled();
    const path = `/api/calendar-authorizations/${result.body.calendarAuthorizationId}`;
    expect((await request(ctx.app).get(`${path}/calendars`)).status).toBe(401);
    const discovered = await request(ctx.app).get(`${path}/calendars`).set("Authorization", `Bearer ${token}`);
    expect(discovered.status).toBe(200);
    expect(discovered.body).toMatchObject({ providerKey: provider,
      calendars: [expect.objectContaining({ providerCalendarId: "native-calendar" })] });
    expect(await ctx.calendar!.gateway.listConnections(owner.id)).toEqual([]);
    const selected = await request(ctx.app).post(`${path}/complete`).set("Authorization", `Bearer ${token}`)
      .send({ selectedCalendarIds: ["native-calendar"] });
    expect(selected.status).toBe(200);
    expect(selected.body.calendars).toHaveLength(1);
    expect(selected.body.calendars[0].calendar.agentAccess).toBe("none");
    expect(await ctx.calendar!.gateway.listConnections(owner.id)).toHaveLength(1);
    expect((await me(ctx, token)).user.id).toBe(owner.id); expect(sessions).not.toHaveBeenCalled();
    expect((await exchange(ctx, code)).status).toBe(400);
    expect(ctx.calendar![provider].redeem).toHaveBeenCalledTimes(1);
  });

  it("requires the same original bearer for discovery, completion and cancellation even when a new session belongs to that owner", async () => {
    const ctx = setup("google", {}, true), { owner, token } = await loginOwner(ctx), pending = await calendarLaunch(ctx, token);
    const callbackResponse = await calendarCallback(ctx, pending);
    const result = await exchange(ctx, completionCode(callbackResponse.headers.location));
    expect(result.status).toBe(200);
    const path = `/api/calendar-authorizations/${result.body.calendarAuthorizationId}`;
    const newLogin = await request(ctx.app).post("/api/auth/login").send({ client: "native", email: owner.email, password });
    expect(newLogin.status).toBe(200);
    const otherBearer = `Bearer ${newLogin.body.sessionToken}`;
    expect((await request(ctx.app).get(`${path}/calendars`).set("Authorization", otherBearer)).status).toBe(400);
    expect((await request(ctx.app).post(`${path}/complete`).set("Authorization", otherBearer)
      .send({ selectedCalendarIds: ["native-calendar"] })).status).toBe(400);
    expect((await request(ctx.app).delete(path).set("Authorization", otherBearer)).status).toBe(400);
    expect(await ctx.calendar!.gateway.listConnections(owner.id)).toEqual([]);
    expect((await request(ctx.app).get(`${path}/calendars`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(ctx.app).delete(path).set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect((await request(ctx.app).get(`${path}/calendars`).set("Authorization", `Bearer ${token}`)).status).toBe(400);
    expect(await ctx.calendar!.gateway.listConnections(owner.id)).toEqual([]);
  });

  it.each(["state", "provider", "cookie"] as const)("refuses a native Calendar callback with mismatched %s binding", async mismatch => {
    const ctx = setup("google", {}, true), { token } = await loginOwner(ctx), pending = await calendarLaunch(ctx, token);
    const wrongState = pending.state.slice(0, -1) + (pending.state.endsWith("a") ? "b" : "a");
    const completed = await calendarCallback(ctx, mismatch === "cookie" ? { ...pending, cookies: "" } : pending,
      mismatch === "provider" ? "microsoft" : "google", mismatch === "state" ? wrongState : pending.state);
    expect(completed.status).toBe(303); expect(completed.headers.location.startsWith(NATIVE_AUTH_REDIRECT_URI)).toBe(false);
    expect(ctx.calendar!.google.redeem).not.toHaveBeenCalled(); expect(ctx.calendar!.microsoft.redeem).not.toHaveBeenCalled();
    expect((await me(ctx, token)).user).not.toBeNull();
  });

  it("refuses Calendar completion and app exchange after the original native bearer is revoked", async () => {
    const before = setup("google", {}, true), first = await loginOwner(before), pending = await calendarLaunch(before, first.token);
    expect((await request(before.app).post("/api/auth/logout").set("Authorization", `Bearer ${first.token}`)).status).toBe(204);
    const refused = await calendarCallback(before, pending);
    expect(refused.headers.location.startsWith(NATIVE_AUTH_REDIRECT_URI)).toBe(false);
    expect(before.calendar!.google.redeem).not.toHaveBeenCalled();

    const after = setup("google", {}, true), second = await loginOwner(after), secondPending = await calendarLaunch(after, second.token);
    const completed = await calendarCallback(after, secondPending), code = completionCode(completed.headers.location);
    expect((await request(after.app).post("/api/auth/logout").set("Authorization", `Bearer ${second.token}`)).status).toBe(204);
    expect((await exchange(after, code)).status).toBe(400);
    expect((await me(after, second.token)).user).toBeNull();
  });

  it("does not redeem a Calendar credential after the initiating native intent expires", async () => {
    const ctx = setup("google", {}, true), { token } = await loginOwner(ctx), now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const prepared = await start(ctx, { provider: undefined, calendarProvider: "google", intent: "calendar" }, token);
    clock.mockReturnValue(now + 9 * 60_000);
    const response = await ctx.browser.get(prepared.browserPath), state = new URL(response.headers.location).searchParams.get("state")!;
    clock.mockReturnValue(now + 10 * 60_000 + 1);
    const completed = await calendarCallback(ctx, { state, cookies: cookieHeader(response) });
    expect(completed.headers.location.startsWith(NATIVE_AUTH_REDIRECT_URI)).toBe(false);
    expect(ctx.calendar!.google.redeem).not.toHaveBeenCalled();
    expect([...ctx.calendar!.secretStore.rows.values()].filter(row => row.purpose === "credential")).toEqual([]);
  });
});
