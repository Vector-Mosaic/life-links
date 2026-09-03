import { afterEach, describe, expect, it, vi } from "vitest";

import {
  previewCollectionChange, getCollectionChangePreview, applyCollectionChange,
  ApiError, addCollectionMember, attachQr, clearLifeLinkQrBinding, connectAgent, createCollection,
  createCalendar, createCalendarEvent, createRoutine, reviseRoutine, getRoutine, updateRoutine, deleteCalendar, deleteCalendarEvent, finalizeRoutineRun,
  createCollectionSection, createLifeLink, disconnectAgent, getCollection, listCollections,
  getActiveRoutineRun, getCalendar, getCalendarClock, getCalendarEvent, listCalendarEvents, listCalendars, listRoutineGroups, listRoutines,
  listCollectionMembers, listLifeLinkCollectionMemberships, login, getRegistration, registerAccount, moveLifeLink, removeCollectionMember,
  removeCollectionSection, replaceCollectionSectionAssignments, setLifeLinkQrBinding,
  updateCollection, updateCollectionSection, updateLifeLink, getLifeLinkAttachmentContent, getLifeLinkAttachmentImage,
  listRoutineOccurrences, materializeRoutineOccurrences, putRoutineRunStepResult,
  restoreCalendar, restoreCalendarEvent, updateCalendar, updateCalendarEvent,
  listCalendarProviders, listCalendarConnections, listConnectedCalendars, updateConnectedCalendar, disconnectCalendarConnection,
  authorizeMicrosoftCalendar, authorizeGoogleCalendar, getCalendarAuthorization, completeCalendarAuthorization, cancelCalendarAuthorization,
  discoverConnectedCalendars, selectConnectedCalendars, refreshCalendarConnection,
  listProviderCalendarEvents, getProviderCalendarEvent, createProviderCalendarEvent, updateProviderCalendarEvent, deleteProviderCalendarEvent
} from "./api";
import { ATTACHMENT_IMAGE_MAX_BASE64_CHARS, ATTACHMENT_IMAGE_MAX_BYTES } from "@life-links/core";
import { attachmentImageFixture, attachmentPdfImageFixture, attachmentSelectedImageFixture, attachmentTranscriptFixture } from "./attachmentImage.testFixtures";

