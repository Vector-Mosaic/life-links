import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./limits.js";
import type { CalendarProviderCapabilities } from "./calendar-connections.js";

export const CALENDAR_ID_PREFIX = "calendar-";
export const CALENDAR_EVENT_ID_PREFIX = "calendar-event-";
export const CALENDAR_EVENT_REVISION_ID_PREFIX = "calendar-event-revision-";
export const CALENDAR_EVENT_TOMBSTONE_ID_PREFIX = "calendar-event-tombstone-";

export const MAX_CALENDAR_LOCATION_LENGTH = 500;
export const MAX_CALENDAR_RECURRENCE_INTERVAL = 366;
export const MAX_CALENDAR_RECURRENCE_COUNT = 10_000;
export const MAX_CALENDAR_SUBJECT_LINKS = 32;
export const MAX_CALENDAR_MATERIALIZATION_DAYS = 366;
export const MAX_CALENDAR_MATERIALIZED_INSTANCES = 10_000;

export const CALENDAR_DOMAIN_ERROR_CODES = [
  "invalid_calendar",
  "calendar_not_found",
  "invalid_calendar_event",
  "calendar_event_not_found",
  "calendar_access_denied",
  "stale_calendar",
  "stale_calendar_event",
  "calendar_conflict",
  "calendar_reference_conflict"
] as const;

export type CalendarDomainErrorCode = (typeof CALENDAR_DOMAIN_ERROR_CODES)[number];

export class CalendarDomainError extends Error {
  readonly code: CalendarDomainErrorCode;
  readonly retryable: boolean;
  readonly reason?: string;

  constructor(code: CalendarDomainErrorCode, message: string, options: { retryable?: boolean; reason?: string } = {}) {
    super(message);
    this.name = "CalendarDomainError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.reason = options.reason;
  }
}

export type CalendarSource = "native" | "external";
export type CalendarAgentAccess = "none" | "read" | "write";
export type CalendarActor = "human" | "agent";

/** Provider observations are not native event revisions or editable provider credentials. */
export type ProviderTimedEventSpan = {
  kind: "timed";
  startUtc: string;
  endUtc: string;
  sourceTimeZone: string | null;
  floatingLocalStart: string | null;
  floatingLocalEnd: string | null;
};
export type ProviderAllDayEventSpan = { kind: "all_day"; startDate: string; endDateExclusive: string };
export type ProviderEventSpan = ProviderTimedEventSpan | ProviderAllDayEventSpan;
export type ProviderEventContent = {
  title: string;
  description: string | null;
  location: string | null;
  span: ProviderEventSpan;
  providerSeriesId: string | null;
  status: "confirmed" | "tentative" | "canceled";
  providerRecurrence?: { kind: "single" | "series_master" | "occurrence" | "exception"; originalStartUtc: string | null };
  outboundEffects?: { attendeeCount: number; hasOnlineMeeting: boolean };
};
export type ProviderEventSnapshot = {
  providerEventId: string;
  providerRevision: string;
  content: ProviderEventContent;
  /** Only authoritative provider evidence may establish a deliberate restore. */
  revivesProviderRevision?: string;
};
export type CalendarProviderEventProjection = {
  ownerId: string;
  connectionId: string;
  calendarId: string;
  providerKey: string;
  providerAccountId: string;
  providerCalendarId: string;
  providerEventId: string;
  providerRevision: string;
  content: ProviderEventContent;
  synchronizedAt: string;
};
/** Metadata is filtered against the same Calendar grant as the returned Calendar. */
export type CalendarProviderBindingView = Pick<CalendarProviderEventProjection,
  "calendarId" | "connectionId" | "providerKey" | "providerAccountId" | "providerCalendarId"
> & { capabilities: CalendarProviderCapabilities; visible: boolean };
export type ProviderCalendarEventReference = {
  authority: "provider";
  connectionId: string;
  calendarId: string;
  providerEventId: string;
};
export type ProviderCalendarEventWritableContent = Pick<ProviderEventContent,
  "title" | "description" | "location" | "span" | "status"
>;
export type ProviderCalendarEventCreateInput = {
  authority: "provider";
  commandId: string;
  connectionId: string;
  calendarId: string;
  content: ProviderCalendarEventWritableContent;
};
/** Recurring provider writes remain refused until their explicit scoped lane is qualified. */
export type ProviderCalendarEventUpdateInput = ProviderCalendarEventCreateInput & {
  expectedProviderRevision: string;
  scope: "event";
};
export type ProviderCalendarEventDeleteInput = Omit<ProviderCalendarEventUpdateInput, "content">;
export type ProviderCalendarEventQueryInput = {
  authority: "provider";
  connectionId: string;
  calendarId: string;
  startDate: string;
  endDate: string;
  cursor?: string | null;
  limit?: number;
};
export type ProviderCalendarEventPage = {
  providerEvents: CalendarProviderEventProjection[];
  nextCursor: string | null;
  truncated: boolean;
};
export type ProviderCalendarEventResponse = { providerEvent: CalendarProviderEventProjection };
export type ProviderCalendarEventDeletionResponse = {
  authority: "provider";
  kind: "delete";
  connectionId: string;
  calendarId: string;
  providerEventId: string;
  deletedProviderRevision: string;
};

export type CalendarRecord = {
  id: string;
  ownerId: string;
  title: string;
  color: string;
  timeZone: string;
  source: CalendarSource;
  agentAccess: CalendarAgentAccess;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CreateCalendarCommand = {
  id: string;
  ownerId: string;
  title: string;
  color?: string;
  timeZone: string;
  isDefault?: boolean;
  agentAccess?: CalendarAgentAccess;
  createdAt: string;
};

export type CreateExternalCalendarCommand = CreateCalendarCommand;

export type CalendarPatch = Partial<Pick<CalendarRecord, "title" | "color" | "timeZone" | "isDefault" | "agentAccess">>;

export type UpdateCalendarCommand = {
  calendarId: string;
  expectedUpdatedAt: string;
  patch: CalendarPatch;
};

export type SoftDeleteCalendarCommand = {
  calendarId: string;
  expectedUpdatedAt: string;
  deletedAt: string;
};

export type RestoreCalendarCommand = {
  calendarId: string;
  expectedUpdatedAt: string;
  restoredAt: string;
};

export type CalendarAllDaySpanInput = {
  kind: "all_day";
  startDate: string;
  endDateExclusive: string;
};

export type CalendarZonedSpanInput = {
  kind: "zoned";
  startLocalDateTime: string;
  endLocalDateTime: string;
  timeZone: string;
};

export type CalendarEventSpanInput = CalendarAllDaySpanInput | CalendarZonedSpanInput;

export type CalendarAllDaySpan = CalendarAllDaySpanInput;

export type CalendarZonedSpan = CalendarZonedSpanInput & {
  startInstant: string;
  endInstant: string;
};

export type CalendarEventSpan = CalendarAllDaySpan | CalendarZonedSpan;

export const CALENDAR_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

export type CalendarWeekday = (typeof CALENDAR_WEEKDAYS)[number];

export type CalendarRecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; untilDate: string }
  | { kind: "count"; count: number };

export type CalendarRecurrenceRule =
  | { frequency: "daily"; interval: number; end: CalendarRecurrenceEnd }
  | { frequency: "weekly"; interval: number; weekdays: CalendarWeekday[]; end: CalendarRecurrenceEnd }
  | { frequency: "monthly"; interval: number; monthDays: number[]; end: CalendarRecurrenceEnd }
  | {
      frequency: "yearly";
      interval: number;
      months: number[];
      monthDays: number[];
      end: CalendarRecurrenceEnd;
    };

export type CalendarOriginalOccurrenceInput =
  | { kind: "all_day"; startDate: string }
  | { kind: "zoned"; startLocalDateTime: string; timeZone: string };

export type CalendarOriginalOccurrence =
  | { kind: "all_day"; startDate: string }
  | { kind: "zoned"; startLocalDateTime: string; timeZone: string; startInstant: string };

export type CalendarEventLineageInput =
  | { kind: "standalone" }
  | { kind: "recurrence_master" }
  | { kind: "recurrence_exception"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrenceInput };

export type CalendarEventLineage =
  | { kind: "standalone" }
  | { kind: "recurrence_master" }
  | { kind: "recurrence_exception"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrence };

export type CalendarSubjectLink =
  | { kind: "life_link"; lifeLinkId: string }
  | { kind: "collection"; collectionId: string }
  | { kind: "routine"; routineId: string }
  | { kind: "routine_schedule"; routineId: string; scheduleId: string }
  | { kind: "routine_occurrence"; routineId: string; scheduleId: string; occurrenceId: string }
  | { kind: "routine_session"; routineId: string; sessionId: string };

export type CalendarEventStatus = "confirmed" | "tentative" | "canceled";

