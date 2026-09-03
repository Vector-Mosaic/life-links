import type { LifeLinkBrowsingRole, LifeLinkContext, PublicFieldKey } from "./fieldLedger.js";
import { normalizeLifeLinkBrowsingRole, normalizeLifeLinkContext, normalizePublicFieldKeys } from "./fieldLedger.js";
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./limits.js";

export * from "./fieldLedger.js";
export * from "./changeHistory.js";
export * from "./recordSearch.js";
export { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./limits.js";

export type PrivacyStatus = "public" | "private";
export type LinkStatus = "unclaimed" | "claimed";
export type LinkMediaKind = "image" | "video" | "document";

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type QrRecord = {
  id: string;
  url: string;
  status: LinkStatus;
  batchId: string | null;
  createdAt: string;
  claimedAt: string | null;
};

export type LinkRecord = {
  id: string;
  url: string;
  status: LinkStatus;
  ownerId: string | null;
  title: string;
  body: string;
  bodyDoc?: LinkBodyDoc | null;
  bodyDocVersion?: number | null;
  context?: LifeLinkContext;
  privacy: PrivacyStatus;
  media: LinkMediaRecord[];
  createdAt: string;
  updatedAt: string;
};

export type LinkMediaRecord = {
  id: string;
  qrId: string;
  ownerId: string | null;
  kind: LinkMediaKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};

export type ExportBatchRecord = {
  id: string;
  batchKey: string;
  qrBaseUrl: string;
  count: number;
  createdBy: string;
  createdAt: string;
};

export type ClaimResult = "claimed" | "already_owned" | "owned_by_other" | "not_found";

export type QrViewState =
  | { state: "not_found"; qrId: string }
  | { state: "unclaimed"; qr: LinkRecord }
  | { state: "private"; qrId: string }
  | { state: "claimed"; link: LinkRecord; viewerIsOwner: boolean };

export type DemoSeedData = {
  users: Array<UserRecord & { password: string }>;
  roots: LifeLinkRecord[];
  links: Array<LinkRecord & { parentId: string | null }>;
};

export type LinkBodyInlineSegment =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string };

export type LinkBodyBlock =
  | { kind: "paragraph"; children: LinkBodyInlineSegment[] }
  | { kind: "unordered-list"; items: LinkBodyInlineSegment[][] }
  | { kind: "ordered-list"; items: LinkBodyInlineSegment[][] }
  | { kind: "checklist"; items: Array<{ checked: boolean; children: LinkBodyInlineSegment[] }> };

export type LinkBodyDocMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type LinkBodyDocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: LinkBodyDocNode[];
  marks?: LinkBodyDocMark[];
  text?: string;
};

export type LinkBodyDoc = {
  type: "doc";
  content?: LinkBodyDocNode[];
};

export const DEFAULT_QR_BASE_URL = "http://127.0.0.1:3002";
export const DEMO_OWNER_ID = "demo-owner";
export const DEMO_GUEST_ID = "demo-guest";
export const DEMO_PASSWORD = "local-demo-password-not-for-deployment";
export const LINK_BODY_DOC_VERSION = 1;
export const MAX_BATCH_COUNT = 10000;
export const MAX_BODY_DOC_BYTES = 128 * 1024;
export const MAX_QR_ID_LENGTH = 128;
export const MAX_SCAN_TEXT_LENGTH = 2048;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_MEDIA_PER_LINK = 8;
export const QR_RANDOM_SUFFIX_LENGTH = 16;

export type GenerateQrIdsOptions = {
  suffixFactory?: (index: number) => string;
};

const QR_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeBatchCount(value: number | string, max = MAX_BATCH_COUNT): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(max, Math.max(1, parsed));
}

export function createBatchKey(now = new Date(), randomValue = Math.random()): string {
  const stamp = now.getTime().toString(36).toUpperCase();
  const random = Math.floor(randomValue * 1679616)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0")
    .slice(0, 4);
  return `${stamp}${random}`;
}

export function generateQrIds(count: number, batchKey = createBatchKey(), options: GenerateQrIdsOptions = {}): string[] {
  const safeCount = normalizeBatchCount(count);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < safeCount; index += 1) {
    let id = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = normalizeQrIdPart(options.suffixFactory?.(index) ?? createRandomQrSuffix());
      id = `LL-${normalizeQrIdPart(batchKey)}-${suffix}`;
      if (!seen.has(id)) {
        break;
      }
    }
    if (!id || seen.has(id)) {
      throw new Error("Unable to generate unique QR IDs");
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function generateSequentialQrIds(count: number, batchKey = createBatchKey()): string[] {
  return generateQrIds(count, batchKey, {
    suffixFactory: (index) => (index + 1).toString(36).toUpperCase().padStart(5, "0")
  });
}

export function createRandomQrSuffix(length = QR_RANDOM_SUFFIX_LENGTH): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => QR_SUFFIX_ALPHABET[byte % QR_SUFFIX_ALPHABET.length]).join("");
}

export function buildQrUrl(baseUrl: string, qrId: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_QR_BASE_URL;
  return `${cleanBase}/qr/${encodeURIComponent(qrId)}`;
}

export function parseQrId(scanText: string): string | null {
  const value = scanText.trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/qr\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return value.startsWith("LL-") ? value : null;
  }
}

export function isValidQrId(qrId: string): boolean {
  return qrId.length > 0 && qrId.length <= MAX_QR_ID_LENGTH && /^LL-[A-Z0-9][A-Z0-9-]*$/i.test(qrId);
}

export function parseLinkBodyBlocks(body: string): LinkBodyBlock[] {
  const blocks: LinkBodyBlock[] = [];
  const paragraphLines: string[] = [];
  let activeList: LinkBodyBlock | null = null;

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }
    blocks.push({
      kind: "paragraph",
      children: parseLinkBodyInlineSegments(paragraphLines.join("\n"))
    });
    paragraphLines.length = 0;
  }

  function flushList() {
    if (activeList) {
      blocks.push(activeList);
      activeList = null;
    }
  }

  function appendUnorderedListItem(text: string) {
    if (!activeList || activeList.kind !== "unordered-list") {
      flushList();
      activeList = { kind: "unordered-list", items: [] };
    }
    activeList.items.push(parseLinkBodyInlineSegments(text));
  }

  function appendOrderedListItem(text: string) {
    if (!activeList || activeList.kind !== "ordered-list") {
      flushList();
      activeList = { kind: "ordered-list", items: [] };
    }
    activeList.items.push(parseLinkBodyInlineSegments(text));
  }

  function appendChecklistItem(checked: boolean, text: string) {
    if (!activeList || activeList.kind !== "checklist") {
      flushList();
      activeList = { kind: "checklist", items: [] };
    }
    activeList.items.push({ checked, children: parseLinkBodyInlineSegments(text) });
  }

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const checklistMatch = rawLine.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checklistMatch) {
      flushParagraph();
      appendChecklistItem(checklistMatch[1].toLowerCase() === "x", checklistMatch[2]);
      continue;
    }

    const unorderedMatch = rawLine.match(/^\s*[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      appendUnorderedListItem(unorderedMatch[1]);
      continue;
    }

    const orderedMatch = rawLine.match(/^\s*\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      appendOrderedListItem(orderedMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(rawLine);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function parseLinkBodyInlineSegments(text: string): LinkBodyInlineSegment[] {
  const segments: LinkBodyInlineSegment[] = [];
  const tokenPattern = /(\*\*[^*]+?\*\*|_[^_]+?_)/g;
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, index) });
    }
    if (token.startsWith("**")) {
      segments.push({ kind: "bold", text: token.slice(2, -2) });
    } else {
      segments.push({ kind: "italic", text: token.slice(1, -1) });
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments.length ? segments : [{ kind: "text", text }];
}

