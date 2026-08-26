import { expect, test, type Page, type Response } from "@playwright/test";
import {
  COMPETITION_DECOY_QR_ID,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_TARGET_QR_ID,
  COMPETITION_UPGRADE_PLAN_ID,
  COMPETITION_UPGRADE_PREFERENCES_ID
} from "@life-links/core";

const CANONICAL_TOOL_NAMES = [
  "inspect_current_life_link",
  "search_my_life_links",
  "open_life_link",
  "update_life_link_content",
  "start_find_mode"
].sort();
const DEFAULT_LOCAL_PORT = "43182";
const LOCAL_PORT = process.env.LIFE_LINKS_WEBMCP_REAL_PORT?.trim() || DEFAULT_LOCAL_PORT;
const EXPLICIT_BASE_URL = process.env.LIFE_LINKS_WEBMCP_REAL_BASE_URL?.trim();
const TARGET_URL = new URL(EXPLICIT_BASE_URL || `http://127.0.0.1:${LOCAL_PORT}`);
const LOCAL_TARGET = TARGET_URL.hostname === "127.0.0.1" || TARGET_URL.hostname === "localhost";
const TARGET_HOSTNAME = TARGET_URL.hostname.toLowerCase().replace(/\.+$/, "");
if (TARGET_HOSTNAME === "lifelinks-vmdemo.com" || TARGET_HOSTNAME.endsWith(".lifelinks-vmdemo.com")) {
  throw new Error("The native WebMCP acceptance target must not use the frozen life-links-vmdemo lane.");
}
const DEMO_EMAIL = process.env.LIFE_LINKS_WEBMCP_REAL_EMAIL ?? (LOCAL_TARGET ? COMPETITION_OWNER_EMAIL : "");
const DEMO_PASSWORD = process.env.LIFE_LINKS_WEBMCP_REAL_PASSWORD ?? (LOCAL_TARGET ? "competition-test-password" : "");
if (!DEMO_EMAIL || !DEMO_PASSWORD) {
  throw new Error("A non-local native WebMCP target requires explicit LIFE_LINKS_WEBMCP_REAL_EMAIL and LIFE_LINKS_WEBMCP_REAL_PASSWORD.");
}
const MAX_TOOL_OUTPUT_BYTES = 1536;

