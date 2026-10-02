import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import cookie from "cookie";
import { Router, type Request, type Response } from "express";
import { LIFE_LINKS_SMS_VERIFICATION_CONSENT, normalizeCalendarIanaTimeZone } from "@life-links/core";
import { createAgentCommunicationsVerificationEmailSender, EmailVerificationDeliveryError, type EmailVerificationSender } from "@vmosaic/provider-sign-in/email";
import { createTelnyxVerificationSmsSender, SmsVerificationDeliveryError, type SmsVerificationSender } from "@vmosaic/provider-sign-in/phone";
import { generateVerificationCode, hashVerificationCode, matchesVerificationCode, type VerificationCodeBinding } from "@vmosaic/provider-sign-in/verification-code";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { LifeLinksConfig } from "./config.js";
import type { LifeLinksStore, StoredUser } from "./store.js";
import type { Logger } from "./logger.js";
import { hashPassword } from "./password.js";
import { createSmsVerificationConsentReceipt } from "./sms-verification-consent.js";
import { ContactVerificationStateError, type ContactVerificationAttempt, type PhoneBinding,
  type VerificationLimit, type FinalizeVerifiedRegistrationInput } from "./contact-verification-state.js";
import { invitationFingerprint, matchesRegistrationInvitation, memberRegistrationInvitation,
  RegistrationAdmissionError, validInvitationCode, type RegistrationInvitation } from "./registration.js";

const BROWSER_COOKIE = "life_links_contact_verification";
const LIFETIME = 10 * 60_000;
const COOLDOWN = 60_000;
type AuthRequest = Request & { user?: StoredUser; sessionTokenHash?: string; authTransport?: string; requestId?: string };
type Payload = { address: string; returnTo: string; invitationCode?: string; operationId: string;
  verificationCode: string; codeDigest: string; emailSenderContext?: string; ownerId?: string; sessionHash?: string;
  smsConsent?: { recordedAt: string; version: typeof LIFE_LINKS_SMS_VERIFICATION_CONSENT.version; purpose: "verification" } };
type Loaded = { attempt: ContactVerificationAttempt; payload: Payload };
class VerificationRequestError extends Error {
  constructor(readonly code: "invalid_verification" | "verification_unavailable" | "verification_rate_limited" |
    "send_outcome_unknown" | "sign_out_required" | "authentication_required" | "signup_failed") { super(code); }
}

