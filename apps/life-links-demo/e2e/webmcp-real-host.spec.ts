import { expect, test, type Page, type Response } from "@playwright/test";
import {
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_PREFERENCES_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
  COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_SLEEPING_PAD_QR_ID
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
const SOURCE_LIFE_LINK_IDS = [
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_FAMILY_PREFERENCES_ID,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_ID
];

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

    await expect(page.locator("#agent-access-title")).toHaveText("Agent Connection");
    expect(await nativeHostShape(page)).toEqual({
      modelContext: "object",
      registerTool: "function",
      getTools: "function",
      executeTool: "function"
    });
    const existingDisconnectButton = page.getByRole("button", {
      name: "Disconnect Agent",
      exact: true
    });
    if (await existingDisconnectButton.isVisible()) {
      await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);
      await existingDisconnectButton.click();
      await expect.poll(() => nativeToolNames(page)).toEqual([]);
    }

    await page.getByRole("button", { name: "Connect Agent", exact: true }).click();
    await expect(page.getByText("Connected until you disconnect. Life Links tools are available to your agent.")).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);

    const search = await invokeNativeTool(page, "search_my_life_links", {
      query: "Camping Sleeping Pad",
      limit: 10
    });
    expect(search.value).toMatchObject({
      ok: true,
      query: "Camping Sleeping Pad",
      visibleEffect: "search_results_highlighted"
    });
    expect(search.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    const searchResults = search.value.results as Array<{
      id: string;
      title: string;
      qrId: string | null;
      bodySummary: string;
      physicalLocator: {
        lifeLinkId: string;
        title: string;
        qrId: string;
        relation: "ancestor" | "self";
      } | null;
    }>;
    const padSearchResult = searchResults.find((result) => result.id === COMPETITION_SLEEPING_PAD_ID);
    expect(padSearchResult).toBeDefined();
    expect(padSearchResult).toMatchObject({
      id: COMPETITION_SLEEPING_PAD_ID,
      title: "Camping Sleeping Pad",
      qrId: COMPETITION_SLEEPING_PAD_QR_ID,
      physicalLocator: {
        lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
        qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
        relation: "ancestor"
      }
    });
    expect(padSearchResult!.bodySummary).toContain("Cold came through the ground");
    await expect(page.getByLabel("Search My Life Links")).toHaveValue("Camping Sleeping Pad");
    await expect(page.locator(`[data-life-link-search-id="${padSearchResult!.id}"]`)).toContainText("Camping Sleeping Pad");
    await expect(page.locator(`[data-life-link-search-id="${padSearchResult!.id}"]`)).toContainText(
      `Recorded QR locator: ${COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE}`
    );
    await expect(page.locator(`[data-life-link-search-id="${padSearchResult!.id}"]`)).toContainText(
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
    );

    const open = await invokeNativeTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID
    });
    expect(open.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
      title: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
      recordedPath: `${COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE} > ${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE}`,
      visibleEffect: "life_link_opened"
    });
    expect(open.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.locator(`[data-selected-life-link-id="${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID}"]`)).toBeVisible();
    await expect(
      page.locator(".life-link-owner-detail").getByRole("heading", { name: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE })
    ).toBeVisible();

    const inspect = await invokeNativeTool(page, "inspect_current_life_link", {});
    expect(inspect.value).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
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
      sourceLifeLinkIds: SOURCE_LIFE_LINK_IDS
    });
    expect(update.value).toMatchObject({
      ok: true,
      lifeLinkId: selectedLifeLink.id,
      updatedFields: ["body"],
      sourceLifeLinkIds: SOURCE_LIFE_LINK_IDS,
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
    expect(patchRequests[0].url).toContain(`/api/life-links/${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID}`);
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
    await expect(page.locator("#agent-access-title")).toHaveText("Agent Connection");
    await expect(page.getByRole("button", { name: "Disconnect Agent", exact: true })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);

    const persistedOpen = await invokeNativeTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID
    });
    expect(persistedOpen.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
      updatedAt
    });
    const persistedInspect = await invokeNativeTool(page, "inspect_current_life_link", {});
    expect(persistedInspect.value).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
        updatedAt,
        bodyTruncated: false
      }
    });
    expect((persistedInspect.value.lifeLink as { body: string }).body).toContain("Planned upgrade priority: sleeping pad.");
    expect((persistedInspect.value.lifeLink as { body: string }).body).toContain("stay within the $250 budget");

    const find = await invokeNativeTool(page, "start_find_mode", {
      lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID
    });
    expect(find.value).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
      qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    expect(find.bytes).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES);
    await expect(page.getByRole("heading", { name: "Search And Find" })).toBeVisible();
    await expect(page.locator(".find-target")).toContainText(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
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
    await page.getByRole("button", { name: "Disconnect Agent", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    releaseDelayedSearch?.();
    const revokedOutcome = await revokedInvocation;
    expect(revokedOutcome.status).toBe("rejected");
    expect(revokedOutcome).toMatchObject({ message: expect.stringContaining("UnknownError") });
    await page.unroute(delayedSearchPattern);
    await page.waitForTimeout(100);
    await expect(page.getByText("No agent activity yet.")).toBeVisible();

    await page.getByRole("button", { name: "Connect Agent", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);
    await page.locator(".sidebar-actions").getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);

    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("button", { name: "Disconnect Agent", exact: true })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual(CANONICAL_TOOL_NAMES);

    await page.getByRole("button", { name: "Disconnect Agent", exact: true }).click();
    await expect(page.getByRole("button", { name: "Connect Agent", exact: true })).toBeVisible();
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
