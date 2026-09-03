import QRCode from "qrcode";
import { LIFE_LINKS_SEARCH_TOOL_CATALOG_ID } from "../agent/searchToolHandlers";
import { collectRecordSearchPage, emptyRecordSearch } from "./recordSearch";
import {
  LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID,
  type RoutineDeletionTarget, type RoutineDeletionPreview, type RoutineDeletionResult,
  type WorkspaceChangeStatus, type WorkspaceAgentFailure
} from "../agent/workspaceToolHandlers";
import { validateAttachmentTranscript } from "../attachmentTranscript";
import { providerEventCanMutate } from "../owner/calendar";
import {
  DEFAULT_QR_BASE_URL,
  RECORD_SEARCH_CATEGORIES,
  type RecordSearchInput,
  type RecordSearchCategory,
  type RecordSearchHit,
  type RecordSearchPage,
  DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
  DEFAULT_LIFE_LINK_SEARCH_LIMIT,
  MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT,
  MAX_CHANGE_SELECTION,
  normalizeCollectionChangeInput,
  linksToCsv,
  materializeCalendarEventWindow,
  buildQrUrl,
  normalizeBatchCount,
  parseQrId,
  summarizeLifeLink,
  type CollectionPatch,
  type CollectionChangeInput,
  type CollectionChangePreview,
  type CollectionChangeResult,
  type ActivityPatch,
  type ActivityRecord,
  type CalendarActor,
  type CalendarProviderBindingView,
  type CalendarProviderEventProjection,
  type ProviderCalendarEventReference,
  type ProviderCalendarEventCreateInput,
  type ProviderCalendarEventUpdateInput,
  type ProviderCalendarEventDeleteInput,
  type ProviderCalendarEventDeletionResponse,
  type CalendarConnectedCalendarPatch,
  type CalendarConnectionSelectionInput,
  type CalendarEventEditTargetInput,
  type CalendarEventRecord,
  type CalendarPatch,
  type CalendarRecord,
  type CanonicalRoutineCreation,
  type ChangeHistory,
  type LifeLinkChangePreview,
  type LifeLinkChangeResult,
  type PreviewLifeLinkChangeInput,
  type CollectionRecord,
  type CollectionSectionRecord,
  type LifeLinkCollectionMembership,
  type CreateLifeLinkInput,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSearchItem,
  type LifeLinkSummary,
  type LinkRecord,
  type QrViewState,
  type RoutineGroupPatch,
  type RoutineGroupRecord,
  type RoutinePatch,
  type RoutineRevisionSnapshot,
  type RoutineSchedulePatch,
  type RoutineSessionProjection,
  type RoutineValue,
  type RoutineSummaryRecord,
  type UpdateLifeLinkPatch
} from "@life-links/core";

import {
  ApiError,
  previewLifeLinkChange,
  previewCollectionChange,
  applyCollectionChange,
  getLifeLinkChangePreview,
  applyLifeLinkChange,
  getChangeHistory,
  undoChange,
  addCollectionMember,
  appendRoutineSessionAmendment,
  createCalendar,
  createCalendarEvent,
  listCalendarProviders,
  listProviderCalendarEvents,
  getProviderCalendarEvent,
  createProviderCalendarEvent,
  updateProviderCalendarEvent,
  deleteProviderCalendarEvent,
  authorizeMicrosoftCalendar,
  authorizeGoogleCalendar,
  getCalendarAuthorization,
  completeCalendarAuthorization,
  cancelCalendarAuthorization,
  discoverConnectedCalendars,
  selectConnectedCalendars,
  refreshCalendarConnection,
  listCalendarConnections,
  listConnectedCalendars,
  updateConnectedCalendar,
  disconnectCalendarConnection,
  removeConnectedCalendar,
  removeCalendarConnection,
  clearLifeLinkQrBinding,
  createCollection,
  createRoutine,
  createRoutineActivity,
  createRoutineGroup,
  createRoutineSchedule,
  createCollectionSection,
  deleteCalendar,
  deleteCalendarEvent,
  getCollection,
  getCalendar,
  getCalendarClock,
  getCalendarEvent,
  getActiveRoutineRun,
  getRoutine,
  getRoutineRevision,
  getRoutineOccurrence,
  getRoutineRun,
  getRoutineSession,
  listCollections,
  listCalendars,
  listCalendarEvents,
  listRoutineActivities,
  listRoutineGroups,
  materializeRoutineOccurrences,
  listRoutineOccurrences,
  listRoutines,
  listRoutineSchedules,
  listRoutineSessions,
  listCollectionMembers,
  listLifeLinkCollectionMemberships,
  removeCollectionMember,
  removeCollectionSection,
  finalizeRoutineRun,
  putRoutineRunStepResult,
  restoreCalendar,
  restoreCalendarEvent,
  reviseRoutine,
  replaceCollectionSectionAssignments,
  setLifeLinkQrBinding,
  updateCalendar,
  updateCalendarEvent,
  updateCollection,
  updateCollectionSection,
  updateRoutine,
  updateRoutineActivity,
  updateRoutineGroup,
  updateRoutineSchedule,
  startRoutineRun,
  type ActivityCreateInput,
  type CalendarCreateInput,
  type CalendarClock,
  type CalendarEventDetail,
  type CalendarEventCreateInput,
  type CalendarEventDeleteInput,
  type CalendarEventRevisionInput,
  type CollectionCreateInput,
  type RoutineCreateInput,
  type RoutineOccurrenceListOptions,
  type RoutineRevisionCreateInput,
  type RoutineScheduleCreateInput,
  type RoutineSessionAmendmentInput,
  attachQr,
  claimQr,
  connectAgent,
  createLifeLink,
  createQrBatch,
  deleteLifeLinkMedia,
  deleteLinkMedia,
  disconnectAgent,
  findScan,
  getConfig,
  getLifeLinkDetail,
  getLifeLinkAttachmentContent,
  getLifeLinkAttachmentImage,
  getMe,
  getQr,
  listLifeLinks,
  listLinks,
  login,
  logout,
  moveLifeLink,
  searchLifeLinks,
  searchRecords,
  updateLifeLink,
  uploadLifeLinkMedia,
  uploadLinkMedia
} from "../api";
import {
  clearCanonicalLifeLinkDraft,
  readCanonicalLifeLinkDraft
} from "./editorSession";
import {
  LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
  type AgentCalendarDeletionPreview,
  type AgentProviderCalendarDeletionPreview,
  type AgentCalendarDeletionResult,
  type AgentCalendarEventDetail,
  type AgentCalendarEventInstance,
  type AgentCalendarRecord,
  type AgentCreateCalendarEventInput,
  type AgentInspectCalendarEventInput,
  type AgentListCalendarsInput,
  type AgentPrepareCalendarEventDeletionInput,
  type AgentQueryCalendarEventsInput,
  type AgentUpdateCalendarEventInput
} from "../agent/calendarToolHandlers";
import {
  classifyLifeLinksRoute,
  calendarEventIdFromPath,
  collectionIdFromPath,
  collectionMemberIdFromPath,
  createWindowWorkspaceRoute,
  isCalendarPath,
  isCollectionsPath,
  isRoutinesPath,
  lifeLinkIdFromPath,
  ownerCollectionPath,
  ownerCalendarEventPath,
  ownerLifeLinkPath,
  ownerRoutinePath,
  qrIdFromPath,
  routineIdFromPath,
  type WorkspaceBrowserRoute
} from "./routes";
import type {
  AgentReadAttachmentInput,
  AgentReadAttachmentResult,
  AgentCreateLifeLinkInput,
  AgentMoveLifeLinkInput,
  AgentManageLifeLinkQrInput,
  AgentListCollectionsInput,
  AgentInspectCollectionInput,
  AgentMaintainCollectionInput,
  AgentCollectionListResult,
  WorkspaceCommandOptions,
  AgentSearchLifeLinksControllerResult,
  AgentToolControllerActionResult,
  AgentUpdateLifeLinkContentInput,
  CanonicalLifeLinkEditorPatch,
  CalendarWorkspaceState,
  InventoryFilter,
  LifeLinkBranchState,
  LifeLinksWorkspaceSnapshot,
  WorkspacePeer,
  WorkspacePresentation,
  CalendarPresentation,
  CollectionPresentation,
  RoutineWorkspaceState,
  ThemeMode,
  WorkspaceView
} from "./types";

export type LifeLinksWorkspaceApi = {
  listProviderCalendarEvents: typeof listProviderCalendarEvents;
  getProviderCalendarEvent: typeof getProviderCalendarEvent;
  createProviderCalendarEvent: typeof createProviderCalendarEvent;
  updateProviderCalendarEvent: typeof updateProviderCalendarEvent;
  deleteProviderCalendarEvent: typeof deleteProviderCalendarEvent;
  authorizeMicrosoftCalendar: typeof authorizeMicrosoftCalendar;
  authorizeGoogleCalendar: typeof authorizeGoogleCalendar;
  getCalendarAuthorization: typeof getCalendarAuthorization;
  completeCalendarAuthorization: typeof completeCalendarAuthorization;
  cancelCalendarAuthorization: typeof cancelCalendarAuthorization;
  discoverConnectedCalendars: typeof discoverConnectedCalendars;
  selectConnectedCalendars: typeof selectConnectedCalendars;
  refreshCalendarConnection: typeof refreshCalendarConnection;
  listCalendarProviders: typeof listCalendarProviders;
  listCalendarConnections: typeof listCalendarConnections;
  listConnectedCalendars: typeof listConnectedCalendars;
  updateConnectedCalendar: typeof updateConnectedCalendar;
  disconnectCalendarConnection: typeof disconnectCalendarConnection;
  removeConnectedCalendar: typeof removeConnectedCalendar;
  removeCalendarConnection: typeof removeCalendarConnection;
  previewLifeLinkChange: typeof previewLifeLinkChange;
  previewCollectionChange: typeof previewCollectionChange;
  applyCollectionChange: typeof applyCollectionChange;
  getLifeLinkChangePreview: typeof getLifeLinkChangePreview;
  applyLifeLinkChange: typeof applyLifeLinkChange;
  getChangeHistory: typeof getChangeHistory;
  undoChange: typeof undoChange;
  createCalendar: typeof createCalendar;
  createCalendarEvent: typeof createCalendarEvent;
  deleteCalendar: typeof deleteCalendar;
  deleteCalendarEvent: typeof deleteCalendarEvent;
  getCalendarEvent: typeof getCalendarEvent;
  getCalendar: typeof getCalendar;
  getCalendarClock: typeof getCalendarClock;
  listCalendars: typeof listCalendars;
  listCalendarEvents: typeof listCalendarEvents;
  restoreCalendar: typeof restoreCalendar;
  restoreCalendarEvent: typeof restoreCalendarEvent;
  updateCalendar: typeof updateCalendar;
  updateCalendarEvent: typeof updateCalendarEvent;
  appendRoutineSessionAmendment: typeof appendRoutineSessionAmendment;
  addCollectionMember: typeof addCollectionMember;
  clearLifeLinkQrBinding: typeof clearLifeLinkQrBinding;
  createCollection: typeof createCollection;
  createCollectionSection: typeof createCollectionSection;
  getCollection: typeof getCollection;
  listCollections: typeof listCollections;
  listCollectionMembers: typeof listCollectionMembers;
  listLifeLinkCollectionMemberships: typeof listLifeLinkCollectionMemberships;
  removeCollectionMember: typeof removeCollectionMember;
  removeCollectionSection: typeof removeCollectionSection;
  replaceCollectionSectionAssignments: typeof replaceCollectionSectionAssignments;
  setLifeLinkQrBinding: typeof setLifeLinkQrBinding;
  updateCollection: typeof updateCollection;
  updateCollectionSection: typeof updateCollectionSection;
  createRoutine: typeof createRoutine;
  createRoutineActivity: typeof createRoutineActivity;
  createRoutineGroup: typeof createRoutineGroup;
  createRoutineSchedule: typeof createRoutineSchedule;
  finalizeRoutineRun: typeof finalizeRoutineRun;
  getRoutine: typeof getRoutine;
  getActiveRoutineRun: typeof getActiveRoutineRun;
  getRoutineRun: typeof getRoutineRun;
  getRoutineSession: typeof getRoutineSession;
  listRoutineActivities: typeof listRoutineActivities;
  listRoutineGroups: typeof listRoutineGroups;
  materializeRoutineOccurrences: typeof materializeRoutineOccurrences;
  listRoutineOccurrences: typeof listRoutineOccurrences;
  listRoutines: typeof listRoutines;
  listRoutineSchedules: typeof listRoutineSchedules;
  listRoutineSessions: typeof listRoutineSessions;
  putRoutineRunStepResult: typeof putRoutineRunStepResult;
  reviseRoutine: typeof reviseRoutine;
  startRoutineRun: typeof startRoutineRun;
  updateRoutine: typeof updateRoutine;
  updateRoutineActivity: typeof updateRoutineActivity;
  updateRoutineGroup: typeof updateRoutineGroup;
  updateRoutineSchedule: typeof updateRoutineSchedule;
  getConfig: typeof getConfig;
  getMe: typeof getMe;
  login: typeof login;
  logout: typeof logout;
  connectAgent: typeof connectAgent;
  disconnectAgent: typeof disconnectAgent;
  listLinks: typeof listLinks;
  uploadLinkMedia: typeof uploadLinkMedia;
  deleteLinkMedia: typeof deleteLinkMedia;
  createQrBatch: typeof createQrBatch;
  getQr: typeof getQr;
  claimQr: typeof claimQr;
  findScan: typeof findScan;
  listLifeLinks: typeof listLifeLinks;
  createLifeLink: typeof createLifeLink;
  getLifeLinkDetail: typeof getLifeLinkDetail;
  getLifeLinkAttachmentContent: typeof getLifeLinkAttachmentContent;
  getLifeLinkAttachmentImage: typeof getLifeLinkAttachmentImage;
  searchLifeLinks: typeof searchLifeLinks;
  searchRecords: typeof searchRecords;
  getRoutineRevision: typeof getRoutineRevision;
  getRoutineOccurrence: typeof getRoutineOccurrence;
  updateLifeLink: typeof updateLifeLink;
  moveLifeLink: typeof moveLifeLink;
  uploadLifeLinkMedia: typeof uploadLifeLinkMedia;
  deleteLifeLinkMedia: typeof deleteLifeLinkMedia;
  attachQr: typeof attachQr;
};

const defaultApi: LifeLinksWorkspaceApi = {
  listProviderCalendarEvents,
  getProviderCalendarEvent,
  createProviderCalendarEvent,
  updateProviderCalendarEvent,
  deleteProviderCalendarEvent,
  authorizeMicrosoftCalendar,
  authorizeGoogleCalendar,
  getCalendarAuthorization,
  completeCalendarAuthorization,
  cancelCalendarAuthorization,
  discoverConnectedCalendars,
  selectConnectedCalendars,
  refreshCalendarConnection,
  listCalendarProviders,
  listCalendarConnections,
  listConnectedCalendars,
  updateConnectedCalendar,
  disconnectCalendarConnection,
  removeConnectedCalendar,
  removeCalendarConnection,
  previewLifeLinkChange,
  previewCollectionChange,
  applyCollectionChange,
  getLifeLinkChangePreview,
  applyLifeLinkChange,
  getChangeHistory,
  undoChange,
  createCalendar,
  createCalendarEvent,
  deleteCalendar,
  deleteCalendarEvent,
  getCalendarClock,
  getCalendar,
  getCalendarEvent,
  listCalendars,
  listCalendarEvents,
  restoreCalendar,
  restoreCalendarEvent,
  updateCalendar,
  updateCalendarEvent,
  appendRoutineSessionAmendment,
  addCollectionMember,
  clearLifeLinkQrBinding,
  createCollection,
  createCollectionSection,
  getCollection,
  listCollections,
  listCollectionMembers,
  listLifeLinkCollectionMemberships,
  removeCollectionMember,
  removeCollectionSection,
  replaceCollectionSectionAssignments,
  setLifeLinkQrBinding,
  updateCollection,
  updateCollectionSection,
  createRoutine,
  createRoutineActivity,
  createRoutineGroup,
  createRoutineSchedule,
  finalizeRoutineRun,
  getRoutine,
  getActiveRoutineRun,
  getRoutineRun,
  getRoutineSession,
  listRoutineActivities,
  listRoutineGroups,
  materializeRoutineOccurrences,
  listRoutineOccurrences,
  listRoutines,
  listRoutineSchedules,
  listRoutineSessions,
  putRoutineRunStepResult,
  reviseRoutine,
  startRoutineRun,
  updateRoutine,
  updateRoutineActivity,
  updateRoutineGroup,
  updateRoutineSchedule,
  getConfig,
  getMe,
  login,
  logout,
  connectAgent,
  disconnectAgent,
  listLinks,
  uploadLinkMedia,
  deleteLinkMedia,
  createQrBatch,
  getQr,
  claimQr,
  findScan,
  listLifeLinks,
  createLifeLink,
  getLifeLinkDetail,
  getLifeLinkAttachmentContent,
  getLifeLinkAttachmentImage,
  searchLifeLinks,
  searchRecords,
  getRoutineRevision,
  getRoutineOccurrence,
  updateLifeLink,
  moveLifeLink,
  uploadLifeLinkMedia,
  deleteLifeLinkMedia,
  attachQr
};

type LifeLinksWorkspaceControllerOptions = {
  api?: LifeLinksWorkspaceApi;
  route?: WorkspaceBrowserRoute;
  commandId?: () => string;
};

