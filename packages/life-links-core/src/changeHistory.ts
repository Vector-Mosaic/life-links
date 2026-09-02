import { LifeLinkDomainError, type LifeLinkRecord } from "./index.js";
import { normalizeCollectionId, normalizeCollectionSectionId, type CollectionRecord, type CollectionSectionRecord,
  type CollectionMembershipRecord, type CollectionSectionAssignmentRecord } from "./fieldLedger.js";

export const CHANGE_HISTORY_LIMIT = 5 as const;
export const MAX_CHANGE_SELECTION = 100;
export type LifeLinkChangeOperation = "move" | "delete";
export type PreviewLifeLinkChangeInput = { operation: LifeLinkChangeOperation; lifeLinkIds: string[]; parentId?: string | null };
export type LifeLinkChangePreviewItem = Pick<LifeLinkRecord, "id" | "title" | "parentId" | "browsingRole" | "updatedAt">;
export type LifeLinkChangeSideEffects = { lifeLinks: number; media: number; qrBindings: number; collectionMemberships: number; collectionSectionAssignments: number };
export type LifeLinkChangePreview = {
  id: string; operation: LifeLinkChangeOperation; rootIds: string[]; items: LifeLinkChangePreviewItem[];
  parentId: string | null; target: LifeLinkChangePreviewItem | null; sideEffects: LifeLinkChangeSideEffects; createdAt: string;
};
export type LifeLinkChangePreviewPage = LifeLinkChangePreview & { nextCursor: string | null; totalItems: number };
export type ApplyLifeLinkChangeInput = { previewId: string; commandId: string };
export type UndoChangeInput = { changeId: string; commandId: string };
export type ChangeHistoryEntry = { id: string; label: string; createdAt: string };
export type ChangeHistory = { limit: typeof CHANGE_HISTORY_LIMIT; entries: ChangeHistoryEntry[] };
export type LifeLinkChangeResult = { operation: LifeLinkChangeOperation | "undo"; affectedIds: string[]; history: ChangeHistory };
export type LifeLinkChangeScope = { rootIds: string[]; items: LifeLinkRecord[]; parentId: string | null; target: LifeLinkRecord | null };

/** Resolve the complete physical closure, never a paginated browser projection. */
export function resolveLifeLinkChangeScope(records: readonly LifeLinkRecord[], userId: string, input: PreviewLifeLinkChangeInput): LifeLinkChangeScope {
  if (!input || !["move", "delete"].includes(input.operation) || !Array.isArray(input.lifeLinkIds) || !input.lifeLinkIds.length || input.lifeLinkIds.length > MAX_CHANGE_SELECTION || input.lifeLinkIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new LifeLinkDomainError("invalid_life_link", "Choose between one and 100 Life Links.");
  }
  if (input.operation === "move" && !(input.parentId === null || typeof input.parentId === "string")) throw new LifeLinkDomainError("invalid_parent", "A move destination is required.");
  if (input.operation === "delete" && input.parentId !== undefined) throw new LifeLinkDomainError("invalid_life_link", "Delete does not accept a destination.");
  const byId = new Map(records.filter((row) => row.ownerId === userId).map((row) => [row.id, row]));
  const selected = new Set(input.lifeLinkIds);
  for (const id of selected) if (!byId.has(id)) throw new LifeLinkDomainError("life_link_not_found", "A selected Life Link is unavailable.");
  const rootIds = [...selected].filter((id) => {
    const visited = new Set<string>([id]);
    let parentId = byId.get(id)!.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new LifeLinkDomainError("hierarchy_cycle", "The hierarchy contains a cycle.");
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) throw new LifeLinkDomainError("invalid_parent", "A recorded parent is unavailable.");
      parentId = parent.parentId;
    }
    return true;
  }).sort();
  const children = new Map<string, LifeLinkRecord[]>();
  for (const record of byId.values()) if (record.parentId) children.set(record.parentId, [...(children.get(record.parentId) ?? []), record]);
  const items: LifeLinkRecord[] = [];
  const seen = new Set<string>();
  const pending = [...rootIds].reverse();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) throw new LifeLinkDomainError("hierarchy_cycle", "The hierarchy contains a cycle.");
    seen.add(id);
    items.push(byId.get(id)!);
    pending.push(...(children.get(id) ?? []).map((row) => row.id).sort().reverse());
  }
  const parentId = input.operation === "move" ? input.parentId! : null;
  const target = parentId === null ? null : byId.get(parentId) ?? null;
  if (parentId !== null && (!target || target.browsingRole !== "container")) throw new LifeLinkDomainError("invalid_parent", "Choose an owned folder or My Life Links.");
  if (parentId !== null && seen.has(parentId)) throw new LifeLinkDomainError("hierarchy_cycle", "A selection cannot move into itself or its descendants.");
  return { rootIds, items, parentId, target };
}