export function createLinkBodyDocFromPlainText(body: string): LinkBodyDoc {
  const blocks = parseLinkBodyBlocks(body);
  return {
    type: "doc",
    content: blocks.map((block) => {
      if (block.kind === "unordered-list") {
        return {
          type: "bulletList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: linkBodyInlineSegmentsToDocNodes(item) }]
          }))
        };
      }
      if (block.kind === "ordered-list") {
        return {
          type: "orderedList",
          content: block.items.map((item) => ({
            type: "listItem",
            content: [{ type: "paragraph", content: linkBodyInlineSegmentsToDocNodes(item) }]
          }))
        };
      }
      if (block.kind === "checklist") {
        return {
          type: "taskList",
          content: block.items.map((item) => ({
            type: "taskItem",
            attrs: { checked: item.checked },
            content: [{ type: "paragraph", content: linkBodyInlineSegmentsToDocNodes(item.children) }]
          }))
        };
      }
      return { type: "paragraph", content: linkBodyInlineSegmentsToDocNodes(block.children) };
    })
  };
}

export function normalizeLinkBodyDoc(input: unknown): LinkBodyDoc | null {
  if (!isPlainRecord(input) || input.type !== "doc") {
    return null;
  }
  const content = normalizeDocNodeContent(input.content, 0);
  return content.length ? { type: "doc", content } : { type: "doc" };
}

export function normalizeLinkBodyHref(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const href = value.trim();
  if (!href || /\s/.test(href)) {
    return "";
  }
  if (/^https?:\/\//i.test(href)) {
    try {
      const parsed = new URL(href);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? href : "";
    } catch {
      return "";
    }
  }
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(href)) {
    return href;
  }
  if (/^tel:[+0-9().-]{3,32}$/i.test(href)) {
    return href;
  }
  if (/^\/(?!\/|\\)/.test(href) || href.startsWith("#")) {
    return href;
  }
  return "";
}

export function extractPlainTextFromLinkBodyDoc(input: unknown): string {
  const doc = normalizeLinkBodyDoc(input);
  if (!doc?.content?.length) {
    return "";
  }
  return doc.content
    .map((node) => docBlockToPlainText(node))
    .filter((text) => text.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function createUnclaimedLinks(ids: string[], baseUrl: string, now = new Date().toISOString()): LinkRecord[] {
  return ids.map((id) => ({
    id,
    url: buildQrUrl(baseUrl, id),
    status: "unclaimed",
    ownerId: null,
    title: "",
    body: "",
    bodyDoc: createLinkBodyDocFromPlainText(""),
    bodyDocVersion: LINK_BODY_DOC_VERSION,
    privacy: "public",
    media: [],
    createdAt: now,
    updatedAt: now
  }));
}

export function createDemoSeedData(now = new Date().toISOString(), baseUrl = DEFAULT_QR_BASE_URL): DemoSeedData {
  const users: DemoSeedData["users"] = [
    {
      id: DEMO_OWNER_ID,
      email: "owner@life-links.test",
      displayName: "Demo Owner",
      password: DEMO_PASSWORD,
      createdAt: now
    },
    {
      id: DEMO_GUEST_ID,
      email: "guest@life-links.test",
      displayName: "Demo Guest",
      password: DEMO_PASSWORD,
      createdAt: now
    }
  ];

  const roots = [
    { id: "project-home", title: "Home archive" },
    { id: "project-studio", title: "Studio gear" },
    { id: "project-inventory", title: "Inventory shelf" }
  ].map(({ id, title }) => createCanonicalLifeLink({
    id, title, ownerId: DEMO_OWNER_ID, browsingRole: "container", createdAt: now
  }));

  const ids = generateSequentialQrIds(18, "DEMO");
  const unclaimed = createUnclaimedLinks(ids.slice(9), baseUrl, now);
  const claimed = createUnclaimedLinks(ids.slice(0, 9), baseUrl, now).map((link, index) => ({
    ...link,
    status: "claimed" as const,
    ownerId: DEMO_OWNER_ID,
    title: [
      "Passport lockbox",
      "Camera battery kit",
      "Router reset notes",
      "Sourdough starter",
      "Tax folder 2025",
      "Tool drawer bits",
      "Guest Wi-Fi card",
      "Spare key envelope",
      "Blue storage bin"
    ][index],
    body: [
      "Fireproof box, top shelf. Code hint is in the password manager.",
      "Two batteries, charger, USB-C cable, and the short lens adapter.",
      "Hold reset for 12 seconds. ISP account number is stored in admin notes.",
      "Feed equal parts starter, water, and flour after it doubles.",
      "W-2s, 1099s, receipts, and signed return copy.",
      "Driver bits are in the left tray. Specialty bits are in the labeled bag.",
      "Network name and guest password for visitors.",
      "Envelope taped under the back-right desk drawer.",
      "Holiday lights, extension cords, and outdoor timers."
    ][index],
    bodyDoc: createLinkBodyDocFromPlainText(
      [
        "Fireproof box, top shelf. Code hint is in the password manager.",
        "Two batteries, charger, USB-C cable, and the short lens adapter.",
        "Hold reset for 12 seconds. ISP account number is stored in admin notes.",
        "Feed equal parts starter, water, and flour after it doubles.",
        "W-2s, 1099s, receipts, and signed return copy.",
        "Driver bits are in the left tray. Specialty bits are in the labeled bag.",
        "Network name and guest password for visitors.",
        "Envelope taped under the back-right desk drawer.",
        "Holiday lights, extension cords, and outdoor timers."
      ][index]
    ),
    bodyDocVersion: LINK_BODY_DOC_VERSION,
    parentId: [roots[0].id, roots[1].id, roots[0].id, roots[0].id, roots[2].id][index % 5] ?? null,
    privacy: (index === 0 || index === 4 || index === 7 ? "private" : "public") as PrivacyStatus,
    updatedAt: now
  }));

  return {
    users,
    roots,
    links: [...claimed, ...unclaimed.map((link) => ({ ...link, parentId: null }))]
  };
}

export function linksToCsv(links: LinkRecord[]): string {
  const rows = [
    ["qr_id", "url", "status", "owner_id", "title", "privacy"],
    ...links.map((link) => [
      link.id,
      link.url,
      link.status,
      link.ownerId ?? "",
      link.title,
      link.privacy
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  const safeValue = escapeCsvFormula(value);
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function linkBodyInlineSegmentsToDocNodes(segments: LinkBodyInlineSegment[]): LinkBodyDocNode[] {
  const nodes: LinkBodyDocNode[] = [];
  for (const segment of segments) {
    const marks =
      segment.kind === "bold"
        ? [{ type: "bold" }]
        : segment.kind === "italic"
          ? [{ type: "italic" }]
          : undefined;
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        nodes.push({ type: "hardBreak" });
      }
      if (part) {
        nodes.push({ type: "text", text: part, ...(marks ? { marks } : {}) });
      }
    });
  }
  return nodes;
}

function normalizeDocNodeContent(input: unknown, depth: number): LinkBodyDocNode[] {
  if (!Array.isArray(input) || depth > 16) {
    return [];
  }
  return input.map((item) => normalizeDocNode(item, depth)).filter((item): item is LinkBodyDocNode => Boolean(item));
}

function normalizeDocNode(input: unknown, depth: number): LinkBodyDocNode | null {
  if (!isPlainRecord(input) || typeof input.type !== "string" || !/^[A-Za-z][\w-]{0,79}$/.test(input.type)) {
    return null;
  }
  const node: LinkBodyDocNode = { type: input.type };
  if (typeof input.text === "string") {
    node.text = input.text;
  }
  const attrs = cloneJsonRecord(input.attrs);
  if (attrs) {
    node.attrs = attrs;
  }
  if (Array.isArray(input.marks)) {
    const marks = input.marks.map(normalizeDocMark).filter((item): item is LinkBodyDocMark => Boolean(item));
    if (marks.length) {
      node.marks = marks;
    }
  }
  const content = normalizeDocNodeContent(input.content, depth + 1);
  if (content.length) {
    node.content = content;
  }
  return node;
}

function normalizeDocMark(input: unknown): LinkBodyDocMark | null {
  if (!isPlainRecord(input) || typeof input.type !== "string" || !/^[A-Za-z][\w-]{0,79}$/.test(input.type)) {
    return null;
  }
  const attrs = cloneJsonRecord(input.attrs);
  if (input.type === "link") {
    const href = normalizeLinkBodyHref(attrs?.href);
    return href ? { type: "link", attrs: { ...(attrs ?? {}), href } } : null;
  }
  return attrs ? { type: input.type, attrs } : { type: input.type };
}

function cloneJsonRecord(input: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(input)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, 32)) {
    if (/^[A-Za-z][\w-]{0,79}$/.test(key)) {
      output[key] = cloneJsonValue(value, 0);
    }
  }
  return Object.keys(output).length ? output : undefined;
}

function cloneJsonValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && depth < 4) {
    return value.slice(0, 32).map((item) => cloneJsonValue(item, depth + 1));
  }
  if (isPlainRecord(value) && depth < 4) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 32)) {
      output[key] = cloneJsonValue(item, depth + 1);
    }
    return output;
  }
  return null;
}

