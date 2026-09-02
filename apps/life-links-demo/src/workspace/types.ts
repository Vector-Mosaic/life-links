import type {
  AttachmentContentPage,
  AttachmentImageReadOptions,
  AttachmentImageResult,
  ActivityRecord,
  CalendarEventTombstoneRecord,
  CalendarRecord,
  CalendarAuthorizationDiscovery,
  CalendarProviderBindingView,
  CalendarProviderEventProjection,
  CalendarConnectionView,
  CalendarConnectedCalendarView,
  CalendarProviderAvailability,
  CanonicalRoutineCreation,
  LifeLinkMediaRecord,
  ChangeHistory,
  LifeLinkChangePreview,
  CollectionChangePreview,
  CollectionRecord,
  CollectionSectionRecord,
  LifeLinkCollectionMembership,
  LifeLinkContext,
  LifeLinkDetail,
  LifeLinkRecord,
  LifeLinkSearchItem,
  LifeLinkSummary,
  PublicFieldKey,
  LinkRecord,
  QrViewState,
  RoutineGroupRecord,
  RoutineOccurrenceRecord,
  RoutineSummaryRecord,
  RoutineRunRecord,
  RoutineScheduleRecord,
  RoutineSessionProjection,
  UpdateLifeLinkPatch
} from "@life-links/core";

import type { ApiAgentConnection, ApiUser, CalendarClock, CalendarEventDetail } from "../api";
import type { AgentCalendarDeletionPreview, AgentProviderCalendarDeletionPreview } from "../agent/calendarToolHandlers";
import type { RoutineDeletionPreview } from "../agent/workspaceToolHandlers";

export type AgentWorkspaceChangeConfirmation = (
  | { kind: "collection"; preview: CollectionChangePreview }
  | { kind: "routines"; preview: RoutineDeletionPreview }
) & { saving: boolean; error: string; removedIds: string[] };

export type WorkspaceView = "home" | "factory" | "scan" | "workspace" | "search";
export type InventoryFilter = "all" | "claimed" | "unclaimed";
export type ScanTone = "neutral" | "success" | "warning";
export type ThemeMode = "light" | "dark";

export type ScanMessage = {
  tone: ScanTone;
  title: string;
  detail: string;
};

export type LifeLinkBranchState = {
  items: LifeLinkSummary[];
  nextCursor: string | null;
  truncated: boolean;
  loaded: boolean;
  loading: boolean;
};

export type AgentToolControllerActionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "cancelled"
        | "editor_open"
        | "editor_dirty"
        | "life_link_unavailable"
        | "stale_life_link"
        | "source_life_link_unavailable"
        | "qr_not_attached"
        | "stale_collection"
        | "collection_unavailable"
        | "invalid_operation"
        | "effect_not_applied";
    };

export type AgentLifeLinkSearchPayload = {
  query: string;
  results: LifeLinkSearchItem[];
  totalCount: number;
  truncated: boolean;
  hasMore: boolean;
  nextCursor: string | null;
};

export type AgentSearchLifeLinksControllerResult =
  | { ok: true; search: AgentLifeLinkSearchPayload }
  | Exclude<AgentToolControllerActionResult, { ok: true }>;

export type AgentReadAttachmentInput = {
  lifeLinkId: string;
  mediaId?: string;
  representation?: never;
  offset?: number;
  revision?: string;
} | { lifeLinkId: string; mediaId: string; representation: "transcript"; offset?: number; revision?: string;
  startMs?: number; durationMs?: number; audioStreamIndex?: number }
  | ({ lifeLinkId: string; mediaId: string; representation: "image"; offset?: never; revision?: never } & AttachmentImageReadOptions);

export type AgentReadAttachmentResult =
  | { ok: true; kind: "list"; attachments: LifeLinkMediaRecord[]; revision: string }
  | { ok: true; kind: "content"; page: AttachmentContentPage }
  | { ok: true; kind: "image"; result: AttachmentImageResult }
  | Exclude<AgentToolControllerActionResult, { ok: true }>;

export type AgentUpdateLifeLinkContentInput = {
  lifeLinkId: string;
  baseUpdatedAt: string;
  title?: string;
  body?: string;
  context?: LifeLinkContext;
  sourceLifeLinkIds: readonly string[];
};

