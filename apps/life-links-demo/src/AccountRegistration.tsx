import { useEffect, useRef, useState } from "react";
import { getRegistration, type AccountRegistrationInput, type ApiUser } from "./api";
import { LifeLinksGlyph } from "./owner/FieldLedgerPrimitives";
import { PublicInformationLinks } from "./PublicInformation";
import { accountRegistrationPath, accountRegistrationReturnPath } from "./workspace/routes";

export function AccountCreationLink({ returnTo }: { returnTo: string }) {
  return <div className="account-entry-help">
    <p>Have private test-account invitation instructions?</p>
    <a href={accountRegistrationPath(returnTo)}>Create a private test account</a>
    <p>The shared demo contains examples. Use a separate private account for your own information, agent, or calendar.</p>
  </div>;
}

export function AccountRegistration({ pathname, currentUser, busy, error, onRegister, onLogout, onComplete }: {
  pathname: string;
  currentUser: ApiUser | null;
  busy: boolean;
  error: string;
  onRegister(input: AccountRegistrationInput): Promise<boolean>;
  onLogout(): Promise<void>;
  onComplete(path: string): void;
}) {
  const returnTo = accountRegistrationReturnPath(pathname);
  const [availability, setAvailability] = useState<"loading" | "enabled" | "disabled" | "error">("loading");
  const [checkRevision, setCheckRevision] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setAvailability("loading");
    void getRegistration().then((result) => {
      if (active) setAvailability(result.enabled ? "enabled" : "disabled");
    }).catch(() => { if (active) setAvailability("error"); });
    return () => { active = false; };
  }, [checkRevision]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || busy || currentUser || availability !== "enabled") return;
    if (!displayName.trim() || displayName.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(displayName) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 ||
        password.length < 12 || password.length > 128 || !/^[A-Za-z0-9_-]{32,128}$/.test(invitationCode.trim())) {
      setFormError("Enter your name, a valid email, a 12–128 character password, and the invitation code from your private instructions.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("The passwords do not match.");
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setFormError("");
    let timeZone = "UTC";
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* Server accepts UTC. */ }
    try {
      const created = await onRegister({ displayName: displayName.trim(), email: email.trim(), password, invitationCode: invitationCode.trim(), timeZone });
      if (created) {
        setPassword(""); setConfirmPassword(""); setInvitationCode("");
        // Server-owned OAuth consent must be fetched from the server, not pushed
        // into the SPA. The same navigation restores QR and ordinary app routes.
        onComplete(returnTo);
      }
    } catch {
      setFormError("We couldn't confirm account creation. Try signing in before submitting again.");
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return <main className="login-shell registration-shell">
    <h1 className="ll-brand ll-login-brand">LifeLinks <LifeLinksGlyph /></h1>
    <section className="login-panel registration-panel" aria-labelledby="registration-title">
      <h2 id="registration-title">Create a private test account</h2>
      <p>A separate workspace for your own information. It starts empty, with a built-in My Calendar—not a copy of the shared demo.</p>
      {currentUser && !submitting ? <div className="account-entry-help">
        <p>Currently signed in as <strong>{currentUser.email}</strong>.</p>
        <p>To create a separate account, sign out first. Continuing uses the account shown above.</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void onLogout()}>Sign out to create a private account</button>
        <a href={returnTo}>Continue with this account</a>
      </div> : <>
        {availability === "loading" && <p role="status">Checking invitation availability…</p>}
        {availability === "disabled" && <p role="status">New account invitations are currently unavailable. Existing accounts can still sign in.</p>}
        {availability === "error" && <div role="alert"><p>We couldn't check invitation availability. Existing accounts can still sign in.</p>
          <button type="button" className="secondary-button" onClick={() => setCheckRevision((value) => value + 1)}>Check again</button></div>}
        {availability === "enabled" && <form className="registration-form" onSubmit={(event) => void submit(event)}>
          {(formError || error) && <div className="error-banner" role="alert">{formError || error}</div>}
          <label><span>Display name</span><input name="displayName" required maxLength={100} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting || busy} /></label>
          <label><span>Email</span><input name="email" type="email" required maxLength={254} autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting || busy} /></label>
          <label><span>Password</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting || busy} /></label>
          <p className="account-entry-help">Use 12–128 characters. Keep your password safe; email verification and password recovery are not available in this test release.</p>
          <label><span>Confirm password</span><input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting || busy} /></label>
          <label><span>Invitation code</span><input name="invitationCode" type="password" required minLength={32} maxLength={128} autoComplete="off" spellCheck={false} value={invitationCode} onChange={(event) => setInvitationCode(event.target.value)} disabled={submitting || busy} /></label>
          <p className="account-entry-help">Use the code in your private invitation instructions. Do not put it in a link or public submission.</p>
          <button type="submit" className="primary-button" disabled={submitting || busy}>{submitting || busy ? "Creating your account…" : "Create private account"}</button>
        </form>}
        <a href={returnTo}>Already have an account? Sign in</a>
      </>}
      <details className="account-entry-help registration-guide">
        <summary>Try your private account with an agent</summary>
        <ol>
          <li>Open the agent connection settings in your workspace and connect your own compatible agent client. Browser WebMCP needs the LifeLinks page open; remote MCP can work with it closed after account linking.</li>
          <li>Ask: “Create a private Life Link named My test item with the note ‘Packed for my first trip.’ Then read it back.” Follow up with an edit and check the saved result in LifeLinks.</li>
          <li>Optionally test Calendar with your own eligible Google or Outlook account. Provider permissions and app eligibility still apply. Do not connect a personal calendar to the shared demo.</li>
        </ol>
        <p>Connecting an agent or calendar is a separate, explicit step. This form does not copy demo records or grant an agent access.</p>
      </details>
      <PublicInformationLinks />
    </section>
  </main>;
}
