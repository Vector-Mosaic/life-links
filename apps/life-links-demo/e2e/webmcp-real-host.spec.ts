import { expect, test, type Page, type Response } from "@playwright/test";

import { LIFE_LINKS_PAGE_TOOL_NAMES } from "../src/agent/browserWebMcpHost";

const CANONICAL_TOOL_NAMES = [...LIFE_LINKS_PAGE_TOOL_NAMES].sort();
const DEFAULT_LOCAL_PORT = "43182";
const LOCAL_PORT = process.env.LIFE_LINKS_WEBMCP_REAL_PORT?.trim() || DEFAULT_LOCAL_PORT;
const EXPLICIT_BASE_URL = process.env.LIFE_LINKS_WEBMCP_REAL_BASE_URL?.trim();
const TARGET_URL = new URL(EXPLICIT_BASE_URL || `http://127.0.0.1:${LOCAL_PORT}`);
const LOCAL_TARGET = TARGET_URL.hostname === "127.0.0.1" || TARGET_URL.hostname === "localhost";
if (TARGET_URL.hostname === "lifelinks-vmdemo.com") {
  throw new Error("The native WebMCP acceptance target must not use the frozen life-links-vmdemo lane.");
}
const DEMO_EMAIL = process.env.LIFE_LINKS_WEBMCP_REAL_EMAIL ?? (LOCAL_TARGET ? "owner@life-links.test" : "");
const DEMO_PASSWORD = process.env.LIFE_LINKS_WEBMCP_REAL_PASSWORD ?? (LOCAL_TARGET ? "local-demo-password-not-for-deployment" : "");
if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error("A non-local native WebMCP target requires explicit LIFE_LINKS_WEBMCP_REAL_EMAIL and LIFE_LINKS_WEBMCP_REAL_PASSWORD.");
}
const MAX_TOOL_OUTPUT_BYTES = 1536;

