import { LifeLinkDomainError, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from "./index.js";

export const ROUTINE_GROUP_ID_PREFIX = "routine-group-";
export const ACTIVITY_ID_PREFIX = "activity-";
export const ROUTINE_ID_PREFIX = "routine-";
export const ROUTINE_REVISION_ID_PREFIX = "routine-revision-";
export const ROUTINE_STEP_ID_PREFIX = "routine-step-";
export const ROUTINE_BINDING_ID_PREFIX = "routine-binding-";
export const ROUTINE_SCHEDULE_ID_PREFIX = "routine-schedule-";
export const ROUTINE_OCCURRENCE_ID_PREFIX = "routine-occurrence-";
export const ROUTINE_RUN_ID_PREFIX = "routine-run-";
export const ROUTINE_SESSION_ID_PREFIX = "routine-session-";
export const ROUTINE_SESSION_RESULT_ID_PREFIX = "routine-session-result-";
export const ROUTINE_SESSION_AMENDMENT_ID_PREFIX = "routine-session-amendment-";

export const MAX_ROUTINE_STEPS = 100;
export const MAX_ROUTINE_CONTEXT_BINDINGS = 100;
export const MAX_ROUTINE_VALUES_PER_STEP = 32;
export const MAX_ROUTINE_VALUE_KEY_LENGTH = 64;
export const MAX_ROUTINE_VALUE_LABEL_LENGTH = MAX_TITLE_LENGTH;
export const MAX_ROUTINE_UNIT_LENGTH = 32;
export const MAX_ROUTINE_TEXT_VALUE_LENGTH = MAX_BODY_LENGTH;
export const MAX_ROUTINE_PURPOSE_LENGTH = 500;
export const MAX_ROUTINE_SCHEDULE_INTERVAL = 366;
export const MAX_ROUTINE_MATERIALIZATION_DAYS = 366;

export type RoutineGroupRecord = {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ActivityRecord = {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type RoutineRecord = {
  id: string;
  ownerId: string;
  groupId: string | null;
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type RoutineSummaryRecord = RoutineRecord & {
  revisionNumber: number;
  title: string;
  purpose: string;
};

export type RoutineRevisionRecord = {
  id: string;
  ownerId: string;
  routineId: string;
  revisionNumber: number;
  title: string;
  purpose: string;
  instructions: string;
  createdAt: string;
};

export type RoutineValueKind = "number" | "quantity" | "duration" | "text" | "boolean";
export type RoutineValue =
  | { key: string; label: string; kind: "number"; value: number }
  | { key: string; label: string; kind: "quantity"; amount: number; unit: string }
  | { key: string; label: string; kind: "duration"; seconds: number }
  | { key: string; label: string; kind: "text"; text: string }
  | { key: string; label: string; kind: "boolean"; value: boolean };

export type RoutineStepRecord = {
  id: string;
  ownerId: string;
  routineRevisionId: string;
  activityId: string;
  activityTitle: string;
  position: number;
  instructions: string;
  optional: boolean;
  plannedValues: RoutineValue[];
};

export type RoutineContextTargetType = "life_link" | "collection";
export type RoutineContextBindingRecord = {
  id: string;
  ownerId: string;
  routineRevisionId: string;
  routineStepId: string | null;
  targetType: RoutineContextTargetType;
  targetId: string;
};

export type RoutineRevisionSnapshot = {
  revision: RoutineRevisionRecord;
  steps: RoutineStepRecord[];
  bindings: RoutineContextBindingRecord[];
};

export type CanonicalRoutineCreation = {
  routine: RoutineRecord;
  currentRevision: RoutineRevisionSnapshot;
};

export const ROUTINE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;
export type RoutineWeekday = (typeof ROUTINE_WEEKDAYS)[number];

export type RoutineScheduleRule =
  | { kind: "once"; localDate: string; localTime: string; timeZone: string }
  | {
      kind: "daily";
      startDate: string;
      endDate: string | null;
      intervalDays: number;
      localTime: string;
      timeZone: string;
    }
  | {
      kind: "weekly";
      startDate: string;
      endDate: string | null;
      intervalWeeks: number;
      weekdays: RoutineWeekday[];
      localTime: string;
      timeZone: string;
    };

export type RoutineScheduleRecord = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRevisionId: string;
  rule: RoutineScheduleRule;
  revision: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoutineOccurrenceStatus = "planned" | "canceled" | "skipped" | "started" | "completed";
export type RoutineOccurrenceRecord = {
  id: string;
  ownerId: string;
  scheduleId: string;
  scheduleRevision: number;
  routineId: string;
  routineRevisionId: string;
  localDate: string;
  plannedFor: string;
  status: RoutineOccurrenceStatus;
  createdAt: string;
  updatedAt: string;
};

export type RoutineContextSnapshotLifeLink = {
  lifeLinkId: string;
  title: string;
  sourceUpdatedAt: string;
};

export type RoutineContextSnapshot = {
  bindingId: string;
  routineStepId: string | null;
  targetType: RoutineContextTargetType;
  targetId: string;
  targetTitle: string;
  targetSourceUpdatedAt: string;
  resolvedLifeLinks: RoutineContextSnapshotLifeLink[];
};

export type RoutineRunStepResult = {
  routineStepId: string;
  actualValues: RoutineValue[];
  proposedNextValues: RoutineValue[];
  notes: string;
};

export type RoutineRunStatus = "active" | "finalized";
export type RoutineRunRecord = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRevisionId: string;
  occurrenceId: string | null;
  status: RoutineRunStatus;
  contextSnapshot: RoutineContextSnapshot[];
  stepResults: RoutineRunStepResult[];
  startedAt: string;
  updatedAt: string;
};

export type RoutineSessionRecord = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRevisionId: string;
  runId: string;
  occurrenceId: string | null;
  contextSnapshot: RoutineContextSnapshot[];
  startedAt: string;
  completedAt: string;
};

export type RoutineSessionStepResultRecord = {
  id: string;
  ownerId: string;
  sessionId: string;
  routineStepId: string;
  actualValues: RoutineValue[];
  proposedNextValues: RoutineValue[];
  notes: string;
};

export type RoutineSessionAmendmentRecord = {
  id: string;
  ownerId: string;
  sessionId: string;
  stepResultId: string | null;
  note: string;
  correctedActualValues: RoutineValue[] | null;
  correctedProposedNextValues: RoutineValue[] | null;
  createdAt: string;
};

export type EffectiveRoutineSessionStepResult = {
  original: RoutineSessionStepResultRecord;
  effectiveActualValues: RoutineValue[];
  effectiveProposedNextValues: RoutineValue[];
  amendments: RoutineSessionAmendmentRecord[];
};

export type RoutineSessionProjection = {
  session: RoutineSessionRecord;
  stepResults: EffectiveRoutineSessionStepResult[];
  sessionAmendments: RoutineSessionAmendmentRecord[];
};

export type CreateRoutineGroupCommand = {
  id: string;
  ownerId: string;
  title: string;
  notes?: string;
  createdAt: string;
};
export type RoutineGroupPatch = Partial<Pick<RoutineGroupRecord, "title" | "notes" | "archivedAt">>;
export type UpdateRoutineGroupCommand = { groupId: string; expectedUpdatedAt: string; patch: RoutineGroupPatch };

export type CreateActivityCommand = {
  id: string;
  ownerId: string;
  title: string;
  notes?: string;
  createdAt: string;
};
export type ActivityPatch = Partial<Pick<ActivityRecord, "title" | "notes" | "archivedAt">>;
export type UpdateActivityCommand = { activityId: string; expectedUpdatedAt: string; patch: ActivityPatch };

export type CreateRoutineStepInput = {
  id: string;
  activityId: string;
  activityTitle: string;
  position: number;
  instructions?: string;
  optional?: boolean;
  plannedValues?: RoutineValue[];
};

export type CreateRoutineContextBindingInput = {
  id: string;
  routineStepId?: string | null;
  targetType: RoutineContextTargetType;
  targetId: string;
};

export type CreateRoutineRevisionCommand = {
  id: string;
  ownerId: string;
  routineId: string;
  revisionNumber: number;
  title: string;
  purpose?: string;
  instructions?: string;
  steps: CreateRoutineStepInput[];
  bindings?: CreateRoutineContextBindingInput[];
  createdAt: string;
};

export type ReviseRoutineCommand = CreateRoutineRevisionCommand & { expectedCurrentRevisionId: string };

export type CreateRoutineCommand = {
  id: string;
  revisionId: string;
  ownerId: string;
  groupId?: string | null;
  title: string;
  purpose?: string;
  instructions?: string;
  steps: CreateRoutineStepInput[];
  bindings?: CreateRoutineContextBindingInput[];
  createdAt: string;
};

export type RoutinePatch = Partial<Pick<RoutineRecord, "groupId" | "archivedAt">>;
export type UpdateRoutineCommand = { routineId: string; expectedUpdatedAt: string; patch: RoutinePatch };

export type CreateRoutineScheduleCommand = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRevisionId: string;
  rule: RoutineScheduleRule;
  active?: boolean;
  createdAt: string;
};
export type RoutineSchedulePatch = Partial<Pick<RoutineScheduleRecord, "rule" | "active">>;
export type UpdateRoutineScheduleCommand = {
  scheduleId: string;
  expectedUpdatedAt: string;
  patch: RoutineSchedulePatch;
};

export type StartRoutineRunCommand = {
  id: string;
  routineId: string;
  occurrenceId?: string | null;
  startedAt: string;
};
export type PutRoutineRunStepResultCommand = {
  runId: string;
  routineStepId: string;
  expectedUpdatedAt: string;
  actualValues: RoutineValue[];
  proposedNextValues: RoutineValue[];
  notes?: string;
};
export type FinalizeRoutineRunCommand = {
  runId: string;
  sessionId: string;
  expectedUpdatedAt: string;
  completedAt: string;
};

export type AppendRoutineSessionAmendmentCommand = {
  id: string;
  sessionId: string;
  stepResultId?: string | null;
  note: string;
  correctedActualValues?: RoutineValue[] | null;
  correctedProposedNextValues?: RoutineValue[] | null;
  createdAt: string;
};

export type RoutineSessionResultIdentity = { routineStepId: string; id: string };
export type BuiltRoutineSession = {
  finalizedRun: RoutineRunRecord;
  session: RoutineSessionRecord;
  stepResults: RoutineSessionStepResultRecord[];
};

export function normalizeRoutineGroupId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_GROUP_ID_PREFIX, "invalid_group_id");
}

