import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  History,
  Layers3,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Trash2
} from "lucide-react";
import type { RoutineOccurrenceRecord, RoutineSessionProjection, RoutineSummaryRecord } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { ActionMenu } from "./FieldLedgerPrimitives";
import {
  RoutineValueList,
  formatRoutineDateTime,
  routineScheduleMeta,
  routineEntryLabel,
  routineRecordedRevision,
  type RoutineDialogState
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
  const { tab, showRemoved, historyRoutineId, collapsedGroupIds: collapsedGroups } = state.presentation;
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const routines = useMemo(() => state.routines.filter((routine) => showRemoved || !routine.archivedAt), [showRemoved, state.routines]);
  const selectedRoutines = routines.filter((routine) => !routine.archivedAt && selectedIds.includes(routine.id));
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
    if (tab !== "history") return;
    const request = new AbortController();
    void controller.loadRoutineHistory({ signal: request.signal });
    return () => request.abort();
  }, [controller, historyRoutineId, tab]);

  useEffect(() => { setEditing(false); setSelectedIds([]); setError(""); }, [snapshot.currentUser?.id]);

  async function showRoutine(routineId: string) {
    controller.setRoutineDetailPresentation("routine");
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
    controller.setRoutinePresentation({ collapsedGroupIds: collapsedGroups.includes(id) ? collapsedGroups.filter((value) => value !== id) : [...collapsedGroups, id] });
  }

  function toggleAll() {
    controller.setRoutinePresentation({ collapsedGroupIds: allCollapsed ? [] : groupIds });
  }

  function toggleSelection(id: string) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function toggleRemoved() {
    controller.setRoutinePresentation({ showRemoved: !showRemoved }); setError("");
    try { await controller.loadRoutineWorkspace({ includeArchived: !showRemoved }); }
    catch { setError("Could not load Routines. Try Show removed routines again."); }
  }
  async function restore(routine: RoutineSummaryRecord) {
    setRestoringId(routine.id); setError("");
    try { await controller.updateRoutine(routine.id, routine.updatedAt, { archivedAt: null }); }
    catch { setError("Could not restore this Routine. Refresh and try again; its history is still retained."); }
    finally { setRestoringId(null); }
  }

  return <div className="ll-routines-workspace">
    <div className="ll-title-row">
      <div><h1>My Routines</h1><p className="ll-subtitle">{routines.length} {routines.length === 1 ? "Routine" : "Routines"}{showRemoved ? " including removed" : ""} · actions and progress over time</p></div>
      <ActionMenu label="Create in My Routines" className="ll-icon-button ll-primary ll-main-plus" items={[
        { label: "New Routine", icon: <Repeat2 size={17} />, onClick: () => onOpenDialog({ kind: "new-routine" }) },
        { label: "New Group", icon: <Layers3 size={17} />, onClick: () => onOpenDialog({ kind: "new-group" }) },
        { label: "Edit", icon: <Pencil size={17} />, onClick: () => { controller.setRoutinePresentation({ tab: "routines" }); setSelectedIds([]); setEditing(true); } }
      ]}><Plus size={22} /></ActionMenu>
    </div>

    <div className="ll-collection-toolbar ll-routine-toolbar">
      <div className="ll-view-switch" role="tablist" aria-label="Routine views">
        <button id="ll-routine-tab-routines" type="button" role="tab" aria-controls="ll-routine-panel-routines" aria-selected={tab === "routines"} aria-pressed={tab === "routines"} onClick={() => controller.setRoutinePresentation({ tab: "routines" })}><Repeat2 size={15} />Routines</button>
        <button id="ll-routine-tab-history" type="button" role="tab" aria-controls="ll-routine-panel-history" aria-selected={tab === "history"} aria-pressed={tab === "history"} onClick={() => { controller.setRoutinePresentation({ tab: "history" }); setEditing(false); setSelectedIds([]); }}><History size={15} />History</button>
      </div>
      {tab === "routines" && groups.length > 1 && <button className="ll-text-button ll-section-toggle-all" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>}
    </div>

    {tab === "routines" && <button type="button" className="ll-text-button" aria-pressed={showRemoved} disabled={state.loading} onClick={() => void toggleRemoved()}>{showRemoved ? "Hide removed routines" : "Show removed routines"}</button>}
    {tab === "routines" && editing && <div className="ll-edit-toolbar"><div role="toolbar" aria-label="Edit Routines">
      <strong>{selectedRoutines.length} selected</strong>
      <button type="button" className="ll-button" disabled={!selectedRoutines.length} onClick={() => onOpenDialog({ kind: "delete-routines", routines: selectedRoutines.map((routine) => ({ id: routine.id, title: routine.title, expectedUpdatedAt: routine.updatedAt })) })}><Trash2 size={15} />Delete</button>
      <button type="button" className="ll-button" onClick={() => { setEditing(false); setSelectedIds([]); }}>Done</button>
    </div></div>}

    {error && <p className="ll-error" role="alert">{error}</p>}
    {state.error && <p className="ll-error" role="alert">{state.error}</p>}
    {state.loading && !state.routines.length ? <p className="ll-empty" role="status">Loading Routines…</p> : null}
    {tab === "routines" && <div id="ll-routine-panel-routines" role="tabpanel" aria-labelledby="ll-routine-tab-routines"><RoutineIndex
      routines={routines}
      groups={groups}
      collapsedGroups={collapsedGroups}
      selectedRoutineId={state.selectedRoutine?.routine.id ?? null}
      editing={editing}
      selectedIds={selectedIds}
      restoringId={restoringId}
      onToggleSelection={toggleSelection}
      onRestore={(routine) => void restore(routine)}
      onToggle={toggleGroup}
      onSelect={(routineId) => void showRoutine(routineId)}
    /></div>}
    {tab === "history" && <div id="ll-routine-panel-history" role="tabpanel" aria-labelledby="ll-routine-tab-history">
      <div className="ll-collection-toolbar"><label>History for <select aria-label="History for" value={historyRoutineId ?? ""} onChange={(event) => controller.setRoutinePresentation({ historyRoutineId: event.target.value || null })}>
        <option value="">All routines</option>{state.routines.map((routine) => <option key={routine.id} value={routine.id}>{routine.title}{routine.archivedAt ? " (removed)" : ""}</option>)}
        {historyRoutineId && !state.routines.some((routine) => routine.id === historyRoutineId) && <option value={historyRoutineId}>Selected Routine</option>}
      </select></label><button type="button" className="ll-text-button" disabled={state.history.loading} onClick={() => void controller.loadRoutineHistory()}>Refresh history</button></div>
      {state.history.error && <p className="ll-error" role="alert">{state.history.error}</p>}
      {state.history.loading && <p role="status" className="ll-muted">Loading history…</p>}
      {(state.history.loaded || state.history.sessions.length > 0) && <SessionIndex sessions={state.history.sessions} snapshot={snapshot} onSelect={(session) => void showSession(session)} />}
    </div>}
    {state.routinesNextCursor && <button className="ll-button ll-load-more" onClick={() => void controller.loadMoreRoutines()}>{tab === "history" ? "Load more Routine choices" : "Load more Routines"}</button>}
    {tab === "history" && state.history.nextCursor && <button className="ll-button ll-load-more" disabled={state.history.loading} onClick={() => void controller.loadRoutineHistory({ cursor: state.history.nextCursor })}>Load more history</button>}
  </div>;
}

