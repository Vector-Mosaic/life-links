import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { materializeCommittedPackage } from "./run-offline-build.mjs";
import {
  BINARY_NAME,
  QUALIFICATION_NAME,
  QUALIFICATION_SCHEMA,
  RUN_A_ATTESTATION_NAME,
  RUN_A_RECEIPT_NAME,
  RUN_B_ATTESTATION_NAME,
  RUN_B_RECEIPT_NAME,
  inspectRunOutputDirectory,
  packageContentIdentity,
  verifyQualificationMaterial,
} from "./verify-qualification.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_DIR = resolve(dirname(SCRIPT_PATH), "..");
const PACKAGE_NAME = "@napi-rs/canvas-linux-x64-gnu";
const PACKAGE_VERSION = "0.1.100";
const TARGET = "x86_64-unknown-linux-gnu";
const PNPM_VERSION = "10.14.0";

const fail = (message) => {
  throw new Error(`life-links canvas native qualification: ${message}`);
};
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = (path) => sha256Bytes(readFileSync(path));
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

const requireSupportedRuntime = () => {
  if (process.platform !== "linux" || process.arch !== "x64") fail("qualification requires Linux x64");
  if (!process.report?.getReport()?.header?.glibcVersionRuntime) fail("qualification requires glibc");
  const external = Object.entries(networkInterfaces()).filter(
    ([name, addresses]) =>
      name !== "lo" && (addresses ?? []).some((address) => !address.internal),
  );
  if (external.length > 0) fail("qualification must run inside a network-none boundary with only loopback available");
};

