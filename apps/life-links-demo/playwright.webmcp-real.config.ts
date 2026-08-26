import { defineConfig, devices } from "@playwright/test";

const DEFAULT_LOCAL_PORT = "43182";
const explicitBaseURL = process.env.LIFE_LINKS_WEBMCP_REAL_BASE_URL?.trim();
const localPort = process.env.LIFE_LINKS_WEBMCP_REAL_PORT?.trim() || DEFAULT_LOCAL_PORT;
const localBaseURL = `http://127.0.0.1:${localPort}`;
const baseURL = explicitBaseURL || localBaseURL;

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
        command: "pnpm --workspace-root --filter @life-links/api dev",
        url: localBaseURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          PORT: localPort
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
