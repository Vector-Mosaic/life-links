import {
  LifeLinkDomainError,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  assertLifeLinkBodyPatchIsCoordinated,
  assertLifeLinkContentWithinBounds,
  coordinateLifeLinkBody,
  createCanonicalLifeLink,
  isValidQrId,
  normalizeLifeLinkChildPageLimit,
  normalizeLinkBodyDoc,
  type CreateLifeLinkCommand,
  type LifeLinkPage,
  type LifeLinkPageRequest,
  type LifeLinkRecord,
  type UpdateLifeLinkPatch
} from "./index.js";

export type LifeLinkBrowsingRole = "container" | "item";
export type LifeLinkContextTruthState = "owner_reported" | "agent_inference" | "planned" | "unknown";
export type ContextValue = { text: string; truthState: LifeLinkContextTruthState };
export type LifeLinkContext = {
  schemaVersion: 1;
  summary?: ContextValue;
  condition?: ContextValue;
  experience?: ContextValue;
  plan?: ContextValue;
};
export const LIFE_LINK_CONTEXT_FIELDS = ["summary", "condition", "experience", "plan"] as const;
export const PUBLIC_FIELD_KEYS = ["notes", ...LIFE_LINK_CONTEXT_FIELDS] as const;
export type PublicFieldKey = (typeof PUBLIC_FIELD_KEYS)[number];
export const MAX_COLLECTION_PURPOSE_LENGTH = 500;
export const COLLECTION_ID_PREFIX = "collection-";
export const COLLECTION_SECTION_ID_PREFIX = "section-";
export const MAX_QR_COMMAND_ID_LENGTH = 128;

