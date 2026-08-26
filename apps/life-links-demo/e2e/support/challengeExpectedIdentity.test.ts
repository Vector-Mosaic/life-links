import { describe, expect, it, vi } from "vitest";

import { requireHostedChallengeExpectedIdentity } from "./challengeExpectedIdentity";

describe("hosted challenge expected runtime identity", () => {
  it("accepts exact nonzero lowercase identities", () => {
    expect(
      requireHostedChallengeExpectedIdentity(
        "LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA",
        `${"0".repeat(39)}1`,
        40
      )
    ).toBe(`${"0".repeat(39)}1`);
    expect(
      requireHostedChallengeExpectedIdentity(
        "LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256",
        `${"0".repeat(63)}1`,
        64
      )
    ).toBe(`${"0".repeat(63)}1`);
  });

  it.each([
    ["LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA", undefined, 40],
    ["LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA", "a".repeat(39), 40],
    ["LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA", "A".repeat(40), 40],
    ["LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA", "0".repeat(40), 40],
    ["LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA", "0".repeat(40), 40],
    ["LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256", "0".repeat(64), 64]
  ] as const)("rejects invalid or null identity %s", (name, value, length) => {
    expect(() => requireHostedChallengeExpectedIdentity(name, value, length)).toThrow(name);
  });
});

describe("local E2E API launcher", () => {
  it("resolves both Playwright configs to one API package without selecting the workspace root", async () => {
    const baseUrlSelectors = ["LIFE_LINKS_WEBMCP_REAL_BASE_URL", "LIFE_LINKS_CHALLENGE_BASE_URL"] as const;
    const previousValues = new Map(baseUrlSelectors.map((name) => [name, process.env[name]]));
    baseUrlSelectors.forEach((name) => delete process.env[name]);
    vi.resetModules();

    try {
      const [nativeWebMcp, challenge] = await Promise.all([
        import("../../playwright.webmcp-real.config"),
        import("../../playwright.challenge.config")
      ]);

      for (const config of [nativeWebMcp.default, challenge.default]) {
        expect(config.webServer).toMatchObject({
          command: "pnpm --filter @life-links/api dev"
        });
        expect(JSON.stringify(config.webServer)).not.toContain("--workspace-root");
      }
    } finally {
      for (const [name, value] of previousValues) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      vi.resetModules();
    }
  });
});

describe("read-only browser smoke target", () => {
  it("defaults to the local application origin", async () => {
    const selector = "LIFE_LINKS_E2E_BASE_URL";
    const previousValue = process.env[selector];
    delete process.env[selector];
    vi.resetModules();

    try {
      const config = await import("../../playwright.config");
      expect(config.default.use).toMatchObject({ baseURL: "http://127.0.0.1:3002" });
    } finally {
      if (previousValue === undefined) {
        delete process.env[selector];
      } else {
        process.env[selector] = previousValue;
      }
      vi.resetModules();
    }
  });

  it("rejects the frozen deployment even when it is selected explicitly", async () => {
    const selector = "LIFE_LINKS_E2E_BASE_URL";
    const previousValue = process.env[selector];
    process.env[selector] = "https://lifelinks-vmdemo.com";
    vi.resetModules();

    try {
      await expect(import("../../playwright.config")).rejects.toThrow("must not use the frozen");
    } finally {
      if (previousValue === undefined) {
        delete process.env[selector];
      } else {
        process.env[selector] = previousValue;
      }
      vi.resetModules();
    }
  });
});
