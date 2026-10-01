import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { createProviderAdapters, createProviderTransaction, ProviderSignInError, type ProviderSignInConfig, type ProviderTransaction } from "../src/index.js";

const sdk = vi.hoisted(() => ({
  googleUrl: vi.fn(), googleVerify: vi.fn(), msalUrl: vi.fn(), msalClear: vi.fn(), msalConfigurations: [] as unknown[],
}));

vi.mock("google-auth-library", () => ({
  CodeChallengeMethod: { S256: "S256" },
  OAuth2Client: class {
    generateAuthUrl(input: unknown) { return sdk.googleUrl(input); }
    verifySignedJwtWithCertsAsync(...args: unknown[]) { return sdk.googleVerify(...args); }
  },
}));

vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class {
    constructor(private config: { auth: { authority: string } }) { sdk.msalConfigurations.push(config); }
    getAuthCodeUrl(input: unknown) { return sdk.msalUrl(this.config.auth.authority, input); }
    clearCache() { sdk.msalClear(); }
  },
}));

const callback = "https://product.example/api/auth/provider/callback";
const tenant = "11111111-2222-3333-4444-555555555555";
const microsoftIssuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const discovery = {
  issuer: "https://auth.openai.com",
  authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
  jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
  token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
  id_token_signing_alg_values_supported: ["RS256"],
};

let signingKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let appleKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let applePrivateKey: string;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
const fetchMock = vi.fn<typeof fetch>();

function config(id: ProviderSignInConfig["id"]): ProviderSignInConfig {
  const common = { id, clientId: "test-client", redirectUri: callback };
  switch (id) {
    case "google": return { ...common, id, clientSecret: "test-secret" };
    case "microsoft": return { ...common, id, clientSecret: "test-secret" };
    case "apple": return { ...common, id, teamId: "TEAM123456", keyId: "KEY1234567", privateKeyPem: applePrivateKey };
    case "facebook": return { ...common, id, clientId: "123456", clientSecret: "test-secret", graphApiVersion: "v24.0" };
    case "github": return { ...common, id, clientSecret: "test-secret" };
    case "chatgpt": return { ...common, id, clientId: "oaiapp_test-client", approved: true, tokenEndpointAuthMethod: "none" };
  }
}

function callbackUrl(transaction: ProviderTransaction): URL {
  const url = new URL(callback);
  url.search = new URLSearchParams({ state: transaction.state, code: "single-use-code" }).toString();
  return url;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function queue(...responses: Response[]): void {
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
}

async function token(issuer: string, clientId: string, transaction: ProviderTransaction, overrides: JWTPayload = {}, key = signingKeys.privateKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: clientId, sub: "provider-subject", iat: now, exp: now + 300, nonce: transaction.nonce, email: "person@example.com", email_verified: true, name: "Person", ...overrides }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key);
}

