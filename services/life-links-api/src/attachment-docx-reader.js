// One local, text-only DOCX reader. The caller owns ZIP admission and the job
// deadline; this module never opens files, fetches relationships or executes fields.
import { TextDecoder } from "node:util";
import { posix } from "node:path";
import { SaxesParser } from "saxes";
import { ATTACHMENT_EXTRACTION_MAX_BYTES } from "@life-links/core";

const fail = (reason = "malformed") => { throw Object.assign(new Error(reason), { reason }); };
const wordNamespaces = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const relationshipNamespaces = new Set(["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"]);
const packageNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const contentTypeNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const compatibilityNamespace = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const kinds = { footnote: "Footnote", endnote: "Endnote", comment: "Comment", header: "Header", footer: "Footer" };
const roots = { body: "document", header: "hdr", footer: "ftr", footnote: "footnotes", endnote: "endnotes", comment: "comments" };

function attr(tag, local, namespaces) {
  const matches = Object.values(tag.attributes).filter((value) => value.local === local && (namespaces ? namespaces.has(value.uri) : !value.uri));
  if (matches.length > 1) fail();
  return matches[0]?.value;
}
function wordAttr(tag, local) { return attr(tag, local, wordNamespaces); }
function isWord(tag, local) { return wordNamespaces.has(tag.uri) && tag.local === local; }
function namespaceAt(prefix, stack) {
  for (let index = stack.length - 1; index >= 0; index--) {
    if (Object.hasOwn(stack[index].ns, prefix)) return stack[index].ns[prefix];
  }
  return undefined;
}
function identifier(value) {
  if (!/^-?\d+$/.test(value ?? "") || !Number.isSafeInteger(Number(value)) || Math.abs(Number(value)) > 2147483647) fail();
  return String(Number(value));
}

// Decode incrementally, including legal UTF-16 XML, without replacement text.
// Saxes resolves namespace URIs, rejects malformed XML and never fetches DTDs.
function xml(buffer, handlers) {
  if (!buffer) fail();
  let encoding = "utf-8";
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0x3c && buffer[1] === 0)) encoding = "utf-16le";
  if ((buffer[0] === 0xfe && buffer[1] === 0xff) || (buffer[0] === 0 && buffer[1] === 0x3c)) encoding = "utf-16be";
  const decoder = new TextDecoder(encoding, { fatal: true });
  const parser = new SaxesParser({ xmlns: true }); const stack = [];
  parser.on("error", () => fail());
  parser.on("doctype", () => fail());
  parser.on("xmldecl", (declaration) => {
    const declared = declaration.encoding?.toLowerCase();
    if (declared && !(declared === encoding || (declared === "utf-16" && encoding.startsWith("utf-16")))) fail();
  });
  parser.on("opentag", (tag) => {
    if (stack.length >= 256) fail("extraction_limit");
    stack.push(tag); handlers.open?.(tag, stack);
  });
  parser.on("text", (value) => handlers.text?.(value, stack));
  parser.on("cdata", (value) => handlers.text?.(value, stack));
  parser.on("closetag", (tag) => { handlers.close?.(tag, stack); stack.pop(); });
  for (let offset = 0; offset < buffer.length; offset += 65536) parser.write(decoder.decode(buffer.subarray(offset, offset + 65536), { stream: true }));
  parser.write(decoder.decode()).close();
}

