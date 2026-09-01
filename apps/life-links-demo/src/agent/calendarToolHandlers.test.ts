import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";

import {
  LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
  LIFE_LINKS_CALENDAR_TOOL_NAMES,
  LIFE_LINKS_LEGACY_TOOL_CATALOG_ID,
  createCalendarAgentToolCatalog,
  type AgentCalendarEventDetail,
  type AgentNativeCalendarEventInstance,
  type AgentCalendarRecord,
  type CalendarAgentToolController
} from "./calendarToolHandlers";

const owner = { id: "owner-calendar" };
const calendarId = "calendar-11111111-1111-4111-8111-111111111111";
const eventId = "calendar-event-22222222-2222-4222-8222-222222222222";
const exceptionEventId = "calendar-event-66666666-6666-4666-8666-666666666666";
const revisionId = "calendar-event-revision-33333333-3333-4333-8333-333333333333";
const nextRevisionId = "calendar-event-revision-44444444-4444-4444-8444-444444444444";
const tombstoneId = "calendar-event-tombstone-55555555-5555-4555-8555-555555555555";

function calendar(overrides: Partial<AgentCalendarRecord> = {}): AgentCalendarRecord {
  return {
    id: calendarId,
    title: "My Calendar",
    timeZone: "America/New_York",
    provider: "life_links",
    providerConnectionId: null,
    providerAccountId: null,
    providerCalendarId: null,
    writeAuthority: "life_links",
    humanAccess: "write",
    agentAccess: "write",
    isDefault: true,
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides
  };
}

function eventDetail(overrides: Partial<AgentCalendarEventDetail> = {}): AgentCalendarEventDetail {
  const currentRevision = {
    id: revisionId,
    ownerId: owner.id,
    eventId,
    revisionNumber: 1,
    title: "Past physical therapy",
    description: "Observed notes are private. ".repeat(60),
    location: "Clinic A",
    status: "confirmed" as const,
    span: {
      kind: "zoned" as const,
      startLocalDateTime: "2026-08-20T09:00",
      endLocalDateTime: "2026-08-20T10:00",
      timeZone: "America/New_York",
      startInstant: "2026-08-20T13:00:00.000Z",
      endInstant: "2026-08-20T14:00:00.000Z"
    },
    recurrence: null,
    subjectLinks: [{ kind: "life_link" as const, lifeLinkId: "physical-therapy-band" }],
    createdAt: "2026-09-01T12:00:00.000Z"
  };
  return {
    event: {
      id: eventId,
      ownerId: owner.id,
      calendarId,
      currentRevisionId: currentRevision.id,
      lineage: { kind: "standalone" },
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
      deletedAt: null
    },
    currentRevision,
    calendar: calendar(),
    ...overrides
  };
}

function eventInstance(overrides: Partial<AgentNativeCalendarEventInstance> = {}): AgentNativeCalendarEventInstance {
  const detail = eventDetail();
  return {
    source: "calendar_event",
    instance: {
      instanceId: `calendar-instance:${eventId}`,
      eventId,
      revisionId,
      calendarId,
      masterEventId: null,
      originalOccurrence: null,
      isException: false,
      title: detail.currentRevision.title,
      description: detail.currentRevision.description,
      location: detail.currentRevision.location,
      status: detail.currentRevision.status,
      span: detail.currentRevision.span,
      subjectLinks: detail.currentRevision.subjectLinks
    },
    calendar: calendar(),
    ...overrides
  };
}

