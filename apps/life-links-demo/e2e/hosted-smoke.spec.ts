import { expect, test } from "@playwright/test";

const demoEmail = process.env.LIFE_LINKS_E2E_READONLY_EMAIL ?? "";
const demoPassword = process.env.LIFE_LINKS_E2E_READONLY_PASSWORD ?? "";

test("hosted Life Links supports login plus public and private QR reads", async ({ baseURL, browser, page, request }) => {
  test.skip(!demoEmail || !demoPassword, "Set LIFE_LINKS_E2E_READONLY_EMAIL and LIFE_LINKS_E2E_READONLY_PASSWORD.");

  const health = await request.get("/healthz");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true, service: "life-links-api", system: "life_links" });

  const publicQr = await request.get("/api/qr/LL-DEMO-00002");
  expect(publicQr.ok()).toBe(true);
  expect(await publicQr.json()).toMatchObject({
    state: "claimed",
    link: {
      id: "LL-DEMO-00002",
      title: "Camera battery kit",
      privacy: "public"
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Life Links" }).first()).toBeVisible();
  await page.getByLabel("Email").fill(demoEmail);
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByRole("button", { name: /sign out|logout/i })).toBeVisible();
  await expect(page.getByText("Recent Links")).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByPlaceholder("Title, body, project, or QR ID").fill("camera");
  await expect(page.getByRole("button", { name: /Camera battery kit/ }).first()).toBeVisible();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(new URL("/qr/LL-DEMO-00002", baseURL).toString());
  await expect(publicPage.getByText("Camera battery kit")).toBeVisible();
  await expect(publicPage.getByText("Two batteries, charger, USB-C cable, and the short lens adapter.")).toBeVisible();

  await publicPage.goto(new URL("/qr/LL-DEMO-00001", baseURL).toString());
  await expect(publicPage.getByRole("heading", { name: "Private link" })).toBeVisible();
  await expect(publicPage.getByText("Log in as the owner to view this content.")).toBeVisible();
  await publicContext.close();
});