function docBlockToPlainText(node: LinkBodyDocNode): string {
  if (node.type === "bulletList") {
    return (node.content ?? [])
      .filter((item) => item.type === "listItem")
      .map((item) => `- ${inlineDocText(item).trim()}`)
      .join("\n");
  }
  if (node.type === "orderedList") {
    return (node.content ?? [])
      .filter((item) => item.type === "listItem")
      .map((item, index) => `${index + 1}. ${inlineDocText(item).trim()}`)
      .join("\n");
  }
  if (node.type === "taskList") {
    return (node.content ?? [])
      .filter((item) => item.type === "taskItem")
      .map((item) => `- [${item.attrs?.checked ? "x" : " "}] ${inlineDocText(item).trim()}`)
      .join("\n");
  }
  if (node.type === "horizontalRule") {
    return "---";
  }
  return inlineDocText(node).trimEnd();
}

function inlineDocText(node: LinkBodyDocNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (node.type === "paragraph" || node.type === "heading" || node.type === "blockquote" || node.type === "listItem" || node.type === "taskItem") {
    return (node.content ?? []).map(inlineDocText).join("");
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => (isBlockNode(child) ? docBlockToPlainText(child) : inlineDocText(child))).join("\n");
}

function isBlockNode(node: LinkBodyDocNode): boolean {
  return ["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "horizontalRule"].includes(node.type);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function escapeCsvFormula(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function normalizeQrIdPart(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "QR";
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// Canonical recursive Life Link contract. QR-keyed LinkRecord and
// QrRecord, and QrViewState exports above remain compatibility/public DTOs.

export const LEGACY_LIFE_LINK_ID_PREFIX = "legacy-life-link:";
export const DEFAULT_LIFE_LINK_TITLE = "Untitled link";
export const DEFAULT_LIFE_LINK_PRIVACY: PrivacyStatus = "private";
export const DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT = 25;
export const MAX_LIFE_LINK_CHILD_PAGE_LIMIT = 100;
export const DEFAULT_LIFE_LINK_SEARCH_LIMIT = 25;
export const MAX_LIFE_LINK_SEARCH_LIMIT = 100;
export const MAX_LIFE_LINK_TOOL_SEARCH_RESULTS = 10;
export const MAX_LIFE_LINK_PATH_ITEMS = 12;
export const MAX_LIFE_LINK_BODY_SUMMARY_LENGTH = 240;
export const MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT = 8;
export const MAX_LIFE_LINK_TOOL_OUTPUT_BYTES = 2048;

export type QrInventoryRecord = Omit<QrRecord, "status" | "claimedAt">;

export type LifeLinkMediaRecord = Omit<LinkMediaRecord, "qrId" | "ownerId"> & {
  lifeLinkId: string;
  ownerId: string;
};

export type LifeLinkRecord = {
  id: string;
  ownerId: string;
  parentId: string | null;
  qrId: string | null;
  title: string;
  body: string;
  bodyDoc: LinkBodyDoc;
  bodyDocVersion: number;
  privacy: PrivacyStatus;
  browsingRole: LifeLinkBrowsingRole;
  context: LifeLinkContext;
  placementConfirmedAt: string | null;
  publicFieldKeys: PublicFieldKey[];
  media: LifeLinkMediaRecord[];
  createdAt: string;
  updatedAt: string;
};

export type LifeLinkSummary = Pick<
  LifeLinkRecord,
  "id" | "parentId" | "qrId" | "title" | "privacy" | "updatedAt" | "browsingRole"
> & {
  childCount: number;
};

export type BoundedLifeLinkItems<T> = {
  items: T[];
  truncated: boolean;
  omittedCount: number;
};

export type LifeLinkPhysicalLocator = {
  lifeLinkId: string;
  title: string;
  qrId: string;
  relation: "ancestor" | "self";
};

export type LifeLinkDetail = {
  lifeLink: LifeLinkRecord;
  ancestry: BoundedLifeLinkItems<LifeLinkSummary>;
  children: LifeLinkSummary[];
  childrenPage: {
    nextCursor: string | null;
    truncated: boolean;
  };
};

export type LifeLinkQrBindingRecord = {
  qrId: string;
  lifeLinkId: string;
  boundAt: string;
};

export type LifeLinkSearchMatchClass =
  | "all"
  | "exact_qr"
  | "exact_title"
  | "title_prefix"
  | "title"
  | "recorded_path"
  | "body"
  | "context";

export type LifeLinkSearchItem = {
  lifeLink: LifeLinkSummary;
  path: BoundedLifeLinkItems<LifeLinkSummary>;
  bodySummary: string;
  matchClass: LifeLinkSearchMatchClass;
};

export type LifeLinkSearchResult = {
  items: LifeLinkSearchItem[];
  totalCount: number;
  truncated: boolean;
  hasMore: boolean;
  nextCursor: string | null;
};

export type LifeLinkPageRequest = {
  cursor?: string | null;
  limit?: number | string;
};

export type LifeLinkPage<T> = {
  items: T[];
  nextCursor: string | null;
  truncated: boolean;
};

export type CreateLifeLinkInput = {
  parentId?: string | null;
  title?: string;
  body?: string;
  bodyDoc?: LinkBodyDoc | null;
  bodyDocVersion?: number | null;
  privacy?: PrivacyStatus;
  browsingRole?: LifeLinkBrowsingRole;
  context?: LifeLinkContext;
  publicFieldKeys?: PublicFieldKey[];
};

export type CreateLifeLinkCommand = CreateLifeLinkInput & {
  id: string;
  ownerId: string;
  createdAt: string;
};

export type UpdateLifeLinkPatch = Partial<
  Pick<LifeLinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "context" | "publicFieldKeys">
>;

export type UpdateLifeLinkCommand = {
  lifeLinkId: string;
  patch: UpdateLifeLinkPatch;
  expectedUpdatedAt: string;
};

export type MoveLifeLinkCommand = {
  lifeLinkId: string;
  parentId: string | null;
  expectedUpdatedAt: string;
};

export type ClaimQrCommand =
  | { commandId: string; mode?: "create" }
  | { commandId: string; mode: "attach"; lifeLinkId: string };

export const LIFE_LINK_DOMAIN_ERROR_CODES = [
  "life_link_not_found",
  "invalid_life_link",
  "duplicate_life_link_id",
  "invalid_parent",
  "hierarchy_cycle",
  "stale_life_link",
  "qr_already_bound",
  "qr_not_found",
  "life_link_already_tagged",
  "invalid_collection",
  "collection_not_found",
  "stale_collection",
  "duplicate_collection_id",
  "section_not_found",
  "invalid_section",
  "duplicate_section_id",
  "collection_membership_not_found",
  "invalid_routine",
  "routine_not_found",
  "stale_routine",
  "routine_conflict",
  "routine_reference_conflict",
  "output_limit_exceeded"
] as const;

export type LifeLinkDomainErrorCode = (typeof LIFE_LINK_DOMAIN_ERROR_CODES)[number];

export type LifeLinkParentIssueReason =
  | "life_link_not_found"
  | "parent_not_found"
  | "self_parent"
  | "cross_owner"
  | "cycle";

export type LifeLinkParentValidation =
  | { ok: true }
  | {
      ok: false;
      code: "life_link_not_found" | "invalid_parent" | "hierarchy_cycle";
      reason: LifeLinkParentIssueReason;
    };

export class LifeLinkDomainError extends Error {
  readonly code: LifeLinkDomainErrorCode;
  readonly retryable: boolean;
  readonly reason?: string;

  constructor(code: LifeLinkDomainErrorCode, message: string, options: { retryable?: boolean; reason?: string } = {}) {
    super(message);
    this.name = "LifeLinkDomainError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.reason = options.reason;
  }
}

export function normalizeLifeLinkChildPageLimit(value: number | string | undefined): number {
  return normalizeBoundedPositiveInteger(value, DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
}

export function normalizeLifeLinkSearchLimit(
  value: number | string | undefined,
  max = MAX_LIFE_LINK_SEARCH_LIMIT
): number {
  const requestedMax = Math.floor(max);
  const boundedMax = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(MAX_LIFE_LINK_SEARCH_LIMIT, requestedMax))
    : MAX_LIFE_LINK_SEARCH_LIMIT;
  return normalizeBoundedPositiveInteger(value, Math.min(DEFAULT_LIFE_LINK_SEARCH_LIMIT, boundedMax), boundedMax);
}

export function mapLegacyLinkToLifeLinkId(qrId: string): string {
  const value = qrId.trim();
  if (!isValidQrId(value)) {
    throw new LifeLinkDomainError("invalid_life_link", "Legacy Link QR identity is invalid.");
  }
  return `${LEGACY_LIFE_LINK_ID_PREFIX}${value}`;
}

export function createCanonicalLifeLink(command: CreateLifeLinkCommand): LifeLinkRecord {
  if (command.privacy !== undefined && command.privacy !== "private" && command.privacy !== "public") {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link privacy is invalid.", { reason: "invalid_privacy" });
  }
  const title = command.title ?? DEFAULT_LIFE_LINK_TITLE;
  const body = coordinateLifeLinkBody({
    body: command.body,
    bodyDoc: command.bodyDoc,
    bodyDocVersion: command.bodyDocVersion
  });
  assertLifeLinkContentWithinBounds(title, body.body, body.bodyDoc);
  return {
    id: requireLifeLinkIdentity(command.id),
    ownerId: requireOwnerIdentity(command.ownerId),
    parentId: command.parentId ?? null,
    qrId: null,
    title,
    body: body.body,
    bodyDoc: body.bodyDoc,
    bodyDocVersion: body.bodyDocVersion,
    privacy: command.privacy ?? DEFAULT_LIFE_LINK_PRIVACY,
    browsingRole: normalizeLifeLinkBrowsingRole(command.browsingRole ?? "item"),
    context: normalizeLifeLinkContext(command.context ?? { schemaVersion: 1 }),
    placementConfirmedAt: command.parentId ? command.createdAt : null,
    publicFieldKeys: normalizePublicFieldKeys(command.publicFieldKeys ?? []),
    media: [],
    createdAt: command.createdAt,
    updatedAt: command.createdAt
  };
}

export function coordinateLifeLinkBody(input: {
  body?: string;
  bodyDoc?: LinkBodyDoc | null;
  bodyDocVersion?: number | null;
}): Pick<LifeLinkRecord, "body" | "bodyDoc" | "bodyDocVersion"> {
  const bodyDocVersion = input.bodyDocVersion ?? LINK_BODY_DOC_VERSION;
  if (!Number.isInteger(bodyDocVersion) || bodyDocVersion < 1) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link body document version is invalid.", {
      reason: "invalid_body_doc_version"
    });
  }
  if (input.bodyDoc !== undefined && input.bodyDoc !== null) {
    const bodyDoc = normalizeLinkBodyDoc(input.bodyDoc);
    if (!bodyDoc) {
      throw new LifeLinkDomainError("invalid_life_link", "Life Link body document is invalid.", {
        reason: "invalid_body_doc"
      });
    }
    return {
      body: extractPlainTextFromLinkBodyDoc(bodyDoc),
      bodyDoc,
      bodyDocVersion
    };
  }
  const body = input.body ?? "";
  return {
    body,
    bodyDoc: createLinkBodyDocFromPlainText(body),
    bodyDocVersion
  };
}

