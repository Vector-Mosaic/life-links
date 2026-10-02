import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, resendEmailVerification, startEmailVerification, verifyEmailVerification,
  type AccountRegistrationInput, type VerificationAttempt } from "./api";
import { clearPendingInvitation } from "./invitationLink";
import { safeAccountReturnPath } from "./workspace/routes";

export interface EmailRegistrationProps {
  enabled: boolean;
  returnTo: string;
  invitationCode?: string;
  busy: boolean;
  error: string;
  onRegister(input: AccountRegistrationInput): Promise<boolean>;
  onComplete(path: string): void;
  onBusyChange?(busy: boolean): void;
}

type Phase = "email" | "code" | "profile" | "complete";
type Operation = "send" | "resend" | "verify" | "register";

function verificationError(error: unknown, operation: Operation): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "verification_unavailable": return "Email signup is temporarily unavailable. Use another available sign-in method, or try again later.";
      case "invalid_verification": return "That code is invalid or expired. Check your email, or request a new code.";
      case "verification_rate_limited": return "Too many attempts. Wait before trying again.";
      case "send_outcome_unknown": return "We couldn't confirm that the email was sent. Check your inbox before requesting another code.";
    }
  }
  return operation === "verify" ? "We couldn't verify your email. Try again with the latest code."
    : "We couldn't confirm that the email was sent. Check your inbox before requesting another code.";
}

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function EmailRegistration({ enabled, ...props }: EmailRegistrationProps) {
  return enabled ? <EmailRegistrationForm {...props} /> : null;
}

