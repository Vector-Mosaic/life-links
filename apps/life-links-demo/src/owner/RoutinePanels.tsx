import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  History,
  Layers3,
  Pencil,
  Play,
  Plus,
  Repeat2
} from "lucide-react";
import type { RoutineOccurrenceRecord, RoutineSessionProjection, RoutineSummaryRecord } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { ActionMenu } from "./FieldLedgerPrimitives";
import {
  RoutineValueList,
  formatRoutineDateTime,
  localIsoDate,
  routineScheduleMeta,
  type RoutineDialogState,
  type RoutineWorkspaceTab
} from "./RoutineShared";

type SharedPanelProps = {
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onOpenDialog(dialog: NonNullable<RoutineDialogState>): void;
};

export function RoutineWorkspacePanel({ controller, snapshot, onOpenDialog, onOpenDetails, onShowRoutine, onShowSession }: SharedPanelProps & {
  onOpenDetails(): void;
  onShowRoutine?(routineId: string): void;
  onShowSession?(sessionId: string, routineId: string): void;
}) {
  const state = snapshot.routineWorkspace;
  const [tab, setTab] = useState<RoutineWorkspaceTab>("routines");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const routines = useMemo(() => state.routines.filter((routine) => !routine.archivedAt), [state.routines]);
  const groups = useMemo(() => {
    const activeGroups = state.groups.filter((group) => !group.archivedAt);
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    const hasUnavailableGroup = routines.some((routine) => routine.groupId !== null && !activeGroupIds.has(routine.groupId));
    return [
      ...activeGroups.map((group) => ({ id: group.id, title: group.title, notes: group.notes, kind: "group" as const })),
      ...(hasUnavailableGroup ? [{ id: "__unavailable", title: "Archived or unavailable Group", notes: "", kind: "unavailable" as const }] : []),
      { id: "__ungrouped", title: "Ungrouped", notes: "", kind: "ungrouped" as const }
    ];
  }, [routines, state.groups]);
  const groupIds = groups.map((group) => group.id);
  const allCollapsed = groupIds.length > 0 && groupIds.every((id) => collapsedGroups.includes(id));

  useEffect(() => {
    // Selecting one Routine hydrates its focused history. Restore the owner-wide
    // indexes whenever their global tabs are visible so their meaning never
    // silently changes after a selection.
    if (tab === "today") void controller.loadRoutineOccurrences();
    if (tab === "history") void controller.loadRoutineSessions();
  }, [controller, state.selectedRoutine?.routine.id, tab]);

  async function showRoutine(routineId: string) {
    await controller.openRoutine(routineId);
    if (controller.getSnapshot().routineWorkspace.error) return;
    onShowRoutine?.(routineId);
    onOpenDetails();
  }

  async function showSession(session: RoutineSessionProjection) {
    await controller.openRoutine(session.session.routineId);
    if (controller.getSnapshot().routineWorkspace.error) return;
    await controller.selectRoutineSession(session.session.id);
    if (controller.getSnapshot().routineWorkspace.error) return;
    onShowSession?.(session.session.id, session.session.routineId);
    onOpenDetails();
  }

  async function beginOccurrence(occurrence: RoutineOccurrenceRecord) {
    await controller.openRoutine(occurrence.routineId);
    if (controller.getSnapshot().routineWorkspace.error) return;
    onShowRoutine?.(occurrence.routineId);
    onOpenDetails();
    onOpenDialog({ kind: "run", occurrenceId: occurrence.id });
  }

  function toggleGroup(id: string) {
    setCollapsedGroups((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleAll() {
    setCollapsedGroups(allCollapsed ? [] : groupIds);
  }

  return <div className="ll-routines-workspace">
    <div className="ll-title-row">
      <div><h1>My Routines</h1><p className="ll-subtitle">{state.routines.length} {state.routines.length === 1 ? "Routine" : "Routines"} · actions and progress over time</p></div>
      <ActionMenu label="Create in My Routines" className="ll-icon-button ll-primary ll-main-plus" items={[
        { label: "New Routine", icon: <Repeat2 size={17} />, onClick: () => onOpenDialog({ kind: "new-routine" }) },
        { label: "New Activity", icon: <CircleCheck size={17} />, onClick: () => onOpenDialog({ kind: "new-activity" }) },
        { label: "New Group", icon: <Layers3 size={17} />, onClick: () => onOpenDialog({ kind: "new-group" }) }
      ]}><Plus size={22} /></ActionMenu>
    </div>

    <div className="ll-collection-toolbar ll-routine-toolbar">
      <div className="ll-view-switch" role="tablist" aria-label="Routine views">
        <button type="button" role="tab" aria-selected={tab === "routines"} aria-pressed={tab === "routines"} onClick={() => setTab("routines")}><Repeat2 size={15} />Routines</button>
        <button type="button" role="tab" aria-selected={tab === "today"} aria-pressed={tab === "today"} onClick={() => setTab("today")}><CalendarDays size={15} />Today</button>
        <button type="button" role="tab" aria-selected={tab === "history"} aria-pressed={tab === "history"} onClick={() => setTab("history")}><History size={15} />History</button>
      </div>
      {tab === "routines" && groups.length > 1 && <button className="ll-text-button ll-section-toggle-all" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>}
    </div>

    {state.error && <p className="ll-error" role="alert">{state.error}</p>}
    {state.loading && !state.routines.length ? <p className="ll-empty" role="status">Loading Routines…</p> : null}
    {tab === "routines" && <RoutineIndex
      routines={routines}
      groups={groups}
      collapsedGroups={collapsedGroups}
      selectedRoutineId={state.selectedRoutine?.routine.id ?? null}
      onToggle={toggleGroup}
      onSelect={(routineId) => void showRoutine(routineId)}
    />}
    {tab === "today" && <TodayIndex
      occurrences={state.occurrences}
      routines={state.routines}
      activeRunRoutineId={state.activeRun?.routineId ?? null}
      onSelect={(routineId) => void showRoutine(routineId)}
      onBegin={(occurrence) => void beginOccurrence(occurrence)}
    />}
    {tab === "history" && <SessionIndex sessions={state.sessions} routines={state.routines} onSelect={(session) => void showSession(session)} />}
    {tab === "routines" && state.routinesNextCursor && <button className="ll-button ll-load-more" onClick={() => void controller.loadMoreRoutines()}>Load more Routines</button>}
    {tab === "history" && state.sessionsNextCursor && <button className="ll-button ll-load-more" onClick={() => void controller.loadRoutineSessions({ cursor: state.sessionsNextCursor })}>Load more history</button>}
  </div>;
}

function RoutineIndex({ routines, groups, collapsedGroups, selectedRoutineId, onToggle, onSelect }: {
  routines: RoutineSummaryRecord[];
  groups: Array<{ id: string; title: string; notes: string; kind: "group" | "unavailable" | "ungrouped" }>;
  collapsedGroups: string[];
  selectedRoutineId: string | null;
  onToggle(id: string): void;
  onSelect(id: string): void;
}) {
  if (!routines.length) return <div className="ll-empty ll-routine-empty"><strong>No Routines yet</strong><p>Create a reusable sequence of actions, planned targets, and optional schedule.</p></div>;
  const availableGroupIds = new Set(groups.filter((group) => group.kind === "group").map((group) => group.id));
  return <div className="ll-routine-groups">{groups.map((group) => {
    const items = routines.filter((routine) => group.kind === "ungrouped" ? routine.groupId === null
      : group.kind === "unavailable" ? routine.groupId !== null && !availableGroupIds.has(routine.groupId)
        : routine.groupId === group.id);
    if (!items.length && group.kind !== "group") return null;
    const collapsed = collapsedGroups.includes(group.id);
    return <section className="ll-collection-group ll-routine-group" key={group.id}>
      <div className="ll-group-heading"><button type="button" aria-expanded={!collapsed} onClick={() => onToggle(group.id)}>
        {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}<strong>{group.title}</strong><small>{items.length} {items.length === 1 ? "Routine" : "Routines"}</small>
      </button></div>
      {!collapsed && <div className="ll-group-members ll-record-list">{items.length ? items.map((routine) => <RoutineRow key={routine.id} routine={routine} selected={selectedRoutineId === routine.id} onSelect={() => onSelect(routine.id)} />) : <p className="ll-empty-small">No Routines in this Group.</p>}</div>}
    </section>;
  })}</div>;
}

function RoutineRow({ routine, selected, onSelect }: { routine: RoutineSummaryRecord; selected: boolean; onSelect(): void }) {
  return <div className={`ll-member-row ll-routine-row${selected ? " selected" : ""}`} data-routine-id={routine.id}>
    <button className="ll-row-main" onClick={onSelect} aria-current={selected ? "true" : undefined}>
      <Repeat2 size={18} /><span className="ll-row-copy"><strong>{routine.title}</strong><small>{routine.purpose || "No purpose added"}</small></span>
      <span className="ll-chip ll-neutral">Revision {routine.revisionNumber}</span>
    </button>
  </div>;
}

function TodayIndex({ occurrences, routines, activeRunRoutineId, onSelect, onBegin }: {
  occurrences: RoutineOccurrenceRecord[];
  routines: RoutineSummaryRecord[];
  activeRunRoutineId: string | null;
  onSelect(routineId: string): void;
  onBegin(occurrence: RoutineOccurrenceRecord): void;
}) {
  const today = localIsoDate();
  const items = occurrences.filter((occurrence) => occurrence.localDate === today).sort((left, right) => left.plannedFor.localeCompare(right.plannedFor));
  if (!items.length) return <div className="ll-empty ll-routine-empty"><CalendarDays size={24} /><strong>Nothing planned for today</strong><p>Your unscheduled Routines are still available from the Routines tab.</p></div>;
  return <div className="ll-record-list ll-routine-occurrences">{items.map((occurrence) => {
    const routine = routines.find((candidate) => candidate.id === occurrence.routineId);
    const canStart = occurrence.status === "planned" || occurrence.status === "started";
    return <div className="ll-member-row ll-routine-row" key={occurrence.id}>
      <button className="ll-row-main" onClick={() => onSelect(occurrence.routineId)}>
        <Clock3 size={18} /><span className="ll-row-copy"><strong>{routine?.title ?? "Routine"}</strong><small>{formatRoutineDateTime(occurrence.plannedFor)}</small></span>
        <span className={`ll-chip ${occurrence.status === "completed" ? "ll-blue" : "ll-neutral"}`}>{occurrence.status}</span>
      </button>
      {canStart && <button className="ll-icon-button ll-row-action" title={activeRunRoutineId === occurrence.routineId ? "Resume Routine" : "Start Routine"} aria-label={activeRunRoutineId === occurrence.routineId ? "Resume Routine" : "Start Routine"} onClick={() => onBegin(occurrence)}><Play size={17} /></button>}
    </div>;
  })}</div>;
}

function SessionIndex({ sessions, routines, onSelect }: { sessions: RoutineSessionProjection[]; routines: RoutineSummaryRecord[]; onSelect(session: RoutineSessionProjection): void }) {
  const items = [...sessions].sort((left, right) => right.session.completedAt.localeCompare(left.session.completedAt));
  if (!items.length) return <div className="ll-empty ll-routine-empty"><History size={24} /><strong>No completed Sessions yet</strong><p>Completed Runs become immutable history here.</p></div>;
  return <div className="ll-record-list ll-routine-sessions">{items.map((session) => {
    const routine = routines.find((candidate) => candidate.id === session.session.routineId);
    return <div className="ll-member-row ll-routine-row" key={session.session.id}>
      <button className="ll-row-main" onClick={() => onSelect(session)}>
        <CircleCheck size={18} /><span className="ll-row-copy"><strong>{routine?.title ?? "Completed Routine"}</strong><small>{formatRoutineDateTime(session.session.completedAt)} · {session.stepResults.length} recorded {session.stepResults.length === 1 ? "Step" : "Steps"}</small></span>
      </button>
    </div>;
  })}</div>;
}

export function RoutineDetailPanel({ controller, snapshot, onOpenDialog, onShowSession }: SharedPanelProps & {
  onShowSession?(sessionId: string, routineId: string): void;
}) {
  const state = snapshot.routineWorkspace;
  const selected = state.selectedRoutine;
  if (!selected) return <div className="ll-empty">Select a Routine to see its steps, schedule, and history.</div>;
  const { routine, currentRevision } = selected;
  const group = state.groups.find((candidate) => candidate.id === routine.groupId);
  const sessions = state.sessions.filter((candidate) => candidate.session.routineId === routine.id)
    .sort((left, right) => right.session.completedAt.localeCompare(left.session.completedAt));
  const activeRun = state.activeRun?.routineId === routine.id ? state.activeRun : null;
  async function showSession(sessionId: string) {
    await controller.selectRoutineSession(sessionId);
    if (controller.getSnapshot().routineWorkspace.error) return;
    onShowSession?.(sessionId, routine.id);
  }
  return <article className="ll-detail-content ll-routine-detail" data-selected-routine-id={routine.id}>
    <p className="ll-context-row">My Routines{group ? ` / ${group.title}` : ""}</p>
    <div className="ll-title-row ll-detail-title-row"><h2>{currentRevision.revision.title}</h2>
      <ActionMenu label={`Actions for ${currentRevision.revision.title}`} className="ll-icon-button ll-primary ll-detail-plus" items={[
        { label: "Edit future Routine", icon: <Pencil size={17} />, onClick: () => onOpenDialog({ kind: "revise-routine" }) },
        { label: "Add schedule", icon: <CalendarPlus size={17} />, onClick: () => onOpenDialog({ kind: "new-schedule" }) },
        { label: activeRun ? "Resume Run" : "Start Run", icon: <Play size={17} />, onClick: () => onOpenDialog({ kind: "run" }) }
      ]}><Plus size={21} /></ActionMenu>
    </div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">Private Routine</span><span className="ll-chip ll-blue">Revision {currentRevision.revision.revisionNumber}</span>{group && <span className="ll-chip ll-neutral">{group.title}</span>}{activeRun && <span className="ll-chip ll-truth-planned">Run in progress</span>}</div>
    {currentRevision.revision.purpose && <p className="ll-collection-purpose">{currentRevision.revision.purpose}</p>}
    {activeRun && <section className="ll-routine-active-card"><div><strong>Continue your current Run</strong><span>Started {formatRoutineDateTime(activeRun.startedAt)} · {activeRun.stepResults.length} of {currentRevision.steps.length} Steps recorded</span></div><button className="ll-button ll-primary" onClick={() => onOpenDialog({ kind: "run" })}><Play size={16} />Resume</button></section>}
    {currentRevision.revision.instructions && <section className="ll-detail-section"><h3>Instructions</h3><p className="ll-preserve-lines">{currentRevision.revision.instructions}</p></section>}
    <section className="ll-detail-section ll-routine-step-list"><header><h3>Steps</h3><span className="ll-muted">Planned targets</span></header>
      {currentRevision.steps.map((step, index) => <div className="ll-routine-step" key={step.id}>
        <span className="ll-routine-step-number">{index + 1}</span><div><strong>{step.activityTitle}</strong>{step.optional && <span className="ll-chip ll-neutral">Optional</span>}{step.instructions && <p>{step.instructions}</p>}<RoutineValueList values={step.plannedValues} empty="No planned values" /></div>
      </div>)}
    </section>
    <section className="ll-detail-section"><header><h3>Schedule</h3><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "new-schedule" })}><CalendarPlus size={15} />Add</button></header>
      {!state.schedules.length ? <p className="ll-muted">No schedule. This Routine can still be started any time.</p> : state.schedules.map((schedule) => <div className="ll-routine-schedule" key={schedule.id}><div><strong>{routineScheduleMeta(schedule)}</strong><small>Schedule revision {schedule.revision}</small></div><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "edit-schedule", scheduleId: schedule.id })}>Edit</button></div>)}
    </section>
    <section className="ll-detail-section"><h3>Connected context</h3>
      {!currentRevision.bindings.length ? <p className="ll-muted">No Life Links or Collections connected.</p> : <ul className="ll-routine-context-list">{currentRevision.bindings.map((binding) => <li key={binding.id}><span className="ll-chip ll-neutral">{binding.targetType === "life_link" ? "Life Link" : "Collection"}</span><span>{contextTargetTitle(snapshot, binding.targetType, binding.targetId)}</span>{binding.routineStepId && <small>Step-specific</small>}</li>)}</ul>}
      {activeRun?.contextSnapshot.length ? <p className="ll-muted">This Run has frozen a context snapshot. Later Collection or Life Link changes will not rewrite it.</p> : null}
    </section>
    <section className="ll-detail-section"><header><h3>Recent Sessions</h3><button className="ll-text-button" onClick={() => void controller.loadRoutineSessions({ routineId: routine.id })}>Refresh</button></header>
      {!sessions.length ? <p className="ll-muted">No completed Sessions</p> : sessions.slice(0, 4).map((session) => <button className="ll-search-result" key={session.session.id} onClick={() => void showSession(session.session.id)}><strong>{formatRoutineDateTime(session.session.completedAt)}</strong><small>{session.stepResults.length} recorded {session.stepResults.length === 1 ? "Step" : "Steps"} · immutable history</small></button>)}
    </section>
    <details className="ll-record-meta"><summary>Routine details</summary><dl><dt>Routine ID</dt><dd>{routine.id}</dd><dt>Revision ID</dt><dd>{currentRevision.revision.id}</dd><dt>Updated</dt><dd>{formatRoutineDateTime(routine.updatedAt)}</dd></dl></details>
  </article>;
}