export function normalizeActivityId(value: unknown): string {
  return normalizeRoutineEntityId(value, ACTIVITY_ID_PREFIX, "invalid_activity_id");
}

export function normalizeRoutineId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_ID_PREFIX, "invalid_routine_id");
}

export function normalizeRoutineRevisionId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_REVISION_ID_PREFIX, "invalid_revision_id");
}

export function normalizeRoutineStepId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_STEP_ID_PREFIX, "invalid_step_id");
}

export function normalizeRoutineBindingId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_BINDING_ID_PREFIX, "invalid_binding_id");
}

export function normalizeRoutineScheduleId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_SCHEDULE_ID_PREFIX, "invalid_schedule_id");
}

export function normalizeRoutineOccurrenceId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_OCCURRENCE_ID_PREFIX, "invalid_occurrence_id");
}

export function normalizeRoutineRunId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_RUN_ID_PREFIX, "invalid_run_id");
}

export function normalizeRoutineSessionId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_SESSION_ID_PREFIX, "invalid_session_id");
}

export function normalizeRoutineSessionResultId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_SESSION_RESULT_ID_PREFIX, "invalid_session_result_id");
}

export function normalizeRoutineSessionAmendmentId(value: unknown): string {
  return normalizeRoutineEntityId(value, ROUTINE_SESSION_AMENDMENT_ID_PREFIX, "invalid_amendment_id");
}

export function normalizeRoutineValueKey(value: unknown): string {
  if (typeof value !== "string") throw invalidRoutine("Routine value key is invalid.", "invalid_value_key");
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (!normalized || normalized.length > MAX_ROUTINE_VALUE_KEY_LENGTH || !/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    throw invalidRoutine("Routine value key is invalid.", "invalid_value_key");
  }
  return normalized;
}

export function normalizeRoutineValues(value: unknown): RoutineValue[] {
  if (!Array.isArray(value) || value.length > MAX_ROUTINE_VALUES_PER_STEP) {
    throw invalidRoutine("Routine values are invalid or exceed the supported limit.", "invalid_values");
  }
  const result = value.map(normalizeRoutineValue);
  if (new Set(result.map((item) => item.key)).size !== result.length) {
    throw invalidRoutine("Routine value keys must be unique within a Step.", "duplicate_value_key");
  }
  return result;
}

export function normalizeRoutineResultValues(value: unknown, plannedValues: readonly RoutineValue[]): RoutineValue[] {
  const planned = normalizeRoutineValues(plannedValues);
  const incoming = normalizeRoutineValues(value);
  const byKey = new Map(planned.map((item) => [item.key, item]));
  for (const item of incoming) {
    const declared = byKey.get(item.key);
    if (!declared || declared.kind !== item.kind || declared.label !== item.label) {
      throw invalidRoutine("Routine result values must use a declared Step key, label, and kind.", "invalid_result_value");
    }
  }
  const incomingByKey = new Map(incoming.map((item) => [item.key, item]));
  return planned.flatMap((item) => incomingByKey.has(item.key) ? [incomingByKey.get(item.key)!] : []);
}

export function normalizeRoutineScheduleRule(value: unknown): RoutineScheduleRule {
  if (!isPlainObject(value) || !["once", "daily", "weekly"].includes(String(value.kind))) {
    throw invalidRoutine("Routine schedule rule is invalid.", "invalid_schedule_rule");
  }
  if (value.kind === "once") {
    assertExactKeys(value, ["kind", "localDate", "localTime", "timeZone"], "invalid_schedule_rule");
    return {
      kind: "once",
      localDate: normalizeIsoDate(value.localDate),
      localTime: normalizeLocalTime(value.localTime),
      timeZone: normalizeIanaTimeZone(value.timeZone)
    };
  }
  if (value.kind === "daily") {
    assertExactKeys(value, ["kind", "startDate", "endDate", "intervalDays", "localTime", "timeZone"], "invalid_schedule_rule", ["endDate"]);
    const startDate = normalizeIsoDate(value.startDate);
    const endDate = value.endDate === undefined || value.endDate === null ? null : normalizeIsoDate(value.endDate);
    assertDateRange(startDate, endDate);
    return {
      kind: "daily",
      startDate,
      endDate,
      intervalDays: normalizeScheduleInterval(value.intervalDays),
      localTime: normalizeLocalTime(value.localTime),
      timeZone: normalizeIanaTimeZone(value.timeZone)
    };
  }
  assertExactKeys(value, ["kind", "startDate", "endDate", "intervalWeeks", "weekdays", "localTime", "timeZone"], "invalid_schedule_rule", ["endDate"]);
  const startDate = normalizeIsoDate(value.startDate);
  const endDate = value.endDate === undefined || value.endDate === null ? null : normalizeIsoDate(value.endDate);
  assertDateRange(startDate, endDate);
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.some((item) => !ROUTINE_WEEKDAYS.includes(item as RoutineWeekday))) {
    throw invalidRoutine("Weekly Routine schedule weekdays are invalid.", "invalid_schedule_weekdays");
  }
  const requestedWeekdays = value.weekdays as RoutineWeekday[];
  const weekdays = ROUTINE_WEEKDAYS.filter((weekday) => requestedWeekdays.includes(weekday));
  return {
    kind: "weekly",
    startDate,
    endDate,
    intervalWeeks: normalizeScheduleInterval(value.intervalWeeks),
    weekdays,
    localTime: normalizeLocalTime(value.localTime),
    timeZone: normalizeIanaTimeZone(value.timeZone)
  };
}

