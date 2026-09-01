import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PACKAGE_DIR = resolve(dirname(SCRIPT_PATH), "..");
const BINARY_NAME = "skia.linux-x64-gnu.node";
const BUILD_RECEIPT_NAME = "build-receipt.json";
const RUN_ATTESTATION_NAME = "run-attestation.json";
const RUN_ATTESTATION_SCHEMA = "life_links.canvas_native_run_attestation.v1";
const BUILDER_PLATFORM = "linux/amd64";
const MAX_COMMAND_OUTPUT = 64 * 1024 * 1024;

const fail = (message) => {
  throw new Error(`life-links canvas offline runner: ${message}`);
};

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = (path) => {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
};
const canonicalJson = (value) => `${JSON.stringify(stableValue(value))}\n`;

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

const sanitizedEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );

const execute = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? sanitizedEnvironment(),
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    input: options.input,
    windowsHide: true,
    maxBuffer: MAX_COMMAND_OUTPUT,
    shell: false,
  });
  if (result.error) fail(`${options.label ?? command} could not run: ${result.error.message}`);
  if (result.status !== (options.expectedStatus ?? 0)) {
    const detail = String(result.stderr ?? result.stdout ?? "").trim().slice(0, 1000);
    fail(`${options.label ?? command} failed with exit ${result.status}: ${detail}`);
  }
  return result.stdout;
};

const docker = (args, options = {}) => execute("docker", args, { ...options, label: options.label ?? "docker" });

