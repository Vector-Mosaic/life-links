import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { createPostgresStore } from "./postgres-store.js";
import { startLifeLinksServer } from "./server.js";
import { InMemoryLifeLinksStore, type LifeLinksStore } from "./store.js";

async function main() {
  const config = readConfig();
  const logger = createLogger("life_links_main", { env: config.env });
  let store: LifeLinksStore;

  if (config.storeMode === "postgres") {
    const postgres = createPostgresStore(config.databaseUrl);
    store = postgres.store;
    if (config.autoMigrate) {
      await runMigrations(postgres.pool, config.migrationDir, logger);
    }
  } else {
    store = new InMemoryLifeLinksStore();
    logger.warn("life_links.store.memory_enabled", {
      message: "DATABASE_URL is not set; using in-memory data for local development only."
    });
  }

  if (config.autoSeed) {
    await store.seedDemo(config.seedPassword, config.qrBaseUrl);
  }

  const server = startLifeLinksServer({ store, config, logger });
  logger.info("life_links.server.started", {
    host: config.host,
    port: config.port,
    storeMode: config.storeMode,
    qrBaseUrl: config.qrBaseUrl
  });

  const stop = async () => {
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((error) => {
  createLogger("life_links_main").fatal("life_links.server.failed", {
    msg: "Life Links server failed to start",
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
