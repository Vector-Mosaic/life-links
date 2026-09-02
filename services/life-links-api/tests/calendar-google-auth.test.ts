import { generateKeyPairSync, sign } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_CALENDAR_SCOPES, GoogleOAuthCalendarAuth, type GoogleCalendarTokenState } from "../src/calendar-google-auth.js";

const config = { clientId: "calendar-client.apps.googleusercontent.com", clientSecret: "synthetic-client-secret",
  redirectUri: "https://life-links.example/api/calendar-connections/google/callback" };
const subject = "109876543210987654321";
const nonce = "one-use-synthetic-nonce";
const verifier = "v".repeat(43);
const scope = GOOGLE_CALENDAR_SCOPES.join(" ");
const now = Date.now();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
type TransportOptions = Parameters<OAuth2Client["transporter"]["request"]>[0];

function idToken(patch: Record<string, unknown> = {}, wrongSignature = false) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: config.clientId, sub: subject,
    iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 3600, nonce, ...patch })).toString("base64url");
  const signed = `${header}.${payload}`;
  return `${signed}.${sign("RSA-SHA256", Buffer.from(signed), wrongSignature ? wrongKeys.privateKey : keys.privateKey).toString("base64url")}`;
}
function cache(patch: Record<string, unknown> = {}): GoogleCalendarTokenState {
  return { providerAccountId: subject, cache: JSON.stringify({ subject, credentials: {
    access_token: "synthetic-old-access", refresh_token: "synthetic-refresh", token_type: "Bearer", scope,
    expiry_date: now - 1000, ...patch
  } }) };
}

