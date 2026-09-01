import { useEffect, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Package,
  Plus,
  Search,
  Trash2
} from "lucide-react";
import type {
  RoutineScheduleRule,
  RoutineStepRecord,
  RoutineValue,
  RoutineValueKind,
  RoutineWeekday
} from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { Dialog } from "./FieldLedgerPrimitives";
import {
  ROUTINE_VALUE_KINDS,
  RoutineValueList,
  blankRoutineValueDraft,
  draftToRoutineValue,
  localIsoDate,
  resultDraftValue,
  routineEntityId,
  routineValueRaw,
  routineValueToDraft,
  type RoutineDialogState,
  type RoutineValueDraft
} from "./RoutineShared";

type RoutineDialogHostProps = {
  dialog: NonNullable<RoutineDialogState>;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
  onSessionCompleted?(sessionId: string): void;
};

export function RoutineDialogHost({ dialog, controller, snapshot, onClose, onSessionCompleted }: RoutineDialogHostProps) {
  if (dialog.kind === "new-group" || dialog.kind === "new-activity") {
    return <SimpleRoutineCreateDialog kind={dialog.kind} controller={controller} snapshot={snapshot} onClose={onClose} />;
  }
  if (dialog.kind === "new-routine" || dialog.kind === "revise-routine") {
    return <RoutineDefinitionDialog revise={dialog.kind === "revise-routine"} controller={controller} snapshot={snapshot} onClose={onClose} />;
  }
  if (dialog.kind === "new-schedule" || dialog.kind === "edit-schedule") {
    return <RoutineScheduleDialog scheduleId={dialog.kind === "edit-schedule" ? dialog.scheduleId : null} controller={controller} snapshot={snapshot} onClose={onClose} />;
  }
  if (dialog.kind === "run") {
    return <RoutineRunDialog occurrenceId={dialog.occurrenceId ?? null} controller={controller} snapshot={snapshot} onClose={onClose} onSessionCompleted={onSessionCompleted} />;
  }
  return <RoutineCorrectionDialog sessionId={dialog.sessionId} stepResultId={dialog.stepResultId ?? null} controller={controller} snapshot={snapshot} onClose={onClose} />;
}

function SimpleRoutineCreateDialog({ kind, controller, snapshot, onClose }: {
  kind: "new-group" | "new-activity";
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
}) {
  const noun = kind === "new-group" ? "Group" : "Activity";
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setSaving(true); setError("");
    try {
      if (kind === "new-group") await controller.createRoutineGroup({ title, notes });
      else await controller.createRoutineActivity({ title, notes });
      onClose();
    } catch (issue) { setError(messageFromIssue(issue, `Could not create this ${noun}.`)); }
    finally { setSaving(false); }
  }
  return <Dialog title={`New ${noun}`} onClose={onClose}><form className="ll-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label>Name<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={kind === "new-group" ? "Optional context for this flat Group" : "Optional guidance shared wherever this Activity is used"} /></label>
    <p className="ll-muted">{kind === "new-group" ? "Groups organize Routines. They are flat and do not change execution." : "Activities are reusable action identities. Each Routine Step snapshots its title."}</p>
    {(error || snapshot.routineWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.routineWorkspace.error}</p>}
    <footer><button type="button" className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving || !title.trim()}>Create {noun}</button></footer>
  </form></Dialog>;
}

type RoutineStepDraft = {
  localId: string;
  sourceStepId: string | null;
  activityId: string;
  activityTitle: string;
  instructions: string;
  optional: boolean;
  plannedValues: RoutineValueDraft[];
};

type RoutineLifeLinkSelection = { id: string; title: string };

function blankStep(): RoutineStepDraft {
  return { localId: crypto.randomUUID(), sourceStepId: null, activityId: "", activityTitle: "", instructions: "", optional: false, plannedValues: [] };
}

function stepFromRecord(step: RoutineStepRecord): RoutineStepDraft {
  return {
    localId: crypto.randomUUID(), sourceStepId: step.id, activityId: step.activityId,
    activityTitle: step.activityTitle, instructions: step.instructions, optional: step.optional,
    plannedValues: step.plannedValues.map(routineValueToDraft)
  };
}