describe("Life Links API error normalization", () => {
  it("uses the human cookie session boundary for invitation registration without leaking credentials into the URL", async () => {
    const session = { user: { id: "private-owner" }, agentConnection: { connected: false }, qrBaseUrl: "https://example.test" };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { displayName: "Private Judge", email: "private@example.test", password: "a test password", invitationCode: "i".repeat(32), timeZone: "America/New_York" };
    expect(await getRegistration()).toEqual({ enabled: true });
    expect(await registerAccount(input)).toEqual(session);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/registration");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/register");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify(input) });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has("X-Life-Links-Actor")).toBe(false);
  });
  it("narrows Workspace agent Collection and Routine calls without changing human defaults or payload identity", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preview: { id: "preview-exact" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const input = { operation: "delete" as const, scope: "collections" as const, collections: [{ collectionId: "collection-exact", expectedUpdatedAt: "2026-09-02T00:00:00.000Z" }] };
    await previewCollectionChange(input, abort.signal, "agent");
    await getCollectionChangePreview("preview-exact", abort.signal, "agent");
    await applyCollectionChange("preview-exact", "command-exact", abort.signal, "agent");
    await listRoutines({ limit: 5, actor: "agent", signal: abort.signal });
    await getRoutine("routine-exact", abort.signal, "agent");
    await updateRoutine("routine-exact", "2026-09-02T00:00:00.000Z", { archivedAt: "2026-09-02T12:00:00.000Z" }, abort.signal, "agent");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(6);
    expect(calls.every(([, init]) => new Headers(init.headers).get("X-Life-Links-Actor") === "agent" && init.signal === abort.signal && init.credentials === "include")).toBe(true);
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ previewId: "preview-exact", commandId: "command-exact" });
    expect(calls[3][0]).toBe("/api/routines?limit=5");
    await getRoutine("routine-exact", abort.signal);
    expect(new Headers((fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[6][1].headers).has("X-Life-Links-Actor")).toBe(false);
  });

  it("uses the shared owner Collection preview/apply contract with exact retry identity and cancellation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ preview: { id: "preview-exact" }, operation: "delete", collectionIds: [], lifeLinkIds: [], history: { limit: 5, entries: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const input = { operation: "delete" as const, scope: "collections" as const, collections: [{ collectionId: "collection-exact", expectedUpdatedAt: "2026-09-02T00:00:00.000Z" }] };
    expect(await previewCollectionChange(input, abort.signal)).toEqual({ id: "preview-exact" });
    await getCollectionChangePreview("preview-exact", abort.signal);
    await applyCollectionChange("preview-exact", "command-exact", abort.signal);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual(["/api/collections/changes/preview", "/api/collections/changes/preview-exact", "/api/collections/changes/apply"]);
    expect(JSON.parse(calls[0][1].body as string)).toEqual(input);
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ previewId: "preview-exact", commandId: "command-exact" });
    expect(calls.every(([, init]) => init.signal === abort.signal && init.credentials === "include")).toBe(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes Google authorization and exact reconnect through the shared human-only client flow", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    await authorizeGoogleCalendar(undefined, abort.signal);
    await authorizeGoogleCalendar("exact-google-connection", abort.signal);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path]) => path)).toEqual(["/api/calendar-providers/google/authorize", "/api/calendar-providers/google/authorize"]);
    expect(calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([{}, { reconnectConnectionId: "exact-google-connection" }]);
    for (const [, init] of calls) {
      expect(init).toMatchObject({ method: "POST", credentials: "include", signal: abort.signal });
      expect(new Headers(init.headers).has("X-Life-Links-Actor")).toBe(false);
    }
  });

  it("sends selected calendar access in the same owner-only completion request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const selectedCalendarIds = ["primary@example.test", "shared/calendar+one="];
    const agentAccessByCalendarId = { "primary@example.test": "write" as const, "shared/calendar+one=": "read" as const };
    await completeCalendarAuthorization("authorization-one", selectedCalendarIds, signal, agentAccessByCalendarId);
    await selectConnectedCalendars("connection/one", selectedCalendarIds, signal, agentAccessByCalendarId);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/calendar-authorizations/authorization-one/complete", "/api/calendar-connections/connection%2Fone/select"
    ]);
    for (const [, init] of calls) {
      expect(JSON.parse(init.body as string)).toEqual({ selectedCalendarIds, agentAccessByCalendarId });
      expect(init).toMatchObject({ method: "POST", credentials: "include", signal });
      expect(new Headers(init.headers).has("X-Life-Links-Actor")).toBe(false);
    }
  });

  it("routes Outlook authorization separately from exact provider event authority without credentials or implicit agent settings", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const connectionId = "connection/one", calendarId = "calendar-one", providerEventId = "AAM/event+one=";
    const authorizationId = "11111111-1111-4111-8111-111111111111";
    await authorizeMicrosoftCalendar(connectionId);
    await getCalendarAuthorization(authorizationId);
    await completeCalendarAuthorization(authorizationId, ["AAM/calendar+one="]);
    await cancelCalendarAuthorization(authorizationId);
    await discoverConnectedCalendars(connectionId);
    await selectConnectedCalendars(connectionId, ["AAM/calendar+one="]);
    await refreshCalendarConnection(connectionId, "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    const reference = { authority: "provider" as const, connectionId, calendarId, providerEventId };
    const content = { title: "Provider event", description: null, location: null, status: "confirmed" as const,
      span: { kind: "all_day" as const, startDate: "2026-09-01", endDateExclusive: "2026-09-02" } };
    const command = { authority: "provider" as const, connectionId, calendarId, commandId: "stable-command", content };
    await listProviderCalendarEvents({ authority: "provider", connectionId, calendarId, startDate: "2026-09-01", endDate: "2026-09-02", limit: 1 }, undefined, "agent");
    await getProviderCalendarEvent(reference, undefined, "agent");
    await createProviderCalendarEvent(command, undefined, "agent");
    await updateProviderCalendarEvent(providerEventId, { ...command, expectedProviderRevision: "W/\"revision\"", scope: "event" }, undefined, "agent");
    const { content: _content, ...deletion } = command;
    await deleteProviderCalendarEvent(providerEventId, { ...deletion, expectedProviderRevision: "W/\"revision\"", scope: "event" }, undefined, "agent");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.slice(0, 7).every(([, init]) => !new Headers(init.headers).has("X-Life-Links-Actor"))).toBe(true);
    expect(calls.slice(7).every(([, init]) => new Headers(init.headers).get("X-Life-Links-Actor") === "agent")).toBe(true);
    expect(calls[0][0]).toBe("/api/calendar-providers/microsoft/authorize");
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ reconnectConnectionId: connectionId });
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ selectedCalendarIds: ["AAM/calendar+one="] });
    expect(calls[3][1].method).toBe("DELETE");
    expect(calls[4][0]).toBe("/api/calendar-connections/connection%2Fone/available-calendars");
    const query = new URL(calls[7][0], "https://lifelinks.test");
    expect(query.searchParams.get("authority")).toBe("provider"); expect(query.searchParams.get("connectionId")).toBe(connectionId);
    expect(calls[8][0]).toContain("/api/calendar-events/AAM%2Fevent%2Bone%3D?");
    expect(calls[10][1].method).toBe("PATCH"); expect(calls[11][1].method).toBe("DELETE");
    expect(JSON.parse(calls[11][1].body as string)).toEqual({ ...deletion, expectedProviderRevision: "W/\"revision\"", scope: "event" });
  });

  it("keeps Calendar agent narrowing separate from owner settings while preserving JSON headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const calendarId = "calendar-00000000-0000-4000-8000-000000000001";
    const eventId = "calendar-event-00000000-0000-4000-8000-000000000001";
    const revisionId = "calendar-event-revision-00000000-0000-4000-8000-000000000001";
    const span = { kind: "all_day" as const, startDate: "2026-09-01", endDateExclusive: "2026-09-02" };
    await listCalendars({ actor: "agent" });
    await getCalendar(calendarId, undefined, "agent");
    await listCalendarEvents({ startDate: "2026-09-01", endDate: "2026-09-01", actor: "agent" });
    await getCalendarEvent(eventId, undefined, "agent");
    await createCalendarEvent({ id: eventId, revisionId, calendarId, title: "Agent event", lineage: { kind: "standalone" }, span }, undefined, "agent");
    await updateCalendarEvent(eventId, { revisionId, expectedCurrentRevisionId: revisionId, title: "Updated", span,
      target: { scope: "event", eventId } }, undefined, "agent");
    await deleteCalendarEvent(eventId, { expectedCurrentRevisionId: revisionId, target: { scope: "event", eventId } }, undefined, "agent");
    await updateCalendar(calendarId, "2026-09-01T00:00:00.000Z", { agentAccess: "none" });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.slice(0, 7).map(([, init]) => new Headers(init.headers).get("X-Life-Links-Actor"))).toEqual(Array(7).fill("agent"));
    expect(new Headers(calls[7][1].headers).has("X-Life-Links-Actor")).toBe(false);
    expect(calls.every(([, init]) => new Headers(init.headers).get("Content-Type") === "application/json")).toBe(true);
  });

  it("uses the owner Calendar connection contract without provider credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await listCalendarProviders();
    await listCalendarConnections();
    await listConnectedCalendars("connection/one");
    await updateConnectedCalendar("connection/one", "calendar/one", "2026-09-01T00:00:00.000Z", { visible: false, agentAccess: "none" });
    await disconnectCalendarConnection("connection/one", "purge");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path]) => path)).toEqual([
      "/api/calendar-providers", "/api/calendar-connections", "/api/calendar-connections/connection%2Fone/calendars",
      "/api/calendar-connections/connection%2Fone/calendars/calendar%2Fone", "/api/calendar-connections/connection%2Fone/disconnect"
    ]);
    expect(JSON.parse(calls[3][1].body as string)).toEqual({ expectedUpdatedAt: "2026-09-01T00:00:00.000Z", visible: false, agentAccess: "none" });
    expect(JSON.parse(calls[4][1].body as string)).toEqual({ localProjectionDisposition: "purge" });
    expect(calls.every(([, init]) => !new Headers(init.headers).has("X-Life-Links-Actor"))).toBe(true);
  });

  it.each(["docx", "xlsx", "video", "animation"] as const)("delivers selected %s coordinates, bytes and identity through the private API", async (kind) => {
    const result = attachmentSelectedImageFixture(kind);
    const selector = kind === "video" ? { atMs: 1200 } : kind === "animation" ? { frame: 2 } : { page: 2 };
    const options = { mode: "overview" as const, sourceRevision: result.sourceRevision, ...selector };
    stubJsonResponse(200, result);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, options)).toEqual(result);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining(`${Object.keys(selector)[0]}=${Object.values(selector)[0]}`), expect.objectContaining({ credentials: "include" }));
    const wrong = kind === "video" ? { atMs: 1201 } : kind === "animation" ? { frame: 1 } : { page: 1 };
    await expect(getLifeLinkAttachmentImage("life-link-1", result.mediaId, { ...options, ...wrong })).rejects.toThrow("Invalid attachment image response");
    result.rendition!.region = { x: 20, y: 30, width: 80, height: 80 };
    stubJsonResponse(200, result);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { ...options, mode: "crop", region: result.rendition!.region })).toEqual(result);
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(expect.stringContaining("&x=20&y=30&width=80&height=80"), expect.anything());
  });

  it.each(["profile", "format", "pageCount", "timeBase", "frameTime", "animationCount", "metadata"])("refuses invalid Office/temporal %s without releasing pixels", async (fault) => {
    const result = attachmentSelectedImageFixture(fault.startsWith("animation") ? "animation" : ["timeBase", "frameTime"].includes(fault) ? "video" : "docx");
    const selector = result.source!.video ? { atMs: 1200 } : result.source!.animation ? { frame: 2 } : { page: 2 };
    if (fault === "profile") (result.source!.office as any).conversionProfile = "recomputed";
    if (fault === "format") result.source!.office!.format = "xlsx";
    if (fault === "pageCount") result.source!.office!.pageCount = 1;
    if (fault === "timeBase") result.source!.video!.timeBase = "0/15360";
    if (fault === "frameTime") result.source!.video!.frameTimeMs = -1;
    if (fault === "animationCount") result.source!.animation!.frameCount = 4;
    if (fault === "metadata") result.warnings = ["界".repeat(700)];
    stubJsonResponse(200, result);
    await expect(getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "overview", sourceRevision: result.sourceRevision, ...selector })).rejects.toThrow("Invalid attachment image response");
  });

  it("carries a bounded speech window/stream plus text continuation, not a new audio window", async () => {
    const page = attachmentTranscriptFixture();
    page.text = page.text.slice(5); page.offset = 5;
    stubJsonResponse(200, page);
    const abort = new AbortController();
    expect(await getLifeLinkAttachmentContent("life-link-1", page.mediaId, { representation: "transcript", startMs: 30000, durationMs: 30000,
      audioStreamIndex: 1, offset: 5, revision: page.revision, signal: abort.signal })).toEqual(page);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("representation=transcript&startMs=30000&durationMs=30000&audioStreamIndex=1"), expect.objectContaining({ credentials: "include", signal: abort.signal }));
  });

  it.each(["window", "negativeEnd", "endType", "shortWindow", "duration", "nextWindow", "stream", "model", "processor", "pagination", "revision", "extra"])("refuses transcript %s mismatch or malformed metadata", async (fault) => {
    const page = attachmentTranscriptFixture();
    const revision = page.revision;
    if (fault === "window") page.transcript!.startMs = 0;
    if (fault === "negativeEnd") page.transcript!.endMs = -1;
    if (fault === "endType") (page.transcript as any).endMs = "60000";
    if (fault === "shortWindow") page.transcript!.endMs = 59000;
    if (fault === "duration") page.transcript!.sourceDurationMs = 300001;
    if (fault === "nextWindow") page.transcript!.nextStartMs = 0;
    if (fault === "stream") page.transcript!.audioStreamIndex = 2;
    if (fault === "model") page.transcript!.modelSha256 = "not-a-model-hash";
    if (fault === "processor") page.transcript!.processorVersion = "";
    if (fault === "pagination") page.totalChars++;
    if (fault === "revision") page.revision = "a".repeat(64);
    if (fault === "extra") Object.assign(page, { privateExtra: "must not escape" });
    stubJsonResponse(200, page);
    await expect(getLifeLinkAttachmentContent("life-link-1", page.mediaId, { representation: "transcript", startMs: 30000, durationMs: 30000, audioStreamIndex: 1, revision })).rejects.toThrow("Invalid attachment transcript response");
  });

  it("carries attachment continuation and cancellation through the same authenticated client", async () => {
    const page = { mediaId: "media-1", revision: "a".repeat(64), status: "ready", reason: null, format: "text", text: "next", offset: 12, nextOffset: null, totalChars: 16, warnings: [] };
    stubJsonResponse(200, page);
    const abort = new AbortController();
    expect(await getLifeLinkAttachmentContent("life-link-1", "media-1", { offset: 12, limit: 400, revision: page.revision, signal: abort.signal })).toEqual(page);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining(`/api/life-links/life-link-1/media/media-1/content?offset=12&limit=400&revision=${page.revision}`), expect.objectContaining({ credentials: "include", signal: abort.signal }));
  });

  it("delivers a real near-cap PNG without applying the text cap to image bytes", async () => {
    const result = attachmentImageFixture(800, 800);
    expect(result.rendition!.sizeBytes).toBeGreaterThan(1_900_000);
    expect(result.rendition!.sizeBytes).toBeLessThan(ATTACHMENT_IMAGE_MAX_BYTES);
    stubJsonResponse(200, result);
    const abort = new AbortController();
    const actual = await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "overview", sourceRevision: result.sourceRevision, maxEdge: 1024, encoding: "png" }, abort.signal);
    expect(actual.image).toEqual(result.image);
    expect(actual.rendition).toEqual(result.rendition);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining(`/image?mode=overview&sourceRevision=${result.sourceRevision}&maxEdge=1024&encoding=png`), expect.objectContaining({ credentials: "include", signal: abort.signal }));
  });

  it("carries exact describe/crop coordinates and revision with no text paging or content mutation", async () => {
    const result = attachmentImageFixture();
    const described = { ...result, status: "described", image: null, rendition: null };
    stubJsonResponse(200, described);
    expect(await getLifeLinkAttachmentImage("life/link", result.mediaId, { mode: "describe" })).toEqual(described);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(`/api/life-links/life%2Flink/media/${result.mediaId}/image?mode=describe`, expect.objectContaining({ credentials: "include" }));
    result.source!.width = 20; result.source!.height = 15;
    result.rendition!.region = { x: 3, y: 7, width: 4, height: 4 };
    stubJsonResponse(200, result);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "crop", sourceRevision: result.sourceRevision, region: result.rendition!.region })).toEqual(result);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining("&x=3&y=7&width=4&height=4"), expect.anything());
  });

  it.each(["identity", "revision", "hash", "size", "mime", "dimensions", "region", "base64", "metadata", "extra"])("refuses malformed or mismatched image %s without releasing image data", async (fault) => {
    const result = attachmentImageFixture();
    const revision = result.sourceRevision;
    if (fault === "identity") result.mediaId = "other-photo";
    if (fault === "revision") result.sourceRevision = "b".repeat(64);
    if (fault === "hash") result.rendition!.sha256 = "c".repeat(64);
    if (fault === "size") result.rendition!.sizeBytes++;
    if (fault === "mime") result.image!.mimeType = "image/jpeg";
    if (fault === "dimensions") result.rendition!.width--;
    if (fault === "region") result.rendition!.region.x++;
    if (fault === "base64") result.image!.data = "!" + result.image!.data.slice(1);
    if (fault === "metadata") result.warnings = ["x".repeat(2048)];
    if (fault === "extra") Object.assign(result, { unboundedExtra: "not allowed" });
    stubJsonResponse(200, result);
    await expect(getLifeLinkAttachmentImage("life-link-1", "media-photo", { mode: "overview", sourceRevision: revision })).rejects.toThrow("Invalid attachment image response.");
  });

  it("refuses oversized streamed responses before parsing and honors cancellation after decoding", async () => {
    const result = attachmentImageFixture();
    result.image!.data = "A".repeat(ATTACHMENT_IMAGE_MAX_BASE64_CHARS + 4096);
    stubJsonResponse(200, result);
    await expect(getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "overview", sourceRevision: result.sourceRevision })).rejects.toThrow("exceeded its limit");
    const abort = new AbortController();
    const valid = attachmentImageFixture();
    const fetchMock = stubJsonResponse(200, valid);
    fetchMock.mockImplementationOnce(async () => { abort.abort(); return new Response(JSON.stringify(valid), { status: 200 }); });
    await expect(getLifeLinkAttachmentImage("life-link-1", valid.mediaId, { mode: "overview", sourceRevision: valid.sourceRevision }, abort.signal)).rejects.toThrow();
  });

  it("normalizes legacy string error envelopes", async () => {
    const body = { error: "invalid_credentials" };
    stubJsonResponse(401, body);

    const error = await rejectedApiError(login("owner@example.test", "wrong"));

    expect(error).toMatchObject({
      status: 401,
      code: "invalid_credentials",
      message: "Invalid credentials.",
      retryable: false,
      reason: undefined,
      body
    });
  });

  it("carries the selected PDF page through describe/overview/crop and binds the returned page", async () => {
    const result = attachmentPdfImageFixture();
    const described = { ...result, status: "described", rendition: null, image: null };
    stubJsonResponse(200, described);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "describe", page: 2 })).toEqual(described);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining("?mode=describe&page=2"), expect.anything());
    stubJsonResponse(200, result);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "overview", page: 2, sourceRevision: result.sourceRevision })).toEqual(result);
    result.rendition!.region = { x: 100, y: 120, width: 160, height: 160 };
    stubJsonResponse(200, result);
    expect(await getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "crop", page: 2, sourceRevision: result.sourceRevision, region: result.rendition!.region })).toEqual(result);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining("&x=100&y=120&width=160&height=160"), expect.anything());
  });

  it.each(["page", "count", "scale", "rotation", "nullRotation", "missing", "extra", "static"])("rejects mismatched PDF %s metadata before releasing pixels", async (fault) => {
    const result = attachmentPdfImageFixture();
    if (fault === "page") result.source!.pdf!.pageNumber = 1;
    if (fault === "count") result.source!.pdf!.pageCount = 1;
    if (fault === "scale") Object.assign(result.source!.pdf!, { pixelsPerPoint: 2 });
    if (fault === "rotation") Object.assign(result.source!.pdf!, { rotation: "90" });
    if (fault === "nullRotation") Object.assign(result.source!.pdf!, { rotation: null });
    if (fault === "missing") delete result.source!.pdf;
    if (fault === "extra") Object.assign(result.source!.pdf!, { extra: "unexpected" });
    if (fault === "static") result.source!.mimeType = "image/png";
    stubJsonResponse(200, result);
    await expect(getLifeLinkAttachmentImage("life-link-1", result.mediaId, { mode: "overview", page: 2, sourceRevision: result.sourceRevision })).rejects.toThrow("Invalid attachment image response.");
  });

  it("normalizes canonical structured errors with bounded metadata", async () => {
    const body = {
      error: {
        code: "stale_life_link",
        message: "Life Link changed after it was read.",
        retryable: true,
        reason: "expected_updated_at_mismatch"
      }
    };
    stubJsonResponse(409, body);

    const error = await rejectedApiError(updateLifeLink(
      "life-link-1",
      "2026-08-25T00:00:00.000Z",
      { title: "Fresh title" }
    ));

    expect(error).toMatchObject({
      status: 409,
      code: "stale_life_link",
      message: "Life Link changed after it was read.",
      retryable: true,
      reason: "expected_updated_at_mismatch",
      body
    });
  });

  it.each(["unordered", "ordered"] as const)("preserves %s ordering, stable identities and steps on Routine create/revise transport", async (ordering) => {
    const signal = new AbortController().signal;
    const input = { id: "routine-stable", revisionId: "revision-stable", title: "Training", ordering,
      steps: [{ id: "step-stable", activityId: "activity-stable", activityTitle: "Prepare", position: 0, plannedValues: [] }] };
    stubJsonResponse(201, { routine: {} });
    await createRoutine(input, signal);
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toEqual(input);
    const { id, ...revision } = input;
    const revised = { ...revision, expectedCurrentRevisionId: "previous-revision" };
    stubJsonResponse(201, { routine: {} });
    await reviseRoutine(id, revised, signal);
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith("/api/routines/routine-stable/revisions", expect.objectContaining({ method: "POST", signal }));
    expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)).toEqual(revised);
  });

  it("carries stable Routine identities, revision guards, typed results and cancellation through the owner client", async () => {
    const abort = new AbortController();
    stubJsonResponse(201, { routine: { routine: { id: "routine-1" }, currentRevision: {} } });
    await createRoutine({
      id: "routine-00000000-0000-4000-8000-000000000001",
      revisionId: "routine-revision-00000000-0000-4000-8000-000000000001",
      title: "Morning reset",
      steps: [{
        id: "routine-step-00000000-0000-4000-8000-000000000001",
        activityId: "activity-00000000-0000-4000-8000-000000000001",
        activityTitle: "Prepare",
        position: 0,
        plannedValues: [{ key: "ready", label: "Ready", kind: "boolean", value: true }]
      }]
    }, abort.signal);
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith("/api/routines", expect.objectContaining({ method: "POST", signal: abort.signal }));

    stubJsonResponse(200, { run: { id: "routine-run-1" } });
    await putRoutineRunStepResult(
      "routine-run/1",
      "routine-step/1",
      {
        expectedUpdatedAt: "2026-09-01T12:00:00.000Z",
        actualValues: [{ key: "ready", label: "Ready", kind: "boolean", value: false }],
        proposedNextValues: [{ key: "ready", label: "Ready", kind: "boolean", value: true }]
      },
      abort.signal
    );
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routine-runs/routine-run%2F1/step-results/routine-step%2F1",
      expect.objectContaining({ method: "PUT", signal: abort.signal })
    );

    stubJsonResponse(200, { occurrences: [], nextCursor: null, truncated: false });
    await listRoutineOccurrences({ routineId: "routine/1", startDate: "2026-09-01", endDate: "2026-09-07", signal: abort.signal });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routine-occurrences?routineId=routine%2F1&startDate=2026-09-01&endDate=2026-09-07",
      expect.objectContaining({ signal: abort.signal })
    );

    stubJsonResponse(200, {
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      routineCount: 2,
      occurrenceCount: 4
    });
    await expect(materializeRoutineOccurrences({
      startDate: "2026-09-01",
      endDate: "2026-09-07",
      signal: abort.signal
    })).resolves.toMatchObject({ routineCount: 2, occurrenceCount: 4 });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routine-occurrences/materialize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ startDate: "2026-09-01", endDate: "2026-09-07" }),
        signal: abort.signal
      })
    );

    stubJsonResponse(200, { routineGroups: [], nextCursor: null, truncated: false });
    await listRoutineGroups({ cursor: "archive page", limit: 10, includeArchived: true, signal: abort.signal });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routine-groups?cursor=archive+page&limit=10&includeArchived=true",
      expect.objectContaining({ signal: abort.signal })
    );
    stubJsonResponse(200, { routines: [], nextCursor: null, truncated: false });
    await listRoutines({ includeArchived: false, signal: abort.signal });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routines?includeArchived=false",
      expect.objectContaining({ signal: abort.signal })
    );
    stubJsonResponse(200, { run: null });
    expect(await getActiveRoutineRun("routine/1", abort.signal)).toEqual({ run: null });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/api/routines/routine%2F1/active-run",
      expect.objectContaining({ signal: abort.signal })
    );
  });

  it("surfaces stale Routine conflicts as retryable without changing the caller's stable command", async () => {
    const body = { error: { code: "stale_routine", message: "Routine state changed after it was read.", retryable: true } };
    stubJsonResponse(409, body);
    const error = await rejectedApiError(finalizeRoutineRun(
      "routine-run-00000000-0000-4000-8000-000000000001",
      { sessionId: "routine-session-00000000-0000-4000-8000-000000000001", expectedUpdatedAt: "2026-09-01T12:00:00.000Z" }
    ));
    expect(error).toMatchObject({ status: 409, code: "stale_routine", retryable: true, body });
  });

  it("normalizes the claim cross-owner outcome into a stable ApiError", async () => {
    const body = {
      result: "owned_by_other",
      state: { state: "private", qrId: "LL-DEMO-00001" }
    };
    stubJsonResponse(409, body);

    const error = await rejectedApiError(attachQr(
      "LL-DEMO-00001",
      "life-link-1",
      "attach-command-1"
    ));

    expect(error).toMatchObject({
      status: 409,
      code: "owned_by_other",
      message: "That QR code is already claimed by another account.",
      retryable: false,
      reason: undefined,
      body
    });
  });

  it("preserves successful attach decoding and request shape", async () => {
    const body = {
      result: "already_owned",
      state: { state: "claimed", link: { id: "LL-DEMO-00001" }, viewerIsOwner: true }
    };
    const fetchMock = stubJsonResponse(200, body);

    await expect(attachQr("LL-DEMO-00001", "life-link-1", "attach-command-1")).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/qr/LL-DEMO-00001/claim", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        commandId: "attach-command-1",
        mode: "attach",
        lifeLinkId: "life-link-1"
      })
    });
  });

  it("connects and disconnects through the one durable agent-connection resource", async () => {
    const connected = {
      agentConnection: {
        connected: true,
        connectedAt: "2026-08-27T21:00:00.000Z",
        toolCatalogId: "life-links-calendar-v2"
      }
    };
    const disconnected = {
      agentConnection: {
        connected: false,
        connectedAt: null,
        toolCatalogId: null
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, connected))
      .mockResolvedValueOnce(jsonResponse(200, disconnected));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAgent("life-links-calendar-v2")).resolves.toEqual(connected);
    await expect(disconnectAgent()).resolves.toEqual(disconnected);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/agent-connection", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      body: JSON.stringify({ toolCatalogId: "life-links-calendar-v2" })
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/agent-connection", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "DELETE"
    });
  });

  it("uses the canonical paged Collection and membership resources, including Section continuation", async () => {
    const fetchMock = stubJsonResponse(200, {});
    await listCollections({ cursor: "next/page", limit: 25 });
    await getCollection("collection-1", { cursor: "section/page", limit: 10 });
    await listCollectionMembers("collection-1", { cursor: "member/page" });
    await listLifeLinkCollectionMemberships("life-link/1", { limit: 50 });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/collections?cursor=next%2Fpage&limit=25",
      "/api/collections/collection-1?cursor=section%2Fpage&limit=10",
      "/api/collections/collection-1/members?cursor=member%2Fpage",
      "/api/life-links/life-link%2F1/collection-memberships?limit=50"
    ]);
  });

  it("requests bounded member enrichment explicitly without changing legacy member calls", async () => {
    const response = { lifeLinks: [], membershipPages: {}, nextCursor: null, truncated: false };
    const fetchMock = stubJsonResponse(200, response);
    const abort = new AbortController();
    await expect(listCollectionMembers("collection/1", { includeMemberships: true, signal: abort.signal })).resolves.toEqual(response);
    await listCollectionMembers("collection/1", { cursor: "members/page", limit: 10, includeMemberships: true });
    await listCollectionMembers("collection/1", { includeMemberships: false });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/collections/collection%2F1/members?include=memberships",
      "/api/collections/collection%2F1/members?cursor=members%2Fpage&limit=10&include=memberships",
      "/api/collections/collection%2F1/members"
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: abort.signal, credentials: "include" });
  });

  it("preserves stable creation IDs, exact revisions and complete assignment replacement payloads", async () => {
    const fetchMock = stubJsonResponse(200, {});
    await createLifeLink({ id: "life-link-1", parentId: "parent-1", browsingRole: "container", title: "Tub" });
    await createCollection({ id: "collection-1", title: "Camping", purpose: "Trips", notes: "Notes" });
    await updateCollection("collection-1", "revision-1", { title: "Camping Gear" });
    await createCollectionSection("collection-1", "revision-2", { id: "section-1", title: "Sleep" });
    await updateCollectionSection("collection-1", "section-1", "revision-3", "Sleeping gear");
    await addCollectionMember("collection-1", "life-link-1", "revision-4");
    await replaceCollectionSectionAssignments("collection-1", "life-link-1", "revision-5", ["section-1", "section-2"]);
    await removeCollectionMember("collection-1", "life-link-1", "revision-6");
    await removeCollectionSection("collection-1", "section-1", "revision-7");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path, init]) => [path, init.method, JSON.parse(String(init.body))])).toEqual([
      ["/api/life-links", "POST", { id: "life-link-1", parentId: "parent-1", browsingRole: "container", title: "Tub" }],
      ["/api/collections", "POST", { id: "collection-1", title: "Camping", purpose: "Trips", notes: "Notes" }],
      ["/api/collections/collection-1", "PATCH", { title: "Camping Gear", expectedUpdatedAt: "revision-1" }],
      ["/api/collections/collection-1/sections", "POST", { id: "section-1", title: "Sleep", expectedUpdatedAt: "revision-2" }],
      ["/api/collections/collection-1/sections/section-1", "PATCH", { title: "Sleeping gear", expectedUpdatedAt: "revision-3" }],
      ["/api/collections/collection-1/members/life-link-1", "PUT", { expectedUpdatedAt: "revision-4" }],
      ["/api/collections/collection-1/members/life-link-1/sections", "PUT", { sectionIds: ["section-1", "section-2"], expectedUpdatedAt: "revision-5" }],
      ["/api/collections/collection-1/members/life-link-1", "DELETE", { expectedUpdatedAt: "revision-6" }],
      ["/api/collections/collection-1/sections/section-1", "DELETE", { expectedUpdatedAt: "revision-7" }]
    ]);
  });

  it("uses exact native Calendar identities, bounded windows and revision-safe mutation payloads", async () => {
    const fetchMock = stubJsonResponse(200, {});
    const signal = new AbortController().signal;
    const calendarId = "calendar-00000000-0000-4000-8000-000000000001";
    const eventId = "calendar-event-00000000-0000-4000-8000-000000000001";
    const revisionId = "calendar-event-revision-00000000-0000-4000-8000-000000000001";
    const nextRevisionId = "calendar-event-revision-00000000-0000-4000-8000-000000000002";
    const tombstoneId = "calendar-event-tombstone-00000000-0000-4000-8000-000000000001";
    const span = { kind: "all_day" as const, startDate: "2026-08-01", endDateExclusive: "2026-08-02" };
    const recurrence = {
      frequency: "weekly" as const,
      interval: 1,
      weekdays: ["saturday" as const],
      end: { kind: "count" as const, count: 8 }
    };
    const target = { scope: "series" as const, masterEventId: eventId };

    await getCalendarClock("America/New_York", signal);
    await listCalendars({ cursor: "calendar/page", limit: 12, includeDeleted: true, signal });
    await createCalendar({ id: calendarId, title: "Personal", timeZone: "America/New_York", isDefault: true }, signal);
    await getCalendar(calendarId, signal);
    await updateCalendar(calendarId, "2026-09-01T00:00:00.000Z", { title: "Home" }, signal);
    await deleteCalendar(calendarId, "2026-09-01T00:00:01.000Z", signal);
    await restoreCalendar(calendarId, "2026-09-01T00:00:02.000Z", signal);
    await listCalendarEvents({
      startDate: "2026-08-01", endDate: "2026-08-31", calendarId, includeDeleted: false, limit: 50, signal
    });
    await createCalendarEvent({
      id: eventId,
      revisionId,
      calendarId,
      lineage: { kind: "recurrence_master" },
      title: "Weekly planning",
      span,
      recurrence,
      subjectLinks: [
        { kind: "routine", routineId: "routine-00000000-0000-4000-8000-000000000001" },
        { kind: "life_link", lifeLinkId: "life-link-00000000-0000-4000-8000-000000000001" },
        { kind: "collection", collectionId: "collection-00000000-0000-4000-8000-000000000001" }
      ]
    }, signal);
    await getCalendarEvent(eventId, signal);
    await updateCalendarEvent(eventId, {
      revisionId: nextRevisionId,
      expectedCurrentRevisionId: revisionId,
      target,
      title: "Weekly planning",
      span,
      recurrence,
      subjectLinks: []
    }, signal);
    await deleteCalendarEvent(eventId, { tombstoneId, expectedCurrentRevisionId: nextRevisionId, target }, signal);
    await restoreCalendarEvent(eventId, { tombstoneId, expectedCurrentRevisionId: nextRevisionId }, signal);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([path, init]) => [path, init.method ?? "GET", init.body ? JSON.parse(String(init.body)) : null]))
      .toEqual([
        ["/api/calendar-clock?timeZone=America%2FNew_York", "GET", null],
        ["/api/calendars?cursor=calendar%2Fpage&limit=12&includeDeleted=true", "GET", null],
        ["/api/calendars", "POST", { id: calendarId, title: "Personal", timeZone: "America/New_York", isDefault: true }],
        [`/api/calendars/${calendarId}`, "GET", null],
        [`/api/calendars/${calendarId}`, "PATCH", { title: "Home", expectedUpdatedAt: "2026-09-01T00:00:00.000Z" }],
        [`/api/calendars/${calendarId}`, "DELETE", { expectedUpdatedAt: "2026-09-01T00:00:01.000Z" }],
        [`/api/calendars/${calendarId}/restore`, "POST", { expectedUpdatedAt: "2026-09-01T00:00:02.000Z" }],
        [`/api/calendar-events?startDate=2026-08-01&endDate=2026-08-31&limit=50&calendarId=${calendarId}&includeDeleted=false`, "GET", null],
        ["/api/calendar-events", "POST", {
          id: eventId, revisionId, calendarId, lineage: { kind: "recurrence_master" }, title: "Weekly planning", span,
          recurrence, subjectLinks: [
            { kind: "routine", routineId: "routine-00000000-0000-4000-8000-000000000001" },
            { kind: "life_link", lifeLinkId: "life-link-00000000-0000-4000-8000-000000000001" },
            { kind: "collection", collectionId: "collection-00000000-0000-4000-8000-000000000001" }
          ]
        }],
        [`/api/calendar-events/${eventId}`, "GET", null],
        [`/api/calendar-events/${eventId}`, "PATCH", {
          revisionId: nextRevisionId, expectedCurrentRevisionId: revisionId, target, title: "Weekly planning", span,
          recurrence, subjectLinks: []
        }],
        [`/api/calendar-events/${eventId}`, "DELETE", { tombstoneId, expectedCurrentRevisionId: nextRevisionId, target }],
        [`/api/calendar-events/${eventId}/restore`, "POST", { tombstoneId, expectedCurrentRevisionId: nextRevisionId }]
      ]);
    for (const [, init] of calls) expect(init.signal).toBe(signal);
  });

  it("sets and clears QR bindings with exact command identity instead of changing identity in the client", async () => {
    const fetchMock = stubJsonResponse(200, {});
    await setLifeLinkQrBinding("life-link-1", "LL-DEMO-00001", "revision-1", "set-1");
    await clearLifeLinkQrBinding("life-link-1", "revision-2", "clear-1");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/life-links/life-link-1/qr-binding", expect.objectContaining({
      method: "PUT", body: JSON.stringify({ commandId: "set-1", qrId: "LL-DEMO-00001", expectedUpdatedAt: "revision-1" })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/life-links/life-link-1/qr-binding", expect.objectContaining({
      method: "DELETE", body: JSON.stringify({ commandId: "clear-1", expectedUpdatedAt: "revision-2" })
    }));
  });

  it("forwards the caller cancellation signal through shared Field Ledger commands", async () => {
    const fetchMock = stubJsonResponse(200, {});
    const signal = new AbortController().signal;
    const options = { signal };
    await createLifeLink({ id: "life-link-1", parentId: null, browsingRole: "item", title: "Item" }, options);
    await moveLifeLink("life-link-1", null, "revision", options);
    await updateLifeLink("life-link-1", "revision", { context: { schemaVersion: 1 } }, options);
    await setLifeLinkQrBinding("life-link-1", "LL-TEST", "revision", "command-1", options);
    await clearLifeLinkQrBinding("life-link-1", "revision", "command-2", options);
    await createCollection({ id: "collection-1", title: "Kit" }, options);
    await updateCollection("collection-1", "revision", { title: "Kit" }, options);
    await addCollectionMember("collection-1", "life-link-1", "revision", options);
    await removeCollectionMember("collection-1", "life-link-1", "revision", options);
    await createCollectionSection("collection-1", "revision", { id: "section-1", title: "Section" }, options);
    await updateCollectionSection("collection-1", "section-1", "revision", "Section", options);
    await removeCollectionSection("collection-1", "section-1", "revision", options);
    await replaceCollectionSectionAssignments("collection-1", "life-link-1", "revision", [], options);
    expect(fetchMock).toHaveBeenCalledTimes(13);
    for (const [, init] of fetchMock.mock.calls) expect(init?.signal).toBe(signal);
  });
});

function stubJsonResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(status, body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function rejectedApiError(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Expected API request to reject");
}
