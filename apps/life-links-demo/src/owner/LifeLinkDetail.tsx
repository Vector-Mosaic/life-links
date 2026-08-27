import { Camera, CornerUpLeft, Move, Pencil, Plus, QrCode } from "lucide-react";
import {
  deriveLifeLinkPhysicalLocator,
  type LifeLinkDetail as LifeLinkDetailRecord,
  type LifeLinkMediaRecord
} from "@life-links/core";

import { RichBodyRenderer } from "../richBody";
import { Tooltip } from "../ui/Tooltip";
import { LifeLinkBreadcrumbs } from "./LifeLinkBreadcrumbs";

export function LifeLinkDetail({
  detail,
  busy,
  onSelect,
  onEdit,
  onCreateChild,
  onMove,
  onDetach,
  onAttachQr,
  onOpenQr,
  onFind
}: {
  detail: LifeLinkDetailRecord | null;
  busy: boolean;
  onSelect(lifeLinkId: string): void;
  onEdit(lifeLinkId: string): void;
  onCreateChild(parentId: string): void;
  onMove(lifeLinkId: string): void;
  onDetach(lifeLinkId: string): void;
  onAttachQr(lifeLinkId: string): void;
  onOpenQr(qrId: string): void;
  onFind(qrId: string): void;
}) {
  if (!detail) {
    return (
      <div className="empty-state hierarchy-detail-empty">
        Select a Life Link to see its content, children, and physical QR binding.
      </div>
    );
  }

  const { lifeLink } = detail;
  const physicalLocator = deriveLifeLinkPhysicalLocator(detail.ancestry);
  return (
    <article className="life-link-owner-detail" data-selected-life-link-id={lifeLink.id}>
      <LifeLinkBreadcrumbs ancestry={detail.ancestry} onSelect={onSelect} />
      {detail.ancestry.truncated ? (
        <p className="hierarchy-bound-note">
          {detail.ancestry.omittedCount} middle path level{detail.ancestry.omittedCount === 1 ? " is" : "s are"} hidden here.
        </p>
      ) : null}
      <header className="life-link-detail-header">
        <div>
          <p className="eyebrow">My Life Links</p>
          <h3>{lifeLink.title || "Untitled Life Link"}</h3>
          <code>{lifeLink.id}</code>
        </div>
        <div className="life-link-detail-badges">
          <span className={`privacy-badge ${lifeLink.privacy}`}>{lifeLink.privacy}</span>
          <span className={lifeLink.qrId ? "qr-binding-badge attached" : "qr-binding-badge"}>
            <QrCode size={14} />
            {lifeLink.qrId ? lifeLink.qrId : "No QR attached"}
          </span>
        </div>
      </header>

      <section
        className="physical-locator-card"
        aria-label="Recorded QR locator"
        data-physical-locator-id={physicalLocator?.lifeLinkId}
        data-physical-locator-relation={physicalLocator?.relation}
      >
        <div className="physical-locator-heading">
          <div>
            <p className="eyebrow">Recorded QR locator</p>
            <strong>
              {physicalLocator
                ? physicalLocator.title || "Untitled Life Link"
                : "No reliable QR-bound locator"}
            </strong>
          </div>
          {physicalLocator ? (
            <span className="qr-binding-badge attached">
              <QrCode size={14} />
              {physicalLocator.qrId}
            </span>
          ) : null}
        </div>
        <p className="physical-locator-copy">
          {physicalLocator?.relation === "ancestor"
            ? "This Life Link is recorded inside this QR-bound ancestor. Recorded placement does not confirm current physical location."
            : physicalLocator?.relation === "self"
              ? "This Life Link's own QR is its recorded physical return point. Recorded placement does not confirm current physical location."
              : detail.ancestry.truncated
                ? "No reliable QR locator can be derived because the bounded recorded path omits possible ancestors."
                : "No QR-bound locator is recorded for this Life Link or its ancestors."}
        </p>
        {physicalLocator?.relation === "ancestor" ? (
          <div className="physical-locator-actions">
            <button className="secondary-button" onClick={() => onSelect(physicalLocator.lifeLinkId)} disabled={busy}>
              <QrCode size={17} />
              <span>Open recorded container</span>
            </button>
            <button className="secondary-button" onClick={() => onFind(physicalLocator.qrId)} disabled={busy}>
              <Camera size={17} />
              <span>Find recorded container</span>
            </button>
          </div>
        ) : null}
      </section>

      <div className="life-link-detail-body">
        {lifeLink.body ? (
          <RichBodyRenderer body={lifeLink.body} bodyDoc={lifeLink.bodyDoc} />
        ) : (
          <p className="inline-note">No note yet. Add details that help you or an assistant understand this place or object.</p>
        )}
        <CanonicalMediaGallery media={lifeLink.media} title={lifeLink.title || lifeLink.id} />
      </div>

      <div className="life-link-detail-actions">
        <button className="primary-button" onClick={() => onEdit(lifeLink.id)} disabled={busy}>
          <Pencil size={17} />
          <span>Edit</span>
        </button>
        <button className="secondary-button" onClick={() => onCreateChild(lifeLink.id)} disabled={busy}>
          <Plus size={17} />
          <span>Add inside</span>
        </button>
        <button className="secondary-button" onClick={() => onMove(lifeLink.id)} disabled={busy}>
          <Move size={17} />
          <span>Move</span>
        </button>
        <button
          className="secondary-button"
          onClick={() => onDetach(lifeLink.id)}
          disabled={busy || lifeLink.parentId === null}
          data-tooltip={lifeLink.parentId ? "Move this Life Link and its subtree to the top level." : "This Life Link is already top-level."}
        >
          <CornerUpLeft size={17} />
          <span>Move to top level</span>
          <Tooltip text={lifeLink.parentId ? "Move this Life Link and its subtree to the top level." : "This Life Link is already top-level."} />
        </button>
        {lifeLink.qrId ? (
          <>
            <button className="secondary-button" onClick={() => onOpenQr(lifeLink.qrId!)}>
              <QrCode size={17} />
              <span>Open QR page</span>
            </button>
            <button className="secondary-button" onClick={() => onFind(lifeLink.qrId!)}>
              <Camera size={17} />
              <span>Find Mode</span>
            </button>
          </>
        ) : (
          <button className="secondary-button" onClick={() => onAttachQr(lifeLink.id)} disabled={busy}>
            <QrCode size={17} />
            <span>Attach QR</span>
          </button>
        )}
      </div>
    </article>
  );
}

function CanonicalMediaGallery({ media, title }: { media: LifeLinkMediaRecord[]; title: string }) {
  if (!media.length) {
    return null;
  }
  return (
    <div className="media-gallery life-link-media-gallery">
      {media.map((item) => (
        <figure key={item.id} className="media-frame">
          {item.kind === "image" ? (
            <img src={item.url} alt={`${title} attachment`} loading="lazy" />
          ) : (
            <video src={item.url} controls preload="metadata" />
          )}
        </figure>
      ))}
    </div>
  );
}
