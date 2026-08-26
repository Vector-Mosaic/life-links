import { expect, test } from "@playwright/test";
import {
  COMPETITION_CAMPING_KIT_ID,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_SLEEP_SYSTEM_ID,
  COMPETITION_TARGET_QR_ID,
  COMPETITION_UPGRADE_PLAN_ID,
  COMPETITION_UPGRADE_PREFERENCES_ID
} from "@life-links/core";

import { LIFE_LINKS_PAGE_TOOL_NAMES } from "../src/agent/browserWebMcpHost";
import {
  controlledHostSnapshot,
  installControlledWebMcpHost,
  invokeControlledTool
} from "./support/controlledWebMcpHost";
import { requireHostedChallengeExpectedIdentity } from "./support/challengeExpectedIdentity";

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
const CANONICAL_TOOL_NAMES = [...LIFE_LINKS_PAGE_TOOL_NAMES].sort();
const TARGET_PATH = ["Camping Kit", "Camping Sleep System", "Camping Sleeping Bag"];
const SOURCE_LIFE_LINK_IDS = [
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_UPGRADE_PREFERENCES_ID
];

test.describe("competition physical-context loop", () => {
  test("uses bounded physical context to persist one grounded camping upgrade and find the right item", async ({
    baseURL,
    browser,
    page
  }) => {
    const journeyStartedAt = Date.now();
    const challengeBaseURL = requireChallengeBaseURL(baseURL, HOSTED_CHALLENGE_BASE_URL);
    const expectedQrBaseUrl = HOSTED_CHALLENGE_BASE_URL
      ? new URL(HOSTED_CHALLENGE_BASE_URL).origin
      : LOCAL_CHALLENGE_BASE_URL;
    expect(challengeBaseURL).toBe(expectedQrBaseUrl);

    const publicConfigResponse = await page.context().request.get("/api/config");
    expect(publicConfigResponse.ok()).toBe(true);
    expect(await publicConfigResponse.json()).toMatchObject({ qrBaseUrl: expectedQrBaseUrl });
    if (HOSTED_EXPECTED_RUNTIME_IDENTITY) {
      const versionResponse = await page.context().request.get("/version");
      expect(versionResponse.ok()).toBe(true);
      const version = (await versionResponse.json()) as Record<string, unknown>;
      expect({
        env: version.env,
        store_mode: version.store_mode,
        build_sha: version.build_sha,
        canonical_source_sha: version.canonical_source_sha,
        source_tree_sha256: version.source_tree_sha256
      }).toEqual({
        env: "webmcp-challenge",
        store_mode: "postgres",
        ...HOSTED_EXPECTED_RUNTIME_IDENTITY
      });
    }

    const patchRequests: Array<{ url: string; body: unknown }> = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH") {
        patchRequests.push({
          url: request.url(),
          body: request.postDataJSON()
        });
      }
    });

    await installControlledWebMcpHost(page);
    await page.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);

    const initialPublicResponse = await page.context().request.get(`/api/qr/${COMPETITION_TARGET_QR_ID}`);
    expect(initialPublicResponse.ok()).toBe(true);
    const initialPublicState = await initialPublicResponse.json();
    expect(initialPublicState).toMatchObject({
      state: "claimed",
      link: {
        id: COMPETITION_TARGET_QR_ID,
        ownerId: null,
        projectId: null,
        title: "Camping Sleeping Bag"
      },
      viewerIsOwner: false
    });
    assertNoHierarchyDisclosure(initialPublicState);
    await assertPublicQrHasNoHierarchy(page, "Camping Sleeping Bag");
    await expect(page.locator(".public-content")).toContainText("kept me warm around 35°F");

    await page.getByLabel("Email").fill(CHALLENGE_EMAIL);
    await page.getByLabel("Password").fill(CHALLENGE_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const openInWorkspace = page.getByRole("button", { name: "Open in My Life Links" });
    await expect(openInWorkspace).toBeVisible();
    await expect(page).toHaveURL(`${challengeBaseURL}/qr/${COMPETITION_TARGET_QR_ID}`);
    await openInWorkspace.click();

    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_SLEEPING_BAG_ID}`);
    await expect(page.locator(`[data-selected-life-link-id="${COMPETITION_SLEEPING_BAG_ID}"]`)).toBeVisible();
    const breadcrumbs = page.getByRole("navigation", { name: "Life Link path" });
    await expect(breadcrumbs.locator(":scope > .life-link-breadcrumb-item > button")).toHaveText(TARGET_PATH);
    await expect(breadcrumbs.locator(".life-link-breadcrumb-ellipsis")).toHaveCount(0);
    const breadcrumbViewport = await breadcrumbs.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(breadcrumbViewport.scrollWidth).toBeLessThanOrEqual(breadcrumbViewport.clientWidth + 1);
    const hierarchyViewport = await page.locator(".life-link-tree").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(hierarchyViewport.scrollWidth).toBeLessThanOrEqual(hierarchyViewport.clientWidth + 1);

    const accessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await expect(accessToggle).not.toBeChecked();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    await accessToggle.check();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    const registeredCatalog = await controlledHostSnapshot(page);
    expect(registeredCatalog.registrationNames).toHaveLength(5);
    expect([...registeredCatalog.registrationNames].sort()).toEqual(CANONICAL_TOOL_NAMES);

    const bagInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(bagInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_SLEEPING_BAG_ID,
        qrId: COMPETITION_TARGET_QR_ID,
        path: TARGET_PATH.map((title) => ({ title })),
        bodyTruncated: false
      },
      visibleEffect: "current_life_link_focused",
      truncated: false
    });
    expect(readInspectedBody(bagInspection)).toContain("kept me warm around 35°F");
    expect(readInspectedBody(bagInspection)).toContain("does not want to replace gear that works");

    const padSearch = await invokeControlledTool(page, "search_my_life_links", {
      query: "Camping Sleeping Pad",
      limit: 10
    });
    expect(padSearch).toMatchObject({
      ok: true,
      query: "Camping Sleeping Pad",
      resultCount: 1,
      totalCount: 1,
      results: [
        {
          id: COMPETITION_SLEEPING_PAD_ID,
          title: "Camping Sleeping Pad",
          qrId: COMPETITION_DECOY_QR_ID,
          recordedPath: "Camping Kit > Camping Sleep System > Camping Sleeping Pad",
          matchClass: "exact_title"
        }
      ],
      visibleEffect: "search_results_highlighted",
      truncated: false
    });
    const padSummary = readOnlySearchBodySummary(padSearch);
    expect(padSummary).toContain("Cold came through the ground");
    expect(padSummary).toContain("low-R sleeping pad");

    const preferenceSearch = await invokeControlledTool(page, "search_my_life_links", {
      query: "warmth",
      limit: 10
    });
    expect(preferenceSearch).toMatchObject({
      ok: true,
      query: "warmth",
      resultCount: 1,
      totalCount: 1,
      results: [
        {
          id: COMPETITION_UPGRADE_PREFERENCES_ID,
          title: "Camping Upgrade Preferences",
          recordedPath: "Camping Kit > Camping Upgrade Preferences",
          matchClass: "body"
        }
      ],
      visibleEffect: "search_results_highlighted",
      truncated: false
    });
    const preferenceSummary = readOnlySearchBodySummary(preferenceSearch);
    expect(preferenceSummary).toContain("warmth matters more than minimum weight");
    expect(preferenceSummary).toContain("$250");

    const openPlanResult = await invokeControlledTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID
    });
    expect(openPlanResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID,
      title: "Camping Upgrade Plan",
      recordedPath: "Camping Kit > Camping Upgrade Plan",
      visibleEffect: "life_link_opened"
    });
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_UPGRADE_PLAN_ID}`);

    const planInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(planInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_UPGRADE_PLAN_ID,
        body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
        bodyTruncated: false
      },
      visibleEffect: "current_life_link_focused"
    });
    const baseUpdatedAt = readInspectedUpdatedAt(planInspection);
    expect(baseUpdatedAt).toBe((openPlanResult as { updatedAt: string }).updatedAt);

    expect(patchRequests).toEqual([]);
    const updateResult = await invokeControlledTool(page, "update_life_link_content", {
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID,
      baseUpdatedAt,
      body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
      sourceLifeLinkIds: SOURCE_LIFE_LINK_IDS
    });
    expect(updateResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_UPGRADE_PLAN_ID,
      updatedFields: ["body"],
      sourceLifeLinkIds: SOURCE_LIFE_LINK_IDS,
      sourceIdsTruncated: false,
      sourceIdsOmittedCount: 0,
      saved: true,
      privacyChanged: false,
      visibleEffect: "life_link_content_updated",
      truncated: false
    });
    expect((updateResult as { updatedAt: string }).updatedAt).not.toBe(baseUpdatedAt);
    const canonicalPatchPath = `/api/life-links/${COMPETITION_UPGRADE_PLAN_ID}`;
    expect(patchRequests).toHaveLength(1);
    expect(new URL(patchRequests[0].url).pathname).toBe(canonicalPatchPath);
    expect(patchRequests[0].body).toEqual({
      body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
      expectedUpdatedAt: baseUpdatedAt
    });
    const ownerDetail = page.locator(".life-link-owner-detail");
    await expect(ownerDetail).toContainText("Planned upgrade priority: sleeping pad.");
    await expect(ownerDetail).toContainText("stay within the $250 budget");
    await expect(ownerDetail).toContainText("not purchased, owned, or installed");

    const persistedOwnerDetail = await browserFetchJson(page, canonicalPatchPath);
    expect(persistedOwnerDetail.status).toBe(200);
    expect(persistedOwnerDetail.body).toMatchObject({
      detail: {
        lifeLink: {
          id: COMPETITION_UPGRADE_PLAN_ID,
          parentId: COMPETITION_CAMPING_KIT_ID,
          title: "Camping Upgrade Plan",
          body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
          privacy: "private"
        }
      }
    });

    await page.reload();
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_UPGRADE_PLAN_ID}`);
    await expect(page.locator(".life-link-owner-detail")).toContainText("Planned upgrade priority: sleeping pad.");
    const restoredAccessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await expect(restoredAccessToggle).not.toBeChecked();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    expect((await controlledHostSnapshot(page)).registrationNames).toEqual([]);

    await restoredAccessToggle.check();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    const persistedInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(persistedInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_UPGRADE_PLAN_ID,
        bodyTruncated: false
      }
    });
    const persistedInspectedBody = readInspectedBody(persistedInspection);
    expect(persistedInspectedBody).toContain("Planned upgrade priority: sleeping pad.");
    expect(persistedInspectedBody).toContain("warm around 35°F and still works");
    expect(persistedInspectedBody).toContain("stay within the $250 budget");
    expect(patchRequests).toHaveLength(1);

    const findResult = await invokeControlledTool(page, "start_find_mode", {
      lifeLinkId: COMPETITION_SLEEPING_PAD_ID
    });
    expect(findResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_SLEEPING_PAD_ID,
      qrId: COMPETITION_DECOY_QR_ID,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    await expect(page.locator(".find-target")).toContainText("Camping Sleeping Pad");
    await expect(page.locator(".find-target")).toContainText(COMPETITION_DECOY_QR_ID);

    const sampleScans = page.locator(".sample-scans");
    await sampleScans.getByRole("button", { name: "Camping Sleeping Bag" }).click();
    await expect(page.locator(".scan-status")).toContainText("Not the selected item");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_TARGET_QR_ID);
    await sampleScans.getByRole("button", { name: "Camping Sleeping Pad" }).click();
    await expect(page.locator(".scan-status")).toContainText("Match found");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_DECOY_QR_ID);

    await restoredAccessToggle.uncheck();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    const revokedHost = await controlledHostSnapshot(page);
    expect([...revokedHost.abortedNames].sort()).toEqual(CANONICAL_TOOL_NAMES);
    await expect(invokeControlledTool(page, "inspect_current_life_link", {})).rejects.toThrow(
      "Tool inspect_current_life_link is not active."
    );

    const freshContext = await browser.newContext({ baseURL: challengeBaseURL });
    try {
      const freshPublicResponse = await freshContext.request.get(`/api/qr/${COMPETITION_TARGET_QR_ID}`);
      expect(freshPublicResponse.ok()).toBe(true);
      const freshPublicState = await freshPublicResponse.json();
      expect(freshPublicState).toMatchObject({
        state: "claimed",
        link: {
          id: COMPETITION_TARGET_QR_ID,
          ownerId: null,
          projectId: null,
          title: "Camping Sleeping Bag"
        },
        viewerIsOwner: false
      });
      assertNoHierarchyDisclosure(freshPublicState);
      const freshPublicJson = JSON.stringify(freshPublicState);
      for (const privateValue of [
        COMPETITION_CAMPING_KIT_ID,
        COMPETITION_SLEEP_SYSTEM_ID,
        COMPETITION_SLEEPING_BAG_ID,
        COMPETITION_SLEEPING_PAD_ID,
        COMPETITION_UPGRADE_PREFERENCES_ID,
        COMPETITION_UPGRADE_PLAN_ID,
        "Camping Kit",
        "Camping Sleep System",
        "Camping Upgrade Preferences",
        "Camping Upgrade Plan",
        "cold through the ground",
        "$250",
        COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY
      ]) {
        expect(freshPublicJson).not.toContain(privateValue);
      }

      const freshPage = await freshContext.newPage();
      await freshPage.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
      await assertPublicQrHasNoHierarchy(freshPage, "Camping Sleeping Bag");
      await expect(freshPage.locator(".public-content")).toContainText("kept me warm around 35°F");
      await expect(freshPage.locator(".public-content")).not.toContainText("Planned upgrade priority");
      await expect(freshPage.getByText("Camping Upgrade Plan", { exact: true })).toHaveCount(0);
    } finally {
      await freshContext.close();
    }

    expect(patchRequests).toHaveLength(1);
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
  await expect(page.getByRole("heading", { name: "Agent Access" })).toHaveCount(0);
  for (const ancestorTitle of TARGET_PATH.slice(0, -1)) {
    await expect(page.getByText(ancestorTitle, { exact: true })).toHaveCount(0);
  }
}

function readInspectedBody(result: Record<string, unknown>): string {
  return ((result.lifeLink as { body?: unknown } | undefined)?.body ?? "") as string;
}

function readInspectedUpdatedAt(result: Record<string, unknown>): string {
  return ((result.lifeLink as { updatedAt?: unknown } | undefined)?.updatedAt ?? "") as string;
}

function readOnlySearchBodySummary(result: Record<string, unknown>): string {
  const results = result.results as Array<{ bodySummary?: unknown }> | undefined;
  return (results?.[0]?.bodySummary ?? "") as string;
}

async function browserFetchJson(
  page: import("@playwright/test").Page,
  path: string
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, path);
}
