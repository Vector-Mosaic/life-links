import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  lifeLinkChangePreviewItem,
  resolveLifeLinkChangeScope,
  summarizeLifeLink,
  type AttachmentContentPage,
  type ChangeHistory,
  type CollectionRecord,
  type CollectionSectionRecord,
  type LifeLinkCollectionMembership,
  type LifeLinkDetail,
  type LifeLinkChangePreview,
  type LifeLinkMediaRecord,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkBodyDoc,
  type LinkRecord,
  type PreviewLifeLinkChangeInput,
  type UserRecord
} from "@life-links/core";

const owner: Pick<UserRecord, "id" | "email" | "displayName" | "createdAt"> = {
  id: "demo-owner",
  email: "owner@life-links.test",
  displayName: "Demo Owner",
  createdAt: "2026-05-01T00:00:00.000Z"
};

const folder = {
  id: "rich-folder",
  ownerId: owner.id,
  name: "Rich Notes",
  createdAt: "2026-05-01T00:00:00.000Z"
};

test.describe("local rich body editor", () => {
  test("keeps QR selection synchronized with browser back and forward", async ({ baseURL, page }) => {
    const publicTitle = "Fresh public QR response";
    const state = await mockLifeLinksApi(
      page,
      baseURL ?? "http://127.0.0.1:4174",
      { publicTitle }
    );

    await page.goto("/life-links");
    await openNavigationAction(page, "Scan a QR");
    await page.getByLabel("QR code or URL", { exact: true }).fill(state.link.url);
    await page.getByRole("button", { name: "Open QR", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/qr/${state.link.id}$`));
    await expect(page.locator(".public-content .record-label")).toHaveText("Life Link");
    await expect(page.getByRole("heading", { name: publicTitle })).toBeVisible();
    await expect(page.getByText(folder.name)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();

    await page.getByRole("button", { name: "Open in My Life Links" }).click();
    await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
    await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/qr/${state.link.id}$`));
    await expect(page.getByRole("button", { name: "Open in My Life Links" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
    await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  });

  test("saves slash-command block content and renders it after save", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/life-links");
    await openOwnerLifeLink(page, state);
    await expect(page.locator(".ll-detail-content")).toContainText("Plain starting body");
    await openRecordEditor(page, state);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("/hea");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await page.locator(".slash-command-menu").getByRole("option", { name: /Heading 1/ }).click();
    await page.keyboard.type("Install notes");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Preserve line one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/bul");
    await expect(page.locator(".slash-command-menu")).toBeVisible();
    await page.locator(".slash-command-menu").getByRole("option", { name: /Bullet list/ }).click();
    await page.keyboard.type("First bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second bullet");

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastCanonicalPatch?.body).toContain("Install notes");
    expect(state.lastCanonicalPatch?.body).toContain("First bullet");
    expect(state.lastCanonicalPatch?.bodyDocVersion).toBe(1);
    expect(state.lastCanonicalExpectedUpdatedAt).toBe("2026-05-07T12:00:00.000Z");
    expect(hasNodeType(state.lastCanonicalPatch?.bodyDoc, "heading")).toBe(true);
    expect(hasNodeType(state.lastCanonicalPatch?.bodyDoc, "bulletList")).toBe(true);

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Install notes" })).toBeVisible();
    await expect(page.locator(".ll-detail-content .body-list")).toContainText("First bullet");
    await page.reload();
    await expect(page.locator(".ll-detail-content .body-list")).toContainText("First bullet");
  });

  test("formats selected text and edits links from the selection bubble", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/life-links");
    await openOwnerLifeLink(page, state);
    await openRecordEditor(page, state);

    const dialog = page.getByRole("dialog");
    const editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("Client portal");
    await page.keyboard.press("ControlOrMeta+A");

    const bubble = page.locator(".selection-bubble-menu");
    await expect(bubble).toBeVisible();
    await editor.click({ position: { x: 24, y: 160 } });
    await expect(bubble).toBeHidden();
    await page.keyboard.press("ControlOrMeta+A");
    await expect(bubble).toBeVisible();
    await bubble.getByRole("button", { name: "Bold" }).click();
    await bubble.getByRole("button", { name: "Link", exact: true }).click();

    const linkInput = bubble.getByLabel("Link URL");
    await expect(linkInput).toBeVisible();
    await linkInput.fill("client.example.com");
    await bubble.getByRole("button", { name: "Apply link" }).click();

    await page.keyboard.press("ControlOrMeta+A");
    await bubble.getByRole("button", { name: "Link", exact: true }).click();
    await expect(linkInput).toHaveValue("https://client.example.com");
    await linkInput.fill("portal.example.com");
    await bubble.getByRole("button", { name: "Apply link" }).click();

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await dialog.getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(state.lastCanonicalPatch?.body).toContain("Client portal");
    expect(hasMarkType(state.lastCanonicalPatch?.bodyDoc, "bold")).toBe(true);
    expect(hasMarkType(state.lastCanonicalPatch?.bodyDoc, "link")).toBe(true);
    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).toContain("https://portal.example.com");

    await expect(dialog).toBeHidden();
    await expect(page.locator('.ll-detail-content .formatted-body a[href="https://portal.example.com"]')).toContainText("Client portal");
    await expect(page.locator(".ll-detail-content .formatted-body strong")).toContainText("Client portal");
  });

  test("recovers unsaved drafts and cleans pasted rich links", async ({ baseURL, page }) => {
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");

    await page.goto("/life-links");
    await openOwnerLifeLink(page, state);
    await openRecordEditor(page, state);

    const dialog = page.getByRole("dialog");
    let editor = dialog.locator(".rich-body-editor-surface");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await pasteHtml(
      editor,
      '<p><a href="javascript:alert(1)">Bad link</a> and <a href="https://safe.example.test/path">Safe link</a><script>window.bad = true</script></p>'
    );
    await expect(editor).toContainText("Safe link");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-editor-draft-v2:life-link-rich") ?? ""))
      .toContain("Safe link");

    await dialog.getByRole("button", { name: "Close editor" }).click();
    await openRecordEditor(page, state);
    await expect(page.getByText("Draft recovered from this browser.")).toBeVisible();
    editor = page.getByRole("dialog").locator(".rich-body-editor-surface");
    await expect(editor).toContainText("Safe link");

    const updateResponse = page.waitForResponse((response) => {
      return response.url().includes(`/api/life-links/${state.lifeLink.id}`) && response.request().method() === "PATCH";
    });
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await updateResponse;

    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).toContain("https://safe.example.test/path");
    expect(JSON.stringify(state.lastCanonicalPatch?.bodyDoc)).not.toContain("javascript:");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("life-links-editor-draft-v2:life-link-rich")))
      .toBeNull();
  });
});