export type CalendarEventRecord = {
  id: string;
  ownerId: string;
  calendarId: string;
  currentRevisionId: string;
  lineage: CalendarEventLineage;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CalendarEventRevisionRecord = {
  id: string;
  ownerId: string;
  eventId: string;
  revisionNumber: number;
  title: string;
  description: string;
  location: string;
  status: CalendarEventStatus;
  span: CalendarEventSpan;
  recurrence: CalendarRecurrenceRule | null;
  subjectLinks: CalendarSubjectLink[];
  createdAt: string;
};

export type CanonicalCalendarEventCreation = {
  event: CalendarEventRecord;
  currentRevision: CalendarEventRevisionRecord;
};

export type CreateCalendarEventCommand = {
  id: string;
  revisionId: string;
  ownerId: string;
  calendarId: string;
  lineage?: CalendarEventLineageInput;
  title: string;
  description?: string;
  location?: string;
  status?: CalendarEventStatus;
  span: CalendarEventSpanInput;
  recurrence?: CalendarRecurrenceRule | null;
  subjectLinks?: CalendarSubjectLink[];
  createdAt: string;
};

export type ReviseCalendarEventCommand = {
  revisionId: string;
  ownerId: string;
  eventId: string;
  expectedCurrentRevisionId: string;
  title: string;
  description?: string;
  location?: string;
  status?: CalendarEventStatus;
  span: CalendarEventSpanInput;
  recurrence?: CalendarRecurrenceRule | null;
  subjectLinks?: CalendarSubjectLink[];
  createdAt: string;
};

export type CalendarEventTombstoneRecord = {
  id: string;
  ownerId: string;
  calendarId: string;
  eventId: string;
  lastRevisionId: string;
  lineage: CalendarEventLineage;
  deletedAt: string;
};

export type CalendarEventDefinition = {
  event: CalendarEventRecord;
  currentRevision: CalendarEventRevisionRecord;
};

/**
 * Read-only occurrence projection. It is never a second persisted event. For a
 * generated occurrence, eventId/revisionId name the recurrence master unless a
 * real exception substitutes for it. instanceId remains stable across that
 * substitution because it is derived from the master and original occurrence.
 */
export type CalendarEventInstance = {
  instanceId: string;
  eventId: string;
  revisionId: string;
  calendarId: string;
  masterEventId: string | null;
  originalOccurrence: CalendarOriginalOccurrence | null;
  isException: boolean;
  title: string;
  description: string;
  location: string;
  status: CalendarEventStatus;
  span: CalendarEventSpan;
  subjectLinks: CalendarSubjectLink[];
};

export type MaterializeCalendarEventWindowInput = {
  definitions: readonly CalendarEventDefinition[];
  startDate: string;
  endDate: string;
  viewTimeZone: string;
};

export type SoftDeleteCalendarEventCommand = {
  tombstoneId: string;
  eventId: string;
  expectedCurrentRevisionId: string;
  deletedAt: string;
};

export type CalendarEventDeletion = {
  event: CalendarEventRecord;
  tombstone: CalendarEventTombstoneRecord;
};

export type RestoreCalendarEventCommand = {
  eventId: string;
  expectedCurrentRevisionId: string;
  tombstoneId: string;
  restoredAt: string;
};

export type CalendarEventEditTarget =
  | { scope: "event"; eventId: string }
  | { scope: "occurrence"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrence }
  | { scope: "this_and_future"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrence }
  | { scope: "series"; masterEventId: string };

export type CalendarEventEditTargetInput =
  | { scope: "event"; eventId: string }
  | { scope: "occurrence"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrenceInput }
  | { scope: "this_and_future"; masterEventId: string; originalOccurrence: CalendarOriginalOccurrenceInput }
  | { scope: "series"; masterEventId: string };

export function normalizeCalendarId(value: unknown): string {
  return normalizeEntityId(value, CALENDAR_ID_PREFIX, "invalid_calendar_id", "calendar");
}

export function normalizeCalendarEventId(value: unknown): string {
  return normalizeEntityId(value, CALENDAR_EVENT_ID_PREFIX, "invalid_event_id", "event");
}

export function normalizeCalendarEventRevisionId(value: unknown): string {
  return normalizeEntityId(value, CALENDAR_EVENT_REVISION_ID_PREFIX, "invalid_event_revision_id", "event");
}

export function normalizeCalendarEventTombstoneId(value: unknown): string {
  return normalizeEntityId(value, CALENDAR_EVENT_TOMBSTONE_ID_PREFIX, "invalid_event_tombstone_id", "event");
}

export function normalizeCalendarIanaTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidCalendar("Calendar time zone is invalid.", "invalid_time_zone");
  }
  try {
    return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", { timeZone: value.trim() })
      .resolvedOptions().timeZone;
  } catch {
    throw invalidCalendar("Calendar time zone is invalid.", "invalid_time_zone");
  }
}

export function normalizeCalendarSource(value: unknown): CalendarSource {
  if (value !== "native" && value !== "external") {
    throw invalidCalendar("Calendar source is invalid.", "invalid_calendar_source");
  }
  return value;
}

export function normalizeCalendarAgentAccess(value: unknown): CalendarAgentAccess {
  if (value !== "none" && value !== "read" && value !== "write") {
    throw invalidCalendar("Calendar agent access is invalid.", "invalid_agent_access");
  }
  return value;
}

export function createCanonicalCalendar(command: CreateCalendarCommand): CalendarRecord {
  return createCanonicalCalendarWithSource(command, "native");
}

/**
 * Creates the one canonical Life Links Calendar owned by an external-provider
 * binding. Provider display metadata never substitutes for these owner-facing
 * Calendar fields.
 */
export function createCanonicalExternalCalendar(command: CreateExternalCalendarCommand): CalendarRecord {
  return createCanonicalCalendarWithSource(command, "external");
}

function createCanonicalCalendarWithSource(
  command: CreateCalendarCommand,
  source: CalendarSource
): CalendarRecord {
  assertCalendarExactKeys(
    command,
    ["id", "ownerId", "title", "color", "timeZone", "isDefault", "agentAccess", "createdAt"],
    "invalid_create_calendar",
    ["color", "isDefault", "agentAccess"]
  );
  const createdAt = normalizeTimestamp(command.createdAt, "invalid_calendar");
  return {
    id: normalizeCalendarId(command.id),
    ownerId: normalizeOwnerId(command.ownerId),
    title: normalizeCalendarText(command.title, MAX_TITLE_LENGTH, true, "invalid_calendar_title"),
    color: normalizeCalendarColor(command.color ?? "#2f6f5f"),
    timeZone: normalizeCalendarIanaTimeZone(command.timeZone),
    source,
    agentAccess: normalizeCalendarAgentAccess(command.agentAccess ?? (source === "native" ? "write" : "none")),
    isDefault: command.isDefault === undefined ? false : normalizeBoolean(command.isDefault, "invalid_default_flag"),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null
  };
}

export function normalizeCalendarPatch(value: unknown): CalendarPatch {
  assertCalendarExactKeys(value, ["title", "color", "timeZone", "isDefault", "agentAccess"], "invalid_calendar_patch", [
    "title",
    "color",
    "timeZone",
    "isDefault",
    "agentAccess"
  ]);
  const patch: CalendarPatch = {};
  if (hasOwn(value, "title")) {
    patch.title = normalizeCalendarText(value.title, MAX_TITLE_LENGTH, true, "invalid_calendar_title");
  }
  if (hasOwn(value, "color")) patch.color = normalizeCalendarColor(value.color);
  if (hasOwn(value, "timeZone")) patch.timeZone = normalizeCalendarIanaTimeZone(value.timeZone);
  if (hasOwn(value, "isDefault")) patch.isDefault = normalizeBoolean(value.isDefault, "invalid_default_flag");
  if (hasOwn(value, "agentAccess")) patch.agentAccess = normalizeCalendarAgentAccess(value.agentAccess);
  return patch;
}

export function applyCalendarPatch(
  record: CalendarRecord,
  command: UpdateCalendarCommand,
  updatedAtValue: string
): CalendarRecord {
  if (normalizeCalendarId(command.calendarId) !== record.id) {
    throw calendarReferenceConflict("Calendar update targets a different Calendar.", "calendar_target_mismatch");
  }
  assertCalendarFresh(command.expectedUpdatedAt, record.updatedAt);
  assertCalendarLive(record);
  const updatedAt = normalizeMonotonicTimestamp(updatedAtValue, record.updatedAt, "invalid_calendar");
  return { ...record, ...normalizeCalendarPatch(command.patch), updatedAt };
}

export function softDeleteCalendar(record: CalendarRecord, command: SoftDeleteCalendarCommand): CalendarRecord {
  if (normalizeCalendarId(command.calendarId) !== record.id) {
    throw calendarReferenceConflict("Calendar deletion targets a different Calendar.", "calendar_target_mismatch");
  }
  assertCalendarFresh(command.expectedUpdatedAt, record.updatedAt);
  assertCalendarLive(record);
  const deletedAt = normalizeMonotonicTimestamp(command.deletedAt, record.updatedAt, "invalid_calendar");
  return { ...record, updatedAt: deletedAt, deletedAt };
}

