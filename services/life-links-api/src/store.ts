import { randomUUID } from "node:crypto";

import {
  type ClaimQrCommand,
  type ClaimResult,
  type CompetitionFixtureData,
  type CreateLifeLinkCommand,
  type ExportBatchRecord,
  type LifeLinkDetail,
  LifeLinkDomainError,
  type LifeLinkMediaRecord,
  type LifeLinkPage,
  type LifeLinkPageRequest,
  type LifeLinkProjectCompatibilityRecord,
  type LifeLinkQrBindingRecord,
  type LifeLinkRecord,
  type LifeLinkSearchResult,
  type LifeLinkSummary,
  type LinkBodyDoc,
  type LinkMediaKind,
  type LinkMediaRecord,
  type LinkRecord,
  type MoveLifeLinkCommand,
  type PrivacyStatus,
  type ProjectRecord,
  type QrInventoryRecord,
  type QrViewState,
  type UpdateLifeLinkCommand,
  type UserRecord,
  LINK_BODY_DOC_VERSION,
  MAX_MEDIA_PER_LINK,
  MAX_PROJECT_NAME_LENGTH,
  assertLifeLinkMediaBytes,
  assertLifeLinkBodyPatchIsCoordinated,
  assertLifeLinkContentWithinBounds,
  assertValidLifeLinkParentPlacement,
  buildQrUrl,
  coordinateLifeLinkBody,
  createCanonicalLifeLink,
  createCompetitionFixtureData,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  deriveProjectCompatibilityId,
  generateQrIds,
  mapLegacyLinkToLifeLinkId,
  normalizeBatchCount,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectLifeLinkAsProject,
  projectPrivateClaimedQrAsLink,
  projectUnclaimedQrAsLink,
  redactNonOwnerLinkProjection,
  searchCanonicalLifeLinks,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_OWNER_ID
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

export type LifeLinkMediaFile = {
  media: LifeLinkMediaRecord;
  data: Buffer;
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

export type CompetitionFixtureResetMode = "dry-run" | "apply";

export type CompetitionFixtureResetOptions = {
  password: string;
  qrBaseUrl: string;
  mode?: CompetitionFixtureResetMode;
};

export type CompetitionFixtureCounts = {
  users: number;
  sessions: number;
  lifeLinks: number;
  qrBindings: number;
  projectCompatibility: number;
  media: number;
  batches: number;
  qrCodes: number;
  claimEvents: number;
};

export type CompetitionFixtureResetReport = {
  profile: string;
  ownerId: string;
  mode: CompetitionFixtureResetMode;
  applied: boolean;
  before: CompetitionFixtureCounts;
  after: CompetitionFixtureCounts;
  expected: CompetitionFixtureCounts;
};

/**
 * Canonical ownership lives in the recursive Life Link methods. The legacy
 * Project/Link/QR methods are compatibility projections used by the current
 * HTTP surface and must not grow an independent persistence path.
 */
export type LifeLinksStore = {
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserById(userId: string): Promise<StoredUser | null>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;

  listLifeLinks(userId: string, parentId: string | null, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkSummary>>;
  getLifeLinkDetail(userId: string, lifeLinkId: string, page?: LifeLinkPageRequest): Promise<LifeLinkDetail | null>;
  searchLifeLinks(
    userId: string,
    query: string,
    options?: { cursor?: string | null; limit?: number | string; maxLimit?: number }
  ): Promise<LifeLinkSearchResult>;
  createLifeLink(command: CreateLifeLinkCommand): Promise<LifeLinkRecord>;
  updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null>;
  moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null>;
  createLifeLinkMedia(userId: string, lifeLinkId: string, input: LinkMediaInput): Promise<LifeLinkMediaRecord | null>;
  deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean>;
  getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null>;

  listLinks(userId: string): Promise<LinkRecord[]>;
  listProjects(userId: string): Promise<ProjectRecord[]>;
  createProject(userId: string, name: string): Promise<ProjectRecord>;
  createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult>;
  listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]>;
  getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState>;
  claimQr(qrId: string, userId: string, command: string | ClaimQrCommand): Promise<ClaimOutcome>;
  updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null>;
  createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null>;
  deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean>;
  getLinkMedia(qrId: string, mediaId: string, viewerUserId: string | null): Promise<LinkMediaFile | "private" | null>;
  seedDemo(password: string, qrBaseUrl: string): Promise<void>;
  resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport>;
  checkReady(): Promise<void>;
  close(): Promise<void>;
};

type StoredLifeLink = Omit<LifeLinkRecord, "qrId" | "media">;

type ClaimEventRecord = {
  commandId: string;
  qrId: string;
  ownerId: string;
  mode: "create" | "attach";
  requestedLifeLinkId: string | null;
  resolvedLifeLinkId: string | null;
  result: ClaimResult;
  createdAt: string;
};

type StoredLifeLinkMedia = Omit<LifeLinkMediaRecord, "url"> & {
  data: Buffer;
};

type InMemoryStoreSnapshot = {
  users: Map<string, StoredUser>;
  userIdsByEmail: Map<string, string>;
  sessions: Map<string, SessionRecord>;
  lifeLinks: Map<string, StoredLifeLink>;
  qrInventory: Map<string, QrInventoryRecord>;
  qrBindings: Map<string, LifeLinkQrBindingRecord>;
  projectCompatibility: Map<string, LifeLinkProjectCompatibilityRecord>;
  media: Map<string, StoredLifeLinkMedia>;
  batches: Map<string, ExportBatchRecord>;
  batchQrIds: Map<string, string[]>;
  claimEvents: Map<string, ClaimEventRecord>;
};

export class InMemoryLifeLinksStore implements LifeLinksStore {
  private users = new Map<string, StoredUser>();
  private userIdsByEmail = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private lifeLinks = new Map<string, StoredLifeLink>();
  private qrInventory = new Map<string, QrInventoryRecord>();
  private qrBindings = new Map<string, LifeLinkQrBindingRecord>();
  private projectCompatibility = new Map<string, LifeLinkProjectCompatibilityRecord>();
  private media = new Map<string, StoredLifeLinkMedia>();
  private batches = new Map<string, ExportBatchRecord>();
  private batchQrIds = new Map<string, string[]>();
  private claimEvents = new Map<string, ClaimEventRecord>();
  private ownerLocks = new Map<string, Promise<void>>();

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

  async listLifeLinks(
    userId: string,
    parentId: string | null,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<LifeLinkSummary>> {
    return pageLifeLinkChildren(this.hydrateOwnerLifeLinks(userId), userId, parentId, page);
  }

  async getLifeLinkDetail(
    userId: string,
    lifeLinkId: string,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkDetail | null> {
    const lifeLinks = this.hydrateOwnerLifeLinks(userId);
    const lifeLink = lifeLinks.find((item) => item.id === lifeLinkId);
    if (!lifeLink) {
      return null;
    }
    const children = pageLifeLinkChildren(lifeLinks, userId, lifeLinkId, page);
    return {
      lifeLink,
      ancestry: deriveLifeLinkPath(lifeLinks, lifeLinkId),
      children: children.items,
      childrenPage: { nextCursor: children.nextCursor, truncated: children.truncated }
    };
  }

  async searchLifeLinks(
    userId: string,
    query: string,
    options: { cursor?: string | null; limit?: number | string; maxLimit?: number } = {}
  ): Promise<LifeLinkSearchResult> {
    return searchCanonicalLifeLinks(this.hydrateOwnerLifeLinks(userId), userId, query, options);
  }

  async createLifeLink(command: CreateLifeLinkCommand): Promise<LifeLinkRecord> {
    return this.withLocks([`life-link-id:${command.id}`, command.ownerId], async () => {
      const candidate = createCanonicalLifeLink(command);
      const existing = this.lifeLinks.get(candidate.id);
      if (existing) {
        if (sameStoredLifeLink(existing, candidate)) {
          return this.hydrateLifeLink(existing);
        }
        throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identity is already bound to another record.");
      }
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(command.ownerId);
      assertValidLifeLinkParentPlacement([...ownerLifeLinks, candidate], candidate.id, candidate.parentId);
      this.lifeLinks.set(candidate.id, withoutLifeLinkRelations(candidate));
      return this.hydrateLifeLink(this.lifeLinks.get(candidate.id)!);
    });
  }

  async updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      assertFresh(current, command.expectedUpdatedAt);
      assertLifeLinkBodyPatchIsCoordinated(command.patch);
      const body =
        command.patch.body === undefined && command.patch.bodyDoc === undefined
          ? { body: current.body, bodyDoc: current.bodyDoc, bodyDocVersion: current.bodyDocVersion }
          : coordinateLifeLinkBody({
              body: command.patch.body,
              bodyDoc: command.patch.bodyDoc,
              bodyDocVersion: command.patch.bodyDocVersion
            });
      const title = command.patch.title ?? current.title;
      assertLifeLinkContentWithinBounds(title, body.body, body.bodyDoc);
      if (
        title.length > MAX_PROJECT_NAME_LENGTH &&
        Array.from(this.projectCompatibility.values()).some((marker) => marker.lifeLinkId === current.id)
      ) {
        throw new LifeLinkDomainError("invalid_life_link", "Project compatibility title exceeds the supported limit.", {
          reason: "project_title_too_long"
        });
      }
      const next: StoredLifeLink = {
        ...current,
        title,
        ...body,
        privacy: command.patch.privacy ?? current.privacy,
        updatedAt: nextTimestamp(current.updatedAt)
      };
      this.lifeLinks.set(next.id, next);
      return this.hydrateLifeLink(next);
    });
  }

  async moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withOwnerLock(userId, async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      assertFresh(current, command.expectedUpdatedAt);
      if (
        command.parentId !== null &&
        Array.from(this.projectCompatibility.values()).some((marker) => marker.lifeLinkId === current.id)
      ) {
        throw new LifeLinkDomainError("invalid_parent", "Project-compatible Life Link must remain a root.", {
          reason: "project_compatibility_root"
        });
      }
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(userId);
      assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, command.parentId);
      const next: StoredLifeLink = {
        ...current,
        parentId: command.parentId,
        updatedAt: nextTimestamp(current.updatedAt)
      };
      this.lifeLinks.set(next.id, next);
      return this.hydrateLifeLink(next);
    });
  }

  async createLifeLinkMedia(
    userId: string,
    lifeLinkId: string,
    input: LinkMediaInput
  ): Promise<LifeLinkMediaRecord | null> {
    assertLifeLinkMediaBytes(input.sizeBytes, input.data.byteLength);
    return this.withOwnerLock(userId, async () => {
      const lifeLink = this.lifeLinks.get(lifeLinkId);
      if (!lifeLink || lifeLink.ownerId !== userId || this.mediaForLifeLink(lifeLinkId).length >= MAX_MEDIA_PER_LINK) {
        return null;
      }
      const media: StoredLifeLinkMedia = {
        id: `media-${randomUUID()}`,
        lifeLinkId,
        ownerId: userId,
        kind: input.kind,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        createdAt: new Date().toISOString(),
        data: input.data
      };
      this.media.set(media.id, media);
      return this.publicLifeLinkMedia(media);
    });
  }

  async deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean> {
    const media = this.media.get(mediaId);
    if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) {
      return false;
    }
    this.media.delete(mediaId);
    return true;
  }

  async getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null> {
    const media = this.media.get(mediaId);
    if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) {
      return null;
    }
    return { media: this.publicLifeLinkMedia(media), data: media.data };
  }

  async listLinks(userId: string): Promise<LinkRecord[]> {
    const claimed = Array.from(this.qrBindings.values())
      .map((binding) => this.lifeLinks.get(binding.lifeLinkId))
      .filter((lifeLink): lifeLink is StoredLifeLink => Boolean(lifeLink && lifeLink.ownerId === userId))
      .map((lifeLink) => this.projectTaggedLifeLink(lifeLink));
    const ownedBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((batch) => batch.createdBy === userId)
        .map((batch) => batch.id)
    );
    const unclaimed = Array.from(this.qrInventory.values())
      .filter((qr) => Boolean(qr.batchId && ownedBatchIds.has(qr.batchId) && !this.qrBindings.has(qr.id)))
      .map(projectUnclaimedQrAsLink);
    return [...claimed, ...unclaimed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    return Array.from(this.projectCompatibility.values())
      .map((marker) => ({ marker, lifeLink: this.lifeLinks.get(marker.lifeLinkId) }))
      .filter(
        (item): item is { marker: LifeLinkProjectCompatibilityRecord; lifeLink: StoredLifeLink } =>
          Boolean(item.lifeLink && item.lifeLink.ownerId === userId)
      )
      .map(({ marker, lifeLink }) => projectLifeLinkAsProject(this.hydrateLifeLink(lifeLink), marker))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createProject(userId: string, name: string): Promise<ProjectRecord> {
    if (name.length > MAX_PROJECT_NAME_LENGTH) {
      throw new LifeLinkDomainError("invalid_life_link", "Project compatibility title exceeds the supported limit.", {
        reason: "project_title_too_long"
      });
    }
    const id = `project-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const lifeLink = await this.createLifeLink({
      id,
      ownerId: userId,
      parentId: null,
      title: name,
      body: "",
      privacy: "private",
      createdAt
    });
    const marker = { projectId: id, lifeLinkId: lifeLink.id };
    this.projectCompatibility.set(marker.projectId, marker);
    return projectLifeLinkAsProject(lifeLink, marker);
  }

  async createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult> {
    const now = new Date().toISOString();
    const safeCount = normalizeBatchCount(count);
    const batchKey = createUniqueBatchKey(this.batches);
    const ids = createUniqueQrIds(safeCount, batchKey, this.qrInventory);
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
      this.qrInventory.set(id, { id, url: buildQrUrl(qrBaseUrl, id), batchId: batch.id, createdAt: now });
    }
    return { batch, qrCodes: ids.map((id) => projectUnclaimedQrAsLink(this.qrInventory.get(id)!)) };
  }

  async listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]> {
    const batch = this.batches.get(batchId);
    if (!batch || batch.createdBy !== userId) {
      return [];
    }
    return (this.batchQrIds.get(batchId) ?? []).map((qrId) => {
      const qr = this.qrInventory.get(qrId)!;
      const binding = this.qrBindings.get(qrId);
      if (!binding) {
        return projectUnclaimedQrAsLink(qr);
      }
      const lifeLink = this.lifeLinks.get(binding.lifeLinkId)!;
      const projected = this.projectTaggedLifeLink(lifeLink);
      if (lifeLink.ownerId === userId) {
        return projected;
      }
      return lifeLink.privacy === "public"
        ? redactNonOwnerLinkProjection(projected)
        : projectPrivateClaimedQrAsLink(qr);
    });
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const qr = this.qrInventory.get(qrId);
    if (!qr) {
      return { state: "not_found", qrId };
    }
    const binding = this.qrBindings.get(qrId);
    if (!binding) {
      return { state: "unclaimed", qr: projectUnclaimedQrAsLink(qr) };
    }
    const lifeLink = this.lifeLinks.get(binding.lifeLinkId);
    if (!lifeLink) {
      throw new LifeLinkDomainError("invalid_life_link", "QR binding references a missing Life Link.");
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === lifeLink.ownerId);
    if (lifeLink.privacy === "private" && !viewerIsOwner) {
      return { state: "private", qrId };
    }
    const projected = this.projectTaggedLifeLink(lifeLink);
    return {
      state: "claimed",
      link: viewerIsOwner ? projected : redactNonOwnerLinkProjection(projected),
      viewerIsOwner
    };
  }

  async claimQr(qrId: string, userId: string, commandValue: string | ClaimQrCommand): Promise<ClaimOutcome> {
    const command: ClaimQrCommand = typeof commandValue === "string" ? { commandId: commandValue, mode: "create" } : commandValue;
    return this.withLocks([`claim-command:${command.commandId}`, `claim-qr:${qrId}`, userId], async () => {
      const mode = command.mode ?? "create";
      const requestedLifeLinkId = command.mode === "attach" ? command.lifeLinkId : null;
      const existingEvent = this.claimEvents.get(command.commandId);
      if (existingEvent) {
        if (
          existingEvent.qrId !== qrId || existingEvent.ownerId !== userId ||
          existingEvent.mode !== mode ||
          existingEvent.requestedLifeLinkId !== requestedLifeLinkId
        ) {
          throw new ClaimIdempotencyConflictError();
        }
        return {
          result: existingEvent.result,
          state: await this.getQrState(existingEvent.qrId, userId),
          replayed: true
        };
      }

      const qr = this.qrInventory.get(qrId);
      let result: ClaimResult = "not_found";
      let resolvedLifeLinkId: string | null = null;
      if (command.mode === "attach") {
        const requested = this.lifeLinks.get(command.lifeLinkId);
        if (!requested || requested.ownerId !== userId) {
          throw new LifeLinkDomainError("life_link_not_found", "Attach target Life Link was not found.");
        }
      }
      if (qr) {
        const existingBinding = this.qrBindings.get(qrId);
        const existingLifeLink = existingBinding ? this.lifeLinks.get(existingBinding.lifeLinkId) : null;
        if (existingLifeLink?.ownerId === userId) {
          if (command.mode === "attach" && existingLifeLink.id !== command.lifeLinkId) {
            throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
          }
          result = "already_owned";
          resolvedLifeLinkId = existingLifeLink.id;
        } else if (existingLifeLink) {
          result = "owned_by_other";
          resolvedLifeLinkId = existingLifeLink.id;
        } else {
          const now = new Date().toISOString();
          let target: StoredLifeLink;
          if (command.mode === "attach") {
            const requested = this.lifeLinks.get(command.lifeLinkId)!;
            if (this.bindingForLifeLink(requested.id)) {
              throw new LifeLinkDomainError("life_link_already_tagged", "Attach target Life Link already has a QR tag.");
            }
            target = requested;
          } else {
            const created = createCanonicalLifeLink({
              id: `life-link-${randomUUID()}`,
              ownerId: userId,
              title: "Untitled link",
              body: "",
              privacy: "public",
              createdAt: now
            });
            target = withoutLifeLinkRelations(created);
            this.lifeLinks.set(target.id, target);
          }
          const binding = { qrId, lifeLinkId: target.id, boundAt: now };
          this.qrBindings.set(qrId, binding);
          result = "claimed";
          resolvedLifeLinkId = target.id;
        }
      }

      this.claimEvents.set(command.commandId, {
        commandId: command.commandId,
        qrId,
        ownerId: userId,
        mode,
        requestedLifeLinkId,
        resolvedLifeLinkId,
        result,
        createdAt: new Date().toISOString()
      });
      return { result, state: await this.getQrState(qrId, userId), replayed: false };
    });
  }

  async updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null> {
    const binding = this.qrBindings.get(qrId);
    const current = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
    if (!current || current.ownerId !== userId) {
      return null;
    }
    return this.withOwnerLock(userId, async () => {
      const refreshed = this.lifeLinks.get(current.id)!;
      assertLifeLinkBodyPatchIsCoordinated(patch);
      let parentId = refreshed.parentId;
      if (patch.projectId !== undefined) {
        const currentProjectId = deriveProjectCompatibilityId(
          this.hydrateOwnerLifeLinks(userId),
          Array.from(this.projectCompatibility.values()),
          refreshed.id
        );
        if (patch.projectId !== currentProjectId) {
          this.assertLegacyPlacementChangeAllowed(refreshed);
          const marker = patch.projectId ? this.projectCompatibility.get(patch.projectId) : null;
          if (patch.projectId && (!marker || this.lifeLinks.get(marker.lifeLinkId)?.ownerId !== userId)) {
            return null;
          }
          parentId = marker?.lifeLinkId ?? null;
          assertValidLifeLinkParentPlacement(this.hydrateOwnerLifeLinks(userId), refreshed.id, parentId);
        }
      }
      const coordinated =
        patch.body === undefined && patch.bodyDoc === undefined
          ? { body: refreshed.body, bodyDoc: refreshed.bodyDoc, bodyDocVersion: refreshed.bodyDocVersion }
          : coordinateLifeLinkBody({
              body: patch.body ?? (patch.bodyDoc === null ? refreshed.body : undefined),
              bodyDoc: patch.bodyDoc === null ? undefined : patch.bodyDoc,
              bodyDocVersion: patch.bodyDocVersion
            });
      const title = patch.title ?? refreshed.title;
      assertLifeLinkContentWithinBounds(title, coordinated.body, coordinated.bodyDoc);
      const next: StoredLifeLink = {
        ...refreshed,
        parentId,
        title,
        ...coordinated,
        privacy: patch.privacy ?? refreshed.privacy,
        updatedAt: nextTimestamp(refreshed.updatedAt)
      };
      this.lifeLinks.set(next.id, next);
      return this.projectTaggedLifeLink(next);
    });
  }

  async createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null> {
    const binding = this.qrBindings.get(qrId);
    if (!binding) {
      return null;
    }
    const media = await this.createLifeLinkMedia(userId, binding.lifeLinkId, input);
    return media ? lifeLinkMediaAsLinkMedia(media, qrId) : null;
  }

  async deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean> {
    const binding = this.qrBindings.get(qrId);
    return binding ? this.deleteLifeLinkMedia(userId, binding.lifeLinkId, mediaId) : false;
  }

  async getLinkMedia(
    qrId: string,
    mediaId: string,
    viewerUserId: string | null
  ): Promise<LinkMediaFile | "private" | null> {
    const binding = this.qrBindings.get(qrId);
    const lifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
    const media = this.media.get(mediaId);
    if (!binding || !lifeLink || !media || media.lifeLinkId !== lifeLink.id) {
      return null;
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === lifeLink.ownerId);
    if (lifeLink.privacy === "private" && !viewerIsOwner) {
      return "private";
    }
    return { media: lifeLinkMediaAsLinkMedia(this.publicLifeLinkMedia(media), qrId), data: media.data, viewerIsOwner };
  }

  async seedDemo(password: string, qrBaseUrl: string): Promise<void> {
    const data = createDemoSeedData(new Date().toISOString(), qrBaseUrl);
    const batchId = "batch-demo-seed";
    for (const user of data.users) {
      if (!this.users.has(user.id)) {
        const passwordHash = await hashPassword(password);
        this.users.set(user.id, { ...user, passwordHash });
        this.userIdsByEmail.set(user.email.toLowerCase(), user.id);
      }
    }
    for (const project of data.projects) {
      if (!this.lifeLinks.has(project.id)) {
        const root = createCanonicalLifeLink({
          id: project.id,
          ownerId: project.ownerId,
          title: project.name,
          body: "",
          privacy: "private",
          createdAt: project.createdAt
        });
        this.lifeLinks.set(root.id, withoutLifeLinkRelations(root));
        this.projectCompatibility.set(project.id, { projectId: project.id, lifeLinkId: root.id });
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
      if (!this.qrInventory.has(link.id)) {
        this.qrInventory.set(link.id, { id: link.id, url: link.url, batchId, createdAt: link.createdAt });
      }
      if (link.status === "claimed") {
        const lifeLinkId = mapLegacyLinkToLifeLinkId(link.id);
        if (!this.lifeLinks.has(lifeLinkId)) {
          this.lifeLinks.set(lifeLinkId, {
            id: lifeLinkId,
            ownerId: link.ownerId!,
            parentId: link.projectId,
            title: link.title,
            body: link.body,
            bodyDoc: link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body),
            bodyDocVersion: link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
            privacy: link.privacy,
            createdAt: link.createdAt,
            updatedAt: link.updatedAt
          });
        }
        if (!this.qrBindings.has(link.id)) {
          this.qrBindings.set(link.id, { qrId: link.id, lifeLinkId, boundAt: link.updatedAt });
        }
      }
    }
  }

  async resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport> {
    const fixture = createCompetitionFixtureData(options.password, options.qrBaseUrl);
    const mode = options.mode ?? "dry-run";
    assertCompetitionFixtureResetMode(mode);
    const expected = expectedCompetitionFixtureCounts(fixture);
    if (mode === "dry-run") {
      this.assertCompetitionFixturePreflight(fixture);
      const before = this.competitionFixtureCounts(fixture.owner.id);
      return createCompetitionFixtureResetReport(mode, before, before, expected);
    }

    return this.withOwnerLock(fixture.owner.id, async () => {
      this.assertCompetitionFixturePreflight(fixture);
      const before = this.competitionFixtureCounts(fixture.owner.id);
      const passwordHash = await hashPassword(options.password);
      const snapshot = this.captureState();
      try {
        this.replaceCompetitionFixture(fixture, passwordHash);
        const after = this.competitionFixtureCounts(fixture.owner.id);
        this.assertCompetitionFixturePostcondition(fixture, passwordHash, after, expected);
        return createCompetitionFixtureResetReport(mode, before, after, expected);
      } catch (error) {
        this.restoreState(snapshot);
        throw error;
      }
    });
  }

  async checkReady(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  private hydrateOwnerLifeLinks(userId: string): LifeLinkRecord[] {
    return Array.from(this.lifeLinks.values())
      .filter((lifeLink) => lifeLink.ownerId === userId)
      .map((lifeLink) => this.hydrateLifeLink(lifeLink));
  }

  private hydrateLifeLink(lifeLink: StoredLifeLink): LifeLinkRecord {
    return {
      ...lifeLink,
      qrId: this.bindingForLifeLink(lifeLink.id)?.qrId ?? null,
      media: this.mediaForLifeLink(lifeLink.id)
    };
  }

  private mediaForLifeLink(lifeLinkId: string): LifeLinkMediaRecord[] {
    return Array.from(this.media.values())
      .filter((media) => media.lifeLinkId === lifeLinkId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map((media) => this.publicLifeLinkMedia(media));
  }

  private publicLifeLinkMedia(media: StoredLifeLinkMedia): LifeLinkMediaRecord {
    const { data: _data, ...record } = media;
    const qrId = this.bindingForLifeLink(media.lifeLinkId)?.qrId;
    return { ...record, url: qrId ? mediaUrl(qrId, media.id) : lifeLinkMediaUrl(media.lifeLinkId, media.id) };
  }

  private bindingForLifeLink(lifeLinkId: string): LifeLinkQrBindingRecord | null {
    return Array.from(this.qrBindings.values()).find((binding) => binding.lifeLinkId === lifeLinkId) ?? null;
  }

  private captureState(): InMemoryStoreSnapshot {
    return {
      users: new Map(this.users),
      userIdsByEmail: new Map(this.userIdsByEmail),
      sessions: new Map(this.sessions),
      lifeLinks: new Map(this.lifeLinks),
      qrInventory: new Map(this.qrInventory),
      qrBindings: new Map(this.qrBindings),
      projectCompatibility: new Map(this.projectCompatibility),
      media: new Map(this.media),
      batches: new Map(this.batches),
      batchQrIds: new Map(Array.from(this.batchQrIds, ([batchId, qrIds]) => [batchId, [...qrIds]])),
      claimEvents: new Map(this.claimEvents)
    };
  }

  private restoreState(snapshot: InMemoryStoreSnapshot): void {
    this.users = snapshot.users;
    this.userIdsByEmail = snapshot.userIdsByEmail;
    this.sessions = snapshot.sessions;
    this.lifeLinks = snapshot.lifeLinks;
    this.qrInventory = snapshot.qrInventory;
    this.qrBindings = snapshot.qrBindings;
    this.projectCompatibility = snapshot.projectCompatibility;
    this.media = snapshot.media;
    this.batches = snapshot.batches;
    this.batchQrIds = snapshot.batchQrIds;
    this.claimEvents = snapshot.claimEvents;
  }

  private competitionFixtureCounts(ownerId: string): CompetitionFixtureCounts {
    const lifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((lifeLink) => lifeLink.ownerId === ownerId)
        .map((lifeLink) => lifeLink.id)
    );
    const batchIds = new Set(
      Array.from(this.batches.values())
        .filter((batch) => batch.createdBy === ownerId)
        .map((batch) => batch.id)
    );
    return {
      users: this.users.has(ownerId) ? 1 : 0,
      sessions: Array.from(this.sessions.values()).filter((session) => session.userId === ownerId).length,
      lifeLinks: lifeLinkIds.size,
      qrBindings: Array.from(this.qrBindings.values()).filter((binding) => lifeLinkIds.has(binding.lifeLinkId)).length,
      projectCompatibility: Array.from(this.projectCompatibility.values()).filter((marker) => lifeLinkIds.has(marker.lifeLinkId)).length,
      media: Array.from(this.media.values()).filter((item) => item.ownerId === ownerId).length,
      batches: batchIds.size,
      qrCodes: Array.from(this.qrInventory.values()).filter((qr) => Boolean(qr.batchId && batchIds.has(qr.batchId))).length,
      claimEvents: Array.from(this.claimEvents.values()).filter((event) => event.ownerId === ownerId).length
    };
  }

  private assertCompetitionFixturePreflight(fixture: CompetitionFixtureData): void {
    const ownerId = fixture.owner.id;
    const fixtureLifeLinkIds = new Set(fixture.lifeLinks.map((item) => item.id));
    const fixtureQrIds = new Set(fixture.qrInventory.map((item) => item.id));
    const ownerLifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((item) => item.ownerId === ownerId)
        .map((item) => item.id)
    );
    const ownerBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((item) => item.createdBy === ownerId)
        .map((item) => item.id)
    );
    const ownerQrIds = new Set(
      Array.from(this.qrInventory.values())
        .filter((item) => Boolean(item.batchId && ownerBatchIds.has(item.batchId)))
        .map((item) => item.id)
    );
    const emailOwner = this.userIdsByEmail.get(fixture.owner.email.toLowerCase());
    if (emailOwner && emailOwner !== ownerId) {
      throw new Error("Competition fixture email is owned by another account.");
    }
    for (const id of fixtureLifeLinkIds) {
      const existing = this.lifeLinks.get(id);
      if (existing && existing.ownerId !== ownerId) {
        throw new Error("Competition fixture Life Link identity collides with another owner.");
      }
    }
    const existingBatch = this.batches.get(fixture.batch.id);
    if (existingBatch && existingBatch.createdBy !== ownerId) {
      throw new Error("Competition fixture batch identity collides with another owner.");
    }
    for (const batch of this.batches.values()) {
      if (batch.batchKey === fixture.batch.batchKey && batch.id !== fixture.batch.id && batch.createdBy !== ownerId) {
        throw new Error("Competition fixture batch key collides with another owner.");
      }
    }
    for (const id of fixtureQrIds) {
      const existing = this.qrInventory.get(id);
      if (existing && (!existing.batchId || !ownerBatchIds.has(existing.batchId))) {
        throw new Error("Competition fixture QR identity collides with another owner.");
      }
      const binding = this.qrBindings.get(id);
      const boundLifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
      if (binding && (!boundLifeLink || boundLifeLink.ownerId !== ownerId)) {
        throw new Error("Competition fixture QR binding collides with another owner.");
      }
    }
    for (const qrId of ownerQrIds) {
      const binding = this.qrBindings.get(qrId);
      const boundLifeLink = binding ? this.lifeLinks.get(binding.lifeLinkId) : null;
      if (binding && (!boundLifeLink || boundLifeLink.ownerId !== ownerId)) {
        throw new Error("Competition sandbox QR state is bound to another owner.");
      }
    }
    for (const binding of this.qrBindings.values()) {
      const boundLifeLink = this.lifeLinks.get(binding.lifeLinkId);
      if (boundLifeLink?.ownerId !== ownerId) {
        continue;
      }
      const qr = this.qrInventory.get(binding.qrId);
      if (!qr?.batchId || !ownerBatchIds.has(qr.batchId)) {
        throw new Error("Competition sandbox Life Link is bound to QR inventory outside its owner sandbox.");
      }
    }
    for (const marker of fixture.projectCompatibility) {
      const existing = this.projectCompatibility.get(marker.projectId);
      const markedLifeLink = existing ? this.lifeLinks.get(existing.lifeLinkId) : null;
      if (existing && (!markedLifeLink || markedLifeLink.ownerId !== ownerId)) {
        throw new Error("Competition fixture project identity collides with another owner.");
      }
    }
    for (const event of this.claimEvents.values()) {
      if (
        event.ownerId !== ownerId &&
        (fixtureQrIds.has(event.qrId) ||
          ownerQrIds.has(event.qrId) ||
          fixtureLifeLinkIds.has(event.requestedLifeLinkId ?? "") ||
          fixtureLifeLinkIds.has(event.resolvedLifeLinkId ?? "") ||
          ownerLifeLinkIds.has(event.requestedLifeLinkId ?? "") ||
          ownerLifeLinkIds.has(event.resolvedLifeLinkId ?? ""))
      ) {
        throw new Error("Competition fixture state is referenced by another owner.");
      }
    }
  }

  private replaceCompetitionFixture(fixture: CompetitionFixtureData, passwordHash: string): void {
    const ownerId = fixture.owner.id;
    const ownerLifeLinkIds = new Set(
      Array.from(this.lifeLinks.values())
        .filter((item) => item.ownerId === ownerId)
        .map((item) => item.id)
    );
    const ownerBatchIds = new Set(
      Array.from(this.batches.values())
        .filter((item) => item.createdBy === ownerId)
        .map((item) => item.id)
    );
    removeMapEntries(this.sessions, (session) => session.userId === ownerId);
    removeMapEntries(this.claimEvents, (event) => event.ownerId === ownerId);
    removeMapEntries(this.media, (item) => item.ownerId === ownerId);
    removeMapEntries(this.qrBindings, (binding) => ownerLifeLinkIds.has(binding.lifeLinkId));
    removeMapEntries(this.projectCompatibility, (marker) => ownerLifeLinkIds.has(marker.lifeLinkId));
    removeMapEntries(this.lifeLinks, (item) => item.ownerId === ownerId);
    removeMapEntries(this.qrInventory, (qr) => Boolean(qr.batchId && ownerBatchIds.has(qr.batchId)));
    for (const batchId of ownerBatchIds) {
      this.batchQrIds.delete(batchId);
      this.batches.delete(batchId);
    }

    const existingOwner = this.users.get(ownerId);
    if (existingOwner) {
      this.userIdsByEmail.delete(existingOwner.email.toLowerCase());
    }
    this.users.set(ownerId, { ...fixture.owner, passwordHash });
    this.userIdsByEmail.set(fixture.owner.email.toLowerCase(), ownerId);
    this.batches.set(fixture.batch.id, { ...fixture.batch });
    this.batchQrIds.set(fixture.batch.id, fixture.qrInventory.map((item) => item.id));
    for (const qr of fixture.qrInventory) {
      this.qrInventory.set(qr.id, { ...qr });
    }
    for (const lifeLink of fixture.lifeLinks) {
      this.lifeLinks.set(lifeLink.id, withoutLifeLinkRelations(lifeLink));
    }
    for (const binding of fixture.qrBindings) {
      this.qrBindings.set(binding.qrId, { ...binding });
    }
    for (const marker of fixture.projectCompatibility) {
      this.projectCompatibility.set(marker.projectId, { ...marker });
    }
  }

  private assertCompetitionFixturePostcondition(
    fixture: CompetitionFixtureData,
    passwordHash: string,
    actual: CompetitionFixtureCounts,
    expected: CompetitionFixtureCounts
  ): void {
    if (!sameCompetitionFixtureCounts(actual, expected)) {
      throw new Error("Competition fixture reset produced unexpected account-local counts.");
    }
    const user = this.users.get(fixture.owner.id);
    if (
      !user ||
      user.email !== fixture.owner.email ||
      user.displayName !== fixture.owner.displayName ||
      user.createdAt !== fixture.owner.createdAt ||
      user.passwordHash !== passwordHash ||
      this.userIdsByEmail.get(fixture.owner.email.toLowerCase()) !== fixture.owner.id
    ) {
      throw new Error("Competition fixture owner postcondition failed.");
    }
    if (
      JSON.stringify(this.batches.get(fixture.batch.id)) !== JSON.stringify(fixture.batch) ||
      JSON.stringify(this.batchQrIds.get(fixture.batch.id)) !==
        JSON.stringify(fixture.qrInventory.map((item) => item.id))
    ) {
      throw new Error("Competition fixture batch postcondition failed.");
    }
    for (const expectedLifeLink of fixture.lifeLinks) {
      const actualLifeLink = this.lifeLinks.get(expectedLifeLink.id);
      if (!actualLifeLink || !sameStoredLifeLink(actualLifeLink, expectedLifeLink)) {
        throw new Error("Competition fixture Life Link postcondition failed.");
      }
    }
    for (const expectedQr of fixture.qrInventory) {
      if (JSON.stringify(this.qrInventory.get(expectedQr.id)) !== JSON.stringify(expectedQr)) {
        throw new Error("Competition fixture QR postcondition failed.");
      }
    }
    for (const expectedBinding of fixture.qrBindings) {
      if (JSON.stringify(this.qrBindings.get(expectedBinding.qrId)) !== JSON.stringify(expectedBinding)) {
        throw new Error("Competition fixture binding postcondition failed.");
      }
    }
    for (const expectedMarker of fixture.projectCompatibility) {
      if (
        JSON.stringify(this.projectCompatibility.get(expectedMarker.projectId)) !== JSON.stringify(expectedMarker)
      ) {
        throw new Error("Competition fixture project postcondition failed.");
      }
    }
  }

  private projectTaggedLifeLink(lifeLink: StoredLifeLink): LinkRecord {
    const hydrated = this.hydrateLifeLink(lifeLink);
    const binding = this.bindingForLifeLink(lifeLink.id);
    if (!binding) {
      throw new LifeLinkDomainError("invalid_life_link", "Legacy Link projection requires a QR binding.");
    }
    const qr = this.qrInventory.get(binding.qrId);
    if (!qr) {
      throw new LifeLinkDomainError("invalid_life_link", "Legacy Link projection requires QR inventory.");
    }
    const projectId = deriveProjectCompatibilityId(
      this.hydrateOwnerLifeLinks(lifeLink.ownerId),
      Array.from(this.projectCompatibility.values()),
      lifeLink.id
    );
    return projectLifeLinkAsLink(hydrated, qr, projectId);
  }

  private assertLegacyPlacementChangeAllowed(lifeLink: StoredLifeLink): void {
    if (Array.from(this.lifeLinks.values()).some((candidate) => candidate.parentId === lifeLink.id)) {
      throw new LifeLinkDomainError("invalid_parent", "Legacy placement cannot move a Life Link with children.", {
        reason: "legacy_non_leaf"
      });
    }
    if (lifeLink.parentId && !Array.from(this.projectCompatibility.values()).some((item) => item.lifeLinkId === lifeLink.parentId)) {
      throw new LifeLinkDomainError("invalid_parent", "Legacy placement cannot flatten a nested Life Link.", {
        reason: "legacy_nested"
      });
    }
  }

  private async withOwnerLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const predecessor = this.ownerLocks.get(ownerId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = predecessor.then(() => current);
    this.ownerLocks.set(ownerId, queued);
    await predecessor;
    try {
      return await work();
    } finally {
      release();
      if (this.ownerLocks.get(ownerId) === queued) {
        this.ownerLocks.delete(ownerId);
      }
    }
  }

  private async withLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const acquire = (index: number): Promise<T> =>
      index >= ordered.length ? work() : this.withOwnerLock(ordered[index], () => acquire(index + 1));
    return acquire(0);
  }
}

function withoutLifeLinkRelations(lifeLink: LifeLinkRecord): StoredLifeLink {
  const { qrId: _qrId, media: _media, ...stored } = lifeLink;
  return stored;
}

function sameStoredLifeLink(existing: StoredLifeLink, candidate: LifeLinkRecord): boolean {
  return JSON.stringify(existing) === JSON.stringify(withoutLifeLinkRelations(candidate));
}

export function assertCompetitionFixtureResetMode(mode: string): asserts mode is CompetitionFixtureResetMode {
  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("Competition fixture reset mode must be dry-run or apply.");
  }
}

export function expectedCompetitionFixtureCounts(fixture: CompetitionFixtureData): CompetitionFixtureCounts {
  return {
    users: 1,
    sessions: 0,
    lifeLinks: fixture.lifeLinks.length,
    qrBindings: fixture.qrBindings.length,
    projectCompatibility: fixture.projectCompatibility.length,
    media: 0,
    batches: 1,
    qrCodes: fixture.qrInventory.length,
    claimEvents: 0
  };
}

export function createCompetitionFixtureResetReport(
  mode: CompetitionFixtureResetMode,
  before: CompetitionFixtureCounts,
  after: CompetitionFixtureCounts,
  expected: CompetitionFixtureCounts
): CompetitionFixtureResetReport {
  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    ownerId: COMPETITION_OWNER_ID,
    mode,
    applied: mode === "apply",
    before,
    after,
    expected
  };
}

export function sameCompetitionFixtureCounts(left: CompetitionFixtureCounts, right: CompetitionFixtureCounts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function removeMapEntries<K, V>(map: Map<K, V>, predicate: (value: V) => boolean): void {
  for (const [key, value] of map) {
    if (predicate(value)) {
      map.delete(key);
    }
  }
}

function assertFresh(lifeLink: StoredLifeLink, expectedUpdatedAt: string): void {
  if (lifeLink.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_life_link", "Life Link changed after it was read.", { retryable: true });
  }
}

function nextTimestamp(previous: string): string {
  const now = new Date();
  return now.getTime() > Date.parse(previous) ? now.toISOString() : new Date(Date.parse(previous) + 1).toISOString();
}

function lifeLinkMediaAsLinkMedia(media: LifeLinkMediaRecord, qrId: string): LinkMediaRecord {
  const { lifeLinkId: _lifeLinkId, ...record } = media;
  return { ...record, qrId, url: mediaUrl(qrId, media.id) };
}

function mediaUrl(qrId: string, mediaId: string): string {
  return `/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`;
}

function lifeLinkMediaUrl(lifeLinkId: string, mediaId: string): string {
  return `/api/life-links/${encodeURIComponent(lifeLinkId)}/media/${encodeURIComponent(mediaId)}`;
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

function createUniqueQrIds(count: number, batchKey: string, qrCodes: Map<string, QrInventoryRecord>): string[] {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ids = generateQrIds(count, attempt === 0 ? batchKey : `${batchKey}${attempt}`);
    if (ids.every((id) => !qrCodes.has(id))) {
      return ids;
    }
  }
  throw new Error("Unable to generate a unique QR batch");
}
