import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import {
  ATTACHMENT_IMAGE_MAX_PIXELS, ATTACHMENT_IMAGE_MAX_SOURCE_EDGE,
  ATTACHMENT_PDF_MAX_PAGES, ATTACHMENT_PDF_PIXELS_PER_POINT
} from "@life-links/core";

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const canvasVersion = require("@napi-rs/canvas/package.json").version;
const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };

// PDF.js uses these browser geometry primitives but receives no browser, URL,
// owner credential, or scripting context. All font/codec resources are bundled.
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;

function boundedCanvasFactory() {
  const canvases = new Map();
  let activePixels = 0;
  const check = (width, height, previousPixels = 0) => {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
        width * height > ATTACHMENT_IMAGE_MAX_PIXELS ||
        activePixels - previousPixels + width * height > ATTACHMENT_IMAGE_MAX_PIXELS) fail("decode_limit");
  };
  class CanvasFactory {
    create(width, height) {
      check(width, height);
      const canvas = createCanvas(width, height);
      canvases.set(canvas, width * height); activePixels += width * height;
      return { canvas, context: canvas.getContext("2d") };
    }
    reset(target, width, height) {
      const previous = canvases.get(target.canvas);
      if (previous === undefined) fail("malformed");
      check(width, height, previous);
      target.canvas.width = width; target.canvas.height = height;
      activePixels += width * height - previous; canvases.set(target.canvas, width * height);
    }
    destroy(target) {
      const previous = canvases.get(target.canvas);
      if (previous !== undefined) {
        activePixels -= previous; canvases.delete(target.canvas);
        target.canvas.width = 0; target.canvas.height = 0;
      }
      target.canvas = null; target.context = null;
    }
  }
  return { CanvasFactory, dispose() {
    for (const canvas of canvases.keys()) { canvas.width = 0; canvas.height = 0; }
    canvases.clear(); activePixels = 0;
  } };
}

async function bundledResources() {
  let failed = false;
  const reader = async (directory) => {
    const root = join(pdfRoot, directory);
    const names = new Set((await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name));
    return async (name) => {
      try {
        // The PDF may select a CMap, but never a path or external resource.
        if (typeof name !== "string" || !names.has(name) || !/^[A-Za-z0-9_.-]+$/.test(name)) fail("malformed");
        return new Uint8Array(await readFile(join(root, name)));
      } catch (error) { failed = true; throw error; }
    };
  };
  const [cmap, font, wasm] = await Promise.all([reader("cmaps"), reader("standard_fonts"), reader("wasm")]);
  return {
    CMapReaderFactory: class { async fetch({ name }) { return { cMapData: await cmap(`${name}.bcmap`), isCompressed: true }; } },
    StandardFontDataFactory: class { fetch({ filename }) { return font(filename); } },
    WasmFactory: class { fetch({ filename }) { return wasm(filename); } },
    check() { if (failed) fail("malformed"); }
  };
}

/** Selected-page rendering only, inside the existing disposable image child.
 * The 288-DPI viewport is a coordinate grid, never a full-page backing bitmap.
 * Crop translation and scaling are applied before PDF.js paints into a bounded
 * output canvas. All scratch canvas allocations share the same active limit. */
