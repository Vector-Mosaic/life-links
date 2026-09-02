import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  resolveCalendarZonedDateTime,
  type CalendarEventDefinition,
  type CalendarConnectionView,
  type CalendarRecord,
  type CalendarProviderEventProjection,
  type RoutineOccurrenceRecord,
  type RoutineSummaryRecord
} from "@life-links/core";

import { buildCalendarDisplayEvents, calendarRange, shiftCalendarAnchor, providerEventCanMutate, providerSpanForEditor, providerWritableSpan } from "./calendar";
import { CalendarDialogHost } from "./CalendarDialogs";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import type { LifeLinksWorkspaceController } from "../workspace/controller";

vi.mock("./FieldLedgerPrimitives", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children
}));

const ownerId = "owner-calendar-test";
const calendar: CalendarRecord = {
  id: "calendar-11111111-1111-4111-8111-111111111111",
  ownerId,
  title: "Home",
  color: "#7FC9B3",
  timeZone: "America/New_York",
  source: "native",
  agentAccess: "write",
  isDefault: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null
};

describe("Calendar manager permission presentation", () => {
  it("shows the persisted native permission and all three explicit choices independently from visibility", () => {
    const markup = calendarManagerMarkup([{ ...calendar, agentAccess: "none" }]);
    expect(markup).toContain("Agent: No access");
    expect(markup).toContain('<option value="none">No access</option>');
    expect(markup).toContain('<option value="read">Read only</option>');
    expect(markup).toContain('<option value="write" selected="">Read and edit</option>');
    expect(markup).toContain("Showing or hiding a Calendar does not change agent access");
    expect(markup).toContain("Calendar-v2 grant");
  });

  it("does not present provider calendars as editable native calendars or pretend OAuth is available", () => {
    const markup = calendarManagerMarkup([{ ...calendar, source: "external", title: "Provider-owned calendar" }]);
    expect(markup).not.toContain("Provider-owned calendar");
    expect(markup).toContain("New account connections are not available yet");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Connect Google Calendar<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Connect Microsoft Outlook<\/button>/);
  });

  it("renders only controller-provided bound calendars and caps external agent choices to provider capabilities", () => {
    const markup = calendarManagerMarkup([], {
      connections: [connection()],
      calendars: [{ calendar: { ...calendar, source: "external", agentAccess: "read" }, connectionId: "connection-test", providerCalendarId: "calendar-provider-test", providerDisplayName: "Work schedule", capabilities: { read: true, create: false, update: false, delete: false }, visible: true }]
    });
    expect(markup).toContain("Work schedule");
    expect(markup).toContain("Provider is read only");
    expect(markup).toContain('<option value="write" disabled="">Read and allowed changes</option>');
    expect(markup).toContain('type="checkbox" checked=""');
    expect(markup).toContain("Visibility does not change agent access");
    expect(markup).toContain("Finding additional calendars for this account is not available yet");
    expect(markup).toContain("Disconnect account");
  });

  it("distinguishes local disconnection from failed remote revocation without exposing editable bindings", () => {
    const markup = calendarManagerMarkup([], { connections: [connection({ status: "disconnected", remoteRevocationStatus: "failed", remoteRevocationErrorCode: "provider_revoke_failed" })] });
    expect(markup).toContain("Life Links access is off, but provider access revocation failed");
    expect(markup).toContain("Original provider events were not deleted");
    expect(markup).not.toContain("Disconnect account");
  });

  it("shows connection-loading failure and retry without inventing an empty connected-account result", () => {
    const markup = calendarManagerMarkup([], { loaded: false, error: "Connections are unavailable." });
    expect(markup).toContain("Connections are unavailable.");
    expect(markup).toContain("Retry loading connections");
    expect(markup).not.toContain("No external accounts are connected");
  });

  it("enables only configured Outlook sign-in, preserves exact discovery choices, and does not imply agent consent", () => {
    const markup = calendarManagerMarkup([], {
      providers: [{ providerKey: "microsoft", displayName: "Microsoft Outlook", authorizationAvailable: true }]
    }, { authorizationId: "11111111-1111-4111-8111-111111111111", connectionId: null, loading: false, error: "", feedback: "",
      discovery: { providerKey: "microsoft", providerAccountId: "exact-test-account", calendars: [
        { providerCalendarId: "provider/exact+id=", displayName: "Work Calendar", isDefault: true, capabilities: { read: true, create: true, update: true, delete: true } }
      ] } });
    expect(markup).toMatch(/<button class="ll-button" title="Continue to Microsoft sign-in">[^]*?Connect Microsoft Outlook<\/button>/);
    expect(markup).toContain("exact-test-account"); expect(markup).toContain("Work Calendar (provider default)");
    expect(markup).toContain("New calendars start with No access for agents");
    expect(markup).not.toContain('type="checkbox" checked=""');
    expect(markup).toContain("Cancel selection"); expect(markup).toContain("Connect selected calendars");
  });

  it("distinguishes removal of saved Outlook credentials from Microsoft account consent", () => {
    const markup = calendarManagerMarkup([], { connections: [connection({ providerKey: "microsoft-graph-calendar", status: "disconnected", remoteRevocationStatus: "succeeded", credentialStatus: "not_retained" })] });
    expect(markup).toContain("saved credentials were removed"); expect(markup).toContain("Microsoft account consent may remain");
    expect(markup).not.toContain("provider access was revoked");
  });
});

