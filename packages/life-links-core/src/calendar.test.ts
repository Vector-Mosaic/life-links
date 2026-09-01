import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENT_ID_PREFIX,
  CALENDAR_EVENT_REVISION_ID_PREFIX,
  CALENDAR_EVENT_TOMBSTONE_ID_PREFIX,
  CALENDAR_ID_PREFIX,
  CalendarDomainError,
  applyCalendarPatch,
  assertCalendarEventEditTargetMatches,
  calendarRecurrenceIncludesOriginalOccurrence,
  createCanonicalCalendar,
  createCanonicalExternalCalendar,
  createCanonicalCalendarEvent,
  materializeCalendarEventWindow,
  normalizeCalendarEventId,
  normalizeCalendarEventEditTarget,
  normalizeCalendarEventSpan,
  normalizeCalendarRecurrenceRule,
  resolveCalendarZonedDateTime,
  restoreCalendar,
  restoreCalendarEvent,
  reviseCanonicalCalendarEvent,
  softDeleteCalendar,
  softDeleteCalendarEvent,
  type CalendarSubjectLink
} from "./index.js";

const OWNER_ID = "owner-alpha";
const CREATED = "2026-09-01T12:00:00.000Z";
const UPDATED = "2026-09-01T12:01:00.000Z";
const DELETED = "2026-09-01T12:02:00.000Z";
const RESTORED = "2026-09-01T12:03:00.000Z";

