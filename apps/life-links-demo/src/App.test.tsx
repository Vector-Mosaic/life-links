// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIFE_LINKS_SMS_VERIFICATION_CONSENT } from "@life-links/core";
import App, { useProviderLinkContinuation } from "./App";
import { completeProviderLink } from "./api";
import { captureProviderSignInLink, clearPendingProviderLink, readPendingProviderLink } from "./providerSignInLink";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), completeProviderLink: vi.fn() }));

describe("public SMS opt-in information", () => {
  let container: HTMLDivElement; let root: Root; let originalUrl: string;
  const fetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetch.mockReset().mockRejectedValue(new Error("Public information must not send requests."));
    vi.stubGlobal("fetch", fetch);
    clearPendingProviderLink();
    originalUrl = window.location.pathname + window.location.search + window.location.hash;
    window.history.replaceState(null, "", "/about#sms-verification");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove();
    window.history.replaceState(null, "", originalUrl);
    vi.unstubAllGlobals();
  });

  it("explains the prepared flow and exact shared disclosure without activating phone verification", async () => {
    await act(async () => root.render(<App />));
    const section = container.querySelector("#sms-verification");
    expect(section?.querySelector("h2")?.textContent).toBe("SMS verification and consent");
    expect(section?.textContent).toContain("awaiting carrier approval");
    expect(section?.textContent).toContain("Phone verification is not available yet.");
    const steps = section?.querySelectorAll("ol li");
    expect(steps).toHaveLength(4);
    expect(steps?.[0].textContent).toContain("Continue with phone");
    expect(steps?.[0].textContent).toContain("Link phone number");
    expect(steps?.[1].textContent).toContain("checkbox starts unchecked");
    expect(steps?.[2].textContent).toContain("Send code");
    expect(steps?.[2].textContent).toContain("six-digit");
    expect(steps?.[3].textContent).toContain("display name");
    const disclosure = section?.querySelector("blockquote");
    const consent = LIFE_LINKS_SMS_VERIFICATION_CONSENT;
    expect(disclosure?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      `${consent.permission} ${consent.frequency} ${consent.keywords} Support: ${consent.supportEmail}. ${consent.retentionNotice} Terms and Privacy.`);
    expect(disclosure?.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(disclosure?.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(disclosure?.querySelector(`a[href="mailto:${consent.supportEmail}"]`)).not.toBeNull();
    expect(section?.querySelector("input, button, form")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("provider link callback continuation", () => {
  let container: HTMLDivElement; let root: Root;
  const token = "synthetic_link_".padEnd(43, "x");
  const onNavigate = vi.fn(); const onError = vi.fn();
  function Harness({ loading }: { loading: boolean }) {
    useProviderLinkContinuation(loading, onError, onNavigate); return null;
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    clearPendingProviderLink(); onNavigate.mockReset(); onError.mockReset();
    vi.mocked(completeProviderLink).mockReset().mockResolvedValue({ returnTo: "/collections" });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearPendingProviderLink(); vi.unstubAllGlobals(); });
  function capture() {
    captureProviderSignInLink({ pathname: "/", search: "", hash: `#link=${token}` }, { state: null, replaceState: vi.fn() });
  }
  async function render(loading: boolean) { await act(async () => root.render(<StrictMode><Harness loading={loading} /></StrictMode>)); }

  it("waits for canonical account bootstrap and completes the explicit link exactly once under StrictMode", async () => {
    capture(); await render(true);
    expect(completeProviderLink).not.toHaveBeenCalled(); expect(readPendingProviderLink()).toBe(token);
    await render(false); await render(false);
    expect(completeProviderLink).toHaveBeenCalledExactlyOnceWith(token);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/collections");
    expect(readPendingProviderLink()).toBe(""); expect(onError).not.toHaveBeenCalled();
  });

  it("does not complete a link without a captured callback and validates the return route", async () => {
    await render(false); expect(completeProviderLink).not.toHaveBeenCalled();
    capture(); vi.mocked(completeProviderLink).mockResolvedValue({ returnTo: "https://unexpected.example.test" });
    await render(true); await render(false);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/life-links");
  });

  it("reconciles failure through friendly instructions without repeating the completion or exposing callback content", async () => {
    capture(); vi.mocked(completeProviderLink).mockRejectedValue(new Error(`private provider error ${token}`));
    await render(false); await render(true); await render(false);
    expect(completeProviderLink).toHaveBeenCalledExactlyOnceWith(token);
    expect(onNavigate).not.toHaveBeenCalled(); expect(readPendingProviderLink()).toBe("");
    expect(onError.mock.calls[0][0]).toContain("Open Sign-in methods to check");
    expect(onError.mock.calls[0][0]).not.toContain(token);
  });
});