export function normalizeIanaTimeZone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidRoutine("Routine time zone is invalid.", "invalid_time_zone");
  try {
    return new Intl.DateTimeFormat("en-CA-u-ca-iso8601-nu-latn", { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    throw invalidRoutine("Routine time zone is invalid.", "invalid_time_zone");
  }
}

export function normalizeRoutineLocalDate(value: unknown): string {
  return normalizeIsoDate(value);
}

export function routineScheduleMatchesLocalDate(ruleValue: RoutineScheduleRule, localDateValue: string): boolean {
  const rule = normalizeRoutineScheduleRule(ruleValue);
  const localDate = normalizeIsoDate(localDateValue);
  if (rule.kind === "once") return rule.localDate === localDate;
  if (localDate < rule.startDate || (rule.endDate !== null && localDate > rule.endDate)) return false;
  const dayOffset = daysBetween(rule.startDate, localDate);
  if (rule.kind === "daily") return dayOffset % rule.intervalDays === 0;
  return Math.floor(dayOffset / 7) % rule.intervalWeeks === 0 && rule.weekdays.includes(weekdayForDate(localDate));
}

export function resolveRoutineSchedulePlannedFor(ruleValue: RoutineScheduleRule, localDateValue: string): string {
  const rule = normalizeRoutineScheduleRule(ruleValue);
  const localDate = normalizeIsoDate(localDateValue);
  if (!routineScheduleMatchesLocalDate(rule, localDate)) {
    throw invalidRoutine("Local date does not match the Routine schedule.", "schedule_date_mismatch");
  }
  const localTime = rule.localTime;
  const requestedOrdinal = localMinuteOrdinal(localDate, localTime);
  const naiveUtc = requestedOrdinal;
  const formatter = localMinuteFormatter(rule.timeZone);
  const observedOffsets = new Set<number>();
  for (let sample = naiveUtc - 36 * 60 * 60 * 1000; sample <= naiveUtc + 36 * 60 * 60 * 1000; sample += 6 * 60 * 60 * 1000) {
    observedOffsets.add(formattedLocalMinute(formatter, sample) - sample);
  }
  const exactInstants = [...observedOffsets]
    .map((offset) => requestedOrdinal - offset)
    .filter((instant) => formattedLocalMinute(formatter, instant) === requestedOrdinal)
    .sort((left, right) => left - right);
  if (exactInstants.length) return new Date(exactInstants[0]).toISOString();

  // An exact minute is absent only across a civil-time gap. The bounded scan
  // selects the first later local minute and also covers exceptional IANA jumps.
  let bestInstant: number | null = null;
  let bestLocalOrdinal = Number.POSITIVE_INFINITY;
  const start = naiveUtc - 18 * 60 * 60 * 1000;
  const end = naiveUtc + 42 * 60 * 60 * 1000;
  for (let instant = start; instant <= end; instant += 60_000) {
    const local = formattedLocalMinute(formatter, instant);
    if (local < requestedOrdinal || local > bestLocalOrdinal) continue;
    if (local < bestLocalOrdinal || bestInstant === null || instant < bestInstant) {
      bestLocalOrdinal = local;
      bestInstant = instant;
    }
  }
  if (bestInstant === null) throw invalidRoutine("Routine local time cannot be resolved.", "unresolvable_local_time");
  return new Date(bestInstant).toISOString();
}

export function listRoutineScheduleLocalDates(ruleValue: RoutineScheduleRule, startDateValue: string, endDateValue: string): string[] {
  const rule = normalizeRoutineScheduleRule(ruleValue);
  const startDate = normalizeIsoDate(startDateValue);
  const endDate = normalizeIsoDate(endDateValue);
  assertDateRange(startDate, endDate);
  const span = daysBetween(startDate, endDate) + 1;
  if (span > MAX_ROUTINE_MATERIALIZATION_DAYS) {
    throw invalidRoutine("Routine materialization window exceeds the supported limit.", "materialization_window_too_large");
  }
  const result: string[] = [];
  for (let index = 0; index < span; index += 1) {
    const date = addIsoDays(startDate, index);
    if (routineScheduleMatchesLocalDate(rule, date)) result.push(date);
  }
  return result;
}

export type CreateRoutineOccurrenceInput = {
  id: string;
  localDate: string;
  createdAt: string;
};

export type CreateCanonicalRoutineRunInput = {
  id: string;
  ownerId: string;
  routineId: string;
  routineRevisionId: string;
  occurrenceId?: string | null;
  contextSnapshot: RoutineContextSnapshot[];
  startedAt: string;
};

export type CreateCanonicalRoutineSessionAmendmentInput = {
  ownerId: string;
  session: RoutineSessionRecord;
  stepResult?: RoutineSessionStepResultRecord | null;
  plannedValues?: readonly RoutineValue[];
  command: AppendRoutineSessionAmendmentCommand;
};

export function createCanonicalRoutineGroup(command: CreateRoutineGroupCommand): RoutineGroupRecord {
  assertExactKeys(command, ["id", "ownerId", "title", "notes", "createdAt"], "invalid_group", ["notes"]);
  const createdAt = normalizeTimestamp(command.createdAt);
  return {
    id: normalizeRoutineGroupId(command.id),
    ownerId: normalizeOwnerId(command.ownerId),
    title: normalizeBoundedText(command.title, MAX_TITLE_LENGTH, true, "invalid_group_title"),
    notes: normalizeBoundedText(command.notes ?? "", MAX_BODY_LENGTH, false, "invalid_group_notes"),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null
  };
}

export function normalizeRoutineGroupPatch(value: unknown): RoutineGroupPatch {
  if (!isPlainObject(value)) throw invalidRoutine("Routine Group patch is invalid.", "invalid_group_patch");
  assertExactKeys(value, ["title", "notes", "archivedAt"], "invalid_group_patch", ["title", "notes", "archivedAt"]);
  const patch: RoutineGroupPatch = {};
  if (hasOwn(value, "title")) patch.title = normalizeBoundedText(value.title, MAX_TITLE_LENGTH, true, "invalid_group_title");
  if (hasOwn(value, "notes")) patch.notes = normalizeBoundedText(value.notes, MAX_BODY_LENGTH, false, "invalid_group_notes");
  if (hasOwn(value, "archivedAt")) patch.archivedAt = normalizeNullableTimestamp(value.archivedAt);
  return patch;
}

export function applyRoutineGroupPatch(record: RoutineGroupRecord, patchValue: unknown, updatedAtValue: string): RoutineGroupRecord {
  const patch = normalizeRoutineGroupPatch(patchValue);
  const updatedAt = normalizeTimestamp(updatedAtValue);
  return { ...record, ...patch, updatedAt };
}

export function createCanonicalActivity(command: CreateActivityCommand): ActivityRecord {
  assertExactKeys(command, ["id", "ownerId", "title", "notes", "createdAt"], "invalid_activity", ["notes"]);
  const createdAt = normalizeTimestamp(command.createdAt);
  return {
    id: normalizeActivityId(command.id),
    ownerId: normalizeOwnerId(command.ownerId),
    title: normalizeBoundedText(command.title, MAX_TITLE_LENGTH, true, "invalid_activity_title"),
    notes: normalizeBoundedText(command.notes ?? "", MAX_BODY_LENGTH, false, "invalid_activity_notes"),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null
  };
}

export function normalizeActivityPatch(value: unknown): ActivityPatch {
  if (!isPlainObject(value)) throw invalidRoutine("Activity patch is invalid.", "invalid_activity_patch");
  assertExactKeys(value, ["title", "notes", "archivedAt"], "invalid_activity_patch", ["title", "notes", "archivedAt"]);
  const patch: ActivityPatch = {};
  if (hasOwn(value, "title")) patch.title = normalizeBoundedText(value.title, MAX_TITLE_LENGTH, true, "invalid_activity_title");
  if (hasOwn(value, "notes")) patch.notes = normalizeBoundedText(value.notes, MAX_BODY_LENGTH, false, "invalid_activity_notes");
  if (hasOwn(value, "archivedAt")) patch.archivedAt = normalizeNullableTimestamp(value.archivedAt);
  return patch;
}

export function applyActivityPatch(record: ActivityRecord, patchValue: unknown, updatedAtValue: string): ActivityRecord {
  const patch = normalizeActivityPatch(patchValue);
  const updatedAt = normalizeTimestamp(updatedAtValue);
  return { ...record, ...patch, updatedAt };
}

export function createCanonicalRoutineRevision(command: CreateRoutineRevisionCommand): RoutineRevisionSnapshot {
  assertExactKeys(
    command,
    ["id", "ownerId", "routineId", "revisionNumber", "title", "purpose", "instructions", "steps", "bindings", "createdAt"],
    "invalid_revision",
    ["purpose", "instructions", "bindings"]
  );
  const ownerId = normalizeOwnerId(command.ownerId);
  const revisionId = normalizeRoutineRevisionId(command.id);
  const routineId = normalizeRoutineId(command.routineId);
  const createdAt = normalizeTimestamp(command.createdAt);
  if (!Number.isSafeInteger(command.revisionNumber) || command.revisionNumber < 1) {
    throw invalidRoutine("Routine revision number is invalid.", "invalid_revision_number");
  }
  if (!Array.isArray(command.steps) || command.steps.length > MAX_ROUTINE_STEPS) {
    throw invalidRoutine("Routine Steps are invalid or exceed the supported limit.", "invalid_steps");
  }
  const steps = command.steps.map((step) => normalizeRoutineStep(step, ownerId, revisionId));
  assertUnique(steps.map((step) => step.id), "Routine Step identities must be unique.", "duplicate_step_id");
  assertUnique(steps.map((step) => String(step.position)), "Routine Step positions must be unique.", "duplicate_step_position");
  steps.sort((left, right) => left.position - right.position || compareText(left.id, right.id));

  const bindingInputs = command.bindings ?? [];
  if (!Array.isArray(bindingInputs) || bindingInputs.length > MAX_ROUTINE_CONTEXT_BINDINGS) {
    throw invalidRoutine("Routine context bindings are invalid or exceed the supported limit.", "invalid_bindings");
  }
  const stepIds = new Set(steps.map((step) => step.id));
  const bindings = bindingInputs.map((binding) => normalizeRoutineContextBinding(binding, ownerId, revisionId, stepIds));
  assertUnique(bindings.map((binding) => binding.id), "Routine context binding identities must be unique.", "duplicate_binding_id");
  assertUnique(
    bindings.map((binding) => `${binding.routineStepId ?? "routine"}\u0000${binding.targetType}\u0000${binding.targetId}`),
    "Routine context bindings must be unique within their scope.",
    "duplicate_binding_target"
  );
  bindings.sort(compareRoutineBinding);

  return {
    revision: {
      id: revisionId,
      ownerId,
      routineId,
      revisionNumber: command.revisionNumber,
      title: normalizeBoundedText(command.title, MAX_TITLE_LENGTH, true, "invalid_routine_title"),
      purpose: normalizeBoundedText(command.purpose ?? "", MAX_ROUTINE_PURPOSE_LENGTH, false, "invalid_routine_purpose"),
      instructions: normalizeBoundedText(command.instructions ?? "", MAX_BODY_LENGTH, false, "invalid_routine_instructions"),
      createdAt
    },
    steps,
    bindings
  };
}

export function createCanonicalRoutine(command: CreateRoutineCommand): CanonicalRoutineCreation {
  assertExactKeys(
    command,
    ["id", "revisionId", "ownerId", "groupId", "title", "purpose", "instructions", "steps", "bindings", "createdAt"],
    "invalid_create",
    ["groupId", "purpose", "instructions", "bindings"]
  );
  const routineId = normalizeRoutineId(command.id);
  const ownerId = normalizeOwnerId(command.ownerId);
  const createdAt = normalizeTimestamp(command.createdAt);
  const currentRevision = createCanonicalRoutineRevision({
    id: command.revisionId,
    ownerId,
    routineId,
    revisionNumber: 1,
    title: command.title,
    purpose: command.purpose,
    instructions: command.instructions,
    steps: command.steps,
    bindings: command.bindings,
    createdAt
  });
  return {
    routine: {
      id: routineId,
      ownerId,
      groupId: normalizeNullableRoutineGroupId(command.groupId),
      currentRevisionId: currentRevision.revision.id,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null
    },
    currentRevision
  };
}

export function reviseCanonicalRoutine(
  routine: RoutineRecord,
  command: ReviseRoutineCommand
): CanonicalRoutineCreation {
  if (normalizeRoutineId(command.routineId) !== routine.id || normalizeOwnerId(command.ownerId) !== routine.ownerId) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine revision does not belong to the Routine owner.", {
      reason: "routine_owner_or_identity_mismatch"
    });
  }
  const expectedCurrentRevisionId = normalizeRoutineRevisionId(command.expectedCurrentRevisionId);
  if (expectedCurrentRevisionId !== routine.currentRevisionId) {
    throw new LifeLinkDomainError("stale_routine", "Routine current revision changed.", {
      retryable: true,
      reason: "stale_current_revision"
    });
  }
  const { expectedCurrentRevisionId: _expectedCurrentRevisionId, ...revisionCommand } = command;
  const currentRevision = createCanonicalRoutineRevision(revisionCommand);
  if (currentRevision.revision.revisionNumber < 2) {
    throw invalidRoutine("A replacement Routine revision number must be greater than one.", "invalid_revision_number");
  }
  return {
    routine: { ...routine, currentRevisionId: currentRevision.revision.id, updatedAt: currentRevision.revision.createdAt },
    currentRevision
  };
}

