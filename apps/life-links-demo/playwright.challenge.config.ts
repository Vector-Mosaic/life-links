import { defineConfig, devices } from "@playwright/test";

import { requireHostedChallengeExpectedIdentity } from "./e2e/support/challengeExpectedIdentity";

const CHALLENGE_PORT = "43183";
const LOCAL_CHALLENGE_BASE_URL = `http://127.0.0.1:${CHALLENGE_PORT}`;
const rawRequestedBaseURL = process.env.LIFE_LINKS_CHALLENGE_BASE_URL;
if (
  rawRequestedBaseURL !== undefined &&
  (!rawRequestedBaseURL.trim() || rawRequestedBaseURL !== rawRequestedBaseURL.trim())
) {
  throw new Error("LIFE_LINKS_CHALLENGE_BASE_URL must be a nonblank exact HTTPS origin without surrounding whitespace.");
}
const requestedBaseURL = rawRequestedBaseURL?.trim();
const hostedChallenge = Boolean(requestedBaseURL);
const challengeBaseURL = requestedBaseURL
  ? requireHostedChallengeBaseURL(requestedBaseURL)
  : LOCAL_CHALLENGE_BASE_URL;

if (hostedChallenge) {
  requireHostedCredential("LIFE_LINKS_CHALLENGE_EMAIL");
  requireHostedCredential("LIFE_LINKS_CHALLENGE_PASSWORD");
  requireHostedChallengeExpectedIdentity(
    "LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA",
    process.env.LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA,
    40
  );
  requireHostedChallengeExpectedIdentity(
    "LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA",
    process.env.LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA,
    40
  );
  requireHostedChallengeExpectedIdentity(
    "LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256",
    process.env.LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256,
    64
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: hostedChallenge ? "test-results/challenge-loop-hosted" : "test-results/challenge-loop",
  use: {
    baseURL: challengeBaseURL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: hostedChallenge
    ? undefined
    : {
        command: "pnpm --workspace-root --filter @life-links/api dev",
        url: LOCAL_CHALLENGE_BASE_URL,
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
          QR_BASE_URL: LOCAL_CHALLENGE_BASE_URL
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

function requireHostedChallengeBaseURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LIFE_LINKS_CHALLENGE_BASE_URL must be an exact HTTPS origin.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (hostname === "lifelinks-vmdemo.com" || hostname.endsWith(".lifelinks-vmdemo.com")) {
    throw new Error("The challenge E2E must not run against the frozen lifelinks-vmdemo host.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value !== parsed.origin
  ) {
    throw new Error("LIFE_LINKS_CHALLENGE_BASE_URL must be an exact HTTPS origin without credentials, path, query, fragment, or trailing slash.");
  }
  return parsed.origin;
}

function requireHostedCredential(name: "LIFE_LINKS_CHALLENGE_EMAIL" | "LIFE_LINKS_CHALLENGE_PASSWORD"): void {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for hosted challenge E2E.`);
  }
}
