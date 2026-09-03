import { readFileSync } from "node:fs";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import { MAX_LIFE_LINK_TOOL_OUTPUT_BYTES, RECORD_SEARCH_CATEGORIES, type RecordSearchHit } from "@life-links/core";
import { createSearchAgentToolCatalog, LIFE_LINKS_SEARCH_TOOL_CATALOG_ID, type SearchAgentToolController } from "./searchToolHandlers";
import { createLifeLinksAgentToolCatalog, type LifeLinksAgentToolController } from "./toolHandlers";
import type { WorkspaceAgentAccessSnapshot } from "./workspaceToolHandlers";
import { AgentAccessPanel } from "./AgentAccessPanel";

class Controller implements SearchAgentToolController {
  snapshot: WorkspaceAgentAccessSnapshot = { currentUser: { id: "owner" }, routeQrId: null, guestView: false,
    canonicalEditingId: null, agentConnection: { connected: true, toolCatalogId: LIFE_LINKS_SEARCH_TOOL_CATALOG_ID } };
  getSnapshot() { return this.snapshot; }
  agentSearchRecords = vi.fn<SearchAgentToolController["agentSearchRecords"]>(async (input) => ({ ok: true,
    page: { category: input.category, results: [], nextCursor: null, scanned: 12, warnings: [] } }));
}
const tool = (controller: Controller) => createSearchAgentToolCatalog(controller)[0];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const hit = (index: number, snippet = "Recorded contents"): RecordSearchHit => ({
  id: `hit-${index}`, category: "life_links", title: `Item ${index}`, snippet, matchedField: "body",
  reference: { kind: "life_link", lifeLinkId: `item-${index}` }
});

