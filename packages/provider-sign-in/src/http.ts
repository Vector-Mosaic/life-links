import { ProviderSignInError } from "./types.js";

const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/** Provider requests never follow redirects, retry code redemption, or expose response bodies. */
export async function requestJson(url: string, init: RequestInit = {}, optionalStatuses: readonly number[] = []): Promise<{ body: unknown; status: number; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
    if (optionalStatuses.includes(response.status)) return { body: null, status: response.status, headers: {} };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new ProviderSignInError();
    if (!response.body) throw new ProviderSignInError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ProviderSignInError();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!response.ok) throw new ProviderSignInError();
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { body, status: response.status, headers: Object.fromEntries(response.headers.entries()) };
  } catch {
    throw new ProviderSignInError();
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderSignInError();
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, max = 8192): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new ProviderSignInError();
  return value;
}

export function optionalString(value: unknown, max = 256): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
}

export function contactEmail(value: unknown): string | null {
  const email = optionalString(value, 320);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

export async function postForm(url: string, body: URLSearchParams, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const result = await requestJson(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
    body: body.toString(),
  });
  const parsed = object(result.body);
  if (Object.hasOwn(parsed, "error")) throw new ProviderSignInError();
  return parsed;
}
