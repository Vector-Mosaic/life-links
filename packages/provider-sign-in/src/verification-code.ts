import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export interface VerificationCodeBinding {
  code: string;
  channel: "email" | "sms";
  /** The consumer's canonical destination, used exactly as supplied without normalization. */
  destination: string;
  challengeId: string;
  purpose: string;
  /** A consumer-owned secret of at least 32 bytes; never sent to a delivery provider. */
  key: string | Uint8Array;
}

/** Safe to record without the destination, code or key. */
export class VerificationCodeError extends Error {
  readonly code = "invalid_request";

  constructor() {
    super("invalid_request");
    this.name = "VerificationCodeError";
  }
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Store a keyed digest instead of a guessable six-digit code or an unkeyed hash. */
export function hashVerificationCode(binding: VerificationCodeBinding): string {
  if (!binding || typeof binding !== "object" || !validText(binding.code, 6) || !/^[0-9]{6}$/u.test(binding.code)
    || (binding.channel !== "email" && binding.channel !== "sms") || !validText(binding.destination, 512) || !validText(binding.challengeId, 512) || !validText(binding.purpose, 128)
    || !(typeof binding.key === "string" || binding.key instanceof Uint8Array)) throw new VerificationCodeError();
  const key = typeof binding.key === "string" ? Buffer.from(binding.key, "utf8") : Buffer.from(binding.key);
  if (key.byteLength < 32 || key.byteLength > 4096) throw new VerificationCodeError();
  return createHmac("sha256", key)
    .update(JSON.stringify(["provider-sign-in/verification-code/v1", binding.channel, binding.challengeId, binding.destination, binding.purpose, binding.code]))
    .digest("hex");
}

/** A match does not enforce expiry, attempt limits, browser binding or atomic one-time admission. */
export function matchesVerificationCode(binding: VerificationCodeBinding & { digest: string }): boolean {
  if (!binding || typeof binding.digest !== "string" || binding.digest.length !== 64 || !/^[a-f0-9]{64}$/u.test(binding.digest)) return false;
  try {
    return timingSafeEqual(Buffer.from(binding.digest, "hex"), Buffer.from(hashVerificationCode(binding), "hex"));
  } catch {
    return false;
  }
}
