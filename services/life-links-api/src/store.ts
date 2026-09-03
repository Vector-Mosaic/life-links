import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { currentRemoteAgentPrincipal, remoteAgentScopeAllows } from "./remote-agent-principal.js";

import {
  CHANGE_HISTORY_LIMIT, resolveLifeLinkChangeScope, lifeLinkChangePreviewItem, stableChangeFingerprint,
  type PreviewLifeLinkChangeInput, type LifeLinkChangePreview, type ApplyLifeLinkChangeInput,
  type UndoChangeInput, type ChangeHistory, type ChangeHistoryEntry, type LifeLinkChangeResult,
  planCollectionChange, type CollectionChangeInput, type CollectionChangePreview, type CollectionChangeResult, type CollectionChangeState,
  type ClaimQrCommand,
  type ClaimResult,
  type ClearLifeLinkQrBindingCommand,
  type CollectionMemberCommand,
  type CollectionMembershipRecord,
  type CollectionRecord,
  type CollectionSectionAssignmentRecord,
  type CollectionSectionMutationResult,
  type CollectionSectionRecord,
  type CompetitionFixtureData,
  type CreateCollectionCommand,
  type CreateCollectionSectionCommand,
  type CreateLifeLinkCommand,
  type ExportBatchRecord,
  type LifeLinkDetail,
  type LifeLinkCollectionMembership,
  LifeLinkDomainError,
  type LifeLinkMediaRecord,
  type LifeLinkPage,
  type LifeLinkPageRequest,
  type LifeLinkQrBindingRecord,
  type LifeLinkRecord,
  type LifeLinkSearchResult,
  type LifeLinkSummary,
  type LinkBodyDoc,
  type LinkMediaKind,
  type LinkMediaRecord,
  type LinkRecord,
  type MoveLifeLinkCommand,
  type PrivacyStatus,
  type QrInventoryRecord,
  type QrViewState,
  type RemoveCollectionSectionCommand,
  type ReplaceCollectionSectionAssignmentsCommand,
  type SetLifeLinkQrBindingCommand,
  type UpdateCollectionCommand,
  type UpdateCollectionSectionCommand,
  type UpdateLifeLinkCommand,
  type UserRecord,
  type ActivityRecord,
  type AppendRoutineSessionAmendmentCommand,
  type BuiltRoutineSession,
  type CanonicalRoutineCreation,
  type CreateActivityCommand,
  type CreateRoutineCommand,
  type CreateRoutineGroupCommand,
  type CreateRoutineScheduleCommand,
  type PutRoutineRunStepResultCommand,
  type ReviseRoutineCommand,
  type RoutineContextBindingRecord,
  type RoutineContextSnapshot,
  type RoutineGroupRecord,
  type RoutineOccurrenceRecord,
  type RoutineRecord,
  type RoutineRevisionRecord,
  type RoutineRevisionSnapshot,
  type RoutineRunRecord,
  type RoutineScheduleRecord,
  type RoutineSummaryRecord,
  type RoutineSessionAmendmentRecord,
  type RoutineSessionProjection,
  type RoutineSessionRecord,
  type RoutineSessionStepResultRecord,
  type RoutineStepRecord,
  type StartRoutineRunCommand,
  type UpdateActivityCommand,
  type UpdateRoutineCommand,
  type UpdateRoutineGroupCommand,
  type UpdateRoutineScheduleCommand,
  type FinalizeRoutineRunCommand,
  type CalendarRecord,
  type CalendarActor,
  type CalendarEventRecord,
  type CalendarEventRevisionRecord,
  type CalendarEventTombstoneRecord,
  type CreateCalendarCommand,
  type UpdateCalendarCommand,
  type SoftDeleteCalendarCommand,
  type RestoreCalendarCommand,
  type CanonicalCalendarEventCreation,
  type CreateCalendarEventCommand,
  type ReviseCalendarEventCommand,
  type SoftDeleteCalendarEventCommand,
  type RestoreCalendarEventCommand,
  type CalendarEventDeletion,
  CalendarDomainError,
  LINK_BODY_DOC_VERSION,
  MAX_MEDIA_PER_LINK,
  assertLifeLinkMediaBytes,
  assertLifeLinkBodyPatchIsCoordinated,
  assertLifeLinkContentWithinBounds,
  assertValidLifeLinkParentPlacement,
  applyLifeLinkPatch,
  buildQrUrl,
  coordinateLifeLinkBody,
  compareCollectionTitleOrder,
  compareCollectionSectionOrder,
  createCanonicalLifeLink,
  createCanonicalCollection,
  createCanonicalCollectionSection,
  createCanonicalActivity,
  createCanonicalRoutine,
  createCanonicalRoutineGroup,
  createCanonicalRoutineOccurrence,
  createCanonicalRoutineRevision,
  normalizeRoutineRevisionId,
  planRoutineRevisionScheduling,
  createCanonicalRoutineRun,
  createCanonicalRoutineSchedule,
  createCanonicalRoutineSessionAmendment,
  applyActivityPatch,
  applyRoutineGroupPatch,
  applyRoutineRunStepResult,
  applyRoutineSchedulePatch,
  applyRoutinePatch,
  buildRoutineSessionFromRun,
  routineScheduleMatchesLocalDate,
  resolveRoutineSchedulePlannedFor,
  listRoutineScheduleLocalDates,
  projectRoutineSessionWithAmendments,
  reviseCanonicalRoutine,
  createCanonicalCalendar,
  applyCalendarPatch,
  softDeleteCalendar,
  restoreCalendar,
  createCanonicalCalendarEvent,
  reviseCanonicalCalendarEvent,
  softDeleteCalendarEvent,
  restoreCalendarEvent,
  calendarRecurrenceIncludesOriginalOccurrence,
  createCompetitionFixtureData,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  generateQrIds,
  mapLegacyLinkToLifeLinkId,
  lifeLinkCreatePayloadMatches,
  normalizeBatchCount,
  normalizeCollectionPatch,
  normalizeCollectionId,
  normalizeCollectionSectionId,
  normalizeCollectionSectionIds,
  normalizeCollectionSectionTitle,
  normalizeSetLifeLinkQrBindingCommand,
  normalizeClearLifeLinkQrBindingCommand,
  pageCollectionRecords,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectPrivateClaimedQrAsLink,
  projectUnclaimedQrAsLink,
  projectPublicLifeLinkAsLink,
  normalizePublicFieldKeys,
  searchCanonicalLifeLinks,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_OWNER_ID
} from "@life-links/core";

import { hashPassword, verifyPassword } from "./password.js";
import type { AttachmentTextExtraction } from "./attachment-content.js";
import { assertRegistrationInvitation, prepareRegisteredOwner, RegistrationAdmissionError,
  type RegisterOwnerInput, type RegistrationInvitation } from "./registration.js";

export type StoredUser = UserRecord & {
  passwordHash: string;
  agentConnectedAt: string | null;
  agentToolCatalogId: AgentToolCatalogId | null;
};

export const LIFE_LINKS_AGENT_TOOL_CATALOG_V1_ID = "life-links-page-webmcp-v1" as const;
export const LIFE_LINKS_AGENT_TOOL_CATALOG_V2_ID = "life-links-calendar-v2" as const;
export const LIFE_LINKS_AGENT_TOOL_CATALOG_V3_ID = "life-links-workspace-v3" as const;
export const LIFE_LINKS_AGENT_TOOL_CATALOG_V4_ID = "life-links-search-v4" as const;
export type AgentToolCatalogId =
  | typeof LIFE_LINKS_AGENT_TOOL_CATALOG_V1_ID
  | typeof LIFE_LINKS_AGENT_TOOL_CATALOG_V2_ID
  | typeof LIFE_LINKS_AGENT_TOOL_CATALOG_V3_ID
  | typeof LIFE_LINKS_AGENT_TOOL_CATALOG_V4_ID;

export class WorkspaceAgentAccessError extends Error {
  readonly code = "agent_access_denied";
  constructor(readonly reason: string) {
    super("This operation requires the owner's active Workspace agent grant.");
  }
}

export function assertWorkspaceAgentConnection(
  user: Pick<StoredUser, "agentConnectedAt" | "agentToolCatalogId"> & { id?: string } | null | undefined,
  actor: CalendarActor
): void {
  if (actor === "agent" && remoteAgentScopeAllows(user?.id)) return;
  if (actor === "agent" && (!user?.agentConnectedAt ||
      (user.agentToolCatalogId !== LIFE_LINKS_AGENT_TOOL_CATALOG_V3_ID && user.agentToolCatalogId !== LIFE_LINKS_AGENT_TOOL_CATALOG_V4_ID))) {
    throw new WorkspaceAgentAccessError("workspace_agent_connection_required");
  }
}

export function assertAgentRoutineArchive(patch: UpdateRoutineCommand["patch"], actor: CalendarActor): void {
  const remote = currentRemoteAgentPrincipal();
  if (actor === "agent" && remote && remoteAgentScopeAllows(remote.ownerId, "routines", true)) return;
  if (actor === "agent" && (Object.keys(patch).length !== 1 || typeof patch.archivedAt !== "string" || !patch.archivedAt)) {
    throw new WorkspaceAgentAccessError("routine_agent_archive_only");
  }
}

export function assertHumanCalendarActor(actor: CalendarActor): void {
  if (actor !== "human") {
    throw new CalendarDomainError("calendar_access_denied", "Calendar settings require the owner.", { reason: "calendar_settings_human_only" });
  }
}

export function assertCalendarAgentConnection(
  user: Pick<StoredUser, "agentConnectedAt" | "agentToolCatalogId"> & { id?: string } | null | undefined,
  actor: CalendarActor
): void {
  if (actor === "agent" && remoteAgentScopeAllows(user?.id, "calendar")) return;
  if (actor === "agent" && (!user?.agentConnectedAt ||
      (user.agentToolCatalogId !== LIFE_LINKS_AGENT_TOOL_CATALOG_V2_ID && user.agentToolCatalogId !== LIFE_LINKS_AGENT_TOOL_CATALOG_V3_ID &&
       user.agentToolCatalogId !== LIFE_LINKS_AGENT_TOOL_CATALOG_V4_ID))) {
    throw new CalendarDomainError("calendar_access_denied", "An active Calendar agent connection is required.", { reason: "calendar_agent_connection_required" });
  }
}

export function calendarActorCanRead(calendar: CalendarRecord | null | undefined, actor: CalendarActor): boolean {
  return actor === "human" || Boolean(calendar && calendar.deletedAt === null && (calendar.agentAccess === "read" || calendar.agentAccess === "write"));
}

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type LinkMediaInput = {
  kind: LinkMediaKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  data: Buffer;
};

export type LinkMediaFile = {
  media: LinkMediaRecord;
  data: Buffer;
  viewerIsOwner: boolean;
};

export type LifeLinkMediaFile = {
  media: LifeLinkMediaRecord;
  data: Buffer;
};

export type BatchCreateResult = {
  batch: ExportBatchRecord;
  qrCodes: LinkRecord[];
};

export type ClaimOutcome = {
  result: ClaimResult;
  state: QrViewState;
  replayed?: boolean;
};

export class ClaimIdempotencyConflictError extends Error {
  constructor() {
    super("claim idempotency key is already bound to another request");
    this.name = "ClaimIdempotencyConflictError";
  }
}

export type FindScanResult = {
  targetQrId: string;
  scannedQrId: string | null;
  match: boolean;
};

export type CompetitionFixtureResetMode = "dry-run" | "apply";

export type CompetitionFixtureResetOptions = {
  password: string;
  qrBaseUrl: string;
  mode?: CompetitionFixtureResetMode;
};

export type CompetitionFixtureCounts = {
  users: number;
  sessions: number;
  lifeLinks: number;
  qrBindings: number;
  collections: number;
  collectionSections: number;
  collectionMemberships: number;
  collectionSectionAssignments: number;
  media: number;
  batches: number;
  qrCodes: number;
  claimEvents: number;
  routineGroups: number;
  routineActivities: number;
  routines: number;
  routineRevisions: number;
  routineSteps: number;
  routineContextBindings: number;
  routineSchedules: number;
  routineOccurrences: number;
  routineRuns: number;
  routineSessions: number;
  routineSessionStepResults: number;
  routineSessionAmendments: number;
  calendars: number;
  calendarEvents: number;
  calendarEventRevisions: number;
  calendarEventSubjectLinks: number;
  calendarEventTombstones: number;
  calendarProviderConnections: number;
  calendarProviderBindings: number;
  calendarProviderSyncStates: number;
  calendarProviderEventProjections: number;
  calendarProviderEventProjectionRevisions: number;
  calendarProviderEventTombstones: number;
  calendarProviderEventTombstoneHistory: number;
  calendarProviderOutbox: number;
  calendarProviderWebhookHints: number;
};

export type RoutinePageRequest = LifeLinkPageRequest & { includeArchived?: boolean };
export type RoutineDetail = { routine: RoutineRecord; currentRevision: RoutineRevisionSnapshot };
export type RoutineOccurrencePageRequest = LifeLinkPageRequest & {
  routineId?: string;
  startDate?: string;
  endDate?: string;
};
export type MaterializeRoutineOccurrencesInput = { startDate: string; endDate: string };

export type CalendarPageRequest = LifeLinkPageRequest & { includeDeleted?: boolean };
/**
 * startDate/endDate are an all-or-none inclusive local-date window. The store
 * returns persisted definitions rather than expanded recurrence instances, so
 * recurrence masters remain available for expansion by the Calendar layer.
 */
export type CalendarEventPageRequest = LifeLinkPageRequest & {
  calendarId?: string;
  includeDeleted?: boolean;
  startDate?: string;
  endDate?: string;
};
export type CalendarEventDetail = {
  event: CalendarEventRecord;
  currentRevision: CalendarEventRevisionRecord;
};

export type CompetitionFixtureResetReport = {
  profile: string;
  ownerId: string;
  mode: CompetitionFixtureResetMode;
  applied: boolean;
  before: CompetitionFixtureCounts;
  after: CompetitionFixtureCounts;
  expected: CompetitionFixtureCounts;
  shapeMatchesExpected: boolean;
};

export class CompetitionFixtureShapeMismatchError extends Error {}

/**
 * Canonical ownership lives in the recursive Life Link methods. The legacy
 * QR views are projections used by the current
 * HTTP surface and must not grow an independent persistence path.
 */
export type CollectionMemberPageRequest = LifeLinkPageRequest & { includeMemberships?: boolean };
export type CollectionMemberPage = LifeLinkPage<LifeLinkRecord> & {
  membershipPages?: Record<string, LifeLinkPage<LifeLinkCollectionMembership>>;
};

