import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import {
  type ClaimQrCommand,
  type ClaimResult,
  type CompetitionFixtureData,
  type CollectionRecord,
  type CollectionSectionRecord,
  type CollectionSectionMutationResult,
  type LifeLinkCollectionMembership,
  type CreateCollectionCommand,
  type UpdateCollectionCommand,
  type CollectionMemberCommand,
  type CreateCollectionSectionCommand,
  type UpdateCollectionSectionCommand,
  type RemoveCollectionSectionCommand,
  type ReplaceCollectionSectionAssignmentsCommand,
  type SetLifeLinkQrBindingCommand,
  type ClearLifeLinkQrBindingCommand,
  type CreateLifeLinkCommand,
  type ExportBatchRecord,
  type LifeLinkDetail,
  LifeLinkDomainError,
  type LifeLinkMediaRecord,
  type LifeLinkPage,
  type LifeLinkPageRequest,
  type LifeLinkQrBindingRecord,
  type LifeLinkRecord,
  type LifeLinkSearchResult,
  type LifeLinkSummary,
  type LinkMediaRecord,
  type LinkRecord,
  type MoveLifeLinkCommand,
  type QrInventoryRecord,
  type QrViewState,
  type UpdateLifeLinkCommand,
  type PreviewLifeLinkChangeInput,
  type LifeLinkChangePreview,
  type LifeLinkChangeResult,
  type ApplyLifeLinkChangeInput,
  type UndoChangeInput,
  type ChangeHistory,
  resolveLifeLinkChangeScope,
  lifeLinkChangePreviewItem,
  stableChangeFingerprint,
  LINK_BODY_DOC_VERSION,
  MAX_MEDIA_PER_LINK,
  assertLifeLinkMediaBytes,
  assertLifeLinkBodyPatchIsCoordinated,
  assertLifeLinkContentWithinBounds,
  assertValidLifeLinkParentPlacement,
  applyLifeLinkPatch,
  buildQrUrl,
  coordinateLifeLinkBody,
  compareCollectionTitleOrder as compareTitledRecords,
  compareCollectionSectionOrder as compareSections,
  createCanonicalLifeLink,
  createCanonicalCollection,
  createCanonicalCollectionSection,
  createCompetitionFixtureData,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  generateQrIds,
  mapLegacyLinkToLifeLinkId,
  normalizeBatchCount,
  normalizeLinkBodyDoc,
  normalizeLifeLinkContext,
  normalizePublicFieldKeys,
  normalizeCollectionPatch,
  normalizeCollectionId,
  normalizeCollectionSectionId,
  normalizeCollectionSectionTitle,
  normalizeCollectionSectionIds,
  normalizeSetLifeLinkQrBindingCommand,
  normalizeClearLifeLinkQrBindingCommand,
  lifeLinkCreatePayloadMatches,
  pageCollectionRecords,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectPrivateClaimedQrAsLink,
  projectUnclaimedQrAsLink,
  projectPublicLifeLinkAsLink,
  searchCanonicalLifeLinks
} from "@life-links/core";

import { hashPassword, verifyPassword } from "./password.js";
import {
  assertQrNotReservedByOtherOwner, assertUnusedContentId, getPostgresChangeHistory,
  loadOwnerContentRows, recordOwnerChange, restoreOwnerChange
} from "./postgres-change-journal.js";
import {
  ClaimIdempotencyConflictError,
  CompetitionFixtureShapeMismatchError,
  assertCompetitionFixtureResetMode,
  createCompetitionFixtureResetReport,
  type BatchCreateResult,
  type ClaimOutcome,
  type CompetitionFixtureCounts,
  type CompetitionFixtureResetOptions,
  type CompetitionFixtureResetReport,
  type LifeLinkMediaFile,
  type LifeLinksStore,
  type LinkMediaFile,
  type LinkMediaInput,
  type SessionRecord,
  type StoredUser,
  expectedCompetitionFixtureCounts,
  sameCompetitionFixtureCounts
} from "./store.js";

type Queryable = Pick<Pool, "query">;
type StoredLifeLink = Omit<LifeLinkRecord, "qrId" | "media">;

export class PostgresLifeLinksStore implements LifeLinksStore {
  constructor(private readonly pool: Pool) {}