class FakeController implements CalendarAgentToolController {
  catalogId: string | null = LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID;
  readonly agentListAuthorizedCalendars = vi.fn<CalendarAgentToolController["agentListAuthorizedCalendars"]>(async () => ({ ok: true, calendars: [calendar()], nextCursor: null, truncated: false }));
  readonly agentQueryCalendarEvents = vi.fn<CalendarAgentToolController["agentQueryCalendarEvents"]>(async () => ({ ok: true, instances: [eventInstance()], nextCursor: null, truncated: false }));
  readonly agentInspectCalendarEvent = vi.fn<CalendarAgentToolController["agentInspectCalendarEvent"]>(async () => ({ ok: true, detail: eventDetail() }));
  readonly agentCreateCalendarEvent = vi.fn<CalendarAgentToolController["agentCreateCalendarEvent"]>(async (input) => ({
    ok: true,
    detail: eventDetail({
      event: { ...eventDetail().event, id: input.eventId, currentRevisionId: input.revisionId },
      currentRevision: { ...eventDetail().currentRevision, id: input.revisionId, eventId: input.eventId, title: input.title }
    })
  }));
  readonly agentUpdateCalendarEvent = vi.fn<CalendarAgentToolController["agentUpdateCalendarEvent"]>(async (input) => ({
    ok: true,
    detail: eventDetail({
      event: { ...eventDetail().event, currentRevisionId: input.revisionId },
      currentRevision: { ...eventDetail().currentRevision, id: input.revisionId, title: input.patch.title ?? eventDetail().currentRevision.title }
    })
  }));
  readonly agentPrepareCalendarEventDeletion = vi.fn<CalendarAgentToolController["agentPrepareCalendarEventDeletion"]>(async (input) => ({
    ok: true,
    preview: {
      id: "calendar-delete-preview-1",
      event: eventDetail(),
      target: input.target,
      knownEffects: ["The event leaves the selected Calendar.", "A restorable native tombstone is retained."]
    }
  }));
  readonly agentApplyCalendarEventDeletion = vi.fn<CalendarAgentToolController["agentApplyCalendarEventDeletion"]>(async () => ({
    ok: true,
    result: { eventId, calendarId, deleted: true, tombstoneId }
  }));

  getAgentCalendarSnapshot() {
    return { currentUser: owner, routeQrId: null, guestView: false, agentToolCatalogId: this.catalogId };
  }
}

