// @vitest-environment jsdom
import { act, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, completePhoneSignup, getRegistration, resendPhoneVerification, startPhoneVerification,
  verifyPhoneVerification, type VerificationAttempt } from "./api";
import { captureInvitationLink, clearPendingInvitation, readPendingInvitation } from "./invitationLink";
import { PhoneSignIn, type PhoneSignInProps } from "./PhoneSignIn";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(),
  getRegistration: vi.fn(), startPhoneVerification: vi.fn(), resendPhoneVerification: vi.fn(),
  verifyPhoneVerification: vi.fn(), completePhoneSignup: vi.fn() }));

describe("phone verification entry", () => {
  let container: HTMLDivElement;
  let root: Root;
  const complete = vi.fn();
  const linked = vi.fn();
  const token = "synthetic_attempt_".padEnd(43, "x");
  const phoneNumber = "+15551234567";
  const consent = { smsConsent: true, smsConsentVersion: "life-links-sms-verification-v2" };
  const makeAttempt = (resendAfterSeconds = 60): VerificationAttempt => ({
    attemptToken: token, expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds
  });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearPendingInvitation(); complete.mockReset(); linked.mockReset();
    vi.mocked(getRegistration).mockReset().mockResolvedValue({ enabled: true, emailVerificationEnabled: true, phoneVerificationEnabled: true });
    vi.mocked(startPhoneVerification).mockReset().mockResolvedValue(makeAttempt());
    vi.mocked(resendPhoneVerification).mockReset().mockResolvedValue(makeAttempt());
    vi.mocked(verifyPhoneVerification).mockReset().mockResolvedValue({ status: "signed_in", returnTo: "/collections" });
    vi.mocked(completePhoneSignup).mockReset().mockResolvedValue({ returnTo: "/routines" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  async function render(props: Partial<PhoneSignInProps> = {}) {
    await act(async () => root.render(<PhoneSignIn intent="login" returnTo="/life-links" enabled onComplete={complete} onLinked={linked} {...props} />));
  }

  function button(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text);
    expect(found, `button ${text}`).toBeDefined(); return found!;
  }

  async function click(text: string) { await act(async () => button(text).click()); }
  async function fill(name: string, value: string) {
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function agreeToSms() {
    await act(async () => container.querySelector<HTMLInputElement>('input[name="smsConsent"]')!.click());
  }

  async function send(props: Partial<PhoneSignInProps> = {}) {
    await render(props); await click(props.intent === "link" ? "Link phone number" : "Continue with phone");
    await fill("phoneNumber", "+1 (555) 123-4567"); await agreeToSms(); await click("Send code");
  }

  it("shows only configured phone entry and quietly handles discovery failures", async () => {
    vi.mocked(getRegistration).mockResolvedValue({ enabled: true, emailVerificationEnabled: true, phoneVerificationEnabled: false });
    await render({ enabled: undefined });
    expect(container.textContent).toBe(""); expect(startPhoneVerification).not.toHaveBeenCalled();
    await act(async () => root.unmount()); root = createRoot(container);
    vi.mocked(getRegistration).mockRejectedValue(new Error("raw discovery failure"));
    await render({ enabled: undefined });
    expect(container.textContent).toBe(""); expect(container.querySelector("[role=alert]")).toBeNull();
    await render({ enabled: true }); expect(button("Continue with phone").type).toBe("button");
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("does not offer new-account phone entry when registration discovery is disabled", async () => {
    vi.mocked(getRegistration).mockResolvedValue({ enabled: false, emailVerificationEnabled: true, phoneVerificationEnabled: true });
    await render({ intent: "register", enabled: undefined }); expect(container.textContent).toBe("");
    await render({ intent: "login", enabled: undefined }); expect(button("Continue with phone")).toBeDefined();
  });

  it("hides a prior option while fresh intent discovery is pending or fails", async () => {
    await render({ enabled: undefined }); expect(button("Continue with phone")).toBeDefined();
    let reject!: (cause: Error) => void;
    vi.mocked(getRegistration).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await render({ intent: "register", enabled: undefined });
    expect(container.textContent).toBe(""); expect(getRegistration).toHaveBeenCalledTimes(2);
    await act(async () => reject(new Error("raw discovery response")));
    expect(container.textContent).toBe(""); expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("starts explicitly with a normalized phone and keeps attempt credentials out of storage, URLs and markup", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const history = vi.spyOn(window.history, "replaceState");
    const url = window.location.href;
    await render({ returnTo: "/agent-authorize/opaque_request" });
    expect(getRegistration).not.toHaveBeenCalled(); expect(startPhoneVerification).not.toHaveBeenCalled();
    await click("Continue with phone"); expect(startPhoneVerification).not.toHaveBeenCalled();
    expect(container.textContent).toContain("I agree to receive LifeLinks SMS verification codes for phone signup, sign-in or linking at this number.");
    expect(container.textContent).toContain("Message frequency depends on my requests.");
    expect(container.textContent).toContain("Standard message and data rates may apply.");
    expect(container.textContent).toContain("Reply STOP to stop texts or HELP for help.");
    expect(container.textContent).toContain("the consent time and disclosure version for 90 days.");
    expect(container.textContent).toContain("It contains no full phone number or verification code.");
    expect(container.textContent).toContain("Expired receipts are removed by routine cleanup.");
    expect(container.querySelector<HTMLAnchorElement>('a[href="mailto:justin@vmosaic.com"]')!.textContent).toBe("justin@vmosaic.com");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/terms"]')!.textContent).toBe("Terms");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/privacy"]')!.textContent).toBe("Privacy");
    expect(container.querySelector('a[href="/terms"]')!.parentElement!.compareDocumentPosition(button("Send code")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await fill("phoneNumber", "+1 (555) 123-4567"); expect(startPhoneVerification).not.toHaveBeenCalled();
    await agreeToSms(); expect(startPhoneVerification).not.toHaveBeenCalled();
    await click("Send code");
    expect(startPhoneVerification).toHaveBeenCalledExactlyOnceWith({ phoneNumber, intent: "login", returnTo: "/agent-authorize/opaque_request", ...consent });
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="phoneVerificationCode"]')!.autocomplete).toBe("one-time-code");
    expect(container.innerHTML).not.toContain(token);
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(verifyPhoneVerification).toHaveBeenCalledExactlyOnceWith(token, "123456");
    expect(complete).toHaveBeenCalledExactlyOnceWith("/collections");
    expect(storage).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled(); expect(window.location.href).toBe(url);
    expect(completePhoneSignup).not.toHaveBeenCalled();
  });

  it("rejects phone values outside the international format before sending", async () => {
    await render(); await click("Continue with phone");
    for (const invalid of ["5551234567", "+05551234567", "+1234567", "+1234567890123456", "+1555abc4567"]) {
      await fill("phoneNumber", invalid); await agreeToSms(); await click("Send code");
      expect(container.querySelector("[role=alert]")?.textContent).toContain("country code");
    }
    expect(startPhoneVerification).not.toHaveBeenCalled();
  });

  it.each(["login", "register", "link"] as const)("keeps SMS consent optional and unchecked for %s until an explicit selection", async intent => {
    const busy = vi.fn();
    await render({ intent, onBusyChange: busy }); await click(intent === "link" ? "Link phone number" : "Continue with phone");
    await fill("phoneNumber", phoneNumber);
    const checkbox = container.querySelector<HTMLInputElement>('input[name="smsConsent"]')!;
    expect(checkbox.type).toBe("checkbox"); expect(checkbox.checked).toBe(false); expect(checkbox.required).toBe(false);
    expect(button("Send code").disabled).toBe(true); await click("Send code");
    expect(startPhoneVerification).not.toHaveBeenCalled(); expect(busy).not.toHaveBeenCalled();
    await agreeToSms(); expect(checkbox.checked).toBe(true); expect(button("Send code").disabled).toBe(false);
    expect(startPhoneVerification).not.toHaveBeenCalled(); expect(busy).not.toHaveBeenCalled();
    await agreeToSms(); expect(checkbox.checked).toBe(false); expect(button("Send code").disabled).toBe(true);
    await click("Send code"); expect(startPhoneVerification).not.toHaveBeenCalled();
    await agreeToSms(); await fill("phoneNumber", "+12025550123");
    expect(checkbox.checked).toBe(false); expect(button("Send code").disabled).toBe(true);
    await agreeToSms(); await click("Send code");
    expect(startPhoneVerification).toHaveBeenCalledExactlyOnceWith({ phoneNumber: "+12025550123", intent, returnTo: "/life-links", ...consent });
  });

  it.each([undefined, "bad", "i".repeat(31), "i".repeat(129), `${"i".repeat(43)}?other=value`])(
    "supports public phone signup while discarding malformed optional invitation %s", async invitationCode => {
      await send({ intent: "register", invitationCode });
      expect(startPhoneVerification).toHaveBeenCalledExactlyOnceWith({ phoneNumber, intent: "register", returnTo: "/life-links", ...consent });
    }
  );

  it("requires a verified phone before collecting only a new owner's name and timezone", async () => {
    vi.mocked(verifyPhoneVerification).mockResolvedValue({ status: "profile_required", returnTo: "/collections" });
    const invitationCode = "i".repeat(43);
    await send({ intent: "register", invitationCode: ` ${invitationCode} `, returnTo: "https://evil.test/" });
    expect(startPhoneVerification).toHaveBeenCalledWith({ phoneNumber, intent: "register", invitationCode, returnTo: "/life-links", ...consent });
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(completePhoneSignup).not.toHaveBeenCalled();
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(container.querySelector('input[name="displayName"]')).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).toBeNull(); expect(container.querySelector('input[type="password"]')).toBeNull();
    await click("Create account"); expect(completePhoneSignup).not.toHaveBeenCalled();
    await fill("displayName", "  New Person  "); await click("Create account");
    expect(completePhoneSignup).toHaveBeenCalledExactlyOnceWith({ attemptToken: token, displayName: "New Person", timeZone: expect.any(String) });
    expect(complete).toHaveBeenCalledExactlyOnceWith("/routines");
  });

  it("validates returned destinations and clears the pending invitation after sign-in", async () => {
    const invitationCode = "i".repeat(43);
    captureInvitationLink({ pathname: "/register", search: "", hash: `#invite=${invitationCode}` }, { state: null, replaceState: vi.fn() });
    vi.mocked(verifyPhoneVerification).mockResolvedValue({ status: "signed_in", returnTo: "//evil.test/capture" });
    await send(); await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(complete).toHaveBeenCalledWith("/life-links"); expect(readPendingInvitation()).toBe("");
    expect(container.querySelector('input[name="phoneVerificationCode"]')).toBeNull();
  });

  it("links only after explicit verification and refreshes the caller without navigation", async () => {
    vi.mocked(verifyPhoneVerification).mockResolvedValue({ status: "linked", returnTo: "/life-links" });
    await send({ intent: "link", invitationCode: "unused" });
    expect(startPhoneVerification).toHaveBeenCalledWith({ phoneNumber, intent: "link", returnTo: "/life-links", ...consent });
    expect(linked).not.toHaveBeenCalled();
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(linked).toHaveBeenCalledTimes(1); expect(complete).not.toHaveBeenCalled(); expect(completePhoneSignup).not.toHaveBeenCalled();
    expect(button("Link phone number")).toBeDefined();
  });

  it.each([
    ["link", "signed_in"], ["link", "profile_required"], ["login", "linked"]
  ] as const)("rejects %s responses that claim %s", async (intent, status) => {
    vi.mocked(verifyPhoneVerification).mockResolvedValue({ status, returnTo: "/collections" });
    await send({ intent }); await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(complete).not.toHaveBeenCalled(); expect(linked).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("couldn't complete this phone sign-in");
  });

  it("requires exactly six digits and gives closed feedback for rejected codes", async () => {
    await send();
    for (const invalid of ["12345", "12a456", "1234567"]) {
      await fill("phoneVerificationCode", invalid); await click("Verify code");
      expect(container.querySelector("[role=alert]")?.textContent).toBe("Enter the six-digit verification code.");
    }
    expect(verifyPhoneVerification).not.toHaveBeenCalled();
    vi.mocked(verifyPhoneVerification).mockRejectedValue(new ApiError(400, "invalid_verification", { message: "raw provider response" }));
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("That code couldn't be verified. Check it and try again.");
    expect(container.textContent).not.toContain("raw provider response"); expect(complete).not.toHaveBeenCalled();
  });

  it("counts down the server cooldown and resends only on a manual action", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.mocked(startPhoneVerification).mockResolvedValue(makeAttempt(3));
    vi.mocked(resendPhoneVerification).mockResolvedValue(makeAttempt(60));
    await send(); expect(button("Resend code in 3s").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(2000)); expect(button("Resend code in 1s").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000)); expect(button("Resend code").disabled).toBe(false);
    expect(resendPhoneVerification).not.toHaveBeenCalled(); await click("Resend code");
    expect(resendPhoneVerification).toHaveBeenCalledExactlyOnceWith(token);
    expect(button("Resend code in 60s").disabled).toBe(true);
  });

  it("restarts an expired attempt without resending or verifying until a new explicit send", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.mocked(startPhoneVerification).mockResolvedValue({ ...makeAttempt(1), expiresAt: new Date(Date.now() + 2000).toISOString() });
    await send(); await fill("phoneVerificationCode", "123456");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.querySelector('input[name="phoneVerificationCode"]')).toBeNull();
    expect(container.textContent).toContain("This verification has expired.");
    expect(verifyPhoneVerification).not.toHaveBeenCalled(); expect(resendPhoneVerification).not.toHaveBeenCalled();
    await click("Start again");
    expect(container.querySelector<HTMLInputElement>('input[name="phoneNumber"]')!.value).toBe(phoneNumber);
    expect(container.querySelector<HTMLInputElement>('input[name="smsConsent"]')!.checked).toBe(false);
    expect(startPhoneVerification).toHaveBeenCalledTimes(1);
    vi.mocked(startPhoneVerification).mockResolvedValue(makeAttempt());
    await agreeToSms(); await click("Send code"); expect(startPhoneVerification).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLInputElement>('input[name="phoneVerificationCode"]')!.value).toBe("");
    expect(resendPhoneVerification).not.toHaveBeenCalled(); expect(verifyPhoneVerification).not.toHaveBeenCalled();
  });

  it("expires a verified profile before account creation and requires a fresh phone proof", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    vi.mocked(startPhoneVerification).mockResolvedValue({ ...makeAttempt(1), expiresAt: new Date(Date.now() + 3000).toISOString() });
    vi.mocked(verifyPhoneVerification).mockResolvedValue({ status: "profile_required", returnTo: "/collections" });
    await send({ intent: "register" }); await fill("phoneVerificationCode", "123456"); await click("Verify code");
    await fill("displayName", "New phone owner");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(container.textContent).toContain("This verification has expired."); expect(completePhoneSignup).not.toHaveBeenCalled();
    await click("Start again"); expect(startPhoneVerification).toHaveBeenCalledTimes(1);
    vi.mocked(startPhoneVerification).mockResolvedValue(makeAttempt()); await agreeToSms(); await click("Send code");
    expect(container.querySelector('input[name="displayName"]')).toBeNull(); expect(verifyPhoneVerification).toHaveBeenCalledTimes(1);
    await fill("phoneVerificationCode", "654321"); await click("Verify code");
    expect(container.querySelector<HTMLInputElement>('input[name="displayName"]')!.value).toBe("");
    expect(completePhoneSignup).not.toHaveBeenCalled(); expect(resendPhoneVerification).not.toHaveBeenCalled();
  });

  it("prevents double sends and freezes entry while the request is pending", async () => {
    let resolve!: (value: VerificationAttempt) => void;
    vi.mocked(startPhoneVerification).mockReturnValue(new Promise(value => { resolve = value; }));
    await render(); await click("Continue with phone"); await fill("phoneNumber", phoneNumber);
    await agreeToSms();
    const sendButton = button("Send code");
    await act(async () => { sendButton.click(); sendButton.click(); });
    expect(startPhoneVerification).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[name="phoneNumber"]')!.disabled).toBe(true); expect(button("Cancel").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="smsConsent"]')!.disabled).toBe(true);
    await act(async () => resolve(makeAttempt())); expect(button("Verify code").disabled).toBe(false);
  });

  it("prevents duplicate verification writes while preserving the caller's disabled state", async () => {
    let resolve!: (value: { status: "signed_in"; returnTo: string }) => void;
    vi.mocked(verifyPhoneVerification).mockReturnValue(new Promise(value => { resolve = value; }));
    await send(); await fill("phoneVerificationCode", "123456");
    const verifyButton = button("Verify code");
    await act(async () => { verifyButton.click(); verifyButton.click(); });
    expect(verifyPhoneVerification).toHaveBeenCalledTimes(1); expect(button("Cancel").disabled).toBe(true);
    await act(async () => resolve({ status: "signed_in", returnTo: "/collections" }));
    await render({ disabled: true }); expect(button("Continue with phone").disabled).toBe(true);
    await click("Continue with phone"); expect(container.querySelector('input[name="phoneNumber"]')).toBeNull();
  });

  it("reports an uncertain send without exposing provider data or automatically requesting another code", async () => {
    vi.useFakeTimers();
    vi.mocked(startPhoneVerification).mockRejectedValue(new ApiError(503, "send_outcome_unknown", { message: "secret provider token" }));
    await send();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("We couldn't confirm whether a code was sent. Check your messages before requesting another code.");
    expect(container.textContent).not.toContain("secret provider token"); expect(container.querySelector('input[name="phoneVerificationCode"]')).toBeNull();
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(startPhoneVerification).toHaveBeenCalledTimes(1); expect(resendPhoneVerification).not.toHaveBeenCalled();
    expect(completePhoneSignup).not.toHaveBeenCalled();
  });

  it.each([
    ["verification_unavailable", "Phone sign-in isn't available right now. Use another sign-in method."],
    ["verification_rate_limited", "Too many attempts. Wait a little before trying again."]
  ])("uses closed feedback for %s without provider response details", async (errorCode, message) => {
    vi.mocked(startPhoneVerification).mockRejectedValue(new ApiError(503, errorCode, { message: "raw provider response" }));
    await send(); expect(container.querySelector("[role=alert]")?.textContent).toBe(message);
    expect(container.textContent).not.toContain("raw provider response"); expect(startPhoneVerification).toHaveBeenCalledTimes(1);
  });

  it("handles an uncertain resend without automatically retrying or losing the known attempt", async () => {
    vi.mocked(startPhoneVerification).mockResolvedValue(makeAttempt(0));
    vi.mocked(resendPhoneVerification).mockRejectedValue(new Error("raw network response"));
    await send(); await click("Resend code");
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Check your messages before requesting another code");
    expect(resendPhoneVerification).toHaveBeenCalledTimes(1); expect(container.textContent).not.toContain("raw network response");
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(verifyPhoneVerification).toHaveBeenCalledWith(token, "123456");
  });

  it("directs an uncertain link outcome to the current account's Sign-in methods", async () => {
    vi.mocked(verifyPhoneVerification).mockRejectedValue(new Error("raw link response"));
    await send({ intent: "link" }); await fill("phoneVerificationCode", "123456"); await click("Verify code");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("We couldn't confirm whether this phone number was linked. Check Sign-in methods before trying again.");
    expect(container.textContent).not.toContain("raw link response"); expect(linked).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
  });

  it("coordinates busy state before each write and releases it if unmounted while pending", async () => {
    const busy = vi.fn();
    await send({ onBusyChange: busy });
    expect(busy.mock.calls).toEqual([[true], [false]]);
    let resolve!: (value: { status: "signed_in"; returnTo: string }) => void;
    vi.mocked(verifyPhoneVerification).mockImplementation(() => {
      expect(busy).toHaveBeenLastCalledWith(true);
      return new Promise(value => { resolve = value; });
    });
    await fill("phoneVerificationCode", "123456"); await click("Verify code");
    await act(async () => root.unmount()); root = createRoot(container);
    expect(busy.mock.calls).toEqual([[true], [false], [true], [false]]);
    await act(async () => resolve({ status: "signed_in", returnTo: "/collections" }));
    expect(complete).not.toHaveBeenCalled(); expect(busy).toHaveBeenCalledTimes(4);
  });

  it("clears the local attempt and entered values when cancelled", async () => {
    await send(); await fill("phoneVerificationCode", "123456"); await click("Cancel"); await click("Continue with phone");
    expect(container.querySelector<HTMLInputElement>('input[name="phoneNumber"]')!.value).toBe("");
    expect(container.querySelector<HTMLInputElement>('input[name="smsConsent"]')!.checked).toBe(false);
    expect(container.querySelector('input[name="phoneVerificationCode"]')).toBeNull();
    expect(verifyPhoneVerification).not.toHaveBeenCalled(); expect(resendPhoneVerification).not.toHaveBeenCalled();
  });

  it("requires consent plus the Send code action and suppresses enclosing-form submission on entry Enter", async () => {
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    await act(async () => root.render(<form onSubmit={submit}><PhoneSignIn intent="login" returnTo="/life-links" enabled onComplete={complete} /></form>));
    await click("Continue with phone"); await fill("phoneNumber", phoneNumber);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => container.querySelector('input[name="phoneNumber"]')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(submit).not.toHaveBeenCalled();
    const checkboxEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => container.querySelector('input[name="smsConsent"]')!.dispatchEvent(checkboxEvent));
    expect(checkboxEvent.defaultPrevented).toBe(true); expect(submit).not.toHaveBeenCalled();
    expect(startPhoneVerification).not.toHaveBeenCalled(); await click("Send code"); expect(startPhoneVerification).not.toHaveBeenCalled();
    await agreeToSms(); expect(startPhoneVerification).not.toHaveBeenCalled(); await click("Send code");
    expect(startPhoneVerification).toHaveBeenCalledTimes(1); expect(container.querySelectorAll("form")).toHaveLength(1);
  });
});
