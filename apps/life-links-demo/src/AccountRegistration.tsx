import { useEffect, useRef, useState } from "react";
import { ApiError, completeProviderSignup, getProviderSignupDetails, getRegistration, type AccountRegistrationInput, type ApiUser } from "./api";
import { LifeLinksGlyph } from "./owner/FieldLedgerPrimitives";
import { PublicInformationLinks } from "./PublicInformation";
import { accountRegistrationPath, accountRegistrationReturnPath } from "./workspace/routes";
import { clearPendingInvitation, readPendingInvitation } from "./invitationLink";
import { ProviderSignIn } from "./ProviderSignIn";
import { EmailRegistration } from "./EmailRegistration";
import { PhoneSignIn } from "./PhoneSignIn";
import { clearPendingProviderSignup, readPendingProviderSignup, providerSignInErrorMessage, validateProviderReturnTo } from "./providerSignInLink";
import { followNativeCallback } from "./platform";

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function AccountCreationLink({ returnTo }: { returnTo: string }) {
  return <div className="account-entry-help">
    <p>New to LifeLinks?</p>
    <a href={accountRegistrationPath(returnTo)}>Create your account</a>
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
  const [signupToken] = useState(readPendingProviderSignup);
  const [availability, setAvailability] = useState<"loading" | "enabled" | "disabled" | "error">("loading");
  const [verification, setVerification] = useState({ email: false, phone: false });
  const [checkRevision, setCheckRevision] = useState(0);
  const [invitationCode] = useState(readPendingInvitation);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  useEffect(() => {
    if (signupToken) return;
    let active = true;
    setAvailability("loading");
    void getRegistration().then((result) => {
      if (active) {
        setAvailability(result.enabled ? "enabled" : "disabled");
        setVerification({ email: result.emailVerificationEnabled, phone: result.phoneVerificationEnabled });
      }
    }).catch(() => { if (active) setAvailability("error"); });
    return () => { active = false; };
  }, [checkRevision, signupToken]);

  async function registerVerifiedAccount(input: AccountRegistrationInput): Promise<boolean> {
    setCreatingAccount(true);
    try {
      const created = await onRegister(input);
      if (!created) setCreatingAccount(false);
      return created;
    } catch (cause) { setCreatingAccount(false); throw cause; }
  }

  return <main className="login-shell registration-shell">
    <h1 className="ll-brand ll-login-brand">LifeLinks <LifeLinksGlyph /></h1>
    <section className="login-panel registration-panel" aria-labelledby="registration-title">
      <h2 id="registration-title">{signupToken ? "Finish creating your account" : "Create your LifeLinks account"}</h2>
      <p>A separate workspace for your own information. It starts empty, with a built-in My Calendar—not a copy of the shared demo.</p>
      {currentUser && !creatingAccount ? <div className="account-entry-help">
        <p>Currently signed in as <strong>{currentUser.email ?? currentUser.displayName}</strong>.</p>
        <p>To create a separate account, sign out first. Continuing uses the account shown above.</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void onLogout()}>Sign out to create a private account</button>
        <a href={returnTo}>Continue with this account</a>
      </div> : signupToken ? <ProviderSignupContinuation signupToken={signupToken} busy={busy} error={error} onComplete={onComplete} /> : <>
        {availability === "loading" && <p role="status">Loading signup options…</p>}
        {availability === "disabled" && <p role="status">New accounts are currently unavailable. Existing accounts can still sign in.</p>}
        {availability === "error" && <div role="alert"><p>We couldn't load signup options. Existing accounts can still sign in.</p>
          <button type="button" className="secondary-button" onClick={() => setCheckRevision((value) => value + 1)}>Check again</button></div>}
        {availability === "enabled" && <div className="registration-options">
          <ProviderSignIn intent="register" returnTo={returnTo} invitationCode={invitationCode} timeZone={browserTimeZone()}
            disabled={busy || phoneBusy || emailBusy || creatingAccount} onBusyChange={setProviderBusy} />
          <PhoneSignIn intent="register" returnTo={returnTo} invitationCode={invitationCode} enabled={verification.phone}
            disabled={busy || emailBusy || providerBusy || creatingAccount} onBusyChange={setPhoneBusy} onComplete={onComplete} />
          {verification.email ? <EmailRegistration enabled={verification.email} returnTo={returnTo} invitationCode={invitationCode}
            busy={busy || phoneBusy || providerBusy} error={error} onBusyChange={setEmailBusy} onRegister={registerVerifiedAccount} onComplete={onComplete} /> :
            <p className="account-entry-help">Email signup is currently unavailable. Choose an available sign-in method above.</p>}
        </div>}
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

function ProviderSignupContinuation({ signupToken, busy, error, onComplete }: {
  signupToken: string; busy: boolean; error: string; onComplete(path: string): void;
}) {
  const [profile, setProfile] = useState<{ displayName: string | null; email: string | null } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [readError, setReadError] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void getProviderSignupDetails(signupToken).then(result => {
      if (!active) return;
      setProfile(result); setDisplayName(result.displayName ?? "");
    }).catch(() => { if (active) setReadError("We couldn't load this signup. Start signup again, or sign in if your account was already created."); });
    return () => { active = false; mounted.current = false; };
  }, [signupToken]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || busy || !profile) return;
    const name = displayName.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      setFormError("Enter your name to finish creating your account."); return;
    }
    pending.current = true; setSubmitting(true); setFormError("");
    try {
      const result = await completeProviderSignup({ signupToken, displayName: name, timeZone: browserTimeZone() });
      if (!mounted.current) return;
      clearPendingProviderSignup(); clearPendingInvitation();
      if (!followNativeCallback(result.nativeCallbackUrl)) onComplete(validateProviderReturnTo(result.returnTo));
    } catch (cause) {
      if (mounted.current) setFormError(cause instanceof ApiError && providerSignInErrorMessage(cause.code) ||
        "We couldn't confirm account creation. Try signing in before submitting again.");
    } finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  }

  if (readError) return <p className="error-banner" role="alert">{readError}</p>;
  if (!profile) return <p role="status">Loading your signup details…</p>;
  return <form className="registration-form" onSubmit={event => void submit(event)}>
    <p className="account-entry-help">Just a few details to finish your private LifeLinks account.</p>
    {(formError || error) && <p className="error-banner" role="alert">{formError || error}</p>}
    {profile.displayName ? <p className="provider-sign-in-profile"><strong>Name</strong><span>{profile.displayName}</span></p> :
      <label><span>Display name</span><input name="displayName" required maxLength={100} autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={submitting || busy} /></label>}
    {profile.email && <p className="provider-sign-in-profile"><strong>Email</strong><span>{profile.email}</span></p>}
    <button type="submit" className="primary-button" disabled={submitting || busy}>{submitting || busy ? "Creating your account…" : "Create private account"}</button>
  </form>;
}
