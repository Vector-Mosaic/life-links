import { defineConfig, devices } from "@playwright/test";

const DEFAULT_LOCAL_PORT = "43182";
const explicitBaseURL = process.env.LIFE_LINKS_WEBMCP_REAL_BASE_URL?.trim();
const localPort = process.env.LIFE_LINKS_WEBMCP_REAL_PORT?.trim() || DEFAULT_LOCAL_PORT;
const localBaseURL = `http://127.0.0.1:${localPort}`;
const baseURL = explicitBaseURL || localBaseURL;
const targetHostname = new URL(baseURL).hostname.toLowerCase().replace(/\.+$/, "");

if (targetHostname === "lifelinks-vmdemo.com" || targetHostname.endsWith(".lifelinks-vmdemo.com")) {
  throw new Error("The native WebMCP acceptance target must not use the frozen lifelinks-vmdemo lane.");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  outputDir: "test-results/webmcp-real-host",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: explicitBaseURL
    ? undefined
    : {
        command: "pnpm --filter @life-links/api dev",
        url: localBaseURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          HOST: "127.0.0.1",
          PORT: localPort,
          NODE_ENV: "test",
          APP_ENV: "ci",
          SESSION_SECRET: "life-links-native-webmcp-test-secret",
          COOKIE_SECURE: "false",
          AUTO_SEED: "true",
          LIFE_LINKS_STORE: "memory",
          LIFE_LINKS_SEED_PROFILE: "competition",
          DEMO_SEED_PASSWORD: "competition-test-password",
          QR_BASE_URL: localBaseURL
        }
      },
  projects: [
    {
      name: "chrome-webmcp-native",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        channel: "chrome",
        launchOptions: {
          args: ["--enable-features=WebMCPTesting"]
        }
      }
    }
  ]
});
