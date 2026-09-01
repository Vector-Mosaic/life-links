import { ATTACHMENT_EXTRACTION_MAX_BYTES, type AttachmentContentPage, type AttachmentContentReadOptions } from "@life-links/core";

const HASH = /^[a-f0-9]{64}$/;
const REASONS = ["unsupported_media", "scanned_or_no_text", "encrypted", "malformed", "extraction_limit", "extraction_timeout", "runtime_unavailable", "no_audio"];
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function invalid(): never { throw new Error("Invalid attachment transcript response."); }

/** One synchronous boundary for the selected ASR window and its text continuation.
 * Native/ASR fidelity is established upstream; this does not turn inferred speech into fact. */
export function validateAttachmentTranscript(
  value: unknown, mediaId: string, options: AttachmentContentReadOptions
): AttachmentContentPage {
  const hasTranscript = typeof value === "object" && value !== null && Object.hasOwn(value, "transcript");
  if (!exact(value, ["mediaId", "revision", "status", "reason", "format", "text", "offset", "nextOffset", "totalChars", "warnings", ...(hasTranscript ? ["transcript"] : [])]) ||
      value.mediaId !== mediaId || typeof value.revision !== "string" || !HASH.test(value.revision) ||
      (options.revision !== undefined && value.revision !== options.revision) ||
      !integer(value.totalChars, 0, ATTACHMENT_EXTRACTION_MAX_BYTES) ||
      !integer(value.offset, 0, value.totalChars) || value.offset !== (options.offset ?? 0) ||
      typeof value.text !== "string" || value.text.length > 4000 || value.offset + value.text.length > value.totalChars ||
      value.nextOffset !== (value.offset + value.text.length < value.totalChars ? value.offset + value.text.length : null) ||
      (value.nextOffset !== null && !value.text.length) ||
      !Array.isArray(value.warnings) || value.warnings.length > 8 ||
      value.warnings.some((warning) => typeof warning !== "string" || warning.length > 200)) invalid();
  if (value.status === "unreadable") {
    if (hasTranscript || !REASONS.includes(String(value.reason)) || value.text !== "" || value.totalChars !== 0 ||
        !["text", "pdf", "docx", "xlsx", "image", "video"].includes(String(value.format))) invalid();
    return value as AttachmentContentPage;
  }
  const transcript = value.transcript;
  if (value.status !== "ready" || value.reason !== null || value.format !== "video" ||
      !exact(transcript, ["startMs", "endMs", "sourceDurationMs", "nextStartMs", "audioStreamIndex", "processorVersion", "modelSha256"]) ||
      !integer(transcript.startMs, 0, 300000) || transcript.startMs !== (options.startMs ?? 0) ||
      typeof transcript.sourceDurationMs !== "number" || !Number.isFinite(transcript.sourceDurationMs) ||
      transcript.sourceDurationMs <= transcript.startMs || transcript.sourceDurationMs > 300000 ||
      transcript.endMs !== Math.min(transcript.sourceDurationMs, transcript.startMs + (options.durationMs ?? 30000)) ||
      transcript.nextStartMs !== (Number(transcript.endMs) < transcript.sourceDurationMs ? transcript.endMs : null) ||
      !integer(transcript.audioStreamIndex, 0, 7) ||
      (options.audioStreamIndex !== undefined && transcript.audioStreamIndex !== options.audioStreamIndex) ||
      typeof transcript.processorVersion !== "string" || !transcript.processorVersion.length || transcript.processorVersion.length > 200 ||
      typeof transcript.modelSha256 !== "string" || !HASH.test(transcript.modelSha256)) invalid();
  return value as AttachmentContentPage;
}
