// Office preparation is data-only. Native conversion is owned by the parent job.
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { SaxesParser } from "saxes";
import JSZip from "jszip";
import { validateOfficePackage } from "./attachment-package-reader.js";

const fail = (reason = "malformed") => { throw Object.assign(new Error(reason), { reason }); };
const W = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const S = new Set(["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"]);
const C = new Set(["http://schemas.openxmlformats.org/drawingml/2006/chart", "http://purl.oclc.org/ooxml/drawingml/chart"]);
const R = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"]);
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const activeTypes = /macroenabled|vbaproject|macrosheet|activex|oleobject/i;
const keepRelationships = new Set(["officeDocument", "styles", "stylesWithEffects", "settings", "webSettings", "fontTable", "numbering", "header", "footer", "footnotes", "endnotes", "comments", "theme", "image", "drawing", "chart", "diagramData", "diagramLayout", "diagramQuickStyle", "diagramColors", "worksheet", "chartsheet", "sharedStrings", "table"]);
const removedWordNodes = new Set(["instrText", "delInstrText", "fldChar", "ffData", "updateFields", "attachedTemplate", "dataBinding", "altChunk", "subDoc", "control", "object", "oleObject", "mailMerge", "docVars"]);
const removedSheetNodes = new Set(["definedNames", "calcChain", "calcPr", "externalReferences", "connections", "queryTable", "dataValidations", "conditionalFormatting", "extLst", "pivotTableDefinition", "pivotCacheDefinition", "pivotCacheRecords", "oleObjects", "controls", "webPublishItems", "webPublishObjects", "calculatedColumnFormula", "totalsRowFormula", "formula", "f"]);
const xmlEscape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\r", "&#13;");

