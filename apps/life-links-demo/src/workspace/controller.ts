import QRCode from "qrcode";
import {
  DEFAULT_QR_BASE_URL,
  linksToCsv,
  normalizeBatchCount,
  parseQrId,
  type LinkRecord,
  type QrViewState
} from "@life-links/core";

import {
  ApiError,
  claimQr,
  createProject,
  createQrBatch,
  deleteLinkMedia,
  findScan,
  getConfig,
  getMe,
  getQr,
  listLinks,
  listProjects,
  login,
  logout,
  updateLink,
  uploadLinkMedia
} from "../api";
import { clearLinkEditorDraft } from "./editorSession";
import { createWindowWorkspaceRoute, qrIdFromPath, type WorkspaceBrowserRoute } from "./routes";
import type {
  InventoryFilter,
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
  findScan
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
    const routeQrId = qrIdFromPath(this.route.pathname());
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
      routeQrId
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

  async refreshOwnerLibrary(user = this.snapshot.currentUser) {
    if (!user) {
      return;
    }
    const [linkResult, projectResult] = await Promise.all([this.api.listLinks(), this.api.listProjects()]);
    this.update((current) => ({
      links: linkResult.links,
      projects: projectResult.projects,
      activeQrId: current.activeQrId ?? linkResult.links[0]?.id ?? null,
      inventoryPage: boundedInventoryPage(current.inventoryPage, current.inventoryFilter, linkResult.links)
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

  async login(email: string, password: string) {
    this.update({ busy: true, error: "" });
    try {
      const activeQrId = this.snapshot.activeQrId;
      const result = await this.api.login(email, password);
      this.update({ currentUser: result.user, qrBaseUrl: result.qrBaseUrl });
      await this.refreshOwnerLibrary(result.user);
      if (activeQrId) {
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
    this.update({ currentUser: null, links: [], projects: [], editingId: null });
  }

  async openQr(qrId: string, updateHistory = true) {
    this.update({
      activeQrId: qrId,
      activeView: "scan",
      routeQrId: qrId,
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
      await Promise.all([this.refreshOwnerLibrary(), this.refreshActiveQr(activeQrId)]);
      this.update({
        editingId: activeQrId,
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
      this.update({ qrBaseUrl: me.qrBaseUrl || config.qrBaseUrl, currentUser: me.user });

      if (me.user) {
        const [linkResult, projectResult] = await Promise.all([this.api.listLinks(), this.api.listProjects()]);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
        this.update((current) => ({
          links: linkResult.links,
          projects: projectResult.projects,
          activeQrId: current.activeQrId ?? linkResult.links[0]?.id ?? null
        }));
      }

      const routeQrId = qrIdFromPath(this.route.pathname());
      if (routeQrId) {
        const publicQrState = await readQrState(this.api, routeQrId);
        if (!this.isCurrent(lifecycle)) {
          return;
        }
        this.update({
          activeQrId: routeQrId,
          activeView: "scan",
          routeQrId,
          publicQrState,
          scanMessage: { tone: "neutral", title: "QR opened", detail: routeQrId }
        });
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
    const routeQrId = qrIdFromPath(this.route.pathname());
    if (!routeQrId) {
      this.update({ routeQrId: null, publicQrState: null, activeView: "home" });
      return;
    }
    await this.openQr(routeQrId, false);
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
    return error.code;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
