import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createCanonicalCalendar, normalizeCalendarIanaTimeZone } from "@life-links/core";
import type { StoredUser } from "./store.js";

/** Admission only: neither this fingerprint nor the invitation authenticates an existing owner. */
export type RegistrationInvitation = {
  fingerprint: string;
  maxAccounts: number;
  expiresAt: string;
};
export type RegisterOwnerInput = {
  displayName: string;
  email: string;
  passwordHash: string;
  timeZone: string;
  invitation: RegistrationInvitation;
};
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
  assertRegistrationInvitation(input.invitation);
  const now = new Date().toISOString();
  const user: StoredUser = { id: randomUUID(), displayName: input.displayName, email: input.email.toLowerCase(),
    passwordHash: input.passwordHash, createdAt: now, agentConnectedAt: null, agentToolCatalogId: null };
  const calendar = createCanonicalCalendar({ id: `calendar-${randomUUID()}`, ownerId: user.id,
    title: "My Calendar", color: "#7FC9B3", timeZone: input.timeZone, isDefault: true,
    agentAccess: "none", createdAt: now });
  return { user, calendar };
}
