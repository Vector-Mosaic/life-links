// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionChangePreview, CollectionRecord } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { CollectionChangeDialog, type CollectionChangeDraft } from "./CollectionChangeDialog";

const date = "2026-09-02T12:00:00.000Z";
const source: CollectionRecord = { id: "collection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ownerId: "owner-ui", title: "Camping", purpose: "", notes: "", createdAt: date, updatedAt: date };
const target: CollectionRecord = { ...source, id: "collection-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Travel" };
const deleting: CollectionChangeDraft = { operation: "delete", scope: "collections", collections: [{ collectionId: source.id, expectedUpdatedAt: date }] };
const preview: CollectionChangePreview = { domain: "collections", id: "preview-collection", input: deleting, collections: [source], sections: [], members: [], targetCollection: null, targetSection: null, createdAt: date,
  sideEffects: { collectionsRemoved: 1, sectionsRemoved: 0, sectionsMoved: 0, membershipsRemoved: 1, membershipsAdded: 0, assignmentsRemoved: 0, assignmentsAdded: 0, lifeLinksDeleted: 0 } };

describe("Collection bulk change dialog", () => {
  let root: Root; let host: HTMLDivElement; let controller: LifeLinksWorkspaceController;
  let prepare: ReturnType<typeof vi.fn>; let apply: ReturnType<typeof vi.fn>; let close: ReturnType<typeof vi.fn>; let applied: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    prepare = vi.fn().mockResolvedValue(preview); apply = vi.fn().mockResolvedValue({}); close = vi.fn(); applied = vi.fn();
    controller = { previewCollectionChange: prepare, applyCollectionChange: apply, loadCollections: vi.fn(), loadCollectionMoveTarget: vi.fn().mockResolvedValue({ collection: target, sections: [] }) } as unknown as LifeLinksWorkspaceController;
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function render(input: CollectionChangeDraft) { await act(async () => root.render(<CollectionChangeDialog input={input} controller={controller}
    snapshot={{ collections: [source, target], collectionsComplete: true } as LifeLinksWorkspaceSnapshot} onClose={close} onApplied={applied} />)); }
  async function click(name: string) { await act(async () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === name)!.click()); }
  it("previews without deleting, cancels without mutation, and explains physical record preservation", async () => {
    await render(deleting); expect(prepare).toHaveBeenCalledWith(deleting, expect.any(AbortSignal)); expect(apply).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("will not be deleted or moved"); await click("Cancel"); expect(close).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
  });
  it("applies one preview, retains it on error and retries without generating another selection", async () => {
    apply.mockRejectedValueOnce(new Error("Network interrupted")); await render(deleting); await click("Delete");
    expect(document.body.textContent).toContain("Network interrupted"); expect(applied).not.toHaveBeenCalled(); await click("Delete");
    expect(prepare).toHaveBeenCalledOnce(); expect(apply.mock.calls.map(([id]) => id)).toEqual([preview.id, preview.id]); expect(applied).toHaveBeenCalledOnce();
  });
  it("describes Section deletion as retaining items, never as a Section move", async () => {
    await render({ operation: "delete", scope: "contents", source: { collectionId: source.id, expectedUpdatedAt: date }, sectionIds: ["section-exact"], members: [] });
    expect(document.body.textContent).toContain("Deleting a Section leaves its items in the Collection.");
    expect(document.body.textContent).not.toContain("Sections keep their identities and bring their assignments.");
    expect(apply).not.toHaveBeenCalled();
  });
  it("pins the selected destination revision and preserves the source appearance in a move preview", async () => {
    const input: CollectionChangeDraft = { operation: "move", scope: "contents", source: { collectionId: source.id, expectedUpdatedAt: date }, sectionIds: [], members: [{ lifeLinkId: "life-link-tent", sourceSectionId: "section-exact" }] };
    await render(input); expect(prepare).not.toHaveBeenCalled();
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Destination Collection"]')!;
    await act(async () => { select.value = target.id; select.dispatchEvent(new Event("change", { bubbles: true })); }); await click("Review move");
    expect(prepare).toHaveBeenCalledWith({ ...input, target: { collectionId: target.id, expectedUpdatedAt: date, sectionId: null } }, expect.any(AbortSignal));
    expect(apply).not.toHaveBeenCalled();
    await click("Review again");
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Destination Collection"]')?.value).toBe(target.id);
  });
});
