import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express, { type Request } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEMO_GUEST_ID, DEMO_PASSWORD } from "@life-links/core";
import { RemoteAgentAuth } from "../src/remote-agent-auth.js";
import { RemoteAgentState } from "../src/remote-agent-state.js";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { createSessionToken, hashSessionToken } from "../src/password.js";
import { createLifeLinksApp, startLifeLinksServer } from "../src/server.js";

const BASE = "http://127.0.0.1:43100";
const CALLBACK = "https://synthetic-agent.example/callback";
const SCOPES = "openid offline_access records:read records:write routines:read routines:write";
// Codex rust-v0.144.1 perform_oauth_login.rs calls RMCP 1.8.0
// AuthorizationSession.start_authorization(..., Some("Codex")); that pinned
// SDK's register_client sends precisely these metadata fields. Only the local
// listener port and server-specific callback suffix are synthetic here.
const CODEX_REGISTRATION = {
  client_name: "Codex", redirect_uris: ["http://127.0.0.1:41777/callback/synthetic123"],
  grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none", response_types: ["code"],
  scope: "records:read records:write collections:read collections:write routines:read routines:write calendar:read calendar:write",
  application_type: "native"
};
const localPath = (url: string) => { const value = new URL(url, BASE); return value.pathname + value.search; };
const csrf = (body: string) => {
  const value = /name="csrf" value="([^"]+)"/.exec(body)?.[1];
  if (!value) throw new Error("synthetic_csrf_form_missing");
  return value;
};

async function fixture(env: NodeJS.ProcessEnv = {}, integrated = false) {
  const config = readConfig({ NODE_ENV: "test", LIFE_LINKS_STORE: "memory", SESSION_SECRET: "synthetic-remote-auth-session-secret",
    QR_BASE_URL: BASE, COOKIE_SECURE: "false", TRUST_PROXY: "false", RATE_LIMIT_ENABLED: "false", ...env });
  const store = new InMemoryLifeLinksStore(); await store.seedDemo(DEMO_PASSWORD, BASE);
  const owner = (await store.getUserById("demo-owner"))!;
  const logs: LogEvent[] = [];
  const state = new RemoteAgentState(config.sessionSecret);
  const logger = createLogger("remote_auth_test", { sink: (event) => logs.push(event) });
  const auth = await RemoteAgentAuth.create(state, store, config, logger);
  const app = integrated ? createLifeLinksApp({ store, config, logger, remoteAgent: { auth, state } }) : express();
  if (!integrated) app.use(auth.router);
  const browser = request.agent(app);
  const register = async (metadata: Record<string, unknown> = {}) => request(app).post("/oauth/reg").send({ redirect_uris: [CALLBACK],
    client_name: "Synthetic agent", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", ...metadata });
  const followInternal = async (response: request.Response) => {
    for (let count = 0; count < 8 && response.status >= 300 && response.status < 400; count++) {
      const next = new URL(response.headers.location, BASE);
      if (next.origin !== BASE) return response;
      response = await browser.get(localPath(next.href)).set("Host", new URL(BASE).host);
    }
    return response;
  };
  const begin = async (clientId: string, extra: Record<string, string | undefined> = {}) => {
    const verifier = randomBytes(32).toString("base64url");
    const params: Record<string, string | undefined> = { client_id: clientId, redirect_uri: CALLBACK, response_type: "code", scope: SCOPES,
      resource: auth.resource, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "synthetic-state", ...extra };
    const response = await followInternal(await browser.get("/oauth/auth").set("Host", new URL(BASE).host).query(params));
    return { response, verifier };
  };
  const submit = async (form: request.Response, fields: Record<string, string>, follow = true) => {
    const action = /<form method="post" action="([^"]+)"/.exec(form.text)?.[1];
    if (!action) throw new Error("synthetic_auth_form_missing");
    const response = await browser.post(action).set("Host", new URL(BASE).host).set("Origin", BASE).type("form").send({ csrf: csrf(form.text), action: "approve", ...fields });
    return follow ? followInternal(response) : response;
  };
  const loginConsent = async (clientId: string, extra: Record<string, string | undefined> = {}) => {
    const { response, verifier } = await begin(clientId, extra);
    expect(response.status).toBe(200); expect(response.text).toContain('name="password"');
    const consent = await submit(response, { email: owner.email, password: DEMO_PASSWORD });
    expect(consent.status).toBe(200); expect(consent.text).toContain(owner.email); expect(consent.text).toContain("Connect Life Links");
    const redirect = await submit(consent, {});
    expect(redirect.status).toBe(303);
    const result = new URL(redirect.headers.location);
    expect(result.origin).toBe(new URL(extra.redirect_uri ?? CALLBACK).origin); expect(result.searchParams.get("state")).toBe("synthetic-state");
    expect(result.searchParams.has("error")).toBe(false);
    return { code: result.searchParams.get("code")!, verifier, consent };
  };
  const exchange = (clientId: string, code: string, verifier: string, callback = CALLBACK) => request(app).post("/oauth/token").type("form").send({
    grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: auth.resource });
  const authenticate = (token: string) => auth.authenticate({ get: (name: string) => name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined } as Request);
  return { app, auth, state, store, owner, browser, logs, logger, register, begin, submit, loginConsent, exchange, authenticate, config };
}