const id = (prefix: string, number: number): string =>
  `${prefix}00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

const CALENDAR_ID = id(CALENDAR_ID_PREFIX, 1);
const EVENT_ID = id(CALENDAR_EVENT_ID_PREFIX, 1);
const REVISION_ID = id(CALENDAR_EVENT_REVISION_ID_PREFIX, 1);

describe("native Calendar core domain", () => {
  it("creates owner-native Calendars with an IANA display zone and revision-safe lifecycle", () => {
    const calendar = createCanonicalCalendar({
      id: ` ${CALENDAR_ID.toUpperCase()} `,
      ownerId: ` ${OWNER_ID} `,
      title: " Personal ",
      color: "#5FAE95",
      timeZone: "America/New_York",
      isDefault: true,
      createdAt: CREATED
    });
    expect(calendar).toEqual({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      title: "Personal",
      color: "#5fae95",
      timeZone: "America/New_York",
      source: "native",
      isDefault: true,
      createdAt: CREATED,
      updatedAt: CREATED,
      deletedAt: null
    });

    const renamed = applyCalendarPatch(calendar, {
      calendarId: calendar.id,
      expectedUpdatedAt: calendar.updatedAt,
      patch: { title: "Family", timeZone: "UTC" }
    }, UPDATED);
    expect(renamed).toMatchObject({ title: "Family", timeZone: "UTC", updatedAt: UPDATED });
    expect(() => applyCalendarPatch(renamed, {
      calendarId: renamed.id,
      expectedUpdatedAt: CREATED,
      patch: { title: "Stale" }
    }, DELETED)).toThrow(expect.objectContaining({ code: "stale_calendar", retryable: true }));

    const deleted = softDeleteCalendar(renamed, {
      calendarId: renamed.id,
      expectedUpdatedAt: renamed.updatedAt,
      deletedAt: DELETED
    });
    expect(deleted).toMatchObject({ deletedAt: DELETED, updatedAt: DELETED });
    const restored = restoreCalendar(deleted, {
      calendarId: deleted.id,
      expectedUpdatedAt: deleted.updatedAt,
      restoredAt: RESTORED
    });
    expect(restored).toMatchObject({ deletedAt: null, updatedAt: RESTORED });
  });

  it("creates an external canonical Calendar from explicit local display fields", () => {
    expect(createCanonicalExternalCalendar({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      title: "Work calendar",
      color: "#336699",
      timeZone: "America/New_York",
      isDefault: false,
      createdAt: CREATED
    })).toEqual({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      title: "Work calendar",
      color: "#336699",
      timeZone: "America/New_York",
      source: "external",
      isDefault: false,
      createdAt: CREATED,
      updatedAt: CREATED,
      deletedAt: null
    });

    expect(() => createCanonicalExternalCalendar({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      title: "Work calendar",
      color: "not-a-color",
      timeZone: "Not/AZone",
      isDefault: false,
      createdAt: CREATED
    })).toThrow(expect.objectContaining({ code: "invalid_calendar" }));
  });

  it("keeps all-day dates distinct from zoned instants and accepts past or future dates", () => {
    expect(normalizeCalendarEventSpan({
      kind: "all_day",
      startDate: "1999-12-31",
      endDateExclusive: "2000-01-01"
    })).toEqual({ kind: "all_day", startDate: "1999-12-31", endDateExclusive: "2000-01-01" });
    expect(normalizeCalendarEventSpan({
      kind: "zoned",
      startLocalDateTime: "2031-04-05T09:15",
      endLocalDateTime: "2031-04-05T10:15",
      timeZone: "America/New_York"
    })).toMatchObject({
      kind: "zoned",
      startLocalDateTime: "2031-04-05T09:15",
      endLocalDateTime: "2031-04-05T10:15",
      timeZone: "America/New_York",
      startInstant: "2031-04-05T13:15:00.000Z",
      endInstant: "2031-04-05T14:15:00.000Z"
    });
    expect(() => normalizeCalendarEventSpan({
      kind: "all_day",
      startDate: "2026-09-01",
      endDateExclusive: "2026-09-01"
    })).toThrow(expect.objectContaining({ reason: "invalid_event_span_range" }));
  });

  it("accepts real leap days and rejects impossible leap days", () => {
    expect(normalizeCalendarEventSpan({
      kind: "all_day",
      startDate: "2020-02-29",
      endDateExclusive: "2020-03-01"
    })).toEqual({ kind: "all_day", startDate: "2020-02-29", endDateExclusive: "2020-03-01" });

    expect(() => normalizeCalendarEventSpan({
      kind: "all_day",
      startDate: "2021-02-29",
      endDateExclusive: "2021-03-01"
    })).toThrow(expect.objectContaining({ code: "invalid_calendar_event" }));
  });

  it("resolves DST gaps forward and overlaps to the earlier instant deterministically", () => {
    expect(resolveCalendarZonedDateTime("2026-03-08T02:30", "America/New_York"))
      .toBe("2026-03-08T07:00:00.000Z");
    expect(resolveCalendarZonedDateTime("2026-11-01T01:30", "America/New_York"))
      .toBe("2026-11-01T05:30:00.000Z");
    expect(() => resolveCalendarZonedDateTime("2026-09-01T09:00", "Not/AZone"))
      .toThrow(expect.objectContaining({ code: "invalid_calendar", reason: "invalid_time_zone" }));
  });

  it("normalizes bounded recurrence rules without hiding recurrence on standalone events", () => {
    expect(normalizeCalendarRecurrenceRule({
      frequency: "weekly",
      interval: 1,
      weekdays: ["thursday", "monday", "thursday"],
      end: { kind: "until", untilDate: "2026-12-31" }
    }, "2026-09-01")).toEqual({
      frequency: "weekly",
      interval: 1,
      weekdays: ["monday", "thursday"],
      end: { kind: "until", untilDate: "2026-12-31" }
    });
    expect(() => normalizeCalendarRecurrenceRule({
      frequency: "daily",
      interval: 1,
      end: { kind: "until", untilDate: "2026-08-31" }
    }, "2026-09-01")).toThrow(expect.objectContaining({ reason: "invalid_recurrence_end_range" }));

    expect(() => createCanonicalCalendarEvent({
      id: EVENT_ID,
      revisionId: REVISION_ID,
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      lineage: { kind: "standalone" },
      title: "Invalid hidden series",
      span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" },
      recurrence: { frequency: "daily", interval: 1, end: { kind: "never" } },
      createdAt: CREATED
    })).toThrow(expect.objectContaining({ reason: "unexpected_event_recurrence" }));
  });

  it("creates immutable event revisions while retaining recurrence lineage and typed Routine links", () => {
    const links: CalendarSubjectLink[] = [
      { kind: "life_link", lifeLinkId: "green-tub-02" },
      { kind: "collection", collectionId: id("collection-", 1) },
      { kind: "routine_session", routineId: id("routine-", 1), sessionId: id("routine-session-", 1) },
      {
        kind: "routine_occurrence",
        routineId: id("routine-", 1),
        scheduleId: id("routine-schedule-", 1),
        occurrenceId: id("routine-occurrence-", 1)
      },
      { kind: "routine", routineId: id("routine-", 1) }
    ];
    const creation = createCanonicalCalendarEvent({
      id: EVENT_ID,
      revisionId: REVISION_ID,
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Tuesday workout",
      description: "Default plan",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-09-01T08:00",
        endLocalDateTime: "2026-09-01T09:00",
        timeZone: "America/New_York"
      },
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" }
      },
      subjectLinks: links,
      createdAt: CREATED
    });
    expect(creation.event.lineage).toEqual({ kind: "recurrence_master" });
    expect(creation.currentRevision.subjectLinks.map((link) => link.kind)).toEqual([
      "collection",
      "life_link",
      "routine_occurrence",
      "routine",
      "routine_session"
    ]);

    const revised = reviseCanonicalCalendarEvent(creation.event, creation.currentRevision, {
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 2),
      ownerId: OWNER_ID,
      eventId: creation.event.id,
      expectedCurrentRevisionId: creation.event.currentRevisionId,
      title: "Tuesday workout updated",
      description: "New future default",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-09-01T08:30",
        endLocalDateTime: "2026-09-01T09:30",
        timeZone: "America/New_York"
      },
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "never" }
      },
      subjectLinks: links,
      createdAt: UPDATED
    });
    expect(revised.currentRevision).toMatchObject({ revisionNumber: 2, title: "Tuesday workout updated" });
    expect(revised.event.currentRevisionId).toBe(id(CALENDAR_EVENT_REVISION_ID_PREFIX, 2));
    expect(creation.currentRevision).toMatchObject({ revisionNumber: 1, title: "Tuesday workout" });
    expect(creation.event.currentRevisionId).toBe(REVISION_ID);

    expect(() => reviseCanonicalCalendarEvent(revised.event, revised.currentRevision, {
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 3),
      ownerId: OWNER_ID,
      eventId: revised.event.id,
      expectedCurrentRevisionId: REVISION_ID,
      title: "Stale",
      span: { kind: "all_day", startDate: "2026-09-02", endDateExclusive: "2026-09-03" },
      recurrence: { frequency: "daily", interval: 1, end: { kind: "never" } },
      createdAt: DELETED
    })).toThrow(expect.objectContaining({ code: "stale_calendar_event", retryable: true }));
  });

  it("normalizes same-owner Life Link and Collection context identities and rejects duplicates", () => {
    const creation = createCanonicalCalendarEvent({
      id: EVENT_ID,
      revisionId: REVISION_ID,
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Pack the car",
      span: { kind: "all_day", startDate: "2026-09-03", endDateExclusive: "2026-09-04" },
      subjectLinks: [
        { kind: "life_link", lifeLinkId: " Green Tub 02 " },
        { kind: "collection", collectionId: id("collection-", 2).toUpperCase() }
      ],
      createdAt: CREATED
    });
    expect(creation.currentRevision.subjectLinks).toEqual([
      { kind: "collection", collectionId: id("collection-", 2) },
      { kind: "life_link", lifeLinkId: "Green Tub 02" }
    ]);

    expect(() => createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 2),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 2),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Duplicate context",
      span: { kind: "all_day", startDate: "2026-09-03", endDateExclusive: "2026-09-04" },
      subjectLinks: [
        { kind: "life_link", lifeLinkId: "Green Tub 02" },
        { kind: "life_link", lifeLinkId: " Green Tub 02 " }
      ],
      createdAt: CREATED
    })).toThrow(expect.objectContaining({ reason: "duplicate_subject_link" }));

    expect(() => createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 3),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 3),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Invalid Collection context",
      span: { kind: "all_day", startDate: "2026-09-03", endDateExclusive: "2026-09-04" },
      subjectLinks: [{ kind: "collection", collectionId: "collection-not-a-uuid" }],
      createdAt: CREATED
    })).toThrow(expect.objectContaining({ code: "invalid_calendar_event", reason: "invalid_subject_link" }));
  });

  it("uses explicit recurrence exception identity and explicit occurrence/series edit scopes", () => {
    const masterEventId = id(CALENDAR_EVENT_ID_PREFIX, 9);
    const exception = createCanonicalCalendarEvent({
      id: EVENT_ID,
      revisionId: REVISION_ID,
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      lineage: {
        kind: "recurrence_exception",
        masterEventId,
        originalOccurrence: {
          kind: "zoned",
          startLocalDateTime: "2026-11-01T01:30",
          timeZone: "America/New_York"
        }
      },
      title: "Moved occurrence",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-11-01T10:00",
        endLocalDateTime: "2026-11-01T11:00",
        timeZone: "America/New_York"
      },
      createdAt: CREATED
    });
    expect(exception.event.lineage).toEqual({
      kind: "recurrence_exception",
      masterEventId,
      originalOccurrence: {
        kind: "zoned",
        startLocalDateTime: "2026-11-01T01:30",
        timeZone: "America/New_York",
        startInstant: "2026-11-01T05:30:00.000Z"
      }
    });
    const eventTarget = normalizeCalendarEventEditTarget({ scope: "event", eventId: exception.event.id });
    expect(() => assertCalendarEventEditTargetMatches(eventTarget, exception.event)).not.toThrow();
    const occurrenceTarget = normalizeCalendarEventEditTarget({
      scope: "this_and_future",
      masterEventId,
      originalOccurrence: { kind: "all_day", startDate: "2026-11-01" }
    });
    expect(occurrenceTarget).toMatchObject({ scope: "this_and_future", masterEventId });
    expect(() => assertCalendarEventEditTargetMatches(occurrenceTarget, exception.event))
      .toThrow(expect.objectContaining({ code: "calendar_reference_conflict", reason: "edit_target_mismatch" }));
  });

  it("materializes one canonical recurring window and substitutes only real exceptions", () => {
    const master = createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 20),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 20),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Training",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-10-27T08:00",
        endLocalDateTime: "2026-10-27T09:00",
        timeZone: "America/New_York"
      },
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["tuesday"],
        end: { kind: "count", count: 3 }
      },
      createdAt: CREATED
    });
    const originalOccurrence = {
      kind: "zoned" as const,
      startLocalDateTime: "2026-11-03T08:00",
      timeZone: "America/New_York",
      startInstant: "2026-11-03T13:00:00.000Z"
    };
    expect(calendarRecurrenceIncludesOriginalOccurrence(master.currentRevision, originalOccurrence)).toBe(true);
    expect(calendarRecurrenceIncludesOriginalOccurrence(master.currentRevision, {
      ...originalOccurrence,
      startLocalDateTime: "2026-11-04T08:00",
      startInstant: "2026-11-04T13:00:00.000Z"
    })).toBe(false);
    expect(calendarRecurrenceIncludesOriginalOccurrence(master.currentRevision, {
      ...originalOccurrence,
      startLocalDateTime: "2026-11-03T08:30",
      startInstant: "2026-11-03T13:30:00.000Z"
    })).toBe(false);

    const exception = createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 21),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 21),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      lineage: {
        kind: "recurrence_exception",
        masterEventId: master.event.id,
        originalOccurrence
      },
      title: "Training moved",
      span: {
        kind: "zoned",
        startLocalDateTime: "2026-11-03T10:00",
        endLocalDateTime: "2026-11-03T11:00",
        timeZone: "America/New_York"
      },
      createdAt: UPDATED
    });
    const instances = materializeCalendarEventWindow({
      definitions: [master, exception],
      startDate: "2026-10-26",
      endDate: "2026-11-15",
      viewTimeZone: "America/New_York"
    });
    expect(instances).toHaveLength(3);
    expect(instances.map((instance) => [instance.title, instance.span.kind === "zoned" && instance.span.startLocalDateTime]))
      .toEqual([
        ["Training", "2026-10-27T08:00"],
        ["Training moved", "2026-11-03T10:00"],
        ["Training", "2026-11-10T08:00"]
      ]);
    expect(instances[1]).toMatchObject({
      eventId: exception.event.id,
      masterEventId: master.event.id,
      isException: true,
      originalOccurrence
    });
  });

  it("rejects phantom recurrence exceptions during canonical projection", () => {
    const master = createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 30),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 30),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Mondays",
      span: { kind: "all_day", startDate: "2026-09-07", endDateExclusive: "2026-09-08" },
      recurrence: { frequency: "weekly", interval: 1, weekdays: ["monday"], end: { kind: "never" } },
      createdAt: CREATED
    });
    const phantom = createCanonicalCalendarEvent({
      id: id(CALENDAR_EVENT_ID_PREFIX, 31),
      revisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 31),
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      lineage: {
        kind: "recurrence_exception",
        masterEventId: master.event.id,
        originalOccurrence: { kind: "all_day", startDate: "2026-09-08" }
      },
      title: "Impossible Tuesday override",
      span: { kind: "all_day", startDate: "2026-09-08", endDateExclusive: "2026-09-09" },
      createdAt: UPDATED
    });
    expect(() => materializeCalendarEventWindow({
      definitions: [master, phantom],
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      viewTimeZone: "UTC"
    })).toThrow(expect.objectContaining({
      code: "calendar_reference_conflict",
      reason: "recurrence_exception_not_generated"
    }));
  });

  it("soft-deletes through an immutable tombstone and restores only the exact event revision", () => {
    const creation = createCanonicalCalendarEvent({
      id: EVENT_ID,
      revisionId: REVISION_ID,
      ownerId: OWNER_ID,
      calendarId: CALENDAR_ID,
      title: "Past appointment",
      span: { kind: "all_day", startDate: "2020-01-02", endDateExclusive: "2020-01-03" },
      createdAt: CREATED
    });
    const deletion = softDeleteCalendarEvent(creation.event, {
      tombstoneId: id(CALENDAR_EVENT_TOMBSTONE_ID_PREFIX, 1),
      eventId: creation.event.id,
      expectedCurrentRevisionId: creation.event.currentRevisionId,
      deletedAt: DELETED
    });
    expect(deletion.event).toMatchObject({ deletedAt: DELETED, updatedAt: DELETED });
    expect(deletion.tombstone).toMatchObject({
      eventId: creation.event.id,
      lastRevisionId: REVISION_ID,
      lineage: { kind: "standalone" },
      deletedAt: DELETED
    });
    const restored = restoreCalendarEvent(deletion.event, deletion.tombstone, {
      eventId: deletion.event.id,
      expectedCurrentRevisionId: deletion.event.currentRevisionId,
      tombstoneId: deletion.tombstone.id,
      restoredAt: RESTORED
    });
    expect(restored).toMatchObject({ deletedAt: null, updatedAt: RESTORED });

    const wrongRevisionEvent = { ...deletion.event, currentRevisionId: id(CALENDAR_EVENT_REVISION_ID_PREFIX, 8) };
    expect(() => restoreCalendarEvent(wrongRevisionEvent, deletion.tombstone, {
      eventId: wrongRevisionEvent.id,
      expectedCurrentRevisionId: wrongRevisionEvent.currentRevisionId,
      tombstoneId: deletion.tombstone.id,
      restoredAt: RESTORED
    })).toThrow(expect.objectContaining({ code: "calendar_reference_conflict", reason: "tombstone_mismatch" }));
  });

  it("uses a closed Calendar error family", () => {
    expect(() => createCanonicalCalendar({
      id: "calendar-not-a-uuid",
      ownerId: OWNER_ID,
      title: "Bad",
      timeZone: "UTC",
      createdAt: CREATED
    })).toThrow(CalendarDomainError);
    expect(() => normalizeCalendarEventId("calendar-event-not-a-uuid"))
      .toThrow(expect.objectContaining({ code: "invalid_calendar_event", reason: "invalid_event_id" }));
  });
});
