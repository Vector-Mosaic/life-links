import { randomUUID } from "node:crypto";

import {
  type ClaimResult,
  type ExportBatchRecord,
  type LinkBodyDoc,
  type LinkMediaKind,
  type LinkMediaRecord,
  type LinkRecord,
  type PrivacyStatus,
  type ProjectRecord,
  type QrRecord,
  type QrViewState,
  type UserRecord,
  LINK_BODY_DOC_VERSION,
  buildQrUrl,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  generateQrIds,
  MAX_MEDIA_PER_LINK,
  normalizeBatchCount
} from "@life-links/core";

import { hashPassword } from "./password.js";

export type StoredUser = UserRecord & {
  passwordHash: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type LinkPatch = {
  title?: string;
  body?: string;
  bodyDoc?: LinkBodyDoc | null;
  bodyDocVersion?: number | null;
  privacy?: PrivacyStatus;
  projectId?: string | null;
};

export type LinkMediaInput = {
  kind: LinkMediaKind;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  data: Buffer;
};

export type LinkMediaFile = {
  media: LinkMediaRecord;
  data: Buffer;
  viewerIsOwner: boolean;
};

export type BatchCreateResult = {
  batch: ExportBatchRecord;
  qrCodes: LinkRecord[];
};

export type ClaimOutcome = {
  result: ClaimResult;
  state: QrViewState;
  replayed?: boolean;
};

export class ClaimIdempotencyConflictError extends Error {
  constructor() {
    super("claim idempotency key is already bound to another request");
    this.name = "ClaimIdempotencyConflictError";
  }
}

export type FindScanResult = {
  targetQrId: string;
  scannedQrId: string | null;
  match: boolean;
};

export type LifeLinksStore = {
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserById(userId: string): Promise<StoredUser | null>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  listLinks(userId: string): Promise<LinkRecord[]>;
  listProjects(userId: string): Promise<ProjectRecord[]>;
  createProject(userId: string, name: string): Promise<ProjectRecord>;
  createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult>;
  listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]>;
  getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState>;
  claimQr(qrId: string, userId: string, commandId: string): Promise<ClaimOutcome>;
  updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null>;
  createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null>;
  deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean>;
  getLinkMedia(qrId: string, mediaId: string, viewerUserId: string | null): Promise<LinkMediaFile | "private" | null>;
  seedDemo(password: string, qrBaseUrl: string): Promise<void>;
  checkReady(): Promise<void>;
  close(): Promise<void>;
};

type ClaimEventRecord = {
  commandId: string;
  qrId: string;
  ownerId: string;
  result: ClaimResult;
  createdAt: string;
};

type StoredLinkMedia = LinkMediaRecord & {
  data: Buffer;
};

