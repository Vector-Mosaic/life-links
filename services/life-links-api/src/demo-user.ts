import { createHash } from "node:crypto";

import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { hashPassword } from "./password.js";
import { createPostgresStore } from "./postgres-store.js";

async function main() {
  const config = readConfig({ ...process.env, LIFE_LINKS_STORE: "postgres" });
  const logger = createLogger("life_links_demo_user", { env: config.env });
  const email = normalizeEmail(process.env.LIFE_LINKS_DEMO_USER_EMAIL);
  const password = process.env.LIFE_LINKS_DEMO_USER_PASSWORD ?? "";
  const displayName = normalizeDisplayName(process.env.LIFE_LINKS_DEMO_USER_DISPLAY_NAME, email);

  if (!email) {
    throw new Error("LIFE_LINKS_DEMO_USER_EMAIL is required");
  }
  if (!password) {
    throw new Error("LIFE_LINKS_DEMO_USER_PASSWORD is required");
  }
  if (password.length > 1024) {
    throw new Error("LIFE_LINKS_DEMO_USER_PASSWORD is too long");
  }

  const { pool } = createPostgresStore(config.databaseUrl);
  try {
    const passwordHash = await hashPassword(password);
    const existing = await pool.query("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
    const existingId = existing.rows[0]?.id ? String(existing.rows[0].id) : null;
    const userId = existingId ?? `demo-user-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;
    if (existingId) {
      await pool.query("UPDATE users SET email = $2, display_name = $3, password_hash = $4 WHERE id = $1", [
        userId,
        email,
        displayName,
        passwordHash
      ]);
    } else {
      await pool.query(
        "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
        [userId, email, displayName, passwordHash, new Date().toISOString()]
      );
    }
    logger.info("life_links.demo_user.upserted", {
      msg: "Demo user upserted",
      user_id: userId,
      email_hash: createHash("sha256").update(email).digest("hex").slice(0, 16),
      created: !existingId
    });
  } finally {
    await pool.end();
  }
}

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeDisplayName(value: string | undefined, email: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed) {
    return trimmed.slice(0, 120);
  }
  const localPart = email.split("@")[0] || "Demo User";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 120);
}

main().catch((error) => {
  createLogger("life_links_demo_user").fatal("life_links.demo_user.failed", {
    msg: "Demo user upsert failed",
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
