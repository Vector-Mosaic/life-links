export type LifeLinksRoute =
  | { surface: "public-qr"; qrId: string }
  | { surface: "login"; qrId: null }
  | { surface: "owner-workspace"; qrId: string | null };

export function qrIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/qr\/([^/]+)\/?$/i);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function classifyLifeLinksRoute(pathname: string, authenticated: boolean): LifeLinksRoute {
  const qrId = qrIdFromPath(pathname);
  if (authenticated) {
    return { surface: "owner-workspace", qrId };
  }
  if (qrId) {
    return { surface: "public-qr", qrId };
  }
  return { surface: "login", qrId: null };
}

export interface WorkspaceBrowserRoute {
  pathname(): string;
  push(pathname: string): void;
  subscribe(listener: () => void): () => void;
}

export function createWindowWorkspaceRoute(target: Window = window): WorkspaceBrowserRoute {
  return {
    pathname: () => target.location.pathname,
    push: (pathname) => target.history.pushState({}, "", pathname),
    subscribe: (listener) => {
      target.addEventListener("popstate", listener);
      return () => target.removeEventListener("popstate", listener);
    }
  };
}
