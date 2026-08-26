import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Archive,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  CircleAlert,
  Download,
  FileDown,
  FolderOpen,
  Globe2,
  Home,
  Image,
  Layers,
  Lock,
  LogIn,
  LogOut,
  Moon,
  Pencil,
  Plus,
  QrCode,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Video,
  X
} from "lucide-react";
import {
  DEFAULT_QR_BASE_URL,
  MAX_PROJECT_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  createLinkBodyDocFromPlainText,
  type LinkRecord,
  type PrivacyStatus,
  type ProjectRecord,
  type QrViewState,
  buildQrUrl,
  linksToCsv,
  normalizeBatchCount,
  parseQrId,
  searchOwnedLinks
} from "@life-links/core";
import {
  ApiError,
  type ApiUser,
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
  uploadLinkMedia,
  updateLink
} from "./api";
import { RichBodyRenderer } from "./richBody";

const RichBodyEditor = lazy(() => import("./richBodyEditor").then((module) => ({ default: module.RichBodyEditor })));

type Html5QrcodeScanner = InstanceType<typeof import("html5-qrcode").Html5Qrcode>;

type View = "home" | "factory" | "scan" | "projects" | "search";
type CameraMode = "open" | "find";
type ScanTone = "neutral" | "success" | "warning";
type ThemeMode = "light" | "dark";
type InventoryFilter = "all" | "claimed" | "unclaimed";

type ScanMessage = {
  tone: ScanTone;
  title: string;
  detail: string;
};

const THEME_STORAGE_KEY = "life-links-theme";
const LINK_EDITOR_DRAFT_STORAGE_PREFIX = "life-links-link-editor-draft-v1";
const INVENTORY_PAGE_SIZE = 24;

function initialQrIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/qr\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function initialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [qrBaseUrl, setQrBaseUrl] = useState(DEFAULT_QR_BASE_URL);
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeView, setActiveView] = useState<View>(initialQrIdFromPath() ? "scan" : "home");
  const [batchCount, setBatchCount] = useState(48);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const [lastBatchIds, setLastBatchIds] = useState<string[]>([]);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");
  const [inventoryPage, setInventoryPage] = useState(0);
  const [activeQrId, setActiveQrId] = useState<string | null>(initialQrIdFromPath());
  const [publicQrState, setPublicQrState] = useState<QrViewState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [findTargetId, setFindTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [guestView, setGuestView] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [scanMessage, setScanMessage] = useState<ScanMessage>({
    tone: "neutral",
    title: "Ready",
    detail: "No scan yet."
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const routeQrId = useMemo(() => initialQrIdFromPath(), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is cosmetic; keep rendering even when storage is blocked.
    }
  }, [theme]);

  useEffect(() => {
    let alive = true;
    async function boot() {
      try {
        const [config, me] = await Promise.all([getConfig(), getMe()]);
        if (!alive) {
          return;
        }
        setQrBaseUrl(me.qrBaseUrl || config.qrBaseUrl);
        setCurrentUser(me.user);
        if (me.user) {
          await refreshOwnerData(me.user);
        }
        if (routeQrId) {
          await openQr(routeQrId, false);
        }
      } catch (bootError) {
        if (alive) {
          setError(messageFromError(bootError));
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }
    void boot();
    return () => {
      alive = false;
    };
  }, [routeQrId]);

  const ownedLinks = useMemo(
    () => (currentUser ? links.filter((link) => link.ownerId === currentUser.id) : []),
    [currentUser, links]
  );
  const unclaimedLinks = useMemo(() => links.filter((link) => link.status === "unclaimed"), [links]);
  const activeLink = useMemo(() => {
    const ownedOrInventory = activeQrId ? links.find((link) => link.id === activeQrId) ?? null : null;
    if (ownedOrInventory) {
      return ownedOrInventory;
    }
    if (publicQrState?.state === "claimed") {
      return publicQrState.link;
    }
    if (publicQrState?.state === "unclaimed") {
      return publicQrState.qr;
    }
    return null;
  }, [activeQrId, links, publicQrState]);
  const privateQrId = publicQrState?.state === "private" ? publicQrState.qrId : null;
  const notFoundQrId = publicQrState?.state === "not_found" ? publicQrState.qrId : null;
  const recentLinks = useMemo(
    () => [...ownedLinks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [ownedLinks]
  );
  const searchResults = useMemo(
    () => (currentUser ? searchOwnedLinks(links, currentUser.id, query, projects) : []),
    [query, currentUser, links, projects]
  );
  const latestBatchLinks = useMemo(
    () =>
      lastBatchIds
        .map((id) => links.find((link) => link.id === id))
        .filter((link): link is LinkRecord => Boolean(link)),
    [lastBatchIds, links]
  );
  const previewLinks = useMemo(
    () => (latestBatchLinks.length ? latestBatchLinks : links).slice(0, 12),
    [latestBatchLinks, links]
  );
  const inventoryLinks = useMemo(() => {
    if (inventoryFilter === "claimed") {
      return links.filter((link) => link.status === "claimed");
    }
    if (inventoryFilter === "unclaimed") {
      return links.filter((link) => link.status === "unclaimed");
    }
    return links;
  }, [inventoryFilter, links]);
  const inventoryPageCount = Math.max(1, Math.ceil(inventoryLinks.length / INVENTORY_PAGE_SIZE));
  const boundedInventoryPage = Math.min(inventoryPage, inventoryPageCount - 1);
  const inventoryPageLinks = inventoryLinks.slice(
    boundedInventoryPage * INVENTORY_PAGE_SIZE,
    boundedInventoryPage * INVENTORY_PAGE_SIZE + INVENTORY_PAGE_SIZE
  );
  const previewSourceLabel = latestBatchLinks.length ? "latest batch" : "inventory";
  const nextTheme = theme === "light" ? "dark" : "light";

  useEffect(() => {
    setInventoryPage(0);
  }, [inventoryFilter]);

  useEffect(() => {
    if (inventoryPage > inventoryPageCount - 1) {
      setInventoryPage(Math.max(0, inventoryPageCount - 1));
    }
  }, [inventoryPage, inventoryPageCount]);

  async function refreshOwnerData(user = currentUser) {
    if (!user) {
      return;
    }
    const [linkResult, projectResult] = await Promise.all([listLinks(), listProjects()]);
    setLinks(linkResult.links);
    setProjects(projectResult.projects);
    setActiveQrId((current) => current ?? linkResult.links[0]?.id ?? null);
  }

  async function refreshActiveQr(qrId = activeQrId) {
    if (!qrId) {
      return;
    }
    try {
      setPublicQrState(await getQr(qrId));
    } catch (qrError) {
      if (qrError instanceof ApiError && qrError.status === 404) {
        setPublicQrState({ state: "not_found", qrId });
        return;
      }
      throw qrError;
    }
  }

  async function handleLogin(email: string, password: string) {
    setBusy(true);
    setError("");
    try {
      const result = await login(email, password);
      setCurrentUser(result.user);
      setQrBaseUrl(result.qrBaseUrl);
      await refreshOwnerData(result.user);
      if (activeQrId) {
        await refreshActiveQr(activeQrId);
      }
    } catch (loginError) {
      setError(messageFromError(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    setCurrentUser(null);
    setLinks([]);
    setProjects([]);
    setEditingId(null);
  }

  async function openQr(qrId: string, updateHistory = true) {
    setActiveQrId(qrId);
    setActiveView("scan");
    setScanMessage({
      tone: "neutral",
      title: "QR opened",
      detail: qrId
    });
    if (updateHistory && window.location.pathname !== `/qr/${encodeURIComponent(qrId)}`) {
      window.history.pushState({}, "", `/qr/${encodeURIComponent(qrId)}`);
    }
    await refreshActiveQr(qrId);
  }

  async function handleOpenScan(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      setScanMessage({
        tone: "warning",
        title: "Not a Life Links QR",
        detail: scanText.slice(0, 90)
      });
      return;
    }

    await openQr(qrId);
  }

  async function handleFindScan(scanText: string) {
    const qrId = parseQrId(scanText);
    if (!qrId) {
      setScanMessage({
        tone: "warning",
        title: "Not a Life Links QR",
        detail: scanText.slice(0, 90)
      });
      return;
    }

    if (!findTargetId) {
      setScanMessage({
        tone: "warning",
        title: "Select a search result",
        detail: "Pick the item you want to find, then scan QR codes."
      });
      return;
    }

    const result = currentUser
      ? await findScan(findTargetId, scanText)
      : { targetQrId: findTargetId, scannedQrId: qrId, match: qrId === findTargetId };
    if (result.match) {
      if ("vibrate" in navigator) {
        navigator.vibrate?.(90);
      }
      setScanMessage({
        tone: "success",
        title: "Match found",
        detail: qrId
      });
      return;
    }

    setScanMessage({
      tone: "neutral",
      title: "Not the selected item",
      detail: qrId
    });
  }

  async function generateBatch() {
    if (!currentUser) {
      setError("Log in to generate QR batches.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createQrBatch(normalizeBatchCount(batchCount));
      setLastBatchId(result.batch.id);
      setLastBatchIds(result.qrCodes.map((link) => link.id));
      setInventoryPage(0);
      await refreshOwnerData();
      setActiveQrId(result.qrCodes[0]?.id ?? activeQrId);
      setActiveView("factory");
    } catch (batchError) {
      setError(messageFromError(batchError));
    } finally {
      setBusy(false);
    }
  }

  async function claimActiveLink() {
    if (!activeQrId) {
      return;
    }
    if (!currentUser) {
      setError("Log in with the demo account to claim this QR.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await claimQr(activeQrId, `claim-${crypto.randomUUID()}`);
      await Promise.all([refreshOwnerData(), refreshActiveQr(activeQrId)]);
      setEditingId(activeQrId);
      setGuestView(false);
      setScanMessage({
        tone: "success",
        title: "Claimed",
        detail: activeQrId
      });
    } catch (claimError) {
      setError(messageFromError(claimError));
    } finally {
      setBusy(false);
    }
  }

  async function saveLink(qrId: string, patch: Pick<LinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId">) {
    setBusy(true);
    setError("");
    try {
      const result = await updateLink(qrId, patch);
      clearLinkEditorDraft(qrId);
      setLinks((current) => current.map((link) => (link.id === qrId ? result.link : link)));
      setEditingId(null);
      await refreshActiveQr(qrId);
    } catch (saveError) {
      setError(messageFromError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(qrId: string, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        await uploadLinkMedia(qrId, file);
      }
      await Promise.all([refreshOwnerData(), refreshActiveQr(qrId)]);
    } catch (uploadError) {
      setError(messageFromError(uploadError));
    } finally {
      setBusy(false);
    }
  }

  async function removeMedia(qrId: string, mediaId: string) {
    setBusy(true);
    setError("");
    try {
      await deleteLinkMedia(qrId, mediaId);
      await Promise.all([refreshOwnerData(), refreshActiveQr(qrId)]);
    } catch (deleteError) {
      setError(messageFromError(deleteError));
    } finally {
      setBusy(false);
    }
  }

  async function addProject() {
    const name = newProjectName.trim();
    if (!name) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await createProject(name);
      setProjects((current) => [...current, result.project].sort((a, b) => a.name.localeCompare(b.name)));
      setNewProjectName("");
    } catch (projectError) {
      setError(messageFromError(projectError));
    } finally {
      setBusy(false);
    }
  }

  async function refreshDemo() {
    setError("");
    await Promise.all([refreshOwnerData(), refreshActiveQr()]);
  }

  async function downloadSelectedQr(format: "svg" | "png") {
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
    const blob = await (await fetch(dataUrl)).blob();
    downloadBlob(blob, `${activeLink.id}.png`);
  }

  function downloadCsv(ids?: string[]) {
    const scoped = ids?.length
      ? ids.map((id) => links.find((link) => link.id === id)).filter(Boolean)
      : links;
    downloadBlob(new Blob([linksToCsv(scoped as LinkRecord[])], { type: "text/csv" }), "life-links-qr-map.csv");
  }

  function downloadZip() {
    if (!lastBatchId) {
      setScanMessage({
        tone: "warning",
        title: "No hosted batch yet",
        detail: "Generate a batch first, then download the ZIP."
      });
      return;
    }
    window.location.href = `/api/qr-batches/${encodeURIComponent(lastBatchId)}.zip`;
  }

  const navItems: Array<{ view: View; label: string; icon: typeof Archive }> = [
    { view: "home", label: "Home", icon: Home },
    { view: "scan", label: "Scan", icon: Camera },
    { view: "projects", label: "Projects", icon: FolderOpen },
    { view: "search", label: "Search", icon: Search },
    { view: "factory", label: "Factory", icon: QrCode }
  ];

  if (loading) {
    return <div className="loading-shell">Loading Life Links...</div>;
  }

  if (!currentUser && routeQrId) {
    return (
      <PublicQrShell
        link={activeLink}
        privateQrId={privateQrId}
        notFoundQrId={notFoundQrId}
        projects={projects}
        error={error}
        busy={busy}
        onClaim={claimActiveLink}
        onLogin={handleLogin}
      />
    );
  }

  if (!currentUser) {
    return <LoginScreen error={error} busy={busy} onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Life Links navigation">
        <div className="brand-block">
          <div className="brand-mark">LL</div>
          <div>
            <h1>Life Links</h1>
            <p>{currentUser.displayName}</p>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                className={activeView === item.view ? "nav-button active" : "nav-button"}
                onClick={() => setActiveView(item.view)}
                data-tooltip={`Open the ${item.label} view.`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <Tooltip text={`Open the ${item.label} view.`} />
              </button>
            );
          })}
        </nav>
        <div className="sidebar-stats">
          <Stat label="Owned" value={ownedLinks.length.toLocaleString()} />
          <Stat label="Unclaimed" value={unclaimedLinks.length.toLocaleString()} />
          <Stat label="Projects" value={projects.length.toLocaleString()} />
        </div>
        <div className="sidebar-actions">
          <button className="ghost-button full-width" onClick={refreshDemo} data-tooltip="Refresh links, projects, and the selected QR from the server.">
            <RefreshCcw size={16} />
            <span>Refresh</span>
            <Tooltip text="Refresh links, projects, and the selected QR from the server." />
          </button>
          <button className="ghost-button full-width" onClick={handleLogout} data-tooltip="Sign out of this demo account.">
            <LogOut size={16} />
            <span>Logout</span>
            <Tooltip text="Sign out of this demo account." />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">QR object notes</p>
            <h2>{viewTitle(activeView)}</h2>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button mobile-refresh-action"
              onClick={refreshDemo}
              disabled={busy}
              data-tooltip="Refresh links, projects, and the selected QR from the server."
            >
              <RefreshCcw size={18} />
              <span>Refresh</span>
              <Tooltip text="Refresh links, projects, and the selected QR from the server." />
            </button>
            <button
              className="icon-button theme-toggle desktop-action"
              onClick={() => setTheme(nextTheme)}
              data-tooltip={`Switch to ${nextTheme} mode.`}
              aria-label={`Switch to ${nextTheme} mode`}
              aria-pressed={theme === "dark"}
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
              <Tooltip text={`Switch to ${nextTheme} mode.`} />
            </button>
            <span className="user-chip desktop-action">{currentUser.email}</span>
            <button
              className="icon-button desktop-action"
              onClick={() => downloadCsv()}
              data-tooltip="Download a CSV mapping for all loaded QR codes."
              aria-label="Download visible QR mappings"
            >
              <FileDown size={18} />
              <Tooltip text="Download a CSV mapping for all loaded QR codes." />
            </button>
            <button className="primary-button desktop-action" onClick={generateBatch} disabled={busy} data-tooltip="Generate a new batch of unclaimed QR codes.">
              <Plus size={18} />
              <span>Batch</span>
              <Tooltip text="Generate a new batch of unclaimed QR codes." />
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {activeView === "home" && (
          <section className="home-stack">
            <div className="home-stats" aria-label="Life Links summary">
              <Stat label="Owned" value={ownedLinks.length.toLocaleString()} />
              <Stat label="Unclaimed" value={unclaimedLinks.length.toLocaleString()} />
              <Stat label="Projects" value={projects.length.toLocaleString()} />
            </div>

            <div className="panel quick-actions-panel">
              <PanelTitle icon={QrCode} title="Quick Actions" />
              <div className="quick-actions-grid">
                <button className="primary-button" onClick={() => setActiveView("scan")} data-tooltip="Open QR scanner and claim flow.">
                  <Camera size={18} />
                  <span>Scan QR</span>
                  <Tooltip text="Open QR scanner and claim flow." />
                </button>
                <button className="secondary-button" onClick={() => setActiveView("projects")} data-tooltip="Open project groups.">
                  <FolderOpen size={18} />
                  <span>Projects</span>
                  <Tooltip text="Open project groups." />
                </button>
                <button className="secondary-button" onClick={() => setActiveView("search")} data-tooltip="Open search and find mode.">
                  <Search size={18} />
                  <span>Find Mode</span>
                  <Tooltip text="Open search and find mode." />
                </button>
                <button className="secondary-button" onClick={() => setActiveView("factory")} data-tooltip="Generate QR batches.">
                  <QrCode size={18} />
                  <span>QR Factory</span>
                  <Tooltip text="Generate QR batches." />
                </button>
              </div>
            </div>

            <div className="home-main-grid">
              <div className="recent-section">
              <PanelTitle icon={Archive} title="Recent Links" />
              <div className="link-list">
                {recentLinks.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    project={projects.find((project) => project.id === link.projectId)}
                    active={link.id === activeQrId}
                    onOpen={() => void openQr(link.id)}
                  />
                ))}
              </div>
              </div>
              <div className="panel active-qr-panel">
                <PanelTitle icon={QrCode} title="Active QR" />
                <QrDetail
                  link={activeLink}
                  privateQrId={privateQrId}
                  notFoundQrId={notFoundQrId}
                  projects={projects}
                  guestView={guestView}
                  canEdit={Boolean(currentUser)}
                  onGuestToggle={() => setGuestView((value) => !value)}
                  onClaim={claimActiveLink}
                  onEdit={(id) => setEditingId(id)}
                  onDownloadSvg={() => downloadSelectedQr("svg")}
                  onDownloadPng={() => downloadSelectedQr("png")}
                />
              </div>
            </div>

            <button className="ghost-button mobile-signout-action" onClick={handleLogout} data-tooltip="Sign out of this demo account.">
              <LogOut size={18} />
              <span>Sign Out {currentUser.email}</span>
              <Tooltip text="Sign out of this demo account." />
            </button>
          </section>
        )}

        {activeView === "factory" && (
          <section className="grid factory-grid">
            <div className="panel">
              <PanelTitle icon={QrCode} title="QR Factory" />
              <div className="factory-controls">
                <label>
                  <span>Count</span>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={batchCount}
                    onChange={(event) => setBatchCount(normalizeBatchCount(event.target.value))}
                  />
                </label>
                <label>
                  <span>Domain</span>
                  <input value={qrBaseUrl} readOnly />
                </label>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={generateBatch} disabled={busy} data-tooltip="Create the requested number of unclaimed QR codes.">
                  <Plus size={18} />
                  <span>Generate</span>
                  <Tooltip text="Create the requested number of unclaimed QR codes." />
                </button>
                <button
                  className="secondary-button"
                  onClick={() => downloadCsv(lastBatchIds)}
                  data-tooltip="Download a QR ID to URL CSV for the latest batch; before generating, this uses all loaded inventory."
                >
                  <FileDown size={18} />
                  <span>CSV</span>
                  <Tooltip text="Download a QR ID to URL CSV for the latest batch; before generating, this uses all loaded inventory." />
                </button>
                <button
                  className="secondary-button"
                  onClick={downloadZip}
                  disabled={busy || !lastBatchId}
                  data-tooltip="Generate a batch first, then download a ZIP with SVG QR files and a mapping CSV."
                >
                  <Download size={18} />
                  <span>ZIP</span>
                  <Tooltip text="Generate a batch first, then download a ZIP with SVG QR files and a mapping CSV." />
                </button>
              </div>
              <div className="batch-strip">
                <Stat label="Last batch" value={lastBatchIds.length.toLocaleString()} />
                <Stat label="Inventory" value={links.length.toLocaleString()} />
                <Stat label="URL" value="/qr/{id}" />
              </div>
            </div>
            <div className="panel qr-preview-panel">
              <PanelTitle
                icon={QrCode}
                title={latestBatchLinks.length ? "Latest Batch Preview" : "Inventory Preview"}
              />
              <p className="panel-help">
                Showing up to 12 QR codes from the {previewSourceLabel}. Use CSV or ZIP for the generated batch,
                or open inventory to browse everything in the account.
              </p>
              <div className="qr-grid">
                {previewLinks.map((link) => (
                  <QrTile
                    key={link.id}
                    link={link}
                    active={activeQrId === link.id}
                    onOpen={() => void openQr(link.id)}
                  />
                ))}
              </div>
              <div className="preview-actions">
                <span>
                  Showing {previewLinks.length.toLocaleString()} of{" "}
                  {(latestBatchLinks.length || links.length).toLocaleString()} QR codes.
                </span>
                <button
                  className="secondary-button"
                  onClick={() => setInventoryOpen((value) => !value)}
                  data-tooltip={inventoryOpen ? "Collapse the full QR inventory drawer." : "Open the full QR inventory drawer with filters and pages."}
                >
                  {inventoryOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  <span>{inventoryOpen ? "Hide Inventory" : "Open Inventory"}</span>
                  <Tooltip text={inventoryOpen ? "Collapse the full QR inventory drawer." : "Open the full QR inventory drawer with filters and pages."} />
                </button>
              </div>
            </div>
            {inventoryOpen && (
              <div className="panel inventory-drawer">
                <div className="inventory-header">
                  <div>
                    <PanelTitle icon={Layers} title="QR Inventory" />
                    <p className="panel-help">
                      Full account inventory. Click any QR to select it, open its result view, or download a single
                      SVG/PNG from the result panel.
                    </p>
                  </div>
                  <div className="inventory-controls" aria-label="QR inventory controls">
                    <div className="segmented compact">
                      {(
                        [
                          ["all", "All"],
                          ["claimed", "Claimed"],
                          ["unclaimed", "Unclaimed"]
                        ] as const
                      ).map(([filter, label]) => (
                        <button
                          key={filter}
                          className={inventoryFilter === filter ? "active" : ""}
                          aria-pressed={inventoryFilter === filter}
                          onClick={() => setInventoryFilter(filter)}
                          data-tooltip={`Show ${label.toLowerCase()} QR codes in the inventory drawer.`}
                        >
                          {label}
                          <Tooltip text={`Show ${label.toLowerCase()} QR codes in the inventory drawer.`} />
                        </button>
                      ))}
                    </div>
                    <div className="pager">
                      <button
                        className="icon-button"
                        aria-label="Previous inventory page"
                        onClick={() => setInventoryPage((page) => Math.max(0, page - 1))}
                        disabled={boundedInventoryPage === 0}
                        data-tooltip="Go to the previous page of QR inventory."
                      >
                        <ChevronLeft size={18} />
                        <Tooltip text="Go to the previous page of QR inventory." />
                      </button>
                      <span>
                        Page {boundedInventoryPage + 1} of {inventoryPageCount}
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Next inventory page"
                        onClick={() => setInventoryPage((page) => Math.min(inventoryPageCount - 1, page + 1))}
                        disabled={boundedInventoryPage >= inventoryPageCount - 1}
                        data-tooltip="Go to the next page of QR inventory."
                      >
                        <ChevronRight size={18} />
                        <Tooltip text="Go to the next page of QR inventory." />
                      </button>
                    </div>
                  </div>
                </div>
                {inventoryPageLinks.length ? (
                  <div className="qr-grid inventory-grid">
                    {inventoryPageLinks.map((link) => (
                      <QrTile
                        key={link.id}
                        link={link}
                        active={activeQrId === link.id}
                        onOpen={() => void openQr(link.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No QR codes match this filter.</div>
                )}
              </div>
            )}
          </section>
        )}

        {activeView === "scan" && (
          <section className="grid scan-grid">
            <div className="panel">
              <PanelTitle icon={Camera} title="Scanner" />
              <ScannerPanel
                mode="open"
                baseUrl={qrBaseUrl}
                sampleLinks={(activeLink ? [activeLink] : []).concat(links).slice(0, 8)}
                targetId={null}
                onDecoded={(value) => void handleOpenScan(value)}
              />
              <ScanStatus message={scanMessage} />
            </div>
            <div className="panel">
              <PanelTitle icon={ShieldCheck} title="QR Result" />
              <QrDetail
                link={activeLink}
                privateQrId={privateQrId}
                notFoundQrId={notFoundQrId}
                projects={projects}
                guestView={guestView}
                canEdit={Boolean(currentUser)}
                onGuestToggle={() => setGuestView((value) => !value)}
                onClaim={claimActiveLink}
                onEdit={(id) => setEditingId(id)}
                onDownloadSvg={() => downloadSelectedQr("svg")}
                onDownloadPng={() => downloadSelectedQr("png")}
              />
            </div>
          </section>
        )}

        {activeView === "projects" && (
          <section className="grid project-grid">
            <div className="panel">
              <PanelTitle icon={FolderOpen} title="Projects" />
              <div className="new-project">
                <input
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                  placeholder="Enter project name and click +"
                  maxLength={MAX_PROJECT_NAME_LENGTH}
                />
                <button
                  className="icon-button"
                  onClick={addProject}
                  disabled={busy}
                  data-tooltip="Create a new project using the typed project name."
                  aria-label="Add project"
                >
                  <Plus size={18} />
                  <Tooltip text="Create a new project using the typed project name." />
                </button>
              </div>
              <div className="project-list">
                {projects.map((project) => (
                  <ProjectBlock
                    key={project.id}
                    project={project}
                    links={ownedLinks.filter((link) => link.projectId === project.id)}
                    onOpen={(id) => void openQr(id)}
                  />
                ))}
              </div>
            </div>
            <div className="panel">
              <PanelTitle icon={Pencil} title="Selected Link" />
              <QrDetail
                link={activeLink}
                privateQrId={privateQrId}
                notFoundQrId={notFoundQrId}
                projects={projects}
                guestView={guestView}
                canEdit={Boolean(currentUser)}
                onGuestToggle={() => setGuestView((value) => !value)}
                onClaim={claimActiveLink}
                onEdit={(id) => setEditingId(id)}
                onDownloadSvg={() => downloadSelectedQr("svg")}
                onDownloadPng={() => downloadSelectedQr("png")}
              />
            </div>
          </section>
        )}

        {activeView === "search" && (
          <section className="grid search-grid">
            <div className="panel">
              <PanelTitle icon={Search} title="Search" />
              <div className="search-box">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Title, body, project, or QR ID"
                />
              </div>
              <div className="link-list">
                {searchResults.map((link) => (
                  <button
                    key={link.id}
                    className={findTargetId === link.id ? "search-result active" : "search-result"}
                    onClick={() => {
                      setFindTargetId(link.id);
                      setActiveQrId(link.id);
                    }}
                    data-tooltip="Select this QR as the item to find with scanner mode."
                  >
                    <span>{link.title || link.id}</span>
                    <small>{link.body || link.url}</small>
                    <Tooltip text="Select this QR as the item to find with scanner mode." />
                  </button>
                ))}
              </div>
            </div>
            <div className="panel">
              <PanelTitle icon={Camera} title="Find Mode" />
              <FindTarget link={links.find((link) => link.id === findTargetId) ?? null} />
              <ScannerPanel
                mode="find"
                baseUrl={qrBaseUrl}
                sampleLinks={links.slice(0, 8)}
                targetId={findTargetId}
                onDecoded={(value) => void handleFindScan(value)}
              />
              <ScanStatus message={scanMessage} />
            </div>
          </section>
        )}
      </main>

      {editingId && (
        <LinkEditor
          link={links.find((link) => link.id === editingId) ?? activeLink}
          projects={projects}
          busy={busy}
          onClose={() => setEditingId(null)}
          onSave={saveLink}
          onUploadMedia={(qrId, files) => void uploadMedia(qrId, files)}
          onDeleteMedia={(qrId, mediaId) => void removeMedia(qrId, mediaId)}
        />
      )}
    </div>
  );
}

function viewTitle(view: View): string {
  return {
    home: "Home",
    factory: "QR Factory",
    scan: "Scan And Claim",
    projects: "Projects",
    search: "Search And Find"
  }[view];
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Archive; title: string }) {
  return (
    <div className="panel-title">
      <Icon size={18} />
      <h3>{title}</h3>
    </div>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="tooltip-bubble" aria-hidden="true">
      {text}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoginScreen({ error, busy, onLogin }: { error: string; busy: boolean; onLogin: (email: string, password: string) => void }) {
  return (
    <div className="login-shell">
      <div className="brand-block">
        <div className="brand-mark">LL</div>
        <div>
          <h1>Life Links</h1>
          <p>Hosted MVP demo</p>
        </div>
      </div>
      <LoginForm error={error} busy={busy} onLogin={onLogin} />
    </div>
  );
}

function PublicQrShell({
  link,
  privateQrId,
  notFoundQrId,
  projects,
  error,
  busy,
  onClaim,
  onLogin
}: {
  link: LinkRecord | null;
  privateQrId: string | null;
  notFoundQrId: string | null;
  projects: ProjectRecord[];
  error: string;
  busy: boolean;
  onClaim: () => void;
  onLogin: (email: string, password: string) => void;
}) {
  return (
    <main className="public-shell">
      <section className="public-qr-panel">
        <div className="brand-block">
          <div className="brand-mark">LL</div>
          <div>
            <h1>Life Links</h1>
            <p>QR object notes</p>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <QrDetail
          link={link}
          privateQrId={privateQrId}
          notFoundQrId={notFoundQrId}
          projects={projects}
          guestView={false}
          canEdit={false}
          onGuestToggle={() => undefined}
          onClaim={onClaim}
          onEdit={() => undefined}
          onDownloadSvg={() => undefined}
          onDownloadPng={() => undefined}
        />
      </section>
      <LoginForm error="" busy={busy} onLogin={onLogin} compact />
    </main>
  );
}

function LoginForm({
  error,
  busy,
  compact = false,
  onLogin
}: {
  error: string;
  busy: boolean;
  compact?: boolean;
  onLogin: (email: string, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className={compact ? "login-panel compact" : "login-panel"}
      onSubmit={(event) => {
        event.preventDefault();
        onLogin(email, password);
      }}
    >
      <div className="panel-title">
        <LogIn size={18} />
        <h3>Demo Login</h3>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <label>
        <span>Email</span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" maxLength={254} />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          maxLength={1024}
        />
      </label>
      <button className="primary-button" type="submit" disabled={busy} data-tooltip="Sign in with the demo email and password.">
        <LogIn size={18} />
        <span>{busy ? "Signing in" : "Sign in"}</span>
        <Tooltip text="Sign in with the demo email and password." />
      </button>
    </form>
  );
}

function QrPreview({ url }: { url: string }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 5
    }).then((nextSvg) => {
      if (alive) {
        setSvg(nextSvg);
      }
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return <div className="qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function QrTile({
  link,
  active,
  onOpen
}: {
  link: LinkRecord;
  active: boolean;
  onOpen: () => void;
}) {
  const title = link.title.trim() || (link.status === "claimed" ? "Untitled link" : "Unclaimed QR");

  return (
    <button
      className={active ? "qr-tile active" : "qr-tile"}
      onClick={onOpen}
      aria-label={`Open ${link.id}`}
      data-tooltip={`Open QR result for ${title}.`}
    >
      <QrPreview url={link.url} />
      <span className="qr-tile-id">{shortQrId(link.id)}</span>
      <span className={`qr-status ${link.status}`}>{link.status}</span>
      <small>{title}</small>
      <Tooltip text={`Open QR result for ${title}.`} />
    </button>
  );
}

function shortQrId(id: string): string {
  return id.length <= 18 ? id : `${id.slice(0, 11)}...${id.slice(-4)}`;
}

function bodyPreview(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function LinkRow({
  link,
  project,
  active,
  onOpen
}: {
  link: LinkRecord;
  project?: ProjectRecord;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={active ? "link-row active" : "link-row"}
      onClick={onOpen}
      data-tooltip={`Open QR result for ${link.title || link.id}.`}
    >
      <span className="link-row-topline">
        <small>{link.id}</small>
        <span className={`privacy-badge ${link.privacy}`}>{link.privacy}</span>
      </span>
      <strong>{link.title || (link.status === "unclaimed" ? "Unclaimed link" : "Untitled link")}</strong>
      <span className="link-row-project">{project?.name ?? "No project"}</span>
      {link.body ? <span className="link-row-body">{bodyPreview(link.body)}</span> : null}
      <Tooltip text={`Open QR result for ${link.title || link.id}.`} />
    </button>
  );
}

function QrDetail({
  link,
  privateQrId,
  notFoundQrId,
  projects,
  guestView,
  canEdit,
  onGuestToggle,
  onClaim,
  onEdit,
  onDownloadSvg,
  onDownloadPng
}: {
  link: LinkRecord | null;
  privateQrId: string | null;
  notFoundQrId: string | null;
  projects: ProjectRecord[];
  guestView: boolean;
  canEdit: boolean;
  onGuestToggle: () => void;
  onClaim: () => void;
  onEdit: (id: string) => void;
  onDownloadSvg: () => void;
  onDownloadPng: () => void;
}) {
  if (notFoundQrId) {
    return (
      <div className="empty-state">
        <span>QR not found: {notFoundQrId}</span>
      </div>
    );
  }

  if (privateQrId) {
    return (
      <div className="qr-detail">
        <div className="phone-page">
          <div className="phone-bar">
            <span>{privateQrId}</span>
            <span>Private</span>
          </div>
          <div className="claim-screen">
            <Lock size={42} />
            <h3>Private link</h3>
            <p>Log in as the owner to view this content.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!link) {
    return <div className="empty-state">No QR selected.</div>;
  }

  const project = projects.find((item) => item.id === link.projectId);
  const privateGuest = guestView && link.privacy === "private";

  return (
    <div className="qr-detail">
      <div className="phone-page">
        <div className="phone-bar">
          <span>{link.id}</span>
          <span>{link.privacy === "private" ? "Private" : "Public"}</span>
        </div>
        {link.status === "unclaimed" ? (
          <div className="claim-screen">
            <QrPreview url={link.url} />
            <h3>Unclaimed link</h3>
            <button className="primary-button" onClick={onClaim} data-tooltip="Claim this unclaimed QR into the signed-in account.">
              <ShieldCheck size={18} />
              <span>Claim</span>
              <Tooltip text="Claim this unclaimed QR into the signed-in account." />
            </button>
          </div>
        ) : privateGuest ? (
          <div className="claim-screen">
            <Lock size={42} />
            <h3>Private link</h3>
          </div>
        ) : (
          <article className="public-content">
            <p className="project-label">{project?.name ?? "Life Link"}</p>
            <h3>{link.title || "Untitled link"}</h3>
            <RichBodyRenderer body={link.body} bodyDoc={link.bodyDoc} />
            <MediaGallery media={link.media} title={link.title || link.id} />
          </article>
        )}
      </div>
      <div className="meta-stack">
        <code>{link.url}</code>
        <div className="button-row">
          <button
            className="secondary-button"
            onClick={onGuestToggle}
            disabled={!canEdit}
            data-tooltip={guestView ? "Return to the owner editing preview." : "Preview how this QR appears to a public visitor."}
          >
            {guestView ? <ShieldCheck size={18} /> : <Globe2 size={18} />}
            <span>{guestView ? "Owner" : "Guest"}</span>
            <Tooltip text={guestView ? "Return to the owner editing preview." : "Preview how this QR appears to a public visitor."} />
          </button>
          <button
            className="secondary-button"
            onClick={() => onEdit(link.id)}
            disabled={link.status === "unclaimed" || !canEdit}
            data-tooltip={link.status === "unclaimed" ? "Claim this QR before editing its content." : "Edit title, body, project, privacy, and media."}
          >
            <Pencil size={18} />
            <span>Edit</span>
            <Tooltip text={link.status === "unclaimed" ? "Claim this QR before editing its content." : "Edit title, body, project, privacy, and media."} />
          </button>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={onDownloadSvg} disabled={!canEdit} data-tooltip="Download this QR code as a print-quality SVG file.">
            <Download size={18} />
            <span>SVG</span>
            <Tooltip text="Download this QR code as a print-quality SVG file." />
          </button>
          <button className="secondary-button" onClick={onDownloadPng} disabled={!canEdit} data-tooltip="Download this QR code as a PNG image file.">
            <Download size={18} />
            <span>PNG</span>
            <Tooltip text="Download this QR code as a PNG image file." />
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaGallery({ media, title }: { media: LinkRecord["media"]; title: string }) {
  if (!media.length) {
    return null;
  }

  return (
    <div className="media-gallery">
      {media.map((item) => (
        <figure key={item.id} className="media-frame">
          {item.kind === "image" ? (
            <img src={item.url} alt={`${title} attachment`} loading="lazy" />
          ) : (
            <video src={item.url} controls preload="metadata" />
          )}
        </figure>
      ))}
    </div>
  );
}

function ScannerPanel({
  mode,
  baseUrl,
  sampleLinks,
  targetId,
  onDecoded
}: {
  mode: CameraMode;
  baseUrl: string;
  sampleLinks: LinkRecord[];
  targetId: string | null;
  onDecoded: (scanText: string) => void;
}) {
  const readerId = useMemo(() => `reader-${mode}-${Math.random().toString(36).slice(2)}`, [mode]);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  async function startCamera() {
    setCameraError("");
    if (scannerRef.current) {
      return;
    }
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(readerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => onDecoded(decodedText),
        () => undefined
      );
      setCameraActive(true);
    } catch (cameraIssue) {
      scannerRef.current = null;
      setCameraError(cameraIssue instanceof Error ? cameraIssue.message : "Camera unavailable");
    }
  }

  async function stopCamera() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      await scanner.stop().catch(() => undefined);
      scanner.clear();
    }
    setCameraActive(false);
  }

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner.stop().catch(() => undefined);
      }
    };
  }, []);

  return (
    <div className="scanner">
      <div id={readerId} className="reader" />
      <div className="button-row">
        <button
          className="primary-button"
          onClick={cameraActive ? stopCamera : startCamera}
          data-tooltip={cameraActive ? "Stop the browser camera scanner." : "Start the browser camera scanner."}
        >
          <Camera size={18} />
          <span>{cameraActive ? "Stop" : "Camera"}</span>
          <Tooltip text={cameraActive ? "Stop the browser camera scanner." : "Start the browser camera scanner."} />
        </button>
        {targetId && (
          <button
            className="secondary-button"
            onClick={() => onDecoded(buildQrUrl(baseUrl, targetId))}
            data-tooltip="Simulate scanning the selected find-mode target."
          >
            <Check size={18} />
            <span>Target</span>
            <Tooltip text="Simulate scanning the selected find-mode target." />
          </button>
        )}
      </div>
      {cameraError && <p className="inline-warning">{cameraError}</p>}
      <div className="sample-scan-panel" aria-label="Demo scan shortcuts">
        <div className="sample-scan-heading">
          <strong>Demo scan shortcuts</strong>
          <span>Click one to simulate scanning a QR code without using the camera.</span>
        </div>
        <div className="sample-scans">
          {sampleLinks.map((link) => (
            <button key={`${mode}-${link.id}`} onClick={() => onDecoded(link.url)} data-tooltip={`Simulate scanning ${link.title || link.id}.`}>
              {link.title || link.id}
              <Tooltip text={`Simulate scanning ${link.title || link.id}.`} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScanStatus({ message }: { message: ScanMessage }) {
  const Icon = message.tone === "success" ? Check : message.tone === "warning" ? CircleAlert : QrCode;
  return (
    <div className={`scan-status ${message.tone}`}>
      <Icon size={18} />
      <div>
        <strong>{message.title}</strong>
        <span>{message.detail}</span>
      </div>
    </div>
  );
}

function ProjectBlock({
  project,
  links,
  onOpen
}: {
  project: ProjectRecord;
  links: LinkRecord[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="project-block">
      <div>
        <h4>{project.name}</h4>
        <span>{links.length} links</span>
      </div>
      <div className="project-links">
        {links.map((link) => (
          <button key={link.id} onClick={() => onOpen(link.id)} data-tooltip={`Open QR result for ${link.title || link.id}.`}>
            {link.title || link.id}
            <Tooltip text={`Open QR result for ${link.title || link.id}.`} />
          </button>
        ))}
      </div>
    </section>
  );
}

function FindTarget({ link }: { link: LinkRecord | null }) {
  if (!link) {
    return <div className="empty-state">Select a search result.</div>;
  }
  return (
    <div className="find-target">
      <QrPreview url={link.url} />
      <div>
        <span>Target</span>
        <strong>{link.title || link.id}</strong>
        <code>{link.id}</code>
      </div>
    </div>
  );
}

function LinkEditor({
  link,
  projects,
  busy,
  onClose,
  onSave,
  onUploadMedia,
  onDeleteMedia
}: {
  link: LinkRecord | null;
  projects: ProjectRecord[];
  busy: boolean;
  onClose: () => void;
  onSave: (qrId: string, patch: Pick<LinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId">) => void;
  onUploadMedia: (qrId: string, files: FileList) => void;
  onDeleteMedia: (qrId: string, mediaId: string) => void;
}) {
  const initialState = linkEditorStateFromLink(link);
  const [title, setTitle] = useState(initialState.title);
  const [body, setBody] = useState(initialState.body);
  const [bodyDoc, setBodyDoc] = useState(initialState.bodyDoc);
  const [bodyDocVersion, setBodyDocVersion] = useState(initialState.bodyDocVersion);
  const [privacy, setPrivacy] = useState<PrivacyStatus>(initialState.privacy);
  const [projectId, setProjectId] = useState(initialState.projectId);
  const [draftMessage, setDraftMessage] = useState("");
  const [pendingDraft, setPendingDraft] = useState<LinkEditorDraft | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const bodyDocJson = useMemo(() => JSON.stringify(bodyDoc), [bodyDoc]);

  useEffect(() => {
    if (!link) {
      return;
    }
    const draft = readLinkEditorDraft(link.id);
    const baseState = linkEditorStateFromLink(link);
    if (draft?.linkUpdatedAt === link.updatedAt) {
      applyLinkEditorState(draft.patch, {
        setTitle,
        setBody,
        setBodyDoc,
        setBodyDocVersion,
        setPrivacy,
        setProjectId
      });
      setPendingDraft(null);
      setDraftMessage("Draft recovered from this browser.");
      setEditorRevision((revision) => revision + 1);
      return;
    }
    applyLinkEditorState(baseState, {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(draft);
    setDraftMessage(draft ? "A saved draft exists from an older version of this link." : "");
    setEditorRevision((revision) => revision + 1);
  }, [link?.id]);

  useEffect(() => {
    if (!link) {
      return;
    }
    const patch = linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId });
    if (!linkEditorPatchIsDirty(link, patch)) {
      return;
    }
    const timer = window.setTimeout(() => {
      writeLinkEditorDraft(link.id, link.updatedAt, patch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [body, bodyDocJson, bodyDocVersion, link, privacy, projectId, title]);

  function discardDraft() {
    if (!link) {
      return;
    }
    clearLinkEditorDraft(link.id);
    applyLinkEditorState(linkEditorStateFromLink(link), {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(null);
    setDraftMessage("");
    setEditorRevision((revision) => revision + 1);
  }

  function restorePendingDraft() {
    if (!pendingDraft) {
      return;
    }
    applyLinkEditorState(pendingDraft.patch, {
      setTitle,
      setBody,
      setBodyDoc,
      setBodyDocVersion,
      setPrivacy,
      setProjectId
    });
    setPendingDraft(null);
    setDraftMessage("Draft restored. Review before saving.");
    setEditorRevision((revision) => revision + 1);
  }

  if (!link) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form
        className="editor"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(link.id, linkEditorPatchFromState({ title, body, bodyDoc, bodyDocVersion, privacy, projectId }));
        }}
      >
        <div className="editor-header">
          <div>
            <span>Edit link</span>
            <strong>{link.id}</strong>
          </div>
          <button type="button" className="icon-button" onClick={onClose} data-tooltip="Close the editor without saving." aria-label="Close editor">
            <X size={18} />
            <Tooltip text="Close the editor without saving." />
          </button>
        </div>
        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MAX_TITLE_LENGTH} />
        </label>
        {draftMessage ? (
          <div className={pendingDraft ? "draft-notice conflict" : "draft-notice"} role="status">
            <span>{draftMessage}</span>
            <span className="draft-actions">
              {pendingDraft ? (
                <button type="button" className="text-button" onClick={restorePendingDraft}>
                  Restore
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={discardDraft}>
                Discard draft
              </button>
            </span>
          </div>
        ) : null}
        <label>
          <span>Body</span>
          <Suspense fallback={<div className="rich-body-editor-loading">Loading body editor...</div>}>
            <RichBodyEditor
              contentKey={`${link.id}:${editorRevision}`}
              value={bodyDoc}
              fallbackBody={body}
              disabled={busy}
              onChange={(next) => {
                setBody(next.body);
                setBodyDoc(next.bodyDoc);
                setBodyDocVersion(next.bodyDocVersion);
              }}
            />
          </Suspense>
        </label>
        <div className="editor-grid">
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Privacy</span>
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyStatus)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
        <div className="media-editor">
          <div className="media-editor-header">
            <span>Media</span>
            <label className="secondary-button upload-control" data-tooltip="Attach images or videos to this QR result.">
              <Upload size={18} />
              <span>Add</span>
              <Tooltip text="Attach images or videos to this QR result." />
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                disabled={busy}
                onChange={(event) => {
                  const files = event.currentTarget.files;
                  if (files?.length) {
                    onUploadMedia(link.id, files);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {link.media.length ? (
            <div className="media-list">
              {link.media.map((item) => {
                const Icon = item.kind === "image" ? Image : Video;
                return (
                  <div key={item.id} className="media-item">
                    <Icon size={18} />
                    <span>{item.fileName}</span>
                    <small>{formatBytes(item.sizeBytes)}</small>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onDeleteMedia(link.id, item.id)}
                      disabled={busy}
                      data-tooltip="Remove this media attachment."
                      aria-label={`Remove ${item.fileName}`}
                    >
                      <Trash2 size={18} />
                      <Tooltip text="Remove this media attachment." />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="inline-note">No media attached yet.</p>
          )}
        </div>
        <button className="primary-button" type="submit" disabled={busy} data-tooltip="Save link content, project, privacy, and media changes.">
          <Check size={18} />
          <span>Save</span>
          <Tooltip text="Save link content, project, privacy, and media changes." />
        </button>
      </form>
    </div>
  );
}

type LinkEditorPatch = Pick<LinkRecord, "title" | "body" | "bodyDoc" | "bodyDocVersion" | "privacy" | "projectId">;

type LinkEditorDraft = {
  version: 1;
  qrId: string;
  linkUpdatedAt: string;
  savedAt: string;
  patch: LinkEditorPatch;
};

type LinkEditorState = {
  title: string;
  body: string;
  bodyDoc: NonNullable<LinkRecord["bodyDoc"]>;
  bodyDocVersion: number;
  privacy: PrivacyStatus;
  projectId: string;
};

type LinkEditorStateSetters = {
  setTitle: (value: string) => void;
  setBody: (value: string) => void;
  setBodyDoc: (value: NonNullable<LinkRecord["bodyDoc"]>) => void;
  setBodyDocVersion: (value: number) => void;
  setPrivacy: (value: PrivacyStatus) => void;
  setProjectId: (value: string) => void;
};

function linkEditorStateFromLink(link: LinkRecord | null): LinkEditorState {
  return {
    title: link?.title ?? "",
    body: link?.body ?? "",
    bodyDoc: link?.bodyDoc ?? createLinkBodyDocFromPlainText(link?.body ?? ""),
    bodyDocVersion: link?.bodyDocVersion ?? 1,
    privacy: link?.privacy ?? "public",
    projectId: link?.projectId ?? ""
  };
}

function applyLinkEditorState(state: LinkEditorState | LinkEditorPatch, setters: LinkEditorStateSetters) {
  setters.setTitle(state.title);
  setters.setBody(state.body);
  setters.setBodyDoc(state.bodyDoc ?? createLinkBodyDocFromPlainText(state.body));
  setters.setBodyDocVersion(state.bodyDocVersion ?? 1);
  setters.setPrivacy(state.privacy);
  setters.setProjectId(state.projectId ?? "");
}

function linkEditorPatchFromState(state: LinkEditorState): LinkEditorPatch {
  return {
    title: state.title,
    body: state.body,
    bodyDoc: state.bodyDoc,
    bodyDocVersion: state.bodyDocVersion,
    privacy: state.privacy,
    projectId: state.projectId || null
  };
}

function linkEditorPatchIsDirty(link: LinkRecord, patch: LinkEditorPatch): boolean {
  return (
    patch.title !== link.title ||
    patch.body !== link.body ||
    patch.privacy !== link.privacy ||
    (patch.projectId ?? null) !== (link.projectId ?? null) ||
    patch.bodyDocVersion !== (link.bodyDocVersion ?? 1) ||
    JSON.stringify(patch.bodyDoc ?? null) !== JSON.stringify(link.bodyDoc ?? createLinkBodyDocFromPlainText(link.body))
  );
}

function linkEditorDraftKey(qrId: string): string {
  return `${LINK_EDITOR_DRAFT_STORAGE_PREFIX}:${qrId}`;
}

function readLinkEditorDraft(qrId: string): LinkEditorDraft | null {
  try {
    const raw = window.localStorage.getItem(linkEditorDraftKey(qrId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LinkEditorDraft>;
    if (parsed.version !== 1 || parsed.qrId !== qrId || !parsed.patch) {
      return null;
    }
    return parsed as LinkEditorDraft;
  } catch {
    return null;
  }
}

function writeLinkEditorDraft(qrId: string, linkUpdatedAt: string, patch: LinkEditorPatch) {
  try {
    const draft: LinkEditorDraft = {
      version: 1,
      qrId,
      linkUpdatedAt,
      savedAt: new Date().toISOString(),
      patch
    };
    window.localStorage.setItem(linkEditorDraftKey(qrId), JSON.stringify(draft));
  } catch {
    // Draft recovery is a convenience feature; storage failures should not block editing.
  }
}

function clearLinkEditorDraft(qrId: string) {
  try {
    window.localStorage.removeItem(linkEditorDraftKey(qrId));
  } catch {
    // Draft recovery is a convenience feature; storage failures should not block saves.
  }
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

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.ceil(value / 1024)} KB`;
  }
  return `${value} B`;
}

function messageFromError(error: unknown): string {
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