export function assertLifeLinkBodyPatchIsCoordinated(input: {
  body?: string;
  bodyDoc?: LinkBodyDoc | null;
  bodyDocVersion?: number | null;
}): void {
  if (input.bodyDocVersion !== undefined && input.body === undefined && input.bodyDoc === undefined) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link body document version requires body content.", {
      reason: "body_doc_version_without_content"
    });
  }
}

export function assertLifeLinkMediaBytes(sizeBytes: number, actualBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0 || sizeBytes !== actualBytes) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link media byte length does not match its recorded size.", {
      reason: "media_size_mismatch"
    });
  }
  if (sizeBytes > MAX_MEDIA_BYTES) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link media exceeds the supported byte limit.", {
      reason: "media_too_large"
    });
  }
}

export function assertLifeLinkContentWithinBounds(title: string, body: string, bodyDoc: LinkBodyDoc): void {
  if (title.length > MAX_TITLE_LENGTH) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link title exceeds the supported limit.", {
      reason: "title_too_long"
    });
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link body exceeds the supported limit.", {
      reason: "body_too_long"
    });
  }
  if (jsonUtf8ByteLength(bodyDoc) > MAX_BODY_DOC_BYTES) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link body document exceeds the supported limit.", {
      reason: "body_doc_too_large"
    });
  }
}

