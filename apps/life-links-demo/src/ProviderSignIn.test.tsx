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
    expect(container.querySelector("button")!.textContent).toBe("Continue with Google");
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

  it("starts public registration without an invitation and respects the caller's busy state", async () => {
    await render({ intent: "register" });
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    await click(); expect(startProviderSignIn).toHaveBeenCalledExactlyOnceWith("google", { intent: "register", returnTo: "/life-links" });
    vi.mocked(startProviderSignIn).mockClear();
    await render({ disabled: true }); await click();
    expect(startProviderSignIn).not.toHaveBeenCalled();
  });

  it("offers the Apple mark and label only when Apple is configured", async () => {
    vi.mocked(getSignInProviders).mockResolvedValue({ providers: [{ id: "apple", label: "Apple" }] });
    vi.mocked(startProviderSignIn).mockResolvedValue({ authorizationUrl: "https://appleid.apple.com/auth/authorize" });
    await render({ intent: "register", invitationCode: "malformed" });
    expect(container.querySelector('[data-provider="apple"]')?.textContent).toBe("Continue with Apple");
    expect(container.querySelector('[data-provider="apple"] img')?.getAttribute("aria-hidden")).toBe("true");
    await click();
    expect(startProviderSignIn).toHaveBeenCalledWith("apple", { intent: "register", returnTo: "/life-links" });
    expect(navigate).toHaveBeenCalledWith("https://appleid.apple.com/auth/authorize");
  });

  it("hides successfully unconfigured options", async () => {
    vi.mocked(getSignInProviders).mockResolvedValue({ providers: [] });
    await render(); expect(container.textContent).toBe("");
  });

  it("offers one explicit retry after discovery fails without starting authentication", async () => {
    vi.mocked(getSignInProviders).mockRejectedValue(new Error("network unavailable"));
    await render();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("We couldn't load other sign-in methods.");
    expect(getSignInProviders).toHaveBeenCalledTimes(1);
    expect(startProviderSignIn).not.toHaveBeenCalled();
    vi.mocked(getSignInProviders).mockResolvedValue({ providers: [{ id: "google", label: "Google" }] });
    await click();
    expect(getSignInProviders).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(container.querySelector('[data-provider="google"]')?.textContent).toBe("Continue with Google");
    expect(startProviderSignIn).not.toHaveBeenCalled();
  });

  it("aborts discovery and ignores its late result after the entry unmounts", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getSignInProviders>>) => void;
    vi.mocked(getSignInProviders).mockReturnValue(new Promise(complete => { resolve = complete; }));
    await render();
    const signal = vi.mocked(getSignInProviders).mock.calls[0][0]!;
    await act(async () => root.unmount()); root = createRoot(container);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ providers: [{ id: "google", label: "Google" }] }));
    expect(container.textContent).toBe("");
    expect(startProviderSignIn).not.toHaveBeenCalled();
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
    expect(container.querySelector("button")!.textContent).toBe("Opening Google…");
    await act(async () => resolve({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth" }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
