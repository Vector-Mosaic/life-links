import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConfidentialClientApplication, type INetworkModule, type NetworkRequestOptions } from "@azure/msal-node";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { decodeJwt, importPKCS8, SignJWT, type JWTPayload } from "jose";
import { contactEmail, object, optionalString, postForm, requestJson, requiredString } from "./http.js";
import { IdentityTokenVerifier } from "./oidc.js";
import { ProviderSignInError, type ProviderAdapter, type ProviderId, type ProviderSignInConfig, type ProviderTransaction, type VerifiedProviderIdentity } from "./types.js";

export { ProviderSignInError } from "./types.js";
export type { ProviderAdapter, ProviderId, ProviderSignInConfig, ProviderTransaction, VerifiedProviderIdentity } from "./types.js";

const IDENTITY_SCOPES = ["openid", "profile", "email"];
const GOOGLE_ISSUER = "https://accounts.google.com";
const APPLE_ISSUER = "https://appleid.apple.com";
const OPENAI_ISSUER = "https://auth.openai.com";
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The consumer owns expiration, browser binding and atomic one-time consumption. */
export function createProviderTransaction(): ProviderTransaction {
  return {
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    codeVerifier: randomBytes(32).toString("base64url"),
  };
}

function validateTransaction(transaction: ProviderTransaction): void {
  if (!transaction || !/^[A-Za-z0-9_-]{32,128}$/u.test(transaction.state) || !/^[A-Za-z0-9_-]{32,128}$/u.test(transaction.nonce) || !/^[A-Za-z0-9._~-]{43,128}$/u.test(transaction.codeVerifier)) throw new ProviderSignInError();
}

function challenge(transaction: ProviderTransaction): string {
  return createHash("sha256").update(transaction.codeVerifier).digest("base64url");
}

function callbackCode(config: ProviderSignInConfig, callback: URL, transaction: ProviderTransaction): string {
  validateTransaction(transaction);
  const expected = new URL(config.redirectUri);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash || callback.username || callback.password) throw new ProviderSignInError();
  if (callback.searchParams.getAll("state").length !== 1 || callback.searchParams.getAll("code").length !== 1 || callback.searchParams.has("error")) throw new ProviderSignInError();
  const returnedState = requiredString(callback.searchParams.get("state"), 128);
  const received = Buffer.from(returnedState, "utf8");
  const original = Buffer.from(transaction.state, "utf8");
  if (received.length !== original.length || !timingSafeEqual(received, original)) throw new ProviderSignInError();
  return requiredString(callback.searchParams.get("code"));
}

function authorization(endpoint: string, config: ProviderSignInConfig, transaction: ProviderTransaction, scopes: string[], pkce: boolean, extra: Record<string, string> = {}): string {
  validateTransaction(transaction);
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: transaction.state,
    ...extra,
  }).toString();
  if (pkce) {
    url.searchParams.set("code_challenge", challenge(transaction));
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

function tokenBody(config: ProviderSignInConfig, code: string, transaction: ProviderTransaction, pkce: boolean): URLSearchParams {
  const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, redirect_uri: config.redirectUri, code });
  if (pkce) body.set("code_verifier", transaction.codeVerifier);
  return body;
}

function identity(config: ProviderSignInConfig, issuer: string, payload: JWTPayload, emailVerified: boolean): VerifiedProviderIdentity {
  const subject = requiredString(payload.sub, 255);
  const email = contactEmail(payload.email);
  return { provider: config.id, issuer, clientId: config.clientId, subject, email, emailVerified: email !== null && emailVerified, displayName: optionalString(payload.name) };
}

function configString(value: unknown, max = 8192): void {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new ProviderSignInError("invalid_configuration");
}

