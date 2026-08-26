import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_QR_BASE_URL, DEMO_PASSWORD } from "@life-links/core";

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
    expect(migrations.rows[0].count).toBe(3);
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
        `INSERT INTO ${quoteIdentifier(schemaName)}.qr_codes (id, url, status, batch_id, created_at, claimed_at)
         VALUES ($1, $2, 'unclaimed', $3, now(), NULL)`,
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

    const mediaFile = await request(app).get(upload.body.media.url);
    expect(mediaFile.status).toBe(200);
    expect(mediaFile.headers["content-type"]).toContain("image/png");
  });
});
