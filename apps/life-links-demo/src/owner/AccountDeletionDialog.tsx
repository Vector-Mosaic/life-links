import { useEffect, useRef, useState } from "react";
import { ApiError, deleteAccount, type ApiUser } from "../api";
import { nativeRuntime } from "../platform";
import { Dialog, LifeLinksGlyph } from "./FieldLedgerPrimitives";
import { PublicInformationLinks } from "../PublicInformation";

export function AccountDeletionDialog({ user, onClose, onDeleted }: {
  user: ApiUser; onClose(): void; onDeleted(): Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof deleteAccount>> | null>(null);
  const pending = useRef(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || confirmation !== "DELETE") return;
    pending.current = true; setBusy(true); setError("");
    try {
      const deleted = await deleteAccount();
      if (deleted.status !== "deleted") throw new Error();
      setResult(deleted);
      window.dispatchEvent(new CustomEvent("lifelinks-account-deleted", { detail: deleted.appleRevocation }));
      // Local erasure is already confirmed. A device cleanup/network issue must
      // not present another destructive submission or undo that result.
      await nativeRuntime()?.clearSession().catch(() => undefined);
      await onDeleted().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "account_deletion_pending"
        ? "Deletion is waiting for a calendar operation to finish. Your account has not been deleted. Wait a little, then try again."
        : "We couldn't confirm deletion. Check whether you can still sign in before trying again.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={result ? "Account deleted" : "Delete your account"} onClose={() => { if (!busy) onClose(); }}>
    {result ? <div className="ll-form"><p>Your LifeLinks account and its stored content have been deleted.</p>
      {result.appleRevocation === "pending" && <p>Apple access revocation is still being completed. Your LifeLinks sessions are already closed.</p>}
      {result.appleRevocation === "manual_required" && <p>For this older Apple connection, also remove LifeLinks under Sign in with Apple in your Apple Account settings.</p>}
      <button className="ll-button" onClick={onClose}>Close</button></div> :
      <form className="ll-form" onSubmit={event => void submit(event)}>
        <p>Delete the account for <strong>{user.email ?? user.displayName}</strong> and its Life Links, Collections, Routines, Calendar records, attachments and account connections.</p>
        <p>This cannot be undone. Original events in your Google or Outlook calendar stay there. Printed QR identities stay available, with your content detached. Backups and limited records kept under the privacy policy expire separately.</p>
        <label>Type DELETE to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)}
          autoComplete="off" spellCheck={false} disabled={busy} aria-describedby="account-delete-warning" /></label>
        <p id="account-delete-warning" className="ll-muted">Your account will be signed out on every device and connected agents will lose access.</p>
        {error && <p className="ll-inline-warning" role="alert">{error}</p>}
        <div className="ll-button-row"><button type="button" className="ll-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="ll-button ll-danger-text" disabled={busy || confirmation !== "DELETE"}>{busy ? "Deleting account…" : "Delete account permanently"}</button></div>
      </form>}
  </Dialog>;
}

export function AccountDeletionPage({ user, receipt = null, onDeleted }: { user: ApiUser | null;
  receipt?: "complete" | "pending" | "not_required" | "manual_required" | null; onDeleted(): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  // Keep the confirmed owner while the success dialog clears the workspace.
  const owner = useRef(user);
  if (user) owner.current = user;
  useEffect(() => { if (user) { setDeleted(false); setOpen(false); } }, [user?.id]);
  return <main className="public-information-shell">
    <header className="public-information-header"><a href="/" className="ll-brand">LifeLinks <LifeLinksGlyph /></a><PublicInformationLinks /></header>
    <article className="public-information-content"><h1>Delete your LifeLinks account</h1>
      <p>You can permanently delete your account and its content from Account → Delete account inside LifeLinks, or use this page.</p>
      <p>LifeLinks content, sessions, agent access, calendar connections and uploaded files are removed. Original external calendar events and printed QR identities are preserved. Backups and limited retention records expire under the <a href="/privacy">privacy notice</a>.</p>
      {deleted || receipt ? <div role="status"><p>Your LifeLinks account and its content have been deleted.</p>
        {receipt === "pending" && <p>Apple access revocation is still being completed. Your LifeLinks sessions are already closed.</p>}
        {receipt === "manual_required" && <p>Also remove LifeLinks under Sign in with Apple in your Apple Account settings for this older connection.</p>}
      </div> : user ? <>
        <p>Signed in as <strong>{user.email ?? user.displayName}</strong>.</p>
        <button className="ll-button ll-danger-text" onClick={() => setOpen(true)}>Delete my account</button></> :
        <p><a className="primary-button" href="/life-links">Sign in to delete your account</a> Then return to this page or choose Account → Delete account.</p>}
      <p>For help accessing your account, contact <a href="mailto:justin@vmosaic.com">justin@vmosaic.com</a>. Do not send passwords or verification codes.</p>
    </article>
    {open && owner.current && <AccountDeletionDialog user={owner.current} onClose={() => setOpen(false)}
      onDeleted={async () => { setDeleted(true); await onDeleted(); }} />}
  </main>;
}