export class InMemoryLifeLinksStore implements LifeLinksStore {
  private users = new Map<string, StoredUser>();
  private userIdsByEmail = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private projects = new Map<string, ProjectRecord>();
  private qrCodes = new Map<string, QrRecord>();
  private links = new Map<string, LinkRecord>();
  private media = new Map<string, StoredLinkMedia>();
  private batches = new Map<string, ExportBatchRecord>();
  private batchQrIds = new Map<string, string[]>();
  private claimEvents = new Map<string, ClaimEventRecord>();

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const userId = this.userIdsByEmail.get(email.toLowerCase());
    return userId ? this.users.get(userId) ?? null : null;
  }

  async getUserById(userId: string): Promise<StoredUser | null> {
    return this.users.get(userId) ?? null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(tokenHash, session);
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) {
      return null;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const user = this.users.get(session.userId);
    return user ? { ...session, user } : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async listLinks(userId: string): Promise<LinkRecord[]> {
    const owned = Array.from(this.links.values())
      .filter((link) => link.ownerId === userId)
      .map((link) => this.withMedia(link));
    const ownedBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((batch) => batch.createdBy === userId)
        .map((batch) => batch.id)
    );
    const unclaimed = Array.from(this.qrCodes.values())
      .filter((qr) => qr.status === "unclaimed" && qr.batchId && ownedBatchIds.has(qr.batchId))
      .map((qr) => linkFromQr(qr));
    return [...owned, ...unclaimed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    return Array.from(this.projects.values())
      .filter((project) => project.ownerId === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createProject(userId: string, name: string): Promise<ProjectRecord> {
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: `project-${randomUUID()}`,
      ownerId: userId,
      name,
      createdAt: now
    };
    this.projects.set(project.id, project);
    return project;
  }

  async createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult> {
    const now = new Date().toISOString();
    const safeCount = normalizeBatchCount(count);
    const batchKey = createUniqueBatchKey(this.batches);
    const ids = createUniqueQrIds(safeCount, batchKey, this.qrCodes);
    const batch: ExportBatchRecord = {
      id: `batch-${randomUUID()}`,
      batchKey,
      qrBaseUrl,
      count: ids.length,
      createdBy: userId,
      createdAt: now
    };
    this.batches.set(batch.id, batch);
    this.batchQrIds.set(batch.id, ids);
    for (const id of ids) {
      this.qrCodes.set(id, {
        id,
        url: buildQrUrl(qrBaseUrl, id),
        status: "unclaimed",
        batchId: batch.id,
        createdAt: now,
        claimedAt: null
      });
    }
    return { batch, qrCodes: ids.map((id) => linkFromQr(this.qrCodes.get(id)!)) };
  }

  async listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.createdBy !== userId) {
      return [];
    }
    return (this.batchQrIds.get(batchId) ?? [])
      .map((id) => this.withMedia(this.links.get(id) ?? linkFromQr(this.qrCodes.get(id)!)))
      .filter(Boolean);
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    return this.buildQrState(qrId, viewerUserId);
  }

  async claimQr(qrId: string, userId: string, commandId: string): Promise<ClaimOutcome> {
    const existingEvent = this.claimEvents.get(commandId);
    if (existingEvent) {
      if (existingEvent.qrId !== qrId || existingEvent.ownerId !== userId) {
        throw new ClaimIdempotencyConflictError();
      }
      return {
        result: existingEvent.result,
        state: await this.buildQrState(existingEvent.qrId, userId),
        replayed: true
      };
    }

    const qr = this.qrCodes.get(qrId);
    let result: ClaimResult = "not_found";
    if (!qr) {
      result = "not_found";
    } else {
      const existingLink = this.links.get(qrId);
      if (existingLink?.ownerId === userId) {
        result = "already_owned";
      } else if (existingLink?.ownerId && existingLink.ownerId !== userId) {
        result = "owned_by_other";
      } else {
        const now = new Date().toISOString();
        const claimedQr: QrRecord = { ...qr, status: "claimed", claimedAt: now };
        const link: LinkRecord = {
          id: qr.id,
          url: qr.url,
          status: "claimed",
          ownerId: userId,
          title: "Untitled link",
          body: "",
          bodyDoc: createLinkBodyDocFromPlainText(""),
          bodyDocVersion: LINK_BODY_DOC_VERSION,
          projectId: null,
          privacy: "public",
          media: [],
          createdAt: qr.createdAt,
          updatedAt: now
        };
        this.qrCodes.set(qrId, claimedQr);
        this.links.set(qrId, link);
        result = "claimed";
      }
    }

    this.claimEvents.set(commandId, {
      commandId,
      qrId,
      ownerId: userId,
      result,
      createdAt: new Date().toISOString()
    });
    return {
      result,
      state: await this.buildQrState(qrId, userId),
      replayed: false
    };
  }

  async updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null> {
    const link = this.links.get(qrId);
    if (!link || link.ownerId !== userId) {
      return null;
    }
    if (patch.projectId) {
      const project = this.projects.get(patch.projectId);
      if (!project || project.ownerId !== userId) {
        return null;
      }
    }
    const next: LinkRecord = {
      ...link,
      title: patch.title ?? link.title,
      body: patch.body ?? link.body,
      bodyDoc: patch.bodyDoc === undefined ? link.bodyDoc ?? createLinkBodyDocFromPlainText(patch.body ?? link.body) : patch.bodyDoc,
      bodyDocVersion:
        patch.bodyDocVersion === undefined ? link.bodyDocVersion ?? LINK_BODY_DOC_VERSION : patch.bodyDocVersion,
      privacy: patch.privacy ?? link.privacy,
      projectId: patch.projectId === undefined ? link.projectId : patch.projectId,
      updatedAt: new Date().toISOString()
    };
    this.links.set(qrId, { ...next, media: [] });
    return this.withMedia(next);
  }

  async createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null> {
    const link = this.links.get(qrId);
    if (!link || link.ownerId !== userId) {
      return null;
    }
    if (this.mediaForQr(qrId).length >= MAX_MEDIA_PER_LINK) {
      return null;
    }
    const now = new Date().toISOString();
    const mediaId = `media-${randomUUID()}`;
    const media: StoredLinkMedia = {
      id: mediaId,
      qrId,
      ownerId: userId,
      kind: input.kind,
      mimeType: input.mimeType,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      url: mediaUrl(qrId, mediaId),
      createdAt: now,
      data: input.data
    };
    this.media.set(media.id, media);
    return publicMedia(media);
  }

  async deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean> {
    const media = this.media.get(mediaId);
    if (!media || media.qrId !== qrId || media.ownerId !== userId) {
      return false;
    }
    this.media.delete(mediaId);
    return true;
  }

  async getLinkMedia(qrId: string, mediaId: string, viewerUserId: string | null): Promise<LinkMediaFile | "private" | null> {
    const media = this.media.get(mediaId);
    const link = this.links.get(qrId);
    if (!media || media.qrId !== qrId || !link) {
      return null;
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === link.ownerId);
    if (link.privacy === "private" && !viewerIsOwner) {
      return "private";
    }
    return { media: publicMedia(media), data: media.data, viewerIsOwner };
  }

  async seedDemo(password: string, qrBaseUrl: string): Promise<void> {
    const data = createDemoSeedData(new Date().toISOString(), qrBaseUrl);
    const batchId = "batch-demo-seed";
    for (const user of data.users) {
      if (!this.users.has(user.id)) {
        const passwordHash = await hashPassword(password);
        this.users.set(user.id, {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          createdAt: user.createdAt,
          passwordHash
        });
        this.userIdsByEmail.set(user.email.toLowerCase(), user.id);
      }
    }
    for (const project of data.projects) {
      if (!this.projects.has(project.id)) {
        this.projects.set(project.id, project);
      }
    }
    if (!this.batches.has(batchId)) {
      this.batches.set(batchId, {
        id: batchId,
        batchKey: "DEMO",
        qrBaseUrl,
        count: data.links.length,
        createdBy: data.users[0].id,
        createdAt: data.links[0]?.createdAt ?? new Date().toISOString()
      });
      this.batchQrIds.set(batchId, data.links.map((link) => link.id));
    }
    for (const link of data.links) {
      if (!this.qrCodes.has(link.id)) {
        this.qrCodes.set(link.id, {
          id: link.id,
          url: link.url,
          status: link.status,
          batchId,
          createdAt: link.createdAt,
          claimedAt: link.status === "claimed" ? link.updatedAt : null
        });
      }
      if (link.status === "claimed" && !this.links.has(link.id)) {
        this.links.set(link.id, link);
      }
    }
  }

  async checkReady(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  private async buildQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const qr = this.qrCodes.get(qrId);
    if (!qr) {
      return { state: "not_found", qrId };
    }
    const link = this.links.get(qrId);
    if (!link) {
      return { state: "unclaimed", qr: linkFromQr(qr) };
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === link.ownerId);
    if (link.privacy === "private" && !viewerIsOwner) {
      return { state: "private", qrId };
    }
    return { state: "claimed", link: this.withMedia(link), viewerIsOwner };
  }

  private mediaForQr(qrId: string): LinkMediaRecord[] {
    return Array.from(this.media.values())
      .filter((media) => media.qrId === qrId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(publicMedia);
  }

  private withMedia(link: LinkRecord): LinkRecord {
    return { ...link, media: this.mediaForQr(link.id) };
  }
}