export function restoreCalendar(record: CalendarRecord, command: RestoreCalendarCommand): CalendarRecord {
  if (normalizeCalendarId(command.calendarId) !== record.id) {
    throw calendarReferenceConflict("Calendar restoration targets a different Calendar.", "calendar_target_mismatch");
  }
  assertCalendarFresh(command.expectedUpdatedAt, record.updatedAt);
  if (record.deletedAt === null) {
    throw new CalendarDomainError("calendar_conflict", "Calendar is not deleted.", { reason: "calendar_not_deleted" });
  }
  const restoredAt = normalizeMonotonicTimestamp(command.restoredAt, record.updatedAt, "invalid_calendar");
  return { ...record, updatedAt: restoredAt, deletedAt: null };
}

export function normalizeCalendarEventSpan(value: unknown): CalendarEventSpan {
  if (!isPlainObject(value) || (value.kind !== "all_day" && value.kind !== "zoned")) {
    throw invalidEvent("Calendar event span is invalid.", "invalid_event_span");
  }
  if (value.kind === "all_day") {
    assertExactKeys(value, ["kind", "startDate", "endDateExclusive"], "invalid_event_span");
    const startDate = normalizeIsoDate(value.startDate, "invalid_event_span");
    const endDateExclusive = normalizeIsoDate(value.endDateExclusive, "invalid_event_span");
    if (endDateExclusive <= startDate) {
      throw invalidEvent("All-day event end date must follow its start date.", "invalid_event_span_range");
    }
    return { kind: "all_day", startDate, endDateExclusive };
  }
  assertExactKeys(
    value,
    ["kind", "startLocalDateTime", "endLocalDateTime", "timeZone"],
    "invalid_event_span"
  );
  const startLocalDateTime = normalizeLocalDateTime(value.startLocalDateTime);
  const endLocalDateTime = normalizeLocalDateTime(value.endLocalDateTime);
  const timeZone = normalizeCalendarIanaTimeZone(value.timeZone);
  const startInstant = resolveCalendarZonedDateTime(startLocalDateTime, timeZone);
  const endInstant = resolveCalendarZonedDateTime(endLocalDateTime, timeZone);
  if (Date.parse(endInstant) <= Date.parse(startInstant)) {
    throw invalidEvent("Timed event end must follow its start.", "invalid_event_span_range");
  }
  return { kind: "zoned", startLocalDateTime, endLocalDateTime, timeZone, startInstant, endInstant };
}

export function resolveCalendarZonedDateTime(localDateTimeValue: unknown, timeZoneValue: unknown): string {
  const localDateTime = normalizeLocalDateTime(localDateTimeValue);
  const timeZone = normalizeCalendarIanaTimeZone(timeZoneValue);
  const requestedOrdinal = localMinuteOrdinal(localDateTime);
  const formatter = localMinuteFormatter(timeZone);
  const observedOffsets = new Set<number>();
  for (
    let sample = requestedOrdinal - 36 * 60 * 60 * 1000;
    sample <= requestedOrdinal + 36 * 60 * 60 * 1000;
    sample += 6 * 60 * 60 * 1000
  ) {
    observedOffsets.add(formattedLocalMinute(formatter, sample) - sample);
  }
  const exactInstants = [...observedOffsets]
    .map((offset) => requestedOrdinal - offset)
    .filter((instant) => formattedLocalMinute(formatter, instant) === requestedOrdinal)
    .sort((left, right) => left - right);
  if (exactInstants.length) return new Date(exactInstants[0]).toISOString();

  // Civil-time gaps use the first later valid minute. Overlaps resolve above to
  // the earlier instant. These are the same deterministic semantics as Routines.
  let bestInstant: number | null = null;
  let bestLocalOrdinal = Number.POSITIVE_INFINITY;
  const start = requestedOrdinal - 18 * 60 * 60 * 1000;
  const end = requestedOrdinal + 42 * 60 * 60 * 1000;
  for (let instant = start; instant <= end; instant += 60_000) {
    const local = formattedLocalMinute(formatter, instant);
    if (local < requestedOrdinal || local > bestLocalOrdinal) continue;
    if (local < bestLocalOrdinal || bestInstant === null || instant < bestInstant) {
      bestLocalOrdinal = local;
      bestInstant = instant;
    }
  }
  if (bestInstant === null) {
    throw invalidEvent("Calendar local time cannot be resolved.", "unresolvable_local_time");
  }
  return new Date(bestInstant).toISOString();
}

export function normalizeCalendarRecurrenceRule(
  value: unknown,
  eventStartDateValue?: string
): CalendarRecurrenceRule {
  if (!isPlainObject(value) || !["daily", "weekly", "monthly", "yearly"].includes(String(value.frequency))) {
    throw invalidEvent("Calendar recurrence rule is invalid.", "invalid_recurrence_rule");
  }
  const interval = normalizeBoundedInteger(
    value.interval,
    1,
    MAX_CALENDAR_RECURRENCE_INTERVAL,
    "invalid_recurrence_interval"
  );
  const eventStartDate = eventStartDateValue === undefined
    ? undefined
    : normalizeIsoDate(eventStartDateValue, "invalid_recurrence_start");
  const end = normalizeCalendarRecurrenceEnd(value.end, eventStartDate);
  if (value.frequency === "daily") {
    assertExactKeys(value, ["frequency", "interval", "end"], "invalid_recurrence_rule");
    return { frequency: "daily", interval, end };
  }
  if (value.frequency === "weekly") {
    assertExactKeys(value, ["frequency", "interval", "weekdays", "end"], "invalid_recurrence_rule");
    if (!Array.isArray(value.weekdays) || !value.weekdays.length) {
      throw invalidEvent("Weekly recurrence requires weekdays.", "invalid_recurrence_weekdays");
    }
    const requested = value.weekdays as unknown[];
    if (requested.some((item) => !CALENDAR_WEEKDAYS.includes(item as CalendarWeekday))) {
      throw invalidEvent("Weekly recurrence weekdays are invalid.", "invalid_recurrence_weekdays");
    }
    const weekdays = CALENDAR_WEEKDAYS.filter((weekday) => requested.includes(weekday));
    return { frequency: "weekly", interval, weekdays, end };
  }
  if (value.frequency === "monthly") {
    assertExactKeys(value, ["frequency", "interval", "monthDays", "end"], "invalid_recurrence_rule");
    return {
      frequency: "monthly",
      interval,
      monthDays: normalizeUniqueIntegers(value.monthDays, 1, 31, "invalid_recurrence_month_days"),
      end
    };
  }
  assertExactKeys(value, ["frequency", "interval", "months", "monthDays", "end"], "invalid_recurrence_rule");
  return {
    frequency: "yearly",
    interval,
    months: normalizeUniqueIntegers(value.months, 1, 12, "invalid_recurrence_months"),
    monthDays: normalizeUniqueIntegers(value.monthDays, 1, 31, "invalid_recurrence_month_days"),
    end
  };
}

export function normalizeCalendarOriginalOccurrence(value: unknown): CalendarOriginalOccurrence {
  if (!isPlainObject(value) || (value.kind !== "all_day" && value.kind !== "zoned")) {
    throw invalidEvent("Calendar original occurrence is invalid.", "invalid_original_occurrence");
  }
  if (value.kind === "all_day") {
    assertExactKeys(value, ["kind", "startDate"], "invalid_original_occurrence");
    return { kind: "all_day", startDate: normalizeIsoDate(value.startDate, "invalid_original_occurrence") };
  }
  assertExactKeys(
    value,
    ["kind", "startLocalDateTime", "timeZone", "startInstant"],
    "invalid_original_occurrence",
    ["startInstant"]
  );
  const startLocalDateTime = normalizeLocalDateTime(value.startLocalDateTime);
  const timeZone = normalizeCalendarIanaTimeZone(value.timeZone);
  const startInstant = resolveCalendarZonedDateTime(startLocalDateTime, timeZone);
  if (value.startInstant !== undefined && normalizeTimestamp(value.startInstant, "invalid_calendar_event") !== startInstant) {
    throw invalidEvent("Calendar original occurrence instant does not match its local identity.", "invalid_original_occurrence");
  }
  return {
    kind: "zoned",
    startLocalDateTime,
    timeZone,
    startInstant
  };
}

export function normalizeCalendarEventLineage(value: unknown, eventIdValue: string): CalendarEventLineage {
  const eventId = normalizeCalendarEventId(eventIdValue);
  if (!isPlainObject(value) || !["standalone", "recurrence_master", "recurrence_exception"].includes(String(value.kind))) {
    throw invalidEvent("Calendar event lineage is invalid.", "invalid_event_lineage");
  }
  if (value.kind === "standalone" || value.kind === "recurrence_master") {
    assertExactKeys(value, ["kind"], "invalid_event_lineage");
    return { kind: value.kind };
  }
  assertExactKeys(value, ["kind", "masterEventId", "originalOccurrence"], "invalid_event_lineage");
  const masterEventId = normalizeCalendarEventId(value.masterEventId);
  if (masterEventId === eventId) {
    throw calendarReferenceConflict("Recurrence exception cannot be its own master.", "self_recurrence_master");
  }
  return {
    kind: "recurrence_exception",
    masterEventId,
    originalOccurrence: normalizeCalendarOriginalOccurrence(value.originalOccurrence)
  };
}