export type LifeLinksStore = {
  previewLifeLinkChange(userId: string, input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview>;
  getLifeLinkChangePreview(userId: string, previewId: string): Promise<LifeLinkChangePreview | null>;
  previewCollectionChange(userId: string, input: CollectionChangeInput, actor?: CalendarActor): Promise<CollectionChangePreview>;
  getCollectionChangePreview(userId: string, previewId: string, actor?: CalendarActor): Promise<CollectionChangePreview | null>;
  applyCollectionChange(userId: string, input: ApplyLifeLinkChangeInput, actor?: CalendarActor): Promise<CollectionChangeResult>;
  applyLifeLinkChange(userId: string, input: ApplyLifeLinkChangeInput): Promise<LifeLinkChangeResult>;
  getChangeHistory(userId: string): Promise<ChangeHistory>;
  undoChange(userId: string, input: UndoChangeInput): Promise<LifeLinkChangeResult>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  registrationAvailable(invitation: RegistrationInvitation): Promise<boolean>;
  registerOwner(input: RegisterOwnerInput): Promise<StoredUser>;
  getUserById(userId: string): Promise<StoredUser | null>;
  connectAgent(userId: string, toolCatalogId?: AgentToolCatalogId): Promise<StoredUser | null>;
  disconnectAgent(userId: string): Promise<StoredUser | null>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;

  listLifeLinks(userId: string, parentId: string | null, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkSummary>>;
  listRecordSearchLifeLinks(userId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkRecord>>;
  getLifeLinkDetail(userId: string, lifeLinkId: string, page?: LifeLinkPageRequest): Promise<LifeLinkDetail | null>;
  searchLifeLinks(
    userId: string,
    query: string,
    options?: { cursor?: string | null; limit?: number | string; maxLimit?: number }
  ): Promise<LifeLinkSearchResult>;
  createLifeLink(command: CreateLifeLinkCommand): Promise<LifeLinkRecord>;
  updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null>;
  moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null>;
  setLifeLinkQrBinding(userId: string, command: SetLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null>;
  clearLifeLinkQrBinding(userId: string, command: ClearLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null>;
  createLifeLinkMedia(userId: string, lifeLinkId: string, input: LinkMediaInput): Promise<LifeLinkMediaRecord | null>;
  deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean>;
  getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null>;
  getAttachmentText(file: LifeLinkMediaFile, revision: string): Promise<AttachmentTextExtraction | null>;
  putAttachmentText(file: LifeLinkMediaFile, revision: string, extraction: AttachmentTextExtraction): Promise<void>;

  listCollections(userId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<CollectionRecord>>;
  getCollection(userId: string, collectionId: string): Promise<CollectionRecord | null>;
  createCollection(command: CreateCollectionCommand): Promise<CollectionRecord>;
  updateCollection(userId: string, command: UpdateCollectionCommand): Promise<CollectionRecord | null>;
  listCollectionMembers(userId: string, collectionId: string, page?: CollectionMemberPageRequest): Promise<CollectionMemberPage | null>;
  addCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null>;
  removeCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null>;
  listCollectionSections(userId: string, collectionId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<CollectionSectionRecord> | null>;
  createCollectionSection(userId: string, command: CreateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null>;
  updateCollectionSection(userId: string, command: UpdateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null>;
  removeCollectionSection(userId: string, command: RemoveCollectionSectionCommand): Promise<CollectionRecord | null>;
  replaceCollectionSectionAssignments(userId: string, command: ReplaceCollectionSectionAssignmentsCommand): Promise<CollectionRecord | null>;
  listLifeLinkCollectionMemberships(userId: string, lifeLinkId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkCollectionMembership> | null>;

  listRoutineGroups(userId: string, page?: RoutinePageRequest): Promise<LifeLinkPage<RoutineGroupRecord>>;
  getRoutineGroup(userId: string, groupId: string): Promise<RoutineGroupRecord | null>;
  createRoutineGroup(command: CreateRoutineGroupCommand): Promise<RoutineGroupRecord>;
  updateRoutineGroup(userId: string, command: UpdateRoutineGroupCommand): Promise<RoutineGroupRecord | null>;
  listActivities(userId: string, page?: RoutinePageRequest): Promise<LifeLinkPage<ActivityRecord>>;
  getActivity(userId: string, activityId: string): Promise<ActivityRecord | null>;
  createActivity(command: CreateActivityCommand): Promise<ActivityRecord>;
  updateActivity(userId: string, command: UpdateActivityCommand): Promise<ActivityRecord | null>;
  listRoutines(userId: string, page?: RoutinePageRequest, actor?: CalendarActor): Promise<LifeLinkPage<RoutineSummaryRecord>>;
  getRoutine(userId: string, routineId: string, actor?: CalendarActor): Promise<RoutineDetail | null>;
  createRoutine(command: CreateRoutineCommand): Promise<CanonicalRoutineCreation>;
  updateRoutine(userId: string, command: UpdateRoutineCommand, actor?: CalendarActor): Promise<RoutineRecord | null>;
  reviseRoutine(userId: string, command: ReviseRoutineCommand): Promise<RoutineRevisionSnapshot | null>;
  getRoutineRevision(userId: string, routineId: string, revisionId: string): Promise<RoutineRevisionSnapshot | null>;
  listRoutineSchedules(userId: string, routineId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<RoutineScheduleRecord> | null>;
  createRoutineSchedule(command: CreateRoutineScheduleCommand): Promise<RoutineScheduleRecord>;
  updateRoutineSchedule(userId: string, command: UpdateRoutineScheduleCommand): Promise<RoutineScheduleRecord | null>;
  materializeRoutineOccurrences(userId: string, routineId: string, input: MaterializeRoutineOccurrencesInput): Promise<RoutineOccurrenceRecord[]>;
  listRoutineOccurrences(userId: string, page?: RoutineOccurrencePageRequest): Promise<LifeLinkPage<RoutineOccurrenceRecord>>;
  getRoutineOccurrence(userId: string, occurrenceId: string): Promise<RoutineOccurrenceRecord | null>;
  startRoutineRun(userId: string, command: StartRoutineRunCommand): Promise<RoutineRunRecord | null>;
  getRoutineRun(userId: string, runId: string): Promise<RoutineRunRecord | null>;
  getActiveRoutineRun(userId: string, routineId: string): Promise<RoutineRunRecord | null>;
  putRoutineRunStepResult(userId: string, command: PutRoutineRunStepResultCommand): Promise<RoutineRunRecord | null>;
  finalizeRoutineRun(userId: string, command: FinalizeRoutineRunCommand): Promise<BuiltRoutineSession | null>;
  listRoutineSessions(userId: string, routineId: string | null, page?: LifeLinkPageRequest): Promise<LifeLinkPage<RoutineSessionRecord>>;
  getRoutineSession(userId: string, sessionId: string): Promise<RoutineSessionProjection | null>;
  appendRoutineSessionAmendment(userId: string, command: AppendRoutineSessionAmendmentCommand): Promise<RoutineSessionAmendmentRecord | null>;

  listCalendars(userId: string, page?: CalendarPageRequest, actor?: CalendarActor): Promise<LifeLinkPage<CalendarRecord>>;
  getCalendar(userId: string, calendarId: string, actor?: CalendarActor): Promise<CalendarRecord | null>;
  createCalendar(command: CreateCalendarCommand, actor?: CalendarActor): Promise<CalendarRecord>;
  updateCalendar(userId: string, command: UpdateCalendarCommand, actor?: CalendarActor): Promise<CalendarRecord | null>;
  softDeleteCalendar(userId: string, command: SoftDeleteCalendarCommand, actor?: CalendarActor): Promise<CalendarRecord | null>;
  restoreCalendar(userId: string, command: RestoreCalendarCommand, actor?: CalendarActor): Promise<CalendarRecord | null>;
  listCalendarEvents(userId: string, page?: CalendarEventPageRequest, actor?: CalendarActor): Promise<LifeLinkPage<CalendarEventDetail>>;
  getCalendarEvent(userId: string, eventId: string, actor?: CalendarActor): Promise<CalendarEventDetail | null>;
  listCalendarEventRevisions(userId: string, eventId: string, actor?: CalendarActor): Promise<CalendarEventRevisionRecord[] | null>;
  createCalendarEvent(command: CreateCalendarEventCommand, actor?: CalendarActor): Promise<CanonicalCalendarEventCreation>;
  reviseCalendarEvent(userId: string, command: ReviseCalendarEventCommand, actor?: CalendarActor): Promise<CalendarEventDetail | null>;
  softDeleteCalendarEvent(userId: string, command: SoftDeleteCalendarEventCommand, actor?: CalendarActor): Promise<CalendarEventDeletion | null>;
  restoreCalendarEvent(userId: string, command: RestoreCalendarEventCommand, actor?: CalendarActor): Promise<CalendarEventDetail | null>;
  listCalendarEventTombstones(userId: string, eventId: string, actor?: CalendarActor): Promise<CalendarEventTombstoneRecord[] | null>;

  listLinks(userId: string): Promise<LinkRecord[]>;
  createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult>;
  listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]>;
  getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState>;
  claimQr(qrId: string, userId: string, command: string | ClaimQrCommand): Promise<ClaimOutcome>;
  createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null>;
  deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean>;
  getLinkMedia(qrId: string, mediaId: string, viewerUserId: string | null): Promise<LinkMediaFile | "private" | null>;
  seedDemo(password: string, qrBaseUrl: string): Promise<void>;
  resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport>;
  checkReady(): Promise<void>;
  close(): Promise<void>;
};

type StoredLifeLink = Omit<LifeLinkRecord, "qrId" | "media">;

type ClaimEventRecord = {
  commandId: string;
  qrId: string | null;
  ownerId: string;
  mode: "create" | "attach" | "set" | "clear";
  requestedLifeLinkId: string | null;
  resolvedLifeLinkId: string | null;
  result: ClaimResult | "bound" | "unbound";
  expectedUpdatedAt: string | null;
  createdAt: string;
};

type StoredLifeLinkMedia = Omit<LifeLinkMediaRecord, "url"> & {
  data: Buffer;
};

type InMemoryStoreSnapshot = {
  users: Map<string, StoredUser>;
  userIdsByEmail: Map<string, string>;
  sessions: Map<string, SessionRecord>;
  lifeLinks: Map<string, StoredLifeLink>;
  collections: Map<string, CollectionRecord>;
  collectionMemberships: Map<string, CollectionMembershipRecord>;
  collectionSections: Map<string, CollectionSectionRecord>;
  collectionSectionAssignments: Map<string, CollectionSectionAssignmentRecord>;
  qrInventory: Map<string, QrInventoryRecord>;
  qrBindings: Map<string, LifeLinkQrBindingRecord>;
  media: Map<string, StoredLifeLinkMedia>;
  batches: Map<string, ExportBatchRecord>;
  batchQrIds: Map<string, string[]>;
  claimEvents: Map<string, ClaimEventRecord>;
  routineGroups: Map<string, RoutineGroupRecord>;
  routineActivities: Map<string, ActivityRecord>;
  routines: Map<string, RoutineRecord>;
  routineRevisions: Map<string, RoutineRevisionRecord>;
  routineSteps: Map<string, RoutineStepRecord>;
  routineContextBindings: Map<string, RoutineContextBindingRecord>;
  routineSchedules: Map<string, RoutineScheduleRecord>;
  routineOccurrences: Map<string, RoutineOccurrenceRecord>;
  routineRuns: Map<string, RoutineRunRecord>;
  routineSessions: Map<string, RoutineSessionRecord>;
  routineSessionStepResults: Map<string, RoutineSessionStepResultRecord>;
  routineSessionAmendments: Map<string, RoutineSessionAmendmentRecord>;
  calendars: Map<string, CalendarRecord>;
  calendarEvents: Map<string, CalendarEventRecord>;
  calendarEventRevisions: Map<string, CalendarEventRevisionRecord>;
  calendarEventTombstones: Map<string, CalendarEventTombstoneRecord>;
};

type ChangeTable = "lifeLinks" | "collections" | "collectionMemberships" | "collectionSections" | "collectionSectionAssignments" | "qrBindings" | "media";
type OwnerChangeSnapshot = Record<ChangeTable, Map<string, unknown>>;
type ChangeDelta = { table: ChangeTable; key: string; before: unknown; after: unknown };
type MemoryHistoryEntry = ChangeHistoryEntry & { deltas: ChangeDelta[]; affectedIds: string[] };
type MemoryPreview = { domain?: never; preview: LifeLinkChangePreview; input: PreviewLifeLinkChangeInput; fingerprint: string; expiresAt: number }
  | { domain: "collections"; preview: CollectionChangePreview; fingerprint: string; expiresAt: number };
const CHANGE_MUTATION_LOCK = "\u0000canonical-change";

export class InMemoryLifeLinksStore implements LifeLinksStore {
  private users = new Map<string, StoredUser>();
  private userIdsByEmail = new Map<string, string>();
  private registrationCounts = new Map<string, number>();
  private sessions = new Map<string, SessionRecord>();
  private lifeLinks = new Map<string, StoredLifeLink>();
  private collections = new Map<string, CollectionRecord>();
  private collectionMemberships = new Map<string, CollectionMembershipRecord>();
  private collectionSections = new Map<string, CollectionSectionRecord>();
  private collectionSectionAssignments = new Map<string, CollectionSectionAssignmentRecord>();
  private qrInventory = new Map<string, QrInventoryRecord>();
  private qrBindings = new Map<string, LifeLinkQrBindingRecord>();
  private media = new Map<string, StoredLifeLinkMedia>();
  private attachmentText = new Map<string, { source: StoredLifeLinkMedia; revision: string; extraction: AttachmentTextExtraction }>();
  private batches = new Map<string, ExportBatchRecord>();
  private batchQrIds = new Map<string, string[]>();
  private claimEvents = new Map<string, ClaimEventRecord>();
  private routineGroups = new Map<string, RoutineGroupRecord>();
  private routineActivities = new Map<string, ActivityRecord>();
  private routines = new Map<string, RoutineRecord>();
  private routineRevisions = new Map<string, RoutineRevisionRecord>();
  private routineSteps = new Map<string, RoutineStepRecord>();
  private routineContextBindings = new Map<string, RoutineContextBindingRecord>();
  private routineSchedules = new Map<string, RoutineScheduleRecord>();
  private routineOccurrences = new Map<string, RoutineOccurrenceRecord>();
  private routineRuns = new Map<string, RoutineRunRecord>();
  private routineSessions = new Map<string, RoutineSessionRecord>();
  private routineSessionStepResults = new Map<string, RoutineSessionStepResultRecord>();
  private routineSessionAmendments = new Map<string, RoutineSessionAmendmentRecord>();
  private calendars = new Map<string, CalendarRecord>();
  private calendarEvents = new Map<string, CalendarEventRecord>();
  private calendarEventRevisions = new Map<string, CalendarEventRevisionRecord>();
  private calendarEventTombstones = new Map<string, CalendarEventTombstoneRecord>();
  private ownerLocks = new Map<string, Promise<void>>();
  private changeHistory = new Map<string, MemoryHistoryEntry[]>();
  private changePreviews = new Map<string, Map<string, MemoryPreview>>();
  private changeReceipts = new Map<string, { ownerId: string; request: string; operation: LifeLinkChangeResult["operation"]; affectedIds: string[]; collectionIds?: string[] }>();
  private usedChangeIds = new Set<string>();

  async previewCollectionChange(userId: string, input: CollectionChangeInput, actor: CalendarActor = "human"): Promise<CollectionChangePreview> {
    return this.withOwnerLock(userId, async () => {
      assertWorkspaceAgentConnection(this.users.get(userId), actor);
      const now = Date.now();
      const plan = planCollectionChange(this.collectionChangeState(), userId, input, new Date(now).toISOString());
      this.assertCollectionsNotCurrentRoutineContext(userId, new Set(plan.deletedCollectionIds));
      const preview: CollectionChangePreview = { ...plan.preview, id: `preview-${randomUUID()}`, createdAt: new Date(now).toISOString() };
      const previews = this.changePreviews.get(userId) ?? new Map<string, MemoryPreview>();
      for (const [id, item] of previews) if (item.expiresAt <= now) previews.delete(id);
      while (previews.size >= CHANGE_HISTORY_LIMIT) previews.delete(previews.keys().next().value!);
      previews.set(preview.id, { domain: "collections", preview, fingerprint: createHash("sha256").update(stableChangeFingerprint(plan.preview)).digest("hex"), expiresAt: now + 15 * 60_000 });
      this.changePreviews.set(userId, previews);
      return structuredClone(preview);
    });
  }

  async getCollectionChangePreview(userId: string, previewId: string, actor: CalendarActor = "human"): Promise<CollectionChangePreview | null> {
    assertWorkspaceAgentConnection(this.users.get(userId), actor);
    const entry = this.changePreviews.get(userId)?.get(previewId);
    if (!entry || entry.domain !== "collections" || entry.expiresAt <= Date.now()) return null;
    return structuredClone(entry.preview);
  }

  async applyCollectionChange(userId: string, input: ApplyLifeLinkChangeInput, actor: CalendarActor = "human"): Promise<CollectionChangeResult> {
    return this.withLocks([CHANGE_MUTATION_LOCK, userId], async () => {
      assertWorkspaceAgentConnection(this.users.get(userId), actor);
      if (typeof input.commandId !== "string" || !input.commandId.trim() || input.commandId.length > 128) throw new LifeLinkDomainError("invalid_collection", "A stable command ID is required.");
      const request = stableChangeFingerprint({ collectionApply: input.previewId });
      const receipt = this.changeReceipts.get(input.commandId);
      if (receipt) {
        if (receipt.ownerId !== userId || receipt.request !== request || !receipt.collectionIds || receipt.operation === "undo") throw new ClaimIdempotencyConflictError();
        return { operation: receipt.operation, collectionIds: [...receipt.collectionIds], lifeLinkIds: [...receipt.affectedIds], history: await this.getChangeHistory(userId) };
      }
      const saved = this.changePreviews.get(userId)?.get(input.previewId);
      if (!saved || saved.domain !== "collections" || saved.expiresAt <= Date.now()) throw new LifeLinkDomainError("collection_not_found", "Collection change preview is unavailable or expired.");
      const plan = planCollectionChange(this.collectionChangeState(), userId, saved.preview.input, new Date().toISOString());
      if (createHash("sha256").update(stableChangeFingerprint(plan.preview)).digest("hex") !== saved.fingerprint) throw new LifeLinkDomainError("stale_collection", "The selection changed. Review a fresh preview.");
      this.assertCollectionsNotCurrentRoutineContext(userId, new Set(plan.deletedCollectionIds));
      await this.recordOwnerChange(userId, `${plan.preview.input.operation === "delete" ? "Remove" : "Move"} Collection selection`, async () => {
        for (const [map, rows] of [[this.collections, plan.next.collections], [this.collectionSections, plan.next.sections],
          [this.collectionMemberships, plan.next.memberships], [this.collectionSectionAssignments, plan.next.assignments]] as const) {
          removeMapEntries(map as Map<string, { ownerId: string }>, (row) => row.ownerId === userId);
          for (const row of rows) if (row.ownerId === userId) {
            const key = "id" in row ? row.id : "sectionId" in row ? assignmentKey(row.collectionId, row.lifeLinkId, row.sectionId) : membershipKey(row.collectionId, row.lifeLinkId);
            (map as Map<string, unknown>).set(key, row);
          }
        }
      });
      this.changeReceipts.set(input.commandId, { ownerId: userId, request, operation: plan.preview.input.operation, affectedIds: plan.lifeLinkIds, collectionIds: plan.collectionIds });
      this.changePreviews.get(userId)?.delete(input.previewId);
      return { operation: plan.preview.input.operation, collectionIds: plan.collectionIds, lifeLinkIds: plan.lifeLinkIds, history: await this.getChangeHistory(userId) };
    });
  }

  private collectionChangeState(): CollectionChangeState {
    return { collections: [...this.collections.values()], sections: [...this.collectionSections.values()],
      memberships: [...this.collectionMemberships.values()], assignments: [...this.collectionSectionAssignments.values()], lifeLinks: [...this.lifeLinks.values()] };
  }

  async previewLifeLinkChange(userId: string, input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview> {
    return this.withOwnerLock(userId, async () => {
      const scope = this.changeScope(userId, input);
      const now = Date.now();
      const preview: LifeLinkChangePreview = {
        id: `preview-${randomUUID()}`, operation: input.operation, rootIds: scope.rootIds,
        items: scope.items.map(lifeLinkChangePreviewItem), parentId: scope.parentId,
        target: scope.target ? lifeLinkChangePreviewItem(scope.target) : null,
        sideEffects: this.changeSideEffects(scope.items.map((row) => row.id)), createdAt: new Date(now).toISOString()
      };
      const previews = this.changePreviews.get(userId) ?? new Map<string, MemoryPreview>();
      for (const [id, item] of previews) if (item.expiresAt <= now) previews.delete(id);
      while (previews.size >= CHANGE_HISTORY_LIMIT) previews.delete(previews.keys().next().value!);
      previews.set(preview.id, { preview, input: structuredClone(input), fingerprint: this.changeFingerprint(userId, input), expiresAt: now + 15 * 60_000 });
      this.changePreviews.set(userId, previews);
      return structuredClone(preview);
    });
  }

  async getLifeLinkChangePreview(userId: string, previewId: string): Promise<LifeLinkChangePreview | null> {
    const item = this.changePreviews.get(userId)?.get(previewId);
    if (item?.domain === "collections") return null;
    if (!item || item.expiresAt <= Date.now()) {
      this.changePreviews.get(userId)?.delete(previewId);
      return null;
    }
    return structuredClone(item.preview);
  }

  async getChangeHistory(userId: string): Promise<ChangeHistory> {
    return { limit: CHANGE_HISTORY_LIMIT, entries: (this.changeHistory.get(userId) ?? []).map(({ id, label, createdAt }) => ({ id, label, createdAt })) };
  }

  async applyLifeLinkChange(userId: string, input: ApplyLifeLinkChangeInput): Promise<LifeLinkChangeResult> {
    return this.withLocks([CHANGE_MUTATION_LOCK, userId], async () => {
      const replay = await this.changeReplay(userId, input.commandId, { apply: input.previewId });
      if (replay) return replay;
      const saved = this.changePreviews.get(userId)?.get(input.previewId);
      if (!saved || saved.domain === "collections" || saved.expiresAt <= Date.now()) throw new LifeLinkDomainError("life_link_not_found", "The change preview is unavailable. Preview again.");
      let fingerprint: string;
      try { fingerprint = this.changeFingerprint(userId, saved.input); }
      catch { throw new LifeLinkDomainError("stale_life_link", "The selection changed. Review a fresh preview.", { reason: "stale_preview" }); }
      if (fingerprint !== saved.fingerprint) throw new LifeLinkDomainError("stale_life_link", "The selection changed. Review a fresh preview.", { reason: "stale_preview" });
      const scope = this.changeScope(userId, saved.input);
      const ids = new Set(scope.items.map((row) => row.id));
      const changed = saved.input.operation === "delete" || scope.rootIds.some((id) => this.lifeLinks.get(id)!.parentId !== scope.parentId);
      await this.recordOwnerChange(userId, `${saved.input.operation === "move" ? "Move" : "Delete"} ${ids.size} Life Link${ids.size === 1 ? "" : "s"}`, async () => {
        if (saved.input.operation === "move") {
          for (const id of scope.rootIds) {
            const row = this.lifeLinks.get(id)!;
            if (row.parentId === scope.parentId) continue;
            const changedAt = nextTimestamp(row.updatedAt);
            this.lifeLinks.set(id, { ...row, parentId: scope.parentId, updatedAt: changedAt, placementConfirmedAt: changedAt });
          }
        } else {
          this.assertLifeLinksNotCurrentRoutineContext(userId, ids);
          const collectionIds = new Set([...this.collectionMemberships.values()].filter((row) => ids.has(row.lifeLinkId)).map((row) => row.collectionId));
          removeMapEntries(this.collectionSectionAssignments, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.collectionMemberships, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.media, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.qrBindings, (row) => ids.has(row.lifeLinkId));
          for (const id of ids) this.lifeLinks.delete(id);
          for (const id of collectionIds) this.touchCollection(this.collections.get(id)!);
        }
      });
      const result = { operation: saved.input.operation, affectedIds: changed ? [...ids] : [], history: await this.getChangeHistory(userId) };
      this.rememberChange(userId, input.commandId, { apply: input.previewId }, result);
      this.changePreviews.get(userId)?.delete(input.previewId);
      return result;
    });
  }

  async undoChange(userId: string, input: UndoChangeInput): Promise<LifeLinkChangeResult> {
    return this.withLocks([CHANGE_MUTATION_LOCK, userId], async () => {
      const replay = await this.changeReplay(userId, input.commandId, { undo: input.changeId });
      if (replay) return replay;
      const history = this.changeHistory.get(userId) ?? [];
      const entry = history[0];
      if (!entry) throw new LifeLinkDomainError("life_link_not_found", "There is no change to undo.");
      if (entry.id !== input.changeId) throw new LifeLinkDomainError("stale_life_link", "Only the latest change can be undone.");
      const tables = this.changeTables();
      for (const delta of entry.deltas) {
        if (!sameChangeRow(tables[delta.table].get(delta.key), delta.after)) throw new LifeLinkDomainError("stale_life_link", "The changed data no longer matches this Undo.");
        if (delta.table === "qrBindings" && delta.before) this.assertQrHistoryAvailable(userId, delta.key);
        if (delta.table === "lifeLinks" && delta.before === undefined) this.assertLifeLinksNotCurrentRoutineContext(userId, new Set([delta.key]));
        if (delta.table === "collections" && delta.before === undefined) this.assertCollectionsNotCurrentRoutineContext(userId, new Set([delta.key]));
      }
      for (const delta of entry.deltas) {
        if (delta.table === "media") this.attachmentText.delete(delta.key);
        if (delta.before === undefined) {
          tables[delta.table].delete(delta.key);
          if (["lifeLinks", "collections", "collectionSections"].includes(delta.table)) this.usedChangeIds.add(`${delta.table}\u0000${delta.key}`);
        } else {
          const row = { ...(delta.before as Record<string, unknown>) };
          if (typeof row.updatedAt === "string") {
            const current = tables[delta.table].get(delta.key) as { updatedAt?: string } | undefined;
            row.updatedAt = nextTimestamp(current?.updatedAt ?? row.updatedAt);
          }
          tables[delta.table].set(delta.key, row);
        }
      }
      // Media and membership records have no own revision; invalidating their
      // owning content revisions makes restored relations visible to stale-edit checks.
      const revisions: Partial<Record<ChangeTable, Set<string>>> = { lifeLinks: new Set(entry.affectedIds), collections: new Set(), collectionSections: new Set() };
      for (const delta of entry.deltas) {
        if (revisions[delta.table]) revisions[delta.table]!.add(delta.key);
        for (const value of [delta.before, delta.after]) {
          const row = value as { collectionId?: string; sectionId?: string } | undefined;
          if (row?.collectionId) revisions.collections!.add(row.collectionId);
          if (row?.sectionId) revisions.collectionSections!.add(row.sectionId);
        }
      }
      for (const [table, ids] of Object.entries(revisions) as [ChangeTable, Set<string>][]) {
        for (const id of ids) {
          const row = tables[table].get(id) as { ownerId: string; updatedAt: string } | undefined;
          if (row?.ownerId === userId) tables[table].set(id, { ...row, updatedAt: nextTimestamp(row.updatedAt) });
        }
      }
      history.shift();
      const result: LifeLinkChangeResult = { operation: "undo", affectedIds: [...entry.affectedIds], history: await this.getChangeHistory(userId) };
      this.rememberChange(userId, input.commandId, { undo: input.changeId }, result);
      return result;
    });
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const userId = this.userIdsByEmail.get(email.toLowerCase());
    return userId ? this.users.get(userId) ?? null : null;
  }

  async registrationAvailable(invitation: RegistrationInvitation): Promise<boolean> {
    assertRegistrationInvitation(invitation);
    return Date.parse(invitation.expiresAt) > Date.now()
      && (this.registrationCounts.get(invitation.fingerprint) ?? 0) < invitation.maxAccounts;
  }

  async registerOwner(input: RegisterOwnerInput): Promise<StoredUser> {
    const { user, calendar } = prepareRegisteredOwner(input);
    return this.withLocks(["\u0000account-registration"], async () => {
      if (!(await this.registrationAvailable(input.invitation))) throw new RegistrationAdmissionError("registration_unavailable");
      if (this.userIdsByEmail.has(user.email.toLowerCase())) throw new RegistrationAdmissionError("registration_failed");
      this.users.set(user.id, user);
      this.userIdsByEmail.set(user.email.toLowerCase(), user.id);
      this.calendars.set(calendar.id, calendar);
      this.registrationCounts.set(input.invitation.fingerprint, (this.registrationCounts.get(input.invitation.fingerprint) ?? 0) + 1);
      return user;
    });
  }

  async getUserById(userId: string): Promise<StoredUser | null> {
    return this.users.get(userId) ?? null;
  }

  async connectAgent(
    userId: string,
    toolCatalogId: AgentToolCatalogId = LIFE_LINKS_AGENT_TOOL_CATALOG_V1_ID
  ): Promise<StoredUser | null> {
    return this.withOwnerLock(userId, async () => {
      const user = this.users.get(userId);
      if (!user) {
        return null;
      }
      if (user.agentConnectedAt && user.agentToolCatalogId === toolCatalogId) {
        return user;
      }
      const now = new Date().toISOString();
      const connectedAt = user.agentConnectedAt && Date.parse(now) <= Date.parse(user.agentConnectedAt)
        ? new Date(Date.parse(user.agentConnectedAt) + 1).toISOString()
        : now;
      const connected = { ...user, agentConnectedAt: connectedAt, agentToolCatalogId: toolCatalogId };
      this.users.set(userId, connected);
      return connected;
    });
  }

  async disconnectAgent(userId: string): Promise<StoredUser | null> {
    return this.withOwnerLock(userId, async () => {
      const user = this.users.get(userId);
      if (!user) {
        return null;
      }
      if (!user.agentConnectedAt && user.agentToolCatalogId === null) {
        return user;
      }
      const disconnected = { ...user, agentConnectedAt: null, agentToolCatalogId: null };
      this.users.set(userId, disconnected);
      return disconnected;
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(tokenHash, session);
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) {
      return null;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.users.get(session.userId);
    return user ? { ...session, user } : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async listLifeLinks(
    userId: string,
    parentId: string | null,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<LifeLinkSummary>> {
    return pageLifeLinkChildren(this.hydrateOwnerLifeLinks(userId), userId, parentId, page);
  }

  async getLifeLinkDetail(
    userId: string,
    lifeLinkId: string,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkDetail | null> {
    const lifeLinks = this.hydrateOwnerLifeLinks(userId);
    const lifeLink = lifeLinks.find((item) => item.id === lifeLinkId);
    if (!lifeLink) {
      return null;
    }
    const children = pageLifeLinkChildren(lifeLinks, userId, lifeLinkId, page);
    return {
      lifeLink,
      ancestry: deriveLifeLinkPath(lifeLinks, lifeLinkId),
      children: children.items,
      childrenPage: { nextCursor: children.nextCursor, truncated: children.truncated }
    };
  }

  async searchLifeLinks(
    userId: string,
    query: string,
    options: { cursor?: string | null; limit?: number | string; maxLimit?: number } = {}
  ): Promise<LifeLinkSearchResult> {
    return searchCanonicalLifeLinks(this.hydrateOwnerLifeLinks(userId), userId, query, options);
  }

  async createLifeLink(command: CreateLifeLinkCommand): Promise<LifeLinkRecord> {
    return this.withMutationLocks([`life-link-id:${command.id}`, command.ownerId], command.ownerId, "Create Life Link", async () => {
      const candidate = createCanonicalLifeLink(command);
      const existing = this.lifeLinks.get(candidate.id);
      if (existing) {
        if (lifeLinkCreatePayloadMatches(this.hydrateLifeLink(existing), command)) {
          return this.hydrateLifeLink(existing);
        }
        throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identity is already bound to another record.");
      }
      this.assertFreshChangeIdentity("lifeLinks", candidate.id);
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(command.ownerId);
      assertValidLifeLinkParentPlacement([...ownerLifeLinks, candidate], candidate.id, candidate.parentId);
      this.lifeLinks.set(candidate.id, withoutLifeLinkRelations(candidate));
      this.promoteParent(candidate.parentId, candidate.createdAt);
      return this.hydrateLifeLink(this.lifeLinks.get(candidate.id)!);
    });
  }

  async updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withMutationLocks([userId], userId, "Edit Life Link", async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      assertFresh(current, command.expectedUpdatedAt);
      const candidate = applyLifeLinkPatch(this.hydrateLifeLink(current), command.patch, nextTimestamp(current.updatedAt));
      const next = withoutLifeLinkRelations(candidate);
      this.lifeLinks.set(next.id, next);
      return this.hydrateLifeLink(next);
    });
  }

  async moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withMutationLocks([userId], userId, "Move Life Link", async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      if (current.parentId === command.parentId) {
        return this.hydrateLifeLink(current);
      }
      assertFresh(current, command.expectedUpdatedAt);
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(userId);
      assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, command.parentId);
      const changedAt = nextTimestamp(current.updatedAt);
      const next: StoredLifeLink = {
        ...current,
        parentId: command.parentId,
        placementConfirmedAt: changedAt,
        updatedAt: changedAt
      };
      this.lifeLinks.set(next.id, next);
      this.promoteParent(next.parentId, changedAt);
      return this.hydrateLifeLink(next);
    });
  }

  async setLifeLinkQrBinding(userId: string, command: SetLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    command = normalizeSetLifeLinkQrBindingCommand(command);
    return this.withMutationLocks([`claim-command:${command.commandId}`, `claim-qr:${command.qrId}`, userId], userId, "Change QR binding", async () => {
      const replay = this.qrBindingReplay(userId, "set", command);
      if (replay !== undefined) {
        return replay;
      }
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      if (!this.qrInventory.has(command.qrId)) {
        throw new LifeLinkDomainError("qr_not_found", "QR was not found.");
      }
      this.assertQrHistoryAvailable(userId, command.qrId);
      const occupied = this.qrBindings.get(command.qrId);
      if (occupied && occupied.lifeLinkId !== current.id) {
        throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
      }
      const previous = this.bindingForLifeLink(current.id);
      if (previous?.qrId !== command.qrId) {
        assertFresh(current, command.expectedUpdatedAt);
        const changedAt = nextTimestamp(current.updatedAt);
        if (previous) {
          this.qrBindings.delete(previous.qrId);
        }
        this.qrBindings.set(command.qrId, { qrId: command.qrId, lifeLinkId: current.id, boundAt: changedAt });
        this.lifeLinks.set(current.id, { ...current, updatedAt: changedAt });
      }
      this.recordQrBindingCommand(userId, "set", command);
      return this.hydrateLifeLink(this.lifeLinks.get(current.id)!);
    });
  }

  async clearLifeLinkQrBinding(userId: string, command: ClearLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    command = normalizeClearLifeLinkQrBindingCommand(command);
    return this.withMutationLocks([`claim-command:${command.commandId}`, userId], userId, "Detach QR", async () => {
      const replay = this.qrBindingReplay(userId, "clear", command);
      if (replay !== undefined) {
        return replay;
      }
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      const previous = this.bindingForLifeLink(current.id);
      if (previous) {
        assertFresh(current, command.expectedUpdatedAt);
        this.qrBindings.delete(previous.qrId);
        this.lifeLinks.set(current.id, { ...current, updatedAt: nextTimestamp(current.updatedAt) });
      }
      this.recordQrBindingCommand(userId, "clear", command);
      return this.hydrateLifeLink(this.lifeLinks.get(current.id)!);
    });
  }

  async createLifeLinkMedia(
    userId: string,
    lifeLinkId: string,
    input: LinkMediaInput
  ): Promise<LifeLinkMediaRecord | null> {
    assertLifeLinkMediaBytes(input.sizeBytes, input.data.byteLength);
    return this.withMutationLocks([userId], userId, "Add attachment", async () => {
      const lifeLink = this.lifeLinks.get(lifeLinkId);
      if (!lifeLink || lifeLink.ownerId !== userId || this.mediaForLifeLink(lifeLinkId).length >= MAX_MEDIA_PER_LINK) {
        return null;
      }
      const media: StoredLifeLinkMedia = {
        id: `media-${randomUUID()}`,
        lifeLinkId,
        ownerId: userId,
        kind: input.kind,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        createdAt: new Date().toISOString(),
        data: input.data
      };
      this.media.set(media.id, media);
      return this.publicLifeLinkMedia(media);
    });
  }

  async deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean> {
    return this.withMutationLocks([userId], userId, "Remove attachment", async () => {
      const media = this.media.get(mediaId);
      if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) return false;
      this.media.delete(mediaId);
      return true;
    });
  }

  async getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null> {
    const media = this.media.get(mediaId);
    if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) {
      return null;
    }
    return { media: this.publicLifeLinkMedia(media), data: media.data };
  }

  async listRecordSearchLifeLinks(userId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<LifeLinkRecord>> {
    const rows = [...this.lifeLinks.values()].filter((row) => row.ownerId === userId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const result = pageCollectionRecords(rows, page);
    return { ...result, items: result.items.map((row) => this.hydrateLifeLink(row)) };
  }

  async getAttachmentText(file: LifeLinkMediaFile, revision: string): Promise<AttachmentTextExtraction | null> {
    const source = this.media.get(file.media.id);
    const cached = this.attachmentText.get(file.media.id);
    if (!source || source !== cached?.source) { this.attachmentText.delete(file.media.id); return null; }
    if (!this.currentAttachmentSource(source, file) || cached.revision !== revision) return null;
    return structuredClone(cached.extraction);
  }

  async putAttachmentText(file: LifeLinkMediaFile, revision: string, extraction: AttachmentTextExtraction): Promise<void> {
    const source = this.media.get(file.media.id);
    if (source && this.currentAttachmentSource(source, file)) {
      this.attachmentText.set(file.media.id, { source, revision, extraction: structuredClone(extraction) });
    }
  }

  private currentAttachmentSource(source: StoredLifeLinkMedia, file: LifeLinkMediaFile): boolean {
    return source.ownerId === file.media.ownerId && this.lifeLinks.get(source.lifeLinkId)?.ownerId === file.media.ownerId &&
      source.lifeLinkId === file.media.lifeLinkId && source.mimeType === file.media.mimeType && source.data.equals(file.data);
  }

  async listCollections(userId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<CollectionRecord>> {
    return pageCollectionRecords(
      Array.from(this.collections.values()).filter((collection) => collection.ownerId === userId).sort(compareCollectionTitleOrder).map(copyCollection),
      page
    );
  }

  async getCollection(userId: string, collectionId: string): Promise<CollectionRecord | null> {
    const collection = this.ownedCollection(userId, collectionId);
    return collection ? copyCollection(collection) : null;
  }

  async createCollection(command: CreateCollectionCommand): Promise<CollectionRecord> {
    const candidate = createCanonicalCollection(command);
    return this.withMutationLocks([`collection-id:${candidate.id}`, candidate.ownerId], candidate.ownerId, "Create Collection", async () => {
      if (!this.users.has(candidate.ownerId)) {
        throw new LifeLinkDomainError("invalid_collection", "Collection owner was not found.");
      }
      const current = this.collections.get(candidate.id);
      if (current) {
        if (current.ownerId === candidate.ownerId && current.title === candidate.title && current.purpose === candidate.purpose && current.notes === candidate.notes) {
          return copyCollection(current);
        }
        throw new LifeLinkDomainError("duplicate_collection_id", "Collection identity is already bound to another record.");
      }
      this.assertFreshChangeIdentity("collections", candidate.id);
      this.collections.set(candidate.id, candidate);
      return copyCollection(candidate);
    });
  }

  async updateCollection(userId: string, command: UpdateCollectionCommand): Promise<CollectionRecord | null> {
    const patch = normalizeCollectionPatch(command.patch);
    return this.withMutationLocks([userId], userId, "Edit Collection", async () => {
      const current = this.ownedCollection(userId, command.collectionId);
      if (!current) {
        return null;
      }
      const next = { ...current, ...patch };
      if (next.title === current.title && next.purpose === current.purpose && next.notes === current.notes) {
        return copyCollection(current);
      }
      assertCollectionFresh(current, command.expectedUpdatedAt);
      next.updatedAt = nextTimestamp(current.updatedAt);
      this.collections.set(next.id, next);
      return copyCollection(next);
    });
  }

  async listCollectionMembers(userId: string, collectionId: string, page: CollectionMemberPageRequest = {}): Promise<CollectionMemberPage | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!this.ownedCollection(userId, collectionId)) {
      return null;
    }
    const members = Array.from(this.collectionMemberships.values())
      .filter((membership) => membership.ownerId === userId && membership.collectionId === collectionId)
      .map((membership) => this.lifeLinks.get(membership.lifeLinkId)!)
      .sort(compareCollectionTitleOrder)
      .map((lifeLink) => this.hydrateLifeLink(lifeLink));
    const result = pageCollectionRecords(members, page);
    return page.includeMemberships ? { ...result, membershipPages: Object.fromEntries(result.items.map((member) =>
      [member.id, this.readLifeLinkMembershipPage(userId, member.id)])) } : result;
  }

  async addCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withMutationLocks([userId], userId, "Add Collection member", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      const key = membershipKey(collection.id, lifeLink.id);
      if (this.collectionMemberships.has(key)) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      this.collectionMemberships.set(key, { ownerId: userId, collectionId: collection.id, lifeLinkId: lifeLink.id, createdAt: changedAt });
      return this.touchCollection(collection, changedAt);
    });
  }

  async removeCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withMutationLocks([userId], userId, "Remove Collection member", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      const key = membershipKey(collection.id, lifeLink.id);
      if (!this.collectionMemberships.has(key)) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.collectionMemberships.delete(key);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.collectionId === collection.id && assignment.lifeLinkId === lifeLink.id);
      return this.touchCollection(collection);
    });
  }

  async listCollectionSections(userId: string, collectionId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<CollectionSectionRecord> | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!this.ownedCollection(userId, collectionId)) {
      return null;
    }
    return pageCollectionRecords(this.sectionsForCollection(collectionId).map((section) => ({ ...section })), page);
  }

  async createCollectionSection(userId: string, command: CreateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null> {
    return this.withMutationLocks([`section-id:${normalizeCollectionSectionId(command.id)}`, userId], userId, "Create Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      if (!collection) {
        return null;
      }
      const sections = this.sectionsForCollection(collection.id);
      const candidate = createCanonicalCollectionSection({
        id: command.id,
        ownerId: userId,
        collectionId: collection.id,
        title: command.title,
        position: sections.length ? sections[sections.length - 1].position + 1 : 0,
        createdAt: nextTimestamp(collection.updatedAt)
      });
      const current = this.collectionSections.get(candidate.id);
      if (current) {
        if (current.ownerId === userId && current.collectionId === collection.id && current.title === candidate.title) {
          return { collection: copyCollection(collection), section: { ...current } };
        }
        throw new LifeLinkDomainError("duplicate_section_id", "Section identity is already bound to another record.");
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.assertFreshChangeIdentity("collectionSections", candidate.id);
      this.collectionSections.set(candidate.id, candidate);
      return { collection: this.touchCollection(collection, candidate.createdAt), section: { ...candidate } };
    });
  }

  async updateCollectionSection(userId: string, command: UpdateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null> {
    const sectionId = normalizeCollectionSectionId(command.sectionId);
    const title = normalizeCollectionSectionTitle(command.title);
    return this.withMutationLocks([userId], userId, "Edit Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const section = this.collectionSections.get(sectionId);
      if (!collection || !section || section.ownerId !== userId || section.collectionId !== collection.id) {
        return null;
      }
      if (title === section.title) {
        return { collection: copyCollection(collection), section: { ...section } };
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      const next = { ...section, title, updatedAt: changedAt };
      this.collectionSections.set(next.id, next);
      return { collection: this.touchCollection(collection, changedAt), section: { ...next } };
    });
  }

  async removeCollectionSection(userId: string, command: RemoveCollectionSectionCommand): Promise<CollectionRecord | null> {
    const sectionId = normalizeCollectionSectionId(command.sectionId);
    return this.withMutationLocks([userId], userId, "Remove Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      if (!collection) {
        return null;
      }
      const section = this.collectionSections.get(sectionId);
      if (!section || section.ownerId !== userId || section.collectionId !== collection.id) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.collectionSections.delete(section.id);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.sectionId === section.id);
      return this.touchCollection(collection);
    });
  }

  async replaceCollectionSectionAssignments(userId: string, command: ReplaceCollectionSectionAssignmentsCommand): Promise<CollectionRecord | null> {
    const sectionIds = normalizeCollectionSectionIds(command.sectionIds);
    return this.withMutationLocks([userId], userId, "Change Section assignments", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      if (!this.collectionMemberships.has(membershipKey(collection.id, lifeLink.id))) {
        throw new LifeLinkDomainError("collection_membership_not_found", "Life Link is not a direct Collection member.");
      }
      if (sectionIds.some((sectionId) => {
        const section = this.collectionSections.get(sectionId);
        return !section || section.ownerId !== userId || section.collectionId !== collection.id;
      })) {
        throw new LifeLinkDomainError("section_not_found", "Section was not found in this Collection.");
      }
      const currentIds = this.sectionAssignmentsForMember(collection.id, lifeLink.id).map((assignment) => assignment.sectionId).sort();
      if (JSON.stringify(currentIds) === JSON.stringify([...sectionIds].sort())) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.collectionId === collection.id && assignment.lifeLinkId === lifeLink.id && !sectionIds.includes(assignment.sectionId));
      for (const sectionId of sectionIds) {
        const key = assignmentKey(collection.id, lifeLink.id, sectionId);
        if (!this.collectionSectionAssignments.has(key)) {
          this.collectionSectionAssignments.set(key, { ownerId: userId, collectionId: collection.id, lifeLinkId: lifeLink.id, sectionId, createdAt: changedAt });
        }
      }
      return this.touchCollection(collection, changedAt);
    });
  }

  async listLifeLinkCollectionMemberships(userId: string, lifeLinkId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<LifeLinkCollectionMembership> | null> {
    const lifeLink = this.lifeLinks.get(lifeLinkId);
    if (!lifeLink || lifeLink.ownerId !== userId) {
      return null;
    }
    return this.readLifeLinkMembershipPage(userId, lifeLinkId, page);
  }

  private readLifeLinkMembershipPage(userId: string, lifeLinkId: string, page: LifeLinkPageRequest = {}): LifeLinkPage<LifeLinkCollectionMembership> {
    const collections = Array.from(this.collectionMemberships.values())
      .filter((membership) => membership.ownerId === userId && membership.lifeLinkId === lifeLinkId)
      .map((membership) => this.collections.get(membership.collectionId)!)
      .sort(compareCollectionTitleOrder);
    const result = pageCollectionRecords(collections, page);
    return {
      ...result,
      items: result.items.map((collection) => {
        const ids = new Set(this.sectionAssignmentsForMember(collection.id, lifeLinkId).map((assignment) => assignment.sectionId));
        return { collection: copyCollection(collection), sections: this.sectionsForCollection(collection.id).filter((section) => ids.has(section.id)).map((section) => ({ ...section })) };
      })
    };
  }

  async listRoutineGroups(userId: string, page: RoutinePageRequest = {}): Promise<LifeLinkPage<RoutineGroupRecord>> {
    return pageCollectionRecords(this.ownerRoutineRows(this.routineGroups, userId, page.includeArchived).sort(compareRoutineTitledRows), page);
  }

  async getRoutineGroup(userId: string, groupId: string): Promise<RoutineGroupRecord | null> {
    return copyOwned(this.routineGroups.get(groupId), userId);
  }

  async createRoutineGroup(command: CreateRoutineGroupCommand): Promise<RoutineGroupRecord> {
    const candidate = createCanonicalRoutineGroup(command);
    return this.withLocks([`routine-group-id:${candidate.id}`, candidate.ownerId], async () => {
      this.assertRoutineOwner(candidate.ownerId);
      const existing = this.routineGroups.get(candidate.id);
      if (existing) return sameRoutineCreatePayload(existing, candidate) ? structuredClone(existing) : routineIdConflict();
      this.routineGroups.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async updateRoutineGroup(userId: string, command: UpdateRoutineGroupCommand): Promise<RoutineGroupRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.routineGroups.get(command.groupId);
      if (!current || current.ownerId !== userId) return null;
      const candidate = applyRoutineGroupPatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (sameRoutinePayload({ ...candidate, updatedAt: current.updatedAt }, current)) return structuredClone(current);
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      this.routineGroups.set(current.id, candidate);
      return structuredClone(candidate);
    });
  }

  async listActivities(userId: string, page: RoutinePageRequest = {}): Promise<LifeLinkPage<ActivityRecord>> {
    return pageCollectionRecords(this.ownerRoutineRows(this.routineActivities, userId, page.includeArchived).sort(compareRoutineTitledRows), page);
  }

  async getActivity(userId: string, activityId: string): Promise<ActivityRecord | null> {
    return copyOwned(this.routineActivities.get(activityId), userId);
  }

  async createActivity(command: CreateActivityCommand): Promise<ActivityRecord> {
    const candidate = createCanonicalActivity(command);
    return this.withLocks([`routine-activity-id:${candidate.id}`, candidate.ownerId], async () => {
      this.assertRoutineOwner(candidate.ownerId);
      const existing = this.routineActivities.get(candidate.id);
      if (existing) return sameRoutineCreatePayload(existing, candidate) ? structuredClone(existing) : routineIdConflict();
      this.routineActivities.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async updateActivity(userId: string, command: UpdateActivityCommand): Promise<ActivityRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.routineActivities.get(command.activityId);
      if (!current || current.ownerId !== userId) return null;
      const candidate = applyActivityPatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (sameRoutinePayload({ ...candidate, updatedAt: current.updatedAt }, current)) return structuredClone(current);
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      this.routineActivities.set(current.id, candidate);
      if (current.archivedAt === null && candidate.archivedAt !== null) {
        const affectedScheduleIds = new Set(
          [...this.routineSchedules.values()].filter((schedule) => schedule.ownerId === userId && schedule.active &&
            [...this.routineSteps.values()].some((step) => step.ownerId === userId &&
              step.routineRevisionId === schedule.routineRevisionId && step.activityId === current.id)
          ).map((schedule) => schedule.id)
        );
        this.deactivateRoutineSchedulesById(userId, affectedScheduleIds, candidate.updatedAt);
      }
      return structuredClone(candidate);
    });
  }

  async listRoutines(userId: string, page: RoutinePageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<RoutineSummaryRecord>> {
    assertWorkspaceAgentConnection(this.users.get(userId), actor);
    const rows = this.ownerRoutineRows(this.routines, userId, page.includeArchived).map((routine): RoutineSummaryRecord => {
      const revision = this.routineRevisions.get(routine.currentRevisionId)!;
      return { ...routine, revisionNumber: revision.revisionNumber, title: revision.title, purpose: revision.purpose };
    }).sort(compareRoutineTitledRows);
    return pageCollectionRecords(rows, page);
  }

  async getRoutine(userId: string, routineId: string, actor: CalendarActor = "human"): Promise<RoutineDetail | null> {
    assertWorkspaceAgentConnection(this.users.get(userId), actor);
    const routine = this.routines.get(routineId);
    if (!routine || routine.ownerId !== userId) return null;
    return { routine: structuredClone(routine), currentRevision: this.memoryRoutineRevisionSnapshot(userId, routine.id, routine.currentRevisionId)! };
  }

  async createRoutine(command: CreateRoutineCommand): Promise<CanonicalRoutineCreation> {
    const candidate = createCanonicalRoutine(command);
    return this.withLocks([`routine-id:${candidate.routine.id}`, `routine-revision-id:${candidate.currentRevision.revision.id}`, candidate.routine.ownerId], async () => {
      this.assertRoutineOwner(candidate.routine.ownerId);
      const existing = this.routines.get(candidate.routine.id);
      if (existing) {
        const detail = this.memoryRoutineCreation(existing);
        return sameRoutineCreatePayload(detail, candidate) ? structuredClone(detail) : routineIdConflict();
      }
      this.assertRoutineDefinitionReferences(candidate.routine.ownerId, candidate.routine.groupId, candidate.currentRevision);
      if (this.routineRevisions.has(candidate.currentRevision.revision.id) || candidate.currentRevision.steps.some((step) => this.routineSteps.has(step.id)) || candidate.currentRevision.bindings.some((binding) => this.routineContextBindings.has(binding.id))) routineIdConflict();
      this.persistMemoryRoutineCreation(candidate);
      return structuredClone(candidate);
    });
  }

  async updateRoutine(userId: string, command: UpdateRoutineCommand, actor: CalendarActor = "human"): Promise<RoutineRecord | null> {
    return this.withOwnerLock(userId, async () => {
      assertWorkspaceAgentConnection(this.users.get(userId), actor);
      assertAgentRoutineArchive(command.patch, actor);
      const current = this.routines.get(command.routineId);
      if (!current || current.ownerId !== userId) return null;
      const candidate = applyRoutinePatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (candidate.groupId) {
        if (candidate.groupId === current.groupId) this.assertRoutineGroupExists(userId, candidate.groupId);
        else this.assertActiveRoutineGroup(userId, candidate.groupId);
      }
      if (sameRoutinePayload({ ...candidate, updatedAt: current.updatedAt }, current)) return structuredClone(current);
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      this.routines.set(current.id, candidate);
      if (current.archivedAt === null && candidate.archivedAt !== null) {
        this.deactivateRoutineSchedules(userId, new Set([current.id]), candidate.updatedAt);
      }
      return structuredClone(candidate);
    });
  }

  async reviseRoutine(userId: string, command: ReviseRoutineCommand): Promise<RoutineRevisionSnapshot | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.routines.get(command.routineId);
      if (!current || current.ownerId !== userId) return null;
      const previous = this.memoryRoutineRevisionSnapshot(userId, current.id, normalizeRoutineRevisionId(command.expectedCurrentRevisionId));
      if (!previous) throw new LifeLinkDomainError("stale_routine", "Routine previous revision is unavailable.", { retryable: true });
      const existing = this.routineRevisions.get(command.id);
      if (existing) {
        const snapshot = this.memoryRoutineRevisionSnapshot(userId, current.id, existing.id);
        const { expectedCurrentRevisionId: _expectedCurrentRevisionId, ...revisionCommand } = command;
        const desired = createCanonicalRoutineRevision(revisionCommand, previous.revision.ordering);
        if (snapshot && current.currentRevisionId === existing.id && previous.revision.revisionNumber === snapshot.revision.revisionNumber - 1 &&
            sameRoutineCreatePayload(snapshot, desired)) return structuredClone(snapshot);
        routineIdConflict();
      }
      const candidate = reviseCanonicalRoutine(current, command, previous.revision);
      this.assertRoutineDefinitionReferences(userId, current.groupId, candidate.currentRevision, false);
      if (candidate.currentRevision.steps.some((step) => this.routineSteps.has(step.id)) ||
          candidate.currentRevision.bindings.some((binding) => this.routineContextBindings.has(binding.id))) routineIdConflict();
      const history = [...this.routineRevisions.values()].filter((item) => item.routineId === current.id);
      if (candidate.currentRevision.revision.revisionNumber !== history.length + 1) throw new LifeLinkDomainError("routine_conflict", "Routine revision number must follow the current history.");
      const scheduling = planRoutineRevisionScheduling(candidate.currentRevision.revision,
        [...this.routineSchedules.values()], [...this.routineOccurrences.values()],
        new Set([...this.routineRuns.values()].filter((run) => run.ownerId === userId && run.routineId === current.id && run.occurrenceId !== null)
          .map((run) => run.occurrenceId!)));
      this.persistMemoryRoutineCreation(candidate);
      for (const schedule of scheduling.schedules) this.routineSchedules.set(schedule.id, schedule);
      for (const occurrence of scheduling.occurrences) this.routineOccurrences.set(occurrence.id, occurrence);
      return structuredClone(candidate.currentRevision);
    });
  }

  async getRoutineRevision(userId: string, routineId: string, revisionId: string): Promise<RoutineRevisionSnapshot | null> {
    return this.memoryRoutineRevisionSnapshot(userId, routineId, revisionId);
  }

  async listRoutineSchedules(userId: string, routineId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<RoutineScheduleRecord> | null> {
    const routine = this.routines.get(routineId);
    if (!routine || routine.ownerId !== userId) return null;
    const rows = [...this.routineSchedules.values()].filter((item) => item.ownerId === userId && item.routineId === routineId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).map((item) => structuredClone(item));
    return pageCollectionRecords(rows, page);
  }

  async createRoutineSchedule(command: CreateRoutineScheduleCommand): Promise<RoutineScheduleRecord> {
    const candidate = createCanonicalRoutineSchedule(command);
    return this.withLocks([`routine-schedule-id:${candidate.id}`, candidate.ownerId], async () => {
      const existing = this.routineSchedules.get(candidate.id);
      if (existing) return sameRoutineCreatePayload(existing, candidate) ? structuredClone(existing) : routineIdConflict();
      this.assertRoutineScheduleReferences(candidate);
      this.routineSchedules.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async updateRoutineSchedule(userId: string, command: UpdateRoutineScheduleCommand): Promise<RoutineScheduleRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.routineSchedules.get(command.scheduleId);
      if (!current || current.ownerId !== userId) return null;
      const routine = this.routines.get(current.routineId)!;
      const pinnedCandidate = applyRoutineSchedulePatch(current, current.routineRevisionId, command.patch, nextTimestamp(current.updatedAt));
      const ruleChanged = !sameRoutinePayload(pinnedCandidate.rule, current.rule);
      const safeDisable = command.patch.active === false && !ruleChanged;
      if (safeDisable) {
        const noOp = sameRoutinePayload({ ...pinnedCandidate, revision: current.revision, updatedAt: current.updatedAt }, current);
        if (noOp) return structuredClone(current);
        assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
        this.routineSchedules.set(current.id, pinnedCandidate);
        for (const [id, occurrence] of this.routineOccurrences) {
          if (occurrence.scheduleId === current.id && occurrence.status === "planned" && occurrence.plannedFor > pinnedCandidate.updatedAt) {
            this.routineOccurrences.set(id, { ...occurrence, status: "canceled", updatedAt: pinnedCandidate.updatedAt });
          }
        }
        return structuredClone(pinnedCandidate);
      }
      if (routine.archivedAt) throw new LifeLinkDomainError("routine_conflict", "Archived Routine schedule cannot be changed.");
      this.assertRoutineRevisionActivitiesActive(userId, routine.currentRevisionId);
      const desired = applyRoutineSchedulePatch(current, routine.currentRevisionId, command.patch, nextTimestamp(current.updatedAt));
      const noOp = sameRoutinePayload({ ...desired, revision: current.revision, updatedAt: current.updatedAt }, current);
      if (noOp) return structuredClone(current);
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      this.routineSchedules.set(current.id, desired);
      for (const [id, occurrence] of this.routineOccurrences) {
        if (occurrence.scheduleId !== current.id || !["planned", "canceled"].includes(occurrence.status) || occurrence.plannedFor <= desired.updatedAt) continue;
        const matches = desired.active && routineScheduleMatchesLocalDate(desired.rule, occurrence.localDate);
        this.routineOccurrences.set(id, matches ? {
          ...occurrence, scheduleRevision: desired.revision, routineRevisionId: desired.routineRevisionId,
          plannedFor: resolveRoutineSchedulePlannedFor(desired.rule, occurrence.localDate), status: "planned", updatedAt: desired.updatedAt
        } : { ...occurrence, status: "canceled", updatedAt: desired.updatedAt });
      }
      return structuredClone(desired);
    });
  }

  async materializeRoutineOccurrences(userId: string, routineId: string, input: MaterializeRoutineOccurrencesInput): Promise<RoutineOccurrenceRecord[]> {
    return this.withOwnerLock(userId, async () => {
      const routine = this.routines.get(routineId);
      if (!routine || routine.ownerId !== userId) return [];
      if (routine.archivedAt) throw new LifeLinkDomainError("routine_conflict", "Archived Routine cannot materialize occurrences.");
      this.assertRoutineRevisionActivitiesActive(userId, routine.currentRevisionId);
      const createdAt = new Date().toISOString();
      const result: RoutineOccurrenceRecord[] = [];
      for (const schedule of [...this.routineSchedules.values()].filter((item) => item.ownerId === userId && item.routineId === routineId && item.active)) {
        this.assertRoutineRevisionActivitiesActive(userId, schedule.routineRevisionId);
        for (const localDate of listRoutineScheduleLocalDates(schedule.rule, input.startDate, input.endDate)) {
          const existing = [...this.routineOccurrences.values()].find((item) => item.ownerId === userId && item.scheduleId === schedule.id && item.localDate === localDate);
          if (existing) { result.push(structuredClone(existing)); continue; }
          const occurrence = createCanonicalRoutineOccurrence(schedule, { id: `routine-occurrence-${randomUUID()}`, localDate, createdAt });
          this.routineOccurrences.set(occurrence.id, occurrence);
          result.push(structuredClone(occurrence));
        }
      }
      return result.sort(compareRoutineOccurrenceOrder);
    });
  }

  async listRoutineOccurrences(userId: string, page: RoutineOccurrencePageRequest = {}): Promise<LifeLinkPage<RoutineOccurrenceRecord>> {
    let rows = [...this.routineOccurrences.values()].filter((item) => item.ownerId === userId);
    if (page.routineId) rows = rows.filter((item) => item.routineId === page.routineId);
    if (page.startDate) rows = rows.filter((item) => item.localDate >= page.startDate!);
    if (page.endDate) rows = rows.filter((item) => item.localDate <= page.endDate!);
    return pageCollectionRecords(rows.sort(compareRoutineOccurrenceOrder).map((item) => structuredClone(item)), page);
  }

  async getRoutineOccurrence(userId: string, occurrenceId: string): Promise<RoutineOccurrenceRecord | null> {
    return copyOwned(this.routineOccurrences.get(occurrenceId), userId);
  }

  async startRoutineRun(userId: string, command: StartRoutineRunCommand): Promise<RoutineRunRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const existing = this.routineRuns.get(command.id);
      if (existing) {
        if (existing.ownerId === userId && existing.routineId === command.routineId && existing.occurrenceId === (command.occurrenceId ?? null)) return structuredClone(existing);
        routineIdConflict();
      }
      const routine = this.routines.get(command.routineId);
      if (!routine || routine.ownerId !== userId) return null;
      if (routine.archivedAt) throw new LifeLinkDomainError("routine_conflict", "Archived Routine cannot start a Run.");
      if ([...this.routineRuns.values()].some((run) => run.ownerId === userId && run.routineId === routine.id && run.status === "active")) throw new LifeLinkDomainError("routine_conflict", "Routine already has an active Run.");
      const occurrence = command.occurrenceId ? this.routineOccurrences.get(command.occurrenceId) : null;
      if (command.occurrenceId && (!occurrence || occurrence.ownerId !== userId || occurrence.routineId !== routine.id)) return null;
      if (occurrence && occurrence.status !== "planned") throw new LifeLinkDomainError("routine_conflict", "Routine occurrence cannot start a Run.");
      const revisionId = occurrence?.routineRevisionId ?? routine.currentRevisionId;
      this.assertRoutineRevisionActivitiesActive(userId, revisionId);
      const revision = this.memoryRoutineRevisionSnapshot(userId, routine.id, revisionId)!;
      const run = createCanonicalRoutineRun({ id: command.id, ownerId: userId, routineId: routine.id, routineRevisionId: revisionId,
        occurrenceId: occurrence?.id ?? null, contextSnapshot: this.memoryRoutineContextSnapshot(userId, revision), startedAt: command.startedAt }, revision);
      this.routineRuns.set(run.id, run);
      if (occurrence) this.routineOccurrences.set(occurrence.id, { ...occurrence, status: "started", updatedAt: run.startedAt });
      return structuredClone(run);
    });
  }

  async getRoutineRun(userId: string, runId: string): Promise<RoutineRunRecord | null> {
    return copyOwned(this.routineRuns.get(runId), userId);
  }

  async getActiveRoutineRun(userId: string, routineId: string): Promise<RoutineRunRecord | null> {
    const run = [...this.routineRuns.values()].find((item) => item.ownerId === userId && item.routineId === routineId && item.status === "active");
    return run ? structuredClone(run) : null;
  }

  async putRoutineRunStepResult(userId: string, command: PutRoutineRunStepResultCommand): Promise<RoutineRunRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const run = this.routineRuns.get(command.runId);
      if (!run || run.ownerId !== userId) return null;
      const step = this.routineSteps.get(command.routineStepId);
      if (!step || step.ownerId !== userId || step.routineRevisionId !== run.routineRevisionId) return null;
      const next = applyRoutineRunStepResult(run, step, command, nextTimestamp(run.updatedAt));
      this.routineRuns.set(run.id, next);
      return structuredClone(next);
    });
  }

  async finalizeRoutineRun(userId: string, command: FinalizeRoutineRunCommand): Promise<BuiltRoutineSession | null> {
    return this.withOwnerLock(userId, async () => {
      const replaySession = [...this.routineSessions.values()].find((item) => item.ownerId === userId && item.runId === command.runId);
      if (replaySession) {
        if (replaySession.id !== command.sessionId) routineIdConflict();
        return this.memoryBuiltSession(replaySession);
      }
      const run = this.routineRuns.get(command.runId);
      if (!run || run.ownerId !== userId) return null;
      assertRoutineUpdatedAt(run.updatedAt, command.expectedUpdatedAt);
      const identities = run.stepResults.map((result) => ({ routineStepId: result.routineStepId, id: stableRoutineSessionResultId(command.sessionId, result.routineStepId) }));
      const built = buildRoutineSessionFromRun(run, command.sessionId, identities, command.completedAt);
      if (this.routineSessions.has(built.session.id) || built.stepResults.some((result) => this.routineSessionStepResults.has(result.id))) routineIdConflict();
      this.routineRuns.set(run.id, built.finalizedRun);
      this.routineSessions.set(built.session.id, built.session);
      for (const result of built.stepResults) this.routineSessionStepResults.set(result.id, result);
      if (run.occurrenceId) {
        const occurrence = this.routineOccurrences.get(run.occurrenceId)!;
        this.routineOccurrences.set(occurrence.id, { ...occurrence, status: "completed", updatedAt: built.session.completedAt });
      }
      return structuredClone(built);
    });
  }

  async listRoutineSessions(userId: string, routineId: string | null, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<RoutineSessionRecord>> {
    const rows = [...this.routineSessions.values()].filter((item) => item.ownerId === userId && (!routineId || item.routineId === routineId))
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id)).map((item) => structuredClone(item));
    return pageCollectionRecords(rows, page);
  }

  async getRoutineSession(userId: string, sessionId: string): Promise<RoutineSessionProjection | null> {
    const session = this.routineSessions.get(sessionId);
    if (!session || session.ownerId !== userId) return null;
    const results = [...this.routineSessionStepResults.values()].filter((item) => item.ownerId === userId && item.sessionId === sessionId);
    const amendments = [...this.routineSessionAmendments.values()].filter((item) => item.ownerId === userId && item.sessionId === sessionId);
    return projectRoutineSessionWithAmendments(session, results, amendments);
  }

  async appendRoutineSessionAmendment(userId: string, command: AppendRoutineSessionAmendmentCommand): Promise<RoutineSessionAmendmentRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const existing = this.routineSessionAmendments.get(command.id);
      if (existing) {
        const session = this.routineSessions.get(command.sessionId);
        const stepResult = command.stepResultId ? this.routineSessionStepResults.get(command.stepResultId) : null;
        const step = stepResult ? this.routineSteps.get(stepResult.routineStepId) : null;
        const candidate = session?.ownerId === userId ? createCanonicalRoutineSessionAmendment({ ownerId: userId, session, stepResult, plannedValues: step?.plannedValues, command }) : null;
        if (candidate && sameRoutineCreatePayload(candidate, existing)) return structuredClone(existing);
        routineIdConflict();
      }
      const session = this.routineSessions.get(command.sessionId);
      if (!session || session.ownerId !== userId) return null;
      const stepResult = command.stepResultId ? this.routineSessionStepResults.get(command.stepResultId) : null;
      if (command.stepResultId && (!stepResult || stepResult.ownerId !== userId || stepResult.sessionId !== session.id)) return null;
      const step = stepResult ? this.routineSteps.get(stepResult.routineStepId) : null;
      const amendment = createCanonicalRoutineSessionAmendment({ ownerId: userId, session, stepResult, plannedValues: step?.plannedValues, command });
      this.routineSessionAmendments.set(amendment.id, amendment);
      return structuredClone(amendment);
    });
  }

  async listCalendars(userId: string, page: CalendarPageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<CalendarRecord>> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    const rows = [...this.calendars.values()]
      .filter((item) => item.ownerId === userId && (page.includeDeleted || item.deletedAt === null) && calendarActorCanRead(item, actor))
      .sort(compareCalendarRows)
      .map((item) => structuredClone(item));
    return pageCollectionRecords(rows, page);
  }

  async getCalendar(userId: string, calendarId: string, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    const calendar = copyOwned(this.calendars.get(calendarId), userId);
    return calendar && calendarActorCanRead(calendar, actor) ? calendar : null;
  }

  async createCalendar(command: CreateCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord> {
    assertHumanCalendarActor(actor);
    const candidate = createCanonicalCalendar(command);
    return this.withLocks([`calendar-id:${candidate.id}`, candidate.ownerId], async () => {
      this.assertCalendarOwner(candidate.ownerId);
      const existing = this.calendars.get(candidate.id);
      if (existing) {
        if (sameCalendarCreatePayload(existing, candidate)) return structuredClone(existing);
        calendarConflict("Calendar identity is already bound to another request.", "calendar_id_conflict");
      }
      if (candidate.isDefault) this.clearOtherDefaultCalendars(candidate.ownerId, candidate.id, candidate.createdAt);
      this.calendars.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async updateCalendar(userId: string, command: UpdateCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withOwnerLock(userId, async () => {
      const current = this.calendars.get(command.calendarId);
      if (!current || current.ownerId !== userId) return null;
      assertNativeCalendarWriteAuthority(current);
      const candidate = applyCalendarPatch(current, command, nextTimestamp(current.updatedAt));
      if (sameCalendarPayload({ ...candidate, updatedAt: current.updatedAt }, current)) return structuredClone(current);
      if (candidate.isDefault) this.clearOtherDefaultCalendars(userId, candidate.id, candidate.updatedAt);
      this.calendars.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async softDeleteCalendar(userId: string, command: SoftDeleteCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withOwnerLock(userId, async () => {
      const current = this.calendars.get(command.calendarId);
      if (!current || current.ownerId !== userId) return null;
      assertNativeCalendarWriteAuthority(current);
      if ([...this.calendarEvents.values()].some((event) => event.ownerId === userId && event.calendarId === current.id && event.deletedAt === null)) {
        calendarConflict("Calendar with active events cannot be deleted.", "calendar_not_empty");
      }
      const candidate = softDeleteCalendar(current, command);
      this.calendars.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async restoreCalendar(userId: string, command: RestoreCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withOwnerLock(userId, async () => {
      const current = this.calendars.get(command.calendarId);
      if (!current || current.ownerId !== userId) return null;
      assertNativeCalendarWriteAuthority(current);
      const candidate = restoreCalendar(current, command);
      if (candidate.isDefault && [...this.calendars.values()].some((item) => item.ownerId === userId && item.id !== candidate.id && item.isDefault && item.deletedAt === null)) {
        calendarConflict("Another Calendar is already the default.", "default_calendar_conflict");
      }
      this.calendars.set(candidate.id, candidate);
      return structuredClone(candidate);
    });
  }

  async listCalendarEvents(userId: string, page: CalendarEventPageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<CalendarEventDetail>> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    assertCalendarEventDateWindow(page);
    if (page.calendarId) {
      const calendar = this.calendars.get(page.calendarId);
      if (!calendar || calendar.ownerId !== userId || !calendarActorCanRead(calendar, actor)) return { items: [], truncated: false, nextCursor: null };
    }
    const wrapped = [...this.calendarEvents.values()]
      .filter((event) => event.ownerId === userId && (!page.calendarId || event.calendarId === page.calendarId) &&
        (page.includeDeleted || event.deletedAt === null) && calendarActorCanRead(this.calendars.get(event.calendarId), actor))
      .map((event) => ({ id: event.id, detail: this.memoryCalendarEventDetail(event) }))
      .filter((item) => calendarEventInDateWindow(item.detail, page))
      .sort((left, right) => compareCalendarEventDetails(left.detail, right.detail));
    const paged = pageCollectionRecords(wrapped, page);
    return { ...paged, items: paged.items.map((item) => structuredClone(item.detail)) };
  }

  async getCalendarEvent(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    const event = this.calendarEvents.get(eventId);
    return event?.ownerId === userId && calendarActorCanRead(this.calendars.get(event.calendarId), actor)
      ? structuredClone(this.memoryCalendarEventDetail(event)) : null;
  }

  async listCalendarEventRevisions(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventRevisionRecord[] | null> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    const event = this.calendarEvents.get(eventId);
    if (!event || event.ownerId !== userId || !calendarActorCanRead(this.calendars.get(event.calendarId), actor)) return null;
    return [...this.calendarEventRevisions.values()]
      .filter((item) => item.ownerId === userId && item.eventId === eventId)
      .sort((left, right) => left.revisionNumber - right.revisionNumber)
      .map((item) => structuredClone(item));
  }

  async createCalendarEvent(command: CreateCalendarEventCommand, actor: CalendarActor = "human"): Promise<CanonicalCalendarEventCreation> {
    const candidate = createCanonicalCalendarEvent(command);
    return this.withLocks([`calendar-event-id:${candidate.event.id}`, `calendar-event-revision-id:${candidate.currentRevision.id}`, candidate.event.ownerId], async () => {
      this.assertCalendarOwner(candidate.event.ownerId);
      this.assertAgentCalendarWrite(candidate.event.ownerId, candidate.event.calendarId, actor);
      const existingEvent = this.calendarEvents.get(candidate.event.id);
      if (existingEvent) {
        const existingRevision = this.calendarEventRevisions.get(existingEvent.currentRevisionId);
        if (existingRevision && sameCalendarCreatePayload(
          { event: existingEvent, currentRevision: existingRevision }, candidate
        )) return structuredClone({ event: existingEvent, currentRevision: existingRevision });
        calendarConflict("Calendar event identity is already bound to another request.", "event_id_conflict");
      }
      if (this.calendarEventRevisions.has(candidate.currentRevision.id)) {
        calendarConflict("Calendar event revision identity is already in use.", "event_revision_id_conflict");
      }
      this.assertCalendarEventReferences(candidate.event, candidate.currentRevision);
      this.calendarEvents.set(candidate.event.id, candidate.event);
      this.calendarEventRevisions.set(candidate.currentRevision.id, candidate.currentRevision);
      return structuredClone(candidate);
    });
  }

  async reviseCalendarEvent(userId: string, command: ReviseCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    return this.withOwnerLock(userId, async () => {
      assertCalendarAgentConnection(this.users.get(userId), actor);
      const event = this.calendarEvents.get(command.eventId);
      if (!event || event.ownerId !== userId) return null;
      this.assertAgentCalendarWrite(userId, event.calendarId, actor);
      const replayRevision = this.calendarEventRevisions.get(command.revisionId);
      if (replayRevision) {
        const previousRevision = [...this.calendarEventRevisions.values()].find((item) => item.ownerId === userId &&
          item.eventId === event.id && item.revisionNumber === replayRevision.revisionNumber - 1);
        if (replayRevision.ownerId === userId && replayRevision.eventId === event.id && event.currentRevisionId === replayRevision.id &&
          previousRevision && command.expectedCurrentRevisionId === previousRevision.id) {
          const replayCandidate = reviseCanonicalCalendarEvent(
            { ...event, currentRevisionId: previousRevision.id, updatedAt: previousRevision.createdAt, deletedAt: null },
            previousRevision,
            { ...command, createdAt: replayRevision.createdAt }
          );
          if (isDeepStrictEqual(replayCandidate.currentRevision, replayRevision)) {
            return structuredClone(this.memoryCalendarEventDetail(event));
          }
        }
        calendarConflict("Calendar event revision identity is already in use.", "event_revision_id_conflict");
      }
      const currentRevision = this.calendarEventRevisions.get(event.currentRevisionId)!;
      const candidate = reviseCanonicalCalendarEvent(event, currentRevision, command);
      this.assertCalendarEventReferences(candidate.event, candidate.currentRevision);
      this.calendarEventRevisions.set(candidate.currentRevision.id, candidate.currentRevision);
      this.calendarEvents.set(candidate.event.id, candidate.event);
      return structuredClone(candidate);
    });
  }

  async softDeleteCalendarEvent(userId: string, command: SoftDeleteCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDeletion | null> {
    return this.withOwnerLock(userId, async () => {
      assertCalendarAgentConnection(this.users.get(userId), actor);
      const event = this.calendarEvents.get(command.eventId);
      if (!event || event.ownerId !== userId) return null;
      this.assertAgentCalendarWrite(userId, event.calendarId, actor);
      const replay = this.calendarEventTombstones.get(command.tombstoneId);
      if (replay) {
        if (replay.ownerId === userId && replay.eventId === event.id && replay.lastRevisionId === command.expectedCurrentRevisionId &&
          event.deletedAt === replay.deletedAt) return structuredClone({ event, tombstone: replay });
        calendarConflict("Calendar event tombstone identity is already in use.", "event_tombstone_id_conflict");
      }
      const deletion = softDeleteCalendarEvent(event, command);
      this.calendarEvents.set(event.id, deletion.event);
      this.calendarEventTombstones.set(deletion.tombstone.id, deletion.tombstone);
      return structuredClone(deletion);
    });
  }

  async restoreCalendarEvent(userId: string, command: RestoreCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    return this.withOwnerLock(userId, async () => {
      assertCalendarAgentConnection(this.users.get(userId), actor);
      const event = this.calendarEvents.get(command.eventId);
      const tombstone = this.calendarEventTombstones.get(command.tombstoneId);
      if (!event || event.ownerId !== userId || !tombstone || tombstone.ownerId !== userId) return null;
      this.assertAgentCalendarWrite(userId, event.calendarId, actor);
      const calendar = this.calendars.get(event.calendarId);
      if (!calendar || calendar.ownerId !== userId || calendar.deletedAt !== null) {
        calendarConflict("Deleted Calendar event cannot be restored into an unavailable Calendar.", "calendar_unavailable");
      }
      const restored = restoreCalendarEvent(event, tombstone, command);
      this.assertCalendarEventReferences(restored, this.calendarEventRevisions.get(restored.currentRevisionId)!);
      this.calendarEvents.set(restored.id, restored);
      return structuredClone(this.memoryCalendarEventDetail(restored));
    });
  }

  async listCalendarEventTombstones(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventTombstoneRecord[] | null> {
    assertCalendarAgentConnection(this.users.get(userId), actor);
    const event = this.calendarEvents.get(eventId);
    if (!event || event.ownerId !== userId || !calendarActorCanRead(this.calendars.get(event.calendarId), actor)) return null;
    return [...this.calendarEventTombstones.values()]
      .filter((item) => item.ownerId === userId && item.eventId === eventId)
      .sort((left, right) => left.deletedAt.localeCompare(right.deletedAt) || left.id.localeCompare(right.id))
      .map((item) => structuredClone(item));
  }

  async listLinks(userId: string): Promise<LinkRecord[]> {
    const claimed = Array.from(this.qrBindings.values())
      .map((binding) => this.lifeLinks.get(binding.lifeLinkId))
      .filter((lifeLink): lifeLink is StoredLifeLink => Boolean(lifeLink && lifeLink.ownerId === userId))
      .map((lifeLink) => this.projectTaggedLifeLink(lifeLink));
    const ownedBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((batch) => batch.createdBy === userId)
        .map((batch) => batch.id)
    );
    const unclaimed = Array.from(this.qrInventory.values())
      .filter((qr) => Boolean(qr.batchId && ownedBatchIds.has(qr.batchId) && !this.qrBindings.has(qr.id)))
      .map((qr) => this.qrReservedForAnotherOwner(userId, qr.id) ? projectPrivateClaimedQrAsLink(qr) : projectUnclaimedQrAsLink(qr));
    return [...claimed, ...unclaimed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult> {
    const now = new Date().toISOString();
    const safeCount = normalizeBatchCount(count);
    const batchKey = createUniqueBatchKey(this.batches);
    const ids = createUniqueQrIds(safeCount, batchKey, this.qrInventory);
    const batch: ExportBatchRecord = {
      id: `batch-${randomUUID()}`,
      batchKey,
      qrBaseUrl,
      count: ids.length,
      createdBy: userId,
      createdAt: now
    };
    this.batches.set(batch.id, batch);
    this.batchQrIds.set(batch.id, ids);
    for (const id of ids) {
      this.qrInventory.set(id, { id, url: buildQrUrl(qrBaseUrl, id), batchId: batch.id, createdAt: now });
    }
    return { batch, qrCodes: ids.map((id) => projectUnclaimedQrAsLink(this.qrInventory.get(id)!)) };
  }

  async listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.createdBy !== userId) {
      return [];
    }
    return (this.batchQrIds.get(batchId) ?? []).map((qrId) => {
      const qr = this.qrInventory.get(qrId)!;
      const binding = this.qrBindings.get(qrId);
      if (!binding) {
        return this.qrReservedForAnotherOwner(userId, qrId) ? projectPrivateClaimedQrAsLink(qr) : projectUnclaimedQrAsLink(qr);
      }
      const lifeLink = this.lifeLinks.get(binding.lifeLinkId)!;
      const projected = this.projectTaggedLifeLink(lifeLink);
      if (lifeLink.ownerId === userId) {
        return projected;
      }
      return lifeLink.privacy === "public"
        ? projectPublicLifeLinkAsLink(this.hydrateLifeLink(lifeLink), qr)
        : projectPrivateClaimedQrAsLink(qr);
    });
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const qr = this.qrInventory.get(qrId);
    if (!qr) {
      return { state: "not_found", qrId };
    }
    const binding = this.qrBindings.get(qrId);
    if (!binding) {
      if (this.qrReservedForAnotherOwner(viewerUserId, qrId)) return { state: "private", qrId };
      return { state: "unclaimed", qr: projectUnclaimedQrAsLink(qr) };
    }
    const lifeLink = this.lifeLinks.get(binding.lifeLinkId);
    if (!lifeLink) {
      throw new LifeLinkDomainError("invalid_life_link", "QR binding references a missing Life Link.");
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === lifeLink.ownerId);
    if (lifeLink.privacy === "private" && !viewerIsOwner) {
      return { state: "private", qrId };
    }
    const projected = this.projectTaggedLifeLink(lifeLink);
    return {
      state: "claimed",
      link: viewerIsOwner ? projected : projectPublicLifeLinkAsLink(this.hydrateLifeLink(lifeLink), qr),
      viewerIsOwner
    };
  }

  async claimQr(qrId: string, userId: string, commandValue: string | ClaimQrCommand): Promise<ClaimOutcome> {
    const command: ClaimQrCommand = typeof commandValue === "string" ? { commandId: commandValue, mode: "create" } : commandValue;
    return this.withMutationLocks([`claim-command:${command.commandId}`, `claim-qr:${qrId}`, userId], userId, "Claim QR", async () => {
      const mode = command.mode ?? "create";
      const requestedLifeLinkId = command.mode === "attach" ? command.lifeLinkId : null;
      const existingEvent = this.claimEvents.get(command.commandId);
      if (existingEvent) {
        if (
          existingEvent.qrId !== qrId || existingEvent.ownerId !== userId ||
          existingEvent.mode !== mode ||
          existingEvent.requestedLifeLinkId !== requestedLifeLinkId
        ) {
          throw new ClaimIdempotencyConflictError();
        }
        return {
          result: existingEvent.result as ClaimResult,
          state: await this.getQrState(existingEvent.qrId!, userId),
          replayed: true
        };
      }

      const qr = this.qrInventory.get(qrId);
      if (qr) this.assertQrHistoryAvailable(userId, qrId);
      let result: ClaimResult = "not_found";
      let resolvedLifeLinkId: string | null = null;
      if (command.mode === "attach") {
        const requested = this.lifeLinks.get(command.lifeLinkId);
        if (!requested || requested.ownerId !== userId) {
          throw new LifeLinkDomainError("life_link_not_found", "Attach target Life Link was not found.");
        }
      }
      if (qr) {
        const existingBinding = this.qrBindings.get(qrId);
        const existingLifeLink = existingBinding ? this.lifeLinks.get(existingBinding.lifeLinkId) : null;
        if (existingLifeLink?.ownerId === userId) {
          if (command.mode === "attach" && existingLifeLink.id !== command.lifeLinkId) {
            throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
          }
          result = "already_owned";
          resolvedLifeLinkId = existingLifeLink.id;
        } else if (existingLifeLink) {
          result = "owned_by_other";
          resolvedLifeLinkId = existingLifeLink.id;
        } else {
          const now = new Date().toISOString();
          let target: StoredLifeLink;
          if (command.mode === "attach") {
            const requested = this.lifeLinks.get(command.lifeLinkId)!;
            if (this.bindingForLifeLink(requested.id)) {
              throw new LifeLinkDomainError("life_link_already_tagged", "Attach target Life Link already has a QR tag.");
            }
            target = requested;
          } else {
            const created = createCanonicalLifeLink({
              id: `life-link-${randomUUID()}`,
              ownerId: userId,
              title: "Untitled link",
              body: "",
              privacy: "public",
              createdAt: now
            });
            target = withoutLifeLinkRelations(created);
            this.lifeLinks.set(target.id, target);
          }
          const binding = { qrId, lifeLinkId: target.id, boundAt: now };
          this.qrBindings.set(qrId, binding);
          result = "claimed";
          resolvedLifeLinkId = target.id;
        }
      }

      this.claimEvents.set(command.commandId, {
        commandId: command.commandId,
        qrId,
        ownerId: userId,
        mode,
        requestedLifeLinkId,
        resolvedLifeLinkId,
        result,
        expectedUpdatedAt: null,
        createdAt: new Date().toISOString()
      });
      return { result, state: await this.getQrState(qrId, userId), replayed: false };
    });
  }

  async createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null> {
    const binding = this.qrBindings.get(qrId);
    if (!binding) {
      return null;
    }
    const media = await this.createLifeLinkMedia(userId, binding.lifeLinkId, input);
    return media ? lifeLinkMediaAsLinkMedia(media, qrId) : null;
  }

  async deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean> {
    const binding = this.qrBindings.get(qrId);
    return binding ? this.deleteLifeLinkMedia(userId, binding.lifeLinkId, mediaId) : false;
  }

  async getLinkMedia(
    qrId: string,
    mediaId: string,
    viewerUserId: string | null
  ): Promise<LinkMediaFile | "private" | null> {
    const binding = this.qrBindings.get(qrId);
    const lifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
    const media = this.media.get(mediaId);
    if (!binding || !lifeLink || !media || media.lifeLinkId !== lifeLink.id) {
      return null;
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === lifeLink.ownerId);
    if (!viewerIsOwner) {
      return "private";
    }
    return { media: lifeLinkMediaAsLinkMedia(this.publicLifeLinkMedia(media), qrId), data: media.data, viewerIsOwner };
  }

  async seedDemo(password: string, qrBaseUrl: string): Promise<void> {
    const data = createDemoSeedData(new Date().toISOString(), qrBaseUrl);
    const batchId = "batch-demo-seed";
    for (const user of data.users) {
      if (!this.users.has(user.id)) {
        const passwordHash = await hashPassword(password);
        this.users.set(user.id, { ...user, passwordHash, agentConnectedAt: null, agentToolCatalogId: null });
        this.userIdsByEmail.set(user.email.toLowerCase(), user.id);
      }
    }
    for (const root of data.roots) {
      if (!this.lifeLinks.has(root.id) && !this.usedChangeIds.has(`lifeLinks\u0000${root.id}`)) this.lifeLinks.set(root.id, withoutLifeLinkRelations(root));
      this.usedChangeIds.add(`lifeLinks\u0000${root.id}`);
    }
    if (!this.batches.has(batchId)) {
      this.batches.set(batchId, {
        id: batchId,
        batchKey: "DEMO",
        qrBaseUrl,
        count: data.links.length,
        createdBy: data.users[0].id,
        createdAt: data.links[0]?.createdAt ?? new Date().toISOString()
      });
      this.batchQrIds.set(batchId, data.links.map((link) => link.id));
    }
    for (const link of data.links) {
      if (!this.qrInventory.has(link.id)) {
        this.qrInventory.set(link.id, { id: link.id, url: link.url, batchId, createdAt: link.createdAt });
      }
      if (link.status === "claimed") {
        const lifeLinkId = mapLegacyLinkToLifeLinkId(link.id);
        const wasUsed = this.usedChangeIds.has(`lifeLinks\u0000${lifeLinkId}`);
        if (!this.lifeLinks.has(lifeLinkId) && !wasUsed) {
          this.lifeLinks.set(lifeLinkId, {
            id: lifeLinkId,
            ownerId: link.ownerId!,
            parentId: link.parentId,
            title: link.title,
            body: link.body,
            bodyDoc: link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body),
            bodyDocVersion: link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
            privacy: link.privacy,
            browsingRole: "item",
            context: { schemaVersion: 1 },
            placementConfirmedAt: null,
            publicFieldKeys: link.privacy === "public" ? ["notes"] : [],
            createdAt: link.createdAt,
            updatedAt: link.updatedAt
          });
        }
        if (!this.qrBindings.has(link.id) && this.lifeLinks.has(lifeLinkId) && !wasUsed) {
          this.qrBindings.set(link.id, { qrId: link.id, lifeLinkId, boundAt: link.updatedAt });
        }
        this.usedChangeIds.add(`lifeLinks\u0000${lifeLinkId}`);
      }
    }
  }

  async resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport> {
    const fixture = createCompetitionFixtureData(options.password, options.qrBaseUrl);
    const mode = options.mode ?? "dry-run";
    assertCompetitionFixtureResetMode(mode);
    const expected = expectedCompetitionFixtureCounts(fixture);
    return this.withOwnerLock(fixture.owner.id, async () => {
      this.assertCompetitionFixturePreflight(fixture);
      const before = this.competitionFixtureCounts(fixture.owner.id);
      if (mode === "dry-run") {
        let shapeMatchesExpected = false;
        const existingHash = this.users.get(fixture.owner.id)?.passwordHash ?? "";
        try {
          this.assertCompetitionFixturePostcondition(fixture, existingHash, before, expected);
          shapeMatchesExpected = await verifyPassword(options.password, existingHash);
        } catch (error) {
          if (!(error instanceof CompetitionFixtureShapeMismatchError)) throw error;
        }
        return createCompetitionFixtureResetReport(mode, before, before, expected, shapeMatchesExpected);
      }
      const passwordHash = await hashPassword(options.password);
      const snapshot = this.captureState();
      try {
        this.replaceCompetitionFixture(fixture, passwordHash);
        const after = this.competitionFixtureCounts(fixture.owner.id);
        this.assertCompetitionFixturePostcondition(fixture, passwordHash, after, expected);
        this.changeHistory.delete(fixture.owner.id);
        this.changePreviews.delete(fixture.owner.id);
        removeMapEntries(this.changeReceipts, (receipt) => receipt.ownerId === fixture.owner.id);
        return createCompetitionFixtureResetReport(mode, before, after, expected, true);
      } catch (error) {
        this.restoreState(snapshot);
        throw error;
      }
    });
  }

  async checkReady(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  private ownerRoutineRows<T extends { ownerId: string; archivedAt: string | null }>(
    rows: Map<string, T>, userId: string, includeArchived = false
  ): T[] {
    return [...rows.values()].filter((item) => item.ownerId === userId && (includeArchived || item.archivedAt === null))
      .map((item) => structuredClone(item));
  }

  private assertRoutineOwner(ownerId: string): void {
    if (!this.users.has(ownerId)) throw new LifeLinkDomainError("routine_reference_conflict", "Routine owner was not found.");
  }

  private assertActiveRoutineGroup(ownerId: string, groupId: string): void {
    const group = this.routineGroups.get(groupId);
    if (!group || group.ownerId !== ownerId || group.archivedAt !== null) {
      throw new LifeLinkDomainError("routine_reference_conflict", "Routine Group was not found or is archived.");
    }
  }

  private assertRoutineGroupExists(ownerId: string, groupId: string): void {
    const group = this.routineGroups.get(groupId);
    if (!group || group.ownerId !== ownerId) {
      throw new LifeLinkDomainError("routine_reference_conflict", "Routine Group was not found for this owner.");
    }
  }

  private assertRoutineDefinitionReferences(
    ownerId: string, groupId: string | null, snapshot: RoutineRevisionSnapshot, requireActiveGroup = true
  ): void {
    if (groupId) {
      const group = this.routineGroups.get(groupId);
      if (!group || group.ownerId !== ownerId || (requireActiveGroup && group.archivedAt !== null)) {
        throw new LifeLinkDomainError("routine_reference_conflict", "Routine Group was not found for this owner or is unavailable for assignment.");
      }
    }
    for (const step of snapshot.steps) {
      const activity = this.routineActivities.get(step.activityId);
      if (!activity || activity.ownerId !== ownerId || activity.archivedAt !== null || activity.title !== step.activityTitle) {
        throw new LifeLinkDomainError("routine_reference_conflict", "Routine Step Activity was not found, changed title, or is archived.");
      }
    }
    for (const binding of snapshot.bindings) {
      const target = binding.targetType === "life_link" ? this.lifeLinks.get(binding.targetId) : this.collections.get(binding.targetId);
      if (!target || target.ownerId !== ownerId) throw new LifeLinkDomainError("routine_reference_conflict", "Routine context target was not found for this owner.");
    }
  }

  private assertRoutineScheduleReferences(schedule: RoutineScheduleRecord): void {
    const routine = this.routines.get(schedule.routineId);
    if (!routine || routine.ownerId !== schedule.ownerId || routine.archivedAt !== null || routine.currentRevisionId !== schedule.routineRevisionId) {
      throw new LifeLinkDomainError("routine_reference_conflict", "Routine Schedule must use the owner's active current Routine revision.");
    }
    this.assertRoutineRevisionActivitiesActive(schedule.ownerId, schedule.routineRevisionId);
  }

  private assertRoutineRevisionActivitiesActive(ownerId: string, revisionId: string): void {
    const archived = [...this.routineSteps.values()].some((step) => {
      if (step.ownerId !== ownerId || step.routineRevisionId !== revisionId) return false;
      return this.routineActivities.get(step.activityId)?.archivedAt !== null;
    });
    if (archived) throw new LifeLinkDomainError("routine_conflict", "A Routine Activity is archived.");
  }

  private deactivateRoutineSchedules(ownerId: string, routineIds: Set<string>, changedAt: string): void {
    const scheduleIds = new Set([...this.routineSchedules.values()]
      .filter((schedule) => schedule.ownerId === ownerId && schedule.active && routineIds.has(schedule.routineId))
      .map((schedule) => schedule.id));
    this.deactivateRoutineSchedulesById(ownerId, scheduleIds, changedAt);
  }

  private deactivateRoutineSchedulesById(ownerId: string, scheduleIds: Set<string>, changedAt: string): void {
    for (const [scheduleId, schedule] of this.routineSchedules) {
      if (schedule.ownerId !== ownerId || !schedule.active || !scheduleIds.has(scheduleId)) continue;
      const updatedAt = monotonicRoutineTimestamp(schedule.updatedAt, changedAt);
      this.routineSchedules.set(scheduleId, { ...schedule, active: false, revision: schedule.revision + 1, updatedAt });
      for (const [occurrenceId, occurrence] of this.routineOccurrences) {
        if (occurrence.ownerId === ownerId && occurrence.scheduleId === scheduleId && occurrence.status === "planned" && occurrence.plannedFor > updatedAt) {
          this.routineOccurrences.set(occurrenceId, { ...occurrence, status: "canceled", updatedAt });
        }
      }
    }
  }

  private persistMemoryRoutineCreation(candidate: CanonicalRoutineCreation): void {
    this.routines.set(candidate.routine.id, candidate.routine);
    this.routineRevisions.set(candidate.currentRevision.revision.id, candidate.currentRevision.revision);
    for (const step of candidate.currentRevision.steps) this.routineSteps.set(step.id, step);
    for (const binding of candidate.currentRevision.bindings) this.routineContextBindings.set(binding.id, binding);
  }

  private memoryRoutineCreation(routine: RoutineRecord): CanonicalRoutineCreation {
    return { routine: structuredClone(routine), currentRevision: this.memoryRoutineRevisionSnapshot(routine.ownerId, routine.id, routine.currentRevisionId)! };
  }

  private memoryRoutineRevisionSnapshot(userId: string, routineId: string, revisionId: string): RoutineRevisionSnapshot | null {
    const revision = this.routineRevisions.get(revisionId);
    if (!revision || revision.ownerId !== userId || revision.routineId !== routineId) return null;
    return {
      revision: structuredClone(revision),
      steps: [...this.routineSteps.values()].filter((item) => item.ownerId === userId && item.routineRevisionId === revisionId)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)).map((item) => structuredClone(item)),
      bindings: [...this.routineContextBindings.values()].filter((item) => item.ownerId === userId && item.routineRevisionId === revisionId)
        .sort(compareRoutineBindingRows).map((item) => structuredClone(item))
    };
  }

  private memoryRoutineContextSnapshot(userId: string, revision: RoutineRevisionSnapshot): RoutineContextSnapshot[] {
    return revision.bindings.map((binding) => {
      if (binding.targetType === "life_link") {
        const target = this.lifeLinks.get(binding.targetId);
        if (!target || target.ownerId !== userId) throw new LifeLinkDomainError("routine_reference_conflict", "Routine Life Link context no longer exists.");
        return { bindingId: binding.id, routineStepId: binding.routineStepId, targetType: binding.targetType,
          targetId: target.id, targetTitle: target.title, targetSourceUpdatedAt: target.updatedAt,
          resolvedLifeLinks: [{ lifeLinkId: target.id, title: target.title, sourceUpdatedAt: target.updatedAt }] };
      }
      const collection = this.collections.get(binding.targetId);
      if (!collection || collection.ownerId !== userId) throw new LifeLinkDomainError("routine_reference_conflict", "Routine Collection context no longer exists.");
      const memberIds = new Set([...this.collectionMemberships.values()].filter((item) => item.ownerId === userId && item.collectionId === collection.id).map((item) => item.lifeLinkId));
      const resolvedLifeLinks = [...this.lifeLinks.values()].filter((item) => item.ownerId === userId && memberIds.has(item.id))
        .sort(compareRoutineTitledRows).map((item) => ({ lifeLinkId: item.id, title: item.title, sourceUpdatedAt: item.updatedAt }));
      return { bindingId: binding.id, routineStepId: binding.routineStepId, targetType: binding.targetType,
        targetId: collection.id, targetTitle: collection.title, targetSourceUpdatedAt: collection.updatedAt, resolvedLifeLinks };
    });
  }

  private memoryBuiltSession(session: RoutineSessionRecord): BuiltRoutineSession {
    const run = this.routineRuns.get(session.runId)!;
    return { finalizedRun: structuredClone(run), session: structuredClone(session),
      stepResults: [...this.routineSessionStepResults.values()].filter((item) => item.sessionId === session.id).map((item) => structuredClone(item)) };
  }

  private assertCalendarOwner(ownerId: string): void {
    if (!this.users.has(ownerId)) {
      throw new CalendarDomainError("calendar_reference_conflict", "Calendar owner was not found.", { reason: "owner_not_found" });
    }
  }

  private assertAgentCalendarWrite(ownerId: string, calendarId: string, actor: CalendarActor): void {
    assertCalendarAgentConnection(this.users.get(ownerId), actor);
    if (actor === "human") return;
    const calendar = this.calendars.get(calendarId);
    if (!calendar || calendar.ownerId !== ownerId || calendar.deletedAt !== null || calendar.agentAccess !== "write") {
      throw new CalendarDomainError("calendar_access_denied", "Calendar agent write access is unavailable.", { reason: "agent_calendar_write_denied" });
    }
  }

  private clearOtherDefaultCalendars(ownerId: string, calendarId: string, changedAt: string): void {
    for (const [id, calendar] of this.calendars) {
      if (calendar.ownerId !== ownerId || id === calendarId || !calendar.isDefault || calendar.deletedAt !== null) continue;
      this.calendars.set(id, {
        ...calendar,
        isDefault: false,
        updatedAt: monotonicCalendarTimestamp(calendar.updatedAt, changedAt)
      });
    }
  }

  private memoryCalendarEventDetail(event: CalendarEventRecord): CalendarEventDetail {
    const currentRevision = this.calendarEventRevisions.get(event.currentRevisionId);
    if (!currentRevision || currentRevision.ownerId !== event.ownerId || currentRevision.eventId !== event.id) {
      throw new CalendarDomainError("calendar_reference_conflict", "Calendar event current revision is unavailable.", {
        reason: "current_revision_not_found"
      });
    }
    return { event: structuredClone(event), currentRevision: structuredClone(currentRevision) };
  }

  private assertCalendarEventReferences(event: CalendarEventRecord, revision: CalendarEventRevisionRecord): void {
    const calendar = this.calendars.get(event.calendarId);
    if (!calendar || calendar.ownerId !== event.ownerId || calendar.deletedAt !== null) {
      throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Calendar is unavailable.", {
        reason: "calendar_unavailable"
      });
    }
    assertNativeCalendarWriteAuthority(calendar);
    if (event.lineage.kind === "recurrence_exception") {
      const lineage = event.lineage;
      const master = this.calendarEvents.get(lineage.masterEventId);
      if (!master || master.ownerId !== event.ownerId || master.calendarId !== event.calendarId ||
        master.lineage.kind !== "recurrence_master" || master.deletedAt !== null) {
        throw new CalendarDomainError("calendar_reference_conflict", "Recurrence master is unavailable.", {
          reason: "recurrence_master_unavailable"
        });
      }
      const masterRevision = this.calendarEventRevisions.get(master.currentRevisionId);
      if (!masterRevision || !calendarRecurrenceIncludesOriginalOccurrence(masterRevision, lineage.originalOccurrence)) {
        throw new CalendarDomainError(
          "calendar_reference_conflict",
          "Recurrence exception does not name an occurrence generated by its master.",
          { reason: "recurrence_exception_not_generated" }
        );
      }
      const duplicate = [...this.calendarEvents.values()].some((item) => item.id !== event.id && item.ownerId === event.ownerId &&
        item.lineage.kind === "recurrence_exception" && item.lineage.masterEventId === lineage.masterEventId &&
        isDeepStrictEqual(item.lineage.originalOccurrence, lineage.originalOccurrence));
      if (duplicate) {
        throw new CalendarDomainError("calendar_conflict", "A recurrence exception already exists for this occurrence.", {
          reason: "duplicate_recurrence_exception"
        });
      }
    }
    for (const link of revision.subjectLinks) {
      if (link.kind === "life_link") {
        const lifeLink = this.lifeLinks.get(link.lifeLinkId);
        if (!lifeLink || lifeLink.ownerId !== event.ownerId) {
          throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Life Link is unavailable.", {
            reason: "life_link_unavailable"
          });
        }
        continue;
      }
      if (link.kind === "collection") {
        const collection = this.collections.get(link.collectionId);
        if (!collection || collection.ownerId !== event.ownerId) {
          throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Collection is unavailable.", {
            reason: "collection_unavailable"
          });
        }
        continue;
      }
      const routine = this.routines.get(link.routineId);
      if (!routine || routine.ownerId !== event.ownerId) {
        throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Routine is unavailable.", {
          reason: "routine_unavailable"
        });
      }
      if (link.kind === "routine_schedule") {
        const schedule = this.routineSchedules.get(link.scheduleId);
        if (!schedule || schedule.ownerId !== event.ownerId || schedule.routineId !== link.routineId) {
          throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Routine Schedule is unavailable.", {
            reason: "routine_schedule_unavailable"
          });
        }
      } else if (link.kind === "routine_occurrence") {
        const occurrence = this.routineOccurrences.get(link.occurrenceId);
        if (!occurrence || occurrence.ownerId !== event.ownerId || occurrence.routineId !== link.routineId ||
          occurrence.scheduleId !== link.scheduleId) {
          throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Routine Occurrence is unavailable.", {
            reason: "routine_occurrence_unavailable"
          });
        }
      } else if (link.kind === "routine_session") {
        const session = this.routineSessions.get(link.sessionId);
        if (!session || session.ownerId !== event.ownerId || session.routineId !== link.routineId) {
          throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Routine Session is unavailable.", {
            reason: "routine_session_unavailable"
          });
        }
      }
    }
  }

  private hydrateOwnerLifeLinks(userId: string): LifeLinkRecord[] {
    return Array.from(this.lifeLinks.values())
      .filter((lifeLink) => lifeLink.ownerId === userId)
      .map((lifeLink) => this.hydrateLifeLink(lifeLink));
  }

  private hydrateLifeLink(lifeLink: StoredLifeLink): LifeLinkRecord {
    return {
      ...lifeLink,
      context: structuredClone(lifeLink.context),
      publicFieldKeys: [...lifeLink.publicFieldKeys],
      bodyDoc: lifeLink.bodyDoc ? structuredClone(lifeLink.bodyDoc) : lifeLink.bodyDoc,
      qrId: this.bindingForLifeLink(lifeLink.id)?.qrId ?? null,
      media: this.mediaForLifeLink(lifeLink.id)
    };
  }

  private mediaForLifeLink(lifeLinkId: string): LifeLinkMediaRecord[] {
    return Array.from(this.media.values())
      .filter((media) => media.lifeLinkId === lifeLinkId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((media) => this.publicLifeLinkMedia(media));
  }

  private publicLifeLinkMedia(media: StoredLifeLinkMedia): LifeLinkMediaRecord {
    const { data: _data, ...record } = media;
    const qrId = this.bindingForLifeLink(media.lifeLinkId)?.qrId;
    return { ...record, url: qrId ? mediaUrl(qrId, media.id) : lifeLinkMediaUrl(media.lifeLinkId, media.id) };
  }

  private bindingForLifeLink(lifeLinkId: string): LifeLinkQrBindingRecord | null {
    return Array.from(this.qrBindings.values()).find((binding) => binding.lifeLinkId === lifeLinkId) ?? null;
  }

  private promoteParent(parentId: string | null, changedAt: string): void {
    const parent = parentId ? this.lifeLinks.get(parentId) : null;
    if (parent && parent.browsingRole !== "container") {
      this.lifeLinks.set(parent.id, {
        ...parent,
        browsingRole: "container",
        updatedAt: new Date(Math.max(Date.parse(parent.updatedAt) + 1, Date.parse(changedAt))).toISOString()
      });
    }
  }

  private ownedCollection(userId: string, collectionId: string): CollectionRecord | null {
    const collection = this.collections.get(normalizeCollectionId(collectionId));
    return collection?.ownerId === userId ? collection : null;
  }

  private touchCollection(collection: CollectionRecord, updatedAt = nextTimestamp(collection.updatedAt)): CollectionRecord {
    const next = { ...collection, updatedAt };
    this.collections.set(next.id, next);
    return copyCollection(next);
  }

  private sectionsForCollection(collectionId: string): CollectionSectionRecord[] {
    return Array.from(this.collectionSections.values())
      .filter((section) => section.collectionId === collectionId)
      .sort(compareCollectionSectionOrder);
  }

  private sectionAssignmentsForMember(collectionId: string, lifeLinkId: string): CollectionSectionAssignmentRecord[] {
    return Array.from(this.collectionSectionAssignments.values())
      .filter((assignment) => assignment.collectionId === collectionId && assignment.lifeLinkId === lifeLinkId);
  }

  private qrBindingReplay(
    userId: string,
    mode: "set" | "clear",
    command: SetLifeLinkQrBindingCommand | ClearLifeLinkQrBindingCommand
  ): LifeLinkRecord | null | undefined {
    const event = this.claimEvents.get(command.commandId);
    if (!event) {
      return undefined;
    }
    const requestedQrId = "qrId" in command ? command.qrId : null;
    if (event.ownerId !== userId || event.mode !== mode || event.qrId !== requestedQrId || event.requestedLifeLinkId !== command.lifeLinkId || event.expectedUpdatedAt !== command.expectedUpdatedAt) {
      throw new ClaimIdempotencyConflictError();
    }
    const current = this.lifeLinks.get(command.lifeLinkId);
    return current?.ownerId === userId ? this.hydrateLifeLink(current) : null;
  }

  private recordQrBindingCommand(
    userId: string,
    mode: "set" | "clear",
    command: SetLifeLinkQrBindingCommand | ClearLifeLinkQrBindingCommand
  ): void {
    this.claimEvents.set(command.commandId, {
      commandId: command.commandId,
      qrId: "qrId" in command ? command.qrId : null,
      ownerId: userId,
      mode,
      requestedLifeLinkId: command.lifeLinkId,
      resolvedLifeLinkId: command.lifeLinkId,
      result: mode === "set" ? "bound" : "unbound",
      expectedUpdatedAt: command.expectedUpdatedAt,
      createdAt: new Date().toISOString()
    });
  }

  private captureState(): InMemoryStoreSnapshot {
    return {
      users: new Map(this.users),
      userIdsByEmail: new Map(this.userIdsByEmail),
      sessions: new Map(this.sessions),
      lifeLinks: new Map(this.lifeLinks),
      collections: new Map(this.collections),
      collectionMemberships: new Map(this.collectionMemberships),
      collectionSections: new Map(this.collectionSections),
      collectionSectionAssignments: new Map(this.collectionSectionAssignments),
      qrInventory: new Map(this.qrInventory),
      qrBindings: new Map(this.qrBindings),
      media: new Map(this.media),
      batches: new Map(this.batches),
      batchQrIds: new Map(Array.from(this.batchQrIds, ([batchId, qrIds]) => [batchId, [...qrIds]])),
      claimEvents: new Map(this.claimEvents),
      routineGroups: new Map(this.routineGroups),
      routineActivities: new Map(this.routineActivities),
      routines: new Map(this.routines),
      routineRevisions: new Map(this.routineRevisions),
      routineSteps: new Map(this.routineSteps),
      routineContextBindings: new Map(this.routineContextBindings),
      routineSchedules: new Map(this.routineSchedules),
      routineOccurrences: new Map(this.routineOccurrences),
      routineRuns: new Map(this.routineRuns),
      routineSessions: new Map(this.routineSessions),
      routineSessionStepResults: new Map(this.routineSessionStepResults),
      routineSessionAmendments: new Map(this.routineSessionAmendments),
      calendars: new Map(this.calendars),
      calendarEvents: new Map(this.calendarEvents),
      calendarEventRevisions: new Map(this.calendarEventRevisions),
      calendarEventTombstones: new Map(this.calendarEventTombstones)
    };
  }

  private restoreState(snapshot: InMemoryStoreSnapshot): void {
    this.users = snapshot.users;
    this.userIdsByEmail = snapshot.userIdsByEmail;
    this.sessions = snapshot.sessions;
    this.lifeLinks = snapshot.lifeLinks;
    this.collections = snapshot.collections;
    this.collectionMemberships = snapshot.collectionMemberships;
    this.collectionSections = snapshot.collectionSections;
    this.collectionSectionAssignments = snapshot.collectionSectionAssignments;
    this.qrInventory = snapshot.qrInventory;
    this.qrBindings = snapshot.qrBindings;
    this.media = snapshot.media;
    this.batches = snapshot.batches;
    this.batchQrIds = snapshot.batchQrIds;
    this.claimEvents = snapshot.claimEvents;
    this.routineGroups = snapshot.routineGroups;
    this.routineActivities = snapshot.routineActivities;
    this.routines = snapshot.routines;
    this.routineRevisions = snapshot.routineRevisions;
    this.routineSteps = snapshot.routineSteps;
    this.routineContextBindings = snapshot.routineContextBindings;
    this.routineSchedules = snapshot.routineSchedules;
    this.routineOccurrences = snapshot.routineOccurrences;
    this.routineRuns = snapshot.routineRuns;
    this.routineSessions = snapshot.routineSessions;
    this.routineSessionStepResults = snapshot.routineSessionStepResults;
    this.routineSessionAmendments = snapshot.routineSessionAmendments;
    this.calendars = snapshot.calendars;
    this.calendarEvents = snapshot.calendarEvents;
    this.calendarEventRevisions = snapshot.calendarEventRevisions;
    this.calendarEventTombstones = snapshot.calendarEventTombstones;
  }

  private competitionFixtureCounts(ownerId: string): CompetitionFixtureCounts {
    const lifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((lifeLink) => lifeLink.ownerId === ownerId)
        .map((lifeLink) => lifeLink.id)
    );
    const batchIds = new Set(
      Array.from(this.batches.values())
        .filter((batch) => batch.createdBy === ownerId)
        .map((batch) => batch.id)
    );
    return {
      users: this.users.has(ownerId) ? 1 : 0,
      sessions: Array.from(this.sessions.values()).filter((session) => session.userId === ownerId).length,
      lifeLinks: lifeLinkIds.size,
      qrBindings: Array.from(this.qrBindings.values()).filter((binding) => lifeLinkIds.has(binding.lifeLinkId)).length,
      collections: Array.from(this.collections.values()).filter((item) => item.ownerId === ownerId).length,
      collectionSections: Array.from(this.collectionSections.values()).filter((item) => item.ownerId === ownerId).length,
      collectionMemberships: Array.from(this.collectionMemberships.values()).filter((item) => item.ownerId === ownerId).length,
      collectionSectionAssignments: Array.from(this.collectionSectionAssignments.values()).filter((item) => item.ownerId === ownerId).length,
      media: Array.from(this.media.values()).filter((item) => item.ownerId === ownerId).length,
      batches: batchIds.size,
      qrCodes: Array.from(this.qrInventory.values()).filter((qr) => Boolean(qr.batchId && batchIds.has(qr.batchId))).length,
      claimEvents: Array.from(this.claimEvents.values()).filter((event) => event.ownerId === ownerId).length,
      routineGroups: Array.from(this.routineGroups.values()).filter((item) => item.ownerId === ownerId).length,
      routineActivities: Array.from(this.routineActivities.values()).filter((item) => item.ownerId === ownerId).length,
      routines: Array.from(this.routines.values()).filter((item) => item.ownerId === ownerId).length,
      routineRevisions: Array.from(this.routineRevisions.values()).filter((item) => item.ownerId === ownerId).length,
      routineSteps: Array.from(this.routineSteps.values()).filter((item) => item.ownerId === ownerId).length,
      routineContextBindings: Array.from(this.routineContextBindings.values()).filter((item) => item.ownerId === ownerId).length,
      routineSchedules: Array.from(this.routineSchedules.values()).filter((item) => item.ownerId === ownerId).length,
      routineOccurrences: Array.from(this.routineOccurrences.values()).filter((item) => item.ownerId === ownerId).length,
      routineRuns: Array.from(this.routineRuns.values()).filter((item) => item.ownerId === ownerId).length,
      routineSessions: Array.from(this.routineSessions.values()).filter((item) => item.ownerId === ownerId).length,
      routineSessionStepResults: Array.from(this.routineSessionStepResults.values()).filter((item) => item.ownerId === ownerId).length,
      routineSessionAmendments: Array.from(this.routineSessionAmendments.values()).filter((item) => item.ownerId === ownerId).length,
      calendars: Array.from(this.calendars.values()).filter((item) => item.ownerId === ownerId).length,
      calendarEvents: Array.from(this.calendarEvents.values()).filter((item) => item.ownerId === ownerId).length,
      calendarEventRevisions: Array.from(this.calendarEventRevisions.values()).filter((item) => item.ownerId === ownerId).length,
      calendarEventSubjectLinks: Array.from(this.calendarEventRevisions.values()).filter((item) => item.ownerId === ownerId)
        .reduce((count, item) => count + item.subjectLinks.length, 0),
      calendarEventTombstones: Array.from(this.calendarEventTombstones.values()).filter((item) => item.ownerId === ownerId).length,
      calendarProviderConnections: 0,
      calendarProviderBindings: 0,
      calendarProviderSyncStates: 0,
      calendarProviderEventProjections: 0,
      calendarProviderEventProjectionRevisions: 0,
      calendarProviderEventTombstones: 0,
      calendarProviderEventTombstoneHistory: 0,
      calendarProviderOutbox: 0,
      calendarProviderWebhookHints: 0
    };
  }

  private assertCompetitionFixturePreflight(fixture: CompetitionFixtureData): void {
    const ownerId = fixture.owner.id;
    const fixtureLifeLinkIds = new Set(fixture.lifeLinks.map((item) => item.id));
    const fixtureQrIds = new Set(fixture.qrInventory.map((item) => item.id));
    const ownerLifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((item) => item.ownerId === ownerId)
        .map((item) => item.id)
    );
    const ownerBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((item) => item.createdBy === ownerId)
        .map((item) => item.id)
    );
    const ownerQrIds = new Set(
      Array.from(this.qrInventory.values())
        .filter((item) => Boolean(item.batchId && ownerBatchIds.has(item.batchId)))
        .map((item) => item.id)
    );
    const emailOwner = this.userIdsByEmail.get(fixture.owner.email.toLowerCase());
    if (emailOwner && emailOwner !== ownerId) {
      throw new Error("Competition fixture email is owned by another account.");
    }
    for (const id of fixtureLifeLinkIds) {
      const existing = this.lifeLinks.get(id);
      if (existing && existing.ownerId !== ownerId) {
        throw new Error("Competition fixture Life Link identity collides with another owner.");
      }
    }
    const existingBatch = this.batches.get(fixture.batch.id);
    if (existingBatch && existingBatch.createdBy !== ownerId) {
      throw new Error("Competition fixture batch identity collides with another owner.");
    }
    for (const batch of this.batches.values()) {
      if (batch.batchKey === fixture.batch.batchKey && batch.id !== fixture.batch.id && batch.createdBy !== ownerId) {
        throw new Error("Competition fixture batch key collides with another owner.");
      }
    }
    for (const id of fixtureQrIds) {
      const existing = this.qrInventory.get(id);
      if (existing && (!existing.batchId || !ownerBatchIds.has(existing.batchId))) {
        throw new Error("Competition fixture QR identity collides with another owner.");
      }
      const binding = this.qrBindings.get(id);
      const boundLifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
      if (binding && (!boundLifeLink || boundLifeLink.ownerId !== ownerId)) {
        throw new Error("Competition fixture QR binding collides with another owner.");
      }
    }
    for (const qrId of ownerQrIds) {
      const binding = this.qrBindings.get(qrId);
      const boundLifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
      if (binding && (!boundLifeLink || boundLifeLink.ownerId !== ownerId)) {
        throw new Error("Competition sandbox QR state is bound to another owner.");
      }
    }
    for (const binding of this.qrBindings.values()) {
      const boundLifeLink = this.lifeLinks.get(binding.lifeLinkId);
      if (boundLifeLink?.ownerId !== ownerId) {
        continue;
      }
      const qr = this.qrInventory.get(binding.qrId);
      if (!qr?.batchId || !ownerBatchIds.has(qr.batchId)) {
        throw new Error("Competition sandbox Life Link is bound to QR inventory outside its owner sandbox.");
      }
    }
    for (const item of fixture.collections) {
      const existing = this.collections.get(item.id);
      if (existing && existing.ownerId !== ownerId) throw new Error("Competition fixture Collection identity collides with another owner.");
    }
    for (const item of fixture.collectionSections) {
      const existing = this.collectionSections.get(item.id);
      if (existing && existing.ownerId !== ownerId) throw new Error("Competition fixture Section identity collides with another owner.");
    }
    for (const event of this.claimEvents.values()) {
      if (
        event.ownerId !== ownerId &&
        (fixtureQrIds.has(event.qrId ?? "") ||
          ownerQrIds.has(event.qrId ?? "") ||
          fixtureLifeLinkIds.has(event.requestedLifeLinkId ?? "") ||
          fixtureLifeLinkIds.has(event.resolvedLifeLinkId ?? "") ||
          ownerLifeLinkIds.has(event.requestedLifeLinkId ?? "") ||
          ownerLifeLinkIds.has(event.resolvedLifeLinkId ?? ""))
      ) {
        throw new Error("Competition fixture state is referenced by another owner.");
      }
    }
  }

  private replaceCompetitionFixture(fixture: CompetitionFixtureData, passwordHash: string): void {
    const ownerId = fixture.owner.id;
    const ownerLifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((item) => item.ownerId === ownerId)
        .map((item) => item.id)
    );
    const ownerBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((item) => item.createdBy === ownerId)
        .map((item) => item.id)
    );
    removeMapEntries(this.sessions, (session) => session.userId === ownerId);
    removeMapEntries(this.claimEvents, (event) => event.ownerId === ownerId);
    removeMapEntries(this.calendarEventTombstones, (item) => item.ownerId === ownerId);
    removeMapEntries(this.calendarEventRevisions, (item) => item.ownerId === ownerId);
    removeMapEntries(this.calendarEvents, (item) => item.ownerId === ownerId);
    removeMapEntries(this.calendars, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineSessionAmendments, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineSessionStepResults, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineSessions, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineRuns, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineOccurrences, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineSchedules, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineContextBindings, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineSteps, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineRevisions, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routines, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineActivities, (item) => item.ownerId === ownerId);
    removeMapEntries(this.routineGroups, (item) => item.ownerId === ownerId);
    removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.ownerId === ownerId);
    removeMapEntries(this.collectionMemberships, (membership) => membership.ownerId === ownerId);
    removeMapEntries(this.collectionSections, (section) => section.ownerId === ownerId);
    removeMapEntries(this.collections, (collection) => collection.ownerId === ownerId);
    removeMapEntries(this.media, (item) => item.ownerId === ownerId);
    removeMapEntries(this.attachmentText, (item) => item.source.ownerId === ownerId);
    removeMapEntries(this.qrBindings, (binding) => ownerLifeLinkIds.has(binding.lifeLinkId));
    removeMapEntries(this.lifeLinks, (item) => item.ownerId === ownerId);
    removeMapEntries(this.qrInventory, (qr) => Boolean(qr.batchId && ownerBatchIds.has(qr.batchId)));
    for (const batchId of ownerBatchIds) {
      this.batchQrIds.delete(batchId);
      this.batches.delete(batchId);
    }

    const existingOwner = this.users.get(ownerId);
    if (existingOwner) {
      this.userIdsByEmail.delete(existingOwner.email.toLowerCase());
    }
    this.users.set(ownerId, {
      ...fixture.owner,
      passwordHash,
      agentConnectedAt: existingOwner?.agentConnectedAt ?? null,
      agentToolCatalogId: existingOwner?.agentToolCatalogId ?? null
    });
    this.userIdsByEmail.set(fixture.owner.email.toLowerCase(), ownerId);
    this.batches.set(fixture.batch.id, { ...fixture.batch });
    this.batchQrIds.set(fixture.batch.id, fixture.qrInventory.map((item) => item.id));
    for (const qr of fixture.qrInventory) {
      this.qrInventory.set(qr.id, { ...qr });
    }
    for (const lifeLink of fixture.lifeLinks) {
      this.lifeLinks.set(lifeLink.id, withoutLifeLinkRelations(lifeLink));
    }
    for (const binding of fixture.qrBindings) {
      this.qrBindings.set(binding.qrId, { ...binding });
    }
    for (const item of fixture.collections) this.collections.set(item.id, { ...item });
    for (const item of fixture.collectionSections) this.collectionSections.set(item.id, { ...item });
    for (const item of fixture.collectionMemberships) this.collectionMemberships.set(membershipKey(item.collectionId, item.lifeLinkId), { ...item });
    for (const item of fixture.collectionSectionAssignments) this.collectionSectionAssignments.set(assignmentKey(item.collectionId, item.lifeLinkId, item.sectionId), { ...item });
  }

  private assertCompetitionFixturePostcondition(
    fixture: CompetitionFixtureData,
    passwordHash: string,
    actual: CompetitionFixtureCounts,
    expected: CompetitionFixtureCounts
  ): void {
    if (!sameCompetitionFixtureCounts(actual, expected)) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture reset produced unexpected account-local counts.");
    }
    const user = this.users.get(fixture.owner.id);
    if (
      !user ||
      user.email !== fixture.owner.email ||
      user.displayName !== fixture.owner.displayName ||
      user.createdAt !== fixture.owner.createdAt ||
      user.passwordHash !== passwordHash ||
      this.userIdsByEmail.get(fixture.owner.email.toLowerCase()) !== fixture.owner.id
    ) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture owner postcondition failed.");
    }
    if (
      JSON.stringify(this.batches.get(fixture.batch.id)) !== JSON.stringify(fixture.batch) ||
      JSON.stringify(this.batchQrIds.get(fixture.batch.id)) !==
        JSON.stringify(fixture.qrInventory.map((item) => item.id))
    ) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture batch postcondition failed.");
    }
    for (const expectedLifeLink of fixture.lifeLinks) {
      const actualLifeLink = this.lifeLinks.get(expectedLifeLink.id);
      if (!actualLifeLink || !sameStoredLifeLink(actualLifeLink, expectedLifeLink)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture Life Link postcondition failed.");
      }
    }
    for (const expectedQr of fixture.qrInventory) {
      if (JSON.stringify(this.qrInventory.get(expectedQr.id)) !== JSON.stringify(expectedQr)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture QR postcondition failed.");
      }
    }
    for (const expectedBinding of fixture.qrBindings) {
      if (JSON.stringify(this.qrBindings.get(expectedBinding.qrId)) !== JSON.stringify(expectedBinding)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture binding postcondition failed.");
      }
    }
    for (const item of fixture.collections) {
      if (JSON.stringify(this.collections.get(item.id)) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Collection postcondition failed.");
    }
    for (const item of fixture.collectionSections) {
      if (JSON.stringify(this.collectionSections.get(item.id)) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section postcondition failed.");
    }
    for (const item of fixture.collectionMemberships) {
      if (JSON.stringify(this.collectionMemberships.get(membershipKey(item.collectionId, item.lifeLinkId))) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture membership postcondition failed.");
    }
    for (const item of fixture.collectionSectionAssignments) {
      if (JSON.stringify(this.collectionSectionAssignments.get(assignmentKey(item.collectionId, item.lifeLinkId, item.sectionId))) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section assignment postcondition failed.");
    }
  }

  private projectTaggedLifeLink(lifeLink: StoredLifeLink): LinkRecord {
    const hydrated = this.hydrateLifeLink(lifeLink);
    const binding = this.bindingForLifeLink(lifeLink.id);
    if (!binding) {
      throw new LifeLinkDomainError("invalid_life_link", "Legacy Link projection requires a QR binding.");
    }
    const qr = this.qrInventory.get(binding.qrId);
    if (!qr) {
      throw new LifeLinkDomainError("invalid_life_link", "Legacy Link projection requires QR inventory.");
    }
    return projectLifeLinkAsLink(hydrated, qr);
  }

  private changeScope(userId: string, input: PreviewLifeLinkChangeInput) {
    return resolveLifeLinkChangeScope(this.hydrateOwnerLifeLinks(userId), userId, input);
  }

  private assertLifeLinksNotCurrentRoutineContext(userId: string, lifeLinkIds: Set<string>): void {
    const currentRevisionIds = new Set(
      [...this.routines.values()]
        .filter((routine) => routine.ownerId === userId)
        .map((routine) => routine.currentRevisionId)
    );
    const blocked = [...this.routineContextBindings.values()].some((binding) =>
      binding.ownerId === userId && binding.targetType === "life_link" &&
      currentRevisionIds.has(binding.routineRevisionId) && lifeLinkIds.has(binding.targetId)
    );
    if (blocked) {
      throw new LifeLinkDomainError("routine_reference_conflict", "A current Routine revision still references this Life Link.");
    }
  }

  private assertCollectionsNotCurrentRoutineContext(userId: string, collectionIds: Set<string>): void {
    const current = new Set([...this.routines.values()].filter((row) => row.ownerId === userId).map((row) => row.currentRevisionId));
    if ([...this.routineContextBindings.values()].some((row) => row.ownerId === userId && row.targetType === "collection" && current.has(row.routineRevisionId) && collectionIds.has(row.targetId))) {
      throw new LifeLinkDomainError("routine_reference_conflict", "A current Routine revision still references this Collection. Revise that Routine before deleting it.");
    }
  }

  private changeSideEffects(ids: string[]) {
    const selected = new Set(ids);
    return {
      lifeLinks: selected.size,
      media: [...this.media.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      qrBindings: [...this.qrBindings.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      collectionMemberships: [...this.collectionMemberships.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      collectionSectionAssignments: [...this.collectionSectionAssignments.values()].filter((row) => selected.has(row.lifeLinkId)).length
    };
  }

  private changeFingerprint(userId: string, input: PreviewLifeLinkChangeInput): string {
    const scope = this.changeScope(userId, input);
    const ids = new Set(scope.items.map((row) => row.id));
    const related = <T extends { lifeLinkId: string }>(map: Map<string, T>) => [...map].filter(([, row]) => ids.has(row.lifeLinkId)).sort(([a], [b]) => a.localeCompare(b));
    const routineBindings = [...this.routineContextBindings]
      .filter(([, row]) => row.ownerId === userId && row.targetType === "life_link" && ids.has(row.targetId) &&
        [...this.routines.values()].some((routine) => routine.ownerId === userId && routine.currentRevisionId === row.routineRevisionId))
      .sort(([left], [right]) => left.localeCompare(right));
    return createHash("sha256").update(stableChangeFingerprint({ ...scope,
      memberships: related(this.collectionMemberships), assignments: related(this.collectionSectionAssignments),
      bindings: related(this.qrBindings), routineBindings
    })).digest("hex");
  }

  private changeTables(): OwnerChangeSnapshot {
    return { lifeLinks: this.lifeLinks, collections: this.collections, collectionMemberships: this.collectionMemberships,
      collectionSections: this.collectionSections, collectionSectionAssignments: this.collectionSectionAssignments,
      qrBindings: this.qrBindings, media: this.media };
  }

  private ownerChangeSnapshot(ownerId: string): OwnerChangeSnapshot {
    const tables = this.changeTables();
    return Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, new Map([...rows].filter(([, value]) => {
      const row = value as { ownerId?: string; lifeLinkId?: string };
      return table === "qrBindings" ? this.lifeLinks.get(row.lifeLinkId!)?.ownerId === ownerId : row.ownerId === ownerId;
    }))])) as OwnerChangeSnapshot;
  }

  private async recordOwnerChange<T>(ownerId: string, label: string, work: () => Promise<T>): Promise<T> {
    const before = this.ownerChangeSnapshot(ownerId);
    const claimsBefore = new Map([...this.claimEvents].filter(([, row]) => row.ownerId === ownerId));
    try {
      const result = await work();
      const deltas = ownerChangeDeltas(before, this.ownerChangeSnapshot(ownerId), false);
      for (const delta of deltas) if (delta.table === "media") this.attachmentText.delete(delta.key);
      // Related parent rows may change only their revision when an association
      // changes. Retain those rows so Undo also invalidates stale parent edits.
      if (deltas.some((delta) => !sameChangeRow(delta.before, delta.after))) {
        const affectedIds = new Set<string>();
        for (const delta of deltas) {
          const row = (delta.before ?? delta.after) as { lifeLinkId?: string };
          if (delta.table === "lifeLinks") affectedIds.add(delta.key);
          if (row.lifeLinkId) affectedIds.add(row.lifeLinkId);
          if (["lifeLinks", "collections", "collectionSections"].includes(delta.table)) this.usedChangeIds.add(`${delta.table}\u0000${delta.key}`);
        }
        this.changeHistory.set(ownerId, [{ id: `change-${randomUUID()}`, label, createdAt: new Date().toISOString(), deltas, affectedIds: [...affectedIds] }, ...(this.changeHistory.get(ownerId) ?? [])].slice(0, CHANGE_HISTORY_LIMIT));
      }
      return result;
    } catch (error) {
      const tables = this.changeTables();
      for (const delta of ownerChangeDeltas(before, this.ownerChangeSnapshot(ownerId), false)) {
        if (delta.before === undefined) tables[delta.table].delete(delta.key);
        else tables[delta.table].set(delta.key, delta.before);
      }
      removeMapEntries(this.claimEvents, (row) => row.ownerId === ownerId);
      for (const [id, row] of claimsBefore) this.claimEvents.set(id, row);
      throw error;
    }
  }

  private async withMutationLocks<T>(keys: string[], ownerId: string, label: string, work: () => Promise<T>): Promise<T> {
    // The in-memory store has one event-loop transaction boundary. Only this
    // owner's row deltas are retained or restored; other owners are never snapshotted.
    return this.withLocks([CHANGE_MUTATION_LOCK, ...keys], () => this.recordOwnerChange(ownerId, label, work));
  }

  private assertFreshChangeIdentity(table: ChangeTable, id: string): void {
    if (this.usedChangeIds.has(`${table}\u0000${id}`)) throw new LifeLinkDomainError(
      table === "collections" ? "duplicate_collection_id" : table === "collectionSections" ? "duplicate_section_id" : "duplicate_life_link_id",
      "This stable identity has already been used.");
  }

  private qrReservedForAnotherOwner(ownerId: string | null, qrId: string): boolean {
    for (const [otherOwner, entries] of this.changeHistory) {
      if (otherOwner === ownerId) continue;
      if (entries.some((entry) => entry.deltas.some((delta) => delta.table === "qrBindings" && delta.key === qrId && delta.before !== undefined))) {
        return true;
      }
    }
    return false;
  }

  private assertQrHistoryAvailable(ownerId: string, qrId: string): void {
    if (this.qrReservedForAnotherOwner(ownerId, qrId)) throw new LifeLinkDomainError("qr_already_bound", "This QR is temporarily reserved by a recoverable owner change.");
  }

  private async changeReplay(ownerId: string, commandId: string, request: object): Promise<LifeLinkChangeResult | null> {
    if (typeof commandId !== "string" || !commandId.trim() || commandId.length > 128) throw new LifeLinkDomainError("invalid_life_link", "A stable command ID is required.");
    const receipt = this.changeReceipts.get(commandId);
    if (!receipt) return null;
    if (receipt.ownerId !== ownerId || receipt.collectionIds !== undefined || receipt.request !== stableChangeFingerprint(request)) throw new ClaimIdempotencyConflictError();
    return { operation: receipt.operation, affectedIds: [...receipt.affectedIds], history: await this.getChangeHistory(ownerId) };
  }

  private rememberChange(ownerId: string, commandId: string, request: object, result: LifeLinkChangeResult): void {
    this.changeReceipts.set(commandId, { ownerId, request: stableChangeFingerprint(request), operation: result.operation, affectedIds: [...result.affectedIds] });
  }

  private async withOwnerLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const predecessor = this.ownerLocks.get(ownerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = predecessor.then(() => current);
    this.ownerLocks.set(ownerId, queued);
    await predecessor;
    try {
      return await work();
    } finally {
      release();
      if (this.ownerLocks.get(ownerId) === queued) {
        this.ownerLocks.delete(ownerId);
      }
    }
  }

  private async withLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const acquire = (index: number): Promise<T> =>
      index >= ordered.length ? work() : this.withOwnerLock(ordered[index], () => acquire(index + 1));
    return acquire(0);
  }
}

function assertNativeCalendarWriteAuthority(calendar: CalendarRecord): void {
  if (calendar.source !== "native") {
    throw new CalendarDomainError(
      "calendar_conflict",
      "External Calendar changes must use the exact provider connection boundary.",
      { reason: "external_calendar_write_authority" }
    );
  }
}

function sameChangeRow(left: unknown, right: unknown): boolean {
  const comparable = (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const { updatedAt: _updatedAt, ...rest } = value as Record<string, unknown>;
    return rest;
  };
  return isDeepStrictEqual(comparable(left), comparable(right));
}

function ownerChangeDeltas(before: OwnerChangeSnapshot, after: OwnerChangeSnapshot, ignoreRevisions = true): ChangeDelta[] {
  const deltas: ChangeDelta[] = [];
  for (const table of Object.keys(before) as ChangeTable[]) {
    for (const key of new Set([...before[table].keys(), ...after[table].keys()])) {
      const previous = before[table].get(key); const next = after[table].get(key);
      if (ignoreRevisions ? sameChangeRow(previous, next) : isDeepStrictEqual(previous, next)) continue;
      deltas.push({ table, key, before: previous, after: next });
    }
  }
  return deltas;
}

function withoutLifeLinkRelations(lifeLink: LifeLinkRecord): StoredLifeLink {
  const { qrId: _qrId, media: _media, ...stored } = lifeLink;
  return stored;
}

function sameStoredLifeLink(existing: StoredLifeLink, candidate: LifeLinkRecord): boolean {
  return JSON.stringify(existing) === JSON.stringify(withoutLifeLinkRelations(candidate));
}

export function assertCompetitionFixtureResetMode(mode: string): asserts mode is CompetitionFixtureResetMode {
  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("Competition fixture reset mode must be dry-run or apply.");
  }
}

