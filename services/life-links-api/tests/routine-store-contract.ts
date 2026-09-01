import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { DEMO_GUEST_ID, DEMO_OWNER_ID, type RoutineValue } from "@life-links/core";

import type { LifeLinksStore } from "../src/store.js";

const id = (prefix: string) => `${prefix}-${randomUUID()}`;

export function routineStoreContract(getStore: () => LifeLinksStore): void {
  describe("general Routines store contract", () => {
    it("preserves a snapshotted immutable Session while future definitions and corrections advance", async () => {
      const store = getStore();
      const createdAt = "2026-09-01T12:00:00.000Z";
      const lifeLink = await store.createLifeLink({ id: id("life-link"), ownerId: DEMO_OWNER_ID, title: "Training shoes", createdAt });
      let collection = await store.createCollection({ id: id("collection"), ownerId: DEMO_OWNER_ID, title: "Morning kit", createdAt });
      collection = (await store.addCollectionMember(DEMO_OWNER_ID, {
        collectionId: collection.id, lifeLinkId: lifeLink.id, expectedUpdatedAt: collection.updatedAt
      }))!;
      const activityCommand = { id: id("activity"), ownerId: DEMO_OWNER_ID, title: "Prepare", notes: "General preparation", createdAt };
      const activity = await store.createActivity(activityCommand);
      expect(await store.createActivity({ ...activityCommand, createdAt: "2026-09-01T12:01:00.000Z" })).toEqual(activity);
      const groupCommand = { id: id("routine-group"), ownerId: DEMO_OWNER_ID, title: "Weekday", createdAt };
      const group = await store.createRoutineGroup(groupCommand);
      expect(await store.createRoutineGroup({ ...groupCommand, createdAt: "2026-09-01T12:01:00.000Z" })).toEqual(group);
      await expect(store.createRoutineGroup({ ...groupCommand, title: "Different", createdAt: "2026-09-01T12:02:00.000Z" }))
        .rejects.toMatchObject({ code: "routine_conflict" });
      const stepId = id("routine-step");
      const planned: RoutineValue[] = [{ key: "effort", label: "Effort", kind: "number", value: 3 }];
      const routineCommand = {
        id: id("routine"), revisionId: id("routine-revision"), ownerId: DEMO_OWNER_ID, groupId: group.id,
        title: "Morning preparation", purpose: "Start consistently", createdAt,
        steps: [{ id: stepId, activityId: activity.id, activityTitle: activity.title, position: 0, plannedValues: planned }],
        bindings: [
          { id: id("routine-binding"), routineStepId: stepId, targetType: "life_link" as const, targetId: lifeLink.id },
          { id: id("routine-binding"), targetType: "collection" as const, targetId: collection.id }
        ]
      };
      const created = await store.createRoutine(routineCommand);
      expect(await store.createRoutine({ ...routineCommand, createdAt: "2026-09-01T12:02:00.000Z" })).toEqual(created);
      expect(await store.getRoutine(DEMO_GUEST_ID, created.routine.id)).toBeNull();
      const ungroupedRoutine = await store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: DEMO_OWNER_ID,
        title: "Aardvark checklist", purpose: "First alphabetically", createdAt,
        steps: [{ id: id("routine-step"), activityId: activity.id, activityTitle: activity.title, position: 0 }] });
      const firstRoutinePage = await store.listRoutines(DEMO_OWNER_ID, { limit: 1 });
      expect(firstRoutinePage.items[0]).toMatchObject({ title: "Aardvark checklist", revisionNumber: 1,
        purpose: "First alphabetically" });
      expect(firstRoutinePage).toMatchObject({ truncated: true });
      const secondRoutinePage = await store.listRoutines(DEMO_OWNER_ID, { limit: 1, cursor: firstRoutinePage.nextCursor });
      expect(secondRoutinePage.items[0]).toMatchObject({ id: created.routine.id, title: "Morning preparation", revisionNumber: 1 });

      const schedule = await store.createRoutineSchedule({
        id: id("routine-schedule"), ownerId: DEMO_OWNER_ID, routineId: created.routine.id,
        routineRevisionId: created.routine.currentRevisionId,
        rule: { kind: "weekly", startDate: "2026-09-07", endDate: null, intervalWeeks: 1,
          weekdays: ["monday"], localTime: "09:00", timeZone: "America/New_York" }, createdAt
      });
      expect(await store.createRoutineSchedule({
        id: schedule.id, ownerId: DEMO_OWNER_ID, routineId: created.routine.id,
        routineRevisionId: created.routine.currentRevisionId, rule: schedule.rule, createdAt: "2026-09-01T12:03:00.000Z"
      })).toEqual(schedule);
      expect(await store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: schedule.id, expectedUpdatedAt: schedule.updatedAt,
        patch: { rule: { timeZone: "America/New_York", localTime: "09:00", weekdays: ["monday"], intervalWeeks: 1,
          endDate: null, startDate: "2026-09-07", kind: "weekly" } } })).toEqual(schedule);
      const routineArchiveSchedule = await store.createRoutineSchedule({
        id: id("routine-schedule"), ownerId: DEMO_OWNER_ID, routineId: ungroupedRoutine.routine.id,
        routineRevisionId: ungroupedRoutine.routine.currentRevisionId,
        rule: { kind: "once", localDate: "2026-09-28", localTime: "09:00", timeZone: "America/New_York" }, createdAt
      });
      const [routineArchiveOccurrence] = await store.materializeRoutineOccurrences(DEMO_OWNER_ID, ungroupedRoutine.routine.id, {
        startDate: "2026-09-28", endDate: "2026-09-28"
      });
      const occurrences = await store.materializeRoutineOccurrences(DEMO_OWNER_ID, created.routine.id, {
        startDate: "2026-09-07", endDate: "2026-09-14"
      });
      expect(occurrences).toHaveLength(2);
      expect(await store.materializeRoutineOccurrences(DEMO_OWNER_ID, created.routine.id, {
        startDate: "2026-09-07", endDate: "2026-09-14"
      })).toEqual(occurrences);
      expect(occurrences.every((item) => item.scheduleRevision === schedule.revision)).toBe(true);
      const tuesday = (await store.updateRoutineSchedule(DEMO_OWNER_ID, {
        scheduleId: schedule.id, expectedUpdatedAt: schedule.updatedAt,
        patch: { rule: { kind: "weekly", startDate: "2026-09-07", endDate: null, intervalWeeks: 1,
          weekdays: ["tuesday"], localTime: "09:00", timeZone: "America/New_York" } }
      }))!;
      expect((await store.listRoutineOccurrences(DEMO_OWNER_ID, { routineId: created.routine.id, limit: 100 })).items
        .filter((item) => occurrences.some((original) => original.id === item.id)).every((item) => item.status === "canceled")).toBe(true);
      const tuesdays = await store.materializeRoutineOccurrences(DEMO_OWNER_ID, created.routine.id, {
        startDate: "2026-09-07", endDate: "2026-09-14"
      });
      const monday = (await store.updateRoutineSchedule(DEMO_OWNER_ID, {
        scheduleId: schedule.id, expectedUpdatedAt: tuesday.updatedAt,
        patch: { rule: schedule.rule }
      }))!;
      const replanned = (await store.listRoutineOccurrences(DEMO_OWNER_ID, { routineId: created.routine.id, limit: 100 })).items;
      expect(replanned.filter((item) => occurrences.some((original) => original.id === item.id)))
        .toEqual(occurrences.map((original) => expect.objectContaining({ id: original.id, status: "planned", scheduleRevision: monday.revision })));
      expect(replanned.filter((item) => tuesdays.some((tuesdayOccurrence) => tuesdayOccurrence.id === item.id))
        .every((item) => item.status === "canceled")).toBe(true);

      const runCommand = { id: id("routine-run"), routineId: created.routine.id, occurrenceId: occurrences[0].id,
        startedAt: "2026-09-07T13:00:00.000Z" };
      let run = (await store.startRoutineRun(DEMO_OWNER_ID, runCommand))!;
      expect(await store.startRoutineRun(DEMO_OWNER_ID, { ...runCommand, startedAt: "2026-09-07T13:05:00.000Z" })).toEqual(run);
      expect(await store.getActiveRoutineRun(DEMO_OWNER_ID, created.routine.id)).toEqual(run);
      expect(await store.getActiveRoutineRun(DEMO_GUEST_ID, created.routine.id)).toBeNull();
      expect(run.contextSnapshot).toHaveLength(2);
      expect(run.contextSnapshot.find((item) => item.targetType === "collection")?.resolvedLifeLinks)
        .toEqual([{ lifeLinkId: lifeLink.id, title: lifeLink.title, sourceUpdatedAt: lifeLink.updatedAt }]);
      run = (await store.putRoutineRunStepResult(DEMO_OWNER_ID, {
        runId: run.id, routineStepId: stepId, expectedUpdatedAt: run.updatedAt,
        actualValues: [{ key: "effort", label: "Effort", kind: "number", value: 4 }],
        proposedNextValues: [{ key: "effort", label: "Effort", kind: "number", value: 5 }], notes: "Felt ready"
      }))!;
      const replayedResult = await store.putRoutineRunStepResult(DEMO_OWNER_ID, {
        runId: run.id, routineStepId: stepId, expectedUpdatedAt: createdAt,
        actualValues: [{ key: "effort", label: "Effort", kind: "number", value: 4 }],
        proposedNextValues: [{ key: "effort", label: "Effort", kind: "number", value: 5 }], notes: "Felt ready"
      });
      expect(replayedResult).toEqual(run);

      const completedAt = "2026-09-07T13:30:00.000Z";
      const sessionId = id("routine-session");
      await expect(store.finalizeRoutineRun(DEMO_OWNER_ID, {
        runId: run.id, sessionId: id("routine-session"), expectedUpdatedAt: run.updatedAt,
        completedAt: "2026-09-07T12:59:59.000Z"
      })).rejects.toMatchObject({ code: "invalid_routine", reason: "session_completed_before_start" });
      const built = (await store.finalizeRoutineRun(DEMO_OWNER_ID, {
        runId: run.id, sessionId, expectedUpdatedAt: run.updatedAt, completedAt
      }))!;
      expect(await store.getActiveRoutineRun(DEMO_OWNER_ID, created.routine.id)).toBeNull();
      expect((await store.finalizeRoutineRun(DEMO_OWNER_ID, {
        runId: run.id, sessionId, expectedUpdatedAt: createdAt, completedAt: "2026-09-07T13:35:00.000Z"
      }))?.session).toEqual(built.session);
      const historyBeforeRevision = await store.getRoutineSession(DEMO_OWNER_ID, sessionId);

      const archivedGroup = (await store.updateRoutineGroup(DEMO_OWNER_ID, { groupId: group.id,
        expectedUpdatedAt: group.updatedAt, patch: { archivedAt: "2026-09-08T11:00:00.000Z" } }))!;
      expect(archivedGroup.archivedAt).not.toBeNull();
      await expect(store.updateRoutine(DEMO_OWNER_ID, { routineId: ungroupedRoutine.routine.id,
        expectedUpdatedAt: ungroupedRoutine.routine.updatedAt, patch: { groupId: group.id } }))
        .rejects.toMatchObject({ code: "routine_reference_conflict" });
      await expect(store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"), ownerId: DEMO_OWNER_ID,
        groupId: group.id, title: "Unavailable assignment", createdAt: "2026-09-08T11:30:00.000Z",
        steps: [{ id: id("routine-step"), activityId: activity.id, activityTitle: activity.title, position: 0 }] }))
        .rejects.toMatchObject({ code: "routine_reference_conflict" });

      const revision = await store.reviseRoutine(DEMO_OWNER_ID, {
        id: id("routine-revision"), ownerId: DEMO_OWNER_ID, routineId: created.routine.id, revisionNumber: 2,
        expectedCurrentRevisionId: created.routine.currentRevisionId, title: "Morning preparation", purpose: "Start consistently",
        createdAt: "2026-09-08T12:00:00.000Z",
        steps: [{ id: id("routine-step"), activityId: activity.id, activityTitle: activity.title, position: 0,
          plannedValues: [{ key: "effort", label: "Effort", kind: "number", value: 5 }] }],
        bindings: [{ id: id("routine-binding"), targetType: "life_link", targetId: lifeLink.id }]
      });
      expect(revision?.revision.revisionNumber).toBe(2);
      expect(await store.reviseRoutine(DEMO_OWNER_ID, {
        id: revision!.revision.id, ownerId: DEMO_OWNER_ID, routineId: created.routine.id, revisionNumber: 2,
        expectedCurrentRevisionId: created.routine.currentRevisionId, title: "Morning preparation", purpose: "Start consistently",
        createdAt: "2026-09-08T12:05:00.000Z",
        steps: revision!.steps.map((step) => ({ id: step.id, activityId: step.activityId, activityTitle: step.activityTitle,
          position: step.position, instructions: step.instructions, optional: step.optional, plannedValues: step.plannedValues })),
        bindings: revision!.bindings.map((binding) => ({ id: binding.id, routineStepId: binding.routineStepId,
          targetType: binding.targetType, targetId: binding.targetId }))
      })).toEqual(revision);
      expect(await store.getRoutineSession(DEMO_OWNER_ID, sessionId)).toEqual(historyBeforeRevision);

      const originalResult = built.stepResults[0];
      const amendmentCommand = { id: id("routine-session-amendment"), sessionId, stepResultId: originalResult.id,
        note: "Corrected after review", correctedActualValues: [{ key: "effort", label: "Effort", kind: "number" as const, value: 2 }],
        createdAt: "2026-09-08T13:00:00.000Z" };
      const amendment = await store.appendRoutineSessionAmendment(DEMO_OWNER_ID, amendmentCommand);
      expect(await store.appendRoutineSessionAmendment(DEMO_OWNER_ID, { ...amendmentCommand, createdAt: "2026-09-08T13:05:00.000Z" })).toEqual(amendment);
      const projected = await store.getRoutineSession(DEMO_OWNER_ID, sessionId);
      expect(projected?.stepResults[0].original.actualValues[0]).toMatchObject({ value: 4 });
      expect(projected?.stepResults[0].effectiveActualValues[0]).toMatchObject({ value: 2 });
      expect(projected?.session).toEqual(built.session);

      const preview = await store.previewLifeLinkChange(DEMO_OWNER_ID, { operation: "delete", lifeLinkIds: [lifeLink.id] });
      await expect(store.applyLifeLinkChange(DEMO_OWNER_ID, { previewId: preview.id, commandId: id("routine-delete-check") }))
        .rejects.toMatchObject({ code: "routine_reference_conflict" });

      const archivedRoutine = (await store.updateRoutine(DEMO_OWNER_ID, { routineId: ungroupedRoutine.routine.id,
        expectedUpdatedAt: ungroupedRoutine.routine.updatedAt, patch: { archivedAt: "2026-09-09T11:00:00.000Z" } }))!;
      expect(archivedRoutine.archivedAt).not.toBeNull();
      const routineSchedulesAfterArchive = await store.listRoutineSchedules(DEMO_OWNER_ID, ungroupedRoutine.routine.id, { limit: 100 });
      const disabledByRoutineArchive = routineSchedulesAfterArchive!.items.find((item) => item.id === routineArchiveSchedule.id)!;
      expect(disabledByRoutineArchive).toMatchObject({ active: false, revision: routineArchiveSchedule.revision + 1,
        routineRevisionId: routineArchiveSchedule.routineRevisionId });
      expect(await store.getRoutineOccurrence(DEMO_OWNER_ID, routineArchiveOccurrence.id)).toMatchObject({ status: "canceled" });
      expect(await store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: routineArchiveSchedule.id,
        expectedUpdatedAt: routineArchiveSchedule.updatedAt, patch: { active: false } })).toEqual(disabledByRoutineArchive);
      await expect(store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: routineArchiveSchedule.id,
        expectedUpdatedAt: disabledByRoutineArchive.updatedAt, patch: { active: true } })).rejects.toMatchObject({ code: "routine_conflict" });

      const archivedActivity = (await store.updateActivity(DEMO_OWNER_ID, { activityId: activity.id,
        expectedUpdatedAt: activity.updatedAt, patch: { archivedAt: "2026-09-09T12:00:00.000Z" } }))!;
      expect(archivedActivity.archivedAt).not.toBeNull();
      const routineSchedulesAfterActivityArchive = await store.listRoutineSchedules(DEMO_OWNER_ID, created.routine.id, { limit: 100 });
      const disabledByActivityArchive = routineSchedulesAfterActivityArchive!.items.find((item) => item.id === schedule.id)!;
      expect(disabledByActivityArchive).toMatchObject({ active: false, revision: monday.revision + 1,
        routineRevisionId: monday.routineRevisionId });
      expect(await store.getRoutineOccurrence(DEMO_OWNER_ID, occurrences[0].id)).toMatchObject({ status: "completed" });
      expect(await store.getRoutineOccurrence(DEMO_OWNER_ID, occurrences[1].id)).toMatchObject({ status: "canceled" });
      expect((await store.getRoutineSession(DEMO_OWNER_ID, sessionId))?.session).toEqual(built.session);
      await expect(store.createRoutineSchedule({ id: id("routine-schedule"), ownerId: DEMO_OWNER_ID,
        routineId: created.routine.id, routineRevisionId: revision!.revision.id, rule: schedule.rule,
        createdAt: "2026-09-09T12:01:00.000Z" })).rejects.toMatchObject({ code: "routine_conflict" });
      expect(await store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: schedule.id,
        expectedUpdatedAt: monday.updatedAt, patch: { active: false } })).toEqual(disabledByActivityArchive);
      await expect(store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: schedule.id,
        expectedUpdatedAt: disabledByActivityArchive.updatedAt, patch: { active: true } })).rejects.toMatchObject({ code: "routine_conflict" });
      await expect(store.updateRoutineSchedule(DEMO_OWNER_ID, { scheduleId: schedule.id,
        expectedUpdatedAt: disabledByActivityArchive.updatedAt,
        patch: { active: false, rule: { ...schedule.rule, localTime: "10:00" } } })).rejects.toMatchObject({ code: "routine_conflict" });
      await expect(store.materializeRoutineOccurrences(DEMO_OWNER_ID, created.routine.id, {
        startDate: "2026-09-21", endDate: "2026-09-21"
      })).rejects.toMatchObject({ code: "routine_conflict" });
      await expect(store.startRoutineRun(DEMO_OWNER_ID, { id: id("routine-run"), routineId: created.routine.id,
        startedAt: "2026-09-21T13:00:00.000Z" })).rejects.toMatchObject({ code: "routine_conflict" });
    });

    it("archives only schedules whose pinned revision uses the archived Activity", async () => {
      const store = getStore();
      const createdAt = "2026-09-01T12:00:00.000Z";
      const firstActivity = await store.createActivity({ id: id("activity"), ownerId: DEMO_OWNER_ID,
        title: "First activity", createdAt });
      const secondActivity = await store.createActivity({ id: id("activity"), ownerId: DEMO_OWNER_ID,
        title: "Second activity", createdAt });
      const created = await store.createRoutine({ id: id("routine"), revisionId: id("routine-revision"),
        ownerId: DEMO_OWNER_ID, title: "Revision-pinned schedule", createdAt,
        steps: [{ id: id("routine-step"), activityId: firstActivity.id, activityTitle: firstActivity.title, position: 0 }] });
      const firstSchedule = await store.createRoutineSchedule({ id: id("routine-schedule"), ownerId: DEMO_OWNER_ID,
        routineId: created.routine.id, routineRevisionId: created.routine.currentRevisionId,
        rule: { kind: "once", localDate: "2026-10-01", localTime: "09:00", timeZone: "America/New_York" }, createdAt });
      const secondRevision = (await store.reviseRoutine(DEMO_OWNER_ID, { id: id("routine-revision"),
        ownerId: DEMO_OWNER_ID, routineId: created.routine.id, revisionNumber: 2,
        expectedCurrentRevisionId: created.routine.currentRevisionId, title: "Revision-pinned schedule",
        createdAt: "2026-09-02T12:00:00.000Z",
        steps: [{ id: id("routine-step"), activityId: secondActivity.id, activityTitle: secondActivity.title, position: 0 }]
      }))!;
      const secondSchedule = await store.createRoutineSchedule({ id: id("routine-schedule"), ownerId: DEMO_OWNER_ID,
        routineId: created.routine.id, routineRevisionId: secondRevision.revision.id,
        rule: { kind: "once", localDate: "2026-10-02", localTime: "09:00", timeZone: "America/New_York" },
        createdAt: "2026-09-02T12:00:00.000Z" });
      const occurrences = await store.materializeRoutineOccurrences(DEMO_OWNER_ID, created.routine.id, {
        startDate: "2026-10-01", endDate: "2026-10-02"
      });

      await store.updateActivity(DEMO_OWNER_ID, { activityId: firstActivity.id, expectedUpdatedAt: firstActivity.updatedAt,
        patch: { archivedAt: "2026-09-03T12:00:00.000Z" } });

      const schedules = (await store.listRoutineSchedules(DEMO_OWNER_ID, created.routine.id, { limit: 100 }))!.items;
      expect(schedules.find((item) => item.id === firstSchedule.id)).toMatchObject({ active: false,
        revision: firstSchedule.revision + 1, routineRevisionId: firstSchedule.routineRevisionId });
      expect(schedules.find((item) => item.id === secondSchedule.id)).toEqual(secondSchedule);
      const occurrencesAfterArchive = (await store.listRoutineOccurrences(DEMO_OWNER_ID, {
        routineId: created.routine.id, limit: 100
      })).items;
      expect(occurrencesAfterArchive.find((item) => item.id === occurrences.find((item) => item.scheduleId === firstSchedule.id)!.id))
        .toMatchObject({ status: "canceled" });
      expect(occurrencesAfterArchive.find((item) => item.id === occurrences.find((item) => item.scheduleId === secondSchedule.id)!.id))
        .toMatchObject({ status: "planned" });
    });
  });
}
