import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ID_PREFIX,
  LIFE_LINK_DOMAIN_ERROR_CODES,
  ROUTINE_BINDING_ID_PREFIX,
  ROUTINE_GROUP_ID_PREFIX,
  ROUTINE_ID_PREFIX,
  ROUTINE_OCCURRENCE_ID_PREFIX,
  ROUTINE_REVISION_ID_PREFIX,
  ROUTINE_RUN_ID_PREFIX,
  ROUTINE_SCHEDULE_ID_PREFIX,
  ROUTINE_SESSION_AMENDMENT_ID_PREFIX,
  ROUTINE_SESSION_ID_PREFIX,
  ROUTINE_SESSION_RESULT_ID_PREFIX,
  ROUTINE_STEP_ID_PREFIX,
  LifeLinkDomainError,
  applyActivityPatch,
  applyRoutinePatch,
  applyRoutineRunStepResult,
  applyRoutineSchedulePatch,
  assertRoutineFresh,
  buildRoutineSessionFromRun,
  createCanonicalActivity,
  createCanonicalRoutine,
  createCanonicalRoutineGroup,
  createCanonicalRoutineOccurrence,
  createCanonicalRoutineRun,
  createCanonicalRoutineSchedule,
  createCanonicalRoutineSessionAmendment,
  listRoutineScheduleLocalDates,
  normalizeRoutineResultValues,
  normalizeRoutineScheduleRule,
  normalizeRoutineValues,
  projectRoutineSessionWithAmendments,
  planRoutineRevisionScheduling,
  resolveRoutineSchedulePlannedFor,
  reviseCanonicalRoutine,
  routineScheduleMatchesLocalDate,
  transitionRoutineOccurrenceStatus,
  type RoutineContextSnapshot,
  type RoutineValue
} from "./index.js";

