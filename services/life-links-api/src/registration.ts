import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createCanonicalCalendar, normalizeCalendarIanaTimeZone } from "@life-links/core";
import type { StoredUser } from "./store.js";
import type { VerifiedProviderIdentity } from "./provider-sign-in-state.js";

/** Admission only: neither this fingerprint nor the invitation authenticates an existing owner. */
export type RegistrationInvitation = {
  fingerprint: string;
  maxAccounts: number;
  expiresAt: string;
  memberInvitationId?: string;
};
export type MemberInvitation = {
  id: string;
  ownerId: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  redeemedAt: string | null;
};
export type MemberInvitationView = Omit<MemberInvitation, "ownerId" | "fingerprint">;
export const MAX_PENDING_INVITATIONS = 10;

export function prepareMemberInvitation(ownerId: string) {
  const code = randomBytes(32).toString("base64url");
  const invitation: MemberInvitation = { id: randomUUID(), ownerId, fingerprint: invitationFingerprint(code),
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    revokedAt: null, redeemedAt: null };
  return { code, invitation };
}

export function memberInvitationActive(invitation: MemberInvitation): boolean {
  return !invitation.revokedAt && !invitation.redeemedAt && Date.parse(invitation.expiresAt) > Date.now();
}

export function memberInvitationView(invitation: MemberInvitation): MemberInvitationView {
  const { id, createdAt, expiresAt, revokedAt, redeemedAt } = invitation;
  return { id, createdAt, expiresAt, revokedAt, redeemedAt };
}

export function memberRegistrationInvitation(invitation: MemberInvitation): RegistrationInvitation {
  return { memberInvitationId: invitation.id, fingerprint: invitation.fingerprint, maxAccounts: 1, expiresAt: invitation.expiresAt };
}
export type RegisterOwnerInput = {
  displayName: string;
  email: string;
  passwordHash: string;
  timeZone: string;
  invitation: RegistrationInvitation;
};
export type RegisterProviderOwnerInput = Omit<RegisterOwnerInput, "passwordHash"> & {
  identity: VerifiedProviderIdentity;
};
type PrepareRegisteredOwnerInput = Omit<RegisterOwnerInput, "passwordHash"> & { passwordHash: string | null };
export class RegistrationAdmissionError extends Error {
  constructor(readonly code: "registration_unavailable" | "registration_failed") {
    super(code);
    this.name = "RegistrationAdmissionError";
  }
}

export function invitationFingerprint(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function matchesRegistrationInvitation(code: string, invitation: RegistrationInvitation): boolean {
  return timingSafeEqual(Buffer.from(invitationFingerprint(code), "hex"), Buffer.from(invitation.fingerprint, "hex"));
}

export function validInvitationCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function parseRegistrationRequest(value: unknown): {
  displayName: string; email: string; password: string; invitationCode: string; timeZone: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["displayName", "email", "password", "invitationCode", "timeZone"].includes(key))) return null;
  if (typeof input.displayName !== "string" || typeof input.email !== "string" || typeof input.password !== "string"
      || !validInvitationCode(input.invitationCode)) return null;
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  if (displayName.length < 1 || displayName.length > 100 || /[\u0000-\u001f\u007f]/.test(displayName)
      || email.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(email)
      || input.password.length < 12 || input.password.length > 128) return null;
  try {
    return { displayName, email, password: input.password, invitationCode: input.invitationCode,
      timeZone: normalizeCalendarIanaTimeZone(input.timeZone ?? "UTC") };
  } catch { return null; }
}

export function assertRegistrationInvitation(invitation: RegistrationInvitation): void {
  if (!/^[a-f0-9]{64}$/.test(invitation.fingerprint) || !Number.isInteger(invitation.maxAccounts)
      || invitation.maxAccounts < 1 || invitation.maxAccounts > 500 || !Number.isFinite(Date.parse(invitation.expiresAt))) {
    throw new RegistrationAdmissionError("registration_unavailable");
  }
}

export function prepareRegisteredOwner(input: RegisterOwnerInput) {
  return prepareOwner(input);
}

export function prepareRegisteredProviderOwner(input: RegisterProviderOwnerInput) {
  return prepareOwner({ ...input, passwordHash: null });
}

function prepareOwner(input: PrepareRegisteredOwnerInput) {
  assertRegistrationInvitation(input.invitation);
  const now = new Date().toISOString();
  const user: StoredUser = { id: randomUUID(), displayName: input.displayName, email: input.email.toLowerCase(),
    passwordHash: input.passwordHash, createdAt: now, agentConnectedAt: null, agentToolCatalogId: null };
  const calendar = createCanonicalCalendar({ id: `calendar-${randomUUID()}`, ownerId: user.id,
    title: "My Calendar", color: "#7FC9B3", timeZone: input.timeZone, isDefault: true,
    agentAccess: "none", createdAt: now });
  return { user, calendar };
}
