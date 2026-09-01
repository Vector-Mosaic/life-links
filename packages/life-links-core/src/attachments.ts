/** Attachment transport keeps the existing media identity and routes. */
export const ATTACHMENT_MIME_TYPES = {
  "image/jpeg": "image", "image/png": "image", "image/webp": "image", "image/gif": "image",
  "video/mp4": "video", "video/webm": "video", "video/quicktime": "video",
  "application/pdf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "text/plain": "document", "text/csv": "document", "text/markdown": "document", "application/json": "document"
} as const;
export const ATTACHMENT_FILE_ACCEPT = "image/*,video/*,.pdf,.docx,.xlsx,.txt,.csv,.md,.markdown,.json";
export const ATTACHMENT_FORMAT_LABEL = "Images, videos, PDF, DOCX, XLSX, TXT, CSV, Markdown, and JSON";
export type AttachmentFormat = "text" | "pdf" | "docx" | "xlsx" | "image" | "video";
export type AttachmentContentReason = "unsupported_media" | "scanned_or_no_text" | "encrypted" | "malformed" | "extraction_limit" | "extraction_timeout" | "runtime_unavailable" | "no_audio";
export type AttachmentContentReadOptions = { offset?: number; limit?: number; revision?: string;
  representation?: "transcript"; startMs?: number; durationMs?: number; audioStreamIndex?: number };
export type AttachmentTranscript = { startMs: number; endMs: number; sourceDurationMs: number; nextStartMs: number | null;
  audioStreamIndex: number; processorVersion: string; modelSha256: string };
export type AttachmentContentPage = {
  mediaId: string; revision: string; status: "ready" | "unreadable"; reason: AttachmentContentReason | null;
  format: AttachmentFormat; text: string; offset: number; nextOffset: number | null; totalChars: number; warnings: string[];
  transcript?: AttachmentTranscript;
};
export const ATTACHMENT_CONTENT_DEFAULT_LIMIT = 1000;
export const ATTACHMENT_CONTENT_MAX_LIMIT = 4000;
export const ATTACHMENT_EXTRACTION_MAX_BYTES = 8 * 1024 * 1024;

/** Images have a separate bounded transport payload; text tool budgets do not change. */
export const ATTACHMENT_IMAGE_MAX_PIXELS = 32_000_000;
export const ATTACHMENT_IMAGE_MAX_SOURCE_EDGE = 16_384;
export const ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE = 256;
export const ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE = 2048;
export const ATTACHMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENT_IMAGE_MAX_BASE64_CHARS = Math.ceil(ATTACHMENT_IMAGE_MAX_BYTES / 3) * 4;
export const ATTACHMENT_PDF_MAX_PAGES = 512;
export const ATTACHMENT_PDF_PIXELS_PER_POINT = 4;
export type AttachmentImageRegion = { x: number; y: number; width: number; height: number };
export type AttachmentImageEncoding = "png" | "jpeg";
export type AttachmentImageReadOptions = { page?: number; frame?: number; atMs?: number } & (
  | { mode: "describe" }
  | { mode: "overview"; sourceRevision: string; maxEdge?: number; encoding?: AttachmentImageEncoding }
  | { mode: "crop"; sourceRevision: string; region: AttachmentImageRegion; maxEdge?: number; encoding?: AttachmentImageEncoding });
export type AttachmentImageReason = "unsupported_format" | "unsupported_animation" | "malformed" |
  "decode_limit" | "output_limit" | "processing_timeout" | "encrypted" | "runtime_unavailable";
export type AttachmentImageResult = {
  mediaId: string;
  sourceRevision: string;
  status: "described" | "bytes_ready" | "unreadable";
  reason: AttachmentImageReason | null;
  source: { mimeType: string; sizeBytes: number; width: number; height: number; orientation: number; frameCount: number;
    /** PDF page pixels use a declared 288-DPI grid after page rotation. */
    pdf?: { pageNumber: number; pageCount: number; rotation: number; pixelsPerPoint: 4 };
    office?: { format: "docx" | "xlsx"; pageNumber: number; pageCount: number; rotation: number; pixelsPerPoint: 4; conversionProfile: "cached-print-v1" };
    video?: { streamIndex: number; durationMs: number; requestedTimeMs: number; frameTimeMs: number; framePts: string; timeBase: string; hasAudio: boolean };
    animation?: { frameNumber: number; frameCount: number; startMs: number; durationMs: number; loopCount: number | null } } | null;
  rendition: { mimeType: "image/png" | "image/jpeg"; sizeBytes: number; sha256: string;
    width: number; height: number; region: AttachmentImageRegion; encoding: AttachmentImageEncoding;
    quality: number | null; processorVersion: string } | null;
  warnings: string[];
  image: { mimeType: "image/png" | "image/jpeg"; data: string } | null;
};

export function attachmentFormat(mimeType: string): AttachmentFormat {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return "text";
}

/** Browser-provided generic MIME types need a known document extension; the
 * extractor still validates the actual document structure before reading it. */
export function resolveAttachmentMimeType(mimeType: string, fileName: string): keyof typeof ATTACHMENT_MIME_TYPES | null {
  const type = mimeType.toLowerCase().split(";")[0].trim();
  if (type === "application/vnd.ms-excel" && /\.csv$/i.test(fileName)) return "text/csv";
  if (type === "text/x-markdown" && /\.(md|markdown)$/i.test(fileName)) return "text/markdown";
  if (Object.hasOwn(ATTACHMENT_MIME_TYPES, type)) return type as keyof typeof ATTACHMENT_MIME_TYPES;
  if (!["", "application/octet-stream", "application/zip"].includes(type)) return null;
  const extension = fileName.toLowerCase().split(".").at(-1);
  const types: Record<string, keyof typeof ATTACHMENT_MIME_TYPES> = {
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain", csv: "text/csv",
    md: "text/markdown", markdown: "text/markdown", json: "application/json"
  };
  return types[extension ?? ""] ?? null;
}
