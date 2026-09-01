import type {
  AttachmentContentPage,
  AttachmentContentReadOptions,
  AttachmentImageReadOptions,
  AttachmentImageResult,
  ActivityPatch,
  ActivityRecord,
  AppendRoutineSessionAmendmentCommand,
  ChangeHistory,
  CanonicalRoutineCreation,
  LifeLinkChangePreview,
  LifeLinkChangeResult,
  PreviewLifeLinkChangeInput,
  CollectionPatch,
  CollectionRecord,
  CollectionSectionMutationResult,
  CollectionSectionRecord,
  CreateCollectionCommand,
  CreateRoutineContextBindingInput,
  CreateRoutineStepInput,
  CreateLifeLinkInput,
  ExportBatchRecord,
  LifeLinkDetail,
  LifeLinkCollectionMembership,
  LifeLinkMediaRecord,
  LifeLinkRecord,
  LifeLinkSearchItem,
  LifeLinkSummary,
  LinkRecord,
  QrViewState,
  RoutineGroupPatch,
  RoutineGroupRecord,
  RoutineOccurrenceRecord,
  RoutinePatch,
  RoutineSummaryRecord,
  RoutineRevisionSnapshot,
  RoutineRunRecord,
  RoutineSchedulePatch,
  RoutineScheduleRecord,
  RoutineScheduleRule,
  RoutineSessionAmendmentRecord,
  RoutineSessionProjection,
  RoutineValue,
  UpdateLifeLinkPatch,
  UserRecord
} from "@life-links/core";
import { ATTACHMENT_IMAGE_MAX_BASE64_CHARS, MAX_LIFE_LINK_TOOL_OUTPUT_BYTES } from "@life-links/core";
import { validateAttachmentImageResult } from "./attachmentImage";
import { validateAttachmentTranscript } from "./attachmentTranscript";

export async function previewLifeLinkChange(input: PreviewLifeLinkChangeInput, signal?: AbortSignal): Promise<LifeLinkChangePreview> {
  const { preview } = await apiFetch<{ preview: LifeLinkChangePreview }>("/api/life-links/changes/preview", { method: "POST", body: JSON.stringify(input), signal });
  return preview;
}

export async function getLifeLinkChangePreview(previewId: string, signal?: AbortSignal): Promise<LifeLinkChangePreview> {
  let cursor: string | null = null;
  let result: LifeLinkChangePreview | null = null;
  const seen = new Set<string>();
  do {
    const query: string = cursor ? `cursor=${encodeURIComponent(cursor)}` : "";
    const page: { preview: LifeLinkChangePreview & { nextCursor: string | null } } = await apiFetch(`/api/life-links/changes/${encodeURIComponent(previewId)}?${query}`, { signal });
    if (result === null) result = page.preview;
    else result.items.push(...page.preview.items);
    cursor = page.preview.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Incomplete change preview: repeated continuation.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result!;
}

export function applyLifeLinkChange(previewId: string, commandId: string, signal?: AbortSignal): Promise<LifeLinkChangeResult> {
  return apiFetch("/api/life-links/changes/apply", { method: "POST", body: JSON.stringify({ previewId, commandId }), signal });
}

export function getChangeHistory(signal?: AbortSignal): Promise<ChangeHistory> {
  return apiFetch("/api/change-history", { signal });
}

export function undoChange(changeId: string, commandId: string, signal?: AbortSignal): Promise<LifeLinkChangeResult> {
  return apiFetch("/api/change-history/undo", { method: "POST", body: JSON.stringify({ changeId, commandId }), signal });
}

export type ApiUser = Pick<UserRecord, "id" | "email" | "displayName" | "createdAt">;

export type ApiAgentConnection = {
  connected: boolean;
  connectedAt: string | null;
};

export type ApiSession = {
  user: ApiUser | null;
  qrBaseUrl: string;
  agentConnection: ApiAgentConnection;
};

export type AuthenticatedApiSession = Omit<ApiSession, "user"> & { user: ApiUser };

async function apiFetch<T>(path: string, init: RequestInit = {}, maxResponseBytes?: number): Promise<T> {
  const bodyIsFormData = init.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      ...(bodyIsFormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const normalized = normalizeApiError(body);
    throw new ApiError(response.status, normalized.code, body, normalized);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  if (maxResponseBytes !== undefined) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing attachment image response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) throw new Error("Attachment image response exceeded its limit.");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  readonly retryable: boolean;
  readonly reason?: string;

  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly body: unknown,
    options: { message?: string; retryable?: boolean; reason?: string } = {}
  ) {
    super(options.message ?? defaultApiErrorMessage(code));
    this.name = "ApiError";
    this.retryable = options.retryable ?? false;
    this.reason = options.reason;
  }
}

