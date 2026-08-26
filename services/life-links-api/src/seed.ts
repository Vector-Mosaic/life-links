import { readConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createPostgresStore } from "./postgres-store.js";

async function main() {
  const config = readConfig({ ...process.env, LIFE_LINKS_STORE: "postgres" });
  const logger = createLogger("life_links_seed", { env: config.env });
  const { store } = createPostgresStore(config.databaseUrl);
  try {
    await store.seedDemo(config.seedPassword, config.qrBaseUrl);
    logger.info("life_links.seed.completed", {
      msg: "Life Links seed completed",
      qr_base_url: config.qrBaseUrl
    });
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  createLogger("life_links_seed").fatal("life_links.seed.failed", {
    msg: "Life Links seed failed",
    error_message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
