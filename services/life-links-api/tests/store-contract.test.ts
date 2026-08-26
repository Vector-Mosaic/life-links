import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_QR_BASE_URL,
  DEMO_OWNER_ID,
  DEMO_PASSWORD,
  LifeLinkDomainError,
  MAX_PROJECT_NAME_LENGTH
} from "@life-links/core";

import { ClaimIdempotencyConflictError, InMemoryLifeLinksStore } from "../src/store.js";

describe("canonical Life Links store contract", () => {
  let store: InMemoryLifeLinksStore;

  beforeEach(async () => {
    store = new InMemoryLifeLinksStore();
    await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
  });

  it("creates arbitrary recursive structure with deterministic cursor paging and duplicate titles", async () => {
    const createdAt = "2026-08-25T12:00:00.000Z";
    const root = await store.createLifeLink({ id: "root-a", ownerId: DEMO_OWNER_ID, title: "Archive", createdAt });
    await store.createLifeLink({ id: "child-b", ownerId: DEMO_OWNER_ID, parentId: root.id, title: "Same", createdAt });
    await store.createLifeLink({ id: "child-a", ownerId: DEMO_OWNER_ID, parentId: root.id, title: "Same", createdAt });
    await store.createLifeLink({ id: "child-c", ownerId: DEMO_OWNER_ID, parentId: root.id, title: "Same", createdAt });

    const first = await store.listLifeLinks(DEMO_OWNER_ID, root.id, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["child-a", "child-b"]);
    expect(first).toMatchObject({ truncated: true });
    expect(first.nextCursor).toBeTruthy();

    const second = await store.listLifeLinks(DEMO_OWNER_ID, root.id, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual(["child-c"]);
    expect(second).toMatchObject({ truncated: false, nextCursor: null });

    const detail = await store.getLifeLinkDetail(DEMO_OWNER_ID, "child-c");
    expect(detail?.ancestry.items.map((item) => item.id)).toEqual([root.id, "child-c"]);
    expect(root).toMatchObject({ privacy: "private", qrId: null, parentId: null });
  });

  it("enforces optimistic revisions, owner boundaries, self-parenting, and cycles", async () => {
    const createdAt = "2026-08-25T12:00:00.000Z";
    const root = await store.createLifeLink({ id: "move-root", ownerId: DEMO_OWNER_ID, createdAt });
    const child = await store.createLifeLink({
      id: "move-child",
      ownerId: DEMO_OWNER_ID,
      parentId: root.id,
      createdAt
    });
    const updated = await store.updateLifeLink(DEMO_OWNER_ID, {
      lifeLinkId: child.id,
      expectedUpdatedAt: child.updatedAt,
      patch: { title: "Updated" }
    });
    expect(updated?.updatedAt).not.toBe(child.updatedAt);
    await expect(
      store.updateLifeLink(DEMO_OWNER_ID, {
        lifeLinkId: child.id,
        expectedUpdatedAt: child.updatedAt,
        patch: { title: "Stale" }
      })
    ).rejects.toMatchObject({ code: "stale_life_link", retryable: true });
    await expect(
      store.updateLifeLink(DEMO_OWNER_ID, {
        lifeLinkId: child.id,
        expectedUpdatedAt: updated!.updatedAt,
        patch: { bodyDocVersion: 1 }
      })
    ).rejects.toMatchObject({ code: "invalid_life_link", reason: "body_doc_version_without_content" });
    await expect(
      store.moveLifeLink(DEMO_OWNER_ID, {
        lifeLinkId: root.id,
        parentId: child.id,
        expectedUpdatedAt: root.updatedAt
      })
    ).rejects.toMatchObject({ code: "hierarchy_cycle" });
    await expect(
      store.moveLifeLink(DEMO_OWNER_ID, {
        lifeLinkId: root.id,
        parentId: root.id,
        expectedUpdatedAt: root.updatedAt
      })
    ).rejects.toMatchObject({ code: "invalid_parent", reason: "self_parent" });
  });

  it("attaches a QR idempotently without changing canonical identity", async () => {
    const target = await store.createLifeLink({
      id: "physical-passport",
      ownerId: DEMO_OWNER_ID,
      title: "Passport",
      createdAt: "2026-08-25T12:00:00.000Z"
    });
    const batch = await store.createQrBatch(DEMO_OWNER_ID, 2, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    const command = { commandId: "attach-passport", mode: "attach" as const, lifeLinkId: target.id };

    const first = await store.claimQr(qrId, DEMO_OWNER_ID, command);
    const replay = await store.claimQr(qrId, DEMO_OWNER_ID, command);
    expect(first).toMatchObject({ result: "claimed", replayed: false, state: { state: "claimed" } });
    expect(replay).toMatchObject({ result: "claimed", replayed: true });
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, target.id))?.lifeLink.qrId).toBe(qrId);
    expect(first.state.state === "claimed" ? first.state.link.id : null).toBe(qrId);

    await expect(store.claimQr(batch.qrCodes[1].id, DEMO_OWNER_ID, command)).rejects.toBeInstanceOf(
      ClaimIdempotencyConflictError
    );
    await expect(
      store.claimQr(batch.qrCodes[1].id, DEMO_OWNER_ID, {
        commandId: "attach-again",
        mode: "attach",
        lifeLinkId: target.id
      })
    ).rejects.toMatchObject({ code: "life_link_already_tagged" });
  });

  it("keeps Projects as bounded compatibility markers and prevents nested flattening", async () => {
    await expect(store.createProject(DEMO_OWNER_ID, "x".repeat(MAX_PROJECT_NAME_LENGTH + 1))).rejects.toBeInstanceOf(
      LifeLinkDomainError
    );
    const root = await store.createLifeLink({
      id: "plain-root",
      ownerId: DEMO_OWNER_ID,
      title: "Plain root",
      createdAt: "2026-08-25T12:00:00.000Z"
    });
    const nested = await store.createLifeLink({
      id: "nested",
      ownerId: DEMO_OWNER_ID,
      parentId: root.id,
      title: "Nested",
      createdAt: "2026-08-25T12:00:00.000Z"
    });
    const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    await store.claimQr(qrId, DEMO_OWNER_ID, {
      commandId: "attach-nested",
      mode: "attach",
      lifeLinkId: nested.id
    });
    await expect(store.updateLink(DEMO_OWNER_ID, qrId, { projectId: "project-home" })).rejects.toMatchObject({
      code: "invalid_parent",
      reason: "legacy_nested"
    });
  });

  it("uses canonical media ownership while preserving QR media projections", async () => {
    const target = await store.createLifeLink({
      id: "media-target",
      ownerId: DEMO_OWNER_ID,
      title: "Media target",
      createdAt: "2026-08-25T12:00:00.000Z"
    });
    const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    await store.claimQr(qrId, DEMO_OWNER_ID, {
      commandId: "attach-media",
      mode: "attach",
      lifeLinkId: target.id
    });
    const media = await store.createLinkMedia(DEMO_OWNER_ID, qrId, {
      kind: "image",
      mimeType: "image/png",
      fileName: "photo.png",
      sizeBytes: 5,
      data: Buffer.from("photo")
    });
    expect(media?.qrId).toBe(qrId);
    expect(media?.url).toContain(`/api/links/${encodeURIComponent(qrId)}/media/`);
    const canonical = await store.getLifeLinkDetail(DEMO_OWNER_ID, target.id);
    expect(canonical?.lifeLink.media[0]).toMatchObject({ lifeLinkId: target.id, id: media?.id });
    await expect(
      store.createLifeLinkMedia(DEMO_OWNER_ID, target.id, {
        kind: "image",
        mimeType: "image/png",
        fileName: "bad.png",
        sizeBytes: 99,
        data: Buffer.from("bad")
      })
    ).rejects.toMatchObject({ code: "invalid_life_link", reason: "media_size_mismatch" });
  });
});
