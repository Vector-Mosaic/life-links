import { useEffect, useId, useRef, useState } from "react";
import { Download, FileText, Image, Trash2, Video } from "lucide-react";
import { attachmentFormat, type AttachmentContentPage, type LifeLinkMediaRecord } from "@life-links/core";
import { getLifeLinkAttachmentContent } from "../api";

type Attachment = Pick<LifeLinkMediaRecord, "id" | "kind" | "mimeType" | "fileName" | "sizeBytes" | "url">;

export function AttachmentList({ attachments, lifeLinkId, compact = false, busy = false, onRemove }: {
  attachments: readonly Attachment[];
  lifeLinkId?: string;
  compact?: boolean;
  busy?: boolean;
  onRemove?(mediaId: string): void;
}) {
  return <div className={`ll-attachment-list${compact ? " ll-attachment-list-compact" : ""}`}>
    {attachments.map((attachment) => <AttachmentItem key={`${lifeLinkId ?? "qr"}:${attachment.id}`} attachment={attachment} lifeLinkId={lifeLinkId} compact={compact} busy={busy} onRemove={onRemove} />)}
  </div>;
}

function AttachmentItem({ attachment, lifeLinkId, compact, busy, onRemove }: {
  attachment: Attachment;
  lifeLinkId?: string;
  compact: boolean;
  busy: boolean;
  onRemove?(mediaId: string): void;
}) {
  const textId = useId();
  const request = useRef<AbortController | null>(null);
  const [content, setContent] = useState<AttachmentContentPage | null>(null);
  const [text, setText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), [lifeLinkId, attachment.id]);

  async function readText(append = false) {
    if (!lifeLinkId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setVisible(true);
    setLoading(true);
    setError("");
    try {
      const page = await getLifeLinkAttachmentContent(lifeLinkId, attachment.id, {
        ...(append && content ? { offset: content.nextOffset ?? 0, revision: content.revision } : {}),
        signal: controller.signal
      });
      if (controller.signal.aborted || request.current !== controller) return;
      setContent(page);
      setText((previous) => append ? previous + page.text : page.text);
      setWarnings((previous) => [...new Set([...(append ? previous : []), ...page.warnings])]);
    } catch (readError) {
      if (controller.signal.aborted || request.current !== controller) return;
      setError(readError instanceof Error ? readError.message : "The attachment text could not be loaded.");
    } finally {
      if (request.current === controller) setLoading(false);
    }
  }

  function toggleText() {
    if (visible) {
      request.current?.abort();
      setLoading(false);
      setVisible(false);
    } else if (content) setVisible(true);
    else void readText();
  }

  const Icon = attachment.kind === "image" ? Image : attachment.kind === "video" ? Video : FileText;
  const formatLabel = { text: "Text", pdf: "PDF", docx: "DOCX", xlsx: "XLSX", image: "Image", video: "Video" }[attachmentFormat(attachment.mimeType)];
  return <article className="ll-attachment" data-attachment-id={attachment.id} aria-label={attachment.fileName}>
    {!compact && attachment.kind === "image" && <a className="ll-attachment-preview" href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt={attachment.fileName} loading="lazy" /></a>}
    {!compact && attachment.kind === "video" && <video className="ll-attachment-preview" src={attachment.url} aria-label={attachment.fileName} controls preload="metadata" />}
    <div className="ll-attachment-info"><Icon size={18} aria-hidden="true" /><div><strong title={attachment.fileName}>{attachment.fileName}</strong><small title={attachment.mimeType}>{formatBytes(attachment.sizeBytes)} · {formatLabel}</small></div></div>
    <div className="ll-attachment-actions">
      <a href={attachment.url} download={attachment.fileName} aria-label={`Download ${attachment.fileName}`}><Download size={15} aria-hidden="true" />Download</a>
      {attachment.kind === "document" && lifeLinkId && <button type="button" aria-label={`${visible ? "Hide" : "Read"} text from ${attachment.fileName}`} aria-expanded={visible} aria-controls={textId} onClick={toggleText}>{visible ? "Hide text" : "Read text"}</button>}
      {onRemove && <button type="button" className="ll-attachment-remove" disabled={busy} aria-label={`Remove ${attachment.fileName}`} onClick={() => onRemove(attachment.id)}><Trash2 size={15} aria-hidden="true" />Remove</button>}
    </div>
    {visible && <div className="ll-attachment-text" id={textId} role="region" aria-label={`Text from ${attachment.fileName}`} aria-busy={loading}>
      {text && <><p className="ll-attachment-text-note">Extracted text; the original document may have a different layout.</p><pre>{text}</pre></>}
      {content?.status === "ready" && !text && content.nextOffset === null && <p role="status">No text was extracted from this attachment.</p>}
      {content?.status === "unreadable" && <p role="status">{unreadableMessage(content.reason)}</p>}
      {warnings.length > 0 && <ul className="ll-attachment-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      {loading && <p role="status">Loading attachment text…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => void readText(content?.nextOffset !== null && content !== null)}>Retry</button></p>}
      {content?.status === "ready" && content.nextOffset !== null && <button type="button" disabled={loading} aria-label={`Load more text from ${attachment.fileName}`} onClick={() => void readText(true)}>Load more text</button>}
    </div>}
  </article>;
}

function unreadableMessage(reason: AttachmentContentPage["reason"]): string {
  switch (reason) {
    case "unsupported_media": return "Text reading is not supported for this attachment. Download the original to view it.";
    case "scanned_or_no_text": return "No readable text was found. This may be a scan or image-only document; OCR is not available. Download the original to view it.";
    case "encrypted": return "This document is encrypted. Download and unlock the original to view it.";
    case "malformed": return "The document could not be read. Download the original to view it.";
    case "extraction_limit": return "The document exceeds the text-reading limit. Download the original to view the complete document.";
    case "extraction_timeout": return "Text extraction took too long. Download the original to view it.";
    default: return "Text is unavailable for this attachment. Download the original to view it.";
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`;
}
