import {
  getWebMcpModelContext,
  type WebMcpModelContext,
  type WebMcpToolDefinition
} from "../webmcpCompatibility";

export const LIFE_LINKS_PAGE_TOOL_NAMES = [
  "inspect_current_life_link",
  "search_my_life_links",
  "open_life_link",
  "update_life_link_content",
  "start_find_mode"
] as const;

export type LifeLinksPageToolName = (typeof LIFE_LINKS_PAGE_TOOL_NAMES)[number];

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
  message: "Life Links Agent Access requires its complete five-tool physical-context catalog.",
  retryable: false
} as const;

export function validateLifeLinksPageToolCatalog(
  definitions: readonly WebMcpToolDefinition[]
): LifeLinksPageToolCatalogValidation {
  if (definitions.length !== LIFE_LINKS_PAGE_TOOL_NAMES.length) {
    return { ok: false, error: INVALID_CATALOG_ERROR };
  }

  const definitionsByName = new Map<string, WebMcpToolDefinition>();
  for (const definition of definitions) {
    if (definitionsByName.has(definition.name)) {
      return { ok: false, error: INVALID_CATALOG_ERROR };
    }
    definitionsByName.set(definition.name, definition);
  }

  const orderedDefinitions: WebMcpToolDefinition[] = [];
  for (const name of LIFE_LINKS_PAGE_TOOL_NAMES) {
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
