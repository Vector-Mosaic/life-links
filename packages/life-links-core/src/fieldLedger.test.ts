import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  applyLifeLinkPatch,
  createCanonicalCollection,
  createCanonicalCollectionSection,
  createCanonicalLifeLink,
  lifeLinkCreatePayloadMatches,
  migrateLifeLinksToFieldLedger,
  normalizeCollectionId,
  normalizeCollectionPatch,
  normalizeCollectionSectionIds,
  normalizeLifeLinkContext,
  normalizePublicFieldKeys,
  normalizeSetLifeLinkQrBindingCommand,
  normalizeClearLifeLinkQrBindingCommand,
  pageCollectionMembers,
  pageCollectionRecords,
  pageCollectionSections,
  pageCollections,
  pageLifeLinkCollectionMemberships,
  projectLifeLinkAsLink,
  projectPublicLifeLinkAsLink,
  searchCanonicalLifeLinks,
  type CollectionMembershipRecord,
  type CollectionSectionAssignmentRecord,
  type UpdateLifeLinkPatch
} from "./index.js";

const NOW = "2026-08-29T12:00:00.000Z";
const LATER = "2026-08-29T12:01:00.000Z";
const ownerId = "owner-alpha";
const collectionId = (number: number) => `collection-00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const sectionId = (number: number) => `section-00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const collection = (number: number, title = "Camping Gear", owner = ownerId) => createCanonicalCollection({
  id: collectionId(number), ownerId: owner, title, createdAt: NOW
});
const section = (number: number, collectionNumber = 1, position = 0) => createCanonicalCollectionSection({
  id: sectionId(number), collectionId: collectionId(collectionNumber), ownerId,
  title: `Section ${number}`, position, createdAt: NOW
});