export type CollectionRecord = {
  id: string;
  ownerId: string;
  title: string;
  purpose: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
export type CollectionSectionRecord = {
  id: string;
  ownerId: string;
  collectionId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
};
export type CollectionMembershipRecord = {
  ownerId: string;
  collectionId: string;
  lifeLinkId: string;
  createdAt: string;
};
export type CollectionSectionAssignmentRecord = CollectionMembershipRecord & { sectionId: string };
export type LifeLinkCollectionMembership = { collection: CollectionRecord; sections: CollectionSectionRecord[] };
export type CollectionSectionMutationResult = { collection: CollectionRecord; section: CollectionSectionRecord };

export type CreateCollectionCommand = {
  id: string;
  ownerId: string;
  title: string;
  purpose?: string;
  notes?: string;
  createdAt: string;
};
export type CollectionPatch = Partial<Pick<CollectionRecord, "title" | "purpose" | "notes">>;
export type UpdateCollectionCommand = { collectionId: string; expectedUpdatedAt: string; patch: CollectionPatch };
export type CollectionMemberCommand = { collectionId: string; lifeLinkId: string; expectedUpdatedAt: string };
export type CreateCollectionSectionCommand = {
  id: string;
  collectionId: string;
  title: string;
  expectedUpdatedAt: string;
};
export type UpdateCollectionSectionCommand = {
  collectionId: string;
  sectionId: string;
  title: string;
  expectedUpdatedAt: string;
};
export type RemoveCollectionSectionCommand = { collectionId: string; sectionId: string; expectedUpdatedAt: string };
export type ReplaceCollectionSectionAssignmentsCommand = CollectionMemberCommand & { sectionIds: string[] };
export type SetLifeLinkQrBindingCommand = {
  commandId: string;
  lifeLinkId: string;
  qrId: string;
  expectedUpdatedAt: string;
};
export type ClearLifeLinkQrBindingCommand = {
  commandId: string;
  lifeLinkId: string;
  expectedUpdatedAt: string;
};

export function normalizeSetLifeLinkQrBindingCommand(value: unknown): SetLifeLinkQrBindingCommand {
  const common = normalizeQrBindingCommand(value, true);
  const qrId = (value as Record<string, unknown>).qrId;
  if (typeof qrId !== "string" || !isValidQrId(qrId.trim())) {
    throw new LifeLinkDomainError("invalid_life_link", "QR identity is invalid.", { reason: "invalid_qr_id" });
  }
  return { ...common, qrId: qrId.trim() };
}

export function normalizeClearLifeLinkQrBindingCommand(value: unknown): ClearLifeLinkQrBindingCommand {
  return normalizeQrBindingCommand(value, false);
}

export function normalizeLifeLinkBrowsingRole(value: unknown): LifeLinkBrowsingRole {
  if (value === "container" || value === "item") return value;
  throw new LifeLinkDomainError("invalid_life_link", "Life Link browsing role is invalid.", { reason: "invalid_browsing_role" });
}

/** Structured context is a complete value, with one shared character budget. */
export function normalizeLifeLinkContext(value: unknown): LifeLinkContext {
  if (!isPlainObject(value) || value.schemaVersion !== 1 ||
      Object.keys(value).some((key) => key !== "schemaVersion" && !LIFE_LINK_CONTEXT_FIELDS.includes(key as typeof LIFE_LINK_CONTEXT_FIELDS[number]))) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link context is invalid.", { reason: "invalid_context" });
  }
  const result: LifeLinkContext = { schemaVersion: 1 };
  let textLength = 0;
  for (const field of LIFE_LINK_CONTEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const entry = value[field];
    if (!isPlainObject(entry) || Object.keys(entry).some((key) => key !== "text" && key !== "truthState") ||
        typeof entry.text !== "string" || typeof entry.truthState !== "string" || !["owner_reported", "agent_inference", "planned", "unknown"].includes(entry.truthState)) {
      throw new LifeLinkDomainError("invalid_life_link", "Life Link context value is invalid.", { reason: "invalid_context_value" });
    }
    const text = normalizeText(entry.text);
    if (!text) throw new LifeLinkDomainError("invalid_life_link", "Life Link context value must not be empty.", { reason: "empty_context_value" });
    textLength += text.length;
    if (textLength > MAX_BODY_LENGTH) {
      throw new LifeLinkDomainError("invalid_life_link", "Life Link context exceeds the supported limit.", { reason: "context_too_long" });
    }
    result[field] = { text, truthState: entry.truthState as LifeLinkContextTruthState };
  }
  return result;
}

export function normalizePublicFieldKeys(value: unknown): PublicFieldKey[] {
  if (!Array.isArray(value) || value.some((key) => !PUBLIC_FIELD_KEYS.includes(key as PublicFieldKey))) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link public fields are invalid.", { reason: "invalid_public_fields" });
  }
  return PUBLIC_FIELD_KEYS.filter((key) => value.includes(key));
}

/** Shared store patch path. Role and placement change only via create/move. */
export function applyLifeLinkPatch(existing: LifeLinkRecord, patch: UpdateLifeLinkPatch, updatedAt: string): LifeLinkRecord {
  const keys = ["title", "body", "bodyDoc", "bodyDocVersion", "privacy", "context", "publicFieldKeys"];
  if (!isPlainObject(patch) || Object.keys(patch).some((key) => !keys.includes(key))) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link patch contains unsupported fields.", { reason: "invalid_patch" });
  }
  if ((patch.title !== undefined && typeof patch.title !== "string") ||
      (patch.body !== undefined && typeof patch.body !== "string") ||
      (patch.privacy !== undefined && patch.privacy !== "public" && patch.privacy !== "private")) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link patch value is invalid.", { reason: "invalid_patch" });
  }
  assertLifeLinkBodyPatchIsCoordinated(patch);
  const body = patch.body !== undefined || patch.bodyDoc !== undefined
    ? coordinateLifeLinkBody({ ...patch, bodyDocVersion: patch.bodyDocVersion ?? existing.bodyDocVersion })
    : { body: existing.body, bodyDoc: existing.bodyDoc, bodyDocVersion: existing.bodyDocVersion };
  const result: LifeLinkRecord = {
    ...existing,
    ...body,
    title: patch.title ?? existing.title,
    privacy: patch.privacy ?? existing.privacy,
    context: patch.context === undefined ? existing.context : normalizeLifeLinkContext(patch.context),
    publicFieldKeys: patch.publicFieldKeys === undefined ? existing.publicFieldKeys : normalizePublicFieldKeys(patch.publicFieldKeys),
    updatedAt
  };
  assertLifeLinkContentWithinBounds(result.title, result.body, result.bodyDoc);
  return result;
}

