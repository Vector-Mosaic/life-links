import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BINARY_NAME = "skia.linux-x64-gnu.node";
export const QUALIFICATION_NAME = "qualification-receipt.json";
export const RUN_A_RECEIPT_NAME = "run-a-build-receipt.json";
export const RUN_A_ATTESTATION_NAME = "run-a-attestation.json";
export const RUN_B_RECEIPT_NAME = "run-b-build-receipt.json";
export const RUN_B_ATTESTATION_NAME = "run-b-attestation.json";
export const QUALIFICATION_SCHEMA = "life_links.canvas_native_qualification.v2";
export const BUILD_RECEIPT_SCHEMA = "life_links.canvas_native_build_receipt.v3";
export const RUN_ATTESTATION_SCHEMA = "life_links.canvas_native_run_attestation.v1";
export const SOURCE_CLOSURE_SCHEMA = "life_links.canvas_source_closure_binding.v3";
const PACKAGE_NAME = "@napi-rs/canvas-linux-x64-gnu";
const PACKAGE_VERSION = "0.1.100";
const TARGET = "x86_64-unknown-linux-gnu";
export const EXPECTED_DRAW_IMAGE_RGBA_SHA256 = "fcd1147fc6d1f368f4d07d9830efa3367654ab51bd57960d9a73593f5d1a21d1";
const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_PACKAGE_NAMES = new Set([
  BINARY_NAME,
  "build-receipt.json",
  QUALIFICATION_NAME,
]);

const fail = (message) => {
  throw new Error(`life-links canvas qualification verification: ${message}`);
};
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
const sameStableValue = (left, right) => JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
const canonicalJson = (value) => `${JSON.stringify(stableValue(value))}\n`;

const stableSnapshot = (value) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");

export const readStableRegularFile = (path, label, maxBytes) => {
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.size < 1n || before.size > BigInt(maxBytes)) {
    fail(`${label} must be a bounded regular non-symlink file`);
  }
  const descriptor = openSync(path, "r");
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(`${label} changed before it was opened`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readFileChunk(descriptor, bytes, offset);
      if (count === 0) fail(`${label} ended before its recorded size`);
      offset += count;
    }
    const afterHandle = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(path, { bigint: true });
    if (
      stableSnapshot(opened) !== stableSnapshot(afterHandle) ||
      stableSnapshot(before) !== stableSnapshot(afterPath) ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile()
    ) {
      fail(`${label} changed while it was read`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
};

const readFileChunk = (descriptor, buffer, offset) => {
  const scratch = Buffer.allocUnsafe(Math.min(1024 * 1024, buffer.length - offset));
  const count = readSync(descriptor, scratch, 0, scratch.length, null);
  scratch.copy(buffer, offset, 0, count);
  return count;
};

const parseJson = (bytes, label) => {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
    return value;
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
};

const requireSha = (value, label) => {
  if (!/^[0-9a-f]{64}$/.test(value ?? "")) fail(`${label} is missing or malformed`);
  return value;
};
const requireEqual = (actual, expected, label) => {
  if (actual !== expected) fail(`${label} mismatch`);
};
const requirePositive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is missing or invalid`);
  return value;
};

const inspectDirectory = (directory, expectedNames, label) => {
  const linkStat = lstatSync(directory);
  if (linkStat.isSymbolicLink() || !linkStat.isDirectory()) fail(`${label} must be a real directory`);
  const realDirectory = realpathSync(directory);
  const actualNames = readdirSync(realDirectory).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const expected = [...expectedNames].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  if (!sameStableValue(actualNames, expected)) fail(`${label} contains unexpected or missing files`);
  return realDirectory;
};

export const packageContentIdentity = (packageDirectory) => {
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const path = join(directory, entry.name);
      const rel = relative(packageDirectory, path).split(sep).join("/");
      if (entry.isSymbolicLink()) fail(`committed package contains a symlink: ${rel}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !GENERATED_PACKAGE_NAMES.has(rel)) {
        const bytes = readFileSync(path);
        entries.push({ path: rel, sha256: sha256Bytes(bytes), size_bytes: bytes.length });
      } else if (!entry.isFile()) fail(`committed package contains an unsupported entry: ${rel}`);
    }
  };
  visit(packageDirectory);
  const content = Buffer.from(canonicalJson(entries));
  return {
    files: entries,
    file_count: entries.length,
    byte_count: entries.reduce((total, entry) => total + entry.size_bytes, 0),
    content_tree_sha256: sha256Bytes(content),
  };
};

