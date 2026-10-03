/** The provider adapter proves identity; this module owns its canonical store binding. */
export type VerifiedProviderIdentity = {
  provider: string;
  issuer: string;
  clientId: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};
export type ProviderIdentityBinding = Pick<VerifiedProviderIdentity, "provider" | "issuer" | "clientId" | "subject">;

/** The server encrypts protocol/continuation payloads before giving them to the store. */
export type ProviderSignInAttempt = {
  stateHash: string;
  browserHash: string;
  provider: string;
  encryptedPayload: string;
  expiresAt: string;
  ownerId?: string | null;
};
export const MAX_PROVIDER_SIGN_IN_ATTEMPTS = 5_000;
export const PROVIDER_SIGN_IN_EXPIRY_CLEANUP_LIMIT = 100;

export class ProviderSignInStateError extends Error {
  constructor(readonly code: "provider_identity_conflict" | "provider_sign_in_unavailable") {
    super(code);
    this.name = "ProviderSignInStateError";
  }
}

export function assertProviderIdentityBinding(identity: ProviderIdentityBinding): void {
  if (!identity || !/^[a-z][a-z0-9_-]{0,63}$/.test(identity.provider) ||
      !bounded(identity.issuer, 1_024) || !bounded(identity.clientId, 1_024) || !bounded(identity.subject, 1_024) ||
      Buffer.byteLength(identity.provider + identity.issuer + identity.clientId + identity.subject, "utf8") > 2_048) {
    throw new ProviderSignInStateError("provider_sign_in_unavailable");
  }
}

export function providerIdentityKey(identity: ProviderIdentityBinding): string {
  assertProviderIdentityBinding(identity);
  // A tuple avoids ambiguity from delimiters inside provider-issued identifiers.
  return JSON.stringify([identity.provider, identity.issuer, identity.clientId, identity.subject]);
}

export function identityBinding(identity: ProviderIdentityBinding): ProviderIdentityBinding {
  assertProviderIdentityBinding(identity);
  return { provider: identity.provider, issuer: identity.issuer, clientId: identity.clientId, subject: identity.subject };
}

export function assertProviderSignInAttempt(attempt: ProviderSignInAttempt): void {
  if (!attempt || !validSignInFingerprint(attempt.stateHash) || !validSignInFingerprint(attempt.browserHash) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(attempt.provider) || !bounded(attempt.encryptedPayload, 65_536) ||
      !Number.isFinite(Date.parse(attempt.expiresAt))) {
    throw new ProviderSignInStateError("provider_sign_in_unavailable");
  }
  if (attempt.ownerId !== undefined && attempt.ownerId !== null && !bounded(attempt.ownerId, 128)) {
    throw new ProviderSignInStateError("provider_sign_in_unavailable");
  }
}

export function validSignInFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