export function normalizeRoutinePatch(value: unknown): RoutinePatch {
  if (!isPlainObject(value)) throw invalidRoutine("Routine patch is invalid.", "invalid_patch");
  assertExactKeys(value, ["groupId", "archivedAt"], "invalid_patch", ["groupId", "archivedAt"]);
  const patch: RoutinePatch = {};
  if (hasOwn(value, "groupId")) patch.groupId = normalizeNullableRoutineGroupId(value.groupId);
  if (hasOwn(value, "archivedAt")) patch.archivedAt = normalizeNullableTimestamp(value.archivedAt);
  return patch;
}

export function applyRoutinePatch(record: RoutineRecord, patchValue: unknown, updatedAtValue: string): RoutineRecord {
  const patch = normalizeRoutinePatch(patchValue);
  return { ...record, ...patch, updatedAt: normalizeTimestamp(updatedAtValue) };
}

export function createCanonicalRoutineSchedule(command: CreateRoutineScheduleCommand): RoutineScheduleRecord {
  assertExactKeys(
    command,
    ["id", "ownerId", "routineId", "routineRevisionId", "rule", "active", "createdAt"],
    "invalid_schedule",
    ["active"]
  );
  const createdAt = normalizeTimestamp(command.createdAt);
  return {
    id: normalizeRoutineScheduleId(command.id),
    ownerId: normalizeOwnerId(command.ownerId),
    routineId: normalizeRoutineId(command.routineId),
    routineRevisionId: normalizeRoutineRevisionId(command.routineRevisionId),
    rule: normalizeRoutineScheduleRule(command.rule),
    revision: 1,
    active: command.active === undefined ? true : normalizeBoolean(command.active, "invalid_schedule_active"),
    createdAt,
    updatedAt: createdAt
  };
}

