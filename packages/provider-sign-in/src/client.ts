import type { ProviderId } from "./types.js";

export type { ProviderId } from "./types.js";

const providerNames: Record<ProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
  facebook: "Facebook",
  github: "GitHub",
  chatgpt: "ChatGPT",
};

const authorizationOrigins: Record<ProviderId, string> = {
  google: "https://accounts.google.com",
  microsoft: "https://login.microsoftonline.com",
  apple: "https://appleid.apple.com",
  facebook: "https://www.facebook.com",
  github: "https://github.com",
  chatgpt: "https://auth.openai.com",
};

function failure(): Error { return new Error("Provider sign-in could not be started."); }

export function providerButtonLabel(id: ProviderId): string {
  if (!Object.hasOwn(providerNames, id)) throw failure();
  return `Continue with ${providerNames[id]}`;
}

/** A browser redirect helper, not a substitute for the backend transaction checks. */
export function validateProviderAuthorizationUrl(provider: ProviderId, url: string): string {
  try {
    if (!Object.hasOwn(authorizationOrigins, provider) || typeof url !== "string" || url.length > 8192 || /[\u0000-\u001f\u007f]/u.test(url)) throw failure();
    const parsed = new URL(url);
    if (parsed.origin !== authorizationOrigins[provider] || parsed.username || parsed.password || parsed.hash) throw failure();
    return parsed.toString();
  } catch {
    throw failure();
  }
}
