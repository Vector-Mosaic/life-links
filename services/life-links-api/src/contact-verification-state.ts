import type { RegistrationInvitation } from "./registration.js";

/** The consumer encrypts contact/protocol material; the store sees only opaque bindings. */
export type ContactVerificationAttempt = {
  tokenHash: string;
  browserHash: string;
  addressHash: string;
  channel: "email" | "phone";
  intent: "register" | "login" | "link";
  phase: "send_pending" | "sent" | "send_unknown" | "send_rejected" | "verifying" | "verified" | "consumed";
  encryptedPayload: string;
  expiresAt: string;
  resendAt: string;
  version: number;
  checkCount: number;
};
export type VerificationLimit = { keyHash: string; max: number; windowMs: number; windowType?: "rolling" };
export type VerificationLimitReservation = { count: number; expiresAt: number; reservedAt: number[] };
export type VerifiedContactConsumption = { tokenHash: string; browserHash: string; expectedVersion: number };
export type PhoneBinding = {
  phoneHash: string;
  maskedNumber: string;
};
export type FinalizeVerifiedRegistrationInput = VerifiedContactConsumption & {
  displayName: string;
  email: string | null;
  passwordHash: string | null;
  timeZone: string;
  invitation?: RegistrationInvitation;
  phoneBinding?: PhoneBinding;
};
export type FinalizeVerifiedPhoneLinkInput = VerifiedContactConsumption & {
  ownerId: string;
  sessionTokenHash: string;
  phoneBinding: PhoneBinding;
};

