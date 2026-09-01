import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { LifeLinkDomainError, stableChangeFingerprint, type ChangeHistory } from "@life-links/core";

type Row = Record<string, unknown>;
const tables = {
  life_links: ["id"],
  collections: ["id"],
  collection_sections: ["id"],
  collection_memberships: ["owner_id", "collection_id", "life_link_id"],
  collection_section_assignments: ["owner_id", "collection_id", "life_link_id", "section_id"],
  life_link_qr_bindings: ["qr_id"],
  link_media: ["id"]
} as const;
type Table = keyof typeof tables;
export type OwnerContentRows = Record<Table, Row[]>;
type InverseRow = { table: Table; key: Row; before: Row | null; afterFingerprint: string | null };

function keyFor(table: Table, row: Row): Row {
  return Object.fromEntries(tables[table].map((column) => [column, row[column]]));
}
function rowKey(table: Table, row: Row): string { return stableChangeFingerprint(keyFor(table, row)); }
function semanticFingerprint(row: Row): string {
  const { updated_at: _revision, ...content } = row;
  return createHash("sha256").update(stableChangeFingerprint(content)).digest("hex");
}

// Read only the authenticated owner's domain rows; retain only changed inverse
// rows in the journal. PostgreSQL's JSON bytea encoding preserves media bytes.
export async function loadOwnerContentRows(client: PoolClient, ownerId: string): Promise<OwnerContentRows> {
  const state = {} as OwnerContentRows;
  for (const table of Object.keys(tables) as Table[]) {
    const result = table === "life_link_qr_bindings"
      ? await client.query(`SELECT to_jsonb(t) AS value FROM life_link_qr_bindings t
          JOIN life_links ll ON ll.id = t.life_link_id WHERE ll.owner_id = $1 ORDER BY t.qr_id`, [ownerId])
      : await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE t.owner_id = $1`, [ownerId]);
    state[table] = result.rows.map((row) => row.value as Row).sort((a, b) => rowKey(table, a).localeCompare(rowKey(table, b)));
  }
  return state;
}

export async function getPostgresChangeHistory(client: Pick<PoolClient, "query">, ownerId: string): Promise<ChangeHistory> {
  const result = await client.query("SELECT id, label, created_at FROM saved_changes WHERE owner_id = $1 ORDER BY sequence DESC LIMIT 5", [ownerId]);
  return { limit: 5, entries: result.rows.map((row) => ({ id: String(row.id), label: String(row.label), createdAt: new Date(row.created_at).toISOString() })) };
}

export async function recordOwnerChange(client: PoolClient, ownerId: string, label: string, before: OwnerContentRows): Promise<void> {
  const after = await loadOwnerContentRows(client, ownerId);
  const inverse: InverseRow[] = [];
  let meaningful = false;
  for (const table of Object.keys(tables) as Table[]) {
    const oldRows = new Map(before[table].map((row) => [rowKey(table, row), row]));
    const newRows = new Map(after[table].map((row) => [rowKey(table, row), row]));
    for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const oldRow = oldRows.get(key) ?? null;
      const newRow = newRows.get(key) ?? null;
      if (stableChangeFingerprint(oldRow) === stableChangeFingerprint(newRow)) continue;
      if (!oldRow || !newRow || semanticFingerprint(oldRow) !== semanticFingerprint(newRow)) meaningful = true;
      inverse.push({ table, key: keyFor(table, oldRow ?? newRow!), before: oldRow,
        afterFingerprint: newRow ? semanticFingerprint(newRow) : null });
    }
  }
  if (!meaningful) return;
  const reserved = [...new Set(inverse.filter((row) => row.table === "life_link_qr_bindings" && row.before)
    .map((row) => String(row.before!.qr_id)))];
  await client.query(`INSERT INTO saved_changes(id, owner_id, label, inverse_rows, reserved_qr_ids, created_at)
    VALUES ($1,$2,$3,$4::jsonb,$5,now())`, [`change-${randomUUID()}`, ownerId, label, JSON.stringify(inverse), reserved]);
  await client.query(`DELETE FROM saved_changes WHERE owner_id = $1 AND sequence NOT IN
    (SELECT sequence FROM saved_changes WHERE owner_id = $1 ORDER BY sequence DESC LIMIT 5)`, [ownerId]);
}

export async function assertUnusedContentId(client: PoolClient, table: "life_links" | "collections" | "collection_sections", id: string): Promise<void> {
  if ((await client.query("SELECT 1 FROM used_content_ids WHERE entity_kind = $1 AND id = $2", [table, id])).rowCount) {
    throw new LifeLinkDomainError(table === "life_links" ? "duplicate_life_link_id" : table === "collections" ? "duplicate_collection_id" : "duplicate_section_id",
      "This identity was previously used and cannot be assigned to a new record.");
  }
}

export async function assertQrNotReservedByOtherOwner(client: PoolClient, ownerId: string, qrId: string): Promise<void> {
  if ((await client.query("SELECT 1 FROM saved_changes WHERE owner_id <> $1 AND reserved_qr_ids @> ARRAY[$2]::text[] LIMIT 1", [ownerId, qrId])).rowCount) {
    throw new LifeLinkDomainError("qr_already_bound", "QR is retained by another owner's saved change.");
  }
}

async function deleteRows(client: PoolClient, table: Table, rows: InverseRow[]): Promise<void> {
  for (const row of rows) {
    const columns = tables[table];
    await client.query(`DELETE FROM ${table} WHERE ${columns.map((key, index) => `${key} = $${index + 1}`).join(" AND ")}`,
      columns.map((key) => row.key[key]));
  }
}

export async function restoreOwnerChange(client: PoolClient, ownerId: string, changeId: string): Promise<string[]> {
  const result = await client.query("SELECT id, inverse_rows FROM saved_changes WHERE owner_id = $1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE", [ownerId]);
  if (!result.rows[0] || result.rows[0].id !== changeId) {
    const exists = await client.query("SELECT 1 FROM saved_changes WHERE owner_id = $1 AND id = $2", [ownerId, changeId]);
    throw new LifeLinkDomainError(exists.rowCount ? "stale_life_link" : "life_link_not_found", "Only the latest saved change can be undone.");
  }
  const inverse = result.rows[0].inverse_rows as InverseRow[];
  const current = await loadOwnerContentRows(client, ownerId);
  for (const item of inverse) {
    const row = current[item.table].find((value) => rowKey(item.table, value) === stableChangeFingerprint(item.key));
    if ((row ? semanticFingerprint(row) : null) !== item.afterFingerprint) {
      throw new LifeLinkDomainError("stale_life_link", "Saved change no longer matches the current content.");
    }
  }
  for (const item of inverse.filter((row) => row.table === "life_link_qr_bindings" && row.before)) {
    const qrId = String(item.before!.qr_id);
    await assertQrNotReservedByOtherOwner(client, ownerId, qrId);
    const occupied = await client.query(`SELECT b.life_link_id, ll.owner_id FROM life_link_qr_bindings b
      JOIN life_links ll ON ll.id = b.life_link_id WHERE b.qr_id = $1`, [qrId]);
    if (occupied.rows[0] && (String(occupied.rows[0].owner_id) !== ownerId ||
        !inverse.some((row) => row.table === "life_link_qr_bindings" && row.key.qr_id === qrId))) {
      throw new LifeLinkDomainError("qr_already_bound", "A retained QR binding cannot be restored safely.");
    }
  }
  const linkRows = inverse.filter((row) => row.table === "life_links");
  const linkIds = new Set(linkRows.map((row) => String(row.key.id)));
  const collectionIds = new Set<string>();
  const sectionIds = new Set<string>();
  let revisionTime = Date.now();
  for (const item of inverse) {
    const rows = [item.before, current[item.table].find((row) => rowKey(item.table, row) === stableChangeFingerprint(item.key))];
    for (const row of rows) {
      if (!row) continue;
      if (typeof row.updated_at === "string") revisionTime = Math.max(revisionTime, Date.parse(row.updated_at) + 1);
      if (typeof row.life_link_id === "string") linkIds.add(row.life_link_id);
      if (typeof row.collection_id === "string") collectionIds.add(row.collection_id);
      if (typeof row.section_id === "string") sectionIds.add(row.section_id);
    }
    if (item.table === "collections") collectionIds.add(String(item.key.id));
    if (item.table === "collection_sections") sectionIds.add(String(item.key.id));
  }
  // Break only the changed placement edges before restoring their previous
  // topology; unrelated descendants retain their canonical identity and edges.
  if (linkRows.length) await client.query("UPDATE life_links SET parent_id = NULL WHERE owner_id = $1 AND id = ANY($2::text[])", [ownerId, linkRows.map((row) => String(row.key.id))]);
  const deletionOrder: Table[] = ["collection_section_assignments", "collection_memberships", "collection_sections", "link_media", "life_link_qr_bindings", "life_links", "collections"];
  // Remove changed bindings first, including replacements, to honor both unique
  // binding keys while restoring a former QR after a set/change operation.
  await deleteRows(client, "life_link_qr_bindings", inverse.filter((row) => row.table === "life_link_qr_bindings"));
  for (const table of deletionOrder) await deleteRows(client, table, inverse.filter((row) => row.table === table && !row.before));
  for (const table of Object.keys(tables) as Table[]) {
    const pending = inverse.filter((row) => row.table === table && row.before).map((row) => row.before!);
    if (table === "life_links") {
      const parents = new Map(pending.map((row) => [String(row.id), row.parent_id]));
      const depth = (row: Row) => { let count = 0; let id = row.parent_id; const seen = new Set<unknown>();
        while (id && parents.has(String(id)) && !seen.has(id)) { seen.add(id); count++; id = parents.get(String(id)); } return count; };
      pending.sort((a, b) => depth(a) - depth(b));
    }
    for (const row of pending) {
      const columns = Object.keys(row);
      const keys: readonly string[] = tables[table];
      const restored = await client.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
        ON CONFLICT (${keys.join(",")}) DO UPDATE SET ${columns.filter((column) => !keys.includes(column)).map((column) => `${column} = EXCLUDED.${column}`).join(",")}
        ${table === "life_link_qr_bindings" ? "" : `WHERE ${table}.owner_id = EXCLUDED.owner_id`}`,
        [JSON.stringify(row)]);
      if (restored.rowCount !== 1) throw new LifeLinkDomainError("stale_life_link", "A saved identity conflicts with another owner's content.");
    }
  }
  const changedAt = new Date(revisionTime).toISOString();
  for (const [table, ids] of [["life_links", linkIds], ["collections", collectionIds], ["collection_sections", sectionIds]] as const) {
    if (ids.size) await client.query(`UPDATE ${table} SET updated_at = GREATEST(updated_at + interval '1 millisecond', $3::timestamptz)
      WHERE owner_id = $1 AND id = ANY($2::text[])`, [ownerId, [...ids], changedAt]);
  }
  await client.query("DELETE FROM saved_changes WHERE id = $1 AND owner_id = $2", [changeId, ownerId]);
  return [...linkIds];
}
