import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import cookie from "cookie";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import JSZip from "jszip";
import multer from "multer";
import QRCode from "qrcode";
import {
  type ClaimQrCommand,
  type LifeLinkDomainErrorCode,
  type LifeLinkPageRequest,
  LifeLinkDomainError,
  type LinkBodyDoc,
  type LinkMediaKind,
  type LinkRecord,
  type PrivacyStatus,
  LINK_BODY_DOC_VERSION,
  MAX_BATCH_COUNT,
  MAX_BODY_LENGTH,
  MAX_BODY_DOC_BYTES,
  MAX_LIFE_LINK_CHILD_PAGE_LIMIT,
  MAX_LIFE_LINK_SEARCH_LIMIT,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_PER_LINK,
  MAX_PROJECT_NAME_LENGTH,
  MAX_QR_ID_LENGTH,
  MAX_SCAN_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  createLinkBodyDocFromPlainText,
  extractPlainTextFromLinkBodyDoc,
  isValidQrId,
  linksToCsv,
  normalizeLinkBodyDoc,
  normalizeBatchCount,
  parseQrId
} from "@life-links/core";

import type { LifeLinksConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { createSessionToken, hasSessionTokenShape, hashSessionToken, verifyPassword } from "./password.js";
import { ClaimIdempotencyConflictError, type LifeLinksStore, type StoredUser } from "./store.js";

const SESSION_COOKIE = "life_links_session";
const MEDIA_UPLOAD_FIELD = "file";
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_BYTES,
    files: 1
  }
});
const MEDIA_MIME_TYPES = new Map<string, LinkMediaKind>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/gif", "image"],
  ["video/mp4", "video"],
  ["video/webm", "video"],
  ["video/quicktime", "video"]
]);
const MAX_LIFE_LINK_ID_LENGTH = 200;
const MAX_LIFE_LINK_CURSOR_LENGTH = 4096;
const MAX_EXPECTED_UPDATED_AT_LENGTH = 64;

type AppRequest = Request & {
  user?: StoredUser;
  sessionTokenHash?: string;
  authTransport?: "bearer" | "cookie";
  requestId?: string;
};

