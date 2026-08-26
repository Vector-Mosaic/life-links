import { createHash } from "node:crypto";

import { COMPETITION_FIXTURE_PROFILE } from "@life-links/core";

import {
  authorizeCompetitionReset,
  requireCompetitionResetPassword,
  type CompetitionResetSelector
} from "./competition-reset-policy.js";
import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createPostgresStore } from "./postgres-store.js";

const USAGE = [
  "Reset the fixed Life Links WebMCP competition sandbox.",
  "",
  "Dry run (default):",
  "  pnpm --filter @life-links/api competition:reset -- --environment-id <railway-environment-id> --owner-id competition-owner",
  "",
  "Apply:",
  "  pnpm --filter @life-links/api competition:reset -- --environment-id <railway-environment-id> --owner-id competition-owner --apply"
].join("\n");

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    console.log(USAGE);
    return;
  }

  const selector = parseSelector(process.argv.slice(2));
  const config = readConfig();
  const authorized = authorizeCompetitionReset(config, process.env, selector);
  const password = requireCompetitionResetPassword(process.env);

  const logger = createLogger("life_links_competition_reset", { env: config.env });
  const { store } = createPostgresStore(config.databaseUrl);
  try {
    const report = await store.resetCompetitionFixture({
      mode: authorized.mode,
      password,
      qrBaseUrl: config.qrBaseUrl
    });
    logger.info(
      report.applied
        ? "life_links.competition_fixture.reset_completed"
        : "life_links.competition_fixture.reset_dry_run",
      {
        msg: report.applied ? "Competition fixture reset completed" : "Competition fixture reset dry run completed",
        profile: COMPETITION_FIXTURE_PROFILE,
        mode: report.mode,
        applied: report.applied,
        environment_ref: shortHash(authorized.environmentId),
        owner_ref: shortHash(authorized.ownerId),
        before: report.before,
        after: report.after,
        expected: report.expected
      }
    );
  } finally {
    await store.close();
  }
}

function parseSelector(argv: string[]): CompetitionResetSelector {
  let environmentId = "";
  let ownerId = "";
  let mode: CompetitionResetSelector["mode"] = "dry-run";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      mode = "apply";
      continue;
    }
    if (value === "--environment-id") {
      environmentId = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    if (value === "--owner-id") {
      ownerId = argv[index + 1]?.trim() ?? "";
      index += 1;
      continue;
    }
    throw new Error("Competition reset received an unsupported argument; run with --help for usage");
  }
  if (!environmentId || !ownerId) {
    throw new Error("Competition reset requires explicit --environment-id and --owner-id selectors");
  }
  return { environmentId, ownerId, mode };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

main().catch((error) => {
  createLogger("life_links_competition_reset").fatal("life_links.competition_fixture.reset_failed", {
    msg: "Competition fixture reset failed",
    profile: COMPETITION_FIXTURE_PROFILE,
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
