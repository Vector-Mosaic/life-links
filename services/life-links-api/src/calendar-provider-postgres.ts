import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { CalendarRecord, CalendarConnectedCalendarView } from "@life-links/core";

import {
  CalendarProviderGatewayError,
  assertCalendarProvisioningPair,
  calendarProviderCredentialHandle,
  type CalendarProviderBindingRecord,
  type CalendarProviderConnectionRecord,
  type CalendarProviderConnectionExpectation,
  type CalendarProviderSynchronizationTarget,
  type CalendarProviderEventProjection,
  type CalendarProviderEventTombstone,
  type CalendarProviderOutboxRecord,
  type CalendarProviderStateStore,
  type CalendarProviderSyncMutation,
  type CalendarProviderSyncState,
  type CalendarProviderWebhookHint
} from "./calendar-provider-gateway.js";

type ProviderConnectionRow = QueryResultRow & {
  connection_id: string;
  owner_id: string;
  provider_key: string;
  provider_account_id: string;
  status: CalendarProviderConnectionRecord["status"];
  credential_handle: string | null;
  connected_at: Date | string;
  disconnected_at: Date | string | null;
  remote_revocation_status: CalendarProviderConnectionRecord["remoteRevocationStatus"];
  remote_revocation_attempted_at: Date | string | null;
  remote_revocation_error_code: CalendarProviderConnectionRecord["remoteRevocationErrorCode"];
};

type ProviderBindingRow = QueryResultRow & {
  connection_id: string;
  owner_id: string;
  provider_key: string;
  provider_account_id: string;
  calendar_id: string;
  provider_calendar_id: string;
  provider_display_name: string;
  capabilities: CalendarProviderBindingRecord["capabilities"];
  agent_grant: CalendarProviderBindingRecord["agentGrant"];
  visible: boolean;
  calendar_updated_at: Date | string;
};

