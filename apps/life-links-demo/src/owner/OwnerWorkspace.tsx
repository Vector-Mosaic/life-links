import { useState } from "react";
import { FolderTree, LoaderCircle, Move, Plus, QrCode, Search, X } from "lucide-react";
import {
  MAX_TITLE_LENGTH,
  deriveLifeLinkPhysicalLocator,
  formatRecordedLifeLinkPath
} from "@life-links/core";

import { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { LifeLinkDetail } from "./LifeLinkDetail";
import { LifeLinkTree } from "./LifeLinkTree";

type WorkspaceDialog =
  | { kind: "create"; parentId: string | null; parentTitle?: string }
  | { kind: "move"; lifeLinkId: string; targetTitle: string; parentId: string | null | undefined }
  | { kind: "attach"; lifeLinkId: string; targetTitle: string }
  | null;

export function OwnerWorkspace({
  controller,
  snapshot
}: {
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
}) {
  const [dialog, setDialog] = useState<WorkspaceDialog>(null);
  const [newTitle, setNewTitle] = useState("");
  const [qrInput, setQrInput] = useState("");
  const {
    rootLifeLinks,
    lifeLinkChildren,
    expandedLifeLinkIds,
    selectedLifeLinkId,
    selectedLifeLinkDetail,
    highlightedLifeLinkId,
    lifeLinkSearchQuery,
    lifeLinkSearchResults,
    lifeLinkSearchTotalCount,
    lifeLinkSearchNextCursor,
    lifeLinkSearchTruncated,
    lifeLinkSearchLoading,
    busy
  } = snapshot;

  function openCreate(parentId: string | null) {
    const parent = selectedLifeLinkDetail?.lifeLink.id === parentId
      ? selectedLifeLinkDetail.lifeLink
      : null;
    setNewTitle("");
    setDialog({
      kind: "create",
      parentId,
      parentTitle: parent ? parent.title || "Untitled Life Link" : undefined
    });
  }

  function selectedTargetSnapshot(lifeLinkId: string) {
    const target = selectedLifeLinkDetail?.lifeLink.id === lifeLinkId
      ? selectedLifeLinkDetail.lifeLink
      : null;
    return {
      targetTitle: target ? target.title || "Untitled Life Link" : "Life Link",
      parentId: target?.parentId
    };
  }

  function closeDialog() {
    setDialog(null);
    setNewTitle("");
    setQrInput("");
  }

  return (
    <section className="hierarchy-workspace" aria-label="My Life Links">
      <div className="panel hierarchy-toolbar">
        <div>
          <p className="eyebrow">Physical context at any depth</p>
          <h3>My Life Links</h3>
          <p className="panel-help">
            A Life Link can represent a place, container, object, or idea. Put as many layers inside one another as your real life needs.
          </p>
        </div>
        <button className="primary-button" onClick={() => openCreate(null)} disabled={busy}>
          <Plus size={18} />
          <span>New top-level Life Link</span>
        </button>
      </div>

      <div className="panel hierarchy-search-panel">
        <form
          className="hierarchy-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void controller.searchLifeLinks();
          }}
        >
          <Search size={18} />
          <input
            value={lifeLinkSearchQuery}
            onChange={(event) => controller.setLifeLinkSearchQuery(event.target.value)}
            placeholder="Search title, note, recorded path, or QR ID"
            aria-label="Search My Life Links"
          />
          <button className="secondary-button" type="submit" disabled={lifeLinkSearchLoading}>
            {lifeLinkSearchLoading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
            <span>Search</span>
          </button>
        </form>
        {lifeLinkSearchResults.length ? (
          <div className="hierarchy-search-results" aria-live="polite">
            <div className="hierarchy-search-summary">
              <span>{lifeLinkSearchTotalCount.toLocaleString()} result{lifeLinkSearchTotalCount === 1 ? "" : "s"}</span>
              {lifeLinkSearchTruncated ? <small>Showing a bounded page</small> : null}
            </div>
            {lifeLinkSearchResults.map((result) => {
              const isMoveTarget = dialog?.kind === "move";
              const isSelf = isMoveTarget && dialog.lifeLinkId === result.lifeLink.id;
              const physicalLocator = deriveLifeLinkPhysicalLocator(result.path);
              return (
                <div
                  className="hierarchy-search-result"
                  key={result.lifeLink.id}
                  data-life-link-search-id={result.lifeLink.id}
                  data-physical-locator-id={physicalLocator?.lifeLinkId}
                >
                  <button
                    className="hierarchy-search-open"
                    onClick={() => void controller.selectLifeLink({ lifeLinkId: result.lifeLink.id, source: "search" })}
                  >
                    <strong>{result.lifeLink.title || "Untitled Life Link"}</strong>
                    <span>{formatRecordedLifeLinkPath(result.path)}</span>
                    <span
                      className={physicalLocator ? "physical-locator-summary" : "physical-locator-summary unavailable"}
                    >
                      {physicalLocator
                        ? `Recorded QR locator: ${physicalLocator.title || "Untitled Life Link"} · ${physicalLocator.qrId}. Recorded placement, not live-location proof.`
                        : result.path.truncated
                          ? "No reliable QR locator can be derived from this bounded recorded path."
                          : "No QR-bound locator is recorded for this path."}
                    </span>
                    <small>{result.bodySummary || result.lifeLink.id}</small>
                  </button>
                  {isMoveTarget ? (
                    <button
                      className="secondary-button compact-button"
                      disabled={busy || isSelf}
                      onClick={() => {
                        void controller.moveLifeLink(dialog.lifeLinkId, result.lifeLink.id);
                        closeDialog();
                      }}
                    >
                      <Move size={15} />
                      <span>{isSelf ? "Current item" : "Move here"}</span>
                    </button>
                  ) : null}
                </div>
              );
            })}
            {lifeLinkSearchNextCursor ? (
              <button className="text-button hierarchy-search-more" onClick={() => void controller.searchLifeLinks(undefined, true)}>
                Load more search results
              </button>
            ) : null}
          </div>
        ) : lifeLinkSearchQuery.trim() && !lifeLinkSearchLoading ? (
          <p className="inline-note">No matching Life Links in this library.</p>
        ) : null}
      </div>

      {dialog ? (
        <div className="panel hierarchy-action-panel" role="region" aria-label={`${dialog.kind} Life Link`}>
          <div className="hierarchy-action-heading">
            <div>
              <strong>{dialogTitle(dialog)}</strong>
              {dialog.kind === "move" ? (
                <span>Search above, then choose an exact parent. The server rejects self, cross-owner, and cycle-producing moves.</span>
              ) : null}
            </div>
            <button className="icon-button" onClick={closeDialog} aria-label="Close Life Link action">
              <X size={17} />
            </button>
          </div>
          {dialog.kind === "create" ? (
            <form
              className="hierarchy-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void controller.createLifeLink({ parentId: dialog.parentId, title: newTitle });
                closeDialog();
              }}
            >
              <input
                autoFocus
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Life Link title"
                maxLength={MAX_TITLE_LENGTH}
              />
              <button className="primary-button" type="submit" disabled={busy || !newTitle.trim()}>
                <Plus size={17} />
                <span>Create</span>
              </button>
            </form>
          ) : null}
          {dialog.kind === "move" ? (
            <button
              className="secondary-button"
              onClick={() => {
                void controller.detachLifeLink(dialog.lifeLinkId);
                closeDialog();
              }}
              disabled={busy || dialog.parentId === null}
            >
              Move to top level
            </button>
          ) : null}
          {dialog.kind === "attach" ? (
            <form
              className="hierarchy-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void controller.attachQrToLifeLink(dialog.lifeLinkId, qrInput);
                closeDialog();
              }}
            >
              <QrCode size={18} />
              <input
                autoFocus
                value={qrInput}
                onChange={(event) => setQrInput(event.target.value)}
                placeholder="Scan or paste an unclaimed QR URL or ID"
              />
              <button className="primary-button" type="submit" disabled={busy || !qrInput.trim()}>
                Attach QR
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="hierarchy-main-grid">
        <div className="panel hierarchy-tree-panel">
          <div className="panel-title">
            <FolderTree size={18} />
            <h3>Hierarchy</h3>
          </div>
          <LifeLinkTree
            roots={rootLifeLinks.items}
            children={lifeLinkChildren}
            expandedIds={expandedLifeLinkIds}
            selectedId={selectedLifeLinkId}
            highlightedId={highlightedLifeLinkId}
            onToggle={(lifeLinkId) => void controller.toggleLifeLinkExpanded(lifeLinkId)}
            onSelect={(lifeLinkId) => void controller.selectLifeLink({ lifeLinkId, source: "human" })}
            onLoadMore={(parentId) => void controller.loadMoreLifeLinks(parentId)}
          />
          {rootLifeLinks.loading ? (
            <p className="inline-note"><LoaderCircle className="spin" size={15} /> Loading top-level Life Links...</p>
          ) : null}
          {rootLifeLinks.nextCursor ? (
            <button className="text-button hierarchy-root-more" onClick={() => void controller.loadMoreLifeLinks(null)}>
              Load more top-level Life Links
            </button>
          ) : null}
        </div>
        <div className="panel hierarchy-detail-panel">
          <LifeLinkDetail
            detail={selectedLifeLinkDetail}
            busy={busy}
            onSelect={(lifeLinkId) => void controller.selectLifeLink({ lifeLinkId, source: "human" })}
            onEdit={(lifeLinkId) => void controller.openCanonicalEditor(lifeLinkId)}
            onCreateChild={openCreate}
            onMove={(lifeLinkId) => setDialog({
              kind: "move",
              lifeLinkId,
              ...selectedTargetSnapshot(lifeLinkId)
            })}
            onDetach={(lifeLinkId) => void controller.detachLifeLink(lifeLinkId)}
            onAttachQr={(lifeLinkId) => {
              setQrInput("");
              setDialog({
                kind: "attach",
                lifeLinkId,
                targetTitle: selectedTargetSnapshot(lifeLinkId).targetTitle
              });
            }}
            onOpenQr={(qrId) => void controller.openQr(qrId)}
            onFind={(qrId) => {
              controller.selectFindTarget(qrId);
              controller.setActiveView("search");
            }}
          />
        </div>
      </div>
    </section>
  );
}

function dialogTitle(dialog: Exclude<WorkspaceDialog, null>) {
  if (dialog.kind === "create") {
    return dialog.parentId ? `Add inside ${dialog.parentTitle || "selected Life Link"}` : "New top-level Life Link";
  }
  if (dialog.kind === "move") {
    return `Move ${dialog.targetTitle}`;
  }
  return `Attach a QR to ${dialog.targetTitle}`;
}
