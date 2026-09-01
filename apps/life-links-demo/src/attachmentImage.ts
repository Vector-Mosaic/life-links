import {
  ATTACHMENT_IMAGE_MAX_BASE64_CHARS, ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE, ATTACHMENT_IMAGE_MAX_PIXELS, ATTACHMENT_IMAGE_MAX_SOURCE_EDGE,
  ATTACHMENT_PDF_MAX_PAGES, ATTACHMENT_PDF_PIXELS_PER_POINT,
  MAX_LIFE_LINK_TOOL_OUTPUT_BYTES,
  type AttachmentImageReadOptions, type AttachmentImageResult
} from "@life-links/core";

const HASH = /^[a-f0-9]{64}$/;
const OFFICE_TYPES = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", ...OFFICE_TYPES, "video/mp4", "video/webm", "video/quicktime"];
const REASONS = ["unsupported_format", "unsupported_animation", "malformed", "decode_limit", "output_limit", "processing_timeout", "encrypted", "runtime_unavailable"];

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}
function invalid(): never { throw new Error("Invalid attachment image response."); }

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return length >= 8 ? { height: bytes[offset + 3] * 256 + bytes[offset + 4], width: bytes[offset + 5] * 256 + bytes[offset + 6] } : null;
    }
    offset += length;
  }
  return null;
}

