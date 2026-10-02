import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import cookie from "cookie";
import { Router, urlencoded, type Request, type Response } from "express";
import { createProviderAdapters, createProviderTransaction, type ProviderAdapter, type ProviderTransaction,
  type VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import { normalizeCalendarIanaTimeZone } from "@life-links/core";
import type { LifeLinksConfig } from "./config.js";
import type { LifeLinksStore, StoredUser } from "./store.js";
import { invitationFingerprint, matchesRegistrationInvitation, memberRegistrationInvitation,
  RegistrationAdmissionError, validInvitationCode } from "./registration.js";
import type { Logger } from "./logger.js";

const BROWSER_COOKIE = "life_links_sign_in_browser";
const LIFETIME = 10 * 60_000;
type AuthRequest = Request & { user?: StoredUser; sessionTokenHash?: string; authTransport?: string; requestId?: string };
type Payload = { phase: "authorize" | "signup" | "link"; provider: string; expiresAt: number; returnTo: string;
  transaction?: ProviderTransaction; intent?: "login" | "register" | "link"; invitationCode?: string;
  timeZone: string; ownerId?: string; sessionHash?: string; identity?: VerifiedProviderIdentity };

/** Product policy stays here; the shared package owns only verified provider exchanges. */
export function createProviderSignInRouters(options: { store: LifeLinksStore; config: LifeLinksConfig; logger: Logger;
  adapters?: ProviderAdapter[]; issueSession(user: StoredUser, response: Response): Promise<void> }) {
  const { store, config, logger, issueSession } = options;
  const adapters = options.adapters ?? createProviderAdapters(config.providerSignIn ?? []);
  const callbacks = Router(); const routes = Router();
  const key = createHash("sha256").update(`life-links/provider-sign-in/v1:${config.sessionSecret}`).digest();
  const fingerprint = (value: string) => createHash("sha256").update(key).update(value).digest("hex");
  const budgets = new Map<string, { count: number; expires: number }>();
  const adapterFor = (id: string) => adapters.find(adapter => adapter.id === id);
  function budget(request: Request, response: Response) {
    const now = Date.now(); for (const [id, entry] of budgets) if (entry.expires <= now) budgets.delete(id);
    const id = request.ip || request.socket.remoteAddress || "unknown";
    let entry = budgets.get(id);
    if (!entry) {
      if (budgets.size >= 5000) { response.status(429).json({ error: "sign_in_rate_limited" }); return false; }
      entry = { count: 0, expires: now + 15 * 60_000 }; budgets.set(id, entry);
    }
    if (++entry.count > 10) { response.status(429).json({ error: "sign_in_rate_limited" }); return false; }
    return true;
  }
  function noStore(response: Response) { response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Referrer-Policy", "no-referrer"); }
  function browserValue(request: Request) { return cookie.parse(request.headers.cookie ?? "")[BROWSER_COOKIE] ?? ""; }
  function setBrowser(response: Response, value: string, formPost = false) {
    response.append("Set-Cookie", cookie.serialize(BROWSER_COOKIE, value, { httpOnly: true, secure: config.secureCookies,
      sameSite: formPost ? "none" : "lax", path: "/", maxAge: LIFETIME / 1000 }));
  }
  function clearBrowser(response: Response) {
    response.append("Set-Cookie", cookie.serialize(BROWSER_COOKIE, "", { httpOnly: true, secure: config.secureCookies,
      sameSite: "lax", path: "/", maxAge: 0 }));
  }
  async function save(rawToken: string, browser: string, payload: Payload) {
    const stateHash = fingerprint(rawToken), browserHash = fingerprint(browser), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${stateHash}:${browserHash}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    await store.saveProviderSignInAttempt({ stateHash, browserHash, provider: payload.provider,
      encryptedPayload: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url"), expiresAt: new Date(payload.expiresAt).toISOString() });
  }
  async function read(rawToken: unknown, request: Request, consume: boolean): Promise<Payload> {
    const browser = browserValue(request);
    if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(rawToken) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new Error();
    const stateHash = fingerprint(rawToken), browserHash = fingerprint(browser);
    const record = await (consume ? store.consumeProviderSignInAttempt(stateHash, browserHash) : store.getProviderSignInAttempt(stateHash, browserHash));
    if (!record) throw new Error();
    const bytes = Buffer.from(record.encryptedPayload, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${stateHash}:${browserHash}`)); decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as Payload;
    if (payload.expiresAt <= Date.now() || payload.provider !== record.provider) throw new Error();
    return payload;
  }
  async function invitation(code: unknown) {
    if (!validInvitationCode(code)) return null;
    const member = config.memberInvitationsEnabled ? await store.getMemberInvitation(invitationFingerprint(code)) : null;
    const accepted = member ? memberRegistrationInvitation(member) : config.registration && matchesRegistrationInvitation(code, config.registration) ? config.registration : null;
    return accepted && await store.registrationAvailable(accepted) ? accepted : null;
  }
  async function registerPublicOwner(identity: VerifiedProviderIdentity, displayName: string, email: string | null,
    timeZone: string, invitationCode?: string) {
    const accepted = await invitation(invitationCode);
    const input = { identity, displayName, email, timeZone };
    try {
      return await store.registerProviderOwner({ ...input, ...(accepted ? { invitation: accepted } : {}) });
    } catch (error) {
      // Cancellation/capacity races roll back admission atomically. The verified
      // subject can still join publicly; an uncertain store failure is not retried.
      if (!accepted || !(error instanceof RegistrationAdmissionError) || error.code !== "registration_unavailable") throw error;
      return store.registerProviderOwner(input);
    }
  }
  function returnPath(value: unknown) {
    if (value === undefined) return "/";
    if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\#\u0000-\u001f\u007f]/.test(value)) throw new Error();
    const url = new URL(value, config.qrBaseUrl);
    if (url.origin !== new URL(config.qrBaseUrl).origin) throw new Error();
    return `${url.pathname}${url.search}`;
  }
  function profile(value: unknown, email = false): string | null {
    if (typeof value !== "string") return null;
    const clean = value.trim();
    if (!clean || /[\u0000-\u001f\u007f]/.test(clean) || clean.length > (email ? 254 : 100)) return null;
    return email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean.toLowerCase() : null : clean;
  }
  function accountEmail(identity: VerifiedProviderIdentity) {
    // This retains the exact provider claim; it does not add mailbox recovery
    // authority. Unverified profile data cannot reserve the unique email field.
    return identity.emailVerified === true ? profile(identity.email, true) : null;
  }
  function fail(response: Response, returnTo = "/", code = "signin_failed") {
    noStore(response); clearBrowser(response); response.redirect(303, `${returnTo}#signin_error=${code}`);
  }
  function safeEvent(request: AuthRequest, event: string, provider: string, userId?: string) {
    logger.info(event, { msg: "Provider sign-in transition", request_id: request.requestId,
      provider: adapterFor(provider)?.id ?? "unknown", ...(userId ? { user_id: userId } : {}) });
  }
  routes.get("/api/auth/providers", (_request, response) => { noStore(response); response.json({ providers: adapters.map(adapter => ({ id: adapter.id, label: adapter.displayName })) }); });
  routes.get("/api/account-sign-in-methods", async (request: AuthRequest, response) => {
    noStore(response); if (!request.user) { response.status(401).json({ error: "authentication_required" }); return; }
    const [linked, phoneBindings] = await Promise.all([
      store.listProviderIdentities(request.user.id), store.listPhoneBindings(request.user.id)
    ]);
    response.json({ providers: adapters.map(adapter => ({ id: adapter.id, label: adapter.displayName,
      linked: linked.some(binding => binding.provider === adapter.id &&
        binding.clientId === config.providerSignIn?.find(provider => provider.id === adapter.id)?.clientId) })),
      phone: { enabled: Boolean(config.contactVerification?.phone), linked: phoneBindings.length > 0,
        maskedNumber: phoneBindings[0]?.maskedNumber ?? null } });
  });
  routes.post("/api/auth/providers/:provider/start", async (request: AuthRequest, response) => {
    noStore(response); if (!budget(request, response)) return;
    const provider = adapterFor(String(request.params.provider));
    if (!provider) { response.status(404).json({ error: "provider_unavailable" }); return; }
    try {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(name => !["intent", "returnTo", "invitationCode", "timeZone"].includes(name))) throw new Error();
      const intent = body.intent;
      if (!["login", "register", "link"].includes(intent)) throw new Error();
      if (intent === "link" && (!request.user || request.authTransport !== "cookie" || !request.sessionTokenHash)) { response.status(401).json({ error: "authentication_required" }); return; }
      if (intent === "register" && request.user) { response.status(409).json({ error: "sign_out_required" }); return; }
      if (provider.responseMode === "form_post" && !config.secureCookies) throw new Error();
      const returnTo = returnPath(body.returnTo), timeZone = normalizeCalendarIanaTimeZone(body.timeZone ?? "UTC");
      const transaction = createProviderTransaction(), browser = randomBytes(32).toString("base64url");
      const authorizationUrl = await provider.authorizationUrl(transaction);
      await save(transaction.state, browser, { phase: "authorize", provider: provider.id, transaction, intent, returnTo, timeZone,
        expiresAt: Date.now() + LIFETIME, ...(intent !== "link" && validInvitationCode(body.invitationCode) ? { invitationCode: body.invitationCode } : {}),
        ...(intent === "link" ? { ownerId: request.user!.id, sessionHash: request.sessionTokenHash } : {}) });
      setBrowser(response, browser, provider.responseMode === "form_post");
      safeEvent(request, "life_links.sign_in.started", provider.id);
      response.json({ authorizationUrl });
    } catch { response.status(400).json({ error: "invalid_sign_in_request" }); }
  });
  async function callback(request: AuthRequest, response: Response) {
    noStore(response); let payload: Payload | undefined;
    try {
      const provider = adapterFor(String(request.params.provider)); if (!provider) throw new Error();
      const values = request.method === "POST" ? request.body : request.query;
      if (!values || Object.values(values).some(value => typeof value !== "string" || value.length > 32768)) throw new Error();
      payload = await read(values.state, request, true);
      if (payload.phase !== "authorize" || payload.provider !== provider.id || !payload.transaction || !payload.intent) throw new Error();
      if (values.error) { fail(response, payload.returnTo); return; }
      const callbackUrl = new URL(`/api/auth/providers/${provider.id}/callback`, config.qrBaseUrl);
      for (const [name, value] of Object.entries(values)) callbackUrl.searchParams.set(name, String(value));
      const identity = await provider.redeem({ callbackUrl, transaction: payload.transaction });
      if (identity.provider !== provider.id) throw new Error();
      if (payload.intent === "link") {
        const session = payload.sessionHash ? await store.getSessionByTokenHash(payload.sessionHash) : null;
        if (!session || session.user.id !== payload.ownerId) throw new Error();
        // Apple's cross-site form POST omits the normal SameSite=Lax session.
        // Continue on our origin before requiring that original session again.
        if (request.method === "POST" && provider.responseMode === "form_post" && !request.user) {
          const token = randomBytes(32).toString("base64url");
          await save(token, browserValue(request), { phase: "link", provider: provider.id, identity,
            ownerId: payload.ownerId, sessionHash: payload.sessionHash, returnTo: payload.returnTo,
            timeZone: payload.timeZone, expiresAt: Date.now() + LIFETIME });
          response.redirect(303, `/#link=${token}`); return;
        }
        if (request.authTransport !== "cookie" || request.sessionTokenHash !== payload.sessionHash ||
            request.user?.id !== payload.ownerId) throw new Error();
        await store.linkProviderIdentity(session.user.id, identity);
        safeEvent(request, "life_links.sign_in.linked", provider.id, session.user.id);
        clearBrowser(response); response.redirect(303, payload.returnTo); return;
      }
      let user = await store.getProviderUser(identity);
      if (!user) {
        if (request.user) throw new Error();
        // Provider subject authentication admits the owner independently of
        // invitation or email. Apple returns to our origin before creation so
        // the canonical Lax cookie can enforce the same signed-out boundary.
        const email = accountEmail(identity), displayName = profile(identity.displayName);
        if (!displayName || (request.method === "POST" && provider.responseMode === "form_post")) {
          const token = randomBytes(32).toString("base64url");
          await save(token, browserValue(request), { phase: "signup", provider: provider.id, identity, returnTo: payload.returnTo,
            invitationCode: payload.invitationCode, timeZone: payload.timeZone, expiresAt: Date.now() + LIFETIME });
          response.redirect(303, `/register#signup=${token}`); return;
        }
        user = await registerPublicOwner(identity, displayName, email, payload.timeZone, payload.invitationCode);
      }
      await issueSession(user, response); clearBrowser(response);
      safeEvent(request, "life_links.sign_in.completed", provider.id, user.id);
      response.redirect(303, payload.returnTo);
    } catch (error) {
      safeEvent(request, "life_links.sign_in.failed", String(request.params.provider));
      fail(response, payload?.returnTo, payload?.intent === "link" ? "link_failed" : error instanceof RegistrationAdmissionError && error.code === "registration_failed" ? "signup_failed" : "signin_failed");
    }
  }
  callbacks.get("/api/auth/providers/:provider/callback", callback);
  callbacks.post("/api/auth/providers/:provider/callback", urlencoded({ extended: false, limit: "40kb", parameterLimit: 12 }), callback);
  routes.post("/api/auth/provider-link/complete", async (request: AuthRequest, response) => {
    noStore(response); if (!budget(request, response)) return;
    try {
      if (!request.body || Object.keys(request.body).some(name => name !== "linkToken") ||
          request.authTransport !== "cookie" || !request.user || !request.sessionTokenHash) throw new Error();
      const payload = await read(request.body.linkToken, request, true);
      if (payload.phase !== "link" || !payload.identity || request.sessionTokenHash !== payload.sessionHash ||
          request.user.id !== payload.ownerId) throw new Error();
      const session = await store.getSessionByTokenHash(payload.sessionHash);
      if (!session || session.user.id !== payload.ownerId) throw new Error();
      await store.linkProviderIdentity(session.user.id, payload.identity);
      safeEvent(request, "life_links.sign_in.linked", payload.provider, session.user.id);
      clearBrowser(response); response.json({ returnTo: payload.returnTo });
    } catch { response.status(400).json({ error: "invalid_sign_in_request" }); }
  });
  routes.post("/api/auth/provider-signup/details", async (request, response) => {
    noStore(response);
    try {
      if (Object.keys(request.body ?? {}).some(name => name !== "signupToken")) throw new Error();
      const payload = await read(request.body?.signupToken, request, false);
      if (payload.phase !== "signup" || !payload.identity) throw new Error();
      response.json({ email: profile(payload.identity.email, true), displayName: profile(payload.identity.displayName) });
    } catch { response.status(400).json({ error: "invalid_sign_in_request" }); }
  });
  routes.post("/api/auth/provider-signup/complete", async (request: AuthRequest, response) => {
    noStore(response); if (!budget(request, response)) return;
    try {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
          Object.keys(body).some(name => !["signupToken", "displayName", "timeZone"].includes(name)) || request.user) throw new Error();
      const displayName = profile(body.displayName), timeZone = normalizeCalendarIanaTimeZone(body.timeZone ?? "UTC");
      if (!displayName) throw new Error();
      const payload = await read(body.signupToken, request, true);
      if (payload.phase !== "signup" || !payload.identity) throw new Error();
      const user = await registerPublicOwner(payload.identity, displayName, accountEmail(payload.identity), timeZone, payload.invitationCode);
      await issueSession(user, response); clearBrowser(response);
      safeEvent(request, "life_links.sign_in.completed", payload.provider, user.id);
      response.status(201).json({ returnTo: payload.returnTo });
    } catch (error) { response.status(error instanceof RegistrationAdmissionError ? 409 : 400).json({ error: error instanceof RegistrationAdmissionError ? "signup_failed" : "invalid_sign_in_request" }); }
  });
  return { callbacks, routes };
}
