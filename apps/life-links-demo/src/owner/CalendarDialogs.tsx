import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Cloud, Pencil, Plus, Trash2 } from "lucide-react";
import { normalizeCalendarEventSpan } from "@life-links/core";
import type {
  CalendarEventEditTargetInput,
  CalendarEventStatus,
  CalendarAgentAccess,
  CalendarConnectedCalendarView,
  CalendarConnectionView,
  ProviderCalendarEventReference,
  CalendarRecurrenceEnd,
  CalendarRecurrenceRule,
  CalendarWeekday
} from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import type { AgentCalendarDeletionPreview, AgentProviderCalendarDeletionPreview } from "../agent/calendarToolHandlers";
import { Dialog } from "./FieldLedgerPrimitives";
import { recurrenceSummary, resolvedTimeZone, supportedTimeZones, providerEventCanMutate, providerSpanForEditor, providerWritableSpan } from "./calendar";

export type CalendarDialogState =
  | { kind: "new-event"; date: string }
  | { kind: "edit-event"; eventId: string }
  | { kind: "delete-event"; eventId: string }
  | { kind: "edit-provider-event"; reference: ProviderCalendarEventReference }
  | { kind: "delete-provider-event"; reference: ProviderCalendarEventReference }
  | { kind: "manage-calendars" }
  | { kind: "select-calendars" }
  | null;

type Props = {
  dialog: NonNullable<CalendarDialogState>;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
};

export function CalendarDialogHost(props: Props) {
  const flow = props.snapshot.calendarWorkspace.connectionFlow;
  if (props.dialog.kind === "select-calendars" || (props.dialog.kind === "manage-calendars" &&
    (flow?.authorizationId || flow?.connectionId || flow?.error))) return <CalendarConnectionSelectionDialog {...props} />;
  if (props.dialog.kind === "manage-calendars") return <ManageCalendarsDialog {...props} />;
  if (props.dialog.kind === "delete-event") return <DeleteEventDialog {...props} eventId={props.dialog.eventId} />;
  if (props.dialog.kind === "delete-provider-event") return <DeleteProviderEventDialog {...props} reference={props.dialog.reference} />;
  if (props.dialog.kind === "edit-provider-event") return <CalendarEventDialog {...props} eventId={null} initialDate={null} providerReference={props.dialog.reference} />;
  return <CalendarEventDialog {...props} eventId={props.dialog.kind === "edit-event" ? props.dialog.eventId : null} initialDate={props.dialog.kind === "new-event" ? props.dialog.date : null} />;
}