type NormalizedApiError = {
  code: string;
  message: string;
  retryable: boolean;
  reason?: string;
};

function normalizeApiError(body: unknown): NormalizedApiError {
  const responseBody = objectRecord(body);
  const error = responseBody ? responseBody.error : undefined;

  if (typeof error === "string" && error.trim()) {
    const code = error.trim();
    return { code, message: defaultApiErrorMessage(code), retryable: false };
  }

  const structuredError = objectRecord(error);
  if (structuredError) {
    const code = nonEmptyString(structuredError.code) ?? "api_error";
    const reason = nonEmptyString(structuredError.reason);
    return {
      code,
      message: nonEmptyString(structuredError.message) ?? defaultApiErrorMessage(code),
      retryable: typeof structuredError.retryable === "boolean" ? structuredError.retryable : false,
      ...(reason ? { reason } : {})
    };
  }

  if (responseBody?.result === "owned_by_other") {
    return {
      code: "owned_by_other",
      message: "That QR code is already claimed by another account.",
      retryable: false
    };
  }

  return { code: "api_error", message: defaultApiErrorMessage("api_error"), retryable: false };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultApiErrorMessage(code: string): string {
  if (code === "api_error") {
    return "The request failed.";
  }
  const words = code.replace(/_/g, " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}.` : "The request failed.";
}

export async function getConfig() {
  return apiFetch<{ qrBaseUrl: string; maxBatchCount: number }>("/api/config");
}

export async function getMe() {
  return apiFetch<ApiSession>("/api/me");
}

export async function login(email: string, password: string) {
  return apiFetch<AuthenticatedApiSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function logout() {
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

export async function connectAgent() {
  return apiFetch<{ agentConnection: ApiAgentConnection }>("/api/agent-connection", {
    method: "PUT"
  });
}

export async function disconnectAgent() {
  return apiFetch<{ agentConnection: ApiAgentConnection }>("/api/agent-connection", {
    method: "DELETE"
  });
}

export type LifeLinkPageResponse = {
  lifeLinks: LifeLinkSummary[];
  nextCursor: string | null;
  truncated: boolean;
};

export type LifeLinkSearchResponse = {
  results: LifeLinkSearchItem[];
  totalCount: number;
  truncated: boolean;
  hasMore: boolean;
  nextCursor: string | null;
};

export async function listLifeLinks(options: { parentId?: string | null; cursor?: string | null; limit?: number; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams();
  if (options.parentId) {
    query.set("parentId", options.parentId);
  }
  if (options.cursor) {
    query.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiFetch<LifeLinkPageResponse>(`/api/life-links${suffix}`, { signal: options.signal });
}

export async function createLifeLink(input: CreateLifeLinkInput & { id?: string }, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ lifeLink: LifeLinkRecord }>("/api/life-links", {
    method: "POST",
    body: JSON.stringify(input), signal: options.signal
  });
}

export type PageOptions = { cursor?: string | null; limit?: number; signal?: AbortSignal };
export type RoutinePageOptions = PageOptions & { includeArchived?: boolean };
export type CollectionCreateInput = Pick<CreateCollectionCommand, "title" | "purpose" | "notes"> & { id?: string };
export type CollectionPageResponse = { collections: CollectionRecord[]; nextCursor: string | null; truncated: boolean };
export type CollectionDetailResponse = {
  collection: CollectionRecord;
  sections: CollectionSectionRecord[];
  sectionsPage: { nextCursor: string | null; truncated: boolean };
};
export type CollectionMembersResponse = { lifeLinks: LifeLinkRecord[]; nextCursor: string | null; truncated: boolean };
export type LifeLinkMembershipsResponse = { memberships: LifeLinkCollectionMembership[]; nextCursor: string | null; truncated: boolean };

function pageSuffix(options: RoutinePageOptions): string {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.includeArchived !== undefined) query.set("includeArchived", String(options.includeArchived));
  return query.size ? `?${query.toString()}` : "";
}

export type RoutineGroupCreateInput = { id?: string; title: string; notes?: string };
export type ActivityCreateInput = { id?: string; title: string; notes?: string };
export type RoutineStepInput = Omit<CreateRoutineStepInput, "id"> & { id?: string };
export type RoutineContextBindingInput = Omit<CreateRoutineContextBindingInput, "id"> & { id?: string };
export type RoutineCreateInput = {
  id?: string;
  revisionId?: string;
  groupId?: string | null;
  title: string;
  purpose?: string;
  instructions?: string;
  steps: RoutineStepInput[];
  bindings?: RoutineContextBindingInput[];
};
export type RoutineRevisionCreateInput = Omit<RoutineCreateInput, "id" | "groupId"> & {
  expectedCurrentRevisionId: string;
};
export type RoutineScheduleCreateInput = { id?: string; rule: RoutineScheduleRule; active?: boolean };
export type RoutineGroupPageResponse = { routineGroups: RoutineGroupRecord[]; nextCursor: string | null; truncated: boolean };
export type ActivityPageResponse = { activities: ActivityRecord[]; nextCursor: string | null; truncated: boolean };
export type RoutinePageResponse = { routines: RoutineSummaryRecord[]; nextCursor: string | null; truncated: boolean };
export type RoutineSchedulePageResponse = { schedules: RoutineScheduleRecord[]; nextCursor: string | null; truncated: boolean };
export type RoutineOccurrencePageResponse = { occurrences: RoutineOccurrenceRecord[]; nextCursor: string | null; truncated: boolean };
export type RoutineSessionPageResponse = { sessions: RoutineSessionProjection[]; nextCursor: string | null; truncated: boolean };

export function listRoutineGroups(options: RoutinePageOptions = {}) {
  return apiFetch<RoutineGroupPageResponse>(`/api/routine-groups${pageSuffix(options)}`, { signal: options.signal });
}

export function getRoutineGroup(groupId: string, signal?: AbortSignal) {
  return apiFetch<{ routineGroup: RoutineGroupRecord }>(`/api/routine-groups/${encodeURIComponent(groupId)}`, { signal });
}

export function createRoutineGroup(input: RoutineGroupCreateInput, signal?: AbortSignal) {
  return apiFetch<{ routineGroup: RoutineGroupRecord }>("/api/routine-groups", {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function updateRoutineGroup(groupId: string, expectedUpdatedAt: string, patch: RoutineGroupPatch, signal?: AbortSignal) {
  return apiFetch<{ routineGroup: RoutineGroupRecord }>(`/api/routine-groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH", body: JSON.stringify({ ...patch, expectedUpdatedAt }), signal
  });
}

export function listRoutineActivities(options: RoutinePageOptions = {}) {
  return apiFetch<ActivityPageResponse>(`/api/routine-activities${pageSuffix(options)}`, { signal: options.signal });
}

export function getRoutineActivity(activityId: string, signal?: AbortSignal) {
  return apiFetch<{ activity: ActivityRecord }>(`/api/routine-activities/${encodeURIComponent(activityId)}`, { signal });
}

export function createRoutineActivity(input: ActivityCreateInput, signal?: AbortSignal) {
  return apiFetch<{ activity: ActivityRecord }>("/api/routine-activities", {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function updateRoutineActivity(activityId: string, expectedUpdatedAt: string, patch: ActivityPatch, signal?: AbortSignal) {
  return apiFetch<{ activity: ActivityRecord }>(`/api/routine-activities/${encodeURIComponent(activityId)}`, {
    method: "PATCH", body: JSON.stringify({ ...patch, expectedUpdatedAt }), signal
  });
}

export function listRoutines(options: RoutinePageOptions = {}) {
  return apiFetch<RoutinePageResponse>(`/api/routines${pageSuffix(options)}`, { signal: options.signal });
}

export function getRoutine(routineId: string, signal?: AbortSignal) {
  return apiFetch<{ routine: CanonicalRoutineCreation }>(`/api/routines/${encodeURIComponent(routineId)}`, { signal });
}

export function createRoutine(input: RoutineCreateInput, signal?: AbortSignal) {
  return apiFetch<{ routine: CanonicalRoutineCreation }>("/api/routines", {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function updateRoutine(routineId: string, expectedUpdatedAt: string, patch: RoutinePatch, signal?: AbortSignal) {
  return apiFetch<{ routine: CanonicalRoutineCreation }>(`/api/routines/${encodeURIComponent(routineId)}`, {
    method: "PATCH", body: JSON.stringify({ ...patch, expectedUpdatedAt }), signal
  });
}

export function reviseRoutine(routineId: string, input: RoutineRevisionCreateInput, signal?: AbortSignal) {
  return apiFetch<{ routine: CanonicalRoutineCreation }>(`/api/routines/${encodeURIComponent(routineId)}/revisions`, {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function getRoutineRevision(routineId: string, revisionId: string, signal?: AbortSignal) {
  return apiFetch<{ routineRevision: RoutineRevisionSnapshot }>(
    `/api/routines/${encodeURIComponent(routineId)}/revisions/${encodeURIComponent(revisionId)}`,
    { signal }
  );
}

export function listRoutineSchedules(routineId: string, options: PageOptions = {}) {
  return apiFetch<RoutineSchedulePageResponse>(
    `/api/routines/${encodeURIComponent(routineId)}/schedules${pageSuffix(options)}`,
    { signal: options.signal }
  );
}

export function createRoutineSchedule(routineId: string, input: RoutineScheduleCreateInput, signal?: AbortSignal) {
  return apiFetch<{ schedule: RoutineScheduleRecord }>(`/api/routines/${encodeURIComponent(routineId)}/schedules`, {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function updateRoutineSchedule(scheduleId: string, expectedUpdatedAt: string, patch: RoutineSchedulePatch, signal?: AbortSignal) {
  return apiFetch<{ schedule: RoutineScheduleRecord }>(`/api/routine-schedules/${encodeURIComponent(scheduleId)}`, {
    method: "PATCH", body: JSON.stringify({ ...patch, expectedUpdatedAt }), signal
  });
}

export type RoutineOccurrenceListOptions = PageOptions & {
  routineId?: string;
  startDate?: string;
  endDate?: string;
};

export function listRoutineOccurrences(options: RoutineOccurrenceListOptions = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.routineId) query.set("routineId", options.routineId);
  if (options.startDate) query.set("startDate", options.startDate);
  if (options.endDate) query.set("endDate", options.endDate);
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiFetch<RoutineOccurrencePageResponse>(`/api/routine-occurrences${suffix}`, {
    signal: options.signal
  });
}

export function getRoutineOccurrence(occurrenceId: string, signal?: AbortSignal) {
  return apiFetch<{ occurrence: RoutineOccurrenceRecord }>(
    `/api/routine-occurrences/${encodeURIComponent(occurrenceId)}`,
    { signal }
  );
}

export function startRoutineRun(routineId: string, input: { id: string; occurrenceId?: string | null }, signal?: AbortSignal) {
  return apiFetch<{ run: RoutineRunRecord }>(`/api/routines/${encodeURIComponent(routineId)}/runs`, {
    method: "POST", body: JSON.stringify(input), signal
  });
}

export function getRoutineRun(runId: string, signal?: AbortSignal) {
  return apiFetch<{ run: RoutineRunRecord }>(`/api/routine-runs/${encodeURIComponent(runId)}`, { signal });
}

export function getActiveRoutineRun(routineId: string, signal?: AbortSignal) {
  return apiFetch<{ run: RoutineRunRecord | null }>(
    `/api/routines/${encodeURIComponent(routineId)}/active-run`,
    { signal }
  );
}

export function putRoutineRunStepResult(
  runId: string,
  routineStepId: string,
  input: { expectedUpdatedAt: string; actualValues: RoutineValue[]; proposedNextValues: RoutineValue[]; notes?: string },
  signal?: AbortSignal
) {
  return apiFetch<{ run: RoutineRunRecord }>(
    `/api/routine-runs/${encodeURIComponent(runId)}/step-results/${encodeURIComponent(routineStepId)}`,
    { method: "PUT", body: JSON.stringify(input), signal }
  );
}

export function finalizeRoutineRun(runId: string, input: { sessionId: string; expectedUpdatedAt: string }, signal?: AbortSignal) {
  return apiFetch<{ run: RoutineRunRecord; session: RoutineSessionProjection }>(
    `/api/routine-runs/${encodeURIComponent(runId)}/finalize`,
    { method: "POST", body: JSON.stringify(input), signal }
  );
}

export function listRoutineSessions(options: PageOptions & { routineId?: string } = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.routineId) query.set("routineId", options.routineId);
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiFetch<RoutineSessionPageResponse>(`/api/routine-sessions${suffix}`, { signal: options.signal });
}

export function getRoutineSession(sessionId: string, signal?: AbortSignal) {
  return apiFetch<{ session: RoutineSessionProjection }>(`/api/routine-sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export type RoutineSessionAmendmentInput = Omit<AppendRoutineSessionAmendmentCommand, "sessionId" | "createdAt">;

export function appendRoutineSessionAmendment(sessionId: string, input: RoutineSessionAmendmentInput, signal?: AbortSignal) {
  return apiFetch<{ amendment: RoutineSessionAmendmentRecord; session: RoutineSessionProjection }>(
    `/api/routine-sessions/${encodeURIComponent(sessionId)}/amendments`,
    { method: "POST", body: JSON.stringify(input), signal }
  );
}

export async function listCollections(options: PageOptions = {}) {
  return apiFetch<CollectionPageResponse>(`/api/collections${pageSuffix(options)}`, { signal: options.signal });
}

export async function getCollection(collectionId: string, options: PageOptions = {}) {
  return apiFetch<CollectionDetailResponse>(`/api/collections/${encodeURIComponent(collectionId)}${pageSuffix(options)}`, { signal: options.signal });
}

export async function createCollection(input: CollectionCreateInput, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>("/api/collections", { method: "POST", body: JSON.stringify(input), signal: options.signal });
}

export async function updateCollection(collectionId: string, expectedUpdatedAt: string, patch: CollectionPatch, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>(`/api/collections/${encodeURIComponent(collectionId)}`, {
    method: "PATCH", body: JSON.stringify({ ...patch, expectedUpdatedAt }), signal: options.signal
  });
}

export async function listCollectionMembers(collectionId: string, options: PageOptions = {}) {
  return apiFetch<CollectionMembersResponse>(`/api/collections/${encodeURIComponent(collectionId)}/members${pageSuffix(options)}`, { signal: options.signal });
}

export async function listLifeLinkCollectionMemberships(lifeLinkId: string, options: PageOptions = {}) {
  return apiFetch<LifeLinkMembershipsResponse>(`/api/life-links/${encodeURIComponent(lifeLinkId)}/collection-memberships${pageSuffix(options)}`, { signal: options.signal });
}

export async function addCollectionMember(collectionId: string, lifeLinkId: string, expectedUpdatedAt: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>(`/api/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(lifeLinkId)}`, {
    method: "PUT", body: JSON.stringify({ expectedUpdatedAt }), signal: options.signal
  });
}

export async function removeCollectionMember(collectionId: string, lifeLinkId: string, expectedUpdatedAt: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>(`/api/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(lifeLinkId)}`, {
    method: "DELETE", body: JSON.stringify({ expectedUpdatedAt }), signal: options.signal
  });
}

export async function createCollectionSection(collectionId: string, expectedUpdatedAt: string, input: { id?: string; title: string }, options: { signal?: AbortSignal } = {}) {
  return apiFetch<CollectionSectionMutationResult>(`/api/collections/${encodeURIComponent(collectionId)}/sections`, {
    method: "POST", body: JSON.stringify({ ...input, expectedUpdatedAt }), signal: options.signal
  });
}

export async function updateCollectionSection(collectionId: string, sectionId: string, expectedUpdatedAt: string, title: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<CollectionSectionMutationResult>(`/api/collections/${encodeURIComponent(collectionId)}/sections/${encodeURIComponent(sectionId)}`, {
    method: "PATCH", body: JSON.stringify({ title, expectedUpdatedAt }), signal: options.signal
  });
}

export async function removeCollectionSection(collectionId: string, sectionId: string, expectedUpdatedAt: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>(`/api/collections/${encodeURIComponent(collectionId)}/sections/${encodeURIComponent(sectionId)}`, {
    method: "DELETE", body: JSON.stringify({ expectedUpdatedAt }), signal: options.signal
  });
}

export async function replaceCollectionSectionAssignments(collectionId: string, lifeLinkId: string, expectedUpdatedAt: string, sectionIds: string[], options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ collection: CollectionRecord }>(`/api/collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(lifeLinkId)}/sections`, {
    method: "PUT", body: JSON.stringify({ sectionIds, expectedUpdatedAt }), signal: options.signal
  });
}

export async function setLifeLinkQrBinding(lifeLinkId: string, qrId: string, expectedUpdatedAt: string, commandId: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ lifeLink: LifeLinkRecord }>(`/api/life-links/${encodeURIComponent(lifeLinkId)}/qr-binding`, {
    method: "PUT", body: JSON.stringify({ commandId, qrId, expectedUpdatedAt }), signal: options.signal
  });
}

export async function clearLifeLinkQrBinding(lifeLinkId: string, expectedUpdatedAt: string, commandId: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ lifeLink: LifeLinkRecord }>(`/api/life-links/${encodeURIComponent(lifeLinkId)}/qr-binding`, {
    method: "DELETE", body: JSON.stringify({ commandId, expectedUpdatedAt }), signal: options.signal
  });
}

export async function getLifeLinkDetail(
  lifeLinkId: string,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
) {
  const query = new URLSearchParams();
  if (options.cursor) {
    query.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiFetch<{ detail: LifeLinkDetail }>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}${suffix}`,
    { signal: options.signal }
  );
}

export async function searchLifeLinks(
  q: string,
  options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
) {
  const query = new URLSearchParams({ q });
  if (options.cursor) {
    query.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  return apiFetch<LifeLinkSearchResponse>(`/api/life-links/search?${query.toString()}`, {
    signal: options.signal
  });
}

export async function updateLifeLink(
  lifeLinkId: string,
  expectedUpdatedAt: string,
  patch: UpdateLifeLinkPatch,
  options: { signal?: AbortSignal } = {}
) {
  return apiFetch<{ lifeLink: LifeLinkRecord }>(`/api/life-links/${encodeURIComponent(lifeLinkId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, expectedUpdatedAt }),
    signal: options.signal
  });
}

export async function moveLifeLink(lifeLinkId: string, parentId: string | null, expectedUpdatedAt: string, options: { signal?: AbortSignal } = {}) {
  return apiFetch<{ lifeLink: LifeLinkRecord }>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}/parent`,
    {
      method: "PATCH",
      body: JSON.stringify({ parentId, expectedUpdatedAt }), signal: options.signal
    }
  );
}

export async function uploadLifeLinkMedia(lifeLinkId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<{ media: LifeLinkMediaRecord }>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}/media`,
    { method: "POST", body }
  );
}

export async function getLifeLinkAttachmentContent(
  lifeLinkId: string,
  mediaId: string,
  options: AttachmentContentReadOptions & { signal?: AbortSignal } = {}
): Promise<AttachmentContentPage> {
  const query = new URLSearchParams();
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.revision !== undefined) query.set("revision", options.revision);
  for (const key of ["representation", "startMs", "durationMs", "audioStreamIndex"] as const) {
    if (options[key] !== undefined) query.set(key, String(options[key]));
  }
  const result = await apiFetch<AttachmentContentPage>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(mediaId)}/content?${query}`,
    { signal: options.signal }
  );
  const validated = options.representation === "transcript" ? validateAttachmentTranscript(result, mediaId, options) : result;
  options.signal?.throwIfAborted();
  return validated;
}

export async function getLifeLinkAttachmentImage(
  lifeLinkId: string, mediaId: string, options: AttachmentImageReadOptions, signal?: AbortSignal
): Promise<AttachmentImageResult> {
  const query = new URLSearchParams({ mode: options.mode });
  if (options.page !== undefined) query.set("page", String(options.page));
  if (options.frame !== undefined) query.set("frame", String(options.frame));
  if (options.atMs !== undefined) query.set("atMs", String(options.atMs));
  if (options.mode !== "describe") {
    query.set("sourceRevision", options.sourceRevision);
    if (options.maxEdge !== undefined) query.set("maxEdge", String(options.maxEdge));
    if (options.encoding !== undefined) query.set("encoding", options.encoding);
    if (options.mode === "crop") {
      for (const [key, value] of Object.entries(options.region)) query.set(key, String(value));
    }
  }
  const result = await apiFetch<unknown>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(mediaId)}/image?${query}`,
    { signal }, ATTACHMENT_IMAGE_MAX_BASE64_CHARS + MAX_LIFE_LINK_TOOL_OUTPUT_BYTES
  );
  const validated = await validateAttachmentImageResult(result, mediaId, options);
  signal?.throwIfAborted();
  return validated;
}