function targetPath(source, target) {
  if (typeof target !== "string" || !target || /[\x00-\x20\\?#:]/.test(target) || /%(?:2f|5c)/i.test(target)) fail();
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { fail(); }
  if (/[\x00-\x1f\\?#:]/.test(decoded) || decoded.length > 1024) fail();
  const segments = decoded.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if (!segments.length) fail(); segments.pop(); }
    else segments.push(segment);
  }
  if (!segments.length) fail();
  return segments.join("/");
}

export function extractWordText(parts, out) {
  const relationshipCache = new Map(); const partCache = new Map();
  const warnings = new Set(); const contentTypes = new Map(); const defaultTypes = new Map();
  let parsedTextBytes = 0;
  xml(parts.get("[Content_Types].xml"), { open(tag, stack) {
    if (stack.length === 1 && (tag.uri !== contentTypeNamespace || tag.local !== "Types")) fail();
    if (stack.length !== 2 || tag.uri !== contentTypeNamespace) return;
    if (tag.local === "Override") {
      const path = targetPath("", attr(tag, "PartName")); const type = attr(tag, "ContentType");
      if (!type || contentTypes.has(path)) fail(); contentTypes.set(path, type);
    } else if (tag.local === "Default") {
      const extension = attr(tag, "Extension"); const type = attr(tag, "ContentType");
      if (!extension || !type || defaultTypes.has(extension)) fail(); defaultTypes.set(extension, type);
    }
  } });
  function relationships(source) {
    if (relationshipCache.has(source)) return relationshipCache.get(source);
    const path = source ? posix.join(posix.dirname(source), "_rels", posix.basename(source) + ".rels") : "_rels/.rels";
    const result = new Map(); relationshipCache.set(source, result);
    if (!parts.has(path)) { if (!source) fail(); return result; }
    xml(parts.get(path), { open(tag, stack) {
      if (stack.length === 1 && (tag.uri !== packageNamespace || tag.local !== "Relationships")) fail();
      if (stack.length !== 2 || tag.uri !== packageNamespace || tag.local !== "Relationship") return;
      const id = attr(tag, "Id"); const type = attr(tag, "Type"); const target = attr(tag, "Target"); const mode = attr(tag, "TargetMode");
      if (!id || !type || !target || result.has(id) || (mode && mode !== "Internal" && mode !== "External")) fail();
      result.set(id, { type, target, external: mode === "External" });
    } });
    return result;
  }
  function isRelationship(relation, kind) {
    return relation && [...relationshipNamespaces].some((namespace) => relation.type === `${namespace}/${kind}`);
  }
  function related(source, kind, id, required = true) {
    const candidates = id === undefined ? [...relationships(source).values()].filter((relation) => isRelationship(relation, kind)) : [relationships(source).get(id)];
    if (!required && candidates.length === 0) return undefined;
    if (candidates.length !== 1 || !isRelationship(candidates[0], kind) || candidates[0].external) fail();
    const path = targetPath(source, candidates[0].target);
    if (!parts.has(path)) fail();
    const contentType = contentTypes.get(path) ?? defaultTypes.get(posix.extname(path).slice(1));
    const suffix = kind === "officeDocument" ? "document.main+xml" : `${kind}+xml`;
    if (contentType !== `application/vnd.openxmlformats-officedocument.wordprocessingml.${suffix}`) fail();
    return path;
  }
  const mainPath = related("", "officeDocument");

  function readPart(path, kind) {
    if (partCache.has(path)) {
      const cached = partCache.get(path); if (cached.kind !== kind) fail(); return cached;
    }
    const result = { kind, stories: new Map() }; partCache.set(path, result);
    let story; let storyDepth = 0; let bodyCount = 0;
    function begin(id, depth, type = "normal") {
      if (story || result.stories.has(id)) fail();
      story = { chunks: [], refs: [], headers: [], generated: false, commentIds: new Set(), type }; storyDepth = depth;
      result.stories.set(id, story);
    }
    function add(value, generated = false) {
      if (!story || !value) return;
      parsedTextBytes += Buffer.byteLength(value);
      if (parsedTextBytes > ATTACHMENT_EXTRACTION_MAX_BYTES) fail("extraction_limit");
      story.chunks.push(value); story.generated = generated;
    }
    function removeSeparator(value) {
      if (story.generated && story.chunks.at(-1) === value) { story.chunks.pop(); story.generated = false; }
    }
    const states = [];
    xml(parts.get(path), {
      open(tag, stack) {
        const depth = stack.length; const parent = states.at(-1);
        const state = { active: parent?.active ?? true, text: false, alternate: undefined };
        states.push(state);
        if (depth === 1 && (!wordNamespaces.has(tag.uri) || tag.local !== roots[kind])) fail();
        if (tag.uri === compatibilityNamespace && tag.local === "AlternateContent") state.alternate = { chosen: false };
        if (tag.uri === compatibilityNamespace && (tag.local === "Choice" || tag.local === "Fallback")) {
          const alternate = parent?.alternate; if (!alternate) fail();
          const requires = (attr(tag, "Requires") ?? "").split(/\s+/).filter(Boolean);
          const supported = tag.local === "Fallback" || (requires.length > 0 && requires.every((prefix) => wordNamespaces.has(namespaceAt(prefix, stack))));
          state.active = state.active && !alternate.chosen && supported;
          if (state.active) alternate.chosen = true;
        }
        if (!state.active) return;
        if (wordNamespaces.has(tag.uri) && ["rPr", "pPrChange", "sectPrChange", "del", "moveFrom"].includes(tag.local)) {
          if (tag.local === "del" || tag.local === "moveFrom") warnings.add("Tracked deletions and move-from text are excluded; inserted/current stored text is read without accepting or executing document changes.");
          state.active = false; return;
        }
        if (kind === "body" && isWord(tag, "body") && depth === 2) { if (++bodyCount !== 1) fail(); begin("body", depth); }
        else if ((kind === "header" || kind === "footer") && depth === 1) begin(kind, depth);
        else if (["footnote", "endnote", "comment"].includes(kind) && depth === 2) {
          if (!isWord(tag, kind)) fail();
          const id = identifier(wordAttr(tag, "id")); const type = wordAttr(tag, "type");
          if (type && type !== "normal") {
            if (!["separator", "continuationSeparator", "continuationNotice"].includes(type) || kind === "comment") fail();
          }
          begin(id, depth, type);
        }
        if (!story) return;
        if (isWord(tag, "t")) state.text = true;
        // Paragraph tab-stop definitions are properties, not content tabs.
        if (isWord(tag, "tab") && isWord(stack.at(-2) ?? {}, "r")) add("\t");
        if (isWord(tag, "br") || isWord(tag, "cr")) add("\n");
        if (isWord(tag, "noBreakHyphen")) add("\u2011");
        if (isWord(tag, "softHyphen")) add("\u00ad");
        if (isWord(tag, "headerReference") || isWord(tag, "footerReference")) {
          const id = attr(tag, "id", relationshipNamespaces); if (!id) fail();
          story.headers.push({ kind: tag.local === "headerReference" ? "header" : "footer", id });
        }
        for (const refKind of ["footnote", "endnote", "comment"]) {
          if (isWord(tag, `${refKind}Reference`) || (refKind === "comment" && (isWord(tag, "commentRangeStart") || isWord(tag, "commentRangeEnd")))) {
            const id = identifier(wordAttr(tag, "id"));
            if (refKind === "comment" && story.commentIds.has(id)) break;
            if (refKind === "comment") story.commentIds.add(id);
            story.refs.push({ kind: refKind, id }); add(`[${kinds[refKind]} ${id}]`); break;
          }
        }
        if (wordNamespaces.has(tag.uri) && ["fldChar", "fldSimple", "instrText"].includes(tag.local)) warnings.add("Field instructions are not executed or updated; only their stored display text is read.");
        if (wordNamespaces.has(tag.uri) && ["altChunk", "sym", "object"].includes(tag.local)) warnings.add("Embedded/linked objects, alternate imported content and font-specific symbol glyphs are not interpreted.");
        if (tag.uri.includes("/officeDocument/2006/math") || tag.uri.includes("/ooxml/officeDocument/math")) warnings.add("Equation markup is not interpreted as mathematical text.");
      },
      text(value) { const state = states.at(-1); if (state?.active && state.text) add(value); },
      close(tag, stack) {
        const state = states.pop();
        if (state.alternate && !state.alternate.chosen) warnings.add("An unsupported alternate-content branch has no readable fallback and is omitted.");
        if (!state.active || !story) return;
        if (isWord(tag, "p")) add("\n", true);
        if (isWord(tag, "tc")) { removeSeparator("\n"); add("\t", true); }
        if (isWord(tag, "tr")) { removeSeparator("\t"); add("\n", true); }
        if (stack.length === storyDepth) { story.text = story.chunks.join(""); delete story.chunks; delete story.commentIds; story = undefined; }
      }
    });
    if (kind === "body" && bodyCount !== 1) fail();
    return result;
  }
  const pendingHeaders = []; const pendingNotes = []; const emitted = new Set();
  function emit(path, kind, id, qualification = "") {
    const key = `${kind}\0${path}\0${id}`; if (emitted.has(key)) return;
    emitted.add(key);
    const story = readPart(path, kind).stories.get(id); if (!story) fail();
    const label = kind === "body" ? "Main body" : `${kinds[kind]}${["header", "footer"].includes(kind) ? "" : ` ${id}`}${qualification}`;
    out.add(`[${label}: ${path}]\n`); out.add(story.text); out.add("\n");
    for (const ref of story.headers) pendingHeaders.push({ path: related(path, ref.kind, ref.id), kind: ref.kind });
    for (const ref of story.refs) pendingNotes.push(ref);
  }
  emit(mainPath, "body", "body");
  for (let index = 0; index < pendingHeaders.length; index++) {
    const header = pendingHeaders[index]; emit(header.path, header.kind, header.kind);
  }
  // Retain related header/footer stories whose section anchor was removed too;
  // unlike arbitrary orphan ZIP entries, the document still relates these parts.
  for (const [id, relation] of relationships(mainPath)) {
    for (const kind of ["header", "footer"]) {
      if (isRelationship(relation, kind)) emit(related(mainPath, kind, id), kind, kind, " (unreferenced)");
    }
  }
  // A reachable notes/comments part is part of the document even when an entry
  // has lost its anchor. Keep its text, while labelling that association honestly.
  const noteParts = new Map(); const referenced = new Set();
  for (const kind of ["footnote", "endnote", "comment"]) {
    const path = related(mainPath, `${kind}s`, undefined, false);
    if (!path) continue;
    const part = readPart(path, kind); noteParts.set(kind, { path, part });
    for (const story of part.stories.values()) pendingNotes.push(...story.refs);
  }
  for (const note of pendingNotes) {
    const source = noteParts.get(note.kind);
    if (!source || !source.part.stories.has(note.id)) fail();
    referenced.add(`${note.kind}\0${note.id}`);
  }
  for (const [kind, source] of noteParts) {
    for (const [id, story] of source.part.stories) {
      if (story.type !== "normal" && !story.text.trim()) continue;
      const qualification = story.type !== "normal" ? ` (${story.type})` : referenced.has(`${kind}\0${id}`) ? "" : " (unreferenced)";
      emit(source.path, kind, id, qualification);
    }
  }
  return { text: out.finish(), warnings: [
    "Stored Word text includes the main body and related headers, footers, footnotes, endnotes and comments, including labelled unreferenced entries. Source labels identify package parts, not rendered pages; visual layout, embedded images and external linked files are not read.",
    ...warnings
  ] };
}
