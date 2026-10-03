import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Phone } from "lucide-react";
import { LIFE_LINKS_SMS_VERIFICATION_CONSENT } from "@life-links/core";
import { ApiError, completePhoneSignup, getRegistration, resendPhoneVerification, startPhoneVerification,
  verifyPhoneVerification, type VerificationAttempt } from "./api";
import { clearPendingInvitation } from "./invitationLink";
import { validateProviderReturnTo } from "./providerSignInLink";
import { PhoneNumberEntry } from "./PhoneNumberEntry";
import { navigateAccountReturn } from "./platform";

export interface PhoneSignInProps {
  intent: "login" | "register" | "link";
  returnTo: string;
  invitationCode?: string;
  enabled?: boolean;
  disabled?: boolean;
  onComplete?: (path: string) => void;
  onLinked?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

type EntryStep = "closed" | "number" | "code" | "profile";

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function verificationError(cause: unknown, action: "send" | "verify" | "complete", intent: PhoneSignInProps["intent"]): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case "verification_unavailable": return "Phone sign-in isn't available right now. Use another sign-in method.";
      case "invalid_verification": return "That code couldn't be verified. Check it and try again.";
      case "verification_rate_limited": return "Too many attempts. Wait a little before trying again.";
      case "send_outcome_unknown": return "We couldn't confirm whether a code was sent. Check your messages before requesting another code.";
    }
  }
  if (action === "send") return "We couldn't confirm whether a code was sent. Check your messages before requesting another code.";
  if (action === "complete") return "We couldn't confirm whether your account was created. Try signing in with this phone number before creating it again.";
  if (intent === "link") return "We couldn't confirm whether this phone number was linked. Check Sign-in methods before trying again.";
  return "We couldn't confirm sign-in. Try signing in with this phone number before starting again.";
}

