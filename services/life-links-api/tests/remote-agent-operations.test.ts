import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { DEFAULT_QR_BASE_URL, DEMO_PASSWORD } from "@life-links/core";
import { InMemoryLifeLinksStore } from "../src/store.js";
import { createRemoteAgentOperations } from "../src/remote-agent-operations.js";
import { RecordSearchService } from "../src/record-search.js";
import { AttachmentContentReader, attachmentSourceRevision } from "../src/attachment-content.js";
import { RemoteAgentState, PersistentRemoteApprovals } from "../src/remote-agent-state.js";
import { REMOTE_AGENT_SCOPES, RemoteAgentAccessError, assertRemoteScope, runWithRemoteAgentPrincipal, type RemoteOperationContext } from "../src/remote-agent-principal.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";

const OWNER = "demo-owner";
const id = (kind: string) => `${kind}-${randomUUID()}`;
const at = "2026-09-03T12:00:00.000Z";
const decode = (response: any) => response.structuredContent.data;
async function harness() {
  const store = new InMemoryLifeLinksStore(); await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
  const state = new RemoteAgentState("remote-operation-private-fixture-key-not-a-provider-credential");
  const approvals = new PersistentRemoteApprovals(state);
  const reader = new AttachmentContentReader();
  const search = new RecordSearchService(store, undefined, reader);
  let live = true; let tick = 0;
  const context: RemoteOperationContext = {
    ownerId: OWNER, clientId: "client-test", grantId: "grant-test", scopes: [...REMOTE_AGENT_SCOPES], expiresAt: Date.now() + 3600000,
    approvals, requestConfirmation: vi.fn(async () => true),
    async authorize(input) {
      if (!live) throw new RemoteAgentAccessError("remote_agent_access_denied");
      assertRemoteScope(this, input);
      if (input.calendarId) {
        const calendar = await store.getCalendar(OWNER, input.calendarId, "agent");
        if (!calendar || calendar.agentAccess === "none" || input.write && calendar.agentAccess !== "write") throw new RemoteAgentAccessError();
      }
    }
  };
  const deps = { store, recordSearch: search, attachmentReader: reader, now: () => new Date(Date.parse(at) + tick++ * 1000).toISOString() };
  let operations = createRemoteAgentOperations(deps);
  const execute = (name: string, input: unknown, selected = context) => runWithRemoteAgentPrincipal(selected,
    () => operations.find((operation) => operation.name === name)!.execute(input, selected));
  const call = async (name: string, input: unknown, selected = context) => decode(await execute(name, input, selected));
  return { store, state, approvals, reader, context, deps, execute, call, revoke: () => { live = false; },
    resetOperations: (next = deps) => { operations = createRemoteAgentOperations(next); } };
}

