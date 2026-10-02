import type { AgentCommunicationsVerificationEmailConfig } from "@vmosaic/provider-sign-in/email";
import type { TelnyxVerificationSmsConfig } from "@vmosaic/provider-sign-in/phone";
import type { StoreMode } from "./config.js";

export type ContactVerificationConfig = {
  email?: {
    sender: AgentCommunicationsVerificationEmailConfig;
    maxSendsPerDay: number;
    maxSendsPerMonth: number;
  };
  phone?: {
    sender: TelnyxVerificationSmsConfig;
    /** Durable phone-credential key; replacement requires its explicit migration. */
    credentialSecret: string;
    allowedRegions: ("US" | "CA")[];
    maxSendsPerDay: number;
    maxSendsPerMonth: number;
    /** Reviewed maximum total SMS delivery cost, including all parts and carrier fees. */
    maxCostPerSmsUsd: number;
    maxSpendPerDayUsd: number;
    maxSpendPerMonthUsd: number;
  };
};

type VerificationRuntime = {
  storeMode: StoreMode;
  secureCookies: boolean;
  publicOrigin: string;
};

type Channel = "Email" | "Phone";

function invalid(channel: Channel): never {
  // Never include environment values, credentials or provider responses in errors.
  throw new Error(`${channel} verification configuration is incomplete or invalid.`);
}

function required(env: NodeJS.ProcessEnv, name: string, channel: Channel, maximum: number): string {
  const value = env[name];
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) invalid(channel);
  return value;
}

function sendLimit(env: NodeJS.ProcessEnv, name: string, channel: Channel, maximum: number): number {
  const value = required(env, name, channel, 12);
  if (!/^[1-9]\d*$/u.test(value)) invalid(channel);
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > maximum) invalid(channel);
  return limit;
}

function dollarLimit(env: NodeJS.ProcessEnv, name: string, maximum: number): { usd: number; microUsd: number } {
  const value = required(env, name, "Phone", 17);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) invalid("Phone");
  const [whole, fraction = ""] = value.split(".");
  // Exact microdollars retain low international tariffs without floating-point quota drift.
  const microUsd = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(microUsd) || microUsd <= 0 || microUsd > maximum * 1_000_000) invalid("Phone");
  return { usd: Number(value), microUsd };
}

function requireDurableSecureRuntime(runtime: VerificationRuntime): void {
  let origin: URL;
  try { origin = new URL(runtime.publicOrigin); } catch {
    throw new Error("Contact verification requires the exact application HTTPS origin.");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash || origin.hostname.endsWith(".") || runtime.publicOrigin !== origin.origin) {
    throw new Error("Contact verification requires the exact application HTTPS origin.");
  }
  if (runtime.storeMode !== "postgres" || runtime.secureCookies !== true) {
    throw new Error("Contact verification requires durable PostgreSQL storage and secure cookies.");
  }
}

function readEmail(env: NodeJS.ProcessEnv): NonNullable<ContactVerificationConfig["email"]> {
  const prefix = "LIFE_LINKS_EMAIL_VERIFICATION";
  const gatewayBaseUrl = required(env, `${prefix}_GATEWAY_BASE_URL`, "Email", 2048);
  const bearerToken = required(env, `${prefix}_GATEWAY_BEARER_TOKEN`, "Email", 4096);
  const senderMailbox = required(env, `${prefix}_SENDER_MAILBOX`, "Email", 254);
  const appDisplayName = env[`${prefix}_APP_DISPLAY_NAME`] ?? "LifeLinks";
  let gatewayOrigin: URL;
  try { gatewayOrigin = new URL(gatewayBaseUrl); } catch { invalid("Email"); }
  // This production connection has no caller-selected path or credential URL.
  // Shared delivery owns the fixed mail endpoint and refuses redirects.
  if (gatewayOrigin.protocol !== "https:" || gatewayOrigin.username || gatewayOrigin.password
    || gatewayOrigin.pathname !== "/" || gatewayOrigin.search || gatewayOrigin.hash
    || gatewayOrigin.hostname.endsWith(".") || gatewayBaseUrl !== gatewayOrigin.origin
    || !/^[\u0021-\u007e]{32,4096}$/u.test(bearerToken) || !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/u.test(senderMailbox)
    || !appDisplayName.trim() || appDisplayName.length > 100 || /[\u0000-\u001f\u007f]/u.test(appDisplayName)) invalid("Email");
  const maxSendsPerDay = sendLimit(env, `${prefix}_MAX_SENDS_PER_DAY`, "Email", 100);
  const maxSendsPerMonth = sendLimit(env, `${prefix}_MAX_SENDS_PER_MONTH`, "Email", 3000);
  if (maxSendsPerDay > maxSendsPerMonth) invalid("Email");
  return { sender: { gatewayBaseUrl, bearerToken, senderMailbox, appDisplayName }, maxSendsPerDay, maxSendsPerMonth };
}

