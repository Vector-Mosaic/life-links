import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Camera,
  Check,
  Download,
  FolderOpen,
  Globe2,
  Layers,
  Lock,
  LogIn,
  Pencil,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import {
  type LinkRecord,
  buildQrUrl
} from "@life-links/core";
import { AgentAccessPanel, type AgentAccessRegistrationStatus } from "./agent/AgentAccessPanel";
import { AgentActivityPanel } from "./agent/AgentActivityPanel";
import {
  instrumentAgentToolCatalog,
  type AgentActivityEntry
} from "./agent/activity";
import { getBrowserWebMcpHost } from "./agent/browserWebMcpHost";
import { createLifeLinksAgentToolCatalog } from "./agent/toolHandlers";
import { LIFE_LINKS_SEARCH_TOOL_CATALOG_ID } from "./agent/searchToolHandlers";
import {
  agentConnectionIsActive,
  usePageToolRegistration
} from "./agent/usePageToolRegistration";
import { LifeLinkEditor } from "./owner/LifeLinkEditor";
import { LifeLinksGlyph } from "./owner/FieldLedgerPrimitives";
import { OwnerWorkspace } from "./owner/OwnerWorkspace";
import { ContextFields } from "./owner/LifeLinkDetail";
import { AttachmentList } from "./owner/AttachmentList";
import { RichBodyRenderer } from "./richBody";
import { Tooltip } from "./ui/Tooltip";
import { LifeLinksWorkspaceProvider, useLifeLinksWorkspace } from "./workspace/LifeLinksWorkspaceProvider";
import { classifyLifeLinksRoute } from "./workspace/routes";

type Html5QrcodeScanner = InstanceType<typeof import("html5-qrcode").Html5Qrcode>;

type CameraMode = "open" | "find";

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
    currentUser, agentConnection, qrBaseUrl, links, activeQrId, publicQrState,
    findTargetId, guestView, loading, busy, error, theme, routePathname,
    canonicalEditingId, selectedLifeLinkDetail
  } = snapshot; const [agentActivities, setAgentActivities] = useState<AgentActivityEntry[]>([]);
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

  const agentToolsActive = agentConnectionIsActive(
    agentConnection.connected,
    currentUser?.id ?? null,
    route.surface,
    guestView
  );
  agentActivityEligibleRef.current = agentToolsActive;
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
      agentConnected: agentConnection.connected && !guestView,
      catalogId: agentConnection.toolCatalogId
    }
  });

  useEffect(() => {
    setAgentActivities([]);
  }, [agentConnection.connected, currentUser?.id, guestView, route.surface]);
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
  const handleLogin = (email: string, password: string) => controller.login(email, password);
  const handleLogout = () => {
    agentActivityEligibleRef.current = false;
    setAgentActivities([]);
    return controller.logout();
  };
  const handleOpenScan = (scanText: string) => controller.scanQr(scanText);
  const handleFindScan = (scanText: string) => controller.evaluateFindScan(scanText);
  const claimActiveLink = () => controller.claimActiveLink();
  const connectAgent = () => controller.connectAgent();
  const disconnectAgent = () => controller.disconnectAgent();
  const agentRegistrationStatus: AgentAccessRegistrationStatus =
    registration.status === "registered"
      ? "ready"
      : registration.status === "registering"
        ? "registering"
        : registration.status === "error"
          ? "error"
          : "inactive";
  const agentRegistrationError = registration.status === "error" ? registration.error.message : "";

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
    <>
      <OwnerWorkspace
        controller={controller}
        snapshot={snapshot}
        headingRef={ownerWorkspaceHeadingRef}
        onLogout={() => void handleLogout()}
        scannerPanel={<ScannerPanel mode="open" baseUrl={qrBaseUrl} sampleLinks={[]} targetId={null} onDecoded={(value) => void handleOpenScan(value)} />}
        findScannerPanel={<ScannerPanel mode="find" baseUrl={qrBaseUrl} sampleLinks={[]} targetId={findTargetId} onDecoded={(value) => void handleFindScan(value)} />}
        agentPanel={<>
          <AgentAccessPanel supported={webMcpSupported} connected={agentConnection.connected} busy={busy}
            publicBaseUrl={qrBaseUrl}
            catalogCurrent={agentConnection.toolCatalogId === LIFE_LINKS_SEARCH_TOOL_CATALOG_ID}
            registrationStatus={agentRegistrationStatus} registrationError={agentRegistrationError}
            onConnect={() => void connectAgent()} onDisconnect={() => void disconnectAgent()} />
          <AgentActivityPanel activities={agentActivities} />
        </>}
      />
      {canonicalEditingId && (
        <LifeLinkEditor mode="canonical"
          link={selectedLifeLinkDetail?.lifeLink.id === canonicalEditingId ? selectedLifeLinkDetail.lifeLink : null}
          busy={busy}
          onClose={() => controller.closeCanonicalEditor()}
          onSave={(lifeLinkId, expectedUpdatedAt, patch) => void controller.saveCanonicalLifeLink(lifeLinkId, expectedUpdatedAt, patch)}
          onUploadMedia={(lifeLinkId, files) => void controller.uploadCanonicalMedia(lifeLinkId, files)}
          onDeleteMedia={(lifeLinkId, mediaId) => void controller.removeCanonicalMedia(lifeLinkId, mediaId)}
        />
      )}
    </>
  );
}

