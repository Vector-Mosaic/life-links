import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { DEMO_GUEST_ID, DEMO_OWNER_ID } from "@life-links/core";

import type { LifeLinksStore } from "../src/store.js";

const id = (prefix: string) => `${prefix}-${randomUUID()}`;

export function calendarStoreContract(getStore: () => LifeLinksStore): void {
  describe("native Calendar store contract", () => {
    it("enforces current native Calendar agent grants, owner isolation, catalog version, and revocation at the store boundary", async () => {
      const store = getStore();
      const createdAt = "2026-09-01T12:00:00.000Z";
      const calendars = await Promise.all((["none", "read", "write"] as const).map((agentAccess) => store.createCalendar({
        id: id("calendar"), ownerId: DEMO_OWNER_ID, title: agentAccess, timeZone: "UTC", agentAccess, createdAt
      })));
      const events = await Promise.all(calendars.map((calendar) => store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: calendar.id, title: calendar.title, createdAt,
        span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" }
      })));
      const [hidden, readOnly, writable] = calendars;
      const [hiddenEvent, readEvent, writableEvent] = events;
      const write = {
        ownerId: DEMO_OWNER_ID, eventId: writableEvent.event.id,
        expectedCurrentRevisionId: writableEvent.currentRevision.id,
        revisionId: id("calendar-event-revision"), title: "Agent changed",
        span: { kind: "all_day" as const, startDate: "2026-09-01", endDateExclusive: "2026-09-02" },
        createdAt: "2026-09-01T12:01:00.000Z"
      };
      await expect(store.listCalendars(DEMO_OWNER_ID, {}, "agent")).rejects.toMatchObject({ code: "calendar_access_denied" });
      await store.connectAgent(DEMO_OWNER_ID, "life-links-page-webmcp-v1");
      await expect(store.reviseCalendarEvent(DEMO_OWNER_ID, write, "agent"))
        .rejects.toMatchObject({ reason: "calendar_agent_connection_required" });
      await store.connectAgent(DEMO_OWNER_ID, "life-links-calendar-v2");
      await store.connectAgent(DEMO_GUEST_ID, "life-links-calendar-v2");
      expect((await store.listCalendars(DEMO_OWNER_ID, {}, "agent")).items.map((calendar) => calendar.id))
        .toEqual([readOnly.id, writable.id]);
      expect(await store.getCalendar(DEMO_OWNER_ID, hidden.id, "agent")).toBeNull();
      expect(await store.getCalendarEvent(DEMO_OWNER_ID, hiddenEvent.event.id, "agent")).toBeNull();
      expect(await store.listCalendarEventRevisions(DEMO_OWNER_ID, hiddenEvent.event.id, "agent")).toBeNull();
      expect(await store.listCalendarEventTombstones(DEMO_OWNER_ID, hiddenEvent.event.id, "agent")).toBeNull();
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, {}, "agent")).items.map((event) => event.event.id).sort())
        .toEqual([readEvent.event.id, writableEvent.event.id].sort());
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, { calendarId: hidden.id }, "agent")).items).toEqual([]);
      expect(await store.getCalendarEvent(DEMO_GUEST_ID, writableEvent.event.id, "agent")).toBeNull();
      expect((await store.listCalendars(DEMO_OWNER_ID)).items).toHaveLength(3);
      await expect(store.updateCalendar(DEMO_OWNER_ID, {
        calendarId: readOnly.id, expectedUpdatedAt: readOnly.updatedAt, patch: { agentAccess: "write" }
      }, "agent")).rejects.toMatchObject({ reason: "calendar_settings_human_only" });
      await expect(store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: readOnly.id, title: "Forbidden", span: write.span, createdAt
      }, "agent")).rejects.toMatchObject({ reason: "agent_calendar_write_denied" });
      await expect(store.reviseCalendarEvent(DEMO_OWNER_ID, {
        ...write, eventId: readEvent.event.id, expectedCurrentRevisionId: readEvent.currentRevision.id
      }, "agent")).rejects.toMatchObject({ reason: "agent_calendar_write_denied" });

      const revised = await store.reviseCalendarEvent(DEMO_OWNER_ID, write, "agent");
      expect(revised?.currentRevision.title).toBe("Agent changed");
      expect(await store.reviseCalendarEvent(DEMO_OWNER_ID, write, "agent")).toEqual(revised);
      const revoked = await store.updateCalendar(DEMO_OWNER_ID, {
        calendarId: writable.id, expectedUpdatedAt: writable.updatedAt, patch: { agentAccess: "none" }
      });
      expect(revoked?.agentAccess).toBe("none");
      await expect(store.updateCalendar(DEMO_OWNER_ID, {
        calendarId: writable.id, expectedUpdatedAt: writable.updatedAt, patch: { agentAccess: "write" }
      })).rejects.toMatchObject({ code: "stale_calendar" });
      await expect(store.reviseCalendarEvent(DEMO_OWNER_ID, write, "agent"))
        .rejects.toMatchObject({ reason: "agent_calendar_write_denied" });
      await expect(store.softDeleteCalendarEvent(DEMO_OWNER_ID, {
        eventId: writableEvent.event.id, expectedCurrentRevisionId: revised!.currentRevision.id,
        tombstoneId: id("calendar-event-tombstone"), deletedAt: "2026-09-01T12:02:00.000Z"
      }, "agent")).rejects.toMatchObject({ reason: "agent_calendar_write_denied" });
      expect((await store.getCalendarEvent(DEMO_OWNER_ID, writableEvent.event.id))?.event.deletedAt).toBeNull();
      await store.disconnectAgent(DEMO_OWNER_ID);
      await expect(store.getCalendarEvent(DEMO_OWNER_ID, readEvent.event.id, "agent"))
        .rejects.toMatchObject({ reason: "calendar_agent_connection_required" });
    });

    it("persists owner-private past events, recurrence lineage, immutable revisions, tombstones, and typed subject links", async () => {
      const store = getStore();
      const createdAt = "2026-09-01T12:00:00.000Z";
      const lifeLink = await store.createLifeLink({
        id: id("life-link"), ownerId: DEMO_OWNER_ID, title: "Gym bag", createdAt
      });
      const collection = await store.createCollection({
        id: id("collection"), ownerId: DEMO_OWNER_ID, title: "Training", createdAt
      });
      const activity = await store.createActivity({
        id: id("activity"), ownerId: DEMO_OWNER_ID, title: "Review", createdAt
      });
      const routine = await store.createRoutine({
        id: id("routine"), revisionId: id("routine-revision"), ownerId: DEMO_OWNER_ID,
        title: "Weekly review", createdAt,
        steps: [{ id: id("routine-step"), activityId: activity.id, activityTitle: activity.title, position: 0 }]
      });

      const personalCommand = {
        id: id("calendar"), ownerId: DEMO_OWNER_ID, title: "Personal", color: "#336699",
        timeZone: "America/New_York", isDefault: true, createdAt
      };
      const personal = await store.createCalendar(personalCommand);
      expect(await store.createCalendar({ ...personalCommand, createdAt: "2026-09-01T12:01:00.000Z" })).toEqual(personal);
      expect(await store.getCalendar(DEMO_GUEST_ID, personal.id)).toBeNull();

      const second = await store.createCalendar({
        id: id("calendar"), ownerId: DEMO_OWNER_ID, title: "Work", timeZone: "UTC",
        isDefault: true, createdAt: "2026-09-01T12:02:00.000Z"
      });
      expect(second.isDefault).toBe(true);
      expect((await store.getCalendar(DEMO_OWNER_ID, personal.id))?.isDefault).toBe(false);
      const deletedSecond = await store.softDeleteCalendar(DEMO_OWNER_ID, {
        calendarId: second.id, expectedUpdatedAt: second.updatedAt, deletedAt: "2026-09-01T12:02:30.000Z"
      });
      expect(deletedSecond?.deletedAt).toBe("2026-09-01T12:02:30.000Z");
      expect((await store.listCalendars(DEMO_OWNER_ID)).items.map((item) => item.id)).not.toContain(second.id);
      const restoredSecond = await store.restoreCalendar(DEMO_OWNER_ID, {
        calendarId: second.id, expectedUpdatedAt: deletedSecond!.updatedAt, restoredAt: "2026-09-01T12:02:31.000Z"
      });
      expect(restoredSecond?.deletedAt).toBeNull();

      const pastEventCommand = {
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: personal.id, title: "Past appointment",
        span: { kind: "all_day" as const, startDate: "2020-02-29", endDateExclusive: "2020-03-01" },
        subjectLinks: [
          { kind: "life_link" as const, lifeLinkId: lifeLink.id },
          { kind: "collection" as const, collectionId: collection.id },
          { kind: "routine" as const, routineId: routine.routine.id }
        ],
        createdAt: "2026-09-01T12:03:00.000Z"
      };
      const past = await store.createCalendarEvent(pastEventCommand);
      expect(await store.createCalendarEvent({ ...pastEventCommand, createdAt: "2026-09-01T12:04:00.000Z" })).toEqual(past);
      expect(past.currentRevision.span).toEqual({ kind: "all_day", startDate: "2020-02-29", endDateExclusive: "2020-03-01" });
      expect(past.event.createdAt).toBe("2026-09-01T12:03:00.000Z");
      expect((await store.getCalendarEvent(DEMO_OWNER_ID, past.event.id))?.currentRevision.subjectLinks)
        .toEqual(past.currentRevision.subjectLinks);
      expect(await store.getCalendarEvent(DEMO_GUEST_ID, past.event.id)).toBeNull();
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, { startDate: "2020-02-29", endDate: "2020-02-29" })).items)
        .toHaveLength(1);
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, { startDate: "2020-03-01", endDate: "2020-03-01" })).items)
        .toHaveLength(0);
      await expect(store.listCalendarEvents(DEMO_OWNER_ID, { startDate: "2020-02-29" }))
        .rejects.toMatchObject({ code: "invalid_calendar_event", reason: "incomplete_date_window" });

      const master = await store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: personal.id, lineage: { kind: "recurrence_master" }, title: "Monthly inventory",
        span: { kind: "zoned", startLocalDateTime: "2026-09-01T09:00", endLocalDateTime: "2026-09-01T09:30", timeZone: "America/New_York" },
        recurrence: { frequency: "monthly", interval: 1, monthDays: [1], end: { kind: "never" } },
        createdAt: "2026-09-01T12:05:00.000Z"
      });
      const exception = await store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: personal.id,
        lineage: {
          kind: "recurrence_exception", masterEventId: master.event.id,
          originalOccurrence: { kind: "zoned", startLocalDateTime: "2026-10-01T09:00", timeZone: "America/New_York" }
        },
        title: "Rescheduled inventory",
        span: { kind: "zoned", startLocalDateTime: "2026-10-02T10:00", endLocalDateTime: "2026-10-02T10:30", timeZone: "America/New_York" },
        createdAt: "2026-09-01T12:06:00.000Z"
      });
      await expect(store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: personal.id,
        lineage: {
          kind: "recurrence_exception", masterEventId: master.event.id,
          originalOccurrence: { kind: "zoned", startLocalDateTime: "2026-10-01T09:00", timeZone: "America/New_York" }
        },
        title: "Duplicate exception",
        span: { kind: "zoned", startLocalDateTime: "2026-10-03T10:00", endLocalDateTime: "2026-10-03T10:30", timeZone: "America/New_York" },
        createdAt: "2026-09-01T12:06:30.000Z"
      })).rejects.toMatchObject({ code: "calendar_conflict", reason: "duplicate_recurrence_exception" });
      await expect(store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID,
        calendarId: personal.id,
        lineage: {
          kind: "recurrence_exception", masterEventId: master.event.id,
          originalOccurrence: { kind: "zoned", startLocalDateTime: "2026-10-02T09:00", timeZone: "America/New_York" }
        },
        title: "Phantom exception",
        span: { kind: "zoned", startLocalDateTime: "2026-10-02T12:00", endLocalDateTime: "2026-10-02T12:30", timeZone: "America/New_York" },
        createdAt: "2026-09-01T12:06:31.000Z"
      })).rejects.toMatchObject({
        code: "calendar_reference_conflict",
        reason: "recurrence_exception_not_generated"
      });
      const distantWindow = await store.listCalendarEvents(DEMO_OWNER_ID, {
        calendarId: personal.id, startDate: "2030-01-01", endDate: "2030-01-31"
      });
      expect(distantWindow.items.map((item) => item.event.id)).toEqual([master.event.id, exception.event.id]);
      const originalOccurrenceWindow = await store.listCalendarEvents(DEMO_OWNER_ID, {
        calendarId: personal.id, startDate: "2026-10-01", endDate: "2026-10-01"
      });
      expect(originalOccurrenceWindow.items.map((item) => item.event.id)).toEqual([master.event.id, exception.event.id]);

      const revised = await store.reviseCalendarEvent(DEMO_OWNER_ID, {
        revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID, eventId: exception.event.id,
        expectedCurrentRevisionId: exception.event.currentRevisionId, title: "Inventory moved",
        span: { kind: "zoned", startLocalDateTime: "2026-10-02T11:00", endLocalDateTime: "2026-10-02T11:30", timeZone: "America/New_York" },
        createdAt: "2026-09-01T12:07:00.000Z"
      });
      expect(revised?.currentRevision).toMatchObject({ revisionNumber: 2, title: "Inventory moved" });
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, {
        calendarId: personal.id, startDate: "2026-10-02", endDate: "2026-10-02"
      })).items.map((item) => item.event.id)).toContain(exception.event.id);
      await expect(store.reviseCalendarEvent(DEMO_OWNER_ID, {
        revisionId: id("calendar-event-revision"), ownerId: DEMO_OWNER_ID, eventId: exception.event.id,
        expectedCurrentRevisionId: exception.event.currentRevisionId, title: "Stale",
        span: { kind: "all_day", startDate: "2026-10-03", endDateExclusive: "2026-10-04" },
        createdAt: "2026-09-01T12:08:00.000Z"
      })).rejects.toMatchObject({ code: "stale_calendar_event", retryable: true });
      expect((await store.listCalendarEventRevisions(DEMO_OWNER_ID, exception.event.id))?.map((item) => item.revisionNumber))
        .toEqual([1, 2]);

      const deletion = await store.softDeleteCalendarEvent(DEMO_OWNER_ID, {
        tombstoneId: id("calendar-event-tombstone"), eventId: exception.event.id,
        expectedCurrentRevisionId: revised!.event.currentRevisionId, deletedAt: "2026-09-01T12:09:00.000Z"
      });
      expect(deletion?.event.deletedAt).toBe("2026-09-01T12:09:00.000Z");
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, { calendarId: personal.id })).items.map((item) => item.event.id))
        .not.toContain(exception.event.id);
      expect((await store.listCalendarEvents(DEMO_OWNER_ID, { calendarId: personal.id, includeDeleted: true })).items.map((item) => item.event.id))
        .toContain(exception.event.id);
      expect(await store.listCalendarEventTombstones(DEMO_OWNER_ID, exception.event.id)).toEqual([deletion!.tombstone]);

      const restored = await store.restoreCalendarEvent(DEMO_OWNER_ID, {
        eventId: exception.event.id, expectedCurrentRevisionId: revised!.event.currentRevisionId,
        tombstoneId: deletion!.tombstone.id, restoredAt: "2026-09-01T12:10:00.000Z"
      });
      expect(restored?.event.deletedAt).toBeNull();
      expect(await store.listCalendarEventTombstones(DEMO_OWNER_ID, exception.event.id)).toEqual([deletion!.tombstone]);

      const guestCalendar = await store.createCalendar({
        id: id("calendar"), ownerId: DEMO_GUEST_ID, title: "Guest", timeZone: "UTC", createdAt: "2026-09-01T12:10:30.000Z"
      });
      await expect(store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_GUEST_ID,
        calendarId: guestCalendar.id, title: "Foreign Life Link",
        span: { kind: "all_day", startDate: "2026-09-02", endDateExclusive: "2026-09-03" },
        subjectLinks: [{ kind: "life_link", lifeLinkId: lifeLink.id }],
        createdAt: "2026-09-01T12:10:31.000Z"
      })).rejects.toMatchObject({ code: "calendar_reference_conflict", reason: "life_link_unavailable" });

      await expect(store.createCalendarEvent({
        id: id("calendar-event"), revisionId: id("calendar-event-revision"), ownerId: DEMO_GUEST_ID,
        calendarId: personal.id, title: "Cross-owner event",
        span: { kind: "all_day", startDate: "2026-09-02", endDateExclusive: "2026-09-03" },
        createdAt: "2026-09-01T12:11:00.000Z"
      })).rejects.toMatchObject({ code: "calendar_reference_conflict" });
    });
  });
}