export function lifeLinkChangePreviewItem(record: LifeLinkRecord): LifeLinkChangePreviewItem {
  return { id: record.id, title: record.title, parentId: record.parentId, browsingRole: record.browsingRole, updatedAt: record.updatedAt };
}

/** Store-private comparison material: never expose this content in HTTP or logs. */
export function stableChangeFingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)])) : item;
  return JSON.stringify(normalize(value));
}

export type CollectionChangeReference = { collectionId: string; expectedUpdatedAt: string };
export type CollectionChangeMember = { lifeLinkId: string; sourceSectionId: string | null };
export type CollectionChangeTarget = CollectionChangeReference & { sectionId: string | null };
export type CollectionChangeInput =
  | { operation: "delete"; scope: "collections"; collections: CollectionChangeReference[] }
  | { operation: "delete"; scope: "contents"; source: CollectionChangeReference; sectionIds: string[]; members: CollectionChangeMember[] }
  | { operation: "move"; scope: "contents"; source: CollectionChangeReference; sectionIds: string[]; members: CollectionChangeMember[]; target: CollectionChangeTarget };
export type CollectionChangeSideEffects = {
  collectionsRemoved: number; sectionsRemoved: number; sectionsMoved: number;
  membershipsRemoved: number; membershipsAdded: number; assignmentsRemoved: number; assignmentsAdded: number; lifeLinksDeleted: 0;
};
export type CollectionChangePreview = {
  domain: "collections"; id: string; input: CollectionChangeInput; collections: CollectionRecord[];
  sections: CollectionSectionRecord[]; members: Array<CollectionChangeMember & { title: string }>;
  targetCollection: CollectionRecord | null; targetSection: CollectionSectionRecord | null;
  sideEffects: CollectionChangeSideEffects; createdAt: string;
};
export type CollectionChangeResult = { operation: "delete" | "move"; collectionIds: string[]; lifeLinkIds: string[]; history: ChangeHistory };
export type CollectionChangeState = {
  collections: CollectionRecord[]; sections: CollectionSectionRecord[]; memberships: CollectionMembershipRecord[];
  assignments: CollectionSectionAssignmentRecord[]; lifeLinks: Array<Pick<LifeLinkRecord, "id" | "ownerId" | "title">>;
};
export type CollectionChangePlan = {
  preview: Omit<CollectionChangePreview, "id" | "createdAt">; next: CollectionChangeState;
  collectionIds: string[]; lifeLinkIds: string[]; deletedCollectionIds: string[];
};

function collectionChangeInvalid(message: string): never { throw new LifeLinkDomainError("invalid_collection", message); }
function changeObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    collectionChangeInvalid("Collection change contains unsupported fields.");
  }
  return value as Record<string, unknown>;
}
function collectionChangeReference(value: unknown, target = false): CollectionChangeReference | CollectionChangeTarget {
  const row = changeObject(value, target ? ["collectionId", "expectedUpdatedAt", "sectionId"] : ["collectionId", "expectedUpdatedAt"]);
  if (typeof row.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(row.expectedUpdatedAt))) collectionChangeInvalid("A Collection revision is required.");
  const reference = { collectionId: normalizeCollectionId(row.collectionId), expectedUpdatedAt: row.expectedUpdatedAt };
  return target ? { ...reference, sectionId: row.sectionId === null ? null : normalizeCollectionSectionId(row.sectionId) } : reference;
}

