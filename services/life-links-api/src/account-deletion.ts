import { Router, type Request, type Response, type RequestHandler } from "express";
import { AccountDeletionError, isSharedDemoAccount, type ProviderRevocationCleanup } from "./account-deletion-state.js";
import { CalendarProviderGatewayError, type CalendarProviderGateway } from "./calendar-provider-gateway.js";
import type { LifeLinksStore } from "./store.js";
import type { Logger } from "./logger.js";

type RevokeProviderCredential = (cleanup: ProviderRevocationCleanup) => Promise<void>;
/** Bounded cleanup uses the serving API's existing startup/periodic lifecycle. */
export async function drainProviderRevocationCleanup(store: LifeLinksStore, revoke: RevokeProviderCredential,
  limit = 10): Promise<string[]> {
  const completed: string[] = [];
  for (const row of await store.listProviderRevocationCleanup(limit)) {
    try {
      await revoke(row);
      await store.deleteProviderRevocationCleanup(row.id);
      completed.push(row.id);
    } catch { /* Preserve only the protected cleanup row for the next bounded sweep. */ }
  }
  return completed;
}

export function createAccountDeletionRouter(deps: {
  store: LifeLinksStore; logger: Logger; requireAuthenticated: RequestHandler;
  ownerId: (request: Request) => string | null;
  sessionTokenHash: (request: Request) => string | null;
  clearSession: (response: Response) => void;
  calendarGateway?: CalendarProviderGateway;
  revokeProviderCredential?: RevokeProviderCredential;
  clearRemoteOwner?: (ownerId: string) => Promise<void>;
}): Router {
  const router = Router();
  router.delete("/api/account", deps.requireAuthenticated, async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || body.confirmation !== "DELETE") {
      response.status(400).json({ error: "account_deletion_confirmation_required" }); return;
    }
    const ownerId = deps.ownerId(request), sessionTokenHash = deps.sessionTokenHash(request);
    try {
      if (!ownerId || !sessionTokenHash || (await deps.store.getSessionByTokenHash(sessionTokenHash))?.userId !== ownerId) {
        throw new AccountDeletionError("authentication_required", "session_required");
      }
      if (isSharedDemoAccount(ownerId)) throw new AccountDeletionError("account_deletion_unavailable", "shared_demo_account");
      if (deps.calendarGateway) {
        // Gateway removal owns dispatch reconciliation and credential/subscription
        // cleanup. It never deletes provider-owned events.
        for (const connection of await deps.calendarGateway.listConnections(ownerId)) {
          await deps.calendarGateway.removeCalendarConnection({ ownerId, connectionId: connection.connectionId,
            expectedConnectedAt: connection.connectedAt });
        }
      }
      const result = await deps.store.deleteAccount({ ownerId, sessionTokenHash });
      deps.clearSession(response);
      if (deps.clearRemoteOwner) {
        try { await deps.clearRemoteOwner(ownerId); }
        catch { deps.logger.warn("life_links.account_deletion.remote_cleanup_pending", { reason: "protocol_cleanup_pending" }); }
      }
      let appleRevocation: "not_required" | "pending" | "manual_required" | "complete" = result.appleRevocation;
      if (deps.revokeProviderCredential && result.revocationCleanupIds.length) {
        try {
          const completed = await drainProviderRevocationCleanup(deps.store, deps.revokeProviderCredential, 100);
          if (appleRevocation === "pending" && result.revocationCleanupIds.every(id => completed.includes(id))) appleRevocation = "complete";
        } catch { deps.logger.warn("life_links.account_deletion.apple_cleanup_pending", { reason: "provider_cleanup_pending" }); }
      }
      deps.logger.info("life_links.account_deleted", { apple_revocation: appleRevocation });
      response.json({ status: "deleted", appleRevocation });
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        response.status(error.code === "authentication_required" ? 401 : error.code === "account_deletion_pending" ? 409 : 403)
          .json({ error: error.code, reason: error.reason }); return;
      }
      if (error instanceof CalendarProviderGatewayError) {
        response.status(409).json({ error: "account_deletion_pending", reason: error.code === "command_in_progress"
          ? "calendar_write_in_progress" : "calendar_cleanup_pending" }); return;
      }
      next(error);
    }
  });
  return router;
}