export function normalizeCalendarSubjectLinks(value: unknown): CalendarSubjectLink[] {
  if (!Array.isArray(value) || value.length > MAX_CALENDAR_SUBJECT_LINKS) {
    throw invalidEvent("Calendar subject links are invalid or exceed the supported limit.", "invalid_subject_links");
  }
  const links = value.map(normalizeCalendarSubjectLink);
  const keys = links.map(calendarSubjectLinkKey);
  if (new Set(keys).size !== keys.length) {
    throw invalidEvent("Calendar subject links must be unique.", "duplicate_subject_link");
  }
  return links.sort((left, right) => compareText(calendarSubjectLinkKey(left), calendarSubjectLinkKey(right)));
}

export function createCanonicalCalendarEvent(command: CreateCalendarEventCommand): CanonicalCalendarEventCreation {
  assertExactKeys(
    command,
    [
      "id",
      "revisionId",
      "ownerId",
      "calendarId",
      "lineage",
      "title",
      "description",
      "location",
      "status",
      "span",
      "recurrence",
      "subjectLinks",
      "createdAt"
    ],
    "invalid_create_event",
    ["lineage", "description", "location", "status", "recurrence", "subjectLinks"]
  );
  const eventId = normalizeCalendarEventId(command.id);
  const ownerId = normalizeOwnerId(command.ownerId);
  const calendarId = normalizeCalendarId(command.calendarId);
  const span = normalizeCalendarEventSpan(command.span);
  const recurrence = command.recurrence === undefined || command.recurrence === null
    ? null
    : normalizeCalendarRecurrenceRule(command.recurrence, calendarSpanStartDate(span));
  const lineage = normalizeCalendarEventLineage(
    command.lineage ?? (recurrence === null ? { kind: "standalone" } : { kind: "recurrence_master" }),
    eventId
  );
  assertLineageRecurrence(lineage, recurrence);
  const createdAt = normalizeTimestamp(command.createdAt, "invalid_calendar_event");
  const currentRevision = createCalendarEventRevision({
    id: command.revisionId,
    ownerId,
    eventId,
    revisionNumber: 1,
    title: command.title,
    description: command.description,
    location: command.location,
    status: command.status,
    span,
    recurrence,
    subjectLinks: command.subjectLinks,
    createdAt
  });
  return {
    event: {
      id: eventId,
      ownerId,
      calendarId,
      currentRevisionId: currentRevision.id,
      lineage,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null
    },
    currentRevision
  };
}

export function reviseCanonicalCalendarEvent(
  event: CalendarEventRecord,
  currentRevision: CalendarEventRevisionRecord,
  command: ReviseCalendarEventCommand
): CanonicalCalendarEventCreation {
  assertExactKeys(
    command,
    [
      "revisionId",
      "ownerId",
      "eventId",
      "expectedCurrentRevisionId",
      "title",
      "description",
      "location",
      "status",
      "span",
      "recurrence",
      "subjectLinks",
      "createdAt"
    ],
    "invalid_revise_event",
    ["description", "location", "status", "recurrence", "subjectLinks"]
  );
  const ownerId = normalizeOwnerId(command.ownerId);
  const eventId = normalizeCalendarEventId(command.eventId);
  if (event.id !== eventId || event.ownerId !== ownerId) {
    throw calendarReferenceConflict("Calendar event revision targets a different event or owner.", "event_target_mismatch");
  }
  assertEventLive(event);
  if (
    currentRevision.id !== event.currentRevisionId ||
    currentRevision.eventId !== event.id ||
    currentRevision.ownerId !== event.ownerId
  ) {
    throw calendarReferenceConflict("Current Calendar event revision does not match its event.", "current_revision_mismatch");
  }
  const expectedCurrentRevisionId = normalizeCalendarEventRevisionId(command.expectedCurrentRevisionId);
  if (expectedCurrentRevisionId !== event.currentRevisionId) {
    throw new CalendarDomainError("stale_calendar_event", "Calendar event changed before this revision completed.", {
      retryable: true,
      reason: "stale_current_revision"
    });
  }
  const nextRevisionId = normalizeCalendarEventRevisionId(command.revisionId);
  if (nextRevisionId === currentRevision.id) {
    throw invalidEvent("New Calendar event revision identity must be unique.", "duplicate_event_revision_id");
  }
  const span = normalizeCalendarEventSpan(command.span);
  const recurrenceValue = command.recurrence === undefined ? currentRevision.recurrence : command.recurrence;
  const recurrence = recurrenceValue === null
    ? null
    : normalizeCalendarRecurrenceRule(recurrenceValue, calendarSpanStartDate(span));
  assertLineageRecurrence(event.lineage, recurrence);
  const createdAt = normalizeMonotonicTimestamp(command.createdAt, event.updatedAt, "invalid_calendar_event");
  const nextRevision = createCalendarEventRevision({
    id: nextRevisionId,
    ownerId,
    eventId,
    revisionNumber: currentRevision.revisionNumber + 1,
    title: command.title,
    description: command.description ?? currentRevision.description,
    location: command.location ?? currentRevision.location,
    status: command.status ?? currentRevision.status,
    span,
    recurrence,
    subjectLinks: command.subjectLinks ?? currentRevision.subjectLinks,
    createdAt
  });
  return {
    event: { ...event, currentRevisionId: nextRevision.id, updatedAt: createdAt },
    currentRevision: nextRevision
  };
}

export function softDeleteCalendarEvent(
  event: CalendarEventRecord,
  command: SoftDeleteCalendarEventCommand
): CalendarEventDeletion {
  if (normalizeCalendarEventId(command.eventId) !== event.id) {
    throw calendarReferenceConflict("Calendar event deletion targets a different event.", "event_target_mismatch");
  }
  assertEventFresh(command.expectedCurrentRevisionId, event.currentRevisionId);
  assertEventLive(event);
  const deletedAt = normalizeMonotonicTimestamp(command.deletedAt, event.updatedAt, "invalid_calendar_event");
  const tombstone: CalendarEventTombstoneRecord = {
    id: normalizeCalendarEventTombstoneId(command.tombstoneId),
    ownerId: event.ownerId,
    calendarId: event.calendarId,
    eventId: event.id,
    lastRevisionId: event.currentRevisionId,
    lineage: cloneLineage(event.lineage),
    deletedAt
  };
  return {
    event: { ...event, updatedAt: deletedAt, deletedAt },
    tombstone
  };
}

export function restoreCalendarEvent(
  event: CalendarEventRecord,
  tombstone: CalendarEventTombstoneRecord,
  command: RestoreCalendarEventCommand
): CalendarEventRecord {
  if (normalizeCalendarEventId(command.eventId) !== event.id) {
    throw calendarReferenceConflict("Calendar event restoration targets a different event.", "event_target_mismatch");
  }
  assertEventFresh(command.expectedCurrentRevisionId, event.currentRevisionId);
  if (
    normalizeCalendarEventTombstoneId(command.tombstoneId) !== tombstone.id ||
    tombstone.eventId !== event.id ||
    tombstone.ownerId !== event.ownerId ||
    tombstone.calendarId !== event.calendarId ||
    tombstone.lastRevisionId !== event.currentRevisionId ||
    event.deletedAt !== tombstone.deletedAt
  ) {
    throw calendarReferenceConflict("Calendar event tombstone does not match its event.", "tombstone_mismatch");
  }
  if (event.deletedAt === null) {
    throw new CalendarDomainError("calendar_conflict", "Calendar event is not deleted.", {
      reason: "event_not_deleted"
    });
  }
  const restoredAt = normalizeMonotonicTimestamp(command.restoredAt, event.updatedAt, "invalid_calendar_event");
  return { ...event, updatedAt: restoredAt, deletedAt: null };
}

export function normalizeCalendarEventEditTarget(value: unknown): CalendarEventEditTarget {
  if (!isPlainObject(value) || !["event", "occurrence", "this_and_future", "series"].includes(String(value.scope))) {
    throw invalidEvent("Calendar event edit target is invalid.", "invalid_edit_target");
  }
  if (value.scope === "event") {
    assertExactKeys(value, ["scope", "eventId"], "invalid_edit_target");
    return { scope: "event", eventId: normalizeCalendarEventId(value.eventId) };
  }
  if (value.scope === "series") {
    assertExactKeys(value, ["scope", "masterEventId"], "invalid_edit_target");
    return { scope: "series", masterEventId: normalizeCalendarEventId(value.masterEventId) };
  }
  assertExactKeys(value, ["scope", "masterEventId", "originalOccurrence"], "invalid_edit_target");
  return {
    scope: value.scope === "occurrence" ? "occurrence" : "this_and_future",
    masterEventId: normalizeCalendarEventId(value.masterEventId),
    originalOccurrence: normalizeCalendarOriginalOccurrence(value.originalOccurrence)
  };
}

