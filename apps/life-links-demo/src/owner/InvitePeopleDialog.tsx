import { useEffect, useRef, useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { cancelAccountInvitation, createAccountInvitation, listAccountInvitations, type AccountInvitation } from "../api";
import { accountInvitationLink } from "../invitationLink";
import { Dialog } from "./FieldLedgerPrimitives";

export function InvitePeopleDialog({ onClose }: { onClose(): void }) {
  const [invitations, setInvitations] = useState<AccountInvitation[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newLink, setNewLink] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  const readRevision = useRef(0);
  const pending = useRef(false);
  const linkInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    const revision = ++readRevision.current;
    const result = await listAccountInvitations();
    if (mounted.current && revision === readRevision.current) { setInvitations(result.invitations); setEnabled(result.enabled); }
  }
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void refresh().catch(() => { if (active) setError("We couldn't load your invitations. Close and reopen to try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; ++readRevision.current; };
  }, []);

  async function create() {
    if (pending.current || loading || !enabled) return;
    pending.current = true; ++readRevision.current; setBusy(true); setError(""); setCopied(false);
    try {
      const result = await createAccountInvitation();
      if (!mounted.current) return;
      setNewLink({ id: result.invitation.id, url: accountInvitationLink(result.invitationCode, window.location.origin) });
      setInvitations(current => [result.invitation, ...current].slice(0, 50));
    } catch {
      if (!mounted.current) return;
      setError("We couldn't confirm a new invitation. Check the list before creating another. Cancel an unused invitation if you've reached the limit.");
      try { await refresh(); } catch { /* Preserve the original error; never retry creation. */ }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  async function cancel(id: string) {
    if (pending.current) return;
    pending.current = true; ++readRevision.current; setBusy(true); setError("");
    try {
      await cancelAccountInvitation(id);
      if (!mounted.current) return;
      if (newLink?.id === id) { setNewLink(null); setCopied(false); }
      await refresh();
    } catch { if (mounted.current) setError("We couldn't confirm cancellation. Refresh the list before relying on the link being cancelled."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }

  async function copy() {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink.url);
      if (mounted.current) { setCopied(true); setError(""); }
    } catch {
      linkInput.current?.select();
      if (mounted.current) setError("Select and copy the invitation link below.");
    }
  }
  const active = invitations.filter(invitation => !invitation.revokedAt && !invitation.redeemedAt && Date.parse(invitation.expiresAt) > Date.now());

  return <Dialog title="Invite people" onClose={onClose}>
    <div className="ll-form ll-invitations">
      <p>Give someone their own private LifeLinks workspace. Your records, agent connections, and calendars stay private.</p>
      <button className="ll-button ll-primary" disabled={loading || busy || !enabled || active.length >= 10} onClick={() => void create()}>
        <UserPlus size={18} />{busy ? "Working…" : newLink ? "Create another invitation" : "Create invitation link"}
      </button>
      <p className="ll-muted">One invitation use per link · Expires in 7 days · Up to 10 pending invitations. People can also sign up directly.</p>
      {newLink && <section aria-label="New invitation">
        <label>Invitation link<input ref={linkInput} value={newLink.url} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.target.select()} /></label>
        <div className="ll-button-row"><button className="ll-button" onClick={() => void copy()}><Copy size={16} />{copied ? "Copied!" : "Copy link"}</button></div>
        <p className="ll-muted">Send this link in a message and save it before closing this dialog. The invitation can be used once; signup remains available if it expires or is cancelled.</p>
      </section>}
      {error && <p className="ll-inline-warning" role="alert">{error}</p>}
      {copied && <p role="status" className="ll-muted">Invitation link copied.</p>}
      {loading ? <p role="status">Loading invitations…</p> : <>
        {!enabled && <p role="status">New invitations are currently unavailable.</p>}
        {invitations.length > 0 && <section aria-label="Your recent invitations">
          <h3>Recent invitations</h3>
          <ul className="ll-invitation-list">{invitations.map(invitation => {
            const status = invitation.redeemedAt ? "Used" : invitation.revokedAt ? "Cancelled" : Date.parse(invitation.expiresAt) <= Date.now() ? "Expired" : "Pending";
            return <li key={invitation.id}><div><strong>{new Date(invitation.createdAt).toLocaleString()}</strong>
              <small>{status}{status === "Pending" ? ` · Expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : ""}</small></div>
              {status === "Pending" && <button className="ll-text-button" disabled={busy} onClick={() => void cancel(invitation.id)}>Cancel invitation</button>}
            </li>;
          })}</ul>
          <button className="ll-text-button" disabled={busy} onClick={() => void refresh().catch(() => setError("We couldn't refresh your invitations."))}>Refresh invitations</button>
        </section>}
      </>}
    </div>
  </Dialog>;
}
