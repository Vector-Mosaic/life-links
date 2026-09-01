import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RECEIPT_SCHEMA = "life_links.canvas_native_build_receipt.v3";
const EXPECTED_LOCK_SCHEMA = "life_links.canvas_native_build.v3";
const EXPECTED_PACKAGE_NAME = "@napi-rs/canvas-linux-x64-gnu";
const EXPECTED_PACKAGE_VERSION = "0.1.100";
const EXPECTED_TARGET = "x86_64-unknown-linux-gnu";
const EXPECTED_RUST_RELEASE = "1.94.1";
const EXPECTED_SOURCE_CLOSURE_SCHEMA = "life_links.canvas_source_closure_binding.v3";
const EXPECTED_SOURCE_MANIFEST_SCHEMA = "life_links.bc270.source_closure.v1";

const defaultPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(process.argv[2] ?? defaultPackageDir);
const fail = (message) => {
  process.stderr.write(`life-links canvas package verification: ${message}\n`);
  process.exit(1);
};
const readJson = (path, label) => {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
    return value;
  } catch {
    fail(`${label} is missing or invalid JSON: ${path}`);
  }
};
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256 = (path) => sha256Bytes(readFileSync(path));
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
};
const canonicalJson = (value) => `${JSON.stringify(stableValue(value))}\n`;
const sameStableValue = (left, right) => canonicalJson(left) === canonicalJson(right);
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) fail(`${label} mismatch: expected ${expected}, got ${actual}`);
};
const requireSha256 = (value, label) => {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) fail(`${label} is missing or malformed`);
  return value;
};
const requireGitObject = (value, label) => {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) fail(`${label} is missing or malformed`);
  return value;
};
const requirePositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is missing or invalid`);
  return value;
};
const requireNonnegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} is missing or invalid`);
  return value;
};

const regularTreeIdentity = (root, label) => {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail(`${label} must be a real directory`);
  const entries = [];
  const visit = (directory) => {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of children) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split(sep).join("/");
      const linkStat = lstatSync(path);
      if (linkStat.isSymbolicLink()) fail(`${label} contains a symlink: ${rel}`);
      if (linkStat.isDirectory()) visit(path);
      else if (linkStat.isFile()) {
        const bytes = readFileSync(path);
        entries.push({ path: rel, sha256: sha256Bytes(bytes), size_bytes: bytes.length });
      } else fail(`${label} contains an unsupported entry: ${rel}`);
    }
  };
  visit(root);
  return {
    files: entries,
    file_count: entries.length,
    byte_count: entries.reduce((total, entry) => total + entry.size_bytes, 0),
    content_tree_sha256: sha256Bytes(Buffer.from(canonicalJson(entries))),
  };
};

const packageJsonPath = join(packageDir, "package.json");
const buildLockPath = join(packageDir, "native-build.lock.json");
const receiptPath = join(packageDir, "build-receipt.json");
const binaryPath = join(packageDir, "skia.linux-x64-gnu.node");
const packageJson = readJson(packageJsonPath, "package manifest");
const buildLock = readJson(buildLockPath, "native build lock");
const receipt = readJson(receiptPath, "native build receipt");

const retainedBuild = buildLock.retained_build;
requireEqual(retainedBuild?.assurance, "one exact offline source build retained for release", "retained build assurance");
requireEqual(retainedBuild?.receipt?.path, "build-receipt.json", "retained build receipt path");
requireEqual(retainedBuild?.receipt?.schema_version, EXPECTED_RECEIPT_SCHEMA, "retained build receipt schema");
requireSha256(retainedBuild?.receipt?.sha256, "retained build receipt digest");
requireEqual(sha256(receiptPath), retainedBuild.receipt.sha256, "retained build receipt digest");
requireSha256(retainedBuild?.historical_native_build_lock_sha256, "retained historical lock digest");
requireEqual(
  receipt.source?.native_build_lock_sha256,
  retainedBuild.historical_native_build_lock_sha256,
  "receipt historical native build lock digest",
);
requireEqual(
  receipt.committed_inputs?.native_build_lock_sha256,
  retainedBuild.historical_native_build_lock_sha256,
  "receipt committed historical native build lock digest",
);
requireEqual(retainedBuild?.binary?.path, "skia.linux-x64-gnu.node", "retained build binary path");
requireSha256(retainedBuild?.binary?.sha256, "retained build binary digest");
requirePositiveInteger(retainedBuild?.binary?.size_bytes, "retained build binary size");
requireEqual(sha256(binaryPath), retainedBuild.binary.sha256, "retained build binary digest");
requireEqual(statSync(binaryPath).size, retainedBuild.binary.size_bytes, "retained build binary size");

