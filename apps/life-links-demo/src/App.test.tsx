// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderLinkContinuation } from "./App";
import { completeProviderLink } from "./api";
import { captureProviderSignInLink, clearPendingProviderLink, readPendingProviderLink } from "./providerSignInLink";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), completeProviderLink: vi.fn() }));

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
