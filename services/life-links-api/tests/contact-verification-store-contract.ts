import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LifeLinksStore, StoredUser } from "../src/store.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { invitationFingerprint, memberRegistrationInvitation, prepareMemberInvitation,
  type RegisterOwnerInput, type RegistrationInvitation } from "../src/registration.js";
import { type ContactVerificationAttempt, type FinalizeVerifiedRegistrationInput,
  type PhoneBinding, type VerificationLimit } from "../src/contact-verification-state.js";

export function contactVerificationStoreContract(getStore: () => LifeLinksStore) {
  const fingerprint = () => invitationFingerprint(randomUUID());
  const attempt = (changes: Partial<ContactVerificationAttempt> = {}): ContactVerificationAttempt => ({
    tokenHash: fingerprint(), browserHash: fingerprint(), addressHash: fingerprint(), channel: "email",
    intent: "register", phase: "send_pending", encryptedPayload: "synthetic-authenticated-ciphertext",
    expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAt: new Date(Date.now() + 60_000).toISOString(),
    version: 1, checkCount: 0, ...changes,
  });
  const phone = (phoneHash = fingerprint()): PhoneBinding => ({ phoneHash, maskedNumber: "+*******1234" });
  const invitation = (): RegistrationInvitation => ({ fingerprint: fingerprint(), maxAccounts: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const existingOwner = (): RegisterOwnerInput => ({ displayName: "Existing owner", email: `${randomUUID()}@example.test`,
    passwordHash: "synthetic-existing-password-hash", timeZone: "America/New_York", invitation: invitation() });
  const emailRegistration = (changes: Partial<ContactVerificationAttempt> = {}) => {
    // Address fingerprints are consumer-keyed; the consumer's encrypted payload binds the actual address.
    const pending = attempt({ phase: "verified", ...changes });
    const command: FinalizeVerifiedRegistrationInput = { tokenHash: pending.tokenHash, browserHash: pending.browserHash,
      expectedVersion: pending.version, displayName: "Verified owner", email: `${randomUUID()}@example.test`,
      passwordHash: "synthetic-verified-password-hash", timeZone: "America/New_York" };
    return { pending, command };
  };
  const phoneRegistration = (binding = phone(), changes: Partial<ContactVerificationAttempt> = {}) => {
    const pending = attempt({ channel: "phone", addressHash: binding.phoneHash, phase: "verified", ...changes });
    const command: FinalizeVerifiedRegistrationInput = { tokenHash: pending.tokenHash, browserHash: pending.browserHash,
      expectedVersion: pending.version, displayName: "Phone owner", email: null, passwordHash: null,
      timeZone: "America/New_York", phoneBinding: binding };
    return { pending, command };
  };
  const consumption = (pending: ContactVerificationAttempt) => ({ tokenHash: pending.tokenHash,
    browserHash: pending.browserHash, expectedVersion: pending.version });
  const liveSession = async (store: LifeLinksStore, ownerId: string) => {
    const sessionTokenHash = fingerprint();
    await store.createSession(ownerId, sessionTokenHash, new Date(Date.now() + 3_600_000).toISOString());
    return sessionTokenHash;
  };
  const read = (store: LifeLinksStore, pending: ContactVerificationAttempt) =>
    store.getContactVerificationAttempt(pending.tokenHash, pending.browserHash);
  const assertPrivateOwner = async (store: LifeLinksStore, owner: StoredUser) => {
    expect(owner).toMatchObject({ agentConnectedAt: null, agentToolCatalogId: null });
    const calendars = await store.listCalendars(owner.id);
    expect(calendars.items).toHaveLength(1);
    expect(calendars.items[0]).toMatchObject({ ownerId: owner.id, title: "My Calendar", source: "native",
      isDefault: true, agentAccess: "none", timeZone: "America/New_York" });
    expect((await store.listLifeLinks(owner.id, null)).items).toEqual([]);
    expect((await store.listCollections(owner.id)).items).toEqual([]);
    expect((await store.listRoutines(owner.id)).items).toEqual([]);
    expect(await store.listProviderIdentities(owner.id)).toEqual([]);
    expect(await store.listMemberInvitations(owner.id)).toEqual([]);
  };

  describe("contact verification store contract", () => {
    it("reads opaque attempts only for their browser, returns copies and hides expired state", async () => {
      const store = getStore(), pending = attempt();
      await store.createContactVerificationAttempt(pending);
      expect(await store.getContactVerificationAttempt(pending.tokenHash, fingerprint())).toBeNull();
      expect(await store.getContactVerificationAttempt("not-a-fingerprint", pending.browserHash)).toBeNull();
      const copy = await read(store, pending);
      expect(copy).toEqual(pending);
      if (copy) copy.encryptedPayload = "changed-copy";
      expect(await read(store, pending)).toEqual(pending);
      const expired = attempt({ expiresAt: "2020-01-01T00:00:00.000Z" });
      await store.createContactVerificationAttempt(expired);
      expect(await read(store, expired)).toBeNull();
      expect(await store.updateContactVerificationAttempt({ ...expired, phase: "sent", version: 2 }, 1)).toBe(false);
    });

    it("rejects malformed initial state and cannot replace an existing token", async () => {
      const store = getStore(), pending = attempt();
      const invalid = [attempt({ tokenHash: "not-a-fingerprint" }), attempt({ version: 2 }),
        attempt({ phase: "consumed" }), attempt({ checkCount: 6 }), attempt({ encryptedPayload: "" }),
        attempt({ browserHash: "not-a-fingerprint" })];
      for (const candidate of invalid) {
        await expect(store.createContactVerificationAttempt(candidate))
          .rejects.toMatchObject({ code: "verification_unavailable" });
      }
      await store.createContactVerificationAttempt(pending);
      await expect(store.createContactVerificationAttempt({ ...pending, encryptedPayload: "replacement-ciphertext" }))
        .rejects.toMatchObject({ code: "verification_unavailable" });
      expect(await read(store, pending)).toEqual(pending);
    });

    it("serializes attempt updates with compare-and-swap under concurrency", async () => {
      const store = getStore(), pending = attempt();
      await store.createContactVerificationAttempt(pending);
      const proposals = Array.from({ length: 5 }, (_, index) => ({ ...pending, phase: "sent" as const,
        encryptedPayload: `synthetic-updated-ciphertext-${index}`, version: 2 }));
      const results = await Promise.all(proposals.map(next => store.updateContactVerificationAttempt(next, 1)));
      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = proposals[results.findIndex(Boolean)];
      expect(await read(store, pending)).toEqual(winner);
      expect(await store.updateContactVerificationAttempt({ ...winner, phase: "verifying", version: 3 }, 1)).toBe(false);
      expect(await store.updateContactVerificationAttempt({ ...winner, phase: "verifying", version: 4 }, 2)).toBe(false);
      expect(await read(store, pending)).toEqual(winner);
    });

    it("keeps contact, browser, intent and expiry bindings immutable and reserves consumption for finalization", async () => {
      const store = getStore(), pending = attempt({ phase: "sent" });
      await store.createContactVerificationAttempt(pending);
      const changes: Partial<ContactVerificationAttempt>[] = [{ tokenHash: fingerprint() }, { browserHash: fingerprint() },
        { addressHash: fingerprint() }, { channel: "phone" }, { intent: "login" },
        { expiresAt: new Date(Date.now() + 1_200_000).toISOString() }, { phase: "consumed" }];
      for (const changed of changes) {
        expect(await store.updateContactVerificationAttempt({ ...pending, ...changed, version: 2 }, 1)).toBe(false);
        expect(await read(store, pending)).toEqual(pending);
      }
      await expect(store.updateContactVerificationAttempt({ ...pending, version: 2, checkCount: 6 }, 1))
        .rejects.toMatchObject({ code: "verification_unavailable" });
      expect(await read(store, pending)).toEqual(pending);
    });

    it("accepts fresh local phone verification while an expired attempt remains unusable after cleanup", async () => {
      const store = getStore(), addressHash = fingerprint(), expired = attempt({ channel: "phone", addressHash, phase: "verified",
        expiresAt: "2020-01-01T00:00:00.000Z" });
      await store.createContactVerificationAttempt(expired);
      // A new local attempt for the same number invokes bounded expiry cleanup.
      const fresh = attempt({ channel: "phone", addressHash, phase: "sent" });
      await store.createContactVerificationAttempt(fresh);
      expect(await read(store, expired)).toBeNull();
      expect(await store.consumeVerifiedContactAttempt(consumption(expired))).toBe(false);
      const verified = { ...fresh, phase: "verified" as const, version: 2 };
      expect(await store.updateContactVerificationAttempt(verified, 1)).toBe(true);
      expect(await store.consumeVerifiedContactAttempt(consumption(verified))).toBe(true);
      expect(await store.consumeVerifiedContactAttempt(consumption(verified))).toBe(false);
      const next = attempt({ channel: "phone", addressHash, phase: "verified" });
      await store.createContactVerificationAttempt(next);
      expect(await store.consumeVerifiedContactAttempt(consumption(next))).toBe(true);
      expect(await read(store, verified)).toMatchObject({ phase: "consumed", version: 3 });
      expect(await read(store, next)).toMatchObject({ phase: "consumed", version: 2 });
    });

    it("blocks a fresh send while an earlier same-contact outcome remains pending or unknown, then releases it after expiry", async () => {
      const store = getStore();
      for (const phase of ["send_pending", "send_unknown", "verifying"] as const) {
        const pending = attempt({ phase });
        await store.createContactVerificationAttempt(pending);
        await expect(store.createContactVerificationAttempt(attempt({ channel: pending.channel, addressHash: pending.addressHash })))
          .rejects.toMatchObject({ code: "verification_unavailable" });
        expect(await read(store, pending)).toEqual(pending);
      }
      const expired = attempt({ phase: "send_unknown", expiresAt: "2020-01-01T00:00:00.000Z" });
      await store.createContactVerificationAttempt(expired);
      const fresh = attempt({ addressHash: expired.addressHash });
      await expect(store.createContactVerificationAttempt(fresh)).resolves.toBeUndefined();
      expect(await read(store, fresh)).toEqual(fresh);
      const sent = attempt({ phase: "sent" });
      await store.createContactVerificationAttempt(sent);
      await expect(store.createContactVerificationAttempt(attempt({ addressHash: sent.addressHash, phase: "verified" })))
        .resolves.toBeUndefined();
    });

    it("serializes concurrent fresh sends for one contact while preserving independent channel bindings", async () => {
      const store = getStore(), addressHash = fingerprint();
      const proposals = Array.from({ length: 5 }, () => attempt({ addressHash }));
      const results = await Promise.allSettled(proposals.map(pending => store.createContactVerificationAttempt(pending)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results) if (result.status === "rejected") expect(result.reason.code).toBe("verification_unavailable");
      const otherChannel = attempt({ channel: "phone", addressHash });
      await expect(store.createContactVerificationAttempt(otherChannel)).resolves.toBeUndefined();
      expect(await read(store, otherChannel)).toEqual(otherChannel);
    });

    it("reserves all verification budgets together without partially spending a rejected reservation", async () => {
      const store = getStore(), exhausted: VerificationLimit = { keyHash: fingerprint(), max: 1, windowMs: 600_000 },
        fresh: VerificationLimit = { keyHash: fingerprint(), max: 1, windowMs: 600_000 };
      expect(await store.reserveVerificationLimits([exhausted])).toBe(true);
      expect(await store.reserveVerificationLimits([exhausted, fresh])).toBe(false);
      expect(await store.reserveVerificationLimits([fresh])).toBe(true);
      expect(await store.reserveVerificationLimits([fresh])).toBe(false);
    });

    it("bounds concurrent reservations across all shared keys", async () => {
      const store = getStore(), shared: VerificationLimit = { keyHash: fingerprint(), max: 3, windowMs: 600_000 },
        other: VerificationLimit = { keyHash: fingerprint(), max: 5, windowMs: 600_000 };
      const results = await Promise.all(Array.from({ length: 10 }, () => store.reserveVerificationLimits([shared, other])));
      expect(results.filter(Boolean)).toHaveLength(3);
      expect(await store.reserveVerificationLimits([other])).toBe(true);
      expect(await store.reserveVerificationLimits([other])).toBe(true);
      expect(await store.reserveVerificationLimits([other])).toBe(false);
    });

    it("rejects invalid or duplicate budget keys without spending a valid budget", async () => {
      const store = getStore(), valid: VerificationLimit = { keyHash: fingerprint(), max: 1, windowMs: 600_000 };
      for (const limits of [[], [valid, valid], [valid, { ...valid, keyHash: fingerprint(), max: 0 }],
        [valid, { ...valid, keyHash: "not-a-fingerprint" }]]) {
        await expect(store.reserveVerificationLimits(limits)).rejects.toMatchObject({ code: "verification_unavailable" });
      }
      expect(await store.reserveVerificationLimits([valid])).toBe(true);
    });

    it("admits a public verified-email owner with private empty defaults and consumes the proof exactly once", async () => {
      const store = getStore(), fixture = emailRegistration();
      fixture.command.passwordHash = await hashPassword("synthetic-verified-password");
      await store.createContactVerificationAttempt(fixture.pending);
      const owner = await store.finalizeVerifiedRegistration(fixture.command);
      expect(owner).toMatchObject({ email: fixture.command.email, passwordHash: fixture.command.passwordHash });
      expect(await verifyPassword("synthetic-verified-password", owner.passwordHash)).toBe(true);
      expect(await store.getUserByEmail(owner.email!.toUpperCase())).toEqual(owner);
      expect(await store.getUserById(owner.id)).toEqual(owner);
      await assertPrivateOwner(store, owner);
      expect(await read(store, fixture.pending)).toMatchObject({ phase: "consumed" });
      await expect(store.finalizeVerifiedRegistration(fixture.command)).rejects.toMatchObject({ code: "invalid_verification" });
      expect(await store.updateContactVerificationAttempt({ ...fixture.pending, version: 2, phase: "sent" }, 1)).toBe(false);
      const sessionHash = fingerprint();
      await store.createSession(owner.id, sessionHash, new Date(Date.now() + 600_000).toISOString());
      expect((await store.getSessionByTokenHash(sessionHash))?.user).toEqual(owner);
    });

    it("creates multiple passwordless phone owners without fabricating email and keeps phone identities isolated", async () => {
      const store = getStore(), first = phoneRegistration(), second = phoneRegistration();
      const owners: StoredUser[] = [];
      for (const fixture of [first, second]) {
        await store.createContactVerificationAttempt(fixture.pending);
        const owner = await store.finalizeVerifiedRegistration(fixture.command);
        owners.push(owner);
        expect(owner).toMatchObject({ email: null, passwordHash: null });
        expect(await verifyPassword("any-synthetic-password", owner.passwordHash)).toBe(false);
        expect(await store.getPhoneUser(fixture.command.phoneBinding!)).toEqual(owner);
        expect(await store.listPhoneBindings(owner.id)).toEqual([fixture.command.phoneBinding]);
        await assertPrivateOwner(store, owner);
      }
      expect(owners[0].id).not.toBe(owners[1].id);
      const binding = first.command.phoneBinding!;
      expect(await store.getPhoneUser({ ...binding })).toEqual(owners[0]);
      expect(await store.getPhoneUser({ ...binding, phoneHash: fingerprint() })).toBeNull();
      expect(await store.getCalendar(owners[1].id, (await store.listCalendars(owners[0].id)).items[0].id)).toBeNull();
      const sessionHash = fingerprint();
      await store.createSession(owners[0].id, sessionHash, new Date(Date.now() + 600_000).toISOString());
      expect((await store.getSessionByTokenHash(sessionHash))?.user).toEqual(owners[0]);
    });

    it("admits a new verified-phone owner from either login or registration entry", async () => {
      const store = getStore();
      for (const intent of ["login", "register"] as const) {
        const fixture = phoneRegistration(phone(), { intent });
        await store.createContactVerificationAttempt(fixture.pending);
        const owner = await store.finalizeVerifiedRegistration(fixture.command);
        expect(await store.getPhoneUser(fixture.command.phoneBinding!)).toEqual(owner);
        expect(owner).toMatchObject({ email: null, passwordHash: null });
        expect(await read(store, fixture.pending)).toMatchObject({ phase: "consumed" });
        await assertPrivateOwner(store, owner);
      }
    });

    it("admits only one owner when several callers finalize the same verified proof", async () => {
      const store = getStore(), fixture = emailRegistration();
      await store.createContactVerificationAttempt(fixture.pending);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => store.finalizeVerifiedRegistration(fixture.command)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results) if (result.status === "rejected") expect(result.reason.code).toBe("invalid_verification");
      const winner = results.find(result => result.status === "fulfilled");
      if (winner?.status !== "fulfilled") throw new Error("Missing verified owner");
      expect(await store.getUserByEmail(fixture.command.email!)).toEqual(winner.value);
      expect(await read(store, fixture.pending)).toMatchObject({ phase: "consumed" });
      expect((await store.listCalendars(winner.value.id)).items).toHaveLength(1);
    });

    it("serializes distinct verified attempts for one phone and rolls back the losing attempt and invitation", async () => {
      const store = getStore(), binding = phone(), fixtures = [phoneRegistration(binding), phoneRegistration({ ...binding })];
      for (const fixture of fixtures) {
        fixture.command.invitation = invitation();
        await store.createContactVerificationAttempt(fixture.pending);
      }
      const results = await Promise.allSettled(fixtures.map(fixture => store.finalizeVerifiedRegistration(fixture.command)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const winnerIndex = results.findIndex(result => result.status === "fulfilled"), winner = results[winnerIndex];
      if (winner.status !== "fulfilled") throw new Error("Missing phone owner");
      const loser = fixtures[1 - winnerIndex];
      expect(await store.getPhoneUser(binding)).toEqual(winner.value);
      expect(await read(store, loser.pending)).toEqual(loser.pending);
      expect(await store.registrationAvailable(loser.command.invitation!)).toBe(true);
      expect(await store.registrationAvailable(fixtures[winnerIndex].command.invitation!)).toBe(false);
      expect(await store.listPhoneBindings(winner.value.id)).toEqual([fixtures[winnerIndex].command.phoneBinding]);
    });

    it("rechecks revoked and expired invitations during finalization and leaves verified proof available for explicit public retry", async () => {
      const store = getStore(), inviter = await store.registerOwner(existingOwner());
      for (const expired of [false, true]) {
        const prepared = prepareMemberInvitation(inviter.id);
        if (expired) {
          prepared.invitation.createdAt = "2020-01-01T00:00:00.000Z";
          prepared.invitation.expiresAt = "2020-01-08T00:00:00.000Z";
        }
        await store.createMemberInvitation(prepared.invitation);
        if (!expired) await store.revokeMemberInvitation(inviter.id, prepared.invitation.id);
        const fixture = emailRegistration();
        fixture.command.invitation = memberRegistrationInvitation(prepared.invitation);
        await store.createContactVerificationAttempt(fixture.pending);
        await expect(store.finalizeVerifiedRegistration(fixture.command)).rejects.toMatchObject({ code: "registration_unavailable" });
        expect(await store.getUserByEmail(fixture.command.email!)).toBeNull();
        expect(await read(store, fixture.pending)).toEqual(fixture.pending);
        expect((await store.getMemberInvitation(prepared.invitation.fingerprint))?.redeemedAt).toBeNull();
        const { invitation: _invalidInvitation, ...publicRetry } = fixture.command;
        const owner = await store.finalizeVerifiedRegistration(publicRetry);
        expect(await store.getUserByEmail(fixture.command.email!)).toEqual(owner);
        expect(await read(store, fixture.pending)).toMatchObject({ phase: "consumed" });
        expect((await store.getMemberInvitation(prepared.invitation.fingerprint))?.redeemedAt).toBeNull();
      }
    });

    it("spends an active member invitation only after a verified owner is created", async () => {
      const store = getStore(), inviter = await store.registerOwner(existingOwner()), prepared = prepareMemberInvitation(inviter.id);
      await store.createMemberInvitation(prepared.invitation);
      const fixture = phoneRegistration();
      fixture.command.invitation = memberRegistrationInvitation(prepared.invitation);
      await store.createContactVerificationAttempt(fixture.pending);
      const owner = await store.finalizeVerifiedRegistration(fixture.command);
      expect(await store.getPhoneUser(fixture.command.phoneBinding!)).toEqual(owner);
      expect(await read(store, fixture.pending)).toMatchObject({ phase: "consumed" });
      expect(await store.registrationAvailable(fixture.command.invitation)).toBe(false);
      expect((await store.listMemberInvitations(inviter.id)).find(item => item.id === prepared.invitation.id)?.redeemedAt).not.toBeNull();
      await assertPrivateOwner(store, owner);
    });

    it("rejects duplicate email without changing the existing password or spending proof or invitation", async () => {
      const store = getStore(), existing = await store.registerOwner(existingOwner()), fixture = emailRegistration();
      fixture.command.email = existing.email!.toUpperCase();
      fixture.command.invitation = invitation();
      await store.createContactVerificationAttempt(fixture.pending);
      await expect(store.finalizeVerifiedRegistration(fixture.command)).rejects.toMatchObject({ code: "registration_failed" });
      expect(await store.getUserByEmail(existing.email!)).toEqual(existing);
      expect(await store.listPhoneBindings(existing.id)).toEqual([]);
      expect(await read(store, fixture.pending)).toEqual(fixture.pending);
      expect(await store.registrationAvailable(fixture.command.invitation)).toBe(true);
    });

    it("refuses wrong browsers, stale versions, expired state and incomplete proof before admitting an account", async () => {
      const store = getStore(), valid = emailRegistration();
      await store.createContactVerificationAttempt(valid.pending);
      for (const command of [{ ...valid.command, browserHash: fingerprint() }, { ...valid.command, expectedVersion: 2 }]) {
        await expect(store.finalizeVerifiedRegistration(command)).rejects.toMatchObject({ code: "invalid_verification" });
      }
      expect(await read(store, valid.pending)).toEqual(valid.pending);
      for (const changes of [{ phase: "sent" as const }, { intent: "login" as const },
        { expiresAt: "2020-01-01T00:00:00.000Z" }]) {
        const fixture = emailRegistration(changes);
        await store.createContactVerificationAttempt(fixture.pending);
        await expect(store.finalizeVerifiedRegistration(fixture.command)).rejects.toMatchObject({ code: "invalid_verification" });
        expect(await store.getUserByEmail(fixture.command.email!)).toBeNull();
      }
      expect(await store.getUserByEmail(valid.command.email!)).toBeNull();
    });

    it("requires email credentials or the matching passwordless phone binding without consuming invalid proposals", async () => {
      const store = getStore(), email = emailRegistration(), mobile = phoneRegistration();
      await store.createContactVerificationAttempt(email.pending);
      await store.createContactVerificationAttempt(mobile.pending);
      const invalid = [{ ...email.command, email: null }, { ...email.command, passwordHash: null },
        { ...email.command, phoneBinding: phone() }, { ...mobile.command, email: "fabricated@example.test" },
        { ...mobile.command, passwordHash: "unexpected-password-hash" }, { ...mobile.command, phoneBinding: undefined },
        { ...mobile.command, phoneBinding: { ...mobile.command.phoneBinding!, phoneHash: fingerprint() } }];
      for (const command of invalid) {
        await expect(store.finalizeVerifiedRegistration(command)).rejects.toMatchObject({ code: "invalid_verification" });
      }
      expect(await read(store, email.pending)).toEqual(email.pending);
      expect(await read(store, mobile.pending)).toEqual(mobile.pending);
      expect(await store.getUserByEmail(email.command.email!)).toBeNull();
      expect(await store.getPhoneUser(mobile.command.phoneBinding!)).toBeNull();
    });

    it("consumes returning-phone verification once from login or registration entry and rejects incomplete, link and email attempts", async () => {
      const store = getStore();
      for (const intent of ["login", "register"] as const) {
        const pending = attempt({ channel: "phone", intent, phase: "verified" });
        await store.createContactVerificationAttempt(pending);
        expect(await store.consumeVerifiedContactAttempt({ ...consumption(pending), browserHash: fingerprint() })).toBe(false);
        expect(await store.consumeVerifiedContactAttempt({ ...consumption(pending), expectedVersion: 2 })).toBe(false);
        expect(await read(store, pending)).toEqual(pending);
        const results = await Promise.all(Array.from({ length: 5 }, () => store.consumeVerifiedContactAttempt(consumption(pending))));
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await read(store, pending)).toMatchObject({ phase: "consumed" });
        expect(await store.consumeVerifiedContactAttempt(consumption(pending))).toBe(false);
      }
      for (const changed of [{ intent: "link" as const }, { channel: "email" as const }, { phase: "sent" as const }]) {
        const invalid = attempt({ channel: "phone", intent: "login", phase: "verified", ...changed });
        await store.createContactVerificationAttempt(invalid);
        expect(await store.consumeVerifiedContactAttempt(consumption(invalid))).toBe(false);
        expect(await read(store, invalid)).toEqual(invalid);
      }
    });

    it("links a phone only to the explicit owner and rejects conflicts without spending the conflicting proof", async () => {
      const store = getStore(), owner = await store.registerOwner(existingOwner()), other = await store.registerOwner(existingOwner()),
        binding = phone(), first = phoneRegistration(binding, { intent: "link" });
      await store.createContactVerificationAttempt(first.pending);
      const sessionTokenHash = await liveSession(store, owner.id), otherSession = await liveSession(store, other.id);
      const command = { ...consumption(first.pending), ownerId: owner.id, phoneBinding: binding, sessionTokenHash };
      await store.finalizeVerifiedPhoneLink(command);
      expect(await store.getPhoneUser(binding)).toEqual(owner);
      expect(await store.listPhoneBindings(owner.id)).toEqual([binding]);
      expect((await store.getUserById(owner.id))?.passwordHash).toBe(owner.passwordHash);
      expect(await read(store, first.pending)).toMatchObject({ phase: "consumed" });
      await expect(store.finalizeVerifiedPhoneLink(command)).rejects.toMatchObject({ code: "invalid_verification" });
      const sameOwner = phoneRegistration(binding, { intent: "link" });
      await store.createContactVerificationAttempt(sameOwner.pending);
      await store.finalizeVerifiedPhoneLink({ ...consumption(sameOwner.pending), ownerId: owner.id, phoneBinding: binding, sessionTokenHash });
      expect(await store.listPhoneBindings(owner.id)).toEqual([binding]);
      expect(await read(store, sameOwner.pending)).toMatchObject({ phase: "consumed" });
      const conflict = phoneRegistration(binding, { intent: "link" });
      await store.createContactVerificationAttempt(conflict.pending);
      await expect(store.finalizeVerifiedPhoneLink({ ...consumption(conflict.pending), ownerId: other.id, phoneBinding: binding, sessionTokenHash: otherSession }))
        .rejects.toMatchObject({ code: "invalid_verification" });
      expect(await read(store, conflict.pending)).toEqual(conflict.pending);
      expect(await store.listPhoneBindings(other.id)).toEqual([]);
      expect(await store.getPhoneUser(binding)).toEqual(owner);
    });

    it("serializes two owners acquiring one phone and rolls back the losing link attempt", async () => {
      const store = getStore(), owners = [await store.registerOwner(existingOwner()), await store.registerOwner(existingOwner())],
        binding = phone(), fixtures = [phoneRegistration(binding, { intent: "link" }), phoneRegistration({ ...binding }, { intent: "link" })];
      for (const fixture of fixtures) await store.createContactVerificationAttempt(fixture.pending);
      const sessions = await Promise.all(owners.map(owner => liveSession(store, owner.id)));
      const results = await Promise.allSettled(fixtures.map((fixture, index) => store.finalizeVerifiedPhoneLink({
        ...consumption(fixture.pending), ownerId: owners[index].id, phoneBinding: fixture.command.phoneBinding!, sessionTokenHash: sessions[index] })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const winnerIndex = results.findIndex(result => result.status === "fulfilled");
      expect(await store.getPhoneUser(binding)).toEqual(owners[winnerIndex]);
      expect(await store.listPhoneBindings(owners[1 - winnerIndex].id)).toEqual([]);
      expect(await read(store, fixtures[1 - winnerIndex].pending)).toEqual(fixtures[1 - winnerIndex].pending);
      expect(await read(store, fixtures[winnerIndex].pending)).toMatchObject({ phase: "consumed" });
    });

    it("refuses missing owners, wrong browsers and mismatched link identities without spending proof", async () => {
      const store = getStore(), owner = await store.registerOwner(existingOwner()), binding = phone(),
        fixture = phoneRegistration(binding, { intent: "link" });
      await store.createContactVerificationAttempt(fixture.pending);
      const sessionTokenHash = await liveSession(store, owner.id);
      const command = { ...consumption(fixture.pending), ownerId: owner.id, phoneBinding: binding, sessionTokenHash };
      await expect(store.finalizeVerifiedPhoneLink({ ...command, ownerId: randomUUID() })).rejects.toMatchObject({ code: "authentication_required" });
      for (const invalid of [{ ...command, browserHash: fingerprint() },
        { ...command, phoneBinding: { ...binding, phoneHash: fingerprint() } }]) {
        await expect(store.finalizeVerifiedPhoneLink(invalid)).rejects.toMatchObject({ code: "invalid_verification" });
      }
      expect(await read(store, fixture.pending)).toEqual(fixture.pending);
      expect(await store.listPhoneBindings(owner.id)).toEqual([]);
      for (const changed of [{ intent: "register" as const }, { channel: "email" as const }]) {
        const wrongKind = phoneRegistration(binding, { intent: "link", ...changed });
        await store.createContactVerificationAttempt(wrongKind.pending);
        await expect(store.finalizeVerifiedPhoneLink({ ...consumption(wrongKind.pending), ownerId: owner.id, phoneBinding: binding, sessionTokenHash }))
          .rejects.toMatchObject({ code: "invalid_verification" });
        expect(await read(store, wrongKind.pending)).toEqual(wrongKind.pending);
      }
    });

    it("requires the original live session at link commit and leaves refused proof unconsumed", async () => {
      const store = getStore(), owner = await store.registerOwner(existingOwner()), other = await store.registerOwner(existingOwner());
      const live = await liveSession(store, owner.id), wrongOwner = await liveSession(store, other.id), expired = fingerprint();
      await store.createSession(owner.id, expired, "2020-01-01T00:00:00.000Z");
      await store.deleteSessionByTokenHash(live);
      for (const sessionTokenHash of [live, wrongOwner, expired, fingerprint(), "malformed"]) {
        const fixture = phoneRegistration(phone(), { intent: "link" }); await store.createContactVerificationAttempt(fixture.pending);
        await expect(store.finalizeVerifiedPhoneLink({ ...consumption(fixture.pending), ownerId: owner.id,
          phoneBinding: fixture.command.phoneBinding!, sessionTokenHash })).rejects.toMatchObject({ code: "authentication_required" });
        expect(await read(store, fixture.pending)).toEqual(fixture.pending);
      }
      expect(await store.listPhoneBindings(owner.id)).toEqual([]);
    });
  });
}
