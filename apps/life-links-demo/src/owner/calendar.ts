import {
  materializeCalendarEventWindow,
  normalizeCalendarEventSpan,
  type CalendarProviderEventProjection,
  type ProviderEventSpan,
  type CalendarEventSpanInput,
  type CalendarEventInstance,
  type CalendarEventRevisionRecord,
  type CalendarRecord,
  type RoutineOccurrenceRecord,
  type RoutineSummaryRecord
} from "@life-links/core";
import type { CalendarEventDetail } from "../api";

export type CalendarView = "month" | "week" | "day" | "agenda";

export type CalendarRange = {
  startDate: string;
  endDate: string;
  days: string[];
};

export type CalendarDisplayEvent = {
  id: string;
  source: "native" | "routine" | "provider";
  providerEvent?: CalendarProviderEventProjection;
  eventId: string | null;
  routineId: string | null;
  occurrenceId: string | null;
  calendarId: string | null;
  title: string;
  description: string;
  location: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startInstant: string | null;
  endInstant: string | null;
  status: string;
  color: string;
  recurrence: CalendarEventRevisionRecord["recurrence"];
  revisionId: string | null;
};

export const CALENDAR_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function calendarRange(view: CalendarView, anchorDate: string): CalendarRange {
  const anchor = parseIsoDate(anchorDate);
  if (view === "day") return dateRange(anchor, anchor);
  if (view === "week") {
    const start = startOfWeek(anchor);
    return dateRange(start, addDays(start, 6));
  }
  if (view === "agenda") {
    return dateRange(anchor, addDays(anchor, 30));
  }
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
  const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12));
  return dateRange(startOfWeek(first), addDays(startOfWeek(last), 6));
}

export function calendarLoadRange(range: CalendarRange): Pick<CalendarRange, "startDate" | "endDate"> {
  return {
    startDate: toIsoDate(addDays(parseIsoDate(range.startDate), -1)),
    endDate: toIsoDate(addDays(parseIsoDate(range.endDate), 1))
  };
}

export function shiftCalendarAnchor(anchorDate: string, view: CalendarView, direction: -1 | 1): string {
  const anchor = parseIsoDate(anchorDate);
  if (view === "day") return toIsoDate(addDays(anchor, direction));
  if (view === "week") return toIsoDate(addDays(anchor, direction * 7));
  if (view === "agenda") return toIsoDate(addDays(anchor, direction * 31));
  return toIsoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1, 12)));
}