export interface LifeLinksWorkspaceActions {
  agentReadAttachment(input: AgentReadAttachmentInput, signal?: AbortSignal): Promise<AgentReadAttachmentResult>;
  getChangeHistory(): Promise<ChangeHistory>;
  previewLifeLinkChange(input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview>;
  applyLifeLinkChange(previewId: string): Promise<LifeLinkChangeResult>;
  undoLastChange(): Promise<LifeLinkChangeResult>;
  loadRoutineWorkspace(options?: { includeArchived?: boolean; signal?: AbortSignal }): Promise<void>;
  setRoutinePresentation(patch: Partial<RoutineWorkspaceState["presentation"]>): void;
  loadRoutineHistory(options?: { cursor?: string | null; signal?: AbortSignal }): Promise<void>;
  loadMoreRoutineGroups(signal?: AbortSignal): Promise<void>;
  loadMoreRoutineActivities(signal?: AbortSignal): Promise<void>;
  loadMoreRoutines(signal?: AbortSignal): Promise<void>;
  createRoutineGroup(input: { id?: string; title: string; notes?: string }, signal?: AbortSignal): Promise<RoutineGroupRecord>;
  updateRoutineGroup(groupId: string, expectedUpdatedAt: string, patch: RoutineGroupPatch, signal?: AbortSignal): Promise<RoutineGroupRecord>;
  createRoutineActivity(input: ActivityCreateInput, signal?: AbortSignal): Promise<ActivityRecord>;
  updateRoutineActivity(activityId: string, expectedUpdatedAt: string, patch: ActivityPatch, signal?: AbortSignal): Promise<ActivityRecord>;
  createRoutine(input: RoutineCreateInput, signal?: AbortSignal): Promise<void>;
  selectRoutine(routineId: string, signal?: AbortSignal): Promise<void>;
  loadActiveRoutineRun(routineId: string, signal?: AbortSignal): Promise<void>;
  updateRoutine(routineId: string, expectedUpdatedAt: string, patch: RoutinePatch, signal?: AbortSignal): Promise<void>;
  reviseRoutine(routineId: string, input: RoutineRevisionCreateInput, signal?: AbortSignal): Promise<void>;
  createRoutineSchedule(routineId: string, input: RoutineScheduleCreateInput, signal?: AbortSignal): Promise<void>;
  updateRoutineSchedule(scheduleId: string, expectedUpdatedAt: string, patch: RoutineSchedulePatch, signal?: AbortSignal): Promise<void>;
  loadRoutineOccurrences(options?: RoutineOccurrenceListOptions): Promise<void>;
  loadRoutineCalendarWindow(options: { startDate: string; endDate: string; signal?: AbortSignal; background?: boolean }): Promise<void>;
  startRoutineRun(routineId: string, input: { id: string; occurrenceId?: string | null }, signal?: AbortSignal): Promise<void>;
  loadRoutineRunPlan(routineId: string, occurrenceId: string, signal?: AbortSignal): Promise<RoutineRevisionSnapshot | null>;
  resumeRoutineRun(runId: string, signal?: AbortSignal): Promise<void>;
  putRoutineRunStepResult(runId: string, routineStepId: string, input: {
    expectedUpdatedAt: string; actualValues: RoutineValue[]; proposedNextValues: RoutineValue[]; notes?: string;
  }, signal?: AbortSignal): Promise<void>;
  finalizeRoutineRun(runId: string, input: { sessionId: string; expectedUpdatedAt: string }, signal?: AbortSignal): Promise<void>;
  loadRoutineSessions(options?: { cursor?: string | null; limit?: number; routineId?: string; signal?: AbortSignal }): Promise<void>;
  selectRoutineSession(sessionId: string, signal?: AbortSignal): Promise<void>;
  appendRoutineSessionAmendment(sessionId: string, input: RoutineSessionAmendmentInput, signal?: AbortSignal): Promise<void>;
  openCalendar(updateHistory?: boolean): Promise<void>;
  openCalendarEvent(eventId: string, updateHistory?: boolean): Promise<void>;
  loadCalendarClock(timeZone: string, signal?: AbortSignal): Promise<CalendarClock | null>;
  loadCalendarWindow(options: { startDate: string; endDate: string; signal?: AbortSignal; background?: boolean }): Promise<void>;
  createNativeCalendar(input: CalendarCreateInput, signal?: AbortSignal): Promise<CalendarRecord>;
  updateNativeCalendar(calendarId: string, expectedUpdatedAt: string, patch: CalendarPatch, signal?: AbortSignal): Promise<CalendarRecord>;
  deleteNativeCalendar(calendarId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<CalendarRecord>;
  restoreNativeCalendar(calendarId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<CalendarRecord>;
  createNativeCalendarEvent(input: CalendarEventCreateInput, signal?: AbortSignal): Promise<void>;
  updateNativeCalendarEvent(eventId: string, input: CalendarEventRevisionInput, signal?: AbortSignal): Promise<void>;
  deleteNativeCalendarEvent(eventId: string, input: CalendarEventDeleteInput, signal?: AbortSignal): Promise<void>;
  restoreNativeCalendarEvent(eventId: string, expectedCurrentRevisionId: string, tombstoneId: string, signal?: AbortSignal): Promise<void>;
  confirmAgentChange(confirmed: boolean): void;
  confirmAgentCalendarDeletion(confirmed: boolean): void;
  openHierarchy(parentId?: string | null): Promise<void>;
  activateLifeLink(lifeLinkId: string): Promise<void>;
  openCollections(): Promise<void>;
  openRoutines(updateHistory?: boolean): Promise<void>;
  openRoutine(routineId: string, updateHistory?: boolean): Promise<void>;
  loadCollections(): Promise<void>;
  openCollection(collectionId: string, selectedLifeLinkId?: string): Promise<void>;
  selectCollectionMember(lifeLinkId: string): Promise<void>;
  setDetailsOpen(open: boolean): void;
  createCollection(input: CollectionCreateInput): Promise<void>;
  updateCollection(patch: CollectionPatch, target?: CollectionRecord): Promise<void>;
  createCollectionSection(title: string): Promise<void>;
  updateCollectionSection(sectionId: string, title: string, target?: CollectionRecord): Promise<void>;
  removeCollectionSection(sectionId: string): Promise<void>;
  addCollectionMember(lifeLinkId: string, target?: CollectionRecord): Promise<void>;
  removeCollectionMember(lifeLinkId: string, target?: CollectionRecord): Promise<void>;
  replaceCollectionSectionAssignments(lifeLinkId: string, sectionIds: string[], target?: CollectionRecord): Promise<void>;
  updateSelectedLifeLink(patch: UpdateLifeLinkPatch, expectedUpdatedAt?: string): Promise<void>;
  setLifeLinkQrBinding(lifeLinkId: string, qrId: string): Promise<void>;
  clearLifeLinkQrBinding(lifeLinkId: string): Promise<void>;
  createQrForLifeLink(lifeLinkId: string): Promise<void>;
  getSnapshot(): LifeLinksWorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  refreshOwnerLibrary(): Promise<void>;
  openQr(qrId: string, updateHistory?: boolean): Promise<void>;
  scanQr(scanText: string): Promise<void>;
  evaluateFindScan(scanText: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  connectAgent(): Promise<void>;
  disconnectAgent(): Promise<void>;
  generateBatch(): Promise<void>;
  claimActiveLink(): Promise<void>;
  uploadMedia(qrId: string, files: FileList | File[]): Promise<void>;
  removeMedia(qrId: string, mediaId: string): Promise<void>;
  refresh(): Promise<void>;
  selectLifeLink(input: { lifeLinkId: string; source: "human" | "agent" | "route" | "search" | "scan" }): Promise<void>;
  toggleLifeLinkExpanded(lifeLinkId: string): Promise<void>;
  expandHierarchy(): Promise<void>;
  collapseHierarchy(): void;
  loadMoreLifeLinks(parentId: string | null): Promise<void>;
  createLifeLink(input: CreateLifeLinkInput): Promise<void>;
  moveLifeLink(lifeLinkId: string, parentId: string | null): Promise<void>;
  detachLifeLink(lifeLinkId: string): Promise<void>;
  attachQrToLifeLink(lifeLinkId: string, scanText: string): Promise<void>;
  searchLifeLinks(query?: string, append?: boolean): Promise<void>;
  searchRecords(query?: string): Promise<void>;
  loadMoreRecordSearch(category: RecordSearchCategory): Promise<void>;
  cancelRecordSearch(): void;
  openRecordSearchHit(hit: RecordSearchHit): Promise<void>;
  agentSearchRecords(input: RecordSearchInput, signal?: AbortSignal): Promise<{ ok: true; page: RecordSearchPage } | { ok: false; code: string }>;
  agentInspectCurrentLifeLink(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentSearchLifeLinks(
    input: { query: string; limit: number },
    signal?: AbortSignal
  ): Promise<AgentSearchLifeLinksControllerResult>;
  agentOpenLifeLink(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentUpdateLifeLinkContent(
    input: AgentUpdateLifeLinkContentInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentStartFindMode(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult>;
  agentCreateLifeLink(input: AgentCreateLifeLinkInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult>;
  agentMoveLifeLink(input: AgentMoveLifeLinkInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult>;
  agentManageLifeLinkQr(input: AgentManageLifeLinkQrInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult>;
  agentListCollections(input: AgentListCollectionsInput, signal?: AbortSignal): Promise<AgentCollectionListResult>;
  agentInspectCollection(input: AgentInspectCollectionInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult>;
  agentMaintainCollection(input: AgentMaintainCollectionInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult>;
  openPublicQrInWorkspace(): Promise<void>;
  saveCanonicalLifeLink(
    lifeLinkId: string,
    expectedUpdatedAt: string,
    patch: CanonicalLifeLinkEditorPatch
  ): Promise<void>;
}

type WorkspaceAgentChangeEntry = (
  | { kind: "collection"; preview: CollectionChangePreview }
  | { kind: "routines"; preview: RoutineDeletionPreview }
) & {
  ownerId: string; ownerRevision: number; epoch: number;
  offered: boolean; status: WorkspaceChangeStatus; abort: AbortController | null;
};

export class LifeLinksWorkspaceController implements LifeLinksWorkspaceActions {
  private readonly api: LifeLinksWorkspaceApi;
  private readonly route: WorkspaceBrowserRoute;
  private readonly commandId: () => string;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRoute: (() => void) | null = null;
  private active = false;
  private lifecycle = 0;
  private navigationRevision = 0;
  private ownerRevision = 0;
  private hierarchyExpansion: { abort: AbortController; ownerRevision: number; navigation: number; parentId: string | null } | null = null;
  private routineWorkspaceLoadRevision = 0;
  private routineGroupListRevision = 0;
  private routineActivityListRevision = 0;
  private routineListRevision = 0;
  private routineSelectionRevision = 0;
  private routineRunLookupRevision = 0;
  private routineOccurrenceListRevision = 0;
  private routineCalendarLoadRevision = 0;
  private routineSessionListRevision = 0;
  private routineHistoryListRevision = 0;
  private routineSessionSelectionRevision = 0;
  private calendarWorkspaceLoadRevision = 0;
  private calendarClockLoadRevision = 0;
  private calendarWindowLoadRevision = 0;
  private backgroundCalendarWindowPending = false;
  private requestedCalendarWindow: { startDate: string; endDate: string; ownerRevision: number; navigationRevision: number } | null = null;
  private calendarConnectionsLoadRevision = 0;
  private calendarConnectionFlowRevision = 0;
  private calendarSelectionRevision = 0;
  private readonly removedCalendarAccounts = new Map<string, number>();
  private readonly removedConnectedCalendars = new Map<string, number>();
  private searchRevision = 0;
  private recordSearchRevision = 0;
  private recordSearchRequests = new Map<RecordSearchCategory, AbortController>();
  private selectionRevision = 0;
  private readonly pendingCreateIds = new Map<string, string>();
  private readonly pendingQrBindings = new Map<string, { commandId: string; expectedUpdatedAt: string }>();
  private readonly pendingGeneratedQrs = new Map<string, string>();
  private readonly pendingChangeCommands = new Map<string, string>();
  private readonly agentChangePreviews = new Map<string, { preview: LifeLinkChangePreview; authorized: boolean }>();
  private readonly workspaceAgentChanges = new Map<string, WorkspaceAgentChangeEntry>();
  private workspaceAgentEpoch = 0;
  private agentChangeApplication: object | null = null;
  private settleAgentChange: ((confirmed: boolean) => void) | null = null;
  private readonly agentCalendarDeletionPreviews = new Map<string, {
    preview: AgentCalendarDeletionPreview;
    authorized: boolean;
    tombstoneId: string;
    result: AgentCalendarDeletionResult | null;
  }>();
  private agentCalendarDeletionApplication: object | null = null;
  private readonly agentProviderCalendarDeletionPreviews = new Map<string, {
    preview: AgentProviderCalendarDeletionPreview; authorized: boolean; commandId: string;
    result: ProviderCalendarEventDeletionResponse | null;
  }>();
  private settleAgentCalendarDeletion: ((confirmed: boolean) => void) | null = null;
  private historyRevision = 0;
  private pendingWorkspaceResume: { peer: WorkspacePeer; pathname: string } | null = null;
  private snapshot: LifeLinksWorkspaceSnapshot;

  constructor(options: LifeLinksWorkspaceControllerOptions = {}) {
    this.api = options.api ?? defaultApi;
    this.route = options.route ?? createWindowWorkspaceRoute();
    this.commandId = options.commandId ?? (() => crypto.randomUUID());
    const routePathname = this.route.pathname();
    const routeQrId = qrIdFromPath(routePathname);
    this.snapshot = {
      ...emptyFieldLedgerState(),
      currentUser: null,
      agentConnection: { connected: false, connectedAt: null, toolCatalogId: null },
      qrBaseUrl: DEFAULT_QR_BASE_URL,
      links: [],
      activeView: routeQrId ? "scan" : "home",
      batchCount: 48,
      lastBatchId: null,
      lastBatchIds: [],
      inventoryOpen: false,
      inventoryFilter: "all",
      inventoryPage: 0,
      activeQrId: routeQrId,
      publicQrState: null,
      editingId: null,
      findTargetId: null,
      query: "",
      guestView: false,
      scanMessage: {
        tone: "neutral",
        title: "Ready",
        detail: "No scan yet."
      },
      loading: true,
      busy: false,
      error: "",
      theme: initialTheme(),
      routePathname,
      routeQrId,
      routeLifeLinkId: null,
      rootLifeLinks: emptyLifeLinkBranch(),
      lifeLinkChildren: {},
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      expandedLifeLinkIds: [],
      highlightedLifeLinkId: null,
      canonicalEditingId: null,
      lifeLinkSearchQuery: "",
      lifeLinkSearchResults: [],
      lifeLinkSearchTotalCount: 0,
      lifeLinkSearchNextCursor: null,
      lifeLinkSearchTruncated: false,
      lifeLinkSearchLoading: false
    };
  }

  getSnapshot = () => this.snapshot;

  async loadRoutineWorkspace(options: { includeArchived?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const loadRevision = ++this.routineWorkspaceLoadRevision;
    const groupListRevision = ++this.routineGroupListRevision;
    const activityListRevision = ++this.routineActivityListRevision;
    const routineListRevision = ++this.routineListRevision;
    const occurrenceListRevision = ++this.routineOccurrenceListRevision;
    const sessionListRevision = ++this.routineSessionListRevision;
    const includeArchived = options.includeArchived ?? this.snapshot.routineWorkspace.presentation.showRemoved;
    this.updateRoutineWorkspace({ loading: true, error: "", includeArchived });
    try {
      const [groups, activities, routines, occurrences, sessions] = await Promise.all([
        this.api.listRoutineGroups({ includeArchived, signal: options.signal }),
        this.api.listRoutineActivities({ includeArchived, signal: options.signal }),
        this.api.listRoutines({ includeArchived, signal: options.signal }),
        this.api.listRoutineOccurrences({ signal: options.signal }),
        this.api.listRoutineSessions({ signal: options.signal })
      ]);
      options.signal?.throwIfAborted();
      if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
          loadRevision !== this.routineWorkspaceLoadRevision) return;
      this.updateRoutineWorkspace({
        ...(groupListRevision === this.routineGroupListRevision ? {
          groups: groups.routineGroups, groupsNextCursor: groups.nextCursor
        } : {}),
        ...(activityListRevision === this.routineActivityListRevision ? {
          activities: activities.activities, activitiesNextCursor: activities.nextCursor
        } : {}),
        ...(routineListRevision === this.routineListRevision ? {
          routines: routines.routines, routinesNextCursor: routines.nextCursor
        } : {}),
        ...(occurrenceListRevision === this.routineOccurrenceListRevision ? {
          occurrences: occurrences.occurrences, occurrencesNextCursor: occurrences.nextCursor
        } : {}),
        ...(sessionListRevision === this.routineSessionListRevision ? {
          sessions: sessions.sessions, sessionsNextCursor: sessions.nextCursor
        } : {}),
        loading: false, error: ""
      });
    } catch (error) {
      if (ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
          loadRevision === this.routineWorkspaceLoadRevision) {
        this.updateRoutineWorkspace({ loading: false, error: messageFromError(error) });
      }
      throw error;
    }
  }

  async loadMoreRoutineGroups(signal?: AbortSignal): Promise<void> {
    const cursor = this.snapshot.routineWorkspace.groupsNextCursor;
    if (!cursor) return;
    const sameOwner = this.captureRoutineOwner();
    const revision = ++this.routineGroupListRevision;
    const page = await this.api.listRoutineGroups({
      cursor, includeArchived: this.snapshot.routineWorkspace.includeArchived, signal
    });
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineGroupListRevision) return;
    this.updateRoutineWorkspace((current) => ({
      groups: mergeById(current.groups, page.routineGroups), groupsNextCursor: page.nextCursor, error: ""
    }));
  }

  async loadMoreRoutineActivities(signal?: AbortSignal): Promise<void> {
    const cursor = this.snapshot.routineWorkspace.activitiesNextCursor;
    if (!cursor) return;
    const sameOwner = this.captureRoutineOwner();
    const revision = ++this.routineActivityListRevision;
    const page = await this.api.listRoutineActivities({
      cursor, includeArchived: this.snapshot.routineWorkspace.includeArchived, signal
    });
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineActivityListRevision) return;
    this.updateRoutineWorkspace((current) => ({
      activities: mergeById(current.activities, page.activities), activitiesNextCursor: page.nextCursor, error: ""
    }));
  }

  async loadMoreRoutines(signal?: AbortSignal): Promise<void> {
    const cursor = this.snapshot.routineWorkspace.routinesNextCursor;
    if (!cursor) return;
    const sameOwner = this.captureRoutineOwner();
    const revision = ++this.routineListRevision;
    const page = await this.api.listRoutines({
      cursor, includeArchived: this.snapshot.routineWorkspace.includeArchived, signal
    });
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineListRevision) return;
    this.updateRoutineWorkspace((current) => ({
      routines: mergeById(current.routines, page.routines), routinesNextCursor: page.nextCursor, error: ""
    }));
  }

  async createRoutineGroup(input: { id?: string; title: string; notes?: string }, signal?: AbortSignal): Promise<RoutineGroupRecord> {
    const sameOwner = this.captureRoutineOwner();
    const { routineGroup } = await this.api.createRoutineGroup(input, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateRoutineWorkspace((current) => ({ groups: mergeById(current.groups, [routineGroup]), error: "" }));
    return routineGroup;
  }

  async updateRoutineGroup(
    groupId: string, expectedUpdatedAt: string, patch: RoutineGroupPatch, signal?: AbortSignal
  ): Promise<RoutineGroupRecord> {
    const sameOwner = this.captureRoutineOwner();
    const { routineGroup } = await this.api.updateRoutineGroup(groupId, expectedUpdatedAt, patch, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateRoutineWorkspace((current) => ({ groups: mergeById(current.groups, [routineGroup]), error: "" }));
    return routineGroup;
  }

  async createRoutineActivity(input: ActivityCreateInput, signal?: AbortSignal): Promise<ActivityRecord> {
    const sameOwner = this.captureRoutineOwner();
    const { activity } = await this.api.createRoutineActivity(input, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateRoutineWorkspace((current) => ({ activities: mergeById(current.activities, [activity]), error: "" }));
    return activity;
  }

  async updateRoutineActivity(
    activityId: string, expectedUpdatedAt: string, patch: ActivityPatch, signal?: AbortSignal
  ): Promise<ActivityRecord> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const selectedRoutineId = this.snapshot.routineWorkspace.selectedRoutine?.currentRevision.steps
      .some((step) => step.activityId === activityId)
      ? this.snapshot.routineWorkspace.selectedRoutine.routine.id
      : null;
    const { activity } = await this.api.updateRoutineActivity(activityId, expectedUpdatedAt, patch, signal);
    signal?.throwIfAborted();
    if (sameOwner()) {
      this.updateRoutineWorkspace((current) => ({ activities: mergeById(current.activities, [activity]), error: "" }));
      if (activity.archivedAt && selectedRoutineId && selectionRevision === this.routineSelectionRevision) {
        this.clearSelectedRoutinePlanningState(selectedRoutineId);
        await this.refreshSelectedRoutineOperationalState(selectedRoutineId, selectionRevision, signal, true)
          .catch(() => undefined);
      }
    }
    return activity;
  }

  async createRoutine(input: RoutineCreateInput, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSelectionRevision;
    const { routine } = await this.api.createRoutine(input, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => ({
      routines: mergeById(current.routines, [routineSummaryFromDetail(routine)]),
      selectedRoutine: routine,
      revisionsById: { ...current.revisionsById, [routine.currentRevision.revision.id]: routine.currentRevision },
      schedules: [], schedulesNextCursor: null, activeRun: null, error: ""
    }));
  }

  async selectRoutine(routineId: string, signal?: AbortSignal): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const selectionRevision = ++this.routineSelectionRevision;
    const runLookupRevision = ++this.routineRunLookupRevision;
    const occurrenceListRevision = ++this.routineOccurrenceListRevision;
    const sessionListRevision = ++this.routineSessionListRevision;
    ++this.routineSessionSelectionRevision;
    this.updateRoutineWorkspace({
      occurrences: [], occurrencesNextCursor: null,
      sessions: [], sessionsNextCursor: null, selectedSession: null
    });
    const [routine, schedules, activeRun, occurrences, sessions] = await Promise.all([
      this.api.getRoutine(routineId, signal),
      this.api.listRoutineSchedules(routineId, { signal }),
      this.api.getActiveRoutineRun(routineId, signal),
      this.api.listRoutineOccurrences({ routineId, signal }),
      this.api.listRoutineSessions({ routineId, signal })
    ]);
    signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        selectionRevision !== this.routineSelectionRevision) return;
    const revisionsById = await this.loadRoutineRevisionSnapshots([
      ...(activeRun.run ? [activeRun.run] : []), ...sessions.sessions.map((entry) => entry.session)
    ], signal, routine.routine.currentRevision);
    signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => ({
      routines: mergeById(current.routines, [routineSummaryFromDetail(routine.routine)]),
      selectedRoutine: routine.routine,
      revisionsById: { ...current.revisionsById, ...revisionsById },
      schedules: schedules.schedules,
      schedulesNextCursor: schedules.nextCursor,
      activeRun: runLookupRevision === this.routineRunLookupRevision ? activeRun.run : current.activeRun,
      ...(occurrenceListRevision === this.routineOccurrenceListRevision ? {
        occurrences: occurrences.occurrences, occurrencesNextCursor: occurrences.nextCursor
      } : {}),
      ...(sessionListRevision === this.routineSessionListRevision ? {
        sessions: sessions.sessions, sessionsNextCursor: sessions.nextCursor
      } : {}),
      error: ""
    }));
  }

  async loadActiveRoutineRun(routineId: string, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const revision = ++this.routineRunLookupRevision;
    const { run } = await this.api.getActiveRoutineRun(routineId, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision) return;
    const revisionsById = await this.loadRoutineRevisionSnapshots(run ? [run] : [], signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision) return;
    this.updateRoutineWorkspace((current) => current.selectedRoutine?.routine.id === routineId
      ? { activeRun: run, revisionsById: { ...current.revisionsById, ...revisionsById }, error: "" }
      : {});
  }

  async updateRoutine(
    routineId: string, expectedUpdatedAt: string, patch: RoutinePatch, signal?: AbortSignal, actor: CalendarActor = "human"
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSelectionRevision;
    const { routine } = await this.api.updateRoutine(routineId, expectedUpdatedAt, patch, signal, actor);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateRoutineWorkspace((current) => ({
      routines: mergeById(current.routines, [routineSummaryFromDetail(routine)]),
      selectedRoutine: selectionRevision === this.routineSelectionRevision && current.selectedRoutine?.routine.id === routine.routine.id
        ? routine : current.selectedRoutine,
      error: ""
    }));
    if (routine.routine.archivedAt && this.snapshot.routineWorkspace.selectedRoutine?.routine.id === routineId) {
      this.clearSelectedRoutinePlanningState(routineId);
      await this.refreshSelectedRoutineOperationalState(routineId, selectionRevision, signal, true)
        .catch(() => undefined);
    }
  }

  /** One prepared selection and archive timestamp, shared by human and agent UI. */
  prepareRoutineDeletion(routines: RoutineDeletionTarget[]): RoutineDeletionPreview {
    if (!this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.routeQrId) throw new Error("Open your private workspace to edit Routines.");
    if (!routines.length || routines.length > MAX_CHANGE_SELECTION || new Set(routines.map((item) => item.id)).size !== routines.length ||
        routines.some((item) => !item.id || !item.title || !Number.isFinite(Date.parse(item.expectedUpdatedAt)))) {
      throw new Error("Choose a bounded, exact selection of Routines and their current revisions.");
    }
    return { id: `routine-delete-${this.commandId()}`, routines: routines.map((item) => ({ ...item })), archivedAt: new Date().toISOString() };
  }

  async applyRoutineDeletion(
    preview: RoutineDeletionPreview, confirmedIds: string[] = [], signal?: AbortSignal,
    actor: CalendarActor = "human", assertActive?: () => void
  ): Promise<RoutineDeletionResult> {
    const ownerId = this.snapshot.currentUser?.id;
    const ownerRevision = this.ownerRevision;
    const completed = new Set(confirmedIds.filter((id) => preview.routines.some((routine) => routine.id === id)));
    let error: string | null = null;
    try {
      for (const routine of preview.routines) {
        if (completed.has(routine.id)) continue;
        signal?.throwIfAborted();
        if (!ownerId || ownerRevision !== this.ownerRevision || this.snapshot.currentUser?.id !== ownerId || this.snapshot.routeQrId || this.snapshot.guestView) {
          throw new Error("Your account changed. Close this dialog and try again.");
        }
        assertActive?.();
        await this.updateRoutine(routine.id, routine.expectedUpdatedAt, { archivedAt: preview.archivedAt }, signal, actor);
        signal?.throwIfAborted();
        assertActive?.();
        if (ownerRevision !== this.ownerRevision || this.snapshot.currentUser?.id !== ownerId ||
            !this.snapshot.routineWorkspace.routines.some((item) => item.id === routine.id && item.archivedAt === preview.archivedAt)) {
          throw new Error("Removal could not be confirmed. Retry to check the same change.");
        }
        completed.add(routine.id);
      }
    } catch (issue) {
      // A canceled/failed request can have committed. Never assert that nothing changed.
      error = signal?.aborted ? "Stopped. Unconfirmed changes may have committed; retry the same selection to check." : messageFromError(issue);
    }
    return { removedIds: [...completed], remainingIds: preview.routines.filter((item) => !completed.has(item.id)).map((item) => item.id), error };
  }

  async reviseRoutine(routineId: string, input: RoutineRevisionCreateInput, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSelectionRevision;
    const { routine } = await this.api.reviseRoutine(routineId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => ({
      routines: mergeById(current.routines, [routineSummaryFromDetail(routine)]), selectedRoutine: routine,
      revisionsById: { ...current.revisionsById,
        ...(current.selectedRoutine ? { [current.selectedRoutine.currentRevision.revision.id]: current.selectedRoutine.currentRevision } : {}),
        [routine.currentRevision.revision.id]: routine.currentRevision }, error: ""
    }));
    // The server re-pins future plans atomically. Read those results; never
    // emulate that transaction with client-side schedule writes.
    this.clearSelectedRoutinePlanningState(routineId);
    const calendarRange = this.snapshot.routineWorkspace.calendarRange;
    ++this.routineCalendarLoadRevision;
    this.updateRoutineWorkspace({ calendarOccurrences: [], calendarError: "" });
    try {
      await this.refreshSelectedRoutineOperationalState(routineId, selectionRevision, signal, true);
      if (sameOwner() && selectionRevision === this.routineSelectionRevision && calendarRange &&
          this.snapshot.routineWorkspace.calendarRange?.startDate === calendarRange.startDate &&
          this.snapshot.routineWorkspace.calendarRange?.endDate === calendarRange.endDate) {
        await this.loadRoutineCalendarWindow({ ...calendarRange, signal });
      }
    } catch (error) {
      if (sameOwner() && selectionRevision === this.routineSelectionRevision && !signal?.aborted) {
        this.updateRoutineWorkspace({ error: `Routine saved. Could not refresh its plans: ${messageFromError(error)}` });
      }
    }
  }

  async createRoutineSchedule(routineId: string, input: RoutineScheduleCreateInput, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSelectionRevision;
    const { schedule } = await this.api.createRoutineSchedule(routineId, input, signal);
    signal?.throwIfAborted();
    if (sameOwner() && selectionRevision === this.routineSelectionRevision) {
      ++this.routineOccurrenceListRevision;
      this.updateRoutineWorkspace((current) => current.selectedRoutine?.routine.id === routineId
        ? {
            schedules: mergeById(current.schedules, [schedule]),
            occurrences: [], occurrencesNextCursor: null, error: ""
          }
        : {});
      await this.refreshSelectedRoutineOperationalState(routineId, selectionRevision, signal, false)
        .catch(() => undefined);
    }
  }

  async updateRoutineSchedule(
    scheduleId: string, expectedUpdatedAt: string, patch: RoutineSchedulePatch, signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSelectionRevision;
    const { schedule } = await this.api.updateRoutineSchedule(scheduleId, expectedUpdatedAt, patch, signal);
    signal?.throwIfAborted();
    if (sameOwner() && selectionRevision === this.routineSelectionRevision) {
      ++this.routineOccurrenceListRevision;
      this.updateRoutineWorkspace((current) => current.selectedRoutine?.routine.id === schedule.routineId
        ? {
            schedules: mergeById(current.schedules, [schedule]),
            occurrences: [], occurrencesNextCursor: null, error: ""
          }
        : {});
      await this.refreshSelectedRoutineOperationalState(schedule.routineId, selectionRevision, signal, false)
        .catch(() => undefined);
    }
  }

  async loadRoutineOccurrences(options: RoutineOccurrenceListOptions = {}): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const listRevision = ++this.routineOccurrenceListRevision;
    const page = await this.api.listRoutineOccurrences(options);
    options.signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        listRevision !== this.routineOccurrenceListRevision) return;
    this.updateRoutineWorkspace((current) => ({
      occurrences: options.cursor ? mergeById(current.occurrences, page.occurrences) : page.occurrences,
      occurrencesNextCursor: page.nextCursor, error: ""
    }));
  }

  async loadRoutineCalendarWindow(
    options: { startDate: string; endDate: string; signal?: AbortSignal; background?: boolean }
  ): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const navigationRevision = this.navigationRevision;
    const loadRevision = ++this.routineCalendarLoadRevision;
    const routines = this.snapshot.routineWorkspace.routines;
    const occurrences = this.snapshot.routineWorkspace.calendarOccurrences;
    const isCurrent = () => ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
      navigationRevision === this.navigationRevision && loadRevision === this.routineCalendarLoadRevision &&
      !options.signal?.aborted && (!options.background || (routines === this.snapshot.routineWorkspace.routines &&
        occurrences === this.snapshot.routineWorkspace.calendarOccurrences));
    if (!options.background) this.updateRoutineWorkspace({ calendarLoading: true, calendarError: "" });
    try {
      await this.api.materializeRoutineOccurrences(options);
      options.signal?.throwIfAborted();
      if (!isCurrent()) return;
      const calendarOccurrences = await readAllPages(async (cursor) => {
        const page = await this.api.listRoutineOccurrences({
          startDate: options.startDate,
          endDate: options.endDate,
          limit: 100,
          ...(cursor ? { cursor } : {}),
          signal: options.signal
        });
        options.signal?.throwIfAborted();
        if (!isCurrent()) return { items: [], nextCursor: null, truncated: false };
        return { items: page.occurrences, nextCursor: page.nextCursor, truncated: page.truncated };
      });
      if (!isCurrent()) return;
      this.updateRoutineWorkspace({
        calendarOccurrences,
        calendarRange: { startDate: options.startDate, endDate: options.endDate },
        calendarLoading: false,
        calendarError: ""
      });
    } catch (error) {
      if (isCurrent()) {
        this.updateRoutineWorkspace({ calendarLoading: false, calendarError: messageFromError(error) });
      }
      throw error;
    }
  }

  async loadRoutineRunPlan(routineId: string, occurrenceId: string, signal?: AbortSignal): Promise<RoutineRevisionSnapshot | null> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const { occurrence } = await this.api.getRoutineOccurrence(occurrenceId, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.routineSelectionRevision) return null;
    if (occurrence.id !== occurrenceId || occurrence.routineId !== routineId) throw new Error("This plan belongs to another Routine.");
    const revisionsById = await this.loadRoutineRevisionSnapshots([occurrence], signal);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.routineSelectionRevision) return null;
    this.updateRoutineWorkspace((current) => ({ revisionsById: { ...current.revisionsById, ...revisionsById } }));
    return revisionsById[occurrence.routineRevisionId] ?? null;
  }

  async startRoutineRun(
    routineId: string, input: { id: string; occurrenceId?: string | null }, signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const revision = ++this.routineRunLookupRevision;
    const { run } = await this.api.startRoutineRun(routineId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision || selectionRevision !== this.routineSelectionRevision) return;
    const revisionsById = await this.loadRoutineRevisionSnapshots([run], signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision || selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => current.selectedRoutine?.routine.id === routineId && run.routineId === routineId
      ? { activeRun: run.status === "active" ? run : null, revisionsById: { ...current.revisionsById, ...revisionsById }, error: "" }
      : {});
  }

  async resumeRoutineRun(runId: string, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const selectedRoutineId = this.snapshot.routineWorkspace.selectedRoutine?.routine.id;
    const revision = ++this.routineRunLookupRevision;
    const { run } = await this.api.getRoutineRun(runId, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision || selectionRevision !== this.routineSelectionRevision) return;
    const revisionsById = await this.loadRoutineRevisionSnapshots([run], signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision || selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => selectedRoutineId && current.selectedRoutine?.routine.id === selectedRoutineId &&
      run.routineId === selectedRoutineId && run.id === runId
      ? { activeRun: run.status === "active" ? run : null, revisionsById: { ...current.revisionsById, ...revisionsById }, error: "" }
      : {});
  }

  async putRoutineRunStepResult(
    runId: string,
    routineStepId: string,
    input: { expectedUpdatedAt: string; actualValues: RoutineValue[]; proposedNextValues: RoutineValue[]; notes?: string },
    signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const activeRunId = this.snapshot.routineWorkspace.activeRun?.id;
    const revision = ++this.routineRunLookupRevision;
    const { run } = await this.api.putRoutineRunStepResult(runId, routineStepId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || revision !== this.routineRunLookupRevision || selectionRevision !== this.routineSelectionRevision) return;
    this.updateRoutineWorkspace((current) => activeRunId === runId && current.activeRun?.id === runId && run.id === runId &&
      current.selectedRoutine?.routine.id === run.routineId ? { activeRun: run, error: "" } : {});
  }

  async finalizeRoutineRun(
    runId: string, input: { sessionId: string; expectedUpdatedAt: string }, signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = this.routineSelectionRevision;
    const selectedRoutineId = this.snapshot.routineWorkspace.selectedRoutine?.routine.id;
    const activeRunId = this.snapshot.routineWorkspace.activeRun?.id;
    const runRevision = ++this.routineRunLookupRevision;
    const sessionSelectionRevision = ++this.routineSessionSelectionRevision;
    const { session } = await this.api.finalizeRoutineRun(runId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateRoutineWorkspace((current) => ({
      activeRun: runRevision === this.routineRunLookupRevision && selectionRevision === this.routineSelectionRevision &&
        activeRunId === runId && current.activeRun?.id === runId && selectedRoutineId === session.session.routineId &&
        current.selectedRoutine?.routine.id === selectedRoutineId ? null : current.activeRun,
      sessions: mergeRoutineSessions(current.sessions, [session]),
      history: current.history.loaded && (!current.history.routineId || current.history.routineId === session.session.routineId)
        ? { ...current.history, sessions: mergeRoutineSessions(current.history.sessions, [session]) } : current.history,
      selectedSession: sessionSelectionRevision === this.routineSessionSelectionRevision &&
        selectionRevision === this.routineSelectionRevision && activeRunId === runId &&
        selectedRoutineId === session.session.routineId && current.selectedRoutine?.routine.id === selectedRoutineId
        ? session : current.selectedSession,
      error: ""
    }));
  }

  async loadRoutineSessions(options: { cursor?: string | null; limit?: number; routineId?: string; signal?: AbortSignal } = {}): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const listRevision = ++this.routineSessionListRevision;
    const page = await this.api.listRoutineSessions(options);
    options.signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        listRevision !== this.routineSessionListRevision) return;
    const revisionsById = await this.loadRoutineRevisionSnapshots(page.sessions.map((entry) => entry.session), options.signal);
    options.signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        listRevision !== this.routineSessionListRevision) return;
    this.updateRoutineWorkspace((current) => ({
      sessions: options.cursor ? mergeRoutineSessions(current.sessions, page.sessions) : page.sessions,
      revisionsById: { ...current.revisionsById, ...revisionsById },
      sessionsNextCursor: page.nextCursor, error: ""
    }));
  }

  setRoutinePresentation(patch: Partial<RoutineWorkspaceState["presentation"]>): void {
    const current = this.snapshot.routineWorkspace;
    const presentation = { ...current.presentation, ...patch };
    const scopeChanged = presentation.historyRoutineId !== current.presentation.historyRoutineId;
    if (scopeChanged) ++this.routineHistoryListRevision;
    this.updateRoutineWorkspace({ presentation, ...(scopeChanged ? { history: {
      routineId: presentation.historyRoutineId, sessions: [], nextCursor: null, loaded: false, loading: false, error: ""
    } } : {}) });
  }

  async loadRoutineHistory(options: { cursor?: string | null; signal?: AbortSignal } = {}): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const routineId = this.snapshot.routineWorkspace.presentation.historyRoutineId;
    const history = this.snapshot.routineWorkspace.history;
    if (options.cursor && (history.routineId !== routineId || history.nextCursor !== options.cursor)) return;
    const revision = ++this.routineHistoryListRevision;
    const isCurrent = () => ownerId === this.snapshot.currentUser?.id && ownerRevision === this.ownerRevision &&
      revision === this.routineHistoryListRevision && routineId === this.snapshot.routineWorkspace.presentation.historyRoutineId;
    this.updateRoutineWorkspace({ history: { ...history, routineId, loading: true, error: "" } });
    try {
      const page = await this.api.listRoutineSessions({
        ...(routineId ? { routineId } : {}), ...(options.cursor ? { cursor: options.cursor } : {}), signal: options.signal
      });
      options.signal?.throwIfAborted();
      if (!isCurrent()) return;
      const revisionsById = await this.loadRoutineRevisionSnapshots(page.sessions.map((entry) => entry.session), options.signal);
      options.signal?.throwIfAborted();
      if (!isCurrent()) return;
      this.updateRoutineWorkspace((current) => ({ revisionsById: { ...current.revisionsById, ...revisionsById }, history: {
        routineId, sessions: options.cursor ? mergeRoutineSessions(current.history.sessions, page.sessions) : page.sessions,
        nextCursor: page.nextCursor, loaded: true, loading: false, error: ""
      } }));
    } catch (error) {
      if (isCurrent()) this.updateRoutineWorkspace((current) => ({ history: {
        ...current.history, loading: false, error: options.signal?.aborted ? "" : messageFromError(error)
      } }));
    }
  }

  async selectRoutineSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const selectionRevision = ++this.routineSessionSelectionRevision;
    const { session } = await this.api.getRoutineSession(sessionId, signal);
    signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        selectionRevision !== this.routineSessionSelectionRevision) return;
    const currentRevision = this.snapshot.routineWorkspace.selectedRoutine?.currentRevision;
    const recordedRevision = currentRevision?.revision.id === session.session.routineRevisionId ? currentRevision :
      (await this.api.getRoutineRevision(session.session.routineId, session.session.routineRevisionId, signal)).routineRevision;
    signal?.throwIfAborted();
    if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
        selectionRevision !== this.routineSessionSelectionRevision) return;
    this.updateRoutineWorkspace((current) => ({
      sessions: mergeRoutineSessions(current.sessions, [session]), selectedSession: session, selectedSessionRevision: recordedRevision, error: "",
      revisionsById: { ...current.revisionsById, [recordedRevision.revision.id]: recordedRevision }
    }));
  }

  async appendRoutineSessionAmendment(
    sessionId: string, input: RoutineSessionAmendmentInput, signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureRoutineOwner();
    const selectionRevision = ++this.routineSessionSelectionRevision;
    const { session } = await this.api.appendRoutineSessionAmendment(sessionId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateRoutineWorkspace((current) => ({
      sessions: mergeRoutineSessions(current.sessions, [session]),
      history: { ...current.history, sessions: current.history.sessions.map((entry) => entry.session.id === sessionId ? session : entry) },
      selectedSession: selectionRevision === this.routineSessionSelectionRevision &&
        current.selectedSession?.session.id === sessionId ? session : current.selectedSession,
      error: ""
    }));
  }

  private async loadCalendarWorkspace(signal?: AbortSignal): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const ownerRevision = this.ownerRevision;
    const loadRevision = ++this.calendarWorkspaceLoadRevision;
    const current = () => ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
      loadRevision === this.calendarWorkspaceLoadRevision && this.snapshot.workspaceMode === "calendar";
    this.updateCalendarWorkspace({ loading: true, error: "" });
    try {
      const providerBindings: CalendarProviderBindingView[] = [];
      let calendars = await readAllPages(async (cursor) => {
        const page = await this.api.listCalendars({ limit: 100, ...(cursor ? { cursor } : {}), signal });
        providerBindings.push(...(page.providerBindings ?? []));
        signal?.throwIfAborted();
        return { items: page.calendars, nextCursor: page.nextCursor, truncated: page.truncated };
      });
      if (!current()) return;
      if (!calendars.some((calendar) => calendar.deletedAt === null)) {
        const response = await this.api.createCalendar({
          title: "My Calendar",
          color: "#7FC9B3",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          isDefault: true
        }, signal);
        signal?.throwIfAborted();
        if (!current()) return;
        calendars = mergeById(calendars, [response.calendar]);
      }
      this.updateCalendarWorkspace({
        calendars,
        providerBindings,
        calendarsNextCursor: null,
        calendarsComplete: true,
        loading: false,
        error: ""
      });
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === "AbortError")) {
        this.updateCalendarWorkspace({ loading: false, error: messageFromError(error) });
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    }
  }

  async openCalendar(updateHistory = true): Promise<void> {
    const returnParams = new URLSearchParams(this.route.pathname().split("?")[1] ?? "");
    const authorizationId = returnParams.get("calendarAuthorization");
    const authorizationError = returnParams.get("calendarConnectionError");
    if (authorizationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorizationId)) {
      this.updateCalendarWorkspace({ connectionFlow: { authorizationId, connectionId: null, discovery: null, loading: false, error: "", feedback: "Sign-in complete. Choose calendars and agent access to finish connecting." } });
    } else if (authorizationError) {
      const feedback = authorizationError === "cancelled" ? "Calendar connection was canceled. No calendars were added."
        : authorizationError === "session_expired" ? "The Calendar authorization session expired. Start Connect again."
          : "Calendar authorization could not be completed. Start Connect again.";
      this.updateCalendarWorkspace({ connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: feedback, feedback: "" } });
    }
    const navigation = ++this.navigationRevision;
    ++this.routineSelectionRevision;
    ++this.routineRunLookupRevision;
    ++this.routineSessionSelectionRevision;
    ++this.calendarSelectionRevision;
    this.update({
      workspaceMode: "calendar", selectedCollection: null, collectionMembers: [], collectionSections: [],
      collectionMemberDetails: {}, collectionMemberMemberships: {}, collectionComplete: false, collectionLoading: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsComplete: true, membershipsLoading: false, detailsOpen: false,
      activeView: "workspace", routePathname: authorizationId || authorizationError ? this.route.pathname() : "/calendar", routeQrId: null, routeLifeLinkId: null,
      publicQrState: null, canonicalEditingId: null, error: ""
    });
    this.updateCalendarWorkspace({ selectedEvent: null, selectedProviderEvent: null, latestTombstone: null, error: "" });
    if (updateHistory && !authorizationId && !authorizationError && this.route.pathname() !== "/calendar") this.route.push("/calendar");
    await Promise.all([
      this.loadCalendarWorkspace(),
      this.loadRoutineWorkspace().catch((error) => {
        if (navigation === this.navigationRevision && this.snapshot.workspaceMode === "calendar") {
          this.updateRoutineWorkspace({ error: messageFromError(error), loading: false });
        }
      })
    ]);
  }

  async openCalendarEvent(eventId: string, updateHistory = true, actor: CalendarActor = "human", signal?: AbortSignal): Promise<void> {
    const query = new URLSearchParams(this.route.pathname().split("?")[1] ?? "");
    if (!updateHistory && query.get("authority") === "provider" && query.get("connectionId") && query.get("calendarId")) {
      return this.openProviderCalendarEvent({ authority: "provider", providerEventId: eventId, connectionId: query.get("connectionId")!, calendarId: query.get("calendarId")! }, updateHistory, actor, signal);
    }
    const navigation = ++this.navigationRevision;
    const ownerId = this.snapshot.currentUser?.id;
    const ownerRevision = this.ownerRevision;
    const selectionRevision = ++this.calendarSelectionRevision;
    const pathname = ownerCalendarEventPath(eventId);
    this.update({
      workspaceMode: "calendar", selectedCollection: null, collectionMembers: [], collectionSections: [],
      collectionMemberDetails: {}, collectionMemberMemberships: {}, collectionComplete: false, collectionLoading: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsComplete: true, membershipsLoading: false, detailsOpen: false,
      activeView: "workspace", routePathname: pathname, routeQrId: null, routeLifeLinkId: null,
      publicQrState: null, canonicalEditingId: null, error: ""
    });
    this.updateCalendarWorkspace({ selectedEvent: null, selectedProviderEvent: null, latestTombstone: null, loading: true, error: "" });
    if (updateHistory && this.route.pathname() !== pathname) this.route.push(pathname);
    try {
      const [, , response] = await Promise.all([
        this.loadCalendarWorkspace(),
        this.loadRoutineWorkspace().catch(() => undefined),
        this.api.getCalendarEvent(eventId, signal, actor)
      ]);
      if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
          navigation !== this.navigationRevision || selectionRevision !== this.calendarSelectionRevision ||
          this.snapshot.workspaceMode !== "calendar") return;
      this.updateCalendarWorkspace((current) => ({
        events: mergeCalendarEvents(current.events, [response.calendarEvent]),
        selectedEvent: response.calendarEvent,
        latestTombstone: response.latestTombstone,
        loading: false,
        error: ""
      }));
      this.update({ detailsOpen: true });
    } catch (error) {
      if (ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
          navigation === this.navigationRevision && selectionRevision === this.calendarSelectionRevision) {
        this.updateCalendarWorkspace({ loading: false, error: messageFromError(error) });
      }
    }
  }

  async loadCalendarClock(timeZone: string, signal?: AbortSignal): Promise<CalendarClock | null> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return null;
    const ownerRevision = this.ownerRevision;
    const clockRevision = ++this.calendarClockLoadRevision;
    try {
      const clock = await this.api.getCalendarClock(timeZone, signal);
      signal?.throwIfAborted();
      if (ownerRevision !== this.ownerRevision || ownerId !== this.snapshot.currentUser?.id ||
          clockRevision !== this.calendarClockLoadRevision || this.snapshot.workspaceMode !== "calendar") return null;
      this.updateCalendarWorkspace({ clock, error: "" });
      return clock;
    } catch (error) {
      if (ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
          clockRevision === this.calendarClockLoadRevision && this.snapshot.workspaceMode === "calendar" &&
          !(error instanceof DOMException && error.name === "AbortError")) {
        this.updateCalendarWorkspace({ clock: null, error: messageFromError(error) });
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      return null;
    }
  }

  async loadCalendarWindow(options: { startDate: string; endDate: string; signal?: AbortSignal; background?: boolean }): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    options.signal?.throwIfAborted();
    const startingWorkspace = this.snapshot.calendarWorkspace;
    const requested = this.requestedCalendarWindow;
    if (options.background && (this.backgroundCalendarWindowPending || startingWorkspace.loading ||
        this.snapshot.routineWorkspace.calendarLoading || this.snapshot.workspaceMode !== "calendar" ||
        requested?.ownerRevision !== this.ownerRevision || requested.navigationRevision !== this.navigationRevision ||
        requested.startDate !== options.startDate || requested.endDate !== options.endDate)) return;
    if (!options.background) this.requestedCalendarWindow = { startDate: options.startDate, endDate: options.endDate,
      ownerRevision: this.ownerRevision, navigationRevision: this.navigationRevision };
    if (options.background) this.backgroundCalendarWindowPending = true;
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    const loadRevision = ++this.calendarWindowLoadRevision;
    const current = () => ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
      navigation === this.navigationRevision && loadRevision === this.calendarWindowLoadRevision &&
      this.snapshot.workspaceMode === "calendar" && !options.signal?.aborted &&
      // A quiet read must not replace a save, disconnect or visibility update
      // acknowledged while it was in flight. Foreground reads retain priority.
      (!options.background || (startingWorkspace.events === this.snapshot.calendarWorkspace.events &&
        startingWorkspace.providerEvents === this.snapshot.calendarWorkspace.providerEvents &&
        startingWorkspace.providerBindings === this.snapshot.calendarWorkspace.providerBindings &&
        startingWorkspace.calendars === this.snapshot.calendarWorkspace.calendars));
    if (!options.background) this.updateCalendarWorkspace({ loading: true, error: "" });
    try {
      const [events] = await Promise.all([
        readAllPages(async (cursor) => {
          const page = await this.api.listCalendarEvents({
            startDate: options.startDate,
            endDate: options.endDate,
            limit: 100,
            ...(cursor ? { cursor } : {}),
            signal: options.signal
          });
          options.signal?.throwIfAborted();
          return { items: page.calendarEvents, nextCursor: page.nextCursor, truncated: page.truncated };
        }),
        this.loadRoutineCalendarWindow(options)
      ]);
      if (!current()) return;
      const providerEvents: CalendarProviderEventProjection[] = [];
      for (const binding of this.snapshot.calendarWorkspace.providerBindings.filter((entry) => entry.visible && entry.capabilities.read)) {
        if (!current()) return;
        const projections = await readAllPages(async (cursor) => {
          const page = await this.api.listProviderCalendarEvents({ authority: "provider", connectionId: binding.connectionId, calendarId: binding.calendarId,
            startDate: options.startDate, endDate: options.endDate, limit: 100, ...(cursor ? { cursor } : {}) }, options.signal);
          options.signal?.throwIfAborted();
          if (page.providerEvents.some((entry) => entry.ownerId !== ownerId || entry.calendarId !== binding.calendarId || entry.connectionId !== binding.connectionId)) {
            throw new Error("Provider Calendar events could not be verified for this account.");
          }
          return { items: page.providerEvents, nextCursor: page.nextCursor, truncated: page.truncated };
        });
        providerEvents.push(...projections);
      }
      options.signal?.throwIfAborted();
      if (!current()) return;
      this.updateCalendarWorkspace({
        events,
        providerEvents,
        eventsNextCursor: null,
        eventsComplete: true,
        range: { startDate: options.startDate, endDate: options.endDate },
        loading: false,
        error: ""
      });
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === "AbortError")) {
        this.updateCalendarWorkspace({ loading: false, error: messageFromError(error) });
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    } finally {
      if (options.background) this.backgroundCalendarWindowPending = false;
    }
  }

  async createNativeCalendar(input: CalendarCreateInput, signal?: AbortSignal): Promise<CalendarRecord> {
    const sameOwner = this.captureCalendarOwner();
    const { calendar } = await this.api.createCalendar(input, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateCalendarWorkspace((current) => ({ calendars: mergeById(current.calendars, [calendar]), error: "" }));
    return calendar;
  }

  async openProviderCalendarEvent(reference: ProviderCalendarEventReference, updateHistory = true, actor: CalendarActor = "human", signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const opening = this.openCalendar(false);
    const navigation = this.navigationRevision;
    await opening;
    signal?.throwIfAborted();
    if (!sameOwner() || navigation !== this.navigationRevision) return;
    const selection = ++this.calendarSelectionRevision;
    const pathname = `${ownerCalendarEventPath(reference.providerEventId)}?${new URLSearchParams({ authority: "provider", connectionId: reference.connectionId, calendarId: reference.calendarId })}`;
    if (updateHistory && this.route.pathname() !== pathname) this.route.push(pathname);
    this.update({ routePathname: pathname });
    this.updateCalendarWorkspace({ selectedEvent: null, selectedProviderEvent: null, latestTombstone: null, loading: true, error: "" });
    try {
      const { providerEvent } = await this.api.getProviderCalendarEvent(reference, signal, actor);
      signal?.throwIfAborted();
      if (!sameOwner() || navigation !== this.navigationRevision || selection !== this.calendarSelectionRevision) return;
      if (!sameProviderReference(reference, providerEvent) || providerEvent.ownerId !== this.snapshot.currentUser?.id) throw new Error("The provider returned a different event identity.");
      this.updateCalendarWorkspace((current) => ({ providerEvents: mergeProviderEvents(current.providerEvents, [providerEvent]), selectedProviderEvent: providerEvent, loading: false, error: "" }));
      this.update({ detailsOpen: true });
    } catch (error) {
      if (sameOwner() && navigation === this.navigationRevision && selection === this.calendarSelectionRevision && !signal?.aborted) this.updateCalendarWorkspace({ loading: false, error: messageFromError(error) });
      throw error;
    }
  }

  async createExternalCalendarEvent(input: ProviderCalendarEventCreateInput, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<CalendarProviderEventProjection> {
    const sameTarget = this.captureConnectedCalendarTarget(input.connectionId, input.calendarId);
    const { providerEvent } = await this.api.createProviderCalendarEvent(input, signal, actor);
    signal?.throwIfAborted();
    if (providerEvent.connectionId !== input.connectionId || providerEvent.calendarId !== input.calendarId) throw new Error("The provider returned a different Calendar.");
    if (sameTarget()) this.showProviderCalendarEvent(providerEvent);
    return providerEvent;
  }

  async updateExternalCalendarEvent(providerEventId: string, input: ProviderCalendarEventUpdateInput, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<CalendarProviderEventProjection> {
    const sameTarget = this.captureConnectedCalendarTarget(input.connectionId, input.calendarId);
    const { providerEvent } = await this.api.updateProviderCalendarEvent(providerEventId, input, signal, actor);
    signal?.throwIfAborted();
    if (!sameProviderReference({ ...input, providerEventId }, providerEvent)) throw new Error("The provider returned a different event.");
    if (sameTarget()) this.showProviderCalendarEvent(providerEvent);
    return providerEvent;
  }

  async deleteExternalCalendarEvent(providerEventId: string, input: ProviderCalendarEventDeleteInput, signal?: AbortSignal, actor: CalendarActor = "human") {
    const sameTarget = this.captureConnectedCalendarTarget(input.connectionId, input.calendarId);
    const result = await this.api.deleteProviderCalendarEvent(providerEventId, input, signal, actor);
    signal?.throwIfAborted();
    if (result.authority !== "provider" || result.kind !== "delete" || result.connectionId !== input.connectionId || result.calendarId !== input.calendarId || result.providerEventId !== providerEventId || result.deletedProviderRevision !== input.expectedProviderRevision) throw new Error("The provider deletion did not match the confirmed event.");
    if (sameTarget()) {
      const reference = { ...input, providerEventId };
      this.updateCalendarWorkspace((current) => ({
        providerEvents: current.providerEvents.filter((entry) => !sameProviderReference(reference, entry)),
        selectedProviderEvent: current.selectedProviderEvent && sameProviderReference(reference, current.selectedProviderEvent) ? null : current.selectedProviderEvent,
        error: ""
      }));
    }
    return result;
  }

  private showProviderCalendarEvent(providerEvent: CalendarProviderEventProjection): void {
    if (providerEvent.ownerId !== this.snapshot.currentUser?.id) throw new Error("The provider event belongs to another account.");
    this.updateCalendarWorkspace((current) => ({ providerEvents: mergeProviderEvents(current.providerEvents, [providerEvent]), selectedProviderEvent: providerEvent,
      selectedEvent: null, latestTombstone: null, error: "" }));
    const pathname = `${ownerCalendarEventPath(providerEvent.providerEventId)}?${new URLSearchParams({ authority: "provider", connectionId: providerEvent.connectionId, calendarId: providerEvent.calendarId })}`;
    if (this.route.pathname() !== pathname) this.route.push(pathname);
    this.update({ workspaceMode: "calendar", routePathname: pathname, detailsOpen: true });
  }

  async updateNativeCalendar(calendarId: string, expectedUpdatedAt: string, patch: CalendarPatch, signal?: AbortSignal): Promise<CalendarRecord> {
    const sameOwner = this.captureCalendarOwner();
    const { calendar } = await this.api.updateCalendar(calendarId, expectedUpdatedAt, patch, signal);
    signal?.throwIfAborted();
    if (sameOwner()) {
      this.updateCalendarWorkspace((current) => ({ calendars: mergeById(current.calendars, [calendar]), error: "" }));
      if (calendar.agentAccess !== "write") this.invalidateCalendarAgentPreviews(calendar.id);
    }
    return calendar;
  }

  async loadCalendarConnections(signal?: AbortSignal): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return;
    const sameOwner = this.captureCalendarOwner();
    const revision = ++this.calendarConnectionsLoadRevision;
    const current = () => sameOwner() && revision === this.calendarConnectionsLoadRevision;
    this.updateCalendarWorkspace((workspace) => ({
      connectionManagement: { ...workspace.connectionManagement, loading: true, loaded: false, error: "" }
    }));
    try {
      const [providerResponse, connectionResponse] = await Promise.all([
        this.api.listCalendarProviders(signal), this.api.listCalendarConnections(signal)
      ]);
      signal?.throwIfAborted();
      if (connectionResponse.connections.some((connection) => connection.ownerId !== ownerId)) {
        throw new Error("Calendar connections could not be verified for this account.");
      }
      const calendars = [];
      // Bound account-by-account reads avoid a burst of requests for owners with many connections.
      for (const connection of connectionResponse.connections) {
        const response = await this.api.listConnectedCalendars(connection.connectionId, signal);
        signal?.throwIfAborted();
        if (!current()) return;
        if (response.calendars.some((entry) => entry.connectionId !== connection.connectionId || entry.calendar.ownerId !== ownerId)) {
          throw new Error("Connected calendars could not be verified for this account.");
        }
        calendars.push(...response.calendars);
      }
      if (current()) this.updateCalendarWorkspace({ connectionManagement: {
        providers: providerResponse.providers, connections: connectionResponse.connections, calendars,
        loading: false, loaded: true, error: ""
      } });
    } catch (error) {
      if (current()) this.updateCalendarWorkspace((workspace) => ({ connectionManagement: {
        ...workspace.connectionManagement, loading: false, loaded: false,
        error: signal?.aborted ? "" : messageFromError(error)
      } }));
      if (!signal?.aborted) throw error;
    }
  }

  async updateConnectedCalendar(connectionId: string, calendarId: string, expectedUpdatedAt: string, patch: CalendarConnectedCalendarPatch, signal?: AbortSignal) {
    const sameOwner = this.captureConnectedCalendarTarget(connectionId, calendarId);
    const { calendar } = await this.api.updateConnectedCalendar(connectionId, calendarId, expectedUpdatedAt, patch, signal);
    signal?.throwIfAborted();
    if (calendar.connectionId !== connectionId || calendar.calendar.id !== calendarId) throw new Error("The provider returned a different Calendar.");
    if (sameOwner()) {
      if (calendar.calendar.ownerId !== this.snapshot.currentUser?.id) throw new Error("Calendar settings could not be verified for this account.");
      // The PATCH response is the committed settings. Publish it directly so an
      // unrelated follow-up read cannot turn a successful save into a failed one.
      this.updateCalendarWorkspace((current) => ({ calendars: mergeById(current.calendars, [calendar.calendar]),
        connectionManagement: { ...current.connectionManagement, error: "", calendars: current.connectionManagement.calendars.map((entry) =>
          entry.connectionId === connectionId && entry.calendar.id === calendarId ? calendar : entry) },
        providerBindings: current.providerBindings.map((binding) => binding.connectionId === connectionId && binding.calendarId === calendarId ? { ...binding, visible: calendar.visible, capabilities: calendar.capabilities } : binding) }));
      if (calendar.calendar.agentAccess !== "write") this.invalidateCalendarAgentPreviews(calendarId);
      if (patch.visible && this.snapshot.calendarWorkspace.range) {
        try { await this.loadCalendarWindow({ ...this.snapshot.calendarWorkspace.range, signal }); }
        catch {
          if (sameOwner() && !signal?.aborted) this.updateCalendarWorkspace((current) => ({ connectionManagement: {
            ...current.connectionManagement, error: "Settings saved, but events could not be refreshed. Try Refresh now."
          } }));
        }
      }
    }
    return calendar;
  }

  async beginMicrosoftCalendarAuthorization(reconnectConnectionId?: string, signal?: AbortSignal): Promise<string> {
    return this.beginCalendarProviderAuthorization("microsoft", reconnectConnectionId, signal);
  }

  async beginGoogleCalendarAuthorization(reconnectConnectionId?: string, signal?: AbortSignal): Promise<string> {
    return this.beginCalendarProviderAuthorization("google", reconnectConnectionId, signal);
  }

  private async beginCalendarProviderAuthorization(provider: "microsoft" | "google", reconnectConnectionId?: string, signal?: AbortSignal): Promise<string> {
    const sameOwner = this.captureCalendarOwner();
    signal?.throwIfAborted();
    const response = provider === "microsoft"
      ? await this.api.authorizeMicrosoftCalendar(reconnectConnectionId, signal)
      : await this.api.authorizeGoogleCalendar(reconnectConnectionId, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) throw new Error("The signed-in account changed.");
    const destination = new URL(response.authorizationUrl);
    const expectedHost = provider === "microsoft" ? "login.microsoftonline.com" : "accounts.google.com";
    if (destination.protocol !== "https:" || destination.hostname !== expectedHost || destination.port || destination.username || destination.password) {
      throw new Error(`The server returned an unsupported ${provider === "microsoft" ? "Outlook" : "Google"} sign-in destination.`);
    }
    return destination.href;
  }

  async loadCalendarConnectionDiscovery(connectionId?: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const sameOwner = this.captureCalendarOwner();
    const revision = ++this.calendarConnectionFlowRevision;
    const authorizationId = connectionId ? null : this.snapshot.calendarWorkspace.connectionFlow.authorizationId;
    if (!connectionId && !authorizationId) return;
    this.updateCalendarWorkspace({ connectionFlow: { authorizationId, connectionId: connectionId ?? null, discovery: null, loading: true, error: "", feedback: "" } });
    try {
      const discovery = connectionId
        ? await this.api.discoverConnectedCalendars(connectionId, signal)
        : await this.api.getCalendarAuthorization(authorizationId!, signal);
      signal?.throwIfAborted();
      if (sameOwner() && revision === this.calendarConnectionFlowRevision) {
        this.updateCalendarWorkspace({ connectionFlow: { authorizationId, connectionId: connectionId ?? null, discovery, loading: false, error: "", feedback: "Choose calendars and the access you want your connected agent to have." } });
      }
    } catch (error) {
      if (sameOwner() && revision === this.calendarConnectionFlowRevision) {
        this.updateCalendarWorkspace((current) => ({ connectionFlow: { ...current.connectionFlow, loading: false, error: signal?.aborted ? "" : messageFromError(error) } }));
      }
      if (!signal?.aborted) throw error;
    }
  }

  async completeCalendarConnectionSelection(selectedCalendarIds: string[], signal?: AbortSignal, agentAccessByCalendarId?: CalendarConnectionSelectionInput["agentAccessByCalendarId"]): Promise<void> {
    signal?.throwIfAborted();
    const sameOwner = this.captureCalendarOwner();
    const flowRevision = this.calendarConnectionFlowRevision;
    const flow = this.snapshot.calendarWorkspace.connectionFlow;
    if (!flow.discovery || (!flow.authorizationId && !flow.connectionId)) throw new Error("Load the available calendars first.");
    const available = new Map(flow.discovery.calendars.filter((calendar) => calendar.capabilities.read).map((calendar) => [calendar.providerCalendarId, calendar]));
    if (!selectedCalendarIds.length || selectedCalendarIds.length > 50 || new Set(selectedCalendarIds).size !== selectedCalendarIds.length || selectedCalendarIds.some((id) => !available.has(id))) {
      throw new Error("Choose one or more exact available calendars.");
    }
    const ids = [...selectedCalendarIds];
    if (agentAccessByCalendarId !== undefined) {
      if (!agentAccessByCalendarId || typeof agentAccessByCalendarId !== "object" || Array.isArray(agentAccessByCalendarId)
        || Object.keys(agentAccessByCalendarId).length !== ids.length
        || Object.entries(agentAccessByCalendarId).some(([id, access]) => {
          const calendar = available.get(id);
          return !ids.includes(id) || !calendar || !["none", "read", "write"].includes(access)
            || (access === "write" && !calendar.capabilities.create && !calendar.capabilities.update && !calendar.capabilities.delete);
        })) throw new Error("Choose an available agent access level for each selected calendar.");
      const access = { ...agentAccessByCalendarId };
      if (flow.authorizationId) await this.api.completeCalendarAuthorization(flow.authorizationId, ids, signal, access);
      else await this.api.selectConnectedCalendars(flow.connectionId!, ids, signal, access);
    } else if (flow.authorizationId) await this.api.completeCalendarAuthorization(flow.authorizationId, ids, signal);
    else await this.api.selectConnectedCalendars(flow.connectionId!, ids, signal);
    signal?.throwIfAborted();
    if (!sameOwner() || flowRevision !== this.calendarConnectionFlowRevision) return;
    ++this.calendarConnectionFlowRevision;
    this.updateCalendarWorkspace({ connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: "", feedback: agentAccessByCalendarId === undefined
      ? "Selected calendars connected. New calendars have no agent access until you choose it in Manage calendars."
      : "Selected calendars connected with your chosen agent access." } });
    if (/calendarAuthorization=|calendarConnectionError=/.test(this.route.pathname())) this.route.push("/calendar");
    await this.loadCalendarWorkspace(signal);
    await this.loadCalendarConnections(signal);
    const range = this.snapshot.calendarWorkspace.range;
    if (range) await this.loadCalendarWindow({ ...range, signal });
  }

  async cancelCalendarConnectionSelection(signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const authorizationId = this.snapshot.calendarWorkspace.connectionFlow.authorizationId;
    ++this.calendarConnectionFlowRevision;
    if (authorizationId) await this.api.cancelCalendarAuthorization(authorizationId, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateCalendarWorkspace({ connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: "", feedback: "Calendar selection canceled." } });
    if (/calendarAuthorization=|calendarConnectionError=/.test(this.route.pathname())) this.route.push("/calendar");
  }

  async refreshConnectedCalendarAccount(connectionId: string, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const range = this.snapshot.calendarWorkspace.range;
    const today = this.snapshot.calendarWorkspace.clock?.today;
    if (!range && !today) throw new Error("Wait for the Calendar date to load before refreshing.");
    const start = range?.startDate ?? today!;
    const end = new Date(`${range?.endDate ?? today}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    await this.api.refreshCalendarConnection(connectionId, `${start}T00:00:00.000Z`, end.toISOString(), signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    await this.loadCalendarConnections(signal);
    if (range) await this.loadCalendarWindow({ ...range, signal });
  }

  async disconnectCalendarConnection(connectionId: string, disposition: "purge" | "retain_private_stale", signal?: AbortSignal) {
    const sameOwner = this.captureCalendarOwner();
    const { connection } = await this.api.disconnectCalendarConnection(connectionId, disposition, signal);
    signal?.throwIfAborted();
    if (sameOwner()) {
      const ids = new Set(this.snapshot.calendarWorkspace.connectionManagement.calendars
        .filter((entry) => entry.connectionId === connectionId).map((entry) => entry.calendar.id));
      for (const id of ids) this.invalidateCalendarAgentPreviews(id);
      this.updateCalendarWorkspace((current) => ({
        calendars: current.calendars.filter((calendar) => !ids.has(calendar.id)),
        providerBindings: current.providerBindings.filter((entry) => entry.connectionId !== connectionId),
        providerEvents: current.providerEvents.filter((entry) => entry.connectionId !== connectionId),
        ...(current.selectedProviderEvent?.connectionId === connectionId ? { selectedProviderEvent: null } : {}),
        events: current.events.filter((detail) => !ids.has(detail.event.calendarId)),
        ...(current.selectedEvent && ids.has(current.selectedEvent.event.calendarId) ? { selectedEvent: null, latestTombstone: null } : {})
      }));
      await this.loadCalendarConnections(signal);
    }
    return connection;
  }

  async removeConnectedCalendar(connectionId: string, calendarId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    await this.api.removeConnectedCalendar(connectionId, calendarId, expectedUpdatedAt, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.forgetConnectedCalendars(connectionId, new Set([calendarId]), false);
  }

  async removeCalendarConnection(connectionId: string, expectedConnectedAt: string, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    await this.api.removeCalendarConnection(connectionId, expectedConnectedAt, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    const current = this.snapshot.calendarWorkspace;
    const ids = new Set([
      ...current.connectionManagement.calendars.filter((entry) => entry.connectionId === connectionId).map((entry) => entry.calendar.id),
      ...current.providerBindings.filter((entry) => entry.connectionId === connectionId).map((entry) => entry.calendarId)
    ]);
    this.forgetConnectedCalendars(connectionId, ids, true);
  }

  private forgetConnectedCalendars(connectionId: string, calendarIds: Set<string>, removeAccount: boolean): void {
    // Acknowledged local removal must win over reads already in flight. Keep
    // unrelated calendars, provider accounts, native events and Routine state.
    this.calendarConnectionsLoadRevision += 1;
    this.calendarWindowLoadRevision += 1;
    this.calendarWorkspaceLoadRevision += 1;
    this.calendarSelectionRevision += 1;
    if (removeAccount) this.removedCalendarAccounts.set(connectionId, (this.removedCalendarAccounts.get(connectionId) ?? 0) + 1);
    for (const id of calendarIds) {
      const key = JSON.stringify([connectionId, id]);
      this.removedConnectedCalendars.set(key, (this.removedConnectedCalendars.get(key) ?? 0) + 1);
    }
    for (const id of calendarIds) this.invalidateCalendarAgentPreviews(id);
    const removed = (entry: { connectionId: string; calendarId: string }) =>
      entry.connectionId === connectionId && (removeAccount || calendarIds.has(entry.calendarId));
    this.updateCalendarWorkspace((current) => ({
      loading: false,
      calendars: current.calendars.filter((calendar) => !calendarIds.has(calendar.id)),
      providerBindings: current.providerBindings.filter((entry) => !removed(entry)),
      providerEvents: current.providerEvents.filter((entry) => !removed(entry)),
      ...(current.selectedProviderEvent && removed(current.selectedProviderEvent) ? { selectedProviderEvent: null } : {}),
      connectionManagement: {
        ...current.connectionManagement, loading: false, error: "",
        connections: current.connectionManagement.connections.filter((entry) => !removeAccount || entry.connectionId !== connectionId),
        calendars: current.connectionManagement.calendars.filter((entry) => !removed({ connectionId: entry.connectionId, calendarId: entry.calendar.id }))
      }
    }));
  }

  private captureConnectedCalendarTarget(connectionId: string, calendarId: string): () => boolean {
    const sameOwner = this.captureCalendarOwner();
    const key = JSON.stringify([connectionId, calendarId]);
    const accountGeneration = this.removedCalendarAccounts.get(connectionId) ?? 0;
    const calendarGeneration = this.removedConnectedCalendars.get(key) ?? 0;
    return () => sameOwner() && accountGeneration === (this.removedCalendarAccounts.get(connectionId) ?? 0)
      && calendarGeneration === (this.removedConnectedCalendars.get(key) ?? 0);
  }

  private invalidateCalendarAgentPreviews(calendarId: string) {
    const confirmation = this.snapshot.agentCalendarDeletionConfirmation;
    if (confirmation && ("providerEvent" in confirmation ? confirmation.providerEvent.calendarId : confirmation.event.event.calendarId) === calendarId) this.confirmAgentCalendarDeletion(false);
    for (const [key, entry] of this.agentCalendarDeletionPreviews) {
      if (entry.preview.event.event.calendarId === calendarId) this.agentCalendarDeletionPreviews.delete(key);
    }
    for (const [key, entry] of this.agentProviderCalendarDeletionPreviews) {
      if (entry.preview.providerEvent.calendarId === calendarId) this.agentProviderCalendarDeletionPreviews.delete(key);
    }
  }

  async deleteNativeCalendar(calendarId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<CalendarRecord> {
    const sameOwner = this.captureCalendarOwner();
    const { calendar } = await this.api.deleteCalendar(calendarId, expectedUpdatedAt, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateCalendarWorkspace((current) => ({ calendars: mergeById(current.calendars, [calendar]), error: "" }));
    return calendar;
  }

  async restoreNativeCalendar(calendarId: string, expectedUpdatedAt: string, signal?: AbortSignal): Promise<CalendarRecord> {
    const sameOwner = this.captureCalendarOwner();
    const { calendar } = await this.api.restoreCalendar(calendarId, expectedUpdatedAt, signal);
    signal?.throwIfAborted();
    if (sameOwner()) this.updateCalendarWorkspace((current) => ({ calendars: mergeById(current.calendars, [calendar]), error: "" }));
    return calendar;
  }

  async createNativeCalendarEvent(input: CalendarEventCreateInput, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const selectionRevision = ++this.calendarSelectionRevision;
    const response = await this.api.createCalendarEvent(input, signal, actor);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.calendarSelectionRevision) return;
    this.updateCalendarWorkspace((current) => ({
      events: mergeCalendarEvents(current.events, [response.calendarEvent]),
      selectedEvent: response.calendarEvent,
      selectedProviderEvent: null,
      latestTombstone: response.latestTombstone,
      error: ""
    }));
    const pathname = ownerCalendarEventPath(response.calendarEvent.event.id);
    if (this.route.pathname() !== pathname) this.route.push(pathname);
    this.update({ routePathname: pathname, detailsOpen: true });
  }

  async updateNativeCalendarEvent(eventId: string, input: CalendarEventRevisionInput, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const selectionRevision = ++this.calendarSelectionRevision;
    const response = await this.api.updateCalendarEvent(eventId, input, signal, actor);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateCalendarWorkspace((current) => ({
      events: mergeCalendarEvents(current.events, [response.calendarEvent]),
      selectedEvent: selectionRevision === this.calendarSelectionRevision && current.selectedEvent?.event.id === eventId
        ? response.calendarEvent
        : current.selectedEvent,
      latestTombstone: selectionRevision === this.calendarSelectionRevision && current.selectedEvent?.event.id === eventId
        ? response.latestTombstone
        : current.latestTombstone,
      error: ""
    }));
  }

  async deleteNativeCalendarEvent(eventId: string, input: CalendarEventDeleteInput, signal?: AbortSignal): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const selectionRevision = ++this.calendarSelectionRevision;
    const response = await this.api.deleteCalendarEvent(eventId, input, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateCalendarWorkspace((current) => ({
      events: mergeCalendarEvents(current.events, [response.calendarEvent]),
      selectedEvent: selectionRevision === this.calendarSelectionRevision && current.selectedEvent?.event.id === eventId
        ? response.calendarEvent
        : current.selectedEvent,
      latestTombstone: selectionRevision === this.calendarSelectionRevision && current.selectedEvent?.event.id === eventId
        ? response.latestTombstone
        : current.latestTombstone,
      error: ""
    }));
  }

  async restoreNativeCalendarEvent(
    eventId: string, expectedCurrentRevisionId: string, tombstoneId: string, signal?: AbortSignal
  ): Promise<void> {
    const sameOwner = this.captureCalendarOwner();
    const selectionRevision = ++this.calendarSelectionRevision;
    const response = await this.api.restoreCalendarEvent(eventId, { expectedCurrentRevisionId, tombstoneId }, signal);
    signal?.throwIfAborted();
    if (!sameOwner()) return;
    this.updateCalendarWorkspace((current) => ({
      events: mergeCalendarEvents(current.events, [response.calendarEvent]),
      selectedEvent: selectionRevision === this.calendarSelectionRevision && current.selectedEvent?.event.id === eventId
        ? response.calendarEvent
        : current.selectedEvent,
      latestTombstone: response.latestTombstone,
      error: ""
    }));
  }

  getAgentCalendarSnapshot() {
    return {
      currentUser: this.snapshot.currentUser ? { id: this.snapshot.currentUser.id } : null,
      routeQrId: this.snapshot.routeQrId,
      guestView: this.snapshot.guestView,
      agentToolCatalogId: this.snapshot.agentConnection.connected && this.currentAgentOwnerId()
        ? this.snapshot.agentConnection.toolCatalogId
        : null
    };
  }

  async agentListAuthorizedCalendars(input: AgentListCalendarsInput, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
    try {
      await this.openCalendar();
      signal?.throwIfAborted();
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
      const calendars = (await this.readAgentCalendars(signal))
        .filter((calendar) => agentCanReadCalendar(calendar, ownerId))
        .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
      const offset = decodeCalendarAgentCursor(input.cursor, "calendars");
      if (offset === null || offset > calendars.length) return { ok: false as const, code: "effect_not_applied" as const };
      const page = calendars.slice(offset, offset + input.limit);
      return {
        ok: true as const,
        calendars: page.map(agentCalendarRecord),
        nextCursor: offset + page.length < calendars.length ? encodeCalendarAgentCursor("calendars", offset + page.length) : null,
        truncated: offset + page.length < calendars.length
      };
    } catch (error) {
      return calendarAgentReadFailure(error, signal, "calendar_unavailable");
    }
  }

  async agentQueryCalendarEvents(input: AgentQueryCalendarEventsInput, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
    try {
      await this.openCalendar();
      signal?.throwIfAborted();
      const calendars = await this.readAgentCalendars(signal);
      if (input.calendarIds?.some((calendarId) => !calendars.some(
        (calendar) => calendar.id === calendarId && agentCanReadCalendar(calendar, ownerId)
      ))) return { ok: false as const, code: "calendar_unavailable" as const };
      await this.loadCalendarWindow({ startDate: input.startDate, endDate: input.endDate, signal });
      const authorizedEvents = await readAllPages(async (cursor) => {
        const page = await this.api.listCalendarEvents({
          startDate: input.startDate, endDate: input.endDate, limit: 100,
          ...(cursor ? { cursor } : {}), signal, actor: "agent"
        });
        signal?.throwIfAborted();
        return { items: page.calendarEvents, nextCursor: page.nextCursor, truncated: page.truncated };
      });
      signal?.throwIfAborted();
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
      const allowed = input.calendarIds ? new Set(input.calendarIds) : null;
      const providerEvents: CalendarProviderEventProjection[] = [];
      for (const calendar of calendars) {
        const binding = calendar.providerBinding;
        if (!binding || !agentCanReadCalendar(calendar, ownerId) || (allowed && !allowed.has(calendar.id))) continue;
        const events = await readAllPages(async (cursor) => {
          const page = await this.api.listProviderCalendarEvents({ authority: "provider", connectionId: binding.connectionId,
            calendarId: calendar.id, startDate: input.startDate, endDate: input.endDate, limit: 100, ...(cursor ? { cursor } : {}) }, signal, "agent");
          return { items: page.providerEvents, nextCursor: page.nextCursor, truncated: page.truncated };
        });
        providerEvents.push(...events.filter((event) => event.ownerId === ownerId && providerEventMatchesCalendar(event, calendar)));
      }
      const calendarById = new Map((await this.readAgentCalendars(signal))
        .filter((calendar) => agentCanReadCalendar(calendar, ownerId))
        .map((calendar) => [calendar.id, calendar]));
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
      const definitions = authorizedEvents
        .filter((detail) => detail.event.ownerId === ownerId && detail.event.deletedAt === null &&
          calendarById.has(detail.event.calendarId) && (!allowed || allowed.has(detail.event.calendarId)));
      const nativeInstances: AgentCalendarEventInstance[] = [...calendarById.values()]
        .filter((calendar) => calendar.source === "native" && (!allowed || allowed.has(calendar.id)))
        .flatMap((calendar) => materializeCalendarEventWindow({
          definitions: definitions.filter((detail) => detail.event.calendarId === calendar.id),
          startDate: input.startDate,
          endDate: input.endDate,
          viewTimeZone: calendar.timeZone
        }).map((instance) => ({ source: "calendar_event" as const, instance, calendar: agentCalendarRecord(calendar) })));
      const routineById = new Map(this.snapshot.routineWorkspace.routines
        .filter((routine) => routine.ownerId === ownerId && routine.archivedAt === null)
        .map((routine) => [routine.id, routine]));
      const routineProjections: AgentCalendarEventInstance[] = this.snapshot.routineWorkspace.calendarOccurrences
        .filter((occurrence) => occurrence.ownerId === ownerId && occurrence.status !== "canceled" &&
          occurrence.localDate >= input.startDate && occurrence.localDate <= input.endDate &&
          routineById.has(occurrence.routineId))
        .map((occurrence) => ({
          source: "routine_projection" as const,
          occurrence,
          routine: routineById.get(occurrence.routineId)!
        }));
      const providerInstances: AgentCalendarEventInstance[] = providerEvents.flatMap((providerEvent) => {
        const calendar = calendarById.get(providerEvent.calendarId);
        return calendar && providerEventMatchesCalendar(providerEvent, calendar)
          ? [{ source: "provider_event" as const, providerEvent, calendar: agentCalendarRecord(calendar) }] : [];
      });
      const instances = [...nativeInstances, ...routineProjections, ...providerInstances]
        .sort((left, right) => calendarAgentInstanceSortKey(left).localeCompare(calendarAgentInstanceSortKey(right)) ||
          calendarAgentInstanceId(left).localeCompare(calendarAgentInstanceId(right)));
      const offset = decodeCalendarAgentCursor(input.cursor, "events");
      if (offset === null || offset > instances.length) return { ok: false as const, code: "effect_not_applied" as const };
      const candidates = instances.slice(offset, offset + input.limit);
      // Provider identities and revision metadata are larger; keep a provider page within the tool's byte budget.
      const page = candidates.some((entry) => entry.source === "provider_event") ? candidates.slice(0, 1) : candidates;
      return {
        ok: true as const,
        instances: page,
        nextCursor: offset + page.length < instances.length ? encodeCalendarAgentCursor("events", offset + page.length) : null,
        truncated: offset + page.length < instances.length
      };
    } catch (error) {
      return calendarAgentReadFailure(error, signal, "calendar_unavailable");
    }
  }

  async agentInspectProviderCalendarEvent(input: ProviderCalendarEventReference, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
    try {
      await this.openProviderCalendarEvent(input, true, "agent", signal);
      const providerEvent = this.snapshot.calendarWorkspace.selectedProviderEvent;
      const calendar = (await this.readAgentCalendars(signal)).find((entry) => entry.id === input.calendarId);
      if (this.agentCalendarOwnerId() !== ownerId || !calendar || !agentCanReadCalendar(calendar, ownerId) || !providerEvent ||
          !sameProviderReference(input, providerEvent) || !providerEventMatchesCalendar(providerEvent, calendar)) {
        return { ok: false as const, code: "calendar_event_unavailable" as const };
      }
      return { ok: true as const, providerEvent, calendar: agentCalendarRecord(calendar) };
    } catch (error) { return calendarAgentReadFailure(error, signal, "calendar_event_unavailable"); }
  }

  async agentCreateProviderCalendarEvent(input: ProviderCalendarEventCreateInput, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
    try {
      const calendar = (await this.readAgentCalendars(signal)).find((entry) => entry.id === input.calendarId);
      if (!calendar || !agentCanWriteProviderCalendar(calendar, ownerId, input.connectionId, "create") || this.agentCalendarOwnerId() !== ownerId) {
        return { ok: false as const, code: "calendar_unavailable" as const };
      }
      await this.openCalendar();
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "cancelled" as const };
      const providerEvent = await this.createExternalCalendarEvent(input, signal, "agent");
      if (this.agentCalendarOwnerId() !== ownerId || !providerEventMatchesCalendar(providerEvent, calendar)) return { ok: false as const, code: "effect_not_applied" as const };
      return { ok: true as const, providerEvent, calendar: agentCalendarRecord(calendar) };
    } catch (error) { return calendarAgentWriteFailure(error, signal, "calendar_unavailable"); }
  }

  async agentUpdateProviderCalendarEvent(input: ProviderCalendarEventUpdateInput & { providerEventId: string }, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
    try {
      const calendar = (await this.readAgentCalendars(signal)).find((entry) => entry.id === input.calendarId);
      if (!calendar || !agentCanWriteProviderCalendar(calendar, ownerId, input.connectionId, "update") || this.agentCalendarOwnerId() !== ownerId) {
        return { ok: false as const, code: "calendar_event_unavailable" as const };
      }
      const { providerEventId, ...command } = input;
      // The gateway owns exact-revision validation and stable-command replay, including a lost successful response.
      const providerEvent = await this.updateExternalCalendarEvent(providerEventId, command, signal, "agent");
      if (this.agentCalendarOwnerId() !== ownerId || !sameProviderReference(input, providerEvent) || !providerEventMatchesCalendar(providerEvent, calendar)) return { ok: false as const, code: "effect_not_applied" as const };
      return { ok: true as const, providerEvent, calendar: agentCalendarRecord(calendar) };
    } catch (error) { return calendarAgentWriteFailure(error, signal, "calendar_event_unavailable"); }
  }

  async agentPrepareProviderCalendarEventDeletion(input: ProviderCalendarEventReference & { expectedProviderRevision: string; scope: "event" }, signal?: AbortSignal) {
    const inspected = await this.agentInspectProviderCalendarEvent(input, signal);
    if (!inspected.ok) return inspected;
    if (inspected.calendar.agentAccess !== "write" || !inspected.calendar.capabilities?.delete) return { ok: false as const, code: "calendar_event_unavailable" as const };
    if (inspected.providerEvent.providerRevision !== input.expectedProviderRevision) return { ok: false as const, code: "stale_calendar_event" as const };
    if (input.scope !== "event" || !providerEventCanMutate(inspected.providerEvent)) return { ok: false as const, code: "unsupported_calendar_authority" as const };
    const preview: AgentProviderCalendarDeletionPreview = {
      id: `provider-calendar-delete-preview-${this.commandId()}`, providerEvent: inspected.providerEvent, calendar: inspected.calendar, scope: "event",
      knownEffects: ["This deletes the exact original event in the provider calendar, not only its Life Links display.",
        "Life Links cannot restore this provider deletion.", "No attendees, invitations, online meetings, or recurring series are changed."]
    };
    if (this.agentProviderCalendarDeletionPreviews.size >= 5) this.agentProviderCalendarDeletionPreviews.delete(this.agentProviderCalendarDeletionPreviews.keys().next().value!);
    this.agentProviderCalendarDeletionPreviews.set(preview.id, { preview, authorized: false, commandId: `provider-calendar-delete-${this.commandId()}`, result: null });
    return { ok: true as const, preview };
  }

  async agentApplyProviderCalendarEventDeletion(previewId: string, signal?: AbortSignal) {
    if (this.agentCalendarDeletionApplication) return { ok: false as const, code: "confirmation_required" as const };
    const entry = this.agentProviderCalendarDeletionPreviews.get(previewId);
    if (!entry) return { ok: false as const, code: "confirmation_required" as const };
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId || entry.preview.providerEvent.ownerId !== ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
    const admission = {};
    this.agentCalendarDeletionApplication = admission;
    const target = entry.preview.providerEvent;
    try {
      const calendar = (await this.readAgentCalendars(signal)).find((item) => item.id === target.calendarId);
      if (!calendar || !agentCanWriteProviderCalendar(calendar, ownerId, target.connectionId, "delete") || this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
      if (entry.result) return { ok: true as const, result: entry.result };
      if (!entry.authorized) {
        const { providerEvent } = await this.api.getProviderCalendarEvent({ authority: "provider", connectionId: target.connectionId, calendarId: target.calendarId, providerEventId: target.providerEventId }, signal, "agent");
        if (!providerEventMatchesCalendar(providerEvent, calendar) || !sameProviderReference(target, providerEvent) || providerEvent.providerRevision !== target.providerRevision || !providerEventCanMutate(providerEvent)) return { ok: false as const, code: "stale_calendar_event" as const };
        if (this.agentCalendarOwnerId() !== ownerId || this.agentProviderCalendarDeletionPreviews.get(previewId) !== entry) return { ok: false as const, code: "cancelled" as const };
        const accepted = await new Promise<boolean>((resolve) => {
          const abort = () => this.confirmAgentCalendarDeletion(false);
          this.settleAgentCalendarDeletion = (confirmed) => { signal?.removeEventListener("abort", abort); resolve(confirmed); };
          signal?.addEventListener("abort", abort, { once: true });
          this.update({ agentCalendarDeletionConfirmation: entry.preview });
          if (signal?.aborted) abort();
        });
        if (!accepted) return { ok: false as const, code: "confirmation_cancelled" as const };
        entry.authorized = true;
      }
      signal?.throwIfAborted();
      if (this.agentCalendarDeletionApplication !== admission || this.agentCalendarOwnerId() !== ownerId || this.agentProviderCalendarDeletionPreviews.get(previewId) !== entry) return { ok: false as const, code: "cancelled" as const };
      const result = await this.deleteExternalCalendarEvent(target.providerEventId, { authority: "provider", commandId: entry.commandId,
        connectionId: target.connectionId, calendarId: target.calendarId, expectedProviderRevision: target.providerRevision, scope: "event" }, signal, "agent");
      if (this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "cancelled" as const };
      entry.result = result;
      return { ok: true as const, result };
    } catch (error) { return calendarAgentWriteFailure(error, signal, "calendar_event_unavailable"); }
    finally { if (this.agentCalendarDeletionApplication === admission) this.agentCalendarDeletionApplication = null; }
  }

  async agentInspectCalendarEvent(input: AgentInspectCalendarEventInput, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
    try {
      await this.openCalendarEvent(input.eventId, true, "agent", signal);
      signal?.throwIfAborted();
      const detail = this.snapshot.calendarWorkspace.selectedEvent;
      const calendar = detail && (await this.api.getCalendar(detail.event.calendarId, signal, "agent")).calendar;
      if (this.agentCalendarOwnerId() !== ownerId || !detail || detail.event.id !== input.eventId ||
          detail.event.ownerId !== ownerId || detail.event.deletedAt !== null || !calendar || calendar.ownerId !== ownerId ||
          !agentCanReadCalendar(calendar, ownerId)) {
        return { ok: false as const, code: "calendar_event_unavailable" as const };
      }
      return { ok: true as const, detail: agentCalendarEventDetail(detail, calendar) };
    } catch (error) {
      return calendarAgentReadFailure(error, signal, "calendar_event_unavailable");
    }
  }

  async agentCreateCalendarEvent(input: AgentCreateCalendarEventInput, signal?: AbortSignal) {
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_unavailable" as const };
    try {
      const calendar = (await this.api.getCalendar(input.calendarId, signal, "agent")).calendar;
      signal?.throwIfAborted();
      if (!calendar || calendar.id !== input.calendarId || !agentCanReadCalendar(calendar, ownerId) ||
          calendar.agentAccess !== "write" || this.agentCalendarOwnerId() !== ownerId) {
        return { ok: false as const, code: "calendar_unavailable" as const };
      }
      await this.createNativeCalendarEvent({
        id: input.eventId,
        revisionId: input.revisionId,
        calendarId: input.calendarId,
        lineage: input.recurrence ? { kind: "recurrence_master" } : { kind: "standalone" },
        title: input.title,
        description: input.description,
        location: input.location,
        status: input.status,
        span: input.span,
        recurrence: input.recurrence,
        subjectLinks: input.subjectLinks ? [...input.subjectLinks] : []
      }, signal, "agent");
      const detail = this.snapshot.calendarWorkspace.selectedEvent;
      if (this.agentCalendarOwnerId() !== ownerId || !detail || detail.event.id !== input.eventId ||
          detail.currentRevision.id !== input.revisionId) return { ok: false as const, code: "effect_not_applied" as const };
      return { ok: true as const, detail: agentCalendarEventDetail(detail, calendar) };
    } catch (error) {
      return calendarAgentWriteFailure(error, signal, "calendar_unavailable");
    }
  }

  async agentUpdateCalendarEvent(input: AgentUpdateCalendarEventInput, signal?: AbortSignal) {
    const inspected = await this.agentInspectCalendarEvent({ eventId: input.eventId }, signal);
    if (!inspected.ok) return inspected;
    if (inspected.detail.calendar.agentAccess !== "write") return { ok: false as const, code: "calendar_event_unavailable" as const };
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
    // A committed request may have lost its response. Only its exact revision ID is eligible for store-validated replay.
    if (inspected.detail.currentRevision.id !== input.expectedCurrentRevisionId &&
        inspected.detail.currentRevision.id !== input.revisionId) {
      return { ok: false as const, code: "stale_calendar_event" as const };
    }
    if (!sameCalendarEditTarget(input.target, inspected.detail.event)) {
      return { ok: false as const, code: "unsupported_calendar_authority" as const };
    }
    const current = inspected.detail.currentRevision;
    try {
      await this.updateNativeCalendarEvent(input.eventId, {
        revisionId: input.revisionId,
        expectedCurrentRevisionId: input.expectedCurrentRevisionId,
        target: input.target,
        title: input.patch.title ?? current.title,
        description: input.patch.description ?? current.description,
        location: input.patch.location ?? current.location,
        status: input.patch.status ?? current.status,
        // Stored zoned spans include derived instants; commands carry only the authoritative local time and zone.
        span: input.patch.span ?? (current.span.kind === "all_day" ? {
          kind: "all_day", startDate: current.span.startDate, endDateExclusive: current.span.endDateExclusive
        } : {
          kind: "zoned", startLocalDateTime: current.span.startLocalDateTime,
          endLocalDateTime: current.span.endLocalDateTime, timeZone: current.span.timeZone
        }),
        recurrence: input.patch.recurrence === undefined ? current.recurrence : input.patch.recurrence,
        subjectLinks: input.patch.subjectLinks ? [...input.patch.subjectLinks] : current.subjectLinks
      }, signal, "agent");
      const detail = this.snapshot.calendarWorkspace.selectedEvent;
      if (this.agentCalendarOwnerId() !== ownerId || !detail || detail.event.id !== input.eventId ||
          detail.currentRevision.id !== input.revisionId) return { ok: false as const, code: "effect_not_applied" as const };
      const calendar = this.snapshot.calendarWorkspace.calendars.find((item) => item.id === detail.event.calendarId);
      if (!calendar) return { ok: false as const, code: "calendar_event_unavailable" as const };
      return { ok: true as const, detail: agentCalendarEventDetail(detail, calendar) };
    } catch (error) {
      return calendarAgentWriteFailure(error, signal, "calendar_event_unavailable");
    }
  }

  async agentPrepareCalendarEventDeletion(input: AgentPrepareCalendarEventDeletionInput, signal?: AbortSignal) {
    const inspected = await this.agentInspectCalendarEvent({ eventId: input.eventId }, signal);
    if (!inspected.ok) return inspected;
    if (inspected.detail.calendar.agentAccess !== "write") return { ok: false as const, code: "calendar_event_unavailable" as const };
    if (inspected.detail.currentRevision.id !== input.expectedCurrentRevisionId) {
      return { ok: false as const, code: "stale_calendar_event" as const };
    }
    if (!sameCalendarEditTarget(input.target, inspected.detail.event)) {
      return { ok: false as const, code: "unsupported_calendar_authority" as const };
    }
    const preview: AgentCalendarDeletionPreview = {
      id: `calendar-delete-preview-${this.commandId()}`,
      event: inspected.detail,
      target: input.target,
      knownEffects: calendarDeletionEffects(inspected.detail, input.target)
    };
    if (this.agentCalendarDeletionPreviews.size >= 5) {
      this.agentCalendarDeletionPreviews.delete(this.agentCalendarDeletionPreviews.keys().next().value!);
    }
    this.agentCalendarDeletionPreviews.set(preview.id, {
      preview,
      authorized: false,
      tombstoneId: `calendar-event-tombstone-${this.commandId()}`,
      result: null
    });
    return { ok: true as const, preview };
  }

  confirmAgentCalendarDeletion(confirmed: boolean) {
    const settle = this.settleAgentCalendarDeletion;
    this.settleAgentCalendarDeletion = null;
    if (this.snapshot.agentCalendarDeletionConfirmation) this.update({ agentCalendarDeletionConfirmation: null });
    settle?.(confirmed);
  }

  async agentApplyCalendarEventDeletion(previewId: string, signal?: AbortSignal) {
    if (this.agentCalendarDeletionApplication) return { ok: false as const, code: "confirmation_required" as const };
    const entry = this.agentCalendarDeletionPreviews.get(previewId);
    if (!entry) return { ok: false as const, code: "confirmation_required" as const };
    const ownerId = this.agentCalendarOwnerId();
    if (!ownerId || entry.preview.event.event.ownerId !== ownerId) {
      return { ok: false as const, code: "calendar_event_unavailable" as const };
    }
    const admission = {};
    this.agentCalendarDeletionApplication = admission;
    try {
      const calendar = (await this.api.getCalendar(entry.preview.event.event.calendarId, signal, "agent")).calendar;
      if (!agentCanReadCalendar(calendar, ownerId) || calendar.agentAccess !== "write" ||
          this.agentCalendarOwnerId() !== ownerId) return { ok: false as const, code: "calendar_event_unavailable" as const };
      if (entry.result) return { ok: true as const, result: entry.result };
      if (!entry.authorized) {
        const accepted = await new Promise<boolean>((resolve) => {
          const abort = () => this.confirmAgentCalendarDeletion(false);
          this.settleAgentCalendarDeletion = (confirmed) => {
            signal?.removeEventListener("abort", abort);
            resolve(confirmed);
          };
          signal?.addEventListener("abort", abort, { once: true });
          this.update({ agentCalendarDeletionConfirmation: entry.preview });
          if (signal?.aborted) abort();
        });
        if (!accepted) return { ok: false as const, code: "confirmation_cancelled" as const };
        entry.authorized = true;
      }
      signal?.throwIfAborted();
      if (this.agentCalendarDeletionApplication !== admission || this.agentCalendarOwnerId() !== ownerId) {
        return { ok: false as const, code: "cancelled" as const };
      }
      const current = await this.api.getCalendarEvent(entry.preview.event.event.id, signal, "agent");
      signal?.throwIfAborted();
      if (current.calendarEvent.event.id !== entry.preview.event.event.id ||
          current.calendarEvent.event.calendarId !== entry.preview.event.event.calendarId ||
          current.calendarEvent.currentRevision.id !== entry.preview.event.currentRevision.id ||
          current.calendarEvent.event.ownerId !== ownerId) {
        entry.authorized = false;
        return { ok: false as const, code: "stale_calendar_event" as const };
      }
      if (current.calendarEvent.event.deletedAt !== null && (!current.latestTombstone ||
          current.latestTombstone.id !== entry.tombstoneId || current.latestTombstone.ownerId !== ownerId ||
          current.latestTombstone.eventId !== current.calendarEvent.event.id ||
          current.latestTombstone.calendarId !== current.calendarEvent.event.calendarId ||
          current.latestTombstone.lastRevisionId !== current.calendarEvent.currentRevision.id ||
          current.latestTombstone.deletedAt !== current.calendarEvent.event.deletedAt)) {
        entry.authorized = false;
        return { ok: false as const, code: "stale_calendar_event" as const };
      }
      const response = await this.api.deleteCalendarEvent(entry.preview.event.event.id, {
        expectedCurrentRevisionId: entry.preview.event.currentRevision.id,
        tombstoneId: entry.tombstoneId,
        target: entry.preview.target
      }, signal, "agent");
      signal?.throwIfAborted();
      if (this.agentCalendarOwnerId() !== ownerId || !response.latestTombstone ||
          response.latestTombstone.id !== entry.tombstoneId || response.latestTombstone.ownerId !== ownerId ||
          response.latestTombstone.eventId !== entry.preview.event.event.id ||
          response.latestTombstone.calendarId !== entry.preview.event.event.calendarId ||
          response.latestTombstone.lastRevisionId !== entry.preview.event.currentRevision.id ||
          response.calendarEvent.event.id !== entry.preview.event.event.id ||
          response.calendarEvent.event.ownerId !== ownerId ||
          response.calendarEvent.event.calendarId !== entry.preview.event.event.calendarId ||
          response.calendarEvent.event.deletedAt !== response.latestTombstone.deletedAt ||
          response.calendarEvent.currentRevision.id !== entry.preview.event.currentRevision.id) {
        return { ok: false as const, code: "effect_not_applied" as const };
      }
      this.updateCalendarWorkspace((workspace) => ({
        events: mergeCalendarEvents(workspace.events, [response.calendarEvent]),
        selectedEvent: response.calendarEvent,
        selectedProviderEvent: null,
        latestTombstone: response.latestTombstone,
        error: ""
      }));
      this.update({ detailsOpen: true });
      entry.result = {
        eventId: response.calendarEvent.event.id,
        calendarId: response.calendarEvent.event.calendarId,
        deleted: true,
        tombstoneId: response.latestTombstone.id
      };
      return { ok: true as const, result: entry.result };
    } catch (error) {
      const failure = calendarAgentWriteFailure(error, signal, "calendar_event_unavailable");
      if (failure.code === "stale_calendar_event" || failure.code === "unsupported_calendar_authority") {
        entry.authorized = false;
      }
      return failure;
    } finally {
      if (this.agentCalendarDeletionApplication === admission) this.agentCalendarDeletionApplication = null;
    }
  }

  async getChangeHistory(): Promise<ChangeHistory> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId) return { limit: 5, entries: [] };
    const ownerRevision = this.ownerRevision;
    const revision = ++this.historyRevision;
    const current = () => ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id && revision === this.historyRevision;
    try {
      const history = await this.api.getChangeHistory();
      if (current()) this.update({ changeHistory: history });
      return history;
    } catch (error) {
      // A superseded request must not clear a newer owner's or newer request's history.
      if (current()) this.update({ changeHistory: { limit: 5, entries: [] } });
      throw error;
    }
  }

  async previewLifeLinkChange(input: PreviewLifeLinkChangeInput, signal?: AbortSignal): Promise<LifeLinkChangePreview> {
    if (!this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.routeQrId) throw new Error("Open your private workspace to edit Life Links.");
    return this.api.previewLifeLinkChange(input, signal);
  }

  async applyLifeLinkChange(previewId: string, signal?: AbortSignal): Promise<LifeLinkChangeResult> {
    return this.commitOwnerChange(`preview:${previewId}`, (commandId) => this.api.applyLifeLinkChange(previewId, commandId, signal));
  }

  async previewCollectionChange(input: CollectionChangeInput, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<CollectionChangePreview> {
    if (!this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.routeQrId) throw new Error("Open your private workspace to edit Collections.");
    return this.api.previewCollectionChange(input, signal, actor);
  }

  async applyCollectionChange(previewId: string, signal?: AbortSignal, actor: CalendarActor = "human"): Promise<CollectionChangeResult> {
    return this.commitOwnerChange(`collection-preview:${previewId}`, (commandId) => this.api.applyCollectionChange(previewId, commandId, signal, actor));
  }

  async loadCollectionMoveTarget(collectionId: string, signal?: AbortSignal) {
    return this.readCollectionSections(collectionId, signal);
  }

  private assertWorkspaceAgentActive(ownerId = this.currentAgentOwnerId(), epoch = this.workspaceAgentEpoch) {
    if (!ownerId || this.currentAgentOwnerId() !== ownerId || epoch !== this.workspaceAgentEpoch ||
        !this.snapshot.agentConnection.connected || ![LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID, LIFE_LINKS_SEARCH_TOOL_CATALOG_ID].includes(this.snapshot.agentConnection.toolCatalogId as typeof LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID | typeof LIFE_LINKS_SEARCH_TOOL_CATALOG_ID)) {
      throw new AgentCommandError("life_link_unavailable");
    }
    if (this.snapshot.canonicalEditingId !== null) throw new AgentCommandError("editor_open");
  }

  private workspaceAgentFailure(issue: unknown, signal?: AbortSignal): WorkspaceAgentFailure {
    if (signal?.aborted || isAbortError(issue)) return { ok: false, code: "cancelled" };
    if (issue instanceof AgentCommandError) return { ok: false, code: issue.code };
    if (issue instanceof ApiError) return { ok: false, code: issue.code || "effect_not_confirmed" };
    return { ok: false, code: "effect_not_confirmed" };
  }

  private async verifyWorkspaceAgentGrant(ownerId: string, epoch: number, signal?: AbortSignal) {
    const current = await this.api.getMe();
    signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
    if (current.user?.id !== ownerId) {
      this.invalidateWorkspaceAgentChanges(); this.update({ agentWorkspaceChangeConfirmation: null });
      throw new AgentCommandError("life_link_unavailable");
    }
    this.update({ agentConnection: current.agentConnection });
    this.assertWorkspaceAgentActive(ownerId, epoch);
  }

  async agentCheckWorkspaceAccess(signal?: AbortSignal): Promise<{ ok: true } | WorkspaceAgentFailure> {
    const ownerId = this.currentAgentOwnerId(); const epoch = this.workspaceAgentEpoch;
    try {
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      await this.verifyWorkspaceAgentGrant(ownerId!, epoch, signal);
      return { ok: true };
    } catch (issue) { return this.workspaceAgentFailure(issue, signal); }
  }

  async agentListRoutines(input: { cursor?: string; limit?: number; includeArchived?: boolean }, signal?: AbortSignal): Promise<{
    ok: true; routines: RoutineSummaryRecord[]; nextCursor: string | null;
  } | WorkspaceAgentFailure> {
    const ownerId = this.currentAgentOwnerId(); const epoch = this.workspaceAgentEpoch;
    try {
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      const result = await this.api.listRoutines({ ...input, limit: input.limit ?? 25, signal, actor: "agent" });
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      return { ok: true, routines: result.routines, nextCursor: result.nextCursor };
    } catch (issue) { return this.workspaceAgentFailure(issue, signal); }
  }

  private rememberWorkspaceAgentChange(value: { kind: "collection"; preview: CollectionChangePreview } | { kind: "routines"; preview: RoutineDeletionPreview }) {
    // Keep controller previews and tool delivery receipts aligned while one
    // visible confirmation/application is outstanding; do not evict its handle.
    if (this.snapshot.agentWorkspaceChangeConfirmation || [...this.workspaceAgentChanges.values()].some((entry) => entry.abort)) {
      throw new AgentCommandError("invalid_operation");
    }
    if (this.workspaceAgentChanges.size >= 5) {
      const disposable = [...this.workspaceAgentChanges].find(([, entry]) => !entry.abort &&
        this.snapshot.agentWorkspaceChangeConfirmation?.preview.id !== entry.preview.id);
      if (!disposable) throw new AgentCommandError("invalid_operation");
      this.workspaceAgentChanges.delete(disposable[0]);
    }
    this.workspaceAgentChanges.set(value.preview.id, {
      ...value, ownerId: this.currentAgentOwnerId()!, ownerRevision: this.ownerRevision, epoch: this.workspaceAgentEpoch,
      offered: false, status: { previewId: value.preview.id, state: "awaiting_confirmation" }, abort: null
    });
  }

  async agentPreviewCollectionChange(input: CollectionChangeInput, signal?: AbortSignal): Promise<{ ok: true; preview: CollectionChangePreview } | WorkspaceAgentFailure> {
    const ownerId = this.currentAgentOwnerId(); const epoch = this.workspaceAgentEpoch;
    try {
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      const preview = await this.previewCollectionChange(normalizeCollectionChangeInput(input), signal, "agent");
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      this.rememberWorkspaceAgentChange({ kind: "collection", preview });
      return { ok: true, preview };
    } catch (issue) { return this.workspaceAgentFailure(issue, signal); }
  }

  async agentPreviewRoutineDeletion(input: { routines: Array<{ id: string; expectedUpdatedAt: string }> }, signal?: AbortSignal): Promise<{ ok: true; preview: RoutineDeletionPreview } | WorkspaceAgentFailure> {
    const ownerId = this.currentAgentOwnerId(); const epoch = this.workspaceAgentEpoch;
    try {
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
      if (!input.routines.length || input.routines.length > MAX_CHANGE_SELECTION ||
          new Set(input.routines.map((item) => item.id)).size !== input.routines.length) throw new AgentCommandError("invalid_operation");
      const targets: RoutineDeletionTarget[] = [];
      for (const reference of input.routines) {
        const { routine } = await this.api.getRoutine(reference.id, signal, "agent");
        signal?.throwIfAborted(); this.assertWorkspaceAgentActive(ownerId, epoch);
        if (routine.routine.ownerId !== ownerId || routine.routine.archivedAt) return { ok: false, code: "routine_unavailable" };
        if (routine.routine.updatedAt !== reference.expectedUpdatedAt) return { ok: false, code: "stale_routine" };
        targets.push({ ...reference, title: routine.currentRevision.revision.title });
      }
      const preview = this.prepareRoutineDeletion(targets);
      this.rememberWorkspaceAgentChange({ kind: "routines", preview });
      return { ok: true, preview };
    } catch (issue) { return this.workspaceAgentFailure(issue, signal); }
  }

  async agentApplyCollectionChange(previewId: string, signal?: AbortSignal) {
    return this.offerWorkspaceAgentChange(previewId, "collection", signal);
  }

  async agentApplyRoutineDeletion(previewId: string, signal?: AbortSignal) {
    return this.offerWorkspaceAgentChange(previewId, "routines", signal);
  }

  private async offerWorkspaceAgentChange(previewId: string, kind: WorkspaceAgentChangeEntry["kind"], signal?: AbortSignal): Promise<{ ok: true; status: WorkspaceChangeStatus } | WorkspaceAgentFailure> {
    try {
      signal?.throwIfAborted(); this.assertWorkspaceAgentActive();
      const entry = this.workspaceAgentChanges.get(previewId);
      if (!entry || entry.kind !== kind) return { ok: false, code: "preview_unavailable" };
      this.assertWorkspaceAgentEntry(entry);
      // Even cached completion readback must honor a grant revoked in another page.
      await this.verifyWorkspaceAgentGrant(entry.ownerId, entry.epoch, signal);
      this.assertWorkspaceAgentEntry(entry);
      if (!entry.offered) {
        if (this.snapshot.agentChangeConfirmation || this.snapshot.agentCalendarDeletionConfirmation || this.snapshot.agentWorkspaceChangeConfirmation ||
            [...this.workspaceAgentChanges.values()].some((item) => item.abort)) return { ok: false, code: "confirmation_required" };
        entry.offered = true;
        if (entry.kind === "collection" && entry.preview.input.operation === "move") {
          void this.executeWorkspaceAgentChange(entry);
        } else {
          this.update({ agentWorkspaceChangeConfirmation: { kind: entry.kind, preview: entry.preview, saving: false, error: "", removedIds: [] } as LifeLinksWorkspaceSnapshot["agentWorkspaceChangeConfirmation"] });
        }
      } else if (entry.kind === "collection" && entry.preview.input.operation === "move" && entry.status.state === "failed" && entry.status.code === "effect_not_confirmed") {
        void this.executeWorkspaceAgentChange(entry);
      }
      return { ok: true, status: structuredClone(entry.status) };
    } catch (issue) { return this.workspaceAgentFailure(issue, signal); }
  }

  private assertWorkspaceAgentEntry(entry: WorkspaceAgentChangeEntry) {
    this.assertWorkspaceAgentActive(entry.ownerId, entry.epoch);
    if (entry.ownerRevision !== this.ownerRevision || this.workspaceAgentChanges.get(entry.preview.id) !== entry) throw new AgentCommandError("life_link_unavailable");
  }

  /** App-observed confirmation, never an argument accepted from an agent tool. */
  async confirmAgentWorkspaceChange(confirmed: boolean): Promise<void> {
    const current = this.snapshot.agentWorkspaceChangeConfirmation;
    if (!current) return;
    const entry = this.workspaceAgentChanges.get(current.preview.id);
    if (!entry) { this.update({ agentWorkspaceChangeConfirmation: null }); return; }
    if (!confirmed) {
      entry.abort?.abort();
      entry.status = { ...entry.status, state: "cancelled", code: entry.abort ? "effect_not_confirmed" : "cancelled" };
      this.update({ agentWorkspaceChangeConfirmation: null });
      return;
    }
    if (entry.abort) return;
    await this.executeWorkspaceAgentChange(entry);
  }

  private async executeWorkspaceAgentChange(entry: WorkspaceAgentChangeEntry): Promise<void> {
    if (entry.abort) return;
    const request = new AbortController(); entry.abort = request;
    entry.status = { ...entry.status, state: "applying", code: undefined };
    const updateDialog = (saving: boolean, error = "", removedIds = entry.status.removal?.removedIds ?? []) => {
      const dialog = this.snapshot.agentWorkspaceChangeConfirmation;
      if (dialog?.preview.id === entry.preview.id) this.update({ agentWorkspaceChangeConfirmation: { ...dialog, saving, error, removedIds } });
    };
    updateDialog(true);
    try {
      this.assertWorkspaceAgentEntry(entry);
      await this.verifyWorkspaceAgentGrant(entry.ownerId, entry.epoch, request.signal);
      this.assertWorkspaceAgentEntry(entry);
      if (entry.kind === "collection") {
        const change = await this.applyCollectionChange(entry.preview.id, request.signal, "agent");
        this.assertWorkspaceAgentEntry(entry);
        entry.status = { previewId: entry.preview.id, state: "applied", change };
      } else {
        const removal = await this.applyRoutineDeletion(entry.preview, entry.status.removal?.removedIds ?? [], request.signal, "agent", () => this.assertWorkspaceAgentEntry(entry));
        this.assertWorkspaceAgentEntry(entry);
        entry.status = { previewId: entry.preview.id, state: removal.remainingIds.length ? "partial" : "applied", removal };
        if (removal.remainingIds.length) { updateDialog(false, removal.error ?? "Some removals could not be confirmed.", removal.removedIds); return; }
      }
      if (this.snapshot.agentWorkspaceChangeConfirmation?.preview.id === entry.preview.id) this.update({ agentWorkspaceChangeConfirmation: null });
    } catch (issue) {
      const failure = this.workspaceAgentFailure(issue, request.signal);
      entry.status = { ...entry.status, state: request.signal.aborted ? "cancelled" : "failed", code: failure.code };
      updateDialog(false, "The change could not be confirmed. Retry checks the same change; it does not create a new request.");
    } finally { entry.abort = null; }
  }

  private invalidateWorkspaceAgentChanges() {
    ++this.workspaceAgentEpoch;
    for (const entry of this.workspaceAgentChanges.values()) entry.abort?.abort();
    this.workspaceAgentChanges.clear();
  }

  async undoLastChange(): Promise<LifeLinkChangeResult> {
    const entry = this.snapshot.changeHistory.entries[0];
    if (!entry) throw new Error("There are no saved changes to undo.");
    return this.commitOwnerChange(`undo:${entry.id}`, (commandId) => this.api.undoChange(entry.id, commandId));
  }

  private async commitOwnerChange<T extends LifeLinkChangeResult | CollectionChangeResult>(key: string, commit: (commandId: string) => Promise<T>): Promise<T> {
    const ownerId = this.snapshot.currentUser?.id;
    const continuation = { owner: this.ownerRevision, navigation: this.navigationRevision };
    const sameOwner = () => continuation.owner === this.ownerRevision && this.snapshot.currentUser?.id === ownerId;
    const current = () => sameOwner() && continuation.navigation === this.navigationRevision;
    if (!ownerId || this.snapshot.guestView || this.snapshot.routeQrId) throw new Error("Open your private workspace to edit Life Links.");
    if (this.snapshot.canonicalEditingId) throw new Error("Close the record editor before moving, deleting or undoing changes.");
    const commandId = this.pendingChangeCommands.get(key) ?? `change-${this.commandId()}`;
    this.pendingChangeCommands.set(key, commandId);
    this.update({ busy: true, error: "" });
    try {
      const result = await commit(commandId);
      if (!sameOwner()) return result;
      ++this.historyRevision;
      this.update({ changeHistory: result.history });
      // The mutation is committed even if its readback fails. Keep its command
      // identity for safe retry, and never report a successful write as undone.
      try { if (current()) await this.reconcileOwnerChange(result, continuation); }
      catch (error) { if (current()) this.update({ error: `Change saved. Refresh the workspace to load the updated view: ${messageFromError(error)}` }); }
      return result;
    } catch (error) {
      if (current()) this.update({ error: messageFromError(error) });
      throw error;
    } finally {
      if (sameOwner()) this.update({ busy: false });
    }
  }

  private async reconcileOwnerChange(result: LifeLinkChangeResult | CollectionChangeResult, continuation: { owner: number; navigation: number }) {
    const current = () => continuation.owner === this.ownerRevision && continuation.navigation === this.navigationRevision;
    // These existing route methods synchronously claim a navigation revision.
    const restore = (action: Promise<void>) => { continuation.navigation = this.navigationRevision; return action; };
    const removed = new Set(result.operation === "delete" && "affectedIds" in result ? result.affectedIds : []);
    const selectedId = this.snapshot.selectedLifeLinkId;
    const parentId = this.snapshot.hierarchyParentId;
    const collectionId = this.snapshot.selectedCollection?.id;
    const routineId = this.snapshot.routineWorkspace.selectedRoutine?.routine.id;
    const routineSessionId = this.snapshot.presentation.routineDetails.kind === "session" ? this.snapshot.routineWorkspace.selectedSession?.session.id : undefined;
    const calendarEventId = this.snapshot.calendarWorkspace.selectedEvent?.event.id;
    const mode = this.snapshot.workspaceMode;
    const detailsOpen = this.snapshot.detailsOpen;
    this.update({ lifeLinkChildren: {}, lifeLinkMemberships: {}, lifeLinkMembershipsComplete: {},
      lifeLinkSearchResults: [], lifeLinkSearchTotalCount: 0, lifeLinkSearchNextCursor: null,
      selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [], collectionMemberDetails: {},
      collectionMemberMemberships: {}, collectionsComplete: false, collectionComplete: false });
    await this.refreshOwnerLibrary();
    if (!current()) return;
    if (mode === "calendar") {
      if (calendarEventId) await restore(this.openCalendarEvent(calendarEventId, false));
      else await restore(this.openCalendar(false));
    } else if (mode === "routines") {
      if (routineId) await restore(this.openRoutine(routineId, false));
      else await restore(this.openRoutines(false));
      if (current() && routineSessionId) await this.selectRoutineSession(routineSessionId);
    } else if (mode === "collections") {
      await this.loadCollections();
      if (!current()) return;
      if (collectionId && this.snapshot.collections.some((collection) => collection.id === collectionId)) {
        await restore(this.openCollection(collectionId, undefined, false));
        if (current() && selectedId && !removed.has(selectedId) && this.snapshot.collectionMembers.some((member) => member.id === selectedId)) {
          await this.selectCollectionMember(selectedId, false);
        }
      } else await restore(this.openCollections(false));
    } else if (selectedId && !removed.has(selectedId)) {
      try {
        await this.api.getLifeLinkDetail(selectedId, { limit: 1 });
        if (!current()) return;
        await restore(this.selectLifeLink({ lifeLinkId: selectedId, source: "route" }, false));
      } catch (error) {
        if (!current()) return;
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        await restore(this.openHierarchy(null));
      }
    } else {
      const nextParent = parentId && !removed.has(parentId) ? parentId : null;
      await restore(this.openHierarchy(nextParent));
    }
    if (!current()) return;
    if (!removed.has(selectedId ?? "")) this.update({ detailsOpen });
    if (this.snapshot.lifeLinkSearchQuery.trim()) await this.searchLifeLinks(this.snapshot.lifeLinkSearchQuery);
    if (!current()) return;
    if (this.snapshot.activeQrId) await this.refreshActiveQr();
  }

  confirmAgentChange(confirmed: boolean) {
    const settle = this.settleAgentChange;
    this.settleAgentChange = null;
    if (this.snapshot?.agentChangeConfirmation) this.update({ agentChangeConfirmation: null });
    settle?.(confirmed);
  }

  async agentPreviewLifeLinkChange(input: PreviewLifeLinkChangeInput, signal?: AbortSignal) {
    let preview: LifeLinkChangePreview | null = null;
    const result = await this.runAgentCommand(async (options) => {
      for (const id of input.lifeLinkIds) await this.agentMutableRecord(id, options);
      preview = await this.previewLifeLinkChange(input, signal);
      this.assertCommandActive(options);
      if (this.agentChangePreviews.size >= 5) this.agentChangePreviews.delete(this.agentChangePreviews.keys().next().value!);
      this.agentChangePreviews.set(preview.id, { preview, authorized: false });
    }, signal);
    return result.ok && preview ? { ok: true as const, preview: preview as LifeLinkChangePreview } : result;
  }

  async agentApplyLifeLinkChange(previewId: string, signal?: AbortSignal): Promise<Exclude<AgentToolControllerActionResult, { ok: true }> | { ok: true; change: LifeLinkChangeResult }> {
    if (this.agentChangeApplication) return { ok: false, code: "invalid_operation" };
    const admission = {};
    this.agentChangeApplication = admission;
    let change: LifeLinkChangeResult | null = null;
    try {
      const action = await this.runAgentCommand(async (options) => {
        const assertOwner = options.assertActive;
        options.assertActive = () => {
          assertOwner?.();
          if (this.agentChangeApplication !== admission) throw new AgentCommandError("cancelled");
        };
        const entry = this.agentChangePreviews.get(previewId);
        if (!entry) throw new AgentCommandError("invalid_operation");
        const { preview } = entry;
        if (!entry.authorized) {
          // First apply validates every draft and obtains the sole human delete choice.
          for (const item of preview.items) await this.agentMutableRecord(item.id, options);
          if (preview.operation === "delete") {
            const accepted = await new Promise<boolean>((resolve) => {
              const abort = () => this.confirmAgentChange(false);
              this.settleAgentChange = (confirmed) => { signal?.removeEventListener("abort", abort); resolve(confirmed); };
              signal?.addEventListener("abort", abort, { once: true });
              this.update({ agentChangeConfirmation: preview });
              if (signal?.aborted) abort();
            });
            if (!accepted) throw new AgentCommandError("cancelled");
          }
          this.assertCommandActive(options);
          entry.authorized = true;
        }
        this.assertCommandActive(options);
        try {
          // An uncertain delete may already have removed every item. Replay the exact
          // authorized preview/command at the store; do not require those items to exist.
          change = await this.applyLifeLinkChange(previewId, signal);
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) entry.authorized = false;
          throw error;
        }
      }, signal);
      if (!action.ok) return action;
      return change ? { ok: true, change } : { ok: false, code: "effect_not_applied" };
    } finally {
      if (this.agentChangeApplication === admission) this.agentChangeApplication = null;
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start() {
    if (this.active) {
      return;
    }
    this.active = true;
    const lifecycle = ++this.lifecycle;
    this.unsubscribeRoute = this.route.subscribe(() => {
      void this.handlePopState();
    });
    await this.boot(lifecycle);
  }

  dispose() {
    this.cancelHierarchyExpansion();
    this.cancelRecordSearch();
    this.invalidateWorkspaceAgentChanges();
    this.update({ agentWorkspaceChangeConfirmation: null });
    this.confirmAgentChange(false);
    this.confirmAgentCalendarDeletion(false);
    this.agentChangeApplication = null;
    this.agentCalendarDeletionApplication = null;
    this.agentChangePreviews.clear();
    this.agentCalendarDeletionPreviews.clear();
    this.agentProviderCalendarDeletionPreviews.clear();
    this.active = false;
    this.lifecycle += 1;
    this.ownerRevision += 1;
    this.navigationRevision += 1;
    this.unsubscribeRoute?.();
    this.unsubscribeRoute = null;
  }

  setActiveView(view: WorkspaceView) {
    ++this.navigationRevision;
    const panelState = view === "workspace" ? {} : { detailsOpen: false };
    if (view !== "workspace" && this.snapshot.routeLifeLinkId) {
      this.route.push("/");
      this.update({ ...panelState, routePathname: "/", routeQrId: null, routeLifeLinkId: null, activeView: view });
      return;
    }
    this.update({ ...panelState, activeView: view });
  }

  setBatchCount(value: string | number) {
    this.update({ batchCount: normalizeBatchCount(value) });
  }

  toggleInventory() {
    this.update((current) => ({ inventoryOpen: !current.inventoryOpen }));
  }

  setInventoryFilter(filter: InventoryFilter) {
    this.update({ inventoryFilter: filter, inventoryPage: 0 });
  }

  setInventoryPage(page: number) {
    this.update({ inventoryPage: Math.max(0, page) });
  }

  setQuery(query: string) {
    this.update({ query });
  }

  setLifeLinkSearchQuery(lifeLinkSearchQuery: string) {
    this.update({ lifeLinkSearchQuery });
  }

  selectFindTarget(qrId: string) {
    this.update({ findTargetId: qrId, activeQrId: qrId });
  }

  toggleGuestView() {
    this.update((current) => ({
      guestView: !current.guestView,
      ...(!current.guestView ? { canonicalEditingId: null } : {})
    }));
  }

  setTheme(theme: ThemeMode) {
    this.update({ theme });
  }

  openEditor(qrId: string) {
    this.update({ editingId: qrId });
  }

  closeEditor() {
    this.update({ editingId: null });
  }

  async openCanonicalEditor(lifeLinkId: string) {
    if (this.snapshot.selectedLifeLinkId !== lifeLinkId || !this.snapshot.selectedLifeLinkDetail) {
      await this.selectLifeLink({ lifeLinkId, source: "human" });
    }
    if (this.snapshot.selectedLifeLinkId !== lifeLinkId || !this.snapshot.selectedLifeLinkDetail) return;
    this.update({ canonicalEditingId: lifeLinkId });
  }

  closeCanonicalEditor() {
    this.update({ canonicalEditingId: null });
  }

  setDetailsOpen(detailsOpen: boolean) {
    this.update({ detailsOpen });
  }

  setMiddleCollapsed(middleCollapsed: boolean) {
    this.update({ middleCollapsed, ...(middleCollapsed ? { detailsOpen: true } : {}) });
  }

  setWorkspaceScroll(panel: "middle" | "details", scrollTop: number, pathname = this.snapshot.routePathname) {
    if (!this.snapshot.currentUser || this.snapshot.routeQrId || this.snapshot.activeView !== "workspace") return;
    if (pathname !== this.snapshot.routePathname || (this.pendingWorkspaceResume?.peer === this.snapshot.workspaceMode &&
        this.pendingWorkspaceResume.pathname === workspaceBookmarkPath(this.snapshot.workspaceMode, pathname))) return;
    const peer = this.snapshot.workspaceMode;
    const key = panel === "middle" ? "middleScrollTop" : "detailsScrollTop";
    const value = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
    if (this.snapshot.presentation.peers[peer][key] === value) return;
    this.update({ presentation: { ...this.snapshot.presentation, peers: {
      ...this.snapshot.presentation.peers,
      [peer]: { ...this.snapshot.presentation.peers[peer], [key]: value }
    } } });
  }

  setCollectionPresentation(collectionId: string, patch: Partial<CollectionPresentation>) {
    if (!this.snapshot.currentUser || this.snapshot.routeQrId) return;
    this.update({ presentation: { ...this.snapshot.presentation, collections: {
      ...this.snapshot.presentation.collections,
      [collectionId]: { ...(this.snapshot.presentation.collections[collectionId] ?? { view: "sections", expandedGroups: [] }), ...patch }
    } } });
  }

  setCalendarPresentation(patch: Partial<CalendarPresentation>) {
    if (!this.snapshot.currentUser || this.snapshot.routeQrId) return;
    this.update({ presentation: { ...this.snapshot.presentation, calendar: { ...this.snapshot.presentation.calendar, ...patch } } });
  }

  setRoutineDetailPresentation(kind: "routine" | "session") {
    if (!this.snapshot.currentUser || this.snapshot.routeQrId) return;
    this.update({ presentation: { ...this.snapshot.presentation, routineDetails: {
      kind, sessionId: kind === "session" ? this.snapshot.routineWorkspace.selectedSession?.session.id ?? null : null
    } } });
  }

  /** Rail-only navigation. Root breadcrumbs and explicit routes retain their existing meaning. */
  async resumeWorkspace(peer: WorkspacePeer): Promise<void> {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId || this.snapshot.routeQrId) return;
    const ownerRevision = this.ownerRevision;
    const remembered = { ...this.snapshot.presentation.peers[peer] };
    const routineDetails = { ...this.snapshot.presentation.routineDetails };
    const pathname = remembered.pathname ?? workspaceRootPath(peer);
    const pending = { peer, pathname };
    this.pendingWorkspaceResume = pending;
    if (this.route.pathname() !== pathname) this.route.push(pathname);
    // Never show a previously selected private object as the requested hierarchy while it reloads.
    if (peer === "hierarchies") this.update({
      workspaceMode: peer, activeView: "workspace", routePathname: pathname, routeQrId: null,
      routeLifeLinkId: lifeLinkIdFromPath(pathname), hierarchyParentId: null, hierarchyParentDetail: null,
      selectedCollection: null, selectedLifeLinkId: null, selectedLifeLinkDetail: null,
      selectedLifeLinkMemberships: [], membershipsComplete: false, detailsOpen: false
    });
    const opening = this.restoreOwnerRoute(pathname);
    const navigation = this.navigationRevision;
    const current = () => ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id &&
      navigation === this.navigationRevision && this.snapshot.workspaceMode === peer && !this.snapshot.routeQrId;
    try { await opening; }
    catch (error) {
      if (this.pendingWorkspaceResume === pending) this.pendingWorkspaceResume = null;
      if (current()) this.update({ error: messageFromError(error) });
      return;
    }
    if (this.pendingWorkspaceResume === pending) this.pendingWorkspaceResume = null;
    if (!current()) return;
    if (peer === "routines" && routineDetails.kind === "session" && routineDetails.sessionId) {
      try { await this.selectRoutineSession(routineDetails.sessionId); }
      catch (error) { if (current()) this.updateRoutineWorkspace({ selectedSession: null, error: messageFromError(error) }); }
      if (!current()) return;
    }
    this.update({
      middleCollapsed: remembered.middleCollapsed,
      detailsOpen: remembered.detailsOpen,
      presentation: { ...this.snapshot.presentation,
        peers: { ...this.snapshot.presentation.peers, [peer]: { ...remembered, pathname } },
        restoreRevision: this.snapshot.presentation.restoreRevision + 1
      }
    });
  }

  async openHierarchy(parentId: string | null = null, updateHistory = true) {
    ++this.routineSelectionRevision;
    ++this.routineRunLookupRevision;
    ++this.routineSessionSelectionRevision;
    if (parentId) {
      await this.selectLifeLink({ lifeLinkId: parentId, source: "route" }, updateHistory);
      if (this.snapshot.selectedLifeLinkId === parentId && this.snapshot.selectedLifeLinkDetail?.lifeLink.browsingRole === "container") {
        this.update({ detailsOpen: false });
      }
      return;
    }
    ++this.navigationRevision;
    this.update({
      workspaceMode: "hierarchies", hierarchyParentId: null, hierarchyParentDetail: null,
      selectedCollection: null, selectedLifeLinkId: null, selectedLifeLinkDetail: null,
      selectedLifeLinkMemberships: [], membershipsComplete: true, membershipsLoading: false,
      detailsOpen: false, activeView: "workspace", routePathname: "/life-links", routeQrId: null,
      routeLifeLinkId: null, publicQrState: null, canonicalEditingId: null, error: ""
    });
    if (updateHistory && this.route.pathname() !== "/life-links") this.route.push("/life-links");
    await this.loadLifeLinkBranch(null, false);
  }

  async activateLifeLink(lifeLinkId: string) {
    await this.selectLifeLink({ lifeLinkId, source: "route" });
    if (this.snapshot.selectedLifeLinkId === lifeLinkId && this.snapshot.selectedLifeLinkDetail?.lifeLink.browsingRole === "container") this.setDetailsOpen(false);
  }

  async openCollections(updateHistory = true, options: WorkspaceCommandOptions = {}) {
    this.assertCommandActive(options);
    ++this.routineSelectionRevision;
    ++this.routineRunLookupRevision;
    ++this.routineSessionSelectionRevision;
    const navigation = ++this.navigationRevision;
    this.update({
      workspaceMode: "collections", selectedCollection: null, collectionMembers: [], collectionSections: [],
      collectionMemberDetails: {}, collectionMemberMemberships: {}, collectionComplete: false, collectionLoading: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsComplete: true, membershipsLoading: false, detailsOpen: false,
      activeView: "workspace", routePathname: "/collections", routeQrId: null, routeLifeLinkId: null,
      publicQrState: null, canonicalEditingId: null, error: ""
    });
    if (updateHistory && this.route.pathname() !== "/collections") this.route.push("/collections");
    try { await this.refreshCollections(navigation, options); }
    catch (error) {
      if (this.navigationRevision === navigation) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    }
  }

  async openRoutines(updateHistory = true) {
    ++this.navigationRevision;
    ++this.routineSelectionRevision;
    ++this.routineRunLookupRevision;
    ++this.routineSessionSelectionRevision;
    this.update({
      workspaceMode: "routines", selectedCollection: null, collectionMembers: [], collectionSections: [],
      collectionMemberDetails: {}, collectionMemberMemberships: {}, collectionComplete: false, collectionLoading: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsComplete: true, membershipsLoading: false, detailsOpen: false,
      activeView: "workspace", routePathname: "/routines", routeQrId: null, routeLifeLinkId: null,
      publicQrState: null, canonicalEditingId: null, error: ""
    });
    this.updateRoutineWorkspace({
      selectedRoutine: null, schedules: [], schedulesNextCursor: null, activeRun: null,
      occurrences: [], occurrencesNextCursor: null,
      sessions: [], sessionsNextCursor: null, selectedSession: null
    });
    if (updateHistory && this.route.pathname() !== "/routines") this.route.push("/routines");
    await this.loadRoutineWorkspace().catch((error) => {
      if (this.snapshot.workspaceMode === "routines" && this.snapshot.routePathname === "/routines") {
        this.updateRoutineWorkspace({ error: messageFromError(error), loading: false });
      }
    });
  }

  async openRoutine(routineId: string, updateHistory = true) {
    const navigation = ++this.navigationRevision;
    ++this.routineSelectionRevision;
    ++this.routineRunLookupRevision;
    ++this.routineSessionSelectionRevision;
    const pathname = ownerRoutinePath(routineId);
    this.update({
      workspaceMode: "routines", selectedCollection: null, collectionMembers: [], collectionSections: [],
      collectionMemberDetails: {}, collectionMemberMemberships: {}, collectionComplete: false, collectionLoading: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsComplete: true, membershipsLoading: false, detailsOpen: false,
      activeView: "workspace", routePathname: pathname, routeQrId: null, routeLifeLinkId: null,
      publicQrState: null, canonicalEditingId: null, error: ""
    });
    this.updateRoutineWorkspace({
      selectedRoutine: null, schedules: [], schedulesNextCursor: null,
      occurrences: [], occurrencesNextCursor: null, activeRun: null,
      sessions: [], sessionsNextCursor: null, selectedSession: null
    });
    if (updateHistory && this.route.pathname() !== pathname) this.route.push(pathname);
    try {
      await this.loadRoutineWorkspace();
      if (navigation !== this.navigationRevision) return;
      await this.selectRoutine(routineId);
      if (navigation === this.navigationRevision && this.snapshot.routineWorkspace.selectedRoutine?.routine.id === routineId) {
        this.update({ detailsOpen: true });
      }
    } catch (error) {
      if (navigation === this.navigationRevision) {
        this.updateRoutineWorkspace({ error: messageFromError(error), loading: false });
      }
    }
  }

  async loadCollections() {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    try { await this.refreshCollections(); }
    catch (error) { if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(error) }); }
  }

  async openCollection(collectionId: string, selectedLifeLinkId?: string, updateHistory = true, options: WorkspaceCommandOptions = {}) {
    this.assertCommandActive(options);
    const navigation = ++this.navigationRevision;
    const ownerRevision = this.ownerRevision;
    const pathname = ownerCollectionPath(collectionId, selectedLifeLinkId);
    this.update({
      workspaceMode: "collections", activeView: "workspace", routePathname: pathname, routeQrId: null,
      routeLifeLinkId: null, publicQrState: null, selectedCollection: null,
      collectionMembers: [], collectionSections: [], collectionMemberMemberships: {}, collectionMemberDetails: {},
      collectionLoading: true, collectionComplete: false, detailsOpen: false,
      selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
      membershipsLoading: false, membershipsComplete: false, canonicalEditingId: null, error: ""
    });
    if (updateHistory && this.route.pathname() !== pathname) this.route.push(pathname);
    try {
      const result = await this.readCollectionWorkspace(collectionId, options.signal);
      this.assertCommandActive(options);
      if (navigation !== this.navigationRevision || ownerRevision !== this.ownerRevision) return;
      this.update({
        selectedCollection: result.collection, collectionSections: result.sections,
        collectionMembers: result.members, collectionMemberDetails: result.details,
        collectionMemberMemberships: result.memberships, collectionComplete: true,
        collections: mergeById(this.snapshot.collections, [result.collection]),
        lifeLinkMemberships: { ...this.snapshot.lifeLinkMemberships, ...result.memberships },
        lifeLinkMembershipsComplete: { ...this.snapshot.lifeLinkMembershipsComplete,
          ...Object.fromEntries(result.members.map((item) => [item.id, true])) }
      });
      if (selectedLifeLinkId) await this.selectCollectionMember(selectedLifeLinkId, false, options);
    } catch (error) {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    } finally {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) this.update({ collectionLoading: false });
    }
  }

  async selectCollectionMember(lifeLinkId: string, updateHistory = true, options: WorkspaceCommandOptions = {}) {
    this.assertCommandActive(options);
    const collection = this.snapshot.selectedCollection;
    if (!collection || !this.snapshot.collectionMembers.some((member) => member.id === lifeLinkId)) {
      this.update({ error: "This Life Link is not a member of the current Collection." });
      return;
    }
    const navigation = this.navigationRevision;
    const selection = ++this.selectionRevision;
    const ownerRevision = this.ownerRevision;
    this.update({ busy: true, error: "" });
    try {
      const { detail } = await this.api.getLifeLinkDetail(lifeLinkId, { signal: options.signal });
      this.assertCommandActive(options);
      if (navigation !== this.navigationRevision || ownerRevision !== this.ownerRevision || selection !== this.selectionRevision) return;
      this.applySelectedLifeLinkDetail(detail, updateHistory, true);
      await this.loadSelectedMemberships(lifeLinkId);
      this.assertCommandActive(options);
    } catch (error) {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision && selection === this.selectionRevision) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    } finally {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision && selection === this.selectionRevision) this.update({ busy: false });
    }
  }

  async createCollection(input: CollectionCreateInput, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    const pendingKey = `collection:${JSON.stringify(input)}`;
    const id = input.id ?? this.pendingCreateId(pendingKey, "collection");
    this.update({ busy: true, error: "" });
    try {
      this.assertCommandActive(options);
      const { collection } = await this.api.createCollection({ ...input, id }, { signal: options.signal });
      this.assertCommandActive(options);
      if (ownerRevision === this.ownerRevision) this.pendingCreateIds.delete(pendingKey);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      await this.openCollection(collection.id, undefined, true, options);
    } catch (error) {
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    }
    finally { if (ownerRevision === this.ownerRevision) this.update({ busy: false }); }
  }

  async updateCollection(patch: CollectionPatch, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.updateCollection(collection.id, collection.updatedAt, patch, { signal: options.signal }), target, options);
  }

  async createCollectionSection(title: string, target?: CollectionRecord, stableId?: string, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    const pendingKey = `section:${target?.id ?? this.snapshot.selectedCollection?.id}:${title}`;
    const id = stableId ?? this.pendingCreateId(pendingKey, "section");
    await this.mutateCollection(async (collection) => {
      const result = await this.api.createCollectionSection(collection.id, collection.updatedAt, { id, title }, { signal: options.signal });
      if (ownerRevision === this.ownerRevision) this.pendingCreateIds.delete(pendingKey);
      return result;
    }, target, options);
  }

  async updateCollectionSection(sectionId: string, title: string, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.updateCollectionSection(collection.id, sectionId, collection.updatedAt, title, { signal: options.signal }), target, options);
  }

  async removeCollectionSection(sectionId: string, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.removeCollectionSection(collection.id, sectionId, collection.updatedAt, { signal: options.signal }), target, options);
  }

  async loadCollectionForAssignment(collectionId: string, lifeLinkId: string) {
    const ownerRevision = this.ownerRevision;
    const [target, memberships] = await Promise.all([this.readCollectionSections(collectionId), this.readMemberships(lifeLinkId)]);
    if (ownerRevision !== this.ownerRevision) throw new Error("The account changed while loading Collections.");
    return { ...target, membership: memberships.find((entry) => entry.collection.id === collectionId) ?? null };
  }

  async addCollectionMember(lifeLinkId: string, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.addCollectionMember(collection.id, lifeLinkId, collection.updatedAt, { signal: options.signal }), target, options);
  }

  async removeCollectionMember(lifeLinkId: string, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.removeCollectionMember(collection.id, lifeLinkId, collection.updatedAt, { signal: options.signal }), target, options);
  }

  async replaceCollectionSectionAssignments(lifeLinkId: string, sectionIds: string[], target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    await this.mutateCollection((collection) => this.api.replaceCollectionSectionAssignments(collection.id, lifeLinkId, collection.updatedAt, sectionIds, { signal: options.signal }), target, options);
  }

  async updateSelectedLifeLink(patch: UpdateLifeLinkPatch, expectedUpdatedAt?: string, options: WorkspaceCommandOptions = {}) {
    const lifeLink = this.snapshot.selectedLifeLinkDetail?.lifeLink;
    if (!lifeLink) return;
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    this.update({ busy: true, error: "" });
    try {
      this.assertCommandActive(options);
      const result = await this.api.updateLifeLink(lifeLink.id, expectedUpdatedAt ?? lifeLink.updatedAt, patch, { signal: options.signal });
      this.assertCommandActive(options);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      this.applyLifeLinkRecord(result.lifeLink);
      await this.refreshSelectedSubject(lifeLink.id, options);
      this.assertCommandActive(options);
      await this.loadLifeLinkBranch(lifeLink.parentId, false);
    } catch (error) {
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    }
    finally { if (ownerRevision === this.ownerRevision) this.update({ busy: false }); }
  }

  async setLifeLinkQrBinding(lifeLinkId: string, qrId: string, command?: { commandId: string; expectedUpdatedAt: string }, options: WorkspaceCommandOptions = {}) {
    const parsed = parseQrId(qrId);
    if (!parsed) { this.update({ error: "Enter or scan a valid Life Links QR URL or ID." }); return; }
    await this.mutateQrBinding(lifeLinkId, parsed, command, options);
  }

  async clearLifeLinkQrBinding(lifeLinkId: string, command?: { commandId: string; expectedUpdatedAt: string }, options: WorkspaceCommandOptions = {}) {
    await this.mutateQrBinding(lifeLinkId, null, command, options);
  }

  async createQrForLifeLink(lifeLinkId: string) {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    this.update({ busy: true, error: "" });
    try {
      let qrId = this.pendingGeneratedQrs.get(lifeLinkId);
      if (!qrId) {
        const { qrCodes } = await this.api.createQrBatch(1);
        if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
        qrId = qrCodes[0]?.id;
        if (!qrId) throw new Error("No QR code was generated.");
        this.pendingGeneratedQrs.set(lifeLinkId, qrId);
      }
      await this.mutateQrBinding(lifeLinkId, qrId);
      if (ownerRevision === this.ownerRevision && !this.snapshot.error) this.pendingGeneratedQrs.delete(lifeLinkId);
    } catch (error) { if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(error) }); }
    finally { if (ownerRevision === this.ownerRevision) this.update({ busy: false }); }
  }

  async refreshOwnerLibrary(user = this.snapshot.currentUser, options: WorkspaceCommandOptions = {}) {
    this.assertCommandActive(options);
    if (!user) {
      return;
    }
    const ownerRevision = this.ownerRevision;
    const [linkResult, rootResult] = await Promise.all([
      this.api.listLinks(),
      this.api.listLifeLinks({ limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal: options.signal })
    ]);
    this.assertCommandActive(options);
    if (ownerRevision !== this.ownerRevision) return;
    this.update((current) => ({
      links: linkResult.links,
      activeQrId: current.activeQrId ?? linkResult.links[0]?.id ?? null,
      inventoryPage: boundedInventoryPage(current.inventoryPage, current.inventoryFilter, linkResult.links),
      rootLifeLinks: branchFromPage(rootResult)
    }));
    await this.loadHierarchyMemberships(rootResult.lifeLinks);
    await this.getChangeHistory();
  }

  async refreshActiveQr(qrId = this.snapshot.activeQrId) {
    if (!qrId) {
      return;
    }
    try {
      const publicQrState = await this.api.getQr(qrId);
      this.update({ publicQrState });
    } catch (qrError) {
      if (qrError instanceof ApiError && qrError.status === 404) {
        this.update({ publicQrState: { state: "not_found", qrId } });
        return;
      }
      throw qrError;
    }
  }

  async selectLifeLink(
    input: { lifeLinkId: string; source: "human" | "agent" | "route" | "search" | "scan" },
    updateHistory = true,
    options: WorkspaceCommandOptions = {}
  ) {
    if (input.source === "human" && this.snapshot.workspaceMode === "collections" &&
        this.snapshot.selectedCollection && this.snapshot.collectionMembers.some((member) => member.id === input.lifeLinkId)) {
      await this.selectCollectionMember(input.lifeLinkId, updateHistory);
      return;
    }
    const navigation = ++this.navigationRevision;
    const ownerRevision = this.ownerRevision;
    this.update({ busy: true, error: "" });
    try {
      this.assertCommandActive(options);
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal: options.signal
      });
      this.assertCommandActive(options);
      if (navigation !== this.navigationRevision || ownerRevision !== this.ownerRevision) return;
      const parentId = detail.lifeLink.browsingRole === "container" ? detail.lifeLink.id : detail.lifeLink.parentId;
      const parentDetail = detail.lifeLink.browsingRole === "container" ? detail : parentId
        ? (await this.api.getLifeLinkDetail(parentId, { limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal: options.signal })).detail : null;
      this.assertCommandActive(options);
      if (navigation !== this.navigationRevision || ownerRevision !== this.ownerRevision) return;
      this.update({ hierarchyParentDetail: parentDetail });
      this.applySelectedLifeLinkDetail(detail, updateHistory, false, input.source !== "route" || detail.lifeLink.browsingRole !== "container");
      await this.loadLifeLinkBranch(parentId, false);
      if (navigation !== this.navigationRevision || ownerRevision !== this.ownerRevision) return;
      await this.loadSelectedMemberships(detail.lifeLink.id);
    } catch (selectError) {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) this.update({ error: messageFromError(selectError) });
      if (options.throwOnError) throw selectError;
    } finally {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) this.update({ busy: false });
    }
  }

  async toggleLifeLinkExpanded(lifeLinkId: string) {
    this.cancelHierarchyExpansion();
    if (this.snapshot.expandedLifeLinkIds.includes(lifeLinkId)) {
      this.update((current) => ({
        expandedLifeLinkIds: current.expandedLifeLinkIds.filter((id) => id !== lifeLinkId)
      }));
      return;
    }
    this.update((current) => ({ expandedLifeLinkIds: mergeIds(current.expandedLifeLinkIds, [lifeLinkId]) }));
    const branch = this.snapshot.lifeLinkChildren[lifeLinkId];
    if (!branch?.loaded) {
      await this.loadLifeLinkBranch(lifeLinkId, false);
    }
  }

  async loadMoreLifeLinks(parentId: string | null) {
    this.cancelHierarchyExpansion();
    const branch = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
    await this.loadLifeLinkBranch(parentId, Boolean(branch?.loaded));
  }

  async expandHierarchy(): Promise<void> {
    if (this.hierarchyExpansion || !this.active || !this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.busy ||
        this.snapshot.workspaceMode !== "hierarchies" || this.snapshot.activeView !== "workspace" || this.snapshot.routeQrId) return;
    const operation = { abort: new AbortController(), ownerRevision: this.ownerRevision,
      navigation: this.navigationRevision, parentId: this.snapshot.hierarchyParentId };
    this.hierarchyExpansion = operation;
    const current = () => this.hierarchyExpansion === operation && !operation.abort.signal.aborted &&
      this.active && operation.ownerRevision === this.ownerRevision && operation.navigation === this.navigationRevision;
    this.update({ hierarchyExpanding: true, error: "" });
    const pending: Array<string | null> = [operation.parentId];
    const visited = new Set<string | null>();
    try {
      for (let index = 0; index < pending.length && current(); index += 1) {
        const parentId = pending[index];
        if (visited.has(parentId)) throw new Error("The hierarchy changed while expanding. Refresh and try again.");
        visited.add(parentId);
        const branch = () => parentId === null ? this.snapshot.rootLifeLinks : this.snapshot.lifeLinkChildren[parentId];
        if (branch()?.loading) throw new Error("A hierarchy branch is still loading. Try Expand all again when it finishes.");
        if (branch()?.loaded && branch()?.truncated && !branch()?.nextCursor) {
          await this.loadLifeLinkBranch(parentId, false, true, { signal: operation.abort.signal, isCurrent: current });
        }
        const cursors = new Set<string>();
        while (current() && (!branch()?.loaded || branch()?.nextCursor)) {
          const next = branch();
          const cursor = next?.loaded ? next.nextCursor : null;
          if (cursor && cursors.has(cursor)) throw new Error("A hierarchy page repeated. Refresh and try again.");
          if (cursor) cursors.add(cursor);
          await this.loadLifeLinkBranch(parentId, Boolean(next?.loaded), true, { signal: operation.abort.signal, isCurrent: current });
        }
        if (!current()) return;
        if (branch()?.truncated) throw new Error("The server returned an incomplete hierarchy without a continuation cursor.");
        for (const item of branch()?.items ?? []) {
          const cached = this.snapshot.lifeLinkChildren[item.id];
          if (item.browsingRole !== "container" || (item.childCount === 0 && !cached?.items.length && !cached?.nextCursor)) continue;
          if (visited.has(item.id)) throw new Error("The hierarchy changed while expanding. Refresh and try again.");
          this.update((snapshot) => ({ expandedLifeLinkIds: mergeIds(snapshot.expandedLifeLinkIds, [item.id]) }));
          pending.push(item.id);
        }
        // Yield between branches so a large cached tree still permits Collapse or navigation.
        if (index + 1 < pending.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (current()) this.update({ error: `Some hierarchy folders could not be expanded: ${messageFromError(error)}` });
    } finally {
      if (this.hierarchyExpansion === operation) {
        this.hierarchyExpansion = null;
        this.update({ hierarchyExpanding: false });
      }
    }
  }

  collapseHierarchy(): void {
    this.cancelHierarchyExpansion();
    if (this.snapshot.workspaceMode !== "hierarchies") return;
    const parentId = this.snapshot.hierarchyParentId;
    const pending = [...(parentId === null ? this.snapshot.rootLifeLinks.items : this.snapshot.lifeLinkChildren[parentId]?.items ?? [])];
    const descendants = new Set<string>();
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      if (item.id === parentId || descendants.has(item.id)) continue;
      descendants.add(item.id);
      pending.push(...(this.snapshot.lifeLinkChildren[item.id]?.items ?? []));
    }
    this.update((snapshot) => ({ expandedLifeLinkIds: snapshot.expandedLifeLinkIds.filter((id) => !descendants.has(id)) }));
  }

  private cancelHierarchyExpansion() {
    const operation = this.hierarchyExpansion;
    if (!operation) return;
    this.hierarchyExpansion = null;
    operation.abort.abort();
    this.update({ hierarchyExpanding: false });
  }

  async createLifeLink(input: CreateLifeLinkInput & { id?: string }, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    const pendingKey = `life-link:${JSON.stringify(input)}`;
    const id = input.id ?? this.pendingCreateId(pendingKey, "life-link");
    this.update({ busy: true, error: "" });
    try {
      this.assertCommandActive(options);
      const normalized: CreateLifeLinkInput & { id?: string } = {
        ...input,
        id,
        parentId: input.parentId ?? null,
        title: input.title?.trim() || undefined
      };
      const { lifeLink } = await this.api.createLifeLink(normalized, { signal: options.signal });
      this.assertCommandActive(options);
      if (ownerRevision === this.ownerRevision) this.pendingCreateIds.delete(pendingKey);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      await this.loadLifeLinkBranch(lifeLink.parentId, false);
      await this.selectLifeLink({ lifeLinkId: lifeLink.id, source: "route" }, true, options);
    } catch (createError) {
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(createError) });
      if (options.throwOnError) throw createError;
    } finally {
      if (ownerRevision === this.ownerRevision) this.update({ busy: false });
    }
  }

  async moveLifeLink(lifeLinkId: string, parentId: string | null, expectedUpdatedAt?: string, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    this.update({ busy: true, error: "" });
    try {
      const detail = await this.detailForMutation(lifeLinkId);
      this.assertCommandActive(options);
      const previousParentId = detail.lifeLink.parentId;
      const { lifeLink } = await this.api.moveLifeLink(lifeLinkId, parentId, expectedUpdatedAt ?? detail.lifeLink.updatedAt, { signal: options.signal });
      this.assertCommandActive(options);
      if (ownerRevision !== this.ownerRevision) return;
      const searchQuery = this.snapshot.lifeLinkSearchQuery.trim();
      this.update((current) => ({
        selectedLifeLinkDetail:
          current.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId
            ? { ...current.selectedLifeLinkDetail, lifeLink }
            : current.selectedLifeLinkDetail,
        lifeLinkSearchResults: [],
        lifeLinkSearchTotalCount: 0,
        lifeLinkSearchNextCursor: null,
        lifeLinkSearchTruncated: false
      }));
      await this.refreshOwnerLibrary();
      await this.refreshChangedBranches(previousParentId, lifeLink.parentId);
      await this.refreshParentHierarchySummaries([previousParentId, lifeLink.parentId]);
      if (searchQuery) {
        await this.searchLifeLinks(searchQuery);
        if (this.snapshot.error) {
          throw new Error(this.snapshot.error);
        }
      }
      this.assertCommandActive(options);
      await this.selectLifeLink({ lifeLinkId, source: "route" }, true, options);
    } catch (moveError) {
      if (ownerRevision === this.ownerRevision) this.update({ error: messageFromError(moveError) });
      if (options.throwOnError) throw moveError;
    } finally {
      this.update({ busy: false });
    }
  }

  async detachLifeLink(lifeLinkId: string) {
    await this.moveLifeLink(lifeLinkId, null);
  }

  async attachQrToLifeLink(lifeLinkId: string, scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({ error: "Enter or scan a valid Life Links QR URL or ID." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.api.attachQr(qrId, lifeLinkId, `attach-${this.commandId()}`);
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "scan" });
      this.update({
        scanMessage: { tone: "success", title: "QR attached", detail: qrId }
      });
    } catch (attachError) {
      this.update({ error: messageFromError(attachError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async searchRecords(query = this.snapshot.lifeLinkSearchQuery) {
    this.cancelRecordSearch();
    ++this.searchRevision;
    const normalized = query.trim();
    this.update({ activeView: "search", detailsOpen: false, lifeLinkSearchQuery: query,
      lifeLinkSearchLoading: false, recordSearch: emptyRecordSearch(normalized), error: "" });
    if (!normalized || !this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.routeQrId) return;
    await Promise.all(RECORD_SEARCH_CATEGORIES.map((category) => this.loadMoreRecordSearch(category)));
  }

  cancelRecordSearch() {
    ++this.recordSearchRevision;
    for (const request of this.recordSearchRequests.values()) request.abort();
    this.recordSearchRequests.clear();
    this.update((current) => ({ recordSearch: { ...current.recordSearch, groups: Object.fromEntries(
      RECORD_SEARCH_CATEGORIES.map((category) => {
        const group = current.recordSearch.groups[category];
        return [category, group.loading ? { ...group, loading: false, error: "Search paused. Continue to finish checking this category." } : group];
      })
    ) as typeof current.recordSearch.groups } }));
  }

  async loadMoreRecordSearch(category: RecordSearchCategory) {
    const query = this.snapshot.recordSearch.query;
    const previous = this.snapshot.recordSearch.groups[category];
    if (!query || previous.loading || !this.snapshot.currentUser || this.snapshot.guestView || this.snapshot.routeQrId) return;
    const ownerId = this.snapshot.currentUser.id;
    const ownerRevision = this.ownerRevision;
    const revision = this.recordSearchRevision;
    const request = new AbortController();
    this.recordSearchRequests.set(category, request);
    const current = () => !request.signal.aborted && ownerRevision === this.ownerRevision && revision === this.recordSearchRevision &&
      this.snapshot.currentUser?.id === ownerId && this.snapshot.activeView === "search" && this.snapshot.recordSearch.query === query;
    const patch = (changes: Partial<typeof previous>) => this.update((snapshot) => ({ recordSearch: {
      ...snapshot.recordSearch, groups: { ...snapshot.recordSearch.groups, [category]: { ...snapshot.recordSearch.groups[category], ...changes } }
    } }));
    patch({ loading: true, error: "" });
    try {
      await collectRecordSearchPage((input, signal) => this.api.searchRecords(input, { signal }), {
        q: query, category, cursor: previous.nextCursor, limit: 10
      }, (page) => {
        if (!current()) return;
        patch({ ...page, results: [...new Map([...previous.results, ...page.results].map((hit) => [hit.id, hit])).values()],
          scanned: previous.scanned + page.scanned, warnings: [...new Set([...previous.warnings, ...page.warnings])], searched: true });
      }, request.signal);
    } catch (error) {
      if (current()) patch({ error: messageFromError(error) });
    } finally {
      if (current()) patch({ loading: false });
      if (this.recordSearchRequests.get(category) === request) this.recordSearchRequests.delete(category);
    }
  }

  async agentSearchRecords(input: RecordSearchInput, signal?: AbortSignal): Promise<{ ok: true; page: RecordSearchPage } | { ok: false; code: string }> {
    const ownerId = this.currentAgentOwnerId();
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    const searchRevision = this.recordSearchRevision;
    const agentEpoch = this.workspaceAgentEpoch;
    const eligible = () => this.currentAgentOwnerId() === ownerId && ownerRevision === this.ownerRevision &&
      navigation === this.navigationRevision && searchRevision === this.recordSearchRevision && agentEpoch === this.workspaceAgentEpoch &&
      this.snapshot.agentConnection.connected && this.snapshot.agentConnection.toolCatalogId === LIFE_LINKS_SEARCH_TOOL_CATALOG_ID &&
      this.snapshot.canonicalEditingId === null;
    if (!ownerId || !eligible()) return { ok: false, code: "search_catalog_not_granted" };
    try {
      signal?.throwIfAborted();
      const page = await this.api.searchRecords(input, { signal, actor: "agent" });
      signal?.throwIfAborted();
      if (!eligible()) return { ok: false, code: "search_catalog_not_granted" };
      this.cancelRecordSearch();
      const state = this.snapshot.recordSearch.query === input.q ? this.snapshot.recordSearch : emptyRecordSearch(input.q);
      this.update({ activeView: "search", detailsOpen: false, lifeLinkSearchQuery: input.q, recordSearch: {
        ...state, groups: { ...state.groups, [input.category]: { ...page, searched: true, loading: false, error: "" } }
      } });
      return { ok: true, page };
    } catch (error) {
      return { ok: false, code: signal?.aborted || isAbortError(error) ? "cancelled" : error instanceof ApiError ? error.code : "search_unavailable" };
    }
  }

  async openRecordSearchHit(hit: RecordSearchHit) {
    const ownerId = this.snapshot.currentUser?.id;
    if (!ownerId || this.snapshot.guestView || this.snapshot.routeQrId) return;
    const ownerRevision = this.ownerRevision;
    const sameOwner = () => ownerRevision === this.ownerRevision && this.snapshot.currentUser?.id === ownerId;
    this.cancelRecordSearch();
    const target = hit.reference;
    this.update({ recordSearchTarget: target, error: "" });
    try {
      if (target.kind === "life_link" || target.kind === "attachment") {
        await this.activateLifeLink(target.lifeLinkId);
      } else if (target.kind === "collection") {
        await this.openCollection(target.collectionId);
        if (sameOwner() && this.snapshot.selectedCollection?.id === target.collectionId && target.sectionId) {
          this.setCollectionPresentation(target.collectionId, { view: "sections", expandedGroups: [`section:${target.sectionId}`] });
        }
      } else if (target.kind === "routine" || target.kind === "session") {
        await this.openRoutine(target.routineId);
        if (!sameOwner() || this.snapshot.workspaceMode !== "routines" || this.snapshot.routineWorkspace.selectedRoutine?.routine.id !== target.routineId) return;
        if (target.kind === "session") {
          await this.selectRoutineSession(target.sessionId);
          if (!sameOwner() || this.snapshot.workspaceMode !== "routines" || this.snapshot.routineWorkspace.selectedSession?.session.id !== target.sessionId) return;
          this.setRoutineDetailPresentation("session");
          this.setDetailsOpen(true);
        }
      } else if (target.authority === "native") {
        await this.openCalendarEvent(target.eventId);
      } else {
        await this.openProviderCalendarEvent(target);
      }
    } catch (error) {
      if (sameOwner()) this.update({ error: `That search result could not be opened. It may have changed or been removed. ${messageFromError(error)}` });
    }
  }

  async searchLifeLinks(query = this.snapshot.lifeLinkSearchQuery, append = false) {
    this.cancelRecordSearch();
    this.update({ recordSearch: emptyRecordSearch() });
    const search = ++this.searchRevision;
    const ownerRevision = this.ownerRevision;
    const normalized = query.trim();
    this.update({ lifeLinkSearchQuery: query, error: "" });
    if (!normalized) {
      this.update({
        lifeLinkSearchResults: [],
        lifeLinkSearchTotalCount: 0,
        lifeLinkSearchNextCursor: null,
        lifeLinkSearchTruncated: false,
        lifeLinkSearchLoading: false,
        collectionSearchResults: [], collectionSearchComplete: true
      });
      return;
    }
    this.update({ lifeLinkSearchLoading: true });
    try {
      const result = await this.api.searchLifeLinks(normalized, {
        cursor: append ? this.snapshot.lifeLinkSearchNextCursor : null,
        limit: DEFAULT_LIFE_LINK_SEARCH_LIMIT
      });
      if (search !== this.searchRevision || ownerRevision !== this.ownerRevision) return;
      this.update((current) => ({
        lifeLinkSearchResults: append
          ? mergeSearchResults(current.lifeLinkSearchResults, result.results)
          : result.results,
        lifeLinkSearchTotalCount: result.totalCount,
        lifeLinkSearchNextCursor: result.nextCursor,
        lifeLinkSearchTruncated: result.truncated
      }));
      await this.loadHierarchyMemberships(result.results.map((entry) => entry.lifeLink), () => search === this.searchRevision);
      if (search !== this.searchRevision || ownerRevision !== this.ownerRevision) return;
      if (!append) {
        this.update({ collectionSearchResults: [], collectionSearchComplete: false });
        const collectionSearchResults = await this.searchCollectionsAndSections(normalized);
        if (search !== this.searchRevision || ownerRevision !== this.ownerRevision) return;
        this.update({ collectionSearchResults, collectionSearchComplete: true });
      }
    } catch (searchError) {
      if (search === this.searchRevision && ownerRevision === this.ownerRevision) this.update({ error: messageFromError(searchError) });
    } finally {
      if (search === this.searchRevision && ownerRevision === this.ownerRevision) this.update({ lifeLinkSearchLoading: false });
    }
  }

  async agentCreateLifeLink(input: AgentCreateLifeLinkInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    return this.runAgentCommand(async (options) => {
      if (input.parentId) await this.agentMutableRecord(input.parentId, options);
      await this.createLifeLink(input, options);
    }, signal);
  }

  async agentMoveLifeLink(input: AgentMoveLifeLinkInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    return this.runAgentCommand(async (options) => {
      await this.agentMutableRecord(input.lifeLinkId, options);
      if (input.parentId) await this.agentMutableRecord(input.parentId, options);
      await this.moveLifeLink(input.lifeLinkId, input.parentId, input.baseUpdatedAt, options);
    }, signal);
  }

  async agentManageLifeLinkQr(input: AgentManageLifeLinkQrInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    return this.runAgentCommand(async (options) => {
      const detail = await this.agentMutableRecord(input.lifeLinkId, options);
      await this.selectLifeLink({ lifeLinkId: input.lifeLinkId, source: "agent" }, true, options);
      if (input.action === "set_public_projection") {
        await this.updateSelectedLifeLink({ privacy: input.privacy, publicFieldKeys: input.publicFieldKeys }, input.baseUpdatedAt, options);
      } else if (input.action === "detach") {
        await this.clearLifeLinkQrBinding(input.lifeLinkId, { commandId: input.commandId, expectedUpdatedAt: input.baseUpdatedAt }, options);
      } else {
        if (input.action === "attach" && input.baseUpdatedAt === detail.lifeLink.updatedAt && detail.lifeLink.qrId && detail.lifeLink.qrId !== input.qrId) throw new AgentCommandError("invalid_operation");
        await this.setLifeLinkQrBinding(input.lifeLinkId, input.qrId, { commandId: input.commandId, expectedUpdatedAt: input.baseUpdatedAt }, options);
      }
    }, signal);
  }

  async agentListCollections(input: AgentListCollectionsInput, signal?: AbortSignal): Promise<AgentCollectionListResult> {
    let page: Awaited<ReturnType<LifeLinksWorkspaceApi["listCollections"]>> | undefined;
    const action = await this.runAgentCommand(async (options) => {
      page = await this.api.listCollections({ cursor: input.cursor, limit: input.limit, signal });
      this.assertCommandActive(options);
      await this.openCollections(true, options);
      this.assertCommandActive(options);
    }, signal);
    return action.ok ? (page ? { ok: true, ...page } : { ok: false, code: "effect_not_applied" }) : action;
  }

  async agentInspectCollection(input: AgentInspectCollectionInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    return this.runAgentCommand((options) => this.openCollection(input.collectionId, undefined, true, options), signal);
  }

  async agentMaintainCollection(input: AgentMaintainCollectionInput, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    return this.runAgentCommand(async (options) => {
      if (input.action === "create_collection") {
        await this.createCollection({ id: input.id, title: input.title, purpose: input.purpose, notes: input.notes }, options);
        return;
      }
      const { collection } = await this.api.getCollection(input.collectionId, { limit: 1, signal });
      this.assertCommandActive(options);
      const target = { ...collection, updatedAt: input.baseUpdatedAt };
      switch (input.action) {
        case "update_collection":
          await this.updateCollection({ ...(input.title === undefined ? {} : { title: input.title }), ...(input.purpose === undefined ? {} : { purpose: input.purpose }), ...(input.notes === undefined ? {} : { notes: input.notes }) }, target, options); break;
        case "add_member": await this.addCollectionMember(input.lifeLinkId, target, options); break;
        case "remove_member": await this.removeCollectionMember(input.lifeLinkId, target, options); break;
        case "create_section": await this.createCollectionSection(input.title, target, input.id, options); break;
        case "update_section": await this.updateCollectionSection(input.sectionId, input.title, target, options); break;
        case "remove_section": await this.removeCollectionSection(input.sectionId, target, options); break;
        case "replace_sections": await this.replaceCollectionSectionAssignments(input.lifeLinkId, input.sectionIds, target, options); break;
      }
      this.assertCommandActive(options);
      await this.openCollection(input.collectionId, undefined, true, options);
    }, signal);
  }

  private async runAgentCommand(operation: (options: WorkspaceCommandOptions) => Promise<void>, signal?: AbortSignal): Promise<AgentToolControllerActionResult> {
    const ownerId = this.currentAgentOwnerId();
    const options: WorkspaceCommandOptions = { signal, throwOnError: true, assertActive: () => {
      if (!ownerId || this.currentAgentOwnerId() !== ownerId) throw new AgentCommandError("life_link_unavailable");
      if (this.snapshot.canonicalEditingId !== null) throw new AgentCommandError("editor_open");
    } };
    try {
      this.assertCommandActive(options);
      await operation(options);
      this.assertCommandActive(options);
      return { ok: true };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return { ok: false, code: "cancelled" };
      if (error instanceof AgentCommandError) return { ok: false, code: error.code };
      if (error instanceof ApiError) {
        if (error.code === "stale_life_link" || error.code === "stale_collection") return { ok: false, code: error.code };
        if ([401, 403, 404].includes(error.status)) return { ok: false, code: "life_link_unavailable" };
        return { ok: false, code: "invalid_operation" };
      }
      return { ok: false, code: "effect_not_applied" };
    }
  }

  private async agentMutableRecord(lifeLinkId: string, options: WorkspaceCommandOptions) {
    const { detail } = await this.api.getLifeLinkDetail(lifeLinkId, { limit: 1, signal: options.signal });
    this.assertCommandActive(options);
    if (detail.lifeLink.ownerId !== this.currentAgentOwnerId()) throw new AgentCommandError("life_link_unavailable");
    if (readCanonicalLifeLinkDraft(lifeLinkId, detail.lifeLink.qrId, detail.lifeLink.updatedAt)) throw new AgentCommandError("editor_dirty");
    const priorAssertion = options.assertActive;
    options.assertActive = () => {
      priorAssertion?.();
      if (readCanonicalLifeLinkDraft(lifeLinkId, detail.lifeLink.qrId, detail.lifeLink.updatedAt)) throw new AgentCommandError("editor_dirty");
    };
    return detail;
  }

  async agentInspectCurrentLifeLink(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult> {
    const agentOwnerId = this.currentAgentOwnerId();
    if (!agentOwnerId || this.snapshot.selectedLifeLinkId !== input.lifeLinkId) {
      return { ok: false, code: "life_link_unavailable" };
    }
    if (this.snapshot.canonicalEditingId !== null) {
      return { ok: false, code: "editor_open" };
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    try {
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        signal
      });
      if (signal?.aborted) {
        return { ok: false, code: "cancelled" };
      }
      if (
        this.currentAgentOwnerId() !== agentOwnerId ||
        this.snapshot.selectedLifeLinkId !== input.lifeLinkId ||
        this.snapshot.canonicalEditingId !== null
      ) {
        return {
          ok: false,
          code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
        };
      }
      this.applySelectedLifeLinkDetail(detail, false, this.snapshot.workspaceMode === "collections");
      await this.hydrateVisibleDetails(detail, signal);
      return { ok: true };
    } catch (error) {
      return agentReadFailure(error, "life_link_unavailable");
    }
  }

  async agentReadAttachment(input: AgentReadAttachmentInput, signal?: AbortSignal): Promise<AgentReadAttachmentResult> {
    const ownerId = this.currentAgentOwnerId();
    const ownerRevision = this.ownerRevision;
    const navigationRevision = this.navigationRevision;
    const denial = (): Exclude<AgentReadAttachmentResult, { ok: true }> | null => {
      if (signal?.aborted) return { ok: false, code: "cancelled" };
      if (!ownerId || this.currentAgentOwnerId() !== ownerId || !this.snapshot.agentConnection.connected ||
          this.ownerRevision !== ownerRevision || this.navigationRevision !== navigationRevision) {
        return { ok: false, code: "life_link_unavailable" };
      }
      if (this.snapshot.canonicalEditingId !== null) return { ok: false, code: "editor_open" };
      return null;
    };
    const before = denial();
    if (before) return before;
    try {
      // Refresh authorization and metadata instead of returning cached private attachments.
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, { limit: 1, signal });
      const afterDetail = denial();
      if (afterDetail) return afterDetail;
      if (detail.lifeLink.id !== input.lifeLinkId || detail.lifeLink.ownerId !== ownerId) {
        return { ok: false, code: "life_link_unavailable" };
      }
      if (!input.mediaId) {
        if (input.revision !== undefined && input.revision !== detail.lifeLink.updatedAt) {
          return { ok: false, code: "stale_life_link" };
        }
        return { ok: true, kind: "list", attachments: detail.lifeLink.media, revision: detail.lifeLink.updatedAt };
      }
      const media = detail.lifeLink.media.find((media) => media.id === input.mediaId);
      if (!media || media.ownerId !== ownerId || media.lifeLinkId !== input.lifeLinkId) {
        return { ok: false, code: "life_link_unavailable" };
      }
      if (input.representation === "image") {
        const { representation: _representation, lifeLinkId: _lifeLinkId, mediaId: _mediaId, ...options } = input;
        const result = await this.api.getLifeLinkAttachmentImage(input.lifeLinkId, input.mediaId, options, signal);
        const afterImage = denial();
        if (afterImage) return afterImage;
        if (result.mediaId !== media.id || (input.mode !== "describe" && result.sourceRevision !== input.sourceRevision) ||
            (result.source !== null && (result.source.mimeType !== media.mimeType || result.source.sizeBytes !== media.sizeBytes ||
              (media.mimeType === "application/pdf" ? result.source.pdf?.pageNumber !== (input.page ?? 1) :
                result.source.office ? result.source.office.pageNumber !== (input.page ?? 1) : input.page !== undefined)))) {
          return { ok: false, code: "effect_not_applied" };
        }
        return { ok: true, kind: "image", result };
      }
      const page = await this.api.getLifeLinkAttachmentContent(input.lifeLinkId, input.mediaId, {
        offset: input.offset, revision: input.revision, limit: 1000, signal,
        ...(input.representation === "transcript" ? { representation: "transcript", startMs: input.startMs,
          durationMs: input.durationMs, audioStreamIndex: input.audioStreamIndex } : {})
      });
      const afterContent = denial();
      if (afterContent) return afterContent;
      if (page.mediaId !== input.mediaId) return { ok: false, code: "effect_not_applied" };
      if (input.representation === "transcript") validateAttachmentTranscript(page, input.mediaId, input);
      else if (page.transcript !== undefined) return { ok: false, code: "effect_not_applied" };
      return { ok: true, kind: "content", page };
    } catch (error) {
      const cancelled = denial();
      if (cancelled) return cancelled;
      if (isAbortError(error)) return { ok: false, code: "cancelled" };
      if (error instanceof ApiError) {
        if ([401, 403, 404].includes(error.status)) return { ok: false, code: "life_link_unavailable" };
        if (error.status === 409) return { ok: false, code: "stale_life_link" };
        if (error.status === 400) return { ok: false, code: "invalid_operation" };
      }
      return { ok: false, code: "effect_not_applied" };
    }
  }

  async agentSearchLifeLinks(
    input: { query: string; limit: number },
    signal?: AbortSignal
  ): Promise<AgentSearchLifeLinksControllerResult> {
    this.cancelRecordSearch();
    this.update({ recordSearch: emptyRecordSearch() });
    const agentOwnerId = this.currentAgentOwnerId();
    const revision = ++this.searchRevision;
    if (!agentOwnerId) {
      return { ok: false, code: "life_link_unavailable" };
    }
    if (this.snapshot.canonicalEditingId !== null) {
      return { ok: false, code: "editor_open" };
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    const limit = Math.max(1, Math.min(10, Math.trunc(input.limit)));
    const result = await this.api.searchLifeLinks(input.query, { limit, signal }).catch((error: unknown) => {
      if (isAbortError(error) || signal?.aborted) {
        return null;
      }
      throw error;
    });
    if (!result || signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    if (this.currentAgentOwnerId() !== agentOwnerId || this.snapshot.canonicalEditingId !== null) {
      return {
        ok: false,
        code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
      };
    }
    const boundedResults = result.results.slice(0, limit);
    const search = {
      query: input.query,
      results: boundedResults,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore || result.results.length > boundedResults.length,
      truncated: result.truncated || result.hasMore || result.results.length > boundedResults.length
    };
    if (revision !== this.searchRevision) return { ok: true, search };
    this.update({
      activeView: "search",
      detailsOpen: false,
      lifeLinkSearchQuery: search.query,
      lifeLinkSearchResults: search.results,
      lifeLinkSearchTotalCount: search.totalCount,
      lifeLinkSearchNextCursor: search.nextCursor,
      lifeLinkSearchTruncated: search.truncated,
      lifeLinkSearchLoading: false,
      collectionSearchResults: [], collectionSearchComplete: false,
      error: ""
    });
    const current = () => revision === this.searchRevision && !signal?.aborted && this.currentAgentOwnerId() === agentOwnerId && this.snapshot.canonicalEditingId === null;
    await this.loadHierarchyMemberships(search.results.map((entry) => entry.lifeLink), current, signal);
    try {
      if (current()) {
        const collections = await this.searchCollectionsAndSections(input.query, signal);
        if (current()) this.update({ collectionSearchResults: collections, collectionSearchComplete: true });
      }
    } catch (error) {
      if (current()) this.update({ error: messageFromError(error), collectionSearchComplete: false });
    }
    if (signal?.aborted) return { ok: false, code: "cancelled" };
    if (this.currentAgentOwnerId() !== agentOwnerId) return { ok: false, code: "life_link_unavailable" };
    if (this.snapshot.canonicalEditingId !== null) return { ok: false, code: "editor_open" };
    return { ok: true, search };
  }

  async agentOpenLifeLink(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult> {
    const agentOwnerId = this.currentAgentOwnerId();
    if (!agentOwnerId) {
      return { ok: false, code: "life_link_unavailable" };
    }
    if (this.snapshot.canonicalEditingId !== null) {
      return { ok: false, code: "editor_open" };
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    try {
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        signal
      });
      if (signal?.aborted) {
        return { ok: false, code: "cancelled" };
      }
      if (this.currentAgentOwnerId() !== agentOwnerId || this.snapshot.canonicalEditingId !== null) {
        return {
          ok: false,
          code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
        };
      }
      this.applySelectedLifeLinkDetail(detail, true);
      await this.hydrateVisibleDetails(detail, signal);
      return { ok: true };
    } catch (error) {
      return agentReadFailure(error, "life_link_unavailable");
    }
  }

  async agentUpdateLifeLinkContent(
    input: AgentUpdateLifeLinkContentInput,
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult> {
    const agentOwnerId = this.currentAgentOwnerId();
    if (!agentOwnerId) {
      return { ok: false, code: "life_link_unavailable" };
    }
    if (this.snapshot.canonicalEditingId !== null) {
      return { ok: false, code: "editor_open" };
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }

    let detail: LifeLinkDetail;
    try {
      detail = (await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        signal
      })).detail;
    } catch (error) {
      return agentReadFailure(error, "life_link_unavailable");
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    if (
      this.currentAgentOwnerId() !== agentOwnerId ||
      this.snapshot.canonicalEditingId !== null
    ) {
      return {
        ok: false,
        code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
      };
    }
    if (detail.lifeLink.updatedAt !== input.baseUpdatedAt) {
      return { ok: false, code: "stale_life_link" };
    }
    if (readCanonicalLifeLinkDraft(detail.lifeLink.id, detail.lifeLink.qrId, detail.lifeLink.updatedAt)) {
      return { ok: false, code: "editor_dirty" };
    }

    const sourceLifeLinkIds = Array.from(new Set(input.sourceLifeLinkIds));
    if (sourceLifeLinkIds.length > MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT) {
      return { ok: false, code: "source_life_link_unavailable" };
    }
    for (const sourceLifeLinkId of sourceLifeLinkIds) {
      if (sourceLifeLinkId === input.lifeLinkId) {
        continue;
      }
      try {
        await this.api.getLifeLinkDetail(sourceLifeLinkId, { limit: 1, signal });
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          return { ok: false, code: "cancelled" };
        }
        return { ok: false, code: "source_life_link_unavailable" };
      }
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    if (
      this.currentAgentOwnerId() !== agentOwnerId ||
      this.snapshot.canonicalEditingId !== null
    ) {
      return {
        ok: false,
        code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
      };
    }

    try {
      detail = (await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        signal
      })).detail;
    } catch (error) {
      return agentReadFailure(error, "life_link_unavailable");
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    if (
      this.currentAgentOwnerId() !== agentOwnerId ||
      this.snapshot.canonicalEditingId !== null
    ) {
      return {
        ok: false,
        code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
      };
    }
    if (detail.lifeLink.updatedAt !== input.baseUpdatedAt) {
      return { ok: false, code: "stale_life_link" };
    }
    if (readCanonicalLifeLinkDraft(detail.lifeLink.id, detail.lifeLink.qrId, detail.lifeLink.updatedAt)) {
      return { ok: false, code: "editor_dirty" };
    }

    let updatedLifeLink: LifeLinkRecord;
    try {
      updatedLifeLink = (await this.api.updateLifeLink(input.lifeLinkId, input.baseUpdatedAt, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.context === undefined ? {} : { context: input.context })
      }, { signal })).lifeLink;
    } catch (error) {
      if (error instanceof ApiError && error.code === "stale_life_link") {
        return { ok: false, code: "stale_life_link" };
      }
      return agentReadFailure(error, "life_link_unavailable");
    }

    clearCanonicalLifeLinkDraft(updatedLifeLink.id, updatedLifeLink.qrId);
    const updatedDetail: LifeLinkDetail = {
      ...detail,
      lifeLink: updatedLifeLink,
      ancestry: {
        ...detail.ancestry,
        items: detail.ancestry.items.map((item) => item.id === updatedLifeLink.id
          ? {
              ...item,
              parentId: updatedLifeLink.parentId,
              qrId: updatedLifeLink.qrId,
              title: updatedLifeLink.title,
              privacy: updatedLifeLink.privacy,
              updatedAt: updatedLifeLink.updatedAt
            }
          : item)
      }
    };
    if (this.currentAgentOwnerId() === agentOwnerId) {
      this.applySelectedLifeLinkDetail(updatedDetail, true, this.snapshot.workspaceMode === "collections");
      await this.hydrateVisibleDetails(updatedDetail, signal);
    }
    return { ok: true };
  }

  async agentStartFindMode(
    input: { lifeLinkId: string },
    signal?: AbortSignal
  ): Promise<AgentToolControllerActionResult> {
    const agentOwnerId = this.currentAgentOwnerId();
    if (!agentOwnerId) {
      return { ok: false, code: "life_link_unavailable" };
    }
    if (this.snapshot.canonicalEditingId !== null) {
      return { ok: false, code: "editor_open" };
    }
    if (signal?.aborted) {
      return { ok: false, code: "cancelled" };
    }
    try {
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        signal
      });
      if (signal?.aborted) {
        return { ok: false, code: "cancelled" };
      }
      if (this.currentAgentOwnerId() !== agentOwnerId || this.snapshot.canonicalEditingId !== null) {
        return {
          ok: false,
          code: this.snapshot.canonicalEditingId !== null ? "editor_open" : "life_link_unavailable"
        };
      }
      if (!detail.lifeLink.qrId) {
        return { ok: false, code: "qr_not_attached" };
      }
      this.applySelectedLifeLinkDetail(detail, true);
      this.setActiveView("scan");
      this.update({ findTargetId: detail.lifeLink.qrId, activeQrId: detail.lifeLink.qrId });
      return { ok: true };
    } catch (error) {
      return agentReadFailure(error, "life_link_unavailable");
    }
  }

  async openPublicQrInWorkspace() {
    const { activeQrId, currentUser } = this.snapshot;
    if (!currentUser) {
      this.update({ error: "Log in to open this QR in My Life Links." });
      return;
    }
    if (!activeQrId) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.refreshOwnerLibrary(currentUser);
      const result = await this.api.searchLifeLinks(activeQrId, { limit: 10 });
      const exact = result.results.find((item) => item.lifeLink.qrId === activeQrId);
      if (!exact) {
        this.update({ error: "This QR is not attached to a Life Link in your library." });
        return;
      }
      await this.selectLifeLink({ lifeLinkId: exact.lifeLink.id, source: "scan" });
    } catch (openError) {
      this.update({ error: messageFromError(openError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async login(email: string, password: string) {
    this.update({ busy: true, error: "" });
    try {
      const activeQrId = this.snapshot.activeQrId;
      const result = await this.api.login(email, password);
      const nextRoute = classifyLifeLinksRoute(this.route.pathname(), true);
      this.update({
        currentUser: result.user,
        agentConnection: result.agentConnection,
        qrBaseUrl: result.qrBaseUrl,
        routePathname: this.route.pathname(),
        routeQrId: nextRoute.qrId,
        routeLifeLinkId: nextRoute.lifeLinkId
      });
      if (nextRoute.surface === "public-qr") {
        await this.refreshActiveQr(nextRoute.qrId);
      } else {
        if (!isCollectionsPath(this.route.pathname()) && !isRoutinesPath(this.route.pathname()) &&
            !isCalendarPath(this.route.pathname())) {
          await this.refreshOwnerLibrary(result.user);
        }
      }
      if (nextRoute.surface === "owner-workspace" &&
          (nextRoute.lifeLinkId || isCollectionsPath(this.route.pathname()) || isRoutinesPath(this.route.pathname()) ||
            isCalendarPath(this.route.pathname()) ||
            this.route.pathname() === "/life-links")) {
        await this.restoreOwnerRoute(this.route.pathname());
      } else if (nextRoute.surface !== "public-qr" && activeQrId) {
        await this.refreshActiveQr(activeQrId);
      }
    } catch (loginError) {
      this.update({ error: messageFromError(loginError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async logout() {
    this.cancelRecordSearch();
    this.invalidateWorkspaceAgentChanges();
    this.confirmAgentChange(false);
    this.confirmAgentCalendarDeletion(false);
    this.agentChangeApplication = null;
    this.agentCalendarDeletionApplication = null;
    this.agentChangePreviews.clear();
    this.agentCalendarDeletionPreviews.clear();
    this.agentProviderCalendarDeletionPreviews.clear();
    this.pendingChangeCommands.clear();
    ++this.ownerRevision;
    ++this.navigationRevision;
    ++this.searchRevision;
    this.removedCalendarAccounts.clear();
    this.removedConnectedCalendars.clear();
    this.pendingCreateIds.clear();
    this.pendingQrBindings.clear();
    this.pendingGeneratedQrs.clear();
    const logoutRequest = this.api.logout().catch(() => undefined);
    const nextRoute = classifyLifeLinksRoute(this.route.pathname(), false);
    this.update({
      ...emptyFieldLedgerState(),
      currentUser: null,
      agentConnection: { connected: false, connectedAt: null, toolCatalogId: null },
      links: [],
      editingId: null,
      canonicalEditingId: null,
      rootLifeLinks: emptyLifeLinkBranch(),
      lifeLinkChildren: {},
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      expandedLifeLinkIds: [],
      highlightedLifeLinkId: null,
      lifeLinkSearchResults: [],
      routePathname: this.route.pathname(),
      routeQrId: nextRoute.qrId,
      routeLifeLinkId: nextRoute.lifeLinkId
    });
    await logoutRequest;
  }

  async connectAgent() {
    if (!this.snapshot.currentUser) {
      this.update({ error: "Log in to connect your agent." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.connectAgent(LIFE_LINKS_SEARCH_TOOL_CATALOG_ID);
      this.update({ agentConnection: result.agentConnection });
    } catch (connectionError) {
      this.update({ error: messageFromError(connectionError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async disconnectAgent() {
    this.invalidateWorkspaceAgentChanges();
    this.update({ agentWorkspaceChangeConfirmation: null });
    this.confirmAgentChange(false);
    this.confirmAgentCalendarDeletion(false);
    this.agentChangeApplication = null;
    this.agentCalendarDeletionApplication = null;
    this.agentChangePreviews.clear();
    this.agentCalendarDeletionPreviews.clear();
    this.agentProviderCalendarDeletionPreviews.clear();
    if (!this.snapshot.currentUser) {
      this.update({ error: "Log in to disconnect your agent." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.disconnectAgent();
      this.update({ agentConnection: result.agentConnection });
    } catch (connectionError) {
      this.update({ error: messageFromError(connectionError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async openQr(qrId: string, updateHistory = true) {
    ++this.navigationRevision;
    this.update({
      activeQrId: qrId,
      activeView: "scan",
      routePathname: `/qr/${encodeURIComponent(qrId)}`,
      routeQrId: qrId,
      routeLifeLinkId: null,
      scanMessage: {
        tone: "neutral",
        title: "QR opened",
        detail: qrId
      }
    });
    const pathname = `/qr/${encodeURIComponent(qrId)}`;
    if (updateHistory && this.route.pathname() !== pathname) {
      this.route.push(pathname);
    }
    await this.refreshActiveQr(qrId);
  }

  async scanQr(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Not a Life Links QR",
          detail: scanText.slice(0, 90)
        }
      });
      return;
    }
    await this.openQr(qrId);
  }

  async evaluateFindScan(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Not a Life Links QR",
          detail: scanText.slice(0, 90)
        }
      });
      return;
    }

    const { findTargetId, currentUser } = this.snapshot;
    if (!findTargetId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Select a search result",
          detail: "Pick the item you want to find, then scan QR codes."
        }
      });
      return;
    }

    const result = currentUser
      ? await this.api.findScan(findTargetId, scanText)
      : { targetQrId: findTargetId, scannedQrId: qrId, match: qrId === findTargetId };
    if (result.match) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(90);
      }
      this.update({ scanMessage: { tone: "success", title: "Match found", detail: qrId } });
      return;
    }
    this.update({ scanMessage: { tone: "neutral", title: "Not the selected item", detail: qrId } });
  }

  async generateBatch() {
    if (!this.snapshot.currentUser) {
      this.update({ error: "Log in to generate QR batches." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.createQrBatch(normalizeBatchCount(this.snapshot.batchCount));
      this.update({
        lastBatchId: result.batch.id,
        lastBatchIds: result.qrCodes.map((link) => link.id),
        inventoryPage: 0
      });
      await this.refreshOwnerLibrary();
      this.update((current) => ({
        activeQrId: result.qrCodes[0]?.id ?? current.activeQrId,
        activeView: "factory"
      }));
    } catch (batchError) {
      this.update({ error: messageFromError(batchError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async claimActiveLink() {
    const { activeQrId, currentUser } = this.snapshot;
    if (!activeQrId) {
      return;
    }
    if (!currentUser) {
      this.update({ error: "Sign in to Life Links to claim this QR." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.api.claimQr(activeQrId, `claim-${this.commandId()}`);
      const routeState = classifyLifeLinksRoute(this.route.pathname(), true);
      await this.refreshActiveQr(activeQrId);
      if (routeState.surface === "public-qr") {
        // A permanent QR route remains public-facing after claim. Entering the
        // private hierarchy is a separate, visible human action.
      } else {
        await this.refreshOwnerLibrary();
        this.update({ editingId: activeQrId });
      }
      this.update({
        guestView: false,
        scanMessage: { tone: "success", title: "Claimed", detail: activeQrId }
      });
    } catch (claimError) {
      this.update({ error: messageFromError(claimError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async saveCanonicalLifeLink(
    lifeLinkId: string,
    expectedUpdatedAt: string,
    patch: CanonicalLifeLinkEditorPatch
  ) {
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.updateLifeLink(lifeLinkId, expectedUpdatedAt, patch);
      clearCanonicalLifeLinkDraft(lifeLinkId, result.lifeLink.qrId);
      this.applyLifeLinkRecord(result.lifeLink);
      this.update((current) => ({
        selectedLifeLinkDetail:
          current.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId
            ? { ...current.selectedLifeLinkDetail, lifeLink: result.lifeLink }
            : current.selectedLifeLinkDetail,
        canonicalEditingId: null
      }));
      await this.refreshOwnerLibrary();
      await this.loadLifeLinkBranch(result.lifeLink.parentId, false);
    } catch (saveError) {
      this.update({ error: messageFromError(saveError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async uploadCanonicalMedia(lifeLinkId: string, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      for (const file of files) {
        await this.api.uploadLifeLinkMedia(lifeLinkId, file);
      }
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "human" }, false);
    } catch (uploadError) {
      this.update({ error: messageFromError(uploadError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async removeCanonicalMedia(lifeLinkId: string, mediaId: string) {
    this.update({ busy: true, error: "" });
    try {
      await this.api.deleteLifeLinkMedia(lifeLinkId, mediaId);
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "human" }, false);
    } catch (deleteError) {
      this.update({ error: messageFromError(deleteError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async uploadMedia(qrId: string, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      for (const file of files) {
        await this.api.uploadLinkMedia(qrId, file);
      }
      await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr(qrId)]);
    } catch (uploadError) {
      this.update({ error: messageFromError(uploadError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async removeMedia(qrId: string, mediaId: string) {
    this.update({ busy: true, error: "" });
    try {
      await this.api.deleteLinkMedia(qrId, mediaId);
      await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr(qrId)]);
    } catch (deleteError) {
      this.update({ error: messageFromError(deleteError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async refresh() {
    this.update({ error: "" });
    if (this.snapshot.workspaceMode === "collections" && !this.snapshot.routeQrId) {
      if (this.snapshot.selectedCollection) await this.openCollection(this.snapshot.selectedCollection.id, this.snapshot.selectedLifeLinkId ?? undefined, false);
      else await this.loadCollections();
      return;
    }
    await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr()]);
    if (this.snapshot.selectedLifeLinkId) {
      await this.selectLifeLink({ lifeLinkId: this.snapshot.selectedLifeLinkId, source: "human" }, false);
    }
  }

  async downloadSelectedQr(format: "svg" | "png") {
    const activeLink = resolveActiveLink(this.snapshot);
    const qrId = activeLink?.id ?? (this.snapshot.selectedLifeLinkDetail?.lifeLink.qrId === this.snapshot.activeQrId ? this.snapshot.activeQrId : null);
    if (!qrId) {
      return;
    }
    const url = activeLink?.url ?? buildQrUrl(this.snapshot.qrBaseUrl, qrId);
    if (format === "svg") {
      const svg = await QRCode.toString(url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8
      });
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${qrId}.svg`);
      return;
    }
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 10
    });
    downloadBlob(dataUrlToBlob(dataUrl), `${qrId}.png`);
  }

  downloadCsv(ids?: string[]) {
    const scoped = ids?.length
      ? ids.map((id) => this.snapshot.links.find((link) => link.id === id)).filter(Boolean)
      : this.snapshot.links;
    downloadBlob(new Blob([linksToCsv(scoped as LinkRecord[])], { type: "text/csv" }), "life-links-qr-map.csv");
  }

  downloadZip() {
    if (!this.snapshot.lastBatchId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "No hosted batch yet",
          detail: "Generate a batch first, then download the ZIP."
        }
      });
      return;
    }
    window.location.href = `/api/qr-batches/${encodeURIComponent(this.snapshot.lastBatchId)}.zip`;
  }

  private currentAgentOwnerId() {
    return this.snapshot.routeQrId === null && !this.snapshot.guestView
      ? this.snapshot.currentUser?.id ?? null
      : null;
  }

  private agentCalendarOwnerId() {
    return this.snapshot.agentConnection.connected && (this.snapshot.agentConnection.toolCatalogId === LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID || this.snapshot.agentConnection.toolCatalogId === LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID || this.snapshot.agentConnection.toolCatalogId === LIFE_LINKS_SEARCH_TOOL_CATALOG_ID)
      ? this.currentAgentOwnerId() : null;
  }

  private async readAgentCalendars(signal?: AbortSignal): Promise<AgentReadableCalendar[]> {
    const bindings = new Map<string, CalendarProviderBindingView>();
    const calendars = await readAllPages(async (cursor) => {
      const page = await this.api.listCalendars({ ...(cursor ? { cursor } : {}), limit: 100, signal, actor: "agent" });
      signal?.throwIfAborted();
      for (const binding of page.providerBindings ?? []) bindings.set(binding.calendarId, binding);
      return { items: page.calendars, nextCursor: page.nextCursor, truncated: page.truncated };
    });
    return calendars.map((calendar) => ({ ...calendar, providerBinding: bindings.get(calendar.id) }));
  }

  private async refreshCollections(navigation = this.navigationRevision, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    this.update({ collectionsLoading: true, collectionsComplete: false });
    try {
      const collections = await readAllPages(async (cursor) => {
        this.assertCommandActive(options);
        const page = await this.api.listCollections({ cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal: options.signal });
        return { ...page, items: page.collections };
      });
      this.assertCommandActive(options);
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) {
        this.update({ collections, collectionsComplete: true });
      }
      return collections;
    } finally {
      if (navigation === this.navigationRevision && ownerRevision === this.ownerRevision) this.update({ collectionsLoading: false });
    }
  }

  private async readMemberships(lifeLinkId: string, signal?: AbortSignal) {
    return readAllPages(async (cursor) => {
      const page = await this.api.listLifeLinkCollectionMemberships(lifeLinkId, { cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal });
      return { ...page, items: page.memberships };
    });
  }

  private async loadSelectedMemberships(lifeLinkId: string) {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    this.update({ selectedLifeLinkMemberships: [], membershipsLoading: true, membershipsComplete: false });
    try {
      const memberships = await this.readMemberships(lifeLinkId);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision || this.snapshot.selectedLifeLinkId !== lifeLinkId) return;
      this.update((current) => ({
        selectedLifeLinkMemberships: memberships, membershipsComplete: true,
        lifeLinkMemberships: { ...current.lifeLinkMemberships, [lifeLinkId]: memberships },
        lifeLinkMembershipsComplete: { ...current.lifeLinkMembershipsComplete, [lifeLinkId]: true }
      }));
    } catch (error) {
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision && this.snapshot.selectedLifeLinkId === lifeLinkId) {
        this.update({ error: `Collection memberships could not be fully loaded: ${messageFromError(error)}` });
      }
    } finally {
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision && this.snapshot.selectedLifeLinkId === lifeLinkId) this.update({ membershipsLoading: false });
    }
  }

  private async loadHierarchyMemberships(items: LifeLinkSummary[], isCurrent: () => boolean = () => true, signal?: AbortSignal) {
    const ownerRevision = this.ownerRevision;
    for (const item of items) {
      if (ownerRevision !== this.ownerRevision || !isCurrent()) return;
      this.update((current) => ({ lifeLinkMembershipsComplete: { ...current.lifeLinkMembershipsComplete, [item.id]: false } }));
      try {
        const memberships = await this.readMemberships(item.id, signal);
        if (ownerRevision !== this.ownerRevision || !isCurrent()) return;
        this.update((current) => ({
          lifeLinkMemberships: { ...current.lifeLinkMemberships, [item.id]: memberships },
          lifeLinkMembershipsComplete: { ...current.lifeLinkMembershipsComplete, [item.id]: true }
        }));
      } catch (error) {
        if (ownerRevision === this.ownerRevision && isCurrent()) this.update({ error: `Collection labels could not be fully loaded: ${messageFromError(error)}` });
      }
    }
  }

  private async readCollectionSections(collectionId: string, signal?: AbortSignal) {
    let collection: CollectionRecord | undefined;
    const sections = await readAllPages(async (cursor) => {
      const page = await this.api.getCollection(collectionId, { cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal });
      if (collection && collection.updatedAt !== page.collection.updatedAt) throw new Error("Collection changed while loading. Open it again to refresh.");
      collection = page.collection;
      return { items: page.sections, ...page.sectionsPage };
    });
    return { collection: collection!, sections };
  }

  async loadCollectionMemberDetails(memberIds: readonly string[]) {
    const collectionId = this.snapshot.selectedCollection?.id;
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    if (!collectionId) return;
    const isCurrent = () => ownerRevision === this.ownerRevision && navigation === this.navigationRevision
      && this.snapshot.selectedCollection?.id === collectionId;
    const members = this.snapshot.collectionMembers.filter((member) => memberIds.includes(member.id)
      && !this.snapshot.collectionMemberDetails[member.id]);
    try {
      await forEachCollectionMember(members, async (member) => {
        if (!isCurrent()) return;
        const { detail } = await this.api.getLifeLinkDetail(member.id);
        if (isCurrent()) this.update((current) => ({ collectionMemberDetails: { ...current.collectionMemberDetails, [member.id]: detail } }));
      });
    } catch (error) {
      if (isCurrent()) this.update({ error: `Collection locations could not be fully loaded: ${messageFromError(error)}` });
    }
  }

  private async readCollectionWorkspace(collectionId: string, signal?: AbortSignal, selectedId?: string | null) {
    const { collection, sections } = await this.readCollectionSections(collectionId, signal);
    const members = await readAllPages(async (cursor) => {
      const page = await this.api.listCollectionMembers(collectionId, { cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal });
      return { ...page, items: page.lifeLinks };
    });
    const details: Record<string, LifeLinkDetail> = {};
    const memberships: Record<string, LifeLinkCollectionMembership[]> = {};
    // Section membership is sufficient to display the collapsed overview. Full
    // canonical Details (including attachment metadata) load only on demand.
    await forEachCollectionMember(members, async (member) => {
      memberships[member.id] = await this.readMemberships(member.id, signal);
    });
    if (selectedId && members.some((member) => member.id === selectedId)) {
      details[selectedId] = (await this.api.getLifeLinkDetail(selectedId, { signal })).detail;
    }
    const latest = await this.api.getCollection(collectionId, { limit: 1, signal });
    if (latest.collection.updatedAt !== collection.updatedAt) throw new Error("Collection changed while loading. Open it again to refresh.");
    return { collection, sections, members, details, memberships };
  }

  private async searchCollectionsAndSections(query: string, signal?: AbortSignal) {
    const normalized = query.toLocaleLowerCase();
    const collections = await readAllPages(async (cursor) => {
      const page = await this.api.listCollections({ cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal });
      return { ...page, items: page.collections };
    });
    const results: LifeLinksWorkspaceSnapshot["collectionSearchResults"] = [];
    for (const collection of collections) {
      const { sections } = await this.readCollectionSections(collection.id, signal);
      const matchedSections = sections.filter((section) => section.title.toLocaleLowerCase().includes(normalized));
      const collectionMatches = collection.title.toLocaleLowerCase().includes(normalized);
      if (!collectionMatches && !matchedSections.length) continue;
      const members = await readAllPages(async (cursor) => {
        const page = await this.api.listCollectionMembers(collection.id, { cursor, limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal });
        return { ...page, items: page.lifeLinks };
      });
      const matchingMembers: LifeLinkRecord[] = [];
      for (const member of members) {
        if (collectionMatches) matchingMembers.push(member);
        else {
          const memberships = await this.readMemberships(member.id, signal);
          const membership = memberships.find((entry) => entry.collection.id === collection.id);
          if (membership?.sections.some((section) => matchedSections.some((matched) => matched.id === section.id))) matchingMembers.push(member);
        }
      }
      results.push({ collection, sections: matchedSections, members: matchingMembers });
    }
    return results;
  }

  private async mutateCollection(operation: (collection: CollectionRecord) => Promise<{ collection: CollectionRecord }>, target?: CollectionRecord, options: WorkspaceCommandOptions = {}) {
    const collection = target ?? this.snapshot.selectedCollection;
    if (!collection) return;
    const selectedId = this.snapshot.selectedLifeLinkId;
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    this.update({ busy: true, error: "" });
    try {
      this.assertCommandActive(options);
      const result = await operation(collection);
      this.assertCommandActive(options);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      if (this.snapshot.selectedCollection?.id !== collection.id || this.snapshot.workspaceMode !== "collections") {
        this.update({ collections: mergeById(this.snapshot.collections, [result.collection]) });
        if (selectedId) await this.loadSelectedMemberships(selectedId);
        const branch = this.snapshot.hierarchyParentId ? this.snapshot.lifeLinkChildren[this.snapshot.hierarchyParentId] : this.snapshot.rootLifeLinks;
        if (branch) await this.loadHierarchyMemberships(branch.items);
        return;
      }
      // Keep the committed revision visible if the subsequent read fails.
      this.update({ selectedCollection: result.collection, collectionComplete: false, collectionLoading: true });
      const workspace = await this.readCollectionWorkspace(collection.id, options.signal, this.snapshot.selectedLifeLinkId);
      this.assertCommandActive(options);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      this.update({ selectedCollection: workspace.collection, collectionMembers: workspace.members,
        collectionSections: workspace.sections, collectionMemberDetails: workspace.details,
        collectionMemberMemberships: workspace.memberships, collectionComplete: true,
        collections: mergeById(this.snapshot.collections, [workspace.collection]),
        lifeLinkMemberships: { ...this.snapshot.lifeLinkMemberships, ...workspace.memberships },
        lifeLinkMembershipsComplete: { ...this.snapshot.lifeLinkMembershipsComplete,
          ...Object.fromEntries(workspace.members.map((member) => [member.id, true])) }
      });
      // Reconcile the current selection without treating a refresh as a click.
      // In particular, keep mobile Back / collapsed Details and newer selections intact.
      const currentSelectedId = this.snapshot.selectedLifeLinkId;
      const selectedDetail = currentSelectedId ? workspace.details[currentSelectedId] : null;
      if (currentSelectedId && selectedDetail) {
        this.update({ selectedLifeLinkDetail: selectedDetail,
          selectedLifeLinkMemberships: workspace.memberships[currentSelectedId],
          membershipsLoading: false, membershipsComplete: true });
      } else if (currentSelectedId && this.snapshot.selectedCollection?.id === collection.id) {
        const pathname = ownerCollectionPath(collection.id);
        this.update({ selectedLifeLinkId: null, selectedLifeLinkDetail: null, selectedLifeLinkMemberships: [],
          detailsOpen: false, membershipsComplete: true, routePathname: pathname });
        if (this.route.pathname() !== pathname) this.route.push(pathname);
      }
    } catch (error) {
      // Do not retry a stale command against a silently refreshed revision.
      if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ error: messageFromError(error) });
      if (options.throwOnError) throw error;
    } finally { if (ownerRevision === this.ownerRevision && navigation === this.navigationRevision) this.update({ busy: false, collectionLoading: false }); }
  }

  private async refreshSelectedSubject(lifeLinkId: string, options: WorkspaceCommandOptions = {}) {
    this.assertCommandActive(options);
    if (this.snapshot.workspaceMode === "collections" && this.snapshot.selectedCollection) {
      await this.selectCollectionMember(lifeLinkId, false, options);
      return;
    }
    await this.selectLifeLink({ lifeLinkId, source: "route" }, false, options);
  }

  private async hydrateVisibleDetails(detail: LifeLinkDetail, signal?: AbortSignal) {
    const navigation = this.navigationRevision;
    const ownerRevision = this.ownerRevision;
    const current = () => !signal?.aborted && navigation === this.navigationRevision && ownerRevision === this.ownerRevision && this.snapshot.selectedLifeLinkId === detail.lifeLink.id;
    if (!current()) return;
    try {
      if (this.snapshot.workspaceMode === "hierarchies") {
        const parentId = detail.lifeLink.browsingRole === "container" ? detail.lifeLink.id : detail.lifeLink.parentId;
        const parent = detail.lifeLink.browsingRole === "container" ? detail : parentId
          ? (await this.api.getLifeLinkDetail(parentId, { limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, signal })).detail : null;
        if (!current()) return;
        this.update({ hierarchyParentDetail: parent });
        await this.loadLifeLinkBranch(parentId, false);
      } else {
        this.update({ collectionMemberDetails: { ...this.snapshot.collectionMemberDetails, [detail.lifeLink.id]: detail } });
      }
      if (current()) await this.loadSelectedMemberships(detail.lifeLink.id);
    } catch (error) {
      if (current()) this.update({ error: `The record is open, but its surrounding context could not be loaded: ${messageFromError(error)}` });
    }
  }

  private async mutateQrBinding(lifeLinkId: string, qrId: string | null, explicitCommand?: { commandId: string; expectedUpdatedAt: string }, options: WorkspaceCommandOptions = {}) {
    const ownerRevision = this.ownerRevision;
    const navigation = this.navigationRevision;
    const pendingKey = `${lifeLinkId}:${qrId ?? "clear"}`;
    this.update({ busy: true, error: "" });
    try {
      const detail = await this.detailForMutation(lifeLinkId);
      this.assertCommandActive(options);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      const command = explicitCommand ?? this.pendingQrBindings.get(pendingKey) ?? {
        commandId: `qr-binding-${this.commandId()}`, expectedUpdatedAt: detail.lifeLink.updatedAt
      };
      this.pendingQrBindings.set(pendingKey, command);
      const result = qrId === null
        ? await this.api.clearLifeLinkQrBinding(lifeLinkId, command.expectedUpdatedAt, command.commandId, { signal: options.signal })
        : await this.api.setLifeLinkQrBinding(lifeLinkId, qrId, command.expectedUpdatedAt, command.commandId, { signal: options.signal });
      this.assertCommandActive(options);
      if (ownerRevision === this.ownerRevision) this.pendingQrBindings.delete(pendingKey);
      if (ownerRevision !== this.ownerRevision || navigation !== this.navigationRevision) return;
      this.applyLifeLinkRecord(result.lifeLink);
      await this.refreshOwnerLibrary(this.snapshot.currentUser, options);
      await this.refreshSelectedSubject(lifeLinkId, options);
    } catch (error) {
      if (ownerRevision === this.ownerRevision) {
        // A definitive rejection did not consume the command. After an explicit
        // record refresh, a new click may use the new revision. Ambiguous
        // transport/server failures retain the original command for replay.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) this.pendingQrBindings.delete(pendingKey);
        if (navigation === this.navigationRevision) this.update({ error: messageFromError(error) });
      }
      if (options.throwOnError) throw error;
    }
    finally { if (ownerRevision === this.ownerRevision) this.update({ busy: false }); }
  }

  private pendingCreateId(key: string, prefix: string): string {
    const existing = this.pendingCreateIds.get(key);
    if (existing) return existing;
    const id = `${prefix}-${this.commandId()}`;
    this.pendingCreateIds.set(key, id);
    return id;
  }

  private assertCommandActive(options: WorkspaceCommandOptions) {
    options.signal?.throwIfAborted();
    options.assertActive?.();
  }

  private applyLifeLinkRecord(lifeLink: LifeLinkRecord) {
    const summary = (item: LifeLinkSummary) => item.id === lifeLink.id ? summarizeLifeLink(lifeLink, item.childCount) : item;
    const detail = (value: LifeLinkDetail | null): LifeLinkDetail | null => value ? {
      ...value, lifeLink: value.lifeLink.id === lifeLink.id ? lifeLink : value.lifeLink,
      ancestry: { ...value.ancestry, items: value.ancestry.items.map(summary) },
      children: value.children.map(summary)
    } : null;
    this.update((current) => ({
      selectedLifeLinkDetail: detail(current.selectedLifeLinkDetail),
      hierarchyParentDetail: detail(current.hierarchyParentDetail),
      collectionMembers: current.collectionMembers.map((item) => item.id === lifeLink.id ? lifeLink : item),
      collectionMemberDetails: Object.fromEntries(Object.entries(current.collectionMemberDetails).map(([id, value]) => [id, detail(value)!])),
      rootLifeLinks: { ...current.rootLifeLinks, items: current.rootLifeLinks.items.map(summary) },
      lifeLinkChildren: Object.fromEntries(Object.entries(current.lifeLinkChildren).map(([id, branch]) => [id, { ...branch, items: branch.items.map(summary) }])),
      ...(current.selectedLifeLinkId === lifeLink.id ? { activeQrId: lifeLink.qrId } : {})
    }));
  }

  private applySelectedLifeLinkDetail(detail: LifeLinkDetail, updateHistory: boolean, preserveCollection = false, detailsOpen = true) {
    const collection = preserveCollection ? this.snapshot.selectedCollection : null;
    const pathname = collection ? ownerCollectionPath(collection.id, detail.lifeLink.id) : ownerLifeLinkPath(detail.lifeLink.id);
    this.update((current) => ({
      workspaceMode: collection ? "collections" : "hierarchies",
      selectedCollection: collection,
      detailsOpen,
      ...(collection ? {} : {
        hierarchyParentId: detail.lifeLink.browsingRole === "container" ? detail.lifeLink.id : detail.lifeLink.parentId,
        hierarchyParentDetail: detail.lifeLink.browsingRole === "container" ? detail : current.hierarchyParentDetail
      }),
      activeView: "workspace",
      activeQrId: detail.lifeLink.qrId,
      publicQrState: null,
      routePathname: pathname,
      routeQrId: null,
      routeLifeLinkId: collection ? null : detail.lifeLink.id,
      selectedLifeLinkId: detail.lifeLink.id,
      selectedLifeLinkDetail: detail,
      highlightedLifeLinkId: detail.lifeLink.id,
      expandedLifeLinkIds: mergeIds(
        current.expandedLifeLinkIds,
        detail.ancestry.items.slice(0, -1).map((item) => item.id)
      ),
      ...mergeDetailIntoHierarchy(current, detail)
    }));
    if (updateHistory && this.route.pathname() !== pathname) {
      this.route.push(pathname);
    }
  }

  private async boot(lifecycle: number) {
    try {
      const [config, me] = await Promise.all([this.api.getConfig(), this.api.getMe()]);
      if (!this.isCurrent(lifecycle)) {
        return;
      }
      const routePathname = this.route.pathname();
      const routeState = classifyLifeLinksRoute(routePathname, Boolean(me.user));
      this.update({
        qrBaseUrl: me.qrBaseUrl || config.qrBaseUrl,
        currentUser: me.user,
        agentConnection: me.agentConnection,
        routePathname,
        routeQrId: routeState.qrId,
        routeLifeLinkId: routeState.lifeLinkId
      });

      if (me.user && routeState.surface !== "public-qr" &&
          !isCollectionsPath(routePathname) && !isRoutinesPath(routePathname) && !isCalendarPath(routePathname)) {
        await this.refreshOwnerLibrary(me.user);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
      }
      if (routeState.surface === "public-qr") {
        const publicQrState = await readQrState(this.api, routeState.qrId);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
        this.update({
          activeQrId: routeState.qrId,
          activeView: "scan",
          publicQrState,
          scanMessage: { tone: "neutral", title: "QR opened", detail: routeState.qrId }
        });
      } else if (routeState.surface === "owner-workspace") {
        await this.restoreOwnerRoute(routePathname);
      }
    } catch (bootError) {
      if (this.isCurrent(lifecycle)) {
        this.update({ error: messageFromError(bootError) });
      }
    } finally {
      if (this.isCurrent(lifecycle)) {
        this.update({ loading: false });
      }
    }
  }

  private async handlePopState() {
    const routePathname = this.route.pathname();
    const routeState = classifyLifeLinksRoute(routePathname, Boolean(this.snapshot.currentUser));
    this.update({
      routePathname,
      routeQrId: routeState.qrId,
      routeLifeLinkId: routeState.lifeLinkId
    });
    if (routeState.surface === "public-qr") {
      await this.openQr(routeState.qrId, false);
      return;
    }
    if (routeState.surface === "owner-workspace") {
      await this.restoreOwnerRoute(routePathname);
      return;
    }
    this.update({
      publicQrState: null,
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      highlightedLifeLinkId: null,
      activeView: "home"
    });
  }

  private async restoreOwnerRoute(pathname: string) {
    if (isCalendarPath(pathname)) {
      const eventId = calendarEventIdFromPath(pathname);
      if (eventId) await this.openCalendarEvent(eventId, false);
      else await this.openCalendar(false);
      return;
    }
    if (isRoutinesPath(pathname)) {
      const routineId = routineIdFromPath(pathname);
      if (routineId) await this.openRoutine(routineId, false);
      else await this.openRoutines(false);
      return;
    }
    if (isCollectionsPath(pathname)) {
      const collectionId = collectionIdFromPath(pathname);
      if (collectionId) await this.openCollection(collectionId, collectionMemberIdFromPath(pathname) ?? undefined, false);
      else await this.openCollections(false);
      return;
    }
    const route = classifyLifeLinksRoute(pathname, true);
    if (route.lifeLinkId) {
      await this.openHierarchy(route.lifeLinkId, false);
      return;
    }
    if (pathname === "/life-links" || pathname === "/life-links/") {
      await this.openHierarchy(null, false);
      return;
    }
    ++this.navigationRevision;
    this.update({ workspaceMode: "hierarchies", hierarchyParentId: null, hierarchyParentDetail: null,
      selectedCollection: null, selectedLifeLinkId: null, selectedLifeLinkDetail: null,
      detailsOpen: false, publicQrState: null, activeView: "home" });
  }

  private async loadLifeLinkBranch(parentId: string | null, append: boolean, propagateError = false,
    options: { signal?: AbortSignal; isCurrent?: () => boolean } = {}) {
    const ownerRevision = this.ownerRevision;
    const current = () => ownerRevision === this.ownerRevision && !options.signal?.aborted && (options.isCurrent?.() ?? true);
    if (!current()) return;
    const currentBranch = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
    if (append && !currentBranch?.nextCursor) {
      return;
    }
    const loadingBranch = {
      ...(currentBranch ?? emptyLifeLinkBranch()),
      loading: true
    };
    this.setBranch(parentId, loadingBranch);
    try {
      const result = await this.api.listLifeLinks({
        parentId,
        cursor: append ? currentBranch?.nextCursor : null,
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
        ...(options.signal ? { signal: options.signal } : {})
      });
      if (!current()) return;
      const latest = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
      const preserveKnownPath = !append && !currentBranch?.loaded && Boolean(currentBranch?.items.length);
      const nextBranch = branchFromPage(result, append ? latest : undefined);
      this.setBranch(parentId, preserveKnownPath
        ? { ...nextBranch, items: mergeSummaries(nextBranch.items, latest.items) }
        : nextBranch);
      await this.loadHierarchyMemberships(result.lifeLinks, current, options.signal);
    } catch (branchError) {
      if (!current()) return;
      this.setBranch(parentId, {
        ...(parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks),
        loading: false
      });
      this.update({ error: messageFromError(branchError) });
      if (propagateError) {
        throw branchError;
      }
    } finally {
      const latest = parentId === null ? this.snapshot.rootLifeLinks : this.snapshot.lifeLinkChildren[parentId];
      if (latest === loadingBranch) this.setBranch(parentId, { ...latest, loading: false });
    }
  }

  private setBranch(parentId: string | null, branch: LifeLinkBranchState) {
    if (parentId === null) {
      this.update({ rootLifeLinks: branch });
      return;
    }
    this.update((current) => ({
      lifeLinkChildren: { ...current.lifeLinkChildren, [parentId]: branch }
    }));
  }

  private async detailForMutation(lifeLinkId: string): Promise<LifeLinkDetail> {
    if (this.snapshot.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId) {
      return this.snapshot.selectedLifeLinkDetail;
    }
    return (await this.api.getLifeLinkDetail(lifeLinkId, { limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT })).detail;
  }

  private async refreshChangedBranches(previousParentId: string | null, nextParentId: string | null) {
    const parents = Array.from(new Set([previousParentId, nextParentId]));
    for (const parentId of parents) {
      await this.loadLifeLinkBranch(parentId, false, true);
    }
  }

  private async refreshParentHierarchySummaries(parentIds: Array<string | null>) {
    for (const parentId of Array.from(new Set(parentIds)).filter((id): id is string => Boolean(id))) {
      const { detail } = await this.api.getLifeLinkDetail(parentId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT
      });
      this.update((current) => mergeDetailIntoHierarchy(current, detail));
    }
  }

  private isCurrent(lifecycle: number) {
    return this.active && this.lifecycle === lifecycle;
  }

  private updateRoutineWorkspace(
    patch: Partial<RoutineWorkspaceState> | ((current: RoutineWorkspaceState) => Partial<RoutineWorkspaceState>)
  ) {
    this.update((current) => {
      const routinePatch = typeof patch === "function" ? patch(current.routineWorkspace) : patch;
      return { routineWorkspace: { ...current.routineWorkspace, ...routinePatch } };
    });
  }

  private updateCalendarWorkspace(
    patch: Partial<CalendarWorkspaceState> | ((current: CalendarWorkspaceState) => Partial<CalendarWorkspaceState>)
  ) {
    this.update((current) => {
      const calendarPatch = typeof patch === "function" ? patch(current.calendarWorkspace) : patch;
      return { calendarWorkspace: { ...current.calendarWorkspace, ...calendarPatch } };
    });
  }

  private captureCalendarOwner(): () => boolean {
    const ownerId = this.snapshot.currentUser?.id;
    const ownerRevision = this.ownerRevision;
    return () => Boolean(ownerId) && ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id;
  }

  private captureRoutineOwner(): () => boolean {
    const ownerId = this.snapshot.currentUser?.id;
    const ownerRevision = this.ownerRevision;
    return () => Boolean(ownerId) && ownerRevision === this.ownerRevision && ownerId === this.snapshot.currentUser?.id;
  }

  private async loadRoutineRevisionSnapshots(
    references: Array<{ routineId: string; routineRevisionId: string }>, signal?: AbortSignal,
    known?: RoutineRevisionSnapshot
  ): Promise<Record<string, RoutineRevisionSnapshot>> {
    const sameOwner = this.captureRoutineOwner();
    const current = this.snapshot.routineWorkspace;
    const snapshots = { ...current.revisionsById };
    for (const revision of [current.selectedRoutine?.currentRevision, current.selectedSessionRevision, known]) {
      if (revision) snapshots[revision.revision.id] = revision;
    }
    const missing = [...new Map(references.filter((reference) =>
      snapshots[reference.routineRevisionId]?.revision.routineId !== reference.routineId
    ).map((reference) => [reference.routineRevisionId, reference])).values()];
    for (let offset = 0; offset < missing.length; offset += 4) {
      await Promise.all(missing.slice(offset, offset + 4).map(async (reference) => {
        signal?.throwIfAborted();
        if (!sameOwner()) return;
        const { routineRevision } = await this.api.getRoutineRevision(reference.routineId, reference.routineRevisionId, signal);
        signal?.throwIfAborted();
        if (!sameOwner()) return;
        if (routineRevision.revision.id !== reference.routineRevisionId || routineRevision.revision.routineId !== reference.routineId) {
          throw new Error("The saved Routine revision could not be verified.");
        }
        snapshots[routineRevision.revision.id] = routineRevision;
      }));
      if (!sameOwner()) return {};
    }
    return snapshots;
  }

  private clearSelectedRoutinePlanningState(routineId: string) {
    ++this.routineOccurrenceListRevision;
    this.updateRoutineWorkspace((current) => current.selectedRoutine?.routine.id === routineId
      ? { schedules: [], schedulesNextCursor: null, occurrences: [], occurrencesNextCursor: null }
      : {});
  }

  private async refreshSelectedRoutineOperationalState(
    routineId: string,
    selectionRevision: number,
    signal: AbortSignal | undefined,
    includeSchedules: boolean
  ) {
    const sameOwner = this.captureRoutineOwner();
    const occurrenceRevision = ++this.routineOccurrenceListRevision;
    const [occurrences, schedules] = await Promise.all([
      this.api.listRoutineOccurrences({ routineId, signal }),
      includeSchedules ? this.api.listRoutineSchedules(routineId, { signal }) : Promise.resolve(null)
    ]);
    signal?.throwIfAborted();
    if (!sameOwner() || selectionRevision !== this.routineSelectionRevision ||
        occurrenceRevision !== this.routineOccurrenceListRevision ||
        this.snapshot.routineWorkspace.selectedRoutine?.routine.id !== routineId) return;
    this.updateRoutineWorkspace({
      occurrences: occurrences.occurrences,
      occurrencesNextCursor: occurrences.nextCursor,
      ...(schedules ? { schedules: schedules.schedules, schedulesNextCursor: schedules.nextCursor } : {}),
      error: ""
    });
  }

  private update(
    patch:
      | Partial<LifeLinksWorkspaceSnapshot>
      | ((current: LifeLinksWorkspaceSnapshot) => Partial<LifeLinksWorkspaceSnapshot>)
  ) {
    const next = typeof patch === "function" ? patch(this.snapshot) : patch;
    const finishedMutation = this.snapshot.busy && next.busy === false;
    const loadedOwner = !this.snapshot.currentUser && next.currentUser;
    const ownerChanged = next.currentUser !== undefined && next.currentUser?.id !== this.snapshot.currentUser?.id;
    const previous = this.snapshot;
    let updated = { ...previous, ...next };
    const expansion = this.hierarchyExpansion;
    if (expansion && (ownerChanged || expansion.ownerRevision !== this.ownerRevision || expansion.navigation !== this.navigationRevision ||
        updated.workspaceMode !== "hierarchies" || updated.activeView !== "workspace" || updated.guestView || updated.routeQrId || updated.busy ||
        updated.hierarchyParentId !== expansion.parentId)) {
      this.hierarchyExpansion = null;
      expansion.abort.abort();
      updated.hierarchyExpanding = false;
    }
    if (ownerChanged || (previous.activeView === "search" && updated.activeView !== "search")) {
      ++this.recordSearchRevision;
      for (const request of this.recordSearchRequests.values()) request.abort();
      this.recordSearchRequests.clear();
      updated.recordSearch = ownerChanged ? emptyRecordSearch() : { ...updated.recordSearch, groups: Object.fromEntries(
        RECORD_SEARCH_CATEGORIES.map((category) => {
          const group = updated.recordSearch.groups[category];
          return [category, group.loading ? { ...group, loading: false, error: "Search paused. Continue to finish checking this category." } : group];
        })
      ) as typeof updated.recordSearch.groups };
      if (ownerChanged) {
        updated.recordSearchTarget = null;
        updated.lifeLinkSearchQuery = "";
        updated.lifeLinkSearchResults = [];
      }
    }
    if (ownerChanged || updated.routeQrId !== previous.routeQrId || updated.guestView !== previous.guestView ||
        updated.agentConnection.connected !== previous.agentConnection.connected || updated.agentConnection.toolCatalogId !== previous.agentConnection.toolCatalogId ||
        updated.agentConnection.connectedAt !== previous.agentConnection.connectedAt ||
        (updated.canonicalEditingId !== null && updated.canonicalEditingId !== previous.canonicalEditingId)) {
      this.invalidateWorkspaceAgentChanges();
      updated.agentWorkspaceChangeConfirmation = null;
    }
    if (ownerChanged) {
      this.pendingWorkspaceResume = null;
      updated = { ...updated, presentation: emptyWorkspacePresentation(), middleCollapsed: false,
        expandedLifeLinkIds: [], routineWorkspace: { ...updated.routineWorkspace, presentation: emptyRoutineWorkspaceState().presentation } };
    }
    // One content pane must remain available. Explicitly closing Details restores the middle pane.
    if (updated.middleCollapsed && !updated.detailsOpen) updated.middleCollapsed = false;
    if (updated.currentUser && !updated.routeQrId && updated.activeView === "workspace") {
      const peer = updated.workspaceMode;
      const pathname = workspaceBookmarkPath(peer, updated.routePathname);
      if (pathname) {
        const remembered = updated.presentation.peers[peer];
        if (peer === "routines" && remembered.pathname !== pathname) {
          updated.presentation = { ...updated.presentation, routineDetails: { kind: "routine", sessionId: null } };
        }
        updated.presentation = { ...updated.presentation, peers: { ...updated.presentation.peers, [peer]: {
          ...remembered, pathname, middleCollapsed: updated.middleCollapsed, detailsOpen: updated.detailsOpen,
          ...(remembered.pathname !== pathname ? { middleScrollTop: 0, detailsScrollTop: 0 } : {})
        } } };
      }
    }
    this.snapshot = updated;
    for (const listener of this.listeners) {
      listener();
    }
    if ((finishedMutation || loadedOwner) && this.snapshot.currentUser && !this.snapshot.routeQrId) {
      // getChangeHistory owns revision-safe invalidation on failure.
      void this.getChangeHistory().catch(() => undefined);
    }
  }
}

