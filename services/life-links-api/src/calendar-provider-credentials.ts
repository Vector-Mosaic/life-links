import {
  ProviderTransientError,
  type CalendarProviderCredentialHandle,
  type CalendarProviderKey
} from "./calendar-provider-gateway.js";

/**
 * Short-lived server credential resolved from a vault handle. This value must
 * never cross the adapter boundary, enter a provider result, or be logged.
 */
export type ResolvedCalendarProviderCredential = {
  accessToken: string;
  providerAccountId: string;
  /** Call-scoped server-only observation, consumed by the first Graph 2xx. */
  renewedAccessToken?: true;
};

export type CalendarProviderCredentialResolver = {
  resolve(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerKey: CalendarProviderKey;
  }): Promise<ResolvedCalendarProviderCredential>;
};

/**
 * Revocation stays with the credential owner. Google token revocation and
 * Microsoft consent/session removal have different semantics, while the
 * adapter must not receive refresh tokens or client credentials.
 */
export type CalendarProviderCredentialRevoker = {
  revoke(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerKey: CalendarProviderKey;
    providerAccountId: string;
  }): Promise<void>;
};

export type CalendarProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export async function resolveCalendarProviderCredential(
  resolver: CalendarProviderCredentialResolver,
  input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerKey: CalendarProviderKey;
    expectedProviderAccountId?: string;
  }
): Promise<ResolvedCalendarProviderCredential> {
  let resolved: ResolvedCalendarProviderCredential;
  try {
    resolved = await resolver.resolve({
      credentialHandle: input.credentialHandle,
      providerKey: input.providerKey
    });
  } catch {
    throw new ProviderTransientError("The provider credential could not be resolved reliably.");
  }
  if (!resolved || typeof resolved.accessToken !== "string" || !resolved.accessToken || resolved.accessToken.length > 16_384 ||
      typeof resolved.providerAccountId !== "string" || !resolved.providerAccountId || resolved.providerAccountId.length > 512) {
    throw new ProviderTransientError("The provider credential resolver returned an invalid server-only credential.");
  }
  if (input.expectedProviderAccountId !== undefined && resolved.providerAccountId !== input.expectedProviderAccountId) {
    throw new ProviderTransientError("The provider credential no longer matches the bound account identity.");
  }
  return { accessToken: resolved.accessToken, providerAccountId: resolved.providerAccountId,
    ...(resolved.renewedAccessToken === true ? { renewedAccessToken: true as const } : {}) };
}

export function bearerHeaders(accessToken: string, additional: Record<string, string> = {}): Headers {
  const headers = new Headers(additional);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  return headers;
}