function RoutineDefinitionDialog({ revise, controller, snapshot, onClose }: {
  revise: boolean;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
}) {
  const existing = revise ? snapshot.routineWorkspace.selectedRoutine : null;
  const [title, setTitle] = useState(existing?.currentRevision.revision.title ?? "");
  const [purpose, setPurpose] = useState(existing?.currentRevision.revision.purpose ?? "");
  const [instructions, setInstructions] = useState(existing?.currentRevision.revision.instructions ?? "");
  const [groupId, setGroupId] = useState(existing?.routine.groupId ?? "");
  const [steps, setSteps] = useState<RoutineStepDraft[]>(existing?.currentRevision.steps.map(stepFromRecord) ?? [blankStep()]);
  const [contextCollectionIds, setContextCollectionIds] = useState<string[]>(() => existing?.currentRevision.bindings
    .filter((binding) => binding.routineStepId === null && binding.targetType === "collection")
    .map((binding) => binding.targetId) ?? []);
  const [contextLifeLinks, setContextLifeLinks] = useState<RoutineLifeLinkSelection[]>(() => existing?.currentRevision.bindings
    .filter((binding) => binding.routineStepId === null && binding.targetType === "life_link")
    .map((binding) => ({ id: binding.targetId, title: routineContextTargetTitle(snapshot, binding.targetId) })) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activities = snapshot.routineWorkspace.activities.filter((activity) => !activity.archivedAt);
  const groups = snapshot.routineWorkspace.groups.filter((group) => !group.archivedAt);
  useEffect(() => { if (!snapshot.collectionsComplete && !snapshot.collectionsLoading) void controller.loadCollections(); }, [controller, snapshot.collectionsComplete, snapshot.collectionsLoading]);

  function updateStep(localId: string, patch: Partial<RoutineStepDraft>) {
    setSteps((current) => current.map((step) => step.localId === localId ? { ...step, ...patch } : step));
  }
  function moveStep(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function updateValue(stepId: string, valueId: string, patch: Partial<RoutineValueDraft>) {
    setSteps((current) => current.map((step) => step.localId === stepId
      ? { ...step, plannedValues: step.plannedValues.map((value) => value.id === valueId ? { ...value, ...patch } : value) }
      : step));
  }

  async function submit() {
    setSaving(true); setError("");
    try {
      if (!steps.length) throw new Error("A Routine needs at least one Step.");
      const resolved = [...steps];
      for (let index = 0; index < resolved.length; index += 1) {
        const draft = resolved[index];
        if (draft.activityId) continue;
        if (!draft.activityTitle.trim()) throw new Error(`Step ${index + 1} needs an Activity.`);
        const activity = await controller.createRoutineActivity({ title: draft.activityTitle.trim() });
        resolved[index] = { ...draft, activityId: activity.id, activityTitle: activity.title };
        // Preserve each successfully created Activity in the form so a later
        // Routine failure can be retried without creating duplicate Activities.
        setSteps([...resolved]);
      }
      const apiStepIds = new Map(resolved.map((step) => [step.localId, routineEntityId("routine-step-")]));
      const oldToNewStep = new Map(resolved.flatMap((step) => step.sourceStepId ? [[step.sourceStepId, apiStepIds.get(step.localId)!] as const] : []));
      const apiSteps = resolved.map((step, position) => ({
        id: apiStepIds.get(step.localId), activityId: step.activityId, activityTitle: step.activityTitle,
        position, instructions: step.instructions, optional: step.optional,
        plannedValues: draftValuesToRoutineValues(step.plannedValues)
      }));
      const routineBindings = [
        ...contextCollectionIds.map((targetId) => ({ targetType: "collection" as const, targetId, routineStepId: null })),
        ...contextLifeLinks.map(({ id: targetId }) => ({ targetType: "life_link" as const, targetId, routineStepId: null }))
      ];
      if (existing) {
        const stepBindings = existing.currentRevision.bindings.flatMap((binding) => {
          if (binding.routineStepId === null) return [];
          const routineStepId = oldToNewStep.get(binding.routineStepId);
          return routineStepId ? [{ targetType: binding.targetType, targetId: binding.targetId, routineStepId }] : [];
        });
        await controller.reviseRoutine(existing.routine.id, {
          expectedCurrentRevisionId: existing.currentRevision.revision.id,
          title, purpose, instructions, steps: apiSteps, bindings: [...routineBindings, ...stepBindings]
        });
      } else {
        await controller.createRoutine({ groupId: groupId || null, title, purpose, instructions, steps: apiSteps, bindings: routineBindings });
        const createdRoutineId = controller.getSnapshot().routineWorkspace.selectedRoutine?.routine.id;
        if (createdRoutineId && !controller.getSnapshot().routineWorkspace.error) {
          await controller.openRoutine(createdRoutineId);
        }
      }
      if (!controller.getSnapshot().routineWorkspace.error) onClose();
    } catch (issue) { setError(messageFromIssue(issue, `Could not ${revise ? "revise" : "create"} this Routine.`)); }
    finally { setSaving(false); }
  }

  if (revise && !existing) return <Dialog title="Edit future Routine" onClose={onClose}><p className="ll-inline-warning">Select a Routine first.</p></Dialog>;
  return <Dialog title={revise ? "Edit future Routine" : "New Routine"} onClose={onClose} wide><form className="ll-form ll-routine-definition-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    {revise && <p className="ll-routine-immutability-note"><strong>This creates a new Routine revision.</strong> Completed Sessions and older revisions remain unchanged.</p>}
    <label>Name<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Purpose<textarea rows={2} maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="What this Routine helps you accomplish" /></label>
    {!revise && <label>Group<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">Ungrouped</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.title}</option>)}</select></label>}
    <label>Overall instructions<textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional guidance for the entire Routine" /></label>
    <RoutineContextPicker controller={controller} snapshot={snapshot} collectionIds={contextCollectionIds} lifeLinks={contextLifeLinks} onCollectionIdsChange={setContextCollectionIds} onLifeLinksChange={setContextLifeLinks} />
    <section className="ll-routine-step-builder" aria-labelledby="routine-steps-heading"><header><div><h3 id="routine-steps-heading">Steps</h3><p className="ll-muted">Planned targets are future defaults. A Run records actual results and next-time proposals separately.</p></div><button type="button" className="ll-button" onClick={() => setSteps((current) => [...current, blankStep()])}><Plus size={16} />Add Step</button></header>
      {steps.map((step, index) => <fieldset className="ll-routine-step-editor" key={step.localId}><legend>Step {index + 1}</legend>
        <div className="ll-routine-step-editor-actions"><button type="button" className="ll-icon-button" aria-label="Move Step up" title="Move up" disabled={index === 0} onClick={() => moveStep(index, -1)}><ChevronUp size={17} /></button><button type="button" className="ll-icon-button" aria-label="Move Step down" title="Move down" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}><ChevronDown size={17} /></button><button type="button" className="ll-icon-button ll-danger-text" aria-label="Remove Step" title="Remove Step" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((candidate) => candidate.localId !== step.localId))}><Trash2 size={17} /></button></div>
        <label>Activity<select value={step.activityId || "__new"} onChange={(event) => {
          if (event.target.value === "__new") updateStep(step.localId, { activityId: "", activityTitle: "" });
          else { const activity = activities.find((candidate) => candidate.id === event.target.value); updateStep(step.localId, { activityId: event.target.value, activityTitle: activity?.title ?? step.activityTitle }); }
        }}><option value="__new">Create a new Activity</option>{step.activityId && !activities.some((activity) => activity.id === step.activityId) && <option value={step.activityId}>{step.activityTitle} (archived)</option>}{activities.map((activity) => <option value={activity.id} key={activity.id}>{activity.title}</option>)}</select></label>
        {!step.activityId && <label>New Activity name<input required value={step.activityTitle} onChange={(event) => updateStep(step.localId, { activityTitle: event.target.value })} placeholder="For example: Review supplies" /></label>}
        <label>Step instructions<textarea rows={2} value={step.instructions} onChange={(event) => updateStep(step.localId, { instructions: event.target.value })} /></label>
        <label className="ll-check"><input type="checkbox" checked={step.optional} onChange={(event) => updateStep(step.localId, { optional: event.target.checked })} />This Step is optional</label>
        <div className="ll-routine-targets"><header><strong>Planned targets</strong><button type="button" className="ll-text-button" onClick={() => updateStep(step.localId, { plannedValues: [...step.plannedValues, blankRoutineValueDraft()] })}><Plus size={15} />Add target</button></header>
          {!step.plannedValues.length && <p className="ll-muted">No planned values. The Step can still record notes during a Run.</p>}
          {step.plannedValues.map((value) => <div className="ll-routine-target-editor" key={value.id}>
            <label>Label<input required value={value.label} onChange={(event) => updateValue(step.localId, value.id, { label: event.target.value })} placeholder="Weight, duration, count, status…" /></label>
            <label>Type<select value={value.kind} onChange={(event) => { const kind = event.target.value as RoutineValueKind; updateValue(step.localId, value.id, { kind, raw: kind === "boolean" ? "false" : "", unit: "" }); }}>{ROUTINE_VALUE_KINDS.map((kind) => <option value={kind} key={kind}>{routineValueKindLabel(kind)}</option>)}</select></label>
            <RoutineValueDraftInput value={value} onChange={(patch) => updateValue(step.localId, value.id, patch)} />
            <button type="button" className="ll-icon-button ll-danger-text" aria-label={`Remove ${value.label || "target"}`} title="Remove target" onClick={() => updateStep(step.localId, { plannedValues: step.plannedValues.filter((candidate) => candidate.id !== value.id) })}><Trash2 size={17} /></button>
          </div>)}
        </div>
      </fieldset>)}
    </section>
    {(error || snapshot.routineWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.routineWorkspace.error}</p>}
    <footer><button type="button" className="ll-button" disabled={saving} onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving || !title.trim() || !steps.length}>{revise ? "Save new revision" : "Create Routine"}</button></footer>
  </form></Dialog>;
}