test.describe("installed Chrome native WebMCP host", () => {
  test("discovers and invokes the five physical-context tools without a host shim", async ({ page }) => {
    const patchRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") {
        patchRequests.push({
          url: request.url(),
          body: request.postDataJSON() as Record<string, unknown>
        });
      }
    });

    const documentResponse = await page.goto("/");
    assertWebMcpDocumentHeaders(documentResponse);
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
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
      query: "Camping Sleeping Pad",
      limit: 10
    });
    expect(search.value).toMatchObject({
      ok: true,
      query: "Camping Sleeping Pad",
      resultCount: 1,
      visibleEffect: "search_results_highlighted"
    });
    expect(search.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const searchResults = search.value.results as Array<{
      id: string;
      title: string;
      qrId: string | null;
      bodySummary: string;
    }>;
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      id: COMPETITION_SLEEPING_PAD_ID,
      title: "Camping Sleeping Pad",
      qrId: COMPETITION_DECOY_QR_ID
    });
    expect(searchResults[0].bodySummary).toContain("Cold came through the ground");
    await expect(page.getByLabel("Search My Life Links")).toHaveValue("Camping Sleeping Pad");
    await expect(page.locator(`[data-life-link-search-id="${searchResults[0].id}"]`)).toContainText("Camping Sleeping Pad");

    const open = await invokeNativeTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID
    });
    expect(open.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID,
      title: "Camping Upgrade Plan",
      recordedPath: "Camping Kit > Camping Upgrade Plan",
      visibleEffect: "life_link_opened"
    });
    expect(open.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.locator(`[data-selected-life-link-id="${COMPETITION_UPGRADE_PLAN_ID}"]`)).toBeVisible();
    await expect(page.locator(".life-link-owner-detail").getByRole("heading", { name: "Camping Upgrade Plan" })).toBeVisible();

    const inspect = await invokeNativeTool(page, "inspect_current_life_link", {});
    expect(inspect.value).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_UPGRADE_PLAN_ID,
        qrId: null,
        body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
        bodyTruncated: false
      },
      visibleEffect: "current_life_link_focused"
    });
    expect(inspect.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.getByText("Inspected the selected Life Link")).toBeVisible();

    const selectedLifeLink = inspect.value.lifeLink as { id: string; updatedAt: string };
    const update = await invokeNativeTool(page, "update_life_link_content", {
      lifeLinkId: selectedLifeLink.id,
      baseUpdatedAt: selectedLifeLink.updatedAt,
      body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
      sourceLifeLinkIds: [
        COMPETITION_SLEEPING_BAG_ID,
        COMPETITION_SLEEPING_PAD_ID,
        COMPETITION_UPGRADE_PREFERENCES_ID
      ]
    });
    expect(update.value).toMatchObject({
      ok: true,
      lifeLinkId: selectedLifeLink.id,
      updatedFields: ["body"],
      sourceLifeLinkIds: [
        COMPETITION_SLEEPING_BAG_ID,
        COMPETITION_SLEEPING_PAD_ID,
        COMPETITION_UPGRADE_PREFERENCES_ID
      ],
      saved: true,
      privacyChanged: false,
      visibleEffect: "life_link_content_updated"
    });
    expect(update.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const updatedAt = update.value.updatedAt as string;
    expect(Date.parse(updatedAt)).not.toBeNaN();
    expect(updatedAt).not.toBe(selectedLifeLink.updatedAt);
    await expect(page.locator(".life-link-owner-detail")).toContainText("Planned upgrade priority: sleeping pad.");
    await expect(page.locator(".life-link-owner-detail")).toContainText("stay within the $250 budget");
    expect(patchRequests).toHaveLength(1);
    expect(patchRequests[0].url).toContain(`/api/life-links/${COMPETITION_UPGRADE_PLAN_ID}`);
    expect(patchRequests[0].body).toEqual({
      body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
      expectedUpdatedAt: selectedLifeLink.updatedAt
    });

    const staleReplay = await invokeNativeTool(page, "update_life_link_content", {
      lifeLinkId: selectedLifeLink.id,
      baseUpdatedAt: selectedLifeLink.updatedAt,
      body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY
    });
    expect(staleReplay.value).toMatchObject({
      ok: false,
      error: {
        code: "stale_life_link",
        retryable: true
      }
    });
    expect(staleReplay.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    expect(patchRequests).toHaveLength(1);

    const activity = page.locator(".agent-activity-panel");
    await expect(activity).toContainText("Updated Life Link content");
    await expect(activity).not.toContainText("Planned upgrade priority");
    await expect(activity).not.toContainText(selectedLifeLink.id);

    const reloadResponse = await page.reload();
    assertWebMcpDocumentHeaders(reloadResponse);
    await expect(page.getByRole("heading", { name: "Agent Access" })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    await accessToggle.check();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);

    const persistedOpen = await invokeNativeTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID
    });
    expect(persistedOpen.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID,
      updatedAt
    });
    const persistedInspect = await invokeNativeTool(page, "inspect_current_life_link", {});
    expect(persistedInspect.value).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_UPGRADE_PLAN_ID,
        updatedAt,
        bodyTruncated: false
      }
    });
    expect((persistedInspect.value.lifeLink as { body: string }).body).toContain("Planned upgrade priority: sleeping pad.");
    expect((persistedInspect.value.lifeLink as { body: string }).body).toContain("stay within the $250 budget");

    const find = await invokeNativeTool(page, "start_find_mode", {
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID
    });
    expect(find.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
      qrId: COMPETITION_TARGET_QR_ID,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    expect(find.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.getByRole("heading", { name: "Search And Find" })).toBeVisible();
    await expect(page.locator(".find-target")).toContainText("Camping Sleeping Bag");
    expect(patchRequests).toHaveLength(1);

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
      query: "camping",
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
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    expect(patchRequests).toHaveLength(1);
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
