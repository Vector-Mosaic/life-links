import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { requireDistinctRuns, usageDocument } from "./qualify-native.mjs";
import { materializeCommittedPackage } from "./run-offline-build.mjs";
import {
  EXPECTED_DRAW_IMAGE_RGBA_SHA256,
  inspectRunOutputDirectory,
  readStableRegularFile,
  validateWrapperSmokeEvidence,
} from "./verify-qualification.mjs";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BINARY_NAME = "skia.linux-x64-gnu.node";
const REFERENCE_BINARY = readFileSync(join(PACKAGE_DIR, BINARY_NAME));
const temporaryRoots = [];
const temporaryRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "life-links-canvas-qualification-test-"));
  temporaryRoots.push(root);
  return root;
};
afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path) => sha256(readFileSync(path));
const REQUIRED_DRAW_IMAGE_SOURCE_SIGNATURE = [
  "+pub struct DrawImageSource<'a>(",
  "+  pub Either3<&'a mut CanvasElement<'a>, &'a mut SVGCanvas<'a>, &'a mut Image>,",
  "+);",
].join("\n");
const LIFETIME_OMITTED_DRAW_IMAGE_SOURCE_SIGNATURE = [
  "+pub struct DrawImageSource<'a>(",
  "+  pub Either3<&'a mut CanvasElement, &'a mut SVGCanvas, &'a mut Image>,",
  "+);",
].join("\n");

const requireExplicitDrawImageSourceLifetimes = (patch) => {
  assert.ok(
    patch.includes(REQUIRED_DRAW_IMAGE_SOURCE_SIGNATURE),
    "DrawImageSource must bind CanvasElement<'a> and SVGCanvas<'a> in its struct signature",
  );
  assert.ok(
    !patch.includes(LIFETIME_OMITTED_DRAW_IMAGE_SOURCE_SIGNATURE),
    "DrawImageSource must reject the lifetime-omitted CanvasElement and SVGCanvas struct signature",
  );
};

const rebindSourceManifestFixture = (packageDir, mutate = () => {}) => {
  const lockPath = join(packageDir, "native-build.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const sourceMaterials = lock.source_closure.source_materials;
  const manifestPath = join(packageDir, sourceMaterials.path);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.source_derivation = structuredClone(lock.source_derivation);
  mutate(manifest);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(manifestPath, manifestBytes);
  const manifestSha = sha256(manifestBytes);
  const sidecarPath = join(packageDir, sourceMaterials.sidecar_path);
  const sidecarBytes = Buffer.from(`${manifestSha}  SOURCE_MATERIALS.json\n`);
  writeFileSync(sidecarPath, sidecarBytes);
  lock.source_closure.source_materials.sha256 = manifestSha;
  lock.source_closure.source_materials.sidecar_sha256 = sha256(sidecarBytes);
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
};

const requirePortableBundlePath = (path, label) => {
  assert.equal(typeof path, "string", `${label} must be a string`);
  assert.ok(path.length > 0, `${label} must not be empty`);
  assert.ok(!path.startsWith("/"), `${label} must be bundle-relative`);
  assert.ok(!/^[A-Za-z]:[\\/]/.test(path), `${label} must not use a workstation path`);
  assert.ok(!path.includes("\\"), `${label} must use portable separators`);
  assert.ok(!path.split("/").includes(".."), `${label} must not escape the bundle root`);
};

const collectLocalFileRecords = (value, label = "manifest", records = []) => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectLocalFileRecords(entry, `${label}[${index}]`, records));
    return records;
  }
  if (!value || typeof value !== "object") return records;
  if (
    Object.hasOwn(value, "path") &&
    Object.hasOwn(value, "size_bytes") &&
    Object.hasOwn(value, "sha256")
  ) {
    records.push({ label, record: value });
  }
  for (const [key, entry] of Object.entries(value)) {
    collectLocalFileRecords(entry, `${label}.${key}`, records);
  }
  return records;
};