function validateConfig(config: ProviderSignInConfig): void {
  configString(config.clientId, 1024);
  configString(config.redirectUri, 2048);
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.href !== config.redirectUri) throw new ProviderSignInError("invalid_configuration");
  switch (config.id) {
    case "google":
    case "github":
      configString(config.clientSecret);
      break;
    case "microsoft": {
      configString(config.clientSecret);
      const tenant = config.tenant ?? "common";
      if (!["common", "organizations", "consumers"].includes(tenant) && !TENANT_UUID.test(tenant)) throw new ProviderSignInError("invalid_configuration");
      break;
    }
    case "apple":
      if (!/^[A-Za-z0-9]{10}$/u.test(config.teamId) || !/^[A-Za-z0-9]{10}$/u.test(config.keyId) || typeof config.privateKeyPem !== "string" || config.privateKeyPem.length > 32_768 || !config.privateKeyPem.startsWith("-----BEGIN PRIVATE KEY-----") || !config.privateKeyPem.trimEnd().endsWith("-----END PRIVATE KEY-----")) throw new ProviderSignInError("invalid_configuration");
      break;
    case "facebook":
      configString(config.clientSecret);
      if (!/^[0-9]{1,32}$/u.test(config.clientId) || !/^v[1-9][0-9]?\.0$/u.test(config.graphApiVersion)) throw new ProviderSignInError("invalid_configuration");
      break;
    case "chatgpt":
      if (config.approved !== true || !/^oaiapp_[A-Za-z0-9_-]+$/u.test(config.clientId)) throw new ProviderSignInError("invalid_configuration");
      if (config.tokenEndpointAuthMethod === "client_secret_basic") configString(config.clientSecret);
      else if (config.tokenEndpointAuthMethod !== "none" || "clientSecret" in config) throw new ProviderSignInError("invalid_configuration");
      break;
    default:
      throw new ProviderSignInError("invalid_configuration");
  }
}

function safeAdapter(id: ProviderId, displayName: string, responseMode: "query" | "form_post", makeUrl: ProviderAdapter["authorizationUrl"], redeem: ProviderAdapter["redeem"]): ProviderAdapter {
  return {
    id, displayName, responseMode,
    async authorizationUrl(transaction) {
      try { return await makeUrl(transaction); } catch { throw new ProviderSignInError(); }
    },
    async redeem(input) {
      try { return await redeem(input); } catch { throw new ProviderSignInError(); }
    },
  };
}

function google(config: Extract<ProviderSignInConfig, { id: "google" }>): ProviderAdapter {
  const client = () => new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri });
  return safeAdapter(config.id, "Google", "query", async (transaction) => {
    validateTransaction(transaction);
    return client().generateAuthUrl({
      scope: IDENTITY_SCOPES,
      state: transaction.state,
      nonce: transaction.nonce,
      access_type: "online",
      include_granted_scopes: false,
      prompt: "select_account",
      code_challenge: challenge(transaction),
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }, async ({ callbackUrl, transaction }) => {
    const body = tokenBody(config, callbackCode(config, callbackUrl, transaction), transaction, true);
    body.set("client_secret", config.clientSecret);
    const tokens = await postForm("https://oauth2.googleapis.com/token", body);
    const certData = object((await requestJson("https://www.googleapis.com/oauth2/v1/certs")).body);
    const certs: Record<string, string> = {};
    const entries = Object.entries(certData);
    if (entries.length === 0 || entries.length > 32) throw new ProviderSignInError();
    for (const [key, certificate] of entries) {
      if (typeof certificate !== "string" || certificate.length > 16_384 || !certificate.startsWith("-----BEGIN CERTIFICATE-----") || !certificate.trimEnd().endsWith("-----END CERTIFICATE-----")) throw new ProviderSignInError();
      certs[key] = certificate;
    }
    // The official Google SDK verifies the signature, issuer, audience and token lifetime.
    const ticket = await client().verifySignedJwtWithCertsAsync(requiredString(tokens.id_token, 32_768), certs, config.clientId, [GOOGLE_ISSUER, "accounts.google.com"]);
    const payload = ticket.getPayload() as unknown as JWTPayload | undefined;
    if (!payload || payload.nonce !== transaction.nonce || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000 - 5 || typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5 || (payload.azp !== undefined && payload.azp !== config.clientId)) throw new ProviderSignInError();
    return identity(config, GOOGLE_ISSUER, payload, payload.email_verified === true);
  });
}

const microsoftNetwork: INetworkModule = {
  async sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions) {
    const endpoint = new URL(url);
    if (endpoint.origin !== "https://login.microsoftonline.com" || endpoint.username || endpoint.password) throw new ProviderSignInError();
    const result = await requestJson(url, { headers: options?.headers });
    return { body: result.body as T, headers: result.headers, status: result.status };
  },
  async sendPostRequestAsync<T>() { throw new ProviderSignInError(); },
};

