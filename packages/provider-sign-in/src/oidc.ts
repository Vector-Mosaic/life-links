import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { object, requestJson } from "./http.js";
import { ProviderSignInError } from "./types.js";

/** Small per-adapter public-key cache; no provider tokens or private claims are cached. */
export class IdentityTokenVerifier {
  private keys = new Map<string, { value: JSONWebKeySet; expiresAt: number }>();

  private async load(url: string, refresh: boolean): Promise<JSONWebKeySet> {
    const cached = this.keys.get(url);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;
    const value = object((await requestJson(url)).body);
    if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 32) throw new ProviderSignInError();
    const jwks = { keys: value.keys.map((key) => object(key)) } as JSONWebKeySet;
    // A multitenant product can encounter many issuers; this cache stays bounded.
    if (!this.keys.has(url) && this.keys.size >= 16) this.keys.delete(this.keys.keys().next().value!);
    this.keys.set(url, { value: jwks, expiresAt: Date.now() + 5 * 60_000 });
    return jwks;
  }

  async verify(input: { idToken: string; issuer: string; clientId: string; nonce: string; jwksUrl: string; microsoftTenant?: string }): Promise<JWTPayload> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const loaded = await this.load(input.jwksUrl, attempt === 1);
      const filtered = input.microsoftTenant ? {
        keys: loaded.keys.filter((key) => {
          const keyIssuer = (key as Record<string, unknown>).issuer;
          return typeof keyIssuer === "string" && keyIssuer.replace("{tenantid}", input.microsoftTenant!) === input.issuer;
        }),
      } : loaded;
      try {
        const { payload } = await jwtVerify(input.idToken, createLocalJWKSet(filtered), {
          issuer: input.issuer,
          audience: input.clientId,
          algorithms: ["RS256"],
          requiredClaims: ["sub", "exp", "iat", "nonce"],
          clockTolerance: 5,
        });
        if (payload.nonce !== input.nonce || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) throw new ProviderSignInError();
        if (typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5) throw new ProviderSignInError();
        if (payload.azp !== undefined && payload.azp !== input.clientId) throw new ProviderSignInError();
        return payload;
      } catch (error) {
        if (attempt === 0 && error instanceof errors.JWKSNoMatchingKey) continue;
        throw new ProviderSignInError();
      }
    }
    throw new ProviderSignInError();
  }
}
