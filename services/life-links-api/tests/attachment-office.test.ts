import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { SaxesParser } from "saxes";
import { describe, expect, it } from "vitest";
import { prepareOfficePackage } from "../src/attachment-office-worker.js";
import { prepareOfficePdf, OFFICE_PROFILE } from "../src/attachment-office.js";
import { attachmentRuntime, type AttachmentProcessingJob } from "../src/attachment-native-runtime.js";
import { extractWordText } from "../src/attachment-docx-reader.js";
import { validateOfficePackage } from "../src/attachment-package-reader.js";
import { DOCX_MIME, XLSX_MIME, WORD_NS, SHEET_NS, CHART_NS, REL_NS, TYPE_NS, relation, rels, sheetVisualFixture, wordVisualFixture } from "./attachment-office-fixtures.js";

async function changed(input: Buffer, file: string, transform: (xml: string) => string) {
  const zip = await JSZip.loadAsync(input); zip.file(file, transform(await zip.file(file)!.async("string"))); return zip.generateAsync({ type: "nodebuffer" });
}
async function texts(input: Buffer) {
  const zip = await JSZip.loadAsync(input); const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(zip.files)) if (!value.dir && (name.endsWith(".xml") || name.endsWith(".rels"))) {
    const xml = await value.async("string"); new SaxesParser({ xmlns: true }).write(xml).close(); output[name] = xml;
  }
  return output;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("inert Office visual preparation", () => {
  it("checks actual embedded image families rather than trusting a relabelled active payload, while retaining genuine raster bytes", async () => {
    const embed = async (bytes: Buffer, type: string) => {
      const zip = await JSZip.loadAsync(await wordVisualFixture());
      zip.file("word/media/embedded.img", bytes);
      zip.file("[Content_Types].xml", (await zip.file("[Content_Types].xml")!.async("string"))
        .replace("</Types>", `<Override PartName="/word/media/embedded.img" ContentType="${type}"/></Types>`));
      zip.file("word/_rels/document.xml.rels", (await zip.file("word/_rels/document.xml.rels")!.async("string"))
        .replace("</Relationships>", relation("picture", "image", "media/embedded.img") + "</Relationships>"));
      return zip.generateAsync({ type: "nodebuffer" });
    };
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/webp", "image/x-emf", "image/x-wmf"]) {
      for (const active of ["<svg xmlns='http://www.w3.org/2000/svg'><image href='file:///private'/></svg>", "%PDF-1.7\nactive document", "<?xml version='1.0'?><html/>"]) {
        await expect(prepareOfficePackage(await embed(Buffer.from(active), type), DOCX_MIME)).rejects.toMatchObject({ reason: "malformed" });
      }
    }
    const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#28a86b" } }).png().toBuffer();
    const result = await prepareOfficePackage(await embed(png, "image/png"), DOCX_MIME);
    expect(await (await JSZip.loadAsync(result.data)).file("word/media/embedded.img")!.async("nodebuffer")).toEqual(png);
    await expect(prepareOfficePackage(await embed(png, "image/jpeg"), DOCX_MIME)).rejects.toMatchObject({ reason: "malformed" });
  });

  it("preserves Word stored field/header/table/hyperlink display while removing every field instruction and external URI", async () => {
    const original = await wordVisualFixture(); const before = hash(original);
    const result = await prepareOfficePackage(original, DOCX_MIME); const xml = await texts(result.data);
    expect(hash(original)).toBe(before);
    expect(xml["word/document.xml"]).toContain("STORED FIELD 73");
    expect(xml["word/document.xml"]).toContain("CACHED COMPLEX FIELD");
    expect(xml["word/document.xml"]).toContain("Readable hyperlink label");
    expect(xml["word/document.xml"]).toContain("LEFT CELL");
    expect(xml["word/document.xml"]).toContain("RIGHT CELL");
    expect(xml["word/header.xml"]).toContain("HEADER V42");
    expect(Object.values(xml).join("\n")).not.toMatch(/DDEAUTO|INCLUDETEXT|example\.invalid|instrText|fldChar|fldSimple/);
    expect(result.warnings.join(" ")).toContain("stored display results");
  });

  it("keeps stale numeric/string cached results, marks missing caches, and converts chart references to literal stored chart values", async () => {
    const original = await sheetVisualFixture(); const before = hash(original);
    const result = await prepareOfficePackage(original, XLSX_MIME); const xml = await texts(result.data); const sheet = xml["xl/worksheets/sheet1.xml"];
    expect(hash(original)).toBe(before);
    expect(sheet).toContain('<s:v>73</s:v>'); expect(sheet).toContain("=LITERAL CACHED STRING");
    expect(sheet).toContain("[Stored result unavailable]");
    expect(Object.values(xml).join("\n")).not.toMatch(/1\+1|NOW\(|WEBSERVICE|<s:f[ >]|<c:f[ >]|conditionalFormatting|definedName|calcPr/);
    const chart = xml["xl/charts/chart1.xml"];
    expect(chart).toContain("c:numLit"); expect(chart).toContain("c:strLit"); expect(chart).toContain("73"); expect(chart).toContain("Alpha");
    expect(chart).not.toMatch(/numRef|strRef|numCache|strCache/);
    expect(xml["xl/drawings/drawing1.xml"]).toContain('r:id="chart"');
    expect(result.warnings.join(" ")).toMatch(/conditional formatting/);
    expect(result.warnings.length).toBeLessThanOrEqual(4);
    expect(result.warnings.every((warning: string) => warning.length <= 160)).toBe(true);
  });

  it("handles aliased Strict Word namespaces and declarations on a removed field wrapper", async () => {
    const original = await changed(await wordVisualFixture(), "word/document.xml", (xml) => xml.replaceAll(WORD_NS, "http://purl.oclc.org/ooxml/wordprocessingml/main")
      .replace('<w:fldSimple w:instr=', '<w:fldSimple xmlns:alias="http://purl.oclc.org/ooxml/wordprocessingml/main" w:instr=')
      .replace("<w:t>STORED FIELD 73</w:t>", "<alias:t>STORED FIELD 73</alias:t>"));
    const result = await prepareOfficePackage(original, DOCX_MIME); const xml = await texts(result.data);
    expect(xml["word/document.xml"]).toContain("STORED FIELD 73");
  });

  it("removes table evaluator inputs and disconnected external data without losing cached cells", async () => {
    const zip = await JSZip.loadAsync(await sheetVisualFixture());
    zip.file("xl/tables/table1.xml", `<s:table xmlns:s="${SHEET_NS}" id="1" name="Table1" displayName="Table1" ref="A1:B2"><s:tableColumns count="1"><s:tableColumn id="1" name="Value" totalsRowFunction="sum"><s:calculatedColumnFormula>WEBSERVICE("remote")</s:calculatedColumnFormula><s:totalsRowFormula>NOW()</s:totalsRowFormula></s:tableColumn></s:tableColumns></s:table>`);
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", rels(relation("drawing", "drawing", "../drawings/drawing1.xml") + relation("table", "table", "../tables/table1.xml") + relation("ext", "externalLink", "https://example.invalid/data", true)));
    const result = await prepareOfficePackage(await zip.generateAsync({ type: "nodebuffer" }), XLSX_MIME); const xml = await texts(result.data);
    expect(xml["xl/tables/table1.xml"]).not.toMatch(/Formula|formula|totalsRowFunction/);
    expect(Object.values(xml).join(" ")).not.toContain("example.invalid");
    expect(xml["xl/worksheets/sheet1.xml"]).toContain("73");
  });

  it.each(["missing-cache", "multi-level-reference"])("refuses a decisive chart with %s rather than silently dropping it", async (kind) => {
    const original = await changed(await sheetVisualFixture(), "xl/charts/chart1.xml", (xml) => kind === "missing-cache" ? xml.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/, "") : xml.replaceAll("strRef", "multiLvlStrRef"));
    await expect(prepareOfficePackage(original, XLSX_MIME)).rejects.toMatchObject({ reason: "unsupported_format" });
  });

  it.each(["missing-part", "escaping-target", "doctype", "macro-content"])("refuses unsafe or malformed %s input without successful partial bytes", async (kind) => {
    let original = await wordVisualFixture();
    if (kind === "missing-part") original = await changed(original, "word/_rels/document.xml.rels", (xml) => xml.replace('Target="header.xml"', 'Target="missing.xml"'));
    if (kind === "escaping-target") original = await changed(original, "word/_rels/document.xml.rels", (xml) => xml.replace('Target="header.xml"', 'Target="../../private.xml"'));
    if (kind === "doctype") original = await changed(original, "word/document.xml", (xml) => '<!DOCTYPE w:document [<!ENTITY leak SYSTEM "file:///private">]>' + xml);
    if (kind === "macro-content") original = await changed(original, "[Content_Types].xml", (xml) => xml.replace("wordprocessingml.document.main+xml", "wordprocessingml.document.macroEnabled.main+xml"));
    await expect(prepareOfficePackage(original, DOCX_MIME)).rejects.toMatchObject({ reason: kind === "macro-content" ? "unsupported_format" : "malformed" });
  });

  it("does not carry arbitrary orphan parts into a derivative or alter the DOCX text preflight result", async () => {
    const zip = await JSZip.loadAsync(await wordVisualFixture()); zip.file("orphan.xml", "<private>UNRELATED SECRET</private>");
    const original = await zip.generateAsync({ type: "nodebuffer" }); const prepared = await prepareOfficePackage(original, DOCX_MIME);
    expect((await JSZip.loadAsync(prepared.data)).file("orphan.xml")).toBeNull();
    const parts = await validateOfficePackage(original, "docx"); const captured: string[] = [];
    const extracted = extractWordText(parts, { add: (s: unknown) => captured.push(String(s)), finish: () => captured.join("") });
    expect(extracted.text).toContain("VISUAL WORD BODY"); expect(extracted.text).toContain("HEADER V42");
    expect(extracted.text).not.toContain("UNRELATED SECRET");
  });
});