export function normalizeRoutineSchedulePatch(value: unknown): RoutineSchedulePatch {
  if (!isPlainObject(value)) throw invalidRoutine("Routine schedule patch is invalid.", "invalid_schedule_patch");
  assertExactKeys(value, ["rule", "active"], "invalid_schedule_patch", ["rule", "active"]);
  const patch: RoutineSchedulePatch = {};
  if (hasOwn(value, "rule")) patch.rule = normalizeRoutineScheduleRule(value.rule);
  if (hasOwn(value, "active")) patch.active = normalizeBoolean(value.active, "invalid_schedule_active");
  return patch;
}

export function applyRoutineSchedulePatch(
  schedule: RoutineScheduleRecord,
  routineRevisionIdValue: string,
  patchValue: unknown,
  updatedAtValue: string
): RoutineScheduleRecord {
  const patch = normalizeRoutineSchedulePatch(patchValue);
  return {
    ...schedule,
    ...patch,
    routineRevisionId: normalizeRoutineRevisionId(routineRevisionIdValue),
    revision: schedule.revision + 1,
    updatedAt: normalizeTimestamp(updatedAtValue)
  };
}

export function createCanonicalRoutineOccurrence(
  schedule: RoutineScheduleRecord,
  input: CreateRoutineOccurrenceInput
): RoutineOccurrenceRecord {
  assertExactKeys(input, ["id", "localDate", "createdAt"], "invalid_occurrence");
  if (!schedule.active) {
    throw new LifeLinkDomainError("routine_conflict", "Inactive Routine schedule cannot create an occurrence.", {
      reason: "inactive_schedule"
    });
  }
  const localDate = normalizeIsoDate(input.localDate);
  const createdAt = normalizeTimestamp(input.createdAt);
  return {
    id: normalizeRoutineOccurrenceId(input.id),
    ownerId: schedule.ownerId,
    scheduleId: schedule.id,
    scheduleRevision: schedule.revision,
    routineId: schedule.routineId,
    routineRevisionId: schedule.routineRevisionId,
    localDate,
    plannedFor: resolveRoutineSchedulePlannedFor(schedule.rule, localDate),
    status: "planned",
    createdAt,
    updatedAt: createdAt
  };
}

export function transitionRoutineOccurrenceStatus(
  occurrence: RoutineOccurrenceRecord,
  status: RoutineOccurrenceStatus,
  updatedAtValue: string
): RoutineOccurrenceRecord {
  if (!["planned", "canceled", "skipped", "started", "completed"].includes(status)) {
    throw invalidRoutine("Routine occurrence status is invalid.", "invalid_occurrence_status");
  }
  if (occurrence.status === status) return occurrence;
  const allowed =
    (occurrence.status === "planned" && ["canceled", "skipped", "started"].includes(status)) ||
    (occurrence.status === "started" && status === "completed");
  if (!allowed) {
    throw new LifeLinkDomainError("routine_conflict", "Routine occurrence status transition is not allowed.", {
      reason: "invalid_occurrence_transition"
    });
  }
  return { ...occurrence, status, updatedAt: normalizeTimestamp(updatedAtValue) };
}

export function normalizeRoutineContextSnapshot(value: unknown): RoutineContextSnapshot[] {
  if (!Array.isArray(value) || value.length > MAX_ROUTINE_CONTEXT_BINDINGS) {
    throw invalidRoutine("Routine context snapshot is invalid or exceeds the supported limit.", "invalid_context_snapshot");
  }
  const snapshots = value.map(normalizeRoutineContextSnapshotItem);
  assertUnique(snapshots.map((item) => item.bindingId), "Routine context snapshot binding identities must be unique.", "duplicate_snapshot_binding");
  snapshots.sort((left, right) => compareNullableText(left.routineStepId, right.routineStepId) || compareText(left.bindingId, right.bindingId));
  return snapshots;
}

export function createCanonicalRoutineRun(
  input: CreateCanonicalRoutineRunInput,
  revision: RoutineRevisionSnapshot
): RoutineRunRecord {
  assertExactKeys(
    input,
    ["id", "ownerId", "routineId", "routineRevisionId", "occurrenceId", "contextSnapshot", "startedAt"],
    "invalid_run",
    ["occurrenceId"]
  );
  const ownerId = normalizeOwnerId(input.ownerId);
  const routineId = normalizeRoutineId(input.routineId);
  const routineRevisionId = normalizeRoutineRevisionId(input.routineRevisionId);
  if (
    revision.revision.ownerId !== ownerId ||
    revision.revision.routineId !== routineId ||
    revision.revision.id !== routineRevisionId
  ) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Run revision does not match its Routine.", {
      reason: "run_revision_mismatch"
    });
  }
  const contextSnapshot = normalizeRoutineContextSnapshot(input.contextSnapshot);
  const revisionBindings = new Map(revision.bindings.map((binding) => [binding.id, binding]));
  if (contextSnapshot.length !== revision.bindings.length) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Run context snapshot is incomplete.", {
      reason: "incomplete_context_snapshot"
    });
  }
  for (const snapshot of contextSnapshot) {
    const binding = revisionBindings.get(snapshot.bindingId);
    if (
      !binding || binding.routineStepId !== snapshot.routineStepId || binding.targetType !== snapshot.targetType ||
      binding.targetId !== snapshot.targetId
    ) {
      throw new LifeLinkDomainError("routine_reference_conflict", "Routine Run context snapshot does not match its revision.", {
        reason: "context_snapshot_mismatch"
      });
    }
  }
  const startedAt = normalizeTimestamp(input.startedAt);
  return {
    id: normalizeRoutineRunId(input.id),
    ownerId,
    routineId,
    routineRevisionId,
    occurrenceId: normalizeNullableOccurrenceId(input.occurrenceId),
    status: "active",
    contextSnapshot,
    stepResults: [],
    startedAt,
    updatedAt: startedAt
  };
}