type CanonicalCalendarRow = QueryResultRow & {
  id: string;
  owner_id: string;
  title: string;
  color: string;
  time_zone: string;
  source: CalendarRecord["source"];
  is_default: boolean;
  agent_access: CalendarRecord["agentAccess"];
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

type ProviderSyncRow = QueryResultRow & {
  connection_id: string;
  calendar_id: string;
  sync_cursor: string | null;
  last_reconciled_at: Date | string | null;
  last_recovery_at: Date | string | null;
};

type ProviderProjectionRow = QueryResultRow & {
  connection_id: string;
  calendar_id: string;
  owner_id: string;
  provider_key: string;
  provider_account_id: string;
  provider_calendar_id: string;
  provider_event_id: string;
  provider_revision: string;
  content: CalendarProviderEventProjection["content"];
  synchronized_at: Date | string;
};

type ProviderTombstoneRow = QueryResultRow & {
  connection_id: string;
  calendar_id: string;
  owner_id: string;
  provider_key: string;
  provider_account_id: string;
  provider_calendar_id: string;
  provider_event_id: string;
  deleted_provider_revision: string;
  deleted_at: Date | string;
  cause: CalendarProviderEventTombstone["cause"];
};

type ProviderOutboxRow = QueryResultRow & {
  command_id: string;
  fingerprint: string;
  command: CalendarProviderOutboxRecord["command"];
  status: CalendarProviderOutboxRecord["status"];
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_attempt_at: Date | string | null;
  next_attempt_at: Date | string | null;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  last_error_code: CalendarProviderOutboxRecord["lastErrorCode"];
  result: CalendarProviderOutboxRecord["result"];
  conflict_revision: string | null;
  dispatch_evidence: CalendarProviderOutboxRecord["dispatchEvidence"];
};

type ProviderWebhookRow = QueryResultRow & {
  hint_id: string;
  owner_id: string;
  connection_id: string;
  provider_account_id: string;
  provider_calendar_id: string | null;
  received_at: Date | string;
  status: CalendarProviderWebhookHint["status"];
  reconciled_at: Date | string | null;
};

type BindingIdentity = {
  ownerId: string;
  providerKey: string;
  providerAccountId: string;
  providerCalendarId: string;
};

const bindingReadSql = `SELECT b.*, c.agent_access AS agent_grant, c.updated_at AS calendar_updated_at
  FROM calendar_provider_bindings b
  JOIN calendars c ON c.id = b.calendar_id AND c.owner_id = b.owner_id`;

/**
 * Durable PostgreSQL implementation of the provider boundary. It deliberately
 * stores only credential-vault handles; OAuth secrets remain outside this
 * database and outside every returned browser/agent view.
 */
export class PostgresCalendarProviderStateStore implements CalendarProviderStateStore {
  constructor(private readonly pool: Pool) {}

  async listConnections(ownerId: string): Promise<CalendarProviderConnectionRecord[]> {
    const result = await this.pool.query<ProviderConnectionRow>(
      "SELECT * FROM calendar_provider_connections WHERE owner_id = $1 ORDER BY connected_at, connection_id",
      [ownerId]
    );
    return result.rows.map(mapConnection);
  }

  async getConnection(connectionId: string): Promise<CalendarProviderConnectionRecord | null> {
    const result = await this.pool.query<ProviderConnectionRow>(
      "SELECT * FROM calendar_provider_connections WHERE connection_id = $1",
      [connectionId]
    );
    return result.rows[0] ? mapConnection(result.rows[0]) : null;
  }

  async saveConnection(connection: CalendarProviderConnectionRecord): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO calendar_provider_connections (
         connection_id, owner_id, provider_key, provider_account_id, status,
         credential_handle, connected_at, disconnected_at,
         remote_revocation_status, remote_revocation_attempted_at, remote_revocation_error_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (connection_id) DO UPDATE SET
         status = EXCLUDED.status,
         credential_handle = EXCLUDED.credential_handle,
         connected_at = EXCLUDED.connected_at,
         disconnected_at = EXCLUDED.disconnected_at,
         remote_revocation_status = EXCLUDED.remote_revocation_status,
         remote_revocation_attempted_at = EXCLUDED.remote_revocation_attempted_at,
         remote_revocation_error_code = EXCLUDED.remote_revocation_error_code
       WHERE calendar_provider_connections.owner_id = EXCLUDED.owner_id
         AND calendar_provider_connections.provider_key = EXCLUDED.provider_key
         AND calendar_provider_connections.provider_account_id = EXCLUDED.provider_account_id
       RETURNING connection_id`,
      [
        connection.connectionId,
        connection.ownerId,
        connection.providerKey,
        connection.providerAccountId,
        connection.status,
        connection.credentialHandle,
        connection.connectedAt,
        connection.disconnectedAt,
        connection.remoteRevocationStatus,
        connection.remoteRevocationAttemptedAt,
        connection.remoteRevocationErrorCode
      ]
    );
    assertOwnedWrite(result.rowCount, "The provider connection identity belongs to another owner.");
  }

  async listCalendars(connectionId: string): Promise<CalendarProviderBindingRecord[]> {
    const result = await this.pool.query<ProviderBindingRow>(
      `${bindingReadSql} WHERE b.connection_id = $1 ORDER BY lower(b.provider_display_name), b.calendar_id`,
      [connectionId]
    );
    return result.rows.map(mapBinding);
  }

  async reserveConnection(connection: CalendarProviderConnectionRecord) {
    const insert = await this.pool.query(
      `INSERT INTO calendar_provider_connections (connection_id, owner_id, provider_key, provider_account_id, status,
         credential_handle, connected_at, disconnected_at, remote_revocation_status, remote_revocation_attempted_at, remote_revocation_error_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (connection_id) DO NOTHING RETURNING connection_id`,
      [connection.connectionId, connection.ownerId, connection.providerKey, connection.providerAccountId, connection.status,
        connection.credentialHandle, connection.connectedAt, connection.disconnectedAt, connection.remoteRevocationStatus,
        connection.remoteRevocationAttemptedAt, connection.remoteRevocationErrorCode]
    );
    const record = await this.getConnection(connection.connectionId);
    if (!record) throw new Error("The reserved provider connection is not readable.");
    return { record, created: insert.rowCount === 1 };
  }

  async transitionConnection(connection: CalendarProviderConnectionRecord, expected: CalendarProviderConnectionExpectation) {
    return this.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`owner:${connection.ownerId}`]);
      const result = await client.query(
        `UPDATE calendar_provider_connections SET status=$5, credential_handle=$6, connected_at=$7, disconnected_at=$8,
           remote_revocation_status=$9, remote_revocation_attempted_at=$10, remote_revocation_error_code=$11
         WHERE connection_id=$1 AND owner_id=$2 AND provider_key=$3 AND provider_account_id=$4
           AND status=$12 AND credential_handle IS NOT DISTINCT FROM $13`,
        [connection.connectionId, connection.ownerId, connection.providerKey, connection.providerAccountId, connection.status,
          connection.credentialHandle, connection.connectedAt, connection.disconnectedAt, connection.remoteRevocationStatus,
          connection.remoteRevocationAttemptedAt, connection.remoteRevocationErrorCode, expected.status, expected.credentialHandle]
      );
      return result.rowCount === 1;
    });
  }

  async listSynchronizationTargets(input: { providerKey?: string; limit: number; after: { connectionId: string; calendarId: string } | null }) {
    const result = await this.pool.query<ProviderBindingRow>(
      `SELECT b.* FROM calendar_provider_bindings b JOIN calendar_provider_connections c ON c.connection_id=b.connection_id
       JOIN calendars cal ON cal.id=b.calendar_id AND cal.owner_id=b.owner_id
       WHERE c.status='active' AND cal.deleted_at IS NULL AND ($1::text IS NULL OR b.provider_key=$1)
         AND ($2::text IS NULL OR (b.connection_id,b.calendar_id) > ($2,$3))
       ORDER BY b.connection_id,b.calendar_id LIMIT $4`,
      [input.providerKey ?? null, input.after?.connectionId ?? null, input.after?.calendarId ?? null, input.limit]
    );
    return result.rows.map((row): CalendarProviderSynchronizationTarget => ({ ownerId: row.owner_id,
      connectionId: row.connection_id, calendarId: row.calendar_id, providerKey: row.provider_key }));
  }

  async listRetryableCommands(input: { providerKey?: string; limit: number; now: string }) {
    const result = await this.pool.query<ProviderOutboxRow>(
      `SELECT o.* FROM calendar_provider_outbox o JOIN calendar_provider_connections c ON c.connection_id=o.connection_id
       WHERE c.status='active' AND o.created_at >= c.connected_at AND ($1::text IS NULL OR c.provider_key=$1)
         AND o.command->>'actor'='owner' AND o.status IN ('pending','processing')
         AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= $2::timestamptz)
         AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= $2::timestamptz)
       ORDER BY o.created_at,o.command_id LIMIT $3`, [input.providerKey ?? null, input.now, input.limit]
    );
    return result.rows.map((row) => ({ commandId: row.command_id, ownerId: row.command.ownerId,
      connectionId: row.command.connectionId, calendarId: row.command.calendarId }));
  }

  async listRevocationTargets(input: { providerKey?: string; limit: number; now: string }) {
    const result = await this.pool.query<ProviderConnectionRow>(`SELECT owner_id,connection_id FROM calendar_provider_connections
      WHERE status='disconnected' AND credential_handle IS NOT NULL AND remote_revocation_status<>'succeeded'
        AND ($1::text IS NULL OR provider_key=$1)
        AND (remote_revocation_attempted_at IS NULL OR remote_revocation_attempted_at <= $2::timestamptz - interval '60 seconds')
      ORDER BY remote_revocation_attempted_at NULLS FIRST,connection_id LIMIT $3`, [input.providerKey ?? null,input.now,input.limit]);
    return result.rows.map((row) => ({ ownerId: row.owner_id, connectionId: row.connection_id }));
  }

  async getCalendar(connectionId: string, calendarId: string): Promise<CalendarProviderBindingRecord | null> {
    const result = await this.pool.query<ProviderBindingRow>(
      `${bindingReadSql} WHERE b.connection_id = $1 AND b.calendar_id = $2`,
      [connectionId, calendarId]
    );
    return result.rows[0] ? mapBinding(result.rows[0]) : null;
  }

  async getCanonicalCalendar(calendarId: string): Promise<CalendarRecord | null> {
    const result = await this.pool.query<CanonicalCalendarRow>("SELECT * FROM calendars WHERE id = $1", [calendarId]);
    const row = result.rows[0];
    return row ? mapCanonicalCalendar(row) : null;
  }

  async getManagedCalendar(connectionId: string, calendarId: string): Promise<CalendarConnectedCalendarView | null> {
    const result = await this.pool.query<{ canonical: CanonicalCalendarRow; binding: ProviderBindingRow } & QueryResultRow>(
      `SELECT to_jsonb(c) AS canonical, to_jsonb(b) AS binding FROM calendar_provider_bindings b
       JOIN calendars c ON c.id = b.calendar_id AND c.owner_id = b.owner_id
       WHERE b.connection_id = $1 AND b.calendar_id = $2`,
      [connectionId, calendarId]
    );
    const row = result.rows[0];
    return row ? {
      calendar: mapCanonicalCalendar(row.canonical), connectionId,
      providerCalendarId: row.binding.provider_calendar_id, providerDisplayName: row.binding.provider_display_name,
      capabilities: { ...row.binding.capabilities }, visible: row.binding.visible
    } : null;
  }

  async provisionCalendar(calendar: CalendarRecord, binding: CalendarProviderBindingRecord): Promise<void> {
    assertCalendarProvisioningPair(calendar, binding);
    await this.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`owner:${calendar.ownerId}`]);
      const connectionResult = await client.query<ProviderConnectionRow>(
        "SELECT * FROM calendar_provider_connections WHERE connection_id = $1 FOR UPDATE",
        [binding.connectionId]
      );
      const connection = connectionResult.rows[0];
      if (!connection || !["provisioning", "active"].includes(connection.status) || connection.owner_id !== calendar.ownerId
        || connection.provider_key !== binding.providerKey
        || connection.provider_account_id !== binding.providerAccountId) {
        throw new CalendarProviderGatewayError(
          "provider_identity_mismatch",
          "A canonical external Calendar may only be provisioned by its exact provisioning connection."
        );
      }
      const existing = await client.query<ProviderBindingRow>(
        "SELECT * FROM calendar_provider_bindings WHERE connection_id=$1 AND calendar_id=$2", [binding.connectionId, calendar.id]
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.owner_id !== binding.ownerId || row.provider_key !== binding.providerKey
          || row.provider_account_id !== binding.providerAccountId || row.provider_calendar_id !== binding.providerCalendarId) {
          throw new CalendarProviderGatewayError("provider_identity_mismatch", "The existing Calendar belongs to another provider identity.");
        }
        return;
      }
      await client.query(
        `INSERT INTO calendars (
           id, owner_id, title, color, time_zone, source, is_default, created_at, updated_at, deleted_at, agent_access
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          calendar.id,
          calendar.ownerId,
          calendar.title,
          calendar.color,
          calendar.timeZone,
          calendar.source,
          calendar.isDefault,
          calendar.createdAt,
          calendar.updatedAt,
          calendar.deletedAt,
          calendar.agentAccess
        ]
      );
      await client.query(
        `INSERT INTO calendar_provider_bindings (
           connection_id, owner_id, provider_key, provider_account_id, calendar_id,
           provider_calendar_id, provider_display_name, capabilities, visible
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        bindingValues(binding)
      );
    });
  }

  async updateCalendarBinding(calendar: CalendarProviderBindingRecord, options?: {
    expectedUpdatedAt: string;
    updatedAt: string;
  }): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`owner:${calendar.ownerId}`]);
      const connection = await client.query<ProviderConnectionRow>(
        "SELECT * FROM calendar_provider_connections WHERE connection_id = $1 AND owner_id = $2 FOR UPDATE",
        [calendar.connectionId, calendar.ownerId]
      );
      const current = await client.query<ProviderBindingRow>(
        `${bindingReadSql} WHERE b.connection_id = $1 AND b.calendar_id = $2 FOR UPDATE OF b, c`,
        [calendar.connectionId, calendar.calendarId]
      );
      const row = current.rows[0];
      if (!connection.rows[0] || !row || row.owner_id !== calendar.ownerId
        || row.provider_key !== calendar.providerKey || row.provider_account_id !== calendar.providerAccountId
        || row.provider_calendar_id !== calendar.providerCalendarId) {
        throw new CalendarProviderGatewayError("provider_identity_mismatch", "The provider Calendar binding identity does not match its canonical Calendar.");
      }
      if (options && (iso(row.calendar_updated_at) !== options.expectedUpdatedAt || connection.rows[0].status !== "active")) {
        throw new CalendarProviderGatewayError("calendar_settings_conflict", "Calendar settings changed. Reload before saving.");
      }
      const updatedAt = options?.updatedAt
        ?? new Date(Math.max(Date.now(), Date.parse(iso(row.calendar_updated_at)) + 1)).toISOString();
      await client.query(
        `UPDATE calendar_provider_bindings SET provider_display_name = $7, capabilities = $8::jsonb, visible = $9
         WHERE connection_id = $1 AND owner_id = $2 AND provider_key = $3
           AND provider_account_id = $4 AND calendar_id = $5 AND provider_calendar_id = $6`,
        bindingValues(calendar)
      );
      const canonical = await client.query(
        `UPDATE calendars SET agent_access = $3, updated_at = $4
         WHERE id = $1 AND owner_id = $2 AND source = 'external' AND deleted_at IS NULL`,
        [calendar.calendarId, calendar.ownerId, calendar.agentGrant, updatedAt]
      );
      assertOwnedWrite(canonical.rowCount, "The canonical external Calendar is unavailable.");
    });
  }

  async rollbackProvisioning(connectionId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      const connectionResult = await client.query<ProviderConnectionRow>(
        "SELECT * FROM calendar_provider_connections WHERE connection_id = $1 FOR UPDATE",
        [connectionId]
      );
      const connection = connectionResult.rows[0];
      if (!connection || connection.status !== "disconnected") {
        throw new CalendarProviderGatewayError(
          "connection_inactive",
          "Calendar provisioning can only be rolled back after the connection is closed."
        );
      }
      const calendarResult = await client.query<{ id: string; source: CalendarRecord["source"] } & QueryResultRow>(
        `SELECT calendars.id, calendars.source
         FROM calendar_provider_bindings
         JOIN calendars ON calendars.id = calendar_provider_bindings.calendar_id
           AND calendars.owner_id = calendar_provider_bindings.owner_id
         WHERE calendar_provider_bindings.connection_id = $1
         FOR UPDATE OF calendar_provider_bindings, calendars`,
        [connectionId]
      );
      if (calendarResult.rows.some((calendar) => calendar.source !== "external")) {
        throw new CalendarProviderGatewayError(
          "provider_identity_mismatch",
          "Calendar provisioning rollback encountered a nonexternal Calendar."
        );
      }
      await client.query("SELECT set_config('life_links.allow_calendar_delete', 'on', true)");
      await client.query(
        `DELETE FROM calendars
         WHERE id IN (
           SELECT calendar_id FROM calendar_provider_bindings WHERE connection_id = $1
         ) AND owner_id = $2 AND source = 'external'`,
        [connectionId, connection.owner_id]
      );
    });
  }

  async getSyncState(connectionId: string, calendarId: string): Promise<CalendarProviderSyncState | null> {
    const result = await this.pool.query<ProviderSyncRow>(
      "SELECT * FROM calendar_provider_sync_states WHERE connection_id = $1 AND calendar_id = $2",
      [connectionId, calendarId]
    );
    return result.rows[0] ? mapSyncState(result.rows[0]) : null;
  }

  async listProjections(connectionId: string, calendarId: string): Promise<CalendarProviderEventProjection[]> {
    const result = await this.pool.query<ProviderProjectionRow>(
      `SELECT * FROM calendar_provider_event_projections
       WHERE connection_id = $1 AND calendar_id = $2
       ORDER BY synchronized_at, provider_event_id`,
      [connectionId, calendarId]
    );
    return result.rows.map(mapProjection);
  }

  async getProjection(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventProjection | null> {
    const result = await this.pool.query<ProviderProjectionRow>(
      `SELECT * FROM calendar_provider_event_projections
       WHERE connection_id = $1 AND calendar_id = $2 AND provider_event_id = $3`,
      [connectionId, calendarId, providerEventId]
    );
    return result.rows[0] ? mapProjection(result.rows[0]) : null;
  }

  async getTombstone(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventTombstone | null> {
    const result = await this.pool.query<ProviderTombstoneRow>(
      `SELECT * FROM calendar_provider_event_tombstones
       WHERE connection_id = $1 AND calendar_id = $2 AND provider_event_id = $3`,
      [connectionId, calendarId, providerEventId]
    );
    return result.rows[0] ? mapTombstone(result.rows[0]) : null;
  }

  async applySyncMutation(mutation: CalendarProviderSyncMutation): Promise<void> {
    await this.withTransaction(async (client) => {
      const identity = await lockBinding(client, mutation.connectionId, mutation.calendarId);
      const currentResult = await client.query<ProviderSyncRow>(
        `SELECT * FROM calendar_provider_sync_states
         WHERE connection_id = $1 AND calendar_id = $2 FOR UPDATE`,
        [mutation.connectionId, mutation.calendarId]
      );
      const current = currentResult.rows[0] ? mapSyncState(currentResult.rows[0]) : null;
      if (!syncStateEquals(current, mutation.expectedState)) {
        throw new CalendarProviderGatewayError(
          "sync_state_conflict",
          "Calendar synchronization state changed before commit.",
          { expectedCursor: mutation.expectedState?.syncCursor ?? null, currentCursor: current?.syncCursor ?? null }
        );
      }
      assertSyncIdentity(mutation, identity);

      if (mutation.removedProviderEventIds.length > 0) {
        await client.query(
          `DELETE FROM calendar_provider_event_projections
           WHERE connection_id = $1 AND calendar_id = $2 AND provider_event_id = ANY($3::text[])`,
          [mutation.connectionId, mutation.calendarId, mutation.removedProviderEventIds]
        );
      }

      for (const tombstone of mutation.tombstones) {
        await client.query(
          `INSERT INTO calendar_provider_event_tombstone_history (
             connection_id, calendar_id, owner_id, provider_calendar_id,
             provider_event_id, deleted_provider_revision, deleted_at, cause
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT DO NOTHING`,
          [tombstone.connectionId, tombstone.calendarId, tombstone.ownerId, tombstone.providerCalendarId,
            tombstone.providerEventId, tombstone.deletedProviderRevision, tombstone.deletedAt, tombstone.cause]
        );
        await client.query(
          `INSERT INTO calendar_provider_event_tombstones (
             connection_id, calendar_id, owner_id, provider_key, provider_account_id,
             provider_calendar_id, provider_event_id, deleted_provider_revision, deleted_at, cause
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (connection_id, calendar_id, provider_event_id) DO UPDATE SET
             deleted_provider_revision = EXCLUDED.deleted_provider_revision,
             deleted_at = EXCLUDED.deleted_at,
             cause = EXCLUDED.cause`,
          [tombstone.connectionId, tombstone.calendarId, tombstone.ownerId, tombstone.providerKey,
            tombstone.providerAccountId, tombstone.providerCalendarId, tombstone.providerEventId,
            tombstone.deletedProviderRevision, tombstone.deletedAt, tombstone.cause]
        );
        await client.query(
          `DELETE FROM calendar_provider_event_projections
           WHERE connection_id = $1 AND calendar_id = $2 AND provider_event_id = $3`,
          [tombstone.connectionId, tombstone.calendarId, tombstone.providerEventId]
        );
      }

      for (const projection of mutation.upserts) {
        await client.query(
          `INSERT INTO calendar_provider_event_projection_revisions (
             connection_id, calendar_id, owner_id, provider_calendar_id,
             provider_event_id, provider_revision, content, synchronized_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           ON CONFLICT DO NOTHING`,
          [projection.connectionId, projection.calendarId, projection.ownerId, projection.providerCalendarId,
            projection.providerEventId, projection.providerRevision, JSON.stringify(projection.content), projection.synchronizedAt]
        );
        await client.query(
          `INSERT INTO calendar_provider_event_projections (
             connection_id, calendar_id, owner_id, provider_key, provider_account_id,
             provider_calendar_id, provider_event_id, provider_revision, content, synchronized_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
           ON CONFLICT (connection_id, calendar_id, provider_event_id) DO UPDATE SET
             provider_revision = EXCLUDED.provider_revision,
             content = EXCLUDED.content,
             synchronized_at = EXCLUDED.synchronized_at`,
          [projection.connectionId, projection.calendarId, projection.ownerId, projection.providerKey,
            projection.providerAccountId, projection.providerCalendarId, projection.providerEventId,
            projection.providerRevision, JSON.stringify(projection.content), projection.synchronizedAt]
        );
        await client.query(
          `DELETE FROM calendar_provider_event_tombstones
           WHERE connection_id = $1 AND calendar_id = $2 AND provider_event_id = $3`,
          [projection.connectionId, projection.calendarId, projection.providerEventId]
        );
      }

      await client.query(
        `INSERT INTO calendar_provider_sync_states (
           connection_id, calendar_id, owner_id, provider_calendar_id,
           sync_cursor, last_reconciled_at, last_recovery_at, state_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,1)
         ON CONFLICT (connection_id, calendar_id) DO UPDATE SET
           sync_cursor = EXCLUDED.sync_cursor,
           last_reconciled_at = EXCLUDED.last_reconciled_at,
           last_recovery_at = EXCLUDED.last_recovery_at,
           state_version = calendar_provider_sync_states.state_version + 1`,
        [mutation.connectionId, mutation.calendarId, identity.ownerId, identity.providerCalendarId,
          mutation.state.syncCursor, mutation.state.lastReconciledAt, mutation.state.lastRecoveryAt]
      );
    });
  }

  async reserveOutbox(record: CalendarProviderOutboxRecord): Promise<{ record: CalendarProviderOutboxRecord; created: boolean }> {
    const insert = await this.pool.query(
      `INSERT INTO calendar_provider_outbox (
         command_id, owner_id, connection_id, calendar_id, fingerprint, command,
         status, attempts, created_at, updated_at, last_attempt_at, next_attempt_at,
         lease_owner, lease_expires_at, last_error_code, result, conflict_revision, dispatch_evidence
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb)
       ON CONFLICT (command_id) DO NOTHING RETURNING command_id`,
      outboxValues(record)
    );
    const stored = await this.getOutbox(record.commandId);
    if (!stored) throw new Error("The provider outbox reservation was not readable after insertion.");
    return { record: stored, created: insert.rowCount === 1 };
  }

  async claimOutbox(input: {
    commandId: string;
    fingerprint: string;
    leaseOwner: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }): Promise<{ record: CalendarProviderOutboxRecord; claimed: boolean }> {
    const result = await this.pool.query<ProviderOutboxRow>(
      `UPDATE calendar_provider_outbox SET
         status = 'processing', attempts = attempts + 1, updated_at = $4,
         last_attempt_at = $4, next_attempt_at = NULL, lease_owner = $3,
         lease_expires_at = $5, last_error_code = NULL
       WHERE command_id = $1 AND fingerprint = $2
         AND status IN ('pending', 'processing')
         AND (status <> 'processing' OR lease_expires_at IS NULL OR lease_expires_at <= $4::timestamptz)
         AND (next_attempt_at IS NULL OR next_attempt_at <= $4::timestamptz)
       RETURNING *`,
      [input.commandId, input.fingerprint, input.leaseOwner, input.claimedAt, input.leaseExpiresAt]
    );
    if (result.rows[0]) return { record: mapOutbox(result.rows[0]), claimed: true };
    const current = await this.getOutbox(input.commandId);
    if (!current) throw new Error("The outbox command must be reserved before it is claimed.");
    return { record: current, claimed: false };
  }

  async saveOutbox(record: CalendarProviderOutboxRecord, expectedLeaseOwner: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE calendar_provider_outbox SET
         fingerprint = $2, command = $3::jsonb, status = $4, attempts = $5,
         created_at = $6, updated_at = $7, last_attempt_at = $8,
         next_attempt_at = $9, lease_owner = $10, lease_expires_at = $11,
         last_error_code = $12, result = $13::jsonb, conflict_revision = $14, dispatch_evidence = $16::jsonb
       WHERE command_id = $1 AND status = 'processing' AND lease_owner = $15`,
      [record.commandId, record.fingerprint, JSON.stringify(record.command), record.status, record.attempts,
        record.createdAt, record.updatedAt, record.lastAttemptAt, record.nextAttemptAt, record.leaseOwner,
        record.leaseExpiresAt, record.lastErrorCode, jsonOrNull(record.result), record.conflictRevision, expectedLeaseOwner, jsonOrNull(record.dispatchEvidence)]
    );
    return result.rowCount === 1;
  }

  async getOutbox(commandId: string): Promise<CalendarProviderOutboxRecord | null> {
    const result = await this.pool.query<ProviderOutboxRow>(
      "SELECT * FROM calendar_provider_outbox WHERE command_id = $1",
      [commandId]
    );
    return result.rows[0] ? mapOutbox(result.rows[0]) : null;
  }

  async reserveWebhookHint(hint: CalendarProviderWebhookHint): Promise<{ hint: CalendarProviderWebhookHint; created: boolean }> {
    const insert = await this.pool.query(
      `INSERT INTO calendar_provider_webhook_hints (
         hint_id, owner_id, connection_id, provider_account_id,
         provider_calendar_id, received_at, status, reconciled_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (hint_id) DO NOTHING RETURNING hint_id`,
      webhookValues(hint)
    );
    const stored = await this.getWebhookHint(hint.hintId);
    if (!stored) throw new Error("The provider webhook hint reservation was not readable after insertion.");
    return { hint: stored, created: insert.rowCount === 1 };
  }

  async saveWebhookHint(hint: CalendarProviderWebhookHint): Promise<void> {
    const result = await this.pool.query(
      `UPDATE calendar_provider_webhook_hints SET
         provider_calendar_id = $5, received_at = $6, status = $7, reconciled_at = $8
       WHERE hint_id = $1 AND owner_id = $2 AND connection_id = $3 AND provider_account_id = $4`,
      webhookValues(hint)
    );
    assertOwnedWrite(result.rowCount, "The webhook hint identity does not match its owner or provider account.");
  }

  async getWebhookHint(hintId: string): Promise<CalendarProviderWebhookHint | null> {
    const result = await this.pool.query<ProviderWebhookRow>(
      "SELECT * FROM calendar_provider_webhook_hints WHERE hint_id = $1",
      [hintId]
    );
    return result.rows[0] ? mapWebhook(result.rows[0]) : null;
  }

  async purgeConnectionProjections(connectionId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      // The immutable history trigger permits only this explicitly scoped,
      // transaction-local privacy purge path.
      await client.query("SELECT set_config('life_links.allow_calendar_delete', 'on', true)");
      await client.query("DELETE FROM calendar_provider_event_projection_revisions WHERE connection_id = $1", [connectionId]);
      await client.query("DELETE FROM calendar_provider_event_tombstone_history WHERE connection_id = $1", [connectionId]);
      await client.query("DELETE FROM calendar_provider_event_projections WHERE connection_id = $1", [connectionId]);
      await client.query("DELETE FROM calendar_provider_event_tombstones WHERE connection_id = $1", [connectionId]);
      await client.query("DELETE FROM calendar_provider_sync_states WHERE connection_id = $1", [connectionId]);
    });
  }

  private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function lockBinding(client: PoolClient, connectionId: string, calendarId: string): Promise<BindingIdentity> {
  const result = await client.query<ProviderBindingRow>(
    `SELECT b.* FROM calendar_provider_bindings b
     JOIN calendar_provider_connections c ON c.connection_id=b.connection_id
     WHERE b.connection_id = $1 AND b.calendar_id = $2 AND c.status IN ('active','provisioning') FOR UPDATE OF c,b`,
    [connectionId, calendarId]
  );
  const row = result.rows[0];
  if (!row) throw new CalendarProviderGatewayError("calendar_not_found", "The exact provider Calendar binding was not found.");
  return {
    ownerId: row.owner_id,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    providerCalendarId: row.provider_calendar_id
  };
}

function assertSyncIdentity(mutation: CalendarProviderSyncMutation, identity: BindingIdentity): void {
  if (mutation.state.connectionId !== mutation.connectionId || mutation.state.calendarId !== mutation.calendarId) {
    throw new CalendarProviderGatewayError("invalid_input", "The synchronization state identity does not match its mutation.");
  }
  for (const item of [...mutation.upserts, ...mutation.tombstones]) {
    if (item.connectionId !== mutation.connectionId || item.calendarId !== mutation.calendarId
      || item.ownerId !== identity.ownerId || item.providerKey !== identity.providerKey
      || item.providerAccountId !== identity.providerAccountId || item.providerCalendarId !== identity.providerCalendarId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "A provider event mutation does not match its canonical Calendar binding.");
    }
  }
}

function syncStateEquals(left: CalendarProviderSyncState | null, right: CalendarProviderSyncState | null): boolean {
  if (left === null || right === null) return left === right;
  return left.connectionId === right.connectionId
    && left.calendarId === right.calendarId
    && left.syncCursor === right.syncCursor
    && left.lastReconciledAt === right.lastReconciledAt
    && left.lastRecoveryAt === right.lastRecoveryAt;
}

function mapConnection(row: ProviderConnectionRow): CalendarProviderConnectionRecord {
  return {
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    status: row.status,
    credentialHandle: row.credential_handle === null ? null : calendarProviderCredentialHandle(row.credential_handle),
    connectedAt: iso(row.connected_at),
    disconnectedAt: nullableIso(row.disconnected_at),
    remoteRevocationStatus: row.remote_revocation_status,
    remoteRevocationAttemptedAt: nullableIso(row.remote_revocation_attempted_at),
    remoteRevocationErrorCode: row.remote_revocation_error_code
  };
}

function mapBinding(row: ProviderBindingRow): CalendarProviderBindingRecord {
  return {
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    calendarId: row.calendar_id,
    providerCalendarId: row.provider_calendar_id,
    providerDisplayName: row.provider_display_name,
    capabilities: { ...row.capabilities },
    agentGrant: row.agent_grant,
    visible: row.visible
  };
}

function mapCanonicalCalendar(row: CanonicalCalendarRow): CalendarRecord {
  return {
    id: row.id, ownerId: row.owner_id, title: row.title, color: row.color, timeZone: row.time_zone,
    source: row.source, isDefault: row.is_default, agentAccess: row.agent_access,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), deletedAt: nullableIso(row.deleted_at)
  };
}