function RoutineContextPicker({ controller, snapshot, collectionIds, lifeLinks, onCollectionIdsChange, onLifeLinksChange }: {
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  collectionIds: string[];
  lifeLinks: RoutineLifeLinkSelection[];
  onCollectionIdsChange(ids: string[]): void;
  onLifeLinksChange(items: RoutineLifeLinkSelection[]): void;
}) {
  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  function search() {
    if (!query.trim()) return;
    setHasSearched(true);
    void controller.searchLifeLinks(query.trim());
  }
  return <section className="ll-detail-section" aria-labelledby="routine-context-heading">
    <header><div><h3 id="routine-context-heading">Connected context</h3><p className="ll-muted">Routine-level · optional</p></div></header>
    <p className="ll-muted">Connect owned Life Links or Collections for the agent and Run snapshot. Context does not move, publish, or change those records.</p>
    <h3>Collections</h3>
    <div className="ll-button-row" aria-label="Selected Routine Collections">
      {collectionIds.map((id) => <button type="button" className="ll-chip ll-blue" key={id} title="Remove Collection" onClick={() => onCollectionIdsChange(collectionIds.filter((value) => value !== id))}><Boxes size={14} />{snapshot.collections.find((collection) => collection.id === id)?.title ?? id}<span aria-hidden="true">×</span></button>)}
      {!collectionIds.length && <span className="ll-muted">No Collections connected</span>}
    </div>
    {snapshot.collectionsLoading ? <p className="ll-muted">Loading Collections…</p> : <div className="ll-button-row" aria-label="Available Routine Collections">{snapshot.collections.filter((collection) => !collectionIds.includes(collection.id)).map((collection) => <button type="button" className="ll-chip ll-neutral" key={collection.id} onClick={() => onCollectionIdsChange([...collectionIds, collection.id])}><Plus size={14} />{collection.title}</button>)}</div>}
    {!snapshot.collectionsLoading && snapshot.collectionsComplete && !snapshot.collections.length && <p className="ll-muted">Create a Collection in My Collections before connecting one here.</p>}
    <h3>Life Links</h3>
    <div className="ll-button-row" aria-label="Selected Routine Life Links">
      {lifeLinks.map((item) => <button type="button" className="ll-chip ll-blue" key={item.id} title="Remove Life Link" onClick={() => onLifeLinksChange(lifeLinks.filter((value) => value.id !== item.id))}><Package size={14} />{item.title}<span aria-hidden="true">×</span></button>)}
      {!lifeLinks.length && <span className="ll-muted">No Life Links connected</span>}
    </div>
    <div className="ll-search-form"><Search size={17} /><input aria-label="Search Life Links to connect" placeholder="Search owned Life Links" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} /><button type="button" className="ll-button ll-primary" disabled={!query.trim() || snapshot.lifeLinkSearchLoading} onClick={search}>Search</button></div>
    {snapshot.lifeLinkSearchLoading && <p className="ll-muted">Searching…</p>}
    {hasSearched && !snapshot.lifeLinkSearchLoading && <div className="ll-picker-list">{snapshot.lifeLinkSearchResults.map((result) => {
      const selected = lifeLinks.some((item) => item.id === result.lifeLink.id);
      return <div key={result.lifeLink.id}><button type="button" disabled={selected} onClick={() => onLifeLinksChange([...lifeLinks, { id: result.lifeLink.id, title: result.lifeLink.title }])}><Package size={17} /><span>{result.lifeLink.title}</span>{selected ? <small>Connected</small> : <Plus size={16} />}</button></div>;
    })}{!snapshot.lifeLinkSearchResults.length && <p className="ll-empty-small">No Life Links found.</p>}</div>}
    {hasSearched && snapshot.lifeLinkSearchNextCursor && <button type="button" className="ll-text-button" onClick={() => void controller.searchLifeLinks(undefined, true)}>Load more Life Links</button>}
  </section>;
}

