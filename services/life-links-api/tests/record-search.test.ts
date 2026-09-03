import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_QR_BASE_URL, DEMO_PASSWORD, type RecordSearchCategory, type RecordSearchHit, type ProviderEventContent } from "@life-links/core";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { RecordSearchService } from "../src/record-search.js";
import { AttachmentContentReader } from "../src/attachment-content.js";
import { createLifeLinksApp } from "../src/server.js";
import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent } from "../src/logger.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";

const OWNER = "demo-owner";
const WHEN = "2026-09-02T10:00:00.000Z";
const id = (kind: string, n: number) => `${kind}-99999999-9999-4999-8999-${String(n).padStart(12, "0")}`;
async function canonical() { const store = new InMemoryLifeLinksStore(); await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL); return store; }
async function all(service: RecordSearchService, q: string, category: RecordSearchCategory, actor: "human" | "agent" = "human") {
  let cursor: string | null = null;
  const hits: RecordSearchHit[] = [];
  for (let pages = 0; pages < 50; pages++) {
    const page = await service.search(OWNER, { q, category, cursor, limit: 1 }, { actor });
    expect(page.results.length).toBeLessThanOrEqual(1);
    expect(page.scanned).toBeLessThanOrEqual(30);
    hits.push(...page.results); cursor = page.nextCursor;
    if (!cursor) return hits;
  }
  throw new Error("Search failed to make progress through a finite test fixture.");
}

async function routine(store: InMemoryLifeLinksStore) {
  const activity = await store.createActivity({ id: id("activity", 1), ownerId: OWNER, title: "Needle step", notes: "", createdAt: WHEN });
  return store.createRoutine({ id: id("routine", 1), ownerId: OWNER, revisionId: id("routine-revision", 1), title: "Original plan",
    purpose: "Purpose only word", instructions: "Before revising", createdAt: WHEN,
    steps: [{ id: id("routine-step", 1), activityId: activity.id, activityTitle: "Needle step", position: 0,
      instructions: "Controlled tempo", plannedValues: [{ key: "note", label: "Plan", kind: "text", text: "Default-only phrase" }] }] });
}