const OWNER_ID = "owner-alpha";
const NOW = "2026-09-01T12:00:00.000Z";
const LATER = "2026-09-01T12:01:00.000Z";
const COMPLETED = "2026-09-01T12:02:00.000Z";
const AMENDED = "2026-09-01T12:03:00.000Z";
const id = (prefix: string, number: number): string =>
  `${prefix}00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const collectionId = id("collection-", 1);

const plannedValues: RoutineValue[] = [
  { key: "count", label: "Count", kind: "number", value: 1 },
  { key: "comment", label: "Comment", kind: "text", text: "steady" },
  { key: "ready", label: "Ready", kind: "boolean", value: true }
];

function createFixture() {
  const activity = createCanonicalActivity({
    id: id(ACTIVITY_ID_PREFIX, 1),
    ownerId: OWNER_ID,
    title: "Inspect shelf",
    notes: "General-purpose action",
    createdAt: NOW
  });
  const creation = createCanonicalRoutine({
    id: id(ROUTINE_ID_PREFIX, 1),
    revisionId: id(ROUTINE_REVISION_ID_PREFIX, 1),
    ownerId: OWNER_ID,
    groupId: id(ROUTINE_GROUP_ID_PREFIX, 1),
    title: "Weekly shelf review",
    purpose: "Keep a physical area current",
    instructions: "Follow the ordered Steps.",
    ordering: "ordered",
    steps: [{
      id: id(ROUTINE_STEP_ID_PREFIX, 1),
      activityId: activity.id,
      activityTitle: activity.title,
      position: 0,
      instructions: "Inspect and record.",
      plannedValues
    }],
    bindings: [
      {
        id: id(ROUTINE_BINDING_ID_PREFIX, 2),
        targetType: "collection",
        targetId: collectionId
      },
      {
        id: id(ROUTINE_BINDING_ID_PREFIX, 1),
        routineStepId: id(ROUTINE_STEP_ID_PREFIX, 1),
        targetType: "life_link",
        targetId: "shelf-label"
      }
    ],
    createdAt: NOW
  });
  return { activity, creation };
}

function contextSnapshot(): RoutineContextSnapshot[] {
  return [
    {
      bindingId: id(ROUTINE_BINDING_ID_PREFIX, 2),
      routineStepId: null,
      targetType: "collection",
      targetId: collectionId,
      targetTitle: "Workshop",
      targetSourceUpdatedAt: NOW,
      resolvedLifeLinks: [
        { lifeLinkId: "bin-b", title: "Bin B", sourceUpdatedAt: NOW },
        { lifeLinkId: "bin-a", title: "Bin A", sourceUpdatedAt: NOW }
      ]
    },
    {
      bindingId: id(ROUTINE_BINDING_ID_PREFIX, 1),
      routineStepId: id(ROUTINE_STEP_ID_PREFIX, 1),
      targetType: "life_link",
      targetId: "shelf-label",
      targetTitle: "Shelf label",
      targetSourceUpdatedAt: NOW,
      resolvedLifeLinks: [{ lifeLinkId: "shelf-label", title: "Shelf label", sourceUpdatedAt: NOW }]
    }
  ];
}

describe("Routines closed domain model", () => {
  it("adds only the bounded Routine error family and canonicalizes groups and activities", () => {
    expect(LIFE_LINK_DOMAIN_ERROR_CODES).toEqual(expect.arrayContaining([
      "invalid_routine",
      "routine_not_found",
      "stale_routine",
      "routine_conflict",
      "routine_reference_conflict"
    ]));
    const group = createCanonicalRoutineGroup({
      id: ` ${id(ROUTINE_GROUP_ID_PREFIX, 1).toUpperCase()} `,
      ownerId: ` ${OWNER_ID} `,
      title: " Home care ",
      notes: " First\r\nSecond ",
      createdAt: NOW
    });
    expect(group).toMatchObject({ ownerId: OWNER_ID, title: "Home care", notes: "First\nSecond", archivedAt: null });
    const activity = createCanonicalActivity({
      id: id(ACTIVITY_ID_PREFIX, 1), ownerId: OWNER_ID, title: "Inspect", createdAt: NOW
    });
    expect(applyActivityPatch(activity, { archivedAt: LATER }, LATER)).toMatchObject({ archivedAt: LATER, updatedAt: LATER });
  });

  it("uses closed typed values with stable Step-local keys and no metadata bag", () => {
    expect(normalizeRoutineValues([
      { key: " LEVEL ", label: " Level ", kind: "quantity", amount: 2.5, unit: " cm " },
      { key: "elapsed", label: "Elapsed", kind: "duration", seconds: 90 },
      { key: "answer", label: "Answer", kind: "boolean", value: false }
    ])).toEqual([
      { key: "level", label: "Level", kind: "quantity", amount: 2.5, unit: "cm" },
      { key: "elapsed", label: "Elapsed", kind: "duration", seconds: 90 },
      { key: "answer", label: "Answer", kind: "boolean", value: false }
    ]);
    expect(() => normalizeRoutineValues([
      { key: "count", label: "Count", kind: "number", value: 1, metadata: { unit: "anything" } }
    ])).toThrow(expect.objectContaining({ code: "invalid_routine" }));
    expect(() => normalizeRoutineValues([
      { key: "same", label: "One", kind: "number", value: 1 },
      { key: "SAME", label: "Two", kind: "number", value: 2 }
    ])).toThrow(expect.objectContaining({ reason: "duplicate_value_key" }));
    expect(() => normalizeRoutineResultValues([
      { key: "other", label: "Other", kind: "number", value: 2 }
    ], plannedValues)).toThrow(expect.objectContaining({ reason: "invalid_result_value" }));
  });

  it("creates complete immutable revisions and snapshots Activity titles", () => {
    const { activity, creation } = createFixture();
    expect(creation.routine.currentRevisionId).toBe(creation.currentRevision.revision.id);
    expect(creation.currentRevision.steps).toHaveLength(1);
    expect(creation.currentRevision.steps[0]).toMatchObject({
      activityId: activity.id,
      activityTitle: "Inspect shelf",
      position: 0,
      optional: false
    });
    expect(creation.currentRevision.bindings.map((binding) => binding.routineStepId)).toEqual([
      null,
      id(ROUTINE_STEP_ID_PREFIX, 1)
    ]);

    const renamedActivity = applyActivityPatch(activity, { title: "Renamed later" }, LATER);
    expect(renamedActivity.title).toBe("Renamed later");
    expect(creation.currentRevision.steps[0].activityTitle).toBe("Inspect shelf");

    const revised = reviseCanonicalRoutine(creation.routine, {
      id: id(ROUTINE_REVISION_ID_PREFIX, 2),
      ownerId: OWNER_ID,
      routineId: creation.routine.id,
      expectedCurrentRevisionId: creation.currentRevision.revision.id,
      revisionNumber: 2,
      title: "Weekly shelf review v2",
      steps: [{
        id: id(ROUTINE_STEP_ID_PREFIX, 2),
        activityId: activity.id,
        activityTitle: renamedActivity.title,
        position: 0
      }],
      createdAt: LATER
    }, creation.currentRevision.revision);
    expect(revised.routine.currentRevisionId).toBe(id(ROUTINE_REVISION_ID_PREFIX, 2));
    expect(creation.currentRevision.revision.title).toBe("Weekly shelf review");
    expect(creation.currentRevision.steps[0].activityTitle).toBe("Inspect shelf");
    expect(() => reviseCanonicalRoutine(creation.routine, {
      id: id(ROUTINE_REVISION_ID_PREFIX, 3), ownerId: OWNER_ID, routineId: creation.routine.id,
      expectedCurrentRevisionId: id(ROUTINE_REVISION_ID_PREFIX, 99), revisionNumber: 3,
      title: "Stale", steps: [], createdAt: LATER
    }, creation.currentRevision.revision)).toThrow(expect.objectContaining({ code: "stale_routine", retryable: true, reason: "stale_current_revision" }));
  });

  it("defaults new Routines to unordered, rejects invalid modes, and inherits an omitted revision mode", () => {
    const command = { id: id(ROUTINE_ID_PREFIX, 1), revisionId: id(ROUTINE_REVISION_ID_PREFIX, 1), ownerId: OWNER_ID,
      title: "Flexible routine", steps: [], createdAt: NOW };
    expect(createCanonicalRoutine(command).currentRevision.revision.ordering).toBe("unordered");
    for (const ordering of [null, "random", true, "ORDERED"]) {
      expect(() => createCanonicalRoutine({ ...command, ordering } as never)).toThrow(expect.objectContaining({ reason: "invalid_ordering" }));
    }
    for (const ordering of ["ordered", "unordered"] as const) {
      const original = createCanonicalRoutine({ ...command, ordering });
      const revision = { id: id(ROUTINE_REVISION_ID_PREFIX, 2), routineId: original.routine.id, ownerId: OWNER_ID,
        expectedCurrentRevisionId: original.routine.currentRevisionId, revisionNumber: 2, title: "Future routine", steps: [], createdAt: LATER };
      expect(reviseCanonicalRoutine(original.routine, revision, original.currentRevision.revision).currentRevision.revision.ordering).toBe(ordering);
      expect(reviseCanonicalRoutine(original.routine, { ...revision, ordering: "unordered" }, original.currentRevision.revision).currentRevision.revision.ordering).toBe("unordered");
      expect(() => reviseCanonicalRoutine(original.routine, { ...revision, ordering: null } as never, original.currentRevision.revision))
        .toThrow(expect.objectContaining({ reason: "invalid_ordering" }));
      expect(original.currentRevision.revision.ordering).toBe(ordering);
    }
  });

  it("re-pins only active schedules and strictly future planned occurrences without any Run", () => {
    const { creation } = createFixture();
    const schedule = createCanonicalRoutineSchedule({ id: id(ROUTINE_SCHEDULE_ID_PREFIX, 1), ownerId: OWNER_ID,
      routineId: creation.routine.id, routineRevisionId: creation.routine.currentRevisionId,
      rule: { kind: "once", localDate: "2026-09-02", localTime: "12:00", timeZone: "UTC" }, createdAt: NOW });
    const inactive = { ...schedule, id: id(ROUTINE_SCHEDULE_ID_PREFIX, 2), active: false };
    const foreign = { ...schedule, id: id(ROUTINE_SCHEDULE_ID_PREFIX, 3), ownerId: "another-owner" };
    const occurrence = createCanonicalRoutineOccurrence(schedule, { id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 1), localDate: "2026-09-02", createdAt: NOW });
    const occurrences = [occurrence,
      ...(["canceled", "skipped", "started", "completed"] as const).map((status, index) => ({ ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, index + 2), status })),
      { ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 6), plannedFor: NOW },
      { ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 7), plannedFor: "2026-08-31T12:00:00.000Z" },
      { ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 8) },
      { ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 9), scheduleId: inactive.id },
      { ...occurrence, id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 10), ownerId: foreign.ownerId }];
    const before = structuredClone({ schedules: [schedule, inactive, foreign], occurrences });
    const revision = { ...creation.currentRevision.revision, id: id(ROUTINE_REVISION_ID_PREFIX, 2), revisionNumber: 2, ordering: "unordered" as const };
    const changed = planRoutineRevisionScheduling(revision, before.schedules, occurrences, new Set([occurrences[7].id]));
    expect(changed.schedules).toEqual([{ ...schedule, routineRevisionId: revision.id, revision: 2, updatedAt: "2026-09-01T12:00:00.001Z" }]);
    expect(changed.occurrences).toEqual([{ ...occurrence, routineRevisionId: revision.id, scheduleRevision: 2, updatedAt: "2026-09-01T12:00:00.001Z" }]);
    expect({ schedules: [schedule, inactive, foreign], occurrences }).toEqual(before);
    expect(planRoutineRevisionScheduling(revision, changed.schedules, changed.occurrences, new Set())).toEqual({ schedules: [], occurrences: [] });
  });

  it("supports one-time, daily, and weekly IANA schedule rules with bounded materialization", () => {
    const once = normalizeRoutineScheduleRule({
      kind: "once", localDate: "2026-09-01", localTime: "08:30", timeZone: "America/New_York"
    });
    expect(routineScheduleMatchesLocalDate(once, "2026-09-01")).toBe(true);
    const daily = normalizeRoutineScheduleRule({
      kind: "daily", startDate: "2026-09-01", intervalDays: 2, localTime: "08:30", timeZone: "UTC"
    });
    expect(listRoutineScheduleLocalDates(daily, "2026-09-01", "2026-09-06")).toEqual([
      "2026-09-01", "2026-09-03", "2026-09-05"
    ]);
    const weekly = normalizeRoutineScheduleRule({
      kind: "weekly",
      startDate: "2026-09-01",
      intervalWeeks: 2,
      weekdays: ["thursday", "tuesday", "thursday"],
      localTime: "08:30",
      timeZone: "UTC"
    });
    expect(weekly).toMatchObject({ weekdays: ["tuesday", "thursday"] });
    expect(listRoutineScheduleLocalDates(weekly, "2026-09-01", "2026-09-16")).toEqual([
      "2026-09-01", "2026-09-03", "2026-09-15"
    ]);
    expect(() => listRoutineScheduleLocalDates(daily, "2026-01-01", "2027-01-02"))
      .toThrow(expect.objectContaining({ reason: "materialization_window_too_large" }));
  });

  it("resolves DST gaps forward and chooses the earlier instant for overlaps", () => {
    expect(resolveRoutineSchedulePlannedFor({
      kind: "once", localDate: "2026-03-08", localTime: "02:30", timeZone: "America/New_York"
    }, "2026-03-08")).toBe("2026-03-08T07:00:00.000Z");
    expect(resolveRoutineSchedulePlannedFor({
      kind: "once", localDate: "2026-11-01", localTime: "01:30", timeZone: "America/New_York"
    }, "2026-11-01")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("pins schedule revisions into occurrences and enforces occurrence transitions", () => {
    const { creation } = createFixture();
    const schedule = createCanonicalRoutineSchedule({
      id: id(ROUTINE_SCHEDULE_ID_PREFIX, 1), ownerId: OWNER_ID, routineId: creation.routine.id,
      routineRevisionId: creation.currentRevision.revision.id,
      rule: { kind: "daily", startDate: "2026-09-01", intervalDays: 1, localTime: "08:00", timeZone: "UTC" },
      createdAt: NOW
    });
    const revisedSchedule = applyRoutineSchedulePatch(schedule, creation.currentRevision.revision.id, {
      rule: { kind: "daily", startDate: "2026-09-01", intervalDays: 2, localTime: "08:00", timeZone: "UTC" }
    }, LATER);
    expect(revisedSchedule.revision).toBe(2);
    const occurrence = createCanonicalRoutineOccurrence(revisedSchedule, {
      id: id(ROUTINE_OCCURRENCE_ID_PREFIX, 1), localDate: "2026-09-03", createdAt: LATER
    });
    expect(occurrence).toMatchObject({ scheduleRevision: 2, routineRevisionId: creation.currentRevision.revision.id, status: "planned" });
    const started = transitionRoutineOccurrenceStatus(occurrence, "started", COMPLETED);
    expect(transitionRoutineOccurrenceStatus(started, "completed", AMENDED).status).toBe("completed");
    expect(() => transitionRoutineOccurrenceStatus(started, "skipped", AMENDED))
      .toThrow(expect.objectContaining({ code: "routine_conflict", reason: "invalid_occurrence_transition" }));
  });

  it("separates actual and proposed values, supports target-state replay, and finalizes immutable history", () => {
    const { creation } = createFixture();
    const run = createCanonicalRoutineRun({
      id: id(ROUTINE_RUN_ID_PREFIX, 1),
      ownerId: OWNER_ID,
      routineId: creation.routine.id,
      routineRevisionId: creation.currentRevision.revision.id,
      contextSnapshot: contextSnapshot(),
      startedAt: NOW
    }, creation.currentRevision);
    expect(run.contextSnapshot[0].resolvedLifeLinks.map((item) => item.lifeLinkId)).toEqual(["bin-a", "bin-b"]);
    expect(run.stepResults).toEqual([]);

    const command = {
      runId: run.id,
      routineStepId: creation.currentRevision.steps[0].id,
      expectedUpdatedAt: NOW,
      actualValues: [{ key: "count", label: "Count", kind: "number" as const, value: 2 }],
      proposedNextValues: [{ key: "count", label: "Count", kind: "number" as const, value: 3 }],
      notes: "Completed"
    };
    const updatedRun = applyRoutineRunStepResult(run, creation.currentRevision.steps[0], command, LATER);
    expect(updatedRun.stepResults[0]).toMatchObject({
      actualValues: [{ key: "count", value: 2 }],
      proposedNextValues: [{ key: "count", value: 3 }]
    });
    expect(applyRoutineRunStepResult(updatedRun, creation.currentRevision.steps[0], command, COMPLETED)).toBe(updatedRun);
    const databaseOrderedRun = {
      ...updatedRun,
      stepResults: [{
        actualValues: updatedRun.stepResults[0].actualValues,
        notes: updatedRun.stepResults[0].notes,
        proposedNextValues: updatedRun.stepResults[0].proposedNextValues,
        routineStepId: updatedRun.stepResults[0].routineStepId
      }]
    };
    expect(applyRoutineRunStepResult(databaseOrderedRun, creation.currentRevision.steps[0], command, COMPLETED))
      .toBe(databaseOrderedRun);
    expect(() => applyRoutineRunStepResult(updatedRun, creation.currentRevision.steps[0], {
      ...command,
      actualValues: [{ key: "count", label: "Count", kind: "number", value: 4 }]
    }, COMPLETED)).toThrow(expect.objectContaining({ code: "stale_routine", retryable: true, reason: "stale_run" }));

    expect(() => buildRoutineSessionFromRun(updatedRun, id(ROUTINE_SESSION_ID_PREFIX, 2), [{
      routineStepId: creation.currentRevision.steps[0].id,
      id: id(ROUTINE_SESSION_RESULT_ID_PREFIX, 2)
    }], "2026-08-31T23:59:59.000Z"))
      .toThrow(expect.objectContaining({ code: "invalid_routine", reason: "session_completed_before_start" }));

    const built = buildRoutineSessionFromRun(updatedRun, id(ROUTINE_SESSION_ID_PREFIX, 1), [{
      routineStepId: creation.currentRevision.steps[0].id,
      id: id(ROUTINE_SESSION_RESULT_ID_PREFIX, 1)
    }], COMPLETED);
    expect(built.finalizedRun.status).toBe("finalized");
    expect(built.session.routineRevisionId).toBe(creation.currentRevision.revision.id);
    updatedRun.contextSnapshot[0].resolvedLifeLinks[0].title = "mutated outside";
    expect(built.session.contextSnapshot[0].resolvedLifeLinks[0].title).toBe("Bin A");

    const amendment = createCanonicalRoutineSessionAmendment({
      ownerId: OWNER_ID,
      session: built.session,
      stepResult: built.stepResults[0],
      plannedValues,
      command: {
        id: id(ROUTINE_SESSION_AMENDMENT_ID_PREFIX, 1),
        sessionId: built.session.id,
        stepResultId: built.stepResults[0].id,
        note: "Corrected transcription",
        correctedActualValues: [{ key: "count", label: "Count", kind: "number", value: 4 }],
        createdAt: AMENDED
      }
    });
    const projection = projectRoutineSessionWithAmendments(built.session, built.stepResults, [amendment]);
    expect(projection.stepResults[0].original.actualValues[0]).toMatchObject({ value: 2 });
    expect(projection.stepResults[0].effectiveActualValues[0]).toMatchObject({ value: 4 });
    expect(built.stepResults[0].actualValues[0]).toMatchObject({ value: 2 });
  });

  it("archives safely and reports optimistic-concurrency conflicts with bounded reasons", () => {
    const { creation } = createFixture();
    const archived = applyRoutinePatch(creation.routine, { archivedAt: LATER }, LATER);
    expect(archived.archivedAt).toBe(LATER);
    expect(creation.routine.archivedAt).toBeNull();
    expect(() => assertRoutineFresh(NOW, LATER, "stale_routine_update")).toThrow(expect.objectContaining({
      code: "stale_routine", retryable: true, reason: "stale_routine_update"
    }));
    try {
      assertRoutineFresh(NOW, LATER);
    } catch (error) {
      expect(error).toBeInstanceOf(LifeLinkDomainError);
    }
  });
});