function RoutineIndex({ routines, groups, collapsedGroups, selectedRoutineId, editing, selectedIds, restoringId, onToggleSelection, onRestore, onToggle, onSelect }: {
  routines: RoutineSummaryRecord[];
  groups: Array<{ id: string; title: string; notes: string; kind: "group" | "unavailable" | "ungrouped" }>;
  collapsedGroups: string[];
  selectedRoutineId: string | null;
  editing: boolean;
  selectedIds: string[];
  restoringId: string | null;
  onToggleSelection(id: string): void;
  onRestore(routine: RoutineSummaryRecord): void;
  onToggle(id: string): void;
  onSelect(id: string): void;
}) {
  if (!routines.length && !groups.some((group) => group.kind === "group")) return <div className="ll-empty ll-routine-empty"><strong>No Routines yet</strong><p>Create reusable Activities with planned targets, optional ordering, and an optional schedule.</p></div>;
  const availableGroupIds = new Set(groups.filter((group) => group.kind === "group").map((group) => group.id));
  return <div className="ll-routine-groups">{groups.map((group) => {
    const items = routines.filter((routine) => group.kind === "ungrouped" ? routine.groupId === null
      : group.kind === "unavailable" ? routine.groupId !== null && !availableGroupIds.has(routine.groupId)
        : routine.groupId === group.id);
    if (!items.length && group.kind !== "group") return null;
    const collapsed = collapsedGroups.includes(group.id);
    return <section className="ll-collection-group ll-routine-group" key={group.id}>
      <div className="ll-group-heading"><button type="button" aria-expanded={!collapsed} onClick={() => onToggle(group.id)}>
        {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}<span className="ll-routine-layer">{group.kind === "group" ? "Group" : "Routines"}</span><strong>{group.title}</strong><small>{items.length} {items.length === 1 ? "Routine" : "Routines"}</small>
      </button></div>
      {!collapsed && <div className="ll-group-members ll-record-list">{items.length ? items.map((routine) => <RoutineRow key={routine.id} routine={routine} selected={selectedRoutineId === routine.id}
        editing={editing} checked={selectedIds.includes(routine.id)} onToggleSelection={() => onToggleSelection(routine.id)}
        restoring={restoringId !== null} onRestore={() => onRestore(routine)} onSelect={() => onSelect(routine.id)} />) : <p className="ll-empty-small">No Routines in this Group.</p>}</div>}
    </section>;
  })}</div>;
}

