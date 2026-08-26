import QRCode from "qrcode";
import {
  DEFAULT_QR_BASE_URL,
  DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT,
  DEFAULT_LIFE_LINK_SEARCH_LIMIT,
  linksToCsv,
  normalizeBatchCount,
  parseQrId,
  type CreateLifeLinkInput,
  type LifeLinkDetail,
  type LifeLinkRecord,
  type LifeLinkSearchItem,
  type LifeLinkSummary,
  type LinkRecord,
  type QrViewState,
  type UpdateLifeLinkPatch
} from "@life-links/core";

import {
  ApiError,
  attachQr,
  claimQr,
  createLifeLink,
  createProject,
  createQrBatch,
  deleteLifeLinkMedia,
  deleteLinkMedia,
  findScan,
  getConfig,
  getLifeLinkDetail,
  getMe,
  getQr,
  listLifeLinks,
  listLinks,
  listProjects,
  login,
  logout,
  moveLifeLink,
  searchLifeLinks,
  updateLifeLink,
  updateLink,
  uploadLifeLinkMedia,
  uploadLinkMedia
} from "../api";
import { clearCanonicalLifeLinkDraft, clearLinkEditorDraft } from "./editorSession";
import {
  classifyLifeLinksRoute,
  createWindowWorkspaceRoute,
  ownerLifeLinkPath,
  qrIdFromPath,
  type WorkspaceBrowserRoute
} from "./routes";
import type {
  CanonicalLifeLinkEditorPatch,
  InventoryFilter,
  LifeLinkBranchState,
  LifeLinksWorkspaceSnapshot,
  LinkEditorPatch,
  ThemeMode,
  WorkspaceView
} from "./types";

export type LifeLinksWorkspaceApi = {
  getConfig: typeof getConfig;
  getMe: typeof getMe;
  login: typeof login;
  logout: typeof logout;
  listLinks: typeof listLinks;
  listProjects: typeof listProjects;
  updateLink: typeof updateLink;
  uploadLinkMedia: typeof uploadLinkMedia;
  deleteLinkMedia: typeof deleteLinkMedia;
  createProject: typeof createProject;
  createQrBatch: typeof createQrBatch;
  getQr: typeof getQr;
  claimQr: typeof claimQr;
  findScan: typeof findScan;
  listLifeLinks: typeof listLifeLinks;
  createLifeLink: typeof createLifeLink;
  getLifeLinkDetail: typeof getLifeLinkDetail;
  searchLifeLinks: typeof searchLifeLinks;
  updateLifeLink: typeof updateLifeLink;
  moveLifeLink: typeof moveLifeLink;
  uploadLifeLinkMedia: typeof uploadLifeLinkMedia;
  deleteLifeLinkMedia: typeof deleteLifeLinkMedia;
  attachQr: typeof attachQr;
};

const defaultApi: LifeLinksWorkspaceApi = {
  getConfig,
  getMe,
  login,
  logout,
  listLinks,
  listProjects,
  updateLink,
  uploadLinkMedia,
  deleteLinkMedia,
  createProject,
  createQrBatch,
  getQr,
  claimQr,
  findScan,
  listLifeLinks,
  createLifeLink,
  getLifeLinkDetail,
  searchLifeLinks,
  updateLifeLink,
  moveLifeLink,
  uploadLifeLinkMedia,
  deleteLifeLinkMedia,
  attachQr
};

type LifeLinksWorkspaceControllerOptions = {
  api?: LifeLinksWorkspaceApi;
  route?: WorkspaceBrowserRoute;
  commandId?: () => string;
};

