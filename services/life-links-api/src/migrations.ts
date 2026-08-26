import fs from "node:fs/promises";
import path from "node:path";

import type { Pool } from "pg";

import type { Logger } from "./logger.js";

export async function runMigrations(pool: Pool, migrationDir: string, logger: Logger): Promise<void> {
  const bootstrap = await pool.connect();
  try {
    await bootstrap.query("BEGIN");
    await bootstrap.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["life-links-migration:bootstrap"]);
    await bootstrap.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    await bootstrap.query("COMMIT");
  } catch (error) {
    await bootstrap.query("ROLLBACK");
    throw error;
  } finally {
    bootstrap.release();
  }
  const files = (await fs.readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    const client = await pool.connect();
    let appliedNow = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`life-links-migration:${file}`]);
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
      if (applied.rowCount) {
        await client.query("COMMIT");
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      appliedNow = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (appliedNow) {
      logger.info("life_links.migration.applied", { file });
    }
  }
}
