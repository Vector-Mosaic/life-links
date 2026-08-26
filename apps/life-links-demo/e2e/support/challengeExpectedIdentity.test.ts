import { describe, expect, it } from "vitest";

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
