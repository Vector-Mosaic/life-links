import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export type CalendarSecretRow = {
  id: string;
  ownerId: string;
  purpose: "authorization" | "credential";
  encryptedPayload: string;
  expiresAt: string | null;
};

/** The sole storage port for private authorization state and provider token caches. */
export interface CalendarSecretStore {
  create(row: CalendarSecretRow): Promise<void>;
  locked<T>(id: string, action: (row: CalendarSecretRow | null) => Promise<{ row: CalendarSecretRow | null; value: T }>): Promise<T>;
  deleteExpired(now: string): Promise<void>;
}

export class CalendarSecretCipher {
  readonly #key: Buffer;
  constructor(keyBase64: string, private readonly namespace = "life-links-calendar-v1") {
    this.#key = Buffer.from(keyBase64, "base64");
    if (this.#key.length !== 32 || this.#key.toString("base64") !== keyBase64) {
      throw new Error("Calendar credential encryption requires an exact base64 256-bit key.");
    }
  }
  seal(row: Pick<CalendarSecretRow, "id" | "ownerId" | "purpose">, payload: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(this.#aad(row));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }
  open<T>(row: CalendarSecretRow): T {
    try {
      const [version, iv, tag, bytes, extra] = row.encryptedPayload.split(".");
      if (version !== "v1" || !iv || !tag || !bytes || extra) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64url"));
      decipher.setAAD(this.#aad(row));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8")) as T;
    } catch {
      throw new Error("Calendar credential record is unavailable.");
    }
  }
  #aad(row: Pick<CalendarSecretRow, "id" | "ownerId" | "purpose">) {
    return Buffer.from(JSON.stringify([this.namespace, row.id, row.ownerId, row.purpose]));
  }
}

export class PostgresCalendarSecretStore implements CalendarSecretStore {
  constructor(private readonly pool: Pool) {}
  async create(row: CalendarSecretRow): Promise<void> {
    await this.pool.query(`INSERT INTO calendar_provider_secrets
      (id,owner_id,purpose,encrypted_payload,expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [row.id, row.ownerId, row.purpose, row.encryptedPayload, row.expiresAt]);
  }
  async locked<T>(id: string, action: (row: CalendarSecretRow | null) => Promise<{ row: CalendarSecretRow | null; value: T }>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM calendar_provider_secrets WHERE id=$1 FOR UPDATE", [id]);
      const record = result.rows[0];
      const current: CalendarSecretRow | null = record ? {
        id: record.id, ownerId: record.owner_id, purpose: record.purpose,
        encryptedPayload: record.encrypted_payload,
        expiresAt: record.expires_at ? new Date(record.expires_at).toISOString() : null
      } : null;
      const outcome = await action(current);
      if (outcome.row && (!current || outcome.row.id !== current.id || outcome.row.ownerId !== current.ownerId || outcome.row.purpose !== current.purpose)) {
        throw new Error("Calendar secret identity cannot change.");
      }
      if (current && !outcome.row) await client.query("DELETE FROM calendar_provider_secrets WHERE id=$1", [id]);
      else if (outcome.row) await client.query(`UPDATE calendar_provider_secrets
        SET encrypted_payload=$2, expires_at=$3, updated_at=now() WHERE id=$1`,
      [id, outcome.row.encryptedPayload, outcome.row.expiresAt]);
      await client.query("COMMIT");
      return outcome.value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async deleteExpired(now: string): Promise<void> {
    await this.pool.query("DELETE FROM calendar_provider_secrets WHERE expires_at < $1", [now]);
  }
}

export class InMemoryCalendarSecretStore implements CalendarSecretStore {
  readonly rows = new Map<string, CalendarSecretRow>();
  readonly #locks = new Map<string, Promise<void>>();
  async create(row: CalendarSecretRow): Promise<void> {
    if (this.rows.has(row.id)) throw new Error("Calendar secret already exists.");
    this.rows.set(row.id, structuredClone(row));
  }
  async locked<T>(id: string, action: (row: CalendarSecretRow | null) => Promise<{ row: CalendarSecretRow | null; value: T }>): Promise<T> {
    const previous = this.#locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => lock);
    this.#locks.set(id, queued);
    await previous;
    try {
      const current = this.rows.get(id) ?? null;
      const outcome = await action(current ? structuredClone(current) : null);
      if (outcome.row && (!current || outcome.row.id !== id || outcome.row.ownerId !== current.ownerId || outcome.row.purpose !== current.purpose)) {
        throw new Error("Calendar secret identity cannot change.");
      }
      if (outcome.row) this.rows.set(id, structuredClone(outcome.row));
      else this.rows.delete(id);
      return outcome.value;
    } finally {
      release();
      if (this.#locks.get(id) === queued) this.#locks.delete(id);
    }
  }
  async deleteExpired(now: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.expiresAt && row.expiresAt < now) await this.locked(id, async (current) => ({ row: current?.expiresAt && current.expiresAt < now ? null : current, value: undefined }));
    }
  }
}