  async getUserByEmail(email: string): Promise<StoredUser | null> {
    const result = await this.pool.query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async getUserById(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async connectAgent(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query(
      "UPDATE users SET agent_connected_at = COALESCE(agent_connected_at, now()) WHERE id = $1 RETURNING *",
      [userId]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async disconnectAgent(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query(
      "UPDATE users SET agent_connected_at = NULL WHERE id = $1 RETURNING *",
      [userId]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: new Date().toISOString()
    };
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)",
      [session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt]
    );
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<(SessionRecord & { user: StoredUser }) | null> {
    const result = await this.pool.query(
      `SELECT s.*, u.id AS user_id_value, u.email, u.display_name, u.password_hash,
              u.agent_connected_at AS user_agent_connected_at, u.created_at AS user_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      userId: String(row.user_id),
      tokenHash: String(row.token_hash),
      expiresAt: toIso(row.expires_at),
      createdAt: toIso(row.created_at),
      user: {
        id: String(row.user_id_value),
        email: String(row.email),
        displayName: String(row.display_name),
        passwordHash: String(row.password_hash),
        agentConnectedAt: nullableIso(row.user_agent_connected_at),
        createdAt: toIso(row.user_created_at)
      }
    };
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async listLifeLinks(
    userId: string,
    parentId: string | null,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<LifeLinkSummary>> {
    return pageLifeLinkChildren(await this.loadOwnerLifeLinks(this.pool, userId), userId, parentId, page);
  }

  async getLifeLinkDetail(
    userId: string,
    lifeLinkId: string,
    page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkDetail | null> {
    const lifeLinks = await this.loadOwnerLifeLinks(this.pool, userId);
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
    return searchCanonicalLifeLinks(await this.loadOwnerLifeLinks(this.pool, userId), userId, query, options);
  }

  async createLifeLink(command: CreateLifeLinkCommand): Promise<LifeLinkRecord> {
    const candidate = createCanonicalLifeLink(command);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`life-link-id:${candidate.id}`, `owner:${command.ownerId}`]);
      const before = await loadOwnerContentRows(client, command.ownerId);
      const existingResult = await client.query("SELECT * FROM life_links WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (existingResult.rows[0]) {
        const existing = mapStoredLifeLink(existingResult.rows[0]);
        if (!lifeLinkCreatePayloadMatches(hydrateWithoutRelations(existing), command)) {
          throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identity is already bound to another record.");
        }
        await client.query("COMMIT");
      } else {
        await assertUnusedContentId(client, "life_links", candidate.id);
        const ownerLifeLinks = await this.loadOwnerLifeLinks(client, command.ownerId);
        assertValidLifeLinkParentPlacement([...ownerLifeLinks, candidate], candidate.id, candidate.parentId);
        await insertLifeLink(client, withoutRelations(candidate));
        await recordOwnerChange(client, command.ownerId, "Create Life Link", before);
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return (await this.loadLifeLink(this.pool, candidate.id))!;
  }

  async updateLifeLink(userId: string, command: UpdateLifeLinkCommand): Promise<LifeLinkRecord | null> {
    const client = await this.pool.connect();
    let found = false;
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      const before = await loadOwnerContentRows(client, userId);
      const result = await client.query("SELECT * FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [
        command.lifeLinkId,
        userId
      ]);
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      found = true;
      const current = mapStoredLifeLink(result.rows[0]);
      assertFresh(current, command.expectedUpdatedAt);
      const updated = applyLifeLinkPatch(hydrateWithoutRelations(current), command.patch, nextTimestamp(current.updatedAt));
      if (stableChangeFingerprint({ ...updated, updatedAt: current.updatedAt }) === stableChangeFingerprint(hydrateWithoutRelations(current))) {
        await client.query("COMMIT");
        return this.loadLifeLink(this.pool, command.lifeLinkId);
      }
      const title = updated.title;
      await client.query(
        `UPDATE life_links
         SET title = $3, body = $4, body_doc = $5::jsonb, body_doc_version = $6, privacy = $7, updated_at = $8,
             context = $9::jsonb, public_field_keys = $10
         WHERE id = $1 AND owner_id = $2`,
        [
          current.id,
          userId,
          title,
          updated.body,
          JSON.stringify(updated.bodyDoc),
          updated.bodyDocVersion,
          updated.privacy,
          updated.updatedAt,
          JSON.stringify(updated.context),
          updated.publicFieldKeys
        ]
      );
      await recordOwnerChange(client, userId, "Edit Life Link", before);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return found ? this.loadLifeLink(this.pool, command.lifeLinkId) : null;
  }

  async moveLifeLink(userId: string, command: MoveLifeLinkCommand): Promise<LifeLinkRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      const before = await loadOwnerContentRows(client, userId);
      const result = await client.query("SELECT * FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [
        command.lifeLinkId,
        userId
      ]);
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const current = mapStoredLifeLink(result.rows[0]);
      if (current.parentId === command.parentId) {
        await client.query("COMMIT");
        return this.loadLifeLink(this.pool, command.lifeLinkId);
      }
      assertFresh(current, command.expectedUpdatedAt);
      const ownerLifeLinks = await this.loadOwnerLifeLinks(client, userId);
      assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, command.parentId);
      await client.query("UPDATE life_links SET parent_id = $3, updated_at = $4, placement_confirmed_at = $4 WHERE id = $1 AND owner_id = $2", [
        current.id,
        userId,
        command.parentId,
        nextTimestamp(current.updatedAt)
      ]);
      await recordOwnerChange(client, userId, "Move Life Link", before);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.loadLifeLink(this.pool, command.lifeLinkId);
  }

  async listCollections(userId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<CollectionRecord>> {
    const result = await this.pool.query("SELECT * FROM collections WHERE owner_id = $1", [userId]);
    return pageCollectionRecords(result.rows.map(mapCollection).sort(compareTitledRecords), page);
  }

  async previewLifeLinkChange(userId: string, input: PreviewLifeLinkChangeInput): Promise<LifeLinkChangePreview> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const { preview, fingerprint } = await this.buildLifeLinkChangePreview(client, userId, input);
      await client.query("DELETE FROM life_link_change_previews WHERE owner_id = $1 AND created_at < now() - interval '15 minutes'", [userId]);
      await client.query("INSERT INTO life_link_change_previews(id, owner_id, preview, fingerprint) VALUES ($1,$2,$3::jsonb,$4)",
        [preview.id, userId, JSON.stringify(preview), fingerprint]);
      await client.query(`DELETE FROM life_link_change_previews WHERE owner_id = $1 AND id NOT IN
        (SELECT id FROM life_link_change_previews WHERE owner_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5)`, [userId]);
      return preview;
    }, null);
  }

  async getLifeLinkChangePreview(userId: string, previewId: string): Promise<LifeLinkChangePreview | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await client.query("DELETE FROM life_link_change_previews WHERE owner_id = $1 AND created_at < now() - interval '15 minutes'", [userId]);
      const result = await client.query("SELECT preview FROM life_link_change_previews WHERE id = $1 AND owner_id = $2", [previewId, userId]);
      return result.rows[0]?.preview ?? null;
    }, null);
  }

  async applyLifeLinkChange(userId: string, input: ApplyLifeLinkChangeInput): Promise<LifeLinkChangeResult> {
    assertChangeCommandId(input.commandId);
    return this.withTransaction([`owner:${userId}`, `claim-command:${input.commandId}`], async (client) => {
      const replay = await this.readChangeReplay(client, userId, input.commandId, input.previewId, false);
      if (replay) return replay;
      const stored = await client.query(`SELECT preview, fingerprint FROM life_link_change_previews
        WHERE id = $1 AND owner_id = $2 AND created_at >= now() - interval '15 minutes'`, [input.previewId, userId]);
      if (!stored.rows[0]) throw new LifeLinkDomainError("life_link_not_found", "Change preview is unavailable or expired.");
      const preview = stored.rows[0].preview as LifeLinkChangePreview;
      const request: PreviewLifeLinkChangeInput = preview.operation === "move"
        ? { operation: "move", lifeLinkIds: preview.rootIds, parentId: preview.parentId }
        : { operation: "delete", lifeLinkIds: preview.rootIds };
      let current: Awaited<ReturnType<PostgresLifeLinksStore["buildLifeLinkChangePreview"]>>;
      try { current = await this.buildLifeLinkChangePreview(client, userId, request); }
      catch (error) {
        if (!(error instanceof LifeLinkDomainError)) throw error;
        throw stalePreview();
      }
      if (current.fingerprint !== String(stored.rows[0].fingerprint)) throw stalePreview();
      const before = await loadOwnerContentRows(client, userId);
      const changed = preview.operation === "delete" || current.preview.items.some((item) =>
        preview.rootIds.includes(item.id) && item.parentId !== preview.parentId);
      const affectedIds = changed ? preview.items.map((item) => item.id) : [];
      if (preview.operation === "move") {
        for (const rootId of preview.rootIds) {
          await client.query(`UPDATE life_links SET parent_id = $3,
            updated_at = GREATEST(now(), updated_at + interval '1 millisecond'),
            placement_confirmed_at = GREATEST(now(), updated_at + interval '1 millisecond')
            WHERE id = $1 AND owner_id = $2 AND parent_id IS DISTINCT FROM $3`, [rootId, userId, preview.parentId]);
        }
      } else {
        const collections = await client.query("SELECT DISTINCT collection_id FROM collection_memberships WHERE owner_id = $1 AND life_link_id = ANY($2::text[])", [userId, affectedIds]);
        await client.query("DELETE FROM life_link_qr_bindings WHERE life_link_id = ANY($1::text[])", [affectedIds]);
        await client.query("UPDATE life_links SET parent_id = NULL WHERE owner_id = $1 AND id = ANY($2::text[])", [userId, affectedIds]);
        await client.query("DELETE FROM life_links WHERE owner_id = $1 AND id = ANY($2::text[])", [userId, affectedIds]);
        await client.query(`UPDATE collections SET updated_at = GREATEST(now(), updated_at + interval '1 millisecond')
          WHERE owner_id = $1 AND id = ANY($2::text[])`, [userId, collections.rows.map((row) => String(row.collection_id))]);
      }
      await recordOwnerChange(client, userId, `${preview.operation === "move" ? "Move" : "Delete"} ${affectedIds.length} Life Link${affectedIds.length === 1 ? "" : "s"}`, before);
      await this.saveChangeReceipt(client, userId, input.commandId, input.previewId, preview.operation, affectedIds);
      await client.query("DELETE FROM life_link_change_previews WHERE id = $1 AND owner_id = $2", [input.previewId, userId]);
      return { operation: preview.operation, affectedIds, history: await getPostgresChangeHistory(client, userId) };
    }, null);
  }

  async getChangeHistory(userId: string): Promise<ChangeHistory> { return getPostgresChangeHistory(this.pool, userId); }

  async undoChange(userId: string, input: UndoChangeInput): Promise<LifeLinkChangeResult> {
    assertChangeCommandId(input.commandId);
    return this.withTransaction([`owner:${userId}`, `claim-command:${input.commandId}`], async (client) => {
      const replay = await this.readChangeReplay(client, userId, input.commandId, input.changeId, true);
      if (replay) return replay;
      const affectedIds = await restoreOwnerChange(client, userId, input.changeId);
      await this.saveChangeReceipt(client, userId, input.commandId, input.changeId, "undo", affectedIds);
      return { operation: "undo", affectedIds, history: await getPostgresChangeHistory(client, userId) };
    }, null);
  }

  private async buildLifeLinkChangePreview(client: PoolClient, userId: string, input: PreviewLifeLinkChangeInput): Promise<{ preview: LifeLinkChangePreview; fingerprint: string }> {
    const records = await this.loadOwnerLifeLinks(client, userId);
    const scope = resolveLifeLinkChangeScope(records, userId, input);
    const ids = new Set(scope.items.map((item) => item.id));
    const state = await loadOwnerContentRows(client, userId);
    const memberships = state.collection_memberships.filter((row) => ids.has(String(row.life_link_id)));
    const assignments = state.collection_section_assignments.filter((row) => ids.has(String(row.life_link_id)));
    const media = state.link_media.filter((row) => ids.has(String(row.life_link_id)));
    const preview: LifeLinkChangePreview = {
      id: `preview-${randomUUID()}`, operation: input.operation, rootIds: scope.rootIds,
      items: scope.items.map(lifeLinkChangePreviewItem), parentId: scope.parentId,
      target: scope.target ? lifeLinkChangePreviewItem(scope.target) : null, createdAt: new Date().toISOString(),
      sideEffects: { lifeLinks: scope.items.length, media: media.length,
        qrBindings: scope.items.filter((item) => item.qrId !== null).length,
        collectionMemberships: memberships.length, collectionSectionAssignments: assignments.length }
    };
    const fingerprint = createHash("sha256").update(stableChangeFingerprint({ operation: input.operation, ...scope, memberships, assignments, media })).digest("hex");
    return { preview, fingerprint };
  }

  private async readChangeReplay(client: PoolClient, userId: string, commandId: string, requestId: string, undo: boolean): Promise<LifeLinkChangeResult | null> {
    const result = await client.query("SELECT * FROM life_link_change_receipts WHERE command_id = $1", [commandId]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.owner_id !== userId || row.request_id !== requestId || (row.operation === "undo") !== undo) throw new ClaimIdempotencyConflictError();
    return { operation: row.operation, affectedIds: row.affected_ids, history: await getPostgresChangeHistory(client, userId) };
  }

  private async saveChangeReceipt(client: PoolClient, userId: string, commandId: string, requestId: string, operation: LifeLinkChangeResult["operation"], affectedIds: string[]): Promise<void> {
    await client.query("INSERT INTO life_link_change_receipts(command_id, owner_id, operation, request_id, affected_ids) VALUES ($1,$2,$3,$4,$5)",
      [commandId, userId, operation, requestId, affectedIds]);
  }

  async getCollection(userId: string, collectionId: string): Promise<CollectionRecord | null> {
    return loadCollection(this.pool, userId, collectionId);
  }

  async createCollection(command: CreateCollectionCommand): Promise<CollectionRecord> {
    const candidate = createCanonicalCollection(command);
    return this.withTransaction([`collection-id:${candidate.id}`, `owner:${candidate.ownerId}`], async (client) => {
      const owner = await client.query("SELECT 1 FROM users WHERE id = $1", [candidate.ownerId]);
      if (!owner.rowCount) throw new LifeLinkDomainError("invalid_collection", "Collection owner was not found.");
      const result = await client.query("SELECT * FROM collections WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (result.rows[0]) {
        const current = mapCollection(result.rows[0]);
        if (current.ownerId !== candidate.ownerId || current.title !== candidate.title ||
            current.purpose !== candidate.purpose || current.notes !== candidate.notes) {
          throw new LifeLinkDomainError("duplicate_collection_id", "Collection identity is already bound to another record.");
        }
        return current;
      }
      await assertUnusedContentId(client, "collections", candidate.id);
      await client.query(
        `INSERT INTO collections (id, owner_id, title, purpose, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [candidate.id, candidate.ownerId, candidate.title, candidate.purpose, candidate.notes, candidate.createdAt, candidate.updatedAt]
      );
      return candidate;
    }, "Create Collection");
  }

  async updateCollection(userId: string, command: UpdateCollectionCommand): Promise<CollectionRecord | null> {
    const patch = normalizeCollectionPatch(command.patch);
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      const title = patch.title ?? current.title;
      const purpose = patch.purpose ?? current.purpose;
      const notes = patch.notes ?? current.notes;
      if (title === current.title && purpose === current.purpose && notes === current.notes) return current;
      assertCollectionFresh(current, command.expectedUpdatedAt);
      const updated = { ...current, title, purpose, notes, updatedAt: nextTimestamp(current.updatedAt) };
      await client.query(
        "UPDATE collections SET title = $3, purpose = $4, notes = $5, updated_at = $6 WHERE id = $1 AND owner_id = $2",
        [current.id, userId, title, purpose, notes, updated.updatedAt]
      );
      return updated;
    }, "Edit Collection");
  }