export function assertCalendarEventEditTargetMatches(
  target: CalendarEventEditTarget,
  event: CalendarEventRecord
): void {
  if (target.scope === "event") {
    if (target.eventId !== event.id || event.lineage.kind === "recurrence_master") {
      throw calendarReferenceConflict("Event edit target does not match a standalone event or exception.", "edit_target_mismatch");
    }
    return;
  }
  if (target.masterEventId !== event.id || event.lineage.kind !== "recurrence_master") {
    throw calendarReferenceConflict("Series edit target does not match its recurrence master.", "edit_target_mismatch");
  }
}

/**
 * Proves that an exception key names an occurrence actually generated by the
 * current master rule. Persistence uses this before accepting an exception,
 * preventing syntactically valid but phantom recurrence overrides.
 */
export function calendarRecurrenceIncludesOriginalOccurrence(
  masterRevision: CalendarEventRevisionRecord,
  originalOccurrenceValue: CalendarOriginalOccurrence
): boolean {
  const recurrence = masterRevision.recurrence;
  if (recurrence === null) return false;
  const originalOccurrence = normalizeCalendarOriginalOccurrence(originalOccurrenceValue);
  const masterSpan = masterRevision.span;
  if (masterSpan.kind === "all_day") {
    if (originalOccurrence.kind !== "all_day") return false;
    return recurrenceDateOrdinal(recurrence, masterSpan.startDate, originalOccurrence.startDate) !== null;
  }
  if (originalOccurrence.kind !== "zoned" || originalOccurrence.timeZone !== masterSpan.timeZone) return false;
  if (originalOccurrence.startLocalDateTime.slice(11) !== masterSpan.startLocalDateTime.slice(11)) return false;
  if (originalOccurrence.startInstant !== resolveCalendarZonedDateTime(
    originalOccurrence.startLocalDateTime,
    originalOccurrence.timeZone
  )) return false;
  return recurrenceDateOrdinal(
    recurrence,
    masterSpan.startLocalDateTime.slice(0, 10),
    originalOccurrence.startLocalDateTime.slice(0, 10)
  ) !== null;
}

/**
 * Materializes a bounded native Calendar window once for every consumer. The
 * output substitutes exact exceptions, never emits exceptions independently,
 * and filters by the selected view zone after substitution.
 */
export function materializeCalendarEventWindow(
  input: MaterializeCalendarEventWindowInput
): CalendarEventInstance[] {
  const startDate = normalizeIsoDate(input.startDate, "invalid_materialization_window");
  const endDate = normalizeIsoDate(input.endDate, "invalid_materialization_window");
  if (endDate < startDate || daysBetween(startDate, endDate) + 1 > MAX_CALENDAR_MATERIALIZATION_DAYS) {
    throw invalidEvent(
      `Calendar materialization requires an inclusive window of at most ${MAX_CALENDAR_MATERIALIZATION_DAYS} days.`,
      "invalid_materialization_window"
    );
  }
  const viewTimeZone = normalizeCalendarIanaTimeZone(input.viewTimeZone);
  const definitions = input.definitions.map((definition) => cloneDefinition(definition));
  const byId = new Map(definitions.map((definition) => [definition.event.id, definition]));
  const exceptions = new Map<string, CalendarEventDefinition>();

  for (const definition of definitions) {
    assertDefinitionCoherent(definition);
    if (definition.event.deletedAt !== null || definition.event.lineage.kind !== "recurrence_exception") continue;
    const master = byId.get(definition.event.lineage.masterEventId);
    if (!master || master.event.deletedAt !== null || master.event.lineage.kind !== "recurrence_master" ||
        master.event.ownerId !== definition.event.ownerId || master.event.calendarId !== definition.event.calendarId ||
        !calendarRecurrenceIncludesOriginalOccurrence(master.currentRevision, definition.event.lineage.originalOccurrence)) {
      throw calendarReferenceConflict(
        "Calendar recurrence exception does not name an occurrence generated by its master.",
        "recurrence_exception_not_generated"
      );
    }
    const key = recurrenceInstanceKey(master.event.id, definition.event.lineage.originalOccurrence);
    if (exceptions.has(key)) {
      throw new CalendarDomainError("calendar_conflict", "Calendar recurrence occurrence has multiple exceptions.", {
        reason: "duplicate_recurrence_exception"
      });
    }
    exceptions.set(key, definition);
  }

  const result: CalendarEventInstance[] = [];
  const emitted = new Set<string>();
  const push = (instance: CalendarEventInstance) => {
    if (!eventSpanOverlapsViewWindow(instance.span, startDate, endDate, viewTimeZone) || emitted.has(instance.instanceId)) return;
    emitted.add(instance.instanceId);
    result.push(instance);
    if (result.length > MAX_CALENDAR_MATERIALIZED_INSTANCES) {
      throw invalidEvent("Calendar materialization produced too many instances.", "materialization_limit_exceeded");
    }
  };

  for (const definition of definitions) {
    const { event, currentRevision } = definition;
    if (event.deletedAt !== null || event.lineage.kind === "recurrence_exception") continue;
    if (event.lineage.kind === "standalone") {
      push(instanceFromDefinition(definition, currentRevision.span, null, null));
      continue;
    }
    const recurrence = currentRevision.recurrence;
    if (recurrence === null) {
      throw calendarReferenceConflict("Calendar recurrence master has no recurrence rule.", "missing_master_recurrence");
    }
    const masterStartDate = calendarSpanStartDate(currentRevision.span);
    const candidateStart = addIsoDays(startDate, -2 - calendarSpanDurationDays(currentRevision.span));
    const candidateEnd = addIsoDays(endDate, 2);
    for (const occurrenceDate of listRecurrenceDates(recurrence, masterStartDate, candidateStart, candidateEnd)) {
      const originalOccurrence = originalOccurrenceForDate(currentRevision.span, occurrenceDate);
      const key = recurrenceInstanceKey(event.id, originalOccurrence);
      const exception = exceptions.get(key);
      if (exception) {
        push(instanceFromDefinition(exception, exception.currentRevision.span, event.id, originalOccurrence));
      } else {
        push(instanceFromDefinition(
          definition,
          recurrenceSpanForDate(currentRevision.span, occurrenceDate),
          event.id,
          originalOccurrence
        ));
      }
    }
  }

  // A moved exception can overlap this view even when its original occurrence
  // is outside the candidate window. Include it through the same stable key.
  for (const [instanceId, exception] of exceptions) {
    if (emitted.has(instanceId)) continue;
    const lineage = exception.event.lineage;
    if (lineage.kind !== "recurrence_exception") continue;
    push(instanceFromDefinition(exception, exception.currentRevision.span, lineage.masterEventId, lineage.originalOccurrence));
  }

  return result.sort((left, right) => calendarSpanSortKey(left.span).localeCompare(calendarSpanSortKey(right.span)) ||
    left.instanceId.localeCompare(right.instanceId));
}

export function assertCalendarFresh(expectedValue: string, actualValue: string): void {
  const expected = normalizeTimestamp(expectedValue, "invalid_calendar");
  const actual = normalizeTimestamp(actualValue, "invalid_calendar");
  if (expected !== actual) {
    throw new CalendarDomainError("stale_calendar", "Calendar changed before this operation completed.", {
      retryable: true,
      reason: "stale_updated_at"
    });
  }
}

export function assertEventFresh(expectedRevisionIdValue: string, actualRevisionIdValue: string): void {
  const expected = normalizeCalendarEventRevisionId(expectedRevisionIdValue);
  const actual = normalizeCalendarEventRevisionId(actualRevisionIdValue);
  if (expected !== actual) {
    throw new CalendarDomainError("stale_calendar_event", "Calendar event changed before this operation completed.", {
      retryable: true,
      reason: "stale_current_revision"
    });
  }
}

type CreateCalendarEventRevisionInput = {
  id: string;
  ownerId: string;
  eventId: string;
  revisionNumber: number;
  title: string;
  description?: string;
  location?: string;
  status?: CalendarEventStatus;
  span: CalendarEventSpan;
  recurrence: CalendarRecurrenceRule | null;
  subjectLinks?: CalendarSubjectLink[];
  createdAt: string;
};

