import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import cookie from "cookie";
import { Router, type Request, type Response } from "express";
import type { LifeLinksConfig } from "./config.js";
import type { LifeLinksStore, StoredUser } from "./store.js";
import type { VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import type { CalendarAuthorizationService } from "./calendar-authorization.js";
import { isNativeRequest } from "./native-request.js";

export const NATIVE_AUTH_REDIRECT_URI = "lifelinks://auth/callback";
const CALENDAR_COOKIE = "life_links_native_calendar";
const LIFETIME = 10 * 60_000;
const EXCHANGE_LIFETIME = 60_000;
type AuthRequest = Request & { user?: StoredUser; sessionTokenHash?: string; authTransport?: string };
export type NativeAuthContext = {
  intent: "login" | "register" | "link" | "calendar";
  codeChallenge: string;
  returnTo: string;
  expiresAt: number;
  ownerId?: string;
  sessionHash?: string;
};
type Launch = NativeAuthContext & { phase: "launch"; provider?: string; calendarProvider?: "google" | "microsoft";
  invitationCode?: string; timeZone?: string; reconnectConnectionId?: string };
export type NativePendingLink = { identity: VerifiedProviderIdentity; revocationCustody?: { encryptedPayload: string } };
type Exchange = NativeAuthContext & { phase: "exchange"; userId?: string; calendarAuthorizationId?: string; error?: string; pendingLink?: NativePendingLink };
type CalendarPending = NativeAuthContext & { phase: "calendar"; calendarProvider: "google" | "microsoft"; state: string };
type Payload = Launch | Exchange | CalendarPending;

/** A transport handoff around the existing product authentication owners.
 * The app owns its verifier; only one-use, verifier-bound codes enter URLs. */
export function createNativeAuthBoundary(options: {
  store: LifeLinksStore; config: LifeLinksConfig; calendarAuthorization?: CalendarAuthorizationService;
  providerAvailable(provider: string): boolean;
  startProvider(request: Request, response: Response, launch: Launch): Promise<void>;
  issueSession(user: StoredUser, response: Response, native?: boolean): Promise<string | void>;
  sessionResponse(user: StoredUser): object;
}) {
  const { store, config } = options;
  const routes = Router();
  const key = createHash("sha256").update(`life-links/native-auth/v1:${config.sessionSecret}`).digest();
  const fingerprint = (value: string) => createHash("sha256").update(key).update(value).digest("hex");
  const randomToken = () => randomBytes(32).toString("base64url");
  function noStore(response: Response) {
    response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Referrer-Policy", "no-referrer");
  }
  function localPath(value: unknown): string {
    if (value === undefined) return "/";
    if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\#\u0000-\u001f\u007f]/.test(value)) throw new Error();
    const url = new URL(value, config.qrBaseUrl);
    if (url.origin !== new URL(config.qrBaseUrl).origin) throw new Error();
    return `${url.pathname}${url.search}`;
  }
  async function save(token: string, binding: string, payload: Payload) {
    const stateHash = fingerprint(`token:${token}`), browserHash = fingerprint(binding), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(Buffer.from(`${stateHash}:${browserHash}`));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    await store.saveProviderSignInAttempt({ stateHash, browserHash, provider: "native",
      ...(payload.ownerId ? { ownerId: payload.ownerId } : {}),
      encryptedPayload: Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64url"),
      expiresAt: new Date(payload.expiresAt).toISOString() });
  }
  async function read(token: unknown, binding: string, consume = false): Promise<Payload> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error();
    const stateHash = fingerprint(`token:${token}`), browserHash = fingerprint(binding);
    const row = await (consume ? store.consumeProviderSignInAttempt(stateHash, browserHash) : store.getProviderSignInAttempt(stateHash, browserHash));
    if (!row || row.provider !== "native") throw new Error();
    const bytes = Buffer.from(row.encryptedPayload, "base64url"), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${stateHash}:${browserHash}`)); decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as Payload;
    if (payload.expiresAt <= Date.now()) throw new Error();
    return payload;
  }
  async function liveOwner(context: NativeAuthContext): Promise<StoredUser> {
    const session = context.sessionHash ? await store.getSessionByTokenHash(context.sessionHash) : null;
    if (!session || session.user.id !== context.ownerId) throw new Error();
    return session.user;
  }
  async function completionUrl(context: NativeAuthContext, user?: StoredUser, calendarAuthorizationId?: string, error?: string, pendingLink?: NativePendingLink): Promise<string> {
    if (context.expiresAt <= Date.now()) throw new Error();
    if (context.intent === "link" || context.intent === "calendar") {
      const current = await liveOwner(context);
      if (user && current.id !== user.id) throw new Error();
      user = current;
    }
    const code = randomToken();
    await save(code, `challenge:${context.codeChallenge}`, { ...context, phase: "exchange",
      expiresAt: Math.min(context.expiresAt, Date.now() + EXCHANGE_LIFETIME),
      ...(user ? { userId: user.id, ownerId: user.id } : {}),
      ...(calendarAuthorizationId ? { calendarAuthorizationId } : {}), ...(error ? { error } : {}), ...(pendingLink ? { pendingLink } : {}) });
    const url = new URL(NATIVE_AUTH_REDIRECT_URI); url.searchParams.set("code", code); return url.href;
  }
  routes.post("/api/auth/native/start", async (request: AuthRequest, response) => {
    noStore(response);
    try {
      const body = request.body;
      if (!isNativeRequest(request) || !body || Object.keys(body).some(key => ![
        "client", "provider", "calendarProvider", "intent", "returnTo", "timeZone", "invitationCode", "reconnectConnectionId", "codeChallenge", "redirectUri"
      ].includes(key)) || body.redirectUri !== NATIVE_AUTH_REDIRECT_URI || typeof body.codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) throw new Error();
      const calendar = body.intent === "calendar";
      if (calendar ? !["google", "microsoft"].includes(body.calendarProvider) || body.provider !== undefined
        : !["login", "register", "link"].includes(body.intent) || typeof body.provider !== "string" || body.calendarProvider !== undefined || body.reconnectConnectionId !== undefined) throw new Error();
      if (!calendar && !options.providerAvailable(body.provider)) throw new Error();
      if (calendar && !options.calendarAuthorization?.supportsProvider(body.calendarProvider)) throw new Error();
      const bound = calendar || body.intent === "link";
      if (bound && (!request.user || request.authTransport !== "bearer" || !request.sessionTokenHash)) {
        response.status(401).json({ error: "authentication_required" }); return;
      }
      if (body.intent === "register" && request.user) { response.status(409).json({ error: "sign_out_required" }); return; }
      const token = randomToken();
      const launch: Launch = { phase: "launch", intent: body.intent, codeChallenge: body.codeChallenge,
        returnTo: localPath(body.returnTo), expiresAt: Date.now() + LIFETIME,
        ...(calendar ? { calendarProvider: body.calendarProvider } : { provider: body.provider }),
        ...(body.invitationCode !== undefined ? { invitationCode: body.invitationCode } : {}),
        ...(body.timeZone !== undefined ? { timeZone: body.timeZone } : {}),
        ...(body.reconnectConnectionId !== undefined ? { reconnectConnectionId: body.reconnectConnectionId } : {}),
        ...(bound ? { ownerId: request.user!.id, sessionHash: request.sessionTokenHash } : {}) };
      if ([launch.invitationCode, launch.timeZone, launch.reconnectConnectionId].some(value => value !== undefined &&
        (typeof value !== "string" || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)))) throw new Error();
      await save(token, `launch:${token}`, launch);
      response.json({ browserUrl: `${config.qrBaseUrl}/api/auth/native/launch?ticket=${token}` });
    } catch { response.status(400).json({ error: "invalid_native_auth" }); }
  });
  routes.get("/api/auth/native/launch", async (request: AuthRequest, response) => {
    noStore(response); let launch: Launch | undefined;
    try {
      if (Object.keys(request.query).some(key => key !== "ticket")) throw new Error();
      const payload = await read(request.query.ticket, `launch:${request.query.ticket}`, true);
      if (payload.phase !== "launch") throw new Error(); launch = payload;
      if (launch.ownerId) {
        const user = await liveOwner(launch);
        if (request.user && request.user.id !== user.id) throw new Error();
        // Launch does not install owner authentication in the system browser.
        // Link commits only after app PKCE proof; Calendar grants remain pending
        // until the original native bearer selects and completes authorization.
      }
      if (launch.calendarProvider) {
        const result = await options.calendarAuthorization!.start(launch.ownerId!, launch.sessionHash!, launch.reconnectConnectionId, launch.calendarProvider);
        const state = new URL(result.authorizationUrl).searchParams.get("state"); if (!state) throw new Error();
        const pending = randomToken();
        await save(pending, `calendar:${pending}`, { phase: "calendar", intent: "calendar", codeChallenge: launch.codeChallenge,
          returnTo: launch.returnTo, expiresAt: launch.expiresAt, ownerId: launch.ownerId, sessionHash: launch.sessionHash,
          calendarProvider: launch.calendarProvider, state });
        response.append("Set-Cookie", cookie.serialize(CALENDAR_COOKIE, pending, { httpOnly: true,
          secure: config.secureCookies, sameSite: "lax", path: "/", maxAge: LIFETIME / 1000 }));
        response.redirect(303, result.authorizationUrl); return;
      }
      await options.startProvider(request, response, launch);
    } catch {
      if (launch) {
        try { response.redirect(303, await completionUrl(launch, undefined, undefined, "native_auth_failed")); return; } catch { /* expired/revoked */ }
      }
      response.status(400).json({ error: "invalid_native_auth" });
    }
  });
  routes.post("/api/auth/native/exchange", async (request, response) => {
    noStore(response);
    try {
      if (!isNativeRequest(request) || !request.body || Object.keys(request.body).some(key => !["client", "code", "codeVerifier"].includes(key)) ||
        typeof request.body.codeVerifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(request.body.codeVerifier)) throw new Error();
      const challenge = createHash("sha256").update(request.body.codeVerifier).digest("base64url");
      const payload = await read(request.body.code, `challenge:${challenge}`, true);
      if (payload.phase !== "exchange" || payload.codeChallenge !== challenge) throw new Error();
      if (payload.error) { response.status(400).json({ error: payload.error }); return; }
      const user = payload.intent === "link" || payload.intent === "calendar" ? await liveOwner(payload) :
        payload.userId ? await store.getUserById(payload.userId) : null;
      if (!user || user.id !== payload.userId) throw new Error();
      if (payload.intent === "calendar") {
        response.json({ status: "calendar_authorized", calendarAuthorizationId: payload.calendarAuthorizationId,
          ...options.sessionResponse(user), returnTo: payload.returnTo }); return;
      }
      if (payload.intent === "link") {
        if (!payload.pendingLink) throw new Error();
        await store.linkProviderIdentity(user.id, payload.pendingLink.identity, payload.pendingLink.revocationCustody, payload.sessionHash);
        response.json({ status: "linked", ...options.sessionResponse(user), returnTo: payload.returnTo }); return;
      }
      const sessionToken = await options.issueSession(user, response, true);
      response.json({ status: "signed_in", ...options.sessionResponse(user), sessionToken, returnTo: payload.returnTo });
    } catch { response.status(400).json({ error: "invalid_native_auth" }); }
  });
  return {
    routes, completionUrl, async validateContext(context: NativeAuthContext) {
      if (context.expiresAt <= Date.now()) throw new Error();
      if (context.intent === "link" || context.intent === "calendar") await liveOwner(context);
    },
    async calendarContext(request: Request, provider: "google" | "microsoft"): Promise<{ ownerId: string; sessionIdentity: string } | null> {
      const token = cookie.parse(request.headers.cookie ?? "")[CALENDAR_COOKIE];
      if (!token) return null;
      let payload: Payload;
      try { payload = await read(token, `calendar:${token}`); } catch { return null; }
      if (payload.phase !== "calendar" || payload.calendarProvider !== provider || payload.state !== request.query.state) return null;
      await liveOwner(payload);
      return { ownerId: payload.ownerId!, sessionIdentity: payload.sessionHash! };
    },
    async finishCalendar(request: Request, response: Response, provider: "google" | "microsoft", authorizationId?: string, error?: string): Promise<boolean> {
      const token = cookie.parse(request.headers.cookie ?? "")[CALENDAR_COOKIE];
      if (!token) return false;
      let pending: Payload;
      try { pending = await read(token, `calendar:${token}`); } catch { return false; }
      if (pending.phase !== "calendar" || pending.calendarProvider !== provider || pending.state !== request.query.state) return false;
      const payload = await read(token, `calendar:${token}`, true);
      if (payload.phase !== "calendar") throw new Error();
      response.append("Set-Cookie", cookie.serialize(CALENDAR_COOKIE, "", { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", maxAge: 0 }));
      response.redirect(303, await completionUrl(payload, undefined, authorizationId, error)); return true;
    }
  };
}
