import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError, addCollectionMember, attachQr, clearLifeLinkQrBinding, connectAgent, createCollection,
  createRoutine, finalizeRoutineRun,
  createCollectionSection, createLifeLink, disconnectAgent, getCollection, listCollections,
  getActiveRoutineRun, listRoutineGroups, listRoutines,
  listCollectionMembers, listLifeLinkCollectionMemberships, login, moveLifeLink, removeCollectionMember,
  removeCollectionSection, replaceCollectionSectionAssignments, setLifeLinkQrBinding,
  updateCollection, updateCollectionSection, updateLifeLink, getLifeLinkAttachmentContent, getLifeLinkAttachmentImage,
  listRoutineOccurrences, putRoutineRunStepResult
} from "./api";
import { ATTACHMENT_IMAGE_MAX_BASE64_CHARS, ATTACHMENT_IMAGE_MAX_BYTES } from "@life-links/core";
import { attachmentImageFixture, attachmentPdfImageFixture, attachmentSelectedImageFixture, attachmentTranscriptFixture } from "./attachmentImage.testFixtures";

describe("Life Links API error normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        connectedAt: "2026-08-27T21:00:00.000Z"
      }
    };
    const disconnected = {
      agentConnection: {
        connected: false,
        connectedAt: null
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, connected))
      .mockResolvedValueOnce(jsonResponse(200, disconnected));
    vi.stubGlobal("fetch", fetchMock);

    await expect(connectAgent()).resolves.toEqual(connected);
    await expect(disconnectAgent()).resolves.toEqual(disconnected);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/agent-connection", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PUT"
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
