import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Check, Upload } from "lucide-react";
import {
  ATTACHMENT_FILE_ACCEPT,
  ATTACHMENT_FORMAT_LABEL,
  MAX_TITLE_LENGTH,
  LIFE_LINK_CONTEXT_FIELDS,
  createLinkBodyDocFromPlainText,
  type LifeLinkContext,
  type LifeLinkContextTruthState,
  type LifeLinkRecord,
  type PrivacyStatus
} from "@life-links/core";

import { Tooltip } from "../ui/Tooltip";
import { Dialog } from "./FieldLedgerPrimitives";
import { contextLabels, truthLabels } from "./LifeLinkDetail";
import { AttachmentList } from "./AttachmentList";
import {
  applyLinkEditorState,
  canonicalLifeLinkEditorPatchIsDirty,
  canonicalLifeLinkEditorStateFromRecord,
  clearCanonicalLifeLinkDraft,
  readCanonicalLifeLinkDraft,
  writeCanonicalLifeLinkDraft,
  type CanonicalLifeLinkDraft
} from "../workspace/editorSession";
import type { CanonicalLifeLinkEditorPatch } from "../workspace/types";

const RichBodyEditor = lazy(() =>
  import("../richBodyEditor").then((module) => ({ default: module.RichBodyEditor }))
);

type LifeLinkEditorProps = {
  mode: "canonical";
  link: LifeLinkRecord | null;
  busy: boolean;
  onClose: () => void;
  onSave: (lifeLinkId: string, expectedUpdatedAt: string, patch: CanonicalLifeLinkEditorPatch) => void;
  onUploadMedia: (lifeLinkId: string, files: FileList) => void;
  onDeleteMedia: (lifeLinkId: string, mediaId: string) => void;
};