export function lifeLinkCreatePayloadMatches(existing: LifeLinkRecord, command: CreateLifeLinkCommand): boolean {
  const desired = createCanonicalLifeLink(command);
  const payload = (record: LifeLinkRecord) => ({
    id: record.id, ownerId: record.ownerId, parentId: record.parentId, title: record.title,
    body: record.body, bodyDoc: normalizeLinkBodyDoc(record.bodyDoc), bodyDocVersion: record.bodyDocVersion,
    privacy: record.privacy, browsingRole: record.browsingRole, context: normalizeLifeLinkContext(record.context),
    publicFieldKeys: normalizePublicFieldKeys(record.publicFieldKeys)
  });
  return JSON.stringify(payload(existing)) === JSON.stringify(payload(desired));
}

/** Migration-only additive defaults; does not infer historical placement time. */
export function migrateLifeLinksToFieldLedger<T extends Pick<LifeLinkRecord, "id" | "parentId" | "privacy">>(records: readonly T[]): Array<T & Pick<LifeLinkRecord, "browsingRole" | "context" | "placementConfirmedAt" | "publicFieldKeys">> {
  const parentIds = new Set(records.map((record) => record.parentId).filter(Boolean));
  return records.map((record) => ({
    ...record,
    browsingRole: parentIds.has(record.id) ? "container" : "item",
    context: { schemaVersion: 1 },
    placementConfirmedAt: null,
    publicFieldKeys: record.privacy === "public" ? ["notes"] : []
  }));
}

export function normalizeCollectionId(value: unknown): string {
  return normalizePrefixedId(value, COLLECTION_ID_PREFIX, "invalid_collection");
}

export function normalizeCollectionSectionId(value: unknown): string {
  return normalizePrefixedId(value, COLLECTION_SECTION_ID_PREFIX, "invalid_section");
}

export function createCanonicalCollection(command: CreateCollectionCommand): CollectionRecord {
  if (!isPlainObject(command) || Object.keys(command).some((key) => !["id", "ownerId", "title", "purpose", "notes", "createdAt"].includes(key))) {
    throw new LifeLinkDomainError("invalid_collection", "Collection create contains unsupported fields.", { reason: "invalid_create" });
  }
  const patch = normalizeCollectionPatch({ title: command.title, purpose: command.purpose ?? "", notes: command.notes ?? "" });
  if (typeof command.ownerId !== "string" || !command.ownerId.trim()) {
    throw new LifeLinkDomainError("invalid_collection", "Collection owner is invalid.", { reason: "invalid_owner" });
  }
  assertTimestamp(command.createdAt, "invalid_collection");
  return {
    id: normalizeCollectionId(command.id), ownerId: command.ownerId.trim(), title: patch.title!,
    purpose: patch.purpose!, notes: patch.notes!, createdAt: command.createdAt, updatedAt: command.createdAt
  };
}

export function normalizeCollectionPatch(value: unknown): CollectionPatch {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !["title", "purpose", "notes"].includes(key))) {
    throw new LifeLinkDomainError("invalid_collection", "Collection patch contains unsupported fields.", { reason: "invalid_patch" });
  }
  const result: CollectionPatch = {};
  for (const key of ["title", "purpose", "notes"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const limit = key === "title" ? MAX_TITLE_LENGTH : key === "purpose" ? MAX_COLLECTION_PURPOSE_LENGTH : MAX_BODY_LENGTH;
    result[key] = normalizeBoundedText(value[key], limit, key === "title", "invalid_collection");
  }
  return result;
}

