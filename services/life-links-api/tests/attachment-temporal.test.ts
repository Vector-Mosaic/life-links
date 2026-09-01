import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AttachmentContentReader, attachmentSourceRevision } from "../src/attachment-content.js";
import { attachmentRuntime, withAttachmentJob, type AttachmentProcessingJob } from "../src/attachment-native-runtime.js";
import { isTemporalAttachment, prepareTemporalImage, probeTemporalSource } from "../src/attachment-temporal.js";
import { disposalApng, disposalGif, disposalWebp, variableTimeVideo } from "./attachment-temporal-fixtures.js";

const options = { mode: "overview" as const, sourceRevision: "0".repeat(64) };
const runtime = attachmentRuntime();
const nativeEnabled = process.env.RUN_ATTACHMENT_NATIVE_TESTS === "1";
const inJob = <T>(operation: (job: AttachmentProcessingJob) => Promise<T>) => withAttachmentJob(runtime, 90_000, undefined, operation);

async function pixels(data: Buffer) { return sharp(data).removeAlpha().raw().toBuffer({ resolveWithObject: true }); }
function pixel(image: Awaited<ReturnType<typeof pixels>>, x: number, y: number) {
  const start = (y * image.info.width + x) * image.info.channels; return [...image.data.subarray(start, start + 3)];
}

describe("temporal attachment admission", () => {
  it("recognizes actual GIF/APNG/WebP animation and leaves static PNG/JPEG on their existing path", async () => {
    expect(isTemporalAttachment(disposalGif(), "image/gif")).toBe(true);
    expect(isTemporalAttachment(disposalApng(), "image/png")).toBe(true);
    expect(isTemporalAttachment(await disposalWebp(), "image/webp")).toBe(true);
    const staticPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    expect(isTemporalAttachment(staticPng, "image/png")).toBe(false);
    expect(isTemporalAttachment(await sharp(staticPng).jpeg().toBuffer(), "image/jpeg")).toBe(false);
    expect(isTemporalAttachment(await sharp(staticPng).gif().toBuffer(), "image/gif")).toBe(false);
  });

  it("rejects corrupt framing, excessive animation frames and inappropriate selectors before invoking native code", async () => {
    expect(() => isTemporalAttachment(disposalGif().subarray(0, 30), "image/gif")).toThrow();
    const tooMany = disposalApng(); tooMany.writeUInt32BE(513, 41);
    expect(() => isTemporalAttachment(tooMany, "image/png")).toThrowError("decode_limit");
    const neverJob = { runNative: () => { throw new Error("native must not be reached"); } } as unknown as AttachmentProcessingJob;
    for (const extra of [{ frame: 0 }, { frame: 4 }, { frame: 513 }, { frame: 1.5 }, { page: 1 }, { atMs: 0 }, { frame: 1, atMs: 0 }]) {
      await expect(prepareTemporalImage(disposalApng(), "image/png", { ...options, ...extra }, neverJob)).rejects.toMatchObject({ requestError: expect.stringMatching(/^invalid_attachment_image_/) });
    }
  });
});