const WEEKDAYS: RoutineWeekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function RoutineScheduleDialog({ scheduleId, controller, snapshot, onClose }: {
  scheduleId: string | null;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
}) {
  const selected = snapshot.routineWorkspace.selectedRoutine;
  const schedule = scheduleId ? snapshot.routineWorkspace.schedules.find((candidate) => candidate.id === scheduleId) : null;
  const initialRule = schedule?.rule;
  const [kind, setKind] = useState<RoutineScheduleRule["kind"]>(initialRule?.kind ?? "weekly");
  const [startDate, setStartDate] = useState(initialRule?.kind === "once" ? initialRule.localDate : initialRule?.startDate ?? localIsoDate());
  const [endDate, setEndDate] = useState(initialRule?.kind !== "once" ? initialRule?.endDate ?? "" : "");
  const [localTime, setLocalTime] = useState(initialRule?.localTime ?? "08:00");
  const [timeZone, setTimeZone] = useState(initialRule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
  const [interval, setInterval] = useState(initialRule?.kind === "daily" ? initialRule.intervalDays : initialRule?.kind === "weekly" ? initialRule.intervalWeeks : 1);
  const [weekdays, setWeekdays] = useState<RoutineWeekday[]>(initialRule?.kind === "weekly" ? initialRule.weekdays : [WEEKDAYS[(new Date().getDay() + 6) % 7]]);
  const [active, setActive] = useState(schedule?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      let rule: RoutineScheduleRule;
      if (kind === "once") rule = { kind, localDate: startDate, localTime, timeZone };
      else if (kind === "daily") rule = { kind, startDate, endDate: endDate || null, intervalDays: interval, localTime, timeZone };
      else {
        if (!weekdays.length) throw new Error("Choose at least one weekday.");
        rule = { kind, startDate, endDate: endDate || null, intervalWeeks: interval, weekdays, localTime, timeZone };
      }
      if (schedule) await controller.updateRoutineSchedule(schedule.id, schedule.updatedAt, { rule, active });
      else await controller.createRoutineSchedule(selected.routine.id, { rule, active });
      if (!controller.getSnapshot().routineWorkspace.error) onClose();
    } catch (issue) { setError(messageFromIssue(issue, "Could not save this schedule.")); }
    finally { setSaving(false); }
  }
  if (!selected) return <Dialog title="Routine schedule" onClose={onClose}><p className="ll-inline-warning">Select a Routine first.</p></Dialog>;
  return <Dialog title={schedule ? "Edit schedule" : "Add schedule"} onClose={onClose}><form className="ll-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label>Repeats<select value={kind} onChange={(event) => setKind(event.target.value as RoutineScheduleRule["kind"])}><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
    <label>{kind === "once" ? "Date" : "Start date"}<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
    {kind !== "once" && <label>End date (optional)<input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>}
    {kind !== "once" && <label>Interval<input type="number" min={1} max={366} step={1} required value={interval} onChange={(event) => setInterval(Number(event.target.value))} /><span className="ll-muted">{kind === "daily" ? "Days between occurrences" : "Weeks between occurrences"}</span></label>}
    {kind === "weekly" && <fieldset className="ll-routine-weekdays"><legend>Weekdays</legend>{WEEKDAYS.map((day) => <label className="ll-check" key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={(event) => setWeekdays(event.target.checked ? [...weekdays, day] : weekdays.filter((candidate) => candidate !== day))} />{day.slice(0, 3)}</label>)}</fieldset>}
    <label>Local time<input type="time" required value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></label>
    <label>Time zone<input required value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /><span className="ll-muted">Use an IANA time zone such as America/New_York.</span></label>
    <label className="ll-check"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Schedule is active</label>
    <p className="ll-muted">A schedule expresses intent. It does not claim that a Routine was started or completed.</p>
    {(error || snapshot.routineWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.routineWorkspace.error}</p>}
    <footer><button type="button" className="ll-button" disabled={saving} onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving}>Save schedule</button></footer>
  </form></Dialog>;
}

