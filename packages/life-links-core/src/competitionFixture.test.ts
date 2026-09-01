import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  COMPETITION_BASEMENT_GEAR_STORAGE_ID,
  COMPETITION_BATCH_ID,
  COMPETITION_CAMPING_KIT_ID,
  COMPETITION_CAMPING_COLLECTION_ID,
  COMPETITION_SECTION_IDS,
  COMPETITION_UPGRADE_TARGET_LIFE_LINK_ID,
  COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
  COMPETITION_CYCLING_REPAIRS_TUB_ID,
  COMPETITION_CYCLING_REPAIRS_TUB_QR_ID,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_PREFERENCES_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_FIND_DECOY_LIFE_LINK_ID,
  COMPETITION_FIND_TARGET_LIFE_LINK_ID,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_FIXTURE_TIMESTAMP,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
  COMPETITION_HIKING_WEATHER_TUB_ID,
  COMPETITION_HIKING_WEATHER_TUB_QR_ID,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_KITCHEN_WATER_TUB_ID,
  COMPETITION_KITCHEN_WATER_TUB_QR_ID,
  COMPETITION_LIFE_LINK_COUNT,
  COMPETITION_LIFE_LINK_IDS,
  COMPETITION_NEXT_TRIP_PACKING_PLAN_ID,
  COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
  COMPETITION_OWNER_DISPLAY_NAME,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_OWNER_ID,
  COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID,
  COMPETITION_QR_COUNT,
  COMPETITION_QR_IDS,
  COMPETITION_SAFETY_LIGHTING_TUB_ID,
  COMPETITION_SAFETY_LIGHTING_TUB_QR_ID,
  COMPETITION_SHELTER_TUB_ID,
  COMPETITION_SHELTER_TUB_QR_ID,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_BAG_QR_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_SLEEPING_PAD_QR_ID,
  COMPETITION_SLEEP_SYSTEM_ID,
  COMPETITION_START_LIFE_LINK_ID,
  COMPETITION_TARGET_QR_ID,
  createCompetitionFixtureData,
  extractPlainTextFromLinkBodyDoc
} from "./index";