type MediaUploadRequest = AppRequest & {
  file?: Express.Multer.File;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type LifeLinksAppDeps = {
  store: LifeLinksStore;
  config: LifeLinksConfig;
  logger: Logger;
};

export function createLifeLinksApp({ store, config, logger }: LifeLinksAppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.use(securityHeaders(config));
  app.use((request, response, next) => {
    const appRequest = request as AppRequest;
    appRequest.requestId = resolveRequestId(request);
    response.setHeader("X-Request-Id", appRequest.requestId);
    const start = process.hrtime.bigint();
    response.on("finish", () => {
      logger.info("life_links.http.request_completed", {
        msg: "HTTP request completed",
        ...requestLogFields(appRequest),
        method: request.method,
        path: request.path,
        status: response.statusCode,
        duration_ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
        ...routeLogFields(request.path)
      });
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(async (request, _response, next) => {
    const appRequest = request as AppRequest;
    try {
      const bearerToken = bearerTokenFromRequest(request);
      if (bearerToken) {
        const tokenHash = hashSessionToken(bearerToken, config.sessionSecret);
        const session = await store.getSessionByTokenHash(tokenHash);
        if (session) {
          appRequest.user = session.user;
          appRequest.sessionTokenHash = tokenHash;
          appRequest.authTransport = "bearer";
        }
        next();
        return;
      }

      const cookieToken = cookie.parse(request.headers.cookie ?? "")[SESSION_COOKIE];
      if (!cookieToken) {
        next();
        return;
      }
      const tokenHash = hashSessionToken(cookieToken, config.sessionSecret);
      const session = await store.getSessionByTokenHash(tokenHash);
      if (session) {
        appRequest.user = session.user;
        appRequest.sessionTokenHash = tokenHash;
        appRequest.authTransport = "cookie";
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(originGuard(config, logger));
  app.use(rateLimitGuard(config, logger));

  const requireAuthenticated = requireUser(logger);

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, service: config.component, status: "ok", ...runtimeFields(config) });
  });

  app.get("/readyz", async (request: AppRequest, response) => {
    try {
      await store.checkReady();
      response.json({ ok: true, service: config.component, status: "ready", ...runtimeFields(config) });
    } catch (error) {
      logger.error("life_links.readiness.failed", {
        msg: "Readiness check failed",
        ...requestLogFields(request),
        error_message: errorMessage(error)
      });
      response.status(503).json({ ok: false, service: config.component, status: "not_ready", ...runtimeFields(config) });
    }
  });

  app.get("/version", (_request, response) => {
    response.json(runtimeFields(config));
  });

  app.get("/api/config", (_request, response) => {
    response.json({ qrBaseUrl: config.qrBaseUrl, maxBatchCount: MAX_BATCH_COUNT });
  });

  app.post("/api/auth/login", async (request, response) => {
    const { email, password, client } = request.body as { email?: string; password?: string; client?: string };
    const wantsNativeSession = client === "native";
    if (!email || !password) {
      logger.warn("life_links.auth.login_failed", {
        msg: "Login rejected because email or password was missing",
        ...requestLogFields(request as AppRequest),
        reason: "email_and_password_required",
        has_email: Boolean(email)
      });
      response.status(400).json({ error: "email_and_password_required" });
      return;
    }
    if (email.trim().length > 254) {
      rejectValidation(request as AppRequest, response, logger, "email", "email_too_long");
      return;
    }
    if (password.length > 1024) {
      rejectValidation(request as AppRequest, response, logger, "password", "password_too_long");
      return;
    }
    const user = await store.getUserByEmail(email.trim());
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      logger.warn("life_links.auth.login_failed", {
        msg: "Login rejected because credentials were invalid",
        ...requestLogFields(request as AppRequest),
        reason: "invalid_credentials",
        has_email: true
      });
      response.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token, config.sessionSecret);
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
    await store.createSession(user.id, tokenHash, expiresAt);
    if (!wantsNativeSession) {
      setSessionCookie(response, token, config);
    }
    logger.info("life_links.auth.login", {
      msg: "User logged in",
      ...requestLogFields(request as AppRequest),
      user_id: user.id,
      auth_transport: wantsNativeSession ? "bearer" : "cookie"
    });
    response.json({
      user: publicUser(user),
      agentConnection: agentConnectionForUser(user),
      qrBaseUrl: config.qrBaseUrl,
      ...(wantsNativeSession ? { sessionToken: token } : {})
    });
  });

  app.post("/api/auth/logout", async (request: AppRequest, response) => {
    const hadSession = Boolean(request.sessionTokenHash);
    if (request.sessionTokenHash) {
      await store.deleteSessionByTokenHash(request.sessionTokenHash);
    }
    clearSessionCookie(response, config);
    logger.info("life_links.auth.logout", {
      msg: "User logged out",
      ...requestLogFields(request),
      had_session: hadSession,
      auth_transport: request.authTransport
    });
    response.status(204).send();
  });

  app.get("/api/me", (request: AppRequest, response) => {
    response.json({
      user: request.user ? publicUser(request.user) : null,
      agentConnection: agentConnectionForUser(request.user),
      qrBaseUrl: config.qrBaseUrl
    });
  });

  app.put("/api/agent-connection", requireAuthenticated, async (request: AppRequest, response) => {
    const user = await store.connectAgent(request.user!.id);
    if (!user) {
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    logger.info("life_links.agent_connection.connected", {
      msg: "Owner connected agent",
      ...requestLogFields(request),
      user_id: user.id
    });
    response.json({ agentConnection: agentConnectionForUser(user) });
  });

  app.delete("/api/agent-connection", requireAuthenticated, async (request: AppRequest, response) => {
    const user = await store.disconnectAgent(request.user!.id);
    if (!user) {
      response.status(401).json({ error: "authentication_required" });
      return;
    }
    logger.info("life_links.agent_connection.disconnected", {
      msg: "Owner disconnected agent",
      ...requestLogFields(request),
      user_id: user.id
    });
    response.json({ agentConnection: agentConnectionForUser(user) });
  });

  app.get("/api/life-links", requireAuthenticated, async (request: AppRequest, response) => {
    const parentId = readOptionalLifeLinkIdQuery(request, response, logger, "parentId");
    if (response.headersSent) {
      return;
    }
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (response.headersSent || !page) {
      return;
    }
    if (parentId) {
      const parent = await store.getLifeLinkDetail(request.user!.id, parentId, { limit: 1 });
      if (!parent) {
        sendCanonicalLifeLinkNotFound(response);
        return;
      }
    }
    const result = await store.listLifeLinks(request.user!.id, parentId, page);
    logger.info("life_links.life_link.listed", {
      msg: "Owner Life Links listed",
      ...requestLogFields(request),
      parent_life_link_id: parentId,
      result_count: result.items.length,
      truncated: result.truncated
    });
    response.json({ lifeLinks: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/life-links", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input) {
      return;
    }
    if (
      !validateObjectFields(request, response, logger, input, [
        "parentId",
        "title",
        "body",
        "bodyDoc",
        "bodyDocVersion",
        "privacy"
      ])
    ) {
      return;
    }
    const parentId = readOptionalLifeLinkIdBody(request, response, logger, input, "parentId");
    if (response.headersSent) {
      return;
    }
    const title = validateCanonicalStringField(request, response, logger, input.title, "title", MAX_TITLE_LENGTH);
    if (response.headersSent) {
      return;
    }
    const bodyDoc = validateCanonicalBodyDocField(request, response, logger, input.bodyDoc);
    if (response.headersSent) {
      return;
    }
    const body = validateCanonicalStringField(
      request,
      response,
      logger,
      bodyDoc === undefined ? input.body : bodyDoc ? extractPlainTextFromLinkBodyDoc(bodyDoc) : input.body,
      "body",
      MAX_BODY_LENGTH
    );
    if (response.headersSent) {
      return;
    }
    const bodyDocVersion = validateBodyDocVersionField(request, response, logger, input.bodyDocVersion, {
      contentPresent: input.body !== undefined || input.bodyDoc !== undefined
    });
    if (response.headersSent) {
      return;
    }
    const privacy = validatePrivacyField(request, response, logger, input.privacy);
    if (response.headersSent) {
      return;
    }
    const lifeLink = await store.createLifeLink({
      id: `life-link-${randomUUID()}`,
      ownerId: request.user!.id,
      parentId,
      title,
      body,
      bodyDoc,
      bodyDocVersion,
      privacy,
      createdAt: new Date().toISOString()
    });
    logger.info("life_links.life_link.created", {
      msg: "Owner Life Link created",
      ...requestLogFields(request),
      life_link_id: lifeLink.id,
      parent_life_link_id: lifeLink.parentId,
      privacy: lifeLink.privacy,
      title_length: lifeLink.title.length,
      body_length: lifeLink.body.length
    });
    response.status(201).json({ lifeLink });
  });

  app.get("/api/life-links/search", requireAuthenticated, async (request: AppRequest, response) => {
    const query = validateStringField(request, response, logger, request.query.q, "q", MAX_SCAN_TEXT_LENGTH, {
      required: true,
      trim: true
    });
    if (response.headersSent || query === undefined) {
      return;
    }
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_SEARCH_LIMIT);
    if (response.headersSent || !page) {
      return;
    }
    const result = await store.searchLifeLinks(request.user!.id, query, page);
    logger.info("life_links.life_link.searched", {
      msg: "Owner Life Links searched",
      ...requestLogFields(request),
      result_count: result.items.length,
      total_count: result.totalCount,
      truncated: result.truncated,
      has_more: result.hasMore
    });
    response.json({
      results: result.items,
      totalCount: result.totalCount,
      truncated: result.truncated,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor
    });
  });

  app.post(
    "/api/life-links/:lifeLinkId/media",
    requireAuthenticated,
    async (request: MediaUploadRequest, response) => {
      const lifeLinkId = paramValue(request.params.lifeLinkId);
      if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) {
        return;
      }
      const detail = await store.getLifeLinkDetail(request.user!.id, lifeLinkId, { limit: 1 });
      if (!detail) {
        sendCanonicalLifeLinkNotFound(response);
        return;
      }
      if (detail.lifeLink.media.length >= MAX_MEDIA_PER_LINK) {
        sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "media_limit_reached" });
        return;
      }
      try {
        await readMediaUpload(request, response);
      } catch (uploadError) {
        handleMediaUploadError(request, response, logger, uploadError);
        return;
      }
      const file = request.file;
      if (!file) {
        sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "media_file_required" });
        return;
      }
      const kind = MEDIA_MIME_TYPES.get(file.mimetype);
      if (!kind) {
        response.status(415).json({ error: "media_type_not_allowed" });
        return;
      }
      const media = await store.createLifeLinkMedia(request.user!.id, lifeLinkId, {
        kind,
        mimeType: file.mimetype,
        fileName: sanitizeFileName(file.originalname),
        sizeBytes: file.size,
        data: file.buffer
      });
      if (!media) {
        sendCanonicalLifeLinkNotFound(response);
        return;
      }
      logger.info("life_links.life_link_media.uploaded", {
        msg: "Life Link media uploaded",
        ...requestLogFields(request),
        life_link_id: lifeLinkId,
        media_id: media.id,
        kind: media.kind,
        mime_type: media.mimeType,
        size_bytes: media.sizeBytes,
        file_name_length: media.fileName.length
      });
      response.status(201).json({ media });
    }
  );

  app.get(
    "/api/life-links/:lifeLinkId/media/:mediaId",
    requireAuthenticated,
    async (request: AppRequest, response) => {
      const lifeLinkId = paramValue(request.params.lifeLinkId);
      const mediaId = paramValue(request.params.mediaId);
      if (
        !validateLifeLinkIdParam(request, response, logger, lifeLinkId) ||
        !validateMediaIdParam(request, response, logger, mediaId)
      ) {
        return;
      }
      const mediaFile = await store.getLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
      if (!mediaFile) {
        sendCanonicalLifeLinkError(response, 404, "life_link_not_found", {
          reason: "media_not_found_or_forbidden"
        });
        return;
      }
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Disposition", inlineContentDisposition(mediaFile.media.fileName));
      response.setHeader("Content-Length", String(mediaFile.data.length));
      response.type(mediaFile.media.mimeType).send(mediaFile.data);
    }
  );

  app.delete(
    "/api/life-links/:lifeLinkId/media/:mediaId",
    requireAuthenticated,
    async (request: AppRequest, response) => {
      const lifeLinkId = paramValue(request.params.lifeLinkId);
      const mediaId = paramValue(request.params.mediaId);
      if (
        !validateLifeLinkIdParam(request, response, logger, lifeLinkId) ||
        !validateMediaIdParam(request, response, logger, mediaId)
      ) {
        return;
      }
      const deleted = await store.deleteLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
      if (!deleted) {
        sendCanonicalLifeLinkError(response, 404, "life_link_not_found", {
          reason: "media_not_found_or_forbidden"
        });
        return;
      }
      logger.info("life_links.life_link_media.deleted", {
        msg: "Life Link media deleted",
        ...requestLogFields(request),
        life_link_id: lifeLinkId,
        media_id: mediaId
      });
      response.status(204).send();
    }
  );

  app.patch("/api/life-links/:lifeLinkId/parent", requireAuthenticated, async (request: AppRequest, response) => {
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) {
      return;
    }
    const input = readObjectBody(request, response, logger);
    if (!input) {
      return;
    }
    if (!validateObjectFields(request, response, logger, input, ["parentId", "expectedUpdatedAt"])) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(input, "parentId")) {
      rejectValidation(request, response, logger, "parent_id", "parent_id_required");
      return;
    }
    const parentId = readRequiredNullableLifeLinkIdBody(request, response, logger, input.parentId, "parent_id");
    if (response.headersSent) {
      return;
    }
    const expectedUpdatedAt = validateExpectedUpdatedAt(request, response, logger, input.expectedUpdatedAt);
    if (response.headersSent || expectedUpdatedAt === undefined) {
      return;
    }
    const lifeLink = await store.moveLifeLink(request.user!.id, { lifeLinkId, parentId, expectedUpdatedAt });
    if (!lifeLink) {
      sendCanonicalLifeLinkNotFound(response);
      return;
    }
    logger.info("life_links.life_link.moved", {
      msg: "Owner Life Link moved",
      ...requestLogFields(request),
      life_link_id: lifeLink.id,
      parent_life_link_id: lifeLink.parentId
    });
    response.json({ lifeLink });
  });

  app.get("/api/life-links/:lifeLinkId", requireAuthenticated, async (request: AppRequest, response) => {
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) {
      return;
    }
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) {
      return;
    }
    const detail = await store.getLifeLinkDetail(request.user!.id, lifeLinkId, page);
    if (!detail) {
      sendCanonicalLifeLinkNotFound(response);
      return;
    }
    logger.info("life_links.life_link.resolved", {
      msg: "Owner Life Link detail resolved",
      ...requestLogFields(request),
      life_link_id: lifeLinkId,
      child_count: detail.children.length,
      ancestry_truncated: detail.ancestry.truncated,
      children_truncated: detail.childrenPage.truncated
    });
    response.json({ detail });
  });

  app.patch("/api/life-links/:lifeLinkId", requireAuthenticated, async (request: AppRequest, response) => {
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) {
      return;
    }
    const input = readObjectBody(request, response, logger);
    if (!input) {
      return;
    }
    if (
      !validateObjectFields(request, response, logger, input, [
        "expectedUpdatedAt",
        "title",
        "body",
        "bodyDoc",
        "bodyDocVersion",
        "privacy"
      ])
    ) {
      return;
    }
    const expectedUpdatedAt = validateExpectedUpdatedAt(request, response, logger, input.expectedUpdatedAt);
    if (expectedUpdatedAt === undefined) {
      return;
    }
    const mutableFields = ["title", "body", "bodyDoc", "privacy"] as const;
    if (!mutableFields.some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
      rejectValidation(request, response, logger, "patch", "life_link_patch_required");
      return;
    }
    const title = validateCanonicalStringField(request, response, logger, input.title, "title", MAX_TITLE_LENGTH);
    if (response.headersSent) {
      return;
    }
    const bodyDoc = validateCanonicalBodyDocField(request, response, logger, input.bodyDoc);
    if (response.headersSent) {
      return;
    }
    const body = validateCanonicalStringField(
      request,
      response,
      logger,
      bodyDoc === undefined ? input.body : bodyDoc ? extractPlainTextFromLinkBodyDoc(bodyDoc) : input.body,
      "body",
      MAX_BODY_LENGTH
    );
    if (response.headersSent) {
      return;
    }
    const bodyDocVersion = validateBodyDocVersionField(request, response, logger, input.bodyDocVersion, {
      contentPresent: input.body !== undefined || input.bodyDoc !== undefined
    });
    if (response.headersSent) {
      return;
    }
    const privacy = validatePrivacyField(request, response, logger, input.privacy);
    if (response.headersSent) {
      return;
    }
    const lifeLink = await store.updateLifeLink(request.user!.id, {
      lifeLinkId,
      expectedUpdatedAt,
      patch: {
        title,
        body,
        bodyDoc,
        bodyDocVersion,
        privacy
      }
    });
    if (!lifeLink) {
      sendCanonicalLifeLinkNotFound(response);
      return;
    }
    logger.info("life_links.life_link.updated", {
      msg: "Owner Life Link content updated",
      ...requestLogFields(request),
      life_link_id: lifeLink.id,
      privacy: lifeLink.privacy,
      title_length: lifeLink.title.length,
      body_length: lifeLink.body.length,
      body_doc_present: true
    });
    response.json({ lifeLink });
  });

  app.get("/api/links", requireAuthenticated, async (request: AppRequest, response) => {
    response.json({ links: await store.listLinks(request.user!.id) });
  });

  app.patch("/api/links/:qrId", requireAuthenticated, async (request: AppRequest, response) => {
    const patch = request.body as Partial<Pick<LinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId">>;
    const qrId = paramValue(request.params.qrId);
    if (!validateQrIdParam(request, response, logger, qrId)) {
      return;
    }
    if (patch.privacy && !["public", "private"].includes(patch.privacy)) {
      logger.warn("life_links.link.update_rejected", {
        msg: "Link update rejected because privacy was invalid",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "invalid_privacy"
      });
      response.status(400).json({ error: "invalid_privacy" });
      return;
    }
    const title = validateStringField(request, response, logger, patch.title, "title", MAX_TITLE_LENGTH);
    if (response.headersSent) {
      return;
    }
    const bodyDoc = validateBodyDocField(request, response, logger, patch.bodyDoc);
    if (response.headersSent) {
      return;
    }
    const body = validateStringField(
      request,
      response,
      logger,
      patch.bodyDoc === undefined ? patch.body : bodyDoc ? extractPlainTextFromLinkBodyDoc(bodyDoc) : "",
      "body",
      MAX_BODY_LENGTH
    );
    if (response.headersSent) {
      return;
    }
    const projectId =
      patch.projectId === undefined || patch.projectId === null || patch.projectId === ""
        ? patch.projectId
        : validateStringField(request, response, logger, patch.projectId, "project_id", 160);
    if (response.headersSent) {
      return;
    }
    const link = await store.updateLink(request.user!.id, qrId, {
      title,
      body,
      bodyDoc: patch.bodyDoc === undefined ? (body === undefined ? undefined : createLinkBodyDocFromPlainText(body)) : bodyDoc,
      bodyDocVersion: patch.bodyDoc === undefined && body === undefined ? undefined : LINK_BODY_DOC_VERSION,
      privacy: patch.privacy as PrivacyStatus | undefined,
      projectId: projectId === undefined ? undefined : projectId || null
    });
    if (!link) {
      logger.warn("life_links.link.update_rejected", {
        msg: "Link update rejected because link was missing or forbidden",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "link_not_found_or_forbidden"
      });
      response.status(404).json({ error: "link_not_found_or_forbidden" });
      return;
    }
    logger.info("life_links.link.updated", {
      msg: "Owner link content updated",
      ...requestLogFields(request),
      qr_id: qrId,
      privacy: link.privacy,
      project_assigned: Boolean(link.projectId),
      title_length: link.title.length,
      body_length: link.body.length,
      body_doc_present: Boolean(link.bodyDoc)
    });
    response.json({ link });
  });

  app.post("/api/links/:qrId/media", requireAuthenticated, async (request: MediaUploadRequest, response) => {
    const qrId = paramValue(request.params.qrId);
    if (!validateQrIdParam(request, response, logger, qrId)) {
      return;
    }

    const state = await store.getQrState(qrId, request.user!.id);
    if (state.state !== "claimed" || !state.viewerIsOwner) {
      logger.warn("life_links.media.upload_rejected", {
        msg: "Media upload rejected because link was missing or forbidden",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "link_not_found_or_forbidden"
      });
      response.status(404).json({ error: "link_not_found_or_forbidden" });
      return;
    }
    if (state.link.media.length >= MAX_MEDIA_PER_LINK) {
      logger.warn("life_links.media.upload_rejected", {
        msg: "Media upload rejected because the link media limit was reached",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "media_limit_reached"
      });
      response.status(400).json({ error: "media_limit_reached" });
      return;
    }

    try {
      await readMediaUpload(request, response);
    } catch (uploadError) {
      handleMediaUploadError(request, response, logger, uploadError);
      return;
    }

    const file = request.file;
    if (!file) {
      logger.warn("life_links.media.upload_rejected", {
        msg: "Media upload rejected because no file was provided",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "media_file_required"
      });
      response.status(400).json({ error: "media_file_required" });
      return;
    }
    const kind = MEDIA_MIME_TYPES.get(file.mimetype);
    if (!kind) {
      logger.warn("life_links.media.upload_rejected", {
        msg: "Media upload rejected because the MIME type is not allowed",
        ...requestLogFields(request),
        qr_id: qrId,
        mime_type: file.mimetype,
        size_bytes: file.size,
        reason: "media_type_not_allowed"
      });
      response.status(415).json({ error: "media_type_not_allowed" });
      return;
    }
    const media = await store.createLinkMedia(request.user!.id, qrId, {
      kind,
      mimeType: file.mimetype,
      fileName: sanitizeFileName(file.originalname),
      sizeBytes: file.size,
      data: file.buffer
    });
    if (!media) {
      logger.warn("life_links.media.upload_rejected", {
        msg: "Media upload rejected because link was missing or forbidden after validation",
        ...requestLogFields(request),
        qr_id: qrId,
        reason: "link_not_found_or_forbidden"
      });
      response.status(404).json({ error: "link_not_found_or_forbidden" });
      return;
    }
    logger.info("life_links.media.uploaded", {
      msg: "Link media uploaded",
      ...requestLogFields(request),
      qr_id: qrId,
      media_id: media.id,
      kind: media.kind,
      mime_type: media.mimeType,
      size_bytes: media.sizeBytes,
      file_name_length: media.fileName.length
    });
    response.status(201).json({ media });
  });

  app.delete("/api/links/:qrId/media/:mediaId", requireAuthenticated, async (request: AppRequest, response) => {
    const qrId = paramValue(request.params.qrId);
    const mediaId = paramValue(request.params.mediaId);
    if (!validateQrIdParam(request, response, logger, qrId) || !validateMediaIdParam(request, response, logger, mediaId)) {
      return;
    }
    const deleted = await store.deleteLinkMedia(request.user!.id, qrId, mediaId);
    if (!deleted) {
      logger.warn("life_links.media.delete_rejected", {
        msg: "Media delete rejected because media was missing or forbidden",
        ...requestLogFields(request),
        qr_id: qrId,
        media_id: mediaId,
        reason: "media_not_found_or_forbidden"
      });
      response.status(404).json({ error: "media_not_found_or_forbidden" });
      return;
    }
    logger.info("life_links.media.deleted", {
      msg: "Link media deleted",
      ...requestLogFields(request),
      qr_id: qrId,
      media_id: mediaId
    });
    response.status(204).send();
  });

  app.get("/api/links/:qrId/media/:mediaId", async (request: AppRequest, response) => {
    const qrId = paramValue(request.params.qrId);
    const mediaId = paramValue(request.params.mediaId);
    if (!validateQrIdParam(request, response, logger, qrId) || !validateMediaIdParam(request, response, logger, mediaId)) {
      return;
    }
    const mediaFile = await store.getLinkMedia(qrId, mediaId, request.user?.id ?? null);
    if (!mediaFile || mediaFile === "private") {
      response.status(404).json({ error: "media_not_found" });
      return;
    }
    response.setHeader("Cache-Control", mediaFile.viewerIsOwner ? "private, no-store" : "public, max-age=300");
    response.setHeader("Content-Disposition", inlineContentDisposition(mediaFile.media.fileName));
    response.setHeader("Content-Length", String(mediaFile.data.length));
    response.type(mediaFile.media.mimeType).send(mediaFile.data);
  });

  app.get("/api/projects", requireAuthenticated, async (request: AppRequest, response) => {
    response.json({ projects: await store.listProjects(request.user!.id) });
  });

  app.post("/api/projects", requireAuthenticated, async (request: AppRequest, response) => {
    const name = validateStringField(
      request,
      response,
      logger,
      (request.body as { name?: unknown }).name,
      "project_name",
      MAX_PROJECT_NAME_LENGTH,
      { required: true, trim: true }
    );
    if (response.headersSent) {
      return;
    }
    if (!name) {
      logger.warn("life_links.project.create_rejected", {
        msg: "Project creation rejected because the name was empty",
        ...requestLogFields(request),
        reason: "project_name_required"
      });
      response.status(400).json({ error: "project_name_required" });
      return;
    }
    const project = await store.createProject(request.user!.id, name);
    logger.info("life_links.project.created", {
      msg: "Project created",
      ...requestLogFields(request),
      project_id: project.id,
      name_length: project.name.length
    });
    response.status(201).json({ project });
  });

  app.post("/api/qr-batches", requireAuthenticated, async (request: AppRequest, response) => {
    const count = normalizeBatchCount((request.body as { count?: number }).count ?? 1);
    const result = await store.createQrBatch(request.user!.id, count, config.qrBaseUrl);
    logger.info("life_links.qr_batch.created", {
      msg: "QR batch created",
      ...requestLogFields(request),
      batch_id: result.batch.id,
      count: result.batch.count
    });
    response.status(201).json(result);
  });

  app.get("/api/qr-batches/:batchId.csv", requireAuthenticated, async (request: AppRequest, response) => {
    const batchId = paramValue(request.params.batchId);
    const links = await store.listBatchLinks(request.user!.id, batchId);
    if (!links.length) {
      logger.warn("life_links.export.rejected", {
        msg: "Batch export rejected because batch was missing or forbidden",
        ...requestLogFields(request),
        batch_id: batchId,
        format: "csv",
        reason: "batch_not_found"
      });
      response.status(404).json({ error: "batch_not_found" });
      return;
    }
    logger.info("life_links.export.created", {
      msg: "Batch export created",
      ...requestLogFields(request),
      batch_id: batchId,
      format: "csv",
      row_count: links.length
    });
    response
      .type("text/csv")
      .attachment(`life-links-${batchId}.csv`)
      .send(linksToCsv(links));
  });

  app.get("/api/qr-batches/:batchId.zip", requireAuthenticated, async (request: AppRequest, response) => {
    const batchId = paramValue(request.params.batchId);
    const links = await store.listBatchLinks(request.user!.id, batchId);
    if (!links.length) {
      logger.warn("life_links.export.rejected", {
        msg: "Batch export rejected because batch was missing or forbidden",
        ...requestLogFields(request),
        batch_id: batchId,
        format: "zip",
        reason: "batch_not_found"
      });
      response.status(404).json({ error: "batch_not_found" });
      return;
    }
    const zip = new JSZip();
    zip.file("mapping.csv", linksToCsv(links));
    for (const link of links) {
      const svg = await QRCode.toString(link.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8
      });
      zip.file(`svg/${link.id}.svg`, svg);
    }
    const body = await zip.generateAsync({ type: "nodebuffer" });
    logger.info("life_links.export.created", {
      msg: "Batch export created",
      ...requestLogFields(request),
      batch_id: batchId,
      format: "zip",
      row_count: links.length
    });
    response
      .type("application/zip")
      .attachment(`life-links-${batchId}.zip`)
      .send(body);
  });

  app.get("/api/qr/:qrId", async (request: AppRequest, response) => {
    const qrId = paramValue(request.params.qrId);
    if (!validateQrIdParam(request, response, logger, qrId)) {
      return;
    }
    const state = await store.getQrState(qrId, request.user?.id ?? null);
    logger.info("life_links.qr.resolved", {
      msg: "QR state resolved",
      ...requestLogFields(request),
      qr_id: qrId,
      state: state.state,
      viewer_is_owner: state.state === "claimed" ? state.viewerIsOwner : false,
      private_blocked: state.state === "private"
    });
    if (state.state === "not_found") {
      response.status(404).json(state);
      return;
    }
    response.json(state);
  });

  app.post("/api/qr/:qrId/claim", requireAuthenticated, async (request: AppRequest, response) => {
    const qrId = paramValue(request.params.qrId);
    if (!validateQrIdParam(request, response, logger, qrId)) {
      return;
    }
    const claimBody = request.body as { commandId?: unknown; mode?: unknown; lifeLinkId?: unknown };
    const bodyCommandId = String(claimBody.commandId ?? "").trim();
    const headerCommandId = String(request.headers["idempotency-key"] ?? "").trim();
    const commandId = bodyCommandId || headerCommandId || cryptoRandomCommandId();
    if (commandId.length > 128) {
      rejectValidation(request, response, logger, "command_id", "command_id_too_long");
      return;
    }
    const mode = claimBody.mode === undefined ? "create" : claimBody.mode;
    if (mode !== "create" && mode !== "attach") {
      rejectValidation(request, response, logger, "claim_mode", "invalid_claim_mode");
      return;
    }
    let command: string | ClaimQrCommand = commandId;
    let attachedLifeLinkId: string | undefined;
    if (mode === "attach") {
      if (typeof claimBody.lifeLinkId !== "string" || !isValidLifeLinkId(claimBody.lifeLinkId)) {
        rejectValidation(request, response, logger, "life_link_id", "invalid_life_link_id");
        return;
      }
      attachedLifeLinkId = claimBody.lifeLinkId;
      command = { commandId, mode: "attach", lifeLinkId: attachedLifeLinkId };
    } else if (claimBody.lifeLinkId !== undefined) {
      rejectValidation(request, response, logger, "life_link_id", "life_link_id_requires_attach_mode");
      return;
    }
    const outcome = await store.claimQr(qrId, request.user!.id, command).catch((error: unknown) => {
      if (!(error instanceof ClaimIdempotencyConflictError)) {
        throw error;
      }
      logger.warn("life_links.qr.claim_idempotency_conflict", {
        msg: "QR claim command rejected because its idempotency key is bound to another request",
        ...requestLogFields(request),
        qr_id: qrId
      });
      response.status(409).json({ error: "idempotency_key_conflict" });
      return null;
    });
    if (!outcome) {
      return;
    }
    logger.info("life_links.qr.claimed", {
      msg: "QR claim command evaluated",
      ...requestLogFields(request),
      qr_id: qrId,
      claim_mode: mode,
      life_link_id: attachedLifeLinkId,
      result: outcome.result,
      replayed: Boolean(outcome.replayed)
    });
    const { replayed: _replayed, ...responseBody } = outcome;
    if (outcome.result === "not_found") {
      response.status(404).json(responseBody);
      return;
    }
    if (outcome.result === "owned_by_other") {
      response.status(409).json(responseBody);
      return;
    }
    response.json(responseBody);
  });

  app.post("/api/find/scan", requireAuthenticated, (request: AppRequest, response) => {
    const { targetQrId, scanText } = request.body as { targetQrId?: string; scanText?: string };
    if (!targetQrId || !scanText) {
      logger.warn("life_links.find_scan.rejected", {
        msg: "Find scan rejected because target or scan text was missing",
        ...requestLogFields(request),
        reason: "target_and_scan_required",
        has_target: Boolean(targetQrId),
        has_scan_text: Boolean(scanText)
      });
      response.status(400).json({ error: "target_and_scan_required" });
      return;
    }
    if (!validateQrIdParam(request, response, logger, targetQrId)) {
      return;
    }
    const safeScanText = validateStringField(request, response, logger, scanText, "scan_text", MAX_SCAN_TEXT_LENGTH);
    if (response.headersSent || safeScanText === undefined) {
      return;
    }
    const scannedQrId = parseQrId(safeScanText);
    const result = {
      targetQrId,
      scannedQrId,
      match: scannedQrId === targetQrId
    };
    logger.info("life_links.find_scan.evaluated", {
      msg: "Find scan evaluated",
      ...requestLogFields(request),
      target_qr_id: targetQrId,
      scanned_qr_id: scannedQrId,
      match: result.match
    });
    response.json({
      targetQrId: result.targetQrId,
      scannedQrId: result.scannedQrId,
      match: result.match
    });
  });

  app.use(express.static(config.staticDistPath, { fallthrough: true, index: false }));
  app.get(/^\/(?!api\/).*/, (request, response, next) => {
    sendClientApp(request, response, next, config.staticDistPath);
  });

  app.use((request, response) => {
    response.status(404).json({ error: "not_found", path: request.path });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (handleLifeLinkDomainError(error, request as AppRequest, response, logger)) {
      return;
    }
    logger.error("life_links.http.error", {
      msg: "Unhandled HTTP request error",
      ...requestLogFields(request as AppRequest),
      method: request.method,
      path: request.path,
      status: 500,
      error_name: error instanceof Error ? error.name : "Error",
      error_message: errorMessage(error)
    });
    response.status(500).json({ error: "internal_error" });
  });

  return app;
}

