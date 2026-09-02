// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspacePanel } from "./CalendarPanels";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { CalendarPresentation, LifeLinksWorkspaceSnapshot } from "../workspace/types";
import type { CalendarProviderEventProjection } from "@life-links/core";

describe("Calendar visibility popover", () => {
  let root: Root;
  let container: HTMLDivElement;
  let filter: HTMLDetailsElement;
  let onOpenDialog: ReturnType<typeof vi.fn>;
  let snapshot: LifeLinksWorkspaceSnapshot;
  let render: () => void;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.setItem("life-links-calendar-time-zone", "UTC");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    onOpenDialog = vi.fn();
    const controller = {
      loadCalendarClock: vi.fn().mockResolvedValue(undefined), loadCalendarWindow: vi.fn().mockResolvedValue(undefined),
      setCalendarPresentation: vi.fn((patch: Partial<CalendarPresentation>) => {
        snapshot = { ...snapshot, presentation: { ...snapshot.presentation, calendar: { ...snapshot.presentation.calendar, ...patch } } };
        render();
      })
    } as unknown as LifeLinksWorkspaceController;
    snapshot = {
      presentation: { calendar: { view: "month", timeZone: "UTC", anchorDate: "2026-09-02", selectedDate: "2026-09-02", hiddenNativeCalendarIds: [], selectedEventKey: null } },
      calendarWorkspace: {
        calendars: [{ id: "calendar-home", title: "Home", color: "#79bea6", source: "native", isDefault: true, deletedAt: null }],
        providerBindings: [], selectedEvent: null, selectedProviderEvent: null, events: [], providerEvents: [], loading: false, error: "",
        clock: { timeZone: "UTC", today: "2026-09-02", serverTime: "2026-09-02T12:00:00.000Z" }
      },
      routineWorkspace: { calendarOccurrences: [], routines: [], calendarError: "" }
    } as unknown as LifeLinksWorkspaceSnapshot;
    render = () => root.render(<CalendarWorkspacePanel controller={controller} snapshot={snapshot} onOpenDialog={onOpenDialog} onOpenDetails={vi.fn()} />);
    await act(async () => render());
    filter = container.querySelector<HTMLDetailsElement>(".ll-calendar-filter")!;
    expect(filter).not.toBeNull();
    filter.open = true;
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); localStorage.clear(); vi.unstubAllGlobals();
  });

  it("stays open for internal checkbox changes and closes on an outside pointer press", async () => {
    const checkbox = filter.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
    await act(async () => {
      checkbox.dispatchEvent(new Event("pointerdown", { bubbles: true })); checkbox.click();
    });
    expect(filter.open).toBe(true); expect(checkbox.checked).toBe(false);
    container.querySelector("h1")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(filter.open).toBe(false);
  });

  it("closes on Escape and returns focus to the Calendars trigger", () => {
    const checkbox = filter.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.focus();
    checkbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(filter.open).toBe(false); expect(document.activeElement).toBe(filter.querySelector("summary"));
  });

  it("closes when keyboard focus moves outside", () => {
    filter.querySelector<HTMLInputElement>('input[type="checkbox"]')!.focus();
    expect(filter.open).toBe(true);
    container.querySelector<HTMLSelectElement>(".ll-calendar-zone select")!.focus();
    expect(filter.open).toBe(false);
  });

  it("closes before opening the calendar manager", async () => {
    await act(async () => filter.querySelector<HTMLButtonElement>("button")!.click());
    expect(filter.open).toBe(false);
    expect(onOpenDialog).toHaveBeenCalledExactlyOnceWith({ kind: "manage-calendars" });
  });

  it("restores date, view and even an empty native filter after a peer panel unmount", async () => {
    await act(async () => filter.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".ll-calendar-view-switch button")).find((button) => button.textContent === "Week")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click());
    expect(snapshot.presentation.calendar).toMatchObject({ view: "week", anchorDate: "2026-09-09", hiddenNativeCalendarIds: ["calendar-home"] });
    await act(async () => root.unmount()); root = createRoot(container);
    await act(async () => render());
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Week");
    expect(container.querySelector<HTMLInputElement>('.ll-calendar-filter input[type="checkbox"]')?.checked).toBe(false);
    expect(snapshot.presentation.calendar.anchorDate).toBe("2026-09-09");
  });
});