export function calendarTitle(view: CalendarView, anchorDate: string, timeZone: string): string {
  const anchor = parseIsoDate(anchorDate);
  if (view === "month") return formatDate(anchorDate, timeZone, { month: "long", year: "numeric" });
  if (view === "day") return formatDate(anchorDate, timeZone, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const range = calendarRange(view, anchorDate);
  const start = formatDate(range.startDate, timeZone, { month: "short", day: "numeric" });
  const end = formatDate(range.endDate, timeZone, { month: "short", day: "numeric", year: "numeric" });
  return view === "agenda" ? `${start} – ${end}` : `${start} – ${end}`;
}

export function localIsoDate(date = new Date(), timeZone = resolvedTimeZone()): string {
  return dateParts(date, timeZone).date;
}

export function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function supportedTimeZones(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  const zones = supportedValuesOf?.("timeZone") ?? [];
  const current = resolvedTimeZone();
  return [...new Set([current, "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", ...zones])];
}

export function buildCalendarDisplayEvents(input: {
  nativeEvents: readonly CalendarEventDetail[];
  providerEvents?: readonly CalendarProviderEventProjection[];
  routineOccurrences: readonly RoutineOccurrenceRecord[];
  routines: readonly RoutineSummaryRecord[];
  calendars: readonly CalendarRecord[];
  startDate: string;
  endDate: string;
  timeZone: string;
  visibleCalendarIds?: ReadonlySet<string>;
}): CalendarDisplayEvent[] {
  const calendarById = new Map(input.calendars.map((calendar) => [calendar.id, calendar]));
  const routineById = new Map(input.routines.map((routine) => [routine.id, routine]));

  const result: CalendarDisplayEvent[] = [];
  for (const projection of input.providerEvents ?? []) {
    const calendar = calendarById.get(projection.calendarId);
    if (!calendar || calendar.deletedAt || (input.visibleCalendarIds && !input.visibleCalendarIds.has(calendar.id))) continue;
    const content = projection.content;
    const span = content.span;
    const start = span.kind === "all_day" ? span.startDate : dateParts(new Date(span.startUtc), input.timeZone).date;
    const end = span.kind === "all_day" ? toIsoDate(addDays(parseIsoDate(span.endDateExclusive), -1)) : dateParts(new Date(span.endUtc), input.timeZone).date;
    if (end < input.startDate || start > input.endDate) continue;
    const days = span.kind === "all_day" ? dateRange(parseIsoDate(maxDate(start, input.startDate)), parseIsoDate(minDate(end, input.endDate))).days : [start];
    for (const date of days) result.push({
      id: JSON.stringify(["provider", projection.connectionId, projection.calendarId, projection.providerEventId, date]),
      source: "provider", providerEvent: projection, eventId: null, routineId: null, occurrenceId: null,
      calendarId: projection.calendarId, title: content.title, description: content.description ?? "", location: content.location ?? "",
      date, endDate: end, allDay: span.kind === "all_day", startInstant: span.kind === "timed" ? span.startUtc : null,
      endInstant: span.kind === "timed" ? span.endUtc : null, status: content.status, color: calendar.color, recurrence: null, revisionId: projection.providerRevision
    });
  }
  const definitions = input.nativeEvents.filter((detail) => {
    const calendar = calendarById.get(detail.event.calendarId);
    return Boolean(calendar && !calendar.deletedAt && (!input.visibleCalendarIds || input.visibleCalendarIds.has(calendar.id)));
  });
  for (const instance of materializeCalendarEventWindow({
    definitions,
    startDate: input.startDate,
    endDate: input.endDate,
    viewTimeZone: input.timeZone
  })) {
    const calendar = calendarById.get(instance.calendarId);
    if (!calendar) continue;
    result.push(...displayInstancesForMaterializedEvent(instance, calendar, input.startDate, input.endDate, input.timeZone));
  }

  for (const occurrence of input.routineOccurrences) {
    if (occurrence.status === "canceled") continue;
    const parts = dateParts(new Date(occurrence.plannedFor), input.timeZone);
    if (parts.date < input.startDate || parts.date > input.endDate) continue;
    result.push({
      id: `routine:${occurrence.id}`,
      source: "routine",
      eventId: null,
      routineId: occurrence.routineId,
      occurrenceId: occurrence.id,
      calendarId: null,
      title: routineById.get(occurrence.routineId)?.title ?? "Routine",
      description: "Planned Routine occurrence",
      location: "",
      date: parts.date,
      endDate: parts.date,
      allDay: false,
      startInstant: occurrence.plannedFor,
      endInstant: null,
      status: occurrence.status,
      color: "#4B78A3",
      recurrence: null,
      revisionId: null
    });
  }
  return result.sort(compareDisplayEvents);
}

export function formatCalendarTime(event: CalendarDisplayEvent, timeZone: string): string {
  if (event.allDay || !event.startInstant) return "All day";
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(event.startInstant));
}

export function providerEventCanMutate(event: CalendarProviderEventProjection): boolean {
  if (event.content.providerSeriesId !== null || event.content.providerRecurrence?.kind !== "single" ||
    event.content.outboundEffects?.attendeeCount !== 0 || event.content.outboundEffects.hasOnlineMeeting !== false) return false;
  const span = event.content.span;
  if (span.kind === "all_day") return true;
  const start = Date.parse(span.startUtc), end = Date.parse(span.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
    !/[zZ]$/.test(span.startUtc) || !/[zZ]$/.test(span.endUtc)) return false;
  // Adapters retain derived local clocks even for exact zoned UTC instants.
  // Only local clocks without a recorded source zone remain unresolved/floating.
  return (!span.floatingLocalStart && !span.floatingLocalEnd) ||
    (typeof span.sourceTimeZone === "string" && span.sourceTimeZone.trim().length > 0 && span.sourceTimeZone.length <= 256);
}

export function providerSpanForEditor(span: ProviderEventSpan) {
  if (span.kind === "all_day") return span;
  let timeZone = span.sourceTimeZone ?? "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { timeZone = "UTC"; }
  // Display the already-authoritative instants; re-resolving their local clocks could reject a valid DST fold.
  return { kind: "zoned" as const, startLocalDateTime: toLocalDateTimeInput(span.startUtc, timeZone), endLocalDateTime: toLocalDateTimeInput(span.endUtc, timeZone), timeZone,
    startInstant: span.startUtc, endInstant: span.endUtc };
}

export function providerWritableSpan(input: CalendarEventSpanInput): ProviderEventSpan {
  const span = normalizeCalendarEventSpan(input);
  return span.kind === "all_day" ? span : { kind: "timed", startUtc: span.startInstant, endUtc: span.endInstant,
    sourceTimeZone: span.timeZone, floatingLocalStart: null, floatingLocalEnd: null };
}

