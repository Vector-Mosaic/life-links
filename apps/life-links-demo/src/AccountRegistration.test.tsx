// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountCreationLink, AccountRegistration } from "./AccountRegistration";
import { LifeLinksIntroduction, PublicInformation, privacyParagraphs, termsParagraphs } from "./PublicInformation";
import { getRegistration, type ApiUser } from "./api";

vi.mock("./api", () => ({ getRegistration: vi.fn() }));

describe("private account registration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRegister: ReturnType<typeof vi.fn>;
  let onLogout: ReturnType<typeof vi.fn>;
  let onComplete: ReturnType<typeof vi.fn>;
  const values = { displayName: "Private Judge", email: "judge@example.test", password: "my private password", confirmPassword: "my private password", invitationCode: "invitation_".padEnd(40, "x") };
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRegistration).mockReset().mockResolvedValue({ enabled: true });
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

  it("offers a factual homepage introduction and whole-app About without implying QR or open-page requirements for remote MCP", async () => {
    await act(async () => root.render(<LifeLinksIntroduction />));
    expect(container.textContent).toContain("QR labels are optional");
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
    await act(async () => root.render(<PublicInformation page="about" />));
    for (const feature of ["My Life Links", "My Collections", "My Routines", "My Calendar", "Search records", "remote MCP connection can work with that page closed", "Vector Mosaic"]) expect(container.textContent).toContain(feature);
    expect(container.textContent).toContain("New private accounts do not copy demo content");
  });
});
