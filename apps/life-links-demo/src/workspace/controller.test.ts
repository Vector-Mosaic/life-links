import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalendarDomainError,
  createLinkBodyDocFromPlainText,
  createDemoSeedData,
  createCanonicalActivity,
  createCanonicalRoutine,
  createCanonicalRoutineGroup,
  createCanonicalRoutineSchedule,
  normalizeCalendarEventSpan,
  reviseCanonicalCalendarEvent,
  summarizeLifeLink,
  type CollectionRecord,
  type CollectionChangePreview,
  type CollectionSectionRecord,
  type CalendarRecord,
  type CalendarProviderBindingView,
  type CalendarProviderEventProjection,
  type CalendarEventSpanInput,
  type LifeLinkDetail,
  type LifeLinkChangePreview,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkRecord,
  type UpdateLifeLinkPatch
} from "@life-links/core";

import { LifeLinksWorkspaceController, type LifeLinksWorkspaceApi } from "./controller";
import { createCalendarAgentToolCatalog } from "../agent/calendarToolHandlers";
import { ApiError, type ApiAgentConnection, type CalendarEventDetail } from "../api";
import { writeCanonicalLifeLinkDraft } from "./editorSession";
import {
  classifyLifeLinksRoute,
  calendarEventIdFromPath,
  isCalendarPath,
  isRoutinesPath,
  lifeLinkIdFromPath,
  ownerCalendarEventPath,
  ownerRoutinePath,
  qrIdFromPath,
  routineIdFromPath,
  type WorkspaceBrowserRoute
} from "./routes";
import { attachmentImageFixture, attachmentPdfImageFixture, attachmentSelectedImageFixture, attachmentTranscriptFixture } from "../attachmentImage.testFixtures";
import { validateAttachmentImageResult } from "../attachmentImage";
import { InMemoryLifeLinksStore } from "../../../../services/life-links-api/src/store";

const owner = {
  id: "owner-1",
  email: "owner@example.test",
  displayName: "Owner",
  createdAt: "2026-08-25T00:00:00.000Z"
};

const connectedAgentConnection: ApiAgentConnection = {
  connected: true,
  connectedAt: "2026-08-27T21:00:00.000Z",
  toolCatalogId: "life-links-calendar-v2"
};

const disconnectedAgentConnection: ApiAgentConnection = {
  connected: false,
  connectedAt: null,
  toolCatalogId: null
};

const rootFixture = {
  id: "life-link-pantry",
  ownerId: owner.id,
  name: "Pantry",
  createdAt: "2026-08-25T00:00:00.000Z"
};

const link: LinkRecord = {
  id: "LL-DEMO-00001",
  url: "https://example.test/qr/LL-DEMO-00001",
  status: "claimed",
  ownerId: owner.id,
  title: "Shelf 1",
  body: "Dry goods",
  bodyDoc: createLinkBodyDocFromPlainText("Dry goods"),
  bodyDocVersion: 1,
  privacy: "private",
  media: [],
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z"
};

const rootLifeLink: LifeLinkRecord = {
  id: rootFixture.id,
  ownerId: owner.id,
  parentId: null,
  qrId: null,
  title: "Pantry",
  body: "",
  bodyDoc: createLinkBodyDocFromPlainText(""),
  bodyDocVersion: 1,
  privacy: "private",
  browsingRole: "container",
  context: { schemaVersion: 1 },
  placementConfirmedAt: null,
  publicFieldKeys: [],
  media: [],
  createdAt: rootFixture.createdAt,
  updatedAt: rootFixture.createdAt
};

const canonicalLink: LifeLinkRecord = {
  id: "life-link-shelf-1",
  ownerId: owner.id,
  parentId: rootLifeLink.id,
  qrId: link.id,
  title: link.title,
  body: link.body,
  bodyDoc: link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body),
  bodyDocVersion: link.bodyDocVersion ?? 1,
  privacy: link.privacy,
  browsingRole: "item",
  context: { schemaVersion: 1 },
  placementConfirmedAt: null,
  publicFieldKeys: [],
  media: [],
  createdAt: link.createdAt,
  updatedAt: link.updatedAt
};

const rootSummary: LifeLinkSummary = summary(rootLifeLink, 1);
const canonicalSummary: LifeLinkSummary = summary(canonicalLink, 0);
const canonicalDetail: LifeLinkDetail = {
  lifeLink: canonicalLink,
  ancestry: { items: [rootSummary, canonicalSummary], truncated: false, omittedCount: 0 },
  children: [],
  childrenPage: { nextCursor: null, truncated: false }
};

const collection: CollectionRecord = {
  id: "collection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ownerId: owner.id,
  title: "Camping Gear", purpose: "Family trips", notes: "", createdAt: rootFixture.createdAt, updatedAt: rootFixture.createdAt
};
const section: CollectionSectionRecord = {
  id: "section-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: owner.id, collectionId: collection.id,
  title: "Family sleep systems", position: 0, createdAt: rootFixture.createdAt, updatedAt: rootFixture.createdAt
};
const nativeCalendar: CalendarRecord = {
  id: "calendar-11111111-1111-4111-8111-111111111111",
  ownerId: owner.id,
  title: "My Calendar",
  color: "#7FC9B3",
  timeZone: "America/New_York",
  source: "native",
  agentAccess: "write",
  isDefault: true,
  createdAt: rootFixture.createdAt,
  updatedAt: rootFixture.createdAt,
  deletedAt: null
};
const nativeCalendarEvent: CalendarEventDetail = {
  event: {
    id: "calendar-event-22222222-2222-4222-8222-222222222222",
    ownerId: owner.id,
    calendarId: nativeCalendar.id,
    currentRevisionId: "calendar-event-revision-33333333-3333-4333-8333-333333333333",
    lineage: { kind: "standalone" },
    createdAt: rootFixture.createdAt,
    updatedAt: rootFixture.createdAt,
    deletedAt: null
  },
  currentRevision: {
    id: "calendar-event-revision-33333333-3333-4333-8333-333333333333",
    ownerId: owner.id,
    eventId: "calendar-event-22222222-2222-4222-8222-222222222222",
    revisionNumber: 1,
    title: "Dentist appointment",
    description: "Past appointments are valid Calendar history.",
    location: "Downtown",
    status: "confirmed",
    span: { kind: "all_day", startDate: "2026-08-20", endDateExclusive: "2026-08-21" },
    recurrence: null,
    subjectLinks: [],
    createdAt: rootFixture.createdAt
  }
};

describe("Life Links route classification", () => {
  it("keeps public QR, login, and owner surfaces explicit", () => {
    expect(qrIdFromPath("/qr/LL-DEMO-00001")).toBe("LL-DEMO-00001");
    expect(qrIdFromPath("/qr/Shelf%201/")).toBe("Shelf 1");
    expect(qrIdFromPath("/")).toBeNull();
    expect(lifeLinkIdFromPath("/life-links/life-link-shelf-1")).toBe("life-link-shelf-1");
    expect(isRoutinesPath("/routines")).toBe(true);
    expect(isRoutinesPath("/routines/Tuesday%20reset/")).toBe(true);
    expect(isRoutinesPath("/routines/one/more")).toBe(false);
    expect(routineIdFromPath("/routines/Tuesday%20reset/")).toBe("Tuesday reset");
    expect(ownerRoutinePath("routine/one")).toBe("/routines/routine%2Fone");
    expect(isCalendarPath("/calendar")).toBe(true);
    expect(isCalendarPath("/calendar/Team%20planning/" )).toBe(true);
    expect(isCalendarPath("/calendar/one/more")).toBe(false);
    expect(calendarEventIdFromPath("/calendar/Team%20planning/")).toBe("Team planning");
    expect(ownerCalendarEventPath("calendar-event/one")).toBe("/calendar/calendar-event%2Fone");
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", false)).toEqual({
      surface: "public-qr",
      qrId: "LL-DEMO-00001",
      lifeLinkId: null
    });
    expect(classifyLifeLinksRoute("/", false)).toEqual({ surface: "login", qrId: null, lifeLinkId: null });
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", true)).toEqual({
      surface: "public-qr",
      qrId: "LL-DEMO-00001",
      lifeLinkId: null
    });
    expect(classifyLifeLinksRoute("/life-links/life-link-shelf-1", true)).toEqual({
      surface: "owner-workspace",
      qrId: null,
      lifeLinkId: "life-link-shelf-1"
    });
  });
});

