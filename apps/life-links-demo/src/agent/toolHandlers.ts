import {
  MAX_BODY_LENGTH,
  MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT,
  MAX_LIFE_LINK_TOOL_OUTPUT_BYTES,
  MAX_LIFE_LINK_TOOL_SEARCH_RESULTS,
  MAX_TITLE_LENGTH,
  formatRecordedLifeLinkPath,
  type LifeLinkDetail,
  type LifeLinkSearchItem
} from "@life-links/core";

import type {
  WebMcpExecutionContext,
  WebMcpJsonValue,
  WebMcpToolDefinition
} from "../webmcpCompatibility";
import type { AgentLifeLinkSearchPayload } from "../workspace/types";
import { LIFE_LINKS_PAGE_TOOL_NAMES } from "./browserWebMcpHost";

const MAX_LIFE_LINK_ID_LENGTH = 200;
const MAX_SEARCH_QUERY_LENGTH = 160;
const MAX_REVISION_LENGTH = 64;
const MAX_RESULT_TITLE_LENGTH = 96;
const MAX_RESULT_PATH_LENGTH = 240;
const MAX_RESULT_BODY_SUMMARY_LENGTH = 120;

export const LIFE_LINKS_AGENT_TOOL_NAMES = LIFE_LINKS_PAGE_TOOL_NAMES;

export type LifeLinksAgentToolName = (typeof LIFE_LINKS_AGENT_TOOL_NAMES)[number];

export type AgentToolControllerFailureCode =
  | "cancelled"
  | "editor_open"
  | "life_link_unavailable"
  | "stale_life_link"
  | "source_life_link_unavailable"
  | "qr_not_attached";

export type AgentToolControllerActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: AgentToolControllerFailureCode };

export type AgentSearchLifeLinksControllerResult =
  | { readonly ok: true; readonly search: AgentLifeLinkSearchPayload }
  | Exclude<AgentToolControllerActionResult, { readonly ok: true }>;

export type AgentToolWorkspaceSnapshot = {
  readonly currentUser: { readonly id: string } | null;
  readonly routeQrId: string | null;
  readonly guestView: boolean;
  readonly canonicalEditingId: string | null;
  readonly agentDraftProposal: { readonly lifeLinkId: string } | null;
  readonly selectedLifeLinkId: string | null;
  readonly selectedLifeLinkDetail: LifeLinkDetail | null;
  readonly lifeLinkSearchResults: readonly LifeLinkSearchItem[];
  readonly lifeLinkSearchTotalCount: number;
  readonly lifeLinkSearchNextCursor: string | null;
  readonly lifeLinkSearchTruncated: boolean;
  readonly findTargetId: string | null;
};

export type AgentInspectCurrentLifeLinkInput = {
  readonly lifeLinkId: string;
};

export type AgentSearchLifeLinksInput = {
  readonly query: string;
  readonly limit: number;
};

export type AgentOpenLifeLinkInput = {
  readonly lifeLinkId: string;
};

export type AgentStageLifeLinkDraftInput = {
  readonly lifeLinkId: string;
  readonly baseUpdatedAt: string;
  readonly title?: string;
  readonly body?: string;
  readonly sourceLifeLinkIds: readonly string[];
};

export type AgentStartFindModeInput = {
  readonly lifeLinkId: string;
};

