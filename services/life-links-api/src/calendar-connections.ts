import { Router, type Request, type RequestHandler, type Response } from "express";
import { CalendarDomainError, type CalendarProviderAvailability } from "@life-links/core";

import { CalendarProviderGateway, CalendarProviderGatewayError, calendarProviderLocalCalendarId } from "./calendar-provider-gateway.js";
import type { Logger } from "./logger.js";
import { assertHumanCalendarActor } from "./store.js";
import { CalendarAuthorizationError, calendarAuthorizationProvider, type CalendarAuthorizationService } from "./calendar-authorization.js";

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
  authorization?: CalendarAuthorizationService;
  sessionIdentity?: (request: Request) => string | null;
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
        const known = error instanceof CalendarProviderGatewayError || error instanceof CalendarDomainError || error instanceof CalendarAuthorizationError;
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
    response.json({ providers: CALENDAR_PROVIDER_AVAILABILITY.map((provider) =>
      deps.authorization?.supportsProvider(provider.providerKey)
        ? { providerKey: provider.providerKey, displayName: provider.displayName, authorizationAvailable: true }
        : provider) });
  }));

  const authorization = () => {
    if (!deps.authorization) throw new CalendarAuthorizationError("authorization_unavailable");
    return deps.authorization;
  };
  const session = (request: Request) => {
    const identity = deps.sessionIdentity?.(request);
    if (!identity) throw new CalendarAuthorizationError("session_expired");
    return identity;
  };
  const beginAuthorization = (provider: "microsoft" | "google") => route(async (request, response, ownerId) => {
    if (!plainObject(request.body) || Object.keys(request.body).some((key) => key !== "reconnectConnectionId")) {
      throw new CalendarAuthorizationError("authorization_failed");
    }
    response.setHeader("Cache-Control", "no-store");
    response.json(await authorization().start(ownerId, session(request), request.body.reconnectConnectionId === undefined
      ? undefined : routeId(request.body.reconnectConnectionId), provider));
  });
  router.post("/api/calendar-providers/microsoft/authorize", deps.requireAuthenticated, beginAuthorization("microsoft"));
  router.post("/api/calendar-providers/google/authorize", deps.requireAuthenticated, beginAuthorization("google"));
  // Top-level GET retains the SameSite=Lax owner cookie. The one-use state is
  // bound to that exact initiating authenticated session, not merely an owner ID.
  const finishAuthorization = (provider: "microsoft" | "google"): RequestHandler => async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      const ownerId = deps.ownerId(request);
      if (!ownerId) throw new CalendarAuthorizationError("session_expired");
      const value = (key: string) => typeof request.query[key] === "string" ? request.query[key] as string : undefined;
      const id = await authorization().callback({ ownerId, sessionId: session(request), state: value("state") ?? "",
        code: value("code"), error: value("error"), provider });
      response.redirect(303, `/calendar?calendarAuthorization=${encodeURIComponent(id)}`);
    } catch (error) {
      const code = error instanceof CalendarAuthorizationError && ["cancelled", "session_expired"].includes(error.code)
        ? error.code : "authorization_failed";
      deps.logger.warn("life_links.calendar_authorization.rejected", { msg: "Calendar authorization did not complete", reason: code });
      response.redirect(303, `/calendar?calendarConnectionError=${code}`);
    }
  };
  router.get("/api/calendar-providers/microsoft/callback", finishAuthorization("microsoft"));
  router.get("/api/calendar-providers/google/callback", finishAuthorization("google"));
  router.get("/api/calendar-authorizations/:authorizationId/calendars", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(await authorization().discover(ownerId, session(request), routeId(request.params.authorizationId)));
  }));
  router.post("/api/calendar-authorizations/:authorizationId/complete", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    if (!plainObject(request.body) || Object.keys(request.body).length !== 1) throw new CalendarAuthorizationError("calendar_selection_invalid");
    response.json(await authorization().complete(ownerId, session(request), routeId(request.params.authorizationId), request.body.selectedCalendarIds));
  }));
  router.delete("/api/calendar-authorizations/:authorizationId", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    await authorization().cancel(ownerId, session(request), routeId(request.params.authorizationId));
    response.status(204).end();
  }));
  router.get("/api/calendar-connections/:connectionId/available-calendars", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    const discovery = await deps.gateway.discoverConnectionCalendars({ ownerId, connectionId: routeId(request.params.connectionId) });
    response.json({ providerKey: calendarAuthorizationProvider(discovery.providerKey), providerAccountId: discovery.providerAccountId,
      calendars: discovery.calendars.map((calendar) => ({ ...calendar, isDefault: calendar.isDefault === true })) });
  }));
  router.post("/api/calendar-connections/:connectionId/select", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    const connectionId = routeId(request.params.connectionId);
    const body = request.body;
    if (!plainObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.selectedCalendarIds)
      || !body.selectedCalendarIds.length || body.selectedCalendarIds.length > 50
      || body.selectedCalendarIds.some((id: unknown) => typeof id !== "string")
      || new Set(body.selectedCalendarIds).size !== body.selectedCalendarIds.length) throw new CalendarAuthorizationError("calendar_selection_invalid");
    const discovery = await deps.gateway.discoverConnectionCalendars({ ownerId, connectionId });
    const calendars = body.selectedCalendarIds.map((id: string) => {
      const remote = discovery.calendars.find((calendar) => calendar.providerCalendarId === id);
      if (!remote) throw new CalendarAuthorizationError("calendar_selection_invalid");
      return { calendarId: calendarProviderLocalCalendarId(connectionId, id),
        providerCalendarId: id, title: remote.displayName, color: "#4f8fbd", timeZone: remote.timeZone ?? "UTC", isDefault: false,
        visible: true, agentGrant: "none" as const };
    });
    await deps.gateway.selectExternalCalendars({ ownerId, connectionId, calendars, initialWindow: authorization().initialWindow() });
    response.json({ connection: await deps.gateway.getConnection(ownerId, connectionId), calendars: await deps.gateway.listManagedCalendars(ownerId, connectionId) });
  }));
  router.post("/api/calendar-connections/:connectionId/refresh", deps.requireAuthenticated, route(async (request, response, ownerId) => {
    const connectionId = routeId(request.params.connectionId);
    if (!plainObject(request.body) || Object.keys(request.body).some((key) => !["windowStart", "windowEnd"].includes(key))) {
      throw new CalendarAuthorizationError("calendar_selection_invalid");
    }
    const window = request.body.windowStart === undefined && request.body.windowEnd === undefined
      ? authorization().initialWindow() : { startUtc: request.body.windowStart, endUtc: request.body.windowEnd };
    for (const entry of await deps.gateway.listManagedCalendars(ownerId, connectionId)) {
      await deps.gateway.synchronizeCalendar({ ownerId, connectionId, calendarId: entry.calendar.id, window });
    }
    response.json({ refreshed: true });
  }));

  router.get("/api/calendar-connections", deps.requireAuthenticated, route(async (_request, response, ownerId) => {
    const connections = await deps.gateway.listConnections(ownerId);
    response.json({ connections: await Promise.all(connections.map(async (connection) => ({ ...connection,
      ...(deps.authorization && ["microsoft-graph-calendar", "google-calendar"].includes(connection.providerKey) ? {
        credentialStatus: await deps.authorization.credentialStatus(ownerId, connection.connectionId)
      } : {})
    }))) });
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