describe("LifeLinksWorkspaceController", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("boots through the shared API boundary and publishes one owner snapshot", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      currentUser: owner,
      links: [link],
      activeQrId: link.id,
      activeView: "home",
      rootLifeLinks: expect.objectContaining({ items: [rootSummary], loaded: true }),
      loading: false,
      error: ""
    });
    expect(api.getConfig).toHaveBeenCalledOnce();
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(api.listLifeLinks).toHaveBeenCalledWith({ limit: 25 });
    expect(listener).toHaveBeenCalled();
    controller.dispose();
  });

  it("boots an exact Calendar event route through Calendar boundaries only", async () => {
    const route = new FakeRoute(ownerCalendarEventPath(nativeCalendarEvent.event.id));
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "calendar",
      routePathname: ownerCalendarEventPath(nativeCalendarEvent.event.id),
      detailsOpen: true,
      calendarWorkspace: {
        calendars: [nativeCalendar],
        selectedEvent: nativeCalendarEvent,
        loading: false,
        error: ""
      }
    });
    expect(api.getCalendarEvent).toHaveBeenCalledWith(nativeCalendarEvent.event.id, undefined, "human");
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    controller.dispose();
  });

  it.each<CalendarEventSpanInput>([
    { kind: "all_day", startDate: "2026-08-20", endDateExclusive: "2026-08-21" },
    {
      kind: "zoned", startLocalDateTime: "2026-08-20T09:00", endLocalDateTime: "2026-08-20T10:00",
      timeZone: "America/New_York"
    }
  ])("revises a $kind Calendar event through canonical validation without submitting derived timing", async (span) => {
    const api = fakeApi();
    let persisted: CalendarEventDetail = {
      ...structuredClone(nativeCalendarEvent),
      currentRevision: { ...structuredClone(nativeCalendarEvent.currentRevision), span: normalizeCalendarEventSpan(span) }
    };
    const original = structuredClone(persisted);
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockImplementation(async () => ({ calendarEvent: structuredClone(persisted), latestTombstone: null }));
    api.updateCalendarEvent.mockImplementation(async (eventId, input) => {
      // Exercise the same strict input normalizer and revision constructor used by both API stores.
      const { target: _target, ...command } = input;
      persisted = reviseCanonicalCalendarEvent(persisted.event, persisted.currentRevision, {
        ...command,
        revisionId: input.revisionId!,
        ownerId: owner.id,
        eventId,
        createdAt: "2026-09-01T16:00:00.000Z"
      });
      return { calendarEvent: structuredClone(persisted), latestTombstone: null };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    await controller.connectAgent();
    const revisionId = "calendar-event-revision-44444444-4444-4444-8444-444444444444";
    const target = { scope: "event" as const, eventId: persisted.event.id };

    const result = await controller.agentUpdateCalendarEvent({
      eventId: persisted.event.id, expectedCurrentRevisionId: persisted.currentRevision.id,
      revisionId, target, patch: { title: "Updated appointment" }
    });

    expect(result).toMatchObject({ ok: true, detail: { currentRevision: { id: revisionId, title: "Updated appointment" } } });
    expect(api.updateCalendarEvent.mock.calls[0][1].span).toEqual(span);
    expect(persisted.currentRevision.span).toEqual(original.currentRevision.span);
    expect(persisted.currentRevision).toMatchObject({
      description: original.currentRevision.description, location: original.currentRevision.location,
      status: original.currentRevision.status, recurrence: original.currentRevision.recurrence,
      subjectLinks: original.currentRevision.subjectLinks
    });
    expect(controller.getSnapshot().calendarWorkspace.selectedEvent).toEqual(persisted);

    const replacementSpan: CalendarEventSpanInput = {
      kind: "zoned", startLocalDateTime: "2026-11-04T09:00", endLocalDateTime: "2026-11-04T10:00",
      timeZone: "America/New_York"
    };
    await expect(controller.agentUpdateCalendarEvent({
      eventId: persisted.event.id, expectedCurrentRevisionId: revisionId,
      revisionId: "calendar-event-revision-55555555-5555-4555-8555-555555555555",
      target, patch: { span: replacementSpan }
    })).resolves.toMatchObject({ ok: true });
    expect(api.updateCalendarEvent.mock.calls[1][1].span).toEqual(replacementSpan);
    expect(persisted.currentRevision.span).toEqual(normalizeCalendarEventSpan(replacementSpan));
    expect(persisted.currentRevision.title).toBe("Updated appointment");
    controller.dispose();
  });

  it("replays a committed Calendar update after a lost response through the store and rejects changed or stale retries", async () => {
    const api = fakeApi();
    const store = new InMemoryLifeLinksStore();
    await store.seedDemo("synthetic-calendar-controller-test", "https://example.test");
    const testOwner = createDemoSeedData(rootFixture.createdAt).users[0];
    const calendar = await store.createCalendar({
      id: nativeCalendar.id, ownerId: testOwner.id, title: nativeCalendar.title,
      timeZone: nativeCalendar.timeZone, createdAt: rootFixture.createdAt
    });
    const original = await store.createCalendarEvent({
      id: nativeCalendarEvent.event.id, ownerId: testOwner.id, calendarId: calendar.id,
      revisionId: nativeCalendarEvent.currentRevision.id, lineage: { kind: "standalone" },
      title: "Original appointment", span: {
        kind: "zoned", startLocalDateTime: "2026-08-20T09:00", endLocalDateTime: "2026-08-20T10:00",
        timeZone: "America/New_York"
      }, createdAt: rootFixture.createdAt
    });
    api.getMe.mockResolvedValue({ user: testOwner, qrBaseUrl: "https://example.test", agentConnection: connectedAgentConnection });
    api.listCalendars.mockResolvedValue({ calendars: [calendar], nextCursor: null, truncated: false });
    api.getCalendar.mockResolvedValue({ calendar });
    api.getCalendarEvent.mockImplementation(async (eventId) => ({
      calendarEvent: (await store.getCalendarEvent(testOwner.id, eventId))!, latestTombstone: null
    }));
    let loseFirstResponse = true;
    api.updateCalendarEvent.mockImplementation(async (eventId, input) => {
      const { target: _target, ...command } = input;
      let calendarEvent: CalendarEventDetail | null;
      try {
        calendarEvent = await store.reviseCalendarEvent(testOwner.id, {
          ...command, revisionId: input.revisionId!, ownerId: testOwner.id, eventId,
          createdAt: "2026-09-01T16:00:00.000Z"
        });
      } catch (error) {
        if (error instanceof CalendarDomainError) throw new ApiError(409, error.code, {}, { reason: error.reason });
        throw error;
      }
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("connection lost after Calendar revision committed");
      }
      return { calendarEvent: calendarEvent!, latestTombstone: null };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const request = {
      eventId: original.event.id, expectedCurrentRevisionId: original.currentRevision.id,
      revisionId: "calendar-event-revision-66666666-6666-4666-8666-666666666666",
      target: { scope: "event" as const, eventId: original.event.id }, patch: { title: "Revised appointment" }
    };

    await expect(controller.agentUpdateCalendarEvent(request)).resolves.toEqual({ ok: false, code: "effect_not_applied" });
    expect((await store.getCalendarEvent(testOwner.id, original.event.id))?.currentRevision.id).toBe(request.revisionId);
    await expect(controller.agentUpdateCalendarEvent(request)).resolves.toMatchObject({
      ok: true, detail: { currentRevision: { id: request.revisionId, revisionNumber: 2, title: "Revised appointment" } }
    });
    expect(api.updateCalendarEvent.mock.calls[1][1]).toEqual(api.updateCalendarEvent.mock.calls[0][1]);

    await expect(controller.agentUpdateCalendarEvent({ ...request, patch: { title: "Different retry payload" } }))
      .resolves.toEqual({ ok: false, code: "stale_calendar_event" });
    expect((await store.getCalendarEvent(testOwner.id, original.event.id))?.currentRevision)
      .toMatchObject({ id: request.revisionId, revisionNumber: 2, title: "Revised appointment" });
    expect(api.updateCalendarEvent).toHaveBeenCalledTimes(3);

    const { target: _target, ...committedCommand } = api.updateCalendarEvent.mock.calls[1][1];
    await store.reviseCalendarEvent(testOwner.id, {
      ...committedCommand, ownerId: testOwner.id, eventId: original.event.id,
      expectedCurrentRevisionId: request.revisionId,
      revisionId: "calendar-event-revision-77777777-7777-4777-8777-777777777777",
      title: "Newer human revision", createdAt: "2026-09-01T16:01:00.000Z"
    });
    await expect(controller.agentUpdateCalendarEvent(request)).resolves.toEqual({ ok: false, code: "stale_calendar_event" });
    expect(api.updateCalendarEvent).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("drops an obsolete Calendar window after navigation changes", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    const events = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listCalendarEvents"]>>>();
    api.listCalendarEvents.mockImplementationOnce(() => events.promise);
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();

    const pending = controller.loadCalendarWindow({ startDate: "2026-08-01", endDate: "2026-08-31" });
    await controller.openRoutines();
    events.resolve({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    await pending;

    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "routines",
      calendarWorkspace: { events: [], range: null }
    });
    controller.dispose();
  });

  it("quietly refreshes the existing Calendar window once without changing presentation", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const range = { startDate: "2026-08-01", endDate: "2026-08-31" };
    await controller.loadCalendarWindow(range);
    controller.setCalendarPresentation({ view: "week", anchorDate: "2026-08-20", selectedDate: "2026-08-20" });
    const presentation = controller.getSnapshot().presentation;
    const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listCalendarEvents"]>>>();
    api.listCalendarEvents.mockImplementationOnce(() => response.promise);
    const pending = controller.loadCalendarWindow({ ...range, background: true });
    await controller.loadCalendarWindow({ ...range, background: true });
    expect(api.listCalendarEvents).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().calendarWorkspace).toMatchObject({ loading: false, events: [nativeCalendarEvent] });
    expect(controller.getSnapshot().routineWorkspace.calendarLoading).toBe(false);
    const fresh = { ...nativeCalendarEvent, currentRevision: { ...nativeCalendarEvent.currentRevision, title: "Updated elsewhere" } };
    response.resolve({ calendarEvents: [fresh], nextCursor: null, truncated: false });
    await pending;
    expect(controller.getSnapshot().calendarWorkspace.events).toEqual([fresh]);
    expect(controller.getSnapshot().presentation).toEqual(presentation);
    controller.dispose();
  });

  it("does not replace an acknowledged Calendar save with an older background response", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const range = { startDate: "2026-08-01", endDate: "2026-08-31" };
    await controller.loadCalendarWindow(range);
    const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listCalendarEvents"]>>>();
    api.listCalendarEvents.mockImplementationOnce(() => response.promise);
    const pending = controller.loadCalendarWindow({ ...range, background: true });
    api.createCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    await controller.createNativeCalendarEvent({ calendarId: nativeCalendar.id, lineage: { kind: "standalone" },
      title: nativeCalendarEvent.currentRevision.title, description: "", location: "", status: "confirmed",
      span: nativeCalendarEvent.currentRevision.span, recurrence: null, subjectLinks: [] });
    response.resolve({ calendarEvents: [], nextCursor: null, truncated: false });
    await pending;
    expect(controller.getSnapshot().calendarWorkspace.events).toEqual([nativeCalendarEvent]);
    expect(controller.getSnapshot().calendarWorkspace.selectedEvent).toEqual(nativeCalendarEvent);
    controller.dispose();
  });

  it("retains displayed events after a failed quiet refresh and allows the next pass", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const range = { startDate: "2026-08-01", endDate: "2026-08-31" };
    await controller.loadCalendarWindow(range);
    api.listCalendarEvents.mockRejectedValueOnce(new Error("Calendar refresh unavailable"));
    await expect(controller.loadCalendarWindow({ ...range, background: true })).rejects.toThrow("Calendar refresh unavailable");
    expect(controller.getSnapshot().calendarWorkspace).toMatchObject({ events: [nativeCalendarEvent], loading: false, error: "Calendar refresh unavailable" });
    await controller.loadCalendarWindow({ ...range, background: true });
    expect(controller.getSnapshot().calendarWorkspace.error).toBe("");
    controller.dispose();
  });

  it("quietly recovers the exact requested Calendar window after its first load fails", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const range = { startDate: "2026-08-01", endDate: "2026-08-31" };
    api.listCalendarEvents.mockRejectedValueOnce(new Error("Offline"));
    await expect(controller.loadCalendarWindow(range)).rejects.toThrow("Offline");
    expect(controller.getSnapshot().calendarWorkspace.range).toBeNull();
    await controller.loadCalendarWindow({ startDate: "2026-07-01", endDate: "2026-07-31", background: true });
    expect(api.listCalendarEvents).toHaveBeenCalledOnce();
    await controller.loadCalendarWindow({ ...range, background: true });
    expect(controller.getSnapshot().calendarWorkspace).toMatchObject({ range, events: [nativeCalendarEvent], loading: false, error: "" });
    controller.dispose();
  });

  it.each(["abort", "peer", "logout"] as const)("drops a late quiet Calendar result after %s", async (reason) => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    const range = { startDate: "2026-08-01", endDate: "2026-08-31" };
    await controller.loadCalendarWindow(range);
    const abort = new AbortController();
    const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listCalendarEvents"]>>>();
    api.listCalendarEvents.mockImplementationOnce(() => response.promise);
    const pending = controller.loadCalendarWindow({ ...range, background: true, signal: abort.signal });
    if (reason === "abort") abort.abort();
    else if (reason === "peer") await controller.openRoutines();
    else await controller.logout();
    response.resolve({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    await pending;
    expect(controller.getSnapshot().calendarWorkspace.events).toEqual([]);
    expect(controller.getSnapshot().calendarWorkspace.error).toBe("");
    controller.dispose();
  });

  it("uses the authenticated Calendar clock for the selected IANA view zone", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarClock.mockResolvedValue({
      serverTime: "2026-09-02T02:00:00.000Z", timeZone: "Pacific/Auckland", today: "2026-09-02"
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();

    await expect(controller.loadCalendarClock("Pacific/Auckland")).resolves.toMatchObject({
      timeZone: "Pacific/Auckland", today: "2026-09-02"
    });
    expect(api.getCalendarClock).toHaveBeenCalledWith("Pacific/Auckland", undefined);
    expect(controller.getSnapshot().calendarWorkspace.clock).toMatchObject({
      timeZone: "Pacific/Auckland", today: "2026-09-02"
    });
    controller.dispose();
  });

  it("queries canonical Calendar instances through the shared recurrence materializer", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    await controller.connectAgent();

    const result = await controller.agentQueryCalendarEvents({
      startDate: "2026-08-20", endDate: "2026-08-20", limit: 2
    });

    expect(result).toMatchObject({
      ok: true,
      instances: [{
        instance: {
          instanceId: `calendar-instance:${nativeCalendarEvent.event.id}`,
          eventId: nativeCalendarEvent.event.id,
          revisionId: nativeCalendarEvent.currentRevision.id,
          calendarId: nativeCalendar.id,
          masterEventId: null,
          originalOccurrence: null,
          isException: false,
          title: nativeCalendarEvent.currentRevision.title
        },
        calendar: { id: nativeCalendar.id, provider: "life_links", writeAuthority: "life_links" }
      }],
      nextCursor: null,
      truncated: false
    });
    controller.dispose();
  });

  it("honors current Calendar grants separately from the human workspace and sends narrowed agent requests", async () => {
    const api = fakeApi();
    let grant: CalendarRecord["agentAccess"] = "read";
    api.listCalendars.mockImplementation(async () => ({ calendars: [{ ...nativeCalendar, agentAccess: grant }], nextCursor: null, truncated: false }));
    api.getCalendar.mockImplementation(async () => ({ calendar: { ...nativeCalendar, agentAccess: grant } }));
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    await controller.connectAgent();
    await expect(controller.agentListAuthorizedCalendars({ limit: 10 })).resolves.toMatchObject({
      ok: true, calendars: [{ id: nativeCalendar.id, agentAccess: "read" }]
    });
    await expect(controller.agentInspectCalendarEvent({ eventId: nativeCalendarEvent.event.id })).resolves.toMatchObject({ ok: true });
    expect(api.getCalendarEvent).toHaveBeenCalledWith(nativeCalendarEvent.event.id, undefined, "agent");
    const target = { scope: "event" as const, eventId: nativeCalendarEvent.event.id };
    await expect(controller.agentUpdateCalendarEvent({ eventId: nativeCalendarEvent.event.id,
      expectedCurrentRevisionId: nativeCalendarEvent.currentRevision.id,
      revisionId: "calendar-event-revision-44444444-4444-4444-8444-444444444444", target,
      patch: { title: "Denied write" } })).resolves.toMatchObject({ ok: false });
    await expect(controller.agentPrepareCalendarEventDeletion({ eventId: nativeCalendarEvent.event.id,
      expectedCurrentRevisionId: nativeCalendarEvent.currentRevision.id, target })).resolves.toMatchObject({ ok: false });
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    grant = "none";
    await expect(controller.agentListAuthorizedCalendars({ limit: 10 })).resolves.toMatchObject({ ok: true, calendars: [] });
    await expect(controller.agentQueryCalendarEvents({ startDate: "2026-08-20", endDate: "2026-08-20", limit: 10 }))
      .resolves.toMatchObject({ ok: true, instances: [] });
    expect(api.listCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({ actor: "agent" }));
    await expect(controller.agentInspectCalendarEvent({ eventId: nativeCalendarEvent.event.id })).resolves.toMatchObject({ ok: false });
    // Owner data stays present; a denied agent read is not a deletion or an owner visibility setting.
    expect(controller.getSnapshot().calendarWorkspace.calendars).toHaveLength(1);
    controller.dispose();
  });

  it("refuses a Calendar deletion prepared before access was revoked", async () => {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    await controller.connectAgent();
    const prepared = await controller.agentPrepareCalendarEventDeletion({ eventId: nativeCalendarEvent.event.id,
      expectedCurrentRevisionId: nativeCalendarEvent.currentRevision.id,
      target: { scope: "event", eventId: nativeCalendarEvent.event.id } });
    if (!prepared.ok) throw new Error("Expected preview under initial write grant.");
    api.getCalendar.mockResolvedValue({ calendar: { ...nativeCalendar, agentAccess: "read" } });
    await expect(controller.agentApplyCalendarEventDeletion(prepared.preview.id)).resolves.toMatchObject({ ok: false });
    expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toBeNull();
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("rejects Calendar controller calls under the older fourteen-tool grant", async () => {
    const api = fakeApi();
    api.getMe.mockResolvedValue({ user: owner, qrBaseUrl: "https://example.test", agentConnection: {
      ...connectedAgentConnection, toolCatalogId: "life-links-page-webmcp-v1"
    } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await expect(controller.agentListAuthorizedCalendars({ limit: 10 })).resolves.toMatchObject({ ok: false });
    expect(api.listCalendars).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("loads Calendar connection settings and refuses stale readback after logout", async () => {
    const api = fakeApi();
    const connection = {
      ownerId: owner.id, connectionId: "connection-synthetic", providerKey: "google", providerAccountId: "synthetic-account",
      status: "active" as const, connectedAt: rootFixture.createdAt, disconnectedAt: null,
      remoteRevocationStatus: "not_required" as const, remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null
    };
    const bound = { calendar: { ...nativeCalendar, source: "external" as const, agentAccess: "none" as const },
      connectionId: connection.connectionId, providerCalendarId: "provider-synthetic", providerDisplayName: "Personal",
      capabilities: { read: true, create: false, update: false, delete: false }, visible: true };
    api.listCalendarConnections.mockResolvedValue({ connections: [connection] });
    api.listConnectedCalendars.mockResolvedValue({ calendars: [bound] });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.loadCalendarConnections();
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement).toMatchObject({
      loaded: true, connections: [connection], calendars: [bound]
    });
    const delayed = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listConnectedCalendars"]>>>();
    api.listConnectedCalendars.mockImplementationOnce(() => delayed.promise);
    const pending = controller.loadCalendarConnections();
    await vi.waitFor(() => expect(api.listConnectedCalendars).toHaveBeenCalledTimes(2));
    await controller.logout();
    delayed.resolve({ calendars: [bound] });
    await pending;
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement).toMatchObject({ loaded: false, calendars: [], connections: [] });
    controller.dispose();
  });

  it("includes Routine-owned Calendar projections without presenting them as mutable Calendar events", async () => {
    const routineId = "routine-44444444-4444-4444-8444-444444444444";
    const routineRevisionId = "routine-revision-55555555-5555-4555-8555-555555555555";
    const occurrence = {
      id: "routine-occurrence-66666666-6666-4666-8666-666666666666",
      ownerId: owner.id,
      scheduleId: "routine-schedule-77777777-7777-4777-8777-777777777777",
      scheduleRevision: 1,
      routineId,
      routineRevisionId,
      localDate: "2026-08-20",
      plannedFor: "2026-08-20T13:00:00.000Z",
      status: "planned" as const,
      createdAt: rootFixture.createdAt,
      updatedAt: rootFixture.createdAt
    };
    const routine = {
      id: routineId,
      ownerId: owner.id,
      groupId: null,
      currentRevisionId: routineRevisionId,
      revisionNumber: 1,
      title: "Thursday strength",
      purpose: "Build strength",
      createdAt: rootFixture.createdAt,
      updatedAt: rootFixture.createdAt,
      archivedAt: null
    };
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.listCalendarEvents.mockResolvedValue({ calendarEvents: [nativeCalendarEvent], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValue({ routines: [routine], nextCursor: null, truncated: false });
    api.listRoutineOccurrences.mockImplementation(async (options = {}) => ({
      occurrences: options.startDate ? [occurrence] : [], nextCursor: null, truncated: false
    }));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start();
    await controller.connectAgent();

    const result = await controller.agentQueryCalendarEvents({
      startDate: "2026-08-20", endDate: "2026-08-20", calendarIds: [nativeCalendar.id], limit: 2
    });

    expect(result).toMatchObject({
      ok: true,
      instances: [
        { source: "calendar_event", instance: { eventId: nativeCalendarEvent.event.id } },
        {
          source: "routine_projection",
          occurrence: { id: occurrence.id, routineId, routineRevisionId },
          routine: { id: routineId, title: "Thursday strength" }
        }
      ],
      nextCursor: null,
      truncated: false
    });
    expect(api.materializeRoutineOccurrences).toHaveBeenCalledWith({
      startDate: "2026-08-20", endDate: "2026-08-20", signal: undefined
    });
    controller.dispose();
  });

  it("replays an exact confirmed Calendar deletion after a lost response without confirming twice", async () => {
    const deletedAt = "2026-09-01T12:05:00.000Z";
    const deleted = {
      ...nativeCalendarEvent,
      event: { ...nativeCalendarEvent.event, updatedAt: deletedAt, deletedAt }
    };
    const tombstone = {
      id: "calendar-event-tombstone-stable-calendar-delete",
      ownerId: owner.id,
      calendarId: nativeCalendar.id,
      eventId: nativeCalendarEvent.event.id,
      lastRevisionId: nativeCalendarEvent.currentRevision.id,
      lineage: nativeCalendarEvent.event.lineage,
      deletedAt
    };
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    api.deleteCalendarEvent.mockImplementationOnce(async (_eventId, input) => {
      expect(input.tombstoneId).toBe(tombstone.id);
      api.getCalendarEvent.mockResolvedValue({ calendarEvent: deleted, latestTombstone: tombstone });
      throw new Error("connection lost after Calendar deletion committed");
    }).mockResolvedValue({ calendarEvent: deleted, latestTombstone: tombstone });
    const controller = new LifeLinksWorkspaceController({
      api,
      route: new FakeRoute("/calendar"),
      commandId: () => "stable-calendar-delete"
    });
    await controller.start();
    await controller.connectAgent();
    const prepared = await controller.agentPrepareCalendarEventDeletion({
      eventId: nativeCalendarEvent.event.id,
      expectedCurrentRevisionId: nativeCalendarEvent.currentRevision.id,
      target: { scope: "event", eventId: nativeCalendarEvent.event.id }
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected a Calendar deletion preview.");

    const first = controller.agentApplyCalendarEventDeletion(prepared.preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toEqual(prepared.preview));
    controller.confirmAgentCalendarDeletion(true);
    expect(await first).toEqual({ ok: false, code: "effect_not_applied" });
    expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toBeNull();

    await expect(controller.agentApplyCalendarEventDeletion(prepared.preview.id)).resolves.toEqual({
      ok: true,
      result: {
        eventId: nativeCalendarEvent.event.id,
        calendarId: nativeCalendar.id,
        deleted: true,
        tombstoneId: tombstone.id
      }
    });
    expect(api.deleteCalendarEvent).toHaveBeenCalledTimes(2);
    expect(api.deleteCalendarEvent.mock.calls.map((call) => call[1].tombstoneId)).toEqual([tombstone.id, tombstone.id]);
    expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toBeNull();
    controller.dispose();
  });

  it("rejects a different Calendar tombstone as stale and requires a fresh confirmation", async () => {
    const deletedAt = "2026-09-01T12:06:00.000Z";
    const deleted = {
      ...nativeCalendarEvent,
      event: { ...nativeCalendarEvent.event, updatedAt: deletedAt, deletedAt }
    };
    const differentTombstone = {
      id: "calendar-event-tombstone-99999999-9999-4999-8999-999999999999",
      ownerId: owner.id,
      calendarId: nativeCalendar.id,
      eventId: nativeCalendarEvent.event.id,
      lastRevisionId: nativeCalendarEvent.currentRevision.id,
      lineage: nativeCalendarEvent.event.lineage,
      deletedAt
    };
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    const controller = new LifeLinksWorkspaceController({
      api,
      route: new FakeRoute("/calendar"),
      commandId: () => "stale-calendar-delete"
    });
    await controller.start();
    await controller.connectAgent();
    const prepared = await controller.agentPrepareCalendarEventDeletion({
      eventId: nativeCalendarEvent.event.id,
      expectedCurrentRevisionId: nativeCalendarEvent.currentRevision.id,
      target: { scope: "event", eventId: nativeCalendarEvent.event.id }
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("Expected a Calendar deletion preview.");

    const pending = controller.agentApplyCalendarEventDeletion(prepared.preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toEqual(prepared.preview));
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: deleted, latestTombstone: differentTombstone });
    controller.confirmAgentCalendarDeletion(true);

    expect(await pending).toEqual({ ok: false, code: "stale_calendar_event" });
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    const retry = controller.agentApplyCalendarEventDeletion(prepared.preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toEqual(prepared.preview));
    controller.confirmAgentCalendarDeletion(false);
    expect(await retry).toEqual({ ok: false, code: "confirmation_cancelled" });
    controller.dispose();
  });

  it("reads private attachments only while connected, through fresh owner metadata and the typed content API", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { lifeLinkId: canonicalLink.id, mediaId: "media-manual" };
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    expect(api.getLifeLinkAttachmentContent).not.toHaveBeenCalled();
    await controller.connectAgent();
    const media = { id: input.mediaId, lifeLinkId: input.lifeLinkId, ownerId: owner.id, kind: "document" as const,
      mimeType: "text/plain", fileName: "manual.txt", sizeBytes: 6, createdAt: link.createdAt, url: `/api/life-links/${input.lifeLinkId}/media/${input.mediaId}` };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    const page = { mediaId: input.mediaId, revision: "a".repeat(64), status: "ready" as const, reason: null,
      format: "text" as const, text: "Manual", offset: 0, nextOffset: null, totalChars: 6, warnings: [] };
    api.getLifeLinkAttachmentContent.mockResolvedValue(page);
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment({ lifeLinkId: input.lifeLinkId })).toEqual({ ok: true, kind: "list", attachments: [media], revision: canonicalLink.updatedAt });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "content", page });
    expect(api.getLifeLinkAttachmentContent).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, { offset: undefined, revision: undefined, limit: 1000, signal: undefined });
    expect(controller.getSnapshot()).toEqual(before);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    expect(await controller.agentReadAttachment({ lifeLinkId: input.lifeLinkId, revision: "stale", offset: 1 })).toEqual({ ok: false, code: "stale_life_link" });
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, ownerId: "other-owner", media: [media] } } });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    controller.dispose();
  });

  it("drops attachment text after disconnection and preserves cancellation", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.connectAgent();
    const media = { id: "media-1", lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "document" as const,
      mimeType: "text/plain", fileName: "manual.txt", sizeBytes: 7, createdAt: link.createdAt, url: `/api/life-links/${canonicalLink.id}/media/media-1` };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentContent.mockImplementation(async () => {
      await controller.disconnectAgent();
      return { mediaId: media.id, revision: "a".repeat(64), status: "ready", reason: null, format: "text", text: "private", offset: 0, nextOffset: null, totalChars: 7, warnings: [] };
    });
    expect(await controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id })).toEqual({ ok: false, code: "life_link_unavailable" });
    const abort = new AbortController();
    abort.abort();
    expect(await controller.agentReadAttachment({ lifeLinkId: canonicalLink.id }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    controller.dispose();
  });

  it.each(["image", "pdf", "docx", "xlsx", "video", "animation"] as const)("reads revision-bound %s bytes without changing the selected item, content, or history", async (kind) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const result = kind === "pdf" ? attachmentPdfImageFixture() : kind === "image" ? attachmentImageFixture() : attachmentSelectedImageFixture(kind);
    const selector = ["pdf", "docx", "xlsx"].includes(kind) ? { page: 2 } : kind === "video" ? { atMs: 1200 } : kind === "animation" ? { frame: 2 } : {};
    const media = { id: result.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "image" as const,
      mimeType: result.source!.mimeType, fileName: "photo.png", sizeBytes: result.source!.sizeBytes, createdAt: link.createdAt, url: "/private-image" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentImage.mockResolvedValue(result);
    const input = { lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "image" as const, mode: "overview" as const, sourceRevision: result.sourceRevision, ...selector };
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "image", result });
    expect(api.getLifeLinkAttachmentImage).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, { mode: "overview", sourceRevision: result.sourceRevision, ...selector }, undefined);
    expect(api.getLifeLinkAttachmentContent).not.toHaveBeenCalled();
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(before);
    if (["pdf", "docx", "xlsx"].includes(kind)) {
      expect(await controller.agentReadAttachment({ ...input, page: 1 })).toEqual({ ok: false, code: "effect_not_applied" });
    }
    api.getLifeLinkAttachmentImage.mockResolvedValue({ ...result, sourceRevision: "0".repeat(64) });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
    api.getLifeLinkAttachmentImage.mockResolvedValue({ ...result, source: { ...result.source!, sizeBytes: media.sizeBytes + 1 } });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
    api.getLifeLinkAttachmentImage.mockRejectedValue(new ApiError(409, "stale_attachment", {}));
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "stale_life_link" });
    api.getLifeLinkAttachmentImage.mockRejectedValue(new ApiError(404, "not_found", {}));
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    controller.dispose();
  });

  it.each(["image", "docx", "xlsx", "video", "animation"].flatMap((kind) => ["navigation", "disconnect", "editor", "owner", "abort"].map((change) => [kind, change])))
  ("drops %s bytes if %s changes during pending output-hash verification", async (kind, change) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const image = kind === "image" ? attachmentImageFixture() : attachmentSelectedImageFixture(kind as "docx" | "xlsx" | "video" | "animation");
    const selector = kind === "video" ? { atMs: 1200 } : kind === "animation" ? { frame: 2 } : kind === "image" ? {} : { page: 2 };
    const media = { id: image.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "image" as const,
      mimeType: image.source!.mimeType, fileName: "photo.png", sizeBytes: image.source!.sizeBytes, createdAt: link.createdAt, url: "/private-image" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    const actualDigest = Uint8Array.from(image.rendition!.sha256.match(/../g)!, (byte) => parseInt(byte, 16)).buffer;
    let finishDigest!: (value: ArrayBuffer) => void;
    let enteredDigest!: () => void;
    const entered = new Promise<void>((resolve) => { enteredDigest = resolve; });
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
      enteredDigest();
      return new Promise<ArrayBuffer>((resolve) => { finishDigest = resolve; });
    });
    api.getLifeLinkAttachmentImage.mockImplementation(async (_id, mediaId, options) => validateAttachmentImageResult(image, mediaId, options));
    const abort = new AbortController();
    try {
      const pending = controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "image", mode: "overview", sourceRevision: image.sourceRevision, ...selector }, abort.signal);
      await entered;
      if (change === "navigation") await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
      if (change === "disconnect") await controller.disconnectAgent();
      if (change === "editor") await controller.openCanonicalEditor(canonicalLink.id);
      if (change === "owner") await controller.logout();
      if (change === "abort") abort.abort();
      finishDigest(actualDigest);
      expect(await pending).toEqual({ ok: false, code: change === "abort" ? "cancelled" : change === "editor" ? "editor_open" : "life_link_unavailable" });
    } finally { digest.mockRestore(); controller.dispose(); }
  });

  it.each(["navigation", "disconnect", "editor", "owner", "abort"])("drops a transcript if %s changes while the private window is being read", async (change) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const page = attachmentTranscriptFixture();
    const media = { id: page.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "video" as const,
      mimeType: "video/mp4", fileName: "clip.mp4", sizeBytes: 900, createdAt: link.createdAt, url: "/private-video" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    let finish!: (page: ReturnType<typeof attachmentTranscriptFixture>) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    api.getLifeLinkAttachmentContent.mockImplementation(() => { entered(); return new Promise((resolve) => { finish = resolve; }); });
    const abort = new AbortController();
    try {
      const pending = controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "transcript", startMs: 30000 }, abort.signal);
      await ready;
      if (change === "navigation") await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
      if (change === "disconnect") await controller.disconnectAgent();
      if (change === "editor") await controller.openCanonicalEditor(canonicalLink.id);
      if (change === "owner") await controller.logout();
      if (change === "abort") abort.abort();
      finish(page);
      expect(await pending).toEqual({ ok: false, code: change === "abort" ? "cancelled" : change === "editor" ? "editor_open" : "life_link_unavailable" });
    } finally { controller.dispose(); }
  });

  it("checks transcript window identity after owner authorization without modifying the item or history", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const page = attachmentTranscriptFixture();
    const media = { id: page.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "video" as const,
      mimeType: "video/mp4", fileName: "clip.mp4", sizeBytes: 900, createdAt: link.createdAt, url: "/private-video" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentContent.mockResolvedValue(page);
    const input = { lifeLinkId: canonicalLink.id, mediaId: page.mediaId, representation: "transcript" as const, startMs: 30000, durationMs: 30000, audioStreamIndex: 1 };
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "content", page });
    expect(api.getLifeLinkAttachmentContent).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, expect.objectContaining({ representation: "transcript", startMs: 30000, durationMs: 30000, audioStreamIndex: 1 }));
    expect(controller.getSnapshot()).toBe(before);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    page.transcript!.endMs = -1;
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
    controller.dispose();
  });

  it("hydrates one durable agent connection across logout and login until explicit disconnect", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    api.getMe.mockResolvedValue({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: connectedAgentConnection
    });
    api.login.mockResolvedValue({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: connectedAgentConnection
    });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);

    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({
      currentUser: null,
      agentConnection: disconnectedAgentConnection
    });
    expect(api.disconnectAgent).not.toHaveBeenCalled();

    await controller.login(owner.email, "password");
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);

    await controller.disconnectAgent();
    expect(api.disconnectAgent).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().agentConnection).toEqual(disconnectedAgentConnection);

    await controller.connectAgent();
    expect(api.connectAgent).toHaveBeenCalledOnce();
    expect(api.connectAgent).toHaveBeenCalledWith("life-links-workspace-v3");
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);
    controller.dispose();
  });

  it("keeps an authenticated public QR route isolated from the private owner library", async () => {
    const freshPublicLink = { ...link, title: "Fresh public response" };
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    api.listLinks.mockResolvedValue({ links: [{ ...link, title: "Stale private inventory" }] });
    api.getQr.mockResolvedValue({ state: "claimed", link: freshPublicLink, viewerIsOwner: true });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();

    expect(api.getQr).toHaveBeenCalledWith(link.id);
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      links: [],
      rootLifeLinks: { items: [], loaded: false },
      publicQrState: { state: "claimed", link: freshPublicLink }
    });
    controller.dispose();
  });

  it("uses the same open operation for visible selection, route history, and QR state", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.openQr(link.id);

    expect(route.pushes).toEqual([`/qr/${link.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      activeQrId: link.id,
      activeView: "scan",
      routeQrId: link.id,
      publicQrState: { state: "claimed", link, viewerIsOwner: true }
    });
    expect(api.getQr).toHaveBeenCalledWith(link.id);
    controller.dispose();
  });

  it("synchronizes back and forward navigation without a second state owner", async () => {
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    route.pop("/");
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBeNull());
    expect(controller.getSnapshot().activeView).toBe("home");

    route.pop(`/qr/${link.id}`);
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBe(link.id));
    expect(controller.getSnapshot().activeView).toBe("scan");
    controller.dispose();
  });

  it("uses the canonical editor's immutable base revision and keeps a stale draft open", async () => {
    const api = fakeApi();
    api.updateLifeLink.mockRejectedValue(new ApiError(
      409,
      "stale_life_link",
      { error: { code: "stale_life_link" } },
      { message: "Life Link changed after it was read.", retryable: true }
    ));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);

    await controller.saveCanonicalLifeLink(canonicalLink.id, "2026-08-24T00:00:00.000Z", {
      title: "Stale draft title",
      body: canonicalLink.body,
      bodyDoc: canonicalLink.bodyDoc,
      bodyDocVersion: canonicalLink.bodyDocVersion,
      privacy: canonicalLink.privacy
    });

    expect(api.updateLifeLink).toHaveBeenCalledWith(
      canonicalLink.id,
      "2026-08-24T00:00:00.000Z",
      expect.objectContaining({ title: "Stale draft title" })
    );
    expect(controller.getSnapshot().canonicalEditingId).toBe(canonicalLink.id);
    expect(controller.getSnapshot().error).toBe("Life Link changed after it was read.");
    controller.dispose();
  });

  it("does not let a completed Save refresh overwrite newer Find Mode navigation", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const updatedLifeLink = {
      ...canonicalLink,
      body: "Saved before Find Mode",
      updatedAt: "2026-08-25T00:02:00.000Z"
    };
    api.updateLifeLink.mockResolvedValue({ lifeLink: updatedLifeLink });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);

    let releaseOwnerRefresh!: () => void;
    const ownerRefresh = new Promise<void>((resolve) => {
      releaseOwnerRefresh = resolve;
    });
    api.listLinks.mockImplementationOnce(async () => {
      await ownerRefresh;
      return { links: [{ ...link, body: updatedLifeLink.body, updatedAt: updatedLifeLink.updatedAt }] };
    });

    const pendingSave = controller.saveCanonicalLifeLink(canonicalLink.id, canonicalLink.updatedAt, {
      title: updatedLifeLink.title,
      body: updatedLifeLink.body,
      bodyDoc: updatedLifeLink.bodyDoc,
      bodyDocVersion: updatedLifeLink.bodyDocVersion,
      privacy: updatedLifeLink.privacy
    });
    await vi.waitFor(() => expect(controller.getSnapshot().canonicalEditingId).toBeNull());

    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "scan",
      detailsOpen: false,
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });

    releaseOwnerRefresh();
    await pendingSave;

    expect(controller.getSnapshot()).toMatchObject({
      activeView: "scan",
      detailsOpen: false,
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("selects canonical identity, expands ancestry, and pushes the stable owner route", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    expect(api.getLifeLinkDetail).toHaveBeenCalledWith(canonicalLink.id, { limit: 25 });
    expect(route.pushes).toEqual([`/life-links/${canonicalLink.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "workspace",
      selectedLifeLinkId: canonicalLink.id,
      highlightedLifeLinkId: canonicalLink.id,
      routeLifeLinkId: canonicalLink.id,
      expandedLifeLinkIds: [rootLifeLink.id]
    });
    expect(controller.getSnapshot().selectedLifeLinkDetail).toEqual(canonicalDetail);
    controller.dispose();
  });

  it("never invents a local tree edge across omitted middle ancestry", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const tailParent = {
      ...canonicalLink,
      id: "life-link-tail-parent",
      parentId: "life-link-omitted-parent",
      qrId: null,
      title: "Returned tail parent"
    };
    const deepLifeLink = {
      ...canonicalLink,
      id: "life-link-deep-selected",
      parentId: tailParent.id,
      qrId: null,
      title: "Deep selected Life Link"
    };
    const tailParentSummary = summary(tailParent, 1);
    const deepSummary = summary(deepLifeLink, 0);
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) => ({
      lifeLinks: parentId === tailParent.id ? [deepSummary] : [rootSummary], nextCursor: null, truncated: false
    }));
    api.getLifeLinkDetail.mockResolvedValue({
      detail: {
        lifeLink: deepLifeLink,
        ancestry: {
          items: [rootSummary, tailParentSummary, deepSummary],
          truncated: true,
          omittedCount: 4
        },
        children: [],
        childrenPage: { nextCursor: null, truncated: false }
      }
    });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.selectLifeLink({ lifeLinkId: deepLifeLink.id, source: "search" });

    const snapshot = controller.getSnapshot();
    expect(snapshot.lifeLinkChildren[rootLifeLink.id]).toBeUndefined();
    expect(snapshot.lifeLinkChildren[tailParent.id].items).toEqual([deepSummary]);
    expect(snapshot.selectedLifeLinkId).toBe(deepLifeLink.id);
    controller.dispose();
  });

  it("loads children lazily and uses server-backed path search", async () => {
    const api = fakeApi();
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) =>
      parentId === rootLifeLink.id
        ? { lifeLinks: [canonicalSummary], nextCursor: null, truncated: false }
        : { lifeLinks: [rootSummary], nextCursor: null, truncated: false }
    );
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    await controller.toggleLifeLinkExpanded(rootLifeLink.id);
    controller.setLifeLinkSearchQuery("Pantry Shelf");
    await controller.searchLifeLinks();

    expect(api.listLifeLinks).toHaveBeenLastCalledWith({ parentId: rootLifeLink.id, cursor: null, limit: 25 });
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id].items).toEqual([canonicalSummary]);
    expect(api.searchLifeLinks).toHaveBeenCalledWith("Pantry Shelf", { cursor: null, limit: 25 });
    expect(controller.getSnapshot().lifeLinkSearchResults[0].lifeLink.id).toBe(canonicalLink.id);
    controller.dispose();
  });

  it("preserves a selected deep-link path while completing a previously partial branch", async () => {
    const sibling = summary({
      ...canonicalLink,
      id: "life-link-first-page-sibling",
      qrId: null,
      title: "First page sibling"
    }, 0);
    const api = fakeApi();
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) => ({
      lifeLinks: parentId === rootLifeLink.id ? [sibling] : [rootSummary],
      nextCursor: null,
      truncated: false
    }));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "route" });

    // Direct-layer navigation loads the parent immediately and retains a known
    // selected path even if its row is outside the server's current page.
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id]).toMatchObject({
      items: [sibling, canonicalSummary], loaded: true
    });
    await controller.loadMoreLifeLinks(rootLifeLink.id);

    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id]).toMatchObject({
      items: [sibling, canonicalSummary],
      loaded: true
    });
    controller.dispose();
  });

  it("routes move, detach, and QR attach through canonical controller operations", async () => {
    const api = fakeApi();
    const moved = { ...canonicalLink, parentId: null, updatedAt: "2026-08-25T00:02:00.000Z" };
    api.moveLifeLink.mockResolvedValue({ lifeLink: moved });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await controller.detachLifeLink(canonicalLink.id);
    await controller.attachQrToLifeLink(canonicalLink.id, link.id);

    expect(api.moveLifeLink).toHaveBeenCalledWith(canonicalLink.id, null, canonicalLink.updatedAt, { signal: undefined });
    expect(api.attachQr).toHaveBeenCalledWith(link.id, canonicalLink.id, expect.stringMatching(/^attach-/));
    controller.dispose();
  });

  it("preserves the committed move result and reports a failed hierarchy reconciliation", async () => {
    const api = fakeApi();
    const moved = { ...canonicalLink, parentId: null, updatedAt: "2026-08-25T00:02:00.000Z" };
    api.moveLifeLink.mockResolvedValue({ lifeLink: moved });
    api.listLifeLinks.mockImplementation(async (options: { parentId?: string | null } = {}) => {
      if (options.parentId === rootLifeLink.id) {
        throw new Error("Hierarchy refresh unavailable");
      }
      return { lifeLinks: [rootSummary], nextCursor: null, truncated: false };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await controller.detachLifeLink(canonicalLink.id);

    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink).toEqual(moved);
    expect(controller.getSnapshot().error).toBe("Hierarchy refresh unavailable");
    expect(api.moveLifeLink).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("keeps a claimed public QR public-facing until the owner explicitly opens the workspace", async () => {
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.claimActiveLink();

    expect(api.claimQr).toHaveBeenCalledWith(link.id, expect.stringMatching(/^claim-/));
    expect(api.getQr).toHaveBeenCalledTimes(2);
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(route.pushes).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      routeQrId: link.id,
      routeLifeLinkId: null,
      selectedLifeLinkId: null,
      canonicalEditingId: null,
      editingId: null,
      publicQrState: { state: "claimed", link, viewerIsOwner: true }
    });

    await controller.openPublicQrInWorkspace();

    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(route.pushes).toEqual([`/life-links/${canonicalLink.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      routeLifeLinkId: canonicalLink.id,
      selectedLifeLinkId: canonicalLink.id,
      canonicalEditingId: null,
      editingId: null,
      publicQrState: null
    });
    controller.dispose();
  });

  it("performs one revision-safe agent content update through the canonical API and opens the result", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/");
    const updated = {
      ...canonicalLink,
      title: "Shelf 1 inventory",
      updatedAt: "2026-08-25T00:03:00.000Z"
    };
    api.updateLifeLink.mockResolvedValue({ lifeLink: updated });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    api.getLifeLinkDetail.mockClear();

    const result = await controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      title: "Shelf 1 inventory",
      sourceLifeLinkIds: [rootLifeLink.id]
    });

    expect(result).toEqual({ ok: true });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(4);
    expect(api.getLifeLinkDetail).toHaveBeenLastCalledWith(rootLifeLink.id, { limit: 25, signal: undefined });
    expect(api.updateLifeLink).toHaveBeenCalledOnce();
    expect(api.updateLifeLink).toHaveBeenCalledWith(
      canonicalLink.id,
      canonicalLink.updatedAt,
      { title: "Shelf 1 inventory" },
      { signal: undefined }
    );
    expect(controller.getSnapshot()).toMatchObject({
      selectedLifeLinkId: canonicalLink.id,
      selectedLifeLinkDetail: { lifeLink: updated },
      canonicalEditingId: null
    });
    expect(route.pushes).toContain(`/life-links/${canonicalLink.id}`);
    controller.dispose();
  });

  it("maps a stale canonical PATCH without claiming a visible update", async () => {
    const api = fakeApi();
    api.updateLifeLink.mockRejectedValue(new ApiError(
      409,
      "stale_life_link",
      { error: { code: "stale_life_link" } },
      { message: "Life Link changed after it was read.", retryable: true }
    ));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not overwrite a concurrent change",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });
    expect(api.updateLifeLink).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().selectedLifeLinkId).toBeNull();
    controller.dispose();
  });

  it("propagates revocation cancellation through the canonical agent PATCH", async () => {
    const api = fakeApi();
    const abortController = new AbortController();
    api.updateLifeLink.mockImplementationOnce(async (_lifeLinkId, _expectedUpdatedAt, _patch, options) =>
      await new Promise((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Agent connection removed", "AbortError")),
          { once: true }
        );
      })
    );
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    const pending = controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not outlive the active agent connection",
      sourceLifeLinkIds: []
    }, abortController.signal);
    await vi.waitFor(() => expect(api.updateLifeLink).toHaveBeenCalledOnce());
    abortController.abort(new DOMException("Agent connection removed", "AbortError"));

    await expect(pending).resolves.toEqual({ ok: false, code: "cancelled" });
    expect(api.updateLifeLink.mock.calls[0]?.[3]).toEqual({ signal: abortController.signal });
    expect(controller.getSnapshot().selectedLifeLinkId).toBeNull();
    controller.dispose();
  });

  it("rejects an agent update when the target revision changed before the PATCH", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    api.getLifeLinkDetail.mockResolvedValueOnce({
      detail: {
        ...canonicalDetail,
        lifeLink: { ...canonicalLink, updatedAt: "2026-08-25T00:03:00.000Z" }
      }
    });

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Stale update",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });

    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(controller.getSnapshot().canonicalEditingId).toBeNull();
    controller.dispose();
  });

  it("rejects an agent update when the target changes during source authorization", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const refreshedDetail = {
      ...canonicalDetail,
      lifeLink: {
        ...canonicalLink,
        body: "Changed while the source was being authorized",
        updatedAt: "2026-08-25T00:03:00.000Z"
      }
    };
    api.getLifeLinkDetail.mockClear();
    api.getLifeLinkDetail
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockResolvedValueOnce({ detail: refreshedDetail });

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not overwrite the newer target",
      sourceLifeLinkIds: [rootLifeLink.id]
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });

    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(3);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      canonicalEditingId: null
    });
    controller.dispose();
  });

  it("rejects an agent update while a human draft exists, even with the editor closed", async () => {
    const api = fakeApi();
    writeCanonicalLifeLinkDraft(canonicalLink.id, canonicalLink.updatedAt, {
      title: "Human draft",
      body: canonicalLink.body,
      bodyDoc: canonicalLink.bodyDoc,
      bodyDocVersion: canonicalLink.bodyDocVersion,
      privacy: canonicalLink.privacy
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Agent update",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "editor_dirty" });

    expect(api.updateLifeLink).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("routes agent search, open, inspect, and Find Mode through visible controller state", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await expect(controller.agentInspectCurrentLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    await expect(controller.agentSearchLifeLinks({ query: "Shelf", limit: 10 })).resolves.toMatchObject({
      ok: true,
      search: {
        query: "Shelf",
        results: [expect.objectContaining({ lifeLink: canonicalSummary })],
        totalCount: 1,
        hasMore: false,
        truncated: false,
        nextCursor: null
      }
    });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "search",
      detailsOpen: false,
      collectionSearchComplete: true,
      lifeLinkMembershipsComplete: { [canonicalLink.id]: true },
      lifeLinkSearchQuery: "Shelf",
      lifeLinkSearchResults: [expect.objectContaining({ lifeLink: canonicalSummary })]
    });

    await expect(controller.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "scan",
      detailsOpen: false,
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(route.pushes).toContain(`/life-links/${canonicalLink.id}`);
    expect(route.pushes.at(-1)).toBe("/");
    controller.dispose();
  });

  it("returns each overlapping agent search's own payload while the latest requested search owns the view", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const firstSummary = { ...canonicalSummary, id: "life-link-search-first", title: "First result" };
    const secondSummary = { ...canonicalSummary, id: "life-link-search-second", title: "Second result" };
    const firstResponse = {
      results: [{
        lifeLink: firstSummary,
        path: { items: [firstSummary], truncated: false, omittedCount: 0 },
        bodySummary: "First result body",
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    };
    const secondResponse = {
      results: [{
        lifeLink: secondSummary,
        path: { items: [secondSummary], truncated: false, omittedCount: 0 },
        bodySummary: "Second result body",
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    };
    let resolveFirst!: (value: typeof firstResponse) => void;
    let resolveSecond!: (value: typeof secondResponse) => void;
    api.searchLifeLinks.mockImplementation((query: string) => new Promise((resolve) => {
      if (query === "first") {
        resolveFirst = resolve;
      } else {
        resolveSecond = resolve;
      }
    }));

    const first = controller.agentSearchLifeLinks({ query: "first", limit: 10 });
    const second = controller.agentSearchLifeLinks({ query: "second", limit: 10 });
    await vi.waitFor(() => expect(api.searchLifeLinks).toHaveBeenCalledTimes(2));
    resolveSecond(secondResponse);
    await expect(second).resolves.toMatchObject({
      ok: true,
      search: { query: "second", results: [{ lifeLink: { id: secondSummary.id } }] }
    });
    resolveFirst(firstResponse);
    await expect(first).resolves.toMatchObject({
      ok: true,
      search: { query: "first", results: [{ lifeLink: { id: firstSummary.id } }] }
    });
    expect(controller.getSnapshot()).toMatchObject({
      lifeLinkSearchQuery: "second",
      lifeLinkSearchResults: [{ lifeLink: { id: secondSummary.id } }]
    });
    controller.dispose();
  });

  it("blocks agent inspection, search, navigation, update, and Find Mode while the canonical editor is open", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);
    api.getLifeLinkDetail.mockClear();
    api.searchLifeLinks.mockClear();

    await expect(controller.agentInspectCurrentLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentSearchLifeLinks({ query: "Shelf", limit: 10 })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Blocked",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "editor_open" });
    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    expect(api.getLifeLinkDetail).not.toHaveBeenCalled();
    expect(api.searchLifeLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      canonicalEditingId: canonicalLink.id,
      activeView: "workspace",
      findTargetId: null
    });
    controller.dispose();
  });

  it("denies agent operations on the public QR surface and honors cancellation before reads", async () => {
    const publicApi = fakeApi();
    const publicController = new LifeLinksWorkspaceController({
      api: publicApi,
      route: new FakeRoute(`/qr/${link.id}`)
    });
    await publicController.start();
    await expect(publicController.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "life_link_unavailable"
    });
    expect(publicApi.getLifeLinkDetail).not.toHaveBeenCalled();
    publicController.dispose();

    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const abortController = new AbortController();
    abortController.abort();
    await expect(controller.agentSearchLifeLinks(
      { query: "Shelf", limit: 10 },
      abortController.signal
    )).resolves.toEqual({ ok: false, code: "cancelled" });
    expect(api.searchLifeLinks).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("refuses to update if the page leaves the owner surface during source authorization", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    let releaseSourceRead!: () => void;
    const sourceRead = new Promise<void>((resolve) => {
      releaseSourceRead = resolve;
    });
    api.getLifeLinkDetail.mockClear();
    api.getLifeLinkDetail
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockImplementationOnce(async () => {
        await sourceRead;
        return { detail: canonicalDetail };
      });

    const pending = controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not be saved after leaving the owner workspace",
      sourceLifeLinkIds: [rootLifeLink.id]
    });
    await vi.waitFor(() => expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(2));
    route.pop(`/qr/${link.id}`);
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBe(link.id));
    releaseSourceRead();

    await expect(pending).resolves.toEqual({ ok: false, code: "life_link_unavailable" });
    expect(controller.getSnapshot().canonicalEditingId).toBeNull();
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("enters only a folder's direct layer, collapses Details, and opens item Details", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    const folderSelectionStates: boolean[] = [];
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().selectedLifeLinkId === rootLifeLink.id) folderSelectionStates.push(controller.getSnapshot().detailsOpen);
    });
    await controller.activateLifeLink(rootLifeLink.id);
    unsubscribe();
    expect(folderSelectionStates).not.toContain(true);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "hierarchies", hierarchyParentId: rootLifeLink.id,
      hierarchyParentDetail: { lifeLink: rootLifeLink }, selectedLifeLinkId: rootLifeLink.id, detailsOpen: false
    });
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id].items).toEqual([canonicalSummary]);
    await controller.activateLifeLink(canonicalLink.id);
    expect(controller.getSnapshot()).toMatchObject({
      hierarchyParentId: rootLifeLink.id, selectedLifeLinkId: canonicalLink.id, detailsOpen: true,
      membershipsComplete: true
    });
    await controller.openHierarchy();
    expect(route.pathname()).toBe("/life-links");
    expect(controller.getSnapshot()).toMatchObject({ hierarchyParentId: null, detailsOpen: false, selectedLifeLinkId: null });
    controller.dispose();
  });

  it("reloads exact memberships for folders and preserves labels after item-to-container promotion", async () => {
    const api = fakeApi();
    let currentSummary: LifeLinkSummary = { ...rootSummary, browsingRole: "item", childCount: 0 };
    api.listLifeLinks.mockImplementation(async () => ({ lifeLinks: [currentSummary], nextCursor: null, truncated: false }));
    const memberships = [{ collection, sections: [section] }];
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships, nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    expect(controller.getSnapshot().lifeLinkMemberships[rootLifeLink.id]).toEqual(memberships);
    api.listLifeLinkCollectionMemberships.mockClear();
    currentSummary = rootSummary;
    await controller.refreshOwnerLibrary();
    expect(api.listLifeLinkCollectionMemberships).toHaveBeenCalledWith(rootLifeLink.id, { cursor: null, limit: 25 });
    expect(controller.getSnapshot()).toMatchObject({
      rootLifeLinks: { items: [rootSummary] },
      lifeLinkMemberships: { [rootLifeLink.id]: memberships },
      lifeLinkMembershipsComplete: { [rootLifeLink.id]: true }
    });
    controller.dispose();
  });

  it("reveals Search and Scan instead of leaving mobile navigation behind open Details", async () => {
    const controller = new LifeLinksWorkspaceController({ api: fakeApi(), route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.activateLifeLink(canonicalLink.id);
    controller.setActiveView("search");
    expect(controller.getSnapshot()).toMatchObject({ activeView: "search", detailsOpen: false, selectedLifeLinkId: canonicalLink.id });
    await controller.openCollection(collection.id, canonicalLink.id);
    controller.setActiveView("scan");
    expect(controller.getSnapshot()).toMatchObject({ activeView: "scan", detailsOpen: false, selectedLifeLinkId: canonicalLink.id });
    controller.dispose();
  });

  it("exhausts Collection, Section, member and Details membership pages on a deep link", async () => {
    const api = fakeApi();
    const anotherCollection = { ...collection, id: "collection-cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Winter" };
    const anotherSection = { ...section, id: "section-dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Cycling", position: 1 };
    const anotherMember = { ...canonicalLink, id: "life-link-second", title: "Helmet" };
    api.getCollection.mockImplementation(async (_id, options = {}) => ({
      collection, sections: options.cursor ? [anotherSection] : [section],
      sectionsPage: { nextCursor: options.cursor ? null : "section-page-2", truncated: !options.cursor }
    }));
    api.listCollectionMembers.mockImplementation(async (_id, options = {}) => ({
      lifeLinks: options.cursor ? [anotherMember] : [canonicalLink],
      nextCursor: options.cursor ? null : "member-page-2", truncated: !options.cursor
    }));
    api.listLifeLinkCollectionMemberships.mockImplementation(async (_id, options = {}) => ({
      memberships: options.cursor ? [{ collection: anotherCollection, sections: [] }] : [{ collection, sections: [section, anotherSection] }],
      nextCursor: options.cursor ? null : "membership-page-2", truncated: !options.cursor
    }));
    const route = new FakeRoute(`/collections/${collection.id}?lifeLinkId=${canonicalLink.id}`);
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "collections", selectedCollection: collection, collectionSections: [section, anotherSection],
      collectionMembers: [canonicalLink, anotherMember], collectionComplete: true,
      detailsOpen: true, selectedLifeLinkId: canonicalLink.id, membershipsComplete: true,
      selectedLifeLinkMemberships: [{ collection, sections: [section, anotherSection] }, { collection: anotherCollection, sections: [] }]
    });
    expect(api.getCollection).toHaveBeenCalledWith(collection.id, { cursor: "section-page-2", limit: 25 });
    expect(api.listCollectionMembers).toHaveBeenCalledWith(collection.id, { cursor: "member-page-2", limit: 25 });
    expect(api.listLifeLinkCollectionMemberships).toHaveBeenCalledWith(canonicalLink.id, { cursor: "membership-page-2", limit: 25 });
    expect(route.pushes).toEqual([]);
    expect(api.getLifeLinkDetail.mock.calls.every(([id]) => id === canonicalLink.id)).toBe(true);
    controller.dispose();
  });

  it("opens a Collection without eager member Details and loads only requested visible locations", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    api.getLifeLinkDetail.mockClear();
    await controller.openCollection(collection.id);
    expect(controller.getSnapshot().collectionComplete).toBe(true);
    expect(api.getLifeLinkDetail).not.toHaveBeenCalled();
    await controller.loadCollectionMemberDetails([canonicalLink.id]);
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().collectionMemberDetails[canonicalLink.id]).toEqual(canonicalDetail);
    await controller.loadCollectionMemberDetails([canonicalLink.id]);
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not publish delayed Collection location reads into another owner or Collection", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start(); await controller.openCollection(collection.id);
    let resolve!: (value: { detail: LifeLinkDetail }) => void;
    api.getLifeLinkDetail.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.loadCollectionMemberDetails([canonicalLink.id]);
    await controller.logout(); resolve({ detail: canonicalDetail }); await pending;
    expect(controller.getSnapshot().collectionMemberDetails).toEqual({});
    controller.dispose();
  });

  it("restores Collection mode and selected member through browser Back without changing identity", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.openCollection(collection.id);
    await controller.selectCollectionMember(canonicalLink.id);
    const memberRoute = route.pathname();
    await controller.openHierarchy(rootLifeLink.id);
    route.pop(memberRoute);
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "collections", selectedCollection: collection, selectedLifeLinkId: canonicalLink.id, detailsOpen: true
    }));
    controller.dispose();
  });

  it("uses the exact Collection revision and complete nonexclusive Section replacement set", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id, canonicalLink.id);
    await controller.replaceCollectionSectionAssignments(canonicalLink.id, [section.id, "section-other"]);
    expect(api.replaceCollectionSectionAssignments).toHaveBeenCalledWith(collection.id, canonicalLink.id, collection.updatedAt, [section.id, "section-other"], { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", selectedLifeLinkId: canonicalLink.id });
    api.removeCollectionMember.mockRejectedValueOnce(new ApiError(409, "stale_collection", {}));
    await controller.removeCollectionMember(canonicalLink.id);
    expect(api.removeCollectionMember).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().error).toContain("Stale collection");
    expect(controller.getSnapshot().collectionMembers).toEqual([canonicalLink]);
    controller.dispose();
  });

  it("retains client creation identity after a lost response, but creates a new identity after success", async () => {
    const api = fakeApi();
    api.createCollection.mockRejectedValueOnce(new Error("Response lost"));
    const ids = vi.fn().mockReturnValueOnce("11111111-1111-4111-8111-111111111111").mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections"), commandId: ids });
    await controller.start();
    await controller.createCollection({ title: "Camping Gear" });
    await controller.createCollection({ title: "Camping Gear" });
    expect(api.createCollection.mock.calls[0][0].id).toBe(api.createCollection.mock.calls[1][0].id);
    await controller.createCollection({ title: "Camping Gear" });
    expect(api.createCollection.mock.calls[2][0].id).not.toBe(api.createCollection.mock.calls[1][0].id);
    controller.dispose();
  });

  it("refreshes Collection membership and Sections without reopening closed Details or changing the selected member", async () => {
    const api = fakeApi();
    api.listCollectionMembers.mockResolvedValue({ lifeLinks: [rootLifeLink, canonicalLink], nextCursor: null, truncated: false });
    const route = new FakeRoute("/collections");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.openCollection(collection.id, rootLifeLink.id);
    controller.setDetailsOpen(false);
    const pathname = route.pathname();
    const memberships = [{ collection, sections: [section] }];
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships, nextCursor: null, truncated: false });
    for (const targetId of [canonicalLink.id, rootLifeLink.id]) {
      await controller.replaceCollectionSectionAssignments(targetId, [section.id]);
      expect(controller.getSnapshot()).toMatchObject({
        workspaceMode: "collections", selectedLifeLinkId: rootLifeLink.id,
        detailsOpen: false, selectedLifeLinkMemberships: memberships, membershipsComplete: true
      });
      expect(route.pathname()).toBe(pathname);
    }
    await controller.updateCollectionSection(section.id, "Sleep equipment");
    expect(controller.getSnapshot().detailsOpen).toBe(false);
    controller.setDetailsOpen(true);
    await controller.addCollectionMember(canonicalLink.id);
    expect(controller.getSnapshot()).toMatchObject({ selectedLifeLinkId: rootLifeLink.id, detailsOpen: true });
    controller.dispose();
  });

  it("keeps incomplete memberships explicit and never installs delayed owner data after logout", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: true });
    await controller.openCollection(collection.id);
    expect(controller.getSnapshot()).toMatchObject({ collectionComplete: false, collectionLoading: false });
    expect(controller.getSnapshot().error).toContain("incomplete");
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [], nextCursor: null, truncated: false });
    let finish!: (value: { collection: CollectionRecord }) => void;
    api.createCollection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.createCollection({ title: "Camping" });
    await controller.logout();
    finish({ collection });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ currentUser: null, collections: [], selectedCollection: null, collectionMembers: [] });
    controller.dispose();
  });

  it("prevents a slower Collection member read from replacing the latest click", async () => {
    const api = fakeApi();
    const other = { ...canonicalLink, id: "life-link-second" };
    api.listCollectionMembers.mockResolvedValue({ lifeLinks: [canonicalLink, other], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    let finish!: (value: { detail: LifeLinkDetail }) => void;
    api.getLifeLinkDetail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = controller.selectCollectionMember(canonicalLink.id);
    api.getLifeLinkDetail.mockResolvedValueOnce({ detail: { ...canonicalDetail, lifeLink: other } });
    await controller.selectCollectionMember(other.id);
    finish({ detail: canonicalDetail });
    await first;
    expect(controller.getSnapshot().selectedLifeLinkId).toBe(other.id);
    controller.dispose();
  });

  it("routes context and public fields through one canonical PATCH and QR binding through stable commands", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id, canonicalLink.id);
    const patch = { context: { schemaVersion: 1 as const, plan: { text: "Upgrade pad", truthState: "planned" as const } }, publicFieldKeys: ["plan" as const] };
    await controller.updateSelectedLifeLink(patch);
    expect(api.updateLifeLink).toHaveBeenCalledWith(canonicalLink.id, canonicalLink.updatedAt, patch, { signal: undefined });
    expect(controller.getSnapshot().workspaceMode).toBe("collections");
    api.setLifeLinkQrBinding.mockRejectedValueOnce(new Error("Response lost"));
    await controller.setLifeLinkQrBinding(canonicalLink.id, link.url);
    await controller.setLifeLinkQrBinding(canonicalLink.id, link.id);
    expect(api.setLifeLinkQrBinding.mock.calls[0]).toEqual(api.setLifeLinkQrBinding.mock.calls[1]);
    expect(api.attachQr).not.toHaveBeenCalled();
    await controller.clearLifeLinkQrBinding(canonicalLink.id);
    expect(api.clearLifeLinkQrBinding).toHaveBeenCalledWith(canonicalLink.id, canonicalLink.updatedAt, expect.any(String), { signal: undefined });
    controller.dispose();
  });

  it("searches Collection and Section names with matching member identity through canonical endpoints", async () => {
    const api = fakeApi();
    api.listCollections.mockResolvedValue({ collections: [collection], nextCursor: null, truncated: false });
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.searchLifeLinks("sleep");
    expect(controller.getSnapshot()).toMatchObject({
      collectionSearchComplete: true, collectionSearchResults: [{ collection, sections: [section], members: [canonicalLink] }],
      lifeLinkMemberships: { [canonicalLink.id]: [{ collection, sections: [section] }] },
      lifeLinkMembershipsComplete: { [canonicalLink.id]: true }
    });
    expect(api.searchLifeLinks).toHaveBeenCalledWith("sleep", { cursor: null, limit: 25 });
    controller.dispose();
  });

  it("edits membership from hierarchy Details without navigating to the Collection", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.activateLifeLink(canonicalLink.id);
    const pathname = route.pathname();
    const editor = await controller.loadCollectionForAssignment(collection.id, canonicalLink.id);
    expect(editor).toEqual({ collection, sections: [section], membership: null });
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: false });
    await controller.addCollectionMember(canonicalLink.id, editor.collection);
    await controller.replaceCollectionSectionAssignments(canonicalLink.id, [section.id], editor.collection);
    expect(route.pathname()).toBe(pathname);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "hierarchies", hierarchyParentId: rootLifeLink.id, selectedLifeLinkId: canonicalLink.id,
      detailsOpen: true, selectedCollection: null, selectedLifeLinkMemberships: [{ collection, sections: [section] }],
      lifeLinkMemberships: { [canonicalLink.id]: [{ collection, sections: [section] }] }
    });
    controller.dispose();
  });

  it("retains the committed Collection revision when reconciliation fails", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    const changed = { ...collection, updatedAt: "2026-08-29T12:00:00.000Z", title: "Summer camping" };
    api.updateCollection.mockResolvedValue({ collection: changed });
    api.getCollection.mockRejectedValueOnce(new Error("Read unavailable"));
    await controller.updateCollection({ title: changed.title });
    expect(controller.getSnapshot()).toMatchObject({ selectedCollection: changed, collectionComplete: false, collectionLoading: false });
    expect(controller.getSnapshot().error).toBe("Read unavailable");
    controller.dispose();
  });

  it("uses the shared create and move commands for stable agent identity, hierarchy placement, and visible result", async () => {
    const api = fakeApi();
    let current = { ...canonicalLink, id: "life-link-new-kit", qrId: null };
    api.createLifeLink.mockImplementation(async () => ({ lifeLink: current }));
    const get = api.getLifeLinkDetail.getMockImplementation()!;
    api.getLifeLinkDetail.mockImplementation(async (id, options) => id === current.id ? { detail: { ...canonicalDetail, lifeLink: current } } : get(id, options));
    api.moveLifeLink.mockImplementation(async () => { current = { ...current, parentId: null, updatedAt: "2026-08-29T12:00:00.000Z" }; return { lifeLink: current }; });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { id: current.id, parentId: rootLifeLink.id, browsingRole: "item" as const, title: current.title };
    expect(await controller.agentCreateLifeLink(input)).toEqual({ ok: true });
    expect(api.createLifeLink).toHaveBeenCalledWith(input, { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ selectedLifeLinkId: current.id, workspaceMode: "hierarchies", detailsOpen: true });
    expect(await controller.agentMoveLifeLink({ lifeLinkId: current.id, parentId: null, baseUpdatedAt: canonicalLink.updatedAt })).toEqual({ ok: true });
    expect(api.moveLifeLink).toHaveBeenCalledWith(current.id, null, canonicalLink.updatedAt, { signal: undefined });
    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink.parentId).toBeNull();
    controller.dispose();
  });

  it("uses shared Collection commands, original revisions, stable Section IDs, and exact assignment sets", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { action: "create_collection" as const, id: collection.id, title: collection.title };
    expect(await controller.agentMaintainCollection(input)).toEqual({ ok: true });
    expect(api.createCollection).toHaveBeenCalledWith({ id: input.id, title: input.title, purpose: undefined, notes: undefined }, { signal: undefined });
    const newer = { ...collection, updatedAt: "2026-08-29T12:00:00.000Z" };
    api.getCollection.mockResolvedValue({ collection: newer, sections: [section], sectionsPage: { nextCursor: null, truncated: false } });
    expect(await controller.agentMaintainCollection({ action: "create_section", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, id: section.id, title: section.title })).toEqual({ ok: true });
    expect(api.createCollectionSection).toHaveBeenCalledWith(collection.id, collection.updatedAt, { id: section.id, title: section.title }, { signal: undefined });
    expect(await controller.agentMaintainCollection({ action: "replace_sections", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, lifeLinkId: canonicalLink.id, sectionIds: [section.id] })).toEqual({ ok: true });
    expect(api.replaceCollectionSectionAssignments).toHaveBeenCalledWith(collection.id, canonicalLink.id, collection.updatedAt, [section.id], { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", selectedCollection: newer, collectionComplete: true });
    api.updateCollection.mockRejectedValueOnce(new ApiError(409, "stale_collection", {}, { retryable: true }));
    expect(await controller.agentMaintainCollection({ action: "update_collection", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, title: "Changed" })).toEqual({ ok: false, code: "stale_collection" });
    controller.dispose();
  });

  it("reconciles QR changes and explicit public fields on the requested record from Collection mode", async () => {
    const api = fakeApi();
    let current = { ...canonicalLink };
    const get = api.getLifeLinkDetail.getMockImplementation()!;
    api.getLifeLinkDetail.mockImplementation(async (id, options) => id === current.id ? { detail: { ...canonicalDetail, lifeLink: current } } : get(id, options));
    api.clearLifeLinkQrBinding.mockImplementation(async () => { current = { ...current, qrId: null }; return { lifeLink: current }; });
    api.updateLifeLink.mockImplementation(async (_id, _rev, patch) => { current = { ...current, ...patch }; return { lifeLink: current }; });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    expect(await controller.agentManageLifeLinkQr({ action: "detach", lifeLinkId: current.id, commandId: "same-retry-id", baseUpdatedAt: current.updatedAt })).toEqual({ ok: true });
    expect(api.clearLifeLinkQrBinding).toHaveBeenCalledWith(current.id, current.updatedAt, "same-retry-id", { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "hierarchies", selectedLifeLinkId: current.id, selectedLifeLinkDetail: { lifeLink: { qrId: null } } });
    expect(await controller.agentManageLifeLinkQr({ action: "set_public_projection", lifeLinkId: current.id, baseUpdatedAt: current.updatedAt, privacy: "public", publicFieldKeys: ["plan"] })).toEqual({ ok: true });
    expect(api.updateLifeLink).toHaveBeenCalledWith(current.id, current.updatedAt, { privacy: "public", publicFieldKeys: ["plan"] }, { signal: undefined });
    controller.dispose();
  });

  it("cancels new tool operations before writes and refuses late owner or editor changes", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const abort = new AbortController();
    api.getLifeLinkDetail.mockImplementationOnce(async () => { abort.abort(); return { detail: canonicalDetail }; });
    expect(await controller.agentMoveLifeLink({ lifeLinkId: canonicalLink.id, parentId: null, baseUpdatedAt: canonicalLink.updatedAt }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    expect(api.moveLifeLink).not.toHaveBeenCalled();
    api.getCollection.mockImplementationOnce(async () => { await controller.logout(); return { collection, sections: [], sectionsPage: { nextCursor: null, truncated: false } }; });
    expect(await controller.agentMaintainCollection({ action: "add_member", collectionId: collection.id, lifeLinkId: canonicalLink.id, baseUpdatedAt: collection.updatedAt })).toEqual({ ok: false, code: "life_link_unavailable" });
    expect(api.addCollectionMember).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("lets canonical QR receipts resolve historical attach replay but rejects a new attach over an existing binding", async () => {
    const api = fakeApi();
    const current = { ...canonicalLink, qrId: "LL-NEWER-BINDING", updatedAt: "2026-08-29T00:00:00.000Z" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: current } });
    api.setLifeLinkQrBinding.mockResolvedValue({ lifeLink: current });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const historical = { action: "attach" as const, lifeLinkId: current.id, qrId: canonicalLink.qrId!, commandId: "original-attach", baseUpdatedAt: canonicalLink.updatedAt };
    expect(await controller.agentManageLifeLinkQr(historical)).toEqual({ ok: true });
    expect(api.setLifeLinkQrBinding).toHaveBeenCalledWith(current.id, historical.qrId, historical.baseUpdatedAt, historical.commandId, { signal: undefined });
    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink).toEqual(current);
    expect(await controller.agentManageLifeLinkQr({ ...historical, commandId: "new-attach", baseUpdatedAt: current.updatedAt })).toEqual({ ok: false, code: "invalid_operation" });
    expect(api.setLifeLinkQrBinding).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("cancels collection continuation reads without installing their delayed payload", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const abort = new AbortController();
    api.listCollections.mockImplementationOnce(async () => ({ collections: [collection], nextCursor: null, truncated: false }));
    api.listCollections.mockImplementationOnce(async () => { abort.abort(); return { collections: [collection], nextCursor: null, truncated: false }; });
    expect(await controller.agentListCollections({ limit: 10 }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    expect(controller.getSnapshot().collectionsComplete).toBe(false);
    expect(controller.getSnapshot().collections).toEqual([]);
    expect(api.listCollections.mock.calls[1][0]?.signal).toBe(abort.signal);
    controller.dispose();
  });
});

describe("Routine workspace controller contract", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const createdAt = "2026-09-01T12:00:00.000Z";
  const fixture = (suffix: number, title = "Morning reset") => {
    const uuid = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const group = createCanonicalRoutineGroup({
      id: `routine-group-${uuid}`, ownerId: owner.id, title: `Home ${suffix}`, createdAt
    });
    const activity = createCanonicalActivity({
      id: `activity-${uuid}`, ownerId: owner.id, title: `Prepare ${suffix}`, createdAt
    });
    const routine = createCanonicalRoutine({
      id: `routine-${uuid}`, revisionId: `routine-revision-${uuid}`, ownerId: owner.id,
      groupId: group.id, title, purpose: `Purpose ${suffix}`,
      steps: [{
        id: `routine-step-${uuid}`, activityId: activity.id, activityTitle: activity.title, position: 0,
        plannedValues: [{ key: "ready", label: "Ready", kind: "boolean", value: true }]
      }], createdAt
    });
    const summary = {
      ...routine.routine,
      revisionNumber: routine.currentRevision.revision.revisionNumber,
      title: routine.currentRevision.revision.title,
      purpose: routine.currentRevision.revision.purpose
    };
    const run = {
      id: `routine-run-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
      routineRevisionId: routine.currentRevision.revision.id, occurrenceId: null, status: "active" as const,
      contextSnapshot: [], stepResults: [{
        routineStepId: routine.currentRevision.steps[0].id,
        actualValues: [{ key: "ready", label: "Ready", kind: "boolean" as const, value: false }],
        proposedNextValues: [{ key: "ready", label: "Ready", kind: "boolean" as const, value: true }],
        notes: "Keep the proposed default separate."
      }], startedAt: createdAt, updatedAt: createdAt
    };
    const schedule = createCanonicalRoutineSchedule({
      id: `routine-schedule-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
      routineRevisionId: routine.currentRevision.revision.id,
      rule: { kind: "once", localDate: "2026-09-01", localTime: "08:00", timeZone: "UTC" },
      createdAt
    });
    const occurrence = {
      id: `routine-occurrence-${uuid}`, ownerId: owner.id, scheduleId: schedule.id,
      scheduleRevision: 1, routineId: routine.routine.id, routineRevisionId: routine.currentRevision.revision.id,
      localDate: "2026-09-01", plannedFor: createdAt, status: "planned" as const, createdAt, updatedAt: createdAt
    };
    const session = {
      session: {
        id: `routine-session-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
        routineRevisionId: routine.currentRevision.revision.id, runId: run.id, occurrenceId: null,
        contextSnapshot: [], startedAt: createdAt, completedAt: createdAt
      },
      stepResults: [], sessionAmendments: []
    };
    return { group, activity, routine, summary, run, schedule, occurrence, session };
  };

  it("boots and navigates the additive Routines routes without loading the Life Link library", async () => {
    const current = fixture(15, "Tuesday reset");
    const route = new FakeRoute(ownerRoutinePath(current.routine.routine.id));
    const api = fakeApi();
    api.listRoutineGroups.mockResolvedValue({ routineGroups: [current.group], nextCursor: null, truncated: false });
    api.listRoutineActivities.mockResolvedValue({ activities: [current.activity], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValue({ routines: [current.summary], nextCursor: null, truncated: false });
    api.getRoutine.mockResolvedValue({ routine: current.routine });
    api.listRoutineSchedules.mockResolvedValue({ schedules: [current.schedule], nextCursor: null, truncated: false });
    api.getActiveRoutineRun.mockResolvedValue({ run: current.run });
    api.listRoutineOccurrences.mockImplementation(async (options = {}) => ({
      occurrences: options.routineId === current.routine.routine.id ? [current.occurrence] : [],
      nextCursor: null,
      truncated: false
    }));
    api.listRoutineSessions.mockImplementation(async (options = {}) => ({
      sessions: options.routineId === current.routine.routine.id ? [current.session] : [],
      nextCursor: null,
      truncated: false
    }));
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();

    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(api.listRoutineOccurrences).toHaveBeenLastCalledWith({
      routineId: current.routine.routine.id,
      signal: undefined
    });
    expect(api.listRoutineSessions).toHaveBeenLastCalledWith({
      routineId: current.routine.routine.id,
      signal: undefined
    });
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "routines",
      activeView: "workspace",
      routePathname: ownerRoutinePath(current.routine.routine.id),
      detailsOpen: true,
      routineWorkspace: {
        selectedRoutine: current.routine,
        occurrences: [current.occurrence],
        sessions: [current.session],
        selectedSession: null
      }
    });

    await controller.openRoutines();
    expect(route.pushes).toEqual(["/routines"]);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "routines",
      routePathname: "/routines",
      detailsOpen: false,
      routineWorkspace: { selectedRoutine: null, selectedSession: null }
    });

    route.pop(ownerRoutinePath(current.routine.routine.id));
    await vi.waitFor(() => expect(controller.getSnapshot().routineWorkspace.selectedRoutine).toEqual(current.routine));
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "routines",
      routePathname: ownerRoutinePath(current.routine.routine.id),
      detailsOpen: true
    });
    expect(route.pushes).toEqual(["/routines"]);
    controller.dispose();
  });

  it("replaces occurrences and Sessions with the newly selected Routine and clears stale Session detail", async () => {
    const first = fixture(16, "First reset");
    const second = fixture(17, "Second reset");
    const api = fakeApi();
    api.getRoutine.mockImplementation(async (routineId) => ({
      routine: routineId === first.routine.routine.id ? first.routine : second.routine
    }));
    api.listRoutineSchedules.mockImplementation(async (routineId) => ({
      schedules: [routineId === first.routine.routine.id ? first.schedule : second.schedule],
      nextCursor: null,
      truncated: false
    }));
    api.getActiveRoutineRun.mockImplementation(async (routineId) => ({
      run: routineId === first.routine.routine.id ? first.run : second.run
    }));
    api.listRoutineOccurrences.mockImplementation(async ({ routineId } = {}) => ({
      occurrences: routineId === first.routine.routine.id ? [first.occurrence] : [second.occurrence],
      nextCursor: null,
      truncated: false
    }));
    api.listRoutineSessions.mockImplementation(async ({ routineId } = {}) => ({
      sessions: routineId === first.routine.routine.id ? [first.session] : [second.session],
      nextCursor: null,
      truncated: false
    }));
    api.getRoutineSession.mockResolvedValue({ session: first.session });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();

    await controller.selectRoutine(first.routine.routine.id);
    await controller.selectRoutineSession(first.session.session.id);
    expect(controller.getSnapshot().routineWorkspace.selectedSession).toEqual(first.session);

    await controller.selectRoutine(second.routine.routine.id);
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      selectedRoutine: second.routine,
      occurrences: [second.occurrence],
      sessions: [second.session],
      selectedSession: null
    });
    controller.dispose();
  });

  it("keeps paged owner History independent of focused Routine Sessions and navigation", async () => {
    const first = fixture(31, "First history"); const second = fixture(32, "Second history");
    const api = fakeApi();
    const ownerPage = deferred<{ sessions: typeof first.session[]; nextCursor: string | null; truncated: boolean }>();
    api.listRoutineSessions.mockImplementation(async (options = {}) => {
      if (options.routineId) return { sessions: [first.session], nextCursor: null, truncated: false };
      if (options.cursor) return { sessions: [second.session], nextCursor: null, truncated: false };
      return ownerPage.promise;
    });
    api.getRoutine.mockResolvedValue({ routine: first.routine });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    controller.setRoutinePresentation({ tab: "history", collapsedGroupIds: [first.group.id], showRemoved: true });
    const loading = controller.loadRoutineHistory();
    await controller.selectRoutine(first.routine.routine.id);
    ownerPage.resolve({ sessions: [first.session], nextCursor: "history-page-2", truncated: true });
    await loading;
    await controller.loadRoutineHistory({ cursor: "history-page-2" });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      sessions: [first.session],
      history: { routineId: null, sessions: [first.session, second.session], nextCursor: null, loaded: true, loading: false },
      presentation: { tab: "history", historyRoutineId: null, collapsedGroupIds: [first.group.id], showRemoved: true }
    });
    await controller.openRoutines();
    expect(api.listRoutines).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });
    expect(controller.getSnapshot().routineWorkspace.history.sessions).toEqual([first.session, second.session]);
    expect(controller.getSnapshot().routineWorkspace.presentation.tab).toBe("history");
    await controller.logout();
    expect(controller.getSnapshot().routineWorkspace.history).toMatchObject({ sessions: [], loaded: false });
    expect(controller.getSnapshot().routineWorkspace.presentation).toMatchObject({ tab: "routines", historyRoutineId: null, showRemoved: false });
    controller.dispose();
  });

  it("refuses late History pages after changing Routine scope and retains the scoped cursor", async () => {
    const first = fixture(33); const second = fixture(34);
    const api = fakeApi();
    const late = deferred<{ sessions: typeof first.session[]; nextCursor: string | null; truncated: boolean }>();
    api.listRoutineSessions.mockImplementation(async (options = {}) => options.routineId === second.routine.routine.id
      ? { sessions: [second.session], nextCursor: "scoped-page-2", truncated: true } : late.promise);
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const oldQuery = controller.loadRoutineHistory();
    controller.setRoutinePresentation({ tab: "history", historyRoutineId: second.routine.routine.id });
    await controller.loadRoutineHistory();
    late.resolve({ sessions: [first.session], nextCursor: "wrong-page", truncated: true }); await oldQuery;
    expect(controller.getSnapshot().routineWorkspace.history).toMatchObject({
      routineId: second.routine.routine.id, sessions: [second.session], nextCursor: "scoped-page-2", loaded: true
    });
    const calls = api.listRoutineSessions.mock.calls.length;
    await controller.loadRoutineHistory({ cursor: "wrong-page" });
    expect(api.listRoutineSessions).toHaveBeenCalledTimes(calls);
    await controller.loadRoutineHistory({ cursor: "scoped-page-2" });
    expect(api.listRoutineSessions).toHaveBeenLastCalledWith({ routineId: second.routine.routine.id, cursor: "scoped-page-2", signal: undefined });
    api.listRoutineSessions.mockRejectedValueOnce(new Error("History unavailable"));
    await controller.loadRoutineHistory();
    expect(controller.getSnapshot().routineWorkspace.history).toMatchObject({ sessions: [second.session], loading: false, error: "History unavailable" });
    controller.dispose();
  });

  it("publishes a Routine archive acknowledgement without overwriting a newer selected Routine", async () => {
    const first = fixture(35); const second = fixture(36);
    const api = fakeApi();
    const pending = deferred<{ routine: typeof first.routine }>();
    api.updateRoutine.mockReturnValue(pending.promise);
    api.getRoutine.mockResolvedValue({ routine: second.routine });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const archivedAt = "2026-09-02T12:00:00.000Z";
    const archive = controller.updateRoutine(first.routine.routine.id, first.routine.routine.updatedAt, { archivedAt });
    await controller.selectRoutine(second.routine.routine.id);
    pending.resolve({ routine: { ...first.routine, routine: { ...first.routine.routine, archivedAt, updatedAt: archivedAt } } });
    await archive;
    expect(controller.getSnapshot().routineWorkspace.selectedRoutine).toEqual(second.routine);
    expect(controller.getSnapshot().routineWorkspace.routines.find((entry) => entry.id === first.routine.routine.id)?.archivedAt).toBe(archivedAt);
    controller.dispose();
  });

  it("loads owner definitions/history, preserves Run result channels, and clears the nested slice on logout", async () => {
    const { group, activity, routine, summary, run } = fixture(1);
    const api = fakeApi();
    api.listRoutineGroups.mockResolvedValue({ routineGroups: [group], nextCursor: null, truncated: false });
    api.listRoutineActivities.mockResolvedValue({ activities: [activity], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValue({ routines: [summary], nextCursor: null, truncated: false });
    api.getRoutine.mockResolvedValue({ routine });
    api.startRoutineRun.mockResolvedValue({ run });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.loadRoutineWorkspace();
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [group], activities: [activity], routines: [summary], loading: false, error: ""
    });
    await controller.selectRoutine(routine.routine.id);
    await controller.startRoutineRun(routine.routine.id, { id: run.id });
    expect(controller.getSnapshot().routineWorkspace.activeRun?.stepResults[0]).toMatchObject({
      actualValues: [{ value: false }], proposedNextValues: [{ value: true }]
    });
    await controller.logout();
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [], activities: [], routines: [], activeRun: null, sessions: []
    });
    controller.dispose();
  });

  it.each(["start", "resume"] as const)(
    "does not restore a finalized Run as active when %s replays after finalization",
    async (replay) => {
      const current = fixture(replay === "start" ? 13 : 14, `${replay} replay`);
      const finalizedRun = { ...current.run, status: "finalized" as const };
      const api = fakeApi();
      api.getRoutine.mockResolvedValue({ routine: current.routine });
      api.startRoutineRun.mockResolvedValueOnce({ run: current.run });
      api.finalizeRoutineRun.mockResolvedValue({ run: finalizedRun, session: current.session });
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(current.routine.routine.id);
      await controller.startRoutineRun(current.routine.routine.id, { id: current.run.id });
      await controller.finalizeRoutineRun(current.run.id, {
        sessionId: current.session.session.id, expectedUpdatedAt: current.run.updatedAt
      });
      expect(controller.getSnapshot().routineWorkspace.activeRun).toBeNull();

      if (replay === "start") {
        api.startRoutineRun.mockResolvedValueOnce({ run: finalizedRun });
        await controller.startRoutineRun(current.routine.routine.id, { id: current.run.id });
      } else {
        api.getRoutineRun.mockResolvedValueOnce({ run: finalizedRun });
        await controller.resumeRoutineRun(current.run.id);
      }

      expect(controller.getSnapshot().routineWorkspace.activeRun).toBeNull();
      controller.dispose();
    }
  );

  it("refuses a delayed Routine mutation response after logout and account switch", async () => {
    const delayed = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["createRoutineActivity"]>>>();
    const old = fixture(2);
    const nextOwner = { ...owner, id: "owner-2", email: "owner-2@example.test" };
    const api = fakeApi();
    api.createRoutineActivity.mockImplementationOnce(() => delayed.promise);
    api.login.mockResolvedValueOnce({
      user: nextOwner, qrBaseUrl: "https://example.test", agentConnection: disconnectedAgentConnection
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const pending = controller.createRoutineActivity({ id: old.activity.id, title: old.activity.title });
    await vi.waitFor(() => expect(api.createRoutineActivity).toHaveBeenCalledOnce());
    await controller.logout();
    await controller.login(nextOwner.email, "test-password");
    delayed.resolve({ activity: old.activity });
    await pending;
    expect(controller.getSnapshot().currentUser).toEqual(nextOwner);
    expect(controller.getSnapshot().routineWorkspace.activities).toEqual([]);
    controller.dispose();
  });

  it.each(["start", "resume", "result", "finalize"] as const)(
    "does not let a delayed %s response replace a newly selected Routine or Run",
    async (operation) => {
      const first = fixture(7, "Selected first");
      const second = fixture(8, "Selected second");
      const api = fakeApi();
      api.getRoutine.mockImplementation(async (routineId) => ({
        routine: routineId === first.routine.routine.id ? first.routine : second.routine
      }));
      api.getActiveRoutineRun.mockImplementation(async (routineId) => ({
        run: routineId === first.routine.routine.id ? first.run : second.run
      }));
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(first.routine.routine.id);

      let pending: Promise<void>;
      let settle: () => void;
      if (operation === "start") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["startRoutineRun"]>>>();
        api.startRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.startRoutineRun(first.routine.routine.id, { id: first.run.id });
        settle = () => response.resolve({ run: first.run });
      } else if (operation === "resume") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineRun"]>>>();
        api.getRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.resumeRoutineRun(first.run.id);
        settle = () => response.resolve({ run: first.run });
      } else if (operation === "result") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["putRoutineRunStepResult"]>>>();
        api.putRoutineRunStepResult.mockImplementationOnce(() => response.promise);
        pending = controller.putRoutineRunStepResult(first.run.id, first.routine.currentRevision.steps[0].id, {
          expectedUpdatedAt: first.run.updatedAt,
          actualValues: first.run.stepResults[0].actualValues,
          proposedNextValues: first.run.stepResults[0].proposedNextValues
        });
        settle = () => response.resolve({ run: first.run });
      } else {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["finalizeRoutineRun"]>>>();
        api.finalizeRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.finalizeRoutineRun(first.run.id, {
          sessionId: first.session.session.id,
          expectedUpdatedAt: first.run.updatedAt
        });
        settle = () => response.resolve({ run: { ...first.run, status: "finalized" }, session: first.session });
      }
      await vi.waitFor(() => {
        const method = operation === "start" ? api.startRoutineRun : operation === "resume" ? api.getRoutineRun :
          operation === "result" ? api.putRoutineRunStepResult : api.finalizeRoutineRun;
        expect(method).toHaveBeenCalledOnce();
      });
      await controller.selectRoutine(second.routine.routine.id);
      settle();
      await pending;
      expect(controller.getSnapshot().routineWorkspace).toMatchObject({
        selectedRoutine: second.routine,
        activeRun: second.run
      });
      expect(controller.getSnapshot().routineWorkspace.selectedSession).toBeNull();
      controller.dispose();
    }
  );

  it("keeps the newest same-owner Routine workspace, selection, occurrence, and Session reads", async () => {
    const first = fixture(3, "First Routine");
    const second = fixture(4, "Second Routine");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();

    const firstRoutine = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutine"]>>>();
    const secondRoutine = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutine"]>>>();
    api.getRoutine.mockImplementation((routineId) => routineId === first.routine.routine.id ? firstRoutine.promise : secondRoutine.promise);
    api.getActiveRoutineRun.mockImplementation(async (routineId) => ({
      run: routineId === first.routine.routine.id ? first.run : second.run
    }));
    const selectingFirst = controller.selectRoutine(first.routine.routine.id);
    const selectingSecond = controller.selectRoutine(second.routine.routine.id);
    secondRoutine.resolve({ routine: second.routine });
    await selectingSecond;
    firstRoutine.resolve({ routine: first.routine });
    await selectingFirst;
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      selectedRoutine: second.routine,
      activeRun: second.run
    });

    const firstOccurrences = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutineOccurrences"]>>>();
    const secondOccurrences = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutineOccurrences"]>>>();
    api.listRoutineOccurrences.mockImplementationOnce(() => firstOccurrences.promise).mockImplementationOnce(() => secondOccurrences.promise);
    const loadingFirstOccurrences = controller.loadRoutineOccurrences({ routineId: first.routine.routine.id });
    const loadingSecondOccurrences = controller.loadRoutineOccurrences({ routineId: second.routine.routine.id });
    secondOccurrences.resolve({ occurrences: [second.occurrence], nextCursor: null, truncated: false });
    await loadingSecondOccurrences;
    firstOccurrences.resolve({ occurrences: [first.occurrence], nextCursor: null, truncated: false });
    await loadingFirstOccurrences;
    expect(controller.getSnapshot().routineWorkspace.occurrences).toEqual([second.occurrence]);

    const firstSession = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineSession"]>>>();
    const secondSession = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineSession"]>>>();
    api.getRoutineSession.mockImplementation((sessionId) => sessionId === first.session.session.id ? firstSession.promise : secondSession.promise);
    const selectingFirstSession = controller.selectRoutineSession(first.session.session.id);
    const selectingSecondSession = controller.selectRoutineSession(second.session.session.id);
    secondSession.resolve({ session: second.session });
    await selectingSecondSession;
    firstSession.resolve({ session: first.session });
    await selectingFirstSession;
    expect(controller.getSnapshot().routineWorkspace.selectedSession).toEqual(second.session);

    const firstWorkspace = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutines"]>>>();
    const secondWorkspace = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutines"]>>>();
    api.listRoutines.mockImplementationOnce(() => firstWorkspace.promise).mockImplementationOnce(() => secondWorkspace.promise);
    api.listRoutineOccurrences.mockResolvedValue({ occurrences: [], nextCursor: null, truncated: false });
    api.listRoutineSessions.mockResolvedValue({ sessions: [], nextCursor: null, truncated: false });
    const loadingFirstWorkspace = controller.loadRoutineWorkspace();
    const loadingSecondWorkspace = controller.loadRoutineWorkspace();
    secondWorkspace.resolve({ routines: [second.summary], nextCursor: null, truncated: false });
    await loadingSecondWorkspace;
    firstWorkspace.resolve({ routines: [first.summary], nextCursor: null, truncated: false });
    await loadingFirstWorkspace;
    expect(controller.getSnapshot().routineWorkspace.routines).toEqual([second.summary]);
    controller.dispose();
  });

  it("materializes and exhausts a Calendar window without replacing selected-Routine occurrences", async () => {
    const selected = fixture(20, "Selected Routine");
    const later = fixture(21, "Later Routine");
    const api = fakeApi();
    api.getRoutine.mockResolvedValue({ routine: selected.routine });
    api.listRoutineOccurrences.mockImplementation(async (options = {}) => {
      if (options.routineId) {
        return { occurrences: [selected.occurrence], nextCursor: null, truncated: false };
      }
      if (options.cursor === "calendar-next") {
        return { occurrences: [later.occurrence], nextCursor: null, truncated: false };
      }
      return { occurrences: [selected.occurrence], nextCursor: "calendar-next", truncated: true };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.selectRoutine(selected.routine.routine.id);

    await controller.loadRoutineCalendarWindow({ startDate: "2026-09-01", endDate: "2026-09-30" });

    expect(api.materializeRoutineOccurrences).toHaveBeenCalledWith({
      startDate: "2026-09-01", endDate: "2026-09-30"
    });
    expect(api.listRoutineOccurrences).toHaveBeenNthCalledWith(2, {
      startDate: "2026-09-01", endDate: "2026-09-30", limit: 100, signal: undefined
    });
    expect(api.listRoutineOccurrences).toHaveBeenNthCalledWith(3, {
      startDate: "2026-09-01", endDate: "2026-09-30", limit: 100,
      cursor: "calendar-next", signal: undefined
    });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      selectedRoutine: selected.routine,
      occurrences: [selected.occurrence],
      calendarOccurrences: [selected.occurrence, later.occurrence],
      calendarRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
      calendarLoading: false,
      calendarError: ""
    });
    controller.dispose();
  });

  it("keeps the newest Calendar window when an older materialization resolves later", async () => {
    const older = fixture(22, "Older window");
    const newer = fixture(23, "Newer window");
    const api = fakeApi();
    const olderMaterialization = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["materializeRoutineOccurrences"]>>>();
    api.materializeRoutineOccurrences.mockImplementation(async (options) => {
      if (options.startDate === "2026-08-01") return olderMaterialization.promise;
      return { ...options, routineCount: 1, occurrenceCount: 1 };
    });
    api.listRoutineOccurrences.mockImplementation(async (options = {}) => ({
      occurrences: options.startDate === "2026-09-01" ? [newer.occurrence] : [older.occurrence],
      nextCursor: null,
      truncated: false
    }));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();

    const loadingOlder = controller.loadRoutineCalendarWindow({ startDate: "2026-08-01", endDate: "2026-08-31" });
    const loadingNewer = controller.loadRoutineCalendarWindow({ startDate: "2026-09-01", endDate: "2026-09-30" });
    await loadingNewer;
    olderMaterialization.resolve({
      startDate: "2026-08-01", endDate: "2026-08-31", routineCount: 1, occurrenceCount: 1
    });
    await loadingOlder;

    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      calendarOccurrences: [newer.occurrence],
      calendarRange: { startDate: "2026-09-01", endDate: "2026-09-30" },
      calendarLoading: false,
      calendarError: ""
    });
    expect(api.listRoutineOccurrences).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("reloads archived definitions and consumes every Routine cursor without replacing earlier pages", async () => {
    const first = fixture(5, "First page");
    const second = fixture(6, "Second page");
    const api = fakeApi();
    api.listRoutineGroups.mockResolvedValueOnce({ routineGroups: [first.group], nextCursor: "groups-next", truncated: true });
    api.listRoutineActivities.mockResolvedValueOnce({ activities: [first.activity], nextCursor: "activities-next", truncated: true });
    api.listRoutines.mockResolvedValueOnce({ routines: [first.summary], nextCursor: "routines-next", truncated: true });
    api.listRoutineOccurrences.mockResolvedValueOnce({ occurrences: [first.occurrence], nextCursor: "occurrences-next", truncated: true });
    api.listRoutineSessions.mockResolvedValueOnce({ sessions: [first.session], nextCursor: "sessions-next", truncated: true });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.loadRoutineWorkspace({ includeArchived: true });
    expect(api.listRoutineGroups).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });
    expect(api.listRoutineActivities).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });
    expect(api.listRoutines).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });

    api.listRoutineGroups.mockResolvedValueOnce({ routineGroups: [second.group], nextCursor: null, truncated: false });
    api.listRoutineActivities.mockResolvedValueOnce({ activities: [second.activity], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValueOnce({ routines: [second.summary], nextCursor: null, truncated: false });
    await Promise.all([
      controller.loadMoreRoutineGroups(), controller.loadMoreRoutineActivities(), controller.loadMoreRoutines()
    ]);
    expect(api.listRoutineGroups).toHaveBeenLastCalledWith({ cursor: "groups-next", includeArchived: true, signal: undefined });
    expect(api.listRoutineActivities).toHaveBeenLastCalledWith({ cursor: "activities-next", includeArchived: true, signal: undefined });
    expect(api.listRoutines).toHaveBeenLastCalledWith({ cursor: "routines-next", includeArchived: true, signal: undefined });

    api.listRoutineOccurrences.mockResolvedValueOnce({ occurrences: [second.occurrence], nextCursor: null, truncated: false });
    api.listRoutineSessions.mockResolvedValueOnce({ sessions: [second.session], nextCursor: null, truncated: false });
    await controller.loadRoutineOccurrences({ cursor: "occurrences-next" });
    await controller.loadRoutineSessions({ cursor: "sessions-next" });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [first.group, second.group],
      activities: [first.activity, second.activity],
      routines: [first.summary, second.summary],
      occurrences: [first.occurrence, second.occurrence],
      sessions: [first.session, second.session],
      includeArchived: true
    });
    controller.dispose();
  });

  it.each(["activity", "routine"] as const)(
    "reloads selected planning state after archiving a Routine %s",
    async (target) => {
      const current = fixture(target === "activity" ? 9 : 10, `Archive ${target}`);
      const inactiveSchedule = {
        ...current.schedule, active: false, revision: current.schedule.revision + 1,
        updatedAt: "2026-09-01T12:01:00.000Z"
      };
      const canceledOccurrence = {
        ...current.occurrence, status: "canceled" as const, updatedAt: "2026-09-01T12:01:00.000Z"
      };
      const api = fakeApi();
      api.getRoutine.mockResolvedValue({ routine: current.routine });
      api.listRoutineSchedules
        .mockResolvedValueOnce({ schedules: [current.schedule], nextCursor: null, truncated: false })
        .mockResolvedValueOnce({ schedules: [inactiveSchedule], nextCursor: null, truncated: false });
      api.listRoutineOccurrences
        .mockResolvedValueOnce({ occurrences: [current.occurrence], nextCursor: null, truncated: false })
        .mockResolvedValueOnce({ occurrences: [canceledOccurrence], nextCursor: null, truncated: false });
      api.updateRoutineActivity.mockResolvedValue({
        activity: { ...current.activity, archivedAt: "2026-09-01T12:01:00.000Z", updatedAt: "2026-09-01T12:01:00.000Z" }
      });
      api.updateRoutine.mockResolvedValue({
        routine: {
          ...current.routine,
          routine: {
            ...current.routine.routine, archivedAt: "2026-09-01T12:01:00.000Z",
            updatedAt: "2026-09-01T12:01:00.000Z"
          }
        }
      });
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(current.routine.routine.id);

      if (target === "activity") {
        await controller.updateRoutineActivity(current.activity.id, current.activity.updatedAt, {
          archivedAt: "2026-09-01T12:01:00.000Z"
        });
      } else {
        await controller.updateRoutine(current.routine.routine.id, current.routine.routine.updatedAt, {
          archivedAt: "2026-09-01T12:01:00.000Z"
        });
      }

      expect(controller.getSnapshot().routineWorkspace).toMatchObject({
        schedules: [inactiveSchedule], occurrences: [canceledOccurrence]
      });
      expect(api.listRoutineSchedules).toHaveBeenCalledTimes(2);
      expect(api.listRoutineOccurrences).toHaveBeenCalledTimes(2);
      controller.dispose();
    }
  );

  it("replaces selected occurrences after schedule creation and reconciliation", async () => {
    const current = fixture(11, "Schedule reconciliation");
    const createdOccurrence = {
      ...current.occurrence,
      id: current.occurrence.id.replace(/11$/, "12"),
      localDate: "2026-09-02",
      plannedFor: "2026-09-02T08:00:00.000Z"
    };
    const reconciledOccurrence = {
      ...createdOccurrence, status: "canceled" as const, updatedAt: "2026-09-01T12:02:00.000Z"
    };
    const revisedSchedule = {
      ...current.schedule, active: false, revision: 2, updatedAt: "2026-09-01T12:02:00.000Z"
    };
    const api = fakeApi();
    api.getRoutine.mockResolvedValue({ routine: current.routine });
    api.listRoutineSchedules.mockResolvedValue({ schedules: [], nextCursor: null, truncated: false });
    api.listRoutineOccurrences
      .mockResolvedValueOnce({ occurrences: [current.occurrence], nextCursor: "stale-next", truncated: true })
      .mockResolvedValueOnce({ occurrences: [createdOccurrence], nextCursor: null, truncated: false })
      .mockResolvedValueOnce({ occurrences: [reconciledOccurrence], nextCursor: null, truncated: false });
    api.createRoutineSchedule.mockResolvedValue({ schedule: current.schedule });
    api.updateRoutineSchedule.mockResolvedValue({ schedule: revisedSchedule });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.selectRoutine(current.routine.routine.id);

    await controller.createRoutineSchedule(current.routine.routine.id, {
      id: current.schedule.id, rule: current.schedule.rule
    });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      schedules: [current.schedule], occurrences: [createdOccurrence], occurrencesNextCursor: null
    });

    await controller.updateRoutineSchedule(current.schedule.id, current.schedule.updatedAt, { active: false });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      schedules: [revisedSchedule], occurrences: [reconciledOccurrence], occurrencesNextCursor: null
    });
    expect(api.listRoutineOccurrences).toHaveBeenCalledTimes(3);
    controller.dispose();
  });

  it("shares exact Routine removal and partial retry across the owner and nonblocking agent flow", async () => {
    const first = fixture(81, "Upper body"); const second = fixture(82, "Lower body");
    const api = fakeApi();
    api.getMe.mockResolvedValue({ user: owner, qrBaseUrl: "https://example.test", agentConnection: { ...connectedAgentConnection, toolCatalogId: "life-links-workspace-v3" } });
    api.getRoutine.mockImplementation(async (id) => ({ routine: id === first.routine.routine.id ? first.routine : second.routine }));
    let failSecond = true;
    api.updateRoutine.mockImplementation(async (id, _revision, patch) => {
      if (id === second.routine.routine.id && failSecond) { failSecond = false; throw new Error("response lost"); }
      const source = id === first.routine.routine.id ? first.routine : second.routine;
      return { routine: { ...source, routine: { ...source.routine, archivedAt: patch.archivedAt!, updatedAt: patch.archivedAt! } } };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") }); await controller.start();
    const prepared = await controller.agentPreviewRoutineDeletion({ routines: [first, second].map((item) => ({ id: item.routine.routine.id, expectedUpdatedAt: item.routine.routine.updatedAt })) });
    expect(prepared.ok).toBe(true); if (!prepared.ok) throw new Error("preview missing");
    expect(prepared.preview.routines.map((item) => item.title)).toEqual(["Upper body", "Lower body"]);
    expect(await controller.agentApplyRoutineDeletion(prepared.preview.id)).toMatchObject({ ok: true, status: { state: "awaiting_confirmation" } });
    expect(api.updateRoutine).not.toHaveBeenCalled();
    await controller.confirmAgentWorkspaceChange(true);
    expect(await controller.agentApplyRoutineDeletion(prepared.preview.id)).toMatchObject({ ok: true, status: { state: "partial", removal: { removedIds: [first.routine.routine.id], remainingIds: [second.routine.routine.id] } } });
    await controller.confirmAgentWorkspaceChange(true);
    expect(await controller.agentApplyRoutineDeletion(prepared.preview.id)).toMatchObject({ ok: true, status: { state: "applied", removal: { removedIds: [first.routine.routine.id, second.routine.routine.id], remainingIds: [] } } });
    expect(api.updateRoutine).toHaveBeenCalledTimes(3);
    expect(api.updateRoutine.mock.calls.map((call) => call[0])).toEqual([first.routine.routine.id, second.routine.routine.id, second.routine.routine.id]);
    for (const call of api.updateRoutine.mock.calls) expect(call.slice(1)).toEqual([createdAt, { archivedAt: prepared.preview.archivedAt }, expect.any(AbortSignal), "agent"]);
    expect(api.finalizeRoutineRun).not.toHaveBeenCalled();
    expect(api.updateRoutineSchedule).not.toHaveBeenCalled(); controller.dispose();
  });

  it("never prepares a stale Routine revision or publishes a delayed preview after disconnect", async () => {
    const current = fixture(83);
    const api = fakeApi();
    api.getMe.mockResolvedValue({ user: owner, qrBaseUrl: "https://example.test", agentConnection: { ...connectedAgentConnection, toolCatalogId: "life-links-workspace-v3" } });
    api.getRoutine.mockResolvedValue({ routine: current.routine });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") }); await controller.start();
    expect(await controller.agentPreviewRoutineDeletion({ routines: [{ id: current.routine.routine.id, expectedUpdatedAt: "2025-01-01T00:00:00Z" }] })).toEqual({ ok: false, code: "stale_routine" });
    const response = deferred<{ routine: typeof current.routine }>();
    api.getRoutine.mockReturnValueOnce(response.promise);
    const request = controller.agentPreviewRoutineDeletion({ routines: [{ id: current.routine.routine.id, expectedUpdatedAt: createdAt }] });
    await controller.disconnectAgent(); response.resolve({ routine: current.routine });
    expect(await request).toMatchObject({ ok: false });
    expect(controller.getSnapshot().agentWorkspaceChangeConfirmation).toBeNull();
    expect(api.updateRoutine).not.toHaveBeenCalled(); controller.dispose();
  });

  it("preserves acknowledged owner removals if a later request is canceled", async () => {
    const first = fixture(84); const second = fixture(85); const api = fakeApi();
    const abort = new AbortController();
    api.updateRoutine.mockImplementation(async (id, _revision, patch) => {
      const source = id === first.routine.routine.id ? first.routine : second.routine;
      if (id === second.routine.routine.id) abort.abort();
      return { routine: { ...source, routine: { ...source.routine, archivedAt: patch.archivedAt!, updatedAt: patch.archivedAt! } } };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") }); await controller.start();
    const preview = controller.prepareRoutineDeletion([first, second].map((item) => ({ id: item.routine.routine.id, title: item.summary.title, expectedUpdatedAt: createdAt })));
    expect(await controller.applyRoutineDeletion(preview, [], abort.signal)).toMatchObject({ removedIds: [first.routine.routine.id], remainingIds: [second.routine.routine.id], error: expect.stringContaining("may have committed") });
    controller.dispose();
  });
});

describe("workspace-v3 Collection change admission", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const grant: ApiAgentConnection = { ...connectedAgentConnection, toolCatalogId: "life-links-workspace-v3" };
  const preview: CollectionChangePreview = {
    domain: "collections", id: "collection-preview-exact", createdAt: collection.createdAt,
    input: { operation: "delete", scope: "collections", collections: [{ collectionId: collection.id, expectedUpdatedAt: collection.updatedAt }] },
    collections: [collection], sections: [], members: [], targetCollection: null, targetSection: null,
    sideEffects: { collectionsRemoved: 1, sectionsRemoved: 0, sectionsMoved: 0, membershipsRemoved: 0, membershipsAdded: 0, assignmentsRemoved: 0, assignmentsAdded: 0, lifeLinksDeleted: 0 }
  };
  async function setup() {
    const api = fakeApi();
    api.getMe.mockResolvedValue({ user: owner, qrBaseUrl: "https://example.test", agentConnection: grant });
    api.previewCollectionChange.mockResolvedValue(structuredClone(preview));
    api.applyCollectionChange.mockResolvedValue({ operation: "delete", collectionIds: [collection.id], lifeLinkIds: [], history: { limit: 5, entries: [] } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    return { api, controller };
  }

  it("returns pending immediately, writes only after the app click and replays the same completion", async () => {
    const { api, controller } = await setup();
    expect(await controller.agentPreviewCollectionChange(preview.input)).toMatchObject({ ok: true, preview });
    expect(api.previewCollectionChange).toHaveBeenCalledWith(preview.input, undefined, "agent");
    expect(await controller.agentApplyCollectionChange(preview.id)).toMatchObject({ ok: true, status: { state: "awaiting_confirmation" } });
    expect(api.applyCollectionChange).not.toHaveBeenCalled();
    await controller.confirmAgentWorkspaceChange(true);
    expect(api.applyCollectionChange).toHaveBeenCalledOnce();
    expect(api.applyCollectionChange.mock.calls[0]).toEqual([preview.id, expect.any(String), expect.any(AbortSignal), "agent"]);
    expect(await controller.agentApplyCollectionChange(preview.id)).toMatchObject({ ok: true, status: { state: "applied", change: { collectionIds: [collection.id] } } });
    expect(api.applyCollectionChange).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().agentWorkspaceChangeConfirmation).toBeNull();
    controller.dispose();
  });

  it("cancels without mutation and cannot resurrect a canceled preview", async () => {
    const { api, controller } = await setup();
    await controller.agentPreviewCollectionChange(preview.input); await controller.agentApplyCollectionChange(preview.id);
    await controller.confirmAgentWorkspaceChange(false);
    expect(await controller.agentApplyCollectionChange(preview.id)).toMatchObject({ ok: true, status: { state: "cancelled" } });
    expect(api.applyCollectionChange).not.toHaveBeenCalled(); controller.dispose();
  });

  it("checks a remote downgrade before confirmation dispatch or cached result disclosure", async () => {
    const { api, controller } = await setup();
    await controller.agentPreviewCollectionChange(preview.input); await controller.agentApplyCollectionChange(preview.id);
    api.getMe.mockResolvedValue({ user: owner, qrBaseUrl: "https://example.test", agentConnection: connectedAgentConnection });
    await controller.confirmAgentWorkspaceChange(true);
    expect(api.applyCollectionChange).not.toHaveBeenCalled();
    expect(await controller.agentApplyCollectionChange(preview.id)).toMatchObject({ ok: false });
    expect(controller.getSnapshot().agentWorkspaceChangeConfirmation).toBeNull(); controller.dispose();
  });

  it("discards outstanding authority on disconnect and rejects v2 discovery", async () => {
    const { api, controller } = await setup();
    await controller.agentPreviewCollectionChange(preview.input); await controller.agentApplyCollectionChange(preview.id);
    await controller.disconnectAgent(); await controller.confirmAgentWorkspaceChange(true);
    expect(api.applyCollectionChange).not.toHaveBeenCalled();
    expect(await controller.agentListRoutines({})).toMatchObject({ ok: false });
    expect(api.listRoutines).not.toHaveBeenCalled(); controller.dispose();
  });

  it("executes a move without deletion confirmation and retains the original command after an uncertain response", async () => {
    const { api, controller } = await setup();
    const move: CollectionChangePreview = { ...preview, input: { operation: "move", scope: "contents", source: { collectionId: collection.id, expectedUpdatedAt: collection.updatedAt }, sectionIds: [], members: [{ lifeLinkId: canonicalLink.id, sourceSectionId: section.id }], target: { collectionId: collection.id, expectedUpdatedAt: collection.updatedAt, sectionId: null } } };
    api.previewCollectionChange.mockResolvedValue(move);
    api.applyCollectionChange.mockRejectedValueOnce(new Error("response lost"));
    await controller.agentPreviewCollectionChange(move.input);
    expect(await controller.agentApplyCollectionChange(move.id)).toMatchObject({ ok: true, status: { state: "applying" } });
    await vi.waitFor(() => expect(api.applyCollectionChange).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.agentApplyCollectionChange(move.id);
    await vi.waitFor(() => expect(api.applyCollectionChange).toHaveBeenCalledTimes(2));
    expect(api.applyCollectionChange.mock.calls[0][1]).toBe(api.applyCollectionChange.mock.calls[1][1]);
    expect(controller.getSnapshot().agentWorkspaceChangeConfirmation).toBeNull(); controller.dispose();
  });
});

describe("owner-session peer navigation and panel presentation", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("resumes a hierarchy subject with fresh data and pane/scroll preferences while root breadcrumbs stay explicit", async () => {
    const api = fakeApi(); const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route }); await controller.start();
    await controller.activateLifeLink(canonicalLink.id);
    controller.setMiddleCollapsed(true);
    controller.setWorkspaceScroll("details", 218);
    await controller.openCollections();
    const read = api.getLifeLinkDetail.getMockImplementation()!;
    api.getLifeLinkDetail.mockImplementation(async (id, options) => id === canonicalLink.id
      ? { detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, title: "Fresh server title" } } }
      : read(id, options));
    await controller.resumeWorkspace("hierarchies");
    expect(route.pathname()).toBe(`/life-links/${canonicalLink.id}`);
    expect(controller.getSnapshot()).toMatchObject({
      selectedLifeLinkDetail: { lifeLink: { title: "Fresh server title" } }, middleCollapsed: true, detailsOpen: true,
      presentation: { peers: { hierarchies: { detailsScrollTop: 218 } } }
    });
    await controller.openHierarchy();
    await controller.openCollections(); await controller.resumeWorkspace("hierarchies");
    expect(route.pathname()).toBe("/life-links");
    expect(controller.getSnapshot().selectedLifeLinkId).toBeNull();
    controller.dispose();
  });

  it("retains each Collection view and namespaced expansion while re-reading its selected member", async () => {
    const api = fakeApi(); const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start(); await controller.openCollection(collection.id, canonicalLink.id);
    controller.setCollectionPresentation(collection.id, { view: "locations", expandedGroups: ["section:same", "location:same"] });
    controller.setWorkspaceScroll("middle", 172);
    await controller.openHierarchy(); api.getCollection.mockClear(); await controller.resumeWorkspace("collections");
    expect(api.getCollection).toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ selectedCollection: { id: collection.id }, selectedLifeLinkId: canonicalLink.id,
      presentation: { collections: { [collection.id]: { view: "locations", expandedGroups: ["section:same", "location:same"] } },
        peers: { collections: { middleScrollTop: 172 } } }
    });
    controller.dispose();
  });

  it("remembers Calendar view/date and hidden native calendars but re-reads access rather than restoring it", async () => {
    const api = fakeApi(); api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start(); await controller.openCalendarEvent(nativeCalendarEvent.event.id);
    controller.setCalendarPresentation({ view: "week", timeZone: "America/New_York", anchorDate: "2026-10-15", selectedDate: "2026-10-16", hiddenNativeCalendarIds: [nativeCalendar.id] });
    await controller.openCollections();
    api.listCalendars.mockResolvedValue({ calendars: [{ ...nativeCalendar, agentAccess: "none" }], nextCursor: null, truncated: false });
    await controller.resumeWorkspace("calendar");
    expect(controller.getSnapshot().presentation.calendar).toMatchObject({ view: "week", anchorDate: "2026-10-15", selectedDate: "2026-10-16", hiddenNativeCalendarIds: [nativeCalendar.id] });
    expect(controller.getSnapshot().calendarWorkspace.calendars[0].agentAccess).toBe("none");
    expect(api.getCalendarEvent).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().agentConnection.connected).toBe(false);
    controller.dispose();
  });

  it("never publishes both content panes collapsed, including navigation and mobile-back behavior", async () => {
    const api = fakeApi(); const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    const published: Array<{ middleCollapsed: boolean; detailsOpen: boolean }> = [];
    controller.subscribe(() => published.push(controller.getSnapshot()));
    await controller.start();
    controller.setMiddleCollapsed(true);
    expect(controller.getSnapshot()).toMatchObject({ middleCollapsed: true, detailsOpen: true });
    controller.setDetailsOpen(false);
    expect(controller.getSnapshot()).toMatchObject({ middleCollapsed: false, detailsOpen: false });
    controller.setMiddleCollapsed(true); await controller.openHierarchy();
    expect(published.every((state) => !state.middleCollapsed || state.detailsOpen)).toBe(true);
    controller.dispose();
  });

  it("clears private presentation on logout and ignores a late resume read", async () => {
    const api = fakeApi(); api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    api.getCalendarEvent.mockResolvedValue({ calendarEvent: nativeCalendarEvent, latestTombstone: null });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/calendar") });
    await controller.start(); await controller.openCalendarEvent(nativeCalendarEvent.event.id);
    controller.setCalendarPresentation({ view: "agenda", anchorDate: "2028-01-01" });
    controller.setCollectionPresentation(collection.id, { view: "all" });
    await controller.openCollections();
    let finish!: (value: { calendarEvent: CalendarEventDetail; latestTombstone: null }) => void;
    api.getCalendarEvent.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = controller.resumeWorkspace("calendar");
    await controller.logout();
    finish({ calendarEvent: nativeCalendarEvent, latestTombstone: null }); await pending;
    expect(controller.getSnapshot()).toMatchObject({ currentUser: null, calendarWorkspace: { selectedEvent: null },
      presentation: { collections: {}, calendar: { view: "month", anchorDate: null }, peers: { calendar: { pathname: null } } } });
    const calls = api.getCalendarEvent.mock.calls.length;
    await controller.resumeWorkspace("calendar");
    expect(api.getCalendarEvent).toHaveBeenCalledTimes(calls);
    controller.dispose();
  });

  it("does not turn OAuth drafts or a public QR into remembered private navigation", async () => {
    const api = fakeApi(); api.listCalendars.mockResolvedValue({ calendars: [nativeCalendar], nextCursor: null, truncated: false });
    const route = new FakeRoute("/calendar?calendarAuthorization=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const controller = new LifeLinksWorkspaceController({ api, route }); await controller.start();
    expect(controller.getSnapshot().presentation.peers.calendar.pathname).toBe("/calendar");
    route.pop(`/qr/${link.id}`); await new Promise((resolve) => setTimeout(resolve, 0));
    const previous = controller.getSnapshot().routePathname;
    await controller.resumeWorkspace("calendar");
    expect(controller.getSnapshot().routePathname).toBe(previous);
    controller.dispose();
  });
});