export function expectedCompetitionFixtureCounts(fixture: CompetitionFixtureData): CompetitionFixtureCounts {
  return {
    users: 1,
    sessions: 0,
    lifeLinks: fixture.lifeLinks.length,
    qrBindings: fixture.qrBindings.length,
    collections: fixture.collections.length,
    collectionSections: fixture.collectionSections.length,
    collectionMemberships: fixture.collectionMemberships.length,
    collectionSectionAssignments: fixture.collectionSectionAssignments.length,
    media: 0,
    batches: 1,
    qrCodes: fixture.qrInventory.length,
    claimEvents: 0,
    routineGroups: 0,
    routineActivities: 0,
    routines: 0,
    routineRevisions: 0,
    routineSteps: 0,
    routineContextBindings: 0,
    routineSchedules: 0,
    routineOccurrences: 0,
    routineRuns: 0,
    routineSessions: 0,
    routineSessionStepResults: 0,
    routineSessionAmendments: 0,
    calendars: 0,
    calendarEvents: 0,
    calendarEventRevisions: 0,
    calendarEventSubjectLinks: 0,
    calendarEventTombstones: 0,
    calendarProviderConnections: 0,
    calendarProviderBindings: 0,
    calendarProviderSyncStates: 0,
    calendarProviderEventProjections: 0,
    calendarProviderEventProjectionRevisions: 0,
    calendarProviderEventTombstones: 0,
    calendarProviderEventTombstoneHistory: 0,
    calendarProviderOutbox: 0,
    calendarProviderWebhookHints: 0
  };
}

