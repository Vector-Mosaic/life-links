import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEMO_GUEST_ID, DEMO_OWNER_ID, DEFAULT_QR_BASE_URL } from "@life-links/core";
import type { LifeLinksStore } from "../src/store.js";

const createdAt = "2026-08-29T00:00:00.000Z";
const id = (prefix: string) => `${prefix}-${randomUUID()}`;

// One observable contract is exercised against both real store implementations.
export function fieldLedgerStoreContract(getStore: () => LifeLinksStore): void {
  describe("Field Ledger additive store contract", () => {
    it("requires current Workspace v3 for agent Collection changes including replay after revocation", async () => {
      const store = getStore();
      const collection = await store.createCollection({ id: id("collection"), ownerId: DEMO_OWNER_ID, title: "Agent selection", createdAt });
      const input = { operation: "delete" as const, scope: "collections" as const,
        collections: [{ collectionId: collection.id, expectedUpdatedAt: collection.updatedAt }] };
      const denied = { code: "agent_access_denied" };
      try {
        for (const catalog of ["life-links-page-webmcp-v1", "life-links-calendar-v2"] as const) {
          await store.connectAgent(DEMO_OWNER_ID, catalog);
          await expect(store.previewCollectionChange(DEMO_OWNER_ID, input, "agent")).rejects.toMatchObject(denied);
        }
        const granted = await store.connectAgent(DEMO_OWNER_ID, "life-links-workspace-v3");
        expect(granted?.agentToolCatalogId).toBe("life-links-workspace-v3");
        const preview = await store.previewCollectionChange(DEMO_OWNER_ID, input, "agent");
        expect(await store.getCollectionChangePreview(DEMO_OWNER_ID, preview.id, "agent")).toEqual(preview);
        await store.connectAgent(DEMO_GUEST_ID, "life-links-workspace-v3");
        expect(await store.getCollectionChangePreview(DEMO_GUEST_ID, preview.id, "agent")).toBeNull();
        const command = { previewId: preview.id, commandId: id("collection-command") };
        await store.disconnectAgent(DEMO_OWNER_ID);
        await expect(store.getCollectionChangePreview(DEMO_OWNER_ID, preview.id, "agent")).rejects.toMatchObject(denied);
        await expect(store.applyCollectionChange(DEMO_OWNER_ID, command, "agent")).rejects.toMatchObject(denied);
        expect(await store.getCollection(DEMO_OWNER_ID, collection.id)).not.toBeNull();
        await store.connectAgent(DEMO_OWNER_ID, "life-links-workspace-v3");
        const applied = await store.applyCollectionChange(DEMO_OWNER_ID, command, "agent");
        expect(await store.applyCollectionChange(DEMO_OWNER_ID, command, "agent")).toEqual(applied);
        await store.connectAgent(DEMO_OWNER_ID, "life-links-calendar-v2");
        await expect(store.applyCollectionChange(DEMO_OWNER_ID, command, "agent")).rejects.toMatchObject(denied);
        // The human owner retains the same stable receipt independently of page-agent consent.
        expect(await store.applyCollectionChange(DEMO_OWNER_ID, command)).toEqual(applied);
      } finally {
        await store.disconnectAgent(DEMO_OWNER_ID);
        await store.disconnectAgent(DEMO_GUEST_ID);
      }
    });

    const createItem = (title = "Sleeping pad", ownerId = DEMO_OWNER_ID) =>
      getStore().createLifeLink({ id: id("life-link"), ownerId, title, createdAt });
    const createCollection = (title = "Camping Gear", ownerId = DEMO_OWNER_ID) =>
      getStore().createCollection({ id: id("collection"), ownerId, title, createdAt });

    const collectionFixture = async () => {
      const store = getStore();
      const item = await createItem();
      let source = await createCollection("Source");
      const target = await createCollection("Target");
      source = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: source.id, lifeLinkId: item.id, expectedUpdatedAt: source.updatedAt }))!;
      const first = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: source.id, title: "First", expectedUpdatedAt: source.updatedAt }))!;
      const second = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: source.id, title: "Second", expectedUpdatedAt: first.collection.updatedAt }))!;
      source = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: source.id, lifeLinkId: item.id, sectionIds: [first.section.id, second.section.id], expectedUpdatedAt: second.collection.updatedAt }))!;
      return { store, item, source, target, first: first.section, second: second.section };
    };
    const undoLatest = async () => {
      const store = getStore();
      await store.undoChange(DEMO_OWNER_ID, { changeId: (await store.getChangeHistory(DEMO_OWNER_ID)).entries[0].id, commandId: id("undo") });
    };

    it("deletes Collections atomically through the shared journal without deleting their physical members", async () => {
      const { store, item, source, target } = await collectionFixture();
      const original = (await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink;
      const priorHistory = await store.getChangeHistory(DEMO_OWNER_ID);
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "delete", scope: "collections",
        collections: [source, target].map((row) => ({ collectionId: row.id, expectedUpdatedAt: row.updatedAt })) });
      expect(preview.sideEffects).toMatchObject({ collectionsRemoved: 2, sectionsRemoved: 2, membershipsRemoved: 1, assignmentsRemoved: 2, lifeLinksDeleted: 0 });
      expect(await store.getLifeLinkChangePreview(DEMO_OWNER_ID, preview.id)).toBeNull();
      expect(await store.getCollectionChangePreview(DEMO_OWNER_ID, preview.id)).toEqual(preview);
      expect(await store.getCollectionChangePreview(DEMO_GUEST_ID, preview.id)).toBeNull();
      const command = { previewId: preview.id, commandId: id("collection-command") };
      const result = await store.applyCollectionChange(DEMO_OWNER_ID, command);
      expect(result.collectionIds).toEqual([source.id, target.id].sort());
      expect(result.history.entries.slice(1)).toEqual(priorHistory.entries.slice(0, 4));
      expect(await store.applyCollectionChange(DEMO_OWNER_ID, command)).toEqual(result);
      await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, command)).rejects.toThrow();
      expect(await store.getCollection(DEMO_OWNER_ID, source.id)).toBeNull();
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink).toEqual(original);
      await undoLatest();
      expect((await store.getCollection(DEMO_OWNER_ID, source.id))?.title).toBe(source.title);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items[0].sections).toHaveLength(2);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink.id).toBe(original.id);
    });

    it("removes selected assignments or whole Sections without dropping independent membership", async () => {
      const { store, item, source, first, second } = await collectionFixture();
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "delete", scope: "contents",
        source: { collectionId: source.id, expectedUpdatedAt: source.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: first.id }] });
      await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: id("collection-command") });
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items[0].sections.map((row) => row.id)).toEqual([second.id]);
      await undoLatest();
      const current = (await store.getCollection(DEMO_OWNER_ID, source.id))!;
      const sectionPreview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "delete", scope: "contents",
        source: { collectionId: current.id, expectedUpdatedAt: current.updatedAt }, sectionIds: [first.id, second.id], members: [] });
      await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: sectionPreview.id, commandId: id("collection-command") });
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, source.id))!.items.map((row) => row.id)).toEqual([item.id]);
      expect((await store.listCollectionSections(DEMO_OWNER_ID, source.id))!.items).toEqual([]);
      await undoLatest();
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items[0].sections).toHaveLength(2);
    });

    it("moves one Section appearance without erasing other assignments and treats exact destinations as no-ops", async () => {
      const { store, item, source, first, second } = await collectionFixture();
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "move", scope: "contents",
        source: { collectionId: source.id, expectedUpdatedAt: source.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: first.id }],
        target: { collectionId: source.id, expectedUpdatedAt: source.updatedAt, sectionId: second.id } });
      expect(preview.sideEffects).toMatchObject({ assignmentsRemoved: 1, assignmentsAdded: 0, membershipsRemoved: 0 });
      await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: id("collection-command") });
      const memberships = (await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items;
      expect(memberships[0].sections.map((row) => row.id)).toEqual([second.id]);
      const current = memberships[0].collection;
      const history = await store.getChangeHistory(DEMO_OWNER_ID);
      const noOp = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "move", scope: "contents",
        source: { collectionId: current.id, expectedUpdatedAt: current.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: second.id }],
        target: { collectionId: current.id, expectedUpdatedAt: current.updatedAt, sectionId: second.id } });
      expect((await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: noOp.id, commandId: id("collection-command") })).collectionIds).toEqual([]);
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
    });

    it("transfers selected direct membership across Collections while retaining destination assignments", async () => {
      const { store, item, source, target, first } = await collectionFixture();
      let destination = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: target.id, lifeLinkId: item.id, expectedUpdatedAt: target.updatedAt }))!;
      const section = (await store.createCollectionSection(DEMO_OWNER_ID, { id: id("section"), collectionId: target.id, title: "Existing destination", expectedUpdatedAt: destination.updatedAt }))!;
      destination = (await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: target.id, lifeLinkId: item.id, sectionIds: [section.section.id], expectedUpdatedAt: section.collection.updatedAt }))!;
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "move", scope: "contents",
        source: { collectionId: source.id, expectedUpdatedAt: source.updatedAt }, sectionIds: [], members: [{ lifeLinkId: item.id, sourceSectionId: first.id }],
        target: { collectionId: destination.id, expectedUpdatedAt: destination.updatedAt, sectionId: null } });
      await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: id("collection-command") });
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, source.id))!.items).toEqual([]);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items.map((row) => [row.collection.id, row.sections.map((entry) => entry.id)]))
        .toEqual([[target.id, [section.section.id]]]);
      await undoLatest();
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items).toHaveLength(2);
    });

    it("moves a whole Section with stable identity and reverses its composite foreign-key edges", async () => {
      const { store, item, source, target, first, second } = await collectionFixture();
      const original = (await store.getLifeLinkDetail(DEMO_OWNER_ID,item.id))!.lifeLink;
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID, { operation: "move", scope: "contents",
        source: { collectionId: source.id, expectedUpdatedAt: source.updatedAt }, sectionIds: [first.id], members: [{ lifeLinkId: item.id, sourceSectionId: first.id }],
        target: { collectionId: target.id, expectedUpdatedAt: target.updatedAt, sectionId: null } });
      expect(preview.sideEffects).toMatchObject({ sectionsMoved: 1, sectionsRemoved: 0, membershipsRemoved: 0, membershipsAdded: 1 });
      await store.applyCollectionChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: id("collection-command") });
      expect((await store.listCollectionSections(DEMO_OWNER_ID, target.id))!.items[0]).toMatchObject({ id: first.id, title: first.title, collectionId: target.id });
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, source.id))!.items.map((row) => row.id)).toEqual([item.id]);
      expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, item.id))!.items.find((row) => row.collection.id === source.id)?.sections.map((row) => row.id)).toEqual([second.id]);
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID,item.id))!.lifeLink).toEqual(original);
      await undoLatest();
      expect((await store.listCollectionSections(DEMO_OWNER_ID, source.id))!.items.map((row) => row.id)).toEqual([first.id, second.id]);
      expect((await store.listCollectionMembers(DEMO_OWNER_ID, target.id))!.items).toEqual([]);
    });

    it("refuses stale, foreign and cross-domain Collection changes without partial effects", async () => {
      const { store, item, source, target } = await collectionFixture();
      const input = { operation: "move" as const, scope: "contents" as const, source: { collectionId: source.id, expectedUpdatedAt: source.updatedAt }, sectionIds: [],
        members: [{ lifeLinkId: item.id, sourceSectionId: null }], target: { collectionId: target.id, expectedUpdatedAt: target.updatedAt, sectionId: null } };
      await expect(store.previewCollectionChange(DEMO_GUEST_ID,input)).rejects.toMatchObject({ code: "collection_not_found" });
      const preview = await store.previewCollectionChange(DEMO_OWNER_ID,input);
      await store.updateCollection(DEMO_OWNER_ID,{ collectionId: target.id, expectedUpdatedAt: target.updatedAt, patch: { title: "Changed target" } });
      const history = await store.getChangeHistory(DEMO_OWNER_ID);
      await expect(store.applyCollectionChange(DEMO_OWNER_ID,{previewId:preview.id,commandId:id("collection-command")})).rejects.toMatchObject({code:"stale_collection"});
      expect((await store.listCollectionMembers(DEMO_OWNER_ID,source.id))!.items.map((row)=>row.id)).toEqual([item.id]);
      expect((await store.listCollectionMembers(DEMO_OWNER_ID,target.id))!.items).toEqual([]);
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
      const physical = await store.previewLifeLinkChange(DEMO_OWNER_ID,{operation:"delete",lifeLinkIds:[item.id]});
      await expect(store.applyCollectionChange(DEMO_OWNER_ID,{previewId:physical.id,commandId:id("collection-command")})).rejects.toMatchObject({code:"collection_not_found"});
    });

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

    it("enriches Collection workspace member pages with complete bounded cross-Collection context", async () => {
      const store = getStore(), ownerId = DEMO_GUEST_ID;
      const first = await createItem("A enriched member", ownerId);
      const second = await createItem("B enriched member", ownerId);
      let collection = await createCollection("A enriched context", ownerId);
      for (const item of [first, second]) collection = (await store.addCollectionMember(ownerId, {
        collectionId: collection.id, lifeLinkId: item.id, expectedUpdatedAt: collection.updatedAt }))!;
      const sections: string[] = [];
      for (const title of ["First section", "Second section"]) {
        const result = (await store.createCollectionSection(ownerId, { id: id("section"), collectionId: collection.id,
          title, expectedUpdatedAt: collection.updatedAt }))!;
        collection = result.collection; sections.push(result.section.id);
      }
      collection = (await store.replaceCollectionSectionAssignments(ownerId, { collectionId: collection.id,
        lifeLinkId: first.id, sectionIds: sections, expectedUpdatedAt: collection.updatedAt }))!;
      for (let index = 0; index < 25; index++) {
        const other = await createCollection(`Context ${String(index).padStart(2, "0")}`, ownerId);
        await store.addCollectionMember(ownerId, { collectionId: other.id, lifeLinkId: first.id, expectedUpdatedAt: other.updatedAt });
      }
      const legacy = (await store.listCollectionMembers(ownerId, collection.id, { limit: 1 }))!;
      expect(legacy).not.toHaveProperty("membershipPages");
      const enriched = (await store.listCollectionMembers(ownerId, collection.id, { limit: 1, includeMemberships: true }))!;
      const { membershipPages, ...unchanged } = enriched;
      expect(unchanged).toEqual(legacy);
      expect(Object.keys(membershipPages!)).toEqual([first.id]);
      const initial = membershipPages![first.id];
      expect(initial).toEqual(await store.listLifeLinkCollectionMemberships(ownerId, first.id));
      expect(initial.items).toHaveLength(25);
      expect(initial.items[0].sections.map(section => section.id)).toEqual(sections);
      expect(initial.truncated).toBe(true);
      const rest = (await store.listLifeLinkCollectionMemberships(ownerId, first.id, { cursor: initial.nextCursor }))!;
      expect(rest.items).toHaveLength(1);
      expect(rest).toMatchObject({ nextCursor: null, truncated: false });
      expect(new Set([...initial.items, ...rest.items].map(entry => entry.collection.id)).size).toBe(26);
      const next = (await store.listCollectionMembers(ownerId, collection.id,
        { limit: 1, cursor: enriched.nextCursor, includeMemberships: true }))!;
      expect(Object.keys(next.membershipPages!)).toEqual([second.id]);
      expect(next.membershipPages![second.id]).toEqual(await store.listLifeLinkCollectionMemberships(ownerId, second.id));
      expect(next.membershipPages![second.id].items[0].sections).toEqual([]);
      expect(await store.listCollectionMembers(DEMO_OWNER_ID, collection.id, { includeMemberships: true })).toBeNull();
      expect(await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, first.id)).toBeNull();
      const empty = await createCollection("Empty enriched context", ownerId);
      expect(await store.listCollectionMembers(ownerId, empty.id, { includeMemberships: true }))
        .toEqual({ items: [], nextCursor: null, truncated: false, membershipPages: {} });
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
