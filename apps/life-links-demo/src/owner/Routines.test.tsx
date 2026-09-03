// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRoutinePatch, createCanonicalRoutine, type RoutinePatch, type RoutineSummaryRecord } from "@life-links/core";
import { RoutineDeletionEffects, RoutineDialogHost } from "./RoutineDialogs";
import { AgentWorkspaceChangeDialog } from "./AgentWorkspaceChangeDialog";
import type { RoutineDeletionPreview, RoutineDeletionTarget } from "../agent/workspaceToolHandlers";
import { RoutineDetailPanel, RoutineSessionDetailPanel, RoutineWorkspacePanel } from "./RoutinePanels";
import type { RoutineDialogState } from "./RoutineShared";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot, RoutineWorkspaceState } from "../workspace/types";

const ownerId = "routine-owner";
const createdAt = "2026-09-01T12:00:00.000Z";
function fixture(suffix: number, title: string) {
  const uuid = `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  const detail = createCanonicalRoutine({ id: `routine-${uuid}`, revisionId: `routine-revision-${uuid}`, ownerId, title, ordering: "ordered",
    steps: [{ id: `routine-step-${uuid}`, activityId: `activity-${uuid}`, activityTitle: "Prepare", position: 0, plannedValues: [] }], createdAt });
  const summary: RoutineSummaryRecord = { ...detail.routine, title, purpose: "", revisionNumber: 1 };
  return { detail, summary };
}
const first = fixture(1, "Morning reset"); const second = fixture(2, "Tuesday workout");
const removed = { ...fixture(3, "Removed routine").summary, archivedAt: createdAt };

describe("Routine selection, retained-history deletion, and scoped History", () => {
  let root: Root; let container: HTMLDivElement;
  let snapshot: LifeLinksWorkspaceSnapshot;
  let controller: LifeLinksWorkspaceController;
  let actions: Record<string, ReturnType<typeof vi.fn>>;
  let dialog: RoutineDialogState;
  let onClose: ReturnType<typeof vi.fn>;
  let showingDetails: boolean;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const routineWorkspace: RoutineWorkspaceState = {
      revisionsById: { [first.detail.currentRevision.revision.id]: first.detail.currentRevision, [second.detail.currentRevision.revision.id]: second.detail.currentRevision },
      selectedSessionRevision: null,
      presentation: { tab: "routines", historyRoutineId: null, showRemoved: false, collapsedGroupIds: [] },
      history: { routineId: null, sessions: [], nextCursor: null, loaded: false, loading: false, error: "" },
      groups: [], groupsNextCursor: null, activities: [], activitiesNextCursor: null,
      routines: [first.summary, second.summary, removed], routinesNextCursor: null, selectedRoutine: null,
      schedules: [], schedulesNextCursor: null, occurrences: [], occurrencesNextCursor: null,
      calendarOccurrences: [], calendarRange: null, calendarLoading: false, calendarError: "", activeRun: null,
      sessions: [], sessionsNextCursor: null, selectedSession: null, includeArchived: false, loading: false, error: ""
    };
    snapshot = { currentUser: { id: ownerId }, routineWorkspace, collections: [], collectionsComplete: true } as unknown as LifeLinksWorkspaceSnapshot;
    actions = Object.fromEntries(["updateRoutine", "createRoutine", "reviseRoutine", "createRoutineActivity", "loadRoutineRunPlan", "startRoutineRun", "putRoutineRunStepResult", "prepareRoutineDeletion", "applyRoutineDeletion", "confirmAgentWorkspaceChange", "openRoutine", "selectRoutineSession", "loadRoutineWorkspace", "loadRoutineHistory", "setRoutinePresentation", "setRoutineDetailPresentation"].map((name) => [name, vi.fn().mockResolvedValue(undefined)]));
    actions.getSnapshot = vi.fn(() => snapshot);
    actions.setRoutinePresentation.mockImplementation((patch) => publish({ presentation: { ...snapshot.routineWorkspace.presentation, ...patch } }));
    actions.prepareRoutineDeletion.mockImplementation((routines: RoutineDeletionTarget[]): RoutineDeletionPreview => ({
      id: "routine-deletion-preview-ui", routines: structuredClone(routines), archivedAt: "2026-09-02T12:00:00.000Z"
    }));
    actions.applyRoutineDeletion.mockImplementation(async (preview: RoutineDeletionPreview) => {
      const ids = preview.routines.map((routine) => routine.id);
      publish({ routines: snapshot.routineWorkspace.routines.map((routine) => ids.includes(routine.id) ? { ...routine, archivedAt: preview.archivedAt } : routine) });
      return { removedIds: ids, remainingIds: [], error: null };
    });
    actions.updateRoutine.mockImplementation(async (id: string, expected: string, patch: RoutinePatch) => {
      const current = snapshot.routineWorkspace.routines.find((routine) => routine.id === id)!;
      const result = applyRoutinePatch(current, patch, "2026-09-02T12:00:00.000Z");
      if (current.archivedAt !== result.archivedAt && current.updatedAt !== expected) throw new Error("stale_revision");
      publish({ routines: snapshot.routineWorkspace.routines.map((routine) => routine.id === id ? { ...routine, ...result } : routine) });
    });
    controller = actions as unknown as LifeLinksWorkspaceController;
    dialog = null; showingDetails = false;
    onClose = vi.fn(() => { dialog = null; render(); });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function render() {
    const onOpenDialog = (value: NonNullable<RoutineDialogState>) => { dialog = value; render(); };
    root.render(<>
      {showingDetails ? <RoutineDetailPanel controller={controller} snapshot={snapshot} onOpenDialog={onOpenDialog} />
        : <RoutineWorkspacePanel controller={controller} snapshot={snapshot} onOpenDialog={onOpenDialog} onOpenDetails={() => undefined} />}
      {dialog && <RoutineDialogHost dialog={dialog} controller={controller} snapshot={snapshot} onClose={onClose} />}
    </>);
  }
  function publish(patch: Partial<RoutineWorkspaceState>) { snapshot = { ...snapshot, routineWorkspace: { ...snapshot.routineWorkspace, ...patch } }; render(); }
  function button(text: string) {
    const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text);
    if (!result) throw new Error(`Missing button ${text}`);
    return result;
  }
  async function click(node: HTMLElement) { await act(async () => node.click()); }
  async function fill(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function startEdit() {
    await act(async () => render());
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Create in My Routines"]')!);
    await click(button("Edit"));
  }
  async function select(title: string) { await click(document.querySelector<HTMLInputElement>(`[aria-label="Select ${title}"]`)!); }
  async function openDelete() { await startEdit(); await select(first.summary.title); await select(second.summary.title); await click(button("Delete")); }

  it("opens Edit from plus, selects multiple bubbles, and waits for one explicit confirmation", async () => {
    await openDelete();
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal.textContent).toContain(first.summary.title);
    expect(modal.textContent).toContain(second.summary.title);
    expect(modal.textContent).toContain("future, unstarted plans will be canceled");
    expect(modal.textContent).toContain("Completed history and Runs already in progress are kept");
    expect(modal.textContent).toContain("not permanent erasure");
    expect(actions.prepareRoutineDeletion).toHaveBeenCalledOnce();
    expect(actions.applyRoutineDeletion).not.toHaveBeenCalled();
    await click(button("Yes, delete"));
    expect(actions.applyRoutineDeletion).toHaveBeenCalledExactlyOnceWith({ id: "routine-deletion-preview-ui", archivedAt: "2026-09-02T12:00:00.000Z",
      routines: [first.summary, second.summary].map(({ id, title, updatedAt }) => ({ id, title, expectedUpdatedAt: updatedAt })) }, [], expect.any(AbortSignal));
    expect(actions.prepareRoutineDeletion).toHaveBeenCalledOnce();
    expect(actions.updateRoutine).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector(`[data-routine-id="${first.summary.id}"]`)).toBeNull();
  });

  it("Cancel does not save, and retry only repeats the exact unconfirmed archive command", async () => {
    await openDelete(); await click(button("Cancel")); expect(actions.applyRoutineDeletion).not.toHaveBeenCalled();
    await click(button("Delete"));
    actions.applyRoutineDeletion.mockResolvedValueOnce({ removedIds: [first.summary.id], remainingIds: [second.summary.id], error: "Connection lost" });
    await click(button("Yes, delete"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("1 removed; the remaining changes are not confirmed");
    expect(document.querySelector('[role="dialog"] li')?.textContent).toContain("— removed");
    const pinned = actions.applyRoutineDeletion.mock.calls[0][0];
    await click(button("Retry remaining"));
    expect(actions.applyRoutineDeletion).toHaveBeenCalledTimes(2);
    expect(actions.applyRoutineDeletion.mock.calls[1][0]).toBe(pinned);
    expect(actions.applyRoutineDeletion.mock.calls[1][1]).toEqual([first.summary.id]);
    expect(actions.prepareRoutineDeletion).toHaveBeenCalledTimes(2); // One canceled dialog, one confirmed dialog.
    expect(actions.updateRoutine).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("a stale selected revision cannot silently delete the changed Routine", async () => {
    await startEdit(); await select(first.summary.title); await click(button("Delete"));
    await act(async () => publish({ routines: snapshot.routineWorkspace.routines.map((routine) => routine.id === first.summary.id ? { ...routine, updatedAt: "2026-09-02T11:00:00.000Z" } : routine) }));
    actions.applyRoutineDeletion.mockResolvedValueOnce({ removedIds: [], remainingIds: [first.summary.id], error: "stale_revision" });
    await click(button("Yes, delete"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("stale_revision");
    expect(snapshot.routineWorkspace.routines.find((routine) => routine.id === first.summary.id)?.archivedAt).toBeNull();
    expect(actions.applyRoutineDeletion.mock.calls[0][0].routines[0].expectedUpdatedAt).toBe(first.summary.updatedAt);
    expect(actions.prepareRoutineDeletion).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the exact same Routine effects for an agent's pending partial confirmation", async () => {
    const preview = actions.prepareRoutineDeletion([first.summary, second.summary].map(({ id, title, updatedAt }) => ({ id, title, expectedUpdatedAt: updatedAt }))) as RoutineDeletionPreview;
    const removedIds = [first.summary.id]; const error = "Connection lost";
    await act(async () => root.render(<div className="ll-form"><RoutineDeletionEffects preview={preview} removedIds={removedIds} error={error} /></div>));
    const effects = container.querySelector(".ll-form")!.textContent;
    await act(async () => root.render(<AgentWorkspaceChangeDialog controller={controller} confirmation={{ kind: "routines", preview, removedIds, error, saving: false }} />));
    expect(document.querySelector(".ll-dialog-body .ll-form")!.textContent).toBe(effects);
    expect(actions.confirmAgentWorkspaceChange).not.toHaveBeenCalled();
    await click(button("Retry remaining"));
    expect(actions.confirmAgentWorkspaceChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not confirm a pending agent Routine removal when canceled", async () => {
    const preview = actions.prepareRoutineDeletion([{ id: first.summary.id, title: first.summary.title, expectedUpdatedAt: first.summary.updatedAt }]) as RoutineDeletionPreview;
    await act(async () => root.render(<AgentWorkspaceChangeDialog controller={controller} confirmation={{ kind: "routines", preview, removedIds: [], error: "", saving: false }} />));
    expect(actions.applyRoutineDeletion).not.toHaveBeenCalled();
    await click(button("Cancel"));
    expect(actions.confirmAgentWorkspaceChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(actions.applyRoutineDeletion).not.toHaveBeenCalled();
  });

  it("shows removed Routines only on request and restores through the archive-null command", async () => {
    await act(async () => render());
    expect(document.querySelector(`[data-routine-id="${removed.id}"]`)).toBeNull();
    await click(button("Show removed routines"));
    expect(actions.loadRoutineWorkspace).toHaveBeenLastCalledWith({ includeArchived: true });
    expect(document.querySelector(`[data-routine-id="${removed.id}"]`)?.textContent).toContain("Removed");
    await click(button("Restore"));
    expect(actions.updateRoutine).toHaveBeenCalledWith(removed.id, removed.updatedAt, { archivedAt: null });
    expect(snapshot.routineWorkspace.routines.find((routine) => routine.id === removed.id)?.archivedAt).toBeNull();
  });

  it("keeps a removed Routine's current Run resumable but hides new planning actions", async () => {
    showingDetails = true;
    await act(async () => publish({ selectedRoutine: { ...first.detail, routine: { ...first.detail.routine, archivedAt: createdAt } },
      activeRun: { id: "routine-run-00000000-0000-4000-8000-000000000001", ownerId, routineId: first.summary.id,
        routineRevisionId: first.detail.currentRevision.revision.id, occurrenceId: null, status: "active", contextSnapshot: [], stepResults: [], startedAt: createdAt, updatedAt: createdAt } }));
    expect(button("Resume")).toBeTruthy();
    await click(document.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${first.summary.title}"]`)!);
    expect(button("Resume Run")).toBeTruthy();
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Add schedule");
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Start Run");
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Edit Routine");
  });

  it("uses explicit all/specific History state and its own pagination, not recent Sessions", async () => {
    const session = { session: { id: "routine-session-00000000-0000-4000-8000-000000000001", ownerId, routineId: first.summary.id,
      routineRevisionId: first.detail.currentRevision.revision.id, runId: "routine-run-00000000-0000-4000-8000-000000000001",
      occurrenceId: null, contextSnapshot: [], startedAt: createdAt, completedAt: createdAt }, stepResults: [], sessionAmendments: [] };
    await act(async () => publish({ presentation: { ...snapshot.routineWorkspace.presentation, tab: "history" },
      history: { routineId: null, sessions: [session], nextCursor: "history-next", loaded: true, loading: false, error: "" }, sessions: [] }));
    expect(document.querySelector('[aria-label="History for"]')?.textContent).toContain("All routines");
    expect(document.querySelector(".ll-routine-sessions")?.textContent).toContain(first.summary.title);
    await click(button("Load more history"));
    expect(actions.loadRoutineHistory).toHaveBeenLastCalledWith({ cursor: "history-next" });
    const filter = document.querySelector<HTMLSelectElement>('[aria-label="History for"]')!;
    await act(async () => { filter.value = second.summary.id; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(actions.setRoutinePresentation).toHaveBeenLastCalledWith({ historyRoutineId: second.summary.id });
    expect(actions.loadRoutineHistory).toHaveBeenLastCalledWith({ signal: expect.any(AbortSignal) });
  });

  it("opens the current Routine's full History from Details", async () => {
    showingDetails = true; await act(async () => publish({ selectedRoutine: first.detail }));
    await click(button("View all history"));
    expect(actions.setRoutinePresentation).toHaveBeenLastCalledWith({ tab: "history", historyRoutineId: first.summary.id });
  });

  it("labels Groups and Routine rows separately and keeps the root plus menu at the right layer", async () => {
    await act(async () => publish({ groups: [{ id: "routine-group-00000000-0000-4000-8000-000000000011", ownerId, title: "Training", notes: "", archivedAt: null, createdAt, updatedAt: createdAt }] }));
    expect(container.querySelector(".ll-group-heading .ll-routine-layer")?.textContent).toBe("Group");
    expect(container.querySelector(".ll-routine-row .ll-routine-layer")?.textContent).toBe("Routine");
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Create in My Routines"]')!);
    expect([...document.querySelectorAll('[role="menu"] button')].map((node) => node.textContent?.trim())).toEqual(["New Routine", "New Group", "Edit"]);
  });

  it("defaults new Routines to Any order and creates or reuses Activities inside the editor", async () => {
    const activity = { id: "activity-00000000-0000-4000-8000-000000000001", ownerId, title: "Prepare", notes: "", archivedAt: null, createdAt, updatedAt: createdAt };
    actions.createRoutineActivity.mockResolvedValue({ ...activity, id: "activity-00000000-0000-4000-8000-000000000009", title: "Reflect" });
    dialog = { kind: "new-routine" };
    await act(async () => publish({ activities: [activity] }));
    expect(document.querySelector<HTMLInputElement>('[name="routine-ordering"][value="unordered"]')?.checked).toBe(true);
    expect(document.querySelector("#routine-steps-heading")?.textContent).toBe("Activities");
    expect(document.querySelector('[aria-label="Move Step up"]')).toBeNull();
    await fill(document.querySelector<HTMLInputElement>('.ll-routine-definition-form > label input')!, "Evening reset");
    const reuse = document.querySelector<HTMLSelectElement>('.ll-routine-step-editor select')!;
    await act(async () => { reuse.value = activity.id; reuse.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(button("Add activity"));
    await fill(document.querySelectorAll<HTMLInputElement>('.ll-routine-step-editor input:not([type="checkbox"])')[0], "Reflect");
    await click(button("Create Routine"));
    expect(actions.createRoutineActivity).toHaveBeenCalledExactlyOnceWith({ id: expect.stringMatching(/^activity-/), title: "Reflect" });
    expect(actions.createRoutine).toHaveBeenCalledWith(expect.objectContaining({ ordering: "unordered", title: "Evening reset", steps: [
      expect.objectContaining({ activityId: activity.id, activityTitle: "Prepare", position: 0 }),
      expect.objectContaining({ activityTitle: "Reflect", position: 1 })
    ] }));
  });

  it.each(["new-routine", "revise-routine"] as const)("retries an uncertain %s save with the exact same command and entry identities", async (kind) => {
    const saving = kind === "new-routine" ? actions.createRoutine : actions.reviseRoutine;
    saving.mockRejectedValueOnce(new Error("Response lost"));
    dialog = { kind };
    await act(async () => publish({ selectedRoutine: first.detail,
      activities: [{ id: first.detail.currentRevision.steps[0].activityId, ownerId, title: "Prepare", notes: "", archivedAt: null, createdAt, updatedAt: createdAt }] }));
    if (kind === "new-routine") {
      await fill(document.querySelector<HTMLInputElement>('.ll-routine-definition-form > label input')!, "Retry Routine");
      const choice = document.querySelector<HTMLSelectElement>('.ll-routine-step-editor select')!;
      await act(async () => { choice.value = first.detail.currentRevision.steps[0].activityId; choice.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    const label = kind === "new-routine" ? "Create Routine" : "Save Routine";
    await click(button(label));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Response lost");
    const initial = structuredClone(saving.mock.calls[0]);
    await click(button(label));
    expect(saving.mock.calls[1]).toEqual(initial);
    const payload = initial[kind === "new-routine" ? 0 : 1];
    expect(payload.revisionId).toMatch(/^routine-revision-/);
    expect(payload.steps[0].id).toMatch(/^routine-step-/);
    if (kind === "new-routine") expect(payload.id).toMatch(/^routine-/);
  });

  it("preserves all Activity drafts, targets and context when switching order modes before Save Routine", async () => {
    const detail = structuredClone(first.detail);
    detail.currentRevision.steps[0].instructions = "Use a comfortable pace";
    detail.currentRevision.steps[0].optional = true;
    detail.currentRevision.steps[0].plannedValues = [{ key: "weight", label: "Weight", kind: "quantity", amount: 15, unit: "kg" }];
    detail.currentRevision.bindings = [{ id: "routine-binding-00000000-0000-4000-8000-000000000001", ownerId, routineRevisionId: detail.currentRevision.revision.id,
      routineStepId: detail.currentRevision.steps[0].id, targetType: "life_link", targetId: "gear" }];
    dialog = { kind: "revise-routine" };
    await act(async () => publish({ selectedRoutine: detail }));
    expect(document.querySelector<HTMLInputElement>('[name="routine-ordering"][value="ordered"]')?.checked).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Future, unstarted plans will use these changes");
    await click(document.querySelector<HTMLInputElement>('[name="routine-ordering"][value="unordered"]')!);
    expect(document.querySelector(".ll-routine-step-editor legend")?.textContent).toBe("Activity");
    expect(document.querySelector('[aria-label="Move Step up"]')).toBeNull();
    await click(document.querySelector<HTMLInputElement>('[name="routine-ordering"][value="ordered"]')!);
    expect(document.querySelector(".ll-routine-step-editor legend")?.textContent).toBe("Step 1");
    await click(document.querySelector<HTMLInputElement>('[name="routine-ordering"][value="unordered"]')!);
    await click(button("Save Routine"));
    const saved = actions.reviseRoutine.mock.calls[0][1];
    expect(saved).toMatchObject({ ordering: "unordered", expectedCurrentRevisionId: detail.currentRevision.revision.id,
      steps: [expect.objectContaining({ activityId: detail.currentRevision.steps[0].activityId, instructions: "Use a comfortable pace", optional: true,
        plannedValues: [{ key: "weight", label: "Weight", kind: "quantity", amount: 15, unit: "kg" }] })] });
    expect(saved.bindings).toEqual([expect.objectContaining({ targetType: "life_link", targetId: "gear", routineStepId: saved.steps[0].id })]);
    expect(actions.createRoutineActivity).not.toHaveBeenCalled();
  });

  it("shows an unordered current Routine but keeps an active Run's ordered revision and completion rules", async () => {
    const latest = structuredClone(first.detail);
    latest.currentRevision.revision = { ...latest.currentRevision.revision, id: second.detail.currentRevision.revision.id, ordering: "unordered", title: "New defaults" };
    latest.currentRevision.steps = [{ ...latest.currentRevision.steps[0], activityTitle: "Changed activity" }];
    showingDetails = true;
    await act(async () => publish({ selectedRoutine: latest, activeRun: { id: "routine-run-00000000-0000-4000-8000-000000000001", ownerId,
      routineId: first.summary.id, routineRevisionId: first.detail.currentRevision.revision.id, occurrenceId: null, status: "active", contextSnapshot: [], stepResults: [], startedAt: createdAt, updatedAt: createdAt } }));
    expect(container.querySelector(".ll-routine-step-list h3")?.textContent).toBe("Activities");
    expect(container.querySelector(".ll-routine-step-number")).toBeNull();
    await click(button("Resume"));
    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal.textContent).toContain("Run · Morning reset");
    expect(modal.textContent).toContain("0 of 1 Steps recorded · In order");
    expect(modal.textContent).toContain("Prepare");
    expect(modal.textContent).not.toContain("Changed activity");
    expect(modal.querySelector(".ll-routine-step-number")?.textContent).toBe("1");
    expect(button("Complete Routine").disabled).toBe(true);
    expect(button("Save Step result").disabled).toBe(false);
  });

  it("waits for an old occurrence's exact revision before showing or starting its Run", async () => {
    const old = structuredClone(first.detail.currentRevision);
    old.revision = { ...old.revision, title: "Past plan", ordering: "unordered" };
    actions.loadRoutineRunPlan.mockResolvedValue(old);
    dialog = { kind: "run", occurrenceId: "past-occurrence" };
    await act(async () => publish({ selectedRoutine: second.detail }));
    expect(actions.loadRoutineRunPlan).toHaveBeenCalledWith(second.summary.id, "past-occurrence", expect.any(AbortSignal));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Start Past plan");
    expect(document.querySelector('.ll-routine-run-plan')?.textContent).toContain("Activities1OrderAny order");
    expect(actions.startRoutineRun).not.toHaveBeenCalled();
    await click(button("Start Run"));
    expect(actions.startRoutineRun).toHaveBeenCalledWith(second.summary.id, expect.objectContaining({ occurrenceId: "past-occurrence" }));
  });

  it("uses the Session's own unordered revision in history and detail after future ordering changes", async () => {
    const recorded = structuredClone(first.detail.currentRevision); recorded.revision.ordering = "unordered";
    const session = { session: { id: "routine-session-00000000-0000-4000-8000-000000000001", ownerId, routineId: first.summary.id,
      routineRevisionId: recorded.revision.id, runId: "routine-run-00000000-0000-4000-8000-000000000001", occurrenceId: null, contextSnapshot: [], startedAt: createdAt, completedAt: createdAt },
      stepResults: [{ original: { id: "routine-step-result-00000000-0000-4000-8000-000000000001", routineStepId: recorded.steps[0].id,
        actualValues: [], proposedNextValues: [], notes: "", ownerId, sessionId: "routine-session-00000000-0000-4000-8000-000000000001", createdAt }, effectiveActualValues: [], effectiveProposedNextValues: [], amendments: [] }], sessionAmendments: [] };
    await act(async () => publish({ selectedRoutine: second.detail, selectedSession: session, revisionsById: { [recorded.revision.id]: recorded },
      presentation: { ...snapshot.routineWorkspace.presentation, tab: "history" }, history: { routineId: null, sessions: [session], nextCursor: null, loaded: true, loading: false, error: "" } }));
    expect(container.querySelector(".ll-routine-sessions")?.textContent).toContain("1 recorded Activity");
    await act(async () => root.render(<RoutineSessionDetailPanel snapshot={snapshot} onBack={() => undefined} onOpenDialog={() => undefined} />));
    expect(container.textContent).toContain("Recorded Activities");
    expect(container.textContent).toContain("Morning reset");
    expect(container.querySelector(".ll-routine-step-number")).toBeNull();
  });
});
