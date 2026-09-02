import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { createPostgresStore } from "./postgres-store.js";
import { startLifeLinksServer } from "./server.js";
import { InMemoryLifeLinksStore, type LifeLinksStore } from "./store.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, type CalendarProviderStateStore } from "./calendar-provider-gateway.js";
import { PostgresCalendarProviderStateStore } from "./calendar-provider-postgres.js";

async function main() {
  const config = readConfig();
  const logger = createLogger("life_links_main", { env: config.env });
  let store: LifeLinksStore;
  let calendarProviderState: CalendarProviderStateStore;

  if (config.storeMode === "postgres") {
    const postgres = createPostgresStore(config.databaseUrl);
    store = postgres.store;
    calendarProviderState = new PostgresCalendarProviderStateStore(postgres.pool);
    if (config.autoMigrate) {
      await runMigrations(postgres.pool, config.migrationDir, logger);
    }
  } else {
    store = new InMemoryLifeLinksStore();
    calendarProviderState = new InMemoryCalendarProviderStateStore();
    logger.warn("life_links.store.memory_enabled", {
      message: "DATABASE_URL is not set; using in-memory data for local development only."
    });
  }

  if (config.autoSeed) {
    if (config.seedProfile === "competition") {
      const reset = await store.resetCompetitionFixture({
        mode: "apply",
        password: config.seedPassword,
        qrBaseUrl: config.qrBaseUrl
      });
      logger.info("life_links.competition_fixture.seeded", {
        msg: "Competition fixture seeded in disposable memory",
        profile: reset.profile,
        life_link_count: reset.after.lifeLinks,
        qr_count: reset.after.qrCodes
      });
    } else {
      await store.seedDemo(config.seedPassword, config.qrBaseUrl);
    }
  }

  // Management reads and local disconnect use the real retained provider state.
  // No adapter is enabled until its OAuth and server credential lane is wired.
  const calendarProviderGateway = new CalendarProviderGateway([], calendarProviderState);
  const server = startLifeLinksServer({ store, config, logger, calendarProviderGateway });
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
