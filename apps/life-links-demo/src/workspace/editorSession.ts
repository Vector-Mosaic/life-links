import {
  createLinkBodyDocFromPlainText,
  type LifeLinkRecord,
  type LinkBodyDoc,
  type LinkRecord,
  type PrivacyStatus
} from "@life-links/core";

import type { CanonicalLifeLinkEditorPatch, LinkEditorPatch } from "./types";

const LINK_EDITOR_DRAFT_STORAGE_PREFIX = "life-links-link-editor-draft-v1";
const CANONICAL_LIFE_LINK_DRAFT_STORAGE_PREFIX = "life-links-editor-draft-v2";

export type LinkEditorDraft = {
  version: 1;
  qrId: string;
  linkUpdatedAt: string;
  savedAt: string;
  patch: LinkEditorPatch;
};

export type CanonicalLifeLinkDraft = {
  version: 2;
  lifeLinkId: string;
  lifeLinkUpdatedAt: string;
  savedAt: string;
  migratedFromQrId?: string;
  patch: CanonicalLifeLinkEditorPatch;
};

export type LinkEditorState = {
  title: string;
  body: string;
  bodyDoc: LinkBodyDoc;
  bodyDocVersion: number;
  privacy: PrivacyStatus;
  projectId: string;
};

export type LinkEditorStateSetters = {
  setTitle(value: string): void;
  setBody(value: string): void;
  setBodyDoc(value: LinkBodyDoc): void;
  setBodyDocVersion(value: number): void;
  setPrivacy(value: PrivacyStatus): void;
  setProjectId(value: string): void;
};

export function linkEditorStateFromLink(link: LinkRecord | null): LinkEditorState {
  return {
    title: link?.title ?? "",
    body: link?.body ?? "",
    bodyDoc: link?.bodyDoc ?? createLinkBodyDocFromPlainText(link?.body ?? ""),
    bodyDocVersion: link?.bodyDocVersion ?? 1,
    privacy: link?.privacy ?? "public",
    projectId: link?.projectId ?? ""
  };
}

export function applyLinkEditorState(
  state: LinkEditorState | LinkEditorPatch | CanonicalLifeLinkEditorPatch,
  setters: LinkEditorStateSetters
) {
  setters.setTitle(state.title);
  setters.setBody(state.body);
  setters.setBodyDoc(state.bodyDoc ?? createLinkBodyDocFromPlainText(state.body));
  setters.setBodyDocVersion(state.bodyDocVersion ?? 1);
  setters.setPrivacy(state.privacy);
  setters.setProjectId("projectId" in state ? state.projectId ?? "" : "");
}

export function linkEditorPatchFromState(state: LinkEditorState): LinkEditorPatch {
  return {
    title: state.title,
    body: state.body,
    bodyDoc: state.bodyDoc,
    bodyDocVersion: state.bodyDocVersion,
    privacy: state.privacy,
    projectId: state.projectId || null
  };
}

export function linkEditorPatchIsDirty(link: LinkRecord, patch: LinkEditorPatch): boolean {
  return (
    patch.title !== link.title ||
    patch.body !== link.body ||
    patch.privacy !== link.privacy ||
    (patch.projectId ?? null) !== (link.projectId ?? null) ||
    patch.bodyDocVersion !== (link.bodyDocVersion ?? 1) ||
    JSON.stringify(patch.bodyDoc ?? null) !== JSON.stringify(link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body))
  );
}

export function linkEditorDraftKey(qrId: string): string {
  return `${LINK_EDITOR_DRAFT_STORAGE_PREFIX}:${qrId}`;
}

