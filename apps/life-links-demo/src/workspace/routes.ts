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

export function classifyLifeLinksRoute(pathname: string, authenticated: boolean): LifeLinksRoute {
  const qrId = qrIdFromPath(pathname);
  if (qrId) {
    return { surface: "public-qr", qrId, lifeLinkId: null };
  }
  const lifeLinkId = lifeLinkIdFromPath(pathname);
  if (authenticated) {
    return { surface: "owner-workspace", qrId: null, lifeLinkId };
  }
  return { surface: "login", qrId: null, lifeLinkId };
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
