import type { WebMcpJsonValue, WebMcpToolDefinition } from "../webmcpCompatibility";
import {
  LIFE_LINKS_PAGE_TOOL_NAMES,
  type LifeLinksPageToolName
} from "./browserWebMcpHost";

export const LIFE_LINKS_AGENT_TOOL_NAMES = LIFE_LINKS_PAGE_TOOL_NAMES;

export type LifeLinksAgentToolName = LifeLinksPageToolName;

export type AgentActivityVisibleEffect =
  | "current_life_link_focused"
  | "search_results_shown"
  | "life_link_opened"
  | "unsaved_draft_staged"
  | "find_mode_started";

export type AgentActivityOutcome = "succeeded" | "failed" | "cancelled";

export type AgentActivityEntry = {
  id: string;
  tool: LifeLinksAgentToolName;
  occurredAt: string;
  outcome: AgentActivityOutcome;
  affectedLifeLinkIds: string[];
  visibleEffect: AgentActivityVisibleEffect | null;
  errorCode: string | null;
};

export type AgentActivityInput = Omit<AgentActivityEntry, "id" | "occurredAt" | "affectedLifeLinkIds"> & {
  affectedLifeLinkIds?: readonly string[];
};

const MAX_ACTIVITY_IDS = 10;
const MAX_ACTIVITY_ID_LENGTH = 96;

export function createAgentActivityEntry(
  input: AgentActivityInput,
  options: { id?: string; occurredAt?: string } = {}
): AgentActivityEntry {
  return {
    id: options.id ?? createActivityId(),
    tool: input.tool,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    outcome: input.outcome,
    affectedLifeLinkIds: Array.from(new Set(input.affectedLifeLinkIds ?? []))
      .filter((value) => typeof value === "string" && value.length > 0)
      .slice(0, MAX_ACTIVITY_IDS)
      .map((value) => value.slice(0, MAX_ACTIVITY_ID_LENGTH)),
    visibleEffect: input.visibleEffect,
    errorCode: input.errorCode ? input.errorCode.slice(0, 80) : null
  };
}

export function agentActivityLabel(entry: AgentActivityEntry) {
  if (entry.outcome === "failed") {
    return `${toolLabel(entry.tool)} could not complete`;
  }
  if (entry.outcome === "cancelled") {
    return `${toolLabel(entry.tool)} was cancelled`;
  }
  if (entry.visibleEffect === "current_life_link_focused") {
    return "Inspected the selected Life Link";
  }
  if (entry.visibleEffect === "search_results_shown") {
    return "Showed bounded Life Link search results";
  }
  if (entry.visibleEffect === "life_link_opened") {
    return "Opened a Life Link in the workspace";
  }
  if (entry.visibleEffect === "unsaved_draft_staged") {
    return "Staged an unsaved Life Link draft";
  }
  return "Started Find Mode for a Life Link";
}

export function instrumentAgentToolCatalog(
  definitions: readonly WebMcpToolDefinition[],
  onActivity: (entry: AgentActivityEntry) => void
): readonly WebMcpToolDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    execute: async (input, context = {}): Promise<WebMcpJsonValue> => {
      const tool = lifeLinksToolName(definition.name);
      if (!tool) {
        throw new Error("Only the fixed Life Links page-tool catalog can be instrumented.");
      }
      try {
        const result = await definition.execute(input, context);
        onActivity(activityFromResult(tool, result));
        return result;
      } catch (error) {
        onActivity(createAgentActivityEntry({
          tool,
          outcome: context.signal?.aborted ? "cancelled" : "failed",
          affectedLifeLinkIds: [],
          visibleEffect: null,
          errorCode: context.signal?.aborted ? "cancelled" : "unexpected_error"
        }));
        throw error;
      }
    }
  }));
}

function activityFromResult(tool: LifeLinksAgentToolName, result: WebMcpJsonValue) {
  const record = objectRecord(result);
  if (record?.ok !== true) {
    const error = objectRecord(record?.error);
    const errorCode = typeof error?.code === "string" ? error.code : "effect_not_applied";
    return createAgentActivityEntry({
      tool,
      outcome: errorCode === "cancelled" ? "cancelled" : "failed",
      affectedLifeLinkIds: [],
      visibleEffect: null,
      errorCode
    });
  }
  return createAgentActivityEntry({
    tool,
    outcome: "succeeded",
    affectedLifeLinkIds: affectedIds(tool, record),
    visibleEffect: visibleEffectForTool(tool),
    errorCode: null
  });
}

function affectedIds(tool: LifeLinksAgentToolName, result: Record<string, unknown>) {
  if (tool === "inspect_current_life_link") {
    const lifeLink = objectRecord(result.lifeLink);
    return typeof lifeLink?.id === "string" ? [lifeLink.id] : [];
  }
  if (tool === "search_my_life_links") {
    return Array.isArray(result.results)
      ? result.results
          .map((item) => objectRecord(item)?.id)
          .filter((id): id is string => typeof id === "string")
      : [];
  }
  return typeof result.lifeLinkId === "string" ? [result.lifeLinkId] : [];
}

function visibleEffectForTool(tool: LifeLinksAgentToolName): AgentActivityVisibleEffect {
  switch (tool) {
    case "inspect_current_life_link":
      return "current_life_link_focused";
    case "search_my_life_links":
      return "search_results_shown";
    case "open_life_link":
      return "life_link_opened";
    case "draft_life_link_update":
      return "unsaved_draft_staged";
    case "start_find_mode":
      return "find_mode_started";
  }
}

function lifeLinksToolName(value: string): LifeLinksAgentToolName | null {
  return LIFE_LINKS_AGENT_TOOL_NAMES.includes(value as LifeLinksAgentToolName)
    ? value as LifeLinksAgentToolName
    : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolLabel(tool: LifeLinksAgentToolName) {
  switch (tool) {
    case "inspect_current_life_link":
      return "Inspect";
    case "search_my_life_links":
      return "Search";
    case "open_life_link":
      return "Open";
    case "draft_life_link_update":
      return "Draft";
    case "start_find_mode":
      return "Find Mode";
  }
}

function createActivityId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `agent-activity-${Date.now()}`;
}