test.describe("installed Chrome native WebMCP host", () => {
  test("discovers and invokes the five production tools without a host shim", async ({ page }) => {
    const patchRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") {
        patchRequests.push(request.url());
      }
    });

    const documentResponse = await page.goto("/");
    assertWebMcpDocumentHeaders(documentResponse);
    await expect(page.getByRole("heading", { name: "Demo Login" })).toBeVisible();
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("heading", { name: "Agent Access" })).toBeVisible();
    expect(await nativeHostShape(page)).toEqual({
      modelContext: "object",
      registerTool: "function",
      getTools: "function",
      executeTool: "function"
    });
    await expect.poll(() => nativeToolNames(page)).toEqual([]);

    const accessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await accessToggle.check();
    await expect(page.getByText("Five Life Links page tools are available to the agent in this live page.")).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);

    const search = await invokeNativeTool(page, "search_my_life_links", {
      query: "camera",
      limit: 10
    });
    expect(search.value).toMatchObject({
      ok: true,
      query: "camera",
      resultCount: 1,
      visibleEffect: "search_results_highlighted"
    });
    expect(search.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const searchResults = search.value.results as Array<{ id: string; title: string; qrId: string | null }>;
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({ title: "Camera battery kit", qrId: "LL-DEMO-00002" });
    await expect(page.getByLabel("Search My Life Links")).toHaveValue("camera");
    await expect(page.locator(`[data-life-link-search-id="${searchResults[0].id}"]`)).toContainText("Camera battery kit");

    const open = await invokeNativeTool(page, "open_life_link", {
      lifeLinkId: searchResults[0].id
    });
    expect(open.value).toMatchObject({
      ok: true,
      lifeLinkId: searchResults[0].id,
      title: "Camera battery kit",
      visibleEffect: "life_link_opened"
    });
    expect(open.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.locator(`[data-selected-life-link-id="${searchResults[0].id}"]`)).toBeVisible();
    await expect(page.locator(".life-link-owner-detail").getByRole("heading", { name: "Camera battery kit" })).toBeVisible();

    const inspect = await invokeNativeTool(page, "inspect_current_life_link", {});
    expect(inspect.value).toMatchObject({
      ok: true,
      lifeLink: {
        id: searchResults[0].id,
        qrId: "LL-DEMO-00002"
      },
      visibleEffect: "current_life_link_focused"
    });
    expect(inspect.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.getByText("Inspected the selected Life Link")).toBeVisible();

    const selectedLifeLink = inspect.value.lifeLink as { id: string; updatedAt: string };
    const proposedTitle = "Camera battery kit — native host review";
    const proposedBody = "Confirm both batteries are charged before leaving.";
    const draft = await invokeNativeTool(page, "draft_life_link_update", {
      lifeLinkId: selectedLifeLink.id,
      baseUpdatedAt: selectedLifeLink.updatedAt,
      title: proposedTitle,
      body: proposedBody,
      sourceLifeLinkIds: ["project-studio"]
    });
    expect(draft.value).toMatchObject({
      ok: true,
      lifeLinkId: selectedLifeLink.id,
      saved: false,
      privacyChanged: false,
      visibleEffect: "agent_draft_opened"
    });
    expect(draft.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const editor = page.getByRole("dialog");
    await expect(editor.getByText("Agent draft — not saved", { exact: true })).toBeVisible();
    await expect(editor.locator(".agent-draft-review")).toContainText(proposedTitle);
    await expect(editor.locator(".agent-draft-review")).toContainText(proposedBody);
    await expect(editor.getByLabel("Title")).toHaveValue("Camera battery kit");
    await expect(editor.locator(".rich-body-editor-surface")).not.toContainText(proposedBody);
    await page.waitForTimeout(250);
    expect(patchRequests).toEqual([]);

    await editor.getByRole("button", { name: "Apply proposal" }).click();
    await expect(editor.getByLabel("Title")).toHaveValue(proposedTitle);
    await expect(editor.locator(".rich-body-editor-surface")).toContainText(proposedBody);
    await expect(editor.getByText("Applied to the editor, but still not saved.")).toBeVisible();
    await page.waitForTimeout(250);
    expect(patchRequests).toEqual([]);

    await editor.getByRole("button", { name: "Close editor" }).click();
    const find = await invokeNativeTool(page, "start_find_mode", {
      lifeLinkId: selectedLifeLink.id
    });
    expect(find.value).toMatchObject({
      ok: true,
      lifeLinkId: selectedLifeLink.id,
      qrId: "LL-DEMO-00002",
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    expect(find.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.getByRole("heading", { name: "Search And Find" })).toBeVisible();
    await expect(page.locator(".find-target")).toContainText("Camera battery kit");

    const activity = page.locator(".agent-activity-panel");
    await expect(activity.locator(".agent-activity-item")).toHaveCount(5);
    await expect(activity).not.toContainText(proposedBody);
    await expect(activity).not.toContainText(selectedLifeLink.id);
    expect(patchRequests).toEqual([]);

    let releaseDelayedSearch: (() => void) | undefined;
    let markDelayedSearchStarted: (() => void) | undefined;
    const delayedSearchRelease = new Promise<void>((resolve) => {
      releaseDelayedSearch = resolve;
    });
    const delayedSearchStarted = new Promise<void>((resolve) => {
      markDelayedSearchStarted = resolve;
    });
    const delayedSearchPattern = "**/api/life-links/search?**";
    await page.route(delayedSearchPattern, async (route) => {
      markDelayedSearchStarted?.();
      await delayedSearchRelease;
      await route.continue().catch(() => undefined);
    });
    const revokedInvocation = invokeNativeTool(page, "search_my_life_links", {
      query: "router",
      limit: 10
    }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({
        status: "rejected" as const,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    await delayedSearchStarted;
    await accessToggle.uncheck();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    releaseDelayedSearch?.();
    const revokedOutcome = await revokedInvocation;
    expect(revokedOutcome.status).toBe("rejected");
    expect(revokedOutcome).toMatchObject({ message: expect.stringContaining("UnknownError") });
    await page.unroute(delayedSearchPattern);
    await page.waitForTimeout(100);
    await expect(page.getByText("No agent tool activity in this page session.")).toBeVisible();

    await accessToggle.check();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);
    await page.locator(".sidebar-actions").getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("heading", { name: "Demo Login" })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    expect(patchRequests).toEqual([]);
  });
});

type NativeInvocation = {
  value: Record<string, unknown>;
  bytes: number;
};

async function nativeHostShape(page: Page) {
  return page.evaluate(() => {
    const modelContext = (document as Document & { modelContext?: Record<string, unknown> }).modelContext;
    return {
      modelContext: typeof modelContext,
      registerTool: typeof modelContext?.registerTool,
      getTools: typeof modelContext?.getTools,
      executeTool: typeof modelContext?.executeTool
    };
  });
}

async function nativeToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const modelContext = (document as Document & { modelContext?: NativeModelContext }).modelContext;
    if (!modelContext) {
      throw new Error("Chrome did not expose document.modelContext.");
    }
    const tools = await modelContext.getTools();
    return tools.map((tool) => tool.name).sort();
  });
}

async function invokeNativeTool(page: Page, name: string, input: Record<string, unknown>): Promise<NativeInvocation> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const modelContext = (document as Document & { modelContext?: NativeModelContext }).modelContext;
      if (!modelContext) {
        throw new Error("Chrome did not expose document.modelContext.");
      }
      const tools = await modelContext.getTools();
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) {
        throw new Error(`Native WebMCP tool ${toolName} is not registered.`);
      }
      const output = await modelContext.executeTool(tool, JSON.stringify(toolInput));
      if (typeof output !== "string") {
        throw new Error(`Native WebMCP tool ${toolName} returned no JSON output.`);
      }
      return {
        value: JSON.parse(output) as Record<string, unknown>,
        bytes: new TextEncoder().encode(output).byteLength
      };
    },
    { toolName: name, toolInput: input }
  );
}

function assertWebMcpDocumentHeaders(response: Response | null) {
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["permissions-policy"]).toBe("camera=(self), microphone=(), geolocation=(), tools=(self)");
  expect(headers["origin-agent-cluster"]).toBe("?1");
}

type NativeTool = { readonly name: string };

type NativeModelContext = {
  getTools(): Promise<NativeTool[]>;
  executeTool(tool: NativeTool, input: string): Promise<string | null>;
};
