import { expect, test } from "@playwright/test";
import {
  COMPETITION_BASEMENT_GEAR_STORAGE_ID,
  COMPETITION_BASEMENT_GEAR_STORAGE_TITLE,
  COMPETITION_CYCLING_REPAIRS_TUB_ID,
  COMPETITION_CYCLING_REPAIRS_TUB_QR_ID,
  COMPETITION_CYCLING_REPAIRS_TUB_TITLE,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_PREFERENCES_ID,
  COMPETITION_FAMILY_PREFERENCES_TITLE,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
  COMPETITION_HIKING_WEATHER_TUB_ID,
  COMPETITION_HIKING_WEATHER_TUB_QR_ID,
  COMPETITION_HIKING_WEATHER_TUB_TITLE,
  COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
  COMPETITION_KITCHEN_WATER_TUB_ID,
  COMPETITION_KITCHEN_WATER_TUB_QR_ID,
  COMPETITION_KITCHEN_WATER_TUB_TITLE,
  COMPETITION_LIFE_LINK_IDS,
  COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
  COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
  COMPETITION_SAFETY_LIGHTING_TUB_ID,
  COMPETITION_SAFETY_LIGHTING_TUB_QR_ID,
  COMPETITION_SAFETY_LIGHTING_TUB_TITLE,
  COMPETITION_SHELTER_TUB_ID,
  COMPETITION_SHELTER_TUB_QR_ID,
  COMPETITION_SHELTER_TUB_TITLE,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_SLEEPING_PAD_QR_ID,
  COMPETITION_TARGET_QR_ID
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
const TARGET_PATH = [
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_BASEMENT_GEAR_STORAGE_TITLE,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
];
const SOURCE_LIFE_LINK_IDS = [
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_FAMILY_PREFERENCES_ID,
  COMPETITION_FOUR_DAY_FAMILY_TRIP_ID
];

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
    query: "Adult One Sleep System",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.adultOneSleepSystem,
    title: "Adult One Sleep System",
    locatorId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
    locatorTitle: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID
  },
  {
    query: "Adult Two Sleep System",
    lifeLinkId: COMPETITION_LIFE_LINK_IDS.adultTwoSleepSystem,
    title: "Adult Two Sleep System",
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
  test("packs, learns, persists one grounded family upgrade, and finds the right tub", async ({
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
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
      },
      viewerIsOwner: false
    });
    assertNoHierarchyDisclosure(initialPublicState);
    await assertPublicQrHasNoHierarchy(page, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
    await expect(page.locator(".public-content")).toContainText("two adults and two children");
    await expect(page.locator(".public-content")).not.toContainText("Camping Sleeping Pad");
    await expect(page.locator(".public-content")).not.toContainText("cold through the ground");

    await page.goto(`/qr/${COMPETITION_DECOY_QR_ID}`);
    await expect(page.getByRole("heading", { name: "Private context protected" })).toBeVisible();
    await expect(page.getByText("Log in as the owner to view this content.")).toBeVisible();
    await expect(page.getByText("Private context remains hidden.")).toBeVisible();
    await expect(page.getByText("Shared by the owner", { exact: false })).toHaveCount(0);
    await expect(page.locator(".public-content")).toHaveCount(0);

    await page.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);

    await page.getByLabel("Email").fill(CHALLENGE_EMAIL);
    await page.getByLabel("Password").fill(CHALLENGE_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const openInWorkspace = page.getByRole("button", { name: "Open in My Life Links" });
    await expect(openInWorkspace).toBeVisible();

    await page.goto(`/qr/${COMPETITION_DECOY_QR_ID}`);
    await expect(page.getByRole("heading", { name: "Private context visible to owner" })).toBeVisible();
    await expect(page.getByText("Owner-only view")).toBeVisible();
    await expect(page.getByText("Owner-only", { exact: true })).toBeVisible();
    await expect(page.getByText(/This context is not public/)).toBeVisible();
    await expect(page.getByText("Owner-only context, not publicly shared.")).toBeVisible();
    await expect(page.getByText("Shared by the owner", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/intentionally published by the owner/)).toHaveCount(0);

    await page.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
    await expect(openInWorkspace).toBeVisible();
    await expect(page).toHaveURL(`${challengeBaseURL}/qr/${COMPETITION_TARGET_QR_ID}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await openInWorkspace.focus();
    await openInWorkspace.press("Enter");

    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID}`);
    await expect(page.locator(".topbar h2")).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(
      page.locator(`[data-selected-life-link-id="${COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID}"]`)
    ).toBeVisible();
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

    const connectButton = page.getByRole("button", { name: "Connect Agent" });
    await expect(connectButton).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual([]);
    await connectButton.click();
    await expect(page.getByRole("button", { name: "Disconnect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    const registeredCatalog = await controlledHostSnapshot(page);
    expect(registeredCatalog.registrationNames).toHaveLength(5);
    expect([...registeredCatalog.registrationNames].sort()).toEqual(CANONICAL_TOOL_NAMES);

    const tubInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(tubInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
        qrId: COMPETITION_TARGET_QR_ID,
        path: TARGET_PATH.map((title) => ({ title })),
        bodyTruncated: false
      },
      physicalLocator: {
        lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
        qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
        relation: "self"
      },
      visibleEffect: "current_life_link_focused",
      truncated: false
    });
    expect(readInspectedBody(tubInspection)).toContain("two adults and two children");

    for (const packingCase of PACKING_LOCATOR_CASES) {
      const packingSearch = await invokeControlledTool(page, "search_my_life_links", {
        query: packingCase.query,
        limit: 10
      });
      expect(packingSearch).toMatchObject({
        ok: true,
        query: packingCase.query,
        visibleEffect: "search_results_highlighted"
      });
      const packingResult = readSearchResult(packingSearch, packingCase.lifeLinkId);
      expect(packingResult).toMatchObject({
        id: packingCase.lifeLinkId,
        title: packingCase.title,
        physicalLocator: {
          lifeLinkId: packingCase.locatorId,
          title: packingCase.locatorTitle,
          qrId: packingCase.qrId,
          relation: "ancestor"
        }
      });
      await expect(page.locator(`[data-life-link-search-id="${packingCase.lifeLinkId}"]`)).toContainText(
        `Recorded QR locator: ${packingCase.locatorTitle}`
      );
      await expect(page.locator(`[data-life-link-search-id="${packingCase.lifeLinkId}"]`)).toContainText(
        packingCase.qrId
      );
    }

    const padSearch = await invokeControlledTool(page, "search_my_life_links", {
      query: "Camping Sleeping Pad",
      limit: 10
    });
    expect(padSearch).toMatchObject({
      ok: true,
      query: "Camping Sleeping Pad",
      visibleEffect: "search_results_highlighted",
      truncated: false
    });
    const padResult = readSearchResult(padSearch, COMPETITION_SLEEPING_PAD_ID);
    expect(padResult).toMatchObject({
      id: COMPETITION_SLEEPING_PAD_ID,
      title: "Camping Sleeping Pad",
      qrId: COMPETITION_SLEEPING_PAD_QR_ID,
      recordedPath:
        "Family Adventure Gear > Basement Gear Storage > Green Tub 02 / Family Sleep Systems > Adult Two Sleep System > Camping Sleeping Pad",
      physicalLocator: {
        lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
        qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
        relation: "ancestor"
      },
      matchClass: "exact_title"
    });
    const padSummary = String(padResult.bodySummary ?? "");
    expect(padSummary).toContain("Cold came through the ground");
    expect(padSummary).toContain("low-R sleeping pad");
    await expect(page.locator(`[data-life-link-search-id="${COMPETITION_SLEEPING_PAD_ID}"]`)).toContainText(
      `Recorded QR locator: ${COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE}`
    );

    const preferenceSearch = await invokeControlledTool(page, "search_my_life_links", {
      query: COMPETITION_FAMILY_PREFERENCES_TITLE,
      limit: 10
    });
    expect(preferenceSearch).toMatchObject({
      ok: true,
      query: COMPETITION_FAMILY_PREFERENCES_TITLE,
      visibleEffect: "search_results_highlighted",
      truncated: false
    });
    const preferenceResult = readSearchResult(preferenceSearch, COMPETITION_FAMILY_PREFERENCES_ID);
    expect(preferenceResult).toMatchObject({
      id: COMPETITION_FAMILY_PREFERENCES_ID,
      title: COMPETITION_FAMILY_PREFERENCES_TITLE,
      recordedPath: "Family Adventure Gear > Family Preferences and Fit",
      physicalLocator: null,
      matchClass: "exact_title"
    });
    const preferenceSummary = String(preferenceResult.bodySummary ?? "");
    expect(preferenceSummary).toContain("warmth matters more than minimum weight");
    expect(preferenceSummary).toContain("$250");

    const tripSearch = await invokeControlledTool(page, "search_my_life_links", {
      query: COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
      limit: 10
    });
    expect(tripSearch).toMatchObject({
      ok: true,
      query: COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
      visibleEffect: "search_results_highlighted",
      truncated: false
    });
    const tripResult = readSearchResult(tripSearch, COMPETITION_FOUR_DAY_FAMILY_TRIP_ID);
    expect(tripResult).toMatchObject({
      id: COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
      title: COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
      recordedPath:
        "Family Adventure Gear > Previous Trip Experiences > Four-Day Family Camping, Hiking and Cycling Trip",
      physicalLocator: null,
      matchClass: "exact_title"
    });
    const tripSummary = String(tripResult.bodySummary ?? "");
    expect(tripSummary).toContain("two adults and two children");
    expect(tripSummary).toContain("35°F");
    expect(tripSummary).toContain("existing sleeping bag");

    const openPlanResult = await invokeControlledTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID
    });
    expect(openPlanResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
      title: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
      recordedPath: "Family Adventure Gear > Next-Year Upgrade Plan",
      visibleEffect: "life_link_opened"
    });
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID}`);

    const planInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(planInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
        bodyTruncated: false,
        path: [
          { title: COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE },
          { title: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE }
        ]
      },
      physicalLocator: null,
      visibleEffect: "current_life_link_focused"
    });
    expect(
      [COMPETITION_INITIAL_UPGRADE_PLAN_BODY, COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY].map((body) =>
        body.replace(/\s+/g, " ").trim()
      )
    ).toContain(readInspectedBody(planInspection));
    const baseUpdatedAt = readInspectedUpdatedAt(planInspection);
    expect(baseUpdatedAt).toBe((openPlanResult as { updatedAt: string }).updatedAt);

    expect(patchRequests).toEqual([]);
    const updateResult = await invokeControlledTool(page, "update_life_link_content", {
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
      baseUpdatedAt,
      body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
      sourceLifeLinkIds: SOURCE_LIFE_LINK_IDS
    });
    expect(updateResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
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
    const canonicalPatchPath = `/api/life-links/${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID}`;
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
          id: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
          parentId: COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
          title: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
          body: COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY,
          privacy: "private"
        }
      }
    });

    await page.reload();
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID}`);
    await expect(page.locator(".life-link-owner-detail")).toContainText("Planned upgrade priority: sleeping pad.");
    await expect(page.getByRole("button", { name: "Disconnect Agent" })).toBeVisible();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    expect((await controlledHostSnapshot(page)).registrationNames.sort()).toEqual(CANONICAL_TOOL_NAMES);
    const persistedInspection = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(persistedInspection).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
        bodyTruncated: false
      }
    });
    const persistedInspectedBody = readInspectedBody(persistedInspection);
    expect(persistedInspectedBody).toContain("Planned upgrade priority: sleeping pad.");
    expect(persistedInspectedBody).toContain("warm around 35°F and still works");
    expect(persistedInspectedBody).toContain("stay within the $250 budget");
    expect(patchRequests).toHaveLength(1);

    const findResult = await invokeControlledTool(page, "start_find_mode", {
      lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID
    });
    expect(findResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
      qrId: COMPETITION_TARGET_QR_ID,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    await expect(page.locator(".find-target")).toContainText(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
    await expect(page.locator(".find-target")).toContainText(COMPETITION_TARGET_QR_ID);

    const sampleScans = page.locator(".sample-scans");
    await sampleScans.getByRole("button", { name: COMPETITION_SHELTER_TUB_TITLE }).click();
    await expect(page.locator(".scan-status")).toContainText("Not the selected item");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_DECOY_QR_ID);
    await sampleScans.getByRole("button", { name: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE }).click();
    await expect(page.locator(".scan-status")).toContainText("Match found");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_TARGET_QR_ID);

    await page.getByRole("button", { name: "Disconnect Agent" }).click();
    await expect(page.getByRole("button", { name: "Connect Agent" })).toBeVisible();
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
          title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
        },
        viewerIsOwner: false
      });
      assertNoHierarchyDisclosure(freshPublicState);
      const freshPublicJson = JSON.stringify(freshPublicState);
      for (const privateValue of [
        COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
        COMPETITION_BASEMENT_GEAR_STORAGE_ID,
        COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
        COMPETITION_SLEEPING_BAG_ID,
        COMPETITION_SLEEPING_PAD_ID,
        COMPETITION_FAMILY_PREFERENCES_ID,
        COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
        COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
        COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
        COMPETITION_BASEMENT_GEAR_STORAGE_TITLE,
        "Adult One Sleep System",
        "Camping Sleeping Pad",
        COMPETITION_FAMILY_PREFERENCES_TITLE,
        COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
        COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
        "cold through the ground",
        "$250",
        COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY
      ]) {
        expect(freshPublicJson).not.toContain(privateValue);
      }

      const freshPage = await freshContext.newPage();
      await freshPage.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
      await assertPublicQrHasNoHierarchy(freshPage, COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE);
      await expect(freshPage.locator(".public-content")).toContainText("two adults and two children");
      await expect(freshPage.locator(".public-content")).not.toContainText("Camping Sleeping Pad");
      await expect(freshPage.locator(".public-content")).not.toContainText("Planned upgrade priority");
      await expect(freshPage.getByText(COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE, { exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "Agent Connection" })).toHaveCount(0);
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

function readSearchResult(result: Record<string, unknown>, lifeLinkId: string): Record<string, unknown> {
  const results = result.results as Array<Record<string, unknown>> | undefined;
  const match = results?.find((item) => item.id === lifeLinkId);
  expect(match, `search output omitted expected Life Link ${lifeLinkId}`).toBeDefined();
  return match!;
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