export function readLinkEditorDraft(qrId: string): LinkEditorDraft | null {
  try {
    const raw = window.localStorage.getItem(linkEditorDraftKey(qrId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LinkEditorDraft>;
    if (parsed.version !== 1 || parsed.qrId !== qrId || !parsed.patch) {
      return null;
    }
    return parsed as LinkEditorDraft;
  } catch {
    return null;
  }
}

export function writeLinkEditorDraft(qrId: string, linkUpdatedAt: string, patch: LinkEditorPatch) {
  try {
    const draft: LinkEditorDraft = {
      version: 1,
      qrId,
      linkUpdatedAt,
      savedAt: new Date().toISOString(),
      patch
    };
    window.localStorage.setItem(linkEditorDraftKey(qrId), JSON.stringify(draft));
  } catch {
    // Draft recovery is best-effort when storage is blocked or full.
  }
}

export function clearLinkEditorDraft(qrId: string) {
  try {
    window.localStorage.removeItem(linkEditorDraftKey(qrId));
  } catch {
    // The saved server state remains authoritative when local storage is unavailable.
  }
}

export function canonicalLifeLinkEditorStateFromRecord(lifeLink: LifeLinkRecord) {
  return {
    title: lifeLink.title,
    body: lifeLink.body,
    bodyDoc: lifeLink.bodyDoc ?? createLinkBodyDocFromPlainText(lifeLink.body),
    bodyDocVersion: lifeLink.bodyDocVersion ?? 1,
    privacy: lifeLink.privacy
  } satisfies CanonicalLifeLinkEditorPatch;
}

export function canonicalLifeLinkEditorPatchIsDirty(
  lifeLink: LifeLinkRecord,
  patch: CanonicalLifeLinkEditorPatch
): boolean {
  return (
    patch.title !== lifeLink.title ||
    patch.body !== lifeLink.body ||
    patch.privacy !== lifeLink.privacy ||
    patch.bodyDocVersion !== lifeLink.bodyDocVersion ||
    JSON.stringify(patch.bodyDoc) !== JSON.stringify(lifeLink.bodyDoc)
  );
}

export function canonicalLifeLinkDraftKey(lifeLinkId: string): string {
  return `${CANONICAL_LIFE_LINK_DRAFT_STORAGE_PREFIX}:${lifeLinkId}`;
}

export function readCanonicalLifeLinkDraft(
  lifeLinkId: string,
  qrId: string | null,
  lifeLinkUpdatedAt: string
): CanonicalLifeLinkDraft | null {
  try {
    const raw = window.localStorage.getItem(canonicalLifeLinkDraftKey(lifeLinkId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CanonicalLifeLinkDraft>;
      if (parsed.version === 2 && parsed.lifeLinkId === lifeLinkId && parsed.patch) {
        return parsed as CanonicalLifeLinkDraft;
      }
    }
    if (!qrId) {
      return null;
    }
    const legacy = readLinkEditorDraft(qrId);
    if (!legacy || legacy.linkUpdatedAt !== lifeLinkUpdatedAt) {
      return null;
    }
    const migrated: CanonicalLifeLinkDraft = {
      version: 2,
      lifeLinkId,
      lifeLinkUpdatedAt: legacy.linkUpdatedAt,
      savedAt: legacy.savedAt,
      migratedFromQrId: qrId,
      patch: {
        title: legacy.patch.title,
        body: legacy.patch.body,
        bodyDoc: legacy.patch.bodyDoc ?? createLinkBodyDocFromPlainText(legacy.patch.body),
        bodyDocVersion: legacy.patch.bodyDocVersion ?? 1,
        privacy: legacy.patch.privacy
      }
    };
    window.localStorage.setItem(canonicalLifeLinkDraftKey(lifeLinkId), JSON.stringify(migrated));
    window.localStorage.removeItem(linkEditorDraftKey(qrId));
    return migrated;
  } catch {
    return null;
  }
}

export function writeCanonicalLifeLinkDraft(
  lifeLinkId: string,
  lifeLinkUpdatedAt: string,
  patch: CanonicalLifeLinkEditorPatch
) {
  try {
    const draft: CanonicalLifeLinkDraft = {
      version: 2,
      lifeLinkId,
      lifeLinkUpdatedAt,
      savedAt: new Date().toISOString(),
      patch
    };
    window.localStorage.setItem(canonicalLifeLinkDraftKey(lifeLinkId), JSON.stringify(draft));
  } catch {
    // Draft recovery is best-effort when storage is blocked or full.
  }
}

export function clearCanonicalLifeLinkDraft(lifeLinkId: string, qrId: string | null) {
  try {
    window.localStorage.removeItem(canonicalLifeLinkDraftKey(lifeLinkId));
    if (qrId) {
      window.localStorage.removeItem(linkEditorDraftKey(qrId));
    }
  } catch {
    // The saved server state remains authoritative when local storage is unavailable.
  }
}