export function applyRoutineRunStepResult(
  run: RoutineRunRecord,
  step: RoutineStepRecord,
  command: PutRoutineRunStepResultCommand,
  updatedAtValue: string
): RoutineRunRecord {
  if (normalizeRoutineRunId(command.runId) !== run.id || normalizeRoutineStepId(command.routineStepId) !== step.id) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Run result target does not match.", {
      reason: "run_result_target_mismatch"
    });
  }
  if (run.ownerId !== step.ownerId || run.routineRevisionId !== step.routineRevisionId) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Step does not belong to the Run revision.", {
      reason: "run_step_revision_mismatch"
    });
  }
  if (run.status !== "active") {
    throw new LifeLinkDomainError("routine_conflict", "Finalized Routine Run cannot be changed.", {
      reason: "run_finalized"
    });
  }
  const desired: RoutineRunStepResult = {
    routineStepId: step.id,
    actualValues: normalizeRoutineResultValues(command.actualValues, step.plannedValues),
    proposedNextValues: normalizeRoutineResultValues(command.proposedNextValues, step.plannedValues),
    notes: normalizeBoundedText(command.notes ?? "", MAX_BODY_LENGTH, false, "invalid_result_notes")
  };
  const existing = run.stepResults.find((result) => result.routineStepId === step.id);
  if (existing && equalJson(existing, desired)) return run;
  assertRoutineFresh(command.expectedUpdatedAt, run.updatedAt, "stale_run");
  const updatedAt = normalizeTimestamp(updatedAtValue);
  const stepResults = run.stepResults.filter((result) => result.routineStepId !== step.id);
  stepResults.push(desired);
  stepResults.sort((left, right) => compareText(left.routineStepId, right.routineStepId));
  return { ...run, stepResults, updatedAt };
}

export function buildRoutineSessionFromRun(
  run: RoutineRunRecord,
  sessionIdValue: string,
  resultIdentitiesValue: readonly RoutineSessionResultIdentity[],
  completedAtValue: string
): BuiltRoutineSession {
  if (run.status !== "active") {
    throw new LifeLinkDomainError("routine_conflict", "Routine Run is already finalized.", { reason: "run_finalized" });
  }
  const sessionId = normalizeRoutineSessionId(sessionIdValue);
  const completedAt = normalizeTimestamp(completedAtValue);
  if (Date.parse(completedAt) < Date.parse(run.startedAt)) {
    throw invalidRoutine("Routine Session cannot complete before its Run starts.", "session_completed_before_start");
  }
  const resultIdentities = resultIdentitiesValue.map((identity) => ({
    routineStepId: normalizeRoutineStepId(identity.routineStepId),
    id: normalizeRoutineSessionResultId(identity.id)
  }));
  assertUnique(resultIdentities.map((item) => item.routineStepId), "Session result Step identities must be unique.", "duplicate_session_step");
  assertUnique(resultIdentities.map((item) => item.id), "Session result identities must be unique.", "duplicate_session_result_id");
  if (resultIdentities.length !== run.stepResults.length) {
    throw invalidRoutine("Session result identities must cover every recorded Run Step.", "incomplete_session_result_ids");
  }
  const identityByStep = new Map(resultIdentities.map((item) => [item.routineStepId, item.id]));
  const stepResults = run.stepResults.map((result): RoutineSessionStepResultRecord => {
    const id = identityByStep.get(result.routineStepId);
    if (!id) throw invalidRoutine("Session result identities must cover every recorded Run Step.", "incomplete_session_result_ids");
    return {
      id,
      ownerId: run.ownerId,
      sessionId,
      routineStepId: result.routineStepId,
      actualValues: cloneRoutineValues(result.actualValues),
      proposedNextValues: cloneRoutineValues(result.proposedNextValues),
      notes: result.notes
    };
  });
  const session: RoutineSessionRecord = {
    id: sessionId,
    ownerId: run.ownerId,
    routineId: run.routineId,
    routineRevisionId: run.routineRevisionId,
    runId: run.id,
    occurrenceId: run.occurrenceId,
    contextSnapshot: cloneContextSnapshot(run.contextSnapshot),
    startedAt: run.startedAt,
    completedAt
  };
  return {
    finalizedRun: { ...run, status: "finalized", updatedAt: completedAt },
    session,
    stepResults
  };
}

export function createCanonicalRoutineSessionAmendment(
  input: CreateCanonicalRoutineSessionAmendmentInput
): RoutineSessionAmendmentRecord {
  const { command, session } = input;
  const ownerId = normalizeOwnerId(input.ownerId);
  if (session.ownerId !== ownerId || normalizeRoutineSessionId(command.sessionId) !== session.id) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Session amendment does not match its owner or Session.", {
      reason: "amendment_session_mismatch"
    });
  }
  const stepResult = input.stepResult ?? null;
  const stepResultId = command.stepResultId === undefined || command.stepResultId === null
    ? null
    : normalizeRoutineSessionResultId(command.stepResultId);
  if (stepResultId === null) {
    if (stepResult !== null || command.correctedActualValues != null || command.correctedProposedNextValues != null) {
      throw new LifeLinkDomainError("routine_reference_conflict", "Session-level amendment cannot correct Step values.", {
        reason: "session_amendment_has_step_values"
      });
    }
  } else if (
    !stepResult || stepResult.id !== stepResultId || stepResult.sessionId !== session.id || stepResult.ownerId !== ownerId
  ) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Session Step result does not match the amendment.", {
      reason: "amendment_step_result_mismatch"
    });
  }
  const plannedValues = input.plannedValues === undefined ? [] : normalizeRoutineValues(input.plannedValues);
  if (stepResultId !== null && input.plannedValues === undefined) {
    throw invalidRoutine("Step amendment requires its revision Step value declarations.", "missing_planned_values");
  }
  return {
    id: normalizeRoutineSessionAmendmentId(command.id),
    ownerId,
    sessionId: session.id,
    stepResultId,
    note: normalizeBoundedText(command.note, MAX_BODY_LENGTH, true, "invalid_amendment_note"),
    correctedActualValues: command.correctedActualValues === undefined || command.correctedActualValues === null
      ? null
      : normalizeRoutineResultValues(command.correctedActualValues, plannedValues),
    correctedProposedNextValues: command.correctedProposedNextValues === undefined || command.correctedProposedNextValues === null
      ? null
      : normalizeRoutineResultValues(command.correctedProposedNextValues, plannedValues),
    createdAt: normalizeTimestamp(command.createdAt)
  };
}

