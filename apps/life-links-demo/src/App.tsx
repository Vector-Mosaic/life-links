import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Sun
} from "lucide-react";
import {
  type LinkRecord,
  type ProjectRecord,
  buildQrUrl,
  searchOwnedLinks
} from "@life-links/core";
import { AgentAccessPanel, type AgentAccessRegistrationStatus } from "./agent/AgentAccessPanel";
import { AgentActivityPanel } from "./agent/AgentActivityPanel";
import {
  instrumentAgentToolCatalog,
  type AgentActivityEntry
} from "./agent/activity";
import { getBrowserWebMcpHost } from "./agent/browserWebMcpHost";
import { createLifeLinksAgentToolCatalog } from "./agent/toolHandlers";
import {
  agentAccessGrantIsActive,
  usePageToolRegistration
} from "./agent/usePageToolRegistration";
import { LifeLinkEditor } from "./owner/LifeLinkEditor";
import { OwnerWorkspace } from "./owner/OwnerWorkspace";
import { RichBodyRenderer } from "./richBody";
import { Tooltip } from "./ui/Tooltip";
import { LifeLinksWorkspaceProvider, useLifeLinksWorkspace } from "./workspace/LifeLinksWorkspaceProvider";
import { classifyLifeLinksRoute } from "./workspace/routes";
import type { ScanMessage, WorkspaceView } from "./workspace/types";

type Html5QrcodeScanner = InstanceType<typeof import("html5-qrcode").Html5Qrcode>;

type View = WorkspaceView;
type CameraMode = "open" | "find";
const INVENTORY_PAGE_SIZE = 24;

export default function App() {
  return (
    <LifeLinksWorkspaceProvider>
      <LifeLinksApp />
    </LifeLinksWorkspaceProvider>
  );
}

