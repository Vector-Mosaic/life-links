import {
  getWebMcpModelContext,
  type WebMcpModelContext,
  type WebMcpToolDefinition
} from "../webmcpCompatibility";
import {
  LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
  LIFE_LINKS_CALENDAR_TOOL_NAMES,
  LIFE_LINKS_LEGACY_TOOL_CATALOG_ID
} from "./calendarToolHandlers";
import { LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID, LIFE_LINKS_WORKSPACE_TOOL_NAMES } from "./workspaceToolHandlers";
import { LIFE_LINKS_SEARCH_TOOL_CATALOG_ID, LIFE_LINKS_SEARCH_TOOL_NAMES } from "./searchToolHandlers";

export { LIFE_LINKS_LEGACY_TOOL_CATALOG_ID, LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID, LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID, LIFE_LINKS_SEARCH_TOOL_CATALOG_ID };

export const LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES = [
  "inspect_current_life_link",
  "search_my_life_links",
  "open_life_link",
  "update_life_link_content",
  "start_find_mode",
  "create_life_link",
  "move_life_link",
  "manage_life_link_qr",
  "list_my_collections",
  "inspect_collection",
  "maintain_collection",
  "prepare_life_link_change",
  "apply_life_link_change",
  "read_life_link_attachment"
] as const;

export const LIFE_LINKS_PAGE_TOOL_CATALOG_ID = LIFE_LINKS_SEARCH_TOOL_CATALOG_ID;
export const LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES = [
  ...LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES,
  ...LIFE_LINKS_CALENDAR_TOOL_NAMES
] as const;
export const LIFE_LINKS_WORKSPACE_PAGE_TOOL_NAMES = [...LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES, ...LIFE_LINKS_WORKSPACE_TOOL_NAMES] as const;
export const LIFE_LINKS_PAGE_TOOL_NAMES = [...LIFE_LINKS_WORKSPACE_PAGE_TOOL_NAMES, ...LIFE_LINKS_SEARCH_TOOL_NAMES] as const;

export type LifeLinksPageToolName = (typeof LIFE_LINKS_PAGE_TOOL_NAMES)[number];
export type LifeLinksPageToolCatalogId =
  | typeof LIFE_LINKS_LEGACY_TOOL_CATALOG_ID
  | typeof LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID
  | typeof LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID
  | typeof LIFE_LINKS_PAGE_TOOL_CATALOG_ID;

export interface BrowserWebMcpHost {
  readonly modelContext: WebMcpModelContext;
  registerCatalog(
    definitions: readonly WebMcpToolDefinition[],
    signal: AbortSignal
  ): Promise<void>;
}

export type BrowserWebMcpHostResolution =
  | { readonly status: "supported"; readonly host: BrowserWebMcpHost }
  | { readonly status: "unsupported" };

export type LifeLinksPageToolCatalogValidation =
  | {
      readonly ok: true;
      readonly definitions: readonly WebMcpToolDefinition[];
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_tool_catalog";
        readonly message: string;
        readonly retryable: false;
      };
    };

const INVALID_CATALOG_ERROR = {
  code: "invalid_tool_catalog",
  message: `The Life Links agent connection requires the complete ${LIFE_LINKS_PAGE_TOOL_CATALOG_ID} tool catalog.`,
  retryable: false
} as const;

export function validateLifeLinksPageToolCatalog(
  definitions: readonly WebMcpToolDefinition[],
  catalogId: LifeLinksPageToolCatalogId = LIFE_LINKS_PAGE_TOOL_CATALOG_ID
): LifeLinksPageToolCatalogValidation {
  const grantedNames = catalogId === LIFE_LINKS_LEGACY_TOOL_CATALOG_ID
    ? LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES
    : catalogId === LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID ? LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES
      : catalogId === LIFE_LINKS_WORKSPACE_TOOL_CATALOG_ID ? LIFE_LINKS_WORKSPACE_PAGE_TOOL_NAMES : LIFE_LINKS_PAGE_TOOL_NAMES;
  if (
    definitions.length < grantedNames.length ||
    (catalogId === LIFE_LINKS_PAGE_TOOL_CATALOG_ID &&
      definitions.length !== LIFE_LINKS_PAGE_TOOL_NAMES.length)
  ) {
    return { ok: false, error: INVALID_CATALOG_ERROR };
  }

  const knownNames = new Set<string>(LIFE_LINKS_PAGE_TOOL_NAMES);
  const definitionsByName = new Map<string, WebMcpToolDefinition>();
  for (const definition of definitions) {
    if (!knownNames.has(definition.name) || definitionsByName.has(definition.name)) {
      return { ok: false, error: INVALID_CATALOG_ERROR };
    }
    definitionsByName.set(definition.name, definition);
  }

  const orderedDefinitions: WebMcpToolDefinition[] = [];
  for (const name of grantedNames) {
    const definition = definitionsByName.get(name);
    if (!definition) {
      return { ok: false, error: INVALID_CATALOG_ERROR };
    }
    orderedDefinitions.push(definition);
  }

  return { ok: true, definitions: orderedDefinitions };
}

export function getBrowserWebMcpHost(
  documentLike: object | null | undefined
): BrowserWebMcpHostResolution {
  if (documentLike === null || documentLike === undefined) {
    return { status: "unsupported" };
  }

  const modelContext = getWebMcpModelContext(documentLike);
  if (modelContext === null) {
    return { status: "unsupported" };
  }

  return {
    status: "supported",
    host: {
      modelContext,
      registerCatalog: async (definitions, signal) => {
        for (const definition of definitions) {
          await modelContext.registerTool(definition, { signal });
        }
      }
    }
  };
}