export interface LifeLinksAgentToolController {
  getSnapshot(): AgentToolWorkspaceSnapshot;
  agentInspectCurrentLifeLink(
    input: AgentInspectCurrentLifeLinkInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentSearchLifeLinks(
    input: AgentSearchLifeLinksInput,
    signal?: AbortSignal
  ): Promise<AgentSearchLifeLinksControllerResult>;
  agentOpenLifeLink(
    input: AgentOpenLifeLinkInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentStageLifeLinkDraft(
    input: AgentStageLifeLinkDraftInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentStartFindMode(
    input: AgentStartFindModeInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
}

type AgentToolErrorCode =
  | "invalid_input"
  | "owner_workspace_unavailable"
  | "editor_open"
  | "no_life_link_selected"
  | "life_link_unavailable"
  | "stale_life_link"
  | "source_life_link_unavailable"
  | "qr_not_attached"
  | "cancelled"
  | "effect_not_applied";

export type AgentToolErrorResult = {
  readonly ok: false;
  readonly error: {
    readonly code: AgentToolErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
};

export type AgentInspectCurrentLifeLinkSuccess = {
  readonly ok: true;
  readonly lifeLink: {
    readonly id: string;
    readonly title: string;
    readonly parentId: string | null;
    readonly qrId: string | null;
    readonly privacy: "public" | "private";
    readonly updatedAt: string;
    readonly bodySummary: string;
    readonly childCount: number;
    readonly path: readonly { readonly id: string; readonly title: string }[];
    readonly pathTruncated: boolean;
    readonly pathOmittedCount: number;
    readonly children: readonly {
      readonly id: string;
      readonly title: string;
      readonly qrId: string | null;
      readonly childCount: number;
    }[];
    readonly childrenTruncated: boolean;
    readonly visibleChildCount: number;
  };
  readonly visibleEffect: "current_life_link_focused";
  readonly truncated: boolean;
};

export type AgentSearchLifeLinksSuccess = {
  readonly ok: true;
  readonly query: string;
  readonly results: readonly {
    readonly id: string;
    readonly title: string;
    readonly qrId: string | null;
    readonly recordedPath: string;
    readonly pathTruncated: boolean;
    readonly bodySummary: string;
    readonly matchClass: LifeLinkSearchItem["matchClass"];
  }[];
  readonly resultCount: number;
  readonly totalCount: number;
  readonly hasMore: boolean;
  readonly omittedCount: number;
  readonly visibleEffect: "search_results_highlighted";
  readonly truncated: boolean;
};

export type AgentOpenLifeLinkSuccess = {
  readonly ok: true;
  readonly lifeLinkId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly recordedPath: string;
  readonly pathTruncated: boolean;
  readonly visibleEffect: "life_link_opened";
  readonly truncated: boolean;
};

export type AgentDraftLifeLinkUpdateSuccess = {
  readonly ok: true;
  readonly lifeLinkId: string;
  readonly baseUpdatedAt: string;
  readonly proposedFields: readonly ("title" | "body")[];
  readonly sourceLifeLinkIds: readonly string[];
  readonly sourceIdsTruncated: boolean;
  readonly sourceIdsOmittedCount: number;
  readonly saved: false;
  readonly privacyChanged: false;
  readonly visibleEffect: "agent_draft_opened";
  readonly truncated: boolean;
};

export type AgentStartFindModeSuccess = {
  readonly ok: true;
  readonly lifeLinkId: string;
  readonly qrId: string;
  readonly visibleEffect: "find_mode_started";
  readonly cameraStarted: false;
  readonly truncated: false;
};

export type AgentInspectCurrentLifeLinkResult = AgentInspectCurrentLifeLinkSuccess | AgentToolErrorResult;
export type AgentSearchLifeLinksResult = AgentSearchLifeLinksSuccess | AgentToolErrorResult;
export type AgentOpenLifeLinkResult = AgentOpenLifeLinkSuccess | AgentToolErrorResult;
export type AgentDraftLifeLinkUpdateResult = AgentDraftLifeLinkUpdateSuccess | AgentToolErrorResult;
export type AgentStartFindModeResult = AgentStartFindModeSuccess | AgentToolErrorResult;

const ERROR_DETAILS: Readonly<Record<AgentToolErrorCode, { readonly message: string; readonly retryable: boolean }>> = {
  invalid_input: {
    message: "The tool input did not match the supported shape or bounds.",
    retryable: false
  },
  owner_workspace_unavailable: {
    message: "Open the signed-in owner workspace and enable Agent Access before using this tool.",
    retryable: true
  },
  editor_open: {
    message: "Finish or close the active Life Link editor before running this tool.",
    retryable: true
  },
  no_life_link_selected: {
    message: "Select a Life Link in the owner workspace before using this tool.",
    retryable: true
  },
  life_link_unavailable: {
    message: "That Life Link is not available in the current owner workspace.",
    retryable: false
  },
  stale_life_link: {
    message: "The selected Life Link changed. Re-open it before drafting.",
    retryable: true
  },
  source_life_link_unavailable: {
    message: "One or more draft source Life Links are not available to the current owner.",
    retryable: true
  },
  qr_not_attached: {
    message: "Attach a QR to that Life Link before starting Find Mode.",
    retryable: false
  },
  cancelled: {
    message: "The tool invocation was cancelled before its visible effect completed.",
    retryable: true
  },
  effect_not_applied: {
    message: "The requested visible workspace effect did not complete.",
    retryable: true
  }
};

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {}
} as const;

const LIFE_LINK_ID_PROPERTY = {
  type: "string",
  minLength: 1,
  maxLength: MAX_LIFE_LINK_ID_LENGTH,
  pattern: "^[A-Za-z0-9._:-]+$",
  description: "Stable Life Link ID in the signed-in owner's library."
} as const;

const SEARCH_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      minLength: 1,
      maxLength: MAX_SEARCH_QUERY_LENGTH,
      description: "Text to match against the owner's Life Links and recorded paths."
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIFE_LINK_TOOL_SEARCH_RESULTS,
      default: MAX_LIFE_LINK_TOOL_SEARCH_RESULTS,
      description: "Maximum results to return, capped at 10."
    }
  },
  required: ["query"]
} as const;

const LIFE_LINK_ID_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lifeLinkId: LIFE_LINK_ID_PROPERTY
  },
  required: ["lifeLinkId"]
} as const;

