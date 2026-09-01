import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ChevronLeft, ChevronRight, Folder, Package, Plus, QrCode, Download } from "lucide-react";
import { PUBLIC_FIELD_KEYS, buildQrUrl, projectPublicLifeLinkAsLink, type LifeLinkBrowsingRole, type LifeLinkChangePreview, type PublicFieldKey } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { RichBodyRenderer } from "../richBody";
import { ContextFields, contextLabels } from "./LifeLinkDetail";
import { Dialog } from "./FieldLedgerPrimitives";

export type WorkspaceDialog =
  | { kind: "create"; parentId: string | null; role: LifeLinkBrowsingRole }
  | { kind: "collection"; edit?: boolean }
  | { kind: "section"; id?: string; title?: string }
  | { kind: "move" | "delete"; lifeLinkIds: string[] }
  | { kind: "members" | "assign" | "qr"; lifeLinkId: string }
  | { kind: "settings" | "help" | "agent" | "factory" }
  | null;

export function RecordPicker({ controller, snapshot, movingIds = [], onChoose, chooseFolders = false }: {
  controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot; movingIds?: readonly string[];
  onChoose(id: string | null, path?: string): void; chooseFolders?: boolean;
}) {
  const [path, setPath] = useState<Array<{ id: string; title: string }>>([]);
  const parent = path.at(-1)?.id ?? null;
  const branch = parent ? snapshot.lifeLinkChildren[parent] : snapshot.rootLifeLinks;
  const attempted = useRef(new Set<string | null>());
  useEffect(() => {
    if (!branch?.loaded && !branch?.loading && !attempted.current.has(parent)) {
      attempted.current.add(parent); void controller.loadMoreLifeLinks(parent);
    }
  }, [parent, branch?.loaded, branch?.loading, controller]);
  return <div className="ll-record-picker">
    <nav className="ll-picker-path"><button onClick={() => setPath([])}>My Life Links</button>{path.map((item, index) => <span key={item.id}><ChevronRight size={14} /><button onClick={() => setPath(path.slice(0, index + 1))}>{item.title}</button></span>)}</nav>
    {path.length > 0 && <button className="ll-text-button" onClick={() => setPath(path.slice(0, -1))}><ChevronLeft size={16} />Back</button>}
    {chooseFolders && <button className="ll-button ll-primary" onClick={() => onChoose(parent, ["My Life Links", ...path.map((entry) => entry.title)].join(" / "))} disabled={snapshot.busy || (parent !== null && movingIds.includes(parent))}>Choose this folder</button>}
    {!chooseFolders && <p className="ll-muted">Add the selected Life Link only. Adding a folder does not add its contents.</p>}
    <div className="ll-picker-list">{branch?.items.filter((item) => !movingIds.includes(item.id)).map((item) => <div key={item.id}>
      <button onClick={() => {
        if (item.browsingRole === "container") {
          setPath([...path, { id: item.id, title: item.title }]);
          if (!snapshot.lifeLinkChildren[item.id]?.loaded) void controller.toggleLifeLinkExpanded(item.id);
        } else if (!chooseFolders) onChoose(item.id);
      }} disabled={snapshot.busy || (chooseFolders && item.browsingRole !== "container")}>
        {item.browsingRole === "container" ? <Folder size={18} /> : <Package size={18} />}<span>{item.title}</span>{item.browsingRole === "container" && <ChevronRight size={16} />}
      </button>
      {!chooseFolders && item.browsingRole === "container" && <button className="ll-picker-add ll-icon-button" title={`Add ${item.title}`} aria-label={`Add ${item.title}`} disabled={snapshot.busy || snapshot.collectionMembers.some((member) => member.id === item.id)} onClick={() => onChoose(item.id)}><Plus size={17} /></button>}
      {!chooseFolders && snapshot.collectionMembers.some((member) => member.id === item.id) && <span className="ll-muted">Already added</span>}
    </div>)}</div>
    {branch?.loading ? <p className="ll-muted">Loading…</p> : branch?.loaded && !branch.items.length ? <p className="ll-muted">This folder is empty.</p> : null}
    {!branch?.loaded && !branch?.loading && <button className="ll-text-button" onClick={() => void controller.loadMoreLifeLinks(parent)}>Retry loading this folder</button>}
    {branch?.nextCursor && <button className="ll-text-button" onClick={() => void controller.loadMoreLifeLinks(parent)}>Load more</button>}
  </div>;
}

