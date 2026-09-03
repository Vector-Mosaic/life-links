import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DEMO_OWNER_ID, DEMO_GUEST_ID } from "@life-links/core";
import type { LifeLinksStore } from "../src/store.js";

export function attachmentTextStoreContract(getStore: () => LifeLinksStore): void {
  it("admits Search v4 only on explicit connection and retains inherited Workspace and Calendar access", async () => {
    const store = getStore();
    await store.connectAgent(DEMO_OWNER_ID, "life-links-calendar-v2");
    expect((await store.getUserById(DEMO_OWNER_ID))?.agentToolCatalogId).toBe("life-links-calendar-v2");
    await expect(store.listRoutines(DEMO_OWNER_ID, {}, "agent")).rejects.toMatchObject({ code: "agent_access_denied" });
    const connected = await store.connectAgent(DEMO_OWNER_ID, "life-links-search-v4");
    expect((await store.getUserById(DEMO_OWNER_ID))?.agentToolCatalogId).toBe("life-links-search-v4");
    expect((await store.connectAgent(DEMO_OWNER_ID, "life-links-search-v4"))?.agentConnectedAt).toBe(connected?.agentConnectedAt);
    await expect(store.listRoutines(DEMO_OWNER_ID, {}, "agent")).resolves.toHaveProperty("items");
    await expect(store.listCalendars(DEMO_OWNER_ID, {}, "agent")).resolves.toHaveProperty("items");
    await store.disconnectAgent(DEMO_OWNER_ID);
    await expect(store.listRoutines(DEMO_OWNER_ID, {}, "agent")).rejects.toMatchObject({ code: "agent_access_denied" });
    await expect(store.listCalendars(DEMO_OWNER_ID, {}, "agent")).rejects.toMatchObject({ code: "calendar_access_denied" });
  });

  it("keeps derived attachment text exact-source and owner-bound, outside Undo, and purges it on removal", async () => {
    const store = getStore();
    const item = await store.createLifeLink({ id: `search-${randomUUID()}`, ownerId: DEMO_OWNER_ID, title: "Search source", createdAt: "2026-09-02T12:00:00.000Z" });
    const data = Buffer.from("Private full document\u0000content 🏕️");
    const media = (await store.createLifeLinkMedia(DEMO_OWNER_ID, item.id, { kind: "document", mimeType: "text/plain", fileName: "source.txt", data, sizeBytes: data.length }))!;
    const file = (await store.getLifeLinkMedia(DEMO_OWNER_ID, item.id, media.id))!;
    const revision = "a".repeat(64);
    const extraction = { status: "ready" as const, reason: null, text: data.toString(), warnings: [] };
    const history = await store.getChangeHistory(DEMO_OWNER_ID);
    await store.putAttachmentText(file, revision, extraction);
    expect(await store.getAttachmentText(file, revision)).toEqual(extraction);
    expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
    expect(await store.getAttachmentText(file, "b".repeat(64))).toBeNull();
    for (const stale of [
      { ...file, media: { ...file.media, ownerId: DEMO_GUEST_ID } },
      { ...file, media: { ...file.media, lifeLinkId: "missing-source" } },
      { ...file, media: { ...file.media, mimeType: "text/markdown" } },
      { ...file, data: Buffer.from("Different bytes") }
    ]) {
      expect(await store.getAttachmentText(stale, revision)).toBeNull();
      await store.putAttachmentText(stale, revision, { ...extraction, text: "Must not replace" });
    }
    expect(await store.getAttachmentText(file, revision)).toEqual(extraction);
    await store.deleteLifeLinkMedia(DEMO_OWNER_ID, item.id, media.id);
    expect(await store.getAttachmentText(file, revision)).toBeNull();
    await store.putAttachmentText(file, revision, extraction);
    const deleted = await store.getChangeHistory(DEMO_OWNER_ID);
    await store.undoChange(DEMO_OWNER_ID, { changeId: deleted.entries[0].id, commandId: `restore-${randomUUID()}` });
    const restored = (await store.getLifeLinkMedia(DEMO_OWNER_ID, item.id, media.id))!;
    expect(restored.data.equals(data)).toBe(true);
    expect(await store.getAttachmentText(restored, revision)).toBeNull();
    await store.putAttachmentText(restored, revision, extraction);
    expect(await store.getAttachmentText(restored, revision)).toEqual(extraction);
  });

  it("enumerates the whole owner library in stable bounded pages with attachment metadata but no bytes", async () => {
    const store = getStore(); const prefix = `search-${randomUUID()}`;
    const root = await store.createLifeLink({ id: `${prefix}-a`, ownerId: DEMO_OWNER_ID, title: "Root", createdAt: "2026-09-02T12:00:00.000Z" });
    const child = await store.createLifeLink({ id: `${prefix}-b`, ownerId: DEMO_OWNER_ID, parentId: root.id, title: "Nested", createdAt: root.createdAt });
    const privateItem = await store.createLifeLink({ id: `${prefix}-c`, ownerId: DEMO_GUEST_ID, title: "Other owner", createdAt: root.createdAt });
    await store.createLifeLinkMedia(DEMO_OWNER_ID, child.id, { kind: "document", mimeType: "text/plain", fileName: "nested.txt", sizeBytes: 4, data: Buffer.from("text") });
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const page = await store.listRecordSearchLifeLinks(DEMO_OWNER_ID, { cursor, limit: 2 });
      expect(page.items.length).toBeLessThanOrEqual(2);
      for (const row of page.items) {
        expect(row.ownerId).toBe(DEMO_OWNER_ID);
        if (row.id === child.id) { expect(row.media).toHaveLength(1); expect(row.media[0]).not.toHaveProperty("data"); }
        seen.push(row.id);
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...new Set(seen)].sort());
    expect(seen).toEqual(expect.arrayContaining([root.id, child.id]));
    expect(seen).not.toContain(privateItem.id);
    await expect(store.listRecordSearchLifeLinks(DEMO_OWNER_ID, { cursor: encodeURIComponent(JSON.stringify({ version: 1, id: privateItem.id })) })).rejects.toBeDefined();
    await expect(store.listRecordSearchLifeLinks(DEMO_OWNER_ID, { cursor: "malformed" })).rejects.toBeDefined();
  });
}
