import { useRef, useState } from "react";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { CollectionChangePreviewContent } from "./CollectionChangeDialog";
import { Dialog } from "./FieldLedgerPrimitives";
import { RoutineDeletionEffects } from "./RoutineDialogs";

/** The page-agent only requests this dialog; an actual owner click applies its shared preview. */
export function AgentWorkspaceChangeDialog({ confirmation, controller }: {
  confirmation: NonNullable<LifeLinksWorkspaceSnapshot["agentWorkspaceChangeConfirmation"]>;
  controller: LifeLinksWorkspaceController;
}) {
  const pending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const busy = confirmation.saving || submitting;
  const moving = confirmation.kind === "collection" && confirmation.preview.input.operation === "move";
  const error = confirmation.error || localError;
  const title = confirmation.kind === "routines" ? "Delete selected Routines?"
    : moving ? "Move selected Collection content" : "Delete selected organization";

  async function answer(confirmed: boolean) {
    if (pending.current || confirmation.saving) return;
    pending.current = true; setSubmitting(true); setLocalError("");
    try { await controller.confirmAgentWorkspaceChange(confirmed); }
    catch (issue) { setLocalError(issue instanceof Error ? issue.message : "The change could not be confirmed. Try again."); }
    finally { pending.current = false; setSubmitting(false); }
  }

  return <Dialog title={title} closeDisabled={busy} onClose={() => void answer(false)}>
    {confirmation.kind === "collection"
      ? <><CollectionChangePreviewContent preview={confirmation.preview} />
        {error && <p className="ll-inline-warning" role="alert">{error}</p>}</>
      : <div className="ll-form"><RoutineDeletionEffects preview={confirmation.preview} removedIds={confirmation.removedIds} error={error} /></div>}
    <footer className="ll-dialog-footer">
      <button type="button" className="ll-button" disabled={busy} onClick={() => void answer(false)}>Cancel</button>
      <button type="button" className={`ll-button ${moving || confirmation.kind === "routines" ? "ll-primary" : "ll-danger-text"}`}
        disabled={busy} onClick={() => void answer(true)}>
        {busy ? "Saving…" : confirmation.kind === "routines" && (confirmation.removedIds.length > 0 || error)
          ? "Retry remaining" : error ? "Retry change" : moving ? "Yes, move" : "Yes, delete"}
      </button>
    </footer>
  </Dialog>;
}