function EmailRegistrationForm({ returnTo, invitationCode, busy, error, onRegister, onComplete, onBusyChange }: Omit<EmailRegistrationProps, "enabled">) {
  const [destination] = useState(() => safeAccountReturnPath(returnTo));
  const [initialInvitation] = useState(() => /^[A-Za-z0-9_-]{32,128}$/.test(invitationCode ?? "") ? invitationCode : undefined);
  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [attempt, setAttempt] = useState<VerificationAttempt | null>(null);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [registrationError, setRegistrationError] = useState("");
  const [working, setWorking] = useState<Operation | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const pending = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const locked = busy || working !== null;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expired = attempt !== null && Date.parse(attempt.expiresAt) <= now;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; if (pending.current) busyCallback.current?.(false); pending.current = false; };
  }, []);
  useEffect(() => {
    if (!attempt || (phase !== "code" && phase !== "profile")) return;
    const currentTime = Date.now();
    const finalChangeAt = Math.max(resendAt, Date.parse(attempt.expiresAt));
    setNow(currentTime);
    if (currentTime >= finalChangeAt) return;
    const timer = window.setInterval(() => {
      const sampledNow = Date.now();
      setNow(sampledNow);
      if (sampledNow >= finalChangeAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, phase, resendAt]);

  function begin(operation: Operation): number | null {
    if (pending.current || busy || !mounted.current) return null;
    pending.current = true;
    busyCallback.current?.(true);
    setWorking(operation);
    setFormError("");
    setRegistrationError("");
    return ++revision.current;
  }
  function current(operationRevision: number): boolean { return mounted.current && revision.current === operationRevision; }
  function finish(operationRevision: number): void {
    if (!current(operationRevision)) return;
    pending.current = false;
    busyCallback.current?.(false);
    setWorking(null);
  }
  function acceptAttempt(result: VerificationAttempt): void {
    if (!result.attemptToken || !Number.isFinite(Date.parse(result.expiresAt)) ||
      !Number.isFinite(result.resendAfterSeconds) || result.resendAfterSeconds < 0) throw new Error("Invalid verification response.");
    const receivedAt = Date.now();
    const resendDeadline = receivedAt + Math.ceil(result.resendAfterSeconds) * 1000;
    if (!Number.isSafeInteger(resendDeadline)) throw new Error("Invalid verification response.");
    setAttempt(result);
    setNow(receivedAt);
    setResendAt(resendDeadline);
    setCode("");
    setPhase("code");
  }
  function clearCredentials(retainEmail = false): void {
    setAttempt(null); setCode(""); setPassword(""); setConfirmPassword("");
    setDisplayName(""); if (!retainEmail) setEmail(""); setResendAt(0); setPhase("email");
  }
  function changeEmail(): void {
    if (pending.current || busy) return;
    revision.current += 1;
    clearCredentials();
    setFormError("");
    setRegistrationError("");
  }
  function restartVerification(): void {
    if (pending.current || busy) return;
    revision.current += 1;
    clearCredentials(true); setFormError(""); setRegistrationError("");
  }

  async function send(): Promise<void> {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) {
      setFormError("Enter a valid email address."); return;
    }
    const operationRevision = begin("send");
    if (operationRevision === null) return;
    try {
      const result = await startEmailVerification({ email: address, returnTo: destination,
        ...(initialInvitation ? { invitationCode: initialInvitation } : {}) });
      if (current(operationRevision)) { setEmail(address); acceptAttempt(result); }
    } catch (cause) { if (current(operationRevision)) setFormError(verificationError(cause, "send")); }
    finally { finish(operationRevision); }
  }
  async function resend(): Promise<void> {
    if (!attempt || phase !== "code" || Date.now() < resendAt) return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); return; }
    const operationRevision = begin("resend");
    if (operationRevision === null) return;
    try {
      const result = await resendEmailVerification(attempt.attemptToken);
      if (current(operationRevision)) acceptAttempt(result);
    } catch (cause) { if (current(operationRevision)) setFormError(verificationError(cause, "resend")); }
    finally { finish(operationRevision); }
  }
  async function verify(): Promise<void> {
    if (!attempt) return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); return; }
    if (!/^[0-9]{6}$/.test(code)) { setFormError("Enter the six-digit code from your email."); return; }
    const operationRevision = begin("verify");
    if (operationRevision === null) return;
    try {
      const result = await verifyEmailVerification(attempt.attemptToken, code);
      if (result.status !== "verified") throw new Error("Verification did not complete.");
      if (current(operationRevision)) { setCode(""); setPhase("profile"); }
    } catch (cause) { if (current(operationRevision)) setFormError(verificationError(cause, "verify")); }
    finally { finish(operationRevision); }
  }
  async function register(): Promise<void> {
    if (!attempt || phase !== "profile") return;
    if (Date.parse(attempt.expiresAt) <= Date.now()) { setNow(Date.now()); return; }
    const name = displayName.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(displayName) || password.length < 12 || password.length > 128) {
      setFormError("Enter your name and a 12–128 character password."); return;
    }
    if (password !== confirmPassword) { setFormError("The passwords do not match."); return; }
    const operationRevision = begin("register");
    if (operationRevision === null) return;
    let created = false;
    try {
      created = await onRegister({ attemptToken: attempt.attemptToken, displayName: name, password, timeZone: browserTimeZone() });
      if (current(operationRevision) && !created) setRegistrationError("We couldn't confirm account creation. Try signing in before submitting again.");
    } catch {
      if (current(operationRevision)) setRegistrationError("We couldn't confirm account creation. Try signing in before submitting again.");
    } finally { finish(operationRevision); }
    if (created && current(operationRevision)) {
      clearCredentials(); setPhase("complete"); clearPendingInvitation(); onComplete(destination);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending.current || busy) return;
    if (phase === "email") void send();
    else if (phase === "code") void verify();
    else if (phase === "profile") void register();
  }

  if (phase === "complete") return <p role="status">Your account is ready. Continuing…</p>;

  if (expired) return <div className="registration-form">
    <p className="account-entry-help" role="status">This verification has expired. Start again to request a new email code.</p>
    <button type="button" className="primary-button" disabled={locked} onClick={restartVerification}>Start again</button>
    <button type="button" className="secondary-button" disabled={locked} onClick={changeEmail}>Use a different email</button>
  </div>;

  return <form className="registration-form" onSubmit={submit}>
    {(formError || error || registrationError) && <div className="error-banner" role="alert">{formError || error || registrationError}</div>}
    {phase === "email" ? <>
      <label><span>Email</span><input name="email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} disabled={locked} /></label>
      <p className="account-entry-help">We'll email you a code to verify your address before you create your account.</p>
      <button type="submit" className="primary-button" disabled={locked}>{working === "send" ? "Sending code…" : "Continue with email"}</button>
    </> : phase === "code" ? <>
      <p className="account-entry-help">Enter the code sent to <strong>{email}</strong>. After verification, you'll choose your name and password.</p>
      <label><span>Verification code</span><input name="code" type="text" required inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="one-time-code" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} disabled={locked} /></label>
      <button type="submit" className="primary-button" disabled={locked}>{working === "verify" ? "Verifying email…" : "Verify email"}</button>
      <button type="button" className="secondary-button" disabled={locked || resendSeconds > 0} onClick={() => void resend()}>{working === "resend" ? "Sending another code…" : resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}</button>
      <button type="button" className="secondary-button" disabled={locked} onClick={changeEmail}>Use a different email</button>
    </> : <>
      <p className="account-entry-help">Email verified: <strong>{email}</strong></p>
      <label><span>Display name</span><input name="displayName" required maxLength={100} autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={locked} /></label>
      <label><span>Password</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={locked} /></label>
      <p className="account-entry-help">Use 12–128 characters. Keep your password safe; password recovery is not available yet.</p>
      <label><span>Confirm password</span><input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={locked} /></label>
      <button type="submit" className="primary-button" disabled={locked}>{working === "register" || busy ? "Creating your account…" : "Create private account"}</button>
      <button type="button" className="secondary-button" disabled={locked} onClick={changeEmail}>Use a different email</button>
    </>}
  </form>;
}