describe("Field Ledger additive canonical contract", () => {
  it("creates explicit empty folders and records only newly asserted child placement", () => {
    const root = createCanonicalLifeLink({ id: "root", ownerId, createdAt: NOW, browsingRole: "container" });
    const child = createCanonicalLifeLink({ id: "child", ownerId, createdAt: NOW, parentId: root.id });
    expect(root).toMatchObject({ browsingRole: "container", placementConfirmedAt: null, publicFieldKeys: [], context: { schemaVersion: 1 } });
    expect(child).toMatchObject({ browsingRole: "item", placementConfirmedAt: NOW, parentId: "root" });
  });

  it("normalizes structured values without confusing reported, inferred, and planned state", () => {
    expect(normalizeLifeLinkContext({ schemaVersion: 1,
      condition: { text: "  Holds air.\r\nDry.  ", truthState: "owner_reported" },
      plan: { text: "Replace next year", truthState: "planned" }
    })).toEqual({ schemaVersion: 1, condition: { text: "Holds air.\nDry.", truthState: "owner_reported" }, plan: { text: "Replace next year", truthState: "planned" } });
  });

  it.each([
    null, [], { schemaVersion: 2 }, { schemaVersion: 1, title: "not admitted" },
    { schemaVersion: 1, plan: { text: " ", truthState: "planned" } },
    { schemaVersion: 1, condition: { text: "Fine", truthState: "verified" } },
    { schemaVersion: 1, condition: { text: "Fine", truthState: { toString: () => "owner_reported" } } },
    { schemaVersion: 1, condition: { text: "Fine", truthState: "owner_reported", confidence: 1 } },
    { schemaVersion: 1, summary: { text: "x".repeat(MAX_BODY_LENGTH), truthState: "unknown" }, plan: { text: "x", truthState: "planned" } }
  ])("rejects malformed or over-budget structured context %#", (value) => {
    expect(() => normalizeLifeLinkContext(value)).toThrow(expect.objectContaining({ code: "invalid_life_link" }));
  });

  it("preserves omitted fields and placement while patching canonical Notes/context", () => {
    const old = createCanonicalLifeLink({ id: "tent", ownerId, parentId: "tub", createdAt: NOW,
      title: "Tent", body: "Original notes", browsingRole: "container", publicFieldKeys: ["notes"],
      context: { schemaVersion: 1, condition: { text: "Dry", truthState: "owner_reported" } }
    });
    const updated = applyLifeLinkPatch(old, { title: "Family tent", body: "Updated notes" }, LATER);
    expect(updated).toMatchObject({ id: old.id, parentId: old.parentId, browsingRole: "container", placementConfirmedAt: NOW,
      context: old.context, publicFieldKeys: ["notes"], body: "Updated notes", updatedAt: LATER });
    expect(updated.bodyDoc).not.toEqual(old.bodyDoc);
    expect(old.body).toBe("Original notes");
  });

  it.each(["browsingRole", "placementConfirmedAt", "parentId", "ownerId", "qrId", "media"])("rejects runtime patch of %s", (key) => {
    const old = createCanonicalLifeLink({ id: "tent", ownerId, createdAt: NOW });
    expect(() => applyLifeLinkPatch(old, { [key]: "invalid" } as UpdateLifeLinkPatch, LATER))
      .toThrow(expect.objectContaining({ code: "invalid_life_link", reason: "invalid_patch" }));
  });

  it("keeps the public allowlist canonical and private unless deliberately selected", () => {
    expect(normalizePublicFieldKeys(["plan", "notes", "plan", "condition"])).toEqual(["notes", "condition", "plan"]);
    for (const value of [null, "notes", ["media"], ["path"], ["collections"]]) {
      expect(() => normalizePublicFieldKeys(value)).toThrow(expect.objectContaining({ reason: "invalid_public_fields" }));
    }
  });

  it("recognizes normalized exact create payloads without treating a later edit as a replay", () => {
    const command = { id: "pad", ownerId, createdAt: NOW, title: "Pad", parentId: "tub", body: "Notes" };
    const existing = createCanonicalLifeLink(command);
    expect(lifeLinkCreatePayloadMatches(existing, { ...command, createdAt: LATER })).toBe(true);
    expect(lifeLinkCreatePayloadMatches({ ...existing, updatedAt: LATER, qrId: "LL-PAD" }, command)).toBe(true);
    expect(lifeLinkCreatePayloadMatches({ ...existing, title: "Edited pad" }, command)).toBe(false);
    expect(lifeLinkCreatePayloadMatches(existing, { ...command, ownerId: "other-owner" })).toBe(false);
  });

  it("recognizes exact empty-Notes create replay after PostgreSQL body-document hydration", () => {
    const command = { id: "empty-folder", ownerId, createdAt: NOW, browsingRole: "container" as const };
    const created = createCanonicalLifeLink(command);
    expect(created.bodyDoc).toEqual({ type: "doc", content: [] });
    const hydrated = { ...created, bodyDoc: { type: "doc" as const } };
    expect(lifeLinkCreatePayloadMatches(hydrated, command)).toBe(true);
    expect(lifeLinkCreatePayloadMatches(hydrated, { ...command, body: "New notes" })).toBe(false);
  });

  it("adds migration defaults without losing legacy fields or inventing placement confirmation", () => {
    const old = [
      { id: "tub", parentId: null, privacy: "private" as const, body: "Keep private notes" },
      { id: "pad", parentId: "tub", privacy: "public" as const, body: "Keep public notes" }
    ];
    const migrated = migrateLifeLinksToFieldLedger(old);
    expect(migrated).toEqual([
      { ...old[0], browsingRole: "container", context: { schemaVersion: 1 }, placementConfirmedAt: null, publicFieldKeys: [] },
      { ...old[1], browsingRole: "item", context: { schemaVersion: 1 }, placementConfirmedAt: null, publicFieldKeys: ["notes"] }
    ]);
    expect(old[0]).not.toHaveProperty("browsingRole");
  });

  it("preserves owner compatibility content while projecting only selected public context", () => {
    const subject = createCanonicalLifeLink({ id: "pad", ownerId, createdAt: NOW, body: "Existing public notes", privacy: "public" });
    subject.qrId = "LL-PAD";
    subject.context = { schemaVersion: 1, condition: { text: "Dry", truthState: "owner_reported" }, plan: { text: "Upgrade", truthState: "planned" } };
    subject.publicFieldKeys = ["plan"];
    const qr = { id: "LL-PAD", url: "https://example.test/qr/LL-PAD", batchId: null, createdAt: NOW };
    const projected = projectLifeLinkAsLink(subject, qr);
    expect(projected.body).toBe("Existing public notes");
    expect(projected.context).toEqual(subject.context);
    expect(projected).not.toHaveProperty("publicFieldKeys");
    const publicLink = projectPublicLifeLinkAsLink(subject, qr);
    expect(publicLink).toMatchObject({ ownerId: null, body: "", media: [],
      context: { schemaVersion: 1, plan: { text: "Upgrade", truthState: "planned" } } });
    expect(publicLink.context).not.toHaveProperty("condition");
    expect(publicLink.bodyDoc).toEqual({ type: "doc", content: [] });
    expect(publicLink).not.toHaveProperty("parentId");
    publicLink.context!.plan!.text = "Changed preview";
    expect(subject.context.plan?.text).toBe("Upgrade");
    expect(projectPublicLifeLinkAsLink({ ...subject, publicFieldKeys: ["notes"] }, qr).body).toBe(subject.body);
    expect(projectPublicLifeLinkAsLink({ ...subject, privacy: "private" }, qr).title).toBe("");
  });

  it("searches structured context through the same canonical search with a bounded match reason", () => {
    const subject = createCanonicalLifeLink({ id: "pad", ownerId, title: "Pad", createdAt: NOW, body: "Other notes",
      context: { schemaVersion: 1, plan: { text: "Higher insulation next season", truthState: "planned" } } });
    const result = searchCanonicalLifeLinks([subject], ownerId, "insulation");
    expect(result.items[0]).toMatchObject({ lifeLink: { id: "pad" }, matchClass: "context", bodySummary: "Higher insulation next season" });
    expect(searchCanonicalLifeLinks([subject], "different-owner", "insulation").items).toEqual([]);
  });

  it("validates new QR command identity and target before the retry owner receives it", () => {
    expect(normalizeSetLifeLinkQrBindingCommand({ commandId: " bind-1 ", lifeLinkId: " pad ", qrId: " LL-PAD ", expectedUpdatedAt: NOW }))
      .toEqual({ commandId: "bind-1", lifeLinkId: "pad", qrId: "LL-PAD", expectedUpdatedAt: NOW });
    expect(normalizeClearLifeLinkQrBindingCommand({ commandId: "clear-1", lifeLinkId: "pad", expectedUpdatedAt: NOW }))
      .toEqual({ commandId: "clear-1", lifeLinkId: "pad", expectedUpdatedAt: NOW });
    for (const patch of [{ commandId: " " }, { commandId: "x".repeat(129) }, { lifeLinkId: null }, { expectedUpdatedAt: "yesterday" }, { qrId: "not a QR" }, { ownerId: "other-owner" }]) {
      expect(() => normalizeSetLifeLinkQrBindingCommand({ commandId: "bind", lifeLinkId: "pad", qrId: "LL-PAD", expectedUpdatedAt: NOW, ...patch })).toThrow();
    }
    expect(() => normalizeClearLifeLinkQrBindingCommand({ commandId: "clear", lifeLinkId: "pad", expectedUpdatedAt: NOW, qrId: "LL-PAD" })).toThrow();
  });
});