export function projectRoutineSessionWithAmendments(
  session: RoutineSessionRecord,
  stepResultsValue: readonly RoutineSessionStepResultRecord[],
  amendmentsValue: readonly RoutineSessionAmendmentRecord[]
): RoutineSessionProjection {
  const stepResults = stepResultsValue.filter((result) => result.sessionId === session.id && result.ownerId === session.ownerId);
  assertUnique(stepResults.map((result) => result.id), "Session result identities must be unique.", "duplicate_session_result_id");
  const resultIds = new Set(stepResults.map((result) => result.id));
  const amendments = amendmentsValue
    .filter((amendment) => amendment.sessionId === session.id && amendment.ownerId === session.ownerId)
    .map(cloneAmendment)
    .sort((left, right) => compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id));
  assertUnique(amendments.map((amendment) => amendment.id), "Session amendment identities must be unique.", "duplicate_amendment_id");
  if (amendments.some((amendment) => amendment.stepResultId !== null && !resultIds.has(amendment.stepResultId))) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine Session amendment references a different Session result.", {
      reason: "amendment_step_result_mismatch"
    });
  }
  return {
    session: { ...session, contextSnapshot: cloneContextSnapshot(session.contextSnapshot) },
    stepResults: stepResults.map((result) => {
      const resultAmendments = amendments.filter((amendment) => amendment.stepResultId === result.id);
      let effectiveActualValues = cloneRoutineValues(result.actualValues);
      let effectiveProposedNextValues = cloneRoutineValues(result.proposedNextValues);
      for (const amendment of resultAmendments) {
        if (amendment.correctedActualValues !== null) effectiveActualValues = cloneRoutineValues(amendment.correctedActualValues);
        if (amendment.correctedProposedNextValues !== null) {
          effectiveProposedNextValues = cloneRoutineValues(amendment.correctedProposedNextValues);
        }
      }
      return {
        original: { ...result, actualValues: cloneRoutineValues(result.actualValues), proposedNextValues: cloneRoutineValues(result.proposedNextValues) },
        effectiveActualValues,
        effectiveProposedNextValues,
        amendments: resultAmendments
      };
    }),
    sessionAmendments: amendments.filter((amendment) => amendment.stepResultId === null)
  };
}

export function assertRoutineFresh(expectedUpdatedAtValue: string, actualUpdatedAtValue: string, reason = "stale_record"): void {
  const expectedUpdatedAt = normalizeTimestamp(expectedUpdatedAtValue);
  const actualUpdatedAt = normalizeTimestamp(actualUpdatedAtValue);
  if (expectedUpdatedAt !== actualUpdatedAt) {
    throw new LifeLinkDomainError("stale_routine", "Routine state changed before this operation completed.", {
      retryable: true,
      reason
    });
  }
}

function normalizeRoutineStep(input: CreateRoutineStepInput, ownerId: string, revisionId: string): RoutineStepRecord {
  assertExactKeys(
    input,
    ["id", "activityId", "activityTitle", "position", "instructions", "optional", "plannedValues"],
    "invalid_step",
    ["instructions", "optional", "plannedValues"]
  );
  if (!Number.isSafeInteger(input.position) || input.position < 0) {
    throw invalidRoutine("Routine Step position is invalid.", "invalid_step_position");
  }
  return {
    id: normalizeRoutineStepId(input.id),
    ownerId,
    routineRevisionId: revisionId,
    activityId: normalizeActivityId(input.activityId),
    activityTitle: normalizeBoundedText(input.activityTitle, MAX_TITLE_LENGTH, true, "invalid_activity_title"),
    position: input.position,
    instructions: normalizeBoundedText(input.instructions ?? "", MAX_BODY_LENGTH, false, "invalid_step_instructions"),
    optional: input.optional === undefined ? false : normalizeBoolean(input.optional, "invalid_step_optional"),
    plannedValues: normalizeRoutineValues(input.plannedValues ?? [])
  };
}

function normalizeRoutineContextBinding(
  input: CreateRoutineContextBindingInput,
  ownerId: string,
  revisionId: string,
  stepIds: ReadonlySet<string>
): RoutineContextBindingRecord {
  assertExactKeys(input, ["id", "routineStepId", "targetType", "targetId"], "invalid_binding", ["routineStepId"]);
  if (input.targetType !== "life_link" && input.targetType !== "collection") {
    throw invalidRoutine("Routine context target type is invalid.", "invalid_binding_target_type");
  }
  const routineStepId = input.routineStepId === undefined || input.routineStepId === null
    ? null
    : normalizeRoutineStepId(input.routineStepId);
  if (routineStepId !== null && !stepIds.has(routineStepId)) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Routine context binding references a Step outside its revision.", {
      reason: "binding_step_mismatch"
    });
  }
  return {
    id: normalizeRoutineBindingId(input.id),
    ownerId,
    routineRevisionId: revisionId,
    routineStepId,
    targetType: input.targetType,
    targetId: normalizeContextTargetId(input.targetId, input.targetType)
  };
}

function normalizeRoutineContextSnapshotItem(value: unknown): RoutineContextSnapshot {
  if (!isPlainObject(value)) throw invalidRoutine("Routine context snapshot item is invalid.", "invalid_context_snapshot");
  assertExactKeys(
    value,
    ["bindingId", "routineStepId", "targetType", "targetId", "targetTitle", "targetSourceUpdatedAt", "resolvedLifeLinks"],
    "invalid_context_snapshot"
  );
  if (value.targetType !== "life_link" && value.targetType !== "collection") {
    throw invalidRoutine("Routine context snapshot target type is invalid.", "invalid_context_snapshot_target_type");
  }
  if (!Array.isArray(value.resolvedLifeLinks)) {
    throw invalidRoutine("Routine context snapshot members are invalid.", "invalid_context_snapshot_members");
  }
  const resolvedLifeLinks = value.resolvedLifeLinks.map((member) => {
    if (!isPlainObject(member)) throw invalidRoutine("Routine context snapshot member is invalid.", "invalid_context_snapshot_member");
    assertExactKeys(member, ["lifeLinkId", "title", "sourceUpdatedAt"], "invalid_context_snapshot_member");
    return {
      lifeLinkId: normalizeLifeLinkReferenceId(member.lifeLinkId),
      title: normalizeBoundedText(member.title, MAX_TITLE_LENGTH, true, "invalid_context_snapshot_title"),
      sourceUpdatedAt: normalizeTimestamp(member.sourceUpdatedAt)
    };
  });
  assertUnique(resolvedLifeLinks.map((member) => member.lifeLinkId), "Routine context snapshot members must be unique.", "duplicate_snapshot_member");
  resolvedLifeLinks.sort((left, right) => compareText(left.lifeLinkId, right.lifeLinkId));
  const targetId = normalizeContextTargetId(value.targetId, value.targetType);
  if (value.targetType === "life_link" && (resolvedLifeLinks.length !== 1 || resolvedLifeLinks[0].lifeLinkId !== targetId)) {
    throw new LifeLinkDomainError("routine_reference_conflict", "Life Link binding snapshot must resolve exactly its bound Life Link.", {
      reason: "life_link_snapshot_mismatch"
    });
  }
  return {
    bindingId: normalizeRoutineBindingId(value.bindingId),
    routineStepId: value.routineStepId === null ? null : normalizeRoutineStepId(value.routineStepId),
    targetType: value.targetType,
    targetId,
    targetTitle: normalizeBoundedText(value.targetTitle, MAX_TITLE_LENGTH, true, "invalid_context_snapshot_title"),
    targetSourceUpdatedAt: normalizeTimestamp(value.targetSourceUpdatedAt),
    resolvedLifeLinks
  };
}

