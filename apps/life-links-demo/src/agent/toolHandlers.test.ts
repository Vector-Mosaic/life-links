import {
  MAX_BODY_LENGTH,
  MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT,
  MAX_LIFE_LINK_TOOL_OUTPUT_BYTES,
  MAX_TITLE_LENGTH,
  createLinkBodyDocFromPlainText,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSearchItem,
  type LifeLinkSummary
} from "@life-links/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WebMcpToolDefinition } from "../webmcpCompatibility";
import {
  LIFE_LINKS_AGENT_TOOL_NAMES,
  createLifeLinksAgentToolCatalog,
  type AgentSearchLifeLinksControllerResult,
  type AgentSearchLifeLinksInput,
  type AgentToolControllerActionResult,
  type AgentToolWorkspaceSnapshot,
  type LifeLinksAgentToolController
} from "./toolHandlers";

const owner = { id: "owner-1" };
const baseTime = "2026-08-26T12:00:00.000Z";

function lifeLink(overrides: Partial<LifeLinkRecord> = {}): LifeLinkRecord {
  return {
    id: "life-link-camera-battery-kit",
    ownerId: owner.id,
    parentId: "life-link-camera-bag",
    qrId: "LL-CAMERA-BATTERY-KIT",
    title: "Camera Battery Kit",
    body: "Two charged batteries and one USB-C charger.",
    bodyDoc: createLinkBodyDocFromPlainText("Two charged batteries and one USB-C charger."),
    bodyDocVersion: 1,
    privacy: "private",
    media: [],
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides
  };
}

function summary(record: LifeLinkRecord, childCount = 0): LifeLinkSummary {
  return {
    id: record.id,
    parentId: record.parentId,
    qrId: record.qrId,
    title: record.title,
    privacy: record.privacy,
    updatedAt: record.updatedAt,
    childCount
  };
}

function detail(record = lifeLink(), ancestry: LifeLinkSummary[] = [summary(record)]): LifeLinkDetail {
  return {
    lifeLink: record,
    ancestry: { items: ancestry, truncated: false, omittedCount: 0 },
    children: [],
    childrenPage: { nextCursor: null, truncated: false }
  };
}

function snapshot(overrides: Partial<AgentToolWorkspaceSnapshot> = {}): AgentToolWorkspaceSnapshot {
  const selected = detail();
  return {
    currentUser: owner,
    routeQrId: null,
    guestView: false,
    canonicalEditingId: null,
    agentDraftProposal: null,
    selectedLifeLinkId: selected.lifeLink.id,
    selectedLifeLinkDetail: selected,
    lifeLinkSearchResults: [],
    lifeLinkSearchTotalCount: 0,
    lifeLinkSearchNextCursor: null,
    lifeLinkSearchTruncated: false,
    findTargetId: null,
    ...overrides
  };
}

class FakeController implements LifeLinksAgentToolController {
  current = snapshot();
  readonly agentInspectCurrentLifeLink = vi.fn(async (): Promise<AgentToolControllerActionResult> => ({ ok: true }));
  readonly agentSearchLifeLinks = vi.fn(async (
    input: AgentSearchLifeLinksInput
  ): Promise<AgentSearchLifeLinksControllerResult> => ({
    ok: true,
    search: {
      query: input.query,
      results: this.current.lifeLinkSearchResults.slice(0, input.limit),
      totalCount: this.current.lifeLinkSearchTotalCount,
      nextCursor: this.current.lifeLinkSearchNextCursor,
      hasMore: this.current.lifeLinkSearchNextCursor !== null || this.current.lifeLinkSearchTruncated,
      truncated: this.current.lifeLinkSearchTruncated
    }
  }));
  readonly agentOpenLifeLink = vi.fn(async (): Promise<AgentToolControllerActionResult> => ({ ok: true }));
  readonly agentStageLifeLinkDraft = vi.fn(async (): Promise<AgentToolControllerActionResult> => ({ ok: true }));
  readonly agentStartFindMode = vi.fn(async (): Promise<AgentToolControllerActionResult> => ({ ok: true }));