export function AgentCalendarDeletionDialog({ preview, onConfirm, onCancel }: {
  preview: AgentCalendarDeletionPreview | AgentProviderCalendarDeletionPreview;
  onConfirm(): void;
  onCancel(): void;
}) {
  if ("providerEvent" in preview) return <Dialog title="Allow agent to delete this provider event?" onClose={onCancel} wide>
    <div className="ll-delete-confirmation ll-agent-calendar-delete-confirmation"><Trash2 size={30} />
      <p>The connected agent is waiting. This deletes the original event in the provider calendar.</p>
      <dl className="ll-calendar-facts">
        <div><dt>Event</dt><dd>{preview.providerEvent.content.title}</dd></div>
        <div><dt>Calendar / account</dt><dd>{preview.calendar.title} · {preview.providerEvent.providerAccountId}</dd></div>
        <div><dt>Source authority</dt><dd>{preview.providerEvent.providerKey}</dd></div>
        <div><dt>Date and time</dt><dd>{providerEventTiming(preview.providerEvent.content.span)}</dd></div>
        <div><dt>Scope</dt><dd>This exact standalone provider event</dd></div>
        <div><dt>Event identity</dt><dd><code>{preview.providerEvent.providerEventId}</code></dd></div>
        <div><dt>Provider revision</dt><dd><code>{preview.providerEvent.providerRevision}</code></dd></div>
      </dl><h3>Known effects</h3><ul>{preview.knownEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
      <footer><button className="ll-button" onClick={onCancel}>Cancel</button><button className="ll-button ll-danger" onClick={onConfirm}>Yes, allow this deletion</button></footer>
    </div></Dialog>;
  const { event, calendar } = preview.event;
  const recurrenceScope = preview.target.scope === "series" ? "Entire recurring series" : "This exact event";
  return <Dialog title="Allow agent to delete this Calendar event?" onClose={onCancel} wide>
    <div className="ll-delete-confirmation ll-agent-calendar-delete-confirmation">
      <Trash2 size={30} />
      <p>The connected agent is waiting. Confirm only after checking every effect below.</p>
      <dl className="ll-calendar-facts">
        <div><dt>Event</dt><dd>{preview.event.currentRevision.title}</dd></div>
        <div><dt>Calendar</dt><dd>{calendar.title}</dd></div>
        <div><dt>Source authority</dt><dd>Life Links native · owner and connected agent may write</dd></div>
        <div><dt>Date and time</dt><dd>{eventTiming(preview.event.currentRevision)}</dd></div>
        <div><dt>Recurrence scope</dt><dd>{recurrenceScope}</dd></div>
        <div><dt>Current revision</dt><dd><code>{event.currentRevisionId}</code></dd></div>
      </dl>
      {preview.event.currentRevision.recurrence && <p>{recurrenceSummary(preview.event.currentRevision.recurrence)}</p>}
      <h3>Known effects</h3>
      <ul>{preview.knownEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul>
      <footer><button className="ll-button" onClick={onCancel}>Cancel</button><button className="ll-button ll-danger" onClick={onConfirm}><Trash2 size={16} />Yes, allow this deletion</button></footer>
    </div>
  </Dialog>;
}

function CalendarEventDialog({ controller, snapshot, onClose, eventId, initialDate, providerReference }: Props & { eventId: string | null; initialDate: string | null; providerReference?: ProviderCalendarEventReference }) {
  const existing = eventId ? snapshot.calendarWorkspace.events.find((item) => item.event.id === eventId) ?? snapshot.calendarWorkspace.selectedEvent : null;
  const existingProvider = providerReference ? snapshot.calendarWorkspace.providerEvents.find((item) => item.connectionId === providerReference.connectionId && item.calendarId === providerReference.calendarId && item.providerEventId === providerReference.providerEventId) : null;
  const commandId = useRef(`calendar-provider-command-${crypto.randomUUID()}`);
  const calendars = snapshot.calendarWorkspace.calendars.filter((calendar) => !calendar.deletedAt);
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const existingCalendar = calendars.find((calendar) => calendar.id === (existing?.event.calendarId ?? existingProvider?.calendarId));
  const existingSpan = existing?.currentRevision.span ?? (existingProvider ? providerSpanForEditor(existingProvider.content.span) : undefined);
  const [calendarId, setCalendarId] = useState(existingCalendar?.id ?? defaultCalendar?.id ?? "");
  const [title, setTitle] = useState(existing?.currentRevision.title ?? existingProvider?.content.title ?? "");
  const [description, setDescription] = useState(existing?.currentRevision.description ?? existingProvider?.content.description ?? "");
  const [location, setLocation] = useState(existing?.currentRevision.location ?? existingProvider?.content.location ?? "");
  const [status, setStatus] = useState<CalendarEventStatus>(existing?.currentRevision.status ?? existingProvider?.content.status ?? "confirmed");
  const [allDay, setAllDay] = useState(existingSpan?.kind === "all_day");
  const startDateDefault = initialDate ?? snapshot.calendarWorkspace.clock?.today ?? "";
  const initialStartDate = existingSpan?.kind === "all_day" ? existingSpan.startDate : existingSpan?.kind === "zoned" ? existingSpan.startLocalDateTime.slice(0, 10) : startDateDefault;
  const initialEndDate = existingSpan?.kind === "all_day" ? previousDate(existingSpan.endDateExclusive) : existingSpan?.kind === "zoned" ? existingSpan.endLocalDateTime.slice(0, 10) : startDateDefault;
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [multiDay, setMultiDay] = useState(initialEndDate > initialStartDate);
  const [startTime, setStartTime] = useState(existingSpan?.kind === "zoned" ? existingSpan.startLocalDateTime.slice(11, 16) : "09:00");
  const [endTime, setEndTime] = useState(existingSpan?.kind === "zoned" ? existingSpan.endLocalDateTime.slice(11, 16) : "10:00");
  const [timeZone, setTimeZone] = useState(existingSpan?.kind === "zoned" ? existingSpan.timeZone : existingCalendar?.timeZone ?? defaultCalendar?.timeZone ?? resolvedTimeZone());
  const existingRecurrence = existing?.currentRevision.recurrence;
  const [recurrenceEdited, setRecurrenceEdited] = useState(false);
  const [frequency, setFrequency] = useState<"none" | CalendarRecurrenceRule["frequency"]>(existingRecurrence?.frequency ?? "none");
  const [interval, setInterval] = useState(existingRecurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<CalendarWeekday[]>(existingRecurrence?.frequency === "weekly" ? existingRecurrence.weekdays : [weekdayForDate(startDate)]);
  const [endKind, setEndKind] = useState<CalendarRecurrenceEnd["kind"]>(existingRecurrence?.end.kind ?? "never");
  const [untilDate, setUntilDate] = useState(existingRecurrence?.end.kind === "until" ? existingRecurrence.end.untilDate : endDate);
  const [count, setCount] = useState(existingRecurrence?.end.kind === "count" ? existingRecurrence.end.count : 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const calendar = calendars.find((candidate) => candidate.id === calendarId);
    if (!existing && !existingProvider && calendar) setTimeZone(calendar.timeZone);
    if (calendar?.source === "external") setFrequency("none");
  }, [calendarId]);

  const selectedCalendar = calendars.find((candidate) => candidate.id === calendarId);
  const providerBinding = snapshot.calendarWorkspace.providerBindings?.find((entry) => entry.calendarId === calendarId);
  const providerMode = selectedCalendar?.source === "external";

  const recurrence = useMemo(() => existing && !recurrenceEdited ? existingRecurrence ?? null
    : buildRecurrence({ frequency, interval, weekdays, startDate, endKind, untilDate, count }),
  [count, endKind, existingRecurrence, frequency, interval, recurrenceEdited, startDate, untilDate, weekdays]);
  async function submit() {
    setSaving(true); setError("");
    try {
      if (providerReference && !existingProvider) throw new Error("The exact provider event is no longer available. Reopen it before editing.");
      if (!calendarId) throw new Error("Choose a Calendar.");
      if (!title.trim()) throw new Error("Add an event title.");
      if (!startDate || (multiDay && !endDate)) throw new Error("Choose the event date.");
      if (multiDay && endDate <= startDate) throw new Error("A multi-day event must end after its start date.");
      const lastDate = multiDay ? endDate : startDate;
      const span = allDay
        ? { kind: "all_day" as const, startDate, endDateExclusive: nextDate(lastDate) }
        : { kind: "zoned" as const, startLocalDateTime: `${startDate}T${startTime}`, endLocalDateTime: `${lastDate}T${endTime}`, timeZone };
      const unchangedProviderTiming = existingProvider && existingSpan && (span.kind === "all_day" && existingSpan.kind === "all_day"
        ? span.startDate === existingSpan.startDate && span.endDateExclusive === existingSpan.endDateExclusive
        : span.kind === "zoned" && existingSpan.kind === "zoned" && span.startLocalDateTime === existingSpan.startLocalDateTime && span.endLocalDateTime === existingSpan.endLocalDateTime && span.timeZone === existingSpan.timeZone);
      // Provider instants retain seconds and their exact DST-fold identity when the displayed timing is unchanged.
      if (!unchangedProviderTiming) normalizeCalendarEventSpan(span);
      if (providerMode) {
        if (!providerBinding || !(existingProvider ? providerBinding.capabilities.update : providerBinding.capabilities.create)) throw new Error("This provider Calendar does not allow this change.");
        if (existingProvider && !providerEventCanMutate(existingProvider)) throw new Error("Recurring, invitation, online meeting, or floating provider events cannot be changed here.");
        const content = { title: title.trim(), description: description.trim(), location: location.trim(), status,
          span: unchangedProviderTiming ? existingProvider!.content.span : providerWritableSpan(span) };
        const input = { authority: "provider" as const, commandId: commandId.current, connectionId: providerBinding.connectionId, calendarId, content };
        if (existingProvider) await controller.updateExternalCalendarEvent(existingProvider.providerEventId, { ...input, expectedProviderRevision: existingProvider.providerRevision, scope: "event" });
        else await controller.createExternalCalendarEvent(input);
      } else if (existing) {
        const target: CalendarEventEditTargetInput = existing.event.lineage.kind === "recurrence_master"
          ? { scope: "series", masterEventId: existing.event.id }
          : { scope: "event", eventId: existing.event.id };
        await controller.updateNativeCalendarEvent(existing.event.id, {
          expectedCurrentRevisionId: existing.event.currentRevisionId,
          title: title.trim(), description: description.trim(), location: location.trim(), status,
          span, recurrence, subjectLinks: existing.currentRevision.subjectLinks, target
        });
      } else {
        await controller.createNativeCalendarEvent({
          calendarId,
          lineage: recurrence ? { kind: "recurrence_master" } : { kind: "standalone" },
          title: title.trim(), description: description.trim(), location: location.trim(), status,
          span, recurrence, subjectLinks: []
        });
      }
      onClose();
    } catch (issue) {
      setError(messageFromIssue(issue, "The Calendar event could not be saved."));
    } finally { setSaving(false); }
  }

  return <Dialog title={existingProvider ? "Edit provider event" : existing ? (existing.event.lineage.kind === "recurrence_master" ? "Edit Calendar series" : "Edit Calendar event") : "New Calendar event"} onClose={onClose} wide>
    <form className="ll-form ll-calendar-event-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="ll-calendar-form-grid"><label>Calendar<select required disabled={Boolean(existing || existingProvider)} value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>{calendars.map((calendar) => <option value={calendar.id} key={calendar.id} disabled={calendar.source === "external" && !snapshot.calendarWorkspace.providerBindings?.some((entry) => entry.calendarId === calendar.id && (existingProvider ? entry.capabilities.update : entry.capabilities.create))}>{calendar.title}{calendar.isDefault ? " (default)" : ""}{calendar.source === "external" ? " · Provider" : ""}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as CalendarEventStatus)}><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="canceled">Canceled</option></select></label></div>
      <label>Title<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Description<textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Location<input maxLength={500} value={location} onChange={(event) => setLocation(event.target.value)} /></label>
      <div className="ll-calendar-event-options">
        <label className="ll-checkbox-label"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />All-day event</label>
        <label className="ll-checkbox-label"><input type="checkbox" checked={multiDay} onChange={(event) => {
          setMultiDay(event.target.checked);
          setEndDate(event.target.checked && startDate ? (endDate > startDate ? endDate : nextDate(startDate)) : startDate);
        }} />Multi-day event</label>
      </div>
      <div className="ll-calendar-form-grid"><label>{multiDay ? "Start date" : "Date"}<input type="date" required value={startDate} onChange={(event) => {
        const date = event.target.value;
        setStartDate(date);
        if (!multiDay) setEndDate(date);
        else if (date && endDate <= date) setEndDate(nextDate(date));
      }} /></label>{!allDay && <label>Start time<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}
        {multiDay && <label>End date<input type="date" required min={startDate ? nextDate(startDate) : undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>}{!allDay && <label>End time<input type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>}</div>
      {!allDay && <label>Event time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>}
      <fieldset className="ll-calendar-recurrence" disabled={providerMode} onChange={() => setRecurrenceEdited(true)}><legend>Repeats</legend><div className="ll-calendar-form-grid"><label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="none" disabled={existing?.event.lineage.kind === "recurrence_master"}>Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{frequency !== "none" && <label>Every<input type="number" min={1} max={366} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>}</div>
        {frequency === "weekly" && <div className="ll-calendar-weekday-picker" aria-label="Repeat on">{WEEKDAYS.map((day) => <label key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => setWeekdays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day])} />{capitalize(day.slice(0, 3))}</label>)}</div>}
        {frequency !== "none" && <div className="ll-calendar-form-grid"><label>Ends<select value={endKind} onChange={(event) => setEndKind(event.target.value as CalendarRecurrenceEnd["kind"])}><option value="never">Never</option><option value="until">On a date</option><option value="count">After a count</option></select></label>{endKind === "until" && <label>Last date<input type="date" min={startDate} value={untilDate} onChange={(event) => setUntilDate(event.target.value)} /></label>}{endKind === "count" && <label>Occurrences<input type="number" min={1} max={10000} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>}</div>}
        {recurrence && <p className="ll-muted">{recurrenceSummary(recurrence)}</p>}
      </fieldset>
      {existing?.event.lineage.kind === "recurrence_master" && <p className="ll-inline-note">This changes the whole series. Per-occurrence and this-and-future splitting remain unavailable until their API behavior is complete.</p>}
      {providerMode && <p className="ll-inline-note">This saves to the original provider calendar. Only a standalone event without attendees or an online meeting can be created or changed here. Invitations and conferencing are not sent.</p>}
      {(error || snapshot.calendarWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.calendarWorkspace.error}</p>}
      <footer><button type="button" className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving || !title.trim() || !calendarId}><Check size={16} />{saving ? "Saving…" : "Save event"}</button></footer>
    </form>
  </Dialog>;
}

