import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLifeLinksAgentToolCatalog,
  type LifeLinksAgentToolController
} from "../src/agent/toolHandlers";
import {
  LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
  LIFE_LINKS_LEGACY_TOOL_CATALOG_ID
} from "../src/agent/calendarToolHandlers";
import {
  LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES,
  LIFE_LINKS_PAGE_TOOL_NAMES,
  validateLifeLinksPageToolCatalog
} from "../src/agent/browserWebMcpHost";
import type { WebMcpToolDefinition } from "../src/webmcpCompatibility";

const SNAPSHOT_FILENAME =
  "life-links-calendar-v2.authenticated-owner-page.full.json";
const SNAPSHOT_SCHEMA_VERSION = "life-links-page-webmcp-contract-snapshot.v2";
const NORMALIZATION_PROFILE = "life-links-page-webmcp-catalog-v2";
const GENERATOR_SOURCE =
  "systems/life_links/apps/life-links-demo/tools/webmcp-contract-snapshot.ts";
const CATALOG_SOURCE =
  "systems/life_links/apps/life-links-demo/src/agent/toolHandlers.ts";
const CALENDAR_CATALOG_SOURCE =
  "systems/life_links/apps/life-links-demo/src/agent/calendarToolHandlers.ts";
const REGISTRATION_SOURCE =
  "systems/life_links/apps/life-links-demo/src/agent/browserWebMcpHost.ts";
const ACTIVATION_SOURCE =
  "systems/life_links/apps/life-links-demo/src/agent/usePageToolRegistration.ts";
const COMPATIBILITY_SOURCE =
  "systems/life_links/apps/life-links-demo/src/webmcpCompatibility.ts";

const sourcePath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(sourcePath), "..");
const sourcePathPortable = sourcePath.replace(/\\/g, "/");
const usesMonorepoLayout = sourcePathPortable.endsWith(GENERATOR_SOURCE);
const sourceRoot = usesMonorepoLayout
  ? path.resolve(appRoot, "..", "..", "..", "..")
  : path.resolve(appRoot, "..", "..");
const contractDirectory = path.resolve(appRoot, "..", "..", "contracts", "mcp");

const DIGEST_SOURCE_PATHS = [
  CATALOG_SOURCE,
  CALENDAR_CATALOG_SOURCE,
  REGISTRATION_SOURCE,
  ACTIVATION_SOURCE,
  COMPATIBILITY_SOURCE,
  GENERATOR_SOURCE
] as const;

