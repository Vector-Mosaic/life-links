import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { createPostgresStore } from "./postgres-store.js";
import { startLifeLinksServer } from "./server.js";
import { InMemoryLifeLinksStore, type LifeLinksStore } from "./store.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, type CalendarProviderStateStore } from "./calendar-provider-gateway.js";
import { PostgresCalendarProviderStateStore } from "./calendar-provider-postgres.js";
import { PostgresCalendarSecretStore, InMemoryCalendarSecretStore, CalendarSecretCipher, type CalendarSecretStore } from "./calendar-secret-store.js";
import { CalendarAuthorizationService } from "./calendar-authorization.js";
import { MsalMicrosoftCalendarAuth } from "./calendar-microsoft-auth.js";
import { MicrosoftGraphCalendarProviderAdapter } from "./calendar-provider-microsoft.js";
import { CalendarProviderRuntime } from "./calendar-provider-runtime.js";
import { CalendarProviderSubscriptionService, PostgresCalendarProviderSubscriptionStore,
  InMemoryCalendarProviderSubscriptionStore, type CalendarProviderSubscriptionStore } from "./calendar-provider-subscriptions.js";

async function main() {
  const config = readConfig();
  const logger = createLogger("life_links_main", { env: config.env });
  let store: LifeLinksStore;
  let calendarProviderState: CalendarProviderStateStore;
  let calendarSecrets: CalendarSecretStore;
  let calendarSubscriptions: CalendarProviderSubscriptionStore;

  if (config.storeMode === "postgres") {
    const postgres = createPostgresStore(config.databaseUrl);
    store = postgres.store;
    calendarProviderState = new PostgresCalendarProviderStateStore(postgres.pool);
    calendarSecrets = new PostgresCalendarSecretStore(postgres.pool);
    calendarSubscriptions = new PostgresCalendarProviderSubscriptionStore(postgres.pool);
    if (config.autoMigrate) {
      await runMigrations(postgres.pool, config.migrationDir, logger);
    }
  } else {
    store = new InMemoryLifeLinksStore();
    calendarProviderState = new InMemoryCalendarProviderStateStore();
    calendarSecrets = new InMemoryCalendarSecretStore();
    calendarSubscriptions = new InMemoryCalendarProviderSubscriptionStore();
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

  let calendarProviderGateway: CalendarProviderGateway;
  const calendarAuthorizationService = config.microsoftCalendar ? new CalendarAuthorizationService(
    calendarSecrets, new CalendarSecretCipher(config.microsoftCalendar.encryptionKey),
    new MsalMicrosoftCalendarAuth(config.microsoftCalendar), () => calendarProviderGateway
  ) : undefined;
  const adapters = calendarAuthorizationService ? [new MicrosoftGraphCalendarProviderAdapter({
    credentialResolver: calendarAuthorizationService, credentialRevoker: calendarAuthorizationService,
    onRenewedCredentialUsed: () => logger.info("life_links.calendar_credentials.renewal_used", {
      provider: "microsoft", acquisition: "silent_renewal", graph_result: "accepted"
    })
  })] : [];
  calendarProviderGateway = new CalendarProviderGateway(adapters, calendarProviderState);
  const calendarSubscriptionService = calendarAuthorizationService ? new CalendarProviderSubscriptionService({
    gateway: calendarProviderGateway, adapter: adapters[0], store: calendarSubscriptions,
    notificationUrl: `${config.qrBaseUrl}/api/calendar-notifications/microsoft`
  }) : undefined;
  calendarAuthorizationService?.setBeforeRevoke((input) => calendarSubscriptionService!.cleanupConnection(input));
  const calendarRuntime = calendarAuthorizationService ? new CalendarProviderRuntime(calendarProviderGateway, calendarAuthorizationService, logger, 60_000, calendarSubscriptionService) : undefined;
  const server = startLifeLinksServer({ store, config, logger, calendarProviderGateway, calendarAuthorizationService,
    calendarSubscriptionService, wakeCalendarRuntime: () => calendarRuntime?.wake() });
  calendarRuntime?.start();
  logger.info("life_links.server.started", {
    host: config.host,
    port: config.port,
    storeMode: config.storeMode,
    qrBaseUrl: config.qrBaseUrl
  });

  const stop = async () => {
    server.close();
    await calendarRuntime?.stop();
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
