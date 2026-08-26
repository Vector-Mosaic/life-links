import { defineConfig, devices } from "@playwright/test";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:3002";
const rawBaseURL = process.env.LIFE_LINKS_E2E_BASE_URL;
if (rawBaseURL !== undefined && (!rawBaseURL.trim() || rawBaseURL !== rawBaseURL.trim())) {
  throw new Error("LIFE_LINKS_E2E_BASE_URL must be a nonblank exact origin without surrounding whitespace.");
}
const baseURL = rawBaseURL ?? DEFAULT_LOCAL_BASE_URL;
const parsedBaseURL = new URL(baseURL);
const targetHostname = parsedBaseURL.hostname.toLowerCase().replace(/\.+$/, "");
if (targetHostname === "lifelinks-vmdemo.com" || targetHostname.endsWith(".lifelinks-vmdemo.com")) {
  throw new Error("The browser smoke target must not use the frozen lifelinks-vmdemo.com lane.");
}
if (
  !["http:", "https:"].includes(parsedBaseURL.protocol) ||
  parsedBaseURL.username ||
  parsedBaseURL.password ||
  parsedBaseURL.pathname !== "/" ||
  parsedBaseURL.search ||
  parsedBaseURL.hash ||
  baseURL !== parsedBaseURL.origin
) {
  throw new Error("LIFE_LINKS_E2E_BASE_URL must be an exact HTTP or HTTPS origin without credentials, path, query, fragment, or trailing slash.");
}

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
