import { expect, test } from "@playwright/test";
import {
  COMPETITION_BASEMENT_GEAR_STORAGE_TITLE,
  COMPETITION_CYCLING_REPAIRS_TUB_ID, COMPETITION_CYCLING_REPAIRS_TUB_QR_ID, COMPETITION_CYCLING_REPAIRS_TUB_TITLE,
  COMPETITION_DECOY_QR_ID, COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_HIKING_WEATHER_TUB_ID, COMPETITION_HIKING_WEATHER_TUB_QR_ID, COMPETITION_HIKING_WEATHER_TUB_TITLE,
  COMPETITION_KITCHEN_WATER_TUB_ID, COMPETITION_KITCHEN_WATER_TUB_QR_ID, COMPETITION_KITCHEN_WATER_TUB_TITLE,
  COMPETITION_LIFE_LINK_IDS, COMPETITION_OWNER_EMAIL,
  COMPETITION_SAFETY_LIGHTING_TUB_ID, COMPETITION_SAFETY_LIGHTING_TUB_QR_ID, COMPETITION_SAFETY_LIGHTING_TUB_TITLE,
  COMPETITION_SHELTER_TUB_ID, COMPETITION_SHELTER_TUB_QR_ID, COMPETITION_SHELTER_TUB_TITLE,
  COMPETITION_SLEEPING_PAD_ID, COMPETITION_TARGET_QR_ID, COMPETITION_FIXTURE_PROFILE, MAX_LIFE_LINK_TOOL_OUTPUT_BYTES
} from "@life-links/core";
import { controlledHostSnapshot, installControlledWebMcpHost, invokeControlledTool } from "./support/controlledWebMcpHost";
import { requireHostedChallengeExpectedIdentity } from "./support/challengeExpectedIdentity";
import { closeAgentDialog, EXPECTED_AGENT_TOOLS, fieldLedgerAgentJourney, openAgentDialog } from "./support/fieldLedgerAgentJourney";
const LOCAL_COMPETITION_PASSWORD = "competition-test-password";
const LOCAL_CHALLENGE_BASE_URL = "http://127.0.0.1:43183";
const HOSTED_CHALLENGE_BASE_URL = process.env.LIFE_LINKS_CHALLENGE_BASE_URL?.trim();
const CHALLENGE_EMAIL = HOSTED_CHALLENGE_BASE_URL
  ? requireHostedCredential("LIFE_LINKS_CHALLENGE_EMAIL")
  : COMPETITION_OWNER_EMAIL;
const CHALLENGE_PASSWORD = HOSTED_CHALLENGE_BASE_URL
  ? requireHostedCredential("LIFE_LINKS_CHALLENGE_PASSWORD")
  : LOCAL_COMPETITION_PASSWORD;
const HOSTED_EXPECTED_RUNTIME_IDENTITY = HOSTED_CHALLENGE_BASE_URL
  ? {
      build_sha: requireHostedChallengeExpectedIdentity(
        "LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA",
        process.env.LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA,
        40
      ),
      canonical_source_sha: requireHostedChallengeExpectedIdentity(
        "LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA",
        process.env.LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA,
        40
      ),
      source_tree_sha256: requireHostedChallengeExpectedIdentity(
        "LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256",
        process.env.LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256,
        64
      )
    }
  : null;
const PACKING_LOCATOR_CASES = [
  {
    query: "Family Tent",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.familyTent,
    title: "Family Tent",
    locatorId: COMPETITION_SHELTER_TUB_ID,
    locatorTitle: COMPETITION_SHELTER_TUB_TITLE,
    qrId: COMPETITION_SHELTER_TUB_QR_ID
  },
  {
    query: "Adult One Sleep Bag",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.adultOneSleepSystem,
    title: "Adult One Sleep Bag",
    locatorId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
    locatorTitle: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
  },
  {
    query: "Adult Two Sleep Bag",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.adultTwoSleepSystem,
    title: "Adult Two Sleep Bag",
    locatorId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
    locatorTitle: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
  },
  {
    query: "Child One Sleeping Bag",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.childOneSleepingBag,
    title: "Child One Sleeping Bag",
    locatorId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
    locatorTitle: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
  },
  {
    query: "Child Two Sleeping Bag",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.childTwoSleepingBag,
    title: "Child Two Sleeping Bag",
    locatorId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
    locatorTitle: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
  },
  {
    query: "Two-Burner Camp Stove",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.twoBurnerStove,
    title: "Two-Burner Camp Stove",
    locatorId: COMPETITION_KITCHEN_WATER_TUB_ID,
    locatorTitle: COMPETITION_KITCHEN_WATER_TUB_TITLE,
    qrId: COMPETITION_KITCHEN_WATER_TUB_QR_ID
  },
  {
    query: "Family First Aid Kit",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.familyFirstAidKit,
    title: "Family First Aid Kit",
    locatorId: COMPETITION_SAFETY_LIGHTING_TUB_ID,
    locatorTitle: COMPETITION_SAFETY_LIGHTING_TUB_TITLE,
    qrId: COMPETITION_SAFETY_LIGHTING_TUB_QR_ID
  },
  {
    query: "Adult Rain Shells",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.adultRainShells,
    title: "Adult Rain Shells",
    locatorId: COMPETITION_HIKING_WEATHER_TUB_ID,
    locatorTitle: COMPETITION_HIKING_WEATHER_TUB_TITLE,
    qrId: COMPETITION_HIKING_WEATHER_TUB_QR_ID
  },
  {
    query: "Bike Repair Kit",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.bikeRepairKit,
    title: "Bike Repair Kit",
    locatorId: COMPETITION_CYCLING_REPAIRS_TUB_ID,
    locatorTitle: COMPETITION_CYCLING_REPAIRS_TUB_TITLE,
    qrId: COMPETITION_CYCLING_REPAIRS_TUB_QR_ID
  }
] as const;