class FakeRoute implements WorkspaceBrowserRoute {
  private listeners = new Set<() => void>();
  readonly pushes: string[] = [];

  constructor(private currentPathname: string) {}

  pathname() {
    return this.currentPathname;
  }

  push(pathname: string) {
    this.currentPathname = pathname;
    this.pushes.push(pathname);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pop(pathname: string) {
    this.currentPathname = pathname;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function fakeApi() {
  return {
    authorizeMicrosoftCalendar: vi.fn<LifeLinksWorkspaceApi["authorizeMicrosoftCalendar"]>(),
    authorizeGoogleCalendar: vi.fn<LifeLinksWorkspaceApi["authorizeGoogleCalendar"]>(),
    getCalendarAuthorization: vi.fn<LifeLinksWorkspaceApi["getCalendarAuthorization"]>(),
    completeCalendarAuthorization: vi.fn<LifeLinksWorkspaceApi["completeCalendarAuthorization"]>(),
    cancelCalendarAuthorization: vi.fn<LifeLinksWorkspaceApi["cancelCalendarAuthorization"]>(async () => undefined),
    discoverConnectedCalendars: vi.fn<LifeLinksWorkspaceApi["discoverConnectedCalendars"]>(),
    selectConnectedCalendars: vi.fn<LifeLinksWorkspaceApi["selectConnectedCalendars"]>(),
    refreshCalendarConnection: vi.fn<LifeLinksWorkspaceApi["refreshCalendarConnection"]>(async () => ({ refreshed: true })),
    listProviderCalendarEvents: vi.fn<LifeLinksWorkspaceApi["listProviderCalendarEvents"]>(async () => ({ providerEvents: [], nextCursor: null, truncated: false })),
    getProviderCalendarEvent: vi.fn<LifeLinksWorkspaceApi["getProviderCalendarEvent"]>(),
    createProviderCalendarEvent: vi.fn<LifeLinksWorkspaceApi["createProviderCalendarEvent"]>(),
    updateProviderCalendarEvent: vi.fn<LifeLinksWorkspaceApi["updateProviderCalendarEvent"]>(),
    deleteProviderCalendarEvent: vi.fn<LifeLinksWorkspaceApi["deleteProviderCalendarEvent"]>(),
    listCalendarProviders: vi.fn<LifeLinksWorkspaceApi["listCalendarProviders"]>(async () => ({ providers: [] })),
    listCalendarConnections: vi.fn<LifeLinksWorkspaceApi["listCalendarConnections"]>(async () => ({ connections: [] })),
    listConnectedCalendars: vi.fn<LifeLinksWorkspaceApi["listConnectedCalendars"]>(async () => ({ calendars: [] })),
    updateConnectedCalendar: vi.fn<LifeLinksWorkspaceApi["updateConnectedCalendar"]>(),
    disconnectCalendarConnection: vi.fn<LifeLinksWorkspaceApi["disconnectCalendarConnection"]>(),
    getLifeLinkAttachmentContent: vi.fn<LifeLinksWorkspaceApi["getLifeLinkAttachmentContent"]>(),
    getLifeLinkAttachmentImage: vi.fn<LifeLinksWorkspaceApi["getLifeLinkAttachmentImage"]>(),
    getChangeHistory: vi.fn<LifeLinksWorkspaceApi["getChangeHistory"]>(async () => ({ limit: 5, entries: [] })),
    previewLifeLinkChange: vi.fn<LifeLinksWorkspaceApi["previewLifeLinkChange"]>(),
    previewCollectionChange: vi.fn<LifeLinksWorkspaceApi["previewCollectionChange"]>(),
    applyCollectionChange: vi.fn<LifeLinksWorkspaceApi["applyCollectionChange"]>(),
    getLifeLinkChangePreview: vi.fn<LifeLinksWorkspaceApi["getLifeLinkChangePreview"]>(),
    applyLifeLinkChange: vi.fn<LifeLinksWorkspaceApi["applyLifeLinkChange"]>(),
    undoChange: vi.fn<LifeLinksWorkspaceApi["undoChange"]>(),
    createCalendar: vi.fn<LifeLinksWorkspaceApi["createCalendar"]>(),
    createCalendarEvent: vi.fn<LifeLinksWorkspaceApi["createCalendarEvent"]>(),
    deleteCalendar: vi.fn<LifeLinksWorkspaceApi["deleteCalendar"]>(),
    deleteCalendarEvent: vi.fn<LifeLinksWorkspaceApi["deleteCalendarEvent"]>(),
    getCalendarEvent: vi.fn<LifeLinksWorkspaceApi["getCalendarEvent"]>(),
    getCalendar: vi.fn<LifeLinksWorkspaceApi["getCalendar"]>(async () => ({ calendar: nativeCalendar })),
    getCalendarClock: vi.fn<LifeLinksWorkspaceApi["getCalendarClock"]>(async (timeZone) => ({
      serverTime: "2026-09-01T16:00:00.000Z", timeZone, today: "2026-09-01"
    })),
    listCalendars: vi.fn<LifeLinksWorkspaceApi["listCalendars"]>(async () => ({ calendars: [], nextCursor: null, truncated: false })),
    listCalendarEvents: vi.fn<LifeLinksWorkspaceApi["listCalendarEvents"]>(async () => ({ calendarEvents: [], nextCursor: null, truncated: false })),
    restoreCalendar: vi.fn<LifeLinksWorkspaceApi["restoreCalendar"]>(),
    restoreCalendarEvent: vi.fn<LifeLinksWorkspaceApi["restoreCalendarEvent"]>(),
    updateCalendar: vi.fn<LifeLinksWorkspaceApi["updateCalendar"]>(),
    updateCalendarEvent: vi.fn<LifeLinksWorkspaceApi["updateCalendarEvent"]>(),
    listCollections: vi.fn<LifeLinksWorkspaceApi["listCollections"]>(async () => ({ collections: [], nextCursor: null, truncated: false })),
    getCollection: vi.fn<LifeLinksWorkspaceApi["getCollection"]>(async () => ({ collection, sections: [section], sectionsPage: { nextCursor: null, truncated: false } })),
    createCollection: vi.fn<LifeLinksWorkspaceApi["createCollection"]>(async () => ({ collection })),
    updateCollection: vi.fn<LifeLinksWorkspaceApi["updateCollection"]>(async () => ({ collection })),
    listCollectionMembers: vi.fn<LifeLinksWorkspaceApi["listCollectionMembers"]>(async () => ({ lifeLinks: [canonicalLink], nextCursor: null, truncated: false })),
    listLifeLinkCollectionMemberships: vi.fn<LifeLinksWorkspaceApi["listLifeLinkCollectionMemberships"]>(async () => ({ memberships: [], nextCursor: null, truncated: false })),
    addCollectionMember: vi.fn<LifeLinksWorkspaceApi["addCollectionMember"]>(async () => ({ collection })),
    removeCollectionMember: vi.fn<LifeLinksWorkspaceApi["removeCollectionMember"]>(async () => ({ collection })),
    createCollectionSection: vi.fn<LifeLinksWorkspaceApi["createCollectionSection"]>(async () => ({ collection, section })),
    updateCollectionSection: vi.fn<LifeLinksWorkspaceApi["updateCollectionSection"]>(async () => ({ collection, section })),
    removeCollectionSection: vi.fn<LifeLinksWorkspaceApi["removeCollectionSection"]>(async () => ({ collection })),
    replaceCollectionSectionAssignments: vi.fn<LifeLinksWorkspaceApi["replaceCollectionSectionAssignments"]>(async () => ({ collection })),
    setLifeLinkQrBinding: vi.fn<LifeLinksWorkspaceApi["setLifeLinkQrBinding"]>(async () => ({ lifeLink: canonicalLink })),
    clearLifeLinkQrBinding: vi.fn<LifeLinksWorkspaceApi["clearLifeLinkQrBinding"]>(async () => ({ lifeLink: { ...canonicalLink, qrId: null } })),
    appendRoutineSessionAmendment: vi.fn<LifeLinksWorkspaceApi["appendRoutineSessionAmendment"]>(),
    createRoutine: vi.fn<LifeLinksWorkspaceApi["createRoutine"]>(),
    createRoutineActivity: vi.fn<LifeLinksWorkspaceApi["createRoutineActivity"]>(),
    createRoutineGroup: vi.fn<LifeLinksWorkspaceApi["createRoutineGroup"]>(),
    createRoutineSchedule: vi.fn<LifeLinksWorkspaceApi["createRoutineSchedule"]>(),
    finalizeRoutineRun: vi.fn<LifeLinksWorkspaceApi["finalizeRoutineRun"]>(),
    getRoutine: vi.fn<LifeLinksWorkspaceApi["getRoutine"]>(),
    getRoutineRun: vi.fn<LifeLinksWorkspaceApi["getRoutineRun"]>(),
    getRoutineSession: vi.fn<LifeLinksWorkspaceApi["getRoutineSession"]>(),
    getActiveRoutineRun: vi.fn<LifeLinksWorkspaceApi["getActiveRoutineRun"]>(async () => ({ run: null })),
    listRoutineActivities: vi.fn<LifeLinksWorkspaceApi["listRoutineActivities"]>(async () => ({ activities: [], nextCursor: null, truncated: false })),
    listRoutineGroups: vi.fn<LifeLinksWorkspaceApi["listRoutineGroups"]>(async () => ({ routineGroups: [], nextCursor: null, truncated: false })),
    materializeRoutineOccurrences: vi.fn<LifeLinksWorkspaceApi["materializeRoutineOccurrences"]>(async ({ startDate, endDate }) => ({
      startDate, endDate, routineCount: 0, occurrenceCount: 0
    })),
    listRoutineOccurrences: vi.fn<LifeLinksWorkspaceApi["listRoutineOccurrences"]>(async () => ({ occurrences: [], nextCursor: null, truncated: false })),
    listRoutines: vi.fn<LifeLinksWorkspaceApi["listRoutines"]>(async () => ({ routines: [], nextCursor: null, truncated: false })),
    listRoutineSchedules: vi.fn<LifeLinksWorkspaceApi["listRoutineSchedules"]>(async () => ({ schedules: [], nextCursor: null, truncated: false })),
    listRoutineSessions: vi.fn<LifeLinksWorkspaceApi["listRoutineSessions"]>(async () => ({ sessions: [], nextCursor: null, truncated: false })),
    putRoutineRunStepResult: vi.fn<LifeLinksWorkspaceApi["putRoutineRunStepResult"]>(),
    reviseRoutine: vi.fn<LifeLinksWorkspaceApi["reviseRoutine"]>(),
    startRoutineRun: vi.fn<LifeLinksWorkspaceApi["startRoutineRun"]>(),
    updateRoutine: vi.fn<LifeLinksWorkspaceApi["updateRoutine"]>(),
    updateRoutineActivity: vi.fn<LifeLinksWorkspaceApi["updateRoutineActivity"]>(),
    updateRoutineGroup: vi.fn<LifeLinksWorkspaceApi["updateRoutineGroup"]>(),
    updateRoutineSchedule: vi.fn<LifeLinksWorkspaceApi["updateRoutineSchedule"]>(),
    getConfig: vi.fn(async () => ({ qrBaseUrl: "https://example.test", maxBatchCount: 10000 })),
    getMe: vi.fn(async () => ({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: disconnectedAgentConnection
    })),
    login: vi.fn(async () => ({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: disconnectedAgentConnection
    })),
    logout: vi.fn(async () => undefined),
    connectAgent: vi.fn(async () => ({ agentConnection: connectedAgentConnection })),
    disconnectAgent: vi.fn(async () => ({ agentConnection: disconnectedAgentConnection })),
    listLinks: vi.fn(async () => ({ links: [link] })),
    uploadLinkMedia: vi.fn(async () => ({ media: link.media[0] })),
    deleteLinkMedia: vi.fn(async () => undefined),
    createQrBatch: vi.fn(async () => ({
      batch: {
        id: "batch-1",
        batchKey: "BATCH",
        qrBaseUrl: "https://example.test",
        count: 1,
        createdBy: owner.id,
        createdAt: "2026-08-25T00:00:00.000Z"
      },
      qrCodes: [link]
    })),
    getQr: vi.fn(async () => ({ state: "claimed" as const, link, viewerIsOwner: true })),
    claimQr: vi.fn(async () => ({ result: "already_owned", state: { state: "claimed" as const, link, viewerIsOwner: true } })),
    findScan: vi.fn(async (targetQrId: string, scanText: string) => ({
      targetQrId,
      scannedQrId: scanText,
      match: targetQrId === scanText
    })),
    listLifeLinks: vi.fn<LifeLinksWorkspaceApi["listLifeLinks"]>(async (options = {}) => ({
      lifeLinks: options.parentId === rootLifeLink.id ? [canonicalSummary] : [rootSummary],
      nextCursor: null,
      truncated: false
    })),
    createLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    getLifeLinkDetail: vi.fn<LifeLinksWorkspaceApi["getLifeLinkDetail"]>(async (id) => ({
      detail: id === rootLifeLink.id ? {
        lifeLink: rootLifeLink, ancestry: { items: [rootSummary], truncated: false, omittedCount: 0 },
        children: [canonicalSummary], childrenPage: { nextCursor: null, truncated: false }
      } : canonicalDetail
    })),
    searchLifeLinks: vi.fn(async (
      _query: string,
      _options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
    ) => ({
      results: [{
        lifeLink: canonicalSummary,
        path: canonicalDetail.ancestry,
        bodySummary: canonicalLink.body,
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    })),
    updateLifeLink: vi.fn(async (
      _lifeLinkId: string,
      _expectedUpdatedAt: string,
      _patch: UpdateLifeLinkPatch,
      _options: { signal?: AbortSignal } = {}
    ) => ({ lifeLink: canonicalLink })),
    moveLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    uploadLifeLinkMedia: vi.fn(async () => ({ media: canonicalLink.media[0] })),
    deleteLifeLinkMedia: vi.fn(async () => undefined),
    attachQr: vi.fn(async () => ({
      result: "already_owned",
      state: { state: "claimed" as const, link, viewerIsOwner: true }
    }))
  } satisfies LifeLinksWorkspaceApi;
}

describe("Outlook provider workspace", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const externalCalendar: CalendarRecord = { ...nativeCalendar, source: "external", isDefault: false, title: "Outlook test" };
  const binding: CalendarProviderBindingView = { calendarId: externalCalendar.id, connectionId: "connection-outlook", providerKey: "microsoft-graph-calendar", providerAccountId: "test-account", providerCalendarId: "AAM/cal+one=", visible: true, capabilities: { read: true, create: true, update: true, delete: true } };
  const providerEvent: CalendarProviderEventProjection = { ...binding, ownerId: owner.id, providerEventId: "AAM/event+one=", providerRevision: "W/\"exact-revision\"", synchronizedAt: nativeCalendar.updatedAt,
    content: { title: "Outlook appointment", description: "Original description", location: "Room 1", status: "confirmed", providerSeriesId: null,
      providerRecurrence: { kind: "single", originalStartUtc: null }, outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false },
      span: { kind: "timed", startUtc: "2026-09-01T13:00:00.000Z", endUtc: "2026-09-01T14:00:00.000Z", sourceTimeZone: "America/New_York", floatingLocalStart: "2026-09-01T09:00:00", floatingLocalEnd: "2026-09-01T10:00:00" } } };
  const reference = { authority: "provider" as const, connectionId: binding.connectionId, calendarId: binding.calendarId, providerEventId: providerEvent.providerEventId };
  async function setup(path = "/calendar") {
    const api = fakeApi();
    api.listCalendars.mockResolvedValue({ calendars: [externalCalendar], providerBindings: [binding], nextCursor: null, truncated: false });
    api.listProviderCalendarEvents.mockResolvedValue({ providerEvents: [providerEvent], nextCursor: null, truncated: false });
    api.getProviderCalendarEvent.mockResolvedValue({ providerEvent });
    const route = new FakeRoute(path);
    const controller = new LifeLinksWorkspaceController({ api, route, commandId: () => "stable-provider-command" });
    await controller.start(); await controller.connectAgent();
    return { api, controller, route };
  }
  it("resumes the exact provider route through a fresh authorized read without losing Calendar presentation", async () => {
    const { api, controller, route } = await setup();
    await controller.openProviderCalendarEvent(reference);
    const path = route.pathname();
    controller.setCalendarPresentation({ view: "day", anchorDate: "2026-09-15", selectedDate: "2026-09-15" });
    await controller.openCollections(); api.getProviderCalendarEvent.mockClear();
    await controller.resumeWorkspace("calendar");
    expect(route.pathname()).toBe(path);
    expect(api.getProviderCalendarEvent).toHaveBeenCalledExactlyOnceWith(reference, undefined, "human");
    expect(controller.getSnapshot()).toMatchObject({ calendarWorkspace: { selectedProviderEvent: providerEvent },
      presentation: { calendar: { view: "day", anchorDate: "2026-09-15" } } });
    controller.dispose();
  });

  it("does not reopen a provider event after a peer switch during its calendar read", async () => {
    const { api, controller, route } = await setup();
    let finish!: (value: { calendars: CalendarRecord[]; providerBindings: CalendarProviderBindingView[]; nextCursor: null; truncated: false }) => void;
    api.listCalendars.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = controller.openProviderCalendarEvent(reference);
    await controller.openCollections();
    finish({ calendars: [externalCalendar], providerBindings: [binding], nextCursor: null, truncated: false });
    await pending;
    expect(route.pathname()).toBe("/collections");
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", detailsOpen: false, calendarWorkspace: { selectedProviderEvent: null } });
    expect(api.getProviderCalendarEvent).not.toHaveBeenCalled();
    controller.dispose();
  });

  async function setupManagedCalendar() {
    const context = await setup();
    const view = { calendar: externalCalendar, connectionId: binding.connectionId, providerCalendarId: binding.providerCalendarId,
      providerDisplayName: externalCalendar.title, capabilities: binding.capabilities, visible: true };
    context.api.listCalendarConnections.mockResolvedValue({ connections: [{ ownerId: owner.id, connectionId: binding.connectionId,
      providerKey: binding.providerKey, providerAccountId: binding.providerAccountId, status: "active", connectedAt: nativeCalendar.updatedAt,
      disconnectedAt: null, remoteRevocationStatus: "not_required", remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null }] });
    context.api.listConnectedCalendars.mockResolvedValue({ calendars: [view] });
    await context.controller.loadCalendarConnections();
    return { ...context, view };
  }
  it("publishes acknowledged connected settings without a redundant management read", async () => {
    const { api, controller, view } = await setupManagedCalendar();
    const saved = { ...view, visible: false, calendar: { ...externalCalendar, agentAccess: "read" as const, updatedAt: "2026-09-02T18:00:00.000Z" } };
    api.updateConnectedCalendar.mockResolvedValue({ calendar: saved });
    api.listCalendarConnections.mockClear();
    await expect(controller.updateConnectedCalendar(binding.connectionId, externalCalendar.id, externalCalendar.updatedAt, { visible: false, agentAccess: "read" })).resolves.toEqual(saved);
    expect(api.updateConnectedCalendar).toHaveBeenCalledWith(binding.connectionId, externalCalendar.id, externalCalendar.updatedAt, { visible: false, agentAccess: "read" }, undefined);
    expect(api.listCalendarConnections).not.toHaveBeenCalled();
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.calendars).toEqual([saved]);
    expect(controller.getSnapshot().calendarWorkspace.calendars.find((entry) => entry.id === externalCalendar.id)?.agentAccess).toBe("read");
    expect(controller.getSnapshot().calendarWorkspace.providerBindings[0].visible).toBe(false);
    controller.dispose();
  });
  it("keeps a committed connected-settings save successful when event refresh fails", async () => {
    const { api, controller, view } = await setupManagedCalendar();
    await controller.loadCalendarWindow({ startDate: "2026-09-01", endDate: "2026-10-01" });
    const saved = { ...view, calendar: { ...externalCalendar, agentAccess: "none" as const, updatedAt: "2026-09-02T18:00:00.000Z" } };
    api.updateConnectedCalendar.mockResolvedValue({ calendar: saved });
    api.listCalendarEvents.mockRejectedValueOnce(new Error("Event service unavailable"));
    await expect(controller.updateConnectedCalendar(binding.connectionId, externalCalendar.id, externalCalendar.updatedAt, { visible: true, agentAccess: "none" })).resolves.toEqual(saved);
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.calendars).toEqual([saved]);
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.error).toContain("Settings saved, but events could not be refreshed");
    controller.dispose();
  });
  it("does not publish rejected or wrong-identity connected-settings writes", async () => {
    const { api, controller, view } = await setupManagedCalendar();
    api.updateConnectedCalendar.mockRejectedValueOnce(new Error("stale_calendar"));
    await expect(controller.updateConnectedCalendar(binding.connectionId, externalCalendar.id, externalCalendar.updatedAt, { visible: false })).rejects.toThrow("stale_calendar");
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.calendars).toEqual([view]);
    api.updateConnectedCalendar.mockResolvedValueOnce({ calendar: { ...view, connectionId: "another-connection" } });
    await expect(controller.updateConnectedCalendar(binding.connectionId, externalCalendar.id, externalCalendar.updatedAt, { visible: false })).rejects.toThrow("different Calendar");
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.calendars).toEqual([view]);
    controller.dispose();
  });
  it("keeps last known connected settings visible but unverified after a failed reload", async () => {
    const { api, controller, view } = await setupManagedCalendar();
    api.listCalendarConnections.mockRejectedValueOnce(new Error("Connection read unavailable"));
    await expect(controller.loadCalendarConnections()).rejects.toThrow("Connection read unavailable");
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement).toMatchObject({
      loaded: false, loading: false, error: "Connection read unavailable", calendars: [view]
    });
    expect(controller.getSnapshot().calendarWorkspace.connectionManagement.connections[0].connectionId).toBe(binding.connectionId);
    controller.dispose();
  });
  it("keeps Outlook authorization drafts explicit, validates exact selection, and cancels without creating a connection", async () => {
    const authorizationId = "11111111-1111-4111-8111-111111111111";
    const { api, controller, route } = await setup(`/calendar?calendarAuthorization=${authorizationId}`);
    api.getCalendarAuthorization.mockResolvedValue({ providerKey: "microsoft", providerAccountId: binding.providerAccountId,
      calendars: [{ providerCalendarId: binding.providerCalendarId, displayName: "Work", isDefault: true, capabilities: binding.capabilities }] });
    await controller.loadCalendarConnectionDiscovery();
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.authorizationId).toBe(authorizationId);
    await expect(controller.completeCalendarConnectionSelection(["unrelated-id"])).rejects.toThrow();
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    await controller.cancelCalendarConnectionSelection();
    expect(api.cancelCalendarAuthorization).toHaveBeenCalledWith(authorizationId, undefined);
    expect(route.pathname()).toBe("/calendar");
    controller.dispose();
  });
  it("admits only the server's exact Microsoft HTTPS authorization destination", async () => {
    const { api, controller } = await setup();
    api.authorizeMicrosoftCalendar.mockResolvedValue({ authorizationUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=opaque" });
    await expect(controller.beginMicrosoftCalendarAuthorization(binding.connectionId)).resolves.toContain("https://login.microsoftonline.com/");
    api.authorizeMicrosoftCalendar.mockResolvedValue({ authorizationUrl: "https://login.microsoftonline.com.evil.test/authorize" });
    await expect(controller.beginMicrosoftCalendarAuthorization()).rejects.toThrow("unsupported Outlook");
    controller.dispose();
  });
  it("starts Google authorization and exact reconnect only at Google's own HTTPS destination", async () => {
    const { api, controller } = await setup();
    const abort = new AbortController();
    const authorizationUrl = "https://accounts.google.com/o/oauth2/v2/auth?state=opaque";
    api.authorizeGoogleCalendar.mockResolvedValue({ authorizationUrl });
    await expect(controller.beginGoogleCalendarAuthorization("connection-google", abort.signal)).resolves.toBe(authorizationUrl);
    expect(api.authorizeGoogleCalendar).toHaveBeenCalledWith("connection-google", abort.signal);
    expect(api.authorizeMicrosoftCalendar).not.toHaveBeenCalled();
    for (const invalid of [
      "https://accounts.google.com.evil.test/o/oauth2/v2/auth",
      "http://accounts.google.com/o/oauth2/v2/auth",
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
      "https://accounts.google.com:8443/o/oauth2/v2/auth",
      "https://user:password@accounts.google.com/o/oauth2/v2/auth"
    ]) {
      api.authorizeGoogleCalendar.mockResolvedValueOnce({ authorizationUrl: invalid });
      await expect(controller.beginGoogleCalendarAuthorization()).rejects.toThrow("unsupported Google");
    }
    controller.dispose();
  });
  it("does not return a Google redirect after cancellation or a signed-in owner change", async () => {
    const { api, controller } = await setup();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(controller.beginGoogleCalendarAuthorization(undefined, alreadyAborted.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(api.authorizeGoogleCalendar).not.toHaveBeenCalled();
    const delayed = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["authorizeGoogleCalendar"]>>>();
    const abort = new AbortController();
    api.authorizeGoogleCalendar.mockReturnValueOnce(delayed.promise);
    const canceled = controller.beginGoogleCalendarAuthorization(undefined, abort.signal);
    abort.abort();
    delayed.resolve({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" });
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    const ownerChanged = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["authorizeGoogleCalendar"]>>>();
    api.authorizeGoogleCalendar.mockReturnValueOnce(ownerChanged.promise);
    const pending = controller.beginGoogleCalendarAuthorization();
    await controller.logout();
    ownerChanged.resolve({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" });
    await expect(pending).rejects.toThrow("signed-in account changed");
    controller.dispose();
  });
  it("uses the common Google discovery/selection/cancellation flow without changing agent permissions", async () => {
    const authorizationId = "11111111-1111-4111-8111-111111111111";
    const { api, controller, route } = await setup(`/calendar?calendarAuthorization=${authorizationId}`);
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.feedback).toBe("Sign-in complete. Choose calendars and agent access to finish connecting.");
    api.getCalendarAuthorization.mockResolvedValue({ providerKey: "google", providerAccountId: "google-subject-exact",
      calendars: [{ providerCalendarId: "exact-calendar@group.calendar.google.com", displayName: "Agent Tests", isDefault: false, capabilities: binding.capabilities }] });
    await controller.loadCalendarConnectionDiscovery();
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.discovery?.providerKey).toBe("google");
    await expect(controller.completeCalendarConnectionSelection(["wrong-calendar"])).rejects.toThrow("exact available calendars");
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    await controller.completeCalendarConnectionSelection(["exact-calendar@group.calendar.google.com"]);
    expect(api.completeCalendarAuthorization).toHaveBeenCalledWith(authorizationId, ["exact-calendar@group.calendar.google.com"], undefined);
    expect(api.updateConnectedCalendar).not.toHaveBeenCalled();
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.feedback).toContain("no agent access");
    expect(route.pathname()).toBe("/calendar");
    controller.dispose();

    const canceled = await setup(`/calendar?calendarAuthorization=${authorizationId}`);
    await canceled.controller.cancelCalendarConnectionSelection();
    expect(canceled.api.cancelCalendarAuthorization).toHaveBeenCalledWith(authorizationId, undefined);
    expect(canceled.api.completeCalendarAuthorization).not.toHaveBeenCalled();
    expect(canceled.route.pathname()).toBe("/calendar");
    canceled.controller.dispose();
  });
  it.each([
    ["cancelled", "Calendar connection was canceled. No calendars were added."],
    ["session_expired", "The Calendar authorization session expired. Start Connect again."],
    ["authorization_failed", "Calendar authorization could not be completed. Start Connect again."]
  ])("keeps %s callback feedback provider-neutral without starting another authorization", async (code, feedback) => {
    const { api, controller, route } = await setup(`/calendar?calendarConnectionError=${code}`);
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.error).toBe(feedback);
    expect(api.authorizeGoogleCalendar).not.toHaveBeenCalled();
    expect(api.authorizeMicrosoftCalendar).not.toHaveBeenCalled();
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    await controller.cancelCalendarConnectionSelection();
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.error).toBe("");
    expect(route.pathname()).toBe("/calendar");
    controller.dispose();
  });

  it.each(["google", "microsoft"] as const)("connects %s calendars with the chosen access without a second settings mutation", async (providerKey) => {
    const authorizationId = "11111111-1111-4111-8111-111111111111";
    const { api, controller, route } = await setup(`/calendar?calendarAuthorization=${authorizationId}`);
    api.getCalendarAuthorization.mockResolvedValue({ providerKey, providerAccountId: binding.providerAccountId, calendars: [
      { providerCalendarId: "personal", displayName: "Personal", isDefault: true, capabilities: binding.capabilities },
      { providerCalendarId: "holidays", displayName: "Holidays", isDefault: false, capabilities: { read: true, create: false, update: false, delete: false } },
      { providerCalendarId: "private", displayName: "Private", isDefault: false, capabilities: binding.capabilities }
    ] });
    await controller.loadCalendarConnectionDiscovery();
    const signal = new AbortController().signal;
    await controller.completeCalendarConnectionSelection(["personal", "holidays", "private"], signal, { personal: "write", holidays: "read", private: "none" });
    expect(api.completeCalendarAuthorization).toHaveBeenCalledWith(authorizationId, ["personal", "holidays", "private"], signal, { personal: "write", holidays: "read", private: "none" });
    expect(api.updateConnectedCalendar).not.toHaveBeenCalled();
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow).toMatchObject({ authorizationId: null, discovery: null, feedback: "Selected calendars connected with your chosen agent access." });
    expect(route.pathname()).toBe("/calendar");
    controller.dispose();
  });

  it("rejects missing, extra, and provider-incompatible access choices before connecting", async () => {
    const { api, controller } = await setup("/calendar?calendarAuthorization=11111111-1111-4111-8111-111111111111");
    api.getCalendarAuthorization.mockResolvedValue({ providerKey: "google", providerAccountId: binding.providerAccountId, calendars: [
      { providerCalendarId: "holidays", displayName: "Holidays", isDefault: false, capabilities: { read: true, create: false, update: false, delete: false } }
    ] });
    await controller.loadCalendarConnectionDiscovery();
    const invalidAccess: Record<string, "none" | "read" | "write">[] = [{}, { holidays: "read", other: "write" }, { holidays: "write" }];
    for (const access of invalidAccess) {
      await expect(controller.completeCalendarConnectionSelection(["holidays"], undefined, access)).rejects.toThrow("available agent access");
    }
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    const abort = new AbortController(); abort.abort();
    await expect(controller.completeCalendarConnectionSelection(["holidays"], abort.signal, { holidays: "read" })).rejects.toMatchObject({ name: "AbortError" });
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("includes chosen access when adding a calendar to an existing connection", async () => {
    const { api, controller } = await setup();
    api.discoverConnectedCalendars.mockResolvedValue({ providerKey: "microsoft", providerAccountId: binding.providerAccountId, calendars: [
      { providerCalendarId: "new-calendar", displayName: "New calendar", isDefault: false, capabilities: binding.capabilities }
    ] });
    await controller.loadCalendarConnectionDiscovery(binding.connectionId);
    await controller.completeCalendarConnectionSelection(["new-calendar"], undefined, { "new-calendar": "write" });
    expect(api.selectConnectedCalendars).toHaveBeenCalledWith(binding.connectionId, ["new-calendar"], undefined, { "new-calendar": "write" });
    expect(api.completeCalendarAuthorization).not.toHaveBeenCalled();
    expect(api.updateConnectedCalendar).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("allows discovery to restart after the first dialog request is aborted", async () => {
    const { api, controller } = await setup("/calendar?calendarAuthorization=11111111-1111-4111-8111-111111111111");
    const pending = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getCalendarAuthorization"]>>>();
    api.getCalendarAuthorization.mockReturnValueOnce(pending.promise);
    const abort = new AbortController();
    const loading = controller.loadCalendarConnectionDiscovery(undefined, abort.signal);
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.loading).toBe(true);
    abort.abort();
    pending.reject(new DOMException("Dialog unmounted", "AbortError"));
    await loading;
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow).toMatchObject({ loading: false, error: "" });
    api.getCalendarAuthorization.mockResolvedValueOnce({ providerKey: "google", providerAccountId: binding.providerAccountId, calendars: [] });
    await controller.loadCalendarConnectionDiscovery();
    expect(api.getCalendarAuthorization).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().calendarWorkspace.connectionFlow.discovery?.providerKey).toBe("google");
    controller.dispose();
  });
  it("lists/query/inspects exact provider identities through narrowed reads and pages provider entries one at a time", async () => {
    const { api, controller } = await setup();
    api.listProviderCalendarEvents.mockResolvedValue({ providerEvents: [providerEvent, { ...providerEvent, providerEventId: "second-event" }], nextCursor: null, truncated: false });
    await expect(controller.agentListAuthorizedCalendars({ limit: 2 })).resolves.toMatchObject({ ok: true, calendars: [{ provider: "microsoft", writeAuthority: "provider", providerCalendarId: binding.providerCalendarId, capabilities: binding.capabilities }] });
    const page = await controller.agentQueryCalendarEvents({ startDate: "2026-09-01", endDate: "2026-09-01", limit: 2 });
    expect(page).toMatchObject({ ok: true, instances: [{ source: "provider_event", providerEvent }], nextCursor: "calendar-agent-events-1", truncated: true });
    expect(api.listProviderCalendarEvents).toHaveBeenCalledWith(expect.objectContaining({ authority: "provider", calendarId: binding.calendarId }), undefined, "agent");
    await expect(controller.agentInspectProviderCalendarEvent(reference)).resolves.toMatchObject({ ok: true, providerEvent });
    const catalog = new Map(createCalendarAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
    const listed = await catalog.get("list_my_calendars")!.execute({ limit: 2 });
    expect(listed).toMatchObject({ ok: true, calendars: [{ provider: "microsoft", providerCalendarId: binding.providerCalendarId }] });
    expect(JSON.stringify(listed)).not.toContain("providerKey");
    await expect(catalog.get("inspect_calendar_event")!.execute(reference)).resolves.toMatchObject({ ok: true, providerEvent: { providerEventId: providerEvent.providerEventId, providerRevision: providerEvent.providerRevision } });
    expect(controller.getSnapshot().calendarWorkspace.selectedProviderEvent).toEqual(providerEvent);
    controller.dispose();
  });
  it("shares provider writes with the visible UI without masquerading as native events, preserving stable retry identity", async () => {
    const { api, controller, route } = await setup();
    const { providerSeriesId: _series, providerRecurrence: _recurrence, outboundEffects: _effects, ...content } = providerEvent.content;
    if (content.span.kind !== "timed") throw new Error("Expected timed provider fixture");
    content.span = { ...content.span, floatingLocalStart: null, floatingLocalEnd: null };
    const catalog = new Map(createCalendarAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
    const create = { authority: "provider" as const, commandId: "stable-create", connectionId: binding.connectionId, calendarId: binding.calendarId, content };
    api.createProviderCalendarEvent.mockResolvedValue({ providerEvent });
    await expect(catalog.get("create_calendar_event")!.execute(create)).resolves.toMatchObject({ ok: true, saved: true });
    expect(controller.getSnapshot().calendarWorkspace.selectedEvent).toBeNull();
    expect(route.pathname()).toContain("authority=provider");
    const update = { ...create, commandId: "stable-update", expectedProviderRevision: providerEvent.providerRevision, scope: "event" as const, providerEventId: providerEvent.providerEventId };
    api.updateProviderCalendarEvent.mockResolvedValue({ providerEvent: { ...providerEvent, providerRevision: "next-revision" } });
    await expect(catalog.get("update_calendar_event")!.execute(update)).resolves.toMatchObject({ ok: true, saved: true });
    await expect(catalog.get("update_calendar_event")!.execute(update)).resolves.toMatchObject({ ok: true, saved: true });
    expect(api.updateProviderCalendarEvent.mock.calls[0]).toEqual(api.updateProviderCalendarEvent.mock.calls[1]);
    expect(api.createCalendarEvent).not.toHaveBeenCalled(); expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("requires one visible confirmation and rechecks live grants even for a completed provider deletion replay", async () => {
    const { api, controller } = await setup();
    const catalog = new Map(createCalendarAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
    const prepared = await catalog.get("prepare_calendar_event_deletion")!.execute({ ...reference, expectedProviderRevision: providerEvent.providerRevision, scope: "event" });
    expect(prepared).toMatchObject({ ok: true, requiresAppObservedConfirmation: true, recurrenceScope: "event" });
    if (!prepared || typeof prepared !== "object" || !("previewId" in prepared) || typeof prepared.previewId !== "string") throw new Error("Expected provider deletion preview");
    const pending = catalog.get("apply_calendar_event_deletion")!.execute({ previewId: prepared.previewId });
    await vi.waitFor(() => expect(controller.getSnapshot().agentCalendarDeletionConfirmation).toMatchObject({ providerEvent }));
    expect(api.deleteProviderCalendarEvent).not.toHaveBeenCalled();
    api.deleteProviderCalendarEvent.mockResolvedValue({ kind: "delete", ...reference, deletedProviderRevision: providerEvent.providerRevision });
    controller.confirmAgentCalendarDeletion(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
    await expect(catalog.get("apply_calendar_event_deletion")!.execute({ previewId: prepared.previewId })).resolves.toMatchObject({ ok: true });
    expect(api.deleteProviderCalendarEvent).toHaveBeenCalledTimes(1);
    api.listCalendars.mockResolvedValue({ calendars: [{ ...externalCalendar, agentAccess: "read" }], providerBindings: [binding], nextCursor: null, truncated: false });
    await expect(catalog.get("apply_calendar_event_deletion")!.execute({ previewId: prepared.previewId })).resolves.toMatchObject({ ok: false, error: { code: "calendar_event_unavailable" } });
    controller.dispose();
  });
  it("refuses recurring provider deletion and never applies a canceled confirmation", async () => {
    const { api, controller } = await setup();
    api.getProviderCalendarEvent.mockResolvedValueOnce({ providerEvent: { ...providerEvent, content: { ...providerEvent.content, providerSeriesId: "series" } } });
    await expect(controller.agentPrepareProviderCalendarEventDeletion({ ...reference, expectedProviderRevision: providerEvent.providerRevision, scope: "event" })).resolves.toMatchObject({ ok: false, code: "unsupported_calendar_authority" });
    const prepared = await controller.agentPrepareProviderCalendarEventDeletion({ ...reference, expectedProviderRevision: providerEvent.providerRevision, scope: "event" });
    if (!prepared.ok) throw new Error("Expected a standalone preview");
    const pending = controller.agentApplyProviderCalendarEventDeletion(prepared.preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentCalendarDeletionConfirmation).not.toBeNull());
    controller.confirmAgentCalendarDeletion(false);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "confirmation_cancelled" });
    expect(api.deleteProviderCalendarEvent).not.toHaveBeenCalled();
    controller.dispose();
  });
});

describe("shared owner changes and agent confirmation", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const preview: LifeLinkChangePreview = { id: "preview-delete", operation: "delete", rootIds: [rootLifeLink.id],
    items: [rootLifeLink, canonicalLink], parentId: null, target: null,
    sideEffects: { lifeLinks: 2, media: 1, qrBindings: 1, collectionMemberships: 1, collectionSectionAssignments: 2 }, createdAt: rootLifeLink.createdAt };

  async function setup() {
    const api = fakeApi();
    api.previewLifeLinkChange.mockResolvedValue(preview);
    api.applyLifeLinkChange.mockResolvedValue({ operation: "delete", affectedIds: [rootLifeLink.id, canonicalLink.id], history: { limit: 5, entries: [{ id: "change-1", label: "Delete 2 Life Links", createdAt: preview.createdAt }] } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links"), commandId: () => "stable-command" });
    await controller.start();
    await controller.connectAgent();
    await controller.agentPreviewLifeLinkChange({ operation: "delete", lifeLinkIds: [rootLifeLink.id] });
    return { api, controller };
  }

  it("waits for one app-observed confirmation after a full preview, then commits exactly once", async () => {
    const { api, controller } = await setup();
    const pending = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.confirmAgentChange(true);
    expect(await pending).toMatchObject({ ok: true });
    expect(api.applyLifeLinkChange).toHaveBeenCalledExactlyOnceWith(preview.id, "change-stable-command", undefined);
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ busy: false, rootLifeLinks: { loaded: true } });
    controller.dispose();
  });

  it("reserves one agent apply before async draft reads and never replaces its confirmation", async () => {
    const { api, controller } = await setup();
    const detail = await api.getLifeLinkDetail(rootLifeLink.id);
    const reading = deferred<typeof detail>();
    api.getLifeLinkDetail.mockImplementationOnce(() => reading.promise);
    const first = controller.agentApplyLifeLinkChange(preview.id);
    const secondAbort = new AbortController();
    expect(await controller.agentApplyLifeLinkChange(preview.id, secondAbort.signal)).toEqual({ ok: false, code: "invalid_operation" });
    secondAbort.abort();
    reading.resolve(detail);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(false);
    expect(await first).toEqual({ ok: false, code: "cancelled" });
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("replays an uncertain confirmed deletion without rereading deleted items or confirming twice", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockImplementationOnce(async () => {
      // The store committed, but the response was lost; all selected records are gone.
      api.getLifeLinkDetail.mockRejectedValue(new ApiError(404, "life_link_not_found", {}));
      api.listLifeLinks.mockResolvedValue({ lifeLinks: [], nextCursor: null, truncated: false });
      throw new Error("connection lost after commit");
    });
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    expect(await first).toEqual({ ok: false, code: "effect_not_applied" });
    const readsAfterCommit = api.getLifeLinkDetail.mock.calls.length;
    expect(await controller.agentApplyLifeLinkChange(preview.id)).toMatchObject({ ok: true, change: { operation: "delete", affectedIds: [rootLifeLink.id, canonicalLink.id] } });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(readsAfterCommit);
    expect(api.applyLifeLinkChange.mock.calls.map((call) => call[1])).toEqual(["change-stable-command", "change-stable-command"]);
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    controller.dispose();
  });

  it("still checks descendant drafts before the first apply", async () => {
    const { api, controller } = await setup();
    writeCanonicalLifeLinkDraft(canonicalLink.id, canonicalLink.updatedAt, { title: "Unsaved child", body: "Draft", bodyDoc: canonicalLink.bodyDoc, bodyDocVersion: 1, privacy: canonicalLink.privacy, context: canonicalLink.context });
    expect(await controller.agentApplyLifeLinkChange(preview.id)).toEqual({ ok: false, code: "editor_dirty" });
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("requires a fresh app choice after a definitive stale-preview rejection", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new ApiError(409, "stale_life_link", {}));
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    expect(await first).toEqual({ ok: false, code: "stale_life_link" });
    const retry = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(false);
    expect(await retry).toEqual({ ok: false, code: "cancelled" });
    expect(api.applyLifeLinkChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it.each(["disconnect", "logout", "dispose"])("%s clears uncertain agent commit authority", async (mode) => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new Error("connection lost"));
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    await first;
    if (mode === "disconnect") { await controller.disconnectAgent(); await controller.connectAgent(); }
    else if (mode === "logout") { await controller.logout(); await controller.login(owner.email, "test-password"); await controller.connectAgent(); }
    else { controller.dispose(); await controller.start(); }
    expect((await controller.agentApplyLifeLinkChange(preview.id)).ok).toBe(false);
    expect(api.applyLifeLinkChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("disconnecting during admission reads cancels before displaying a confirmation", async () => {
    const { api, controller } = await setup();
    const detail = await api.getLifeLinkDetail(rootLifeLink.id);
    const reading = deferred<typeof detail>();
    api.getLifeLinkDetail.mockImplementationOnce(() => reading.promise);
    const pending = controller.agentApplyLifeLinkChange(preview.id);
    await controller.disconnectAgent();
    reading.resolve(detail);
    expect(await pending).toEqual({ ok: false, code: "cancelled" });
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it.each(["cancel", "abort", "disconnect", "logout"])("%s cancels a pending agent deletion with zero writes", async (mode) => {
    const { api, controller } = await setup();
    const abort = new AbortController();
    const pending = controller.agentApplyLifeLinkChange(preview.id, abort.signal);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).not.toBeNull());
    if (mode === "cancel") controller.confirmAgentChange(false);
    else if (mode === "abort") abort.abort();
    else if (mode === "disconnect") await controller.disconnectAgent();
    else await controller.logout();
    expect((await pending).ok).toBe(false);
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    controller.dispose();
  });

  it("keeps one command identity through an uncertain network response", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new Error("connection lost"));
    await expect(controller.applyLifeLinkChange(preview.id)).rejects.toThrow("connection lost");
    await controller.applyLifeLinkChange(preview.id);
    expect(api.applyLifeLinkChange.mock.calls.map((call) => call[1])).toEqual(["change-stable-command", "change-stable-command"]);
    controller.dispose();
  });

  it("loads account history after reload and requests only the displayed newest entry", async () => {
    const api = fakeApi();
    const history = { limit: 5 as const, entries: [{ id: "existing-change", label: "Edit Collection", createdAt: preview.createdAt }] };
    api.getChangeHistory.mockResolvedValue(history);
    api.undoChange.mockResolvedValue({ operation: "undo", affectedIds: [], history: { limit: 5, entries: [] } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links"), commandId: () => "undo-id" });
    await controller.start();
    expect(controller.getSnapshot().changeHistory).toEqual(history);
    await controller.undoLastChange();
    expect(api.undoChange).toHaveBeenCalledExactlyOnceWith("existing-change", "change-undo-id");
    controller.dispose();
  });

  it.each(["navigate", "change owner"])("does not restore the old selection when users %s during mutation readback", async (action) => {
    const { api, controller } = await setup();
    await controller.activateLifeLink(canonicalLink.id);
    const reading = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listLifeLinks"]>>>();
    let refreshing = false;
    api.listLifeLinks.mockImplementationOnce(() => { refreshing = true; return reading.promise; });
    api.applyLifeLinkChange.mockResolvedValue({ operation: "move", affectedIds: [canonicalLink.id], history: { limit: 5, entries: [] } });
    const pending = controller.applyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(refreshing).toBe(true));
    if (action === "change owner") {
      await controller.logout();
      api.login.mockResolvedValue({ user: { ...owner, id: "owner-2" }, qrBaseUrl: "https://example.test", agentConnection: disconnectedAgentConnection });
      api.listLifeLinks.mockResolvedValue({ lifeLinks: [], nextCursor: null, truncated: false });
      api.listLinks.mockResolvedValue({ links: [] });
      api.getLifeLinkDetail.mockRejectedValue(new ApiError(404, "life_link_not_found", {}));
      await controller.login("second@example.test", "test-password");
    }
    await controller.openCollections();
    api.getLifeLinkDetail.mockClear();
    reading.resolve({ lifeLinks: [rootSummary], nextCursor: null, truncated: false });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", routePathname: "/collections", selectedLifeLinkId: null, error: "" });
    expect(api.getLifeLinkDetail).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not let an older automatic history failure erase a newer successful history", async () => {
    const { api, controller } = await setup();
    await controller.getChangeHistory();
    const oldHistory = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getChangeHistory"]>>>();
    api.getChangeHistory.mockImplementationOnce(() => oldHistory.promise);
    const historyCalls = vi.spyOn(controller, "getChangeHistory");
    await controller.connectAgent(); // busy -> idle starts the older automatic request.
    const oldRequest = historyCalls.mock.results[0].value as Promise<unknown>;
    const history = { limit: 5 as const, entries: [{ id: "newer-change", label: "Move 1 Life Link", createdAt: preview.createdAt }] };
    api.getChangeHistory.mockResolvedValue(history);
    await controller.getChangeHistory();
    oldHistory.reject(new Error("older refresh failed"));
    await expect(oldRequest).rejects.toThrow("older refresh failed");
    expect(controller.getSnapshot().changeHistory).toEqual(history);
    api.getChangeHistory.mockRejectedValueOnce(new Error("current refresh failed"));
    await expect(controller.getChangeHistory()).rejects.toThrow("current refresh failed");
    expect(controller.getSnapshot().changeHistory.entries).toEqual([]);
    controller.dispose();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function summary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return summarizeLifeLink(lifeLink, childCount);
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}
