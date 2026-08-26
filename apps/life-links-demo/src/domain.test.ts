import { describe, expect, it } from "vitest";
import {
  buildQrUrl,
  claimLink,
  createUnclaimedLinks,
  escapeCsvFormula,
  generateSequentialQrIds,
  generateQrIds,
  isValidQrId,
  linksToCsv,
  parseQrId
} from "@life-links/core";

describe("Life Links domain", () => {
  it("generates 10,000 unique QR IDs for a print batch", () => {
    const ids = generateQrIds(10000, "BATCH");
    expect(ids).toHaveLength(10000);
    expect(new Set(ids).size).toBe(10000);
    expect(ids.every((id) => isValidQrId(id))).toBe(true);
    expect(ids.every((id) => /^LL-BATCH-[A-Z0-9]{16}$/.test(id))).toBe(true);
    expect(ids).not.toContain("LL-BATCH-00001");
  });

  it("keeps deterministic QR IDs available for stable demo seed data", () => {
    const ids = generateSequentialQrIds(10000, "BATCH");
    expect(ids).toHaveLength(10000);
    expect(new Set(ids).size).toBe(10000);
    expect(ids[0]).toBe("LL-BATCH-00001");
    expect(ids[9999]).toBe("LL-BATCH-007PS");
  });

  it("builds and parses the stable QR URL shape", () => {
    const url = buildQrUrl("https://lifelinks-vmdemo.com/", "LL-DEMO-00001");
    expect(url).toBe("https://lifelinks-vmdemo.com/qr/LL-DEMO-00001");
    expect(parseQrId(url)).toBe("LL-DEMO-00001");
  });

  it("claims an unclaimed QR idempotently for the same owner", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const first = claimLink([link], link.id, "user-1", "2026-04-22T00:00:01.000Z");
    const replay = claimLink(first.links, link.id, "user-1", "2026-04-22T00:00:02.000Z");
    const other = claimLink(replay.links, link.id, "user-2", "2026-04-22T00:00:03.000Z");

    expect(first.result).toBe("claimed");
    expect(replay.result).toBe("already_owned");
    expect(other.result).toBe("owned_by_other");
    expect(other.links[0].ownerId).toBe("user-1");
  });

  it("exports CSV rows with quoted content when needed", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const csv = linksToCsv([{ ...link, title: "Box, shelf", ownerId: "user-1", status: "claimed" }]);
    expect(csv).toContain('"Box, shelf"');
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("escapes spreadsheet formula prefixes in CSV exports", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const csv = linksToCsv([{ ...link, title: "-SUM(A1:A2)", ownerId: "user-1", status: "claimed" }]);
    expect(escapeCsvFormula("\t=1+1")).toBe("'\t=1+1");
    expect(csv).toContain("'-SUM(A1:A2)");
  });
});
