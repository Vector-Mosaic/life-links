// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspacePanel } from "./CalendarPanels";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";

describe("Calendar visibility popover", () => {
  let root: Root;
  let container: HTMLDivElement;
  let filter: HTMLDetailsElement;
  let onOpenDialog: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.setItem("life-links-calendar-time-zone", "UTC");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    onOpenDialog = vi.fn();
    const controller = { loadCalendarClock: vi.fn().mockResolvedValue(undefined), loadCalendarWindow: vi.fn().mockResolvedValue(undefined) } as unknown as LifeLinksWorkspaceController;
    const snapshot = {
      calendarWorkspace: {
        calendars: [{ id: "calendar-home", title: "Home", color: "#79bea6", source: "native", isDefault: true, deletedAt: null }],
        providerBindings: [], selectedEvent: null, selectedProviderEvent: null, events: [], providerEvents: [], loading: false, error: "",
        clock: { timeZone: "UTC", today: "2026-09-02", serverTime: "2026-09-02T12:00:00.000Z" }
      },
      routineWorkspace: { calendarOccurrences: [], routines: [], calendarError: "" }
    } as unknown as LifeLinksWorkspaceSnapshot;
    await act(async () => root.render(<CalendarWorkspacePanel controller={controller} snapshot={snapshot} onOpenDialog={onOpenDialog} onOpenDetails={vi.fn()} />));
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
});
