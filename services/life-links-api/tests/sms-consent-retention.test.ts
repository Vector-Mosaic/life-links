import { afterEach, describe, expect, it, vi } from "vitest";
import { startSmsConsentRetention } from "../src/sms-consent-retention.js";
import type { Logger } from "../src/logger.js";

const hour = 60 * 60_000;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture() {
  const store = { purgeExpiredSmsVerificationConsent: vi.fn(async () => 0) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  return { store, logger, typedLogger: logger as unknown as Logger };
}
describe("API-owned SMS consent cleanup lifecycle", () => {
  it("purges at startup without delivery configuration, then hourly, and stops scheduling on shutdown", async () => {
    vi.useFakeTimers(); const f = fixture(), stop = await startSmsConsentRetention(f.store, f.typedLogger);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(hour);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(2);
    await stop(); await vi.advanceTimersByTimeAsync(2 * hour);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(2);
  });
  it("runs purges serially and waits for an in-flight purge before shutdown finishes", async () => {
    vi.useFakeTimers(); const f = fixture(), stop = await startSmsConsentRetention(f.store, f.typedLogger);
    let release!: (removed: number) => void;
    f.store.purgeExpiredSmsVerificationConsent.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.advanceTimersByTime(hour);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3 * hour);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(2);
    let drained = false; const stopping = stop().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    release(0); await stopping; expect(drained).toBe(true);
    await vi.advanceTimersByTimeAsync(hour);
    expect(f.store.purgeExpiredSmsVerificationConsent).toHaveBeenCalledTimes(2);
  });
  it("reports only sanitized cleanup status and retries after a failed purge", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.store.purgeExpiredSmsVerificationConsent.mockRejectedValueOnce(new Error("restricted database context"));
    const stop = await startSmsConsentRetention(f.store, f.typedLogger);
    expect(f.logger.warn).toHaveBeenCalledExactlyOnceWith("life_links.sms_consent.cleanup_failed", { reason: "sms_consent_cleanup_pending" });
    f.store.purgeExpiredSmsVerificationConsent.mockResolvedValueOnce(4);
    await vi.advanceTimersByTimeAsync(hour);
    expect(f.logger.info).toHaveBeenCalledExactlyOnceWith("life_links.sms_consent.expired_removed", { removed_count: 4 });
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain("restricted database context");
    await stop();
  });
});
