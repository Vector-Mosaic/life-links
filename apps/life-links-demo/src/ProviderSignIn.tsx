import { useEffect, useRef, useState } from "react";
import { providerButtonLabel } from "@vmosaic/provider-sign-in/client";
import { ApiError, getSignInProviders, startProviderSignIn, type SignInProvider, type SignInProviderId } from "./api";
import { providerAuthorizationUrl, providerSignInErrorMessage, validateProviderReturnTo } from "./providerSignInLink";

export interface ProviderSignInProps {
  intent: "login" | "register";
  returnTo: string;
  invitationCode?: string;
  timeZone?: string;
  disabled?: boolean;
  onNavigate?: (url: string) => void;
}

export function ProviderSignIn({ intent, returnTo, invitationCode, timeZone, disabled = false,
  onNavigate = url => window.location.assign(url) }: ProviderSignInProps) {
  const [providers, setProviders] = useState<SignInProvider[]>([]);
  const [starting, setStarting] = useState<SignInProviderId | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  const invitation = invitationCode?.trim() ?? "";
  const needsInvitation = intent === "register" && !/^[A-Za-z0-9_-]{32,128}$/.test(invitation);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    void getSignInProviders(abort.signal).then(result => {
      if (!active) return;
      setProviders(result.providers.filter(provider => {
        try { providerButtonLabel(provider.id); return true; }
        catch { return false; }
      }));
    }).catch(() => { /* Email/password entry remains available. */ });
    return () => { active = false; abort.abort(); };
  }, []);

  async function start(provider: SignInProvider) {
    if (pending.current || disabled || needsInvitation) return;
    pending.current = true;
    setStarting(provider.id);
    setError("");
    try {
      const result = await startProviderSignIn(provider.id, {
        intent, returnTo: validateProviderReturnTo(returnTo),
        ...(intent === "register" ? { invitationCode: invitation } : {}),
        ...(timeZone ? { timeZone } : {})
      });
      if (!mounted.current) return;
      const url = providerAuthorizationUrl(provider.id, result.authorizationUrl);
      if (!url) throw new Error("Invalid provider authorization destination.");
      onNavigate(url);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && providerSignInErrorMessage(cause.code) ||
        "We couldn't start sign-in. Try again or use your existing sign-in method.");
    } finally {
      pending.current = false;
      if (mounted.current) setStarting(null);
    }
  }

  if (providers.length === 0) return null;
  return <div className="provider-sign-in" aria-label="Other sign-in methods">
      <div className="provider-sign-in-buttons">
        {providers.map(provider => <button key={provider.id} type="button" className="secondary-button"
          disabled={disabled || starting !== null || needsInvitation} onClick={() => void start(provider)}>
          {starting === provider.id ? `Opening ${provider.label}…` : providerButtonLabel(provider.id)}
        </button>)}
      </div>
      {needsInvitation && <p className="account-entry-help">Enter your invitation code or open your invitation link to continue.</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </div>;
}
