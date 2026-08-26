import type { LinkRecord, ProjectRecord, QrViewState } from "@life-links/core";

import type { ApiUser } from "../api";

export type WorkspaceView = "home" | "factory" | "scan" | "projects" | "search";
export type InventoryFilter = "all" | "claimed" | "unclaimed";
export type ScanTone = "neutral" | "success" | "warning";
export type ThemeMode = "light" | "dark";

export type ScanMessage = {
  tone: ScanTone;
  title: string;
  detail: string;
};

export type LifeLinksWorkspaceSnapshot = {
  currentUser: ApiUser | null;
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
  routeQrId: string | null;
};

export type LinkEditorPatch = Pick<
  LinkRecord,
  "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId"
>;