  async listCollectionMembers(
    userId: string, collectionId: string, page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<LifeLinkRecord> | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!(await loadCollection(this.pool, userId, collectionId))) return null;
    const result = await this.pool.query(
      `SELECT ll.*, b.qr_id FROM collection_memberships m
       JOIN life_links ll ON ll.id = m.life_link_id AND ll.owner_id = m.owner_id
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
       WHERE m.owner_id = $1 AND m.collection_id = $2`, [userId, collectionId]
    );
    const members = await this.attachLifeLinkMedia(this.pool, result.rows.map(mapLifeLinkRow));
    return pageCollectionRecords(members.sort(compareTitledRecords), page);
  }

  async addCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      if (!(await ownerHasLifeLink(client, userId, command.lifeLinkId))) return null;
      const existing = await client.query(
        "SELECT 1 FROM collection_memberships WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3",
        [userId, current.id, command.lifeLinkId]
      );
      if (existing.rowCount) return current;
      assertCollectionFresh(current, command.expectedUpdatedAt);
      const updated = await touchCollection(client, current);
      await client.query(
        "INSERT INTO collection_memberships (owner_id, collection_id, life_link_id, created_at) VALUES ($1, $2, $3, $4)",
        [userId, current.id, command.lifeLinkId, updated.updatedAt]
      );
      return updated;
    }, "Add Collection member");
  }

  async removeCollectionMember(userId: string, command: CollectionMemberCommand): Promise<CollectionRecord | null> {
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      if (!(await ownerHasLifeLink(client, userId, command.lifeLinkId))) return null;
      const existing = await client.query(
        "SELECT 1 FROM collection_memberships WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3",
        [userId, current.id, command.lifeLinkId]
      );
      if (!existing.rowCount) return current;
      assertCollectionFresh(current, command.expectedUpdatedAt);
      await client.query(
        "DELETE FROM collection_memberships WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3",
        [userId, current.id, command.lifeLinkId]
      );
      return touchCollection(client, current);
    }, "Remove Collection member");
  }

  async listCollectionSections(
    userId: string, collectionId: string, page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<CollectionSectionRecord> | null> {
    collectionId = normalizeCollectionId(collectionId);
    if (!(await loadCollection(this.pool, userId, collectionId))) return null;
    const result = await this.pool.query("SELECT * FROM collection_sections WHERE owner_id = $1 AND collection_id = $2", [userId, collectionId]);
    return pageCollectionRecords(result.rows.map(mapCollectionSection).sort(compareSections), page);
  }

  async createCollectionSection(
    userId: string, command: CreateCollectionSectionCommand
  ): Promise<CollectionSectionMutationResult | null> {
    command = { ...command, id: normalizeCollectionSectionId(command.id) };
    return this.withTransaction([`owner:${userId}`, `section-id:${command.id}`], async (client) => {
      const current = await loadCollection(client, userId, command.collectionId, true);
      if (!current) return null;
      const positions = await client.query(
        "SELECT COALESCE(max(position), -1) + 1 AS position FROM collection_sections WHERE owner_id = $1 AND collection_id = $2",
        [userId, current.id]
      );
      const candidate = createCanonicalCollectionSection({
        id: command.id, ownerId: userId, collectionId: current.id, title: command.title,
        position: Number(positions.rows[0].position), createdAt: nextTimestamp(current.updatedAt)
      });
      const existing = await client.query("SELECT * FROM collection_sections WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (existing.rows[0]) {
        const section = mapCollectionSection(existing.rows[0]);
        if (section.ownerId !== userId || section.collectionId !== current.id || section.title !== candidate.title) {
          throw new LifeLinkDomainError("duplicate_section_id", "Section identity is already bound to another record.");
        }
        return { collection: current, section };
      }
      await assertUnusedContentId(client, "collection_sections", candidate.id);
      assertCollectionFresh(current, command.expectedUpdatedAt);
      await client.query(
        `INSERT INTO collection_sections (id, owner_id, collection_id, title, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [candidate.id, userId, current.id, candidate.title, candidate.position, candidate.createdAt, candidate.updatedAt]
      );
      const collection = await touchCollection(client, current, candidate.updatedAt);
      return { collection, section: candidate };
    }, "Create Section");
  }

  async updateCollectionSection(
    userId: string, command: UpdateCollectionSectionCommand
  ): Promise<CollectionSectionMutationResult | null> {
    command = { ...command, sectionId: normalizeCollectionSectionId(command.sectionId) };
    const title = normalizeCollectionSectionTitle(command.title);
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      const result = await client.query(
        "SELECT * FROM collection_sections WHERE id = $1 AND owner_id = $2 AND collection_id = $3 FOR UPDATE",
        [command.sectionId, userId, current.id]
      );
      if (!result.rows[0]) return null;
      const section = mapCollectionSection(result.rows[0]);
      if (section.title === title) return { collection: current, section };
      assertCollectionFresh(current, command.expectedUpdatedAt);
      const collection = await touchCollection(client, current);
      const updated = { ...section, title, updatedAt: collection.updatedAt };
      await client.query("UPDATE collection_sections SET title = $2, updated_at = $3 WHERE id = $1", [section.id, title, updated.updatedAt]);
      return { collection, section: updated };
    }, "Edit Section");
  }

  async removeCollectionSection(userId: string, command: RemoveCollectionSectionCommand): Promise<CollectionRecord | null> {
    command = { ...command, sectionId: normalizeCollectionSectionId(command.sectionId) };
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      const existing = await client.query(
        "SELECT 1 FROM collection_sections WHERE id = $1 AND owner_id = $2 AND collection_id = $3",
        [command.sectionId, userId, current.id]
      );
      if (!existing.rowCount) return current;
      assertCollectionFresh(current, command.expectedUpdatedAt);
      await client.query("DELETE FROM collection_sections WHERE id = $1 AND owner_id = $2 AND collection_id = $3", [command.sectionId, userId, current.id]);
      return touchCollection(client, current);
    }, "Remove Section");
  }

  async replaceCollectionSectionAssignments(
    userId: string, command: ReplaceCollectionSectionAssignmentsCommand
  ): Promise<CollectionRecord | null> {
    const sectionIds = normalizeCollectionSectionIds(command.sectionIds);
    return this.withCollectionMutation(userId, command.collectionId, async (client, current) => {
      if (!(await ownerHasLifeLink(client, userId, command.lifeLinkId))) return null;
      const membership = await client.query(
        "SELECT 1 FROM collection_memberships WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3",
        [userId, current.id, command.lifeLinkId]
      );
      if (!membership.rowCount) {
        throw new LifeLinkDomainError("collection_membership_not_found", "Life Link must be a direct Collection member.");
      }
      const sections = await client.query(
        "SELECT id FROM collection_sections WHERE owner_id = $1 AND collection_id = $2 AND id = ANY($3::text[])",
        [userId, current.id, sectionIds]
      );
      if (sections.rows.length !== sectionIds.length) {
        throw new LifeLinkDomainError("section_not_found", "A requested Section was not found in this Collection.");
      }
      const previous = await client.query(
        "SELECT section_id FROM collection_section_assignments WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3",
        [userId, current.id, command.lifeLinkId]
      );
      const existingIds = previous.rows.map((row) => String(row.section_id)).sort();
      if (JSON.stringify(existingIds) === JSON.stringify([...sectionIds].sort())) return current;
      assertCollectionFresh(current, command.expectedUpdatedAt);
      const updated = await touchCollection(client, current);
      await client.query(
        `DELETE FROM collection_section_assignments WHERE owner_id = $1 AND collection_id = $2
         AND life_link_id = $3 AND NOT (section_id = ANY($4::text[]))`,
        [userId, current.id, command.lifeLinkId, sectionIds]
      );
      for (const sectionId of sectionIds) {
        await client.query(
          `INSERT INTO collection_section_assignments (owner_id, collection_id, life_link_id, section_id, created_at)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [userId, current.id, command.lifeLinkId, sectionId, updated.updatedAt]
        );
      }
      return updated;
    }, "Change Section assignments");
  }

  async listLifeLinkCollectionMemberships(
    userId: string, lifeLinkId: string, page: LifeLinkPageRequest = {}
  ): Promise<LifeLinkPage<LifeLinkCollectionMembership> | null> {
    if (!(await ownerHasLifeLink(this.pool, userId, lifeLinkId))) return null;
    const result = await this.pool.query(
      `SELECT c.* FROM collections c JOIN collection_memberships m ON m.collection_id = c.id AND m.owner_id = c.owner_id
       WHERE m.owner_id = $1 AND m.life_link_id = $2`, [userId, lifeLinkId]
    );
    const collections = pageCollectionRecords(result.rows.map(mapCollection).sort(compareTitledRecords), page);
    const assignments = await this.pool.query(
      `SELECT s.* FROM collection_sections s JOIN collection_section_assignments a
       ON a.section_id = s.id AND a.owner_id = s.owner_id AND a.collection_id = s.collection_id
       WHERE a.owner_id = $1 AND a.life_link_id = $2 AND a.collection_id = ANY($3::text[])`,
      [userId, lifeLinkId, collections.items.map((item) => item.id)]
    );
    const sections = assignments.rows.map(mapCollectionSection).sort(compareSections);
    return { ...collections, items: collections.items.map((collection) => ({
      collection, sections: sections.filter((section) => section.collectionId === collection.id)
    })) };
  }

  async setLifeLinkQrBinding(userId: string, command: SetLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    return this.mutateQrBinding(userId, normalizeSetLifeLinkQrBindingCommand(command), "set");
  }

  async clearLifeLinkQrBinding(userId: string, command: ClearLifeLinkQrBindingCommand): Promise<LifeLinkRecord | null> {
    return this.mutateQrBinding(userId, normalizeClearLifeLinkQrBindingCommand(command), "clear");
  }

  async createLifeLinkMedia(
    userId: string,
    lifeLinkId: string,
    input: LinkMediaInput
  ): Promise<LifeLinkMediaRecord | null> {
    assertLifeLinkMediaBytes(input.sizeBytes, input.data.byteLength);
    const client = await this.pool.connect();
    let created: Omit<LifeLinkMediaRecord, "url"> | null = null;
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      const before = await loadOwnerContentRows(client, userId);
      const lifeLink = await client.query("SELECT id FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [
        lifeLinkId,
        userId
      ]);
      if (!lifeLink.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const count = await client.query("SELECT count(*)::int AS count FROM link_media WHERE life_link_id = $1", [lifeLinkId]);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_MEDIA_PER_LINK) {
        await client.query("COMMIT");
        return null;
      }
      const id = `media-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      await client.query(
        `INSERT INTO link_media (id, life_link_id, owner_id, kind, mime_type, file_name, size_bytes, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, lifeLinkId, userId, input.kind, input.mimeType, input.fileName, input.sizeBytes, input.data, createdAt]
      );
      await client.query("UPDATE life_links SET updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1", [lifeLinkId]);
      await recordOwnerChange(client, userId, "Add attachment", before);
      await client.query("COMMIT");
      created = {
        id,
        lifeLinkId,
        ownerId: userId,
        kind: input.kind,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        createdAt
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return created ? { ...created, url: await this.mediaUrlForLifeLink(this.pool, lifeLinkId, created.id) } : null;
  }

  async deleteLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<boolean> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query(
        "DELETE FROM link_media WHERE id = $1 AND life_link_id = $2 AND owner_id = $3 RETURNING id",
        [mediaId, lifeLinkId, userId]
      );
      if (result.rowCount) await client.query("UPDATE life_links SET updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1 AND owner_id = $2", [lifeLinkId, userId]);
      return Boolean(result.rowCount);
    }, "Remove attachment");
  }

  async getLifeLinkMedia(userId: string, lifeLinkId: string, mediaId: string): Promise<LifeLinkMediaFile | null> {
    const result = await this.pool.query(
      `SELECT lm.*, b.qr_id
       FROM link_media lm
       JOIN life_links ll ON ll.id = lm.life_link_id
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
       WHERE lm.id = $1 AND lm.life_link_id = $2 AND ll.owner_id = $3`,
      [mediaId, lifeLinkId, userId]
    );
    const row = result.rows[0];
    return row
      ? { media: mapLifeLinkMedia(row), data: asBuffer(row.data) }
      : null;
  }

  async listLinks(userId: string): Promise<LinkRecord[]> {
    const lifeLinks = await this.loadOwnerLifeLinks(this.pool, userId);
    const taggedQrIds = lifeLinks.flatMap((lifeLink) => (lifeLink.qrId ? [lifeLink.qrId] : []));
    const qrResult = taggedQrIds.length
      ? await this.pool.query("SELECT * FROM qr_codes WHERE id = ANY($1::text[])", [taggedQrIds])
      : { rows: [] };
    const qrById = new Map(qrResult.rows.map((row) => [String(row.id), mapQrInventory(row)]));
    const claimed = lifeLinks
      .filter((lifeLink) => Boolean(lifeLink.qrId))
      .map((lifeLink) => {
        const qr = qrById.get(lifeLink.qrId!);
        if (!qr) {
          throw new LifeLinkDomainError("invalid_life_link", "QR binding references missing inventory.");
        }
        return projectLifeLinkAsLink(lifeLink, qr);
      });
    const unclaimed = await this.pool.query(
      `SELECT q.*, EXISTS (SELECT 1 FROM saved_changes s
         WHERE s.owner_id <> $1 AND s.reserved_qr_ids @> ARRAY[q.id]::text[]) AS retained_by_other
       FROM qr_codes q
       JOIN export_batches eb ON eb.id = q.batch_id
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE eb.created_by = $1 AND b.qr_id IS NULL`,
      [userId]
    );
    return [...claimed, ...unclaimed.rows.map((row) => row.retained_by_other
      ? projectPrivateClaimedQrAsLink(mapQrInventory(row)) : projectUnclaimedQrAsLink(mapQrInventory(row)))].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      const now = new Date().toISOString();
      const safeCount = normalizeBatchCount(count);
      const batchKey = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
      const ids = generateQrIds(safeCount, batchKey);
      const batch: ExportBatchRecord = {
        id: `batch-${randomUUID()}`,
        batchKey,
        qrBaseUrl,
        count: ids.length,
        createdBy: userId,
        createdAt: now
      };
      await client.query(
        "INSERT INTO export_batches (id, batch_key, qr_base_url, count, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [batch.id, batch.batchKey, batch.qrBaseUrl, batch.count, batch.createdBy, batch.createdAt]
      );
      for (const id of ids) {
        await client.query("INSERT INTO qr_codes (id, url, batch_id, created_at) VALUES ($1, $2, $3, $4)", [
          id,
          buildQrUrl(qrBaseUrl, id),
          batch.id,
          now
        ]);
      }
      await client.query("COMMIT");
      return {
        batch,
        qrCodes: ids.map((id) => projectUnclaimedQrAsLink({ id, url: buildQrUrl(qrBaseUrl, id), createdAt: now }))
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]> {
    const batch = await this.pool.query("SELECT 1 FROM export_batches WHERE id = $1 AND created_by = $2", [batchId, userId]);
    if (!batch.rowCount) {
      return [];
    }
    const qrResult = await this.pool.query(
      `SELECT q.*, b.life_link_id, EXISTS (SELECT 1 FROM saved_changes s
         WHERE s.owner_id <> $2 AND s.reserved_qr_ids @> ARRAY[q.id]::text[]) AS retained_by_other
       FROM qr_codes q
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE q.batch_id = $1
       ORDER BY q.id ASC`,
      [batchId, userId]
    );
    const projected: LinkRecord[] = [];
    for (const row of qrResult.rows) {
      const qr = mapQrInventory(row);
      if (!row.life_link_id) {
        projected.push(row.retained_by_other ? projectPrivateClaimedQrAsLink(qr) : projectUnclaimedQrAsLink(qr));
        continue;
      }
      const lifeLink = await this.loadLifeLink(this.pool, String(row.life_link_id));
      if (!lifeLink) {
        throw new LifeLinkDomainError("invalid_life_link", "QR binding references missing Life Link.");
      }
      const ownerProjection = projectLifeLinkAsLink(lifeLink, qr);
      if (lifeLink.ownerId === userId) {
        projected.push(ownerProjection);
      } else if (lifeLink.privacy === "public") {
        projected.push(projectPublicLifeLinkAsLink(lifeLink, qr));
      } else {
        projected.push(projectPrivateClaimedQrAsLink(qr));
      }
    }
    return projected;
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const result = await this.pool.query(
      `SELECT q.*, b.life_link_id, EXISTS (SELECT 1 FROM saved_changes s
         WHERE s.owner_id IS DISTINCT FROM $2 AND s.reserved_qr_ids @> ARRAY[q.id]::text[]) AS retained_by_other
       FROM qr_codes q
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE q.id = $1`,
      [qrId, viewerUserId]
    );
    const row = result.rows[0];
    if (!row) {
      return { state: "not_found", qrId };
    }
    const qr = mapQrInventory(row);
    if (!row.life_link_id) {
      if (row.retained_by_other) return { state: "private", qrId };
      return { state: "unclaimed", qr: projectUnclaimedQrAsLink(qr) };
    }
    const lifeLink = await this.loadLifeLink(this.pool, String(row.life_link_id));
    if (!lifeLink) {
      throw new LifeLinkDomainError("invalid_life_link", "QR binding references missing Life Link.");
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === lifeLink.ownerId);
    if (lifeLink.privacy === "private" && !viewerIsOwner) {
      return { state: "private", qrId };
    }
    const projected = projectLifeLinkAsLink(lifeLink, qr);
    return {
      state: "claimed",
      link: viewerIsOwner ? projected : projectPublicLifeLinkAsLink(lifeLink, qr),
      viewerIsOwner
    };
  }

  async claimQr(qrId: string, userId: string, commandValue: string | ClaimQrCommand): Promise<ClaimOutcome> {
    const command: ClaimQrCommand = typeof commandValue === "string" ? { commandId: commandValue, mode: "create" } : commandValue;
    const mode = command.mode ?? "create";
    const requestedLifeLinkId = command.mode === "attach" ? command.lifeLinkId : null;
    const client = await this.pool.connect();
    let result: ClaimResult = "not_found";
    let replayed = false;
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`claim-command:${command.commandId}`, `claim-qr:${qrId}`, `owner:${userId}`]);
      const before = await loadOwnerContentRows(client, userId);
      const existingEvent = await client.query("SELECT * FROM claim_events WHERE command_id = $1", [command.commandId]);
      if (existingEvent.rows[0]) {
        const event = existingEvent.rows[0];
        if (
          String(event.qr_id) !== qrId ||
          String(event.owner_id) !== userId ||
          String(event.mode) !== mode ||
          nullableString(event.requested_life_link_id) !== requestedLifeLinkId
        ) {
          throw new ClaimIdempotencyConflictError();
        }
        result = event.result as ClaimResult;
        replayed = true;
      } else {
        if (command.mode === "attach") {
          const requested = await client.query("SELECT 1 FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [
            command.lifeLinkId,
            userId
          ]);
          if (!requested.rowCount) {
            throw new LifeLinkDomainError("life_link_not_found", "Attach target Life Link was not found.");
          }
        }
        const qrResult = await client.query("SELECT * FROM qr_codes WHERE id = $1 FOR UPDATE", [qrId]);
        if (qrResult.rows[0]) {
          await assertQrNotReservedByOtherOwner(client, userId, qrId);
          const bindingResult = await client.query(
            `SELECT b.*, ll.owner_id
             FROM life_link_qr_bindings b
             JOIN life_links ll ON ll.id = b.life_link_id
             WHERE b.qr_id = $1
             FOR UPDATE OF b`,
            [qrId]
          );
          if (bindingResult.rows[0]) {
            const bindingOwnerId = String(bindingResult.rows[0].owner_id);
            const boundLifeLinkId = String(bindingResult.rows[0].life_link_id);
            if (bindingOwnerId === userId && command.mode === "attach" && boundLifeLinkId !== command.lifeLinkId) {
              throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
            }
            result = bindingOwnerId === userId ? "already_owned" : "owned_by_other";
          } else {
            const now = new Date().toISOString();
            let resolvedLifeLinkId: string;
            if (command.mode === "attach") {
              const alreadyTagged = await client.query("SELECT 1 FROM life_link_qr_bindings WHERE life_link_id = $1", [
                command.lifeLinkId
              ]);
              if (alreadyTagged.rowCount) {
                throw new LifeLinkDomainError("life_link_already_tagged", "Attach target Life Link already has a QR tag.");
              }
              resolvedLifeLinkId = command.lifeLinkId;
            } else {
              resolvedLifeLinkId = `life-link-${randomUUID()}`;
              const candidate = createCanonicalLifeLink({
                id: resolvedLifeLinkId,
                ownerId: userId,
                title: "Untitled link",
                body: "",
                privacy: "public",
                createdAt: now
              });
              await insertLifeLink(client, withoutRelations(candidate));
            }
            await client.query(
              "INSERT INTO life_link_qr_bindings (qr_id, life_link_id, bound_at) VALUES ($1, $2, $3)",
              [qrId, resolvedLifeLinkId, now]
            );
            result = "claimed";
          }
        }
        const resolved = await client.query("SELECT life_link_id FROM life_link_qr_bindings WHERE qr_id = $1", [qrId]);
        await client.query(
          `INSERT INTO claim_events
             (command_id, qr_id, owner_id, mode, requested_life_link_id, resolved_life_link_id, result, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            command.commandId,
            qrId,
            userId,
            mode,
            requestedLifeLinkId,
            nullableString(resolved.rows[0]?.life_link_id),
            result,
            new Date().toISOString()
          ]
        );
      }
      await recordOwnerChange(client, userId, "Claim QR", before);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { result, state: await this.getQrState(qrId, userId), replayed };
  }

  async createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null> {
    const binding = await this.pool.query("SELECT life_link_id FROM life_link_qr_bindings WHERE qr_id = $1", [qrId]);
    if (!binding.rows[0]) {
      return null;
    }
    const media = await this.createLifeLinkMedia(userId, String(binding.rows[0].life_link_id), input);
    return media ? lifeLinkMediaAsLinkMedia(media, qrId) : null;
  }

  async deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query(
        `DELETE FROM link_media lm USING life_link_qr_bindings b
         WHERE lm.id = $1 AND lm.owner_id = $2 AND lm.life_link_id = b.life_link_id AND b.qr_id = $3
         RETURNING lm.life_link_id`, [mediaId, userId, qrId]
      );
      if (result.rows[0]) await client.query("UPDATE life_links SET updated_at = GREATEST(now(), updated_at + interval '1 millisecond') WHERE id = $1 AND owner_id = $2", [result.rows[0].life_link_id, userId]);
      return Boolean(result.rowCount);
    }, "Remove attachment");
  }

  async getLinkMedia(
    qrId: string,
    mediaId: string,
    viewerUserId: string | null
  ): Promise<LinkMediaFile | "private" | null> {
    const result = await this.pool.query(
      `SELECT lm.*, ll.privacy, ll.owner_id AS life_link_owner_id
       FROM link_media lm
       JOIN life_link_qr_bindings b ON b.life_link_id = lm.life_link_id
       JOIN life_links ll ON ll.id = lm.life_link_id
       WHERE b.qr_id = $1 AND lm.id = $2`,
      [qrId, mediaId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === String(row.life_link_owner_id));
    if (!viewerIsOwner) {
      return "private";
    }
    return {
      media: lifeLinkMediaAsLinkMedia(mapLifeLinkMedia({ ...row, qr_id: qrId }), qrId),
      data: asBuffer(row.data),
      viewerIsOwner
    };
  }

  async seedDemo(password: string, qrBaseUrl: string): Promise<void> {
    const data = createDemoSeedData(new Date().toISOString(), qrBaseUrl);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, data.users.map((user) => `owner:${user.id}`));
      for (const user of data.users) {
        const passwordHash = await hashPassword(password);
        await client.query(
          `INSERT INTO users (id, email, display_name, password_hash, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.email, user.displayName, passwordHash, user.createdAt]
        );
      }
      for (const root of data.roots) {
        if ((await client.query("SELECT 1 FROM used_content_ids WHERE entity_kind = 'life_links' AND id = $1", [root.id])).rowCount) continue;
        await client.query(
          `INSERT INTO life_links
             (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at, browsing_role)
           VALUES ($1, $2, NULL, $3, '', $4::jsonb, $5, 'private', $6, $6, 'container')
           ON CONFLICT (id) DO NOTHING`,
          [root.id, root.ownerId, root.title, JSON.stringify(root.bodyDoc), root.bodyDocVersion, root.createdAt]
        );
      }
      await client.query(
        `INSERT INTO export_batches (id, batch_key, qr_base_url, count, created_by, created_at)
         VALUES ('batch-demo-seed', 'DEMO', $1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [qrBaseUrl, data.links.length, data.users[0].id, data.links[0]?.createdAt ?? new Date().toISOString()]
      );
      for (const link of data.links) {
        await client.query(
          `INSERT INTO qr_codes (id, url, batch_id, created_at)
           VALUES ($1, $2, 'batch-demo-seed', $3)
           ON CONFLICT (id) DO NOTHING`,
          [link.id, link.url, link.createdAt]
        );
        if (link.status === "claimed") {
          const lifeLinkId = mapLegacyLinkToLifeLinkId(link.id);
          // Ordinary startup seed never resurrects deleted content or reattaches
          // a QR the owner intentionally detached. Explicit reset owns restore.
          if ((await client.query("SELECT 1 FROM used_content_ids WHERE entity_kind = 'life_links' AND id = $1", [lifeLinkId])).rowCount) continue;
          await client.query(
            `INSERT INTO life_links
               (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at, public_field_keys)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
             ON CONFLICT (id) DO NOTHING`,
            [
              lifeLinkId,
              link.ownerId,
              link.parentId,
              link.title,
              link.body,
              JSON.stringify(link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body)),
              link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
              link.privacy,
              link.createdAt,
              link.updatedAt,
              link.privacy === "public" ? ["notes"] : []
            ]
          );
          await client.query(
            `INSERT INTO life_link_qr_bindings (qr_id, life_link_id, bound_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (qr_id) DO NOTHING`,
            [link.id, lifeLinkId, link.updatedAt]
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetCompetitionFixture(options: CompetitionFixtureResetOptions): Promise<CompetitionFixtureResetReport> {
    const fixture = createCompetitionFixtureData(options.password, options.qrBaseUrl);
    const mode = options.mode ?? "dry-run";
    assertCompetitionFixtureResetMode(mode);
    const expected = expectedCompetitionFixtureCounts(fixture);
    const client = await this.pool.connect();
    try {
      await client.query(
        mode === "dry-run"
          ? "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"
      );
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `life-links-competition-fixture:${fixture.profile}`
      ]);
      await lockKeys(client, [`owner:${fixture.owner.id}`]);
      await assertPostgresCompetitionFixturePreflight(client, fixture);
      const before = await postgresCompetitionFixtureCounts(client, fixture.owner.id);
      if (mode === "dry-run") {
        let shapeMatchesExpected = false;
        try {
          await assertPostgresCompetitionFixturePostcondition(client, fixture, options.password, before, expected);
          shapeMatchesExpected = true;
        } catch (error) {
          if (!(error instanceof CompetitionFixtureShapeMismatchError)) throw error;
        }
        await client.query("ROLLBACK");
        return createCompetitionFixtureResetReport(mode, before, before, expected, shapeMatchesExpected);
      }

      const passwordHash = await hashPassword(options.password);
      await replacePostgresCompetitionFixture(client, fixture, passwordHash);
      const after = await postgresCompetitionFixtureCounts(client, fixture.owner.id);
      await assertPostgresCompetitionFixturePostcondition(client, fixture, options.password, after, expected);
      await client.query("COMMIT");
      return createCompetitionFixtureResetReport(mode, before, after, expected, true);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async checkReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withTransaction<T>(keys: string[], work: (client: PoolClient) => Promise<T>, label: string | null): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, keys);
      const ownerId = keys.find((key) => key.startsWith("owner:"))?.slice(6);
      const before = ownerId && label ? await loadOwnerContentRows(client, ownerId) : null;
      const value = await work(client);
      if (before && ownerId && label) await recordOwnerChange(client, ownerId, label, before);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async withCollectionMutation<T>(
    userId: string, collectionId: string,
    work: (client: PoolClient, collection: CollectionRecord) => Promise<T>, label: string
  ): Promise<T | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const current = await loadCollection(client, userId, collectionId, true);
      return current ? work(client, current) : null;
    }, label);
  }

  private async mutateQrBinding(
    userId: string, command: SetLifeLinkQrBindingCommand | ClearLifeLinkQrBindingCommand, mode: "set" | "clear"
  ): Promise<LifeLinkRecord | null> {
    const qrId = mode === "set" ? (command as SetLifeLinkQrBindingCommand).qrId : null;
    const keys = [`claim-command:${command.commandId}`, `owner:${userId}`];
    if (qrId !== null) keys.push(`claim-qr:${qrId}`);
    return this.withTransaction(keys, async (client) => {
      const receipt = await client.query("SELECT * FROM claim_events WHERE command_id = $1", [command.commandId]);
      if (receipt.rows[0]) {
        const event = receipt.rows[0];
        if (String(event.owner_id) !== userId || String(event.mode) !== mode ||
            nullableString(event.qr_id) !== qrId || nullableString(event.requested_life_link_id) !== command.lifeLinkId ||
            nullableString(event.expected_updated_at) !== command.expectedUpdatedAt) {
          throw new ClaimIdempotencyConflictError();
        }
        const current = await this.loadLifeLink(client, command.lifeLinkId);
        return current?.ownerId === userId ? current : null;
      }
      const result = await client.query("SELECT * FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [command.lifeLinkId, userId]);
      if (!result.rows[0]) return null;
      const current = mapStoredLifeLink(result.rows[0]);
      if (qrId !== null) {
        const qr = await client.query("SELECT 1 FROM qr_codes WHERE id = $1 FOR UPDATE", [qrId]);
        if (!qr.rowCount) throw new LifeLinkDomainError("qr_not_found", "QR was not found.");
        await assertQrNotReservedByOtherOwner(client, userId, qrId);
        const occupied = await client.query("SELECT life_link_id FROM life_link_qr_bindings WHERE qr_id = $1 FOR UPDATE", [qrId]);
        if (occupied.rows[0] && String(occupied.rows[0].life_link_id) !== current.id) {
          throw new LifeLinkDomainError("qr_already_bound", "QR is already bound to another Life Link.");
        }
      }
      const previous = await client.query("SELECT qr_id FROM life_link_qr_bindings WHERE life_link_id = $1 FOR UPDATE", [current.id]);
      const previousQrId = nullableString(previous.rows[0]?.qr_id);
      if (previousQrId !== qrId) {
        assertFresh(current, command.expectedUpdatedAt);
        const changedAt = nextTimestamp(current.updatedAt);
        await client.query("DELETE FROM life_link_qr_bindings WHERE life_link_id = $1", [current.id]);
        if (qrId !== null) {
          await client.query("INSERT INTO life_link_qr_bindings (qr_id, life_link_id, bound_at) VALUES ($1, $2, $3)", [qrId, current.id, changedAt]);
        }
        await client.query("UPDATE life_links SET updated_at = $2 WHERE id = $1", [current.id, changedAt]);
      }
      await client.query(
        `INSERT INTO claim_events
           (command_id, qr_id, owner_id, mode, requested_life_link_id, resolved_life_link_id, result, created_at, expected_updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
        [command.commandId, qrId, userId, mode, current.id, mode === "set" ? "bound" : "unbound", new Date().toISOString(), command.expectedUpdatedAt]
      );
      return this.loadLifeLink(client, current.id);
    }, mode === "set" ? "Change QR binding" : "Detach QR");
  }

  private async loadOwnerLifeLinks(queryable: Queryable, userId: string): Promise<LifeLinkRecord[]> {
    const result = await queryable.query(
      `SELECT ll.*, b.qr_id
       FROM life_links ll
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
       WHERE ll.owner_id = $1`,
      [userId]
    );
    return this.attachLifeLinkMedia(queryable, result.rows.map(mapLifeLinkRow));
  }

  private async loadLifeLink(queryable: Queryable, lifeLinkId: string): Promise<LifeLinkRecord | null> {
    const result = await queryable.query(
      `SELECT ll.*, b.qr_id
       FROM life_links ll
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
       WHERE ll.id = $1`,
      [lifeLinkId]
    );
    if (!result.rows[0]) {
      return null;
    }
    return (await this.attachLifeLinkMedia(queryable, [mapLifeLinkRow(result.rows[0])]))[0] ?? null;
  }

  private async attachLifeLinkMedia(queryable: Queryable, lifeLinks: LifeLinkRecord[]): Promise<LifeLinkRecord[]> {
    if (!lifeLinks.length) {
      return lifeLinks;
    }
    const result = await queryable.query(
      `SELECT lm.id, lm.life_link_id, lm.owner_id, lm.kind, lm.mime_type, lm.file_name,
              lm.size_bytes, lm.created_at, b.qr_id
       FROM link_media lm
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = lm.life_link_id
       WHERE lm.life_link_id = ANY($1::text[])
       ORDER BY lm.created_at ASC, lm.id ASC`,
      [lifeLinks.map((item) => item.id)]
    );
    const byLifeLink = new Map<string, LifeLinkMediaRecord[]>();
    for (const row of result.rows) {
      const media = mapLifeLinkMedia(row);
      const current = byLifeLink.get(media.lifeLinkId) ?? [];
      current.push(media);
      byLifeLink.set(media.lifeLinkId, current);
    }
    return lifeLinks.map((lifeLink) => ({ ...lifeLink, media: byLifeLink.get(lifeLink.id) ?? [] }));
  }

  private async mediaUrlForLifeLink(queryable: Queryable, lifeLinkId: string, mediaId: string): Promise<string> {
    const result = await queryable.query("SELECT qr_id FROM life_link_qr_bindings WHERE life_link_id = $1", [lifeLinkId]);
    const qrId = nullableString(result.rows[0]?.qr_id);
    return qrId ? mediaUrl(qrId, mediaId) : lifeLinkMediaUrl(lifeLinkId, mediaId);
  }
}

