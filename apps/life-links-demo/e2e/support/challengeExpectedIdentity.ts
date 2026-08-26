export type HostedChallengeExpectedIdentityName =
  | "LIFE_LINKS_CHALLENGE_EXPECTED_BUILD_SHA"
  | "LIFE_LINKS_CHALLENGE_EXPECTED_CANONICAL_SOURCE_SHA"
  | "LIFE_LINKS_CHALLENGE_EXPECTED_SOURCE_TREE_SHA256";

export function requireHostedChallengeExpectedIdentity(
  name: HostedChallengeExpectedIdentityName,
  value: string | undefined,
  length: 40 | 64
): string {
  const pattern = new RegExp(`^[0-9a-f]{${length}}$`);
  if (!value || !pattern.test(value) || /^0+$/.test(value)) {
    throw new Error(
      `${name} is required for hosted challenge E2E and must be a nonzero full lowercase ${length}-hex value.`
    );
  }
  return value;
}
