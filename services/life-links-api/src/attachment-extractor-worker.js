// Static child-process entry: document bytes are data, never executable input.
// No credentials, document paths, URLs, or user-provided code enter this process.
import { TextDecoder } from "node:util";
import { ATTACHMENT_EXTRACTION_MAX_BYTES } from "@life-links/core";
import { validateOfficePackage } from "./attachment-package-reader.js";

const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
function boundedText() {
  const parts = []; let bytes = 0;
  return { add(value) { const text = String(value); bytes += Buffer.byteLength(text); if (bytes > ATTACHMENT_EXTRACTION_MAX_BYTES) fail("extraction_limit"); parts.push(text); }, finish() { return parts.join(""); } };
}

async function extract(data, format) {
  const out = boundedText();
  if (format === "text") {
    if (data.length > ATTACHMENT_EXTRACTION_MAX_BYTES) fail("extraction_limit");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (text.includes("\0")) fail("malformed");
    out.add(text);
    return { text: out.finish(), warnings: [] };
  }
  if (format === "pdf") {
    if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) fail("malformed");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, useWorkerFetch: false,
      useSystemFonts: false, disableFontFace: true, enableXfa: false, verbosity: 0 });
    let document;
    try {
      document = await task.promise;
      if (document.numPages > 512) fail("extraction_limit");
      const emptyPages = []; let anyText = false;
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const content = await page.getTextContent();
        const text = content.items.filter((item) => "str" in item).map((item) => item.str + (item.hasEOL ? "\n" : " ")).join("");
        if (text.trim()) anyText = true; else emptyPages.push(number);
        out.add(`[Page ${number}]\n${text}\n`); page.cleanup();
      }
      if (!anyText) fail("scanned_or_no_text");
      return { text: out.finish(), warnings: ["Text extraction does not read images, diagrams, handwriting, or visual layout.",
        ...(emptyPages.length ? [`${emptyPages.length} page(s) without extractable text (blank or scanned): ${emptyPages.slice(0, 12).join(", ")}${emptyPages.length > 12 ? ", … (all page markers remain in the text)" : ""}.`] : [])] };
    } catch (error) {
      if (error?.name === "PasswordException") fail("encrypted");
      throw error;
    } finally { await task.destroy(); }
  }
  const parts = await validateOfficePackage(data, format);
  if (format === "docx") {
    const { extractWordText } = await import("./attachment-docx-reader.js");
    return extractWordText(parts, out);
  }
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  if (workbook.worksheets.length > 128) fail("extraction_limit");
  let cells = 0;
  for (const sheet of workbook.worksheets) {
    out.add(`[Sheet ${JSON.stringify(sheet.name)}${sheet.state === "visible" ? "" : ` (${sheet.state})`}]\n`);
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (++cells > 100000) fail("extraction_limit");
      out.add(`${cell.address}\t${JSON.stringify(cell.value)}\n`);
    }));
  }
  return { text: out.finish(), warnings: ["Cell values and stored formulas/results are read without recalculation; charts, drawings, and visual formatting are not interpreted."] };
}

process.once("message", async ({ data, format }) => {
  try {
    const result = await extract(Buffer.from(data), format);
    process.send?.({ status: "ready", reason: null, ...result }, () => process.exit(0));
  } catch (error) {
    const reason = ["encrypted", "extraction_limit", "scanned_or_no_text"].includes(error?.reason) ? error.reason : "malformed";
    process.send?.({ status: "unreadable", reason, text: "", warnings: [] }, () => process.exit(0));
  }
});