function providerEventTiming(span: import("@life-links/core").ProviderEventSpan) {
  return span.kind === "all_day" ? `${span.startDate} through ${previousDate(span.endDateExclusive)} · all day`
    : `${span.startUtc} – ${span.endUtc} · ${span.sourceTimeZone ?? "UTC"}`;
}

function DeleteProviderEventDialog({ controller, snapshot, onClose, reference }: Props & { reference: ProviderCalendarEventReference }) {
  const event = snapshot.calendarWorkspace.providerEvents.find((entry) => entry.connectionId === reference.connectionId && entry.calendarId === reference.calendarId && entry.providerEventId === reference.providerEventId);
  const calendar = snapshot.calendarWorkspace.calendars.find((entry) => entry.id === reference.calendarId);
  const binding = snapshot.calendarWorkspace.providerBindings.find((entry) => entry.calendarId === reference.calendarId && entry.connectionId === reference.connectionId);
  const commandId = useRef(`calendar-provider-delete-${crypto.randomUUID()}`);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  if (!event || !binding?.capabilities.delete || !providerEventCanMutate(event)) return <Dialog title="Delete provider event" onClose={onClose}><p>This exact provider event cannot be deleted here.</p></Dialog>;
  async function remove() {
    setDeleting(true); setError("");
    try {
      await controller.deleteExternalCalendarEvent(reference.providerEventId, { authority: "provider", commandId: commandId.current, connectionId: reference.connectionId, calendarId: reference.calendarId, expectedProviderRevision: event!.providerRevision, scope: "event" });
      onClose();
    } catch (issue) { setError(messageFromIssue(issue, "The provider event could not be deleted.")); }
    finally { setDeleting(false); }
  }
  return <Dialog title="Delete the original provider event?" onClose={onClose} wide><div className="ll-delete-confirmation"><Trash2 size={28} />
    <h3>{event.content.title}</h3><p>{calendar?.title ?? event.calendarId} · {event.providerAccountId} · {event.providerKey}</p>
    <p>{providerEventTiming(event.content.span)}</p><p>Scope: this exact standalone event.</p>
    <dl className="ll-calendar-facts"><div><dt>Event identity</dt><dd><code>{event.providerEventId}</code></dd></div><div><dt>Provider revision</dt><dd><code>{event.providerRevision}</code></dd></div></dl>
    <p>This deletes the original provider event, not just its Life Links display. Life Links cannot restore it. No invitations or conferencing changes will be sent.</p>
    {error && <p className="ll-inline-warning" role="alert">{error}</p>}<footer><button className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-danger" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Yes, delete provider event"}</button></footer>
  </div></Dialog>;
}