function createCalendarEventRevision(input: CreateCalendarEventRevisionInput): CalendarEventRevisionRecord {
  if (!Number.isSafeInteger(input.revisionNumber) || input.revisionNumber < 1) {
    throw invalidEvent("Calendar event revision number is invalid.", "invalid_event_revision_number");
  }
  return {
    id: normalizeCalendarEventRevisionId(input.id),
    ownerId: normalizeOwnerId(input.ownerId),
    eventId: normalizeCalendarEventId(input.eventId),
    revisionNumber: input.revisionNumber,
    title: normalizeText(input.title, MAX_TITLE_LENGTH, true, "invalid_event_title"),
    description: normalizeText(input.description ?? "", MAX_BODY_LENGTH, false, "invalid_event_description"),
    location: normalizeText(input.location ?? "", MAX_CALENDAR_LOCATION_LENGTH, false, "invalid_event_location"),
    status: normalizeCalendarEventStatus(input.status ?? "confirmed"),
    span: cloneSpan(input.span),
    recurrence: input.recurrence === null ? null : cloneRecurrence(input.recurrence),
    subjectLinks: normalizeCalendarSubjectLinks(input.subjectLinks ?? []),
    createdAt: normalizeTimestamp(input.createdAt, "invalid_calendar_event")
  };
}

function normalizeCalendarEventStatus(value: unknown): CalendarEventStatus {
  if (value !== "confirmed" && value !== "tentative" && value !== "canceled") {
    throw invalidEvent("Calendar event status is invalid.", "invalid_event_status");
  }
  return value;
}

function normalizeCalendarRecurrenceEnd(value: unknown, eventStartDate?: string): CalendarRecurrenceEnd {
  if (!isPlainObject(value) || !["never", "until", "count"].includes(String(value.kind))) {
    throw invalidEvent("Calendar recurrence end is invalid.", "invalid_recurrence_end");
  }
  if (value.kind === "never") {
    assertExactKeys(value, ["kind"], "invalid_recurrence_end");
    return { kind: "never" };
  }
  if (value.kind === "until") {
    assertExactKeys(value, ["kind", "untilDate"], "invalid_recurrence_end");
    const untilDate = normalizeIsoDate(value.untilDate, "invalid_recurrence_end");
    if (eventStartDate !== undefined && untilDate < eventStartDate) {
      throw invalidEvent("Calendar recurrence cannot end before the event starts.", "invalid_recurrence_end_range");
    }
    return { kind: "until", untilDate };
  }
  assertExactKeys(value, ["kind", "count"], "invalid_recurrence_end");
  return {
    kind: "count",
    count: normalizeBoundedInteger(value.count, 1, MAX_CALENDAR_RECURRENCE_COUNT, "invalid_recurrence_count")
  };
}

function normalizeCalendarSubjectLink(value: unknown): CalendarSubjectLink {
  if (
    !isPlainObject(value) ||
    ![
      "life_link",
      "collection",
      "routine",
      "routine_schedule",
      "routine_occurrence",
      "routine_session"
    ].includes(String(value.kind))
  ) {
    throw invalidEvent("Calendar subject link is invalid.", "invalid_subject_link");
  }
  if (value.kind === "life_link") {
    assertExactKeys(value, ["kind", "lifeLinkId"], "invalid_subject_link");
    return { kind: "life_link", lifeLinkId: normalizeLifeLinkSubjectId(value.lifeLinkId) };
  }
  if (value.kind === "collection") {
    assertExactKeys(value, ["kind", "collectionId"], "invalid_subject_link");
    return {
      kind: "collection",
      collectionId: normalizeReferencedId(value.collectionId, "collection-", "invalid_subject_link")
    };
  }
  const routineId = normalizeReferencedId(value.routineId, "routine-", "invalid_subject_link");
  if (value.kind === "routine") {
    assertExactKeys(value, ["kind", "routineId"], "invalid_subject_link");
    return { kind: "routine", routineId };
  }
  if (value.kind === "routine_schedule") {
    assertExactKeys(value, ["kind", "routineId", "scheduleId"], "invalid_subject_link");
    return {
      kind: "routine_schedule",
      routineId,
      scheduleId: normalizeReferencedId(value.scheduleId, "routine-schedule-", "invalid_subject_link")
    };
  }
  if (value.kind === "routine_occurrence") {
    assertExactKeys(value, ["kind", "routineId", "scheduleId", "occurrenceId"], "invalid_subject_link");
    return {
      kind: "routine_occurrence",
      routineId,
      scheduleId: normalizeReferencedId(value.scheduleId, "routine-schedule-", "invalid_subject_link"),
      occurrenceId: normalizeReferencedId(value.occurrenceId, "routine-occurrence-", "invalid_subject_link")
    };
  }
  assertExactKeys(value, ["kind", "routineId", "sessionId"], "invalid_subject_link");
  return {
    kind: "routine_session",
    routineId,
    sessionId: normalizeReferencedId(value.sessionId, "routine-session-", "invalid_subject_link")
  };
}

function calendarSubjectLinkKey(value: CalendarSubjectLink): string {
  if (value.kind === "life_link") return `life_link\u0000${value.lifeLinkId}`;
  if (value.kind === "collection") return `collection\u0000${value.collectionId}`;
  if (value.kind === "routine") return `routine\u0000${value.routineId}`;
  if (value.kind === "routine_schedule") return `schedule\u0000${value.scheduleId}`;
  if (value.kind === "routine_occurrence") return `occurrence\u0000${value.occurrenceId}`;
  return `session\u0000${value.sessionId}`;
}

function normalizeLifeLinkSubjectId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 512) {
    throw invalidEvent("Life Link subject identity is invalid.", "invalid_subject_link");
  }
  return value.trim();
}

function assertLineageRecurrence(
  lineage: CalendarEventLineage,
  recurrence: CalendarRecurrenceRule | null
): void {
  if (lineage.kind === "recurrence_master" && recurrence === null) {
    throw invalidEvent("Recurrence master requires a recurrence rule.", "missing_master_recurrence");
  }
  if (lineage.kind !== "recurrence_master" && recurrence !== null) {
    throw invalidEvent("Only a recurrence master may own a recurrence rule.", "unexpected_event_recurrence");
  }
}

function assertCalendarLive(record: CalendarRecord): void {
  if (record.deletedAt !== null) {
    throw new CalendarDomainError("calendar_conflict", "Deleted Calendar cannot be changed.", {
      reason: "calendar_deleted"
    });
  }
}

function assertEventLive(record: CalendarEventRecord): void {
  if (record.deletedAt !== null) {
    throw new CalendarDomainError("calendar_conflict", "Deleted Calendar event cannot be changed.", {
      reason: "event_deleted"
    });
  }
}

function normalizeCalendarColor(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
    throw invalidCalendar("Calendar color must be a six-digit hex color.", "invalid_calendar_color");
  }
  return value.trim().toLowerCase();
}

function normalizeOwnerId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) {
    throw invalidCalendar("Calendar owner identity is invalid.", "invalid_owner_id");
  }
  return value.trim();
}

function normalizeEntityId(
  value: unknown,
  prefix: string,
  reason: string,
  family: "calendar" | "event"
): string {
  const invalid = () => family === "calendar"
    ? invalidCalendar("Calendar identity is invalid.", reason)
    : invalidEvent("Calendar event identity is invalid.", reason);
  if (typeof value !== "string") throw invalid();
  const normalized = value.trim().toLowerCase();
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (!new RegExp(`^${escapeRegExp(prefix)}${uuid}$`).test(normalized)) {
    throw invalid();
  }
  return normalized;
}

function normalizeReferencedId(value: unknown, prefix: string, reason: string): string {
  if (typeof value !== "string") throw invalidEvent("Calendar subject identity is invalid.", reason);
  const normalized = value.trim().toLowerCase();
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if (!new RegExp(`^${escapeRegExp(prefix)}${uuid}$`).test(normalized)) {
    throw invalidEvent("Calendar subject identity must be a prefixed UUID.", reason);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown, code: "invalid_calendar" | "invalid_calendar_event"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    if (code === "invalid_calendar") throw invalidCalendar("Calendar timestamp is invalid.", "invalid_timestamp");
    throw invalidEvent("Calendar event timestamp is invalid.", "invalid_timestamp");
  }
  return new Date(value).toISOString();
}

function normalizeMonotonicTimestamp(
  value: unknown,
  previousValue: string,
  code: "invalid_calendar" | "invalid_calendar_event"
): string {
  const timestamp = normalizeTimestamp(value, code);
  const previous = normalizeTimestamp(previousValue, code);
  if (Date.parse(timestamp) < Date.parse(previous)) {
    if (code === "invalid_calendar") {
      throw invalidCalendar("Calendar change timestamp cannot precede its current revision.", "non_monotonic_timestamp");
    }
    throw invalidEvent("Calendar event change timestamp cannot precede its current revision.", "non_monotonic_timestamp");
  }
  return timestamp;
}

function normalizeText(value: unknown, limit: number, required: boolean, reason: string): string {
  if (typeof value !== "string") throw invalidEvent("Calendar text value must be a string.", reason);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !normalized) || normalized.length > limit) {
    throw invalidEvent("Calendar text value is empty or exceeds the supported limit.", reason);
  }
  return normalized;
}

function normalizeCalendarText(value: unknown, limit: number, required: boolean, reason: string): string {
  if (typeof value !== "string") throw invalidCalendar("Calendar text value must be a string.", reason);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !normalized) || normalized.length > limit) {
    throw invalidCalendar("Calendar text value is empty or exceeds the supported limit.", reason);
  }
  return normalized;
}