describe("Google Calendar OAuth owner", () => {
  let requests: TransportOptions[];
  let codeTokens: Record<string, unknown>;
  let refreshedTokens: Record<string, unknown>;
  let userInfo: Record<string, unknown>;
  let tokenInfo: Record<string, unknown>;
  let failTokenExchange: boolean;

  beforeEach(() => {
    requests = [];
    codeTokens = { access_token: "synthetic-initial-access", refresh_token: "synthetic-refresh", token_type: "Bearer", scope,
      expires_in: 3600, id_token: idToken() };
    refreshedTokens = { access_token: "synthetic-renewed-access", token_type: "Bearer", scope, expires_in: 3600 };
    userInfo = { sub: subject, email: "private-synthetic@example.test" };
    tokenInfo = { aud: config.clientId, sub: subject, scope, expires_in: 3600 };
    failTokenExchange = false;
    // Only HTTP is replaced. Actual SDK code exchange, refresh cache behavior,
    // nonce checks and cryptographic signature/audience/issuer/time checks run.
    const prototype = Object.getPrototypeOf(new OAuth2Client().transporter);
    vi.spyOn(prototype, "request").mockImplementation(async (input: TransportOptions) => {
      requests.push(input);
      const url = String(input.url);
      let data: unknown;
      if (url === "https://oauth2.googleapis.com/token") {
        if (failTokenExchange) throw new Error("synthetic-private-provider-error-token=do-not-propagate");
        data = new URLSearchParams(String(input.data)).get("grant_type") === "authorization_code" ? codeTokens : refreshedTokens;
      } else if (url === "https://www.googleapis.com/oauth2/v1/certs") data = { "synthetic-key": publicKey };
      else if (url === "https://openidconnect.googleapis.com/v1/userinfo") data = userInfo;
      else if (url === "https://oauth2.googleapis.com/tokeninfo") data = tokenInfo;
      else throw new Error("Unexpected test HTTP request");
      return { data: structuredClone(data), headers: new Headers({ "cache-control": "max-age=3600" }), status: 200,
        statusText: "OK", config: input };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("requests only explicit Calendar scopes with PKCE S256, account choice and an independent offline consent grant", async () => {
    const url = new URL(await new GoogleOAuthCalendarAuth(config).authorizationUrl({ state: "opaque-state", nonce, codeChallenge: "c".repeat(43) }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: "code", access_type: "offline", prompt: "consent select_account", include_granted_scopes: "false",
      state: "opaque-state", nonce, code_challenge: "c".repeat(43), code_challenge_method: "S256", scope });
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("redeems through the SDK and binds verified ID-token sub to opaque access-token userinfo, retaining only private refresh state", async () => {
    const state = await new GoogleOAuthCalendarAuth(config).redeem({ code: "one-use-code", nonce, codeVerifier: verifier });
    expect(state.providerAccountId).toBe(subject);
    expect(JSON.parse(state.cache)).toEqual({ subject, credentials: {
      access_token: "synthetic-initial-access", refresh_token: "synthetic-refresh", token_type: "Bearer", scope, expiry_date: expect.any(Number)
    } });
    expect(state.cache).not.toContain("private-synthetic@example.test");
    expect(state.cache).not.toContain("id_token");
    expect(state.cache).not.toContain(config.clientSecret);
    const exchange = requests.find((request) => String(request.url).endsWith("/token"))!;
    expect(Object.fromEntries(new URLSearchParams(String(exchange.data)))).toMatchObject({ code: "one-use-code",
      code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
      grant_type: "authorization_code" });
    expect(requests).toHaveLength(3);
    for (const request of requests) expect(request).toMatchObject({ timeout: 15_000, retry: false,
      retryConfig: { retry: 0, noResponseRetries: 0 }, redirect: "error", maxRedirects: 0, maxContentLength: 1_000_000 });
  });

  it.each(["signature", "issuer", "audience", "expired", "nonce", "subject", "authorized_party"])("rejects invalid signed identity evidence: %s", async (failure) => {
    codeTokens.id_token = idToken({
      ...(failure === "issuer" ? { iss: "https://attacker.example" } : {}),
      ...(failure === "audience" ? { aud: "other-client" } : {}),
      ...(failure === "expired" ? { iat: Math.floor(now / 1000) - 8000, exp: Math.floor(now / 1000) - 4000 } : {}),
      ...(failure === "nonce" ? { nonce: "other-nonce" } : {}),
      ...(failure === "subject" ? { sub: "" } : {}),
      ...(failure === "authorized_party" ? { azp: "other-client" } : {})
    }, failure === "signature");
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "one-use-code", nonce, codeVerifier: verifier }))
      .rejects.toThrow(/^Google calendar authorization failed\.$/);
    expect(requests.filter((request) => String(request.url).endsWith("/token"))).toHaveLength(1);
  });

  it.each(GOOGLE_CALENDAR_SCOPES)("refuses a partially granted permission set missing %s", async (missing) => {
    codeTokens.scope = GOOGLE_CALENDAR_SCOPES.filter((entry) => entry !== missing).join(" ");
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "one-use-code", nonce, codeVerifier: verifier }))
      .rejects.toThrow("Google calendar authorization failed.");
  });

  it("accepts Google's canonical email alias and verifies actual grants when token response omits scope", async () => {
    codeTokens.scope = scope.replace("email", "https://www.googleapis.com/auth/userinfo.email");
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "code-one", nonce, codeVerifier: verifier })).resolves.toMatchObject({ providerAccountId: subject });
    delete codeTokens.scope;
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "code-two", nonce, codeVerifier: verifier })).resolves.toMatchObject({ providerAccountId: subject });
    expect(requests.filter((request) => String(request.url).endsWith("/tokeninfo"))).toHaveLength(1);
    tokenInfo.aud = "another-client";
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "code-three", nonce, codeVerifier: verifier })).rejects.toThrow("Google calendar authorization failed.");
  });

  it.each(["missing_refresh", "userinfo_mismatch", "network_failure"])("refuses %s without leaking raw provider details or retrying the code exchange", async (failure) => {
    if (failure === "missing_refresh") delete codeTokens.refresh_token;
    if (failure === "userinfo_mismatch") userInfo.sub = "different-google-sub";
    if (failure === "network_failure") failTokenExchange = true;
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "one-use-code", nonce, codeVerifier: verifier }))
      .rejects.toThrow(/^Google calendar authorization failed\.$/);
    expect(requests.filter((request) => String(request.url).endsWith("/token"))).toHaveLength(1);
  });

  it("reuses a valid encrypted cached credential without inventing renewal or making provider calls", async () => {
    const state = cache({ expiry_date: now + 3600_000 });
    const result = await new GoogleOAuthCalendarAuth(config).refresh(state);
    expect(result).toMatchObject({ state: { providerAccountId: subject }, accessToken: "synthetic-old-access" });
    expect(JSON.parse(result.state.cache)).toEqual(JSON.parse(state.cache));
    expect(result).not.toHaveProperty("renewedAccessToken");
    expect(requests).toHaveLength(0);
  });

  it.each([false, true])("refreshes normally, preserves the old grant unless Google rotates it (%s), and validates unchanged identity", async (rotated) => {
    if (rotated) refreshedTokens.refresh_token = "synthetic-rotated-refresh";
    const result = await new GoogleOAuthCalendarAuth(config).refresh(cache());
    expect(result).toMatchObject({ accessToken: "synthetic-renewed-access", renewedAccessToken: true, state: { providerAccountId: subject } });
    expect(JSON.parse(result.state.cache).credentials).toMatchObject({ access_token: "synthetic-renewed-access",
      refresh_token: rotated ? "synthetic-rotated-refresh" : "synthetic-refresh", scope });
    expect(result.state).not.toHaveProperty("renewedAccessToken");
    expect(Object.fromEntries(new URLSearchParams(String(requests[0].data)))).toMatchObject({ grant_type: "refresh_token", refresh_token: "synthetic-refresh" });
    expect(requests).toHaveLength(2);
  });

  it("validates a new refresh ID token without requiring the original one-use nonce", async () => {
    refreshedTokens.id_token = idToken({ nonce: undefined });
    await expect(new GoogleOAuthCalendarAuth(config).refresh(cache())).resolves.toMatchObject({ renewedAccessToken: true });
    refreshedTokens.id_token = idToken({ sub: "different-google-sub", nonce: undefined });
    await expect(new GoogleOAuthCalendarAuth(config).refresh(cache())).rejects.toThrow("Google calendar authorization needs reconnection.");
  });

  it.each(["userinfo_mismatch", "scope_removed", "bad_signature", "network_failure", "malformed_cache", "cache_owner_mismatch"])("refuses unsafe renewal state: %s", async (failure) => {
    const state = cache();
    if (failure === "userinfo_mismatch") userInfo.sub = "different-google-sub";
    if (failure === "scope_removed") refreshedTokens.scope = "openid email";
    if (failure === "bad_signature") refreshedTokens.id_token = idToken({}, true);
    if (failure === "network_failure") failTokenExchange = true;
    if (failure === "malformed_cache") state.cache = "not-json";
    if (failure === "cache_owner_mismatch") state.providerAccountId = "different-google-sub";
    await expect(new GoogleOAuthCalendarAuth(config).refresh(state)).rejects.toThrow(/^Google calendar authorization needs reconnection\.$/);
    expect(requests.filter((request) => String(request.url).endsWith("/token")).length).toBeLessThanOrEqual(1);
  });

  it("checks renewed grants through Google when scope is omitted rather than blindly carrying cached permissions", async () => {
    delete refreshedTokens.scope;
    await expect(new GoogleOAuthCalendarAuth(config).refresh(cache())).resolves.toMatchObject({ renewedAccessToken: true });
    tokenInfo.scope = "openid email";
    await expect(new GoogleOAuthCalendarAuth(config).refresh(cache())).rejects.toThrow("Google calendar authorization needs reconnection.");
  });

  it("rejects unsafe config/PKCE before making any HTTP call", async () => {
    await expect(new GoogleOAuthCalendarAuth({ ...config, redirectUri: "http://external.example/callback" })
      .authorizationUrl({ state: "state", nonce, codeChallenge: "c".repeat(43) })).rejects.toThrow("Google calendar authorization failed.");
    await expect(new GoogleOAuthCalendarAuth(config).redeem({ code: "code", nonce, codeVerifier: "short" })).rejects.toThrow("Google calendar authorization failed.");
    expect(requests).toHaveLength(0);
  });
});
