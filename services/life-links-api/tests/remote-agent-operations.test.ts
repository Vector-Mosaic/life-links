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
  it("publishes concrete operations with accurate closed-world annotations and no grouped executors", async () => {
    const h = await harness();
    const operations = createRemoteAgentOperations(h.deps);
    const reads = [
      "list_records", "inspect_record", "list_record_memberships", "search_records", "list_collections", "inspect_collection",
      "list_routines", "list_activities", "list_routine_groups", "inspect_routine", "list_routine_schedules", "list_routine_occurrences",
      "inspect_routine_occurrence", "list_routine_sessions", "inspect_routine_session", "inspect_routine_run", "inspect_active_routine_run",
      "list_calendars", "query_native_calendar", "inspect_calendar_event", "read_attachment", "describe_attachment_image", "read_attachment_image"
    ];
    const additive = [
      "create_record", "create_collection", "add_collection_member", "create_collection_section", "create_routine", "create_activity",
      "create_routine_group", "create_routine_schedule", "materialize_routine_occurrences", "start_routine_run",
      "append_routine_session_amendment", "create_calendar_event"
    ];
    const destructive = [
      "update_record", "move_record", "bind_record_qr", "clear_record_qr", "update_collection", "update_collection_section",
      "assign_collection_sections", "revise_routine", "organize_routine", "update_activity", "update_routine_group",
      "update_routine_schedule", "put_routine_run_result", "finalize_routine_run", "sync_and_query_provider_calendar", "update_calendar_event"
    ];
    const prepares = [
      "prepare_record_move", "prepare_record_deletion", "prepare_collection_deletion", "prepare_collection_contents_deletion",
      "prepare_collection_contents_move", "prepare_routine_archive", "prepare_native_calendar_event_deletion", "prepare_provider_calendar_event_deletion"
    ];
    const applies = [
      "apply_record_move", "delete_records", "delete_collections", "delete_collection_contents", "move_collection_contents",
      "archive_routines", "delete_native_calendar_event", "delete_provider_calendar_event"
    ];
    expect(operations.map(operation => operation.name).sort()).toEqual([...reads, ...additive, ...destructive, ...prepares, ...applies].sort());
    for (const [names, readOnly, destructiveHint] of [[reads, true, false], [additive, false, false], [destructive, false, true],
      [prepares, false, false], [applies, false, true]] as const) {
      for (const name of names) expect(operations.find(operation => operation.name === name))
        .toMatchObject({ readOnly, destructive: destructiveHint, openWorld: false, idempotent: true });
    }
    for (const name of ["maintain_record", "manage_record_qr", "maintain_collection", "maintain_routine", "routine_schedule",
      "routine_history", "record_routine_run", "query_calendar", "prepare_change", "apply_change"]) {
      expect(operations.some(operation => operation.name === name)).toBe(false);
    }
    for (const operation of operations) {
      expect(operation.inputSchema).not.toHaveProperty("action");
      expect(operation.inputSchema).not.toHaveProperty("kind");
      expect(operation.inputSchema).not.toHaveProperty("operation");
    }
    expect(operations.find(operation => operation.name === "prepare_record_move")!.inputSchema).toHaveProperty("parentId");
    expect(operations.find(operation => operation.name === "prepare_record_deletion")!.inputSchema).not.toHaveProperty("parentId");
    expect(operations.find(operation => operation.name === "describe_attachment_image")!.inputSchema).not.toHaveProperty("sourceRevision");
    expect(operations.find(operation => operation.name === "read_attachment_image")!.inputSchema).toHaveProperty("sourceRevision");
    await expect(h.call("create_collection", { command: { action: "create", id: id("collection"), title: "Legacy wrapper" } })).rejects.toThrow();
  });

  it("keeps default physical and Collection results with independently scoped membership reads", async () => {
    const h = await harness();
    const operations = createRemoteAgentOperations(h.deps);
    const recordTool = operations.find(operation => operation.name === "inspect_record")!;
    const collectionTool = operations.find(operation => operation.name === "inspect_collection")!;
    expect(recordTool.inputSchema).not.toHaveProperty("section");
    expect(z.object(recordTool.inputSchema).strict().safeParse({ lifeLinkId: "record", section: "memberships" }).success).toBe(false);
    expect(z.object(collectionTool.inputSchema).safeParse({ collectionId: id("collection"), includeMemberships: "true" }).success).toBe(false);

    const folder = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Physical shelf", browsingRole: "container", createdAt: at });
    const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Unchanged physical record", parentId: folder.id, createdAt: at });
    const expectedDetail = await h.store.getLifeLinkDetail(OWNER, record.id, { limit: 10 });
    const memberships = vi.spyOn(h.store, "listLifeLinkCollectionMemberships");
    const recordsOnly = { ...h.context, scopes: ["records:read"] };
    expect(await h.call("inspect_record", { lifeLinkId: record.id }, recordsOnly)).toEqual(expectedDetail);
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

    const remaining = await h.call("list_record_memberships", { lifeLinkId: first.id, cursor: initial.nextCursor, limit: 25 }, collectionsOnly);
    expect(canonicalMemberships).toHaveBeenCalledTimes(1);
    expect(canonicalMemberships).toHaveBeenLastCalledWith(OWNER, first.id, expect.objectContaining({ cursor: initial.nextCursor, limit: 25 }));
    expect(remaining).toEqual(await h.store.listLifeLinkCollectionMemberships(OWNER, first.id, { cursor: initial.nextCursor, limit: 25 }));
    expect(remaining).toMatchObject({ nextCursor: null, truncated: false });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0]).toMatchObject({ collection: { id: otherIds[24] }, sections: [lastSection] });
    expect([...initial.items, ...remaining.items].map(entry => entry.collection.id)).toEqual([collection.id, ...otherIds]);
    const ownFirstPage = await h.call("list_record_memberships", { lifeLinkId: first.id, limit: 25 }, collectionsOnly);
    expect(ownFirstPage).toEqual(initial);
    const ordinaryDefault = await h.call("list_record_memberships", { lifeLinkId: first.id}, collectionsOnly);
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
    await expect(h.call("list_record_memberships", { lifeLinkId: record.id}, recordsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    await expect(h.call("inspect_collection", { collectionId: empty.id, includeMemberships: true }, recordsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect(memberships).not.toHaveBeenCalled(); expect(collectionRead).not.toHaveBeenCalled(); expect(members).not.toHaveBeenCalled();
    const collectionsOnly = { ...h.context, scopes: ["collections:read"] };
    await expect(h.call("inspect_record", { lifeLinkId: record.id }, collectionsOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect(physicalDetails).not.toHaveBeenCalled();
    expect(await h.call("list_record_memberships", { lifeLinkId: record.id}, collectionsOnly))
      .toEqual({ items: [], nextCursor: null, truncated: false });
    expect(await h.call("inspect_collection", { collectionId: empty.id, includeMemberships: true }, collectionsOnly))
      .toEqual({ collection: empty, entries: { items: [], nextCursor: null, truncated: false, membershipPages: {} } });
    for (const lifeLinkId of [foreignRecord.id, id("life-link")]) {
      await expect(h.call("list_record_memberships", { lifeLinkId}, collectionsOnly)).rejects.toMatchObject({ code: "record_unavailable" });
    }
    for (const collectionId of [foreignCollection.id, id("collection")]) {
      await expect(h.call("inspect_collection", { collectionId, includeMemberships: true }, collectionsOnly)).rejects.toMatchObject({ code: "record_unavailable" });
    }
    expect(physicalDetails).not.toHaveBeenCalled();
  });

  it.each(["list_record_memberships", "inspect_collection"] as const)("withholds %s membership results if access is revoked or the request is aborted during the canonical read", async tool => {
    for (const interruption of ["revoke", "abort"] as const) {
      const h = await harness();
      const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Private delayed result", createdAt: at });
      let collection = await h.store.createCollection({ id: id("collection"), ownerId: OWNER, title: "Private Collection", createdAt: at });
      collection = (await h.store.addCollectionMember(OWNER, { collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
      let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
      let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
      if (tool === "list_record_memberships") {
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
      const pending = h.call(tool, tool === "list_record_memberships" ? { lifeLinkId: record.id }
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
    const command = { id: uuid, title: "Camping context" };
    await expect(h.call("create_collection", command)).rejects.toMatchObject({ name: "ZodError", issues: expect.arrayContaining([
      expect.objectContaining({ path: ["id"], message: expect.stringContaining("collection-<UUID>") })
    ]) });
    expect(createCollection).not.toHaveBeenCalled();
    const valid = { ...command, id: `collection-${uuid}` };
    const created = await h.call("create_collection", valid);
    expect(created.id).toBe(valid.id);
    expect(await h.call("create_collection", valid)).toEqual(created);
    const sectionId = id("section");
    const section = await h.call("create_collection_section", { id: sectionId,
      collectionId: created.id, expectedUpdatedAt: created.updatedAt, title: "Next trip" });
    expect(section.section.id).toBe(sectionId);
  });

  it("publishes precise canonical namespaces for every new entity ID while retaining exact returned-handle guidance", async () => {
    const h = await harness(); const operations = createRemoteAgentOperations(h.deps);
    const cases = [
      ["create_collection", "id", "collection-"],
      ["create_collection_section", "id", "section-"],
      ["create_routine", "id", "routine-"],
      ["create_routine", "revisionId", "routine-revision-"],
      ["revise_routine", "revisionId", "routine-revision-"],
      ["create_activity", "id", "activity-"],
      ["create_routine_group", "id", "routine-group-"],
      ["create_routine_schedule", "id", "routine-schedule-"],
      ["start_routine_run", "id", "routine-run-"],
      ["finalize_routine_run", "sessionId", "routine-session-"],
      ["append_routine_session_amendment", "id", "routine-session-amendment-"],
      ["create_calendar_event", "id", "calendar-event-", "native"],
      ["create_calendar_event", "revisionId", "calendar-event-revision-", "native"],
      ["update_calendar_event", "revisionId", "calendar-event-revision-", "native"]
    ];
    for (const [toolName, field, prefix, authority] of cases) {
      const operation = operations.find(tool => tool.name === toolName)!;
      const shape = authority ? (operation.inputSchema.command as z.ZodDiscriminatedUnion<string, any>)
        .options.find((item: any) => item.shape.authority.value === authority)!.shape : operation.inputSchema;
      const schema = shape[field];
      expect(schema.safeParse(randomUUID()).success).toBe(false);
      expect(schema.safeParse(`wrong-${randomUUID()}`).success).toBe(false);
      expect(schema.safeParse(`${prefix}${randomUUID()}`).success).toBe(true);
      // Preserve canonical normalizer acceptance rather than inventing stricter
      // identifier syntax in the transport (core trims and lowercases IDs).
      expect(schema.safeParse(` ${prefix}${randomUUID().toUpperCase()} `).success).toBe(true);
      const published = toJsonSchemaCompat(z.object(operation.inputSchema), { strictUnions: true, pipeStrategy: "input" }) as any;
      const publicVariant = authority ? published.properties.command.anyOf.find((item: any) => item.properties.authority.const === authority) : published;
      const property = publicVariant.properties[field];
      const publicId = property.$ref ? property.$ref.slice(2).split("/").reduce((value: any, key: string) => value[key], published) : property;
      expect(publicId).toMatchObject({ type: "string", description: expect.stringContaining(`${prefix}<UUID>`) });
      expect(publicId.description).toContain("bare UUID is invalid");
      expect(publicId.description).toContain("reuse");
    }
    const routine = operations.find(tool => tool.name === "create_routine")!;
    for (const [field, prefix] of [["steps", "routine-step-"], ["bindings", "routine-binding-"]]) {
      const fieldSchema = routine.inputSchema[field];
      const array = (fieldSchema instanceof z.ZodOptional ? fieldSchema.unwrap() : fieldSchema) as z.ZodArray<z.AnyZodObject>;
      const schema = array.element.shape.id;
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse(randomUUID()).success).toBe(false);
      expect(schema.safeParse(`${prefix}${randomUUID()}`).success).toBe(true);
      const published = toJsonSchemaCompat(z.object(routine.inputSchema)) as any;
      expect(published.properties[field].items.properties.id.description).toContain(`${prefix}<UUID>`);
      expect(published.properties[field].items.properties.id.description).toContain("omission derives a stable ID");
    }
    const existing = toJsonSchemaCompat(z.object(operations.find(tool => tool.name === "inspect_collection")!.inputSchema)) as any;
    expect(existing.properties.collectionId.description).toContain("Copy it unchanged");
    const physical = operations.find(tool => tool.name === "create_record")!;
    expect(physical.inputSchema.id.safeParse(randomUUID()).success).toBe(true);
    expect(physical.inputSchema.id.description).toContain("Any nonblank string");
  });

  it("authors a Routine, schedules and executes it, then preserves immutable history while revising defaults and appending a correction", async () => {
    const h = await harness();
    const activity = await h.call("create_activity", { id: id("activity"), title: "Prepare kit" });
    const group = await h.call("create_routine_group", { id: id("routine-group"), title: "Adventures" });
    const command = { id: id("routine"), revisionId: id("routine-revision"), groupId: group.id, title: "Trip preparation",
      steps: [{ activityId: activity.id, activityTitle: activity.title, position: 0, plannedValues: [{ key: "effort", label: "Effort", kind: "number", value: 3 }] }] };
    const created = await h.call("create_routine", command);
    expect(created.currentRevision.revision.ordering).toBe("unordered");
    expect(await h.call("create_routine", command)).toEqual(created);
    const stepId = created.currentRevision.steps[0].id;
    const schedule = await h.call("create_routine_schedule", { id: id("routine-schedule"), routineId: command.id,
      routineRevisionId: command.revisionId, rule: { kind: "once", localDate: "2026-09-05", localTime: "12:00", timeZone: "UTC" } });
    const slots = await h.call("materialize_routine_occurrences", { routineId: command.id, startDate: "2026-09-05", endDate: "2026-09-05" });
    const run = await h.call("start_routine_run", { id: id("routine-run"), routineId: command.id, occurrenceId: slots[0].id });
    expect((await h.call("inspect_active_routine_run", { routineId: command.id })).run).toEqual(run);
    const recorded = await h.call("put_routine_run_result", { runId: run.id, routineStepId: stepId, expectedUpdatedAt: run.updatedAt,
      actualValues: [{ key: "effort", label: "Effort", kind: "number", value: 4 }], proposedNextValues: [{ key: "effort", label: "Effort", kind: "number", value: 5 }], notes: "Actually completed" });
    const finalize = { runId: run.id, sessionId: id("routine-session"), expectedUpdatedAt: recorded.updatedAt };
    const session = await h.call("finalize_routine_run", finalize);
    expect(await h.call("finalize_routine_run", finalize)).toEqual(session);
    const before = await h.call("inspect_routine_session", { sessionId: session.session.id, section: "original_results" });
    const revise = { routineId: command.id, revisionId: id("routine-revision"), expectedCurrentRevisionId: command.revisionId,
      title: "Improved preparation", ordering: "ordered", steps: command.steps };
    const revised = await h.call("revise_routine", revise);
    expect(revised.revision.ordering).toBe("ordered");
    expect(await h.call("revise_routine", revise)).toEqual(revised);
    expect(await h.call("inspect_routine_session", { sessionId: session.session.id, section: "original_results" })).toEqual(before);
    expect((await h.store.getRoutineOccurrence(OWNER, slots[0].id))!.routineRevisionId).toBe(command.revisionId);
    expect((await h.store.listRoutineSchedules(OWNER, command.id))!.items[0]).toMatchObject({ id: schedule.id, routineRevisionId: revise.revisionId });
    await h.call("append_routine_session_amendment", { id: id("routine-session-amendment"), sessionId: session.session.id,
      stepResultId: before.items[0].id, note: "Correct measured effort", correctedActualValues: [{ key: "effort", label: "Effort", kind: "number", value: 6 }] });
    const corrected = await h.call("inspect_routine_session", { sessionId: session.session.id, section: "results" });
    expect((await h.call("inspect_routine_session", { sessionId: session.session.id, section: "original_results" })).items).toEqual(before.items);
    expect(corrected.items[0].effectiveActualValues[0].value).toBe(6);
    expect((await h.call("list_routine_sessions", {})).items.some((item: any) => item.id === session.session.id)).toBe(true);
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
    const compact = async (tool: string, input: unknown) => {
      const response = await h.execute(tool, input);
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(16 * 1024);
      return decode(response);
    };
    let run = await compact("start_routine_run", { id: id("routine-run"), routineId: created.routine.id });
    const actualValues = Array.from({ length: 32 }, (_, index) => ({ key: `value_${index}`, label: `Value ${index}`,
      kind: "text", text: "☃".repeat(4_000) }));
    let lastWrite: any;
    for (const step of steps) {
      const observedValues = step === steps[0] ? actualValues.map((value) => ({ ...value, text: "\u0000".repeat(4_000) })) : actualValues;
      lastWrite = { runId: run.id, routineStepId: step.id, expectedUpdatedAt: run.updatedAt,
        actualValues: observedValues, proposedNextValues: observedValues, notes: "Original observation" };
      run = await compact("put_routine_run_result", lastWrite);
      expect(run.stepResults).toBeUndefined();
      expect(run.contextSnapshot).toBeUndefined();
    }
    expect(await compact("put_routine_run_result", lastWrite)).toEqual(run);
    const originalRunVersion = run.updatedAt;
    run = await compact("put_routine_run_result", { ...lastWrite, expectedUpdatedAt: run.updatedAt, notes: "Updated observation" });
    await expect(h.call("inspect_routine_run", { runId: run.id, section: "results", offset: 1,
      expectedUpdatedAt: originalRunVersion })).rejects.toMatchObject({ code: "stale_routine" });
    const fullRun = (await h.store.getRoutineRun(OWNER, run.id))!;
    expect(Buffer.byteLength(JSON.stringify(fullRun))).toBeGreaterThan(8 * 1024 * 1024);
    const readAll = async (tool: "inspect_routine_run" | "inspect_routine_session", query: Record<string, unknown>) => {
      const items: any[] = [];
      let offset = 0;
      for (;;) {
        const response = await h.execute(tool, { ...query, offset });
        expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(8 * 1024 * 1024);
        const page = decode(response);
        expect(page.offset).toBe(offset);
        items.push(...page.items);
        if (!page.hasMore) { expect(page.nextOffset).toBeNull(); expect(items).toHaveLength(page.total); return items; }
        expect(page.nextOffset).toBeGreaterThan(offset);
        offset = page.nextOffset;
      }
    };
    expect(await readAll("inspect_routine_run", { runId: run.id, section: "results", expectedUpdatedAt: run.updatedAt, limit: 25 })).toEqual(fullRun.stepResults);
    const context = await readAll("inspect_routine_run", { runId: run.id, section: "context", expectedUpdatedAt: run.updatedAt });
    expect(context[0]).toMatchObject({ bindingId, resolvedLifeLinkCount: 3 });
    expect(context[0].resolvedLifeLinks).toBeUndefined();
    expect(await readAll("inspect_routine_run", { runId: run.id, section: "context_members", bindingId, limit: 1,
      expectedUpdatedAt: run.updatedAt })).toEqual(fullRun.contextSnapshot[0].resolvedLifeLinks);
    const finalize = { runId: run.id, sessionId: id("routine-session"), expectedUpdatedAt: run.updatedAt };
    const receipt = await compact("finalize_routine_run", finalize);
    expect(receipt).toMatchObject({ status: "completed", stepResultCount: steps.length, finalizedRun: { id: run.id, status: "finalized" } });
    expect(await compact("finalize_routine_run", finalize)).toEqual(receipt);
    expect(receipt.session.contextSnapshot).toBeUndefined();
    const sessionId = receipt.session.id;
    const original = (await h.store.getRoutineSession(OWNER, sessionId))!;
    expect(Buffer.byteLength(JSON.stringify(original))).toBeGreaterThan(8 * 1024 * 1024);
    expect(await readAll("inspect_routine_session", { sessionId, section: "original_results", expectedAmendmentCount: 0 }))
      .toEqual(original.stepResults.map((step) => step.original));
    expect(await readAll("inspect_routine_session", { sessionId, section: "context_members", bindingId, limit: 1, expectedAmendmentCount: 0 }))
      .toEqual(original.session.contextSnapshot[0].resolvedLifeLinks);
    const amendmentIds: string[] = [];
    // Corrections have their own pages; they never accumulate inside one result.
    for (let index = 0; index < 3; index++) {
      const amendment = { id: id("routine-session-amendment"), sessionId,
        stepResultId: original.stepResults[0].original.id, note: `Correction ${index}`,
        correctedActualValues: actualValues, correctedProposedNextValues: actualValues };
      const saved = await compact("append_routine_session_amendment", amendment);
      expect(await compact("append_routine_session_amendment", amendment)).toEqual(saved);
      amendmentIds.push(saved.id);
    }
    const note = await compact("append_routine_session_amendment", { id: id("routine-session-amendment"), sessionId, note: "Whole-session note" });
    amendmentIds.push(note.id);
    await expect(h.call("inspect_routine_session", {sessionId, section: "results", expectedAmendmentCount: 0 }))
      .rejects.toMatchObject({ code: "stale_routine" });
    const corrected = (await h.store.getRoutineSession(OWNER, sessionId))!;
    const effective = await readAll("inspect_routine_session", { sessionId, section: "results", expectedAmendmentCount: 4, limit: 25 });
    expect(effective.map((step) => step.effectiveActualValues)).toEqual(corrected.stepResults.map((step) => step.effectiveActualValues));
    expect(effective.map((step) => step.effectiveProposedNextValues)).toEqual(corrected.stepResults.map((step) => step.effectiveProposedNextValues));
    expect(effective[0].amendmentCount).toBe(3);
    expect(effective[0].amendments).toBeUndefined();
    const amendments = await readAll("inspect_routine_session", { sessionId, section: "amendments", expectedAmendmentCount: 4 });
    expect(amendments.map((amendment) => amendment.id)).toEqual(amendmentIds);
    expect(amendments).toEqual([...corrected.stepResults[0].amendments, ...corrected.sessionAmendments]);
    expect((await h.call("list_routine_sessions", { routineId: created.routine.id })).items[0].contextSnapshot).toBeUndefined();
    h.revoke();
    await expect(h.call("inspect_routine_session", {sessionId, section: "amendments", offset: 1 }))
      .rejects.toMatchObject({ code: "remote_agent_access_denied" });
  });

  it("keeps remote scope separate from page grants, rejects injected ownership, and permits read-only schedule discovery", async () => {
    const h = await harness();
    const routine = await h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: OWNER, title: "Private Routine", createdAt: at, steps: [] });
    expect((await h.call("list_routines", {})).items.some((row: any) => row.id === routine.routine.id)).toBe(true);
    await expect(h.store.getRoutine(OWNER, routine.routine.id, "agent")).rejects.toMatchObject({ code: "agent_access_denied" });
    const readOnly = { ...h.context, scopes: ["routines:read"] };
    const schedule = await h.call("create_routine_schedule", { id: id("routine-schedule"), routineId: routine.routine.id,
      routineRevisionId: routine.currentRevision.revision.id, rule: { kind: "once", localDate: "2026-09-05", localTime: "12:00", timeZone: "UTC" } });
    const occurrences = await h.call("materialize_routine_occurrences", { routineId: routine.routine.id, startDate: "2026-09-05", endDate: "2026-09-05" });
    const createSchedule = vi.spyOn(h.store, "createRoutineSchedule");
    const updateSchedule = vi.spyOn(h.store, "updateRoutineSchedule");
    const materialize = vi.spyOn(h.store, "materializeRoutineOccurrences");
    expect((await h.call("list_routine_schedules", { routineId: routine.routine.id }, readOnly)).items).toEqual([schedule]);
    expect((await h.call("list_routine_occurrences", { routineId: routine.routine.id, startDate: "2026-09-05", endDate: "2026-09-05" }, readOnly)).items).toEqual(occurrences);
    expect(await h.call("inspect_routine_occurrence", { occurrenceId: occurrences[0].id }, readOnly)).toEqual(occurrences[0]);
    await expect(h.call("materialize_routine_occurrences", { routineId: routine.routine.id, startDate: "2026-09-06", endDate: "2026-09-06" }, readOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    await expect(h.call("update_routine_schedule", { scheduleId: schedule.id, expectedUpdatedAt: schedule.updatedAt, patch: { active: false } }, readOnly))
      .rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect(createSchedule).not.toHaveBeenCalled(); expect(updateSchedule).not.toHaveBeenCalled(); expect(materialize).not.toHaveBeenCalled();
    await expect(h.call("create_activity", { id: id("activity"), title: "No write" }, readOnly)).rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    await expect(h.call("list_routines", { ownerId: "demo-guest" })).rejects.toThrow();
    await expect(h.call("list_routines", { kind: "activities" })).rejects.toThrow();
    const foreign = await h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: "demo-guest", title: "Other owner", createdAt: at, steps: [] });
    await expect(h.call("inspect_routine", { routineId: foreign.routine.id })).rejects.toMatchObject({ code: "record_unavailable" });
    await expect(h.call("search_records", { q: "Private", category: "routines" }, { ...h.context, scopes: ["records:read"] })).rejects.toMatchObject({ code: "remote_agent_insufficient_scope" });
    expect((await h.call("search_records", { q: "Private", category: "routines" }, readOnly)).results).toHaveLength(1);
  });

  it.each(["pending", "applied", "declined"] as const)("refuses every mismatched named apply before effects or %s receipt replay", async status => {
    const h = await harness();
    const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Only a record deletion", createdAt: at });
    const preview = await h.call("prepare_record_deletion", { requestId: randomUUID(), lifeLinkIds: [record.id] });
    const apply = vi.spyOn(h.store, "applyLifeLinkChange");
    if (status !== "pending") {
      h.context.requestConfirmation = vi.fn(async () => status === "applied");
      await h.call("delete_records", { previewId: preview.previewId });
    }
    apply.mockClear(); vi.mocked(h.context.requestConfirmation).mockClear();
    const before = await h.approvals.get(h.context, preview.previewId);
    const history = await h.store.getChangeHistory(OWNER);
    for (const tool of ["apply_record_move", "delete_collections", "delete_collection_contents", "move_collection_contents",
      "archive_routines", "delete_native_calendar_event", "delete_provider_calendar_event"]) {
      await expect(h.call(tool, { previewId: preview.previewId })).rejects.toMatchObject({ code: "invalid_change_selection" });
    }
    expect(await h.approvals.get(h.context, preview.previewId)).toEqual(before);
    expect(await h.store.getChangeHistory(OWNER)).toEqual(history);
    expect(await h.store.getLifeLinkDetail(OWNER, record.id)).toEqual(status === "applied" ? null : expect.anything());
    expect(apply).not.toHaveBeenCalled(); expect(h.context.requestConfirmation).not.toHaveBeenCalled();
  });

  it("retains complete canonical deletion effects and recovers a lost completion receipt without another confirmation or deletion", async () => {
    const h = await harness();
    const root = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Folder", browsingRole: "container", createdAt: at });
    const child = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Child", parentId: root.id, createdAt: at });
    const command = { lifeLinkIds: [root.id] };
    const requestId = randomUUID();
    const preview = await h.call("prepare_record_deletion", { requestId, ...command });
    expect(preview.effects.items.map((row: any) => row.id).sort()).toEqual([root.id, child.id].sort());
    expect(h.context.requestConfirmation).not.toHaveBeenCalled();
    expect(await h.call("prepare_record_deletion", { requestId, ...command })).toEqual(preview);
    await expect(h.call("prepare_record_deletion", { requestId, ...command, lifeLinkIds: [child.id] })).rejects.toMatchObject({ code: "remote_approval_conflict" });
    await expect(h.call("delete_records", { previewId: preview.previewId, confirmed: true })).rejects.toThrow();
    const applied = vi.spyOn(h.store, "applyLifeLinkChange");
    vi.spyOn(h.approvals, "complete").mockRejectedValueOnce(new Error("Lost acknowledgement after domain commit"));
    await expect(h.call("delete_records", { previewId: preview.previewId })).rejects.toThrow("Lost acknowledgement");
    expect(await h.store.getLifeLinkDetail(OWNER, root.id)).toBeNull();
    const history = await h.store.getChangeHistory(OWNER);
    h.resetOperations();
    const replay = await h.call("delete_records", { previewId: preview.previewId });
    expect(replay.status).toBe("applied");
    expect(await h.store.getChangeHistory(OWNER)).toEqual(history);
    expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0][1]).toEqual(applied.mock.calls[1][1]);
    await h.call("delete_records", { previewId: preview.previewId });
    expect(applied).toHaveBeenCalledTimes(2);
    await expect(h.call("delete_records", { previewId: preview.previewId }, { ...h.context, clientId: "different-client" })).rejects.toMatchObject({ code: "remote_approval_unavailable" });
    h.revoke(); await expect(h.call("delete_records", { previewId: preview.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
  });

  it("serializes concurrent apply, honors decline and blocks revocation during trusted confirmation", async () => {
    const h = await harness();
    const makePreview = async () => {
      const record = await h.store.createLifeLink({ id: id("life-link"), ownerId: OWNER, title: "Exact target", createdAt: at });
      return { record, preview: await h.call("prepare_record_deletion", { requestId: randomUUID(), lifeLinkIds: [record.id] }) };
    };
    const first = await makePreview();
    const applied = vi.spyOn(h.store, "applyLifeLinkChange");
    const concurrent = await Promise.all([h.call("delete_records", { previewId: first.preview.previewId }), h.call("delete_records", { previewId: first.preview.previewId })]);
    expect(concurrent[0]).toEqual(concurrent[1]); expect(applied).toHaveBeenCalledTimes(1); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    const declined = await makePreview();
    h.context.requestConfirmation = vi.fn(async () => false);
    expect((await h.call("delete_records", { previewId: declined.preview.previewId })).status).toBe("cancelled");
    expect((await h.call("delete_records", { previewId: declined.preview.previewId })).status).toBe("cancelled");
    expect(await h.store.getLifeLinkDetail(OWNER, declined.record.id)).not.toBeNull(); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
    const revoked = await makePreview();
    h.context.requestConfirmation = vi.fn(async () => { h.revoke(); return true; });
    await expect(h.call("delete_records", { previewId: revoked.preview.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
    expect(await h.store.getLifeLinkDetail(OWNER, revoked.record.id)).not.toBeNull();
  });

  it.each(["applied", "declined"] as const)("rechecks %s receipt state when another decision wins while the confirmation prompt is open", async terminal => {
    const h = await harness();
    const record = await h.store.createLifeLink({ id:id("life-link"),ownerId:OWNER,title:"Concurrent exact target",createdAt:at});
    const preview = await h.call("prepare_record_deletion",{requestId:randomUUID(),lifeLinkIds:[record.id]});
    const applied = vi.spyOn(h.store,"applyLifeLinkChange");
    h.context.requestConfirmation = vi.fn(async()=>{
      // Model the other exact request's committed outcome during the real
      // database prompt's unlocked interval; the caller must reread it.
      const approval = await h.approvals.approve(h.context,preview.previewId,terminal === "applied");
      if(terminal === "applied") {
        const result = await h.store.applyLifeLinkChange(OWNER,{previewId:String(approval.payload.previewId),commandId:String(approval.payload.commandId)});
        await h.approvals.complete(h.context,preview.previewId,result);
      }
      return true;
    });
    const result = await h.call("delete_records",{previewId:preview.previewId});
    expect(result.status).toBe(terminal === "applied" ? "applied" : "cancelled");
    expect(applied).toHaveBeenCalledTimes(terminal === "applied" ? 1 : 0);
    expect(await h.store.getLifeLinkDetail(OWNER,record.id)).toEqual(terminal === "applied" ? null : expect.anything());
  });

  it("executes exact Collection moves without consent and preserves physical records when removing Collection meaning", async () => {
    const h = await harness();
    const source = await h.call("create_collection", { id: id("collection"), title: "Source" });
    const target = await h.call("create_collection", { id: id("collection"), title: "Target" });
    const item = await h.call("create_record", { id: id("life-link"), title: "Physical item" });
    const updated = await h.call("add_collection_member", { collectionId: source.id, lifeLinkId: item.id, expectedUpdatedAt: source.updatedAt });
    const move = await h.call("prepare_collection_contents_move", { requestId: randomUUID(), source: { collectionId: source.id, expectedUpdatedAt: updated.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: null }],
      target: { collectionId: target.id, expectedUpdatedAt: target.updatedAt, sectionId: null } });
    for (const tool of ["delete_collections", "delete_collection_contents"]) {
      await expect(h.call(tool, { previewId: move.previewId })).rejects.toMatchObject({ code: "invalid_change_selection" });
    }
    expect((await h.call("move_collection_contents", { previewId: move.previewId })).status).toBe("applied"); expect(h.context.requestConfirmation).not.toHaveBeenCalled();
    await expect(h.call("delete_collection_contents", { previewId: move.previewId })).rejects.toMatchObject({ code: "invalid_change_selection" });
    const current = (await h.store.getCollection(OWNER, target.id))!;
    const deletion = await h.call("prepare_collection_deletion", { requestId: randomUUID(), collections: [{ collectionId: target.id, expectedUpdatedAt: current.updatedAt }]  });
    await h.call("delete_collections", { previewId: deletion.previewId });
    expect(await h.store.getLifeLinkDetail(OWNER, item.id)).not.toBeNull(); expect(await h.store.getCollection(OWNER, target.id)).toBeNull();
  });

  it("reports partial Routine archives honestly and never repeats the human choice", async () => {
    const h = await harness();
    const created = await Promise.all(["One", "Two"].map((title) => h.store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: OWNER, title, createdAt: at, steps: [] })));
    const selection = created.map(({ routine }) => ({ id: routine.id, expectedUpdatedAt: routine.updatedAt }));
    const preview = await h.call("prepare_routine_archive", { requestId: randomUUID(), routines: selection });
    await h.store.reviseRoutine(OWNER, { id: id("routine-revision"), ownerId: OWNER, routineId: selection[1].id, expectedCurrentRevisionId: created[1].routine.currentRevisionId,
      revisionNumber: 2, title: "Changed after preview", createdAt: "2026-09-03T13:00:00.000Z", steps: [] });
    const partial = await h.call("archive_routines", { previewId: preview.previewId });
    expect(partial).toMatchObject({ status: "partial", removedIds: [selection[0].id], remainingIds: [selection[1].id] });
    const archived = (await h.store.getRoutine(OWNER, selection[0].id))!;
    expect(archived.routine.archivedAt).not.toBeNull(); expect(archived.currentRevision).toEqual(created[0].currentRevision);
    expect((await h.call("archive_routines", { previewId: preview.previewId })).status).toBe("partial"); expect(h.context.requestConfirmation).toHaveBeenCalledTimes(1);
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
    const prepared = await h.call("prepare_native_calendar_event_deletion", { requestId: randomUUID(), eventId: created.event.id,
      expectedCurrentRevisionId: revised.currentRevision.id, target: { scope: "event", eventId: created.event.id } });
    expect((await h.call("delete_native_calendar_event", { previewId: prepared.previewId })).status).toBe("applied");
    expect((await h.store.getCalendarEvent(OWNER, created.event.id))!.event.deletedAt).not.toBeNull();
    await h.store.updateCalendar(OWNER, { calendarId: calendar.id, expectedUpdatedAt: calendar.updatedAt, patch: { agentAccess: "none" } });
    await expect(h.call("delete_native_calendar_event", { previewId: prepared.previewId })).rejects.toMatchObject({ code: "remote_agent_access_denied" });
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
    const synchronize = vi.spyOn(gateway, "synchronizeCalendar");
    const calendarReadOnly = { ...h.context, scopes: ["calendar:read"] };
    // Provider instants are canonical UTC strings, not the caller's formatting.
    expect((await h.call("sync_and_query_provider_calendar", { calendarId, connectionId, startDate: "2026-09-05", endDate: "2026-09-05" }, calendarReadOnly)).items)
      .toMatchObject([{ providerEventId: created.event.providerEventId, providerRevision: created.event.providerRevision,
        content: { ...content, span: { ...content.span, startUtc: "2026-09-05T14:00:00.000Z", endUtc: "2026-09-05T14:30:00.000Z" } } }]);
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(synchronize).toHaveBeenCalledWith(expect.objectContaining({ ownerId: OWNER, connectionId, calendarId, actor: "agent",
      window: { startUtc: "2026-09-05T00:00:00.000Z", endUtc: "2026-09-06T00:00:00.000Z" } }));
    expect(adapter.metrics().commandApplies).toMatchObject({ create: 1, update: 0, delete: 0 });
    const edited = await h.call("update_calendar_event", { command: { ...command, commandId: "edit-remote-once", providerEventId: created.event.providerEventId,
      expectedProviderRevision: created.event.providerRevision, scope: "event", content: { ...content, title: "Edited original" } } });
    expect(edited.event.content.title).toBe("Edited original");
    const preview = await h.call("prepare_provider_calendar_event_deletion", { requestId: randomUUID(), connectionId, calendarId,
      providerEventId: edited.event.providerEventId, expectedProviderRevision: edited.event.providerRevision, scope: "event"  });
    expect(preview.effects.warning).toContain("original Google/Outlook");
    await h.call("delete_provider_calendar_event", { previewId: preview.previewId }); await h.call("delete_provider_calendar_event", { previewId: preview.previewId });
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
    const readImage = vi.spyOn(h.reader, "readImage").mockResolvedValue({ mediaId: media.id, sourceRevision: attachmentSourceRevision(source), status: "bytes_ready", reason: null,
      source: null, rendition: null, warnings: [], image: { mimeType: "image/png", data: "cGl4ZWxz" } });
    await expect(h.execute("read_attachment_image", { lifeLinkId: record.id, mediaId: media.id, options: { mode: "describe" } })).rejects.toThrow();
    expect(readImage).not.toHaveBeenCalled();
    const image = await h.execute("read_attachment_image", { lifeLinkId: record.id, mediaId: media.id, sourceRevision: attachmentSourceRevision(source) });
    expect(readImage).toHaveBeenLastCalledWith(source, { mode: "overview", sourceRevision: attachmentSourceRevision(source) }, undefined);
    expect(image.content).toContainEqual({ type: "image", mimeType: "image/png", data: "cGl4ZWxz" }); expect(JSON.stringify(image.structuredContent)).not.toContain("cGl4ZWxz");
    vi.spyOn(h.reader, "read").mockImplementationOnce(async () => {
      await h.store.deleteLifeLinkMedia(OWNER, record.id, media.id); return read;
    });
    await expect(h.call("read_attachment", { lifeLinkId: record.id, mediaId: media.id })).rejects.toMatchObject({ code: "record_unavailable" });
  });
});