const assertSourceBundleClosureManifest = (manifest) => {
  assert.equal(manifest.schema_version, "life_links.bc270.source_closure.v1");
  assert.equal(manifest.bundle_root, ".");
  assert.equal(manifest.verification.portable_bundle_inventory_complete, true);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "source bundle inventory must be nonempty");

  const inventory = new Map();
  const forbiddenScratchRoots = new Set(["_scratch-license-extract", "_scratch-manylinux-cross"]);
  for (const file of manifest.files) {
    requirePortableBundlePath(file.path, `source bundle inventory path ${String(file.path)}`);
    assert.ok(
      !forbiddenScratchRoots.has(file.path.split("/")[0]),
      `source bundle inventory must exclude scratch trees: ${file.path}`,
    );
    assert.ok(!inventory.has(file.path), `source bundle inventory path must be unique: ${file.path}`);
    inventory.set(file.path, file);
  }

  const requireInventoried = (path, label) => {
    requirePortableBundlePath(path, label);
    assert.ok(inventory.has(path), `${label} is not inventoried: ${path}`);
    return inventory.get(path);
  };
  const requireInventoriedRecord = (record, label) => {
    const inventoried = requireInventoried(record.path, `${label} path`);
    assert.equal(inventoried.size_bytes, record.size_bytes, `${label} size differs from inventory`);
    assert.equal(inventoried.sha256, record.sha256, `${label} digest differs from inventory`);
  };
  const requireInventoriedPrefix = (prefix, label) => {
    requirePortableBundlePath(prefix, label);
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    assert.ok(
      [...inventory.keys()].some((path) => path.startsWith(normalizedPrefix)),
      `${label} has no inventoried descendants: ${prefix}`,
    );
  };

  const historicalBinary = manifest.historical_pre_backport_reference.subject_binary;
  assert.equal(historicalBinary.reference_scope, "external-historical-audit-artifact");
  assert.equal(historicalBinary.external_identifier, "bc270-pre-backport-run-a-native-binary");
  assert.ok(!Object.hasOwn(historicalBinary, "path"), "external historical binary must not carry a local path");
  assert.match(historicalBinary.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(historicalBinary.size_bytes) && historicalBinary.size_bytes > 0);

  const primarySource = manifest.primary_normalized_canvas_source;
  assert.equal(primarySource.path, "normalized-canvas-materials.tar");
  requireInventoriedRecord(primarySource, "primary normalized canvas source");

  const canonicalInputs = manifest.source_derivation_evidence.canonical_package_inputs;
  for (const [label, record] of [
    ["canonical native build lock", canonicalInputs.native_build_lock],
    ["canonical backport patch", canonicalInputs.backport_patch],
    ...Object.entries(canonicalInputs.build_recipe_and_material_inputs).map(([name, record]) => [
      `canonical package input ${name}`,
      record,
    ]),
    ["bootstrap binary", manifest.exact_run_a.binary],
    ["bootstrap build receipt", manifest.exact_run_a.build_receipt],
    ["bootstrap run attestation", manifest.exact_run_a.run_attestation],
  ]) {
    requireInventoriedRecord(record, label);
  }

  for (const backport of manifest.source_derivation.backports) {
    requireInventoried(backport.patch_path, "source derivation backport");
  }
  requireInventoried(manifest.verification.generator, "source manifest generator");

  for (const evidence of Object.values(manifest.final_link_analysis.runtime_base.evidence)) {
    requireInventoried(evidence, "runtime-base evidence");
  }
  for (const selection of Object.values(manifest.final_link_analysis.static_selected_members)) {
    requireInventoried(selection.evidence, "selected-member evidence");
  }
  requireInventoriedPrefix(manifest.exact_run_a.evidence_root, "patched-bootstrap evidence root");
  requireInventoriedPrefix(
    manifest.historical_pre_backport_reference.evidence_root,
    "historical evidence root",
  );

  for (const component of manifest.components) {
    component.license_paths.forEach((path) => requireInventoried(path, `${component.id} license`));
  }
  for (const requirement of manifest.notice_and_source_requirements) {
    for (const artifact of requirement.artifacts) {
      if (artifact.endsWith("/")) requireInventoriedPrefix(artifact, `${requirement.component} artifact`);
      else requireInventoried(artifact, `${requirement.component} artifact`);
    }
  }

  for (const { label, record } of collectLocalFileRecords(manifest)) {
    requireInventoriedRecord(record, label);
  }
};