function LifeLinksApp() {
  const { controller, snapshot } = useLifeLinksWorkspace();
  const {
    currentUser,
    qrBaseUrl,
    links,
    projects,
    activeView,
    batchCount,
    lastBatchId,
    lastBatchIds,
    inventoryOpen,
    inventoryFilter,
    inventoryPage,
    activeQrId,
    publicQrState,
    editingId,
    findTargetId,
    query,
    guestView,
    scanMessage,
    loading,
    busy,
    error,
    theme,
    routePathname,
    canonicalEditingId,
    selectedLifeLinkDetail,
    rootLifeLinks
  } = snapshot;
  const [agentAccessOwnerId, setAgentAccessOwnerId] = useState<string | null>(null);
  const [agentActivities, setAgentActivities] = useState<AgentActivityEntry[]>([]);
  const agentActivityEligibleRef = useRef(false);
  const ownerWorkspaceHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("life-links-theme", theme);
    } catch {
      // Theme persistence is cosmetic; keep rendering even when storage is blocked.
    }
  }, [theme]);

  const ownedLinks = useMemo(
    () => (currentUser ? links.filter((link) => link.ownerId === currentUser.id) : []),
    [currentUser, links]
  );
  const unclaimedLinks = useMemo(() => links.filter((link) => link.status === "unclaimed"), [links]);
  const route = classifyLifeLinksRoute(routePathname, Boolean(currentUser));
  const previousRouteSurfaceRef = useRef(route.surface);

  useEffect(() => {
    const previousSurface = previousRouteSurfaceRef.current;
    previousRouteSurfaceRef.current = route.surface;
    if (previousSurface === "public-qr" && route.surface === "owner-workspace") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      const focusFrame = window.requestAnimationFrame(() => {
        ownerWorkspaceHeadingRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(focusFrame);
    }
    return undefined;
  }, [route.surface]);

  const agentAccessEnabled = agentAccessGrantIsActive(
    agentAccessOwnerId,
    currentUser?.id ?? null,
    route.surface,
    guestView
  );
  agentActivityEligibleRef.current = agentAccessEnabled;
  const recordAgentActivity = useCallback((entry: AgentActivityEntry) => {
    if (!agentActivityEligibleRef.current) {
      return;
    }
    setAgentActivities((current) => [entry, ...current].slice(0, 10));
  }, []);
  const agentToolDefinitions = useMemo(
    () => instrumentAgentToolCatalog(createLifeLinksAgentToolCatalog(controller), recordAgentActivity),
    [controller, recordAgentActivity]
  );
  const webMcpSupported = getBrowserWebMcpHost(
    typeof document === "undefined" ? null : document
  ).status === "supported";
  const registration = usePageToolRegistration({
    definitions: agentToolDefinitions,
    eligibility: {
      authenticatedOwnerId: currentUser?.id ?? null,
      surface: route.surface,
      agentAccessEnabled: agentAccessEnabled && !guestView
    }
  });

  useEffect(() => {
    setAgentAccessOwnerId(null);
    setAgentActivities([]);
  }, [currentUser?.id, guestView, route.surface]);
  const activeLink = useMemo(() => {
    if (route.surface === "public-qr") {
      if (publicQrState?.state === "claimed") {
        return publicQrState.link;
      }
      if (publicQrState?.state === "unclaimed") {
        return publicQrState.qr;
      }
      return null;
    }
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
  }, [activeQrId, links, publicQrState, route.surface]);
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
  const setActiveView = (view: View) => controller.setActiveView(view);
  const handleLogin = (email: string, password: string) => controller.login(email, password);
  const handleLogout = () => {
    agentActivityEligibleRef.current = false;
    setAgentAccessOwnerId(null);
    setAgentActivities([]);
    return controller.logout();
  };
  const openQr = (qrId: string) => controller.openQr(qrId);
  const handleOpenScan = (scanText: string) => controller.scanQr(scanText);
  const handleFindScan = (scanText: string) => controller.evaluateFindScan(scanText);
  const generateBatch = () => controller.generateBatch();
  const claimActiveLink = () => controller.claimActiveLink();
  const refreshDemo = () => controller.refresh();
  const downloadSelectedQr = (format: "svg" | "png") => controller.downloadSelectedQr(format);
  const downloadCsv = (ids?: string[]) => controller.downloadCsv(ids);
  const downloadZip = () => controller.downloadZip();
  const setAgentAccess = (enabled: boolean) => {
    const grantedOwnerId =
      enabled && currentUser && route.surface === "owner-workspace" && !guestView
        ? currentUser.id
        : null;
    agentActivityEligibleRef.current = grantedOwnerId !== null;
    setAgentAccessOwnerId(grantedOwnerId);
    if (grantedOwnerId === null) {
      setAgentActivities([]);
    }
  };
  const agentRegistrationStatus: AgentAccessRegistrationStatus =
    registration.status === "registered"
      ? "ready"
      : registration.status === "registering"
        ? "registering"
        : registration.status === "error"
          ? "error"
          : "inactive";
  const agentRegistrationError = registration.status === "error" ? registration.error.message : "";

  const navItems: Array<{ view: View; label: string; icon: typeof Archive }> = [
    { view: "home", label: "Home", icon: Home },
    { view: "scan", label: "Scan", icon: Camera },
    { view: "projects", label: "My Life Links", icon: FolderOpen },
    { view: "search", label: "Search", icon: Search },
    { view: "factory", label: "Factory", icon: QrCode }
  ];

  if (loading) {
    return <div className="loading-shell">Loading Life Links...</div>;
  }

  if (route.surface === "public-qr") {
    return (
      <PublicQrShell
        link={activeLink}
        privateQrId={privateQrId}
        notFoundQrId={notFoundQrId}
        error={error}
        busy={busy}
        signedIn={Boolean(currentUser)}
        onClaim={claimActiveLink}
        onLogin={handleLogin}
        onOpenWorkspace={() => void controller.openPublicQrInWorkspace()}
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
          <Stat label="Top level" value={rootLifeLinks.items.length.toLocaleString()} />
        </div>
        <div className="sidebar-actions">
          <button className="ghost-button full-width" onClick={refreshDemo} data-tooltip="Refresh links, projects, and the selected QR from the server.">
            <RefreshCcw size={16} />
            <span>Refresh</span>
            <Tooltip text="Refresh links, projects, and the selected QR from the server." />
          </button>
          <button className="ghost-button full-width" onClick={handleLogout} data-tooltip="Sign out of Life Links.">
            <LogOut size={16} />
            <span>Logout</span>
            <Tooltip text="Sign out of Life Links." />
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">Physical-world context</p>
            <h2 ref={ownerWorkspaceHeadingRef} tabIndex={-1}>
              {viewTitle(activeView)}
            </h2>
            <p className="topbar-context">Private context for the things, places, and plans that shape your life.</p>
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
              onClick={() => controller.setTheme(nextTheme)}
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

        <section className="agent-command-center" aria-label="Life Links agent controls">
          <header className="agent-command-heading">
            <div>
              <p className="eyebrow">Explicit page-session authority</p>
              <h3>Agent connection</h3>
            </div>
            <span className="agent-session-boundary">
              <Lock size={14} />
              Ends with this page session
            </span>
          </header>
          <div className="agent-console-grid">
            <AgentAccessPanel
              supported={webMcpSupported}
              enabled={agentAccessEnabled}
              registrationStatus={agentRegistrationStatus}
              registrationError={agentRegistrationError}
              onEnabledChange={setAgentAccess}
            />
            <AgentActivityPanel activities={agentActivities} />
          </div>
        </section>

        {activeView === "home" && (
          <section className="home-stack">
            <div className="home-stats" aria-label="Life Links summary">
              <Stat label="Owned" value={ownedLinks.length.toLocaleString()} />
              <Stat label="Unclaimed" value={unclaimedLinks.length.toLocaleString()} />
              <Stat label="Top level" value={rootLifeLinks.items.length.toLocaleString()} />
            </div>

            <div className="panel quick-actions-panel">
              <PanelTitle icon={QrCode} title="Quick Actions" />
              <div className="quick-actions-grid">
                <button className="primary-button" onClick={() => setActiveView("scan")} data-tooltip="Open QR scanner and claim flow.">
                  <Camera size={18} />
                  <span>Scan QR</span>
                  <Tooltip text="Open QR scanner and claim flow." />
                </button>
                <button className="secondary-button" onClick={() => setActiveView("projects")} data-tooltip="Open your recursive Life Links hierarchy.">
                  <FolderOpen size={18} />
                  <span>My Life Links</span>
                  <Tooltip text="Open your recursive Life Links hierarchy." />
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
                  onGuestToggle={() => controller.toggleGuestView()}
                  onClaim={claimActiveLink}
                  onEdit={(id) => controller.openEditor(id)}
                  onDownloadSvg={() => downloadSelectedQr("svg")}
                  onDownloadPng={() => downloadSelectedQr("png")}
                />
              </div>
            </div>

            <button className="ghost-button mobile-signout-action" onClick={handleLogout} data-tooltip="Sign out of Life Links.">
              <LogOut size={18} />
              <span>Sign Out {currentUser.email}</span>
              <Tooltip text="Sign out of Life Links." />
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
                    onChange={(event) => controller.setBatchCount(event.target.value)}
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
                  onClick={() => controller.toggleInventory()}
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
                          onClick={() => controller.setInventoryFilter(filter)}
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
                        onClick={() => controller.setInventoryPage(Math.max(0, boundedInventoryPage - 1))}
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
                        onClick={() => controller.setInventoryPage(Math.min(inventoryPageCount - 1, boundedInventoryPage + 1))}
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
                onGuestToggle={() => controller.toggleGuestView()}
                onClaim={claimActiveLink}
                onEdit={(id) => controller.openEditor(id)}
                onDownloadSvg={() => downloadSelectedQr("svg")}
                onDownloadPng={() => downloadSelectedQr("png")}
              />
            </div>
          </section>
        )}

        {activeView === "projects" && (
          <OwnerWorkspace controller={controller} snapshot={snapshot} />
        )}

        {activeView === "search" && (
          <section className="grid search-grid">
            <div className="panel">
              <PanelTitle icon={Search} title="Search" />
              <div className="search-box">
                <Search size={18} />
                <input
                  value={query}
                  onChange={(event) => controller.setQuery(event.target.value)}
                  placeholder="Title, body, project, or QR ID"
                />
              </div>
              <div className="link-list">
                {searchResults.map((link) => (
                  <button
                    key={link.id}
                    className={findTargetId === link.id ? "search-result active" : "search-result"}
                    onClick={() => controller.selectFindTarget(link.id)}
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
        <LifeLinkEditor
          link={links.find((link) => link.id === editingId) ?? activeLink}
          projects={projects}
          busy={busy}
          onClose={() => controller.closeEditor()}
          onSave={(qrId, patch) => void controller.saveLink(qrId, patch)}
          onUploadMedia={(qrId, files) => void controller.uploadMedia(qrId, files)}
          onDeleteMedia={(qrId, mediaId) => void controller.removeMedia(qrId, mediaId)}
        />
      )}
      {canonicalEditingId && (
        <LifeLinkEditor
          mode="canonical"
          link={selectedLifeLinkDetail?.lifeLink.id === canonicalEditingId ? selectedLifeLinkDetail.lifeLink : null}
          busy={busy}
          onClose={() => controller.closeCanonicalEditor()}
          onSave={(lifeLinkId, expectedUpdatedAt, patch) =>
            void controller.saveCanonicalLifeLink(lifeLinkId, expectedUpdatedAt, patch)
          }
          onUploadMedia={(lifeLinkId, files) => void controller.uploadCanonicalMedia(lifeLinkId, files)}
          onDeleteMedia={(lifeLinkId, mediaId) => void controller.removeCanonicalMedia(lifeLinkId, mediaId)}
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
    projects: "My Life Links",
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
          <p>Physical context for people and agents</p>
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
  error,
  busy,
  signedIn,
  onClaim,
  onLogin,
  onOpenWorkspace
}: {
  link: LinkRecord | null;
  privateQrId: string | null;
  notFoundQrId: string | null;
  error: string;
  busy: boolean;
  signedIn: boolean;
  onClaim: () => void;
  onLogin: (email: string, password: string) => void;
  onOpenWorkspace: () => void;
}) {
  const recordHeading = notFoundQrId
    ? "Life Link not found"
    : privateQrId
      ? "Private context protected"
      : link?.status === "unclaimed"
        ? "Unclaimed permanent Life Link"
        : link?.privacy === "private"
          ? "Private context visible to owner"
          : "Owner-published physical context";
  const recordStatus = notFoundQrId
    ? "Resolution status"
    : privateQrId
      ? "Private boundary"
      : link?.status === "unclaimed"
        ? "Public handle"
        : link?.privacy === "private"
          ? "Owner-only view"
          : "Public view";
  const recordFootnote = notFoundQrId
    ? "No matching Life Link was found."
    : privateQrId
      ? "Private context remains hidden."
      : link?.status === "unclaimed"
        ? "No owner content is attached yet."
        : link?.privacy === "private"
          ? "Owner-only context, not publicly shared."
          : "Shared by the owner, not inferred by the scanner.";

  return (
    <main className="public-shell">
      <header className="public-brand-bar">
        <div className="brand-block">
          <div className="brand-mark">LL</div>
          <div>
            <h1>Life Links</h1>
            <p>Private context for physical life</p>
          </div>
        </div>
        <span className="public-trust-pill">
          <Lock size={14} />
          Private by default
        </span>
      </header>

      <section className="public-intro" aria-labelledby="public-life-links-title">
        <p className="eyebrow">A context layer for physical life</p>
        <h2 id="public-life-links-title">AI knows the world. Life Links lets it know yours.</h2>
        <p className="public-lede">
          A permanent QR reconnects a real place, container, or object with the context its owner chose to preserve.
        </p>
        <ul className="public-principles" aria-label="Life Links principles">
          <li>
            <QrCode size={18} />
            <span><strong>Permanent handle</strong> for a physical subject</span>
          </li>
          <li>
            <ShieldCheck size={18} />
            <span><strong>Owner-controlled</strong> context and agent access</span>
          </li>
          <li>
            <Layers size={18} />
            <span><strong>Private depth</strong> behind a deliberately public edge</span>
          </li>
        </ul>
      </section>

      <section className="public-record-card" aria-labelledby="public-record-title">
        <header className="public-record-heading">
          <div>
            <p className="eyebrow">Scanned Life Link</p>
            <h2 id="public-record-title">{recordHeading}</h2>
          </div>
          <span className="public-live-status"><span aria-hidden="true" /> {recordStatus}</span>
        </header>
        {error && <div className="error-banner">{error}</div>}
        <QrDetail
          link={link}
          privateQrId={privateQrId}
          notFoundQrId={notFoundQrId}
          projects={[]}
          guestView={false}
          canEdit={false}
          onGuestToggle={() => undefined}
          onClaim={onClaim}
          onEdit={() => undefined}
          onDownloadSvg={() => undefined}
          onDownloadPng={() => undefined}
          publicPresentation
        />
      </section>

      <aside className="public-owner-gate" aria-label="Owner access">
        <div className="public-owner-boundary">
          <ShieldCheck size={18} />
          <div>
            <strong>This is the public edge</strong>
            <p>The private hierarchy, history, preferences, plans, and agent controls stay behind owner sign-in.</p>
          </div>
        </div>
        {signedIn ? (
          <section className="login-panel compact public-owner-entry">
            <strong>Signed in as the owner</strong>
            <p>Keep this permanent QR page public-facing, or enter the private hierarchy explicitly.</p>
            <button className="primary-button" onClick={onOpenWorkspace} disabled={busy}>
              <FolderOpen size={18} />
              <span>Open in My Life Links</span>
            </button>
          </section>
        ) : (
          <LoginForm error="" busy={busy} onLogin={onLogin} compact />
        )}
      </aside>

      <footer className="public-footnote">
        <span>Recorded context, not live sensing.</span>
        <span>{recordFootnote}</span>
      </footer>
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
        <h3>Sign in to Life Links</h3>
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
      <button className="primary-button" type="submit" disabled={busy} data-tooltip="Sign in with your Life Links email and password.">
        <LogIn size={18} />
        <span>{busy ? "Signing in" : "Sign in"}</span>
        <Tooltip text="Sign in with your Life Links email and password." />
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
  onDownloadPng,
  publicPresentation = false
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
  publicPresentation?: boolean;
}) {
  if (notFoundQrId) {
    return (
      <div className={publicPresentation ? "qr-detail public-qr-detail" : "qr-detail"}>
        <div className={publicPresentation ? "empty-state public-record-state" : "empty-state"}>
          <QrCode size={36} />
          <strong>QR not found</strong>
          <span>{notFoundQrId}</span>
        </div>
      </div>
    );
  }

  if (privateQrId) {
    return (
      <div className={publicPresentation ? "qr-detail public-qr-detail" : "qr-detail"}>
        <div className={publicPresentation ? "phone-page public-record-surface" : "phone-page"}>
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
    return (
      <div className={publicPresentation ? "qr-detail public-qr-detail" : "qr-detail"}>
        <div className={publicPresentation ? "empty-state public-record-state" : "empty-state"}>No QR selected.</div>
      </div>
    );
  }

  const project = projects.find((item) => item.id === link.projectId);
  const privateGuest = guestView && link.privacy === "private";

  return (
    <div className={publicPresentation ? "qr-detail public-qr-detail" : "qr-detail"}>
      <div className={publicPresentation ? "phone-page public-record-surface" : "phone-page"}>
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
            <div className="public-content-heading">
              <p className="project-label">{project?.name ?? "Life Link"}</p>
              {publicPresentation ? (
                <span className={link.privacy === "private" ? "public-state-chip private" : "public-state-chip"}>
                  {link.privacy === "private" ? <Lock size={14} /> : <Globe2 size={14} />}
                  {link.privacy === "private" ? "Owner-only" : "Owner shared"}
                </span>
              ) : null}
            </div>
            <h3>{link.title || "Untitled link"}</h3>
            <RichBodyRenderer body={link.body} bodyDoc={link.bodyDoc} />
            <MediaGallery media={link.media} title={link.title || link.id} />
            {publicPresentation ? (
              <p className={link.privacy === "private" ? "public-disclosure-note private" : "public-disclosure-note"}>
                {link.privacy === "private" ? <Lock size={16} /> : <ShieldCheck size={16} />}
                {link.privacy === "private"
                  ? "Visible only because the owner is signed in. This context is not public."
                  : "Only context intentionally published by the owner appears on this permanent page."}
              </p>
            ) : null}
          </article>
        )}
      </div>
      {publicPresentation ? null : (
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
      )}
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
      <div className="sample-scan-panel" aria-label="Sample scan shortcuts">
        <div className="sample-scan-heading">
          <strong>Sample scan shortcuts</strong>
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
