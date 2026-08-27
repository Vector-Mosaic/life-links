import { describe, expect, it } from "vitest";

import {
  COMPETITION_BASEMENT_GEAR_STORAGE_ID,
  COMPETITION_BATCH_ID,
  COMPETITION_CAMPING_KIT_ID,
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
    expect(first).toMatchObject({
      profile: "webmcp-family-adventure-context-v2",
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
    expect(first.projectCompatibility).toEqual([
      {
        projectId: COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
        lifeLinkId: COMPETITION_FAMILY_ADVENTURE_GEAR_ID
      }
    ]);
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

  it("encodes the exact family-of-four hierarchy, trip history, plans, and tub depths", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));

    expect(COMPETITION_FAMILY_ADVENTURE_GEAR_ID).toBe(COMPETITION_CAMPING_KIT_ID);
    expect(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID).toBe(COMPETITION_SLEEP_SYSTEM_ID);
    expect(pathTitles(byId, COMPETITION_START_LIFE_LINK_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Basement Gear Storage",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
    ]);
    expect(pathTitles(byId, COMPETITION_SLEEPING_BAG_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Basement Gear Storage",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep System",
      "Camping Sleeping Bag"
    ]);
    expect(pathTitles(byId, COMPETITION_SLEEPING_PAD_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Basement Gear Storage",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep System",
      "Camping Sleeping Pad"
    ]);
    expect(pathTitles(byId, COMPETITION_FOUR_DAY_FAMILY_TRIP_ID)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Previous Trip Experiences",
      COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE
    ]);
    expect(byId.get(COMPETITION_FAMILY_ADVENTURE_GEAR_ID)).toMatchObject({
      parentId: null,
      privacy: "private",
      qrId: null,
      body: expect.stringMatching(/family of four.*two adults.*two children/i)
    });
    expect(directChildren(fixture.lifeLinks, COMPETITION_BASEMENT_GEAR_STORAGE_ID)).toEqual([
      COMPETITION_SHELTER_TUB_ID,
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
      COMPETITION_KITCHEN_WATER_TUB_ID,
      COMPETITION_SAFETY_LIGHTING_TUB_ID,
      COMPETITION_HIKING_WEATHER_TUB_ID,
      COMPETITION_CYCLING_REPAIRS_TUB_ID
    ]);
    expect(descendantCount(fixture.lifeLinks, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID)).toBe(12);
    for (const tubId of [
      COMPETITION_SHELTER_TUB_ID,
      COMPETITION_KITCHEN_WATER_TUB_ID,
      COMPETITION_SAFETY_LIGHTING_TUB_ID,
      COMPETITION_HIKING_WEATHER_TUB_ID,
      COMPETITION_CYCLING_REPAIRS_TUB_ID
    ]) {
      expect(descendantCount(fixture.lifeLinks, tubId), tubId).toBe(7);
    }
    expect(byId.get(COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID)).toMatchObject({
      parentId: COMPETITION_FAMILY_ADVENTURE_GEAR_ID
    });
    expect(byId.get(COMPETITION_FOUR_DAY_FAMILY_TRIP_ID)).toMatchObject({
      parentId: COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID,
      body: expect.stringMatching(/four days.*35°F.*three-mile hike.*campground paths/i)
    });
    expect(byId.get(COMPETITION_FAMILY_PREFERENCES_ID)).toMatchObject({
      body: expect.stringMatching(/warmth matters more.*\$250.*two adults/i)
    });
    expect(byId.get(COMPETITION_NEXT_TRIP_PACKING_PLAN_ID)).toMatchObject({
      body: expect.stringMatching(/Planned only.*two day hikes.*family cycling/i)
    });
    expect(byId.get(COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID)).toMatchObject({
      body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY
    });
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
