#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_SKIA_COMMIT="fe2718df5f53a681087be6f0539045ca1b4b8c09"
readonly EXPECTED_DEPOT_TOOLS_COMMIT="8efa575d754b8703d99b0f827528e45aeaa167aa"
readonly EXPECTED_CARGO_LOCK_SHA256="621410be18188a59695d4a2d967ef599dfb73d3881e63075bd15de8759176944"
readonly EXPECTED_RUST_RELEASE="1.94.1"
readonly TARGET="x86_64-unknown-linux-gnu"

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly SOURCE_ROOT="${LIFE_LINKS_CANVAS_SOURCE_ROOT:-/work/canvas}"
readonly OUTPUT_DIR="${LIFE_LINKS_CANVAS_OUTPUT_DIR:-/out}"
readonly BUILD_LOCK="${LIFE_LINKS_CANVAS_BUILD_LOCK:-${PACKAGE_DIR}/native-build.lock.json}"
readonly SKIA_DEPS_LOCK="${LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK:-${SCRIPT_DIR}/canvas-skia-materials.lock.json}"
readonly SKIA_DEPS_LOCK_SHA256="${LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK_SHA256:-}"
readonly BUILDER_IMAGE_IDENTITY="${LIFE_LINKS_CANVAS_BUILDER_IMAGE_IDENTITY:-}"
readonly NORMALIZED_SOURCE_TAR_SHA256="${LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SHA256:-}"
readonly NORMALIZED_SOURCE_TAR_SIZE_BYTES="${LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SIZE_BYTES:-}"
readonly RUN_ID="${LIFE_LINKS_CANVAS_RUN_ID:-}"
readonly RUN_LABEL="${LIFE_LINKS_CANVAS_RUN_LABEL:-}"
readonly RUN_CONTAINER_NAME="${LIFE_LINKS_CANVAS_RUN_CONTAINER_NAME:-}"
readonly RUN_SOURCE_VOLUME_NAME="${LIFE_LINKS_CANVAS_RUN_SOURCE_VOLUME_NAME:-}"
readonly RUN_OUTPUT_VOLUME_NAME="${LIFE_LINKS_CANVAS_RUN_OUTPUT_VOLUME_NAME:-}"
readonly RUN_OUTPUT_ID="${LIFE_LINKS_CANVAS_RUN_OUTPUT_ID:-}"
readonly RUN_NETWORK_MODE="${LIFE_LINKS_CANVAS_RUN_NETWORK_MODE:-}"

