import { LIFE_LINKS_SMS_VERIFICATION_CONSENT } from "@life-links/core";
import { ContactVerificationStateError, validContactFingerprint } from "./contact-verification-state.js";

export type SmsVerificationConsentReceipt = {
  receiptHash: string;
  phoneHash: string;
  consentedAt: string;
  disclosureVersion: typeof LIFE_LINKS_SMS_VERIFICATION_CONSENT.version;
  expiresAt: string;
};
export const SMS_CONSENT_RETENTION_MS = LIFE_LINKS_SMS_VERIFICATION_CONSENT.retentionDays * 24 * 60 * 60_000;
export function createSmsVerificationConsentReceipt(input: Omit<SmsVerificationConsentReceipt, "expiresAt">): SmsVerificationConsentReceipt {
  const time = Date.parse(input.consentedAt);
  if (!Number.isFinite(time) || time > Date.now()) throw new ContactVerificationStateError("verification_unavailable");
  const receipt = { ...input, expiresAt: new Date(time + SMS_CONSENT_RETENTION_MS).toISOString() };
  assertSmsVerificationConsentReceipt(receipt);
  return receipt;
}
export function assertSmsVerificationConsentReceipt(receipt: SmsVerificationConsentReceipt): void {
  const time = Date.parse(receipt?.consentedAt), expiry = Date.parse(receipt?.expiresAt);
  if (!receipt || !validContactFingerprint(receipt.receiptHash) || !validContactFingerprint(receipt.phoneHash)
      || receipt.disclosureVersion !== LIFE_LINKS_SMS_VERIFICATION_CONSENT.version
      || !Number.isFinite(time) || !Number.isFinite(expiry) || time > Date.now() || expiry <= Date.now()
      || new Date(time).toISOString() !== receipt.consentedAt || new Date(expiry).toISOString() !== receipt.expiresAt
      || expiry !== time + SMS_CONSENT_RETENTION_MS
      || Object.keys(receipt).some(key => !["receiptHash", "phoneHash", "consentedAt", "disclosureVersion", "expiresAt"].includes(key))) {
    throw new ContactVerificationStateError("verification_unavailable");
  }
}
export function sameSmsVerificationConsentReceipt(saved: SmsVerificationConsentReceipt, receipt: SmsVerificationConsentReceipt): boolean {
  return saved.receiptHash === receipt.receiptHash && saved.phoneHash === receipt.phoneHash
    && saved.consentedAt === receipt.consentedAt && saved.disclosureVersion === receipt.disclosureVersion && saved.expiresAt === receipt.expiresAt;
}
