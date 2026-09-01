import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLinkBodyDocFromPlainText,
  createCanonicalActivity,
  createCanonicalRoutine,
  createCanonicalRoutineGroup,
  createCanonicalRoutineSchedule,
  summarizeLifeLink,
  type CollectionRecord,
  type CollectionSectionRecord,
  type LifeLinkDetail,
  type LifeLinkChangePreview,
  type LifeLinkRecord,
  type LifeLinkSummary,
  type LinkRecord,
  type UpdateLifeLinkPatch
} from "@life-links/core";

import { LifeLinksWorkspaceController, type LifeLinksWorkspaceApi } from "./controller";
import { ApiError, type ApiAgentConnection } from "../api";
import { writeCanonicalLifeLinkDraft } from "./editorSession";
import { classifyLifeLinksRoute, lifeLinkIdFromPath, qrIdFromPath, type WorkspaceBrowserRoute } from "./routes";
import { attachmentImageFixture, attachmentPdfImageFixture, attachmentSelectedImageFixture, attachmentTranscriptFixture } from "../attachmentImage.testFixtures";
import { validateAttachmentImageResult } from "../attachmentImage";

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

const rootFixture = {
  id: "life-link-pantry",
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
  privacy: "private",
  media: [],
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z"
};

const rootLifeLink: LifeLinkRecord = {
  id: rootFixture.id,
  ownerId: owner.id,
  parentId: null,
  qrId: null,
  title: "Pantry",
  body: "",
  bodyDoc: createLinkBodyDocFromPlainText(""),
  bodyDocVersion: 1,
  privacy: "private",
  browsingRole: "container",
  context: { schemaVersion: 1 },
  placementConfirmedAt: null,
  publicFieldKeys: [],
  media: [],
  createdAt: rootFixture.createdAt,
  updatedAt: rootFixture.createdAt
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
  browsingRole: "item",
  context: { schemaVersion: 1 },
  placementConfirmedAt: null,
  publicFieldKeys: [],
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

const collection: CollectionRecord = {
  id: "collection-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ownerId: owner.id,
  title: "Camping Gear", purpose: "Family trips", notes: "", createdAt: rootFixture.createdAt, updatedAt: rootFixture.createdAt
};
const section: CollectionSectionRecord = {
  id: "section-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: owner.id, collectionId: collection.id,
  title: "Family sleep systems", position: 0, createdAt: rootFixture.createdAt, updatedAt: rootFixture.createdAt
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
      activeQrId: link.id,
      activeView: "home",
      rootLifeLinks: expect.objectContaining({ items: [rootSummary], loaded: true }),
      loading: false,
      error: ""
    });
    expect(api.getConfig).toHaveBeenCalledOnce();
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listLinks).toHaveBeenCalledOnce();
    expect(api.listLifeLinks).toHaveBeenCalledWith({ limit: 25 });
    expect(listener).toHaveBeenCalled();
    controller.dispose();
  });

  it("reads private attachments only while connected, through fresh owner metadata and the typed content API", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { lifeLinkId: canonicalLink.id, mediaId: "media-manual" };
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    expect(api.getLifeLinkAttachmentContent).not.toHaveBeenCalled();
    await controller.connectAgent();
    const media = { id: input.mediaId, lifeLinkId: input.lifeLinkId, ownerId: owner.id, kind: "document" as const,
      mimeType: "text/plain", fileName: "manual.txt", sizeBytes: 6, createdAt: link.createdAt, url: `/api/life-links/${input.lifeLinkId}/media/${input.mediaId}` };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    const page = { mediaId: input.mediaId, revision: "a".repeat(64), status: "ready" as const, reason: null,
      format: "text" as const, text: "Manual", offset: 0, nextOffset: null, totalChars: 6, warnings: [] };
    api.getLifeLinkAttachmentContent.mockResolvedValue(page);
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment({ lifeLinkId: input.lifeLinkId })).toEqual({ ok: true, kind: "list", attachments: [media], revision: canonicalLink.updatedAt });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "content", page });
    expect(api.getLifeLinkAttachmentContent).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, { offset: undefined, revision: undefined, limit: 1000, signal: undefined });
    expect(controller.getSnapshot()).toEqual(before);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    expect(await controller.agentReadAttachment({ lifeLinkId: input.lifeLinkId, revision: "stale", offset: 1 })).toEqual({ ok: false, code: "stale_life_link" });
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, ownerId: "other-owner", media: [media] } } });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    controller.dispose();
  });

  it("drops attachment text after disconnection and preserves cancellation", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.connectAgent();
    const media = { id: "media-1", lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "document" as const,
      mimeType: "text/plain", fileName: "manual.txt", sizeBytes: 7, createdAt: link.createdAt, url: `/api/life-links/${canonicalLink.id}/media/media-1` };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentContent.mockImplementation(async () => {
      await controller.disconnectAgent();
      return { mediaId: media.id, revision: "a".repeat(64), status: "ready", reason: null, format: "text", text: "private", offset: 0, nextOffset: null, totalChars: 7, warnings: [] };
    });
    expect(await controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id })).toEqual({ ok: false, code: "life_link_unavailable" });
    const abort = new AbortController();
    abort.abort();
    expect(await controller.agentReadAttachment({ lifeLinkId: canonicalLink.id }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    controller.dispose();
  });

  it.each(["image", "pdf", "docx", "xlsx", "video", "animation"] as const)("reads revision-bound %s bytes without changing the selected item, content, or history", async (kind) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const result = kind === "pdf" ? attachmentPdfImageFixture() : kind === "image" ? attachmentImageFixture() : attachmentSelectedImageFixture(kind);
    const selector = ["pdf", "docx", "xlsx"].includes(kind) ? { page: 2 } : kind === "video" ? { atMs: 1200 } : kind === "animation" ? { frame: 2 } : {};
    const media = { id: result.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "image" as const,
      mimeType: result.source!.mimeType, fileName: "photo.png", sizeBytes: result.source!.sizeBytes, createdAt: link.createdAt, url: "/private-image" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentImage.mockResolvedValue(result);
    const input = { lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "image" as const, mode: "overview" as const, sourceRevision: result.sourceRevision, ...selector };
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "image", result });
    expect(api.getLifeLinkAttachmentImage).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, { mode: "overview", sourceRevision: result.sourceRevision, ...selector }, undefined);
    expect(api.getLifeLinkAttachmentContent).not.toHaveBeenCalled();
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(before);
    if (["pdf", "docx", "xlsx"].includes(kind)) {
      expect(await controller.agentReadAttachment({ ...input, page: 1 })).toEqual({ ok: false, code: "effect_not_applied" });
    }
    api.getLifeLinkAttachmentImage.mockResolvedValue({ ...result, sourceRevision: "0".repeat(64) });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
    api.getLifeLinkAttachmentImage.mockResolvedValue({ ...result, source: { ...result.source!, sizeBytes: media.sizeBytes + 1 } });
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
    api.getLifeLinkAttachmentImage.mockRejectedValue(new ApiError(409, "stale_attachment", {}));
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "stale_life_link" });
    api.getLifeLinkAttachmentImage.mockRejectedValue(new ApiError(404, "not_found", {}));
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "life_link_unavailable" });
    controller.dispose();
  });

  it.each(["image", "docx", "xlsx", "video", "animation"].flatMap((kind) => ["navigation", "disconnect", "editor", "owner", "abort"].map((change) => [kind, change])))
  ("drops %s bytes if %s changes during pending output-hash verification", async (kind, change) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const image = kind === "image" ? attachmentImageFixture() : attachmentSelectedImageFixture(kind as "docx" | "xlsx" | "video" | "animation");
    const selector = kind === "video" ? { atMs: 1200 } : kind === "animation" ? { frame: 2 } : kind === "image" ? {} : { page: 2 };
    const media = { id: image.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "image" as const,
      mimeType: image.source!.mimeType, fileName: "photo.png", sizeBytes: image.source!.sizeBytes, createdAt: link.createdAt, url: "/private-image" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    const actualDigest = Uint8Array.from(image.rendition!.sha256.match(/../g)!, (byte) => parseInt(byte, 16)).buffer;
    let finishDigest!: (value: ArrayBuffer) => void;
    let enteredDigest!: () => void;
    const entered = new Promise<void>((resolve) => { enteredDigest = resolve; });
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
      enteredDigest();
      return new Promise<ArrayBuffer>((resolve) => { finishDigest = resolve; });
    });
    api.getLifeLinkAttachmentImage.mockImplementation(async (_id, mediaId, options) => validateAttachmentImageResult(image, mediaId, options));
    const abort = new AbortController();
    try {
      const pending = controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "image", mode: "overview", sourceRevision: image.sourceRevision, ...selector }, abort.signal);
      await entered;
      if (change === "navigation") await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
      if (change === "disconnect") await controller.disconnectAgent();
      if (change === "editor") await controller.openCanonicalEditor(canonicalLink.id);
      if (change === "owner") await controller.logout();
      if (change === "abort") abort.abort();
      finishDigest(actualDigest);
      expect(await pending).toEqual({ ok: false, code: change === "abort" ? "cancelled" : change === "editor" ? "editor_open" : "life_link_unavailable" });
    } finally { digest.mockRestore(); controller.dispose(); }
  });

  it.each(["navigation", "disconnect", "editor", "owner", "abort"])("drops a transcript if %s changes while the private window is being read", async (change) => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const page = attachmentTranscriptFixture();
    const media = { id: page.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "video" as const,
      mimeType: "video/mp4", fileName: "clip.mp4", sizeBytes: 900, createdAt: link.createdAt, url: "/private-video" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
    let finish!: (page: ReturnType<typeof attachmentTranscriptFixture>) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    api.getLifeLinkAttachmentContent.mockImplementation(() => { entered(); return new Promise((resolve) => { finish = resolve; }); });
    const abort = new AbortController();
    try {
      const pending = controller.agentReadAttachment({ lifeLinkId: canonicalLink.id, mediaId: media.id, representation: "transcript", startMs: 30000 }, abort.signal);
      await ready;
      if (change === "navigation") await controller.selectLifeLink({ lifeLinkId: canonicalLink.id, source: "human" });
      if (change === "disconnect") await controller.disconnectAgent();
      if (change === "editor") await controller.openCanonicalEditor(canonicalLink.id);
      if (change === "owner") await controller.logout();
      if (change === "abort") abort.abort();
      finish(page);
      expect(await pending).toEqual({ ok: false, code: change === "abort" ? "cancelled" : change === "editor" ? "editor_open" : "life_link_unavailable" });
    } finally { controller.dispose(); }
  });

  it("checks transcript window identity after owner authorization without modifying the item or history", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start(); await controller.connectAgent();
    const page = attachmentTranscriptFixture();
    const media = { id: page.mediaId, lifeLinkId: canonicalLink.id, ownerId: owner.id, kind: "video" as const,
      mimeType: "video/mp4", fileName: "clip.mp4", sizeBytes: 900, createdAt: link.createdAt, url: "/private-video" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: { ...canonicalLink, media: [media] } } });
    api.getLifeLinkAttachmentContent.mockResolvedValue(page);
    const input = { lifeLinkId: canonicalLink.id, mediaId: page.mediaId, representation: "transcript" as const, startMs: 30000, durationMs: 30000, audioStreamIndex: 1 };
    const before = controller.getSnapshot();
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: true, kind: "content", page });
    expect(api.getLifeLinkAttachmentContent).toHaveBeenCalledWith(input.lifeLinkId, input.mediaId, expect.objectContaining({ representation: "transcript", startMs: 30000, durationMs: 30000, audioStreamIndex: 1 }));
    expect(controller.getSnapshot()).toBe(before);
    expect(api.updateLifeLink).not.toHaveBeenCalled();
    expect(api.uploadLifeLinkMedia).not.toHaveBeenCalled();
    page.transcript!.endMs = -1;
    expect(await controller.agentReadAttachment(input)).toEqual({ ok: false, code: "effect_not_applied" });
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
    const freshPublicLink = { ...link, title: "Fresh public response" };
    const route = new FakeRoute(`/qr/${link.id}`);
    const api = fakeApi();
    api.listLinks.mockResolvedValue({ links: [{ ...link, title: "Stale private inventory" }] });
    api.getQr.mockResolvedValue({ state: "claimed", link: freshPublicLink, viewerIsOwner: true });
    const controller = new LifeLinksWorkspaceController({ api, route });

    await controller.start();

    expect(api.getQr).toHaveBeenCalledWith(link.id);
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(api.listLifeLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      links: [],
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
      activeView: "scan",
      detailsOpen: false,
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });

    releaseOwnerRefresh();
    await pendingSave;

    expect(controller.getSnapshot()).toMatchObject({
      activeView: "scan",
      detailsOpen: false,
      routePathname: "/",
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(3);
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
      activeView: "workspace",
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
    api.listLifeLinks.mockImplementation(async ({ parentId } = {}) => ({
      lifeLinks: parentId === tailParent.id ? [deepSummary] : [rootSummary], nextCursor: null, truncated: false
    }));
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

    // Direct-layer navigation loads the parent immediately and retains a known
    // selected path even if its row is outside the server's current page.
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id]).toMatchObject({
      items: [sibling, canonicalSummary], loaded: true
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

    expect(api.moveLifeLink).toHaveBeenCalledWith(canonicalLink.id, null, canonicalLink.updatedAt, { signal: undefined });
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
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(4);
    expect(api.getLifeLinkDetail).toHaveBeenLastCalledWith(rootLifeLink.id, { limit: 25, signal: undefined });
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
      activeView: "search",
      detailsOpen: false,
      collectionSearchComplete: true,
      lifeLinkMembershipsComplete: { [canonicalLink.id]: true },
      lifeLinkSearchQuery: "Shelf",
      lifeLinkSearchResults: [expect.objectContaining({ lifeLink: canonicalSummary })]
    });

    await expect(controller.agentOpenLifeLink({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    await expect(controller.agentStartFindMode({ lifeLinkId: canonicalLink.id })).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({
      activeView: "scan",
      detailsOpen: false,
      findTargetId: link.id,
      activeQrId: link.id
    });
    expect(route.pushes).toContain(`/life-links/${canonicalLink.id}`);
    expect(route.pushes.at(-1)).toBe("/");
    controller.dispose();
  });

  it("returns each overlapping agent search's own payload while the latest requested search owns the view", async () => {
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
      lifeLinkSearchQuery: "second",
      lifeLinkSearchResults: [{ lifeLink: { id: secondSummary.id } }]
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
      activeView: "workspace",
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

  it("enters only a folder's direct layer, collapses Details, and opens item Details", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    const folderSelectionStates: boolean[] = [];
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().selectedLifeLinkId === rootLifeLink.id) folderSelectionStates.push(controller.getSnapshot().detailsOpen);
    });
    await controller.activateLifeLink(rootLifeLink.id);
    unsubscribe();
    expect(folderSelectionStates).not.toContain(true);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "hierarchies", hierarchyParentId: rootLifeLink.id,
      hierarchyParentDetail: { lifeLink: rootLifeLink }, selectedLifeLinkId: rootLifeLink.id, detailsOpen: false
    });
    expect(controller.getSnapshot().lifeLinkChildren[rootLifeLink.id].items).toEqual([canonicalSummary]);
    await controller.activateLifeLink(canonicalLink.id);
    expect(controller.getSnapshot()).toMatchObject({
      hierarchyParentId: rootLifeLink.id, selectedLifeLinkId: canonicalLink.id, detailsOpen: true,
      membershipsComplete: true
    });
    await controller.openHierarchy();
    expect(route.pathname()).toBe("/life-links");
    expect(controller.getSnapshot()).toMatchObject({ hierarchyParentId: null, detailsOpen: false, selectedLifeLinkId: null });
    controller.dispose();
  });

  it("reloads exact memberships for folders and preserves labels after item-to-container promotion", async () => {
    const api = fakeApi();
    let currentSummary: LifeLinkSummary = { ...rootSummary, browsingRole: "item", childCount: 0 };
    api.listLifeLinks.mockImplementation(async () => ({ lifeLinks: [currentSummary], nextCursor: null, truncated: false }));
    const memberships = [{ collection, sections: [section] }];
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships, nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    expect(controller.getSnapshot().lifeLinkMemberships[rootLifeLink.id]).toEqual(memberships);
    api.listLifeLinkCollectionMemberships.mockClear();
    currentSummary = rootSummary;
    await controller.refreshOwnerLibrary();
    expect(api.listLifeLinkCollectionMemberships).toHaveBeenCalledWith(rootLifeLink.id, { cursor: null, limit: 25 });
    expect(controller.getSnapshot()).toMatchObject({
      rootLifeLinks: { items: [rootSummary] },
      lifeLinkMemberships: { [rootLifeLink.id]: memberships },
      lifeLinkMembershipsComplete: { [rootLifeLink.id]: true }
    });
    controller.dispose();
  });

  it("reveals Search and Scan instead of leaving mobile navigation behind open Details", async () => {
    const controller = new LifeLinksWorkspaceController({ api: fakeApi(), route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.activateLifeLink(canonicalLink.id);
    controller.setActiveView("search");
    expect(controller.getSnapshot()).toMatchObject({ activeView: "search", detailsOpen: false, selectedLifeLinkId: canonicalLink.id });
    await controller.openCollection(collection.id, canonicalLink.id);
    controller.setActiveView("scan");
    expect(controller.getSnapshot()).toMatchObject({ activeView: "scan", detailsOpen: false, selectedLifeLinkId: canonicalLink.id });
    controller.dispose();
  });

  it("exhausts Collection, Section, member and Details membership pages on a deep link", async () => {
    const api = fakeApi();
    const anotherCollection = { ...collection, id: "collection-cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Winter" };
    const anotherSection = { ...section, id: "section-dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Cycling", position: 1 };
    const anotherMember = { ...canonicalLink, id: "life-link-second", title: "Helmet" };
    api.getCollection.mockImplementation(async (_id, options = {}) => ({
      collection, sections: options.cursor ? [anotherSection] : [section],
      sectionsPage: { nextCursor: options.cursor ? null : "section-page-2", truncated: !options.cursor }
    }));
    api.listCollectionMembers.mockImplementation(async (_id, options = {}) => ({
      lifeLinks: options.cursor ? [anotherMember] : [canonicalLink],
      nextCursor: options.cursor ? null : "member-page-2", truncated: !options.cursor
    }));
    api.listLifeLinkCollectionMemberships.mockImplementation(async (_id, options = {}) => ({
      memberships: options.cursor ? [{ collection: anotherCollection, sections: [] }] : [{ collection, sections: [section, anotherSection] }],
      nextCursor: options.cursor ? null : "membership-page-2", truncated: !options.cursor
    }));
    const route = new FakeRoute(`/collections/${collection.id}?lifeLinkId=${canonicalLink.id}`);
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    expect(api.listLinks).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "collections", selectedCollection: collection, collectionSections: [section, anotherSection],
      collectionMembers: [canonicalLink, anotherMember], collectionComplete: true,
      detailsOpen: true, selectedLifeLinkId: canonicalLink.id, membershipsComplete: true,
      selectedLifeLinkMemberships: [{ collection, sections: [section, anotherSection] }, { collection: anotherCollection, sections: [] }]
    });
    expect(api.getCollection).toHaveBeenCalledWith(collection.id, { cursor: "section-page-2", limit: 25 });
    expect(api.listCollectionMembers).toHaveBeenCalledWith(collection.id, { cursor: "member-page-2", limit: 25 });
    expect(api.listLifeLinkCollectionMemberships).toHaveBeenCalledWith(canonicalLink.id, { cursor: "membership-page-2", limit: 25 });
    expect(route.pushes).toEqual([]);
    controller.dispose();
  });

  it("restores Collection mode and selected member through browser Back without changing identity", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.openCollection(collection.id);
    await controller.selectCollectionMember(canonicalLink.id);
    const memberRoute = route.pathname();
    await controller.openHierarchy(rootLifeLink.id);
    route.pop(memberRoute);
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "collections", selectedCollection: collection, selectedLifeLinkId: canonicalLink.id, detailsOpen: true
    }));
    controller.dispose();
  });

  it("uses the exact Collection revision and complete nonexclusive Section replacement set", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id, canonicalLink.id);
    await controller.replaceCollectionSectionAssignments(canonicalLink.id, [section.id, "section-other"]);
    expect(api.replaceCollectionSectionAssignments).toHaveBeenCalledWith(collection.id, canonicalLink.id, collection.updatedAt, [section.id, "section-other"], { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", selectedLifeLinkId: canonicalLink.id });
    api.removeCollectionMember.mockRejectedValueOnce(new ApiError(409, "stale_collection", {}));
    await controller.removeCollectionMember(canonicalLink.id);
    expect(api.removeCollectionMember).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().error).toContain("Stale collection");
    expect(controller.getSnapshot().collectionMembers).toEqual([canonicalLink]);
    controller.dispose();
  });

  it("retains client creation identity after a lost response, but creates a new identity after success", async () => {
    const api = fakeApi();
    api.createCollection.mockRejectedValueOnce(new Error("Response lost"));
    const ids = vi.fn().mockReturnValueOnce("11111111-1111-4111-8111-111111111111").mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections"), commandId: ids });
    await controller.start();
    await controller.createCollection({ title: "Camping Gear" });
    await controller.createCollection({ title: "Camping Gear" });
    expect(api.createCollection.mock.calls[0][0].id).toBe(api.createCollection.mock.calls[1][0].id);
    await controller.createCollection({ title: "Camping Gear" });
    expect(api.createCollection.mock.calls[2][0].id).not.toBe(api.createCollection.mock.calls[1][0].id);
    controller.dispose();
  });

  it("refreshes Collection membership and Sections without reopening closed Details or changing the selected member", async () => {
    const api = fakeApi();
    api.listCollectionMembers.mockResolvedValue({ lifeLinks: [rootLifeLink, canonicalLink], nextCursor: null, truncated: false });
    const route = new FakeRoute("/collections");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.openCollection(collection.id, rootLifeLink.id);
    controller.setDetailsOpen(false);
    const pathname = route.pathname();
    const memberships = [{ collection, sections: [section] }];
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships, nextCursor: null, truncated: false });
    for (const targetId of [canonicalLink.id, rootLifeLink.id]) {
      await controller.replaceCollectionSectionAssignments(targetId, [section.id]);
      expect(controller.getSnapshot()).toMatchObject({
        workspaceMode: "collections", selectedLifeLinkId: rootLifeLink.id,
        detailsOpen: false, selectedLifeLinkMemberships: memberships, membershipsComplete: true
      });
      expect(route.pathname()).toBe(pathname);
    }
    await controller.updateCollectionSection(section.id, "Sleep equipment");
    expect(controller.getSnapshot().detailsOpen).toBe(false);
    controller.setDetailsOpen(true);
    await controller.addCollectionMember(canonicalLink.id);
    expect(controller.getSnapshot()).toMatchObject({ selectedLifeLinkId: rootLifeLink.id, detailsOpen: true });
    controller.dispose();
  });

  it("keeps incomplete memberships explicit and never installs delayed owner data after logout", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: true });
    await controller.openCollection(collection.id);
    expect(controller.getSnapshot()).toMatchObject({ collectionComplete: false, collectionLoading: false });
    expect(controller.getSnapshot().error).toContain("incomplete");
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [], nextCursor: null, truncated: false });
    let finish!: (value: { collection: CollectionRecord }) => void;
    api.createCollection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.createCollection({ title: "Camping" });
    await controller.logout();
    finish({ collection });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ currentUser: null, collections: [], selectedCollection: null, collectionMembers: [] });
    controller.dispose();
  });

  it("prevents a slower Collection member read from replacing the latest click", async () => {
    const api = fakeApi();
    const other = { ...canonicalLink, id: "life-link-second" };
    api.listCollectionMembers.mockResolvedValue({ lifeLinks: [canonicalLink, other], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    let finish!: (value: { detail: LifeLinkDetail }) => void;
    api.getLifeLinkDetail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = controller.selectCollectionMember(canonicalLink.id);
    api.getLifeLinkDetail.mockResolvedValueOnce({ detail: { ...canonicalDetail, lifeLink: other } });
    await controller.selectCollectionMember(other.id);
    finish({ detail: canonicalDetail });
    await first;
    expect(controller.getSnapshot().selectedLifeLinkId).toBe(other.id);
    controller.dispose();
  });

  it("routes context and public fields through one canonical PATCH and QR binding through stable commands", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id, canonicalLink.id);
    const patch = { context: { schemaVersion: 1 as const, plan: { text: "Upgrade pad", truthState: "planned" as const } }, publicFieldKeys: ["plan" as const] };
    await controller.updateSelectedLifeLink(patch);
    expect(api.updateLifeLink).toHaveBeenCalledWith(canonicalLink.id, canonicalLink.updatedAt, patch, { signal: undefined });
    expect(controller.getSnapshot().workspaceMode).toBe("collections");
    api.setLifeLinkQrBinding.mockRejectedValueOnce(new Error("Response lost"));
    await controller.setLifeLinkQrBinding(canonicalLink.id, link.url);
    await controller.setLifeLinkQrBinding(canonicalLink.id, link.id);
    expect(api.setLifeLinkQrBinding.mock.calls[0]).toEqual(api.setLifeLinkQrBinding.mock.calls[1]);
    expect(api.attachQr).not.toHaveBeenCalled();
    await controller.clearLifeLinkQrBinding(canonicalLink.id);
    expect(api.clearLifeLinkQrBinding).toHaveBeenCalledWith(canonicalLink.id, canonicalLink.updatedAt, expect.any(String), { signal: undefined });
    controller.dispose();
  });

  it("searches Collection and Section names with matching member identity through canonical endpoints", async () => {
    const api = fakeApi();
    api.listCollections.mockResolvedValue({ collections: [collection], nextCursor: null, truncated: false });
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: false });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.searchLifeLinks("sleep");
    expect(controller.getSnapshot()).toMatchObject({
      collectionSearchComplete: true, collectionSearchResults: [{ collection, sections: [section], members: [canonicalLink] }],
      lifeLinkMemberships: { [canonicalLink.id]: [{ collection, sections: [section] }] },
      lifeLinkMembershipsComplete: { [canonicalLink.id]: true }
    });
    expect(api.searchLifeLinks).toHaveBeenCalledWith("sleep", { cursor: null, limit: 25 });
    controller.dispose();
  });

  it("edits membership from hierarchy Details without navigating to the Collection", async () => {
    const api = fakeApi();
    const route = new FakeRoute("/life-links");
    const controller = new LifeLinksWorkspaceController({ api, route });
    await controller.start();
    await controller.activateLifeLink(canonicalLink.id);
    const pathname = route.pathname();
    const editor = await controller.loadCollectionForAssignment(collection.id, canonicalLink.id);
    expect(editor).toEqual({ collection, sections: [section], membership: null });
    api.listLifeLinkCollectionMemberships.mockResolvedValue({ memberships: [{ collection, sections: [section] }], nextCursor: null, truncated: false });
    await controller.addCollectionMember(canonicalLink.id, editor.collection);
    await controller.replaceCollectionSectionAssignments(canonicalLink.id, [section.id], editor.collection);
    expect(route.pathname()).toBe(pathname);
    expect(controller.getSnapshot()).toMatchObject({
      workspaceMode: "hierarchies", hierarchyParentId: rootLifeLink.id, selectedLifeLinkId: canonicalLink.id,
      detailsOpen: true, selectedCollection: null, selectedLifeLinkMemberships: [{ collection, sections: [section] }],
      lifeLinkMemberships: { [canonicalLink.id]: [{ collection, sections: [section] }] }
    });
    controller.dispose();
  });

  it("retains the committed Collection revision when reconciliation fails", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    const changed = { ...collection, updatedAt: "2026-08-29T12:00:00.000Z", title: "Summer camping" };
    api.updateCollection.mockResolvedValue({ collection: changed });
    api.getCollection.mockRejectedValueOnce(new Error("Read unavailable"));
    await controller.updateCollection({ title: changed.title });
    expect(controller.getSnapshot()).toMatchObject({ selectedCollection: changed, collectionComplete: false, collectionLoading: false });
    expect(controller.getSnapshot().error).toBe("Read unavailable");
    controller.dispose();
  });

  it("uses the shared create and move commands for stable agent identity, hierarchy placement, and visible result", async () => {
    const api = fakeApi();
    let current = { ...canonicalLink, id: "life-link-new-kit", qrId: null };
    api.createLifeLink.mockImplementation(async () => ({ lifeLink: current }));
    const get = api.getLifeLinkDetail.getMockImplementation()!;
    api.getLifeLinkDetail.mockImplementation(async (id, options) => id === current.id ? { detail: { ...canonicalDetail, lifeLink: current } } : get(id, options));
    api.moveLifeLink.mockImplementation(async () => { current = { ...current, parentId: null, updatedAt: "2026-08-29T12:00:00.000Z" }; return { lifeLink: current }; });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { id: current.id, parentId: rootLifeLink.id, browsingRole: "item" as const, title: current.title };
    expect(await controller.agentCreateLifeLink(input)).toEqual({ ok: true });
    expect(api.createLifeLink).toHaveBeenCalledWith(input, { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ selectedLifeLinkId: current.id, workspaceMode: "hierarchies", detailsOpen: true });
    expect(await controller.agentMoveLifeLink({ lifeLinkId: current.id, parentId: null, baseUpdatedAt: canonicalLink.updatedAt })).toEqual({ ok: true });
    expect(api.moveLifeLink).toHaveBeenCalledWith(current.id, null, canonicalLink.updatedAt, { signal: undefined });
    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink.parentId).toBeNull();
    controller.dispose();
  });

  it("uses shared Collection commands, original revisions, stable Section IDs, and exact assignment sets", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const input = { action: "create_collection" as const, id: collection.id, title: collection.title };
    expect(await controller.agentMaintainCollection(input)).toEqual({ ok: true });
    expect(api.createCollection).toHaveBeenCalledWith({ id: input.id, title: input.title, purpose: undefined, notes: undefined }, { signal: undefined });
    const newer = { ...collection, updatedAt: "2026-08-29T12:00:00.000Z" };
    api.getCollection.mockResolvedValue({ collection: newer, sections: [section], sectionsPage: { nextCursor: null, truncated: false } });
    expect(await controller.agentMaintainCollection({ action: "create_section", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, id: section.id, title: section.title })).toEqual({ ok: true });
    expect(api.createCollectionSection).toHaveBeenCalledWith(collection.id, collection.updatedAt, { id: section.id, title: section.title }, { signal: undefined });
    expect(await controller.agentMaintainCollection({ action: "replace_sections", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, lifeLinkId: canonicalLink.id, sectionIds: [section.id] })).toEqual({ ok: true });
    expect(api.replaceCollectionSectionAssignments).toHaveBeenCalledWith(collection.id, canonicalLink.id, collection.updatedAt, [section.id], { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", selectedCollection: newer, collectionComplete: true });
    api.updateCollection.mockRejectedValueOnce(new ApiError(409, "stale_collection", {}, { retryable: true }));
    expect(await controller.agentMaintainCollection({ action: "update_collection", collectionId: collection.id, baseUpdatedAt: collection.updatedAt, title: "Changed" })).toEqual({ ok: false, code: "stale_collection" });
    controller.dispose();
  });

  it("reconciles QR changes and explicit public fields on the requested record from Collection mode", async () => {
    const api = fakeApi();
    let current = { ...canonicalLink };
    const get = api.getLifeLinkDetail.getMockImplementation()!;
    api.getLifeLinkDetail.mockImplementation(async (id, options) => id === current.id ? { detail: { ...canonicalDetail, lifeLink: current } } : get(id, options));
    api.clearLifeLinkQrBinding.mockImplementation(async () => { current = { ...current, qrId: null }; return { lifeLink: current }; });
    api.updateLifeLink.mockImplementation(async (_id, _rev, patch) => { current = { ...current, ...patch }; return { lifeLink: current }; });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/collections") });
    await controller.start();
    await controller.openCollection(collection.id);
    expect(await controller.agentManageLifeLinkQr({ action: "detach", lifeLinkId: current.id, commandId: "same-retry-id", baseUpdatedAt: current.updatedAt })).toEqual({ ok: true });
    expect(api.clearLifeLinkQrBinding).toHaveBeenCalledWith(current.id, current.updatedAt, "same-retry-id", { signal: undefined });
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "hierarchies", selectedLifeLinkId: current.id, selectedLifeLinkDetail: { lifeLink: { qrId: null } } });
    expect(await controller.agentManageLifeLinkQr({ action: "set_public_projection", lifeLinkId: current.id, baseUpdatedAt: current.updatedAt, privacy: "public", publicFieldKeys: ["plan"] })).toEqual({ ok: true });
    expect(api.updateLifeLink).toHaveBeenCalledWith(current.id, current.updatedAt, { privacy: "public", publicFieldKeys: ["plan"] }, { signal: undefined });
    controller.dispose();
  });

  it("cancels new tool operations before writes and refuses late owner or editor changes", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const abort = new AbortController();
    api.getLifeLinkDetail.mockImplementationOnce(async () => { abort.abort(); return { detail: canonicalDetail }; });
    expect(await controller.agentMoveLifeLink({ lifeLinkId: canonicalLink.id, parentId: null, baseUpdatedAt: canonicalLink.updatedAt }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    expect(api.moveLifeLink).not.toHaveBeenCalled();
    api.getCollection.mockImplementationOnce(async () => { await controller.logout(); return { collection, sections: [], sectionsPage: { nextCursor: null, truncated: false } }; });
    expect(await controller.agentMaintainCollection({ action: "add_member", collectionId: collection.id, lifeLinkId: canonicalLink.id, baseUpdatedAt: collection.updatedAt })).toEqual({ ok: false, code: "life_link_unavailable" });
    expect(api.addCollectionMember).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("lets canonical QR receipts resolve historical attach replay but rejects a new attach over an existing binding", async () => {
    const api = fakeApi();
    const current = { ...canonicalLink, qrId: "LL-NEWER-BINDING", updatedAt: "2026-08-29T00:00:00.000Z" };
    api.getLifeLinkDetail.mockResolvedValue({ detail: { ...canonicalDetail, lifeLink: current } });
    api.setLifeLinkQrBinding.mockResolvedValue({ lifeLink: current });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const historical = { action: "attach" as const, lifeLinkId: current.id, qrId: canonicalLink.qrId!, commandId: "original-attach", baseUpdatedAt: canonicalLink.updatedAt };
    expect(await controller.agentManageLifeLinkQr(historical)).toEqual({ ok: true });
    expect(api.setLifeLinkQrBinding).toHaveBeenCalledWith(current.id, historical.qrId, historical.baseUpdatedAt, historical.commandId, { signal: undefined });
    expect(controller.getSnapshot().selectedLifeLinkDetail?.lifeLink).toEqual(current);
    expect(await controller.agentManageLifeLinkQr({ ...historical, commandId: "new-attach", baseUpdatedAt: current.updatedAt })).toEqual({ ok: false, code: "invalid_operation" });
    expect(api.setLifeLinkQrBinding).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("cancels collection continuation reads without installing their delayed payload", async () => {
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const abort = new AbortController();
    api.listCollections.mockImplementationOnce(async () => ({ collections: [collection], nextCursor: null, truncated: false }));
    api.listCollections.mockImplementationOnce(async () => { abort.abort(); return { collections: [collection], nextCursor: null, truncated: false }; });
    expect(await controller.agentListCollections({ limit: 10 }, abort.signal)).toEqual({ ok: false, code: "cancelled" });
    expect(controller.getSnapshot().collectionsComplete).toBe(false);
    expect(controller.getSnapshot().collections).toEqual([]);
    expect(api.listCollections.mock.calls[1][0]?.signal).toBe(abort.signal);
    controller.dispose();
  });
});

describe("Routine workspace controller contract", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const createdAt = "2026-09-01T12:00:00.000Z";
  const fixture = (suffix: number, title = "Morning reset") => {
    const uuid = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const group = createCanonicalRoutineGroup({
      id: `routine-group-${uuid}`, ownerId: owner.id, title: `Home ${suffix}`, createdAt
    });
    const activity = createCanonicalActivity({
      id: `activity-${uuid}`, ownerId: owner.id, title: `Prepare ${suffix}`, createdAt
    });
    const routine = createCanonicalRoutine({
      id: `routine-${uuid}`, revisionId: `routine-revision-${uuid}`, ownerId: owner.id,
      groupId: group.id, title, purpose: `Purpose ${suffix}`,
      steps: [{
        id: `routine-step-${uuid}`, activityId: activity.id, activityTitle: activity.title, position: 0,
        plannedValues: [{ key: "ready", label: "Ready", kind: "boolean", value: true }]
      }], createdAt
    });
    const summary = {
      ...routine.routine,
      revisionNumber: routine.currentRevision.revision.revisionNumber,
      title: routine.currentRevision.revision.title,
      purpose: routine.currentRevision.revision.purpose
    };
    const run = {
      id: `routine-run-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
      routineRevisionId: routine.currentRevision.revision.id, occurrenceId: null, status: "active" as const,
      contextSnapshot: [], stepResults: [{
        routineStepId: routine.currentRevision.steps[0].id,
        actualValues: [{ key: "ready", label: "Ready", kind: "boolean" as const, value: false }],
        proposedNextValues: [{ key: "ready", label: "Ready", kind: "boolean" as const, value: true }],
        notes: "Keep the proposed default separate."
      }], startedAt: createdAt, updatedAt: createdAt
    };
    const schedule = createCanonicalRoutineSchedule({
      id: `routine-schedule-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
      routineRevisionId: routine.currentRevision.revision.id,
      rule: { kind: "once", localDate: "2026-09-01", localTime: "08:00", timeZone: "UTC" },
      createdAt
    });
    const occurrence = {
      id: `routine-occurrence-${uuid}`, ownerId: owner.id, scheduleId: schedule.id,
      scheduleRevision: 1, routineId: routine.routine.id, routineRevisionId: routine.currentRevision.revision.id,
      localDate: "2026-09-01", plannedFor: createdAt, status: "planned" as const, createdAt, updatedAt: createdAt
    };
    const session = {
      session: {
        id: `routine-session-${uuid}`, ownerId: owner.id, routineId: routine.routine.id,
        routineRevisionId: routine.currentRevision.revision.id, runId: run.id, occurrenceId: null,
        contextSnapshot: [], startedAt: createdAt, completedAt: createdAt
      },
      stepResults: [], sessionAmendments: []
    };
    return { group, activity, routine, summary, run, schedule, occurrence, session };
  };

  it("loads owner definitions/history, preserves Run result channels, and clears the nested slice on logout", async () => {
    const { group, activity, routine, summary, run } = fixture(1);
    const api = fakeApi();
    api.listRoutineGroups.mockResolvedValue({ routineGroups: [group], nextCursor: null, truncated: false });
    api.listRoutineActivities.mockResolvedValue({ activities: [activity], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValue({ routines: [summary], nextCursor: null, truncated: false });
    api.getRoutine.mockResolvedValue({ routine });
    api.startRoutineRun.mockResolvedValue({ run });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.loadRoutineWorkspace();
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [group], activities: [activity], routines: [summary], loading: false, error: ""
    });
    await controller.selectRoutine(routine.routine.id);
    await controller.startRoutineRun(routine.routine.id, { id: run.id });
    expect(controller.getSnapshot().routineWorkspace.activeRun?.stepResults[0]).toMatchObject({
      actualValues: [{ value: false }], proposedNextValues: [{ value: true }]
    });
    await controller.logout();
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [], activities: [], routines: [], activeRun: null, sessions: []
    });
    controller.dispose();
  });

  it.each(["start", "resume"] as const)(
    "does not restore a finalized Run as active when %s replays after finalization",
    async (replay) => {
      const current = fixture(replay === "start" ? 13 : 14, `${replay} replay`);
      const finalizedRun = { ...current.run, status: "finalized" as const };
      const api = fakeApi();
      api.getRoutine.mockResolvedValue({ routine: current.routine });
      api.startRoutineRun.mockResolvedValueOnce({ run: current.run });
      api.finalizeRoutineRun.mockResolvedValue({ run: finalizedRun, session: current.session });
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(current.routine.routine.id);
      await controller.startRoutineRun(current.routine.routine.id, { id: current.run.id });
      await controller.finalizeRoutineRun(current.run.id, {
        sessionId: current.session.session.id, expectedUpdatedAt: current.run.updatedAt
      });
      expect(controller.getSnapshot().routineWorkspace.activeRun).toBeNull();

      if (replay === "start") {
        api.startRoutineRun.mockResolvedValueOnce({ run: finalizedRun });
        await controller.startRoutineRun(current.routine.routine.id, { id: current.run.id });
      } else {
        api.getRoutineRun.mockResolvedValueOnce({ run: finalizedRun });
        await controller.resumeRoutineRun(current.run.id);
      }

      expect(controller.getSnapshot().routineWorkspace.activeRun).toBeNull();
      controller.dispose();
    }
  );

  it("refuses a delayed Routine mutation response after logout and account switch", async () => {
    const delayed = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["createRoutineActivity"]>>>();
    const old = fixture(2);
    const nextOwner = { ...owner, id: "owner-2", email: "owner-2@example.test" };
    const api = fakeApi();
    api.createRoutineActivity.mockImplementationOnce(() => delayed.promise);
    api.login.mockResolvedValueOnce({
      user: nextOwner, qrBaseUrl: "https://example.test", agentConnection: disconnectedAgentConnection
    });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    const pending = controller.createRoutineActivity({ id: old.activity.id, title: old.activity.title });
    await vi.waitFor(() => expect(api.createRoutineActivity).toHaveBeenCalledOnce());
    await controller.logout();
    await controller.login(nextOwner.email, "test-password");
    delayed.resolve({ activity: old.activity });
    await pending;
    expect(controller.getSnapshot().currentUser).toEqual(nextOwner);
    expect(controller.getSnapshot().routineWorkspace.activities).toEqual([]);
    controller.dispose();
  });

  it.each(["start", "resume", "result", "finalize"] as const)(
    "does not let a delayed %s response replace a newly selected Routine or Run",
    async (operation) => {
      const first = fixture(7, "Selected first");
      const second = fixture(8, "Selected second");
      const api = fakeApi();
      api.getRoutine.mockImplementation(async (routineId) => ({
        routine: routineId === first.routine.routine.id ? first.routine : second.routine
      }));
      api.getActiveRoutineRun.mockImplementation(async (routineId) => ({
        run: routineId === first.routine.routine.id ? first.run : second.run
      }));
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(first.routine.routine.id);

      let pending: Promise<void>;
      let settle: () => void;
      if (operation === "start") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["startRoutineRun"]>>>();
        api.startRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.startRoutineRun(first.routine.routine.id, { id: first.run.id });
        settle = () => response.resolve({ run: first.run });
      } else if (operation === "resume") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineRun"]>>>();
        api.getRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.resumeRoutineRun(first.run.id);
        settle = () => response.resolve({ run: first.run });
      } else if (operation === "result") {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["putRoutineRunStepResult"]>>>();
        api.putRoutineRunStepResult.mockImplementationOnce(() => response.promise);
        pending = controller.putRoutineRunStepResult(first.run.id, first.routine.currentRevision.steps[0].id, {
          expectedUpdatedAt: first.run.updatedAt,
          actualValues: first.run.stepResults[0].actualValues,
          proposedNextValues: first.run.stepResults[0].proposedNextValues
        });
        settle = () => response.resolve({ run: first.run });
      } else {
        const response = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["finalizeRoutineRun"]>>>();
        api.finalizeRoutineRun.mockImplementationOnce(() => response.promise);
        pending = controller.finalizeRoutineRun(first.run.id, {
          sessionId: first.session.session.id,
          expectedUpdatedAt: first.run.updatedAt
        });
        settle = () => response.resolve({ run: { ...first.run, status: "finalized" }, session: first.session });
      }
      await vi.waitFor(() => {
        const method = operation === "start" ? api.startRoutineRun : operation === "resume" ? api.getRoutineRun :
          operation === "result" ? api.putRoutineRunStepResult : api.finalizeRoutineRun;
        expect(method).toHaveBeenCalledOnce();
      });
      await controller.selectRoutine(second.routine.routine.id);
      settle();
      await pending;
      expect(controller.getSnapshot().routineWorkspace).toMatchObject({
        selectedRoutine: second.routine,
        activeRun: second.run
      });
      expect(controller.getSnapshot().routineWorkspace.selectedSession).toBeNull();
      controller.dispose();
    }
  );

  it("keeps the newest same-owner Routine workspace, selection, occurrence, and Session reads", async () => {
    const first = fixture(3, "First Routine");
    const second = fixture(4, "Second Routine");
    const api = fakeApi();
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();

    const firstRoutine = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutine"]>>>();
    const secondRoutine = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutine"]>>>();
    api.getRoutine.mockImplementation((routineId) => routineId === first.routine.routine.id ? firstRoutine.promise : secondRoutine.promise);
    api.getActiveRoutineRun.mockImplementation(async (routineId) => ({
      run: routineId === first.routine.routine.id ? first.run : second.run
    }));
    const selectingFirst = controller.selectRoutine(first.routine.routine.id);
    const selectingSecond = controller.selectRoutine(second.routine.routine.id);
    secondRoutine.resolve({ routine: second.routine });
    await selectingSecond;
    firstRoutine.resolve({ routine: first.routine });
    await selectingFirst;
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      selectedRoutine: second.routine,
      activeRun: second.run
    });

    const firstOccurrences = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutineOccurrences"]>>>();
    const secondOccurrences = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutineOccurrences"]>>>();
    api.listRoutineOccurrences.mockImplementationOnce(() => firstOccurrences.promise).mockImplementationOnce(() => secondOccurrences.promise);
    const loadingFirstOccurrences = controller.loadRoutineOccurrences({ routineId: first.routine.routine.id });
    const loadingSecondOccurrences = controller.loadRoutineOccurrences({ routineId: second.routine.routine.id });
    secondOccurrences.resolve({ occurrences: [second.occurrence], nextCursor: null, truncated: false });
    await loadingSecondOccurrences;
    firstOccurrences.resolve({ occurrences: [first.occurrence], nextCursor: null, truncated: false });
    await loadingFirstOccurrences;
    expect(controller.getSnapshot().routineWorkspace.occurrences).toEqual([second.occurrence]);

    const firstSession = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineSession"]>>>();
    const secondSession = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getRoutineSession"]>>>();
    api.getRoutineSession.mockImplementation((sessionId) => sessionId === first.session.session.id ? firstSession.promise : secondSession.promise);
    const selectingFirstSession = controller.selectRoutineSession(first.session.session.id);
    const selectingSecondSession = controller.selectRoutineSession(second.session.session.id);
    secondSession.resolve({ session: second.session });
    await selectingSecondSession;
    firstSession.resolve({ session: first.session });
    await selectingFirstSession;
    expect(controller.getSnapshot().routineWorkspace.selectedSession).toEqual(second.session);

    const firstWorkspace = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutines"]>>>();
    const secondWorkspace = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listRoutines"]>>>();
    api.listRoutines.mockImplementationOnce(() => firstWorkspace.promise).mockImplementationOnce(() => secondWorkspace.promise);
    api.listRoutineOccurrences.mockResolvedValue({ occurrences: [], nextCursor: null, truncated: false });
    api.listRoutineSessions.mockResolvedValue({ sessions: [], nextCursor: null, truncated: false });
    const loadingFirstWorkspace = controller.loadRoutineWorkspace();
    const loadingSecondWorkspace = controller.loadRoutineWorkspace();
    secondWorkspace.resolve({ routines: [second.summary], nextCursor: null, truncated: false });
    await loadingSecondWorkspace;
    firstWorkspace.resolve({ routines: [first.summary], nextCursor: null, truncated: false });
    await loadingFirstWorkspace;
    expect(controller.getSnapshot().routineWorkspace.routines).toEqual([second.summary]);
    controller.dispose();
  });

  it("reloads archived definitions and consumes every Routine cursor without replacing earlier pages", async () => {
    const first = fixture(5, "First page");
    const second = fixture(6, "Second page");
    const api = fakeApi();
    api.listRoutineGroups.mockResolvedValueOnce({ routineGroups: [first.group], nextCursor: "groups-next", truncated: true });
    api.listRoutineActivities.mockResolvedValueOnce({ activities: [first.activity], nextCursor: "activities-next", truncated: true });
    api.listRoutines.mockResolvedValueOnce({ routines: [first.summary], nextCursor: "routines-next", truncated: true });
    api.listRoutineOccurrences.mockResolvedValueOnce({ occurrences: [first.occurrence], nextCursor: "occurrences-next", truncated: true });
    api.listRoutineSessions.mockResolvedValueOnce({ sessions: [first.session], nextCursor: "sessions-next", truncated: true });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.loadRoutineWorkspace({ includeArchived: true });
    expect(api.listRoutineGroups).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });
    expect(api.listRoutineActivities).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });
    expect(api.listRoutines).toHaveBeenLastCalledWith({ includeArchived: true, signal: undefined });

    api.listRoutineGroups.mockResolvedValueOnce({ routineGroups: [second.group], nextCursor: null, truncated: false });
    api.listRoutineActivities.mockResolvedValueOnce({ activities: [second.activity], nextCursor: null, truncated: false });
    api.listRoutines.mockResolvedValueOnce({ routines: [second.summary], nextCursor: null, truncated: false });
    await Promise.all([
      controller.loadMoreRoutineGroups(), controller.loadMoreRoutineActivities(), controller.loadMoreRoutines()
    ]);
    expect(api.listRoutineGroups).toHaveBeenLastCalledWith({ cursor: "groups-next", includeArchived: true, signal: undefined });
    expect(api.listRoutineActivities).toHaveBeenLastCalledWith({ cursor: "activities-next", includeArchived: true, signal: undefined });
    expect(api.listRoutines).toHaveBeenLastCalledWith({ cursor: "routines-next", includeArchived: true, signal: undefined });

    api.listRoutineOccurrences.mockResolvedValueOnce({ occurrences: [second.occurrence], nextCursor: null, truncated: false });
    api.listRoutineSessions.mockResolvedValueOnce({ sessions: [second.session], nextCursor: null, truncated: false });
    await controller.loadRoutineOccurrences({ cursor: "occurrences-next" });
    await controller.loadRoutineSessions({ cursor: "sessions-next" });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      groups: [first.group, second.group],
      activities: [first.activity, second.activity],
      routines: [first.summary, second.summary],
      occurrences: [first.occurrence, second.occurrence],
      sessions: [first.session, second.session],
      includeArchived: true
    });
    controller.dispose();
  });

  it.each(["activity", "routine"] as const)(
    "reloads selected planning state after archiving a Routine %s",
    async (target) => {
      const current = fixture(target === "activity" ? 9 : 10, `Archive ${target}`);
      const inactiveSchedule = {
        ...current.schedule, active: false, revision: current.schedule.revision + 1,
        updatedAt: "2026-09-01T12:01:00.000Z"
      };
      const canceledOccurrence = {
        ...current.occurrence, status: "canceled" as const, updatedAt: "2026-09-01T12:01:00.000Z"
      };
      const api = fakeApi();
      api.getRoutine.mockResolvedValue({ routine: current.routine });
      api.listRoutineSchedules
        .mockResolvedValueOnce({ schedules: [current.schedule], nextCursor: null, truncated: false })
        .mockResolvedValueOnce({ schedules: [inactiveSchedule], nextCursor: null, truncated: false });
      api.listRoutineOccurrences
        .mockResolvedValueOnce({ occurrences: [current.occurrence], nextCursor: null, truncated: false })
        .mockResolvedValueOnce({ occurrences: [canceledOccurrence], nextCursor: null, truncated: false });
      api.updateRoutineActivity.mockResolvedValue({
        activity: { ...current.activity, archivedAt: "2026-09-01T12:01:00.000Z", updatedAt: "2026-09-01T12:01:00.000Z" }
      });
      api.updateRoutine.mockResolvedValue({
        routine: {
          ...current.routine,
          routine: {
            ...current.routine.routine, archivedAt: "2026-09-01T12:01:00.000Z",
            updatedAt: "2026-09-01T12:01:00.000Z"
          }
        }
      });
      const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
      await controller.start();
      await controller.selectRoutine(current.routine.routine.id);
      await controller.loadRoutineOccurrences({ routineId: current.routine.routine.id });

      if (target === "activity") {
        await controller.updateRoutineActivity(current.activity.id, current.activity.updatedAt, {
          archivedAt: "2026-09-01T12:01:00.000Z"
        });
      } else {
        await controller.updateRoutine(current.routine.routine.id, current.routine.routine.updatedAt, {
          archivedAt: "2026-09-01T12:01:00.000Z"
        });
      }

      expect(controller.getSnapshot().routineWorkspace).toMatchObject({
        schedules: [inactiveSchedule], occurrences: [canceledOccurrence]
      });
      expect(api.listRoutineSchedules).toHaveBeenCalledTimes(2);
      expect(api.listRoutineOccurrences).toHaveBeenCalledTimes(2);
      controller.dispose();
    }
  );

  it("replaces selected occurrences after schedule creation and reconciliation", async () => {
    const current = fixture(11, "Schedule reconciliation");
    const createdOccurrence = {
      ...current.occurrence,
      id: current.occurrence.id.replace(/11$/, "12"),
      localDate: "2026-09-02",
      plannedFor: "2026-09-02T08:00:00.000Z"
    };
    const reconciledOccurrence = {
      ...createdOccurrence, status: "canceled" as const, updatedAt: "2026-09-01T12:02:00.000Z"
    };
    const revisedSchedule = {
      ...current.schedule, active: false, revision: 2, updatedAt: "2026-09-01T12:02:00.000Z"
    };
    const api = fakeApi();
    api.getRoutine.mockResolvedValue({ routine: current.routine });
    api.listRoutineSchedules.mockResolvedValue({ schedules: [], nextCursor: null, truncated: false });
    api.listRoutineOccurrences
      .mockResolvedValueOnce({ occurrences: [current.occurrence], nextCursor: "stale-next", truncated: true })
      .mockResolvedValueOnce({ occurrences: [createdOccurrence], nextCursor: null, truncated: false })
      .mockResolvedValueOnce({ occurrences: [reconciledOccurrence], nextCursor: null, truncated: false });
    api.createRoutineSchedule.mockResolvedValue({ schedule: current.schedule });
    api.updateRoutineSchedule.mockResolvedValue({ schedule: revisedSchedule });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links") });
    await controller.start();
    await controller.selectRoutine(current.routine.routine.id);
    await controller.loadRoutineOccurrences({ routineId: current.routine.routine.id });

    await controller.createRoutineSchedule(current.routine.routine.id, {
      id: current.schedule.id, rule: current.schedule.rule
    });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      schedules: [current.schedule], occurrences: [createdOccurrence], occurrencesNextCursor: null
    });

    await controller.updateRoutineSchedule(current.schedule.id, current.schedule.updatedAt, { active: false });
    expect(controller.getSnapshot().routineWorkspace).toMatchObject({
      schedules: [revisedSchedule], occurrences: [reconciledOccurrence], occurrencesNextCursor: null
    });
    expect(api.listRoutineOccurrences).toHaveBeenCalledTimes(3);
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
    getLifeLinkAttachmentContent: vi.fn<LifeLinksWorkspaceApi["getLifeLinkAttachmentContent"]>(),
    getLifeLinkAttachmentImage: vi.fn<LifeLinksWorkspaceApi["getLifeLinkAttachmentImage"]>(),
    getChangeHistory: vi.fn<LifeLinksWorkspaceApi["getChangeHistory"]>(async () => ({ limit: 5, entries: [] })),
    previewLifeLinkChange: vi.fn<LifeLinksWorkspaceApi["previewLifeLinkChange"]>(),
    getLifeLinkChangePreview: vi.fn<LifeLinksWorkspaceApi["getLifeLinkChangePreview"]>(),
    applyLifeLinkChange: vi.fn<LifeLinksWorkspaceApi["applyLifeLinkChange"]>(),
    undoChange: vi.fn<LifeLinksWorkspaceApi["undoChange"]>(),
    listCollections: vi.fn<LifeLinksWorkspaceApi["listCollections"]>(async () => ({ collections: [], nextCursor: null, truncated: false })),
    getCollection: vi.fn<LifeLinksWorkspaceApi["getCollection"]>(async () => ({ collection, sections: [section], sectionsPage: { nextCursor: null, truncated: false } })),
    createCollection: vi.fn<LifeLinksWorkspaceApi["createCollection"]>(async () => ({ collection })),
    updateCollection: vi.fn<LifeLinksWorkspaceApi["updateCollection"]>(async () => ({ collection })),
    listCollectionMembers: vi.fn<LifeLinksWorkspaceApi["listCollectionMembers"]>(async () => ({ lifeLinks: [canonicalLink], nextCursor: null, truncated: false })),
    listLifeLinkCollectionMemberships: vi.fn<LifeLinksWorkspaceApi["listLifeLinkCollectionMemberships"]>(async () => ({ memberships: [], nextCursor: null, truncated: false })),
    addCollectionMember: vi.fn<LifeLinksWorkspaceApi["addCollectionMember"]>(async () => ({ collection })),
    removeCollectionMember: vi.fn<LifeLinksWorkspaceApi["removeCollectionMember"]>(async () => ({ collection })),
    createCollectionSection: vi.fn<LifeLinksWorkspaceApi["createCollectionSection"]>(async () => ({ collection, section })),
    updateCollectionSection: vi.fn<LifeLinksWorkspaceApi["updateCollectionSection"]>(async () => ({ collection, section })),
    removeCollectionSection: vi.fn<LifeLinksWorkspaceApi["removeCollectionSection"]>(async () => ({ collection })),
    replaceCollectionSectionAssignments: vi.fn<LifeLinksWorkspaceApi["replaceCollectionSectionAssignments"]>(async () => ({ collection })),
    setLifeLinkQrBinding: vi.fn<LifeLinksWorkspaceApi["setLifeLinkQrBinding"]>(async () => ({ lifeLink: canonicalLink })),
    clearLifeLinkQrBinding: vi.fn<LifeLinksWorkspaceApi["clearLifeLinkQrBinding"]>(async () => ({ lifeLink: { ...canonicalLink, qrId: null } })),
    appendRoutineSessionAmendment: vi.fn<LifeLinksWorkspaceApi["appendRoutineSessionAmendment"]>(),
    createRoutine: vi.fn<LifeLinksWorkspaceApi["createRoutine"]>(),
    createRoutineActivity: vi.fn<LifeLinksWorkspaceApi["createRoutineActivity"]>(),
    createRoutineGroup: vi.fn<LifeLinksWorkspaceApi["createRoutineGroup"]>(),
    createRoutineSchedule: vi.fn<LifeLinksWorkspaceApi["createRoutineSchedule"]>(),
    finalizeRoutineRun: vi.fn<LifeLinksWorkspaceApi["finalizeRoutineRun"]>(),
    getRoutine: vi.fn<LifeLinksWorkspaceApi["getRoutine"]>(),
    getRoutineRun: vi.fn<LifeLinksWorkspaceApi["getRoutineRun"]>(),
    getRoutineSession: vi.fn<LifeLinksWorkspaceApi["getRoutineSession"]>(),
    getActiveRoutineRun: vi.fn<LifeLinksWorkspaceApi["getActiveRoutineRun"]>(async () => ({ run: null })),
    listRoutineActivities: vi.fn<LifeLinksWorkspaceApi["listRoutineActivities"]>(async () => ({ activities: [], nextCursor: null, truncated: false })),
    listRoutineGroups: vi.fn<LifeLinksWorkspaceApi["listRoutineGroups"]>(async () => ({ routineGroups: [], nextCursor: null, truncated: false })),
    listRoutineOccurrences: vi.fn<LifeLinksWorkspaceApi["listRoutineOccurrences"]>(async () => ({ occurrences: [], nextCursor: null, truncated: false })),
    listRoutines: vi.fn<LifeLinksWorkspaceApi["listRoutines"]>(async () => ({ routines: [], nextCursor: null, truncated: false })),
    listRoutineSchedules: vi.fn<LifeLinksWorkspaceApi["listRoutineSchedules"]>(async () => ({ schedules: [], nextCursor: null, truncated: false })),
    listRoutineSessions: vi.fn<LifeLinksWorkspaceApi["listRoutineSessions"]>(async () => ({ sessions: [], nextCursor: null, truncated: false })),
    putRoutineRunStepResult: vi.fn<LifeLinksWorkspaceApi["putRoutineRunStepResult"]>(),
    reviseRoutine: vi.fn<LifeLinksWorkspaceApi["reviseRoutine"]>(),
    startRoutineRun: vi.fn<LifeLinksWorkspaceApi["startRoutineRun"]>(),
    updateRoutine: vi.fn<LifeLinksWorkspaceApi["updateRoutine"]>(),
    updateRoutineActivity: vi.fn<LifeLinksWorkspaceApi["updateRoutineActivity"]>(),
    updateRoutineGroup: vi.fn<LifeLinksWorkspaceApi["updateRoutineGroup"]>(),
    updateRoutineSchedule: vi.fn<LifeLinksWorkspaceApi["updateRoutineSchedule"]>(),
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
    uploadLinkMedia: vi.fn(async () => ({ media: link.media[0] })),
    deleteLinkMedia: vi.fn(async () => undefined),
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
    listLifeLinks: vi.fn<LifeLinksWorkspaceApi["listLifeLinks"]>(async (options = {}) => ({
      lifeLinks: options.parentId === rootLifeLink.id ? [canonicalSummary] : [rootSummary],
      nextCursor: null,
      truncated: false
    })),
    createLifeLink: vi.fn(async () => ({ lifeLink: canonicalLink })),
    getLifeLinkDetail: vi.fn<LifeLinksWorkspaceApi["getLifeLinkDetail"]>(async (id) => ({
      detail: id === rootLifeLink.id ? {
        lifeLink: rootLifeLink, ancestry: { items: [rootSummary], truncated: false, omittedCount: 0 },
        children: [canonicalSummary], childrenPage: { nextCursor: null, truncated: false }
      } : canonicalDetail
    })),
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