export function RoutineSessionDetailPanel({ snapshot, onBack, onOpenDialog }: Pick<SharedPanelProps, "snapshot" | "onOpenDialog"> & { onBack(): void }) {
  const selected = snapshot.routineWorkspace.selectedSession;
  if (!selected) return <div className="ll-empty">Select a completed Session to review its results.</div>;
  const currentRoutine = snapshot.routineWorkspace.selectedRoutine;
  const sameRevision = currentRoutine?.currentRevision.revision.id === selected.session.routineRevisionId;
  const title = sameRevision ? currentRoutine?.currentRevision.revision.title ?? "Completed Routine" : "Completed Routine";
  const stepTitle = (stepId: string, index: number) => sameRevision
    ? currentRoutine?.currentRevision.steps.find((step) => step.id === stepId)?.activityTitle ?? `Step ${index + 1}`
    : `Step ${index + 1}`;
  return <article className="ll-detail-content ll-routine-session-detail" data-routine-session-id={selected.session.id}>
    <button className="ll-text-button ll-hierarchy-return" onClick={onBack}><ChevronLeft size={15} />Back to Routine</button>
    <p className="ll-context-row">My Routines / History</p>
    <div className="ll-title-row ll-detail-title-row"><h2>{title}</h2><span className="ll-chip ll-blue">Completed</span></div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">Immutable Session</span><span className="ll-chip ll-neutral">{formatRoutineDateTime(selected.session.completedAt)}</span></div>
    <p className="ll-muted">The original Session is preserved. Corrections are append-only and change only the effective reading.</p>
    <section className="ll-detail-section ll-routine-session-summary"><h3>Timing</h3><dl><div><dt>Started</dt><dd>{formatRoutineDateTime(selected.session.startedAt)}</dd></div><div><dt>Completed</dt><dd>{formatRoutineDateTime(selected.session.completedAt)}</dd></div></dl></section>
    <section className="ll-detail-section"><header><h3>Recorded results</h3><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "correct-session", sessionId: selected.session.id, stepResultId: null })}>Add session note</button></header>
      {selected.stepResults.map((result, index) => <div className="ll-routine-session-step" key={result.original.id}>
        <header><div><span className="ll-routine-step-number">{index + 1}</span><strong>{stepTitle(result.original.routineStepId, index)}</strong></div><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "correct-session", sessionId: selected.session.id, stepResultId: result.original.id })}>Correct</button></header>
        <div className="ll-routine-result-columns"><section><h4>Actual</h4><RoutineValueList values={result.effectiveActualValues} empty="Unknown" /></section><section><h4>Next-time proposal</h4><RoutineValueList values={result.effectiveProposedNextValues} empty="No proposal" /></section></div>
        {result.original.notes && <p className="ll-preserve-lines">{result.original.notes}</p>}
        {result.amendments.length > 0 && <details><summary>{result.amendments.length} {result.amendments.length === 1 ? "correction" : "corrections"}</summary><ul>{result.amendments.map((amendment) => <li key={amendment.id}>{amendment.note}<small>{formatRoutineDateTime(amendment.createdAt)}</small></li>)}</ul></details>}
      </div>)}
    </section>
    {selected.sessionAmendments.length > 0 && <section className="ll-detail-section"><h3>Session notes</h3><ul className="ll-routine-amendments">{selected.sessionAmendments.map((amendment) => <li key={amendment.id}><span>{amendment.note}</span><small>{formatRoutineDateTime(amendment.createdAt)}</small></li>)}</ul></section>}
    {selected.session.contextSnapshot.length > 0 && <section className="ll-detail-section"><h3>Context captured at start</h3><ul className="ll-routine-context-list">{selected.session.contextSnapshot.map((context) => <li key={context.bindingId}><span className="ll-chip ll-neutral">{context.targetType === "life_link" ? "Life Link" : "Collection"}</span><span>{context.targetTitle}</span><small>{context.resolvedLifeLinks.length} resolved {context.resolvedLifeLinks.length === 1 ? "Life Link" : "Life Links"}</small></li>)}</ul></section>}
    <details className="ll-record-meta"><summary>Session details</summary><dl><dt>Session ID</dt><dd>{selected.session.id}</dd><dt>Routine revision</dt><dd>{selected.session.routineRevisionId}</dd><dt>Run ID</dt><dd>{selected.session.runId}</dd></dl></details>
  </article>;
}

function contextTargetTitle(snapshot: LifeLinksWorkspaceSnapshot, type: "life_link" | "collection", id: string): string {
  if (type === "collection") return snapshot.collections.find((collection) => collection.id === id)?.title ?? id;
  if (snapshot.selectedLifeLinkDetail?.lifeLink.id === id) return snapshot.selectedLifeLinkDetail.lifeLink.title;
  if (snapshot.hierarchyParentDetail?.lifeLink.id === id) return snapshot.hierarchyParentDetail.lifeLink.title;
  const root = snapshot.rootLifeLinks.items.find((item) => item.id === id);
  if (root) return root.title;
  for (const branch of Object.values(snapshot.lifeLinkChildren)) {
    const item = branch.items.find((candidate) => candidate.id === id);
    if (item) return item.title;
  }
  return id;
}
