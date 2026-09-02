import { useEffect, useRef, useState } from "react";
import type { CollectionChangeInput, CollectionChangePreview, CollectionRecord, CollectionSectionRecord } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { Dialog } from "./FieldLedgerPrimitives";
import { CHANGE_HISTORY_WARNING } from "./FieldLedgerDialogs";

export type CollectionSelection = {
  collectionIds: string[];
  sectionIds: string[];
  members: { lifeLinkId: string; sourceSectionId: string | null }[];
};
export type CollectionChangeDraft = Exclude<CollectionChangeInput, { operation: "move" }>
  | Omit<Extract<CollectionChangeInput, { operation: "move" }>, "target">;

/** Both owner and agent confirmation display this same canonical, revision-pinned preview. */
export function CollectionChangePreviewContent({ preview }: { preview: CollectionChangePreview }) {
  const input = preview.input;
  const moving = input.operation === "move";
  const movingSections = moving && input.scope === "contents" && input.sectionIds.length > 0;
  return <div className="ll-form">
    <p>Review this change. Your physical Life Links and their QR codes will not be deleted or moved.</p>
    {input.scope === "collections" && <ul>{preview.collections.map((collection) => <li key={collection.id}>{collection.title}</li>)}</ul>}
    {preview.sections.length > 0 && <><strong>Sections</strong><ul>{preview.sections.map((section) => <li key={section.id}>{section.title}</li>)}</ul></>}
    {preview.members.length > 0 && <><strong>Items</strong><ul>{preview.members.map((member, index) => <li key={`${member.lifeLinkId}:${member.sourceSectionId}:${index}`}>{member.title}</li>)}</ul></>}
    {preview.targetCollection && <p>Destination: <strong>{preview.targetCollection.title}{preview.targetSection ? ` / ${preview.targetSection.title}` : ""}</strong></p>}
    {movingSections ? <p>Sections keep their identities and bring their assignments. Items remain members of the original Collection too.</p>
      : moving ? <p>Within a Collection, only selected section appearances move. Between Collections, selected source memberships move; other Collections are unchanged.</p>
        : input.scope === "collections" ? <p>Only these Collections and their organization will be deleted. Routine history remains intact.</p>
          : <p>Deleting a Section leaves its items in the Collection. Deleting an item from a Section removes only that appearance; from All items or Locations it removes the Collection membership.</p>}
    <p className="ll-history-warning">{CHANGE_HISTORY_WARNING}</p>
  </div>;
}

/** Uses the shared owner preview/apply boundary, never a loop of item writes. */
export function CollectionChangeDialog({ input, controller, snapshot, onClose, onApplied }: {
  input: CollectionChangeDraft; controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void; onApplied(): void;
}) {
  const [preview, setPreview] = useState<CollectionChangePreview | null>(null);
  const [target, setTarget] = useState<{ collection: CollectionRecord; sections: CollectionSectionRecord[] } | null>(null);
  const [targetSection, setTargetSection] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const targetRequest = useRef(0);
  const moving = input.operation === "move";
  const movingSections = moving && input.scope === "contents" && input.sectionIds.length > 0;
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    if (moving) void controller.loadCollections();
    else void prepare(input, abort.signal);
    return () => { abort.abort(); lifetime.current = null; };
  }, []);

  async function prepare(value: CollectionChangeInput, signal = lifetime.current?.signal) {
    setBusy(true); setError("");
    try {
      const result = await controller.previewCollectionChange(value, signal);
      if (!signal?.aborted) setPreview(result);
    } catch (issue) { if (!signal?.aborted) setError(issue instanceof Error ? issue.message : "The change could not be prepared."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  async function chooseCollection(id: string) {
    const request = ++targetRequest.current;
    setTarget(null); setTargetSection(""); setError("");
    if (!id) return;
    setBusy(true);
    const signal = lifetime.current?.signal;
    try {
      const value = await controller.loadCollectionMoveTarget(id, signal);
      if (!signal?.aborted && request === targetRequest.current) setTarget(value);
    } catch (issue) { if (!signal?.aborted && request === targetRequest.current) setError(issue instanceof Error ? issue.message : "The destination could not be loaded."); }
    finally { if (!signal?.aborted && request === targetRequest.current) setBusy(false); }
  }
  async function apply() {
    if (!preview || busy) return;
    const signal = lifetime.current?.signal;
    setBusy(true); setError("");
    try { await controller.applyCollectionChange(preview.id, signal); if (!signal?.aborted) onApplied(); }
    catch (issue) { if (!signal?.aborted) setError(issue instanceof Error ? issue.message : "The change could not be saved."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  const title = moving ? "Move selected Collection content" : "Delete selected organization";
  return <Dialog title={title} closeDisabled={busy} onClose={() => { if (!busy) onClose(); }}>
    {preview ? <CollectionChangePreviewContent preview={preview} /> : moving ? <div className="ll-form">
      <label>Destination Collection<select aria-label="Destination Collection" value={target?.collection.id ?? ""} disabled={busy} onChange={(event) => void chooseCollection(event.target.value)}>
        <option value="">Choose a Collection</option>
        {snapshot.collections.filter((collection) => !movingSections || input.scope !== "contents" || collection.id !== input.source.collectionId)
          .map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}
      </select></label>
      {target && !movingSections && <label>Destination section<select aria-label="Destination section" value={targetSection} disabled={busy} onChange={(event) => setTargetSection(event.target.value)}>
        <option value="">Unsectioned / Collection membership</option>
        {target.sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
      </select></label>}
      {snapshot.collectionsLoading && <p role="status">Loading Collections…</p>}
      {!snapshot.collectionsComplete && !snapshot.collectionsLoading && <button className="ll-text-button" onClick={() => void controller.loadCollections()}>Retry loading Collections</button>}
    </div> : <p role="status">{busy ? "Preparing the complete preview…" : "Preview not available."}</p>}
    {error && <p className="ll-inline-warning" role="alert">{error}</p>}
    <footer className="ll-dialog-footer">
      <button className="ll-button" disabled={busy} onClick={onClose}>Cancel</button>
      {preview ? <><button className="ll-text-button" disabled={busy} onClick={() => { setPreview(null); setError(""); }}>Review again</button>
        <button className={`ll-button ${moving ? "ll-primary" : "ll-danger-text"}`} disabled={busy} onClick={() => void apply()}>{busy ? "Saving…" : moving ? "Move" : "Delete"}</button></>
        : moving ? <button className="ll-button ll-primary" disabled={busy || !target} onClick={() => { if (target && input.scope === "contents") void prepare({ ...input, target: { collectionId: target.collection.id, expectedUpdatedAt: target.collection.updatedAt, sectionId: targetSection || null } }); }}>Review move</button>
          : !busy && input.operation === "delete" && <button className="ll-button" onClick={() => void prepare(input)}>Retry preview</button>}
    </footer>
  </Dialog>;
}
