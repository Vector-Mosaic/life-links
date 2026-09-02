import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  COMPETITION_CAMPING_KIT_ID,
  COMPETITION_CAMPING_COLLECTION_ID,
  COMPETITION_SECTION_IDS,
  COMPETITION_SLEEPING_PAD_ID,
  COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_SLEEPING_BAG_ID,
  COMPETITION_SLEEPING_BAG_QR_ID,
  COMPETITION_OWNER_ID,
  COMPETITION_START_LIFE_LINK_ID,
  COMPETITION_TARGET_QR_ID,
  DEFAULT_QR_BASE_URL,
  DEMO_GUEST_ID,
  DEMO_OWNER_ID,
  DEMO_PASSWORD
} from "@life-links/core";

import { EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT, REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT } from "./legacyMigration.fixture.js";

import { readConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { runMigrations } from "../src/migrations.js";
import { createPostgresStore, type PostgresLifeLinksStore } from "../src/postgres-store.js";
import { createLifeLinksApp } from "../src/server.js";
import { ClaimIdempotencyConflictError } from "../src/store.js";
import { fieldLedgerStoreContract } from "./field-ledger-contract.js";
import { changeHistoryStoreContract } from "./change-history-contract.js";
import { routineStoreContract } from "./routine-store-contract.js";
import { calendarStoreContract } from "./calendar-store-contract.js";
import { CalendarProviderGateway, calendarProviderCredentialHandle } from "../src/calendar-provider-gateway.js";
import { PostgresCalendarProviderStateStore } from "../src/calendar-provider-postgres.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";

const databaseUrl = process.env.LIFE_LINKS_TEST_DATABASE_URL;
const allowSchemaMutation = process.env.LIFE_LINKS_ALLOW_TEST_DB_SCHEMA === "1";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(serviceRoot, "migrations");
const logger = createLogger("life_links_postgres_test");

function requireTestDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("LIFE_LINKS_TEST_DATABASE_URL is required for Postgres integration tests.");
  }
  if (!allowSchemaMutation) {
    throw new Error("Set LIFE_LINKS_ALLOW_TEST_DB_SCHEMA=1 to allow creation and removal of an isolated test schema.");
  }
  return databaseUrl;
}

