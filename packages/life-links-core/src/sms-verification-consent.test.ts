import { describe, expect, it } from "vitest";
import { LIFE_LINKS_SMS_VERIFICATION_CONSENT } from "./sms-verification-consent.js";

describe("LifeLinks versioned SMS consent disclosure", () => {
  it("keeps the v2 permission and 90-day minimal receipt policy immutable", () => {
    expect(Object.isFrozen(LIFE_LINKS_SMS_VERIFICATION_CONSENT)).toBe(true);
    expect(LIFE_LINKS_SMS_VERIFICATION_CONSENT.version).toBe("life-links-sms-verification-v2");
    expect(LIFE_LINKS_SMS_VERIFICATION_CONSENT.retentionDays).toBe(90);
    expect(LIFE_LINKS_SMS_VERIFICATION_CONSENT.permission).toBe("I agree to receive LifeLinks SMS verification codes for phone signup, sign-in or linking at this number.");
    expect(LIFE_LINKS_SMS_VERIFICATION_CONSENT.retentionNotice).toContain("the consent time and disclosure version for 90 days.");
    expect(LIFE_LINKS_SMS_VERIFICATION_CONSENT.retentionNotice).toContain("routine cleanup.");
  });
});