export function FormDialog({ dialog, controller, snapshot, onClose }: { dialog: NonNullable<WorkspaceDialog>; controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot; onClose(): void }) {
  const collection = snapshot.selectedCollection;
  const [collectionBase] = useState(collection);
  const [title, setTitle] = useState(dialog.kind === "section" ? dialog.title ?? "" : dialog.kind === "collection" && dialog.edit ? collection?.title ?? "" : "");
  const [purpose, setPurpose] = useState(dialog.kind === "collection" && dialog.edit ? collection?.purpose ?? "" : "");
  const [notes, setNotes] = useState(dialog.kind === "collection" && dialog.edit ? collection?.notes ?? "" : "");
  async function finish(action: Promise<void>) { await action; if (!controller.getSnapshot().error) onClose(); }
  if (dialog.kind === "create" || dialog.kind === "collection" || dialog.kind === "section") {
    const heading = dialog.kind === "create" ? `New ${dialog.role === "container" ? "folder" : "item"}` : dialog.kind === "section" ? dialog.id ? "Edit section" : "New section" : dialog.edit ? "Edit Collection" : "New Collection";
    return <Dialog title={heading} onClose={onClose}><form className="ll-form" onSubmit={(event) => {
      event.preventDefault();
      if (dialog.kind === "create") void finish(controller.createLifeLink({ parentId: dialog.parentId, browsingRole: dialog.role, title }));
      else if (dialog.kind === "section") void finish(dialog.id ? controller.updateCollectionSection(dialog.id, title, collectionBase ?? undefined) : controller.createCollectionSection(title));
      else void finish(dialog.edit ? controller.updateCollection({ title, purpose, notes }, collectionBase ?? undefined) : controller.createCollection({ title, purpose, notes }));
    }}>
      <label>Name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></label>
      {dialog.kind === "collection" && <><label>Purpose<textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={500} rows={2} /></label><label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} /></label></>}
      {snapshot.error && <p className="ll-inline-warning" role="alert">{snapshot.error}</p>}
      <footer><button type="button" className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={snapshot.busy || !title.trim()}>{dialog.kind === "section" && dialog.id || dialog.kind === "collection" && dialog.edit ? "Save changes" : "Create"}</button></footer>
    </form></Dialog>;
  }
  if (dialog.kind === "members") return <Dialog title="Add Life Links" onClose={onClose}>
    <RecordPicker controller={controller} snapshot={snapshot} onChoose={(id) => { if (id) void controller.addCollectionMember(id); }} />
    {snapshot.error && <p className="ll-inline-warning" role="alert">{snapshot.error}</p>}
    <footer className="ll-dialog-footer"><button className="ll-button ll-primary" onClick={onClose}>Done</button></footer>
  </Dialog>;
  return null;
}

export const CHANGE_HISTORY_WARNING = "Only your last 5 saved changes can be undone. A bulk action counts as one change.";

