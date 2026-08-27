import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
  DEFAULT_LIFE_LINK_PRIVACY,
  DEFAULT_LIFE_LINK_SEARCH_LIMIT,
  DEFAULT_LIFE_LINK_TITLE,
  EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT,
  LEGACY_LIFE_LINK_ID_PREFIX,
  MAX_LIFE_LINK_BODY_SUMMARY_LENGTH,
  MAX_LIFE_LINK_CHILD_PAGE_LIMIT,
  MAX_LIFE_LINK_PATH_ITEMS,
  MAX_LIFE_LINK_SEARCH_LIMIT,
  MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT,
  MAX_LIFE_LINK_TOOL_OUTPUT_BYTES,
  MAX_LIFE_LINK_TOOL_SEARCH_RESULTS,
  REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT,
  LifeLinkDomainError,
  assertLifeLinkToolOutputWithinBounds,
  assertLifeLinkMediaBytes,
  assertLifeLinkBodyPatchIsCoordinated,
  boundLifeLinkSourceReferences,
  coordinateLifeLinkBody,
  createCanonicalLifeLink,
  deriveLifeLinkPhysicalLocator,
  deriveLifeLinkPath,
  deriveProjectCompatibilityId,
  formatRecordedLifeLinkPath,
  listLifeLinkChildren,
  mapLegacyLifeLinksSnapshot,
  mapLegacyLinkToLifeLinkId,
  mapLegacyProjectToLifeLinkId,
  normalizeLifeLinkChildPageLimit,
  normalizeLifeLinkSearchLimit,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectLifeLinkAsProject,
  projectPrivateClaimedQrAsLink,
  projectQrInventoryRecord,
  projectUnclaimedQrAsLink,
  redactNonOwnerLinkProjection,
  searchCanonicalLifeLinks,
  summarizeLifeLinkBody,
  validateLifeLinkParentPlacement,
  type LifeLinkRecord
} from "./index.js";

const NOW = "2026-08-25T12:00:00.000Z";

function lifeLink(
  id: string,
  options: Partial<LifeLinkRecord> & { ownerId?: string; parentId?: string | null } = {}
): LifeLinkRecord {
  return {
    ...createCanonicalLifeLink({
      id,
      ownerId: options.ownerId ?? "owner-alpha",
      parentId: options.parentId ?? null,
      title: options.title ?? id,
      createdAt: options.createdAt ?? NOW
    }),
    ...options,
    id,
    ownerId: options.ownerId ?? "owner-alpha",
    parentId: options.parentId ?? null
  };
}