function readPhone(env: NodeJS.ProcessEnv): NonNullable<ContactVerificationConfig["phone"]> {
  const prefix = "LIFE_LINKS_PHONE_VERIFICATION";
  const credentialSecret = required(env, "LIFE_LINKS_PHONE_CREDENTIAL_SECRET", "Phone", 4096);
  const credentialSecretBytes = Buffer.byteLength(credentialSecret, "utf8");
  if (credentialSecretBytes < 32 || credentialSecretBytes > 4096) invalid("Phone");
  const apiKey = required(env, `${prefix}_TELNYX_API_KEY`, "Phone", 4096);
  const fromE164 = required(env, `${prefix}_FROM_E164`, "Phone", 16);
  const messagingProfileId = required(env, `${prefix}_MESSAGING_PROFILE_ID`, "Phone", 36);
  const appDisplayName = env[`${prefix}_APP_DISPLAY_NAME`] ?? "LifeLinks";
  if (/\s/u.test(apiKey) || !/^\+[1-9]\d{7,14}$/u.test(fromE164)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(messagingProfileId)
    || !/^[A-Za-z0-9][A-Za-z0-9 .&'()/:-]{0,39}$/u.test(appDisplayName)) invalid("Phone");
  const allowedRegions = required(env, `${prefix}_ALLOWED_REGIONS`, "Phone", 64).split(",").map(value => value.trim());
  // Runtime country validation uses maintained phone metadata, not the shared +1
  // calling code. Provider country restrictions remain an activation prerequisite.
  if (allowedRegions.some(value => value !== "US" && value !== "CA")
    || new Set(allowedRegions).size !== allowedRegions.length) invalid("Phone");
  const maxSendsPerDay = sendLimit(env, `${prefix}_MAX_SENDS_PER_DAY`, "Phone", 10_000);
  const maxSendsPerMonth = sendLimit(env, `${prefix}_MAX_SENDS_PER_MONTH`, "Phone", 100_000);
  const cost = dollarLimit(env, `${prefix}_MAX_COST_PER_SMS_USD`, 1000);
  const day = dollarLimit(env, `${prefix}_MAX_SPEND_PER_DAY_USD`, 1000);
  const month = dollarLimit(env, `${prefix}_MAX_SPEND_PER_MONTH_USD`, 10_000);
  if (maxSendsPerDay > maxSendsPerMonth || day.microUsd > month.microUsd
    || maxSendsPerDay > Math.floor(day.microUsd / cost.microUsd)
    || maxSendsPerMonth > Math.floor(month.microUsd / cost.microUsd)) invalid("Phone");
  return {
    sender: { apiKey, fromE164, messagingProfileId, appDisplayName }, credentialSecret,
    allowedRegions: allowedRegions as ("US" | "CA")[],
    maxSendsPerDay, maxSendsPerMonth,
    maxCostPerSmsUsd: cost.usd, maxSpendPerDayUsd: day.usd, maxSpendPerMonthUsd: month.usd,
  };
}

/** Offline validation only. Configured credentials and limits do not grant provider setup or spending. */
export function readContactVerificationConfig(
  env: NodeJS.ProcessEnv,
  runtime: VerificationRuntime,
): ContactVerificationConfig | undefined {
  const emailEnabled = env.LIFE_LINKS_EMAIL_VERIFICATION_ENABLED === "true";
  const phoneEnabled = env.LIFE_LINKS_PHONE_VERIFICATION_ENABLED === "true";
  if (!emailEnabled && !phoneEnabled) return undefined;
  requireDurableSecureRuntime(runtime);
  return {
    ...(emailEnabled ? { email: readEmail(env) } : {}),
    ...(phoneEnabled ? { phone: readPhone(env) } : {}),
  };
}
