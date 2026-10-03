import { createCipheriv } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ProviderRevocationCredential, VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import { readConfig } from "../src/config.js";
import { createProviderRevocationService } from "../src/provider-revocation.js";
import type { ProviderIdentityBinding } from "../src/provider-sign-in-state.js";

const stableKey = Buffer.alloc(32, 71).toString("base64");
const identity: VerifiedProviderIdentity = {
  provider: "apple", issuer: "https://appleid.apple.com", clientId: "synthetic-services-client",
  subject: "synthetic-apple-subject", email: "owner@example.test", emailVerified: true, displayName: "Owner",
};
const credential: ProviderRevocationCredential = {
  provider: "apple", issuer: identity.issuer, clientId: identity.clientId, subject: identity.subject,
  token: "restricted-synthetic-refresh-token", tokenTypeHint: "refresh_token",
};

function setup(options: { encryptionKey?: string; sessionSecret?: string; noKey?: boolean; noAdapter?: boolean } = {}) {
  const config = readConfig({ NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory",
    QR_BASE_URL: "https://product.example.test", SESSION_SECRET: options.sessionSecret ?? "synthetic-session-secret-before-rotation",
    ...(options.noKey ? {} : { LIFE_LINKS_PROVIDER_REVOCATION_ENCRYPTION_KEY: options.encryptionKey ?? stableKey }) });
  const revoke = vi.fn(async (_credential: ProviderRevocationCredential): Promise<void> => {});
  const adapter: ProviderAdapter = {
    id: "apple", displayName: "Apple", responseMode: "form_post",
    authorizationUrl: vi.fn(async () => "https://appleid.apple.com/auth/authorize"),
    redeem: vi.fn(async () => ({ ...identity })), revoke,
  };
  const service = createProviderRevocationService(config, options.noAdapter ? [] : [adapter]);
  return { config, adapter, revoke, service };
}

function flipSegment(payload: string, index: number): string {
  const parts = payload.split("."), bytes = Buffer.from(parts[index], "base64url");
  bytes[0] ^= 1; parts[index] = bytes.toString("base64url"); return parts.join(".");
}