describe("WebMCP competition fixture", () => {
  it("constructs one exact deterministic family-adventure sandbox", () => {
    const first = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test/");
    const second = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");

    expect(first).toEqual(second);
    // Freeze the reviewed identities, physical edges, copy, truth states, privacy
    // allowlists and all 52 assignment edges; the semantic assertions below
    // explain the causal meaning rather than treating counts as the oracle.
    expect(createHash("sha256").update(JSON.stringify(first)).digest("hex")).toBe(
      "110f6c4326d2e609477acf109ed7d097a5f32b8893839a76b7977f4ab01f17d0"
    );
    expect(first).toMatchObject({
      profile: "webmcp-field-ledger-family-v3",
      owner: {
        id: COMPETITION_OWNER_ID,
        email: COMPETITION_OWNER_EMAIL,
        displayName: COMPETITION_OWNER_DISPLAY_NAME,
        createdAt: COMPETITION_FIXTURE_TIMESTAMP
      },
      batch: {
        id: COMPETITION_BATCH_ID,
        createdBy: COMPETITION_OWNER_ID,
        count: 8,
        createdAt: COMPETITION_FIXTURE_TIMESTAMP
      }
    });
    expect(first.profile).toBe(COMPETITION_FIXTURE_PROFILE);
    expect(first.owner).not.toHaveProperty("password");
    expect(COMPETITION_LIFE_LINK_COUNT).toBe(60);
    expect(COMPETITION_QR_COUNT).toBe(8);
    expect(first.lifeLinks.map((item) => item.id)).toEqual(Object.values(COMPETITION_LIFE_LINK_IDS));
    expect(new Set(first.lifeLinks.map((item) => item.id)).size).toBe(60);
    expect(first.qrInventory.map((item) => item.id)).toEqual([...COMPETITION_QR_IDS]);
    expect(first.qrBindings).toHaveLength(8);
    expect(first).not.toHaveProperty("projectCompatibility");
    expect(first.collections).toHaveLength(1);
    expect(first.collectionSections).toHaveLength(5);
    expect(first.collectionMemberships).toHaveLength(48);
    expect(first.collectionSectionAssignments).toHaveLength(52);
    expect(first.qrInventory.map((item) => item.url)).toEqual(
      COMPETITION_QR_IDS.map((qrId) => `https://challenge.life-links.test/qr/${qrId}`)
    );
    expect(first.lifeLinks.every((item) => item.createdAt === COMPETITION_FIXTURE_TIMESTAMP)).toBe(true);
    expect(first.lifeLinks.every((item) => item.updatedAt === COMPETITION_FIXTURE_TIMESTAMP)).toBe(true);

    const seen = new Set<string>();
    for (const lifeLink of first.lifeLinks) {
      if (lifeLink.parentId) {
        expect(seen.has(lifeLink.parentId), `${lifeLink.id} must follow its parent`).toBe(true);
      }
      seen.add(lifeLink.id);
    }
  });

  it("encodes physical places, six tubs and concrete gear without purpose parents", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));

    expect(COMPETITION_FAMILY_ADVENTURE_GEAR_ID).toBe(COMPETITION_CAMPING_KIT_ID);
    expect(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID).toBe(COMPETITION_SLEEP_SYSTEM_ID);
    expect(pathTitles(byId, COMPETITION_START_LIFE_LINK_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Storage wall",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
    ]);
    expect(pathTitles(byId, COMPETITION_SLEEPING_BAG_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Storage wall",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep Bag",
      "Camping Sleeping Bag"
    ]);
    expect(pathTitles(byId, COMPETITION_SLEEPING_PAD_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Storage wall",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep Bag",
      "Camping Sleeping Pad"
    ]);
    expect(pathTitles(byId, COMPETITION_FOUR_DAY_FAMILY_TRIP_ID)).toEqual([
      "Mudroom", "Shoe bench"
    ]);
    expect(byId.get(COMPETITION_FAMILY_ADVENTURE_GEAR_ID)).toMatchObject({
      parentId: null,
      privacy: "private",
      qrId: null,
      browsingRole: "container", title: "Basement"
    });
    expect(directChildren(fixture.lifeLinks, COMPETITION_BASEMENT_GEAR_STORAGE_ID)).toEqual([
      COMPETITION_SHELTER_TUB_ID,
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
      COMPETITION_KITCHEN_WATER_TUB_ID,
      COMPETITION_SAFETY_LIGHTING_TUB_ID,
      COMPETITION_HIKING_WEATHER_TUB_ID,
      COMPETITION_CYCLING_REPAIRS_TUB_ID
    ]);
    expect(descendantCount(fixture.lifeLinks, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID)).toBe(13);
    for (const tubId of [
      COMPETITION_SHELTER_TUB_ID,
      COMPETITION_KITCHEN_WATER_TUB_ID,
      COMPETITION_SAFETY_LIGHTING_TUB_ID,
      COMPETITION_HIKING_WEATHER_TUB_ID,
      COMPETITION_CYCLING_REPAIRS_TUB_ID
    ]) {
      expect(descendantCount(fixture.lifeLinks, tubId), tubId).toBe(7);
    }
    expect(fixture.lifeLinks.filter((item) => item.parentId === null).map((item) => item.title)).toEqual(["Basement", "Mudroom", "Garage"]);
    expect(byId.get(COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID)).toMatchObject({ parentId: null, title: "Garage" });
    expect(byId.get(COMPETITION_FOUR_DAY_FAMILY_TRIP_ID)).toMatchObject({ parentId: COMPETITION_FAMILY_PREFERENCES_ID, title: "Shoe bench", browsingRole: "container" });
    expect(byId.get(COMPETITION_NEXT_TRIP_PACKING_PLAN_ID)).toMatchObject({ parentId: COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID, title: "Bike rack", browsingRole: "container" });
    expect(byId.get(COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID)).toMatchObject({ parentId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID, title: "Sleeping Pad Repair Pouch", browsingRole: "item" });
    for (const item of fixture.lifeLinks) {
      if (item.parentId) expect(byId.get(item.parentId)?.browsingRole).toBe("container");
      expect(item.placementConfirmedAt).toBe(item.parentId ? COMPETITION_FIXTURE_TIMESTAMP : null);
      expect(item.title).not.toMatch(/Adventure Gear|Previous Trip|Next-year.*Plan|Family Preferences/);
    }
  });

  it("freezes direct membership and five flat overlapping Section assignments independently of hierarchy", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));
    expect(fixture.collections[0]).toMatchObject({
      id: COMPETITION_CAMPING_COLLECTION_ID, ownerId: COMPETITION_OWNER_ID, title: "Camping Gear",
      purpose: expect.stringMatching(/two adults.*two children.*four-day.*day hikes.*cycling/),
      notes: expect.stringMatching(/warmth matters more.*\$250.*Do not replace working gear/s)
    });
    expect(fixture.collectionSections.map((item) => [item.id, item.title, item.position])).toEqual([
      [COMPETITION_SECTION_IDS.familySleepSystems, "Family sleep systems", 0],
      [COMPETITION_SECTION_IDS.shelter, "Shelter", 1],
      [COMPETITION_SECTION_IDS.campKitchen, "Camp kitchen", 2],
      [COMPETITION_SECTION_IDS.cyclingKit, "Cycling kit", 3],
      [COMPETITION_SECTION_IDS.nextYearUpgrades, "Next-year upgrades", 4]
    ]);
    expect(fixture.collectionSections.every((item) => item.collectionId === COMPETITION_CAMPING_COLLECTION_ID && !("parentId" in item))).toBe(true);
    const tubIds = new Set([COMPETITION_SHELTER_TUB_ID, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID, COMPETITION_KITCHEN_WATER_TUB_ID,
      COMPETITION_SAFETY_LIGHTING_TUB_ID, COMPETITION_HIKING_WEATHER_TUB_ID, COMPETITION_CYCLING_REPAIRS_TUB_ID]);
    const physicalMembers = fixture.lifeLinks.filter((item) => {
      let parent = item.parentId ? byId.get(item.parentId) : undefined;
      while (parent) {
        if (tubIds.has(parent.id)) return true;
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return false;
    });
    const memberIds = fixture.collectionMemberships.map((item) => item.lifeLinkId);
    expect(new Set(memberIds).size).toBe(48);
    expect([...memberIds].sort()).toEqual(physicalMembers.map((item) => item.id).sort());
    expect(fixture.collectionMemberships.every((item) => item.collectionId === COMPETITION_CAMPING_COLLECTION_ID && item.ownerId === COMPETITION_OWNER_ID)).toBe(true);
    expect(fixture.collectionSectionAssignments.every((item) => memberIds.includes(item.lifeLinkId))).toBe(true);
    expect(fixture.collectionSections.map((section) => fixture.collectionSectionAssignments.filter((item) => item.sectionId === section.id).length)).toEqual([13, 14, 14, 7, 4]);
    expect(fixture.collectionSectionAssignments.filter((item) => item.sectionId === COMPETITION_SECTION_IDS.nextYearUpgrades).map((item) => item.lifeLinkId)).toEqual([
      "competition-sleeping-pad", "competition-child-bike-lights", "competition-adult-rain-shells", "competition-upgrade-plan"
    ]);
    expect(memberIds.filter((id) => fixture.collectionSectionAssignments.filter((item) => item.lifeLinkId === id).length > 1).sort()).toEqual([
      "competition-adult-rain-shells", "competition-child-bike-lights", "competition-sleeping-pad", "competition-upgrade-plan"
    ]);
  });

  it("keeps warm-bag/cold-pad evidence and the $250 replacement decision as planned member context", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const bag = fixture.lifeLinks.find((item) => item.id === COMPETITION_SLEEPING_BAG_ID)!;
    const pad = fixture.lifeLinks.find((item) => item.id === COMPETITION_UPGRADE_TARGET_LIFE_LINK_ID)!;
    expect(pad.id).toBe(COMPETITION_SLEEPING_PAD_ID);
    expect(bag.context.experience).toEqual({ text: expect.stringContaining("warm around 35°F"), truthState: "owner_reported" });
    expect(pad.context.experience).toEqual({ text: expect.stringMatching(/Cold came through.*bag stayed warm around 35°F/), truthState: "owner_reported" });
    expect(pad.context.summary?.text).toMatch(/warmth over minimum weight.*keep.*sleeping bag.*\$250/);
    expect(pad.context.plan).toEqual({ text: COMPETITION_INITIAL_UPGRADE_PLAN_BODY, truthState: "planned" });
    expect(COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY).toMatch(/sleeping pad.*low-R.*cold through.*35°F.*warmth.*\$250.*keep.*sleeping bag.*planned only.*not purchased, owned, or installed/s);
    expect(pad.context.condition?.text).toContain("no replacement is owned");
    expect(fixture.collections[0].notes).toContain("not purchased, owned, or installed");
    expect(fixture.lifeLinks.some((item) => /replacement.*pad/i.test(item.title))).toBe(false);
    expect(bag.publicFieldKeys).toEqual(["condition"]);
    expect(pad.publicFieldKeys).toEqual([]);
    expect(fixture.lifeLinks.find((item) => item.id === COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID)?.publicFieldKeys).toEqual(["summary"]);
    bag.context.experience!.text = "mutated returned object";
    expect(createCompetitionFixtureData("judge-password", "https://challenge.life-links.test").lifeLinks.find((item) => item.id === bag.id)?.context.experience?.text).toContain("35°F");
  });

  it("preserves the original object QR identities and selects the public sleep tub as the new target", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));

    expect(COMPETITION_TARGET_QR_ID).toBe("LL-WEBMCP-00004");
    expect(COMPETITION_DECOY_QR_ID).toBe("LL-WEBMCP-00003");
    expect(COMPETITION_FIND_TARGET_LIFE_LINK_ID).toBe(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID);
    expect(COMPETITION_FIND_DECOY_LIFE_LINK_ID).toBe(COMPETITION_SHELTER_TUB_ID);
    expect(byId.get(COMPETITION_SLEEPING_BAG_ID)).toMatchObject({
      privacy: "public",
      qrId: COMPETITION_SLEEPING_BAG_QR_ID,
      body: expect.stringContaining("warm around 35°F")
    });
    expect(byId.get(COMPETITION_SLEEPING_PAD_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_SLEEPING_PAD_QR_ID,
      body: expect.stringContaining("Cold came through the ground")
    });
    expect(byId.get(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID)).toMatchObject({
      privacy: "public",
      qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
      body: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY
    });
    expect(byId.get(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID)?.body).not.toMatch(
      /low-R|Adult Two|working bag|cold through|upgrade|\$250/i
    );
    expect(byId.get(COMPETITION_SHELTER_TUB_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_SHELTER_TUB_QR_ID
    });
    expect(byId.get(COMPETITION_KITCHEN_WATER_TUB_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_KITCHEN_WATER_TUB_QR_ID
    });
    expect(byId.get(COMPETITION_SAFETY_LIGHTING_TUB_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_SAFETY_LIGHTING_TUB_QR_ID
    });
    expect(byId.get(COMPETITION_HIKING_WEATHER_TUB_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_HIKING_WEATHER_TUB_QR_ID
    });
    expect(byId.get(COMPETITION_CYCLING_REPAIRS_TUB_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_CYCLING_REPAIRS_TUB_QR_ID
    });
    expect(fixture.qrBindings).toEqual([
      binding(COMPETITION_SLEEPING_BAG_QR_ID, COMPETITION_SLEEPING_BAG_ID),
      binding(COMPETITION_SLEEPING_PAD_QR_ID, COMPETITION_SLEEPING_PAD_ID),
      binding(COMPETITION_SHELTER_TUB_QR_ID, COMPETITION_SHELTER_TUB_ID),
      binding(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID),
      binding(COMPETITION_KITCHEN_WATER_TUB_QR_ID, COMPETITION_KITCHEN_WATER_TUB_ID),
      binding(COMPETITION_SAFETY_LIGHTING_TUB_QR_ID, COMPETITION_SAFETY_LIGHTING_TUB_ID),
      binding(COMPETITION_HIKING_WEATHER_TUB_QR_ID, COMPETITION_HIKING_WEATHER_TUB_ID),
      binding(COMPETITION_CYCLING_REPAIRS_TUB_QR_ID, COMPETITION_CYCLING_REPAIRS_TUB_ID)
    ]);
    expect(fixture.lifeLinks.every((item) => extractPlainTextFromLinkBodyDoc(item.bodyDoc) === item.body)).toBe(true);
  });

  it("rejects missing passwords and non-HTTP QR bases", () => {
    expect(() => createCompetitionFixtureData("", "https://challenge.life-links.test")).toThrow("password is required");
    expect(() => createCompetitionFixtureData("judge-password", "not-a-url")).toThrow("absolute HTTP(S) URL");
    expect(() => createCompetitionFixtureData("judge-password", "file:///fixture")).toThrow("absolute HTTP(S) URL");
  });
});

function binding(qrId: string, lifeLinkId: string) {
  return { qrId, lifeLinkId, boundAt: COMPETITION_FIXTURE_TIMESTAMP };
}

function directChildren(
  lifeLinks: Array<{ id: string; parentId: string | null }>,
  parentId: string
): string[] {
  return lifeLinks.filter((item) => item.parentId === parentId).map((item) => item.id);
}

function descendantCount(
  lifeLinks: Array<{ id: string; parentId: string | null }>,
  rootId: string
): number {
  const childrenByParent = new Map<string, string[]>();
  for (const item of lifeLinks) {
    if (!item.parentId) {
      continue;
    }
    childrenByParent.set(item.parentId, [...(childrenByParent.get(item.parentId) ?? []), item.id]);
  }
  const pending = [...(childrenByParent.get(rootId) ?? [])];
  let count = 0;
  while (pending.length) {
    const next = pending.pop()!;
    count += 1;
    pending.push(...(childrenByParent.get(next) ?? []));
  }
  return count;
}

function pathTitles(byId: Map<string, { id: string; parentId: string | null; title: string }>, targetId: string): string[] {
  const titles: string[] = [];
  let current = byId.get(targetId);
  while (current) {
    titles.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return titles;
}