export const MAX_CONTACT_VERIFICATION_ATTEMPTS = 5_000;
export const MAX_VERIFICATION_LIMITS = 20_000;
export const VERIFICATION_EXPIRY_CLEANUP_LIMIT = 100;
export class ContactVerificationStateError extends Error {
  constructor(readonly code: "verification_unavailable" | "invalid_verification" | "verification_rate_limited" | "authentication_required") {
    super(code);
    this.name = "ContactVerificationStateError";
  }
}
export function validContactFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function assertContactVerificationAttempt(attempt: ContactVerificationAttempt): void {
  if (!attempt || !validContactFingerprint(attempt.tokenHash) || !validContactFingerprint(attempt.browserHash)
      || !validContactFingerprint(attempt.addressHash) || !["email", "phone"].includes(attempt.channel)
      || !["register", "login", "link"].includes(attempt.intent)
      || !["send_pending", "sent", "send_unknown", "send_rejected", "verifying", "verified", "consumed"].includes(attempt.phase)
      || !bounded(attempt.encryptedPayload, 65_536) || !Number.isFinite(Date.parse(attempt.expiresAt))
      || !Number.isFinite(Date.parse(attempt.resendAt)) || !Number.isSafeInteger(attempt.version) || attempt.version < 1
      || !Number.isInteger(attempt.checkCount) || attempt.checkCount < 0 || attempt.checkCount > 5) {
    throw new ContactVerificationStateError("verification_unavailable");
  }
}
export function canUpdateContactVerificationAttempt(saved: ContactVerificationAttempt, next: ContactVerificationAttempt,
  expectedVersion: number): boolean {
  return saved.version === expectedVersion && next.version === expectedVersion + 1
    && Number.isSafeInteger(expectedVersion) && expectedVersion > 0
    && saved.phase !== "consumed" && next.phase !== "consumed" && Date.parse(saved.expiresAt) > Date.now()
    && saved.tokenHash === next.tokenHash && saved.browserHash === next.browserHash && saved.addressHash === next.addressHash
    && saved.channel === next.channel && saved.intent === next.intent && saved.expiresAt === next.expiresAt;
}
export function validVerifiedContactConsumption(input: VerifiedContactConsumption): boolean {
  return validContactFingerprint(input?.tokenHash) && validContactFingerprint(input?.browserHash)
    && Number.isSafeInteger(input.expectedVersion) && input.expectedVersion > 0;
}
export function contactAttemptMatchesConsumption(attempt: ContactVerificationAttempt | null,
  input: VerifiedContactConsumption): attempt is ContactVerificationAttempt {
  return Boolean(attempt && validVerifiedContactConsumption(input) && attempt.tokenHash === input.tokenHash
    && attempt.browserHash === input.browserHash && attempt.version === input.expectedVersion
    && attempt.phase === "verified" && Date.parse(attempt.expiresAt) > Date.now());
}
export function assertPhoneBinding(binding: PhoneBinding): void {
  // At most the last four digits may be retained for account-method display.
  if (!binding || !validContactFingerprint(binding.phoneHash)
      || typeof binding.maskedNumber !== "string" || binding.maskedNumber.length < 1 || binding.maskedNumber.length > 32
      || !/^[+*•\d ()-]+$/.test(binding.maskedNumber) || !/[*•]/.test(binding.maskedNumber)
      || (binding.maskedNumber.match(/\d/g) ?? []).length > 4) {
    throw new ContactVerificationStateError("verification_unavailable");
  }
}
export function phoneBindingKey(binding: PhoneBinding): string {
  assertPhoneBinding(binding);
  // Delivery configuration does not change the product's credential identity.
  return binding.phoneHash;
}
export function assertVerificationLimits(limits: VerificationLimit[]): void {
  if (!Array.isArray(limits) || limits.length < 1 || limits.length > 16
      || new Set(limits.map(item => item?.keyHash)).size !== limits.length
      || limits.some(item => !validContactFingerprint(item?.keyHash) || !Number.isSafeInteger(item.max)
        || item.max < 1 || item.max > 1_000_000 || !Number.isSafeInteger(item.windowMs)
        || item.windowMs < 1 || item.windowMs > 32 * 24 * 60 * 60_000
        || (item.windowType !== undefined && item.windowType !== "rolling"))) {
    throw new ContactVerificationStateError("verification_unavailable");
  }
}
/** Called under the store's reservation lock; proposals are committed only if every limit admits them. */
export function nextVerificationLimitReservation(limit: VerificationLimit,
  saved: VerificationLimitReservation | undefined, now: number): VerificationLimitReservation {
  const active = saved && saved.expiresAt > now ? saved : undefined;
  if (limit.windowType !== "rolling") {
    return { count: active ? active.count + 1 : 1, expiresAt: active?.expiresAt ?? now + limit.windowMs, reservedAt: [] };
  }
  // A fixed-window count is not evidence of individual reservation times.
  // Use a distinct key for a newly introduced rolling limit and fail closed
  // if an active row does not contain its complete reservation history.
  if (active && (active.reservedAt.length !== active.count
      || active.reservedAt.some(time => !Number.isSafeInteger(time)))) {
    throw new ContactVerificationStateError("verification_unavailable");
  }
  const reservedAt = (active?.reservedAt ?? []).filter(time => time > now - limit.windowMs);
  reservedAt.push(now);
  // Retain future reservations if the clock moved backwards; cleanup must not
  // discard them before their full window has passed.
  const expiresAt = reservedAt.reduce((latest, time) => Math.max(latest, time), now) + limit.windowMs;
  return { count: reservedAt.length, expiresAt, reservedAt };
}
export function assertVerifiedRegistrationAttempt(attempt: ContactVerificationAttempt,
  input: FinalizeVerifiedRegistrationInput): void {
  if (!contactAttemptMatchesConsumption(attempt, input) || attempt.intent === "link"
      || (attempt.channel === "email" && attempt.intent !== "register")) {
    throw new ContactVerificationStateError("invalid_verification");
  }
  if (attempt.channel === "email") {
    if (typeof input.email !== "string" || !input.email.trim() || typeof input.passwordHash !== "string"
        || !input.passwordHash || input.phoneBinding) throw new ContactVerificationStateError("invalid_verification");
  } else {
    if (input.email !== null || input.passwordHash !== null || !input.phoneBinding
        || input.phoneBinding.phoneHash !== attempt.addressHash) {
      throw new ContactVerificationStateError("invalid_verification");
    }
    assertPhoneBinding(input.phoneBinding);
  }
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}