export function createPostgresStore(databaseUrl: string, schemaName?: string): { store: PostgresLifeLinksStore; pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    options: schemaName ? `-c search_path=${schemaName}` : undefined
  });
  return { store: new PostgresLifeLinksStore(pool), pool };
}

async function postgresCompetitionFixtureCounts(
  queryable: Queryable,
  ownerId: string
): Promise<CompetitionFixtureCounts> {
  const result = await queryable.query(
    `WITH owner_life_links AS (
       SELECT id FROM life_links WHERE owner_id = $1
     ), owner_batches AS (
       SELECT id FROM export_batches WHERE created_by = $1
     )
     SELECT
       (SELECT count(*)::int FROM users WHERE id = $1) AS users,
       (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions,
       (SELECT count(*)::int FROM owner_life_links) AS life_links,
       (SELECT count(*)::int FROM life_link_qr_bindings WHERE life_link_id IN (SELECT id FROM owner_life_links)) AS qr_bindings,
       (SELECT count(*)::int FROM collections WHERE owner_id = $1) AS collections,
       (SELECT count(*)::int FROM collection_sections WHERE owner_id = $1) AS collection_sections,
       (SELECT count(*)::int FROM collection_memberships WHERE owner_id = $1) AS collection_memberships,
       (SELECT count(*)::int FROM collection_section_assignments WHERE owner_id = $1) AS collection_section_assignments,
       (SELECT count(*)::int FROM link_media WHERE owner_id = $1) AS media,
       (SELECT count(*)::int FROM owner_batches) AS batches,
       (SELECT count(*)::int FROM qr_codes WHERE batch_id IN (SELECT id FROM owner_batches)) AS qr_codes,
       (SELECT count(*)::int FROM claim_events WHERE owner_id = $1) AS claim_events`,
    [ownerId]
  );
  const row = result.rows[0];
  return {
    users: Number(row.users),
    sessions: Number(row.sessions),
    lifeLinks: Number(row.life_links),
    qrBindings: Number(row.qr_bindings),
    collections: Number(row.collections),
    collectionSections: Number(row.collection_sections),
    collectionMemberships: Number(row.collection_memberships),
    collectionSectionAssignments: Number(row.collection_section_assignments),
    media: Number(row.media),
    batches: Number(row.batches),
    qrCodes: Number(row.qr_codes),
    claimEvents: Number(row.claim_events)
  };
}