export function startLifeLinksServer(deps: LifeLinksAppDeps): http.Server {
  const app = createLifeLinksApp(deps);
  return app.listen(deps.config.port, deps.config.host);
}

function securityHeaders(config: LifeLinksConfig) {
  return (_request: Request, response: Response, next: NextFunction) => {
    if (!config.securityHeadersEnabled) {
      next();
      return;
    }
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=(), tools=(self)"
    );
    response.setHeader("Origin-Agent-Cluster", "?1");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "media-src 'self' blob:",
        "manifest-src 'self'"
      ].join("; ")
    );
    if (config.hstsEnabled) {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

function originGuard(config: LifeLinksConfig, logger: Logger) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!config.originCheckEnabled || !isMutatingMethod(request.method)) {
      next();
      return;
    }
    const origin = request.get("origin");
    const refererOrigin = originFromUrl(request.get("referer"));
    const appRequest = request as AppRequest;
    if (originAllowed(origin, config.allowedOrigins) || (!origin && originAllowed(refererOrigin, config.allowedOrigins))) {
      next();
      return;
    }
    if (!origin && !refererOrigin && nativeMutationWithoutBrowserOriginAllowed(appRequest)) {
      next();
      return;
    }
    if (!origin && !refererOrigin && config.originCheckAllowMissing) {
      next();
      return;
    }
    logger.warn("life_links.security.origin_rejected", {
      msg: "Mutating request rejected because the origin was not allowed",
      ...requestLogFields(appRequest),
      method: request.method,
      path: request.path,
      origin: safeOriginForLog(origin ?? refererOrigin),
      origin_present: Boolean(origin),
      referer_present: Boolean(request.get("referer"))
    });
    response.status(403).json({ error: "origin_forbidden" });
  };
}

