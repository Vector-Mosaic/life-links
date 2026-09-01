import { expect, test, type Locator, type Page } from "@playwright/test";

const workflowEnabled = process.env.LIFE_LINKS_E2E_MUTATION === "1";
const ownerEmail = workflowEnabled ? requireEnv("LIFE_LINKS_E2E_EMAIL") : "";
const ownerPassword = workflowEnabled ? requireEnv("LIFE_LINKS_E2E_PASSWORD") : "";

test.describe("persisted Field Ledger owner workflow", () => {
  test.skip(!workflowEnabled, "Set LIFE_LINKS_E2E_MUTATION=1 to allow workflow writes.");

  test("keeps one item across hierarchy, Collections, sections and explicit QR publication", async ({ baseURL, browser, page }, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    const suffix = uniqueSuffix(testInfo.project.name);
    const sourceName = `E2E Source ${suffix}`;
    const destinationName = `E2E Destination ${suffix}`;
    const itemName = `E2E Sleeping pad ${suffix}`;
    const unassignedName = `E2E Unassigned spare ${suffix}`;
    const collectionName = `E2E Camping ${suffix}`;
    const sectionName = `E2E Sleep section ${suffix}`;
    const secondSectionName = `E2E Next year ${suffix}`;
    const notes = `Private packing note ${suffix}`;
    const plan = `Published insulation upgrade ${suffix}`;
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await loginAsOwner(page);
    await expectNavigationGeometry(page);
    await createInLayer(page, "My Life Links", "New folder", sourceName);
    await expect(page.getByRole("heading", { name: sourceName, exact: true, level: 1 })).toBeVisible();
    await expect(page.locator(".ll-layout")).toHaveClass(/ll-details-collapsed/);
    await navigateTo(page, "My Life Links");
    await createInLayer(page, "My Life Links", "New folder", destinationName);
    await navigateTo(page, "My Life Links");

    const sourceRow = page.locator(".ll-hierarchy-row").filter({ hasText: sourceName });
    await revealPagedRecord(sourceRow, page.getByRole("button", { name: "Load more Life Links", exact: true }), page.locator(".ll-hierarchy-row"));
    const sourceId = await sourceRow.locator("button[data-life-link-id]").getAttribute("data-life-link-id");
    await sourceRow.locator("button[data-life-link-id]").click();
    await expect(page.locator(".ll-layout")).toHaveClass(/ll-details-collapsed/);
    await expect(page.getByRole("heading", { name: sourceName, exact: true, level: 1 })).toBeVisible();
    const add = page.getByRole("button", { name: `Add to ${sourceName}`, exact: true });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "New folder", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "New item", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(add).toBeFocused();

    await createInLayer(page, sourceName, "New item", unassignedName);
    await navigateTo(page, "My Life Links");
    await revealPagedRecord(sourceRow, page.getByRole("button", { name: "Load more Life Links", exact: true }), page.locator(".ll-hierarchy-row"));
    await sourceRow.locator("button[data-life-link-id]").click();
    await expect(page.locator(".ll-layout")).toHaveClass(/ll-details-collapsed/);
    await createInLayer(page, sourceName, "New item", itemName);
    const details = page.locator("[data-selected-life-link-id]");
    await expect(details.getByRole("heading", { name: itemName, exact: true })).toBeVisible();
    const lifeLinkId = await details.getAttribute("data-selected-life-link-id");
    expect(lifeLinkId).toMatch(/^life-link-/);
    await detailAction(page, itemName, "Edit");
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Notes", { exact: true }).fill(notes);
    await editor.getByLabel("Plan", { exact: true }).fill(plan);
    await editor.getByLabel("Plan source", { exact: true }).selectOption("planned");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(details.getByText(notes, { exact: true })).toBeVisible();
    await expect(details.getByText(plan, { exact: true })).toBeVisible();

    await navigateTo(page, "My Collections");
    await createInLayer(page, "My Collections", "New Collection", collectionName);
    await expect(page.getByRole("heading", { name: collectionName, exact: true })).toBeVisible();
    const collectionPath = new URL(page.url()).pathname;
    expect(collectionPath).toMatch(/^\/collections\/collection-/);
    await createInLayer(page, collectionName, "New section", sectionName);
    await createInLayer(page, collectionName, "New section", secondSectionName);
    await page.getByRole("button", { name: `Add to ${collectionName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Add Life Links", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Add Life Links", exact: true });
    await revealPagedRecord(picker.getByRole("button", { name: sourceName, exact: true }), picker.getByRole("button", { name: "Load more", exact: true }), picker.locator(".ll-picker-list > div"));
    await picker.getByRole("button", { name: `Add ${sourceName}`, exact: true }).click();
    await expect(picker.getByText("Already added", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: sourceName, exact: true }).click();
    await picker.getByRole("button", { name: itemName, exact: true }).click();
    await expect(picker.getByText("Already added", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(`button[data-life-link-id="${sourceId}"]`)).toBeVisible();
    await expect(page.locator(".ll-member-row").filter({ hasText: unassignedName })).toHaveCount(0);
    await page.locator(`button[data-life-link-id="${sourceId}"]`).click();
    await expect(details.getByRole("heading", { name: sourceName, exact: true })).toBeVisible();
    await expectMembership(details, collectionName);
    if (await page.getByRole("button", { name: "Back", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Back", exact: true }).click();
    }

    await page.getByRole("button", { name: `Membership for ${itemName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Sections", exact: true }).click();
    const assignments = page.getByRole("dialog", { name: "Collections & sections", exact: true });
    await assignments.getByLabel(sectionName, { exact: true }).check();
    await assignments.getByLabel(secondSectionName, { exact: true }).check();
    await assignments.getByRole("button", { name: "Save sections", exact: true }).click();
    await expect(assignments).toBeHidden();
    const section = page.locator(".ll-collection-group").filter({ has: page.getByRole("button", { name: new RegExp(`^${escapeRegExp(sectionName)}`) }) });
    await expect(section.locator(`button[data-life-link-id="${lifeLinkId}"]`)).toBeVisible();
    await section.locator(`button[data-life-link-id="${lifeLinkId}"]`).click();
    await expectMembership(details, collectionName, sectionName, secondSectionName);
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(collectionPath)}\\?lifeLinkId=${escapeRegExp(lifeLinkId!)}$`));

    await page.reload();
    await expect(details).toHaveAttribute("data-selected-life-link-id", lifeLinkId!);
    await expectMembership(details, collectionName, sectionName, secondSectionName);
    await expect(details.getByText(notes, { exact: true })).toBeVisible();
    await expect(details.getByText(plan, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await detailAction(page, itemName, "Move…");
    const move = page.getByRole("dialog", { name: "Move selected Life Links", exact: true });
    await revealPagedRecord(move.getByRole("button", { name: destinationName, exact: true }), move.getByRole("button", { name: "Load more", exact: true }), move.locator(".ll-picker-list > div"));
    await move.getByRole("button", { name: destinationName, exact: true }).click();
    await move.getByRole("button", { name: "Choose this folder", exact: true }).click();
    const movePreview = page.getByRole("dialog", { name: "Confirm move", exact: true });
    await expect(movePreview.getByRole("list", { name: "Life Links to move" })).toContainText(itemName);
    await expect(movePreview).toContainText(destinationName);
    await movePreview.getByRole("button", { name: "Move to folder", exact: true }).click();
    await expect(movePreview).toBeHidden();
    await expect(details).toHaveAttribute("data-selected-life-link-id", lifeLinkId!);
    await expect(details.getByRole("navigation", { name: "Item location" })).toContainText(destinationName);
    await expect(details.getByRole("navigation", { name: "Item location" })).not.toContainText(sourceName);
    await expectMembership(details, collectionName, sectionName, secondSectionName);

    await detailAction(page, itemName, "QR code");
    const qr = page.getByRole("dialog", { name: "QR code", exact: true });
    await qr.getByRole("button", { name: "Generate QR", exact: true }).click();
    await expect(qr.locator("code")).toHaveText(/^LL-/);
    const qrId = (await qr.locator("code").innerText()).trim();
    await qr.getByLabel("Make this record public", { exact: true }).check();
    await qr.getByLabel("Notes", { exact: true }).uncheck();
    await qr.getByLabel("Plan", { exact: true }).check();
    const published = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/life-links/${lifeLinkId}`);
    await qr.getByRole("button", { name: "Save public view", exact: true }).click();
    expect((await published).status()).toBe(200);
    await qr.getByRole("button", { name: "Preview saved public view", exact: true }).click();
    await expect(qr.locator(".ll-public-preview")).toContainText(plan);
    await expect(qr.locator(".ll-public-preview")).not.toContainText(notes);

    const publicContext = await browser.newContext({ viewport: page.viewportSize() });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(new URL(`/qr/${qrId}`, baseURL!).toString());
      await expect(publicPage.getByRole("heading", { name: itemName, exact: true })).toBeVisible();
      await expect(publicPage.getByText(plan, { exact: true })).toBeVisible();
      for (const privateValue of [notes, sourceName, destinationName, collectionName, sectionName, secondSectionName, lifeLinkId!]) {
        await expect(publicPage.locator("body")).not.toContainText(privateValue);
      }
      await expect(publicPage.locator(".media-gallery")).toHaveCount(0);
      await expectNoHorizontalOverflow(publicPage);
    } finally {
      await publicContext.close();
    }

    await qr.getByRole("button", { name: "Detach QR", exact: true }).click();
    await expect(qr.getByRole("button", { name: "Generate QR", exact: true })).toBeVisible();
    await expect(details).toHaveAttribute("data-selected-life-link-id", lifeLinkId!);
    await qr.getByLabel("QR code or URL", { exact: true }).fill(qrId);
    await qr.getByRole("button", { name: "Attach QR", exact: true }).click();
    await expect(qr.locator("code")).toHaveText(qrId);
    await qr.getByRole("button", { name: "Close QR code", exact: true }).click();
    await page.reload();
    await expect(details).toHaveAttribute("data-selected-life-link-id", lifeLinkId!);
    await expectMembership(details, collectionName, sectionName, secondSectionName);
    await expect(details.getByRole("button", { name: "QR attached · preview public view", exact: true })).toBeVisible();

    await search(page, sectionName);
    const collectionResult = page.locator(".ll-search-result").filter({ hasText: collectionName });
    await expect(collectionResult).toContainText(sectionName);
    await collectionResult.getByRole("button", { name: collectionName, exact: true }).click();
    await expect(page.getByRole("heading", { name: collectionName, exact: true })).toBeVisible();
    await expect(page.locator(`button[data-life-link-id="${lifeLinkId}"]`)).toHaveCount(2);
    await expect(page.locator(".ll-member-row").filter({ hasText: unassignedName })).toHaveCount(0);
    await search(page, plan);
    const itemResult = page.locator("button.ll-search-open").filter({ hasText: itemName });
    await expect(itemResult).toContainText(plan);
    await itemResult.click();
    await expect(details).toHaveAttribute("data-selected-life-link-id", lifeLinkId!);
    await expectMembership(details, collectionName, sectionName, secondSectionName);
    await expectNoHorizontalOverflow(page);

    await detailAction(page, itemName, "QR code");
    await qr.getByRole("button", { name: "Find Mode", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scan a QR", exact: true })).toBeVisible();
    await page.getByLabel("Scanned QR", { exact: true }).fill(qrId);
    await page.getByRole("button", { name: "Check QR", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(`Match found ${qrId}`);
    await expectNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });
});

async function loginAsOwner(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(ownerPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "My Life Links", exact: true })).toBeVisible();
}

async function navigateTo(page: Page, name: "My Life Links" | "My Collections" | "Search records") {
  const mobileToggle = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await mobileToggle.isVisible()) {
    await mobileToggle.click();
    await expect(page.locator(".ll-layout")).toHaveClass(/ll-mobile-navigation-open/);
  }
  await page.getByRole("complementary", { name: "Life Links navigation", exact: true }).getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".ll-layout")).not.toHaveClass(/ll-mobile-navigation-open/);
}