describe.skipIf(!nativeEnabled)("qualified native temporal decoding (RUN_ATTACHMENT_NATIVE_TESTS=1)", () => {
  it("uses actual variable-rate PTS, not requested-time echoes, and preserves the display aspect ratio", async () => {
    const bytes = await inJob((job) => variableTimeVideo(job));
    const result = await inJob((job) => prepareTemporalImage(bytes, "video/quicktime", { ...options, atMs: 250 }, job));
    expect(result.source).toMatchObject({ width: 64, height: 16, frameCount: 1, orientation: 1,
      video: { requestedTimeMs: 250, frameTimeMs: 100, hasAudio: false } });
    expect(result.source.video!.framePts).toMatch(/^\d+$/);
    expect(pixel(await pixels(result.data!), 20, 8)).toEqual([0, 255, 0]);
    const later = await inJob((job) => prepareTemporalImage(bytes, "video/quicktime", { ...options, atMs: 450 }, job));
    expect(later.source.video?.frameTimeMs).toBe(400);
    expect(pixel(await pixels(later.data!), 20, 8)).toEqual([0, 0, 255]);
    const described = await inJob((job) => prepareTemporalImage(bytes, "video/quicktime", { mode: "describe", atMs: 75 }, job));
    expect(described.source.video?.frameTimeMs).toBe(0); expect(described.data).toBeUndefined();
    await expect(inJob((job) => prepareTemporalImage(bytes, "video/quicktime", { ...options, atMs: 1000 }, job)))
      .rejects.toMatchObject({ requestError: "invalid_attachment_image_time" });
  }, 90_000);

  it("honors display rotation as well as non-square pixels before declaring crop coordinates", async () => {
    const bytes = await inJob((job) => variableTimeVideo(job, true));
    const result = await inJob((job) => prepareTemporalImage(bytes, "video/quicktime", { ...options, atMs: 250 }, job));
    expect(result.source).toMatchObject({ width: 16, height: 64, orientation: 1 });
    const image = await pixels(result.data!); expect(image.info).toMatchObject({ width: 16, height: 64 });
    expect(pixel(image, 8, 20)).toEqual([0, 255, 0]);
  }, 90_000);

  it("delivers a selected-frame crop through the existing reader/encoder with exact source identity and bounded metadata", async () => {
    const data = await inJob((job) => variableTimeVideo(job));
    const file = { data, media: { id: "temporal-media", lifeLinkId: "temporal-item", ownerId: "temporal-owner", kind: "video" as const,
      mimeType: "video/quicktime", fileName: "synthetic.mov", sizeBytes: data.length, url: "/synthetic", createdAt: "2026-08-30T00:00:00.000Z" } };
    const sourceRevision = attachmentSourceRevision(file); const reader = new AttachmentContentReader();
    const region = { x: 8, y: 4, width: 12, height: 8 };
    const result = await reader.readImage(file, { mode: "crop", sourceRevision, region, atMs: 250 });
    expect(result).toMatchObject({ status: "bytes_ready", sourceRevision,
      source: { mimeType: "video/quicktime", sizeBytes: data.length, width: 64, height: 16, video: { frameTimeMs: 100 } },
      rendition: { region, width: 12, height: 8, mimeType: "image/png" } });
    expect(result.rendition!.processorVersion).toContain("life-links-temporal-v1/ffmpeg-9.0.1");
    expect(pixel(await pixels(Buffer.from(result.image!.data, "base64")), 0, 0)).toEqual([0, 255, 0]);
    const { image, ...metadata } = result;
    expect(Buffer.byteLength(JSON.stringify({ kind: "image", ...metadata, image: { mimeType: image!.mimeType } }))).toBeLessThanOrEqual(2048);
    await expect(reader.readImage({ ...file, data: Buffer.concat([data, Buffer.from("changed")]) }, { mode: "overview", sourceRevision, atMs: 250 }))
      .rejects.toMatchObject({ code: "attachment_content_changed", status: 409 });
  }, 90_000);

  it.each(["gif", "apng", "webp"])("composites %s delta/disposal frames and retains source timing/loop provenance", async (format) => {
    const bytes = format === "gif" ? disposalGif() : format === "apng" ? disposalApng() : await disposalWebp();
    const mime = format === "apng" ? "image/png" : `image/${format}`;
    const middle = await inJob((job) => prepareTemporalImage(bytes, mime, { ...options, frame: 2 }, job));
    expect(middle.source).toMatchObject({ width: 4, height: 4, frameCount: 3,
      animation: { frameNumber: 2, frameCount: 3, startMs: 100, durationMs: 200, loopCount: 2 } });
    const midPixels = await pixels(middle.data!);
    expect(pixel(midPixels, 0, 0)).toEqual([0, 255, 0]); expect(pixel(midPixels, 3, 3)).toEqual([255, 0, 0]);
    const last = await inJob((job) => prepareTemporalImage(bytes, mime, { ...options, frame: 3 }, job));
    expect(last.source.animation).toMatchObject({ frameNumber: 3, startMs: 300, durationMs: 300 });
    const lastPixels = await pixels(last.data!);
    expect(pixel(lastPixels, 0, 0)).toEqual([255, 0, 0]); expect(pixel(lastPixels, 3, 3)).toEqual([0, 0, 255]);
  }, 90_000);

  it("materializes only a private temporary source, forces the permitted demuxer, and removes it after the job", async () => {
    const bytes = await inJob((job) => variableTimeVideo(job)); let sourcePath = "";
    await inJob(async (job) => {
      const probe = await probeTemporalSource(bytes, "video/quicktime", job); sourcePath = probe.inputPath;
      expect(sourcePath).toContain(job.directory);
      expect(probe.inputArguments).toEqual(expect.arrayContaining(["-protocol_whitelist", "file", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0"]));
      expect(probe.streams).toHaveLength(1); expect(probe.durationMs).toBeGreaterThan(400); await access(sourcePath);
    });
    await expect(access(sourcePath)).rejects.toThrow();
  }, 90_000);
});
