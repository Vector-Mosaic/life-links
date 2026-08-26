import { describe, expect, it } from "vitest";

import {
  COMPETITION_BATCH_ID,
  COMPETITION_CAMERA_BATTERY_KIT_ID,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_FIELD_CAMERA_BAG_ID,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_FIXTURE_TIMESTAMP,
  COMPETITION_FRONT_ORGANIZER_ID,
  COMPETITION_LENS_CLEANING_KIT_ID,
  COMPETITION_MAIN_COMPARTMENT_ID,
  COMPETITION_OWNER_DISPLAY_NAME,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_OWNER_ID,
  COMPETITION_POWER_POUCH_ID,
  COMPETITION_TARGET_QR_ID,
  createCompetitionFixtureData,
  extractPlainTextFromLinkBodyDoc
} from "./index";

describe("WebMCP competition fixture", () => {
  it("constructs one deterministic synthetic camera-kit sandbox", () => {
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

  it("defines the exact target and decoy paths with bounded QR bindings", () => {
    const fixture = createCompetitionFixtureData("judge-password", "https://challenge.life-links.test");
    const byId = new Map(fixture.lifeLinks.map((item) => [item.id, item]));

    expect(pathTitles(byId, COMPETITION_CAMERA_BATTERY_KIT_ID)).toEqual([
      "Field Camera Bag",
      "Main Compartment",
      "Power Pouch",
      "Camera Battery Kit"
    ]);
    expect(pathTitles(byId, COMPETITION_LENS_CLEANING_KIT_ID)).toEqual([
      "Field Camera Bag",
      "Front Organizer",
      "Lens Cleaning Kit"
    ]);
    expect(byId.get(COMPETITION_FIELD_CAMERA_BAG_ID)).toMatchObject({ parentId: null, privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_MAIN_COMPARTMENT_ID)).toMatchObject({ privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_POWER_POUCH_ID)).toMatchObject({ privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_FRONT_ORGANIZER_ID)).toMatchObject({ privacy: "private", qrId: null });
    expect(byId.get(COMPETITION_CAMERA_BATTERY_KIT_ID)).toMatchObject({
      privacy: "public",
      qrId: COMPETITION_TARGET_QR_ID
    });
    expect(byId.get(COMPETITION_LENS_CLEANING_KIT_ID)).toMatchObject({
      privacy: "public",
      qrId: COMPETITION_DECOY_QR_ID
    });
    expect(fixture.qrBindings).toEqual([
      {
        qrId: COMPETITION_TARGET_QR_ID,
        lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
        boundAt: COMPETITION_FIXTURE_TIMESTAMP
      },
      {
        qrId: COMPETITION_DECOY_QR_ID,
        lifeLinkId: COMPETITION_LENS_CLEANING_KIT_ID,
        boundAt: COMPETITION_FIXTURE_TIMESTAMP
      }
    ]);
    const target = byId.get(COMPETITION_CAMERA_BATTERY_KIT_ID)!;
    expect(target.bodyDoc.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "taskList"]);
    expect(extractPlainTextFromLinkBodyDoc(target.bodyDoc)).toBe(target.body);
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
