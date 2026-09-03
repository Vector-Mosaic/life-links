export type LifeLinksRoute =
  | { surface: "public-qr"; qrId: string; lifeLinkId: null }
  | { surface: "login"; qrId: null; lifeLinkId: string | null }
  | { surface: "owner-workspace"; qrId: null; lifeLinkId: string | null };

export function qrIdFromPath(pathname: string): string | null {
  const match = pathname.split("?")[0].match(/^\/qr\/([^/]+)\/?$/i);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function lifeLinkIdFromPath(pathname: string): string | null {
  const match = pathname.split("?")[0].match(/^\/life-links\/([^/]+)\/?$/i);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function ownerLifeLinkPath(lifeLinkId: string): string {
  return `/life-links/${encodeURIComponent(lifeLinkId)}`;
}

export function isCollectionsPath(pathname: string): boolean {
  return /^\/collections(?:\/[^/]+)?\/?$/i.test(pathname.split("?")[0]);
}

export function collectionIdFromPath(pathname: string): string | null {
  const match = pathname.split("?")[0].match(/^\/collections\/([^/]+)\/?$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function collectionMemberIdFromPath(pathname: string): string | null {
  return isCollectionsPath(pathname) ? new URLSearchParams(pathname.split("?")[1] ?? "").get("lifeLinkId") : null;
}

export function ownerCollectionPath(collectionId: string, lifeLinkId?: string): string {
  const path = `/collections/${encodeURIComponent(collectionId)}`;
  return lifeLinkId ? `${path}?${new URLSearchParams({ lifeLinkId })}` : path;
}

export function isRoutinesPath(pathname: string): boolean {
  return /^\/routines(?:\/[^/]+)?\/?$/i.test(pathname.split("?")[0]);
}

export function routineIdFromPath(pathname: string): string | null {
  const match = pathname.split("?")[0].match(/^\/routines\/([^/]+)\/?$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function ownerRoutinePath(routineId: string): string {
  return `/routines/${encodeURIComponent(routineId)}`;
}

export function isCalendarPath(pathname: string): boolean {
  return /^\/calendar(?:\/[^/]+)?\/?$/i.test(pathname.split("?")[0]);
}

export function calendarEventIdFromPath(pathname: string): string | null {
  const match = pathname.split("?")[0].match(/^\/calendar\/([^/]+)\/?$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function ownerCalendarEventPath(eventId: string): string {
  return `/calendar/${encodeURIComponent(eventId)}`;
}

export function classifyLifeLinksRoute(pathname: string, authenticated: boolean): LifeLinksRoute {
  const qrId = qrIdFromPath(pathname);
  if (qrId) {
    return { surface: "public-qr", qrId, lifeLinkId: null };
  }
  const lifeLinkId = lifeLinkIdFromPath(pathname);
  if (authenticated && !isRegistrationPath(pathname) && !publicInformationPageFromPath(pathname)) {
    return { surface: "owner-workspace", qrId: null, lifeLinkId };
  }
  return { surface: "login", qrId: null, lifeLinkId };
}

export function isRegistrationPath(pathname: string): boolean {
  return pathname.split("?")[0].replace(/\/$/, "") === "/register";
}

export type PublicInformationPage = "about" | "privacy" | "terms";

export function publicInformationPageFromPath(pathname: string): PublicInformationPage | null {
  const path = pathname.split("?")[0].replace(/\/$/, "");
  return path === "/about" ? "about" : path === "/privacy" ? "privacy" : path === "/terms" ? "terms" : null;
}

// Account entry may resume only an owned app route, never an external URL or an
// arbitrary endpoint. OAuth interactions need a full navigation after signup.
export function safeAccountReturnPath(value: string | null | undefined): string {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return "/life-links";
  const allowed = /^\/(?:life-links|collections|routines|calendar)(?:\/[A-Za-z0-9_-]+)?\/?$|^\/(?:qr|agent-authorize)\/[A-Za-z0-9_-]+\/?$/;
  const path = value.split("?")[0];
  return allowed.test(path) ? path : "/life-links";
}

export function accountRegistrationPath(returnTo: string): string {
  return `/register?returnTo=${encodeURIComponent(safeAccountReturnPath(returnTo))}`;
}

export function accountRegistrationReturnPath(pathname: string): string {
  return safeAccountReturnPath(new URLSearchParams(pathname.split("?")[1] ?? "").get("returnTo"));
}

export interface WorkspaceBrowserRoute {
  pathname(): string;
  push(pathname: string): void;
  subscribe(listener: () => void): () => void;
}

export function createWindowWorkspaceRoute(target: Window = window): WorkspaceBrowserRoute {
  return {
    pathname: () => `${target.location.pathname}${target.location.search ?? ""}`,
    push: (pathname) => target.history.pushState({}, "", pathname),
    subscribe: (listener) => {
      target.addEventListener("popstate", listener);
      return () => target.removeEventListener("popstate", listener);
    }
  };
}