function emptyLifeLinkBranch(): LifeLinkBranchState {
  return { items: [], nextCursor: null, truncated: false, loaded: false, loading: false };
}

function emptyFieldLedgerState() {
  return {
    recordSearch: emptyRecordSearch(), recordSearchTarget: null,
    presentation: emptyWorkspacePresentation(), middleCollapsed: false,
    changeHistory: { limit: 5 as const, entries: [] }, agentChangeConfirmation: null, agentWorkspaceChangeConfirmation: null,
    agentCalendarDeletionConfirmation: null,
    workspaceMode: "hierarchies" as const, hierarchyParentId: null, hierarchyParentDetail: null, hierarchyExpanding: false,
    detailsOpen: false, collections: [], collectionsLoading: false, collectionsComplete: false,
    selectedCollection: null, collectionMembers: [], collectionSections: [], collectionMemberMemberships: {},
    collectionMemberDetails: {}, collectionLoading: false, collectionComplete: false,
    selectedLifeLinkMemberships: [], membershipsLoading: false, membershipsComplete: false,
    lifeLinkMemberships: {}, lifeLinkMembershipsComplete: {}, collectionSearchResults: [], collectionSearchComplete: false,
    routineWorkspace: emptyRoutineWorkspaceState(),
    calendarWorkspace: emptyCalendarWorkspaceState()
  };
}

