import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_QR_BASE_URL,
  DEMO_PASSWORD,
  MAX_BODY_DOC_BYTES,
  MAX_LIFE_LINK_CHILD_PAGE_LIMIT,
  MAX_MEDIA_PER_LINK
} from "@life-links/core";

import { readConfig } from "../src/config.js";
import { createLogger, type LogEvent, type Logger } from "../src/logger.js";
import { createLifeLinksApp } from "../src/server.js";
import { InMemoryLifeLinksStore, type LifeLinksStore } from "../src/store.js";

async function createSeededAgent(options: { logger?: Logger; store?: LifeLinksStore; env?: NodeJS.ProcessEnv } = {}) {
  const store = options.store ?? new InMemoryLifeLinksStore();
  await store.seedDemo(DEMO_PASSWORD, DEFAULT_QR_BASE_URL);
  const app = createLifeLinksApp({
    store,
    config: readConfig({
      NODE_ENV: "test",
      LIFE_LINKS_STORE: "memory",
      SESSION_SECRET: "test-session-secret",
      QR_BASE_URL: DEFAULT_QR_BASE_URL,
      COOKIE_SECURE: "false",
      ...(options.env ?? {})
    }),
    logger: options.logger ?? createLogger("life_links_test", { env: "ci", sink: () => undefined })
  });
  return { store, app, agent: request.agent(app) };
}

function expectNoHierarchyDisclosure(value: unknown): void {
  const forbiddenKeys = new Set([
    "lifeLinkId",
    "parentId",
    "ancestry",
    "children",
    "path",
    "hierarchy",
    "rootId",
    "descendants"
  ]);
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      expect(forbiddenKeys.has(key), `public QR payload disclosed canonical hierarchy field ${key}`).toBe(false);
      visit(nested);
    }
  };
  visit(value);
}

