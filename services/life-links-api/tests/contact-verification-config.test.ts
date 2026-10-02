import { describe, expect, it, onTestFinished, vi } from "vitest";

import { readConfig } from "../src/config.js";
import { readContactVerificationConfig } from "../src/contact-verification-config.js";

const runtime = { storeMode: "postgres" as const, secureCookies: true, publicOrigin: "https://lifelinks.example.test" };
const email: NodeJS.ProcessEnv = {
  LIFE_LINKS_EMAIL_VERIFICATION_ENABLED: "true",
  LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BASE_URL: "https://communications.example.test",
  LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "synthetic-send-only-application-bearer",
  LIFE_LINKS_EMAIL_VERIFICATION_SENDER_MAILBOX: "verify@example.test",
  LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: "100",
  LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_MONTH: "3000",
};
const phone: NodeJS.ProcessEnv = {
  LIFE_LINKS_PHONE_VERIFICATION_ENABLED: "true",
  LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "synthetic-independent-phone-credential-key",
  LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: "synthetic-telnyx-key",
  LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "+18005550123",
  LIFE_LINKS_PHONE_VERIFICATION_MESSAGING_PROFILE_ID: "00000000-0000-4000-8000-000000000001",
  LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "US, CA",
  LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "3",
  LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "30",
  LIFE_LINKS_PHONE_VERIFICATION_MAX_COST_PER_SMS_USD: "0.1",
  LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "0.3",
  LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "3",
};