describe("search-v4 page tool", () => {
  it("offers the explicit Search-v4 upgrade to a v3 connection without silently changing either grant", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain('import { LIFE_LINKS_SEARCH_TOOL_CATALOG_ID } from "./agent/searchToolHandlers"');
    expect(app).toContain("catalogCurrent={agentConnection.toolCatalogId === LIFE_LINKS_SEARCH_TOOL_CATALOG_ID}");
    for (const catalog of ["life-links-workspace-v3", LIFE_LINKS_SEARCH_TOOL_CATALOG_ID]) {
      const onConnect = vi.fn();
      const onDisconnect = vi.fn();
      const buttons: ReactElement<{ children?: ReactNode; onClick?: () => void }>[] = [];
      const visit = (node: ReactNode) => Children.forEach(node, (child) => {
        if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return;
        if (child.type === "button") buttons.push(child);
        visit(child.props.children);
      });
      // Inspect the component's actual element result, without a DOM renderer
      // or hooks; App's caller expression above binds this to the live defect.
      visit(AgentAccessPanel({ supported: true, connected: true, busy: false,
        publicBaseUrl: "https://example.test",
        catalogCurrent: catalog === LIFE_LINKS_SEARCH_TOOL_CATALOG_ID, registrationStatus: "ready",
        registrationError: "", onConnect, onDisconnect }));
      const upgrade = buttons.find((button) => button.props.children === "Update Agent Access");
      expect(Boolean(upgrade)).toBe(catalog === "life-links-workspace-v3");
      expect(onConnect).not.toHaveBeenCalled();
      expect(onDisconnect).not.toHaveBeenCalled();
      if (upgrade) { upgrade.props.onClick!(); expect(onConnect).toHaveBeenCalledOnce(); }
    }
  });

  it.each(["https://lifelinks.vmosaic.com", "https://configured.example.test/nested", "http://localhost:3002"])(
    "discovers remote connections at the configured origin %s without changing page grants", (publicBaseUrl) => {
      const onConnect = vi.fn(); const onDisconnect = vi.fn();
      const elements: ReactElement<Record<string, unknown> & { children?: ReactNode }>[] = [];
      const copy: string[] = [];
      const visit = (node: ReactNode) => Children.forEach(node, (child) => {
        if (typeof child === "string") copy.push(child);
        if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(child)) return;
        elements.push(child); visit(child.props.children);
      });
      visit(AgentAccessPanel({ supported: false, connected: true, catalogCurrent: true, busy: false,
        registrationStatus: "inactive", registrationError: "", publicBaseUrl, onConnect, onDisconnect }));
      const endpoint = elements.find((element) => element.type === "input" && element.props["aria-label"] === "Remote MCP endpoint");
      expect(endpoint?.props).toMatchObject({ value: `${new URL(publicBaseUrl).origin}/mcp`, readOnly: true });
      const management = elements.find((element) => element.type === "a" && element.props.children === "Manage remote connections");
      expect(management?.props.href).toBe(`${new URL(publicBaseUrl).origin}/agent-connections`);
      expect(copy.join(" ")).toContain("with this page closed");
      expect(copy.join(" ")).toContain("Browser tools require this Life Links page to stay open");
      expect(onConnect).not.toHaveBeenCalled(); expect(onDisconnect).not.toHaveBeenCalled();
      const disconnect = elements.find((element) => element.type === "button" && element.props.children === "Disconnect Agent");
      (disconnect?.props.onClick as () => void)();
      expect(onDisconnect).toHaveBeenCalledOnce(); expect(onConnect).not.toHaveBeenCalled();
      expect(readFileSync(new URL("../App.tsx", import.meta.url), "utf8")).toContain("publicBaseUrl={qrBaseUrl}");
    }
  );

  it("adds only one descriptor while preserving every frozen v3 descriptor and bounded host registration", () => {
    const definitions = createLifeLinksAgentToolCatalog(new Proxy({} as LifeLinksAgentToolController,
      { get: () => () => { throw new Error("discovery must not invoke a controller"); } }));
    const frozen = JSON.parse(readFileSync(new URL("../../../../contracts/mcp/life-links-workspace-v3.authenticated-owner-page.full.json", import.meta.url), "utf8"));
    const descriptors = definitions.map(({ execute: _execute, ...descriptor }) => descriptor);
    expect(definitions).toHaveLength(27);
    expect(descriptors.slice(0, 26)).toEqual(frozen.catalog.tools);
    expect(descriptors[26].name).toBe("search_my_records");
    expect(bytes(descriptors.map((descriptor) => ({ ...descriptor, origin: "https://lifelinks.vmosaic.com",
      pageUrl: "https://lifelinks.vmosaic.com/calendar?view=month&date=2026-09-02" })))).toBeLessThan(65_536);
  });

  it.each(RECORD_SEARCH_CATEGORIES)("passes %s through the canonical controller and marks returned content untrusted", async (category) => {
    const controller = new Controller(); const signal = new AbortController().signal;
    const result = await tool(controller).execute({ query: "original query", category, cursor: "exact-cursor" }, { signal });
    expect(controller.agentSearchRecords).toHaveBeenCalledWith({ q: "original query", category, cursor: "exact-cursor", limit: 3 }, signal);
    expect(result).toEqual({ ok: true, category, results: [], nextCursor: null, scanned: 12, warnings: [], contentIsUntrusted: true });
  });

  it.each([null, "life-links-page-webmcp-v1", "life-links-calendar-v2", "life-links-workspace-v3", "unknown"])("never grants search to %s", async (toolCatalogId) => {
    const controller = new Controller(); controller.snapshot = { ...controller.snapshot, agentConnection: { connected: true, toolCatalogId } };
    expect(await tool(controller).execute({ query: "private", category: "history" })).toMatchObject({ ok: false, error: { code: "search_catalog_not_granted" } });
    expect(controller.agentSearchRecords).not.toHaveBeenCalled();
  });

  it("keeps the schema closed and refuses invalid inputs before dispatch", async () => {
    const controller = new Controller(); const definition = tool(controller);
    const validate = new Ajv().compile(definition.inputSchema);
    for (const input of [{ query: "x", category: "all" }, { query: "", category: "history" },
      { query: "x", category: "calendar", limit: 11 }, { query: "x", category: "calendar", limit: 1.5 },
      { query: "x", category: "attachments", ownerId: "other" }, { query: "x", category: "attachments", cursor: "" }]) {
      expect(validate(input)).toBe(false);
      expect(await definition.execute(input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    }
    expect(controller.agentSearchRecords).not.toHaveBeenCalled();
  });

  it.each(["disconnect", "owner", "public", "abort"])("does not release results after %s changes during the request", async (change) => {
    const controller = new Controller(); const abort = new AbortController();
    controller.agentSearchRecords.mockImplementationOnce(async (input) => {
      if (change === "disconnect") controller.snapshot = { ...controller.snapshot, agentConnection: { connected: false, toolCatalogId: LIFE_LINKS_SEARCH_TOOL_CATALOG_ID } };
      if (change === "owner") controller.snapshot = { ...controller.snapshot, currentUser: { id: "another-owner" } };
      if (change === "public") controller.snapshot = { ...controller.snapshot, guestView: true };
      if (change === "abort") abort.abort();
      return { ok: true, page: { category: input.category, results: [hit(1, "Do not release these contents")], nextCursor: null, scanned: 1, warnings: [] } };
    });
    const result = await tool(controller).execute({ query: "private", category: "life_links" }, { signal: abort.signal });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("Do not release");
  });

  it("re-queries an oversized page at the same cursor instead of dropping hits against a later cursor", async () => {
    const controller = new Controller();
    controller.agentSearchRecords.mockImplementation(async (input) => ({ ok: true, page: {
      category: input.category, results: Array.from({ length: input.limit! }, (_, index) => hit(index, "字".repeat(240))),
      nextCursor: `after-${input.limit}`, scanned: input.limit!, warnings: ["Attachments are not all indexed"]
    } }));
    const result = await tool(controller).execute({ query: "private", category: "life_links", cursor: "start", limit: 3 });
    expect(controller.agentSearchRecords.mock.calls.map(([input]) => [input.cursor, input.limit])).toEqual([["start", 3], ["start", 1]]);
    expect(result).toMatchObject({ ok: true, nextCursor: "after-1", scanned: 1, warnings: ["Attachments are not all indexed"] });
    expect(bytes(result)).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
  });

  it("fails explicitly if even one exact record cannot fit without truncating identity or content", async () => {
    const controller = new Controller();
    controller.agentSearchRecords.mockResolvedValue({ ok: true, page: { category: "life_links", results: [hit(0, "x".repeat(5000))], nextCursor: null, scanned: 1, warnings: [] } });
    expect(await tool(controller).execute({ query: "x", category: "life_links", limit: 1 })).toMatchObject({ ok: false, error: { code: "output_limit_exceeded" } });
    expect(controller.agentSearchRecords).toHaveBeenCalledTimes(1);
  });

  it("honors initial cancellation and canonical server refusal without leaking provider details", async () => {
    const controller = new Controller(); const abort = new AbortController(); abort.abort();
    expect(await tool(controller).execute({ query: "x", category: "calendar" }, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(controller.agentSearchRecords).not.toHaveBeenCalled();
    controller.agentSearchRecords.mockResolvedValueOnce({ ok: false, code: "search_catalog_not_granted" });
    expect(await tool(controller).execute({ query: "x", category: "calendar" })).toMatchObject({ ok: false, error: { code: "search_catalog_not_granted" } });
    controller.agentSearchRecords.mockRejectedValueOnce(new Error("private provider diagnostics"));
    expect(await tool(controller).execute({ query: "x", category: "calendar" })).toMatchObject({ ok: false, error: { code: "effect_not_applied" } });
  });
});
