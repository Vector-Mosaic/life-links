// Capture before React mounts so StrictMode cannot consume the link twice.
// The fragment is never sent to a server; remove it from the current history entry.
let pendingInvitation = "";

export function captureInvitationLink(location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">): void {
  if (location.pathname.replace(/\/$/, "") !== "/register" || !location.hash.startsWith("#invite=")) return;
  const code = location.hash.slice("#invite=".length);
  pendingInvitation = /^[A-Za-z0-9_-]{32,128}$/.test(code) ? code : "";
  history.replaceState(history.state, "", location.pathname + location.search);
}

export function readPendingInvitation(): string { return pendingInvitation; }
export function clearPendingInvitation(): void { pendingInvitation = ""; }

export function accountInvitationLink(code: string, origin: string): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) throw new Error("Invalid invitation.");
  return `${origin}/register#invite=${code}`;
}