function calendarManagerMarkup(calendars: CalendarRecord[], connectionOverrides: Partial<LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"]> = {}, connectionFlow?: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionFlow"]) {
  return renderToStaticMarkup(createElement(CalendarDialogHost, {
    dialog: { kind: "manage-calendars" },
    controller: {} as LifeLinksWorkspaceController,
    snapshot: { calendarWorkspace: { calendars, connectionFlow, connectionManagement: {
      providers: [
        { providerKey: "google", displayName: "Google Calendar", authorizationAvailable: false, reason: "authorization_not_configured" },
        { providerKey: "microsoft", displayName: "Microsoft Outlook", authorizationAvailable: false, reason: "authorization_not_configured" }
      ], connections: [], calendars: [], loaded: true, loading: false, error: "", ...connectionOverrides
    } } } as unknown as LifeLinksWorkspaceSnapshot,
    onClose() {}
  }));
}

function connection(patch: Partial<CalendarConnectionView> = {}): CalendarConnectionView {
  return { ownerId, connectionId: "connection-test", providerKey: "google", providerAccountId: "synthetic-provider-account", status: "active", connectedAt: "2026-08-01T00:00:00.000Z", disconnectedAt: null, remoteRevocationStatus: "not_required", remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null, ...patch };
}

describe("dedicated Calendar view helpers", () => {
  it("renders exact provider identities in the existing calendar while preserving zone and read-only recurring/effect boundaries", () => {
    const providerEvent: CalendarProviderEventProjection = {
      ownerId, connectionId: "connection-test", calendarId: calendar.id, providerKey: "microsoft-graph-calendar", providerAccountId: "test-account", providerCalendarId: "provider-calendar", providerEventId: "provider/event+one=", providerRevision: "revision-one", synchronizedAt: calendar.updatedAt,
      content: { title: "Provider appointment", description: null, location: null, providerSeriesId: null, status: "confirmed",
        span: { kind: "timed", startUtc: "2026-09-02T01:00:00.000Z", endUtc: "2026-09-02T02:00:00.000Z", sourceTimeZone: "America/New_York", floatingLocalStart: "2026-09-01T21:00:00", floatingLocalEnd: "2026-09-01T22:00:00" },
        providerRecurrence: { kind: "single", originalStartUtc: null }, outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false } }
    };
    const input = { nativeEvents: [], providerEvents: [providerEvent], routineOccurrences: [], routines: [], calendars: [{ ...calendar, source: "external" as const }], startDate: "2026-09-01", endDate: "2026-09-01", timeZone: "America/New_York" };
    expect(buildCalendarDisplayEvents(input)).toMatchObject([{ source: "provider", date: "2026-09-01", providerEvent, eventId: null, revisionId: "revision-one" }]);
    expect(buildCalendarDisplayEvents({ ...input, visibleCalendarIds: new Set() })).toEqual([]);
    expect(providerEventCanMutate(providerEvent)).toBe(true);
    if (providerEvent.content.span.kind !== "timed") throw new Error("Expected timed provider fixture");
    for (const span of [
      { ...providerEvent.content.span, sourceTimeZone: null },
      { ...providerEvent.content.span, startUtc: "not-an-instant" },
      { ...providerEvent.content.span, startUtc: "2026-09-02T01:00:00" },
      { ...providerEvent.content.span, endUtc: providerEvent.content.span.startUtc }
    ]) expect(providerEventCanMutate({ ...providerEvent, content: { ...providerEvent.content, span } })).toBe(false);
    expect(providerEventCanMutate({ ...providerEvent, content: { ...providerEvent.content, providerSeriesId: "series" } })).toBe(false);
    expect(providerEventCanMutate({ ...providerEvent, content: { ...providerEvent.content, outboundEffects: { attendeeCount: 1, hasOnlineMeeting: false } } })).toBe(false);
    expect(providerEventCanMutate({ ...providerEvent, content: { ...providerEvent.content, outboundEffects: { attendeeCount: 0, hasOnlineMeeting: true } } })).toBe(false);
    expect(providerSpanForEditor(providerEvent.content.span)).toMatchObject({ kind: "zoned", startLocalDateTime: "2026-09-01T21:00", timeZone: "America/New_York" });
    expect(providerWritableSpan({ kind: "zoned", startLocalDateTime: "2026-09-01T21:00", endLocalDateTime: "2026-09-01T22:00", timeZone: "America/New_York" })).toEqual({ ...providerEvent.content.span, floatingLocalStart: null, floatingLocalEnd: null });
    expect(providerSpanForEditor({ kind: "timed", startUtc: "2026-11-01T06:30:00.000Z", endUtc: "2026-11-01T07:30:00.000Z", sourceTimeZone: "America/New_York", floatingLocalStart: null, floatingLocalEnd: null })).toMatchObject({ startInstant: "2026-11-01T06:30:00.000Z", startLocalDateTime: "2026-11-01T01:30" });
  });
  it("produces stable month, week, day, and agenda ranges across navigation", () => {
    expect(calendarRange("month", "2026-09-16")).toMatchObject({ startDate: "2026-08-30", endDate: "2026-10-03" });
    expect(calendarRange("week", "2026-09-16")).toMatchObject({ startDate: "2026-09-13", endDate: "2026-09-19" });
    expect(calendarRange("day", "2026-09-16").days).toEqual(["2026-09-16"]);
    expect(calendarRange("agenda", "2026-09-16")).toMatchObject({ startDate: "2026-09-16", endDate: "2026-10-16" });
    expect(shiftCalendarAnchor("2026-01-31", "month", 1)).toBe("2026-02-01");
  });

  it("uses the canonical recurrence materializer, including exact exception substitution", () => {
    const master = recurringMaster();
    const exception = recurringException();
    const events = buildCalendarDisplayEvents({
      nativeEvents: [master, exception],
      routineOccurrences: [],
      routines: [],
      calendars: [calendar],
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      timeZone: "America/New_York"
    });

    expect(events.map((event) => [event.date, event.title])).toEqual([
      ["2026-09-01", "Weekly planning"],
      ["2026-09-10", "Planning moved"],
      ["2026-09-15", "Weekly planning"]
    ]);
    expect(events[1].eventId).toBe(exception.event.id);
    expect(events[1].revisionId).toBe(exception.currentRevision.id);
  });

  it("shows multi-day native events and Routine plans together without changing Routine ownership", () => {
    const native = allDayEvent();
    const occurrence: RoutineOccurrenceRecord = {
      id: "routine-occurrence-44444444-4444-4444-8444-444444444444",
      ownerId,
      routineId: "routine-55555555-5555-4555-8555-555555555555",
      scheduleId: "routine-schedule-66666666-6666-4666-8666-666666666666",
      scheduleRevision: 1,
      routineRevisionId: "routine-revision-77777777-7777-4777-8777-777777777777",
      localDate: "2026-09-05",
      plannedFor: "2026-09-05T12:30:00.000Z",
      status: "planned",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    };
    const routine = { id: occurrence.routineId, title: "Morning reset" } as RoutineSummaryRecord;
    const events = buildCalendarDisplayEvents({
      nativeEvents: [native], routineOccurrences: [occurrence], routines: [routine], calendars: [calendar],
      startDate: "2026-09-04", endDate: "2026-09-06", timeZone: "America/New_York"
    });

    expect(events.filter((event) => event.source === "native").map((event) => event.date)).toEqual([
      "2026-09-04", "2026-09-05", "2026-09-06"
    ]);
    expect(events.find((event) => event.source === "routine")).toMatchObject({
      routineId: occurrence.routineId,
      occurrenceId: occurrence.id,
      eventId: null,
      title: "Morning reset"
    });
  });
});

