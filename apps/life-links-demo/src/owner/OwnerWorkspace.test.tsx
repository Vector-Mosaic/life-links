// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalLifeLink, summarizeLifeLink, type CollectionRecord, type CollectionSectionRecord, type LifeLinkSummary } from "@life-links/core";
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
      loadCalendarClock: vi.fn().mockResolvedValue(undefined), loadCalendarWindow: vi.fn().mockResolvedValue(undefined),
      setCollectionPresentation: vi.fn((id, patch) => { snapshot = { ...snapshot, presentation: { ...snapshot.presentation, collections: { ...snapshot.presentation.collections,
        [id]: { ...(snapshot.presentation.collections[id] ?? { view: "sections", expandedGroups: [] }), ...patch } } } }; render(); }) };
    controller = new Proxy(actions, { get(target, key: string) { return target[key] ??= vi.fn(); } }) as unknown as LifeLinksWorkspaceController;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function render() { root.render(<OwnerWorkspace controller={controller} snapshot={snapshot} />); }
  function button(text: string) { const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text); expect(result, text).toBeTruthy(); return result!; }
  async function click(text: string) { await act(async () => button(text).click()); }

  function hierarchyFixture() {
    const folder = createCanonicalLifeLink({ id: "hierarchy-storage", ownerId: collection.ownerId, title: "Storage", browsingRole: "container", createdAt: timestamp });
    const nested = createCanonicalLifeLink({ id: "hierarchy-tub", ownerId: collection.ownerId, parentId: folder.id, title: "Gear tub", browsingRole: "container", createdAt: timestamp });
    const item = createCanonicalLifeLink({ id: "hierarchy-pump", ownerId: collection.ownerId, parentId: nested.id, title: "Mini pump", browsingRole: "item", createdAt: timestamp });
    const outside = createCanonicalLifeLink({ id: "hierarchy-other", ownerId: collection.ownerId, title: "Other branch", browsingRole: "container", createdAt: timestamp });
    const branch = (items: LifeLinkSummary[]) => ({ items, loaded: true, loading: false, nextCursor: null, truncated: false });
    snapshot = { ...snapshot, workspaceMode: "hierarchies", selectedCollection: null, routePathname: "/life-links",
      hierarchyParentId: null, hierarchyParentDetail: null, selectedLifeLinkId: null, selectedLifeLinkDetail: null,
      rootLifeLinks: branch([summarizeLifeLink(folder, 1)]), expandedLifeLinkIds: [], hierarchyExpanding: false,
      lifeLinkChildren: { [folder.id]: branch([summarizeLifeLink(nested, 1)]), [nested.id]: branch([summarizeLifeLink(item, 0)]), [outside.id]: branch([]) } };
    const scope = () => snapshot.hierarchyParentId === folder.id ? [nested.id] : [folder.id, nested.id];
    actions.activateLifeLink = vi.fn().mockResolvedValue(undefined);
    actions.openHierarchy = vi.fn().mockResolvedValue(undefined);
    actions.expandHierarchy = vi.fn(async () => {
      snapshot = { ...snapshot, expandedLifeLinkIds: [...new Set([...snapshot.expandedLifeLinkIds, ...scope()])], hierarchyExpanding: false }; render();
    });
    actions.collapseHierarchy = vi.fn(() => {
      snapshot = { ...snapshot, expandedLifeLinkIds: snapshot.expandedLifeLinkIds.filter((id) => !scope().includes(id)), hierarchyExpanding: false }; render();
    });
    actions.toggleLifeLinkExpanded = vi.fn(async (id: string) => {
      snapshot = { ...snapshot, expandedLifeLinkIds: snapshot.expandedLifeLinkIds.includes(id)
        ? snapshot.expandedLifeLinkIds.filter((value) => value !== id) : [...snapshot.expandedLifeLinkIds, id] }; render();
    });
    return { folder, nested, item, outside, branch };
  }

  it("expands inline hierarchy descendants outside Edit and collapses them back to the compact current list", async () => {
    const { folder, nested, item } = hierarchyFixture();
    await act(async () => render());
    const list = () => host.querySelector("#life-links-hierarchy-list")!;
    expect(list()).not.toBeNull();
    expect(list().querySelectorAll("[data-life-link-id]")).toHaveLength(1);
    expect(button("Expand all hierarchy folders").getAttribute("aria-controls")).toBe("life-links-hierarchy-list");
    expect(host.querySelector('[aria-label="Edit hierarchy"]')).toBeNull();
    await click("Expand all hierarchy folders");
    expect(actions.expandHierarchy).toHaveBeenCalledTimes(1);
    expect([...list().querySelectorAll("[data-life-link-id]")].map((row) => row.getAttribute("data-life-link-id"))).toEqual([folder.id, nested.id, item.id]);
    expect(host.querySelectorAll(".ll-selection-dot")).toHaveLength(0);
    expect(button("Collapse folder Storage").getAttribute("aria-expanded")).toBe("true");
    expect(button("Collapse all hierarchy folders").getAttribute("aria-controls")).toBe("life-links-hierarchy-list");
    await click("Collapse all hierarchy folders");
    expect(actions.collapseHierarchy).toHaveBeenCalledTimes(1);
    expect(list().querySelectorAll("[data-life-link-id]")).toHaveLength(1);
    expect(list().textContent).not.toContain(item.title);
    expect(button("Expand folder Storage").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps folder-name drill-in and row disclosure separate from hierarchy bulk controls", async () => {
    const { folder, nested } = hierarchyFixture();
    await act(async () => render());
    await click("Expand folder Storage");
    expect(actions.toggleLifeLinkExpanded).toHaveBeenCalledWith(folder.id);
    expect(host.querySelector(`[data-life-link-id="${nested.id}"]`)).not.toBeNull();
    expect(actions.activateLifeLink).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-life-link-id="${folder.id}"]`)!.click());
    expect(actions.activateLifeLink).toHaveBeenCalledWith(folder.id);
    expect(actions.expandHierarchy).not.toHaveBeenCalled();
    expect(actions.collapseHierarchy).not.toHaveBeenCalled();
  });

  it("limits displayed expansion to the current folder and leaves breadcrumb disclosure and navigation independent", async () => {
    const { folder, nested, item, outside } = hierarchyFixture();
    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "20px" }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 60, width: 200, height: 60, toJSON() {} });
    snapshot = { ...snapshot, hierarchyParentId: folder.id, routePathname: `/life-links/${folder.id}`, expandedLifeLinkIds: [outside.id],
      hierarchyParentDetail: { lifeLink: folder, ancestry: { items: [summarizeLifeLink(folder, 1)], truncated: false, omittedCount: 0 },
        children: [summarizeLifeLink(nested, 1)], childrenPage: { nextCursor: null, truncated: false } } };
    await act(async () => render());
    const list = host.querySelector("#life-links-hierarchy-list")!;
    expect(list.querySelector(`[data-life-link-id="${folder.id}"]`)).toBeNull();
    expect(list.querySelector(`[data-life-link-id="${outside.id}"]`)).toBeNull();
    await click("Expand full path");
    expect(button("Collapse full path").getAttribute("aria-controls")).not.toBe("life-links-hierarchy-list");
    expect(actions.expandHierarchy).not.toHaveBeenCalled();
    await click("Expand all hierarchy folders");
    expect(list.querySelector(`[data-life-link-id="${item.id}"]`)).not.toBeNull();
    await click("Collapse all hierarchy folders");
    expect(snapshot.expandedLifeLinkIds).toEqual([outside.id]);
    expect(button("Collapse full path").getAttribute("aria-expanded")).toBe("true");
    const path = host.querySelector('[aria-label="Current layer"] .ll-breadcrumbs-display')!;
    await act(async () => path.querySelector<HTMLButtonElement>('button[title="Storage"]')!.click());
    expect(actions.openHierarchy).toHaveBeenLastCalledWith(folder.id);
    await act(async () => path.querySelector<HTMLButtonElement>('button[title="My Life Links"]')!.click());
    expect(actions.openHierarchy).toHaveBeenLastCalledWith();
  });

  it("keeps Collapse all available to stop an in-progress current-scope expansion", async () => {
    hierarchyFixture(); snapshot = { ...snapshot, hierarchyExpanding: true };
    await act(async () => render());
    expect(button("Collapse all hierarchy folders").disabled).toBe(false);
    await click("Collapse all hierarchy folders");
    expect(actions.collapseHierarchy).toHaveBeenCalledTimes(1);
  });

  it.each(["collections", "routines", "calendar", "search", "scan"] as const)("does not expose hierarchy bulk controls in %s", async (peer) => {
    hierarchyFixture();
    snapshot = peer === "search" || peer === "scan" ? { ...snapshot, activeView: peer }
      : { ...snapshot, workspaceMode: peer, selectedCollection: peer === "collections" ? collection : null };
    await act(async () => render());
    expect(host.querySelector('[aria-label="Expand all hierarchy folders"]')).toBeNull();
    expect(host.querySelector('[aria-label="Collapse all hierarchy folders"]')).toBeNull();
  });

  it.each([false, true])("keeps a folder-free current list safe (has item: %s)", async (hasItem) => {
    const { item, branch } = hierarchyFixture();
    snapshot = { ...snapshot, rootLifeLinks: branch(hasItem ? [summarizeLifeLink({ ...item, parentId: null }, 0)] : []), lifeLinkChildren: {} };
    await act(async () => render());
    for (const control of host.querySelectorAll<HTMLButtonElement>('[aria-label="Expand all hierarchy folders"], [aria-label="Collapse all hierarchy folders"]')) {
      expect(control.disabled).toBe(true);
      await act(async () => control.click());
    }
    expect(actions.expandHierarchy).not.toHaveBeenCalled();
    expect(actions.collapseHierarchy).not.toHaveBeenCalled();
    if (!hasItem) expect(host.textContent).toContain("No Life Links here yet.");
  });

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