/** Human and agent requests share the same immutable, full-effect confirmation. */
export function ChangePreviewDialog({ preview, busy, error, onConfirm, onCancel, onChooseAnother }: {
  preview: LifeLinkChangePreview; busy: boolean; error?: string;
  onConfirm(): void; onCancel(): void; onChooseAnother?(): void;
}) {
  const deleting = preview.operation === "delete";
  return <Dialog title={deleting ? "Confirm deletion" : "Confirm move"} onClose={() => { if (!busy) onCancel(); }}>
    <div className="ll-form ll-change-preview">
      <p>{preview.rootIds.length} selected {preview.rootIds.length === 1 ? "root" : "roots"} · {preview.sideEffects.lifeLinks} Life Links in total, including descendants.</p>
      {!deleting && <p>Move to <strong>{preview.target?.title ?? "My Life Links"}</strong>{preview.parentId && <small className="ll-change-identity">{preview.parentId}</small>}</p>}
      <p className="ll-muted">{deleting ? "The complete deletion is listed below. Folder contents are included; selecting both a folder and its child does not delete anything twice." : "The selected roots move together with their contents. Their identities, QR bindings, media, and Collection memberships stay attached."}</p>
      <ul className="ll-change-items" aria-label={deleting ? "Life Links to delete" : "Life Links to move"}>
        {preview.items.map((item) => <li key={item.id}>
          {item.browsingRole === "container" ? <Folder size={17} /> : <Package size={17} />}
          <span><strong>{item.title}</strong><small>{preview.rootIds.includes(item.id) ? "Selected root" : "Included descendant"} · {item.id}</small></span>
        </li>)}
      </ul>
      {deleting && <dl className="ll-change-counts"><dt>Media attachments</dt><dd>{preview.sideEffects.media}</dd><dt>QR bindings removed</dt><dd>{preview.sideEffects.qrBindings}</dd><dt>Collection memberships</dt><dd>{preview.sideEffects.collectionMemberships}</dd><dt>Section assignments</dt><dd>{preview.sideEffects.collectionSectionAssignments}</dd></dl>}
      {deleting && preview.sideEffects.qrBindings > 0 && <p className="ll-muted">Printed QR identities remain reserved for your account while this deletion can be undone.</p>}
      <p className="ll-history-warning">{CHANGE_HISTORY_WARNING}</p>
      {error && <p className="ll-inline-warning" role="alert">{error}</p>}
      <footer><button className="ll-button" disabled={busy} onClick={onCancel}>Cancel</button>
        {onChooseAnother && <button className="ll-button" disabled={busy} onClick={onChooseAnother}>Choose another folder</button>}
        <button className={`ll-button ${deleting ? "ll-danger" : "ll-primary"}`} disabled={busy} onClick={onConfirm}>{deleting ? "Delete Life Links" : "Move to folder"}</button>
      </footer>
    </div>
  </Dialog>;
}

export function LifeLinkChangeDialog({ operation, lifeLinkIds, controller, snapshot, onClose, onApplied }: {
  operation: "move" | "delete"; lifeLinkIds: string[]; controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot; onClose(): void; onApplied(): void;
}) {
  const [preview, setPreview] = useState<LifeLinkChangePreview | null>(null);
  const [preparing, setPreparing] = useState(operation === "delete");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function prepare(parentId?: string | null) {
    setPreparing(true); setError("");
    try {
      const value = await controller.previewLifeLinkChange({ operation, lifeLinkIds, ...(operation === "move" ? { parentId: parentId ?? null } : {}) });
      if (mounted.current) setPreview(value);
    } catch (issue) { if (mounted.current) setError(issue instanceof Error ? issue.message : "Could not prepare this change."); }
    finally { if (mounted.current) setPreparing(false); }
  }
  useEffect(() => { if (operation === "delete") void prepare(); }, []);
  async function apply() {
    if (!preview || applying) return;
    setApplying(true); setError("");
    try { await controller.applyLifeLinkChange(preview.id); if (mounted.current) onApplied(); }
    catch (issue) { if (mounted.current) setError(issue instanceof Error ? issue.message : "This change could not be saved."); }
    finally { if (mounted.current) setApplying(false); }
  }
  if (preview) return <ChangePreviewDialog preview={preview} busy={applying} error={error} onConfirm={() => void apply()} onCancel={onClose} onChooseAnother={operation === "move" ? () => setPreview(null) : undefined} />;
  return <Dialog title={operation === "move" ? "Move selected Life Links" : "Preview deletion"} onClose={onClose}>
    {preparing ? <p className="ll-muted" role="status">Preparing the complete preview…</p> : operation === "move" ? <RecordPicker controller={controller} snapshot={snapshot} movingIds={lifeLinkIds} chooseFolders onChoose={(parentId) => void prepare(parentId)} /> : <button className="ll-button" onClick={() => void prepare()}>Retry preview</button>}
    {error && <p className="ll-inline-warning" role="alert">{error}</p>}
    <footer className="ll-dialog-footer"><button className="ll-button" onClick={onClose}>Cancel</button></footer>
  </Dialog>;
}

