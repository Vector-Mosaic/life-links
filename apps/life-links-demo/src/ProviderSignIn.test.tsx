// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getSignInProviders, startProviderSignIn } from "./api";
import { ProviderSignIn, type ProviderSignInProps } from "./ProviderSignIn";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), getSignInProviders: vi.fn(), startProviderSignIn: vi.fn() }));

describe("provider sign-in entry", () => {
  let container: HTMLDivElement;
  let root: Root;
  const navigate = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getSignInProviders).mockReset().mockResolvedValue({ providers: [{ id: "google", label: "Google" }] });
    vi.mocked(startProviderSignIn).mockReset().mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic" });
    navigate.mockReset();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(props: Partial<ProviderSignInProps> = {}) {
    await act(async () => root.render(<ProviderSignIn intent="login" returnTo="/life-links" onNavigate={navigate} {...props} />));
  }
  async function click() { await act(async () => container.querySelector<HTMLButtonElement>("button")!.click()); }

  it("renders configured options and starts only after an explicit click", async () => {
    await render({ returnTo: "/agent-authorize/opaque_request", invitationCode: "unused" });
    expect(container.textContent).toBe("Continue with Google");
    expect(container.querySelector("button")!.type).toBe("button");
    expect(startProviderSignIn).not.toHaveBeenCalled();
    await click();
    expect(startProviderSignIn).toHaveBeenCalledWith("google", { intent: "login", returnTo: "/agent-authorize/opaque_request" });
    expect(navigate).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=synthetic");
  });

  it("carries the invitation and timezone for new-account admission", async () => {
    const invitationCode = "i".repeat(43);
    await render({ intent: "register", returnTo: "https://evil.test", invitationCode, timeZone: "America/New_York" });
    await click();
    expect(startProviderSignIn).toHaveBeenCalledWith("google", { intent: "register", returnTo: "/life-links", invitationCode, timeZone: "America/New_York" });
  });

  it("requires an invitation for registration and respects the caller's busy state", async () => {
    await render({ intent: "register" });
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(container.textContent).toContain("Enter your invitation code");
    await click(); expect(startProviderSignIn).not.toHaveBeenCalled();
    await render({ disabled: true }); await click();
    expect(startProviderSignIn).not.toHaveBeenCalled();
  });

  it("hides unconfigured options and discovery failures without disrupting email entry", async () => {
    vi.mocked(getSignInProviders).mockResolvedValue({ providers: [] });
    await render(); expect(container.textContent).toBe("");
    await act(async () => root.unmount()); root = createRoot(container);
    vi.mocked(getSignInProviders).mockRejectedValue(new Error("network unavailable"));
    await render(); expect(container.textContent).toBe("");
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("rejects a changed provider destination without navigating", async () => {
    vi.mocked(startProviderSignIn).mockResolvedValue({ authorizationUrl: "https://evil.test/capture" });
    await render(); await click();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("We couldn't start sign-in.");
    expect(container.textContent).not.toContain("evil.test");
  });

  it("explains account creation failure without revealing whether an account exists", async () => {
    vi.mocked(startProviderSignIn).mockRejectedValue(new ApiError(409, "signup_failed", {}));
    await render(); await click();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("We couldn't create your account. If you already have one, sign in with your existing method and link this provider in Sign-in methods.");
    expect(startProviderSignIn).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate starts while the explicit request is pending", async () => {
    let resolve!: (result: { authorizationUrl: string }) => void;
    vi.mocked(startProviderSignIn).mockReturnValue(new Promise(value => { resolve = value; }));
    await render();
    await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); container.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(startProviderSignIn).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("Opening Google…");
    await act(async () => resolve({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth" }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
