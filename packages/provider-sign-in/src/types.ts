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

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly responseMode: "query" | "form_post";
  authorizationUrl(transaction: ProviderTransaction): Promise<string>;
  redeem(input: { callbackUrl: URL; transaction: ProviderTransaction }): Promise<VerifiedProviderIdentity>;
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
  readonly code: "invalid_configuration" | "sign_in_failed";

  constructor(code: "invalid_configuration" | "sign_in_failed" = "sign_in_failed") {
    super(code === "invalid_configuration" ? "Provider sign-in is not configured correctly." : "Provider sign-in could not be verified.");
    this.name = "ProviderSignInError";
    this.code = code;
  }
}
