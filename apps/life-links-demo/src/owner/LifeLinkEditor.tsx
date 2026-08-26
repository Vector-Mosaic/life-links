import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Check, Image, Trash2, Upload, Video, X } from "lucide-react";
import { MAX_TITLE_LENGTH, type LinkRecord, type PrivacyStatus, type ProjectRecord } from "@life-links/core";

import { Tooltip } from "../ui/Tooltip";
import {
  applyLinkEditorState,
  clearLinkEditorDraft,
  linkEditorPatchFromState,
  linkEditorPatchIsDirty,
  linkEditorStateFromLink,
  readLinkEditorDraft,
  writeLinkEditorDraft,
  type LinkEditorDraft
} from "../workspace/editorSession";
import type { LinkEditorPatch } from "../workspace/types";

const RichBodyEditor = lazy(() =>
  import("../richBodyEditor").then((module) => ({ default: module.RichBodyEditor }))
);

export function LifeLinkEditor({
  link,
  projects,
  busy,
  onClose,
  onSave,
  onUploadMedia,
  onDeleteMedia
}: {
  link: LinkRecord | null;
  projects: ProjectRecord[];
  busy: boolean;
  onClose: () => void;
  onSave: (qrId: string, patch: LinkEditorPatch) => void;
  onUploadMedia: (qrId: string, files: FileList) => void;
  onDeleteMedia: (qrId: string, mediaId: string) => void;
}) {
  const initialState = linkEditorStateFromLink(link);
  const [title, setTitle] = useState(initialState.title);
  const [body, setBody] = useState(initialState.body);
  const [bodyDoc, setBodyDoc] = useState(initialState.bodyDoc);
  const [bodyDocVersion, setBodyDocVersion] = useState(initialState.bodyDocVersion);
  const [privacy, setPrivacy] = useState<PrivacyStatus>(initialState.privacy);
  const [projectId, setProjectId] = useState(initialState.projectId);
  const [draftMessage, setDraftMessage] = useState("");
  const [pendingDraft, setPendingDraft] = useState<LinkEditorDraft | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const bodyDocJson = useMemo(() => JSON.stringify(bodyDoc), [bodyDoc]);

  useEffect(() => {
    if (!link) {
      return;
    }
    const draft = readLinkEditorDraft(link.id);
    const baseState = linkEditorStateFromLink(link);
    if (draft?.linkUpdatedAt === link.updatedAt) {
      applyLinkEditorState(draft.patch, {
        setTitle,
        setBody,
        setBodyDoc,
        setBodyDocVersion,
        setPrivacy,
        setProjectId
      });
      setPendingDraft(null);
      setDraftMessage("Draft recovered from this browser.");
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
    setDraftMessage(draft ? "A saved draft exists from an older version of this link." : "");
    setEditorRevision((revision) => revision + 1);
  }, [link?.id]);

  useEffect(() => {
    if (!link) {
      return;
    }
    const patch = linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId });
    if (!linkEditorPatchIsDirty(link, patch)) {
      return;
    }
    const timer = window.setTimeout(() => {
      writeLinkEditorDraft(link.id, link.updatedAt, patch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [body, bodyDocJson, bodyDocVersion, link, privacy, projectId, title]);

  function discardDraft() {
    if (!link) {
      return;
    }
    clearLinkEditorDraft(link.id);
    applyLinkEditorState(linkEditorStateFromLink(link), {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(null);
    setDraftMessage("");
    setEditorRevision((revision) => revision + 1);
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
          onSave(link.id, linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId }));
        }}
      >
        <div className="editor-header">
          <div>
            <span>Edit link</span>
            <strong>{link.id}</strong>
          </div>
          <button type="button" className="icon-button" onClick={onClose} data-tooltip="Close the editor without saving." aria-label="Close editor">
            <X size={18} />
            <Tooltip text="Close the editor without saving." />
          </button>
        </div>
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_TITLE_LENGTH} />
        </label>
        {draftMessage ? (
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
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
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
                    onUploadMedia(link.id, files);
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
                      onClick={() => onDeleteMedia(link.id, item.id)}
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
        <button className="primary-button" type="submit" disabled={busy} data-tooltip="Save link content, project, privacy, and media changes.">
          <Check size={18} />
          <span>Save</span>
          <Tooltip text="Save link content, project, privacy, and media changes." />
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