function DeleteEventDialog({ controller, snapshot, onClose, eventId }: Props & { eventId: string }) {
  const detail = snapshot.calendarWorkspace.events.find((item) => item.event.id === eventId) ?? snapshot.calendarWorkspace.selectedEvent;
  const calendar = snapshot.calendarWorkspace.calendars.find((item) => item.id === detail?.event.calendarId);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  if (!detail) return <Dialog title="Delete Calendar event" onClose={onClose}><p>This event is no longer available.</p></Dialog>;
  const target: CalendarEventEditTargetInput = detail.event.lineage.kind === "recurrence_master"
    ? { scope: "series", masterEventId: detail.event.id }
    : { scope: "event", eventId: detail.event.id };
  async function remove() {
    setDeleting(true); setError("");
    try {
      await controller.deleteNativeCalendarEvent(detail!.event.id, { expectedCurrentRevisionId: detail!.event.currentRevisionId, target });
      onClose();
    } catch (issue) { setError(messageFromIssue(issue, "The event could not be deleted.")); }
    finally { setDeleting(false); }
  }
  return <Dialog title={detail.event.lineage.kind === "recurrence_master" ? "Delete Calendar series?" : "Delete Calendar event?"} onClose={onClose}>
    <div className="ll-delete-confirmation"><Trash2 size={28} /><h3>{detail.currentRevision.title}</h3><p><strong>{calendar?.title ?? detail.event.calendarId}</strong> · Life Links native write authority</p><p>{eventTiming(detail.currentRevision)}</p>{detail.event.lineage.kind === "recurrence_master" && <p>{recurrenceSummary(detail.currentRevision.recurrence)}</p>}<p>This is a soft delete. The exact last revision can be restored from Details.</p>{error && <p className="ll-inline-warning" role="alert">{error}</p>}<footer><button className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-danger" disabled={deleting} onClick={() => void remove()}><Trash2 size={16} />{deleting ? "Deleting…" : "Yes, delete"}</button></footer></div>
  </Dialog>;
}

function ManageCalendarsDialog({ controller, snapshot, onClose }: Props) {
  const calendars = snapshot.calendarWorkspace.calendars.filter((calendar) => !calendar.deletedAt && calendar.source === "native");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editing = calendars.find((calendar) => calendar.id === editingId);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#7FC9B3");
  const [timeZone, setTimeZone] = useState(resolvedTimeZone());
  const [isDefault, setIsDefault] = useState(false);
  const [agentAccess, setAgentAccess] = useState<CalendarAgentAccess>("write");
  const [saving, setSaving] = useState(false);
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setTitle(editing?.title ?? ""); setColor(editing?.color ?? "#7FC9B3"); setTimeZone(editing?.timeZone ?? resolvedTimeZone()); setIsDefault(editing?.isDefault ?? false); setAgentAccess(editing?.agentAccess ?? "write");
  }, [editingId, editing?.updatedAt]);
  async function save() {
    setSaving(true); setError("");
    try {
      if (!title.trim()) throw new Error("Add a Calendar name.");
      if (editingId && !editing) throw new Error("This Calendar is no longer available. Cancel and reopen it.");
      if (editing) await controller.updateNativeCalendar(editing.id, editing.updatedAt, { title: title.trim(), color, timeZone, isDefault, agentAccess });
      else await controller.createNativeCalendar({ title: title.trim(), color, timeZone, isDefault, agentAccess });
      setEditorOpen(false); setEditingId(null); setTitle(""); setIsDefault(false); setAgentAccess("write");
    } catch (issue) { setError(messageFromIssue(issue, "The Calendar could not be saved.")); }
    finally { setSaving(false); }
  }
  return <Dialog title="Manage calendars" onClose={onClose} wide closeDisabled={saving || connectionSaving}><div className={`ll-calendar-manager${editorOpen ? " ll-calendar-manager-editing" : ""}`}>
    <section><h3>Your Life Links calendars</h3><div className="ll-calendar-manager-list">{calendars.map((calendar) => <button key={calendar.id} disabled={saving} onClick={() => { setEditingId(calendar.id); setEditorOpen(true); setError(""); }} className={editorOpen && editingId === calendar.id ? "selected" : ""}><span className="ll-calendar-color" style={{ background: calendar.color }} /><span><strong>{calendar.title}</strong><small>{calendar.timeZone}{calendar.isDefault ? " · Default" : ""}</small><small>Agent: {agentAccessLabel(calendar.agentAccess)}</small></span><Pencil size={15} /></button>)}</div><button className="ll-text-button" disabled={saving} onClick={() => { setEditorOpen(true); setEditingId(null); setTitle(""); setColor("#7FC9B3"); setTimeZone(resolvedTimeZone()); setIsDefault(false); setAgentAccess("write"); setError(""); }}><Plus size={15} />New Calendar</button></section>
    {editorOpen && <form className="ll-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><h3>{editing ? `Edit ${editing.title}` : "New Calendar"}</h3><label>Name<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label>Default time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><label className="ll-checkbox-label"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />Use as my default Calendar</label><CalendarAgentAccessSelect value={agentAccess} onChange={setAgentAccess} disabled={saving} /><p className="ll-calendar-access-help">Showing or hiding a Calendar does not change agent access. Your agent must also be connected with Calendar tools enabled (the Calendar-v2 grant). Deleting events still requires your confirmation.</p>{error && <p className="ll-inline-warning" role="alert">{error}</p>}<footer><button type="button" className="ll-button" disabled={saving} onClick={() => { setEditorOpen(false); setEditingId(null); setError(""); }}>Cancel editor</button><button className="ll-button ll-primary" disabled={saving || !title.trim()}><Check size={16} />{saving ? "Saving…" : editing ? "Save Calendar" : "Create Calendar"}</button></footer></form>}
    <CalendarConnectionsSection key={snapshot.currentUser?.id ?? "signed-out"} controller={controller} management={snapshot.calendarWorkspace.connectionManagement} flow={snapshot.calendarWorkspace.connectionFlow} onSavingChange={setConnectionSaving} />
  </div></Dialog>;
}