const normalizeSmoke = (smoke) => ({
  schema_version: smoke?.schema_version,
  status: smoke?.status,
  runtime: smoke?.runtime,
  wrapper: smoke?.wrapper,
  native: {
    package: smoke?.native?.package,
    sha256: smoke?.native?.sha256,
    size_bytes: smoke?.native?.size_bytes,
  },
  render: smoke?.render,
});

export const validateWrapperSmokeEvidence = ({ wrapperSmoke, binarySha, binarySize }) => {
  const smoke = normalizeSmoke(wrapperSmoke?.result);
  requireEqual(smoke.schema_version, "life_links.canvas_wrapper_smoke.v2", "wrapper smoke schema");
  requireEqual(smoke.status, "ok", "wrapper smoke status");
  requireEqual(smoke.native.sha256, binarySha, "wrapper smoke native digest");
  requireEqual(smoke.native.size_bytes, binarySize, "wrapper smoke native size");
  requireEqual(
    smoke.render?.draw_image?.canvas_rgba_sha256,
    EXPECTED_DRAW_IMAGE_RGBA_SHA256,
    "canvas drawImage pixel digest",
  );
  requireEqual(
    smoke.render?.draw_image?.image_rgba_sha256,
    EXPECTED_DRAW_IMAGE_RGBA_SHA256,
    "Image drawImage pixel digest",
  );
  requireEqual(
    smoke.render?.draw_image?.svg_canvas_source_acceptance,
    "accepted_without_type_error",
    "SVGCanvas drawImage source acceptance",
  );
  requireEqual(smoke.render?.draw_image?.invalid_source_error, "TypeError", "invalid drawImage source error");
  requireEqual(wrapperSmoke?.network_mode, "none", "wrapper smoke network mode");
  requireEqual(wrapperSmoke?.pnpm_version, "10.14.0", "wrapper smoke pnpm version");
  requireSha(wrapperSmoke?.project_package_sha256, "wrapper smoke package digest");
  requireSha(wrapperSmoke?.lockfile_sha256, "wrapper smoke lock digest");
  return smoke;
};

const validateArchiveInventory = (receipt, expectedPaths, label) => {
  const archives = receipt.outputs?.skia_static_archives;
  if (!Array.isArray(archives) || archives.length !== expectedPaths.length) {
    fail(`${label} exact Skia archive inventory count is incorrect`);
  }
  const normalized = archives.map((archive, index) => {
    requireEqual(archive?.path, expectedPaths[index], `${label} archive path ${index}`);
    requireSha(archive?.sha256, `${label} archive digest ${index}`);
    requirePositive(archive?.size_bytes, `${label} archive size ${index}`);
    return { path: archive.path, sha256: archive.sha256, size_bytes: archive.size_bytes };
  });
  return normalized;
};