async function assertPostgresCompetitionFixturePreflight(
  client: PoolClient,
  fixture: CompetitionFixtureData
): Promise<void> {
  const ownerId = fixture.owner.id;
  const lifeLinkIds = fixture.lifeLinks.map((item) => item.id);
  const qrIds = fixture.qrInventory.map((item) => item.id);
  const emailConflict = await client.query(
    "SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1",
    [fixture.owner.email, ownerId]
  );
  if (emailConflict.rowCount) {
    throw new Error("Competition fixture email is owned by another account.");
  }
  const lifeLinkCollision = await client.query(
    "SELECT 1 FROM life_links WHERE id = ANY($1::text[]) AND owner_id <> $2 LIMIT 1",
    [lifeLinkIds, ownerId]
  );
  if (lifeLinkCollision.rowCount) {
    throw new Error("Competition fixture Life Link identity collides with another owner.");
  }
  const retiredIdentityCollision = await client.query(`SELECT 1 FROM used_content_ids WHERE owner_id <> $1 AND
    ((entity_kind = 'life_links' AND id = ANY($2::text[])) OR
     (entity_kind = 'collections' AND id = ANY($3::text[])) OR
     (entity_kind = 'collection_sections' AND id = ANY($4::text[]))) LIMIT 1`,
    [ownerId, lifeLinkIds, fixture.collections.map((item) => item.id), fixture.collectionSections.map((item) => item.id)]);
  if (retiredIdentityCollision.rowCount) throw new Error("Competition fixture identity was previously used by another owner.");
  const batchCollision = await client.query(
    `SELECT 1 FROM export_batches
     WHERE (id = $1 OR batch_key = $2) AND created_by <> $3
     LIMIT 1`,
    [fixture.batch.id, fixture.batch.batchKey, ownerId]
  );
  if (batchCollision.rowCount) {
    throw new Error("Competition fixture batch identity collides with another owner.");
  }
  const qrCollision = await client.query(
    `SELECT 1
     FROM qr_codes q
     LEFT JOIN export_batches eb ON eb.id = q.batch_id
     WHERE q.id = ANY($1::text[]) AND eb.created_by IS DISTINCT FROM $2
     LIMIT 1`,
    [qrIds, ownerId]
  );
  if (qrCollision.rowCount) {
    throw new Error("Competition fixture QR identity collides with another owner.");
  }
  const qrBindingCollision = await client.query(
    `SELECT 1
     FROM life_link_qr_bindings b
     JOIN life_links ll ON ll.id = b.life_link_id
     WHERE b.qr_id = ANY($1::text[]) AND ll.owner_id <> $2
     LIMIT 1`,
    [qrIds, ownerId]
  );
  if (qrBindingCollision.rowCount) {
    throw new Error("Competition fixture QR binding collides with another owner.");
  }
  const retainedQrCollision = await client.query(`SELECT 1 FROM saved_changes s
    WHERE s.owner_id <> $1 AND EXISTS (SELECT 1 FROM unnest(s.reserved_qr_ids) id
      WHERE id = ANY($2::text[]) OR id IN (SELECT q.id FROM qr_codes q JOIN export_batches b ON b.id = q.batch_id WHERE b.created_by = $1)) LIMIT 1`, [ownerId, qrIds]);
  if (retainedQrCollision.rowCount) throw new Error("Competition fixture QR inventory is retained by another owner's saved change.");
  for (const [table, ids] of [
    ["collections", fixture.collections.map((item) => item.id)],
    ["collection_sections", fixture.collectionSections.map((item) => item.id)]
  ] as const) {
    const collision = await client.query(
      `SELECT 1 FROM ${table} WHERE id = ANY($1::text[]) AND owner_id <> $2 LIMIT 1`, [ids, ownerId]
    );
    if (collision.rowCount) {
      throw new Error("Competition fixture Collection or Section identity collides with another owner.");
    }
  }
  const ownerBatchBindingToOther = await client.query(
    `SELECT 1
     FROM qr_codes q
     JOIN export_batches eb ON eb.id = q.batch_id
     JOIN life_link_qr_bindings b ON b.qr_id = q.id
     JOIN life_links ll ON ll.id = b.life_link_id
     WHERE eb.created_by = $1 AND ll.owner_id <> $1
     LIMIT 1`,
    [ownerId]
  );
  if (ownerBatchBindingToOther.rowCount) {
    throw new Error("Competition sandbox QR state is bound to another owner.");
  }
  const otherBatchBindingToOwner = await client.query(
    `SELECT 1
     FROM life_link_qr_bindings b
     JOIN life_links ll ON ll.id = b.life_link_id
     JOIN qr_codes q ON q.id = b.qr_id
     LEFT JOIN export_batches eb ON eb.id = q.batch_id
     WHERE ll.owner_id = $1 AND eb.created_by IS DISTINCT FROM $1
     LIMIT 1`,
    [ownerId]
  );
  if (otherBatchBindingToOwner.rowCount) {
    throw new Error("Competition sandbox Life Link is bound to QR inventory outside its owner sandbox.");
  }
  const crossOwnerReference = await client.query(
    `WITH owner_life_links AS (
       SELECT id FROM life_links WHERE owner_id = $1
     ), owner_qrs AS (
       SELECT q.id
       FROM qr_codes q
       JOIN export_batches eb ON eb.id = q.batch_id
       WHERE eb.created_by = $1
     )
     SELECT 1
     FROM claim_events ce
     WHERE ce.owner_id <> $1
       AND (
         ce.qr_id = ANY($2::text[])
         OR ce.qr_id IN (SELECT id FROM owner_qrs)
         OR ce.requested_life_link_id IN (SELECT id FROM owner_life_links)
         OR ce.resolved_life_link_id IN (SELECT id FROM owner_life_links)
       )
     LIMIT 1`,
    [ownerId, qrIds]
  );
  if (crossOwnerReference.rowCount) {
    throw new Error("Competition fixture state is referenced by another owner.");
  }
}

