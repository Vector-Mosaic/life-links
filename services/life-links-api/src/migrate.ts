import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { createPostgresStore } from "./postgres-store.js";

async function main() {
  const config = readConfig({ ...process.env, LIFE_LINKS_STORE: "postgres" });
  const logger = createLogger("life_links_migrate", { env: config.env });
  const { pool } = createPostgresStore(config.databaseUrl);
  try {
    await runMigrations(pool, config.migrationDir, logger);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  createLogger("life_links_migrate").fatal("life_links.migration.failed", {
    msg: "Life Links migration failed",
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
