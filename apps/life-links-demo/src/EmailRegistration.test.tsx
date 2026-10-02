// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, resendEmailVerification, startEmailVerification, verifyEmailVerification, type VerificationAttempt } from "./api";
import { EmailRegistration, type EmailRegistrationProps } from "./EmailRegistration";
import { captureInvitationLink, clearPendingInvitation, readPendingInvitation } from "./invitationLink";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(),
  startEmailVerification: vi.fn(), resendEmailVerification: vi.fn(), verifyEmailVerification: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

describe("verified email account registration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRegister: ReturnType<typeof vi.fn>;
  let onComplete: ReturnType<typeof vi.fn>;
  const attempt: VerificationAttempt = { attemptToken: "synthetic_email_attempt", expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfterSeconds: 0 };
  const profile = { displayName: " New member ", password: "my private password", confirmPassword: "my private password" };
  beforeEach(() => {
    clearPendingInvitation();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(startEmailVerification).mockReset().mockResolvedValue(attempt);
    vi.mocked(resendEmailVerification).mockReset().mockResolvedValue({ ...attempt, attemptToken: "synthetic_rotated_attempt" });
    vi.mocked(verifyEmailVerification).mockReset().mockResolvedValue({ status: "verified" });
    onRegister = vi.fn().mockResolvedValue(true); onComplete = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    clearPendingInvitation(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  async function render(props: Partial<EmailRegistrationProps> = {}) {
    await act(async () => root.render(<StrictMode><EmailRegistration enabled returnTo="/collections" busy={false} error=""
      onRegister={onRegister} onComplete={onComplete} {...props} /></StrictMode>));
  }
  async function fill(values: Record<string, string>) {
    await act(async () => {
      for (const [name, value] of Object.entries(values)) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }
  function submitEvent() { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
  async function submit() { await act(async () => submitEvent()); }
  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === label)!;
  }
  async function reachCode(props: Partial<EmailRegistrationProps> = {}) {
    await render(props); await fill({ email: " member@example.test " }); await submit();
  }
  async function reachProfile(props: Partial<EmailRegistrationProps> = {}) {
    await reachCode(props); await fill({ code: "012345" }); await submit();
  }

  it("requires separate email, code and profile submissions before account creation", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    await render();
    expect(startEmailVerification).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[name="invitationCode"]')).toBeNull();
    await fill({ email: " member@example.test " }); await submit();
    expect(startEmailVerification).toHaveBeenCalledExactlyOnceWith({ email: "member@example.test", returnTo: "/collections" });
    expect(verifyEmailVerification).not.toHaveBeenCalled(); expect(onRegister).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="code"]')!.getAttribute("autocomplete")).toBe("one-time-code");
    await fill({ code: "012345" }); await submit();
    expect(verifyEmailVerification).toHaveBeenCalledExactlyOnceWith(attempt.attemptToken, "012345");
    expect(onRegister).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="code"]')).toBeNull();
    expect(container.querySelector('input[name="email"]')).toBeNull();
    await fill(profile); await submit();
    expect(onRegister).toHaveBeenCalledExactlyOnceWith({ attemptToken: attempt.attemptToken, displayName: "New member",
      password: profile.password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("/collections");
    expect(container.querySelector("form")).toBeNull(); expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toContain(attempt.attemptToken);
    expect(container.textContent).not.toContain("012345"); expect(container.textContent).not.toContain(profile.password);
    expect(storage).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });

  it("does not mount a disabled email flow or send while the caller is busy", async () => {
    await render({ enabled: false }); expect(container.querySelector("form")).toBeNull();
    expect(startEmailVerification).not.toHaveBeenCalled();
    await render({ busy: true }); await fill({ email: "member@example.test" }); await submit();
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(startEmailVerification).not.toHaveBeenCalled(); expect(onRegister).not.toHaveBeenCalled();
  });

  it.each([undefined, "short", "i".repeat(129), "i".repeat(31) + "&"])("omits an absent or malformed optional invitation: %s", async invitationCode => {
    await reachCode({ invitationCode });
    expect(startEmailVerification).toHaveBeenCalledWith({ email: "member@example.test", returnTo: "/collections" });
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("sends an initial valid invitation only with email admission, then clears the pending link on creation", async () => {
    const invitationCode = "i".repeat(43);
    captureInvitationLink({ pathname: "/register", search: "", hash: `#invite=${invitationCode}` }, { state: null, replaceState: vi.fn() });
    await reachProfile({ invitationCode });
    expect(startEmailVerification).toHaveBeenCalledExactlyOnceWith({ email: "member@example.test", returnTo: "/collections", invitationCode });
    expect(readPendingInvitation()).toBe(invitationCode);
    await fill(profile); await submit();
    expect(onRegister.mock.calls[0][0]).not.toHaveProperty("invitationCode");
    expect(onRegister.mock.calls[0][0]).not.toHaveProperty("email");
    expect(readPendingInvitation()).toBe("");
  });

  it.each(["https://external.example.test", "//external.example.test", "/api/auth/register"])("resumes an owned fallback for an unsafe destination: %s", async returnTo => {
    await reachProfile({ returnTo }); await fill(profile); await submit();
    expect(startEmailVerification).toHaveBeenCalledWith(expect.objectContaining({ returnTo: "/life-links" }));
    expect(onComplete).toHaveBeenCalledWith("/life-links");
  });

  it("preserves full-navigation continuation to server-owned agent consent", async () => {
    await reachProfile({ returnTo: "/agent-authorize/request_exact" }); await fill(profile); await submit();
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("/agent-authorize/request_exact");
  });

  it("uses the actual cooldown and manually resends once with the returned token", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-01T12:00:00.000Z");
    const cooldownAttempt = { ...attempt, expiresAt: new Date(Date.now() + 600_000).toISOString() };
    vi.mocked(startEmailVerification).mockResolvedValue({ ...cooldownAttempt, resendAfterSeconds: 30 });
    await reachCode();
    expect(button("Resend code in 30s").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(29_000));
    expect(button("Resend code in 1s").disabled).toBe(true); expect(resendEmailVerification).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button("Resend code").disabled).toBe(false); expect(resendEmailVerification).not.toHaveBeenCalled();
    await fill({ code: "999999" });
    const response = deferred<VerificationAttempt>();
    vi.mocked(resendEmailVerification).mockReturnValue(response.promise);
    const resendButton = button("Resend code");
    await act(async () => { resendButton.click(); resendButton.click(); submitEvent(); });
    expect(resendEmailVerification).toHaveBeenCalledExactlyOnceWith(attempt.attemptToken);
    expect(verifyEmailVerification).not.toHaveBeenCalled();
    await act(async () => response.resolve({ ...cooldownAttempt, attemptToken: "synthetic_rotated_attempt", resendAfterSeconds: 12 }));
    expect(button("Resend code in 12s").disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("");
    await fill({ code: "012345" }); await submit();
    expect(verifyEmailVerification).toHaveBeenCalledExactlyOnceWith("synthetic_rotated_attempt", "012345");
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("prevents duplicate writes during send, verify and final registration", async () => {
    const sending = deferred<VerificationAttempt>();
    vi.mocked(startEmailVerification).mockReturnValue(sending.promise);
    await render(); await fill({ email: "member@example.test" });
    await act(async () => { submitEvent(); submitEvent(); });
    expect(startEmailVerification).toHaveBeenCalledTimes(1); expect(button("Sending code…").disabled).toBe(true);
    await act(async () => sending.resolve(attempt));
    const verifying = deferred<{ status: "verified" }>();
    vi.mocked(verifyEmailVerification).mockReturnValue(verifying.promise);
    await fill({ code: "012345" }); await act(async () => { submitEvent(); submitEvent(); });
    expect(verifyEmailVerification).toHaveBeenCalledTimes(1); expect(button("Verifying email…").disabled).toBe(true);
    await act(async () => verifying.resolve({ status: "verified" }));
    const creating = deferred<boolean>(); onRegister.mockReturnValue(creating.promise);
    await fill(profile); await act(async () => { submitEvent(); submitEvent(); });
    expect(onRegister).toHaveBeenCalledTimes(1); expect(button("Creating your account…").disabled).toBe(true);
    await act(async () => creating.resolve(false));
    expect(onComplete).not.toHaveBeenCalled(); expect(onRegister).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Try signing in before submitting again");
  });

  it("does not advance when a code is refused, and exposes only friendly feedback", async () => {
    vi.mocked(verifyEmailVerification).mockRejectedValue(new ApiError(400, "invalid_verification", { detail: "private backend diagnostics" }));
    await reachCode(); await fill({ code: "012345" }); await submit();
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.querySelector('input[name="displayName"]')).toBeNull();
    expect(onRegister).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("invalid or expired");
    expect(container.textContent).not.toContain("private backend diagnostics");
  });

  it.each([
    ["verification_unavailable", "temporarily unavailable"],
    ["verification_rate_limited", "Too many attempts"],
    ["send_outcome_unknown", "Check your inbox before requesting another code"]
  ])("shows closed %s send feedback without automatic retries", async (code, message) => {
    vi.mocked(startEmailVerification).mockRejectedValue(new ApiError(503, code, { detail: "private backend diagnostics" }));
    await reachCode();
    expect(startEmailVerification).toHaveBeenCalledTimes(1); expect(onRegister).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain(message);
    expect(container.textContent).not.toContain("private backend diagnostics");
  });

  it("advises signing in after uncertain creation without retrying or completing", async () => {
    onRegister.mockRejectedValue(new Error("private backend diagnostics"));
    await reachProfile(); await fill(profile); await submit();
    expect(onRegister).toHaveBeenCalledTimes(1); expect(onComplete).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Try signing in before submitting again");
    expect(container.textContent).not.toContain("private backend diagnostics");
  });

  it("preserves the caller's safe admission feedback after a refused creation", async () => {
    onRegister.mockResolvedValue(false);
    await reachProfile(); await fill(profile); await submit();
    const error = "Account creation is currently unavailable. Choose another available signup method or sign in to an existing account.";
    await render({ error });
    expect(container.querySelector("[role=alert]")?.textContent).toBe(error);
    expect(container.textContent).not.toContain("Try signing in before submitting again");
    expect(onRegister).toHaveBeenCalledTimes(1); expect(onComplete).not.toHaveBeenCalled();
  });

  it.each(["code", "profile"] as const)("requires a manual fresh verification after expiry during %s entry", async phase => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-01T12:00:00.000Z");
    vi.mocked(startEmailVerification).mockResolvedValue({ ...attempt, expiresAt: new Date(Date.now() + 3000).toISOString() });
    await reachCode();
    if (phase === "profile") { await fill({ code: "012345" }); await submit(); await fill(profile); }
    else await fill({ code: "012345" });
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.querySelector("form")).toBeNull(); expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("This verification has expired.");
    expect(resendEmailVerification).not.toHaveBeenCalled(); expect(onRegister).not.toHaveBeenCalled();
    const priorVerifications = vi.mocked(verifyEmailVerification).mock.calls.length;
    await act(async () => button("Start again").click());
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("member@example.test");
    expect(startEmailVerification).toHaveBeenCalledTimes(1);
    expect(verifyEmailVerification).toHaveBeenCalledTimes(priorVerifications);
    vi.mocked(startEmailVerification).mockResolvedValue({ ...attempt, attemptToken: "fresh_email_attempt", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    await submit(); await fill({ code: "654321" }); await submit();
    expect(verifyEmailVerification).toHaveBeenLastCalledWith("fresh_email_attempt", "654321");
    for (const name of ["displayName", "password", "confirmPassword"]) {
      expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value).toBe("");
    }
    expect(onRegister).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  });

  it("uses native input constraints and rejects invalid email or code before a write", async () => {
    await render();
    const email = container.querySelector<HTMLInputElement>('input[name="email"]')!;
    expect(email.type).toBe("email"); expect(email.required).toBe(true); expect(email.maxLength).toBe(254);
    await fill({ email: "not an email" }); await submit(); expect(startEmailVerification).not.toHaveBeenCalled();
    await fill({ email: "member@example.test" }); await submit();
    const code = container.querySelector<HTMLInputElement>('input[name="code"]')!;
    expect(code.inputMode).toBe("numeric"); expect(code.pattern).toBe("[0-9]{6}"); expect(code.maxLength).toBe(6);
    await fill({ code: "12345" }); await submit(); expect(verifyEmailVerification).not.toHaveBeenCalled();
    await fill({ code: "12345x" }); await submit(); expect(verifyEmailVerification).not.toHaveBeenCalled();
  });

  it.each([
    { displayName: " " }, { displayName: "x".repeat(101) }, { displayName: "Bad\tName" },
    { password: "short", confirmPassword: "short" },
    { password: "x".repeat(129), confirmPassword: "x".repeat(129) },
    { confirmPassword: "different password" }
  ])("rejects invalid final profile values before creation: %j", async overrides => {
    await reachProfile(); await fill({ ...profile, ...overrides }); await submit();
    expect(onRegister).not.toHaveBeenCalled(); expect(container.querySelector("[role=alert]")).not.toBeNull();
    const password = container.querySelector<HTMLInputElement>('input[name="password"]')!;
    expect(password.minLength).toBe(12); expect(password.maxLength).toBe(128);
  });

  it("clears the proof and private fields when changing email", async () => {
    await reachProfile(); await fill(profile);
    await act(async () => button("Use a different email").click());
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("");
    expect(container.querySelector('input[name="password"]')).toBeNull();
    await fill({ email: "other@example.test" }); await submit();
    expect(container.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("");
    await fill({ code: "654321" }); await submit();
    for (const name of ["displayName", "password", "confirmPassword"]) {
      expect(container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value).toBe("");
    }
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("ignores an old send result after the flow is disabled and remounted", async () => {
    const response = deferred<VerificationAttempt>(); vi.mocked(startEmailVerification).mockReturnValue(response.promise);
    await render(); await fill({ email: "member@example.test" }); await submit();
    await render({ enabled: false }); await render();
    await act(async () => response.resolve(attempt));
    expect(container.querySelector('input[name="code"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("");
    expect(onRegister).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  });

  it("ignores a registration completion after unmount", async () => {
    const response = deferred<boolean>(); onRegister.mockReturnValue(response.promise);
    await reachProfile(); await fill(profile); await submit();
    await render({ enabled: false });
    await act(async () => response.resolve(true));
    expect(onComplete).not.toHaveBeenCalled(); expect(container.querySelector("form")).toBeNull();
  });
});
