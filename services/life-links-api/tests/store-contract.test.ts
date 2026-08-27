import { beforeEach, describe, expect, it } from "vitest";

import {
  COMPETITION_CAMPING_KIT_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_BAG_QR_ID,
  COMPETITION_OWNER_ID,
  COMPETITION_START_LIFE_LINK_ID,
  COMPETITION_TARGET_QR_ID,
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

  it("connects and disconnects an owner agent idempotently", async () => {
    expect((await store.getUserById(DEMO_OWNER_ID))?.agentConnectedAt).toBeNull();

    const connected = await store.connectAgent(DEMO_OWNER_ID);
    expect(connected?.agentConnectedAt).toEqual(expect.any(String));
    expect(new Date(connected!.agentConnectedAt!).toISOString()).toBe(connected!.agentConnectedAt);

    const replay = await store.connectAgent(DEMO_OWNER_ID);
    expect(replay?.agentConnectedAt).toBe(connected?.agentConnectedAt);

    const disconnected = await store.disconnectAgent(DEMO_OWNER_ID);
    expect(disconnected?.agentConnectedAt).toBeNull();
    expect((await store.disconnectAgent(DEMO_OWNER_ID))?.agentConnectedAt).toBeNull();
    expect(await store.connectAgent("missing-owner")).toBeNull();
    expect(await store.disconnectAgent("missing-owner")).toBeNull();
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

  it("dry-runs and reapplies the deterministic competition owner sandbox without touching another owner", async () => {
    const options = {
      password: "competition-password",
      qrBaseUrl: "https://challenge.life-links.test"
    };
    const legacyOwnerBefore = await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home");
    const dryRun = await store.resetCompetitionFixture(options);
    expect(dryRun).toMatchObject({
      profile: COMPETITION_FIXTURE_PROFILE,
      ownerId: COMPETITION_OWNER_ID,
      mode: "dry-run",
      applied: false,
      before: { users: 0, lifeLinks: 0, sessions: 0 },
      after: { users: 0, lifeLinks: 0, sessions: 0 },
      expected: { users: 1, lifeLinks: 60, qrBindings: 8, qrCodes: 8, batches: 1 }
    });
    expect(dryRun.expected).toEqual({
      users: 1,
      sessions: 0,
      lifeLinks: 60,
      qrBindings: 8,
      projectCompatibility: 1,
      media: 0,
      batches: 1,
      qrCodes: 8,
      claimEvents: 0
    });
    expect(await store.getUserById(COMPETITION_OWNER_ID)).toBeNull();

    const firstApply = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(firstApply.after).toEqual(firstApply.expected);
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBeNull();
    const connectedAt = (await store.connectAgent(COMPETITION_OWNER_ID))?.agentConnectedAt;
    expect(connectedAt).toEqual(expect.any(String));
    const start = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_START_LIFE_LINK_ID);
    expect(start?.ancestry.items.map((item) => item.title)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Basement Gear Storage",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
    ]);
    expect(start?.lifeLink).toMatchObject({ qrId: COMPETITION_TARGET_QR_ID, privacy: "public" });
    const sleepingBag = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID);
    expect(sleepingBag?.ancestry.items.map((item) => item.title)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Basement Gear Storage",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep System",
      "Camping Sleeping Bag"
    ]);
    expect(sleepingBag?.lifeLink).toMatchObject({ qrId: COMPETITION_SLEEPING_BAG_QR_ID, privacy: "public" });

    const publicState = await store.getQrState(COMPETITION_TARGET_QR_ID, null);
    expect(publicState).toMatchObject({
      state: "claimed",
      viewerIsOwner: false,
      link: {
        ownerId: null,
        projectId: null,
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
        body: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY
      }
    });
    expect(JSON.stringify(publicState)).not.toMatch(/low-R|Adult Two|working bag|cold through|upgrade|\$250/i);
    const ownerState = await store.getQrState(COMPETITION_TARGET_QR_ID, COMPETITION_OWNER_ID);
    expect(ownerState).toMatchObject({
      state: "claimed",
      viewerIsOwner: true,
      link: { ownerId: COMPETITION_OWNER_ID, projectId: COMPETITION_CAMPING_KIT_ID }
    });

    await store.createSession(
      COMPETITION_OWNER_ID,
      "competition-session-hash",
      "2099-01-01T00:00:00.000Z"
    );
    await store.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
      expectedUpdatedAt: sleepingBag!.lifeLink.updatedAt,
      patch: { title: "Drifted battery kit" }
    });
    await store.createLifeLink({
      id: "competition-extra-life-link",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Judge-created extra",
      createdAt: "2026-08-26T13:00:00.000Z"
    });
    await store.createQrBatch(COMPETITION_OWNER_ID, 1, options.qrBaseUrl);

    const driftDryRun = await store.resetCompetitionFixture(options);
    expect(driftDryRun.applied).toBe(false);
    expect(driftDryRun.after).toEqual(driftDryRun.before);
    expect((await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title).toBe(
      "Drifted battery kit"
    );
    expect(await store.getSessionByTokenHash("competition-session-hash")).not.toBeNull();

    const restored = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(restored.after).toEqual(restored.expected);
    expect(await store.getSessionByTokenHash("competition-session-hash")).toBeNull();
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBe(connectedAt);
    expect(await store.getLifeLinkDetail(COMPETITION_OWNER_ID, "competition-extra-life-link")).toBeNull();
    expect((await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title).toBe(
      "Camping Sleeping Bag"
    );
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home")).toEqual(legacyOwnerBefore);

    const replay = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(replay.before).toEqual(replay.expected);
    expect(replay.after).toEqual(replay.expected);
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBe(connectedAt);

    const foreignBatch = await store.createQrBatch(DEMO_OWNER_ID, 1, options.qrBaseUrl);
    const foreignQrId = foreignBatch.qrCodes[0].id;
    const foreignQrTarget = await store.createLifeLink({
      id: "competition-foreign-qr-target",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Foreign QR reset sentinel",
      createdAt: "2026-08-26T14:00:00.000Z"
    });
    await store.claimQr(foreignQrId, COMPETITION_OWNER_ID, {
      commandId: "competition-foreign-qr-attach",
      mode: "attach",
      lifeLinkId: foreignQrTarget.id
    });
    const foreignBatchView = await store.listBatchLinks(DEMO_OWNER_ID, foreignBatch.batch.id);
    expect(foreignBatchView).toHaveLength(1);
    expect(foreignBatchView[0]).toMatchObject({
      id: foreignQrId,
      status: "claimed",
      ownerId: null,
      projectId: null,
      title: "",
      body: "",
      privacy: "private",
      media: []
    });
    expect(JSON.stringify(foreignBatchView)).not.toContain("Foreign QR reset sentinel");
    expect(JSON.stringify(foreignBatchView)).not.toContain(COMPETITION_OWNER_ID);
    await expect(store.resetCompetitionFixture({ ...options, mode: "apply" })).rejects.toThrow(
      "outside its owner sandbox"
    );
    expect(await store.getQrState(foreignQrId, COMPETITION_OWNER_ID)).toMatchObject({
      state: "claimed",
      viewerIsOwner: true,
      link: { ownerId: COMPETITION_OWNER_ID }
    });
  });

  it("rolls back the in-memory competition reset if its exact postcondition fails", async () => {
    const isolated = new InMemoryLifeLinksStore();
    const options = {
      password: "competition-password",
      qrBaseUrl: "https://challenge.life-links.test",
      mode: "apply" as const
    };
    await isolated.resetCompetitionFixture(options);
    const target = await isolated.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID);
    await isolated.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
      expectedUpdatedAt: target!.lifeLink.updatedAt,
      patch: { title: "In-memory rollback sentinel" }
    });
    await isolated.createSession(
      COMPETITION_OWNER_ID,
      "competition-memory-rollback-session-hash",
      "2099-01-01T00:00:00.000Z"
    );

    const failureInjectable = isolated as unknown as {
      assertCompetitionFixturePostcondition: () => void;
    };
    const originalPostcondition = failureInjectable.assertCompetitionFixturePostcondition;
    failureInjectable.assertCompetitionFixturePostcondition = () => {
      throw new Error("forced competition fixture postcondition failure");
    };
    try {
      await expect(isolated.resetCompetitionFixture(options)).rejects.toThrow(
        "forced competition fixture postcondition failure"
      );
    } finally {
      failureInjectable.assertCompetitionFixturePostcondition = originalPostcondition;
    }

    expect(
      (await isolated.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title
    ).toBe("In-memory rollback sentinel");
    expect(await isolated.getSessionByTokenHash("competition-memory-rollback-session-hash")).not.toBeNull();
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
    const grandchild = await store.createLifeLink({
      id: "move-grandchild",
      ownerId: DEMO_OWNER_ID,
      parentId: child.id,
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
        lifeLinkId: child.id,
        parentId: null,
        expectedUpdatedAt: child.updatedAt
      })
    ).rejects.toMatchObject({ code: "stale_life_link", retryable: true });
    const moved = await store.moveLifeLink(DEMO_OWNER_ID, {
      lifeLinkId: child.id,
      parentId: null,
      expectedUpdatedAt: updated!.updatedAt
    });
    expect(moved?.parentId).toBeNull();
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, grandchild.id))?.lifeLink.parentId).toBe(child.id);
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

    await expect(
      store.claimQr(qrId, DEMO_OWNER_ID, {
        commandId: "attach-passport-same-target",
        mode: "attach",
        lifeLinkId: target.id
      })
    ).resolves.toMatchObject({ result: "already_owned", replayed: false });

    const differentTarget = await store.createLifeLink({
      id: "different-physical-passport",
      ownerId: DEMO_OWNER_ID,
      title: "Different target",
      createdAt: "2026-08-25T12:00:01.000Z"
    });
    await expect(
      store.claimQr(qrId, DEMO_OWNER_ID, {
        commandId: "attach-passport-different-target",
        mode: "attach",
        lifeLinkId: differentTarget.id
      })
    ).rejects.toMatchObject({ code: "qr_already_bound" });

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