function CalendarConnectionSelectionDialog({ controller, snapshot, onClose }: Props) {
  const flow = snapshot.calendarWorkspace.connectionFlow;
  const management = snapshot.calendarWorkspace.connectionManagement;
  const lifetime = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState<"connect" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const existing = flow?.connectionId ? management.calendars.filter((entry) => entry.connectionId === flow.connectionId) : [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [accessById, setAccessById] = useState<Record<string, CalendarAgentAccess>>({});
  const connection = management.connections.find((entry) => entry.connectionId === flow?.connectionId);
  const provider = calendarAuthorizationProvider(flow?.discovery?.providerKey ?? connection?.providerKey ?? "");
  const providerName = provider === "google" ? "Google Calendar" : provider === "microsoft" ? "Outlook" : null;
  const title = flow?.connectionId ? "Choose calendars" : providerName ? `Finish connecting ${providerName}` : "Finish connecting your calendar";

  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    if ((flow?.authorizationId || flow?.connectionId) && !flow.discovery && !flow.loading && !flow.error) {
      void controller.loadCalendarConnectionDiscovery(flow.connectionId ?? undefined, abort.signal).catch(() => undefined);
    }
    return () => { abort.abort(); lifetime.current = null; };
  }, [controller]);

  useEffect(() => {
    setSelectedIds([]);
    setAccessById({});
  }, [flow?.discovery]);

  function accessFor(calendar: NonNullable<typeof flow.discovery>["calendars"][number]): CalendarAgentAccess {
    const linked = existing.find((entry) => entry.providerCalendarId === calendar.providerCalendarId);
    if (linked) return linked.calendar.agentAccess;
    const chosen = accessById[calendar.providerCalendarId] ?? "none";
    if (!calendar.capabilities.read) return "none";
    return chosen === "write" && !canProviderCalendarWrite(calendar.capabilities) ? "read" : chosen;
  }

  async function cancel() {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending("cancel"); setError("");
    try {
      await controller.cancelCalendarConnectionSelection(lifetime.current?.signal);
      onClose();
    } catch (issue) { setError(messageFromIssue(issue, "Calendar selection could not be canceled. Please try again.")); }
    finally { pendingRef.current = false; setPending(null); }
  }

  async function connect() {
    if (pendingRef.current || !flow?.discovery || !selectedIds.length) return;
    pendingRef.current = true; setPending("connect"); setError("");
    const choices = Object.fromEntries(flow.discovery.calendars.filter((calendar) => selectedIds.includes(calendar.providerCalendarId))
      .map((calendar) => [calendar.providerCalendarId, accessFor(calendar)]));
    try {
      await controller.completeCalendarConnectionSelection(selectedIds, lifetime.current?.signal, choices);
      onClose();
    } catch (issue) { setError(messageFromIssue(issue, "The selected calendars could not be connected. Please try again.")); }
    finally { pendingRef.current = false; setPending(null); }
  }

  return <Dialog title={title} onClose={() => void cancel()} closeDisabled={Boolean(pending)}>
    <div className="ll-calendar-selection">
      {flow?.authorizationId && !flow.error && <p className="ll-calendar-selection-success" role="status"><Check size={18} aria-hidden="true" />{providerName ? `${providerName} sign-in successful.` : "Sign-in successful."}</p>}
      <p>Choose the calendars to show in Life Links and what your connected agent can do with each one.</p>
      {flow?.discovery && <CalendarAccountIdentity accountEmail={flow.discovery.accountEmail} providerAccountId={flow.discovery.providerAccountId} />}
      {flow?.loading && <p role="status">Finding your calendars…</p>}
      {(flow?.error || error) && <div className="ll-inline-warning" role="alert"><p>{error || flow?.error}</p>
        {flow?.error && (flow.authorizationId || flow.connectionId) && <button className="ll-button" disabled={Boolean(pending) || flow.loading} onClick={() => {
          setError(""); void controller.loadCalendarConnectionDiscovery(flow.connectionId ?? undefined, lifetime.current?.signal).catch(() => undefined);
        }}>Retry calendar discovery</button>}
      </div>}
      {flow?.discovery && <div className="ll-calendar-selection-list" role="group" aria-label="Choose calendars and agent access">
        {flow.discovery.calendars.map((calendar) => {
          const linked = existing.find((entry) => entry.providerCalendarId === calendar.providerCalendarId);
          const selected = selectedIds.includes(calendar.providerCalendarId);
          return <div className={`ll-calendar-selection-row${selected ? " selected" : ""}`} key={calendar.providerCalendarId}>
            <label className="ll-calendar-selection-check"><input type="checkbox" checked={selected || Boolean(linked)} disabled={Boolean(pending) || !calendar.capabilities.read || Boolean(linked)} onChange={(event) => {
              setSelectedIds((ids) => event.target.checked ? [...ids, calendar.providerCalendarId] : ids.filter((id) => id !== calendar.providerCalendarId));
            }} /><span><strong>{calendar.displayName}</strong><small>{linked ? "Already connected" : calendar.isDefault ? "Default calendar" : ""}{!calendar.capabilities.read ? " · Unavailable" : !canProviderCalendarWrite(calendar.capabilities) ? `${linked || calendar.isDefault ? " · " : ""}Read only at provider` : ""}</small></span></label>
            <CalendarAgentAccessSelect value={accessFor(calendar)} onChange={(value) => setAccessById((current) => ({ ...current, [calendar.providerCalendarId]: value }))}
              disabled={Boolean(pending) || !selected || Boolean(linked)} canRead={calendar.capabilities.read} canWrite={canProviderCalendarWrite(calendar.capabilities)}
              ariaLabel={`Agent access for ${calendar.displayName}`} writeLabel={calendar.capabilities.update ? "Read and edit" : "Read and allowed changes"} />
          </div>;
        })}
        {!flow.discovery.calendars.length && <p>No readable calendars were found in this account.</p>}
      </div>}
      {flow?.connectionId && <p className="ll-calendar-selection-note">Already-connected calendars keep their access. You can change it in Manage calendars.</p>}
      {Boolean(selectedIds.length) && <p className="ll-calendar-selection-note">{selectedIds.length} selected · Shown together in your Calendar.</p>}
      <footer className="ll-dialog-footer"><button className="ll-button" disabled={Boolean(pending)} onClick={() => void cancel()}>{pending === "cancel" ? "Canceling…" : "Cancel"}</button>
        <button className="ll-button ll-primary" disabled={Boolean(pending) || Boolean(flow?.loading) || !flow?.discovery || !selectedIds.length} onClick={() => void connect()}>{pending === "connect" ? "Connecting…" : "Connect calendars"}</button></footer>
    </div>
  </Dialog>;
}