describe("Life Links API", () => {
  let ctx: Awaited<ReturnType<typeof createSeededAgent>>;

  beforeEach(async () => {
    ctx = await createSeededAgent();
  });

  async function login(agent = ctx.agent, email = "owner@life-links.test") {
    const response = await agent.post("/api/auth/login").send({ email, password: DEMO_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
    return response;
  }

  it("emits canonical structured logs and redacts sensitive fields", () => {
    const events: LogEvent[] = [];
    const logger = createLogger("life_links_test", {
      env: "ci",
      now: () => new Date("2026-04-22T00:00:00.000Z"),
      sink: (event) => events.push(event)
    });

    logger.info("life_links.test.event", {
      msg: "Test log event",
      password: "secret-password",
      databaseUrl: "postgresql://user:pass@example.test/db",
      nested: {
        sessionToken: "secret-token"
      },
      command_id: "caller-controlled-command",
      idempotencyKey: "caller-controlled-idempotency-key",
      "Idempotency-Key": "caller-controlled-header-key",
      safe_value: "kept"
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ts: "2026-04-22T00:00:00.000Z",
      level: "info",
      system: "life_links",
      component: "life_links_test",
      env: "ci",
      event: "life_links.test.event",
      msg: "Test log event",
      password: "[redacted]",
      databaseUrl: "[redacted]",
      nested: { sessionToken: "[redacted]" },
      command_id: "[redacted]",
      idempotencyKey: "[redacted]",
      "Idempotency-Key": "[redacted]",
      safe_value: "kept"
    });
  });

  it("requires an explicit hosted seed password when production auto-seeding is enabled", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        LIFE_LINKS_STORE: "memory",
        SESSION_SECRET: "test-session-secret",
        AUTO_SEED: "true"
      })
    ).toThrow("DEMO_SEED_PASSWORD is required");
  });

  it("stamps health, readiness, version, and request correlation fields", async () => {
    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) }),
      env: {
        APP_VERSION: "observability-test",
        BUILD_SHA: "abc123",
        BUILD_TIME: "2026-04-22T00:00:00.000Z"
      }
    });

    const health = await request(logged.app).get("/healthz").set("X-Request-Id", "req-health-1");
    expect(health.status).toBe(200);
    expect(health.headers["x-request-id"]).toBe("req-health-1");
    expect(health.body).toMatchObject({
      ok: true,
      service: "life-links-api",
      status: "ok",
      system: "life_links",
      component: "life-links-api",
      env: "ci",
      version: "observability-test",
      build_sha: "abc123",
      build_time: "2026-04-22T00:00:00.000Z",
      store_mode: "memory"
    });

    const ready = await request(logged.app).get("/readyz");
    expect(ready.status).toBe(200);
    expect(ready.headers["x-request-id"]).toBeTruthy();
    expect(ready.body).toMatchObject({ ok: true, status: "ready", system: "life_links" });

    const version = await request(logged.app).get("/version");
    expect(version.status).toBe(200);
    expect(version.body).toMatchObject({
      system: "life_links",
      component: "life-links-api",
      version: "observability-test",
      build_sha: "abc123"
    });

    const requestLog = events.find((event) => event.event === "life_links.http.request_completed" && event.path === "/healthz");
    expect(requestLog).toMatchObject({
      request_id: "req-health-1",
      method: "GET",
      path: "/healthz",
      status: 200
    });
    expect(typeof requestLog?.duration_ms).toBe("number");
  });

  it("reports failed readiness without leaking connection strings", async () => {
    class NotReadyStore extends InMemoryLifeLinksStore {
      override async checkReady(): Promise<void> {
        throw new Error("connect failed postgresql://user:password@example.test/life_links");
      }
    }

    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      store: new NotReadyStore(),
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) })
    });

    const ready = await request(logged.app).get("/readyz");
    expect(ready.status).toBe(503);
    expect(JSON.stringify(ready.body)).not.toContain("postgresql://");
    expect(ready.body).toMatchObject({ ok: false, status: "not_ready" });

    const readinessLog = events.find((event) => event.event === "life_links.readiness.failed");
    expect(readinessLog).toBeDefined();
    expect(JSON.stringify(readinessLog)).not.toContain("postgresql://");
    expect(readinessLog).toMatchObject({
      level: "error",
      error_message: "connect failed [redacted-postgres-url]"
    });
  });

  it("persists login sessions and clears them on logout", async () => {
    await login();
    const me = await ctx.agent.get("/api/me");
    expect(me.body.user.email).toBe("owner@life-links.test");

    const logout = await ctx.agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);
    const after = await ctx.agent.get("/api/me");
    expect(after.body.user).toBeNull();
  });

  it("issues native bearer sessions only when requested and accepts bearer auth", async () => {
    const webLogin = await request(ctx.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(webLogin.status).toBe(200);
    expect(webLogin.body.sessionToken).toBeUndefined();
    expect(webLogin.headers["set-cookie"]).toBeTruthy();

    const nativeLogin = await request(ctx.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD,
      client: "native"
    });
    expect(nativeLogin.status).toBe(200);
    expect(/^[A-Za-z0-9_-]{32,256}$/.test(String(nativeLogin.body.sessionToken))).toBe(true);
    expect(nativeLogin.headers["set-cookie"]).toBeUndefined();

    const token = nativeLogin.body.sessionToken as string;
    const me = await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("owner@life-links.test");

    const project = await request(ctx.app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Native bearer project" });
    expect(project.status).toBe(201);
    expect(project.body.project.name).toBe("Native bearer project");

    const logout = await request(ctx.app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(204);
    const after = await request(ctx.app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(after.body.user).toBeNull();
  });

  it("never accepts or logs a native session token as a request correlation id", async () => {
    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) })
    });
    const nativeLogin = await request(logged.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD,
      client: "native"
    });
    const token = nativeLogin.body.sessionToken as string;
    const me = await request(logged.app)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Request-Id", token);
    expect(me.status).toBe(200);
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        String(me.headers["x-request-id"])
      )
    ).toBe(true);
    expect(me.headers["x-request-id"] === token).toBe(false);
    expect(JSON.stringify(events).includes(token)).toBe(false);
  });

  it("gates owner links and projects behind auth", async () => {
    expect((await request(ctx.app).get("/api/links")).status).toBe(401);
    expect((await request(ctx.app).get("/api/life-links")).status).toBe(401);
    expect((await request(ctx.app).get("/api/life-links/search").query({ q: "camera" })).status).toBe(401);
    expect((await request(ctx.app).post("/api/life-links").send({ title: "No session" })).status).toBe(401);
    await login();

    const links = await ctx.agent.get("/api/links");
    const projects = await ctx.agent.get("/api/projects");
    expect(links.status).toBe(200);
    expect(links.body.links.length).toBeGreaterThan(10);
    expect(projects.body.projects.map((project: { name: string }) => project.name)).toContain("Home archive");
  });

  it("creates, browses, searches, revises, and moves canonical Life Links with bounded hierarchy reads", async () => {
    await login();

    const root = await ctx.agent.post("/api/life-links").send({
      title: "Competition camera kit",
      body: "Physical capture equipment",
      privacy: "private"
    });
    expect(root.status).toBe(201);
    expect(root.body.lifeLink).toMatchObject({
      parentId: null,
      qrId: null,
      title: "Competition camera kit",
      body: "Physical capture equipment",
      bodyDocVersion: 1,
      privacy: "private",
      media: []
    });
    expect(root.body.lifeLink.id).toMatch(/^life-link-/);

    const batteries = await ctx.agent.post("/api/life-links").send({
      parentId: root.body.lifeLink.id,
      title: "Competition batteries",
      bodyDoc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Charge before filming" }] }]
      },
      bodyDocVersion: 1,
      privacy: "public"
    });
    const lenses = await ctx.agent.post("/api/life-links").send({
      parentId: root.body.lifeLink.id,
      title: "Competition lenses"
    });
    expect(batteries.status).toBe(201);
    expect(lenses.status).toBe(201);
    expect(batteries.body.lifeLink).toMatchObject({
      parentId: root.body.lifeLink.id,
      body: "Charge before filming",
      privacy: "public"
    });

    const firstPage = await ctx.agent
      .get("/api/life-links")
      .query({ parentId: root.body.lifeLink.id, limit: 1 });
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.lifeLinks).toHaveLength(1);
    expect(firstPage.body.truncated).toBe(true);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    const secondPage = await ctx.agent
      .get("/api/life-links")
      .query({ parentId: root.body.lifeLink.id, limit: 1, cursor: firstPage.body.nextCursor });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.lifeLinks).toHaveLength(1);
    expect(secondPage.body.lifeLinks[0].id).not.toBe(firstPage.body.lifeLinks[0].id);
    expect(secondPage.body.truncated).toBe(false);
    expect(secondPage.body.nextCursor).toBeNull();

    const detail = await ctx.agent.get(`/api/life-links/${batteries.body.lifeLink.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.detail.lifeLink.id).toBe(batteries.body.lifeLink.id);
    expect(detail.body.detail.ancestry.items.map((item: { id: string }) => item.id)).toEqual([
      root.body.lifeLink.id,
      batteries.body.lifeLink.id
    ]);
    expect(detail.body.detail.children).toEqual([]);

    const search = await ctx.agent.get("/api/life-links/search").query({ q: "Charge before filming", limit: 1 });
    expect(search.status).toBe(200);
    expect(search.body).toMatchObject({ totalCount: 1, truncated: false, hasMore: false, nextCursor: null });
    expect(search.body.results[0]).toMatchObject({
      lifeLink: { id: batteries.body.lifeLink.id },
      matchClass: "body",
      bodySummary: "Charge before filming"
    });
    expect(search.body.results[0].path.items.map((item: { id: string }) => item.id)).toEqual([
      root.body.lifeLink.id,
      batteries.body.lifeLink.id
    ]);

    const update = await ctx.agent.patch(`/api/life-links/${batteries.body.lifeLink.id}`).send({
      expectedUpdatedAt: batteries.body.lifeLink.updatedAt,
      title: "Competition charged batteries",
      body: "Ready for the demo",
      privacy: "private"
    });
    expect(update.status).toBe(200);
    expect(update.body.lifeLink).toMatchObject({
      title: "Competition charged batteries",
      body: "Ready for the demo",
      privacy: "private"
    });
    expect(update.body.lifeLink.updatedAt).not.toBe(batteries.body.lifeLink.updatedAt);

    const stale = await ctx.agent.patch(`/api/life-links/${batteries.body.lifeLink.id}`).send({
      expectedUpdatedAt: batteries.body.lifeLink.updatedAt,
      title: "Stale overwrite"
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({
      code: "stale_life_link",
      message: "Life Link changed after it was read.",
      retryable: true
    });

    const cycle = await ctx.agent.patch(`/api/life-links/${root.body.lifeLink.id}/parent`).send({
      parentId: batteries.body.lifeLink.id,
      expectedUpdatedAt: root.body.lifeLink.updatedAt
    });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error).toMatchObject({ code: "hierarchy_cycle", retryable: false, reason: "cycle" });

    const detached = await ctx.agent.patch(`/api/life-links/${batteries.body.lifeLink.id}/parent`).send({
      parentId: null,
      expectedUpdatedAt: update.body.lifeLink.updatedAt
    });
    expect(detached.status).toBe(200);
    expect(detached.body.lifeLink.parentId).toBeNull();
    const detachedDetail = await ctx.agent.get(`/api/life-links/${batteries.body.lifeLink.id}`);
    expect(detachedDetail.body.detail.ancestry.items.map((item: { id: string }) => item.id)).toEqual([
      batteries.body.lifeLink.id
    ]);
  });

  it("rejects invalid canonical bounds and missing owner-scoped resources with structured errors", async () => {
    await login();
    const excessiveLimit = await ctx.agent
      .get("/api/life-links")
      .query({ limit: MAX_LIFE_LINK_CHILD_PAGE_LIMIT + 1 });
    expect(excessiveLimit.status).toBe(400);
    expect(excessiveLimit.body.error).toMatchObject({
      code: "invalid_life_link",
      retryable: false,
      reason: "invalid_life_link_limit"
    });

    const badCursor = await ctx.agent.get("/api/life-links").query({ cursor: "not-an-opaque-cursor" });
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error).toMatchObject({
      code: "invalid_life_link",
      reason: "invalid_cursor"
    });

    const missingDetail = await ctx.agent.get("/api/life-links/life-link-missing");
    expect(missingDetail.status).toBe(404);
    expect(missingDetail.body.error).toMatchObject({ code: "life_link_not_found", retryable: false });

    const invalidRevision = await ctx.agent.patch("/api/life-links/life-link-missing").send({ title: "No revision" });
    expect(invalidRevision.status).toBe(400);
    expect(invalidRevision.body.error).toMatchObject({
      code: "invalid_life_link",
      reason: "invalid_expected_updated_at"
    });

    const unsupportedField = await ctx.agent.post("/api/life-links").send({
      title: "Unknown field",
      projectId: "project-studio"
    });
    expect(unsupportedField.status).toBe(400);
    expect(unsupportedField.body.error).toMatchObject({
      code: "invalid_life_link",
      reason: "unsupported_request_field"
    });

    const emptyParent = await ctx.agent.post("/api/life-links").send({ parentId: "", title: "Invalid parent" });
    expect(emptyParent.status).toBe(400);
    expect(emptyParent.body.error).toMatchObject({
      code: "invalid_life_link",
      reason: "invalid_parent_id"
    });
  });

  it("renders public QR states without auto-creating unknown inventory", async () => {
    const unclaimed = await request(ctx.app).get("/api/qr/LL-DEMO-0000A");
    expect(unclaimed.status).toBe(200);
    expect(unclaimed.body.state).toBe("unclaimed");
    expectNoHierarchyDisclosure(unclaimed.body);

    const privateClaimed = await request(ctx.app).get("/api/qr/LL-DEMO-00001");
    expect(privateClaimed.status).toBe(200);
    expect(privateClaimed.body.state).toBe("private");
    expect(privateClaimed.body).not.toHaveProperty("ownerId");
    expect(JSON.stringify(privateClaimed.body)).not.toContain("demo-owner");
    expectNoHierarchyDisclosure(privateClaimed.body);

    const publicClaimed = await request(ctx.app).get("/api/qr/LL-DEMO-00002");
    expect(publicClaimed.status).toBe(200);
    expect(publicClaimed.body.state).toBe("claimed");
    expect(publicClaimed.body.link.projectId).toBeNull();
    expectNoHierarchyDisclosure(publicClaimed.body);

    await login();
    const ownerPrivate = await ctx.agent.get("/api/qr/LL-DEMO-00001");
    expect(ownerPrivate.body.state).toBe("claimed");
    expect(ownerPrivate.body.link.title).toBe("Passport lockbox");

    const unknown = await request(ctx.app).get("/api/qr/LL-UNKNOWN-00001");
    expect(unknown.status).toBe(404);
    expect(unknown.body.state).toBe("not_found");
  });

  it("uploads, serves, hides, and deletes owner-managed media", async () => {
    await login();
    const upload = await ctx.agent
      .post("/api/links/LL-DEMO-00002/media")
      .attach("file", Buffer.from("image-bytes"), { filename: "camera.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(upload.body.media).toMatchObject({
      qrId: "LL-DEMO-00002",
      ownerId: "demo-owner",
      kind: "image",
      mimeType: "image/png",
      fileName: "camera.png",
      sizeBytes: "image-bytes".length
    });

    const publicQr = await request(ctx.app).get("/api/qr/LL-DEMO-00002");
    expect(publicQr.status).toBe(200);
    expect(publicQr.body.link.media).toHaveLength(1);

    const publicFile = await request(ctx.app).get(upload.body.media.url);
    expect(publicFile.status).toBe(200);
    expect(publicFile.headers["content-type"]).toContain("image/png");
    expect(publicFile.headers["content-disposition"]).toContain("camera.png");

    const makePrivate = await ctx.agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Camera battery kit",
      body: "Private media test",
      privacy: "private",
      projectId: "project-studio"
    });
    expect(makePrivate.status).toBe(200);

    const privateQr = await request(ctx.app).get("/api/qr/LL-DEMO-00002");
    expect(privateQr.status).toBe(200);
    expect(privateQr.body.state).toBe("private");
    expect(JSON.stringify(privateQr.body)).not.toContain(upload.body.media.id);

    const blockedFile = await request(ctx.app).get(upload.body.media.url);
    expect(blockedFile.status).toBe(404);

    const ownerFile = await ctx.agent.get(upload.body.media.url);
    expect(ownerFile.status).toBe(200);
    expect(ownerFile.headers["cache-control"]).toContain("no-store");

    const deleted = await ctx.agent.delete(`/api/links/LL-DEMO-00002/media/${upload.body.media.id}`);
    expect(deleted.status).toBe(204);
    expect((await ctx.agent.get(upload.body.media.url)).status).toBe(404);
  });

  it("rejects unsupported media MIME types", async () => {
    await login();
    const rejected = await ctx.agent
      .post("/api/links/LL-DEMO-00002/media")
      .attach("file", Buffer.from("plain text"), { filename: "notes.txt", contentType: "text/plain" });
    expect(rejected.status).toBe(415);
    expect(rejected.body.error).toBe("media_type_not_allowed");
  });

  it("enforces the per-link media attachment limit", async () => {
    await login();
    for (let index = 0; index < MAX_MEDIA_PER_LINK; index += 1) {
      const upload = await ctx.agent
        .post("/api/links/LL-DEMO-00002/media")
        .attach("file", Buffer.from(`image-${index}`), { filename: `media-${index}.png`, contentType: "image/png" });
      expect(upload.status).toBe(201);
    }
    const rejected = await ctx.agent
      .post("/api/links/LL-DEMO-00002/media")
      .attach("file", Buffer.from("too-many"), { filename: "too-many.png", contentType: "image/png" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("media_limit_reached");
  });

  it("uploads, privately reads, and deletes media for an untagged canonical Life Link", async () => {
    await login();
    const created = await ctx.agent.post("/api/life-links").send({ title: "Untagged media cabinet" });
    expect(created.status).toBe(201);
    const lifeLinkId = created.body.lifeLink.id as string;

    const upload = await ctx.agent
      .post(`/api/life-links/${lifeLinkId}/media`)
      .attach("file", Buffer.from("canonical-image-bytes"), {
        filename: "cabinet.png",
        contentType: "image/png"
      });
    expect(upload.status).toBe(201);
    expect(upload.body.media).toMatchObject({
      lifeLinkId,
      ownerId: "demo-owner",
      kind: "image",
      mimeType: "image/png",
      fileName: "cabinet.png"
    });
    expect(upload.body.media.url).toBe(
      `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(upload.body.media.id)}`
    );

    const ownerRead = await ctx.agent.get(upload.body.media.url);
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.headers["cache-control"]).toBe("private, no-store");
    expect(ownerRead.headers["content-type"]).toContain("image/png");
    expect(ownerRead.body.equals(Buffer.from("canonical-image-bytes"))).toBe(true);

    const publicRead = await request(ctx.app).get(upload.body.media.url);
    expect(publicRead.status).toBe(401);
    const guest = request.agent(ctx.app);
    await login(guest, "guest@life-links.test");
    const forbiddenRead = await guest.get(upload.body.media.url);
    expect(forbiddenRead.status).toBe(404);
    expect(forbiddenRead.body.error).toMatchObject({
      code: "life_link_not_found",
      reason: "media_not_found_or_forbidden"
    });

    const deleted = await ctx.agent.delete(upload.body.media.url);
    expect(deleted.status).toBe(204);
    const missing = await ctx.agent.get(upload.body.media.url);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({
      code: "life_link_not_found",
      reason: "media_not_found_or_forbidden"
    });
  });

  it("claims QR codes idempotently and prevents double ownership", async () => {
    await login();
    const first = await ctx.agent
      .post("/api/qr/LL-DEMO-0000A/claim")
      .send({ commandId: "claim-test-command" });
    const replay = await ctx.agent
      .post("/api/qr/LL-DEMO-0000A/claim")
      .send({ commandId: "claim-test-command" });
    expect(first.status).toBe(200);
    expect(first.body.result).toBe("claimed");
    expect(replay.body.result).toBe("claimed");

    const guest = request.agent(ctx.app);
    await login(guest, "guest@life-links.test");
    const conflictingReplay = await guest
      .post("/api/qr/LL-DEMO-0000A/claim")
      .send({ commandId: "claim-test-command" });
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.body.error).toBe("idempotency_key_conflict");
    const conflictingQrReplay = await ctx.agent
      .post("/api/qr/LL-DEMO-0000B/claim")
      .send({ commandId: "claim-test-command" });
    expect(conflictingQrReplay.status).toBe(409);
    expect(conflictingQrReplay.body.error).toBe("idempotency_key_conflict");
    const stillUnclaimed = await ctx.agent.get("/api/qr/LL-DEMO-0000B");
    expect(stillUnclaimed.body.state).toBe("unclaimed");
    const other = await guest.post("/api/qr/LL-DEMO-0000A/claim").send({ commandId: "claim-other-owner" });
    expect(other.status).toBe(409);
    expect(other.body.result).toBe("owned_by_other");

    const headerFirst = await ctx.agent
      .post("/api/qr/LL-DEMO-0000B/claim")
      .set("Idempotency-Key", "claim-header-fallback")
      .send({ commandId: "" });
    const headerReplay = await ctx.agent
      .post("/api/qr/LL-DEMO-0000B/claim")
      .set("Idempotency-Key", "claim-header-fallback")
      .send({ commandId: "" });
    expect(headerFirst.body.result).toBe("claimed");
    expect(headerReplay.body.result).toBe("claimed");

    const bodyFirst = await ctx.agent
      .post("/api/qr/LL-DEMO-0000C/claim")
      .set("Idempotency-Key", "claim-header-ignored-first")
      .send({ commandId: "claim-body-authority" });
    const bodyReplay = await ctx.agent
      .post("/api/qr/LL-DEMO-0000C/claim")
      .set("Idempotency-Key", "claim-header-ignored-second")
      .send({ commandId: "claim-body-authority" });
    expect(bodyFirst.body.result).toBe("claimed");
    expect(bodyReplay.body.result).toBe("claimed");
  });

  it("attaches QR inventory idempotently to eligible untagged Life Links without reassignment", async () => {
    await login();
    const firstTarget = await ctx.agent.post("/api/life-links").send({ title: "Attach target one" });
    const secondTarget = await ctx.agent.post("/api/life-links").send({ title: "Attach target two" });
    expect(firstTarget.status).toBe(201);
    expect(secondTarget.status).toBe(201);

    const attach = await ctx.agent.post("/api/qr/LL-DEMO-0000A/claim").send({
      commandId: "attach-existing-life-link",
      mode: "attach",
      lifeLinkId: firstTarget.body.lifeLink.id
    });
    const replay = await ctx.agent.post("/api/qr/LL-DEMO-0000A/claim").send({
      commandId: "attach-existing-life-link",
      mode: "attach",
      lifeLinkId: firstTarget.body.lifeLink.id
    });
    expect(attach.status).toBe(200);
    expect(attach.body.result).toBe("claimed");
    expect(replay.status).toBe(200);
    expect(replay.body.result).toBe("claimed");
    const attachedDetail = await ctx.agent.get(`/api/life-links/${firstTarget.body.lifeLink.id}`);
    expect(attachedDetail.body.detail.lifeLink.qrId).toBe("LL-DEMO-0000A");

    const commandConflict = await ctx.agent.post("/api/qr/LL-DEMO-0000A/claim").send({
      commandId: "attach-existing-life-link",
      mode: "attach",
      lifeLinkId: secondTarget.body.lifeLink.id
    });
    expect(commandConflict.status).toBe(409);
    expect(commandConflict.body.error).toBe("idempotency_key_conflict");

    const reassignment = await ctx.agent.post("/api/qr/LL-DEMO-0000A/claim").send({
      commandId: "attach-reassignment-rejected",
      mode: "attach",
      lifeLinkId: secondTarget.body.lifeLink.id
    });
    expect(reassignment.status).toBe(409);
    expect(reassignment.body.error).toMatchObject({ code: "qr_already_bound", retryable: false });

    const secondSticker = await ctx.agent.post("/api/qr/LL-DEMO-0000B/claim").send({
      commandId: "attach-second-sticker-rejected",
      mode: "attach",
      lifeLinkId: firstTarget.body.lifeLink.id
    });
    expect(secondSticker.status).toBe(409);
    expect(secondSticker.body.error).toMatchObject({ code: "life_link_already_tagged", retryable: false });

    const missingTarget = await ctx.agent.post("/api/qr/LL-DEMO-0000C/claim").send({
      commandId: "attach-missing-target",
      mode: "attach",
      lifeLinkId: "life-link-missing"
    });
    expect(missingTarget.status).toBe(404);
    expect(missingTarget.body.error).toMatchObject({ code: "life_link_not_found", retryable: false });
    expect((await ctx.agent.get("/api/qr/LL-DEMO-0000C")).body.state).toBe("unclaimed");
  });

  it("keeps legacy full-save placement a no-op when unchanged and rejects nested flattening", async () => {
    await login();
    const project = await ctx.agent.post("/api/projects").send({ name: "Compatibility root" });
    expect(project.status).toBe(201);
    const intermediate = await ctx.agent.post("/api/life-links").send({
      parentId: project.body.project.id,
      title: "Canonical intermediate"
    });
    expect(intermediate.status).toBe(201);
    const nested = await ctx.agent.post("/api/life-links").send({
      parentId: intermediate.body.lifeLink.id,
      title: "Nested legacy editor target",
      body: "Preserve this hierarchy",
      privacy: "private"
    });
    expect(nested.status).toBe(201);
    const attach = await ctx.agent.post("/api/qr/LL-DEMO-0000D/claim").send({
      commandId: "attach-nested-legacy-target",
      mode: "attach",
      lifeLinkId: nested.body.lifeLink.id
    });
    expect(attach.status).toBe(200);

    const projected = (await ctx.agent.get("/api/links")).body.links.find(
      (link: { id: string }) => link.id === "LL-DEMO-0000D"
    );
    expect(projected).toMatchObject({
      id: "LL-DEMO-0000D",
      projectId: project.body.project.id,
      title: "Nested legacy editor target"
    });

    const unchangedFullSave = await ctx.agent.patch("/api/links/LL-DEMO-0000D").send({
      title: projected.title,
      body: projected.body,
      bodyDoc: projected.bodyDoc,
      bodyDocVersion: projected.bodyDocVersion,
      privacy: projected.privacy,
      projectId: projected.projectId
    });
    expect(unchangedFullSave.status).toBe(200);
    const afterUnchangedSave = await ctx.agent.get(`/api/life-links/${nested.body.lifeLink.id}`);
    expect(afterUnchangedSave.body.detail.lifeLink.parentId).toBe(intermediate.body.lifeLink.id);

    const flatten = await ctx.agent.patch("/api/links/LL-DEMO-0000D").send({
      title: projected.title,
      body: projected.body,
      bodyDoc: projected.bodyDoc,
      bodyDocVersion: projected.bodyDocVersion,
      privacy: projected.privacy,
      projectId: null
    });
    expect(flatten.status).toBe(409);
    expect(flatten.body).toEqual({ error: "hierarchy_conflict" });
    const afterRejectedFlatten = await ctx.agent.get(`/api/life-links/${nested.body.lifeLink.id}`);
    expect(afterRejectedFlatten.body.detail.lifeLink.parentId).toBe(intermediate.body.lifeLink.id);
  });

  it("generates batches and exports CSV and ZIP receipts", async () => {
    await login();
    const batch = await ctx.agent.post("/api/qr-batches").send({ count: 3 });
    expect(batch.status).toBe(201);
    expect(batch.body.qrCodes).toHaveLength(3);
    const generatedIds = batch.body.qrCodes.map((link: { id: string }) => link.id);
    expect(generatedIds.every((id: string) => /^LL-[A-F0-9]{8}-[A-Z0-9]{16}$/.test(id))).toBe(true);
    expect(generatedIds).not.toContain("LL-BATCH-00001");

    const claim = await ctx.agent.post(`/api/qr/${generatedIds[0]}/claim`).send({ commandId: "claim-export-formula" });
    expect(claim.status).toBe(200);
    const edit = await ctx.agent.patch(`/api/links/${generatedIds[0]}`).send({
      title: "=HYPERLINK(\"https://example.test\")",
      body: "",
      privacy: "public",
      projectId: null
    });
    expect(edit.status).toBe(200);

    const csv = await ctx.agent.get(`/api/qr-batches/${batch.body.batch.id}.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\n")).toHaveLength(4);
    expect(csv.text).toContain("qr_id,url,status,owner_id,title,project_id,privacy");
    expect(csv.text).toContain('"\'=HYPERLINK(""https://example.test"")"');

    const zip = await ctx.agent.get(`/api/qr-batches/${batch.body.batch.id}.zip`);
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toContain("application/zip");
  });

  it("sets browser security headers", async () => {
    const secured = await createSeededAgent({
      env: {
        HSTS_ENABLED: "true"
      }
    });
    const response = await request(secured.app).get("/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toBe(
      "camera=(self), microphone=(), geolocation=(), tools=(self)"
    );
    expect(response.headers["origin-agent-cluster"]).toBe("?1");
    expect(response.headers["origin-agent-cluster"]).not.toBe("?0");
  });

  it("rejects cross-site mutating requests when origin checks are enabled", async () => {
    const events: LogEvent[] = [];
    const guarded = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) }),
      env: {
        ORIGIN_CHECK_ENABLED: "true",
        RATE_LIMIT_ENABLED: "false"
      }
    });

    const missing = await request(guarded.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(missing.status).toBe(403);
    expect(missing.body.error).toBe("origin_forbidden");

    const forbidden = await request(guarded.app).post("/api/auth/login").set("Origin", "https://evil.example").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("origin_forbidden");

    const allowed = await request(guarded.app).post("/api/auth/login").set("Origin", DEFAULT_QR_BASE_URL).send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD
    });
    expect(allowed.status).toBe(200);
    expect(events.find((event) => event.event === "life_links.security.origin_rejected")).toMatchObject({
      method: "POST",
      path: "/api/auth/login",
      origin: "missing"
    });
  });

  it("allows originless native bearer mutations while rejecting hostile browser origins", async () => {
    const events: LogEvent[] = [];
    const guarded = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) }),
      env: {
        ORIGIN_CHECK_ENABLED: "true",
        RATE_LIMIT_ENABLED: "false"
      }
    });

    const nativeLogin = await request(guarded.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: DEMO_PASSWORD,
      client: "native"
    });
    expect(nativeLogin.status).toBe(200);
    const token = nativeLogin.body.sessionToken as string;

    const allowed = await request(guarded.app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Native Originless" });
    expect(allowed.status).toBe(201);
    const canonicalAllowed = await request(guarded.app)
      .post("/api/life-links")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Native canonical originless" });
    expect(canonicalAllowed.status).toBe(201);

    const forbidden = await request(guarded.app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "https://evil.example")
      .send({ name: "Hostile Origin" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("origin_forbidden");
    const canonicalForbidden = await request(guarded.app)
      .post("/api/life-links")
      .set("Authorization", `Bearer ${token}`)
      .set("Origin", "https://evil.example")
      .send({ title: "Hostile canonical origin" });
    expect(canonicalForbidden.status).toBe(403);
    expect(canonicalForbidden.body.error).toBe("origin_forbidden");

    expect(JSON.stringify(events).includes(token)).toBe(false);
    expect(events.find((event) => event.event === "life_links.security.origin_rejected")).toMatchObject({
      method: "POST",
      path: "/api/projects",
      origin: "https://evil.example"
    });
  });

  it("throttles repeated login attempts", async () => {
    const events: LogEvent[] = [];
    const limited = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) }),
      env: {
        RATE_LIMIT_LOGIN_MAX: "1",
        ORIGIN_CHECK_ENABLED: "false"
      }
    });
    const first = await request(limited.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: "wrong"
    });
    const second = await request(limited.app).post("/api/auth/login").send({
      email: "owner@life-links.test",
      password: "wrong"
    });
    expect(first.status).toBe(401);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBeTruthy();
    expect(second.body.error).toBe("rate_limited");
    expect(events.find((event) => event.event === "life_links.security.rate_limited")).toMatchObject({
      method: "POST",
      path: "/api/auth/login",
      bucket: "auth_login"
    });
    expect(JSON.stringify(events)).not.toContain("wrong");
  });

  it("rejects oversized title, project, QR, and scan inputs before persistence", async () => {
    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) })
    });
    const agent = logged.agent;
    await login(agent);
    const longTitle = await agent.patch("/api/links/LL-DEMO-00002").send({
      title: "T".repeat(121),
      body: "",
      privacy: "public",
      projectId: null
    });
    expect(longTitle.status).toBe(400);
    expect(longTitle.body.error).toBe("title_too_long");

    const longProject = await agent.post("/api/projects").send({ name: "P".repeat(81) });
    expect(longProject.status).toBe(400);
    expect(longProject.body.error).toBe("project_name_too_long");

    const invalidQr = await agent.get("/api/qr/not-a-life-link-id");
    expect(invalidQr.status).toBe(400);
    expect(invalidQr.body.error).toBe("invalid_qr_id");

    const longScan = await agent.post("/api/find/scan").send({
      targetQrId: "LL-DEMO-00002",
      scanText: "S".repeat(2049)
    });
    expect(longScan.status).toBe(400);
    expect(longScan.body.error).toBe("scan_text_too_long");
    expect(events.filter((event) => event.event === "life_links.validation.rejected")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "title", reason: "title_too_long" }),
        expect.objectContaining({ field: "project_name", reason: "project_name_too_long" }),
        expect.objectContaining({ field: "qr_id", reason: "invalid_qr_id" }),
        expect.objectContaining({ field: "scan_text", reason: "scan_text_too_long" })
      ])
    );
  });

  it("updates owner link content and evaluates find-mode scans", async () => {
    await login();
    const update = await ctx.agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Updated camera kit",
      body: "Keep this with the case.",
      privacy: "public",
      projectId: "project-studio"
    });
    expect(update.status).toBe(200);
    expect(update.body.link.title).toBe("Updated camera kit");

    const match = await ctx.agent.post("/api/find/scan").send({
      targetQrId: "LL-DEMO-00002",
      scanText: `${DEFAULT_QR_BASE_URL}/qr/LL-DEMO-00002`
    });
    const miss = await ctx.agent.post("/api/find/scan").send({
      targetQrId: "LL-DEMO-00002",
      scanText: `${DEFAULT_QR_BASE_URL}/qr/LL-DEMO-00003`
    });
    expect(match.body.match).toBe(true);
    expect(miss.body.match).toBe(false);
  });

  it("accepts rich body documents while keeping plain body search compatibility", async () => {
    await login();
    const update = await ctx.agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Rich camera kit",
      bodyDoc: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Packing list" }] },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: true },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Charge batteries" }] }]
              }
            ]
          }
        ]
      },
      privacy: "public",
      projectId: "project-studio"
    });
    expect(update.status).toBe(200);
    expect(update.body.link.body).toContain("Packing list");
    expect(update.body.link.body).toContain("- [x] Charge batteries");
    expect(update.body.link.bodyDoc).toMatchObject({ type: "doc" });
    expect(update.body.link.bodyDocVersion).toBe(1);

    const links = await ctx.agent.get("/api/links");
    expect(links.body.links.some((link: { id: string; body: string }) => link.id === "LL-DEMO-00002" && link.body.includes("Charge batteries"))).toBe(
      true
    );
  });

  it("sanitizes rich body links and rejects invalid or oversized body documents", async () => {
    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) })
    });
    const agent = logged.agent;
    await login(agent);

    const update = await agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Link safety",
      bodyDoc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Client portal", marks: [{ type: "link", attrs: { href: "https://client.example.test" } }] },
              { type: "text", text: " bad link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }
            ]
          }
        ]
      },
      privacy: "public",
      projectId: null
    });
    expect(update.status).toBe(200);
    expect(JSON.stringify(update.body.link.bodyDoc)).toContain("https://client.example.test");
    expect(JSON.stringify(update.body.link.bodyDoc)).not.toContain("javascript:");

    const invalid = await agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Invalid body doc",
      bodyDoc: { type: "not-doc" },
      privacy: "public",
      projectId: null
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("body_doc_invalid");

    const oversized = await agent.patch("/api/links/LL-DEMO-00002").send({
      title: "Oversized body doc",
      bodyDoc: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { filler: "x".repeat(MAX_BODY_DOC_BYTES) }, content: [{ type: "text", text: "small" }] }]
      },
      privacy: "public",
      projectId: null
    });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error).toBe("body_doc_too_large");
    expect(events.filter((event) => event.event === "life_links.validation.rejected")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "body_doc", reason: "body_doc_invalid" }),
        expect.objectContaining({ field: "body_doc", reason: "body_doc_too_large" })
      ])
    );
  });

  it("logs safe product events for auth, QR, claim, project, export, edit, and find flows", async () => {
    const events: LogEvent[] = [];
    const logged = await createSeededAgent({
      logger: createLogger("life_links_test", { env: "ci", sink: (event) => events.push(event) })
    });
    const agent = logged.agent;

    const badLogin = await agent.post("/api/auth/login").send({ email: "owner@life-links.test", password: "wrong" });
    expect(badLogin.status).toBe(401);

    const privateQr = await request(logged.app).get("/api/qr/LL-DEMO-00001");
    expect(privateQr.body.state).toBe("private");

    await login(agent);
    const project = await agent.post("/api/projects").send({ name: "Obs Project" });
    expect(project.status).toBe(201);

    const firstClaim = await agent.post("/api/qr/LL-DEMO-0000A/claim").send({ commandId: "obs-claim-command" });
    const replayClaim = await agent.post("/api/qr/LL-DEMO-0000A/claim").send({ commandId: "obs-claim-command" });
    expect(firstClaim.body.result).toBe("claimed");
    expect(replayClaim.body.result).toBe("claimed");
    expect(replayClaim.body.replayed).toBeUndefined();
    const guest = request.agent(logged.app);
    await login(guest, "guest@life-links.test");
    const conflictingClaim = await guest
      .post("/api/qr/LL-DEMO-0000A/claim")
      .send({ commandId: "obs-claim-command" });
    expect(conflictingClaim.status).toBe(409);
    expect(conflictingClaim.body.error).toBe("idempotency_key_conflict");

    const edit = await agent.patch("/api/links/LL-DEMO-0000A").send({
      title: "Do not log this title",
      body: "Do not log this private-ish body",
      privacy: "private",
      projectId: project.body.project.id
    });
    expect(edit.status).toBe(200);

    const mediaUpload = await agent
      .post("/api/links/LL-DEMO-0000A/media")
      .attach("file", Buffer.from("obs-image"), { filename: "do-not-log-file-name.png", contentType: "image/png" });
    expect(mediaUpload.status).toBe(201);

    const batch = await agent.post("/api/qr-batches").send({ count: 2 });
    expect(batch.status).toBe(201);
    const csv = await agent.get(`/api/qr-batches/${batch.body.batch.id}.csv`);
    expect(csv.status).toBe(200);

    const find = await agent.post("/api/find/scan").send({
      targetQrId: "LL-DEMO-0000A",
      scanText: `${DEFAULT_QR_BASE_URL}/qr/LL-DEMO-0000A`
    });
    expect(find.body.match).toBe(true);

    expect(events.find((event) => event.event === "life_links.auth.login_failed")).toMatchObject({
      reason: "invalid_credentials"
    });
    expect(events.find((event) => event.event === "life_links.qr.resolved" && event.qr_id === "LL-DEMO-00001")).toMatchObject({
      state: "private",
      private_blocked: true
    });
    expect(events.find((event) => event.event === "life_links.project.created")).toMatchObject({
      project_id: project.body.project.id,
      name_length: "Obs Project".length
    });
    expect(events.find((event) => event.event === "life_links.qr.claimed" && event.replayed === false)).toMatchObject({
      qr_id: "LL-DEMO-0000A",
      result: "claimed"
    });
    expect(events.find((event) => event.event === "life_links.qr.claimed" && event.replayed === true)).toMatchObject({
      qr_id: "LL-DEMO-0000A",
      result: "claimed"
    });
    expect(events.find((event) => event.event === "life_links.qr.claim_idempotency_conflict")).toMatchObject({
      qr_id: "LL-DEMO-0000A"
    });
    expect(events.find((event) => event.event === "life_links.link.updated")).toMatchObject({
      qr_id: "LL-DEMO-0000A",
      privacy: "private",
      project_assigned: true,
      title_length: "Do not log this title".length,
      body_length: "Do not log this private-ish body".length
    });
    expect(events.find((event) => event.event === "life_links.media.uploaded")).toMatchObject({
      qr_id: "LL-DEMO-0000A",
      media_id: mediaUpload.body.media.id,
      kind: "image",
      mime_type: "image/png",
      size_bytes: "obs-image".length,
      file_name_length: "do-not-log-file-name.png".length
    });
    expect(events.find((event) => event.event === "life_links.export.created" && event.format === "csv")).toMatchObject({
      batch_id: batch.body.batch.id,
      row_count: 2
    });
    expect(events.find((event) => event.event === "life_links.find_scan.evaluated")).toMatchObject({
      target_qr_id: "LL-DEMO-0000A",
      scanned_qr_id: "LL-DEMO-0000A",
      match: true
    });

    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain("wrong");
    expect(serializedEvents).not.toContain("Do not log this title");
    expect(serializedEvents).not.toContain("Do not log this private-ish body");
    expect(serializedEvents).not.toContain("do-not-log-file-name.png");
    expect(serializedEvents).not.toContain("obs-claim-command");
  });
});