export function LifeLinkEditor(props: LifeLinkEditorProps) {
  const { link, busy, onClose } = props;
  const initialState = link ? canonicalLifeLinkEditorStateFromRecord(link) : {
    title: "", body: "", bodyDoc: createLinkBodyDocFromPlainText(""), bodyDocVersion: 1, privacy: "private" as const
  };
  const [title, setTitle] = useState(initialState.title);
  const [body, setBody] = useState(initialState.body);
  const [bodyDoc, setBodyDoc] = useState(initialState.bodyDoc);
  const [bodyDocVersion, setBodyDocVersion] = useState(initialState.bodyDocVersion);
  const [privacy, setPrivacy] = useState<PrivacyStatus>(initialState.privacy);
  const [context, setContext] = useState<LifeLinkContext>(link?.context ?? { schemaVersion: 1 });
  const [draftMessage, setDraftMessage] = useState("");
  const [pendingDraft, setPendingDraft] = useState<CanonicalLifeLinkDraft | null>(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(link?.updatedAt ?? "");
  const [editorRevision, setEditorRevision] = useState(0);
  const bodyDocJson = useMemo(() => JSON.stringify(bodyDoc), [bodyDoc]);

  useEffect(() => {
    if (!link) return;
    const draft = readCanonicalLifeLinkDraft(link.id, link.qrId, link.updatedAt);
    const draftCurrent = draft?.lifeLinkUpdatedAt === link.updatedAt;
    applyLinkEditorState(draftCurrent ? draft.patch : canonicalLifeLinkEditorStateFromRecord(link), {
      setTitle, setBody, setBodyDoc, setBodyDocVersion, setPrivacy
    });
    setContext(draftCurrent ? draft.patch.context ?? link.context : link.context);
    setPendingDraft(draftCurrent ? null : draft);
    setBaseUpdatedAt(link.updatedAt);
    setDraftMessage(draftCurrent
      ? draft.migratedFromQrId ? "Draft recovered from this QR's earlier editor." : "Draft recovered from this browser."
      : draft ? "A saved draft exists from an older version of this link." : "");
    setEditorRevision((revision) => revision + 1);
  }, [link?.id, link?.updatedAt]);

  useEffect(() => {
    if (!link) return;
    const patch = { title, body, bodyDoc, bodyDocVersion, privacy, context };
    if (!canonicalLifeLinkEditorPatchIsDirty(link, patch)) return;
    const timer = window.setTimeout(() => {
      writeCanonicalLifeLinkDraft(link.id, baseUpdatedAt || link.updatedAt, patch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [body, bodyDocJson, bodyDocVersion, baseUpdatedAt, link, privacy, title, context]);

  function discardDraft() {
    if (!link) return;
    clearCanonicalLifeLinkDraft(link.id, link.qrId);
    applyLinkEditorState(canonicalLifeLinkEditorStateFromRecord(link), {
      setTitle, setBody, setBodyDoc, setBodyDocVersion, setPrivacy
    });
    setContext(link.context);
    setBaseUpdatedAt(link.updatedAt);
    setPendingDraft(null);
    setDraftMessage("");
    setEditorRevision((revision) => revision + 1);
  }

  function restorePendingDraft() {
    if (!pendingDraft || !link) return;
    applyLinkEditorState(pendingDraft.patch, { setTitle, setBody, setBodyDoc, setBodyDocVersion, setPrivacy });
    setContext(pendingDraft.patch.context ?? link.context);
    setBaseUpdatedAt(pendingDraft.lifeLinkUpdatedAt);
    setPendingDraft(null);
    setDraftMessage("Draft restored. Review before saving.");
    setEditorRevision((revision) => revision + 1);
  }

  if (!link) return null;

  return (
    <Dialog title="Edit Life Link" closeLabel="Close editor" wide onClose={() => {
      const patch = { title, body, bodyDoc, bodyDocVersion, privacy, context };
      if (canonicalLifeLinkEditorPatchIsDirty(link, patch)) {
        writeCanonicalLifeLinkDraft(link.id, baseUpdatedAt || link.updatedAt, patch);
      }
      onClose();
    }}>
      <form
        className="editor ll-record-editor"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave(link.id, baseUpdatedAt || link.updatedAt, { title, body, bodyDoc, bodyDocVersion, privacy, context });
        }}
      >
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
          <span>Notes</span>
          <Suspense fallback={<div className="rich-body-editor-loading">Loading body editor...</div>}>
            <RichBodyEditor
              label="Notes"
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
        {<section className="ll-context-editor" aria-label="Context fields">
          {LIFE_LINK_CONTEXT_FIELDS.map((key) => <div className="ll-context-editor-field" key={key}>
            <label><span>{contextLabels[key]}</span><textarea aria-label={contextLabels[key]} rows={2} value={context[key]?.text ?? ""} onChange={(event) => setContext((previous) => {
              const next = { ...previous };
              if (event.target.value.trim()) next[key] = { text: event.target.value, truthState: previous[key]?.truthState ?? "owner_reported" };
              else delete next[key];
              return next;
            })} /></label>
            <label><span>{contextLabels[key]} source</span><select aria-label={`${contextLabels[key]} source`} value={context[key]?.truthState ?? "owner_reported"} disabled={!context[key]?.text} onChange={(event) => setContext((previous) => ({ ...previous, [key]: { text: previous[key]?.text ?? "", truthState: event.target.value as LifeLinkContextTruthState } }))}>
              {Object.entries(truthLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>)}
        </section>}
        <div className="editor-grid">
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
            <span>Attachments</span>
            <label className="secondary-button upload-control" data-tooltip={`Attach ${ATTACHMENT_FORMAT_LABEL.toLowerCase()}.`}>
              <Upload size={18} />
              <span>Add</span>
              <Tooltip text={`Attach ${ATTACHMENT_FORMAT_LABEL.toLowerCase()}.`} />
              <input
                type="file"
                aria-label="Add attachments"
                accept={ATTACHMENT_FILE_ACCEPT}
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
          <p className="inline-note">{ATTACHMENT_FORMAT_LABEL}. Attachments stay private.</p>
          {link.media.length ? <AttachmentList attachments={link.media} lifeLinkId={link.id} compact busy={busy} onRemove={(mediaId) => props.onDeleteMedia(link.id, mediaId)} /> : <p className="inline-note">No attachments yet.</p>}
        </div>
        <button
          className="primary-button"
          type="submit"
          disabled={busy}
          data-tooltip="Save Life Link content and privacy changes."
        >
          <Check size={18} />
          <span>Save</span>
          <Tooltip text="Save Life Link content and privacy changes." />
        </button>
      </form>
    </Dialog>
  );
}
