import { afterEach, describe, expect, it, vi } from "vitest";
import { captureProviderSignInLink, clearPendingProviderSignup, clearPendingProviderLink, clearProviderSignInError, navigateProviderReturnTo,
  providerAuthorizationUrl, providerSignInErrorMessage, readPendingProviderSignup, readPendingProviderLink, readProviderSignInError,
  validateProviderReturnTo } from "./providerSignInLink";
import { completeProviderLink, completeProviderSignup, getAccountSignInMethods, getProviderSignupDetails, getSignInProviders, startProviderSignIn } from "./api";

afterEach(() => { clearPendingProviderSignup(); clearPendingProviderLink(); clearProviderSignInError(); vi.unstubAllGlobals(); });

describe("provider callback state", () => {
  const token = "synthetic_signup_".padEnd(43, "x");
  const history = () => ({ state: { existing: true }, replaceState: vi.fn() });

  it("captures a signup token only in memory and removes it from history before React mounts", () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage); vi.stubGlobal("sessionStorage", storage);
    const target = history();
    captureProviderSignInLink({ pathname: "/register", search: "?returnTo=%2Fcalendar", hash: `#signup=${token}` }, target);
    expect(readPendingProviderSignup()).toBe(token);
    expect(target.replaceState).toHaveBeenCalledWith(target.state, "", "/register?returnTo=%2Fcalendar");
    expect(storage.setItem).not.toHaveBeenCalled();
    // StrictMode re-reads memory; it does not consume the one-use token on render.
    expect(readPendingProviderSignup()).toBe(token);
    clearPendingProviderSignup(); expect(readPendingProviderSignup()).toBe("");
  });

  it.each([
    { pathname: "/life-links", hash: `#signup=${token}` },
    { pathname: "/register", hash: "#signup=too_short" },
    { pathname: "/register", hash: `#signup=${token}&extra=untrusted` }
  ])("scrubs invalid or misplaced signup callbacks without accepting a token", location => {
    const target = history();
    captureProviderSignInLink({ ...location, search: "" }, target);
    expect(readPendingProviderSignup()).toBe("");
    expect(target.replaceState).toHaveBeenCalledWith(target.state, "", location.pathname);
  });

  it("accepts only closed error codes and never displays raw callback content", () => {
    const target = history();
    captureProviderSignInLink({ pathname: "/life-links", search: "", hash: "#signin_error=signup_failed" }, target);
    expect(readProviderSignInError()).toBe("signup_failed");
    expect(providerSignInErrorMessage(readProviderSignInError())).toBe("We couldn't create your account. If you already have one, sign in with your existing method and link this provider in Sign-in methods.");
    captureProviderSignInLink({ pathname: "/life-links", search: "", hash: "#signin_error=untrusted_identity@example.test" }, target);
    expect(readProviderSignInError()).toBe("");
    expect(providerSignInErrorMessage("untrusted_identity@example.test")).toBe("");
    expect(target.replaceState).toHaveBeenCalledTimes(2);
  });

  it("discards retired account-discovery errors without displaying an account-existence claim", () => {
    const target = history();
    captureProviderSignInLink({ pathname: "/life-links", search: "", hash: "#signin_error=account_exists" }, target);
    expect(readProviderSignInError()).toBe("");
    expect(providerSignInErrorMessage("account_exists")).toBe("");
    expect(target.replaceState).toHaveBeenCalledWith(target.state, "", "/life-links");
  });

  it("captures a browser-bound link continuation only at the root route and keeps it out of storage", () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal("localStorage", storage); vi.stubGlobal("sessionStorage", storage);
    const target = history();
    captureProviderSignInLink({ pathname: "/", search: "", hash: `#link=${token}` }, target);
    expect(readPendingProviderLink()).toBe(token);
    expect(target.replaceState).toHaveBeenCalledWith(target.state, "", "/");
    expect(storage.setItem).not.toHaveBeenCalled();
    captureProviderSignInLink({ pathname: "/life-links", search: "", hash: `#link=${token}` }, target);
    expect(readPendingProviderLink()).toBe("");
    captureProviderSignInLink({ pathname: "/", search: "", hash: "#link=invalid" }, target);
    expect(readPendingProviderLink()).toBe("");
    expect(target.replaceState).toHaveBeenCalledTimes(3);
  });

  it("preserves ordinary fragments and clears obsolete callback state on a new outcome", () => {
    const target = history();
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, target);
    captureProviderSignInLink({ pathname: "/life-links", search: "", hash: "#signin_error=signin_failed" }, target);
    expect(readPendingProviderSignup()).toBe("");
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, target);
    expect(readProviderSignInError()).toBe("");
    target.replaceState.mockClear();
    captureProviderSignInLink({ pathname: "/register", search: "", hash: "#ordinary-section" }, target);
    expect(target.replaceState).not.toHaveBeenCalled();
  });
});

