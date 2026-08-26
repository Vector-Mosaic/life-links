import fs from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

import type { Logger } from "./logger.js";

export async function runMigrations(pool: Pool, migrationDir: string, logger: Logger): Promise<void> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const files = (await fs.readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (applied.rowCount) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      logger.info("life_links.migration.applied", { file });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