async function createInLayer(page: Page, layer: string, action: string, name: string) {
  await page.getByRole("button", { name: `Add to ${layer}`, exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: action, exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function detailAction(page: Page, title: string, action: string) {
  await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function revealPagedRecord(record: Locator, loadMore: Locator, rows: Locator) {
  await expect.poll(async () => await record.count() > 0 || await loadMore.isVisible()).toBe(true);
  while (await record.count() === 0) {
    const before = await rows.count();
    await loadMore.click();
    await expect.poll(async () => await rows.count()).toBeGreaterThan(before);
  }
  await expect(record).toBeVisible();
}

async function expectMembership(details: Locator, collection: string, ...sections: string[]) {
  await expect(details.getByRole("button", { name: collection, exact: true })).toBeVisible();
  for (const section of sections) {
    await expect(details.locator(".ll-section-tags").getByText(section, { exact: true })).toBeVisible();
  }
}

async function search(page: Page, query: string) {
  await navigateTo(page, "Search records");
  await page.getByRole("textbox", { name: "Search records", exact: true }).fill(query);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

async function expectNavigationGeometry(page: Page) {
  const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  const account = page.getByRole("button", { name: "Account", exact: true });
  await expect(account).toBeVisible();
  const bounds = await account.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  if (await toggle.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(page.locator(".ll-layout")).not.toHaveClass(/ll-mobile-navigation-open/);
  }
  await expectNoHorizontalOverflow(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the workflow smoke test.`);
  return value;
}

function uniqueSuffix(projectName: string): string {
  return `${Date.now().toString(36)}-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
