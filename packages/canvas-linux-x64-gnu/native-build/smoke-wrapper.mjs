import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WRAPPER_NAME = "@napi-rs/canvas";
const NATIVE_NAME = "@napi-rs/canvas-linux-x64-gnu";
const EXPECTED_WRAPPER_VERSION = "0.1.100";
const EXPECTED_DRAW_IMAGE_RGBA_SHA256 = "fcd1147fc6d1f368f4d07d9830efa3367654ab51bd57960d9a73593f5d1a21d1";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const fail = (message) => {
  throw new Error(`life-links canvas wrapper smoke: ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const optionValue = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
};

const requireRegularAbsolute = (value, label) => {
  if (!value || !isAbsolute(value)) fail(`${label} must be an absolute path`);
  const linkStat = lstatSync(value);
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) fail(`${label} must be a regular non-symlink file`);
  const resolved = realpathSync(value);
  if (!statSync(resolved).isFile()) fail(`${label} must resolve to a regular file`);
  return resolved;
};

export const runWrapperSmoke = async ({ requireFrom, expectedNative }) => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("smoke requires a Linux x64 runtime");
  }
  if (!process.report?.getReport()?.header?.glibcVersionRuntime) {
    fail("smoke requires a glibc runtime");
  }
  const requireFromPath = requireRegularAbsolute(requireFrom, "require-from package.json");
  const expectedNativePath = requireRegularAbsolute(expectedNative, "expected native binary");
  const loader = createRequire(requireFromPath);
  const resolvedNative = realpathSync(loader.resolve(NATIVE_NAME));
  if (resolvedNative !== expectedNativePath) {
    fail(`wrapper resolved an unexpected native binary: ${resolvedNative}`);
  }
  const wrapperPackagePath = realpathSync(loader.resolve(`${WRAPPER_NAME}/package.json`));
  const wrapperPackageBytes = readFileSync(wrapperPackagePath);
  const wrapperPackage = JSON.parse(wrapperPackageBytes.toString("utf8"));
  if (wrapperPackage.name !== WRAPPER_NAME || wrapperPackage.version !== EXPECTED_WRAPPER_VERSION) {
    fail("wrapper package identity is not @napi-rs/canvas@0.1.100");
  }
  const { createCanvas, Image, SvgExportFlag } = loader(WRAPPER_NAME);
  const canvas = createCanvas(3, 2);
  const context = canvas.getContext("2d");
  context.fillStyle = "#123456";
  context.fillRect(0, 0, 3, 2);
  context.fillStyle = "#fedcba";
  context.fillRect(1, 0, 1, 2);
  const pixels = Buffer.from(context.getImageData(0, 0, 3, 2).data);
  const expectedPixels = Buffer.from([
    0x12, 0x34, 0x56, 0xff,
    0xfe, 0xdc, 0xba, 0xff,
    0x12, 0x34, 0x56, 0xff,
    0x12, 0x34, 0x56, 0xff,
    0xfe, 0xdc, 0xba, 0xff,
    0x12, 0x34, 0x56, 0xff,
  ]);
  if (!pixels.equals(expectedPixels)) fail("rendered pixels do not match the deterministic oracle");
  const png = canvas.toBuffer("image/png");
  if (png.length < 33 || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fail("wrapper did not encode a valid PNG");
  }
  if (png.readUInt32BE(16) !== 3 || png.readUInt32BE(20) !== 2) {
    fail("encoded PNG dimensions do not match the canvas");
  }
  const sourceCanvas = createCanvas(2, 2);
  const sourceContext = sourceCanvas.getContext("2d");
  sourceContext.fillStyle = "#ff0000";
  sourceContext.fillRect(0, 0, 1, 2);
  sourceContext.fillStyle = "#00ff00";
  sourceContext.fillRect(1, 0, 1, 2);
  const composedCanvas = createCanvas(2, 2);
  const composedContext = composedCanvas.getContext("2d");
  composedContext.drawImage(sourceCanvas, 0, 0);
  const composedPixels = Buffer.from(composedContext.getImageData(0, 0, 2, 2).data);
  const expectedComposedPixels = Buffer.from([
    0xff, 0x00, 0x00, 0xff,
    0x00, 0xff, 0x00, 0xff,
    0xff, 0x00, 0x00, 0xff,
    0x00, 0xff, 0x00, 0xff,
  ]);
  if (!composedPixels.equals(expectedComposedPixels)) {
    fail("canvas-to-canvas drawImage pixels do not match the deterministic oracle");
  }
  const composedPixelsSha256 = sha256(composedPixels);
  if (composedPixelsSha256 !== EXPECTED_DRAW_IMAGE_RGBA_SHA256) {
    fail("canvas-to-canvas drawImage pixel digest does not match the deterministic oracle");
  }
  const image = new Image();
  image.src = sourceCanvas.toBuffer("image/png");
  await image.decode();
  const imageCanvas = createCanvas(2, 2);
  imageCanvas.getContext("2d").drawImage(image, 0, 0);
  const imagePixels = Buffer.from(imageCanvas.getContext("2d").getImageData(0, 0, 2, 2).data);
  if (!imagePixels.equals(expectedComposedPixels)) fail("Image drawImage pixels do not match the deterministic oracle");
  const imagePixelsSha256 = sha256(imagePixels);
  if (imagePixelsSha256 !== EXPECTED_DRAW_IMAGE_RGBA_SHA256) {
    fail("Image drawImage pixel digest does not match the deterministic oracle");
  }
  const svgSource = createCanvas(2, 2, SvgExportFlag.NoPrettyXML);
  const svgContext = svgSource.getContext("2d");
  svgContext.fillStyle = "#0000ff";
  svgContext.fillRect(0, 0, 2, 2);
  const svgTarget = createCanvas(2, 2);
  svgTarget.getContext("2d").drawImage(svgSource, 0, 0);
  let invalidSourceError;
  try {
    composedContext.drawImage({}, 0, 0);
  } catch (error) {
    invalidSourceError = error;
  }
  if (!(invalidSourceError instanceof TypeError)) fail("invalid drawImage source did not throw TypeError");
  if (!["CanvasElement", "SVGCanvas", "Image"].every((name) => String(invalidSourceError.message).includes(name))) {
    fail("invalid drawImage source did not preserve the established type message");
  }
  return {
    schema_version: "life_links.canvas_wrapper_smoke.v2",
    status: "ok",
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      glibc: process.report.getReport().header.glibcVersionRuntime,
    },
    wrapper: {
      package: `${wrapperPackage.name}@${wrapperPackage.version}`,
      package_json_sha256: sha256(wrapperPackageBytes),
    },
    native: {
      package: NATIVE_NAME,
      resolved_path: resolvedNative,
      sha256: sha256(readFileSync(resolvedNative)),
      size_bytes: statSync(resolvedNative).size,
    },
    render: {
      width: 3,
      height: 2,
      rgba_sha256: sha256(pixels),
      png_sha256: sha256(png),
      png_size_bytes: png.length,
      draw_image: {
        canvas_rgba_sha256: composedPixelsSha256,
        image_rgba_sha256: imagePixelsSha256,
        svg_canvas_source_acceptance: "accepted_without_type_error",
        invalid_source_error: "TypeError",
      },
    },
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "usage";
  if (["usage", "help", "--help"].includes(command)) {
    process.stdout.write(
      "Run a deterministic Linux x64 glibc @napi-rs/canvas load, pixel, and PNG smoke against one exact native binary.\n",
    );
    return;
  }
  if (command !== "smoke") fail(`unsupported command: ${command}`);
  const result = await runWrapperSmoke({
    requireFrom: resolve(optionValue(args, "--require-from") ?? ""),
    expectedNative: resolve(optionValue(args, "--expected-native") ?? ""),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