function RoutineRunDialog({ occurrenceId, controller, snapshot, onClose, onSessionCompleted }: {
  occurrenceId: string | null;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
  onSessionCompleted?(sessionId: string): void;
}) {
  const selected = snapshot.routineWorkspace.selectedRoutine;
  const activeRun = snapshot.routineWorkspace.activeRun;
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (!selected) return;
    setStarting(true); setError("");
    try { await controller.startRoutineRun(selected.routine.id, { id: routineEntityId("routine-run-"), occurrenceId }); }
    catch (issue) { setError(messageFromIssue(issue, "Could not start this Run.")); }
    finally { setStarting(false); }
  }
  async function complete() {
    const current = controller.getSnapshot().routineWorkspace.activeRun;
    if (!current) return;
    setCompleting(true); setError("");
    try {
      await controller.finalizeRoutineRun(current.id, { sessionId: routineEntityId("routine-session-"), expectedUpdatedAt: current.updatedAt });
      const sessionId = controller.getSnapshot().routineWorkspace.selectedSession?.session.id;
      onClose();
      if (sessionId) onSessionCompleted?.(sessionId);
    } catch (issue) { setError(messageFromIssue(issue, "Could not complete this Run.")); }
    finally { setCompleting(false); }
  }
  if (!selected) return <Dialog title="Routine Run" onClose={onClose}><p className="ll-inline-warning">Select a Routine first.</p></Dialog>;
  const steps = selected.currentRevision.steps;
  const recorded = new Set(activeRun?.stepResults.map((result) => result.routineStepId) ?? []);
  const missingRequired = steps.filter((step) => !step.optional && !recorded.has(step.id));
  return <Dialog title={activeRun ? `Run · ${selected.currentRevision.revision.title}` : `Start ${selected.currentRevision.revision.title}`} onClose={onClose} wide>
    {!activeRun ? <div className="ll-form ll-routine-run-start"><p>{selected.currentRevision.revision.purpose || "Work through this Routine and record what actually happened."}</p><dl className="ll-routine-run-plan"><dt>Steps</dt><dd>{steps.length}</dd><dt>Revision</dt><dd>{selected.currentRevision.revision.revisionNumber}</dd>{occurrenceId && <><dt>Planned occurrence</dt><dd>Linked</dd></>}</dl><p className="ll-muted">Starting freezes this revision and its connected Life Link or Collection context for the Run.</p>{error && <p className="ll-inline-warning" role="alert">{error}</p>}<footer><button className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={starting} onClick={() => void start()}><CircleCheck size={16} />Start Run</button></footer></div> : <div className="ll-routine-run">
      <header className="ll-routine-run-status"><div><strong>Run in progress</strong><span>{recorded.size} of {steps.length} Steps recorded</span></div><span className="ll-chip ll-truth-planned">Mutable Run</span></header>
      <p className="ll-muted">Planned targets, actual results, and next-time proposals stay separate. Proposals do not change future defaults automatically.</p>
      {steps.map((step, index) => <RunStepEditor key={`${activeRun.id}-${step.id}`} index={index} step={step} controller={controller} snapshot={snapshot} />)}
      {activeRun.contextSnapshot.length > 0 && <details className="ll-routine-run-context"><summary>Context captured when this Run started</summary><ul>{activeRun.contextSnapshot.map((context) => <li key={context.bindingId}><strong>{context.targetTitle}</strong><span>{context.resolvedLifeLinks.length} resolved {context.resolvedLifeLinks.length === 1 ? "Life Link" : "Life Links"}</span></li>)}</ul></details>}
      {(error || snapshot.routineWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.routineWorkspace.error}</p>}
      <footer className="ll-dialog-footer"><button className="ll-button" disabled={completing} onClick={onClose}>Close and resume later</button><button className="ll-button ll-primary" disabled={completing || missingRequired.length > 0} title={missingRequired.length ? `Record ${missingRequired.length} required Steps first` : "Complete this Run"} onClick={() => void complete()}><CircleCheck size={16} />Complete Routine</button></footer>
      {missingRequired.length > 0 && <p className="ll-muted ll-routine-required-note">Record {missingRequired.length} required {missingRequired.length === 1 ? "Step" : "Steps"} before completing. Optional Steps may remain unrecorded.</p>}
    </div>}
  </Dialog>;
}