  getSnapshot() {
    return this.current;
  }
}

let controller: FakeController;
let tools: ReadonlyMap<string, WebMcpToolDefinition>;

beforeEach(() => {
  controller = new FakeController();
  tools = new Map(createLifeLinksAgentToolCatalog(controller).map((tool) => [tool.name, tool]));
});

describe("Life Links five-tool catalog", () => {
  it("exports exactly the fixed five names with the accepted annotations", () => {
    const definitions = createLifeLinksAgentToolCatalog(controller);
    expect(definitions.map((tool) => tool.name)).toEqual(LIFE_LINKS_AGENT_TOOL_NAMES);
    expect(definitions).toHaveLength(5);
    expect(definitions.map((tool) => tool.annotations)).toEqual([
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true }
    ]);
    expect(definitions.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it("reads the selected detail live for every inspect invocation", async () => {
    const inspect = requiredTool("inspect_current_life_link");
    const first = lifeLink({ id: "life-link-first", title: "First" });
    const second = lifeLink({ id: "life-link-second", title: "Second" });
    controller.current = snapshot({ selectedLifeLinkId: first.id, selectedLifeLinkDetail: detail(first) });
    const firstResult = await inspect.execute({});
    controller.current = snapshot({ selectedLifeLinkId: second.id, selectedLifeLinkDetail: detail(second) });
    const secondResult = await inspect.execute({}, {});

    expect(controller.agentInspectCurrentLifeLink).toHaveBeenNthCalledWith(1, { lifeLinkId: first.id }, undefined);
    expect(controller.agentInspectCurrentLifeLink).toHaveBeenNthCalledWith(2, { lifeLinkId: second.id }, undefined);
    expect(firstResult).toMatchObject({ ok: true, lifeLink: { id: first.id } });
    expect(secondResult).toMatchObject({ ok: true, lifeLink: { id: second.id } });
  });

  it("rejects login, public QR, guest, and already-aborted invocations before effects", async () => {
    const inspect = requiredTool("inspect_current_life_link");
    const cases: AgentToolWorkspaceSnapshot[] = [
      snapshot({ currentUser: null }),
      snapshot({ routeQrId: "LL-PUBLIC" }),
      snapshot({ guestView: true })
    ];
    for (const state of cases) {
      controller.current = state;
      await expect(inspect.execute({}, {})).resolves.toMatchObject({
        ok: false,
        error: { code: "owner_workspace_unavailable" }
      });
    }
    controller.current = snapshot();
    const abortController = new AbortController();
    abortController.abort();
    await expect(inspect.execute({}, { signal: abortController.signal })).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" }
    });
    expect(controller.agentInspectCurrentLifeLink).not.toHaveBeenCalled();
  });

  it("returns a bounded editor error before visible effects or a second draft proposal", async () => {
    const selected = lifeLink();
    controller.current = snapshot({ canonicalEditingId: selected.id });
    const visibleEffectInvocations: Array<[string, unknown]> = [
      ["inspect_current_life_link", {}],
      ["search_my_life_links", { query: "battery", limit: 10 }],
      ["open_life_link", { lifeLinkId: selected.id }],
      ["start_find_mode", { lifeLinkId: selected.id }]
    ];

    for (const [name, input] of visibleEffectInvocations) {
      await expect(requiredTool(name).execute(input, {})).resolves.toEqual({
        ok: false,
        error: {
          code: "editor_open",
          message: "Finish or close the active Life Link editor before running this tool.",
          retryable: true
        }
      });
    }
    expect(controller.agentInspectCurrentLifeLink).not.toHaveBeenCalled();
    expect(controller.agentSearchLifeLinks).not.toHaveBeenCalled();
    expect(controller.agentOpenLifeLink).not.toHaveBeenCalled();
    expect(controller.agentStartFindMode).not.toHaveBeenCalled();

    controller.current = snapshot({ agentDraftProposal: { lifeLinkId: selected.id } });
    await expect(requiredTool("draft_life_link_update").execute({
      lifeLinkId: selected.id,
      baseUpdatedAt: selected.updatedAt,
      title: "Another proposal"
    }, {})).resolves.toMatchObject({ ok: false, error: { code: "editor_open", retryable: true } });
    expect(controller.agentStageLifeLinkDraft).not.toHaveBeenCalled();
  });

  it("does not serialize an earlier owner's result after the live owner changes", async () => {
    const open = requiredTool("open_life_link");
    controller.agentOpenLifeLink.mockImplementationOnce(async () => {
      controller.current = snapshot({ currentUser: { id: "owner-2" } });
      return { ok: true };
    });

    await expect(open.execute({ lifeLinkId: lifeLink().id }, {})).resolves.toMatchObject({
      ok: false,
      error: { code: "owner_workspace_unavailable" }
    });
  });

  it("strictly rejects extra fields and out-of-bounds input without controller effects", async () => {
    const cases: Array<[string, unknown]> = [
      ["inspect_current_life_link", { lifeLinkId: "override-is-forbidden" }],
      ["search_my_life_links", { query: "battery", limit: 11 }],
      ["search_my_life_links", { query: " ", limit: 1 }],
      ["open_life_link", { lifeLinkId: "bad id" }],
      ["draft_life_link_update", { lifeLinkId: lifeLink().id, baseUpdatedAt: baseTime, privacy: "public" }],
      ["draft_life_link_update", { lifeLinkId: lifeLink().id, baseUpdatedAt: baseTime }],
      ["start_find_mode", { lifeLinkId: lifeLink().id, camera: true }]
    ];
    for (const [name, input] of cases) {
      await expect(requiredTool(name).execute(input, {})).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_input", retryable: false }
      });
    }
    expect(controller.agentSearchLifeLinks).not.toHaveBeenCalled();
    expect(controller.agentOpenLifeLink).not.toHaveBeenCalled();
    expect(controller.agentStageLifeLinkDraft).not.toHaveBeenCalled();
    expect(controller.agentStartFindMode).not.toHaveBeenCalled();
  });

  it("caps search at ten and truncates serialized results below 1.5 KB", async () => {
    const long = "x".repeat(120);
    const results: LifeLinkSearchItem[] = Array.from({ length: 10 }, (_, index) => {
      const record = lifeLink({
        id: `life-link-result-${index}-${"i".repeat(120)}`,
        title: `${long}-${index}`,
        body: long
      });
      return {
        lifeLink: summary(record),
        path: {
          items: [summary(lifeLink({ id: `root-${index}`, title: long })), summary(record)],
          truncated: true,
          omittedCount: 30
        },
        bodySummary: long.repeat(2),
        matchClass: "body"
      };
    });
    controller.current = snapshot({
      lifeLinkSearchResults: results,
      lifeLinkSearchTotalCount: 40,
      lifeLinkSearchNextCursor: "next",
      lifeLinkSearchTruncated: true
    });
    const result = await requiredTool("search_my_life_links").execute({ query: " battery ", limit: 10 }, {});

    expect(controller.agentSearchLifeLinks).toHaveBeenCalledWith({ query: "battery", limit: 10 }, undefined);
    expect(result).toMatchObject({ ok: true, query: "battery", totalCount: 40, hasMore: true, truncated: true });
    expect((result as { results: unknown[] }).results.length).toBeLessThanOrEqual(10);
    expect(outputBytes(result)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
  });

  it("correlates overlapping search results with the invocation that produced them", async () => {
    const search = requiredTool("search_my_life_links");
    const firstRecord = lifeLink({ id: "life-link-first-search", title: "First search result" });
    const secondRecord = lifeLink({ id: "life-link-second-search", title: "Second search result" });
    const firstItem: LifeLinkSearchItem = {
      lifeLink: summary(firstRecord),
      path: { items: [summary(firstRecord)], truncated: false, omittedCount: 0 },
      bodySummary: firstRecord.body,
      matchClass: "exact_title"
    };
    const secondItem: LifeLinkSearchItem = {
      lifeLink: summary(secondRecord),
      path: { items: [summary(secondRecord)], truncated: false, omittedCount: 0 },
      bodySummary: secondRecord.body,
      matchClass: "exact_title"
    };
    controller.agentSearchLifeLinks.mockImplementation(async (input) => {
      const result = input.query === "first" ? firstItem : secondItem;
      controller.current = snapshot({
        lifeLinkSearchResults: [result],
        lifeLinkSearchTotalCount: 1
      });
      return {
        ok: true,
        search: {
          query: input.query,
          results: [result],
          totalCount: 1,
          nextCursor: null,
          hasMore: false,
          truncated: false
        }
      };
    });

    const [first, second] = await Promise.all([
      search.execute({ query: "first", limit: 10 }, {}),
      search.execute({ query: "second", limit: 10 }, {})
    ]);

    expect(first).toMatchObject({
      ok: true,
      query: "first",
      results: [{ id: firstRecord.id }]
    });
    expect(second).toMatchObject({
      ok: true,
      query: "second",
      results: [{ id: secondRecord.id }]
    });
  });

  it("opens only the exact post-effect stable identity", async () => {
    const target = lifeLink({ id: "life-link-tripod" });
    controller.agentOpenLifeLink.mockImplementationOnce(async () => {
      controller.current = snapshot({ selectedLifeLinkId: target.id, selectedLifeLinkDetail: detail(target) });
      return { ok: true };
    });
    const result = await requiredTool("open_life_link").execute({ lifeLinkId: target.id }, {});
    expect(controller.agentOpenLifeLink).toHaveBeenCalledWith({ lifeLinkId: target.id }, undefined);
    expect(result).toMatchObject({ ok: true, lifeLinkId: target.id, visibleEffect: "life_link_opened" });

    controller.agentOpenLifeLink.mockImplementationOnce(async () => ({ ok: true }));
    const wrong = await requiredTool("open_life_link").execute({ lifeLinkId: "life-link-missing" }, {});
    expect(wrong).toMatchObject({ ok: false, error: { code: "effect_not_applied" } });
  });

  it("stages only a selected revision-bound title/body proposal and never Save authority", async () => {
    const record = lifeLink();
    controller.current = snapshot({ selectedLifeLinkId: record.id, selectedLifeLinkDetail: detail(record) });
    const input = {
      lifeLinkId: record.id,
      baseUpdatedAt: record.updatedAt,
      title: "Battery checklist",
      body: "Charge both batteries.",
      sourceLifeLinkIds: ["life-link-camera-bag"]
    };
    const result = await requiredTool("draft_life_link_update").execute(input, {});

    expect(controller.agentStageLifeLinkDraft).toHaveBeenCalledWith(input, undefined);
    expect(result).toMatchObject({
      ok: true,
      lifeLinkId: record.id,
      baseUpdatedAt: record.updatedAt,
      proposedFields: ["title", "body"],
      saved: false,
      privacyChanged: false,
      visibleEffect: "agent_draft_opened"
    });
    expect(Object.keys(controller)).not.toContain("saveCanonicalLifeLink");
  });

  it("rejects stale revisions, oversized proposals, duplicate sources, and forbidden draft fields", async () => {
    const record = lifeLink();
    controller.current = snapshot({ selectedLifeLinkId: record.id, selectedLifeLinkDetail: detail(record) });
    const draft = requiredTool("draft_life_link_update");

    await expect(
      draft.execute({ lifeLinkId: record.id, baseUpdatedAt: "2026-08-25T00:00:00.000Z", title: "New" }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "stale_life_link", retryable: true } });
    await expect(
      draft.execute({ lifeLinkId: record.id, baseUpdatedAt: baseTime, title: "x".repeat(MAX_TITLE_LENGTH + 1) }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(
      draft.execute({ lifeLinkId: record.id, baseUpdatedAt: baseTime, body: "x".repeat(MAX_BODY_LENGTH + 1) }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(
      draft.execute({
        lifeLinkId: record.id,
        baseUpdatedAt: baseTime,
        body: "New",
        sourceLifeLinkIds: Array(MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT + 1).fill("life-link-source")
      }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(
      draft.execute({
        lifeLinkId: record.id,
        baseUpdatedAt: baseTime,
        body: "New",
        sourceLifeLinkIds: ["life-link-source", "life-link-source"]
      }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await expect(
      draft.execute({ lifeLinkId: record.id, baseUpdatedAt: baseTime, body: "New", save: true }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(controller.agentStageLifeLinkDraft).not.toHaveBeenCalled();
  });

  it("requires a QR-bound authorized result before reporting Find Mode", async () => {
    const target = lifeLink({ id: "life-link-target", qrId: "LL-TARGET" });
    controller.agentStartFindMode.mockImplementationOnce(async () => {
      controller.current = snapshot({
        selectedLifeLinkId: target.id,
        selectedLifeLinkDetail: detail(target),
        findTargetId: target.qrId
      });
      return { ok: true };
    });
    await expect(requiredTool("start_find_mode").execute({ lifeLinkId: target.id }, {})).resolves.toMatchObject({
      ok: true,
      lifeLinkId: target.id,
      qrId: target.qrId,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });

    controller.agentStartFindMode.mockResolvedValueOnce({ ok: false, code: "qr_not_attached" });
    await expect(
      requiredTool("start_find_mode").execute({ lifeLinkId: "life-link-without-qr" }, {})
    ).resolves.toMatchObject({ ok: false, error: { code: "qr_not_attached", retryable: false } });
  });

  it("maps bounded controller failures without exposing controller or content error text", async () => {
    controller.agentStageLifeLinkDraft.mockResolvedValueOnce({ ok: false, code: "source_life_link_unavailable" });
    const record = lifeLink();
    controller.current = snapshot({ selectedLifeLinkId: record.id, selectedLifeLinkDetail: detail(record) });
    const result = await requiredTool("draft_life_link_update").execute(
      {
        lifeLinkId: record.id,
        baseUpdatedAt: record.updatedAt,
        body: "proposal",
        sourceLifeLinkIds: ["life-link-not-authorized"]
      },
      {}
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "source_life_link_unavailable",
        message: "One or more draft source Life Links are not available to the current owner.",
        retryable: true
      }
    });
    expect(outputBytes(result)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
  });

  it("bounds an extreme inspect projection with explicit truncation", async () => {
    const selected = lifeLink({ title: "s".repeat(MAX_TITLE_LENGTH) });
    const ancestry = Array.from({ length: 12 }, (_, index) =>
      summary(
        lifeLink({
          id: `life-link-path-${index}-${"i".repeat(120)}`,
          title: `Path ${index} ${"t".repeat(MAX_TITLE_LENGTH - 8)}`,
          parentId: index === 0 ? null : `life-link-path-${index - 1}`
        })
      )
    );
    ancestry[ancestry.length - 1] = summary(selected);
    const extreme = detail(selected, ancestry);
    extreme.children = Array.from({ length: 25 }, (_, index) =>
      summary(lifeLink({ id: `child-${index}-${"c".repeat(120)}`, title: "t".repeat(MAX_TITLE_LENGTH) }))
    );
    extreme.childrenPage.truncated = true;
    controller.current = snapshot({ selectedLifeLinkId: selected.id, selectedLifeLinkDetail: extreme });
    const result = await requiredTool("inspect_current_life_link").execute({}, {});

    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(outputBytes(result)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
  });
});

function requiredTool(name: string): WebMcpToolDefinition {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

function outputBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
