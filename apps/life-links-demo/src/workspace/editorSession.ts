import {
  createLinkBodyDocFromPlainText,
  type LifeLinkRecord,
  type LinkBodyDoc,
  type PrivacyStatus
} from "@life-links/core";

import type { CanonicalLifeLinkEditorPatch } from "./types";

const LINK_EDITOR_DRAFT_STORAGE_PREFIX = "life-links-link-editor-draft-v1";
const CANONICAL_LIFE_LINK_DRAFT_STORAGE_PREFIX = "life-links-editor-draft-v2";

export type LinkEditorDraft = {
  version: 1;
  qrId: string;
  linkUpdatedAt: string;
  savedAt: string;
  patch: Pick<CanonicalLifeLinkEditorPatch, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy">;
};

export type CanonicalLifeLinkDraft = {
  version: 2;
  lifeLinkId: string;
  lifeLinkUpdatedAt: string;
  savedAt: string;
  migratedFromQrId?: string;
  patch: CanonicalLifeLinkEditorPatch;
};

export type LinkEditorStateSetters = {
  setTitle(value: string): void;
  setBody(value: string): void;
  setBodyDoc(value: LinkBodyDoc): void;
  setBodyDocVersion(value: number): void;
  setPrivacy(value: PrivacyStatus): void;
};

export function applyLinkEditorState(
  state: CanonicalLifeLinkEditorPatch,
  setters: LinkEditorStateSetters
) {
  setters.setTitle(state.title);
  setters.setBody(state.body);
  setters.setBodyDoc(state.bodyDoc ?? createLinkBodyDocFromPlainText(state.body));
  setters.setBodyDocVersion(state.bodyDocVersion ?? 1);
  setters.setPrivacy(state.privacy);
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
    privacy: lifeLink.privacy,
    context: lifeLink.context,
    publicFieldKeys: lifeLink.publicFieldKeys
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
    JSON.stringify(patch.bodyDoc) !== JSON.stringify(lifeLink.bodyDoc) ||
    (patch.context !== undefined && JSON.stringify(patch.context) !== JSON.stringify(lifeLink.context)) ||
    (patch.publicFieldKeys !== undefined && JSON.stringify(patch.publicFieldKeys) !== JSON.stringify(lifeLink.publicFieldKeys))
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