function RunStepEditor({ index, step, controller, snapshot }: {
  index: number;
  step: RoutineStepRecord;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
}) {
  const existing = snapshot.routineWorkspace.activeRun?.stepResults.find((result) => result.routineStepId === step.id);
  const [actual, setActual] = useState<Record<string, string>>(() => Object.fromEntries(existing?.actualValues.map((value) => [value.key, routineValueRaw(value)]) ?? []));
  const [next, setNext] = useState<Record<string, string>>(() => Object.fromEntries(existing?.proposedNextValues.map((value) => [value.key, routineValueRaw(value)]) ?? []));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const run = controller.getSnapshot().routineWorkspace.activeRun;
    if (!run) return;
    setSaving(true); setError("");
    try {
      const actualValues = step.plannedValues.flatMap((template) => {
        const value = resultDraftValue(template, actual[template.key] ?? ""); return value ? [value] : [];
      });
      const proposedNextValues = step.plannedValues.flatMap((template) => {
        const value = resultDraftValue(template, next[template.key] ?? ""); return value ? [value] : [];
      });
      await controller.putRoutineRunStepResult(run.id, step.id, { expectedUpdatedAt: run.updatedAt, actualValues, proposedNextValues, notes });
    } catch (issue) { setError(messageFromIssue(issue, "Could not save this Step.")); }
    finally { setSaving(false); }
  }
  return <section className={`ll-routine-run-step${existing ? " recorded" : ""}`}>
    <header><div><span className="ll-routine-step-number">{index + 1}</span><strong>{step.activityTitle}</strong>{step.optional && <span className="ll-chip ll-neutral">Optional</span>}</div>{existing && <span className="ll-chip ll-blue">Recorded</span>}</header>
    {step.instructions && <p className="ll-preserve-lines">{step.instructions}</p>}
    {step.plannedValues.length ? <div className="ll-routine-run-values">
      <div className="ll-routine-value-heading"><strong>Planned</strong><strong>Actual</strong><strong>Next-time proposal</strong></div>
      {step.plannedValues.map((value) => <div className="ll-routine-value-entry" key={value.key}><div><span>{value.label}</span><RoutineValueList values={[value]} /></div><ResultValueInput template={value} value={actual[value.key] ?? ""} emptyLabel="Unknown" onChange={(raw) => setActual((current) => ({ ...current, [value.key]: raw }))} /><ResultValueInput template={value} value={next[value.key] ?? ""} emptyLabel="No proposal" onChange={(raw) => setNext((current) => ({ ...current, [value.key]: raw }))} /></div>)}
    </div> : <p className="ll-muted">This Step has no planned values. Save notes to record that it was performed.</p>}
    <label className="ll-routine-notes-label">Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What happened during this Step?" /></label>
    {error && <p className="ll-inline-warning" role="alert">{error}</p>}
    <div className="ll-button-row"><button className="ll-button" disabled={saving} onClick={() => void save()}>{existing ? "Update Step result" : "Save Step result"}</button></div>
  </section>;
}

