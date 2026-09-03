import { expect, test, type Page, type Response } from "@playwright/test";
import { COMPETITION_OWNER_EMAIL, COMPETITION_SLEEPING_PAD_ID, COMPETITION_FIXTURE_PROFILE, MAX_LIFE_LINK_TOOL_OUTPUT_BYTES } from "@life-links/core";
import { closeAgentDialog, EXPECTED_AGENT_TOOLS, fieldLedgerAgentJourney, openAgentDialog } from "./support/fieldLedgerAgentJourney";
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

test.describe("installed Chrome native WebMCP host", () => {
  test("discovers and invokes all fourteen persisted Field Ledger tools without a host shim", async ({ page }) => {
    const documentResponse = await page.goto("/");
    assertWebMcpDocumentHeaders(documentResponse);
    const version = await page.request.get("/version");
    expect(await version.json()).toMatchObject({ competition_fixture_profile: COMPETITION_FIXTURE_PROFILE });
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
    expect(await nativeToolNames(page)).toEqual([]);
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await openAgentDialog(page);
    expect(await nativeHostShape(page)).toEqual({ modelContext: "object", registerTool: "function", getTools: "function", executeTool: "function" });
    const existingDisconnect = page.getByRole("button", { name: "Disable Browser WebMCP", exact: true });
    if (await existingDisconnect.isVisible()) {
      await existingDisconnect.click();
      await expect.poll(() => nativeToolNames(page)).toEqual([]);
    }
    await page.getByRole("button", { name: "Enable Browser WebMCP", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual(EXPECTED_AGENT_TOOLS);
    await expect(page.locator('[aria-labelledby="browser-webmcp-title"]').getByText("Enabled · active on this page.")).toBeVisible();
    await closeAgentDialog(page);
    await fieldLedgerAgentJourney(page, async (name, input) => {
      const response = await invokeNativeTool(page, name, input);
      expect(response.bytes).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
      return response.value;
    });
    await expect.poll(() => nativeToolNames(page)).toEqual(EXPECTED_AGENT_TOOLS);
    await openAgentDialog(page);
    const activity = page.locator(".agent-activity-panel");
    await expect(activity).not.toContainText("Planned upgrade priority");
    await expect(activity).not.toContainText(COMPETITION_SLEEPING_PAD_ID);

    let releaseSearch!: () => void;
    let searchStarted!: () => void;
    const released = new Promise<void>((resolve) => { releaseSearch = resolve; });
    const started = new Promise<void>((resolve) => { searchStarted = resolve; });
    const pattern = "**/api/life-links/search?**";
    await page.route(pattern, async (route) => {
      searchStarted();
      await released;
      await route.continue().catch(() => undefined);
    });
    const pending = invokeNativeTool(page, "search_my_life_links", { query: "camping", limit: 10 }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, message: error instanceof Error ? error.message : String(error) })
    );
    await started;
    await page.getByRole("button", { name: "Disable Browser WebMCP", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    releaseSearch();
    expect(await pending).toMatchObject({ status: "rejected", message: expect.stringContaining("UnknownError") });
    await page.unroute(pattern);
    await expect(page.getByText("No agent activity yet.")).toBeVisible();
    await page.getByRole("button", { name: "Enable Browser WebMCP", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual(EXPECTED_AGENT_TOOLS);
    await closeAgentDialog(page);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to Life Links" })).toBeVisible();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.locator(".ll-agent-status")).toHaveAttribute("aria-label", /Browser WebMCP: Enabled\./);
    await expect.poll(() => nativeToolNames(page)).toEqual(EXPECTED_AGENT_TOOLS);
    await openAgentDialog(page);
    await page.getByRole("button", { name: "Disable Browser WebMCP", exact: true }).click();
    await expect.poll(() => nativeToolNames(page)).toEqual([]);
    await closeAgentDialog(page);
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
