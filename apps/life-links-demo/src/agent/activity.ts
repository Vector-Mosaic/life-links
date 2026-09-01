import type { WebMcpJsonValue, WebMcpToolDefinition } from "../webmcpCompatibility";
import {
  LIFE_LINKS_PAGE_TOOL_NAMES,
  type LifeLinksPageToolName
} from "./browserWebMcpHost";

export const LIFE_LINKS_AGENT_TOOL_NAMES = LIFE_LINKS_PAGE_TOOL_NAMES;

export type LifeLinksAgentToolName = LifeLinksPageToolName;

export type AgentActivityVisibleEffect =
  | "attachment_content_read"
  | "attachment_image_described"
  | "attachment_image_bytes_ready"
  | "life_link_change_previewed"
  | "life_link_change_applied"
  | "current_life_link_focused"
  | "search_results_shown"
  | "life_link_opened"
  | "life_link_content_updated"
  | "find_mode_started"
  | "life_link_created" | "life_link_moved" | "life_link_qr_updated"
  | "collections_opened" | "collection_opened" | "collection_updated"
  | "calendars_opened" | "calendar_events_shown" | "calendar_event_opened"
  | "calendar_event_created" | "calendar_event_updated"
  | "calendar_deletion_previewed" | "calendar_event_deleted";

export type AgentActivityOutcome = "succeeded" | "failed" | "cancelled";

export type AgentActivityEntry = {
  id: string;
  tool: LifeLinksAgentToolName;
  occurredAt: string;
  outcome: AgentActivityOutcome;
  affectedLifeLinkIds: string[];
  affectedCollectionIds: string[];
  affectedCalendarIds: string[];
  affectedCalendarEventIds: string[];
  visibleEffect: AgentActivityVisibleEffect | null;
  errorCode: string | null;
};