function RoutineRow({ routine, selected, editing, checked, restoring, onToggleSelection, onRestore, onSelect }: {
  routine: RoutineSummaryRecord; selected: boolean; editing: boolean; checked: boolean; restoring: boolean;
  onToggleSelection(): void; onRestore(): void; onSelect(): void;
}) {
  return <div className={`ll-member-row ll-routine-row${selected ? " selected" : ""}`} data-routine-id={routine.id}>
    {editing && !routine.archivedAt && <input type="checkbox" className="ll-selection-dot" aria-label={`Select ${routine.title}`} checked={checked} onChange={onToggleSelection} />}
    <button className="ll-row-main" onClick={editing && !routine.archivedAt ? onToggleSelection : onSelect} aria-current={selected ? "true" : undefined}>
      <Repeat2 size={18} /><span className="ll-row-copy"><span className="ll-routine-layer">Routine</span><strong>{routine.title}</strong><small>{routine.purpose || "No purpose added"}</small></span>
      <span className="ll-chip ll-neutral">{routine.archivedAt ? "Removed" : `Revision ${routine.revisionNumber}`}</span>
    </button>
    {routine.archivedAt && <button type="button" className="ll-text-button" disabled={restoring} onClick={onRestore}>Restore</button>}
  </div>;
}

function SessionIndex({ sessions, snapshot, onSelect }: { sessions: RoutineSessionProjection[]; snapshot: LifeLinksWorkspaceSnapshot; onSelect(session: RoutineSessionProjection): void }) {
  const items = [...sessions].sort((left, right) => right.session.completedAt.localeCompare(left.session.completedAt));
  if (!items.length) return <div className="ll-empty ll-routine-empty"><History size={24} /><strong>No completed Sessions yet</strong><p>Completed Runs become immutable history here.</p></div>;
  return <div className="ll-record-list ll-routine-sessions">{items.map((session) => {
    const recorded = routineRecordedRevision(snapshot.routineWorkspace, session.session.routineRevisionId);
    return <div className="ll-member-row ll-routine-row" key={session.session.id}>
      <button className="ll-row-main" onClick={() => onSelect(session)}>
        <CircleCheck size={18} /><span className="ll-row-copy"><strong>{recorded?.revision.title ?? "Completed Routine"}</strong><small>{formatRoutineDateTime(session.session.completedAt)} · {session.stepResults.length} recorded {routineEntryLabel(recorded?.revision.ordering, session.stepResults.length !== 1)}</small></span>
      </button>
    </div>;
  })}</div>;
}