function microsoft(config: Extract<ProviderSignInConfig, { id: "microsoft" }>): ProviderAdapter {
  const tenant = config.tenant ?? "common";
  const base = `https://login.microsoftonline.com/${tenant}`;
  const verifier = new IdentityTokenVerifier();
  return safeAdapter(config.id, "Microsoft", "query", async (transaction) => {
    validateTransaction(transaction);
    const app = new ConfidentialClientApplication({
      auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: base },
      system: { networkClient: microsoftNetwork, disableInternalRetries: true, loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
    });
    try {
      const generated = new URL(await app.getAuthCodeUrl({
        scopes: [...IDENTITY_SCOPES], redirectUri: config.redirectUri, state: transaction.state,
        nonce: transaction.nonce, codeChallenge: challenge(transaction), codeChallengeMethod: "S256", prompt: "select_account",
      }));
      if (generated.origin !== "https://login.microsoftonline.com" || generated.pathname !== `/${tenant}/oauth2/v2.0/authorize`) throw new ProviderSignInError();
      // MSAL's default OIDC scopes include offline_access. This feature requests identity only.
      generated.searchParams.set("scope", IDENTITY_SCOPES.join(" "));
      return generated.toString();
    } finally {
      app.clearCache();
    }
  }, async ({ callbackUrl, transaction }) => {
    const body = tokenBody(config, callbackCode(config, callbackUrl, transaction), transaction, true);
    body.set("client_secret", config.clientSecret);
    body.set("scope", IDENTITY_SCOPES.join(" "));
    const tokens = await postForm(`${base}/oauth2/v2.0/token`, body);
    const idToken = requiredString(tokens.id_token, 32_768);
    // The untrusted tenant only selects a fixed Microsoft path; identity is accepted after verification.
    const tokenTenant = requiredString(decodeJwt(idToken).tid, 36);
    if (!TENANT_UUID.test(tokenTenant) || (TENANT_UUID.test(tenant) && tokenTenant !== tenant) || (tenant === "organizations" && tokenTenant === MICROSOFT_CONSUMER_TENANT) || (tenant === "consumers" && tokenTenant !== MICROSOFT_CONSUMER_TENANT)) throw new ProviderSignInError();
    const issuer = `https://login.microsoftonline.com/${tokenTenant}/v2.0`;
    const payload = await verifier.verify({ idToken, issuer, clientId: config.clientId, nonce: transaction.nonce, jwksUrl: `https://login.microsoftonline.com/${tokenTenant}/discovery/v2.0/keys`, microsoftTenant: tokenTenant });
    // Microsoft expressly does not guarantee the email claim is correct.
    return identity(config, issuer, payload, false);
  });
}