requireEqual(packageJson.name, EXPECTED_PACKAGE_NAME, "package name");
requireEqual(packageJson.version, EXPECTED_PACKAGE_VERSION, "package version");
requireEqual(packageJson.main, "./skia.linux-x64-gnu.node", "package binary entrypoint");
requireEqual(buildLock.schema_version, EXPECTED_LOCK_SCHEMA, "native build lock schema");
requireEqual(receipt.schema_version, EXPECTED_RECEIPT_SCHEMA, "receipt schema");
requireEqual(receipt.package?.name, EXPECTED_PACKAGE_NAME, "receipt package name");
requireEqual(receipt.package?.version, EXPECTED_PACKAGE_VERSION, "receipt package version");
requireEqual(receipt.package?.target, EXPECTED_TARGET, "receipt target");
requireEqual(buildLock.package?.name, EXPECTED_PACKAGE_NAME, "lock package name");
requireEqual(buildLock.package?.version, EXPECTED_PACKAGE_VERSION, "lock package version");
requireEqual(buildLock.package?.target, EXPECTED_TARGET, "lock target");
requireEqual(buildLock.package?.binary, "skia.linux-x64-gnu.node", "lock binary entrypoint");
for (const requiredPackageFile of [
  "THIRD_PARTY_NOTICES.md",
  "SOURCE_MATERIALS.json",
  "SOURCE_MATERIALS.json.sha256",
  "LICENSES",
  "native-build/patches/0001-backport-draw-image-source-napi-3.12.patch",
]) {
  if (!Array.isArray(packageJson.files) || !packageJson.files.includes(requiredPackageFile)) {
    fail(`package file projection is missing ${requiredPackageFile}`);
  }
}

const expectedBuilderImage = buildLock.builder?.derived_image;
if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(expectedBuilderImage ?? "")) {
  fail("lock canonical derived builder image is missing or malformed");
}
requireEqual(receipt.builder?.image, expectedBuilderImage, "receipt builder image");
if (!String(receipt.builder?.rustc ?? "").startsWith(`rustc ${EXPECTED_RUST_RELEASE} `)) {
  fail(`receipt Rust release is not ${EXPECTED_RUST_RELEASE}`);
}
for (const toolName of ["clang", "ld", "ninja", "gn"]) {
  requireSha256(receipt.builder?.[toolName]?.sha256, `receipt ${toolName} digest`);
  if (!receipt.builder?.[toolName]?.path || !receipt.builder?.[toolName]?.version) {
    fail(`receipt ${toolName} identity is incomplete`);
  }
}