for (const width of [665, 1440]) {
  test(`Field Ledger keeps ${width}px desktop panels aligned, account fixed, and menu keyboard focus recoverable`, async ({ baseURL, page, isMobile }) => {
    test.skip(isMobile, "Desktop split-panel geometry; mobile uses the separately tested drill-down layout.");
    await page.setViewportSize({ width, height: 791 });
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");
    state.lifeLink.body = Array.from({ length: 80 }, (_, index) => `Packing note ${index + 1}: keep the family equipment dry and organized.`).join("\n\n");
    state.lifeLink.bodyDoc = createLinkBodyDocFromPlainText(state.lifeLink.body);
    await page.goto("/life-links");
    await openOwnerLifeLink(page, state);
    const middleTitle = page.locator(".ll-middle .ll-title-row h1");
    const detailTitle = page.locator(".ll-details .ll-detail-title-row h2");
    await expect(middleTitle).toBeVisible();
    await expect(detailTitle).toBeVisible();
    const middleBox = await middleTitle.boundingBox();
    const detailBox = await detailTitle.boundingBox();
    expect(Math.abs(middleBox!.y - detailBox!.y)).toBeLessThanOrEqual(2);

    const collapseHierarchy = page.getByRole("button", { name: "Collapse Hierarchies", exact: true });
    const collapseDetails = page.getByRole("button", { name: "Collapse Details", exact: true });
    const hierarchyButtonBefore = await collapseHierarchy.boundingBox();
    const detailsButtonBefore = await collapseDetails.boundingBox();
    expect(Math.abs(hierarchyButtonBefore!.y - detailsButtonBefore!.y)).toBeLessThanOrEqual(1);

    const add = page.getByRole("button", { name: `Add to ${folder.name}`, exact: true });
    await add.click();
    await expect(page.getByRole("menuitem", { name: "New folder", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(add).toBeFocused();

    const account = page.getByRole("button", { name: "Account", exact: true });
    const accountBefore = await account.boundingBox();
    const detailsScroll = page.locator(".ll-details > .ll-panel-scroll");
    await detailsScroll.hover();
    await page.mouse.wheel(0, 1800);
    await expect.poll(() => detailsScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
    const accountAfter = await account.boundingBox();
    expect(Math.abs(accountBefore!.y - accountAfter!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await collapseHierarchy.boundingBox())!.y - hierarchyButtonBefore!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await collapseDetails.boundingBox())!.y - detailsButtonBefore!.y)).toBeLessThanOrEqual(1);
    await expect(account).toBeInViewport({ ratio: 1 });
    await account.click();
    await expect(page.getByRole("menuitem", { name: "Settings", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(account).toBeFocused();
  });
}

test("Field Ledger restores panels independently in a narrow mouse window and fits pinned navigation", async ({ baseURL, page, isMobile }) => {
  test.skip(isMobile, "Mouse-capable split panels; touch drill-down is exercised separately.");
  await page.setViewportSize({ width: 665, height: 791 });
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");
  await page.goto("/life-links");
  expect(await page.evaluate(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(true);
  await openOwnerLifeLink(page, state);

  const middleContent = page.locator(".ll-middle > .ll-panel-scroll");
  const selectedDetail = page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`);
  const collapseHierarchy = page.getByRole("button", { name: "Collapse Hierarchies", exact: true });
  const expandHierarchy = page.getByRole("button", { name: "Expand Hierarchies", exact: true });
  const collapseDetails = page.getByRole("button", { name: "Collapse Details", exact: true });
  const expandDetails = page.getByRole("button", { name: "Expand Details", exact: true });

  await expect(collapseHierarchy).toBeInViewport({ ratio: 1 });
  await expect(collapseDetails).toBeInViewport({ ratio: 1 });
  await collapseHierarchy.click();
  await expect(middleContent).toBeHidden();
  await expect(expandHierarchy).toBeInViewport({ ratio: 1 });
  await expect(selectedDetail).toBeVisible();
  await collapseDetails.click();
  await expect(selectedDetail).toBeHidden();
  await expect(expandDetails).toBeInViewport({ ratio: 1 });
  await expect(expandHierarchy).toBeInViewport({ ratio: 1 });

  await expandHierarchy.click();
  await expect(middleContent).toBeVisible();
  await expect(expandDetails).toBeVisible();
  await collapseHierarchy.click();
  await expandDetails.click();
  await expect(selectedDetail).toBeVisible();
  await expect(expandHierarchy).toBeVisible();
  await expandHierarchy.click();
  await expect(middleContent).toBeVisible();
  await expect(selectedDetail).toBeVisible();

  for (const pinAction of ["Pin navigation", "Unpin navigation"]) {
    await page.getByRole("button", { name: pinAction, exact: true }).click();
    // Moving both focus and the pointer out of the rail distinguishes pinning
    // from its transient hover/focus expansion without changing panel state.
    await collapseHierarchy.focus();
    await collapseDetails.hover();
    await expect(collapseHierarchy).toBeInViewport({ ratio: 1 });
    await expect(collapseDetails).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".ll-sidebar")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".ll-middle")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".ll-details")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await openNavigationAction(page, "My Collections");
  const collectionsTitle = page.getByRole("heading", { name: "My Collections", exact: true });
  await expect(collectionsTitle).toBeVisible();
  const collapseCollections = page.getByRole("button", { name: "Collapse Collections", exact: true });
  await collapseCollections.focus();
  await page.locator(".ll-topbar").hover();
  await collapseCollections.click();
  await expect(collectionsTitle).toBeHidden();
  const expandCollections = page.getByRole("button", { name: "Expand Collections", exact: true });
  await expect(expandCollections).toBeInViewport({ ratio: 1 });
  await expandCollections.click();
  await expect(collectionsTitle).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to My Collections", exact: true })).toBeVisible();
});

test("Field Ledger touch navigation closes and item Details returns to the current hierarchy", async ({ baseURL, page, isMobile }) => {
  test.skip(!isMobile, "Requires the configured touch/mobile browser context.");
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");
  await page.goto("/life-links");
  expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
  const navigation = page.getByRole("complementary", { name: "Life Links navigation", exact: true });
  const openNavigation = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(navigation).toBeHidden();
  await openNavigation.click();
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeInViewport({ ratio: 1 });
  const closeNavigation = page.getByRole("button", { name: "Close navigation", exact: true });
  const scrimBox = await closeNavigation.boundingBox();
  await closeNavigation.click({ position: { x: scrimBox!.width - 8, y: 20 } });
  await expect(navigation).toBeHidden();

  await openNavigation.click();
  await page.getByRole("button", { name: "My Collections", exact: true }).click();
  await expect(navigation).toBeHidden();
  await expect(page.getByRole("heading", { name: "My Collections", exact: true })).toBeVisible();
  await openNavigation.click();
  await page.getByRole("button", { name: "My Life Links", exact: true }).click();
  await expect(navigation).toBeHidden();

  await openOwnerLifeLink(page, state);
  await expect(page.locator(".ll-middle")).toBeHidden();
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.locator(".ll-details")).toBeHidden();
  await expect(page.getByRole("heading", { name: folder.name, exact: true })).toBeVisible();
  await expect(page.locator(`[data-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await page.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await expect(back).toBeVisible();
});

test("sign-in shows the LifeLinks wordmark and glyph", async ({ baseURL, page }) => {
  await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { user: null, qrBaseUrl: baseURL, agentConnection: { connected: false, connectedAt: null } } });
  });
  await page.goto("/life-links");
  const brand = page.getByRole("heading", { name: "LifeLinks", exact: true });
  await expect(brand).toBeVisible();
  await expect(brand.locator("svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".ll-shell")).toHaveCount(0);
});

test("Field Ledger expands deep breadcrumbs inline without changing selection and resets on navigation", async ({ baseURL, page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 665, height: 791 });
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174", { withDeepAncestry: true });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  const parent = state.deepAncestors.at(-1)!;
  await page.goto(`/life-links/${parent.id}`);
  const currentPath = page.getByRole("navigation", { name: "Current layer", exact: true });
  const currentDisplay = currentPath.locator(".ll-breadcrumbs-display");
  const containingTitles = state.deepAncestors.slice(-2).map((ancestor) => ancestor.title);
  const fullFolderTitles = ["My Life Links", ...state.deepAncestors.map((ancestor) => ancestor.title)];
  const middleTitle = page.locator(".ll-middle .ll-title-row h1");
  await expectCompactBreadcrumbs(currentPath, containingTitles);
  await expectInlineBreadcrumbExpansion(currentPath, middleTitle, fullFolderTitles);
  await expect(page).toHaveURL(new RegExp(`/life-links/${parent.id}$`));
  if (!isMobile) {
    await page.setViewportSize({ width: 1600, height: 791 });
    await expect(currentDisplay.getByRole("button", { name: /^(Expand|Collapse) full path$/ })).toHaveCount(0);
    await expect(currentDisplay.getByRole("button")).toHaveText(fullFolderTitles);
    await expectBreadcrumbsWithinTwoLines(currentPath);
    await page.setViewportSize({ width: 665, height: 791 });
    await expectCompactBreadcrumbs(currentPath, containingTitles);
  }
  const middleTitleBeforeSelection = await middleTitle.boundingBox();

  await page.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  const selectedDetail = page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`);
  await expect(selectedDetail).toBeVisible();
  const selectedUrl = page.url();
  const itemPath = page.getByRole("navigation", { name: "Item location", exact: true });
  const itemDisplay = itemPath.locator(".ll-breadcrumbs-display");
  await expectCompactBreadcrumbs(itemPath, containingTitles);
  await expect(itemDisplay.getByText(state.lifeLink.title, { exact: true })).toHaveCount(0);
  const detailTitle = page.locator(".ll-details .ll-detail-title-row h2");
  const detailTitleBox = await detailTitle.boundingBox();
  const middleTitleBox = isMobile ? middleTitleBeforeSelection : await middleTitle.boundingBox();
  expect(Math.abs(middleTitleBox!.y - detailTitleBox!.y)).toBeLessThanOrEqual(2);
  await expectInlineBreadcrumbExpansion(itemPath, detailTitle, [...fullFolderTitles, state.lifeLink.title]);
  await expect(selectedDetail).toBeVisible();
  await expect(page).toHaveURL(selectedUrl);
  if (!isMobile) await expectCompactBreadcrumbs(currentPath, containingTitles);

  const visibleAncestor = state.deepAncestors.at(-2)!;
  await itemDisplay.getByRole("button", { name: visibleAncestor.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${visibleAncestor.id}$`));
  await expect(middleTitle).toHaveText(visibleAncestor.title);

  await page.goto(`/life-links/${parent.id}`);
  await currentPath.getByRole("button", { name: "Expand full path", exact: true }).click();
  await currentDisplay.getByRole("button", { name: visibleAncestor.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${visibleAncestor.id}$`));
  await expectCompactBreadcrumbs(currentPath, state.deepAncestors.slice(-3, -1).map((ancestor) => ancestor.title));
  await currentPath.getByRole("button", { name: "Expand full path", exact: true }).click();
  const hiddenAncestor = state.deepAncestors[1];
  await currentDisplay.getByRole("button", { name: hiddenAncestor.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${hiddenAncestor.id}$`));
  await expect(middleTitle).toHaveText(hiddenAncestor.title);
  await currentPath.getByRole("button", { name: "My Life Links", exact: true }).click();
  await expect(page).toHaveURL(/\/life-links$/);
  await expect(page.locator(`[data-life-link-id="${state.deepAncestors[0].id}"]`)).toBeVisible();
  expect(writes).toEqual([]);
});

test("Field Ledger keeps borderline breadcrumb buttons within two lines when Details opens", async ({ baseURL, page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 665, height: 791 });
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174", {
    withDeepAncestry: ["Basement", "Storage wall", "Black Tub 06 / Cycling and Repairs", "Bike Repair Kit"]
  });
  await page.goto(`/life-links/${state.deepAncestors.at(-1)!.id}`);
  const currentPath = page.getByRole("navigation", { name: "Current layer", exact: true });
  await expectBreadcrumbsWithinTwoLines(currentPath);
  await expect(currentPath.locator(".ll-breadcrumbs-display").getByText("Bike Repair Kit", { exact: true })).toBeVisible();
  await page.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  if (!isMobile) await expectBreadcrumbsWithinTwoLines(currentPath);
  await expectBreadcrumbsWithinTwoLines(page.getByRole("navigation", { name: "Item location", exact: true }));
});