export function validateLifeLinkParentPlacement(
  lifeLinks: readonly LifeLinkRecord[],
  lifeLinkId: string,
  parentId: string | null
): LifeLinkParentValidation {
  const byId = indexLifeLinksById(lifeLinks);
  const lifeLink = byId.get(lifeLinkId);
  if (!lifeLink) {
    return { ok: false, code: "life_link_not_found", reason: "life_link_not_found" };
  }
  if (parentId === null) {
    return { ok: true };
  }
  if (parentId === lifeLink.id) {
    return { ok: false, code: "invalid_parent", reason: "self_parent" };
  }
  let current = byId.get(parentId);
  if (!current) {
    return { ok: false, code: "invalid_parent", reason: "parent_not_found" };
  }
  const visited = new Set<string>();
  while (current) {
    if (current.ownerId !== lifeLink.ownerId) {
      return { ok: false, code: "invalid_parent", reason: "cross_owner" };
    }
    if (current.id === lifeLink.id || visited.has(current.id)) {
      return { ok: false, code: "hierarchy_cycle", reason: "cycle" };
    }
    visited.add(current.id);
    if (!current.parentId) {
      return { ok: true };
    }
    const next = byId.get(current.parentId);
    if (!next) {
      return { ok: false, code: "invalid_parent", reason: "parent_not_found" };
    }
    current = next;
  }
  return { ok: true };
}

export function assertValidLifeLinkParentPlacement(
  lifeLinks: readonly LifeLinkRecord[],
  lifeLinkId: string,
  parentId: string | null
): void {
  const result = validateLifeLinkParentPlacement(lifeLinks, lifeLinkId, parentId);
  if (result.ok) {
    return;
  }
  const message =
    result.code === "hierarchy_cycle"
      ? "Life Link placement would create a hierarchy cycle."
      : result.code === "life_link_not_found"
        ? "Life Link was not found."
        : "Life Link parent placement is invalid.";
  throw new LifeLinkDomainError(result.code, message, { reason: result.reason });
}

export function summarizeLifeLink(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return {
    id: lifeLink.id,
    parentId: lifeLink.parentId,
    qrId: lifeLink.qrId,
    title: lifeLink.title,
    privacy: lifeLink.privacy,
    updatedAt: lifeLink.updatedAt,
    browsingRole: lifeLink.browsingRole,
    childCount
  };
}

export function deriveLifeLinkPath(
  lifeLinks: readonly LifeLinkRecord[],
  lifeLinkId: string,
  maxItems = MAX_LIFE_LINK_PATH_ITEMS
): BoundedLifeLinkItems<LifeLinkSummary> {
  const byId = indexLifeLinksById(lifeLinks);
  const childCounts = countLifeLinkChildren(lifeLinks);
  const fullPath = deriveFullLifeLinkPath(byId, lifeLinkId).map((lifeLink) =>
    summarizeLifeLink(lifeLink, childCounts.get(lifeLink.id) ?? 0)
  );
  return boundLifeLinkPath(fullPath, maxItems);
}

/**
 * Derives the QR-bound physical return point from an existing root-to-subject
 * path projection. A nested subject resolves to its nearest QR-bound ancestor;
 * its own QR is only a fallback when the complete path proves that no ancestor
 * is QR-bound.
 *
 * A truncated path retains the root plus the nearest contiguous suffix. A QR
 * in that suffix is therefore still an exact nearest ancestor. When the suffix
 * has no QR, omitted ancestors make both a farther visible ancestor and a self
 * fallback uncertain, so the safe bounded result is null.
 */
