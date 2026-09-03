import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { verifyPassword } from "../src/password.js";

const origin = "https://registration.example.test";
const invitationCode = "synthetic_test_invitation_not_a_secret_123456";
const password = "synthetic-private-password";
const registrationEnv = {
  NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory", SESSION_SECRET: "synthetic-session-secret",
  QR_BASE_URL: origin, COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false", ORIGIN_CHECK_ENABLED: "false",
  ORIGIN_CHECK_ALLOW_MISSING: "true", LIFE_LINKS_REGISTRATION_ENABLED: "true",
  LIFE_LINKS_REGISTRATION_INVITATION_CODE: invitationCode, LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "10",
  LIFE_LINKS_REGISTRATION_EXPIRES_AT: "2099-09-04T04:00:00.000Z"
};
const validInput = { displayName: "Private Judge", email: "judge@example.test", password, invitationCode, timeZone: "America/New_York" };
function setup(env: NodeJS.ProcessEnv = {}) {
  const store = new InMemoryLifeLinksStore();
  const events: LogEvent[] = [];
  const config = readConfig({ ...registrationEnv, ...env });
  const app = createLifeLinksApp({ store, config,
    logger: createLogger("registration_test", { sink: event => events.push(event) }) });
  const agent = request.agent(app);
  return { store, events, config, app, agent, register: (input: unknown = validInput) => agent.post("/api/auth/register").set("Origin", origin).send(input) };
}

afterEach(() => vi.restoreAllMocks());

