import { COMPETITION_FIXTURE_PROFILE, COMPETITION_OWNER_ID } from "@life-links/core";

import type { LifeLinksConfig } from "./config.js";
import type { CompetitionFixtureResetMode } from "./store.js";

const COMPETITION_RUNTIME_ENV = "webmcp-challenge";
const FROZEN_HOSTNAME = "lifelinks-vmdemo.com";

export type CompetitionResetSelector = {
  environmentId: string;
  ownerId: string;
  mode: CompetitionFixtureResetMode;
};

export type AuthorizedCompetitionReset = CompetitionResetSelector & {
  profile: typeof COMPETITION_FIXTURE_PROFILE;
};

export function requireCompetitionResetPassword(env: NodeJS.ProcessEnv): string {
  const password = env.DEMO_SEED_PASSWORD ?? "";
  if (!password) {
    throw new Error("DEMO_SEED_PASSWORD is required for competition fixture reset");
  }
  return password;
}

export function authorizeCompetitionReset(
  config: LifeLinksConfig,
  env: NodeJS.ProcessEnv,
  selector: CompetitionResetSelector
): AuthorizedCompetitionReset {
  if (config.storeMode !== "postgres") {
    throw new Error("Competition reset requires LIFE_LINKS_STORE=postgres");
  }
  if (config.autoSeed) {
    throw new Error("Competition reset requires AUTO_SEED=false");
  }
  if (config.env !== COMPETITION_RUNTIME_ENV) {
    throw new Error("Competition reset requires APP_ENV=webmcp-challenge");
  }
  if (env.LIFE_LINKS_COMPETITION_RESET_ENABLED !== "true") {
    throw new Error("Competition reset is disabled for this runtime");
  }

  const allowedEnvironmentId = env.LIFE_LINKS_COMPETITION_ENVIRONMENT_ID?.trim() ?? "";
  const actualEnvironmentId = env.RAILWAY_ENVIRONMENT_ID?.trim() ?? "";
  if (!allowedEnvironmentId || !actualEnvironmentId) {
    throw new Error("Competition reset requires exact allowed and actual Railway environment IDs");
  }
  if (
    selector.environmentId !== allowedEnvironmentId ||
    actualEnvironmentId !== allowedEnvironmentId
  ) {
    throw new Error("Competition reset environment identity does not match the exact allowlist");
  }
  if (selector.ownerId !== COMPETITION_OWNER_ID) {
    throw new Error("Competition reset owner identity does not match the fixed sandbox owner");
  }

  let qrHostname = "";
  try {
    qrHostname = new URL(config.qrBaseUrl).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    throw new Error("Competition reset requires a valid QR_BASE_URL");
  }
  if (qrHostname === FROZEN_HOSTNAME || qrHostname.endsWith(`.${FROZEN_HOSTNAME}`)) {
    throw new Error("Competition reset refuses the frozen Life Links deployment hostname");
  }

  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    environmentId: selector.environmentId,
    ownerId: selector.ownerId,
    mode: selector.mode
  };
}
