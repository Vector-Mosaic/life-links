import { describe, expect, it, vi } from "vitest";
import {
  createLinkBodyDocFromPlainText,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkRecord,
  type ProjectRecord
} from "@life-links/core";

import { LifeLinksWorkspaceController, type LifeLinksWorkspaceApi } from "./controller";
import { ApiError } from "../api";
import { classifyLifeLinksRoute, lifeLinkIdFromPath, qrIdFromPath, type WorkspaceBrowserRoute } from "./routes";

const owner = {
  id: "owner-1",
  email: "owner@example.test",
  displayName: "Owner",
  createdAt: "2026-08-25T00:00:00.000Z"
};

const project: ProjectRecord = {
  id: "project-1",
  ownerId: owner.id,
  name: "Pantry",
  createdAt: "2026-08-25T00:00:00.000Z"
};

const link: LinkRecord = {
  id: "LL-DEMO-00001",
  url: "https://example.test/qr/LL-DEMO-00001",
  status: "claimed",
  ownerId: owner.id,
  title: "Shelf 1",
  body: "Dry goods",
  bodyDoc: createLinkBodyDocFromPlainText("Dry goods"),
  bodyDocVersion: 1,
  projectId: project.id,
  privacy: "private",
  media: [],
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z"
};

const rootLifeLink: LifeLinkRecord = {
  id: project.id,
  ownerId: owner.id,
  parentId: null,
  qrId: null,
  title: "Pantry",
  body: "",
  bodyDoc: createLinkBodyDocFromPlainText(""),
  bodyDocVersion: 1,
  privacy: "private",
  media: [],
  createdAt: project.createdAt,
  updatedAt: project.createdAt
};

const canonicalLink: LifeLinkRecord = {
  id: "life-link-shelf-1",
  ownerId: owner.id,
  parentId: rootLifeLink.id,
  qrId: link.id,
  title: link.title,
  body: link.body,
  bodyDoc: link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body),
  bodyDocVersion: link.bodyDocVersion ?? 1,
  privacy: link.privacy,
  media: [],
  createdAt: link.createdAt,
  updatedAt: link.updatedAt
};

const rootSummary: LifeLinkSummary = summary(rootLifeLink, 1);
const canonicalSummary: LifeLinkSummary = summary(canonicalLink, 0);
const canonicalDetail: LifeLinkDetail = {
  lifeLink: canonicalLink,
  ancestry: { items: [rootSummary, canonicalSummary], truncated: false, omittedCount: 0 },
  children: [],
  childrenPage: { nextCursor: null, truncated: false }
};

describe("Life Links route classification", () => {
  it("keeps public QR, login, and owner surfaces explicit", () => {
    expect(qrIdFromPath("/qr/LL-DEMO-00001")).toBe("LL-DEMO-00001");
    expect(qrIdFromPath("/qr/Shelf%201/")).toBe("Shelf 1");
    expect(qrIdFromPath("/")).toBeNull();
    expect(lifeLinkIdFromPath("/life-links/life-link-shelf-1")).toBe("life-link-shelf-1");
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", false)).toEqual({
      surface: "public-qr",
      qrId: "LL-DEMO-00001",
      lifeLinkId: null
    });
    expect(classifyLifeLinksRoute("/", false)).toEqual({ surface: "login", qrId: null, lifeLinkId: null });
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", true)).toEqual({
      surface: "public-qr",
      qrId: "LL-DEMO-00001",
      lifeLinkId: null
    });
    expect(classifyLifeLinksRoute("/life-links/life-link-shelf-1", true)).toEqual({
      surface: "owner-workspace",
      qrId: null,
      lifeLinkId: "life-link-shelf-1"
    });
  });
});

