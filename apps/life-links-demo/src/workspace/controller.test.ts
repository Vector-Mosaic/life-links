import { describe, expect, it, vi } from "vitest";
import { createLinkBodyDocFromPlainText, type LinkRecord, type ProjectRecord } from "@life-links/core";

import { LifeLinksWorkspaceController, type LifeLinksWorkspaceApi } from "./controller";
import { classifyLifeLinksRoute, qrIdFromPath, type WorkspaceBrowserRoute } from "./routes";

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

describe("Life Links route classification", () => {
  it("keeps public QR, login, and owner surfaces explicit", () => {
    expect(qrIdFromPath("/qr/LL-DEMO-00001")).toBe("LL-DEMO-00001");
    expect(qrIdFromPath("/qr/Shelf%201/")).toBe("Shelf 1");
    expect(qrIdFromPath("/")).toBeNull();
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", false)).toEqual({
      surface: "public-qr",
      qrId: "LL-DEMO-00001"
    });
    expect(classifyLifeLinksRoute("/", false)).toEqual({ surface: "login", qrId: null });
    expect(classifyLifeLinksRoute("/qr/LL-DEMO-00001", true)).toEqual({
      surface: "owner-workspace",
      qrId: "LL-DEMO-00001"
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
      loading: false,
      error: ""
    });
    expect(api.getConfig).toHaveBeenCalledOnce();
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(api.listProjects).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();
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
    }))
  } satisfies LifeLinksWorkspaceApi;
}
