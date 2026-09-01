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
  type AppendRoutineSessionAmendmentCommand,
  type CreateActivityCommand,
  type CreateRoutineCommand,
  type CreateRoutineGroupCommand,
  type CreateRoutineScheduleCommand,
  type FinalizeRoutineRunCommand,
  type LifeLinkDomainErrorCode,
  type LifeLinkPageRequest,
  type PreviewLifeLinkChangeInput,
  LifeLinkDomainError,
  type LinkBodyDoc,
  ATTACHMENT_MIME_TYPES,
  type AttachmentImageReadOptions,
  resolveAttachmentMimeType,
  type LinkRecord,
  type PrivacyStatus,
  type PutRoutineRunStepResultCommand,
  type ReviseRoutineCommand,
  type RoutineScheduleRecord,
  type RoutineScheduleRule,
  type StartRoutineRunCommand,
  type UpdateActivityCommand,
  type UpdateRoutineCommand,
  type UpdateRoutineGroupCommand,
  type UpdateRoutineScheduleCommand,
  COMPETITION_FIXTURE_PROFILE,
  LINK_BODY_DOC_VERSION,
  MAX_BATCH_COUNT,
  MAX_BODY_LENGTH,
  MAX_BODY_DOC_BYTES,
  MAX_LIFE_LINK_CHILD_PAGE_LIMIT,
  MAX_LIFE_LINK_SEARCH_LIMIT,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_PER_LINK,
  MAX_QR_ID_LENGTH,
  MAX_SCAN_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  createLinkBodyDocFromPlainText,
  extractPlainTextFromLinkBodyDoc,
  isValidQrId,
  linksToCsv,
  normalizeLinkBodyDoc,
  normalizeLifeLinkBrowsingRole,
  normalizeLifeLinkContext,
  normalizePublicFieldKeys,
  normalizeCollectionId,
  normalizeCollectionSectionId,
  normalizeCollectionPatch,
  normalizeCollectionSectionTitle,
  normalizeCollectionSectionIds,
  normalizeSetLifeLinkQrBindingCommand,
  normalizeActivityId,
  normalizeActivityPatch,
  normalizeRoutineBindingId,
  normalizeRoutineGroupId,
  normalizeRoutineGroupPatch,
  normalizeRoutineId,
  normalizeRoutineLocalDate,
  normalizeRoutineOccurrenceId,
  normalizeRoutinePatch,
  normalizeRoutineRevisionId,
  normalizeRoutineRunId,
  normalizeRoutineScheduleId,
  normalizeRoutineSchedulePatch,
  normalizeRoutineScheduleRule,
  normalizeRoutineSessionAmendmentId,
  normalizeRoutineSessionId,
  normalizeRoutineStepId,
  normalizeRoutineValues,
  normalizeClearLifeLinkQrBindingCommand,
  normalizeBatchCount,
  parseQrId
} from "@life-links/core";

import type { LifeLinksConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { createSessionToken, hasSessionTokenShape, hashSessionToken, verifyPassword } from "./password.js";
import {
  ClaimIdempotencyConflictError,
  type LifeLinksStore,
  type RoutineOccurrencePageRequest,
  type RoutinePageRequest,
  type StoredUser
} from "./store.js";
import { AttachmentContentReader, AttachmentContentRequestError } from "./attachment-content.js";

const SESSION_COOKIE = "life_links_session";
const MEDIA_UPLOAD_FIELD = "file";
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_BYTES,
    files: 1
  }
});
const MAX_LIFE_LINK_ID_LENGTH = 200;
const MAX_LIFE_LINK_CURSOR_LENGTH = 4096;
const MAX_EXPECTED_UPDATED_AT_LENGTH = 64;

function attachmentRequestCancellation(request: Request, response: Response) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException("Attachment request cancelled", "AbortError"));
  const close = () => { if (!response.writableEnded) cancel(); };
  request.once("aborted", cancel);
  response.once("close", close);
  if (request.aborted || response.destroyed) cancel();
  return { signal: controller.signal, dispose: () => { request.off("aborted", cancel); response.off("close", close); } };
}

