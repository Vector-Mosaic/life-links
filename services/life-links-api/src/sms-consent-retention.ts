import type { LifeLinksStore } from "./store.js";
import type { Logger } from "./logger.js";

const CLEANUP_INTERVAL_MS = 60 * 60_000;
/** Owned by the existing API process: startup catch-up, serial hourly purge and shutdown drain. */
export async function startSmsConsentRetention(store: Pick<LifeLinksStore, "purgeExpiredSmsVerificationConsent">,
  logger: Logger): Promise<() => Promise<void>> {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | undefined;
  const purge = async () => {
    try {
      const removed = await store.purgeExpiredSmsVerificationConsent();
      if (removed > 0) logger.info("life_links.sms_consent.expired_removed", { removed_count: removed });
    } catch {
      logger.warn("life_links.sms_consent.cleanup_failed", { reason: "sms_consent_cleanup_pending" });
    }
  };
  const schedule = () => {
    timer = setTimeout(() => {
      timer = undefined;
      running = purge().finally(() => { running = undefined; if (!stopped) schedule(); });
    }, CLEANUP_INTERVAL_MS);
    timer.unref();
  };
  await purge();
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    await running;
  };
}
