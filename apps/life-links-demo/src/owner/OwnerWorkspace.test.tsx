// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalLifeLink, type CollectionRecord, type CollectionSectionRecord } from "@life-links/core";
import { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { OwnerWorkspace } from "./OwnerWorkspace";

const timestamp = "2026-09-02T12:00:00.000Z";
const collection: CollectionRecord = { id: "collection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ownerId: "owner-ui", title: "Camping", purpose: "", notes: "", createdAt: timestamp, updatedAt: timestamp };
const section: CollectionSectionRecord = { id: "section-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", collectionId: collection.id, ownerId: collection.ownerId, title: "Sleep", position: 0, createdAt: timestamp, updatedAt: timestamp };
const member = createCanonicalLifeLink({ id: "life-link-ui-tent", ownerId: collection.ownerId, parentId: null, title: "Tent", createdAt: timestamp });

describe("Collection owner workspace", () => {
  let root: Root; let host: HTMLDivElement; let snapshot: LifeLinksWorkspaceSnapshot;
  let controller: LifeLinksWorkspaceController;
  let actions: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    const baseline = new LifeLinksWorkspaceController();
    snapshot = { ...baseline.getSnapshot(), currentUser: { id: collection.ownerId, email: "owner@example.test", displayName: "Owner", createdAt: timestamp }, guestView: false,
      activeView: "workspace", workspaceMode: "collections", routePathname: `/collections/${collection.id}`, selectedCollection: collection,
      collections: [collection], collectionsComplete: true, collectionMembers: [member], collectionSections: [section], collectionComplete: true,
      collectionMemberMemberships: { [member.id]: [{ collection, sections: [section] }] }, collectionMemberDetails: {} };
    baseline.dispose();
    actions = { loadCollectionMemberDetails: vi.fn().mockResolvedValue(undefined), getSnapshot: vi.fn(() => snapshot),
      setCollectionPresentation: vi.fn((id, patch) => { snapshot = { ...snapshot, presentation: { ...snapshot.presentation, collections: { ...snapshot.presentation.collections,
        [id]: { ...(snapshot.presentation.collections[id] ?? { view: "sections", expandedGroups: [] }), ...patch } } } }; render(); }) };
    controller = new Proxy(actions, { get(target, key: string) { return target[key] ??= vi.fn(); } }) as unknown as LifeLinksWorkspaceController;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function render() { root.render(<OwnerWorkspace controller={controller} snapshot={snapshot} />); }
  function button(text: string) { const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text); expect(result, text).toBeTruthy(); return result!; }
  async function click(text: string) { await act(async () => button(text).click()); }

  it("initially shows unexpanded Section headings, with exact expand/collapse-all controls", async () => {
    await act(async () => render());
    expect(host.querySelectorAll(".ll-group-members")).toHaveLength(0);
    expect(host.textContent).toContain("Sleep");
    expect(actions.loadCollectionMemberDetails).toHaveBeenLastCalledWith([]);
    await click("Expand all");
    expect(host.querySelectorAll(".ll-group-members")).toHaveLength(2);
    expect(actions.loadCollectionMemberDetails).toHaveBeenLastCalledWith([member.id]);
    await click("Collapse all");
    expect(host.querySelectorAll(".ll-group-members")).toHaveLength(0);
  });

  it("Locations has its own initially unexpanded groups and Expand/Collapse all", async () => {
    snapshot.collectionMemberDetails = { [member.id]: { lifeLink: member, ancestry: { items: [], truncated: false, omittedCount: 0 }, children: [], childrenPage: { nextCursor: null, truncated: false } } };
    await act(async () => render()); await click("Locations");
    expect(host.querySelectorAll(".ll-group-members")).toHaveLength(0);
    await click("Expand all"); expect(host.querySelectorAll(".ll-group-members")).toHaveLength(1);
    await click("Collapse all"); expect(host.querySelectorAll(".ll-group-members")).toHaveLength(0);
    await click("Sections"); expect(host.querySelectorAll(".ll-group-members")).toHaveLength(0);
  });

  it("uses plus/Edit and selection bubbles, preserving the source Section of an item", async () => {
    await act(async () => render()); await click("Add to Camping"); await click("Edit");
    expect(host.querySelector('[aria-label="Edit Collections"]')).not.toBeNull();
    await click("Expand all");
    const checkbox = host.querySelector<HTMLInputElement>('[aria-label="Select Tent in Sleep"]')!;
    await act(async () => checkbox.click());
    expect(host.querySelector('[aria-label="Edit Collections"]')?.textContent).toContain("1 selected");
    expect(button("Move").disabled).toBe(false); expect(button("Delete").disabled).toBe(false);
    await click("Done"); expect(host.querySelectorAll(".ll-selection-dot")).toHaveLength(0);
  });

  it("Collection root has selection/Delete but never a Move Collections action", async () => {
    snapshot = { ...snapshot, selectedCollection: null, routePathname: "/collections" };
    await act(async () => render()); await click("Add to My Collections"); await click("Edit");
    const checkbox = host.querySelector<HTMLInputElement>('[aria-label="Select Camping"]')!;
    await act(async () => checkbox.click()); expect(button("Delete").disabled).toBe(false);
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Move")).toBe(false);
  });

  it("clears whole-membership selection when changing to a Section appearance view", async () => {
    await act(async () => render()); await click("All items"); await click("Add to Camping"); await click("Edit");
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select Tent"]')!.click());
    expect(button("Delete").disabled).toBe(false); await click("Sections");
    expect(host.querySelector('[aria-label="Edit Collections"]')?.textContent).toContain("0 selected");
    expect(button("Delete").disabled).toBe(true);
  });
});