export type WorkspaceCommandOptions = {
  signal?: AbortSignal;
  throwOnError?: boolean;
  assertActive?: () => void;
};
export type AgentCreateLifeLinkInput = {
  id: string; parentId: string | null; browsingRole: "container" | "item";
  title: string; body?: string; context?: LifeLinkContext;
};
export type AgentMoveLifeLinkInput = { lifeLinkId: string; baseUpdatedAt: string; parentId: string | null };
export type AgentManageLifeLinkQrInput = { lifeLinkId: string; baseUpdatedAt: string } & (
  | { action: "attach" | "change"; commandId: string; qrId: string }
  | { action: "detach"; commandId: string }
  | { action: "set_public_projection"; privacy: "private" | "public"; publicFieldKeys: PublicFieldKey[] }
);
export type AgentListCollectionsInput = { limit: number; cursor?: string };
export type AgentInspectCollectionInput = {
  collectionId: string; limit?: number;
  part?: "members" | "sections" | "assignments"; cursor?: string;
};
export type AgentMaintainCollectionInput =
  | { action: "create_collection"; id: string; title: string; purpose?: string; notes?: string }
  | ({ collectionId: string; baseUpdatedAt: string } & (
    | { action: "update_collection"; title?: string; purpose?: string; notes?: string }
    | { action: "add_member" | "remove_member"; lifeLinkId: string }
    | { action: "create_section"; id: string; title: string }
    | { action: "update_section"; sectionId: string; title: string }
    | { action: "remove_section"; sectionId: string }
    | { action: "replace_sections"; lifeLinkId: string; sectionIds: string[] }
  ));
export type AgentCollectionListResult =
  | { ok: true; collections: CollectionRecord[]; nextCursor: string | null; truncated: boolean }
  | Exclude<AgentToolControllerActionResult, { ok: true }>;

export type RoutineWorkspaceState = {
  presentation: {
    tab: "routines" | "history";
    historyRoutineId: string | null;
    showRemoved: boolean;
    collapsedGroupIds: string[];
  };
  history: {
    routineId: string | null;
    sessions: RoutineSessionProjection[];
    nextCursor: string | null;
    loaded: boolean;
    loading: boolean;
    error: string;
  };
  groups: RoutineGroupRecord[];
  groupsNextCursor: string | null;
  activities: ActivityRecord[];
  activitiesNextCursor: string | null;
  routines: RoutineSummaryRecord[];
  routinesNextCursor: string | null;
  selectedRoutine: CanonicalRoutineCreation | null;
  schedules: RoutineScheduleRecord[];
  schedulesNextCursor: string | null;
  occurrences: RoutineOccurrenceRecord[];
  occurrencesNextCursor: string | null;
  calendarOccurrences: RoutineOccurrenceRecord[];
  calendarRange: { startDate: string; endDate: string } | null;
  calendarLoading: boolean;
  calendarError: string;
  activeRun: RoutineRunRecord | null;
  sessions: RoutineSessionProjection[];
  sessionsNextCursor: string | null;
  selectedSession: RoutineSessionProjection | null;
  includeArchived: boolean;
  loading: boolean;
  error: string;
};

export type CalendarWorkspaceState = {
  connectionFlow: {
    authorizationId: string | null;
    connectionId: string | null;
    discovery: CalendarAuthorizationDiscovery | null;
    loading: boolean;
    error: string;
    feedback: string;
  };
  connectionManagement: {
    providers: CalendarProviderAvailability[];
    connections: CalendarConnectionView[];
    calendars: CalendarConnectedCalendarView[];
    loading: boolean;
    loaded: boolean;
    error: string;
  };
  clock: CalendarClock | null;
  calendars: CalendarRecord[];
  providerBindings: CalendarProviderBindingView[];
  providerEvents: CalendarProviderEventProjection[];
  selectedProviderEvent: CalendarProviderEventProjection | null;
  calendarsNextCursor: string | null;
  calendarsComplete: boolean;
  events: CalendarEventDetail[];
  eventsNextCursor: string | null;
  eventsComplete: boolean;
  range: { startDate: string; endDate: string } | null;
  selectedEvent: CalendarEventDetail | null;
  latestTombstone: CalendarEventTombstoneRecord | null;
  loading: boolean;
  error: string;
};

