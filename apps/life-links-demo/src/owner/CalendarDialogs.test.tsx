// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCalendarEventSpan, type CalendarConnectedCalendarPatch, type CalendarConnectedCalendarView, type CalendarConnectionView, type CalendarEventSpanInput, type CalendarProviderEventProjection, type CalendarRecord } from "@life-links/core";
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
const connection: CalendarConnectionView = {
  ownerId: calendar.ownerId, connectionId: "connection-exact-google", providerKey: "google-calendar", providerAccountId: "opaque-google-account",
  accountEmail: "calendar-owner@example.test", status: "active", connectedAt: calendar.createdAt, disconnectedAt: null,
  remoteRevocationStatus: "not_required", remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null
};
function connectedCalendar(id = calendar.id, title = "Work"): CalendarConnectedCalendarView {
  return { connectionId: connection.connectionId, providerCalendarId: `provider/${id}`, providerDisplayName: title, visible: true,
    capabilities: { read: true, create: true, update: true, delete: true }, calendar: { ...calendar, id, title, source: "external" } };
}
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
  let snapshot: LifeLinksWorkspaceSnapshot;
  let activeDialog: NonNullable<CalendarDialogState>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    actions = Object.fromEntries(["loadCalendarConnections", "refreshConnectedCalendarAccount", "removeConnectedCalendar", "removeCalendarConnection", "createNativeCalendar", "updateNativeCalendar", "createNativeCalendarEvent", "updateNativeCalendarEvent", "createExternalCalendarEvent", "updateExternalCalendarEvent", "updateConnectedCalendar"].map((name) => [name, vi.fn().mockResolvedValue(undefined)]));
    actions.getSnapshot = vi.fn(() => snapshot);
    actions.updateConnectedCalendar.mockImplementation(commitConnectedSettings);
    controller = actions as unknown as LifeLinksWorkspaceController; onClose = vi.fn();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function render(dialog: NonNullable<CalendarDialogState>, overrides: Partial<LifeLinksWorkspaceSnapshot["calendarWorkspace"]> = {}, ownerId = calendar.ownerId) {
    activeDialog = dialog;
    snapshot = { currentUser: { id: ownerId }, calendarWorkspace: { calendars: [calendar], events: [], providerEvents: [], providerBindings: [], selectedEvent: null,
      clock: { today: "2026-09-02" }, error: "", connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: "", feedback: "" },
      connectionManagement: { providers: [], connections: [], calendars: [], loading: false, loaded: true, error: "" }, ...overrides } } as unknown as LifeLinksWorkspaceSnapshot;
    await act(async () => root.render(<CalendarDialogHost dialog={dialog} controller={controller} snapshot={snapshot} onClose={onClose} />));
  }
  function publishManagement(management: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"]) {
    snapshot = { ...snapshot, calendarWorkspace: { ...snapshot.calendarWorkspace, connectionManagement: management } };
    root.render(<CalendarDialogHost dialog={activeDialog} controller={controller} snapshot={snapshot} onClose={onClose} />);
  }
  async function commitConnectedSettings(connectionId: string, calendarId: string, expectedUpdatedAt: string, patch: CalendarConnectedCalendarPatch) {
    const management = snapshot.calendarWorkspace.connectionManagement;
    const current = management.calendars.find((entry) => entry.connectionId === connectionId && entry.calendar.id === calendarId);
    if (!current || current.calendar.updatedAt !== expectedUpdatedAt) throw new Error("stale_calendar_revision");
    const saved: CalendarConnectedCalendarView = { ...current, visible: patch.visible ?? current.visible,
      calendar: { ...current.calendar, agentAccess: patch.agentAccess ?? current.calendar.agentAccess,
        updatedAt: new Date(Date.parse(current.calendar.updatedAt) + 1000).toISOString() } };
    publishManagement({ ...management, calendars: management.calendars.map((entry) => entry.calendar.id === calendarId ? saved : entry) });
    return saved;
  }
  async function renderConnected(calendars = [connectedCalendar()], overrides: Partial<LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"]> = {}) {
    await render({ kind: "manage-calendars" }, { connectionManagement: {
      providers: [{ providerKey: "google", displayName: "Google Calendar", authorizationAvailable: true }], connections: [connection],
      calendars, loading: false, loaded: true, error: "", ...overrides
    } });
  }
  it("offers Refresh now for the existing account refresh action", async () => {
    await renderConnected();
    expect([...document.querySelectorAll("button")].some((entry) => entry.textContent?.trim() === "Refresh events")).toBe(false);
    await click(button("Refresh now"));
    expect(actions.refreshConnectedCalendarAccount).toHaveBeenCalledExactlyOnceWith(connection.connectionId, expect.any(AbortSignal));
  });
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
  async function setAgentAccess(name: string, value: string) {
    const field = document.querySelector<HTMLSelectElement>(`select[aria-label="Agent access for ${name}"]`)!;
    await act(async () => { field.value = value; field.dispatchEvent(new Event("change", { bubbles: true })); });
  }

  function removeCalendarButton(name: string) {
    const found = document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name} from LifeLinks"]`);
    if (!found) throw new Error(`Missing local removal for ${name}`);
    return found;
  }
  function removalConfirmation() {
    const found = document.querySelector<HTMLElement>('[aria-label^="Confirm removal from LifeLinks:"]');
    if (!found) throw new Error("Missing local-removal confirmation");
    return found;
  }
  function removalConfirmationButton(text: string) {
    const found = [...removalConfirmation().querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.trim() === text);
    if (!found) throw new Error(`Missing confirmation action: ${text}`);
    return found;
  }

  it.each(["active", "disconnected"] as const)("removes an unavailable calendar locally from a %s account only after exact confirmation", async (status) => {
    const unavailable = { ...connectedCalendar(), visible: false, capabilities: { read: false, create: false, update: false, delete: false }, calendar: { ...connectedCalendar().calendar, agentAccess: "none" as const } };
    await renderConnected([unavailable], { connections: [{ ...connection, status, disconnectedAt: status === "disconnected" ? "2026-09-02T12:00:00Z" : null }] });
    expect(input("Work").disabled).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Agent access for Work"]')!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Provider access unavailable");
    expect(removeCalendarButton("Work").disabled).toBe(false);
    await click(removeCalendarButton("Work"));
    expect(removalConfirmation().textContent).toContain("Work");
    expect(removalConfirmation().textContent).toContain("Google Calendar");
    expect(removalConfirmation().textContent).toContain("calendar-owner@example.test");
    expect(removalConfirmation().textContent).toContain("saved link, cached events and agent access");
    expect(removalConfirmation().textContent).toContain("will not be deleted or changed");
    expect(actions.removeConnectedCalendar).not.toHaveBeenCalled();
    await click(removalConfirmationButton("Cancel"));
    expect(actions.removeConnectedCalendar).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label^="Confirm removal from LifeLinks:"]')).toBeNull();
    await click(removeCalendarButton("Work")); await click(removalConfirmationButton("Yes, remove from LifeLinks"));
    expect(actions.removeConnectedCalendar).toHaveBeenCalledExactlyOnceWith(connection.connectionId, unavailable.calendar.id, unavailable.calendar.updatedAt, expect.any(AbortSignal));
    expect(actions.removeCalendarConnection).not.toHaveBeenCalled();
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
  });

  it.each(["active", "disconnected"] as const)("offers distinct local account removal for %s accounts and pins the clicked connection epoch", async (status) => {
    await renderConnected([connectedCalendar()], { connections: [{ ...connection, status }] });
    if (status === "active") expect(button("Disconnect account")).toBeDefined();
    await click(button("Remove account from LifeLinks"));
    expect(removalConfirmation().textContent).toContain("calendar-owner@example.test");
    expect(removalConfirmation().textContent).toContain("Work");
    expect(removalConfirmation().textContent).toContain("connect the account again from scratch");
    expect(removalConfirmation().textContent).toContain("will not be deleted or changed");
    await click(removalConfirmationButton("Cancel")); expect(actions.removeCalendarConnection).not.toHaveBeenCalled();
    await click(button("Remove account from LifeLinks"));
    await act(async () => publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, connections: [{ ...connection, status, connectedAt: "2026-09-02T15:00:00Z" }] }));
    await click(removalConfirmationButton("Yes, remove from LifeLinks"));
    expect(actions.removeCalendarConnection).toHaveBeenCalledExactlyOnceWith(connection.connectionId, connection.connectedAt, expect.any(AbortSignal));
    expect(actions.removeConnectedCalendar).not.toHaveBeenCalled();
  });

  it("pins calendar revision and labels, retains failures, and never upgrades an old confirmation silently", async () => {
    await renderConnected(); await click(removeCalendarButton("Work"));
    const updated = { ...connectedCalendar(), providerDisplayName: "New provider name", calendar: { ...connectedCalendar().calendar, updatedAt: "2026-09-02T16:00:00Z" } };
    await act(async () => publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, calendars: [updated] }));
    actions.removeConnectedCalendar.mockRejectedValueOnce(new Error("stale_calendar_revision"));
    await click(removalConfirmationButton("Yes, remove from LifeLinks"));
    expect(actions.removeConnectedCalendar).toHaveBeenCalledExactlyOnceWith(connection.connectionId, calendar.id, calendar.updatedAt, expect.any(AbortSignal));
    expect(removalConfirmation().textContent).toContain("Remove “Work”");
    expect(document.body.textContent).toContain("stale_calendar_revision");
    expect(removalConfirmationButton("Cancel").disabled).toBe(false);
    await click(removalConfirmationButton("Cancel"));
    expect(removeCalendarButton("New provider name").disabled).toBe(false);
  });

  it("keeps unrelated row drafts when a calendar is removed and discards only the removed row draft", async () => {
    const second = connectedCalendar("calendar-99999999-9999-4999-8999-999999999999", "Personal");
    await renderConnected([connectedCalendar(), second]);
    await click(input("Work")); await click(input("Personal"));
    await click(removeCalendarButton("Work"));
    actions.removeConnectedCalendar.mockImplementationOnce(async () => {
      publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, calendars: [second] });
    });
    await click(removalConfirmationButton("Yes, remove from LifeLinks"));
    expect(document.querySelector('button[aria-label="Remove Work from LifeLinks"]')).toBeNull();
    expect(input("Personal").checked).toBe(false);
    expect(button("Update").disabled).toBe(false);
    await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledExactlyOnceWith(connection.connectionId, second.calendar.id, second.calendar.updatedAt, { visible: false }, expect.any(AbortSignal));
  });

  it("blocks duplicate removals and conflicting settings writes until the exact request settles", async () => {
    await renderConnected(); await click(input("Work")); await click(removeCalendarButton("Work"));
    let finish!: () => void;
    actions.removeConnectedCalendar.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const confirm = removalConfirmationButton("Yes, remove from LifeLinks");
    await act(async () => { confirm.click(); confirm.click(); });
    expect(actions.removeConnectedCalendar).toHaveBeenCalledTimes(1);
    expect(removalConfirmationButton("Removing…").disabled).toBe(true);
    expect(button("Update").disabled).toBe(true);
    expect(removeCalendarButton("Work").disabled).toBe(true);
    await act(async () => finish());
    expect(button("Update").disabled).toBe(false);
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
  });

  it("aborts local removal on owner replacement and does not publish its late error into the new owner", async () => {
    await renderConnected(); await click(button("Remove account from LifeLinks"));
    let reject!: (issue: Error) => void;
    actions.removeCalendarConnection.mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    await click(removalConfirmationButton("Yes, remove from LifeLinks"));
    const signal = actions.removeCalendarConnection.mock.calls[0][2] as AbortSignal;
    await render({ kind: "manage-calendars" }, {}, "another-owner");
    expect(signal.aborted).toBe(true);
    await act(async () => reject(new Error("old-owner-error")));
    expect(document.body.textContent).not.toContain("old-owner-error");
    expect(document.querySelector('[aria-label^="Confirm removal from LifeLinks:"]')).toBeNull();
    expect(actions.removeCalendarConnection).toHaveBeenCalledTimes(1);
  });

  it("drafts connected settings without early writes, cancels, and saves both choices only on Update", async () => {
    await renderConnected();
    expect(document.querySelector(".ll-calendar-account-identity")?.textContent).toBe("calendar-owner@example.test");
    expect(document.querySelector<HTMLDetailsElement>(".ll-calendar-selection-account")!.open).toBe(false);
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    expect(button("Add calendars from this account")).toBeDefined();
    await click(input("Work")); await setAgentAccess("Work", "write");
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
    expect(input("Work").checked).toBe(false); expect(button("Update")).toBeDefined();
    await click(button("Cancel"));
    expect(input("Work").checked).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Agent access for Work"]')!.value).toBe("read");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
    await click(input("Work")); await setAgentAccess("Work", "write"); await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledExactlyOnceWith(connection.connectionId, calendar.id, calendar.updatedAt,
      { visible: false, agentAccess: "write" }, expect.any(AbortSignal));
    expect(document.body.textContent).toContain("Calendar settings updated.");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    expect(input("Work").checked).toBe(false);
  });

  it("keeps unsaved rows after partial failure and retries only the remaining exact draft", async () => {
    const second = connectedCalendar("calendar-44444444-4444-4444-8444-444444444444", "Personal");
    await renderConnected([connectedCalendar(), second]);
    actions.updateConnectedCalendar.mockImplementationOnce(commitConnectedSettings).mockRejectedValueOnce(new Error("Connection unavailable."));
    await click(input("Work")); await setAgentAccess("Personal", "none"); await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledTimes(2);
    expect(snapshot.calendarWorkspace.connectionManagement.calendars[0].visible).toBe(false);
    expect(snapshot.calendarWorkspace.connectionManagement.calendars[1].calendar.agentAccess).toBe("read");
    expect(document.body.textContent).toContain("1 calendar confirmed. Remaining changes were not confirmed.");
    expect(document.body.textContent).not.toContain("Calendar settings updated.");
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Agent access for Personal"]')!.value).toBe("none");
    const loads = actions.loadCalendarConnections.mock.calls.length;
    await click(button("Update"));
    expect(actions.loadCalendarConnections).toHaveBeenCalledTimes(loads + 1);
    expect(actions.updateConnectedCalendar).toHaveBeenCalledTimes(3);
    expect(actions.updateConnectedCalendar.mock.calls[2]).toEqual([connection.connectionId, second.calendar.id, second.calendar.updatedAt,
      { agentAccess: "none" }, expect.any(AbortSignal)]);
    expect(document.body.textContent).toContain("Calendar settings updated.");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
  });

  it("reconciles a lost save response before retry without repeating the already-applied PATCH", async () => {
    await renderConnected();
    actions.updateConnectedCalendar.mockImplementationOnce(async (...args: Parameters<typeof commitConnectedSettings>) => {
      await commitConnectedSettings(...args); throw new Error("Response lost.");
    });
    await click(input("Work")); await click(button("Update"));
    expect(snapshot.calendarWorkspace.connectionManagement.calendars[0].visible).toBe(false);
    expect(document.body.textContent).toContain("Remaining changes were not confirmed.");
    expect(document.body.textContent).not.toContain("Calendar settings updated.");
    await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledTimes(1);
    expect(actions.loadCalendarConnections).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Calendar settings updated.");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
  });

  it("retains drafts and releases busy state when retry readback fails, then recovers on another Update", async () => {
    await renderConnected();
    actions.updateConnectedCalendar.mockRejectedValueOnce(new Error("Save response unavailable."));
    await click(input("Work")); await click(button("Update"));
    actions.loadCalendarConnections.mockImplementationOnce(async () => {
      publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, loaded: false, loading: false, error: "Connections unavailable." });
      throw new Error("Connections unavailable.");
    });
    await click(button("Update"));
    expect(input("Work").checked).toBe(false);
    expect(button("Update").disabled).toBe(false);
    expect(button("Retry loading connections").disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] > header button')!.disabled).toBe(false);
    expect(actions.updateConnectedCalendar).toHaveBeenCalledTimes(1);
    actions.loadCalendarConnections.mockImplementationOnce(async () => {
      publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, loaded: true, loading: false, error: "" });
    });
    await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Calendar settings updated.");
  });

  it("does not leave Manage calendars locked when a saving connection disappears", async () => {
    await renderConnected();
    let rejectSave!: (error: Error) => void;
    actions.updateConnectedCalendar.mockReturnValueOnce(new Promise<CalendarConnectedCalendarView>((_resolve, reject) => { rejectSave = reject; }));
    await click(input("Work")); await click(button("Update"));
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] > header button')!.disabled).toBe(true);
    const signal = actions.updateConnectedCalendar.mock.calls[0][4] as AbortSignal;
    await act(async () => publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, connections: [], calendars: [] }));
    expect(signal.aborted).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[role="dialog"] > header button')!.disabled).toBe(false);
    await act(async () => rejectSave(new Error("Account unavailable.")));
    expect(button("Connect Google Calendar").disabled).toBe(false);
  });

  it("refuses to overwrite a newer settings revision and Cancel returns to current saved values", async () => {
    await renderConnected();
    await click(input("Work"));
    const management = snapshot.calendarWorkspace.connectionManagement;
    const newer = { ...management.calendars[0], calendar: { ...management.calendars[0].calendar, updatedAt: "2026-09-02T00:00:00.000Z", agentAccess: "none" as const } };
    await act(async () => publishManagement({ ...management, calendars: [newer] }));
    await click(button("Update"));
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("These settings changed elsewhere.");
    await click(button("Cancel"));
    expect(input("Work").checked).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Agent access for Work"]')!.value).toBe("none");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    await click(input("Work")); await click(button("Update"));
    expect(actions.updateConnectedCalendar).toHaveBeenCalledExactlyOnceWith(connection.connectionId, calendar.id, newer.calendar.updatedAt,
      { visible: false }, expect.any(AbortSignal));
  });

  it("discards unsaved settings when closed, reopened, or the owner or connection changes", async () => {
    await renderConnected(); await click(input("Work"));
    await act(async () => root.render(null));
    await renderConnected(); expect(input("Work").checked).toBe(true);
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    await click(input("Work"));
    const replacement = { ...connection, connectionId: "connection-replacement", providerAccountId: "another-account", accountEmail: "another-owner@example.test" };
    await renderConnected([{ ...connectedCalendar(), connectionId: replacement.connectionId }], { connections: [replacement] });
    expect(input("Work").checked).toBe(true); expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    await click(input("Work"));
    const management = snapshot.calendarWorkspace.connectionManagement;
    await render({ kind: "manage-calendars" }, { connectionManagement: { ...management,
      connections: [{ ...replacement, ownerId: "another-owner" }],
      calendars: management.calendars.map((entry) => ({ ...entry, calendar: { ...entry.calendar, ownerId: "another-owner" } }))
    } }, "another-owner");
    expect(input("Work").checked).toBe(true); expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
  });

  it("keeps provider ceilings and reports an acknowledged save separately from an event refresh error", async () => {
    const readonly = { ...connectedCalendar(), capabilities: { read: true, create: false, update: false, delete: false } };
    await renderConnected([readonly]);
    expect(document.querySelector<HTMLOptionElement>('[aria-label="Agent access for Work"] option[value="write"]')!.disabled).toBe(true);
    await setAgentAccess("Work", "write"); await click(button("Update"));
    expect(actions.updateConnectedCalendar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The provider no longer allows these settings.");
    await click(button("Cancel"));
    actions.updateConnectedCalendar.mockImplementationOnce(async (...args: Parameters<typeof commitConnectedSettings>) => {
      const saved = await commitConnectedSettings(...args);
      publishManagement({ ...snapshot.calendarWorkspace.connectionManagement, error: "Settings saved, but events could not be refreshed. Try Refresh now." });
      return saved;
    });
    await setAgentAccess("Work", "none"); await click(button("Update"));
    expect(document.body.textContent).toContain("Calendar settings updated.");
    expect(document.body.textContent).toContain("Settings saved, but events could not be refreshed.");
    expect(document.querySelector(".ll-calendar-settings-actions")).toBeNull();
  });

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
