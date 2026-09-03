import { Bot, CircleAlert, ShieldCheck } from "lucide-react";

export type AgentAccessRegistrationStatus = "inactive" | "registering" | "ready" | "error";

export function AgentAccessPanel({
  supported,
  connected,
  catalogCurrent,
  busy,
  registrationStatus,
  registrationError,
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
  publicBaseUrl: string;
  onConnect(): void;
  onDisconnect(): void;
}) {
  const accessReady = supported && registrationStatus === "ready";
  const upgradeAvailable = connected && !catalogCurrent;
  const remoteEndpoint = new URL("/mcp", publicBaseUrl).href;
  const remoteConnectionsUrl = new URL("/agent-connections", publicBaseUrl).href;
  return (
    <section className="panel agent-access-panel" aria-labelledby="agent-access-title">
      <header className="agent-access-heading">
        <div className="agent-access-title-group">
          <div className="panel-title">
            <Bot size={18} />
            <h3 id="agent-access-title">Agent Connection</h3>
          </div>
        </div>
        <div className="agent-connection-actions">
          {upgradeAvailable && <button
            className="primary-button agent-connection-action"
            type="button"
            disabled={busy}
            onClick={onConnect}
          >
            Update Agent Access
          </button>}
          <button
            className={connected ? "secondary-button agent-connection-action" : "primary-button agent-connection-action"}
            type="button"
            disabled={busy}
            onClick={connected ? onDisconnect : onConnect}
          >
            {connected ? "Disconnect Agent" : "Connect Agent"}
          </button>
        </div>
      </header>

      {!supported ? (
        <div className="agent-access-status unavailable" role="status">
          <CircleAlert size={17} />
          <span className="agent-access-status-copy">
            {connected
              ? "Connected until you disconnect. This browser does not expose the agent tools, but your saved connection remains active."
              : "WebMCP tools are unavailable in this browser. You can still save the connection here and use it from a supported agent browser."}
          </span>
        </div>
      ) : (
        <div className={accessReady ? "agent-access-status ready" : "agent-access-status"} role="status">
          <ShieldCheck size={17} />
          <span className="agent-access-status-copy">
            {registrationMessage(connected, registrationStatus, registrationError)}
          </span>
        </div>
      )}

      <div className="agent-access-scope">
        {upgradeAvailable && <p className="agent-access-scope-item connection">
          <strong>Whole-app search is available:</strong> update this saved connection to add search across Life Links, Collections, Routines, completed session history, authorized Calendar events, and indexed document text, alongside the existing workspace tools. Existing access stays unchanged until you choose to update it. Each Calendar keeps its separate No access, Read only, or Read and edit choice.
        </p>}
        <p className="agent-access-scope-item allowed">
          <strong>Your agent can:</strong> find and open Life Links; create, move, and edit folders and items;
          manage QR codes and public fields; organize Collections and Sections; read supported attachments; start Find Mode;
          and, when granted, read and manage authorized Calendar events, move or remove Collection entries, find or remove Routines, and search records, completed session history, and indexed attachment text across the app.
          Deletions require one exact confirmation in the app. Routine removal retains history and resumable Runs.
        </p>
        <p className="agent-access-scope-item connection">
          <strong>Browser connection:</strong> saved to your account until you explicitly disconnect it.
          Browser tools require this Life Links page to stay open. The buttons above control only this browser-tool connection.
        </p>
      </div>
      <div className="agent-access-scope-item connection">
        <p><strong>Remote agent connection</strong></p>
        <p>Connect from a compatible agent using this endpoint. After you authorize that client,
          it can use Life Links with this page closed. Its access is managed separately from browser tools.</p>
        <label>
          Remote MCP endpoint
          <input type="url" value={remoteEndpoint} readOnly aria-label="Remote MCP endpoint" />
        </label>
        <a href={remoteConnectionsUrl}>Manage remote connections</a>
      </div>
    </section>
  );
}

function registrationMessage(
  connected: boolean,
  status: AgentAccessRegistrationStatus,
  error: string
) {
  if (!connected || status === "inactive") {
    return "Connect your agent once. Life Links remembers the connection until you disconnect it.";
  }
  if (status === "registering") {
    return "Connecting your saved agent to this Life Links workspace...";
  }
  if (status === "ready") {
    return "Connected until you disconnect. Life Links tools are available to your agent.";
  }
  return error || "Your connection is saved, but this browser could not make the Life Links tools available.";
}