function CalendarConnectionsSection({ controller, management, flow, onSavingChange }: {
  controller: LifeLinksWorkspaceController;
  management: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"];
  flow?: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionFlow"];
  onSavingChange(saving: boolean): void;
}) {
  const lifetime = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    void controller.loadCalendarConnections(abort.signal).catch(() => undefined);
    return () => { abort.abort(); lifetime.current = null; };
  }, [controller]);
  useEffect(() => { onSavingChange(Boolean(pending)); return () => onSavingChange(false); }, [pending, onSavingChange]);

  async function connect(provider: "microsoft" | "google", reconnectConnectionId?: string) {
    const abort = lifetime.current;
    if (!abort || abort.signal.aborted) return;
    setPending(reconnectConnectionId ?? provider); setError("");
    try {
      const authorizationUrl = provider === "microsoft"
        ? await controller.beginMicrosoftCalendarAuthorization(reconnectConnectionId, abort.signal)
        : await controller.beginGoogleCalendarAuthorization(reconnectConnectionId, abort.signal);
      if (!abort.signal.aborted) window.location.assign(authorizationUrl);
    } catch (issue) { if (!abort.signal.aborted) setError(messageFromIssue(issue, `${provider === "microsoft" ? "Outlook" : "Google"} sign-in could not be started.`)); }
    finally { if (!abort.signal.aborted) setPending(null); }
  }

  async function refresh(connectionId: string) {
    setPending(connectionId); setError("");
    try { await controller.refreshConnectedCalendarAccount(connectionId, lifetime.current?.signal); }
    catch (issue) { setError(messageFromIssue(issue, "The provider could not refresh this account.")); }
    finally { setPending(null); }
  }

  async function disconnect(connection: CalendarConnectionView) {
    setPending(connection.connectionId); setError("");
    try {
      await controller.disconnectCalendarConnection(connection.connectionId, "purge", lifetime.current?.signal);
      setDisconnectId(null);
    } catch (issue) { setError(messageFromIssue(issue, "The connection could not be disconnected. Refresh its status before trying again.")); }
    finally { setPending(null); }
  }

  return <section className="ll-calendar-connections">
    <h3>External calendars</h3>
    <p>Connect an account, then choose its exact calendars. Provider sign-in does not grant the agent access to those calendars.</p>
    {!management.providers.some((provider) => provider.authorizationAvailable) && <p>New account connections are not available yet.</p>}
    {management.providers.map((provider) => {
      const authorizationProvider = calendarAuthorizationProvider(provider.providerKey);
      const available = authorizationProvider !== null && provider.authorizationAvailable;
      return <button className="ll-button" key={provider.providerKey} disabled={Boolean(pending) || !available} title={available ? `Continue to ${authorizationProvider === "microsoft" ? "Microsoft" : "Google"} sign-in` : "Account authorization is not available yet"} onClick={() => { if (authorizationProvider) void connect(authorizationProvider); }}><Cloud size={16} />Connect {provider.displayName}</button>;
    })}
    {flow?.feedback && <p role="status">{flow.feedback}</p>}
    {management.loading && <p role="status">Loading Calendar connections…</p>}
    {(management.error || error) && <div className="ll-inline-warning" role="alert"><p>{error || management.error}</p><button className="ll-button" disabled={management.loading || Boolean(pending)} onClick={() => { setError(""); void controller.loadCalendarConnections(lifetime.current?.signal).catch(() => undefined); }}>Retry loading connections</button></div>}
    {management.loaded && !management.error && !management.connections.length && <p>No external accounts are connected.</p>}
    <div className="ll-calendar-connection-list">{management.connections.map((connection) => {
      const authorizationProvider = calendarAuthorizationProvider(connection.providerKey);
      const provider = management.providers.find((entry) => authorizationProvider ? calendarAuthorizationProvider(entry.providerKey) === authorizationProvider : entry.providerKey === connection.providerKey);
      const providerName = provider?.displayName ?? (authorizationProvider === "microsoft" ? "Microsoft Outlook" : authorizationProvider === "google" ? "Google Calendar" : connection.providerKey);
      const calendars = management.calendars.filter((view) => view.connectionId === connection.connectionId && !view.calendar.deletedAt);
      const active = connection.status === "active";
      const canAuthorize = authorizationProvider !== null && provider?.authorizationAvailable === true;
      const reconnectLabel = authorizationProvider === "google" ? "Reconnect Google Calendar" : "Reconnect Outlook";
      return <article className="ll-calendar-connection" key={`${connection.ownerId}:${connection.connectionId}:${connection.connectedAt}`}>
        <header><div><h4>{providerName}</h4><CalendarAccountIdentity accountEmail={connection.accountEmail} providerAccountId={connection.providerAccountId} /></div><span className="ll-chip">{connection.status === "active" ? "Connected" : connection.status === "provisioning" ? "Connecting" : "Disconnected"}</span></header>
        {connection.status === "disconnected" ? <><p>{revocationStatusText(connection)}</p>{canAuthorize && <button className="ll-button" disabled={Boolean(pending)} onClick={() => { if (authorizationProvider) void connect(authorizationProvider, connection.connectionId); }}>{reconnectLabel}</button>}</> : <>
          {connection.credentialStatus === "reconnect_required" && <p className="ll-inline-warning" role="status">This account needs to reconnect before Life Links can read or change its provider events.</p>}
          <ConnectedCalendarSettings controller={controller} connection={connection} calendars={calendars} disabled={!active || Boolean(pending)}
            onSavingChange={(value) => setPending(value ? `${connection.connectionId}:settings` : null)} />
          {authorizationProvider && active ? <div><button className="ll-button" disabled={Boolean(pending) || flow?.loading} onClick={() => void controller.loadCalendarConnectionDiscovery(connection.connectionId).catch(() => undefined)}>Add calendars from this account</button><button className="ll-button" disabled={Boolean(pending)} onClick={() => void refresh(connection.connectionId)}>Refresh events</button>{canAuthorize && <button className="ll-button" disabled={Boolean(pending)} onClick={() => void connect(authorizationProvider, connection.connectionId)}>{reconnectLabel}</button>}</div> : <p>Finding additional calendars for this account is not available yet.</p>}
          {disconnectId === connection.connectionId ? <div className="ll-calendar-disconnect-confirmation" role="group" aria-label={`Confirm disconnect ${providerName}`}>
            <strong>Disconnect {providerName}?</strong><p>Life Links will stop using this account and remove its cached events from this view. Your original calendars and events at {providerName} will not be deleted. Provider access revocation may remain pending or fail; its status will be shown separately.</p>
            <button className="ll-button" disabled={Boolean(pending)} onClick={() => setDisconnectId(null)}>Cancel</button><button className="ll-button ll-danger" disabled={Boolean(pending)} onClick={() => void disconnect(connection)}>{pending === connection.connectionId ? "Disconnecting…" : "Yes, disconnect"}</button>
          </div> : <button className="ll-button" disabled={Boolean(pending)} onClick={() => setDisconnectId(connection.connectionId)}>Disconnect account</button>}
        </>}
      </article>;
    })}</div>
  </section>;
}