const DRAFT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lifeLinkId: LIFE_LINK_ID_PROPERTY,
    baseUpdatedAt: {
      type: "string",
      minLength: 1,
      maxLength: MAX_REVISION_LENGTH,
      description: "Exact updatedAt revision from the selected Life Link."
    },
    title: {
      type: "string",
      maxLength: MAX_TITLE_LENGTH,
      description: "Optional unsaved replacement title."
    },
    body: {
      type: "string",
      maxLength: MAX_BODY_LENGTH,
      description: "Optional unsaved replacement plain-text body."
    },
    sourceLifeLinkIds: {
      type: "array",
      maxItems: MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT,
      uniqueItems: true,
      items: LIFE_LINK_ID_PROPERTY,
      description: "Optional authorized Life Link IDs supporting the proposal."
    }
  },
  required: ["lifeLinkId", "baseUpdatedAt"],
  anyOf: [{ required: ["title"] }, { required: ["body"] }]
} as const;

export function createLifeLinksAgentToolCatalog(
  controller: LifeLinksAgentToolController
): readonly WebMcpToolDefinition[] {
  return [
    {
      name: LIFE_LINKS_AGENT_TOOL_NAMES[0],
      title: "Inspect current Life Link",
      description: "Inspect the exact Life Link visibly selected in the signed-in owner workspace.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, context = {}) => inspectCurrentLifeLink(controller, input, context)
    },
    {
      name: LIFE_LINKS_AGENT_TOOL_NAMES[1],
      title: "Search my Life Links",
      description: "Search the signed-in owner's Life Links and visibly show the bounded matching paths.",
      inputSchema: SEARCH_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input, context = {}) => searchMyLifeLinks(controller, input, context)
    },
    {
      name: LIFE_LINKS_AGENT_TOOL_NAMES[2],
      title: "Open Life Link",
      description: "Open one authorized Life Link by stable ID and visibly select its recorded path.",
      inputSchema: LIFE_LINK_ID_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input, context = {}) => openLifeLink(controller, input, context)
    },
    {
      name: LIFE_LINKS_AGENT_TOOL_NAMES[3],
      title: "Draft Life Link update",
      description: "Stage a revision-bound title or body proposal for human review without saving it.",
      inputSchema: DRAFT_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input, context = {}) => draftLifeLinkUpdate(controller, input, context)
    },
    {
      name: LIFE_LINKS_AGENT_TOOL_NAMES[4],
      title: "Start Find Mode",
      description: "Open Find Mode for one authorized QR-bound Life Link; the human performs the scan.",
      inputSchema: LIFE_LINK_ID_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input, context = {}) => startFindMode(controller, input, context)
    }
  ];
}

