import { createHash } from "node:crypto";
import {
  attachmentFormat, ATTACHMENT_CONTENT_DEFAULT_LIMIT, ATTACHMENT_CONTENT_MAX_LIMIT,
  ATTACHMENT_EXTRACTION_MAX_BYTES, MAX_MEDIA_BYTES, ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_IMAGE_MAX_BASE64_CHARS,
  ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE, ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE,
  ATTACHMENT_PDF_MAX_PAGES,
  type AttachmentContentPage, type AttachmentContentReadOptions, type AttachmentImageReadOptions, type AttachmentImageResult
} from "@life-links/core";
import type { LifeLinkMediaFile } from "./store.js";
import { attachmentRuntime, withAttachmentJob, AttachmentProcessingError, type AttachmentNativeRuntime, type AttachmentProcessingJob } from "./attachment-native-runtime.js";
import { prepareOfficePdf } from "./attachment-office.js";
import { isTemporalAttachment, prepareTemporalImage } from "./attachment-temporal.js";
import { transcribeVideoWindow } from "./attachment-speech.js";

type Extraction = Pick<AttachmentContentPage, "status" | "reason" | "text" | "warnings" | "transcript">;
const unreadable = (reason: AttachmentContentPage["reason"]): Extraction => ({ status: "unreadable", reason, text: "", warnings: [] });
type WaitingJob = { cost: number; start(): void; cancel(): void; signal?: AbortSignal };
export class AttachmentContentRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** Per-application bounded derived cache. The route rechecks live ownership and
 * loads canonical bytes on EVERY call, before any cache read or continuation. */
export class AttachmentContentReader {
  private active = 0;
  private waiting: WaitingJob[] = [];
  private cache = new Map<string, { lifeLinkId: string; mediaId: string; expiresAt: number; timer: NodeJS.Timeout; result: Extraction }>();
  constructor(private readonly timeoutMs = 15000, private readonly runtime: AttachmentNativeRuntime = attachmentRuntime()) {}

  invalidate(lifeLinkIds: string[], mediaId?: string): void {
    for (const [key, item] of this.cache) if ((!lifeLinkIds.length || lifeLinkIds.includes(item.lifeLinkId)) && (!mediaId || item.mediaId === mediaId)) this.removeCached(key);
  }

  private removeCached(key: string): void { clearTimeout(this.cache.get(key)?.timer); this.cache.delete(key); }