function physicalSourcePath(canonicalPath: string): string {
  const relativePath = usesMonorepoLayout
    ? canonicalPath
    : canonicalPath.replace(/^systems\/life_links\//, "");
  return path.join(sourceRoot, relativePath);
}

function snapshotInvocationForbidden(): never {
  throw new Error("WebMCP contract discovery must not invoke page tools.");
}

const inertController = new Proxy({} as LifeLinksAgentToolController, {
  get: () => snapshotInvocationForbidden
});

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function normalizedTool(definition: WebMcpToolDefinition): Record<string, unknown> {
  return {
    name: definition.name,
    ...(definition.title === undefined ? {} : { title: definition.title }),
    description: definition.description,
    inputSchema: definition.inputSchema,
    ...(definition.annotations === undefined
      ? {}
      : { annotations: definition.annotations })
  };
}

function discoverTools(): readonly Record<string, unknown>[] {
  const validation = validateLifeLinksPageToolCatalog(
    createLifeLinksAgentToolCatalog(inertController)
  );
  if (!validation.ok) {
    throw new Error(validation.error.message);
  }
  return validation.definitions.map(normalizedTool);
}

async function sourceDigest(
  tools: readonly Record<string, unknown>[]
): Promise<string> {
  const digest = createHash("sha256");
  for (const relativePath of DIGEST_SOURCE_PATHS) {
    const normalized = (
      await fs.readFile(physicalSourcePath(relativePath), "utf8")
    ).replace(/\r\n?/g, "\n");
    digest.update(relativePath);
    digest.update("\0");
    digest.update(normalized);
    digest.update("\0");
  }
  digest.update("normalized-page-tool-catalog\0");
  digest.update(canonicalBytes({ tools }));
  return digest.digest("hex");
}

export function webMcpSnapshotPath(): string {
  return path.join(contractDirectory, SNAPSHOT_FILENAME);
}

export async function buildWebMcpContractSnapshot(): Promise<
  Record<string, unknown>
> {
  const tools = discoverTools();
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    artifact_id:
      "artifact.life_links.page_webmcp.snapshot.authenticated_owner_calendar_v2",
    artifact_role: "derived_evidence",
    contract_authority_artifact_id:
      "artifact.life_links.page_webmcp.registration_authority.calendar_v2",
    interface_id: "if.life_links.page_webmcp",
    contract_line_id: LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
    contract_version: "2",
    stability_state: "experimental",
    protocol: {
      family: "WebMCP",
      negotiated_revision: null,
      revision_status: "no_revision_negotiated_by_current_page_host"
    },
    configuration: {
      partition_id: "partition.life_links.authenticated_owner_page_webmcp",
      catalog_profile_id:
        "catalog.life_links.authenticated_owner_page_webmcp.calendar_v2",
      required_persisted_grant_id: LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
      legacy_grant_id: LIFE_LINKS_LEGACY_TOOL_CATALOG_ID,
      legacy_grant_inherits_calendar_access: false,
      grant_profiles: [
        {
          id: LIFE_LINKS_LEGACY_TOOL_CATALOG_ID,
          tool_count: LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES.length,
          calendar_access: false
        },
        {
          id: LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
          tool_count: LIFE_LINKS_PAGE_TOOL_NAMES.length,
          calendar_access: true
        }
      ],
      exposure: "page_bound",
      registration_host: "document.modelContext",
      page_scope: "eligible_authenticated_owner_workspace",
      catalog_activation: "all_or_none",
      remote_mcp_server: false,
      system_mcp_server: false,
      network_listener: false
    },
    derivation: {
      generator: GENERATOR_SOURCE,
      catalog_source: CATALOG_SOURCE,
      calendar_catalog_source: CALENDAR_CATALOG_SOURCE,
      registration_source: REGISTRATION_SOURCE,
      activation_source: ACTIVATION_SOURCE,
      compatibility_source: COMPATIBILITY_SOURCE,
      normalization_profile: NORMALIZATION_PROFILE,
      source_sha256: await sourceDigest(tools),
      source_inputs: [...DIGEST_SOURCE_PATHS, "normalized-page-tool-catalog"],
      digest_inputs:
        "normalized declared source inputs plus the normalized page tool catalog",
      tool_execution_performed: false,
      live_page_state_included: false,
      live_evidence_included: false,
      live_secrets_required: false
    },
    catalog: {
      tool_count: tools.length,
      tools
    }
  };
}

export async function renderWebMcpContractSnapshot(): Promise<string> {
  return canonicalBytes(await buildWebMcpContractSnapshot());
}

export async function generateWebMcpContractSnapshot(): Promise<void> {
  await fs.mkdir(contractDirectory, { recursive: true });
  await fs.writeFile(
    webMcpSnapshotPath(),
    await renderWebMcpContractSnapshot(),
    "utf8"
  );
}

export async function checkWebMcpContractSnapshot(): Promise<void> {
  const expected = await renderWebMcpContractSnapshot();
  let actual: string;
  try {
    actual = await fs.readFile(webMcpSnapshotPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "Life Links page WebMCP contract snapshot is missing; run contract generation."
      );
    }
    throw error;
  }
  if (actual !== expected) {
    throw new Error(
      "Life Links page WebMCP contract snapshot is stale; run contract generation."
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "generate") {
    await generateWebMcpContractSnapshot();
    process.stdout.write("Generated Life Links page WebMCP contract snapshot.\n");
    return;
  }
  if (command === "check") {
    await checkWebMcpContractSnapshot();
    process.stdout.write("Checked Life Links page WebMCP contract snapshot.\n");
    return;
  }
  throw new Error("Usage: webmcp-contract-snapshot <generate|check>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === sourcePath) {
  main().catch((error) => {
    process.stderr.write(
      `${
        error instanceof Error
          ? error.message
          : "WebMCP contract snapshot command failed."
      }\n`
    );
    process.exitCode = 1;
  });
}