describe("LifeLinks contact verification configuration", () => {
  it("leaves both transports disabled without credentials, durability or secure runtime", () => {
    expect(readContactVerificationConfig({}, { storeMode: "memory", secureCookies: false, publicOrigin: "invalid" }))
      .toBeUndefined();
    for (const flag of [undefined, "", "false", "TRUE", "1", " true "]) {
      expect(readContactVerificationConfig({
        ...email, ...phone,
        LIFE_LINKS_EMAIL_VERIFICATION_ENABLED: flag,
        LIFE_LINKS_PHONE_VERIFICATION_ENABLED: flag,
      }, { storeMode: "memory", secureCookies: false, publicOrigin: "invalid" })).toBeUndefined();
    }
  });

  it("activates only the exact enabled transport and never contacts a provider during parsing", () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
    onTestFinished(() => fetch.mockRestore());
    expect(readContactVerificationConfig({ ...email, LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: "unused" }, runtime))
      .toEqual({ email: { sender: { gatewayBaseUrl: "https://communications.example.test",
        bearerToken: "synthetic-send-only-application-bearer", senderMailbox: "verify@example.test", appDisplayName: "LifeLinks" },
        maxSendsPerDay: 100, maxSendsPerMonth: 3000 } });
    expect(readContactVerificationConfig(phone, runtime)).toMatchObject({
      phone: { sender: { apiKey: "synthetic-telnyx-key", fromE164: "+18005550123",
        messagingProfileId: "00000000-0000-4000-8000-000000000001", appDisplayName: "LifeLinks" },
        credentialSecret: "synthetic-independent-phone-credential-key", allowedRegions: ["US", "CA"],
        maxSendsPerDay: 3, maxSendsPerMonth: 30, maxCostPerSmsUsd: 0.1,
        maxSpendPerDayUsd: 0.3, maxSpendPerMonthUsd: 3 },
    });
    expect(readContactVerificationConfig({ ...email, ...phone }, runtime)).toHaveProperty("email.sender");
    expect(readContactVerificationConfig({ ...email, ...phone }, runtime)).toHaveProperty("phone.sender");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires durable PostgreSQL and secure cookies for either enabled transport", () => {
    for (const enabled of [email, phone]) {
      expect(() => readContactVerificationConfig(enabled, { ...runtime, storeMode: "memory" })).toThrow(/PostgreSQL/);
      expect(() => readContactVerificationConfig(enabled, { ...runtime, secureCookies: false })).toThrow(/secure cookies/);
    }
  });

  it.each([
    "invalid", "http://lifelinks.example.test", "//lifelinks.example.test",
    "https://user:password@lifelinks.example.test", "https://lifelinks.example.test/",
    "https://lifelinks.example.test/path", "https://lifelinks.example.test?next=/",
    "https://lifelinks.example.test#state", " https://lifelinks.example.test ",
    "https://lifelinks.example.test.", "HTTPS://lifelinks.example.test", "https://lifelinks.example.test:443",
  ])("rejects an enabled transport with a non-exact product origin (%s)", publicOrigin => {
    expect(() => readContactVerificationConfig(email, { ...runtime, publicOrigin })).toThrow(/exact application HTTPS origin/);
    expect(() => readContactVerificationConfig(phone, { ...runtime, publicOrigin })).toThrow(/exact application HTTPS origin/);
  });

  it("requires every email credential and quota without disclosing configured values", () => {
    for (const key of Object.keys(email).filter(key => !key.endsWith("_ENABLED"))) {
      try {
        readContactVerificationConfig({ ...email, [key]: undefined }, runtime);
        expect.fail(`Missing configuration ${key} was accepted`);
      } catch (error) {
        expect(String(error)).toContain("Email verification configuration");
        expect(String(error)).not.toContain("synthetic-send-only-application-bearer");
        expect(String(error)).not.toContain("communications.example.test");
        expect(String(error)).not.toContain("verify@example.test");
      }
    }
  });

  it.each([
    { LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "key with whitespace" },
    { LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "key\u0000value" },
    { LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "x".repeat(31) },
    { LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "é".repeat(32) },
    { LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: "x".repeat(4097) },
    { LIFE_LINKS_EMAIL_VERIFICATION_SENDER_MAILBOX: "LifeLinks <verify@example.test>" },
    { LIFE_LINKS_EMAIL_VERIFICATION_SENDER_MAILBOX: "verify@example.test\r\nBcc:other@example.test" },
    { LIFE_LINKS_EMAIL_VERIFICATION_APP_DISPLAY_NAME: "" },
    { LIFE_LINKS_EMAIL_VERIFICATION_APP_DISPLAY_NAME: "   " },
    { LIFE_LINKS_EMAIL_VERIFICATION_APP_DISPLAY_NAME: "LifeLinks\nOther" },
    { LIFE_LINKS_EMAIL_VERIFICATION_APP_DISPLAY_NAME: "x".repeat(101) },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: "101" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_MONTH: "3001" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: "0" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: "1.5" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: "1e2" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_DAY: " 1" },
    { LIFE_LINKS_EMAIL_VERIFICATION_MAX_SENDS_PER_MONTH: "99" },
  ])("rejects unsafe email sender input or quotas", override => {
    expect(() => readContactVerificationConfig({ ...email, ...override }, runtime)).toThrow(/Email verification configuration/);
  });

  it.each([
    "invalid", "http://127.0.0.1:8765", "//communications.example.test",
    "https://user:password@communications.example.test", "https://communications.example.test/",
    "https://communications.example.test/v1/mail", "https://communications.example.test?token=private",
    "https://communications.example.test#credential", " https://communications.example.test ",
    "https://communications.example.test.", "HTTPS://communications.example.test",
    "https://communications.example.test:443", "https://communications.example.test/\\redirect",
  ])("requires an exact HTTPS communications origin without alternate paths or URL credentials (%s)", gatewayBaseUrl => {
    expect(() => readContactVerificationConfig({ ...email,
      LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BASE_URL: gatewayBaseUrl }, runtime)).toThrow(/Email verification configuration/);
  });

  it("requires the communications connection instead of a retired direct-provider key and sender", () => {
    expect(() => readContactVerificationConfig({ ...email,
      LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BASE_URL: undefined,
      LIFE_LINKS_EMAIL_VERIFICATION_GATEWAY_BEARER_TOKEN: undefined,
      LIFE_LINKS_EMAIL_VERIFICATION_SENDER_MAILBOX: undefined,
      LIFE_LINKS_EMAIL_VERIFICATION_RESEND_API_KEY: "synthetic-retired-provider-key",
      LIFE_LINKS_EMAIL_VERIFICATION_FROM_EMAIL: "verify@example.test",
    }, runtime)).toThrow(/Email verification configuration/);
  });

  it("keeps email sender customization bounded and independent of paid phone activation", () => {
    expect(readContactVerificationConfig({ ...email, LIFE_LINKS_EMAIL_VERIFICATION_APP_DISPLAY_NAME: "LifeLinks Personal" }, runtime))
      .toMatchObject({ email: { sender: { appDisplayName: "LifeLinks Personal" } } });
  });

  it("requires every phone credential, region allowlist and explicit quota/budget", () => {
    for (const key of Object.keys(phone).filter(key => !key.endsWith("_ENABLED"))) {
      try {
        readContactVerificationConfig({ ...phone, [key]: undefined }, runtime);
        expect.fail(`Missing configuration ${key} was accepted`);
      } catch (error) {
        expect(String(error)).toContain("Phone verification configuration");
        expect(String(error)).not.toContain("synthetic-telnyx-key");
        expect(String(error)).not.toContain("synthetic-independent-phone-credential-key");
        expect(String(error)).not.toContain(phone.LIFE_LINKS_PHONE_VERIFICATION_FROM_E164);
      }
    }
  });

  it.each([
    { LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: "synthetic key" },
    { LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: "synthetic\nsecret" },
    { LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: "x".repeat(4097) },
    { LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "18005550123" },
    { LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "+1 800 555 0123" },
    { LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "+08005550123" },
    { LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "+1234567" },
    { LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: "+1234567890123456" },
    { LIFE_LINKS_PHONE_VERIFICATION_MESSAGING_PROFILE_ID: "invalid-profile" },
    { LIFE_LINKS_PHONE_VERIFICATION_MESSAGING_PROFILE_ID: "00000000-0000-4000-8000-00000000000z" },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "" },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "   " },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "LifeLinks\nOther" },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "x".repeat(41) },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "LifeLinksé" },
    { LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "LifeLinks^" },
    { LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "x".repeat(31) },
    { LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "x".repeat(4097) },
    { LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "é".repeat(2049) },
    { LIFE_LINKS_PHONE_CREDENTIAL_SECRET: `${"x".repeat(32)}\n` },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "US,,CA" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "US, US" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "us" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "1" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "GB" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "PR" },
    { LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: "" },
  ])("rejects malformed phone credentials or region allowlists", override => {
    expect(() => readContactVerificationConfig({ ...phone, ...override }, runtime)).toThrow(/Phone verification configuration/);
  });

  it.each(["US", "CA", "CA, US"])("retains the exact selected country policy (%s)", allowedRegions => {
    const configured = readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: allowedRegions }, runtime)?.phone;
    expect(configured?.allowedRegions).toEqual(allowedRegions.split(",").map(value => value.trim()));
    expect(configured).not.toHaveProperty("allowedCallingCodes");
    expect(configured).not.toHaveProperty("providerRegionAllowlistConfirmed");
  });

  it("does not activate a retired Twilio-only configuration or accept a calling-code region substitute", () => {
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_TELNYX_API_KEY: undefined,
      LIFE_LINKS_PHONE_VERIFICATION_FROM_E164: undefined,
      LIFE_LINKS_PHONE_VERIFICATION_MESSAGING_PROFILE_ID: undefined,
      LIFE_LINKS_PHONE_VERIFICATION_TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
      LIFE_LINKS_PHONE_VERIFICATION_TWILIO_API_KEY_SID: `SK${"b".repeat(32)}`,
      LIFE_LINKS_PHONE_VERIFICATION_TWILIO_API_KEY_SECRET: "synthetic-retired-key",
      LIFE_LINKS_PHONE_VERIFICATION_TWILIO_SERVICE_SID: `VA${"c".repeat(32)}`,
    }, runtime)).toThrow(/Phone verification configuration/);
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_REGIONS: undefined,
      LIFE_LINKS_PHONE_VERIFICATION_ALLOWED_CALLING_CODES: "1",
    }, runtime)).toThrow(/Phone verification configuration/);
  });

  it("keeps the SMS display name bounded and independent of email activation", () => {
    expect(readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "LifeLinks Personal" }, runtime)?.phone?.sender)
      .toMatchObject({ appDisplayName: "LifeLinks Personal" });
    expect(readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_APP_DISPLAY_NAME: "x".repeat(40) }, runtime)?.phone?.sender.appDisplayName).toHaveLength(40);
  });

  it("accepts the durable phone-credential key by UTF-8 byte bounds, independently of transport keys", () => {
    expect(readContactVerificationConfig({ ...phone, LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "é".repeat(16) }, runtime)?.phone?.credentialSecret)
      .toBe("é".repeat(16));
    expect(readContactVerificationConfig({ ...phone, LIFE_LINKS_PHONE_CREDENTIAL_SECRET: "x".repeat(4096) }, runtime)?.phone?.credentialSecret)
      .toBe("x".repeat(4096));
  });

  it("enforces both send quotas against their exact decimal spending caps", () => {
    expect(readContactVerificationConfig(phone, runtime)?.phone?.maxSendsPerDay).toBe(3);
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "0.299999" }, runtime)).toThrow();
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "2.999999" }, runtime)).toThrow();
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "4" }, runtime)).toThrow();
    expect(() => readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "31" }, runtime)).toThrow();
    expect(readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "10000",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "100000",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_COST_PER_SMS_USD: "0.000001",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "0.01",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "0.1" }, runtime)?.phone)
      .toMatchObject({ maxSendsPerDay: 10_000, maxSendsPerMonth: 100_000, maxCostPerSmsUsd: 0.000001 });
    expect(readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "1",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "1",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_COST_PER_SMS_USD: "0.000001",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "0.000001",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "0.000001" }, runtime)?.phone)
      .toMatchObject({ maxSendsPerDay: 1, maxSendsPerMonth: 1, maxSpendPerMonthUsd: 0.000001 });
  });

  it.each(["0", "-1", "+1", "NaN", "Infinity", "1e309", "0x1", "1.", ".1", "0.0000001", "01", " 1"])(
    "rejects non-positive, non-finite or non-canonical USD budgets (%s)", value => {
      for (const key of ["MAX_COST_PER_SMS_USD", "MAX_SPEND_PER_DAY_USD", "MAX_SPEND_PER_MONTH_USD"]) {
        expect(() => readContactVerificationConfig({ ...phone, [`LIFE_LINKS_PHONE_VERIFICATION_${key}`]: value }, runtime)).toThrow();
      }
    });

  it("rejects phone limits beyond config ceilings and inconsistent daily/monthly budgets", () => {
    for (const override of [
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "10001" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "100001" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_COST_PER_SMS_USD: "1000.000001" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "1000.000001" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "10000.000001" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "31", LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "3.1" },
      { LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "3.1" },
    ]) expect(() => readContactVerificationConfig({ ...phone, ...override }, runtime)).toThrow();
    expect(readContactVerificationConfig({ ...phone,
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_DAY: "1",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SENDS_PER_MONTH: "10",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_COST_PER_SMS_USD: "1000",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_DAY_USD: "1000",
      LIFE_LINKS_PHONE_VERIFICATION_MAX_SPEND_PER_MONTH_USD: "10000" }, runtime)?.phone)
      .toMatchObject({ maxCostPerSmsUsd: 1000, maxSpendPerDayUsd: 1000, maxSpendPerMonthUsd: 10_000 });
  });

  it("integrates with the resolved product storage, cookie policy and origin", () => {
    const env = { ...email, DATABASE_URL: "postgresql://synthetic.invalid/lifelinks", AUTO_SEED: "false",
      SESSION_SECRET: "synthetic-session-proof-secret-32-bytes", COOKIE_SECURE: "true", QR_BASE_URL: runtime.publicOrigin };
    expect(readConfig(env).contactVerification?.email?.maxSendsPerDay).toBe(100);
    expect(() => readConfig({ ...env, COOKIE_SECURE: "false" })).toThrow(/secure cookies/);
    expect(() => readConfig({ ...env, LIFE_LINKS_STORE: "memory" })).toThrow(/PostgreSQL/);
    expect(() => readConfig({ ...env, QR_BASE_URL: "http://localhost:3002" })).toThrow(/HTTPS origin/);
    expect(readConfig({}).contactVerification).toBeUndefined();
  });

  it("requires an explicit adequate proof-protection key instead of the local session-secret fallback", () => {
    const env = { ...email, DATABASE_URL: "postgresql://synthetic.invalid/lifelinks", AUTO_SEED: "false",
      COOKIE_SECURE: "true", QR_BASE_URL: runtime.publicOrigin };
    for (const SESSION_SECRET of [undefined, "", "life-links-local-session-secret", "x".repeat(31),
      "x".repeat(4097), `${"x".repeat(32)}\n`]) {
      expect(() => readConfig({ ...env, SESSION_SECRET })).toThrow(/SESSION_SECRET/);
    }
    expect(readConfig({ ...env, SESSION_SECRET: "x".repeat(32) }).contactVerification?.email).toBeDefined();
    expect(readConfig({ ...env, SESSION_SECRET: "x".repeat(4096) }).contactVerification?.email).toBeDefined();
  });
});