function parseAttachmentImageQuery(query: Request["query"]): AttachmentImageReadOptions {
  const allowed = query.mode === "describe" ? ["mode", "page", "frame", "atMs"] : query.mode === "crop" ?
    ["mode", "page", "frame", "atMs", "sourceRevision", "x", "y", "width", "height", "maxEdge", "encoding"] : ["mode", "page", "frame", "atMs", "sourceRevision", "maxEdge", "encoding"];
  if (Object.keys(query).some((key) => !allowed.includes(key)) || Object.values(query).some((value) => typeof value !== "string") ||
      !["describe", "overview", "crop"].includes(String(query.mode))) throw new AttachmentContentRequestError(400, "invalid_attachment_image_request");
  const integer = (name: string) => /^\d+$/.test(String(query[name])) ? Number(query[name]) : NaN;
  const page = { ...(query.page === undefined ? {} : { page: integer("page") }),
    ...(query.frame === undefined ? {} : { frame: integer("frame") }), ...(query.atMs === undefined ? {} : { atMs: integer("atMs") }) };
  if (query.mode === "describe") return { mode: "describe", ...page };
  const render = { ...page, sourceRevision: String(query.sourceRevision ?? ""),
    ...(query.maxEdge === undefined ? {} : { maxEdge: integer("maxEdge") }),
    ...(query.encoding === undefined ? {} : { encoding: String(query.encoding) as "png" | "jpeg" }) };
  return query.mode === "crop" ? { mode: "crop", ...render, region: {
    x: integer("x"), y: integer("y"), width: integer("width"), height: integer("height")
  } } : { mode: "overview", ...render };
}

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
  const attachmentReader = new AttachmentContentReader(undefined, config.attachmentRuntime);
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

  app.post("/api/life-links/changes/preview", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["operation", "lifeLinkIds", "parentId"])) return;
    if (!["move", "delete"].includes(String(input.operation)) || !Array.isArray(input.lifeLinkIds) || input.lifeLinkIds.length < 1 || input.lifeLinkIds.length > 100 || input.lifeLinkIds.some((id) => typeof id !== "string" || !id.trim() || id.length > MAX_LIFE_LINK_ID_LENGTH)) {
      sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "invalid_change_selection" }); return;
    }
    if ((input.operation === "move" && !(input.parentId === null || (typeof input.parentId === "string" && input.parentId.trim() && input.parentId.length <= MAX_LIFE_LINK_ID_LENGTH))) || (input.operation === "delete" && input.parentId !== undefined)) {
      sendCanonicalLifeLinkError(response, 400, "invalid_parent"); return;
    }
    const preview = await store.previewLifeLinkChange(request.user!.id, input as PreviewLifeLinkChangeInput);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ preview: { ...preview, nextCursor: null, totalItems: preview.items.length } });
  });

  app.get("/api/life-links/changes/:previewId", requireAuthenticated, async (request: AppRequest, response) => {
    const preview = await store.getLifeLinkChangePreview(request.user!.id, paramValue(request.params.previewId));
    if (!preview) { sendCanonicalLifeLinkNotFound(response); return; }
    const cursor = request.query.cursor ?? "0";
    const limit = request.query.limit === undefined ? 100 : Number(request.query.limit);
    if (typeof cursor !== "string" || !/^\d{1,10}$/.test(cursor) || Number(cursor) > preview.items.length || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "invalid_preview_page" }); return;
    }
    const offset = Number(cursor);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ preview: { ...preview, items: preview.items.slice(offset, offset + limit), totalItems: preview.items.length, nextCursor: offset + limit < preview.items.length ? String(offset + limit) : null } });
  });

  app.post("/api/life-links/changes/apply", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["previewId", "commandId"])) return;
    if (!validChangeCommandField(input.previewId, 200) || !validChangeCommandField(input.commandId, 128)) {
      sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "invalid_change_command" }); return;
    }
    const result = await store.applyLifeLinkChange(request.user!.id, { previewId: input.previewId, commandId: input.commandId });
    if (result.operation === "delete") attachmentReader.invalidate(result.affectedIds);
    logger.info("life_links.change.applied", { msg: "Owner change applied", ...requestLogFields(request), operation: result.operation, affected_count: result.affectedIds.length });
    response.json(result);
  });

  app.get("/api/change-history", requireAuthenticated, async (request: AppRequest, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await store.getChangeHistory(request.user!.id));
  });

  app.post("/api/change-history/undo", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["changeId", "commandId"])) return;
    if (!validChangeCommandField(input.changeId, 200) || !validChangeCommandField(input.commandId, 128)) {
      sendCanonicalLifeLinkError(response, 400, "invalid_life_link", { reason: "invalid_change_command" }); return;
    }
    const result = await store.undoChange(request.user!.id, { changeId: input.changeId, commandId: input.commandId });
    attachmentReader.invalidate(result.affectedIds);
    logger.info("life_links.change.undone", { msg: "Owner change undone", ...requestLogFields(request), affected_count: result.affectedIds.length });
    response.json(result);
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
        "id",
        "parentId",
        "title",
        "body",
        "bodyDoc",
        "bodyDocVersion",
        "privacy",
        "browsingRole",
        "context",
        "publicFieldKeys"
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
    const id = input.id === undefined ? `life-link-${randomUUID()}` : input.id;
    if (typeof id !== "string" || !validateLifeLinkIdParam(request, response, logger, id)) {
      if (!response.headersSent) rejectValidation(request, response, logger, "id", "life_link_id_invalid");
      return;
    }
    const lifeLink = await store.createLifeLink({
      id,
      ownerId: request.user!.id,
      parentId,
      title,
      body,
      bodyDoc,
      bodyDocVersion,
      privacy,
      browsingRole: input.browsingRole === undefined ? undefined : normalizeLifeLinkBrowsingRole(input.browsingRole),
      context: input.context === undefined ? undefined : normalizeLifeLinkContext(input.context),
      publicFieldKeys: input.publicFieldKeys === undefined ? undefined : normalizePublicFieldKeys(input.publicFieldKeys),
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
      const mimeType = resolveAttachmentMimeType(file.mimetype, file.originalname);
      const kind = mimeType ? ATTACHMENT_MIME_TYPES[mimeType] : null;
      if (!kind) {
        response.status(415).json({ error: "media_type_not_allowed" });
        return;
      }
      const media = await store.createLifeLinkMedia(request.user!.id, lifeLinkId, {
        kind,
        mimeType: mimeType!,
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
    "/api/life-links/:lifeLinkId/media/:mediaId/content",
    requireAuthenticated,
    async (request: AppRequest, response) => {
      const lifeLinkId = paramValue(request.params.lifeLinkId);
      const mediaId = paramValue(request.params.mediaId);
      if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId) || !validateMediaIdParam(request, response, logger, mediaId)) return;
      const file = await store.getLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
      if (!file) { sendCanonicalLifeLinkError(response, 404, "life_link_not_found", { reason: "media_not_found_or_forbidden" }); return; }
      if (Object.keys(request.query).some((key) => !["offset", "limit", "revision", "representation", "startMs", "durationMs", "audioStreamIndex"].includes(key)) ||
          Object.values(request.query).some((value) => typeof value !== "string")) {
        response.status(400).json({ error: "invalid_attachment_content_page" }); return;
      }
      const cancellation = attachmentRequestCancellation(request, response);
      try {
        const page = await attachmentReader.read(file, {
          ...(request.query.offset === undefined ? {} : { offset: /^\d+$/.test(String(request.query.offset)) ? Number(request.query.offset) : NaN }),
          ...(request.query.limit === undefined ? {} : { limit: /^\d+$/.test(String(request.query.limit)) ? Number(request.query.limit) : NaN }),
          ...(request.query.revision === undefined ? {} : { revision: String(request.query.revision) }),
          ...(request.query.representation === undefined ? {} : { representation: String(request.query.representation) as "transcript" }),
          ...Object.fromEntries(["startMs", "durationMs", "audioStreamIndex"].filter((key) => request.query[key] !== undefined)
            .map((key) => [key, /^\d+$/.test(String(request.query[key])) ? Number(request.query[key]) : NaN]))
        }, cancellation.signal);
        // Extraction may outlast a deletion, replacement, or session revocation.
        // Recheck the canonical object and current session before releasing text.
        const current = await store.getLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
        const session = request.sessionTokenHash ? await store.getSessionByTokenHash(request.sessionTokenHash) : null;
        if (!session || session.user.id !== request.user!.id) {
          attachmentReader.invalidate([lifeLinkId], mediaId);
          response.status(401).json({ error: "authentication_required" }); return;
        }
        if (!current) {
          attachmentReader.invalidate([lifeLinkId], mediaId);
          sendCanonicalLifeLinkError(response, 404, "life_link_not_found", { reason: "media_not_found_or_forbidden" }); return;
        }
        if (current.media.mimeType !== file.media.mimeType || !current.data.equals(file.data)) {
          attachmentReader.invalidate([lifeLinkId], mediaId);
          response.status(409).json({ error: "attachment_content_changed" }); return;
        }
        if (cancellation.signal.aborted) return;
        response.setHeader("Cache-Control", "private, no-store");
        response.json(page);
      } catch (error) {
        if (cancellation.signal.aborted) return;
        if (!(error instanceof AttachmentContentRequestError)) throw error;
        response.status(error.status).json({ error: error.code });
      } finally { cancellation.dispose(); }
    }
  );

  app.get(
    "/api/life-links/:lifeLinkId/media/:mediaId/image",
    requireAuthenticated,
    async (request: AppRequest, response) => {
      const lifeLinkId = paramValue(request.params.lifeLinkId);
      const mediaId = paramValue(request.params.mediaId);
      if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId) || !validateMediaIdParam(request, response, logger, mediaId)) return;
      const file = await store.getLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
      if (!file) { sendCanonicalLifeLinkError(response, 404, "life_link_not_found", { reason: "media_not_found_or_forbidden" }); return; }
      const cancellation = attachmentRequestCancellation(request, response);
      try {
        const image = await attachmentReader.readImage(file, parseAttachmentImageQuery(request.query), cancellation.signal);
        const current = await store.getLifeLinkMedia(request.user!.id, lifeLinkId, mediaId);
        const session = request.sessionTokenHash ? await store.getSessionByTokenHash(request.sessionTokenHash) : null;
        if (cancellation.signal.aborted) return;
        if (!session || session.user.id !== request.user!.id) {
          response.status(401).json({ error: "authentication_required" }); return;
        }
        if (!current) { sendCanonicalLifeLinkError(response, 404, "life_link_not_found", { reason: "media_not_found_or_forbidden" }); return; }
        if (current.media.mimeType !== file.media.mimeType || !current.data.equals(file.data)) {
          response.status(409).json({ error: "attachment_content_changed" }); return;
        }
        response.setHeader("Cache-Control", "private, no-store");
        response.json(image);
      } catch (error) {
        if (cancellation.signal.aborted) return;
        if (!(error instanceof AttachmentContentRequestError)) throw error;
        response.status(error.status).json({ error: error.code });
      } finally { cancellation.dispose(); }
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
      response.setHeader("Content-Disposition", mediaContentDisposition(mediaFile.media.fileName, mediaFile.media.kind));
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
      if (deleted) attachmentReader.invalidate([lifeLinkId], mediaId);
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
    const memberships = await store.listLifeLinkCollectionMemberships(request.user!.id, lifeLinkId);
    response.json({ detail: { ...detail, collectionMemberships: memberships?.items ?? [],
      collectionMembershipsPage: { nextCursor: memberships?.nextCursor ?? null, truncated: memberships?.truncated ?? false } } });
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
        "privacy",
        "context",
        "publicFieldKeys"
      ])
    ) {
      return;
    }
    const expectedUpdatedAt = validateExpectedUpdatedAt(request, response, logger, input.expectedUpdatedAt);
    if (expectedUpdatedAt === undefined) {
      return;
    }
    const mutableFields = ["title", "body", "bodyDoc", "privacy", "context", "publicFieldKeys"] as const;
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
        privacy,
        context: input.context === undefined ? undefined : normalizeLifeLinkContext(input.context),
        publicFieldKeys: input.publicFieldKeys === undefined ? undefined : normalizePublicFieldKeys(input.publicFieldKeys)
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

  app.get("/api/life-links/:lifeLinkId/collection-memberships", requireAuthenticated, async (request: AppRequest, response) => {
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) return;
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const result = await store.listLifeLinkCollectionMemberships(request.user!.id, lifeLinkId, page);
    if (!result) { sendCanonicalLifeLinkNotFound(response); return; }
    response.json({ memberships: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.put("/api/life-links/:lifeLinkId/qr-binding", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["commandId", "qrId", "expectedUpdatedAt"])) return;
    const command = normalizeSetLifeLinkQrBindingCommand({ ...input, lifeLinkId: paramValue(request.params.lifeLinkId) });
    const lifeLink = await store.setLifeLinkQrBinding(request.user!.id, command);
    if (!lifeLink) { sendCanonicalLifeLinkNotFound(response); return; }
    logger.info("life_links.life_link.qr_binding_set", { msg: "Owner QR binding set", ...requestLogFields(request), life_link_id: lifeLink.id });
    response.json({ lifeLink });
  });

  app.delete("/api/life-links/:lifeLinkId/qr-binding", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["commandId", "expectedUpdatedAt"])) return;
    const command = normalizeClearLifeLinkQrBindingCommand({ ...input, lifeLinkId: paramValue(request.params.lifeLinkId) });
    const lifeLink = await store.clearLifeLinkQrBinding(request.user!.id, command);
    if (!lifeLink) { sendCanonicalLifeLinkNotFound(response); return; }
    logger.info("life_links.life_link.qr_binding_cleared", { msg: "Owner QR binding cleared", ...requestLogFields(request), life_link_id: lifeLink.id });
    response.json({ lifeLink });
  });

  app.get("/api/collections", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const result = await store.listCollections(request.user!.id, page);
    response.json({ collections: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/collections", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readObjectBody(request, response, logger);
    if (!input || !validateObjectFields(request, response, logger, input, ["id", "title", "purpose", "notes"])) return;
    const { id, ...metadata } = input;
    const patch = normalizeCollectionPatch(metadata);
    if (patch.title === undefined) { rejectValidation(request, response, logger, "title", "title_required"); return; }
    const collection = await store.createCollection({ ...patch, title: patch.title,
      id: normalizeCollectionId(id === undefined ? `collection-${randomUUID()}` : id),
      ownerId: request.user!.id, createdAt: new Date().toISOString() });
    logger.info("life_links.collection.created", { msg: "Owner Collection created", ...requestLogFields(request), collection_id: collection.id });
    response.status(201).json({ collection });
  });

  app.get("/api/collections/:collectionId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const collection = await store.getCollection(request.user!.id, collectionId);
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_not_found"); return; }
    const sections = await store.listCollectionSections(request.user!.id, collectionId, page);
    response.json({ collection, sections: sections?.items ?? [],
      sectionsPage: { nextCursor: sections?.nextCursor ?? null, truncated: sections?.truncated ?? false } });
  });

  app.patch("/api/collections/:collectionId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const input = readRevisionMutation(request, response, logger, ["title", "purpose", "notes"]);
    if (!input) return;
    const { expectedUpdatedAt, ...metadata } = input;
    if (!Object.keys(metadata).length) { rejectValidation(request, response, logger, "patch", "collection_patch_required"); return; }
    const collection = await store.updateCollection(request.user!.id, { collectionId, expectedUpdatedAt,
      patch: normalizeCollectionPatch(metadata) });
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_not_found"); return; }
    response.json({ collection });
  });

  app.get("/api/collections/:collectionId/members", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const result = await store.listCollectionMembers(request.user!.id, collectionId, page);
    if (!result) { sendCanonicalLifeLinkError(response, 404, "collection_not_found"); return; }
    response.json({ lifeLinks: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.put("/api/collections/:collectionId/members/:lifeLinkId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) return;
    const input = readRevisionMutation(request, response, logger, []);
    if (!input) return;
    const collection = await store.addCollectionMember(request.user!.id, { collectionId, lifeLinkId, expectedUpdatedAt: input.expectedUpdatedAt });
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_membership_not_found"); return; }
    response.json({ collection });
  });

  app.delete("/api/collections/:collectionId/members/:lifeLinkId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) return;
    const input = readRevisionMutation(request, response, logger, []);
    if (!input) return;
    const collection = await store.removeCollectionMember(request.user!.id, { collectionId, lifeLinkId, expectedUpdatedAt: input.expectedUpdatedAt });
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_membership_not_found"); return; }
    response.json({ collection });
  });

  app.post("/api/collections/:collectionId/sections", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const input = readRevisionMutation(request, response, logger, ["id", "title"]);
    if (!input) return;
    const result = await store.createCollectionSection(request.user!.id, { collectionId,
      id: normalizeCollectionSectionId(input.id === undefined ? `section-${randomUUID()}` : input.id),
      title: normalizeCollectionSectionTitle(input.title), expectedUpdatedAt: input.expectedUpdatedAt });
    if (!result) { sendCanonicalLifeLinkError(response, 404, "collection_not_found"); return; }
    response.status(201).json(result);
  });

  app.patch("/api/collections/:collectionId/sections/:sectionId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const sectionId = normalizeCollectionSectionId(paramValue(request.params.sectionId));
    const input = readRevisionMutation(request, response, logger, ["title"]);
    if (!input) return;
    const result = await store.updateCollectionSection(request.user!.id, { collectionId, sectionId,
      title: normalizeCollectionSectionTitle(input.title), expectedUpdatedAt: input.expectedUpdatedAt });
    if (!result) { sendCanonicalLifeLinkError(response, 404, "section_not_found"); return; }
    response.json(result);
  });

  app.delete("/api/collections/:collectionId/sections/:sectionId", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const sectionId = normalizeCollectionSectionId(paramValue(request.params.sectionId));
    const input = readRevisionMutation(request, response, logger, []);
    if (!input) return;
    const collection = await store.removeCollectionSection(request.user!.id, { collectionId, sectionId, expectedUpdatedAt: input.expectedUpdatedAt });
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_not_found"); return; }
    response.json({ collection });
  });

  app.put("/api/collections/:collectionId/members/:lifeLinkId/sections", requireAuthenticated, async (request: AppRequest, response) => {
    const collectionId = normalizeCollectionId(paramValue(request.params.collectionId));
    const lifeLinkId = paramValue(request.params.lifeLinkId);
    if (!validateLifeLinkIdParam(request, response, logger, lifeLinkId)) return;
    const input = readRevisionMutation(request, response, logger, ["sectionIds"]);
    if (!input) return;
    const collection = await store.replaceCollectionSectionAssignments(request.user!.id, { collectionId, lifeLinkId,
      sectionIds: normalizeCollectionSectionIds(input.sectionIds), expectedUpdatedAt: input.expectedUpdatedAt });
    if (!collection) { sendCanonicalLifeLinkError(response, 404, "collection_membership_not_found"); return; }
    response.json({ collection });
  });

  app.get("/api/routine-groups", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readRoutinePageQuery(request, response, logger);
    if (!page) return;
    const result = await store.listRoutineGroups(request.user!.id, page);
    response.json({ routineGroups: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/routine-groups", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineBody(request, response, logger, ["id", "title", "notes"]);
    if (!input) return;
    const command = {
      ...input,
      id: normalizeRoutineGroupId(input.id ?? `routine-group-${randomUUID()}`),
      ownerId: request.user!.id,
      createdAt: new Date().toISOString()
    } as unknown as CreateRoutineGroupCommand;
    const routineGroup = await store.createRoutineGroup(command);
    logger.info("life_links.routine.group_created", {
      msg: "Owner Routine Group created", ...requestLogFields(request), routine_group_id: routineGroup.id
    });
    response.status(201).json({ routineGroup });
  });

  app.get("/api/routine-groups/:groupId", requireAuthenticated, async (request: AppRequest, response) => {
    const routineGroup = await store.getRoutineGroup(request.user!.id, normalizeRoutineGroupId(paramValue(request.params.groupId)));
    if (!routineGroup) { sendRoutineError(response, 404, "routine_not_found", { reason: "group_not_found" }); return; }
    response.json({ routineGroup });
  });

  app.patch("/api/routine-groups/:groupId", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineRevisionMutation(request, response, logger, ["title", "notes", "archivedAt"]);
    if (!input) return;
    const { expectedUpdatedAt, ...patch } = input;
    const routineGroup = await store.updateRoutineGroup(request.user!.id, {
      groupId: normalizeRoutineGroupId(paramValue(request.params.groupId)),
      expectedUpdatedAt,
      patch: normalizeRoutineGroupPatch(patch)
    } as UpdateRoutineGroupCommand);
    if (!routineGroup) { sendRoutineError(response, 404, "routine_not_found", { reason: "group_not_found" }); return; }
    response.json({ routineGroup });
  });

  app.get("/api/routine-activities", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readRoutinePageQuery(request, response, logger);
    if (!page) return;
    const result = await store.listActivities(request.user!.id, page);
    response.json({ activities: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/routine-activities", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineBody(request, response, logger, ["id", "title", "notes"]);
    if (!input) return;
    const command = {
      ...input,
      id: normalizeActivityId(input.id ?? `activity-${randomUUID()}`),
      ownerId: request.user!.id,
      createdAt: new Date().toISOString()
    } as unknown as CreateActivityCommand;
    const activity = await store.createActivity(command);
    logger.info("life_links.routine.activity_created", {
      msg: "Owner Routine Activity created", ...requestLogFields(request), activity_id: activity.id
    });
    response.status(201).json({ activity });
  });

  app.get("/api/routine-activities/:activityId", requireAuthenticated, async (request: AppRequest, response) => {
    const activity = await store.getActivity(request.user!.id, normalizeActivityId(paramValue(request.params.activityId)));
    if (!activity) { sendRoutineError(response, 404, "routine_not_found", { reason: "activity_not_found" }); return; }
    response.json({ activity });
  });

  app.patch("/api/routine-activities/:activityId", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineRevisionMutation(request, response, logger, ["title", "notes", "archivedAt"]);
    if (!input) return;
    const { expectedUpdatedAt, ...patch } = input;
    const activity = await store.updateActivity(request.user!.id, {
      activityId: normalizeActivityId(paramValue(request.params.activityId)),
      expectedUpdatedAt,
      patch: normalizeActivityPatch(patch)
    } as UpdateActivityCommand);
    if (!activity) { sendRoutineError(response, 404, "routine_not_found", { reason: "activity_not_found" }); return; }
    response.json({ activity });
  });

  app.get("/api/routines", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readRoutinePageQuery(request, response, logger);
    if (!page) return;
    const result = await store.listRoutines(request.user!.id, page);
    response.json({ routines: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/routines", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineBody(request, response, logger, [
      "id", "revisionId", "groupId", "title", "purpose", "instructions", "steps", "bindings"
    ]);
    if (!input) return;
    const routineId = normalizeRoutineId(input.id ?? `routine-${randomUUID()}`);
    const revisionId = normalizeRoutineRevisionId(input.revisionId ?? `routine-revision-${randomUUID()}`);
    const definition = routineDefinitionWithStableIds(input, revisionId);
    const routine = await store.createRoutine({
      ...definition,
      id: routineId,
      revisionId,
      ownerId: request.user!.id,
      createdAt: new Date().toISOString()
    } as unknown as CreateRoutineCommand);
    logger.info("life_links.routine.created", {
      msg: "Owner Routine created", ...requestLogFields(request), routine_id: routine.routine.id,
      routine_revision_id: routine.currentRevision.revision.id
    });
    response.status(201).json({ routine });
  });

  app.get("/api/routines/:routineId", requireAuthenticated, async (request: AppRequest, response) => {
    const routine = await store.getRoutine(request.user!.id, normalizeRoutineId(paramValue(request.params.routineId)));
    if (!routine) { sendRoutineError(response, 404, "routine_not_found"); return; }
    response.json({ routine });
  });

  app.get("/api/routines/:routineId/active-run", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const routine = await store.getRoutine(request.user!.id, routineId);
    if (!routine) { sendRoutineError(response, 404, "routine_not_found"); return; }
    const run = await store.getActiveRoutineRun(request.user!.id, routineId);
    response.json({ run });
  });

  app.patch("/api/routines/:routineId", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const input = readRoutineRevisionMutation(request, response, logger, ["groupId", "archivedAt"]);
    if (!input) return;
    const { expectedUpdatedAt, ...patch } = input;
    const updated = await store.updateRoutine(request.user!.id, {
      routineId, expectedUpdatedAt, patch: normalizeRoutinePatch(patch)
    } as UpdateRoutineCommand);
    if (!updated) { sendRoutineError(response, 404, "routine_not_found"); return; }
    const routine = await store.getRoutine(request.user!.id, routineId);
    if (!routine) { sendRoutineError(response, 404, "routine_not_found"); return; }
    response.json({ routine });
  });

  app.post("/api/routines/:routineId/revisions", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const input = readRoutineBody(request, response, logger, [
      "revisionId", "expectedCurrentRevisionId", "title", "purpose", "instructions", "steps", "bindings"
    ]);
    if (!input) return;
    const current = await store.getRoutine(request.user!.id, routineId);
    if (!current) { sendRoutineError(response, 404, "routine_not_found"); return; }
    const revisionId = normalizeRoutineRevisionId(input.revisionId ?? `routine-revision-${randomUUID()}`);
    const definition = routineDefinitionWithStableIds(input, revisionId);
    const revision = await store.reviseRoutine(request.user!.id, {
      ...definition,
      id: revisionId,
      ownerId: request.user!.id,
      routineId,
      revisionNumber: current.currentRevision.revision.revisionNumber + 1,
      expectedCurrentRevisionId: normalizeRoutineRevisionId(input.expectedCurrentRevisionId),
      createdAt: new Date().toISOString()
    } as unknown as ReviseRoutineCommand);
    if (!revision) { sendRoutineError(response, 404, "routine_not_found"); return; }
    const routine = await store.getRoutine(request.user!.id, routineId);
    if (!routine) { sendRoutineError(response, 404, "routine_not_found"); return; }
    logger.info("life_links.routine.revised", {
      msg: "Owner Routine revision created", ...requestLogFields(request), routine_id: routineId,
      routine_revision_id: revision.revision.id, revision_number: revision.revision.revisionNumber
    });
    response.status(201).json({ routine });
  });

  app.get("/api/routines/:routineId/revisions/:revisionId", requireAuthenticated, async (request: AppRequest, response) => {
    const routineRevision = await store.getRoutineRevision(
      request.user!.id,
      normalizeRoutineId(paramValue(request.params.routineId)),
      normalizeRoutineRevisionId(paramValue(request.params.revisionId))
    );
    if (!routineRevision) { sendRoutineError(response, 404, "routine_not_found", { reason: "revision_not_found" }); return; }
    response.json({ routineRevision });
  });

  app.get("/api/routines/:routineId/schedules", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const result = await store.listRoutineSchedules(request.user!.id, routineId, page);
    if (!result) { sendRoutineError(response, 404, "routine_not_found"); return; }
    response.json({ schedules: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.post("/api/routines/:routineId/schedules", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const input = readRoutineBody(request, response, logger, ["id", "rule", "active"]);
    if (!input) return;
    const routine = await store.getRoutine(request.user!.id, routineId);
    if (!routine) { sendRoutineError(response, 404, "routine_not_found"); return; }
    const schedule = await store.createRoutineSchedule({
      id: normalizeRoutineScheduleId(input.id ?? `routine-schedule-${randomUUID()}`),
      ownerId: request.user!.id,
      routineId,
      routineRevisionId: routine.routine.currentRevisionId,
      rule: normalizeRoutineScheduleRule(input.rule),
      ...(input.active === undefined ? {} : { active: input.active }),
      createdAt: new Date().toISOString()
    } as CreateRoutineScheduleCommand);
    if (schedule.active) await materializeRoutineScheduleWindow(store, request.user!.id, schedule);
    logger.info("life_links.routine.schedule_created", {
      msg: "Owner Routine Schedule created", ...requestLogFields(request), routine_id: routineId,
      routine_schedule_id: schedule.id, routine_revision_id: schedule.routineRevisionId, schedule_revision: schedule.revision
    });
    response.status(201).json({ schedule });
  });

  app.patch("/api/routine-schedules/:scheduleId", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineRevisionMutation(request, response, logger, ["rule", "active"]);
    if (!input) return;
    const { expectedUpdatedAt, ...patch } = input;
    const schedule = await store.updateRoutineSchedule(request.user!.id, {
      scheduleId: normalizeRoutineScheduleId(paramValue(request.params.scheduleId)),
      expectedUpdatedAt,
      patch: normalizeRoutineSchedulePatch(patch)
    } as UpdateRoutineScheduleCommand);
    if (!schedule) { sendRoutineError(response, 404, "routine_not_found", { reason: "schedule_not_found" }); return; }
    if (schedule.active) await materializeRoutineScheduleWindow(store, request.user!.id, schedule);
    logger.info("life_links.routine.schedule_updated", {
      msg: "Owner Routine Schedule updated", ...requestLogFields(request), routine_id: schedule.routineId,
      routine_schedule_id: schedule.id, routine_revision_id: schedule.routineRevisionId, schedule_revision: schedule.revision
    });
    response.json({ schedule });
  });

  app.get("/api/routine-occurrences", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readRoutineOccurrencePageQuery(request, response, logger);
    if (!page) return;
    const result = await store.listRoutineOccurrences(request.user!.id, page);
    response.json({ occurrences: result.items, nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.get("/api/routine-occurrences/:occurrenceId", requireAuthenticated, async (request: AppRequest, response) => {
    const occurrence = await store.getRoutineOccurrence(
      request.user!.id, normalizeRoutineOccurrenceId(paramValue(request.params.occurrenceId))
    );
    if (!occurrence) { sendRoutineError(response, 404, "routine_not_found", { reason: "occurrence_not_found" }); return; }
    response.json({ occurrence });
  });

  app.post("/api/routines/:routineId/runs", requireAuthenticated, async (request: AppRequest, response) => {
    const routineId = normalizeRoutineId(paramValue(request.params.routineId));
    const input = readRoutineBody(request, response, logger, ["id", "occurrenceId"]);
    if (!input) return;
    const run = await store.startRoutineRun(request.user!.id, {
      id: normalizeRoutineRunId(input.id),
      routineId,
      occurrenceId: input.occurrenceId === undefined || input.occurrenceId === null
        ? null : normalizeRoutineOccurrenceId(input.occurrenceId),
      startedAt: new Date().toISOString()
    } as StartRoutineRunCommand);
    if (!run) { sendRoutineError(response, 404, "routine_not_found"); return; }
    logger.info("life_links.routine.run_started", {
      msg: "Owner Routine Run started or resumed", ...requestLogFields(request), routine_id: run.routineId,
      routine_revision_id: run.routineRevisionId, routine_run_id: run.id, occurrence_id: run.occurrenceId,
      routine_run_status: run.status
    });
    response.status(201).json({ run });
  });

  app.get("/api/routine-runs/:runId", requireAuthenticated, async (request: AppRequest, response) => {
    const run = await store.getRoutineRun(request.user!.id, normalizeRoutineRunId(paramValue(request.params.runId)));
    if (!run) { sendRoutineError(response, 404, "routine_not_found", { reason: "run_not_found" }); return; }
    response.json({ run });
  });

  app.put("/api/routine-runs/:runId/step-results/:routineStepId", requireAuthenticated, async (request: AppRequest, response) => {
    const input = readRoutineBody(request, response, logger, [
      "expectedUpdatedAt", "actualValues", "proposedNextValues", "notes"
    ]);
    if (!input) return;
    const run = await store.putRoutineRunStepResult(request.user!.id, {
      runId: normalizeRoutineRunId(paramValue(request.params.runId)),
      routineStepId: normalizeRoutineStepId(paramValue(request.params.routineStepId)),
      expectedUpdatedAt: routineExpectedTimestamp(input.expectedUpdatedAt),
      actualValues: normalizeRoutineValues(input.actualValues),
      proposedNextValues: normalizeRoutineValues(input.proposedNextValues),
      ...(input.notes === undefined ? {} : { notes: input.notes })
    } as PutRoutineRunStepResultCommand);
    if (!run) { sendRoutineError(response, 404, "routine_not_found", { reason: "run_not_found" }); return; }
    logger.info("life_links.routine.run_result_recorded", {
      msg: "Owner Routine Run Step result recorded", ...requestLogFields(request), routine_id: run.routineId,
      routine_run_id: run.id, routine_step_id: normalizeRoutineStepId(paramValue(request.params.routineStepId)),
      routine_run_status: run.status
    });
    response.json({ run });
  });

  app.post("/api/routine-runs/:runId/finalize", requireAuthenticated, async (request: AppRequest, response) => {
    const runId = normalizeRoutineRunId(paramValue(request.params.runId));
    const input = readRoutineBody(request, response, logger, ["sessionId", "expectedUpdatedAt"]);
    if (!input) return;
    const finalized = await store.finalizeRoutineRun(request.user!.id, {
      runId,
      sessionId: normalizeRoutineSessionId(input.sessionId),
      expectedUpdatedAt: routineExpectedTimestamp(input.expectedUpdatedAt),
      completedAt: new Date().toISOString()
    } as FinalizeRoutineRunCommand);
    if (!finalized) { sendRoutineError(response, 404, "routine_not_found", { reason: "run_not_found" }); return; }
    const session = await store.getRoutineSession(request.user!.id, finalized.session.id);
    if (!session) { sendRoutineError(response, 404, "routine_not_found", { reason: "session_not_found" }); return; }
    logger.info("life_links.routine.run_finalized", {
      msg: "Owner Routine Run finalized", ...requestLogFields(request), routine_id: finalized.session.routineId,
      routine_revision_id: finalized.session.routineRevisionId, routine_run_id: finalized.finalizedRun.id,
      routine_session_id: finalized.session.id, routine_run_status: finalized.finalizedRun.status
    });
    response.status(201).json({ run: finalized.finalizedRun, session });
  });

  app.get("/api/routine-sessions", requireAuthenticated, async (request: AppRequest, response) => {
    const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
    if (!page) return;
    const routineIdValue = request.query.routineId;
    if (routineIdValue !== undefined && typeof routineIdValue !== "string") {
      sendRoutineError(response, 400, "invalid_routine", { reason: "invalid_routine_id" }); return;
    }
    const routineId = routineIdValue === undefined ? null : normalizeRoutineId(routineIdValue);
    const result = await store.listRoutineSessions(request.user!.id, routineId, page);
    const sessions = await Promise.all(result.items.map((item) => store.getRoutineSession(request.user!.id, item.id)));
    response.json({ sessions: sessions.filter((item) => item !== null), nextCursor: result.nextCursor, truncated: result.truncated });
  });

  app.get("/api/routine-sessions/:sessionId", requireAuthenticated, async (request: AppRequest, response) => {
    const session = await store.getRoutineSession(request.user!.id, normalizeRoutineSessionId(paramValue(request.params.sessionId)));
    if (!session) { sendRoutineError(response, 404, "routine_not_found", { reason: "session_not_found" }); return; }
    response.json({ session });
  });

  app.post("/api/routine-sessions/:sessionId/amendments", requireAuthenticated, async (request: AppRequest, response) => {
    const sessionId = normalizeRoutineSessionId(paramValue(request.params.sessionId));
    const input = readRoutineBody(request, response, logger, [
      "id", "stepResultId", "note", "correctedActualValues", "correctedProposedNextValues"
    ]);
    if (!input) return;
    const amendment = await store.appendRoutineSessionAmendment(request.user!.id, {
      ...input,
      id: normalizeRoutineSessionAmendmentId(input.id),
      sessionId,
      createdAt: new Date().toISOString()
    } as unknown as AppendRoutineSessionAmendmentCommand);
    if (!amendment) { sendRoutineError(response, 404, "routine_not_found", { reason: "session_not_found" }); return; }
    const session = await store.getRoutineSession(request.user!.id, sessionId);
    if (!session) { sendRoutineError(response, 404, "routine_not_found", { reason: "session_not_found" }); return; }
    logger.info("life_links.routine.session_amendment_appended", {
      msg: "Owner Routine Session Amendment appended", ...requestLogFields(request),
      routine_session_id: sessionId, routine_session_amendment_id: amendment.id,
      routine_session_result_id: amendment.stepResultId
    });
    response.status(201).json({ amendment, session });
  });

  app.get("/api/links", requireAuthenticated, async (request: AppRequest, response) => {
    response.json({ links: await store.listLinks(request.user!.id) });
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
    const mimeType = resolveAttachmentMimeType(file.mimetype, file.originalname);
    const kind = mimeType ? ATTACHMENT_MIME_TYPES[mimeType] : null;
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
      mimeType: mimeType!,
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
    if (deleted) attachmentReader.invalidate([], mediaId);
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
    response.setHeader("Content-Disposition", mediaContentDisposition(mediaFile.media.fileName, mediaFile.media.kind));
    response.setHeader("Content-Length", String(mediaFile.data.length));
    response.type(mediaFile.media.mimeType).send(mediaFile.data);
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
    if (error instanceof ClaimIdempotencyConflictError) {
      logger.warn("life_links.qr.idempotency_conflict", { msg: "QR command identity reused with different arguments",
        ...requestLogFields(request as AppRequest), status: 409 });
      response.status(409).json({ error: "idempotency_key_conflict" });
      return;
    }
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

function readRoutineBody(
  request: AppRequest,
  response: Response,
  logger: Logger,
  fields: readonly string[]
): Record<string, unknown> | undefined {
  const input = readObjectBody(request, response, logger);
  return input && validateObjectFields(request, response, logger, input, fields) ? input : undefined;
}

function readRoutineRevisionMutation(
  request: AppRequest,
  response: Response,
  logger: Logger,
  fields: readonly string[]
): (Record<string, unknown> & { expectedUpdatedAt: string }) | undefined {
  const input = readRoutineBody(request, response, logger, [...fields, "expectedUpdatedAt"]);
  if (!input) return undefined;
  const expectedUpdatedAt = validateExpectedUpdatedAt(request, response, logger, input.expectedUpdatedAt);
  return expectedUpdatedAt === undefined ? undefined : { ...input, expectedUpdatedAt };
}

function readRoutinePageQuery(
  request: AppRequest,
  response: Response,
  logger: Logger
): RoutinePageRequest | undefined {
  const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
  if (!page) return undefined;
  const includeArchivedValue = request.query.includeArchived;
  if (includeArchivedValue === undefined) return page;
  if (includeArchivedValue !== "true" && includeArchivedValue !== "false") {
    rejectValidation(request, response, logger, "include_archived", "invalid_include_archived");
    return undefined;
  }
  return { ...page, includeArchived: includeArchivedValue === "true" };
}

function readRoutineOccurrencePageQuery(
  request: AppRequest,
  response: Response,
  logger: Logger
): RoutineOccurrencePageRequest | undefined {
  const page = readLifeLinkPageQuery(request, response, logger, MAX_LIFE_LINK_CHILD_PAGE_LIMIT);
  if (!page) return undefined;
  const routineIdValue = request.query.routineId;
  const startDateValue = request.query.startDate;
  const endDateValue = request.query.endDate;
  if (routineIdValue !== undefined && typeof routineIdValue !== "string") {
    rejectValidation(request, response, logger, "routine_id", "invalid_routine_id"); return undefined;
  }
  const startDate = startDateValue === undefined ? undefined : normalizeRoutineLocalDate(startDateValue);
  const endDate = endDateValue === undefined ? undefined : normalizeRoutineLocalDate(endDateValue);
  return {
    ...page,
    ...(routineIdValue === undefined ? {} : { routineId: normalizeRoutineId(routineIdValue) }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate })
  };
}

function routineDefinitionWithStableIds(input: Record<string, unknown>, revisionId: string): Record<string, unknown> {
  if (!Array.isArray(input.steps) || (input.bindings !== undefined && !Array.isArray(input.bindings))) {
    throw new LifeLinkDomainError("invalid_routine", "Routine definition Steps and bindings are invalid.", {
      reason: "invalid_definition"
    });
  }
  const steps = input.steps.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LifeLinkDomainError("invalid_routine", "Routine Step is invalid.", { reason: "invalid_step" });
    }
    const step = value as Record<string, unknown>;
    return { ...step, id: normalizeRoutineStepId(step.id ?? stableRoutineNestedId("routine-step-", revisionId, "step", index)) };
  });
  const bindings = (input.bindings as unknown[] | undefined)?.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LifeLinkDomainError("invalid_routine", "Routine context binding is invalid.", { reason: "invalid_binding" });
    }
    const binding = value as Record<string, unknown>;
    return {
      ...binding,
      id: normalizeRoutineBindingId(binding.id ?? stableRoutineNestedId("routine-binding-", revisionId, "binding", index))
    };
  });
  const { id: _id, revisionId: _revisionId, expectedCurrentRevisionId: _expectedRevision, ...definition } = input;
  return { ...definition, steps, ...(bindings === undefined ? {} : { bindings }) };
}