async function replacePostgresCompetitionFixture(
  client: PoolClient,
  fixture: CompetitionFixtureData,
  passwordHash: string
): Promise<void> {
  const ownerId = fixture.owner.id;
  await client.query("DELETE FROM life_link_change_previews WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM saved_changes WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM life_link_change_receipts WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM sessions WHERE user_id = $1", [ownerId]);
  await client.query("DELETE FROM claim_events WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM collections WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM link_media WHERE owner_id = $1", [ownerId]);
  await client.query(
    `DELETE FROM life_link_qr_bindings b
     USING life_links ll
     WHERE b.life_link_id = ll.id AND ll.owner_id = $1`,
    [ownerId]
  );
  await client.query("UPDATE life_links SET parent_id = NULL WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM life_links WHERE owner_id = $1", [ownerId]);
  await client.query(
    `DELETE FROM qr_codes q
     USING export_batches eb
     WHERE q.batch_id = eb.id AND eb.created_by = $1`,
    [ownerId]
  );
  await client.query("DELETE FROM export_batches WHERE created_by = $1", [ownerId]);
  await client.query(
    `INSERT INTO users (id, email, display_name, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           created_at = EXCLUDED.created_at`,
    [fixture.owner.id, fixture.owner.email, fixture.owner.displayName, passwordHash, fixture.owner.createdAt]
  );
  await client.query(
    `INSERT INTO export_batches (id, batch_key, qr_base_url, count, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      fixture.batch.id,
      fixture.batch.batchKey,
      fixture.batch.qrBaseUrl,
      fixture.batch.count,
      fixture.batch.createdBy,
      fixture.batch.createdAt
    ]
  );
  for (const qr of fixture.qrInventory) {
    await client.query(
      "INSERT INTO qr_codes (id, url, batch_id, created_at) VALUES ($1, $2, $3, $4)",
      [qr.id, qr.url, qr.batchId, qr.createdAt]
    );
  }
  for (const lifeLink of fixture.lifeLinks) {
    await insertLifeLink(client, withoutRelations(lifeLink));
  }
  for (const binding of fixture.qrBindings) {
    await client.query(
      "INSERT INTO life_link_qr_bindings (qr_id, life_link_id, bound_at) VALUES ($1, $2, $3)",
      [binding.qrId, binding.lifeLinkId, binding.boundAt]
    );
  }
  for (const item of fixture.collections) {
    await client.query(
      `INSERT INTO collections (id, owner_id, title, purpose, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item.id, item.ownerId, item.title, item.purpose, item.notes, item.createdAt, item.updatedAt]
    );
  }
  for (const item of fixture.collectionSections) {
    await client.query(
      `INSERT INTO collection_sections (id, owner_id, collection_id, title, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item.id, item.ownerId, item.collectionId, item.title, item.position, item.createdAt, item.updatedAt]
    );
  }
  for (const item of fixture.collectionMemberships) {
    await client.query(
      `INSERT INTO collection_memberships (owner_id, collection_id, life_link_id, created_at) VALUES ($1, $2, $3, $4)`,
      [item.ownerId, item.collectionId, item.lifeLinkId, item.createdAt]
    );
  }
  for (const item of fixture.collectionSectionAssignments) {
    await client.query(
      `INSERT INTO collection_section_assignments (owner_id, collection_id, life_link_id, section_id, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.ownerId, item.collectionId, item.lifeLinkId, item.sectionId, item.createdAt]
    );
  }
}

