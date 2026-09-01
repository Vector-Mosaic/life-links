import { LifeLinkDomainError, type LifeLinkRecord } from "./index.js";

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
