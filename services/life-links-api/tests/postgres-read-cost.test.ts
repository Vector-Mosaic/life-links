import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { compareCollectionTitleOrder, createCanonicalLifeLink, pageCollectionRecords, pageLifeLinkChildren,
  type LifeLinkRecord } from "@life-links/core";
import { PostgresLifeLinksStore } from "../src/postgres-store.js";

const OWNER = "read-cost-owner";
const OTHER = "other-owner";
const COLLECTION = "collection-11111111-1111-4111-8111-111111111111";
const NOW = "2026-09-03T12:00:00.000Z";

/** Query-boundary fixture, not a SQL engine. Actual SQL is exercised by the
 * existing isolated PostgreSQL integration lane. Count returned/hydrated rows
 * here rather than pretending synthetic timings predict production latency. */
function fixture() {
  const records: LifeLinkRecord[] = Array.from({ length: 240 }, (_, index) => {
    const id = `record-${String(index).padStart(3, "0")}`;
    const title = index < 12 ? ["A", "Ａ", "a", "ä", "😀", "𐀀", "\ue000", "ß", "İ", "Same", "Same", " z "][index] : `Record ${index}`;
    const value = createCanonicalLifeLink({ id, ownerId: index < 220 ? OWNER : OTHER,
      parentId: index < 40 ? null : index < 120 ? "record-010" : "record-020", title,
      body: `Private body ${index} ${"x".repeat(2048)}`, createdAt: NOW });
    return { ...value, browsingRole: index === 10 || index === 20 ? "container" : "item",
      media: [{ id: `media-${index}`, lifeLinkId: id, ownerId: value.ownerId, kind: "document", mimeType: "text/plain",
        fileName: `notes-${index}.txt`, sizeBytes: 42, url: `/api/life-links/${id}/media/media-${index}`, createdAt: NOW }] };
  });
  const membershipIds = new Set(records.filter(record => record.ownerId === OWNER).map(record => record.id));
  const metrics = { queries: 0, fullRecords: 0, mediaRows: 0, rowBytes: 0 };
  const collection = { id: COLLECTION, owner_id: OWNER, title: "Context", purpose: "All private context", notes: "Notes", created_at: NOW, updated_at: NOW };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    metrics.queries++;
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    let rows: Record<string, unknown>[];
    if (sql.includes("FROM collections")) {
      rows = values.includes(OWNER) && values.includes(COLLECTION) ? [collection] : [];
    } else if (sql.includes("FROM link_media lm")) {
      const selected = new Set(values[0] as string[]);
      rows = records.filter(record => selected.has(record.id)).flatMap(record => record.media.map(media => ({
        id: media.id, life_link_id: record.id, owner_id: record.ownerId, kind: media.kind, mime_type: media.mimeType,
        file_name: media.fileName, size_bytes: media.sizeBytes, created_at: media.createdAt, qr_id: null
      })));
      metrics.mediaRows += rows.length;
    } else if (sql.includes("FROM life_links ll") || sql.includes("FROM collection_memberships m")) {
      let selected = records.filter(record => record.ownerId === values[0]);
      if (sql.includes("FROM collection_memberships m")) selected = selected.filter(record => membershipIds.has(record.id) && values[1] === COLLECTION);
      if (sql.includes("ll.parent_id IS NOT DISTINCT FROM $2")) selected = selected.filter(record => record.parentId === values[1]);
      if (sql.includes("ll.id = ANY($2::text[])")) selected = selected.filter(record => (values[1] as string[]).includes(record.id));
      const full = sql.includes("SELECT ll.*");
      if (full) metrics.fullRecords += selected.length;
      rows = selected.map(record => ({ id: record.id, owner_id: record.ownerId, parent_id: record.parentId,
        title: record.title, created_at: record.createdAt, updated_at: record.updatedAt, privacy: record.privacy,
        browsing_role: record.browsingRole, qr_id: record.qrId,
        child_count: records.filter(child => child.ownerId === record.ownerId && child.parentId === record.id).length,
        ...(full ? { body: record.body, body_doc: record.bodyDoc, body_doc_version: record.bodyDocVersion, context: record.context,
          placement_confirmed_at: record.placementConfirmedAt, public_field_keys: record.publicFieldKeys } : {}) }));
      if (!full && !sql.includes("AS child_count")) rows = rows.map(({ id, title }) => ({ id, title }));
    } else throw new Error(`Unexpected query shape: ${sql.slice(0, 60)}`);
    metrics.rowBytes += Buffer.byteLength(JSON.stringify(rows));
    return { rows, rowCount: rows.length };
  });
  const release = vi.fn();
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { store: new PostgresLifeLinksStore(pool), records, metrics, query, release, membershipIds };
}

