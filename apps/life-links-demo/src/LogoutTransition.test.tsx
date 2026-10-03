// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalLifeLink, summarizeLifeLink } from "@life-links/core";
import App from "./App";
import { clearPendingInvitation } from "./invitationLink";
import { clearPendingProviderLink, clearProviderSignInError } from "./providerSignInLink";
import { installNativeRuntime, LIFE_LINKS_PRODUCTION_ORIGIN, nativeRuntime, type LifeLinksNativeRuntime } from "./platform";
import { LifeLinksWorkspaceController } from "./workspace/controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

const timestamp = "2026-10-03T12:00:00.000Z";
const owner = { id: "logout-owner", email: "owner@example.test", displayName: "Fixture owner", createdAt: timestamp };
const privateRecord = createCanonicalLifeLink({ id: "life-link-logout-private", ownerId: owner.id, parentId: null,
  title: "Private logout marker", browsingRole: "container", createdAt: timestamp });
const browserUrl = `${LIFE_LINKS_PRODUCTION_ORIGIN}/api/auth/native/launch?ticket=fixture-one-use`;

describe("native logout through the current application", () => {
  let root: Root; let host: HTMLDivElement; let originalUrl: string;
  let previousRuntime: LifeLinksNativeRuntime | null;
  let originalMatchMedia: typeof window.matchMedia;
  let serverAttempts: Array<ReturnType<typeof deferred<Response>>>;
  let clearAttempts: Array<ReturnType<typeof deferred<void>>>;
  let authenticated: boolean;
  let unexpectedRequests: string[];
  let currentController: () => LifeLinksWorkspaceController;
  let request: ReturnType<typeof vi.fn<LifeLinksNativeRuntime["request"]>>;
  let clearSession: ReturnType<typeof vi.fn<LifeLinksNativeRuntime["clearSession"]>>;
  let startBrowserFlow: ReturnType<typeof vi.fn<LifeLinksNativeRuntime["startBrowserFlow"]>>;
  let openBrowser: ReturnType<typeof vi.fn<LifeLinksNativeRuntime["openBrowser"]>>;
  let fetchFallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    fetchFallback = vi.fn().mockRejectedValue(new Error("The native app must use its installed transport."));
    vi.stubGlobal("fetch", fetchFallback);
    clearPendingInvitation(); clearPendingProviderLink(); clearProviderSignInError();
    originalUrl = window.location.pathname + window.location.search + window.location.hash;
    window.history.replaceState(null, "", "/life-links");
    previousRuntime = nativeRuntime();
    serverAttempts = [deferred<Response>(), deferred<Response>()];
    clearAttempts = [deferred<void>(), deferred<void>()];
    authenticated = true; unexpectedRequests = [];
    let serverAttempt = 0; let clearAttempt = 0;
    request = vi.fn<LifeLinksNativeRuntime["request"]>(async (path, init) => {
      const pathname = new URL(path, LIFE_LINKS_PRODUCTION_ORIGIN).pathname;
      if (pathname === "/api/auth/logout" && init.method === "POST") return serverAttempts[serverAttempt++].promise;
      if (pathname === "/api/config") return json({ qrBaseUrl: `${LIFE_LINKS_PRODUCTION_ORIGIN}/qr`, maxBatchCount: 20 });
      if (pathname === "/api/me") return json({ user: authenticated ? owner : null,
        agentConnection: { connected: false, connectedAt: null, toolCatalogId: null }, qrBaseUrl: `${LIFE_LINKS_PRODUCTION_ORIGIN}/qr` });
      if (pathname === "/api/links") return json({ links: [] });
      if (pathname === "/api/life-links") return json({ lifeLinks: [summarizeLifeLink(privateRecord, 0)], nextCursor: null, truncated: false });
      if (pathname === `/api/life-links/${privateRecord.id}/collection-memberships`) return json({ memberships: [], nextCursor: null, truncated: false });
      if (pathname === "/api/change-history") return json({ limit: 5, entries: [] });
      if (pathname === "/api/remote-agent-connections") return json({ available: false, authorizedCount: 0 });
      if (!authenticated && pathname === "/api/auth/providers") return json({ providers: [{ id: "google", label: "Google" }, { id: "apple", label: "Apple" }] });
      if (!authenticated && pathname === "/api/auth/registration") return json({ enabled: true, emailVerificationEnabled: true, phoneVerificationEnabled: false });
      unexpectedRequests.push(pathname);
      throw new Error(`Unexpected native request: ${pathname}`);
    });
    clearSession = vi.fn<LifeLinksNativeRuntime["clearSession"]>(async () => {
      // The old custody remains usable until the independent device operation completes.
      await clearAttempts[clearAttempt++].promise;
      authenticated = false;
    });
    startBrowserFlow = vi.fn<LifeLinksNativeRuntime["startBrowserFlow"]>().mockResolvedValue(browserUrl);
    openBrowser = vi.fn<LifeLinksNativeRuntime["openBrowser"]>().mockResolvedValue(undefined);
    installNativeRuntime({ request, clearSession, startBrowserFlow, openBrowser,
      openExternalLink: vi.fn().mockResolvedValue(undefined), loadMedia: vi.fn().mockResolvedValue("fixture-media"),
      releaseMedia: vi.fn().mockResolvedValue(undefined), shareDownload: vi.fn().mockResolvedValue(undefined),
      shareBlob: vi.fn().mockResolvedValue(undefined), shareUrl: vi.fn().mockResolvedValue(undefined),
      capturePhoto: vi.fn().mockRejectedValue(new Error("Camera capture is outside this test.")),
      scanQr: vi.fn().mockRejectedValue(new Error("QR capture is outside this test.")) });
    // Observe the actual controller called by the account menu; the spy calls through.
    const logout = vi.spyOn(LifeLinksWorkspaceController.prototype, "logout");
    currentController = () => logout.mock.contexts[0] as LifeLinksWorkspaceController;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    // Restore even the null web default without adding a production test-only setter.
    installNativeRuntime(previousRuntime as LifeLinksNativeRuntime);
    window.history.replaceState(null, "", originalUrl);
    window.matchMedia = originalMatchMedia;
    clearPendingInvitation(); clearPendingProviderLink(); clearProviderSignInError();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  function requestsTo(pathname: string) {
    return request.mock.calls.filter(([path]) => new URL(path, LIFE_LINKS_PRODUCTION_ORIGIN).pathname === pathname);
  }

  function button(text: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text);
    expect(found, text).toBeTruthy(); return found!;
  }

  function assertEntryBlocked() {
    expect(host.querySelector(".loading-shell")).not.toBeNull();
    expect(host.querySelector('[data-provider="google"]')).toBeNull();
    expect(host.querySelector('[data-provider="apple"]')).toBeNull();
    expect(host.querySelector('input[autocomplete="username"]')).toBeNull();
    expect(host.querySelector('input[autocomplete="current-password"]')).toBeNull();
    expect(requestsTo("/api/auth/providers")).toHaveLength(0);
    expect(requestsTo("/api/auth/registration")).toHaveLength(0);
    expect(startBrowserFlow).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(privateRecord.title);
    expect(host.querySelector('[aria-label="Account"]')).toBeNull();
    expect(currentController().getSnapshot().currentUser).toBeNull();
    expect(currentController().getSnapshot().rootLifeLinks.items).toEqual([]);
    expect(currentController().getSnapshot().links).toEqual([]);
    expect(currentController().getSnapshot().loading).toBe(true);
    expect(unexpectedRequests).toEqual([]);
  }

  async function logoutFromOwner() {
    await act(async () => root.render(<App />));
    expect(host.textContent).toContain(privateRecord.title);
    expect(requestsTo("/api/me")).toHaveLength(1);
    expect(requestsTo("/api/auth/providers")).toHaveLength(0);
    await act(async () => button("Account").click());
    const logout = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(node => node.textContent?.trim() === "Logout");
    expect(logout).toBeTruthy();
    await act(async () => logout!.click());
    expect(requestsTo("/api/auth/logout")).toHaveLength(1);
    expect(clearSession).not.toHaveBeenCalled();
    assertEntryBlocked();
  }

  async function assertEntryReadyAndStart(provider: "google" | "apple") {
    expect(host.querySelector(".loading-shell")).toBeNull();
    expect(currentController().getSnapshot().loading).toBe(false);
    for (const id of ["google", "apple"]) {
      const option = host.querySelector<HTMLButtonElement>(`[data-provider="${id}"]`);
      expect(option).not.toBeNull(); expect(option?.disabled).toBe(false);
    }
    for (const selector of ['input[autocomplete="username"]', 'input[autocomplete="current-password"]', '.login-panel button[type="submit"]']) {
      const control = host.querySelector<HTMLInputElement | HTMLButtonElement>(selector);
      expect(control).not.toBeNull(); expect(control?.disabled).toBe(false);
    }
    expect(host.querySelector('[aria-label="Account"]')).toBeNull();
    expect(host.textContent).not.toContain(privateRecord.title);
    expect(requestsTo("/api/auth/providers")).toHaveLength(1);
    expect(requestsTo("/api/auth/registration")).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(startBrowserFlow).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-provider="${provider}"]`)!.click());
    expect(startBrowserFlow).toHaveBeenCalledExactlyOnceWith({ provider, intent: "login", returnTo: "/life-links" });
    expect(openBrowser).toHaveBeenCalledExactlyOnceWith(browserUrl);
    expect(unexpectedRequests).toEqual([]); expect(fetchFallback).not.toHaveBeenCalled();
  }

  it.each([
    { serverFails: false, provider: "google" as const },
    { serverFails: true, provider: "apple" as const }
  ])("clears private presentation immediately and waits for native custody after server failure=$serverFails", async ({ serverFails, provider }) => {
    await logoutFromOwner();
    await act(async () => {
      if (serverFails) serverAttempts[0].reject(new Error("Synthetic remote logout failure."));
      else serverAttempts[0].resolve(new Response(null, { status: 204 }));
    });
    expect(clearSession).toHaveBeenCalledTimes(1);
    assertEntryBlocked();
    // A native completion event restarts the real provider/controller lifecycle.
    await act(async () => window.dispatchEvent(new Event("lifelinks-native-auth-complete")));
    expect(requestsTo("/api/me")).toHaveLength(1);
    assertEntryBlocked();
    await act(async () => clearAttempts[0].resolve(undefined));
    expect(requestsTo("/api/me")).toHaveLength(2);
    await assertEntryReadyAndStart(provider);
  });

  it("keeps entry blocked after device clear fails, survives restart, and releases it only after explicit sign-out retry", async () => {
    await logoutFromOwner();
    await act(async () => serverAttempts[0].resolve(new Response(null, { status: 204 })));
    expect(clearSession).toHaveBeenCalledTimes(1); assertEntryBlocked();
    await act(async () => clearAttempts[0].reject(new Error("Synthetic private device-clear diagnostic.")));
    assertEntryBlocked();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("We couldn't finish signing out on this device. Try signing out again.");
    expect(host.textContent).not.toContain("Synthetic private device-clear diagnostic");
    expect(button("Try signing out again").disabled).toBe(false);
    await act(async () => window.dispatchEvent(new Event("lifelinks-native-auth-complete")));
    expect(requestsTo("/api/me")).toHaveLength(1); assertEntryBlocked();
    await act(async () => button("Try signing out again").click());
    expect(requestsTo("/api/auth/logout")).toHaveLength(2);
    expect(clearSession).toHaveBeenCalledTimes(1); assertEntryBlocked();
    // Remote failure on retry still cannot skip clearing the local credential.
    await act(async () => serverAttempts[1].reject(new Error("Synthetic remote retry failure.")));
    expect(clearSession).toHaveBeenCalledTimes(2); assertEntryBlocked();
    await act(async () => clearAttempts[1].resolve(undefined));
    await assertEntryReadyAndStart("google");
  });
});
