// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInMethodsDialog } from "./SignInMethodsDialog";
import { getAccountSignInMethods, startProviderSignIn } from "../api";

vi.mock("../api", async importOriginal => ({ ...await importOriginal<typeof import("../api")>(),
  getAccountSignInMethods: vi.fn(), startProviderSignIn: vi.fn() }));

describe("Sign-in methods", () => {
  let container: HTMLDivElement; let root: Root;
  let onNavigate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    window.history.replaceState(null, "", "/collections");
    vi.mocked(getAccountSignInMethods).mockReset().mockResolvedValue({ providers: [
      { id: "google", label: "Google", linked: false }, { id: "microsoft", label: "Microsoft", linked: true }
    ] });
    vi.mocked(startProviderSignIn).mockReset().mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic" });
    onNavigate = vi.fn(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render() { await act(async () => root.render(<SignInMethodsDialog onClose={() => {}} onNavigate={onNavigate} />)); }
  function dialog() { return document.body.querySelector('[role="dialog"]')!; }
  function button(text: string) { return [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!; }

  it("shows linked methods and starts an explicit link for this existing account only on request", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    await render();
    expect(startProviderSignIn).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("MicrosoftLinked");
    expect(button("Link Microsoft")).toBeUndefined();
    expect(dialog().textContent).toContain("doesn't connect your calendar or give an agent access");
    await act(async () => button("Link Google").click());
    expect(startProviderSignIn).toHaveBeenCalledExactlyOnceWith("google", { intent: "link", returnTo: "/collections" });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic");
    expect(storage).not.toHaveBeenCalled();
  });

  it("rejects an unexpected external destination and leaves existing methods intact", async () => {
    vi.mocked(startProviderSignIn).mockResolvedValue({ authorizationUrl: "https://unexpected.example.test" });
    await render(); await act(async () => button("Link Google").click());
    expect(onNavigate).not.toHaveBeenCalled();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("existing methods still work");
    expect(dialog().textContent).toContain("MicrosoftLinked");
    expect(startProviderSignIn).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a pending link or start another provider", async () => {
    let finish!: (result: { authorizationUrl: string }) => void;
    vi.mocked(startProviderSignIn).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => { button("Link Google").click(); button("Link Google")?.click(); });
    expect(startProviderSignIn).toHaveBeenCalledTimes(1);
    await act(async () => finish({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("offers a read-only refresh after discovery failure without starting a link", async () => {
    vi.mocked(getAccountSignInMethods).mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain("couldn't load");
    await act(async () => button("Refresh sign-in methods").click());
    expect(getAccountSignInMethods).toHaveBeenCalledTimes(2);
    expect(button("Link Google")).toBeDefined();
    expect(startProviderSignIn).not.toHaveBeenCalled();
  });
});