function createSchemaName(): string {
  return `life_links_test_${randomUUID().replace(/-/g, "")}`;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe test schema identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

describe("Life Links Postgres integration", () => {
  let adminPool: Pool;
  let postgresPool: Pool;
  let schemaName: string;
  let store: PostgresLifeLinksStore;
  let app: ReturnType<typeof createLifeLinksApp>;

  fieldLedgerStoreContract(() => store);
  routineStoreContract(() => store);
  calendarStoreContract(() => store);

  it("persists provider management with one canonical grant, stale-write protection and local-only disconnect", async () => {
    const connectionId = "postgres-provider-management";
    const calendarId = "calendar-77777777-7777-4777-8777-777777777777";
    const providerCalendarId = "synthetic-provider-calendar";
    const providerStore = new PostgresCalendarProviderStateStore(postgresPool);
    const adapter = new DeterministicFakeCalendarProviderAdapter("google", "synthetic-provider-account", [{
      providerCalendarId, displayName: "Synthetic provider calendar", capabilities: { read: true, create: true, update: true, delete: true },
      events: [{ providerEventId: "synthetic-provider-event", providerRevision: "r1", content: {
        title: "Synthetic event", description: null, location: null, status: "confirmed", providerSeriesId: null,
        span: { kind: "all_day", startDate: "2026-09-01", endDateExclusive: "2026-09-02" }
      } }]
    }]);
    const gateway = new CalendarProviderGateway([adapter], providerStore, { now: () => new Date("2026-09-01T12:00:00.000Z") });
    await gateway.connectExternalAccount({ ownerId: DEMO_OWNER_ID, connectionId, providerKey: "google",
      expectedProviderAccountId: "synthetic-provider-account", credentialHandle: calendarProviderCredentialHandle("synthetic-test-vault-handle"),
      calendars: [{ calendarId, providerCalendarId, title: "Synthetic connected calendar", color: "#123456", timeZone: "UTC", isDefault: false }],
      initialWindow: { startUtc: "2026-09-01T00:00:00.000Z", endUtc: "2026-09-03T00:00:00.000Z" }
    });
    const initial = (await gateway.listManagedCalendars(DEMO_OWNER_ID, connectionId))[0];
    expect(initial.calendar.agentAccess).toBe("none");
    const changed = await gateway.updateCalendarSettings({ ownerId: DEMO_OWNER_ID, connectionId, calendarId,
      expectedUpdatedAt: initial.calendar.updatedAt, patch: { visible: false, agentAccess: "read" } });
    expect(changed).toMatchObject({ visible: false, calendar: { agentAccess: "read" } });
    expect((await store.getCalendar(DEMO_OWNER_ID, calendarId))?.agentAccess).toBe("read");
    expect((await providerStore.getCalendar(connectionId, calendarId))?.agentGrant).toBe("read");
    expect(await gateway.listConnections(DEMO_GUEST_ID)).toEqual([]);
    await expect(gateway.updateCalendarSettings({ ownerId: DEMO_OWNER_ID, connectionId, calendarId,
      expectedUpdatedAt: initial.calendar.updatedAt, patch: { agentAccess: "write" } }))
      .rejects.toMatchObject({ code: "calendar_settings_conflict" });
    const concurrent = await Promise.allSettled([
      gateway.updateCalendarSettings({ ownerId: DEMO_OWNER_ID, connectionId, calendarId,
        expectedUpdatedAt: changed.calendar.updatedAt, patch: { visible: true } }),
      gateway.updateCalendarSettings({ ownerId: DEMO_OWNER_ID, connectionId, calendarId,
        expectedUpdatedAt: changed.calendar.updatedAt, patch: { agentAccess: "write" } })
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const independentGrant = await postgresPool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'calendar_provider_bindings' AND column_name = 'agent_grant'"
    );
    expect(independentGrant.rows).toEqual([]);
    const offlineGateway = new CalendarProviderGateway([], providerStore);
    expect(await offlineGateway.disconnectConnection({ ownerId: DEMO_OWNER_ID, connectionId, localProjectionDisposition: "purge" }))
      .toMatchObject({ status: "disconnected", remoteRevocationStatus: "pending", remoteRevocationAttemptedAt: null });
    expect(await providerStore.listProjections(connectionId, calendarId)).toEqual([]);
    expect((await store.getCalendar(DEMO_OWNER_ID, calendarId))?.agentAccess).toBe("none");
    expect((await providerStore.getCalendar(connectionId, calendarId))?.visible).toBe(false);
    expect(adapter.eventCount(providerCalendarId)).toBe(1);
    expect(adapter.metrics().revokeCalls).toBe(0);
  });

  describe("isolated saved-change parity", () => {
    let parityStore: PostgresLifeLinksStore;
    let parityPool: Pool;
    let paritySchema: string;
    beforeEach(async () => {
      paritySchema = createSchemaName();
      await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(paritySchema)}`);
      const instance = createPostgresStore(requireTestDatabaseUrl(), paritySchema);
      parityStore = instance.store;
      parityPool = instance.pool;
      await runMigrations(instance.pool, migrationDir, logger);
      await parityStore.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
    });
    afterEach(async () => {
      await parityStore?.close();
      if (paritySchema) await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(paritySchema)} CASCADE`);
    });
    changeHistoryStoreContract(() => parityStore);

    it("keeps saved deletions and detached QRs unchanged through ordinary startup seed", async () => {
      const deletedId = "legacy-life-link:LL-DEMO-00001";
      const detachedId = "legacy-life-link:LL-DEMO-00002";
      const detached = (await parityStore.getLifeLinkDetail(DEMO_OWNER_ID, detachedId))!.lifeLink;
      await parityStore.clearLifeLinkQrBinding(DEMO_OWNER_ID, { lifeLinkId: detachedId, expectedUpdatedAt: detached.updatedAt, commandId: "startup-clear" });
      const preview = await parityStore.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [deletedId] });
      await parityStore.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "startup-delete" });
      const history = await parityStore.getChangeHistory(DEMO_OWNER_ID);
      await parityStore.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
      expect(await parityStore.getLifeLinkDetail(DEMO_OWNER_ID, deletedId)).toBeNull();
      expect((await parityStore.getLifeLinkDetail(DEMO_OWNER_ID, detachedId))!.lifeLink.qrId).toBeNull();
      expect(await parityStore.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
      expect(await parityStore.getQrState("LL-DEMO-00001", null)).toEqual({ state: "private", qrId: "LL-DEMO-00001" });
    });

    it("fingerprints media bytes and closes the concurrent delete/foreign-claim gap", async () => {
      const id = "history-race";
      await parityStore.createLifeLink({ id, ownerId: DEMO_OWNER_ID, title: "Race fixture", createdAt: "2026-08-30T00:00:00.000Z" });
      const media = (await parityStore.createLifeLinkMedia(DEMO_OWNER_ID, id, { kind: "image", mimeType: "image/png", fileName: "bytes.png", sizeBytes: 4, data: Buffer.from("data") }))!;
      const qrId = (await parityStore.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL)).qrCodes[0].id;
      await parityStore.claimQr(qrId, DEMO_OWNER_ID, { mode: "attach", lifeLinkId: id, commandId: "race-owner-claim" });
      const stale = await parityStore.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [id] });
      await parityPool.query("UPDATE link_media SET data = $1 WHERE id = $2", [Buffer.from("edit"), media.id]);
      await expect(parityStore.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: stale.id, commandId: "stale-bytes" })).rejects.toMatchObject({ code: "stale_life_link" });
      const preview = await parityStore.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [id] });
      const [deleted, claimed] = await Promise.allSettled([
        parityStore.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: "race-delete" }),
        parityStore.claimQr(qrId, DEMO_GUEST_ID, { mode: "create", commandId: "race-guest-claim" })
      ]);
      expect(deleted.status).toBe("fulfilled");
      if (claimed.status === "fulfilled") expect(claimed.value.result).toBe("owned_by_other");
      else expect(claimed.reason).toMatchObject({ code: "qr_already_bound" });
      expect(await parityStore.getQrState(qrId, null)).toEqual({ state: "private", qrId });
      const history = await parityStore.getChangeHistory(DEMO_OWNER_ID);
      await parityStore.undoChange(DEMO_OWNER_ID, { changeId: history.entries[0].id, commandId: "race-undo" });
      expect((await parityStore.getLifeLinkMedia(DEMO_OWNER_ID, id, media.id))?.data).toEqual(Buffer.from("edit"));
      expect((await parityStore.getLifeLinkDetail(DEMO_OWNER_ID, id))?.lifeLink.qrId).toBe(qrId);
    });

    it("never truncates the saved descendant closure and expires bounded owner previews", async () => {
      const id = "history-large-root";
      await parityStore.createLifeLink({ id, ownerId: DEMO_OWNER_ID, title: "Large folder", browsingRole: "container", createdAt: "2026-08-30T00:00:00.000Z" });
      await parityPool.query(`INSERT INTO life_links (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at)
        SELECT 'history-large-' || n, $1, $2, 'Child ' || n, '', '{"type":"doc","content":[]}'::jsonb, 1, 'private', now(), now() FROM generate_series(1, 105) n`, [DEMO_OWNER_ID, id]);
      const history = await parityStore.getChangeHistory(DEMO_OWNER_ID);
      const previews = [];
      for (let index = 0; index < 6; index++) previews.push(await parityStore.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [id] }));
      expect(previews[5].items).toHaveLength(106);
      expect(await parityStore.getLifeLinkChangePreview(DEMO_OWNER_ID, previews[0].id)).toBeNull();
      expect((await parityPool.query("SELECT count(*)::int AS count FROM life_link_change_previews WHERE owner_id = $1", [DEMO_OWNER_ID])).rows[0].count).toBe(5);
      await parityPool.query("UPDATE life_link_change_previews SET created_at = now() - interval '16 minutes' WHERE id = $1", [previews[5].id]);
      expect(await parityStore.getLifeLinkChangePreview(DEMO_OWNER_ID, previews[5].id)).toBeNull();
      expect(await parityStore.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
      const lastChild = (await parityStore.getLifeLinkDetail(DEMO_OWNER_ID, "history-large-105"))!.lifeLink;
      await parityStore.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: lastChild.id, expectedUpdatedAt: lastChild.updatedAt, patch: { title: "Last descendant changed" } });
      await expect(parityStore.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: previews[4].id, commandId: "large-stale" })).rejects.toMatchObject({ code: "stale_life_link" });
      const journal = (await parityPool.query("SELECT inverse_rows FROM saved_changes WHERE owner_id = $1 ORDER BY sequence DESC LIMIT 1", [DEMO_OWNER_ID])).rows[0].inverse_rows;
      expect(journal).toHaveLength(1);
      expect(journal[0].key.id).toBe(lastChild.id);
      expect(journal[0]).not.toHaveProperty("after");
    });
  });

  beforeAll(async () => {
    const url = requireTestDatabaseUrl();
    schemaName = createSchemaName();
    adminPool = new Pool({ connectionString: url });
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);

    const postgres = createPostgresStore(url, schemaName);
    store = postgres.store;
    postgresPool = postgres.pool;
    await runMigrations(postgres.pool, migrationDir, logger);
    await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);

    app = createLifeLinksApp({
      store,
      config: readConfig({
        NODE_ENV: "test",
        LIFE_LINKS_STORE: "postgres",
        DATABASE_URL: url,
        SESSION_SECRET: "test-session-secret",
        QR_BASE_URL: DEFAULT_QR_BASE_URL,
        COOKIE_SECURE: "false"
      }),
      logger
    });
  });

  afterAll(async () => {
    await store?.close();
    if (adminPool && schemaName) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await adminPool.end();
    }
  });

  it("applies migrations and seed data idempotently from an empty schema", async () => {
    const migrationCount = await adminPool.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1",
      [schemaName]
    );
    expect(migrationCount.rows[0].count).toBeGreaterThanOrEqual(8);

    await runMigrations(postgresPool, migrationDir, logger);
    await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);

    const users = await adminPool.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(schemaName)}.users`);
    const migrations = await adminPool.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(schemaName)}.schema_migrations`
    );
    expect(users.rows[0].count).toBe(2);
    expect(migrations.rows[0].count).toBe(12);
    const agentConnectionColumn = await adminPool.query(
      `SELECT is_nullable, data_type
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'agent_connected_at'`,
      [schemaName]
    );
    expect(agentConnectionColumn.rows).toEqual([{ is_nullable: "YES", data_type: "timestamp with time zone" }]);
  });

  it("enforces Field Ledger relational invariants in PostgreSQL itself", async () => {
    const suffix = randomUUID();
    const createdAt = "2026-08-29T00:00:00.000Z";
    const parent = await store.createLifeLink({ id: `life-link-parent-${suffix}`, ownerId: DEMO_OWNER_ID,
      title: "Container", browsingRole: "container", createdAt });
    const child = await store.createLifeLink({ id: `life-link-child-${suffix}`, ownerId: DEMO_OWNER_ID,
      title: "Child", parentId: parent.id, createdAt });
    const foreign = await store.createLifeLink({ id: `life-link-foreign-${suffix}`, ownerId: DEMO_GUEST_ID,
      title: "Foreign", createdAt });
    const collection = await store.createCollection({ id: `collection-${randomUUID()}`, ownerId: DEMO_OWNER_ID,
      title: "Test", createdAt });
    await expect(postgresPool.query("UPDATE life_links SET browsing_role = 'item' WHERE id = $1", [parent.id]))
      .rejects.toThrow();
    await expect(postgresPool.query(
      "INSERT INTO collection_memberships(owner_id, collection_id, life_link_id, created_at) VALUES ($1,$2,$3,$4)",
      [DEMO_OWNER_ID, collection.id, foreign.id, createdAt])).rejects.toMatchObject({ code: "23503" });
    const section = (await store.createCollectionSection(DEMO_OWNER_ID, { id: `section-${randomUUID()}`,
      collectionId: collection.id, title: "Empty section", expectedUpdatedAt: collection.updatedAt }))!;
    await expect(postgresPool.query(
      "INSERT INTO collection_section_assignments(owner_id, collection_id, life_link_id, section_id, created_at) VALUES ($1,$2,$3,$4,$5)",
      [DEMO_OWNER_ID, collection.id, child.id, section.section.id, createdAt])).rejects.toMatchObject({ code: "23503" });
    await expect(postgresPool.query("UPDATE life_links SET context = $2::jsonb WHERE id = $1",
      [child.id, JSON.stringify({ schemaVersion: 1, invented: { text: "not admitted", truthState: "planned" } })]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(postgresPool.query("UPDATE life_links SET public_field_keys = ARRAY['ownerId'] WHERE id = $1", [child.id]))
      .rejects.toMatchObject({ code: "23514" });
    for (const invalidContext of [null, { schemaVersion: 1, plan: { text: "planned" } },
      { schemaVersion: 1, plan: { text: "\t\n", truthState: "planned" } }]) {
      await expect(postgresPool.query("UPDATE life_links SET context = $2::jsonb WHERE id = $1",
        [child.id, JSON.stringify(invalidContext)])).rejects.toMatchObject({ code: "23514" });
    }
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))?.lifeLink).toEqual(child);
  });

  it.each([
    { kind: "image" as const, mimeType: "image/png", fileName: "synthetic.png", data: Buffer.from([0, 1, 127, 255]) },
    { kind: "document" as const, mimeType: "text/plain", fileName: "travel-notes.txt", data: Buffer.from("Document notes\r\nCafé – Québec\tpack list\r\n", "utf8") }
  ])("atomically deletes the full descendant closure and restores identities, $kind attachment bytes, memberships, QR and receipt meaning", async (input) => {
    const suffix = randomUUID();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const parent = await store.createLifeLink({ id: `undo-parent-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Travel folder", browsingRole: "container", createdAt });
    const child = await store.createLifeLink({ id: `undo-child-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Passport pouch", parentId: parent.id, createdAt });
    const uploaded = (await store.createLifeLinkMedia(DEMO_OWNER_ID, child.id, { ...input, sizeBytes: input.data.byteLength }))!;
    const uploadChange = (await store.getChangeHistory(DEMO_OWNER_ID)).entries[0];
    await store.undoChange(DEMO_OWNER_ID, { changeId: uploadChange.id, commandId: `undo-upload-${suffix}` });
    expect(await store.getLifeLinkMedia(DEMO_OWNER_ID, child.id, uploaded.id)).toBeNull();
    const media = (await store.createLifeLinkMedia(DEMO_OWNER_ID, child.id, { ...input, sizeBytes: input.data.byteLength }))!;
    expect(await store.deleteLifeLinkMedia(DEMO_OWNER_ID, child.id, media.id)).toBe(true);
    const removeChange = (await store.getChangeHistory(DEMO_OWNER_ID)).entries[0];
    await store.undoChange(DEMO_OWNER_ID, { changeId: removeChange.id, commandId: `undo-remove-${suffix}` });
    expect((await store.getLifeLinkMedia(DEMO_OWNER_ID, child.id, media.id))?.data).toEqual(input.data);
    const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    const claimCommand = { commandId: `undo-claim-${suffix}`, mode: "attach" as const, lifeLinkId: child.id };
    await store.claimQr(qrId, DEMO_OWNER_ID, claimCommand);
    let collection = await store.createCollection({ id: `collection-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Travel", purpose: "Synthetic", createdAt });
    collection = (await store.addCollectionMember(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: child.id, expectedUpdatedAt: collection.updatedAt }))!;
    const section = (await store.createCollectionSection(DEMO_OWNER_ID, { id: `section-${suffix}`, collectionId: collection.id, title: "Documents", expectedUpdatedAt: collection.updatedAt }))!;
    await store.replaceCollectionSectionAssignments(DEMO_OWNER_ID, { collectionId: collection.id, lifeLinkId: child.id, sectionIds: [section.section.id], expectedUpdatedAt: section.collection.updatedAt });
    const destination = await store.createLifeLink({ id: `undo-destination-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Destination", browsingRole: "container", createdAt });
    const beforeMove = (await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))!.lifeLink.media;
    const movePreview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: [parent.id], parentId: destination.id });
    await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: movePreview.id, commandId: `move-attachments-${suffix}` });
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))!.lifeLink.media).toEqual(beforeMove);
    expect((await store.getLifeLinkMedia(DEMO_OWNER_ID, child.id, media.id))?.data).toEqual(input.data);
    const beforeChild = (await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))!.lifeLink;
    const historyBefore = await store.getChangeHistory(DEMO_OWNER_ID);
    const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [parent.id, child.id] });
    expect(preview.rootIds).toEqual([parent.id]);
    expect(preview.items.map((item) => item.id)).toEqual([parent.id, child.id]);
    expect(preview.sideEffects).toEqual({ lifeLinks: 2, media: 1, qrBindings: 1, collectionMemberships: 1, collectionSectionAssignments: 1 });
    expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(historyBefore);
    const applied = await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: `undo-delete-${suffix}` });
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id)).toBeNull();
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id)).toBeNull();
    expect(await store.getQrState(qrId, null)).toEqual({ state: "private", qrId });
    expect(await store.getQrState(qrId, DEMO_OWNER_ID)).toMatchObject({ state: "unclaimed" });
    expect((await store.listCollectionMembers(DEMO_OWNER_ID, collection.id))?.items).toHaveLength(0);
    expect((await postgresPool.query("SELECT 1 FROM claim_events WHERE command_id = $1", [claimCommand.commandId])).rowCount).toBe(1);
    await expect(store.claimQr(qrId, DEMO_GUEST_ID, { commandId: `foreign-reserved-${suffix}`, mode: "create" })).rejects.toMatchObject({ code: "qr_already_bound" });
    await expect(store.createLifeLink({ id: child.id, ownerId: DEMO_GUEST_ID, title: "Identity collision", createdAt })).rejects.toMatchObject({ code: "duplicate_life_link_id" });
    const undoCommand = { changeId: applied.history.entries[0].id, commandId: `undo-restore-${suffix}` };
    const restored = await store.undoChange(DEMO_OWNER_ID, undoCommand);
    expect(restored.history.entries).toEqual(historyBefore.entries.slice(0, 4));
    const afterChild = (await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))!.lifeLink;
    expect(afterChild).toEqual({ ...beforeChild, updatedAt: afterChild.updatedAt });
    expect(Date.parse(afterChild.updatedAt)).toBeGreaterThan(Date.parse(beforeChild.updatedAt));
    expect((await store.getLifeLinkMedia(DEMO_OWNER_ID, child.id, media.id))?.data).toEqual(input.data);
    expect((await store.listLifeLinkCollectionMemberships(DEMO_OWNER_ID, child.id))?.items[0].sections.map((item) => item.id)).toEqual([section.section.id]);
    expect(await store.claimQr(qrId, DEMO_OWNER_ID, claimCommand)).toMatchObject({ result: "claimed", replayed: true });
    expect(await store.undoChange(DEMO_OWNER_ID, undoCommand)).toEqual(restored);
    expect((await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: `undo-delete-${suffix}` })).history).toEqual(restored.history);
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id)).not.toBeNull();
    const anotherStore = createPostgresStore(requireTestDatabaseUrl(), schemaName);
    try { expect(await anotherStore.store.getChangeHistory(DEMO_OWNER_ID)).toEqual(restored.history); }
    finally { await anotherStore.store.close(); }
  });

  it("revalidates unseen descendants and serializes concurrent bulk apply without duplicating history", async () => {
    const suffix = randomUUID();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const parent = await store.createLifeLink({ id: `bulk-parent-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Source", browsingRole: "container", createdAt });
    const target = await store.createLifeLink({ id: `bulk-target-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Destination", browsingRole: "container", createdAt });
    const child = await store.createLifeLink({ id: `bulk-child-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Deep child", parentId: parent.id, createdAt });
    const stale = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [parent.id] });
    await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: child.id, expectedUpdatedAt: child.updatedAt, patch: { title: "Changed descendant" } });
    await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: stale.id, commandId: `stale-${suffix}` })).rejects.toMatchObject({ code: "stale_life_link" });
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id)).not.toBeNull();
    const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: [parent.id, child.id], parentId: target.id });
    const command = { previewId: preview.id, commandId: `bulk-apply-${suffix}` };
    const [first, replay] = await Promise.all([store.applyLifeLinkChange(DEMO_OWNER_ID, command), store.applyLifeLinkChange(DEMO_OWNER_ID, command)]);
    expect(replay).toEqual(first);
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, parent.id))?.lifeLink.parentId).toBe(target.id);
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, child.id))?.lifeLink.parentId).toBe(parent.id);
    expect((await postgresPool.query("SELECT count(*)::int AS count FROM life_link_change_receipts WHERE command_id = $1", [command.commandId])).rows[0].count).toBe(1);
    const noOp = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: [parent.id], parentId: target.id });
    expect((await store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: noOp.id, commandId: `no-op-${suffix}` })).history).toEqual(first.history);
    await expect(store.applyLifeLinkChange(DEMO_GUEST_ID, command)).rejects.toBeInstanceOf(ClaimIdempotencyConflictError);
    await expect(store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "move", lifeLinkIds: [parent.id], parentId: child.id })).rejects.toMatchObject({ code: "invalid_parent" });
    expect(await store.getLifeLinkChangePreview(DEMO_GUEST_ID, stale.id)).toBeNull();
  });

  it("bounds saved history to five real mutations, supports sequential Undo, and releases only evicted QR reservations", async () => {
    const suffix = randomUUID();
    let item = await store.createLifeLink({ id: `history-item-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Version zero", createdAt: "2026-08-30T00:00:00.000Z" });
    const batch = await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    await store.claimQr(qrId, DEMO_OWNER_ID, { mode: "attach", lifeLinkId: item.id, commandId: `history-claim-${suffix}` });
    item = (await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink;
    await store.clearLifeLinkQrBinding(DEMO_OWNER_ID, { lifeLinkId: item.id, expectedUpdatedAt: item.updatedAt, commandId: `history-clear-${suffix}` });
    for (let index = 1; index <= 5; index++) {
      item = (await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))!.lifeLink;
      item = (await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id, expectedUpdatedAt: item.updatedAt, patch: { title: `Version ${index}` } }))!;
    }
    let history = await store.getChangeHistory(DEMO_OWNER_ID);
    expect(history.entries).toHaveLength(5);
    const frozen = history;
    await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id, expectedUpdatedAt: item.updatedAt, patch: { title: item.title } });
    await store.createQrBatch(DEMO_OWNER_ID, 1, DEFAULT_QR_BASE_URL);
    await store.connectAgent(DEMO_OWNER_ID);
    expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(frozen);
    await store.disconnectAgent(DEMO_OWNER_ID);
    await expect(store.undoChange(DEMO_OWNER_ID, { changeId: history.entries[1].id, commandId: `out-of-order-${suffix}` })).rejects.toMatchObject({ code: "stale_life_link" });
    expect(await store.claimQr(qrId, DEMO_GUEST_ID, { mode: "create", commandId: `evicted-claim-${suffix}` })).toMatchObject({ result: "claimed" });
    for (let index = 4; index >= 0; index--) {
      const result = await store.undoChange(DEMO_OWNER_ID, { changeId: history.entries[0].id, commandId: `history-undo-${suffix}-${index}` });
      expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink.title).toBe(index ? `Version ${index}` : "Version zero");
      history = result.history;
    }
    expect(history.entries).toHaveLength(0);
  });

  it("rolls back a partially executed bulk deletion and rejects conflicting inverse state without partial restoration", async () => {
    const suffix = randomUUID();
    const item = await store.createLifeLink({ id: `rollback-item-${suffix}`, ownerId: DEMO_OWNER_ID, title: "Before", createdAt: "2026-08-30T00:00:00.000Z" });
    const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [item.id] });
    const history = await store.getChangeHistory(DEMO_OWNER_ID);
    await postgresPool.query("CREATE FUNCTION reject_test_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced journal failure'; END $$");
    await postgresPool.query("CREATE TRIGGER reject_test_history_trigger BEFORE INSERT ON saved_changes FOR EACH ROW EXECUTE FUNCTION reject_test_history()");
    try { await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: `rollback-${suffix}` })).rejects.toThrow("forced journal failure"); }
    finally {
      await postgresPool.query("DROP TRIGGER reject_test_history_trigger ON saved_changes");
      await postgresPool.query("DROP FUNCTION reject_test_history()");
    }
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink).toEqual(item);
    expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(history);
    const changed = (await store.updateLifeLink(DEMO_OWNER_ID, { lifeLinkId: item.id, expectedUpdatedAt: item.updatedAt, patch: { title: "After" } }))!;
    const changedHistory = await store.getChangeHistory(DEMO_OWNER_ID);
    await postgresPool.query("UPDATE life_links SET title = 'External conflicting write' WHERE id = $1", [item.id]);
    await expect(store.undoChange(DEMO_OWNER_ID, { changeId: changedHistory.entries[0].id, commandId: `conflict-${suffix}` })).rejects.toMatchObject({ code: "stale_life_link" });
    expect((await store.getLifeLinkDetail(DEMO_OWNER_ID, item.id))?.lifeLink.title).toBe("External conflicting write");
    expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(changedHistory);
    expect(changed.title).toBe("After");
  });

  it("dry-runs and atomically restores the isolated competition fixture without touching another owner", async () => {
    const options = {
      password: "competition-postgres-password",
      qrBaseUrl: "https://challenge.life-links.test"
    };
    const legacyOwnerBefore = await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home");
    const absentDryRun = await store.resetCompetitionFixture(options);
    expect(absentDryRun).toMatchObject({
      profile: COMPETITION_FIXTURE_PROFILE,
      ownerId: COMPETITION_OWNER_ID,
      mode: "dry-run",
      applied: false,
      shapeMatchesExpected: false,
      before: { users: 0, sessions: 0, lifeLinks: 0 },
      after: { users: 0, sessions: 0, lifeLinks: 0 },
      expected: { users: 1, sessions: 0, lifeLinks: 60, qrBindings: 8, batches: 1, qrCodes: 8 }
    });
    expect(absentDryRun.expected).toEqual({
      users: 1,
      sessions: 0,
      lifeLinks: 60,
      qrBindings: 8,
      collections: 1,
      collectionSections: 5,
      collectionMemberships: 48,
      collectionSectionAssignments: 52,
      media: 0,
      batches: 1,
      qrCodes: 8,
      claimEvents: 0,
      routineGroups: 0,
      routineActivities: 0,
      routines: 0,
      routineRevisions: 0,
      routineSteps: 0,
      routineContextBindings: 0,
      routineSchedules: 0,
      routineOccurrences: 0,
      routineRuns: 0,
      routineSessions: 0,
      routineSessionStepResults: 0,
      routineSessionAmendments: 0,
      calendars: 0,
      calendarEvents: 0,
      calendarEventRevisions: 0,
      calendarEventSubjectLinks: 0,
      calendarEventTombstones: 0,
      calendarProviderConnections: 0,
      calendarProviderBindings: 0,
      calendarProviderSyncStates: 0,
      calendarProviderEventProjections: 0,
      calendarProviderEventProjectionRevisions: 0,
      calendarProviderEventTombstones: 0,
      calendarProviderEventTombstoneHistory: 0,
      calendarProviderOutbox: 0,
      calendarProviderWebhookHints: 0
    });
    expect(await store.getUserById(COMPETITION_OWNER_ID)).toBeNull();

    const firstApply = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(firstApply.after).toEqual(firstApply.expected);
    expect(firstApply.shapeMatchesExpected).toBe(true);
    const resetActivity = await store.createActivity({ id: `activity-${randomUUID()}`, ownerId: COMPETITION_OWNER_ID,
      title: "Reset probe", createdAt: "2026-09-01T00:00:00.000Z" });
    await store.createRoutine({ id: `routine-${randomUUID()}`, revisionId: `routine-revision-${randomUUID()}`,
      ownerId: COMPETITION_OWNER_ID, title: "Reset probe", createdAt: "2026-09-01T00:00:00.000Z",
      steps: [{ id: `routine-step-${randomUUID()}`, activityId: resetActivity.id, activityTitle: resetActivity.title, position: 0 }] });
    const resetCalendar = await store.createCalendar({ id: `calendar-${randomUUID()}`, ownerId: COMPETITION_OWNER_ID,
      title: "Reset probe", timeZone: "America/New_York", createdAt: "2026-09-01T00:00:00.000Z" });
    await store.createCalendarEvent({ id: `calendar-event-${randomUUID()}`, revisionId: `calendar-event-revision-${randomUUID()}`,
      ownerId: COMPETITION_OWNER_ID, calendarId: resetCalendar.id, title: "Reset probe",
      span: { kind: "all_day", startDate: "2026-08-31", endDateExclusive: "2026-09-01" },
      createdAt: "2026-09-01T00:00:00.000Z" });
    expect((await store.resetCompetitionFixture(options)).before).toMatchObject({
      routines: 1, routineActivities: 1, routineRevisions: 1, routineSteps: 1,
      calendars: 1, calendarEvents: 1, calendarEventRevisions: 1
    });
    expect((await store.resetCompetitionFixture({ ...options, mode: "apply" })).after).toEqual(firstApply.expected);
    expect((await store.resetCompetitionFixture(options)).shapeMatchesExpected).toBe(true);
    expect((await store.resetCompetitionFixture({ ...options, password: "wrong-password" })).shapeMatchesExpected).toBe(false);
    expect((await store.listCollectionMembers(COMPETITION_OWNER_ID, COMPETITION_CAMPING_COLLECTION_ID, { limit: 100 }))?.items).toHaveLength(48);
    expect((await store.listCollectionSections(COMPETITION_OWNER_ID, COMPETITION_CAMPING_COLLECTION_ID, { limit: 100 }))?.items.map((item) => item.title)).toEqual([
      "Family sleep systems", "Shelter", "Camp kitchen", "Cycling kit", "Next-year upgrades"
    ]);
    expect((await store.listLifeLinkCollectionMemberships(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_PAD_ID))?.items[0].sections.map((item) => item.id)).toEqual([
      COMPETITION_SECTION_IDS.familySleepSystems, COMPETITION_SECTION_IDS.nextYearUpgrades
    ]);
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBeNull();
    const connectedAt = (await store.connectAgent(COMPETITION_OWNER_ID))?.agentConnectedAt;
    expect(connectedAt).toEqual(expect.any(String));
    const start = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_START_LIFE_LINK_ID);
    expect(start?.ancestry.items.map((item) => item.title)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Storage wall",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE
    ]);
    expect(start?.lifeLink).toMatchObject({ qrId: COMPETITION_TARGET_QR_ID, privacy: "public" });
    const sleepingBag = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID);
    expect(sleepingBag?.ancestry.items.map((item) => item.title)).toEqual([
      COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
      "Storage wall",
      COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
      "Adult Two Sleep Bag",
      "Camping Sleeping Bag"
    ]);
    expect(sleepingBag?.lifeLink).toMatchObject({ qrId: COMPETITION_SLEEPING_BAG_QR_ID, privacy: "public" });

    expect(await store.getQrState(COMPETITION_TARGET_QR_ID, null)).toMatchObject({
      state: "claimed",
      viewerIsOwner: false,
      link: {
        ownerId: null,
        title: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
        body: "",
        context: { schemaVersion: 1, summary: { text: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY, truthState: "owner_reported" } }
      }
    });
    expect(JSON.stringify(await store.getQrState(COMPETITION_TARGET_QR_ID, null))).not.toMatch(
      /low-R|Adult Two|working bag|cold through|upgrade|\$250/i
    );
    expect(await store.getQrState(COMPETITION_TARGET_QR_ID, COMPETITION_OWNER_ID)).toMatchObject({
      state: "claimed",
      viewerIsOwner: true,
      link: { ownerId: COMPETITION_OWNER_ID }
    });

    await store.createSession(
      COMPETITION_OWNER_ID,
      "competition-postgres-session-hash",
      "2099-01-01T00:00:00.000Z"
    );
    await store.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
      expectedUpdatedAt: sleepingBag!.lifeLink.updatedAt,
      patch: { title: "Drifted Postgres battery kit" }
    });
    await store.createLifeLink({
      id: "competition-postgres-extra-life-link",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Judge-created Postgres extra",
      createdAt: "2026-08-26T13:00:00.000Z"
    });
    await store.createQrBatch(COMPETITION_OWNER_ID, 1, options.qrBaseUrl);
    const retainedPreview = await store.previewLifeLinkChange(COMPETITION_OWNER_ID, { operation: "delete", lifeLinkIds: [COMPETITION_SLEEPING_BAG_ID] });
    expect((await store.getChangeHistory(COMPETITION_OWNER_ID)).entries.length).toBeGreaterThan(0);

    const driftDryRun = await store.resetCompetitionFixture(options);
    expect(driftDryRun.applied).toBe(false);
    expect(driftDryRun.shapeMatchesExpected).toBe(false);
    expect(driftDryRun.after).toEqual(driftDryRun.before);
    expect(
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title
    ).toBe("Drifted Postgres battery kit");
    expect(await store.getSessionByTokenHash("competition-postgres-session-hash")).not.toBeNull();

    const restored = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(restored.after).toEqual(restored.expected);
    expect((await store.getChangeHistory(COMPETITION_OWNER_ID)).entries).toEqual([]);
    expect(await store.getLifeLinkChangePreview(COMPETITION_OWNER_ID, retainedPreview.id)).toBeNull();
    expect(await store.getSessionByTokenHash("competition-postgres-session-hash")).toBeNull();
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBe(connectedAt);
    expect(await store.getLifeLinkDetail(COMPETITION_OWNER_ID, "competition-postgres-extra-life-link")).toBeNull();
    expect(
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title
    ).toBe("Camping Sleeping Bag");
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home")).toEqual(legacyOwnerBefore);

    const replay = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(replay.before).toEqual(replay.expected);
    expect(replay.after).toEqual(replay.expected);
    expect((await store.getUserById(COMPETITION_OWNER_ID))?.agentConnectedAt).toBe(connectedAt);

    const collection = await store.getCollection(COMPETITION_OWNER_ID, COMPETITION_CAMPING_COLLECTION_ID);
    await store.updateCollection(COMPETITION_OWNER_ID, {
      collectionId: COMPETITION_CAMPING_COLLECTION_ID, expectedUpdatedAt: collection!.updatedAt,
      patch: { title: "Same-count Collection drift" }
    });
    const sameCountDrift = await store.resetCompetitionFixture(options);
    expect(sameCountDrift.before).toEqual(sameCountDrift.expected);
    expect(sameCountDrift.after).toEqual(sameCountDrift.before);
    expect(sameCountDrift.shapeMatchesExpected).toBe(false);
    expect((await store.getCollection(COMPETITION_OWNER_ID, COMPETITION_CAMPING_COLLECTION_ID))?.title).toBe("Same-count Collection drift");
    expect((await store.resetCompetitionFixture({ ...options, mode: "apply" })).shapeMatchesExpected).toBe(true);

    const foreignBatch = await store.createQrBatch(DEMO_OWNER_ID, 1, options.qrBaseUrl);
    const foreignQrId = foreignBatch.qrCodes[0].id;
    const foreignCommandId = "competition-postgres-foreign-qr-attach";
    const foreignTarget = await store.createLifeLink({
      id: "competition-postgres-foreign-qr-target",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Foreign Postgres QR reset sentinel",
      createdAt: "2026-08-26T14:00:00.000Z"
    });
    try {
      await store.claimQr(foreignQrId, COMPETITION_OWNER_ID, {
        commandId: foreignCommandId,
        mode: "attach",
        lifeLinkId: foreignTarget.id
      });
      const foreignBatchView = await store.listBatchLinks(DEMO_OWNER_ID, foreignBatch.batch.id);
      expect(foreignBatchView).toHaveLength(1);
      expect(foreignBatchView[0]).toMatchObject({
        id: foreignQrId,
        status: "claimed",
        ownerId: null,
        title: "",
        body: "",
        privacy: "private",
        media: []
      });
      expect(JSON.stringify(foreignBatchView)).not.toContain("Foreign Postgres QR reset sentinel");
      expect(JSON.stringify(foreignBatchView)).not.toContain(COMPETITION_OWNER_ID);
      await expect(store.resetCompetitionFixture({ ...options, mode: "apply" })).rejects.toThrow(
        "outside its owner sandbox"
      );
      expect(await store.getQrState(foreignQrId, COMPETITION_OWNER_ID)).toMatchObject({
        state: "claimed",
        viewerIsOwner: true,
        link: { ownerId: COMPETITION_OWNER_ID }
      });
    } finally {
      await postgresPool.query("DELETE FROM claim_events WHERE command_id = $1", [foreignCommandId]);
      await postgresPool.query("DELETE FROM life_link_qr_bindings WHERE qr_id = $1", [foreignQrId]);
      await postgresPool.query("DELETE FROM life_links WHERE id = $1", [foreignTarget.id]);
      await postgresPool.query("DELETE FROM qr_codes WHERE id = $1", [foreignQrId]);
      await postgresPool.query("DELETE FROM export_batches WHERE id = $1", [foreignBatch.batch.id]);
    }
  });

  it("rolls back every competition-fixture mutation when an exact postcondition cannot be established", async () => {
    const options = {
      password: "competition-postgres-password",
      qrBaseUrl: "https://challenge.life-links.test",
      mode: "apply" as const
    };
    await store.resetCompetitionFixture(options);
    const target = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID);
    await store.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
      expectedUpdatedAt: target!.lifeLink.updatedAt,
      patch: { title: "Rollback sentinel title" }
    });
    await store.createSession(
      COMPETITION_OWNER_ID,
      "competition-postgres-rollback-session-hash",
      "2099-01-01T00:00:00.000Z"
    );

    await postgresPool.query(
      `CREATE FUNCTION fail_competition_fixture_insert() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.id = '${COMPETITION_SLEEPING_BAG_ID}' THEN
           RAISE EXCEPTION 'forced competition fixture insert failure';
         END IF;
         RETURN NEW;
       END $$`
    );
    await postgresPool.query(
      "CREATE TRIGGER fail_competition_fixture_insert_trigger BEFORE INSERT ON life_links FOR EACH ROW EXECUTE FUNCTION fail_competition_fixture_insert()"
    );
    try {
      await expect(store.resetCompetitionFixture(options)).rejects.toThrow("forced competition fixture insert failure");
    } finally {
      await postgresPool.query("DROP TRIGGER IF EXISTS fail_competition_fixture_insert_trigger ON life_links");
      await postgresPool.query("DROP FUNCTION IF EXISTS fail_competition_fixture_insert()");
    }

    expect(
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_SLEEPING_BAG_ID))?.lifeLink.title
    ).toBe("Rollback sentinel title");
    expect(await store.getSessionByTokenHash("competition-postgres-rollback-session-hash")).not.toBeNull();

    const restored = await store.resetCompetitionFixture(options);
    expect(restored.after).toEqual(restored.expected);
  });

  it("enforces QR uniqueness and claim ownership transactions", async () => {
    const owner = await store.getUserByEmail("owner@life-links.test");
    const guest = await store.getUserByEmail("guest@life-links.test");
    expect(owner).not.toBeNull();
    expect(guest).not.toBeNull();

    const batch = await store.createQrBatch(owner!.id, 1, DEFAULT_QR_BASE_URL);
    const qrId = batch.qrCodes[0].id;
    expect(qrId).toMatch(/^LL-[A-F0-9]{8}-[A-Z0-9]{16}$/);

    await expect(
      adminPool.query(
        `INSERT INTO ${quoteIdentifier(schemaName)}.qr_codes (id, url, batch_id, created_at)
         VALUES ($1, $2, $3, now())`,
        [qrId, batch.qrCodes[0].url, batch.batch.id]
      )
    ).rejects.toThrow();

    const attempts = await Promise.all([
      store.claimQr(qrId, owner!.id, "pg-claim-owner").then((outcome) => ({
        userId: owner!.id,
        commandId: "pg-claim-owner",
        outcome
      })),
      store.claimQr(qrId, guest!.id, "pg-claim-guest").then((outcome) => ({
        userId: guest!.id,
        commandId: "pg-claim-guest",
        outcome
      }))
    ]);
    expect(attempts.map((item) => item.outcome.result).sort()).toEqual(["claimed", "owned_by_other"]);

    const winner = attempts.find((item) => item.outcome.result === "claimed");
    expect(winner).toBeDefined();
    const replay = await store.claimQr(qrId, winner!.userId, winner!.commandId);
    expect(replay.result).toBe("claimed");
    const losingUserId = attempts.find((item) => item.userId !== winner!.userId)!.userId;
    await expect(store.claimQr(qrId, losingUserId, winner!.commandId)).rejects.toBeInstanceOf(
      ClaimIdempotencyConflictError
    );
    const originalAfterOwnerConflict = await store.claimQr(qrId, winner!.userId, winner!.commandId);
    expect(originalAfterOwnerConflict).toMatchObject({ result: "claimed", replayed: true });
    const secondBatch = await store.createQrBatch(winner!.userId, 1, DEFAULT_QR_BASE_URL);
    await expect(store.claimQr(secondBatch.qrCodes[0].id, winner!.userId, winner!.commandId)).rejects.toBeInstanceOf(
      ClaimIdempotencyConflictError
    );
    expect(await store.getQrState(secondBatch.qrCodes[0].id, winner!.userId)).toMatchObject({ state: "unclaimed" });

    const retryBatch = await store.createQrBatch(winner!.userId, 1, DEFAULT_QR_BASE_URL);
    const retryQrId = retryBatch.qrCodes[0].id;
    const simultaneousRetries = await Promise.all([
      store.claimQr(retryQrId, winner!.userId, "pg-simultaneous-retry"),
      store.claimQr(retryQrId, winner!.userId, "pg-simultaneous-retry")
    ]);
    expect(simultaneousRetries.map((outcome) => outcome.result)).toEqual(["claimed", "claimed"]);
    expect(simultaneousRetries.filter((outcome) => outcome.replayed).length).toBe(1);
  });

  it("enforces the canonical recursive store contract on Postgres", async () => {
    const createdAt = "2026-08-25T14:00:00.000Z";
    const root = await store.createLifeLink({
      id: `pg-root-${randomUUID()}`,
      ownerId: "demo-owner",
      title: "Postgres root",
      createdAt
    });
    const child = await store.createLifeLink({
      id: `pg-child-${randomUUID()}`,
      ownerId: "demo-owner",
      parentId: root.id,
      title: "Duplicate",
      createdAt
    });
    const sibling = await store.createLifeLink({
      id: `pg-child-${randomUUID()}`,
      ownerId: "demo-owner",
      parentId: root.id,
      title: "Duplicate",
      createdAt
    });
    const grandchild = await store.createLifeLink({
      id: `pg-grandchild-${randomUUID()}`,
      ownerId: "demo-owner",
      parentId: child.id,
      title: "Nested child",
      createdAt
    });
    const firstPage = await store.listLifeLinks("demo-owner", root.id, { limit: 1 });
    const secondPage = await store.listLifeLinks("demo-owner", root.id, { limit: 1, cursor: firstPage.nextCursor });
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([firstPage.items[0].id, secondPage.items[0].id])).toEqual(new Set([child.id, sibling.id]));

    const currentChild = (await store.getLifeLinkDetail("demo-owner", child.id))!.lifeLink;
    const currentRoot = (await store.getLifeLinkDetail("demo-owner", root.id))!.lifeLink;
    const updated = await store.updateLifeLink("demo-owner", {
      lifeLinkId: child.id,
      expectedUpdatedAt: currentChild!.updatedAt,
      patch: { title: "Updated child" }
    });
    expect(updated?.updatedAt).not.toBe(child.updatedAt);
    await expect(
      store.updateLifeLink("demo-owner", {
        lifeLinkId: child.id,
        expectedUpdatedAt: child.updatedAt,
        patch: { title: "Stale child" }
      })
    ).rejects.toMatchObject({ code: "stale_life_link", retryable: true });
    await expect(
      store.updateLifeLink("demo-owner", {
        lifeLinkId: child.id,
        expectedUpdatedAt: updated!.updatedAt,
        patch: { bodyDocVersion: 1 }
      })
    ).rejects.toMatchObject({ code: "invalid_life_link", reason: "body_doc_version_without_content" });
    await expect(
      store.moveLifeLink("demo-owner", {
        lifeLinkId: root.id,
        parentId: child.id,
        expectedUpdatedAt: currentRoot!.updatedAt
      })
    ).rejects.toMatchObject({ code: "hierarchy_cycle" });
    await expect(
      store.moveLifeLink("demo-owner", {
        lifeLinkId: child.id,
        parentId: null,
        expectedUpdatedAt: child.updatedAt
      })
    ).rejects.toMatchObject({ code: "stale_life_link", retryable: true });
    const moved = await store.moveLifeLink("demo-owner", {
      lifeLinkId: child.id,
      parentId: null,
      expectedUpdatedAt: updated!.updatedAt
    });
    expect(moved?.parentId).toBeNull();
    expect((await store.getLifeLinkDetail("demo-owner", grandchild.id))?.lifeLink.parentId).toBe(child.id);

    const batch = await store.createQrBatch("demo-owner", 1, DEFAULT_QR_BASE_URL);
    const attached = await store.claimQr(batch.qrCodes[0].id, "demo-owner", {
      commandId: `pg-attach-${randomUUID()}`,
      mode: "attach",
      lifeLinkId: sibling.id
    });
    expect(attached).toMatchObject({ result: "claimed", state: { state: "claimed" } });
    expect((await store.getLifeLinkDetail("demo-owner", sibling.id))?.lifeLink.qrId).toBe(batch.qrCodes[0].id);
    await expect(
      store.claimQr(batch.qrCodes[0].id, "demo-owner", {
        commandId: `pg-attach-same-${randomUUID()}`,
        mode: "attach",
        lifeLinkId: sibling.id
      })
    ).resolves.toMatchObject({ result: "already_owned", replayed: false });
    await expect(
      store.claimQr(batch.qrCodes[0].id, "demo-owner", {
        commandId: `pg-attach-different-${randomUUID()}`,
        mode: "attach",
        lifeLinkId: child.id
      })
    ).rejects.toMatchObject({ code: "qr_already_bound" });
    await expect(
      store.createLifeLinkMedia("demo-owner", sibling.id, {
        kind: "image",
        mimeType: "image/png",
        fileName: "bad.png",
        sizeBytes: 99,
        data: Buffer.from("bad")
      })
    ).rejects.toMatchObject({ code: "invalid_life_link", reason: "media_size_mismatch" });
  });

  it("serves owner and public API flows on the Postgres store", async () => {
    const ready = await request(app).get("/readyz").set("X-Request-Id", "pg-ready-1");
    expect(ready.status).toBe(200);
    expect(ready.headers["x-request-id"]).toBe("pg-ready-1");
    expect(ready.body).toMatchObject({
      ok: true,
      status: "ready",
      system: "life_links",
      component: "life-links-api",
      store_mode: "postgres"
    });

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(login.status).toBe(200);
    expect(login.body.agentConnection).toEqual({ connected: false, connectedAt: null, toolCatalogId: null });
    const connected = await agent.put("/api/agent-connection");
    expect(connected.body.agentConnection).toMatchObject({ connected: true, connectedAt: expect.any(String) });
    const durableConnectedAt = connected.body.agentConnection.connectedAt;
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    const relogin = await agent.post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(relogin.body.agentConnection).toEqual({
      connected: true,
      connectedAt: durableConnectedAt,
      toolCatalogId: "life-links-page-webmcp-v1"
    });
    expect((await agent.delete("/api/agent-connection")).body.agentConnection).toEqual({
      connected: false,
      connectedAt: null,
      toolCatalogId: null
    });

    const links = await agent.get("/api/links");
    expect(links.status).toBe(200);
    expect(links.body.links.length).toBeGreaterThan(10);

    const privateQr = await request(app).get("/api/qr/LL-DEMO-00001");
    expect(privateQr.status).toBe(200);
    expect(privateQr.body.state).toBe("private");
    expect(privateQr.body).not.toHaveProperty("ownerId");

    const publicQr = await request(app).get("/api/qr/LL-DEMO-00002");
    expect(publicQr.status).toBe(200);
    expect(publicQr.body.state).toBe("claimed");
    expect(publicQr.body.link.url).toBe(`${DEFAULT_QR_BASE_URL}/qr/LL-DEMO-00002`);

    for (const input of [
      { kind: "image", filename: "postgres.png", contentType: "image/png", data: Buffer.from("pg-image") },
      { kind: "document", filename: "postgres-notes.txt", contentType: "text/plain", data: Buffer.from("Private document\r\nCafé – Québec\r\n", "utf8") }
    ]) {
      const upload = await agent
        .post("/api/links/LL-DEMO-00002/media")
        .attach("file", input.data, { filename: input.filename, contentType: input.contentType });
      expect(upload.status).toBe(201);
      expect(upload.body.media).toMatchObject({ kind: input.kind, mimeType: input.contentType, fileName: input.filename, sizeBytes: input.data.byteLength });

      const qrWithMedia = await request(app).get("/api/qr/LL-DEMO-00002");
      expect(qrWithMedia.status).toBe(200);
      expect(qrWithMedia.body.link.media).toEqual([]);
      expect(JSON.stringify(qrWithMedia.body)).not.toContain(DEMO_OWNER_ID);
      expect(JSON.stringify(qrWithMedia.body)).not.toContain(input.filename);

      const mediaFile = await request(app).get(upload.body.media.url);
      expect(mediaFile.status).toBe(404);
      const historyBeforeRead = await store.getChangeHistory(DEMO_OWNER_ID);
      const ownerMedia = await agent.get(upload.body.media.url);
      expect(ownerMedia.status).toBe(200);
      expect(ownerMedia.headers["content-type"]).toContain(input.contentType);
      if (input.kind === "document") {
        expect(ownerMedia.headers["content-disposition"]).toContain("attachment");
        expect(ownerMedia.text).toBe(input.data.toString("utf8"));
      } else expect(ownerMedia.body).toEqual(input.data);
      expect(await store.getChangeHistory(DEMO_OWNER_ID)).toEqual(historyBeforeRead);
    }
  });

  it("migrates the reviewed flat legacy fixture without identity, content, QR, media, or claim drift", async () => {
    const fixtureSchema = createSchemaName();
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(fixtureSchema)}`);
    const fixturePostgres = createPostgresStore(requireTestDatabaseUrl(), fixtureSchema);
    try {
      for (const file of ["001_initial.sql", "002_link_media.sql", "003_link_body_doc.sql"]) {
        await applyMigrationFile(fixturePostgres.pool, file);
      }
      const legacy = REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT;
      for (const ownerId of ["owner-alpha", "owner-beta"]) {
        await fixturePostgres.pool.query(
          "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ($1, $2, $3, 'fixture', now())",
          [ownerId, `${ownerId}@example.test`, ownerId]
        );
      }
      await fixturePostgres.pool.query(
        `INSERT INTO export_batches (id, batch_key, qr_base_url, count, created_by, created_at)
         VALUES ('batch-alpha', 'MIGA', 'https://challenge.example', 4, 'owner-alpha', now()),
                ('batch-beta', 'MIGB', 'https://challenge.example', 1, 'owner-beta', now())`
      );
      for (const project of legacy.projects) {
        await fixturePostgres.pool.query(
          "INSERT INTO projects (id, owner_id, name, created_at) VALUES ($1, $2, $3, $4)",
          [project.id, project.ownerId, project.name, project.createdAt]
        );
      }
      for (const qr of legacy.qrCodes) {
        await fixturePostgres.pool.query(
          `INSERT INTO qr_codes (id, url, status, batch_id, created_at, claimed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [qr.id, qr.url, qr.status, qr.batchId, qr.createdAt, qr.claimedAt]
        );
      }
      for (const link of legacy.links) {
        await fixturePostgres.pool.query(
          `INSERT INTO links
             (qr_id, owner_id, title, body, body_doc, body_doc_version, project_id, privacy, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
          [
            link.qrId,
            link.ownerId,
            link.title,
            link.body,
            JSON.stringify(link.bodyDoc),
            link.bodyDocVersion,
            link.projectId,
            link.privacy,
            link.createdAt,
            link.updatedAt
          ]
        );
      }
      for (const media of legacy.linkMedia) {
        await fixturePostgres.pool.query(
          `INSERT INTO link_media
             (id, qr_id, owner_id, kind, mime_type, file_name, size_bytes, data, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            media.id,
            media.qrId,
            media.ownerId,
            media.kind,
            media.mimeType,
            media.fileName,
            media.sizeBytes,
            Buffer.from(media.data),
            media.createdAt
          ]
        );
      }
      for (const event of legacy.claimEvents) {
        await fixturePostgres.pool.query(
          "INSERT INTO claim_events (command_id, qr_id, owner_id, result, created_at) VALUES ($1, $2, $3, $4, $5)",
          [event.commandId, event.qrId, event.ownerId, event.result, event.createdAt]
        );
      }

      await applyMigrationFile(fixturePostgres.pool, "004_recursive_life_links.sql");

      const lifeLinks = await fixturePostgres.pool.query("SELECT * FROM life_links ORDER BY id");
      expect(
        lifeLinks.rows.map((row) => ({
          id: String(row.id),
          ownerId: String(row.owner_id),
          parentId: row.parent_id ? String(row.parent_id) : null,
          title: String(row.title),
          body: String(row.body),
          bodyDoc: row.body_doc,
          bodyDocVersion: Number(row.body_doc_version),
          privacy: row.privacy,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.lifeLinks.map(
        ({ browsingRole: _role, context: _context, placementConfirmedAt: _placement, publicFieldKeys: _public, ...record }) => record
      ));

      const inventory = await fixturePostgres.pool.query("SELECT * FROM qr_codes ORDER BY id");
      expect(
        inventory.rows.map((row) => ({
          id: String(row.id),
          url: String(row.url),
          batchId: row.batch_id ? String(row.batch_id) : null,
          createdAt: row.created_at.toISOString()
        }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.qrInventory);

      const bindings = await fixturePostgres.pool.query("SELECT * FROM life_link_qr_bindings ORDER BY qr_id");
      expect(
        bindings.rows.map((row) => ({
          qrId: String(row.qr_id),
          lifeLinkId: String(row.life_link_id),
          boundAt: row.bound_at.toISOString()
        }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.qrBindings);


      const media = await fixturePostgres.pool.query("SELECT * FROM link_media ORDER BY id");
      expect(
        media.rows.map((row) => ({
          id: String(row.id),
          lifeLinkId: String(row.life_link_id),
          ownerId: String(row.owner_id),
          kind: row.kind,
          mimeType: String(row.mime_type),
          fileName: String(row.file_name),
          sizeBytes: Number(row.size_bytes),
          data: new Uint8Array(row.data),
          createdAt: row.created_at.toISOString()
        }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.linkMedia);

      const claims = await fixturePostgres.pool.query("SELECT * FROM claim_events ORDER BY command_id");
      expect(
        claims.rows.map((row) => ({
          commandId: String(row.command_id),
          qrId: String(row.qr_id),
          ownerId: String(row.owner_id),
          result: row.result,
          createdAt: row.created_at.toISOString(),
          mode: row.mode,
          requestedLifeLinkId: row.requested_life_link_id ? String(row.requested_life_link_id) : null,
          resolvedLifeLinkId: row.resolved_life_link_id ? String(row.resolved_life_link_id) : null
        }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.claimEvents);

      const legacyTables = await fixturePostgres.pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('links', 'projects')",
        [fixtureSchema]
      );
      const legacyQrColumns = await fixturePostgres.pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'qr_codes' AND column_name IN ('status', 'claimed_at')",
        [fixtureSchema]
      );
      expect(legacyTables.rows).toEqual([]);
      expect(legacyQrColumns.rows).toEqual([]);

      await applyMigrationFile(fixturePostgres.pool, "005_agent_connection.sql");
      await applyMigrationFile(fixturePostgres.pool, "006_field_ledger_collections.sql");
      await fixturePostgres.pool.query(
        "INSERT INTO collections (id, owner_id, title, created_at, updated_at) VALUES ('collection-upgrade', 'owner-alpha', 'Camera gear', now(), now())"
      );
      await fixturePostgres.pool.query(
        "INSERT INTO collection_memberships (owner_id, collection_id, life_link_id, created_at) VALUES ('owner-alpha', 'collection-upgrade', 'legacy-life-link:LL-MIG-00001', now())"
      );
      await fixturePostgres.pool.query(
        "INSERT INTO collection_sections (id, owner_id, collection_id, title, position, created_at, updated_at) VALUES ('section-upgrade', 'owner-alpha', 'collection-upgrade', 'Batteries', 0, now(), now())"
      );
      await fixturePostgres.pool.query(
        "INSERT INTO collection_section_assignments (owner_id, collection_id, life_link_id, section_id, created_at) VALUES ('owner-alpha', 'collection-upgrade', 'legacy-life-link:LL-MIG-00001', 'section-upgrade', now())"
      );
      const preservedTables = ["life_links", "qr_codes", "life_link_qr_bindings", "link_media", "claim_events",
        "collections", "collection_memberships", "collection_sections", "collection_section_assignments"];
      const beforeContraction = await Promise.all(preservedTables.map(async (table) =>
        (await fixturePostgres.pool.query(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows
      ));
      await runMigrations(fixturePostgres.pool, migrationDir, logger);
      for (const [index, table] of preservedTables.entries()) {
        expect((await fixturePostgres.pool.query(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows).toEqual(beforeContraction[index]);
      }
      expect((await fixturePostgres.pool.query("SELECT to_regclass('life_link_project_compat') AS marker")).rows[0].marker).toBeNull();
      const upgraded = await fixturePostgres.pool.query("SELECT * FROM life_links ORDER BY id");
      for (const row of upgraded.rows) {
        const hasChildren = upgraded.rows.some((child) => child.parent_id === row.id);
        expect(row.browsing_role).toBe(hasChildren ? "container" : "item");
        expect(row.context).toEqual({ schemaVersion: 1 });
        expect(row.placement_confirmed_at).toBeNull();
        expect(row.public_field_keys).toEqual(row.privacy === "public" ? ["notes"] : []);
        const original = EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.lifeLinks.find((item) => item.id === row.id)!;
        expect({ body: row.body, bodyDoc: row.body_doc, title: row.title, parentId: row.parent_id,
          createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() })
          .toEqual({ body: original.body, bodyDoc: original.bodyDoc, title: original.title, parentId: original.parentId,
            createdAt: original.createdAt, updatedAt: original.updatedAt });
      }
      const receiptCount = await fixturePostgres.pool.query("SELECT count(*)::int AS count FROM schema_migrations");
      expect(receiptCount.rows[0].count).toBe(12);
    } finally {
      await fixturePostgres.store.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(fixtureSchema)} CASCADE`);
    }
  });

  it("serializes concurrent first-run migrations and rolls back a failed migration body", async () => {
    const concurrentSchema = createSchemaName();
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(concurrentSchema)}`);
    const concurrent = createPostgresStore(requireTestDatabaseUrl(), concurrentSchema);
    try {
      await Promise.all([
        runMigrations(concurrent.pool, migrationDir, logger),
        runMigrations(concurrent.pool, migrationDir, logger)
      ]);
      const receipts = await concurrent.pool.query("SELECT id FROM schema_migrations ORDER BY id");
      expect(receipts.rows.map((row) => row.id)).toEqual([
        "001_initial.sql",
        "002_link_media.sql",
        "003_link_body_doc.sql",
        "004_recursive_life_links.sql",
        "005_agent_connection.sql",
        "006_field_ledger_collections.sql",
        "007_remove_project_compat.sql",
        "008_saved_change_history.sql",
        "009_document_attachments.sql",
        "010_general_routines.sql",
        "011_calendar.sql",
        "012_calendar_permissions.sql"
      ]);
    } finally {
      await concurrent.store.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(concurrentSchema)} CASCADE`);
    }

    const rollbackSchema = createSchemaName();
    const rollbackDir = await fs.mkdtemp(path.join(os.tmpdir(), "life-links-migration-"));
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(rollbackSchema)}`);
    const rollback = createPostgresStore(requireTestDatabaseUrl(), rollbackSchema);
    try {
      await fs.writeFile(
        path.join(rollbackDir, "001_forced_failure.sql"),
        "CREATE TABLE rollback_sentinel (id integer);\nSELECT * FROM deliberately_missing_relation;\n",
        "utf8"
      );
      await expect(runMigrations(rollback.pool, rollbackDir, logger)).rejects.toThrow();
      const sentinel = await rollback.pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'rollback_sentinel'",
        [rollbackSchema]
      );
      const receipt = await rollback.pool.query("SELECT 1 FROM schema_migrations WHERE id = '001_forced_failure.sql'");
      expect(sentinel.rowCount).toBe(0);
      expect(receipt.rowCount).toBe(0);
    } finally {
      await rollback.store.close();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(rollbackSchema)} CASCADE`);
      await fs.rm(rollbackDir, { recursive: true, force: true });
    }
  });
});

async function applyMigrationFile(pool: Pool, file: string): Promise<void> {
  const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