describe("bounded whole-app record search", () => {
  it("continues past empty scan pages and preserves exact section targets, purpose and notes", async () => {
    const store = await canonical();
    for (let n = 1; n <= 35; n++) await store.createCollection({ id: id("collection", n), ownerId: OWNER,
      title: `Collection ${String(n).padStart(2, "0")}`, purpose: n === 34 ? "needle purpose" : "", notes: n === 35 ? "needle notes" : "", createdAt: WHEN });
    const collectionId = id("collection", 35);
    const sectionId = id("section", 1);
    await store.createCollectionSection(OWNER, { id: sectionId, collectionId, title: "Needle section",
      expectedUpdatedAt: (await store.getCollection(OWNER, collectionId))!.updatedAt });
    const service = new RecordSearchService(store);
    const first = await service.search(OWNER, { q: "needle", category: "collections", limit: 1 });
    expect(first.results).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const longQuery = "x".repeat(2048);
    const longPage = await service.search(OWNER, { q: longQuery, category: "collections", limit: 1 });
    expect(longPage.nextCursor).not.toBeNull();
    expect(longPage.nextCursor!.length).toBeLessThan(2048);
    expect(Buffer.from(longPage.nextCursor!, "base64url").toString("utf8")).not.toContain(longQuery);
    expect((await service.search(OWNER, { q: longQuery, category: "collections", cursor: longPage.nextCursor })).scanned).toBeGreaterThan(0);
    const hits = await all(service, "needle", "collections");
    expect(hits.map((hit) => hit.matchedField)).toEqual(["purpose", "notes", "section_title"]);
    expect(hits[2]!.reference).toEqual({ kind: "collection", collectionId, sectionId });
    await expect(service.search("other-owner", { q: "needle", category: "collections", cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid_record_search_cursor" });
    await expect(service.search(OWNER, { q: "different", category: "collections", cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid_record_search_cursor" });
    await expect(service.search(OWNER, { q: "needle", category: "routines", cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid_record_search_cursor" });
    expect((await service.search("other-owner", { q: "needle", category: "collections" })).results).toEqual([]);
  });

  it("finds current step defaults and archived Session history using its exact recorded revision and corrections", async () => {
    const store = await canonical();
    const created = await routine(store);
    const service = new RecordSearchService(store);
    const current = await all(service, "default-only", "routines");
    expect(current[0]!.reference).toEqual({ kind: "routine", routineId: created.routine.id,
      routineRevisionId: created.currentRevision.revision.id, routineStepId: created.currentRevision.steps[0]!.id });
    const run = (await store.startRoutineRun(OWNER, { id: id("routine-run", 1), routineId: created.routine.id, startedAt: WHEN }))!;
    const filled = (await store.putRoutineRunStepResult(OWNER, { runId: run.id, routineStepId: created.currentRevision.steps[0]!.id,
      expectedUpdatedAt: run.updatedAt, actualValues: [{ key: "note", label: "Plan", kind: "text", text: "Original-only actual" }],
      proposedNextValues: [], notes: "Outcome note" }))!;
    const built = (await store.finalizeRoutineRun(OWNER, { runId: run.id, sessionId: id("routine-session", 1),
      expectedUpdatedAt: filled.updatedAt, completedAt: "2026-09-02T11:00:00.000Z" }))!;
    await store.appendRoutineSessionAmendment(OWNER, { id: id("routine-session-amendment", 1), sessionId: built.session.id,
      stepResultId: built.stepResults[0]!.id, note: "Amendment-only explanation", correctedActualValues: [{ key: "note", label: "Plan", kind: "text", text: "Corrected-only actual" }],
      createdAt: "2026-09-02T12:00:00.000Z" });
    await store.reviseRoutine(OWNER, { id: id("routine-revision", 2), ownerId: OWNER, routineId: created.routine.id,
      expectedCurrentRevisionId: created.currentRevision.revision.id, revisionNumber: 2, title: "Future plan", steps: [], createdAt: "2026-09-02T13:00:00.000Z" });
    const latest = (await store.getRoutine(OWNER, created.routine.id))!;
    await store.updateRoutine(OWNER, { routineId: created.routine.id, expectedUpdatedAt: latest.routine.updatedAt, patch: { archivedAt: "2026-09-02T14:00:00.000Z" } });
    expect(await all(service, "needle", "routines")).toEqual([]);
    for (const query of ["needle", "original-only", "corrected-only", "amendment-only"]) {
      const history = await all(service, query, "history");
      expect(history).toHaveLength(1);
      expect(history[0]!.title).toBe("Original plan");
      expect(history[0]!.reference).toEqual({ kind: "session", routineId: created.routine.id,
        sessionId: built.session.id, routineRevisionId: created.currentRevision.revision.id });
    }
  });

  it("requires v4, rechecks revocation after reads and retains the old physical search path", async () => {
    const store = await canonical();
    await routine(store);
    const service = new RecordSearchService(store);
    for (const catalog of ["life-links-page-webmcp-v1", "life-links-calendar-v2", "life-links-workspace-v3"] as const) {
      await store.connectAgent(OWNER, catalog);
      await expect(service.search(OWNER, { q: "purpose", category: "routines" }, { actor: "agent" })).rejects.toMatchObject({ status: 403 });
    }
    await store.connectAgent(OWNER, "life-links-search-v4");
    expect(await all(service, "purpose", "routines", "agent")).toHaveLength(1);
    const original = store.getRoutine.bind(store);
    vi.spyOn(store, "getRoutine").mockImplementationOnce(async (...args) => {
      const result = await original(...args); await store.disconnectAgent(OWNER); return result;
    });
    await expect(service.search(OWNER, { q: "purpose", category: "routines" }, { actor: "agent" })).rejects.toMatchObject({ status: 403 });
    const physical = vi.spyOn(store, "searchLifeLinks");
    await service.search(OWNER, { q: "Basement", category: "life_links", limit: 2 });
    expect(physical).toHaveBeenCalledWith(OWNER, "basement", expect.objectContaining({ limit: 2 }));
  });

  it("bounds snippets without splitting a Unicode pair and refuses malformed input", async () => {
    const store = await canonical();
    await store.createCollection({ id: id("collection", 1), ownerId: OWNER, title: "Private", purpose: "", notes: `${"x".repeat(200)}😀 needle ${"y".repeat(1000)}`, createdAt: WHEN });
    const page = await new RecordSearchService(store).search(OWNER, { q: "needle", category: "collections" });
    expect(page.results[0]!.snippet).toContain("needle");
    expect(page.results[0]!.snippet.length).toBeLessThanOrEqual(240);
    expect(page.results[0]!.snippet).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    for (const input of [{ q: "", category: "routines" }, { q: "a", category: "routines", limit: 26 }, { q: "a", category: "routines", cursor: "!" }]) {
      await expect(new RecordSearchService(store).search(OWNER, input as Parameters<RecordSearchService["search"]>[1])).rejects.toMatchObject({ status: 400 });
    }
  });

  it("selects the same NFKC-compatible context field as canonical physical search without rewriting its text", async () => {
    const store = await canonical();
    const text = "Recorded ＥＮＥＲＧＹ level was comfortable.";
    const lifeLink = await store.createLifeLink({ id: id("life-link", 82), ownerId: OWNER, title: "Trip note", privacy: "private", createdAt: WHEN,
      context: { schemaVersion: 1, summary: { text: "Unrelated summary", truthState: "owner_reported" },
        experience: { text, truthState: "owner_reported" } } });
    const service = new RecordSearchService(store);
    for (const q of ["energy", "ＥＮＥＲＧＹ"]) {
      const result = await service.search(OWNER, { q, category: "life_links" });
      const hit = result.results.find((item) => item.reference.kind === "life_link" && item.reference.lifeLinkId === lifeLink.id);
      expect(hit).toMatchObject({ matchedField: "context", snippet: text });
    }
  });

  it("searches complete attachment text in two-file pages and keeps filename discovery when extraction is unavailable", async () => {
    const store = await canonical();
    const lifeLink = await store.createLifeLink({ id: id("life-link", 80), ownerId: OWNER, title: "Documents", privacy: "private", createdAt: WHEN });
    for (let n = 0; n < 3; n++) {
      const data = Buffer.from(`${"Not a match. ".repeat(1000)}Deep-needle-${n}`);
      await store.createLifeLinkMedia(OWNER, lifeLink.id, { kind: "document", mimeType: "text/plain", fileName: `deep-needle-${n}.txt`, sizeBytes: data.length, data });
    }
    const reader = new AttachmentContentReader();
    const read = vi.spyOn(reader, "search");
    const service = new RecordSearchService(store, undefined, reader);
    let cursor: string | null = null;
    const hits: RecordSearchHit[] = [];
    do {
      const before = read.mock.calls.length;
      const page = await service.search(OWNER, { q: "deep-needle", category: "attachments", cursor, limit: 25 });
      expect(read.mock.calls.length - before).toBeLessThanOrEqual(2);
      hits.push(...page.results); cursor = page.nextCursor;
    } while (cursor);
    expect(hits).toHaveLength(3);
    expect(hits.every((hit) => hit.reference.kind === "attachment" && (hit.reference.offset ?? 0) > 4000)).toBe(true);
    const unavailable = new RecordSearchService(store, undefined, { search: async () => { throw new Error("private extractor diagnostic"); } });
    const names = await all(unavailable, "deep-needle", "attachments");
    expect(names).toHaveLength(3); expect(names.every((hit) => hit.matchedField === "file_name")).toBe(true);
  });

  it("withholds extracted contents when the same attachment identity changes during extraction or final readback", async () => {
    for (const replaceAt of ["extraction", "release"] as const) {
      const store = await canonical();
      const lifeLink = await store.createLifeLink({ id: id("life-link", 81), ownerId: OWNER, title: "Documents", privacy: "private", createdAt: WHEN });
      const data = Buffer.from("Private source needle");
      const media = (await store.createLifeLinkMedia(OWNER, lifeLink.id, { kind: "document", mimeType: "text/plain", fileName: "source.txt", sizeBytes: data.length, data }))!;
      const getFile = store.getLifeLinkMedia.bind(store);
      let replaced = false;
      let afterExtractionReads = 0;
      vi.spyOn(store, "getLifeLinkMedia").mockImplementation(async (...args) => {
        const file = await getFile(...args);
        if (!file || args[2] !== media.id) return file;
        if (replaced && (replaceAt === "extraction" || ++afterExtractionReads > 1)) return { ...file, data: Buffer.from("Replacement private content") };
        return file;
      });
      const reader = new AttachmentContentReader();
      const extract = reader.search.bind(reader);
      vi.spyOn(reader, "search").mockImplementation(async (...args) => { const result = await extract(...args); replaced = true; return result; });
      expect(await all(new RecordSearchService(store, undefined, reader), "needle", "attachments")).toEqual([]);
    }
  });

  it("searches only current undeleted native events and honors none/read permissions independently of UI visibility", async () => {
    const store = await canonical();
    const calendar = await store.createCalendar({ id: id("calendar", 50), ownerId: OWNER, title: "Local", timeZone: "UTC", agentAccess: "read", createdAt: WHEN });
    const created = await store.createCalendarEvent({ id: id("calendar-event", 50), ownerId: OWNER, calendarId: calendar.id,
      revisionId: id("calendar-event-revision", 50), title: "Native needle", description: "History-only phrase", location: "Current location",
      span: { kind: "all_day", startDate: "2020-01-01", endDateExclusive: "2020-01-02" }, createdAt: WHEN });
    const service = new RecordSearchService(store);
    const hit = (await all(service, "needle", "calendar"))[0]!;
    expect(hit.reference).toEqual({ kind: "calendar_event", authority: "native", calendarId: calendar.id, eventId: created.event.id });
    await store.connectAgent(OWNER, "life-links-search-v4");
    expect(await all(service, "needle", "calendar", "agent")).toHaveLength(1);
    await store.updateCalendar(OWNER, { calendarId: calendar.id, expectedUpdatedAt: calendar.updatedAt, patch: { agentAccess: "none" } });
    expect(await all(service, "needle", "calendar", "agent")).toEqual([]);
    expect(await all(service, "needle", "calendar")).toHaveLength(1);
  });
});

async function calendarFixture() {
  const store = await canonical();
  const providerStore = new InMemoryCalendarProviderStateStore();
  const calendarId = id("calendar", 70);
  const content: ProviderEventContent = { title: "Google needle", description: "Provider private notes", location: null,
    span: { kind: "all_day", startDate: "2026-09-02", endDateExclusive: "2026-09-03" }, status: "confirmed", providerSeriesId: null };
  const adapter = new DeterministicFakeCalendarProviderAdapter("test-provider", "test-account", [{ providerCalendarId: "remote-calendar", displayName: "Test Calendar",
    capabilities: { read: true, create: true, update: true, delete: true }, events: [
      { providerEventId: "event-a", providerRevision: "r1", content },
      { providerEventId: "event-b", providerRevision: "r1", content: { ...content, title: "Outlook needle" } }
    ] }]);
  const gateway = new CalendarProviderGateway([adapter], providerStore);
  await gateway.connectExternalAccount({ ownerId: OWNER, connectionId: "search-test-connection", providerKey: "test-provider", expectedProviderAccountId: "test-account",
    credentialHandle: calendarProviderCredentialHandle("private-test-reference"), calendars: [{ calendarId, providerCalendarId: "remote-calendar", title: "Linked Calendar", color: "#336699", timeZone: "UTC", isDefault: false, agentGrant: "read", visible: false }],
    initialWindow: { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-09-03T00:00:00.000Z" } });
  // Production shares canonical Calendar rows; mirror only that existing boundary
  // in the separate deterministic gateway store used by this provider-free test.
  const listCalendars = store.listCalendars.bind(store);
  const getCalendar = store.getCalendar.bind(store);
  vi.spyOn(store, "listCalendars").mockImplementation(async (owner, page, actor) => {
    if (owner !== OWNER) return listCalendars(owner, page, actor);
    const calendar = (await providerStore.getCanonicalCalendar(calendarId))!;
    return { items: !calendar.deletedAt && (actor !== "agent" || calendar.agentAccess !== "none") ? [calendar] : [], nextCursor: null, truncated: false };
  });
  vi.spyOn(store, "getCalendar").mockImplementation(async (owner, target, actor) => target === calendarId && owner === OWNER
    ? providerStore.getCanonicalCalendar(target) : getCalendar(owner, target, actor));
  return { store, providerStore, gateway, adapter, calendarId, service: new RecordSearchService(store, gateway) };
}

describe("record search Calendar cache and HTTP boundaries", () => {
  it("pages real cached projections without provider calls, includes hidden overlays and excludes revoked access", async () => {
    const ctx = await calendarFixture();
    const fetch = vi.spyOn(ctx.adapter, "fetchChanges");
    const read = vi.spyOn(ctx.adapter, "readEvent");
    const hits = await all(ctx.service, "needle", "calendar");
    expect(hits.map((hit) => hit.title)).toEqual(["Google needle", "Outlook needle"]);
    expect(hits[0]!.reference).toEqual({ kind: "calendar_event", authority: "provider", connectionId: "search-test-connection", calendarId: ctx.calendarId, providerEventId: "event-a" });
    expect(fetch).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await ctx.store.connectAgent(OWNER, "life-links-search-v4");
    expect(await all(ctx.service, "needle", "calendar", "agent")).toHaveLength(2);
    const original = ctx.gateway.pageCalendarProjections.bind(ctx.gateway);
    vi.spyOn(ctx.gateway, "pageCalendarProjections").mockImplementationOnce(async (...args) => {
      const page = await original(...args);
      await ctx.gateway.setCalendarAgentGrant({ ownerId: OWNER, connectionId: "search-test-connection", calendarId: ctx.calendarId, agentGrant: "none",
        expectedUpdatedAt: (await ctx.providerStore.getCanonicalCalendar(ctx.calendarId))!.updatedAt });
      return page;
    });
    expect((await ctx.service.search(OWNER, { q: "needle", category: "calendar", limit: 1 }, { actor: "agent" })).results).toEqual([]);
    await ctx.gateway.disconnectConnection({ ownerId: OWNER, connectionId: "search-test-connection", localProjectionDisposition: "retain_private_stale" });
    expect(await all(ctx.service, "needle", "calendar")).toEqual([]);
  });

  it("requires an owner session, validates input, and emits no query or content in structured logs", async () => {
    const store = await canonical();
    await routine(store);
    const logs: LogEvent[] = [];
    const app = createLifeLinksApp({ store, config: readConfig({ NODE_ENV: "test", LIFE_LINKS_STORE: "memory", SESSION_SECRET: "record-search-test-secret", QR_BASE_URL: DEFAULT_QR_BASE_URL, COOKIE_SECURE: "false" }),
      logger: createLogger("record_search_test", { env: "ci", sink: (event) => logs.push(event) }) });
    expect((await request(app).get("/api/records/search").query({ q: "purpose", category: "routines" })).status).toBe(401);
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: (await store.getUserById(OWNER))!.email, password: DEMO_PASSWORD })).status).toBe(200);
    const result = await agent.get("/api/records/search").query({ q: "Purpose only word", category: "routines" });
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body.results).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain("Purpose only word");
    expect(JSON.stringify(logs)).not.toContain("Original plan");
    expect((await agent.get("/api/records/search").query({ q: "a", category: "bogus" })).status).toBe(400);
    expect((await agent.get("/api/records/search").query({ q: "a", category: "routines", limit: 26 })).status).toBe(400);
    expect((await agent.get("/api/records/search").set("X-Life-Links-Actor", "agent").query({ q: "purpose", category: "routines" })).status).toBe(403);
    await store.connectAgent(OWNER, "life-links-search-v4");
    expect((await agent.get("/api/records/search").set("X-Life-Links-Actor", "agent").query({ q: "purpose", category: "routines" })).status).toBe(200);
  });
});
