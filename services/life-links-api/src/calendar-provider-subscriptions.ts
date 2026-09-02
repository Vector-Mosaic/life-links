import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, json, type ErrorRequestHandler } from "express";
import type { Pool } from "pg";
import { ProviderTransientError, type CalendarProviderCredentialHandle, type CalendarProviderGateway,
  type CalendarProviderWindow } from "./calendar-provider-gateway.js";
import { MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY, type MicrosoftGraphCalendarProviderAdapter,
  type MicrosoftCalendarSubscription } from "./calendar-provider-microsoft.js";

export type CalendarProviderSubscriptionRecord = {
  connectionId: string; ownerId: string; credentialHandle: CalendarProviderCredentialHandle;
  key: string; providerSubscriptionId: string | null; clientStateHash: string; notificationUrl: string;
  expiresAt: string; renewalRequired: boolean; hintVersion: number; handledHintVersion: number;
};
export interface CalendarProviderSubscriptionStore {
  withConnectionLock<T>(connectionId: string, action: () => Promise<T>): Promise<T>;
  get(connectionId: string): Promise<CalendarProviderSubscriptionRecord | null>;
  getByKey(key: string): Promise<CalendarProviderSubscriptionRecord | null>;
  save(record: CalendarProviderSubscriptionRecord): Promise<void>;
  delete(connectionId: string): Promise<void>;
  markHint(key: string, renewalRequired: boolean): Promise<void>;
  listHinted(limit: number): Promise<CalendarProviderSubscriptionRecord[]>;
  acknowledgeHints(key: string, version: number): Promise<void>;
}
type SubscriptionAdapter = Pick<MicrosoftGraphCalendarProviderAdapter,
  "listSubscriptions" | "createSubscription" | "renewSubscription" | "deleteSubscription">;
type CleanupInput = { ownerId: string; connectionId: string; credentialHandle: CalendarProviderCredentialHandle; providerAccountId: string;
  replacementCredentialHandle?: CalendarProviderCredentialHandle };

/** One mailbox subscription is a wake-up hint for selected bindings, not event authority. */
export class CalendarProviderSubscriptionService {
  readonly #now: () => Date;
  readonly #url: string;
  constructor(private readonly options: {
    gateway: CalendarProviderGateway; adapter: SubscriptionAdapter; store: CalendarProviderSubscriptionStore;
    notificationUrl: string; now?: () => Date;
  }) {
    const url = new URL(options.notificationUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.pathname !== "/api/calendar-notifications/microsoft") throw new Error("Invalid Calendar notification endpoint.");
    this.#url = url.toString();
    this.#now = options.now ?? (() => new Date());
  }

