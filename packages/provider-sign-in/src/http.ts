import { ProviderSignInError } from "./types.js";

const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/** One deadline covers response headers and bounded body consumption. */
async function requestBytes(url: string, init: RequestInit, optionalStatuses: readonly number[]): Promise<{ body: Buffer | null; status: number; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
    if (optionalStatuses.includes(response.status)) return { body: null, status: response.status, headers: {} };
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new ProviderSignInError();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
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
    }
    if (!response.ok) throw new ProviderSignInError();
    return { body: Buffer.concat(chunks), status: response.status, headers: Object.fromEntries(response.headers.entries()) };
  } catch {
    throw new ProviderSignInError();
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

/** Provider requests never follow redirects, retry exchanges, or expose response bodies. */
export async function requestJson(url: string, init: RequestInit = {}, optionalStatuses: readonly number[] = []): Promise<{ body: unknown; status: number; headers: Record<string, string> }> {
  const result = await requestBytes(url, init, optionalStatuses);
  if (result.body === null) return { ...result, body: null };
  try { return { ...result, body: JSON.parse(result.body.toString("utf8")) as unknown }; }
  catch { throw new ProviderSignInError(); }
}

/** Apple's revoke endpoint acknowledges success with exactly HTTP 200 and no body. */
export async function postFormEmpty(url: string, body: URLSearchParams): Promise<void> {
  try {
    const result = await requestBytes(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }, []);
    if (result.status !== 200 || !result.body || result.body.length !== 0) throw new ProviderSignInError();
  } catch { throw new ProviderSignInError("revocation_failed"); }
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