describe("Life Links remote OAuth authorization", () => {
  it("accepts the exact Codex 0.144.1 native public-client metadata and completes S256 code plus refresh", async () => {
    const test = await fixture({}, true);
    try {
      const registration = await request(test.app).post("/oauth/reg").send(CODEX_REGISTRATION);
      expect(registration.status).toBe(201); expect(registration.body.application_type).toBe("native");
      expect(registration.body).not.toHaveProperty("client_secret");
      const callback = CODEX_REGISTRATION.redirect_uris[0];
      const { code, verifier, consent } = await test.loginConsent(registration.body.client_id, { redirect_uri: callback, scope: CODEX_REGISTRATION.scope });
      expect(consent.headers["content-security-policy"]).toContain(`form-action 'self' ${callback}`);
      const tokens = await test.exchange(registration.body.client_id, code, verifier, callback); expect(tokens.status).toBe(200);
      expect((await test.authenticate(tokens.body.access_token)).scopes.sort()).toEqual(CODEX_REGISTRATION.scope.split(" ").sort());
      const refresh = await request(test.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: registration.body.client_id,
        refresh_token: tokens.body.refresh_token, resource: test.auth.resource });
      expect(refresh.status).toBe(200); expect((await test.authenticate(refresh.body.access_token)).ownerId).toBe(test.owner.id);
    } finally { await test.app.locals.closeRemoteAgent(); }
  });

  it("allows only native loopback port variation while retaining PKCE and exact callback host, path and query", async () => {
    const test = await fixture({}, true);
    try {
      const registration = await request(test.app).post("/oauth/reg").send(CODEX_REGISTRATION); expect(registration.status).toBe(201);
      const callback = CODEX_REGISTRATION.redirect_uris[0].replace(":41777/", ":41999/");
      for (const redirect of [callback.replace("/synthetic123", "/different"), `${callback}?different=1`,
        callback.replace("127.0.0.1", "[::1]"), callback.replace("127.0.0.1", "untrusted.example"), callback.replace("127.0.0.1", "2130706433")]) {
        const { response } = await test.begin(registration.body.client_id, { scope: CODEX_REGISTRATION.scope, redirect_uri: redirect });
        expect(response.text).not.toContain('name="password"'); expect(await test.state.listOwned("Grant", test.owner.id)).toHaveLength(0);
      }
      for (const pkce of [{ code_challenge_method: "plain" }, { code_challenge: undefined, code_challenge_method: undefined }]) {
        const { response } = await test.begin(registration.body.client_id, { scope: CODEX_REGISTRATION.scope, redirect_uri: callback, ...pkce });
        expect(response.text).not.toContain('name="password"');
      }
      const web = await test.register({ redirect_uris: CODEX_REGISTRATION.redirect_uris, application_type: "web" }); expect(web.status).toBe(201);
      expect((await test.begin(web.body.client_id, { redirect_uri: callback })).response.text).not.toContain('name="password"');
      const { code, verifier, consent } = await test.loginConsent(registration.body.client_id, { redirect_uri: callback, scope: CODEX_REGISTRATION.scope });
      expect(consent.headers["content-security-policy"]).toContain(`form-action 'self' ${callback}`);
      expect(consent.headers["content-security-policy"]).not.toContain(":41777/");
      expect((await test.exchange(registration.body.client_id, code, verifier, callback)).status).toBe(200);
    } finally { await test.app.locals.closeRemoteAgent(); }
  });

  it("allows only the selected registered callback in interaction form-action while preserving the rest of the site CSP", async () => {
    const test = await fixture({}, true);
    try {
      const otherCallback = "https://other-synthetic-agent.example/callback";
      const registered = await test.register({ redirect_uris: [CALLBACK, otherCallback] }); expect(registered.status).toBe(201);
      const unchanged = (await request(test.app).get("/api/me")).headers["content-security-policy"] as string;
      const baseline = unchanged.split("; "); expect(baseline).toContain("form-action 'self'");
      const verifyPolicy = (response: request.Response) => {
        const directives = (response.headers["content-security-policy"] as string).split("; ");
        expect(directives.filter(value => value.startsWith("form-action "))).toEqual([`form-action 'self' ${CALLBACK}`]);
        expect(directives.filter(value => !value.startsWith("form-action "))).toEqual(baseline.filter(value => !value.startsWith("form-action ")));
        expect(response.headers["content-security-policy"]).not.toContain(otherCallback);
      };
      const { response } = await test.begin(registered.body.client_id); expect(response.status).toBe(200); verifyPolicy(response);
      const consent = await test.submit(response, { email: test.owner.email, password: DEMO_PASSWORD });
      expect(consent.status).toBe(200); verifyPolicy(consent);
      const redirected = await test.submit(consent, {}, false); expect(redirected.status).toBe(303); verifyPolicy(redirected);
      expect((await request(test.app).get("/api/me")).headers["content-security-policy"]).toBe(unchanged);
      expect((await request(test.app).get("/agent-connections")).headers["content-security-policy"]).toBe(unchanged);
    } finally { await test.app.locals.closeRemoteAgent(); }
  });

  it("refuses different or injected callback requests without adding their values to the CSP", async () => {
    const test = await fixture({}, true);
    try {
      const registered = await test.register(); expect(registered.status).toBe(201);
      for (const redirect of ["https://synthetic-agent.example/different", "https://unregistered.example/callback",
        "https://synthetic-agent.example/callback; script-src *", "https://*.synthetic-agent.example/callback", "javascript:alert(1)"]) {
        const { response } = await test.begin(registered.body.client_id, { redirect_uri: redirect });
        expect(response.text).not.toContain('name="password"');
        expect((response.headers["content-security-policy"] as string).split("; ").filter(value => value.startsWith("form-action "))).toEqual(["form-action 'self'"]);
        expect(await test.state.listOwned("Grant", test.owner.id)).toHaveLength(0);
      }
    } finally { await test.app.locals.closeRemoteAgent(); }
  });

  it("encodes a registered callback path delimiter without broadening CSP or copying its query", async () => {
    const test = await fixture({}, true);
    try {
      const callback = "https://synthetic-agent.example/callback;segment?channel=synthetic";
      const registered = await test.register({ redirect_uris: [callback] }); expect(registered.status).toBe(201);
      const { response } = await test.begin(registered.body.client_id, { redirect_uri: callback }); expect(response.status).toBe(200);
      const directives = (response.headers["content-security-policy"] as string).split("; ");
      expect(directives.filter(value => value.startsWith("form-action "))).toEqual(["form-action 'self' https://synthetic-agent.example/callback%3Bsegment"]);
      expect(directives.filter(value => value.startsWith("script-src "))).toEqual(["script-src 'self'"]);
      expect(response.headers["content-security-policy"]).not.toContain("channel=");
    } finally { await test.app.locals.closeRemoteAgent(); }
  });

  it("closes an active MCP SSE stream before HTTP and store shutdown, without requiring client disconnect", async () => {
    const test = await fixture();
    const registered = await test.register(); const { code, verifier } = await test.loginConsent(registered.body.client_id);
    const token = await test.exchange(registered.body.client_id, code, verifier); expect(token.status).toBe(200);
    const server = startLifeLinksServer({ store: test.store, logger: test.logger, config: { ...test.config, host: "127.0.0.1", port: 0 },
      remoteAgent: { auth: test.auth, state: test.state } });
    try {
      if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw new Error("synthetic_server_unavailable");
      const url = `http://127.0.0.1:${address.port}/mcp`;
      const headers = { Authorization: `Bearer ${token.body.access_token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
      const initialized = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "synthetic-shutdown-host", version: "1" } } }) });
      expect(initialized.status).toBe(200); await initialized.text();
      const sessionId = initialized.headers.get("mcp-session-id"); expect(sessionId).toEqual(expect.any(String));
      const sessionHeaders = { ...headers, "Mcp-Session-Id": sessionId!, "MCP-Protocol-Version": "2025-11-25" };
      expect((await fetch(url, { method: "POST", headers: sessionHeaders, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) })).status).toBe(202);
      const stream = await fetch(url, { headers: { ...sessionHeaders, Accept: "text/event-stream" }, signal: AbortSignal.timeout(3000) });
      expect(stream.status).toBe(200); expect(stream.headers.get("content-type")).toContain("text/event-stream");
      const reader = stream.body!.getReader(); let streamEnded = false;
      const streamClosed = (async () => { while (!(await reader.read()).done) { /* drain protocol keepalives */ } streamEnded = true; })();
      expect(streamEnded).toBe(false);
      const remoteClosing = server.closeRemoteAgent(); expect(server.closeRemoteAgent()).toBe(remoteClosing);
      const httpClosed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.all([remoteClosing, streamClosed, httpClosed]);
      expect(streamEnded).toBe(true); expect(server.listening).toBe(false);
      await test.store.close();
    } finally {
      await server.closeRemoteAgent(); server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rechecks exact current Calendar access for an existing remote token without a page grant", async () => {
    const test = await fixture(); const registered = await test.register();
    const { code, verifier } = await test.loginConsent(registered.body.client_id, { scope: "calendar:read calendar:write" });
    const token = await test.exchange(registered.body.client_id, code, verifier); expect(token.status).toBe(200);
    const principal = await test.authenticate(token.body.access_token);
    let calendar = await test.store.createCalendar({ id: `calendar-${randomUUID()}`, ownerId: test.owner.id, title: "Synthetic private Calendar",
      timeZone: "UTC", agentAccess: "write", createdAt: new Date().toISOString() });
    const read = { capability: "calendar" as const, write: false, calendarId: calendar.id };
    await test.auth.authorize(principal, read); await test.auth.authorize(principal, { ...read, write: true });
    calendar = (await test.store.updateCalendar(test.owner.id, { calendarId: calendar.id, expectedUpdatedAt: calendar.updatedAt, patch: { agentAccess: "read" } }))!;
    await test.auth.authorize(principal, read);
    await expect(test.auth.authorize(principal, { ...read, write: true })).rejects.toMatchObject({ code: "calendar_access_denied" });
    calendar = (await test.store.updateCalendar(test.owner.id, { calendarId: calendar.id, expectedUpdatedAt: calendar.updatedAt, patch: { agentAccess: "none" } }))!;
    await expect(test.auth.authorize(principal, read)).rejects.toMatchObject({ code: "calendar_access_denied" });
    await expect(test.auth.authorize(principal, { ...read, write: true })).rejects.toMatchObject({ code: "calendar_access_denied" });
    const foreign = await test.store.createCalendar({ id: `calendar-${randomUUID()}`, ownerId: DEMO_GUEST_ID, title: "Other owner Calendar",
      timeZone: "UTC", agentAccess: "write", createdAt: new Date().toISOString() });
    await expect(test.auth.authorize(principal, { ...read, calendarId: foreign.id })).rejects.toMatchObject({ code: "calendar_access_denied" });
    expect((await test.store.getUserById(test.owner.id))?.agentConnectedAt).toBeNull();
  });

  it("serves the mounted OAuth and MCP protocols with a session-independent resource-only grant and no page connection", async () => {
    const test = await fixture({}, true);
    const server = createServer(test.app);
    const clients: Client[] = [];
    try {
      const registration = await test.register(); expect(registration.status).toBe(201);
      const clientId = registration.body.client_id;
      const { code, verifier } = await test.loginConsent(clientId, { scope: "records:read" });
      const token = await test.exchange(clientId, code, verifier); expect(token.status).toBe(200);
      expect(token.body).not.toHaveProperty("id_token"); expect(token.body.refresh_token).toEqual(expect.any(String));
      const storedRefresh = await test.auth.provider.RefreshToken.find(token.body.refresh_token);
      // oidc-provider persists only a true session-binding flag; omission is its
      // unbound representation, not a missing refresh-token record.
      expect(storedRefresh).toBeTruthy(); expect(storedRefresh?.expiresWithSession).not.toBe(true);
      expect((await test.store.getUserById(test.owner.id))?.agentConnectedAt).toBeNull();
      const page = await request(test.app).get("/api/me");
      expect(page.status).toBe(200); expect(page.body.user).toBeNull();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); if (!address || typeof address === "string") throw new Error("synthetic_server_unavailable");
      const connect = async (bearer: string) => {
        const client = new Client({ name: "synthetic-closed-page-agent", version: "1" }); clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
          reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 10, maxReconnectionDelay: 10, reconnectionDelayGrowFactor: 1 }
        }));
        return client;
      };
      const first = await connect(token.body.access_token);
      const ownRecords = await test.store.listLifeLinks(test.owner.id, null, { limit: 10 });
      const records = await first.callTool({ name: "list_records", arguments: {} });
      expect(records.isError).not.toBe(true); expect(records.structuredContent).toEqual({ contentIsUntrusted: true, data: ownRecords });
      await first.close();
      // A later agent session uses only the refresh token: no browser cookies,
      // page connection grant or remembered MCP session is necessary.
      const refreshed = await request(test.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId,
        refresh_token: token.body.refresh_token, resource: test.auth.resource });
      expect(refreshed.status).toBe(200);
      const later = await connect(refreshed.body.access_token);
      expect((await later.callTool({ name: "list_records", arguments: {} })).structuredContent).toEqual(records.structuredContent);
      expect((await test.store.getUserById(test.owner.id))?.agentConnectedAt).toBeNull();
    } finally {
      for (const client of clients) await client.close();
      await test.app.locals.closeRemoteAgent(); server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses real oidc-provider registration, S256 login/consent, resource token, refresh rotation and owner revocation", async () => {
    const test = await fixture();
    const registration = await test.register(); expect(registration.status).toBe(201);
    expect(registration.body.token_endpoint_auth_method).toBe("none");
    expect(registration.body).not.toHaveProperty("client_secret"); expect(registration.body).not.toHaveProperty("registration_access_token");
    const clientId = registration.body.client_id;
    const { code, verifier } = await test.loginConsent(clientId);
    const token = await test.exchange(clientId, code, verifier); expect(token.status).toBe(200);
    expect(token.body).toHaveProperty("refresh_token");
    const actor = await test.authenticate(token.body.access_token);
    expect(actor).toMatchObject({ ownerId: test.owner.id, clientId });
    await test.auth.authorize(actor, { capability: "routines", write: true });
    await expect(test.auth.authorize(actor, { capability: "calendar", write: true })).rejects.toThrow();
    const refresh = await request(test.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId,
      refresh_token: token.body.refresh_token, resource: test.auth.resource });
    expect(refresh.status).toBe(200); expect(refresh.body.refresh_token).not.toBe(token.body.refresh_token);
    const renewed = await test.authenticate(refresh.body.access_token); expect(renewed.grantId).toBe(actor.grantId);
    // Canonical human session manages the durable grant, independently of OIDC cookies.
    const humanToken = createSessionToken(); await test.store.createSession(test.owner.id, hashSessionToken(humanToken, test.config.sessionSecret), new Date(Date.now() + 60_000).toISOString());
    const manager = await request(test.app).get("/agent-connections").set("Cookie", `life_links_session=${humanToken}`);
    expect(manager.status).toBe(200); expect(manager.text).toContain("Synthetic agent");
    const revoke = await request(test.app).post("/agent-connections/revoke").set("Cookie", `life_links_session=${humanToken}`).set("Origin", BASE)
      .type("form").send({ grantId: actor.grantId, csrf: csrf(manager.text) });
    expect(revoke.status).toBe(303);
    await expect(test.authenticate(refresh.body.access_token)).rejects.toThrow();
    expect((await request(test.app).post("/oauth/token").type("form").send({ grant_type: "refresh_token", client_id: clientId,
      refresh_token: refresh.body.refresh_token, resource: test.auth.resource })).status).toBe(400);
    const serializedLogs = JSON.stringify(test.logs);
    for (const secret of [DEMO_PASSWORD, test.owner.email, code, verifier, token.body.access_token, token.body.refresh_token, humanToken]) expect(serializedLogs).not.toContain(secret);
  });

  it.each([
    { token_endpoint_auth_method: "client_secret_basic" }, { grant_types: ["client_credentials"] }, { grant_types: ["authorization_code", "password"] },
    { response_types: ["token"] }, { jwks_uri: "https://private.example/keys" }, { jwks: { keys: [] } }, { request_uris: ["https://private.example/request"] },
    { sector_identifier_uri: "https://private.example/sector" }, { initiate_login_uri: "https://private.example/login" }, { application_type: "unsupported" },
    { application_type: "native", redirect_uris: ["custom-scheme:/callback"] }, { application_type: "native", redirect_uris: ["http://untrusted.example/callback"] },
    { application_type: "native", redirect_uris: ["http://localhost/callback"] }, { application_type: "native", redirect_uris: ["http://2130706433/callback"] },
    { redirect_uris: ["http://untrusted.example/callback"] }, { redirect_uris: ["http://127.0.0.1.evil.example/callback"] },
    { redirect_uris: ["http://2130706433/callback"] }, { redirect_uris: ["https://user:password@example.test/callback"] },
    { redirect_uris: ["https://example.test/callback#fragment"] }, { scope: "records:read admin:all" }
  ])("rejects unsupported registration metadata without remote fetch: %j", async (metadata) => {
    const test = await fixture(); const fetch = vi.spyOn(globalThis, "fetch");
    try { const response = await test.register(metadata); expect(response.status).toBe(400); expect(response.body.error).toBe("invalid_client_metadata"); expect(fetch).not.toHaveBeenCalled(); }
    finally { fetch.mockRestore(); }
  });

  it.each(["http://127.0.0.1:38117/callback", "http://[::1]:38117/callback"])("allows an exact loopback public-client redirect %s", async (redirect) => {
    const test = await fixture(); expect((await test.register({ redirect_uris: [redirect] })).status).toBe(201);
  });

  it("requires S256, exact redirect/resource binding, and never grants after cancellation", async () => {
    const test = await fixture(); const registered = await test.register(); expect(registered.status).toBe(201);
    for (const params of [{ code_challenge_method: "plain" }, { code_challenge: undefined, code_challenge_method: undefined },
      { resource: "https://other.example/mcp" }, { redirect_uri: "https://synthetic-agent.example/other" }]) {
      const { response } = await test.begin(registered.body.client_id, params);
      expect(response.text).not.toContain('name="password"');
      expect((await test.state.listOwned("Grant", test.owner.id))).toHaveLength(0);
    }
    const { response } = await test.begin(registered.body.client_id);
    const cancelled = await test.submit(response, { action: "cancel" });
    expect(new URL(cancelled.headers.location).searchParams.get("error")).toBe("access_denied");
    expect((await test.state.listOwned("Grant", test.owner.id))).toHaveLength(0);
  });

  it("rejects wrong verifier and cross-client exchange before issuing any resource authority", async () => {
    const test = await fixture(); const registered = await test.register(); const other = await test.register({ client_name: "Other synthetic agent" });
    const { code, verifier } = await test.loginConsent(registered.body.client_id);
    const stolen = await test.exchange(other.body.client_id, code, verifier); expect(stolen.status).toBe(400);
    const wrong = await test.exchange(registered.body.client_id, code, "x".repeat(43)); expect(wrong.status).toBe(400);
    expect(stolen.body).not.toHaveProperty("access_token"); expect(wrong.body).not.toHaveProperty("access_token");
  });

  it("binds consent to the authenticated interaction account and refuses a conflicting human session", async () => {
    const test = await fixture(); const registered = await test.register();
    const { response } = await test.begin(registered.body.client_id);
    const consent = await test.submit(response, { email: test.owner.email, password: DEMO_PASSWORD });
    expect(consent.status).toBe(200); expect(consent.text).toContain(test.owner.email);
    const foreign = (await test.store.getUserById(DEMO_GUEST_ID))!;
    const foreignToken = createSessionToken();
    await test.store.createSession(foreign.id, hashSessionToken(foreignToken, test.config.sessionSecret), new Date(Date.now() + 60_000).toISOString());
    test.browser.jar.setCookie(`life_links_session=${foreignToken}; Path=/; HttpOnly`, "127.0.0.1", "/");
    const denied = await test.submit(consent, {});
    expect(denied.status).toBe(400); expect(denied.text).not.toContain(foreign.email);
    expect(await test.state.listOwned("Grant", test.owner.id)).toHaveLength(0);
    expect(await test.state.listOwned("Grant", foreign.id)).toHaveLength(0);
    // Removing only the conflicting human cookie leaves the real interaction
    // usable; the previous refusal was not caused by losing its OIDC cookies.
    test.browser.jar.setCookie("life_links_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT", "127.0.0.1", "/");
    expect((await test.submit(consent, {})).status).toBe(303);
    expect(await test.state.listOwned("Grant", test.owner.id)).toHaveLength(1);
    expect(await test.state.listOwned("Grant", foreign.id)).toHaveLength(0);
  });

  it("bounds registration and login routes and returns safe parse/CSRF failures", async () => {
    const test = await fixture({ RATE_LIMIT_ENABLED: "true", RATE_LIMIT_LOGIN_MAX: "2" });
    expect((await test.register()).status).toBe(201); expect((await test.register()).status).toBe(201);
    const limited = await test.register(); expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBeDefined();
    const invalid = await test.browser.post("/agent-authorize/unknown").set("Origin", "https://other.example").type("form").send({ password: "private-password-sentinel", csrf: "wrong" });
    expect(invalid.status).toBe(400); expect(invalid.text).not.toContain("private-password-sentinel");
    const oversized = await test.browser.post("/agent-authorize/unknown").set("Origin", BASE).type("form").send({ password: "x".repeat(14_000) });
    expect(oversized.status).toBe(413);
    expect((await test.browser.post("/agent-authorize/unknown").type("form").send({})).status).toBe(429);
  });
});