async function assertPostgresCompetitionFixturePostcondition(
  client: PoolClient,
  fixture: CompetitionFixtureData,
  password: string,
  actual: CompetitionFixtureCounts,
  expected: CompetitionFixtureCounts
): Promise<void> {
  if (!sameCompetitionFixtureCounts(actual, expected)) {
    throw new CompetitionFixtureShapeMismatchError("Competition fixture reset produced unexpected account-local counts.");
  }
  const userResult = await client.query("SELECT * FROM users WHERE id = $1", [fixture.owner.id]);
  const user = userResult.rows[0];
  if (
    !user ||
    String(user.email) !== fixture.owner.email ||
    String(user.display_name) !== fixture.owner.displayName ||
    toIso(user.created_at) !== fixture.owner.createdAt ||
    !(await verifyPassword(password, String(user.password_hash)))
  ) {
    throw new CompetitionFixtureShapeMismatchError("Competition fixture owner postcondition failed.");
  }
  const batch = await client.query(
    `SELECT 1 FROM export_batches
     WHERE id = $1 AND batch_key = $2 AND qr_base_url = $3 AND count = $4
       AND created_by = $5 AND created_at = $6`,
    [
      fixture.batch.id,
      fixture.batch.batchKey,
      fixture.batch.qrBaseUrl,
      fixture.batch.count,
      fixture.batch.createdBy,
      fixture.batch.createdAt
    ]
  );
  if (batch.rowCount !== 1) {
    throw new CompetitionFixtureShapeMismatchError("Competition fixture batch postcondition failed.");
  }
  for (const qr of fixture.qrInventory) {
    const qrResult = await client.query(
      "SELECT 1 FROM qr_codes WHERE id = $1 AND url = $2 AND batch_id = $3 AND created_at = $4",
      [qr.id, qr.url, qr.batchId, qr.createdAt]
    );
    if (qrResult.rowCount !== 1) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture QR postcondition failed.");
    }
  }
  for (const lifeLink of fixture.lifeLinks) {
    const lifeLinkResult = await client.query(
      `SELECT 1 FROM life_links
       WHERE id = $1 AND owner_id = $2 AND parent_id IS NOT DISTINCT FROM $3
         AND title = $4 AND body = $5 AND body_doc = $6::jsonb AND body_doc_version = $7
         AND privacy = $8 AND created_at = $9 AND updated_at = $10
         AND browsing_role = $11 AND context = $12::jsonb
         AND placement_confirmed_at IS NOT DISTINCT FROM $13::timestamptz AND public_field_keys = $14::text[]`,
      [
        lifeLink.id,
        lifeLink.ownerId,
        lifeLink.parentId,
        lifeLink.title,
        lifeLink.body,
        JSON.stringify(lifeLink.bodyDoc),
        lifeLink.bodyDocVersion,
        lifeLink.privacy,
        lifeLink.createdAt,
        lifeLink.updatedAt,
        lifeLink.browsingRole,
        JSON.stringify(lifeLink.context),
        lifeLink.placementConfirmedAt,
        lifeLink.publicFieldKeys
      ]
    );
    if (lifeLinkResult.rowCount !== 1) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture Life Link postcondition failed.");
    }
  }
  for (const binding of fixture.qrBindings) {
    const bindingResult = await client.query(
      "SELECT 1 FROM life_link_qr_bindings WHERE qr_id = $1 AND life_link_id = $2 AND bound_at = $3",
      [binding.qrId, binding.lifeLinkId, binding.boundAt]
    );
    if (bindingResult.rowCount !== 1) {
      throw new CompetitionFixtureShapeMismatchError("Competition fixture binding postcondition failed.");
    }
  }
  for (const item of fixture.collections) {
    const result = await client.query(
      `SELECT 1 FROM collections WHERE id = $1 AND owner_id = $2 AND title = $3
       AND purpose = $4 AND notes = $5 AND created_at = $6 AND updated_at = $7`,
      [item.id, item.ownerId, item.title, item.purpose, item.notes, item.createdAt, item.updatedAt]
    );
    if (result.rowCount !== 1) throw new CompetitionFixtureShapeMismatchError("Competition fixture Collection postcondition failed.");
  }
  for (const item of fixture.collectionSections) {
    const result = await client.query(
      `SELECT 1 FROM collection_sections WHERE id = $1 AND owner_id = $2 AND collection_id = $3
       AND title = $4 AND position = $5 AND created_at = $6 AND updated_at = $7`,
      [item.id, item.ownerId, item.collectionId, item.title, item.position, item.createdAt, item.updatedAt]
    );
    if (result.rowCount !== 1) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section postcondition failed.");
  }
  for (const item of fixture.collectionMemberships) {
    const result = await client.query(
      `SELECT 1 FROM collection_memberships WHERE owner_id = $1 AND collection_id = $2 AND life_link_id = $3 AND created_at = $4`,
      [item.ownerId, item.collectionId, item.lifeLinkId, item.createdAt]
    );
    if (result.rowCount !== 1) throw new CompetitionFixtureShapeMismatchError("Competition fixture membership postcondition failed.");
  }
  for (const item of fixture.collectionSectionAssignments) {
    const result = await client.query(
      `SELECT 1 FROM collection_section_assignments WHERE owner_id = $1 AND collection_id = $2
       AND life_link_id = $3 AND section_id = $4 AND created_at = $5`,
      [item.ownerId, item.collectionId, item.lifeLinkId, item.sectionId, item.createdAt]
    );
    if (result.rowCount !== 1) throw new CompetitionFixtureShapeMismatchError("Competition fixture Section assignment postcondition failed.");
  }
}