describe("LifeLinksWorkspaceController", () => {
  it("boots through the shared API boundary and publishes one owner snapshot", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    const listener = vi.fn();
    controller.subscribe(listener);

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({
      currentUser: owner,
      links: [link],
      projects: [project],
      activeQrId: link.id,
      activeView: "home",
      rootLifeLinks: expect.objectContaining({ items: [rootSummary], loaded: true }),
      loading: false,
      error: ""
    });
    expect(api.getConfig).toHaveBeenCalledOnce();
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(api.listProjects).toHaveBeenCalledOnce();
    expect(api.listLifeLinks).toHaveBeenCalledWith({ limit: 25 });
    expect(listener).toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps an authenticated public QR route isolated from the private owner library", async () => {
    const freshPublicLink = { ...link, title: "Fresh public response", projectId: null };
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    api.listLinks.mockResolvedValue({ links: [{ ...link, title: "Stale private inventory" }] });
    api.getQr.mockResolvedValue({ state: "claimed", link: freshPublicLink, viewerIsOwner: true });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();

    expect(api.getQr).toHaveBeenCalledWith(link.id);
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listProjects).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      links: [],
      projects: [],
      rootLifeLinks: { items: [], loaded: false },
      publicQrState: { state: "claimed", link: freshPublicLink }
    });
    controller.dispose();
  });

  it("uses the same open operation for visible selection, route history, and QR state", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.openQr(link.id);

    expect(route.pushes).toEqual([`/qr/${link.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      activeQrId: link.id,
      activeView: "scan",
      routeQrId: link.id,
      publicQrState: { state: "claimed", link, viewerIsOwner: true }
    });
    expect(api.getQr).toHaveBeenCalledWith(link.id);
    controller.dispose();
  });

  it("synchronizes back and forward navigation without a second state owner", async () => {
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    route.pop("/");
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBeNull());
    expect(controller.getSnapshot().activeView).toBe("home");

    route.pop(`/qr/${link.id}`);
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBe(link.id));
    expect(controller.getSnapshot().activeView).toBe("scan");
    controller.dispose();
  });

  it("routes editor Save through the controller and updates the shared snapshot", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const updated = { ...link, title: "Shelf One", updatedAt: "2026-08-25T00:01:00.000Z" };
    api.updateLink.mockResolvedValue({ link: updated });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    controller.openEditor(link.id);

    await controller.saveLink(link.id, {
      title: updated.title,
      body: updated.body,
      bodyDoc: updated.bodyDoc,
      bodyDocVersion: updated.bodyDocVersion,
      privacy: updated.privacy,
      projectId: updated.projectId
    });

    expect(api.updateLink).toHaveBeenCalledWith(link.id, expect.objectContaining({ title: "Shelf One" }));
    expect(controller.getSnapshot().links[0]).toEqual(updated);
    expect(controller.getSnapshot().editingId).toBeNull();
    controller.dispose();
  });

  it("uses the canonical editor's immutable base revision and keeps a stale draft open", async () => {
    const api = fakeApi();
    api.updateLifeLink.mockRejectedValue(new ApiError(
      409,
      "stale_life_link",
      { error: { code: "stale_life_link" } },
      { message: "Life Link changed after it was read.", retryable: true }
    ));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);

    await controller.saveCanonicalLifeLink(canonicalLink.id, "2026-08-24T00:00:00.000Z", {
      title: "Stale draft title",
      body: canonicalLink.body,
      bodyDoc: canonicalLink.bodyDoc,
      bodyDocVersion: canonicalLink.bodyDocVersion,
      privacy: canonicalLink.privacy
    });

    expect(api.updateLifeLink).toHaveBeenCalledWith(
      canonicalLink.id,
      "2026-08-24T00:00:00.000Z",
      expect.objectContaining({ title: "Stale draft title" })
    );
    expect(controller.getSnapshot().canonicalEditingId).toBe(canonicalLink.id);
    expect(controller.getSnapshot().error).toBe("Life Link changed after it was read.");
    controller.dispose();
  });

  it("selects canonical identity, expands ancestry, and pushes the stable owner route", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    expect(api.getLifeLinkDetail).toHaveBeenCalledWith(canonicalLink.id, { limit: 25 });
    expect(route.pushes).toEqual([`/life-links/${canonicalLink.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "projects",
      selectedLifeLinkId: canonicalLink.id,
      highlightedLifeLinkId: canonicalLink.id,
      routeLifeLinkId: canonicalLink.id,
      expandedLifeLinkIds: [rootLifeLink.id]
    });
    expect(controller.getSnapshot().selectedLifeLinkDetail).toEqual(canonicalDetail);
    controller.dispose();
  });

  it("never invents a local tree edge across omitted middle ancestry", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const tailParent = {
      ...canonicalLink,
      id: "life-link-tail-parent",
      parentId: "life-link-omitted-parent",
      qrId: null,
      title: "Returned tail parent"
    };
    const deepLifeLink = {
      ...canonicalLink,
      id: "life-link-deep-selected",
      parentId: tailParent.id,
      qrId: null,
      title: "Deep selected Life Link"
    };
    const tailParentSummary = summary(tailParent, 1);
    const deepSummary = summary(deepLifeLink, 0);
    api.getLifeLinkDetail.mockResolvedValue({
      detail: {
        lifeLink: deepLifeLink,
        ancestry: {
          items: [rootSummary, tailParentSummary, deepSummary],
          truncated: true,
          omittedCount: 4
        },
        children: [],
        childrenPage: { nextCursor: null, truncated: false }
      }
    });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.selectLifeLink({ lifeLinkId: deepLifeLink.id, source: "search" });

    const snapshot = controller.getSnapshot();
    expect(snapshot.lifeLinkChildren[rootLifeLink.id]).toBeUndefined();
    expect(snapshot.lifeLinkChildren[tailParent.id].items).toEqual([deepSummary]);
    expect(snapshot.selectedLifeLinkId).toBe(deepLifeLink.id);
    controller.dispose();
  });

  it("loads children lazily and uses server-backed path search", async () => {
    const api = fakeApi();
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) =>
      parentId === rootLifeLink.id
        ? { lifeLinks: [canonicalSummary], nextCursor: null, truncated: false }
        : { lifeLinks: [rootSummary], nextCursor: null, truncated: false }
    );
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    await controller.toggleLifeLinkExpanded(rootLifeLink.id);
    controller.setLifeLinkSearchQuery("Pantry Shelf");
    await controller.searchLifeLinks();

    expect(api.listLifeLinks).toHaveBeenLastCalledWith({ parentId: rootLifeLink.id, cursor: null, limit: 25 });
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id].items).toEqual([canonicalSummary]);
    expect(api.searchLifeLinks).toHaveBeenCalledWith("Pantry Shelf", { cursor: null, limit: 25 });
    expect(controller.getSnapshot().lifeLinkSearchResults[0].lifeLink.id).toBe(canonicalLink.id);
    controller.dispose();
  });

  it("preserves a selected deep-link path while completing a previously partial branch", async () => {
    const sibling = summary({
      ...canonicalLink,
      id: "life-link-first-page-sibling",
      qrId: null,
      title: "First page sibling"
    }, 0);
    const api = fakeApi();
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) => ({
      lifeLinks: parentId === rootLifeLink.id ? [sibling] : [rootSummary],
      nextCursor: null,
      truncated: false
    }));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "route" });

    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id]).toMatchObject({
      items: [canonicalSummary],
      loaded: false
    });
    await controller.loadMoreLifeLinks(rootLifeLink.id);

    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id]).toMatchObject({
      items: [sibling, canonicalSummary],
      loaded: true
    });
    controller.dispose();
  });

  it("routes move, detach, and QR attach through canonical controller operations", async () => {
    const api = fakeApi();
    const moved = { ...canonicalLink, parentId: null, updatedAt: "2026-08-25T00:02:00.000Z" };
    api.moveLifeLink.mockResolvedValue({ lifeLink: moved });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await controller.detachLifeLink(canonicalLink.id);
    await controller.attachQrToLifeLink(canonicalLink.id, link.id);

    expect(api.moveLifeLink).toHaveBeenCalledWith(canonicalLink.id, null, canonicalLink.updatedAt);
    expect(api.attachQr).toHaveBeenCalledWith(link.id, canonicalLink.id, expect.stringMatching(/^attach-/));
    controller.dispose();
  });

  it("preserves the committed move result and reports a failed hierarchy reconciliation", async () => {
    const api = fakeApi();
    const moved = { ...canonicalLink, parentId: null, updatedAt: "2026-08-25T00:02:00.000Z" };
    api.moveLifeLink.mockResolvedValue({ lifeLink: moved });
    api.listLifeLinks.mockImplementation(async (options: { parentId?: string | null } = {}) => {
      if (options.parentId === rootLifeLink.id) {
        throw new Error("Hierarchy refresh unavailable");
      }
      return { lifeLinks: [rootSummary], nextCursor: null, truncated: false };
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await controller.detachLifeLink(canonicalLink.id);

    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink).toEqual(moved);
    expect(controller.getSnapshot().error).toBe("Hierarchy refresh unavailable");
    expect(api.moveLifeLink).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("keeps a claimed public QR public-facing until the owner explicitly opens the workspace", async () => {
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();

    await controller.claimActiveLink();

    expect(api.claimQr).toHaveBeenCalledWith(link.id, expect.stringMatching(/^claim-/));
    expect(api.getQr).toHaveBeenCalledTimes(2);
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listProjects).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(route.pushes).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      routeQrId: link.id,
      routeLifeLinkId: null,
      selectedLifeLinkId: null,
      canonicalEditingId: null,
      editingId: null,
      publicQrState: { state: "claimed", link, viewerIsOwner: true }
    });

    await controller.openPublicQrInWorkspace();

    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(route.pushes).toEqual([`/life-links/${canonicalLink.id}`]);
    expect(controller.getSnapshot()).toMatchObject({
      routeLifeLinkId: canonicalLink.id,
      selectedLifeLinkId: canonicalLink.id,
      canonicalEditingId: null,
      editingId: null,
      publicQrState: null
    });
    controller.dispose();
  });
});