/** Verify the derived transport, never claim that these bytes have been seen by a model. */
export function validateAttachmentImageEnvelope(
  value: unknown, mediaId: string, options: AttachmentImageReadOptions
): AttachmentImageResult {
  if (!exact(value, ["mediaId", "sourceRevision", "status", "reason", "source", "rendition", "warnings", "image"]) ||
      value.mediaId !== mediaId || typeof value.sourceRevision !== "string" || !HASH.test(value.sourceRevision) ||
      (options.mode !== "describe" && value.sourceRevision !== options.sourceRevision) ||
      !Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) invalid();
  // The only field exempt from the ordinary metadata cap is the bounded image data.
  const metadata = { ...value, image: value.image === null ? null : { mimeType: (value.image as Record<string, unknown>)?.mimeType } };
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_LIFE_LINK_TOOL_OUTPUT_BYTES) invalid();
  if (value.status === "unreadable") {
    if (!REASONS.includes(String(value.reason)) || value.image !== null || value.rendition !== null) invalid();
  } else if (!["described", "bytes_ready"].includes(String(value.status)) || value.reason !== null) invalid();
  if (value.source !== null) {
    const source = value.source;
    const pdf = typeof source === "object" && source !== null && (source as Record<string, unknown>).mimeType === "application/pdf";
    const office = typeof source === "object" && source !== null && OFFICE_TYPES.includes(String((source as Record<string, unknown>).mimeType));
    const video = typeof source === "object" && source !== null && String((source as Record<string, unknown>).mimeType).startsWith("video/");
    const animation = typeof source === "object" && source !== null && Object.hasOwn(source, "animation");
    if (!exact(source, ["mimeType", "sizeBytes", "width", "height", "orientation", "frameCount", ...(pdf ? ["pdf"] : office ? ["office"] : video ? ["video"] : animation ? ["animation"] : [])]) ||
        typeof source.mimeType !== "string" || !integer(source.sizeBytes, 1) ||
        !integer(source.width, 1) || !integer(source.height, 1) ||
        !integer(source.orientation, 1, 8) || !integer(source.frameCount, 1)) invalid();
    if (value.status !== "unreadable" && (!MIME_TYPES.includes(source.mimeType) ||
        source.width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || source.height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
        source.width * source.height > ATTACHMENT_IMAGE_MAX_PIXELS || (animation ? source.frameCount > 512 : source.frameCount !== 1))) invalid();
    if (pdf || office) {
      const page = pdf ? source.pdf : source.office;
      if (!exact(page, ["pageNumber", "pageCount", "rotation", "pixelsPerPoint", ...(office ? ["format", "conversionProfile"] : [])]) ||
          !integer(page.pageCount, 1, ATTACHMENT_PDF_MAX_PAGES) ||
          !integer(page.pageNumber, 1, page.pageCount) || page.pageNumber !== (options.page ?? 1) ||
          !integer(page.rotation, 0, 270) || ![0, 90, 180, 270].includes(page.rotation) ||
          page.pixelsPerPoint !== ATTACHMENT_PDF_PIXELS_PER_POINT || source.orientation !== 1 ||
          options.frame !== undefined || options.atMs !== undefined ||
          (office && (page.conversionProfile !== "cached-print-v1" || page.format !== (source.mimeType === OFFICE_TYPES[0] ? "docx" : "xlsx")))) invalid();
    } else if (options.page !== undefined) invalid();
    if (video) {
      const temporal = source.video;
      if (!exact(temporal, ["streamIndex", "durationMs", "requestedTimeMs", "frameTimeMs", "framePts", "timeBase", "hasAudio"]) ||
          !integer(temporal.streamIndex, 0, 7) || typeof temporal.durationMs !== "number" || !Number.isFinite(temporal.durationMs) || temporal.durationMs <= 0 || temporal.durationMs > 300000 ||
          !integer(temporal.requestedTimeMs, 0, temporal.durationMs) || temporal.requestedTimeMs !== (options.atMs ?? 0) ||
          typeof temporal.frameTimeMs !== "number" || !Number.isFinite(temporal.frameTimeMs) || temporal.frameTimeMs < 0 || temporal.frameTimeMs > temporal.durationMs ||
          typeof temporal.framePts !== "string" || !/^-?\d+$/.test(temporal.framePts) ||
          typeof temporal.timeBase !== "string" || !/^[1-9]\d*\/[1-9]\d*$/.test(temporal.timeBase) ||
          typeof temporal.hasAudio !== "boolean" || source.orientation !== 1 || options.frame !== undefined) invalid();
    } else if (options.atMs !== undefined) invalid();
    if (animation) {
      const temporal = source.animation;
      if (!exact(temporal, ["frameNumber", "frameCount", "startMs", "durationMs", "loopCount"]) ||
          !integer(temporal.frameCount, 1, 512) || temporal.frameCount !== source.frameCount ||
          !integer(temporal.frameNumber, 1, temporal.frameCount) || temporal.frameNumber !== (options.frame ?? 1) ||
          typeof temporal.startMs !== "number" || !Number.isFinite(temporal.startMs) || temporal.startMs < 0 ||
          typeof temporal.durationMs !== "number" || !Number.isFinite(temporal.durationMs) || temporal.durationMs < 0 ||
          (temporal.loopCount !== null && !integer(temporal.loopCount, 0)) || source.orientation !== 1) invalid();
    } else if (options.frame !== undefined) invalid();
  } else if (value.status !== "unreadable") invalid();
  if (value.status === "unreadable") return value as AttachmentImageResult;
  if (options.mode === "describe") {
    if (value.status !== "described" || value.image !== null || value.rendition !== null) invalid();
    return value as AttachmentImageResult;
  }
  if (value.status !== "bytes_ready") invalid();
  const rendition = value.rendition;
  const image = value.image;
  if (!exact(rendition, ["mimeType", "sizeBytes", "sha256", "width", "height", "region", "encoding", "quality", "processorVersion"]) ||
      !exact(image, ["mimeType", "data"]) ||
      !["image/png", "image/jpeg"].includes(String(rendition.mimeType)) || image.mimeType !== rendition.mimeType ||
      rendition.encoding !== (rendition.mimeType === "image/png" ? "png" : "jpeg") ||
      (options.encoding !== undefined && options.encoding !== rendition.encoding) ||
      (rendition.encoding === "png" ? rendition.quality !== null : !integer(rendition.quality, 1, 100)) ||
      typeof rendition.processorVersion !== "string" || !rendition.processorVersion.length ||
      typeof rendition.sha256 !== "string" || !HASH.test(rendition.sha256) ||
      !integer(rendition.width, 1, options.maxEdge ?? ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE) ||
      !integer(rendition.height, 1, options.maxEdge ?? ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE) ||
      !integer(rendition.sizeBytes, 1, ATTACHMENT_IMAGE_MAX_BYTES) ||
      typeof image.data !== "string" || image.data.length > ATTACHMENT_IMAGE_MAX_BASE64_CHARS ||
      image.data.length !== Math.ceil(rendition.sizeBytes / 3) * 4) invalid();
  // Avoid a repeated-group regexp over multi-megabyte input (which can exhaust the JS stack).
  const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
  if (/[^A-Za-z0-9+/]/.test(image.data.slice(0, image.data.length - padding))) invalid();
  const region = rendition.region;
  const source = value.source as NonNullable<AttachmentImageResult["source"]>;
  if (!exact(region, ["x", "y", "width", "height"]) || !integer(region.x, 0) || !integer(region.y, 0) ||
      !integer(region.width, 1) || !integer(region.height, 1) ||
      region.x + region.width > source.width || region.y + region.height > source.height ||
      rendition.width > region.width || rendition.height > region.height) invalid();
  const expectedRegion = options.mode === "crop" ? options.region : { x: 0, y: 0, width: source.width, height: source.height };
  if (region.x !== expectedRegion.x || region.y !== expectedRegion.y ||
      region.width !== expectedRegion.width || region.height !== expectedRegion.height) invalid();
  const decoded = atob(image.data);
  if (decoded.length !== rendition.sizeBytes || btoa(decoded) !== image.data) invalid();
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (image.mimeType === "image/png" ? !png : !jpeg) invalid();
  if (png) {
    const header = new DataView(bytes.buffer);
    if (header.getUint32(12) !== 0x49484452 || header.getUint32(16) !== rendition.width || header.getUint32(20) !== rendition.height) invalid();
  } else {
    const dimensions = jpegDimensions(bytes);
    if (!dimensions || dimensions.width !== rendition.width || dimensions.height !== rendition.height) invalid();
  }
  return value as AttachmentImageResult;
}

/** Async identity verification belongs inside the controller's guarded API await. */
export async function validateAttachmentImageResult(
  value: unknown, mediaId: string, options: AttachmentImageReadOptions
): Promise<AttachmentImageResult> {
  const result = validateAttachmentImageEnvelope(value, mediaId, options);
  if (result.image !== null && result.rendition !== null) {
    const bytes = Uint8Array.from(atob(result.image.data), (character) => character.charCodeAt(0));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== result.rendition.sha256) invalid();
  }
  return result;
}