function nativeMutationWithoutBrowserOriginAllowed(request: AppRequest): boolean {
  if (request.authTransport === "bearer" && request.user) {
    return true;
  }
  if (request.method === "POST" && request.path === "/api/auth/login") {
    return (request.body as { client?: string } | undefined)?.client === "native";
  }
  return false;
}

function rateLimitGuard(config: LifeLinksConfig, logger: Logger) {
  const buckets = new Map<string, RateLimitBucket>();
  let requestsSinceCleanup = 0;

  return (request: Request, response: Response, next: NextFunction) => {
    if (!config.rateLimitEnabled) {
      next();
      return;
    }
    const rule = rateLimitRuleForRequest(request, config);
    if (!rule) {
      next();
      return;
    }
    const now = Date.now();
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup > 1000) {
      requestsSinceCleanup = 0;
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) {
          buckets.delete(key);
        }
      }
    }

    const key = `${rule.bucket}:${rateLimitIdentity(request as AppRequest, rule.bucket)}`;
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + config.rateLimitWindowMs };
    if (bucket.count >= rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      response.setHeader("Retry-After", String(retryAfterSeconds));
      logger.warn("life_links.security.rate_limited", {
        msg: "Request rejected by rate limit",
        ...requestLogFields(request as AppRequest),
        method: request.method,
        path: request.path,
        bucket: rule.bucket,
        key_hash: hashForLog(key),
        retry_after_seconds: retryAfterSeconds
      });
      response.status(429).json({ error: "rate_limited", retryAfterSeconds });
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    next();
  };
}