export function createCompetitionFixtureResetReport(
  mode: CompetitionFixtureResetMode,
  before: CompetitionFixtureCounts,
  after: CompetitionFixtureCounts,
  expected: CompetitionFixtureCounts,
  shapeMatchesExpected: boolean
): CompetitionFixtureResetReport {
  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    ownerId: COMPETITION_OWNER_ID,
    mode,
    applied: mode === "apply",
    before,
    after,
    expected,
    shapeMatchesExpected
  };
}

export function sameCompetitionFixtureCounts(left: CompetitionFixtureCounts, right: CompetitionFixtureCounts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removeMapEntries<K, V>(map: Map<K, V>, predicate: (value: V) => boolean): void {
  for (const [key, value] of map) {
    if (predicate(value)) {
      map.delete(key);
    }
  }
}

function copyOwned<T extends { ownerId: string }>(value: T | undefined, ownerId: string): T | null {
  return value?.ownerId === ownerId ? structuredClone(value) : null;
}

function sameRoutinePayload(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

export function sameCalendarPayload(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

export function sameCalendarCreatePayload(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(withoutCalendarServerTimes(left), withoutCalendarServerTimes(right));
}

function withoutCalendarServerTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCalendarServerTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["createdAt", "updatedAt"].includes(key))
    .map(([key, item]) => [key, withoutCalendarServerTimes(item)]));
}