function hydrateMigratedLifeLinks(): LifeLinkRecord[] {
  const migrated = mapLegacyLifeLinksSnapshot(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
  const bindingByLifeLinkId = new Map(migrated.qrBindings.map((binding) => [binding.lifeLinkId, binding]));
  return migrated.lifeLinks.map((record) => {
    const binding = bindingByLifeLinkId.get(record.id);
    return {
      ...record,
      qrId: binding?.qrId ?? null,
      media: migrated.linkMedia
        .filter((media) => media.lifeLinkId === record.id)
        .map(({ data: _data, ...media }) => ({
          ...media,
          url: binding
            ? `/api/links/${encodeURIComponent(binding.qrId)}/media/${encodeURIComponent(media.id)}`
            : `/api/life-links/${encodeURIComponent(record.id)}/media/${encodeURIComponent(media.id)}`
        }))
    };
  });
}

describe("canonical recursive Life Link contract", () => {
  it("creates an untagged private root with coordinated body defaults", () => {
    const record = createCanonicalLifeLink({ id: "life-link-1", ownerId: "owner-alpha", createdAt: NOW });

    expect(record).toEqual({
      id: "life-link-1",
      ownerId: "owner-alpha",
      parentId: null,
      qrId: null,
      title: DEFAULT_LIFE_LINK_TITLE,
      body: "",
      bodyDoc: { type: "doc", content: [] },
      bodyDocVersion: 1,
      privacy: DEFAULT_LIFE_LINK_PRIVACY,
      media: [],
      createdAt: NOW,
      updatedAt: NOW
    });
  });

  it("reuses rich-body conversion and keeps the compatibility body coordinated", () => {
    const body = coordinateLifeLinkBody({
      body: "stale compatibility text",
      bodyDoc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Packed kit" }] },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Charge batteries" }] }]
              }
            ]
          }
        ]
      }
    });

    expect(body.body).toBe("Packed kit\n- [x] Charge batteries");
    expect(body.bodyDocVersion).toBe(1);
    expect(() => coordinateLifeLinkBody({ body: "invalid", bodyDocVersion: 0 })).toThrowError(
      expect.objectContaining({ code: "invalid_life_link", reason: "invalid_body_doc_version" })
    );
    expect(() => assertLifeLinkMediaBytes(4, 3)).toThrowError(
      expect.objectContaining({ code: "invalid_life_link", reason: "media_size_mismatch" })
    );
    expect(() => assertLifeLinkBodyPatchIsCoordinated({ bodyDocVersion: 1 })).toThrowError(
      expect.objectContaining({ code: "invalid_life_link", reason: "body_doc_version_without_content" })
    );
  });

  it("keeps Life Link identity independent from immutable QR identity", () => {
    expect(mapLegacyProjectToLifeLinkId("project-studio")).toBe("project-studio");
    expect(mapLegacyLinkToLifeLinkId("LL-MIG-00001")).toBe(`${LEGACY_LIFE_LINK_ID_PREFIX}LL-MIG-00001`);
    expect(mapLegacyLinkToLifeLinkId("LL-MIG-00001")).not.toBe("LL-MIG-00001");
  });

  it("rejects self-parent, longer cycles, missing parents, and cross-owner placement", () => {
    const records = [
      lifeLink("root"),
      lifeLink("branch", { parentId: "root" }),
      lifeLink("leaf", { parentId: "branch" }),
      lifeLink("other-root", { ownerId: "owner-beta" })
    ];

    expect(validateLifeLinkParentPlacement(records, "root", "root")).toEqual({
      ok: false,
      code: "invalid_parent",
      reason: "self_parent"
    });
    expect(validateLifeLinkParentPlacement(records, "root", "leaf")).toEqual({
      ok: false,
      code: "hierarchy_cycle",
      reason: "cycle"
    });
    expect(validateLifeLinkParentPlacement(records, "branch", "missing")).toEqual({
      ok: false,
      code: "invalid_parent",
      reason: "parent_not_found"
    });
    expect(validateLifeLinkParentPlacement(records, "branch", "other-root")).toEqual({
      ok: false,
      code: "invalid_parent",
      reason: "cross_owner"
    });
    expect(validateLifeLinkParentPlacement(records, "leaf", null)).toEqual({ ok: true });
  });

  it("allows duplicate titles and orders siblings by title, creation time, then identity", () => {
    const records = [
      lifeLink("root"),
      lifeLink("duplicate-b", { parentId: "root", title: "Battery Kit", createdAt: "2026-08-25T12:02:00.000Z" }),
      lifeLink("duplicate-a", { parentId: "root", title: "Battery Kit", createdAt: "2026-08-25T12:01:00.000Z" }),
      lifeLink("duplicate-c", { parentId: "root", title: "Battery Kit", createdAt: "2026-08-25T12:01:00.000Z" })
    ];

    expect(listLifeLinkChildren(records, "owner-alpha", "root").items.map((item) => item.id)).toEqual([
      "duplicate-a",
      "duplicate-c",
      "duplicate-b"
    ]);
    expect(validateLifeLinkParentPlacement(records, "duplicate-b", "root")).toEqual({ ok: true });
  });

  it("continues child and search pages without duplicates and rejects foreign cursors", () => {
    const records = [
      lifeLink("root"),
      ...Array.from({ length: 5 }, (_, index) =>
        lifeLink(`child-${index}`, { parentId: "root", title: "Duplicate", createdAt: NOW })
      )
    ];
    const firstChildren = pageLifeLinkChildren(records, "owner-alpha", "root", { limit: 2 });
    const secondChildren = pageLifeLinkChildren(records, "owner-alpha", "root", {
      limit: 2,
      cursor: firstChildren.nextCursor
    });
    expect(firstChildren.items.map((item) => item.id)).toEqual(["child-0", "child-1"]);
    expect(secondChildren.items.map((item) => item.id)).toEqual(["child-2", "child-3"]);

    const firstSearch = searchCanonicalLifeLinks(records, "owner-alpha", "duplicate", { limit: 2 });
    const secondSearch = searchCanonicalLifeLinks(records, "owner-alpha", "duplicate", {
      limit: 2,
      cursor: firstSearch.nextCursor
    });
    expect(new Set([...firstSearch.items, ...secondSearch.items].map((item) => item.lifeLink.id)).size).toBe(4);
    expect(() =>
      searchCanonicalLifeLinks(records, "owner-alpha", "duplicate", { cursor: firstChildren.nextCursor })
    ).toThrowError(expect.objectContaining({ code: "invalid_life_link", reason: "invalid_cursor" }));
  });

  it("derives an iterative bounded path without storing or limiting product depth", () => {
    const records: LifeLinkRecord[] = [];
    for (let index = 0; index < 500; index += 1) {
      records.push(
        lifeLink(`node-${index.toString().padStart(3, "0")}`, {
          parentId: index === 0 ? null : `node-${(index - 1).toString().padStart(3, "0")}`,
          qrId:
            index === 0
              ? "LL-ROOT"
              : index === 498
                ? "LL-NEAREST-CONTAINER"
                : index === 499
                  ? "LL-SUBJECT"
                  : null
        })
      );
    }

    const path = deriveLifeLinkPath(records, "node-499");

    expect(path.items).toHaveLength(MAX_LIFE_LINK_PATH_ITEMS);
    expect(path.items[0].id).toBe("node-000");
    expect(path.items.at(-1)?.id).toBe("node-499");
    expect(path).toMatchObject({ truncated: true, omittedCount: 500 - MAX_LIFE_LINK_PATH_ITEMS });
    expect(formatRecordedLifeLinkPath(path)).toContain("node-000 > ... >");
    expect(deriveLifeLinkPhysicalLocator(path)).toEqual({
      lifeLinkId: "node-498",
      title: "node-498",
      qrId: "LL-NEAREST-CONTAINER",
      relation: "ancestor"
    });
    expect(deriveLifeLinkPhysicalLocator(deriveLifeLinkPath(records, "node-499", 2))).toBeNull();
    expect(records.every((record) => !("path" in record) && !("depth" in record))).toBe(true);
  });

  it("derives ancestor-first, self-fallback, and absent physical locators without parallel state", () => {
    const container = lifeLink("container", { qrId: "LL-CONTAINER", title: "Basement Gear Tub" });
    const nestedTaggedItem = lifeLink("tagged-item", {
      parentId: container.id,
      qrId: "LL-TAGGED-ITEM",
      title: "Camp Stove"
    });
    const untaggedRoot = lifeLink("untagged-root", { qrId: null });
    const selfTagged = lifeLink("self-tagged", {
      parentId: untaggedRoot.id,
      qrId: "LL-SELF",
      title: "Camera Bag"
    });
    const untaggedChild = lifeLink("untagged-child", { parentId: untaggedRoot.id, qrId: null });
    const records = [container, nestedTaggedItem, untaggedRoot, selfTagged, untaggedChild];

    expect(deriveLifeLinkPhysicalLocator(deriveLifeLinkPath(records, nestedTaggedItem.id))).toEqual({
      lifeLinkId: container.id,
      title: container.title,
      qrId: container.qrId,
      relation: "ancestor"
    });
    expect(deriveLifeLinkPhysicalLocator(deriveLifeLinkPath(records, selfTagged.id))).toEqual({
      lifeLinkId: selfTagged.id,
      title: selfTagged.title,
      qrId: selfTagged.qrId,
      relation: "self"
    });
    expect(deriveLifeLinkPhysicalLocator(deriveLifeLinkPath(records, untaggedChild.id))).toBeNull();
  });

  it("searches exact QR, title, ancestor path, and body with deterministic bounded output", () => {
    const records = [
      lifeLink("studio", { title: "Studio" }),
      lifeLink("camera-bag", {
        parentId: "studio",
        qrId: "LL-SEARCH-00001",
        title: "Field Camera Bag",
        body: "Tripod plate and rain cover"
      }),
      lifeLink("battery-kit", {
        parentId: "camera-bag",
        qrId: "LL-SEARCH-00002",
        title: "Battery Kit",
        body: "Two charged batteries"
      }),
      lifeLink("other-owner-result", {
        ownerId: "owner-beta",
        qrId: "LL-SEARCH-00003",
        title: "Battery Kit",
        body: "Must remain invisible"
      })
    ];

    expect(searchCanonicalLifeLinks(records, "owner-alpha", "LL-SEARCH-00002").items[0].matchClass).toBe("exact_qr");
    expect(searchCanonicalLifeLinks(records, "owner-alpha", "Battery Kit").items[0].matchClass).toBe("exact_title");
    const pathResult = searchCanonicalLifeLinks(records, "owner-alpha", "Studio");
    expect(pathResult.items.map((item) => item.lifeLink.id)).toEqual(["studio", "battery-kit", "camera-bag"]);
    expect(pathResult.items[1].matchClass).toBe("recorded_path");
    expect(searchCanonicalLifeLinks(records, "owner-alpha", "charged").items[0].matchClass).toBe("body");
    expect(searchCanonicalLifeLinks(records, "owner-alpha", "invisible").items).toHaveLength(0);

    const many = Array.from({ length: 20 }, (_, index) =>
      lifeLink(`result-${index.toString().padStart(2, "0")}`, { title: `Result ${index}` })
    );
    const bounded = searchCanonicalLifeLinks(many, "owner-alpha", "result", {
      limit: 99,
      maxLimit: MAX_LIFE_LINK_TOOL_SEARCH_RESULTS
    });
    expect(bounded.items).toHaveLength(MAX_LIFE_LINK_TOOL_SEARCH_RESULTS);
    expect(bounded).toMatchObject({ totalCount: 20, truncated: true, hasMore: true });
  });

  it("owns shared defaults and caps for pages, summaries, sources, and tool output", () => {
    expect(normalizeLifeLinkChildPageLimit(undefined)).toBe(DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT);
    expect(normalizeLifeLinkChildPageLimit(1000)).toBe(MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    expect(normalizeLifeLinkChildPageLimit(0)).toBe(1);
    expect(normalizeLifeLinkSearchLimit(undefined)).toBe(DEFAULT_LIFE_LINK_SEARCH_LIMIT);
    expect(normalizeLifeLinkSearchLimit(1000)).toBe(MAX_LIFE_LINK_SEARCH_LIMIT);
    expect(normalizeLifeLinkSearchLimit(1000, MAX_LIFE_LINK_TOOL_SEARCH_RESULTS)).toBe(
      MAX_LIFE_LINK_TOOL_SEARCH_RESULTS
    );

    const summary = summarizeLifeLinkBody("word \n".repeat(100));
    expect(summary.length).toBeLessThanOrEqual(MAX_LIFE_LINK_BODY_SUMMARY_LENGTH);
    expect(summary.endsWith("...")).toBe(true);

    const sources = boundLifeLinkSourceReferences([
      ...Array.from({ length: MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT + 3 }, (_, index) => `source-${index}`),
      "source-0"
    ]);
    expect(sources.items).toHaveLength(MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT);
    expect(sources).toMatchObject({ truncated: true, omittedCount: 3 });

    expect(() => assertLifeLinkToolOutputWithinBounds({ ok: true })).not.toThrow();
    expect(() => assertLifeLinkToolOutputWithinBounds({ text: "x".repeat(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES) })).toThrowError(
      expect.objectContaining({ code: "output_limit_exceeded" })
    );
  });

  it("maps the reviewed legacy fixture deterministically without inferred structure", () => {
    const migrated = mapLegacyLifeLinksSnapshot(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);

    expect(migrated).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT);
    expect(mapLegacyLifeLinksSnapshot(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT)).toEqual(migrated);
    expect(migrated.lifeLinks).toHaveLength(
      REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT.projects.length +
        REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT.links.length
    );
    expect(migrated.qrBindings).toHaveLength(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT.links.length);
    expect(migrated.qrBindings.some((binding) => binding.qrId === "LL-MIG-00005")).toBe(false);
    expect(migrated.lifeLinks.find((item) => item.id === mapLegacyLinkToLifeLinkId("LL-MIG-00001"))?.parentId).toBe(
      "project-studio"
    );
    expect(
      migrated.lifeLinks.find((item) => item.id === mapLegacyLinkToLifeLinkId("LL-MIG-00003"))?.parentId
    ).toBeNull();
    expect(new Set(migrated.lifeLinks.filter((item) => item.title === "Battery Kit").map((item) => item.id)).size).toBe(4);
  });

  it("derives legacy Project, Link, and QR DTOs from canonical records", () => {
    const migrated = mapLegacyLifeLinksSnapshot(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
    const hydrated = hydrateMigratedLifeLinks();
    const projectRoot = hydrated.find((item) => item.id === "project-studio")!;
    const marker = migrated.projectCompatibility.find((item) => item.projectId === "project-studio")!;
    const tagged = hydrated.find((item) => item.qrId === "LL-MIG-00001")!;
    const qr = migrated.qrInventory.find((item) => item.id === tagged.qrId)!;
    const binding = migrated.qrBindings.find((item) => item.qrId === qr.id)!;

    expect(projectLifeLinkAsProject(projectRoot, marker)).toEqual({
      id: "project-studio",
      ownerId: "owner-alpha",
      name: "Studio",
      createdAt: "2026-08-20T10:05:00.000Z"
    });
    expect(deriveProjectCompatibilityId(hydrated, migrated.projectCompatibility, tagged.id)).toBe(
      "project-studio"
    );
    const ownerProjection = projectLifeLinkAsLink(tagged, qr, "project-studio");
    expect(ownerProjection).toMatchObject({
      id: "LL-MIG-00001",
      status: "claimed",
      ownerId: "owner-alpha",
      projectId: "project-studio",
      media: [{ qrId: "LL-MIG-00001" }]
    });
    expect(redactNonOwnerLinkProjection(ownerProjection)).toMatchObject({
      ownerId: null,
      projectId: null,
      media: [{ ownerId: null }]
    });
    expect(projectQrInventoryRecord(qr, binding)).toMatchObject({ status: "claimed", claimedAt: binding.boundAt });

    const unclaimedQr = migrated.qrInventory.find((item) => item.id === "LL-MIG-00005")!;
    expect(projectUnclaimedQrAsLink(unclaimedQr)).toMatchObject({
      id: "LL-MIG-00005",
      status: "unclaimed",
      ownerId: null,
      projectId: null,
      privacy: "public"
    });
    expect(projectPrivateClaimedQrAsLink(unclaimedQr)).toMatchObject({
      id: "LL-MIG-00005",
      status: "claimed",
      ownerId: null,
      projectId: null,
      title: "",
      body: "",
      privacy: "private",
      media: []
    });
  });

  it("rejects a legacy owner mismatch instead of inferring a different parent", () => {
    const badFixture = structuredClone(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
    badFixture.links[0].ownerId = "owner-beta";

    expect(() => mapLegacyLifeLinksSnapshot(badFixture)).toThrowError(
      expect.objectContaining<Partial<LifeLinkDomainError>>({ code: "invalid_parent", reason: "cross_owner" })
    );
  });

  it("rejects malformed legacy QR, media, and deterministic identity state", () => {
    const mismatchedQr = structuredClone(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
    mismatchedQr.qrCodes[0].status = "unclaimed";
    expect(() => mapLegacyLifeLinksSnapshot(mismatchedQr)).toThrowError(
      expect.objectContaining({ code: "invalid_life_link", reason: "qr_status_mismatch" })
    );

    const mismatchedMedia = structuredClone(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
    mismatchedMedia.linkMedia[0].ownerId = "owner-beta";
    expect(() => mapLegacyLifeLinksSnapshot(mismatchedMedia)).toThrowError(
      expect.objectContaining({ code: "invalid_life_link", reason: "media_owner_mismatch" })
    );

    const collision = structuredClone(REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT);
    collision.projects.push({
      id: mapLegacyLinkToLifeLinkId("LL-MIG-00001"),
      ownerId: "owner-alpha",
      name: "Collision",
      createdAt: NOW
    });
    expect(() => mapLegacyLifeLinksSnapshot(collision)).toThrowError(
      expect.objectContaining({ code: "duplicate_life_link_id" })
    );
  });
});