for (const ancestryLimit of [3, 1]) {
  test(`Field Ledger places the bounded breadcrumb gap truthfully with ${ancestryLimit} known nodes`, async ({ baseURL, page, isMobile }) => {
    if (!isMobile) await page.setViewportSize({ width: 665, height: 791 });
    const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174", {
      withDeepAncestry: ["Basement", "Storage wall", "Middle shelf", "Gear box"], ancestryLimit
    });
    await page.goto(`/life-links/${state.deepAncestors.at(-1)!.id}`);
    const currentPath = page.getByRole("navigation", { name: "Current layer", exact: true });
    const currentDisplay = currentPath.locator(".ll-breadcrumbs-display");
    await expectBreadcrumbsWithinTwoLines(currentPath);
    if (await currentPath.getByRole("button", { name: "Expand full path", exact: true }).count()) {
      await currentPath.getByRole("button", { name: "Expand full path", exact: true }).click();
    }
    await expect(currentDisplay).toHaveText(new RegExp(ancestryLimit === 3
      ? "^My Life Links(?:Collapse all)? › Basement › … › Middle shelf › Gear box$"
      : "^My Life Links(?:Collapse all)? › … › Gear box$"));
    const currentGap = currentDisplay.locator('[aria-label="Earlier folders unavailable"]');
    await expect(currentGap).toBeVisible();
    expect(await currentGap.evaluate((element) => element.tagName)).toBe("SPAN");
    await expect(currentDisplay.getByRole("button", { name: "Storage wall", exact: true })).toHaveCount(0);
    if (await currentPath.getByRole("button", { name: "Collapse full path", exact: true }).count()) {
      await currentPath.getByRole("button", { name: "Collapse full path", exact: true }).click();
    }
    await expectBreadcrumbsWithinTwoLines(currentPath);
    await page.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
    const itemPath = page.getByRole("navigation", { name: "Item location", exact: true });
    const itemDisplay = itemPath.locator(".ll-breadcrumbs-display");
    await expectBreadcrumbsWithinTwoLines(itemPath);
    if (await itemPath.getByRole("button", { name: "Expand full path", exact: true }).count()) {
      await itemPath.getByRole("button", { name: "Expand full path", exact: true }).click();
    }
    await expect(itemDisplay).toHaveText(new RegExp(ancestryLimit === 3
      ? `^My Life Links(?:Collapse all)? › Basement › … › Gear box › ${state.lifeLink.title}$`
      : `^My Life Links(?:Collapse all)? › … › ${state.lifeLink.title}$`));
    const itemGap = itemDisplay.locator('[aria-label="Earlier folders unavailable"]');
    await expect(itemGap).toBeVisible();
    expect(await itemGap.evaluate((element) => element.tagName)).toBe("SPAN");
    await expect(itemDisplay.getByRole("button", { name: "Storage wall", exact: true })).toHaveCount(0);
    await expect(itemDisplay.getByRole("button", { name: "Middle shelf", exact: true })).toHaveCount(0);
    if (await itemPath.getByRole("button", { name: "Collapse full path", exact: true }).count()) {
      await itemPath.getByRole("button", { name: "Collapse full path", exact: true }).click();
    }
    await expectBreadcrumbsWithinTwoLines(itemPath);
  });
}