function stableRoutineNestedId(prefix: "routine-step-" | "routine-binding-", revisionId: string, kind: string, index: number): string {
  const hex = createHash("sha256").update(`${revisionId}\u0000${kind}\u0000${index}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const uuid = `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
  return `${prefix}${uuid}`;
}

function routineExpectedTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LifeLinkDomainError("invalid_routine", "Routine expected revision timestamp is invalid.", {
      reason: "invalid_expected_updated_at"
    });
  }
  return value;
}

async function materializeRoutineScheduleWindow(
  store: LifeLinksStore,
  userId: string,
  schedule: RoutineScheduleRecord
): Promise<void> {
  if (!schedule.active) return;
  const [startDate, endDate] = nearTermRoutineWindow(schedule.rule);
  if (endDate < startDate) return;
  await store.materializeRoutineOccurrences(userId, schedule.routineId, { startDate, endDate });
}

function nearTermRoutineWindow(rule: RoutineScheduleRule): [string, string] {
  if (rule.kind === "once") return [rule.localDate, rule.localDate];
  const today = localIsoDate(new Date(), rule.timeZone);
  const startDate = today < rule.startDate ? rule.startDate : today;
  const horizon = addRoutineIsoDays(startDate, 60);
  const endDate = rule.endDate !== null && rule.endDate < horizon ? rule.endDate : horizon;
  return [startDate, endDate];
}

