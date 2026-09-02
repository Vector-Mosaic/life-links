// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCalendarEventSpan, type CalendarEventSpanInput, type CalendarProviderEventProjection, type CalendarRecord } from "@life-links/core";
import { CalendarDialogHost, type CalendarDialogState } from "./CalendarDialogs";
import type { CalendarEventDetail } from "../api";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";

const calendar: CalendarRecord = {
  id: "calendar-11111111-1111-4111-8111-111111111111", ownerId: "owner-calendar", title: "Home",
  color: "#7FC9B3", timeZone: "America/New_York", source: "native", agentAccess: "read", isDefault: true,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", deletedAt: null
};
const timed: CalendarEventSpanInput = { kind: "zoned", startLocalDateTime: "2026-09-02T23:00", endLocalDateTime: "2026-09-04T01:00", timeZone: "America/New_York" };
const allDay: CalendarEventSpanInput = { kind: "all_day", startDate: "2026-09-02", endDateExclusive: "2026-09-05" };
function nativeEvent(span: CalendarEventSpanInput): CalendarEventDetail {
  return {
    event: { id: "calendar-event-22222222-2222-4222-8222-222222222222", ownerId: calendar.ownerId, calendarId: calendar.id,
      currentRevisionId: "calendar-event-revision-33333333-3333-4333-8333-333333333333", lineage: { kind: "recurrence_master" },
      createdAt: calendar.createdAt, updatedAt: calendar.updatedAt, deletedAt: null },
    currentRevision: { id: "calendar-event-revision-33333333-3333-4333-8333-333333333333", ownerId: calendar.ownerId,
      eventId: "calendar-event-22222222-2222-4222-8222-222222222222", revisionNumber: 1, title: "Existing trip", description: "", location: "", status: "confirmed",
      span: normalizeCalendarEventSpan(span), recurrence: { frequency: "monthly", interval: 1, monthDays: [2, 15], end: { kind: "count", count: 4 } },
      subjectLinks: [], createdAt: calendar.createdAt }
  };
}

