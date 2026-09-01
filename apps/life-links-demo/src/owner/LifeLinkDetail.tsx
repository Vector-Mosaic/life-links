import { Paperclip, MapPin, Move, Pencil, Plus, QrCode, Boxes, ExternalLink } from "lucide-react";
import { LIFE_LINK_CONTEXT_FIELDS, deriveLifeLinkPhysicalLocator, type LifeLinkDetail as DetailRecord, type LifeLinkCollectionMembership, type LifeLinkContext } from "@life-links/core";
import { RichBodyRenderer } from "../richBody";
import { ActionMenu } from "./FieldLedgerPrimitives";
import { PathBreadcrumbs } from "./PathBreadcrumbs";
import { AttachmentList } from "./AttachmentList";

export const contextLabels = { summary: "Summary", condition: "Condition", experience: "Experience", plan: "Plan" } as const;
export const truthLabels = { owner_reported: "Owner reported", agent_inference: "Agent inference", planned: "Planned", unknown: "Unknown" } as const;

export function ContextFields({ context }: { context?: LifeLinkContext }) {
  return <>{LIFE_LINK_CONTEXT_FIELDS.map((key) => {
    const value = context?.[key];
    return value?.text ? <section className="ll-context-field" key={key}>
      <header><h3>{contextLabels[key]}</h3><span className={`ll-chip ll-truth-${value.truthState}`}>{truthLabels[value.truthState]}</span></header>
      <p>{value.text}</p>
    </section> : null;
  })}</>;
}

export function LifeLinkDetail({ detail, busy, memberships, membershipsLoading, membershipsComplete, onNavigate, onEdit, onCreateChild, onMove, onQr, onMedia, onCollection, onMemberships, collectionMode }: {
  detail: DetailRecord | null;
  busy: boolean;
  memberships: LifeLinkCollectionMembership[];
  membershipsLoading: boolean;
  membershipsComplete: boolean;
  collectionMode: boolean;
  onNavigate(id: string | null): void;
  onEdit(id: string): void;
  onCreateChild(id: string): void;
  onMove(id: string): void;
  onQr(id: string): void;
  onMedia(id: string): void;
  onCollection(id: string, lifeLinkId: string, sectionId?: string): void;
  onMemberships(id: string): void;
}) {
  if (!detail) return <div className="ll-empty">Select an item to see its details.</div>;
  const { lifeLink } = detail;
  const locator = deriveLifeLinkPhysicalLocator(detail.ancestry);
  const ancestors = detail.ancestry.items.filter((item) => item.id !== lifeLink.id);
  return <article className="ll-detail-content" data-selected-life-link-id={lifeLink.id}>
    <PathBreadcrumbs label="Item location" truncated={detail.ancestry.truncated} compactItems={ancestors.map((item) => ({ id: item.id, title: item.title, onSelect: () => onNavigate(item.id) }))} items={[
      { id: "__root", title: "My Life Links", onSelect: () => onNavigate(null) },
      ...detail.ancestry.items.map((item) => ({ id: item.id, title: item.title, current: item.id === lifeLink.id, onSelect: () => onNavigate(item.id) }))
    ]} />
    <div className="ll-title-row ll-detail-title-row"><h2>{lifeLink.title || "Untitled Life Link"}</h2>
      <ActionMenu label={`Actions for ${lifeLink.title}`} className="ll-icon-button ll-primary ll-detail-plus" items={[
        { label: "Edit", icon: <Pencil size={17} />, onClick: () => onEdit(lifeLink.id), disabled: busy },
        { label: "Add under this", icon: <Plus size={17} />, onClick: () => onCreateChild(lifeLink.id), disabled: busy },
        { label: "Add attachment", icon: <Paperclip size={17} />, onClick: () => onMedia(lifeLink.id), disabled: busy },
        { label: "QR code", icon: <QrCode size={17} />, onClick: () => onQr(lifeLink.id), disabled: busy },
        { label: "Move…", icon: <Move size={17} />, onClick: () => onMove(lifeLink.id), disabled: busy }
      ]}><Plus size={21} /></ActionMenu>
    </div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">{lifeLink.privacy === "private" ? "Private record" : "Public record"}</span>
      {lifeLink.qrId && <button className="ll-chip ll-qr-chip" onClick={() => onQr(lifeLink.id)}><QrCode size={16} />QR attached · preview public view</button>}
    </div>
    {collectionMode && <button className="ll-text-button ll-hierarchy-return" onClick={() => onNavigate(lifeLink.id)}><ExternalLink size={15} />Show in hierarchy</button>}
    <section className="ll-location" aria-label="Recorded location" data-physical-locator-id={locator?.lifeLinkId}>
      <h3>Recorded location</h3>
      <strong>{locator?.title || (ancestors.at(-1)?.title ?? "No recorded physical location")}</strong>
      <p>{ancestors.filter((item) => item.id !== locator?.lifeLinkId).map((item) => item.title).join(" · ") || (lifeLink.parentId ? "Recorded placement" : "Top level")}</p>
      <p className="ll-location-date">{lifeLink.placementConfirmedAt ? `Placement confirmed ${new Date(lifeLink.placementConfirmedAt).toLocaleDateString()}` : "No placement confirmation recorded"}</p>
      {locator && <button className="ll-text-button" onClick={() => onNavigate(locator.lifeLinkId)}><MapPin size={18} />Show recorded location</button>}
      {detail.ancestry.truncated && <small>The recorded path is incomplete.</small>}
    </section>
    <ContextFields context={lifeLink.context} />
    <section className="ll-detail-section" aria-labelledby="ll-memberships-heading">
      <header><h3 id="ll-memberships-heading">Collections & sections</h3><button className="ll-text-button" onClick={() => onMemberships(lifeLink.id)}>Manage</button></header>
      {membershipsLoading ? <p className="ll-muted">Loading memberships…</p> : !membershipsComplete ? <p role="status" className="ll-inline-warning">Memberships could not be fully loaded.</p> : !memberships.length ? <p className="ll-muted">No collections</p> : null}
      {memberships.map(({ collection, sections }) => <div className="ll-membership" key={collection.id}>
        <button onClick={() => onCollection(collection.id, lifeLink.id)}><Boxes size={17} />{collection.title}</button>
        <div className="ll-section-tags">{sections.length ? sections.map((section) => <button className="ll-chip ll-blue" key={section.id} onClick={() => onCollection(collection.id, lifeLink.id, section.id)}>{section.title}</button>) : <button className="ll-text-button ll-muted" onClick={() => onCollection(collection.id, lifeLink.id, "__unsectioned")}>Unsectioned</button>}</div>
      </div>)}
    </section>
    {lifeLink.body && <section className="ll-detail-section"><h3>Notes</h3><RichBodyRenderer body={lifeLink.body} bodyDoc={lifeLink.bodyDoc} /></section>}
    <section className="ll-detail-section" aria-labelledby="ll-attachments-heading"><h3 id="ll-attachments-heading">Attachments</h3>
      <p className="ll-muted ll-attachment-privacy">Attachments stay private. Your connected agent can read supported document text.</p>
      {lifeLink.media.length ? <AttachmentList attachments={lifeLink.media} lifeLinkId={lifeLink.id} /> : <p className="ll-muted">No attachments</p>}
    </section>
    <details className="ll-record-meta"><summary>Record details</summary><dl><dt>Life Link ID</dt><dd>{lifeLink.id}</dd><dt>Updated</dt><dd>{new Date(lifeLink.updatedAt).toLocaleString()}</dd>{lifeLink.qrId && <><dt>QR code</dt><dd>{lifeLink.qrId}</dd></>}</dl></details>
  </article>;
}