export function RoutineDetailPanel({ controller, snapshot, onOpenDialog, onShowSession }: SharedPanelProps & {
  onShowSession?(sessionId: string, routineId: string): void;
}) {
  const state = snapshot.routineWorkspace;
  const selected = state.selectedRoutine;
  if (!selected) return <div className="ll-empty">Select a Routine to see its Activities, schedule, and history.</div>;
  const { routine, currentRevision } = selected;
  const group = state.groups.find((candidate) => candidate.id === routine.groupId);
  const sessions = state.sessions.filter((candidate) => candidate.session.routineId === routine.id)
    .sort((left, right) => right.session.completedAt.localeCompare(left.session.completedAt));
  const activeRun = state.activeRun?.routineId === routine.id ? state.activeRun : null;
  const runRevision = activeRun ? routineRecordedRevision(state, activeRun.routineRevisionId) : null;
  const ordering = currentRevision.revision.ordering;
  async function showSession(sessionId: string) {
    await controller.selectRoutineSession(sessionId);
    if (controller.getSnapshot().routineWorkspace.error) return;
    onShowSession?.(sessionId, routine.id);
  }
  return <article className="ll-detail-content ll-routine-detail" data-selected-routine-id={routine.id}>
    <p className="ll-context-row">My Routines{group ? ` / ${group.title}` : ""}</p>
    <div className="ll-title-row ll-detail-title-row"><h2>{currentRevision.revision.title}</h2>
      {(!routine.archivedAt || activeRun) && <ActionMenu label={`Actions for ${currentRevision.revision.title}`} className="ll-icon-button ll-primary ll-detail-plus" items={[
        ...(!routine.archivedAt ? [
          { label: "Edit Routine", icon: <Pencil size={17} />, onClick: () => onOpenDialog({ kind: "revise-routine" }) },
          { label: "Add schedule", icon: <CalendarPlus size={17} />, onClick: () => onOpenDialog({ kind: "new-schedule" }) }
        ] : []),
        { label: activeRun ? "Resume Run" : "Start Run", icon: <Play size={17} />, onClick: () => onOpenDialog({ kind: "run" }) }
      ]}><Plus size={21} /></ActionMenu>}
    </div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">Private Routine</span><span className="ll-chip ll-neutral">{ordering === "ordered" ? "In order" : "Any order"}</span><span className="ll-chip ll-blue">Revision {currentRevision.revision.revisionNumber}</span>{group && <span className="ll-chip ll-neutral">Group: {group.title}</span>}{activeRun && <span className="ll-chip ll-truth-planned">Run in progress</span>}</div>
    {routine.archivedAt && <p className="ll-inline-warning">Removed from active Routines. History and Runs in progress are retained. Restore it from Show removed routines before adding future plans; schedules stay stopped until you edit them.</p>}
    {currentRevision.revision.purpose && <p className="ll-collection-purpose">{currentRevision.revision.purpose}</p>}
    {activeRun && <section className="ll-routine-active-card"><div><strong>Continue your current Run</strong><span>Started {formatRoutineDateTime(activeRun.startedAt)} · {activeRun.stepResults.length}{runRevision ? ` of ${runRevision.steps.length}` : ""} {routineEntryLabel(runRevision?.revision.ordering, true)} recorded</span></div><button className="ll-button ll-primary" onClick={() => onOpenDialog({ kind: "run" })}><Play size={16} />Resume</button></section>}
    {currentRevision.revision.instructions && <section className="ll-detail-section"><h3>Instructions</h3><p className="ll-preserve-lines">{currentRevision.revision.instructions}</p></section>}
    <section className="ll-detail-section ll-routine-step-list"><header><h3>{routineEntryLabel(ordering, true)}</h3><span className="ll-muted">Planned targets</span></header>
      {currentRevision.steps.map((step, index) => <div className={`ll-routine-step${ordering === "unordered" ? " ll-routine-step-unordered" : ""}`} key={step.id}>
        {ordering === "ordered" && <span className="ll-routine-step-number">{index + 1}</span>}<div><strong>{step.activityTitle}</strong>{step.optional && <span className="ll-chip ll-neutral">Optional</span>}{step.instructions && <p>{step.instructions}</p>}<RoutineValueList values={step.plannedValues} empty="No planned values" /></div>
      </div>)}
    </section>
    <section className="ll-detail-section"><header><h3>Schedule</h3>{!routine.archivedAt && <button className="ll-text-button" onClick={() => onOpenDialog({ kind: "new-schedule" })}><CalendarPlus size={15} />Add</button>}</header>
      {!state.schedules.length ? <p className="ll-muted">{routine.archivedAt ? "No active schedule." : "No schedule. This Routine can still be started any time."}</p> : state.schedules.map((schedule) => <div className="ll-routine-schedule" key={schedule.id}><div><strong>{routineScheduleMeta(schedule)}</strong><small>Schedule revision {schedule.revision}</small></div>{!routine.archivedAt && <button className="ll-text-button" onClick={() => onOpenDialog({ kind: "edit-schedule", scheduleId: schedule.id })}>Edit</button>}</div>)}
    </section>
    <section className="ll-detail-section"><h3>Connected context</h3>
      {!currentRevision.bindings.length ? <p className="ll-muted">No Life Links or Collections connected.</p> : <ul className="ll-routine-context-list">{currentRevision.bindings.map((binding) => <li key={binding.id}><span className="ll-chip ll-neutral">{binding.targetType === "life_link" ? "Life Link" : "Collection"}</span><span>{contextTargetTitle(snapshot, binding.targetType, binding.targetId)}</span>{binding.routineStepId && <small>{routineEntryLabel(ordering)}-specific</small>}</li>)}</ul>}
      {activeRun?.contextSnapshot.length ? <p className="ll-muted">This Run has frozen a context snapshot. Later Collection or Life Link changes will not rewrite it.</p> : null}
    </section>
    <section className="ll-detail-section"><header><h3>Recent Sessions</h3><button className="ll-text-button" onClick={() => void controller.loadRoutineSessions({ routineId: routine.id })}>Refresh</button><button className="ll-text-button" onClick={() => controller.setRoutinePresentation({ tab: "history", historyRoutineId: routine.id })}>View all history</button></header>
      {!sessions.length ? <p className="ll-muted">No completed Sessions</p> : sessions.slice(0, 4).map((session) => <button className="ll-search-result" key={session.session.id} onClick={() => void showSession(session.session.id)}><strong>{formatRoutineDateTime(session.session.completedAt)}</strong><small>{session.stepResults.length} recorded {routineEntryLabel(routineRecordedRevision(state, session.session.routineRevisionId)?.revision.ordering, session.stepResults.length !== 1)} · immutable history</small></button>)}
    </section>
    <details className="ll-record-meta"><summary>Routine details</summary><dl><dt>Routine ID</dt><dd>{routine.id}</dd><dt>Revision ID</dt><dd>{currentRevision.revision.id}</dd><dt>Updated</dt><dd>{formatRoutineDateTime(routine.updatedAt)}</dd></dl></details>
  </article>;
}

