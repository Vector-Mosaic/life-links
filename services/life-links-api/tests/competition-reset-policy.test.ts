import { describe, expect, it } from "vitest";

import { COMPETITION_OWNER_ID } from "@life-links/core";

import { authorizeCompetitionReset, requireCompetitionResetPassword } from "../src/competition-reset-policy.js";
import { readConfig } from "../src/config.js";

const ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000090";
const BUILD_SHA = "a".repeat(40);
const CANONICAL_SOURCE_SHA = "b".repeat(40);
const SOURCE_TREE_SHA256 = "c".repeat(64);

function config(overrides: NodeJS.ProcessEnv = {}) {
  return readConfig({
    APP_ENV: "webmcp-challenge",
    LIFE_LINKS_STORE: "postgres",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SESSION_SECRET: "competition-reset-test-secret",
    QR_BASE_URL: "https://challenge-life-links.example",
    AUTO_SEED: "false",
    COOKIE_SECURE: "true",
    BUILD_SHA,
    CANONICAL_SOURCE_SHA,
    SOURCE_TREE_SHA256,
    ...overrides
  });
}

function runtime(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    LIFE_LINKS_COMPETITION_RESET_ENABLED: "true",
    LIFE_LINKS_COMPETITION_ENVIRONMENT_ID: ENVIRONMENT_ID,
    RAILWAY_ENVIRONMENT_ID: ENVIRONMENT_ID,
    ...overrides
  };
}

const selector = {
  environmentId: ENVIRONMENT_ID,
  ownerId: COMPETITION_OWNER_ID,
  mode: "dry-run" as const
};

describe("competition fixture reset policy", () => {
  it("treats the hosted challenge runtime as production-like by default", () => {
    const hosted = readConfig({
      APP_ENV: "webmcp-challenge",
      LIFE_LINKS_STORE: "postgres",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: "competition-reset-test-secret",
      QR_BASE_URL: "https://challenge-life-links.example",
      AUTO_SEED: "false",
      BUILD_SHA,
      CANONICAL_SOURCE_SHA,
      SOURCE_TREE_SHA256
    });
    expect(hosted).toMatchObject({
      seedPassword: "",
      secureCookies: true,
      trustProxy: true,
      hstsEnabled: true,
      originCheckEnabled: true
    });
    expect(() =>
      readConfig({
        APP_ENV: "webmcp-challenge",
        LIFE_LINKS_STORE: "postgres",
        DATABASE_URL: "postgresql://test:test@localhost:5432/test",
        AUTO_SEED: "false",
        BUILD_SHA,
        CANONICAL_SOURCE_SHA,
        SOURCE_TREE_SHA256
      })
    ).toThrow("SESSION_SECRET is required");
    expect(() => requireCompetitionResetPassword({})).toThrow("DEMO_SEED_PASSWORD is required");
    expect(requireCompetitionResetPassword({ DEMO_SEED_PASSWORD: "explicit-challenge-password" })).toBe(
      "explicit-challenge-password"
    );
  });

  it("allows competition auto-seeding only for the disposable in-memory store", () => {
    expect(
      readConfig({
        APP_ENV: "ci",
        LIFE_LINKS_STORE: "memory",
        LIFE_LINKS_SEED_PROFILE: "competition",
        AUTO_SEED: "true",
        DEMO_SEED_PASSWORD: "competition-test-password"
      }).seedProfile
    ).toBe("competition");
    expect(() =>
      config({
        LIFE_LINKS_SEED_PROFILE: "competition",
        AUTO_SEED: "true",
        DEMO_SEED_PASSWORD: "competition-test-password"
      })
    ).toThrow("disposable in-memory store");
  });

  it("authorizes only the exact challenge environment and fixed sandbox owner", () => {
    expect(authorizeCompetitionReset(config(), runtime(), selector)).toMatchObject({
      ownerId: COMPETITION_OWNER_ID,
      environmentId: ENVIRONMENT_ID,
      mode: "dry-run"
    });
  });

  it.each([
    ["disabled", runtime({ LIFE_LINKS_COMPETITION_RESET_ENABLED: "false" }), selector],
    ["wrong actual environment", runtime({ RAILWAY_ENVIRONMENT_ID: "other" }), selector],
    ["wrong selected environment", runtime(), { ...selector, environmentId: "other" }],
    ["wrong owner", runtime(), { ...selector, ownerId: "demo-owner" }]
  ])("rejects %s without widening scope", (_label, env, attemptedSelector) => {
    expect(() => authorizeCompetitionReset(config(), env, attemptedSelector)).toThrow();
  });

  it("rejects auto-seed, a non-challenge runtime, and the frozen hostname", () => {
    expect(() =>
      authorizeCompetitionReset(
        config({ AUTO_SEED: "true", DEMO_SEED_PASSWORD: "competition-test-password" }),
        runtime(),
        selector
      )
    ).toThrow(
      "AUTO_SEED=false"
    );
    expect(() => authorizeCompetitionReset(config({ APP_ENV: "prod" }), runtime(), selector)).toThrow(
      "APP_ENV=webmcp-challenge"
    );
    for (const frozenUrl of [
      "https://lifelinks-vmdemo.com",
      "https://lifelinks-vmdemo.com.",
      "https://nested.lifelinks-vmdemo.com."
    ]) {
      expect(() => config({ QR_BASE_URL: frozenUrl })).toThrow("frozen");
      expect(() =>
        authorizeCompetitionReset({ ...config(), qrBaseUrl: frozenUrl }, runtime(), selector)
      ).toThrow("frozen");
    }
  });
});