function rateLimitRuleForRequest(request: Request, config: LifeLinksConfig): { bucket: string; max: number } | null {
  if (request.method === "POST" && request.path === "/api/auth/login") {
    return { bucket: "auth_login", max: config.rateLimitLoginMax };
  }
  if (request.method === "GET" && request.path.startsWith("/api/qr/")) {
    return { bucket: "public_qr", max: config.rateLimitPublicMax };
  }
  if (request.method === "POST" && /^\/api\/qr\/[^/]+\/claim$/.test(request.path)) {
    return { bucket: "qr_claim", max: config.rateLimitClaimMax };
  }
  if (
    request.path === "/api/qr-batches" ||
    /^\/api\/qr-batches\/[^/]+\.(csv|zip)$/.test(request.path)
  ) {
    return { bucket: "qr_batch", max: config.rateLimitBatchMax };
  }
  if (request.path.startsWith("/api/") && isMutatingMethod(request.method)) {
    return { bucket: "api_mutation", max: config.rateLimitMutationMax };
  }
  return null;
}

function rateLimitIdentity(request: AppRequest, bucket: string): string {
  const client = clientAddress(request);
  if (bucket === "auth_login") {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "missing";
    return `${client}:${email}`;
  }
  return request.user?.id ? `user:${request.user.id}` : `client:${client}`;
}