export function RoutineSessionDetailPanel({ snapshot, onBack, onOpenDialog }: Pick<SharedPanelProps, "snapshot" | "onOpenDialog"> & { onBack(): void }) {
  const selected = snapshot.routineWorkspace.selectedSession;
  if (!selected) return <div className="ll-empty">Select a completed Session to review its results.</div>;
  const recordedRevision = routineRecordedRevision(snapshot.routineWorkspace, selected.session.routineRevisionId);
  const ordering = recordedRevision?.revision.ordering;
  const title = recordedRevision?.revision.title ?? "Completed Routine";
  const stepTitle = (stepId: string, index: number) => recordedRevision?.steps.find((step) => step.id === stepId)?.activityTitle ?? `${routineEntryLabel(ordering)}${ordering === "ordered" ? ` ${index + 1}` : ""}`;
  return <article className="ll-detail-content ll-routine-session-detail" data-routine-session-id={selected.session.id}>
    <button className="ll-text-button ll-hierarchy-return" onClick={onBack}><ChevronLeft size={15} />Back to Routine</button>
    <p className="ll-context-row">My Routines / History</p>
    <div className="ll-title-row ll-detail-title-row"><h2>{title}</h2><span className="ll-chip ll-blue">Completed</span></div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">Immutable Session</span><span className="ll-chip ll-neutral">{formatRoutineDateTime(selected.session.completedAt)}</span></div>
    <p className="ll-muted">The original Session is preserved. Corrections are append-only and change only the effective reading.</p>
    <section className="ll-detail-section ll-routine-session-summary"><h3>Timing</h3><dl><div><dt>Started</dt><dd>{formatRoutineDateTime(selected.session.startedAt)}</dd></div><div><dt>Completed</dt><dd>{formatRoutineDateTime(selected.session.completedAt)}</dd></div></dl></section>
    <section className="ll-detail-section"><header><h3>Recorded {routineEntryLabel(ordering, true)}</h3><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "correct-session", sessionId: selected.session.id, stepResultId: null })}>Add session note</button></header>
      {selected.stepResults.map((result, index) => <div className="ll-routine-session-step" key={result.original.id}>
        <header><div>{ordering === "ordered" && <span className="ll-routine-step-number">{(recordedRevision?.steps.find((step) => step.id === result.original.routineStepId)?.position ?? index) + 1}</span>}<strong>{stepTitle(result.original.routineStepId, index)}</strong></div><button className="ll-text-button" onClick={() => onOpenDialog({ kind: "correct-session", sessionId: selected.session.id, stepResultId: result.original.id })}>Correct</button></header>
        <div className="ll-routine-result-columns"><section><h4>Actual</h4><RoutineValueList values={result.effectiveActualValues} empty="Unknown" /></section><section><h4>Next-time proposal</h4><RoutineValueList values={result.effectiveProposedNextValues} empty="No proposal" /></section></div>
        {result.original.notes && <p className="ll-preserve-lines">{result.original.notes}</p>}
        {result.amendments.length > 0 && <details open={snapshot.recordSearchTarget?.kind === "session" && snapshot.recordSearchTarget.sessionId === selected.session.id || undefined}><summary>{result.amendments.length} {result.amendments.length === 1 ? "correction" : "corrections"}</summary>
          <h4>Original actual results</h4><RoutineValueList values={result.original.actualValues} empty="Unknown" />
          <h4>Original next-time proposal</h4><RoutineValueList values={result.original.proposedNextValues} empty="No proposal" />
          <ul>{result.amendments.map((amendment) => <li key={amendment.id}>{amendment.note}<small>{formatRoutineDateTime(amendment.createdAt)}</small></li>)}</ul></details>}
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