fail() {
  printf 'life-links canvas offline build: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

lock_value() {
  node -e '
const { readFileSync } = require("node:fs");
const lock = JSON.parse(readFileSync(process.argv[1], "utf8"));
const value = process.argv[2].split(".").reduce((current, key) => current?.[key], lock);
if (typeof value !== "string" && typeof value !== "number") process.exit(2);
process.stdout.write(String(value));
' "${BUILD_LOCK}" "$1" || fail "native build lock is missing required field: $1"
}

lock_json() {
  node -e '
const { readFileSync } = require("node:fs");
const lock = JSON.parse(readFileSync(process.argv[1], "utf8"));
const value = process.argv[2].split(".").reduce((current, key) => current?.[key], lock);
if (value === undefined) process.exit(2);
process.stdout.write(JSON.stringify(value));
' "${BUILD_LOCK}" "$1" || fail "native build lock is missing required field: $1"
}

verify_commit() {
  local path="$1"
  local expected="$2"
  local actual
  git -C "${path}" diff --quiet || fail "tracked material is dirty: ${path}"
  git -C "${path}" diff --cached --quiet || fail "staged material is dirty: ${path}"
  actual="$(git -C "${path}" rev-parse HEAD)"
  [[ "${actual}" == "${expected}" ]] || fail "commit mismatch at ${path}: expected ${expected}, got ${actual}"
}

verify_canvas_untracked_scope() {
  local entry
  local status
  local path
  while IFS= read -r -d '' entry; do
    status="${entry:0:2}"
    path="${entry:3}"
    if [[ "${status}" == "??" && ( "${path}" == "Cargo.lock" || "${path}" == vendor/* ) ]]; then
      continue
    fi
    fail "canvas material contains an unlocked worktree entry: ${entry}"
  done < <(git -C "${SOURCE_ROOT}" status --porcelain=v1 --untracked-files=all -z)
}

for command_name in cargo clang git ld ninja node rustc sha256sum; do
  require_command "${command_name}"
done

[[ "${SOURCE_ROOT}" == "/work/canvas" ]] || fail "source must be mounted at /work/canvas for deterministic native paths"
[[ -f "${BUILD_LOCK}" ]] || fail "native build lock is missing: ${BUILD_LOCK}"
[[ -n "${SKIA_DEPS_LOCK}" && -f "${SKIA_DEPS_LOCK}" ]] || fail "Skia dependency lock is missing"
[[ "${SKIA_DEPS_LOCK_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "Skia dependency lock SHA-256 is missing or malformed"
[[ "${BUILDER_IMAGE_IDENTITY}" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]] || \
  fail "canonical derived builder image identity is missing or malformed"
[[ "${NORMALIZED_SOURCE_TAR_SHA256}" =~ ^[0-9a-f]{64}$ ]] || fail "normalized source tar SHA-256 is missing or malformed"
[[ "${NORMALIZED_SOURCE_TAR_SIZE_BYTES}" =~ ^[1-9][0-9]*$ ]] || fail "normalized source tar size is missing or malformed"
[[ -f "${SOURCE_ROOT}/Cargo.lock" ]] || fail "Cargo.lock is missing"
[[ -d "${SOURCE_ROOT}/vendor" ]] || fail "vendored Cargo registry is missing"
[[ -x "${SOURCE_ROOT}/skia/bin/gn" ]] || fail "pinned Skia GN executable is missing or not executable"
[[ ! -e "${SOURCE_ROOT}/target" ]] || fail "fresh sealed source must not contain a Cargo target directory"
[[ ! -e "${SOURCE_ROOT}/skia/out" ]] || fail "fresh sealed source must not contain a Skia output directory"

readonly EXPECTED_BUILD_SCRIPT_SHA256="$(lock_value recipe.build_offline.sha256)"
readonly EXPECTED_VERIFY_MATERIALS_SHA256="$(lock_value recipe.verify_materials.sha256)"
readonly EXPECTED_RUNNER_SHA256="$(lock_value recipe.run_offline_build.sha256)"
readonly EXPECTED_BUILDER_DOCKERFILE_SHA256="$(lock_value builder.dockerfile_sha256)"
readonly EXPECTED_SKIA_DEPS_LOCK_SHA256="$(lock_value materials.skia_dependencies_lock.sha256)"
readonly EXPECTED_NORMALIZED_SOURCE_TAR_SHA256="$(lock_value materials.normalized_source_tar.sha256)"
readonly EXPECTED_NORMALIZED_SOURCE_TAR_SIZE_BYTES="$(lock_value materials.normalized_source_tar.size_bytes)"
readonly EXPECTED_BUILDER_IMAGE_IDENTITY="$(lock_value builder.derived_image)"
readonly EXPECTED_SKIA_ARCHIVES_JSON="$(lock_json reproducibility.required_skia_static_archives)"
readonly EXPECTED_CANVAS_BASE_COMMIT="$(lock_value upstream.commit)"
readonly EXPECTED_CANVAS_BASE_TREE="$(lock_value upstream.tree)"
readonly EXPECTED_BACKPORT_ORIGIN_COMMIT="$(lock_value source_derivation.backports.0.origin_commit)"
readonly EXPECTED_BACKPORT_SOURCE_PATH="$(lock_value source_derivation.backports.0.source_path)"
readonly EXPECTED_BACKPORT_PATCH_PATH="$(lock_value source_derivation.backports.0.patch_path)"
readonly EXPECTED_BACKPORT_PATCH_SHA256="$(lock_value source_derivation.backports.0.patch_sha256)"
readonly EXPECTED_EFFECTIVE_CANVAS_TREE="$(lock_value source_derivation.effective_tree)"
readonly BACKPORT_PATCH="${PACKAGE_DIR}/${EXPECTED_BACKPORT_PATCH_PATH}"
readonly ACTUAL_BUILD_SCRIPT_SHA256="$(sha256sum "${SCRIPT_DIR}/build-offline.sh" | cut -d ' ' -f 1)"
readonly ACTUAL_VERIFY_MATERIALS_SHA256="$(sha256sum "${SCRIPT_DIR}/verify-materials.mjs" | cut -d ' ' -f 1)"
readonly ACTUAL_RUNNER_SHA256="$(sha256sum "${SCRIPT_DIR}/run-offline-build.mjs" | cut -d ' ' -f 1)"
readonly ACTUAL_BUILD_LOCK_SHA256="$(sha256sum "${BUILD_LOCK}" | cut -d ' ' -f 1)"
readonly ACTUAL_BUILDER_DOCKERFILE_SHA256="$(sha256sum "${SCRIPT_DIR}/builder.Dockerfile" | cut -d ' ' -f 1)"
readonly ACTUAL_SKIA_DEPS_LOCK_SHA256="$(sha256sum "${SKIA_DEPS_LOCK}" | cut -d ' ' -f 1)"
readonly ACTUAL_BACKPORT_PATCH_SHA256="$(sha256sum "${BACKPORT_PATCH}" | cut -d ' ' -f 1)"

[[ "${ACTUAL_BUILD_SCRIPT_SHA256}" == "${EXPECTED_BUILD_SCRIPT_SHA256}" ]] || fail "build-offline.sh does not match the native build lock"
[[ "${ACTUAL_VERIFY_MATERIALS_SHA256}" == "${EXPECTED_VERIFY_MATERIALS_SHA256}" ]] || fail "verify-materials.mjs does not match the native build lock"
[[ "${ACTUAL_RUNNER_SHA256}" == "${EXPECTED_RUNNER_SHA256}" ]] || fail "run-offline-build.mjs does not match the native build lock"
[[ "${ACTUAL_BUILDER_DOCKERFILE_SHA256}" == "${EXPECTED_BUILDER_DOCKERFILE_SHA256}" ]] || fail "builder.Dockerfile does not match the native build lock"
[[ "${ACTUAL_SKIA_DEPS_LOCK_SHA256}" == "${EXPECTED_SKIA_DEPS_LOCK_SHA256}" ]] || fail "Skia dependency lock does not match the native build lock"
[[ "${SKIA_DEPS_LOCK_SHA256}" == "${EXPECTED_SKIA_DEPS_LOCK_SHA256}" ]] || fail "operator Skia dependency lock digest does not match the native build lock"
[[ "${NORMALIZED_SOURCE_TAR_SHA256}" == "${EXPECTED_NORMALIZED_SOURCE_TAR_SHA256}" ]] || fail "normalized source tar digest does not match the native build lock"
[[ "${NORMALIZED_SOURCE_TAR_SIZE_BYTES}" == "${EXPECTED_NORMALIZED_SOURCE_TAR_SIZE_BYTES}" ]] || fail "normalized source tar size does not match the native build lock"
[[ "${BUILDER_IMAGE_IDENTITY}" == "${EXPECTED_BUILDER_IMAGE_IDENTITY}" ]] || fail "builder image identity does not match the native build lock"
[[ "${EXPECTED_BACKPORT_ORIGIN_COMMIT}" == "6be5aa2c664dd077513aa8c89a93531cc568adef" ]] || fail "drawImage backport origin commit is incorrect"
[[ "${EXPECTED_BACKPORT_SOURCE_PATH}" == "src/ctx.rs" ]] || fail "drawImage backport source path is incorrect"
[[ "${EXPECTED_BACKPORT_PATCH_PATH}" == "native-build/patches/0001-backport-draw-image-source-napi-3.12.patch" ]] || fail "drawImage backport path is incorrect"
[[ "${ACTUAL_BACKPORT_PATCH_SHA256}" == "${EXPECTED_BACKPORT_PATCH_SHA256}" ]] || fail "drawImage backport patch does not match the native build lock"

export LIFE_LINKS_CANVAS_RUN_ID="${RUN_ID}"
export LIFE_LINKS_CANVAS_RUN_LABEL="${RUN_LABEL}"
export LIFE_LINKS_CANVAS_RUN_CONTAINER_NAME="${RUN_CONTAINER_NAME}"
export LIFE_LINKS_CANVAS_RUN_SOURCE_VOLUME_NAME="${RUN_SOURCE_VOLUME_NAME}"
export LIFE_LINKS_CANVAS_RUN_OUTPUT_VOLUME_NAME="${RUN_OUTPUT_VOLUME_NAME}"
export LIFE_LINKS_CANVAS_RUN_OUTPUT_ID="${RUN_OUTPUT_ID}"
export LIFE_LINKS_CANVAS_RUN_NETWORK_MODE="${RUN_NETWORK_MODE}"
export LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SHA256="${NORMALIZED_SOURCE_TAR_SHA256}"
export LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SIZE_BYTES="${NORMALIZED_SOURCE_TAR_SIZE_BYTES}"
readonly RUN_ATTESTATION_JSON="$(node <<'NODE'
const fail = (message) => { throw new Error(message); };
const env = process.env;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const name = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
for (const [key, pattern] of [
  ["LIFE_LINKS_CANVAS_RUN_ID", identifier],
  ["LIFE_LINKS_CANVAS_RUN_LABEL", name],
  ["LIFE_LINKS_CANVAS_RUN_CONTAINER_NAME", name],
  ["LIFE_LINKS_CANVAS_RUN_SOURCE_VOLUME_NAME", name],
  ["LIFE_LINKS_CANVAS_RUN_OUTPUT_VOLUME_NAME", name],
  ["LIFE_LINKS_CANVAS_RUN_OUTPUT_ID", identifier],
]) if (!pattern.test(env[key] ?? "")) fail(`${key} is missing or malformed`);
if (env.LIFE_LINKS_CANVAS_RUN_NETWORK_MODE !== "none") fail("run network mode must be none");
process.stdout.write(JSON.stringify({
  run_id: env.LIFE_LINKS_CANVAS_RUN_ID,
  run_label: env.LIFE_LINKS_CANVAS_RUN_LABEL,
  container_name: env.LIFE_LINKS_CANVAS_RUN_CONTAINER_NAME,
  source_volume_name: env.LIFE_LINKS_CANVAS_RUN_SOURCE_VOLUME_NAME,
  output_volume_name: env.LIFE_LINKS_CANVAS_RUN_OUTPUT_VOLUME_NAME,
  output_id: env.LIFE_LINKS_CANVAS_RUN_OUTPUT_ID,
  builder_image: env.LIFE_LINKS_CANVAS_BUILDER_IMAGE_IDENTITY,
  network_mode: env.LIFE_LINKS_CANVAS_RUN_NETWORK_MODE,
  normalized_source_tar: {
    sha256: env.LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SHA256,
    size_bytes: Number(env.LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SIZE_BYTES),
  },
  correlation_source: "life_links.canvas_offline_build_runner.v1",
}));
NODE
)" || fail "run attestation is invalid"
export LIFE_LINKS_CANVAS_RUN_CORRELATION_JSON="${RUN_ATTESTATION_JSON}"
export LIFE_LINKS_CANVAS_BUILD_SCRIPT_SHA256="${ACTUAL_BUILD_SCRIPT_SHA256}"
export LIFE_LINKS_CANVAS_VERIFY_MATERIALS_SHA256="${ACTUAL_VERIFY_MATERIALS_SHA256}"
export LIFE_LINKS_CANVAS_RUNNER_SHA256="${ACTUAL_RUNNER_SHA256}"
export LIFE_LINKS_CANVAS_BUILD_LOCK_SHA256="${ACTUAL_BUILD_LOCK_SHA256}"
export LIFE_LINKS_CANVAS_BUILDER_DOCKERFILE_SHA256="${ACTUAL_BUILDER_DOCKERFILE_SHA256}"
export LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK_SHA256="${ACTUAL_SKIA_DEPS_LOCK_SHA256}"
export LIFE_LINKS_CANVAS_EXPECTED_SKIA_ARCHIVES_JSON="${EXPECTED_SKIA_ARCHIVES_JSON}"
export LIFE_LINKS_CANVAS_BASE_COMMIT="${EXPECTED_CANVAS_BASE_COMMIT}"
export LIFE_LINKS_CANVAS_BASE_TREE="${EXPECTED_CANVAS_BASE_TREE}"
export LIFE_LINKS_CANVAS_BACKPORT_ORIGIN_COMMIT="${EXPECTED_BACKPORT_ORIGIN_COMMIT}"
export LIFE_LINKS_CANVAS_BACKPORT_SOURCE_PATH="${EXPECTED_BACKPORT_SOURCE_PATH}"
export LIFE_LINKS_CANVAS_BACKPORT_PATCH_PATH="${EXPECTED_BACKPORT_PATCH_PATH}"
export LIFE_LINKS_CANVAS_BACKPORT_PATCH_SHA256="${ACTUAL_BACKPORT_PATCH_SHA256}"
export LIFE_LINKS_CANVAS_EFFECTIVE_TREE="${EXPECTED_EFFECTIVE_CANVAS_TREE}"

verify_commit "${SOURCE_ROOT}" "${EXPECTED_CANVAS_BASE_COMMIT}"
verify_canvas_untracked_scope
actual_canvas_tree="$(git -C "${SOURCE_ROOT}" rev-parse 'HEAD^{tree}')"
[[ "${actual_canvas_tree}" == "${EXPECTED_CANVAS_BASE_TREE}" ]] || \
  fail "canvas base tree mismatch: expected ${EXPECTED_CANVAS_BASE_TREE}, got ${actual_canvas_tree}"
git -C "${SOURCE_ROOT}" apply --check --index "${BACKPORT_PATCH}"
git -C "${SOURCE_ROOT}" apply --index "${BACKPORT_PATCH}"
git -C "${SOURCE_ROOT}" diff --cached --check
readonly ACTUAL_EFFECTIVE_CANVAS_TREE="$(git -C "${SOURCE_ROOT}" write-tree)"
[[ "${ACTUAL_EFFECTIVE_CANVAS_TREE}" == "${EXPECTED_EFFECTIVE_CANVAS_TREE}" ]] || \
  fail "canvas effective tree mismatch: expected ${EXPECTED_EFFECTIVE_CANVAS_TREE}, got ${ACTUAL_EFFECTIVE_CANVAS_TREE}"
[[ "$(git -C "${SOURCE_ROOT}" diff --cached --name-only)" == "${EXPECTED_BACKPORT_SOURCE_PATH}" ]] || \
  fail "drawImage backport changed an unexpected tracked path"
verify_commit "${SOURCE_ROOT}/skia" "${EXPECTED_SKIA_COMMIT}"
verify_commit "${SOURCE_ROOT}/skia/depot_tools" "${EXPECTED_DEPOT_TOOLS_COMMIT}"
material_verification_json="$(node "${SCRIPT_DIR}/verify-materials.mjs" \
  "${SOURCE_ROOT}" "${SKIA_DEPS_LOCK}" "${SKIA_DEPS_LOCK_SHA256}")"

actual_cargo_lock_sha256="$(sha256sum "${SOURCE_ROOT}/Cargo.lock" | cut -d ' ' -f 1)"
[[ "${actual_cargo_lock_sha256}" == "${EXPECTED_CARGO_LOCK_SHA256}" ]] || \
  fail "Cargo.lock digest mismatch: expected ${EXPECTED_CARGO_LOCK_SHA256}, got ${actual_cargo_lock_sha256}"

actual_rust_release="$(rustc --version | awk '{print $2}')"
[[ "${actual_rust_release}" == "${EXPECTED_RUST_RELEASE}" ]] || \
  fail "Rust release mismatch: expected ${EXPECTED_RUST_RELEASE}, got ${actual_rust_release}"

package_identity="$(node -e 'const p=require(process.argv[1]); process.stdout.write(`${p.name}@${p.version}`)' "${SOURCE_ROOT}/package.json")"
[[ "${package_identity}" == "@napi-rs/canvas@0.1.100" ]] || fail "upstream package identity mismatch: ${package_identity}"

export SOURCE_DATE_EPOCH=1777169498
export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export CARGO_NET_OFFLINE=true
export CARGO_INCREMENTAL=0
export ZERO_AR_DATE=1
export SKIP_SYNC_SK_DEPS=0
export RUSTFLAGS="-C link-args=-Wl,-z,nodelete -C link-arg=-Wl,--build-id=none --remap-path-prefix=/work/canvas=/usr/src/canvas"
export CARGO_HOME=/tmp/life-links-canvas-cargo-home

mkdir -p "${CARGO_HOME}" "${OUTPUT_DIR}"
printf '%s\n' \
  '[source.crates-io]' \
  'replace-with = "vendored-sources"' \
  '[source.vendored-sources]' \
  "directory = \"${SOURCE_ROOT}/vendor\"" \
  > "${CARGO_HOME}/config.toml"

cd "${SOURCE_ROOT}"
node scripts/build-skia.js
cargo build --frozen --offline --release --target "${TARGET}"

readonly BUILT_BINARY="${SOURCE_ROOT}/target/${TARGET}/release/libcanvas.so"
readonly OUTPUT_BINARY="${OUTPUT_DIR}/skia.linux-x64-gnu.node"
[[ -f "${BUILT_BINARY}" ]] || fail "expected native binary was not produced: ${BUILT_BINARY}"
[[ ! -e "${OUTPUT_BINARY}" && ! -e "${OUTPUT_DIR}/build-receipt.json" ]] || \
  fail "output binary or receipt already exists; qualification must provide a fresh bounded output directory"
install -m 0644 "${BUILT_BINARY}" "${OUTPUT_BINARY}"

export LIFE_LINKS_CANVAS_BUILD_LOCK="${BUILD_LOCK}"
export LIFE_LINKS_CANVAS_BINARY="${OUTPUT_BINARY}"
export LIFE_LINKS_CANVAS_CARGO_LOCK_SHA256="${actual_cargo_lock_sha256}"
export LIFE_LINKS_CANVAS_RECEIPT="${OUTPUT_DIR}/build-receipt.json"
export LIFE_LINKS_CANVAS_SOURCE_ROOT="${SOURCE_ROOT}"
export LIFE_LINKS_CANVAS_BUILDER_IMAGE_IDENTITY="${BUILDER_IMAGE_IDENTITY}"
export LIFE_LINKS_CANVAS_MATERIAL_VERIFICATION_JSON="${material_verification_json}"
export LIFE_LINKS_CANVAS_CLANG_PATH="$(command -v clang)"
export LIFE_LINKS_CANVAS_LD_PATH="$(command -v ld)"
export LIFE_LINKS_CANVAS_NINJA_PATH="$(command -v ninja)"
export LIFE_LINKS_CANVAS_GN_PATH="${SOURCE_ROOT}/skia/bin/gn"
node <<'NODE'
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const text = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const sourceRoot = process.env.LIFE_LINKS_CANVAS_SOURCE_ROOT;
const archiveRoot = join(sourceRoot, "skia", "out", "Static");
const archives = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && entry.name.endsWith(".a")) {
      archives.push({
        path: relative(archiveRoot, path).split(sep).join("/"),
        sha256: sha256(path),
        size_bytes: statSync(path).size,
      });
    }
  }
};
visit(archiveRoot);

const binary = process.env.LIFE_LINKS_CANVAS_BINARY;
const tool = (path, args) => ({
  path,
  sha256: sha256(path),
  version: text(path, args),
});
const materialVerification = JSON.parse(process.env.LIFE_LINKS_CANVAS_MATERIAL_VERIFICATION_JSON);
const expectedArchives = JSON.parse(process.env.LIFE_LINKS_CANVAS_EXPECTED_SKIA_ARCHIVES_JSON);
const actualArchivePaths = archives.map((entry) => entry.path);
if (JSON.stringify(actualArchivePaths) !== JSON.stringify(expectedArchives)) {
  throw new Error(`Skia static archive inventory mismatch: ${JSON.stringify(actualArchivePaths)}`);
}
const receipt = {
  schema_version: "life_links.canvas_native_build_receipt.v3",
  package: {
    name: "@napi-rs/canvas-linux-x64-gnu",
    version: "0.1.100",
    target: "x86_64-unknown-linux-gnu",
  },
  run: JSON.parse(process.env.LIFE_LINKS_CANVAS_RUN_CORRELATION_JSON),
  committed_inputs: {
    build_offline_sha256: process.env.LIFE_LINKS_CANVAS_BUILD_SCRIPT_SHA256,
    verify_materials_sha256: process.env.LIFE_LINKS_CANVAS_VERIFY_MATERIALS_SHA256,
    run_offline_build_sha256: process.env.LIFE_LINKS_CANVAS_RUNNER_SHA256,
    native_build_lock_sha256: process.env.LIFE_LINKS_CANVAS_BUILD_LOCK_SHA256,
    builder_dockerfile_sha256: process.env.LIFE_LINKS_CANVAS_BUILDER_DOCKERFILE_SHA256,
    skia_materials_lock_sha256: process.env.LIFE_LINKS_CANVAS_SKIA_DEPS_LOCK_SHA256,
    backport_patch_sha256: process.env.LIFE_LINKS_CANVAS_BACKPORT_PATCH_SHA256,
    normalized_source_tar_sha256: process.env.LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SHA256,
    normalized_source_tar_size_bytes: Number(process.env.LIFE_LINKS_CANVAS_NORMALIZED_SOURCE_TAR_SIZE_BYTES),
  },
  source: {
    canvas: {
      base_commit: process.env.LIFE_LINKS_CANVAS_BASE_COMMIT,
      base_tree: process.env.LIFE_LINKS_CANVAS_BASE_TREE,
      effective_tree: process.env.LIFE_LINKS_CANVAS_EFFECTIVE_TREE,
      backports: [{
        origin_commit: process.env.LIFE_LINKS_CANVAS_BACKPORT_ORIGIN_COMMIT,
        source_path: process.env.LIFE_LINKS_CANVAS_BACKPORT_SOURCE_PATH,
        patch_path: process.env.LIFE_LINKS_CANVAS_BACKPORT_PATCH_PATH,
        patch_sha256: process.env.LIFE_LINKS_CANVAS_BACKPORT_PATCH_SHA256,
      }],
    },
    skia_commit: text("git", ["-C", join(sourceRoot, "skia"), "rev-parse", "HEAD"]),
    depot_tools_commit: text("git", ["-C", join(sourceRoot, "skia", "depot_tools"), "rev-parse", "HEAD"]),
    cargo_lock_sha256: process.env.LIFE_LINKS_CANVAS_CARGO_LOCK_SHA256,
    native_build_lock_sha256: process.env.LIFE_LINKS_CANVAS_BUILD_LOCK_SHA256,
    skia_dependencies: materialVerification,
  },
  builder: {
    image: process.env.LIFE_LINKS_CANVAS_BUILDER_IMAGE_IDENTITY,
    rustc: text("rustc", ["--version", "--verbose"]),
    cargo: text("cargo", ["--version", "--verbose"]),
    node: process.version,
    clang: tool(process.env.LIFE_LINKS_CANVAS_CLANG_PATH, ["--version"]),
    ld: tool(process.env.LIFE_LINKS_CANVAS_LD_PATH, ["--version"]),
    ninja: tool(process.env.LIFE_LINKS_CANVAS_NINJA_PATH, ["--version"]),
    gn: tool(process.env.LIFE_LINKS_CANVAS_GN_PATH, ["--version"]),
  },
  outputs: {
    binary: {
      path: "skia.linux-x64-gnu.node",
      sha256: sha256(binary),
      size_bytes: statSync(binary).size,
    },
    skia_static_archives: archives,
  },
};
writeFileSync(process.env.LIFE_LINKS_CANVAS_RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
NODE

sha256sum "${OUTPUT_BINARY}" "${OUTPUT_DIR}/build-receipt.json"
