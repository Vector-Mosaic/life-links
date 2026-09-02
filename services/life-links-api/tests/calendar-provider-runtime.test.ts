import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarAuthorizationService } from "../src/calendar-authorization.js";
import type { CalendarProviderGateway } from "../src/calendar-provider-gateway.js";
import type { CalendarProviderSubscriptionService } from "../src/calendar-provider-subscriptions.js";
import { CalendarProviderRuntime } from "../src/calendar-provider-runtime.js";
import { createLogger, type LogEvent } from "../src/logger.js";

const MICROSOFT = "microsoft-graph-calendar", GOOGLE = "google-calendar";
const WINDOW = { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-10-01T00:00:00.000Z" };
type SyncInput = NonNullable<Parameters<CalendarProviderGateway["listSynchronizationTargets"]>[0]>;

function target(providerKey: string, suffix: string) {
  return { ownerId: "owner", connectionId: `${providerKey}-connection`, calendarId: `${providerKey}-${suffix}`, providerKey };
}

function fixture(providerKeys: readonly string[] = [MICROSOFT, GOOGLE]) {
  const gateway = {
    retryPendingRevocations: vi.fn(async (_input: { providerKey?: string; limit?: number }) => ({ attempted: 0, completed: 0 })),
    listSynchronizationTargets: vi.fn(async (input: SyncInput) => ({
      targets: [target(input.providerKey!, "one"), target(input.providerKey!, "two")],
      nextCursor: input.cursor ? null : `${input.providerKey}-cursor`
    })),
    synchronizeCalendar: vi.fn(async (_input: Parameters<CalendarProviderGateway["synchronizeCalendar"]>[0]) => {}),
    listRetryableCommands: vi.fn(async (input: { providerKey?: string; limit?: number }) => [
      { commandId: `${input.providerKey}-command-one` }, { commandId: `${input.providerKey}-command-two` }
    ]),
    retryCommand: vi.fn(async (_commandId: string) => {})
  };
  const authorization = {
    secrets: { deleteExpired: vi.fn(async (_now: string) => {}) },
    initialWindow: vi.fn(() => WINDOW)
  };
  const subscriptions = { reconcileHints: vi.fn(async (_window: typeof WINDOW) => {}), ensureConnection: vi.fn(async (_id: string) => {}) };
  const logs: LogEvent[] = [];
  const runtime = new CalendarProviderRuntime(gateway as unknown as CalendarProviderGateway,
    authorization as unknown as CalendarAuthorizationService, createLogger("calendar-runtime-test", { env: "test", sink: (event) => logs.push(event) }),
    60_000, subscriptions as unknown as CalendarProviderSubscriptionService, providerKeys);
  return { runtime, gateway, authorization, subscriptions, logs };
}

afterEach(() => { vi.useRealTimers(); });

describe("Calendar provider runtime", () => {
  it("maintains independent provider cursors, exact retry filters and Microsoft-only subscriptions", async () => {
    const f = fixture();
    await f.runtime.sweep();
    await f.runtime.sweep();
    expect(f.gateway.listSynchronizationTargets.mock.calls.map(([input]) => input)).toEqual([
      { providerKey: MICROSOFT, limit: 20, cursor: undefined },
      { providerKey: GOOGLE, limit: 20, cursor: undefined },
      { providerKey: MICROSOFT, limit: 20, cursor: `${MICROSOFT}-cursor` },
      { providerKey: GOOGLE, limit: 20, cursor: `${GOOGLE}-cursor` }
    ]);
    const retryInputs = [MICROSOFT, GOOGLE, MICROSOFT, GOOGLE].map((providerKey) => [{ providerKey, limit: 10 }]);
    expect(f.gateway.retryPendingRevocations.mock.calls).toEqual(retryInputs);
    expect(f.gateway.listRetryableCommands.mock.calls).toEqual(retryInputs);
    expect(f.gateway.retryCommand.mock.calls.flat()).toEqual([
      `${MICROSOFT}-command-one`, `${MICROSOFT}-command-two`, `${GOOGLE}-command-one`, `${GOOGLE}-command-two`,
      `${MICROSOFT}-command-one`, `${MICROSOFT}-command-two`, `${GOOGLE}-command-one`, `${GOOGLE}-command-two`
    ]);
    expect(f.gateway.synchronizeCalendar.mock.calls.map(([input]) => input)).toEqual(
      [MICROSOFT, GOOGLE, MICROSOFT, GOOGLE].flatMap((providerKey) => ["one", "two"].map((suffix) => ({ ...target(providerKey, suffix), window: WINDOW })))
    );
    expect(f.subscriptions.ensureConnection.mock.calls).toEqual([[`${MICROSOFT}-connection`], [`${MICROSOFT}-connection`]]);
    expect(f.subscriptions.reconcileHints).toHaveBeenCalledTimes(2);
    expect(f.subscriptions.reconcileHints).toHaveBeenCalledWith(WINDOW);
    await f.runtime.sweep();
    expect(f.gateway.listSynchronizationTargets.mock.calls.slice(-2).map(([input]) => input.cursor)).toEqual([undefined, undefined]);
  });

  it("does not invoke Microsoft subscription paths for a Google-only runtime", async () => {
    const f = fixture([GOOGLE]);
    await f.runtime.sweep();
    expect(f.subscriptions.reconcileHints).not.toHaveBeenCalled();
    expect(f.subscriptions.ensureConnection).not.toHaveBeenCalled();
    expect(f.gateway.listSynchronizationTargets).toHaveBeenCalledOnce();
    expect(f.gateway.retryPendingRevocations).toHaveBeenCalledWith({ providerKey: GOOGLE, limit: 10 });
    expect(f.gateway.listRetryableCommands).toHaveBeenCalledWith({ providerKey: GOOGLE, limit: 10 });
  });

  it.each((["revocation", "targets", "sync", "retry-list", "retry-command"] as const)
    .flatMap((stage) => [MICROSOFT, GOOGLE].map((providerKey) => ({ stage, providerKey }))))(
    "continues other work after $providerKey $stage failure", async ({ stage, providerKey }) => {
      const other = providerKey === MICROSOFT ? GOOGLE : MICROSOFT;
      const f = fixture([providerKey, other]);
      const failure = new Error("private-provider-or-token-details");
      if (stage === "revocation") f.gateway.retryPendingRevocations.mockRejectedValueOnce(failure);
      if (stage === "targets") f.gateway.listSynchronizationTargets.mockRejectedValueOnce(failure);
      if (stage === "sync") f.gateway.synchronizeCalendar.mockRejectedValueOnce(failure);
      if (stage === "retry-list") f.gateway.listRetryableCommands.mockRejectedValueOnce(failure);
      if (stage === "retry-command") f.gateway.retryCommand.mockRejectedValueOnce(failure);
      await expect(f.runtime.sweep()).resolves.toBeUndefined();
      expect(f.gateway.synchronizeCalendar).toHaveBeenCalledWith({ ...target(other, "one"), window: WINDOW });
      expect(f.gateway.synchronizeCalendar).toHaveBeenCalledWith({ ...target(other, "two"), window: WINDOW });
      expect(f.gateway.retryPendingRevocations).toHaveBeenCalledWith({ providerKey: other, limit: 10 });
      expect(f.gateway.retryCommand).toHaveBeenCalledWith(`${other}-command-one`);
      expect(f.gateway.retryCommand).toHaveBeenCalledWith(`${other}-command-two`);
      if (stage !== "targets") expect(f.gateway.synchronizeCalendar).toHaveBeenCalledWith({ ...target(providerKey, "two"), window: WINDOW });
      if (stage !== "retry-list") expect(f.gateway.retryCommand).toHaveBeenCalledWith(`${providerKey}-command-two`);
      expect(f.logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(f.logs)).not.toContain(failure.message);
      if (stage === "targets") {
        await f.runtime.sweep();
        expect(f.gateway.listSynchronizationTargets.mock.calls[2][0].cursor).toBeUndefined();
        expect(f.gateway.listSynchronizationTargets.mock.calls[3][0].cursor).toBe(`${other}-cursor`);
      }
    }
  );

  it("continues synchronization after expired-secret cleanup or Microsoft subscription failures", async () => {
    const f = fixture();
    f.authorization.secrets.deleteExpired.mockRejectedValueOnce(new Error("private-cache-error"));
    f.subscriptions.reconcileHints.mockRejectedValueOnce(new Error("private-hint-error"));
    f.subscriptions.ensureConnection.mockRejectedValueOnce(new Error("private-subscription-error"));
    await expect(f.runtime.sweep()).resolves.toBeUndefined();
    expect(f.gateway.synchronizeCalendar).toHaveBeenCalledTimes(4);
    expect(f.gateway.retryCommand).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(f.logs)).not.toContain("private-");
  });

  it("keeps scheduled sweeps serial, coalesces wake requests and stops without further provider work", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    f.gateway.synchronizeCalendar.mockImplementationOnce(async () => held);
    f.runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.gateway.synchronizeCalendar).toHaveBeenCalledTimes(1);
    expect(f.gateway.listSynchronizationTargets).toHaveBeenCalledTimes(1);
    f.runtime.start(); f.runtime.wake(); f.runtime.wake();
    await vi.advanceTimersByTimeAsync(5);
    expect(f.gateway.synchronizeCalendar).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(5);
    expect(f.authorization.secrets.deleteExpired).toHaveBeenCalledTimes(2);
    expect(f.gateway.synchronizeCalendar).toHaveBeenCalledTimes(8);
    await f.runtime.stop();
    f.runtime.start(); f.runtime.wake();
    await f.runtime.sweep();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.gateway.synchronizeCalendar).toHaveBeenCalledTimes(8);
    expect(vi.getTimerCount()).toBe(0);
  });
});