class FakeRoute implements WorkspaceBrowserRoute {
  private listeners = new Set<() => void>();
  readonly pushes: string[] = [];

  constructor(private currentPathname: string) {}

  pathname() {
    return this.currentPathname;
  }

  push(pathname: string) {
    this.currentPathname = pathname;
    this.pushes.push(pathname);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pop(pathname: string) {
    this.currentPathname = pathname;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function fakeApi() {
  return {
    getConfig: vi.fn(async () => ({ qrBaseUrl: "https://example.test", maxBatchCount: 10000 })),
    getMe: vi.fn(async () => ({ user: owner, qrBaseUrl: "https://example.test" })),
    login: vi.fn(async () => ({ user: owner, qrBaseUrl: "https://example.test" })),
    logout: vi.fn(async () => undefined),
    listLinks: vi.fn(async () => ({ links: [link] })),
    listProjects: vi.fn(async () => ({ projects: [project] })),
    updateLink: vi.fn(async () => ({ link })),
    uploadLinkMedia: vi.fn(async () => ({ media: link.media[0] })),
    deleteLinkMedia: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ project })),
    createQrBatch: vi.fn(async () => ({
      batch: {
        id: "batch-1",
        batchKey: "BATCH",
        qrBaseUrl: "https://example.test",
        count: 1,
        createdBy: owner.id,
        createdAt: "2026-08-25T00:00:00.000Z"
      },
      qrCodes: [link]
    })),
    getQr: vi.fn(async () => ({ state: "claimed" as const, link, viewerIsOwner: true })),
    claimQr: vi.fn(async () => ({ result: "already_owned", state: { state: "claimed" as const, link, viewerIsOwner: true } })),
    findScan: vi.fn(async (targetQrId: string, scanText: string) => ({
      targetQrId,
      scannedQrId: scanText,
      match: targetQrId === scanText
    })),
    listLifeLinks: vi.fn(async (options: { parentId?: string | null; cursor?: string | null; limit?: number } = {}) => ({
      lifeLinks: options.parentId === rootLifeLink.id ? [canonicalSummary] : [rootSummary],
      nextCursor: null,
      truncated: false
    })),
    createLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    getLifeLinkDetail: vi.fn(async () => ({ detail: canonicalDetail })),
    searchLifeLinks: vi.fn(async () => ({
      results: [{
        lifeLink: canonicalSummary,
        path: canonicalDetail.ancestry,
        bodySummary: canonicalLink.body,
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    })),
    updateLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    moveLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    uploadLifeLinkMedia: vi.fn(async () => ({ media: canonicalLink.media[0] })),
    deleteLifeLinkMedia: vi.fn(async () => undefined),
    attachQr: vi.fn(async () => ({
      result: "already_owned",
      state: { state: "claimed" as const, link, viewerIsOwner: true }
    }))
  } satisfies LifeLinksWorkspaceApi;
}

function summary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return {
    id: lifeLink.id,
    parentId: lifeLink.parentId,
    qrId: lifeLink.qrId,
    title: lifeLink.title,
    privacy: lifeLink.privacy,
    updatedAt: lifeLink.updatedAt,
    childCount
  };
}