function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  return Boolean(origin && allowedOrigins.includes(origin));
}

function originFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function safeOriginForLog(origin: string | undefined): string {
  if (!origin) {
    return "missing";
  }
  return originAllowed(origin, [origin]) ? origin : "invalid";
}

function clientAddress(request: Request): string {
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.ip || request.socket.remoteAddress || "unknown";
}

function bearerTokenFromRequest(request: Request): string | null {
  const header = request.get("authorization")?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,256})$/);
  return match ? match[1] : null;
}

function hashForLog(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readObjectBody(
  request: AppRequest,
  response: Response,
  logger: Logger
): Record<string, unknown> | undefined {
  if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
    return request.body as Record<string, unknown>;
  }
  rejectValidation(request, response, logger, "body", "request_body_invalid");
  return undefined;
}

function validateObjectFields(
  request: AppRequest,
  response: Response,
  logger: Logger,
  input: Record<string, unknown>,
  allowedFields: readonly string[]
): boolean {
  const allowed = new Set(allowedFields);
  if (Object.keys(input).every((field) => allowed.has(field))) {
    return true;
  }
  rejectValidation(request, response, logger, "body", "unsupported_request_field");
  return false;
}

function isValidLifeLinkId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_LIFE_LINK_ID_LENGTH && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validateLifeLinkIdParam(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: string
): boolean {
  if (isValidLifeLinkId(value)) {
    return true;
  }
  rejectValidation(request, response, logger, "life_link_id", "invalid_life_link_id");
  return false;
}