export async function openPdfPage(data, pageNumber) {
  if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) fail("malformed");
  const { getDocument, AnnotationMode, version } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const resources = await bundledResources();
  const canvasOwner = boundedCanvasFactory();
  let parserWarning = false;
  let parserFailure = null;
  const previousWarn = console.warn;
  // Raw parser warnings may contain private source strings. Retain only whether
  // a rendering limitation occurred; stdout/stderr are also discarded by owner.
  console.warn = (...values) => {
    parserWarning = true;
    // PDF.js 5.4.624 catches asynchronous image decode failures even with
    // stopAtErrors:true and paints nothing. A blank successful raster would be
    // false coverage, so classify these pinned diagnostics without retaining
    // their private object names/messages. Benign font recovery stays warned.
    for (const value of values) if (typeof value === "string") {
      if (/^Warning: Image exceeded maximum allowed size/.test(value)) parserFailure = "decode_limit";
      else if (/^Warning: (?:Unable to decode image |BMP image decoding failed:|Image dimensions are missing|Found EOI marker \(0xFFD9\) while parsing scan data -- ignoring the rest of the image data)/.test(value)) parserFailure ??= "malformed";
    }
  };
  // The pinned NodeFilterFactory intentionally returns "none" for these SVG
  // effects. Keep that existing headless behavior, but do not silently claim
  // faithful transfer-map/soft-mask colors when an effect was requested.
  const unsupportedFilter = () => { parserWarning = true; return "none"; };
  class FilterFactory {
    addFilter(maps) { return maps ? unsupportedFilter() : "none"; }
    addAlphaFilter(map) { return map ? unsupportedFilter() : "none"; }
    addLuminosityFilter() { return unsupportedFilter(); }
    addHCMFilter() { return unsupportedFilter(); }
    addHighlightHCMFilter() { return unsupportedFilter(); }
    destroy() {}
  }
  const check = () => { resources.check(); if (parserFailure) fail(parserFailure); };
  const task = getDocument({ data: new Uint8Array(data), isEvalSupported: false, stopAtErrors: true,
    useWorkerFetch: false, useSystemFonts: false, disableFontFace: true, enableXfa: false,
    disableRange: true, disableStream: true, disableAutoFetch: true,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    maxImageSize: ATTACHMENT_IMAGE_MAX_PIXELS, canvasMaxAreaInBytes: ATTACHMENT_IMAGE_MAX_PIXELS * 4,
    CanvasFactory: canvasOwner.CanvasFactory, FilterFactory,
    CMapReaderFactory: resources.CMapReaderFactory, StandardFontDataFactory: resources.StandardFontDataFactory,
    WasmFactory: resources.WasmFactory, cMapPacked: true,
    cMapUrl: pathToFileURL(join(pdfRoot, "cmaps") + "/").href,
    standardFontDataUrl: pathToFileURL(join(pdfRoot, "standard_fonts") + "/").href,
    wasmUrl: pathToFileURL(join(pdfRoot, "wasm") + "/").href, verbosity: 1 });
  const dispose = async () => {
    try { await task.destroy(); } finally { canvasOwner.dispose(); console.warn = previousWarn; }
  };
  try {
    const document = await task.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) fail("malformed");
    if (document.numPages > ATTACHMENT_PDF_MAX_PAGES) fail("decode_limit");
    if (pageNumber > document.numPages) { await dispose(); return { requestError: "invalid_attachment_image_page" }; }
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: ATTACHMENT_PDF_PIXELS_PER_POINT });
    const width = Math.ceil(viewport.width); const height = Math.ceil(viewport.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE || height > ATTACHMENT_IMAGE_MAX_SOURCE_EDGE ||
        width * height > ATTACHMENT_IMAGE_MAX_PIXELS) fail("decode_limit");
    if (![0, 90, 180, 270].includes(viewport.rotation)) fail("malformed");
    const metadata = await document.getMetadata();
    check();
    const warnings = [`Page ${pageNumber} of ${document.numPages} only. Visual pixels are not an OCR transcript.`,
      "Stored page appearance only; scripts, embedded files, hidden layers and popup annotation text are not inspected."];
    if (metadata.info?.IsXFAPresent) warnings.push("XFA is not rendered; only the PDF's stored page appearance is included.");
    const source = { mimeType: "application/pdf", sizeBytes: data.length, width, height, orientation: 1, frameCount: 1,
      pdf: { pageNumber, pageCount: document.numPages, rotation: viewport.rotation, pixelsPerPoint: ATTACHMENT_PDF_PIXELS_PER_POINT } };
    return { source, warnings, processorVersion: `life-links-pdf-page-v1/pdfjs-${version}/canvas-${canvasVersion}`, dispose,
      async render(region, edge) {
        const scale = Math.min(1, edge / Math.max(region.width, region.height));
        const outputWidth = Math.min(edge, Math.max(1, Math.ceil(region.width * scale)));
        const outputHeight = Math.min(edge, Math.max(1, Math.ceil(region.height * scale)));
        const factory = new canvasOwner.CanvasFactory();
        const target = factory.create(outputWidth, outputHeight);
        try {
          await page.render({ canvas: target.canvas, viewport, annotationMode: AnnotationMode.ENABLE,
            transform: [scale, 0, 0, scale, -region.x * scale, -region.y * scale], background: "#ffffff" }).promise;
          check();
          if (parserWarning && !warnings.some((value) => value.startsWith("PDF rendering"))) {
            warnings.push("PDF rendering limitations: some page content or font/color appearance may differ.");
          }
          const pixels = target.context.getImageData(0, 0, outputWidth, outputHeight).data;
          return { data: Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), width: outputWidth, height: outputHeight };
        } finally { factory.destroy(target); }
      } };
  } catch (error) {
    await dispose();
    if (error?.name === "PasswordException") fail("encrypted");
    if (/maximum allowed size|canvas limit/i.test(String(error?.message))) fail("decode_limit");
    throw error;
  }
}