function apple(config: Extract<ProviderSignInConfig, { id: "apple" }>): ProviderAdapter {
  const verifier = new IdentityTokenVerifier();
  return safeAdapter(config.id, "Apple", "form_post", async (transaction) => authorization(`${APPLE_ISSUER}/auth/authorize`, config, transaction, ["name", "email"], false, { nonce: transaction.nonce, response_mode: "form_post" }), async ({ callbackUrl, transaction }) => {
    const code = callbackCode(config, callbackUrl, transaction);
    const key = await importPKCS8(config.privateKeyPem, "ES256");
    const secret = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: config.keyId }).setIssuer(config.teamId).setAudience(APPLE_ISSUER).setSubject(config.clientId).setIssuedAt().setExpirationTime("5m").sign(key);
    const body = tokenBody(config, code, transaction, false);
    body.set("client_secret", secret);
    const tokens = await postForm(`${APPLE_ISSUER}/auth/token`, body);
    const payload = await verifier.verify({ idToken: requiredString(tokens.id_token, 32_768), issuer: APPLE_ISSUER, clientId: config.clientId, nonce: transaction.nonce, jwksUrl: `${APPLE_ISSUER}/auth/keys` });
    const result = identity(config, APPLE_ISSUER, payload, payload.email_verified === true || payload.email_verified === "true");
    // Apple sends the user/name object only on the first authorization. It is display data.
    const user = callbackUrl.searchParams.get("user");
    if (user && callbackUrl.searchParams.getAll("user").length === 1 && user.length <= 4096) {
      try {
        const name = object(object(JSON.parse(user)).name);
        result.displayName = optionalString([optionalString(name.firstName, 128), optionalString(name.lastName, 128)].filter(Boolean).join(" "));
      } catch { /* Missing or malformed optional profile data does not change a verified identity. */ }
    }
    return result;
  });
}