const derivation = buildLock.source_derivation;
requireEqual(derivation?.schema_version, "life_links.canvas_source_derivation.v1", "canvas source derivation schema");
requireGitObject(derivation?.base_commit, "canvas base commit");
requireGitObject(derivation?.base_tree, "canvas base tree");
requireGitObject(derivation?.effective_tree, "canvas effective tree");
requireEqual(derivation.base_commit, buildLock.upstream?.commit, "canvas base/upstream commit");
requireEqual(derivation.base_tree, buildLock.upstream?.tree, "canvas base/upstream tree");
if (!Array.isArray(derivation.backports) || derivation.backports.length !== 1) {
  fail("canvas source derivation must bind exactly one backport");
}
const backport = derivation.backports[0];
requireEqual(backport?.origin_commit, "6be5aa2c664dd077513aa8c89a93531cc568adef", "drawImage backport origin commit");
requireEqual(backport?.source_path, "src/ctx.rs", "drawImage backport source path");
requireEqual(
  backport?.patch_path,
  "native-build/patches/0001-backport-draw-image-source-napi-3.12.patch",
  "drawImage backport path",
);
requireSha256(backport?.patch_sha256, "drawImage backport patch digest");
requireEqual(sha256(join(packageDir, ...backport.patch_path.split("/"))), backport.patch_sha256, "drawImage backport patch digest");
requireEqual(receipt.source?.canvas?.base_commit, derivation.base_commit, "receipt canvas base commit");
requireEqual(receipt.source?.canvas?.base_tree, derivation.base_tree, "receipt canvas base tree");
requireEqual(receipt.source?.canvas?.effective_tree, derivation.effective_tree, "receipt canvas effective tree");
if (!sameStableValue(receipt.source?.canvas?.backports, derivation.backports)) {
  fail("receipt canvas backport binding mismatch");
}
requireEqual(receipt.source?.skia_commit, buildLock.materials?.skia_commit, "Skia commit");
requireEqual(receipt.source?.depot_tools_commit, buildLock.materials?.depot_tools_commit, "depot_tools commit");
requireEqual(receipt.source?.cargo_lock_sha256, buildLock.materials?.cargo_lock_sha256, "Cargo.lock digest");
// The receipt is immutable build-time evidence. The current package lock also
// owns the later source/license closure, so its digest can advance without
// rewriting the original receipt. Bind the receipt's two copies of the exact
// build-time digest here; the field-by-field checks above and the closure checks
// below independently bind the current lock to the same source and output.
requireEqual(
  receipt.source?.native_build_lock_sha256,
  receipt.committed_inputs?.native_build_lock_sha256,
  "receipt native build lock digest",
);

const closure = buildLock.source_closure;
requireEqual(closure?.schema_version, EXPECTED_SOURCE_CLOSURE_SCHEMA, "source closure binding schema");
requireEqual(closure?.evidence_scope, "engineering-source-and-notice-applicability", "source closure evidence scope");
requireEqual(closure?.legal_clearance_claimed, false, "source closure legal-clearance nonclaim");
if (!Array.isArray(closure?.exact_sources_unavailable) || closure.exact_sources_unavailable.length !== 0) {
  fail("source closure must record that no exact source is unavailable");
}

const sourceMaterials = closure.source_materials;
requireEqual(sourceMaterials?.path, "SOURCE_MATERIALS.json", "source-material manifest path");
requireEqual(sourceMaterials?.sidecar_path, "SOURCE_MATERIALS.json.sha256", "source-material sidecar path");
requireEqual(sourceMaterials?.schema_version, EXPECTED_SOURCE_MANIFEST_SCHEMA, "source-material manifest schema lock");
requirePositiveInteger(sourceMaterials?.captured_file_count, "source-material captured file count");
requirePositiveInteger(sourceMaterials?.captured_byte_count, "source-material captured byte count");
requireSha256(sourceMaterials?.sha256, "source-material manifest digest");
requireSha256(sourceMaterials?.sidecar_sha256, "source-material sidecar digest");

