import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  ATTACHMENT_IMAGE_MAX_PIXELS, ATTACHMENT_IMAGE_MAX_SOURCE_EDGE, ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE,
  ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE, ATTACHMENT_IMAGE_MAX_BYTES
} from "@life-links/core";

// This child owns native decoding; no persistent/native cache or parallel codec pool.
// These bounds and process termination are not an OS sandbox or a strict RSS limit.
sharp.cache(false);
sharp.concurrency(1);
const processorVersion = `life-links-image-v1/sharp-${sharp.versions.sharp}/vips-${sharp.versions.vips}`;
const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
const inputOptions = { limitInputPixels: ATTACHMENT_IMAGE_MAX_PIXELS, limitInputChannels: 4,
  unlimited: false, failOn: "warning", sequentialRead: true };

function sniff(data) {
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

// libvips' PNG loader may expose only the default image of APNG. Never mistake
// that default image for full coverage of the uploaded animation.
function isAnimatedPng(data) {
  let offset = 8;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    if (length > data.length - offset - 12) fail("malformed");
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "acTL") return true;
    offset += length + 12;
    if (type === "IEND") return false;
  }
  fail("malformed");
}

async function processImage(data, mimeType, options) {
  if (sniff(data) !== mimeType) fail("malformed");
  if (mimeType === "image/png" && isAnimatedPng(data)) fail("unsupported_animation");
  const metadata = await sharp(data, inputOptions).metadata();
  const formats = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (metadata.format !== formats[mimeType]) fail("malformed");
  const orientation = metadata.orientation ?? 1;
  const frameCount = metadata.pages ?? 1;
  if (frameCount !== 1) fail("unsupported_animation");
  const rotated = orientation >= 5 && orientation <= 8;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height || width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
      width * height > ATTACHMENT_IMAGE_MAX_PIXELS || !Number.isSafeInteger(width * height)) fail("decode_limit");
  const source = { mimeType, sizeBytes: data.length, width, height, orientation, frameCount };
  if (options.mode === "describe") return { status: "described", reason: null, source, rendition: null, image: null, warnings: [] };
  const region = options.mode === "crop" ? options.region : { x: 0, y: 0, width, height };
  if (region.x + region.width > width || region.y + region.height > height) return { requestError: "invalid_attachment_image_region" };
  const warnings = [];
  if (orientation !== 1) warnings.push("The source orientation was normalized before cropping or resizing.");
  return encodeRendition(source, region, options, (edge) => sharp(data, { ...inputOptions, autoOrient: true })
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }), warnings, processorVersion);
}

// One output-encoding, byte-limit and integrity-envelope owner for static source
// pixels and selected PDF page pixels. The static sharp pipeline is unchanged.
async function encodeRendition(source, region, options, makePipeline, warnings, version) {
  const encoding = options.encoding ?? "png";
  const quality = encoding === "jpeg" ? 92 : null;
  let edge = options.maxEdge ?? ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE;
  const requestedEdge = edge;
  if (encoding === "jpeg") warnings.push("JPEG is lossy; transparent pixels are composited onto white.");
  for (let attempt = 0; attempt < 8; attempt++) {
    let pipeline = (await makePipeline(edge)).toColourspace("srgb");
    pipeline = encoding === "jpeg" ? pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, chromaSubsampling: "4:4:4" }) : pipeline.png({ compressionLevel: 6 });
    const { data: output, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (output.length <= ATTACHMENT_IMAGE_MAX_BYTES) {
      if (info.width < region.width || info.height < region.height) warnings.push("The returned pixels are downscaled; use a deliberate crop to inspect small details.");
      if (edge < requestedEdge) warnings.push("The overview was reduced further to fit the encoded-image byte limit.");
      const outputMimeType = encoding === "jpeg" ? "image/jpeg" : "image/png";
      return { status: "bytes_ready", reason: null, source, warnings,
        rendition: { mimeType: outputMimeType, sizeBytes: output.length, sha256: createHash("sha256").update(output).digest("hex"),
          width: info.width, height: info.height, region, encoding, quality, processorVersion: version },
        image: { mimeType: outputMimeType, data: output.toString("base64") } };
    }
    if (options.mode === "crop" || edge <= ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE) fail("output_limit");
    edge = Math.max(ATTACHMENT_IMAGE_MIN_OUTPUT_EDGE, Math.floor(edge * 0.7));
  }
  fail("output_limit");
}

