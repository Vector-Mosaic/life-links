import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Check, Image, Trash2, Upload, Video, X } from "lucide-react";
import {
  MAX_TITLE_LENGTH,
  type LifeLinkRecord,
  type LinkRecord,
  type PrivacyStatus,
  type ProjectRecord
} from "@life-links/core";

import { Tooltip } from "../ui/Tooltip";
import {
  applyLinkEditorState,
  canonicalLifeLinkEditorPatchIsDirty,
  canonicalLifeLinkEditorStateFromRecord,
  clearCanonicalLifeLinkDraft,
  clearLinkEditorDraft,
  linkEditorPatchFromState,
  linkEditorPatchIsDirty,
  linkEditorStateFromLink,
  readCanonicalLifeLinkDraft,
  readLinkEditorDraft,
  writeCanonicalLifeLinkDraft,
  writeLinkEditorDraft,
  type CanonicalLifeLinkDraft,
  type LinkEditorDraft
} from "../workspace/editorSession";
import {
  applyAgentDraftToEditorContent,
  type AgentDraftEditorContent
} from "./agentDraft";
import type {
  AgentLifeLinkDraftProposal,
  CanonicalLifeLinkEditorPatch,
  LinkEditorPatch
} from "../workspace/types";

const RichBodyEditor = lazy(() =>
  import("../richBodyEditor").then((module) => ({ default: module.RichBodyEditor }))
);

type LegacyLifeLinkEditorProps = {
  mode?: "legacy-qr";
  link: LinkRecord | null;
  projects: ProjectRecord[];
  busy: boolean;
  onClose: () => void;
  onSave: (qrId: string, patch: LinkEditorPatch) => void;
  onUploadMedia: (qrId: string, files: FileList) => void;
  onDeleteMedia: (qrId: string, mediaId: string) => void;
};

type CanonicalLifeLinkEditorProps = {
  mode: "canonical";
  link: LifeLinkRecord | null;
  agentDraftProposal?: AgentLifeLinkDraftProposal | null;
  busy: boolean;
  onClose: () => void;
  onDiscardAgentDraft?: () => void;
  onSave: (lifeLinkId: string, expectedUpdatedAt: string, patch: CanonicalLifeLinkEditorPatch) => void;
  onUploadMedia: (lifeLinkId: string, files: FileList) => void;
  onDeleteMedia: (lifeLinkId: string, mediaId: string) => void;
};

type LifeLinkEditorProps = LegacyLifeLinkEditorProps | CanonicalLifeLinkEditorProps;

type AgentDraftEditorCheckpoint = {
  lifeLinkId: string;
  content: AgentDraftEditorContent;
  projectId: string;
  pendingDraft: LinkEditorDraft | CanonicalLifeLinkDraft | null;
  draftMessage: string;
  canonicalBaseUpdatedAt: string;
};