function linkFromQr(qr: QrRecord): LinkRecord {
  return {
    id: qr.id,
    url: qr.url,
    status: qr.status,
    ownerId: null,
    title: "",
    body: "",
    bodyDoc: createLinkBodyDocFromPlainText(""),
    bodyDocVersion: LINK_BODY_DOC_VERSION,
    projectId: null,
    privacy: "public",
    media: [],
    createdAt: qr.createdAt,
    updatedAt: qr.claimedAt ?? qr.createdAt
  };
}

function mediaUrl(qrId: string, mediaId: string): string {
  return `/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`;
}

function publicMedia(media: StoredLinkMedia): LinkMediaRecord {
  const { data: _data, ...record } = media;
  return record;
}

function createUniqueBatchKey(batches: Map<string, ExportBatchRecord>): string {
  const known = new Set(Array.from(batches.values()).map((batch) => batch.batchKey));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const batchKey = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    if (!known.has(batchKey)) {
      return batchKey;
    }
  }
  return randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
}

function createUniqueQrIds(count: number, batchKey: string, qrCodes: Map<string, QrRecord>): string[] {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ids = generateQrIds(count, attempt === 0 ? batchKey : `${batchKey}${attempt}`);
    if (ids.every((id) => !qrCodes.has(id))) {
      return ids;
    }
  }
  throw new Error("Unable to generate a unique QR batch");
}