function readOptionalLifeLinkIdQuery(
  request: AppRequest,
  response: Response,
  logger: Logger,
  field: string
): string | null {
  const value = request.query[field];
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !isValidLifeLinkId(value)) {
    rejectValidation(request, response, logger, "parent_id", "invalid_parent_id");
    return null;
  }
  return value;
}

function readOptionalLifeLinkIdBody(
  request: AppRequest,
  response: Response,
  logger: Logger,
  input: Record<string, unknown>,
  field: string
): string | null {
  const value = input[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || !isValidLifeLinkId(value)) {
    rejectValidation(request, response, logger, "parent_id", "invalid_parent_id");
    return null;
  }
  return value;
}

function readRequiredNullableLifeLinkIdBody(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown,
  field: string
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !isValidLifeLinkId(value)) {
    rejectValidation(request, response, logger, field, "invalid_parent_id");
    return null;
  }
  return value;
}

function readLifeLinkPageQuery(
  request: AppRequest,
  response: Response,
  logger: Logger,
  maxLimit: number
): LifeLinkPageRequest | undefined {
  const cursorValue = request.query.cursor;
  let cursor: string | null | undefined;
  if (cursorValue !== undefined) {
    if (typeof cursorValue !== "string" || cursorValue.length > MAX_LIFE_LINK_CURSOR_LENGTH) {
      rejectValidation(request, response, logger, "cursor", "invalid_life_link_cursor");
      return undefined;
    }
    cursor = cursorValue;
  }

  const limitValue = request.query.limit;
  let limit: number | undefined;
  if (limitValue !== undefined) {
    if (typeof limitValue !== "string" || !/^\d+$/.test(limitValue)) {
      rejectValidation(request, response, logger, "limit", "invalid_life_link_limit");
      return undefined;
    }
    limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
      rejectValidation(request, response, logger, "limit", "invalid_life_link_limit");
      return undefined;
    }
  }
  return { cursor, limit };
}

function validateCanonicalBodyDocField(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown
): LinkBodyDoc | undefined {
  if (value === null) {
    rejectValidation(request, response, logger, "body_doc", "body_doc_invalid");
    return undefined;
  }
  return validateBodyDocField(request, response, logger, value) ?? undefined;
}

function validateBodyDocVersionField(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown,
  options: { contentPresent: boolean }
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== LINK_BODY_DOC_VERSION) {
    rejectValidation(request, response, logger, "body_doc_version", "invalid_body_doc_version");
    return undefined;
  }
  if (!options.contentPresent) {
    rejectValidation(request, response, logger, "body_doc_version", "body_doc_version_without_content");
    return undefined;
  }
  return value;
}

function validatePrivacyField(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown
): PrivacyStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "public" && value !== "private") {
    rejectValidation(request, response, logger, "privacy", "invalid_privacy");
    return undefined;
  }
  return value;
}

function validateExpectedUpdatedAt(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EXPECTED_UPDATED_AT_LENGTH ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    rejectValidation(request, response, logger, "expected_updated_at", "invalid_expected_updated_at");
    return undefined;
  }
  return value;
}

function validateQrIdParam(request: AppRequest, response: Response, logger: Logger, value: string): boolean {
  if (isValidQrId(value)) {
    return true;
  }
  rejectValidation(request, response, logger, "qr_id", "invalid_qr_id");
  return false;
}

function validateMediaIdParam(request: AppRequest, response: Response, logger: Logger, value: string): boolean {
  if (value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9._:-]+$/.test(value)) {
    return true;
  }
  rejectValidation(request, response, logger, "media_id", "invalid_media_id");
  return false;
}

function readMediaUpload(request: MediaUploadRequest, response: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    mediaUpload.single(MEDIA_UPLOAD_FIELD)(request, response, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function handleMediaUploadError(request: AppRequest, response: Response, logger: Logger, error: unknown) {
  const multerCode = error instanceof multer.MulterError ? error.code : undefined;
  const status = multerCode === "LIMIT_FILE_SIZE" ? 413 : 400;
  const responseError = multerCode === "LIMIT_FILE_SIZE" ? "media_file_too_large" : "media_upload_invalid";
  logger.warn("life_links.media.upload_rejected", {
    msg: "Media upload rejected by multipart parser",
    ...requestLogFields(request),
    method: request.method,
    path: request.path,
    reason: responseError,
    multer_code: multerCode
  });
  if (status === 400 && request.path.startsWith("/api/life-links/")) {
    sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: responseError });
    return;
  }
  response.status(status).json({ error: responseError });
}

function validateCanonicalStringField(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === null) {
    rejectValidation(request, response, logger, field, `${field}_invalid`);
    return undefined;
  }
  return validateStringField(request, response, logger, value, field, maxLength);
}

function validateStringField(
  request: AppRequest,
  response: Response,
  logger: Logger,
  value: unknown,
  field: string,
  maxLength: number,
  options: { required?: boolean; trim?: boolean } = {}
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) {
      rejectValidation(request, response, logger, field, `${field}_required`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    rejectValidation(request, response, logger, field, `${field}_invalid`);
    return undefined;
  }
  const next = options.trim ? value.trim() : value;
  if (options.required && !next) {
    rejectValidation(request, response, logger, field, `${field}_required`);
    return undefined;
  }
  if (next.length > maxLength) {
    rejectValidation(request, response, logger, field, `${field}_too_long`);
    return undefined;
  }
  return next;
}

function validateBodyDocField(request: AppRequest, response: Response, logger: Logger, value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  let byteLength = 0;
  try {
    byteLength = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    rejectValidation(request, response, logger, "body_doc", "body_doc_invalid");
    return undefined;
  }
  if (byteLength > MAX_BODY_DOC_BYTES) {
    rejectValidation(request, response, logger, "body_doc", "body_doc_too_large");
    return undefined;
  }
  const bodyDoc = normalizeLinkBodyDoc(value);
  if (!bodyDoc) {
    rejectValidation(request, response, logger, "body_doc", "body_doc_invalid");
    return undefined;
  }
  const text = extractPlainTextFromLinkBodyDoc(bodyDoc);
  if (text.length > MAX_BODY_LENGTH) {
    rejectValidation(request, response, logger, "body", "body_too_long");
    return undefined;
  }
  return bodyDoc;
}

const LIFE_LINK_ERROR_MESSAGES: Record<LifeLinkDomainErrorCode, string> = {
  life_link_not_found: "Life Link was not found.",
  invalid_life_link: "Life Link request is invalid.",
  duplicate_life_link_id: "Life Link identity is already in use.",
  invalid_parent: "Life Link parent placement is invalid.",
  hierarchy_cycle: "Life Link parent placement would create a cycle.",
  stale_life_link: "Life Link changed after it was read.",
  qr_already_bound: "QR is already bound to a Life Link.",
  life_link_already_tagged: "Life Link already has a QR tag.",
  output_limit_exceeded: "Life Link result exceeds the supported limit."
};

