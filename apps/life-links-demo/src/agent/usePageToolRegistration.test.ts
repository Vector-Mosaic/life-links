import { describe, expect, it, vi } from "vitest";
import {
  LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES,
  LIFE_LINKS_LEGACY_TOOL_CATALOG_ID,
  LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID,
  LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES,
  LIFE_LINKS_PAGE_TOOL_CATALOG_ID,
  LIFE_LINKS_PAGE_TOOL_NAMES
} from "./browserWebMcpHost";
import {
  PageToolRegistrationLifecycle,
  agentConnectionIsActive,
  eligiblePageToolScopeKey,
  type PageToolEligibility
} from "./usePageToolRegistration";
import type {
  WebMcpJsonValue,
  WebMcpModelContext,
  WebMcpRegistrationOptions,
  WebMcpToolDefinition
} from "../webmcpCompatibility";

interface RecordedRegistration {
  readonly definition: WebMcpToolDefinition;
  readonly options?: WebMcpRegistrationOptions;
  readonly accepted: boolean;
}

class ControlledModelContext implements WebMcpModelContext {
  readonly registrations: RecordedRegistration[] = [];
  readonly tools = new Map<string, WebMcpToolDefinition>();

  async registerTool<TResult extends WebMcpJsonValue>(
    definition: WebMcpToolDefinition<TResult>,
    options?: WebMcpRegistrationOptions
  ): Promise<void> {
    if (this.tools.has(definition.name)) {
      this.registrations.push({ definition, options, accepted: false });
      throw new Error("duplicate tool name; internal host detail must stay private");
    }

    this.registrations.push({ definition, options, accepted: true });
    this.tools.set(definition.name, definition);
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (this.tools.get(definition.name) === definition) {
          this.tools.delete(definition.name);
        }
      },
      { once: true }
    );
  }
}

class FirstRegistrationPauseModelContext extends ControlledModelContext {
  readonly firstRegistrationPaused: Promise<void>;
  private readonly firstRegistrationReleased: Promise<void>;
  private markFirstRegistrationPaused: () => void = () => undefined;
  private releaseFirstRegistration: () => void = () => undefined;

  constructor() {
    super();
    this.firstRegistrationPaused = new Promise<void>((resolve) => {
      this.markFirstRegistrationPaused = resolve;
    });
    this.firstRegistrationReleased = new Promise<void>((resolve) => {
      this.releaseFirstRegistration = resolve;
    });
  }

  override async registerTool<TResult extends WebMcpJsonValue>(
    definition: WebMcpToolDefinition<TResult>,
    options?: WebMcpRegistrationOptions
  ): Promise<void> {
    await super.registerTool(definition, options);
    if (this.registrations.length === 1) {
      this.markFirstRegistrationPaused();
      await this.firstRegistrationReleased;
    }
  }

  releaseCatalogRegistration(): void {
    this.releaseFirstRegistration();
  }
}

const ELIGIBLE: PageToolEligibility = {
  authenticatedOwnerId: "owner-one",
  surface: "owner-workspace",
  agentConnected: true,
  catalogId: LIFE_LINKS_PAGE_TOOL_CATALOG_ID
};

function makeCatalog(version: string): readonly WebMcpToolDefinition[] {
  return LIFE_LINKS_PAGE_TOOL_NAMES.map((name) => ({
    name,
    description: `${name} test definition`,
    inputSchema: { type: "object", additionalProperties: false },
    execute: vi.fn(async () => ({ ok: true, name, version }))
  }));
}