export function calendarConflict(message: string, reason: string): never {
  throw new CalendarDomainError("calendar_conflict", message, { reason });
}

function compareCalendarRows(left: CalendarRecord, right: CalendarRecord): number {
  return Number(right.isDefault) - Number(left.isDefault) ||
    left.title.normalize("NFKC").toLowerCase().localeCompare(right.title.normalize("NFKC").toLowerCase()) ||
    left.id.localeCompare(right.id);
}

export function compareCalendarEventDetails(left: CalendarEventDetail, right: CalendarEventDetail): number {
  return calendarEventStartKey(left.currentRevision).localeCompare(calendarEventStartKey(right.currentRevision)) ||
    left.event.id.localeCompare(right.event.id);
}

export function assertCalendarEventDateWindow(page: CalendarEventPageRequest): void {
  if ((page.startDate === undefined) !== (page.endDate === undefined)) {
    throw new CalendarDomainError("invalid_calendar_event", "Calendar event date window requires both bounds.", {
      reason: "incomplete_date_window"
    });
  }
  if (page.startDate === undefined || page.endDate === undefined) return;
  if (!isCalendarIsoDate(page.startDate) || !isCalendarIsoDate(page.endDate) || page.startDate > page.endDate) {
    throw new CalendarDomainError("invalid_calendar_event", "Calendar event date window is invalid.", {
      reason: "invalid_date_window"
    });
  }
}

