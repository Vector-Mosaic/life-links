import type {
  LifeLinkDetail,
  LifeLinkSearchItem,
  LifeLinkSummary,
  LinkRecord,
  ProjectRecord,
  QrViewState,
  UpdateLifeLinkPatch
} from "@life-links/core";

import type { ApiAgentConnection, ApiUser } from "../api";

export type WorkspaceView = "home" | "factory" | "scan" | "projects" | "search";
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
        | "qr_not_attached";
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

export type AgentUpdateLifeLinkContentInput = {
  lifeLinkId: string;
  baseUpdatedAt: string;
  title?: string;
  body?: string;
  sourceLifeLinkIds: readonly string[];
};

export type LifeLinksWorkspaceSnapshot = {
  currentUser: ApiUser | null;
  agentConnection: ApiAgentConnection;
  qrBaseUrl: string;
  links: LinkRecord[];
  projects: ProjectRecord[];
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
  newProjectName: string;
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

export type LinkEditorPatch = Pick<
  LinkRecord,
  "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId"
>;

export type CanonicalLifeLinkEditorPatch = Required<
  Pick<UpdateLifeLinkPatch, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy">
>;