describe("provider navigation", () => {
  it.each([
    ["google", "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic"],
    ["microsoft", "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=synthetic"],
    ["facebook", "https://www.facebook.com/v24.0/dialog/oauth?state=synthetic"],
    ["apple", "https://appleid.apple.com/auth/authorize?state=synthetic"],
    ["github", "https://github.com/login/oauth/authorize?state=synthetic"],
    ["chatgpt", "https://auth.openai.com/oauth/authorize?state=synthetic"]
  ])("accepts the selected %s provider's exact HTTPS origin", (provider, url) => {
    expect(providerAuthorizationUrl(provider, url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)", "http://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com.evil.test/auth", "https://accounts.google.com@evil.test/auth",
    "https://user:password@accounts.google.com/auth", "https://accounts.google.com:8443/auth",
    "https://accounts.google.com./auth", "https://accounts.google.com/auth#secret", "//accounts.google.com/auth",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
  ])("rejects an unapproved authorization destination %s", url => {
    expect(providerAuthorizationUrl("google", url)).toBeNull();
  });

  it("reuses owned app routes and performs full navigation for server-owned consent", () => {
    const navigate = vi.fn();
    expect(validateProviderReturnTo("/calendar/event_1?untrusted=ignored")).toBe("/calendar/event_1");
    navigateProviderReturnTo("/agent-authorize/opaque_request", navigate);
    expect(navigate).toHaveBeenCalledWith("/agent-authorize/opaque_request");
    for (const path of ["https://evil.test", "//evil.test", "/api/auth/logout", "/\\evil.test", "/register", "/calendar/../api/auth/logout"]) {
      expect(validateProviderReturnTo(path)).toBe("/life-links");
    }
  });
});

describe("provider API transport", () => {
  it("keeps invitation and signup credentials in cookie-authenticated POST bodies", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ providers: [], authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", returnTo: "/life-links" })));
    vi.stubGlobal("fetch", fetchMock);
    const start = { intent: "register" as const, returnTo: "/calendar", invitationCode: "i".repeat(43), timeZone: "America/New_York" };
    const complete = { signupToken: "s".repeat(43), displayName: "Private Owner", timeZone: "America/New_York" };
    await getSignInProviders(); await startProviderSignIn("google", start);
    await getProviderSignupDetails(complete.signupToken); await completeProviderSignup(complete); await getAccountSignInMethods();
    await completeProviderLink("l".repeat(43));
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path]) => path)).toEqual(["/api/auth/providers", "/api/auth/providers/google/start", "/api/auth/provider-signup/details", "/api/auth/provider-signup/complete", "/api/account-sign-in-methods", "/api/auth/provider-link/complete"]);
    expect(calls.every(([, init]) => init.credentials === "include" && !new Headers(init.headers).has("X-Life-Links-Actor"))).toBe(true);
    expect(calls.slice(1, 4).every(([, init]) => init.method === "POST")).toBe(true);
    expect(JSON.parse(calls[1][1].body as string)).toEqual(start);
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ signupToken: complete.signupToken });
    expect(JSON.parse(calls[3][1].body as string)).toEqual(complete);
    expect(calls[5][1].method).toBe("POST");
    expect(JSON.parse(calls[5][1].body as string)).toEqual({ linkToken: "l".repeat(43) });
    expect(calls.every(([path]) => !path.includes(complete.signupToken) && !path.includes(start.invitationCode))).toBe(true);
  });
});
