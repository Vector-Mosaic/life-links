import type { ProviderIdentityBinding } from "./provider-sign-in-state.js";
import { COMPETITION_OWNER_ID, DEMO_OWNER_ID, DEMO_GUEST_ID } from "@life-links/core";

export function isSharedDemoAccount(ownerId: string): boolean {
  return [DEMO_OWNER_ID, DEMO_GUEST_ID, COMPETITION_OWNER_ID].includes(ownerId);
}

/** Server-only authenticated ciphertext, never a public identity property. */
export type ProviderRevocationCustody = { encryptedPayload: string };
export type ProviderRevocationCleanup = ProviderRevocationCustody & {
  id: string;
  identity: ProviderIdentityBinding;
  createdAt: string;
};
export type AccountDeletionInput = { ownerId: string; sessionTokenHash: string };
export type AccountDeletionResult = {
  appleRevocation: "not_required" | "pending" | "manual_required";
  /** Private cleanup correlations returned only to the lifecycle handler. */
  revocationCleanupIds: string[];
};
export class AccountDeletionError extends Error {
  constructor(readonly code: "authentication_required" | "account_deletion_pending" | "account_deletion_unavailable",
    readonly reason: "session_required" | "calendar_cleanup_pending" | "calendar_write_in_progress" | "shared_demo_account") {
    super(code);
    this.name = "AccountDeletionError";
  }
}
export function assertProviderRevocationCustody(value: ProviderRevocationCustody): void {
  if (!value || typeof value.encryptedPayload !== "string" || value.encryptedPayload.length < 1
      || value.encryptedPayload.length > 65_536) throw new Error("invalid_provider_revocation_custody");
}
