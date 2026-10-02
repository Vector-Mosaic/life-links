// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInMethodsDialog } from "./SignInMethodsDialog";
import { completePhoneSignup, getAccountSignInMethods, startPhoneVerification, startProviderSignIn, verifyPhoneVerification, type VerificationAttempt } from "../api";

vi.mock("../api", async importOriginal => ({ ...await importOriginal<typeof import("../api")>(),
  getAccountSignInMethods: vi.fn(), startProviderSignIn: vi.fn(), startPhoneVerification: vi.fn(),
  verifyPhoneVerification: vi.fn(), completePhoneSignup: vi.fn() }));

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
    ], phone: { enabled: false, linked: false, maskedNumber: null } });
    vi.mocked(startProviderSignIn).mockReset().mockResolvedValue({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic" });
    vi.mocked(startPhoneVerification).mockReset().mockResolvedValue({ attemptToken: "synthetic_phone_attempt", expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 });
    vi.mocked(verifyPhoneVerification).mockReset().mockResolvedValue({ status: "linked", returnTo: "/collections" });
    vi.mocked(completePhoneSignup).mockReset();
    onNavigate = vi.fn(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render() { await act(async () => root.render(<SignInMethodsDialog onClose={() => {}} onNavigate={onNavigate} />)); }
  function dialog() { return document.body.querySelector('[role="dialog"]')!; }
  function button(text: string) { return [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === text)!; }
  async function fill(name: string, value: string) {
    await act(async () => {
      const input = dialog().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

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

  it("links a verified phone explicitly, blocks overlapping provider writes and refreshes the masked method", async () => {
    const providers = [{ id: "google" as const, label: "Google", linked: false }];
    vi.mocked(getAccountSignInMethods).mockResolvedValueOnce({ providers, phone: { enabled: true, linked: false, maskedNumber: null } })
      .mockResolvedValueOnce({ providers, phone: { enabled: true, linked: true, maskedNumber: "+1******0123" } });
    let resolve!: (result: VerificationAttempt) => void;
    vi.mocked(startPhoneVerification).mockReturnValue(new Promise(accept => { resolve = accept; }));
    await render();
    expect(startPhoneVerification).not.toHaveBeenCalled();
    await act(async () => button("Link phone number").click());
    await fill("phoneNumber", "+1 (202) 555-0123");
    await act(async () => dialog().querySelector<HTMLInputElement>('input[name="smsConsent"]')!.click());
    await act(async () => button("Send code").click());
    expect(startPhoneVerification).toHaveBeenCalledExactlyOnceWith({ phoneNumber: "+12025550123", intent: "link", returnTo: "/collections",
      smsConsent: true, smsConsentVersion: "life-links-sms-verification-v2" });
    expect(button("Link Google").disabled).toBe(true); expect(button("Refresh sign-in methods").disabled).toBe(true);
    await act(async () => button("Link Google").click()); expect(startProviderSignIn).not.toHaveBeenCalled();
    await act(async () => resolve({ attemptToken: "synthetic_phone_attempt", expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 60 }));
    expect(verifyPhoneVerification).not.toHaveBeenCalled();
    await fill("phoneVerificationCode", "123456"); await act(async () => button("Verify code").click());
    expect(verifyPhoneVerification).toHaveBeenCalledExactlyOnceWith("synthetic_phone_attempt", "123456");
    expect(getAccountSignInMethods).toHaveBeenCalledTimes(2);
    expect(dialog().textContent).toContain("Linked · +1******0123");
    expect(dialog().textContent).not.toContain("+12025550123"); expect(dialog().textContent).not.toContain("synthetic_phone_attempt");
    expect(button("Link phone number")).toBeUndefined(); expect(button("Link Google").disabled).toBe(false);
    expect(completePhoneSignup).not.toHaveBeenCalled(); expect(onNavigate).not.toHaveBeenCalled();
  });

  it("retains a linked masked phone when sending is unavailable without offering another link", async () => {
    vi.mocked(getAccountSignInMethods).mockResolvedValue({ providers: [], phone: { enabled: false, linked: true, maskedNumber: "+1******0123" } });
    await render();
    expect(dialog().textContent).toContain("Linked · +1******0123");
    expect(dialog().textContent).not.toContain("No additional sign-in methods");
    expect(button("Link phone number")).toBeUndefined();
    expect(startPhoneVerification).not.toHaveBeenCalled(); expect(startProviderSignIn).not.toHaveBeenCalled();
  });
});