describe("shared owner changes and agent confirmation", () => {
  beforeEach(() => { vi.stubGlobal("window", { localStorage: new MemoryStorage() }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const preview: LifeLinkChangePreview = { id: "preview-delete", operation: "delete", rootIds: [rootLifeLink.id],
    items: [rootLifeLink, canonicalLink], parentId: null, target: null,
    sideEffects: { lifeLinks: 2, media: 1, qrBindings: 1, collectionMemberships: 1, collectionSectionAssignments: 2 }, createdAt: rootLifeLink.createdAt };

  async function setup() {
    const api = fakeApi();
    api.previewLifeLinkChange.mockResolvedValue(preview);
    api.applyLifeLinkChange.mockResolvedValue({ operation: "delete", affectedIds: [rootLifeLink.id, canonicalLink.id], history: { limit: 5, entries: [{ id: "change-1", label: "Delete 2 Life Links", createdAt: preview.createdAt }] } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links"), commandId: () => "stable-command" });
    await controller.start();
    await controller.connectAgent();
    await controller.agentPreviewLifeLinkChange({ operation: "delete", lifeLinkIds: [rootLifeLink.id] });
    return { api, controller };
  }

  it("waits for one app-observed confirmation after a full preview, then commits exactly once", async () => {
    const { api, controller } = await setup();
    const pending = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.confirmAgentChange(true);
    expect(await pending).toMatchObject({ ok: true });
    expect(api.applyLifeLinkChange).toHaveBeenCalledExactlyOnceWith(preview.id, "change-stable-command", undefined);
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ busy: false, rootLifeLinks: { loaded: true } });
    controller.dispose();
  });

  it("reserves one agent apply before async draft reads and never replaces its confirmation", async () => {
    const { api, controller } = await setup();
    const detail = await api.getLifeLinkDetail(rootLifeLink.id);
    const reading = deferred<typeof detail>();
    api.getLifeLinkDetail.mockImplementationOnce(() => reading.promise);
    const first = controller.agentApplyLifeLinkChange(preview.id);
    const secondAbort = new AbortController();
    expect(await controller.agentApplyLifeLinkChange(preview.id, secondAbort.signal)).toEqual({ ok: false, code: "invalid_operation" });
    secondAbort.abort();
    reading.resolve(detail);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(false);
    expect(await first).toEqual({ ok: false, code: "cancelled" });
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("replays an uncertain confirmed deletion without rereading deleted items or confirming twice", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockImplementationOnce(async () => {
      // The store committed, but the response was lost; all selected records are gone.
      api.getLifeLinkDetail.mockRejectedValue(new ApiError(404, "life_link_not_found", {}));
      api.listLifeLinks.mockResolvedValue({ lifeLinks: [], nextCursor: null, truncated: false });
      throw new Error("connection lost after commit");
    });
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    expect(await first).toEqual({ ok: false, code: "effect_not_applied" });
    const readsAfterCommit = api.getLifeLinkDetail.mock.calls.length;
    expect(await controller.agentApplyLifeLinkChange(preview.id)).toMatchObject({ ok: true, change: { operation: "delete", affectedIds: [rootLifeLink.id, canonicalLink.id] } });
    expect(api.getLifeLinkDetail).toHaveBeenCalledTimes(readsAfterCommit);
    expect(api.applyLifeLinkChange.mock.calls.map((call) => call[1])).toEqual(["change-stable-command", "change-stable-command"]);
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    controller.dispose();
  });

  it("still checks descendant drafts before the first apply", async () => {
    const { api, controller } = await setup();
    writeCanonicalLifeLinkDraft(canonicalLink.id, canonicalLink.updatedAt, { title: "Unsaved child", body: "Draft", bodyDoc: canonicalLink.bodyDoc, bodyDocVersion: 1, privacy: canonicalLink.privacy, context: canonicalLink.context });
    expect(await controller.agentApplyLifeLinkChange(preview.id)).toEqual({ ok: false, code: "editor_dirty" });
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("requires a fresh app choice after a definitive stale-preview rejection", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new ApiError(409, "stale_life_link", {}));
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    expect(await first).toEqual({ ok: false, code: "stale_life_link" });
    const retry = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(false);
    expect(await retry).toEqual({ ok: false, code: "cancelled" });
    expect(api.applyLifeLinkChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it.each(["disconnect", "logout", "dispose"])("%s clears uncertain agent commit authority", async (mode) => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new Error("connection lost"));
    const first = controller.agentApplyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).toEqual(preview));
    controller.confirmAgentChange(true);
    await first;
    if (mode === "disconnect") { await controller.disconnectAgent(); await controller.connectAgent(); }
    else if (mode === "logout") { await controller.logout(); await controller.login(owner.email, "test-password"); await controller.connectAgent(); }
    else { controller.dispose(); await controller.start(); }
    expect((await controller.agentApplyLifeLinkChange(preview.id)).ok).toBe(false);
    expect(api.applyLifeLinkChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("disconnecting during admission reads cancels before displaying a confirmation", async () => {
    const { api, controller } = await setup();
    const detail = await api.getLifeLinkDetail(rootLifeLink.id);
    const reading = deferred<typeof detail>();
    api.getLifeLinkDetail.mockImplementationOnce(() => reading.promise);
    const pending = controller.agentApplyLifeLinkChange(preview.id);
    await controller.disconnectAgent();
    reading.resolve(detail);
    expect(await pending).toEqual({ ok: false, code: "cancelled" });
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    controller.dispose();
  });

  it.each(["cancel", "abort", "disconnect", "logout"])("%s cancels a pending agent deletion with zero writes", async (mode) => {
    const { api, controller } = await setup();
    const abort = new AbortController();
    const pending = controller.agentApplyLifeLinkChange(preview.id, abort.signal);
    await vi.waitFor(() => expect(controller.getSnapshot().agentChangeConfirmation).not.toBeNull());
    if (mode === "cancel") controller.confirmAgentChange(false);
    else if (mode === "abort") abort.abort();
    else if (mode === "disconnect") await controller.disconnectAgent();
    else await controller.logout();
    expect((await pending).ok).toBe(false);
    expect(api.applyLifeLinkChange).not.toHaveBeenCalled();
    expect(controller.getSnapshot().agentChangeConfirmation).toBeNull();
    controller.dispose();
  });

  it("keeps one command identity through an uncertain network response", async () => {
    const { api, controller } = await setup();
    api.applyLifeLinkChange.mockRejectedValueOnce(new Error("connection lost"));
    await expect(controller.applyLifeLinkChange(preview.id)).rejects.toThrow("connection lost");
    await controller.applyLifeLinkChange(preview.id);
    expect(api.applyLifeLinkChange.mock.calls.map((call) => call[1])).toEqual(["change-stable-command", "change-stable-command"]);
    controller.dispose();
  });

  it("loads account history after reload and requests only the displayed newest entry", async () => {
    const api = fakeApi();
    const history = { limit: 5 as const, entries: [{ id: "existing-change", label: "Edit Collection", createdAt: preview.createdAt }] };
    api.getChangeHistory.mockResolvedValue(history);
    api.undoChange.mockResolvedValue({ operation: "undo", affectedIds: [], history: { limit: 5, entries: [] } });
    const controller = new LifeLinksWorkspaceController({ api, route: new FakeRoute("/life-links"), commandId: () => "undo-id" });
    await controller.start();
    expect(controller.getSnapshot().changeHistory).toEqual(history);
    await controller.undoLastChange();
    expect(api.undoChange).toHaveBeenCalledExactlyOnceWith("existing-change", "change-undo-id");
    controller.dispose();
  });

  it.each(["navigate", "change owner"])("does not restore the old selection when users %s during mutation readback", async (action) => {
    const { api, controller } = await setup();
    await controller.activateLifeLink(canonicalLink.id);
    const reading = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["listLifeLinks"]>>>();
    let refreshing = false;
    api.listLifeLinks.mockImplementationOnce(() => { refreshing = true; return reading.promise; });
    api.applyLifeLinkChange.mockResolvedValue({ operation: "move", affectedIds: [canonicalLink.id], history: { limit: 5, entries: [] } });
    const pending = controller.applyLifeLinkChange(preview.id);
    await vi.waitFor(() => expect(refreshing).toBe(true));
    if (action === "change owner") {
      await controller.logout();
      api.login.mockResolvedValue({ user: { ...owner, id: "owner-2" }, qrBaseUrl: "https://example.test", agentConnection: disconnectedAgentConnection });
      api.listLifeLinks.mockResolvedValue({ lifeLinks: [], nextCursor: null, truncated: false });
      api.listLinks.mockResolvedValue({ links: [] });
      api.getLifeLinkDetail.mockRejectedValue(new ApiError(404, "life_link_not_found", {}));
      await controller.login("second@example.test", "test-password");
    }
    await controller.openCollections();
    api.getLifeLinkDetail.mockClear();
    reading.resolve({ lifeLinks: [rootSummary], nextCursor: null, truncated: false });
    await pending;
    expect(controller.getSnapshot()).toMatchObject({ workspaceMode: "collections", routePathname: "/collections", selectedLifeLinkId: null, error: "" });
    expect(api.getLifeLinkDetail).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not let an older automatic history failure erase a newer successful history", async () => {
    const { api, controller } = await setup();
    await controller.getChangeHistory();
    const oldHistory = deferred<Awaited<ReturnType<LifeLinksWorkspaceApi["getChangeHistory"]>>>();
    api.getChangeHistory.mockImplementationOnce(() => oldHistory.promise);
    const historyCalls = vi.spyOn(controller, "getChangeHistory");
    await controller.connectAgent(); // busy -> idle starts the older automatic request.
    const oldRequest = historyCalls.mock.results[0].value as Promise<unknown>;
    const history = { limit: 5 as const, entries: [{ id: "newer-change", label: "Move 1 Life Link", createdAt: preview.createdAt }] };
    api.getChangeHistory.mockResolvedValue(history);
    await controller.getChangeHistory();
    oldHistory.reject(new Error("older refresh failed"));
    await expect(oldRequest).rejects.toThrow("older refresh failed");
    expect(controller.getSnapshot().changeHistory).toEqual(history);
    api.getChangeHistory.mockRejectedValueOnce(new Error("current refresh failed"));
    await expect(controller.getChangeHistory()).rejects.toThrow("current refresh failed");
    expect(controller.getSnapshot().changeHistory.entries).toEqual([]);
    controller.dispose();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function summary(lifeLink: LifeLinkRecord, childCount: number): LifeLinkSummary {
  return summarizeLifeLink(lifeLink, childCount);
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