describe("visible Calendar automatic refresh", () => {
  let root: Root | null;
  let container: HTMLDivElement;
  let snapshot: LifeLinksWorkspaceSnapshot;
  let paused: boolean;
  let visibility: DocumentVisibilityState;
  let online: boolean;
  type LoadOptions = Parameters<LifeLinksWorkspaceController["loadCalendarWindow"]>[0];
  let load: ReturnType<typeof vi.fn<(options: LoadOptions) => Promise<void>>>;
  let performLoad: (options: LoadOptions) => Promise<void>;
  let render: () => void;
  const projection = (title: string): CalendarProviderEventProjection => ({
    ownerId: "owner", connectionId: "connection-google", calendarId: "calendar-external", providerKey: "google-calendar",
    providerAccountId: "test-account", providerCalendarId: "test-calendar", providerEventId: "event", providerRevision: title,
    synchronizedAt: "2026-09-02T12:00:00.000Z", content: { title, description: null, location: null, providerSeriesId: null,
      status: "confirmed", span: { kind: "timed", startUtc: "2026-09-02T12:00:00Z", endUtc: "2026-09-02T12:30:00Z", sourceTimeZone: "UTC", floatingLocalStart: null, floatingLocalEnd: null } }
  });
  beforeEach(async () => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    visibility = "visible"; online = true; paused = false;
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    performLoad = async () => undefined;
    load = vi.fn((options: LoadOptions) => performLoad(options));
    const controller = { loadCalendarClock: vi.fn().mockResolvedValue(undefined), loadCalendarWindow: load,
      setCalendarPresentation: vi.fn((patch: Partial<CalendarPresentation>) => {
        snapshot = { ...snapshot, presentation: { ...snapshot.presentation, calendar: { ...snapshot.presentation.calendar, ...patch } } }; render();
      })
    } as unknown as LifeLinksWorkspaceController;
    snapshot = { currentUser: { id: "owner" },
      presentation: { calendar: { view: "day", timeZone: "UTC", anchorDate: "2026-09-02", selectedDate: "2026-09-02", selectedEventKey: null, hiddenNativeCalendarIds: [] } },
      calendarWorkspace: { calendars: [{ id: "calendar-external", title: "Agent Tests", color: "#79bea6", source: "external", isDefault: false, deletedAt: null }],
        providerBindings: [{ calendarId: "calendar-external", connectionId: "connection-google", visible: true }],
        selectedEvent: null, selectedProviderEvent: null, events: [], providerEvents: [projection("Original event")], loading: false, error: "",
        clock: { timeZone: "UTC", today: "2026-09-02", serverTime: "2026-09-02T12:00:00.000Z" } },
      routineWorkspace: { calendarOccurrences: [], routines: [], calendarError: "" }
    } as unknown as LifeLinksWorkspaceSnapshot;
    render = () => root!.render(<CalendarWorkspacePanel controller={controller} snapshot={snapshot} autoRefreshPaused={paused} onOpenDialog={vi.fn()} onOpenDetails={vi.fn()} />);
    await act(async () => render());
  });
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
  async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
  function backgroundCalls() { return load.mock.calls.filter(([options]) => options.background === true); }
  function wakeBurst() {
    window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online"));
  }

  it("refreshes at 60 seconds and displays returned events without resetting view, filters or scroll", async () => {
    const presentation = structuredClone(snapshot.presentation.calendar);
    const section = container.querySelector<HTMLElement>(".ll-calendar-workspace")!; section.scrollTop = 140;
    const filter = container.querySelector<HTMLDetailsElement>(".ll-calendar-filter")!; filter.open = true;
    performLoad = async (options) => {
      if (!options.background) return;
      snapshot = { ...snapshot, calendarWorkspace: { ...snapshot.calendarWorkspace, providerEvents: [projection("Provider changed event")] } }; render();
    };
    await advance(59_999); expect(backgroundCalls()).toHaveLength(0);
    await advance(1); expect(backgroundCalls()).toHaveLength(1);
    expect(backgroundCalls()[0][0]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-03", background: true, signal: expect.any(AbortSignal) });
    expect(container.textContent).toContain("Provider changed event"); expect(container.textContent).not.toContain("Original event");
    expect(snapshot.presentation.calendar).toEqual(presentation); expect(section.scrollTop).toBe(140); expect(filter.open).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await advance(60_000); expect(backgroundCalls()).toHaveLength(2);
  });

  it("suspends while hidden/offline and coalesces return/focus/online events into one prompt refresh", async () => {
    visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange"));
    await advance(120_000); expect(backgroundCalls()).toHaveLength(0);
    visibility = "visible"; wakeBurst(); await advance(0); expect(backgroundCalls()).toHaveLength(1);
    online = false; window.dispatchEvent(new Event("offline")); await advance(120_000); expect(backgroundCalls()).toHaveLength(1);
    online = true; wakeBurst(); await advance(0); expect(backgroundCalls()).toHaveLength(2);
  });

  it("recovers the exact initially failed window quietly when the browser comes online", async () => {
    await act(async () => root!.unmount()); root = createRoot(container); load.mockClear(); online = false;
    snapshot = { ...snapshot, calendarWorkspace: { ...snapshot.calendarWorkspace, range: null, providerEvents: [] } };
    performLoad = async (options) => {
      if (!online) {
        snapshot = { ...snapshot, calendarWorkspace: { ...snapshot.calendarWorkspace, loading: false, error: "Network unavailable" } }; render();
        throw new Error("Network unavailable");
      }
      expect(options.background).toBe(true);
      snapshot = { ...snapshot, calendarWorkspace: { ...snapshot.calendarWorkspace, range: { startDate: options.startDate, endDate: options.endDate },
        loading: false, error: "", providerEvents: [projection("Recovered provider event")] } }; render();
    };
    await act(async () => render());
    expect(load).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("Network unavailable");
    await advance(120_000); expect(load).toHaveBeenCalledTimes(1);
    online = true; wakeBurst(); await advance(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(backgroundCalls()[0][0]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-03", background: true });
    expect(container.textContent).toContain("Recovered provider event"); expect(container.textContent).not.toContain("Network unavailable");
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("never overlaps a pending refresh and schedules the next attempt from completion even after failure", async () => {
    let finish!: () => void;
    performLoad = async (options) => { if (options.background) await new Promise<void>((resolve) => { finish = resolve; }); };
    await advance(60_000); const pending = backgroundCalls()[0][0];
    wakeBurst(); await advance(180_000); expect(backgroundCalls()).toHaveLength(1); expect(pending.signal!.aborted).toBe(false);
    await act(async () => finish()); performLoad = async () => { throw new Error("temporary read failure"); };
    await advance(59_999); expect(backgroundCalls()).toHaveLength(1);
    await advance(1); expect(backgroundCalls()).toHaveLength(2);
    await advance(59_999); expect(backgroundCalls()).toHaveLength(2);
    await advance(1); expect(backgroundCalls()).toHaveLength(3);
  });

  it("aborts hidden in-flight work and waits for its settlement before one visibility-return refresh", async () => {
    let finish!: () => void;
    performLoad = async (options) => { if (options.background) await new Promise<void>((resolve) => { finish = resolve; }); };
    await advance(60_000); const first = backgroundCalls()[0][0];
    visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); expect(first.signal!.aborted).toBe(true);
    visibility = "visible"; wakeBurst(); await advance(0); expect(backgroundCalls()).toHaveLength(1);
    performLoad = async () => undefined; await act(async () => finish()); await advance(0); expect(backgroundCalls()).toHaveLength(2);
  });

  it("pauses and aborts for open dialogs/confirmations without changing the normal initial-load contract", async () => {
    let finish!: () => void;
    performLoad = async (options) => { if (options.background) await new Promise<void>((resolve) => { finish = resolve; }); };
    await advance(60_000); const first = backgroundCalls()[0][0];
    paused = true; await act(async () => render()); expect(first.signal!.aborted).toBe(true);
    await act(async () => finish()); wakeBurst(); await advance(120_000); expect(backgroundCalls()).toHaveLength(1);
    expect(load.mock.calls.filter(([options]) => !options.background)).toHaveLength(1);
    performLoad = async () => undefined; paused = false; await act(async () => render()); await advance(60_000);
    expect(backgroundCalls()).toHaveLength(2);
  });

  it("aborts on date-window change and unmount and does not leave refresh listeners or timers behind", async () => {
    let finish!: () => void;
    performLoad = async (options) => { if (options.background) await new Promise<void>((resolve) => { finish = resolve; }); };
    await advance(60_000); const first = backgroundCalls()[0][0];
    snapshot = { ...snapshot, presentation: { ...snapshot.presentation, calendar: { ...snapshot.presentation.calendar, anchorDate: "2026-09-04", selectedDate: "2026-09-04" } } };
    await act(async () => render()); expect(first.signal!.aborted).toBe(true);
    expect(load.mock.calls.at(-1)![0]).toMatchObject({ startDate: "2026-09-03", endDate: "2026-09-05" });
    await act(async () => finish()); await advance(60_000); const second = backgroundCalls()[1][0];
    expect(second).toMatchObject({ startDate: "2026-09-03", endDate: "2026-09-05", background: true });
    await act(async () => root!.unmount()); root = null; expect(second.signal!.aborted).toBe(true);
    await act(async () => finish()); wakeBurst(); await advance(180_000); expect(backgroundCalls()).toHaveLength(2);
  });
});
