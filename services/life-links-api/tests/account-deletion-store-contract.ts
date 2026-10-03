import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_QR_BASE_URL } from "@life-links/core";
import type { LifeLinksStore } from "../src/store.js";
import { invitationFingerprint, prepareMemberInvitation } from "../src/registration.js";
import { createSmsVerificationConsentReceipt } from "../src/sms-verification-consent.js";

const hash = () => invitationFingerprint(randomUUID());
const expiresAt = () => new Date(Date.now()+3_600_000).toISOString();
const input = () => ({ displayName: "Synthetic deletion owner", email: `${randomUUID()}@example.test`,
  passwordHash: "synthetic-store-password-hash", timeZone: "UTC" });

export function accountDeletionStoreContract(getStore: () => LifeLinksStore): void {
  describe("shared account deletion store contract", () => {
    it("binds explicit provider linking to its original live session and refuses completion after logout", async () => {
      const store=getStore(), owner=await store.registerOwner(input()), other=await store.registerOwner(input());
      const sessionHash=hash(), otherHash=hash();
      await store.createSession(owner.id,sessionHash,expiresAt()); await store.createSession(other.id,otherHash,expiresAt());
      const identity={provider:"google",issuer:"https://accounts.google.com",clientId:"synthetic",subject:randomUUID(),email:null,emailVerified:false,displayName:null};
      await expect(store.linkProviderIdentity(owner.id,identity,undefined,otherHash)).rejects.toThrow();
      expect(await store.getProviderUser(identity)).toBeNull();
      await store.linkProviderIdentity(owner.id,identity,undefined,sessionHash);
      await store.deleteSessionByTokenHash(sessionHash);
      const later={...identity,subject:randomUUID()};
      await expect(store.linkProviderIdentity(owner.id,later,undefined,sessionHash)).rejects.toThrow();
      expect(await store.getProviderUser(later)).toBeNull();
      expect((await store.getProviderUser(identity))?.id).toBe(owner.id);
    });
    it("erases populated private domains, inverses, methods and sessions while preserving other owners and permanent QR URLs", async () => {
      const store=getStore(), owner=await store.registerOwner(input()), other=await store.registerOwner(input());
      const sessionHash=hash(), otherSessionHash=hash();
      await store.createSession(owner.id,sessionHash,expiresAt());
      await store.createSession(other.id,otherSessionHash,expiresAt());
      const batch=await store.createQrBatch(owner.id,2,DEFAULT_QR_BASE_URL);
      const ownQr=batch.qrCodes[0], otherQr=batch.qrCodes[1];
      const ownLink=await store.createLifeLink({ id:randomUUID(),ownerId:owner.id,title:"Private",body:"Erase this",createdAt:new Date().toISOString() });
      const otherLink=await store.createLifeLink({ id:randomUUID(),ownerId:other.id,title:"Preserve this",createdAt:new Date().toISOString() });
      await store.claimQr(ownQr.id,owner.id,{commandId:randomUUID(),mode:"attach",lifeLinkId:ownLink.id});
      await store.claimQr(otherQr.id,other.id,{commandId:randomUUID(),mode:"attach",lifeLinkId:otherLink.id});
      const media=await store.createLifeLinkMedia(owner.id,ownLink.id,{ kind:"image",mimeType:"image/png",fileName:"private.png",sizeBytes:5,data:Buffer.from("bytes") });
      await store.createCollection({ id:`collection-${randomUUID()}`,ownerId:owner.id,title:"Private collection",createdAt:ownLink.createdAt });
      const calendar=(await store.listCalendars(owner.id)).items[0];
      await store.createCalendarEvent({ id:`calendar-event-${randomUUID()}`,revisionId:`calendar-event-revision-${randomUUID()}`,ownerId:owner.id,calendarId:calendar.id,
        title:"Private event",createdAt:ownLink.createdAt,span:{kind:"all_day",startDate:"2026-10-02",endDateExclusive:"2026-10-03"} });
      const routine=await store.createRoutine({ id:`routine-${randomUUID()}`,revisionId:`routine-revision-${randomUUID()}`,ownerId:owner.id,title:"Private Routine",steps:[],createdAt:ownLink.createdAt });
      const run=(await store.startRoutineRun(owner.id,{id:`routine-run-${randomUUID()}`,routineId:routine.routine.id,startedAt:ownLink.createdAt}))!;
      await store.finalizeRoutineRun(owner.id,{runId:run.id,sessionId:`routine-session-${randomUUID()}`,expectedUpdatedAt:run.updatedAt,completedAt:new Date(Date.parse(ownLink.createdAt)+1000).toISOString()});
      const identity={provider:"google",issuer:"https://accounts.google.com",clientId:"synthetic",subject:randomUUID(),email:null,emailVerified:false,displayName:null};
      await store.linkProviderIdentity(owner.id,identity);
      const phone={phoneHash:hash(),maskedNumber:"*** *** 1111"};
      const contact={tokenHash:hash(),browserHash:hash(),addressHash:phone.phoneHash,channel:"phone" as const,intent:"link" as const,
        phase:"verified" as const,encryptedPayload:"synthetic-ciphertext",expiresAt:expiresAt(),resendAt:new Date().toISOString(),version:1,checkCount:0,ownerId:owner.id};
      await store.createContactVerificationAttempt(contact);
      await store.finalizeVerifiedPhoneLink({...contact,expectedVersion:1,ownerId:owner.id,sessionTokenHash:sessionHash,phoneBinding:phone});
      const invitation=prepareMemberInvitation(owner.id).invitation;
      await store.createMemberInvitation(invitation);
      const providerAttempt={stateHash:hash(),browserHash:hash(),provider:"google",encryptedPayload:"synthetic-ciphertext",expiresAt:expiresAt(),ownerId:owner.id};
      await store.saveProviderSignInAttempt(providerAttempt);
      expect((await store.getChangeHistory(owner.id)).entries.length).toBeGreaterThan(0);
      expect(await store.deleteAccount({ownerId:owner.id,sessionTokenHash:sessionHash})).toEqual({appleRevocation:"not_required",revocationCleanupIds:[]});
      expect(await store.getUserById(owner.id)).toBeNull();
      expect(await store.getUserByEmail(owner.email!)).toBeNull();
      expect(await store.getSessionByTokenHash(sessionHash)).toBeNull();
      expect(await store.getProviderUser(identity)).toBeNull();
      expect(await store.getPhoneUser(phone)).toBeNull();
      expect(await store.getProviderSignInAttempt(providerAttempt.stateHash,providerAttempt.browserHash)).toBeNull();
      expect(await store.getContactVerificationAttempt(contact.tokenHash,contact.browserHash)).toBeNull();
      expect(await store.getMemberInvitation(invitation.fingerprint)).toBeNull();
      expect((await store.getChangeHistory(owner.id)).entries).toEqual([]);
      expect((await store.listLifeLinks(owner.id,null)).items).toEqual([]);
      expect((await store.listCollections(owner.id)).items).toEqual([]);
      expect((await store.listRoutines(owner.id)).items).toEqual([]);
      expect((await store.listCalendars(owner.id)).items).toEqual([]);
      expect(await store.getLifeLinkMedia(owner.id,ownLink.id,media!.id)).toBeNull();
      const erasedQr = await store.getQrState(ownQr.id,null);
      expect(erasedQr.state).toBe("unclaimed");
      if (erasedQr.state !== "unclaimed") throw new Error("deleted_owner_qr_not_released");
      expect(erasedQr.qr.url).toBe(ownQr.url);
      expect((await store.getLifeLinkDetail(other.id,otherLink.id))?.lifeLink.qrId).toBe(otherQr.id);
      expect(await store.getSessionByTokenHash(otherSessionHash)).not.toBeNull();
      const preservedQr = await store.getQrState(otherQr.id,other.id);
      expect(preservedQr.state).toBe("claimed");
      if (preservedQr.state !== "claimed") throw new Error("other_owner_qr_changed");
      expect(preservedQr.link.url).toBe(otherQr.url);
      await expect(store.createSession(owner.id,hash(),expiresAt())).rejects.toThrow();
      await expect(store.linkProviderIdentity(owner.id,identity)).rejects.toThrow();
      await expect(store.createLifeLink({id:randomUUID(),ownerId:owner.id,title:"Stale write",createdAt:new Date().toISOString()})).rejects.toThrow();
    });

    it("retains spent invitation capacity, global content-ID tombstones and independent SMS controls after erasure", async () => {
      const store=getStore(), invitation={fingerprint:hash(),maxAccounts:1,expiresAt:expiresAt()}, command={...input(),invitation};
      const owner=await store.registerOwner(command), sessionHash=hash();
      await store.createSession(owner.id,sessionHash,expiresAt());
      const id=randomUUID(); await store.createLifeLink({id,ownerId:owner.id,title:"Never reuse",createdAt:new Date().toISOString()});
      const limit={keyHash:hash(),max:1,windowMs:60_000};
      expect(await store.reserveVerificationLimits([limit])).toBe(true);
      const receipt=createSmsVerificationConsentReceipt({receiptHash:hash(),phoneHash:hash(),consentedAt:new Date().toISOString(),disclosureVersion:"life-links-sms-verification-v2"});
      await store.recordSmsVerificationConsent(receipt);
      await store.deleteAccount({ownerId:owner.id,sessionTokenHash:sessionHash});
      expect(await store.registrationAvailable(invitation)).toBe(false);
      expect(await store.reserveVerificationLimits([limit])).toBe(false);
      expect(await store.recordSmsVerificationConsent(receipt)).toBe(false);
      const replacement=await store.registerOwner({...input(),email:command.email});
      expect(replacement.id).not.toBe(owner.id);
      await expect(store.createLifeLink({id,ownerId:replacement.id,title:"Identity reuse",createdAt:new Date().toISOString()})).rejects.toThrow();
    });

    it("moves only the latest protected Apple material into bounded cleanup and blocks new binding until revocation finishes", async () => {
      const store=getStore(), identity={provider:"apple",issuer:"https://appleid.apple.com",clientId:"synthetic.apple",subject:randomUUID(),email:null,emailVerified:false,displayName:null};
      const command={identity,email:null,displayName:"Apple owner",timeZone:"UTC",revocationCustody:{encryptedPayload:"synthetic-old-ciphertext"}};
      const owner=await store.registerProviderOwner(command), sessionHash=hash();
      await store.retainProviderRevocationCustody(owner.id,identity,"synthetic-latest-ciphertext");
      await store.createSession(owner.id,sessionHash,expiresAt());
      const result=await store.deleteAccount({ownerId:owner.id,sessionTokenHash:sessionHash});
      expect(result.appleRevocation).toBe("pending");
      const cleanup=(await store.listProviderRevocationCleanup(100)).find(row=>result.revocationCleanupIds.includes(row.id))!;
      expect(Object.keys(cleanup).sort()).toEqual(["createdAt","encryptedPayload","id","identity"]);
      expect(cleanup.encryptedPayload).toBe("synthetic-latest-ciphertext");
      expect(cleanup.identity).toEqual({provider:identity.provider,issuer:identity.issuer,clientId:identity.clientId,subject:identity.subject});
      await expect(store.registerProviderOwner(command)).rejects.toMatchObject({code:"provider_sign_in_unavailable"});
      await store.deleteProviderRevocationCleanup(cleanup.id);
      await store.deleteProviderRevocationCleanup(cleanup.id);
      expect((await store.registerProviderOwner(command)).id).not.toBe(owner.id);
    });

    it("permits historical Apple account erasure without tokens, and refuses wrong or expired sessions without partial changes", async () => {
      const store=getStore(), identity={provider:"apple",issuer:"https://appleid.apple.com",clientId:"synthetic.apple",subject:randomUUID(),email:null,emailVerified:false,displayName:null};
      const owner=await store.registerProviderOwner({identity,email:null,displayName:"Historical Apple",timeZone:"UTC"});
      const sessionHash=hash(); await store.createSession(owner.id,sessionHash,expiresAt());
      await expect(store.deleteAccount({ownerId:owner.id,sessionTokenHash:hash()})).rejects.toMatchObject({code:"authentication_required"});
      const expiredHash=hash(); await store.createSession(owner.id,expiredHash,new Date(Date.now()-1_000).toISOString());
      await expect(store.deleteAccount({ownerId:owner.id,sessionTokenHash:expiredHash})).rejects.toMatchObject({code:"authentication_required"});
      expect(await store.getUserById(owner.id)).not.toBeNull();
      const result=await store.deleteAccount({ownerId:owner.id,sessionTokenHash:sessionHash});
      expect(result).toEqual({appleRevocation:"manual_required",revocationCleanupIds:[]});
      await expect(store.deleteAccount({ownerId:owner.id,sessionTokenHash:sessionHash})).rejects.toMatchObject({code:"authentication_required"});
    });
  });
}
