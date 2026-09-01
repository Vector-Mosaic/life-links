import { describe, expect, it } from "vitest";
import {
  DEFAULT_QR_BASE_URL,
  buildQrUrl,
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
  normalizeLinkBodyHref
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

  it("keeps the implicit QR origin local and requires hosted runtimes to configure their origin", () => {
    expect(DEFAULT_QR_BASE_URL).toBe("http://127.0.0.1:3002");
  });

  it("exports CSV rows with quoted content when needed", () => {
    const [link] = createUnclaimedLinks(["LL-DEMO-00001"], "https://lifelinks-vmdemo.com", "2026-04-22T00:00:00.000Z");
    const csv = linksToCsv([{ ...link, title: "Box, shelf", ownerId: "user-1", status: "claimed" }]);
    expect(csv).toContain('"Box, shelf"');
    expect(csv.split("\n")[0]).toBe("qr_id,url,status,owner_id,title,privacy");
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
