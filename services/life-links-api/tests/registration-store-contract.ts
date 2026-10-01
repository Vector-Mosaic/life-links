import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LifeLinksStore } from "../src/store.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { invitationFingerprint, prepareMemberInvitation, memberRegistrationInvitation, type RegisterOwnerInput } from "../src/registration.js";

export function registrationStoreContract(getStore: () => LifeLinksStore) {
  const input = async (maxAccounts = 5): Promise<RegisterOwnerInput> => ({
    displayName: "Private judge", email: `${randomUUID()}@example.test`,
    passwordHash: await hashPassword("synthetic-judge-password"), timeZone: "America/New_York",
    invitation: { fingerprint: invitationFingerprint(randomUUID()), maxAccounts,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
  });

  describe("invitation registration store contract", () => {
    it("persists member invitation fingerprints and atomically admits exactly one new private owner", async () => {
      const store = getStore();
      const owner = await store.registerOwner(await input());
      const prepared = prepareMemberInvitation(owner.id);
      const view = await store.createMemberInvitation(prepared.invitation);
      expect(view).not.toHaveProperty("fingerprint");
      expect(view).not.toHaveProperty("ownerId");
      expect(await store.getMemberInvitation(invitationFingerprint(prepared.code))).toEqual(prepared.invitation);
      const command = { ...await input(), invitation: memberRegistrationInvitation(prepared.invitation) };
      const responses = await Promise.allSettled(Array.from({ length: 4 }, (_, i) =>
        store.registerOwner({ ...command, email: `${i}-${command.email}` })));
      expect(responses.filter(response => response.status === "fulfilled")).toHaveLength(1);
      expect(responses.filter(response => response.status === "rejected")).toHaveLength(3);
      expect(await store.registrationAvailable(command.invitation)).toBe(false);
      const invitations = await store.listMemberInvitations(owner.id);
      expect(invitations.find(value => value.id === view.id)?.redeemedAt).not.toBeNull();
      const joined = responses.find(response => response.status === "fulfilled");
      if (joined?.status !== "fulfilled") throw new Error("Missing joined account");
      expect(await store.listMemberInvitations(joined.value.id)).toEqual([]);
      expect((await store.listLifeLinks(joined.value.id, null)).items).toEqual([]);
      expect((await store.listCalendars(joined.value.id)).items).toMatchObject([{ agentAccess: "none" }]);
      expect(await store.revokeMemberInvitation(owner.id, view.id)).toBe(true);
      expect(await store.getUserById(joined.value.id)).not.toBeNull();
    });

    it("scopes cancellation to its inviter and rechecks cancellation and expiry during admission", async () => {
      const store = getStore();
      const owner = await store.registerOwner(await input());
      const other = await store.registerOwner(await input());
      const prepared = prepareMemberInvitation(owner.id);
      await store.createMemberInvitation(prepared.invitation);
      const command = { ...await input(), invitation: memberRegistrationInvitation(prepared.invitation) };
      expect(await store.revokeMemberInvitation(other.id, prepared.invitation.id)).toBe(false);
      expect(await store.listMemberInvitations(other.id)).toEqual([]);
      expect(await store.registrationAvailable(command.invitation)).toBe(true);
      expect(await store.revokeMemberInvitation(owner.id, prepared.invitation.id)).toBe(true);
      await expect(store.registerOwner(command)).rejects.toMatchObject({ code: "registration_unavailable" });
      const expired = prepareMemberInvitation(owner.id).invitation;
      expired.createdAt = "2020-01-01T00:00:00.000Z"; expired.expiresAt = "2020-01-08T00:00:00.000Z";
      await store.createMemberInvitation(expired);
      await expect(store.registerOwner({ ...await input(), invitation: memberRegistrationInvitation(expired) }))
        .rejects.toMatchObject({ code: "registration_unavailable" });
    });

    it("bounds concurrent outstanding links per owner and releases a slot after cancellation", async () => {
      const store = getStore();
      const owner = await store.registerOwner(await input());
      const created = await Promise.allSettled(Array.from({ length: 14 }, () => store.createMemberInvitation(prepareMemberInvitation(owner.id).invitation)));
      expect(created.filter(value => value.status === "fulfilled")).toHaveLength(10);
      expect(created.filter(value => value.status === "rejected")).toHaveLength(4);
      const first = (await store.listMemberInvitations(owner.id))[0];
      await store.revokeMemberInvitation(owner.id, first.id);
      await expect(store.createMemberInvitation(prepareMemberInvitation(owner.id).invitation)).resolves.toHaveProperty("id");
    });

    it("creates an isolated owner with only a native default calendar and no grants", async () => {
      const store = getStore();
      const command = await input();
      const first = await store.registerOwner(command);
      const second = await store.registerOwner({ ...command, email: `other-${command.email}` });
      expect(first.id).not.toBe(second.id);
      expect(first).toMatchObject({ email: command.email, agentConnectedAt: null, agentToolCatalogId: null });
      expect(await store.getUserByEmail(command.email.toUpperCase())).toEqual(first);
      expect(await verifyPassword("synthetic-judge-password", first.passwordHash)).toBe(true);
      const calendars = await store.listCalendars(first.id);
      expect(calendars.items).toHaveLength(1);
      expect(calendars.items[0]).toMatchObject({ ownerId: first.id, title: "My Calendar", color: "#7fc9b3",
        timeZone: "America/New_York", source: "native", isDefault: true, agentAccess: "none" });
      expect((await store.listLifeLinks(first.id, null)).items).toEqual([]);
      expect((await store.listCollections(first.id)).items).toEqual([]);
      expect((await store.listRoutines(first.id)).items).toEqual([]);
      expect(await store.getCalendar(second.id, calendars.items[0].id)).toBeNull();
      const saved = await store.createLifeLink({ id: `registered-${randomUUID()}`, ownerId: first.id, title: "Only mine", createdAt: first.createdAt });
      expect(await store.getLifeLinkDetail(second.id, saved.id)).toBeNull();
      expect((await store.listLifeLinks(second.id, null)).items).toEqual([]);
    });

    it("atomically bounds concurrent admission without resetting capacity or existing passwords", async () => {
      const store = getStore();
      const command = await input(2);
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
        store.registerOwner({ ...command, email: `${index}-${command.email}` })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(6);
      for (const result of results) if (result.status === "rejected") expect(result.reason.code).toBe("registration_unavailable");
      expect(await store.registrationAvailable(command.invitation)).toBe(false);
      await expect(store.registerOwner({ ...command, email: `after-${command.email}` })).rejects.toMatchObject({ code: "registration_unavailable" });
      // Rotating to another invitation still must not create or change an existing email.
      const existing = results.find(result => result.status === "fulfilled");
      if (existing?.status !== "fulfilled") throw new Error("Missing admitted owner");
      const fresh = await input(2);
      await expect(store.registerOwner({ ...fresh, email: existing.value.email.toUpperCase(), passwordHash: await hashPassword("different-synthetic-password") }))
        .rejects.toMatchObject({ code: "registration_failed" });
      expect((await store.getUserByEmail(existing.value.email))?.passwordHash).toBe(existing.value.passwordHash);
      expect(await store.registrationAvailable(fresh.invitation)).toBe(true);
    });

    it("serializes duplicate emails across invitation fingerprints and refuses expired admission", async () => {
      const store = getStore();
      const command = await input();
      const other = await input();
      const duplicate = await Promise.allSettled([
        store.registerOwner(command), store.registerOwner({ ...other, email: command.email.toUpperCase() })
      ]);
      expect(duplicate.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(duplicate.filter(result => result.status === "rejected")).toHaveLength(1);
      const expired = { ...command, email: `expired-${command.email}`,
        invitation: { ...command.invitation, expiresAt: "2020-01-01T00:00:00.000Z" } };
      expect(await store.registrationAvailable(expired.invitation)).toBe(false);
      await expect(store.registerOwner(expired)).rejects.toMatchObject({ code: "registration_unavailable" });
      expect(await store.getUserByEmail(expired.email)).toBeNull();
      expect(await store.getUserByEmail(command.email)).not.toBeNull();
    });
  });
}