function RoutineCorrectionDialog({ sessionId, stepResultId, controller, snapshot, onClose }: {
  sessionId: string;
  stepResultId: string | null;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
}) {
  const session = snapshot.routineWorkspace.selectedSession?.session.id === sessionId
    ? snapshot.routineWorkspace.selectedSession
    : snapshot.routineWorkspace.sessions.find((candidate) => candidate.session.id === sessionId) ?? null;
  const result = stepResultId ? session?.stepResults.find((candidate) => candidate.original.id === stepResultId) ?? null : null;
  const templates = result ? mergeValueTemplates(result.effectiveActualValues, result.effectiveProposedNextValues) : [];
  const [note, setNote] = useState("");
  const [correctActual, setCorrectActual] = useState(false);
  const [correctNext, setCorrectNext] = useState(false);
  const [actual, setActual] = useState<Record<string, string>>(() => Object.fromEntries(result?.effectiveActualValues.map((value) => [value.key, routineValueRaw(value)]) ?? []));
  const [next, setNext] = useState<Record<string, string>>(() => Object.fromEntries(result?.effectiveProposedNextValues.map((value) => [value.key, routineValueRaw(value)]) ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!session) return;
    setSaving(true); setError("");
    try {
      const correctedActualValues = correctActual ? templates.flatMap((template) => {
        const value = resultDraftValue(template, actual[template.key] ?? ""); return value ? [value] : [];
      }) : null;
      const correctedProposedNextValues = correctNext ? templates.flatMap((template) => {
        const value = resultDraftValue(template, next[template.key] ?? ""); return value ? [value] : [];
      }) : null;
      await controller.appendRoutineSessionAmendment(session.session.id, {
        id: routineEntityId("routine-session-amendment-"), stepResultId, note,
        correctedActualValues, correctedProposedNextValues
      });
      if (!controller.getSnapshot().routineWorkspace.error) onClose();
    } catch (issue) { setError(messageFromIssue(issue, "Could not append this correction.")); }
    finally { setSaving(false); }
  }
  if (!session) return <Dialog title="Add correction" onClose={onClose}><p className="ll-inline-warning">This Session is not available.</p></Dialog>;
  return <Dialog title={result ? "Correct Step result" : "Add Session note"} onClose={onClose}><form className="ll-form ll-routine-correction-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="ll-routine-immutability-note"><strong>The original Session will not be edited.</strong> This appends a dated correction to its effective reading.</p>
    <label>Correction note<textarea autoFocus required rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain what should be corrected or clarified" /></label>
    {result && templates.length > 0 && <><label className="ll-check"><input type="checkbox" checked={correctActual} onChange={(event) => setCorrectActual(event.target.checked)} />Correct actual values</label>{correctActual && <CorrectionValueInputs templates={templates} values={actual} emptyLabel="Unknown" onChange={setActual} />}
      <label className="ll-check"><input type="checkbox" checked={correctNext} onChange={(event) => setCorrectNext(event.target.checked)} />Correct next-time proposal</label>{correctNext && <CorrectionValueInputs templates={templates} values={next} emptyLabel="No proposal" onChange={setNext} />}</>}
    {result && !templates.length && <p className="ll-muted">This result has no typed values to correct. The note will still be preserved.</p>}
    {(error || snapshot.routineWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.routineWorkspace.error}</p>}
    <footer><button type="button" className="ll-button" disabled={saving} onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving || !note.trim()}>Append correction</button></footer>
  </form></Dialog>;
}

