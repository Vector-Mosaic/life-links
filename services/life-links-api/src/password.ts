import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_LENGTH = Math.ceil((SESSION_TOKEN_BYTES * 4) / 3);

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<string> {
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, salt, hashHex] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !hashHex) {
    return false;
  }
  const candidate = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hasSessionTokenShape(value: string): boolean {
  return value.length === SESSION_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

export function hashSessionToken(token: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}
