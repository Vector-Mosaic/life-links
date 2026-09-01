import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  CHANGE_HISTORY_LIMIT, resolveLifeLinkChangeScope, lifeLinkChangePreviewItem, stableChangeFingerprint,
  type PreviewLifeLinkChangeInput, type LifeLinkChangePreview, type ApplyLifeLinkChangeInput,
  type UndoChangeInput, type ChangeHistory, type ChangeHistoryEntry, type LifeLinkChangeResult,
  type ClaimQrCommand,
  type ClaimResult,
  type ClearLifeLinkQrBindingCommand,
  type CollectionMemberCommand,
  type CollectionMembershipRecord,
  type CollectionRecord,
  type CollectionSectionAssignmentRecord,
  type CollectionSectionMutationResult,
  type CollectionSectionRecord,
  type CompetitionFixtureData,
  type CreateCollectionCommand,
  type CreateCollectionSectionCommand,
  type CreateLifeLinkCommand,
  type ExportBatchRecord,
  type LifeLinkDetail,
  type LifeLinkCollectionMembership,
  LifeLinkDomainError,
  type LifeLinkMediaRecord,
  type LifeLinkPage,
  type LifeLinkPageRequest,
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
  type QrInventoryRecord,
  type QrViewState,
  type RemoveCollectionSectionCommand,
  type ReplaceCollectionSectionAssignmentsCommand,
  type SetLifeLinkQrBindingCommand,
  type UpdateCollectionCommand,
  type UpdateCollectionSectionCommand,
  type UpdateLifeLinkCommand,
  type UserRecord,
  LINK_BODY_DOC_VERSION,
  MAX_MEDIA_PER_LINK,
  assertLifeLinkMediaBytes,
  assertLifeLinkBodyPatchIsCoordinated,
  assertLifeLinkContentWithinBounds,
  assertValidLifeLinkParentPlacement,
  applyLifeLinkPatch,
  buildQrUrl,
  coordinateLifeLinkBody,
  compareCollectionTitleOrder,
  compareCollectionSectionOrder,
  createCanonicalLifeLink,
  createCanonicalCollection,
  createCanonicalCollectionSection,
  createCompetitionFixtureData,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  generateQrIds,
  mapLegacyLinkToLifeLinkId,
  lifeLinkCreatePayloadMatches,
  normalizeBatchCount,
  normalizeCollectionPatch,
  normalizeCollectionId,
  normalizeCollectionSectionId,
  normalizeCollectionSectionIds,
  normalizeCollectionSectionTitle,
  normalizeSetLifeLinkQrBindingCommand,
  normalizeClearLifeLinkQrBindingCommand,
  pageCollectionRecords,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectPrivateClaimedQrAsLink,
  projectUnclaimedQrAsLink,
  projectPublicLifeLinkAsLink,
  normalizePublicFieldKeys,
  searchCanonicalLifeLinks,
  COMPETITION_FIXTURE_PROFILE,
  COMPETITION_OWNER_ID
} from "@life-links/core";

import { hashPassword, verifyPassword } from "./password.js";

export type StoredUser = UserRecord & {
  passwordHash: string;
  agentConnectedAt: string | null;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
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
  collections: number;
  collectionSections: number;
  collectionMemberships: number;
  collectionSectionAssignments: number;
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
  shapeMatchesExpected: boolean;
};

export class CompetitionFixtureShapeMismatchError extends Error {}

/**
 * Canonical ownership lives in the recursive Life Link methods. The legacy
 * QR views are projections used by the current
 * HTTP surface and must not grow an independent persistence path.
 */