function canonicalLifeLinkErrorStatus(code: LifeLinkDomainErrorCode): number {
  if (code === "life_link_not_found") {
    return 404;
  }
  if (
    code === "duplicate_life_link_id" ||
    code === "invalid_parent" ||
    code === "hierarchy_cycle" ||
    code === "stale_life_link" ||
    code === "qr_already_bound" ||
    code === "life_link_already_tagged"
  ) {
    return 409;
  }
  return 400;
}

function sendCanonicalLifeLinkError(
  response: Response,
  status: number,
  code: LifeLinkDomainErrorCode,
  options: { retryable?: boolean; reason?: string } = {}
): void {
  response.status(status).json({
    error: {
      code,
      message: LIFE_LINK_ERROR_MESSAGES[code],
      retryable: options.retryable ?? false,
      ...(options.reason ? { reason: options.reason } : {})
    }
  });
}

function sendCanonicalLifeLinkNotFound(response: Response): void {
  sendCanonicalLifeLinkError(response, 404, "life_link_not_found");
}

function handleLifeLinkDomainError(
  error: unknown,
  request: AppRequest,
  response: Response,
  logger: Logger
): boolean {
  if (!(error instanceof LifeLinkDomainError)) {
    return false;
  }

  if (
    request.method === "PATCH" &&
    /^\/api\/links\/[^/]+$/.test(request.path) &&
    (error.code === "invalid_parent" || error.code === "hierarchy_cycle")
  ) {
    logger.warn("life_links.link.hierarchy_conflict", {
      msg: "Legacy Link placement rejected to preserve canonical hierarchy",
      ...requestLogFields(request),
      ...routeLogFields(request.path),
      reason: error.reason ?? error.code,
      status: 409
    });
    response.status(409).json({ error: "hierarchy_conflict" });
    return true;
  }

  const isCanonicalRoute = request.path === "/api/life-links" || request.path.startsWith("/api/life-links/");
  const isAttachClaim =
    request.method === "POST" &&
    /^\/api\/qr\/[^/]+\/claim$/.test(request.path) &&
    request.body &&
    typeof request.body === "object" &&
    !Array.isArray(request.body) &&
    (request.body as { mode?: unknown }).mode === "attach";
  if (!isCanonicalRoute && !isAttachClaim) {
    return false;
  }

  const status = canonicalLifeLinkErrorStatus(error.code);
  logger.warn("life_links.life_link.request_rejected", {
    msg: "Canonical Life Link request rejected",
    ...requestLogFields(request),
    ...routeLogFields(request.path),
    error_code: error.code,
    reason: error.reason,
    retryable: error.retryable,
    status
  });
  sendCanonicalLifeLinkError(response, status, error.code, {
    retryable: error.retryable,
    reason: error.reason
  });
  return true;
}

function rejectValidation(request: AppRequest, response: Response, logger: Logger, field: string, error: string) {
  logger.warn("life_links.validation.rejected", {
    msg: "Request rejected by input validation",
    ...requestLogFields(request),
    method: request.method,
    path: request.path,
    field,
    reason: error
  });
  if (request.path === "/api/life-links" || request.path.startsWith("/api/life-links/")) {
    sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: error });
    return;
  }
  response.status(400).json({ error });
}

function requireUser(logger: Logger) {
  return (request: AppRequest, response: Response, next: NextFunction) => {
    if (!request.user) {
      logger.warn("life_links.auth.required_denied", {
        msg: "Authentication required",
        ...requestLogFields(request)
      });
      response.status(401).json({ error: "auth_required" });
      return;
    }
    next();
  };
}

function setSessionCookie(response: Response, token: string, config: LifeLinksConfig) {
  response.setHeader(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: config.sessionTtlDays * 24 * 60 * 60
    })
  );
}

function clearSessionCookie(response: Response, config: LifeLinksConfig) {
  response.setHeader(
    "Set-Cookie",
    cookie.serialize(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: 0
    })
  );
}

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt
  };
}

function agentConnectionForUser(user: StoredUser | undefined) {
  return {
    connected: Boolean(user?.agentConnectedAt),
    connectedAt: user?.agentConnectedAt ?? null
  };
}

function sendClientApp(_request: Request, response: Response, _next: NextFunction, staticDistPath: string) {
  const indexPath = path.join(staticDistPath, "index.html");
  if (fs.existsSync(indexPath)) {
    response.sendFile(indexPath);
    return;
  }
  response
    .type("html")
    .send('<!doctype html><html><body><h1>Life Links</h1><p>Build the React app to enable the hosted demo UI.</p></body></html>');
}

function cryptoRandomCommandId(): string {
  return `claim-${randomUUID()}`;
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sanitizeFileName(value: string): string {
  const baseName = path
    .basename(value || "upload")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[^\w .()+-]/g, "_")
    .trim()
    .slice(0, 120);
  return baseName || "upload";
}

function inlineContentDisposition(fileName: string): string {
  const safeFileName = sanitizeFileName(fileName).replace(/(["\\])/g, "\\$1");
  return `inline; filename="${safeFileName}"`;
}

function runtimeFields(config: LifeLinksConfig) {
  return {
    system: "life_links",
    component: config.component,
    env: config.env,
    version: config.version,
    build_sha: config.buildSha,
    canonical_source_sha: config.canonicalSourceSha,
    source_tree_sha256: config.sourceTreeSha256,
    build_time: config.buildTime,
    store_mode: config.storeMode
  };
}

function resolveRequestId(request: Request): string {
  const candidate = request.get("x-request-id")?.trim();
  if (candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) && !hasSessionTokenShape(candidate)) {
    return candidate;
  }
  return randomUUID();
}

function requestLogFields(request: AppRequest): Record<string, unknown> {
  return {
    request_id: request.requestId ?? "unknown",
    user_id: request.user?.id
  };
}

function routeLogFields(pathname: string): Record<string, unknown> {
  const mediaMatch = pathname.match(/^\/api\/links\/([^/]+)\/media\/([^/]+)$/);
  if (mediaMatch) {
    return { qr_id: decodeURIComponent(mediaMatch[1]), media_id: decodeURIComponent(mediaMatch[2]) };
  }
  const qrMatch = pathname.match(/^\/(?:api\/)?qr\/([^/.]+)(?:\/claim)?$/);
  if (qrMatch) {
    return { qr_id: decodeURIComponent(qrMatch[1]) };
  }
  const batchMatch = pathname.match(/^\/api\/qr-batches\/([^/.]+)(?:\.(csv|zip))?$/);
  if (batchMatch) {
    return { batch_id: decodeURIComponent(batchMatch[1]), format: batchMatch[2] };
  }
  return {};
}

function errorMessage(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-postgres-url]")
    .replace(/bearer\s+[a-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}