export function formatDate(date: string, _timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat([], { ...options, timeZone: "UTC" }).format(parseIsoDate(date));
}

export function eventStartDate(detail: CalendarEventDetail, timeZone: string): string {
  const span = detail.currentRevision.span;
  return span.kind === "all_day" ? span.startDate : dateParts(new Date(span.startInstant), timeZone).date;
}

export function toLocalDateTimeInput(isoInstant: string, timeZone: string): string {
  const parts = dateParts(new Date(isoInstant), timeZone);
  return `${parts.date}T${parts.time}`;
}

export function recurrenceSummary(rule: CalendarEventRevisionRecord["recurrence"]): string {
  if (!rule) return "Does not repeat";
  const cadence = rule.interval === 1 ? rule.frequency : `every ${rule.interval} ${rule.frequency === "daily" ? "days" : rule.frequency === "weekly" ? "weeks" : rule.frequency === "monthly" ? "months" : "years"}`;
  const detail = rule.frequency === "weekly" ? ` on ${rule.weekdays.map((day) => capitalize(day.slice(0, 3))).join(", ")}`
    : rule.frequency === "monthly" ? ` on day ${rule.monthDays.join(", ")}`
      : rule.frequency === "yearly" ? ` in month ${rule.months.join(", ")} on day ${rule.monthDays.join(", ")}` : "";
  const ending = rule.end.kind === "until" ? ` until ${rule.end.untilDate}` : rule.end.kind === "count" ? ` for ${rule.end.count} occurrences` : "";
  return `${rule.interval === 1 ? capitalize(cadence) : `Repeats ${cadence}`}${detail}${ending}`;
}

function displayInstancesForMaterializedEvent(
  instance: CalendarEventInstance,
  calendar: CalendarRecord,
  startDate: string,
  endDate: string,
  timeZone: string
): CalendarDisplayEvent[] {
  if (instance.span.kind === "all_day") {
    const visibleStart = maxDate(instance.span.startDate, startDate);
    const visibleEnd = minDate(toIsoDate(addDays(parseIsoDate(instance.span.endDateExclusive), -1)), endDate);
    if (visibleStart > visibleEnd) return [];
    return dateRange(parseIsoDate(visibleStart), parseIsoDate(visibleEnd)).days.map((date) =>
      displayEvent(instance, calendar, date, date, null, null, true));
  }
  const date = dateParts(new Date(instance.span.startInstant), timeZone).date;
  const finish = dateParts(new Date(instance.span.endInstant), timeZone).date;
  if (finish < startDate || date > endDate) return [];
  return [displayEvent(instance, calendar, date, finish, instance.span.startInstant, instance.span.endInstant, false)];
}

function displayEvent(
  instance: CalendarEventInstance,
  calendar: CalendarRecord,
  date: string,
  endDate: string,
  startInstant: string | null,
  endInstant: string | null,
  allDay: boolean,
): CalendarDisplayEvent {
  return {
    id: `native:${instance.instanceId}:${date}`,
    source: "native",
    eventId: instance.eventId,
    routineId: null,
    occurrenceId: null,
    calendarId: instance.calendarId,
    title: instance.title,
    description: instance.description,
    location: instance.location,
    date,
    endDate,
    allDay,
    startInstant,
    endInstant,
    status: instance.status,
    color: calendar.color,
    recurrence: null,
    revisionId: instance.revisionId
  };
}

function compareDisplayEvents(left: CalendarDisplayEvent, right: CalendarDisplayEvent): number {
  return left.date.localeCompare(right.date) || Number(right.allDay) - Number(left.allDay) ||
    (left.startInstant ?? "").localeCompare(right.startInstant ?? "") || left.id.localeCompare(right.id);
}

function dateRange(start: Date, end: Date): CalendarRange {
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) days.push(toIsoDate(cursor));
  return { startDate: days[0], endDate: days[days.length - 1], days };
}

function startOfWeek(date: Date): Date {
  return addDays(date, -date.getUTCDay());
}

function addDays(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount, 12));
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (toIsoDate(parsed) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return parsed;
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayDifference(start: string, end: string): number {
  return Math.round((parseIsoDate(end).valueOf() - parseIsoDate(start).valueOf()) / 86_400_000);
}

function dateParts(date: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}

function maxDate(left: string, right: string): string { return left > right ? left : right; }
function minDate(left: string, right: string): string { return left < right ? left : right; }
function capitalize(value: string): string { return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value; }