export function normalizeCollectionChangeInput(value: unknown): CollectionChangeInput {
  const row = changeObject(value, ["operation", "scope", "collections", "source", "sectionIds", "members", "target"]);
  if (row.scope === "collections") {
    if (row.operation !== "delete" || Object.keys(row).some((key) => !["operation", "scope", "collections"].includes(key)) ||
        !Array.isArray(row.collections) || !row.collections.length || row.collections.length > MAX_CHANGE_SELECTION) collectionChangeInvalid("Choose between one and 100 Collections to delete.");
    const references = row.collections.map((item) => collectionChangeReference(item));
    const byId = new Map<string, CollectionChangeReference>();
    for (const reference of references) {
      if (byId.has(reference.collectionId) && byId.get(reference.collectionId)!.expectedUpdatedAt !== reference.expectedUpdatedAt) collectionChangeInvalid("A Collection has conflicting revisions.");
      byId.set(reference.collectionId, reference);
    }
    return { operation: "delete", scope: "collections", collections: [...byId.values()].sort((a, b) => a.collectionId.localeCompare(b.collectionId)) };
  }
  if (row.scope !== "contents" || !["delete", "move"].includes(String(row.operation)) || row.collections !== undefined ||
      !Array.isArray(row.sectionIds) || !Array.isArray(row.members) || !row.sectionIds.length && !row.members.length ||
      row.sectionIds.length + row.members.length > MAX_CHANGE_SELECTION) collectionChangeInvalid("Choose between one and 100 Collection entries.");
  const source = collectionChangeReference(row.source);
  const sectionIds = [...new Set(row.sectionIds.map(normalizeCollectionSectionId))].sort();
  const members = row.members.map((value) => {
    const member = changeObject(value, ["lifeLinkId", "sourceSectionId"]);
    if (typeof member.lifeLinkId !== "string" || !member.lifeLinkId.trim() || member.lifeLinkId.length > 512) collectionChangeInvalid("A Life Link identity is required.");
    return { lifeLinkId: member.lifeLinkId, sourceSectionId: member.sourceSectionId === null ? null : normalizeCollectionSectionId(member.sourceSectionId) };
  });
  const uniqueMembers = [...new Map(members.map((member) => [JSON.stringify([member.lifeLinkId, member.sourceSectionId]), member])).values()]
    .sort((a, b) => a.lifeLinkId.localeCompare(b.lifeLinkId) || (a.sourceSectionId ?? "").localeCompare(b.sourceSectionId ?? ""));
  if (row.operation === "delete") {
    if (row.target !== undefined) collectionChangeInvalid("Removal does not accept a destination.");
    return { operation: "delete", scope: "contents", source, sectionIds, members: uniqueMembers };
  }
  const target = collectionChangeReference(row.target, true) as CollectionChangeTarget;
  if (sectionIds.length && (source.collectionId === target.collectionId || target.sectionId !== null)) collectionChangeInvalid("Whole Sections must move to another Collection, not into a Section.");
  if (source.collectionId === target.collectionId && source.expectedUpdatedAt !== target.expectedUpdatedAt) collectionChangeInvalid("Source and destination revisions disagree.");
  return { operation: "move", scope: "contents", source, sectionIds, members: uniqueMembers, target };
}

