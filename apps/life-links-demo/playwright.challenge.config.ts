import { defineConfig, devices } from "@playwright/test";

const CHALLENGE_PORT = "43183";
const CHALLENGE_BASE_URL = `http://127.0.0.1:${CHALLENGE_PORT}`;
const requestedBaseURL = process.env.LIFE_LINKS_CHALLENGE_BASE_URL?.trim();

if (requestedBaseURL) {
  const hostname = new URL(requestedBaseURL).hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname === "lifelinks-vmdemo.com" || hostname.endsWith(".lifelinks-vmdemo.com")) {
    throw new Error("The challenge E2E must not run against the frozen lifelinks-vmdemo host.");
  }
  throw new Error("The challenge E2E owns a fresh local in-memory server and does not accept a base URL override.");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/challenge-loop",
  use: {
    baseURL: CHALLENGE_BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "pnpm --workspace-root --filter @life-links/api dev",
    url: CHALLENGE_BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      HOST: "127.0.0.1",
      PORT: CHALLENGE_PORT,
      NODE_ENV: "test",
      APP_ENV: "ci",
      SESSION_SECRET: "life-links-challenge-local-test-secret",
      COOKIE_SECURE: "false",
      AUTO_SEED: "true",
      LIFE_LINKS_STORE: "memory",
      LIFE_LINKS_SEED_PROFILE: "competition",
      DEMO_SEED_PASSWORD: "competition-test-password",
      QR_BASE_URL: CHALLENGE_BASE_URL
    }
  },
  projects: [
    {
      name: "challenge-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium"
      }
    }
  ]
});