describe("product Apple revocation custody", () => {
  it("requires stable canonical 32-byte custody before enabling Apple, without exposing submitted configuration", () => {
    const env = { NODE_ENV: "test", AUTO_SEED: "false", LIFE_LINKS_STORE: "memory", QR_BASE_URL: "https://product.example.test",
      LIFE_LINKS_SIGN_IN_PROVIDERS: "apple", LIFE_LINKS_SIGN_IN_APPLE_CLIENT_ID: "synthetic-services-client",
      LIFE_LINKS_SIGN_IN_APPLE_REDIRECT_URI: "https://product.example.test/api/auth/providers/apple/callback",
      LIFE_LINKS_SIGN_IN_APPLE_TEAM_ID: "SYNTHETIC0", LIFE_LINKS_SIGN_IN_APPLE_KEY_ID: "FIXTURE000",
      LIFE_LINKS_SIGN_IN_APPLE_PRIVATE_KEY: "synthetic-private-key-not-for-output" };
    for (const key of [undefined, "", "private-malformed-key", Buffer.alloc(31, 2).toString("base64"), stableKey.slice(0, -1)]) {
      let failure: unknown;
      try { readConfig({ ...env, ...(key === undefined ? {} : { LIFE_LINKS_PROVIDER_REVOCATION_ENCRYPTION_KEY: key }) }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain("stable provider revocation encryption custody");
      expect(String(failure)).not.toContain(env.LIFE_LINKS_SIGN_IN_APPLE_PRIVATE_KEY);
      if (key) expect(String(failure)).not.toContain(key);
    }
    expect(readConfig({ ...env, LIFE_LINKS_PROVIDER_REVOCATION_ENCRYPTION_KEY: stableKey }).providerRevocationEncryptionKey).toBe(stableKey);
  });

  it("seals only authenticated ciphertext and privately restores the exact token for revocation", async () => {
    const ctx = setup();
    const sealed = ctx.service!.seal(identity, credential);
    const second = ctx.service!.seal(identity, credential);
    expect(Object.keys(sealed)).toEqual(["encryptedPayload"]);
    expect(sealed.encryptedPayload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed.encryptedPayload).not.toBe(second.encryptedPayload);
    for (const privateValue of [credential.token, credential.subject, credential.clientId, identity.email!]) {
      expect(JSON.stringify(sealed)).not.toContain(privateValue);
    }
    await ctx.service!.revoke({ identity, ...sealed });
    expect(ctx.revoke).toHaveBeenCalledOnce();
    expect(ctx.revoke).toHaveBeenCalledWith(credential);
    expect(ctx.adapter.authorizationUrl).not.toHaveBeenCalled();
    expect(ctx.adapter.redeem).not.toHaveBeenCalled();
  });

  it.each(["provider", "issuer", "clientId", "subject"] as const)("rejects a seal for mismatched %s custody", (field) => {
    const ctx = setup();
    const altered = { ...identity, [field]: `other-${field}` } as VerifiedProviderIdentity;
    expect(() => ctx.service!.seal(altered, credential)).toThrow("Provider revocation custody is unavailable.");
    expect(ctx.revoke).not.toHaveBeenCalled();
  });

  it.each(["provider", "issuer", "clientId", "subject"] as const)("binds ciphertext to the full identity tuple, including %s", async (field) => {
    const ctx = setup(), sealed = ctx.service!.seal(identity, credential);
    const altered = { ...identity, [field]: `other-${field}` } as ProviderIdentityBinding;
    await expect(ctx.service!.revoke({ identity: altered, ...sealed })).rejects.toThrow("Provider revocation did not complete.");
    expect(ctx.revoke).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])("rejects tampering with sealed segment %i before provider access", async (segment) => {
    const ctx = setup(), sealed = ctx.service!.seal(identity, credential);
    await expect(ctx.service!.revoke({ identity, encryptedPayload: flipSegment(sealed.encryptedPayload, segment) })).rejects.toThrow("Provider revocation did not complete.");
    expect(ctx.revoke).not.toHaveBeenCalled();
  });

  it.each(["unknown-version", "missing-segment", "extra-segment"])("rejects malformed %s custody safely", async (kind) => {
    const ctx = setup(), sealed = ctx.service!.seal(identity, credential);
    const encryptedPayload = kind === "unknown-version" ? sealed.encryptedPayload.replace(/^v1\./, "v2.") :
      kind === "missing-segment" ? sealed.encryptedPayload.split(".").slice(0, 3).join(".") : `${sealed.encryptedPayload}.unexpected`;
    await expect(ctx.service!.revoke({ identity, encryptedPayload })).rejects.toThrow("Provider revocation did not complete.");
    expect(ctx.revoke).not.toHaveBeenCalled();
  });

  it("survives SESSION_SECRET rotation using its independent stable encryption key", async () => {
    const original = setup(), sealed = original.service!.seal(identity, credential);
    const rotatedSession = setup({ sessionSecret: "different-synthetic-session-secret-after-rotation" });
    await rotatedSession.service!.revoke({ identity, ...sealed });
    expect(rotatedSession.revoke).toHaveBeenCalledWith(credential);
    expect(original.revoke).not.toHaveBeenCalled();
  });

  it("rejects the wrong stable encryption key without provider access", async () => {
    const original = setup(), sealed = original.service!.seal(identity, credential);
    const wrongKey = setup({ encryptionKey: Buffer.alloc(32, 89).toString("base64") });
    await expect(wrongKey.service!.revoke({ identity, ...sealed })).rejects.toThrow("Provider revocation did not complete.");
    expect(wrongKey.revoke).not.toHaveBeenCalled();
  });

  it("rechecks plaintext identity association after authenticating stored ciphertext", async () => {
    const ctx = setup(), nonce = Buffer.alloc(12, 3), cipher = createCipheriv("aes-256-gcm", Buffer.from(stableKey, "base64"), nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(["life-links-provider-revocation-v1", identity.provider, identity.issuer, identity.clientId, identity.subject])));
    const bytes = Buffer.concat([cipher.update(JSON.stringify({ ...credential, subject: "different-retained-subject" }), "utf8"), cipher.final()]);
    const encryptedPayload = ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), bytes.toString("base64url")].join(".");
    await expect(ctx.service!.revoke({ identity, encryptedPayload })).rejects.toThrow("Provider revocation did not complete.");
    expect(ctx.revoke).not.toHaveBeenCalled();
  });

  it("does not claim cleanup when the selected provider capability is unavailable", async () => {
    const ctx = setup({ noAdapter: true }), sealed = ctx.service!.seal(identity, credential);
    await expect(ctx.service!.revoke({ identity, ...sealed })).rejects.toThrow("Provider revocation did not complete.");
    expect(ctx.revoke).not.toHaveBeenCalled();
    expect(setup({ noKey: true }).service).toBeUndefined();
  });

  it("suppresses upstream token and provider details from cleanup diagnostics", async () => {
    const ctx = setup(), sealed = ctx.service!.seal(identity, credential);
    ctx.revoke.mockRejectedValueOnce(new Error(`provider-private-details ${credential.token}`));
    const error = await ctx.service!.revoke({ identity, ...sealed }).catch(error => error) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe("Error: Provider revocation did not complete.");
    expect(error.cause).toBeUndefined();
    for (const privateValue of [credential.token, "provider-private-details", sealed.encryptedPayload]) {
      expect(String(error)).not.toContain(privateValue); expect(JSON.stringify(error)).not.toContain(privateValue);
    }
    expect(ctx.revoke).toHaveBeenCalledOnce();
  });
});