export interface LifeLinksWorkspaceActions {
  getSnapshot(): LifeLinksWorkspaceSnapshot;
  subscribe(listener: () => void): () => void;
  refreshOwnerLibrary(): Promise<void>;
  openQr(qrId: string, updateHistory?: boolean): Promise<void>;
  scanQr(scanText: string): Promise<void>;
  evaluateFindScan(scanText: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  generateBatch(): Promise<void>;
  claimActiveLink(): Promise<void>;
  saveLink(qrId: string, patch: LinkEditorPatch): Promise<void>;
  uploadMedia(qrId: string, files: FileList | File[]): Promise<void>;
  removeMedia(qrId: string, mediaId: string): Promise<void>;
  addProject(): Promise<void>;
  refresh(): Promise<void>;
  selectLifeLink(input: { lifeLinkId: string; source: "human" | "route" | "search" | "scan" }): Promise<void>;
  toggleLifeLinkExpanded(lifeLinkId: string): Promise<void>;
  loadMoreLifeLinks(parentId: string | null): Promise<void>;
  createLifeLink(input: CreateLifeLinkInput): Promise<void>;
  moveLifeLink(lifeLinkId: string, parentId: string | null): Promise<void>;
  detachLifeLink(lifeLinkId: string): Promise<void>;
  attachQrToLifeLink(lifeLinkId: string, scanText: string): Promise<void>;
  searchLifeLinks(query?: string, append?: boolean): Promise<void>;
  openPublicQrInWorkspace(): Promise<void>;
  saveCanonicalLifeLink(
    lifeLinkId: string,
    expectedUpdatedAt: string,
    patch: CanonicalLifeLinkEditorPatch
  ): Promise<void>;
}

export class LifeLinksWorkspaceController implements LifeLinksWorkspaceActions {
  private readonly api: LifeLinksWorkspaceApi;
  private readonly route: WorkspaceBrowserRoute;
  private readonly commandId: () => string;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRoute: (() => void) | null = null;
  private active = false;
  private lifecycle = 0;
  private snapshot: LifeLinksWorkspaceSnapshot;

