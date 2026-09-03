import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runMigrations } from "./migrations.js";
import { createPostgresStore } from "./postgres-store.js";
import { startLifeLinksServer } from "./server.js";
import { InMemoryLifeLinksStore, type LifeLinksStore } from "./store.js";
import { CalendarProviderGateway, InMemoryCalendarProviderStateStore, type CalendarProviderStateStore, type CalendarProviderAdapter } from "./calendar-provider-gateway.js";
import { PostgresCalendarProviderStateStore } from "./calendar-provider-postgres.js";
import { PostgresCalendarSecretStore, InMemoryCalendarSecretStore, CalendarSecretCipher, type CalendarSecretStore } from "./calendar-secret-store.js";
import { CalendarAuthorizationService } from "./calendar-authorization.js";
import { MsalMicrosoftCalendarAuth } from "./calendar-microsoft-auth.js";
import { MicrosoftGraphCalendarProviderAdapter } from "./calendar-provider-microsoft.js";
import { GoogleCalendarProviderAdapter } from "./calendar-provider-google.js";
import { GoogleOAuthCalendarAuth } from "./calendar-google-auth.js";
import { CalendarProviderRuntime } from "./calendar-provider-runtime.js";
import { CalendarProviderSubscriptionService, PostgresCalendarProviderSubscriptionStore,
  InMemoryCalendarProviderSubscriptionStore, type CalendarProviderSubscriptionStore } from "./calendar-provider-subscriptions.js";
import { RemoteAgentState } from "./remote-agent-state.js";
import { RemoteAgentAuth } from "./remote-agent-auth.js";

async function main() {
  const config = readConfig();
  const logger = createLogger("life_links_main", { env: config.env });
  let store: LifeLinksStore;
  let calendarProviderState: CalendarProviderStateStore;
  let calendarSecrets: CalendarSecretStore;
  let calendarSubscriptions: CalendarProviderSubscriptionStore;
  let remoteAgentState: RemoteAgentState;

  if (config.storeMode === "postgres") {
    const postgres = createPostgresStore(config.databaseUrl);
    store = postgres.store;
    calendarProviderState = new PostgresCalendarProviderStateStore(postgres.pool);
    calendarSecrets = new PostgresCalendarSecretStore(postgres.pool);
    calendarSubscriptions = new PostgresCalendarProviderSubscriptionStore(postgres.pool);
    remoteAgentState = new RemoteAgentState(config.sessionSecret, postgres.pool);
    if (config.autoMigrate) {
      await runMigrations(postgres.pool, config.migrationDir, logger);
    }
  } else {
    store = new InMemoryLifeLinksStore();
    calendarProviderState = new InMemoryCalendarProviderStateStore();
    calendarSecrets = new InMemoryCalendarSecretStore();
    calendarSubscriptions = new InMemoryCalendarProviderSubscriptionStore();
    remoteAgentState = new RemoteAgentState(config.sessionSecret);
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
  const calendarEncryptionKey = config.microsoftCalendar?.encryptionKey ?? config.googleCalendar?.encryptionKey;
  const calendarAuthorizationService = calendarEncryptionKey ? new CalendarAuthorizationService(
    calendarSecrets, new CalendarSecretCipher(calendarEncryptionKey),
    config.microsoftCalendar ? new MsalMicrosoftCalendarAuth(config.microsoftCalendar) : undefined, () => calendarProviderGateway,
    () => new Date(), config.googleCalendar ? new GoogleOAuthCalendarAuth(config.googleCalendar) : undefined
  ) : undefined;
  const microsoftAdapter = calendarAuthorizationService && config.microsoftCalendar ? new MicrosoftGraphCalendarProviderAdapter({
    credentialResolver: calendarAuthorizationService, credentialRevoker: calendarAuthorizationService,
    onRenewedCredentialUsed: () => logger.info("life_links.calendar_credentials.renewal_used", {
      provider: "microsoft", acquisition: "silent_renewal", graph_result: "accepted"
    })
  }) : undefined;
  const adapters: CalendarProviderAdapter[] = microsoftAdapter ? [microsoftAdapter] : [];
  if (calendarAuthorizationService && config.googleCalendar) adapters.push(new GoogleCalendarProviderAdapter({
    credentialResolver: calendarAuthorizationService, credentialRevoker: calendarAuthorizationService
  }));
  calendarProviderGateway = new CalendarProviderGateway(adapters, calendarProviderState);
  const calendarSubscriptionService = microsoftAdapter ? new CalendarProviderSubscriptionService({
    gateway: calendarProviderGateway, adapter: microsoftAdapter, store: calendarSubscriptions,
    notificationUrl: `${config.qrBaseUrl}/api/calendar-notifications/microsoft`
  }) : undefined;
  calendarAuthorizationService?.setBeforeRevoke(async (input) => {
    const connection = await calendarProviderGateway.store.getConnection(input.connectionId);
    if (connection?.providerKey === "microsoft-graph-calendar") await calendarSubscriptionService?.cleanupConnection(input);
  });
  const calendarRuntime = calendarAuthorizationService ? new CalendarProviderRuntime(calendarProviderGateway, calendarAuthorizationService,
    logger, 60_000, calendarSubscriptionService, adapters.map((adapter) => adapter.providerKey)) : undefined;
  const server = startLifeLinksServer({ store, config, logger, calendarProviderGateway, calendarAuthorizationService,
    calendarSubscriptionService, wakeCalendarRuntime: () => calendarRuntime?.wake(),
    remoteAgent: { state: remoteAgentState, auth: await RemoteAgentAuth.create(remoteAgentState, store, config, logger) } });
  calendarRuntime?.start();
  logger.info("life_links.server.started", {
    host: config.host,
    port: config.port,
    storeMode: config.storeMode,
    qrBaseUrl: config.qrBaseUrl
  });

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      // Abort remote operations and close their SSE streams before HTTP drain;
      // otherwise Server.close waits indefinitely while the pool closes early.
      const remoteClosing = server.closeRemoteAgent();
      const httpClosing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.all([remoteClosing, httpClosing, calendarRuntime?.stop()]);
      await store.close();
    })();
    return stopping;
  };
  const onSignal = () => { void stop().then(() => process.exit(0), () => {
    logger.fatal("life_links.server.shutdown_failed", { msg: "Life Links shutdown could not complete." });
    process.exit(1);
  }); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
}

main().catch((error) => {
  createLogger("life_links_main").fatal("life_links.server.failed", {
    msg: "Life Links server failed to start",
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
