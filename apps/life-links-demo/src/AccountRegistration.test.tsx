// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountCreationLink, AccountRegistration } from "./AccountRegistration";
import { PublicInformation, privacyParagraphs, termsParagraphs } from "./PublicInformation";
import { completeProviderSignup, getProviderSignupDetails, getRegistration, getSignInProviders, startEmailVerification, type ApiUser } from "./api";
import { captureInvitationLink, clearPendingInvitation, readPendingInvitation, accountInvitationLink } from "./invitationLink";
import { captureProviderSignInLink, clearPendingProviderSignup, clearProviderSignInError, readPendingProviderSignup } from "./providerSignInLink";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(),
  getRegistration: vi.fn(), getSignInProviders: vi.fn(), getProviderSignupDetails: vi.fn(), completeProviderSignup: vi.fn(), startEmailVerification: vi.fn() }));

describe("public private-account registration", () => {
  let container: HTMLDivElement; let root: Root;
  let onRegister: ReturnType<typeof vi.fn>; let onLogout: ReturnType<typeof vi.fn>; let onComplete: ReturnType<typeof vi.fn>;
  const invitation = "invitation_".padEnd(40, "x");
  const token = "synthetic_signup_".padEnd(43, "x");
  beforeEach(() => {
    clearPendingInvitation(); clearPendingProviderSignup(); clearProviderSignInError();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRegistration).mockReset().mockResolvedValue({ enabled: true, emailVerificationEnabled: true, phoneVerificationEnabled: false });
    vi.mocked(getSignInProviders).mockReset().mockResolvedValue({ providers: [] });
    vi.mocked(getProviderSignupDetails).mockReset().mockResolvedValue({ displayName: null, email: "provider@example.test" });
    vi.mocked(completeProviderSignup).mockReset().mockResolvedValue({ returnTo: "/collections" });
    vi.mocked(startEmailVerification).mockReset().mockResolvedValue({ attemptToken: "a".repeat(43), expiresAt: "2099-01-01T00:00:00Z", resendAfterSeconds: 30 });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    onRegister = vi.fn().mockResolvedValue(true); onLogout = vi.fn().mockResolvedValue(undefined); onComplete = vi.fn();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(pathname = "/register", currentUser: ApiUser | null = null, error = "") {
    await act(async () => root.render(<AccountRegistration pathname={pathname} currentUser={currentUser} busy={false} error={error}
      onRegister={onRegister} onLogout={onLogout} onComplete={onComplete} />));
  }
  async function fill(name: string, value: string) {
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

  it("starts public email verification without an invitation, profile, password or account write", async () => {
    await render("/register?returnTo=%2Fcalendar");
    for (const name of ["invitationCode", "displayName", "password"]) expect(container.querySelector(`input[name="${name}"]`)).toBeNull();
    expect(container.textContent).toContain("Create your LifeLinks account");
    await fill("email", " person@example.test "); await submit();
    expect(startEmailVerification).toHaveBeenCalledExactlyOnceWith({ email: "person@example.test", returnTo: "/calendar" });
    expect(container.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull(); expect(onRegister).not.toHaveBeenCalled();
  });

  it("keeps a scrubbed shared invitation optional and out of browser storage", async () => {
    const history = { state: null, replaceState: vi.fn() }; const storage = vi.spyOn(Storage.prototype, "setItem");
    captureInvitationLink({ pathname: "/register", search: "?returnTo=%2Fcollections", hash: `#invite=${invitation}` }, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/register?returnTo=%2Fcollections");
    expect(accountInvitationLink(invitation, "https://lifelinks.example.test")).toBe(`https://lifelinks.example.test/register#invite=${invitation}`);
    expect(readPendingInvitation()).toBe(invitation);
    await render(); await fill("email", "person@example.test"); await submit();
    expect(startEmailVerification).toHaveBeenCalledWith({ email: "person@example.test", returnTo: "/life-links", invitationCode: invitation });
    expect(container.querySelector('input[name="invitationCode"]')).toBeNull(); expect(storage).not.toHaveBeenCalled();
  });

  it("scrubs malformed invitation fragments and leaves public signup available", async () => {
    const history = { state: null, replaceState: vi.fn() };
    captureInvitationLink({ pathname: "/register", search: "", hash: "#invite=bad&extra=private" }, history);
    expect(readPendingInvitation()).toBe(""); expect(history.replaceState).toHaveBeenCalledWith(null, "", "/register");
    await render(); expect(container.querySelector('input[name="email"]')).not.toBeNull();
  });

  it("finishes a provider signup with its missing name and no editable email override", async () => {
    const history = { state: null, replaceState: vi.fn() };
    captureInvitationLink({ pathname: "/register", search: "", hash: `#invite=${invitation}` }, history);
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, history);
    const storage = vi.spyOn(Storage.prototype, "setItem"); await render();
    expect(getRegistration).not.toHaveBeenCalled(); expect(getSignInProviders).not.toHaveBeenCalled();
    expect(getProviderSignupDetails).toHaveBeenCalledExactlyOnceWith(token);
    expect(container.querySelector('input[type="password"]')).toBeNull(); expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(container.textContent).toContain("provider@example.test"); await fill("displayName", " New member "); await submit();
    expect(completeProviderSignup).toHaveBeenCalledExactlyOnceWith({ signupToken: token, displayName: "New member", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    expect(onRegister).not.toHaveBeenCalled(); expect(onComplete).toHaveBeenCalledExactlyOnceWith("/collections");
    expect(readPendingProviderSignup()).toBe(""); expect(readPendingInvitation()).toBe(""); expect(storage).not.toHaveBeenCalled();
  });

  it("does not require an absent provider email and validates the server return route", async () => {
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, { state: null, replaceState: vi.fn() });
    vi.mocked(getProviderSignupDetails).mockResolvedValue({ displayName: "Provider Name", email: null });
    vi.mocked(completeProviderSignup).mockResolvedValue({ returnTo: "https://external.example.test" }); await render();
    expect(container.querySelectorAll("input")).toHaveLength(0); await submit();
    expect(completeProviderSignup).toHaveBeenCalledWith({ signupToken: token, displayName: "Provider Name", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    expect(onComplete).toHaveBeenCalledWith("/life-links");
  });

  it("requires explicit sign-out and names an existing phone-only account", async () => {
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, { state: null, replaceState: vi.fn() });
    await render("/register", { id: "existing", email: null, displayName: "Existing member", createdAt: "2026-10-01T00:00:00Z" });
    expect(getProviderSignupDetails).not.toHaveBeenCalled(); expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Currently signed in as Existing member");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); expect(onLogout).toHaveBeenCalledOnce();
    expect(completeProviderSignup).not.toHaveBeenCalled();
  });

  it("renders no unavailable sender controls while configured provider signup remains usable", async () => {
    vi.mocked(getRegistration).mockResolvedValue({ enabled: true, emailVerificationEnabled: false, phoneVerificationEnabled: false });
    vi.mocked(getSignInProviders).mockResolvedValue({ providers: [{ id: "google", label: "Google" }] }); await render();
    expect(container.querySelector("form")).toBeNull(); expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(container.textContent).toContain("Continue with Google"); expect(container.textContent).toContain("Email signup is currently unavailable");
  });

  it("preserves existing sign-in when signup options cannot load", async () => {
    vi.mocked(getRegistration).mockRejectedValue(new Error("private provider diagnostics"));
    await render("/register?returnTo=%2Fagent-authorize%2Finteraction-1"); expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Existing accounts can still sign in"); expect(container.textContent).not.toContain("private provider diagnostics");
    expect(container.querySelector('a[href="/agent-authorize/interaction-1"]')).not.toBeNull();
  });

  it("keeps owned QR returns in signup links and ignores external redirects", async () => {
    await act(async () => root.render(<AccountCreationLink returnTo="/qr/LL-EXACT" />));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/register?returnTo=%2Fqr%2FLL-EXACT"); expect(container.textContent).toContain("New to LifeLinks");
    await render("/register?returnTo=https%3A%2F%2Fevil.test"); await fill("email", "person@example.test"); await submit();
    expect(startEmailVerification).toHaveBeenCalledWith({ email: "person@example.test", returnTo: "/life-links" });
  });

  it.each(["privacy", "terms"] as const)("renders the %s notice and public links without API calls", async page => {
    await act(async () => root.render(<PublicInformation page={page} />));
    expect([...container.querySelectorAll("article > p")].map(paragraph => paragraph.textContent)).toEqual(page === "privacy" ? [...privacyParagraphs] : [...termsParagraphs]);
    for (const path of ["/about", "/privacy", "/terms", "/life-links", "/register"]) expect(container.querySelector(`a[href="${path}"]`)).not.toBeNull();
    expect(container.textContent).toContain("justin@vmosaic.com"); expect(getRegistration).not.toHaveBeenCalled(); expect(onRegister).not.toHaveBeenCalled();
  });

  it("keeps personal workspaces, agent connections and calendars distinct", async () => {
    await render();
    for (const text of ["starts empty", "Do not connect a personal calendar to the shared demo", "Browser WebMCP needs the LifeLinks page open", "remote MCP can work with it closed"]) expect(container.textContent).toContain(text);
    await act(async () => root.render(<PublicInformation page="about" />));
    for (const text of ["My Life Links", "My Collections", "My Routines", "My Calendar", "Search records", "remote MCP connection can work with that page closed", "New private accounts do not copy demo content"]) expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain("account with the invitation");
  });
});