describe("page tool registration lifecycle", () => {
  it("activates a saved connection only in its authenticated owner workspace", () => {
    expect(agentConnectionIsActive(true, "owner-one", "owner-workspace", false)).toBe(true);
    expect(agentConnectionIsActive(false, "owner-one", "owner-workspace", false)).toBe(false);
    expect(agentConnectionIsActive(true, "owner-one", "public-qr", false)).toBe(false);
    expect(agentConnectionIsActive(true, "owner-one", "login", false)).toBe(false);
    expect(agentConnectionIsActive(true, "owner-one", "owner-workspace", true)).toBe(false);
    expect(agentConnectionIsActive(true, null, "owner-workspace", false)).toBe(false);
  });

  it("requires authenticated owner, owner workspace, and a saved connection together", async () => {
    expect(
      eligiblePageToolScopeKey({ ...ELIGIBLE, authenticatedOwnerId: null })
    ).toBeNull();
    expect(
      eligiblePageToolScopeKey({ ...ELIGIBLE, surface: "login" })
    ).toBeNull();
    expect(
      eligiblePageToolScopeKey({ ...ELIGIBLE, surface: "public-qr" })
    ).toBeNull();
    expect(
      eligiblePageToolScopeKey({ ...ELIGIBLE, agentConnected: false })
    ).toBeNull();
    expect(eligiblePageToolScopeKey({ ...ELIGIBLE, catalogId: null })).toBeNull();
    expect(eligiblePageToolScopeKey({ ...ELIGIBLE, catalogId: LIFE_LINKS_LEGACY_TOOL_CATALOG_ID })).toBe(
      `owner:owner-one:catalog:${LIFE_LINKS_LEGACY_TOOL_CATALOG_ID}`
    );
    expect(eligiblePageToolScopeKey({ ...ELIGIBLE, catalogId: "unknown-catalog" })).toBeNull();
    expect(eligiblePageToolScopeKey(ELIGIBLE)).toBe(`owner:owner-one:catalog:${LIFE_LINKS_PAGE_TOOL_CATALOG_ID}`);

    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const documentLike = { modelContext };
    for (const eligibility of [
      { ...ELIGIBLE, authenticatedOwnerId: null },
      { ...ELIGIBLE, surface: "login" as const },
      { ...ELIGIBLE, surface: "public-qr" as const },
      { ...ELIGIBLE, agentConnected: false },
      { ...ELIGIBLE, catalogId: "unknown-catalog" }
    ]) {
      await expect(
        lifecycle.synchronize({
          documentLike,
          eligibility,
          definitions: makeCatalog("inactive")
        })
      ).resolves.toEqual({ status: "inactive" });
    }
    expect(modelContext.registrations).toHaveLength(0);
  });

  it("preserves v1 at fourteen and v2 at twenty-one, adding workspace actions only after v3 grant", async () => {
    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const definitions = makeCatalog("versioned");
    const legacyDefinitions = definitions.filter(({ name }) =>
      new Set<string>(LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES).has(name)
    );

    await expect(lifecycle.synchronize({
      documentLike: { modelContext },
      eligibility: { ...ELIGIBLE, catalogId: LIFE_LINKS_LEGACY_TOOL_CATALOG_ID },
      definitions: legacyDefinitions
    })).resolves.toEqual({ status: "registered", toolNames: LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES });
    expect([...modelContext.tools.keys()]).toEqual(LIFE_LINKS_LEGACY_PAGE_TOOL_NAMES);
    expect(modelContext.tools.has("list_my_calendars")).toBe(false);

    await expect(lifecycle.synchronize({ documentLike: { modelContext }, eligibility: { ...ELIGIBLE, catalogId: LIFE_LINKS_CALENDAR_TOOL_CATALOG_ID }, definitions }))
      .resolves.toEqual({ status: "registered", toolNames: LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES });
    expect([...modelContext.tools.keys()]).toEqual(LIFE_LINKS_CALENDAR_PAGE_TOOL_NAMES);
    expect(modelContext.tools.has("apply_routine_deletion")).toBe(false);

    await expect(lifecycle.synchronize({
      documentLike: { modelContext },
      eligibility: ELIGIBLE,
      definitions
    })).resolves.toEqual({ status: "registered", toolNames: LIFE_LINKS_PAGE_TOOL_NAMES });
    expect([...modelContext.tools.keys()]).toEqual(LIFE_LINKS_PAGE_TOOL_NAMES);
  });

  it("reports an eligible unsupported browser without disturbing the human path", async () => {
    const lifecycle = new PageToolRegistrationLifecycle();
    await expect(
      lifecycle.synchronize({
        documentLike: {},
        eligibility: ELIGIBLE,
        definitions: makeCatalog("unsupported")
      })
    ).resolves.toEqual({
      status: "unsupported",
      message: "WebMCP unavailable in this browser"
    });
  });

  it("registers the complete catalog together and dispatches through the current definitions", async () => {
    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const documentLike = { modelContext };

    await expect(
      lifecycle.synchronize({
        documentLike,
        eligibility: ELIGIBLE,
        definitions: makeCatalog("first")
      })
    ).resolves.toMatchObject({ status: "registered" });

    expect([...modelContext.tools.keys()]).toEqual(LIFE_LINKS_PAGE_TOOL_NAMES);
    expect(modelContext.registrations).toHaveLength(26);
    const signals = modelContext.registrations.map(({ options }) => options?.signal);
    expect(signals.every((signal) => signal === signals[0])).toBe(true);

    const registeredInspect = modelContext.tools.get("inspect_current_life_link");
    expect(registeredInspect).toBeDefined();
    await expect(registeredInspect!.execute({}, {})).resolves.toMatchObject({
      version: "first"
    });

    await lifecycle.synchronize({
      documentLike,
      eligibility: ELIGIBLE,
      definitions: makeCatalog("current")
    });
    expect(modelContext.registrations).toHaveLength(26);
    await expect(registeredInspect!.execute({}, {})).resolves.toMatchObject({
      version: "current"
    });
  });

  it("does not execute a partially registered catalog before every tool activates", async () => {
    const modelContext = new FirstRegistrationPauseModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const documentLike = { modelContext };

    const registration = lifecycle.synchronize({
      documentLike,
      eligibility: ELIGIBLE,
      definitions: makeCatalog("atomic")
    });
    await modelContext.firstRegistrationPaused;

    expect(lifecycle.getStatus()).toMatchObject({ status: "registering" });
    expect(modelContext.tools.size).toBe(1);
    const registeredInspect = modelContext.tools.get("inspect_current_life_link");
    expect(registeredInspect).toBeDefined();
    await expect(registeredInspect!.execute({}, {})).rejects.toThrow(
      "Life Links page tool is not active."
    );

    modelContext.releaseCatalogRegistration();
    await expect(registration).resolves.toMatchObject({ status: "registered" });
    expect(modelContext.tools.size).toBe(26);
    await expect(registeredInspect!.execute({}, {})).resolves.toMatchObject({
      ok: true,
      version: "atomic"
    });
  });

  it("uses one abort signal to clean up the whole catalog on every eligibility boundary", async () => {
    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const documentLike = { modelContext };
    const catalog = makeCatalog("cleanup");

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    const firstSignal = modelContext.registrations[0].options?.signal;
    expect(modelContext.tools.size).toBe(26);

    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, agentConnected: false },
      definitions: catalog
    });
    expect(firstSignal?.aborted).toBe(true);
    expect(modelContext.tools.size).toBe(0);

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    const ownerOneSignal = modelContext.registrations[18].options?.signal;
    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, authenticatedOwnerId: "owner-two" },
      definitions: catalog
    });
    expect(ownerOneSignal?.aborted).toBe(true);
    expect(modelContext.tools.size).toBe(26);

    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, surface: "public-qr" },
      definitions: catalog
    });
    expect(modelContext.tools.size).toBe(0);

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, authenticatedOwnerId: null },
      definitions: catalog
    });
    expect(modelContext.tools.size).toBe(0);

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, surface: "login" },
      definitions: catalog
    });
    expect(modelContext.tools.size).toBe(0);

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    lifecycle.dispose();
    expect(modelContext.tools.size).toBe(0);
    expect(lifecycle.getStatus()).toEqual({ status: "inactive" });
  });

  it("binds an input-only native invocation to registration revocation", async () => {
    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    const documentLike = { modelContext };
    let invocationSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const catalog = makeCatalog("revocable").map((definition) =>
      definition.name === "inspect_current_life_link"
        ? {
            ...definition,
            execute: async (_input: unknown, context?: { signal?: AbortSignal }) => {
              invocationSignal = context?.signal;
              markStarted?.();
              if (!invocationSignal) {
                return { ok: false, cancelled: false };
              }
              if (!invocationSignal.aborted) {
                await new Promise<void>((resolve) =>
                  invocationSignal!.addEventListener("abort", () => resolve(), { once: true })
                );
              }
              return { ok: false, cancelled: invocationSignal.aborted };
            }
          }
        : definition
    );

    await lifecycle.synchronize({ documentLike, eligibility: ELIGIBLE, definitions: catalog });
    const registeredInspect = modelContext.tools.get("inspect_current_life_link");
    expect(registeredInspect).toBeDefined();
    const invocation = registeredInspect!.execute({});
    await started;
    expect(invocationSignal).toBeDefined();
    expect(invocationSignal?.aborted).toBe(false);

    await lifecycle.synchronize({
      documentLike,
      eligibility: { ...ELIGIBLE, agentConnected: false },
      definitions: catalog
    });

    expect(invocationSignal?.aborted).toBe(true);
    await expect(invocation).resolves.toEqual({ ok: false, cancelled: true });
  });

  it("aborts partial registration and surfaces duplicate-name failure without raw host detail", async () => {
    const modelContext = new ControlledModelContext();
    const externalController = new AbortController();
    const catalog = makeCatalog("duplicate");
    await modelContext.registerTool(catalog[2], { signal: externalController.signal });

    const lifecycle = new PageToolRegistrationLifecycle();
    const result = await lifecycle.synchronize({
      documentLike: { modelContext },
      eligibility: ELIGIBLE,
      definitions: catalog
    });

    expect(result).toMatchObject({
      status: "error",
      error: { code: "duplicate_tool_name", retryable: true }
    });
    expect(JSON.stringify(result)).not.toContain("internal host detail");
    expect(modelContext.tools.size).toBe(1);
    expect(modelContext.tools.get(catalog[2].name)).toBe(catalog[2]);
    expect(externalController.signal.aborted).toBe(false);
    const lifecycleSignals = modelContext.registrations
      .slice(1)
      .map(({ options }) => options?.signal);
    expect(lifecycleSignals).toHaveLength(3);
    expect(lifecycleSignals.every((signal) => signal?.aborted)).toBe(true);
    expect(new Set(lifecycleSignals).size).toBe(1);

    const registrationAttempts = modelContext.registrations.length;
    await expect(
      lifecycle.synchronize({
        documentLike: { modelContext },
        eligibility: ELIGIBLE,
        definitions: makeCatalog("new-render")
      })
    ).resolves.toBe(result);
    expect(modelContext.registrations).toHaveLength(registrationAttempts);
  });

  it("rejects an incomplete catalog before exposing any tools", async () => {
    const modelContext = new ControlledModelContext();
    const lifecycle = new PageToolRegistrationLifecycle();
    await expect(
      lifecycle.synchronize({
        documentLike: { modelContext },
        eligibility: ELIGIBLE,
        definitions: makeCatalog("incomplete").slice(0, 4)
      })
    ).resolves.toMatchObject({
      status: "error",
      error: { code: "invalid_tool_catalog", retryable: false }
    });
    expect(modelContext.registrations).toHaveLength(0);
    expect(modelContext.tools.size).toBe(0);
  });
});