function normalizeBoolean(value: unknown, reason: string): boolean {
  if (typeof value !== "boolean") throw invalidCalendar("Calendar yes/no value is invalid.", reason);
  return value;
}

function normalizeIsoDate(value: unknown, reason: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidEvent("Calendar local date is invalid.", reason);
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = utcDate(year, month, day);
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw invalidEvent("Calendar local date is invalid.", reason);
  }
  return value;
}

function normalizeLocalDateTime(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidEvent("Calendar local date and time is invalid.", "invalid_local_date_time");
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/);
  if (!match) {
    throw invalidEvent(
      "Calendar local date and time must use YYYY-MM-DDTHH:MM minute precision.",
      "invalid_local_date_time"
    );
  }
  normalizeIsoDate(match[1], "invalid_local_date_time");
  return value;
}

function normalizeBoundedInteger(value: unknown, minimum: number, maximum: number, reason: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidEvent("Calendar numeric value is outside the supported range.", reason);
  }
  return value;
}

function normalizeUniqueIntegers(value: unknown, minimum: number, maximum: number, reason: string): number[] {
  if (!Array.isArray(value) || !value.length) {
    throw invalidEvent("Calendar recurrence list is empty or invalid.", reason);
  }
  const result = value.map((item) => normalizeBoundedInteger(item, minimum, maximum, reason));
  if (new Set(result).size !== result.length) {
    throw invalidEvent("Calendar recurrence list must be unique.", reason);
  }
  return result.sort((left, right) => left - right);
}

function calendarSpanStartDate(span: CalendarEventSpan): string {
  return span.kind === "all_day" ? span.startDate : span.startLocalDateTime.slice(0, 10);
}

function localMinuteOrdinal(localDateTime: string): number {
  const [date, time] = localDateTime.split("T");
  const [hour, minute] = time.split(":").map(Number);
  return isoDateOrdinal(date) + hour * 3_600_000 + minute * 60_000;
}

function isoDateOrdinal(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return utcDate(year, month, day).getTime();
}

function utcDate(year: number, month: number, day: number): Date {
  // Date.UTC treats years 0-99 as 1900-1999 before normalizing the month and
  // day. Setting the complete UTC date onto a neutral instant avoids that
  // legacy coercion, including for leap days such as 2020-02-29.
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate;
}

function localMinuteFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}