function workspaceRootPath(peer: WorkspacePeer): string {
  return peer === "hierarchies" ? "/life-links" : `/${peer}`;
}

function workspaceBookmarkPath(peer: WorkspacePeer, pathname: string): string | null {
  const base = pathname.split("?")[0];
  if (peer === "hierarchies") return base === "/life-links" || lifeLinkIdFromPath(base) ? base : null;
  if (peer === "collections") {
    if (!isCollectionsPath(base)) return null;
    const id = collectionIdFromPath(base);
    return id ? ownerCollectionPath(id, collectionMemberIdFromPath(pathname) ?? undefined) : "/collections";
  }
  if (peer === "routines") return isRoutinesPath(base) ? base : null;
  if (!isCalendarPath(base)) return null;
  const eventId = calendarEventIdFromPath(base);
  if (!eventId) return "/calendar"; // OAuth drafts and callback errors are never navigation bookmarks.
  const query = new URLSearchParams(pathname.split("?")[1] ?? "");
  if (query.get("authority") === "provider" && query.get("connectionId") && query.get("calendarId")) {
    return `${ownerCalendarEventPath(eventId)}?${new URLSearchParams({ authority: "provider", connectionId: query.get("connectionId")!, calendarId: query.get("calendarId")! })}`;
  }
  return ownerCalendarEventPath(eventId);
}