beforeAll(async () => {
  signingKeys = await generateKeyPair("RS256", { extractable: true });
  appleKeys = await generateKeyPair("ES256", { extractable: true });
  applePrivateKey = await exportPKCS8(appleKeys.privateKey);
  publicJwk = { ...(await exportJWK(signingKeys.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sdk.googleUrl.mockReset(); sdk.googleVerify.mockReset(); sdk.msalUrl.mockReset(); sdk.msalClear.mockReset(); sdk.msalConfigurations.length = 0;
  sdk.googleUrl.mockImplementation((input: Record<string, unknown>) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries(input)) url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : String(value));
    return url.toString();
  });
  sdk.msalUrl.mockImplementation((authority: string, input: { scopes: string[]; state: string; nonce: string; codeChallenge: string }) => {
    const url = new URL(`${authority}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ scope: [...input.scopes, "offline_access"].join(" "), state: input.state, nonce: input.nonce, code_challenge: input.codeChallenge }).toString();
    return Promise.resolve(url.toString());
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("configured adapters and transactions", () => {
  it("constructs only explicitly configured adapters, offline, and creates fresh transaction secrets", () => {
    const adapters = createProviderAdapters([config("google"), config("microsoft"), config("apple"), config("facebook"), config("github"), config("chatgpt")]);
    expect(adapters.map((adapter) => adapter.id)).toEqual(["google", "microsoft", "apple", "facebook", "github", "chatgpt"]);
    expect(adapters.find((adapter) => adapter.id === "apple")?.responseMode).toBe("form_post");
    expect(fetchMock).not.toHaveBeenCalled();
    const a = createProviderTransaction(); const b = createProviderTransaction();
    expect(new Set([a.state, a.nonce, a.codeVerifier, b.state, b.nonce, b.codeVerifier]).size).toBe(6);
    expect(Object.values(a).every((value) => /^[A-Za-z0-9_-]{43}$/u.test(value))).toBe(true);
  });

  it("rejects duplicate providers, unsafe callbacks, invented Microsoft authorities and unapproved ChatGPT clients", () => {
    const invalid = [
      [config("google"), config("google")],
      [{ ...config("google"), redirectUri: "http://product.example/callback" }],
      [{ ...config("google"), redirectUri: `${callback}?secret=credential` }],
      [{ ...config("microsoft"), tenant: "attacker.example" }],
      [{ ...config("chatgpt"), approved: false }],
      [{ ...config("chatgpt"), tokenEndpointAuthMethod: "none", clientSecret: "credential" }],
    ];
    for (const value of invalid) expect(() => createProviderAdapters(value as ProviderSignInConfig[])).toThrow("Provider sign-in is not configured correctly.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["google", "microsoft", "apple", "facebook", "github", "chatgpt"] as const)("rejects callback forgery and parameter pollution before %s provider requests", async (id) => {
    const [adapter] = createProviderAdapters([config(id)]);
    const transaction = createProviderTransaction();
    const wrongState = callbackUrl(transaction); wrongState.searchParams.set("state", "a".repeat(43));
    const wrongPath = callbackUrl(transaction); wrongPath.pathname = "/attacker-callback";
    const duplicate = callbackUrl(transaction); duplicate.searchParams.append("state", transaction.state);
    const denied = callbackUrl(transaction); denied.searchParams.set("error", "access_denied");
    for (const url of [wrongState, wrongPath, duplicate, denied]) await expect(adapter.redeem({ callbackUrl: url, transaction })).rejects.toBeInstanceOf(ProviderSignInError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses identity-only scopes and preserves each provider's actual PKCE/callback support", async () => {
    for (const id of ["google", "microsoft", "apple", "facebook", "github", "chatgpt"] as const) {
      const [adapter] = createProviderAdapters([config(id)]);
      if (id === "chatgpt") queue(json(discovery));
      const transaction = createProviderTransaction();
      const url = new URL(await adapter.authorizationUrl(transaction));
      expect(url.searchParams.get("state")).toBe(transaction.state);
      expect(url.searchParams.get("scope")).not.toContain("offline_access");
      expect(url.searchParams.get("scope")).not.toContain("calendar");
      expect(url.searchParams.has("code_challenge")).toBe(!["apple", "facebook"].includes(id));
      if (!["facebook", "github"].includes(id)) expect(url.searchParams.get("nonce")).toBe(transaction.nonce);
      if (id === "apple") expect(url.searchParams.get("response_mode")).toBe("form_post");
      if (id === "facebook") expect(url.searchParams.get("scope")).toBe("public_profile,email");
    }
    expect(sdk.msalClear).toHaveBeenCalledOnce();
  });
});

describe("signed identity verification", () => {
  it.each([
    ["issuer", { iss: "https://attacker.example" }],
    ["audience", { aud: "another-client" }],
    ["nonce", { nonce: "another-transaction" }],
    ["expiration", { exp: 1 }],
    ["future issuance", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["authorized presenter", { azp: "another-client" }],
  ])("rejects a correctly signed ChatGPT token with the wrong %s", async (_name, overrides) => {
    const current = config("chatgpt");
    const [adapter] = createProviderAdapters([current]);
    const transaction = createProviderTransaction();
    queue(json(discovery), json({ id_token: await token(discovery.issuer, current.clientId, transaction, overrides as JWTPayload) }), json({ keys: [publicJwk] }));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow("Provider sign-in could not be verified.");
  });

  it("rejects an ID token signed with an unrelated key", async () => {
    const anotherKey = await generateKeyPair("RS256");
    const current = config("chatgpt"); const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    queue(json(discovery), json({ id_token: await token(discovery.issuer, current.clientId, transaction, {}, anotherKey.privateKey) }), json({ keys: [publicJwk] }));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow();
  });

  it("accepts an identity-only ChatGPT response without an access/refresh token and honors public/basic client auth", async () => {
    for (const method of ["none", "client_secret_basic"] as const) {
      fetchMock.mockReset();
      const current: ProviderSignInConfig = method === "none" ? config("chatgpt") : { id: "chatgpt", clientId: "oaiapp_test-client", redirectUri: callback, approved: true, tokenEndpointAuthMethod: method, clientSecret: "secret with: punctuation" };
      const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
      queue(json(discovery), json({ id_token: await token(discovery.issuer, current.clientId, transaction) }), json({ keys: [publicJwk] }));
      const result = await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction });
      expect(result).toEqual({ provider: "chatgpt", issuer: discovery.issuer, clientId: current.clientId, subject: "provider-subject", email: "person@example.com", emailVerified: true, displayName: "Person" });
      const request = fetchMock.mock.calls[1][1]!;
      const body = new URLSearchParams(String(request.body));
      expect(body.get("code_verifier")).toBe(transaction.codeVerifier);
      expect(body.has("client_secret")).toBe(false);
      expect(new Headers(request.headers).has("authorization")).toBe(method === "client_secret_basic");
      expect(Object.keys(result)).not.toContain("id_token");
    }
  });

  it("checks Microsoft signature and key issuer, preserves the exact tenant identity, and does not mark email verified", async () => {
    const current = config("microsoft"); const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    queue(json({ id_token: await token(microsoftIssuer, current.clientId, transaction, { tid: tenant }) }), json({ keys: [{ ...publicJwk, issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" }] }));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toMatchObject({ provider: "microsoft", issuer: microsoftIssuer, subject: "provider-subject", emailVerified: false });
    expect(fetchMock.mock.calls[1][0]).toBe(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`);
  });

  it("rejects a Microsoft token from a tenant outside the configured audience before key lookup", async () => {
    const current: ProviderSignInConfig = { id: "microsoft", clientId: "test-client", redirectUri: callback, clientSecret: "test-secret", tenant: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
    const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    queue(json({ id_token: await token(microsoftIssuer, current.clientId, transaction, { tid: tenant }) }));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects Microsoft JWKS keys issued for another tenant", async () => {
    const current = config("microsoft"); const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    const keys = { keys: [{ ...publicJwk, issuer: "https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0" }] };
    queue(json({ id_token: await token(microsoftIssuer, current.clientId, transaction, { tid: tenant }) }), json(keys), json(keys));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow();
  });

  it("signs the Apple client secret, verifies Apple identity, and ignores a conflicting profile email", async () => {
    const current = config("apple"); const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    const url = callbackUrl(transaction); url.searchParams.set("user", JSON.stringify({ name: { firstName: "Private", lastName: "Person" }, email: "attacker@example.com" }));
    queue(json({ id_token: await token("https://appleid.apple.com", current.clientId, transaction, { email: "relay@privaterelay.appleid.com", email_verified: "true" }) }), json({ keys: [publicJwk] }));
    expect(await adapter.redeem({ callbackUrl: url, transaction })).toMatchObject({ email: "relay@privaterelay.appleid.com", emailVerified: true, displayName: "Private Person" });
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.has("code_verifier")).toBe(false);
    const verified = await jwtVerify(body.get("client_secret")!, appleKeys.publicKey, { issuer: "TEAM123456", audience: "https://appleid.apple.com", subject: current.clientId, algorithms: ["ES256"] });
    expect(verified.protectedHeader.kid).toBe("KEY1234567");
    expect(verified.payload.exp! - verified.payload.iat!).toBe(300);
  });

  it("requires the Google SDK's verified nonce and preserves its signature-validation inputs", async () => {
    const current = config("google"); const [adapter] = createProviderAdapters([current]); const transaction = createProviderTransaction();
    const payload = { iss: "https://accounts.google.com", aud: current.clientId, sub: "google-subject", exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), nonce: transaction.nonce, email: "person@example.com", email_verified: true };
    sdk.googleVerify.mockResolvedValue({ getPayload: () => payload });
    queue(json({ id_token: "sdk-verified-id-token" }), json({ "test-key": "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----\n" }));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toMatchObject({ subject: "google-subject", emailVerified: true });
    expect(sdk.googleVerify).toHaveBeenCalledWith("sdk-verified-id-token", expect.any(Object), current.clientId, ["https://accounts.google.com", "accounts.google.com"]);
    sdk.googleVerify.mockResolvedValue({ getPayload: () => ({ ...payload, nonce: "wrong-nonce" }) });
    queue(json({ id_token: "sdk-verified-id-token" }), json({ "test-key": "-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----\n" }));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow();
  });
});