export type AgentActivityInput = Omit<AgentActivityEntry, "id" | "occurredAt" | "affectedLifeLinkIds" | "affectedCollectionIds" | "affectedCalendarIds" | "affectedCalendarEventIds"> & {
  affectedLifeLinkIds?: readonly string[];
  affectedCollectionIds?: readonly string[];
  affectedCalendarIds?: readonly string[];
  affectedCalendarEventIds?: readonly string[];
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
    affectedCollectionIds: Array.from(new Set(input.affectedCollectionIds ?? [])).filter((value) => typeof value === "string" && value.length > 0).slice(0, MAX_ACTIVITY_IDS).map((value) => value.slice(0, MAX_ACTIVITY_ID_LENGTH)),
    affectedCalendarIds: boundedIds(input.affectedCalendarIds),
    affectedCalendarEventIds: boundedIds(input.affectedCalendarEventIds),
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
  if (entry.visibleEffect === "life_link_content_updated") {
    return "Updated Life Link content";
  }
  const labels: Partial<Record<AgentActivityVisibleEffect, string>> = {
    attachment_content_read: "Read attachment information",
    attachment_image_described: "Read attachment image metadata",
    attachment_image_bytes_ready: "Prepared attachment image bytes for the agent",
    life_link_change_previewed: "Prepared an exact move or deletion preview", life_link_change_applied: "Applied a confirmed Life Link change",
    life_link_created: "Created a Life Link", life_link_moved: "Moved a Life Link", life_link_qr_updated: "Updated QR or public view",
    collections_opened: "Opened My Collections", collection_opened: "Opened a Collection", collection_updated: "Updated a Collection",
    calendars_opened: "Opened authorized Calendars", calendar_events_shown: "Showed a bounded Calendar event window",
    calendar_event_opened: "Opened a Calendar event", calendar_event_created: "Created a Calendar event",
    calendar_event_updated: "Updated a Calendar event", calendar_deletion_previewed: "Prepared an exact Calendar deletion preview",
    calendar_event_deleted: "Applied an app-confirmed Calendar event deletion"
  };
  if (entry.visibleEffect && labels[entry.visibleEffect]) return labels[entry.visibleEffect]!;
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
    affectedCollectionIds: typeof record.collectionId === "string" ? [record.collectionId] : objectRecord(record.collection)?.id ? [String(objectRecord(record.collection)!.id)] : Array.isArray(record.collections) ? record.collections.map((item) => objectRecord(item)?.id).filter((id): id is string => typeof id === "string") : [],
    affectedCalendarIds: calendarIds(record),
    affectedCalendarEventIds: calendarEventIds(record),
    visibleEffect: tool === "read_life_link_attachment" && record.status === "bytes_ready" ? "attachment_image_bytes_ready" :
      tool === "read_life_link_attachment" && record.status === "described" ? "attachment_image_described" : visibleEffectForTool(tool),
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
    case "read_life_link_attachment": return "attachment_content_read";
    case "prepare_life_link_change": return "life_link_change_previewed";
    case "apply_life_link_change": return "life_link_change_applied";
    case "inspect_current_life_link":
      return "current_life_link_focused";
    case "search_my_life_links":
      return "search_results_shown";
    case "open_life_link":
      return "life_link_opened";
    case "update_life_link_content":
      return "life_link_content_updated";
    case "start_find_mode":
      return "find_mode_started";
    case "create_life_link": return "life_link_created";
    case "move_life_link": return "life_link_moved";
    case "manage_life_link_qr": return "life_link_qr_updated";
    case "list_my_collections": return "collections_opened";
    case "inspect_collection": return "collection_opened";
    case "maintain_collection": return "collection_updated";
    case "list_my_calendars": return "calendars_opened";
    case "query_my_calendar_events": return "calendar_events_shown";
    case "inspect_calendar_event": return "calendar_event_opened";
    case "create_calendar_event": return "calendar_event_created";
    case "update_calendar_event": return "calendar_event_updated";
    case "prepare_calendar_event_deletion": return "calendar_deletion_previewed";
    case "apply_calendar_event_deletion": return "calendar_event_deleted";
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
    case "read_life_link_attachment": return "Read attachment";
    case "prepare_life_link_change": return "Preview change";
    case "apply_life_link_change": return "Apply change";
    case "inspect_current_life_link":
      return "Inspect";
    case "search_my_life_links":
      return "Search";
    case "open_life_link":
      return "Open";
    case "update_life_link_content":
      return "Update";
    case "start_find_mode":
      return "Find Mode";
    case "create_life_link": return "Create Life Link";
    case "move_life_link": return "Move Life Link";
    case "manage_life_link_qr": return "Manage QR";
    case "list_my_collections": return "List Collections";
    case "inspect_collection": return "Inspect Collection";
    case "maintain_collection": return "Maintain Collection";
    case "list_my_calendars": return "List Calendars";
    case "query_my_calendar_events": return "Query Calendar";
    case "inspect_calendar_event": return "Inspect Calendar event";
    case "create_calendar_event": return "Create Calendar event";
    case "update_calendar_event": return "Update Calendar event";
    case "prepare_calendar_event_deletion": return "Preview Calendar deletion";
    case "apply_calendar_event_deletion": return "Delete Calendar event";
  }
}

function boundedIds(values: readonly string[] | undefined): string[] {
  return Array.from(new Set(values ?? []))
    .filter((value) => typeof value === "string" && value.length > 0)
    .slice(0, MAX_ACTIVITY_IDS)
    .map((value) => value.slice(0, MAX_ACTIVITY_ID_LENGTH));
}

function calendarIds(result: Record<string, unknown>): string[] {
  const calendar = objectRecord(result.calendar);
  const event = objectRecord(result.event);
  const direct = typeof result.calendarId === "string" ? [result.calendarId] : [];
  const one = typeof calendar?.id === "string" ? [calendar.id] : typeof event?.calendarId === "string" ? [event.calendarId] : [];
  const many = Array.isArray(result.calendars)
    ? result.calendars.map((item) => objectRecord(item)?.id).filter((id): id is string => typeof id === "string")
    : Array.isArray(result.instances)
      ? result.instances.map((item) => objectRecord(item)?.calendarId).filter((id): id is string => typeof id === "string")
      : [];
  return [...direct, ...one, ...many];
}

function calendarEventIds(result: Record<string, unknown>): string[] {
  const event = objectRecord(result.event);
  const direct = typeof result.eventId === "string" ? [result.eventId] : [];
  const one = typeof event?.id === "string" ? [event.id] : [];
  const many = Array.isArray(result.instances)
    ? result.instances.map((item) => objectRecord(item)?.eventId).filter((id): id is string => typeof id === "string")
    : [];
  return [...direct, ...one, ...many];
}

function createActivityId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `agent-activity-${Date.now()}`;
}