  async ensureConnection(connectionId: string): Promise<void> {
    await this.options.store.withConnectionLock(connectionId, async () => {
      const connection = await this.options.gateway.store.getConnection(connectionId);
      if (!connection || connection.status !== "active" || !connection.credentialHandle
        || connection.providerKey !== MICROSOFT_GRAPH_CALENDAR_PROVIDER_KEY) return;
      const input = { ownerId: connection.ownerId, connectionId, credentialHandle: connection.credentialHandle,
        providerAccountId: connection.providerAccountId };
      let record = await this.options.store.get(connectionId);
      if (record && record.credentialHandle !== connection.credentialHandle) {
        throw new ProviderTransientError("An earlier Calendar subscription must finish disconnecting first.");
      }
      const now = this.#now().getTime();
      if (record && Date.parse(record.expiresAt) <= now) {
        // Expired unknown creations cannot acquire authority later. A known ID
        // is still deleted explicitly; a 404 is an idempotent success.
        if (record.providerSubscriptionId) await this.options.adapter.deleteSubscription({ ...input, subscriptionId: record.providerSubscriptionId });
        await this.options.store.delete(connectionId);
        record = null;
      }
      if (record && !record.providerSubscriptionId) {
        const found = await this.#findExact(input, record);
        if (!found) return; // Uncertain POST: polling still works; never duplicate blindly.
        record = { ...record, providerSubscriptionId: found.id, expiresAt: found.expiresAt };
        await this.options.store.save(record);
      }
      if (record) {
        if (record.renewalRequired || Date.parse(record.expiresAt) - now < 24 * 3_600_000) {
          // Retain the latest possible provider expiry before dispatch. If the
          // PATCH succeeds but its reply is lost, disconnect may not assume the
          // old expiry is the end of the remote subscription.
          record = { ...record, expiresAt: this.#expiration(), renewalRequired: true };
          await this.options.store.save(record);
          const renewed = await this.options.adapter.renewSubscription({ ...input,
            subscriptionId: record.providerSubscriptionId!, expiresAt: record.expiresAt });
          if (!renewed) { await this.options.store.delete(connectionId); return; }
          this.#assertExact(renewed, input.providerAccountId, record);
          await this.options.store.save({ ...record, expiresAt: renewed.expiresAt, renewalRequired: false });
        }
        return;
      }
      const clientState = randomBytes(32).toString("base64url");
      const key = randomUUID();
      const url = new URL(this.#url); url.searchParams.set("subscriptionKey", key);
      record = { ownerId: input.ownerId, connectionId, credentialHandle: input.credentialHandle, key,
        providerSubscriptionId: null, clientStateHash: digest(clientState), notificationUrl: url.toString(),
        expiresAt: this.#expiration(), renewalRequired: false, hintVersion: 0, handledHintVersion: 0 };
      // Save identity and nonce hash before Graph. A lost response is recovered
      // by this exact unique URL/resource/creator, not by another create.
      await this.options.store.save(record);
      const current = await this.options.gateway.store.getConnection(connectionId);
      if (current?.status !== "active" || current.credentialHandle !== input.credentialHandle) {
        await this.options.store.delete(connectionId); return;
      }
      const created = await this.options.adapter.createSubscription({ ...input, notificationUrl: record.notificationUrl,
        clientState, expiresAt: record.expiresAt });
      this.#assertExact(created, input.providerAccountId, record);
      await this.options.store.save({ ...record, providerSubscriptionId: created.id, expiresAt: created.expiresAt });
      // A concurrent disconnect closes access first and waits for this lock
      // before removing the credential, so its cleanup sees the exact ID.
    });
  }

  async cleanupConnection(input: CleanupInput): Promise<void> {
    await this.options.store.withConnectionLock(input.connectionId, async () => {
      const record = await this.options.store.get(input.connectionId);
      if (!record) return;
      if (record.ownerId !== input.ownerId || record.credentialHandle !== input.credentialHandle) {
        throw new ProviderTransientError("Calendar subscription ownership changed before cleanup.");
      }
      let id = record.providerSubscriptionId;
      const authorizedInput = { ...input, credentialHandle: input.replacementCredentialHandle ?? input.credentialHandle };
      if (Date.parse(record.expiresAt) <= this.#now().getTime()) {
        await this.options.store.delete(input.connectionId); return;
      }
      if (!id && Date.parse(record.expiresAt) > this.#now().getTime()) {
        id = (await this.#findExact(authorizedInput, record))?.id ?? null;
        if (!id) throw new ProviderTransientError("Calendar subscription creation remains uncertain; cleanup will retry.");
      }
      if (id) await this.options.adapter.deleteSubscription({ ...authorizedInput, subscriptionId: id });
      await this.options.store.delete(input.connectionId);
    });
  }

  async acceptNotifications(key: string, body: unknown): Promise<number> {
    if (!validKey(key) || !isRecord(body) || !Array.isArray(body.value) || body.value.length > 100) {
      throw new CalendarNotificationInputError();
    }
    const record = await this.options.store.getByKey(key);
    if (!record || Date.parse(record.expiresAt) <= this.#now().getTime()) return 0;
    const connection = await this.options.gateway.store.getConnection(record.connectionId);
    if (!connection || connection.ownerId !== record.ownerId || connection.status !== "active"
      || connection.credentialHandle !== record.credentialHandle) return 0;
    let accepted = 0; let renew = false;
    for (const notice of body.value) {
      if (!isRecord(notice) || typeof notice.subscriptionId !== "string" || notice.subscriptionId.length > 512
        || typeof notice.clientState !== "string" || notice.clientState.length > 128
        || (record.providerSubscriptionId && notice.subscriptionId !== record.providerSubscriptionId)
        || !equalHash(record.clientStateHash, digest(notice.clientState))) continue;
      if (!["created", "updated", "deleted"].includes(String(notice.changeType))
        && !["reauthorizationRequired", "subscriptionRemoved", "missed"].includes(String(notice.lifecycleEvent))) continue;
      renew ||= notice.lifecycleEvent === "reauthorizationRequired" || notice.lifecycleEvent === "subscriptionRemoved";
      accepted++;
    }
    if (accepted) await this.options.store.markHint(record.key, renew);
    return accepted;
  }

  async reconcileHints(window: CalendarProviderWindow, limit = 20): Promise<number> {
    let reconciled = 0;
    for (const record of await this.options.store.listHinted(Math.min(Math.max(limit, 1), 20))) {
      const connection = await this.options.gateway.store.getConnection(record.connectionId);
      if (!connection || connection.status !== "active" || connection.credentialHandle !== record.credentialHandle) continue;
      await this.ensureConnection(connection.connectionId);
      for (const calendar of await this.options.gateway.listCalendars(connection.ownerId, connection.connectionId)) {
        await this.options.gateway.synchronizeCalendar({ ownerId: connection.ownerId, connectionId: connection.connectionId,
          calendarId: calendar.calendarId, window });
      }
      await this.options.store.acknowledgeHints(record.key, record.hintVersion);
      reconciled++;
    }
    return reconciled;
  }

  #expiration() { return new Date(this.#now().getTime() + 3 * 86_400_000).toISOString(); }
  async #findExact(input: CleanupInput, record: CalendarProviderSubscriptionRecord) {
    const matches = (await this.options.adapter.listSubscriptions(input)).filter((item) =>
      item.notificationUrl === record.notificationUrl && item.resource.replace(/^\//, "") === resource(input.providerAccountId)
      && item.creatorId === input.providerAccountId);
    if (matches.length > 1) throw new ProviderTransientError("Calendar subscription identity is ambiguous.");
    return matches[0] ?? null;
  }
  #assertExact(subscription: MicrosoftCalendarSubscription, accountId: string, record: CalendarProviderSubscriptionRecord) {
    if (subscription.notificationUrl !== record.notificationUrl || subscription.resource.replace(/^\//, "") !== resource(accountId)
      || subscription.creatorId !== accountId || !Number.isFinite(Date.parse(subscription.expiresAt))) {
      throw new ProviderTransientError("Calendar subscription did not match its exact account binding.");
    }
  }
}

export function createCalendarProviderNotificationRouter(service: CalendarProviderSubscriptionService, wake: () => void): Router {
  const router = Router();
  router.post("/api/calendar-notifications/microsoft", json({ limit: "256kb" }), async (request, response) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Content-Type-Options", "nosniff");
    const validation = request.query.validationToken;
    if (validation !== undefined) {
      if (typeof validation !== "string" || !validation || validation.length > 2_048) { response.sendStatus(400); return; }
      response.status(200).type("text/plain").send(validation); return;
    }
    try {
      const accepted = await service.acceptNotifications(typeof request.query.subscriptionKey === "string" ? request.query.subscriptionKey : "", request.body);
      if (accepted) wake();
      response.sendStatus(202);
    } catch (error) {
      response.sendStatus(error instanceof CalendarNotificationInputError ? 400 : 503);
    }
  });
  const parseError: ErrorRequestHandler = (error, _request, response, _next) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendStatus(error?.type === "entity.too.large" ? 413 : 400);
  };
  router.use(parseError);
  return router;
}

export class InMemoryCalendarProviderSubscriptionStore implements CalendarProviderSubscriptionStore {
  readonly records = new Map<string, CalendarProviderSubscriptionRecord>();
  readonly #flights = new Map<string, Promise<unknown>>();
  async withConnectionLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#flights.get(id) ?? Promise.resolve();
    const flight = previous.catch(() => undefined).then(action); this.#flights.set(id, flight);
    try { return await flight; } finally { if (this.#flights.get(id) === flight) this.#flights.delete(id); }
  }
  async get(id: string) { const found = this.records.get(id); return found ? { ...found } : null; }
  async getByKey(key: string) { const found = [...this.records.values()].find((item) => item.key === key); return found ? { ...found } : null; }
  async save(record: CalendarProviderSubscriptionRecord) {
    const previous = this.records.get(record.connectionId);
    this.records.set(record.connectionId, { ...record,
      hintVersion: previous?.key === record.key ? Math.max(record.hintVersion, previous.hintVersion) : record.hintVersion,
      renewalRequired: previous?.key === record.key && previous.hintVersion > record.hintVersion
        ? previous.renewalRequired || record.renewalRequired : record.renewalRequired });
  }
  async delete(id: string) { this.records.delete(id); }
  async markHint(key: string, renew: boolean) {
    const record = [...this.records.values()].find((item) => item.key === key);
    if (record) { record.hintVersion++; record.renewalRequired ||= renew; }
  }
  async listHinted(limit: number) { return [...this.records.values()].filter((row) => row.hintVersion > row.handledHintVersion).slice(0, limit).map((row) => ({ ...row })); }
  async acknowledgeHints(key: string, version: number) {
    const record = [...this.records.values()].find((item) => item.key === key);
    if (record) record.handledHintVersion = Math.max(record.handledHintVersion, version);
  }
}

export class PostgresCalendarProviderSubscriptionStore implements CalendarProviderSubscriptionStore {
  constructor(private readonly pool: Pool) {}
  async withConnectionLock<T>(id: string, action: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`calendar-subscription:${id}`]);
      try { return await action(); }
      finally { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`calendar-subscription:${id}`]); }
    } finally { client.release(); }
  }
  async get(id: string) {
    const result = await this.pool.query("SELECT * FROM calendar_provider_subscriptions WHERE connection_id=$1", [id]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
  async getByKey(key: string) {
    const result = await this.pool.query("SELECT * FROM calendar_provider_subscriptions WHERE subscription_key=$1", [key]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
  async save(record: CalendarProviderSubscriptionRecord) {
    await this.pool.query(`INSERT INTO calendar_provider_subscriptions
      (connection_id,owner_id,credential_handle,subscription_key,provider_subscription_id,client_state_hash,notification_url,
       expires_at,renewal_required,hint_version,handled_hint_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(connection_id) DO UPDATE SET
      credential_handle=EXCLUDED.credential_handle,subscription_key=EXCLUDED.subscription_key,
      provider_subscription_id=EXCLUDED.provider_subscription_id,client_state_hash=EXCLUDED.client_state_hash,
      notification_url=EXCLUDED.notification_url,expires_at=EXCLUDED.expires_at,
      renewal_required=CASE WHEN calendar_provider_subscriptions.hint_version>EXCLUDED.hint_version
        THEN calendar_provider_subscriptions.renewal_required OR EXCLUDED.renewal_required ELSE EXCLUDED.renewal_required END,
      hint_version=GREATEST(calendar_provider_subscriptions.hint_version,EXCLUDED.hint_version),
      handled_hint_version=EXCLUDED.handled_hint_version`, [record.connectionId,record.ownerId,record.credentialHandle,
      record.key,record.providerSubscriptionId,record.clientStateHash,record.notificationUrl,record.expiresAt,
      record.renewalRequired,record.hintVersion,record.handledHintVersion]);
  }
  async delete(id: string) { await this.pool.query("DELETE FROM calendar_provider_subscriptions WHERE connection_id=$1", [id]); }
  async markHint(key: string, renew: boolean) {
    await this.pool.query(`UPDATE calendar_provider_subscriptions SET hint_version=hint_version+1,
      renewal_required=renewal_required OR $2 WHERE subscription_key=$1`, [key,renew]);
  }
  async listHinted(limit: number) {
    const result = await this.pool.query(`SELECT * FROM calendar_provider_subscriptions
      WHERE hint_version>handled_hint_version ORDER BY connection_id LIMIT $1`, [limit]);
    return result.rows.map(fromRow);
  }
  async acknowledgeHints(key: string, version: number) {
    await this.pool.query(`UPDATE calendar_provider_subscriptions SET handled_hint_version=GREATEST(handled_hint_version,$2)
      WHERE subscription_key=$1`, [key,version]);
  }
}
function fromRow(row: Record<string, unknown>): CalendarProviderSubscriptionRecord {
  return { connectionId: String(row.connection_id), ownerId: String(row.owner_id),
    credentialHandle: String(row.credential_handle) as CalendarProviderCredentialHandle, key: String(row.subscription_key),
    providerSubscriptionId: row.provider_subscription_id === null ? null : String(row.provider_subscription_id),
    clientStateHash: String(row.client_state_hash), notificationUrl: String(row.notification_url),
    expiresAt: new Date(row.expires_at as string | Date).toISOString(), renewalRequired: row.renewal_required === true,
    hintVersion: Number(row.hint_version), handledHintVersion: Number(row.handled_hint_version) };
}
class CalendarNotificationInputError extends Error {}
function resource(accountId: string) { return `users/${encodeURIComponent(accountId)}/events`; }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function equalHash(left: string, right: string) {
  return /^[a-f0-9]{64}$/.test(left) && timingSafeEqual(Buffer.from(left,"hex"),Buffer.from(right,"hex"));
}
function validKey(value: string) { return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
