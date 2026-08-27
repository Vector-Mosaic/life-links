import { Bot, CircleAlert, ShieldCheck } from "lucide-react";

export type AgentAccessRegistrationStatus = "inactive" | "registering" | "ready" | "error";

export function AgentAccessPanel({
  supported,
  connected,
  busy,
  registrationStatus,
  registrationError,
  onConnect,
  onDisconnect
}: {
  supported: boolean;
  connected: boolean;
  busy: boolean;
  registrationStatus: AgentAccessRegistrationStatus;
  registrationError: string;
  onConnect(): void;
  onDisconnect(): void;
}) {
  const accessReady = supported && registrationStatus === "ready";
  return (
    <section className="panel agent-access-panel" aria-labelledby="agent-access-title">
      <header className="agent-access-heading">
        <div className="agent-access-title-group">
          <div className="panel-title">
            <Bot size={18} />
            <h3 id="agent-access-title">Agent Connection</h3>
          </div>
        </div>
        <button
          className={connected ? "secondary-button agent-connection-action" : "primary-button agent-connection-action"}
          type="button"
          disabled={busy}
          onClick={connected ? onDisconnect : onConnect}
        >
          {connected ? "Disconnect Agent" : "Connect Agent"}
        </button>
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
        <p className="agent-access-scope-item allowed">
          <strong>Available now:</strong> inspect, search, navigate, update Life Link content, and start Find Mode.
        </p>
        <p className="agent-access-scope-item connection">
          <strong>One connection:</strong> saved to your account until you explicitly disconnect it.
        </p>
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