describe("Office PDF adapter", () => {
  it("uses only prepared bytes, isolated hard-disabled profile and fixed native options; returns private derivative without changing originals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "life-links-office-test-")); const original = await wordVisualFixture(); const calls: string[][] = [];
    try {
      const job: AttachmentProcessingJob = { directory, signal: new AbortController().signal, runtime: attachmentRuntime(),
        runWorker: async (_kind: unknown, request: any) => await prepareOfficePackage(request.data, request.mimeType) as any,
        runNative: async (_binary, args) => {
          calls.push(args);
          if (args.includes("--version")) return { stdout: Buffer.from("LibreOffice 7.4.7.2 40(Build:2)\n"), stderr: Buffer.alloc(0) };
          const input = await texts(await readFile(join(directory, "document.docx")));
          expect(input["word/document.xml"]).not.toMatch(/DDEAUTO|INCLUDETEXT/);
          expect(await readFile(join(directory, "office-profile", "user", "registrymodifications.xcu"), "utf8")).toBe(OFFICE_PROFILE);
          await writeFile(join(directory, "document.pdf"), "%PDF-1.7\nsynthetic-test-result");
          return { stdout: Buffer.from("converted"), stderr: Buffer.alloc(0) };
        } };
      const result = await prepareOfficePdf(original, DOCX_MIME, job);
      expect(result.processorVersion).toBe("libreoffice/7.4.7.2;cached-print-v1");
      expect(result.data.subarray(0, 5).toString()).toBe("%PDF-");
      expect(calls[1]).toContain("--headless"); expect(calls[1]).toContain("--norestore");
      expect(calls[1].join(" ")).toContain("writer_pdf_Export");
      expect(OFFICE_PROFILE).toContain('oor:name="DisableMacrosExecution"'); expect(OFFICE_PROFILE).toContain('oor:name="DisableActiveContent"');
      expect(await texts(original)).toHaveProperty("word/document.xml");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
