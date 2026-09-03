import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { Pool, type PoolClient } from "pg";
import {
  planCollectionChange, type CollectionChangeInput, type CollectionChangePreview, type CollectionChangeResult, type CollectionChangeState,
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
  normalizeLifeLinkChildPageLimit,
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
  type ActivityRecord,
  type AppendRoutineSessionAmendmentCommand,
  type BuiltRoutineSession,
  type CanonicalRoutineCreation,
  type CreateActivityCommand,
  type CreateRoutineCommand,
  type CreateRoutineGroupCommand,
  type CreateRoutineScheduleCommand,
  type FinalizeRoutineRunCommand,
  type PutRoutineRunStepResultCommand,
  type ReviseRoutineCommand,
  type RoutineContextBindingRecord,
  type RoutineContextSnapshot,
  type RoutineGroupRecord,
  type RoutineOccurrenceRecord,
  type RoutineRecord,
  type RoutineRevisionRecord,
  type RoutineRevisionSnapshot,
  type RoutineRunRecord,
  type RoutineScheduleRecord,
  type RoutineSummaryRecord,
  type RoutineSessionAmendmentRecord,
  type RoutineSessionProjection,
  type RoutineSessionRecord,
  type RoutineSessionStepResultRecord,
  type RoutineStepRecord,
  type StartRoutineRunCommand,
  type UpdateActivityCommand,
  type UpdateRoutineCommand,
  type UpdateRoutineGroupCommand,
  type UpdateRoutineScheduleCommand,
  type CalendarRecord,
  type CalendarActor,
  type CalendarEventLineage,
  type CalendarOriginalOccurrence,
  type CalendarEventRecord,
  type CalendarEventRevisionRecord,
  type CalendarEventTombstoneRecord,
  type CalendarSubjectLink,
  type CreateCalendarCommand,
  type UpdateCalendarCommand,
  type SoftDeleteCalendarCommand,
  type RestoreCalendarCommand,
  type CanonicalCalendarEventCreation,
  type CreateCalendarEventCommand,
  type ReviseCalendarEventCommand,
  type SoftDeleteCalendarEventCommand,
  type RestoreCalendarEventCommand,
  type CalendarEventDeletion,
  CalendarDomainError,
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
  createCanonicalActivity,
  createCanonicalRoutine,
  createCanonicalRoutineRevision,
  normalizeRoutineOrdering,
  normalizeRoutineRevisionId,
  planRoutineRevisionScheduling,
  createCanonicalRoutineGroup,
  createCanonicalRoutineOccurrence,
  createCanonicalRoutineRun,
  createCanonicalRoutineSchedule,
  createCanonicalRoutineSessionAmendment,
  applyActivityPatch,
  applyRoutineGroupPatch,
  applyRoutinePatch,
  applyRoutineRunStepResult,
  applyRoutineSchedulePatch,
  buildRoutineSessionFromRun,
  routineScheduleMatchesLocalDate,
  resolveRoutineSchedulePlannedFor,
  listRoutineScheduleLocalDates,
  projectRoutineSessionWithAmendments,
  reviseCanonicalRoutine,
  createCanonicalCalendar,
  normalizeCalendarSource,
  normalizeCalendarAgentAccess,
  applyCalendarPatch,
  softDeleteCalendar,
  restoreCalendar,
  createCanonicalCalendarEvent,
  reviseCanonicalCalendarEvent,
  softDeleteCalendarEvent,
  restoreCalendarEvent,
  calendarRecurrenceIncludesOriginalOccurrence,
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
  pageLifeLinkChildRecords,
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
  type MaterializeRoutineOccurrencesInput,
  type CalendarPageRequest,
  type CalendarEventPageRequest,
  type CalendarEventDetail,
  sameCalendarPayload,
  assertHumanCalendarActor,
  assertCalendarAgentConnection,
  assertWorkspaceAgentConnection,
  assertAgentRoutineArchive,
  calendarActorCanRead,
  sameCalendarCreatePayload,
  calendarConflict,
  compareCalendarEventDetails,
  assertCalendarEventDateWindow,
  calendarEventInDateWindow,
  type RoutineDetail,
  type RoutineOccurrencePageRequest,
  type RoutinePageRequest,
  type LinkMediaFile,
  type LinkMediaInput,
  type SessionRecord,
  type StoredUser,
  type AgentToolCatalogId,
  expectedCompetitionFixtureCounts,
  sameCompetitionFixtureCounts
} from "./store.js";
import type { AttachmentTextExtraction } from "./attachment-content.js";

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

  async connectAgent(
    userId: string,
    toolCatalogId: AgentToolCatalogId = "life-links-page-webmcp-v1"
  ): Promise<StoredUser | null> {
    const result = await this.pool.query(
      `UPDATE users
       SET agent_connected_at = CASE
         WHEN agent_tool_catalog_id IS DISTINCT FROM $2
           THEN GREATEST(now(), COALESCE(agent_connected_at + interval '1 millisecond', now()))
         ELSE COALESCE(agent_connected_at, now())
       END,
       agent_tool_catalog_id = $2
       WHERE id = $1 RETURNING *`,
      [userId, toolCatalogId]
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async disconnectAgent(userId: string): Promise<StoredUser | null> {
    const result = await this.pool.query(
      "UPDATE users SET agent_connected_at = NULL, agent_tool_catalog_id = NULL WHERE id = $1 RETURNING *",
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
              u.agent_connected_at AS user_agent_connected_at,
              u.agent_tool_catalog_id AS user_agent_tool_catalog_id,
              u.created_at AS user_created_at
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
        agentToolCatalogId: row.user_agent_tool_catalog_id === null ? null : String(row.user_agent_tool_catalog_id) as AgentToolCatalogId,
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
    // Sorting remains canonical JavaScript (including NFKC/UTF-16 behavior).
    // Scan only this sibling set's summary/order metadata, never owner-wide
    // bodies or attachment metadata. Counts share the statement's snapshot.
    const result = await this.pool.query(
      `SELECT ll.id, ll.owner_id, ll.parent_id, ll.title, ll.created_at, ll.updated_at,
              ll.privacy, ll.browsing_role, b.qr_id,
              (SELECT count(*) FROM life_links child
               WHERE child.owner_id = ll.owner_id AND child.parent_id = ll.id) AS child_count
       FROM life_links ll
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
       WHERE ll.owner_id = $1 AND ll.parent_id IS NOT DISTINCT FROM $2`, [userId, parentId]);
    const selected = pageLifeLinkChildRecords(result.rows.map(row => ({
      id: String(row.id), ownerId: String(row.owner_id), parentId: nullableString(row.parent_id),
      title: String(row.title), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
      privacy: row.privacy as LifeLinkSummary["privacy"], browsingRole: row.browsing_role as LifeLinkSummary["browsingRole"],
      qrId: nullableString(row.qr_id), childCount: Number(row.child_count)
    })), userId, parentId, page);
    return { ...selected, items: selected.items.map(({ ownerId: _ownerId, createdAt: _createdAt, ...summary }) => summary) };
  }

  async listRecordSearchLifeLinks(userId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<LifeLinkRecord>> {
    const limit = normalizeLifeLinkChildPageLimit(page.limit);
    let afterId: string | null = null;
    if (page.cursor) {
      let candidate: { id?: unknown } = {};
      try { candidate = JSON.parse(decodeURIComponent(page.cursor)) ?? {}; } catch { /* canonical cursor validation below */ }
      // Reuse the existing stable-record cursor grammar and its error contract.
      const found = typeof candidate.id === "string"
        ? await this.pool.query("SELECT id FROM life_links WHERE owner_id=$1 AND id=$2", [userId, candidate.id]) : { rows: [] };
      pageCollectionRecords(found.rows.map((row) => ({ id: String(row.id) })), page);
      afterId = candidate.id as string;
    }
    const rows = await this.pool.query(
      `SELECT ll.*, b.qr_id FROM life_links ll
       LEFT JOIN life_link_qr_bindings b ON b.life_link_id=ll.id
       WHERE ll.owner_id=$1 AND ($2::text IS NULL OR ll.id COLLATE "C" > $2 COLLATE "C")
       ORDER BY ll.id COLLATE "C" LIMIT $3`, [userId, afterId, limit + 1]);
    const result = pageCollectionRecords(rows.rows.map(mapLifeLinkRow), { limit });
    return { ...result, items: await this.attachLifeLinkMedia(this.pool, result.items) };
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

  private async collectionChangeState(client: PoolClient, userId: string): Promise<CollectionChangeState> {
    const rows = await loadOwnerContentRows(client, userId);
    return { collections: rows.collections.map(mapCollection), sections: rows.collection_sections.map(mapCollectionSection),
      memberships: rows.collection_memberships.map((row) => ({ ownerId: String(row.owner_id), collectionId: String(row.collection_id), lifeLinkId: String(row.life_link_id), createdAt: toIso(row.created_at) })),
      assignments: rows.collection_section_assignments.map((row) => ({ ownerId: String(row.owner_id), collectionId: String(row.collection_id), lifeLinkId: String(row.life_link_id), sectionId: String(row.section_id), createdAt: toIso(row.created_at) })),
      lifeLinks: rows.life_links.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), title: String(row.title) })) };
  }

  async previewCollectionChange(userId: string, input: CollectionChangeInput, actor: CalendarActor = "human"): Promise<CollectionChangePreview> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await assertPostgresWorkspaceAgentConnection(client, userId, actor);
      const plan = planCollectionChange(await this.collectionChangeState(client, userId), userId, input, new Date().toISOString());
      await this.assertNoCurrentRoutineCollectionBindings(client, userId, plan.deletedCollectionIds);
      const preview: CollectionChangePreview = { ...plan.preview, id: `preview-${randomUUID()}`, createdAt: new Date().toISOString() };
      await client.query("DELETE FROM life_link_change_previews WHERE owner_id=$1 AND created_at < now() - interval '15 minutes'", [userId]);
      await client.query("INSERT INTO life_link_change_previews(id,owner_id,preview,fingerprint) VALUES($1,$2,$3::jsonb,$4)", [preview.id,userId,JSON.stringify(preview),createHash("sha256").update(stableChangeFingerprint(plan.preview)).digest("hex")]);
      await client.query(`DELETE FROM life_link_change_previews WHERE owner_id=$1 AND id NOT IN
        (SELECT id FROM life_link_change_previews WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 5)`, [userId]);
      return preview;
    }, null);
  }

  async getCollectionChangePreview(userId: string, previewId: string, actor: CalendarActor = "human"): Promise<CollectionChangePreview | null> {
    return this.withWorkspaceRead(userId, actor, async (queryable) => {
      const result = await queryable.query(`SELECT preview FROM life_link_change_previews WHERE id=$1 AND owner_id=$2
        AND created_at >= now() - interval '15 minutes' AND preview->>'domain'='collections'`, [previewId,userId]);
      return result.rows[0]?.preview ?? null;
    });
  }

  async applyCollectionChange(userId: string, input: ApplyLifeLinkChangeInput, actor: CalendarActor = "human"): Promise<CollectionChangeResult> {
    assertChangeCommandId(input.commandId);
    return this.withTransaction([`owner:${userId}`, `claim-command:${input.commandId}`], async (client) => {
      await assertPostgresWorkspaceAgentConnection(client, userId, actor);
      const replay = (await client.query("SELECT * FROM life_link_change_receipts WHERE command_id=$1", [input.commandId])).rows[0];
      if (replay) {
        if (replay.owner_id !== userId || replay.request_id !== input.previewId || replay.collection_ids == null || replay.operation === "undo") throw new ClaimIdempotencyConflictError();
        return { operation: replay.operation, collectionIds: replay.collection_ids, lifeLinkIds: replay.affected_ids, history: await getPostgresChangeHistory(client,userId) };
      }
      const saved = (await client.query(`SELECT preview,fingerprint FROM life_link_change_previews WHERE id=$1 AND owner_id=$2
        AND created_at >= now() - interval '15 minutes' AND preview->>'domain'='collections'`, [input.previewId,userId])).rows[0];
      if (!saved) throw new LifeLinkDomainError("collection_not_found", "Collection change preview is unavailable or expired.");
      const state = await this.collectionChangeState(client,userId);
      const plan = planCollectionChange(state,userId,(saved.preview as CollectionChangePreview).input,new Date().toISOString());
      if (createHash("sha256").update(stableChangeFingerprint(plan.preview)).digest("hex") !== saved.fingerprint) throw new LifeLinkDomainError("stale_collection", "The selection changed. Review a fresh preview.");
      await this.assertNoCurrentRoutineCollectionBindings(client,userId,plan.deletedCollectionIds);
      const before = await loadOwnerContentRows(client,userId);
      const memberKey = (row: CollectionChangeState["memberships"][number]) => JSON.stringify([row.collectionId,row.lifeLinkId]);
      const assignmentKey = (row: CollectionChangeState["assignments"][number]) => JSON.stringify([row.collectionId,row.lifeLinkId,row.sectionId]);
      const nextMembers = new Set(plan.next.memberships.map(memberKey));
      const nextAssignments = new Set(plan.next.assignments.map(assignmentKey));
      const oldMembers = new Set(state.memberships.map(memberKey));
      const oldAssignments = new Set(state.assignments.map(assignmentKey));
      for (const row of state.assignments) if (!nextAssignments.has(assignmentKey(row))) await client.query("DELETE FROM collection_section_assignments WHERE owner_id=$1 AND collection_id=$2 AND life_link_id=$3 AND section_id=$4", [userId,row.collectionId,row.lifeLinkId,row.sectionId]);
      for (const row of state.memberships) if (!nextMembers.has(memberKey(row))) await client.query("DELETE FROM collection_memberships WHERE owner_id=$1 AND collection_id=$2 AND life_link_id=$3", [userId,row.collectionId,row.lifeLinkId]);
      for (const row of state.sections) {
        const updated = plan.next.sections.find((section) => section.id === row.id);
        if (!updated) await client.query("DELETE FROM collection_sections WHERE id=$1 AND owner_id=$2", [row.id,userId]);
        else if (updated.collectionId !== row.collectionId) await client.query("UPDATE collection_sections SET collection_id=$3,position=$4,updated_at=$5 WHERE id=$1 AND owner_id=$2", [row.id,userId,updated.collectionId,updated.position,updated.updatedAt]);
      }
      for (const row of plan.next.memberships) if (!oldMembers.has(memberKey(row))) await client.query("INSERT INTO collection_memberships(owner_id,collection_id,life_link_id,created_at) VALUES($1,$2,$3,$4)", [userId,row.collectionId,row.lifeLinkId,row.createdAt]);
      for (const row of plan.next.assignments) if (!oldAssignments.has(assignmentKey(row))) await client.query("INSERT INTO collection_section_assignments(owner_id,collection_id,life_link_id,section_id,created_at) VALUES($1,$2,$3,$4,$5)", [userId,row.collectionId,row.lifeLinkId,row.sectionId,row.createdAt]);
      for (const id of plan.deletedCollectionIds) await client.query("DELETE FROM collections WHERE id=$1 AND owner_id=$2", [id,userId]);
      for (const row of plan.next.collections) if (plan.collectionIds.includes(row.id)) await client.query("UPDATE collections SET updated_at=$3 WHERE id=$1 AND owner_id=$2", [row.id,userId,row.updatedAt]);
      await recordOwnerChange(client,userId,`${plan.preview.input.operation === "delete" ? "Remove" : "Move"} Collection selection`,before);
      await client.query("INSERT INTO life_link_change_receipts(command_id,owner_id,operation,request_id,affected_ids,collection_ids) VALUES($1,$2,$3,$4,$5,$6)", [input.commandId,userId,plan.preview.input.operation,input.previewId,plan.lifeLinkIds,plan.collectionIds]);
      await client.query("DELETE FROM life_link_change_previews WHERE id=$1 AND owner_id=$2", [input.previewId,userId]);
      return { operation: plan.preview.input.operation, collectionIds: plan.collectionIds, lifeLinkIds: plan.lifeLinkIds, history: await getPostgresChangeHistory(client,userId) };
    }, null);
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
      return result.rows[0]?.preview?.domain === "collections" ? null : result.rows[0]?.preview ?? null;
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
      if ("domain" in preview) throw new LifeLinkDomainError("life_link_not_found", "Life Link change preview is unavailable.");
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
        await this.assertNoCurrentRoutineLifeLinkBindings(client, userId, affectedIds);
        const collections = await client.query("SELECT DISTINCT collection_id FROM collection_memberships WHERE owner_id = $1 AND life_link_id = ANY($2::text[])", [userId, affectedIds]);
        await client.query("DELETE FROM life_link_qr_bindings WHERE life_link_id = ANY($1::text[])", [affectedIds]);
        await client.query("UPDATE life_links SET parent_id = NULL WHERE owner_id = $1 AND id = ANY($2::text[])", [userId, affectedIds]);
        try {
          await client.query("DELETE FROM life_links WHERE owner_id = $1 AND id = ANY($2::text[])", [userId, affectedIds]);
        } catch (error) {
          if (isCurrentRoutineLifeLinkBindingError(error)) throw currentRoutineLifeLinkBindingError();
          throw error;
        }
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
      const deletions = await client.query(`SELECT item->'key'->>'id' AS id FROM saved_changes saved,
        jsonb_array_elements(saved.inverse_rows) item
        WHERE saved.id=$1 AND saved.owner_id=$2 AND item->>'table'='life_links' AND item->'before'='null'::jsonb`,[input.changeId,userId]);
      await this.assertNoCurrentRoutineLifeLinkBindings(client,userId,deletions.rows.map((row)=>String(row.id)));
      const collectionDeletions = await client.query(`SELECT item->'key'->>'id' AS id FROM saved_changes saved,
        jsonb_array_elements(saved.inverse_rows) item WHERE saved.id=$1 AND saved.owner_id=$2
        AND item->>'table'='collections' AND item->'before'='null'::jsonb`, [input.changeId,userId]);
      await this.assertNoCurrentRoutineCollectionBindings(client,userId,collectionDeletions.rows.map((row)=>String(row.id)));
      let affectedIds: string[];
      try {
        affectedIds = await restoreOwnerChange(client, userId, input.changeId);
      } catch (error) {
        if (isCurrentRoutineLifeLinkBindingError(error)) throw currentRoutineLifeLinkBindingError();
        throw error;
      }
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
    const routineBindingsResult = await client.query(`SELECT binding.id,binding.routine_revision_id,binding.target_id
      FROM routine_context_bindings binding JOIN routines routine
        ON routine.owner_id=binding.owner_id AND routine.current_revision_id=binding.routine_revision_id
      WHERE binding.owner_id=$1 AND binding.target_type='life_link' AND binding.target_id=ANY($2::text[])
      ORDER BY binding.id`,[userId,[...ids]]);
    const routineBindings = routineBindingsResult.rows;
    const preview: LifeLinkChangePreview = {
      id: `preview-${randomUUID()}`, operation: input.operation, rootIds: scope.rootIds,
      items: scope.items.map(lifeLinkChangePreviewItem), parentId: scope.parentId,
      target: scope.target ? lifeLinkChangePreviewItem(scope.target) : null, createdAt: new Date().toISOString(),
      sideEffects: { lifeLinks: scope.items.length, media: media.length,
        qrBindings: scope.items.filter((item) => item.qrId !== null).length,
        collectionMemberships: memberships.length, collectionSectionAssignments: assignments.length }
    };
    const fingerprint = createHash("sha256").update(stableChangeFingerprint({ operation: input.operation, ...scope, memberships, assignments, media, routineBindings })).digest("hex");
    return { preview, fingerprint };
  }

  private async assertNoCurrentRoutineLifeLinkBindings(client: PoolClient,userId: string,lifeLinkIds: string[]): Promise<void>{
    if(!lifeLinkIds.length)return;
    const result=await client.query(`SELECT 1 FROM routine_context_bindings binding JOIN routines routine
      ON routine.owner_id=binding.owner_id AND routine.current_revision_id=binding.routine_revision_id
      WHERE binding.owner_id=$1 AND binding.target_type='life_link' AND binding.target_id=ANY($2::text[]) LIMIT 1`,[userId,lifeLinkIds]);
    if(result.rowCount)throw currentRoutineLifeLinkBindingError();
  }

  private async assertNoCurrentRoutineCollectionBindings(client: PoolClient,userId: string,collectionIds: string[]): Promise<void> {
    if (!collectionIds.length) return;
    const result = await client.query(`SELECT 1 FROM routine_context_bindings binding JOIN routines routine
      ON routine.owner_id=binding.owner_id AND routine.current_revision_id=binding.routine_revision_id
      WHERE binding.owner_id=$1 AND binding.target_type='collection' AND binding.target_id=ANY($2::text[]) LIMIT 1`, [userId,collectionIds]);
    if (result.rowCount) throw new LifeLinkDomainError("routine_reference_conflict", "A current Routine revision still references this Collection. Revise that Routine before deleting it.");
  }

  private async readChangeReplay(client: PoolClient, userId: string, commandId: string, requestId: string, undo: boolean): Promise<LifeLinkChangeResult | null> {
    const result = await client.query("SELECT * FROM life_link_change_receipts WHERE command_id = $1", [commandId]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.owner_id !== userId || row.collection_ids != null || row.request_id !== requestId || (row.operation === "undo") !== undo) throw new ClaimIdempotencyConflictError();
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
    const client = await this.pool.connect();
    try {
      // Selection and full hydration must see the same title/membership state.
      // This short read-only snapshot takes no owner-wide mutation lock.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      if (!(await loadCollection(client, userId, collectionId))) {
        await client.query("COMMIT"); return null;
      }
      // Narrow O(member-count) metadata selection preserves the exact existing
      // Unicode comparator and identity cursor; no SQL collation substitute.
      const metadata = await client.query(
        `SELECT ll.id, ll.title FROM collection_memberships m
         JOIN life_links ll ON ll.id = m.life_link_id AND ll.owner_id = m.owner_id
         WHERE m.owner_id = $1 AND m.collection_id = $2`, [userId, collectionId]);
      const selected = pageCollectionRecords(metadata.rows.map(row => ({ id: String(row.id), title: String(row.title) })).sort(compareTitledRecords), page);
      let items: LifeLinkRecord[] = [];
      if (selected.items.length) {
        const result = await client.query(
          `SELECT ll.*, b.qr_id FROM life_links ll
           LEFT JOIN life_link_qr_bindings b ON b.life_link_id = ll.id
           WHERE ll.owner_id = $1 AND ll.id = ANY($2::text[])`, [userId, selected.items.map(item => item.id)]);
        const byId = new Map(result.rows.map(row => { const record = mapLifeLinkRow(row); return [record.id, record] as const; }));
        items = await this.attachLifeLinkMedia(client, selected.items.map(item => byId.get(item.id)!));
      }
      await client.query("COMMIT");
      return { ...selected, items };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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

  async getAttachmentText(file: LifeLinkMediaFile, revision: string): Promise<AttachmentTextExtraction | null> {
    const result = await this.pool.query(
      `SELECT cached.extraction FROM attachment_text_cache cached
       JOIN link_media lm ON lm.id=cached.media_id JOIN life_links ll ON ll.id=lm.life_link_id
       WHERE lm.id=$1 AND lm.life_link_id=$2 AND lm.owner_id=$3 AND ll.owner_id=$3
         AND cached.revision=$4 AND lm.mime_type=$5 AND lm.data=$6`,
      [file.media.id, file.media.lifeLinkId, file.media.ownerId, revision, file.media.mimeType, file.data]);
    return result.rows[0] ? JSON.parse(asBuffer(result.rows[0].extraction).toString("utf8")) as AttachmentTextExtraction : null;
  }

  async putAttachmentText(file: LifeLinkMediaFile, revision: string, extraction: AttachmentTextExtraction): Promise<void> {
    await this.pool.query(
      `WITH source AS MATERIALIZED (
         SELECT lm.id FROM link_media lm JOIN life_links ll ON ll.id=lm.life_link_id
         WHERE lm.id=$1 AND lm.life_link_id=$2 AND lm.owner_id=$3 AND ll.owner_id=$3
           AND lm.mime_type=$5 AND lm.data=$6 FOR SHARE OF lm, ll
       ) INSERT INTO attachment_text_cache (media_id,revision,extraction)
       SELECT id,$4,$7::bytea FROM source
       ON CONFLICT (media_id) DO UPDATE SET revision=EXCLUDED.revision,extraction=EXCLUDED.extraction`,
      [file.media.id, file.media.lifeLinkId, file.media.ownerId, revision, file.media.mimeType, file.data, Buffer.from(JSON.stringify(extraction), "utf8")]);
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

  async listRoutineGroups(userId: string, page: RoutinePageRequest = {}): Promise<LifeLinkPage<RoutineGroupRecord>> {
    const result = await this.pool.query(`SELECT * FROM routine_groups WHERE owner_id = $1 ${page.includeArchived ? "" : "AND archived_at IS NULL"}`, [userId]);
    return pageCollectionRecords(result.rows.map(mapRoutineGroup).sort(compareRoutineTitledRows), page);
  }

  async getRoutineGroup(userId: string, groupId: string): Promise<RoutineGroupRecord | null> {
    const result = await this.pool.query("SELECT * FROM routine_groups WHERE id = $1 AND owner_id = $2", [groupId, userId]);
    return result.rows[0] ? mapRoutineGroup(result.rows[0]) : null;
  }

  async createRoutineGroup(command: CreateRoutineGroupCommand): Promise<RoutineGroupRecord> {
    const candidate = createCanonicalRoutineGroup(command);
    return this.withTransaction([`routine-group-id:${candidate.id}`, `owner:${candidate.ownerId}`], async (client) => {
      const existing = await client.query("SELECT * FROM routine_groups WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (existing.rows[0]) {
        const row = mapRoutineGroup(existing.rows[0]);
        if (sameRoutineCreatePayload(row, candidate)) return row;
        return routineIdConflict();
      }
      await client.query(`INSERT INTO routine_groups(id,owner_id,title,notes,created_at,updated_at,archived_at)
        VALUES($1,$2,$3,$4,$5,$5,NULL)`, [candidate.id, candidate.ownerId, candidate.title, candidate.notes, candidate.createdAt]);
      return candidate;
    }, null);
  }

  async updateRoutineGroup(userId: string, command: UpdateRoutineGroupCommand): Promise<RoutineGroupRecord | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query("SELECT * FROM routine_groups WHERE id = $1 AND owner_id = $2 FOR UPDATE", [command.groupId, userId]);
      if (!result.rows[0]) return null;
      const current = mapRoutineGroup(result.rows[0]);
      const next = applyRoutineGroupPatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (sameRoutinePayload({ ...next, updatedAt: current.updatedAt }, current)) return current;
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      await client.query("UPDATE routine_groups SET title=$3,notes=$4,archived_at=$5,updated_at=$6 WHERE id=$1 AND owner_id=$2",
        [current.id, userId, next.title, next.notes, next.archivedAt, next.updatedAt]);
      return next;
    }, null);
  }

  async listActivities(userId: string, page: RoutinePageRequest = {}): Promise<LifeLinkPage<ActivityRecord>> {
    const result = await this.pool.query(`SELECT * FROM routine_activities WHERE owner_id = $1 ${page.includeArchived ? "" : "AND archived_at IS NULL"}`, [userId]);
    return pageCollectionRecords(result.rows.map(mapRoutineActivity).sort(compareRoutineTitledRows), page);
  }

  async getActivity(userId: string, activityId: string): Promise<ActivityRecord | null> {
    const result = await this.pool.query("SELECT * FROM routine_activities WHERE id = $1 AND owner_id = $2", [activityId, userId]);
    return result.rows[0] ? mapRoutineActivity(result.rows[0]) : null;
  }

  async createActivity(command: CreateActivityCommand): Promise<ActivityRecord> {
    const candidate = createCanonicalActivity(command);
    return this.withTransaction([`routine-activity-id:${candidate.id}`, `owner:${candidate.ownerId}`], async (client) => {
      const existing = await client.query("SELECT * FROM routine_activities WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (existing.rows[0]) {
        const row = mapRoutineActivity(existing.rows[0]);
        if (sameRoutineCreatePayload(row, candidate)) return row;
        return routineIdConflict();
      }
      await client.query(`INSERT INTO routine_activities(id,owner_id,title,notes,created_at,updated_at,archived_at)
        VALUES($1,$2,$3,$4,$5,$5,NULL)`, [candidate.id, candidate.ownerId, candidate.title, candidate.notes, candidate.createdAt]);
      return candidate;
    }, null);
  }

  async updateActivity(userId: string, command: UpdateActivityCommand): Promise<ActivityRecord | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query("SELECT * FROM routine_activities WHERE id = $1 AND owner_id = $2 FOR UPDATE", [command.activityId, userId]);
      if (!result.rows[0]) return null;
      const current = mapRoutineActivity(result.rows[0]);
      const next = applyActivityPatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (sameRoutinePayload({ ...next, updatedAt: current.updatedAt }, current)) return current;
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      await client.query("UPDATE routine_activities SET title=$3,notes=$4,archived_at=$5,updated_at=$6 WHERE id=$1 AND owner_id=$2",
        [current.id, userId, next.title, next.notes, next.archivedAt, next.updatedAt]);
      if (current.archivedAt === null && next.archivedAt !== null) {
        const scheduleIds = await loadPostgresRoutineScheduleIdsUsingActivity(client, userId, current.id);
        await deactivatePostgresRoutineSchedulesById(client, userId, scheduleIds, next.updatedAt);
      }
      return next;
    }, null);
  }

  async listRoutines(userId: string, page: RoutinePageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<RoutineSummaryRecord>> {
    return this.withWorkspaceRead(userId, actor, async (queryable) => {
      const result = await queryable.query(`SELECT routine.*,revision.revision_number,revision.title,revision.purpose
        FROM routines routine JOIN routine_revisions revision
          ON revision.id=routine.current_revision_id AND revision.routine_id=routine.id AND revision.owner_id=routine.owner_id
        WHERE routine.owner_id = $1 ${page.includeArchived ? "" : "AND routine.archived_at IS NULL"}`, [userId]);
      return pageCollectionRecords(result.rows.map(mapRoutineSummary).sort(compareRoutineTitledRows), page);
    });
  }

  async getRoutine(userId: string, routineId: string, actor: CalendarActor = "human"): Promise<RoutineDetail | null> {
    return this.withWorkspaceRead(userId, actor, async (queryable) => {
      const routineResult = await queryable.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2", [routineId, userId]);
      if (!routineResult.rows[0]) return null;
      const routine = mapRoutine(routineResult.rows[0]);
      return { routine, currentRevision: (await loadPostgresRoutineRevision(queryable, userId, routine.id, routine.currentRevisionId))! };
    });
  }

  async createRoutine(command: CreateRoutineCommand): Promise<CanonicalRoutineCreation> {
    const candidate = createCanonicalRoutine(command);
    return this.withTransaction([`routine-id:${candidate.routine.id}`, `routine-revision-id:${candidate.currentRevision.revision.id}`, `owner:${candidate.routine.ownerId}`], async (client) => {
      const existing = await client.query("SELECT * FROM routines WHERE id=$1 FOR UPDATE", [candidate.routine.id]);
      if (existing.rows[0]) {
        const row = mapRoutine(existing.rows[0]);
        const creation = { routine: row, currentRevision: (await loadPostgresRoutineRevision(client, row.ownerId, row.id, row.currentRevisionId))! };
        if (sameRoutineCreatePayload(creation, candidate)) return creation;
        return routineIdConflict();
      }
      await assertPostgresRoutineDefinitionReferences(client, candidate.routine.ownerId, candidate.routine.groupId, candidate.currentRevision);
      try { await persistPostgresRoutineCreation(client, candidate, true); }
      catch (error) { if (isPostgresUniqueViolation(error)) return routineIdConflict(); throw error; }
      return candidate;
    }, null);
  }

  async updateRoutine(userId: string, command: UpdateRoutineCommand, actor: CalendarActor = "human"): Promise<RoutineRecord | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await assertPostgresWorkspaceAgentConnection(client, userId, actor);
      assertAgentRoutineArchive(command.patch, actor);
      const result = await client.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.routineId, userId]);
      if (!result.rows[0]) return null;
      const current = mapRoutine(result.rows[0]);
      const next = applyRoutinePatch(current, command.patch, nextTimestamp(current.updatedAt));
      if (next.groupId) {
        if (next.groupId === current.groupId) await assertPostgresRoutineGroupExists(client, userId, next.groupId);
        else await assertActivePostgresRoutineGroup(client, userId, next.groupId);
      }
      if (sameRoutinePayload({ ...next, updatedAt: current.updatedAt }, current)) return current;
      assertRoutineUpdatedAt(current.updatedAt, command.expectedUpdatedAt);
      await client.query("UPDATE routines SET group_id=$3,archived_at=$4,updated_at=$5 WHERE id=$1 AND owner_id=$2", [current.id,userId,next.groupId,next.archivedAt,next.updatedAt]);
      if (current.archivedAt === null && next.archivedAt !== null) {
        await deactivatePostgresRoutineSchedules(client, userId, [current.id], next.updatedAt);
      }
      return next;
    }, null);
  }

  async reviseRoutine(userId: string, command: ReviseRoutineCommand): Promise<RoutineRevisionSnapshot | null> {
    return this.withTransaction([`owner:${userId}`, `routine-revision-id:${command.id}`], async (client) => {
      const result = await client.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.routineId,userId]);
      if (!result.rows[0]) return null;
      const current = mapRoutine(result.rows[0]);
      const previous = await loadPostgresRoutineRevision(client,userId,current.id,normalizeRoutineRevisionId(command.expectedCurrentRevisionId));
      if (!previous) throw new LifeLinkDomainError("stale_routine", "Routine previous revision is unavailable.", { retryable: true });
      const existing = await client.query("SELECT 1 FROM routine_revisions WHERE id=$1", [command.id]);
      if (existing.rowCount) {
        const snapshot = await loadPostgresRoutineRevision(client,userId,current.id,command.id);
        const {expectedCurrentRevisionId:_expectedCurrentRevisionId,...revisionCommand}=command;
        const desired = createCanonicalRoutineRevision(revisionCommand,previous.revision.ordering);
        if (snapshot && current.currentRevisionId === command.id && previous.revision.revisionNumber === snapshot.revision.revisionNumber - 1 &&
            sameRoutineCreatePayload(snapshot,desired)) return snapshot;
        return routineIdConflict();
      }
      const candidate = reviseCanonicalRoutine(current, command,previous.revision);
      const latest = await client.query("SELECT COALESCE(max(revision_number),0)::int AS revision_number FROM routine_revisions WHERE routine_id=$1", [current.id]);
      if (candidate.currentRevision.revision.revisionNumber !== Number(latest.rows[0].revision_number)+1) throw new LifeLinkDomainError("routine_conflict","Routine revision number must follow the current history.");
      await assertPostgresRoutineDefinitionReferences(client,userId,current.groupId,candidate.currentRevision,false);
      const schedules = await client.query("SELECT * FROM routine_schedules WHERE owner_id=$1 AND routine_id=$2 AND active=true FOR UPDATE",[userId,current.id]);
      const occurrences = await client.query(`SELECT occurrence.*, EXISTS (
        SELECT 1 FROM routine_runs run WHERE run.owner_id=occurrence.owner_id AND run.occurrence_id=occurrence.id
        ) AS has_run FROM routine_occurrences occurrence
        WHERE occurrence.owner_id=$1 AND occurrence.routine_id=$2 AND occurrence.status='planned' AND occurrence.planned_for>$3
        FOR UPDATE OF occurrence`,[userId,current.id,candidate.currentRevision.revision.createdAt]);
      const scheduling = planRoutineRevisionScheduling(candidate.currentRevision.revision,schedules.rows.map(mapRoutineSchedule),
        occurrences.rows.map(mapRoutineOccurrence),new Set(occurrences.rows.filter((row)=>row.has_run).map((row)=>String(row.id))));
      try { await persistPostgresRoutineCreation(client,candidate,false); }
      catch (error) { if (isPostgresUniqueViolation(error)) return routineIdConflict(); throw error; }
      for (const schedule of scheduling.schedules) await client.query(
        "UPDATE routine_schedules SET routine_revision_id=$3,revision=$4,updated_at=$5 WHERE id=$1 AND owner_id=$2",
        [schedule.id,userId,schedule.routineRevisionId,schedule.revision,schedule.updatedAt]);
      for (const occurrence of scheduling.occurrences) await client.query(
        "UPDATE routine_occurrences SET routine_revision_id=$3,schedule_revision=$4,updated_at=$5 WHERE id=$1 AND owner_id=$2",
        [occurrence.id,userId,occurrence.routineRevisionId,occurrence.scheduleRevision,occurrence.updatedAt]);
      return candidate.currentRevision;
    }, null);
  }

  async getRoutineRevision(userId: string, routineId: string, revisionId: string): Promise<RoutineRevisionSnapshot | null> {
    return loadPostgresRoutineRevision(this.pool,userId,routineId,revisionId);
  }

  async listRoutineSchedules(userId: string, routineId: string, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<RoutineScheduleRecord> | null> {
    if (!(await this.pool.query("SELECT 1 FROM routines WHERE id=$1 AND owner_id=$2",[routineId,userId])).rowCount) return null;
    const result = await this.pool.query("SELECT * FROM routine_schedules WHERE owner_id=$1 AND routine_id=$2 ORDER BY updated_at DESC,id",[userId,routineId]);
    return pageCollectionRecords(result.rows.map(mapRoutineSchedule),page);
  }

  async createRoutineSchedule(command: CreateRoutineScheduleCommand): Promise<RoutineScheduleRecord> {
    const candidate = createCanonicalRoutineSchedule(command);
    return this.withTransaction([`routine-schedule-id:${candidate.id}`,`owner:${candidate.ownerId}`],async(client)=>{
      const existing = await client.query("SELECT * FROM routine_schedules WHERE id=$1 FOR UPDATE",[candidate.id]);
      if(existing.rows[0]) { const row=mapRoutineSchedule(existing.rows[0]); if(sameRoutineCreatePayload(row,candidate)) return row; return routineIdConflict(); }
      await assertPostgresRoutineScheduleReferences(client,candidate);
      await insertPostgresRoutineSchedule(client,candidate);
      return candidate;
    },null);
  }

  async updateRoutineSchedule(userId: string, command: UpdateRoutineScheduleCommand): Promise<RoutineScheduleRecord | null> {
    return this.withTransaction([`owner:${userId}`],async(client)=>{
      const result=await client.query("SELECT * FROM routine_schedules WHERE id=$1 AND owner_id=$2 FOR UPDATE",[command.scheduleId,userId]);
      if(!result.rows[0]) return null;
      const current=mapRoutineSchedule(result.rows[0]);
      const routineResult=await client.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2 FOR UPDATE",[current.routineId,userId]);
      const routine=mapRoutine(routineResult.rows[0]);
      const pinnedNext=applyRoutineSchedulePatch(current,current.routineRevisionId,command.patch,nextTimestamp(current.updatedAt));
      const ruleChanged=!sameRoutinePayload(pinnedNext.rule,current.rule);
      const safeDisable=command.patch.active===false&&!ruleChanged;
      if(safeDisable){
        const noOp=sameRoutinePayload({...pinnedNext,revision:current.revision,updatedAt:current.updatedAt},current);
        if(noOp)return current;
        assertRoutineUpdatedAt(current.updatedAt,command.expectedUpdatedAt);
        await client.query("UPDATE routine_schedules SET revision=$3,active=false,updated_at=$4 WHERE id=$1 AND owner_id=$2",
          [current.id,userId,pinnedNext.revision,pinnedNext.updatedAt]);
        await client.query(`UPDATE routine_occurrences SET status='canceled',updated_at=$3 WHERE schedule_id=$1 AND owner_id=$2
          AND status='planned' AND planned_for>$3`,[current.id,userId,pinnedNext.updatedAt]);
        return pinnedNext;
      }
      if(routine.archivedAt) throw new LifeLinkDomainError("routine_conflict","Archived Routine schedule cannot be changed.");
      await assertPostgresRoutineHasNoArchivedActivities(client,userId,routine.currentRevisionId);
      const next=applyRoutineSchedulePatch(current,routine.currentRevisionId,command.patch,nextTimestamp(current.updatedAt));
      const noOp=sameRoutinePayload({...next,revision:current.revision,updatedAt:current.updatedAt},current);
      if(noOp) return current;
      assertRoutineUpdatedAt(current.updatedAt,command.expectedUpdatedAt);
      await client.query("UPDATE routine_schedules SET routine_revision_id=$3,rule=$4::jsonb,revision=$5,active=$6,updated_at=$7 WHERE id=$1 AND owner_id=$2",
        [current.id,userId,next.routineRevisionId,JSON.stringify(next.rule),next.revision,next.active,next.updatedAt]);
      const occurrenceRows=await client.query(`SELECT * FROM routine_occurrences WHERE schedule_id=$1 AND owner_id=$2
        AND status IN ('planned','canceled') AND planned_for>$3 FOR UPDATE`,[current.id,userId,next.updatedAt]);
      for(const row of occurrenceRows.rows){
        const occurrence=mapRoutineOccurrence(row);
        const matches=next.active&&routineScheduleMatchesLocalDate(next.rule,occurrence.localDate);
        if(matches)await client.query(`UPDATE routine_occurrences SET schedule_revision=$3,routine_revision_id=$4,
          planned_for=$5,status='planned',updated_at=$6 WHERE id=$1 AND owner_id=$2`,[occurrence.id,userId,next.revision,next.routineRevisionId,
          resolveRoutineSchedulePlannedFor(next.rule,occurrence.localDate),next.updatedAt]);
        else await client.query("UPDATE routine_occurrences SET status='canceled',updated_at=$3 WHERE id=$1 AND owner_id=$2",[occurrence.id,userId,next.updatedAt]);
      }
      return next;
    },null);
  }

  async materializeRoutineOccurrences(userId: string, routineId: string, input: MaterializeRoutineOccurrencesInput): Promise<RoutineOccurrenceRecord[]> {
    return this.withTransaction([`owner:${userId}`],async(client)=>{
      const routineResult=await client.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2 FOR UPDATE",[routineId,userId]);
      if(!routineResult.rows[0]) return [];
      const routine=mapRoutine(routineResult.rows[0]);
      if(routine.archivedAt) throw new LifeLinkDomainError("routine_conflict","Archived Routine cannot materialize occurrences.");
      await assertPostgresRoutineHasNoArchivedActivities(client,userId,routine.currentRevisionId);
      const schedules=await client.query("SELECT * FROM routine_schedules WHERE owner_id=$1 AND routine_id=$2 AND active=true ORDER BY id",[userId,routineId]);
      const createdAt=new Date().toISOString();
      const rows: RoutineOccurrenceRecord[]=[];
      for(const scheduleRow of schedules.rows){
        const schedule=mapRoutineSchedule(scheduleRow);
        await assertPostgresRoutineHasNoArchivedActivities(client,userId,schedule.routineRevisionId);
        for(const localDate of listRoutineScheduleLocalDates(schedule.rule,input.startDate,input.endDate)){
          const occurrence=createCanonicalRoutineOccurrence(schedule,{id:`routine-occurrence-${randomUUID()}`,localDate,createdAt});
          const inserted=await client.query(`INSERT INTO routine_occurrences
            (id,owner_id,schedule_id,schedule_revision,routine_id,routine_revision_id,local_date,planned_for,status,created_at,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
            ON CONFLICT(owner_id,schedule_id,local_date) DO NOTHING RETURNING *`,
            [occurrence.id,occurrence.ownerId,occurrence.scheduleId,occurrence.scheduleRevision,occurrence.routineId,occurrence.routineRevisionId,occurrence.localDate,occurrence.plannedFor,occurrence.status,occurrence.createdAt]);
          if(inserted.rows[0]) rows.push(mapRoutineOccurrence(inserted.rows[0]));
          else {
            const existing=await client.query("SELECT * FROM routine_occurrences WHERE owner_id=$1 AND schedule_id=$2 AND local_date=$3",[userId,schedule.id,localDate]);
            rows.push(mapRoutineOccurrence(existing.rows[0]));
          }
        }
      }
      return rows.sort(compareRoutineOccurrenceOrder);
    },null);
  }

  async listRoutineOccurrences(userId: string, page: RoutineOccurrencePageRequest = {}): Promise<LifeLinkPage<RoutineOccurrenceRecord>> {
    const values: unknown[]=[userId];
    const clauses=["owner_id=$1"];
    if(page.routineId){ values.push(page.routineId); clauses.push(`routine_id=$${values.length}`); }
    if(page.startDate){ values.push(page.startDate); clauses.push(`local_date>=$${values.length}::date`); }
    if(page.endDate){ values.push(page.endDate); clauses.push(`local_date<=$${values.length}::date`); }
    const result=await this.pool.query(`SELECT * FROM routine_occurrences WHERE ${clauses.join(" AND ")} ORDER BY planned_for,id`,values);
    return pageCollectionRecords(result.rows.map(mapRoutineOccurrence),page);
  }

  async getRoutineOccurrence(userId: string, occurrenceId: string): Promise<RoutineOccurrenceRecord | null> {
    const result=await this.pool.query("SELECT * FROM routine_occurrences WHERE id=$1 AND owner_id=$2",[occurrenceId,userId]);
    return result.rows[0]?mapRoutineOccurrence(result.rows[0]):null;
  }

  async startRoutineRun(userId: string, command: StartRoutineRunCommand): Promise<RoutineRunRecord | null> {
    return this.withTransaction([`owner:${userId}`,`routine-run-id:${command.id}`],async(client)=>{
      const existing=await client.query("SELECT * FROM routine_runs WHERE id=$1 FOR UPDATE",[command.id]);
      if(existing.rows[0]){
        const row=mapRoutineRun(existing.rows[0]);
        if(row.ownerId===userId&&row.routineId===command.routineId&&row.occurrenceId===(command.occurrenceId??null))return row;
        return routineIdConflict();
      }
      const routineResult=await client.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2 FOR UPDATE",[command.routineId,userId]);
      if(!routineResult.rows[0])return null;
      const routine=mapRoutine(routineResult.rows[0]);
      if(routine.archivedAt)throw new LifeLinkDomainError("routine_conflict","Archived Routine cannot start a Run.");
      if((await client.query("SELECT 1 FROM routine_runs WHERE owner_id=$1 AND routine_id=$2 AND status='active'",[userId,routine.id])).rowCount)
        throw new LifeLinkDomainError("routine_conflict","Routine already has an active Run.");
      let occurrence: RoutineOccurrenceRecord|null=null;
      if(command.occurrenceId){
        const occurrenceResult=await client.query("SELECT * FROM routine_occurrences WHERE id=$1 AND owner_id=$2 FOR UPDATE",[command.occurrenceId,userId]);
        if(!occurrenceResult.rows[0])return null;
        occurrence=mapRoutineOccurrence(occurrenceResult.rows[0]);
        if(occurrence.routineId!==routine.id)return null;
        if(occurrence.status!=="planned")throw new LifeLinkDomainError("routine_conflict","Routine occurrence cannot start a Run.");
      }
      const revisionId=occurrence?.routineRevisionId??routine.currentRevisionId;
      await assertPostgresRoutineHasNoArchivedActivities(client,userId,revisionId);
      const revision=(await loadPostgresRoutineRevision(client,userId,routine.id,revisionId))!;
      const contextSnapshot=await buildPostgresRoutineContextSnapshot(client,userId,revision);
      const run=createCanonicalRoutineRun({id:command.id,ownerId:userId,routineId:routine.id,routineRevisionId:revisionId,
        occurrenceId:occurrence?.id??null,contextSnapshot,startedAt:command.startedAt},revision);
      await insertPostgresRoutineRun(client,run);
      if(occurrence)await client.query("UPDATE routine_occurrences SET status='started',updated_at=$3 WHERE id=$1 AND owner_id=$2",[occurrence.id,userId,run.startedAt]);
      return run;
    },null);
  }

  async getRoutineRun(userId: string, runId: string): Promise<RoutineRunRecord | null> {
    const result=await this.pool.query("SELECT * FROM routine_runs WHERE id=$1 AND owner_id=$2",[runId,userId]);
    return result.rows[0]?mapRoutineRun(result.rows[0]):null;
  }

  async getActiveRoutineRun(userId: string, routineId: string): Promise<RoutineRunRecord | null> {
    const result=await this.pool.query("SELECT * FROM routine_runs WHERE owner_id=$1 AND routine_id=$2 AND status='active'",[userId,routineId]);
    return result.rows[0]?mapRoutineRun(result.rows[0]):null;
  }

  async putRoutineRunStepResult(userId: string, command: PutRoutineRunStepResultCommand): Promise<RoutineRunRecord | null> {
    return this.withTransaction([`owner:${userId}`],async(client)=>{
      const runResult=await client.query("SELECT * FROM routine_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE",[command.runId,userId]);
      if(!runResult.rows[0])return null;
      const run=mapRoutineRun(runResult.rows[0]);
      const stepResult=await client.query("SELECT * FROM routine_steps WHERE id=$1 AND owner_id=$2 AND routine_revision_id=$3",[command.routineStepId,userId,run.routineRevisionId]);
      if(!stepResult.rows[0])return null;
      const next=applyRoutineRunStepResult(run,mapRoutineStep(stepResult.rows[0]),command,nextTimestamp(run.updatedAt));
      if(!sameRoutinePayload(next,run))await client.query("UPDATE routine_runs SET step_results=$3::jsonb,updated_at=$4 WHERE id=$1 AND owner_id=$2",[run.id,userId,JSON.stringify(next.stepResults),next.updatedAt]);
      return next;
    },null);
  }

  async finalizeRoutineRun(userId: string, command: FinalizeRoutineRunCommand): Promise<BuiltRoutineSession | null> {
    return this.withTransaction([`owner:${userId}`,`routine-session-id:${command.sessionId}`],async(client)=>{
      const replayResult=await client.query("SELECT * FROM routine_sessions WHERE owner_id=$1 AND run_id=$2",[userId,command.runId]);
      if(replayResult.rows[0]){
        const session=mapRoutineSession(replayResult.rows[0]);
        if(session.id!==command.sessionId)return routineIdConflict();
        return loadPostgresBuiltRoutineSession(client,session);
      }
      const runResult=await client.query("SELECT * FROM routine_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE",[command.runId,userId]);
      if(!runResult.rows[0])return null;
      const run=mapRoutineRun(runResult.rows[0]);
      assertRoutineUpdatedAt(run.updatedAt,command.expectedUpdatedAt);
      const identities=run.stepResults.map(result=>({routineStepId:result.routineStepId,id:stableRoutineSessionResultId(command.sessionId,result.routineStepId)}));
      const built=buildRoutineSessionFromRun(run,command.sessionId,identities,command.completedAt);
      if((await client.query("SELECT 1 FROM routine_sessions WHERE id=$1",[built.session.id])).rowCount)return routineIdConflict();
      await client.query("UPDATE routine_runs SET status='finalized',updated_at=$3 WHERE id=$1 AND owner_id=$2",[run.id,userId,built.finalizedRun.updatedAt]);
      await insertPostgresRoutineSession(client,built);
      if(run.occurrenceId)await client.query("UPDATE routine_occurrences SET status='completed',updated_at=$3 WHERE id=$1 AND owner_id=$2",[run.occurrenceId,userId,built.session.completedAt]);
      return built;
    },null);
  }

  async listRoutineSessions(userId: string, routineId: string | null, page: LifeLinkPageRequest = {}): Promise<LifeLinkPage<RoutineSessionRecord>> {
    const result=await this.pool.query(`SELECT * FROM routine_sessions WHERE owner_id=$1 ${routineId?"AND routine_id=$2":""} ORDER BY completed_at DESC,id`,routineId?[userId,routineId]:[userId]);
    return pageCollectionRecords(result.rows.map(mapRoutineSession),page);
  }

  async getRoutineSession(userId: string, sessionId: string): Promise<RoutineSessionProjection | null> {
    const sessionResult=await this.pool.query("SELECT * FROM routine_sessions WHERE id=$1 AND owner_id=$2",[sessionId,userId]);
    if(!sessionResult.rows[0])return null;
    const session=mapRoutineSession(sessionResult.rows[0]);
    const results=await this.pool.query("SELECT * FROM routine_session_step_results WHERE session_id=$1 AND owner_id=$2 ORDER BY routine_step_id",[sessionId,userId]);
    const amendments=await this.pool.query("SELECT * FROM routine_session_amendments WHERE session_id=$1 AND owner_id=$2 ORDER BY created_at,id",[sessionId,userId]);
    return projectRoutineSessionWithAmendments(session,results.rows.map(mapRoutineSessionStepResult),amendments.rows.map(mapRoutineSessionAmendment));
  }

  async appendRoutineSessionAmendment(userId: string, command: AppendRoutineSessionAmendmentCommand): Promise<RoutineSessionAmendmentRecord | null> {
    return this.withTransaction([`owner:${userId}`,`routine-amendment-id:${command.id}`],async(client)=>{
      const sessionResult=await client.query("SELECT * FROM routine_sessions WHERE id=$1 AND owner_id=$2",[command.sessionId,userId]);
      if(!sessionResult.rows[0])return null;
      const session=mapRoutineSession(sessionResult.rows[0]);
      let stepResult: RoutineSessionStepResultRecord|null=null;
      let plannedValues: RoutineStepRecord["plannedValues"]|undefined;
      if(command.stepResultId){
        const result=await client.query(`SELECT result.*,step.planned_values FROM routine_session_step_results result
          JOIN routine_steps step ON step.id=result.routine_step_id AND step.owner_id=result.owner_id
          WHERE result.id=$1 AND result.session_id=$2 AND result.owner_id=$3`,[command.stepResultId,session.id,userId]);
        if(!result.rows[0])return null;
        stepResult=mapRoutineSessionStepResult(result.rows[0]);
        plannedValues=result.rows[0].planned_values as RoutineStepRecord["plannedValues"];
      }
      const candidate=createCanonicalRoutineSessionAmendment({ownerId:userId,session,stepResult,plannedValues,command});
      const existing=await client.query("SELECT * FROM routine_session_amendments WHERE id=$1 FOR UPDATE",[candidate.id]);
      if(existing.rows[0]){const row=mapRoutineSessionAmendment(existing.rows[0]);if(sameRoutineCreatePayload(row,candidate))return row;return routineIdConflict();}
      await client.query(`INSERT INTO routine_session_amendments
        (id,owner_id,session_id,step_result_id,note,corrected_actual_values,corrected_proposed_next_values,created_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,[candidate.id,candidate.ownerId,candidate.sessionId,candidate.stepResultId,candidate.note,
        candidate.correctedActualValues===null?null:JSON.stringify(candidate.correctedActualValues),candidate.correctedProposedNextValues===null?null:JSON.stringify(candidate.correctedProposedNextValues),candidate.createdAt]);
      return candidate;
    },null);
  }

  async listCalendars(userId: string, page: CalendarPageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<CalendarRecord>> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
    const result = await queryable.query(
      `SELECT * FROM calendars WHERE owner_id=$1 ${page.includeDeleted ? "" : "AND deleted_at IS NULL"}
       ORDER BY is_default DESC, lower(title), id`,
      [userId]
    );
    return pageCollectionRecords(result.rows.map(mapCalendar).filter((calendar) => calendarActorCanRead(calendar, actor)), page);
    });
  }

  async getCalendar(userId: string, calendarId: string, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
      const result = await queryable.query("SELECT * FROM calendars WHERE id=$1 AND owner_id=$2", [calendarId, userId]);
      const calendar = result.rows[0] ? mapCalendar(result.rows[0]) : null;
      return calendar && calendarActorCanRead(calendar, actor) ? calendar : null;
    });
  }

  async createCalendar(command: CreateCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord> {
    assertHumanCalendarActor(actor);
    const candidate = createCanonicalCalendar(command);
    return this.withTransaction([`owner:${candidate.ownerId}`, `calendar-id:${candidate.id}`], async (client) => {
      if (!(await client.query("SELECT 1 FROM users WHERE id=$1", [candidate.ownerId])).rowCount) {
        throw new CalendarDomainError("calendar_reference_conflict", "Calendar owner was not found.", { reason: "owner_not_found" });
      }
      const existing = await client.query("SELECT * FROM calendars WHERE id=$1 FOR UPDATE", [candidate.id]);
      if (existing.rows[0]) {
        const row = mapCalendar(existing.rows[0]);
        if (sameCalendarCreatePayload(row, candidate)) return row;
        return calendarConflict("Calendar identity is already bound to another request.", "calendar_id_conflict");
      }
      if (candidate.isDefault) await clearPostgresDefaultCalendars(client, candidate.ownerId, candidate.id, candidate.createdAt);
      await insertPostgresCalendar(client, candidate);
      return candidate;
    }, null);
  }

  async updateCalendar(userId: string, command: UpdateCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query("SELECT * FROM calendars WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.calendarId, userId]);
      if (!result.rows[0]) return null;
      const current = mapCalendar(result.rows[0]);
      assertNativeCalendarWriteAuthority(current);
      const candidate = applyCalendarPatch(current, command, nextTimestamp(current.updatedAt));
      if (sameCalendarPayload({ ...candidate, updatedAt: current.updatedAt }, current)) return current;
      if (candidate.isDefault) await clearPostgresDefaultCalendars(client, userId, candidate.id, candidate.updatedAt);
      await updatePostgresCalendar(client, candidate);
      return candidate;
    }, null);
  }

  async softDeleteCalendar(userId: string, command: SoftDeleteCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query("SELECT * FROM calendars WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.calendarId, userId]);
      if (!result.rows[0]) return null;
      const current = mapCalendar(result.rows[0]);
      assertNativeCalendarWriteAuthority(current);
      if ((await client.query("SELECT 1 FROM calendar_events WHERE owner_id=$1 AND calendar_id=$2 AND deleted_at IS NULL LIMIT 1", [userId, current.id])).rowCount) {
        return calendarConflict("Calendar with active events cannot be deleted.", "calendar_not_empty");
      }
      const candidate = softDeleteCalendar(current, command);
      await updatePostgresCalendar(client, candidate);
      return candidate;
    }, null);
  }

  async restoreCalendar(userId: string, command: RestoreCalendarCommand, actor: CalendarActor = "human"): Promise<CalendarRecord | null> {
    assertHumanCalendarActor(actor);
    return this.withTransaction([`owner:${userId}`], async (client) => {
      const result = await client.query("SELECT * FROM calendars WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.calendarId, userId]);
      if (!result.rows[0]) return null;
      const current = mapCalendar(result.rows[0]);
      assertNativeCalendarWriteAuthority(current);
      const candidate = restoreCalendar(current, command);
      if (candidate.isDefault && (await client.query(
        "SELECT 1 FROM calendars WHERE owner_id=$1 AND id<>$2 AND is_default AND deleted_at IS NULL LIMIT 1",
        [userId, candidate.id]
      )).rowCount) return calendarConflict("Another Calendar is already the default.", "default_calendar_conflict");
      await updatePostgresCalendar(client, candidate);
      return candidate;
    }, null);
  }

  async listCalendarEvents(userId: string, page: CalendarEventPageRequest = {}, actor: CalendarActor = "human"): Promise<LifeLinkPage<CalendarEventDetail>> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
    assertCalendarEventDateWindow(page);
    if (page.calendarId && !(await queryable.query("SELECT 1 FROM calendars WHERE id=$1 AND owner_id=$2", [page.calendarId, userId])).rowCount) {
      return { items: [], truncated: false, nextCursor: null };
    }
    const result = await queryable.query(
      `SELECT event.* FROM calendar_events event JOIN calendars calendar ON calendar.id=event.calendar_id AND calendar.owner_id=event.owner_id
       WHERE event.owner_id=$1 ${page.calendarId ? "AND event.calendar_id=$2" : ""}
       ${page.includeDeleted ? "" : "AND event.deleted_at IS NULL"}
       ${actor === "agent" ? "AND calendar.deleted_at IS NULL AND calendar.agent_access IN ('read','write')" : ""}`,
      page.calendarId ? [userId, page.calendarId] : [userId]
    );
    const details = await Promise.all(result.rows.map((row) => loadPostgresCalendarEventDetail(queryable, mapCalendarEvent(row))));
    const wrapped = details.filter((detail) => calendarEventInDateWindow(detail, page))
      .sort(compareCalendarEventDetails).map((detail) => ({ id: detail.event.id, detail }));
    const paged = pageCollectionRecords(wrapped, page);
    return { ...paged, items: paged.items.map((item) => item.detail) };
    });
  }

  async getCalendarEvent(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
      const event = await readPostgresCalendarEventForActor(queryable, userId, eventId, actor);
      return event ? loadPostgresCalendarEventDetail(queryable, event) : null;
    });
  }

  async listCalendarEventRevisions(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventRevisionRecord[] | null> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
    if (!(await readPostgresCalendarEventForActor(queryable, userId, eventId, actor))) return null;
    const result = await queryable.query(
      "SELECT * FROM calendar_event_revisions WHERE event_id=$1 AND owner_id=$2 ORDER BY revision_number",
      [eventId, userId]
    );
    return Promise.all(result.rows.map((row) => loadPostgresCalendarEventRevision(queryable, row)));
    });
  }

  async createCalendarEvent(command: CreateCalendarEventCommand, actor: CalendarActor = "human"): Promise<CanonicalCalendarEventCreation> {
    const candidate = createCanonicalCalendarEvent(command);
    return this.withTransaction([
      `owner:${candidate.event.ownerId}`,
      `calendar-event-id:${candidate.event.id}`,
      `calendar-event-revision-id:${candidate.currentRevision.id}`
    ], async (client) => {
      await assertPostgresAgentCalendarWrite(client, candidate.event.ownerId, candidate.event.calendarId, actor);
      const existing = await client.query("SELECT * FROM calendar_events WHERE id=$1 FOR UPDATE", [candidate.event.id]);
      if (existing.rows[0]) {
        const detail = await loadPostgresCalendarEventDetail(client, mapCalendarEvent(existing.rows[0]));
        if (sameCalendarCreatePayload(detail, candidate)) return detail;
        return calendarConflict("Calendar event identity is already bound to another request.", "event_id_conflict");
      }
      if ((await client.query("SELECT 1 FROM calendar_event_revisions WHERE id=$1", [candidate.currentRevision.id])).rowCount) {
        return calendarConflict("Calendar event revision identity is already in use.", "event_revision_id_conflict");
      }
      await assertPostgresCalendarEventReferences(client, candidate.event, candidate.currentRevision);
      await insertPostgresCalendarEvent(client, candidate.event);
      await insertPostgresCalendarEventRevision(client, candidate.currentRevision);
      return candidate;
    }, null);
  }

  async reviseCalendarEvent(userId: string, command: ReviseCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    return this.withTransaction([`owner:${userId}`, `calendar-event-revision-id:${command.revisionId}`], async (client) => {
      await assertPostgresCalendarAgentConnection(client, userId, actor);
      const eventResult = await client.query("SELECT * FROM calendar_events WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.eventId, userId]);
      if (!eventResult.rows[0]) return null;
      const event = mapCalendarEvent(eventResult.rows[0]);
      await assertPostgresAgentCalendarWrite(client, userId, event.calendarId, actor);
      const replayResult = await client.query("SELECT * FROM calendar_event_revisions WHERE id=$1", [command.revisionId]);
      if (replayResult.rows[0]) {
        const replay = await loadPostgresCalendarEventRevision(client, replayResult.rows[0]);
        const previousResult = await client.query(
          "SELECT * FROM calendar_event_revisions WHERE owner_id=$1 AND event_id=$2 AND revision_number=$3",
          [userId, event.id, replay.revisionNumber - 1]
        );
        if (replay.ownerId === userId && replay.eventId === event.id && event.currentRevisionId === replay.id && previousResult.rows[0]) {
          const previous = await loadPostgresCalendarEventRevision(client, previousResult.rows[0]);
          if (command.expectedCurrentRevisionId === previous.id) {
            const replayCandidate = reviseCanonicalCalendarEvent(
              { ...event, currentRevisionId: previous.id, updatedAt: previous.createdAt, deletedAt: null }, previous,
              { ...command, createdAt: replay.createdAt }
            );
            if (isDeepStrictEqual(replayCandidate.currentRevision, replay)) return loadPostgresCalendarEventDetail(client, event);
          }
        }
        return calendarConflict("Calendar event revision identity is already in use.", "event_revision_id_conflict");
      }
      const currentResult = await client.query("SELECT * FROM calendar_event_revisions WHERE id=$1 AND owner_id=$2", [event.currentRevisionId, userId]);
      const currentRevision = await loadPostgresCalendarEventRevision(client, currentResult.rows[0]);
      const candidate = reviseCanonicalCalendarEvent(event, currentRevision, command);
      await assertPostgresCalendarEventReferences(client, candidate.event, candidate.currentRevision);
      await insertPostgresCalendarEventRevision(client, candidate.currentRevision);
      await client.query("UPDATE calendar_events SET current_revision_id=$3,updated_at=$4 WHERE id=$1 AND owner_id=$2", [event.id, userId, candidate.event.currentRevisionId, candidate.event.updatedAt]);
      return candidate;
    }, null);
  }

  async softDeleteCalendarEvent(userId: string, command: SoftDeleteCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDeletion | null> {
    return this.withTransaction([`owner:${userId}`, `calendar-event-tombstone-id:${command.tombstoneId}`], async (client) => {
      await assertPostgresCalendarAgentConnection(client, userId, actor);
      const eventResult = await client.query("SELECT * FROM calendar_events WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.eventId, userId]);
      if (!eventResult.rows[0]) return null;
      const event = mapCalendarEvent(eventResult.rows[0]);
      await assertPostgresAgentCalendarWrite(client, userId, event.calendarId, actor);
      const replayResult = await client.query("SELECT * FROM calendar_event_tombstones WHERE id=$1", [command.tombstoneId]);
      if (replayResult.rows[0]) {
        const tombstone = mapCalendarEventTombstone(replayResult.rows[0]);
        if (tombstone.ownerId === userId && tombstone.eventId === event.id &&
          tombstone.lastRevisionId === command.expectedCurrentRevisionId && event.deletedAt === tombstone.deletedAt) {
          return { event, tombstone };
        }
        return calendarConflict("Calendar event tombstone identity is already in use.", "event_tombstone_id_conflict");
      }
      const deletion = softDeleteCalendarEvent(event, command);
      await client.query("UPDATE calendar_events SET updated_at=$3,deleted_at=$4 WHERE id=$1 AND owner_id=$2", [event.id, userId, deletion.event.updatedAt, deletion.event.deletedAt]);
      await insertPostgresCalendarEventTombstone(client, deletion.tombstone);
      return deletion;
    }, null);
  }

  async restoreCalendarEvent(userId: string, command: RestoreCalendarEventCommand, actor: CalendarActor = "human"): Promise<CalendarEventDetail | null> {
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await assertPostgresCalendarAgentConnection(client, userId, actor);
      const eventResult = await client.query("SELECT * FROM calendar_events WHERE id=$1 AND owner_id=$2 FOR UPDATE", [command.eventId, userId]);
      const tombstoneResult = await client.query("SELECT * FROM calendar_event_tombstones WHERE id=$1 AND owner_id=$2", [command.tombstoneId, userId]);
      if (!eventResult.rows[0] || !tombstoneResult.rows[0]) return null;
      const event = mapCalendarEvent(eventResult.rows[0]);
      await assertPostgresAgentCalendarWrite(client, userId, event.calendarId, actor);
      const calendarResult = await client.query("SELECT 1 FROM calendars WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [event.calendarId, userId]);
      if (!calendarResult.rowCount) return calendarConflict("Deleted Calendar event cannot be restored into an unavailable Calendar.", "calendar_unavailable");
      const restored = restoreCalendarEvent(event, mapCalendarEventTombstone(tombstoneResult.rows[0]), command);
      const revisionResult = await client.query(
        "SELECT * FROM calendar_event_revisions WHERE id=$1 AND event_id=$2 AND owner_id=$3",
        [restored.currentRevisionId, restored.id, userId]
      );
      if (!revisionResult.rows[0]) {
        throw new CalendarDomainError("calendar_reference_conflict", "Calendar event current revision is unavailable.", {
          reason: "current_revision_not_found"
        });
      }
      await assertPostgresCalendarEventReferences(
        client,
        restored,
        await loadPostgresCalendarEventRevision(client, revisionResult.rows[0])
      );
      await client.query("UPDATE calendar_events SET updated_at=$3,deleted_at=NULL WHERE id=$1 AND owner_id=$2", [event.id, userId, restored.updatedAt]);
      return loadPostgresCalendarEventDetail(client, restored);
    }, null);
  }

  async listCalendarEventTombstones(userId: string, eventId: string, actor: CalendarActor = "human"): Promise<CalendarEventTombstoneRecord[] | null> {
    return this.withCalendarRead(userId, actor, async (queryable) => {
    if (!(await readPostgresCalendarEventForActor(queryable, userId, eventId, actor))) return null;
    const result = await queryable.query(
      "SELECT * FROM calendar_event_tombstones WHERE event_id=$1 AND owner_id=$2 ORDER BY deleted_at,id",
      [eventId, userId]
    );
    return result.rows.map(mapCalendarEventTombstone);
    });
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

  private async withCalendarRead<T>(userId: string, actor: CalendarActor, work: (queryable: Queryable) => Promise<T>): Promise<T> {
    if (actor === "human") return work(this.pool);
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await assertPostgresCalendarAgentConnection(client, userId, actor);
      return work(client);
    }, null);
  }

  private async withWorkspaceRead<T>(userId: string, actor: CalendarActor, work: (queryable: Queryable) => Promise<T>): Promise<T> {
    if (actor === "human") return work(this.pool);
    return this.withTransaction([`owner:${userId}`], async (client) => {
      await assertPostgresWorkspaceAgentConnection(client, userId, actor);
      return work(client);
    }, null);
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

async function assertPostgresCalendarAgentConnection(queryable: Queryable, userId: string, actor: CalendarActor): Promise<void> {
  if (actor === "human") return;
  assertCalendarAgentConnection(await readPostgresAgentConnection(queryable, userId), actor);
}

async function assertPostgresWorkspaceAgentConnection(queryable: Queryable, userId: string, actor: CalendarActor): Promise<void> {
  if (actor === "human") return;
  assertWorkspaceAgentConnection(await readPostgresAgentConnection(queryable, userId), actor);
}

async function readPostgresAgentConnection(queryable: Queryable, userId: string): Promise<Pick<StoredUser, "id" | "agentConnectedAt" | "agentToolCatalogId"> | null> {
  // Hold the user row through the transaction so disconnect/catalog revocation
  // cannot race a previously authorized write or partially hydrated read.
  const result = await queryable.query(
    "SELECT id,agent_connected_at,agent_tool_catalog_id FROM users WHERE id=$1 FOR SHARE", [userId]
  );
  const row = result.rows[0];
  return row ? {
    id: row.id,
    agentConnectedAt: nullableIso(row.agent_connected_at),
    agentToolCatalogId: row.agent_tool_catalog_id as AgentToolCatalogId | null
  } : null;
}

async function assertPostgresAgentCalendarWrite(
  client: PoolClient, userId: string, calendarId: string, actor: CalendarActor
): Promise<void> {
  if (actor === "human") return;
  await assertPostgresCalendarAgentConnection(client, userId, actor);
  const result = await client.query(
    "SELECT agent_access,deleted_at FROM calendars WHERE id=$1 AND owner_id=$2 FOR SHARE", [calendarId, userId]
  );
  const calendar = result.rows[0];
  if (!calendar || calendar.deleted_at !== null || calendar.agent_access !== "write") {
    throw new CalendarDomainError("calendar_access_denied", "Calendar agent write access is unavailable.", { reason: "agent_calendar_write_denied" });
  }
}

async function readPostgresCalendarEventForActor(
  queryable: Queryable, userId: string, eventId: string, actor: CalendarActor
): Promise<CalendarEventRecord | null> {
  const result = await queryable.query(
    `SELECT event.* FROM calendar_events event JOIN calendars calendar ON calendar.id=event.calendar_id AND calendar.owner_id=event.owner_id
     WHERE event.id=$1 AND event.owner_id=$2
     ${actor === "agent" ? "AND calendar.deleted_at IS NULL AND calendar.agent_access IN ('read','write')" : ""}`,
    [eventId, userId]
  );
  return result.rows[0] ? mapCalendarEvent(result.rows[0]) : null;
}

function mapCalendar(row: Record<string, unknown>): CalendarRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    color: String(row.color),
    timeZone: String(row.time_zone),
    source: normalizeCalendarSource(row.source),
    agentAccess: normalizeCalendarAgentAccess(row.agent_access),
    isDefault: Boolean(row.is_default),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: nullableIso(row.deleted_at)
  };
}

function mapCalendarEvent(row: Record<string, unknown>): CalendarEventRecord {
  const lineageKind = String(row.lineage_kind);
  let lineage: CalendarEventLineage;
  if (lineageKind === "recurrence_exception") {
    lineage = {
      kind: "recurrence_exception",
      masterEventId: String(row.recurrence_master_event_id),
      originalOccurrence: structuredClone(row.original_occurrence) as CalendarOriginalOccurrence
    };
  } else {
    lineage = { kind: lineageKind as "standalone" | "recurrence_master" };
  }
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    calendarId: String(row.calendar_id),
    currentRevisionId: String(row.current_revision_id),
    lineage,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: nullableIso(row.deleted_at)
  };
}

function mapCalendarEventTombstone(row: Record<string, unknown>): CalendarEventTombstoneRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    calendarId: String(row.calendar_id),
    eventId: String(row.event_id),
    lastRevisionId: String(row.last_revision_id),
    lineage: structuredClone(row.lineage) as CalendarEventLineage,
    deletedAt: toIso(row.deleted_at)
  };
}

async function loadPostgresCalendarEventRevision(
  queryable: Queryable,
  row: Record<string, unknown>
): Promise<CalendarEventRevisionRecord> {
  const linkResult = await queryable.query(
    `SELECT link.* FROM calendar_event_subject_links link
     WHERE link.event_revision_id=$1 AND link.owner_id=$2
     ORDER BY link.position`,
    [String(row.id), String(row.owner_id)]
  );
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    eventId: String(row.event_id),
    revisionNumber: Number(row.revision_number),
    title: String(row.title),
    description: String(row.description),
    location: String(row.location),
    status: String(row.status) as CalendarEventRevisionRecord["status"],
    span: structuredClone(row.span) as CalendarEventRevisionRecord["span"],
    recurrence: row.recurrence === null ? null : structuredClone(row.recurrence) as CalendarEventRevisionRecord["recurrence"],
    subjectLinks: linkResult.rows.map(mapCalendarSubjectLink),
    createdAt: toIso(row.created_at)
  };
}

function mapCalendarSubjectLink(row: Record<string, unknown>): CalendarSubjectLink {
  const kind = String(row.subject_type);
  if (kind === "life_link") return { kind: "life_link", lifeLinkId: String(row.subject_id) };
  if (kind === "collection") return { kind: "collection", collectionId: String(row.subject_id) };
  const routineId = String(row.routine_id);
  if (kind === "routine") return { kind: "routine", routineId };
  if (kind === "routine_schedule") return { kind: "routine_schedule", routineId, scheduleId: String(row.subject_id) };
  if (kind === "routine_occurrence") {
    return {
      kind: "routine_occurrence",
      routineId,
      scheduleId: String(row.schedule_id),
      occurrenceId: String(row.subject_id)
    };
  }
  return { kind: "routine_session", routineId, sessionId: String(row.subject_id) };
}

async function loadPostgresCalendarEventDetail(queryable: Queryable, event: CalendarEventRecord): Promise<CalendarEventDetail> {
  const result = await queryable.query(
    "SELECT * FROM calendar_event_revisions WHERE id=$1 AND owner_id=$2 AND event_id=$3",
    [event.currentRevisionId, event.ownerId, event.id]
  );
  if (!result.rows[0]) {
    throw new CalendarDomainError("calendar_reference_conflict", "Calendar event current revision is unavailable.", {
      reason: "current_revision_not_found"
    });
  }
  return { event, currentRevision: await loadPostgresCalendarEventRevision(queryable, result.rows[0]) };
}

async function insertPostgresCalendar(client: PoolClient, calendar: CalendarRecord): Promise<void> {
  await client.query(
    `INSERT INTO calendars(id,owner_id,title,color,time_zone,source,is_default,created_at,updated_at,deleted_at,agent_access)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [calendar.id, calendar.ownerId, calendar.title, calendar.color, calendar.timeZone, calendar.source,
      calendar.isDefault, calendar.createdAt, calendar.updatedAt, calendar.deletedAt, calendar.agentAccess]
  );
}

async function updatePostgresCalendar(client: PoolClient, calendar: CalendarRecord): Promise<void> {
  await client.query(
    `UPDATE calendars SET title=$3,color=$4,time_zone=$5,is_default=$6,updated_at=$7,deleted_at=$8,agent_access=$9
     WHERE id=$1 AND owner_id=$2`,
    [calendar.id, calendar.ownerId, calendar.title, calendar.color, calendar.timeZone,
      calendar.isDefault, calendar.updatedAt, calendar.deletedAt, calendar.agentAccess]
  );
}

async function clearPostgresDefaultCalendars(
  client: PoolClient,
  ownerId: string,
  calendarId: string,
  changedAt: string
): Promise<void> {
  await client.query(
    `UPDATE calendars SET is_default=false,
       updated_at=GREATEST(updated_at + interval '1 millisecond',$3::timestamptz)
     WHERE owner_id=$1 AND id<>$2 AND is_default AND deleted_at IS NULL`,
    [ownerId, calendarId, changedAt]
  );
}

async function insertPostgresCalendarEvent(client: PoolClient, event: CalendarEventRecord): Promise<void> {
  await client.query(
    `INSERT INTO calendar_events(
       id,owner_id,calendar_id,current_revision_id,lineage_kind,recurrence_master_event_id,
       original_occurrence,created_at,updated_at,deleted_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
    [event.id, event.ownerId, event.calendarId, event.currentRevisionId, event.lineage.kind,
      event.lineage.kind === "recurrence_exception" ? event.lineage.masterEventId : null,
      event.lineage.kind === "recurrence_exception" ? JSON.stringify(event.lineage.originalOccurrence) : null,
      event.createdAt, event.updatedAt, event.deletedAt]
  );
}

async function insertPostgresCalendarEventRevision(
  client: PoolClient,
  revision: CalendarEventRevisionRecord
): Promise<void> {
  await client.query(
    `INSERT INTO calendar_event_revisions(
       id,owner_id,event_id,revision_number,title,description,location,status,span,recurrence,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [revision.id, revision.ownerId, revision.eventId, revision.revisionNumber, revision.title,
      revision.description, revision.location, revision.status, JSON.stringify(revision.span),
      revision.recurrence === null ? null : JSON.stringify(revision.recurrence), revision.createdAt]
  );
  for (const [position, link] of revision.subjectLinks.entries()) {
    const stored = calendarSubjectStorage(link);
    await client.query(
      `INSERT INTO calendar_event_subject_links(
         owner_id,event_revision_id,subject_type,routine_id,schedule_id,subject_id,position
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [revision.ownerId, revision.id, stored.subjectType, stored.routineId, stored.scheduleId, stored.subjectId, position]
    );
  }
}

function calendarSubjectStorage(link: CalendarSubjectLink): {
  subjectType: CalendarSubjectLink["kind"];
  routineId: string | null;
  scheduleId: string | null;
  subjectId: string;
} {
  if (link.kind === "life_link") return { subjectType: link.kind, routineId: null, scheduleId: null, subjectId: link.lifeLinkId };
  if (link.kind === "collection") return { subjectType: link.kind, routineId: null, scheduleId: null, subjectId: link.collectionId };
  if (link.kind === "routine") return { subjectType: link.kind, routineId: link.routineId, scheduleId: null, subjectId: link.routineId };
  if (link.kind === "routine_schedule") return { subjectType: link.kind, routineId: link.routineId, scheduleId: null, subjectId: link.scheduleId };
  if (link.kind === "routine_occurrence") {
    return { subjectType: link.kind, routineId: link.routineId, scheduleId: link.scheduleId, subjectId: link.occurrenceId };
  }
  return { subjectType: link.kind, routineId: link.routineId, scheduleId: null, subjectId: link.sessionId };
}

async function insertPostgresCalendarEventTombstone(
  client: PoolClient,
  tombstone: CalendarEventTombstoneRecord
): Promise<void> {
  await client.query(
    `INSERT INTO calendar_event_tombstones(id,owner_id,calendar_id,event_id,last_revision_id,lineage,deleted_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [tombstone.id, tombstone.ownerId, tombstone.calendarId, tombstone.eventId,
      tombstone.lastRevisionId, JSON.stringify(tombstone.lineage), tombstone.deletedAt]
  );
}

async function assertPostgresCalendarEventReferences(
  client: PoolClient,
  event: CalendarEventRecord,
  revision: CalendarEventRevisionRecord
): Promise<void> {
  const calendarResult = await client.query(
    "SELECT * FROM calendars WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
    [event.calendarId, event.ownerId]
  );
  if (!calendarResult.rowCount) {
    throw new CalendarDomainError("calendar_reference_conflict", "Calendar event Calendar is unavailable.", {
      reason: "calendar_unavailable"
    });
  }
  assertNativeCalendarWriteAuthority(mapCalendar(calendarResult.rows[0]));
  if (event.lineage.kind === "recurrence_exception") {
    const masterResult = await client.query(
      `SELECT revision.* FROM calendar_events event
       JOIN calendar_event_revisions revision
         ON revision.id=event.current_revision_id AND revision.event_id=event.id AND revision.owner_id=event.owner_id
       WHERE event.id=$1 AND event.owner_id=$2 AND event.calendar_id=$3
         AND event.lineage_kind='recurrence_master' AND event.deleted_at IS NULL`,
      [event.lineage.masterEventId, event.ownerId, event.calendarId]
    );
    if (!masterResult.rows[0]) {
      throw new CalendarDomainError("calendar_reference_conflict", "Recurrence master is unavailable.", {
        reason: "recurrence_master_unavailable"
      });
    }
    const masterRevision = await loadPostgresCalendarEventRevision(client, masterResult.rows[0]);
    if (!calendarRecurrenceIncludesOriginalOccurrence(masterRevision, event.lineage.originalOccurrence)) {
      throw new CalendarDomainError(
        "calendar_reference_conflict",
        "Recurrence exception does not name an occurrence generated by its master.",
        { reason: "recurrence_exception_not_generated" }
      );
    }
    if ((await client.query(
      `SELECT 1 FROM calendar_events
       WHERE owner_id=$1 AND id<>$2 AND lineage_kind='recurrence_exception'
       AND recurrence_master_event_id=$3 AND original_occurrence=$4::jsonb
       LIMIT 1`,
      [event.ownerId, event.id, event.lineage.masterEventId, JSON.stringify(event.lineage.originalOccurrence)]
    )).rowCount) {
      throw new CalendarDomainError("calendar_conflict", "A recurrence exception already exists for this occurrence.", {
        reason: "duplicate_recurrence_exception"
      });
    }
  }
  for (const link of revision.subjectLinks) {
    const stored = calendarSubjectStorage(link);
    let query: string;
    let values: unknown[];
    if (link.kind === "life_link") {
      query = "SELECT 1 FROM life_links WHERE id=$1 AND owner_id=$2";
      values = [link.lifeLinkId, event.ownerId];
    } else if (link.kind === "collection") {
      query = "SELECT 1 FROM collections WHERE id=$1 AND owner_id=$2";
      values = [link.collectionId, event.ownerId];
    } else if (link.kind === "routine") {
      query = "SELECT 1 FROM routines WHERE id=$1 AND owner_id=$2";
      values = [link.routineId, event.ownerId];
    } else if (link.kind === "routine_schedule") {
      query = "SELECT 1 FROM routine_schedules WHERE id=$1 AND routine_id=$2 AND owner_id=$3";
      values = [stored.subjectId, link.routineId, event.ownerId];
    } else if (link.kind === "routine_occurrence") {
      query = "SELECT 1 FROM routine_occurrences WHERE id=$1 AND schedule_id=$2 AND routine_id=$3 AND owner_id=$4";
      values = [stored.subjectId, link.scheduleId, link.routineId, event.ownerId];
    } else {
      query = "SELECT 1 FROM routine_sessions WHERE id=$1 AND routine_id=$2 AND owner_id=$3";
      values = [stored.subjectId, link.routineId, event.ownerId];
    }
    if (!(await client.query(query, values)).rowCount) {
      throw new CalendarDomainError("calendar_reference_conflict", "Calendar event subject is unavailable.", {
        reason: `${link.kind}_unavailable`
      });
    }
  }
}

function assertNativeCalendarWriteAuthority(calendar: CalendarRecord): void {
  if (calendar.source !== "native") {
    throw new CalendarDomainError(
      "calendar_conflict",
      "External Calendar changes must use the exact provider connection boundary.",
      { reason: "external_calendar_write_authority" }
    );
  }
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
       (SELECT count(*)::int FROM claim_events WHERE owner_id = $1) AS claim_events,
       (SELECT count(*)::int FROM routine_groups WHERE owner_id = $1) AS routine_groups,
       (SELECT count(*)::int FROM routine_activities WHERE owner_id = $1) AS routine_activities,
       (SELECT count(*)::int FROM routines WHERE owner_id = $1) AS routines,
       (SELECT count(*)::int FROM routine_revisions WHERE owner_id = $1) AS routine_revisions,
       (SELECT count(*)::int FROM routine_steps WHERE owner_id = $1) AS routine_steps,
       (SELECT count(*)::int FROM routine_context_bindings WHERE owner_id = $1) AS routine_context_bindings,
       (SELECT count(*)::int FROM routine_schedules WHERE owner_id = $1) AS routine_schedules,
       (SELECT count(*)::int FROM routine_occurrences WHERE owner_id = $1) AS routine_occurrences,
       (SELECT count(*)::int FROM routine_runs WHERE owner_id = $1) AS routine_runs,
       (SELECT count(*)::int FROM routine_sessions WHERE owner_id = $1) AS routine_sessions,
       (SELECT count(*)::int FROM routine_session_step_results WHERE owner_id = $1) AS routine_session_step_results,
       (SELECT count(*)::int FROM routine_session_amendments WHERE owner_id = $1) AS routine_session_amendments,
       (SELECT count(*)::int FROM calendars WHERE owner_id = $1) AS calendars,
       (SELECT count(*)::int FROM calendar_events WHERE owner_id = $1) AS calendar_events,
       (SELECT count(*)::int FROM calendar_event_revisions WHERE owner_id = $1) AS calendar_event_revisions,
       (SELECT count(*)::int FROM calendar_event_subject_links WHERE owner_id = $1) AS calendar_event_subject_links,
        (SELECT count(*)::int FROM calendar_event_tombstones WHERE owner_id = $1) AS calendar_event_tombstones,
        (SELECT count(*)::int FROM calendar_provider_connections WHERE owner_id = $1) AS calendar_provider_connections,
        (SELECT count(*)::int FROM calendar_provider_bindings WHERE owner_id = $1) AS calendar_provider_bindings,
        (SELECT count(*)::int FROM calendar_provider_sync_states WHERE owner_id = $1) AS calendar_provider_sync_states,
        (SELECT count(*)::int FROM calendar_provider_event_projections WHERE owner_id = $1) AS calendar_provider_event_projections,
        (SELECT count(*)::int FROM calendar_provider_event_projection_revisions WHERE owner_id = $1) AS calendar_provider_event_projection_revisions,
        (SELECT count(*)::int FROM calendar_provider_event_tombstones WHERE owner_id = $1) AS calendar_provider_event_tombstones,
        (SELECT count(*)::int FROM calendar_provider_event_tombstone_history WHERE owner_id = $1) AS calendar_provider_event_tombstone_history,
        (SELECT count(*)::int FROM calendar_provider_outbox WHERE owner_id = $1) AS calendar_provider_outbox,
        (SELECT count(*)::int FROM calendar_provider_webhook_hints WHERE owner_id = $1) AS calendar_provider_webhook_hints`,
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
    claimEvents: Number(row.claim_events),
    routineGroups: Number(row.routine_groups),
    routineActivities: Number(row.routine_activities),
    routines: Number(row.routines),
    routineRevisions: Number(row.routine_revisions),
    routineSteps: Number(row.routine_steps),
    routineContextBindings: Number(row.routine_context_bindings),
    routineSchedules: Number(row.routine_schedules),
    routineOccurrences: Number(row.routine_occurrences),
    routineRuns: Number(row.routine_runs),
    routineSessions: Number(row.routine_sessions),
    routineSessionStepResults: Number(row.routine_session_step_results),
    routineSessionAmendments: Number(row.routine_session_amendments),
    calendars: Number(row.calendars),
    calendarEvents: Number(row.calendar_events),
    calendarEventRevisions: Number(row.calendar_event_revisions),
    calendarEventSubjectLinks: Number(row.calendar_event_subject_links),
    calendarEventTombstones: Number(row.calendar_event_tombstones),
    calendarProviderConnections: Number(row.calendar_provider_connections),
    calendarProviderBindings: Number(row.calendar_provider_bindings),
    calendarProviderSyncStates: Number(row.calendar_provider_sync_states),
    calendarProviderEventProjections: Number(row.calendar_provider_event_projections),
    calendarProviderEventProjectionRevisions: Number(row.calendar_provider_event_projection_revisions),
    calendarProviderEventTombstones: Number(row.calendar_provider_event_tombstones),
    calendarProviderEventTombstoneHistory: Number(row.calendar_provider_event_tombstone_history),
    calendarProviderOutbox: Number(row.calendar_provider_outbox),
    calendarProviderWebhookHints: Number(row.calendar_provider_webhook_hints)
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
  await client.query("SET LOCAL life_links.allow_calendar_delete = 'on'");
  await client.query("DELETE FROM calendar_provider_webhook_hints WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_outbox WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_event_tombstone_history WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_event_tombstones WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_event_projection_revisions WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_event_projections WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_sync_states WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_bindings WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_connections WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_provider_secrets WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_event_tombstones WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_event_subject_links WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_event_revisions WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendar_events WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM calendars WHERE owner_id = $1", [ownerId]);
  await client.query("SET LOCAL life_links.allow_routine_delete = 'on'");
  await client.query("DELETE FROM routine_session_amendments WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_session_step_results WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_sessions WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_runs WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_occurrences WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_schedules WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_context_bindings WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_steps WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_revisions WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routines WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_activities WHERE owner_id = $1", [ownerId]);
  await client.query("DELETE FROM routine_groups WHERE owner_id = $1", [ownerId]);
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

function isCurrentRoutineLifeLinkBindingError(error: unknown): boolean {
  const value = error as { code?: unknown; constraint?: unknown };
  return value?.code === "23503" && value.constraint === "routine_current_life_link_binding";
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "23505";
}

function currentRoutineLifeLinkBindingError(): LifeLinkDomainError {
  return new LifeLinkDomainError("routine_reference_conflict", "A current Routine revision still references this Life Link.");
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

async function assertActivePostgresRoutineGroup(queryable: Queryable, ownerId: string, groupId: string): Promise<void> {
  const result=await queryable.query("SELECT 1 FROM routine_groups WHERE id=$1 AND owner_id=$2 AND archived_at IS NULL",[groupId,ownerId]);
  if(!result.rowCount)throw new LifeLinkDomainError("routine_reference_conflict","Routine Group was not found or is archived.");
}

async function assertPostgresRoutineGroupExists(queryable: Queryable, ownerId: string, groupId: string): Promise<void> {
  const result=await queryable.query("SELECT 1 FROM routine_groups WHERE id=$1 AND owner_id=$2",[groupId,ownerId]);
  if(!result.rowCount)throw new LifeLinkDomainError("routine_reference_conflict","Routine Group was not found for this owner.");
}

async function loadPostgresRoutineScheduleIdsUsingActivity(queryable: Queryable, ownerId: string, activityId: string): Promise<string[]> {
  const result=await queryable.query(`SELECT DISTINCT schedule.id FROM routine_schedules schedule JOIN routine_steps step
    ON step.owner_id=schedule.owner_id AND step.routine_revision_id=schedule.routine_revision_id
    WHERE schedule.owner_id=$1 AND schedule.active=true AND step.activity_id=$2`,[ownerId,activityId]);
  return result.rows.map((row)=>String(row.id));
}

async function deactivatePostgresRoutineSchedules(
  queryable: Queryable, ownerId: string, routineIds: string[], changedAt: string
): Promise<void> {
  if(routineIds.length===0)return;
  const result=await queryable.query(`SELECT id FROM routine_schedules WHERE owner_id=$1
    AND routine_id=ANY($2::text[]) AND active=true`,[ownerId,routineIds]);
  await deactivatePostgresRoutineSchedulesById(queryable,ownerId,result.rows.map((row)=>String(row.id)),changedAt);
}

async function deactivatePostgresRoutineSchedulesById(
  queryable: Queryable, ownerId: string, scheduleIds: string[], changedAt: string
): Promise<void> {
  if(scheduleIds.length===0)return;
  const result=await queryable.query(`SELECT * FROM routine_schedules WHERE owner_id=$1
    AND id=ANY($2::text[]) AND active=true FOR UPDATE`,[ownerId,scheduleIds]);
  for(const row of result.rows){
    const schedule=mapRoutineSchedule(row);
    const updatedAt=monotonicRoutineTimestamp(schedule.updatedAt,changedAt);
    await queryable.query("UPDATE routine_schedules SET active=false,revision=revision+1,updated_at=$3 WHERE id=$1 AND owner_id=$2",
      [schedule.id,ownerId,updatedAt]);
    await queryable.query(`UPDATE routine_occurrences SET status='canceled',updated_at=$3 WHERE schedule_id=$1 AND owner_id=$2
      AND status='planned' AND planned_for>$3`,[schedule.id,ownerId,updatedAt]);
  }
}

async function assertPostgresRoutineDefinitionReferences(
  queryable: Queryable, ownerId: string, groupId: string|null, snapshot: RoutineRevisionSnapshot, requireActiveGroup = true
): Promise<void> {
  if(groupId){
    const result=await queryable.query(`SELECT 1 FROM routine_groups WHERE id=$1 AND owner_id=$2
      ${requireActiveGroup?"AND archived_at IS NULL":""}`,[groupId,ownerId]);
    if(!result.rowCount)throw new LifeLinkDomainError("routine_reference_conflict","Routine Group was not found for this owner or is unavailable for assignment.");
  }
  for(const step of snapshot.steps){
    const result=await queryable.query("SELECT title FROM routine_activities WHERE id=$1 AND owner_id=$2 AND archived_at IS NULL",[step.activityId,ownerId]);
    if(!result.rows[0]||String(result.rows[0].title)!==step.activityTitle)throw new LifeLinkDomainError("routine_reference_conflict","Routine Step Activity was not found, changed title, or is archived.");
  }
  for(const binding of snapshot.bindings){
    const table=binding.targetType==="life_link"?"life_links":"collections";
    const result=await queryable.query(`SELECT 1 FROM ${table} WHERE id=$1 AND owner_id=$2`,[binding.targetId,ownerId]);
    if(!result.rowCount)throw new LifeLinkDomainError("routine_reference_conflict","Routine context target was not found for this owner.");
  }
}

async function assertPostgresRoutineHasNoArchivedActivities(queryable: Queryable, ownerId: string, revisionId: string): Promise<void> {
  const result=await queryable.query(`SELECT 1 FROM routine_steps step JOIN routine_activities activity
    ON activity.id=step.activity_id AND activity.owner_id=step.owner_id
    WHERE step.owner_id=$1 AND step.routine_revision_id=$2 AND activity.archived_at IS NOT NULL LIMIT 1`,[ownerId,revisionId]);
  if(result.rowCount)throw new LifeLinkDomainError("routine_conflict","A Routine Activity is archived.");
}

async function assertPostgresRoutineScheduleReferences(queryable: Queryable,schedule: RoutineScheduleRecord): Promise<void>{
  const result=await queryable.query("SELECT * FROM routines WHERE id=$1 AND owner_id=$2",[schedule.routineId,schedule.ownerId]);
  if(!result.rows[0])throw new LifeLinkDomainError("routine_reference_conflict","Routine Schedule owner was not found.");
  const routine=mapRoutine(result.rows[0]);
  if(routine.archivedAt||routine.currentRevisionId!==schedule.routineRevisionId)throw new LifeLinkDomainError("routine_reference_conflict","Routine Schedule must use the active current Routine revision.");
  await assertPostgresRoutineHasNoArchivedActivities(queryable,schedule.ownerId,schedule.routineRevisionId);
}

async function persistPostgresRoutineCreation(queryable: Queryable,candidate: CanonicalRoutineCreation,insertRoutine: boolean): Promise<void>{
  const {routine,currentRevision}=candidate;
  if(insertRoutine)await queryable.query(`INSERT INTO routines(id,owner_id,group_id,current_revision_id,created_at,updated_at,archived_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[routine.id,routine.ownerId,routine.groupId,routine.currentRevisionId,routine.createdAt,routine.updatedAt,routine.archivedAt]);
  await queryable.query(`INSERT INTO routine_revisions(id,owner_id,routine_id,revision_number,title,purpose,instructions,created_at,ordering)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[currentRevision.revision.id,currentRevision.revision.ownerId,currentRevision.revision.routineId,currentRevision.revision.revisionNumber,
    currentRevision.revision.title,currentRevision.revision.purpose,currentRevision.revision.instructions,currentRevision.revision.createdAt,currentRevision.revision.ordering]);
  for(const step of currentRevision.steps)await queryable.query(`INSERT INTO routine_steps
    (id,owner_id,routine_revision_id,activity_id,activity_title,position,instructions,optional,planned_values)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[step.id,step.ownerId,step.routineRevisionId,step.activityId,step.activityTitle,step.position,step.instructions,step.optional,JSON.stringify(step.plannedValues)]);
  for(const binding of currentRevision.bindings)await queryable.query(`INSERT INTO routine_context_bindings
    (id,owner_id,routine_revision_id,routine_step_id,target_type,target_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [binding.id,binding.ownerId,binding.routineRevisionId,binding.routineStepId,binding.targetType,binding.targetId]);
  if(!insertRoutine)await queryable.query("UPDATE routines SET current_revision_id=$3,updated_at=$4 WHERE id=$1 AND owner_id=$2",
    [routine.id,routine.ownerId,routine.currentRevisionId,routine.updatedAt]);
}

async function loadPostgresRoutineRevision(queryable: Queryable,ownerId: string,routineId: string,revisionId: string): Promise<RoutineRevisionSnapshot|null>{
  const revisionResult=await queryable.query("SELECT * FROM routine_revisions WHERE id=$1 AND routine_id=$2 AND owner_id=$3",[revisionId,routineId,ownerId]);
  if(!revisionResult.rows[0])return null;
  const steps=await queryable.query("SELECT * FROM routine_steps WHERE routine_revision_id=$1 AND owner_id=$2 ORDER BY position,id",[revisionId,ownerId]);
  const bindings=await queryable.query("SELECT * FROM routine_context_bindings WHERE routine_revision_id=$1 AND owner_id=$2 ORDER BY routine_step_id NULLS FIRST,target_type,target_id,id",[revisionId,ownerId]);
  return {revision:mapRoutineRevision(revisionResult.rows[0]),steps:steps.rows.map(mapRoutineStep),bindings:bindings.rows.map(mapRoutineBinding)};
}

async function insertPostgresRoutineSchedule(queryable: Queryable,schedule: RoutineScheduleRecord): Promise<void>{
  await queryable.query(`INSERT INTO routine_schedules(id,owner_id,routine_id,routine_revision_id,rule,revision,active,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,[schedule.id,schedule.ownerId,schedule.routineId,schedule.routineRevisionId,JSON.stringify(schedule.rule),schedule.revision,schedule.active,schedule.createdAt,schedule.updatedAt]);
}

async function buildPostgresRoutineContextSnapshot(queryable: Queryable,ownerId: string,revision: RoutineRevisionSnapshot): Promise<RoutineContextSnapshot[]>{
  const result: RoutineContextSnapshot[]=[];
  for(const binding of revision.bindings){
    if(binding.targetType==="life_link"){
      const targetResult=await queryable.query("SELECT id,title,updated_at FROM life_links WHERE id=$1 AND owner_id=$2",[binding.targetId,ownerId]);
      if(!targetResult.rows[0])throw new LifeLinkDomainError("routine_reference_conflict","Routine Life Link context no longer exists.");
      const target=targetResult.rows[0];
      result.push({bindingId:binding.id,routineStepId:binding.routineStepId,targetType:binding.targetType,targetId:String(target.id),targetTitle:String(target.title),
        targetSourceUpdatedAt:toIso(target.updated_at),resolvedLifeLinks:[{lifeLinkId:String(target.id),title:String(target.title),sourceUpdatedAt:toIso(target.updated_at)}]});
    }else{
      const targetResult=await queryable.query("SELECT id,title,updated_at FROM collections WHERE id=$1 AND owner_id=$2",[binding.targetId,ownerId]);
      if(!targetResult.rows[0])throw new LifeLinkDomainError("routine_reference_conflict","Routine Collection context no longer exists.");
      const members=await queryable.query(`SELECT link.id,link.title,link.updated_at FROM collection_memberships membership
        JOIN life_links link ON link.id=membership.life_link_id AND link.owner_id=membership.owner_id
        WHERE membership.owner_id=$1 AND membership.collection_id=$2 ORDER BY lower(link.title),link.id`,[ownerId,binding.targetId]);
      const target=targetResult.rows[0];
      result.push({bindingId:binding.id,routineStepId:binding.routineStepId,targetType:binding.targetType,targetId:String(target.id),targetTitle:String(target.title),
        targetSourceUpdatedAt:toIso(target.updated_at),resolvedLifeLinks:members.rows.map(row=>({lifeLinkId:String(row.id),title:String(row.title),sourceUpdatedAt:toIso(row.updated_at)}))});
    }
  }
  return result;
}

async function insertPostgresRoutineRun(queryable: Queryable,run: RoutineRunRecord): Promise<void>{
  await queryable.query(`INSERT INTO routine_runs(id,owner_id,routine_id,routine_revision_id,occurrence_id,status,context_snapshot,step_results,started_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,[run.id,run.ownerId,run.routineId,run.routineRevisionId,run.occurrenceId,run.status,JSON.stringify(run.contextSnapshot),JSON.stringify(run.stepResults),run.startedAt,run.updatedAt]);
}

async function insertPostgresRoutineSession(queryable: Queryable,built: BuiltRoutineSession): Promise<void>{
  const session=built.session;
  await queryable.query(`INSERT INTO routine_sessions(id,owner_id,routine_id,routine_revision_id,run_id,occurrence_id,context_snapshot,started_at,completed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,[session.id,session.ownerId,session.routineId,session.routineRevisionId,session.runId,session.occurrenceId,JSON.stringify(session.contextSnapshot),session.startedAt,session.completedAt]);
  for(const result of built.stepResults)await queryable.query(`INSERT INTO routine_session_step_results
    (id,owner_id,session_id,routine_revision_id,routine_step_id,actual_values,proposed_next_values,notes)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,[result.id,result.ownerId,result.sessionId,session.routineRevisionId,result.routineStepId,JSON.stringify(result.actualValues),JSON.stringify(result.proposedNextValues),result.notes]);
}

async function loadPostgresBuiltRoutineSession(queryable: Queryable,session: RoutineSessionRecord): Promise<BuiltRoutineSession>{
  const runResult=await queryable.query("SELECT * FROM routine_runs WHERE id=$1 AND owner_id=$2",[session.runId,session.ownerId]);
  const resultRows=await queryable.query("SELECT * FROM routine_session_step_results WHERE session_id=$1 AND owner_id=$2 ORDER BY routine_step_id",[session.id,session.ownerId]);
  return {finalizedRun:mapRoutineRun(runResult.rows[0]),session,stepResults:resultRows.rows.map(mapRoutineSessionStepResult)};
}

function mapRoutineGroup(row: Record<string,unknown>): RoutineGroupRecord{return {id:String(row.id),ownerId:String(row.owner_id),title:String(row.title),notes:String(row.notes),createdAt:toIso(row.created_at),updatedAt:toIso(row.updated_at),archivedAt:nullableIso(row.archived_at)};}
function mapRoutineActivity(row: Record<string,unknown>): ActivityRecord{return {id:String(row.id),ownerId:String(row.owner_id),title:String(row.title),notes:String(row.notes),createdAt:toIso(row.created_at),updatedAt:toIso(row.updated_at),archivedAt:nullableIso(row.archived_at)};}
function mapRoutine(row: Record<string,unknown>): RoutineRecord{return {id:String(row.id),ownerId:String(row.owner_id),groupId:nullableString(row.group_id),currentRevisionId:String(row.current_revision_id),createdAt:toIso(row.created_at),updatedAt:toIso(row.updated_at),archivedAt:nullableIso(row.archived_at)};}
function mapRoutineSummary(row: Record<string,unknown>): RoutineSummaryRecord{return {...mapRoutine(row),revisionNumber:Number(row.revision_number),title:String(row.title),purpose:String(row.purpose)};}
function mapRoutineRevision(row: Record<string,unknown>): RoutineRevisionRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineId:String(row.routine_id),revisionNumber:Number(row.revision_number),title:String(row.title),purpose:String(row.purpose),instructions:String(row.instructions),ordering:normalizeRoutineOrdering(String(row.ordering)),createdAt:toIso(row.created_at)};}
function mapRoutineStep(row: Record<string,unknown>): RoutineStepRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineRevisionId:String(row.routine_revision_id),activityId:String(row.activity_id),activityTitle:String(row.activity_title),position:Number(row.position),instructions:String(row.instructions),optional:Boolean(row.optional),plannedValues:row.planned_values as RoutineStepRecord["plannedValues"]};}
function mapRoutineBinding(row: Record<string,unknown>): RoutineContextBindingRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineRevisionId:String(row.routine_revision_id),routineStepId:nullableString(row.routine_step_id),targetType:row.target_type as RoutineContextBindingRecord["targetType"],targetId:String(row.target_id)};}
function mapRoutineSchedule(row: Record<string,unknown>): RoutineScheduleRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineId:String(row.routine_id),routineRevisionId:String(row.routine_revision_id),rule:row.rule as RoutineScheduleRecord["rule"],revision:Number(row.revision),active:Boolean(row.active),createdAt:toIso(row.created_at),updatedAt:toIso(row.updated_at)};}
function mapRoutineOccurrence(row: Record<string,unknown>): RoutineOccurrenceRecord{return {id:String(row.id),ownerId:String(row.owner_id),scheduleId:String(row.schedule_id),scheduleRevision:Number(row.schedule_revision),routineId:String(row.routine_id),routineRevisionId:String(row.routine_revision_id),localDate:toDateOnly(row.local_date),plannedFor:toIso(row.planned_for),status:row.status as RoutineOccurrenceRecord["status"],createdAt:toIso(row.created_at),updatedAt:toIso(row.updated_at)};}
function mapRoutineRun(row: Record<string,unknown>): RoutineRunRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineId:String(row.routine_id),routineRevisionId:String(row.routine_revision_id),occurrenceId:nullableString(row.occurrence_id),status:row.status as RoutineRunRecord["status"],contextSnapshot:row.context_snapshot as RoutineContextSnapshot[],stepResults:row.step_results as RoutineRunRecord["stepResults"],startedAt:toIso(row.started_at),updatedAt:toIso(row.updated_at)};}
function mapRoutineSession(row: Record<string,unknown>): RoutineSessionRecord{return {id:String(row.id),ownerId:String(row.owner_id),routineId:String(row.routine_id),routineRevisionId:String(row.routine_revision_id),runId:String(row.run_id),occurrenceId:nullableString(row.occurrence_id),contextSnapshot:row.context_snapshot as RoutineContextSnapshot[],startedAt:toIso(row.started_at),completedAt:toIso(row.completed_at)};}
function mapRoutineSessionStepResult(row: Record<string,unknown>): RoutineSessionStepResultRecord{return {id:String(row.id),ownerId:String(row.owner_id),sessionId:String(row.session_id),routineStepId:String(row.routine_step_id),actualValues:row.actual_values as RoutineSessionStepResultRecord["actualValues"],proposedNextValues:row.proposed_next_values as RoutineSessionStepResultRecord["proposedNextValues"],notes:String(row.notes)};}
function mapRoutineSessionAmendment(row: Record<string,unknown>): RoutineSessionAmendmentRecord{return {id:String(row.id),ownerId:String(row.owner_id),sessionId:String(row.session_id),stepResultId:nullableString(row.step_result_id),note:String(row.note),correctedActualValues:row.corrected_actual_values as RoutineSessionAmendmentRecord["correctedActualValues"],correctedProposedNextValues:row.corrected_proposed_next_values as RoutineSessionAmendmentRecord["correctedProposedNextValues"],createdAt:toIso(row.created_at)};}

function sameRoutinePayload(left: unknown,right: unknown): boolean{return isDeepStrictEqual(left,right);}
function sameRoutineCreatePayload(left: unknown,right: unknown): boolean{return isDeepStrictEqual(withoutRoutineServerTimes(left),withoutRoutineServerTimes(right));}
function withoutRoutineServerTimes(value: unknown): unknown{
  if(Array.isArray(value))return value.map(withoutRoutineServerTimes);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!["createdAt","updatedAt","startedAt","completedAt"].includes(key))
    .map(([key,item])=>[key,withoutRoutineServerTimes(item)]));
}
function routineIdConflict(): never{throw new LifeLinkDomainError("routine_conflict","Routine identity is already bound to another request.");}
function assertRoutineUpdatedAt(actual: string,expected: string): void{if(actual!==expected)throw new LifeLinkDomainError("stale_routine","Routine state changed after it was read.",{retryable:true});}
function stableRoutineSessionResultId(sessionId: string,routineStepId: string): string{
  const hex=createHash("sha256").update(`${sessionId}\u0000${routineStepId}`).digest("hex").slice(0,32).split("");hex[12]="4";hex[16]=((Number.parseInt(hex[16],16)&3)|8).toString(16);
  return `routine-session-result-${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
function compareRoutineTitledRows(left:{id:string;title:string},right:{id:string;title:string}):number{return left.title.normalize("NFKC").toLowerCase().localeCompare(right.title.normalize("NFKC").toLowerCase())||left.id.localeCompare(right.id);}
function compareRoutineOccurrenceOrder(left:RoutineOccurrenceRecord,right:RoutineOccurrenceRecord):number{return left.plannedFor.localeCompare(right.plannedFor)||left.id.localeCompare(right.id);}
function toDateOnly(value:unknown):string{return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}

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
    agentToolCatalogId: row.agent_tool_catalog_id === null ? null : String(row.agent_tool_catalog_id) as AgentToolCatalogId,
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

function monotonicRoutineTimestamp(previous: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(previous) ? candidate : new Date(Date.parse(previous) + 1).toISOString();
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