function RoutineValueDraftInput({ value, onChange }: { value: RoutineValueDraft; onChange(patch: Partial<RoutineValueDraft>): void }) {
  if (value.kind === "boolean") return <label>Planned<select value={value.raw || "false"} onChange={(event) => onChange({ raw: event.target.value })}><option value="true">Yes</option><option value="false">No</option></select></label>;
  return <><label>{value.kind === "duration" ? "Seconds" : value.kind === "text" ? "Planned text" : "Planned value"}<input type={value.kind === "text" ? "text" : "number"} step={value.kind === "duration" ? 1 : "any"} min={value.kind === "duration" ? 0 : undefined} required={value.kind !== "text"} value={value.raw} onChange={(event) => onChange({ raw: event.target.value })} /></label>{value.kind === "quantity" && <label>Unit<input required maxLength={32} value={value.unit} onChange={(event) => onChange({ unit: event.target.value })} placeholder="kg, reps, tablets…" /></label>}</>;
}

function ResultValueInput({ template, value, emptyLabel, onChange }: { template: RoutineValue; value: string; emptyLabel: string; onChange(raw: string): void }) {
  if (template.kind === "boolean") return <select aria-label={`${template.label} result`} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{emptyLabel}</option><option value="true">Yes</option><option value="false">No</option></select>;
  return <div className="ll-routine-result-input"><input aria-label={`${template.label} result`} type={template.kind === "text" ? "text" : "number"} step={template.kind === "duration" ? 1 : "any"} min={template.kind === "duration" ? 0 : undefined} value={value} placeholder={emptyLabel} onChange={(event) => onChange(event.target.value)} />{template.kind === "quantity" && <span>{template.unit}</span>}{template.kind === "duration" && <span>sec</span>}</div>;
}

function CorrectionValueInputs({ templates, values, emptyLabel, onChange }: { templates: RoutineValue[]; values: Record<string, string>; emptyLabel: string; onChange(values: Record<string, string>): void }) {
  return <div className="ll-routine-correction-values">{templates.map((template) => <label key={template.key}>{template.label}<ResultValueInput template={template} value={values[template.key] ?? ""} emptyLabel={emptyLabel} onChange={(raw) => onChange({ ...values, [template.key]: raw })} /></label>)}</div>;
}

function mergeValueTemplates(...groups: RoutineValue[][]): RoutineValue[] {
  const byKey = new Map<string, RoutineValue>();
  for (const value of groups.flat()) if (!byKey.has(value.key)) byKey.set(value.key, value);
  return [...byKey.values()];
}

function draftValuesToRoutineValues(drafts: RoutineValueDraft[]): RoutineValue[] {
  const reserved = new Set<string>();
  return drafts.map((draft) => draftToRoutineValue(draft, reserved));
}

function routineValueKindLabel(kind: RoutineValueKind): string {
  if (kind === "quantity") return "Quantity + unit";
  if (kind === "duration") return "Duration";
  if (kind === "boolean") return "Yes / no";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function messageFromIssue(issue: unknown, fallback: string): string {
  return issue instanceof Error && issue.message ? issue.message : fallback;
}

function routineContextTargetTitle(snapshot: LifeLinksWorkspaceSnapshot, id: string): string {
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