export async function deleteLifeLinkMedia(lifeLinkId: string, mediaId: string) {
  return apiFetch<void>(
    `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(mediaId)}`,
    { method: "DELETE" }
  );
}

export async function listLinks() {
  return apiFetch<{ links: LinkRecord[] }>("/api/links");
}

export async function uploadLinkMedia(qrId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<{ media: LinkRecord["media"][number] }>(`/api/links/${encodeURIComponent(qrId)}/media`, {
    method: "POST",
    body
  });
}

export async function deleteLinkMedia(qrId: string, mediaId: string) {
  return apiFetch<void>(`/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`, {
    method: "DELETE"
  });
}

export async function createQrBatch(count: number) {
  return apiFetch<{ batch: ExportBatchRecord; qrCodes: LinkRecord[] }>("/api/qr-batches", {
    method: "POST",
    body: JSON.stringify({ count })
  });
}

export async function getQr(qrId: string) {
  return apiFetch<QrViewState>(`/api/qr/${encodeURIComponent(qrId)}`);
}

export async function claimQr(qrId: string, commandId: string) {
  return apiFetch<{ result: string; state: QrViewState }>(`/api/qr/${encodeURIComponent(qrId)}/claim`, {
    method: "POST",
    body: JSON.stringify({ commandId })
  });
}

export async function attachQr(qrId: string, lifeLinkId: string, commandId: string) {
  return apiFetch<{ result: string; state: QrViewState }>(`/api/qr/${encodeURIComponent(qrId)}/claim`, {
    method: "POST",
    body: JSON.stringify({ commandId, mode: "attach", lifeLinkId })
  });
}

export async function findScan(targetQrId: string, scanText: string) {
  return apiFetch<{ targetQrId: string; scannedQrId: string | null; match: boolean }>("/api/find/scan", {
    method: "POST",
    body: JSON.stringify({ targetQrId, scanText })
  });
}
