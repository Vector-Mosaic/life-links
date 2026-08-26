import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import {
  type ClaimResult,
  type ExportBatchRecord,
  type LinkMediaRecord,
  type LinkRecord,
  type PrivacyStatus,
  type ProjectRecord,
  type QrRecord,
  type QrViewState,
  LINK_BODY_DOC_VERSION,
  buildQrUrl,
  createDemoSeedData,
  createLinkBodyDocFromPlainText,
  generateQrIds,
  normalizeLinkBodyDoc,
  MAX_MEDIA_PER_LINK,
  normalizeBatchCount
} from "@life-links/core";

import { hashPassword } from "./password.js";
import {
  ClaimIdempotencyConflictError,
  type BatchCreateResult,
  type ClaimOutcome,
  type LifeLinksStore,
  type LinkMediaFile,
  type LinkMediaInput,
  type LinkPatch,
  type SessionRecord,
  type StoredUser
} from "./store.js";

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
    await this.pool.query("DELETE FROM sessions WHERE expires_at <= now()");
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
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: toIso(row.expires_at),
      createdAt: toIso(row.created_at),
      user: {
        id: row.user_id_value,
        email: row.email,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        createdAt: toIso(row.user_created_at)
      }
    };
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async listLinks(userId: string): Promise<LinkRecord[]> {
    const result = await this.pool.query(
      `SELECT qc.id, qc.url, qc.status, qc.batch_id, qc.created_at AS qr_created_at, qc.claimed_at,
              l.owner_id, l.title, l.body, l.body_doc, l.body_doc_version, l.project_id, l.privacy, l.created_at AS link_created_at, l.updated_at
       FROM qr_codes qc
       LEFT JOIN links l ON l.qr_id = qc.id
       LEFT JOIN export_batches eb ON eb.id = qc.batch_id
       WHERE l.owner_id = $1 OR (qc.status = 'unclaimed' AND eb.created_by = $1)
       ORDER BY COALESCE(l.updated_at, qc.claimed_at, qc.created_at) DESC`,
      [userId]
    );
    return this.attachMedia(result.rows.map(mapLinkRow));
  }

  async listProjects(userId: string): Promise<ProjectRecord[]> {
    const result = await this.pool.query("SELECT * FROM projects WHERE owner_id = $1 ORDER BY name ASC", [userId]);
    return result.rows.map(mapProject);
  }

  async createProject(userId: string, name: string): Promise<ProjectRecord> {
    const project: ProjectRecord = {
      id: `project-${randomUUID()}`,
      ownerId: userId,
      name,
      createdAt: new Date().toISOString()
    };
    await this.pool.query("INSERT INTO projects (id, owner_id, name, created_at) VALUES ($1, $2, $3, $4)", [
      project.id,
      project.ownerId,
      project.name,
      project.createdAt
    ]);
    return project;
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
        await client.query(
          "INSERT INTO qr_codes (id, url, status, batch_id, created_at, claimed_at) VALUES ($1, $2, 'unclaimed', $3, $4, NULL)",
          [id, buildQrUrl(qrBaseUrl, id), batch.id, now]
        );
      }
      await client.query("COMMIT");
      return {
        batch,
        qrCodes: ids.map((id) =>
          linkFromQr({
            id,
            url: buildQrUrl(qrBaseUrl, id),
            status: "unclaimed",
            batchId: batch.id,
            createdAt: now,
            claimedAt: null
          })
        )
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listBatchLinks(userId: string, batchId: string): Promise<LinkRecord[]> {
    const result = await this.pool.query(
      `SELECT qc.id, qc.url, qc.status, qc.batch_id, qc.created_at AS qr_created_at, qc.claimed_at,
              l.owner_id, l.title, l.body, l.body_doc, l.body_doc_version, l.project_id, l.privacy, l.created_at AS link_created_at, l.updated_at
       FROM export_batches eb
       JOIN qr_codes qc ON qc.batch_id = eb.id
       LEFT JOIN links l ON l.qr_id = qc.id
       WHERE eb.id = $1 AND eb.created_by = $2
       ORDER BY qc.id ASC`,
      [batchId, userId]
    );
    return this.attachMedia(result.rows.map(mapLinkRow));
  }

  async getQrState(qrId: string, viewerUserId: string | null): Promise<QrViewState> {
    const result = await this.pool.query(
      `SELECT qc.id, qc.url, qc.status, qc.batch_id, qc.created_at AS qr_created_at, qc.claimed_at,
              l.owner_id, l.title, l.body, l.body_doc, l.body_doc_version, l.project_id, l.privacy, l.created_at AS link_created_at, l.updated_at
       FROM qr_codes qc
       LEFT JOIN links l ON l.qr_id = qc.id
       WHERE qc.id = $1`,
      [qrId]
    );
    const row = result.rows[0];
    if (!row) {
      return { state: "not_found", qrId };
    }
    const link = mapLinkRow(row);
    if (!row.owner_id) {
      return { state: "unclaimed", qr: link };
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === link.ownerId);
    if (link.privacy === "private" && !viewerIsOwner) {
      return { state: "private", qrId };
    }
    const [linkWithMedia] = await this.attachMedia([link]);
    return { state: "claimed", link: linkWithMedia, viewerIsOwner };
  }

  async claimQr(qrId: string, userId: string, commandId: string): Promise<ClaimOutcome> {
    const client = await this.pool.connect();
    let result: ClaimResult = "not_found";
    let stateQrId = qrId;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [commandId]);
      const existingEvent = await client.query("SELECT * FROM claim_events WHERE command_id = $1", [commandId]);
      if (existingEvent.rows[0]) {
        if (existingEvent.rows[0].qr_id !== qrId || existingEvent.rows[0].owner_id !== userId) {
          throw new ClaimIdempotencyConflictError();
        }
        result = existingEvent.rows[0].result;
        stateQrId = existingEvent.rows[0].qr_id;
        await client.query("COMMIT");
        return { result, state: await this.getQrState(stateQrId, userId), replayed: true };
      }

      const qrResult = await client.query("SELECT * FROM qr_codes WHERE id = $1 FOR UPDATE", [qrId]);
      const qr = qrResult.rows[0] ? mapQr(qrResult.rows[0]) : null;
      if (!qr) {
        result = "not_found";
      } else {
        const linkResult = await client.query("SELECT * FROM links WHERE qr_id = $1 FOR UPDATE", [qrId]);
        const existingLink = linkResult.rows[0];
        if (existingLink?.owner_id === userId) {
          result = "already_owned";
        } else if (existingLink?.owner_id && existingLink.owner_id !== userId) {
          result = "owned_by_other";
        } else {
          const now = new Date().toISOString();
          await client.query("UPDATE qr_codes SET status = 'claimed', claimed_at = $2 WHERE id = $1", [qrId, now]);
          await client.query(
            `INSERT INTO links (qr_id, owner_id, title, body, body_doc, body_doc_version, project_id, privacy, created_at, updated_at)
             VALUES ($1, $2, $3, '', $4::jsonb, $5, NULL, 'public', $6, $6)`,
            [qrId, userId, "Untitled link", JSON.stringify(createLinkBodyDocFromPlainText("")), LINK_BODY_DOC_VERSION, now]
          );
          result = "claimed";
        }
      }

      await client.query(
        "INSERT INTO claim_events (command_id, qr_id, owner_id, result, created_at) VALUES ($1, $2, $3, $4, $5)",
        [commandId, qrId, userId, result, new Date().toISOString()]
      );
      await client.query("COMMIT");
      return { result, state: await this.getQrState(qrId, userId), replayed: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLink(userId: string, qrId: string, patch: LinkPatch): Promise<LinkRecord | null> {
    if (patch.projectId) {
      const project = await this.pool.query("SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2", [patch.projectId, userId]);
      if (!project.rowCount) {
        return null;
      }
    }
    const currentResult = await this.pool.query("SELECT * FROM links WHERE qr_id = $1 AND owner_id = $2", [qrId, userId]);
    const current = currentResult.rows[0];
    if (!current) {
      return null;
    }
    const nextBody = patch.body ?? String(current.body ?? "");
    const currentBodyDoc = normalizeLinkBodyDoc(current.body_doc) ?? createLinkBodyDocFromPlainText(String(current.body ?? ""));
    const nextBodyDoc =
      patch.bodyDoc === undefined ? (patch.body === undefined ? currentBodyDoc : createLinkBodyDocFromPlainText(nextBody)) : patch.bodyDoc;
    const next = {
      title: patch.title ?? current.title,
      body: nextBody,
      bodyDoc: nextBodyDoc,
      bodyDocVersion: nextBodyDoc
        ? patch.bodyDocVersion ?? Number(current.body_doc_version ?? LINK_BODY_DOC_VERSION)
        : null,
      privacy: patch.privacy ?? current.privacy,
      projectId: patch.projectId === undefined ? current.project_id : patch.projectId
    };
    await this.pool.query(
      "UPDATE links SET title = $3, body = $4, body_doc = $5::jsonb, body_doc_version = $6, privacy = $7, project_id = $8, updated_at = $9 WHERE qr_id = $1 AND owner_id = $2",
      [
        qrId,
        userId,
        next.title,
        next.body,
        next.bodyDoc ? JSON.stringify(next.bodyDoc) : null,
        next.bodyDocVersion,
        next.privacy,
        next.projectId,
        new Date().toISOString()
      ]
    );
    const state = await this.getQrState(qrId, userId);
    return state.state === "claimed" ? state.link : null;
  }

  async createLinkMedia(userId: string, qrId: string, input: LinkMediaInput): Promise<LinkMediaRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const link = await client.query("SELECT qr_id FROM links WHERE qr_id = $1 AND owner_id = $2 FOR UPDATE", [
        qrId,
        userId
      ]);
      if (!link.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      const mediaCount = await client.query("SELECT count(*)::int AS count FROM link_media WHERE qr_id = $1", [qrId]);
      if (Number(mediaCount.rows[0]?.count ?? 0) >= MAX_MEDIA_PER_LINK) {
        await client.query("COMMIT");
        return null;
      }
      const media: LinkMediaRecord = {
        id: `media-${randomUUID()}`,
        qrId,
        ownerId: userId,
        kind: input.kind,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        url: "",
        createdAt: new Date().toISOString()
      };
      media.url = mediaUrl(qrId, media.id);
      await client.query(
        `INSERT INTO link_media (id, qr_id, owner_id, kind, mime_type, file_name, size_bytes, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          media.id,
          media.qrId,
          media.ownerId,
          media.kind,
          media.mimeType,
          media.fileName,
          media.sizeBytes,
          input.data,
          media.createdAt
        ]
      );
      await client.query("COMMIT");
      return media;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteLinkMedia(userId: string, qrId: string, mediaId: string): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM link_media WHERE id = $1 AND qr_id = $2 AND owner_id = $3 RETURNING id",
      [mediaId, qrId, userId]
    );
    return Boolean(result.rowCount);
  }

  async getLinkMedia(qrId: string, mediaId: string, viewerUserId: string | null): Promise<LinkMediaFile | "private" | null> {
    const result = await this.pool.query(
      `SELECT lm.*, l.privacy, l.owner_id AS link_owner_id
       FROM link_media lm
       JOIN links l ON l.qr_id = lm.qr_id
       WHERE lm.qr_id = $1 AND lm.id = $2`,
      [qrId, mediaId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const viewerIsOwner = Boolean(viewerUserId && viewerUserId === String(row.link_owner_id));
    if (row.privacy === "private" && !viewerIsOwner) {
      return "private";
    }
    return {
      media: mapMedia(row),
      data: row.data instanceof Buffer ? row.data : Buffer.from(row.data),
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
          `INSERT INTO projects (id, owner_id, name, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [project.id, project.ownerId, project.name, project.createdAt]
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
          `INSERT INTO qr_codes (id, url, status, batch_id, created_at, claimed_at)
           VALUES ($1, $2, $3, 'batch-demo-seed', $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [link.id, link.url, link.status, link.createdAt, link.status === "claimed" ? link.updatedAt : null]
        );
        if (link.status === "claimed") {
          await client.query(
            `INSERT INTO links (qr_id, owner_id, title, body, body_doc, body_doc_version, project_id, privacy, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
             ON CONFLICT (qr_id) DO NOTHING`,
            [
              link.id,
              link.ownerId,
              link.title,
              link.body,
              JSON.stringify(link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body)),
              link.bodyDocVersion ?? LINK_BODY_DOC_VERSION,
              link.projectId,
              link.privacy,
              link.createdAt,
              link.updatedAt
            ]
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

  private async attachMedia(links: LinkRecord[]): Promise<LinkRecord[]> {
    const qrIds = links.filter((link) => link.status === "claimed").map((link) => link.id);
    if (!qrIds.length) {
      return links;
    }
    const result = await this.pool.query(
      `SELECT id, qr_id, owner_id, kind, mime_type, file_name, size_bytes, created_at
       FROM link_media
       WHERE qr_id = ANY($1::text[])
       ORDER BY created_at ASC, id ASC`,
      [qrIds]
    );
    const mediaByQr = new Map<string, LinkMediaRecord[]>();
    for (const row of result.rows) {
      const media = mapMedia(row);
      const current = mediaByQr.get(media.qrId) ?? [];
      current.push(media);
      mediaByQr.set(media.qrId, current);
    }
    return links.map((link) => ({ ...link, media: mediaByQr.get(link.id) ?? [] }));
  }
}

export function createPostgresStore(databaseUrl: string, schemaName?: string): { store: PostgresLifeLinksStore; pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    options: schemaName ? `-c search_path=${schemaName}` : undefined
  });
  return { store: new PostgresLifeLinksStore(pool), pool };
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

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    createdAt: toIso(row.created_at)
  };
}

function mapQr(row: Record<string, unknown>): QrRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    status: row.status as QrRecord["status"],
    batchId: row.batch_id ? String(row.batch_id) : null,
    createdAt: toIso(row.created_at),
    claimedAt: row.claimed_at ? toIso(row.claimed_at) : null
  };
}

function mapLinkRow(row: Record<string, unknown>): LinkRecord {
  const qr = mapQr({
    id: row.id,
    url: row.url,
    status: row.status,
    batch_id: row.batch_id,
    created_at: row.qr_created_at,
    claimed_at: row.claimed_at
  });
  if (!row.owner_id) {
    return linkFromQr(qr);
  }
  return {
    id: qr.id,
    url: qr.url,
    status: "claimed",
    ownerId: String(row.owner_id),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    bodyDoc: normalizeLinkBodyDoc(row.body_doc) ?? createLinkBodyDocFromPlainText(String(row.body ?? "")),
    bodyDocVersion: row.body_doc_version ? Number(row.body_doc_version) : LINK_BODY_DOC_VERSION,
    projectId: row.project_id ? String(row.project_id) : null,
    privacy: (row.privacy as PrivacyStatus) ?? "public",
    media: [],
    createdAt: toIso(row.link_created_at ?? qr.createdAt),
    updatedAt: toIso(row.updated_at ?? qr.claimedAt ?? qr.createdAt)
  };
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

function mapMedia(row: Record<string, unknown>): LinkMediaRecord {
  const qrId = String(row.qr_id);
  const id = String(row.id);
  return {
    id,
    qrId,
    ownerId: String(row.owner_id),
    kind: row.kind as LinkMediaRecord["kind"],
    mimeType: String(row.mime_type),
    fileName: String(row.file_name),
    sizeBytes: Number(row.size_bytes),
    url: mediaUrl(qrId, id),
    createdAt: toIso(row.created_at)
  };
}

function mediaUrl(qrId: string, mediaId: string): string {
  return `/api/links/${encodeURIComponent(qrId)}/media/${encodeURIComponent(mediaId)}`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}