export function calendarEventInDateWindow(detail: CalendarEventDetail, page: CalendarEventPageRequest): boolean {
  // A bounded read returns definitions for client/controller materialization.
  // Every recurrence master therefore needs every live exception, including an
  // occurrence moved out of the requested window; omitting that exception
  // would incorrectly resurrect the master's generated occurrence.
  if (page.startDate === undefined || page.endDate === undefined || detail.event.lineage.kind !== "standalone") return true;
  const span = detail.currentRevision.span;
  const startDate = span.kind === "all_day" ? span.startDate : span.startLocalDateTime.slice(0, 10);
  const endDateExclusive = span.kind === "all_day"
    ? span.endDateExclusive
    : span.endLocalDateTime.endsWith("T00:00")
      ? span.endLocalDateTime.slice(0, 10)
      : nextCalendarDate(span.endLocalDateTime.slice(0, 10));
  return startDate <= page.endDate && endDateExclusive > page.startDate;
}

function isCalendarIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = calendarUtcDate(year, month, day);
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function nextCalendarDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = calendarUtcDate(year, month, day + 1);
  return candidate.toISOString().slice(0, 10);
}

function calendarUtcDate(year: number, month: number, day: number): Date {
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate;
}

function calendarEventStartKey(revision: CalendarEventRevisionRecord): string {
  return revision.span.kind === "all_day" ? `${revision.span.startDate}T00:00:00.000Z` : revision.span.startInstant;
}