test("source closure inventory resolves local records and excludes scratch and external history", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "SOURCE_MATERIALS.json"), "utf8"));
  assert.doesNotThrow(() => assertSourceBundleClosureManifest(manifest));

  const missingMaterializedInput = structuredClone(manifest);
  missingMaterializedInput.files = missingMaterializedInput.files.filter(
    (file) => file.path !== manifest.exact_run_a.build_receipt.path,
  );
  assert.throws(
    () => assertSourceBundleClosureManifest(missingMaterializedInput),
    /bootstrap build receipt path is not inventoried/,
  );

  const scratchInventory = structuredClone(manifest);
  scratchInventory.files.push({ path: "_scratch-license-extract/transient.txt", size_bytes: 1, sha256: "0".repeat(64) });
  assert.throws(() => assertSourceBundleClosureManifest(scratchInventory), /must exclude scratch trees/);

  const localHistoricalBinary = structuredClone(manifest);
  localHistoricalBinary.historical_pre_backport_reference.subject_binary.path =
    "retained-run-a-output/skia.linux-x64-gnu.node";
  assert.throws(
    () => assertSourceBundleClosureManifest(localHistoricalBinary),
    /external historical binary must not carry a local path/,
  );
});

test("backport binds CanvasElement and SVGCanvas lifetimes without compiling Rust", () => {
  const lock = JSON.parse(readFileSync(join(PACKAGE_DIR, "native-build.lock.json"), "utf8"));
  const patchPath = join(PACKAGE_DIR, ...lock.source_derivation.backports[0].patch_path.split("/"));
  const patch = readFileSync(patchPath, "utf8").replaceAll("\r\n", "\n");
  assert.doesNotThrow(() => requireExplicitDrawImageSourceLifetimes(patch));

  const lifetimeOmitted = patch.replace(
    REQUIRED_DRAW_IMAGE_SOURCE_SIGNATURE,
    LIFETIME_OMITTED_DRAW_IMAGE_SOURCE_SIGNATURE,
  );
  assert.notEqual(lifetimeOmitted, patch, "test fixture must replace the exact DrawImageSource signature");
  assert.throws(
    () => requireExplicitDrawImageSourceLifetimes(lifetimeOmitted),
    /must bind CanvasElement<'a> and SVGCanvas<'a>/,
  );
});

