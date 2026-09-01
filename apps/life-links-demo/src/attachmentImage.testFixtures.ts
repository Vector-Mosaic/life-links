import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { AttachmentContentPage, AttachmentImageResult } from "@life-links/core";

/** Deterministic, fully encoded PNG pixels; no network, renderer, or production fixture mutation. */
export function attachmentImageFixture(width = 4, height = 4, mediaId = "media-photo"): AttachmentImageResult {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let state = 0x753cb01;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x <= width * 3; x++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      raw[y * (width * 3 + 1) + x] = state & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return {
    mediaId, sourceRevision: createHash("sha256").update("fixture-source\0image/png\0").update(bytes).digest("hex"),
    status: "bytes_ready", reason: null,
    source: { mimeType: "image/png", sizeBytes: bytes.length, width, height, orientation: 1, frameCount: 1 },
    rendition: { mimeType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width, height,
      region: { x: 0, y: 0, width, height }, encoding: "png", quality: null, processorVersion: "test-png-1" },
    warnings: [], image: { mimeType: "image/png", data: bytes.toString("base64") }
  };
}

/** Transport-only PDF envelope; actual PDF rendering is covered at the API worker boundary. */
export function attachmentPdfImageFixture(page = 2): AttachmentImageResult {
  const result = attachmentImageFixture(80, 80, "media-pdf");
  result.source = { ...result.source!, mimeType: "application/pdf", width: 800, height: 800,
    pdf: { pageNumber: page, pageCount: 3, rotation: 90, pixelsPerPoint: 4 } };
  result.rendition!.region = { x: 0, y: 0, width: 800, height: 800 };
  result.warnings = ["Only the selected PDF page is rendered; other pages and embedded files are not inspected."];
  return result;
}

/** Encoded transport fixtures, not evidence of native Office/video/animation rendering. */
export function attachmentSelectedImageFixture(kind: "docx" | "xlsx" | "video" | "animation"): AttachmentImageResult {
  const result = attachmentImageFixture(80, 80, `media-${kind}`);
  result.source!.width = 800; result.source!.height = 800;
  result.rendition!.region = { x: 0, y: 0, width: 800, height: 800 };
  if (kind === "docx" || kind === "xlsx") {
    result.source!.mimeType = kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    result.source!.office = { format: kind, pageNumber: 2, pageCount: 3, rotation: 90, pixelsPerPoint: 4, conversionProfile: "cached-print-v1" };
    result.warnings = ["Office print view uses stored results; layout/fonts and off-print content may differ."];
  } else if (kind === "video") {
    result.source!.mimeType = "video/mp4";
    result.source!.video = { streamIndex: 0, durationMs: 60000, requestedTimeMs: 1200, frameTimeMs: 1166.667, framePts: "17920", timeBase: "1/15360", hasAudio: true };
    result.warnings = ["Only this decoded frame was inspected; audio and other times are not included."];
  } else {
    result.source!.mimeType = "image/gif"; result.source!.frameCount = 3;
    result.source!.animation = { frameNumber: 2, frameCount: 3, startMs: 150, durationMs: 80, loopCount: 0 };
    result.warnings = ["Only the selected composited frame was inspected."];
  }
  return result;
}

export function attachmentTranscriptFixture(text = "[00:30.000–00:31.000] Stored speech."): AttachmentContentPage {
  return { mediaId: "media-video", revision: "b".repeat(64), status: "ready", reason: null, format: "video", text,
    offset: 0, nextOffset: null, totalChars: text.length,
    warnings: ["Machine-generated speech may omit or hallucinate words; it is not a verified quotation."],
    transcript: { startMs: 30000, endMs: 60000, sourceDurationMs: 70000, nextStartMs: 60000,
      audioStreamIndex: 1, processorVersion: "life-links-temporal-v1/ffmpeg-9.0.1; whisper.cpp-v1.8.6", modelSha256: "c".repeat(64) } };
}

function chunk(type: string, data: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
