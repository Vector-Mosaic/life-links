import { Bot, CircleAlert, ShieldCheck } from "lucide-react";

export type AgentAccessRegistrationStatus = "inactive" | "registering" | "ready" | "error";

export type RemoteAgentAuthorizationView = {
  status: "loading" | "ready" | "error";
  available: boolean;
  authorizedCount: number;
};

export function AgentAccessPanel({
  supported,
  connected,
  catalogCurrent,
  busy,
  registrationStatus,
  registrationError,
  remoteAuthorization,
  publicBaseUrl,
  onConnect,
  onDisconnect
}: {
  supported: boolean;
  connected: boolean;
  catalogCurrent: boolean;
  busy: boolean;
  registrationStatus: AgentAccessRegistrationStatus;
  registrationError: string;
  remoteAuthorization: RemoteAgentAuthorizationView;
  publicBaseUrl: string;
  onConnect(): void;
  onDisconnect(): void;
}) {
  const browserReady = connected && supported && registrationStatus === "ready";
  const browserUnavailable = connected && (!supported || registrationStatus === "error");
  const upgradeAvailable = connected && !catalogCurrent;
  const remoteEndpoint = new URL("/mcp", publicBaseUrl).href;
  const remoteConnectionsUrl = new URL("/agent-connections", publicBaseUrl).href;
  const remoteMessage = remoteAuthorizationMessage(remoteAuthorization);
  const remoteReady = remoteAuthorization.status === "ready" && remoteAuthorization.available && remoteAuthorization.authorizedCount > 0;
  const remoteUnavailable = remoteAuthorization.status === "error" || (remoteAuthorization.status === "ready" && !remoteAuthorization.available);
  return (
    <section className="panel agent-access-panel" aria-labelledby="agent-access-title">
      <header className="agent-access-heading">
        <div className="agent-access-title-group">
          <div className="panel-title">
            <Bot size={18} />
            <h3 id="agent-access-title">Agent connections</h3>
          </div>
        </div>
      </header>

      <section className="agent-connection-card" aria-labelledby="browser-webmcp-title">
        <header className="agent-access-heading agent-access-subheading">
          <div>
            <h4 id="browser-webmcp-title">Browser WebMCP</h4>
            <p>Lets compatible agents use LifeLinks tools through this open page.</p>
          </div>
          <div className="agent-connection-actions">
            {upgradeAvailable && <button
              className="primary-button agent-connection-action"
              type="button"
              disabled={busy}
              onClick={onConnect}
            >
              Update Browser WebMCP access
            </button>}
            <button
              className={connected ? "secondary-button agent-connection-action" : "primary-button agent-connection-action"}
              type="button"
              disabled={busy}
              onClick={connected ? onDisconnect : onConnect}
            >
              {connected ? "Disable Browser WebMCP" : "Enable Browser WebMCP"}
            </button>
          </div>
        </header>

        <div className={browserUnavailable ? "agent-access-status unavailable" : browserReady ? "agent-access-status ready" : "agent-access-status"} role={registrationStatus === "error" ? "alert" : "status"}>
          {browserUnavailable ? <CircleAlert size={17} aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}
          <span className="agent-access-status-copy">
            {browserRegistrationMessage(connected, supported, registrationStatus, registrationError)}
          </span>
        </div>

        {upgradeAvailable && <p className="agent-access-scope-item connection">
          <strong>Whole-app search is available:</strong> update this saved Browser WebMCP grant to add search across Life Links, Collections, Routines, completed session history, authorized Calendar events, and indexed document text, alongside the existing workspace tools. Existing access stays unchanged until you choose to update it. Each Calendar keeps its separate No access, Read only, or Read and edit choice.
        </p>}
        <div className="agent-access-scope">
          <p className="agent-access-scope-item allowed">
            <strong>Browser WebMCP tools can:</strong> find and open Life Links; create, move, and edit folders and items;
            manage QR codes and public fields; organize Collections and Sections; read supported attachments; start Find Mode;
            and, when granted, read and manage authorized Calendar events, move or remove Collection entries, find or remove Routines, and search records, completed session history, and indexed attachment text across the app.
            Deletions require one exact confirmation in the app. Routine removal retains history and resumable Runs.
          </p>
          <p className="agent-access-scope-item connection">
            <strong>Saved browser setting:</strong> this Browser WebMCP grant stays enabled until you turn it off.
            Its tools are available only in a supported browser while an authenticated LifeLinks page is open.
          </p>
        </div>
      </section>

      <section className="agent-connection-card" aria-labelledby="remote-mcp-title">
        <header className="agent-access-subheading">
          <div>
            <h4 id="remote-mcp-title">Remote MCP</h4>
            <p>A Remote MCP authorization lets its client use LifeLinks while this page is closed.</p>
          </div>
        </header>
        <div className={remoteReady ? "agent-access-status ready" : remoteUnavailable ? "agent-access-status unavailable" : "agent-access-status"}
          role={remoteAuthorization.status === "error" ? "alert" : "status"} aria-live="polite" aria-atomic="true">
          {remoteUnavailable
            ? <CircleAlert size={17} aria-hidden="true" />
            : <ShieldCheck size={17} aria-hidden="true" />}
          <span className="agent-access-status-copy">{remoteMessage}</span>
        </div>
        <p>Each remote authorization is managed and revoked separately. Authorization means a client may connect; it does not claim that the client is currently online.</p>
        <label>
          Remote MCP endpoint
          <input type="url" value={remoteEndpoint} readOnly aria-label="Remote MCP endpoint" />
        </label>
        <a href={remoteConnectionsUrl}>Manage remote connections</a>
      </section>
    </section>
  );
}

function browserRegistrationMessage(
  connected: boolean,
  supported: boolean,
  status: AgentAccessRegistrationStatus,
  error: string
) {
  if (!connected) {
    return "Not enabled. Enable Browser WebMCP to make LifeLinks tools available through a supported open page.";
  }
  if (!supported) {
    return "Enabled for your account, but this browser does not support Browser WebMCP.";
  }
  if (status === "registering") {
    return "Enabled · connecting tools on this page…";
  }
  if (status === "ready") {
    return "Enabled · active on this page.";
  }
  if (status === "error") {
    return error || "Enabled, but the tools could not be activated on this page.";
  }
  return "Enabled for your account. Open an eligible LifeLinks workspace to activate the tools on that page.";
}

function remoteAuthorizationMessage(remote: RemoteAgentAuthorizationView) {
  if (remote.status === "loading") return "Checking remote authorizations…";
  if (remote.status === "error") return "Remote authorization status is unavailable.";
  if (!remote.available) return "Remote MCP is unavailable on this server.";
  if (remote.authorizedCount === 0) return "No Remote MCP authorizations.";
  if (remote.authorizedCount === 1) return "1 Remote MCP authorization.";
  return `${remote.authorizedCount} Remote MCP authorizations.`;
}