async function inspectCurrentLifeLink(
  controller: LifeLinksAgentToolController,
  input: unknown,
  context: WebMcpExecutionContext
): Promise<AgentInspectCurrentLifeLinkResult> {
  if (!isExactRecord(input, [])) {
    return failure("invalid_input");
  }
  const before = controller.getSnapshot();
  const accessFailure = ownerAccessFailure(before, context);
  if (accessFailure) {
    return accessFailure;
  }
  if (before.canonicalEditingId !== null) {
    return failure("editor_open");
  }
  const expectedOwnerId = before.currentUser!.id;
  const detail = exactSelectedDetail(before);
  if (!detail) {
    return failure("no_life_link_selected");
  }
  const action = await controller.agentInspectCurrentLifeLink({ lifeLinkId: detail.lifeLink.id }, context.signal);
  if (!action.ok) {
    return controllerFailure(action.code);
  }
  const after = controller.getSnapshot();
  const afterAccessFailure = ownerAccessFailure(after, context, expectedOwnerId);
  if (afterAccessFailure) {
    return afterAccessFailure;
  }
  const current = exactSelectedDetail(after);
  if (!current || current.lifeLink.id !== detail.lifeLink.id) {
    return failure("effect_not_applied");
  }
  return serializeInspection(current);
}

async function searchMyLifeLinks(
  controller: LifeLinksAgentToolController,
  input: unknown,
  context: WebMcpExecutionContext
): Promise<AgentSearchLifeLinksResult> {
  const parsed = parseSearchInput(input);
  if (!parsed) {
    return failure("invalid_input");
  }
  const before = controller.getSnapshot();
  const accessFailure = ownerAccessFailure(before, context);
  if (accessFailure) {
    return accessFailure;
  }
  if (before.canonicalEditingId !== null) {
    return failure("editor_open");
  }
  const expectedOwnerId = before.currentUser!.id;
  const action = await controller.agentSearchLifeLinks(parsed, context.signal);
  if (!action.ok) {
    return controllerFailure(action.code);
  }
  const after = controller.getSnapshot();
  const afterAccessFailure = ownerAccessFailure(after, context, expectedOwnerId);
  if (afterAccessFailure) {
    return afterAccessFailure;
  }
  return serializeSearch(action.search);
}

async function openLifeLink(
  controller: LifeLinksAgentToolController,
  input: unknown,
  context: WebMcpExecutionContext
): Promise<AgentOpenLifeLinkResult> {
  const parsed = parseLifeLinkIdInput(input);
  if (!parsed) {
    return failure("invalid_input");
  }
  const before = controller.getSnapshot();
  const accessFailure = ownerAccessFailure(before, context);
  if (accessFailure) {
    return accessFailure;
  }
  if (before.canonicalEditingId !== null) {
    return failure("editor_open");
  }
  const expectedOwnerId = before.currentUser!.id;
  const action = await controller.agentOpenLifeLink(parsed, context.signal);
  if (!action.ok) {
    return controllerFailure(action.code);
  }
  const after = controller.getSnapshot();
  const afterAccessFailure = ownerAccessFailure(after, context, expectedOwnerId);
  if (afterAccessFailure) {
    return afterAccessFailure;
  }
  const detail = exactSelectedDetail(after);
  if (!detail || detail.lifeLink.id !== parsed.lifeLinkId) {
    return failure("effect_not_applied");
  }
  return serializeOpen(detail);
}

