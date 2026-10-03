import { useEffect, useRef, useState } from "react";
import { ApiError, getAccountSignInMethods, startProviderSignIn, type SignInProviderId } from "../api";
import { providerSignInErrorMessage, validateProviderReturnTo } from "../providerSignInLink";
import { Dialog } from "./FieldLedgerPrimitives";
import { PhoneSignIn } from "../PhoneSignIn";
import { openAccountBrowser, providerDestination } from "../platform";

export function SignInMethodsDialog({ onClose, onNavigate = openAccountBrowser }: {
  onClose(): void; onNavigate?(url: string): void;
}) {
  const [providers, setProviders] = useState<Array<{ id: SignInProviderId; label: string; linked: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [checkRevision, setCheckRevision] = useState(0);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState<SignInProviderId | null>(null);
  const [phone, setPhone] = useState({ enabled: false, linked: false, maskedNumber: null as string | null });
  const [phoneBusy, setPhoneBusy] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true); setError("");
    void getAccountSignInMethods(abort.signal).then(result => {
      if (active) { setProviders(result.providers); setPhone(result.phone); }
    }).catch(() => { if (active) setError("We couldn't load your sign-in methods. Your current sign-in method still works."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; abort.abort(); };
  }, [checkRevision]);

  async function link(provider: { id: SignInProviderId; linked: boolean }) {
    if (pending.current || phoneBusy || loading || provider.linked) return;
    pending.current = true; setStarting(provider.id); setError("");
    try {
      const result = await startProviderSignIn(provider.id, { intent: "link", returnTo: validateProviderReturnTo(window.location.pathname) });
      if (!mounted.current) return;
      const url = providerDestination(provider.id, result.authorizationUrl);
      if (!url) throw new Error("Invalid provider destination.");
      onNavigate(url);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && providerSignInErrorMessage(cause.code) ||
        "We couldn't start linking this sign-in method. Your existing methods still work. Try again when you're ready.");
    } finally { pending.current = false; if (mounted.current) setStarting(null); }
  }

  return <Dialog title="Sign-in methods" onClose={onClose}>
    <div className="ll-form ll-sign-in-methods">
      <p>Add another way to sign in to this LifeLinks account. Your records stay with this account.</p>
      <p className="ll-muted">Linking a sign-in method doesn't connect your calendar or give an agent access.</p>
      {loading ? <p role="status">Loading sign-in methods…</p> : providers.length ?
        <ul className="ll-sign-in-method-list">{providers.map(provider => <li key={provider.id}>
          <strong>{provider.label}</strong>
          {provider.linked ? <span className="ll-muted">Linked</span> : <button type="button" className="ll-button" disabled={starting !== null || phoneBusy}
            onClick={() => void link(provider)}>{starting === provider.id ? `Opening ${provider.label}…` : `Link ${provider.label}`}</button>}
        </li>)}</ul> : !error && !phone.enabled && !phone.linked && <p>No additional sign-in methods are available yet.</p>}
      {!loading && phone.linked && <p className="provider-sign-in-profile"><strong>Phone number</strong><span>Linked{phone.maskedNumber ? ` · ${phone.maskedNumber}` : ""}</span></p>}
      {!loading && !phone.linked && phone.enabled && <PhoneSignIn intent="link" returnTo={window.location.pathname} enabled={phone.enabled}
        disabled={starting !== null} onBusyChange={setPhoneBusy} onLinked={() => setCheckRevision(value => value + 1)} />}
      {error && <p className="ll-inline-warning" role="alert">{error}</p>}
      {!loading && <button type="button" className="ll-text-button" disabled={starting !== null || phoneBusy} onClick={() => setCheckRevision(value => value + 1)}>Refresh sign-in methods</button>}
    </div>
  </Dialog>;
}
