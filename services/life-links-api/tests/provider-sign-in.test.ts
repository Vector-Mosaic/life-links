import { createHash } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ProviderTransaction, VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { prepareMemberInvitation, RegistrationAdmissionError } from "../src/registration.js";
import { hashPassword, verifyPassword } from "../src/password.js";

const origin = "https://sign-in.example.test";
const invitationCode = "synthetic_provider_signup_invitation_123456789";
const password = "synthetic-manual-owner-password";
const registrationEnv = {
  NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory", SESSION_SECRET: "synthetic-provider-session-secret",
  QR_BASE_URL: origin, COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false", ORIGIN_CHECK_ENABLED: "false",
  ORIGIN_CHECK_ALLOW_MISSING: "true", LIFE_LINKS_REGISTRATION_ENABLED: "true", LIFE_LINKS_SIGN_IN_PROVIDERS: "",
  LIFE_LINKS_REGISTRATION_INVITATION_CODE: invitationCode, LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "10",
  LIFE_LINKS_REGISTRATION_EXPIRES_AT: "2099-09-04T04:00:00.000Z", LIFE_LINKS_MEMBER_INVITATIONS_ENABLED: "true"
};
const initialIdentity: VerifiedProviderIdentity = { provider: "google", issuer: "https://accounts.google.com",
  clientId: "synthetic-product-client", subject: "synthetic-google-subject", email: "google-owner@example.test",
  emailVerified: true, displayName: "Google Owner" };