  async read(file: LifeLinkMediaFile, options: AttachmentContentReadOptions = {}, signal?: AbortSignal): Promise<AttachmentContentPage> {
    signal?.throwIfAborted();
    const offset = options.offset ?? 0; const limit = options.limit ?? ATTACHMENT_CONTENT_DEFAULT_LIMIT;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > ATTACHMENT_CONTENT_MAX_LIMIT ||
        (options.revision !== undefined && !/^[a-f0-9]{64}$/.test(options.revision))) throw new AttachmentContentRequestError(400, "invalid_attachment_content_page");
    const format = attachmentFormat(file.media.mimeType);
    const transcript = options.representation === "transcript";
    if ((options.representation !== undefined && !transcript) ||
        (!transcript && [options.startMs, options.durationMs, options.audioStreamIndex].some((value) => value !== undefined)))
      throw new AttachmentContentRequestError(400, "invalid_attachment_content_page");
    const startMs = options.startMs ?? 0; const durationMs = options.durationMs ?? 30000;
    if (transcript && (!Number.isSafeInteger(startMs) || startMs < 0 || startMs > 300000 ||
        !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 30000 ||
        (options.audioStreamIndex !== undefined && (!Number.isSafeInteger(options.audioStreamIndex) || options.audioStreamIndex < 0 || options.audioStreamIndex > 7))))
      throw new AttachmentContentRequestError(400, "invalid_audio_window");
    // DOCX v2 includes secondary stories and source labels. An old body-only
    // cursor must never continue into the new representation of the same file.
    const extractionVersion = transcript ? `life-links-transcript-v1/ffmpeg-9.0.1/pcm16k-mono\0${startMs}\0${durationMs}\0${options.audioStreamIndex ?? "first"}\0${this.runtime.whisper.version}\0${this.runtime.whisper.modelSha256}\0` :
      format === "docx" ? "life-links-attachment-text-docx-v2\0" : "life-links-attachment-text-v1\0";
    const revision = createHash("sha256").update(extractionVersion).update(file.media.mimeType).update("\0").update(file.data).digest("hex");
    if (offset > 0 && !options.revision) throw new AttachmentContentRequestError(400, "attachment_revision_required");
    if (options.revision && options.revision !== revision) throw new AttachmentContentRequestError(409, "attachment_content_changed");
    const key = `${file.media.ownerId}\0${file.media.id}\0${revision}`;
    for (const [key, value] of this.cache) if (value.expiresAt <= Date.now()) this.removeCached(key);
    let result = this.cache.get(key)?.result;
    if (!result) {
      result = transcript ? (format === "video" ? await this.transcribe(file, { startMs, durationMs, audioStreamIndex: options.audioStreamIndex }, signal) : unreadable("unsupported_media")) :
        format === "image" || format === "video" ? unreadable("unsupported_media") : await this.extract(file.data, format, signal);
      if (result.status === "ready") {
        this.removeCached(key);
        const timer = setTimeout(() => this.removeCached(key), 300000); timer.unref();
        this.cache.set(key, { lifeLinkId: file.media.lifeLinkId, mediaId: file.media.id, expiresAt: Date.now() + 300000, timer, result });
        while (this.cache.size > 4) this.removeCached(this.cache.keys().next().value!);
      }
    }
    if (offset > result.text.length || (offset > 0 && /[\uDC00-\uDFFF]/.test(result.text[offset] ?? ""))) throw new AttachmentContentRequestError(400, "invalid_attachment_content_page");
    let end = Math.min(offset + limit, result.text.length);
    if (end < result.text.length && /[\uDC00-\uDFFF]/.test(result.text[end])) end--;
    if (end === offset && end < result.text.length) end += 2;
    return { mediaId: file.media.id, revision, status: result.status, reason: result.reason, format,
      text: result.text.slice(offset, end), offset, nextOffset: end < result.text.length ? end : null,
      totalChars: result.text.length, warnings: result.warnings, ...(result.transcript ? { transcript: result.transcript } : {}) };
  }

  async readImage(file: LifeLinkMediaFile, options: AttachmentImageReadOptions, signal?: AbortSignal): Promise<AttachmentImageResult> {
    signal?.throwIfAborted();
    validateImageOptions(options);
    const format = attachmentFormat(file.media.mimeType);
    const office = format === "docx" || format === "xlsx";
    if ((options.page !== undefined && format !== "pdf" && !office) ||
        (options.frame !== undefined && format !== "image") || (options.atMs !== undefined && format !== "video")) {
      throw new AttachmentContentRequestError(400, "invalid_attachment_image_request");
    }
    const sourceRevision = attachmentSourceRevision(file);
    if (options.mode !== "describe" && options.sourceRevision !== sourceRevision) {
      throw new AttachmentContentRequestError(409, "attachment_content_changed");
    }
    const failed = (reason: AttachmentImageResult["reason"]): AttachmentImageResult => ({
      mediaId: file.media.id, sourceRevision, status: "unreadable", reason, source: null, rendition: null, image: null, warnings: []
    });
    if (!office && !["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "video/webm", "video/quicktime"].includes(file.media.mimeType)) return failed("unsupported_format");
    if (file.data.length > MAX_MEDIA_BYTES) return failed("decode_limit");
    let result: AttachmentImageResult | { requestError: string };
    try {
      const temporal = isTemporalAttachment(file.data, file.media.mimeType);
      if (options.frame !== undefined && !temporal) throw new AttachmentContentRequestError(400, "invalid_attachment_image_frame");
      result = await this.process(office || temporal ? 2 : 1, office || temporal ? this.nativeTimeout(90000) : this.timeoutMs, async (job) => {
        const message = { data: file.data, mimeType: file.media.mimeType, mediaId: file.media.id, sourceRevision, options };
        if (office) {
          const prepared = await prepareOfficePdf(file.data, file.media.mimeType, job);
          return job.runWorker("image", { ...message, preparedPdf: { ...prepared, format,
            originalMimeType: file.media.mimeType, originalSizeBytes: file.data.length } });
        }
        if (temporal) {
          const prepared = await prepareTemporalImage(file.data, file.media.mimeType, options, job);
          if (options.mode === "describe") return { mediaId: file.media.id, sourceRevision, status: "described", reason: null,
            source: prepared.source, warnings: prepared.warnings, rendition: null, image: null };
          return job.runWorker("image", { ...message, preparedImage: prepared });
        }
        return job.runWorker("image", message);
      }, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AttachmentContentRequestError) throw error;
      if (error && typeof error === "object" && "requestError" in error) throw new AttachmentContentRequestError(400, String(error.requestError));
      const reason = error instanceof AttachmentProcessingError ? error.reason : "decode_limit";
      result = failed((["malformed", "decode_limit", "processing_timeout", "runtime_unavailable", "encrypted", "unsupported_format"].includes(reason) ? reason : "decode_limit") as AttachmentImageResult["reason"]);
    }
    if ("requestError" in result) {
      throw new AttachmentContentRequestError(400, result.requestError);
    }
    if (result.mediaId !== file.media.id || result.sourceRevision !== sourceRevision || !Array.isArray(result.warnings) ||
        result.warnings.length > 8 || result.warnings.some((warning) => typeof warning !== "string" || warning.length > 200)) return failed("decode_limit");
    if (result.status === "bytes_ready") {
      if (!result.image || !result.rendition || typeof result.image.data !== "string" ||
          result.image.data.length > ATTACHMENT_IMAGE_MAX_BASE64_CHARS) return failed("output_limit");
      const bytes = Buffer.from(result.image.data, "base64");
      if (!bytes.length || bytes.length > ATTACHMENT_IMAGE_MAX_BYTES || bytes.length !== result.rendition.sizeBytes ||
          bytes.toString("base64") !== result.image.data ||
          createHash("sha256").update(bytes).digest("hex") !== result.rendition.sha256 ||
          result.rendition.mimeType !== result.image.mimeType) return failed("output_limit");
    }
    return result;
  }

  private async acquire(cost: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active + cost > 2 || this.waiting.length) {
      if (this.waiting.length >= 8) throw new AttachmentContentRequestError(429, "attachment_reader_busy");
      await new Promise<void>((resolve, reject) => {
        const job: WaitingJob = { cost, signal, start: resolve, cancel: () => {
          const index = this.waiting.indexOf(job);
          if (index >= 0) this.waiting.splice(index, 1);
          signal?.removeEventListener("abort", job.cancel);
          reject(signal?.reason ?? new DOMException("Attachment read cancelled", "AbortError"));
          this.drain();
        } };
        this.waiting.push(job);
        signal?.addEventListener("abort", job.cancel, { once: true });
      });
    } else this.active += cost;
  }

  private async extract(data: Buffer, format: string, signal?: AbortSignal): Promise<Extraction> {
    const result = await this.runJob<Extraction>("text", { data, format }, unreadable("extraction_timeout"), unreadable("extraction_limit"), signal);
    if (!result || typeof result.text !== "string" || Buffer.byteLength(result.text) > ATTACHMENT_EXTRACTION_MAX_BYTES || !Array.isArray(result.warnings)) return unreadable("extraction_limit");
    return result;
  }

  private nativeTimeout(normal: number): number { return this.timeoutMs === 15000 ? normal : this.timeoutMs; }

  private drain(): void {
    while (this.waiting.length && this.active + this.waiting[0].cost <= 2) {
      const next = this.waiting.shift()!;
      next.signal?.removeEventListener("abort", next.cancel);
      this.active += next.cost; next.start();
    }
  }

  /** Native-heavy jobs reserve both slots across preparation AND final encoding.
   * Release happens only after processor exit and temporary-file cleanup. */
  private async process<T>(cost: number, deadline: number, operation: (job: AttachmentProcessingJob) => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(cost, signal);
    try { return await withAttachmentJob(this.runtime, deadline, signal, operation); }
    finally { this.active -= cost; this.drain(); }
  }

  private async runJob<T>(kind: "text" | "image", message: object, timedOut: T, crashed: T, signal?: AbortSignal): Promise<T> {
    try { return await this.process(1, this.timeoutMs, (job) => job.runWorker<T>(kind, message), signal); }
    catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AttachmentContentRequestError) throw error;
      return error instanceof AttachmentProcessingError && error.reason === "processing_timeout" ? timedOut : crashed;
    }
  }

  private async transcribe(file: LifeLinkMediaFile, options: { startMs: number; durationMs: number; audioStreamIndex?: number }, signal?: AbortSignal): Promise<Extraction> {
    if (file.data.length > MAX_MEDIA_BYTES) return unreadable("extraction_limit");
    try {
      const { text, warnings, ...transcript } = await this.process(2, this.nativeTimeout(150000),
        (job) => transcribeVideoWindow(file.data, file.media.mimeType, options, job), signal);
      if (typeof text !== "string" || Buffer.byteLength(text) > ATTACHMENT_EXTRACTION_MAX_BYTES ||
          !Array.isArray(warnings) || warnings.length > 8 || warnings.some((warning) => typeof warning !== "string" || warning.length > 200)) return unreadable("extraction_limit");
      return { status: "ready", reason: null, text, warnings, transcript };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof AttachmentContentRequestError) throw error;
      const reason = error instanceof AttachmentProcessingError ? error.reason : "malformed";
      if (["invalid_audio_window", "invalid_audio_stream"].includes(reason)) throw new AttachmentContentRequestError(400, reason);
      return unreadable(reason === "processing_timeout" ? "extraction_timeout" : reason === "decode_limit" ? "extraction_limit" :
        (["runtime_unavailable", "no_audio", "malformed"].includes(reason) ? reason : "malformed") as AttachmentContentPage["reason"]);
    }
  }
}

