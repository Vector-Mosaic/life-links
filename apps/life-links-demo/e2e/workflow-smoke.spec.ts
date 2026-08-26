import { expect, test, type Page } from "@playwright/test";

const workflowEnabled = process.env.LIFE_LINKS_E2E_MUTATION === "1";
const ownerEmail = workflowEnabled ? requireEnv("LIFE_LINKS_E2E_EMAIL") : "";
const ownerPassword = workflowEnabled ? requireEnv("LIFE_LINKS_E2E_PASSWORD") : "";

test.describe("hosted MVP owner workflow", () => {
  test.skip(!workflowEnabled, "Set LIFE_LINKS_E2E_MUTATION=1 to allow hosted workflow writes.");

  test("creates, organizes, finds, and privacy-checks a claimed QR", async ({ baseURL, browser, page }, testInfo) => {
    const suffix = uniqueSuffix(testInfo.project.name);
    const projectName = `E2E Project ${suffix}`;
    const title = `E2E Tagged Kit ${suffix}`;
    const body = `Workflow body token ${suffix}`;

    await loginAsOwner(page);

    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByPlaceholder("Enter project name and click +").fill(projectName);
    await page.getByTitle("Add project").click();

    const projectBlock = page.locator(".project-block").filter({ hasText: projectName });
    await expect(projectBlock).toBeVisible();
    await expect(projectBlock).toContainText("0 links");

    await page.getByRole("button", { name: "QR Factory" }).click();
    await page.getByLabel("Count").fill("2");
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.locator(".batch-strip")).toContainText("Last batch");
    await expect(page.locator(".batch-strip")).toContainText("2");
    await expect(page.locator(".qr-tile")).toHaveCount(2);

    const batchQrIds = await page.locator(".qr-tile span").evaluateAll((nodes) =>
      nodes
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 2)
    );
    expect(batchQrIds).toHaveLength(2);
    const [claimedQrId, otherQrId] = batchQrIds;

    await page.locator(".qr-tile").filter({ hasText: claimedQrId }).click();
    await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
    await page.getByRole("button", { name: "Claim" }).click();

    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Title").fill(title);
    await editor.getByLabel("Body").fill(body);
    await editor.getByLabel("Project").selectOption({ label: projectName });
    await editor.getByLabel("Privacy").selectOption("public");
    await editor.locator('input[type="file"]').setInputFiles({
      name: `e2e-media-${suffix}.png`,
      mimeType: "image/png",
      buffer: tinyPng()
    });
    await expect(editor.locator(".media-item").filter({ hasText: `e2e-media-${suffix}.png` })).toBeVisible();
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();

    await page.getByRole("button", { name: "Projects" }).click();
    await expect(projectBlock).toContainText("1 links");
    await expect(projectBlock.getByRole("button", { name: title })).toBeVisible();
    await projectBlock.getByRole("button", { name: title }).click();
    await expect(page.locator(".public-content")).toContainText(projectName);
    await expect(page.locator(".public-content")).toContainText(title);
    await expect(page.locator(".public-content")).toContainText(body);

    await expectSearchResult(page, title, title);
    await expectSearchResult(page, body, title);
    await expectSearchResult(page, projectName, title);
    await expectSearchResult(page, claimedQrId, title);

    await page.getByPlaceholder("Title, body, project, or QR ID").fill(title);
    await page.locator(".search-result").filter({ hasText: title }).click();
    await expect(page.locator(".find-target")).toContainText(title);
    await expect(page.locator(".find-target")).toContainText(claimedQrId);

    await page.getByRole("button", { name: "Target" }).click();
    await expect(page.locator(".scan-status")).toContainText("Match found");
    await expect(page.locator(".scan-status")).toContainText(claimedQrId);

    await page.locator(".sample-scans").getByRole("button", { name: otherQrId }).click();
    await expect(page.locator(".scan-status")).toContainText("Not the selected item");
    await expect(page.locator(".scan-status")).toContainText(otherQrId);

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(new URL(`/qr/${claimedQrId}`, baseURL).toString());
    await expect(publicPage.getByText(title)).toBeVisible();
    await expect(publicPage.getByText(body)).toBeVisible();
    await expect(publicPage.locator(".media-gallery img")).toHaveCount(1);
    await publicContext.close();

    await page.getByRole("button", { name: "Projects" }).click();
    await projectBlock.getByRole("button", { name: title }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Privacy").selectOption("private");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const privateContext = await browser.newContext();
    const privatePage = await privateContext.newPage();
    await privatePage.goto(new URL(`/qr/${claimedQrId}`, baseURL).toString());
    await expect(privatePage.getByRole("heading", { name: "Private link" })).toBeVisible();
    await expect(privatePage.getByText("Log in as the owner to view this content.")).toBeVisible();
    await expect(privatePage.getByText(body)).toHaveCount(0);
    await expect(privatePage.locator(".media-gallery")).toHaveCount(0);
    await privateContext.close();
  });
});

async function loginAsOwner(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Life Links" }).first()).toBeVisible();
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText("Recent Links")).toBeVisible();
}

async function expectSearchResult(page: Page, query: string, expectedTitle: string) {
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByPlaceholder("Title, body, project, or QR ID").fill(query);
  await expect(page.locator(".search-result").filter({ hasText: expectedTitle })).toBeVisible();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the hosted workflow smoke test.`);
  }
  return value;
}

function uniqueSuffix(projectName: string): string {
  const projectSlug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${Date.now().toString(36)}-${projectSlug}`;
}

function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
}