test.describe("competition physical-context loop", () => {
  test("packs, persists the Field Ledger fourteen-tool journey, and finds the right tub", async ({ baseURL, browser, page }) => {
    const journeyStartedAt = Date.now();
    const challengeBaseURL = requireChallengeBaseURL(baseURL, HOSTED_CHALLENGE_BASE_URL);
    const publicConfig = await page.request.get("/api/config");
    expect(await publicConfig.json()).toMatchObject({ qrBaseUrl: challengeBaseURL });
    const versionResponse = await page.request.get("/version");
    expect(versionResponse.ok()).toBe(true);
    expect(await versionResponse.json()).toMatchObject({
      competition_fixture_profile: COMPETITION_FIXTURE_PROFILE,
      ...(HOSTED_EXPECTED_RUNTIME_IDENTITY ? { env: "webmcp-challenge", store_mode: "postgres", ...HOSTED_EXPECTED_RUNTIME_IDENTITY } : {})
    });
    await installControlledWebMcpHost(page);
    await page.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
    const publicState = await (await page.request.get(`/api/qr/${COMPETITION_TARGET_QR_ID}`)).json();
    expect(publicState).toMatchObject({ state: "claimed", viewerIsOwner: false, link: { id: COMPETITION_TARGET_QR_ID, ownerId: null, body: "", title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE } });
    assertNoHierarchyDisclosure(publicState);
    await assertPublicQrHasNoHierarchy(page, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
    await expect(page.locator(".public-content")).toContainText("two adults and two children");
    await expect(page.locator(".public-content")).not.toContainText("cold through the ground");
    expect((await controlledHostSnapshot(page)).activeNames).toEqual([]);
    await page.goto(`/qr/${COMPETITION_DECOY_QR_ID}`);
    await expect(page.getByRole("heading", { name: "Private context protected" })).toBeVisible();
    await expect(page.locator(".public-content")).toHaveCount(0);
    await page.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
    await page.getByLabel("Email").fill(CHALLENGE_EMAIL);
    await page.getByLabel("Password").fill(CHALLENGE_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const open = page.getByRole("button", { name: "Open in My Life Links" });
    await expect(open).toBeVisible();
    await open.focus();
    await open.press("Enter");
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID}`);
    await expect(page.locator(".ll-title-row h1")).toHaveText(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
    await expect(page.locator(".ll-title-row h1")).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Current layer" }).getByRole("button")).toHaveText([
      "My Life Links", "Basement", "Storage wall", COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
    ]);
    const geometry = await page.locator(".ll-middle").evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
    await openAgentDialog(page);
    const disconnect = page.getByRole("button", { name: "Disconnect Agent", exact: true });
    if (await disconnect.isVisible()) {
      await disconnect.click();
      await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    }
    const registrationsBefore = (await controlledHostSnapshot(page)).registrationNames.length;
    await page.getByRole("button", { name: "Connect Agent", exact: true }).click();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(EXPECTED_AGENT_TOOLS);
    expect((await controlledHostSnapshot(page)).registrationNames.slice(registrationsBefore).sort()).toEqual(EXPECTED_AGENT_TOOLS);
    await closeAgentDialog(page);
    for (const packingCase of PACKING_LOCATOR_CASES) {
      const search = await invokeControlledTool(page, "search_my_life_links", { query: packingCase.query, limit: 10 });
      expect(Buffer.byteLength(JSON.stringify(search))).toBeLessThanOrEqual(MAX_LIFE_LINK_TOOL_OUTPUT_BYTES);
      expect(readSearchResult(search, packingCase.lifeLinkId)).toMatchObject({
        id: packingCase.lifeLinkId, title: packingCase.title,
        physicalLocator: { lifeLinkId: packingCase.locatorId, title: packingCase.locatorTitle, qrId: packingCase.qrId, relation: "ancestor" }
      });
      const row = page.locator(".ll-search-open").filter({ has: page.getByText(packingCase.title, { exact: true }) });
      await expect(row).toContainText(`QR locator: ${packingCase.locatorTitle}`);
      await expect(row).toContainText(packingCase.qrId);
    }
    await fieldLedgerAgentJourney(page, (name, input) => invokeControlledTool(page, name, input));
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(EXPECTED_AGENT_TOOLS);
    expect((await controlledHostSnapshot(page)).registrationNames.sort()).toEqual(EXPECTED_AGENT_TOOLS);
    await page.getByLabel("Scanned QR", { exact: true }).fill(COMPETITION_DECOY_QR_ID);
    await page.getByRole("button", { name: "Check QR", exact: true }).click();
    await expect(page.locator(".ll-scan-screen [role=status]")).toContainText("Not the selected item");
    await page.getByLabel("Scanned QR", { exact: true }).fill(COMPETITION_TARGET_QR_ID);
    await page.getByRole("button", { name: "Check QR", exact: true }).click();
    await expect(page.locator(".ll-scan-screen [role=status]")).toContainText("Match found");
    await openAgentDialog(page);
    await page.getByRole("button", { name: "Disconnect Agent", exact: true }).click();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    expect((await controlledHostSnapshot(page)).abortedNames.sort()).toEqual(EXPECTED_AGENT_TOOLS);
    await expect(invokeControlledTool(page, "inspect_current_life_link", {})).rejects.toThrow("Tool inspect_current_life_link is not active.");
    await closeAgentDialog(page);
    const anonymous = await browser.newContext({ baseURL: challengeBaseURL });
    try {
      const response = await anonymous.request.get(`/api/qr/${COMPETITION_TARGET_QR_ID}`);
      const projection = await response.json();
      assertNoHierarchyDisclosure(projection);
      for (const privateValue of [COMPETITION_SLEEPING_PAD_ID, "Storage wall", "Camping Gear", "$250", "Planned upgrade priority", "cold through the ground"]) expect(JSON.stringify(projection)).not.toContain(privateValue);
      const guest = await anonymous.newPage();
      await guest.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
      await assertPublicQrHasNoHierarchy(guest, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
      await expect(guest.locator(".public-content")).toContainText("two adults and two children");
    } finally { await anonymous.close(); }
    expect(Date.now() - journeyStartedAt).toBeLessThan(90_000);
  });
});
function requireChallengeBaseURL(baseURL: string | undefined, hostedBaseURL: string | undefined): string {
  if (!baseURL) {
    throw new Error("The challenge E2E requires a configured base URL.");
  }
  const parsed = new URL(baseURL);
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname === "lifelinks-vmdemo.com" || hostname.endsWith(".lifelinks-vmdemo.com")) {
    throw new Error("The challenge E2E must not run against the frozen lifelinks-vmdemo host.");
  }
  if (hostedBaseURL) {
    const hostedOrigin = new URL(hostedBaseURL).origin;
    if (parsed.protocol !== "https:" || parsed.origin !== hostedOrigin || baseURL !== hostedOrigin) {
      throw new Error("The hosted challenge E2E requires the exact configured HTTPS origin.");
    }
    return hostedOrigin;
  }
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.port !== "43183" ||
    parsed.origin !== baseURL ||
    parsed.origin !== LOCAL_CHALLENGE_BASE_URL
  ) {
    throw new Error("The challenge E2E requires its dedicated fresh local server on 127.0.0.1:43183.");
  }
  return parsed.origin;
}

function requireHostedCredential(name: "LIFE_LINKS_CHALLENGE_EMAIL" | "LIFE_LINKS_CHALLENGE_PASSWORD"): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required for hosted challenge E2E.`);
  }
  return name === "LIFE_LINKS_CHALLENGE_EMAIL" ? value.trim() : value;
}

function assertNoHierarchyDisclosure(value: unknown): void {
  const forbiddenKeys = new Set([
    "lifeLinkId",
    "parentId",
    "ancestry",
    "children",
    "path",
    "hierarchy",
    "rootId",
    "descendants"
  ]);
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      expect(forbiddenKeys.has(key), `public QR payload disclosed canonical hierarchy field ${key}`).toBe(false);
      visit(nested);
    }
  };
  visit(value);
}

async function assertPublicQrHasNoHierarchy(page: import("@playwright/test").Page, title: string): Promise<void> {
  await expect(page.locator(".public-content").getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(".life-link-breadcrumbs")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Agent Connection" })).toHaveCount(0);
  for (const ancestorTitle of [COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE, COMPETITION_BASEMENT_GEAR_STORAGE_TITLE]) {
    await expect(page.getByText(ancestorTitle, { exact: true })).toHaveCount(0);
  }
}

function readSearchResult(result: Record<string, unknown>, lifeLinkId: string): Record<string, unknown> {
  const results = result.results as Array<Record<string, unknown>> | undefined;
  const match = results?.find((item) => item.id === lifeLinkId);
  expect(match, `search output omitted expected Life Link ${lifeLinkId}`).toBeDefined();
  return match!;
}
