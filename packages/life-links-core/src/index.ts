export type PrivacyStatus = "public" | "private";
export type LinkStatus = "unclaimed" | "claimed";
export type LinkMediaKind = "image" | "video";

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type ProjectRecord = {
  id: string;
  ownerId: string;
  name: string;
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
  projectId: string | null;
  privacy: PrivacyStatus;
  media: LinkMediaRecord[];
  createdAt: string;
  updatedAt: string;
};

export type LinkMediaRecord = {
  id: string;
  qrId: string;
  ownerId: string;
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
  projects: ProjectRecord[];
  links: LinkRecord[];
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
export const MAX_TITLE_LENGTH = 120;
export const MAX_BODY_LENGTH = 4000;
export const MAX_BODY_DOC_BYTES = 128 * 1024;
export const MAX_PROJECT_NAME_LENGTH = 80;
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
    projectId: null,
    privacy: "public",
    media: [],
    createdAt: now,
    updatedAt: now
  }));
}

export function claimLink(
  links: LinkRecord[],
  qrId: string,
  userId: string,
  now = new Date().toISOString()
): { links: LinkRecord[]; result: ClaimResult } {
  let result: ClaimResult = "not_found";
  const nextLinks = links.map((link) => {
    if (link.id !== qrId) {
      return link;
    }
    if (link.ownerId === userId) {
      result = "already_owned";
      return link;
    }
    if (link.ownerId && link.ownerId !== userId) {
      result = "owned_by_other";
      return link;
    }
    result = "claimed";
    return {
      ...link,
      status: "claimed" as const,
      ownerId: userId,
      title: link.title || "Untitled link",
      updatedAt: now
    };
  });
  return { links: nextLinks, result };
}

export function updateLinkContent(
  links: LinkRecord[],
  qrId: string,
  patch: Pick<LinkRecord, "title" | "body" | "privacy" | "projectId"> &
    Partial<Pick<LinkRecord, "bodyDoc" | "bodyDocVersion">>,
  now = new Date().toISOString()
): LinkRecord[] {
  return links.map((link) =>
    link.id === qrId
      ? {
          ...link,
          ...patch,
          updatedAt: now
        }
      : link
  );
}

export function searchOwnedLinks(
  links: LinkRecord[],
  userId: string,
  query: string,
  projects: ProjectRecord[] = []
): LinkRecord[] {
  const needle = query.trim().toLowerCase();
  const projectNamesById = new Map(projects.map((project) => [project.id, project.name]));
  return links
    .filter((link) => link.ownerId === userId)
    .filter((link) => {
      if (!needle) {
        return true;
      }
      const projectName = link.projectId ? projectNamesById.get(link.projectId) ?? "" : "";
      return `${link.title} ${link.body} ${link.id} ${projectName}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

  const projects: ProjectRecord[] = [
    { id: "project-home", ownerId: DEMO_OWNER_ID, name: "Home archive", createdAt: now },
    { id: "project-studio", ownerId: DEMO_OWNER_ID, name: "Studio gear", createdAt: now },
    { id: "project-inventory", ownerId: DEMO_OWNER_ID, name: "Inventory shelf", createdAt: now }
  ];

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
    projectId: [projects[0].id, projects[1].id, projects[0].id, projects[0].id, projects[2].id][index % 5] ?? null,
    privacy: (index === 0 || index === 4 || index === 7 ? "private" : "public") as PrivacyStatus,
    updatedAt: now
  }));

  return {
    users,
    projects,
    links: [...claimed, ...unclaimed]
  };
}

export function linksToCsv(links: LinkRecord[]): string {
  const rows = [
    ["qr_id", "url", "status", "owner_id", "title", "project_id", "privacy"],
    ...links.map((link) => [
      link.id,
      link.url,
      link.status,
      link.ownerId ?? "",
      link.title,
      link.projectId ?? "",
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