export type WorkspacePeer = "hierarchies" | "collections" | "routines" | "calendar";
export type WorkspacePeerPresentation = {
  pathname: string | null;
  middleCollapsed: boolean;
  detailsOpen: boolean;
  middleScrollTop: number;
  detailsScrollTop: number;
};
export type CollectionPresentation = {
  view: "sections" | "locations" | "all";
  expandedGroups: string[];
};
export type CalendarPresentation = {
  view: "month" | "week" | "day" | "agenda";
  timeZone: string | null;
  anchorDate: string | null;
  selectedDate: string | null;
  hiddenNativeCalendarIds: string[];
  selectedEventKey: string | null;
};
/** Owner-session UI preferences and references only; never a cached domain or permission snapshot. */
export type WorkspacePresentation = {
  peers: Record<WorkspacePeer, WorkspacePeerPresentation>;
  collections: Record<string, CollectionPresentation>;
  calendar: CalendarPresentation;
  routineDetails: { kind: "routine" | "session"; sessionId: string | null };
  restoreRevision: number;
};

export type LifeLinksWorkspaceSnapshot = {
  presentation: WorkspacePresentation;
  middleCollapsed: boolean;
  changeHistory: ChangeHistory;
  agentChangeConfirmation: LifeLinkChangePreview | null;
  agentWorkspaceChangeConfirmation: AgentWorkspaceChangeConfirmation | null;
  agentCalendarDeletionConfirmation: AgentCalendarDeletionPreview | AgentProviderCalendarDeletionPreview | null;
  routineWorkspace: RoutineWorkspaceState;
  calendarWorkspace: CalendarWorkspaceState;
  workspaceMode: "hierarchies" | "collections" | "routines" | "calendar";
  hierarchyParentId: string | null;
  hierarchyParentDetail: LifeLinkDetail | null;
  detailsOpen: boolean;
  collections: CollectionRecord[];
  collectionsLoading: boolean;
  collectionsComplete: boolean;
  selectedCollection: CollectionRecord | null;
  collectionMembers: LifeLinkRecord[];
  collectionSections: CollectionSectionRecord[];
  collectionMemberMemberships: Record<string, LifeLinkCollectionMembership[]>;
  collectionMemberDetails: Record<string, LifeLinkDetail>;
  collectionLoading: boolean;
  collectionComplete: boolean;
  selectedLifeLinkMemberships: LifeLinkCollectionMembership[];
  membershipsLoading: boolean;
  membershipsComplete: boolean;
  lifeLinkMemberships: Record<string, LifeLinkCollectionMembership[]>;
  lifeLinkMembershipsComplete: Record<string, boolean>;
  collectionSearchResults: Array<{ collection: CollectionRecord; sections: CollectionSectionRecord[]; members: LifeLinkRecord[] }>;
  collectionSearchComplete: boolean;
  currentUser: ApiUser | null;
  agentConnection: ApiAgentConnection;
  qrBaseUrl: string;
  links: LinkRecord[];
  activeView: WorkspaceView;
  batchCount: number;
  lastBatchId: string | null;
  lastBatchIds: string[];
  inventoryOpen: boolean;
  inventoryFilter: InventoryFilter;
  inventoryPage: number;
  activeQrId: string | null;
  publicQrState: QrViewState | null;
  editingId: string | null;
  findTargetId: string | null;
  query: string;
  guestView: boolean;
  scanMessage: ScanMessage;
  loading: boolean;
  busy: boolean;
  error: string;
  theme: ThemeMode;
  routePathname: string;
  routeQrId: string | null;
  routeLifeLinkId: string | null;
  rootLifeLinks: LifeLinkBranchState;
  lifeLinkChildren: Record<string, LifeLinkBranchState>;
  selectedLifeLinkId: string | null;
  selectedLifeLinkDetail: LifeLinkDetail | null;
  expandedLifeLinkIds: string[];
  highlightedLifeLinkId: string | null;
  canonicalEditingId: string | null;
  lifeLinkSearchQuery: string;
  lifeLinkSearchResults: LifeLinkSearchItem[];
  lifeLinkSearchTotalCount: number;
  lifeLinkSearchNextCursor: string | null;
  lifeLinkSearchTruncated: boolean;
  lifeLinkSearchLoading: boolean;
};

export type CanonicalLifeLinkEditorPatch = Required<
  Pick<UpdateLifeLinkPatch, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy">
> & Pick<UpdateLifeLinkPatch, "context" | "publicFieldKeys">;
