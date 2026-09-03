import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { MAX_LIFE_LINK_TOOL_OUTPUT_BYTES, planCollectionChange, type CollectionChangeState, type RoutineSummaryRecord } from "@life-links/core";
import { createWorkspaceAgentToolCatalog, LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID, LIFE_LINKS_WORKSPACE_TOOL_NAMES, type WorkspaceAgentToolController, type WorkspaceAgentAccessSnapshot, type WorkspaceChangeStatus } from "./workspaceToolHandlers";
import { createLifeLinksAgentToolCatalog, type LifeLinksAgentToolController } from "./toolHandlers";
import { LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID, validateLifeLinksPageToolCatalog } from "./browserWebMcpHost";

const at = "2026-09-02T12:00:00.000Z";
const later = "2026-09-02T12:01:00.000Z";
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const routineId = (index: number) => `routine-${uuid(index)}`;
const state: CollectionChangeState = {
  collections: Array.from({ length: 8 }, (_, index) => ({ id: `collection-${uuid(index + 1)}`, ownerId: "owner", title: `${index} ${"界".repeat(110)}`, purpose: "", notes: "", createdAt: at, updatedAt: at })),
  sections: [], memberships: [], assignments: [], lifeLinks: []
};
class Controller implements WorkspaceAgentToolController {
  collectionState = structuredClone(state);
  snapshot: WorkspaceAgentAccessSnapshot = { currentUser: { id: "owner" }, routeQrId: null, guestView: false, canonicalEditingId: null, agentConnection: { connected: true, toolCatalogId: LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID } };
  status: WorkspaceChangeStatus = { previewId: "routine-preview", state: "awaiting_confirmation" };
  getSnapshot() { return this.snapshot; }
  agentCheckWorkspaceAccess = vi.fn<WorkspaceAgentToolController["agentCheckWorkspaceAccess"]>(async () => ({ ok: true }));
  agentListRoutines = vi.fn<WorkspaceAgentToolController["agentListRoutines"]>(async () => ({ ok: true, routines: [], nextCursor: null }));
  agentPreviewCollectionChange = vi.fn<WorkspaceAgentToolController["agentPreviewCollectionChange"]>(async (input) => ({ ok: true, preview: { ...planCollectionChange(this.collectionState, "owner", input, later).preview, id: "collection-preview", createdAt: later } }));
  agentApplyCollectionChange = vi.fn<WorkspaceAgentToolController["agentApplyCollectionChange"]>(async () => ({ ok: true, status: { ...this.status, previewId: "collection-preview" } }));
  agentPreviewRoutineDeletion = vi.fn<WorkspaceAgentToolController["agentPreviewRoutineDeletion"]>(async ({ routines }) => ({ ok: true, preview: { id: "routine-preview", archivedAt: later, routines: routines.map((row, index) => ({ ...row, title: `${index} ${"界".repeat(110)}` })) } }));
  agentApplyRoutineDeletion = vi.fn<WorkspaceAgentToolController["agentApplyRoutineDeletion"]>(async () => ({ ok: true, status: this.status }));
}
const catalog = (controller: Controller) => new Map(createWorkspaceAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
const routineInput = (count = 8) => ({ routines: Array.from({ length: count }, (_, index) => ({ id: routineId(index + 1), expectedUpdatedAt: at })) });
const deleteCollections = { operation: "delete", scope: "collections", collections: state.collections.map((row) => ({ collectionId: row.id, expectedUpdatedAt: row.updatedAt })) };
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
async function readAll(tool: ReturnType<typeof catalog> extends Map<string, infer T> ? T : never, previewId: string) {
  const items: any[] = [];
  let cursor: number | null = 0;
  do {
    const response = await tool.execute({ previewId, cursor }) as any;
    expect(response.ok).toBe(true);
    expect(size(response)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
    expect(response.truncated).toBe(false);
    items.push(...response.items);
    cursor = response.nextCursor;
  } while (cursor !== null);
  return items;
}

describe("workspace-v3 page tools", () => {
  it("adds only five tools, preserving every published v2 descriptor and host size headroom", () => {
    const definitions = createLifeLinksAgentToolCatalog(new Proxy({} as LifeLinksAgentToolController, { get: () => () => { throw new Error("discovery invoked a controller"); } }));
    expect(definitions).toHaveLength(27);
    expect(definitions.slice(21, 26).map((tool) => tool.name)).toEqual(LIFE_LINKS_WORKSPACE_TOOL_NAMES);
    const frozen = JSON.parse(readFileSync(new URL("../../../../contracts/mcp/life-links-calendar-v2.authenticated-owner-page.full.json", import.meta.url), "utf8"));
    const validation = validateLifeLinksPageToolCatalog(definitions, LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID);
    expect(validation.ok).toBe(true);
    const descriptors = definitions.slice(0, 26).map(({ execute: _execute, ...descriptor }) => descriptor);
    expect(descriptors.slice(0, 21)).toEqual(frozen.catalog.tools);
    expect(size({ tools: descriptors, pageUrl: `https://lifelinks.vmosaic.com/${"x".repeat(2048)}`, origin: "https://lifelinks.vmosaic.com" })).toBeLessThan(65_536);
    expect(size({ tools: descriptors })).toBeLessThan(60_000);
    for (const origin of ["https://lifelinks.vmosaic.com", "https://life-links-api-production-1398.up.railway.app"]) {
      expect(size(descriptors.map((descriptor) => ({ ...descriptor, origin, pageUrl: `${origin}/routines/${routineId(1)}` })))).toBeLessThan(65_536 - 2_048);
    }
  });

  it("keeps schemas closed and lets the canonical Collection normalizer reject invalid semantics", async () => {
    const controller = new Controller(); const tools = catalog(controller);
    for (const tool of tools.values()) expect(() => new Ajv().compile(tool.inputSchema)).not.toThrow();
    const prepare = tools.get("prepare_collection_change")!; const validate = new Ajv().compile(prepare.inputSchema);
    expect(validate(deleteCollections)).toBe(true);
    expect(validate({ previewId: "collection-preview", cursor: 0 })).toBe(true);
    expect(validate({ ...deleteCollections, previewId: "mix" })).toBe(false);
    expect(validate({ ...deleteCollections, confirmed: true })).toBe(false);
    const invalid = { operation: "move", scope: "contents", source: deleteCollections.collections[0], sectionIds: [`section-${uuid(1)}`], members: [], target: { ...deleteCollections.collections[0], sectionId: null } };
    expect(await prepare.execute(invalid)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(controller.agentPreviewCollectionChange).not.toHaveBeenCalled();
    const routine = tools.get("prepare_routine_deletion")!;
    expect(new Ajv().compile(routine.inputSchema)(routineInput())).toBe(true);
    expect(await routine.execute({ routines: [routineInput(1).routines[0], routineInput(1).routines[0]] })).toMatchObject({ ok: false });
    expect(await routine.execute({ routines: [{ id: "guessed", expectedUpdatedAt: at }] })).toMatchObject({ ok: false });
    expect(await routine.execute({ ...routineInput(), confirmed: true })).toMatchObject({ ok: false });
    expect(controller.agentPreviewRoutineDeletion).not.toHaveBeenCalled();
  });

  it.each([null, "life-links-page-webmcp-v1", "life-links-calendar-v2", "unknown"])("refuses new capabilities under %s before controller access", async (toolCatalogId) => {
    const controller = new Controller(); controller.snapshot = { ...controller.snapshot, agentConnection: { connected: true, toolCatalogId } };
    for (const tool of catalog(controller).values()) expect(await tool.execute({})).toMatchObject({ ok: false, error: { code: "workspace_catalog_not_granted" } });
    expect(controller.agentListRoutines).not.toHaveBeenCalled(); expect(controller.agentPreviewCollectionChange).not.toHaveBeenCalled();
  });

  it("requires every exact Collection target page before delegating a move/delete once per same-preview status call", async () => {
    const controller = new Controller(); const tools = catalog(controller); const prepare = tools.get("prepare_collection_change")!; const apply = tools.get("apply_collection_change")!;
    const metadata = await prepare.execute(deleteCollections) as any;
    expect(metadata).toMatchObject({ ok: true, previewId: "collection-preview", nextCursor: 0, requiresCompleteReadback: true, sideEffects: { lifeLinksDeleted: 0 } });
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: false, error: { code: "complete_readback_required" } });
    const first = await prepare.execute({ previewId: metadata.previewId, cursor: 0 }) as any;
    expect(first.nextCursor).not.toBeNull();
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: false, error: { code: "complete_readback_required" } });
    const items = await readAll(prepare, metadata.previewId);
    expect(items.map((row) => row.title)).toEqual(state.collections.map((row) => row.title));
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: true, state: "awaiting_confirmation" });
    expect(controller.agentApplyCollectionChange).toHaveBeenCalledWith("collection-preview", undefined);
    controller.status = { previewId: metadata.previewId, state: "cancelled" };
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: true, state: "cancelled" });
    expect(await apply.execute({ previewId: metadata.previewId, confirmed: true })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it("delivers complete Routine names, returns immediately for app confirmation, and pages honest partial results", async () => {
    const controller = new Controller(); const tools = catalog(controller); const prepare = tools.get("prepare_routine_deletion")!; const apply = tools.get("apply_routine_deletion")!;
    const metadata = await prepare.execute(routineInput(100)) as any;
    expect(metadata.effects).toMatch(/not atomic/); expect(metadata.effects).toMatch(/history/);
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: false, error: { code: "complete_readback_required" } });
    const items = await readAll(prepare, metadata.previewId);
    expect(items).toHaveLength(100); expect(items[99].title).toBe(`99 ${"界".repeat(110)}`);
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: true, state: "awaiting_confirmation" });
    controller.status = { previewId: metadata.previewId, state: "applying" };
    expect(await apply.execute({ previewId: metadata.previewId })).toMatchObject({ ok: true, state: "applying" });
    controller.status = { previewId: metadata.previewId, state: "partial", removal: { removedIds: items.slice(0, 60).map((row) => row.id), remainingIds: items.slice(60).map((row) => row.id), error: "Do not leak transport payload" } };
    const result = await apply.execute({ previewId: metadata.previewId }) as any;
    expect(result).toMatchObject({ ok: true, state: "partial", removedCount: 60, remainingCount: 40, code: "partial_removal_failed" });
    expect(JSON.stringify(result)).not.toContain("transport payload");
    const rows = await readAll(apply, metadata.previewId);
    expect(rows.filter((row) => row.state === "removed").map((row) => row.id)).toEqual(items.slice(0, 60).map((row) => row.id));
    expect(rows.filter((row) => row.state === "remaining")).toHaveLength(40);
  });

  it("preserves exact Collection appearance and destination scope through the canonical move preview", async () => {
    const controller = new Controller(); const tools = catalog(controller); const prepare = tools.get("prepare_collection_change")!;
    const source = state.collections[0]!; const target = state.collections[1]!; const sectionId = `section-${uuid(10)}`;
    controller.collectionState.sections.push({ id: sectionId, ownerId: "owner", collectionId: source.id, title: "Source Section", position: 0, createdAt: at, updatedAt: at });
    controller.collectionState.lifeLinks.push({ id: "life-link-1", ownerId: "owner", title: "Exact item" });
    controller.collectionState.memberships.push({ ownerId: "owner", collectionId: source.id, lifeLinkId: "life-link-1", createdAt: at });
    controller.collectionState.assignments.push({ ownerId: "owner", collectionId: source.id, lifeLinkId: "life-link-1", sectionId, createdAt: at });
    const input = { operation: "move", scope: "contents", source: { collectionId: source.id, expectedUpdatedAt: at }, sectionIds: [], members: [{ lifeLinkId: "life-link-1", sourceSectionId: sectionId }], target: { collectionId: target.id, expectedUpdatedAt: at, sectionId: null } };
    expect(new Ajv().compile(prepare.inputSchema)(input)).toBe(true);
    const metadata = await prepare.execute(input) as any;
    expect(metadata).toMatchObject({ ok: true, operation: "move", target: { collectionId: target.id, sectionId: null }, sideEffects: { membershipsRemoved: 1, membershipsAdded: 1, assignmentsRemoved: 1, lifeLinksDeleted: 0 } });
    expect(size(metadata)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
    expect(metadata.membershipScope).toContain("Cross-Collection");
    const rows = await readAll(prepare, "collection-preview");
    expect(rows).toContainEqual({ kind: "member", lifeLinkId: "life-link-1", title: "Exact item", sourceSectionId: sectionId });
    controller.status = { previewId: "collection-preview", state: "applying" };
    expect(await tools.get("apply_collection_change")!.execute({ previewId: "collection-preview" })).toMatchObject({ ok: true, state: "applying" });
  });

  it("rechecks owner, grant, editor, public page and cancellation even when a preview was fully delivered", async () => {
    const controller = new Controller(); const tools = catalog(controller); const prepare = tools.get("prepare_routine_deletion")!; const apply = tools.get("apply_routine_deletion")!;
    await prepare.execute(routineInput(1)); await readAll(prepare, "routine-preview");
    const snapshot = controller.snapshot;
    for (const override of [{ currentUser: null }, { currentUser: { id: "other" } }, { guestView: true }, { routeQrId: "public" }, { canonicalEditingId: "editing" }, { agentConnection: { connected: false, toolCatalogId: LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID } }]) {
      controller.snapshot = { ...snapshot, ...override }; expect(await apply.execute({ previewId: "routine-preview" })).toMatchObject({ ok: false });
    }
    controller.snapshot = snapshot; const abort = new AbortController(); abort.abort();
    expect(await apply.execute({ previewId: "routine-preview" }, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(controller.agentApplyRoutineDeletion).not.toHaveBeenCalled();
    controller.agentListRoutines.mockImplementationOnce(async () => { controller.snapshot = { ...snapshot, currentUser: { id: "other" } }; return { ok: true, routines: [], nextCursor: null }; });
    expect(await tools.get("list_my_routines")!.execute({})).toMatchObject({ ok: false, error: { code: "owner_workspace_unavailable" } });
  });

  it("fresh-checks the saved v3 grant before revealing any retained preview page", async () => {
    const controller = new Controller(); const tools = catalog(controller); const prepare = tools.get("prepare_routine_deletion")!;
    await prepare.execute(routineInput(1));
    controller.agentCheckWorkspaceAccess.mockResolvedValueOnce({ ok: false, code: "workspace_catalog_not_granted" });
    expect(await prepare.execute({ previewId: "routine-preview", cursor: 0 })).toEqual({ ok: false, error: { code: "workspace_catalog_not_granted", retryable: false } });
    expect(await tools.get("apply_routine_deletion")!.execute({ previewId: "routine-preview" })).toMatchObject({ ok: false, error: { code: "complete_readback_required" } });
    controller.agentCheckWorkspaceAccess.mockImplementationOnce(async () => { controller.snapshot = { ...controller.snapshot, currentUser: { id: "other" } }; return { ok: true }; });
    expect(await prepare.execute({ previewId: "routine-preview", cursor: 0 })).toMatchObject({ ok: false, error: { code: "owner_workspace_unavailable" } });
  });

  it("discovers exact Routine revisions with bounded continuation and no private purpose payload", async () => {
    const controller = new Controller();
    const routine: RoutineSummaryRecord = { id: routineId(1), ownerId: "owner", title: "Workout", purpose: "PRIVATE", groupId: null, currentRevisionId: `routine-revision-${uuid(2)}`, createdAt: at, updatedAt: at, archivedAt: null, revisionNumber: 1 };
    controller.agentListRoutines.mockResolvedValue({ ok: true, routines: [routine], nextCursor: "next-page" });
    const list = catalog(controller).get("list_my_routines")!;
    const result = await list.execute({ includeArchived: true });
    expect(result).toMatchObject({ ok: true, routines: [{ id: routine.id, title: routine.title, expectedUpdatedAt: at }], nextCursor: "next-page" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(controller.agentListRoutines).toHaveBeenCalledWith({ limit: 1, includeArchived: true }, undefined);
    expect(await list.execute({ limit: 2 })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});