function localIsoDate(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addRoutineIsoDays(value: string, days: number): string {
  return new Date(`${value}T00:00:00.000Z`).getTime() + days * 86_400_000 > 0
    ? new Date(new Date(`${value}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
    : value;
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

function readRevisionMutation(request: AppRequest, response: Response, logger: Logger, fields: string[]):
  (Record<string, unknown> & { expectedUpdatedAt: string }) | undefined {
  const input = readObjectBody(request, response, logger);
  if (!input || !validateObjectFields(request, response, logger, input, [...fields, "expectedUpdatedAt"])) return undefined;
  const expectedUpdatedAt = validateExpectedUpdatedAt(request, response, logger, input.expectedUpdatedAt);
  return expectedUpdatedAt === undefined ? undefined : { ...input, expectedUpdatedAt };
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
  qr_not_found: "QR was not found.",
  life_link_already_tagged: "Life Link already has a QR tag.",
  invalid_collection: "Collection request is invalid.",
  collection_not_found: "Collection was not found.",
  stale_collection: "Collection changed after it was read.",
  duplicate_collection_id: "Collection identity is already in use.",
  section_not_found: "Section was not found.",
  invalid_section: "Section request is invalid.",
  duplicate_section_id: "Section identity is already in use.",
  collection_membership_not_found: "Collection membership was not found.",
  invalid_routine: "Routine request is invalid.",
  routine_not_found: "Routine resource was not found.",
  stale_routine: "Routine state changed after it was read.",
  routine_conflict: "Routine operation conflicts with its current state.",
  routine_reference_conflict: "Routine references conflict with owner state.",
  output_limit_exceeded: "Life Link result exceeds the supported limit."
};

function canonicalLifeLinkErrorStatus(code: LifeLinkDomainErrorCode): number {
  if (["life_link_not_found", "qr_not_found", "collection_not_found", "section_not_found", "collection_membership_not_found"].includes(code)) {
    return 404;
  }
  if (code === "routine_not_found") return 404;
  if (
    code === "duplicate_life_link_id" ||
    code === "invalid_parent" ||
    code === "hierarchy_cycle" ||
    code === "stale_life_link" ||
    code === "qr_already_bound" ||
    code === "life_link_already_tagged" ||
    code === "stale_collection" ||
    code === "duplicate_collection_id" ||
    code === "duplicate_section_id" ||
    code === "stale_routine" ||
    code === "routine_conflict" ||
    code === "routine_reference_conflict"
  ) {
    return 409;
  }
  return 400;
}

type RoutinePublicErrorCode =
  | "invalid_routine"
  | "routine_not_found"
  | "stale_routine"
  | "routine_conflict"
  | "routine_reference_conflict";

function sendRoutineError(
  response: Response,
  status: number,
  code: RoutinePublicErrorCode,
  options: { retryable?: boolean; reason?: string } = {}
): void {
  sendCanonicalLifeLinkError(response, status, code, {
    retryable: code === "stale_routine" ? true : options.retryable,
    reason: options.reason
  });
}

function isRoutineRoute(pathname: string): boolean {
  return /^\/api\/(?:routines(?:\/|$)|routine-(?:groups|activities|schedules|occurrences|runs|sessions)(?:\/|$))/.test(pathname);
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

  const isCanonicalRoute = request.path === "/api/life-links" || request.path.startsWith("/api/life-links/") ||
    request.path === "/api/collections" || request.path.startsWith("/api/collections/") || isRoutineRoute(request.path);
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
  logger.warn(isRoutineRoute(request.path) ? "life_links.routine.request_rejected" : "life_links.life_link.request_rejected", {
    msg: isRoutineRoute(request.path) ? "Owner Routine request rejected" : "Canonical Life Link request rejected",
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
  if (request.path === "/api/collections" || request.path.startsWith("/api/collections/")) {
    sendCanonicalLifeLinkError(response, 400, "invalid_collection", { reason: error });
    return;
  }
  if (isRoutineRoute(request.path)) {
    sendRoutineError(response, 400, "invalid_routine", { reason: error });
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

function validChangeCommandField(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;
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

function mediaContentDisposition(fileName: string, kind: string): string {
  const safeFileName = sanitizeFileName(fileName).replace(/(["\\])/g, "\\$1");
  return `${kind === "document" ? "attachment" : "inline"}; filename="${safeFileName}"`;
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
    competition_fixture_profile: COMPETITION_FIXTURE_PROFILE,
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