async function insertLifeLink(queryable: Queryable, lifeLink: StoredLifeLink): Promise<void> {
  await queryable.query(
    `INSERT INTO life_links
       (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at,
        browsing_role, context, placement_confirmed_at, public_field_keys)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
    [
      lifeLink.id,
      lifeLink.ownerId,
      lifeLink.parentId,
      lifeLink.title,
      lifeLink.body,
      JSON.stringify(lifeLink.bodyDoc),
      lifeLink.bodyDocVersion,
      lifeLink.privacy,
      lifeLink.createdAt,
      lifeLink.updatedAt,
      lifeLink.browsingRole,
      JSON.stringify(lifeLink.context),
      lifeLink.placementConfirmedAt,
      lifeLink.publicFieldKeys
    ]
  );
}

async function lockKeys(client: PoolClient, keys: string[]): Promise<void> {
  const owners = [...new Set(keys.filter((key) => key.startsWith("owner:")))].sort();
  for (const key of owners) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  const expanded = new Set(keys.filter((key) => !key.startsWith("owner:")));
  // All writers take owner locks before globally ordered live/retained/target QR
  // locks. A detach/delete cannot expose a claimable gap before its inverse is saved.
  for (const owner of owners) {
    const result = await client.query(`SELECT b.qr_id FROM life_link_qr_bindings b JOIN life_links ll ON ll.id = b.life_link_id WHERE ll.owner_id = $1
      UNION SELECT unnest(reserved_qr_ids) AS qr_id FROM saved_changes WHERE owner_id = $1`, [owner.slice(6)]);
    for (const row of result.rows) expanded.add(`claim-qr:${row.qr_id}`);
  }
  for (const key of [...expanded].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }
}

function assertChangeCommandId(commandId: string): void {
  if (typeof commandId !== "string" || !commandId.trim() || commandId.length > 128) throw new LifeLinkDomainError("invalid_life_link", "A stable change command ID is required.");
}
function stalePreview(): LifeLinkDomainError {
  return new LifeLinkDomainError("stale_life_link", "The preview is stale. Review a fresh preview before applying.", { reason: "stale_preview" });
}

async function loadCollection(
  queryable: Queryable, ownerId: string, collectionId: string, forUpdate = false
): Promise<CollectionRecord | null> {
  const result = await queryable.query(
    `SELECT * FROM collections WHERE id = $1 AND owner_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
    [normalizeCollectionId(collectionId), ownerId]
  );
  return result.rows[0] ? mapCollection(result.rows[0]) : null;
}

async function ownerHasLifeLink(queryable: Queryable, ownerId: string, lifeLinkId: string): Promise<boolean> {
  const result = await queryable.query("SELECT 1 FROM life_links WHERE id = $1 AND owner_id = $2", [lifeLinkId, ownerId]);
  return Boolean(result.rowCount);
}

async function touchCollection(
  queryable: Queryable, current: CollectionRecord, updatedAt = nextTimestamp(current.updatedAt)
): Promise<CollectionRecord> {
  await queryable.query("UPDATE collections SET updated_at = $3 WHERE id = $1 AND owner_id = $2", [current.id, current.ownerId, updatedAt]);
  return { ...current, updatedAt };
}

function mapCollection(row: Record<string, unknown>): CollectionRecord {
  return {
    id: String(row.id), ownerId: String(row.owner_id), title: String(row.title),
    purpose: String(row.purpose), notes: String(row.notes),
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at)
  };
}

function mapCollectionSection(row: Record<string, unknown>): CollectionSectionRecord {
  return {
    id: String(row.id), ownerId: String(row.owner_id), collectionId: String(row.collection_id),
    title: String(row.title), position: Number(row.position),
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at)
  };
}

function assertCollectionFresh(collection: CollectionRecord, expectedUpdatedAt: string): void {
  if (collection.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_collection", "Collection changed after it was read.", { retryable: true });
  }
}

function mapUser(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    agentConnectedAt: nullableIso(row.agent_connected_at),
    createdAt: toIso(row.created_at)
  };
}

function mapStoredLifeLink(row: Record<string, unknown>): StoredLifeLink {
  const body = String(row.body ?? "");
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    parentId: nullableString(row.parent_id),
    title: String(row.title),
    body,
    bodyDoc: normalizeLinkBodyDoc(row.body_doc) ?? createLinkBodyDocFromPlainText(body),
    bodyDocVersion: Number(row.body_doc_version ?? LINK_BODY_DOC_VERSION),
    privacy: row.privacy as StoredLifeLink["privacy"],
    browsingRole: row.browsing_role as StoredLifeLink["browsingRole"],
    context: normalizeLifeLinkContext(row.context),
    placementConfirmedAt: nullableIso(row.placement_confirmed_at),
    publicFieldKeys: normalizePublicFieldKeys(row.public_field_keys),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLifeLinkRow(row: Record<string, unknown>): LifeLinkRecord {
  return { ...mapStoredLifeLink(row), qrId: nullableString(row.qr_id), media: [] };
}

function hydrateWithoutRelations(lifeLink: StoredLifeLink): LifeLinkRecord {
  return { ...lifeLink, qrId: null, media: [] };
}

function mapQrInventory(row: Record<string, unknown>): QrInventoryRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    batchId: nullableString(row.batch_id),
    createdAt: toIso(row.created_at)
  };
}

function mapLifeLinkMedia(row: Record<string, unknown>): LifeLinkMediaRecord {
  const id = String(row.id);
  const lifeLinkId = String(row.life_link_id);
  const qrId = nullableString(row.qr_id);
  return {
    id,
    lifeLinkId,
    ownerId: String(row.owner_id),
    kind: row.kind as LifeLinkMediaRecord["kind"],
    mimeType: String(row.mime_type),
    fileName: String(row.file_name),
    sizeBytes: Number(row.size_bytes),
    url: qrId ? mediaUrl(qrId, id) : lifeLinkMediaUrl(lifeLinkId, id),
    createdAt: toIso(row.created_at)
  };
}

function withoutRelations(lifeLink: LifeLinkRecord): StoredLifeLink {
  const { qrId: _qrId, media: _media, ...stored } = lifeLink;
  return stored;
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

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function asBuffer(value: unknown): Buffer {
  return value instanceof Buffer ? value : Buffer.from(value as ArrayBuffer);
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}