export function LifeLinkEditor(props: LifeLinkEditorProps) {
  const { link, busy, onClose } = props;
  const canonical = props.mode === "canonical";
  const initialState = canonical && link
    ? { ...canonicalLifeLinkEditorStateFromRecord(link as LifeLinkRecord), projectId: "" }
    : linkEditorStateFromLink(link as LinkRecord | null);
  const [title, setTitle] = useState(initialState.title);
  const [body, setBody] = useState(initialState.body);
  const [bodyDoc, setBodyDoc] = useState(initialState.bodyDoc);
  const [bodyDocVersion, setBodyDocVersion] = useState(initialState.bodyDocVersion);
  const [privacy, setPrivacy] = useState<PrivacyStatus>(initialState.privacy);
  const [projectId, setProjectId] = useState(initialState.projectId);
  const [draftMessage, setDraftMessage] = useState("");
  const [pendingDraft, setPendingDraft] = useState<LinkEditorDraft | CanonicalLifeLinkDraft | null>(null);
  const [canonicalBaseUpdatedAt, setCanonicalBaseUpdatedAt] = useState(
    canonical && link ? link.updatedAt : ""
  );
  const [editorRevision, setEditorRevision] = useState(0);
  const [appliedAgentDraftCreatedAt, setAppliedAgentDraftCreatedAt] = useState<string | null>(null);
  const [agentDraftCheckpoint, setAgentDraftCheckpoint] = useState<AgentDraftEditorCheckpoint | null>(null);
  const bodyDocJson = useMemo(() => JSON.stringify(bodyDoc), [bodyDoc]);
  const agentDraftProposal = canonical ? props.agentDraftProposal ?? null : null;
  const currentAgentDraftProposal =
    canonical &&
    link &&
    agentDraftProposal?.lifeLinkId === link.id &&
    agentDraftProposal.baseUpdatedAt === link.updatedAt
      ? agentDraftProposal
      : null;

  useEffect(() => {
    if (!link) {
      return;
    }
    const draft = canonical
      ? readCanonicalLifeLinkDraft(link.id, (link as LifeLinkRecord).qrId, link.updatedAt)
      : readLinkEditorDraft(link.id);
    const baseState = canonical
      ? canonicalLifeLinkEditorStateFromRecord(link as LifeLinkRecord)
      : linkEditorStateFromLink(link as LinkRecord);
    const draftUpdatedAt = draft?.version === 2 ? draft.lifeLinkUpdatedAt : draft?.linkUpdatedAt;
    if (draft && draftUpdatedAt === link.updatedAt) {
      applyLinkEditorState(draft.patch, {
        setTitle,
        setBody,
        setBodyDoc,
        setBodyDocVersion,
        setPrivacy,
        setProjectId
      });
      setPendingDraft(null);
      if (canonical) {
        setCanonicalBaseUpdatedAt(draftUpdatedAt);
      }
      setDraftMessage(
        draft.version === 2 && draft.migratedFromQrId
          ? "Draft recovered from this QR's earlier editor."
          : "Draft recovered from this browser."
      );
      setEditorRevision((revision) => revision + 1);
      return;
    }
    applyLinkEditorState(baseState, {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(draft);
    if (canonical) {
      setCanonicalBaseUpdatedAt(link.updatedAt);
    }
    setDraftMessage(draft ? "A saved draft exists from an older version of this link." : "");
    setEditorRevision((revision) => revision + 1);
  }, [canonical, link?.id, link?.updatedAt]);

  useEffect(() => {
    if (
      appliedAgentDraftCreatedAt &&
      agentDraftCheckpoint &&
      agentDraftCheckpoint.lifeLinkId === link?.id &&
      agentDraftProposal?.createdAt !== appliedAgentDraftCreatedAt
    ) {
      applyLinkEditorState(agentDraftCheckpoint.content, {
        setTitle,
        setBody,
        setBodyDoc,
        setBodyDocVersion,
        setPrivacy,
        setProjectId
      });
      setProjectId(agentDraftCheckpoint.projectId);
      setPendingDraft(agentDraftCheckpoint.pendingDraft);
      setDraftMessage(agentDraftCheckpoint.draftMessage);
      setCanonicalBaseUpdatedAt(agentDraftCheckpoint.canonicalBaseUpdatedAt);
      setEditorRevision((revision) => revision + 1);
    }
    setAppliedAgentDraftCreatedAt(null);
    setAgentDraftCheckpoint(null);
  }, [agentDraftProposal?.createdAt, link?.id, link?.updatedAt]);

  useEffect(() => {
    if (!link) {
      return;
    }
    if (appliedAgentDraftCreatedAt) {
      return;
    }
    const patch = linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId });
    const canonicalPatch: CanonicalLifeLinkEditorPatch = { title, body, bodyDoc, bodyDocVersion, privacy };
    const dirty = canonical
      ? canonicalLifeLinkEditorPatchIsDirty(link as LifeLinkRecord, canonicalPatch)
      : linkEditorPatchIsDirty(link as LinkRecord, patch);
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      if (canonical) {
        writeCanonicalLifeLinkDraft(link.id, canonicalBaseUpdatedAt || link.updatedAt, canonicalPatch);
      } else {
        writeLinkEditorDraft(link.id, link.updatedAt, patch);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [appliedAgentDraftCreatedAt, body, bodyDocJson, bodyDocVersion, canonical, canonicalBaseUpdatedAt, link, privacy, projectId, title]);

  function discardDraft() {
    if (!link) {
      return;
    }
    if (canonical) {
      clearCanonicalLifeLinkDraft(link.id, (link as LifeLinkRecord).qrId);
    } else {
      clearLinkEditorDraft(link.id);
    }
    const baseState = canonical
      ? canonicalLifeLinkEditorStateFromRecord(link as LifeLinkRecord)
      : linkEditorStateFromLink(link as LinkRecord);
    applyLinkEditorState(baseState, {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(null);
    if (canonical) {
      setCanonicalBaseUpdatedAt(link.updatedAt);
    }
    setDraftMessage("");
    setEditorRevision((revision) => revision + 1);
  }

  function applyAgentDraft() {
    if (!currentAgentDraftProposal || appliedAgentDraftCreatedAt) {
      return;
    }
    setAgentDraftCheckpoint({
      lifeLinkId: currentAgentDraftProposal.lifeLinkId,
      content: { title, body, bodyDoc, bodyDocVersion, privacy },
      projectId,
      pendingDraft,
      draftMessage,
      canonicalBaseUpdatedAt
    });
    const next = applyAgentDraftToEditorContent(
      { title, body, bodyDoc, bodyDocVersion, privacy },
      currentAgentDraftProposal
    );
    setTitle(next.title);
    setBody(next.body);
    setBodyDoc(next.bodyDoc);
    setBodyDocVersion(next.bodyDocVersion);
    setPrivacy(next.privacy);
    setAppliedAgentDraftCreatedAt(currentAgentDraftProposal.createdAt);
    setEditorRevision((revision) => revision + 1);
  }

  function dismissAgentDraft() {
    if (agentDraftCheckpoint && appliedAgentDraftCreatedAt) {
      applyLinkEditorState(agentDraftCheckpoint.content, {
        setTitle,
        setBody,
        setBodyDoc,
        setBodyDocVersion,
        setPrivacy,
        setProjectId
      });
      setProjectId(agentDraftCheckpoint.projectId);
      setPendingDraft(agentDraftCheckpoint.pendingDraft);
      setDraftMessage(agentDraftCheckpoint.draftMessage);
      setCanonicalBaseUpdatedAt(agentDraftCheckpoint.canonicalBaseUpdatedAt);
      setEditorRevision((revision) => revision + 1);
    }
    setAppliedAgentDraftCreatedAt(null);
    setAgentDraftCheckpoint(null);
    if (props.mode === "canonical") {
      props.onDiscardAgentDraft?.();
    }
  }

  function restorePendingDraft() {
    if (!pendingDraft) {
      return;
    }
    applyLinkEditorState(pendingDraft.patch, {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    if (canonical && pendingDraft.version === 2) {
      setCanonicalBaseUpdatedAt(pendingDraft.lifeLinkUpdatedAt);
    }
    setPendingDraft(null);
    setDraftMessage("Draft restored. Review before saving.");
    setEditorRevision((revision) => revision + 1);
  }

  if (!link) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.mode === "canonical") {
            props.onSave(
              link.id,
              canonicalBaseUpdatedAt || link.updatedAt,
              { title, body, bodyDoc, bodyDocVersion, privacy }
            );
          } else {
            props.onSave(link.id, linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId }));
          }
        }}
      >
        <div className="editor-header">
          <div>
            <span>{canonical ? "Edit Life Link" : "Edit link"}</span>
            <strong>{link.id}</strong>
          </div>
          <button type="button" className="icon-button" onClick={onClose} data-tooltip="Close the editor without saving." aria-label="Close editor">
            <X size={18} />
            <Tooltip text="Close the editor without saving." />
          </button>
        </div>
        {canonical && currentAgentDraftProposal ? (
          <section className="agent-draft-review" aria-labelledby="agent-draft-review-title">
            <div className="agent-draft-review-heading">
              <div>
                <strong id="agent-draft-review-title">Agent draft — not saved</strong>
                <span>
                  Proposed fields: {currentAgentDraftProposal.proposedFields.join(" and ")}. Privacy, hierarchy, QR, and media remain unchanged.
                </span>
              </div>
              <span className="agent-draft-privacy">Privacy unchanged: {link.privacy}</span>
            </div>
            <div className="agent-draft-comparison">
              <div>
                <span>Before</span>
                <strong>{currentAgentDraftProposal.before.title || "Untitled Life Link"}</strong>
                <pre>{currentAgentDraftProposal.before.body || "No body text"}</pre>
              </div>
              <div>
                <span>Proposed</span>
                <strong>{currentAgentDraftProposal.after.title || "Untitled Life Link"}</strong>
                <pre>{currentAgentDraftProposal.after.body || "No body text"}</pre>
              </div>
            </div>
            {currentAgentDraftProposal.sourceLifeLinkIds.length ? (
              <div className="agent-draft-sources" aria-label="Authorized source Life Links">
                <span>Sources</span>
                {currentAgentDraftProposal.sourceLifeLinkIds.map((lifeLinkId) => (
                  <code key={lifeLinkId}>{lifeLinkId}</code>
                ))}
              </div>
            ) : (
              <p className="inline-note">No source Life Links were supplied.</p>
            )}
            <div className="agent-draft-actions">
              {appliedAgentDraftCreatedAt === currentAgentDraftProposal.createdAt ? (
                <span role="status">Applied to the editor, but still not saved.</span>
              ) : (
                <button type="button" className="secondary-button" onClick={applyAgentDraft} disabled={busy}>
                  Apply proposal
                </button>
              )}
              <button type="button" className="text-button" onClick={dismissAgentDraft} disabled={busy}>
                {appliedAgentDraftCreatedAt === currentAgentDraftProposal.createdAt
                  ? "Undo and dismiss"
                  : "Dismiss proposal"}
              </button>
            </div>
          </section>
        ) : null}
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_TITLE_LENGTH} />
        </label>
        {draftMessage && !appliedAgentDraftCreatedAt ? (
          <div className={pendingDraft ? "draft-notice conflict" : "draft-notice"} role="status">
            <span>{draftMessage}</span>
            <span className="draft-actions">
              {pendingDraft ? (
                <button type="button" className="text-button" onClick={restorePendingDraft}>
                  Restore
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={discardDraft}>
                Discard draft
              </button>
            </span>
          </div>
        ) : null}
        <label>
          <span>Body</span>
          <Suspense fallback={<div className="rich-body-editor-loading">Loading body editor...</div>}>
            <RichBodyEditor
              contentKey={`${link.id}:${editorRevision}`}
              value={bodyDoc}
              fallbackBody={body}
              disabled={busy}
              onChange={(next) => {
                setBody(next.body);
                setBodyDoc(next.bodyDoc);
                setBodyDocVersion(next.bodyDocVersion);
              }}
            />
          </Suspense>
        </label>
        <div className="editor-grid">
          {props.mode !== "canonical" ? (
            <label>
              <span>Project</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">None</option>
                {props.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>Privacy</span>
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyStatus)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
        <div className="media-editor">
          <div className="media-editor-header">
            <span>Media</span>
            <label className="secondary-button upload-control" data-tooltip="Attach images or videos to this QR result.">
              <Upload size={18} />
              <span>Add</span>
              <Tooltip text="Attach images or videos to this QR result." />
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                disabled={busy}
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files?.length) {
                    props.onUploadMedia(link.id, files);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {link.media.length ? (
            <div className="media-list">
              {link.media.map((item) => {
                const Icon = item.kind === "image" ? Image : Video;
                return (
                  <div key={item.id} className="media-item">
                    <Icon size={18} />
                    <span>{item.fileName}</span>
                    <small>{formatBytes(item.sizeBytes)}</small>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => props.onDeleteMedia(link.id, item.id)}
                      disabled={busy}
                      data-tooltip="Remove this media attachment."
                      aria-label={`Remove ${item.fileName}`}
                    >
                      <Trash2 size={18} />
                      <Tooltip text="Remove this media attachment." />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="inline-note">No media attached yet.</p>
          )}
        </div>
        <button
          className="primary-button"
          type="submit"
          disabled={busy}
          data-tooltip={canonical ? "Save Life Link content and privacy changes." : "Save link content, project, privacy, and media changes."}
        >
          <Check size={18} />
          <span>Save</span>
          <Tooltip text={canonical ? "Save Life Link content and privacy changes." : "Save link content, project, privacy, and media changes."} />
        </button>
      </form>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.ceil(value / 1024)} KB`;
  }
  return `${value} B`;
}
