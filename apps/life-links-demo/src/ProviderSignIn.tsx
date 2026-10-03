import { useEffect, useRef, useState } from "react";
import { providerButtonLabel } from "@vmosaic/provider-sign-in/client";
import { ApiError, getSignInProviders, startProviderSignIn, type SignInProvider, type SignInProviderId } from "./api";
import { providerSignInErrorMessage, validateProviderReturnTo } from "./providerSignInLink";
import { openAccountBrowser, providerDestination } from "./platform";

const googleLogo = new URL("./assets/google-g.png", import.meta.url).href;
const appleLogo = new URL("./assets/apple.svg", import.meta.url).href;

export interface ProviderSignInProps {
  intent: "login" | "register";
  returnTo: string;
  invitationCode?: string;
  timeZone?: string;
  disabled?: boolean;
  onNavigate?: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ProviderSignIn({ intent, returnTo, invitationCode, timeZone, disabled = false,
  onNavigate = openAccountBrowser, onBusyChange }: ProviderSignInProps) {
  const [providers, setProviders] = useState<SignInProvider[]>([]);
  const [starting, setStarting] = useState<SignInProviderId | null>(null);
  const [error, setError] = useState("");
  const [discoveryError, setDiscoveryError] = useState(false);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const invitation = invitationCode?.trim() ?? "";

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (pending.current) busyCallback.current?.(false); };
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setDiscoveryError(false);
    void getSignInProviders(abort.signal).then(result => {
      if (!active) return;
      setProviders(result.providers.filter(provider => {
        try { providerButtonLabel(provider.id); return true; }
        catch { return false; }
      }));
    }).catch(() => { if (active) setDiscoveryError(true); });
    return () => { active = false; abort.abort(); };
  }, [discoveryAttempt]);

  async function start(provider: SignInProvider) {
    if (pending.current || disabled) return;
    pending.current = true;
    busyCallback.current?.(true);
    setStarting(provider.id);
    setError("");
    try {
      const result = await startProviderSignIn(provider.id, {
        intent, returnTo: validateProviderReturnTo(returnTo),
        ...(intent === "register" && /^[A-Za-z0-9_-]{32,128}$/.test(invitation) ? { invitationCode: invitation } : {}),
        ...(timeZone ? { timeZone } : {})
      });
      if (!mounted.current) return;
      const url = providerDestination(provider.id, result.authorizationUrl);
      if (!url) throw new Error("Invalid provider authorization destination.");
      onNavigate(url);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && providerSignInErrorMessage(cause.code) ||
        "We couldn't start sign-in. Try again or use your existing sign-in method.");
    } finally {
      pending.current = false;
      if (mounted.current) { setStarting(null); busyCallback.current?.(false); }
    }
  }

  if (providers.length === 0 && !discoveryError) return null;
  return <div className="provider-sign-in" aria-label="Other sign-in methods">
    {discoveryError && <div className="error-banner" role="alert">
      <p>We couldn't load other sign-in methods. You can try again or use email and password.</p>
      <button type="button" className="secondary-button" disabled={disabled || starting !== null}
        onClick={() => setDiscoveryAttempt(attempt => attempt + 1)}>Try again</button>
    </div>}
      <div className="provider-sign-in-buttons">
        {providers.map(provider => <button key={provider.id} type="button" className="secondary-button provider-sign-in-button"
          data-provider={provider.id}
          disabled={disabled || starting !== null} onClick={() => void start(provider)}>
          {provider.id === "google" && <img className="provider-sign-in-logo" src={googleLogo} alt="" aria-hidden="true" width={20} height={20} />}
          {provider.id === "apple" && <img className="provider-sign-in-logo" src={appleLogo} alt="" aria-hidden="true" width={20} height={20} />}
          <span>{starting === provider.id ? `Opening ${provider.label}…` : providerButtonLabel(provider.id)}</span>
        </button>)}
      </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {providers.length > 0 && <div className="provider-sign-in-divider" aria-hidden="true"><span>or</span></div>}
  </div>;
}