function emptyWorkspacePresentation(): WorkspacePresentation {
  const peer = () => ({ pathname: null, middleCollapsed: false, detailsOpen: false, middleScrollTop: 0, detailsScrollTop: 0 });
  return {
    peers: { hierarchies: peer(), collections: peer(), routines: peer(), calendar: peer() },
    collections: {},
    calendar: { view: "month", timeZone: null, anchorDate: null, selectedDate: null, hiddenNativeCalendarIds: [], selectedEventKey: null },
    routineDetails: { kind: "routine", sessionId: null },
    restoreRevision: 0
  };
}

function emptyRoutineWorkspaceState(): RoutineWorkspaceState {
  return {
    revisionsById: {},
    presentation: { tab: "routines", historyRoutineId: null, showRemoved: false, collapsedGroupIds: [] },
    history: { routineId: null, sessions: [], nextCursor: null, loaded: false, loading: false, error: "" },
    groups: [], groupsNextCursor: null, activities: [], activitiesNextCursor: null,
    routines: [], routinesNextCursor: null, selectedRoutine: null,
    schedules: [], schedulesNextCursor: null, occurrences: [], occurrencesNextCursor: null,
    calendarOccurrences: [], calendarRange: null, calendarLoading: false, calendarError: "",
    activeRun: null, sessions: [], sessionsNextCursor: null, selectedSession: null, selectedSessionRevision: null,
    includeArchived: false, loading: false, error: ""
  };
}