test("Field Ledger collapses and expands Collection Sections without changing selection or Locations", async ({ baseURL, page, isMobile }) => {
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174", { withCollectionSections: true });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.goto("/collections");
  const bulkToggle = page.getByRole("button", { name: /^(Collapse|Expand) all$/ });
  await expect(bulkToggle).toHaveCount(0);
  await page.locator(".ll-collection-index-row").filter({ hasText: state.collection!.title }).click();
  const middle = page.getByRole("main", { name: "Collections", exact: true });
  const sectionGroups = state.sections.map((section) => middle.locator(`#collection-section-${section.id}`));
  const unsectioned = middle.locator("#collection-section-__unsectioned");
  const groups = [...sectionGroups, unsectioned];
  const groupToggle = (group: Locator) => group.locator(".ll-group-heading > button:first-child");
  await expect(bulkToggle).toHaveText("Collapse all");
  for (const group of groups) await expect(groupToggle(group)).toHaveAttribute("aria-expanded", "true");

  await unsectioned.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  const selectedDetail = page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`);
  await expect(selectedDetail).toBeVisible();
  const selectedUrl = page.url();
  if (isMobile) await page.getByRole("button", { name: "Back", exact: true }).click();

  await middle.getByRole("button", { name: "Locations", exact: true }).click();
  await expect(bulkToggle).toHaveCount(0);
  const location = middle.locator(`#collection-section-${state.lifeLink.id}`);
  await expect(groupToggle(location)).toHaveAttribute("aria-expanded", "true");
  await groupToggle(location).click();
  await expect(groupToggle(location)).toHaveAttribute("aria-expanded", "false");
  await middle.getByRole("button", { name: "All items", exact: true }).click();
  await expect(bulkToggle).toHaveCount(0);
  await expect(middle.locator(".ll-member-row")).toHaveCount(1);
  await middle.getByRole("button", { name: "Sections", exact: true }).click();

  // A mixed set still offers Collapse all, including when only Unsectioned is open.
  await groupToggle(sectionGroups[0]).click();
  await expect(groupToggle(sectionGroups[0])).toHaveAttribute("aria-expanded", "false");
  await expect(groupToggle(sectionGroups[1])).toHaveAttribute("aria-expanded", "true");
  await expect(groupToggle(unsectioned)).toHaveAttribute("aria-expanded", "true");
  await expect(bulkToggle).toHaveText("Collapse all");
  await bulkToggle.click();
  for (const group of groups) await expect(groupToggle(group)).toHaveAttribute("aria-expanded", "false");
  await expect(middle.locator(".ll-member-row")).toHaveCount(0);
  await expect(bulkToggle).toHaveText("Expand all");
  await groupToggle(unsectioned).click();
  await expect(unsectioned.locator(`[data-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await expect(bulkToggle).toHaveText("Collapse all");
  await bulkToggle.click();
  await expect(bulkToggle).toHaveText("Expand all");
  await bulkToggle.click();
  for (const group of groups) await expect(groupToggle(group)).toHaveAttribute("aria-expanded", "true");
  await expect(sectionGroups[0]).toContainText("No items in this section.");
  await expect(sectionGroups[1]).toContainText("No items in this section.");
  await expect(unsectioned.locator(`[data-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await expect(middle.locator(".ll-subtitle")).toHaveText("1 unique members · 2 sections");
  await expect(page).toHaveURL(selectedUrl);
  if (isMobile) await expect(page.locator(".ll-details")).toBeHidden();
  else await expect(selectedDetail).toBeVisible();

  await middle.getByRole("button", { name: "Locations", exact: true }).click();
  await expect(bulkToggle).toHaveCount(0);
  await expect(groupToggle(location)).toHaveAttribute("aria-expanded", "false");
  await middle.getByRole("button", { name: "Sections", exact: true }).click();
  if (isMobile) await unsectioned.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  await expect(selectedDetail).toBeVisible();
  await expect(selectedDetail.locator(".ll-section-tags")).toHaveText("Unsectioned");
  expect(writes).toEqual([]);
});

test("Field Ledger uploads, reads, downloads and removes private attachments without changing the selected item", async ({ baseURL, page, isMobile }, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 665, height: 791 });
  const state = await mockLifeLinksApi(page, baseURL ?? "http://127.0.0.1:4174");
  const makeAttachment = (id: string, fileName: string, kind: LifeLinkMediaRecord["kind"], mimeType: string): LifeLinkMediaRecord => ({
    id, fileName, kind, mimeType, lifeLinkId: state.lifeLink.id, ownerId: owner.id,
    sizeBytes: 1024, createdAt: state.lifeLink.createdAt, url: `/api/life-links/${state.lifeLink.id}/media/${id}`
  });
  const guide = makeAttachment("attachment-guide", "Family camping equipment assembly and maintenance guide.docx", "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const scan = makeAttachment("attachment-scan", "Scanned manual.pdf", "document", "application/pdf");
  const photo = makeAttachment("attachment-photo", "Equipment photo.gif", "image", "image/gif");
  const video = makeAttachment("attachment-video", "Assembly video.mp4", "video", "video/mp4");
  state.lifeLink.media = [guide, scan, photo, video];
  const uploadQueue = [makeAttachment("attachment-notes", "Repair notes.txt", "document", "text/plain"), makeAttachment("attachment-json", "Spare parts.json", "document", "application/json")];
  const writes: string[] = [];
  const reads: Array<{ mediaId: string; offset: number; revision: string | null }> = [];
  const firstText = "Packing guide\n<script>window.attachmentScriptRan = true</script>\nCamp cookware: ";
  const lastText = "stove, pan, and mugs.\n雪 / family notes";
  const revision = "a".repeat(64);
  const syncMedia = () => {
    state.link.media = state.lifeLink.media.map(({ lifeLinkId: _lifeLinkId, ...media }) => ({ ...media, qrId: state.link.id }));
  };
  syncMedia();
  await page.route(new RegExp(`/api/life-links/${state.lifeLink.id}/media(?:/[^/?]+)?(?:/content)?(?:\\?|$)`), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const mediaId = url.pathname.split("/")[5];
    if (request.method() === "POST") {
      const attachment = uploadQueue.shift()!;
      expect(request.postDataBuffer()!.toString("utf8")).toContain(`filename="${attachment.fileName}"`);
      writes.push(`upload:${attachment.id}`);
      state.lifeLink.media.push(attachment);
      syncMedia();
      await route.fulfill({ status: 201, json: { media: attachment } });
      return;
    }
    if (request.method() === "DELETE") {
      writes.push(`delete:${mediaId}`);
      state.lifeLink.media = state.lifeLink.media.filter((media) => media.id !== mediaId);
      syncMedia();
      await route.fulfill({ status: 204 });
      return;
    }
    const attachment = state.lifeLink.media.find((media) => media.id === mediaId)!;
    if (url.pathname.endsWith("/content")) {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      reads.push({ mediaId, offset, revision: url.searchParams.get("revision") });
      const scanned = mediaId === scan.id;
      await route.fulfill({ json: {
        mediaId, revision, status: scanned ? "unreadable" : "ready", reason: scanned ? "scanned_or_no_text" : null,
        format: scanned ? "pdf" : "docx", text: scanned ? "" : offset ? lastText : firstText,
        offset, nextOffset: scanned || offset ? null : firstText.length, totalChars: scanned ? 0 : firstText.length + lastText.length,
        warnings: scanned ? [] : ["Document formatting is simplified."]
      } satisfies AttachmentContentPage });
      return;
    }
    await route.fulfill({ contentType: attachment.mimeType, headers: { "Content-Disposition": `${attachment.kind === "document" ? "attachment" : "inline"}; filename="${attachment.fileName}"` }, body: attachment.kind === "image" ? Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64") : Buffer.from("Synthetic attachment bytes") });
  });

  await page.goto("/life-links");
  await openOwnerLifeLink(page, state);
  const selectedUrl = page.url();
  const selectedDetail = page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`);
  const attachments = selectedDetail.getByRole("region", { name: "Attachments", exact: true });
  const guideCard = attachments.locator(`[data-attachment-id="${guide.id}"]`);
  await expect(attachments.getByRole("heading", { name: "Attachments", exact: true })).toBeVisible();
  await expect(attachments).toContainText("Attachments stay private.");
  await expect(guideCard.getByText(guide.fileName, { exact: true })).toBeVisible();
  await expect(guideCard.locator("video, iframe, object")).toHaveCount(0);
  await expect(attachments.getByRole("img", { name: photo.fileName, exact: true })).toBeVisible();
  await expect(attachments.locator("video")).toHaveAttribute("controls", "");
  const downloadLink = guideCard.getByRole("link", { name: `Download ${guide.fileName}`, exact: true });
  await expect(downloadLink).toHaveAttribute("href", guide.url);
  await expect(downloadLink).toHaveAttribute("download", guide.fileName);
  // Completed download bytes are checked against the real API in fieldLedgerAgentJourney;
  // Chromium's native download request does not pass through this page's mock routes.

  await guideCard.getByRole("button", { name: `Read text from ${guide.fileName}`, exact: true }).click();
  const textRegion = guideCard.getByRole("region", { name: `Text from ${guide.fileName}`, exact: true });
  await expect(textRegion.locator("pre")).toHaveText(firstText);
  await expect(textRegion).toContainText("Document formatting is simplified.");
  await guideCard.getByRole("button", { name: `Load more text from ${guide.fileName}`, exact: true }).click();
  await expect(textRegion.locator("pre")).toHaveText(firstText + lastText);
  await expect(guideCard.getByRole("button", { name: /Load more text/ })).toHaveCount(0);
  await expect(textRegion.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => "attachmentScriptRan" in window)).toBe(false);
  expect(reads).toEqual([{ mediaId: guide.id, offset: 0, revision: null }, { mediaId: guide.id, offset: firstText.length, revision }]);
  expect(writes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("attachments-read-text.png"), animations: "disabled" });
  await guideCard.getByRole("button", { name: `Hide text from ${guide.fileName}`, exact: true }).click();
  await expect(textRegion).toHaveCount(0);
  await guideCard.getByRole("button", { name: `Read text from ${guide.fileName}`, exact: true }).click();
  await expect(textRegion.locator("pre")).toHaveText(firstText + lastText);
  expect(reads).toHaveLength(2);
  await attachments.getByRole("button", { name: `Read text from ${scan.fileName}`, exact: true }).click();
  await expect(attachments.getByRole("region", { name: `Text from ${scan.fileName}`, exact: true })).toContainText("No readable text was found.");
  await expect(attachments).toContainText("OCR is not available.");
  await expect(page).toHaveURL(selectedUrl);

  const acceptedFiles = "image/*,video/*,.pdf,.docx,.xlsx,.txt,.csv,.md,.markdown,.json";
  await expect(page.locator('input[type="file"][aria-label="Add attachments"]')).toHaveAttribute("accept", acceptedFiles);
  await page.getByRole("button", { name: `Actions for ${state.lifeLink.title}`, exact: true }).click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Add attachment", exact: true }).click();
  await (await fileChooser).setFiles({ name: "Repair notes.txt", mimeType: "text/plain", buffer: Buffer.from("Owner-entered repair notes") });
  await expect(attachments.locator('[data-attachment-id="attachment-notes"]')).toBeVisible();
  await expect(page).toHaveURL(selectedUrl);

  await openRecordEditor(page, state);
  const editor = page.getByRole("dialog", { name: "Edit Life Link", exact: true });
  await expect(editor.getByLabel("Add attachments", { exact: true })).toHaveAttribute("accept", acceptedFiles);
  await editor.getByLabel("Add attachments", { exact: true }).setInputFiles({ name: "Spare parts.json", mimeType: "application/json", buffer: Buffer.from('{"spares":["seal"]}') });
  await expect(editor.locator('[data-attachment-id="attachment-json"]')).toBeVisible();
  await editor.getByRole("button", { name: "Remove Spare parts.json", exact: true }).click();
  await expect(editor.locator('[data-attachment-id="attachment-json"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(selectedDetail).toBeVisible();
  await expect(page).toHaveURL(selectedUrl);
  await expect(attachments.getByRole("img", { name: photo.fileName, exact: true })).toBeVisible();
  expect(state.lifeLink.media.map((media) => media.id)).toEqual([guide.id, scan.id, photo.id, video.id, "attachment-notes"]);
  expect(writes).toEqual(["upload:attachment-notes", "upload:attachment-json", "delete:attachment-json"]);
  expect(state.lastCanonicalPatch).toBeNull();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("Field Ledger previews bulk hierarchy changes and shares Undo across panels", async ({ baseURL, page, isMobile }, testInfo) => {
  if (!isMobile) await page.setViewportSize({ width: 665, height: 791 });
  const state = await mockBulkChangesApi(page, baseURL ?? "http://127.0.0.1:4174");
  await page.goto("/life-links");
  const hierarchy = page.getByRole("main", { name: "Hierarchies", exact: true });
  const hierarchyUndo = hierarchy.getByRole("button", { name: "Undo last saved change", exact: true });
  const toolbar = hierarchy.getByRole("toolbar", { name: "Edit hierarchy", exact: true });
  const warning = "Only your last 5 saved changes can be undone. A bulk action counts as one change.";
  const rootRow = hierarchy.locator(`[data-life-link-id="${folder.id}"]`);
  const itemRow = hierarchy.locator(`[data-life-link-id="${state.lifeLink.id}"]`);
  const startEditing = async () => {
    await hierarchy.getByRole("button", { name: "Add to My Life Links", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await expect(toolbar).toBeVisible();
  };
  const chooseDestination = async () => {
    await toolbar.getByRole("button", { name: "Move", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Move selected Life Links", exact: true });
    await picker.getByRole("button", { name: state.destination.title, exact: true }).click();
    await picker.getByRole("button", { name: "Choose this folder", exact: true }).click();
    return page.getByRole("dialog", { name: "Confirm move", exact: true });
  };

  await expect(hierarchyUndo).toBeDisabled();
  await expect(itemRow).toHaveCount(0); // Normal browsing still shows direct children only.
  await startEditing();
  await expect(toolbar).toContainText("0 selected");
  await expect(hierarchy.getByText(warning, { exact: true })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
  await hierarchy.getByRole("button", { name: `Expand folder ${folder.name}`, exact: true }).click();
  await expect(itemRow).toBeVisible();
  await expect(toolbar).toContainText("0 selected");
  await expect(hierarchy.getByRole("checkbox", { name: `Select ${folder.name}`, exact: true })).not.toBeChecked();
  await hierarchy.getByRole("checkbox", { name: `Select ${folder.name}`, exact: true }).check();
  await hierarchy.getByRole("checkbox", { name: `Select ${state.lifeLink.title}`, exact: true }).check();
  await expect(toolbar).toContainText("2 selected");
  for (const title of [folder.name, state.lifeLink.title]) {
    const dot = hierarchy.getByRole("checkbox", { name: `Select ${title}`, exact: true });
    await expect(dot).toBeChecked();
    await expect(dot).toHaveCSS("width", "20px");
    await expect(dot).toHaveCSS("height", "20px");
  }
  await testInfo.attach("hierarchy-edit", { body: await page.screenshot({ path: testInfo.outputPath("hierarchy-edit.png"), animations: "disabled" }), contentType: "image/png" });

  await toolbar.getByRole("button", { name: "Delete", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Confirm deletion", exact: true });
  const deletionItems = deletion.getByRole("list", { name: "Life Links to delete", exact: true });
  await expect(deletionItems.getByRole("listitem")).toHaveCount(2);
  await expect(deletionItems).toContainText(folder.name);
  await expect(deletionItems).toContainText(state.lifeLink.title);
  await expect(deletion).toContainText("1 selected root · 2 Life Links in total");
  await expect(deletion.getByText(warning, { exact: true })).toBeVisible();
  expect(state.appliedPreviewIds).toEqual([]);
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(toolbar).toContainText("2 selected");
  expect(state.appliedPreviewIds).toEqual([]);

  let move = await chooseDestination();
  await expect(move.getByRole("list", { name: "Life Links to move", exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(move).toContainText(state.destination.title);
  await move.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(move).toBeHidden();
  expect(state.appliedPreviewIds).toEqual([]);
  expect(state.records.get(folder.id)?.parentId).toBeNull();
  move = await chooseDestination();
  await expect(move).toBeVisible();
  await testInfo.attach("move-confirmation", { body: await page.screenshot({ path: testInfo.outputPath("move-confirmation.png"), animations: "disabled" }), contentType: "image/png" });
  const movePreview = state.previews.at(-1)!;
  expect(movePreview.rootIds).toEqual([folder.id]);
  await move.getByRole("button", { name: "Move to folder", exact: true }).click();
  await expect(move).toBeHidden();
  await expect(toolbar).toHaveCount(0);
  await expect(rootRow).toHaveCount(0);
  expect(state.appliedPreviewIds).toEqual([movePreview.id]);
  expect(state.history.entries).toHaveLength(1);
  expect(state.records.get(folder.id)?.parentId).toBe(state.destination.id);
  expect(state.records.get(state.lifeLink.id)?.parentId).toBe(folder.id);

  await hierarchy.locator(`[data-life-link-id="${state.destination.id}"]`).click();
  await rootRow.click();
  await itemRow.click();
  const details = page.getByRole("complementary", { name: "Details", exact: true });
  const detailUndo = details.getByRole("button", { name: "Undo last saved change", exact: true });
  await expect(details.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await expect(detailUndo).toBeEnabled();
  await expect(detailUndo).toHaveAttribute("title", `Undo ${state.history.entries[0].label}. ${warning}`);
  await page.route("**/api/change-history/undo", async (route) => {
    await route.fulfill({ status: 503, json: { error: { code: "temporarily_unavailable", message: "Undo is temporarily unavailable. Try again.", retryable: true } } });
  }, { times: 1 });
  await detailUndo.click();
  await expect(details.getByRole("alert")).toHaveText("Undo is temporarily unavailable. Try again.");
  await expect(detailUndo).toBeEnabled();
  expect(state.undoChangeIds).toEqual([]);
  await detailUndo.click();
  await expect(detailUndo).toBeDisabled();
  await expect(details.getByRole("alert")).toHaveCount(0);
  await expect(details.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
  await expect(details.getByRole("navigation", { name: "Item location", exact: true })).not.toContainText(state.destination.title);
  expect(state.undoChangeIds).toHaveLength(1);
  expect(state.records.get(folder.id)?.parentId).toBeNull();
  if (isMobile) await details.getByRole("button", { name: "Back", exact: true }).click();
  await expect(hierarchyUndo).toBeDisabled();

  // A selected folder includes its descendants even when the edit tree is closed.
  await hierarchy.getByRole("navigation", { name: "Current layer", exact: true }).getByRole("button", { name: "My Life Links", exact: true }).click();
  await startEditing();
  const collapseFolder = hierarchy.getByRole("button", { name: `Collapse folder ${folder.name}`, exact: true });
  if (await collapseFolder.isVisible()) await collapseFolder.click();
  await expect(itemRow).toHaveCount(0);
  await hierarchy.getByRole("checkbox", { name: `Select ${folder.name}`, exact: true }).check();
  await toolbar.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(deletionItems.getByRole("listitem")).toHaveCount(2);
  const deletePreview = state.previews.at(-1)!;
  await deletion.getByRole("button", { name: "Delete Life Links", exact: true }).click();
  await expect(deletion).toBeHidden();
  await expect(rootRow).toHaveCount(0);
  expect(state.appliedPreviewIds).toEqual([movePreview.id, deletePreview.id]);
  expect(state.records.has(state.lifeLink.id)).toBe(false);
  expect(state.history.entries).toHaveLength(1);
  await expect(hierarchyUndo).toBeEnabled();
  await hierarchyUndo.click();
  await expect(hierarchyUndo).toBeDisabled();
  await expect(rootRow).toBeVisible();
  expect(state.records.get(state.lifeLink.id)?.parentId).toBe(folder.id);
  expect(state.undoChangeIds).toHaveLength(2);
  expect(state.history.entries).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

type MockLifeLinksState = {
  link: LinkRecord;
  lifeLink: LifeLinkRecord;
  deepAncestors: LifeLinkRecord[];
  collection: CollectionRecord | null;
  sections: CollectionSectionRecord[];
  lastCanonicalPatch: Partial<LifeLinkRecord> | null;
  lastCanonicalExpectedUpdatedAt: string | null;
};

async function mockLifeLinksApi(
  page: Page,
  baseURL: string,
  options: { publicTitle?: string; withCollectionSections?: boolean; withDeepAncestry?: boolean | string[]; ancestryLimit?: number } = {}
): Promise<MockLifeLinksState> {
  const now = "2026-05-07T12:00:00.000Z";
  const state: MockLifeLinksState = {
    link: {
      id: "LL-RICH-00001",
      url: new URL("/qr/LL-RICH-00001", baseURL).toString(),
      status: "claimed",
      ownerId: owner.id,
      title: "Rich body field test",
      body: "Plain starting body",
      bodyDoc: createLinkBodyDocFromPlainText("Plain starting body"),
      bodyDocVersion: 1,
      privacy: "public",
      media: [],
      createdAt: now,
      updatedAt: now
    },
    lifeLink: {
      id: "life-link-rich",
      ownerId: owner.id,
      parentId: folder.id,
      qrId: "LL-RICH-00001",
      title: "Rich body field test",
      body: "Plain starting body",
      bodyDoc: createLinkBodyDocFromPlainText("Plain starting body"),
      bodyDocVersion: 1,
      privacy: "public",
      browsingRole: "item",
      context: { schemaVersion: 1 },
      placementConfirmedAt: now,
      publicFieldKeys: ["notes"],
      media: [],
      createdAt: now,
      updatedAt: now
    },
    deepAncestors: [],
    collection: options.withCollectionSections ? {
      id: "collection-00000000-0000-4000-8000-000000000001", ownerId: owner.id,
      title: "Family packing", purpose: "", notes: "", createdAt: now, updatedAt: now
    } : null,
    sections: [],
    lastCanonicalPatch: null,
    lastCanonicalExpectedUpdatedAt: null
  };
  if (state.collection) {
    state.sections = ["Sleeping gear", "Next trip"].map((title, position) => ({
      id: `section-00000000-0000-4000-8000-00000000000${position + 1}`,
      ownerId: owner.id, collectionId: state.collection!.id, title, position, createdAt: now, updatedAt: now
    }));
  }
  const membershipsFor = (lifeLinkId: string): LifeLinkCollectionMembership[] => state.collection && lifeLinkId === state.lifeLink.id
    ? [{ collection: state.collection, sections: [] }]
    : [];

  await page.route("**/api/config", async (route) => {
    await route.fulfill({ json: { qrBaseUrl: baseURL, maxBatchCount: 10000 } });
  });
  await page.route("**/api/me", async (route) => {
    await route.fulfill({ json: { user: owner, qrBaseUrl: baseURL, agentConnection: { connected: true, connectedAt: now } } });
  });
  await page.route("**/api/links", async (route) => {
    await route.fulfill({ json: { links: [state.link] } });
  });
  await page.route("**/api/change-history", async (route) => {
    await route.fulfill({ json: { limit: 5, entries: [] } satisfies ChangeHistory });
  });
  await page.route("**/api/life-links?*", async (route) => {
    const parentId = new URL(route.request().url()).searchParams.get("parentId");
    await route.fulfill({
      json: {
        lifeLinks: parentId === folder.id ? [canonicalSummary(state.lifeLink, 0)] : [folderRootSummary()],
        nextCursor: null,
        truncated: false
      }
    });
  });
  await page.route("**/api/life-links/search?*", async (route) => {
    await route.fulfill({
      json: {
        results: [{
          lifeLink: canonicalSummary(state.lifeLink, 0),
          path: {
            items: [folderRootSummary(), canonicalSummary(state.lifeLink, 0)],
            truncated: false,
            omittedCount: 0
          },
          bodySummary: state.lifeLink.body,
          matchClass: "exact_qr"
        }],
        totalCount: 1,
        truncated: false,
        hasMore: false,
        nextCursor: null
      }
    });
  });
  await page.route("**/api/life-links/life-link-rich*", async (route) => {
    if (route.request().method() === "PATCH") {
      const request = route.request().postDataJSON() as Partial<LifeLinkRecord> & { expectedUpdatedAt?: string };
      const { expectedUpdatedAt, ...patch } = request;
      state.lastCanonicalExpectedUpdatedAt = expectedUpdatedAt ?? null;
      state.lastCanonicalPatch = patch;
      if (expectedUpdatedAt !== state.lifeLink.updatedAt) {
        await route.fulfill({ status: 409, json: { error: { code: "stale_life_link", message: "Life Link changed after it was read.", retryable: true } } });
        return;
      }
      state.lifeLink = {
        ...state.lifeLink,
        ...patch,
        bodyDoc: patch.bodyDoc ?? state.lifeLink.bodyDoc,
        bodyDocVersion: patch.bodyDocVersion ?? state.lifeLink.bodyDocVersion,
        updatedAt: new Date(Date.parse(state.lifeLink.updatedAt) + 1000).toISOString()
      };
      state.link = {
        ...state.link,
        title: state.lifeLink.title,
        body: state.lifeLink.body,
        bodyDoc: state.lifeLink.bodyDoc,
        bodyDocVersion: state.lifeLink.bodyDocVersion,
        privacy: state.lifeLink.privacy,
        updatedAt: state.lifeLink.updatedAt
      };
      await route.fulfill({ json: { lifeLink: state.lifeLink } });
      return;
    }
    await route.fulfill({ json: { detail: canonicalDetail(state.lifeLink, membershipsFor(state.lifeLink.id)) } });
  });
  await page.route(`**/api/life-links/${folder.id}*`, async (route) => {
    const root: LifeLinkRecord = {
      ...state.lifeLink, id: folder.id, title: folder.name, parentId: null, qrId: null,
      body: "", bodyDoc: createLinkBodyDocFromPlainText(""), privacy: "private", browsingRole: "container",
      context: { schemaVersion: 1 }, publicFieldKeys: [], placementConfirmedAt: null,
      createdAt: folder.createdAt, updatedAt: folder.createdAt
    };
    await route.fulfill({ json: { detail: {
      lifeLink: root, ancestry: { items: [folderRootSummary()], truncated: false, omittedCount: 0 },
      children: [canonicalSummary(state.lifeLink, 0)], childrenPage: { nextCursor: null, truncated: false },
      collectionMemberships: membershipsFor(folder.id), collectionMembershipsPage: { nextCursor: null, truncated: false }
    } } });
  });
  await page.route(/\/api\/life-links\/[^/]+\/collection-memberships(?:\?|$)/, async (route) => {
    const lifeLinkId = new URL(route.request().url()).pathname.split("/")[3];
    await route.fulfill({ json: { memberships: membershipsFor(lifeLinkId), nextCursor: null, truncated: false } });
  });
  await page.route(/\/api\/collections(?:\?|$)/, async (route) => {
    await route.fulfill({ json: { collections: state.collection ? [state.collection] : [], nextCursor: null, truncated: false } });
  });
  if (state.collection) {
    await page.route(new RegExp(`/api/collections/${state.collection.id}(?:\\?|$)`), async (route) => {
      await route.fulfill({ json: { collection: state.collection, sections: state.sections, sectionsPage: { nextCursor: null, truncated: false } } });
    });
    await page.route(new RegExp(`/api/collections/${state.collection.id}/members(?:\\?|$)`), async (route) => {
      await route.fulfill({ json: { lifeLinks: [state.lifeLink], nextCursor: null, truncated: false } });
    });
  }
  await page.route("**/api/qr/LL-RICH-00001", async (route) => {
    await route.fulfill({
      json: {
        state: "claimed",
        link: options.publicTitle ? { ...state.link, title: options.publicTitle } : state.link,
        viewerIsOwner: true
      }
    });
  });
  if (options.withDeepAncestry) {
    const titles = Array.isArray(options.withDeepAncestry) ? options.withDeepAncestry : [
      "Household seasonal equipment storage", "Basement outdoor recreation supplies",
      "North basement wall storage area", "Outdoor recreation equipment shelving",
      "Family camping supplies upper shelf", "Blue weatherproof camping equipment bin"
    ];
    state.deepAncestors = titles.map((title, index) => ({
      ...state.lifeLink, id: `life-link-deep-${index + 1}`, title,
      parentId: index === 0 ? null : `life-link-deep-${index}`, qrId: null,
      browsingRole: "container", privacy: "private", body: "", bodyDoc: createLinkBodyDocFromPlainText(""), publicFieldKeys: []
    }));
    state.lifeLink.parentId = state.deepAncestors.at(-1)!.id;
    const records = [...state.deepAncestors, state.lifeLink];
    const childrenOf = (parentId: string | null) => records.filter((record) => record.parentId === parentId);
    const summaryOf = (record: LifeLinkRecord) => canonicalSummary(record, childrenOf(record.id).length);
    await page.route("**/api/life-links?*", async (route) => {
      const parentId = new URL(route.request().url()).searchParams.get("parentId");
      await route.fulfill({ json: { lifeLinks: childrenOf(parentId).map(summaryOf), nextCursor: null, truncated: false } });
    });
    for (const record of records) {
      await page.route(new RegExp(`/api/life-links/${record.id}(?:\\?|$)`), async (route) => {
        if (route.request().method() !== "GET") { await route.fallback(); return; }
        const detail: LifeLinkDetail = {
          lifeLink: record,
          ancestry: deriveLifeLinkPath(records, record.id, options.ancestryLimit),
          children: childrenOf(record.id).map(summaryOf), childrenPage: { nextCursor: null, truncated: false }
        };
        await route.fulfill({ json: { detail: {
          ...detail, collectionMemberships: membershipsFor(record.id), collectionMembershipsPage: { nextCursor: null, truncated: false }
        } } });
      });
    }
  }

  return state;
}

/** Stateful owner boundary for the bulk UI; production core resolves the full selection closure. */
async function mockBulkChangesApi(page: Page, baseURL: string) {
  const base = await mockLifeLinksApi(page, baseURL);
  const root: LifeLinkRecord = {
    ...base.lifeLink, id: folder.id, title: folder.name, parentId: null, qrId: null,
    browsingRole: "container", privacy: "private", body: "", bodyDoc: createLinkBodyDocFromPlainText(""), publicFieldKeys: []
  };
  const destination: LifeLinkRecord = { ...root, id: "life-link-destination", title: "Ready shelf" };
  const state = {
    ...base, destination,
    records: new Map([root, base.lifeLink, destination].map((record) => [record.id, record])),
    previews: [] as LifeLinkChangePreview[],
    appliedPreviewIds: [] as string[],
    undoChangeIds: [] as string[],
    history: { limit: 5, entries: [] } as ChangeHistory
  };
  const savedRecords = new Map<string, LifeLinkRecord[]>();
  const rows = () => [...state.records.values()];
  const childrenOf = (parentId: string | null) => rows().filter((record) => record.parentId === parentId);
  const summaryOf = (record: LifeLinkRecord) => canonicalSummary(record, childrenOf(record.id).length);
  const previewPage = (preview: LifeLinkChangePreview) => ({ preview: { ...preview, nextCursor: null, totalItems: preview.items.length } });
  await page.route("**/api/links", async (route) => {
    await route.fulfill({ json: { links: state.records.has(base.lifeLink.id) ? [base.link] : [] } });
  });
  await page.route("**/api/life-links?*", async (route) => {
    const parentId = new URL(route.request().url()).searchParams.get("parentId");
    await route.fulfill({ json: { lifeLinks: childrenOf(parentId).map(summaryOf), nextCursor: null, truncated: false } });
  });
  for (const record of rows()) {
    await page.route(new RegExp(`/api/life-links/${record.id}(?:\\?|$)`), async (route) => {
      const current = state.records.get(record.id);
      if (!current) {
        await route.fulfill({ status: 404, json: { error: { code: "life_link_not_found", message: "Life Link not found.", retryable: false } } });
        return;
      }
      await route.fulfill({ json: { detail: {
        lifeLink: current, ancestry: deriveLifeLinkPath(rows(), current.id), children: childrenOf(current.id).map(summaryOf),
        childrenPage: { nextCursor: null, truncated: false }, collectionMemberships: [],
        collectionMembershipsPage: { nextCursor: null, truncated: false }
      } } });
    });
  }
  await page.route("**/api/change-history", async (route) => {
    await route.fulfill({ json: state.history });
  });
  await page.route("**/api/life-links/changes/preview", async (route) => {
    const input = route.request().postDataJSON() as PreviewLifeLinkChangeInput;
    const scope = resolveLifeLinkChangeScope(rows(), owner.id, input);
    const preview: LifeLinkChangePreview = {
      id: `preview-${state.previews.length + 1}`, operation: input.operation,
      rootIds: scope.rootIds, items: scope.items.map(lifeLinkChangePreviewItem), parentId: scope.parentId,
      target: scope.target ? lifeLinkChangePreviewItem(scope.target) : null,
      sideEffects: { lifeLinks: scope.items.length, media: 0,
        qrBindings: scope.items.filter((record) => record.qrId).length, collectionMemberships: 0, collectionSectionAssignments: 0 },
      createdAt: base.lifeLink.updatedAt
    };
    state.previews.push(preview);
    await route.fulfill({ json: previewPage(preview) });
  });
  await page.route(/\/api\/life-links\/changes\/preview-\d+(?:\?|$)/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({ json: previewPage(state.previews.find((preview) => preview.id === id)!) });
  });
  await page.route("**/api/life-links/changes/apply", async (route) => {
    const request = route.request().postDataJSON() as { previewId: string; commandId: string };
    expect(request.commandId).toBeTruthy();
    const preview = state.previews.find((item) => item.id === request.previewId)!;
    const changeId = `saved-${state.appliedPreviewIds.length + 1}`;
    savedRecords.set(changeId, structuredClone(rows()));
    if (preview.operation === "delete") preview.items.forEach((item) => state.records.delete(item.id));
    else preview.rootIds.forEach((id) => state.records.set(id, { ...state.records.get(id)!, parentId: preview.parentId }));
    state.appliedPreviewIds.push(preview.id);
    state.history.entries.unshift({ id: changeId, label: `${preview.operation === "delete" ? "Deleted" : "Moved"} ${preview.items.length} Life Links`, createdAt: preview.createdAt });
    await route.fulfill({ json: { operation: preview.operation, affectedIds: preview.items.map((item) => item.id), history: state.history } });
  });
  await page.route("**/api/change-history/undo", async (route) => {
    const request = route.request().postDataJSON() as { changeId: string; commandId: string };
    expect(request.commandId).toBeTruthy();
    expect(request.changeId).toBe(state.history.entries[0].id);
    const restored = savedRecords.get(request.changeId)!;
    state.records = new Map(restored.map((record) => [record.id, record]));
    state.history.entries.shift();
    state.undoChangeIds.push(request.changeId);
    await route.fulfill({ json: { operation: "undo", affectedIds: restored.map((record) => record.id), history: state.history } });
  });
  return state;
}

async function openOwnerLifeLink(page: Page, state: MockLifeLinksState) {
  await page.locator(`[data-life-link-id="${folder.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${folder.id}$`));
  await page.locator(`[data-life-link-id="${state.lifeLink.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/life-links/${state.lifeLink.id}$`));
  await expect(page.locator(`[data-selected-life-link-id="${state.lifeLink.id}"]`)).toBeVisible();
}

async function expectBreadcrumbsWithinTwoLines(breadcrumbs: Locator) {
  await expect(breadcrumbs).toBeVisible();
  await expect(breadcrumbs).toHaveCSS("height", "44px");
  const display = breadcrumbs.locator(".ll-breadcrumbs-display");
  // Width changes are reconciled by ResizeObserver after the panel state changes.
  await expect.poll(() => display.evaluate((element) => element.clientHeight)).toBeLessThanOrEqual(44);
  await expect.poll(() => display.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  await expect.poll(() => display.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
}

async function expectCompactBreadcrumbs(breadcrumbs: Locator, containingTitles: string[]) {
  const display = breadcrumbs.locator(".ll-breadcrumbs-display");
  const toggle = display.getByRole("button", { name: "Expand full path", exact: true });
  await expect(toggle).toHaveText("Expand all");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(display.locator(".ll-breadcrumb-tail").getByRole("button")).toHaveText(containingTitles);
  await expect(display.getByRole("button")).toHaveCount(containingTitles.length + 2);
  const root = display.getByRole("button", { name: "My Life Links", exact: true });
  await expect(root).toBeVisible();
  const ellipsis = display.locator(".ll-breadcrumb-root > span");
  await expect(ellipsis).toHaveText("…");
  await expect(display.getByRole("button", { name: "…", exact: true })).toHaveCount(0);
  await expectBreadcrumbsWithinTwoLines(breadcrumbs);
  const rootBox = await root.boundingBox();
  const toggleBox = await toggle.boundingBox();
  const displayBox = await display.boundingBox();
  expect(Math.abs(rootBox!.y - toggleBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(toggleBox!.x + toggleBox!.width - displayBox!.x - displayBox!.width)).toBeLessThanOrEqual(1);
}

async function expectInlineBreadcrumbExpansion(breadcrumbs: Locator, contentTitle: Locator, fullTitles: string[]) {
  const display = breadcrumbs.locator(".ll-breadcrumbs-display");
  const collapsedPath = await breadcrumbs.boundingBox();
  const collapsedTitle = await contentTitle.boundingBox();
  const expand = display.getByRole("button", { name: "Expand full path", exact: true });
  const toggleBefore = await expand.boundingBox();
  await expand.click();
  const collapse = display.getByRole("button", { name: "Collapse full path", exact: true });
  await expect(collapse).toHaveText("Collapse all");
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(display.locator("button:not(.ll-breadcrumb-toggle)")).toHaveText(fullTitles);
  for (const title of fullTitles) await expect(display.getByRole("button", { name: title, exact: true })).toBeEnabled();
  await expect.poll(async () => (await breadcrumbs.boundingBox())!.height).toBeGreaterThan(44);
  const expandedPath = await breadcrumbs.boundingBox();
  const expandedTitle = await contentTitle.boundingBox();
  expect(Math.abs(expandedTitle!.y - collapsedTitle!.y - (expandedPath!.height - collapsedPath!.height))).toBeLessThanOrEqual(2);
  const toggleAfter = await collapse.boundingBox();
  expect(Math.abs(toggleAfter!.y - toggleBefore!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(toggleAfter!.x + toggleAfter!.width - toggleBefore!.x - toggleBefore!.width)).toBeLessThanOrEqual(1);
  expect(await display.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await breadcrumbs.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await collapse.click();
  await expectBreadcrumbsWithinTwoLines(breadcrumbs);
  expect(Math.abs((await contentTitle.boundingBox())!.y - collapsedTitle!.y)).toBeLessThanOrEqual(2);
}

async function openRecordEditor(page: Page, state: MockLifeLinksState) {
  await page.getByRole("button", { name: `Actions for ${state.lifeLink.title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
}

async function openNavigationAction(page: Page, label: string) {
  await expect(page.locator(".ll-shell")).toBeVisible();
  const action = page.getByRole("button", { name: label, exact: true });
  if (!(await action.isVisible())) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await action.click();
}

function canonicalSummary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return summarizeLifeLink(lifeLink, childCount);
}

function folderRootSummary(): LifeLinkSummary {
  return {
    id: folder.id,
    parentId: null,
    qrId: null,
    title: folder.name,
    privacy: "private",
    browsingRole: "container",
    updatedAt: folder.createdAt,
    childCount: 1
  };
}

function canonicalDetail(lifeLink: LifeLinkRecord, memberships: LifeLinkCollectionMembership[] = []): LifeLinkDetail & { collectionMemberships: LifeLinkCollectionMembership[]; collectionMembershipsPage: { nextCursor: null; truncated: false } } {
  return {
    lifeLink,
    ancestry: {
      items: [folderRootSummary(), canonicalSummary(lifeLink, 0)],
      truncated: false,
      omittedCount: 0
    },
    children: [],
    childrenPage: { nextCursor: null, truncated: false },
    collectionMemberships: memberships, collectionMembershipsPage: { nextCursor: null, truncated: false }
  };
}

function hasNodeType(doc: LinkBodyDoc | null | undefined, type: string): boolean {
  return Boolean(
    doc?.content?.some((node) => {
      if (node.type === type) {
        return true;
      }
      return hasNodeType({ type: "doc", content: node.content }, type);
    })
  );
}

function hasMarkType(doc: LinkBodyDoc | null | undefined, type: string): boolean {
  return Boolean(
    doc?.content?.some((node) => {
      if (node.marks?.some((mark) => mark.type === type)) {
        return true;
      }
      return hasMarkType({ type: "doc", content: node.content }, type);
    })
  );
}

async function pasteHtml(locator: Locator, html: string) {
  await locator.evaluate((element, pastedHtml) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", pastedHtml);
    clipboardData.setData("text/plain", pastedHtml.replace(/<[^>]+>/g, " "));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, html);
}
