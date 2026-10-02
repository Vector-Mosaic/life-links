import { describe, expect, it } from "vitest";
import { assertVerificationLimits, nextVerificationLimitReservation,
  type VerificationLimit, type VerificationLimitReservation } from "../src/contact-verification-state.js";

const day = 24 * 60 * 60_000;
const start = Date.parse("2026-10-01T23:59:00.000Z");
const limit: VerificationLimit = { keyHash: "a".repeat(64), max: 10, windowMs: day, windowType: "rolling" };

describe("contact verification reservation windows", () => {
  it("keeps ten reservations across midnight and frees only the individually expired slot", () => {
    let saved: VerificationLimitReservation | undefined;
    const times = Array.from({ length: 10 }, (_, index) => start + index * 60_000);
    for (const time of times) saved = nextVerificationLimitReservation(limit, saved, time);
    expect(saved?.count).toBe(10);
    expect(nextVerificationLimitReservation(limit, saved, start + day - 1).count).toBe(11);
    const next = nextVerificationLimitReservation(limit, saved, start + day);
    expect(next.count).toBe(10);
    expect(next.reservedAt).toEqual([...times.slice(1), start + day]);
    expect(next.expiresAt).toBe(start + 2 * day);
    expect(nextVerificationLimitReservation(limit, next, start + day + 1).count).toBe(11);
  });

  it("prunes multiple aged reservations while retaining those strictly inside the window", () => {
    const saved = { count: 4, expiresAt: start + 2 * day, reservedAt: [start, start + 1, start + 2, start + day] };
    expect(nextVerificationLimitReservation(limit, saved, start + day + 1)).toEqual({
      count: 3, expiresAt: start + 2 * day + 1, reservedAt: [start + 2, start + day, start + day + 1],
    });
  });

  it("starts fresh only after the complete previous history has expired", () => {
    const saved = { count: 1, expiresAt: start + day, reservedAt: [start] };
    expect(nextVerificationLimitReservation(limit, saved, start + day)).toEqual({
      count: 1, expiresAt: start + 2 * day, reservedAt: [start + day],
    });
  });

  it("preserves fixed-window count and expiry without interpreting it as rolling history", () => {
    const fixed = { ...limit, windowType: undefined };
    const saved = { count: 4, expiresAt: start + day, reservedAt: [] };
    expect(nextVerificationLimitReservation(fixed, saved, start + 1)).toEqual({ ...saved, count: 5 });
    expect(nextVerificationLimitReservation(fixed, saved, start + day)).toEqual({
      count: 1, expiresAt: start + 2 * day, reservedAt: [],
    });
  });

  it("fails closed when a rolling row lacks complete valid reservation history", () => {
    for (const reservedAt of [[], [start, start + 1], [Number.NaN], [start + 0.5]]) {
      expect(() => nextVerificationLimitReservation(limit, { count: 1, expiresAt: start + day, reservedAt }, start + 1))
        .toThrowError("verification_unavailable");
    }
  });

  it("retains later reservation times and their full expiry if the clock moves backwards", () => {
    const saved = { count: 1, expiresAt: start + day, reservedAt: [start] };
    expect(nextVerificationLimitReservation(limit, saved, start - 1)).toEqual({
      count: 2, expiresAt: start + day, reservedAt: [start, start - 1],
    });
  });

  it("rejects an unsupported window type before reserving a budget", () => {
    expect(() => assertVerificationLimits([{ ...limit, windowType: "calendar" as "rolling" }]))
      .toThrowError("verification_unavailable");
    expect(() => assertVerificationLimits([limit])).not.toThrow();
  });
});