/** Plan purpose-edge changes only. Physical Life Links are never written here. */
export function planCollectionChange(state: CollectionChangeState, ownerId: string, rawInput: unknown, changedAt: string): CollectionChangePlan {
  const input = normalizeCollectionChangeInput(rawInput);
  const byId = new Map(state.collections.filter((row) => row.ownerId === ownerId).map((row) => [row.id, row]));
  const references = input.scope === "collections" ? input.collections : [input.source, ...(input.operation === "move" ? [input.target] : [])];
  const collections = [...new Map(references.map((reference) => {
    const row = byId.get(reference.collectionId);
    if (!row) throw new LifeLinkDomainError("collection_not_found", "A selected Collection is unavailable.");
    if (row.updatedAt !== reference.expectedUpdatedAt) throw new LifeLinkDomainError("stale_collection", "The Collection changed. Review a fresh selection.");
    return [row.id, row] as const;
  })).values()];
  const next: CollectionChangeState = { ...state, collections: [...state.collections], sections: [...state.sections], memberships: [...state.memberships], assignments: [...state.assignments] };
  const sections: CollectionSectionRecord[] = [];
  const members: CollectionChangePreview["members"] = [];
  const deletedCollectionIds = input.scope === "collections" ? input.collections.map((row) => row.collectionId) : [];
  let targetCollection: CollectionRecord | null = null;
  let targetSection: CollectionSectionRecord | null = null;
  const membershipKey = (row: CollectionMembershipRecord) => JSON.stringify([row.ownerId, row.collectionId, row.lifeLinkId]);
  const assignmentKey = (row: CollectionSectionAssignmentRecord) => JSON.stringify([row.ownerId, row.collectionId, row.lifeLinkId, row.sectionId]);
  const removeMembership = (collectionId: string, lifeLinkId: string) => {
    next.memberships = next.memberships.filter((row) => !(row.ownerId === ownerId && row.collectionId === collectionId && row.lifeLinkId === lifeLinkId));
    next.assignments = next.assignments.filter((row) => !(row.ownerId === ownerId && row.collectionId === collectionId && row.lifeLinkId === lifeLinkId));
  };
  const ensureMembership = (collectionId: string, lifeLinkId: string) => {
    if (!next.memberships.some((row) => row.ownerId === ownerId && row.collectionId === collectionId && row.lifeLinkId === lifeLinkId)) next.memberships.push({ ownerId, collectionId, lifeLinkId, createdAt: changedAt });
  };
  const ensureAssignment = (collectionId: string, sectionId: string, lifeLinkId: string) => {
    if (!next.assignments.some((row) => row.ownerId === ownerId && row.collectionId === collectionId && row.sectionId === sectionId && row.lifeLinkId === lifeLinkId)) next.assignments.push({ ownerId, collectionId, sectionId, lifeLinkId, createdAt: changedAt });
  };
  if (input.scope === "collections") {
    next.collections = next.collections.filter((row) => !deletedCollectionIds.includes(row.id));
    next.sections = next.sections.filter((row) => !deletedCollectionIds.includes(row.collectionId));
    next.memberships = next.memberships.filter((row) => !deletedCollectionIds.includes(row.collectionId));
    next.assignments = next.assignments.filter((row) => !deletedCollectionIds.includes(row.collectionId));
  } else {
    const sourceId = input.source.collectionId;
    for (const sectionId of input.sectionIds) {
      const section = state.sections.find((row) => row.id === sectionId && row.ownerId === ownerId && row.collectionId === sourceId);
      if (!section) throw new LifeLinkDomainError("section_not_found", "A selected Section is unavailable.");
      sections.push(section);
    }
    for (const member of input.members) {
      const lifeLink = state.lifeLinks.find((row) => row.id === member.lifeLinkId && row.ownerId === ownerId);
      if (!lifeLink || !state.memberships.some((row) => row.ownerId === ownerId && row.collectionId === sourceId && row.lifeLinkId === member.lifeLinkId)) throw new LifeLinkDomainError("collection_membership_not_found", "A selected Collection member is unavailable.");
      if (member.sourceSectionId !== null && !state.assignments.some((row) => row.ownerId === ownerId && row.collectionId === sourceId && row.lifeLinkId === member.lifeLinkId && row.sectionId === member.sourceSectionId)) throw new LifeLinkDomainError("section_not_found", "A selected Section assignment is unavailable.");
      members.push({ ...member, title: lifeLink.title });
    }
    if (input.operation === "move") {
      targetCollection = byId.get(input.target.collectionId)!;
      if (input.target.sectionId !== null) {
        targetSection = state.sections.find((row) => row.ownerId === ownerId && row.collectionId === targetCollection!.id && row.id === input.target.sectionId) ?? null;
        if (!targetSection) throw new LifeLinkDomainError("section_not_found", "The destination Section is unavailable.");
      }
    }
    for (const section of sections) {
      const assignments = state.assignments.filter((row) => row.ownerId === ownerId && row.sectionId === section.id && row.collectionId === sourceId);
      next.assignments = next.assignments.filter((row) => !(row.ownerId === ownerId && row.sectionId === section.id));
      if (input.operation === "delete") next.sections = next.sections.filter((row) => row.id !== section.id);
      else {
        const position = Math.max(-1, ...next.sections.filter((row) => row.collectionId === input.target.collectionId).map((row) => row.position)) + 1;
        next.sections = next.sections.map((row) => row.id === section.id ? { ...row, collectionId: input.target.collectionId, position, updatedAt: new Date(Math.max(Date.parse(changedAt), Date.parse(row.updatedAt) + 1)).toISOString() } : row);
        for (const assignment of assignments) {
          ensureMembership(input.target.collectionId, assignment.lifeLinkId);
          ensureAssignment(input.target.collectionId, section.id, assignment.lifeLinkId);
        }
      }
    }
    for (const member of members) {
      // Whole-Section selection subsumes its individually selected appearances.
      if (member.sourceSectionId !== null && input.sectionIds.includes(member.sourceSectionId)) continue;
      if (input.operation === "move" && input.target.collectionId === sourceId && input.target.sectionId === member.sourceSectionId) continue;
      const crossCollection = input.operation === "move" && input.target.collectionId !== sourceId;
      if (crossCollection || input.operation === "delete" && member.sourceSectionId === null) removeMembership(sourceId, member.lifeLinkId);
      else if (member.sourceSectionId !== null) next.assignments = next.assignments.filter((row) => !(row.ownerId === ownerId && row.collectionId === sourceId && row.lifeLinkId === member.lifeLinkId && row.sectionId === member.sourceSectionId));
      if (input.operation === "move") {
        ensureMembership(input.target.collectionId, member.lifeLinkId);
        if (input.target.sectionId !== null) ensureAssignment(input.target.collectionId, input.target.sectionId, member.lifeLinkId);
      }
    }
  }
  const removed = <T>(before: T[], after: T[], key: (row: T) => string) => { const retained = new Set(after.map(key)); return before.filter((row) => !retained.has(key(row))); };
  const removedMemberships = removed(state.memberships, next.memberships, membershipKey);
  const addedMemberships = removed(next.memberships, state.memberships, membershipKey);
  const removedAssignments = removed(state.assignments, next.assignments, assignmentKey);
  const addedAssignments = removed(next.assignments, state.assignments, assignmentKey);
  const removedSections = state.sections.filter((row) => !next.sections.some((candidate) => candidate.id === row.id));
  const movedSections = state.sections.filter((row) => next.sections.some((candidate) => candidate.id === row.id && candidate.collectionId !== row.collectionId));
  const collectionIds = [...new Set([...deletedCollectionIds, ...[...removedMemberships, ...addedMemberships, ...removedAssignments, ...addedAssignments, ...removedSections, ...movedSections].map((row) => row.collectionId),
    ...movedSections.map((row) => next.sections.find((candidate) => candidate.id === row.id)!.collectionId)])].sort();
  next.collections = next.collections.map((row) => collectionIds.includes(row.id) ? { ...row, updatedAt: new Date(Math.max(Date.parse(changedAt), Date.parse(row.updatedAt) + 1)).toISOString() } : row);
  const lifeLinkIds = [...new Set([...removedMemberships, ...addedMemberships, ...removedAssignments, ...addedAssignments].map((row) => row.lifeLinkId))].sort();
  return { next, collectionIds, lifeLinkIds, deletedCollectionIds, preview: { domain: "collections", input, collections, sections, members, targetCollection, targetSection,
    sideEffects: { collectionsRemoved: deletedCollectionIds.length, sectionsRemoved: removedSections.length, sectionsMoved: movedSections.length,
      membershipsRemoved: removedMemberships.length, membershipsAdded: addedMemberships.length, assignmentsRemoved: removedAssignments.length, assignmentsAdded: addedAssignments.length, lifeLinksDeleted: 0 } } };
}