function CalendarAccountIdentity({ accountEmail, providerAccountId }: { accountEmail?: string; providerAccountId: string }) {
  return <><p className="ll-calendar-account-identity"><strong>{accountEmail?.trim() || "Account email unavailable"}</strong></p>
    <details className="ll-calendar-selection-account"><summary>Account details</summary><small>Provider account ID: {providerAccountId}</small></details></>;
}

type ConnectedCalendarSettingsValue = { visible: boolean; agentAccess: CalendarAgentAccess };
type ConnectedCalendarSettingsDraft = ConnectedCalendarSettingsValue & {
  expectedUpdatedAt: string;
  original: ConnectedCalendarSettingsValue;
};

function ConnectedCalendarSettings({ controller, connection, calendars, disabled, onSavingChange }: {
  controller: LifeLinksWorkspaceController;
  connection: CalendarConnectionView;
  calendars: CalendarConnectedCalendarView[];
  disabled: boolean;
  onSavingChange(saving: boolean): void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ConnectedCalendarSettingsDraft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const pending = useRef(false);
  const needsReadback = useRef(false);
  const savingChanged = useRef(onSavingChange);
  savingChanged.current = onSavingChange;
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    return () => {
      abort.abort(); lifetime.current = null;
      if (pending.current) { pending.current = false; savingChanged.current(false); }
    };
  }, [controller]);

  function edit(view: CalendarConnectedCalendarView, patch: Partial<ConnectedCalendarSettingsValue>) {
    setError(""); setFeedback("");
    setDrafts((current) => {
      const original = { visible: view.visible, agentAccess: view.calendar.agentAccess };
      const draft = { ...(current[view.calendar.id] ?? { ...original, original, expectedUpdatedAt: view.calendar.updatedAt }), ...patch };
      const next = { ...current };
      if (draft.visible === draft.original.visible && draft.agentAccess === draft.original.agentAccess) delete next[view.calendar.id];
      else next[view.calendar.id] = draft;
      return next;
    });
  }

  async function save() {
    const abort = lifetime.current;
    if (pending.current || !abort || abort.signal.aborted || !Object.keys(drafts).length) return;
    pending.current = true; setSaving(true); onSavingChange(true); setError(""); setFeedback("");
    let confirmed = 0;
    try {
      // A failed transport can have applied the PATCH. Read before retrying;
      // never replace a draft's captured revision with a newer one silently.
      if (needsReadback.current) await controller.loadCalendarConnections(abort.signal);
      for (const [calendarId, draft] of Object.entries(drafts)) {
        abort.signal.throwIfAborted();
        const current = controller.getSnapshot().calendarWorkspace.connectionManagement;
        const account = current.connections.find((entry) => entry.connectionId === connection.connectionId && entry.ownerId === connection.ownerId);
        const view = current.calendars.find((entry) => entry.connectionId === connection.connectionId && entry.calendar.id === calendarId && entry.calendar.ownerId === connection.ownerId && !entry.calendar.deletedAt);
        if (!current.loaded || current.loading || account?.status !== "active" || !view) throw new Error("This account or calendar is no longer available. Cancel and review its current settings.");
        if (view.visible !== draft.visible || view.calendar.agentAccess !== draft.agentAccess) {
          if (view.calendar.updatedAt !== draft.expectedUpdatedAt) throw new Error("These settings changed elsewhere. Cancel and review the current settings before editing again.");
          const visibilityChanged = draft.visible !== view.visible;
          const accessChanged = draft.agentAccess !== view.calendar.agentAccess;
          if ((visibilityChanged && draft.visible && !view.capabilities.read) || (accessChanged && draft.agentAccess !== "none" && !view.capabilities.read)
            || (accessChanged && draft.agentAccess === "write" && !canProviderCalendarWrite(view.capabilities))) throw new Error("The provider no longer allows these settings. Cancel and review its current access.");
          const saved = await controller.updateConnectedCalendar(connection.connectionId, calendarId, draft.expectedUpdatedAt,
            { ...(visibilityChanged ? { visible: draft.visible } : {}), ...(accessChanged ? { agentAccess: draft.agentAccess } : {}) }, abort.signal);
          abort.signal.throwIfAborted();
          if (saved.visible !== draft.visible || saved.calendar.agentAccess !== draft.agentAccess) throw new Error("The returned settings did not confirm this change. Please review the current settings.");
        }
        confirmed += 1;
        setDrafts((currentDrafts) => {
          const next = { ...currentDrafts }; if (next[calendarId] === draft) delete next[calendarId]; return next;
        });
      }
      needsReadback.current = false;
      setFeedback("Calendar settings updated.");
    } catch (issue) {
      if (!abort.signal.aborted) {
        needsReadback.current = true;
        setError(`${confirmed ? `${confirmed} calendar${confirmed === 1 ? "" : "s"} confirmed. ` : ""}Remaining changes were not confirmed. ${messageFromIssue(issue, "Try Update to check the latest settings, or Cancel to discard your draft.")}`);
      }
    } finally {
      pending.current = false;
      if (!abort.signal.aborted) { setSaving(false); onSavingChange(false); }
    }
  }

  async function cancel() {
    const abort = lifetime.current;
    if (pending.current || !abort || abort.signal.aborted) return;
    setDrafts({}); setError(""); setFeedback("");
    if (!needsReadback.current) return;
    pending.current = true; setSaving(true); onSavingChange(true);
    try { await controller.loadCalendarConnections(abort.signal); needsReadback.current = false; }
    catch { if (!abort.signal.aborted) setError("Drafts discarded, but current settings could not be refreshed. Reopen Manage calendars to try again."); }
    finally { pending.current = false; if (!abort.signal.aborted) { setSaving(false); onSavingChange(false); } }
  }

  return <div className="ll-connected-calendar-settings">
    <p>Select which already-linked calendars appear in your Calendar view, then choose Update to save. Visibility does not change agent access.</p>
    {!calendars.length && <p>No calendars have been selected for this account.</p>}
    <div className="ll-connected-calendar-list">{calendars.map((view) => {
      const value = drafts[view.calendar.id] ?? { visible: view.visible, agentAccess: view.calendar.agentAccess };
      const name = view.providerDisplayName || view.calendar.title;
      return <div className="ll-connected-calendar" key={view.calendar.id}>
        <div><label className="ll-checkbox-label"><input type="checkbox" checked={value.visible} disabled={disabled || saving || (!value.visible && !view.capabilities.read)} onChange={(event) => edit(view, { visible: event.target.checked })} />{name}</label><small>{view.calendar.timeZone} · {providerCapabilityText(view)}</small></div>
        <CalendarAgentAccessSelect value={value.agentAccess} canRead={view.capabilities.read} canWrite={canProviderCalendarWrite(view.capabilities)} disabled={disabled || saving}
          ariaLabel={`Agent access for ${name}`} writeLabel={view.capabilities.update ? "Read and edit" : "Read and allowed changes"} onChange={(agentAccess) => edit(view, { agentAccess })} />
      </div>;
    })}</div>
    <p>An agent also needs the connected Calendar-v2 grant, and can never exceed the provider's permissions.</p>
    {saving && <p role="status">Saving Calendar settings…</p>}
    {error && <p className="ll-inline-warning" role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {Object.keys(drafts).length > 0 && <footer className="ll-calendar-settings-actions"><button className="ll-button ll-primary" disabled={disabled || saving} onClick={() => void save()}>{saving ? "Updating…" : "Update"}</button><button className="ll-button" disabled={disabled || saving} onClick={() => void cancel()}>Cancel</button></footer>}
  </div>;
}

