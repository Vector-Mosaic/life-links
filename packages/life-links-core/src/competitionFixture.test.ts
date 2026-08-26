import { describe, expect, it } from "vitest";

import {
  COMPETITION_BATCH_ID,
  COMPETITION_CAMPING_KIT_ID,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_FIXTURE_TIMESTAMP,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_OWNER_DISPLAY_NAME,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_OWNER_ID,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_SLEEP_SYSTEM_ID,
  COMPETITION_TARGET_QR_ID,
  COMPETITION_UPGRADE_PLAN_ID,
  COMPETITION_UPGRADE_PREFERENCES_ID,
  createCompetitionFixtureData,
  extractPlainTextFromLinkBodyDoc
} from "./index";

describe("WebMCP competition fixture", () => {
  it("constructs one deterministic synthetic camping-context sandbox", () => {
    const first = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test/");
    const second = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      profile: COMPETITION_FIXTURE_PROFILE,
      owner: {
        id: COMPETITION_OWNER_ID,
        email: COMPETITION_OWNER_EMAIL,
        displayName: COMPETITION_OWNER_DISPLAY_NAME,
        createdAt: COMPETITION_FIXTURE_TIMESTAMP
      },
      batch: {
        id: COMPETITION_BATCH_ID,
        createdBy: COMPETITION_OWNER_ID,
        count: 2,
        createdAt: COMPETITION_FIXTURE_TIMESTAMP
      }
    });
    expect(first.owner).not.toHaveProperty("password");
    expect(first.qrInventory.map((item) => item.id)).toEqual([COMPETITION_TARGET_QR_ID, COMPETITION_DECOY_QR_ID]);
    expect(first.qrInventory.map((item) => item.url)).toEqual([
      `https://challenge.life-links.test/qr/${COMPETITION_TARGET_QR_ID}`,
      `https://challenge.life-links.test/qr/${COMPETITION_DECOY_QR_ID}`
    ]);
    expect(first.lifeLinks.every((item) => item.createdAt === COMPETITION_FIXTURE_TIMESTAMP)).toBe(true);
    expect(first.lifeLinks.every((item) => item.updatedAt === COMPETITION_FIXTURE_TIMESTAMP)).toBe(true);
  });

  it("encodes the locked camping facts, planned-state boundary, and bounded QR bindings", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));

    expect(pathTitles(byId, COMPETITION_SLEEPING_BAG_ID)).toEqual([
      "Camping Kit",
      "Camping Sleep System",
      "Camping Sleeping Bag"
    ]);
    expect(pathTitles(byId, COMPETITION_SLEEPING_PAD_ID)).toEqual([
      "Camping Kit",
      "Camping Sleep System",
      "Camping Sleeping Pad"
    ]);
    expect(byId.get(COMPETITION_CAMPING_KIT_ID)).toMatchObject({ parentId: null, privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_SLEEP_SYSTEM_ID)).toMatchObject({ privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_SLEEPING_BAG_ID)).toMatchObject({
      privacy: "public",
      qrId: COMPETITION_TARGET_QR_ID,
      body: expect.stringContaining("warm around 35°F")
    });
    expect(byId.get(COMPETITION_SLEEPING_PAD_ID)).toMatchObject({
      privacy: "private",
      qrId: COMPETITION_DECOY_QR_ID,
      body: expect.stringContaining("Cold came through the ground")
    });
    expect(byId.get(COMPETITION_UPGRADE_PREFERENCES_ID)).toMatchObject({
      body: expect.stringMatching(/warmth matters more.*\$250/)
    });
    expect(byId.get(COMPETITION_UPGRADE_PLAN_ID)).toMatchObject({
      body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY
    });
    expect(fixture.qrBindings).toEqual([
      {
        qrId: COMPETITION_TARGET_QR_ID,
        lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
        boundAt: COMPETITION_FIXTURE_TIMESTAMP
      },
      {
        qrId: COMPETITION_DECOY_QR_ID,
        lifeLinkId: COMPETITION_SLEEPING_PAD_ID,
        boundAt: COMPETITION_FIXTURE_TIMESTAMP
      }
    ]);
    expect(fixture.lifeLinks.every((item) => extractPlainTextFromLinkBodyDoc(item.bodyDoc) === item.body)).toBe(true);
  });

  it("rejects missing passwords and non-HTTP QR bases", () => {
    expect(() => createCompetitionFixtureData("", "https://challenge.life-links.test")).toThrow("password is required");
    expect(() => createCompetitionFixtureData("judge-password", "not-a-url")).toThrow("absolute HTTP(S) URL");
    expect(() => createCompetitionFixtureData("judge-password", "file:///fixture")).toThrow("absolute HTTP(S) URL");
  });
});

function pathTitles(byId: Map<string, { id: string; parentId: string | null; title: string }>, targetId: string): string[] {
  const titles: string[] = [];
  let current = byId.get(targetId);
  while (current) {
    titles.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return titles;
}