describe("OAuth profile identities and safe failures", () => {
  it("retrieves GitHub identity on each exchange and uses a verified private primary email", async () => {
    const [adapter] = createProviderAdapters([config("github")]); const transaction = createProviderTransaction();
    queue(json({ access_token: "temporary-provider-token", refresh_token: "ignored-token" }), json({ id: 12345, login: "person", email: null }), json([{ email: "private@example.com", primary: true, verified: true }]));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toEqual({ provider: "github", issuer: "https://api.github.com", clientId: "test-client", subject: "12345", email: "private@example.com", emailVerified: true, displayName: "person" });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/login/oauth/access_token", "/user", "/user/emails"]);
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body)).get("code_verifier")).toBe(transaction.codeVerifier);
    expect(new Headers(fetchMock.mock.calls[1][1]!.headers).get("authorization")).toBe("Bearer temporary-provider-token");
  });

  it("does not promote an unverified GitHub contact email", async () => {
    const [adapter] = createProviderAdapters([config("github")]); const transaction = createProviderTransaction();
    queue(json({ access_token: "temporary-token" }), json({ id: 12345, email: "unverified@example.com" }), json([{ email: "unverified@example.com", primary: true, verified: false }]));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toMatchObject({ email: "unverified@example.com", emailVerified: false });
  });

  it("keeps a verified GitHub identity usable when the optional email scope is withheld", async () => {
    const [adapter] = createProviderAdapters([config("github")]); const transaction = createProviderTransaction();
    queue(json({ access_token: "temporary-token" }), json({ id: 12345, email: null }), json({ message: "Resource not accessible" }, 403));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toMatchObject({ subject: "12345", email: null, emailVerified: false });
  });

  it("supports Facebook without email, a guessed OIDC token, or unsupported PKCE", async () => {
    const [adapter] = createProviderAdapters([config("facebook")]); const transaction = createProviderTransaction();
    queue(json({ access_token: "temporary-token" }), json({ id: "987654", name: "Facebook Person" }));
    expect(await adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).toEqual({ provider: "facebook", issuer: "https://graph.facebook.com", clientId: "123456", subject: "987654", email: null, emailVerified: false, displayName: "Facebook Person" });
    expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body)).has("code_verifier")).toBe(false);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("access_token")).toBe(false);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("sanitizes provider errors, never retries redemption, and rejects oversized responses", async () => {
    const [adapter] = createProviderAdapters([config("github")]); const transaction = createProviderTransaction();
    queue(json({ error: "test-secret leaked temporary-provider-token" }, 400));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow("Provider sign-in could not be verified.");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
    fetchMock.mockReset();
    queue(json({ access_token: "x".repeat(150_000) }));
    await expect(adapter.redeem({ callbackUrl: callbackUrl(transaction), transaction })).rejects.toThrow("Provider sign-in could not be verified.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects discovery that attempts to move ChatGPT token exchange off the trusted origin", async () => {
    const [adapter] = createProviderAdapters([config("chatgpt")]); const transaction = createProviderTransaction();
    queue(json({ ...discovery, token_endpoint: "https://attacker.example/token" }));
    await expect(adapter.authorizationUrl(transaction)).rejects.toThrow("Provider sign-in could not be verified.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