function formattedLocalMinute(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return localMinuteOrdinal(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
}

function recurrenceDateOrdinal(
  recurrence: CalendarRecurrenceRule,
  startDate: string,
  candidateDate: string
): number | null {
  const dayOffset = daysBetween(startDate, candidateDate);
  if (dayOffset < 0) return null;
  let ordinal: number | null = null;
  if (recurrence.frequency === "daily") {
    if (dayOffset % recurrence.interval !== 0) return null;
    ordinal = Math.floor(dayOffset / recurrence.interval) + 1;
  } else if (recurrence.frequency === "weekly") {
    const periodDays = recurrence.interval * 7;
    const offsetInPeriod = dayOffset % periodDays;
    if (offsetInPeriod >= 7 || !recurrence.weekdays.includes(weekdayForDate(candidateDate))) return null;
    const allowedOffsets = recurrence.weekdays
      .map((weekday) => (CALENDAR_WEEKDAYS.indexOf(weekday) - CALENDAR_WEEKDAYS.indexOf(weekdayForDate(startDate)) + 7) % 7)
      .sort((left, right) => left - right);
    const position = allowedOffsets.indexOf(offsetInPeriod);
    if (position < 0) return null;
    ordinal = Math.floor(dayOffset / periodDays) * allowedOffsets.length + position + 1;
  } else if (recurrence.frequency === "monthly") {
    const monthOffset = monthsBetween(startDate, candidateDate);
    const candidateDay = Number(candidateDate.slice(8, 10));
    if (monthOffset < 0 || monthOffset % recurrence.interval !== 0 || !recurrence.monthDays.includes(candidateDay)) return null;
    ordinal = countMonthlyOccurrencesThrough(recurrence, startDate, candidateDate);
  } else {
    const startYear = Number(startDate.slice(0, 4));
    const candidateYear = Number(candidateDate.slice(0, 4));
    const candidateMonth = Number(candidateDate.slice(5, 7));
    const candidateDay = Number(candidateDate.slice(8, 10));
    const yearOffset = candidateYear - startYear;
    if (yearOffset < 0 || yearOffset % recurrence.interval !== 0 ||
        !recurrence.months.includes(candidateMonth) || !recurrence.monthDays.includes(candidateDay)) return null;
    ordinal = countYearlyOccurrencesThrough(recurrence, startDate, candidateDate);
  }
  if (ordinal === null || ordinal < 1) return null;
  if (recurrence.end.kind === "until" && candidateDate > recurrence.end.untilDate) return null;
  if (recurrence.end.kind === "count" && ordinal > recurrence.end.count) return null;
  return ordinal;
}

function listRecurrenceDates(
  recurrence: CalendarRecurrenceRule,
  startDate: string,
  requestedStartDate: string,
  requestedEndDate: string
): string[] {
  if (requestedEndDate < startDate) return [];
  const lower = requestedStartDate < startDate ? startDate : requestedStartDate;
  const result: string[] = [];
  if (recurrence.frequency === "daily") {
    const lowerOffset = Math.max(0, daysBetween(startDate, lower));
    let occurrenceIndex = Math.ceil(lowerOffset / recurrence.interval);
    while (true) {
      const candidate = addIsoDays(startDate, occurrenceIndex * recurrence.interval);
      if (candidate > requestedEndDate) break;
      if (recurrenceDateOrdinal(recurrence, startDate, candidate) !== null) result.push(candidate);
      occurrenceIndex += 1;
      if (recurrence.end.kind === "count" && occurrenceIndex >= recurrence.end.count) break;
    }
    return result;
  }
  if (recurrence.frequency === "weekly") {
    const periodDays = recurrence.interval * 7;
    const lowerOffset = Math.max(0, daysBetween(startDate, lower));
    let cycle = Math.floor(lowerOffset / periodDays);
    const offsets = recurrence.weekdays
      .map((weekday) => (CALENDAR_WEEKDAYS.indexOf(weekday) - CALENDAR_WEEKDAYS.indexOf(weekdayForDate(startDate)) + 7) % 7)
      .sort((left, right) => left - right);
    for (;; cycle += 1) {
      const cycleStart = addIsoDays(startDate, cycle * periodDays);
      if (cycleStart > requestedEndDate) break;
      for (const offset of offsets) {
        const candidate = addIsoDays(cycleStart, offset);
        if (candidate < lower || candidate > requestedEndDate) continue;
        if (recurrenceDateOrdinal(recurrence, startDate, candidate) !== null) result.push(candidate);
      }
    }
    return result;
  }
  if (recurrence.frequency === "monthly") {
    const startMonth = monthOrdinal(startDate);
    const lowerMonthOffset = Math.max(0, monthOrdinal(lower) - startMonth);
    let monthOffset = Math.ceil(lowerMonthOffset / recurrence.interval) * recurrence.interval;
    for (;; monthOffset += recurrence.interval) {
      const month = startMonth + monthOffset;
      const first = isoDateFromMonthDay(month, 1);
      if (first === null || first > requestedEndDate) break;
      for (const day of recurrence.monthDays) {
        const candidate = isoDateFromMonthDay(month, day);
        if (candidate === null || candidate < lower || candidate > requestedEndDate) continue;
        if (recurrenceDateOrdinal(recurrence, startDate, candidate) !== null) result.push(candidate);
      }
    }
    return result.sort();
  }
  const startYear = Number(startDate.slice(0, 4));
  const lowerYear = Number(lower.slice(0, 4));
  let yearOffset = Math.ceil(Math.max(0, lowerYear - startYear) / recurrence.interval) * recurrence.interval;
  for (;; yearOffset += recurrence.interval) {
    const year = startYear + yearOffset;
    if (year > Number(requestedEndDate.slice(0, 4))) break;
    for (const month of recurrence.months) {
      for (const day of recurrence.monthDays) {
        const candidate = isoDateFromParts(year, month, day);
        if (candidate === null || candidate < lower || candidate > requestedEndDate) continue;
        if (recurrenceDateOrdinal(recurrence, startDate, candidate) !== null) result.push(candidate);
      }
    }
  }
  return result.sort();
}

function countMonthlyOccurrencesThrough(
  recurrence: Extract<CalendarRecurrenceRule, { frequency: "monthly" }>,
  startDate: string,
  candidateDate: string
): number {
  const startMonth = monthOrdinal(startDate);
  const candidateMonth = monthOrdinal(candidateDate);
  let count = 0;
  for (let month = startMonth; month <= candidateMonth; month += recurrence.interval) {
    for (const day of recurrence.monthDays) {
      const occurrence = isoDateFromMonthDay(month, day);
      if (occurrence !== null && occurrence >= startDate && occurrence <= candidateDate) count += 1;
    }
    if (recurrence.end.kind === "count" && count > recurrence.end.count) return count;
  }
  return count;
}

function countYearlyOccurrencesThrough(
  recurrence: Extract<CalendarRecurrenceRule, { frequency: "yearly" }>,
  startDate: string,
  candidateDate: string
): number {
  const startYear = Number(startDate.slice(0, 4));
  const candidateYear = Number(candidateDate.slice(0, 4));
  let count = 0;
  for (let year = startYear; year <= candidateYear; year += recurrence.interval) {
    for (const month of recurrence.months) {
      for (const day of recurrence.monthDays) {
        const occurrence = isoDateFromParts(year, month, day);
        if (occurrence !== null && occurrence >= startDate && occurrence <= candidateDate) count += 1;
      }
    }
    if (recurrence.end.kind === "count" && count > recurrence.end.count) return count;
  }
  return count;
}

function instanceFromDefinition(
  definition: CalendarEventDefinition,
  span: CalendarEventSpan,
  masterEventId: string | null,
  originalOccurrence: CalendarOriginalOccurrence | null
): CalendarEventInstance {
  const { event, currentRevision } = definition;
  return {
    instanceId: masterEventId && originalOccurrence
      ? recurrenceInstanceKey(masterEventId, originalOccurrence)
      : `calendar-instance:${event.id}`,
    eventId: event.id,
    revisionId: currentRevision.id,
    calendarId: event.calendarId,
    masterEventId,
    originalOccurrence: originalOccurrence ? { ...originalOccurrence } : null,
    isException: event.lineage.kind === "recurrence_exception",
    title: currentRevision.title,
    description: currentRevision.description,
    location: currentRevision.location,
    status: currentRevision.status,
    span: cloneSpan(span),
    subjectLinks: currentRevision.subjectLinks.map((link) => ({ ...link }))
  };
}

function originalOccurrenceForDate(span: CalendarEventSpan, occurrenceDate: string): CalendarOriginalOccurrence {
  if (span.kind === "all_day") return { kind: "all_day", startDate: occurrenceDate };
  const startLocalDateTime = `${occurrenceDate}T${span.startLocalDateTime.slice(11)}`;
  return {
    kind: "zoned",
    startLocalDateTime,
    timeZone: span.timeZone,
    startInstant: resolveCalendarZonedDateTime(startLocalDateTime, span.timeZone)
  };
}

function recurrenceSpanForDate(span: CalendarEventSpan, occurrenceDate: string): CalendarEventSpan {
  if (span.kind === "all_day") {
    return {
      kind: "all_day",
      startDate: occurrenceDate,
      endDateExclusive: addIsoDays(occurrenceDate, daysBetween(span.startDate, span.endDateExclusive))
    };
  }
  const startLocalDateTime = `${occurrenceDate}T${span.startLocalDateTime.slice(11)}`;
  const wallDurationMinutes = Math.floor(
    (localMinuteOrdinal(span.endLocalDateTime) - localMinuteOrdinal(span.startLocalDateTime)) / 60_000
  );
  const endLocalDateTime = localDateTimeFromOrdinal(localMinuteOrdinal(startLocalDateTime) + wallDurationMinutes * 60_000);
  return {
    kind: "zoned",
    startLocalDateTime,
    endLocalDateTime,
    timeZone: span.timeZone,
    startInstant: resolveCalendarZonedDateTime(startLocalDateTime, span.timeZone),
    endInstant: resolveCalendarZonedDateTime(endLocalDateTime, span.timeZone)
  };
}

function eventSpanOverlapsViewWindow(
  span: CalendarEventSpan,
  startDate: string,
  endDate: string,
  viewTimeZone: string
): boolean {
  if (span.kind === "all_day") return span.startDate <= endDate && span.endDateExclusive > startDate;
  const windowStart = Date.parse(resolveCalendarZonedDateTime(`${startDate}T00:00`, viewTimeZone));
  const windowEnd = Date.parse(resolveCalendarZonedDateTime(`${addIsoDays(endDate, 1)}T00:00`, viewTimeZone));
  return Date.parse(span.startInstant) < windowEnd && Date.parse(span.endInstant) > windowStart;
}

function assertDefinitionCoherent(definition: CalendarEventDefinition): void {
  if (definition.currentRevision.id !== definition.event.currentRevisionId ||
      definition.currentRevision.eventId !== definition.event.id ||
      definition.currentRevision.ownerId !== definition.event.ownerId) {
    throw calendarReferenceConflict("Calendar event definition does not match its current revision.", "current_revision_mismatch");
  }
}

function cloneDefinition(definition: CalendarEventDefinition): CalendarEventDefinition {
  return {
    event: { ...definition.event, lineage: cloneLineage(definition.event.lineage) },
    currentRevision: {
      ...definition.currentRevision,
      span: cloneSpan(definition.currentRevision.span),
      recurrence: definition.currentRevision.recurrence ? cloneRecurrence(definition.currentRevision.recurrence) : null,
      subjectLinks: definition.currentRevision.subjectLinks.map((link) => ({ ...link }))
    }
  };
}

function recurrenceInstanceKey(masterEventId: string, original: CalendarOriginalOccurrence): string {
  return original.kind === "all_day"
    ? `calendar-instance:${masterEventId}:all-day:${original.startDate}`
    : `calendar-instance:${masterEventId}:zoned:${original.startLocalDateTime}:${original.timeZone}`;
}

function calendarSpanDurationDays(span: CalendarEventSpan): number {
  if (span.kind === "all_day") return Math.max(1, daysBetween(span.startDate, span.endDateExclusive));
  return Math.max(1, Math.ceil(
    (localMinuteOrdinal(span.endLocalDateTime) - localMinuteOrdinal(span.startLocalDateTime)) / 86_400_000
  ));
}

function calendarSpanSortKey(span: CalendarEventSpan): string {
  return span.kind === "all_day" ? `${span.startDate}T00:00:00.000Z` : span.startInstant;
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((isoDateOrdinal(endDate) - isoDateOrdinal(startDate)) / 86_400_000);
}

function addIsoDays(date: string, amount: number): string {
  return new Date(isoDateOrdinal(date) + amount * 86_400_000).toISOString().slice(0, 10);
}

function weekdayForDate(date: string): CalendarWeekday {
  const sundayFirst = new Date(isoDateOrdinal(date)).getUTCDay();
  return CALENDAR_WEEKDAYS[(sundayFirst + 6) % 7];
}

function monthOrdinal(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function monthsBetween(startDate: string, endDate: string): number {
  return monthOrdinal(endDate) - monthOrdinal(startDate);
}

function isoDateFromMonthDay(monthValue: number, day: number): string | null {
  const year = Math.floor(monthValue / 12);
  const month = monthValue % 12 + 1;
  return isoDateFromParts(year, month, day);
}

function isoDateFromParts(year: number, month: number, day: number): string | null {
  const candidate = utcDate(year, month, day);
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localDateTimeFromOrdinal(value: number): string {
  return new Date(value).toISOString().slice(0, 16);
}

function cloneSpan(value: CalendarEventSpan): CalendarEventSpan {
  return { ...value };
}

function cloneRecurrence(value: CalendarRecurrenceRule): CalendarRecurrenceRule {
  if (value.frequency === "weekly") return { ...value, weekdays: [...value.weekdays], end: { ...value.end } };
  if (value.frequency === "monthly") return { ...value, monthDays: [...value.monthDays], end: { ...value.end } };
  if (value.frequency === "yearly") {
    return { ...value, months: [...value.months], monthDays: [...value.monthDays], end: { ...value.end } };
  }
  return { ...value, end: { ...value.end } };
}

function cloneLineage(value: CalendarEventLineage): CalendarEventLineage {
  if (value.kind !== "recurrence_exception") return { ...value };
  return { ...value, originalOccurrence: { ...value.originalOccurrence } };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  reason: string,
  optionalKeys: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidEvent("Calendar value must be an object.", reason);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    allowedKeys.some((key) => !optional.has(key) && !hasOwn(value, key))
  ) {
    throw invalidEvent("Calendar value contains missing or unsupported fields.", reason);
  }
}

function assertCalendarExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  reason: string,
  optionalKeys: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidCalendar("Calendar value must be an object.", reason);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    allowedKeys.some((key) => !optional.has(key) && !hasOwn(value, key))
  ) {
    throw invalidCalendar("Calendar value contains missing or unsupported fields.", reason);
  }
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function invalidCalendar(message: string, reason: string): CalendarDomainError {
  return new CalendarDomainError("invalid_calendar", message, { reason });
}

function invalidEvent(message: string, reason: string): CalendarDomainError {
  return new CalendarDomainError("invalid_calendar_event", message, { reason });
}

function calendarReferenceConflict(message: string, reason: string): CalendarDomainError {
  return new CalendarDomainError("calendar_reference_conflict", message, { reason });
}