const optionValue = (args, name, environmentName) => {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${name} requires a value`);
    return value;
  }
  return process.env[environmentName];
};

const hasFlag = (args, name) => args.includes(name);

const requireNewAbsolutePath = (rawPath, label) => {
  if (!rawPath || !isAbsolute(rawPath)) fail(`${label} must be an absolute path`);
  const path = resolve(rawPath);
  if (existsSync(path)) fail(`${label} must not already exist: ${path}`);
  const parent = realpathSync(dirname(path));
  if (!lstatSync(parent).isDirectory()) fail(`${label} parent must be a real directory`);
  return join(parent, basename(path));
};

const requireRegularFile = (rawPath, label) => {
  if (!rawPath || !isAbsolute(rawPath)) fail(`${label} must be an absolute path`);
  const path = realpathSync(rawPath);
  const linkStat = lstatSync(rawPath);
  if (linkStat.isSymbolicLink() || !linkStat.isFile() || !statSync(path).isFile()) {
    fail(`${label} must be a regular non-symlink file`);
  }
  return path;
};

const gitText = (root, args) =>
  String(execute("git", ["-c", "core.hooksPath=", "-C", root, ...args], { label: "git" })).trim();

const gitBytes = (root, args) =>
  execute("git", ["-c", "core.hooksPath=", "-C", root, ...args], {
    encoding: null,
    label: "git",
  });

export const materializeCommittedPackage = (sourceCommit) => {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) fail("source commit must be exact lowercase 40-hex");
  const repoRoot = realpathSync(gitText(PACKAGE_DIR, ["rev-parse", "--show-toplevel"]));
  const resolvedCommit = gitText(repoRoot, ["rev-parse", "--verify", `${sourceCommit}^{commit}`]);
  if (resolvedCommit !== sourceCommit) fail("source commit does not resolve exactly");
  const packageRelative = gitText(PACKAGE_DIR, ["rev-parse", "--show-prefix"]).replace(/\/$/, "");
  if (!packageRelative || packageRelative.startsWith("../") || packageRelative.includes("/../")) {
    fail("package path is outside the repository");
  }
  const packageTree = gitText(repoRoot, ["rev-parse", `${sourceCommit}:${packageRelative}`]);
  const listing = gitBytes(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    sourceCommit,
    "--",
    packageRelative,
  ]);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "life-links-canvas-build-package-"));
  const packageDir = join(temporaryRoot, "package");
  mkdirSync(packageDir);
  let fileCount = 0;
  for (const rawEntry of listing.toString("utf8").split("\0")) {
    if (!rawEntry) continue;
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(rawEntry);
    if (!match) fail(`committed package contains unsupported Git entry: ${rawEntry.slice(0, 160)}`);
    const [, mode, objectId, repoPath] = match;
    const packagePath = relative(packageRelative, repoPath).split(sep).join("/");
    if (!packagePath || packagePath.startsWith("../") || packagePath.split("/").includes("..")) {
      fail(`committed package path escapes its subtree: ${repoPath}`);
    }
    const destination = join(packageDir, ...packagePath.split("/"));
    mkdirSync(dirname(destination), { recursive: true });
    const content = gitBytes(repoRoot, ["cat-file", "blob", objectId]);
    writeFileSync(destination, content, { flag: "wx", mode: mode === "100755" ? 0o755 : 0o644 });
    fileCount += 1;
  }
  if (fileCount < 1) fail("committed package subtree is empty");
  return { repoRoot, packageRelative, packageTree, packageDir, temporaryRoot, sourceCommit, fileCount };
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

const volumeIdentity = (inspection) => {
  const bounded = {
    Name: inspection.Name,
    Driver: inspection.Driver,
    Scope: inspection.Scope,
    CreatedAt: inspection.CreatedAt,
    Labels: inspection.Labels ?? {},
    Options: inspection.Options ?? {},
  };
  return { ...bounded, identity_sha256: sha256Bytes(Buffer.from(canonicalJson(bounded))) };
};

const copyFromContainer = (containerId, source, destination) => {
  docker(["cp", `${containerId}:${source}`, destination], { label: `copy ${source}` });
};

const writeNew = (path, bytes) => writeFileSync(path, bytes, { flag: "wx" });

export const usageDocument = () => ({
  schema_version: "life_links.canvas_offline_build_runner_usage.v1",
  status: "ok",
  command: "node native-build/run-offline-build.mjs run",
  required: [
    "--source-tar <absolute normalized-canvas-materials.tar>",
    "--output-dir <absolute new directory>",
    "--run-label <a|b|operator label>",
    "--source-commit <exact committed package source>",
  ],
  optional: ["--retain-volumes (retain the two exact task-owned Docker volumes after success)"],
  boundary:
    "Runs one fresh, network-disabled, linux/amd64 native build from the exact sealed source tar and exact committed package recipe; writes a new three-file output and does not qualify, release, deploy, or overwrite data.",
});

export const runOfflineBuild = ({ sourceTar, outputDir, runLabel, sourceCommit, retainVolumes }) => {
  const committed = materializeCommittedPackage(sourceCommit);
  let containerId;
  let sourceVolume;
  let outputVolume;
  let succeeded = false;
  try {
    const lockPath = join(committed.packageDir, "native-build.lock.json");
    const lock = parseJson(readFileSync(lockPath), "native build lock");
    if (lock.schema_version !== "life_links.canvas_native_build.v3") fail("native build lock schema is not v3");
    const sourceTarPath = requireRegularFile(sourceTar, "normalized source tar");
    const finalOutputDir = requireNewAbsolutePath(outputDir, "output directory");
    const sourceTarBefore = statSync(sourceTarPath, { bigint: true });
    const sourceTarSha256 = sha256File(sourceTarPath);
    const sourceTarAfter = statSync(sourceTarPath, { bigint: true });
    if (
      sourceTarBefore.dev !== sourceTarAfter.dev ||
      sourceTarBefore.ino !== sourceTarAfter.ino ||
      sourceTarBefore.size !== sourceTarAfter.size ||
      sourceTarBefore.mtimeNs !== sourceTarAfter.mtimeNs ||
      sourceTarBefore.ctimeNs !== sourceTarAfter.ctimeNs
    ) {
      fail("normalized source tar changed while it was hashed");
    }
    const sourceTarSize = Number(sourceTarBefore.size);
    if (
      sourceTarSha256 !== lock.materials?.normalized_source_tar?.sha256 ||
      sourceTarSize !== lock.materials?.normalized_source_tar?.size_bytes
    ) {
      fail("normalized source tar does not match the committed native build lock");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(runLabel ?? "")) {
      fail("run label is missing or malformed");
    }
    const builderImage = lock.builder?.derived_image;
    if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(builderImage ?? "")) {
      fail("committed builder image identity is malformed");
    }
    const imageInspection = JSON.parse(String(docker(["image", "inspect", builderImage], { label: "inspect builder image" })))[0];
    if (!imageInspection?.Id?.startsWith("sha256:")) fail("builder image has no immutable local ID");

    const runId = randomUUID();
    const slug = runId.replaceAll("-", "");
    const containerName = `lifelinks-bc270-${runLabel}-${slug}`;
    sourceVolume = `${containerName}-source`;
    outputVolume = `${containerName}-output`;
    const outputId = randomUUID();
    const labels = [
      "--label",
      "com.vectormosaic.owner=life-links-bc270",
      "--label",
      `com.vectormosaic.run-id=${runId}`,
    ];
    docker(["volume", "create", ...labels, sourceVolume], { label: "create fresh source volume" });
    docker(["volume", "create", ...labels, outputVolume], { label: "create fresh output volume" });
    const sourceVolumeInspection = JSON.parse(String(docker(["volume", "inspect", sourceVolume])))[0];
    const outputVolumeInspection = JSON.parse(String(docker(["volume", "inspect", outputVolume])))[0];

    docker(
      [
        "run",
        "--rm",
        "--platform",
        BUILDER_PLATFORM,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m",
        "--mount",
        `type=volume,src=${sourceVolume},dst=/work/canvas`,
        "--mount",
        `type=bind,src=${sourceTarPath},dst=/input/normalized-canvas-materials.tar,readonly`,
        builderImage,
        "tar",
        "-xf",
        "/input/normalized-canvas-materials.tar",
        "-C",
        "/work/canvas",
      ],
      { label: "extract sealed source tar" },
    );

    const createArgs = [
      "create",
      "--name",
      containerName,
      "--platform",
      BUILDER_PLATFORM,
      "--network",
      "none",
      "--mount",
      `type=volume,src=${sourceVolume},dst=/work/canvas`,
      "--mount",
      `type=volume,src=${outputVolume},dst=/out`,
      "--mount",
      `type=bind,src=${committed.packageDir},dst=/pkg,readonly`,
      "--env",
      "LIFE_LINKS_CANVAS_SOURCE_ROOT=/work/canvas",
      "--env",
      "LIFE_LINKS_CANVAS_OUTPUT_DIR=/out",
      "--env",
      "LIFE_LINKS_CANVAS_BUILD_LOCK=/pkg/native-build.lock.json",
      "--env",
      "LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK=/pkg/native-build/canvas-skia-materials.lock.json",
      "--env",
      `LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK_SHA256=${lock.materials.skia_dependencies_lock.sha256}`,
      "--env",
      `LIFE_LINKS_CANVAS_BUILDER_IMAGE_IDENTITY=${builderImage}`,
      "--env",
      `LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SHA256=${sourceTarSha256}`,
      "--env",
      `LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SIZE_BYTES=${sourceTarSize}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_ID=${runId}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_LABEL=${runLabel}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_CONTAINER_NAME=${containerName}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_SOURCE_VOLUME_NAME=${sourceVolume}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_OUTPUT_VOLUME_NAME=${outputVolume}`,
      "--env",
      `LIFE_LINKS_CANVAS_RUN_OUTPUT_ID=${outputId}`,
      "--env",
      "LIFE_LINKS_CANVAS_RUN_NETWORK_MODE=none",
      builderImage,
      "bash",
      "/pkg/native-build/build-offline.sh",
    ];
    containerId = String(docker(createArgs, { label: "create native build container" })).trim();
    if (!/^[0-9a-f]{64}$/.test(containerId)) fail("Docker returned a malformed build container ID");
    const build = spawnSync("docker", ["start", "--attach", containerId], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_COMMAND_OUTPUT,
      shell: false,
    });
    const logPath = `${finalOutputDir}.build.log`;
    writeNew(logPath, Buffer.from(`${build.stdout ?? ""}${build.stderr ?? ""}`, "utf8"));
    const containerInspection = JSON.parse(String(docker(["inspect", containerId], { label: "inspect completed build" })))[0];
    const state = containerInspection?.State;
    if (
      build.error ||
      build.status !== 0 ||
      state?.Status !== "exited" ||
      state?.ExitCode !== 0 ||
      state?.OOMKilled !== false ||
      containerInspection?.HostConfig?.NetworkMode !== "none" ||
      containerInspection?.Image !== imageInspection.Id
    ) {
      fail(`native build did not complete cleanly; retained container ${containerId} and volumes for diagnosis`);
    }
    mkdirSync(finalOutputDir);
    copyFromContainer(containerId, `/out/${BINARY_NAME}`, join(finalOutputDir, BINARY_NAME));
    copyFromContainer(containerId, `/out/${BUILD_RECEIPT_NAME}`, join(finalOutputDir, BUILD_RECEIPT_NAME));
    const binaryPath = join(finalOutputDir, BINARY_NAME);
    const receiptPath = join(finalOutputDir, BUILD_RECEIPT_NAME);
    const binaryBytes = readFileSync(binaryPath);
    const receiptBytes = readFileSync(receiptPath);
    const buildReceipt = parseJson(receiptBytes, "native build receipt");
    if (
      buildReceipt.run?.run_id !== runId ||
      buildReceipt.run?.container_name !== containerName ||
      buildReceipt.run?.source_volume_name !== sourceVolume ||
      buildReceipt.run?.output_volume_name !== outputVolume ||
      buildReceipt.run?.output_id !== outputId ||
      buildReceipt.run?.network_mode !== "none" ||
      buildReceipt.outputs?.binary?.sha256 !== sha256Bytes(binaryBytes) ||
      buildReceipt.outputs?.binary?.size_bytes !== binaryBytes.length
    ) {
      fail("build receipt does not bind the completed runner invocation and binary");
    }
    const attestation = {
      schema_version: RUN_ATTESTATION_SCHEMA,
      run_id: runId,
      run_label: runLabel,
      source_commit: committed.sourceCommit,
      package_path: committed.packageRelative,
      package_tree: committed.packageTree,
      package_file_count: committed.fileCount,
      container: {
        id: containerId,
        name: containerName,
        requested_image: builderImage,
        image_id: imageInspection.Id,
        platform: BUILDER_PLATFORM,
        network_mode: containerInspection.HostConfig.NetworkMode,
        started_at_utc: state.StartedAt,
        finished_at_utc: state.FinishedAt,
        exit_code: state.ExitCode,
        oom_killed: state.OOMKilled,
      },
      source_volume: volumeIdentity(sourceVolumeInspection),
      output_volume: { ...volumeIdentity(outputVolumeInspection), output_id: outputId },
      sealed_source_tar: {
        file: basename(sourceTarPath),
        sha256: sourceTarSha256,
        size_bytes: sourceTarSize,
      },
      outputs: {
        binary: { path: BINARY_NAME, sha256: sha256Bytes(binaryBytes), size_bytes: binaryBytes.length },
        build_receipt: {
          path: BUILD_RECEIPT_NAME,
          sha256: sha256Bytes(receiptBytes),
          size_bytes: receiptBytes.length,
        },
        build_log: { path: logPath, sha256: sha256File(logPath), size_bytes: statSync(logPath).size },
      },
      retained: { container: false, volumes: retainVolumes },
    };
    writeNew(join(finalOutputDir, RUN_ATTESTATION_NAME), Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`));
    docker(["rm", containerId], { label: "remove completed task-owned build container" });
    containerId = undefined;
    if (!retainVolumes) {
      docker(["volume", "rm", sourceVolume, outputVolume], { label: "remove completed task-owned build volumes" });
      sourceVolume = undefined;
      outputVolume = undefined;
    }
    succeeded = true;
    return {
      status: "ok",
      schema_version: RUN_ATTESTATION_SCHEMA,
      output_dir: finalOutputDir,
      binary_sha256: attestation.outputs.binary.sha256,
      build_receipt_sha256: attestation.outputs.build_receipt.sha256,
      run_attestation_sha256: sha256File(join(finalOutputDir, RUN_ATTESTATION_NAME)),
      retained_volumes: retainVolumes,
    };
  } finally {
    rmSync(committed.temporaryRoot, { recursive: true, force: true });
    if (!succeeded) {
      // Failure evidence is intentionally retained. The exact IDs are present in
      // the thrown message or Docker labels and can be inspected without guessing.
    }
  }
};

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "usage";
  const format = optionValue(args, "--format", "LIFE_LINKS_CANVAS_RUN_FORMAT") ?? "text";
  if (["usage", "help", "--help"].includes(command)) {
    const usage = usageDocument();
    process.stdout.write(format === "json" ? `${JSON.stringify(usage, null, 2)}\n` : `${usage.boundary}\n`);
    return;
  }
  if (command !== "run") fail(`unsupported command: ${command}`);
  const result = runOfflineBuild({
    sourceTar: optionValue(args, "--source-tar", "LIFE_LINKS_CANVAS_SOURCE_TAR"),
    outputDir: optionValue(args, "--output-dir", "LIFE_LINKS_CANVAS_RUN_OUTPUT_DIR"),
    runLabel: optionValue(args, "--run-label", "LIFE_LINKS_CANVAS_RUN_LABEL"),
    sourceCommit: optionValue(args, "--source-commit", "LIFE_LINKS_CANVAS_SOURCE_COMMIT"),
    retainVolumes: hasFlag(args, "--retain-volumes"),
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