const sourceMaterialsPath = join(packageDir, sourceMaterials.path);
const sourceSidecarPath = join(packageDir, sourceMaterials.sidecar_path);
requireEqual(sha256(sourceMaterialsPath), sourceMaterials.sha256, "source-material manifest digest");
requireEqual(sha256(sourceSidecarPath), sourceMaterials.sidecar_sha256, "source-material sidecar digest");
requireEqual(
  readFileSync(sourceSidecarPath, "utf8").trim(),
  `${sourceMaterials.sha256}  SOURCE_MATERIALS.json`,
  "source-material sidecar content",
);
const sourceManifest = readJson(sourceMaterialsPath, "source-material manifest");
requireEqual(sourceManifest.schema_version, EXPECTED_SOURCE_MANIFEST_SCHEMA, "source-material manifest schema");
if (!sameStableValue(sourceManifest.source_derivation, derivation)) {
  fail("source-material source derivation binding mismatch");
}
if (!Array.isArray(sourceManifest.files) || sourceManifest.files.length !== sourceMaterials.captured_file_count) {
  fail("source-material captured file inventory count is incorrect");
}
const capturedPaths = new Set();
let capturedBytes = 0;
for (const entry of sourceManifest.files) {
  if (typeof entry?.path !== "string" || !entry.path || capturedPaths.has(entry.path)) {
    fail("source-material captured file inventory contains an invalid or duplicate path");
  }
  capturedPaths.add(entry.path);
  requireSha256(entry.sha256, `source-material captured digest for ${entry.path}`);
  capturedBytes += requireNonnegativeInteger(entry.size_bytes, `source-material captured size for ${entry.path}`);
}
requireEqual(capturedBytes, sourceMaterials.captured_byte_count, "source-material captured byte count");
if (
  !Array.isArray(sourceManifest.verification?.exact_sources_unavailable) ||
  sourceManifest.verification.exact_sources_unavailable.length !== 0
) {
  fail("source-material manifest does not establish exact source availability");
}

const applicableBinary = closure.applicable_binary;
requireSha256(applicableBinary?.sha256, "source closure applicable binary digest");
requirePositiveInteger(applicableBinary?.size_bytes, "source closure applicable binary size");
requireEqual(sourceManifest.exact_run_a?.binary?.sha256, applicableBinary.sha256, "source-material binary digest");
requireEqual(sourceManifest.exact_run_a?.binary?.size_bytes, applicableBinary.size_bytes, "source-material binary size");
requireEqual(receipt.outputs?.binary?.sha256, applicableBinary.sha256, "receipt source-closure binary digest");
requireEqual(receipt.outputs?.binary?.size_bytes, applicableBinary.size_bytes, "receipt source-closure binary size");

const sourceTar = sourceManifest.primary_normalized_canvas_source;
requireEqual(sourceTar?.sha256, buildLock.materials?.normalized_source_tar?.sha256, "source-material normalized source digest");
requireEqual(sourceTar?.size_bytes, buildLock.materials?.normalized_source_tar?.size_bytes, "source-material normalized source size");
requireEqual(closure.normalized_source_tar?.sha256, sourceTar.sha256, "source closure normalized source digest");
requireEqual(closure.normalized_source_tar?.size_bytes, sourceTar.size_bytes, "source closure normalized source size");

requireEqual(sourceManifest.focused_license_capture?.canvas_commit, buildLock.upstream?.commit, "source-material canvas commit");
requireEqual(sourceManifest.focused_license_capture?.skia_commit, buildLock.materials?.skia_commit, "source-material Skia commit");
requireEqual(sourceManifest.focused_license_capture?.cargo_lock_sha256, buildLock.materials?.cargo_lock_sha256, "source-material Cargo.lock digest");
const projectedLicenses = sourceManifest.focused_license_capture?.files;
if (!Array.isArray(projectedLicenses) || projectedLicenses.length === 0) {
  fail("source-material focused license inventory is missing");
}
const expectedLicenseFiles = projectedLicenses.map((entry) => {
  const prefix = "LICENSES/";
  if (typeof entry?.path !== "string" || !entry.path.startsWith(prefix)) {
    fail("source-material focused license inventory has a path outside LICENSES");
  }
  requireSha256(entry.sha256, `source-material focused license digest for ${entry.path}`);
  requireNonnegativeInteger(entry.size_bytes, `source-material focused license size for ${entry.path}`);
  return { path: entry.path.slice(prefix.length), sha256: entry.sha256, size_bytes: entry.size_bytes };
});
requireEqual(closure.licenses?.path, "LICENSES", "projected license path");
const licenseIdentity = regularTreeIdentity(join(packageDir, closure.licenses.path), "projected license tree");
if (!sameStableValue(licenseIdentity.files, expectedLicenseFiles)) {
  fail("projected license tree does not exactly match the source-material focused inventory");
}
const manifestLicenseTreeSha256 = sha256Bytes(Buffer.from(canonicalJson(expectedLicenseFiles)));
requireEqual(manifestLicenseTreeSha256, closure.licenses?.content_tree_sha256, "source-material license content tree");
requireEqual(licenseIdentity.file_count, closure.licenses?.regular_file_count, "projected license file count");
requireEqual(licenseIdentity.byte_count, closure.licenses?.byte_count, "projected license byte count");
requireEqual(licenseIdentity.content_tree_sha256, manifestLicenseTreeSha256, "projected license content tree");