/** LifeLinks owns admission, durable abuse limits, browser binding and account transactions. */
export function createContactVerificationRouter(options: { store: LifeLinksStore; config: LifeLinksConfig; logger: Logger;
  emailSender?: EmailVerificationSender; smsSender?: SmsVerificationSender;
  issueSession(user: StoredUser, response: Response): Promise<void>;
  registrationResponse(user: StoredUser): unknown }) {
  const { store, config, logger, issueSession, registrationResponse } = options;
  const routes = Router();
  const emailConfig = config.contactVerification?.email, phoneConfig = config.contactVerification?.phone;
  const emailSender = emailConfig ? options.emailSender ?? createAgentCommunicationsVerificationEmailSender(emailConfig.sender) : undefined;
  const smsSender = phoneConfig ? options.smsSender ?? createTelnyxVerificationSmsSender(phoneConfig.sender) : undefined;
  const key = createHash("sha256").update(`life-links/contact-verification/v1:${config.sessionSecret}`).digest();
  const fingerprint = (value: string) => createHmac("sha256", key).update(value).digest("hex");
  // A changed bearer can select another gateway journal namespace. Never
  // reconcile an uncertain operation under a different sender/caller context.
  // Store only this keyed value inside the encrypted attempt, never credentials.
  const emailSenderContext = emailConfig ? fingerprint(`email-sender:${JSON.stringify([
    emailConfig.sender.gatewayBaseUrl, emailConfig.sender.senderMailbox,
    emailConfig.sender.appDisplayName, emailConfig.sender.bearerToken,
  ])}`) : undefined;
  const phoneHash = (phone: string) => {
    if (!phoneConfig?.credentialSecret) throw new VerificationRequestError("verification_unavailable");
    return createHmac("sha256", phoneConfig.credentialSecret).update(`life-links/phone-credential/v1:${phone}`).digest("hex");
  };
  const codeBinding = (attempt: ContactVerificationAttempt, payload: Payload, code: string): VerificationCodeBinding => ({
    code, channel: attempt.channel === "phone" ? "sms" : "email", destination: payload.address,
    challengeId: attempt.tokenHash, purpose: attempt.intent, key,
  });
  const addressHash = (channel: "email" | "phone", address: string) => channel === "phone" ? phoneHash(address) : fingerprint(`email:${address}`);
  const browserValue = (request: Request) => cookie.parse(request.headers.cookie ?? "")[BROWSER_COOKIE] ?? "";
  function noStore(response: Response) { response.setHeader("Cache-Control", "private, no-store"); response.setHeader("Referrer-Policy", "no-referrer"); }
  function browser(request: Request, response: Response) {
    const current = browserValue(request), value = /^[A-Za-z0-9_-]{43}$/.test(current) ? current : randomBytes(32).toString("base64url");
    response.append("Set-Cookie", cookie.serialize(BROWSER_COOKIE, value, { httpOnly: true, secure: config.secureCookies,
      sameSite: "lax", path: "/", maxAge: LIFETIME / 1000 }));
    return value;
  }
  function clearBrowser(response: Response) {
    response.append("Set-Cookie", cookie.serialize(BROWSER_COOKIE, "", { httpOnly: true, secure: config.secureCookies,
      sameSite: "lax", path: "/", maxAge: 0 }));
  }
  function encrypt(attempt: ContactVerificationAttempt, payload: Payload) {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(`${attempt.tokenHash}:${attempt.browserHash}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }
  async function read(value: unknown, request: Request): Promise<Loaded> {
    const browser = browserValue(request);
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new VerificationRequestError("invalid_verification");
    const tokenHash = fingerprint(`attempt:${value}`), browserHash = fingerprint(`browser:${browser}`);
    const attempt = await store.getContactVerificationAttempt(tokenHash, browserHash);
    if (!attempt || attempt.phase === "consumed" || Date.parse(attempt.expiresAt) <= Date.now()) throw new VerificationRequestError("invalid_verification");
    try {
      const bytes = Buffer.from(attempt.encryptedPayload, "base64url"), decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${tokenHash}:${browserHash}`)); decipher.setAuthTag(bytes.subarray(12, 28));
      const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as Payload;
      if (typeof payload.address !== "string" || attempt.addressHash !== addressHash(attempt.channel, payload.address)) throw new Error();
      return { attempt, payload };
    } catch { throw new VerificationRequestError("invalid_verification"); }
  }
  async function update(loaded: Loaded, changes: Partial<ContactVerificationAttempt>, payload = loaded.payload): Promise<Loaded> {
    const next = { ...loaded.attempt, ...changes, version: loaded.attempt.version + 1 };
    next.encryptedPayload = encrypt(next, payload);
    if (!await store.updateContactVerificationAttempt(next, loaded.attempt.version)) throw new VerificationRequestError("invalid_verification");
    return { attempt: next, payload };
  }
  function body(request: Request, allowed: string[]) {
    const input = request.body;
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(name => !allowed.includes(name))) throw new VerificationRequestError("invalid_verification");
    return input as Record<string, unknown>;
  }
  function returnPath(value: unknown) {
    if (value === undefined) return "/";
    if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\#\u0000-\u001f\u007f]/.test(value)) throw new VerificationRequestError("invalid_verification");
    const url = new URL(value, config.qrBaseUrl);
    if (url.origin !== new URL(config.qrBaseUrl).origin) throw new VerificationRequestError("invalid_verification");
    return `${url.pathname}${url.search}`;
  }
  function emailAddress(value: unknown) {
    if (typeof value !== "string") throw new VerificationRequestError("invalid_verification");
    const clean = value.trim().toLowerCase();
    if (clean.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(clean)) throw new VerificationRequestError("invalid_verification");
    return clean;
  }
  function phoneNumber(value: unknown) {
    if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) throw new VerificationRequestError("invalid_verification");
    const parsed = parsePhoneNumberFromString(value, { extract: false });
    if (!parsed || !parsed.isValid() || parsed.number !== value || parsed.ext) throw new VerificationRequestError("invalid_verification");
    if (!phoneConfig?.allowedRegions.some(region => region === parsed.country)) throw new VerificationRequestError("verification_unavailable");
    return value;
  }
  function profile(input: Record<string, unknown>) {
    if (typeof input.displayName !== "string") throw new VerificationRequestError("invalid_verification");
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 100 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new VerificationRequestError("invalid_verification");
    try { return { displayName, timeZone: normalizeCalendarIanaTimeZone(input.timeZone ?? "UTC") }; }
    catch { throw new VerificationRequestError("invalid_verification"); }
  }
  function event(request: AuthRequest, transition: string, channel: string, userId?: string) {
    logger.info(`life_links.verification.${transition}`, { msg: "Contact verification transition", request_id: request.requestId,
      channel, ...(userId ? { user_id: userId } : {}) });
  }
  function errorResponse(response: Response, error: unknown) {
    const code = error instanceof VerificationRequestError || error instanceof ContactVerificationStateError ? error.code :
      error instanceof RegistrationAdmissionError ? "signup_failed" : "verification_unavailable";
    response.status(code === "verification_rate_limited" ? 429 : code === "authentication_required" ? 401 :
      code === "sign_out_required" || code === "signup_failed" ? 409 : code === "verification_unavailable" || code === "send_outcome_unknown" ? 503 : 400).json({ error: code });
  }
  async function reserve(request: Request, attempt: ContactVerificationAttempt, sending: boolean, reconciliation = false) {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
    const dayEnd = Date.parse(`${day}T00:00:00.000Z`) + 86400000;
    const monthEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);
    const limits: VerificationLimit[] = [];
    // Public namespace counters survive session-secret rotation; contact subjects remain opaque keyed hashes.
    const add = (name: string, max: number, windowMs: number, windowType?: "rolling") => limits.push({
      keyHash: createHash("sha256").update(`life-links/verification-limit/v1:${name}`).digest("hex"), max, windowMs,
      ...(windowType ? { windowType } : {}) });
    const ip = fingerprint(`ip:${request.ip || request.socket.remoteAddress || "unknown"}`);
    if (sending && !reconciliation) {
      const channelConfig = attempt.channel === "email" ? emailConfig : phoneConfig;
      if (!channelConfig) throw new VerificationRequestError("verification_unavailable");
      add(`${attempt.channel}:day:${day}`, channelConfig.maxSendsPerDay, dayEnd - now);
      add(`${attempt.channel}:month:${month}`, channelConfig.maxSendsPerMonth, monthEnd - now);
      add(`${attempt.channel}:address:${attempt.addressHash}:quarter`, 3, 15 * 60_000);
      if (attempt.channel === "phone") add(`phone:address:${attempt.addressHash}:rolling-day`, 10, 24 * 60 * 60_000, "rolling");
      else add(`email:address:${attempt.addressHash}:day:${day}`, 10, dayEnd - now);
    }
    add(`${sending ? "send" : "check"}:browser:${attempt.browserHash}`, sending ? 6 : 20, 15 * 60_000);
    add(`${sending ? "send" : "check"}:ip:${ip}`, sending ? 10 : 30, 15 * 60_000);
    if (!sending) add(`check:address:${attempt.addressHash}`, 20, 15 * 60_000);
    if (!await store.reserveVerificationLimits(limits)) throw new VerificationRequestError("verification_rate_limited");
  }
  const acknowledgement = (token: unknown, attempt: ContactVerificationAttempt) => ({ attemptToken: token,
    expiresAt: attempt.expiresAt, resendAfterSeconds: Math.max(0, Math.ceil((Date.parse(attempt.resendAt) - Date.now()) / 1000)) });
  async function deliver(loaded: Loaded, request: AuthRequest): Promise<Loaded> {
    if (loaded.attempt.channel === "phone") {
      if (!smsSender || loaded.payload.smsConsent?.purpose !== "verification") throw new VerificationRequestError("verification_unavailable");
      // Persist the original explicit action before dispatch. Resends reuse the
      // immutable receipt without renewing consent or its retention period.
      await store.recordSmsVerificationConsent(createSmsVerificationConsentReceipt({
        receiptHash: loaded.attempt.tokenHash, phoneHash: loaded.attempt.addressHash,
        consentedAt: loaded.payload.smsConsent.recordedAt, disclosureVersion: loaded.payload.smsConsent.version,
      }));
    }
    try {
      if (loaded.attempt.channel === "email") {
        if (!emailSender) throw new VerificationRequestError("verification_unavailable");
        await emailSender.send({ email: loaded.payload.address, code: loaded.payload.verificationCode, operationId: loaded.payload.operationId });
      } else {
        if (!smsSender) throw new VerificationRequestError("verification_unavailable");
        await smsSender.send({ phoneE164: loaded.payload.address, code: loaded.payload.verificationCode, operationId: loaded.payload.operationId });
      }
      loaded = await update(loaded, { phase: "sent" });
      event(request, "sent", loaded.attempt.channel);
      return loaded;
    } catch (error) {
      if (error instanceof VerificationRequestError && error.code !== "send_outcome_unknown") throw error;
      const unknown = error instanceof EmailVerificationDeliveryError ? error.outcome === "unknown" :
        error instanceof SmsVerificationDeliveryError ? error.outcome === "unknown" : true;
      loaded = await update(loaded, { phase: unknown ? "send_unknown" : "send_rejected" });
      event(request, unknown ? "send_unknown" : "send_rejected", loaded.attempt.channel);
      // An uncertain delivery can still prove possession if its original code
      // arrives. Only email supports same-operation delivery reconciliation.
      if (unknown) return loaded;
      throw new VerificationRequestError("verification_unavailable");
    }
  }
  async function invitation(code: unknown): Promise<RegistrationInvitation | undefined> {
    if (!validInvitationCode(code)) return undefined;
    const member = config.memberInvitationsEnabled ? await store.getMemberInvitation(invitationFingerprint(code)) : null;
    const accepted = member ? memberRegistrationInvitation(member) : config.registration && matchesRegistrationInvitation(code, config.registration) ? config.registration : undefined;
    return accepted && await store.registrationAvailable(accepted) ? accepted : undefined;
  }
  async function finalize(input: FinalizeVerifiedRegistrationInput) {
    try { return await store.finalizeVerifiedRegistration(input); }
    catch (error) {
      // A raced cancellation rolls back the complete registration transaction.
      if (input.invitation && error instanceof RegistrationAdmissionError && error.code === "registration_unavailable") {
        const { invitation: _invitation, ...publicInput } = input;
        return store.finalizeVerifiedRegistration(publicInput);
      }
      throw error;
    }
  }
  function phoneBinding(loaded: Loaded): PhoneBinding {
    return { phoneHash: phoneHash(loaded.payload.address), maskedNumber: `•••• ${loaded.payload.address.slice(-4)}` };
  }
  async function finishPhone(loaded: Loaded, request: AuthRequest, response: Response) {
    const { attempt, payload } = loaded, consumption = { tokenHash: attempt.tokenHash, browserHash: attempt.browserHash, expectedVersion: attempt.version };
    if (attempt.phase !== "verified") throw new VerificationRequestError("invalid_verification");
    const binding = phoneBinding(loaded);
    if (attempt.intent === "link") {
      if (request.authTransport !== "cookie" || request.user?.id !== payload.ownerId || request.sessionTokenHash !== payload.sessionHash) throw new VerificationRequestError("authentication_required");
      const sessionTokenHash = payload.sessionHash;
      const session = sessionTokenHash ? await store.getSessionByTokenHash(sessionTokenHash) : null;
      if (!sessionTokenHash || !session || session.user.id !== payload.ownerId) throw new VerificationRequestError("authentication_required");
      await store.finalizeVerifiedPhoneLink({ ...consumption, ownerId: session.user.id,
        sessionTokenHash, phoneBinding: binding });
      clearBrowser(response); event(request, "phone_linked", "phone", session.user.id);
      response.json({ status: "linked", returnTo: payload.returnTo }); return;
    }
    if (request.user) throw new VerificationRequestError("sign_out_required");
    const user = await store.getPhoneUser(binding);
    if (user) {
      if (!await store.consumeVerifiedContactAttempt(consumption)) throw new VerificationRequestError("invalid_verification");
      await issueSession(user, response); clearBrowser(response); event(request, "phone_signed_in", "phone", user.id);
      response.json({ status: "signed_in", returnTo: payload.returnTo }); return;
    }
    response.json({ status: "profile_required", returnTo: payload.returnTo });
  }
  async function start(channel: "email" | "phone", request: AuthRequest, response: Response) {
    noStore(response);
    try {
      if (channel === "email" ? !emailSender : !smsSender) throw new VerificationRequestError("verification_unavailable");
      const input = body(request, channel === "email" ? ["email", "invitationCode", "returnTo"] :
        ["phoneNumber", "intent", "invitationCode", "returnTo", "smsConsent", "smsConsentVersion"]);
      const intent = channel === "email" ? "register" : input.intent;
      if (intent !== "login" && intent !== "register" && intent !== "link") throw new VerificationRequestError("invalid_verification");
      if (intent === "link" && (!request.user || request.authTransport !== "cookie" || !request.sessionTokenHash)) throw new VerificationRequestError("authentication_required");
      if (intent !== "link" && request.user) throw new VerificationRequestError("sign_out_required");
      if (channel === "phone" && (input.smsConsent !== true || input.smsConsentVersion !== LIFE_LINKS_SMS_VERIFICATION_CONSENT.version)) throw new VerificationRequestError("invalid_verification");
      if (input.invitationCode !== undefined && !validInvitationCode(input.invitationCode)) throw new VerificationRequestError("invalid_verification");
      const address = channel === "email" ? emailAddress(input.email) : phoneNumber(input.phoneNumber);
      const token = randomBytes(32).toString("base64url"), browserNonce = browser(request, response), now = Date.now();
      const attempt: ContactVerificationAttempt = { tokenHash: fingerprint(`attempt:${token}`), browserHash: fingerprint(`browser:${browserNonce}`),
        addressHash: addressHash(channel, address), channel, intent, phase: "send_pending", encryptedPayload: "pending",
        expiresAt: new Date(now + LIFETIME).toISOString(), resendAt: new Date(now + COOLDOWN).toISOString(), version: 1, checkCount: 0 };
      const payload: Payload = { address, returnTo: returnPath(input.returnTo), operationId: randomBytes(32).toString("hex"),
        verificationCode: generateVerificationCode(), codeDigest: "",
        ...(channel === "email" ? { emailSenderContext } : {}),
        ...(input.invitationCode ? { invitationCode: input.invitationCode as string } : {}),
        ...(intent === "link" ? { ownerId: request.user!.id, sessionHash: request.sessionTokenHash } : {}),
        ...(channel === "phone" ? { smsConsent: { recordedAt: new Date(now).toISOString(), version: LIFE_LINKS_SMS_VERIFICATION_CONSENT.version,
          purpose: "verification" as const } } : {}) };
      payload.codeDigest = hashVerificationCode(codeBinding(attempt, payload, payload.verificationCode));
      attempt.encryptedPayload = encrypt(attempt, payload);
      await reserve(request, attempt, true);
      await store.createContactVerificationAttempt(attempt);
      const sent = await deliver({ attempt, payload }, request);
      response.status(202).json(acknowledgement(token, sent.attempt));
    } catch (error) { errorResponse(response, error); }
  }
  routes.post("/api/auth/email/start", (request: AuthRequest, response) => start("email", request, response));
  routes.post("/api/auth/phone/start", (request: AuthRequest, response) => start("phone", request, response));
  async function resend(channel: "email" | "phone", request: AuthRequest, response: Response) {
    noStore(response);
    try {
      const input = body(request, ["attemptToken"]); let loaded = await read(input.attemptToken, request);
      if (loaded.attempt.channel !== channel || Date.parse(loaded.attempt.resendAt) > Date.now()) throw new VerificationRequestError("verification_rate_limited");
      const reconcile = loaded.attempt.phase === "send_unknown" && channel === "email";
      if (!reconcile && !["sent", "send_rejected"].includes(loaded.attempt.phase)) throw new VerificationRequestError(loaded.attempt.phase === "send_unknown" ? "send_outcome_unknown" : "invalid_verification");
      if (reconcile && (!emailSenderContext || loaded.payload.emailSenderContext !== emailSenderContext)) throw new VerificationRequestError("send_outcome_unknown");
      if (loaded.attempt.checkCount >= 5) throw new VerificationRequestError("invalid_verification");
      const payload = { ...loaded.payload };
      if (!reconcile) {
        payload.operationId = randomBytes(32).toString("hex");
        payload.verificationCode = generateVerificationCode();
        payload.codeDigest = hashVerificationCode(codeBinding(loaded.attempt, payload, payload.verificationCode));
        if (channel === "email") payload.emailSenderContext = emailSenderContext;
      }
      await reserve(request, loaded.attempt, true, reconcile);
      loaded = await update(loaded, { phase: "send_pending", resendAt: new Date(Date.now() + COOLDOWN).toISOString() }, payload);
      loaded = await deliver(loaded, request);
      response.status(202).json(acknowledgement(input.attemptToken, loaded.attempt));
    } catch (error) { errorResponse(response, error); }
  }
  routes.post("/api/auth/email/resend", (request: AuthRequest, response) => resend("email", request, response));
  routes.post("/api/auth/phone/resend", (request: AuthRequest, response) => resend("phone", request, response));
  async function verify(channel: "email" | "phone", request: AuthRequest, response: Response) {
    noStore(response);
    try {
      const input = body(request, ["attemptToken", "code"]);
      if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) throw new VerificationRequestError("invalid_verification");
      let loaded = await read(input.attemptToken, request);
      if (loaded.attempt.channel !== channel) throw new VerificationRequestError("invalid_verification");
      if (loaded.attempt.phase === "verified") {
        if (channel === "email") { response.json({ status: "verified" }); return; }
        await finishPhone(loaded, request, response); return;
      }
      if (loaded.attempt.checkCount >= 5 || (loaded.attempt.phase !== "sent" && loaded.attempt.phase !== "send_unknown")) throw new VerificationRequestError("invalid_verification");
      const previousPhase = loaded.attempt.phase;
      await reserve(request, loaded.attempt, false);
      loaded = await update(loaded, { phase: "verifying", checkCount: loaded.attempt.checkCount + 1 });
      const verified = matchesVerificationCode({ ...codeBinding(loaded.attempt, loaded.payload, input.code), digest: loaded.payload.codeDigest });
      if (!verified) { await update(loaded, { phase: previousPhase === "send_unknown" ? "send_unknown" : loaded.attempt.checkCount >= 5 ? "send_rejected" : "sent" }); throw new VerificationRequestError("invalid_verification"); }
      loaded = await update(loaded, { phase: "verified" }); event(request, "verified", channel);
      if (channel === "email") { response.json({ status: "verified" }); return; }
      await finishPhone(loaded, request, response);
    } catch (error) { errorResponse(response, error); }
  }
  routes.post("/api/auth/email/verify", (request: AuthRequest, response) => verify("email", request, response));
  routes.post("/api/auth/phone/verify", (request: AuthRequest, response) => verify("phone", request, response));
  routes.post("/api/auth/register", async (request: AuthRequest, response) => {
    noStore(response);
    try {
      if (request.user) throw new VerificationRequestError("sign_out_required");
      const input = body(request, ["attemptToken", "displayName", "password", "timeZone"]), details = profile(input);
      if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 128) throw new VerificationRequestError("invalid_verification");
      const loaded = await read(input.attemptToken, request), attempt = loaded.attempt;
      if (attempt.channel !== "email" || attempt.intent !== "register" || attempt.phase !== "verified") throw new VerificationRequestError("invalid_verification");
      const user = await finalize({ tokenHash: attempt.tokenHash, browserHash: attempt.browserHash, expectedVersion: attempt.version,
        ...details, email: loaded.payload.address, passwordHash: await hashPassword(input.password), invitation: await invitation(loaded.payload.invitationCode) });
      await issueSession(user, response); clearBrowser(response); event(request, "registered", "email", user.id);
      response.status(201).json(registrationResponse(user));
    } catch (error) { errorResponse(response, error); }
  });
  routes.post("/api/auth/phone/complete", async (request: AuthRequest, response) => {
    noStore(response);
    try {
      if (request.user) throw new VerificationRequestError("sign_out_required");
      const input = body(request, ["attemptToken", "displayName", "timeZone"]), details = profile(input), loaded = await read(input.attemptToken, request);
      const attempt = loaded.attempt;
      if (attempt.channel !== "phone" || attempt.intent === "link" || attempt.phase !== "verified") throw new VerificationRequestError("invalid_verification");
      const user = await finalize({ tokenHash: attempt.tokenHash, browserHash: attempt.browserHash, expectedVersion: attempt.version,
        ...details, email: null, passwordHash: null, phoneBinding: phoneBinding(loaded), invitation: await invitation(loaded.payload.invitationCode) });
      await issueSession(user, response); clearBrowser(response); event(request, "registered", "phone", user.id);
      response.status(201).json({ returnTo: loaded.payload.returnTo });
    } catch (error) { errorResponse(response, error); }
  });
  return routes;
}
