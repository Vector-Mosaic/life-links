import { describe, expect, it } from "vitest";
import { createSmsVerificationConsentReceipt, assertSmsVerificationConsentReceipt, SMS_CONSENT_RETENTION_MS } from "../src/sms-verification-consent.js";

const receipt = () => createSmsVerificationConsentReceipt({ receiptHash: "a".repeat(64), phoneHash: "b".repeat(64),
  consentedAt: new Date(Date.now() - 1_000).toISOString(), disclosureVersion: "life-links-sms-verification-v2" });
describe("minimal verification-only SMS consent receipt", () => {
  it("retains only the approved identifiers/time/version and a fixed 90-day expiry", () => {
    const value = receipt();
    expect(Object.keys(value).sort()).toEqual(["consentedAt", "disclosureVersion", "expiresAt", "phoneHash", "receiptHash"]);
    expect(Date.parse(value.expiresAt) - Date.parse(value.consentedAt)).toBe(90 * 24 * 60 * 60_000);
  });
  it("rejects unknown versions, malformed identifiers, changed retention and expired or future actions", () => {
    const value = receipt();
    for (const change of [{ disclosureVersion: "life-links-sms-verification-v1" }, { phoneHash: "+12025550123" },
      { expiresAt: new Date(Date.parse(value.expiresAt) + 1).toISOString() },
      { consentedAt: new Date(Date.now() + 60_000).toISOString() },
      { consentedAt: new Date(Date.now() - SMS_CONSENT_RETENTION_MS - 1_000).toISOString(), expiresAt: new Date(Date.now() - 1_000).toISOString() }]) {
      expect(() => assertSmsVerificationConsentReceipt({ ...value, ...change } as typeof value)).toThrowError("verification_unavailable");
    }
  });
  it("refuses restricted extra fields instead of storing an arbitrary input object", () => {
    for (const field of ["phoneNumber", "code", "browserHash", "ip", "sessionHash"]) {
      expect(() => assertSmsVerificationConsentReceipt({ ...receipt(), [field]: "restricted" })).toThrowError("verification_unavailable");
    }
  });
});