const optionValue = (args, name, environmentName) => {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${name} requires a value`);
    return value;
  }
  return process.env[environmentName];
};

const requireAbsoluteDirectory = (raw, label) => {
  if (!raw || !isAbsolute(raw)) fail(`${label} must be an absolute path`);
  const linkStat = lstatSync(raw);
  if (linkStat.isSymbolicLink() || !linkStat.isDirectory()) fail(`${label} must be a real directory`);
  return realpathSync(raw);
};

const requireNewOutput = (raw) => {
  if (!raw || !isAbsolute(raw)) fail("qualification output must be an absolute path");
  const output = resolve(raw);
  if (existsSync(output)) fail("qualification output must not already exist");
  const parent = realpathSync(dirname(output));
  if (!lstatSync(parent).isDirectory()) fail("qualification output parent must be a real directory");
  return output;
};

const sanitizedEnvironment = (extra = {}) => ({
  HOME: process.env.HOME ?? "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: process.env.PATH ?? "",
  TZ: "UTC",
  NO_COLOR: "1",
  ...extra,
});

export const requireDistinctRuns = (runA, runB) => {
  for (const file of ["binary", "receipt", "attestation"]) {
    if (runA.fileIdentities?.[file] === runB.fileIdentities?.[file]) {
      fail(`run A and run B reuse the same hard-linked ${file} file`);
    }
  }
  const pairs = [
    [runA.attestation.run_id, runB.attestation.run_id, "run ID"],
    [runA.attestation.container.id, runB.attestation.container.id, "container ID"],
    [runA.attestation.container.name, runB.attestation.container.name, "container name"],
    [runA.attestation.source_volume.Name, runB.attestation.source_volume.Name, "source volume"],
    [runA.attestation.source_volume.identity_sha256, runB.attestation.source_volume.identity_sha256, "source volume identity"],
    [runA.attestation.output_volume.Name, runB.attestation.output_volume.Name, "output volume"],
    [runA.attestation.output_volume.identity_sha256, runB.attestation.output_volume.identity_sha256, "output volume identity"],
    [runA.attestation.output_volume.output_id, runB.attestation.output_volume.output_id, "output ID"],
  ];
  for (const [left, right, label] of pairs) if (left === right) fail(`run A and run B reuse the same ${label}`);
  const identity = (run) => ({
    package: run.receipt.package,
    committed_inputs: run.receipt.committed_inputs,
    source: run.receipt.source,
    builder: run.receipt.builder,
  });
  if (!sameStableValue(identity(runA), identity(runB))) fail("run A and run B build identities differ");
  if (!runA.binaryBytes.equals(runB.binaryBytes)) fail("run A and run B native binaries differ");
  if (!sameStableValue(runA.archives, runB.archives)) fail("run A and run B Skia archives differ");
};

const runWrapperSmoke = (committedPackage, selectedRun, pnpmStore) => {
  const temporary = mkdtempSync(join(tmpdir(), "life-links-canvas-wrapper-smoke-"));
  try {
    const packageDir = join(temporary, "package");
    cpSync(committedPackage.packageDir, packageDir, { recursive: true, errorOnExist: true });
    const projectDir = join(packageDir, "native-build", "wrapper-smoke");
    const projectPackage = join(projectDir, "package.json");
    const lockfile = join(projectDir, "pnpm-lock.yaml");
    const expectedNative = join(packageDir, BINARY_NAME);
    writeFileSync(expectedNative, selectedRun.binaryBytes, { flag: "wx" });
    writeFileSync(join(packageDir, "build-receipt.json"), selectedRun.receiptBytes, { flag: "wx" });
    const pnpmVersion = execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      env: sanitizedEnvironment(),
      windowsHide: true,
      timeout: 30_000,
    }).trim();
    if (pnpmVersion !== PNPM_VERSION) fail(`qualification requires pnpm ${PNPM_VERSION}, got ${pnpmVersion}`);
    const installArgs = [
      "install",
      "--offline",
      "--frozen-lockfile",
      "--prod",
      "--ignore-workspace",
      "--ignore-scripts",
    ];
    if (pnpmStore) installArgs.push("--store-dir", pnpmStore);
    try {
      execFileSync("pnpm", installArgs, {
        cwd: projectDir,
        env: sanitizedEnvironment({ CI: "1" }),
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (error) {
      fail(`offline frozen wrapper install failed: ${String(error.stderr ?? error.message).trim().slice(0, 500)}`);
    }
    let smoke;
    try {
      smoke = JSON.parse(
        execFileSync(
          process.execPath,
          [
            join(packageDir, "native-build", "smoke-wrapper.mjs"),
            "smoke",
            "--require-from",
            projectPackage,
            "--expected-native",
            expectedNative,
          ],
          {
            cwd: projectDir,
            env: sanitizedEnvironment(),
            encoding: "utf8",
            windowsHide: true,
            timeout: 30_000,
          },
        ),
      );
    } catch (error) {
      fail(`wrapper load/render smoke failed: ${String(error.stderr ?? error.message).trim().slice(0, 500)}`);
    }
    if (smoke.status !== "ok" || smoke.native?.sha256 !== selectedRun.binarySha) {
      fail("wrapper smoke did not bind the selected native binary");
    }
    const normalizedSmoke = {
      ...smoke,
      native: {
        package: smoke.native.package,
        sha256: smoke.native.sha256,
        size_bytes: smoke.native.size_bytes,
      },
    };
    return {
      network_mode: "none",
      pnpm_version: pnpmVersion,
      project_package_sha256: sha256File(projectPackage),
      lockfile_sha256: sha256File(lockfile),
      result: normalizedSmoke,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

const runBinding = (label, run) => ({
  label,
  run_id: run.attestation.run_id,
  build_receipt_sha256: sha256Bytes(run.receiptBytes),
  run_attestation_sha256: sha256Bytes(run.attestationBytes),
  container_id: run.attestation.container.id,
  source_volume_identity_sha256: run.attestation.source_volume.identity_sha256,
  output_volume_identity_sha256: run.attestation.output_volume.identity_sha256,
});

const writeNew = (path, bytes) => writeFileSync(path, bytes, { flag: "wx" });

export const qualifyCompletedRuns = ({ runADirectory, runBDirectory, outputDirectory, sourceCommit, pnpmStoreDirectory }) => {
  requireSupportedRuntime();
  const outputDir = requireNewOutput(outputDirectory);
  const runADir = requireAbsoluteDirectory(runADirectory, "run A directory");
  const runBDir = requireAbsoluteDirectory(runBDirectory, "run B directory");
  if (runADir === runBDir) fail("run A and run B directories must be distinct");
  const pnpmStore = pnpmStoreDirectory ? requireAbsoluteDirectory(pnpmStoreDirectory, "pnpm store") : undefined;
  const committed = materializeCommittedPackage(sourceCommit);
  try {
    const runA = inspectRunOutputDirectory(committed.packageDir, runADir, "run A");
    const runB = inspectRunOutputDirectory(committed.packageDir, runBDir, "run B");
    requireDistinctRuns(runA, runB);
    if (runA.attestation.package_tree !== committed.packageTree || runB.attestation.package_tree !== committed.packageTree) {
      fail("both run attestations must bind the exact committed package tree");
    }
    const packageIdentity = packageContentIdentity(committed.packageDir);
    const wrapperSmoke = runWrapperSmoke(committed, runA, pnpmStore);
    const archiveInventorySha256 = sha256Bytes(Buffer.from(canonicalJson(runA.archives)));
    const runs = [runBinding("a", runA), runBinding("b", runB)];
    const receipt = {
      schema_version: QUALIFICATION_SCHEMA,
      package: { name: PACKAGE_NAME, version: PACKAGE_VERSION, target: TARGET },
      committed_package: {
        source_commit: committed.sourceCommit,
        package_path: committed.packageRelative,
        package_tree: committed.packageTree,
        content_tree_sha256: packageIdentity.content_tree_sha256,
        file_count: packageIdentity.file_count,
        byte_count: packageIdentity.byte_count,
      },
      runs,
      reproducibility: {
        required_builds: 2,
        binary_sha256: runA.binarySha,
        binary_size_bytes: runA.binarySize,
        archive_count: runA.archives.length,
        archive_inventory_sha256: archiveInventorySha256,
        byte_identical_binary: true,
        byte_identical_skia_archives: true,
      },
      wrapper_smoke: wrapperSmoke,
      selected_output: {
        run: "a",
        binary_sha256: runA.binarySha,
        build_receipt_sha256: runs[0].build_receipt_sha256,
      },
      nonclaims: {
        source_license_closure_established: false,
        release_projection_qualified: false,
        deployment_performed: false,
        windows_behavior_changed: false,
      },
    };
    mkdirSync(outputDir);
    writeNew(join(outputDir, BINARY_NAME), runA.binaryBytes);
    writeNew(join(outputDir, RUN_A_RECEIPT_NAME), runA.receiptBytes);
    writeNew(join(outputDir, RUN_A_ATTESTATION_NAME), runA.attestationBytes);
    writeNew(join(outputDir, RUN_B_RECEIPT_NAME), runB.receiptBytes);
    writeNew(join(outputDir, RUN_B_ATTESTATION_NAME), runB.attestationBytes);
    writeNew(join(outputDir, QUALIFICATION_NAME), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    const verified = verifyQualificationMaterial({
      packageDirectory: committed.packageDir,
      materialDirectory: outputDir,
      expectedSourceCommit: committed.sourceCommit,
      expectedPackageTree: committed.packageTree,
    });
    return { status: "ok", output_dir: outputDir, ...verified };
  } catch (error) {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(committed.temporaryRoot, { recursive: true, force: true });
  }
};

export const usageDocument = () => ({
  schema_version: "life_links.canvas_native_qualification_usage.v2",
  status: "ok",
  command: "node native-build/qualify-native.mjs qualify",
  required: [
    "--run-a <absolute completed run A directory>",
    "--run-b <absolute completed run B directory>",
    "--output-dir <absolute new qualified-material directory>",
    "--source-commit <exact committed package source>",
  ],
  optional: ["--pnpm-store-dir <absolute prepopulated store; install remains offline and frozen>"],
  boundary:
    "Verifies two independently attested network-none builds, byte equality, exact package inputs, and an isolated offline frozen wrapper smoke; writes a new qualified-material directory and does not build, deploy, or establish source-license closure.",
});

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "usage";
  const format = optionValue(args, "--format", "LIFE_LINKS_CANVAS_QUALIFICATION_FORMAT") ?? "text";
  if (["usage", "help", "--help"].includes(command)) {
    const usage = usageDocument();
    process.stdout.write(format === "json" ? `${JSON.stringify(usage, null, 2)}\n` : `${usage.boundary}\n`);
    return;
  }
  if (command !== "qualify") fail(`unsupported command: ${command}`);
  const result = qualifyCompletedRuns({
    runADirectory: optionValue(args, "--run-a", "LIFE_LINKS_CANVAS_RUN_A_DIR"),
    runBDirectory: optionValue(args, "--run-b", "LIFE_LINKS_CANVAS_RUN_B_DIR"),
    outputDirectory: optionValue(args, "--output-dir", "LIFE_LINKS_CANVAS_QUALIFIED_MATERIAL_DIR"),
    sourceCommit: optionValue(args, "--source-commit", "LIFE_LINKS_CANVAS_SOURCE_COMMIT"),
    pnpmStoreDirectory: optionValue(args, "--pnpm-store-dir", "LIFE_LINKS_CANVAS_PNPM_STORE_DIR"),
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