function emptyCalendarWorkspaceState(): CalendarWorkspaceState {
  return {
    connectionFlow: { authorizationId: null, connectionId: null, discovery: null, loading: false, error: "", feedback: "" },
    connectionManagement: { providers: [], connections: [], calendars: [], loading: false, loaded: false, error: "" },
    clock: null,
    calendars: [], calendarsNextCursor: null, calendarsComplete: false,
    providerBindings: [], providerEvents: [], selectedProviderEvent: null,
    events: [], eventsNextCursor: null, eventsComplete: false, range: null,
    selectedEvent: null, latestTombstone: null, loading: false, error: ""
  };
}

/** Bound network concurrency without serializing a Collection's entire index. */
async function forEachCollectionMember<T>(items: readonly T[], visit: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await visit(item);
    }
  }));
}

/** Exhaust every cursor; an interrupted/invalid page is not an exhaustive result. */
async function readAllPages<T>(read: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null; truncated: boolean }>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await read(cursor);
    items.push(...page.items);
    if (page.truncated && !page.nextCursor) throw new Error("The server returned an incomplete list without a continuation cursor.");
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("The server repeated a continuation cursor; the list is incomplete.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const records = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) records.set(item.id, item);
  return [...records.values()];
}

function mergeCalendarEvents(
  existing: CalendarWorkspaceState["events"], incoming: CalendarWorkspaceState["events"]
): CalendarWorkspaceState["events"] {
  const records = new Map(existing.map((item) => [item.event.id, item]));
  for (const item of incoming) records.set(item.event.id, item);
  return [...records.values()];
}

