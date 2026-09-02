// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarDialogHost } from "./CalendarDialogs";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";

type Flow = LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionFlow"];
type Management = LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"];
const capabilities = { read: true, create: true, update: true, delete: true };
const discovery: NonNullable<Flow["discovery"]> = {
  providerKey: "google", providerAccountId: "private-numeric-account-identity", accountEmail: "chosen-calendar-owner@example.test",
  calendars: [
    { providerCalendarId: "work/exact+calendar=", displayName: "Work", isDefault: true, capabilities },
    { providerCalendarId: "holidays/exact=", displayName: "Holidays", isDefault: false, capabilities: { read: true, create: false, update: false, delete: false } }
  ]
};
function flow(patch: Partial<Flow> = {}): Flow {
  return { authorizationId: "11111111-1111-4111-8111-111111111111", connectionId: null, loading: false, error: "", feedback: "", discovery, ...patch };
}

describe("compact Calendar connection selection", () => {
  let root: Root;
  let container: HTMLDivElement;
  let controller: LifeLinksWorkspaceController;
  let onClose: ReturnType<typeof vi.fn>;
  let complete: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    complete = vi.fn().mockResolvedValue(undefined);
    cancel = vi.fn().mockResolvedValue(undefined);
    load = vi.fn().mockResolvedValue(undefined);
    onClose = vi.fn();
    controller = { completeCalendarConnectionSelection: complete, cancelCalendarConnectionSelection: cancel, loadCalendarConnectionDiscovery: load } as unknown as LifeLinksWorkspaceController;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  async function render(connectionFlow: Flow, management: Partial<Management> = {}, strict = false) {
    const snapshot = { calendarWorkspace: { calendars: [], connectionFlow, connectionManagement: { calendars: [], connections: [], providers: [], loading: false, loaded: true, error: "", ...management } } } as unknown as LifeLinksWorkspaceSnapshot;
    const host = <CalendarDialogHost dialog={{ kind: "select-calendars" }} controller={controller} snapshot={snapshot} onClose={onClose} />;
    await act(async () => root.render(strict ? <StrictMode>{host}</StrictMode> : host));
  }
  function button(text: string): HTMLButtonElement {
    const node = [...document.querySelectorAll("button")].find((entry) => entry.textContent === text);
    if (!node) throw new Error(`Missing button: ${text}`);
    return node;
  }
  async function click(node: HTMLElement) { await act(async () => node.click()); }
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  }

  it("shows a single focused compact dialog, submits exact per-calendar choices, and stays alive through refresh", async () => {
    await render(flow());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog.classList.contains("ll-dialog-wide")).toBe(false);
    expect(dialog.textContent).toContain("Finish connecting Google Calendar");
    expect(dialog.textContent).toContain("Google Calendar sign-in successful.");
    const accountDetails = dialog.querySelector<HTMLDetailsElement>(".ll-calendar-selection-account")!;
    expect(accountDetails.open).toBe(false);
    expect(accountDetails.textContent).toContain("private-numeric-account-identity");
    expect(dialog.querySelector(".ll-calendar-account-identity")?.textContent).toBe("chosen-calendar-owner@example.test");
    expect(dialog.textContent).not.toContain("Your Life Links calendars");
    const close = dialog.querySelector<HTMLButtonElement>("header button")!;
    expect(document.activeElement).toBe(close);
    const checks = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const workAccess = dialog.querySelector<HTMLSelectElement>('[aria-label="Agent access for Work"]')!;
    const holidayAccess = dialog.querySelector<HTMLSelectElement>('[aria-label="Agent access for Holidays"]')!;
    expect(workAccess.disabled).toBe(true); expect(workAccess.value).toBe("none");
    await click(checks[0]); await choose(workAccess, "write");
    await click(checks[1]); await choose(holidayAccess, "read");
    expect(holidayAccess.querySelector<HTMLOptionElement>('option[value="write"]')!.disabled).toBe(true);
    const connect = button("Connect calendars");
    connect.focus();
    connect.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(connect);
    let finish!: () => void;
    complete.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    await click(connect);
    const signal = complete.mock.calls[0][1] as AbortSignal;
    expect(complete).toHaveBeenCalledWith(["work/exact+calendar=", "holidays/exact="], signal, { "work/exact+calendar=": "write", "holidays/exact=": "read" });
    expect(close.disabled).toBe(true);
    await render(flow({ authorizationId: null, discovery: null }));
    expect(signal.aborted).toBe(false);
    expect(button("Connecting…")).toBeDefined();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("hands off loading and retries within the popout, and Escape cancels the exact flow", async () => {
    await render(flow({ discovery: null }), {}, true);
    expect(load).toHaveBeenCalledTimes(2); // StrictMode abandons only its first effect lifetime.
    expect((load.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    const active = load.mock.calls[1][1] as AbortSignal;
    expect(active.aborted).toBe(false);
    await render(flow({ discovery: null, loading: true }), {}, true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(active.aborted).toBe(false);
    expect(document.body.textContent).toContain("Finding your calendars…");
    await render(flow({ discovery: null, error: "Discovery temporarily unavailable." }), {}, true);
    await click(button("Retry calendar discovery"));
    expect(load).toHaveBeenLastCalledWith(undefined, active);
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(cancel).toHaveBeenCalledWith(active);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps already-connected access visible but non-selectable when adding calendars", async () => {
    await render(flow({ authorizationId: null, connectionId: "connection-exact" }), {
      calendars: [{ connectionId: "connection-exact", providerCalendarId: "work/exact+calendar=", providerDisplayName: "Work", visible: true, capabilities,
        calendar: { id: "local-calendar", agentAccess: "write" } } as Management["calendars"][number]]
    });
    const checks = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks[0].checked).toBe(true); expect(checks[0].disabled).toBe(true);
    expect(document.body.textContent).toContain("Already connected");
    const workAccess = document.querySelector<HTMLSelectElement>('[aria-label="Agent access for Work"]')!;
    expect(workAccess.value).toBe("write"); expect(workAccess.disabled).toBe(true);
    await click(checks[1]);
    await click(button("Connect calendars"));
    expect(complete).toHaveBeenCalledWith(["holidays/exact="], expect.any(AbortSignal), { "holidays/exact=": "none" });
  });

  it("keeps cancellation failure in the compact popout and lets Close retry", async () => {
    cancel.mockRejectedValueOnce(new Error("Cancellation unavailable."));
    await render(flow({ discovery: null, error: "Authorization session expired." }));
    await click(button("Cancel"));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Cancellation unavailable.");
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Close Finish connecting your calendar"]')!);
    expect(cancel).toHaveBeenCalledTimes(2); expect(onClose).toHaveBeenCalledTimes(1);
  });
});
