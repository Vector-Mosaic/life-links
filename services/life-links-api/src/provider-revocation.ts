import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ProviderAdapter, ProviderRevocationCredential, VerifiedProviderIdentity } from "@vmosaic/provider-sign-in";
import type { LifeLinksConfig } from "./config.js";
import type { ProviderIdentityBinding } from "./provider-sign-in-state.js";

type Cleanup = { identity: ProviderIdentityBinding; encryptedPayload: string };
export type ProviderRevocationService = {
  seal(identity: VerifiedProviderIdentity, credential: ProviderRevocationCredential): { encryptedPayload: string };
  revoke(cleanup: Cleanup): Promise<void>;
};

/** Long-lived deletion credentials have stable custody independent of sessions.
 * Their identity-bound authenticated ciphertext is the sole stored value. */
export function createProviderRevocationService(config: LifeLinksConfig, adapters: ProviderAdapter[]): ProviderRevocationService | undefined {
  if (!config.providerRevocationEncryptionKey) return undefined;
  const key = Buffer.from(config.providerRevocationEncryptionKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== config.providerRevocationEncryptionKey) throw new Error("Provider revocation custody is unavailable.");
  const aad = (identity: ProviderIdentityBinding) => Buffer.from(JSON.stringify([
    "life-links-provider-revocation-v1", identity.provider, identity.issuer, identity.clientId, identity.subject
  ]));
  const matching = (identity: ProviderIdentityBinding, credential: ProviderRevocationCredential) =>
    identity.provider === credential.provider && identity.issuer === credential.issuer &&
    identity.clientId === credential.clientId && identity.subject === credential.subject;
  return {
    seal(identity, credential) {
      if (!matching(identity, credential)) throw new Error("Provider revocation custody is unavailable.");
      const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(aad(identity));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
      return { encryptedPayload: ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), bytes.toString("base64url")].join(".") };
    },
    async revoke(cleanup) {
      try {
        const [version, nonce, tag, bytes, extra] = cleanup.encryptedPayload.split(".");
        if (version !== "v1" || !nonce || !tag || !bytes || extra) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
        decipher.setAAD(aad(cleanup.identity)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
        const credential = JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8")) as ProviderRevocationCredential;
        if (!matching(cleanup.identity, credential)) throw new Error();
        const adapter = adapters.find(adapter => adapter.id === credential.provider);
        if (!adapter?.revoke) throw new Error();
        await adapter.revoke(credential);
      } catch { throw new Error("Provider revocation did not complete."); }
    }
  };
}