export function deriveLifeLinkPhysicalLocator(
  path: BoundedLifeLinkItems<LifeLinkSummary>
): LifeLinkPhysicalLocator | null {
  if (!path.items.length) {
    return null;
  }

  const subjectIndex = path.items.length - 1;
  const nearestSuffixStart = path.truncated ? 1 : 0;
  for (let index = subjectIndex - 1; index >= nearestSuffixStart; index -= 1) {
    const candidate = path.items[index];
    if (candidate.qrId) {
      return {
        lifeLinkId: candidate.id,
        title: candidate.title,
        qrId: candidate.qrId,
        relation: "ancestor"
      };
    }
  }

  if (path.truncated) {
    return null;
  }

  const subject = path.items[subjectIndex];
  return subject.qrId
    ? {
        lifeLinkId: subject.id,
        title: subject.title,
        qrId: subject.qrId,
        relation: "self"
      }
    : null;
}

export function formatRecordedLifeLinkPath(path: BoundedLifeLinkItems<LifeLinkSummary>): string {
  if (!path.items.length) {
    return "";
  }
  if (!path.truncated || path.items.length === 1) {
    return path.items.map((item) => item.title).join(" > ");
  }
  return [path.items[0].title, "...", ...path.items.slice(1).map((item) => item.title)].join(" > ");
}

export function listLifeLinkChildren(
  lifeLinks: readonly LifeLinkRecord[],
  ownerId: string,
  parentId: string | null,
  limit?: number | string
): BoundedLifeLinkItems<LifeLinkSummary> {
  const safeLimit = normalizeLifeLinkChildPageLimit(limit);
  const childCounts = countLifeLinkChildren(lifeLinks);
  const matches = lifeLinks
    .filter((lifeLink) => lifeLink.ownerId === ownerId && lifeLink.parentId === parentId)
    .sort(compareLifeLinkTreeOrder);
  const items = matches.slice(0, safeLimit).map((lifeLink) => summarizeLifeLink(lifeLink, childCounts.get(lifeLink.id) ?? 0));
  return {
    items,
    truncated: matches.length > items.length,
    omittedCount: Math.max(0, matches.length - items.length)
  };
}

export function pageLifeLinkChildren(
  lifeLinks: readonly LifeLinkRecord[],
  ownerId: string,
  parentId: string | null,
  page: LifeLinkPageRequest = {}
): LifeLinkPage<LifeLinkSummary> {
  const childCounts = countLifeLinkChildren(lifeLinks);
  const cursor = page.cursor ? decodeLifeLinkTreeCursor(page.cursor) : null;
  const limit = normalizeLifeLinkChildPageLimit(page.limit);
  const matches = lifeLinks
    .filter((lifeLink) => lifeLink.ownerId === ownerId && lifeLink.parentId === parentId)
    .sort(compareLifeLinkTreeOrder)
    .filter((lifeLink) => !cursor || compareLifeLinkTreeTuple(lifeLink, cursor) > 0);
  const selected = matches.slice(0, limit);
  const hasMore = matches.length > selected.length;
  return {
    items: selected.map((lifeLink) => summarizeLifeLink(lifeLink, childCounts.get(lifeLink.id) ?? 0)),
    nextCursor: hasMore && selected.length ? encodeLifeLinkTreeCursor(selected[selected.length - 1]) : null,
    truncated: hasMore
  };
}

export function searchCanonicalLifeLinks(
  lifeLinks: readonly LifeLinkRecord[],
  ownerId: string,
  query: string,
  options: { cursor?: string | null; limit?: number | string; maxLimit?: number } = {}
): LifeLinkSearchResult {
  const byId = indexLifeLinksById(lifeLinks);
  const childCounts = countLifeLinkChildren(lifeLinks);
  const needle = normalizeLifeLinkSearchText(query);
  const matches: Array<LifeLinkSearchItem & { fullPath: LifeLinkRecord[] }> = [];
  for (const lifeLink of lifeLinks) {
    if (lifeLink.ownerId !== ownerId) {
      continue;
    }
    const fullPath = deriveFullLifeLinkPath(byId, lifeLink.id);
    const matchClass = classifyLifeLinkSearchMatch(lifeLink, fullPath, needle);
    if (!matchClass) {
      continue;
    }
    matches.push({
      lifeLink: summarizeLifeLink(lifeLink, childCounts.get(lifeLink.id) ?? 0),
      path: boundLifeLinkPath(
        fullPath.map((item) => summarizeLifeLink(item, childCounts.get(item.id) ?? 0)),
        MAX_LIFE_LINK_PATH_ITEMS
      ),
      bodySummary: summarizeLifeLinkBody(matchClass === "context"
        ? [lifeLink.context.summary, lifeLink.context.condition, lifeLink.context.experience, lifeLink.context.plan]
          .find((value) => value && normalizeLifeLinkSearchText(value.text).includes(needle))?.text ?? lifeLink.body
        : lifeLink.body),
      matchClass,
      fullPath
    });
  }
  matches.sort((left, right) => {
    const matchOrder = lifeLinkSearchMatchRank(left.matchClass) - lifeLinkSearchMatchRank(right.matchClass);
    if (matchOrder !== 0) {
      return matchOrder;
    }
    const titleOrder = compareCanonicalText(
      normalizeLifeLinkSearchText(left.lifeLink.title),
      normalizeLifeLinkSearchText(right.lifeLink.title)
    );
    if (titleOrder !== 0) {
      return titleOrder;
    }
    const updatedOrder = compareCanonicalText(right.lifeLink.updatedAt, left.lifeLink.updatedAt);
    return updatedOrder || compareCanonicalText(left.lifeLink.id, right.lifeLink.id);
  });
  const cursor = options.cursor ? decodeLifeLinkSearchCursor(options.cursor) : null;
  const pagedMatches = cursor
    ? matches.filter((item) => compareLifeLinkSearchTuple(item, cursor) > 0)
    : matches;
  const limit = normalizeLifeLinkSearchLimit(options.limit, options.maxLimit ?? MAX_LIFE_LINK_SEARCH_LIMIT);
  const selected = pagedMatches.slice(0, limit);
  const items = selected.map(({ fullPath: _fullPath, ...item }) => item);
  const hasMore = pagedMatches.length > selected.length;
  return {
    items,
    totalCount: matches.length,
    truncated: hasMore,
    hasMore,
    nextCursor: hasMore && selected.length ? encodeLifeLinkSearchCursor(selected[selected.length - 1]) : null
  };
}

export function summarizeLifeLinkBody(body: string, maxLength = MAX_LIFE_LINK_BODY_SUMMARY_LENGTH): string {
  const requestedMax = Math.floor(maxLength);
  const safeMax = Number.isFinite(requestedMax) ? Math.max(0, requestedMax) : MAX_LIFE_LINK_BODY_SUMMARY_LENGTH;
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= safeMax) {
    return normalized;
  }
  if (safeMax <= 3) {
    return ".".repeat(safeMax);
  }
  return `${normalized.slice(0, safeMax - 3).trimEnd()}...`;
}

