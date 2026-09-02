import type { CalendarProviderGateway } from "./calendar-provider-gateway.js";
import type { CalendarAuthorizationService } from "./calendar-authorization.js";
import type { Logger } from "./logger.js";
import type { CalendarProviderSubscriptionService } from "./calendar-provider-subscriptions.js";

/** Bounded serial reconciliation: notifications are only latency hints, never truth. */
export class CalendarProviderRuntime {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running: Promise<void> | null = null;
  #stopped = false;
  #cursor: string | undefined;
  #wakePending = false;
  constructor(private readonly gateway: CalendarProviderGateway, private readonly authorization: CalendarAuthorizationService,
    private readonly logger: Logger, private readonly intervalMs = 60_000,
    private readonly subscriptions?: CalendarProviderSubscriptionService) {}
  start() { if (!this.#timer && !this.#stopped) this.#schedule(0); }
  async stop() {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#running;
  }
  wake() {
    if (this.#stopped) return;
    if (this.#running) { this.#wakePending = true; return; }
    if (this.#timer) clearTimeout(this.#timer);
    this.#schedule(0);
  }
  async sweep() {
    await this.authorization.secrets.deleteExpired(new Date().toISOString());
    try { await this.gateway.retryPendingRevocations({ providerKey: "microsoft-graph-calendar", limit: 10 }); }
    catch { this.logger.warn("life_links.calendar_disconnect.retry_failed", { reason: "subscription_cleanup_pending" }); }
    try { await this.subscriptions?.reconcileHints(this.authorization.initialWindow()); }
    catch { this.logger.warn("life_links.calendar_notifications.reconcile_failed", { reason: "notification_hint_pending" }); }
    const page = await this.gateway.listSynchronizationTargets({ providerKey: "microsoft-graph-calendar", limit: 20, cursor: this.#cursor });
    const checkedConnections = new Set<string>();
    for (const target of page.targets) {
      if (this.#stopped) break;
      try {
        if (!checkedConnections.has(target.connectionId)) {
          checkedConnections.add(target.connectionId);
          try { await this.subscriptions?.ensureConnection(target.connectionId); }
          catch { this.logger.warn("life_links.calendar_notifications.renew_failed", { reason: "notification_subscription_pending" }); }
        }
        await this.gateway.synchronizeCalendar({ ...target, window: this.authorization.initialWindow() });
      } catch {
        this.logger.warn("life_links.calendar_sync.failed", { msg: "Calendar reconciliation will retry", reason: "provider_sync_failed" });
      }
    }
    this.#cursor = page.nextCursor ?? undefined;
    for (const command of await this.gateway.listRetryableCommands({ providerKey: "microsoft-graph-calendar", limit: 10 })) {
      if (this.#stopped) break;
      try { await this.gateway.retryCommand(command.commandId); }
      catch { this.logger.warn("life_links.calendar_write.reconcile_failed", { msg: "Provider write needs reconciliation", reason: "provider_write_pending" }); }
    }
  }
  #schedule(delay: number) {
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#running = this.sweep().catch(() => {
        this.logger.warn("life_links.calendar_runtime.failed", { msg: "Calendar reconciliation sweep failed", reason: "runtime_sweep_failed" });
      }).finally(() => {
        this.#running = null;
        const next = this.#wakePending ? 0 : this.intervalMs;
        this.#wakePending = false;
        if (!this.#stopped) this.#schedule(next);
      });
    }, delay);
    this.#timer.unref();
  }
}
