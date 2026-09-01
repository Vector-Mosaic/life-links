import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEMO_GUEST_ID, DEMO_OWNER_ID, DEFAULT_QR_BASE_URL } from "@life-links/core";
import type { LifeLinksStore } from "../src/store.js";

const createdAt = "2026-08-29T00:00:00.000Z";
const id = (prefix: string) => `${prefix}-${randomUUID()}`;

// One observable contract is exercised against both real store implementations.
export function fieldLedgerStoreContract(getStore: () => LifeLinksStore): void {
  describe("Field Ledger additive store contract", () => {
    const createItem = (title = "Sleeping pad", ownerId = DEMO_OWNER_ID) =>
      getStore().createLifeLink({ id: id("life-link"), ownerId, title, createdAt });
    const createCollection = (title = "Camping Gear", ownerId = DEMO_OWNER_ID) =>
      getStore().createCollection({ id: id("collection"), ownerId, title, createdAt });

    it("persists roles, promotes parents, and records only explicit placement freshness", async () => {
      const store = getStore();
      const parent = await createItem("Green tub");
      expect(parent).toMatchObject({ browsingRole: "item", context: { schemaVersion: 1 },
        placementConfirmedAt: null, publicFieldKeys: [], privacy: "private" });
      const child = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID,
        parentId: parent.id, title: "Pad", createdAt });
      expect(child.placementConfirmedAt).toBe(createdAt);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id))?.lifeLink.browsingRole).toBe("container");
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id))?.lifeLink.updatedAt)
        .toBe(new Date(Date.parse(createdAt) + 1).toISOString());
      const emptyFolder = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID,
        title: "Empty tub", browsingRole: "container", createdAt });
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, emptyFolder.id))?.children).toEqual([]);
      expect((await store.listLifeLinks(DEMO_OWNER_ID, null, { limit: 100 })).items
        .find((row) => row.id === emptyFolder.id)?.browsingRole).toBe("container");
      const moved = await store.moveLifeLink(DEMO_OWNER_ID, { lifeLinkId: child.id,
        parentId: emptyFolder.id, expectedUpdatedAt: child.updatedAt });
      expect(moved?.placementConfirmedAt).toBe(moved?.updatedAt);
      const replay = await store.moveLifeLink(DEMO_OWNER_ID, { lifeLinkId: child.id,
        parentId: emptyFolder.id, expectedUpdatedAt: child.updatedAt });
      expect(replay).toEqual(moved);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id))?.lifeLink.browsingRole).toBe("container");
      await expect(store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: emptyFolder.id,
        expectedUpdatedAt: (await store.getLifeLinkDetail(DEMO_OWNER_ID, emptyFolder.id))!.lifeLink.updatedAt,
        patch: { browsingRole: "item" } as never })).rejects.toMatchObject({ code: "invalid_life_link" });
    });

    it("replays normalized empty and rich Life Link creation without duplicating records", async () => {
      const store = getStore();
      const command = { id: id("life-link"), ownerId: DEMO_OWNER_ID, title: "Empty Notes", createdAt };
      const original = await store.createLifeLink(command);
      expect(await store.createLifeLink(command)).toEqual(original);
      const richCommand = { ...command, id: id("life-link"), body: "Keep this note" };
      const rich = await store.createLifeLink(richCommand);
      expect(await store.createLifeLink(richCommand)).toEqual(rich);
      await expect(store.createLifeLink({ ...command, title: "Different" }))
        .rejects.toMatchObject({ code: "duplicate_life_link_id" });
    });

    it("coordinates structured context and explicit public fields without changing Notes or placement", async () => {
      const store = getStore();
      const item = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID,
        title: "Pad", body: "Keep these original notes", createdAt });
      const updated = await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id,
        expectedUpdatedAt: item.updatedAt, patch: {
          context: { schemaVersion: 1, condition: { text: "Cold on the ground", truthState: "owner_reported" },
            plan: { text: "Replace next year", truthState: "planned" } },
          publicFieldKeys: ["condition"]
        } });
      expect(updated).toMatchObject({ body: item.body, bodyDoc: item.bodyDoc,
        placementConfirmedAt: null, privacy: "private", publicFieldKeys: ["condition"],
        context: { schemaVersion: 1, plan: { text: "Replace next year", truthState: "planned" } } });
      await expect(store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id,
        expectedUpdatedAt: updated!.updatedAt,
        patch: { context: { schemaVersion: 1, ownerId: "leak" } } as never
      })).rejects.toMatchObject({ code: "invalid_life_link" });
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink).toEqual(updated);
      updated!.context.plan!.text = "outside mutation";
      updated!.publicFieldKeys.push("notes");
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink.context.plan?.text).toBe("Replace next year");
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink.publicFieldKeys).toEqual(["condition"]);
    });

    it("applies the explicit public field boundary to QR, batch projections, and media bytes", async () => {
      const store = getStore();
      const item = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID,
        title: "Public pad", body: "Private notes", privacy: "public", createdAt,
        context: { schemaVersion: 1, condition: { text: "Private condition", truthState: "owner_reported" },
          plan: { text: "Replace next season", truthState: "planned" } }, publicFieldKeys: ["plan"] });
      const batch = await store.createQrBatch(DEMO_GUEST_ID, 1, DEFAULT_QR_BASE_URL);
      const qrId = batch.qrCodes[0].id;
      await store.setLifeLinkQrBinding(DEMO_OWNER_ID, { commandId: id("command"), lifeLinkId: item.id,
        qrId, expectedUpdatedAt: item.updatedAt });
      const media = await store.createLinkMedia(DEMO_OWNER_ID, qrId, {
        kind: "image", mimeType: "image/png", fileName: "private.png", sizeBytes: 3, data: Buffer.from("png")
      });
      const publicState = await store.getQrState(qrId, null);
      expect(publicState).toMatchObject({ state: "claimed", viewerIsOwner: false,
        link: { title: "Public pad", body: "", ownerId: null, media: [],
          context: { schemaVersion: 1, plan: { text: "Replace next season", truthState: "planned" } } } });
      expect(JSON.stringify(publicState)).not.toMatch(/Private notes|Private condition|private.png/);
      const exported = (await store.listBatchLinks(DEMO_GUEST_ID, batch.batch.id))[0];
      expect(publicState.state === "claimed" && publicState.link).toEqual(exported);
      expect(await store.getLinkMedia(qrId, media!.id, null)).toBe("private");
      expect(await store.getLinkMedia(qrId, media!.id, DEMO_GUEST_ID)).toBe("private");
      expect(await store.getLinkMedia(qrId, media!.id, DEMO_OWNER_ID)).toMatchObject({ viewerIsOwner: true });
      expect(await store.getQrState(qrId, DEMO_OWNER_ID)).toMatchObject({ link: { body: "Private notes", media: [expect.any(Object)] } });
      // Renaming never changes the explicit public-field selection.
      const bound = (await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink;
      const renamed = await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id,
        expectedUpdatedAt: bound.updatedAt, patch: { title: "Renamed public pad" } });
      expect(await store.getQrState(qrId, null)).toMatchObject({ link: { body: "" } });
      await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id,
        expectedUpdatedAt: renamed!.updatedAt,
        patch: { publicFieldKeys: ["notes", "plan"], body: "Deliberately shared notes" } });
      expect(await store.getQrState(qrId, null)).toMatchObject({ link: { body: "Deliberately shared notes",
        context: { schemaVersion: 1, plan: { text: "Replace next season", truthState: "planned" } } } });
    });

    it("creates exact identities idempotently, normalizes metadata, and pages Collections deterministically", async () => {
      const store = getStore();
      const command = { id: id("collection"), ownerId: DEMO_GUEST_ID,
        title: "  Zeta  ", purpose: "  Weekend gear  ", notes: "  Notes  ", createdAt };
      const collection = await store.createCollection(command);
      expect(collection).toMatchObject({ title: "Zeta", purpose: "Weekend gear", notes: "Notes" });
      expect(await store.createCollection(command)).toEqual(collection);
      await expect(store.createCollection({ ...command, title: "Different" }))
        .rejects.toMatchObject({ code: "duplicate_collection_id" });
      await createCollection("Alpha", DEMO_GUEST_ID);
      const first = await store.listCollections(DEMO_GUEST_ID, { limit: 1 });
      const next = await store.listCollections(DEMO_GUEST_ID, { limit: 1, cursor: first.nextCursor });
      expect(first.items[0].title.localeCompare(next.items[0].title)).toBeLessThanOrEqual(0);
      expect(first.nextCursor).toBeTruthy();
      expect(await store.getCollection(DEMO_OWNER_ID, collection.id)).toBeNull();
      await expect(store.createCollection({ ...command, id: id("collection"), title: " " }))
        .rejects.toMatchObject({ code: "invalid_collection" });
    });

    it("keeps exact membership independent of hierarchy and supports overlapping Sections", async () => {
      const store = getStore();
      const parent = await createItem("Gear container");
      const child = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID,
        parentId: parent.id, title: "Sleeping pad", createdAt });
      let collection = await createCollection();
      collection = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id,
        lifeLinkId: child.id, expectedUpdatedAt: collection.updatedAt }))!;
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, collection.id))?.items.map((row) => row.id)).toEqual([child.id]);
      const first = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: collection.id,
        title: "Sleep system", expectedUpdatedAt: collection.updatedAt }))!;
      const second = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: collection.id,
        title: "Upgrade next year", expectedUpdatedAt: first.collection.updatedAt }))!;
      expect(second.section.position).toBeGreaterThan(first.section.position);
      collection = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, {
        collectionId: collection.id, lifeLinkId: child.id, sectionIds: [first.section.id, second.section.id],
        expectedUpdatedAt: second.collection.updatedAt }))!;
      const memberships = await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, child.id);
      expect(memberships?.items).toHaveLength(1);
      expect(memberships?.items[0].sections.map((section) => section.id)).toEqual([first.section.id, second.section.id]);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))?.lifeLink).toEqual(child);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, parent.id))?.items).toEqual([]);
      const other = await createCollection("Family trips");
      await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: other.id, lifeLinkId: child.id,
        expectedUpdatedAt: other.updatedAt });
      const page = await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, child.id, { limit: 1 });
      const rest = await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, child.id, { limit: 1, cursor: page!.nextCursor });
      expect(new Set([...page!.items, ...rest!.items].map((entry) => entry.collection.id)).size).toBe(2);
    });

    it("rejects cross-owner and cross-Collection assignments without partial writes", async () => {
      const store = getStore();
      const item = await createItem();
      const foreign = await createItem("Guest pad", DEMO_GUEST_ID);
      const collection = await createCollection();
      expect(await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id,
        lifeLinkId: foreign.id, expectedUpdatedAt: collection.updatedAt })).toBeNull();
      expect(await store.getCollection(DEMO_OWNER_ID, collection.id)).toEqual(collection);
      const added = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id,
        lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt }))!;
      const other = await createCollection("Other");
      const section = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: other.id,
        title: "Other section", expectedUpdatedAt: other.updatedAt }))!;
      await expect(store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: collection.id,
        lifeLinkId: item.id, sectionIds: [section.section.id], expectedUpdatedAt: added.updatedAt })).rejects.toBeDefined();
      expect(await store.getCollection(DEMO_OWNER_ID, collection.id)).toEqual(added);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))?.items[0].sections).toEqual([]);
      expect(await store.listCollectionMembers(DEMO_GUEST_ID, collection.id)).toBeNull();
      expect(await store.listLifeLinkCollectionMemberships(DEMO_GUEST_ID, item.id)).toBeNull();
    });

    it("converges membership retries and confines Section removal cascades to associations", async () => {
      const store = getStore();
      const item = await createItem();
      let collection = await createCollection();
      const add = { collectionId: collection.id, lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt };
      collection = (await store.addCollectionMember(DEMO_OWNER_ID, add))!;
      expect(await store.addCollectionMember(DEMO_OWNER_ID, add)).toEqual(collection);
      const s1 = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: collection.id,
        title: "One", expectedUpdatedAt: collection.updatedAt }))!;
      const s2 = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: collection.id,
        title: "Two", expectedUpdatedAt: s1.collection.updatedAt }))!;
      const replace = { collectionId: collection.id, lifeLinkId: item.id,
        sectionIds: [s1.section.id, s2.section.id], expectedUpdatedAt: s2.collection.updatedAt };
      collection = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, replace))!;
      expect(await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, replace)).toEqual(collection);
      collection = (await store.removeCollectionSection(DEMO_OWNER_ID, { collectionId: collection.id,
        sectionId: s1.section.id, expectedUpdatedAt: collection.updatedAt }))!;
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))?.items[0].sections.map((s) => s.id))
        .toEqual([s2.section.id]);
      const remove = { collectionId: collection.id, lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt };
      collection = (await store.removeCollectionMember(DEMO_OWNER_ID, remove))!;
      expect(await store.removeCollectionMember(DEMO_OWNER_ID, remove)).toEqual(collection);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))?.items).toEqual([]);
      expect((await store.listCollectionSections(DEMO_OWNER_ID, collection.id))?.items.map((s) => s.id)).toEqual([s2.section.id]);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink).toEqual(item);
    });

    it("serializes same-revision metadata edits and rejects genuinely stale membership changes", async () => {
      const store = getStore();
      const collection = await createCollection();
      const outcomes = await Promise.allSettled(["First", "Second"].map((title) => store.updateCollection(DEMO_OWNER_ID,
        { collectionId: collection.id, expectedUpdatedAt: collection.updatedAt, patch: { title } })));
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: "stale_collection" });
      const item = await createItem();
      await expect(store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id,
        lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt })).rejects.toMatchObject({ code: "stale_collection" });
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, collection.id))?.items).toEqual([]);
    });

    it("atomically attaches, changes and detaches QRs through the existing command owner", async () => {
      const store = getStore();
      const item = await createItem();
      const other = await createItem("Other pad");
      const batch = await store.createQrBatch(DEMO_OWNER_ID, 3, DEFAULT_QR_BASE_URL);
      const [firstQr, secondQr, occupiedQr] = batch.qrCodes.map((qr) => qr.id);
      const initialCommand = { commandId: id("command"), lifeLinkId: item.id,
        qrId: firstQr, expectedUpdatedAt: item.updatedAt };
      const attached = (await store.setLifeLinkQrBinding(DEMO_OWNER_ID, initialCommand))!;
      expect(attached.qrId).toBe(firstQr);
      expect(await store.setLifeLinkQrBinding(DEMO_OWNER_ID, initialCommand)).toEqual(attached);
      await store.setLifeLinkQrBinding(DEMO_OWNER_ID, { commandId: id("command"), lifeLinkId: other.id,
        qrId: occupiedQr, expectedUpdatedAt: other.updatedAt });
      await expect(store.setLifeLinkQrBinding(DEMO_OWNER_ID, { commandId: id("command"), lifeLinkId: item.id,
        qrId: occupiedQr, expectedUpdatedAt: attached.updatedAt })).rejects.toMatchObject({ code: "qr_already_bound" });
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink).toEqual(attached);
      const changed = (await store.setLifeLinkQrBinding(DEMO_OWNER_ID, { commandId: id("command"), lifeLinkId: item.id,
        qrId: secondQr, expectedUpdatedAt: attached.updatedAt }))!;
      expect(changed.qrId).toBe(secondQr);
      expect(await store.getQrState(firstQr, null)).toMatchObject({ state: "private" });
      expect(await store.getQrState(firstQr, DEMO_OWNER_ID)).toMatchObject({ state: "unclaimed" });
      expect((await store.setLifeLinkQrBinding(DEMO_OWNER_ID, initialCommand))?.qrId).toBe(secondQr);
      const clear = { commandId: id("command"), lifeLinkId: item.id, expectedUpdatedAt: changed.updatedAt };
      const detached = await store.clearLifeLinkQrBinding(DEMO_OWNER_ID, clear);
      expect(detached?.qrId).toBeNull();
      expect(await store.getQrState(secondQr, null)).toMatchObject({ state: "private" });
      expect(await store.getQrState(secondQr, DEMO_OWNER_ID)).toMatchObject({ state: "unclaimed" });
      expect(await store.clearLifeLinkQrBinding(DEMO_OWNER_ID, clear)).toEqual(detached);
      await expect(store.setLifeLinkQrBinding(DEMO_OWNER_ID, { ...initialCommand, qrId: secondQr })).rejects.toBeDefined();
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink).toEqual(detached);
    });
  });
}