function setup(patch: Partial<VerifiedProviderIdentity> = {}, enabled = true,
  options: { provider?: "google" | "apple"; secureCookies?: boolean } = {}) {
  const store = new InMemoryLifeLinksStore(), events: LogEvent[] = [], transactions = new Map<string, ProviderTransaction>();
  const provider = options.provider ?? "google", issuer = provider === "apple" ? "https://appleid.apple.com" : initialIdentity.issuer;
  let identity: VerifiedProviderIdentity = { ...initialIdentity, provider, issuer,
    ...(provider === "apple" ? { subject: "synthetic-apple-subject", email: "apple-owner@example.test", displayName: "Apple Owner" } : {}), ...patch };
  const adapter: ProviderAdapter = {
    id: provider, displayName: provider === "apple" ? "Apple" : "Google", responseMode: provider === "apple" ? "form_post" : "query",
    authorizationUrl: vi.fn(async (transaction: ProviderTransaction) => {
      expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
      expect(transaction.nonce).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
      expect(transaction.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
      transactions.set(transaction.state, { ...transaction });
      const url = new URL(provider === "apple" ? "https://appleid.apple.com/auth/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", transaction.state);
      url.searchParams.set("nonce", transaction.nonce);
      url.searchParams.set("code_challenge", createHash("sha256").update(transaction.codeVerifier).digest("base64url"));
      return url.href;
    }),
    redeem: vi.fn(async ({ callbackUrl, transaction }: { callbackUrl: URL; transaction: ProviderTransaction }) => {
      expect(callbackUrl.origin).toBe(origin);
      expect(callbackUrl.pathname).toBe(`/api/auth/providers/${provider}/callback`);
      expect(callbackUrl.searchParams.getAll("state")).toEqual([transaction.state]);
      expect(callbackUrl.searchParams.get("code")).toBe(`synthetic-auth-code-${transaction.state}`);
      expect(callbackUrl.searchParams.get("iss")).toBe(issuer);
      expect(transaction).toEqual(transactions.get(transaction.state));
      return { ...identity };
    })
  };
  const config = readConfig({ ...registrationEnv, COOKIE_SECURE: String(options.secureCookies ?? false) });
  // These credentials are never used: the injected adapter owns the synthetic
  // exchange, while current client binding remains real product policy.
  config.providerSignIn = enabled ? provider === "apple"
    ? [{ id: "apple", clientId: initialIdentity.clientId, redirectUri: `${origin}/api/auth/providers/apple/callback`,
      teamId: "SYNTHETIC0", keyId: "FIXTURE000", privateKeyPem: "synthetic-unused-private-key" }]
    : [{ id: "google", clientId: initialIdentity.clientId, clientSecret: "synthetic-unused-client-secret",
      redirectUri: `${origin}/api/auth/providers/google/callback` }] : [];
  const app = createLifeLinksApp({ store, config, signInAdapters: enabled ? [adapter] : [],
    logger: createLogger("provider_sign_in_test", { sink: event => events.push(event) }) });
  return { store, events, transactions, adapter, config, app, agent: request.agent(app),
    setIdentity(value: Partial<VerifiedProviderIdentity>) { identity = { ...identity, ...value }; } };
}
type Context = ReturnType<typeof setup>;
type Agent = ReturnType<typeof request.agent>;

async function begin(ctx: Context, agent: Agent, intent: "login" | "register" | "link", extra: Record<string, unknown> = {}) {
  const response = await agent.post("/api/auth/providers/google/start").set("Origin", origin)
    .send({ intent, ...extra });
  expect(response.status).toBe(200);
  expect(Object.keys(response.body)).toEqual(["authorizationUrl"]);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  const url = new URL(response.body.authorizationUrl), state = url.searchParams.get("state")!;
  expect(url.origin).toBe("https://accounts.google.com");
  expect(response.body.authorizationUrl).not.toContain(invitationCode);
  return { state, transaction: ctx.transactions.get(state)! };
}
function callback(agent: Agent, state: string) {
  return agent.get("/api/auth/providers/google/callback").query({ state,
    code: `synthetic-auth-code-${state}`, iss: initialIdentity.issuer });
}
async function seedManual(ctx: Context, email: string, displayName = "Manual Owner") {
  // Existing-owner fixtures are not exercises of native verified signup.
  return ctx.store.registerOwner({ displayName, email, passwordHash: await hashPassword(password), timeZone: "America/New_York" });
}
async function registerManual(ctx: Context, agent = ctx.agent, email = "manual-owner@example.test") {
  await seedManual(ctx, email);
  const response = await agent.post("/api/auth/login").set("Origin", origin).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.user as { id: string; email: string };
}

function responseCookie(response: { headers: Record<string, unknown> }, name: string): string {
  const values = response.headers["set-cookie"] as string[] | undefined;
  const value = values?.find(candidate => candidate.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} fixture cookie`);
  return value.split(";")[0];
}

async function prepareAppleLink(ctx: Context) {
  // Supertest serves HTTP. Explicit fixture Cookie headers model the two HTTPS
  // browser requests while allowing assertions on the production cookie flags.
  await seedManual(ctx, "manual-apple-owner@example.test", "Existing Apple-link owner");
  const ownerResponse = await request(ctx.app).post("/api/auth/login").set("Origin", origin)
    .send({ email: "manual-apple-owner@example.test", password });
  expect(ownerResponse.status).toBe(200);
  const ownerCookie = responseCookie(ownerResponse, "life_links_session");
  const started = await request(ctx.app).post("/api/auth/providers/apple/start").set("Origin", origin)
    .set("Cookie", ownerCookie).send({ intent: "link", returnTo: "/calendar" });
  expect(started.status).toBe(200);
  const browserCookie = responseCookie(started, "life_links_sign_in_browser");
  const browserFlags = (started.headers["set-cookie"] as string[]).find(value => value.startsWith("life_links_sign_in_browser="))!;
  expect(browserFlags).toContain("SameSite=None");
  expect(browserFlags).toContain("Secure");
  expect(browserFlags).toContain("HttpOnly");
  const state = new URL(started.body.authorizationUrl).searchParams.get("state")!;
  const redirected = await request(ctx.app).post("/api/auth/providers/apple/callback").set("Origin", "https://appleid.apple.com")
    .set("Cookie", browserCookie).type("form").send({ state, code: `synthetic-auth-code-${state}`, iss: "https://appleid.apple.com" });
  expect(redirected.status).toBe(303);
  expect(redirected.headers.location).toMatch(/^\/#link=[A-Za-z0-9_-]{43}$/);
  expect(await ctx.store.listProviderIdentities(ownerResponse.body.user.id)).toEqual([]);
  return { owner: ownerResponse.body.user as { id: string; email: string }, ownerCookie, browserCookie, state,
    linkToken: redirected.headers.location.split("#link=")[1] };
}

afterEach(() => vi.restoreAllMocks());

describe("provider sign-in HTTP", () => {
  it("advertises configured providers only and requires allowed browser origin despite relaxed global settings", async () => {
    const disabled = setup({}, false);
    expect((await request(disabled.app).get("/api/auth/providers")).body).toEqual({ providers: [] });
    const ctx = setup();
    const listed = await request(ctx.app).get("/api/auth/providers");
    expect(listed.body).toEqual({ providers: [{ id: "google", label: "Google" }] });
    expect(listed.headers["cache-control"]).toBe("private, no-store");
    expect((await request(ctx.app).post("/api/auth/providers/microsoft/start").set("Origin", origin).send({ intent: "login" })).status).toBe(404);
    for (const headers of [{}, { Origin: "null" }, { Origin: "https://foreign.example.test" },
      { Origin: "https://foreign.example.test", Referer: `${origin}/register` }]) {
      const denied = await ctx.agent.post("/api/auth/providers/google/start").set(headers).send({ intent: "login" });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "origin_forbidden" });
    }
    expect(ctx.adapter.authorizationUrl).not.toHaveBeenCalled();
    expect((await ctx.agent.post("/api/auth/providers/google/start").set("Referer", `${origin}/register`).send({ intent: "login" })).status).toBe(200);
    expect((await ctx.agent.post("/api/auth/providers/google/start").set("Origin", origin).send({ intent: "login", returnTo: "//foreign.example.test" })).status).toBe(400);
  });

  it("registers a private canonical passwordless owner with no agent grant or provider Calendar connection", async () => {
    const ctx = setup(), pending = await begin(ctx, ctx.agent, "register", { timeZone: "America/New_York", returnTo: "/calendar" });
    const completed = await callback(ctx.agent, pending.state);
    expect(completed.status).toBe(303);
    expect(completed.headers.location).toBe("/calendar");
    expect(completed.headers["set-cookie"].some((value: string) => value.startsWith("life_links_session=") && value.includes("HttpOnly"))).toBe(true);
    const me = await ctx.agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ displayName: initialIdentity.displayName, email: initialIdentity.email });
    expect(me.body.agentConnection).toMatchObject({ connected: false });
    const stored = await ctx.store.getUserById(me.body.user.id);
    expect(stored?.passwordHash).toBeNull();
    expect(await ctx.store.getProviderUser(initialIdentity)).toEqual(stored);
    expect((await ctx.agent.get("/api/life-links")).body.lifeLinks).toEqual([]);
    expect((await ctx.store.listCalendars(me.body.user.id)).items).toMatchObject([{ source: "native",
      title: "My Calendar", isDefault: true, agentAccess: "none", timeZone: "America/New_York" }]);
    const passwordLogin = await request(ctx.app).post("/api/auth/login").send({ email: initialIdentity.email, password });
    expect(passwordLogin.status).toBe(401);
    expect(passwordLogin.body).toEqual({ error: "invalid_credentials" });
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body).toEqual({ providers: [{ id: "google", label: "Google", linked: true }],
      phone: { enabled: false, linked: false, maskedNumber: null } });
  });

  it.each(["login", "register"] as const)("admits a new public subject through %s with no invitation configuration", async intent => {
    const ctx = setup();
    ctx.config.memberInvitationsEnabled = false; ctx.config.registration = undefined;
    const registered = vi.spyOn(ctx.store, "registerProviderOwner");
    const pending = await begin(ctx, ctx.agent, intent);
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    const owner = (await ctx.agent.get("/api/me")).body.user;
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(owner.id);
    expect(registered).toHaveBeenCalledTimes(1);
    expect(registered.mock.calls[0][0]).not.toHaveProperty("invitation");
  });

  it("admits a named provider subject with no email without a contact challenge", async () => {
    const ctx = setup({ email: null, emailVerified: false });
    const pending = await begin(ctx, ctx.agent, "login");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    const owner = (await ctx.agent.get("/api/me")).body.user;
    expect(owner).toMatchObject({ displayName: initialIdentity.displayName, email: null });
    const stored = await ctx.store.getUserById(owner.id);
    expect(stored?.passwordHash).toBeNull();
    expect((await ctx.store.getProviderUser({ ...initialIdentity, email: null, emailVerified: false }))?.id).toBe(owner.id);
  });

  it("does not reserve an unverified provider email or merge it with an existing owner", async () => {
    const ctx = setup({ emailVerified: false }), original = await registerManual(ctx, ctx.agent, initialIdentity.email!);
    const before = await ctx.store.getUserById(original.id);
    const newcomer = request.agent(ctx.app), pending = await begin(ctx, newcomer, "login");
    expect((await callback(newcomer, pending.state)).headers.location).toBe("/");
    const owner = (await newcomer.get("/api/me")).body.user;
    expect(owner.id).not.toBe(original.id);
    expect(owner.email).toBeNull();
    expect((await ctx.store.getProviderUser({ ...initialIdentity, emailVerified: false }))?.id).toBe(owner.id);
    expect(await ctx.store.getUserById(original.id)).toEqual(before);
    expect(await verifyPassword(password, before!.passwordHash)).toBe(true);
  });

  it("does not use a matching provider email to sign in to or overwrite an existing password account", async () => {
    const ctx = setup(), owner = await registerManual(ctx, ctx.agent, initialIdentity.email!);
    const before = await ctx.store.getUserById(owner.id);
    const newcomer = request.agent(ctx.app), pending = await begin(ctx, newcomer, "register");
    const rejected = await callback(newcomer, pending.state);
    expect(rejected.status).toBe(303);
    expect(rejected.headers.location).toBe("/#signin_error=signup_failed");
    expect((await newcomer.get("/api/me")).body.user).toBeNull();
    expect(await ctx.store.getProviderUser(initialIdentity)).toBeNull();
    expect(await ctx.store.getUserById(owner.id)).toEqual(before);
    expect(await verifyPassword(password, before!.passwordHash)).toBe(true);
    expect(await ctx.store.registrationAvailable(ctx.config.registration!)).toBe(true);
    const login = await begin(ctx, newcomer, "login");
    expect((await callback(newcomer, login.state)).headers.location).toBe("/#signin_error=signup_failed");
    expect((await newcomer.get("/api/me")).body.user).toBeNull();
  });

  it("leaves the valid transaction usable after wrong-browser callbacks and permits only one provider redemption", async () => {
    const ctx = setup(), pending = await begin(ctx, ctx.agent, "register");
    const stranger = request.agent(ctx.app);
    expect((await callback(stranger, pending.state)).headers.location).toBe("/#signin_error=signin_failed");
    expect(ctx.adapter.redeem).not.toHaveBeenCalled();
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    const ownerId = (await ctx.agent.get("/api/me")).body.user.id;
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/#signin_error=signin_failed");
    expect(ctx.adapter.redeem).toHaveBeenCalledTimes(1);
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(ownerId);
  });

  it.each(["before", "during"])("refuses new-owner creation when another owner signs in %s provider authorization", async timing => {
    const ctx = setup();
    if (timing === "before") await registerManual(ctx);
    const pending = await begin(ctx, ctx.agent, timing === "before" ? "login" : "register");
    const owner = timing === "before" ? (await ctx.agent.get("/api/me")).body.user : await registerManual(ctx);
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/#signin_error=signin_failed");
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(owner.id);
    expect(await ctx.store.getProviderUser(initialIdentity)).toBeNull();
  });

  it("preserves account switching for an already mapped provider subject", async () => {
    const ctx = setup(), providerAgent = request.agent(ctx.app), registered = await begin(ctx, providerAgent, "register");
    expect((await callback(providerAgent, registered.state)).headers.location).toBe("/");
    const mapped = (await providerAgent.get("/api/me")).body.user;
    const original = await registerManual(ctx);
    const pending = await begin(ctx, ctx.agent, "login");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(mapped.id);
    expect(await ctx.store.getUserById(original.id)).not.toBeNull();
  });

  it("requires an authenticated cookie owner for linking and cannot move an identity from another owner", async () => {
    const ctx = setup();
    expect((await ctx.agent.post("/api/auth/providers/google/start").set("Origin", origin).send({ intent: "link" })).status).toBe(401);
    const providerAgent = request.agent(ctx.app), registered = await begin(ctx, providerAgent, "register");
    expect((await callback(providerAgent, registered.state)).headers.location).toBe("/");
    const providerOwner = (await providerAgent.get("/api/me")).body.user;
    const owner = await registerManual(ctx);
    const nativeLogin = await request(ctx.app).post("/api/auth/login").send({ email: owner.email, password, client: "native" });
    expect(nativeLogin.status).toBe(200);
    const bearerLink = await request(ctx.app).post("/api/auth/providers/google/start").set("Origin", origin)
      .set("Authorization", `Bearer ${nativeLogin.body.sessionToken}`).send({ intent: "link" });
    expect(bearerLink.status).toBe(401);
    const pending = await begin(ctx, ctx.agent, "link");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/#signin_error=link_failed");
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(providerOwner.id);
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(owner.id);
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body.providers[0].linked).toBe(false);
  });

  it("refuses linking after logout or a same-browser account switch during provider authorization", async () => {
    for (const switchAccount of [false, true]) {
      const ctx = setup(), owner = await registerManual(ctx), pending = await begin(ctx, ctx.agent, "link");
      if (switchAccount) {
        const otherAgent = request.agent(ctx.app), other = await registerManual(ctx, otherAgent, "another-owner@example.test");
        expect((await ctx.agent.post("/api/auth/login").send({ email: other.email, password })).status).toBe(200);
        expect((await ctx.agent.get("/api/me")).body.user.id).toBe(other.id);
      } else expect((await ctx.agent.post("/api/auth/logout")).status).toBe(204);
      expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/#signin_error=link_failed");
      expect(await ctx.store.getProviderUser(initialIdentity)).toBeNull();
      expect(await ctx.store.listProviderIdentities(owner.id)).toEqual([]);
    }
  });

  it("successfully links an existing owner without changing their password or private records", async () => {
    const ctx = setup(), owner = await registerManual(ctx), before = await ctx.store.getUserById(owner.id);
    const item = await ctx.store.createLifeLink({ id: "manual-owner-record", ownerId: owner.id, title: "Existing private record", createdAt: before!.createdAt });
    const pending = await begin(ctx, ctx.agent, "link");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    expect(await ctx.store.getProviderUser(initialIdentity)).toEqual(before);
    expect((await ctx.store.getUserById(owner.id))?.passwordHash).toBe(before!.passwordHash);
    expect((await ctx.store.getLifeLinkDetail(owner.id, item.id))?.lifeLink.title).toBe("Existing private record");
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body.providers[0].linked).toBe(true);
  });

  it("admits public provider owners after an optional invitation is cancelled or expires", async () => {
    for (const expire of [false, true]) {
      const ctx = setup(), inviter = await registerManual(ctx), prepared = prepareMemberInvitation(inviter.id);
      const now = Date.now();
      if (expire) {
        prepared.invitation.createdAt = new Date(now - 7 * 86_400_000 + 30_000).toISOString();
        prepared.invitation.expiresAt = new Date(now + 30_000).toISOString();
      }
      await ctx.store.createMemberInvitation(prepared.invitation);
      const recipient = request.agent(ctx.app), pending = await begin(ctx, recipient, "register", { invitationCode: prepared.code });
      const clock = expire ? vi.spyOn(Date, "now").mockReturnValue(now + 60_000) : null;
      try {
        if (!expire) await ctx.store.revokeMemberInvitation(inviter.id, prepared.invitation.id);
        expect((await callback(recipient, pending.state)).headers.location).toBe("/");
        const owner = (await recipient.get("/api/me")).body.user;
        expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(owner.id);
        expect((await ctx.store.getMemberInvitation(prepared.invitation.fingerprint))?.redeemedAt).toBeNull();
      } finally { clock?.mockRestore(); }
    }
  });

  it("redeems a valid optional member invitation in the same provider admission", async () => {
    const ctx = setup(), inviter = await registerManual(ctx), prepared = prepareMemberInvitation(inviter.id);
    await ctx.store.createMemberInvitation(prepared.invitation);
    const recipient = request.agent(ctx.app), pending = await begin(ctx, recipient, "register", { invitationCode: prepared.code });
    expect((await callback(recipient, pending.state)).headers.location).toBe("/");
    expect((await ctx.store.getMemberInvitation(prepared.invitation.fingerprint))?.redeemedAt).toEqual(expect.any(String));
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe((await recipient.get("/api/me")).body.user.id);
  });

  it("retries a rolled-back invitation cancellation race once as public signup", async () => {
    const ctx = setup(), inviter = await registerManual(ctx), prepared = prepareMemberInvitation(inviter.id);
    await ctx.store.createMemberInvitation(prepared.invitation);
    const realRegistration = ctx.store.registerProviderOwner.bind(ctx.store);
    const registered = vi.spyOn(ctx.store, "registerProviderOwner").mockImplementation(async input => {
      if (input.invitation) await ctx.store.revokeMemberInvitation(inviter.id, prepared.invitation.id);
      return realRegistration(input);
    });
    const recipient = request.agent(ctx.app), pending = await begin(ctx, recipient, "register", { invitationCode: prepared.code });
    expect((await callback(recipient, pending.state)).headers.location).toBe("/");
    expect(registered).toHaveBeenCalledTimes(2);
    expect(registered.mock.calls[0][0].invitation?.memberInvitationId).toBe(prepared.invitation.id);
    expect(registered.mock.calls[1][0]).not.toHaveProperty("invitation");
    expect((await ctx.store.getMemberInvitation(prepared.invitation.fingerprint))?.redeemedAt).toBeNull();
  });

  it.each(["registration_failed", "unknown"])("does not retry %s store failures", async failure => {
    const ctx = setup(), registered = vi.spyOn(ctx.store, "registerProviderOwner").mockRejectedValue(
      failure === "registration_failed" ? new RegistrationAdmissionError("registration_failed") : new Error("private store diagnostics"));
    const pending = await begin(ctx, ctx.agent, "register", { invitationCode });
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe(
      `/#signin_error=${failure === "registration_failed" ? "signup_failed" : "signin_failed"}`);
    expect(registered).toHaveBeenCalledTimes(1);
    expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    expect(JSON.stringify(ctx.events)).not.toContain("private store diagnostics");
  });

  it("signs returning linked subjects into the same owner without an invitation or email reassignment", async () => {
    const ctx = setup(), registered = await begin(ctx, ctx.agent, "register");
    expect((await callback(ctx.agent, registered.state)).headers.location).toBe("/");
    const original = (await ctx.agent.get("/api/me")).body.user;
    expect((await ctx.agent.post("/api/auth/logout")).status).toBe(204);
    ctx.config.memberInvitationsEnabled = false; ctx.config.registration = undefined;
    ctx.setIdentity({ email: "changed-provider-mail@example.test", displayName: "Changed provider name" });
    const pending = await begin(ctx, ctx.agent, "login");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    expect((await ctx.agent.get("/api/me")).body.user).toEqual(original);
    expect(await ctx.store.getUserByEmail("changed-provider-mail@example.test")).toBeNull();
  });

  it("keeps old identity bindings through client rotation and permits linking the current client explicitly", async () => {
    const ctx = setup(), registered = await begin(ctx, ctx.agent, "register");
    expect((await callback(ctx.agent, registered.state)).headers.location).toBe("/");
    const owner = (await ctx.agent.get("/api/me")).body.user;
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body.providers[0].linked).toBe(true);
    const rotatedClient = "synthetic-rotated-product-client";
    ctx.config.providerSignIn![0].clientId = rotatedClient;
    ctx.setIdentity({ clientId: rotatedClient });
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body.providers[0].linked).toBe(false);
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(owner.id);
    const pending = await begin(ctx, ctx.agent, "link");
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    expect((await ctx.agent.get("/api/account-sign-in-methods")).body.providers[0].linked).toBe(true);
    const currentIdentity = { ...initialIdentity, clientId: rotatedClient };
    expect((await ctx.store.getProviderUser(currentIdentity))?.id).toBe(owner.id);
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(owner.id);
    expect(await ctx.store.listProviderIdentities(owner.id)).toHaveLength(2);
  });

  it("collects a missing display name through browser-bound continuation without editable email and completes once", async () => {
    const ctx = setup({ email: null, emailVerified: false, displayName: null });
    const pending = await begin(ctx, ctx.agent, "register", { returnTo: "/routines" });
    const authorized = await callback(ctx.agent, pending.state);
    expect(authorized.status).toBe(303);
    expect(authorized.headers.location).toMatch(/^\/register#signup=[A-Za-z0-9_-]{43}$/);
    const signupToken = authorized.headers.location.split("#signup=")[1];
    expect((await ctx.agent.get("/api/me")).body.user).toBeNull();
    expect(await ctx.store.getProviderUser(initialIdentity)).toBeNull();
    const body = { signupToken, displayName: "New Member", timeZone: "America/New_York" };
    const stranger = request.agent(ctx.app);
    expect((await stranger.post("/api/auth/provider-signup/details").set("Origin", origin).send({ signupToken })).status).toBe(400);
    expect((await stranger.post("/api/auth/provider-signup/complete").set("Origin", origin).send(body)).status).toBe(400);
    const details = await ctx.agent.post("/api/auth/provider-signup/details").set("Origin", origin).send({ signupToken });
    expect(details.status).toBe(200);
    expect(details.body).toEqual({ email: null, displayName: null });
    expect((await ctx.agent.post("/api/auth/provider-signup/complete").set("Origin", origin)
      .send({ ...body, email: "arbitrary-reserved-address@example.test" })).status).toBe(400);
    expect((await ctx.agent.post("/api/auth/provider-signup/complete").send(body)).status).toBe(403);
    const completed = await ctx.agent.post("/api/auth/provider-signup/complete").set("Origin", origin).send(body);
    expect(completed.status).toBe(201);
    expect(completed.body).toEqual({ returnTo: "/routines" });
    const owner = (await ctx.agent.get("/api/me")).body.user;
    expect(owner).toMatchObject({ displayName: body.displayName, email: null });
    expect((await ctx.store.getUserById(owner.id))?.passwordHash).toBeNull();
    expect((await ctx.store.getProviderUser(initialIdentity))?.id).toBe(owner.id);
    expect((await ctx.agent.post("/api/auth/provider-signup/complete").set("Origin", origin).send(body)).status).toBe(400);
    expect((await ctx.agent.post("/api/auth/provider-signup/details").set("Origin", origin).send({ signupToken })).status).toBe(400);
  });

  it.each([true, false])("retains read-only provider email metadata and persists only a verified claim (%s)", async emailVerified => {
    const ctx = setup({ displayName: null, emailVerified });
    const pending = await begin(ctx, ctx.agent, "login"), authorized = await callback(ctx.agent, pending.state);
    const signupToken = authorized.headers.location.split("#signup=")[1];
    const details = await ctx.agent.post("/api/auth/provider-signup/details").set("Origin", origin).send({ signupToken });
    expect(details.body).toEqual({ email: initialIdentity.email, displayName: null });
    const completed = await ctx.agent.post("/api/auth/provider-signup/complete").set("Origin", origin)
      .send({ signupToken, displayName: "Chosen display name" });
    expect(completed.status).toBe(201);
    expect((await ctx.agent.get("/api/me")).body.user.email).toBe(emailVerified ? initialIdentity.email : null);
  });

  it("reports a retained phone binding safely when the phone sender is disabled", async () => {
    const ctx = setup(), owner = await registerManual(ctx);
    vi.spyOn(ctx.store, "listPhoneBindings").mockResolvedValue([{ phoneHash: "3".repeat(64), maskedNumber: "+1 •••• 4242" }]);
    const response = await ctx.agent.get("/api/account-sign-in-methods");
    expect(response.body.phone).toEqual({ enabled: false, linked: true, maskedNumber: "+1 •••• 4242" });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain(owner.email);
    expect((await request(ctx.app).get("/api/account-sign-in-methods")).status).toBe(401);
  });

  it("keeps raw invitations, authorization codes, transaction material and provider claims out of persistence payloads and logs", async () => {
    const ctx = setup(), saved = vi.spyOn(ctx.store, "saveProviderSignInAttempt");
    const pending = await begin(ctx, ctx.agent, "register", { invitationCode });
    const persisted = saved.mock.calls[0][0];
    expect(persisted.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.browserHash).toMatch(/^[a-f0-9]{64}$/);
    for (const privateValue of [invitationCode, pending.state, pending.transaction.nonce, pending.transaction.codeVerifier]) {
      expect(persisted.encryptedPayload).not.toContain(privateValue);
    }
    expect((await callback(ctx.agent, pending.state)).headers.location).toBe("/");
    expect((await callback(ctx.agent, pending.state)).headers.location).toContain("signin_error");
    const log = JSON.stringify(ctx.events);
    for (const privateValue of [invitationCode, pending.state, pending.transaction.nonce, pending.transaction.codeVerifier,
      `synthetic-auth-code-${pending.state}`, initialIdentity.clientId, initialIdentity.subject,
      initialIdentity.email!, initialIdentity.displayName!]) expect(log).not.toContain(privateValue);
    expect(ctx.events.filter(event => String(event.event).startsWith("life_links.sign_in.")))
      .toEqual(expect.arrayContaining([expect.objectContaining({ event: "life_links.sign_in.completed", provider: "google", user_id: expect.any(String) })]));
  });

  it("defers Apple form-post linking until the original same-origin cookie session and browser proof return", async () => {
    const ctx = setup({}, true, { provider: "apple", secureCookies: true }), pending = await prepareAppleLink(ctx);
    const complete = (cookies: string, withOrigin = true) => {
      const completion = request(ctx.app).post("/api/auth/provider-link/complete").set("Cookie", cookies);
      if (withOrigin) completion.set("Origin", origin);
      return completion.send({ linkToken: pending.linkToken });
    };
    expect((await complete(pending.browserCookie)).status).toBe(400);
    expect((await complete(pending.ownerCookie)).status).toBe(400);
    expect((await complete(`${pending.ownerCookie}; ${pending.browserCookie}`, false)).status).toBe(403);
    expect(await ctx.store.listProviderIdentities(pending.owner.id)).toEqual([]);
    const completed = await complete(`${pending.ownerCookie}; ${pending.browserCookie}`);
    expect(completed.status).toBe(200);
    expect(completed.body).toEqual({ returnTo: "/calendar" });
    expect((await ctx.store.listProviderIdentities(pending.owner.id)).map(value => value.provider)).toEqual(["apple"]);
    expect(await verifyPassword(password, (await ctx.store.getUserById(pending.owner.id))!.passwordHash)).toBe(true);
    expect((await complete(`${pending.ownerCookie}; ${pending.browserCookie}`)).status).toBe(400);
    const replay = await request(ctx.app).post("/api/auth/providers/apple/callback").set("Cookie", pending.browserCookie)
      .type("form").send({ state: pending.state, code: `synthetic-auth-code-${pending.state}`, iss: "https://appleid.apple.com" });
    expect(replay.status).toBe(303);
    expect(replay.headers.location).toContain("signin_error");
    expect(ctx.adapter.redeem).toHaveBeenCalledTimes(1);
  });

  it("refuses Apple link continuation after logout or a switch to another canonical cookie session", async () => {
    for (const mode of ["logout", "another-owner", "same-owner-new-session"]) {
      const ctx = setup({}, true, { provider: "apple", secureCookies: true }), pending = await prepareAppleLink(ctx);
      let completionCookie = pending.ownerCookie;
      if (mode !== "logout") {
        if (mode === "another-owner") await seedManual(ctx, "other-apple-owner@example.test", "Other owner");
        const sessionResponse = await request(ctx.app).post("/api/auth/login").set("Origin", origin)
          .send({ email: mode === "another-owner" ? "other-apple-owner@example.test" : pending.owner.email, password });
        expect(sessionResponse.status).toBe(200);
        completionCookie = responseCookie(sessionResponse, "life_links_session");
        const refused = await request(ctx.app).post("/api/auth/provider-link/complete").set("Origin", origin)
          .set("Cookie", `${completionCookie}; ${pending.browserCookie}`).send({ linkToken: pending.linkToken });
        expect(refused.status).toBe(400);
        expect(await ctx.store.listProviderIdentities(sessionResponse.body.user.id)).toEqual([]);
      } else {
        expect((await request(ctx.app).post("/api/auth/logout").set("Origin", origin).set("Cookie", completionCookie)).status).toBe(204);
        const refused = await request(ctx.app).post("/api/auth/provider-link/complete").set("Origin", origin)
          .set("Cookie", `${completionCookie}; ${pending.browserCookie}`).send({ linkToken: pending.linkToken });
        expect(refused.status).toBe(400);
      }
      expect(await ctx.store.listProviderIdentities(pending.owner.id)).toEqual([]);
      expect(ctx.adapter.redeem).toHaveBeenCalledTimes(1);
    }
  });
});