describe("PostgreSQL canonical page read costs", () => {
  it("returns exact hierarchy pages/counts without hydrating any full record or attachment", async () => {
    const test = fixture();
    const first = await test.store.listLifeLinks(OWNER, null, { limit: 5 });
    expect(first).toEqual(pageLifeLinkChildren(test.records, OWNER, null, { limit: 5 }));
    const next = await test.store.listLifeLinks(OWNER, null, { limit: 5, cursor: first.nextCursor });
    expect(next).toEqual(pageLifeLinkChildren(test.records, OWNER, null, { limit: 5, cursor: first.nextCursor }));
    expect(test.metrics).toMatchObject({ queries: 2, fullRecords: 0, mediaRows: 0 });
    expect(test.metrics.rowBytes).toBeLessThan(40_000);
    const roots = await test.store.listLifeLinks(OWNER, null, { limit: 40 });
    expect(roots.items.find(record => record.id === "record-010")?.childCount).toBe(80);
    expect(roots.items.find(record => record.id === "record-020")?.childCount).toBe(100);
    expect(await test.store.listLifeLinks(OTHER, "record-010")).toEqual(pageLifeLinkChildren(test.records, OTHER, "record-010"));
    await expect(test.store.listLifeLinks(OWNER, null, { cursor: "invalid" })).rejects.toMatchObject({ code: "invalid_life_link" });
  });

  it("hydrates full fields and attachments only for selected Collection members", async () => {
    const test = fixture();
    const members = test.records.filter(record => record.ownerId === OWNER).sort(compareCollectionTitleOrder);
    const first = (await test.store.listCollectionMembers(OWNER, COLLECTION, { limit: 5 }))!;
    expect(first).toEqual(pageCollectionRecords(members, { limit: 5 }));
    const next = (await test.store.listCollectionMembers(OWNER, COLLECTION, { limit: 5, cursor: first.nextCursor }))!;
    expect(next).toEqual(pageCollectionRecords(members, { limit: 5, cursor: first.nextCursor }));
    expect(test.metrics).toMatchObject({ queries: 12, fullRecords: 10, mediaRows: 10 });
    expect(test.metrics.rowBytes).toBeLessThan(250_000);
    expect(await test.store.listCollectionMembers(OTHER, COLLECTION)).toBeNull();
    const removedCursor = encodeURIComponent(JSON.stringify({ version: 1, id: "absent-record" }));
    await expect(test.store.listCollectionMembers(OWNER, COLLECTION, { cursor: removedCursor })).rejects.toMatchObject({ code: "invalid_collection" });
    expect(test.query.mock.calls.some(([sql]) => sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")).toBe(true);
    expect(test.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    expect(test.release).toHaveBeenCalledTimes(4);
    test.membershipIds.clear();
    expect(await test.store.listCollectionMembers(OWNER, COLLECTION)).toEqual({ items: [], nextCursor: null, truncated: false });
    expect(test.metrics.fullRecords).toBe(10);
    expect(test.metrics.mediaRows).toBe(10);
  });
});
