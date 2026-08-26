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
  createLinkBodyDocFromPlainText,
  extractPlainTextFromLinkBodyDoc,
  parseQrId,
  parseLinkBodyBlocks,
  normalizeLinkBodyDoc,
  normalizeLinkBodyHref,
  searchOwnedLinks
} from "./index";

describe("Life Links core", () => {
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

  it("honors ownership visibility and project-name matching in owner searches", () => {
    const links = createUnclaimedLinks(["LL-A-00001", "LL-A-00002"], "https://lifelinks-vmdemo.com").map((link, index) => ({
      ...link,
      ownerId: index === 0 ? "user-1" : "user-2",
      status: "claimed" as const,
      title: index === 0 ? "Camera bag" : "Desk drawer",
      projectId: index === 0 ? "project-studio" : "project-office"
    }));
    const projects = [
      { id: "project-studio", ownerId: "user-1", name: "Studio Gear", createdAt: "2026-04-22T00:00:00.000Z" },
      { id: "project-office", ownerId: "user-2", name: "Office", createdAt: "2026-04-22T00:00:00.000Z" }
    ];

    expect(searchOwnedLinks(links, "user-1", "camera")).toHaveLength(1);
    expect(searchOwnedLinks(links, "user-1", "desk")).toHaveLength(0);
    expect(searchOwnedLinks(links, "user-1", "studio", projects)).toHaveLength(1);
    expect(searchOwnedLinks(links, "user-1", "office", projects)).toHaveLength(0);
  });

  it("exports CSV rows with quoted content when needed", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const csv = linksToCsv([{ ...link, title: "Box, shelf", ownerId: "user-1", status: "claimed" }]);
    expect(csv).toContain('"Box, shelf"');
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("escapes spreadsheet formula prefixes in CSV exports", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const csv = linksToCsv([{ ...link, title: "=HYPERLINK(\"https://example.test\")", ownerId: "user-1", status: "claimed" }]);
    expect(escapeCsvFormula(" @SUM(A1:A2)")).toBe("' @SUM(A1:A2)");
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  });

  it("parses formatted link bodies without collapsing line breaks", () => {
    const blocks = parseLinkBodyBlocks(
      [
        "First line",
        "second line with **bold** text",
        "",
        "- batteries",
        "- charger",
        "",
        "- [ ] verify photo",
        "- [x] text client",
        "",
        "1. pack",
        "2. ship"
      ].join("\n")
    );

    expect(blocks).toMatchObject([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "First line\nsecond line with " },
          { kind: "bold", text: "bold" },
          { kind: "text", text: " text" }
        ]
      },
      { kind: "unordered-list", items: [[{ kind: "text", text: "batteries" }], [{ kind: "text", text: "charger" }]] },
      {
        kind: "checklist",
        items: [
          { checked: false, children: [{ kind: "text", text: "verify photo" }] },
          { checked: true, children: [{ kind: "text", text: "text client" }] }
        ]
      },
      { kind: "ordered-list", items: [[{ kind: "text", text: "pack" }], [{ kind: "text", text: "ship" }]] }
    ]);
  });

  it("round-trips rich body documents through the plain-text compatibility layer", () => {
    const doc = createLinkBodyDocFromPlainText(["**Important** box", "", "- [x] packed", "- loose cable", "", "1. ship"].join("\n"));

    expect(doc).toMatchObject({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "taskList" },
        { type: "bulletList" },
        { type: "orderedList" }
      ]
    });
    expect(extractPlainTextFromLinkBodyDoc(doc)).toBe(["Important box", "- [x] packed", "- loose cable", "1. ship"].join("\n"));
  });

  it("keeps only safe hrefs in rich body link marks", () => {
    expect(normalizeLinkBodyHref("https://example.test/path")).toBe("https://example.test/path");
    expect(normalizeLinkBodyHref("mailto:owner@example.test")).toBe("mailto:owner@example.test");
    expect(normalizeLinkBodyHref("tel:+15555551212")).toBe("tel:+15555551212");
    expect(normalizeLinkBodyHref("/qr/LL-DEMO-00001")).toBe("/qr/LL-DEMO-00001");
    expect(normalizeLinkBodyHref("#details")).toBe("#details");
    expect(normalizeLinkBodyHref("javascript:alert(1)")).toBe("");
    expect(normalizeLinkBodyHref("//evil.example/path")).toBe("");

    const doc = normalizeLinkBodyDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "safe", marks: [{ type: "link", attrs: { href: "https://example.test" } }] },
            { type: "text", text: " unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }
          ]
        }
      ]
    });

    expect(JSON.stringify(doc)).toContain("https://example.test");
    expect(JSON.stringify(doc)).not.toContain("javascript:");
    expect(doc?.content?.[0]?.content?.[1]?.marks).toBeUndefined();
  });
});