describe("Collection and Section normalization/projections", () => {
  it("uses stable prefixed UUID identity and bounded normalized metadata", () => {
    const result = createCanonicalCollection({ id: ` ${collectionId(1).toUpperCase()} `, ownerId, title: " Camping Gear ", purpose: " Trip\r\nplanning ", notes: " Notes ", createdAt: NOW });
    expect(result).toMatchObject({ id: collectionId(1), title: "Camping Gear", purpose: "Trip\nplanning", notes: "Notes" });
    expect(() => normalizeCollectionId("random-id")).toThrow(expect.objectContaining({ reason: "invalid_id" }));
    expect(() => createCanonicalCollection({ id: collectionId(1), ownerId, title: "Nested", createdAt: NOW, parentId: collectionId(2) } as never))
      .toThrow(expect.objectContaining({ reason: "invalid_create" }));
    expect(() => normalizeCollectionPatch({ parentId: collectionId(2) })).toThrow(expect.objectContaining({ reason: "invalid_patch" }));
    expect(() => normalizeCollectionPatch({ title: " " })).toThrow();
    expect(() => normalizeCollectionPatch({ purpose: "x".repeat(501) })).toThrow();
    expect(() => normalizeCollectionPatch({ notes: "x".repeat(4001) })).toThrow();
    expect(() => normalizeCollectionPatch({ title: "x".repeat(121) })).toThrow();
    expect(normalizeCollectionPatch({ notes: "" })).toEqual({ notes: "" });
  });

  it("keeps Sections flat and nonexclusive with canonical complete assignment sets", () => {
    expect(normalizeCollectionSectionIds([sectionId(2), sectionId(1), sectionId(2)])).toEqual([sectionId(1), sectionId(2)]);
    expect(normalizeCollectionSectionIds([])).toEqual([]);
    expect(() => normalizeCollectionSectionIds([collectionId(1)])).toThrow(expect.objectContaining({ code: "invalid_section" }));
    expect(() => createCanonicalCollectionSection({ ...section(1), position: -1 })).toThrow();
    expect(() => createCanonicalCollectionSection({ ...section(1), position: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(section(1)).not.toHaveProperty("parentId");
  });

  it("pages owner-only Collections deterministically through duplicate titles", () => {
    const records = [collection(3, "Zebra"), collection(2, "camping gear"), collection(1), collection(4, "A", "other-owner")];
    const first = pageCollections(records, ownerId, { limit: 1 });
    const second = pageCollections(records, ownerId, { limit: 1, cursor: first.nextCursor });
    const third = pageCollections(records, ownerId, { limit: 1, cursor: second.nextCursor });
    expect([first.items[0].id, second.items[0].id, third.items[0].id]).toEqual([collectionId(1), collectionId(2), collectionId(3)]);
    expect(first.truncated).toBe(true);
    expect(third).toMatchObject({ truncated: false, nextCursor: null });
    expect(() => pageCollections(records, "other-owner", { cursor: first.nextCursor })).toThrow(expect.objectContaining({ reason: "invalid_cursor" }));
    expect(() => pageCollectionRecords(records, { cursor: "bad%cursor" })).toThrow(expect.objectContaining({ reason: "invalid_cursor" }));
    expect(() => pageCollections(records.filter((item) => item.id !== collectionId(1)), ownerId, { cursor: first.nextCursor })).toThrow(expect.objectContaining({ reason: "invalid_cursor" }));
  });

  it("lists exact direct members only, without descendant inference or private-owner leakage", () => {
    const parent = createCanonicalLifeLink({ id: "tub", ownerId, createdAt: NOW });
    const child = createCanonicalLifeLink({ id: "pad", parentId: parent.id, ownerId, createdAt: NOW });
    const other = createCanonicalLifeLink({ id: "other", ownerId: "other-owner", createdAt: NOW });
    const memberships: CollectionMembershipRecord[] = [
      { ownerId, collectionId: collectionId(1), lifeLinkId: parent.id, createdAt: NOW },
      { ownerId: "other-owner", collectionId: collectionId(1), lifeLinkId: other.id, createdAt: NOW }
    ];
    expect(pageCollectionMembers([parent, child, other], memberships, ownerId, collectionId(1)).items.map((item) => item.id)).toEqual([parent.id]);
  });

  it("derives exhaustive memberships with all nonexclusive Sections and owner/collection isolation", () => {
    const collections = [collection(1), collection(2, "Cycling"), collection(3, "Wrong owner", "other-owner")];
    const memberships: CollectionMembershipRecord[] = collections.map((item) => ({ ownerId: item.ownerId, collectionId: item.id, lifeLinkId: "pad", createdAt: NOW }));
    const sections = [section(1, 1, 2), section(2, 1, 1), section(3, 2, 0)];
    const assignments: CollectionSectionAssignmentRecord[] = sections.map((item) => ({ ownerId, collectionId: item.collectionId, lifeLinkId: "pad", sectionId: item.id, createdAt: NOW }));
    assignments.push({ ownerId, collectionId: collectionId(1), lifeLinkId: "pad", sectionId: sectionId(3), createdAt: NOW });
    const first = pageLifeLinkCollectionMemberships(collections, memberships, sections, assignments, ownerId, "pad", { limit: 1 });
    expect(first.items[0].sections.map((item) => item.id)).toEqual([sectionId(2), sectionId(1)]);
    const second = pageLifeLinkCollectionMemberships(collections, memberships, sections, assignments, ownerId, "pad", { limit: 1, cursor: first.nextCursor });
    expect(second.items[0].collection.id).toBe(collectionId(2));
    expect(second.items[0].sections.map((item) => item.id)).toEqual([sectionId(3)]);
    expect(second.truncated).toBe(false);
    expect(pageCollectionSections(sections, ownerId, collectionId(1)).items.map((item) => item.id)).toEqual([sectionId(2), sectionId(1)]);
  });
});
