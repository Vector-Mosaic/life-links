import { expect, test } from "@playwright/test";
import {
  COMPETITION_CAMERA_BATTERY_KIT_ID,
  COMPETITION_DECOY_QR_ID,
  COMPETITION_FIELD_CAMERA_BAG_ID,
  COMPETITION_FRONT_ORGANIZER_ID,
  COMPETITION_LENS_CLEANING_KIT_ID,
  COMPETITION_MAIN_COMPARTMENT_ID,
  COMPETITION_OWNER_EMAIL,
  COMPETITION_POWER_POUCH_ID,
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
const TARGET_PATH = ["Field Camera Bag", "Main Compartment", "Power Pouch", "Camera Battery Kit"];
const DECOY_PATH = "Field Camera Bag > Front Organizer > Lens Cleaning Kit";
const SYNTHETIC_CHECKLIST = [
  "Challenge field checklist",
  "- [x] Pack two charged batteries",
  "- [x] Confirm the USB-C charger is in the pouch",
  "- [ ] Add one labeled spare",
  "- [ ] Run the synthetic preflight check"
].join("\n");

test.describe("competition physical-to-digital loop", () => {
  test("persists an agent-assisted update through one human Save and finds the physical target", async ({
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
        title: "Camera Battery Kit"
      },
      viewerIsOwner: false
    });
    assertNoHierarchyDisclosure(initialPublicState);
    await assertPublicQrHasNoHierarchy(page, "Camera Battery Kit");
    await expect(page.locator(".public-content")).toContainText("Battery readiness");

    await page.getByLabel("Email").fill(CHALLENGE_EMAIL);
    await page.getByLabel("Password").fill(CHALLENGE_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    const openInWorkspace = page.getByRole("button", { name: "Open in My Life Links" });
    await expect(openInWorkspace).toBeVisible();
    await expect(page).toHaveURL(`${challengeBaseURL}/qr/${COMPETITION_TARGET_QR_ID}`);
    await openInWorkspace.click();

    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_CAMERA_BATTERY_KIT_ID}`);
    await expect(page.locator(`[data-selected-life-link-id="${COMPETITION_CAMERA_BATTERY_KIT_ID}"]`)).toBeVisible();
    const breadcrumbs = page.getByRole("navigation", { name: "Life Link path" });
    await expect(breadcrumbs.locator(":scope > .life-link-breadcrumb-item > button")).toHaveText(TARGET_PATH);
    await expect(breadcrumbs.locator(".life-link-breadcrumb-ellipsis")).toHaveCount(0);

    const accessToggle = page.getByRole("checkbox", { name: /Off|On for this page session/ });
    await expect(accessToggle).not.toBeChecked();
    await accessToggle.check();
    await expect.poll(async () => (await controlledHostSnapshot(page)).activeNames).toEqual(CANONICAL_TOOL_NAMES);
    const registeredCatalog = await controlledHostSnapshot(page);
    expect(registeredCatalog.registrationNames).toHaveLength(5);
    expect([...registeredCatalog.registrationNames].sort()).toEqual(CANONICAL_TOOL_NAMES);

    const inspectResult = await invokeControlledTool(page, "inspect_current_life_link", {});
    expect(inspectResult).toMatchObject({
      ok: true,
      lifeLink: {
        id: COMPETITION_CAMERA_BATTERY_KIT_ID,
        qrId: COMPETITION_TARGET_QR_ID,
        path: TARGET_PATH.map((title) => ({ title }))
      },
      visibleEffect: "current_life_link_focused"
    });
    const inspectedLifeLink = inspectResult.lifeLink as { id: string; updatedAt: string };

    const searchResult = await invokeControlledTool(page, "search_my_life_links", {
      query: "Lens Cleaning Kit",
      limit: 10
    });
    expect(searchResult).toMatchObject({
      ok: true,
      query: "Lens Cleaning Kit",
      resultCount: 1,
      results: [
        {
          id: COMPETITION_LENS_CLEANING_KIT_ID,
          qrId: COMPETITION_DECOY_QR_ID,
          recordedPath: DECOY_PATH
        }
      ],
      visibleEffect: "search_results_highlighted"
    });
    await expect(page.getByLabel("Search My Life Links")).toHaveValue("Lens Cleaning Kit");
    await expect(page.locator(`[data-life-link-search-id="${COMPETITION_LENS_CLEANING_KIT_ID}"]`)).toContainText(DECOY_PATH);

    const openResult = await invokeControlledTool(page, "open_life_link", {
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID
    });
    expect(openResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
      title: "Camera Battery Kit",
      recordedPath: TARGET_PATH.join(" > "),
      visibleEffect: "life_link_opened"
    });
    await expect(page).toHaveURL(`${challengeBaseURL}/life-links/${COMPETITION_CAMERA_BATTERY_KIT_ID}`);

    expect(patchRequests).toEqual([]);
    const draftResult = await invokeControlledTool(page, "draft_life_link_update", {
      lifeLinkId: inspectedLifeLink.id,
      baseUpdatedAt: inspectedLifeLink.updatedAt,
      body: SYNTHETIC_CHECKLIST,
      sourceLifeLinkIds: [COMPETITION_LENS_CLEANING_KIT_ID]
    });
    expect(draftResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
      proposedFields: ["body"],
      sourceLifeLinkIds: [COMPETITION_LENS_CLEANING_KIT_ID],
      saved: false,
      privacyChanged: false,
      visibleEffect: "agent_draft_opened"
    });
    const editor = page.getByRole("dialog");
    await expect(editor.getByText("Agent draft — not saved", { exact: true })).toBeVisible();
    await expect(editor.locator(".agent-draft-review")).toContainText(SYNTHETIC_CHECKLIST);
    await expect(editor.getByLabel("Authorized source Life Links")).toContainText(COMPETITION_LENS_CLEANING_KIT_ID);
    expect(patchRequests).toEqual([]);

    await editor.getByRole("button", { name: "Apply proposal" }).click();
    await expect(editor.getByText("Applied to the editor, but still not saved.")).toBeVisible();
    await expect(editor.locator(".rich-body-editor-surface")).toContainText("Run the synthetic preflight check");
    await page.waitForTimeout(300);
    expect(patchRequests).toEqual([]);

    const canonicalPatchPath = `/api/life-links/${COMPETITION_CAMERA_BATTERY_KIT_ID}`;
    const saveResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === "PATCH" && new URL(response.url()).pathname === canonicalPatchPath;
    });
    await editor.getByRole("button", { name: "Save" }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBe(true);
    await expect(editor).toBeHidden();
    expect(patchRequests).toHaveLength(1);
    expect(new URL(patchRequests[0].url).pathname).toBe(canonicalPatchPath);
    expect(patchRequests[0].body).toMatchObject({
      expectedUpdatedAt: inspectedLifeLink.updatedAt,
      title: "Camera Battery Kit",
      body: SYNTHETIC_CHECKLIST,
      privacy: "public"
    });
    await expect(page.locator(".life-link-owner-detail .life-link-detail-body")).toContainText("Run the synthetic preflight check");

    const persistedOwnerDetail = await browserFetchJson(page, canonicalPatchPath);
    expect(persistedOwnerDetail.status).toBe(200);
    expect(persistedOwnerDetail.body).toMatchObject({
      detail: {
        lifeLink: {
          id: COMPETITION_CAMERA_BATTERY_KIT_ID,
          body: SYNTHETIC_CHECKLIST
        }
      }
    });
    const persistedLifeLink = (persistedOwnerDetail.body as {
      detail: { lifeLink: { updatedAt: string } };
    }).detail.lifeLink;
    expect(persistedLifeLink.updatedAt).not.toBe(inspectedLifeLink.updatedAt);

    const findResult = await invokeControlledTool(page, "start_find_mode", {
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID
    });
    expect(findResult).toMatchObject({
      ok: true,
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
      qrId: COMPETITION_TARGET_QR_ID,
      cameraStarted: false,
      visibleEffect: "find_mode_started"
    });
    await expect(page.locator(".find-target")).toContainText("Camera Battery Kit");
    await expect(page.locator(".find-target")).toContainText(COMPETITION_TARGET_QR_ID);

    await page.locator(".sample-scans").getByRole("button", { name: "Lens Cleaning Kit" }).click();
    await expect(page.locator(".scan-status")).toContainText("Not the selected item");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_DECOY_QR_ID);
    await page.getByRole("button", { name: "Target" }).click();
    await expect(page.locator(".scan-status")).toContainText("Match found");
    await expect(page.locator(".scan-status")).toContainText(COMPETITION_TARGET_QR_ID);

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
          title: "Camera Battery Kit",
          body: SYNTHETIC_CHECKLIST
        },
        viewerIsOwner: false
      });
      assertNoHierarchyDisclosure(freshPublicState);
      expect(JSON.stringify(freshPublicState)).not.toContain(COMPETITION_FIELD_CAMERA_BAG_ID);
      expect(JSON.stringify(freshPublicState)).not.toContain(COMPETITION_MAIN_COMPARTMENT_ID);
      expect(JSON.stringify(freshPublicState)).not.toContain(COMPETITION_POWER_POUCH_ID);
      expect(JSON.stringify(freshPublicState)).not.toContain(COMPETITION_FRONT_ORGANIZER_ID);

      const freshPage = await freshContext.newPage();
      await freshPage.goto(`/qr/${COMPETITION_TARGET_QR_ID}`);
      await assertPublicQrHasNoHierarchy(freshPage, "Camera Battery Kit");
      await expect(freshPage.locator(".public-content")).toContainText("Challenge field checklist");
      await expect(freshPage.locator(".public-content")).toContainText("Run the synthetic preflight check");
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

async function browserFetchJson(
  page: import("@playwright/test").Page,
  path: string
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, path);
}