test("materializes committed non-UTF-8 package bytes without replacement", () => {
  const sourceCommit = execFileSync(
    "git",
    ["-c", "core.hooksPath=", "-C", PACKAGE_DIR, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const packagePrefix = execFileSync(
    "git",
    ["-c", "core.hooksPath=", "-C", PACKAGE_DIR, "rev-parse", "--show-prefix"],
    { encoding: "utf8" },
  ).trim();
  const fixture = "LICENSES/toolchains/crosstool-sysroot/crosstool-ng/licenses.d/by-sa/deed_files/deed.gif";
  const committedBytes = execFileSync(
    "git",
    ["-c", "core.hooksPath=", "-C", PACKAGE_DIR, "cat-file", "blob", `${sourceCommit}:${packagePrefix}${fixture}`],
  );
  assert.ok(committedBytes.includes(0xb3), "fixture must retain its non-UTF-8 byte");
  const materialized = materializeCommittedPackage(sourceCommit);
  try {
    assert.deepEqual(readFileSync(join(materialized.packageDir, fixture)), committedBytes);
  } finally {
    rmSync(materialized.temporaryRoot, { recursive: true, force: true });
  }
});

const packageFixture = (root) => {
  const target = join(root, "package");
  cpSync(PACKAGE_DIR, target, {
    recursive: true,
    filter: (source) => !["skia.linux-x64-gnu.node", "build-receipt.json", "qualification-receipt.json"].includes(source.split(/[\\/]/).at(-1)),
  });
  rebindSourceManifestFixture(target);
  return target;
};

const volume = (name, identity) => ({
  Name: name,
  Driver: "local",
  Scope: "local",
  CreatedAt: "2026-08-31T01:00:00Z",
  Labels: { "com.vectormosaic.owner": "life-links-bc270" },
  Options: {},
  identity_sha256: identity.repeat(64),
});

const writeRun = (packageDir, root, label, identity, overrides = {}) => {
  const lock = JSON.parse(readFileSync(join(packageDir, "native-build.lock.json"), "utf8"));
  const binary = overrides.binarySuffix
    ? Buffer.concat([REFERENCE_BINARY, Buffer.from(overrides.binarySuffix)])
    : REFERENCE_BINARY;
  const runId = `${identity.repeat(8)}-${identity.repeat(4)}-4${identity.repeat(3)}-8${identity.repeat(3)}-${identity.repeat(12)}`;
  const containerId = identity.repeat(64);
  const imageId = `sha256:${"a".repeat(64)}`;
  const sourceVolume = volume(`source-${identity}`, identity === "a" ? "1" : "2");
  const outputVolume = { ...volume(`output-${identity}`, identity === "a" ? "3" : "4"), output_id: `output-${identity.repeat(8)}` };
  const run = {
    run_id: overrides.runId ?? runId,
    run_label: label,
    container_name: `container-${identity}`,
    source_volume_name: sourceVolume.Name,
    output_volume_name: outputVolume.Name,
    output_id: outputVolume.output_id,
    builder_image: lock.builder.derived_image,
    network_mode: overrides.networkMode ?? "none",
    normalized_source_tar: {
      sha256: lock.materials.normalized_source_tar.sha256,
      size_bytes: lock.materials.normalized_source_tar.size_bytes,
    },
    correlation_source: "life_links.canvas_offline_build_runner.v1",
  };
  const inputHashes = {
    build_offline_sha256: fileSha(join(packageDir, lock.recipe.build_offline.path)),
    verify_materials_sha256: fileSha(join(packageDir, lock.recipe.verify_materials.path)),
    run_offline_build_sha256: fileSha(join(packageDir, lock.recipe.run_offline_build.path)),
    native_build_lock_sha256: fileSha(join(packageDir, "native-build.lock.json")),
    builder_dockerfile_sha256: fileSha(join(packageDir, lock.builder.dockerfile)),
    skia_materials_lock_sha256: fileSha(join(packageDir, lock.materials.skia_dependencies_lock.path)),
    backport_patch_sha256: fileSha(join(packageDir, lock.source_derivation.backports[0].patch_path)),
    normalized_source_tar_sha256: lock.materials.normalized_source_tar.sha256,
    normalized_source_tar_size_bytes: lock.materials.normalized_source_tar.size_bytes,
  };
  const archives = lock.reproducibility.required_skia_static_archives.map((path, index) => ({
    path,
    sha256: (index % 10).toString().repeat(64),
    size_bytes: index + 1,
  }));
  const receipt = {
    schema_version: overrides.schema ?? "life_links.canvas_native_build_receipt.v3",
    package: { name: "@napi-rs/canvas-linux-x64-gnu", version: "0.1.100", target: "x86_64-unknown-linux-gnu" },
    run,
    committed_inputs: inputHashes,
    source: {
      canvas: {
        base_commit: lock.source_derivation.base_commit,
        base_tree: lock.source_derivation.base_tree,
        effective_tree: lock.source_derivation.effective_tree,
        backports: lock.source_derivation.backports,
      },
      skia_commit: lock.materials.skia_commit,
      depot_tools_commit: lock.materials.depot_tools_commit,
      cargo_lock_sha256: lock.materials.cargo_lock_sha256,
      native_build_lock_sha256: inputHashes.native_build_lock_sha256,
      skia_dependencies: {
        manifest_sha256: lock.materials.skia_dependencies_lock.sha256,
        skia_deps_sha256: lock.materials.skia_dependencies_lock.skia_deps_sha256,
        git_dependency_count: lock.materials.skia_dependencies_lock.required_git_dependencies,
        gn: { sha256: lock.materials.skia_dependencies_lock.gn_sha256 },
      },
    },
    builder: {
      image: lock.builder.derived_image,
      rustc: "rustc 1.94.1 (fixture)",
      cargo: "cargo 1.94.1 (fixture)",
      node: "v22.18.0",
      clang: { path: "/usr/bin/clang", sha256: "5".repeat(64), version: "clang" },
      ld: { path: "/usr/bin/ld", sha256: "6".repeat(64), version: "ld" },
      ninja: { path: "/usr/bin/ninja", sha256: "7".repeat(64), version: "ninja" },
      gn: { path: "/work/canvas/skia/bin/gn", sha256: lock.materials.skia_dependencies_lock.gn_sha256, version: "gn" },
    },
    outputs: {
      binary: { path: "skia.linux-x64-gnu.node", sha256: sha256(binary), size_bytes: binary.length },
      skia_static_archives: overrides.archives ?? archives,
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const attestation = {
    schema_version: "life_links.canvas_native_run_attestation.v1",
    run_id: run.run_id,
    run_label: label,
    source_commit: "b".repeat(40),
    package_path: "systems/life_links/packages/canvas-linux-x64-gnu",
    package_tree: "c".repeat(40),
    package_file_count: 12,
    container: {
      id: overrides.containerId ?? containerId,
      name: run.container_name,
      requested_image: lock.builder.derived_image,
      image_id: imageId,
      platform: "linux/amd64",
      network_mode: overrides.networkMode ?? "none",
      started_at_utc: "2026-08-31T01:00:00Z",
      finished_at_utc: "2026-08-31T01:10:00Z",
      exit_code: overrides.exitCode ?? 0,
      oom_killed: overrides.oomKilled ?? false,
    },
    source_volume: sourceVolume,
    output_volume: outputVolume,
    sealed_source_tar: {
      file: lock.materials.normalized_source_tar.file,
      sha256: lock.materials.normalized_source_tar.sha256,
      size_bytes: lock.materials.normalized_source_tar.size_bytes,
    },
    outputs: {
      binary: { path: "skia.linux-x64-gnu.node", sha256: sha256(binary), size_bytes: binary.length },
      build_receipt: { path: "build-receipt.json", sha256: sha256(receiptBytes), size_bytes: receiptBytes.length },
      build_log: { path: "fixture.log", sha256: "8".repeat(64), size_bytes: 1 },
    },
    retained: { container: false, volumes: true },
  };
  const directory = join(root, `run-${label}`);
  mkdirSync(directory);
  writeFileSync(join(directory, "skia.linux-x64-gnu.node"), binary);
  writeFileSync(join(directory, "build-receipt.json"), receiptBytes);
  writeFileSync(join(directory, "run-attestation.json"), `${JSON.stringify(attestation, null, 2)}\n`);
  return { directory, binary, receipt, attestation };
};

const rewriteRunReceipt = (fixture, mutate) => {
  const receiptPath = join(fixture.directory, "build-receipt.json");
  const attestationPath = join(fixture.directory, "run-attestation.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  mutate(receipt);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(receiptPath, receiptBytes);
  const attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
  attestation.outputs.build_receipt.sha256 = sha256(receiptBytes);
  attestation.outputs.build_receipt.size_bytes = receiptBytes.length;
  writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
};

test("accepts two fully attested exact-inventory outputs and requires independent identities", () => {
  const root = temporaryRoot();
  const packageDir = packageFixture(root);
  const runAFixture = writeRun(packageDir, root, "a", "a");
  const runBFixture = writeRun(packageDir, root, "b", "b");
  const runA = inspectRunOutputDirectory(packageDir, runAFixture.directory, "run A");
  const runB = inspectRunOutputDirectory(packageDir, runBFixture.directory, "run B");
  assert.doesNotThrow(() => requireDistinctRuns(runA, runB));
  assert.equal(runA.archives.length, 28);
  assert.equal(runA.binarySha, runB.binarySha);

  runB.attestation.run_id = runA.attestation.run_id;
  assert.throws(() => requireDistinctRuns(runA, runB), /same run ID/);
});

test("rejects pre-v3 receipts and hand-written non-attested two-file fixtures", () => {
  const root = temporaryRoot();
  const packageDir = packageFixture(root);
  const legacy = writeRun(packageDir, root, "a", "a", { schema: "life_links.canvas_native_build_receipt.v2" });
  assert.throws(() => inspectRunOutputDirectory(packageDir, legacy.directory, "legacy"), /receipt schema mismatch/);

  const fake = join(root, "fake-two-file");
  mkdirSync(fake);
  writeFileSync(join(fake, "skia.linux-x64-gnu.node"), "same");
  writeFileSync(join(fake, "build-receipt.json"), "{}\n");
  assert.throws(() => inspectRunOutputDirectory(packageDir, fake, "fake"), /unexpected or missing files/);
});

test("rejects tampered effective-tree, backport metadata, and committed patch-digest bindings", () => {
  const cases = [
    {
      name: "effective-tree",
      identity: "a",
      mutate: (receipt) => { receipt.source.canvas.effective_tree = "d".repeat(40); },
      pattern: /canvas effective tree mismatch/,
    },
    {
      name: "backport-metadata",
      identity: "b",
      mutate: (receipt) => { receipt.source.canvas.backports[0].origin_commit = "d".repeat(40); },
      pattern: /canvas backport binding mismatch/,
    },
    {
      name: "committed-patch-digest",
      identity: "c",
      mutate: (receipt) => { receipt.committed_inputs.backport_patch_sha256 = "d".repeat(64); },
      pattern: /backport patch digest mismatch/,
    },
  ];
  for (const fixtureCase of cases) {
    const root = temporaryRoot();
    const packageDir = packageFixture(root);
    const fixture = writeRun(packageDir, root, fixtureCase.name, fixtureCase.identity);
    rewriteRunReceipt(fixture, fixtureCase.mutate);
    assert.throws(
      () => inspectRunOutputDirectory(packageDir, fixture.directory, fixtureCase.name),
      fixtureCase.pattern,
    );
  }
});

test("requires exact drawImage receipt evidence and honest SVGCanvas source acceptance", () => {
  const binarySha = sha256(REFERENCE_BINARY);
  const binarySize = REFERENCE_BINARY.length;
  const wrapperSmoke = {
    network_mode: "none",
    pnpm_version: "10.14.0",
    project_package_sha256: "a".repeat(64),
    lockfile_sha256: "b".repeat(64),
    result: {
      schema_version: "life_links.canvas_wrapper_smoke.v2",
      status: "ok",
      native: {
        package: "@napi-rs/canvas-linux-x64-gnu",
        sha256: binarySha,
        size_bytes: binarySize,
      },
      render: {
        draw_image: {
          canvas_rgba_sha256: EXPECTED_DRAW_IMAGE_RGBA_SHA256,
          image_rgba_sha256: EXPECTED_DRAW_IMAGE_RGBA_SHA256,
          svg_canvas_source_acceptance: "accepted_without_type_error",
          invalid_source_error: "TypeError",
        },
      },
    },
  };
  assert.doesNotThrow(() => validateWrapperSmokeEvidence({ wrapperSmoke, binarySha, binarySize }));

  for (const [label, mutate, pattern] of [
    [
      "canvas digest",
      (receipt) => { receipt.result.render.draw_image.canvas_rgba_sha256 = "0".repeat(64); },
      /canvas drawImage pixel digest mismatch/,
    ],
    [
      "Image digest",
      (receipt) => { receipt.result.render.draw_image.image_rgba_sha256 = "0".repeat(64); },
      /Image drawImage pixel digest mismatch/,
    ],
    [
      "SVGCanvas acceptance",
      (receipt) => { receipt.result.render.draw_image.svg_canvas_source_acceptance = "visible_render_verified"; },
      /SVGCanvas drawImage source acceptance mismatch/,
    ],
    [
      "invalid-source type",
      (receipt) => { receipt.result.render.draw_image.invalid_source_error = "Error"; },
      /invalid drawImage source error mismatch/,
    ],
  ]) {
    const tampered = structuredClone(wrapperSmoke);
    mutate(tampered);
    assert.throws(
      () => validateWrapperSmokeEvidence({ wrapperSmoke: tampered, binarySha, binarySize }),
      pattern,
      label,
    );
  }
});

test("rejects network, exit, OOM and incomplete exact archive evidence", () => {
  for (const [name, identity, override, pattern] of [
    ["network", "a", { networkMode: "default" }, /network mode mismatch/],
    ["exit", "b", { exitCode: 7 }, /exit code mismatch/],
    ["oom", "c", { oomKilled: true }, /OOM status mismatch/],
  ]) {
    const root = temporaryRoot();
    const packageDir = packageFixture(root);
    const fixture = writeRun(packageDir, root, name, identity, override);
    assert.throws(() => inspectRunOutputDirectory(packageDir, fixture.directory, name), pattern);
  }

  const root = temporaryRoot();
  const packageDir = packageFixture(root);
  const lock = JSON.parse(readFileSync(join(packageDir, "native-build.lock.json"), "utf8"));
  const incomplete = lock.reproducibility.required_skia_static_archives.slice(0, 2).map((path, index) => ({
    path,
    sha256: String(index + 1).repeat(64),
    size_bytes: index + 1,
  }));
  const fixture = writeRun(packageDir, root, "short", "e", { archives: incomplete });
  assert.throws(() => inspectRunOutputDirectory(packageDir, fixture.directory, "short"), /inventory count/);
});

test("rejects hard-linked run inputs and observes stable bounded reads", () => {
  const root = temporaryRoot();
  const packageDir = packageFixture(root);
  const runA = writeRun(packageDir, root, "a", "a");
  const runB = join(root, "run-hardlink");
  mkdirSync(runB);
  for (const name of ["skia.linux-x64-gnu.node", "build-receipt.json", "run-attestation.json"]) {
    linkSync(join(runA.directory, name), join(runB, name));
  }
  const first = inspectRunOutputDirectory(packageDir, runA.directory, "run A");
  const second = inspectRunOutputDirectory(packageDir, runB, "run B");
  assert.throws(() => requireDistinctRuns(first, second), /hard-linked binary/);
  assert.equal(
    readStableRegularFile(join(runA.directory, "skia.linux-x64-gnu.node"), "binary", REFERENCE_BINARY.length).length,
    statSync(join(runA.directory, "skia.linux-x64-gnu.node")).size,
  );
});

test("rejects tampered source, notice, and license projections", () => {
  for (const [name, relativePath] of [
    ["source manifest", "SOURCE_MATERIALS.json"],
    ["third-party notice", "THIRD_PARTY_NOTICES.md"],
    ["license", "LICENSES/canvas/LICENSE"],
    ["drawImage backport", "native-build/patches/0001-backport-draw-image-source-napi-3.12.patch"],
  ]) {
    const root = temporaryRoot();
    const packageDir = packageFixture(root);
    const fixture = writeRun(packageDir, root, name.replaceAll(" ", "-"), "f");
    writeFileSync(join(packageDir, ...relativePath.split("/")), "\nprojection tamper\n", { flag: "a" });
    assert.throws(
      () => inspectRunOutputDirectory(packageDir, fixture.directory, name),
      /source-material manifest digest|third-party notice digest|projected license tree|drawImage backport patch digest/,
    );
  }
});

test("rejects source-material derivation drift even when manifest digests are rebound", () => {
  const root = temporaryRoot();
  const packageDir = packageFixture(root);
  rebindSourceManifestFixture(packageDir, (manifest) => {
    manifest.source_derivation.effective_tree = "d".repeat(40);
  });
  const fixture = writeRun(packageDir, root, "source-derivation", "a");
  assert.throws(
    () => inspectRunOutputDirectory(packageDir, fixture.directory, "source derivation"),
    /source-material source derivation binding mismatch/,
  );
});

test("usage states the narrow build and qualification boundaries", () => {
  const usage = usageDocument();
  assert.equal(usage.status, "ok");
  assert.match(usage.boundary, /does not build, deploy, or establish source-license closure/);
});