function recurringMaster(): CalendarEventDefinition {
  return {
    event: {
      id: "calendar-event-11111111-1111-4111-8111-111111111111",
      ownerId,
      calendarId: calendar.id,
      currentRevisionId: "calendar-event-revision-11111111-1111-4111-8111-111111111111",
      lineage: { kind: "recurrence_master" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      deletedAt: null
    },
    currentRevision: {
      id: "calendar-event-revision-11111111-1111-4111-8111-111111111111",
      ownerId,
      eventId: "calendar-event-11111111-1111-4111-8111-111111111111",
      revisionNumber: 1,
      title: "Weekly planning",
      description: "",
      location: "",
      status: "confirmed",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-09-01T09:00",
        endLocalDateTime: "2026-09-01T10:00",
        timeZone: "America/New_York",
        startInstant: resolveCalendarZonedDateTime("2026-09-01T09:00", "America/New_York"),
        endInstant: resolveCalendarZonedDateTime("2026-09-01T10:00", "America/New_York")
      },
      recurrence: { frequency: "weekly", interval: 1, weekdays: ["tuesday"], end: { kind: "count", count: 3 } },
      subjectLinks: [],
      createdAt: "2026-08-01T00:00:00.000Z"
    }
  };
}

function recurringException(): CalendarEventDefinition {
  const startLocalDateTime = "2026-09-10T11:00";
  return {
    event: {
      id: "calendar-event-22222222-2222-4222-8222-222222222222",
      ownerId,
      calendarId: calendar.id,
      currentRevisionId: "calendar-event-revision-22222222-2222-4222-8222-222222222222",
      lineage: {
        kind: "recurrence_exception",
        masterEventId: "calendar-event-11111111-1111-4111-8111-111111111111",
        originalOccurrence: {
          kind: "zoned",
          startLocalDateTime: "2026-09-08T09:00",
          timeZone: "America/New_York",
          startInstant: resolveCalendarZonedDateTime("2026-09-08T09:00", "America/New_York")
        }
      },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      deletedAt: null
    },
    currentRevision: {
      id: "calendar-event-revision-22222222-2222-4222-8222-222222222222",
      ownerId,
      eventId: "calendar-event-22222222-2222-4222-8222-222222222222",
      revisionNumber: 1,
      title: "Planning moved",
      description: "",
      location: "",
      status: "confirmed",
      span: {
        kind: "zoned",
        startLocalDateTime,
        endLocalDateTime: "2026-09-10T12:00",
        timeZone: "America/New_York",
        startInstant: resolveCalendarZonedDateTime(startLocalDateTime, "America/New_York"),
        endInstant: resolveCalendarZonedDateTime("2026-09-10T12:00", "America/New_York")
      },
      recurrence: null,
      subjectLinks: [],
      createdAt: "2026-08-02T00:00:00.000Z"
    }
  };
}

function allDayEvent(): CalendarEventDefinition {
  return {
    event: {
      id: "calendar-event-33333333-3333-4333-8333-333333333333",
      ownerId,
      calendarId: calendar.id,
      currentRevisionId: "calendar-event-revision-33333333-3333-4333-8333-333333333333",
      lineage: { kind: "standalone" },
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      deletedAt: null
    },
    currentRevision: {
      id: "calendar-event-revision-33333333-3333-4333-8333-333333333333",
      ownerId,
      eventId: "calendar-event-33333333-3333-4333-8333-333333333333",
      revisionNumber: 1,
      title: "Family trip",
      description: "",
      location: "",
      status: "confirmed",
      span: { kind: "all_day", startDate: "2026-09-04", endDateExclusive: "2026-09-07" },
      recurrence: null,
      subjectLinks: [],
      createdAt: "2026-08-03T00:00:00.000Z"
    }
  };
}
