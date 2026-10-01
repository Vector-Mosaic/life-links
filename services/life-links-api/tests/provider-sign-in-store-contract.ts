import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LifeLinksStore } from "../src/store.js";
import { hashPassword } from "../src/password.js";
import { invitationFingerprint, memberRegistrationInvitation, prepareMemberInvitation,
  type RegisterOwnerInput, type RegisterProviderOwnerInput } from "../src/registration.js";
import { identityBinding, type ProviderSignInAttempt, type VerifiedProviderIdentity } from "../src/provider-sign-in-state.js";

export function providerSignInStoreContract(getStore: () => LifeLinksStore) {
  const identity = (): VerifiedProviderIdentity => ({ provider: "google", issuer: "https://accounts.google.com",
    clientId: "synthetic-client", subject: randomUUID(), email: `${randomUUID()}@example.test`,
    emailVerified: true, displayName: "Invited owner" });
  const invitation = () => ({ fingerprint: invitationFingerprint(randomUUID()), maxAccounts: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const passwordOwner = async (): Promise<RegisterOwnerInput> => ({ displayName: "Existing owner",
    email: `${randomUUID()}@example.test`, passwordHash: await hashPassword("synthetic-existing-password"),
    timeZone: "America/New_York", invitation: invitation() });
  const providerOwner = (): RegisterProviderOwnerInput => {
    const verified = identity();
    return { identity: verified, displayName: verified.displayName!, email: verified.email!,
      timeZone: "America/New_York", invitation: invitation() };
  };
  const attempt = (): ProviderSignInAttempt => ({ stateHash: invitationFingerprint(randomUUID()),
    browserHash: invitationFingerprint(randomUUID()), provider: "google", encryptedPayload: "synthetic-authenticated-ciphertext",
    expiresAt: new Date(Date.now() + 600_000).toISOString() });

  describe("provider sign-in store contract", () => {
    it("atomically spends one member invitation for one isolated passwordless owner", async () => {
      const store = getStore(), inviter = await store.registerOwner(await passwordOwner());
      const prepared = prepareMemberInvitation(inviter.id);
      await store.createMemberInvitation(prepared.invitation);
      const commands = Array.from({ length: 4 }, () => ({ ...providerOwner(), invitation: memberRegistrationInvitation(prepared.invitation) }));
      const results = await Promise.allSettled(commands.map(command => store.registerProviderOwner(command)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(3);
      const winnerIndex = results.findIndex(result => result.status === "fulfilled");
      const winner = results[winnerIndex];
      if (winner.status !== "fulfilled") throw new Error("Missing provider-created owner");
      const owner = winner.value;
      expect(owner).toMatchObject({ passwordHash: null, agentConnectedAt: null, agentToolCatalogId: null });
      expect(await store.getUserByEmail(owner.email.toUpperCase())).toEqual(owner);
      expect(await store.getUserById(owner.id)).toEqual(owner);
      expect(await store.getProviderUser(commands[winnerIndex].identity)).toEqual(owner);
      expect(await store.listProviderIdentities(owner.id)).toEqual([identityBinding(commands[winnerIndex].identity)]);
      expect(await store.listProviderIdentities(inviter.id)).toEqual([]);
      expect((await store.listLifeLinks(owner.id, null)).items).toEqual([]);
      expect((await store.listCollections(owner.id)).items).toEqual([]);
      expect((await store.listRoutines(owner.id)).items).toEqual([]);
      expect((await store.listCalendars(owner.id)).items).toMatchObject([{ ownerId: owner.id,
        title: "My Calendar", source: "native", isDefault: true, agentAccess: "none", timeZone: "America/New_York" }]);
      expect(await store.registrationAvailable(commands[0].invitation)).toBe(false);
      expect((await store.listMemberInvitations(inviter.id))[0].redeemedAt).not.toBeNull();
      for (let index = 0; index < results.length; index += 1) if (index !== winnerIndex) {
        expect(await store.getUserByEmail(commands[index].email)).toBeNull();
        expect(await store.getProviderUser(commands[index].identity)).toBeNull();
      }
      const tokenHash = invitationFingerprint(randomUUID());
      await store.createSession(owner.id, tokenHash, new Date(Date.now() + 600_000).toISOString());
      expect((await store.getSessionByTokenHash(tokenHash))?.user).toEqual(owner);
    });

    it("shares invitation capacity between manual and provider registration", async () => {
      const store = getStore(), manual = await passwordOwner(), provider = providerOwner();
      const manualCommand = { ...manual, invitation: provider.invitation };
      const results = await Promise.allSettled([store.registerOwner(manualCommand), store.registerProviderOwner(provider)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      expect(await store.registrationAvailable(provider.invitation)).toBe(false);
      const winner = results.find(result => result.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw new Error("Missing admitted owner");
      const losingEmail = winner.value.email === manual.email ? provider.email : manual.email;
      expect(await store.getUserByEmail(losingEmail)).toBeNull();
    });

    it("serializes provider identities across invitations and leaves the losing invitation unspent", async () => {
      const store = getStore(), first = providerOwner(), second = { ...providerOwner(), identity: first.identity };
      const results = await Promise.allSettled([store.registerProviderOwner(first), store.registerProviderOwner(second)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const winner = results.find(result => result.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw new Error("Missing bound owner");
      const loser = winner.value.email === first.email ? second : first;
      expect(await store.registrationAvailable(loser.invitation)).toBe(true);
      expect(await store.getUserByEmail(loser.email)).toBeNull();
      const changedIdentity = { ...first.identity, email: "changed@example.test", emailVerified: false, displayName: "Changed" };
      expect(await store.getProviderUser(changedIdentity)).toEqual(winner.value);
    });

    it("never acquires an existing account by matching email and links only to an explicit owner", async () => {
      const store = getStore(), manual = await passwordOwner(), existing = await store.registerOwner(manual);
      const candidate = { ...providerOwner(), email: existing.email.toUpperCase() };
      candidate.identity.email = existing.email;
      await expect(store.registerProviderOwner(candidate)).rejects.toMatchObject({ code: "registration_failed" });
      expect(await store.getProviderUser(candidate.identity)).toBeNull();
      expect(await store.registrationAvailable(candidate.invitation)).toBe(true);
      expect(await store.getUserById(existing.id)).toEqual(existing);
      await store.linkProviderIdentity(existing.id, candidate.identity);
      await store.linkProviderIdentity(existing.id, candidate.identity);
      expect(await store.getProviderUser(candidate.identity)).toEqual(existing);
      expect((await store.getUserById(existing.id))?.passwordHash).toBe(manual.passwordHash);
      const other = await store.registerOwner(await passwordOwner());
      await expect(store.linkProviderIdentity(other.id, candidate.identity)).rejects.toMatchObject({ code: "provider_identity_conflict" });
      expect(await store.getProviderUser(candidate.identity)).toEqual(existing);
      expect(await store.listProviderIdentities(other.id)).toEqual([]);
    });

    it("keeps identical subjects separate across provider, issuer and client bindings", async () => {
      const store = getStore(), owner = await store.registerOwner(await passwordOwner()), verified = identity();
      await store.linkProviderIdentity(owner.id, verified);
      for (const qualified of [{ ...verified, provider: "microsoft" }, { ...verified, issuer: "https://issuer.example.test" },
        { ...verified, clientId: "another-client" }]) {
        expect(await store.getProviderUser(qualified)).toBeNull();
      }
      expect(await store.getProviderUser(verified)).toEqual(owner);
    });

    it("allows exactly one explicit owner to acquire an unbound identity under concurrent linking", async () => {
      const store = getStore(), first = await store.registerOwner(await passwordOwner()),
        second = await store.registerOwner(await passwordOwner()), verified = identity();
      const owners = [first, second];
      const results = await Promise.allSettled(owners.map(owner => store.linkProviderIdentity(owner.id, verified)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const winnerIndex = results.findIndex(result => result.status === "fulfilled");
      expect(await store.getProviderUser(verified)).toEqual(owners[winnerIndex]);
      expect(await store.listProviderIdentities(owners[1 - winnerIndex].id)).toEqual([]);
    });

    it("refuses cancelled and expired invitations without binding or creating accounts", async () => {
      const store = getStore(), inviter = await store.registerOwner(await passwordOwner());
      for (const expired of [false, true]) {
        const prepared = prepareMemberInvitation(inviter.id);
        if (expired) { prepared.invitation.createdAt = "2020-01-01T00:00:00.000Z"; prepared.invitation.expiresAt = "2020-01-08T00:00:00.000Z"; }
        await store.createMemberInvitation(prepared.invitation);
        if (!expired) await store.revokeMemberInvitation(inviter.id, prepared.invitation.id);
        const command = { ...providerOwner(), invitation: memberRegistrationInvitation(prepared.invitation) };
        await expect(store.registerProviderOwner(command)).rejects.toMatchObject({ code: "registration_unavailable" });
        expect(await store.getUserByEmail(command.email)).toBeNull();
        expect(await store.getProviderUser(command.identity)).toBeNull();
      }
    });

    it("preserves browser-bound attempts on an incorrect browser and consumes once under concurrency", async () => {
      const store = getStore(), pending = attempt(), wrongBrowser = invitationFingerprint(randomUUID());
      await store.saveProviderSignInAttempt(pending);
      expect(await store.getProviderSignInAttempt(pending.stateHash, wrongBrowser)).toBeNull();
      expect(await store.consumeProviderSignInAttempt(pending.stateHash, wrongBrowser)).toBeNull();
      const read = await store.getProviderSignInAttempt(pending.stateHash, pending.browserHash);
      expect(read).toEqual(pending);
      if (read) read.encryptedPayload = "changed-copy";
      expect(await store.getProviderSignInAttempt(pending.stateHash, pending.browserHash)).toEqual(pending);
      await expect(store.saveProviderSignInAttempt({ ...pending, encryptedPayload: "replacement" }))
        .rejects.toMatchObject({ code: "provider_sign_in_unavailable" });
      const consumed = await Promise.all(Array.from({ length: 5 }, () => store.consumeProviderSignInAttempt(pending.stateHash, pending.browserHash)));
      expect(consumed.filter(Boolean)).toEqual([pending]);
      expect(await store.getProviderSignInAttempt(pending.stateHash, pending.browserHash)).toBeNull();
      expect(await store.consumeProviderSignInAttempt(pending.stateHash, pending.browserHash)).toBeNull();
    });

    it("does not return expired attempts or accept malformed state fingerprints", async () => {
      const store = getStore(), expired = { ...attempt(), expiresAt: "2020-01-01T00:00:00.000Z" };
      await store.saveProviderSignInAttempt(expired);
      expect(await store.getProviderSignInAttempt(expired.stateHash, expired.browserHash)).toBeNull();
      expect(await store.consumeProviderSignInAttempt(expired.stateHash, expired.browserHash)).toBeNull();
      expect(await store.getProviderSignInAttempt("not-a-fingerprint", expired.browserHash)).toBeNull();
      await expect(store.saveProviderSignInAttempt({ ...attempt(), stateHash: "not-a-fingerprint" }))
        .rejects.toMatchObject({ code: "provider_sign_in_unavailable" });
    });
  });
}