function parseXml(bytes, budget) {
  let text;
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
    else text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { fail(); }
  if ((budget.bytes += Buffer.byteLength(text)) > 32 * 1024 * 1024) fail("extraction_limit");
  const parser = new SaxesParser({ xmlns: true }); const stack = []; let root;
  parser.on("doctype", () => fail()); parser.on("error", () => fail());
  parser.on("opentag", (tag) => {
    if (++budget.nodes > 350000 || stack.length > 128) fail("extraction_limit");
    const node = { name: tag.name, local: tag.local, uri: tag.uri, attrs: Object.values(tag.attributes).map((a) => ({ name: a.name, local: a.local, uri: a.uri, value: a.value })), children: [] };
    if (stack.length) stack.at(-1).children.push(node); else { if (root) fail(); root = node; }
    stack.push(node);
  });
  const characters = (value) => { if (stack.length) stack.at(-1).children.push(value); else if (value.trim()) fail(); };
  parser.on("text", characters); parser.on("cdata", characters); parser.on("closetag", () => stack.pop());
  parser.write(text).close(); if (!root || stack.length) fail(); return root;
}
const elements = (node) => node.children.filter((child) => typeof child !== "string");
const attr = (node, name) => node.attrs.find((a) => !a.uri && a.local === name)?.value;
const child = (node, name, uris) => elements(node).find((c) => c.local === name && (!uris || uris.has(c.uri)));
const textOf = (node) => node.children.map((c) => typeof c === "string" ? c : textOf(c)).join("");
function serialize(node) {
  return `<${node.name}${node.attrs.map((a) => ` ${a.name}="${xmlEscape(a.value)}"`).join("")}>${node.children.map((c) => typeof c === "string" ? xmlEscape(c) : serialize(c)).join("")}</${node.name}>`;
}
function namedLike(node, local, children = []) {
  const prefix = node.name.includes(":") ? node.name.split(":")[0] + ":" : "";
  return { name: prefix + local, local, uri: node.uri, attrs: node.attrs.filter((a) => a.uri === "http://www.w3.org/2000/xmlns/"), children };
}
function preserveNamespaces(parent, nodes) {
  for (const node of nodes) if (typeof node !== "string") {
    for (const a of parent.attrs.filter((a) => a.uri === "http://www.w3.org/2000/xmlns/")) {
      if (!node.attrs.some((existing) => existing.name === a.name)) node.attrs.push({ ...a });
    }
  }
  return nodes;
}
function relationshipPath(path) { return path ? posix.join(posix.dirname(path), "_rels", posix.basename(path) + ".rels") : "_rels/.rels"; }
function targetPath(source, target) {
  if (!target || /[\\?#\0]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) fail();
  let decoded; try { decoded = decodeURIComponent(target); } catch { fail(); }
  if (/[\\?#\0]/.test(decoded) || decoded.includes(":")) fail();
  const path = posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : posix.join(posix.dirname(source), decoded));
  if (!path || path === "." || path === ".." || path.startsWith("../") || path.startsWith("/")) fail(); return path;
}

function validateEmbeddedImage(bytes, contentType) {
  const kind = contentType.toLowerCase().replace(/^image\/(?:x-)?/, "");
  // Content_Types is untrusted. Office performs its own sniffing, so an SVG,
  // HTML, PDF or other active document relabelled image/png must not reach it.
  // This validates the declared binary family, not every codec payload; native
  // image parsing remains within the parent-owned bounded conversion process.
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let matches = false;
  if (kind === "png") matches = bytes.length >= 33 && bytes.subarray(0, 8).equals(png) && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString("ascii") === "IHDR";
  else if (kind === "jpeg") matches = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] !== 0;
  else if (kind === "gif") matches = bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  else if (kind === "bmp") matches = bytes.length >= 26 && bytes.subarray(0, 2).toString("ascii") === "BM" &&
    bytes.readUInt32LE(2) <= bytes.length && bytes.readUInt32LE(10) >= 26 && bytes.readUInt32LE(10) <= bytes.length &&
    [12, 40, 52, 56, 64, 108, 124].includes(bytes.readUInt32LE(14));
  else if (kind === "tiff") matches = bytes.length >= 8 && ["49492a00", "4d4d002a", "49492b00", "4d4d002b"].includes(bytes.subarray(0, 4).toString("hex"));
  else if (kind === "webp") matches = bytes.length >= 20 && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) <= bytes.length - 8;
  else if (kind === "emf") matches = bytes.length >= 88 && bytes.readUInt32LE(0) === 1 && bytes.readUInt32LE(4) >= 88 &&
    bytes.readUInt32LE(4) <= bytes.length && bytes.readUInt32LE(40) === 0x464d4520;
  else if (kind === "wmf") {
    const offset = bytes.length >= 22 && bytes.readUInt32LE(0) === 0x9ac6cdd7 ? 22 : 0;
    matches = bytes.length >= offset + 18 && [1, 2].includes(bytes.readUInt16LE(offset)) && bytes.readUInt16LE(offset + 2) === 9 &&
      [0x100, 0x300].includes(bytes.readUInt16LE(offset + 4)) && bytes.readUInt32LE(offset + 6) * 2 <= bytes.length - offset;
  }
  if (!matches) fail("malformed");
}

export async function prepareOfficePackage(data, mimeType) {
  const format = mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" :
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ? "xlsx" : null;
  if (!format) fail("unsupported_format");
  const parts = await validateOfficePackage(data, format, true); const budget = { bytes: 0, nodes: 0 };
  const warnings = new Set(["Rendered print projection; pagination, fonts and unsupported styling may differ from the original. Original bytes and extracted text remain unchanged.",
    ...(format === "xlsx" ? ["Stored cell/chart results only; formulas are not calculated. Hidden sheets and content outside print areas may not appear in this print projection."] : [])]);
  const types = parseXml(parts.get("[Content_Types].xml"), budget); if (types.uri !== TYPES || types.local !== "Types") fail();
  const overrides = new Map(); const defaults = new Map();
  for (const node of elements(types)) {
    if (node.uri !== TYPES || !["Default", "Override"].includes(node.local)) fail();
    const type = attr(node, "ContentType"); if (!type || activeTypes.test(type)) fail("unsupported_format");
    const key = attr(node, node.local === "Override" ? "PartName" : "Extension"); if (!key) fail();
    const map = node.local === "Override" ? overrides : defaults; const normalized = node.local === "Override" ? targetPath("", key) : key.toLowerCase();
    if (map.has(normalized)) fail(); map.set(normalized, type);
  }
  const typeOf = (path) => overrides.get(path) ?? defaults.get(posix.extname(path).slice(1).toLowerCase());
  const output = new Map(); const visited = new Set(); const trees = new Map(); const removedIds = new Map();
  const getXml = (path) => { if (!parts.has(path)) fail(); if (!trees.has(path)) trees.set(path, parseXml(parts.get(path), budget)); return trees.get(path); };
  let main = null;

  function visit(source, depth = 0) {
    if (depth > 64) fail("extraction_limit");
    if (visited.has(source)) return; visited.add(source);
    const relPath = relationshipPath(source); if (!parts.has(relPath)) { if (!source) fail(); return; }
    const rels = getXml(relPath); if (rels.uri !== RELS || rels.local !== "Relationships") fail();
    const ids = new Set(); const removed = new Set(); removedIds.set(source, removed);
    rels.children = rels.children.filter((rel) => {
      if (typeof rel === "string") return !rel.trim();
      if (rel.uri !== RELS || rel.local !== "Relationship") fail();
      const id = attr(rel, "Id"), type = attr(rel, "Type"), target = attr(rel, "Target"), mode = attr(rel, "TargetMode");
      if (!id || ids.has(id) || !type || !target || (mode && !["External", "Internal"].includes(mode))) fail(); ids.add(id);
      const relation = [...R].find((prefix) => type.startsWith(prefix + "/"));
      const kind = relation ? type.slice(relation.length + 1) : "";
      if (mode === "External" || !keepRelationships.has(kind)) {
        removed.add(id);
        if (kind !== "hyperlink") warnings.add("External links, embedded objects, data connections or unsupported package parts were omitted from this visual projection.");
        return false;
      }
      const path = targetPath(source, target); if (!parts.has(path)) fail();
      const contentType = typeOf(path); if (!contentType) fail();
      if (!source && kind === "officeDocument") { if (main) fail(); main = path; }
      if (kind === "image") {
        // SVG can fetch linked resources; do not hand active vector markup to Office.
        if (!/^image\/(png|jpeg|gif|bmp|tiff|webp|x-emf|x-wmf|emf|wmf)$/i.test(contentType)) fail("unsupported_format");
        validateEmbeddedImage(parts.get(path), contentType);
        output.set(path, parts.get(path));
      } else {
        if (!/(?:\+xml|\/xml)$/.test(contentType)) fail("unsupported_format");
        getXml(path); output.set(path, null); visit(path, depth + 1);
      }
      return true;
    });
    output.set(relPath, null);
  }
  visit("");
  if (!main || (format === "docx" ? !W.has(getXml(main).uri) || getXml(main).local !== "document" : !S.has(getXml(main).uri) || getXml(main).local !== "workbook")) fail();

  function transform(node, source) {
    const warn = (message) => warnings.add(message);
    const isWord = W.has(node.uri), isSheet = S.has(node.uri), isChart = C.has(node.uri);
    if (isWord && removedWordNodes.has(node.local)) {
      if (["instrText", "delInstrText", "fldChar"].includes(node.local)) warn("Word fields use their stored display results; field instructions and updates were removed.");
      else warn("Active fields, linked content or embedded objects were omitted from this visual projection.");
      return [];
    }
    if ((isSheet && removedSheetNodes.has(node.local)) || (!isWord && /^(formula|calculatedColumnFormula|totalsRowFormula|conditionalFormatting|definedName|dataValidation)$/i.test(node.local))) {
      if (node.local === "conditionalFormatting" || node.local === "extLst") warn("Conditional formatting and extension-only spreadsheet effects are not evaluated in this cached-value projection.");
      if (node.local === "definedNames") warn("Defined names and print-area formulas were removed; this projection may include cells outside the original print area.");
      return [];
    }
    if (isChart && ["externalData", "pivotSource", "trendline"].includes(node.local)) {
      warn("Chart external data, pivot refresh and computed trendlines are not evaluated; stored chart values are used where available."); return [];
    }
    if (isChart && ["numRef", "strRef"].includes(node.local)) {
      const cache = child(node, node.local === "numRef" ? "numCache" : "strCache", C);
      if (!cache) fail("unsupported_format");
      const literal = namedLike(node, node.local === "numRef" ? "numLit" : "strLit", preserveNamespaces(cache, cache.children));
      // A reference can have an extension or missing cache; never invent its values.
      warn("Charts are drawn from stored literal cache values, without evaluating their source references.");
      return transform(literal, source);
    }
    if (isChart && node.local === "multiLvlStrRef") {
      // This schema has no multiLvlStrLit. Refuse rather than silently flatten labels.
      fail("unsupported_format");
    }
    if (isChart && node.local === "f") fail("unsupported_format");
    if (isSheet && node.local === "c") {
      const formula = child(node, "f", S);
      if (formula) {
        const value = child(node, "v", S); const type = attr(node, "t") ?? "n";
        node.children = node.children.filter((c) => typeof c === "string" || !(S.has(c.uri) && c.local === "f"));
        if (!value) {
          warn("Some formulas have no stored result; those cells are explicitly marked as unavailable rather than calculated.");
          node.attrs = node.attrs.filter((a) => a.local !== "t" || a.uri);
          node.attrs.push({ name: "t", local: "t", uri: "", value: "inlineStr" });
          node.children = [namedLike(node, "is", [namedLike(node, "t", ["[Stored result unavailable]"])])];
        } else if (type === "str") {
          // Formula string caches become inline strings, not new formulas or shared-string indices.
          node.attrs = node.attrs.filter((a) => a.local !== "t" || a.uri);
          node.attrs.push({ name: "t", local: "t", uri: "", value: "inlineStr" });
          node.children = [namedLike(node, "is", [namedLike(node, "t", [textOf(value)])])];
        } else if (!["n", "b", "e", "d"].includes(type) || (type === "n" && (!textOf(value).trim() || !Number.isFinite(Number(textOf(value))))) ||
          (type === "b" && !["0", "1"].includes(textOf(value)))) fail();
      }
    }
    const removed = removedIds.get(source) ?? new Set();
    const hasRemovedLink = node.attrs.some((a) => R.has(a.uri) && removed.has(a.value));
    node.attrs = node.attrs.filter((a) => {
      if (["macro", "action"].includes(a.local.toLowerCase())) return false;
      if (isSheet && a.local === "totalsRowFunction") return false;
      if (R.has(a.uri) && removed.has(a.value)) return false;
      // VML/Office extensions can encode a direct URL without an OPC relationship.
      if (["src", "href"].includes(a.local.toLowerCase()) && a.value && !a.value.startsWith("#")) {
        warn("Direct linked image/object resources were omitted; no external resources were fetched."); return false;
      }
      return !/^on[a-z]/i.test(a.local);
    });
    node.children = node.children.flatMap((c) => typeof c === "string" ? [c] : transform(c, source));
    if (isWord && (node.local === "fldSimple" || (node.local === "hyperlink" && hasRemovedLink))) {
      if (node.local === "fldSimple") warn("Word fields use their stored display results; field instructions and updates were removed.");
      return preserveNamespaces(node, node.children);
    }
    return [node];
  }

  for (const [path, bytes] of output) {
    if (bytes !== null) continue;
    const root = getXml(path); const transformed = path.endsWith(".rels") ? [root] : transform(root, path);
    if (transformed.length !== 1 || typeof transformed[0] === "string") fail();
    output.set(path, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${serialize(transformed[0])}`));
  }
  // Publish only the relationship-reachable, prepared parts; no orphan/active ZIP entries survive.
  types.children = types.children.filter((n) => typeof n === "string" || n.local === "Default" || output.has(targetPath("", attr(n, "PartName"))));
  output.set("[Content_Types].xml", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${serialize(types)}`));
  let bytes = 0; const zip = new JSZip();
  for (const [path, data] of output) { if ((bytes += data.length) > 64 * 1024 * 1024) fail("extraction_limit"); zip.file(path, data, { date: new Date("2000-01-01T00:00:00Z") }); }
  const prepared = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 3 } });
  if (prepared.length > 25 * 1024 * 1024) fail("extraction_limit");
  const messages = [...warnings];
  const concise = ["Office print projection: layout/fonts may differ; hidden/off-print content and unsupported styles may not appear. Original bytes and text remain available."];
  if (format === "docx" && messages.some((s) => /fields|field instructions|linked content/i.test(s))) {
    concise.push("Word fields show stored display results only; instructions/updates, linked content and embedded objects are disabled or omitted.");
  }
  if (format === "xlsx" || messages.some((s) => /Charts are drawn|Chart external/i.test(s))) {
    concise.push("Stored cell/chart results only; missing caches marked. Formula evaluation, conditional formatting, names/print areas, trendlines and refresh are omitted.");
  }
  if (messages.some((s) => /External links|Direct linked/i.test(s))) {
    concise.push("External resources, embedded active objects and unsupported package parts were omitted; ordinary hyperlink display text is preserved.");
  }
  return { status: "ready", data: prepared, warnings: concise };
}

if (process.send && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.once("message", async ({ data, mimeType }) => {
  try { process.send?.(await prepareOfficePackage(Buffer.from(data), mimeType), () => process.exit(0)); }
  catch (error) {
    const reason = ["encrypted", "extraction_limit", "unsupported_format"].includes(error?.reason) ? error.reason : "malformed";
    process.send?.({ status: "unreadable", reason }, () => process.exit(0));
  }
});
