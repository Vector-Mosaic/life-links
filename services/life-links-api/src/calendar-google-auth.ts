import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid", "email", "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events"
] as const;

export type GoogleCalendarAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleCalendarTokenState = { cache: string; providerAccountId: string };
export interface GoogleCalendarAuth {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string>;
  redeem(input: { code: string; nonce: string; codeVerifier: string }): Promise<GoogleCalendarTokenState>;
  refresh(state: GoogleCalendarTokenState): Promise<{ state: GoogleCalendarTokenState; accessToken: string; renewedAccessToken?: true }>;
}

const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const AUTH_ENDPOINTS = new Set([
  "https://oauth2.googleapis.com/token", "https://oauth2.googleapis.com/tokeninfo",
  "https://www.googleapis.com/oauth2/v1/certs", "https://www.googleapis.com/oauth2/v3/certs", USERINFO_URL
]);
const MAX_PRIVATE_RESPONSE_BYTES = 1_000_000;
type SavedCredentials = { subject: string; credentials: Credentials };

/** Google's SDK owns OAuth and signed ID-token verification. The caller encrypts this private cache. */
export class GoogleOAuthCalendarAuth implements GoogleCalendarAuth {
  constructor(private readonly config: GoogleCalendarAuthConfig) {}

  #client() {
    const redirect = new URL(this.config.redirectUri);
    if (!boundedString(this.config.clientId, 512) || !boundedString(this.config.clientSecret, 8192) ||
      redirect.username || redirect.password || redirect.hash ||
      (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname)))) throw new Error();
    const client = new OAuth2Client({ clientId: this.config.clientId, clientSecret: this.config.clientSecret, redirectUri: this.config.redirectUri });
    const request = client.transporter.request.bind(client.transporter);
    // SDK methods opt into retries themselves. Enforce the bound at their actual
    // transport boundary, including one-use authorization-code exchanges.
    client.transporter.request = async <T>(options: Parameters<typeof request>[0]) => {
      if (!options) throw new Error();
      const url = new URL(String(options.url));
      if (!AUTH_ENDPOINTS.has(url.href) || url.username || url.password) throw new Error();
      const response = await request<T>({ ...options, timeout: 15_000, signal: AbortSignal.timeout(15_000),
        retry: false, retryConfig: { retry: 0, noResponseRetries: 0 }, redirect: "error", maxRedirects: 0,
        maxContentLength: MAX_PRIVATE_RESPONSE_BYTES });
      if (Buffer.byteLength(JSON.stringify(response.data) ?? "", "utf8") > MAX_PRIVATE_RESPONSE_BYTES) throw new Error();
      return response;
    };
    return client;
  }

  async authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    try {
      if (!boundedString(input.state, 1024) || !boundedString(input.nonce, 512) || !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw new Error();
      return this.#client().generateAuthUrl({ response_type: "code", access_type: "offline", prompt: "consent select_account",
        scope: [...GOOGLE_CALENDAR_SCOPES], include_granted_scopes: false,
        state: input.state, nonce: input.nonce, code_challenge: input.codeChallenge, code_challenge_method: CodeChallengeMethod.S256 });
    } catch { throw new Error("Google calendar authorization failed."); }
  }

  async redeem(input: { code: string; nonce: string; codeVerifier: string }): Promise<GoogleCalendarTokenState> {
    try {
      if (!boundedString(input.code, 8192) || !boundedString(input.nonce, 512) || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new Error();
      const client = this.#client();
      const { tokens } = await client.getToken({ code: input.code, codeVerifier: input.codeVerifier, redirect_uri: this.config.redirectUri });
      if (!boundedString(tokens.id_token, 32_768) || !boundedString(tokens.access_token, 16_384) || !boundedString(tokens.refresh_token, 16_384)) throw new Error();
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.clientId });
      const claims = ticket.getPayload();
      if (!claims || claims.nonce !== input.nonce || !validSubject(claims.sub) || (claims.azp !== undefined && claims.azp !== this.config.clientId)) throw new Error();
      await this.#verifyAccessIdentity(client, tokens.access_token, claims.sub);
      const scope = await this.#grantedScope(client, tokens.access_token, tokens.scope);
      return saveCredentials(claims.sub, { ...tokens, scope });
    } catch { throw new Error("Google calendar authorization failed."); }
  }

  async refresh(state: GoogleCalendarTokenState): Promise<{ state: GoogleCalendarTokenState; accessToken: string; renewedAccessToken?: true }> {
    try {
      const saved = readCredentials(state);
      const client = this.#client();
      client.setCredentials(saved.credentials);
      const exchanges: Credentials[] = [];
      // Snapshot before OAuth2Client replaces the response's refresh_token with
      // the previous one. A provider-returned rotated grant must not be lost.
      client.on("tokens", (tokens) => { exchanges.push({ ...tokens }); });
      const { token } = await client.getAccessToken();
      if (!boundedString(token, 16_384) || exchanges.length > 1) throw new Error();
      const exchanged = exchanges[0];
      if (!exchanged) {
        if (token !== saved.credentials.access_token) throw new Error();
        return { accessToken: token, state: saveCredentials(saved.subject, saved.credentials) };
      }
      if (exchanged.access_token !== token) throw new Error();
      if (exchanged.id_token !== undefined && exchanged.id_token !== null) {
        if (!boundedString(exchanged.id_token, 32_768)) throw new Error();
        const ticket = await client.verifyIdToken({ idToken: exchanged.id_token, audience: this.config.clientId });
        const claims = ticket.getPayload();
        if (!claims || claims.sub !== saved.subject || (claims.azp !== undefined && claims.azp !== this.config.clientId)) throw new Error();
      }
      await this.#verifyAccessIdentity(client, token, saved.subject);
      const scope = await this.#grantedScope(client, token, exchanged.scope);
      const credentials = { ...client.credentials, scope,
        refresh_token: exchanged.refresh_token ?? saved.credentials.refresh_token };
      return { accessToken: token, state: saveCredentials(saved.subject, credentials), renewedAccessToken: true };
    } catch { throw new Error("Google calendar authorization needs reconnection."); }
  }

  async #verifyAccessIdentity(client: OAuth2Client, accessToken: string, expectedSubject: string) {
    // Access tokens are opaque: Google's authenticated userinfo owns this identity,
    // not email, an unsigned JWT decode, or caller-supplied account metadata.
    const response = await client.transporter.request<{ sub?: unknown }>({ url: USERINFO_URL, method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!response.data || response.data.sub !== expectedSubject) throw new Error();
  }

  async #grantedScope(client: OAuth2Client, accessToken: string, scope: string | null | undefined): Promise<string> {
    if (scope === undefined || scope === null) {
      const info = await client.getTokenInfo(accessToken);
      if (info.aud !== this.config.clientId || !Array.isArray(info.scopes)) throw new Error();
      scope = info.scopes.join(" ");
    }
    if (!hasRequiredScopes(scope)) throw new Error();
    return scope;
  }
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validSubject(value: unknown): value is string {
  return boundedString(value, 255) && !/\s/.test(value);
}
function hasRequiredScopes(value: unknown): value is string {
  if (!boundedString(value, 16_384)) return false;
  const scopes = new Set(value.split(/ +/));
  // Google can canonicalize the requested OIDC "email" scope to its URI.
  if (scopes.has("https://www.googleapis.com/auth/userinfo.email")) scopes.add("email");
  return GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.has(scope));
}
function saveCredentials(subject: string, credentials: Credentials): GoogleCalendarTokenState {
  if (!validSubject(subject) || !boundedString(credentials.access_token, 16_384) ||
    !boundedString(credentials.refresh_token, 16_384) || !hasRequiredScopes(credentials.scope) ||
    typeof credentials.expiry_date !== "number" || !Number.isFinite(credentials.expiry_date) || credentials.expiry_date <= 0 ||
    credentials.token_type?.toLowerCase() !== "bearer") throw new Error();
  // Keep only the SDK fields needed for normal refresh. Identity proof has been
  // consumed; ID tokens, profiles, authorization codes and verifiers are not cached.
  const saved: SavedCredentials = { subject, credentials: { access_token: credentials.access_token,
    refresh_token: credentials.refresh_token, expiry_date: credentials.expiry_date, scope: credentials.scope, token_type: "Bearer" } };
  return { providerAccountId: subject, cache: JSON.stringify(saved) };
}
function readCredentials(state: GoogleCalendarTokenState): SavedCredentials {
  if (!validSubject(state.providerAccountId) || !boundedString(state.cache, 65_536)) throw new Error();
  const saved = JSON.parse(state.cache) as SavedCredentials;
  if (!saved || saved.subject !== state.providerAccountId || !saved.credentials) throw new Error();
  // Project validated known fields instead of hydrating arbitrary cache properties.
  return JSON.parse(saveCredentials(saved.subject, saved.credentials).cache) as SavedCredentials;
}
