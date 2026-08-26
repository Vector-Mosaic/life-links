import { Activity, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";

import { agentActivityLabel, type AgentActivityEntry } from "./activity";

export function AgentActivityPanel({ activities }: { activities: readonly AgentActivityEntry[] }) {
  return (
    <section className="panel agent-activity-panel" aria-labelledby="agent-activity-title">
      <div className="panel-title">
        <Activity size={18} />
        <h3 id="agent-activity-title">Agent activity</h3>
      </div>
      <p className="panel-help">Page-session activity only. Content and raw tool arguments are not retained.</p>
      {activities.length ? (
        <ol className="agent-activity-list">
          {activities.map((entry) => (
            <li key={entry.id} className={`agent-activity-item ${entry.outcome}`}>
              {entry.outcome === "succeeded" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
              <div>
                <strong>{agentActivityLabel(entry)}</strong>
                <span>
                  <Clock3 size={13} />
                  {formatActivityTime(entry.occurredAt)}
                  {entry.affectedLifeLinkIds.length
                    ? ` · ${entry.affectedLifeLinkIds.length} stable ID${entry.affectedLifeLinkIds.length === 1 ? "" : "s"}`
                    : ""}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="agent-activity-empty">No agent tool activity in this page session.</p>
      )}
    </section>
  );
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "now"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
