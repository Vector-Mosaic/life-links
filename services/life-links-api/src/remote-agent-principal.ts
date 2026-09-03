import { AsyncLocalStorage } from "node:async_hooks";

export type RemoteCapability = "records" | "collections" | "routines" | "calendar";
export const REMOTE_AGENT_SCOPES = ["records:read", "records:write", "collections:read", "collections:write",
  "routines:read", "routines:write", "calendar:read", "calendar:write"] as const;
export type RemoteAgentPrincipal = {
  ownerId: string; clientId: string; grantId: string; scopes: readonly string[]; expiresAt: number;
};
export type RemoteAuthorization = { capability: RemoteCapability; write: boolean; calendarId?: string };
export class RemoteAgentAccessError extends Error {
  constructor(readonly code = "remote_agent_access_denied") { super(code); }
}

// Only the authenticated server adapter enters this context. Neither HTTP actor
// headers nor tool arguments can create it. Canonical stores retain their page
// grant checks outside this scope and always retain per-Calendar permissions.
const execution = new AsyncLocalStorage<RemoteAgentPrincipal>();
export function runWithRemoteAgentPrincipal<T>(principal: RemoteAgentPrincipal, action: () => Promise<T>): Promise<T> {
  assertRemoteScope(principal, undefined);
  return execution.run(Object.freeze({ ...principal, scopes: Object.freeze([...principal.scopes]) }), action);
}
export function currentRemoteAgentPrincipal(): RemoteAgentPrincipal | undefined { return execution.getStore(); }
export function assertRemoteScope(principal: RemoteAgentPrincipal, authorization?: RemoteAuthorization): void {
  if (!principal.ownerId || !principal.clientId || !principal.grantId || principal.expiresAt <= Date.now()) {
    throw new RemoteAgentAccessError("remote_agent_authorization_expired");
  }
  if (authorization && !principal.scopes.includes(`${authorization.capability}:${authorization.write ? "write" : "read"}`)) {
    throw new RemoteAgentAccessError("remote_agent_insufficient_scope");
  }
}
export function remoteAgentScopeAllows(ownerId: string | undefined, capability?: RemoteCapability, write = false): boolean {
  const principal = execution.getStore();
  if (!principal) return false;
  if (principal.ownerId !== ownerId) throw new RemoteAgentAccessError();
  assertRemoteScope(principal, capability ? { capability, write } : undefined);
  return true;
}

export type RemoteApproval = {
  id: string; ownerId: string; clientId: string; grantId: string;
  operation: string; payload: Record<string, unknown>; effects: unknown;
  status: "pending" | "approved" | "declined" | "applied";
  createdAt: string; expiresAt: string; result?: unknown;
  /** Private component proof; never include in public preview fields or model-visible results. */
  uiChallenge?: string;
};
export interface RemoteApprovalService {
  prepare(principal: RemoteAgentPrincipal, input: { operation: string; payload: Record<string, unknown>; effects: unknown; id?: string }): Promise<RemoteApproval>;
  get(principal: RemoteAgentPrincipal, id: string): Promise<RemoteApproval>;
  locked<T>(principal: RemoteAgentPrincipal, id: string, action: () => Promise<T>): Promise<T>;
  /** Call inside locked(); issue/reuse proof without changing the pending preview expiry. */
  issueUiChallenge(principal: RemoteAgentPrincipal, id: string): Promise<string>;
  /** Call inside the pending confirmation callback under locked(); validation does not consume proof. */
  validateUiChallenge(principal: RemoteAgentPrincipal, id: string, challenge: unknown): Promise<void>;
  approve(principal: RemoteAgentPrincipal, id: string, accepted: boolean): Promise<RemoteApproval>;
  complete(principal: RemoteAgentPrincipal, id: string, result: unknown): Promise<RemoteApproval>;
}
export type RemoteOperationContext = RemoteAgentPrincipal & {
  signal?: AbortSignal;
  authorize(input: RemoteAuthorization): Promise<void>;
  requestConfirmation(input: { id: string; effects: unknown }): Promise<boolean>;
  approvals: RemoteApprovalService;
};
