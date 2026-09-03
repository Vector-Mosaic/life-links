import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LifeLinksStore } from "../src/store.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { invitationFingerprint, type RegisterOwnerInput } from "../src/registration.js";

export function registrationStoreContract(getStore: () => LifeLinksStore) {
  const input = async (maxAccounts = 5): Promise<RegisterOwnerInput> => ({
    displayName: "Private judge", email: `${randomUUID()}@example.test`,
    passwordHash: await hashPassword("synthetic-judge-password"), timeZone: "America/New_York",
    invitation: { fingerprint: invitationFingerprint(randomUUID()), maxAccounts,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString() }
  });

  describe("invitation registration store contract", () => {
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
