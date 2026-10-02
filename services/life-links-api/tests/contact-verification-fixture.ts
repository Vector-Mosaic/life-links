import request from "supertest";
import { vi } from "vitest";
import type { AgentCommunicationsVerificationEmailConfig, EmailVerificationRequest, EmailVerificationSender } from "@vmosaic/provider-sign-in/email";
import type { SmsVerificationRequest, SmsVerificationSender } from "@vmosaic/provider-sign-in/phone";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { hashPassword } from "../src/password.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore } from "../src/store.js";

export const origin = "https://verification.example.test";
export const password = "synthetic-private-password";
export const phoneNumber = "+12025550123";
export const smsConsent = { smsConsent: true, smsConsentVersion: "life-links-sms-verification-v2" };
export function verificationFixture(options: { email?: boolean; phone?: boolean;
  store?: InMemoryLifeLinksStore; sessionSecret?: string; emailSenderConfig?: Partial<AgentCommunicationsVerificationEmailConfig> } = {}) {
  const store = options.store ?? new InMemoryLifeLinksStore(), events: LogEvent[] = [];
  const config = readConfig({ NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory",
    SESSION_SECRET: options.sessionSecret ?? "synthetic-contact-verification-session-key", QR_BASE_URL: origin,
    COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false", ORIGIN_CHECK_ENABLED: "false", ORIGIN_CHECK_ALLOW_MISSING: "true" });
  // Test-only transport/state injection; production runtime requirements have
  // their independent contact-verification-config.test.ts coverage.
  config.contactVerification = {
    ...(options.email === false ? {} : { email: { sender: {
      gatewayBaseUrl: "https://communications.example.test", bearerToken: "synthetic-private-application-mail-token", senderMailbox: "agents@example.test",
      appDisplayName: "LifeLinks", ...options.emailSenderConfig }, maxSendsPerDay: 100, maxSendsPerMonth: 3000 } }),
    ...(options.phone === false ? {} : { phone: { sender: { apiKey: "synthetic-telnyx-key", fromE164: "+12025550100",
      messagingProfileId: "11111111-1111-4111-8111-111111111111", appDisplayName: "LifeLinks" },
      credentialSecret: "synthetic-independent-phone-credential-key", allowedRegions: ["US", "CA"],
      maxSendsPerDay: 100, maxSendsPerMonth: 3000,
      maxCostPerSmsUsd: 0.01, maxSpendPerDayUsd: 1, maxSpendPerMonthUsd: 30 } }),
  };
  const deliveries: EmailVerificationRequest[] = [];
  const send = vi.fn<EmailVerificationSender["send"]>(async input => {
    deliveries.push({ ...input }); return { provider: "agent_communications", accepted: true, messageId: "synthetic-message-id", operationId: input.operationId };
  });
  const smsDeliveries: SmsVerificationRequest[] = [];
  const smsSend = vi.fn<SmsVerificationSender["send"]>(async input => {
    smsDeliveries.push({ ...input });
    return { provider: "telnyx", accepted: true, messageId: "synthetic-message-id", operationId: input.operationId };
  });
  const app = createLifeLinksApp({ store, config, logger: createLogger("verification_test", { sink: event => events.push(event) }),
    emailVerificationSender: { send }, smsVerificationSender: { send: smsSend } });
  const agent = request.agent(app);
  const emailStart = (client = agent, email = "new-owner@example.test", extra: Record<string, unknown> = {}) =>
    client.post("/api/auth/email/start").set("Origin", origin).send({ email, returnTo: "/life-links", ...extra });
  const emailVerify = (attemptToken: string, code = deliveries.at(-1)!.code, client = agent) =>
    client.post("/api/auth/email/verify").set("Origin", origin).send({ attemptToken, code });
  const register = (attemptToken: string, extra: Record<string, unknown> = {}, client = agent) =>
    client.post("/api/auth/register").set("Origin", origin).send({ attemptToken, displayName: "Private Owner", password, timeZone: "America/New_York", ...extra });
  const phoneStart = (client = agent, intent = "login", extra: Record<string, unknown> = {}) =>
    client.post("/api/auth/phone/start").set("Origin", origin).send({ phoneNumber, intent, returnTo: "/calendar", ...smsConsent, ...extra });
  const phoneVerify = (attemptToken: string, code = smsDeliveries.at(-1)!.code, client = agent) =>
    client.post("/api/auth/phone/verify").set("Origin", origin).send({ attemptToken, code });
  const phoneComplete = (attemptToken: string, client = agent) =>
    client.post("/api/auth/phone/complete").set("Origin", origin).send({ attemptToken, displayName: "Phone Owner", timeZone: "America/New_York" });
  async function existingOwner(client = agent, email = "existing-owner@example.test") {
    const user = await store.registerOwner({ displayName: "Existing Owner", email, passwordHash: await hashPassword(password), timeZone: "UTC" });
    await client.post("/api/auth/login").set("Origin", origin).send({ email, password }); return user;
  }
  return { store, events, config, app, agent, deliveries, send, smsDeliveries, smsSend,
    emailStart, emailVerify, register, phoneStart, phoneVerify, phoneComplete, existingOwner };
}
