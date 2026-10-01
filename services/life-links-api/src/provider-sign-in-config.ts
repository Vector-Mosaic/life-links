import type { ProviderSignInConfig } from "@vmosaic/provider-sign-in";

/** Explicit enabled list; unused providers need neither credentials nor buttons. */
export function readProviderSignInConfig(env: NodeJS.ProcessEnv, publicOrigin: string): ProviderSignInConfig[] {
  const ids = (env.LIFE_LINKS_SIGN_IN_PROVIDERS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error("Sign-in provider configuration has duplicate providers.");
  const required = (name: string) => {
    const value = env[name];
    if (!value || value.length > 32768 || /\u0000/.test(value)) throw new Error("Sign-in provider configuration is incomplete.");
    return value;
  };
  return ids.map((id): ProviderSignInConfig => {
    if (!["google", "microsoft", "apple", "github", "facebook", "chatgpt"].includes(id)) throw new Error("Unknown sign-in provider.");
    const prefix = `LIFE_LINKS_SIGN_IN_${id.toUpperCase()}`;
    const clientId = required(`${prefix}_CLIENT_ID`);
    const redirectUri = required(`${prefix}_REDIRECT_URI`);
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        redirectUri !== `${origin.origin}/api/auth/providers/${id}/callback`) throw new Error("Sign-in callback must match the application HTTPS origin and provider.");
    const common = { clientId, redirectUri };
    if (id === "apple") return { id, ...common, teamId: required(`${prefix}_TEAM_ID`), keyId: required(`${prefix}_KEY_ID`), privateKeyPem: required(`${prefix}_PRIVATE_KEY`) };
    if (id === "chatgpt") {
      if (env[`${prefix}_APPROVED`] !== "true") throw new Error("ChatGPT sign-in requires an approved OpenAI client.");
      const method = required(`${prefix}_TOKEN_AUTH_METHOD`);
      if (method === "none") return { id, ...common, approved: true, tokenEndpointAuthMethod: "none" };
      if (method !== "client_secret_basic") throw new Error("Invalid ChatGPT token authentication method.");
      return { id, ...common, approved: true, tokenEndpointAuthMethod: "client_secret_basic", clientSecret: required(`${prefix}_CLIENT_SECRET`) };
    }
    const clientSecret = required(`${prefix}_CLIENT_SECRET`);
    if (id === "facebook") return { id, ...common, clientSecret, graphApiVersion: required(`${prefix}_GRAPH_API_VERSION`) };
    if (id === "microsoft") return { id, ...common, clientSecret, ...(env[`${prefix}_TENANT`] ? { tenant: env[`${prefix}_TENANT`] } : {}) };
    return { id: id as "google" | "github", ...common, clientSecret };
  });
}