async function draftLifeLinkUpdate(
  controller: LifeLinksAgentToolController,
  input: unknown,
  context: WebMcpExecutionContext
): Promise<AgentDraftLifeLinkUpdateResult> {
  const parsed = parseDraftInput(input);
  if (!parsed) {
    return failure("invalid_input");
  }
  const before = controller.getSnapshot();
  const accessFailure = ownerAccessFailure(before, context);
  if (accessFailure) {
    return accessFailure;
  }
  if (before.agentDraftProposal !== null) {
    return failure("editor_open");
  }
  const expectedOwnerId = before.currentUser!.id;
  const selected = exactSelectedDetail(before);
  if (!selected || selected.lifeLink.id !== parsed.lifeLinkId) {
    return failure("no_life_link_selected");
  }
  if (selected.lifeLink.updatedAt !== parsed.baseUpdatedAt) {
    return failure("stale_life_link");
  }
  const action = await controller.agentStageLifeLinkDraft(parsed, context.signal);
  if (!action.ok) {
    return controllerFailure(action.code);
  }
  const after = controller.getSnapshot();
  const afterAccessFailure = ownerAccessFailure(after, context, expectedOwnerId);
  if (afterAccessFailure) {
    return afterAccessFailure;
  }
  const current = exactSelectedDetail(after);
  if (
    !current ||
    current.lifeLink.id !== parsed.lifeLinkId ||
    current.lifeLink.updatedAt !== parsed.baseUpdatedAt
  ) {
    return failure("stale_life_link");
  }
  return serializeDraft(parsed);
}

async function startFindMode(
  controller: LifeLinksAgentToolController,
  input: unknown,
  context: WebMcpExecutionContext
): Promise<AgentStartFindModeResult> {
  const parsed = parseLifeLinkIdInput(input);
  if (!parsed) {
    return failure("invalid_input");
  }
  const before = controller.getSnapshot();
  const accessFailure = ownerAccessFailure(before, context);
  if (accessFailure) {
    return accessFailure;
  }
  if (before.canonicalEditingId !== null) {
    return failure("editor_open");
  }
  const expectedOwnerId = before.currentUser!.id;
  const action = await controller.agentStartFindMode(parsed, context.signal);
  if (!action.ok) {
    return controllerFailure(action.code);
  }
  const after = controller.getSnapshot();
  const afterAccessFailure = ownerAccessFailure(after, context, expectedOwnerId);
  if (afterAccessFailure) {
    return afterAccessFailure;
  }
  const detail = exactSelectedDetail(after);
  const qrId = detail?.lifeLink.qrId ?? null;
  if (!detail || detail.lifeLink.id !== parsed.lifeLinkId || !qrId) {
    return failure("effect_not_applied");
  }
  if (after.findTargetId !== qrId) {
    return failure("effect_not_applied");
  }
  return bounded({
    ok: true,
    lifeLinkId: detail.lifeLink.id,
    qrId,
    visibleEffect: "find_mode_started",
    cameraStarted: false,
    truncated: false
  } as const);
}

function parseSearchInput(input: unknown): AgentSearchLifeLinksInput | null {
  if (!isExactRecord(input, ["query", "limit"])) {
    return null;
  }
  const query = input.query;
  const limit = input.limit ?? MAX_LIFE_LINK_TOOL_SEARCH_RESULTS;
  if (typeof query !== "string") {
    return null;
  }
  const normalized = query.trim();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_SEARCH_QUERY_LENGTH ||
    !Number.isInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > MAX_LIFE_LINK_TOOL_SEARCH_RESULTS
  ) {
    return null;
  }
  return { query: normalized, limit: limit as number };
}

function parseLifeLinkIdInput(input: unknown): { readonly lifeLinkId: string } | null {
  if (!isExactRecord(input, ["lifeLinkId"]) || !isLifeLinkId(input.lifeLinkId)) {
    return null;
  }
  return { lifeLinkId: input.lifeLinkId };
}

function parseDraftInput(input: unknown): AgentStageLifeLinkDraftInput | null {
  if (!isExactRecord(input, ["lifeLinkId", "baseUpdatedAt", "title", "body", "sourceLifeLinkIds"])) {
    return null;
  }
  const hasTitle = Object.prototype.hasOwnProperty.call(input, "title");
  const hasBody = Object.prototype.hasOwnProperty.call(input, "body");
  if (!isLifeLinkId(input.lifeLinkId) || !isRevision(input.baseUpdatedAt) || (!hasTitle && !hasBody)) {
    return null;
  }
  if (hasTitle && (typeof input.title !== "string" || input.title.length > MAX_TITLE_LENGTH)) {
    return null;
  }
  if (hasBody && (typeof input.body !== "string" || input.body.length > MAX_BODY_LENGTH)) {
    return null;
  }
  const sourceLifeLinkIds = input.sourceLifeLinkIds ?? [];
  if (
    !Array.isArray(sourceLifeLinkIds) ||
    sourceLifeLinkIds.length > MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT ||
    sourceLifeLinkIds.some((id) => !isLifeLinkId(id)) ||
    new Set(sourceLifeLinkIds).size !== sourceLifeLinkIds.length
  ) {
    return null;
  }
  return {
    lifeLinkId: input.lifeLinkId,
    baseUpdatedAt: input.baseUpdatedAt,
    ...(hasTitle ? { title: input.title as string } : {}),
    ...(hasBody ? { body: input.body as string } : {}),
    sourceLifeLinkIds
  };
}

function isRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_REVISION_LENGTH &&
    Number.isFinite(Date.parse(value))
  );
}

function isLifeLinkId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_LIFE_LINK_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isExactRecord(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function exactSelectedDetail(snapshot: AgentToolWorkspaceSnapshot): LifeLinkDetail | null {
  const detail = snapshot.selectedLifeLinkDetail;
  return detail && snapshot.selectedLifeLinkId === detail.lifeLink.id ? detail : null;
}

function ownerAccessFailure(
  snapshot: AgentToolWorkspaceSnapshot,
  context: WebMcpExecutionContext,
  expectedOwnerId?: string
): AgentToolErrorResult | null {
  if (context.signal?.aborted) {
    return failure("cancelled");
  }
  if (
    !snapshot.currentUser ||
    snapshot.routeQrId !== null ||
    snapshot.guestView ||
    (expectedOwnerId !== undefined && snapshot.currentUser.id !== expectedOwnerId)
  ) {
    return failure("owner_workspace_unavailable");
  }
  return null;
}

function controllerFailure(code: AgentToolControllerFailureCode): AgentToolErrorResult {
  return failure(code);
}

function failure(code: AgentToolErrorCode): AgentToolErrorResult {
  const detail = ERROR_DETAILS[code];
  return bounded({ ok: false, error: { code, ...detail } });
}

function serializeInspection(detail: LifeLinkDetail): AgentInspectCurrentLifeLinkSuccess {
  const selectedSummary = [...detail.ancestry.items]
    .reverse()
    .find((item) => item.id === detail.lifeLink.id);
  const sourcePath = detail.ancestry.items.map((item) => ({ id: item.id, title: clip(item.title, MAX_RESULT_TITLE_LENGTH) }));
  const sourceChildren = detail.children.map((item) => ({
    id: item.id,
    title: clip(item.title, MAX_RESULT_TITLE_LENGTH),
    qrId: item.qrId,
    childCount: item.childCount
  }));
  let path = [...sourcePath];
  let children = [...sourceChildren];
  for (;;) {
    const result = {
      ok: true,
      lifeLink: {
        id: detail.lifeLink.id,
        title: clip(detail.lifeLink.title, MAX_RESULT_TITLE_LENGTH),
        parentId: detail.lifeLink.parentId,
        qrId: detail.lifeLink.qrId,
        privacy: detail.lifeLink.privacy,
        updatedAt: detail.lifeLink.updatedAt,
        bodySummary: clip(detail.lifeLink.body.replace(/\s+/g, " ").trim(), MAX_RESULT_BODY_SUMMARY_LENGTH),
        childCount: selectedSummary?.childCount ?? detail.children.length,
        path,
        pathTruncated: detail.ancestry.truncated || path.length < sourcePath.length,
        pathOmittedCount: detail.ancestry.omittedCount + sourcePath.length - path.length,
        children,
        childrenTruncated: detail.childrenPage.truncated || children.length < sourceChildren.length,
        visibleChildCount: children.length
      },
      visibleEffect: "current_life_link_focused",
      truncated:
        detail.ancestry.truncated ||
        detail.childrenPage.truncated ||
        path.length < sourcePath.length ||
        children.length < sourceChildren.length
    } as const;
    if (withinBudget(result)) {
      return result;
    }
    if (children.length > 0) {
      children = children.slice(0, -1);
      continue;
    }
    if (path.length > 2) {
      path = [path[0], ...path.slice(2)];
      continue;
    }
    if (path.length > 0) {
      path = path.slice(0, -1);
      continue;
    }
    throw new Error("Unable to serialize inspect_current_life_link within the Life Links output budget.");
  }
}

function serializeSearch(search: AgentLifeLinkSearchPayload): AgentSearchLifeLinksSuccess {
  const sourceItems = search.results.map((item) => {
    const recordedPath = formatRecordedLifeLinkPath(item.path);
    return {
      id: item.lifeLink.id,
      title: clip(item.lifeLink.title, MAX_RESULT_TITLE_LENGTH),
      qrId: item.lifeLink.qrId,
      recordedPath: clip(recordedPath, MAX_RESULT_PATH_LENGTH),
      pathTruncated: item.path.truncated || recordedPath.length > MAX_RESULT_PATH_LENGTH,
      bodySummary: clip(item.bodySummary, MAX_RESULT_BODY_SUMMARY_LENGTH),
      matchClass: item.matchClass
    };
  });
  let items = [...sourceItems];
  for (;;) {
    const omittedCount = Math.max(0, search.totalCount - items.length);
    const hasMore =
      search.nextCursor !== null ||
      search.truncated ||
      search.hasMore ||
      items.length < sourceItems.length ||
      omittedCount > 0;
    const result = {
      ok: true,
      query: search.query,
      results: items,
      resultCount: items.length,
      totalCount: search.totalCount,
      hasMore,
      omittedCount,
      visibleEffect: "search_results_highlighted",
      truncated: hasMore || items.some((item) => item.pathTruncated)
    } as const;
    if (withinBudget(result)) {
      return result;
    }
    if (items.length > 0) {
      items = items.slice(0, -1);
      continue;
    }
    throw new Error("Unable to serialize search_my_life_links within the Life Links output budget.");
  }
}

function serializeOpen(detail: LifeLinkDetail): AgentOpenLifeLinkSuccess {
  const recordedPath = formatRecordedLifeLinkPath(detail.ancestry);
  const result = {
    ok: true,
    lifeLinkId: detail.lifeLink.id,
    title: clip(detail.lifeLink.title, MAX_RESULT_TITLE_LENGTH),
    updatedAt: detail.lifeLink.updatedAt,
    recordedPath: clip(recordedPath, MAX_RESULT_PATH_LENGTH),
    pathTruncated: detail.ancestry.truncated || recordedPath.length > MAX_RESULT_PATH_LENGTH,
    visibleEffect: "life_link_opened",
    truncated: detail.ancestry.truncated || recordedPath.length > MAX_RESULT_PATH_LENGTH
  } as const;
  return bounded(result);
}

function serializeDraft(input: AgentStageLifeLinkDraftInput): AgentDraftLifeLinkUpdateSuccess {
  const sourceIds = [...input.sourceLifeLinkIds];
  const proposedFields: Array<"title" | "body"> = [
    ...(input.title !== undefined ? (["title"] as const) : []),
    ...(input.body !== undefined ? (["body"] as const) : [])
  ];
  for (;;) {
    const result = {
      ok: true,
      lifeLinkId: input.lifeLinkId,
      baseUpdatedAt: input.baseUpdatedAt,
      proposedFields,
      sourceLifeLinkIds: sourceIds,
      sourceIdsTruncated: sourceIds.length < input.sourceLifeLinkIds.length,
      sourceIdsOmittedCount: input.sourceLifeLinkIds.length - sourceIds.length,
      saved: false,
      privacyChanged: false,
      visibleEffect: "agent_draft_opened",
      truncated: sourceIds.length < input.sourceLifeLinkIds.length
    } as const;
    if (withinBudget(result)) {
      return result;
    }
    if (sourceIds.length > 0) {
      sourceIds.pop();
      continue;
    }
    throw new Error("Unable to serialize draft_life_link_update within the Life Links output budget.");
  }
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return ".".repeat(maxLength);
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function bounded<T extends WebMcpJsonValue>(value: T): T {
  if (!withinBudget(value)) {
    throw new Error("Life Links tool output exceeded the 1.5 KB contract.");
  }
  return value;
}

function withinBudget(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_LIFE_LINK_TOOL_OUTPUT_BYTES;
}