function routineSummaryFromDetail(detail: CanonicalRoutineCreation) {
  return {
    ...detail.routine,
    revisionNumber: detail.currentRevision.revision.revisionNumber,
    title: detail.currentRevision.revision.title,
    purpose: detail.currentRevision.revision.purpose
  };
}

function mergeRoutineSessions(
  existing: RoutineSessionProjection[], incoming: RoutineSessionProjection[]
): RoutineSessionProjection[] {
  const records = new Map(existing.map((item) => [item.session.id, item]));
  for (const item of incoming) records.set(item.session.id, item);
  return [...records.values()];
}

function branchFromPage(
  page: { lifeLinks: LifeLinkSummary[]; nextCursor: string | null; truncated: boolean },
  current?: LifeLinkBranchState
): LifeLinkBranchState {
  return {
    items: current ? mergeSummaries(current.items, page.lifeLinks) : page.lifeLinks,
    nextCursor: page.nextCursor,
    truncated: page.truncated,
    loaded: true,
    loading: false
  };
}

function mergeDetailIntoHierarchy(
  current: LifeLinksWorkspaceSnapshot,
  detail: LifeLinkDetail
): Pick<LifeLinksWorkspaceSnapshot, "rootLifeLinks" | "lifeLinkChildren"> {
  const ancestry = detail.ancestry.items;
  let rootLifeLinks = current.rootLifeLinks;
  const lifeLinkChildren = { ...current.lifeLinkChildren };
  const first = ancestry[0];
  if (first?.parentId === null) {
    rootLifeLinks = {
      ...rootLifeLinks,
      items: mergeSummaries(rootLifeLinks.items, [first])
    };
  }
  for (let index = 1; index < ancestry.length; index += 1) {
    const parent = ancestry[index - 1];
    const child = ancestry[index];
    if (child.parentId !== parent.id) {
      continue;
    }
    const existing = lifeLinkChildren[parent.id] ?? emptyLifeLinkBranch();
    lifeLinkChildren[parent.id] = {
      ...existing,
      items: mergeSummaries(existing.items, [child])
    };
  }
  lifeLinkChildren[detail.lifeLink.id] = {
    items: detail.children,
    nextCursor: detail.childrenPage.nextCursor,
    truncated: detail.childrenPage.truncated,
    loaded: true,
    loading: false
  };
  return { rootLifeLinks, lifeLinkChildren };
}