describe("private invitation registration", () => {
  it("defaults to disabled and fails closed for malformed enabled configuration without exposing values", () => {
    expect(readConfig({ ...registrationEnv, LIFE_LINKS_REGISTRATION_ENABLED: "false" }).registration).toBeUndefined();
    for (const env of [
      { LIFE_LINKS_REGISTRATION_INVITATION_CODE: "short" }, { LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "0" },
      { LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "501" }, { LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "1.5" },
      { LIFE_LINKS_REGISTRATION_EXPIRES_AT: "forever" }, { LIFE_LINKS_REGISTRATION_EXPIRES_AT: "2099-02-31T00:00:00.000Z" }
    ]) expect(() => readConfig({ ...registrationEnv, ...env })).toThrow("Invitation registration requires");
    expect(JSON.stringify(readConfig(registrationEnv))).not.toContain(invitationCode);
  });

  it("creates a new cookie owner, empty workspace, and native default without agent grants", async () => {
    const ctx = setup();
    expect((await ctx.agent.get("/api/auth/registration")).body).toEqual({ enabled: true });
    const response = await ctx.register({ ...validInput, displayName: "  Private Judge  ", email: "Judge@Example.Test" });
    expect(response.status).toBe(201);
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({ user: { id: expect.any(String), displayName: "Private Judge", email: "judge@example.test", createdAt: expect.any(String) },
      agentConnection: { connected: false, connectedAt: null, toolCatalogId: null }, qrBaseUrl: origin });
    expect((await ctx.agent.get("/api/me")).body.user).toEqual(response.body.user);
    expect((await ctx.agent.get("/api/life-links")).body.lifeLinks).toEqual([]);
    const stored = await ctx.store.getUserByEmail(validInput.email);
    expect(stored).not.toBeNull();
    expect(await verifyPassword(password, stored!.passwordHash)).toBe(true);
    expect((await ctx.store.listCalendars(stored!.id)).items).toMatchObject([{ title: "My Calendar", timeZone: "America/New_York", isDefault: true, agentAccess: "none" }]);
    expect(JSON.stringify(ctx.events)).not.toMatch(/judge@example.test|synthetic-private-password|synthetic_test_invitation/);
  });

  it("requires an allowed browser origin even when relaxed global guards or bearer credentials apply", async () => {
    const ctx = setup();
    for (const headers of [{}, { Origin: "null" }, { Origin: "https://foreign.example.test" },
      { Origin: "https://foreign.example.test", Referer: `${origin}/register` }]) {
      const response = await ctx.agent.post("/api/auth/register").set(headers).send(validInput);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "origin_forbidden" });
    }
    const admitted = await ctx.agent.post("/api/auth/register").set("Referer", `${origin}/register`).send(validInput);
    expect(admitted.status).toBe(201);
    const login = await ctx.agent.post("/api/auth/login").send({ email: validInput.email, password, client: "native" });
    expect(login.status).toBe(200);
    expect((await ctx.agent.post("/api/auth/register").set("Authorization", `Bearer ${login.body.sessionToken}`)
      .send({ ...validInput, email: "other@example.test" })).body).toEqual({ error: "origin_forbidden" });
  });

  it.each([
    { displayName: " " }, { displayName: "x".repeat(101) }, { displayName: "Judge\u0000" },
    { email: "bad-email" }, { email: `${"x".repeat(250)}@example.test` }, { password: "short" },
    { password: "x".repeat(129) }, { invitationCode: "short" }, { timeZone: "Invalid/Place" },
    { client: "native" }, { email: 42 }, { invitationCode: {} }
  ])("refuses invalid bounded registration input %#", async patch => {
    const ctx = setup();
    const response = await ctx.register({ ...validInput, ...patch });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_registration" });
    expect(await ctx.store.getUserByEmail(validInput.email)).toBeNull();
  });

  it("returns only availability and refuses disabled, expired, invalid, or exhausted invitations", async () => {
    for (const env of [{ LIFE_LINKS_REGISTRATION_ENABLED: "false" }, { LIFE_LINKS_REGISTRATION_EXPIRES_AT: "2020-01-01T00:00:00.000Z" }]) {
      const ctx = setup(env);
      expect((await ctx.agent.get("/api/auth/registration")).body).toEqual({ enabled: false });
      expect((await ctx.register()).body).toEqual({ error: "registration_unavailable" });
    }
    const ctx = setup({ LIFE_LINKS_REGISTRATION_MAX_ACCOUNTS: "1" });
    expect((await ctx.register({ ...validInput, invitationCode: "wrong_invitation_that_is_long_enough_123" })).status).toBe(403);
    const response = await ctx.register({ ...validInput, timeZone: undefined });
    expect(response.status).toBe(201);
    expect((await ctx.store.listCalendars(response.body.user.id)).items[0].timeZone).toBe("UTC");
    expect((await ctx.agent.get("/api/auth/registration")).body).toEqual({ enabled: false });
    expect((await ctx.register({ ...validInput, email: "second@example.test" })).body).toEqual({ error: "registration_unavailable" });
    expect((await ctx.agent.get("/api/me")).body.user.id).toBe(response.body.user.id);
  });

  it("never overwrites an existing account on case-insensitive duplicate or concurrent retry", async () => {
    const ctx = setup();
    const responses = await Promise.all([ctx.register(), ctx.register({ ...validInput, email: validInput.email.toUpperCase(), password: "a-different-synthetic-password" })]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const created = responses.find(response => response.status === 201)!;
    const before = await ctx.store.getUserById(created.body.user.id);
    const retry = await ctx.register({ ...validInput, password: "never-replace-this-password" });
    expect(retry.status).toBe(409);
    expect(retry.body).toEqual({ error: "registration_failed" });
    expect((await ctx.store.getUserById(created.body.user.id))?.passwordHash).toBe(before?.passwordHash);
  });

  it("keeps a committed account usable by sign-in after response/session failure without leaking driver errors", async () => {
    const ctx = setup();
    const createSession = vi.spyOn(ctx.store, "createSession").mockRejectedValueOnce(new Error(`${validInput.email} ${password} ${invitationCode}`));
    const failed = await ctx.register();
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: "registration_unavailable" });
    createSession.mockRestore();
    expect((await ctx.agent.post("/api/auth/login").send({ email: validInput.email, password })).status).toBe(200);
    expect((await ctx.register()).status).toBe(409);
    expect(JSON.stringify(ctx.events)).not.toContain(password);
    expect(JSON.stringify(ctx.events)).not.toContain(invitationCode);
    expect(JSON.stringify(ctx.events)).not.toContain(validInput.email);
  });

  it("bounds signup attempts by IP across different emails and ignores global rate-limit disabling", async () => {
    const ctx = setup();
    for (let index = 0; index < 5; index++) expect((await ctx.register({ ...validInput, email: `${index}@example.test`, password: "bad" })).status).toBe(400);
    const limited = await ctx.register();
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("rate_limited");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 901_000);
    expect((await ctx.register()).status).toBe(201);
  });

  it.each([false, true])("ignores untrusted forwarded prefixes when limiting signup (trust proxy: %s)", async trustProxy => {
    const ctx = setup({ TRUST_PROXY: String(trustProxy) });
    for (let index = 0; index < 5; index++) {
      const forwarded = trustProxy ? `198.51.100.${index + 1}, 203.0.113.10` : `198.51.100.${index + 1}`;
      expect((await ctx.agent.post("/api/auth/register").set("Origin", origin)
        .set("X-Forwarded-For", forwarded).send({ ...validInput, password: "short" })).status).toBe(400);
    }
    const forwarded = trustProxy ? "198.51.100.99, 203.0.113.10" : "198.51.100.99";
    expect((await ctx.agent.post("/api/auth/register").set("Origin", origin)
      .set("X-Forwarded-For", forwarded).send(validInput)).status).toBe(429);
    expect(await ctx.store.getUserByEmail(validInput.email)).toBeNull();
    if (trustProxy) {
      // A different client reported by the one trusted proxy still has its own budget.
      expect((await ctx.agent.post("/api/auth/register").set("Origin", origin)
        .set("X-Forwarded-For", "198.51.100.99, 203.0.113.11").send(validInput)).status).toBe(201);
    }
  });

  it("sanitizes malformed/oversized JSON without storing accounts or logging request content", async () => {
    const ctx = setup();
    for (const body of [`{"password":"${password}", "invitationCode":"${invitationCode}",`, JSON.stringify({ ...validInput, displayName: "x".repeat(5000) })]) {
      const result = await ctx.agent.post("/api/auth/register").set("Origin", origin).set("Content-Type", "application/json").send(body);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid_registration" });
    }
    expect(await ctx.store.getUserByEmail(validInput.email)).toBeNull();
    expect(JSON.stringify(ctx.events)).not.toContain(password);
    expect(JSON.stringify(ctx.events)).not.toContain(invitationCode);
  });

  it("preserves signup origin, shared IP rate limits, and error redaction on Express route aliases", async () => {
    const ctx = setup();
    for (const route of ["/api/auth/register/", "/API/AUTH/REGISTER", "/API/AUTH/REGISTER/"]) {
      expect((await ctx.agent.post(route).send(validInput)).body).toEqual({ error: "origin_forbidden" });
      expect((await ctx.agent.post(route).set("Origin", origin).set("Content-Type", "application/json")
        .send(`{"password":"${password}",`)).body).toEqual({ error: "invalid_registration" });
    }
    for (let index = 0; index < 5; index++) expect((await ctx.agent.post(index % 2 ? "/API/AUTH/REGISTER/" : "/api/auth/register")
      .set("Origin", origin).send({ ...validInput, password: "short" })).status).toBe(400);
    expect((await ctx.agent.post("/api/auth/register/").set("Origin", origin).send(validInput)).status).toBe(429);
    expect(JSON.stringify(ctx.events)).not.toContain(password);
    expect(JSON.stringify(ctx.events)).not.toContain(invitationCode);
  });
});
