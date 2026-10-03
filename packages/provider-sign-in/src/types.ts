export type ProviderId = "google" | "microsoft" | "apple" | "facebook" | "github" | "chatgpt";

export interface VerifiedProviderIdentity {
  provider: ProviderId;
  issuer: string;
  clientId: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export interface ProviderTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** Restricted server-only material for the exact verified Apple identity. */
export interface ProviderRevocationCredential {
  provider: "apple";
  issuer: string;
  clientId: string;
  subject: string;
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
}

/** The identity remains token-free; consumers own protected credential retention. */
export interface ProviderRedemption {
  identity: VerifiedProviderIdentity;
  revocationCredential: ProviderRevocationCredential | null;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly responseMode: "query" | "form_post";
  authorizationUrl(transaction: ProviderTransaction): Promise<string>;
  redeem(input: { callbackUrl: URL; transaction: ProviderTransaction }): Promise<VerifiedProviderIdentity>;
  /** Choose this OR redeem once for a callback, never both. Present on Apple. */
  redeemWithCustody?(input: { callbackUrl: URL; transaction: ProviderTransaction }): Promise<ProviderRedemption>;
  /** Consumer-authorized app-access revocation, not provider account deletion. */
  revoke?(credential: ProviderRevocationCredential): Promise<void>;
}

interface CommonConfig {
  id: ProviderId;
  clientId: string;
  /** An exact registered HTTPS callback, with no credentials, query or fragment. */
  redirectUri: string;
}

export type ProviderSignInConfig =
  | (CommonConfig & { id: "google"; clientSecret: string })
  | (CommonConfig & {
      id: "microsoft";
      clientSecret: string;
      /** Public-cloud audience or exact tenant UUID. Defaults to common. */
      tenant?: "common" | "organizations" | "consumers" | string;
    })
  | (CommonConfig & { id: "apple"; teamId: string; keyId: string; privateKeyPem: string })
  | (CommonConfig & { id: "facebook"; clientSecret: string; graphApiVersion: string })
  | (CommonConfig & { id: "github"; clientSecret: string })
  | (CommonConfig & {
      id: "chatgpt";
      /** A declaration that this exact registered identity client was approved. */
      approved: true;
      tokenEndpointAuthMethod: "none";
    })
  | (CommonConfig & {
      id: "chatgpt";
      approved: true;
      tokenEndpointAuthMethod: "client_secret_basic";
      clientSecret: string;
    });

export class ProviderSignInError extends Error {
  readonly code: "invalid_configuration" | "sign_in_failed" | "revocation_failed";

  constructor(code: "invalid_configuration" | "sign_in_failed" | "revocation_failed" = "sign_in_failed") {
    super(code === "invalid_configuration" ? "Provider sign-in is not configured correctly." : code === "revocation_failed" ? "Provider authorization could not be revoked." : "Provider sign-in could not be verified.");
    this.name = "ProviderSignInError";
    this.code = code;
  }
}
