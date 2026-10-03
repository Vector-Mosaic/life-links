import type { Request } from "express";

/** The OS HTTP transport has no browser Origin, Referer or Fetch Metadata.
 * This is transport admission, never authentication or proof of possession. */
export function isNativeRequest(request: Request): boolean {
  return request.body?.client === "native" && !request.get("Origin") && !request.get("Referer") &&
    !["Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest", "Sec-Fetch-User"].some(header => request.get(header));
}

export const NATIVE_VERIFICATION_HEADER = "X-LifeLinks-Verification";