describe("Calendar manager and event form", () => {
  let root: Root;
  let container: HTMLDivElement;
  let actions: Record<string, ReturnType<typeof vi.fn>>;
  let controller: LifeLinksWorkspaceController;
  let onClose: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    actions = Object.fromEntries(["loadCalendarConnections", "createNativeCalendar", "updateNativeCalendar", "createNativeCalendarEvent", "updateNativeCalendarEvent", "createExternalCalendarEvent", "updateExternalCalendarEvent"].map((name) => [name, vi.fn().mockResolvedValue(undefined)]));
    controller = actions as unknown as LifeLinksWorkspaceController; onClose = vi.fn();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function render(dialog: NonNullable<CalendarDialogState>, overrides: Partial<LifeLinksWorkspaceSnapshot["calendarWorkspace"]> = {}) {
    const snapshot = { calendarWorkspace: { calendars: [calendar], events: [], providerEvents: [], providerBindings: [], selectedEvent: null,
      clock: { today: "2026-09-02" }, error: "", connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: "", feedback: "" },
      connectionManagement: { providers: [], connections: [], calendars: [], loading: false, loaded: true, error: "" }, ...overrides } } as unknown as LifeLinksWorkspaceSnapshot;
    await act(async () => root.render(<CalendarDialogHost dialog={dialog} controller={controller} snapshot={snapshot} onClose={onClose} />));
  }
  function button(text: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.trim() === text);
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
  }
  function input(text: string) {
    const label = [...document.querySelectorAll("label")].find((entry) => entry.firstChild?.textContent?.trim() === text || entry.textContent?.trim() === text);
    const found = label?.querySelector<HTMLInputElement>("input");
    if (!found) throw new Error(`Missing input: ${text}`);
    return found;
  }
  async function click(node: HTMLElement) { await act(async () => node.click()); }
  async function setInput(text: string, value: string) {
    const field = input(text);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  }

  it("opens native editing only by selection or New, cancels drafts, and hides the editor after a save", async () => {
    await render({ kind: "manage-calendars" });
    expect(document.querySelector("form")).toBeNull();
    expect(document.body.textContent).toContain("External calendars");
    await click(document.querySelector<HTMLButtonElement>(".ll-calendar-manager-list button")!);
    expect(input("Name").value).toBe("Home");
    expect(input("Use as my default Calendar").checked).toBe(true);
    expect(input("Use as my default Calendar").closest("label")?.className).toBe("ll-checkbox-label");
    expect(document.querySelector<HTMLSelectElement>("form label select")!.value).toBe("America/New_York");
    expect(document.querySelector<HTMLSelectElement>("form label:last-of-type select")!.value).toBe("read");
    expect(document.querySelector(".ll-calendar-manager-editing")).not.toBeNull();
    await setInput("Name", "Unsaved"); await click(button("Cancel editor"));
    expect(document.querySelector("form")).toBeNull(); expect(actions.updateNativeCalendar).not.toHaveBeenCalled();
    await click(button("New Calendar"));
    expect(input("Name").value).toBe(""); expect(input("Use as my default Calendar").checked).toBe(false);
    await setInput("Name", "Travel"); await submit();
    expect(actions.createNativeCalendar).toHaveBeenCalledWith(expect.objectContaining({ title: "Travel", agentAccess: "write", isDefault: false }));
    expect(document.querySelector("form")).toBeNull(); expect(onClose).not.toHaveBeenCalled();
    await click(document.querySelector<HTMLButtonElement>(".ll-calendar-manager-list button")!);
    expect(input("Name").value).toBe("Home");
    await setInput("Name", "Home calendar"); await submit();
    expect(actions.updateNativeCalendar).toHaveBeenCalledWith(calendar.id, calendar.updatedAt, expect.objectContaining({ title: "Home calendar", agentAccess: "read", isDefault: true }));
    expect(document.querySelector("form")).toBeNull();
  });

  it.each([false, true])("creates a single selected day with all-day=%s independently from multi-day", async (isAllDay) => {
    await render({ kind: "new-event", date: "2026-09-12" });
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(input("Date").value).toBe("2026-09-12");
    expect(input("Multi-day event").checked).toBe(false);
    if (isAllDay) await click(input("All-day event"));
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(isAllDay ? 0 : 2);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    await setInput("Title", "One day"); await submit();
    expect(actions.createNativeCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: calendar.id, title: "One day", recurrence: null, lineage: { kind: "standalone" },
      span: isAllDay ? { kind: "all_day", startDate: "2026-09-12", endDateExclusive: "2026-09-13" }
        : { kind: "zoned", startLocalDateTime: "2026-09-12T09:00", endLocalDateTime: "2026-09-12T10:00", timeZone: "America/New_York" }
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("turning multi-day off discards the former end date for all-day=%s", async (isAllDay) => {
    await render({ kind: "new-event", date: "2026-09-12" });
    await setInput("Title", "One day again");
    await click(input("Multi-day event"));
    expect(input("End date").value).toBe("2026-09-13");
    await setInput("End date", "2026-09-20");
    if (isAllDay) await click(input("All-day event"));
    expect(input("Multi-day event").checked).toBe(true);
    await click(input("Multi-day event"));
    await setInput("Date", "2026-09-14"); await submit();
    expect(actions.createNativeCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      span: isAllDay ? { kind: "all_day", startDate: "2026-09-14", endDateExclusive: "2026-09-15" }
        : { kind: "zoned", startLocalDateTime: "2026-09-14T09:00", endLocalDateTime: "2026-09-14T10:00", timeZone: "America/New_York" }
    }));
  });

  it.each([timed, allDay])("preserves existing native $kind multi-day timing and exact recurrence on a title edit", async (span) => {
    const detail = nativeEvent(span);
    await render({ kind: "edit-event", eventId: detail.event.id }, { events: [detail] });
    expect(input("Multi-day event").checked).toBe(true);
    expect(input("Start date").value).toBe("2026-09-02"); expect(input("End date").value).toBe("2026-09-04");
    expect(input("All-day event").checked).toBe(span.kind === "all_day");
    await setInput("Title", "Renamed trip"); await submit();
    expect(actions.updateNativeCalendarEvent).toHaveBeenCalledWith(detail.event.id, expect.objectContaining({
      expectedCurrentRevisionId: detail.event.currentRevisionId, span, recurrence: detail.currentRevision.recurrence,
      target: { scope: "series", masterEventId: detail.event.id }, subjectLinks: detail.currentRevision.subjectLinks
    }));
  });

  it("refuses reversed dates or timed order without invoking a mutation", async () => {
    await render({ kind: "new-event", date: "2026-09-12" });
    await setInput("Title", "Invalid time"); await setInput("End time", "08:00"); await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Timed event end must follow its start");
    expect(actions.createNativeCalendarEvent).not.toHaveBeenCalled();
    await click(input("Multi-day event")); await setInput("End date", "2026-09-11"); await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("must end after its start date");
    expect(actions.createNativeCalendarEvent).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves the exact existing provider span and identities with all-day=%s", async (isAllDay) => {
    const span = isAllDay ? allDay as Extract<CalendarEventSpanInput, { kind: "all_day" }>
      : { kind: "timed" as const, startUtc: "2026-09-03T03:00:25.321Z", endUtc: "2026-09-04T05:00:36.654Z", sourceTimeZone: "America/New_York", floatingLocalStart: "2026-09-02T23:00:25", floatingLocalEnd: "2026-09-04T01:00:36" };
    const event: CalendarProviderEventProjection = { connectionId: "exact-connection", calendarId: calendar.id, ownerId: calendar.ownerId,
      providerKey: "google-calendar", providerAccountId: "exact-account", providerCalendarId: "exact-calendar", providerEventId: "exact-event", providerRevision: "exact-revision", synchronizedAt: calendar.updatedAt,
      content: { title: "Provider trip", description: null, location: null, status: "confirmed", span, providerSeriesId: null,
        providerRecurrence: { kind: "single", originalStartUtc: null }, outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false } } };
    const reference = { authority: "provider" as const, connectionId: event.connectionId, calendarId: event.calendarId, providerEventId: event.providerEventId };
    await render({ kind: "edit-provider-event", reference }, { calendars: [{ ...calendar, source: "external" }], providerEvents: [event],
      providerBindings: [{ connectionId: event.connectionId, calendarId: event.calendarId, providerKey: event.providerKey, providerAccountId: event.providerAccountId, providerCalendarId: event.providerCalendarId, visible: true, capabilities: { read: true, create: true, update: true, delete: true } }] });
    expect(input("Multi-day event").checked).toBe(true);
    expect(input("End date").value).toBe("2026-09-04");
    await setInput("Title", "Renamed provider trip"); await submit();
    expect(actions.updateExternalCalendarEvent).toHaveBeenCalledWith(event.providerEventId, expect.objectContaining({
      authority: "provider", calendarId: event.calendarId, connectionId: event.connectionId, expectedProviderRevision: event.providerRevision, scope: "event",
      content: expect.objectContaining({ title: "Renamed provider trip", span: event.content.span })
    }));
    expect(actions.createExternalCalendarEvent).not.toHaveBeenCalled();
  });
});
