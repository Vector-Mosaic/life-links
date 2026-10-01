import { safeAccountReturnPath } from "./workspace/routes";
import { validateProviderAuthorizationUrl, type ProviderId } from "@vmosaic/provider-sign-in/client";

export type ProviderSignInError = "signin_failed" | "invitation_required" | "signup_failed" | "link_failed";

let pendingProviderSignup = "";
let pendingProviderLink = "";
let providerSignInError: ProviderSignInError | "" = "";

const errorCodes = new Set<ProviderSignInError>(["signin_failed", "invitation_required", "signup_failed", "link_failed"]);

// Capture before React mounts. Callback credentials stay in module memory and
// are removed from this browser history entry, without persistent web storage.
export function captureProviderSignInLink(location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">): void {
  if (location.hash.startsWith("#signup=")) {
    const token = location.hash.slice("#signup=".length);
    providerSignInError = "";
    pendingProviderLink = "";
    pendingProviderSignup = location.pathname.replace(/\/$/, "") === "/register" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
    history.replaceState(history.state, "", location.pathname + location.search);
  } else if (location.hash.startsWith("#link=")) {
    const token = location.hash.slice("#link=".length);
    providerSignInError = "";
    pendingProviderSignup = "";
    pendingProviderLink = location.pathname === "/" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
    history.replaceState(history.state, "", location.pathname + location.search);
  } else if (location.hash.startsWith("#signin_error=")) {
    const code = location.hash.slice("#signin_error=".length);
    pendingProviderSignup = "";
    pendingProviderLink = "";
    providerSignInError = errorCodes.has(code as ProviderSignInError) ? code as ProviderSignInError : "";
    history.replaceState(history.state, "", location.pathname + location.search);
  }
}

export function readPendingProviderSignup(): string { return pendingProviderSignup; }
export function clearPendingProviderSignup(): void { pendingProviderSignup = ""; }
export function readPendingProviderLink(): string { return pendingProviderLink; }
export function clearPendingProviderLink(): void { pendingProviderLink = ""; }
export function readProviderSignInError(): ProviderSignInError | "" { return providerSignInError; }
export function clearProviderSignInError(): void { providerSignInError = ""; }

export function providerSignInErrorMessage(code: string): string {
  switch (code) {
    case "invitation_required": return "Open your invitation link to create a LifeLinks account, or sign in with an existing method.";
    case "signup_failed": return "We couldn't create your account. If you already have one, sign in with your existing method and link this provider in Sign-in methods.";
    case "link_failed": return "We couldn't link that sign-in method. Your existing sign-in methods still work. Try again from Sign-in methods.";
    case "signin_failed": return "We couldn't complete sign-in. Try again or use your existing sign-in method.";
    default: return "";
  }
}

export function providerAuthorizationUrl(providerId: string, value: string): string | null {
  try { return validateProviderAuthorizationUrl(providerId as ProviderId, value); }
  catch { return null; }
}

// Reuse the existing app route owner, including server-owned agent consent.
export function validateProviderReturnTo(path: string): string { return safeAccountReturnPath(path); }
export function navigateProviderReturnTo(path: string, navigate: (path: string) => void = value => window.location.assign(value)): void {
  navigate(validateProviderReturnTo(path));
}
