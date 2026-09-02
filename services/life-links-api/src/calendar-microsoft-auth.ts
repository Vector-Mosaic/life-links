import { ConfidentialClientApplication, LogLevel } from "@azure/msal-node";

export const MICROSOFT_CALENDAR_SCOPES = ["https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Calendars.ReadWrite"];
export type MicrosoftCalendarAuthConfig = {
  clientId: string;
  redirectUri: string;
  certificateThumbprint: string;
  certificatePrivateKey: string;
};
export type MicrosoftCalendarTokenState = {
  cache: string;
  homeAccountId: string;
  localAccountId: string;
  providerAccountId: string;
  tenantId: string;
};
export interface MicrosoftCalendarAuth {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string>;
  redeem(input: { code: string; nonce: string; codeVerifier: string }): Promise<MicrosoftCalendarTokenState>;
  refresh(state: MicrosoftCalendarTokenState): Promise<{ state: MicrosoftCalendarTokenState; accessToken: string; renewedAccessToken?: true }>;
}

/** MSAL owns the Microsoft protocol. The caller owns encrypted, partitioned cache storage. */
export class MsalMicrosoftCalendarAuth implements MicrosoftCalendarAuth {
  constructor(private readonly config: MicrosoftCalendarAuthConfig) {}
  #client(cache?: string, onRefreshExchange?: () => void) {
    const client = new ConfidentialClientApplication({
      auth: {
        clientId: this.config.clientId,
        authority: "https://login.microsoftonline.com/common",
        clientCertificate: {
          thumbprintSha256: this.config.certificateThumbprint,
          privateKey: this.config.certificatePrivateKey
        }
      },
      system: {
        loggerOptions: { loggerCallback: () => undefined, piiLoggingEnabled: false, logLevel: LogLevel.Error },
        networkClient: {
          sendGetRequestAsync: async <T>(url: string, options?: { headers?: Record<string, string> }) =>
            microsoftTokenRequest<T>(url, { method: "GET", headers: options?.headers }),
          sendPostRequestAsync: async <T>(url: string, options?: { headers?: Record<string, string>; body?: string }) => {
            const response = await microsoftTokenRequest<T>(url, { method: "POST", headers: options?.headers, body: options?.body });
            // Observe only this acquisition's existing refresh exchange. Never
            // export the request/response, and never affect authentication.
            try {
              const body = response.body as { access_token?: unknown; error?: unknown } | null;
              if (onRefreshExchange && new URLSearchParams(options?.body).get("grant_type") === "refresh_token"
                  && response.status >= 200 && response.status < 300 && body && typeof body === "object"
                  && !("error" in body) && typeof body.access_token === "string" && body.access_token) onRefreshExchange();
            } catch { /* Passive observation cannot fail an otherwise valid acquisition. */ }
            return response;
          }
        }
      }
    });
    if (cache) client.getTokenCache().deserialize(cache);
    return client;
  }
  async authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    return this.#client().getAuthCodeUrl({
      scopes: [...MICROSOFT_CALENDAR_SCOPES], redirectUri: this.config.redirectUri,
      state: input.state, nonce: input.nonce, prompt: "select_account",
      codeChallenge: input.codeChallenge, codeChallengeMethod: "S256",
      responseMode: "query"
    });
  }
  async redeem(input: { code: string; nonce: string; codeVerifier: string }): Promise<MicrosoftCalendarTokenState> {
    try {
      const client = this.#client();
      const result = await client.acquireTokenByCode({
        scopes: [...MICROSOFT_CALENDAR_SCOPES], code: input.code,
        redirectUri: this.config.redirectUri, codeVerifier: input.codeVerifier
      });
      if (!result?.account || !result.accessToken || (result.idTokenClaims as { nonce?: string })?.nonce !== input.nonce) throw new Error();
      const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=id", {
        headers: { Authorization: `Bearer ${result.accessToken}`, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error();
      const me = await response.json() as { id?: unknown };
      if (typeof me.id !== "string" || !me.id || me.id.length > 512 || !result.uniqueId) throw new Error();
      return { cache: client.getTokenCache().serialize(), homeAccountId: result.account.homeAccountId,
        localAccountId: result.uniqueId, providerAccountId: me.id, tenantId: result.tenantId };
    } catch { throw new Error("Microsoft calendar authorization failed."); }
  }
  async refresh(state: MicrosoftCalendarTokenState): Promise<{ state: MicrosoftCalendarTokenState; accessToken: string; renewedAccessToken?: true }> {
    try {
      let refreshExchangeObserved = false;
      const client = this.#client(state.cache, () => { refreshExchangeObserved = true; });
      const account = await client.getTokenCache().getAccountByHomeId(state.homeAccountId);
      if (!account || account.tenantId !== state.tenantId) throw new Error();
      const result = await client.acquireTokenSilent({ account, scopes: [...MICROSOFT_CALENDAR_SCOPES] });
      if (!result?.account || !result.accessToken || result.account.homeAccountId !== state.homeAccountId
        || result.uniqueId !== state.localAccountId || result.tenantId !== state.tenantId) throw new Error();
      return { accessToken: result.accessToken, state: { ...state, cache: client.getTokenCache().serialize() },
        // MSAL can proactively renew but return its old cached credential.
        // Such a result must not be called a renewed credential in use.
        ...(refreshExchangeObserved && result.fromCache === false ? { renewedAccessToken: true as const } : {}) };
    } catch { throw new Error("Microsoft calendar authorization needs reconnection."); }
  }
}

async function microsoftTokenRequest<T>(url: string, init: RequestInit): Promise<{ headers: Record<string, string>; body: T; status: number }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "login.microsoftonline.com" || parsed.username || parsed.password) {
    throw new Error("Unsupported Microsoft authorization endpoint.");
  }
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Microsoft authorization response exceeded its limit.");
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  return { headers, body: JSON.parse(text) as T, status: response.status };
}