export function normalizeCollectionSectionTitle(value: unknown): string {
  return normalizeBoundedText(value, MAX_TITLE_LENGTH, true, "invalid_section");
}

export function normalizeCollectionSectionIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new LifeLinkDomainError("invalid_section", "Section assignments must be an array.");
  return [...new Set(value.map(normalizeCollectionSectionId))].sort(compareText);
}

export function createCanonicalCollectionSection(command: {
  id: string; ownerId: string; collectionId: string; title: string; position: number; createdAt: string;
}): CollectionSectionRecord {
  if (typeof command.ownerId !== "string" || !command.ownerId.trim() ||
      !Number.isSafeInteger(command.position) || command.position < 0) {
    throw new LifeLinkDomainError("invalid_section", "Section owner or position is invalid.");
  }
  assertTimestamp(command.createdAt, "invalid_section");
  return {
    id: normalizeCollectionSectionId(command.id), ownerId: command.ownerId.trim(),
    collectionId: normalizeCollectionId(command.collectionId), title: normalizeCollectionSectionTitle(command.title),
    position: command.position, createdAt: command.createdAt, updatedAt: command.createdAt
  };
}

export function compareCollectionTitleOrder(left: { id: string; title: string }, right: { id: string; title: string }): number {
  return compareText(normalizeText(left.title).normalize("NFKC").toLowerCase(), normalizeText(right.title).normalize("NFKC").toLowerCase()) || compareText(left.id, right.id);
}

export function compareCollectionSectionOrder(left: CollectionSectionRecord, right: CollectionSectionRecord): number {
  return left.position - right.position || compareText(left.id, right.id);
}

/** Cursor references stable identity in an already deterministically ordered list. */
export function pageCollectionRecords<T extends { id: string }>(orderedRecords: readonly T[], page: LifeLinkPageRequest = {}): LifeLinkPage<T> {
  let start = 0;
  if (page.cursor) {
    let cursor: unknown;
    try { cursor = JSON.parse(decodeURIComponent(page.cursor)); } catch { throw invalidCollectionCursor(); }
    if (!isPlainObject(cursor) || cursor.version !== 1 || typeof cursor.id !== "string" || Object.keys(cursor).length !== 2) {
      throw invalidCollectionCursor();
    }
    const index = orderedRecords.findIndex((record) => record.id === cursor.id);
    if (index < 0) throw invalidCollectionCursor();
    start = index + 1;
  }
  const limit = normalizeLifeLinkChildPageLimit(page.limit);
  const items = orderedRecords.slice(start, start + limit);
  const truncated = start + items.length < orderedRecords.length;
  return {
    items, truncated,
    nextCursor: truncated && items.length ? encodeURIComponent(JSON.stringify({ version: 1, id: items[items.length - 1].id })) : null
  };
}

export function pageCollections(collections: readonly CollectionRecord[], ownerId: string, page: LifeLinkPageRequest = {}): LifeLinkPage<CollectionRecord> {
  return pageCollectionRecords(collections.filter((item) => item.ownerId === ownerId).sort(compareCollectionTitleOrder), page);
}

export function pageCollectionSections(sections: readonly CollectionSectionRecord[], ownerId: string, collectionId: string, page: LifeLinkPageRequest = {}): LifeLinkPage<CollectionSectionRecord> {
  return pageCollectionRecords(sections.filter((item) => item.ownerId === ownerId && item.collectionId === collectionId).sort(compareCollectionSectionOrder), page);
}

