import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.LIFE_LINKS_E2E_BASE_URL ?? "https://lifelinks-vmdemo.com";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium"
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium"
      }
    }
  ]
});
