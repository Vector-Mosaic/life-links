import type { Request, Response } from "express";
import {
  CalendarDomainError,
  normalizeCalendarId,
  resolveCalendarZonedDateTime,
  pageCollectionRecords,
  type CalendarActor,
  type CalendarProviderBindingView,
  type CalendarRecord,
  type ProviderEventContent,
  type ProviderCalendarEventWritableContent
} from "@life-links/core";

import { CalendarProviderGateway, CalendarProviderGatewayError } from "./calendar-provider-gateway.js";
import type { CalendarEventPageRequest } from "./store.js";
import type { Logger } from "./logger.js";

/** Adds provider dispatch to the existing event routes, never to native mutation storage. */
export async function handleProviderCalendarEventRequest(input: {
  request: Request;
  response: Response;
  gateway?: CalendarProviderGateway;
  ownerId: string;
  actor: CalendarActor;
  authorizeAgent: () => Promise<void>;
  page?: CalendarEventPageRequest;
  logger: Logger;
}): Promise<boolean> {
  const { request, response, ownerId, actor, authorizeAgent, logger } = input;
  const source = request.method === "GET" ? request.query : request.body;
  const authority = record(source) ? source.authority : undefined;
  if (authority === undefined) return false;
  if (authority !== "provider") throw invalid("invalid_event_authority");
  try {
    if (!input.gateway) throw new CalendarProviderGatewayError("provider_not_registered", "Provider event access is unavailable.");
    const gateway = input.gateway;
    if (actor === "agent") await authorizeAgent();
    const providerActor = actor === "agent" ? "agent" : "owner";
    const connectionId = identifier(source.connectionId, "connection_id");
    const calendarId = normalizeCalendarId(source.calendarId);
    const eventId = request.params.eventId === undefined ? null : identifier(request.params.eventId, "provider_event_id");
    if (request.method === "GET") {
      exactKeys(source, eventId === null
        ? ["authority", "connectionId", "calendarId", "startDate", "endDate", "cursor", "limit"]
        : ["authority", "connectionId", "calendarId"]);
      if (eventId === null) {
        const page = input.page;
        if (!page?.startDate || !page.endDate) throw invalid("calendar_date_window_required");
        // Admission precedes remote access. Date windows use this canonical
        // Calendar's zone, including DST, rather than assuming UTC midnight.
        await gateway.listProjections(ownerId, connectionId, calendarId, providerActor);
        const managed = (await gateway.listManagedCalendars(ownerId, connectionId))
          .find((entry) => entry.calendar.id === calendarId);
        if (!managed) throw new CalendarProviderGatewayError("calendar_not_found", "Calendar not found.");
        const nextDate = new Date(Date.parse(`${page.endDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
        const startUtc = resolveCalendarZonedDateTime(`${page.startDate}T00:00`, managed.calendar.timeZone);
        const endUtc = resolveCalendarZonedDateTime(`${nextDate}T00:00`, managed.calendar.timeZone);
        await gateway.synchronizeCalendar({ ownerId, connectionId, calendarId,
          window: { startUtc, endUtc }, actor: providerActor, authorizeAgent });
        const start = Date.parse(startUtc);
        const end = Date.parse(endUtc);
        const projections = await gateway.listProjections(ownerId, connectionId, calendarId, providerActor);
        const matches = projections.filter(({ content }) => content.span.kind === "all_day"
          ? content.span.startDate <= page.endDate! && content.span.endDateExclusive > page.startDate!
          : Date.parse(content.span.startUtc) < end && Date.parse(content.span.endUtc) > start)
          .sort((left, right) => {
            const leftStart = left.content.span.kind === "timed" ? left.content.span.startUtc : left.content.span.startDate;
            const rightStart = right.content.span.kind === "timed" ? right.content.span.startUtc : right.content.span.startDate;
            return leftStart.localeCompare(rightStart) || left.providerEventId.localeCompare(right.providerEventId);
          });
        const paged = pageCollectionRecords(matches.map((projection) => ({ id: projection.providerEventId, projection })), page);
        if (actor === "agent") await authorizeAgent();
        response.json({ providerEvents: paged.items.map(({ projection }) => projection), nextCursor: paged.nextCursor, truncated: paged.truncated });
      } else {
        const projection = await gateway.getProjection(ownerId, connectionId, calendarId, eventId, providerActor);
        if (!projection) throw new CalendarDomainError("calendar_event_not_found", "Provider Calendar event not found.");
        if (actor === "agent") await authorizeAgent();
        response.json({ providerEvent: projection });
      }
      return true;
    }
    const kind = request.method === "POST" && eventId === null ? "create"
      : request.method === "PATCH" && eventId !== null ? "update"
      : request.method === "DELETE" && eventId !== null ? "delete" : null;
    if (!kind) throw invalid("unsupported_provider_event_operation");
    exactKeys(source, ["authority", "commandId", "connectionId", "calendarId",
      ...(kind === "create" ? [] : ["expectedProviderRevision", "scope"]),
      ...(kind === "delete" ? [] : ["content"])]);
    const commandId = identifier(source.commandId, "command_id");
    if (kind !== "create" && source.scope !== "event") throw invalid("unsupported_provider_recurrence_scope");
    const base = { commandId, ownerId, connectionId, calendarId, actor: providerActor as "owner" | "agent" };
    const revision = kind === "create" ? null : identifier(source.expectedProviderRevision, "provider_revision");
    if (kind !== "create") {
      const current = await gateway.getProjection(ownerId, connectionId, calendarId, eventId!, providerActor);
      // A missing projection may be an exact successful-delete replay. The
      // gateway's durable command identity and provider readback remain decisive.
      if (current) {
        if (current.content.providerSeriesId !== null || current.content.providerRecurrence?.kind !== "single") {
          throw invalid("unsupported_provider_recurrence_scope");
        }
        const effects = current.content.outboundEffects;
        if (!effects || effects.attendeeCount !== 0 || effects.hasOnlineMeeting) {
          throw invalid("unsupported_provider_outbound_effects");
        }
      }
    }
    const result = await gateway.executeCommand(kind === "create"
      ? { ...base, kind, content: writableContent(source.content) }
      : kind === "update"
        ? { ...base, kind, providerEventId: eventId!, expectedProviderRevision: revision!, content: writableContent(source.content) }
        : { ...base, kind, providerEventId: eventId!, expectedProviderRevision: revision! },
    { authorizeAgent });
    logger.info("life_links.calendar.provider_event_applied", {
      msg: "Provider Calendar event command read back",
      request_id: response.getHeader("X-Request-Id") ?? "unknown",
      operation: kind,
      actor,
      recurrence_scope: "event"
    });
    if (result.kind === "delete") {
      response.json({ authority: "provider", kind: "delete", connectionId, calendarId,
        providerEventId: result.providerEventId, deletedProviderRevision: result.deletedProviderRevision });
    } else {
      response.status(kind === "create" ? 201 : 200).json({ providerEvent: result.event });
    }
    return true;
  } catch (error) {
    if (!(error instanceof CalendarProviderGatewayError)) throw error;
    const status = providerErrorStatus(error.code);
    logger[status >= 500 ? "error" : "warn"]("life_links.calendar.provider_event_rejected", {
      msg: "Provider Calendar event operation refused",
      request_id: response.getHeader("X-Request-Id") ?? "unknown", reason: error.code, status
    });
    response.status(status).json({ error: {
      code: error.code,
      message: "Provider Calendar operation could not be completed.",
      retryable: ["provider_revision_conflict", "sync_state_conflict", "command_in_progress", "provider_retry_later", "outbox_lease_lost"].includes(error.code)
    } });
    return true;
  }
}

/** Already authenticated Calendar listing enriches only the returned authorized IDs. */
export async function listProviderCalendarBindings(input: {
  gateway?: CalendarProviderGateway;
  calendars: CalendarRecord[];
  ownerId: string;
  actor: CalendarActor;
}): Promise<CalendarProviderBindingView[]> {
  if (!input.gateway || !input.calendars.some((calendar) => calendar.source === "external")) return [];
  const allowed = new Set(input.calendars.filter((calendar) => calendar.source === "external" && !calendar.deletedAt).map((calendar) => calendar.id));
  const result: CalendarProviderBindingView[] = [];
  for (const connection of await input.gateway.listConnections(input.ownerId)) {
    if (connection.status !== "active") continue;
    for (const binding of await input.gateway.listCalendars(input.ownerId, connection.connectionId, input.actor === "agent" ? "agent" : "owner")) {
      if (!allowed.has(binding.calendarId)) continue;
      result.push({ calendarId: binding.calendarId, connectionId: binding.connectionId,
        providerKey: binding.providerKey, providerAccountId: binding.providerAccountId,
        providerCalendarId: binding.providerCalendarId, capabilities: binding.capabilities, visible: binding.visible });
    }
  }
  return result;
}

function writableContent(value: unknown): ProviderEventContent {
  exactKeys(value, ["title", "description", "location", "span", "status"]);
  const content = value as unknown as ProviderCalendarEventWritableContent;
  exactKeys(content.span, content.span?.kind === "timed"
    ? ["kind", "startUtc", "endUtc", "sourceTimeZone", "floatingLocalStart", "floatingLocalEnd"]
    : ["kind", "startDate", "endDateExclusive"]);
  return { ...content, providerSeriesId: null,
    providerRecurrence: { kind: "single", originalStartUtc: null },
    outboundEffects: { attendeeCount: 0, hasOnlineMeeting: false } };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function exactKeys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw invalid("unsupported_provider_event_fields");
}
function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw invalid(`invalid_${name}`);
  return value;
}
function invalid(reason: string): CalendarDomainError {
  return new CalendarDomainError("invalid_calendar_event", "Provider Calendar event input is invalid.", { reason });
}
function providerErrorStatus(code: CalendarProviderGatewayError["code"]): number {
  if (["connection_not_found", "calendar_not_found"].includes(code)) return 404;
  if (["agent_calendar_access_denied", "calendar_read_only", "provider_event_read_only"].includes(code)) return 403;
  if (["provider_revision_conflict", "idempotency_conflict", "calendar_settings_conflict", "sync_state_conflict", "connection_inactive", "command_in_progress"].includes(code)) return 409;
  if (["provider_not_registered", "provider_retry_later", "outbox_lease_lost", "provider_readback_failed"].includes(code)) return 503;
  return 400;
}
