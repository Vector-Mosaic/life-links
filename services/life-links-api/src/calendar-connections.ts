import { Router, type Request, type RequestHandler, type Response } from "express";
import { CalendarDomainError, type CalendarProviderAvailability } from "@life-links/core";

import { CalendarProviderGateway, CalendarProviderGatewayError } from "./calendar-provider-gateway.js";
import type { Logger } from "./logger.js";
import { assertHumanCalendarActor } from "./store.js";

export const CALENDAR_PROVIDER_AVAILABILITY: readonly CalendarProviderAvailability[] = [
  { providerKey: "google", displayName: "Google Calendar", authorizationAvailable: false, reason: "authorization_not_configured" },
  { providerKey: "microsoft", displayName: "Microsoft Outlook", authorizationAvailable: false, reason: "authorization_not_configured" }
];

/** Mounted inside the existing authenticated, origin-guarded, rate-limited application. */
export function createCalendarConnectionRouter(deps: {
  gateway: CalendarProviderGateway;
  requireAuthenticated: RequestHandler;
  ownerId: (request: Request) => string | null;
  logger: Logger;
}): Router {
  const router = Router();
  const route = (operation: (request: Request, response: Response, ownerId: string) => Promise<void>): RequestHandler =>
    async (request, response) => {
      const ownerId = deps.ownerId(request);
      if (!ownerId) { response.status(401).json({ error: "authentication_required" }); return; }
      try {
        const actor = request.get("X-Life-Links-Actor");
        if (actor !== undefined && actor !== "agent") {
          throw new CalendarProviderGatewayError("invalid_input", "Calendar actor is invalid.");
        }
        assertHumanCalendarActor(actor === "agent" ? "agent" : "human");
        await operation(request, response, ownerId);
      } catch (error) {
        const known = error instanceof CalendarProviderGatewayError || error instanceof CalendarDomainError;
        const code = known ? error.code : "calendar_connection_failed";
        const status = code === "calendar_access_denied" ? 403
          : code === "connection_not_found" || code === "calendar_not_found" ? 404
          : code === "calendar_settings_conflict" || code === "connection_inactive" ? 409
          : code === "provider_not_registered" ? 503
          : known ? 400 : 500;
        deps.logger[status >= 500 ? "error" : "warn"]("life_links.calendar_connection.rejected", {
          msg: "Calendar connection operation rejected",
          request_id: response.getHeader("X-Request-Id") ?? "unknown",
          reason: code,
          status
        });
        response.status(status).json({ error: code, retryable: code === "calendar_settings_conflict" });
      }
    };

  router.get("/api/calendar-providers", deps.requireAuthenticated, route(async (_request, response) => {
    response.json({ providers: CALENDAR_PROVIDER_AVAILABILITY });
  }));

  router.get("/api/calendar-connections", deps.requireAuthenticated, route(async (_request, response, ownerId) => {
    response.json({ connections: await deps.gateway.listConnections(ownerId) });
  }));

  router.get("/api/calendar-connections/:connectionId/calendars", deps.requireAuthenticated,
    route(async (request, response, ownerId) => {
      const connectionId = routeId(request.params.connectionId);
      response.json({
        connection: await deps.gateway.getConnection(ownerId, connectionId),
        calendars: await deps.gateway.listManagedCalendars(ownerId, connectionId)
      });
    }));

  router.patch("/api/calendar-connections/:connectionId/calendars/:calendarId", deps.requireAuthenticated,
    route(async (request, response, ownerId) => {
      const body = request.body;
      if (!plainObject(body) || typeof body.expectedUpdatedAt !== "string"
        || !Object.keys(body).some((key) => key === "visible" || key === "agentAccess")
        || Object.keys(body).some((key) => !["expectedUpdatedAt", "visible", "agentAccess"].includes(key))) {
        throw new CalendarProviderGatewayError("invalid_input", "Exact Calendar settings and revision are required.");
      }
      const calendar = await deps.gateway.updateCalendarSettings({
        ownerId,
        connectionId: routeId(request.params.connectionId),
        calendarId: routeId(request.params.calendarId),
        expectedUpdatedAt: body.expectedUpdatedAt,
        patch: {
          ...(body.visible === undefined ? {} : { visible: body.visible }),
          ...(body.agentAccess === undefined ? {} : { agentAccess: body.agentAccess })
        }
      });
      deps.logger.info("life_links.calendar_connection.settings_updated", {
        msg: "Calendar connection settings updated",
        request_id: response.getHeader("X-Request-Id") ?? "unknown"
      });
      response.json({ calendar });
    }));

  router.post("/api/calendar-connections/:connectionId/disconnect", deps.requireAuthenticated,
    route(async (request, response, ownerId) => {
      const body = request.body;
      if (!plainObject(body) || Object.keys(body).length !== 1
        || (body.localProjectionDisposition !== "purge" && body.localProjectionDisposition !== "retain_private_stale")) {
        throw new CalendarProviderGatewayError("invalid_input", "An explicit local projection disposition is required.");
      }
      const connection = await deps.gateway.disconnectConnection({
        ownerId,
        connectionId: routeId(request.params.connectionId),
        localProjectionDisposition: body.localProjectionDisposition
      });
      deps.logger.info("life_links.calendar_connection.disconnected", {
        msg: "Calendar connection closed locally",
        request_id: response.getHeader("X-Request-Id") ?? "unknown",
        remote_revocation_status: connection.remoteRevocationStatus
      });
      response.json({ connection });
    }));
  return router;
}

function routeId(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new CalendarProviderGatewayError("invalid_input", "An exact bounded connection or Calendar identity is required.");
  }
  return value;
}

function plainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