requireEqual(closure.third_party_notices?.path, "THIRD_PARTY_NOTICES.md", "third-party notice path");
requireSha256(closure.third_party_notices?.sha256, "third-party notice digest");
requireEqual(
  sha256(join(packageDir, closure.third_party_notices.path)),
  closure.third_party_notices.sha256,
  "third-party notice digest",
);

for (const recipeName of [
  "build_offline",
  "verify_materials",
  "run_offline_build",
  "qualify_native",
  "smoke_wrapper",
  "verify_package",
  "verify_qualification",
]) {
  const recipe = buildLock.recipe?.[recipeName];
  if (typeof recipe?.path !== "string" || !recipe.path) fail(`lock recipe path is missing for ${recipeName}`);
  requireSha256(recipe.sha256, `lock recipe digest for ${recipeName}`);
  requireEqual(sha256(join(packageDir, ...recipe.path.split("/"))), recipe.sha256, `committed ${recipe.path} digest`);
}

const committedInputPaths = {
  build_offline_sha256: buildLock.recipe?.build_offline?.path,
  verify_materials_sha256: buildLock.recipe?.verify_materials?.path,
  run_offline_build_sha256: buildLock.recipe?.run_offline_build?.path,
  builder_dockerfile_sha256: buildLock.builder?.dockerfile,
  skia_materials_lock_sha256: buildLock.materials?.skia_dependencies_lock?.path,
  backport_patch_sha256: backport.patch_path,
};
for (const [receiptField, relativePath] of Object.entries(committedInputPaths)) {
  if (typeof relativePath !== "string" || !relativePath) fail(`lock path for ${receiptField} is missing`);
  const actual = sha256(join(packageDir, ...relativePath.split("/")));
  const lockExpected =
    receiptField === "build_offline_sha256"
      ? buildLock.recipe.build_offline.sha256
      : receiptField === "verify_materials_sha256"
        ? buildLock.recipe.verify_materials.sha256
        : receiptField === "run_offline_build_sha256"
          ? buildLock.recipe.run_offline_build.sha256
          : receiptField === "builder_dockerfile_sha256"
            ? buildLock.builder.dockerfile_sha256
            : receiptField === "skia_materials_lock_sha256"
              ? buildLock.materials.skia_dependencies_lock.sha256
              : backport.patch_sha256;
  requireEqual(actual, lockExpected, `committed ${relativePath} digest`);
  requireEqual(receipt.committed_inputs?.[receiptField], actual, `receipt ${receiptField}`);
}
requireSha256(receipt.committed_inputs?.native_build_lock_sha256, "receipt native build lock digest");
requireEqual(
  receipt.committed_inputs?.normalized_source_tar_sha256,
  buildLock.materials?.normalized_source_tar?.sha256,
  "receipt normalized source tar digest",
);
requireEqual(
  receipt.committed_inputs?.normalized_source_tar_size_bytes,
  buildLock.materials?.normalized_source_tar?.size_bytes,
  "receipt normalized source tar size",
);