function mapSyncState(row: ProviderSyncRow): CalendarProviderSyncState {
  return {
    connectionId: row.connection_id,
    calendarId: row.calendar_id,
    syncCursor: row.sync_cursor,
    lastReconciledAt: nullableIso(row.last_reconciled_at),
    lastRecoveryAt: nullableIso(row.last_recovery_at)
  };
}

function mapProjection(row: ProviderProjectionRow): CalendarProviderEventProjection {
  return {
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    calendarId: row.calendar_id,
    providerCalendarId: row.provider_calendar_id,
    providerEventId: row.provider_event_id,
    providerRevision: row.provider_revision,
    content: structuredClone(row.content),
    synchronizedAt: iso(row.synchronized_at)
  };
}

function mapTombstone(row: ProviderTombstoneRow): CalendarProviderEventTombstone {
  return {
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    calendarId: row.calendar_id,
    providerCalendarId: row.provider_calendar_id,
    providerEventId: row.provider_event_id,
    deletedProviderRevision: row.deleted_provider_revision,
    deletedAt: iso(row.deleted_at),
    cause: row.cause
  };
}

function mapOutbox(row: ProviderOutboxRow): CalendarProviderOutboxRecord {
  return {
    commandId: row.command_id,
    fingerprint: row.fingerprint,
    command: structuredClone(row.command),
    status: row.status,
    attempts: row.attempts,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastAttemptAt: nullableIso(row.last_attempt_at),
    nextAttemptAt: nullableIso(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    lastErrorCode: row.last_error_code,
    result: row.result === null ? null : structuredClone(row.result),
    conflictRevision: row.conflict_revision,
    dispatchEvidence: row.dispatch_evidence ? structuredClone(row.dispatch_evidence) : null
  };
}

function mapWebhook(row: ProviderWebhookRow): CalendarProviderWebhookHint {
  return {
    hintId: row.hint_id,
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerAccountId: row.provider_account_id,
    providerCalendarId: row.provider_calendar_id,
    receivedAt: iso(row.received_at),
    status: row.status,
    reconciledAt: nullableIso(row.reconciled_at)
  };
}

function bindingValues(binding: CalendarProviderBindingRecord): unknown[] {
  return [
    binding.connectionId,
    binding.ownerId,
    binding.providerKey,
    binding.providerAccountId,
    binding.calendarId,
    binding.providerCalendarId,
    binding.providerDisplayName,
    JSON.stringify(binding.capabilities),
    binding.visible
  ];
}

function outboxValues(record: CalendarProviderOutboxRecord): unknown[] {
  return [
    record.commandId,
    record.command.ownerId,
    record.command.connectionId,
    record.command.calendarId,
    record.fingerprint,
    JSON.stringify(record.command),
    record.status,
    record.attempts,
    record.createdAt,
    record.updatedAt,
    record.lastAttemptAt,
    record.nextAttemptAt,
    record.leaseOwner,
    record.leaseExpiresAt,
    record.lastErrorCode,
    jsonOrNull(record.result),
    record.conflictRevision,
    jsonOrNull(record.dispatchEvidence)
  ];
}

function webhookValues(hint: CalendarProviderWebhookHint): unknown[] {
  return [hint.hintId, hint.ownerId, hint.connectionId, hint.providerAccountId,
    hint.providerCalendarId, hint.receivedAt, hint.status, hint.reconciledAt];
}

function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function assertOwnedWrite(rowCount: number | null, message: string): void {
  if (rowCount !== 1) throw new CalendarProviderGatewayError("provider_identity_mismatch", message);
}
