import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalLifeLink, createLinkBodyDocFromPlainText } from "@life-links/core";

import {
  canonicalLifeLinkDraftKey,
  canonicalLifeLinkEditorPatchIsDirty,
  canonicalLifeLinkEditorStateFromRecord,
  clearCanonicalLifeLinkDraft,
  linkEditorDraftKey,
  readCanonicalLifeLinkDraft,
  writeCanonicalLifeLinkDraft
} from "./editorSession";

describe("canonical Life Link draft recovery", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a compatible QR-keyed draft exactly once under stable Life Link identity", () => {
    const bodyDoc = createLinkBodyDocFromPlainText("Recovered note");
    seedEarlierDraft("LL-DEMO-00001", "2026-08-26T00:00:00.000Z", {
      title: "Recovered",
      body: "Recovered note",
      bodyDoc,
      bodyDocVersion: 1,
      privacy: "private"
    });

    expect(
      readCanonicalLifeLinkDraft("life-link-1", "LL-DEMO-00001", "2026-08-26T00:00:00.000Z")
    ).toMatchObject({
      version: 2,
      lifeLinkId: "life-link-1",
      lifeLinkUpdatedAt: "2026-08-26T00:00:00.000Z",
      migratedFromQrId: "LL-DEMO-00001",
      patch: {
        title: "Recovered",
        body: "Recovered note",
        privacy: "private"
      }
    });
    expect(storage.getItem(linkEditorDraftKey("LL-DEMO-00001"))).toBeNull();
    expect(JSON.parse(storage.getItem(canonicalLifeLinkDraftKey("life-link-1")) ?? "null")).toMatchObject({
      version: 2,
      lifeLinkId: "life-link-1",
      migratedFromQrId: "LL-DEMO-00001"
    });

    expect(
      readCanonicalLifeLinkDraft("life-link-1", "LL-DEMO-OTHER", "2026-08-26T01:00:00.000Z")?.patch.title
    ).toBe("Recovered");
  });

  it("ignores a stale legacy draft instead of offering it for canonical restore", () => {
    seedEarlierDraft("LL-DEMO-00001", "2026-08-25T00:00:00.000Z", {
      title: "Stale legacy draft",
      body: "Old body",
      bodyDoc: createLinkBodyDocFromPlainText("Old body"),
      bodyDocVersion: 1,
      privacy: "private"
    });

    expect(
      readCanonicalLifeLinkDraft("life-link-1", "LL-DEMO-00001", "2026-08-26T00:00:00.000Z")
    ).toBeNull();
    expect(storage.getItem(canonicalLifeLinkDraftKey("life-link-1"))).toBeNull();
    expect(storage.getItem(linkEditorDraftKey("LL-DEMO-00001"))).not.toBeNull();
  });

  it("does not migrate a legacy draft without the current QR binding", () => {
    seedEarlierDraft("LL-DEMO-00001", "2026-08-26T00:00:00.000Z", {
      title: "Bound elsewhere",
      body: "Body",
      bodyDoc: createLinkBodyDocFromPlainText("Body"),
      bodyDocVersion: 1,
      privacy: "private"
    });

    expect(
      readCanonicalLifeLinkDraft("life-link-1", null, "2026-08-26T00:00:00.000Z")
    ).toBeNull();
    expect(storage.getItem(canonicalLifeLinkDraftKey("life-link-1"))).toBeNull();
  });

  it("prefers the canonical draft and clears both identity keys after Save", () => {
    const patch = {
      title: "Canonical",
      body: "Body",
      bodyDoc: createLinkBodyDocFromPlainText("Body"),
      bodyDocVersion: 1,
      privacy: "private" as const
    };
    writeCanonicalLifeLinkDraft("life-link-1", "2026-08-26T00:00:00.000Z", patch);
    seedEarlierDraft("LL-DEMO-00001", "2026-08-26T00:00:00.000Z", patch);

    expect(
      readCanonicalLifeLinkDraft("life-link-1", "LL-DEMO-00001", "2026-08-26T01:00:00.000Z")?.patch.title
    ).toBe("Canonical");
    clearCanonicalLifeLinkDraft("life-link-1", "LL-DEMO-00001");
    expect(storage.getItem(canonicalLifeLinkDraftKey("life-link-1"))).toBeNull();
    expect(storage.getItem(linkEditorDraftKey("LL-DEMO-00001"))).toBeNull();
  });

  it("recovers structured context with the same immutable editor revision and detects context-only edits", () => {
    const lifeLink = createCanonicalLifeLink({ id: "life-link-1", ownerId: "owner-1", createdAt: "2026-08-26T00:00:00.000Z", title: "Pad" });
    const initial = canonicalLifeLinkEditorStateFromRecord(lifeLink);
    expect(canonicalLifeLinkEditorPatchIsDirty(lifeLink, initial)).toBe(false);
    const patch = { ...initial, context: { schemaVersion: 1 as const, experience: { text: "Cold through the ground", truthState: "owner_reported" as const } }, publicFieldKeys: ["experience" as const] };
    expect(canonicalLifeLinkEditorPatchIsDirty(lifeLink, patch)).toBe(true);
    writeCanonicalLifeLinkDraft(lifeLink.id, lifeLink.updatedAt, patch);
    expect(readCanonicalLifeLinkDraft(lifeLink.id, null, "newer-revision")).toMatchObject({
      lifeLinkUpdatedAt: lifeLink.updatedAt, patch
    });
  });
});

function seedEarlierDraft(qrId: string, linkUpdatedAt: string, patch: unknown) {
  window.localStorage.setItem(linkEditorDraftKey(qrId), JSON.stringify({
    version: 1, qrId, linkUpdatedAt, savedAt: linkUpdatedAt, patch
  }));
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}