describe("remote MCP semantic operations", () => {
  it("adds bounded membership reads without changing tool names, annotations or default physical and Collection results", async () => {
    const h = await harness();
    const operations = createRemoteAgentOperations(h.deps);
    expect(operations.map(operation => operation.name).sort()).toEqual([
      "apply_change", "create_calendar_event", "inspect_calendar_event", "inspect_collection", "inspect_record", "inspect_routine",
      "list_calendars", "list_collections", "list_records", "list_routines", "maintain_collection", "maintain_record", "maintain_routine",
      "manage_record_qr", "prepare_change", "query_calendar", "read_attachment", "read_attachment_image", "record_routine_run",
      "routine_history", "routine_schedule", "search_records", "update_calendar_event"
    ]);
    for (const name of ["inspect_record", "inspect_collection"]) {
      expect(operations.find(operation => operation.name === name)).toMatchObject({ readOnly: true, destructive: false, idempotent: true });
    }
    const recordTool = operations.find(operation => operation.name === "inspect_record")!;
    const collectionTool = operations.find(operation => operation.name === "inspect_collection")!;
    expect(z.object(recordTool.inputSchema).parse({ lifeLinkId: "record" }).section).toBe("detail");
    expect(z.object(recordTool.inputSchema).safeParse({ lifeLinkId: "record", section: "unknown" }).success).toBe(false);
    expect(z.object(collectionTool.inputSchema).safeParse({ collectionId: id("collection"), includeMemberships: "true" }).success).toBe(false);

    const folder = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Physical shelf", browsingRole: "container", createdAt: at });
    const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Unchanged physical record", parentId: folder.id, createdAt: at });
    const expectedDetail = await h.store.getLifeLinkDetail(OWNER, record.id, { limit: 10 });
    const memberships = vi.spyOn(h.store, "listLifeLinkCollectionMemberships");
    const recordsOnly = { ...h.context, scopes: ["records:read"] };
    expect(await h.call("inspect_record", { lifeLinkId: record.id }, recordsOnly)).toEqual(expectedDetail);
    expect(await h.call("inspect_record", { lifeLinkId: record.id, section: "detail" }, recordsOnly)).toEqual(expectedDetail);
    expect(memberships).not.toHaveBeenCalled();

    let collection = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "Existing Collection", purpose: "Same purpose", notes: "Same notes", createdAt: at });
    collection = (await h.store.addCollectionMember(OWNER, { collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
    const expectedMembers = { collection, entries: await h.store.listCollectionMembers(OWNER, collection.id, { limit: 10 }) };
    expect(await h.call("inspect_collection", { collectionId: collection.id })).toEqual(expectedMembers);
    expect(await h.call("inspect_collection", { collectionId: collection.id, includeMemberships: false })).toEqual(expectedMembers);
    expect(await h.call("inspect_collection", { collectionId: collection.id, section: "sections" }))
      .toEqual({ collection, entries: await h.store.listCollectionSections(OWNER, collection.id, { limit: 10 }) });
    await expect(h.call("inspect_collection", { collectionId: collection.id, section: "sections", includeMemberships: true }))
      .rejects.toMatchObject({ code: "memberships_require_members" });
  });

  it("returns canonical cross-Collection memberships and exact assigned Sections with independent inner and outer continuation", async () => {
    const h = await harness();
    const first = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "A shared member", createdAt: at });
    const second = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "B unsectioned member", createdAt: at });
    let collection = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "A current Collection", createdAt: at });
    for (const record of [first, second]) collection = (await h.store.addCollectionMember(OWNER, {
      collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
    const assignedSections = [];
    for (const title of ["Ready to pack", "Tuesday routine"]) {
      const section = (await h.store.createCollectionSection(OWNER, { id: id("section"), collectionId: collection.id,
        title, expectedUpdatedAt: collection.updatedAt }))!;
      collection = section.collection; assignedSections.push(section.section);
    }
    collection = (await h.store.replaceCollectionSectionAssignments(OWNER, { collectionId: collection.id, lifeLinkId: first.id,
      sectionIds: assignedSections.map(section => section.id), expectedUpdatedAt: collection.updatedAt }))!;
    const otherIds: string[] = [];
    let lastSection;
    for (let index = 0; index < 25; index++) {
      let other = await h.store.createCollection({ id: id("collection"), ownerId: OWNER,
        title: `Other purpose ${String(index).padStart(2, "0")}`, createdAt: at });
      other = (await h.store.addCollectionMember(OWNER, { collectionId: other.id, lifeLinkId: first.id, expectedUpdatedAt: other.updatedAt }))!;
      if (index === 24) {
        const created = (await h.store.createCollectionSection(OWNER, { id: id("section"), collectionId: other.id,
          title: "Later-page assignment", expectedUpdatedAt: other.updatedAt }))!;
        lastSection = created.section;
        await h.store.replaceCollectionSectionAssignments(OWNER, { collectionId: other.id, lifeLinkId: first.id,
          sectionIds: [created.section.id], expectedUpdatedAt: created.collection.updatedAt });
      }
      otherIds.push(other.id);
    }
    const expectedFirst = (await h.store.listCollectionMembers(OWNER, collection.id, { limit: 1, includeMemberships: true }))!;
    const physicalDetails = vi.spyOn(h.store, "getLifeLinkDetail");
    const canonicalMemberships = vi.spyOn(h.store, "listLifeLinkCollectionMemberships");
    const collectionsOnly = { ...h.context, scopes: ["collections:read"] };
    const result = await h.call("inspect_collection", { collectionId: collection.id, limit: 1, includeMemberships: true }, collectionsOnly);
    expect(result).toEqual({ collection, entries: expectedFirst });
    expect(canonicalMemberships).not.toHaveBeenCalled();
    expect(Object.keys(result.entries.membershipPages)).toEqual([first.id]);
    const initial = result.entries.membershipPages[first.id];
    expect(initial).toMatchObject({ truncated: true, nextCursor: expect.any(String) });
    expect(initial.items).toHaveLength(25);
    expect(initial.items[0]).toEqual({ collection, sections: assignedSections });

    const remaining = await h.call("inspect_record", { lifeLinkId: first.id, section: "memberships", cursor: initial.nextCursor, limit: 25 }, collectionsOnly);
    expect(canonicalMemberships).toHaveBeenCalledTimes(1);
    expect(canonicalMemberships).toHaveBeenLastCalledWith(OWNER, first.id, expect.objectContaining({ cursor: initial.nextCursor, limit: 25 }));
    expect(remaining).toEqual(await h.store.listLifeLinkCollectionMemberships(OWNER, first.id, { cursor: initial.nextCursor, limit: 25 }));
    expect(remaining).toMatchObject({ nextCursor: null, truncated: false });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0]).toMatchObject({ collection: { id: otherIds[24] }, sections: [lastSection] });
    expect([...initial.items, ...remaining.items].map(entry => entry.collection.id)).toEqual([collection.id, ...otherIds]);
    const ownFirstPage = await h.call("inspect_record", { lifeLinkId: first.id, section: "memberships", limit: 25 }, collectionsOnly);
    expect(ownFirstPage).toEqual(initial);
    const ordinaryDefault = await h.call("inspect_record", { lifeLinkId: first.id, section: "memberships" }, collectionsOnly);
    expect(ordinaryDefault).toEqual(await h.store.listLifeLinkCollectionMemberships(OWNER, first.id, { limit: 10 }));

    const next = await h.call("inspect_collection", { collectionId: collection.id, includeMemberships: true, limit: 1,
      cursor: result.entries.nextCursor }, collectionsOnly);
    expect(next.entries).toEqual(await h.store.listCollectionMembers(OWNER, collection.id, {
      includeMemberships: true, limit: 1, cursor: result.entries.nextCursor }));
    expect(Object.keys(next.entries.membershipPages)).toEqual([second.id]);
    expect(next.entries.membershipPages[second.id]).toEqual({ items: [{ collection, sections: [] }], nextCursor: null, truncated: false });
    expect(physicalDetails).not.toHaveBeenCalled();
  });

  it("distinguishes empty memberships from unavailable records and denies record-only scope before Collection store access", async () => {
    const h = await harness();
    const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Not a Collection member", createdAt: at });
    const foreignRecord = await h.store.createLifeLink({ id: id("life-link"), ownerId: "demo-guest", title: "Other owner's record", createdAt: at });
    const empty = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "Empty", createdAt: at });
    const foreignCollection = await h.store.createCollection({ id: id("collection"), ownerId: "demo-guest", title: "Other owner's Collection", createdAt: at });
    const memberships = vi.spyOn(h.store, "listLifeLinkCollectionMemberships");
    const collectionRead = vi.spyOn(h.store, "getCollection");
    const members = vi.spyOn(h.store, "listCollectionMembers");
    const physicalDetails = vi.spyOn(h.store, "getLifeLinkDetail");
    const recordsOnly = { ...h.context, scopes: ["records:read"] };
    await expect(h.call("inspect_record", { lifeLinkId: record.id, section: "memberships" }, recordsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    await expect(h.call("inspect_collection", { collectionId: empty.id, includeMemberships: true }, recordsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect(memberships).not.toHaveBeenCalled(); expect(collectionRead).not.toHaveBeenCalled(); expect(members).not.toHaveBeenCalled();
    const collectionsOnly = { ...h.context, scopes: ["collections:read"] };
    await expect(h.call("inspect_record", { lifeLinkId: record.id }, collectionsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect(physicalDetails).not.toHaveBeenCalled();
    expect(await h.call("inspect_record", { lifeLinkId: record.id, section: "memberships" }, collectionsOnly))
      .toEqual({ items: [], nextCursor: null, truncated: false });
    expect(await h.call("inspect_collection", { collectionId: empty.id, includeMemberships: true }, collectionsOnly))
      .toEqual({ collection: empty, entries: { items: [], nextCursor: null, truncated: false, membershipPages: {} } });
    for (const lifeLinkId of [foreignRecord.id, id("life-link")]) {
      await expect(h.call("inspect_record", { lifeLinkId, section: "memberships" }, collectionsOnly)).rejects.toMatchObject({ code: "record_unavailable" });
    }
    for (const collectionId of [foreignCollection.id, id("collection")]) {
      await expect(h.call("inspect_collection", { collectionId, includeMemberships: true }, collectionsOnly)).rejects.toMatchObject({ code: "record_unavailable" });
    }
    expect(physicalDetails).not.toHaveBeenCalled();
  });

  it.each(["inspect_record", "inspect_collection"] as const)("withholds %s membership results if access is revoked or the request is aborted during the canonical read", async tool => {
    for (const interruption of ["revoke", "abort"] as const) {
      const h = await harness();
      const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Private delayed result", createdAt: at });
      let collection = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "Private Collection", createdAt: at });
      collection = (await h.store.addCollectionMember(OWNER, { collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
      let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
      if (tool === "inspect_record") {
        const read = h.store.listLifeLinkCollectionMemberships.bind(h.store);
        vi.spyOn(h.store, "listLifeLinkCollectionMemberships").mockImplementationOnce(async (...args) => {
          const result = await read(...args); entered(); await gate; return result;
        });
      } else {
        const read = h.store.listCollectionMembers.bind(h.store);
        vi.spyOn(h.store, "listCollectionMembers").mockImplementationOnce(async (...args) => {
          const result = await read(...args); entered(); await gate; return result;
        });
      }
      const abort = new AbortController();
      const pending = h.call(tool, tool === "inspect_record" ? { lifeLinkId: record.id, section: "memberships" }
        : { collectionId: collection.id, includeMemberships: true }, { ...h.context, scopes: ["collections:read"], signal: abort.signal });
      try {
        await started;
        if (interruption === "revoke") h.revoke(); else abort.abort();
        release();
        await expect(pending).rejects.toMatchObject(interruption === "revoke" ? { code: "remote_agent_access_denied" } : { name: "AbortError" });
      } finally { release(); await pending.catch(() => undefined); }
    }
  });

  it("rejects a bare Collection UUID before mutation and accepts the documented stable Collection and Section identities", async () => {
    const h = await harness();
    const createCollection = vi.spyOn(h.store, "createCollection");
    const uuid = randomUUID();
    const command = { action: "create", id: uuid, title: "Camping context" };
    await expect(h.call("maintain_collection", { command })).rejects.toMatchObject({ name: "ZodError", issues: expect.arrayContaining([
      expect.objectContaining({ path: ["command", "id"], message: expect.stringContaining("collection-<UUID>") })
    ]) });
    expect(createCollection).not.toHaveBeenCalled();
    const valid = { ...command, id: `collection-${uuid}` };
    const created = await h.call("maintain_collection", { command: valid });
    expect(created.id).toBe(valid.id);
    expect(await h.call("maintain_collection", { command: valid })).toEqual(created);
    const sectionId = id("section");
    const section = await h.call("maintain_collection", { command: { action: "create_section", id: sectionId,
      collectionId: created.id, expectedUpdatedAt: created.updatedAt, title: "Next trip" } });
    expect(section.section.id).toBe(sectionId);
  });

  it("publishes precise canonical namespaces for every new entity ID while retaining exact returned-handle guidance", async () => {
    const h = await harness(); const operations = createRemoteAgentOperations(h.deps);
    const cases = [
      ["maintain_collection", "create", "id", "collection-"],
      ["maintain_collection", "create_section", "id", "section-"],
      ["maintain_routine", "create", "id", "routine-"],
      ["maintain_routine", "create", "revisionId", "routine-revision-"],
      ["maintain_routine", "revise", "revisionId", "routine-revision-"],
      ["maintain_routine", "create_activity", "id", "activity-"],
      ["maintain_routine", "create_group", "id", "routine-group-"],
      ["routine_schedule", "create", "id", "routine-schedule-"],
      ["record_routine_run", "start", "id", "routine-run-"],
      ["record_routine_run", "finalize", "sessionId", "routine-session-"],
      ["record_routine_run", "amend", "id", "routine-session-amendment-"],
      ["create_calendar_event", "native", "id", "calendar-event-"],
      ["create_calendar_event", "native", "revisionId", "calendar-event-revision-"],
      ["update_calendar_event", "native", "revisionId", "calendar-event-revision-"]
    ];
    for (const [toolName, action, field, prefix] of cases) {
      const operation = operations.find(tool => tool.name === toolName)!;
      const union = operation.inputSchema.command as z.ZodDiscriminatedUnion<string, any>;
      const variant = union.options.find((item: any) => (item.shape.action ?? item.shape.authority).value === action) as z.AnyZodObject;
      const schema = variant.shape[field];
      expect(schema.safeParse(randomUUID()).success).toBe(false);
      expect(schema.safeParse(`wrong-${randomUUID()}`).success).toBe(false);
      expect(schema.safeParse(`${prefix}${randomUUID()}`).success).toBe(true);
      // Preserve canonical normalizer acceptance rather than inventing stricter
      // identifier syntax in the transport (core trims and lowercases IDs).
      expect(schema.safeParse(` ${prefix}${randomUUID().toUpperCase()} `).success).toBe(true);
      const published = toJsonSchemaCompat(z.object(operation.inputSchema), { strictUnions: true, pipeStrategy: "input" }) as any;
      const publicVariant = published.properties.command.anyOf.find((item: any) => (item.properties.action ?? item.properties.authority).const === action);
      const property = publicVariant.properties[field];
      const publicId = property.$ref ? property.$ref.slice(2).split("/").reduce((value: any, key: string) => value[key], published) : property;
      expect(publicId).toMatchObject({ type: "string", description: expect.stringContaining(`${prefix}<UUID>`) });
      expect(publicId.description).toContain("bare UUID is invalid");
      expect(publicId.description).toContain("reuse");
    }
    const routine = operations.find(tool => tool.name === "maintain_routine")!;
    const create = (routine.inputSchema.command as z.ZodDiscriminatedUnion<string, any>).options[0] as z.AnyZodObject;
    for (const [field, prefix] of [["steps", "routine-step-"], ["bindings", "routine-binding-"]]) {
      const array = create.shape[field] instanceof z.ZodOptional ? create.shape[field].unwrap() : create.shape[field];
      const schema = array.element.shape.id;
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse(randomUUID()).success).toBe(false);
      expect(schema.safeParse(`${prefix}${randomUUID()}`).success).toBe(true);
      const published = toJsonSchemaCompat(z.object(routine.inputSchema)) as any;
      expect(published.properties.command.anyOf[0].properties[field].items.properties.id.description).toContain(`${prefix}<UUID>`);
      expect(published.properties.command.anyOf[0].properties[field].items.properties.id.description).toContain("omission derives a stable ID");
    }
    const existing = toJsonSchemaCompat(z.object(operations.find(tool => tool.name === "inspect_collection")!.inputSchema)) as any;
    expect(existing.properties.collectionId.description).toContain("Copy it unchanged");
    const physical = operations.find(tool => tool.name === "maintain_record")!;
    const physicalCreate = (physical.inputSchema.command as z.ZodDiscriminatedUnion<string, any>).options[0] as z.AnyZodObject;
    expect(physicalCreate.shape.id.safeParse(randomUUID()).success).toBe(true);
    expect(physicalCreate.shape.id.description).toContain("Any nonblank string");
  });

  it("authors a Routine, schedules and executes it, then preserves immutable history while revising defaults and appending a correction", async () => {
    const h = await harness();
    const activity = await h.call("maintain_routine", { command: { action: "create_activity", id: id("activity"), title: "Prepare kit" } });
    const group = await h.call("maintain_routine", { command: { action: "create_group", id: id("routine-group"), title: "Adventures" } });
    const command = { action: "create", id: id("routine"), revisionId: id("routine-revision"), groupId: group.id, title: "Trip preparation",
      steps: [{ activityId: activity.id, activityTitle: activity.title, position: 0, plannedValues: [{ key: "effort", label: "Effort", kind: "number", value: 3 }] }] };
    const created = await h.call("maintain_routine", { command });
    expect(created.currentRevision.revision.ordering).toBe("unordered");
    expect(await h.call("maintain_routine", { command })).toEqual(created);
    const stepId = created.currentRevision.steps[0].id;
    const schedule = await h.call("routine_schedule", { command: { action: "create", id: id("routine-schedule"), routineId: command.id,
      routineRevisionId: command.revisionId, rule: { kind: "once", localDate: "2026-09-05", localTime: "12:00", timeZone: "UTC" } } });
    const slots = await h.call("routine_schedule", { command: { action: "materialize", routineId: command.id, startDate: "2026-09-05", endDate: "2026-09-05" } });
    const run = await h.call("record_routine_run", { command: { action: "start", id: id("routine-run"), routineId: command.id, occurrenceId: slots[0].id } });
    expect((await h.call("routine_history", { query: { kind: "active_run", routineId: command.id } })).run).toEqual(run);
    const recorded = await h.call("record_routine_run", { command: { action: "result", runId: run.id, routineStepId: stepId, expectedUpdatedAt: run.updatedAt,
      actualValues: [{ key: "effort", label: "Effort", kind: "number", value: 4 }], proposedNextValues: [{ key: "effort", label: "Effort", kind: "number", value: 5 }], notes: "Actually completed" } });
    const finalize = { action: "finalize", runId: run.id, sessionId: id("routine-session"), expectedUpdatedAt: recorded.updatedAt };
    const session = await h.call("record_routine_run", { command: finalize });
    expect(await h.call("record_routine_run", { command: finalize })).toEqual(session);
    const before = await h.call("routine_history", { query: { kind: "session", sessionId: session.session.id, section: "original_results" } });
    const revise = { action: "revise", routineId: command.id, revisionId: id("routine-revision"), expectedCurrentRevisionId: command.revisionId,
      title: "Improved preparation", ordering: "ordered", steps: command.steps };
    const revised = await h.call("maintain_routine", { command: revise });
    expect(revised.revision.ordering).toBe("ordered");
    expect(await h.call("maintain_routine", { command: revise })).toEqual(revised);
    expect(await h.call("routine_history", { query: { kind: "session", sessionId: session.session.id, section: "original_results" } })).toEqual(before);
    expect((await h.store.getRoutineOccurrence(OWNER, slots[0].id))!.routineRevisionId).toBe(command.revisionId);
    expect((await h.store.listRoutineSchedules(OWNER, command.id))!.items[0]).toMatchObject({ id: schedule.id, routineRevisionId: revise.revisionId });
    await h.call("record_routine_run", { command: { action: "amend", id: id("routine-session-amendment"), sessionId: session.session.id,
      stepResultId: before.items[0].id, note: "Correct measured effort", correctedActualValues: [{ key: "effort", label: "Effort", kind: "number", value: 6 }] } });
    const corrected = await h.call("routine_history", { query: { kind: "session", sessionId: session.session.id, section: "results" } });
    expect((await h.call("routine_history", { query: { kind: "session", sessionId: session.session.id, section: "original_results" } })).items).toEqual(before.items);
    expect(corrected.items[0].effectiveActualValues[0].value).toBe(6);
    expect((await h.call("routine_history", { query: { kind: "sessions" } })).items.some((item: any) => item.id === session.session.id)).toBe(true);
  });

  it("saves and completely retrieves valid Run and Session data larger than the MCP response limit", async () => {
    const h = await harness();
    const activity = await h.store.createActivity({ id: id("activity"), ownerId: OWNER, title: "Large typed results", createdAt: at });
    let collection = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "Captured membership", createdAt: at });
    for (let index = 0; index < 3; index++) {
      const item = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: `Member ${index}`, createdAt: at });
      collection = (await h.store.addCollectionMember(OWNER, { collectionId: collection.id, lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt }))!;
    }
    const plannedValues = Array.from({ length: 32 }, (_, index) => ({ key: `value_${index}`, label: `Value ${index}`, kind: "text" as const, text: "" }));
    const steps = Array.from({ length: 12 }, (_, position) => ({ id: id("routine-step"), activityId: activity.id, activityTitle: activity.title, position, plannedValues }));
    const bindingId = id("routine-binding");
    const created = await h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: OWNER,
      title: "Complete large history", steps, bindings: [{ id: bindingId, targetType: "collection", targetId: collection.id }], createdAt: at });
    const compact = async (command: unknown) => {
      const response = await h.execute("record_routine_run", { command });
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(16 * 1024);
      return decode(response);
    };
    let run = await compact({ action: "start", id: id("routine-run"), routineId: created.routine.id });
    const actualValues = Array.from({ length: 32 }, (_, index) => ({ key: `value_${index}`, label: `Value ${index}`,
      kind: "text", text: "☃".repeat(4_000) }));
    let lastWrite: any;
    for (const step of steps) {
      const observedValues = step === steps[0] ? actualValues.map((value) => ({ ...value, text: "\u0000".repeat(4_000) })) : actualValues;
      lastWrite = { action: "result", runId: run.id, routineStepId: step.id, expectedUpdatedAt: run.updatedAt,
        actualValues: observedValues, proposedNextValues: observedValues, notes: "Original observation" };
      run = await compact(lastWrite);
      expect(run.stepResults).toBeUndefined();
      expect(run.contextSnapshot).toBeUndefined();
    }
    expect(await compact(lastWrite)).toEqual(run);
    const originalRunVersion = run.updatedAt;
    run = await compact({ ...lastWrite, expectedUpdatedAt: run.updatedAt, notes: "Updated observation" });
    await expect(h.call("routine_history", { query: { kind: "run", runId: run.id, section: "results", offset: 1,
      expectedUpdatedAt: originalRunVersion } })).rejects.toMatchObject({ code: "stale_routine" });
    const fullRun = (await h.store.getRoutineRun(OWNER, run.id))!;
    expect(Buffer.byteLength(JSON.stringify(fullRun))).toBeGreaterThan(8 * 1024 * 1024);
    const readAll = async (query: Record<string, unknown>) => {
      const items: any[] = [];
      let offset = 0;
      for (;;) {
        const response = await h.execute("routine_history", { query: { ...query, offset } });
        expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(8 * 1024 * 1024);
        const page = decode(response);
        expect(page.offset).toBe(offset);
        items.push(...page.items);
        if (!page.hasMore) { expect(page.nextOffset).toBeNull(); expect(items).toHaveLength(page.total); return items; }
        expect(page.nextOffset).toBeGreaterThan(offset);
        offset = page.nextOffset;
      }
    };
    expect(await readAll({ kind: "run", runId: run.id, section: "results", expectedUpdatedAt: run.updatedAt, limit: 25 })).toEqual(fullRun.stepResults);
    const context = await readAll({ kind: "run", runId: run.id, section: "context", expectedUpdatedAt: run.updatedAt });
    expect(context[0]).toMatchObject({ bindingId, resolvedLifeLinkCount: 3 });
    expect(context[0].resolvedLifeLinks).toBeUndefined();
    expect(await readAll({ kind: "run", runId: run.id, section: "context_members", bindingId, limit: 1,
      expectedUpdatedAt: run.updatedAt })).toEqual(fullRun.contextSnapshot[0].resolvedLifeLinks);
    const finalize = { action: "finalize", runId: run.id, sessionId: id("routine-session"), expectedUpdatedAt: run.updatedAt };
    const receipt = await compact(finalize);
    expect(receipt).toMatchObject({ status: "completed", stepResultCount: steps.length, finalizedRun: { id: run.id, status: "finalized" } });
    expect(await compact(finalize)).toEqual(receipt);
    expect(receipt.session.contextSnapshot).toBeUndefined();
    const sessionId = receipt.session.id;
    const original = (await h.store.getRoutineSession(OWNER, sessionId))!;
    expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(8 * 1024 * 1024);
    expect(await readAll({ kind: "session", sessionId, section: "original_results", expectedAmendmentCount: 0 }))
      .toEqual(original.stepResults.map((step) => step.original));
    expect(await readAll({ kind: "session", sessionId, section: "context_members", bindingId, limit: 1, expectedAmendmentCount: 0 }))
      .toEqual(original.session.contextSnapshot[0].resolvedLifeLinks);
    const amendmentIds: string[] = [];
    // Corrections have their own pages; they never accumulate inside one result.
    for (let index = 0; index < 3; index++) {
      const amendment = { action: "amend", id: id("routine-session-amendment"), sessionId,
        stepResultId: original.stepResults[0].original.id, note: `Correction ${index}`,
        correctedActualValues: actualValues, correctedProposedNextValues: actualValues };
      const saved = await compact(amendment);
      expect(await compact(amendment)).toEqual(saved);
      amendmentIds.push(saved.id);
    }
    const note = await compact({ action: "amend", id: id("routine-session-amendment"), sessionId, note: "Whole-session note" });
    amendmentIds.push(note.id);
    await expect(h.call("routine_history", { query: { kind: "session", sessionId, section: "results", expectedAmendmentCount: 0 } }))
      .rejects.toMatchObject({ code: "stale_routine" });
    const corrected = (await h.store.getRoutineSession(OWNER, sessionId))!;
    const effective = await readAll({ kind: "session", sessionId, section: "results", expectedAmendmentCount: 4, limit: 25 });
    expect(effective.map((step) => step.effectiveActualValues)).toEqual(corrected.stepResults.map((step) => step.effectiveActualValues));
    expect(effective.map((step) => step.effectiveProposedNextValues)).toEqual(corrected.stepResults.map((step) => step.effectiveProposedNextValues));
    expect(effective[0].amendmentCount).toBe(3);
    expect(effective[0].amendments).toBeUndefined();
    const amendments = await readAll({ kind: "session", sessionId, section: "amendments", expectedAmendmentCount: 4 });
    expect(amendments.map((amendment) => amendment.id)).toEqual(amendmentIds);
    expect(amendments).toEqual([...corrected.stepResults[0].amendments, ...corrected.sessionAmendments]);
    expect((await h.call("routine_history", { query: { kind: "sessions", routineId: created.routine.id } })).items[0].contextSnapshot).toBeUndefined();
    h.revoke();
    await expect(h.call("routine_history", { query: { kind: "session", sessionId, section: "amendments", offset: 1 } }))
      .rejects.toMatchObject({ code: "remote_agent_access_denied" });
  });

  it("keeps remote scope separate from page grants, rejects injected ownership, and permits read-only schedule discovery", async () => {
    const h = await harness();
    const routine = await h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: OWNER, title: "Private Routine", createdAt: at, steps: [] });
    expect((await h.call("list_routines", {})).items.some((row: any) => row.id === routine.routine.id)).toBe(true);
    await expect(h.store.getRoutine(OWNER, routine.routine.id, "agent")).rejects.toMatchObject({ code: "agent_access_denied" });
    const readOnly = { ...h.context, scopes: ["routines:read"] };
    expect((await h.call("routine_schedule", { command: { action: "list", routineId: routine.routine.id } }, readOnly)).items).toEqual([]);
    await expect(h.call("maintain_routine", { command: { action: "create_activity", id: id("activity"), title: "No write" } }, readOnly)).rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    await expect(h.call("list_routines", { ownerId: "demo-guest" })).rejects.toThrow();
    const foreign = await h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: "demo-guest", title: "Other owner", createdAt: at, steps: [] });
    await expect(h.call("inspect_routine", { routineId: foreign.routine.id })).rejects.toMatchObject({ code: "record_unavailable" });
    await expect(h.call("search_records", { q: "Private", category: "routines" }, { ...h.context, scopes: ["records:read"] })).rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect((await h.call("search_records", { q: "Private", category: "routines" }, readOnly)).results).toHaveLength(1);
  });

  it("retains complete canonical deletion effects and recovers a lost completion receipt without another confirmation or deletion", async () => {
    const h = await harness();
    const root = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Folder", browsingRole: "container", createdAt: at });
    const child = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Child", parentId: root.id, createdAt: at });
    const command = { kind: "life_links", operation: "delete", lifeLinkIds: [root.id] };
    const requestId = randomUUID();
    const preview = await h.call("prepare_change", { requestId, command });
    expect(preview.effects.items.map((row: any) => row.id).sort()).toEqual([root.id, child.id].sort());
    expect(h.context.requestConfirmation).not.toHaveBeenCalled();
    expect(await h.call("prepare_change", { requestId, command })).toEqual(preview);
    await expect(h.call("prepare_change", { requestId, command: { ...command, lifeLinkIds: [child.id] } })).rejects.toMatchObject({ code: "remote_approval_conflict" });
    await expect(h.call("apply_change", { previewId: preview.previewId, confirmed: true })).rejects.toThrow();
    const applied = vi.spyOn(h.store, "applyLifeLinkChange");
    vi.spyOn(h.approvals, "complete").mockRejectedValueOnce(new Error("Lost acknowledgement after domain commit"));
    await expect(h.call("apply_change", { previewId: preview.previewId })).rejects.toThrow("Lost acknowledgement");
    expect(await h.store.getLifeLinkDetail(OWNER, root.id)).toBeNull();
    const history = await h.store.getChangeHistory(OWNER);
    h.resetOperations();
    const replay = await h.call("apply_change", { previewId: preview.previewId });
    expect(replay.status).toBe("applied");
    expect(await h.store.getChangeHistory(OWNER)).toEqual(history);
    expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0][1]).toEqual(applied.mock.calls[1][1]);
    await h.call("apply_change", { previewId: preview.previewId });
    expect(applied).toHaveBeenCalledTimes(2);
    await expect(h.call("apply_change", { previewId: preview.previewId }, { ...h.context, clientId: "different-client" })).rejects.toMatchObject({ code: "remote_approval_unavailable" });
    h.revoke(); await expect(h.call("apply_change", { previewId: preview.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
  });

  it("serializes concurrent apply, honors decline and blocks revocation during trusted confirmation", async () => {
    const h = await harness();
    const makePreview = async () => {
      const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Exact target", createdAt: at });
      return { record, preview: await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "life_links", operation: "delete", lifeLinkIds: [record.id] } }) };
    };
    const first = await makePreview();
    const applied = vi.spyOn(h.store, "applyLifeLinkChange");
    const concurrent = await Promise.all([h.call("apply_change", { previewId: first.preview.previewId }), h.call("apply_change", { previewId: first.preview.previewId })]);
    expect(concurrent[0]).toEqual(concurrent[1]); expect(applied).toHaveBeenCalledTimes(1); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    const declined = await makePreview();
    h.context.requestConfirmation = vi.fn(async () => false);
    expect((await h.call("apply_change", { previewId: declined.preview.previewId })).status).toBe("cancelled");
    expect((await h.call("apply_change", { previewId: declined.preview.previewId })).status).toBe("cancelled");
    expect(await h.store.getLifeLinkDetail(OWNER, declined.record.id)).not.toBeNull(); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    const revoked = await makePreview();
    h.context.requestConfirmation = vi.fn(async () => { h.revoke(); return true; });
    await expect(h.call("apply_change", { previewId: revoked.preview.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
    expect(await h.store.getLifeLinkDetail(OWNER, revoked.record.id)).not.toBeNull();
  });

  it("executes exact Collection moves without consent and preserves physical records when removing Collection meaning", async () => {
    const h = await harness();
    const source = await h.call("maintain_collection", { command: { action: "create", id: id("collection"), title: "Source" } });
    const target = await h.call("maintain_collection", { command: { action: "create", id: id("collection"), title: "Target" } });
    const item = await h.call("maintain_record", { command: { action: "create", id: id("life-link"), title: "Physical item" } });
    const updated = await h.call("maintain_collection", { command: { action: "add_member", collectionId: source.id, lifeLinkId: item.id, expectedUpdatedAt: source.updatedAt } });
    const move = await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "collections", input: { operation: "move", scope: "contents",
      source: { collectionId: source.id, expectedUpdatedAt: updated.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: null }],
      target: { collectionId: target.id, expectedUpdatedAt: target.updatedAt, sectionId: null } } } });
    expect((await h.call("apply_change", { previewId: move.previewId })).status).toBe("applied"); expect(h.context.requestConfirmation).not.toHaveBeenCalled();
    const current = (await h.store.getCollection(OWNER, target.id))!;
    const deletion = await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "collections", input: { operation: "delete", scope: "collections",
      collections: [{ collectionId: target.id, expectedUpdatedAt: current.updatedAt }] } } });
    await h.call("apply_change", { previewId: deletion.previewId });
    expect(await h.store.getLifeLinkDetail(OWNER, item.id)).not.toBeNull(); expect(await h.store.getCollection(OWNER, target.id)).toBeNull();
  });

  it("reports partial Routine archives honestly and never repeats the human choice", async () => {
    const h = await harness();
    const created = await Promise.all(["One", "Two"].map((title) => h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: OWNER, title, createdAt: at, steps: [] })));
    const selection = created.map(({ routine }) => ({ id: routine.id, expectedUpdatedAt: routine.updatedAt }));
    const preview = await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "routines", routines: selection } });
    await h.store.reviseRoutine(OWNER, { id: id("routine-revision"), ownerId: OWNER, routineId: selection[1].id, expectedCurrentRevisionId: created[1].routine.currentRevisionId,
      revisionNumber: 2, title: "Changed after preview", createdAt: "2026-09-03T13:00:00.000Z", steps: [] });
    const partial = await h.call("apply_change", { previewId: preview.previewId });
    expect(partial).toMatchObject({ status: "partial", removedIds: [selection[0].id], remainingIds: [selection[1].id] });
    const archived = (await h.store.getRoutine(OWNER, selection[0].id))!;
    expect(archived.routine.archivedAt).not.toBeNull(); expect(archived.currentRevision).toEqual(created[0].currentRevision);
    expect((await h.call("apply_change", { previewId: preview.previewId })).status).toBe("partial"); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
  });

  it("keeps native timed spans exact through title-only retry and applies one confirmed event deletion", async () => {
    const h = await harness();
    const calendar = await h.store.createCalendar({ id: id("calendar"), ownerId: OWNER, title: "Private", timeZone: "America/New_York", createdAt: at });
    const created = await h.call("create_calendar_event", { command: { authority: "native", id: id("calendar-event"), revisionId: id("calendar-event-revision"),
      calendarId: calendar.id, title: "Appointment", span: { kind: "zoned", startLocalDateTime: "2026-09-05T10:00", endLocalDateTime: "2026-09-05T10:30", timeZone: "America/New_York" } } });
    const update = { authority: "native", eventId: created.event.id, revisionId: id("calendar-event-revision"), expectedCurrentRevisionId: created.currentRevision.id,
      target: { scope: "event", eventId: created.event.id }, patch: { title: "Updated appointment" } };
    const revised = await h.call("update_calendar_event", { command: update });
    expect(revised.currentRevision.span).toEqual(created.currentRevision.span);
    expect(await h.call("update_calendar_event", { command: update })).toEqual(revised);
    await expect(h.call("update_calendar_event", { command: { ...update, patch: { title: "Different retry" } } })).rejects.toMatchObject({ code: "calendar_conflict" });
    const prepared = await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "native_calendar", eventId: created.event.id,
      expectedCurrentRevisionId: revised.currentRevision.id, target: { scope: "event", eventId: created.event.id } } });
    expect((await h.call("apply_change", { previewId: prepared.previewId })).status).toBe("applied");
    expect((await h.store.getCalendarEvent(OWNER, created.event.id))!.event.deletedAt).not.toBeNull();
    await h.store.updateCalendar(OWNER, { calendarId: calendar.id, expectedUpdatedAt: calendar.updatedAt, patch: { agentAccess: "none" } });
    await expect(h.call("apply_change", { previewId: prepared.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
  });

  it("uses the real provider gateway outbox for stable create/update/delete and rejects unsupported effects", async () => {
    const h = await harness();
    const calendarId = id("calendar"); const connectionId = "connection-remote-test";
    const providerState = new InMemoryCalendarProviderStateStore();
    const adapter = new DeterministicFakeCalendarProviderAdapter("fake-remote", "account", [{ providerCalendarId: "provider-calendar", displayName: "Fixture",
      capabilities: { read: true, create: true, update: true, delete: true }, events: [] }]);
    const gateway = new CalendarProviderGateway([adapter], providerState);
    await gateway.connectExternalAccount({ ownerId: OWNER, connectionId, providerKey: "fake-remote", expectedProviderAccountId: "account",
      credentialHandle: calendarProviderCredentialHandle("opaque-fixture-reference"), calendars: [{ calendarId, providerCalendarId: "provider-calendar", title: "Fixture",
        timeZone: "UTC", color: "#2f6f5f", isDefault: false, agentGrant: "write" }], initialWindow: { startUtc: "2026-09-01T00:00:00Z", endUtc: "2026-09-30T00:00:00Z" } });
    const getCalendar = h.store.getCalendar.bind(h.store);
    // The fake provider owns one real in-memory canonical Calendar; expose its
    // derived owner/grant-filtered view instead of a second seeded record.
    vi.spyOn(h.store, "getCalendar").mockImplementation(async (owner, id, actor) => {
      if (id !== calendarId) return getCalendar(owner, id, actor);
      const calendar = await providerState.getCanonicalCalendar(id);
      return calendar?.ownerId === owner && (actor !== "agent" || calendar.agentAccess !== "none") ? calendar : null;
    });
    h.resetOperations({ ...h.deps, calendarProviderGateway: gateway } as any);
    const content = { title: "Provider appointment", description: null, location: null, status: "confirmed", span: { kind: "timed", startUtc: "2026-09-05T14:00:00Z",
      endUtc: "2026-09-05T14:30:00Z", sourceTimeZone: "UTC", floatingLocalStart: null, floatingLocalEnd: null } };
    const command = { authority: "provider", commandId: "create-remote-once", connectionId, calendarId, content };
    const created = await h.call("create_calendar_event", { command });
    expect(await h.call("create_calendar_event", { command })).toEqual(created); expect(adapter.metrics().commandApplies.create).toBe(1);
    const edited = await h.call("update_calendar_event", { command: { ...command, commandId: "edit-remote-once", providerEventId: created.event.providerEventId,
      expectedProviderRevision: created.event.providerRevision, scope: "event", content: { ...content, title: "Edited original" } } });
    expect(edited.event.content.title).toBe("Edited original");
    const preview = await h.call("prepare_change", { requestId: randomUUID(), command: { kind: "provider_calendar", connectionId, calendarId,
      providerEventId: edited.event.providerEventId, expectedProviderRevision: edited.event.providerRevision, scope: "event" } });
    expect(preview.effects.warning).toContain("original Google/Outlook");
    await h.call("apply_change", { previewId: preview.previewId }); await h.call("apply_change", { previewId: preview.previewId });
    expect(adapter.metrics().commandApplies.delete).toBe(1); expect(adapter.eventCount("provider-calendar")).toBe(0);
    await expect(h.call("create_calendar_event", { command: { ...command, content: { ...content, attendees: ["not-allowed"] } } })).rejects.toThrow();
  });

  it("delivers exact attachment text and image blocks while refusing changed source bytes", async () => {
    const h = await harness();
    const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Manual", createdAt: at });
    const bytes = Buffer.from("Private manual text.");
    const media = (await h.store.createLifeLinkMedia(OWNER, record.id, { kind: "document", mimeType: "text/plain", fileName: "manual.txt", sizeBytes: bytes.length, data: bytes }))!;
    const read = await h.call("read_attachment", { lifeLinkId: record.id, mediaId: media.id }); expect(read.text).toBe("Private manual text.");
    const source = (await h.store.getLifeLinkMedia(OWNER, record.id, media.id))!;
    vi.spyOn(h.reader, "readImage").mockResolvedValue({ mediaId: media.id, sourceRevision: attachmentSourceRevision(source), status: "bytes_ready", reason: null,
      source: null, rendition: null, warnings: [], image: { mimeType: "image/png", data: "cGl4ZWxz" } });
    const image = await h.execute("read_attachment_image", { lifeLinkId: record.id, mediaId: media.id, options: { mode: "describe" } });
    expect(image.content).toContainEqual({ type: "image", mimeType: "image/png", data: "cGl4ZWxz" }); expect(JSON.stringify(image.structuredContent)).not.toContain("cGl4ZWxz");
    vi.spyOn(h.reader, "read").mockImplementationOnce(async () => {
      await h.store.deleteLifeLinkMedia(OWNER, record.id, media.id); return read;
    });
    await expect(h.call("read_attachment", { lifeLinkId: record.id, mediaId: media.id })).rejects.toMatchObject({ code: "record_unavailable" });
  });
});