export function SectionAssignmentDialog({ controller, snapshot, lifeLinkId, onClose }: { controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot; lifeLinkId: string; onClose(): void }) {
  type Assignment = Awaited<ReturnType<LifeLinksWorkspaceController["loadCollectionForAssignment"]>>;
  const [target, setTarget] = useState<Assignment | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load(id: string) {
    setLoading(true); setError("");
    try { const value = await controller.loadCollectionForAssignment(id, lifeLinkId); setTarget(value); setIds(value.membership?.sections.map((section) => section.id) ?? []); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not load Collection."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!snapshot.collectionsComplete) void controller.loadCollections(); if (snapshot.selectedCollection) void load(snapshot.selectedCollection.id); }, [lifeLinkId]);
  async function apply(action: Promise<void>, closeAfter = false) {
    await action;
    if (controller.getSnapshot().error) return;
    if (closeAfter) onClose();
    else if (target) await load(target.collection.id);
  }
  return <Dialog title="Collections & sections" onClose={onClose}>
    {loading && <p className="ll-muted">Loading sections…</p>}
    {!target ? <div className="ll-picker-list">{snapshot.collections.map((collection) => <button key={collection.id} disabled={loading} onClick={() => void load(collection.id)}>{collection.title}<ChevronRight size={16} /></button>)}{!snapshot.collections.length && !snapshot.collectionsLoading && <p className="ll-muted">Create a Collection in My Collections first.</p>}</div> : <div className="ll-form">
      <button className="ll-text-button" onClick={() => setTarget(null)}><ChevronLeft size={16} />Choose Collection</button>
      <h3>{target.collection.title}</h3>
      {!target.membership ? <button className="ll-button ll-primary" disabled={snapshot.busy || loading} onClick={() => void apply(controller.addCollectionMember(lifeLinkId, target.collection))}><Plus size={17} />Add to Collection</button> : <>
        <p className="ll-muted">An item can be in more than one section. No sections means Unsectioned.</p>
        {target.sections.map((section) => <label className="ll-check" key={section.id}><input type="checkbox" checked={ids.includes(section.id)} onChange={(event) => setIds(event.target.checked ? [...ids, section.id] : ids.filter((id) => id !== section.id))} />{section.title}</label>)}
        <footer><button className="ll-button ll-danger-text" disabled={snapshot.busy || loading} onClick={() => void apply(controller.removeCollectionMember(lifeLinkId, target.collection), true)}>Remove from Collection</button><button className="ll-button ll-primary" disabled={snapshot.busy || loading} onClick={() => void apply(controller.replaceCollectionSectionAssignments(lifeLinkId, ids, target.collection), true)}>Save sections</button></footer>
      </>}
    </div>}
    {(error || snapshot.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.error}</p>}
  </Dialog>;
}

export function QrCodeImage({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let live = true; void QRCode.toDataURL(url, { width: 240, margin: 2 }).then((value) => { if (live) setSrc(value); }); return () => { live = false; }; }, [url]);
  return src ? <img className="ll-qr-image" src={src} alt="QR code" width={200} height={200} /> : null;
}

export function QrDialog({ controller, snapshot, lifeLinkId, onClose }: { controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot; lifeLinkId: string; onClose(): void }) {
  const link = snapshot.selectedLifeLinkDetail?.lifeLink;
  const [input, setInput] = useState("");
  const [keys, setKeys] = useState<PublicFieldKey[]>(link?.publicFieldKeys ?? []);
  const [isPublic, setIsPublic] = useState(link?.privacy === "public");
  const [preview, setPreview] = useState(false);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(link?.updatedAt);
  async function changeBinding(action: () => Promise<void>) {
    const startsAtFormRevision = controller.getSnapshot().selectedLifeLinkDetail?.lifeLink.updatedAt === baseUpdatedAt;
    await action();
    if (startsAtFormRevision && !controller.getSnapshot().error) setBaseUpdatedAt(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink.updatedAt);
  }
  if (!link || link.id !== lifeLinkId) return null;
  const qr = link.qrId ? { id: link.qrId, url: buildQrUrl(snapshot.qrBaseUrl, link.qrId), createdAt: link.createdAt } : null;
  const projection = qr ? projectPublicLifeLinkAsLink(link, qr) : null;
  return <Dialog title="QR code" onClose={onClose}><div className="ll-form">
    {link.qrId ? <><QrCodeImage url={buildQrUrl(snapshot.qrBaseUrl, link.qrId)} /><code>{link.qrId}</code><div className="ll-button-row"><button className="ll-button" disabled={snapshot.busy} onClick={() => void controller.downloadSelectedQr("svg")}><Download size={16} />Download SVG</button><button className="ll-button" disabled={snapshot.busy} onClick={() => void controller.downloadSelectedQr("png")}><Download size={16} />Download PNG</button><button className="ll-button" onClick={() => { controller.selectFindTarget(link.qrId!); controller.setDetailsOpen(false); controller.setActiveView("scan"); onClose(); }}>Find Mode</button><button className="ll-button ll-danger-text" disabled={snapshot.busy} onClick={() => void changeBinding(() => controller.clearLifeLinkQrBinding(lifeLinkId))}>Detach QR</button></div></> : <button className="ll-button ll-primary" disabled={snapshot.busy} onClick={() => void changeBinding(() => controller.createQrForLifeLink(lifeLinkId))}><QrCode size={17} />Generate QR</button>}
    <form className="ll-form" onSubmit={(event) => { event.preventDefault(); void changeBinding(() => controller.setLifeLinkQrBinding(lifeLinkId, input)); }}><label>QR code or URL<input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste a QR ID or URL" /></label><button className="ll-button" disabled={snapshot.busy || !input.trim()}>{link.qrId ? "Change QR" : "Attach QR"}</button></form>
    <hr /><h3>Public view</h3><label className="ll-check"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />Make this record public</label>
    <p className="ll-muted">The title and selected fields appear to anyone opening the QR.</p>
    {PUBLIC_FIELD_KEYS.map((key) => <label className="ll-check" key={key}><input type="checkbox" checked={keys.includes(key)} onChange={(event) => setKeys(event.target.checked ? [...keys, key] : keys.filter((value) => value !== key))} />{key === "notes" ? "Notes" : contextLabels[key]}</label>)}
    <button className="ll-button ll-primary" disabled={snapshot.busy} onClick={async () => {
      await controller.updateSelectedLifeLink({ privacy: isPublic ? "public" : "private", publicFieldKeys: keys }, baseUpdatedAt);
      if (!controller.getSnapshot().error) setBaseUpdatedAt(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink.updatedAt);
    }}>Save public view</button>
    <button className="ll-button" disabled={!projection} onClick={() => setPreview(!preview)}>Preview saved public view</button>
    {preview && <div className="ll-public-preview">{link.privacy !== "public" ? <p>This record is private.</p> : projection && <><h2>{projection.title}</h2><ContextFields context={projection.context} /><RichBodyRenderer body={projection.body} bodyDoc={projection.bodyDoc} /></>}</div>}
    {snapshot.error && <p className="ll-inline-warning" role="alert">{snapshot.error}</p>}
  </div></Dialog>;
}
