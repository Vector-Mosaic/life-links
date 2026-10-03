import { providerAuthorizationUrl, validateProviderReturnTo } from "./providerSignInLink";

export const LIFE_LINKS_PRODUCTION_ORIGIN = "https://lifelinks.vmosaic.com";
export type NativeBrowserFlow = {
  provider?: string;
  calendarProvider?: "google" | "microsoft";
  intent: "login" | "register" | "link" | "calendar";
  returnTo?: string;
  timeZone?: string;
  invitationCode?: string;
  reconnectConnectionId?: string;
};

/** The native shell supplies device services; canonical product behavior stays
 * in the maintained workspace and API. The web client keeps its normal defaults. */
export interface LifeLinksNativeRuntime {
  request(path: string, init: RequestInit, maxResponseBytes?: number): Promise<Response>;
  startBrowserFlow(input: NativeBrowserFlow): Promise<string>;
  openBrowser(url: string): Promise<void>;
  openExternalLink(url: string): Promise<void>;
  clearSession(): Promise<void>;
  loadMedia(url: string): Promise<string>;
  releaseMedia(uri: string): Promise<void>;
  shareDownload(url: string, filename: string): Promise<void>;
  shareBlob(blob: Blob, filename: string): Promise<void>;
  shareUrl(url: string, title: string): Promise<void>;
  capturePhoto(): Promise<File>;
  scanQr(): Promise<string>;
}
let installed: LifeLinksNativeRuntime | null = null;
export function installNativeRuntime(runtime: LifeLinksNativeRuntime): void { installed = runtime; }
export function nativeRuntime(): LifeLinksNativeRuntime | null { return installed; }

export function productOrigin(): string { return installed ? LIFE_LINKS_PRODUCTION_ORIGIN : window.location.origin; }

export function platformFetch(path: string, init: RequestInit, maxResponseBytes?: number): Promise<Response> {
  return installed ? installed.request(path, init, maxResponseBytes) : fetch(path, init);
}

export function providerDestination(provider: Parameters<typeof providerAuthorizationUrl>[0], value: string): string | null {
  if (!installed) return providerAuthorizationUrl(provider, value);
  try {
    const url = new URL(value);
    return url.origin === LIFE_LINKS_PRODUCTION_ORIGIN && !url.username && !url.password &&
      url.pathname === "/api/auth/native/launch" && !url.hash ? url.href : null;
  } catch { return null; }
}

export function openAccountBrowser(url: string): void {
  if (installed) void installed.openBrowser(url).catch(() => window.dispatchEvent(new Event("lifelinks-native-auth-error")));
  else window.location.assign(url);
}

export async function openExternalLink(value: string): Promise<void> {
  const url = new URL(value);
  if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported link.');
  if (installed) await installed.openExternalLink(url.href);
  else window.open(url.href, '_blank', 'noopener,noreferrer');
}

export function navigateAccountReturn(path: string): void {
  const safe = validateProviderReturnTo(path);
  if (installed) {
    window.history.replaceState({}, "", safe);
    window.dispatchEvent(new Event("lifelinks-native-auth-complete"));
  } else window.location.assign(safe);
}

/** Only the fixed, server-issued app handoff is allowed from a hosted signup. */
export function followNativeCallback(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "string") throw new Error("Invalid app callback.");
  const url = new URL(value);
  if (url.protocol !== "lifelinks:" || url.hostname !== "auth" || url.pathname !== "/callback" ||
      url.username || url.password || url.port || url.hash ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code") ?? "") ||
      url.searchParams.getAll("code").length !== 1 ||
      [...url.searchParams.keys()].some(key => key !== "code")) throw new Error("Invalid app callback.");
  window.location.assign(url.href);
  return true;
}
