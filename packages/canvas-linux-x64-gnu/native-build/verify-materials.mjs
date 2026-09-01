import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";

const EXPECTED_SCHEMA = "life_links.canvas_skia_materials.v1";
const EXPECTED_SKIA_COMMIT = "fe2718df5f53a681087be6f0539045ca1b4b8c09";
const EXPECTED_DEPOT_TOOLS_COMMIT = "8efa575d754b8703d99b0f827528e45aeaa167aa";
const EXPECTED_GIT_DEPENDENCY_COUNT = 47;

const [sourceRoot, manifestPath, expectedManifestSha256] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`life-links canvas material verification: ${message}\n`);
  process.exit(1);
};
if (!sourceRoot || !manifestPath || !/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? "")) {
  fail("usage: verify-materials.mjs <source-root> <manifest> <expected-manifest-sha256>");
}

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = (path) => sha256Bytes(readFileSync(path));
const text = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const canonicalUrl = (value) => String(value).trim().replace(/\/+$/, "").replace(/\.git$/, "");
const skiaRoot = join(sourceRoot, "skia");
const safeMaterialPath = (value) => {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) fail(`unsafe material path: ${value}`);
  const path = normalize(join(skiaRoot, value));
  const fromRoot = relative(skiaRoot, path);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) fail(`material path escapes Skia: ${value}`);
  return path;
};

const manifestBytes = readFileSync(manifestPath);
const manifestSha256 = sha256Bytes(manifestBytes);
if (manifestSha256 !== expectedManifestSha256) {
  fail(`manifest digest mismatch: expected ${expectedManifestSha256}, got ${manifestSha256}`);
}
let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString("utf8"));
} catch {
  fail("manifest is not valid JSON");
}
if (manifest.schema_version !== EXPECTED_SCHEMA) fail(`unexpected manifest schema: ${manifest.schema_version}`);
if (manifest.skia_revision !== EXPECTED_SKIA_COMMIT) fail(`unexpected Skia revision: ${manifest.skia_revision}`);
if (manifest.depot_tools_revision !== EXPECTED_DEPOT_TOOLS_COMMIT) {
  fail(`unexpected depot_tools revision: ${manifest.depot_tools_revision}`);
}

const actualDepsSha256 = sha256File(join(skiaRoot, "DEPS"));
if (manifest.skia_deps_sha256 !== actualDepsSha256) {
  fail(`Skia DEPS digest mismatch: expected ${manifest.skia_deps_sha256}, got ${actualDepsSha256}`);
}

if (!Array.isArray(manifest.git_dependencies) || manifest.git_dependencies.length !== EXPECTED_GIT_DEPENDENCY_COUNT) {
  fail(`expected ${EXPECTED_GIT_DEPENDENCY_COUNT} Git dependencies`);
}
const seenPaths = new Set();
for (const dependency of manifest.git_dependencies) {
  const { path: relativePath, revision, object_type: objectType, resolved_commit: resolvedCommit, url } = dependency ?? {};
  if (seenPaths.has(relativePath)) fail(`duplicate Git dependency path: ${relativePath}`);
  seenPaths.add(relativePath);
  if (!/^[0-9a-f]{40}$/.test(revision ?? "") || !["commit", "tag"].includes(objectType) ||
      !/^[0-9a-f]{40}$/.test(resolvedCommit ?? "") || typeof url !== "string" || url.length === 0) {
    fail(`malformed Git dependency: ${relativePath}`);
  }
  const path = safeMaterialPath(relativePath);
  if (!statSync(path).isDirectory()) fail(`Git dependency is not a directory: ${relativePath}`);
  const worktreeStatus = execFileSync("git", ["-C", path, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  if (worktreeStatus.length !== 0) fail(`Git dependency worktree is not clean: ${relativePath}`);
  const actualObjectType = text("git", ["-C", path, "cat-file", "-t", revision]);
  if (actualObjectType !== objectType) {
    fail(`Git object type mismatch at ${relativePath}: expected ${objectType}, got ${actualObjectType}`);
  }
  const actualResolvedCommit = text("git", ["-C", path, "rev-parse", `${revision}^{commit}`]);
  if (actualResolvedCommit !== resolvedCommit) {
    fail(`Git peeled commit mismatch at ${relativePath}: expected ${resolvedCommit}, got ${actualResolvedCommit}`);
  }
  const actualHead = text("git", ["-C", path, "rev-parse", "HEAD"]);
  if (actualHead !== resolvedCommit) {
    fail(`Git HEAD mismatch at ${relativePath}: expected peeled commit ${resolvedCommit}, got ${actualHead}`);
  }
  const actualUrl = text("git", ["-C", path, "remote", "get-url", "origin"]);
  if (canonicalUrl(actualUrl) !== canonicalUrl(url)) {
    fail(`Git origin mismatch at ${relativePath}: expected ${url}, got ${actualUrl}`);
  }
}

if (!Array.isArray(manifest.cipd_materials) || manifest.cipd_materials.length === 0) {
  fail("CIPD material list is missing");
}
let gnMaterial;
for (const material of manifest.cipd_materials) {
  const { path: relativePath, package: packageName, instance_id: instanceId, sha256 } = material ?? {};
  if (typeof packageName !== "string" || packageName.length === 0 ||
      typeof instanceId !== "string" || instanceId.length === 0 || !/^[0-9a-f]{64}$/.test(sha256 ?? "")) {
    fail(`malformed CIPD material: ${relativePath}`);
  }
  const path = safeMaterialPath(relativePath);
  if (!statSync(path).isFile()) fail(`CIPD material is not a file: ${relativePath}`);
  const actualSha256 = sha256File(path);
  if (actualSha256 !== sha256) fail(`CIPD material digest mismatch at ${relativePath}: expected ${sha256}, got ${actualSha256}`);
  if (relativePath === "bin/gn") gnMaterial = { path: relativePath, package: packageName, instance_id: instanceId, sha256 };
}
if (!gnMaterial) fail("GN material identity is missing");

process.stdout.write(JSON.stringify({
  manifest_sha256: manifestSha256,
  skia_deps_sha256: actualDepsSha256,
  git_dependency_count: manifest.git_dependencies.length,
  cipd_material_count: manifest.cipd_materials.length,
  gn: gnMaterial,
}));