function monotonicCalendarTimestamp(previous: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(previous) ? candidate : new Date(Date.parse(previous) + 1).toISOString();
}

function sameRoutineCreatePayload(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(withoutRoutineServerTimes(left), withoutRoutineServerTimes(right));
}

function withoutRoutineServerTimes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRoutineServerTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["createdAt", "updatedAt", "startedAt", "completedAt"].includes(key))
    .map(([key, item]) => [key, withoutRoutineServerTimes(item)]));
}

function routineIdConflict(): never {
  throw new LifeLinkDomainError("routine_conflict", "Routine identity is already bound to another request.");
}

function assertRoutineUpdatedAt(actualUpdatedAt: string, expectedUpdatedAt: string): void {
  if (actualUpdatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_routine", "Routine state changed after it was read.", { retryable: true });
  }
}

function stableRoutineSessionResultId(sessionId: string, routineStepId: string): string {
  const hex = createHash("sha256").update(`${sessionId}\u0000${routineStepId}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
  return `routine-session-result-${uuid}`;
}

function compareRoutineTitledRows(left: { id: string; title: string }, right: { id: string; title: string }): number {
  return left.title.normalize("NFKC").toLowerCase().localeCompare(right.title.normalize("NFKC").toLowerCase()) || left.id.localeCompare(right.id);
}

function compareRoutineOccurrenceOrder(left: RoutineOccurrenceRecord, right: RoutineOccurrenceRecord): number {
  return left.plannedFor.localeCompare(right.plannedFor) || left.id.localeCompare(right.id);
}

function compareRoutineBindingRows(left: RoutineContextBindingRecord, right: RoutineContextBindingRecord): number {
  return (left.routineStepId ?? "").localeCompare(right.routineStepId ?? "") || left.targetType.localeCompare(right.targetType) ||
    left.targetId.localeCompare(right.targetId) || left.id.localeCompare(right.id);
}

function assertFresh(lifeLink: StoredLifeLink, expectedUpdatedAt: string): void {
  if (lifeLink.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_life_link", "Life Link changed after it was read.", { retryable: true });
  }
}

function copyCollection(collection: CollectionRecord): CollectionRecord {
  return { ...collection };
}

function membershipKey(collectionId: string, lifeLinkId: string): string {
  return JSON.stringify([collectionId, lifeLinkId]);
}

function assignmentKey(collectionId: string, lifeLinkId: string, sectionId: string): string {
  return JSON.stringify([collectionId, lifeLinkId, sectionId]);
}

function assertCollectionFresh(collection: CollectionRecord, expectedUpdatedAt: string): void {
  if (collection.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_collection", "Collection changed after it was read.", { retryable: true });
  }
}

function nextTimestamp(previous: string): string {
  const now = new Date();
  return now.getTime() > Date.parse(previous) ? now.toISOString() : new Date(Date.parse(previous) + 1).toISOString();
}

function monotonicRoutineTimestamp(previous: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(previous) ? candidate : new Date(Date.parse(previous) + 1).toISOString();
}

function lifeLinkMediaAsLinkMedia(media: LifeLinkMediaRecord, qrId: string): LinkMediaRecord {
  const { lifeLinkId: _lifeLinkId, ...record } = media;
  return { ...record, qrId, url: mediaUrl(qrId, media.id) };
}

function mediaUrl(qrId: string, mediaId: string): string {
  return `/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`;
}

function lifeLinkMediaUrl(lifeLinkId: string, mediaId: string): string {
  return `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(mediaId)}`;
}

function createUniqueBatchKey(batches: Map<string, ExportBatchRecord>): string {
  const known = new Set(Array.from(batches.values()).map((batch) => batch.batchKey));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const batchKey = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    if (!known.has(batchKey)) {
      return batchKey;
    }
  }
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function createUniqueQrIds(count: number, batchKey: string, qrCodes: Map<string, QrInventoryRecord>): string[] {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ids = generateQrIds(count, attempt === 0 ? batchKey : `${batchKey}${attempt}`);
    if (ids.every((id) => !qrCodes.has(id))) {
      return ids;
    }
  }
  throw new Error("Unable to generate a unique QR batch");
}
