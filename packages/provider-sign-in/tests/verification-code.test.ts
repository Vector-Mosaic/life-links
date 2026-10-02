import { describe, expect, it } from "vitest";
import { generateVerificationCode, hashVerificationCode, matchesVerificationCode, VerificationCodeError, type VerificationCodeBinding } from "../src/verification-code.js";

const binding: VerificationCodeBinding = { code: "004217", channel: "email", destination: "Recipient@Example.test", challengeId: "challenge-1", purpose: "signup", key: "synthetic-consumer-secret-of-at-least-32-bytes" };

describe("shared verification code protection", () => {
  it("generates six ASCII digits, preserving leading-zero inputs", () => {
    for (let sample = 0; sample < 20; sample += 1) expect(generateVerificationCode()).toMatch(/^[0-9]{6}$/u);
    const digest = hashVerificationCode(binding);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(matchesVerificationCode({ ...binding, digest })).toBe(true);
  });

  it("binds the exact channel, destination, challenge, purpose, code and consumer key", () => {
    const digest = hashVerificationCode(binding);
    for (const changed of [
      { channel: "sms" as const }, { code: "004218" }, { challengeId: "challenge-2" },
      { destination: "recipient@example.test" }, { purpose: "recovery" },
      { key: "a-different-consumer-secret-of-at-least-32-bytes" },
    ]) expect(matchesVerificationCode({ ...binding, ...changed, digest })).toBe(false);
    const sms = { ...binding, channel: "sms" as const, destination: "+12025550123", purpose: "link" };
    expect(matchesVerificationCode({ ...sms, digest: hashVerificationCode(sms) })).toBe(true);
    // Destination syntax/normalization is owned by the consumer and delivery transport.
    expect(hashVerificationCode({ ...binding, destination: "opaque-canonical-destination" })).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses unambiguous tuple framing", () => {
    expect(hashVerificationCode({ ...binding, challengeId: "a:b", purpose: "c" }))
      .not.toBe(hashVerificationCode({ ...binding, challengeId: "a", purpose: "b:c" }));
  });

  it("measures key bounds in bytes and accepts equivalent binary keys", () => {
    const binaryKey = Buffer.from(binding.key as string, "utf8");
    expect(hashVerificationCode({ ...binding, key: binaryKey })).toBe(hashVerificationCode(binding));
    for (const key of ["a".repeat(32), new Uint8Array(32), "é".repeat(16), "a".repeat(4096), new Uint8Array(4096)]) {
      expect(hashVerificationCode({ ...binding, key })).toMatch(/^[a-f0-9]{64}$/u);
    }
    for (const key of ["a".repeat(31), new Uint8Array(31), "é".repeat(15), "a".repeat(4097), new Uint8Array(4097), "é".repeat(2049)]) {
      expect(() => hashVerificationCode({ ...binding, key })).toThrow(VerificationCodeError);
    }
  });

  it("refuses malformed bindings with a generic error and makes malformed matches false", () => {
    for (const changed of [
      { code: "4217" }, { code: " 004217" }, { code: "１２３４５６" }, { code: "1234567" }, { code: "123456\n" },
      { channel: "voice" }, { destination: "" }, { destination: "private\nvalue" }, { destination: "x".repeat(513) },
      { challengeId: "" }, { challengeId: "x".repeat(513) }, { purpose: "" }, { purpose: "x".repeat(129) }, { key: null },
    ]) {
      const invalid = { ...binding, ...changed } as VerificationCodeBinding;
      expect(() => hashVerificationCode(invalid)).toThrow("invalid_request");
      expect(matchesVerificationCode({ ...invalid, digest: "0".repeat(64) })).toBe(false);
    }
    for (const invalid of [null, undefined, "private"]) {
      expect(() => hashVerificationCode(invalid as unknown as VerificationCodeBinding)).toThrow(VerificationCodeError);
      expect(matchesVerificationCode(invalid as unknown as VerificationCodeBinding & { digest: string })).toBe(false);
    }
    const error = (() => { try { hashVerificationCode({ ...binding, key: "private-short" }); } catch (failure) { return failure; } })();
    expect(String(error)).not.toContain("private-short");
    expect(error).not.toHaveProperty("cause");
  });

  it("rejects malformed stored digests without throwing", () => {
    for (const digest of ["", "f".repeat(63), "z".repeat(64), "F".repeat(64), "f".repeat(64) + "\n", hashVerificationCode(binding) + "\n", null, 1]) {
      expect(matchesVerificationCode({ ...binding, digest } as VerificationCodeBinding & { digest: string })).toBe(false);
    }
  });
});