const inspectRun = ({ binaryBytes, receiptBytes, attestationBytes, lock, label }) => {
  const receipt = parseJson(receiptBytes, `${label} build receipt`);
  const attestation = parseJson(attestationBytes, `${label} run attestation`);
  requireEqual(receipt.schema_version, BUILD_RECEIPT_SCHEMA, `${label} build receipt schema`);
  requireEqual(attestation.schema_version, RUN_ATTESTATION_SCHEMA, `${label} attestation schema`);
  requireEqual(receipt.package?.name, PACKAGE_NAME, `${label} package name`);
  requireEqual(receipt.package?.version, PACKAGE_VERSION, `${label} package version`);
  requireEqual(receipt.package?.target, TARGET, `${label} package target`);
  const binarySha = sha256Bytes(binaryBytes);
  requireEqual(receipt.outputs?.binary?.sha256, binarySha, `${label} binary digest`);
  requireEqual(receipt.outputs?.binary?.size_bytes, binaryBytes.length, `${label} binary size`);
  requireEqual(attestation.outputs?.binary?.sha256, binarySha, `${label} attested binary digest`);
  requireEqual(attestation.outputs?.binary?.size_bytes, binaryBytes.length, `${label} attested binary size`);
  requireEqual(attestation.outputs?.build_receipt?.sha256, sha256Bytes(receiptBytes), `${label} attested receipt digest`);
  requireEqual(attestation.outputs?.build_receipt?.size_bytes, receiptBytes.length, `${label} attested receipt size`);
  requireEqual(receipt.run?.run_id, attestation.run_id, `${label} run ID`);
  requireEqual(receipt.run?.run_label, attestation.run_label, `${label} run label`);
  requireEqual(receipt.run?.container_name, attestation.container?.name, `${label} container name`);
  requireEqual(receipt.run?.source_volume_name, attestation.source_volume?.Name, `${label} source volume name`);
  requireEqual(receipt.run?.output_volume_name, attestation.output_volume?.Name, `${label} output volume name`);
  requireEqual(receipt.run?.output_id, attestation.output_volume?.output_id, `${label} output ID`);
  requireEqual(receipt.run?.builder_image, attestation.container?.requested_image, `${label} builder image`);
  requireEqual(receipt.run?.network_mode, "none", `${label} receipt network mode`);
  requireEqual(attestation.container?.network_mode, "none", `${label} attested network mode`);
  requireEqual(attestation.container?.platform, "linux/amd64", `${label} platform`);
  requireEqual(attestation.container?.exit_code, 0, `${label} exit code`);
  requireEqual(attestation.container?.oom_killed, false, `${label} OOM status`);
  if (!/^[0-9a-f]{64}$/.test(attestation.container?.id ?? "")) fail(`${label} container ID is malformed`);
  if (!/^sha256:[0-9a-f]{64}$/.test(attestation.container?.image_id ?? "")) fail(`${label} image ID is malformed`);
  for (const [volumeLabel, volume] of [["source", attestation.source_volume], ["output", attestation.output_volume]]) {
    if (typeof volume?.Name !== "string" || !volume.Name || typeof volume?.CreatedAt !== "string") {
      fail(`${label} ${volumeLabel} volume identity is incomplete`);
    }
    requireSha(volume.identity_sha256, `${label} ${volumeLabel} volume identity digest`);
  }
  const started = Date.parse(attestation.container?.started_at_utc ?? "");
  const finished = Date.parse(attestation.container?.finished_at_utc ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    fail(`${label} run timestamps are invalid`);
  }
  const sourceTar = lock.materials?.normalized_source_tar;
  requireEqual(attestation.sealed_source_tar?.sha256, sourceTar?.sha256, `${label} source tar digest`);
  requireEqual(attestation.sealed_source_tar?.size_bytes, sourceTar?.size_bytes, `${label} source tar size`);
  requireEqual(receipt.run?.normalized_source_tar?.sha256, sourceTar?.sha256, `${label} receipt source tar digest`);
  requireEqual(receipt.run?.normalized_source_tar?.size_bytes, sourceTar?.size_bytes, `${label} receipt source tar size`);
  const derivation = lock.source_derivation;
  requireEqual(derivation?.schema_version, "life_links.canvas_source_derivation.v1", `${label} source derivation schema`);
  requireEqual(receipt.source?.canvas?.base_commit, derivation?.base_commit, `${label} canvas base commit`);
  requireEqual(receipt.source?.canvas?.base_tree, derivation?.base_tree, `${label} canvas base tree`);
  requireEqual(receipt.source?.canvas?.effective_tree, derivation?.effective_tree, `${label} canvas effective tree`);
  if (!sameStableValue(receipt.source?.canvas?.backports, derivation?.backports)) {
    fail(`${label} canvas backport binding mismatch`);
  }
  requireEqual(
    receipt.committed_inputs?.backport_patch_sha256,
    derivation?.backports?.[0]?.patch_sha256,
    `${label} backport patch digest`,
  );
  const archives = validateArchiveInventory(
    receipt,
    lock.reproducibility?.required_skia_static_archives ?? [],
    label,
  );
  return { receipt, attestation, archives, binarySha, binarySize: binaryBytes.length };
};