const expectedSkiaLock = buildLock.materials?.skia_dependencies_lock;
requireSha256(expectedSkiaLock?.sha256, "lock Skia dependency lock digest");
requireSha256(expectedSkiaLock?.skia_deps_sha256, "lock Skia DEPS digest");
requireSha256(expectedSkiaLock?.gn_sha256, "lock GN digest");
requireEqual(receipt.source?.skia_dependencies?.manifest_sha256, expectedSkiaLock.sha256, "Skia dependency lock digest");
requireEqual(receipt.source?.skia_dependencies?.skia_deps_sha256, expectedSkiaLock.skia_deps_sha256, "Skia DEPS digest");
requireEqual(receipt.source?.skia_dependencies?.git_dependency_count, expectedSkiaLock.required_git_dependencies, "Skia Git dependency count");
requireEqual(receipt.source?.skia_dependencies?.gn?.sha256, expectedSkiaLock.gn_sha256, "material GN digest");
requireEqual(receipt.builder?.gn?.sha256, expectedSkiaLock.gn_sha256, "builder GN digest");

const run = receipt.run;
for (const field of ["run_id", "run_label", "container_name", "source_volume_name", "output_volume_name", "output_id"]) {
  if (typeof run?.[field] !== "string" || !run[field]) fail(`receipt run ${field} is missing`);
}
requireEqual(run.network_mode, "none", "receipt run network mode");
requireEqual(run.builder_image, expectedBuilderImage, "receipt run builder image");
requireEqual(run.normalized_source_tar?.sha256, buildLock.materials.normalized_source_tar.sha256, "receipt run source tar digest");
requireEqual(run.normalized_source_tar?.size_bytes, buildLock.materials.normalized_source_tar.size_bytes, "receipt run source tar size");

const expectedBinary = receipt.outputs?.binary;
requireEqual(expectedBinary?.path, "skia.linux-x64-gnu.node", "receipt binary path");
requireSha256(expectedBinary?.sha256, "receipt binary digest");
requirePositiveInteger(expectedBinary?.size_bytes, "receipt binary size");
const binaryStat = statSync(binaryPath);
requireEqual(binaryStat.size, expectedBinary.size_bytes, "native binary size");
requireEqual(sha256(binaryPath), expectedBinary.sha256, "native binary digest");

const expectedArchivePaths = buildLock.reproducibility?.required_skia_static_archives;
if (!Array.isArray(expectedArchivePaths) || expectedArchivePaths.length === 0) {
  fail("lock exact Skia static archive inventory is missing");
}
const archives = receipt.outputs?.skia_static_archives;
if (!Array.isArray(archives) || archives.length !== expectedArchivePaths.length) {
  fail("receipt Skia static archive inventory count is incorrect");
}
const seen = new Set();
for (let index = 0; index < archives.length; index += 1) {
  const archive = archives[index];
  requireEqual(archive?.path, expectedArchivePaths[index], `Skia archive path ${index}`);
  if (seen.has(archive.path)) fail(`duplicate Skia archive path: ${archive.path}`);
  seen.add(archive.path);
  requirePositiveInteger(archive?.size_bytes, `Skia archive size for ${archive.path}`);
  requireSha256(archive?.sha256, `Skia archive digest for ${archive.path}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema_version: "life_links.canvas_native_package_verification.v2",
  package: `${EXPECTED_PACKAGE_NAME}@${EXPECTED_PACKAGE_VERSION}`,
  target: EXPECTED_TARGET,
  builder_image: expectedBuilderImage,
  binary_sha256: expectedBinary.sha256,
  binary_size_bytes: expectedBinary.size_bytes,
  skia_static_archive_count: archives.length,
  run_id: run.run_id,
  output_id: run.output_id,
  source_license_evidence: {
    schema_version: EXPECTED_SOURCE_CLOSURE_SCHEMA,
    engineering_evidence_verified: true,
    legal_clearance_claimed: false,
    source_materials_sha256: sourceMaterials.sha256,
    third_party_notices_sha256: closure.third_party_notices.sha256,
    licenses_content_tree_sha256: licenseIdentity.content_tree_sha256,
    license_file_count: licenseIdentity.file_count,
    license_byte_count: licenseIdentity.byte_count,
    normalized_source_tar_sha256: sourceTar.sha256,
    exact_sources_unavailable: [],
  },
})}\n`);
