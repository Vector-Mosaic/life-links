/** Immutable disclosure for this version. Material text/policy changes require a new version. */
export const LIFE_LINKS_SMS_VERIFICATION_CONSENT = Object.freeze({
  version: "life-links-sms-verification-v2" as const,
  permission: "I agree to receive LifeLinks SMS verification codes for phone signup, sign-in or linking at this number.",
  frequency: "Message frequency depends on my requests. Standard message and data rates may apply.",
  keywords: "Reply STOP to stop texts or HELP for help.",
  supportEmail: "justin@vmosaic.com",
  retentionNotice: "We keep a receipt with a keyed identifier for this number, the consent time and disclosure version for 90 days. It contains no full phone number or verification code. Expired receipts are removed by routine cleanup.",
  retentionDays: 90,
});
