import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import {
  type ClaimQrCommand,
  type ClaimResult,
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
  type LinkMediaRecord,
  type LinkRecord,
  type MoveLifeLinkCommand,
  type ProjectRecord,
  type QrInventoryRecord,
  type QrViewState,
  type UpdateLifeLinkCommand,
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
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  deriveLifeLinkPath,
  deriveProjectCompatibilityId,
  generateQrIds,
  mapLegacyLinkToLifeLinkId,
  normalizeBatchCount,
  normalizeLinkBodyDoc,
  pageLifeLinkChildren,
  projectLifeLinkAsLink,
  projectLifeLinkAsProject,
  projectUnclaimedQrAsLink,
  searchCanonicalLifeLinks
} from "@life-links/core";

import { hashPassword } from "./password.js";
import {
  ClaimIdempotencyConflictError,
  type BatchCreateResult,
  type ClaimOutcome,
  type LifeLinkMediaFile,
  type LifeLinksStore,
  type LinkMediaFile,
  type LinkMediaInput,
  type LinkPatch,
  type SessionRecord,
  type StoredUser
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
      `SELECT s.*, u.id AS user_id_value, u.email, u.display_name, u.password_hash, u.created_at AS user_created_at
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
      const existingResult = await client.query("SELECT * FROM life_links WHERE id = $1 FOR UPDATE", [candidate.id]);
      if (existingResult.rows[0]) {
        const existing = mapStoredLifeLink(existingResult.rows[0]);
        if (!sameStoredLifeLink(existing, candidate)) {
          throw new LifeLinkDomainError("duplicate_life_link_id", "Life Link identity is already bound to another record.");
        }
        await client.query("COMMIT");
      } else {
        const ownerLifeLinks = await this.loadOwnerLifeLinks(client, command.ownerId);
        assertValidLifeLinkParentPlacement([...ownerLifeLinks, candidate], candidate.id, candidate.parentId);
        await insertLifeLink(client, withoutRelations(candidate));
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
      assertLifeLinkBodyPatchIsCoordinated(command.patch);
      const coordinated =
        command.patch.body === undefined && command.patch.bodyDoc === undefined
          ? { body: current.body, bodyDoc: current.bodyDoc, bodyDocVersion: current.bodyDocVersion }
          : coordinateLifeLinkBody({
              body: command.patch.body,
              bodyDoc: command.patch.bodyDoc,
              bodyDocVersion: command.patch.bodyDocVersion
            });
      const title = command.patch.title ?? current.title;
      assertLifeLinkContentWithinBounds(title, coordinated.body, coordinated.bodyDoc);
      if (title.length > MAX_PROJECT_NAME_LENGTH) {
        const marker = await client.query("SELECT 1 FROM life_link_project_compat WHERE life_link_id = $1", [current.id]);
        if (marker.rowCount) {
          throw new LifeLinkDomainError("invalid_life_link", "Project compatibility title exceeds the supported limit.", {
            reason: "project_title_too_long"
          });
        }
      }
      await client.query(
        `UPDATE life_links
         SET title = $3, body = $4, body_doc = $5::jsonb, body_doc_version = $6, privacy = $7, updated_at = $8
         WHERE id = $1 AND owner_id = $2`,
        [
          current.id,
          userId,
          title,
          coordinated.body,
          JSON.stringify(coordinated.bodyDoc),
          coordinated.bodyDocVersion,
          command.patch.privacy ?? current.privacy,
          nextTimestamp(current.updatedAt)
        ]
      );
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
      const result = await client.query("SELECT * FROM life_links WHERE id = $1 AND owner_id = $2 FOR UPDATE", [
        command.lifeLinkId,
        userId
      ]);
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const current = mapStoredLifeLink(result.rows[0]);
      assertFresh(current, command.expectedUpdatedAt);
      if (command.parentId !== null) {
        const marker = await client.query("SELECT 1 FROM life_link_project_compat WHERE life_link_id = $1", [current.id]);
        if (marker.rowCount) {
          throw new LifeLinkDomainError("invalid_parent", "Project-compatible Life Link must remain a root.", {
            reason: "project_compatibility_root"
          });
        }
      }
      const ownerLifeLinks = await this.loadOwnerLifeLinks(client, userId);
      assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, command.parentId);
      await client.query("UPDATE life_links SET parent_id = $3, updated_at = $4 WHERE id = $1 AND owner_id = $2", [
        current.id,
        userId,
        command.parentId,
        nextTimestamp(current.updatedAt)
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.loadLifeLink(this.pool, command.lifeLinkId);
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
    const result = await this.pool.query(
      "DELETE FROM link_media WHERE id = $1 AND life_link_id = $2 AND owner_id = $3 RETURNING id",
      [mediaId, lifeLinkId, userId]
    );
    return Boolean(result.rowCount);
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
    const markers = await this.loadProjectCompatibility(this.pool);
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
        return projectLifeLinkAsLink(lifeLink, qr, deriveProjectCompatibilityId(lifeLinks, markers, lifeLink.id));
      });
    const unclaimed = await this.pool.query(
      `SELECT q.*
       FROM qr_codes q
       JOIN export_batches eb ON eb.id = q.batch_id
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE eb.created_by = $1 AND b.qr_id IS NULL`,
      [userId]
    );
    return [...claimed, ...unclaimed.rows.map((row) => projectUnclaimedQrAsLink(mapQrInventory(row)))].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query(
      `SELECT c.project_id, c.life_link_id, ll.*
       FROM life_link_project_compat c
       JOIN life_links ll ON ll.id = c.life_link_id
       WHERE ll.owner_id = $1
       ORDER BY ll.title ASC`,
      [userId]
    );
    return result.rows.map((row) =>
      projectLifeLinkAsProject(hydrateWithoutRelations(mapStoredLifeLink(row)), {
        projectId: String(row.project_id),
        lifeLinkId: String(row.life_link_id)
      })
    );
  }

  async createProject(userId: string, name: string): Promise<ProjectRecord> {
    if (name.length > MAX_PROJECT_NAME_LENGTH) {
      throw new LifeLinkDomainError("invalid_life_link", "Project compatibility title exceeds the supported limit.", {
        reason: "project_title_too_long"
      });
    }
    const id = `project-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const candidate = createCanonicalLifeLink({ id, ownerId: userId, title: name, body: "", privacy: "private", createdAt });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      await insertLifeLink(client, withoutRelations(candidate));
      await client.query("INSERT INTO life_link_project_compat (project_id, life_link_id) VALUES ($1, $2)", [id, id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return projectLifeLinkAsProject(candidate, { projectId: id, lifeLinkId: id });
  }

  async createQrBatch(userId: string, count: number, qrBaseUrl: string): Promise<BatchCreateResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
        qrCodes: ids.map((id) => projectUnclaimedQrAsLink({ id, url: buildQrUrl(qrBaseUrl, id), batchId: batch.id, createdAt: now }))
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
      `SELECT q.*, b.life_link_id
       FROM qr_codes q
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE q.batch_id = $1
       ORDER BY q.id ASC`,
      [batchId]
    );
    const projected: LinkRecord[] = [];
    for (const row of qrResult.rows) {
      const qr = mapQrInventory(row);
      if (!row.life_link_id) {
        projected.push(projectUnclaimedQrAsLink(qr));
        continue;
      }
      const lifeLink = await this.loadLifeLink(this.pool, String(row.life_link_id));
      if (!lifeLink) {
        throw new LifeLinkDomainError("invalid_life_link", "QR binding references missing Life Link.");
      }
      const ownerLifeLinks = await this.loadOwnerLifeLinks(this.pool, lifeLink.ownerId);
      const markers = await this.loadProjectCompatibility(this.pool);
      projected.push(projectLifeLinkAsLink(lifeLink, qr, deriveProjectCompatibilityId(ownerLifeLinks, markers, lifeLink.id)));
    }
    return projected;
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const result = await this.pool.query(
      `SELECT q.*, b.life_link_id
       FROM qr_codes q
       LEFT JOIN life_link_qr_bindings b ON b.qr_id = q.id
       WHERE q.id = $1`,
      [qrId]
    );
    const row = result.rows[0];
    if (!row) {
      return { state: "not_found", qrId };
    }
    const qr = mapQrInventory(row);
    if (!row.life_link_id) {
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
    const ownerLifeLinks = await this.loadOwnerLifeLinks(this.pool, lifeLink.ownerId);
    const markers = await this.loadProjectCompatibility(this.pool);
    const projected = projectLifeLinkAsLink(
      lifeLink,
      qr,
      deriveProjectCompatibilityId(ownerLifeLinks, markers, lifeLink.id)
    );
    return {
      state: "claimed",
      link: viewerIsOwner ? projected : { ...projected, projectId: null },
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
          const bindingResult = await client.query(
            `SELECT b.*, ll.owner_id
             FROM life_link_qr_bindings b
             JOIN life_links ll ON ll.id = b.life_link_id
             WHERE b.qr_id = $1
             FOR UPDATE OF b, ll`,
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { result, state: await this.getQrState(qrId, userId), replayed };
  }

  async updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null> {
    const client = await this.pool.connect();
    let lifeLinkId: string | null = null;
    try {
      await client.query("BEGIN");
      await lockKeys(client, [`owner:${userId}`]);
      const result = await client.query(
        `SELECT ll.*
         FROM life_link_qr_bindings b
         JOIN life_links ll ON ll.id = b.life_link_id
         WHERE b.qr_id = $1 AND ll.owner_id = $2
         FOR UPDATE OF ll`,
        [qrId, userId]
      );
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const current = mapStoredLifeLink(result.rows[0]);
      lifeLinkId = current.id;
      assertLifeLinkBodyPatchIsCoordinated(patch);
      let parentId = current.parentId;
      const ownerLifeLinks = await this.loadOwnerLifeLinks(client, userId);
      const markers = await this.loadProjectCompatibility(client);
      if (patch.projectId !== undefined) {
        const currentProjectId = deriveProjectCompatibilityId(ownerLifeLinks, markers, current.id);
        if (patch.projectId !== currentProjectId) {
          assertLegacyPlacementChangeAllowed(current, ownerLifeLinks, markers);
          const marker = patch.projectId ? markers.find((item) => item.projectId === patch.projectId) : null;
          if (patch.projectId) {
            const target = marker ? ownerLifeLinks.find((item) => item.id === marker.lifeLinkId) : null;
            if (!target) {
              await client.query("COMMIT");
              return null;
            }
          }
          parentId = marker?.lifeLinkId ?? null;
          assertValidLifeLinkParentPlacement(ownerLifeLinks, current.id, parentId);
        }
      }
      const legacyCoordinated =
        patch.body === undefined && patch.bodyDoc === undefined
          ? { body: current.body, bodyDoc: current.bodyDoc, bodyDocVersion: current.bodyDocVersion }
          : coordinateLifeLinkBody({
              body: patch.body ?? (patch.bodyDoc === null ? current.body : undefined),
              bodyDoc: patch.bodyDoc === null ? undefined : patch.bodyDoc,
              bodyDocVersion: patch.bodyDocVersion
            });
      const title = patch.title ?? current.title;
      assertLifeLinkContentWithinBounds(title, legacyCoordinated.body, legacyCoordinated.bodyDoc);
      await client.query(
        `UPDATE life_links
         SET parent_id = $3, title = $4, body = $5, body_doc = $6::jsonb, body_doc_version = $7,
             privacy = $8, updated_at = $9
         WHERE id = $1 AND owner_id = $2`,
        [
          current.id,
          userId,
          parentId,
          title,
          legacyCoordinated.body,
          JSON.stringify(legacyCoordinated.bodyDoc),
          legacyCoordinated.bodyDocVersion,
          patch.privacy ?? current.privacy,
          nextTimestamp(current.updatedAt)
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return lifeLinkId ? this.projectLifeLinkByIdForLegacy(lifeLinkId) : null;
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
    const result = await this.pool.query(
      `DELETE FROM link_media lm
       USING life_link_qr_bindings b
       WHERE lm.id = $1 AND lm.owner_id = $2 AND lm.life_link_id = b.life_link_id AND b.qr_id = $3
       RETURNING lm.id`,
      [mediaId, userId, qrId]
    );
    return Boolean(result.rowCount);
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
    if (row.privacy === "private" && !viewerIsOwner) {
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
      for (const user of data.users) {
        const passwordHash = await hashPassword(password);
        await client.query(
          `INSERT INTO users (id, email, display_name, password_hash, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.email, user.displayName, passwordHash, user.createdAt]
        );
      }
      for (const project of data.projects) {
        await client.query(
          `INSERT INTO life_links
             (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at)
           VALUES ($1, $2, NULL, $3, '', $4::jsonb, $5, 'private', $6, $6)
           ON CONFLICT (id) DO NOTHING`,
          [project.id, project.ownerId, project.name, JSON.stringify(createLinkBodyDocFromPlainText("")), LINK_BODY_DOC_VERSION, project.createdAt]
        );
        await client.query(
          `INSERT INTO life_link_project_compat (project_id, life_link_id)
           VALUES ($1, $1)
           ON CONFLICT (project_id) DO NOTHING`,
          [project.id]
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
          await client.query(
            `INSERT INTO life_links
               (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING`,
            [
              lifeLinkId,
              link.ownerId,
              link.projectId,
              link.title,
              link.body,
              JSON.stringify(link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body)),
              link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
              link.privacy,
              link.createdAt,
              link.updatedAt
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

  async checkReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async close(): Promise<void> {
    await this.pool.end();
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

  private async loadProjectCompatibility(queryable: Queryable): Promise<LifeLinkProjectCompatibilityRecord[]> {
    const result = await queryable.query("SELECT project_id, life_link_id FROM life_link_project_compat");
    return result.rows.map((row) => ({ projectId: String(row.project_id), lifeLinkId: String(row.life_link_id) }));
  }

  private async projectLifeLinkByIdForLegacy(lifeLinkId: string): Promise<LinkRecord | null> {
    const lifeLink = await this.loadLifeLink(this.pool, lifeLinkId);
    if (!lifeLink?.qrId) {
      return null;
    }
    const qrResult = await this.pool.query("SELECT * FROM qr_codes WHERE id = $1", [lifeLink.qrId]);
    if (!qrResult.rows[0]) {
      return null;
    }
    const ownerLifeLinks = await this.loadOwnerLifeLinks(this.pool, lifeLink.ownerId);
    const markers = await this.loadProjectCompatibility(this.pool);
    return projectLifeLinkAsLink(
      lifeLink,
      mapQrInventory(qrResult.rows[0]),
      deriveProjectCompatibilityId(ownerLifeLinks, markers, lifeLink.id)
    );
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

async function insertLifeLink(queryable: Queryable, lifeLink: StoredLifeLink): Promise<void> {
  await queryable.query(
    `INSERT INTO life_links
       (id, owner_id, parent_id, title, body, body_doc, body_doc_version, privacy, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
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
      lifeLink.updatedAt
    ]
  );
}

async function lockKeys(client: PoolClient, keys: string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }
}

function mapUser(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
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

function sameStoredLifeLink(existing: StoredLifeLink, candidate: LifeLinkRecord): boolean {
  return JSON.stringify(existing) === JSON.stringify(withoutRelations(candidate));
}

function assertFresh(lifeLink: StoredLifeLink, expectedUpdatedAt: string): void {
  if (lifeLink.updatedAt !== expectedUpdatedAt) {
    throw new LifeLinkDomainError("stale_life_link", "Life Link changed after it was read.", { retryable: true });
  }
}

function assertLegacyPlacementChangeAllowed(
  lifeLink: StoredLifeLink,
  ownerLifeLinks: readonly LifeLinkRecord[],
  markers: readonly LifeLinkProjectCompatibilityRecord[]
): void {
  if (ownerLifeLinks.some((candidate) => candidate.parentId === lifeLink.id)) {
    throw new LifeLinkDomainError("invalid_parent", "Legacy placement cannot move a Life Link with children.", {
      reason: "legacy_non_leaf"
    });
  }
  if (lifeLink.parentId && !markers.some((item) => item.lifeLinkId === lifeLink.parentId)) {
    throw new LifeLinkDomainError("invalid_parent", "Legacy placement cannot flatten a nested Life Link.", {
      reason: "legacy_nested"
    });
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

function asBuffer(value: unknown): Buffer {
  return value instanceof Buffer ? value : Buffer.from(value as ArrayBuffer);
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}
