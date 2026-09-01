import { describe, expect, it } from "vitest";
import { DEFAULT_QR_BASE_URL, DEMO_GUEST_ID, DEMO_OWNER_ID, DEMO_PASSWORD, type LifeLinkRecord } from "@life-links/core";
import type { LifeLinksStore } from "../src/store.js";

/** The same observable inverse-data contract can run against either store. */
export function changeHistoryStoreContract(getStore: () => LifeLinksStore): void {
  describe("canonical change history", () => {
    const create = (id: string, parentId: string | null = null, browsingRole: "container" | "item" = "item") => getStore().createLifeLink({ id, parentId, browsingRole, ownerId: DEMO_OWNER_ID, title: id, body: `Notes for ${id}`, createdAt: "2026-08-30T00:00:00.000Z" });
    const current = async (id: string) => (await getStore().getLifeLinkDetail(DEMO_OWNER_ID, id))!.lifeLink;
    const undoLatest = async (commandId: string) => getStore().undoChange(DEMO_OWNER_ID, { changeId: (await getStore().getChangeHistory(DEMO_OWNER_ID)).entries[0].id, commandId });

    it("deletes the complete deduplicated subtree and restores identity, bytes, QR and Collection edges", async () => {
      const store = getStore();
      const root = await create("history-root", null, "container");
      await create("history-child", root.id, "container");
      const leaf = await create("history-leaf", "history-child");
      const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
      const qrId = batch.qrCodes[0].id;
      await store.claimQr(qrId, DEMO_OWNER_ID, { commandId: "history-claim", mode: "attach", lifeLinkId: leaf.id });
      const media = await store.createLifeLinkMedia(DEMO_OWNER_ID, leaf.id, { kind: "image", mimeType: "image/png", fileName: "saved.png", sizeBytes: 5, data: Buffer.from("bytes") });
      let collection = await store.createCollection({ id: "collection-00000000-0000-4000-8000-000000000091", ownerId: DEMO_OWNER_ID, title: "Camping", createdAt: root.createdAt });
      collection = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: leaf.id, expectedUpdatedAt: collection.updatedAt }))!;
      const section = (await store.createCollectionSection(DEMO_OWNER_ID, { collectionId: collection.id, id: "section-00000000-0000-4000-8000-000000000091", title: "Pack", expectedUpdatedAt: collection.updatedAt }))!;
      collection = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: leaf.id, sectionIds: [section.section.id], expectedUpdatedAt: section.collection.updatedAt }))!;
      const before = await current(leaf.id);
      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [root.id, leaf.id, root.id] });
      expect(preview.rootIds).toEqual([root.id]);
      expect(preview.items.map((row) => row.id)).toEqual([root.id, "history-child", leaf.id]);
      expect(preview.sideEffects).toEqual({ lifeLinks: 3, media: 1, qrBindings: 1, collectionMemberships: 1, collectionSectionAssignments: 1 });
      const applied = await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "history-delete" });
      expect(applied.affectedIds).toHaveLength(3);
      expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, leaf.id)).toBeNull();
      expect(await store.getLifeLinkMedia(DEMO_OWNER_ID, leaf.id, media!.id)).toBeNull();
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, collection.id))!.items).toEqual([]);
      expect((await store.getQrState(qrId, null)).state).toBe("private");
      expect((await store.getQrState(qrId, DEMO_OWNER_ID)).state).toBe("unclaimed");
      await expect(store.claimQr(qrId, DEMO_GUEST_ID, "guest-reserved-qr")).rejects.toMatchObject({ code: "qr_already_bound" });
      expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home")).not.toBeNull();
      await undoLatest("undo-delete");
      expect(await current(leaf.id)).toMatchObject({ ...before, updatedAt: expect.any(String) });
      expect((await current(leaf.id)).updatedAt).not.toBe(before.updatedAt);
      expect((await store.getLifeLinkMedia(DEMO_OWNER_ID, leaf.id, media!.id))!.data.equals(Buffer.from("bytes"))).toBe(true);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, leaf.id))!.items[0].sections.map((row) => row.id)).toEqual([section.section.id]);
      expect((await store.getQrState(qrId, DEMO_OWNER_ID)).state).toBe("claimed");
      const history = await store.getChangeHistory(DEMO_OWNER_ID);
      await store.claimQr(qrId, DEMO_OWNER_ID, { commandId: "history-claim", mode: "attach", lifeLinkId: leaf.id });
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
    });

    it("rejects a stale descendant preview and atomically replays a single bulk move", async () => {
      const store = getStore();
      await create("history-root", null, "container");
      await create("history-child", "history-root");
      await create("history-target", null, "container");
      const stale = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: ["history-root"], parentId: "history-target" });
      const child = await current("history-child");
      await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: child.id, expectedUpdatedAt: child.updatedAt, patch: { title: "Changed after preview" } });
      const historyBefore = await store.getChangeHistory(DEMO_OWNER_ID);
      await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: stale.id, commandId: "stale-move" })).rejects.toMatchObject({ code: "stale_life_link" });
      expect((await current("history-root")).parentId).toBeNull();
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(historyBefore);
      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: ["history-root", "history-child"], parentId: "history-target" });
      const command = { previewId: preview.id, commandId: "bulk-move" };
      const [one, two] = await Promise.all([store.applyLifeLinkChange(DEMO_OWNER_ID, command), store.applyLifeLinkChange(DEMO_OWNER_ID, command)]);
      expect(one).toEqual(two);
      expect((await current("history-root")).parentId).toBe("history-target");
      expect((await current("history-child")).parentId).toBe("history-root");
      const noOpHistory = await store.getChangeHistory(DEMO_OWNER_ID);
      const noOpPreview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: ["history-root"], parentId: "history-target" });
      const noOp = await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: noOpPreview.id, commandId: "same-parent-move" });
      expect(noOp.affectedIds).toEqual([]);
      expect(noOp.history).toEqual(noOpHistory);
      await undoLatest("undo-move");
      const afterUndo = await store.getChangeHistory(DEMO_OWNER_ID);
      await store.applyLifeLinkChange(DEMO_OWNER_ID, command);
      expect((await current("history-root")).parentId).toBeNull();
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(afterUndo);
      await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, { ...command, commandId: "second-command" })).rejects.toBeDefined();
      await expect(store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: ["history-root"], parentId: "history-child" })).rejects.toMatchObject({ code: expect.stringMatching(/hierarchy_cycle|invalid_parent/) });
    });

    it("retains exactly five real changes and supports five sequential Undo operations with fresh revisions", async () => {
      const store = getStore();
      let record: LifeLinkRecord = await create("history-edited");
      for (let i = 1; i <= 6; i++) record = (await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: record.id, expectedUpdatedAt: record.updatedAt, patch: { title: `Version ${i}` } }))!;
      const history = await store.getChangeHistory(DEMO_OWNER_ID);
      expect(history.entries).toHaveLength(5);
      expect(history.limit).toBe(5);
      expect(Object.keys(history.entries[0]).sort()).toEqual(["createdAt", "id", "label"]);
      await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: record.id, expectedUpdatedAt: record.updatedAt, patch: { title: record.title } });
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
      await expect(store.undoChange(DEMO_OWNER_ID, { changeId: history.entries[4].id, commandId: "out-of-order" })).rejects.toMatchObject({ code: "stale_life_link" });
      for (let i = 0; i < 5; i++) {
        const previousRevision = (await current(record.id)).updatedAt;
        await undoLatest(`undo-version-${i}`);
        const restored = await current(record.id);
        expect(restored.title).toBe(`Version ${5 - i}`);
        expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(previousRevision));
      }
      expect((await store.getChangeHistory(DEMO_OWNER_ID)).entries).toEqual([]);
    });

    it("undoes standalone attachment, membership and Section removal without copying the Life Link", async () => {
      const store = getStore(); const record = await create("history-edited");
      let collection = await store.createCollection({ id: "collection-00000000-0000-4000-8000-000000000092", ownerId: DEMO_OWNER_ID, title: "Kit", createdAt: record.createdAt });
      collection = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
      const section = (await store.createCollectionSection(DEMO_OWNER_ID, { collectionId: collection.id, id: "section-00000000-0000-4000-8000-000000000092", title: "Ready", expectedUpdatedAt: collection.updatedAt }))!;
      collection = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: record.id, sectionIds: [section.section.id], expectedUpdatedAt: section.collection.updatedAt }))!;
      const removedSection = (await store.removeCollectionSection(DEMO_OWNER_ID, { collectionId: collection.id, sectionId: section.section.id, expectedUpdatedAt: collection.updatedAt }))!;
      await undoLatest("undo-section");
      collection = (await store.getCollection(DEMO_OWNER_ID, collection.id))!;
      expect(Date.parse(collection.updatedAt)).toBeGreaterThan(Date.parse(removedSection.updatedAt));
      const removedMember = (await store.removeCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: record.id, expectedUpdatedAt: collection.updatedAt }))!;
      await undoLatest("undo-member");
      expect(Date.parse((await store.getCollection(DEMO_OWNER_ID, collection.id))!.updatedAt)).toBeGreaterThan(Date.parse(removedMember.updatedAt));
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, record.id))!.items[0].sections[0].id).toBe(section.section.id);
      const media = (await store.createLifeLinkMedia(DEMO_OWNER_ID, record.id, { kind: "image", mimeType: "image/png", fileName: "note.png", sizeBytes: 4, data: Buffer.from("safe") }))!;
      await store.deleteLifeLinkMedia(DEMO_OWNER_ID, record.id, media.id);
      const mediaRemovedRevision = (await current(record.id)).updatedAt;
      await undoLatest("undo-media");
      expect(Date.parse((await current(record.id)).updatedAt)).toBeGreaterThan(Date.parse(mediaRemovedRevision));
      expect((await store.getLifeLinkMedia(DEMO_OWNER_ID, record.id, media.id))!.data.equals(Buffer.from("safe"))).toBe(true);
      expect((await current(record.id)).id).toBe(record.id);
    });

    it("preserves same-owner QR reuse through sequential Undo and releases reservations on eviction", async () => {
      const store = getStore(); const original = await create("history-qr-original");
      const replacement = await create("history-qr-replacement");
      const qrId = (await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL)).qrCodes[0].id;
      await store.claimQr(qrId, DEMO_OWNER_ID, { commandId: "original-qr", mode: "attach", lifeLinkId: original.id });
      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [original.id] });
      await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "delete-original-qr" });
      const rebound = (await store.setLifeLinkQrBinding(DEMO_OWNER_ID, { lifeLinkId: replacement.id, expectedUpdatedAt: replacement.updatedAt, qrId, commandId: "replacement-qr" }))!;
      await undoLatest("undo-replacement-qr");
      expect(Date.parse((await current(replacement.id)).updatedAt)).toBeGreaterThan(Date.parse(rebound.updatedAt));
      await undoLatest("undo-original-qr-deletion");
      expect((await current(original.id)).qrId).toBe(qrId);
      expect((await current(replacement.id)).qrId).toBeNull();
      const next = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [original.id] });
      await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: next.id, commandId: "delete-expiring-qr" });
      for (let i = 0; i < 5; i++) {
        const record = await current(replacement.id);
        await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: record.id, expectedUpdatedAt: record.updatedAt, patch: { title: `Later ${i}` } });
      }
      expect((await store.getQrState(qrId, null)).state).toBe("unclaimed");
      expect((await store.claimQr(qrId, DEMO_GUEST_ID, "claim-after-eviction")).result).toBe("claimed");
      await expect(create(original.id)).rejects.toBeDefined();
    });

    it("does not let ordinary seeding resurrect a deleted seeded subtree or reset its Undo", async () => {
      const store = getStore();
      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: ["project-home"] });
      expect(preview.items.length).toBeGreaterThan(1);
      await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "delete-seeded-folder" });
      const history = await store.getChangeHistory(DEMO_OWNER_ID);
      await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
      for (const item of preview.items) expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id)).toBeNull();
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
      await undoLatest("undo-seeded-folder");
      for (const item of preview.items) expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id)).not.toBeNull();
    });

    it("keeps a foreign retained QR private in its issuer inventory until reservation eviction", async () => {
      const store = getStore();
      const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
      const qrId = batch.qrCodes[0].id;
      const claimed = await store.claimQr(qrId, DEMO_GUEST_ID, "guest-issuer-qr");
      expect(claimed.state.state).toBe("claimed");
      const guestItem = (await store.listLifeLinks(DEMO_GUEST_ID, null)).items.find((item) => item.qrId === qrId)!;
      const preview = await store.previewLifeLinkChange(DEMO_GUEST_ID, { operation: "delete", lifeLinkIds: [guestItem.id] });
      await store.applyLifeLinkChange(DEMO_GUEST_ID, { previewId: preview.id, commandId: "delete-guest-issuer-qr" });
      expect((await store.getQrState(qrId, DEMO_OWNER_ID)).state).toBe("private");
      for (const item of [
        (await store.listLinks(DEMO_OWNER_ID)).find((item) => item.id === qrId),
        (await store.listBatchLinks(DEMO_OWNER_ID, batch.batch.id))[0]
      ]) expect(item).toMatchObject({ id: qrId, status: "claimed", privacy: "private", ownerId: null, title: "", body: "", media: [] });
      for (let i = 0; i < 5; i++) await store.createLifeLink({ id: `guest-after-reservation-${i}`, title: `Later ${i}`, ownerId: DEMO_GUEST_ID, createdAt: "2026-08-30T00:00:00.000Z" });
      expect((await store.getQrState(qrId, DEMO_OWNER_ID)).state).toBe("unclaimed");
      expect((await store.listLinks(DEMO_OWNER_ID)).find((item) => item.id === qrId)?.status).toBe("unclaimed");
      expect((await store.listBatchLinks(DEMO_OWNER_ID, batch.batch.id))[0].status).toBe("unclaimed");
    });

    it("binds stable change command identity to one owner and request", async () => {
      const store = getStore(); const ownerItem = await create("command-owner");
      const guestItem = await store.createLifeLink({ id: "command-guest", title: "Guest", ownerId: DEMO_GUEST_ID, createdAt: ownerItem.createdAt });
      const first = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [ownerItem.id] });
      const second = await store.previewLifeLinkChange(DEMO_GUEST_ID, { operation: "delete", lifeLinkIds: [guestItem.id] });
      await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: first.id, commandId: "same-global-command" });
      const guestHistory = await store.getChangeHistory(DEMO_GUEST_ID);
      await expect(store.applyLifeLinkChange(DEMO_GUEST_ID, { previewId: second.id, commandId: "same-global-command" })).rejects.toThrow(/idempotency/i);
      expect(await store.getChangeHistory(DEMO_GUEST_ID)).toEqual(guestHistory);
      expect(await store.getLifeLinkDetail(DEMO_GUEST_ID, guestItem.id)).not.toBeNull();
      expect(await store.getLifeLinkChangePreview(DEMO_GUEST_ID, second.id)).not.toBeNull();
    });

    it("does not reuse a creation undone before its inverse expires", async () => {
      const store = getStore(); const original = await create("history-undone-create");
      await undoLatest("undo-creation");
      for (let i = 0; i < 5; i++) await create(`history-post-undo-${i}`);
      await expect(create(original.id)).rejects.toBeDefined();
      expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, original.id)).toBeNull();
    });

    it("isolates previews/history and rejects identity reuse after deletion falls out of the Undo window", async () => {
      const store = getStore(); const record = await create("history-deleted");
      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [record.id] });
      expect(await store.getLifeLinkChangePreview(DEMO_GUEST_ID, preview.id)).toBeNull();
      expect((await store.getChangeHistory(DEMO_GUEST_ID)).entries).toEqual([]);
      await expect(store.applyLifeLinkChange(DEMO_GUEST_ID, { previewId: preview.id, commandId: "foreign" })).rejects.toBeDefined();
      await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "delete-expiring" });
      for (let i = 0; i < 5; i++) await create(`history-later-${i}`);
      await expect(store.createLifeLink({ id: record.id, title: record.title, ownerId: DEMO_GUEST_ID, createdAt: record.createdAt })).rejects.toBeDefined();
      expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, record.id)).toBeNull();
    });
  });
}
