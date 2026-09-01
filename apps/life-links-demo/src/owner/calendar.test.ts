import { describe, expect, it } from "vitest";
import {
  resolveCalendarZonedDateTime,
  type CalendarEventDefinition,
  type CalendarRecord,
  type RoutineOccurrenceRecord,
  type RoutineSummaryRecord
} from "@life-links/core";

import { buildCalendarDisplayEvents, calendarRange, shiftCalendarAnchor } from "./calendar";

const ownerId = "owner-calendar-test";
const calendar: CalendarRecord = {
  id: "calendar-11111111-1111-4111-8111-111111111111",
  ownerId,
  title: "Home",
  color: "#7FC9B3",
  timeZone: "America/New_York",
  source: "native",
  isDefault: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null
};

describe("dedicated Calendar view helpers", () => {
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