function mergeSummaries(current: LifeLinkSummary[], additions: LifeLinkSummary[]): LifeLinkSummary[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of additions) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function mergeSearchResults(current: LifeLinkSearchItem[], additions: LifeLinkSearchItem[]) {
  const byId = new Map(current.map((item) => [item.lifeLink.id, item]));
  for (const item of additions) {
    byId.set(item.lifeLink.id, item);
  }
  return Array.from(byId.values());
}

function mergeIds(current: string[], additions: string[]) {
  return Array.from(new Set([...current, ...additions]));
}

function resolveActiveLink(snapshot: LifeLinksWorkspaceSnapshot): LinkRecord | null {
  const ownedOrInventory = snapshot.activeQrId
    ? snapshot.links.find((link) => link.id === snapshot.activeQrId) ?? null
    : null;
  if (ownedOrInventory) {
    return ownedOrInventory;
  }
  if (snapshot.publicQrState?.state === "claimed") {
    return snapshot.publicQrState.link;
  }
  if (snapshot.publicQrState?.state === "unclaimed") {
    return snapshot.publicQrState.qr;
  }
  return null;
}

function boundedInventoryPage(page: number, filter: InventoryFilter, links: LinkRecord[]) {
  const filtered = links.filter((link) => {
    if (filter === "claimed") {
      return link.status === "claimed";
    }
    if (filter === "unclaimed") {
      return link.status === "unclaimed";
    }
    return true;
  });
  return Math.min(page, Math.max(0, Math.ceil(filtered.length / 24) - 1));
}

async function readQrState(api: LifeLinksWorkspaceApi, qrId: string): Promise<QrViewState> {
  try {
    return await api.getQr(qrId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { state: "not_found", qrId };
    }
    throw error;
  }
}

function sameProviderReference(reference: Pick<ProviderCalendarEventReference, "connectionId" | "calendarId" | "providerEventId">, event: CalendarProviderEventProjection): boolean {
  return reference.connectionId === event.connectionId && reference.calendarId === event.calendarId && reference.providerEventId === event.providerEventId;
}

function mergeProviderEvents(existing: CalendarProviderEventProjection[], incoming: CalendarProviderEventProjection[]): CalendarProviderEventProjection[] {
  const merged = [...existing];
  for (const entry of incoming) {
    const index = merged.findIndex((current) => sameProviderReference(entry, current));
    if (index < 0) merged.push(entry); else merged[index] = entry;
  }
  return merged;
}

type AgentReadableCalendar = CalendarRecord & { providerBinding?: CalendarProviderBindingView };

function providerEventMatchesCalendar(event: CalendarProviderEventProjection, calendar: AgentReadableCalendar): boolean {
  const binding = calendar.providerBinding;
  return Boolean(binding && event.ownerId === calendar.ownerId && event.calendarId === calendar.id &&
    event.connectionId === binding.connectionId && event.providerKey === binding.providerKey &&
    event.providerAccountId === binding.providerAccountId && event.providerCalendarId === binding.providerCalendarId);
}

function agentCanWriteProviderCalendar(calendar: AgentReadableCalendar, ownerId: string, connectionId: string, operation: "create" | "update" | "delete"): boolean {
  return agentCanReadCalendar(calendar, ownerId) && calendar.source === "external" && calendar.agentAccess === "write" &&
    calendar.providerBinding?.connectionId === connectionId && calendar.providerBinding.capabilities[operation];
}

function agentCanReadCalendar(calendar: AgentReadableCalendar, ownerId: string): boolean {
  return calendar.ownerId === ownerId && (calendar.source === "native" || Boolean(calendar.providerBinding?.capabilities.read)) && calendar.deletedAt === null &&
    (calendar.agentAccess === "read" || calendar.agentAccess === "write");
}

function agentCalendarRecord(calendar: AgentReadableCalendar): AgentCalendarRecord {
  const binding = calendar.providerBinding;
  const writable = !binding || binding.capabilities.create || binding.capabilities.update || binding.capabilities.delete;
  return {
    id: calendar.id,
    title: calendar.title,
    timeZone: calendar.timeZone,
    provider: binding ? binding.providerKey === "microsoft-graph-calendar" ? "microsoft" : binding.providerKey === "google-calendar" ? "google" : "caldav" : "life_links",
    providerConnectionId: binding?.connectionId ?? null,
    providerAccountId: binding?.providerAccountId ?? null,
    providerCalendarId: binding?.providerCalendarId ?? null,
    writeAuthority: binding ? writable ? "provider" : "read_only" : "life_links",
    humanAccess: writable ? "write" : "read",
    agentAccess: calendar.agentAccess,
    isDefault: calendar.isDefault,
    updatedAt: calendar.updatedAt,
    ...(binding ? { providerKey: binding.providerKey, capabilities: binding.capabilities } : {})
  };
}

function agentCalendarEventDetail(detail: CalendarEventDetail, calendar: CalendarRecord): AgentCalendarEventDetail {
  return { event: detail.event, currentRevision: detail.currentRevision, calendar: agentCalendarRecord(calendar) };
}

function encodeCalendarAgentCursor(kind: "calendars" | "events", offset: number): string {
  return `calendar-agent-${kind}-${offset}`;
}

function decodeCalendarAgentCursor(cursor: string | undefined, kind: "calendars" | "events"): number | null {
  if (cursor === undefined) return 0;
  const match = new RegExp(`^calendar-agent-${kind}-(\\d+)$`).exec(cursor);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function calendarAgentInstanceSortKey(entry: AgentCalendarEventInstance): string {
  if (entry.source === "routine_projection") return entry.occurrence.plannedFor;
  if (entry.source === "provider_event") return entry.providerEvent.content.span.kind === "all_day" ? `${entry.providerEvent.content.span.startDate}T00:00:00` : entry.providerEvent.content.span.startUtc;
  const span = entry.instance.span;
  return span.kind === "all_day" ? `${span.startDate}T00:00:00` : span.startInstant;
}

function calendarAgentInstanceId(entry: AgentCalendarEventInstance): string {
  if (entry.source === "provider_event") return JSON.stringify([entry.providerEvent.connectionId, entry.providerEvent.calendarId, entry.providerEvent.providerEventId]);
  return entry.source === "routine_projection" ? `routine:${entry.occurrence.id}` : entry.instance.instanceId;
}

function sameCalendarEditTarget(target: CalendarEventEditTargetInput, event: CalendarEventRecord): boolean {
  if (target.scope === "event") return event.lineage.kind !== "recurrence_master" && target.eventId === event.id;
  if (target.scope === "series") return event.lineage.kind === "recurrence_master" && target.masterEventId === event.id;
  return false;
}

function calendarDeletionEffects(
  detail: AgentCalendarEventDetail,
  target: CalendarEventEditTargetInput
): readonly string[] {
  const effects = [target.scope === "series"
    ? "The whole recurring series and its generated occurrences will leave active Calendar views."
    : "This exact Calendar event will leave active Calendar views."];
  if (detail.currentRevision.subjectLinks.length) {
    effects.push(`${detail.currentRevision.subjectLinks.length} context link${detail.currentRevision.subjectLinks.length === 1 ? "" : "s"} will remain attached to the restorable deleted revision.`);
  }
  effects.push("The event is soft-deleted and its exact last revision can be restored from Life Links.");
  return effects;
}

function calendarAgentReadFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: "calendar_unavailable" | "calendar_event_unavailable"
) {
  if (signal?.aborted || isAbortError(error)) return { ok: false as const, code: "cancelled" as const };
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return { ok: false as const, code: fallback };
  return { ok: false as const, code: "effect_not_applied" as const };
}

function calendarAgentWriteFailure(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: "calendar_unavailable" | "calendar_event_unavailable"
) {
  if (signal?.aborted || isAbortError(error)) return { ok: false as const, code: "cancelled" as const };
  if (error instanceof ApiError) {
    if (error.code === "stale_calendar_event" || error.status === 409) {
      return { ok: false as const, code: "stale_calendar_event" as const };
    }
    if ([401, 403, 404].includes(error.status)) return { ok: false as const, code: fallback };
    if (error.status === 400 && error.reason === "unsupported_recurrence_scope") {
      return { ok: false as const, code: "unsupported_calendar_authority" as const };
    }
  }
  return { ok: false as const, code: "effect_not_applied" as const };
}

function agentReadFailure(
  error: unknown,
  fallbackCode: "life_link_unavailable" | "source_life_link_unavailable"
): AgentToolControllerActionResult {
  if (isAbortError(error)) {
    return { ok: false, code: "cancelled" };
  }
  if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
    return { ok: false, code: fallbackCode };
  }
  throw error;
}

class AgentCommandError extends Error {
  constructor(readonly code: Exclude<AgentToolControllerActionResult, { ok: true }>["code"]) {
    super(code);
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function initialTheme(): ThemeMode {
  try {
    return window.localStorage.getItem("life-links-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, encoded] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_credentials") {
      return "Invalid email or password.";
    }
    if (error.code === "auth_required") {
      return "Log in to continue.";
    }
    if (error.code === "owned_by_other") {
      return "That QR code is already claimed by another account.";
    }
    if (error.code === "media_file_too_large") {
      return "Media files must be 25 MB or smaller.";
    }
    if (error.code === "media_type_not_allowed") {
      return "Use an image or video file type supported by Life Links.";
    }
    if (error.code === "media_limit_reached") {
      return "This link already has the maximum number of media attachments.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