const runPackageVerifier = (packageDirectory, binaryBytes, receiptBytes, label) => {
  const temporary = mkdtempSync(join(tmpdir(), "life-links-canvas-package-verify-"));
  try {
    const packageCopy = join(temporary, "package");
    cpSync(packageDirectory, packageCopy, { recursive: true, errorOnExist: true });
    writeFileSync(join(packageCopy, BINARY_NAME), binaryBytes, { flag: "wx" });
    writeFileSync(join(packageCopy, "build-receipt.json"), receiptBytes, { flag: "wx" });
    const output = execFileSync(process.execPath, [join(packageCopy, "native-build", "verify-package.mjs"), packageCopy], {
      cwd: packageCopy,
      env: { PATH: dirname(process.execPath), NO_COLOR: "1" },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    const result = JSON.parse(output);
    if (result.ok !== true || result.binary_sha256 !== sha256Bytes(binaryBytes)) {
      fail(`${label} package verifier did not bind the selected binary`);
    }
    if (
      result.source_license_evidence?.schema_version !== SOURCE_CLOSURE_SCHEMA ||
      result.source_license_evidence?.engineering_evidence_verified !== true ||
      result.source_license_evidence?.legal_clearance_claimed !== false
    ) {
      fail(`${label} package verifier did not establish the bounded source/license evidence binding`);
    }
    return result;
  } catch (error) {
    fail(`${label} package verifier failed: ${String(error.stderr ?? error.message).trim().slice(0, 500)}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

export const inspectRunOutputDirectory = (packageDirectory, runDirectory, label) => {
  const packageDir = realpathSync(packageDirectory);
  const runDir = inspectDirectory(
    runDirectory,
    [BINARY_NAME, "build-receipt.json", "run-attestation.json"],
    `${label} output directory`,
  );
  const binaryBytes = readStableRegularFile(join(runDir, BINARY_NAME), `${label} binary`, MAX_BINARY_BYTES);
  const receiptBytes = readStableRegularFile(join(runDir, "build-receipt.json"), `${label} receipt`, MAX_JSON_BYTES);
  const attestationBytes = readStableRegularFile(join(runDir, "run-attestation.json"), `${label} attestation`, MAX_JSON_BYTES);
  const lock = parseJson(readFileSync(join(packageDir, "native-build.lock.json")), "native build lock");
  const inspected = inspectRun({ binaryBytes, receiptBytes, attestationBytes, lock, label });
  const packageVerification = runPackageVerifier(packageDir, binaryBytes, receiptBytes, label);
  return {
    ...inspected,
    runDir,
    packageDir,
    lock,
    binaryBytes,
    receiptBytes,
    attestationBytes,
    packageVerification,
    fileIdentities: {
      binary: (() => { const value = statSync(join(runDir, BINARY_NAME), { bigint: true }); return `${value.dev}:${value.ino}`; })(),
      receipt: (() => { const value = statSync(join(runDir, "build-receipt.json"), { bigint: true }); return `${value.dev}:${value.ino}`; })(),
      attestation: (() => { const value = statSync(join(runDir, "run-attestation.json"), { bigint: true }); return `${value.dev}:${value.ino}`; })(),
    },
  };
};

export const inspectQualifiedMaterial = (packageDirectory, materialDirectory) => {
  const packageDir = realpathSync(packageDirectory);
  const materialDir = inspectDirectory(
    materialDirectory,
    [
      BINARY_NAME,
      QUALIFICATION_NAME,
      RUN_A_RECEIPT_NAME,
      RUN_A_ATTESTATION_NAME,
      RUN_B_RECEIPT_NAME,
      RUN_B_ATTESTATION_NAME,
    ],
    "qualified material directory",
  );
  const binaryBytes = readStableRegularFile(join(materialDir, BINARY_NAME), "selected binary", MAX_BINARY_BYTES);
  const qualificationBytes = readStableRegularFile(join(materialDir, QUALIFICATION_NAME), "qualification receipt", MAX_JSON_BYTES);
  const runAReceiptBytes = readStableRegularFile(join(materialDir, RUN_A_RECEIPT_NAME), "run A receipt", MAX_JSON_BYTES);
  const runAAttestationBytes = readStableRegularFile(join(materialDir, RUN_A_ATTESTATION_NAME), "run A attestation", MAX_JSON_BYTES);
  const runBReceiptBytes = readStableRegularFile(join(materialDir, RUN_B_RECEIPT_NAME), "run B receipt", MAX_JSON_BYTES);
  const runBAttestationBytes = readStableRegularFile(join(materialDir, RUN_B_ATTESTATION_NAME), "run B attestation", MAX_JSON_BYTES);
  const lock = parseJson(readFileSync(join(packageDir, "native-build.lock.json")), "native build lock");
  const runA = inspectRun({ binaryBytes, receiptBytes: runAReceiptBytes, attestationBytes: runAAttestationBytes, lock, label: "run A" });
  const runB = inspectRun({ binaryBytes, receiptBytes: runBReceiptBytes, attestationBytes: runBAttestationBytes, lock, label: "run B" });
  const distinctPairs = [
    [runA.attestation.run_id, runB.attestation.run_id, "run ID"],
    [runA.attestation.container.id, runB.attestation.container.id, "container ID"],
    [runA.attestation.container.name, runB.attestation.container.name, "container name"],
    [runA.attestation.source_volume.Name, runB.attestation.source_volume.Name, "source volume name"],
    [runA.attestation.source_volume.identity_sha256, runB.attestation.source_volume.identity_sha256, "source volume identity"],
    [runA.attestation.output_volume.Name, runB.attestation.output_volume.Name, "output volume name"],
    [runA.attestation.output_volume.identity_sha256, runB.attestation.output_volume.identity_sha256, "output volume identity"],
    [runA.attestation.output_volume.output_id, runB.attestation.output_volume.output_id, "output ID"],
  ];
  for (const [left, right, label] of distinctPairs) if (left === right) fail(`run A and run B reuse the same ${label}`);
  const buildIdentity = (run) => ({
    package: run.receipt.package,
    committed_inputs: run.receipt.committed_inputs,
    source: run.receipt.source,
    builder: run.receipt.builder,
  });
  if (!sameStableValue(buildIdentity(runA), buildIdentity(runB))) fail("run A and run B build identities differ");
  if (!sameStableValue(runA.archives, runB.archives)) fail("run A and run B archive inventories differ");
  if (runA.binarySha !== runB.binarySha || runA.binarySize !== runB.binarySize) fail("run A and run B binaries differ");
  const packageVerificationA = runPackageVerifier(packageDir, binaryBytes, runAReceiptBytes, "run A");
  const packageVerificationB = runPackageVerifier(packageDir, binaryBytes, runBReceiptBytes, "run B");
  if (!sameStableValue(packageVerificationA.source_license_evidence, packageVerificationB.source_license_evidence)) {
    fail("run A and run B source/license evidence bindings differ");
  }
  return {
    packageDir,
    materialDir,
    lock,
    packageIdentity: packageContentIdentity(packageDir),
    binaryBytes,
    qualificationBytes,
    qualification: parseJson(qualificationBytes, "qualification receipt"),
    runA: { ...runA, receiptBytes: runAReceiptBytes, attestationBytes: runAAttestationBytes },
    runB: { ...runB, receiptBytes: runBReceiptBytes, attestationBytes: runBAttestationBytes },
    sourceLicenseEvidence: packageVerificationA.source_license_evidence,
    archiveInventorySha256: sha256Bytes(Buffer.from(canonicalJson(runA.archives))),
  };
};

export const verifyQualificationMaterial = ({ packageDirectory, materialDirectory, expectedSourceCommit, expectedPackageTree }) => {
  const inspected = inspectQualifiedMaterial(packageDirectory, materialDirectory);
  const receipt = inspected.qualification;
  requireEqual(receipt.schema_version, QUALIFICATION_SCHEMA, "qualification schema");
  requireEqual(receipt.package?.name, PACKAGE_NAME, "qualification package name");
  requireEqual(receipt.package?.version, PACKAGE_VERSION, "qualification package version");
  requireEqual(receipt.package?.target, TARGET, "qualification package target");
  if (expectedSourceCommit) requireEqual(receipt.committed_package?.source_commit, expectedSourceCommit, "qualification source commit");
  if (expectedPackageTree) requireEqual(receipt.committed_package?.package_tree, expectedPackageTree, "qualification package tree");
  requireEqual(receipt.committed_package?.content_tree_sha256, inspected.packageIdentity.content_tree_sha256, "qualification package content tree");
  requireEqual(receipt.committed_package?.file_count, inspected.packageIdentity.file_count, "qualification package file count");
  requireEqual(receipt.committed_package?.byte_count, inspected.packageIdentity.byte_count, "qualification package byte count");
  requireEqual(receipt.reproducibility?.binary_sha256, inspected.runA.binarySha, "qualification binary digest");
  requireEqual(receipt.reproducibility?.binary_size_bytes, inspected.runA.binarySize, "qualification binary size");
  requireEqual(receipt.reproducibility?.archive_inventory_sha256, inspected.archiveInventorySha256, "qualification archive inventory digest");
  requireEqual(receipt.reproducibility?.archive_count, inspected.runA.archives.length, "qualification archive count");
  requireEqual(receipt.reproducibility?.required_builds, 2, "qualification build count");
  const expectedRuns = [
    {
      label: "a",
      run_id: inspected.runA.attestation.run_id,
      build_receipt_sha256: sha256Bytes(inspected.runA.receiptBytes),
      run_attestation_sha256: sha256Bytes(inspected.runA.attestationBytes),
      container_id: inspected.runA.attestation.container.id,
      source_volume_identity_sha256: inspected.runA.attestation.source_volume.identity_sha256,
      output_volume_identity_sha256: inspected.runA.attestation.output_volume.identity_sha256,
    },
    {
      label: "b",
      run_id: inspected.runB.attestation.run_id,
      build_receipt_sha256: sha256Bytes(inspected.runB.receiptBytes),
      run_attestation_sha256: sha256Bytes(inspected.runB.attestationBytes),
      container_id: inspected.runB.attestation.container.id,
      source_volume_identity_sha256: inspected.runB.attestation.source_volume.identity_sha256,
      output_volume_identity_sha256: inspected.runB.attestation.output_volume.identity_sha256,
    },
  ];
  if (!sameStableValue(receipt.runs, expectedRuns)) fail("qualification run bindings do not match both exact executions");
  requireEqual(receipt.selected_output?.run, "a", "qualification selected run");
  requireEqual(receipt.selected_output?.binary_sha256, inspected.runA.binarySha, "qualification selected binary");
  requireEqual(receipt.selected_output?.build_receipt_sha256, expectedRuns[0].build_receipt_sha256, "qualification selected receipt");
  requireEqual(receipt.nonclaims?.source_license_closure_established, false, "qualification legal/source-closure nonclaim");
  validateWrapperSmokeEvidence({
    wrapperSmoke: receipt.wrapper_smoke,
    binarySha: inspected.runA.binarySha,
    binarySize: inspected.runA.binarySize,
  });
  return {
    ok: true,
    schema_version: "life_links.canvas_native_qualification_verification.v2",
    package: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
    target: TARGET,
    binary_sha256: inspected.runA.binarySha,
    binary_size_bytes: inspected.runA.binarySize,
    qualification_receipt_sha256: sha256Bytes(inspected.qualificationBytes),
    selected_build_receipt_sha256: sha256Bytes(inspected.runA.receiptBytes),
    package_content_tree_sha256: inspected.packageIdentity.content_tree_sha256,
    package_tree: receipt.committed_package.package_tree,
    source_commit: receipt.committed_package.source_commit,
    runs: expectedRuns,
    source_license_evidence: inspected.sourceLicenseEvidence,
  };
};

const main = () => {
  const [packageDirectory = PACKAGE_DIR, materialDirectory, expectedSourceCommit, expectedPackageTree] = process.argv.slice(2);
  if (!materialDirectory) fail("pass package directory and qualified material directory");
  const result = verifyQualificationMaterial({
    packageDirectory: resolve(packageDirectory),
    materialDirectory: resolve(materialDirectory),
    expectedSourceCommit,
    expectedPackageTree,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
