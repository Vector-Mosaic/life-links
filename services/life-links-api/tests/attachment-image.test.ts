import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ATTACHMENT_IMAGE_MAX_BYTES, type AttachmentImageReadOptions } from "@life-links/core";
import { AttachmentContentReader, attachmentSourceRevision } from "../src/attachment-content.js";
import type { LifeLinkMediaFile } from "../src/store.js";
import { rasterOnlyPdf, vectorPdf } from "./attachment-pdf-fixtures.js";
import { textPdf } from "./attachment-fixtures.js";
import { attachmentRuntime } from "../src/attachment-native-runtime.js";

const file = (data: Buffer, mimeType = "image/png"): LifeLinkMediaFile => ({ data, media: {
  id: "media-synthetic-image", lifeLinkId: "synthetic-record", ownerId: "synthetic-owner", kind: "image",
  mimeType, fileName: "synthetic.png", sizeBytes: data.length, url: "/synthetic", createdAt: "2026-08-30T00:00:00.000Z"
} });
const solid = (width = 16, height = 12) => sharp({ create: { width, height, channels: 3, background: "#55bb22" } }).png().toBuffer();
const overview = (input: LifeLinkMediaFile): AttachmentImageReadOptions => ({ mode: "overview", sourceRevision: attachmentSourceRevision(input) });
const pdfFile = (data: Buffer): LifeLinkMediaFile => {
  const input = file(data, "application/pdf");
  return { ...input, media: { ...input.media, kind: "document", fileName: "synthetic.pdf" } };
};

async function decoded(image: { data: string }) {
  return sharp(Buffer.from(image.data, "base64")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixel(image: Awaited<ReturnType<typeof decoded>>, x: number, y: number) {
  return [...image.data.subarray((y * image.info.width + x) * image.info.channels, (y * image.info.width + x) * image.info.channels + 3)];
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type); let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); name.copy(chunk, 4); data.copy(chunk, 8); chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return chunk;
}

function animatedPng() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const animation = Buffer.alloc(8); animation.writeUInt32BE(2);
  const frame = (sequence: number) => { const value = Buffer.alloc(26); value.writeUInt32BE(sequence); value.writeUInt32BE(1, 4); value.writeUInt32BE(1, 8); value.writeUInt16BE(1, 20); value.writeUInt16BE(10, 22); return value; };
  const second = Buffer.alloc(4); second.writeUInt32BE(2);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("acTL", animation),
    pngChunk("fcTL", frame(0)), pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), pngChunk("fcTL", frame(1)),
    pngChunk("fdAT", Buffer.concat([second, deflateSync(Buffer.from([0, 0, 255, 0]))])), pngChunk("IEND", Buffer.alloc(0))]);
}