export function attachmentSourceRevision(file: LifeLinkMediaFile): string {
  return createHash("sha256").update("life-links-attachment-source-v1\0").update(file.media.mimeType).update("\0").update(file.data).digest("hex");
}

function validateImageOptions(options: AttachmentImageReadOptions): void {
  const invalid = () => { throw new AttachmentContentRequestError(400, "invalid_attachment_image_request"); };
  if (!options || typeof options !== "object" || !["describe", "overview", "crop"].includes(options.mode)) invalid();
  const keys = options.mode === "describe" ? ["mode", "page", "frame", "atMs"] : options.mode === "crop" ? ["mode", "page", "frame", "atMs", "sourceRevision", "maxEdge", "encoding", "region"] : ["mode", "page", "frame", "atMs", "sourceRevision", "maxEdge", "encoding"];
  if (Object.keys(options).some((key) => !keys.includes(key))) invalid();
  if (options.page !== undefined && (!Number.isSafeInteger(options.page) || options.page < 1 || options.page > ATTACHMENT_PDF_MAX_PAGES)) invalid();
  if ([options.page, options.frame, options.atMs].filter((value) => value !== undefined).length > 1) invalid();
  if (options.frame !== undefined && (!Number.isSafeInteger(options.frame) || options.frame < 1 || options.frame > 512)) invalid();
  if (options.atMs !== undefined && (!Number.isSafeInteger(options.atMs) || options.atMs < 0 || options.atMs > 300000)) invalid();
  if (options.mode === "describe") return;
  if (!/^[a-f0-9]{64}$/.test(options.sourceRevision ?? "") ||
      (options.maxEdge !== undefined && (!Number.isSafeInteger(options.maxEdge) || options.maxEdge < ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE || options.maxEdge > ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE)) ||
      (options.encoding !== undefined && options.encoding !== "png" && options.encoding !== "jpeg")) invalid();
  if (options.mode === "crop") {
    const region = options.region;
    if (!region || Object.keys(region).length !== 4 || !["x", "y", "width", "height"].every((key) => Object.hasOwn(region, key)) ||
        !Object.values(region).every((value) => Number.isSafeInteger(value) && value >= 0) || region.width < 1 || region.height < 1) invalid();
  }
}