export function PhoneSignIn({ intent, returnTo, invitationCode, enabled, disabled = false,
  onComplete = navigateAccountReturn, onLinked, onBusyChange }: PhoneSignInProps) {
  const id = useId();
  const [available, setAvailable] = useState(enabled === true);
  const [step, setStep] = useState<EntryStep>("closed");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [attempt, setAttempt] = useState<VerificationAttempt | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const frozen = disabled || busy;
  const resendSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const expired = attempt !== null && Date.parse(attempt.expiresAt) <= now;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pending.current) busyCallback.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (enabled !== undefined) { setAvailable(enabled); return; }
    let active = true;
    setAvailable(false);
    void getRegistration().then(result => {
      if (active) setAvailable(result.phoneVerificationEnabled === true && (intent !== "register" || result.enabled));
    }).catch(() => { /* Other sign-in methods remain available. */ });
    return () => { active = false; };
  }, [enabled, intent]);

  useEffect(() => {
    if (!attempt || (step !== "code" && step !== "profile")) return;
    const currentTime = Date.now();
    const finalChangeAt = Math.max(cooldownUntil, Date.parse(attempt.expiresAt));
    setNow(currentTime);
    if (currentTime >= finalChangeAt) return;
    const timer = window.setInterval(() => {
      const tickTime = Date.now(); setNow(tickTime);
      if (tickTime >= finalChangeAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, cooldownUntil, step]);

  function clearEntry() {
    setAttempt(null); setCode(""); setPhoneNumber(""); setDisplayName("");
    setSmsConsent(false); setCooldownUntil(0); setError(""); setStep("closed");
  }

  function restartVerification() {
    if (pending.current || disabled) return;
    setAttempt(null); setCode(""); setDisplayName("");
    setSmsConsent(false); setCooldownUntil(0); setError(""); setStep("number");
  }

  function acceptAttempt(result: VerificationAttempt) {
    if (!result.attemptToken || !Number.isFinite(Date.parse(result.expiresAt)) ||
      !Number.isFinite(result.resendAfterSeconds) || result.resendAfterSeconds < 0) throw new Error("Invalid verification response.");
    const receivedAt = Date.now();
    const resendDeadline = receivedAt + Math.ceil(result.resendAfterSeconds) * 1000;
    if (!Number.isSafeInteger(resendDeadline)) throw new Error("Invalid verification response.");
    setAttempt(result); setCode(""); setCooldownUntil(resendDeadline);
    setNow(receivedAt); setStep("code");
  }

  function complete(path: string) {
    clearEntry(); clearPendingInvitation(); onComplete(validateProviderReturnTo(path));
  }

  function beginRequest() {
    pending.current = true; setBusy(true); setError(""); busyCallback.current?.(true);
  }

  function finishRequest() {
    pending.current = false;
    if (mounted.current) { setBusy(false); busyCallback.current?.(false); }
  }

  async function sendCode() {
    if (pending.current || disabled) return;
    if (!smsConsent) { setError("Select SMS verification consent before requesting a code."); return; }
    const normalized = phoneNumber.replace(/[\s()-]/g, "");
    if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
      setError("Enter your phone number with a country code, such as +1 555 123 4567."); return;
    }
    beginRequest();
    try {
      const invitation = invitationCode?.trim() ?? "";
      const result = await startPhoneVerification({ phoneNumber: normalized, intent, returnTo: validateProviderReturnTo(returnTo),
        smsConsent: true, smsConsentVersion: LIFE_LINKS_SMS_VERIFICATION_CONSENT.version,
        ...(intent === "register" && /^[A-Za-z0-9_-]{32,128}$/.test(invitation) ? { invitationCode: invitation } : {}) });
      if (!mounted.current) return;
      setPhoneNumber(normalized); acceptAttempt(result);
    } catch (cause) { if (mounted.current) setError(verificationError(cause, "send", intent)); }
    finally { finishRequest(); }
  }

  async function resendCode() {
    if (pending.current || disabled || !attempt || cooldownUntil > Date.now()) return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); return; }
    beginRequest();
    try {
      const result = await resendPhoneVerification(attempt.attemptToken);
      if (mounted.current) acceptAttempt(result);
    } catch (cause) { if (mounted.current) setError(verificationError(cause, "send", intent)); }
    finally { finishRequest(); }
  }

  async function verifyCode() {
    if (pending.current || disabled || !attempt) return;
    if (!/^[0-9]{6}$/.test(code)) { setError("Enter the six-digit verification code."); return; }
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); setError("This code has expired. Request a new code to continue."); return; }
    beginRequest();
    try {
      const result = await verifyPhoneVerification(attempt.attemptToken, code);
      if (!mounted.current) return;
      if (intent === "link" && result.status === "linked") { clearEntry(); onLinked?.(); }
      else if (intent !== "link" && result.status === "signed_in") complete(result.returnTo);
      else if (intent !== "link" && result.status === "profile_required") { setCode(""); setStep("profile"); }
      else setError("We couldn't complete this phone sign-in. Use another sign-in method or start again.");
    } catch (cause) { if (mounted.current) setError(verificationError(cause, "verify", intent)); }
    finally { finishRequest(); }
  }

  async function createAccount() {
    if (pending.current || disabled || !attempt || step !== "profile" || intent === "link") return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); return; }
    const name = displayName.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) { setError("Enter a display name of up to 100 characters."); return; }
    beginRequest();
    try {
      const result = await completePhoneSignup({ attemptToken: attempt.attemptToken, displayName: name, timeZone: browserTimeZone() });
      if (mounted.current) complete(result.returnTo);
    } catch (cause) { if (mounted.current) setError(verificationError(cause, "complete", intent)); }
    finally { finishRequest(); }
  }

  function enter(event: KeyboardEvent<HTMLInputElement>, action: () => Promise<void>) {
    if (event.key === "Enter") { event.preventDefault(); void action(); }
  }

  if (!available) return null;
  if (step === "closed") return <button type="button" className="secondary-button provider-sign-in-button"
    data-provider="phone" disabled={disabled} onClick={() => { setError(""); setStep("number"); }}>
    <Phone size={18} aria-hidden="true" /><span>{intent === "link" ? "Link phone number" : "Continue with phone"}</span>
  </button>;

  return <div className="verification-entry" aria-label={intent === "link" ? "Link phone number" : "Phone sign-in"}>
    {expired ? <>
      <p className="account-entry-help" role="status">This verification has expired. Start again to request a new code.</p>
      <button type="button" className="primary-button" disabled={frozen} onClick={restartVerification}>Start again</button>
    </> : step === "number" ? <PhoneNumberEntry phoneNumber={phoneNumber} smsConsent={smsConsent}
      disabled={frozen} busy={busy} onPhoneNumberChange={setPhoneNumber} onSmsConsentChange={setSmsConsent}
      onSendCode={() => void sendCode()} /> : step === "code" ? <>
      <p className="account-entry-help">Enter the six-digit verification code for {phoneNumber}.</p>
      <label htmlFor={`${id}-code`}><span>Verification code</span><input id={`${id}-code`} name="phoneVerificationCode"
        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={frozen || expired}
        onChange={event => setCode(event.target.value)} onKeyDown={event => enter(event, verifyCode)} /></label>
      <div className="verification-code-actions">
        <button type="button" className="primary-button" disabled={frozen || expired} onClick={() => void verifyCode()}>{busy ? "Working…" : "Verify code"}</button>
        <button type="button" className="secondary-button" disabled={frozen || resendSeconds > 0} onClick={() => void resendCode()}>
          {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}</button>
      </div>
    </> : step === "profile" && <>
      <p className="account-entry-help">Your phone number is verified. Add your name to finish creating your account.</p>
      <label htmlFor={`${id}-name`}><span>Display name</span><input id={`${id}-name`} name="displayName" autoComplete="name"
        maxLength={100} value={displayName} disabled={frozen} onChange={event => setDisplayName(event.target.value)}
        onKeyDown={event => enter(event, createAccount)} /></label>
      <button type="button" className="primary-button" disabled={frozen} onClick={() => void createAccount()}>{busy ? "Creating account…" : "Create account"}</button>
    </>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    <button type="button" className="secondary-button" disabled={frozen} onClick={clearEntry}>Cancel</button>
  </div>;
}