function normalizeRoutineValue(value: unknown): RoutineValue {
  if (!isPlainObject(value) || !["number", "quantity", "duration", "text", "boolean"].includes(String(value.kind))) {
    throw invalidRoutine("Routine value is invalid.", "invalid_value");
  }
  const common = {
    key: normalizeRoutineValueKey(value.key),
    label: normalizeBoundedText(value.label, MAX_ROUTINE_VALUE_LABEL_LENGTH, true, "invalid_value_label")
  };
  if (value.kind === "number") {
    assertExactKeys(value, ["key", "label", "kind", "value"], "invalid_value");
    return { ...common, kind: "number", value: normalizeFiniteNumber(value.value, "invalid_number_value") };
  }
  if (value.kind === "quantity") {
    assertExactKeys(value, ["key", "label", "kind", "amount", "unit"], "invalid_value");
    return {
      ...common,
      kind: "quantity",
      amount: normalizeFiniteNumber(value.amount, "invalid_quantity_amount"),
      unit: normalizeBoundedText(value.unit, MAX_ROUTINE_UNIT_LENGTH, true, "invalid_quantity_unit")
    };
  }
  if (value.kind === "duration") {
    assertExactKeys(value, ["key", "label", "kind", "seconds"], "invalid_value");
    const seconds = value.seconds;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds < 0) {
      throw invalidRoutine("Routine duration must be nonnegative whole seconds.", "invalid_duration_seconds");
    }
    return { ...common, kind: "duration", seconds };
  }
  if (value.kind === "text") {
    assertExactKeys(value, ["key", "label", "kind", "text"], "invalid_value");
    return { ...common, kind: "text", text: normalizeBoundedText(value.text, MAX_ROUTINE_TEXT_VALUE_LENGTH, false, "invalid_text_value") };
  }
  assertExactKeys(value, ["key", "label", "kind", "value"], "invalid_value");
  return { ...common, kind: "boolean", value: normalizeBoolean(value.value, "invalid_boolean_value") };
}

function normalizeRoutineEntityId(value: unknown, prefix: string, reason: string): string {
  if (typeof value !== "string") throw invalidRoutine("Routine identity is invalid.", reason);
  const normalized = value.trim().toLowerCase();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escapedPrefix}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(normalized)) {
    throw invalidRoutine("Routine identity must be a prefixed UUID.", reason);
  }
  return normalized;
}

function normalizeOwnerId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidRoutine("Routine owner identity is invalid.", "invalid_owner");
  return value.trim();
}

function normalizeNullableRoutineGroupId(value: unknown): string | null {
  return value === undefined || value === null ? null : normalizeRoutineGroupId(value);
}

function normalizeNullableOccurrenceId(value: unknown): string | null {
  return value === undefined || value === null ? null : normalizeRoutineOccurrenceId(value);
}

function normalizeContextTargetId(value: unknown, targetType: RoutineContextTargetType): string {
  if (targetType === "collection") return normalizeCollectionReferenceId(value);
  return normalizeLifeLinkReferenceId(value);
}

function normalizeCollectionReferenceId(value: unknown): string {
  if (typeof value !== "string") throw invalidRoutine("Collection reference identity is invalid.", "invalid_binding_target_id");
  const normalized = value.trim().toLowerCase();
  if (!/^collection-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw invalidRoutine("Collection reference identity must be a prefixed UUID.", "invalid_binding_target_id");
  }
  return normalized;
}

function normalizeLifeLinkReferenceId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidRoutine("Life Link reference identity is invalid.", "invalid_binding_target_id");
  return value.trim();
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw invalidRoutine("Routine timestamp is invalid.", "invalid_timestamp");
  }
  return value;
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : normalizeTimestamp(value);
}

function normalizeBoundedText(value: unknown, limit: number, required: boolean, reason: string): string {
  if (typeof value !== "string") throw invalidRoutine("Routine text value must be a string.", reason);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if ((required && !normalized) || normalized.length > limit) {
    throw invalidRoutine("Routine text value is empty or exceeds the supported limit.", reason);
  }
  return normalized;
}

function normalizeFiniteNumber(value: unknown, reason: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidRoutine("Routine numeric value is invalid.", reason);
  return Object.is(value, -0) ? 0 : value;
}

function normalizeBoolean(value: unknown, reason: string): boolean {
  if (typeof value !== "boolean") throw invalidRoutine("Routine yes/no value is invalid.", reason);
  return value;
}

function normalizeIsoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidRoutine("Routine local date is invalid.", "invalid_local_date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(0, month - 1, day));
  candidate.setUTCFullYear(year);
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw invalidRoutine("Routine local date is invalid.", "invalid_local_date");
  }
  return value;
}

function normalizeLocalTime(value: unknown): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw invalidRoutine("Routine local time must use HH:MM minute precision.", "invalid_local_time");
  }
  return value;
}

function normalizeScheduleInterval(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_ROUTINE_SCHEDULE_INTERVAL) {
    throw invalidRoutine("Routine schedule interval is invalid.", "invalid_schedule_interval");
  }
  return value;
}

function assertDateRange(startDate: string, endDate: string | null): void {
  if (endDate !== null && endDate < startDate) {
    throw invalidRoutine("Routine schedule end date precedes its start date.", "invalid_schedule_date_range");
  }
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((isoDateOrdinal(endDate) - isoDateOrdinal(startDate)) / 86_400_000);
}

function addIsoDays(date: string, amount: number): string {
  return new Date(isoDateOrdinal(date) + amount * 86_400_000).toISOString().slice(0, 10);
}

function isoDateOrdinal(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const candidate = new Date(Date.UTC(0, month - 1, day));
  candidate.setUTCFullYear(year);
  return candidate.getTime();
}

function weekdayForDate(date: string): RoutineWeekday {
  const sundayFirst = new Date(isoDateOrdinal(date)).getUTCDay();
  return ROUTINE_WEEKDAYS[(sundayFirst + 6) % 7];
}

function localMinuteOrdinal(date: string, time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return isoDateOrdinal(date) + hour * 3_600_000 + minute * 60_000;
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
  return localMinuteOrdinal(`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`);
}

function cloneRoutineValues(values: readonly RoutineValue[]): RoutineValue[] {
  return values.map((value) => ({ ...value }));
}

function cloneContextSnapshot(values: readonly RoutineContextSnapshot[]): RoutineContextSnapshot[] {
  return values.map((value) => ({ ...value, resolvedLifeLinks: value.resolvedLifeLinks.map((member) => ({ ...member })) }));
}

function cloneAmendment(value: RoutineSessionAmendmentRecord): RoutineSessionAmendmentRecord {
  return {
    ...value,
    correctedActualValues: value.correctedActualValues === null ? null : cloneRoutineValues(value.correctedActualValues),
    correctedProposedNextValues: value.correctedProposedNextValues === null ? null : cloneRoutineValues(value.correctedProposedNextValues)
  };
}

function compareRoutineBinding(left: RoutineContextBindingRecord, right: RoutineContextBindingRecord): number {
  return compareNullableText(left.routineStepId, right.routineStepId) ||
    compareText(left.targetType, right.targetType) || compareText(left.targetId, right.targetId) || compareText(left.id, right.id);
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareText(left, right);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUnique(values: readonly string[], message: string, reason: string): void {
  if (new Set(values).size !== values.length) throw invalidRoutine(message, reason);
}

function assertExactKeys(
  value: unknown,
  allowedKeys: readonly string[],
  reason: string,
  optionalKeys: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidRoutine("Routine value must be an object.", reason);
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  if (Object.keys(value).some((key) => !allowed.has(key)) || allowedKeys.some((key) => !optional.has(key) && !hasOwn(value, key))) {
    throw invalidRoutine("Routine value contains missing or unsupported fields.", reason);
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

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
}

function invalidRoutine(message: string, reason: string): LifeLinkDomainError {
  return new LifeLinkDomainError("invalid_routine", message, { reason });
}