function LoginScreen({ error, busy, onLogin }: { error: string; busy: boolean; onLogin: (email: string, password: string) => void }) {
  return (
    <div className="login-shell">
      <h1 className="ll-brand ll-login-brand">LifeLinks <LifeLinksGlyph /></h1>
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
          onClaim={onClaim}
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

function QrDetail({
  link, privateQrId, notFoundQrId, onClaim
}: {
  link: LinkRecord | null;
  privateQrId: string | null;
  notFoundQrId: string | null;
  onClaim: () => void;
}) {
  if (notFoundQrId) {
    return (
      <div className="qr-detail public-qr-detail">
        <div className="empty-state public-record-state">
          <QrCode size={36} />
          <strong>QR not found</strong>
          <span>{notFoundQrId}</span>
        </div>
      </div>
    );
  }

  if (privateQrId) {
    return (
      <div className="qr-detail public-qr-detail">
        <div className="phone-page public-record-surface">
          <div className="phone-bar"><span>{privateQrId}</span><span>Private</span></div>
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
    return <div className="qr-detail public-qr-detail"><div className="empty-state public-record-state">No QR selected.</div></div>;
  }

  return (
    <div className="qr-detail public-qr-detail">
      <div className="phone-page public-record-surface">
        <div className="phone-bar"><span>{link.id}</span><span>{link.privacy === "private" ? "Private" : "Public"}</span></div>
        {link.status === "unclaimed" ? (
          <div className="claim-screen">
            <QrPreview url={link.url} />
            <h3>Unclaimed link</h3>
            <button className="primary-button" onClick={onClaim} data-tooltip="Claim this unclaimed QR into the signed-in account.">
              <ShieldCheck size={18} /><span>Claim</span>
              <Tooltip text="Claim this unclaimed QR into the signed-in account." />
            </button>
          </div>
        ) : (
          <article className="public-content">
            <div className="public-content-heading">
              <p className="record-label">Life Link</p>
              <span className={link.privacy === "private" ? "public-state-chip private" : "public-state-chip"}>
                {link.privacy === "private" ? <Lock size={14} /> : <Globe2 size={14} />}
                {link.privacy === "private" ? "Owner-only" : "Owner shared"}
              </span>
            </div>
            <h3>{link.title || "Untitled link"}</h3>
            <ContextFields context={link.context} />
            <RichBodyRenderer body={link.body} bodyDoc={link.bodyDoc} />
            <MediaGallery media={link.media} title={link.title || link.id} />
            <p className={link.privacy === "private" ? "public-disclosure-note private" : "public-disclosure-note"}>
              {link.privacy === "private" ? <Lock size={16} /> : <ShieldCheck size={16} />}
              {link.privacy === "private"
                ? "Visible only because the owner is signed in. This context is not public."
                : "Only context intentionally published by the owner appears on this permanent page."}
            </p>
          </article>
        )}
      </div>
    </div>
  );
}

function MediaGallery({ media }: { media: LinkRecord["media"]; title: string }) {
  if (!media.length) {
    return null;
  }

  return (
    <section className="media-gallery" aria-label="Attachments"><h4>Attachments</h4><AttachmentList attachments={media} /></section>
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
  const cameraSupported = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

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
        {cameraSupported && <button
          className="primary-button"
          onClick={cameraActive ? stopCamera : startCamera}
          data-tooltip={cameraActive ? "Stop the browser camera scanner." : "Start the browser camera scanner."}
        >
          <Camera size={18} />
          <span>{cameraActive ? "Stop" : "Camera"}</span>
          <Tooltip text={cameraActive ? "Stop the browser camera scanner." : "Start the browser camera scanner."} />
        </button>}
        {targetId && sampleLinks.length > 0 && (
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
      {!cameraSupported && <p className="inline-note">Camera scanning is unavailable in this browser. Use the QR code or URL field.</p>}
      {sampleLinks.length > 0 && <div className="sample-scan-panel" aria-label="Sample scan shortcuts">
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
      </div>}
    </div>
  );
}