function tools(controller: CalendarAgentToolController) {
  return new Map(createCalendarAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
}

describe("Calendar page-bound agent tools", () => {
  it("publishes exactly the seven versioned Calendar jobs with closed schemas", () => {
    const catalog = createCalendarAgentToolCatalog(new FakeController());
    expect(catalog.map((tool) => tool.name)).toEqual(LIFE_LINKS_CALENDAR_TOOL_NAMES);
    expect(catalog).toHaveLength(7);
    for (const tool of catalog) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    const apply = catalog.find((tool) => tool.name === "apply_calendar_event_deletion")!;
    const validate = new Ajv().compile(apply.inputSchema);
    expect(validate({ previewId: "calendar-delete-preview-1" })).toBe(true);
    expect(validate({ previewId: "calendar-delete-preview-1", confirmed: true })).toBe(false);

    const create = catalog.find((tool) => tool.name === "create_calendar_event")!;
    const validateCreate = new Ajv().compile(create.inputSchema);
    expect(validateCreate({
      eventId, revisionId, calendarId, title: "Weekly planning",
      span: { kind: "zoned", startLocalDateTime: "2026-09-01T09:00", endLocalDateTime: "2026-09-01T09:30", timeZone: "America/New_York" },
      recurrence: { frequency: "weekly", interval: 1, weekdays: ["monday"], end: { kind: "never" } }
    })).toBe(true);
    expect(validateCreate({
      eventId, revisionId, calendarId, title: "Invalid recurrence",
      span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" },
      recurrence: { frequency: "daily", interval: 1, weekdays: ["monday"], end: { kind: "never" } }
    })).toBe(false);
  });

  it("fails closed before controller access for missing or legacy catalog grants", async () => {
    const controller = new FakeController();
    const list = tools(controller).get("list_my_calendars")!;
    for (const catalogId of [null, LIFE_LINKS_LEGACY_TOOL_CATALOG_ID]) {
      controller.catalogId = catalogId;
      await expect(list.execute({})).resolves.toMatchObject({ ok: false, error: { code: "calendar_catalog_not_granted" } });
    }
    expect(controller.agentListAuthorizedCalendars).not.toHaveBeenCalled();
  });

  it("lists only explicitly authorized calendars and queries a validated bounded canonical occurrence window", async () => {
    const controller = new FakeController();
    const catalog = tools(controller);
    await expect(catalog.get("list_my_calendars")!.execute({ limit: 2 })).resolves.toMatchObject({
      ok: true,
      catalogId: LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
      calendars: [{ id: calendarId, provider: "life_links", writeAuthority: "life_links", agentAccess: "write" }]
    });
    const originalOccurrence = {
      kind: "zoned" as const,
      startLocalDateTime: "2026-08-20T09:00",
      timeZone: "America/New_York",
      startInstant: "2026-08-20T13:00:00.000Z"
    };
    controller.agentQueryCalendarEvents.mockResolvedValueOnce({
      ok: true,
      instances: [{
        ...eventInstance(),
        instance: {
          ...eventInstance().instance,
          instanceId: `calendar-instance:${eventId}:zoned:2026-08-20T09:00:America/New_York`,
          eventId: exceptionEventId,
          revisionId: nextRevisionId,
          masterEventId: eventId,
          originalOccurrence,
          isException: true
        }
      }],
      nextCursor: null,
      truncated: false
    });
    await expect(catalog.get("query_my_calendar_events")!.execute({ startDate: "2026-08-01", endDate: "2026-09-01", calendarIds: [calendarId], limit: 2 })).resolves.toMatchObject({
      ok: true,
      instances: [{
        source: "calendar_event",
        instanceId: `calendar-instance:${eventId}:zoned:2026-08-20T09:00:America/New_York`,
        eventId: exceptionEventId,
        revisionId: nextRevisionId,
        masterEventId: eventId,
        originalOccurrence,
        isException: true
      }]
    });
    expect(controller.agentQueryCalendarEvents).toHaveBeenCalledWith({ startDate: "2026-08-01", endDate: "2026-09-01", calendarIds: [calendarId], limit: 2 }, undefined);
    await expect(catalog.get("query_my_calendar_events")!.execute({ startDate: "2025-01-01", endDate: "2026-09-01" })).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("serializes Routine-owned projections as read-only Calendar entries without Calendar mutation identity", async () => {
    const controller = new FakeController();
    controller.agentQueryCalendarEvents.mockResolvedValueOnce({
      ok: true,
      instances: [{
        source: "routine_projection",
        routine: {
          id: "routine-77777777-7777-4777-8777-777777777777",
          ownerId: owner.id,
          groupId: null,
          currentRevisionId: "routine-revision-77777777-7777-4777-8777-777777777777",
          revisionNumber: 2,
          title: "Tuesday strength",
          purpose: "Build strength",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-09-01T12:00:00.000Z",
          archivedAt: null
        },
        occurrence: {
          id: "routine-occurrence-88888888-8888-4888-8888-888888888888",
          ownerId: owner.id,
          scheduleId: "routine-schedule-99999999-9999-4999-8999-999999999999",
          scheduleRevision: 1,
          routineId: "routine-77777777-7777-4777-8777-777777777777",
          routineRevisionId: "routine-revision-77777777-7777-4777-8777-777777777777",
          localDate: "2026-08-25",
          plannedFor: "2026-08-25T12:00:00.000Z",
          status: "planned",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z"
        }
      }],
      nextCursor: null,
      truncated: false
    });

    await expect(tools(controller).get("query_my_calendar_events")!.execute({
      startDate: "2026-08-01", endDate: "2026-09-01", limit: 2
    })).resolves.toMatchObject({
      ok: true,
      instances: [{
        source: "routine_projection",
        instanceId: "routine:routine-occurrence-88888888-8888-4888-8888-888888888888",
        eventId: null,
        revisionId: null,
        calendarId: null,
        routineId: "routine-77777777-7777-4777-8777-777777777777",
        title: "Tuesday strength",
        writeAuthority: "routine",
        inspectableAsCalendarEvent: false,
        editableAsCalendarEvent: false
      }]
    });
  });

  it("inspects private details in revision-bound bounded pages without logging or returning an unbounded description", async () => {
    const controller = new FakeController();
    const inspect = tools(controller).get("inspect_calendar_event")!;
    const summary = await inspect.execute({ eventId }) as Record<string, unknown>;
    expect(summary).toMatchObject({ ok: true, event: { id: eventId, currentRevisionId: revisionId }, descriptionLength: eventDetail().currentRevision.description.length, contentIsUntrusted: true });
    expect(JSON.stringify(summary)).not.toContain("Observed notes are private");
    const page = await inspect.execute({ eventId, part: "description", expectedCurrentRevisionId: revisionId, offset: 0 }) as Record<string, unknown>;
    expect(page).toMatchObject({ ok: true, part: "description", offset: 0, currentRevisionId: revisionId, contentIsUntrusted: true });
    expect(String(page.text).length).toBeLessThanOrEqual(700);
    expect(page.nextOffset).not.toBeNull();
    await expect(inspect.execute({ eventId, part: "description", expectedCurrentRevisionId: nextRevisionId, offset: 0 })).resolves.toMatchObject({ ok: false, error: { code: "stale_calendar_event" } });
  });

  it("creates stable native events and revision-safely patches only exact-event or whole-series targets", async () => {
    const controller = new FakeController();
    const catalog = tools(controller);
    const create = {
      eventId,
      revisionId,
      calendarId,
      title: "Recorded after it happened",
      span: { kind: "all_day", startDate: "2026-08-20", endDateExclusive: "2026-08-21" }
    } as const;
    await expect(catalog.get("create_calendar_event")!.execute(create)).resolves.toMatchObject({ ok: true, event: { id: eventId, currentRevisionId: revisionId }, saved: true });
    expect(controller.agentCreateCalendarEvent).toHaveBeenCalledWith(create, undefined);

    const update = { eventId, revisionId: nextRevisionId, expectedCurrentRevisionId: revisionId, target: { scope: "event", eventId }, patch: { title: "Corrected title" } } as const;
    await expect(catalog.get("update_calendar_event")!.execute(update)).resolves.toMatchObject({ ok: true, event: { currentRevisionId: nextRevisionId }, target: update.target, updatedFields: ["title"] });
    expect(controller.agentUpdateCalendarEvent).toHaveBeenCalledWith(update, undefined);
    await expect(catalog.get("update_calendar_event")!.execute({ ...update, target: { scope: "future", eventId } })).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("repeats the exact deletion authority/effects and delegates the sole confirmation to the app", async () => {
    const controller = new FakeController();
    const catalog = tools(controller);
    const target = { scope: "event", eventId } as const;
    const prepare = await catalog.get("prepare_calendar_event_deletion")!.execute({ eventId, expectedCurrentRevisionId: revisionId, target }) as Record<string, unknown>;
    expect(prepare).toMatchObject({
      ok: true,
      previewId: "calendar-delete-preview-1",
      event: { id: eventId, currentRevisionId: revisionId, title: "Past physical therapy" },
      calendar: { id: calendarId, title: "My Calendar", provider: "life_links", writeAuthority: "life_links" },
      recurrenceScope: "event",
      knownEffects: ["The event leaves the selected Calendar.", "A restorable native tombstone is retained."],
      requiresAppObservedConfirmation: true,
      modelConfirmationAccepted: false
    });

    const apply = catalog.get("apply_calendar_event_deletion")!;
    await expect(apply.execute({ previewId: "calendar-delete-preview-1", confirmed: true })).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(controller.agentApplyCalendarEventDeletion).not.toHaveBeenCalled();

    controller.agentApplyCalendarEventDeletion.mockResolvedValueOnce({ ok: false, code: "confirmation_cancelled" });
    await expect(apply.execute({ previewId: "calendar-delete-preview-1" })).resolves.toMatchObject({ ok: false, error: { code: "confirmation_cancelled" } });
    await expect(apply.execute({ previewId: "calendar-delete-preview-1" })).resolves.toMatchObject({ ok: true, eventId, calendarId, tombstoneId, replayed: false });
    await expect(apply.execute({ previewId: "calendar-delete-preview-1" })).resolves.toMatchObject({ ok: true, replayed: true });
    expect(controller.agentApplyCalendarEventDeletion).toHaveBeenCalledTimes(2);
  });
});
