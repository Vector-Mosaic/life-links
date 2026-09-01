import { describe, expect, it, vi } from "vitest";
import {
  getBrowserWebMcpHost,
  LIFE_LINKS_PAGE_TOOL_NAMES,
  validateLifeLinksPageToolCatalog
} from "./browserWebMcpHost";
import type {
  WebMcpJsonValue,
  WebMcpModelContext,
  WebMcpRegistrationOptions,
  WebMcpToolDefinition
} from "../webmcpCompatibility";

class RecordingModelContext implements WebMcpModelContext {
  readonly registrations: Array<{
    readonly definition: WebMcpToolDefinition;
    readonly options?: WebMcpRegistrationOptions;
  }> = [];

  async registerTool<TResult extends WebMcpJsonValue>(
    definition: WebMcpToolDefinition<TResult>,
    options?: WebMcpRegistrationOptions
  ): Promise<void> {
    this.registrations.push({ definition, options });
  }
}

function makeCatalog(label = "one"): readonly WebMcpToolDefinition[] {
  return [...LIFE_LINKS_PAGE_TOOL_NAMES]
    .reverse()
    .map((name) => ({
      name,
      description: `${name} ${label}`,
      inputSchema: { type: "object", additionalProperties: false },
      execute: vi.fn(async () => ({ ok: true, label }))
    }));
}

describe("browser WebMCP host", () => {
  it("keeps unsupported documents on the ordinary human application path", () => {
    expect(getBrowserWebMcpHost(null)).toEqual({ status: "unsupported" });
    expect(getBrowserWebMcpHost({})).toEqual({ status: "unsupported" });
    expect(getBrowserWebMcpHost({ modelContext: {} })).toEqual({ status: "unsupported" });
  });

  it("accepts exactly the canonical tools and orders them deterministically", () => {
    const validation = validateLifeLinksPageToolCatalog(makeCatalog());
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      throw new Error("expected a valid catalog");
    }
    expect(validation.definitions.map(({ name }) => name)).toEqual(
      LIFE_LINKS_PAGE_TOOL_NAMES
    );

    expect(validateLifeLinksPageToolCatalog(makeCatalog().slice(0, 4))).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_catalog", retryable: false }
    });
    expect(validateLifeLinksPageToolCatalog(makeCatalog().filter((tool) => new Set<string>(LIFE_LINKS_PAGE_TOOL_NAMES.slice(0, 5)).has(tool.name)))).toMatchObject({ ok: false, error: { code: "invalid_tool_catalog" } });
    expect(
      validateLifeLinksPageToolCatalog([
        ...makeCatalog().slice(0, 4),
        makeCatalog()[0]
      ])
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_catalog" }
    });
  });

  it("registers the complete catalog directly with document.modelContext and one lifecycle signal", async () => {
    const modelContext = new RecordingModelContext();
    const resolution = getBrowserWebMcpHost({ modelContext });
    expect(resolution.status).toBe("supported");
    if (resolution.status !== "supported") {
      throw new Error("expected a supported host");
    }

    const catalog = validateLifeLinksPageToolCatalog(makeCatalog());
    if (!catalog.ok) {
      throw new Error("expected a valid catalog");
    }
    const controller = new AbortController();
    await resolution.host.registerCatalog(catalog.definitions, controller.signal);

    expect(modelContext.registrations.map(({ definition }) => definition.name)).toEqual(
      LIFE_LINKS_PAGE_TOOL_NAMES
    );
    expect(modelContext.registrations).toHaveLength(14);
    expect(
      new Set(modelContext.registrations.map(({ options }) => options?.signal))
    ).toEqual(new Set([controller.signal]));
  });
});
