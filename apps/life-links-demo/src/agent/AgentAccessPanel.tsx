import { Bot, CircleAlert, ShieldCheck } from "lucide-react";

export type AgentAccessRegistrationStatus = "inactive" | "registering" | "ready" | "error";

export function AgentAccessPanel({
  supported,
  enabled,
  registrationStatus,
  registrationError,
  onEnabledChange
}: {
  supported: boolean;
  enabled: boolean;
  registrationStatus: AgentAccessRegistrationStatus;
  registrationError: string;
  onEnabledChange(enabled: boolean): void;
}) {
  const accessReady = supported && registrationStatus === "ready";
  return (
    <section className="panel agent-access-panel" aria-labelledby="agent-access-title">
      <div className="agent-access-heading">
        <div className="panel-title">
          <Bot size={18} />
          <h3 id="agent-access-title">Agent Access</h3>
        </div>
        <label className="agent-access-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!supported}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
          />
          <span>{enabled ? "On for this page session" : "Off"}</span>
        </label>
      </div>

      {!supported ? (
        <div className="agent-access-status unavailable" role="status">
          <CircleAlert size={17} />
          <span>WebMCP unavailable in this browser. The human workspace remains fully available.</span>
        </div>
      ) : (
        <div className={accessReady ? "agent-access-status ready" : "agent-access-status"} role="status">
          <ShieldCheck size={17} />
          <span>{registrationMessage(enabled, registrationStatus, registrationError)}</span>
        </div>
      )}

      <div className="agent-access-scope">
        <p><strong>Allowed:</strong> inspect, bounded search, visible navigation, revision-safe title/body updates, and Find Mode.</p>
        <p><strong>Never granted:</strong> privacy, hierarchy, QR, media, claim, delete, purchase, or batch changes.</p>
      </div>
    </section>
  );
}

function registrationMessage(
  enabled: boolean,
  status: AgentAccessRegistrationStatus,
  error: string
) {
  if (!enabled || status === "inactive") {
    return "Enable access to expose five page tools. Access resets on reload, logout, or leaving the owner workspace.";
  }
  if (status === "registering") {
    return "Registering the five Life Links page tools...";
  }
  if (status === "ready") {
    return "Five Life Links page tools are available to the agent in this live page.";
  }
  return error || "The page tools could not be registered. Turn Agent Access off, then try again.";
}