export function boundLifeLinkSourceReferences(
  lifeLinkIds: readonly string[],
  max = MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT
): BoundedLifeLinkItems<string> {
  const requestedMax = Math.floor(max);
  const safeMax = Number.isFinite(requestedMax)
    ? Math.max(0, Math.min(MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT, requestedMax))
    : MAX_LIFE_LINK_SOURCE_REFERENCE_COUNT;
  const unique = Array.from(new Set(lifeLinkIds.filter((id) => id.trim().length > 0)));
  const items = unique.slice(0, safeMax);
  return {
    items,
    truncated: unique.length > items.length,
    omittedCount: Math.max(0, unique.length - items.length)
  };
}

export function assertLifeLinkToolOutputWithinBounds(value: unknown): void {
  if (jsonUtf8ByteLength(value) > MAX_LIFE_LINK_TOOL_OUTPUT_BYTES) {
    throw new LifeLinkDomainError("output_limit_exceeded", "Life Link tool output exceeds the supported limit.");
  }
}

export function projectLifeLinkAsLink(
  lifeLink: LifeLinkRecord,
  qr: Pick<QrInventoryRecord, "id" | "url">
): LinkRecord {
  if (lifeLink.qrId !== qr.id) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link and QR compatibility projection do not match.", {
      reason: "qr_binding_mismatch"
    });
  }
  return {
    id: qr.id,
    url: qr.url,
    status: "claimed",
    ownerId: lifeLink.ownerId,
    title: lifeLink.title,
    body: lifeLink.body,
    bodyDoc: lifeLink.bodyDoc,
    bodyDocVersion: lifeLink.bodyDocVersion,
    context: structuredClone(lifeLink.context),
    privacy: lifeLink.privacy,
    media: lifeLink.media.map(({ lifeLinkId: _lifeLinkId, ...media }) => ({ ...media, qrId: qr.id })),
    createdAt: lifeLink.createdAt,
    updatedAt: lifeLink.updatedAt
  };
}

export function projectUnclaimedQrAsLink(qr: Pick<QrInventoryRecord, "id" | "url" | "createdAt">): LinkRecord {
  return {
    id: qr.id,
    url: qr.url,
    status: "unclaimed",
    ownerId: null,
    title: "",
    body: "",
    bodyDoc: createLinkBodyDocFromPlainText(""),
    bodyDocVersion: LINK_BODY_DOC_VERSION,
    privacy: "public",
    media: [],
    createdAt: qr.createdAt,
    updatedAt: qr.createdAt
  };
}

export function projectPrivateClaimedQrAsLink(qr: Pick<QrInventoryRecord, "id" | "url" | "createdAt">): LinkRecord {
  return {
    ...projectUnclaimedQrAsLink(qr),
    status: "claimed",
    privacy: "private"
  };
}

export function redactNonOwnerLinkProjection(link: LinkRecord): LinkRecord {
  return {
    ...link,
    ownerId: null,
    media: []
  };
}

/** One public content projection shared by QR resolution, export, and owner preview. */
export function projectPublicLifeLinkAsLink(lifeLink: LifeLinkRecord, qr: Pick<QrInventoryRecord, "id" | "url" | "createdAt">): LinkRecord {
  if (lifeLink.privacy !== "public") {
    return projectPrivateClaimedQrAsLink(qr);
  }
  const projection = redactNonOwnerLinkProjection(projectLifeLinkAsLink(lifeLink, qr));
  const context: LifeLinkContext = { schemaVersion: 1 };
  for (const key of lifeLink.publicFieldKeys) {
    if (key !== "notes" && lifeLink.context[key]) {
      context[key] = { ...lifeLink.context[key]! };
    }
  }
  return {
    ...projection,
    body: lifeLink.publicFieldKeys.includes("notes") ? projection.body : "",
    bodyDoc: lifeLink.publicFieldKeys.includes("notes") ? projection.bodyDoc : createLinkBodyDocFromPlainText(""),
    context
  };
}

export function projectQrInventoryRecord(
  qr: QrInventoryRecord,
  binding: LifeLinkQrBindingRecord | null
): QrRecord {
  if (binding && binding.qrId !== qr.id) {
    throw new LifeLinkDomainError("invalid_life_link", "QR compatibility projection binding does not match inventory.", {
      reason: "qr_binding_mismatch"
    });
  }
  return {
    ...qr,
    status: binding ? "claimed" : "unclaimed",
    claimedAt: binding?.boundAt ?? null
  };
}

function normalizeBoundedPositiveInteger(value: number | string | undefined, fallback: number, max: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

function requireLifeLinkIdentity(value: string): string {
  const id = value.trim();
  if (!id) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link identity must not be empty.");
  }
  return id;
}

function requireOwnerIdentity(value: string): string {
  const id = value.trim();
  if (!id) {
    throw new LifeLinkDomainError("invalid_life_link", "Life Link owner identity must not be empty.", {
      reason: "missing_owner"
    });
  }
  return id;
}

function indexLifeLinksById(lifeLinks: readonly LifeLinkRecord[]): Map<string, LifeLinkRecord> {
  const byId = new Map<string, LifeLinkRecord>();
  for (const lifeLink of lifeLinks) {
    if (byId.has(lifeLink.id)) {
      throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identities must be unique.");
    }
    byId.set(lifeLink.id, lifeLink);
  }
  return byId;
}

function deriveFullLifeLinkPath(byId: ReadonlyMap<string, LifeLinkRecord>, lifeLinkId: string): LifeLinkRecord[] {
  const path: LifeLinkRecord[] = [];
  const visited = new Set<string>();
  let current = byId.get(lifeLinkId);
  if (!current) {
    throw new LifeLinkDomainError("life_link_not_found", "Life Link was not found.");
  }
  const ownerId = current.ownerId;
  while (current) {
    if (visited.has(current.id)) {
      throw new LifeLinkDomainError("hierarchy_cycle", "Life Link hierarchy contains a cycle.");
    }
    if (current.ownerId !== ownerId) {
      throw new LifeLinkDomainError("invalid_parent", "Life Link hierarchy crosses owners.", { reason: "cross_owner" });
    }
    visited.add(current.id);
    path.push(current);
    if (!current.parentId) {
      break;
    }
    const parentId = current.parentId;
    current = byId.get(parentId);
    if (!current) {
      throw new LifeLinkDomainError("invalid_parent", "Life Link hierarchy references a missing parent.", {
        reason: "parent_not_found"
      });
    }
  }
  return path.reverse();
}

function countLifeLinkChildren(lifeLinks: readonly LifeLinkRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const lifeLink of lifeLinks) {
    if (lifeLink.parentId) {
      counts.set(lifeLink.parentId, (counts.get(lifeLink.parentId) ?? 0) + 1);
    }
  }
  return counts;
}

