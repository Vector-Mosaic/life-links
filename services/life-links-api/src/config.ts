import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_QR_BASE_URL } from "@life-links/core";

export type StoreMode = "postgres" | "memory";
export type SeedProfile = "legacy-demo" | "competition";

export type LifeLinksConfig = {
  host: string;
  port: number;
  env: string;
  component: string;
  version: string;
  buildSha: string;
  buildTime: string;
  databaseUrl: string;
  storeMode: StoreMode;
  sessionSecret: string;
  sessionTtlDays: number;
  secureCookies: boolean;
  qrBaseUrl: string;
  staticDistPath: string;
  migrationDir: string;
  autoMigrate: boolean;
  autoSeed: boolean;
  seedProfile: SeedProfile;
  seedPassword: string;
  trustProxy: boolean;
  securityHeadersEnabled: boolean;
  hstsEnabled: boolean;
  originCheckEnabled: boolean;
  originCheckAllowMissing: boolean;
  allowedOrigins: string[];
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitLoginMax: number;
  rateLimitPublicMax: number;
  rateLimitMutationMax: number;
  rateLimitClaimMax: number;
  rateLimitBatchMax: number;
};

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readConfig(env: NodeJS.ProcessEnv = process.env): LifeLinksConfig {
  const databaseUrl = env.DATABASE_URL ?? "";
  const explicitStoreMode = env.LIFE_LINKS_STORE as StoreMode | undefined;
  const storeMode = explicitStoreMode ?? (databaseUrl ? "postgres" : "memory");
  const runtimeEnv = resolveRuntimeEnv(env);
  const productionLike =
    runtimeEnv === "prod" || runtimeEnv === "webmcp-challenge" || env.NODE_ENV === "production";
  const sessionSecret = env.SESSION_SECRET ?? (productionLike ? "" : "life-links-local-session-secret");
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production-like runtimes");
  }
  if (storeMode === "postgres" && !databaseUrl) {
    throw new Error("DATABASE_URL is required when LIFE_LINKS_STORE=postgres");
  }
  const autoSeed = env.AUTO_SEED ? env.AUTO_SEED === "true" : true;
  const seedProfile = resolveSeedProfile(env.LIFE_LINKS_SEED_PROFILE);
  const seedPassword = env.DEMO_SEED_PASSWORD ?? (productionLike ? "" : "local-demo-password-not-for-deployment");
  if (autoSeed && !seedPassword) {
    throw new Error("DEMO_SEED_PASSWORD is required when AUTO_SEED=true in production");
  }
  if (autoSeed && seedProfile === "competition" && storeMode !== "memory") {
    throw new Error("LIFE_LINKS_SEED_PROFILE=competition is allowed only with the disposable in-memory store; use the guarded competition reset for Postgres");
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number(env.PORT ?? "3002"),
    env: runtimeEnv,
    component: "life-links-api",
    version: env.APP_VERSION ?? "0.0.0",
    buildSha: env.BUILD_SHA ?? env.RAILWAY_GIT_COMMIT_SHA ?? "local",
    buildTime: env.BUILD_TIME ?? "unknown",
    databaseUrl,
    storeMode,
    sessionSecret,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? "14"),
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : productionLike,
    qrBaseUrl: env.QR_BASE_URL ?? DEFAULT_QR_BASE_URL,
    staticDistPath:
      env.STATIC_DIST_PATH ?? path.resolve(serviceRoot, "../../apps/life-links-demo/dist"),
    migrationDir: env.MIGRATION_DIR ?? path.resolve(serviceRoot, "migrations"),
    autoMigrate: env.AUTO_MIGRATE ? env.AUTO_MIGRATE === "true" : true,
    autoSeed,
    seedProfile,
    seedPassword,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY !== "false" : productionLike,
    securityHeadersEnabled: env.SECURITY_HEADERS_ENABLED ? env.SECURITY_HEADERS_ENABLED !== "false" : true,
    hstsEnabled: env.HSTS_ENABLED ? env.HSTS_ENABLED === "true" : productionLike,
    originCheckEnabled: env.ORIGIN_CHECK_ENABLED ? env.ORIGIN_CHECK_ENABLED === "true" : productionLike,
    originCheckAllowMissing: env.ORIGIN_CHECK_ALLOW_MISSING === "true",
    allowedOrigins: resolveAllowedOrigins(env.ALLOWED_ORIGINS, env.QR_BASE_URL ?? DEFAULT_QR_BASE_URL),
    rateLimitEnabled: env.RATE_LIMIT_ENABLED ? env.RATE_LIMIT_ENABLED !== "false" : true,
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? "60000"),
    rateLimitLoginMax: Number(env.RATE_LIMIT_LOGIN_MAX ?? "8"),
    rateLimitPublicMax: Number(env.RATE_LIMIT_PUBLIC_MAX ?? "180"),
    rateLimitMutationMax: Number(env.RATE_LIMIT_MUTATION_MAX ?? "90"),
    rateLimitClaimMax: Number(env.RATE_LIMIT_CLAIM_MAX ?? "30"),
    rateLimitBatchMax: Number(env.RATE_LIMIT_BATCH_MAX ?? "12")
  };
}

function resolveSeedProfile(value: string | undefined): SeedProfile {
  const normalized = (value ?? "legacy-demo").trim().toLowerCase();
  if (normalized === "legacy-demo" || normalized === "competition") {
    return normalized;
  }
  throw new Error("LIFE_LINKS_SEED_PROFILE must be legacy-demo or competition");
}

function resolveRuntimeEnv(env: NodeJS.ProcessEnv): string {
  const value = env.APP_ENV ?? env.LIFE_LINKS_ENV ?? env.RAILWAY_ENVIRONMENT ?? env.NODE_ENV ?? (env.CI ? "ci" : "local");
  if (value === "production") {
    return "prod";
  }
  if (value === "test") {
    return "ci";
  }
  return value;
}

function resolveAllowedOrigins(raw: string | undefined, qrBaseUrl: string): string[] {
  const configured = (raw ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter(Boolean);
  const origins = new Set(configured);
  try {
    origins.add(new URL(qrBaseUrl).origin);
  } catch {
    origins.add(DEFAULT_QR_BASE_URL);
  }
  origins.add("http://127.0.0.1:3002");
  origins.add("http://localhost:3002");
  origins.add("http://127.0.0.1:5174");
  origins.add("http://localhost:5174");
  return Array.from(origins);
}

function normalizeOrigin(value: string): string {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}