async function processPdf(data, options, preparedPdf) {
  const { openPdfPage } = await import("./attachment-pdf-renderer.js");
  const page = await openPdfPage(data, options.page ?? 1);
  if (page.requestError) return page;
  try {
    let { source } = page;
    // The renderer can append fidelity warnings during render(), so retain its
    // array rather than snapshotting before the page has actually been painted.
    const warnings = page.warnings;
    if (preparedPdf) warnings.unshift(...preparedPdf.warnings);
    if (preparedPdf) {
      const { pdf, ...rest } = source;
      source = { ...rest, mimeType: preparedPdf.originalMimeType, sizeBytes: preparedPdf.originalSizeBytes,
        office: { ...pdf, format: preparedPdf.format, conversionProfile: "cached-print-v1" } };
    }
    if (options.mode === "describe") return { status: "described", reason: null, source, rendition: null, image: null, warnings };
    const region = options.mode === "crop" ? options.region : { x: 0, y: 0, width: source.width, height: source.height };
    if (region.x + region.width > source.width || region.y + region.height > source.height) return { requestError: "invalid_attachment_image_region" };
    return await encodeRendition(source, region, options, async (edge) => {
      const rendered = await page.render(region, edge);
      return sharp(rendered.data, { raw: { width: rendered.width, height: rendered.height, channels: 4 } });
    }, warnings, `${preparedPdf ? `${preparedPdf.processorVersion}/` : ""}${page.processorVersion}/sharp-${sharp.versions.sharp}/vips-${sharp.versions.vips}`);
  } finally { await page.dispose(); }
}

async function processPreparedImage(prepared, options) {
  const { source } = prepared;
  const bytes = Buffer.from(prepared.data);
  if (sniff(bytes) !== "image/png") fail("malformed");
  const metadata = await sharp(bytes, inputOptions).metadata();
  if (metadata.width !== source.width || metadata.height !== source.height ||
      source.width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || source.height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
      source.width * source.height > ATTACHMENT_IMAGE_MAX_PIXELS) fail("decode_limit");
  const region = options.mode === "crop" ? options.region : { x: 0, y: 0, width: source.width, height: source.height };
  if (region.x + region.width > source.width || region.y + region.height > source.height) return { requestError: "invalid_attachment_image_region" };
  return encodeRendition(source, region, options, (edge) => sharp(bytes, inputOptions)
    .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true }), [...prepared.warnings],
    `${prepared.processorVersion}/${processorVersion}`);
}

process.once("message", async ({ data, mimeType, mediaId, sourceRevision, options, preparedPdf, preparedImage }) => {
  let result;
  try {
    result = preparedPdf ? await processPdf(Buffer.from(preparedPdf.data), options, preparedPdf) :
      preparedImage ? await processPreparedImage(preparedImage, options) :
      mimeType === "application/pdf" ? await processPdf(Buffer.from(data), options) : await processImage(Buffer.from(data), mimeType, options);
  } catch (error) {
    const reason = ["unsupported_animation", "decode_limit", "output_limit", "encrypted"].includes(error?.reason) ? error.reason :
      /pixel limit|channel limit|maximum allowed size|canvas limit/i.test(String(error?.message)) ? "decode_limit" : "malformed";
    result = { status: "unreadable", reason, source: null, rendition: null, image: null, warnings: [] };
  }
  process.send?.({ mediaId, sourceRevision, ...result }, () => process.exit(0));
});