function boundLifeLinkPath(
  fullPath: readonly LifeLinkSummary[],
  maxItems: number
): BoundedLifeLinkItems<LifeLinkSummary> {
  const safeMax = Math.max(1, Math.floor(maxItems));
  if (fullPath.length <= safeMax) {
    return { items: [...fullPath], truncated: false, omittedCount: 0 };
  }
  const items = safeMax === 1 ? [fullPath[fullPath.length - 1]] : [fullPath[0], ...fullPath.slice(-(safeMax - 1))];
  return {
    items,
    truncated: true,
    omittedCount: fullPath.length - items.length
  };
}

function compareLifeLinkTreeOrder(left: LifeLinkRecord, right: LifeLinkRecord): number {
  const titleOrder = compareCanonicalText(
    normalizeLifeLinkSearchText(left.title),
    normalizeLifeLinkSearchText(right.title)
  );
  return titleOrder || compareCanonicalText(left.createdAt, right.createdAt) || compareCanonicalText(left.id, right.id);
}

type LifeLinkTreeCursorTuple = {
  normalizedTitle: string;
  createdAt: string;
  id: string;
};

type LifeLinkSearchCursorTuple = {
  matchRank: number;
  normalizedTitle: string;
  updatedAt: string;
  id: string;
};

function compareLifeLinkTreeTuple(lifeLink: LifeLinkRecord, cursor: LifeLinkTreeCursorTuple): number {
  return (
    compareCanonicalText(normalizeLifeLinkSearchText(lifeLink.title), cursor.normalizedTitle) ||
    compareCanonicalText(lifeLink.createdAt, cursor.createdAt) ||
    compareCanonicalText(lifeLink.id, cursor.id)
  );
}

function encodeLifeLinkTreeCursor(lifeLink: LifeLinkRecord): string {
  return encodeOpaqueLifeLinkCursor("tree", {
    normalizedTitle: normalizeLifeLinkSearchText(lifeLink.title),
    createdAt: lifeLink.createdAt,
    id: lifeLink.id
  });
}

function decodeLifeLinkTreeCursor(cursor: string): LifeLinkTreeCursorTuple {
  const value = decodeOpaqueLifeLinkCursor(cursor, "tree");
  if (
    typeof value.normalizedTitle !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string"
  ) {
    throw invalidLifeLinkCursor();
  }
  return {
    normalizedTitle: value.normalizedTitle,
    createdAt: value.createdAt,
    id: value.id
  };
}

function classifyLifeLinkSearchMatch(
  lifeLink: LifeLinkRecord,
  fullPath: readonly LifeLinkRecord[],
  needle: string
): LifeLinkSearchMatchClass | null {
  if (!needle) {
    return "all";
  }
  if (lifeLink.qrId && normalizeLifeLinkSearchText(lifeLink.qrId) === needle) {
    return "exact_qr";
  }
  const title = normalizeLifeLinkSearchText(lifeLink.title);
  if (title === needle) {
    return "exact_title";
  }
  if (title.startsWith(needle)) {
    return "title_prefix";
  }
  if (title.includes(needle)) {
    return "title";
  }
  const path = normalizeLifeLinkSearchText(fullPath.map((item) => item.title).join(" > "));
  if (path.includes(needle)) {
    return "recorded_path";
  }
  if (normalizeLifeLinkSearchText(lifeLink.body).includes(needle)) {
    return "body";
  }
  if ([lifeLink.context.summary, lifeLink.context.condition, lifeLink.context.experience, lifeLink.context.plan]
    .some((value) => value && normalizeLifeLinkSearchText(value.text).includes(needle))) {
    return "context";
  }
  return null;
}

function lifeLinkSearchMatchRank(matchClass: LifeLinkSearchMatchClass): number {
  return ["exact_qr", "exact_title", "title_prefix", "title", "recorded_path", "body", "context", "all"].indexOf(matchClass);
}

function compareLifeLinkSearchTuple(
  item: LifeLinkSearchItem,
  cursor: LifeLinkSearchCursorTuple
): number {
  return (
    lifeLinkSearchMatchRank(item.matchClass) - cursor.matchRank ||
    compareCanonicalText(normalizeLifeLinkSearchText(item.lifeLink.title), cursor.normalizedTitle) ||
    compareCanonicalText(cursor.updatedAt, item.lifeLink.updatedAt) ||
    compareCanonicalText(item.lifeLink.id, cursor.id)
  );
}

function encodeLifeLinkSearchCursor(item: LifeLinkSearchItem): string {
  return encodeOpaqueLifeLinkCursor("search", {
    matchRank: lifeLinkSearchMatchRank(item.matchClass),
    normalizedTitle: normalizeLifeLinkSearchText(item.lifeLink.title),
    updatedAt: item.lifeLink.updatedAt,
    id: item.lifeLink.id
  });
}

function decodeLifeLinkSearchCursor(cursor: string): LifeLinkSearchCursorTuple {
  const value = decodeOpaqueLifeLinkCursor(cursor, "search");
  if (
    typeof value.matchRank !== "number" ||
    !Number.isInteger(value.matchRank) ||
    value.matchRank < 0 ||
    value.matchRank > lifeLinkSearchMatchRank("all") ||
    typeof value.normalizedTitle !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.id !== "string"
  ) {
    throw invalidLifeLinkCursor();
  }
  return {
    matchRank: value.matchRank,
    normalizedTitle: value.normalizedTitle,
    updatedAt: value.updatedAt,
    id: value.id
  };
}

function normalizeLifeLinkSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function jsonUtf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function encodeOpaqueLifeLinkCursor(kind: "tree" | "search", value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, kind, ...value }));
  return `ll1.${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function decodeOpaqueLifeLinkCursor(cursor: string, expectedKind: "tree" | "search"): Record<string, unknown> {
  if (!cursor.startsWith("ll1.") || !/^[0-9a-f]+$/i.test(cursor.slice(4)) || cursor.slice(4).length % 2 !== 0) {
    throw invalidLifeLinkCursor();
  }
  try {
    const hex = cursor.slice(4);
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!isPlainRecord(value) || value.version !== 1 || value.kind !== expectedKind) {
      throw invalidLifeLinkCursor();
    }
    return value;
  } catch (error) {
    if (error instanceof LifeLinkDomainError) {
      throw error;
    }
    throw invalidLifeLinkCursor();
  }
}

function invalidLifeLinkCursor(): LifeLinkDomainError {
  return new LifeLinkDomainError("invalid_life_link", "Life Link cursor is invalid.", { reason: "invalid_cursor" });
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export * from "./competitionFixture.js";
export * from "./attachments.js";
export * from "./routines.js";
export * from "./calendar.js";
export * from "./calendar-connections.js";