describe("private attachment image processing", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)("describes and renders actual static %s bytes with exact source/output identity and no upscale", async (format) => {
    const bytes = await sharp(await solid()).toFormat(format).toBuffer();
    const input = file(bytes, `image/${format}`); const reader = new AttachmentContentReader();
    const described = await reader.readImage(input, { mode: "describe" });
    expect(described).toMatchObject({ status: "described", sourceRevision: attachmentSourceRevision(input),
      source: { width: 16, height: 12, frameCount: 1, sizeBytes: bytes.length }, image: null, rendition: null });
    const result = await reader.readImage(input, overview(input));
    expect(result).toMatchObject({ status: "bytes_ready", reason: null, sourceRevision: described.sourceRevision,
      rendition: { width: 16, height: 12, mimeType: "image/png", encoding: "png", quality: null, region: { x: 0, y: 0, width: 16, height: 12 } } });
    const output = Buffer.from(result.image!.data, "base64");
    expect(output.length).toBe(result.rendition!.sizeBytes);
    expect(createHash("sha256").update(output).digest("hex")).toBe(result.rendition!.sha256);
    expect((await sharp(output).metadata()).exif).toBeUndefined();
    expect(input.data).toEqual(bytes);
  });

  it.each([6, 8, 2])("uses oriented source pixels for EXIF orientation %i crops, rather than raw pixel coordinates", async (orientation) => {
    const width = 8; const height = 6; const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([x * 25, y * 35, 50], (y * width + x) * 3);
    const input = file(await sharp(raw, { raw: { width, height, channels: 3 } }).withMetadata({ orientation }).png().toBuffer());
    const reader = new AttachmentContentReader(); const region = { x: 1, y: 2, width: 3, height: 2 };
    const result = await reader.readImage(input, { mode: "crop", sourceRevision: attachmentSourceRevision(input), region });
    expect(result).toMatchObject({ status: "bytes_ready", source: { width: orientation === 2 ? 8 : 6, height: orientation === 2 ? 6 : 8, orientation }, rendition: { region, width: 3, height: 2 } });
    const output = await sharp(Buffer.from(result.image!.data, "base64")).removeAlpha().raw().toBuffer();
    const expected: number[] = [];
    for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
      const sx = orientation === 6 ? y : orientation === 8 ? width - 1 - y : width - 1 - x;
      const sy = orientation === 6 ? height - 1 - x : orientation === 8 ? x : y;
      expected.push(sx * 25, sy * 35, 50);
    }
    expect([...output]).toEqual(expected);
    expect((await sharp(Buffer.from(result.image!.data, "base64")).metadata()).orientation).toBeUndefined();
  });

  it("rejects stale revisions and malformed/invalid bounds instead of substituting another source or crop", async () => {
    const reader = new AttachmentContentReader(); const input = file(await solid()); const revision = attachmentSourceRevision(input);
    await expect(reader.readImage(input, { mode: "overview", sourceRevision: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    for (const options of [
      { mode: "overview" }, { mode: "overview", sourceRevision: revision, maxEdge: 255 },
      { mode: "overview", sourceRevision: revision, maxEdge: 2049 }, { mode: "describe", encoding: "png" },
      { mode: "crop", sourceRevision: revision, region: { x: -1, y: 0, width: 2, height: 2 } },
      { mode: "crop", sourceRevision: revision, region: { x: 0, y: 0, width: 17, height: 12 } }
    ]) await expect(reader.readImage(input, options as AttachmentImageReadOptions)).rejects.toMatchObject({ status: 400 });
    const changed = file(Buffer.concat([input.data, Buffer.from("changed")]));
    expect(attachmentSourceRevision(changed)).not.toBe(revision);
    expect(attachmentSourceRevision(file(input.data, "image/webp"))).not.toBe(revision);
  });

  it("reports absent animation runtime and rejects format mismatch, malformed inputs and pixel/edge limits without poisoning later reads", async () => {
    const runtime = attachmentRuntime(); runtime.binaries.ffprobe = "/missing-life-links-runtime/ffprobe";
    const reader = new AttachmentContentReader(15000, runtime);
    const raw = Buffer.alloc(4 * 8 * 3, 80); raw.fill(180, 4 * 4 * 3);
    const gif = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).gif({ delay: [100, 100] }).toBuffer();
    const webp = await sharp(gif, { animated: true }).webp().toBuffer();
    for (const [input, reason] of [
      [file(gif, "image/gif"), "runtime_unavailable"], [file(webp, "image/webp"), "runtime_unavailable"],
      [file(animatedPng()), "runtime_unavailable"], [file(await solid(), "image/jpeg"), "malformed"],
      [file(Buffer.from("not an image")), "malformed"], [file(Buffer.from("<svg/>"), "image/svg+xml"), "unsupported_format"],
      [file(await solid(16385, 1)), "decode_limit"], [file(await solid(6000, 6000)), "decode_limit"]
    ] as const) expect(await reader.readImage(input, { mode: "describe" })).toMatchObject({ status: "unreadable", reason, image: null });
    const valid = file(await solid());
    expect(await reader.readImage(valid, overview(valid))).toMatchObject({ status: "bytes_ready" });
  });

  it("fits overviews explicitly, does not silently shrink crops, and preserves deliberate JPEG output", async () => {
    const input = file(await sharp(randomBytes(2048 * 2048 * 3), { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer());
    const reader = new AttachmentContentReader();
    const result = await reader.readImage(input, overview(input));
    expect(result.status).toBe("bytes_ready");
    expect(result.rendition!.sizeBytes).toBeLessThanOrEqual(ATTACHMENT_IMAGE_MAX_BYTES);
    expect(result.rendition!.sizeBytes).toBeGreaterThan(1024 * 1024);
    expect(result.rendition!.width).toBeLessThan(2048);
    expect(result.warnings.join(" ")).toContain("reduced further");
    expect(await reader.readImage(input, { mode: "crop", sourceRevision: attachmentSourceRevision(input), region: { x: 0, y: 0, width: 2048, height: 2048 } })).toMatchObject({ status: "unreadable", reason: "output_limit", image: null });
    const small = file(await solid());
    expect(await reader.readImage(small, { ...overview(small), encoding: "jpeg" } as AttachmentImageReadOptions)).toMatchObject({ status: "bytes_ready", rendition: { encoding: "jpeg", quality: 92, mimeType: "image/jpeg" } });
  }, 20000);

  it("successfully renders the admitted 32-million-pixel source boundary before a later normal read", async () => {
    const reader = new AttachmentContentReader();
    const input = file(await solid(8000, 4000));
    expect(await reader.readImage(input, overview(input))).toMatchObject({ status: "bytes_ready", source: { width: 8000, height: 4000 }, rendition: { width: 2048, height: 1024 } });
    const later = file(await solid());
    expect(await reader.readImage(later, overview(later))).toMatchObject({ status: "bytes_ready" });
  });

  it("shares admission with text, removes cancelled queued jobs, kills active work, and recovers capacity", async () => {
    const reader = new AttachmentContentReader(); const input = file(await solid());
    const controllers = Array.from({ length: 10 }, () => new AbortController());
    const jobs = controllers.map((controller, index) => index % 2 ?
      reader.read(file(Buffer.from(`text-${index}`), "text/plain"), {}, controller.signal) : reader.readImage(input, overview(input), controller.signal));
    const outcomes = Promise.allSettled(jobs);
    await expect(reader.readImage(input, overview(input))).rejects.toMatchObject({ status: 429 });
    controllers[9].abort();
    const replacement = reader.readImage(input, { mode: "describe" });
    for (const controller of controllers.slice(0, 9)) controller.abort();
    expect((await outcomes).every((outcome) => outcome.status === "rejected" && outcome.reason.name === "AbortError")).toBe(true);
    expect(await replacement).toMatchObject({ status: "described" });
    expect(await reader.readImage(input, overview(input))).toMatchObject({ status: "bytes_ready" });
    expect(await new AttachmentContentReader(1).readImage(input, overview(input))).toMatchObject({ status: "unreadable", reason: "processing_timeout" });
  });
});

describe("private PDF page images", () => {
  it("discloses unsupported transfer-map appearance instead of silently claiming faithful page colors", async () => {
    const reader = new AttachmentContentReader();
    const input = pdfFile(vectorPdf({ pages: 1, transferMap: true }));
    const result = await reader.readImage(input, overview(input));
    expect(result.status).toBe("bytes_ready");
    expect(result.warnings).toContain("PDF rendering limitations: some page content or font/color appearance may differ.");
    const normal = pdfFile(vectorPdf({ pages: 1 }));
    expect((await reader.readImage(normal, overview(normal))).warnings.join(" ")).not.toContain("PDF rendering limitations");
  });

  it("renders the requested actual PDF page with exact source/output identity, geometry and distinct diagram pixels", async () => {
    const input = pdfFile(vectorPdf()); const reader = new AttachmentContentReader();
    const original = Buffer.from(input.data);
    const described = await reader.readImage(input, { mode: "describe" });
    expect(described).toMatchObject({ status: "described", sourceRevision: attachmentSourceRevision(input), image: null, rendition: null,
      source: { mimeType: "application/pdf", sizeBytes: original.length, width: 400, height: 320, orientation: 1, frameCount: 1,
        pdf: { pageNumber: 1, pageCount: 2, rotation: 0, pixelsPerPoint: 4 } } });
    const outputs: string[] = [];
    for (const page of [1, 2]) {
      const result = await reader.readImage(input, { ...overview(input), page });
      expect(result).toMatchObject({ status: "bytes_ready", sourceRevision: described.sourceRevision,
        source: { pdf: { pageNumber: page, pageCount: 2 } },
        rendition: { width: 400, height: 320, encoding: "png", region: { x: 0, y: 0, width: 400, height: 320 } } });
      const bytes = Buffer.from(result.image!.data, "base64"); outputs.push(result.rendition!.sha256);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(result.rendition!.sha256);
      expect(bytes.length).toBe(result.rendition!.sizeBytes);
      const image = await decoded(result.image!);
      expect(pixel(image, 80, 240)).toEqual(page === 1 ? [255, 0, 0] : [0, 255, 0]);
      expect(pixel(image, 300, 80)).toEqual(page === 1 ? [0, 0, 255] : [255, 255, 0]);
      expect(pixel(image, 200, 160)).toEqual([255, 255, 255]);
      expect(result.warnings.join(" ")).toMatch(/page|render|visual/i);
    }
    expect(outputs[0]).not.toBe(outputs[1]); expect(input.data).toEqual(original);
  });

  it("uses the rotated nonzero PDF CropBox grid for description and deliberate crops", async () => {
    const input = pdfFile(vectorPdf({ pages: 1, cropBox: [10, 20, 90, 70], rotation: 90 }));
    const reader = new AttachmentContentReader();
    const whole = await reader.readImage(input, overview(input));
    expect(whole).toMatchObject({ status: "bytes_ready", source: { width: 200, height: 320,
      pdf: { pageNumber: 1, pageCount: 1, rotation: 90, pixelsPerPoint: 4 } }, rendition: { width: 200, height: 320 } });
    const image = await decoded(whole.image!);
    expect(pixel(image, 20, 60)).toEqual([255, 0, 0]);
    expect(pixel(image, 150, 260)).toEqual([0, 0, 255]);
    expect(pixel(image, 80, 160)).toEqual([255, 255, 255]);
    const region = { x: 10, y: 20, width: 50, height: 100 };
    const crop = await reader.readImage(input, { mode: "crop", page: 1, sourceRevision: whole.sourceRevision, region });
    expect(crop).toMatchObject({ status: "bytes_ready", rendition: { region, width: 50, height: 100 }, source: whole.source });
    const cropped = await decoded(crop.image!);
    expect(pixel(cropped, 10, 40)).toEqual([255, 0, 0]);
    expect(pixel(cropped, 40, 40)).toEqual([255, 255, 255]);
    expect(cropped.data).toEqual(await sharp(Buffer.from(whole.image!.data, "base64")).extract({ left: region.x, top: region.y, width: region.width, height: region.height }).removeAlpha().raw().toBuffer());
  });

  it("delivers raster-only scanned facts even when PDF text extraction truthfully reports no text", async () => {
    const input = pdfFile(rasterOnlyPdf()); const reader = new AttachmentContentReader();
    const text = await reader.read(input);
    expect(text).toMatchObject({ status: "unreadable", reason: "scanned_or_no_text", text: "", nextOffset: null });
    const result = await reader.readImage(input, overview(input));
    expect(result).toMatchObject({ status: "bytes_ready", source: { width: 960, height: 480,
      pdf: { pageNumber: 1, pageCount: 1, rotation: 0, pixelsPerPoint: 4 } } });
    const image = await decoded(result.image!);
    expect(pixel(image, 100, 100)).toEqual([255, 0, 0]);
    expect(pixel(image, 680, 120)).toEqual([0, 0, 255]);
    expect(pixel(image, 232, 296)).toEqual([0, 0, 0]);
    expect(pixel(image, 248, 296)).toEqual([255, 255, 255]);
    expect(await reader.read(input)).toEqual(text);
  });

  it("renders a real standard-font PDF label without changing its text representation", async () => {
    const input = pdfFile(textPdf("Valve torque 4 Nm")); const reader = new AttachmentContentReader();
    const before = await reader.read(input);
    expect(before).toMatchObject({ status: "ready", format: "pdf" }); expect(before.text).toContain("Valve torque 4 Nm");
    const result = await reader.readImage(input, overview(input));
    expect(result).toMatchObject({ status: "bytes_ready", source: { width: 1200, height: 800 } });
    const image = await decoded(result.image!);
    let ink = 0;
    for (let y = 110; y < 165; y++) for (let x = 155; x < 700; x++) if (pixel(image, x, y).every((channel) => channel < 80)) ink++;
    expect(ink).toBeGreaterThan(500); // A missing standard font must not silently produce an empty page.
    expect(pixel(image, 800, 400)).toEqual([255, 255, 255]);
    expect(await reader.read(input)).toEqual(before);
  });

  it("rejects invalid PDF pages, stale revisions, static-image page selectors and out-of-page crops", async () => {
    const input = pdfFile(vectorPdf()); const reader = new AttachmentContentReader(); const sourceRevision = attachmentSourceRevision(input);
    for (const page of [0, -1, 1.5, 513, Number.NaN]) {
      await expect(reader.readImage(input, { mode: "describe", page })).rejects.toMatchObject({ status: 400 });
    }
    for (const mode of ["describe", "overview", "crop"] as const) {
      const options = mode === "describe" ? { mode, page: 3 } : mode === "overview" ? { mode, page: 3, sourceRevision } : { mode, page: 3, sourceRevision, region: { x: 0, y: 0, width: 1, height: 1 } };
      await expect(reader.readImage(input, options)).rejects.toMatchObject({ status: 400, code: "invalid_attachment_image_page" });
    }
    await expect(reader.readImage(input, { mode: "overview", page: 2, sourceRevision: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await expect(reader.readImage(input, { mode: "crop", page: 2, sourceRevision, region: { x: 399, y: 0, width: 2, height: 1 } })).rejects.toMatchObject({ status: 400 });
    await expect(reader.readImage(file(await solid()), { mode: "describe", page: 1 })).rejects.toMatchObject({ status: 400 });
  });

  it("bounds page count and page pixels while admitting the final valid page and recovering after malformed, encrypted and timeout inputs", async () => {
    const reader = new AttachmentContentReader();
    // PDF.js can silently skip a failed DCT image and paint white despite
    // stopAtErrors. A scan whose only content failed decoding is not readable.
    const corruptScan = pdfFile(rasterOnlyPdf({ corruptImage: true }));
    expect(await reader.readImage(corruptScan, overview(corruptScan))).toMatchObject({ status: "unreadable", reason: "malformed", image: null });
    for (const [input, reason] of [
      [pdfFile(Buffer.from("%PDF-1.4\nmalformed\n%%EOF")), "malformed"],
      [pdfFile(vectorPdf({ encrypted: true })), "encrypted"],
      [pdfFile(vectorPdf({ pages: 513 })), "decode_limit"],
      [pdfFile(vectorPdf({ width: 4097, height: 1 })), "decode_limit"],
      [pdfFile(vectorPdf({ width: 2001, height: 1000 })), "decode_limit"]
    ] as const) expect(await reader.readImage(input, { mode: "describe" })).toMatchObject({ status: "unreadable", reason, image: null });
    const maximum = pdfFile(vectorPdf({ pages: 512 }));
    expect(await reader.readImage(maximum, { mode: "describe", page: 512 })).toMatchObject({ status: "described", source: { pdf: { pageNumber: 512, pageCount: 512 } } });
    const valid = pdfFile(vectorPdf());
    expect(await new AttachmentContentReader(1).readImage(valid, overview(valid))).toMatchObject({ status: "unreadable", reason: "processing_timeout", image: null });
    expect(await reader.readImage(valid, { ...overview(valid), page: 2 })).toMatchObject({ status: "bytes_ready" });
  }, 20000);
});