function CalendarAgentAccessSelect({ value, onChange, disabled = false, canRead = true, canWrite = true, writeLabel = "Read and edit", ariaLabel }: {
  value: CalendarAgentAccess;
  onChange(value: CalendarAgentAccess): void;
  disabled?: boolean;
  canRead?: boolean;
  canWrite?: boolean;
  writeLabel?: string;
  ariaLabel?: string;
}) {
  return <label>Agent access<select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as CalendarAgentAccess)}><option value="none">No access</option><option value="read" disabled={!canRead}>Read only</option><option value="write" disabled={!canRead || !canWrite}>{writeLabel}</option></select></label>;
}

function canProviderCalendarWrite(capabilities: { create: boolean; update: boolean; delete: boolean }): boolean {
  return capabilities.create || capabilities.update || capabilities.delete;
}

function agentAccessLabel(value: CalendarAgentAccess): string {
  return value === "none" ? "No access" : value === "read" ? "Read only" : "Read and edit";
}

function providerCapabilityText(view: CalendarConnectedCalendarView): string {
  if (!view.capabilities.read) return "Provider access unavailable";
  const actions = [view.capabilities.create && "create", view.capabilities.update && "edit", view.capabilities.delete && "delete"].filter(Boolean);
  return actions.length ? `Provider allows reading and: ${actions.join(", ")}` : "Provider is read only";
}

function revocationStatusText(connection: CalendarConnectionView): string {
  if (calendarAuthorizationProvider(connection.providerKey) === "google" && connection.remoteRevocationStatus === "succeeded") return "Life Links access is off and its saved credentials were removed. Google account consent may remain; you can review it in Google. Original provider events were not deleted.";
  if ((connection.providerKey === "microsoft" || connection.providerKey === "microsoft-graph-calendar") && connection.remoteRevocationStatus === "succeeded") return "Life Links access is off and its saved credentials were removed. Microsoft account consent may remain; you can review it in Microsoft. Original provider events were not deleted.";
  if (connection.remoteRevocationStatus === "succeeded") return "Life Links access is off and provider access was revoked. Original provider events were not deleted.";
  if (connection.remoteRevocationStatus === "pending") return "Life Links access is off. Provider access revocation is still pending; your original provider events were not deleted.";
  if (connection.remoteRevocationStatus === "failed") return "Life Links access is off, but provider access revocation failed. Review this app's access in your provider account. Original provider events were not deleted.";
  return "Life Links access is off. No remote revocation was required; original provider events were not deleted.";
}

function calendarAuthorizationProvider(providerKey: string): "microsoft" | "google" | null {
  if (providerKey === "microsoft" || providerKey === "microsoft-graph-calendar") return "microsoft";
  if (providerKey === "google" || providerKey === "google-calendar") return "google";
  return null;
}

function buildRecurrence(input: { frequency: "none" | CalendarRecurrenceRule["frequency"]; interval: number; weekdays: CalendarWeekday[]; startDate: string; endKind: CalendarRecurrenceEnd["kind"]; untilDate: string; count: number }): CalendarRecurrenceRule | null {
  if (input.frequency === "none") return null;
  const interval = Math.max(1, Math.min(366, Math.trunc(input.interval)));
  const end: CalendarRecurrenceEnd = input.endKind === "until" ? { kind: "until", untilDate: input.untilDate } : input.endKind === "count" ? { kind: "count", count: Math.max(1, Math.min(10000, Math.trunc(input.count))) } : { kind: "never" };
  if (input.frequency === "daily") return { frequency: "daily", interval, end };
  if (input.frequency === "weekly") return { frequency: "weekly", interval, weekdays: input.weekdays.length ? input.weekdays : [weekdayForDate(input.startDate)], end };
  const date = new Date(`${input.startDate}T12:00:00Z`);
  if (input.frequency === "monthly") return { frequency: "monthly", interval, monthDays: [date.getUTCDate()], end };
  return { frequency: "yearly", interval, months: [date.getUTCMonth() + 1], monthDays: [date.getUTCDate()], end };
}

const WEEKDAYS: CalendarWeekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function weekdayForDate(date: string): CalendarWeekday { return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]; }
function nextDate(value: string): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function previousDate(value: string): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }
function eventTiming(revision: NonNullable<LifeLinksWorkspaceSnapshot["calendarWorkspace"]["selectedEvent"]>["currentRevision"]): string { return revision.span.kind === "all_day" ? `${revision.span.startDate} through ${previousDate(revision.span.endDateExclusive)} · all day` : `${revision.span.startLocalDateTime} – ${revision.span.endLocalDateTime} · ${revision.span.timeZone}`; }
function messageFromIssue(issue: unknown, fallback: string): string { return issue instanceof Error && issue.message ? issue.message : fallback; }
function capitalize(value: string): string { return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value; }