export function pageCollectionMembers(lifeLinks: readonly LifeLinkRecord[], memberships: readonly CollectionMembershipRecord[], ownerId: string, collectionId: string, page: LifeLinkPageRequest = {}): LifeLinkPage<LifeLinkRecord> {
  const memberIds = new Set(memberships.filter((item) => item.ownerId === ownerId && item.collectionId === collectionId).map((item) => item.lifeLinkId));
  return pageCollectionRecords(lifeLinks.filter((item) => item.ownerId === ownerId && memberIds.has(item.id)).sort(compareCollectionTitleOrder), page);
}

export function pageLifeLinkCollectionMemberships(collections: readonly CollectionRecord[], memberships: readonly CollectionMembershipRecord[], sections: readonly CollectionSectionRecord[], assignments: readonly CollectionSectionAssignmentRecord[], ownerId: string, lifeLinkId: string, page: LifeLinkPageRequest = {}): LifeLinkPage<LifeLinkCollectionMembership> {
  const memberCollectionIds = new Set(memberships.filter((item) => item.ownerId === ownerId && item.lifeLinkId === lifeLinkId).map((item) => item.collectionId));
  const collectionPage = pageCollections(collections.filter((item) => memberCollectionIds.has(item.id)), ownerId, page);
  return {
    ...collectionPage,
    items: collectionPage.items.map((collection) => {
      const sectionIds = new Set(assignments.filter((item) => item.ownerId === ownerId && item.collectionId === collection.id && item.lifeLinkId === lifeLinkId).map((item) => item.sectionId));
      return { collection, sections: sections.filter((section) => section.ownerId === ownerId && section.collectionId === collection.id && sectionIds.has(section.id)).sort(compareCollectionSectionOrder) };
    })
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeText(value: string): string { return value.replace(/\r\n?/g, "\n").trim(); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function normalizeBoundedText(value: unknown, limit: number, required: boolean, code: "invalid_collection" | "invalid_section"): string {
  if (typeof value !== "string") throw new LifeLinkDomainError(code, "Text value must be a string.");
  const normalized = normalizeText(value);
  if ((required && !normalized) || normalized.length > limit) throw new LifeLinkDomainError(code, "Text value is empty or exceeds the supported limit.");
  return normalized;
}
function normalizePrefixedId(value: unknown, prefix: string, code: "invalid_collection" | "invalid_section"): string {
  if (typeof value !== "string") throw new LifeLinkDomainError(code, "Identity is invalid.");
  const normalized = value.trim().toLowerCase();
  if (!new RegExp(`^${prefix}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(normalized)) {
    throw new LifeLinkDomainError(code, "Identity must be a prefixed UUID.", { reason: "invalid_id" });
  }
  return normalized;
}
function assertTimestamp(value: unknown, code: "invalid_collection" | "invalid_section" | "invalid_life_link"): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LifeLinkDomainError(code, "Timestamp is invalid.", { reason: "invalid_timestamp" });
  }
}
function normalizeQrBindingCommand(value: unknown, allowQrId: boolean): ClearLifeLinkQrBindingCommand {
  const fields = ["commandId", "lifeLinkId", "expectedUpdatedAt", ...(allowQrId ? ["qrId"] : [])];
  if (!isPlainObject(value) || Object.keys(value).some((key) => !fields.includes(key)) ||
      typeof value.commandId !== "string" || !value.commandId.trim() || value.commandId.trim().length > MAX_QR_COMMAND_ID_LENGTH ||
      typeof value.lifeLinkId !== "string" || !value.lifeLinkId.trim()) {
    throw new LifeLinkDomainError("invalid_life_link", "QR binding command is invalid.", { reason: "invalid_qr_command" });
  }
  assertTimestamp(value.expectedUpdatedAt, "invalid_life_link");
  return { commandId: value.commandId.trim(), lifeLinkId: value.lifeLinkId.trim(), expectedUpdatedAt: value.expectedUpdatedAt as string };
}
function invalidCollectionCursor(): LifeLinkDomainError {
  return new LifeLinkDomainError("invalid_collection", "Collection page cursor is invalid or no longer present.", { reason: "invalid_cursor" });
}