  constructor(options: LifeLinksWorkspaceControllerOptions = {}) {
    this.api = options.api ?? defaultApi;
    this.route = options.route ?? createWindowWorkspaceRoute();
    this.commandId = options.commandId ?? (() => crypto.randomUUID());
    const routePathname = this.route.pathname();
    const routeQrId = qrIdFromPath(routePathname);
    this.snapshot = {
      currentUser: null,
      qrBaseUrl: DEFAULT_QR_BASE_URL,
      links: [],
      projects: [],
      activeView: routeQrId ? "scan" : "home",
      batchCount: 48,
      lastBatchId: null,
      lastBatchIds: [],
      inventoryOpen: false,
      inventoryFilter: "all",
      inventoryPage: 0,
      activeQrId: routeQrId,
      publicQrState: null,
      editingId: null,
      findTargetId: null,
      query: "",
      guestView: false,
      newProjectName: "",
      scanMessage: {
        tone: "neutral",
        title: "Ready",
        detail: "No scan yet."
      },
      loading: true,
      busy: false,
      error: "",
      theme: initialTheme(),
      routePathname,
      routeQrId,
      routeLifeLinkId: null,
      rootLifeLinks: emptyLifeLinkBranch(),
      lifeLinkChildren: {},
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      expandedLifeLinkIds: [],
      highlightedLifeLinkId: null,
      canonicalEditingId: null,
      lifeLinkSearchQuery: "",
      lifeLinkSearchResults: [],
      lifeLinkSearchTotalCount: 0,
      lifeLinkSearchNextCursor: null,
      lifeLinkSearchTruncated: false,
      lifeLinkSearchLoading: false
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start() {
    if (this.active) {
      return;
    }
    this.active = true;
    const lifecycle = ++this.lifecycle;
    this.unsubscribeRoute = this.route.subscribe(() => {
      void this.handlePopState();
    });
    await this.boot(lifecycle);
  }

  dispose() {
    this.active = false;
    this.lifecycle += 1;
    this.unsubscribeRoute?.();
    this.unsubscribeRoute = null;
  }

  setActiveView(view: WorkspaceView) {
    if (view !== "projects" && this.snapshot.routeLifeLinkId) {
      this.route.push("/");
      this.update({ routePathname: "/", routeQrId: null, routeLifeLinkId: null, activeView: view });
      return;
    }
    this.update({ activeView: view });
  }

  setBatchCount(value: string | number) {
    this.update({ batchCount: normalizeBatchCount(value) });
  }

  toggleInventory() {
    this.update((current) => ({ inventoryOpen: !current.inventoryOpen }));
  }

  setInventoryFilter(filter: InventoryFilter) {
    this.update({ inventoryFilter: filter, inventoryPage: 0 });
  }

  setInventoryPage(page: number) {
    this.update({ inventoryPage: Math.max(0, page) });
  }

  setQuery(query: string) {
    this.update({ query });
  }

  setLifeLinkSearchQuery(lifeLinkSearchQuery: string) {
    this.update({ lifeLinkSearchQuery });
  }

  selectFindTarget(qrId: string) {
    this.update({ findTargetId: qrId, activeQrId: qrId });
  }

  setNewProjectName(newProjectName: string) {
    this.update({ newProjectName });
  }

  toggleGuestView() {
    this.update((current) => ({ guestView: !current.guestView }));
  }

  setTheme(theme: ThemeMode) {
    this.update({ theme });
  }

  openEditor(qrId: string) {
    this.update({ editingId: qrId });
  }

  closeEditor() {
    this.update({ editingId: null });
  }

  async openCanonicalEditor(lifeLinkId: string) {
    if (this.snapshot.selectedLifeLinkId !== lifeLinkId || !this.snapshot.selectedLifeLinkDetail) {
      await this.selectLifeLink({ lifeLinkId, source: "human" });
    }
    this.update({ canonicalEditingId: lifeLinkId });
  }

  closeCanonicalEditor() {
    this.update({ canonicalEditingId: null });
  }

  async refreshOwnerLibrary(user = this.snapshot.currentUser) {
    if (!user) {
      return;
    }
    const [linkResult, projectResult, rootResult] = await Promise.all([
      this.api.listLinks(),
      this.api.listProjects(),
      this.api.listLifeLinks({ limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT })
    ]);
    this.update((current) => ({
      links: linkResult.links,
      projects: projectResult.projects,
      activeQrId: current.activeQrId ?? linkResult.links[0]?.id ?? null,
      inventoryPage: boundedInventoryPage(current.inventoryPage, current.inventoryFilter, linkResult.links),
      rootLifeLinks: branchFromPage(rootResult)
    }));
  }

  async refreshActiveQr(qrId = this.snapshot.activeQrId) {
    if (!qrId) {
      return;
    }
    try {
      const publicQrState = await this.api.getQr(qrId);
      this.update({ publicQrState });
    } catch (qrError) {
      if (qrError instanceof ApiError && qrError.status === 404) {
        this.update({ publicQrState: { state: "not_found", qrId } });
        return;
      }
      throw qrError;
    }
  }

  async selectLifeLink(
    input: { lifeLinkId: string; source: "human" | "route" | "search" | "scan" },
    updateHistory = true
  ) {
    this.update({ busy: true, error: "" });
    try {
      const { detail } = await this.api.getLifeLinkDetail(input.lifeLinkId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT
      });
      const pathname = ownerLifeLinkPath(detail.lifeLink.id);
      this.update((current) => ({
        activeView: "projects",
        activeQrId: detail.lifeLink.qrId,
        publicQrState: null,
        routePathname: pathname,
        routeQrId: null,
        routeLifeLinkId: detail.lifeLink.id,
        selectedLifeLinkId: detail.lifeLink.id,
        selectedLifeLinkDetail: detail,
        highlightedLifeLinkId: detail.lifeLink.id,
        expandedLifeLinkIds: mergeIds(
          current.expandedLifeLinkIds,
          detail.ancestry.items.slice(0, -1).map((item) => item.id)
        ),
        ...mergeDetailIntoHierarchy(current, detail)
      }));
      if (updateHistory && this.route.pathname() !== pathname) {
        this.route.push(pathname);
      }
    } catch (selectError) {
      this.update({ error: messageFromError(selectError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async toggleLifeLinkExpanded(lifeLinkId: string) {
    if (this.snapshot.expandedLifeLinkIds.includes(lifeLinkId)) {
      this.update((current) => ({
        expandedLifeLinkIds: current.expandedLifeLinkIds.filter((id) => id !== lifeLinkId)
      }));
      return;
    }
    this.update((current) => ({ expandedLifeLinkIds: mergeIds(current.expandedLifeLinkIds, [lifeLinkId]) }));
    const branch = this.snapshot.lifeLinkChildren[lifeLinkId];
    if (!branch?.loaded) {
      await this.loadLifeLinkBranch(lifeLinkId, false);
    }
  }

  async loadMoreLifeLinks(parentId: string | null) {
    const branch = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
    await this.loadLifeLinkBranch(parentId, Boolean(branch?.loaded));
  }

  async createLifeLink(input: CreateLifeLinkInput) {
    this.update({ busy: true, error: "" });
    try {
      const normalized: CreateLifeLinkInput = {
        ...input,
        parentId: input.parentId ?? null,
        title: input.title?.trim() || undefined
      };
      const { lifeLink } = await this.api.createLifeLink(normalized);
      await this.loadLifeLinkBranch(lifeLink.parentId, false);
      await this.selectLifeLink({ lifeLinkId: lifeLink.id, source: "human" });
    } catch (createError) {
      this.update({ error: messageFromError(createError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async moveLifeLink(lifeLinkId: string, parentId: string | null) {
    this.update({ busy: true, error: "" });
    try {
      const detail = await this.detailForMutation(lifeLinkId);
      const previousParentId = detail.lifeLink.parentId;
      const { lifeLink } = await this.api.moveLifeLink(lifeLinkId, parentId, detail.lifeLink.updatedAt);
      const searchQuery = this.snapshot.lifeLinkSearchQuery.trim();
      this.update((current) => ({
        selectedLifeLinkDetail:
          current.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId
            ? { ...current.selectedLifeLinkDetail, lifeLink }
            : current.selectedLifeLinkDetail,
        lifeLinkSearchResults: [],
        lifeLinkSearchTotalCount: 0,
        lifeLinkSearchNextCursor: null,
        lifeLinkSearchTruncated: false
      }));
      await this.refreshOwnerLibrary();
      await this.refreshChangedBranches(previousParentId, lifeLink.parentId);
      await this.refreshParentHierarchySummaries([previousParentId, lifeLink.parentId]);
      if (searchQuery) {
        await this.searchLifeLinks(searchQuery);
        if (this.snapshot.error) {
          throw new Error(this.snapshot.error);
        }
      }
      await this.selectLifeLink({ lifeLinkId, source: "human" });
    } catch (moveError) {
      this.update({ error: messageFromError(moveError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async detachLifeLink(lifeLinkId: string) {
    await this.moveLifeLink(lifeLinkId, null);
  }

  async attachQrToLifeLink(lifeLinkId: string, scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({ error: "Enter or scan a valid Life Links QR URL or ID." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.api.attachQr(qrId, lifeLinkId, `attach-${this.commandId()}`);
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "scan" });
      this.update({
        scanMessage: { tone: "success", title: "QR attached", detail: qrId }
      });
    } catch (attachError) {
      this.update({ error: messageFromError(attachError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async searchLifeLinks(query = this.snapshot.lifeLinkSearchQuery, append = false) {
    const normalized = query.trim();
    this.update({ lifeLinkSearchQuery: query, error: "" });
    if (!normalized) {
      this.update({
        lifeLinkSearchResults: [],
        lifeLinkSearchTotalCount: 0,
        lifeLinkSearchNextCursor: null,
        lifeLinkSearchTruncated: false,
        lifeLinkSearchLoading: false
      });
      return;
    }
    this.update({ lifeLinkSearchLoading: true });
    try {
      const result = await this.api.searchLifeLinks(normalized, {
        cursor: append ? this.snapshot.lifeLinkSearchNextCursor : null,
        limit: DEFAULT_LIFE_LINK_SEARCH_LIMIT
      });
      this.update((current) => ({
        lifeLinkSearchResults: append
          ? mergeSearchResults(current.lifeLinkSearchResults, result.results)
          : result.results,
        lifeLinkSearchTotalCount: result.totalCount,
        lifeLinkSearchNextCursor: result.nextCursor,
        lifeLinkSearchTruncated: result.truncated
      }));
    } catch (searchError) {
      this.update({ error: messageFromError(searchError) });
    } finally {
      this.update({ lifeLinkSearchLoading: false });
    }
  }

  async openPublicQrInWorkspace() {
    const { activeQrId, currentUser } = this.snapshot;
    if (!currentUser) {
      this.update({ error: "Log in to open this QR in My Life Links." });
      return;
    }
    if (!activeQrId) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.refreshOwnerLibrary(currentUser);
      const result = await this.api.searchLifeLinks(activeQrId, { limit: 10 });
      const exact = result.results.find((item) => item.lifeLink.qrId === activeQrId);
      if (!exact) {
        this.update({ error: "This QR is not attached to a Life Link in your library." });
        return;
      }
      await this.selectLifeLink({ lifeLinkId: exact.lifeLink.id, source: "scan" });
    } catch (openError) {
      this.update({ error: messageFromError(openError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async login(email: string, password: string) {
    this.update({ busy: true, error: "" });
    try {
      const activeQrId = this.snapshot.activeQrId;
      const result = await this.api.login(email, password);
      const nextRoute = classifyLifeLinksRoute(this.route.pathname(), true);
      this.update({
        currentUser: result.user,
        qrBaseUrl: result.qrBaseUrl,
        routePathname: this.route.pathname(),
        routeQrId: nextRoute.qrId,
        routeLifeLinkId: nextRoute.lifeLinkId
      });
      if (nextRoute.surface === "public-qr") {
        await this.refreshActiveQr(nextRoute.qrId);
      } else {
        await this.refreshOwnerLibrary(result.user);
      }
      if (nextRoute.surface === "owner-workspace" && nextRoute.lifeLinkId) {
        await this.selectLifeLink({ lifeLinkId: nextRoute.lifeLinkId, source: "route" }, false);
      } else if (nextRoute.surface !== "public-qr" && activeQrId) {
        await this.refreshActiveQr(activeQrId);
      }
    } catch (loginError) {
      this.update({ error: messageFromError(loginError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async logout() {
    await this.api.logout().catch(() => undefined);
    const nextRoute = classifyLifeLinksRoute(this.route.pathname(), false);
    this.update({
      currentUser: null,
      links: [],
      projects: [],
      editingId: null,
      canonicalEditingId: null,
      rootLifeLinks: emptyLifeLinkBranch(),
      lifeLinkChildren: {},
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      expandedLifeLinkIds: [],
      highlightedLifeLinkId: null,
      lifeLinkSearchResults: [],
      routePathname: this.route.pathname(),
      routeQrId: nextRoute.qrId,
      routeLifeLinkId: nextRoute.lifeLinkId
    });
  }

  async openQr(qrId: string, updateHistory = true) {
    this.update({
      activeQrId: qrId,
      activeView: "scan",
      routePathname: `/qr/${encodeURIComponent(qrId)}`,
      routeQrId: qrId,
      routeLifeLinkId: null,
      scanMessage: {
        tone: "neutral",
        title: "QR opened",
        detail: qrId
      }
    });
    const pathname = `/qr/${encodeURIComponent(qrId)}`;
    if (updateHistory && this.route.pathname() !== pathname) {
      this.route.push(pathname);
    }
    await this.refreshActiveQr(qrId);
  }

  async scanQr(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Not a Life Links QR",
          detail: scanText.slice(0, 90)
        }
      });
      return;
    }
    await this.openQr(qrId);
  }

  async evaluateFindScan(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Not a Life Links QR",
          detail: scanText.slice(0, 90)
        }
      });
      return;
    }

    const { findTargetId, currentUser } = this.snapshot;
    if (!findTargetId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "Select a search result",
          detail: "Pick the item you want to find, then scan QR codes."
        }
      });
      return;
    }

    const result = currentUser
      ? await this.api.findScan(findTargetId, scanText)
      : { targetQrId: findTargetId, scannedQrId: qrId, match: qrId === findTargetId };
    if (result.match) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(90);
      }
      this.update({ scanMessage: { tone: "success", title: "Match found", detail: qrId } });
      return;
    }
    this.update({ scanMessage: { tone: "neutral", title: "Not the selected item", detail: qrId } });
  }

  async generateBatch() {
    if (!this.snapshot.currentUser) {
      this.update({ error: "Log in to generate QR batches." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.createQrBatch(normalizeBatchCount(this.snapshot.batchCount));
      this.update({
        lastBatchId: result.batch.id,
        lastBatchIds: result.qrCodes.map((link) => link.id),
        inventoryPage: 0
      });
      await this.refreshOwnerLibrary();
      this.update((current) => ({
        activeQrId: result.qrCodes[0]?.id ?? current.activeQrId,
        activeView: "factory"
      }));
    } catch (batchError) {
      this.update({ error: messageFromError(batchError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async claimActiveLink() {
    const { activeQrId, currentUser } = this.snapshot;
    if (!activeQrId) {
      return;
    }
    if (!currentUser) {
      this.update({ error: "Log in with the demo account to claim this QR." });
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      await this.api.claimQr(activeQrId, `claim-${this.commandId()}`);
      const routeState = classifyLifeLinksRoute(this.route.pathname(), true);
      await this.refreshActiveQr(activeQrId);
      if (routeState.surface === "public-qr") {
        // A permanent QR route remains public-facing after claim. Entering the
        // private hierarchy is a separate, visible human action.
      } else {
        await this.refreshOwnerLibrary();
        this.update({ editingId: activeQrId });
      }
      this.update({
        guestView: false,
        scanMessage: { tone: "success", title: "Claimed", detail: activeQrId }
      });
    } catch (claimError) {
      this.update({ error: messageFromError(claimError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async saveLink(qrId: string, patch: LinkEditorPatch) {
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.updateLink(qrId, patch);
      clearLinkEditorDraft(qrId);
      this.update((current) => ({
        links: current.links.map((link) => (link.id === qrId ? result.link : link)),
        editingId: null
      }));
      await this.refreshActiveQr(qrId);
    } catch (saveError) {
      this.update({ error: messageFromError(saveError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async saveCanonicalLifeLink(
    lifeLinkId: string,
    expectedUpdatedAt: string,
    patch: CanonicalLifeLinkEditorPatch
  ) {
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.updateLifeLink(lifeLinkId, expectedUpdatedAt, patch);
      clearCanonicalLifeLinkDraft(lifeLinkId, result.lifeLink.qrId);
      this.update((current) => ({
        selectedLifeLinkDetail:
          current.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId
            ? { ...current.selectedLifeLinkDetail, lifeLink: result.lifeLink }
            : current.selectedLifeLinkDetail,
        canonicalEditingId: null
      }));
      await this.refreshOwnerLibrary();
      await this.loadLifeLinkBranch(result.lifeLink.parentId, false);
      await this.selectLifeLink({ lifeLinkId, source: "human" }, false);
    } catch (saveError) {
      this.update({ error: messageFromError(saveError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async uploadCanonicalMedia(lifeLinkId: string, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      for (const file of files) {
        await this.api.uploadLifeLinkMedia(lifeLinkId, file);
      }
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "human" }, false);
    } catch (uploadError) {
      this.update({ error: messageFromError(uploadError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async removeCanonicalMedia(lifeLinkId: string, mediaId: string) {
    this.update({ busy: true, error: "" });
    try {
      await this.api.deleteLifeLinkMedia(lifeLinkId, mediaId);
      await this.refreshOwnerLibrary();
      await this.selectLifeLink({ lifeLinkId, source: "human" }, false);
    } catch (deleteError) {
      this.update({ error: messageFromError(deleteError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async uploadMedia(qrId: string, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      for (const file of files) {
        await this.api.uploadLinkMedia(qrId, file);
      }
      await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr(qrId)]);
    } catch (uploadError) {
      this.update({ error: messageFromError(uploadError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async removeMedia(qrId: string, mediaId: string) {
    this.update({ busy: true, error: "" });
    try {
      await this.api.deleteLinkMedia(qrId, mediaId);
      await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr(qrId)]);
    } catch (deleteError) {
      this.update({ error: messageFromError(deleteError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async addProject() {
    const name = this.snapshot.newProjectName.trim();
    if (!name) {
      return;
    }
    this.update({ busy: true, error: "" });
    try {
      const result = await this.api.createProject(name);
      this.update((current) => ({
        projects: [...current.projects, result.project].sort((a, b) => a.name.localeCompare(b.name)),
        newProjectName: ""
      }));
    } catch (projectError) {
      this.update({ error: messageFromError(projectError) });
    } finally {
      this.update({ busy: false });
    }
  }

  async refresh() {
    this.update({ error: "" });
    await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr()]);
    if (this.snapshot.selectedLifeLinkId) {
      await this.selectLifeLink({ lifeLinkId: this.snapshot.selectedLifeLinkId, source: "human" }, false);
    }
  }

  async downloadSelectedQr(format: "svg" | "png") {
    const activeLink = resolveActiveLink(this.snapshot);
    if (!activeLink) {
      return;
    }
    if (format === "svg") {
      const svg = await QRCode.toString(activeLink.url, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8
      });
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${activeLink.id}.svg`);
      return;
    }
    const dataUrl = await QRCode.toDataURL(activeLink.url, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 10
    });
    downloadBlob(dataUrlToBlob(dataUrl), `${activeLink.id}.png`);
  }

  downloadCsv(ids?: string[]) {
    const scoped = ids?.length
      ? ids.map((id) => this.snapshot.links.find((link) => link.id === id)).filter(Boolean)
      : this.snapshot.links;
    downloadBlob(new Blob([linksToCsv(scoped as LinkRecord[])], { type: "text/csv" }), "life-links-qr-map.csv");
  }

  downloadZip() {
    if (!this.snapshot.lastBatchId) {
      this.update({
        scanMessage: {
          tone: "warning",
          title: "No hosted batch yet",
          detail: "Generate a batch first, then download the ZIP."
        }
      });
      return;
    }
    window.location.href = `/api/qr-batches/${encodeURIComponent(this.snapshot.lastBatchId)}.zip`;
  }

  private async boot(lifecycle: number) {
    try {
      const [config, me] = await Promise.all([this.api.getConfig(), this.api.getMe()]);
      if (!this.isCurrent(lifecycle)) {
        return;
      }
      const routePathname = this.route.pathname();
      const routeState = classifyLifeLinksRoute(routePathname, Boolean(me.user));
      this.update({
        qrBaseUrl: me.qrBaseUrl || config.qrBaseUrl,
        currentUser: me.user,
        routePathname,
        routeQrId: routeState.qrId,
        routeLifeLinkId: routeState.lifeLinkId
      });

      if (me.user && routeState.surface !== "public-qr") {
        await this.refreshOwnerLibrary(me.user);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
      }
      if (routeState.surface === "public-qr") {
        const publicQrState = await readQrState(this.api, routeState.qrId);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
        this.update({
          activeQrId: routeState.qrId,
          activeView: "scan",
          publicQrState,
          scanMessage: { tone: "neutral", title: "QR opened", detail: routeState.qrId }
        });
      } else if (routeState.surface === "owner-workspace" && routeState.lifeLinkId) {
        await this.selectLifeLink({ lifeLinkId: routeState.lifeLinkId, source: "route" }, false);
      }
    } catch (bootError) {
      if (this.isCurrent(lifecycle)) {
        this.update({ error: messageFromError(bootError) });
      }
    } finally {
      if (this.isCurrent(lifecycle)) {
        this.update({ loading: false });
      }
    }
  }

  private async handlePopState() {
    const routePathname = this.route.pathname();
    const routeState = classifyLifeLinksRoute(routePathname, Boolean(this.snapshot.currentUser));
    this.update({
      routePathname,
      routeQrId: routeState.qrId,
      routeLifeLinkId: routeState.lifeLinkId
    });
    if (routeState.surface === "public-qr") {
      await this.openQr(routeState.qrId, false);
      return;
    }
    if (routeState.surface === "owner-workspace" && routeState.lifeLinkId) {
      await this.selectLifeLink({ lifeLinkId: routeState.lifeLinkId, source: "route" }, false);
      return;
    }
    this.update({
      publicQrState: null,
      selectedLifeLinkId: null,
      selectedLifeLinkDetail: null,
      highlightedLifeLinkId: null,
      activeView: "home"
    });
  }

  private async loadLifeLinkBranch(parentId: string | null, append: boolean, propagateError = false) {
    const currentBranch = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
    if (append && !currentBranch?.nextCursor) {
      return;
    }
    this.setBranch(parentId, {
      ...(currentBranch ?? emptyLifeLinkBranch()),
      loading: true
    });
    try {
      const result = await this.api.listLifeLinks({
        parentId,
        cursor: append ? currentBranch?.nextCursor : null,
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT
      });
      const latest = parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks;
      const preserveKnownPath = !append && !currentBranch?.loaded && Boolean(currentBranch?.items.length);
      const nextBranch = branchFromPage(result, append ? latest : undefined);
      this.setBranch(parentId, preserveKnownPath
        ? { ...nextBranch, items: mergeSummaries(nextBranch.items, latest.items) }
        : nextBranch);
    } catch (branchError) {
      this.setBranch(parentId, {
        ...(parentId ? this.snapshot.lifeLinkChildren[parentId] : this.snapshot.rootLifeLinks),
        loading: false
      });
      this.update({ error: messageFromError(branchError) });
      if (propagateError) {
        throw branchError;
      }
    }
  }

  private setBranch(parentId: string | null, branch: LifeLinkBranchState) {
    if (parentId === null) {
      this.update({ rootLifeLinks: branch });
      return;
    }
    this.update((current) => ({
      lifeLinkChildren: { ...current.lifeLinkChildren, [parentId]: branch }
    }));
  }

  private async detailForMutation(lifeLinkId: string): Promise<LifeLinkDetail> {
    if (this.snapshot.selectedLifeLinkDetail?.lifeLink.id === lifeLinkId) {
      return this.snapshot.selectedLifeLinkDetail;
    }
    return (await this.api.getLifeLinkDetail(lifeLinkId, { limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT })).detail;
  }

  private async refreshChangedBranches(previousParentId: string | null, nextParentId: string | null) {
    const parents = Array.from(new Set([previousParentId, nextParentId]));
    for (const parentId of parents) {
      await this.loadLifeLinkBranch(parentId, false, true);
    }
  }

  private async refreshParentHierarchySummaries(parentIds: Array<string | null>) {
    for (const parentId of Array.from(new Set(parentIds)).filter((id): id is string => Boolean(id))) {
      const { detail } = await this.api.getLifeLinkDetail(parentId, {
        limit: DEFAULT_LIFE_LINK_CHILD_PAGE_LIMIT
      });
      this.update((current) => mergeDetailIntoHierarchy(current, detail));
    }
  }

  private isCurrent(lifecycle: number) {
    return this.active && this.lifecycle === lifecycle;
  }

  private update(
    patch:
      | Partial<LifeLinksWorkspaceSnapshot>
      | ((current: LifeLinksWorkspaceSnapshot) => Partial<LifeLinksWorkspaceSnapshot>)
  ) {
    const next = typeof patch === "function" ? patch(this.snapshot) : patch;
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function emptyLifeLinkBranch(): LifeLinkBranchState {
  return { items: [], nextCursor: null, truncated: false, loaded: false, loading: false };
}

function branchFromPage(
  page: { lifeLinks: LifeLinkSummary[]; nextCursor: string | null; truncated: boolean },
  current?: LifeLinkBranchState
): LifeLinkBranchState {
  return {
    items: current ? mergeSummaries(current.items, page.lifeLinks) : page.lifeLinks,
    nextCursor: page.nextCursor,
    truncated: page.truncated,
    loaded: true,
    loading: false
  };
}

function mergeDetailIntoHierarchy(
  current: LifeLinksWorkspaceSnapshot,
  detail: LifeLinkDetail
): Pick<LifeLinksWorkspaceSnapshot, "rootLifeLinks" | "lifeLinkChildren"> {
  const ancestry = detail.ancestry.items;
  let rootLifeLinks = current.rootLifeLinks;
  const lifeLinkChildren = { ...current.lifeLinkChildren };
  const first = ancestry[0];
  if (first?.parentId === null) {
    rootLifeLinks = {
      ...rootLifeLinks,
      items: mergeSummaries(rootLifeLinks.items, [first])
    };
  }
  for (let index = 1; index < ancestry.length; index += 1) {
    const parent = ancestry[index - 1];
    const child = ancestry[index];
    if (child.parentId !== parent.id) {
      continue;
    }
    const existing = lifeLinkChildren[parent.id] ?? emptyLifeLinkBranch();
    lifeLinkChildren[parent.id] = {
      ...existing,
      items: mergeSummaries(existing.items, [child])
    };
  }
  lifeLinkChildren[detail.lifeLink.id] = {
    items: detail.children,
    nextCursor: detail.childrenPage.nextCursor,
    truncated: detail.childrenPage.truncated,
    loaded: true,
    loading: false
  };
  return { rootLifeLinks, lifeLinkChildren };
}

function mergeSummaries(current: LifeLinkSummary[], additions: LifeLinkSummary[]): LifeLinkSummary[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of additions) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function mergeSearchResults(current: LifeLinkSearchItem[], additions: LifeLinkSearchItem[]) {
  const byId = new Map(current.map((item) => [item.lifeLink.id, item]));
  for (const item of additions) {
    byId.set(item.lifeLink.id, item);
  }
  return Array.from(byId.values());
}

function mergeIds(current: string[], additions: string[]) {
  return Array.from(new Set([...current, ...additions]));
}

function resolveActiveLink(snapshot: LifeLinksWorkspaceSnapshot): LinkRecord | null {
  const ownedOrInventory = snapshot.activeQrId
    ? snapshot.links.find((link) => link.id === snapshot.activeQrId) ?? null
    : null;
  if (ownedOrInventory) {
    return ownedOrInventory;
  }
  if (snapshot.publicQrState?.state === "claimed") {
    return snapshot.publicQrState.link;
  }
  if (snapshot.publicQrState?.state === "unclaimed") {
    return snapshot.publicQrState.qr;
  }
  return null;
}

function boundedInventoryPage(page: number, filter: InventoryFilter, links: LinkRecord[]) {
  const filtered = links.filter((link) => {
    if (filter === "claimed") {
      return link.status === "claimed";
    }
    if (filter === "unclaimed") {
      return link.status === "unclaimed";
    }
    return true;
  });
  return Math.min(page, Math.max(0, Math.ceil(filtered.length / 24) - 1));
}

async function readQrState(api: LifeLinksWorkspaceApi, qrId: string): Promise<QrViewState> {
  try {
    return await api.getQr(qrId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { state: "not_found", qrId };
    }
    throw error;
  }
}

function initialTheme(): ThemeMode {
  try {
    return window.localStorage.getItem("life-links-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, encoded] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_credentials") {
      return "Invalid demo login.";
    }
    if (error.code === "auth_required") {
      return "Log in to continue.";
    }
    if (error.code === "owned_by_other") {
      return "That QR code is already claimed by another account.";
    }
    if (error.code === "media_file_too_large") {
      return "Media files must be 25 MB or smaller.";
    }
    if (error.code === "media_type_not_allowed") {
      return "Use an image or video file type supported by the demo.";
    }
    if (error.code === "media_limit_reached") {
      return "This link already has the maximum number of media attachments.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
