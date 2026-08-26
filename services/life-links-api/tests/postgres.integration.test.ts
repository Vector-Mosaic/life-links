import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  COMPETITION_CAMERA_BATTERY_KIT_ID,
  COMPETITION_FIELD_CAMERA_BAG_ID,
  COMPETITION_OWNER_ID,
  COMPETITION_TARGET_QR_ID,
  DEFAULT_QR_BASE_URL,
  DEMO_OWNER_ID,
  DEMO_PASSWORD,
  EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT,
  REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT
} from "@life-links/core";

import { readConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { runMigrations } from "../src/migrations.js";
import { createPostgresStore, type PostgresLifeLinksStore } from "../src/postgres-store.js";
import { createLifeLinksApp } from "../src/server.js";
import { ClaimIdempotencyConflictError } from "../src/store.js";

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
    expect(migrations.rows[0].count).toBe(4);
  });

  it("dry-runs and atomically restores the isolated competition fixture without touching another owner", async () => {
    const options = {
      password: "competition-postgres-password",
      qrBaseUrl: "https://challenge.life-links.test"
    };
    const legacyOwnerBefore = await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home");
    const absentDryRun = await store.resetCompetitionFixture(options);
    expect(absentDryRun).toMatchObject({
      profile: "webmcp-camera-kit-v1",
      ownerId: COMPETITION_OWNER_ID,
      mode: "dry-run",
      applied: false,
      before: { users: 0, sessions: 0, lifeLinks: 0 },
      after: { users: 0, sessions: 0, lifeLinks: 0 },
      expected: { users: 1, sessions: 0, lifeLinks: 6, qrBindings: 2, batches: 1, qrCodes: 2 }
    });
    expect(await store.getUserById(COMPETITION_OWNER_ID)).toBeNull();

    const firstApply = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(firstApply.after).toEqual(firstApply.expected);
    const target = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_CAMERA_BATTERY_KIT_ID);
    expect(target?.ancestry.items.map((item) => item.title)).toEqual([
      "Field Camera Bag",
      "Main Compartment",
      "Power Pouch",
      "Camera Battery Kit"
    ]);
    expect(target?.lifeLink).toMatchObject({ qrId: COMPETITION_TARGET_QR_ID, privacy: "public" });

    expect(await store.getQrState(COMPETITION_TARGET_QR_ID, null)).toMatchObject({
      state: "claimed",
      viewerIsOwner: false,
      link: { ownerId: null, projectId: null }
    });
    expect(await store.getQrState(COMPETITION_TARGET_QR_ID, COMPETITION_OWNER_ID)).toMatchObject({
      state: "claimed",
      viewerIsOwner: true,
      link: { ownerId: COMPETITION_OWNER_ID, projectId: COMPETITION_FIELD_CAMERA_BAG_ID }
    });

    await store.createSession(
      COMPETITION_OWNER_ID,
      "competition-postgres-session-hash",
      "2099-01-01T00:00:00.000Z"
    );
    await store.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
      expectedUpdatedAt: target!.lifeLink.updatedAt,
      patch: { title: "Drifted Postgres battery kit" }
    });
    await store.createLifeLink({
      id: "competition-postgres-extra-life-link",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_FIELD_CAMERA_BAG_ID,
      title: "Judge-created Postgres extra",
      createdAt: "2026-08-26T13:00:00.000Z"
    });
    await store.createQrBatch(COMPETITION_OWNER_ID, 1, options.qrBaseUrl);

    const driftDryRun = await store.resetCompetitionFixture(options);
    expect(driftDryRun.applied).toBe(false);
    expect(driftDryRun.after).toEqual(driftDryRun.before);
    expect(
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_CAMERA_BATTERY_KIT_ID))?.lifeLink.title
    ).toBe("Drifted Postgres battery kit");
    expect(await store.getSessionByTokenHash("competition-postgres-session-hash")).not.toBeNull();

    const restored = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(restored.after).toEqual(restored.expected);
    expect(await store.getSessionByTokenHash("competition-postgres-session-hash")).toBeNull();
    expect(await store.getLifeLinkDetail(COMPETITION_OWNER_ID, "competition-postgres-extra-life-link")).toBeNull();
    expect(
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_CAMERA_BATTERY_KIT_ID))?.lifeLink.title
    ).toBe("Camera Battery Kit");
    expect(await store.getLifeLinkDetail(DEMO_OWNER_ID, "project-home")).toEqual(legacyOwnerBefore);

    const replay = await store.resetCompetitionFixture({ ...options, mode: "apply" });
    expect(replay.before).toEqual(replay.expected);
    expect(replay.after).toEqual(replay.expected);

    const foreignBatch = await store.createQrBatch(DEMO_OWNER_ID, 1, options.qrBaseUrl);
    const foreignQrId = foreignBatch.qrCodes[0].id;
    const foreignCommandId = "competition-postgres-foreign-qr-attach";
    const foreignTarget = await store.createLifeLink({
      id: "competition-postgres-foreign-qr-target",
      ownerId: COMPETITION_OWNER_ID,
      parentId: COMPETITION_FIELD_CAMERA_BAG_ID,
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
        projectId: null,
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
    const target = await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_CAMERA_BATTERY_KIT_ID);
    await store.updateLifeLink(COMPETITION_OWNER_ID, {
      lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
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
         IF NEW.id = '${COMPETITION_CAMERA_BATTERY_KIT_ID}' THEN
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
      (await store.getLifeLinkDetail(COMPETITION_OWNER_ID, COMPETITION_CAMERA_BATTERY_KIT_ID))?.lifeLink.title
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

    const updated = await store.updateLifeLink("demo-owner", {
      lifeLinkId: child.id,
      expectedUpdatedAt: child.updatedAt,
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
        expectedUpdatedAt: root.updatedAt
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

    const upload = await agent
      .post("/api/links/LL-DEMO-00002/media")
      .attach("file", Buffer.from("pg-image"), { filename: "postgres.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(upload.body.media.kind).toBe("image");

    const qrWithMedia = await request(app).get("/api/qr/LL-DEMO-00002");
    expect(qrWithMedia.status).toBe(200);
    expect(qrWithMedia.body.link.media).toHaveLength(1);
    expect(qrWithMedia.body.link.media[0]).toMatchObject({ ownerId: null });
    expect(JSON.stringify(qrWithMedia.body)).not.toContain(DEMO_OWNER_ID);

    const mediaFile = await request(app).get(upload.body.media.url);
    expect(mediaFile.status).toBe(200);
    expect(mediaFile.headers["content-type"]).toContain("image/png");
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
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.lifeLinks);

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

      const compatibility = await fixturePostgres.pool.query(
        "SELECT * FROM life_link_project_compat ORDER BY project_id"
      );
      expect(
        compatibility.rows.map((row) => ({ projectId: String(row.project_id), lifeLinkId: String(row.life_link_id) }))
      ).toEqual(EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT.projectCompatibility);

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

      await runMigrations(fixturePostgres.pool, migrationDir, logger);
      const receiptCount = await fixturePostgres.pool.query("SELECT count(*)::int AS count FROM schema_migrations");
      expect(receiptCount.rows[0].count).toBe(4);
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
        "004_recursive_life_links.sql"
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