function github(config: Extract<ProviderSignInConfig, { id: "github" }>): ProviderAdapter {
  return safeAdapter(config.id, "GitHub", "query", async (transaction) => authorization("https://github.com/login/oauth/authorize", config, transaction, ["user:email"], true), async ({ callbackUrl, transaction }) => {
    const body = tokenBody(config, callbackCode(config, callbackUrl, transaction), transaction, true);
    body.set("client_secret", config.clientSecret);
    const tokens = await postForm("https://github.com/login/oauth/access_token", body);
    const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${requiredString(tokens.access_token)}`, "user-agent": "vector-mosaic-provider-sign-in", "x-github-api-version": "2022-11-28" };
    const profile = object((await requestJson("https://api.github.com/user", { headers })).body);
    if (typeof profile.id !== "number" || !Number.isSafeInteger(profile.id) || profile.id <= 0) throw new ProviderSignInError();
    // A user can withhold the optional email scope. Their verified profile identity remains usable.
    const emailResult = await requestJson("https://api.github.com/user/emails", { headers }, [403]);
    const addresses = emailResult.status === 403 ? [] : emailResult.body;
    if (!Array.isArray(addresses) || addresses.length > 100) throw new ProviderSignInError();
    const verified = addresses.map((entry) => object(entry)).find((entry) => entry.primary === true && entry.verified === true && contactEmail(entry.email));
    const email = contactEmail(verified?.email) ?? contactEmail(profile.email);
    return { provider: config.id, issuer: "https://api.github.com", clientId: config.clientId, subject: String(profile.id), email, emailVerified: verified !== undefined && email !== null, displayName: optionalString(profile.name) ?? optionalString(profile.login) };
  });
}

function facebook(config: Extract<ProviderSignInConfig, { id: "facebook" }>): ProviderAdapter {
  const graph = `https://graph.facebook.com/${config.graphApiVersion}`;
  return safeAdapter(config.id, "Facebook", "query", async (transaction) => authorization(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`, config, transaction, ["public_profile", "email"], false, { scope: "public_profile,email" }), async ({ callbackUrl, transaction }) => {
    const body = tokenBody(config, callbackCode(config, callbackUrl, transaction), transaction, false);
    body.set("client_secret", config.clientSecret);
    const tokens = await postForm(`${graph}/oauth/access_token`, body);
    const accessToken = requiredString(tokens.access_token);
    const profileUrl = new URL(`${graph}/me`);
    profileUrl.search = new URLSearchParams({ fields: "id,name,email", appsecret_proof: createHmac("sha256", config.clientSecret).update(accessToken).digest("hex") }).toString();
    const profile = object((await requestJson(profileUrl.toString(), { headers: { accept: "application/json", authorization: `Bearer ${accessToken}` } })).body);
    const subject = requiredString(profile.id, 64);
    if (!/^[0-9]+$/u.test(subject)) throw new ProviderSignInError();
    return { provider: config.id, issuer: "https://graph.facebook.com", clientId: config.clientId, subject, email: contactEmail(profile.email), emailVerified: false, displayName: optionalString(profile.name) };
  });
}

function chatgpt(config: Extract<ProviderSignInConfig, { id: "chatgpt" }>): ProviderAdapter {
  const verifier = new IdentityTokenVerifier();
  let discovery: { authorization: string; token: string; jwks: string; expiresAt: number } | undefined;
  async function endpoints() {
    if (discovery && discovery.expiresAt > Date.now()) return discovery;
    const data = object((await requestJson(`${OPENAI_ISSUER}/.well-known/openid-configuration`)).body);
    if (data.issuer !== OPENAI_ISSUER || !Array.isArray(data.token_endpoint_auth_methods_supported) || !data.token_endpoint_auth_methods_supported.includes(config.tokenEndpointAuthMethod) || !Array.isArray(data.id_token_signing_alg_values_supported) || !data.id_token_signing_alg_values_supported.includes("RS256")) throw new ProviderSignInError();
    const endpoint = (value: unknown) => {
      const url = new URL(requiredString(value, 2048));
      if (url.origin !== OPENAI_ISSUER || url.username || url.password || url.search || url.hash) throw new ProviderSignInError();
      return url.toString();
    };
    discovery = { authorization: endpoint(data.authorization_endpoint), token: endpoint(data.token_endpoint), jwks: endpoint(data.jwks_uri), expiresAt: Date.now() + 5 * 60_000 };
    return discovery;
  }
  return safeAdapter(config.id, "ChatGPT", "query", async (transaction) => authorization((await endpoints()).authorization, config, transaction, IDENTITY_SCOPES, true, { nonce: transaction.nonce }), async ({ callbackUrl, transaction }) => {
    const code = callbackCode(config, callbackUrl, transaction);
    const current = await endpoints();
    const body = tokenBody(config, code, transaction, true);
    const headers: Record<string, string> = {};
    if (config.tokenEndpointAuthMethod === "client_secret_basic") {
      const encode = (value: string) => new URLSearchParams({ value }).toString().slice("value=".length);
      headers.authorization = `Basic ${Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`, "utf8").toString("base64")}`;
    }
    const tokens = await postForm(current.token, body, headers);
    const payload = await verifier.verify({ idToken: requiredString(tokens.id_token, 32_768), issuer: OPENAI_ISSUER, clientId: config.clientId, nonce: transaction.nonce, jwksUrl: current.jwks });
    return identity(config, OPENAI_ISSUER, payload, payload.email_verified === true);
  });
}

/** Construction is offline. Only the consumer's explicit configurations become adapters. */
export function createProviderAdapters(configs: ProviderSignInConfig[]): ProviderAdapter[] {
  try {
    if (!Array.isArray(configs) || configs.length > 6) throw new ProviderSignInError("invalid_configuration");
    const seen = new Set<ProviderId>();
    return configs.map((provided) => {
      const config = { ...provided } as ProviderSignInConfig;
      validateConfig(config);
      if (seen.has(config.id)) throw new ProviderSignInError("invalid_configuration");
      seen.add(config.id);
      switch (config.id) {
        case "google": return google(config);
        case "microsoft": return microsoft(config);
        case "apple": return apple(config);
        case "facebook": return facebook(config);
        case "github": return github(config);
        case "chatgpt": return chatgpt(config);
      }
    });
  } catch {
    throw new ProviderSignInError("invalid_configuration");
  }
}
