import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLinkBodyDocFromPlainText,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkRecord,
  type ProjectRecord,
  type UpdateLifeLinkPatch
} from "@life-links/core";

import { LifeLinksWorkspaceController, type LifeLinksWorkspaceApi } from "./controller";
import { ApiError, type ApiAgentConnection } from "../api";
import { writeCanonicalLifeLinkDraft } from "./editorSession";
import { classifyLifeLinksRoute, lifeLinkIdFromPath, qrIdFromPath, type WorkspaceBrowserRoute } from "./routes";

const owner = {
  id: "owner-1",
  email: "owner@example.test",
  displayName: "Owner",
  createdAt: "2026-08-25T00:00:00.000Z"
};

const connectedAgentConnection: ApiAgentConnection = {
  connected: true,
  connectedAt: "2026-08-27T21:00:00.000Z"
};

const disconnectedAgentConnection: ApiAgentConnection = {
  connected: false,
  connectedAt: null
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
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
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

  it("hydrates one durable agent connection across logout and login until explicit disconnect", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    api.getMe.mockResolvedValue({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: connectedAgentConnection
    });
    api.login.mockResolvedValue({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: connectedAgentConnection
    });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);

    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({
      currentUser: null,
      agentConnection: disconnectedAgentConnection
    });
    expect(api.disconnectAgent).not.toHaveBeenCalled();

    await controller.login(owner.email, "password");
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);

    await controller.disconnectAgent();
    expect(api.disconnectAgent).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().agentConnection).toEqual(disconnectedAgentConnection);

    await controller.connectAgent();
    expect(api.connectAgent).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().agentConnection).toEqual(connectedAgentConnection);
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

  it("does not let a completed Save refresh overwrite newer Find Mode navigation", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const updatedLifeLink = {
      ...canonicalLink,
      body: "Saved before Find Mode",
      updatedAt: "2026-08-25T00:02:00.000Z"
    };
    api.updateLifeLink.mockResolvedValue({ lifeLink: updatedLifeLink });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);

    let releaseOwnerRefresh!: () => void;
    const ownerRefresh = new Promise<void>((resolve) => {
      releaseOwnerRefresh = resolve;
    });
    api.listLinks.mockImplementationOnce(async () => {
      await ownerRefresh;
      return { links: [{ ...link, body: updatedLifeLink.body, updatedAt: updatedLifeLink.updatedAt }] };
    });

    const pendingSave = controller.saveCanonicalLifeLink(canonicalLink.id, canonicalLink.updatedAt, {
      title: updatedLifeLink.title,
      body: updatedLifeLink.body,
      bodyDoc: updatedLifeLink.bodyDoc,
      bodyDocVersion: updatedLifeLink.bodyDocVersion,
      privacy: updatedLifeLink.privacy
    });
    await vi.waitFor(() => expect(controller.getSnapshot().canonicalEditingId).toBeNull());

    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "search",
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });

    releaseOwnerRefresh();
    await pendingSave;

    expect(controller.getSnapshot()).toMatchObject({
      activeView: "search",
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(2);
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

  it("performs one revision-safe agent content update through the canonical API and opens the result", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/");
    const updated = {
      ...canonicalLink,
      title: "Shelf 1 inventory",
      updatedAt: "2026-08-25T00:03:00.000Z"
    };
    api.updateLifeLink.mockResolvedValue({ lifeLink: updated });
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    api.getLifeLinkDetail.mockClear();

    const result = await controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      title: "Shelf 1 inventory",
      sourceLifeLinkIds: [rootLifeLink.id]
    });

    expect(result).toEqual({ ok: true });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(3);
    expect(api.updateLifeLink).toHaveBeenCalledOnce();
    expect(api.updateLifeLink).toHaveBeenCalledWith(
      canonicalLink.id,
      canonicalLink.updatedAt,
      { title: "Shelf 1 inventory" },
      { signal: undefined }
    );
    expect(controller.getSnapshot()).toMatchObject({
      selectedLifeLinkId: canonicalLink.id,
      selectedLifeLinkDetail: { lifeLink: updated },
      canonicalEditingId: null
    });
    expect(route.pushes).toContain(`/life-links/${canonicalLink.id}`);
    controller.dispose();
  });

  it("maps a stale canonical PATCH without claiming a visible update", async () => {
    const api = fakeApi();
    api.updateLifeLink.mockRejectedValue(new ApiError(
      409,
      "stale_life_link",
      { error: { code: "stale_life_link" } },
      { message: "Life Link changed after it was read.", retryable: true }
    ));
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not overwrite a concurrent change",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });
    expect(api.updateLifeLink).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().selectedLifeLinkId).toBeNull();
    controller.dispose();
  });

  it("propagates revocation cancellation through the canonical agent PATCH", async () => {
    const api = fakeApi();
    const abortController = new AbortController();
    api.updateLifeLink.mockImplementationOnce(async (_lifeLinkId, _expectedUpdatedAt, _patch, options) =>
      await new Promise((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Agent connection removed", "AbortError")),
          { once: true }
        );
      })
    );
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    const pending = controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not outlive the active agent connection",
      sourceLifeLinkIds: []
    }, abortController.signal);
    await vi.waitFor(() => expect(api.updateLifeLink).toHaveBeenCalledOnce());
    abortController.abort(new DOMException("Agent connection removed", "AbortError"));

    await expect(pending).resolves.toEqual({ ok: false, code: "cancelled" });
    expect(api.updateLifeLink.mock.calls[0]?.[3]).toEqual({ signal: abortController.signal });
    expect(controller.getSnapshot().selectedLifeLinkId).toBeNull();
    controller.dispose();
  });

  it("rejects an agent update when the target revision changed before the PATCH", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    api.getLifeLinkDetail.mockResolvedValueOnce({
      detail: {
        ...canonicalDetail,
        lifeLink: { ...canonicalLink, updatedAt: "2026-08-25T00:03:00.000Z" }
      }
    });

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Stale update",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });

    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(controller.getSnapshot().canonicalEditingId).toBeNull();
    controller.dispose();
  });

  it("rejects an agent update when the target changes during source authorization", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const refreshedDetail = {
      ...canonicalDetail,
      lifeLink: {
        ...canonicalLink,
        body: "Changed while the source was being authorized",
        updatedAt: "2026-08-25T00:03:00.000Z"
      }
    };
    api.getLifeLinkDetail.mockClear();
    api.getLifeLinkDetail
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockResolvedValueOnce({ detail: refreshedDetail });

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not overwrite the newer target",
      sourceLifeLinkIds: [rootLifeLink.id]
    })).resolves.toEqual({ ok: false, code: "stale_life_link" });

    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(3);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      canonicalEditingId: null
    });
    controller.dispose();
  });

  it("rejects an agent update while a human draft exists, even with the editor closed", async () => {
    const api = fakeApi();
    writeCanonicalLifeLinkDraft(canonicalLink.id, canonicalLink.updatedAt, {
      title: "Human draft",
      body: canonicalLink.body,
      bodyDoc: canonicalLink.bodyDoc,
      bodyDocVersion: canonicalLink.bodyDocVersion,
      privacy: canonicalLink.privacy
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();

    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Agent update",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "editor_dirty" });

    expect(api.updateLifeLink).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("routes agent search, open, inspect, and Find Mode through visible controller state", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });

    await expect(controller.agentInspectCurrentLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    await expect(controller.agentSearchLifeLinks({ query: "Shelf", limit: 10 })).resolves.toMatchObject({
      ok: true,
      search: {
        query: "Shelf",
        results: [expect.objectContaining({ lifeLink: canonicalSummary })],
        totalCount: 1,
        hasMore: false,
        truncated: false,
        nextCursor: null
      }
    });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "projects",
      lifeLinkSearchQuery: "Shelf",
      lifeLinkSearchResults: [expect.objectContaining({ lifeLink: canonicalSummary })]
    });

    await expect(controller.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "search",
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(route.pushes).toContain(`/life-links/${canonicalLink.id}`);
    expect(route.pushes.at(-1)).toBe("/");
    controller.dispose();
  });

  it("returns each overlapping agent search's own bounded API payload", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const firstSummary = { ...canonicalSummary, id: "life-link-search-first", title: "First result" };
    const secondSummary = { ...canonicalSummary, id: "life-link-search-second", title: "Second result" };
    const firstResponse = {
      results: [{
        lifeLink: firstSummary,
        path: { items: [firstSummary], truncated: false, omittedCount: 0 },
        bodySummary: "First result body",
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    };
    const secondResponse = {
      results: [{
        lifeLink: secondSummary,
        path: { items: [secondSummary], truncated: false, omittedCount: 0 },
        bodySummary: "Second result body",
        matchClass: "recorded_path" as const
      }],
      totalCount: 1,
      truncated: false,
      hasMore: false,
      nextCursor: null
    };
    let resolveFirst!: (value: typeof firstResponse) => void;
    let resolveSecond!: (value: typeof secondResponse) => void;
    api.searchLifeLinks.mockImplementation((query: string) => new Promise((resolve) => {
      if (query === "first") {
        resolveFirst = resolve;
      } else {
        resolveSecond = resolve;
      }
    }));

    const first = controller.agentSearchLifeLinks({ query: "first", limit: 10 });
    const second = controller.agentSearchLifeLinks({ query: "second", limit: 10 });
    await vi.waitFor(() => expect(api.searchLifeLinks).toHaveBeenCalledTimes(2));
    resolveSecond(secondResponse);
    await expect(second).resolves.toMatchObject({
      ok: true,
      search: { query: "second", results: [{ lifeLink: { id: secondSummary.id } }] }
    });
    resolveFirst(firstResponse);
    await expect(first).resolves.toMatchObject({
      ok: true,
      search: { query: "first", results: [{ lifeLink: { id: firstSummary.id } }] }
    });
    expect(controller.getSnapshot()).toMatchObject({
      lifeLinkSearchQuery: "first",
      lifeLinkSearchResults: [{ lifeLink: { id: firstSummary.id } }]
    });
    controller.dispose();
  });

  it("blocks agent inspection, search, navigation, update, and Find Mode while the canonical editor is open", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    await controller.openCanonicalEditor(canonicalLink.id);
    api.getLifeLinkDetail.mockClear();
    api.searchLifeLinks.mockClear();

    await expect(controller.agentInspectCurrentLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentSearchLifeLinks({ query: "Shelf", limit: 10 })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    await expect(controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Blocked",
      sourceLifeLinkIds: []
    })).resolves.toEqual({ ok: false, code: "editor_open" });
    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "editor_open"
    });
    expect(api.getLifeLinkDetail).not.toHaveBeenCalled();
    expect(api.searchLifeLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      canonicalEditingId: canonicalLink.id,
      activeView: "projects",
      findTargetId: null
    });
    controller.dispose();
  });

  it("denies agent operations on the public QR surface and honors cancellation before reads", async () => {
    const publicApi = fakeApi();
    const publicController = new LifeLinksWorkspaceController({
      api: publicApi,
      route: new FakeRoute(`/qr/${link.id}`)
    });
    await publicController.start();
    await expect(publicController.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({
      ok: false,
      code: "life_link_unavailable"
    });
    expect(publicApi.getLifeLinkDetail).not.toHaveBeenCalled();
    publicController.dispose();

    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/") });
    await controller.start();
    const abortController = new AbortController();
    abortController.abort();
    await expect(controller.agentSearchLifeLinks(
      { query: "Shelf", limit: 10 },
      abortController.signal
    )).resolves.toEqual({ ok: false, code: "cancelled" });
    expect(api.searchLifeLinks).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("refuses to update if the page leaves the owner surface during source authorization", async () => {
    const route = new FakeRoute("/");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    let releaseSourceRead!: () => void;
    const sourceRead = new Promise<void>((resolve) => {
      releaseSourceRead = resolve;
    });
    api.getLifeLinkDetail.mockClear();
    api.getLifeLinkDetail
      .mockResolvedValueOnce({ detail: canonicalDetail })
      .mockImplementationOnce(async () => {
        await sourceRead;
        return { detail: canonicalDetail };
      });

    const pending = controller.agentUpdateLifeLinkContent({
      lifeLinkId: canonicalLink.id,
      baseUpdatedAt: canonicalLink.updatedAt,
      body: "Must not be saved after leaving the owner workspace",
      sourceLifeLinkIds: [rootLifeLink.id]
    });
    await vi.waitFor(() => expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(2));
    route.pop(`/qr/${link.id}`);
    await vi.waitFor(() => expect(controller.getSnapshot().routeQrId).toBe(link.id));
    releaseSourceRead();

    await expect(pending).resolves.toEqual({ ok: false, code: "life_link_unavailable" });
    expect(controller.getSnapshot().canonicalEditingId).toBeNull();
    expect(api.updateLifeLink).not.toHaveBeenCalled();
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
    getMe: vi.fn(async () => ({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: disconnectedAgentConnection
    })),
    login: vi.fn(async () => ({
      user: owner,
      qrBaseUrl: "https://example.test",
      agentConnection: disconnectedAgentConnection
    })),
    logout: vi.fn(async () => undefined),
    connectAgent: vi.fn(async () => ({ agentConnection: connectedAgentConnection })),
    disconnectAgent: vi.fn(async () => ({ agentConnection: disconnectedAgentConnection })),
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
    searchLifeLinks: vi.fn(async (
      _query: string,
      _options: { cursor?: string | null; limit?: number; signal?: AbortSignal } = {}
    ) => ({
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
    updateLifeLink: vi.fn(async (
      _lifeLinkId: string,
      _expectedUpdatedAt: string,
      _patch: UpdateLifeLinkPatch,
      _options: { signal?: AbortSignal } = {}
    ) => ({ lifeLink: canonicalLink })),
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