export type LifeLinksStore = {
  previewLifeLinkChange(userId: string, input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview>;
  getLifeLinkChangePreview(userId: string, previewId: string): Promise<LifeLinkChangePreview | null>;
  applyLifeLinkChange(userId: string, input: ApplyLifeLinkChangeInput): Promise<LifeLinkChangeResult>;
  getChangeHistory(userId: string): Promise<ChangeHistory>;
  undoChange(userId: string, input: UndoChangeInput): Promise<LifeLinkChangeResult>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  getUserById(userId: string): Promise<StoredUser | null>;
  connectAgent(userId: string): Promise<StoredUser | null>;
  disconnectAgent(userId: string): Promise<StoredUser | null>;
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
  setLifeLinkQrBinding(userId: string, command: SetLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null>;
  clearLifeLinkQrBinding(userId: string, command: ClearLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null>;
  createLifeLinkMedia(userId: string, lifeLinkId: string, input: LinkMediaInput): Promise<LifeLinkMediaRecord | null>;
  deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean>;
  getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null>;

  listCollections(userId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<CollectionRecord>>;
  getCollection(userId: string, collectionId: string): Promise<CollectionRecord | null>;
  createCollection(command: CreateCollectionCommand): Promise<CollectionRecord>;
  updateCollection(userId: string, command: UpdateCollectionCommand): Promise<CollectionRecord | null>;
  listCollectionMembers(userId: string, collectionId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkRecord> | null>;
  addCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null>;
  removeCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null>;
  listCollectionSections(userId: string, collectionId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<CollectionSectionRecord> | null>;
  createCollectionSection(userId: string, command: CreateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null>;
  updateCollectionSection(userId: string, command: UpdateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null>;
  removeCollectionSection(userId: string, command: RemoveCollectionSectionCommand): Promise<CollectionRecord | null>;
  replaceCollectionSectionAssignments(userId: string, command: ReplaceCollectionSectionAssignmentsCommand): Promise<CollectionRecord | null>;
  listLifeLinkCollectionMemberships(userId: string, lifeLinkId: string, page?: LifeLinkPageRequest): Promise<LifeLinkPage<LifeLinkCollectionMembership> | null>;

  listLinks(userId: string): Promise<LinkRecord[]>;
  createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult>;
  listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]>;
  getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState>;
  claimQr(qrId: string, userId: string, command: string | ClaimQrCommand): Promise<ClaimOutcome>;
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
  qrId: string | null;
  ownerId: string;
  mode: "create" | "attach" | "set" | "clear";
  requestedLifeLinkId: string | null;
  resolvedLifeLinkId: string | null;
  result: ClaimResult | "bound" | "unbound";
  expectedUpdatedAt: string | null;
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
  collections: Map<string, CollectionRecord>;
  collectionMemberships: Map<string, CollectionMembershipRecord>;
  collectionSections: Map<string, CollectionSectionRecord>;
  collectionSectionAssignments: Map<string, CollectionSectionAssignmentRecord>;
  qrInventory: Map<string, QrInventoryRecord>;
  qrBindings: Map<string, LifeLinkQrBindingRecord>;
  media: Map<string, StoredLifeLinkMedia>;
  batches: Map<string, ExportBatchRecord>;
  batchQrIds: Map<string, string[]>;
  claimEvents: Map<string, ClaimEventRecord>;
};

type ChangeTable = "lifeLinks" | "collections" | "collectionMemberships" | "collectionSections" | "collectionSectionAssignments" | "qrBindings" | "media";
type OwnerChangeSnapshot = Record<ChangeTable, Map<string, unknown>>;
type ChangeDelta = { table: ChangeTable; key: string; before: unknown; after: unknown };
type MemoryHistoryEntry = ChangeHistoryEntry & { deltas: ChangeDelta[]; affectedIds: string[] };
type MemoryPreview = { preview: LifeLinkChangePreview; input: PreviewLifeLinkChangeInput; fingerprint: string; expiresAt: number };
const CHANGE_MUTATION_LOCK = "\u0000canonical-change";

export class InMemoryLifeLinksStore implements LifeLinksStore {
  private users = new Map<string, StoredUser>();
  private userIdsByEmail = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private lifeLinks = new Map<string, StoredLifeLink>();
  private collections = new Map<string, CollectionRecord>();
  private collectionMemberships = new Map<string, CollectionMembershipRecord>();
  private collectionSections = new Map<string, CollectionSectionRecord>();
  private collectionSectionAssignments = new Map<string, CollectionSectionAssignmentRecord>();
  private qrInventory = new Map<string, QrInventoryRecord>();
  private qrBindings = new Map<string, LifeLinkQrBindingRecord>();
  private media = new Map<string, StoredLifeLinkMedia>();
  private batches = new Map<string, ExportBatchRecord>();
  private batchQrIds = new Map<string, string[]>();
  private claimEvents = new Map<string, ClaimEventRecord>();
  private ownerLocks = new Map<string, Promise<void>>();
  private changeHistory = new Map<string, MemoryHistoryEntry[]>();
  private changePreviews = new Map<string, Map<string, MemoryPreview>>();
  private changeReceipts = new Map<string, { ownerId: string; request: string; operation: LifeLinkChangeResult["operation"]; affectedIds: string[] }>();
  private usedChangeIds = new Set<string>();

  async previewLifeLinkChange(userId: string, input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview> {
    return this.withOwnerLock(userId, async () => {
      const scope = this.changeScope(userId, input);
      const now = Date.now();
      const preview: LifeLinkChangePreview = {
        id: `preview-${randomUUID()}`, operation: input.operation, rootIds: scope.rootIds,
        items: scope.items.map(lifeLinkChangePreviewItem), parentId: scope.parentId,
        target: scope.target ? lifeLinkChangePreviewItem(scope.target) : null,
        sideEffects: this.changeSideEffects(scope.items.map((row) => row.id)), createdAt: new Date(now).toISOString()
      };
      const previews = this.changePreviews.get(userId) ?? new Map<string, MemoryPreview>();
      for (const [id, item] of previews) if (item.expiresAt <= now) previews.delete(id);
      while (previews.size >= CHANGE_HISTORY_LIMIT) previews.delete(previews.keys().next().value!);
      previews.set(preview.id, { preview, input: structuredClone(input), fingerprint: this.changeFingerprint(userId, input), expiresAt: now + 15 * 60_000 });
      this.changePreviews.set(userId, previews);
      return structuredClone(preview);
    });
  }

  async getLifeLinkChangePreview(userId: string, previewId: string): Promise<LifeLinkChangePreview | null> {
    const item = this.changePreviews.get(userId)?.get(previewId);
    if (!item || item.expiresAt <= Date.now()) {
      this.changePreviews.get(userId)?.delete(previewId);
      return null;
    }
    return structuredClone(item.preview);
  }

  async getChangeHistory(userId: string): Promise<ChangeHistory> {
    return { limit: CHANGE_HISTORY_LIMIT, entries: (this.changeHistory.get(userId) ?? []).map(({ id, label, createdAt }) => ({ id, label, createdAt })) };
  }

  async applyLifeLinkChange(userId: string, input: ApplyLifeLinkChangeInput): Promise<LifeLinkChangeResult> {
    return this.withLocks([CHANGE_MUTATION_LOCK, userId], async () => {
      const replay = await this.changeReplay(userId, input.commandId, { apply: input.previewId });
      if (replay) return replay;
      const saved = this.changePreviews.get(userId)?.get(input.previewId);
      if (!saved || saved.expiresAt <= Date.now()) throw new LifeLinkDomainError("life_link_not_found", "The change preview is unavailable. Preview again.");
      let fingerprint: string;
      try { fingerprint = this.changeFingerprint(userId, saved.input); }
      catch { throw new LifeLinkDomainError("stale_life_link", "The selection changed. Review a fresh preview.", { reason: "stale_preview" }); }
      if (fingerprint !== saved.fingerprint) throw new LifeLinkDomainError("stale_life_link", "The selection changed. Review a fresh preview.", { reason: "stale_preview" });
      const scope = this.changeScope(userId, saved.input);
      const ids = new Set(scope.items.map((row) => row.id));
      const changed = saved.input.operation === "delete" || scope.rootIds.some((id) => this.lifeLinks.get(id)!.parentId !== scope.parentId);
      await this.recordOwnerChange(userId, `${saved.input.operation === "move" ? "Move" : "Delete"} ${ids.size} Life Link${ids.size === 1 ? "" : "s"}`, async () => {
        if (saved.input.operation === "move") {
          for (const id of scope.rootIds) {
            const row = this.lifeLinks.get(id)!;
            if (row.parentId === scope.parentId) continue;
            const changedAt = nextTimestamp(row.updatedAt);
            this.lifeLinks.set(id, { ...row, parentId: scope.parentId, updatedAt: changedAt, placementConfirmedAt: changedAt });
          }
        } else {
          const collectionIds = new Set([...this.collectionMemberships.values()].filter((row) => ids.has(row.lifeLinkId)).map((row) => row.collectionId));
          removeMapEntries(this.collectionSectionAssignments, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.collectionMemberships, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.media, (row) => ids.has(row.lifeLinkId));
          removeMapEntries(this.qrBindings, (row) => ids.has(row.lifeLinkId));
          for (const id of ids) this.lifeLinks.delete(id);
          for (const id of collectionIds) this.touchCollection(this.collections.get(id)!);
        }
      });
      const result = { operation: saved.input.operation, affectedIds: changed ? [...ids] : [], history: await this.getChangeHistory(userId) };
      this.rememberChange(userId, input.commandId, { apply: input.previewId }, result);
      this.changePreviews.get(userId)?.delete(input.previewId);
      return result;
    });
  }

  async undoChange(userId: string, input: UndoChangeInput): Promise<LifeLinkChangeResult> {
    return this.withLocks([CHANGE_MUTATION_LOCK, userId], async () => {
      const replay = await this.changeReplay(userId, input.commandId, { undo: input.changeId });
      if (replay) return replay;
      const history = this.changeHistory.get(userId) ?? [];
      const entry = history[0];
      if (!entry) throw new LifeLinkDomainError("life_link_not_found", "There is no change to undo.");
      if (entry.id !== input.changeId) throw new LifeLinkDomainError("stale_life_link", "Only the latest change can be undone.");
      const tables = this.changeTables();
      for (const delta of entry.deltas) {
        if (!sameChangeRow(tables[delta.table].get(delta.key), delta.after)) throw new LifeLinkDomainError("stale_life_link", "The changed data no longer matches this Undo.");
        if (delta.table === "qrBindings" && delta.before) this.assertQrHistoryAvailable(userId, delta.key);
      }
      for (const delta of entry.deltas) {
        if (delta.before === undefined) {
          tables[delta.table].delete(delta.key);
          if (["lifeLinks", "collections", "collectionSections"].includes(delta.table)) this.usedChangeIds.add(`${delta.table}\u0000${delta.key}`);
        } else {
          const row = { ...(delta.before as Record<string, unknown>) };
          if (typeof row.updatedAt === "string") {
            const current = tables[delta.table].get(delta.key) as { updatedAt?: string } | undefined;
            row.updatedAt = nextTimestamp(current?.updatedAt ?? row.updatedAt);
          }
          tables[delta.table].set(delta.key, row);
        }
      }
      // Media and membership records have no own revision; invalidating their
      // owning content revisions makes restored relations visible to stale-edit checks.
      const revisions: Partial<Record<ChangeTable, Set<string>>> = { lifeLinks: new Set(entry.affectedIds), collections: new Set(), collectionSections: new Set() };
      for (const delta of entry.deltas) {
        if (revisions[delta.table]) revisions[delta.table]!.add(delta.key);
        for (const value of [delta.before, delta.after]) {
          const row = value as { collectionId?: string; sectionId?: string } | undefined;
          if (row?.collectionId) revisions.collections!.add(row.collectionId);
          if (row?.sectionId) revisions.collectionSections!.add(row.sectionId);
        }
      }
      for (const [table, ids] of Object.entries(revisions) as [ChangeTable, Set<string>][]) {
        for (const id of ids) {
          const row = tables[table].get(id) as { ownerId: string; updatedAt: string } | undefined;
          if (row?.ownerId === userId) tables[table].set(id, { ...row, updatedAt: nextTimestamp(row.updatedAt) });
        }
      }
      history.shift();
      const result: LifeLinkChangeResult = { operation: "undo", affectedIds: [...entry.affectedIds], history: await this.getChangeHistory(userId) };
      this.rememberChange(userId, input.commandId, { undo: input.changeId }, result);
      return result;
    });
  }

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const userId = this.userIdsByEmail.get(email.toLowerCase());
    return userId ? this.users.get(userId) ?? null : null;
  }

  async getUserById(userId: string): Promise<StoredUser | null> {
    return this.users.get(userId) ?? null;
  }

  async connectAgent(userId: string): Promise<StoredUser | null> {
    return this.withOwnerLock(userId, async () => {
      const user = this.users.get(userId);
      if (!user) {
        return null;
      }
      if (user.agentConnectedAt) {
        return user;
      }
      const connected = { ...user, agentConnectedAt: new Date().toISOString() };
      this.users.set(userId, connected);
      return connected;
    });
  }

  async disconnectAgent(userId: string): Promise<StoredUser | null> {
    return this.withOwnerLock(userId, async () => {
      const user = this.users.get(userId);
      if (!user) {
        return null;
      }
      if (!user.agentConnectedAt) {
        return user;
      }
      const disconnected = { ...user, agentConnectedAt: null };
      this.users.set(userId, disconnected);
      return disconnected;
    });
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
    return this.withMutationLocks([`life-link-id:${command.id}`, command.ownerId], command.ownerId, "Create Life Link", async () => {
      const candidate = createCanonicalLifeLink(command);
      const existing = this.lifeLinks.get(candidate.id);
      if (existing) {
        if (lifeLinkCreatePayloadMatches(this.hydrateLifeLink(existing), command)) {
          return this.hydrateLifeLink(existing);
        }
        throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identity is already bound to another record.");
      }
      this.assertFreshChangeIdentity("lifeLinks", candidate.id);
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(command.ownerId);
      assertValidLifeLinkParentPlacement([...ownerLifeLinks, candidate], candidate.id, candidate.parentId);
      this.lifeLinks.set(candidate.id, withoutLifeLinkRelations(candidate));
      this.promoteParent(candidate.parentId, candidate.createdAt);
      return this.hydrateLifeLink(this.lifeLinks.get(candidate.id)!);
    });
  }

  async updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withMutationLocks([userId], userId, "Edit Life Link", async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      assertFresh(current, command.expectedUpdatedAt);
      const candidate = applyLifeLinkPatch(this.hydrateLifeLink(current), command.patch, nextTimestamp(current.updatedAt));
      const next = withoutLifeLinkRelations(candidate);
      this.lifeLinks.set(next.id, next);
      return this.hydrateLifeLink(next);
    });
  }

  async moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null> {
    return this.withMutationLocks([userId], userId, "Move Life Link", async () => {
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      if (current.parentId === command.parentId) {
        return this.hydrateLifeLink(current);
      }
      assertFresh(current, command.expectedUpdatedAt);
      const ownerLifeLinks = this.hydrateOwnerLifeLinks(userId);
      assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, command.parentId);
      const changedAt = nextTimestamp(current.updatedAt);
      const next: StoredLifeLink = {
        ...current,
        parentId: command.parentId,
        placementConfirmedAt: changedAt,
        updatedAt: changedAt
      };
      this.lifeLinks.set(next.id, next);
      this.promoteParent(next.parentId, changedAt);
      return this.hydrateLifeLink(next);
    });
  }

  async setLifeLinkQrBinding(userId: string, command: SetLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    command = normalizeSetLifeLinkQrBindingCommand(command);
    return this.withMutationLocks([`claim-command:${command.commandId}`, `claim-qr:${command.qrId}`, userId], userId, "Change QR binding", async () => {
      const replay = this.qrBindingReplay(userId, "set", command);
      if (replay !== undefined) {
        return replay;
      }
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      if (!this.qrInventory.has(command.qrId)) {
        throw new LifeLinkDomainError("qr_not_found", "QR was not found.");
      }
      this.assertQrHistoryAvailable(userId, command.qrId);
      const occupied = this.qrBindings.get(command.qrId);
      if (occupied && occupied.lifeLinkId !== current.id) {
        throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
      }
      const previous = this.bindingForLifeLink(current.id);
      if (previous?.qrId !== command.qrId) {
        assertFresh(current, command.expectedUpdatedAt);
        const changedAt = nextTimestamp(current.updatedAt);
        if (previous) {
          this.qrBindings.delete(previous.qrId);
        }
        this.qrBindings.set(command.qrId, { qrId: command.qrId, lifeLinkId: current.id, boundAt: changedAt });
        this.lifeLinks.set(current.id, { ...current, updatedAt: changedAt });
      }
      this.recordQrBindingCommand(userId, "set", command);
      return this.hydrateLifeLink(this.lifeLinks.get(current.id)!);
    });
  }

  async clearLifeLinkQrBinding(userId: string, command: ClearLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    command = normalizeClearLifeLinkQrBindingCommand(command);
    return this.withMutationLocks([`claim-command:${command.commandId}`, userId], userId, "Detach QR", async () => {
      const replay = this.qrBindingReplay(userId, "clear", command);
      if (replay !== undefined) {
        return replay;
      }
      const current = this.lifeLinks.get(command.lifeLinkId);
      if (!current || current.ownerId !== userId) {
        return null;
      }
      const previous = this.bindingForLifeLink(current.id);
      if (previous) {
        assertFresh(current, command.expectedUpdatedAt);
        this.qrBindings.delete(previous.qrId);
        this.lifeLinks.set(current.id, { ...current, updatedAt: nextTimestamp(current.updatedAt) });
      }
      this.recordQrBindingCommand(userId, "clear", command);
      return this.hydrateLifeLink(this.lifeLinks.get(current.id)!);
    });
  }

  async createLifeLinkMedia(
    userId: string,
    lifeLinkId: string,
    input: LinkMediaInput
  ): Promise<LifeLinkMediaRecord | null> {
    assertLifeLinkMediaBytes(input.sizeBytes, input.data.byteLength);
    return this.withMutationLocks([userId], userId, "Add attachment", async () => {
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
    return this.withMutationLocks([userId], userId, "Remove attachment", async () => {
      const media = this.media.get(mediaId);
      if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) return false;
      this.media.delete(mediaId);
      return true;
    });
  }

  async getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null> {
    const media = this.media.get(mediaId);
    if (!media || media.lifeLinkId !== lifeLinkId || media.ownerId !== userId) {
      return null;
    }
    return { media: this.publicLifeLinkMedia(media), data: media.data };
  }

  async listCollections(userId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<CollectionRecord>> {
    return pageCollectionRecords(
      Array.from(this.collections.values()).filter((collection) => collection.ownerId === userId).sort(compareCollectionTitleOrder).map(copyCollection),
      page
    );
  }

  async getCollection(userId: string, collectionId: string): Promise<CollectionRecord | null> {
    const collection = this.ownedCollection(userId, collectionId);
    return collection ? copyCollection(collection) : null;
  }

  async createCollection(command: CreateCollectionCommand): Promise<CollectionRecord> {
    const candidate = createCanonicalCollection(command);
    return this.withMutationLocks([`collection-id:${candidate.id}`, candidate.ownerId], candidate.ownerId, "Create Collection", async () => {
      if (!this.users.has(candidate.ownerId)) {
        throw new LifeLinkDomainError("invalid_collection", "Collection owner was not found.");
      }
      const current = this.collections.get(candidate.id);
      if (current) {
        if (current.ownerId === candidate.ownerId && current.title === candidate.title && current.purpose === candidate.purpose && current.notes === candidate.notes) {
          return copyCollection(current);
        }
        throw new LifeLinkDomainError("duplicate_collection_id", "Collection identity is already bound to another record.");
      }
      this.assertFreshChangeIdentity("collections", candidate.id);
      this.collections.set(candidate.id, candidate);
      return copyCollection(candidate);
    });
  }

  async updateCollection(userId: string, command: UpdateCollectionCommand): Promise<CollectionRecord | null> {
    const patch = normalizeCollectionPatch(command.patch);
    return this.withMutationLocks([userId], userId, "Edit Collection", async () => {
      const current = this.ownedCollection(userId, command.collectionId);
      if (!current) {
        return null;
      }
      const next = { ...current, ...patch };
      if (next.title === current.title && next.purpose === current.purpose && next.notes === current.notes) {
        return copyCollection(current);
      }
      assertCollectionFresh(current, command.expectedUpdatedAt);
      next.updatedAt = nextTimestamp(current.updatedAt);
      this.collections.set(next.id, next);
      return copyCollection(next);
    });
  }

  async listCollectionMembers(userId: string, collectionId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<LifeLinkRecord> | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!this.ownedCollection(userId, collectionId)) {
      return null;
    }
    const members = Array.from(this.collectionMemberships.values())
      .filter((membership) => membership.ownerId === userId && membership.collectionId === collectionId)
      .map((membership) => this.lifeLinks.get(membership.lifeLinkId)!)
      .sort(compareCollectionTitleOrder)
      .map((lifeLink) => this.hydrateLifeLink(lifeLink));
    return pageCollectionRecords(members, page);
  }

  async addCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withMutationLocks([userId], userId, "Add Collection member", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      const key = membershipKey(collection.id, lifeLink.id);
      if (this.collectionMemberships.has(key)) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      this.collectionMemberships.set(key, { ownerId: userId, collectionId: collection.id, lifeLinkId: lifeLink.id, createdAt: changedAt });
      return this.touchCollection(collection, changedAt);
    });
  }

  async removeCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withMutationLocks([userId], userId, "Remove Collection member", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      const key = membershipKey(collection.id, lifeLink.id);
      if (!this.collectionMemberships.has(key)) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.collectionMemberships.delete(key);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.collectionId === collection.id && assignment.lifeLinkId === lifeLink.id);
      return this.touchCollection(collection);
    });
  }

  async listCollectionSections(userId: string, collectionId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<CollectionSectionRecord> | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!this.ownedCollection(userId, collectionId)) {
      return null;
    }
    return pageCollectionRecords(this.sectionsForCollection(collectionId).map((section) => ({ ...section })), page);
  }

  async createCollectionSection(userId: string, command: CreateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null> {
    return this.withMutationLocks([`section-id:${normalizeCollectionSectionId(command.id)}`, userId], userId, "Create Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      if (!collection) {
        return null;
      }
      const sections = this.sectionsForCollection(collection.id);
      const candidate = createCanonicalCollectionSection({
        id: command.id,
        ownerId: userId,
        collectionId: collection.id,
        title: command.title,
        position: sections.length ? sections[sections.length - 1].position + 1 : 0,
        createdAt: nextTimestamp(collection.updatedAt)
      });
      const current = this.collectionSections.get(candidate.id);
      if (current) {
        if (current.ownerId === userId && current.collectionId === collection.id && current.title === candidate.title) {
          return { collection: copyCollection(collection), section: { ...current } };
        }
        throw new LifeLinkDomainError("duplicate_section_id", "Section identity is already bound to another record.");
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.assertFreshChangeIdentity("collectionSections", candidate.id);
      this.collectionSections.set(candidate.id, candidate);
      return { collection: this.touchCollection(collection, candidate.createdAt), section: { ...candidate } };
    });
  }

  async updateCollectionSection(userId: string, command: UpdateCollectionSectionCommand): Promise<CollectionSectionMutationResult | null> {
    const sectionId = normalizeCollectionSectionId(command.sectionId);
    const title = normalizeCollectionSectionTitle(command.title);
    return this.withMutationLocks([userId], userId, "Edit Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const section = this.collectionSections.get(sectionId);
      if (!collection || !section || section.ownerId !== userId || section.collectionId !== collection.id) {
        return null;
      }
      if (title === section.title) {
        return { collection: copyCollection(collection), section: { ...section } };
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      const next = { ...section, title, updatedAt: changedAt };
      this.collectionSections.set(next.id, next);
      return { collection: this.touchCollection(collection, changedAt), section: { ...next } };
    });
  }

  async removeCollectionSection(userId: string, command: RemoveCollectionSectionCommand): Promise<CollectionRecord | null> {
    const sectionId = normalizeCollectionSectionId(command.sectionId);
    return this.withMutationLocks([userId], userId, "Remove Section", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      if (!collection) {
        return null;
      }
      const section = this.collectionSections.get(sectionId);
      if (!section || section.ownerId !== userId || section.collectionId !== collection.id) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      this.collectionSections.delete(section.id);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.sectionId === section.id);
      return this.touchCollection(collection);
    });
  }

  async replaceCollectionSectionAssignments(userId: string, command: ReplaceCollectionSectionAssignmentsCommand): Promise<CollectionRecord | null> {
    const sectionIds = normalizeCollectionSectionIds(command.sectionIds);
    return this.withMutationLocks([userId], userId, "Change Section assignments", async () => {
      const collection = this.ownedCollection(userId, command.collectionId);
      const lifeLink = this.lifeLinks.get(command.lifeLinkId);
      if (!collection || !lifeLink || lifeLink.ownerId !== userId) {
        return null;
      }
      if (!this.collectionMemberships.has(membershipKey(collection.id, lifeLink.id))) {
        throw new LifeLinkDomainError("collection_membership_not_found", "Life Link is not a direct Collection member.");
      }
      if (sectionIds.some((sectionId) => {
        const section = this.collectionSections.get(sectionId);
        return !section || section.ownerId !== userId || section.collectionId !== collection.id;
      })) {
        throw new LifeLinkDomainError("section_not_found", "Section was not found in this Collection.");
      }
      const currentIds = this.sectionAssignmentsForMember(collection.id, lifeLink.id).map((assignment) => assignment.sectionId).sort();
      if (JSON.stringify(currentIds) === JSON.stringify([...sectionIds].sort())) {
        return copyCollection(collection);
      }
      assertCollectionFresh(collection, command.expectedUpdatedAt);
      const changedAt = nextTimestamp(collection.updatedAt);
      removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.collectionId === collection.id && assignment.lifeLinkId === lifeLink.id && !sectionIds.includes(assignment.sectionId));
      for (const sectionId of sectionIds) {
        const key = assignmentKey(collection.id, lifeLink.id, sectionId);
        if (!this.collectionSectionAssignments.has(key)) {
          this.collectionSectionAssignments.set(key, { ownerId: userId, collectionId: collection.id, lifeLinkId: lifeLink.id, sectionId, createdAt: changedAt });
        }
      }
      return this.touchCollection(collection, changedAt);
    });
  }

  async listLifeLinkCollectionMemberships(userId: string, lifeLinkId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<LifeLinkCollectionMembership> | null> {
    const lifeLink = this.lifeLinks.get(lifeLinkId);
    if (!lifeLink || lifeLink.ownerId !== userId) {
      return null;
    }
    const collections = Array.from(this.collectionMemberships.values())
      .filter((membership) => membership.ownerId === userId && membership.lifeLinkId === lifeLinkId)
      .map((membership) => this.collections.get(membership.collectionId)!)
      .sort(compareCollectionTitleOrder);
    const result = pageCollectionRecords(collections, page);
    return {
      ...result,
      items: result.items.map((collection) => {
        const ids = new Set(this.sectionAssignmentsForMember(collection.id, lifeLinkId).map((assignment) => assignment.sectionId));
        return { collection: copyCollection(collection), sections: this.sectionsForCollection(collection.id).filter((section) => ids.has(section.id)).map((section) => ({ ...section })) };
      })
    };
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
      .map((qr) => this.qrReservedForAnotherOwner(userId, qr.id) ? projectPrivateClaimedQrAsLink(qr) : projectUnclaimedQrAsLink(qr));
    return [...claimed, ...unclaimed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
        return this.qrReservedForAnotherOwner(userId, qrId) ? projectPrivateClaimedQrAsLink(qr) : projectUnclaimedQrAsLink(qr);
      }
      const lifeLink = this.lifeLinks.get(binding.lifeLinkId)!;
      const projected = this.projectTaggedLifeLink(lifeLink);
      if (lifeLink.ownerId === userId) {
        return projected;
      }
      return lifeLink.privacy === "public"
        ? projectPublicLifeLinkAsLink(this.hydrateLifeLink(lifeLink), qr)
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
      if (this.qrReservedForAnotherOwner(viewerUserId, qrId)) return { state: "private", qrId };
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
      link: viewerIsOwner ? projected : projectPublicLifeLinkAsLink(this.hydrateLifeLink(lifeLink), qr),
      viewerIsOwner
    };
  }

  async claimQr(qrId: string, userId: string, commandValue: string | ClaimQrCommand): Promise<ClaimOutcome> {
    const command: ClaimQrCommand = typeof commandValue === "string" ? { commandId: commandValue, mode: "create" } : commandValue;
    return this.withMutationLocks([`claim-command:${command.commandId}`, `claim-qr:${qrId}`, userId], userId, "Claim QR", async () => {
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
          result: existingEvent.result as ClaimResult,
          state: await this.getQrState(existingEvent.qrId!, userId),
          replayed: true
        };
      }

      const qr = this.qrInventory.get(qrId);
      if (qr) this.assertQrHistoryAvailable(userId, qrId);
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
        expectedUpdatedAt: null,
        createdAt: new Date().toISOString()
      });
      return { result, state: await this.getQrState(qrId, userId), replayed: false };
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
    if (!viewerIsOwner) {
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
        this.users.set(user.id, { ...user, passwordHash, agentConnectedAt: null });
        this.userIdsByEmail.set(user.email.toLowerCase(), user.id);
      }
    }
    for (const root of data.roots) {
      if (!this.lifeLinks.has(root.id) && !this.usedChangeIds.has(`lifeLinks\u0000${root.id}`)) this.lifeLinks.set(root.id, withoutLifeLinkRelations(root));
      this.usedChangeIds.add(`lifeLinks\u0000${root.id}`);
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
        const wasUsed = this.usedChangeIds.has(`lifeLinks\u0000${lifeLinkId}`);
        if (!this.lifeLinks.has(lifeLinkId) && !wasUsed) {
          this.lifeLinks.set(lifeLinkId, {
            id: lifeLinkId,
            ownerId: link.ownerId!,
            parentId: link.parentId,
            title: link.title,
            body: link.body,
            bodyDoc: link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body),
            bodyDocVersion: link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
            privacy: link.privacy,
            browsingRole: "item",
            context: { schemaVersion: 1 },
            placementConfirmedAt: null,
            publicFieldKeys: link.privacy === "public" ? ["notes"] : [],
            createdAt: link.createdAt,
            updatedAt: link.updatedAt
          });
        }
        if (!this.qrBindings.has(link.id) && this.lifeLinks.has(lifeLinkId) && !wasUsed) {
          this.qrBindings.set(link.id, { qrId: link.id, lifeLinkId, boundAt: link.updatedAt });
        }
        this.usedChangeIds.add(`lifeLinks\u0000${lifeLinkId}`);
      }
    }
  }

  async resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport> {
    const fixture = createCompetitionFixtureData(options.password, options.qrBaseUrl);
    const mode = options.mode ?? "dry-run";
    assertCompetitionFixtureResetMode(mode);
    const expected = expectedCompetitionFixtureCounts(fixture);
    return this.withOwnerLock(fixture.owner.id, async () => {
      this.assertCompetitionFixturePreflight(fixture);
      const before = this.competitionFixtureCounts(fixture.owner.id);
      if (mode === "dry-run") {
        let shapeMatchesExpected = false;
        const existingHash = this.users.get(fixture.owner.id)?.passwordHash ?? "";
        try {
          this.assertCompetitionFixturePostcondition(fixture, existingHash, before, expected);
          shapeMatchesExpected = await verifyPassword(options.password, existingHash);
        } catch (error) {
          if (!(error instanceof CompetitionFixtureShapeMismatchError)) throw error;
        }
        return createCompetitionFixtureResetReport(mode, before, before, expected, shapeMatchesExpected);
      }
      const passwordHash = await hashPassword(options.password);
      const snapshot = this.captureState();
      try {
        this.replaceCompetitionFixture(fixture, passwordHash);
        const after = this.competitionFixtureCounts(fixture.owner.id);
        this.assertCompetitionFixturePostcondition(fixture, passwordHash, after, expected);
        this.changeHistory.delete(fixture.owner.id);
        this.changePreviews.delete(fixture.owner.id);
        removeMapEntries(this.changeReceipts, (receipt) => receipt.ownerId === fixture.owner.id);
        return createCompetitionFixtureResetReport(mode, before, after, expected, true);
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
      context: structuredClone(lifeLink.context),
      publicFieldKeys: [...lifeLink.publicFieldKeys],
      bodyDoc: lifeLink.bodyDoc ? structuredClone(lifeLink.bodyDoc) : lifeLink.bodyDoc,
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

  private promoteParent(parentId: string | null, changedAt: string): void {
    const parent = parentId ? this.lifeLinks.get(parentId) : null;
    if (parent && parent.browsingRole !== "container") {
      this.lifeLinks.set(parent.id, {
        ...parent,
        browsingRole: "container",
        updatedAt: new Date(Math.max(Date.parse(parent.updatedAt) + 1, Date.parse(changedAt))).toISOString()
      });
    }
  }

  private ownedCollection(userId: string, collectionId: string): CollectionRecord | null {
    const collection = this.collections.get(normalizeCollectionId(collectionId));
    return collection?.ownerId === userId ? collection : null;
  }

  private touchCollection(collection: CollectionRecord, updatedAt = nextTimestamp(collection.updatedAt)): CollectionRecord {
    const next = { ...collection, updatedAt };
    this.collections.set(next.id, next);
    return copyCollection(next);
  }

  private sectionsForCollection(collectionId: string): CollectionSectionRecord[] {
    return Array.from(this.collectionSections.values())
      .filter((section) => section.collectionId === collectionId)
      .sort(compareCollectionSectionOrder);
  }

  private sectionAssignmentsForMember(collectionId: string, lifeLinkId: string): CollectionSectionAssignmentRecord[] {
    return Array.from(this.collectionSectionAssignments.values())
      .filter((assignment) => assignment.collectionId === collectionId && assignment.lifeLinkId === lifeLinkId);
  }

  private qrBindingReplay(
    userId: string,
    mode: "set" | "clear",
    command: SetLifeLinkQrBindingCommand | ClearLifeLinkQrBindingCommand
  ): LifeLinkRecord | null | undefined {
    const event = this.claimEvents.get(command.commandId);
    if (!event) {
      return undefined;
    }
    const requestedQrId = "qrId" in command ? command.qrId : null;
    if (event.ownerId !== userId || event.mode !== mode || event.qrId !== requestedQrId || event.requestedLifeLinkId !== command.lifeLinkId || event.expectedUpdatedAt !== command.expectedUpdatedAt) {
      throw new ClaimIdempotencyConflictError();
    }
    const current = this.lifeLinks.get(command.lifeLinkId);
    return current?.ownerId === userId ? this.hydrateLifeLink(current) : null;
  }

  private recordQrBindingCommand(
    userId: string,
    mode: "set" | "clear",
    command: SetLifeLinkQrBindingCommand | ClearLifeLinkQrBindingCommand
  ): void {
    this.claimEvents.set(command.commandId, {
      commandId: command.commandId,
      qrId: "qrId" in command ? command.qrId : null,
      ownerId: userId,
      mode,
      requestedLifeLinkId: command.lifeLinkId,
      resolvedLifeLinkId: command.lifeLinkId,
      result: mode === "set" ? "bound" : "unbound",
      expectedUpdatedAt: command.expectedUpdatedAt,
      createdAt: new Date().toISOString()
    });
  }

  private captureState(): InMemoryStoreSnapshot {
    return {
      users: new Map(this.users),
      userIdsByEmail: new Map(this.userIdsByEmail),
      sessions: new Map(this.sessions),
      lifeLinks: new Map(this.lifeLinks),
      collections: new Map(this.collections),
      collectionMemberships: new Map(this.collectionMemberships),
      collectionSections: new Map(this.collectionSections),
      collectionSectionAssignments: new Map(this.collectionSectionAssignments),
      qrInventory: new Map(this.qrInventory),
      qrBindings: new Map(this.qrBindings),
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
    this.collections = snapshot.collections;
    this.collectionMemberships = snapshot.collectionMemberships;
    this.collectionSections = snapshot.collectionSections;
    this.collectionSectionAssignments = snapshot.collectionSectionAssignments;
    this.qrInventory = snapshot.qrInventory;
    this.qrBindings = snapshot.qrBindings;
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
      collections: Array.from(this.collections.values()).filter((item) => item.ownerId === ownerId).length,
      collectionSections: Array.from(this.collectionSections.values()).filter((item) => item.ownerId === ownerId).length,
      collectionMemberships: Array.from(this.collectionMemberships.values()).filter((item) => item.ownerId === ownerId).length,
      collectionSectionAssignments: Array.from(this.collectionSectionAssignments.values()).filter((item) => item.ownerId === ownerId).length,
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
    for (const item of fixture.collections) {
      const existing = this.collections.get(item.id);
      if (existing && existing.ownerId !== ownerId) throw new Error("Competition fixture Collection identity collides with another owner.");
    }
    for (const item of fixture.collectionSections) {
      const existing = this.collectionSections.get(item.id);
      if (existing && existing.ownerId !== ownerId) throw new Error("Competition fixture Section identity collides with another owner.");
    }
    for (const event of this.claimEvents.values()) {
      if (
        event.ownerId !== ownerId &&
        (fixtureQrIds.has(event.qrId ?? "") ||
          ownerQrIds.has(event.qrId ?? "") ||
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
    removeMapEntries(this.collectionSectionAssignments, (assignment) => assignment.ownerId === ownerId);
    removeMapEntries(this.collectionMemberships, (membership) => membership.ownerId === ownerId);
    removeMapEntries(this.collectionSections, (section) => section.ownerId === ownerId);
    removeMapEntries(this.collections, (collection) => collection.ownerId === ownerId);
    removeMapEntries(this.media, (item) => item.ownerId === ownerId);
    removeMapEntries(this.qrBindings, (binding) => ownerLifeLinkIds.has(binding.lifeLinkId));
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
    this.users.set(ownerId, {
      ...fixture.owner,
      passwordHash,
      agentConnectedAt: existingOwner?.agentConnectedAt ?? null
    });
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
    for (const item of fixture.collections) this.collections.set(item.id, { ...item });
    for (const item of fixture.collectionSections) this.collectionSections.set(item.id, { ...item });
    for (const item of fixture.collectionMemberships) this.collectionMemberships.set(membershipKey(item.collectionId, item.lifeLinkId), { ...item });
    for (const item of fixture.collectionSectionAssignments) this.collectionSectionAssignments.set(assignmentKey(item.collectionId, item.lifeLinkId, item.sectionId), { ...item });
  }

  private assertCompetitionFixturePostcondition(
    fixture: CompetitionFixtureData,
    passwordHash: string,
    actual: CompetitionFixtureCounts,
    expected: CompetitionFixtureCounts
  ): void {
    if (!sameCompetitionFixtureCounts(actual, expected)) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture reset produced unexpected account-local counts.");
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
      throw new CompetitionFixtureShapeMismatchError("Competition fixture owner postcondition failed.");
    }
    if (
      JSON.stringify(this.batches.get(fixture.batch.id)) !== JSON.stringify(fixture.batch) ||
      JSON.stringify(this.batchQrIds.get(fixture.batch.id)) !==
        JSON.stringify(fixture.qrInventory.map((item) => item.id))
    ) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture batch postcondition failed.");
    }
    for (const expectedLifeLink of fixture.lifeLinks) {
      const actualLifeLink = this.lifeLinks.get(expectedLifeLink.id);
      if (!actualLifeLink || !sameStoredLifeLink(actualLifeLink, expectedLifeLink)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture Life Link postcondition failed.");
      }
    }
    for (const expectedQr of fixture.qrInventory) {
      if (JSON.stringify(this.qrInventory.get(expectedQr.id)) !== JSON.stringify(expectedQr)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture QR postcondition failed.");
      }
    }
    for (const expectedBinding of fixture.qrBindings) {
      if (JSON.stringify(this.qrBindings.get(expectedBinding.qrId)) !== JSON.stringify(expectedBinding)) {
        throw new CompetitionFixtureShapeMismatchError("Competition fixture binding postcondition failed.");
      }
    }
    for (const item of fixture.collections) {
      if (JSON.stringify(this.collections.get(item.id)) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Collection postcondition failed.");
    }
    for (const item of fixture.collectionSections) {
      if (JSON.stringify(this.collectionSections.get(item.id)) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section postcondition failed.");
    }
    for (const item of fixture.collectionMemberships) {
      if (JSON.stringify(this.collectionMemberships.get(membershipKey(item.collectionId, item.lifeLinkId))) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture membership postcondition failed.");
    }
    for (const item of fixture.collectionSectionAssignments) {
      if (JSON.stringify(this.collectionSectionAssignments.get(assignmentKey(item.collectionId, item.lifeLinkId, item.sectionId))) !== JSON.stringify(item)) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section assignment postcondition failed.");
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
    return projectLifeLinkAsLink(hydrated, qr);
  }

  private changeScope(userId: string, input: PreviewLifeLinkChangeInput) {
    return resolveLifeLinkChangeScope(this.hydrateOwnerLifeLinks(userId), userId, input);
  }

  private changeSideEffects(ids: string[]) {
    const selected = new Set(ids);
    return {
      lifeLinks: selected.size,
      media: [...this.media.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      qrBindings: [...this.qrBindings.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      collectionMemberships: [...this.collectionMemberships.values()].filter((row) => selected.has(row.lifeLinkId)).length,
      collectionSectionAssignments: [...this.collectionSectionAssignments.values()].filter((row) => selected.has(row.lifeLinkId)).length
    };
  }

  private changeFingerprint(userId: string, input: PreviewLifeLinkChangeInput): string {
    const scope = this.changeScope(userId, input);
    const ids = new Set(scope.items.map((row) => row.id));
    const related = <T extends { lifeLinkId: string }>(map: Map<string, T>) => [...map].filter(([, row]) => ids.has(row.lifeLinkId)).sort(([a], [b]) => a.localeCompare(b));
    return createHash("sha256").update(stableChangeFingerprint({ ...scope,
      memberships: related(this.collectionMemberships), assignments: related(this.collectionSectionAssignments),
      bindings: related(this.qrBindings)
    })).digest("hex");
  }

  private changeTables(): OwnerChangeSnapshot {
    return { lifeLinks: this.lifeLinks, collections: this.collections, collectionMemberships: this.collectionMemberships,
      collectionSections: this.collectionSections, collectionSectionAssignments: this.collectionSectionAssignments,
      qrBindings: this.qrBindings, media: this.media };
  }

  private ownerChangeSnapshot(ownerId: string): OwnerChangeSnapshot {
    const tables = this.changeTables();
    return Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, new Map([...rows].filter(([, value]) => {
      const row = value as { ownerId?: string; lifeLinkId?: string };
      return table === "qrBindings" ? this.lifeLinks.get(row.lifeLinkId!)?.ownerId === ownerId : row.ownerId === ownerId;
    }))])) as OwnerChangeSnapshot;
  }

  private async recordOwnerChange<T>(ownerId: string, label: string, work: () => Promise<T>): Promise<T> {
    const before = this.ownerChangeSnapshot(ownerId);
    const claimsBefore = new Map([...this.claimEvents].filter(([, row]) => row.ownerId === ownerId));
    try {
      const result = await work();
      const deltas = ownerChangeDeltas(before, this.ownerChangeSnapshot(ownerId), false);
      // Related parent rows may change only their revision when an association
      // changes. Retain those rows so Undo also invalidates stale parent edits.
      if (deltas.some((delta) => !sameChangeRow(delta.before, delta.after))) {
        const affectedIds = new Set<string>();
        for (const delta of deltas) {
          const row = (delta.before ?? delta.after) as { lifeLinkId?: string };
          if (delta.table === "lifeLinks") affectedIds.add(delta.key);
          if (row.lifeLinkId) affectedIds.add(row.lifeLinkId);
          if (["lifeLinks", "collections", "collectionSections"].includes(delta.table)) this.usedChangeIds.add(`${delta.table}\u0000${delta.key}`);
        }
        this.changeHistory.set(ownerId, [{ id: `change-${randomUUID()}`, label, createdAt: new Date().toISOString(), deltas, affectedIds: [...affectedIds] }, ...(this.changeHistory.get(ownerId) ?? [])].slice(0, CHANGE_HISTORY_LIMIT));
      }
      return result;
    } catch (error) {
      const tables = this.changeTables();
      for (const delta of ownerChangeDeltas(before, this.ownerChangeSnapshot(ownerId), false)) {
        if (delta.before === undefined) tables[delta.table].delete(delta.key);
        else tables[delta.table].set(delta.key, delta.before);
      }
      removeMapEntries(this.claimEvents, (row) => row.ownerId === ownerId);
      for (const [id, row] of claimsBefore) this.claimEvents.set(id, row);
      throw error;
    }
  }

  private async withMutationLocks<T>(keys: string[], ownerId: string, label: string, work: () => Promise<T>): Promise<T> {
    // The in-memory store has one event-loop transaction boundary. Only this
    // owner's row deltas are retained or restored; other owners are never snapshotted.
    return this.withLocks([CHANGE_MUTATION_LOCK, ...keys], () => this.recordOwnerChange(ownerId, label, work));
  }

  private assertFreshChangeIdentity(table: ChangeTable, id: string): void {
    if (this.usedChangeIds.has(`${table}\u0000${id}`)) throw new LifeLinkDomainError(
      table === "collections" ? "duplicate_collection_id" : table === "collectionSections" ? "duplicate_section_id" : "duplicate_life_link_id",
      "This stable identity has already been used.");
  }

  private qrReservedForAnotherOwner(ownerId: string | null, qrId: string): boolean {
    for (const [otherOwner, entries] of this.changeHistory) {
      if (otherOwner === ownerId) continue;
      if (entries.some((entry) => entry.deltas.some((delta) => delta.table === "qrBindings" && delta.key === qrId && delta.before !== undefined))) {
        return true;
      }
    }
    return false;
  }

  private assertQrHistoryAvailable(ownerId: string, qrId: string): void {
    if (this.qrReservedForAnotherOwner(ownerId, qrId)) throw new LifeLinkDomainError("qr_already_bound", "This QR is temporarily reserved by a recoverable owner change.");
  }

  private async changeReplay(ownerId: string, commandId: string, request: object): Promise<LifeLinkChangeResult | null> {
    if (typeof commandId !== "string" || !commandId.trim() || commandId.length > 128) throw new LifeLinkDomainError("invalid_life_link", "A stable command ID is required.");
    const receipt = this.changeReceipts.get(commandId);
    if (!receipt) return null;
    if (receipt.ownerId !== ownerId || receipt.request !== stableChangeFingerprint(request)) throw new ClaimIdempotencyConflictError();
    return { operation: receipt.operation, affectedIds: [...receipt.affectedIds], history: await this.getChangeHistory(ownerId) };
  }

  private rememberChange(ownerId: string, commandId: string, request: object, result: LifeLinkChangeResult): void {
    this.changeReceipts.set(commandId, { ownerId, request: stableChangeFingerprint(request), operation: result.operation, affectedIds: [...result.affectedIds] });
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

function sameChangeRow(left: unknown, right: unknown): boolean {
  const comparable = (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const { updatedAt: _updatedAt, ...rest } = value as Record<string, unknown>;
    return rest;
  };
  return isDeepStrictEqual(comparable(left), comparable(right));
}

function ownerChangeDeltas(before: OwnerChangeSnapshot, after: OwnerChangeSnapshot, ignoreRevisions = true): ChangeDelta[] {
  const deltas: ChangeDelta[] = [];
  for (const table of Object.keys(before) as ChangeTable[]) {
    for (const key of new Set([...before[table].keys(), ...after[table].keys()])) {
      const previous = before[table].get(key); const next = after[table].get(key);
      if (ignoreRevisions ? sameChangeRow(previous, next) : isDeepStrictEqual(previous, next)) continue;
      deltas.push({ table, key, before: previous, after: next });
    }
  }
  return deltas;
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
    collections: fixture.collections.length,
    collectionSections: fixture.collectionSections.length,
    collectionMemberships: fixture.collectionMemberships.length,
    collectionSectionAssignments: fixture.collectionSectionAssignments.length,
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
  expected: CompetitionFixtureCounts,
  shapeMatchesExpected: boolean
): CompetitionFixtureResetReport {
  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    ownerId: COMPETITION_OWNER_ID,
    mode,
    applied: mode === "apply",
    before,
    after,
    expected,
    shapeMatchesExpected
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

function copyCollection(collection: CollectionRecord): CollectionRecord {
  return { ...collection };
}

function membershipKey(collectionId: string, lifeLinkId: string): string {
  return JSON.stringify([collectionId, lifeLinkId]);
}

function assignmentKey(collectionId: string, lifeLinkId: string, sectionId: string): string {
  return JSON.stringify([collectionId, lifeLinkId, sectionId]);
}

function assertCollectionFresh(collection: CollectionRecord, expectedUpdatedAt: string): void {
  if (collection.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_collection", "Collection changed after it was read.", { retryable: true });
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
