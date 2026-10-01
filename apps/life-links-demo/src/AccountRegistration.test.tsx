// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountCreationLink, AccountRegistration } from "./AccountRegistration";
import { PublicInformation, privacyParagraphs, termsParagraphs } from "./PublicInformation";
import { completeProviderSignup, getProviderSignupDetails, getRegistration, getSignInProviders, type ApiUser } from "./api";
import { captureInvitationLink, clearPendingInvitation, readPendingInvitation, accountInvitationLink } from "./invitationLink";
import { captureProviderSignInLink, clearPendingProviderSignup, clearProviderSignInError, readPendingProviderSignup } from "./providerSignInLink";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(),
  getRegistration: vi.fn(), getSignInProviders: vi.fn(), getProviderSignupDetails: vi.fn(), completeProviderSignup: vi.fn() }));

describe("private account registration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRegister: ReturnType<typeof vi.fn>;
  let onLogout: ReturnType<typeof vi.fn>;
  let onComplete: ReturnType<typeof vi.fn>;
  const values = { displayName: "Private Judge", email: "judge@example.test", password: "my private password", confirmPassword: "my private password", invitationCode: "invitation_".padEnd(40, "x") };
  beforeEach(() => {
    clearPendingInvitation();
    clearPendingProviderSignup(); clearProviderSignInError();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRegistration).mockReset().mockResolvedValue({ enabled: true });
    vi.mocked(getSignInProviders).mockReset().mockResolvedValue({ providers: [] });
    vi.mocked(getProviderSignupDetails).mockReset().mockResolvedValue({ displayName: null, email: "provider@example.test" });
    vi.mocked(completeProviderSignup).mockReset().mockResolvedValue({ returnTo: "/collections" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    onRegister = vi.fn().mockResolvedValue(true); onLogout = vi.fn().mockResolvedValue(undefined); onComplete = vi.fn();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(pathname = "/register", currentUser: ApiUser | null = null, error = "") {
    await act(async () => root.render(<AccountRegistration pathname={pathname} currentUser={currentUser} busy={false} error={error}
      onRegister={onRegister} onLogout={onLogout} onComplete={onComplete} />));
  }
  async function fill(overrides: Partial<typeof values> = {}) {
    await act(async () => {
      for (const [name, value] of Object.entries({ ...values, ...overrides })) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
  async function submit() {
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }

  it("uses a scrubbed invitation fragment without a code field, storage, or repeated consumption", async () => {
    const history = { state: null, replaceState: vi.fn() };
    const location = { pathname: "/register", search: "?returnTo=%2Fcollections", hash: `#invite=${values.invitationCode}` };
    const storage = vi.spyOn(Storage.prototype, "setItem");
    captureInvitationLink(location, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/register?returnTo=%2Fcollections");
    expect(accountInvitationLink(values.invitationCode, "https://lifelinks.example.test"))
      .toBe(`https://lifelinks.example.test/register#invite=${values.invitationCode}`);
    expect(readPendingInvitation()).toBe(values.invitationCode);
    expect(readPendingInvitation()).toBe(values.invitationCode);
    await render();
    expect(container.querySelector('input[name="invitationCode"]')).toBeNull();
    await act(async () => {
      for (const name of ["displayName", "email", "password", "confirmPassword"] as const) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, values[name]);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await submit();
    expect(onRegister).toHaveBeenCalledWith(expect.objectContaining({ invitationCode: values.invitationCode }));
    expect(readPendingInvitation()).toBe("");
    expect(storage).not.toHaveBeenCalled();
  });

  it("scrubs malformed invitation fragments and refuses to capture them on other routes", () => {
    const history = { state: null, replaceState: vi.fn() };
    captureInvitationLink({ pathname: "/register", search: "", hash: "#invite=bad&extra=private" }, history);
    expect(readPendingInvitation()).toBe("");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/register");
    history.replaceState.mockClear();
    captureInvitationLink({ pathname: "/collections", search: "", hash: `#invite=${values.invitationCode}` }, history);
    expect(readPendingInvitation()).toBe("");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("finishes a provider signup with only its missing name, then clears proof and invitation without storing credentials", async () => {
    const token = "synthetic_signup_".padEnd(43, "x");
    const history = { state: null, replaceState: vi.fn() };
    captureInvitationLink({ pathname: "/register", search: "", hash: `#invite=${values.invitationCode}` }, history);
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, history);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await render();
    expect(getRegistration).not.toHaveBeenCalled();
    expect(getSignInProviders).not.toHaveBeenCalled();
    expect(getProviderSignupDetails).toHaveBeenCalledExactlyOnceWith(token);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(container.textContent).toContain("provider@example.test");
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[name="displayName"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " New member ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(completeProviderSignup).toHaveBeenCalledExactlyOnceWith({ signupToken: token, displayName: "New member",
      email: "provider@example.test", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    expect(onRegister).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("/collections");
    expect(readPendingProviderSignup()).toBe(""); expect(readPendingInvitation()).toBe("");
    expect(storage).not.toHaveBeenCalled();
  });

  it("collects a missing provider email and validates the server return route", async () => {
    const token = "synthetic_signup_".padEnd(43, "x");
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${token}` }, { state: null, replaceState: vi.fn() });
    vi.mocked(getProviderSignupDetails).mockResolvedValue({ displayName: "Provider Name", email: null });
    vi.mocked(completeProviderSignup).mockResolvedValue({ returnTo: "https://external.example.test" });
    await render();
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[name="email"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " member@example.test ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(completeProviderSignup).toHaveBeenCalledWith(expect.objectContaining({ email: "member@example.test", displayName: "Provider Name" }));
    expect(onComplete).toHaveBeenCalledWith("/life-links");
  });

  it("requires explicit sign-out before continuing a different provider signup", async () => {
    captureProviderSignInLink({ pathname: "/register", search: "", hash: `#signup=${"x".repeat(43)}` }, { state: null, replaceState: vi.fn() });
    const currentUser = { id: "existing", email: "existing@example.test", displayName: "Existing", createdAt: "2026-10-01T00:00:00Z" };
    await render("/register", currentUser);
    expect(getProviderSignupDetails).not.toHaveBeenCalled();
    expect(container.querySelector("form")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(onLogout).toHaveBeenCalledOnce();
    expect(completeProviderSignup).not.toHaveBeenCalled();
  });

  it("separates personal test data from the shared demo and explains explicit agent/calendar linking", async () => {
    await render();
    expect(container.textContent).toContain("starts empty");
    expect(container.textContent).toContain("not a copy of the shared demo");
    expect(container.textContent).toContain("Do not connect a personal calendar to the shared demo");
    expect(container.textContent).toContain("Browser WebMCP needs the LifeLinks page open");
    expect(container.textContent).toContain("remote MCP can work with it closed after account linking");
    expect(container.textContent).toContain("Create a private Life Link named My test item");
    expect(container.textContent).toContain("password recovery are not available");
    expect(container.querySelectorAll("input[type=password]")).toHaveLength(3);
  });

  it.each(["/qr/LL-PRIVATE-1", "/agent-authorize/interaction_exact", "/collections/collection-1"])("submits once then resumes %s without retaining credentials", async (returnTo) => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    await render(`/register?returnTo=${encodeURIComponent(returnTo)}`);
    await fill({ displayName: " Private Judge ", email: " judge@example.test " });
    await submit();
    expect(onRegister).toHaveBeenCalledExactlyOnceWith({ displayName: values.displayName, email: values.email,
      password: values.password, invitationCode: values.invitationCode, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith(returnTo);
    for (const name of ["password", "confirmPassword", "invitationCode"]) expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value).toBe("");
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it("does not double-submit while the request is pending or invoke completion on a refused invitation", async () => {
    let finish!: (created: boolean) => void;
    onRegister.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await fill();
    await submit(); await submit();
    expect(onRegister).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(true);
    await act(async () => finish(false));
    expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(false);
    await render("/register", null, "Check the private invitation instructions.");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Check the private invitation instructions.");
  });

  it.each([
    { password: "short", confirmPassword: "short" },
    { confirmPassword: "a different password" },
    { invitationCode: "short-code" },
    { email: "not an email" }
  ])("validates form values before attempting account creation: %j", async (overrides) => {
    await render(); await fill(overrides); await submit();
    expect(onRegister).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")).not.toBeNull();
  });

  it("fails closed when invitations are unavailable without disabling existing sign-in", async () => {
    vi.mocked(getRegistration).mockResolvedValue({ enabled: false });
    await render("/register?returnTo=%2Fagent-authorize%2Finteraction-1");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Existing accounts can still sign in");
    expect(container.querySelector<HTMLAnchorElement>("a")!.getAttribute("href")).toBe("/agent-authorize/interaction-1");
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("lets the user recheck a failed availability read without retrying a registration write", async () => {
    vi.mocked(getRegistration).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("couldn't check");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector("form")).not.toBeNull();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("names the current account and requires explicit sign-out before separate account creation", async () => {
    const currentUser = { id: "demo-owner", email: "demo@example.test", displayName: "Demo", createdAt: "2026-09-03T00:00:00Z" };
    await render("/register", currentUser);
    expect(container.textContent).toContain("Currently signed in as demo@example.test");
    expect(container.querySelector("form")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(onLogout).toHaveBeenCalledOnce();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("keeps the QR return path in the signup link and ignores external redirect attempts", async () => {
    await act(async () => root.render(<AccountCreationLink returnTo="/qr/LL-EXACT" />));
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/register?returnTo=%2Fqr%2FLL-EXACT");
    await render("/register?returnTo=https%3A%2F%2Fevil.test"); await fill(); await submit();
    expect(onComplete).toHaveBeenCalledWith("/life-links");
  });

  it.each(["privacy", "terms"] as const)("renders every approved %s paragraph with accessible public links and no API calls", async (page) => {
    await act(async () => root.render(<PublicInformation page={page} />));
    const paragraphs = [...container.querySelectorAll("article > p")].map((paragraph) => paragraph.textContent);
    expect(paragraphs).toEqual(page === "privacy" ? [...privacyParagraphs] : [...termsParagraphs]);
    expect(container.querySelector("h1")?.textContent).toBe(page === "privacy" ? "Privacy notice" : "Evaluation terms");
    for (const path of ["/about", "/privacy", "/terms", "/life-links", "/register"]) expect(container.querySelector(`a[href="${path}"]`)).not.toBeNull();
    expect(container.textContent).toContain("justin@vmosaic.com");
    expect(getRegistration).not.toHaveBeenCalled();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("offers whole-app About without implying QR or open-page requirements for remote MCP", async () => {
    await act(async () => root.render(<PublicInformation page="about" />));
    for (const feature of ["My Life Links", "My Collections", "My Routines", "My Calendar", "Search records", "remote MCP connection can work with that page closed", "Vector Mosaic"]) expect(container.textContent).toContain(feature);
    expect(container.textContent).toContain("New private accounts do not copy demo content");
  });
});
