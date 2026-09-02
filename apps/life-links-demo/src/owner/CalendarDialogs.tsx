import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Cloud, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  CalendarEventEditTargetInput,
  CalendarEventStatus,
  CalendarAgentAccess,
  CalendarConnectedCalendarPatch,
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
  | null;

type Props = {
  dialog: NonNullable<CalendarDialogState>;
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onClose(): void;
};

export function CalendarDialogHost(props: Props) {
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
  const [startDate, setStartDate] = useState(existingSpan?.kind === "all_day" ? existingSpan.startDate : existingSpan?.kind === "zoned" ? existingSpan.startLocalDateTime.slice(0, 10) : startDateDefault);
  const [endDate, setEndDate] = useState(existingSpan?.kind === "all_day" ? previousDate(existingSpan.endDateExclusive) : existingSpan?.kind === "zoned" ? existingSpan.endLocalDateTime.slice(0, 10) : startDateDefault);
  const [startTime, setStartTime] = useState(existingSpan?.kind === "zoned" ? existingSpan.startLocalDateTime.slice(11, 16) : "09:00");
  const [endTime, setEndTime] = useState(existingSpan?.kind === "zoned" ? existingSpan.endLocalDateTime.slice(11, 16) : "10:00");
  const [timeZone, setTimeZone] = useState(existingSpan?.kind === "zoned" ? existingSpan.timeZone : existingCalendar?.timeZone ?? defaultCalendar?.timeZone ?? resolvedTimeZone());
  const existingRecurrence = existing?.currentRevision.recurrence;
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

  const recurrence = useMemo(() => buildRecurrence({ frequency, interval, weekdays, startDate, endKind, untilDate, count }), [count, endKind, frequency, interval, startDate, untilDate, weekdays]);
  async function submit() {
    setSaving(true); setError("");
    try {
      if (providerReference && !existingProvider) throw new Error("The exact provider event is no longer available. Reopen it before editing.");
      if (!calendarId) throw new Error("Choose a Calendar.");
      if (!title.trim()) throw new Error("Add an event title.");
      if (endDate < startDate) throw new Error("The end date cannot be before the start date.");
      const span = allDay
        ? { kind: "all_day" as const, startDate, endDateExclusive: nextDate(endDate) }
        : { kind: "zoned" as const, startLocalDateTime: `${startDate}T${startTime}`, endLocalDateTime: `${endDate}T${endTime}`, timeZone };
      if (providerMode) {
        if (!providerBinding || !(existingProvider ? providerBinding.capabilities.update : providerBinding.capabilities.create)) throw new Error("This provider Calendar does not allow this change.");
        if (existingProvider && !providerEventCanMutate(existingProvider)) throw new Error("Recurring, invitation, online meeting, or floating provider events cannot be changed here.");
        const unchangedTiming = existingProvider && existingSpan && (span.kind === "all_day" && existingSpan.kind === "all_day"
          ? span.startDate === existingSpan.startDate && span.endDateExclusive === existingSpan.endDateExclusive
          : span.kind === "zoned" && existingSpan.kind === "zoned" && span.startLocalDateTime === existingSpan.startLocalDateTime && span.endLocalDateTime === existingSpan.endLocalDateTime && span.timeZone === existingSpan.timeZone);
        const content = { title: title.trim(), description: description.trim(), location: location.trim(), status,
          span: unchangedTiming ? existingProvider!.content.span : providerWritableSpan(span) };
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
      <label className="ll-checkbox-label"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />All-day event</label>
      <div className="ll-calendar-form-grid"><label>Starts<input type="date" required value={startDate} onChange={(event) => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} /></label>{!allDay && <label>Start time<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}
        <label>Ends<input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>{!allDay && <label>End time<input type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>}</div>
      {!allDay && <label>Event time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>}
      <fieldset className="ll-calendar-recurrence" disabled={providerMode}><legend>Repeats</legend><div className="ll-calendar-form-grid"><label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="none" disabled={existing?.event.lineage.kind === "recurrence_master"}>Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{frequency !== "none" && <label>Every<input type="number" min={1} max={366} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>}</div>
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
  const editing = calendars.find((calendar) => calendar.id === editingId);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#7FC9B3");
  const [timeZone, setTimeZone] = useState(resolvedTimeZone());
  const [isDefault, setIsDefault] = useState(false);
  const [agentAccess, setAgentAccess] = useState<CalendarAgentAccess>("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setTitle(editing?.title ?? ""); setColor(editing?.color ?? "#7FC9B3"); setTimeZone(editing?.timeZone ?? resolvedTimeZone()); setIsDefault(editing?.isDefault ?? false); setAgentAccess(editing?.agentAccess ?? "write");
  }, [editingId, editing?.updatedAt]);
  async function save() {
    setSaving(true); setError("");
    try {
      if (!title.trim()) throw new Error("Add a Calendar name.");
      if (editing) await controller.updateNativeCalendar(editing.id, editing.updatedAt, { title: title.trim(), color, timeZone, isDefault, agentAccess });
      else await controller.createNativeCalendar({ title: title.trim(), color, timeZone, isDefault, agentAccess });
      setEditingId(null); setTitle(""); setIsDefault(false); setAgentAccess("write");
    } catch (issue) { setError(messageFromIssue(issue, "The Calendar could not be saved.")); }
    finally { setSaving(false); }
  }
  return <Dialog title="Manage calendars" onClose={onClose} wide><div className="ll-calendar-manager">
    <section><h3>Your Life Links calendars</h3><div className="ll-calendar-manager-list">{calendars.map((calendar) => <button key={calendar.id} onClick={() => setEditingId(calendar.id)} className={editingId === calendar.id ? "selected" : ""}><span className="ll-calendar-color" style={{ background: calendar.color }} /><span><strong>{calendar.title}</strong><small>{calendar.timeZone}{calendar.isDefault ? " · Default" : ""}</small><small>Agent: {agentAccessLabel(calendar.agentAccess)}</small></span><Pencil size={15} /></button>)}</div><button className="ll-text-button" onClick={() => { setEditingId(null); setTitle(""); setColor("#7FC9B3"); setTimeZone(resolvedTimeZone()); setIsDefault(false); setAgentAccess("write"); }}><Plus size={15} />New Calendar</button></section>
    <form className="ll-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><h3>{editing ? `Edit ${editing.title}` : "New Calendar"}</h3><label>Name<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Color<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label>Default time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label><label className="ll-checkbox-label"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />Use as my default Calendar</label><CalendarAgentAccessSelect value={agentAccess} onChange={setAgentAccess} disabled={saving} /><p className="ll-calendar-access-help">Showing or hiding a Calendar does not change agent access. Your agent must also be connected with Calendar tools enabled (the Calendar-v2 grant). Deleting events still requires your confirmation.</p>{error && <p className="ll-inline-warning" role="alert">{error}</p>}<button className="ll-button ll-primary" disabled={saving || !title.trim()}><Check size={16} />{saving ? "Saving…" : editing ? "Save Calendar" : "Create Calendar"}</button></form>
    <CalendarConnectionsSection controller={controller} management={snapshot.calendarWorkspace.connectionManagement} flow={snapshot.calendarWorkspace.connectionFlow} />
  </div></Dialog>;
}

function CalendarConnectionsSection({ controller, management, flow }: {
  controller: LifeLinksWorkspaceController;
  management: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"];
  flow?: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionFlow"];
}) {
  const lifetime = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    void controller.loadCalendarConnections(abort.signal).catch(() => undefined);
    return () => { abort.abort(); lifetime.current = null; };
  }, [controller]);

  useEffect(() => {
    if (flow?.authorizationId && !flow.discovery && !flow.loading && !flow.error) {
      void controller.loadCalendarConnectionDiscovery(undefined, lifetime.current?.signal).catch(() => undefined);
    }
  }, [controller, flow?.authorizationId, flow?.discovery, flow?.loading, flow?.error]);

  useEffect(() => { setSelectedIds([]); }, [flow?.discovery]);

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

  async function selectCalendars() {
    setPending("selection"); setError("");
    try { await controller.completeCalendarConnectionSelection(selectedIds, lifetime.current?.signal); }
    catch (issue) { setError(messageFromIssue(issue, "The selected calendars could not be connected.")); }
    finally { setPending(null); }
  }

  async function cancelSelection() {
    setPending("selection"); setError("");
    try { await controller.cancelCalendarConnectionSelection(lifetime.current?.signal); }
    catch (issue) { setError(messageFromIssue(issue, "The pending connection could not be canceled.")); }
    finally { setPending(null); }
  }

  async function refresh(connectionId: string) {
    setPending(connectionId); setError("");
    try { await controller.refreshConnectedCalendarAccount(connectionId, lifetime.current?.signal); }
    catch (issue) { setError(messageFromIssue(issue, "The provider could not refresh this account.")); }
    finally { setPending(null); }
  }

  async function update(view: CalendarConnectedCalendarView, patch: CalendarConnectedCalendarPatch) {
    setPending(view.calendar.id); setError("");
    try {
      await controller.updateConnectedCalendar(view.connectionId, view.calendar.id, view.calendar.updatedAt, patch, lifetime.current?.signal);
    } catch (issue) { setError(messageFromIssue(issue, "The connected Calendar could not be updated.")); }
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
    {flow?.error && <div className="ll-inline-warning" role="alert"><p>{flow.error}</p>{(flow.authorizationId || flow.connectionId) && <button className="ll-button" disabled={Boolean(pending)} onClick={() => void controller.loadCalendarConnectionDiscovery(flow.connectionId ?? undefined, lifetime.current?.signal).catch(() => undefined)}>Retry calendar discovery</button>}</div>}
    {flow?.loading && <p role="status">Finding calendars in the selected account…</p>}
    {flow?.discovery && <section className="ll-calendar-discovery" aria-label="Choose provider calendars"><h4>Choose calendars</h4><p>Account: {flow.discovery.providerAccountId}</p><p>New calendars start with No access for agents. Reconnecting an account also resets its calendars to No access. Adding calendars to an existing connection preserves its other calendar permissions.</p>
      {flow.discovery.calendars.map((calendar) => <label className="ll-checkbox-label" key={calendar.providerCalendarId}><input type="checkbox" checked={selectedIds.includes(calendar.providerCalendarId)} disabled={!calendar.capabilities.read || Boolean(pending)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, calendar.providerCalendarId] : ids.filter((id) => id !== calendar.providerCalendarId))} />{calendar.displayName}{calendar.isDefault ? " (provider default)" : ""}<small>{calendar.capabilities.read ? (calendar.capabilities.update ? " · Writable" : " · Read only") : " · Unavailable"}</small></label>)}
      {!flow.discovery.calendars.length && <p>No readable calendars were returned by this account.</p>}
      <button className="ll-button" disabled={Boolean(pending)} onClick={() => void cancelSelection()}>Cancel selection</button><button className="ll-button ll-primary" disabled={Boolean(pending) || !selectedIds.length} onClick={() => void selectCalendars()}>{pending === "selection" ? "Connecting…" : "Connect selected calendars"}</button>
    </section>}
    {flow?.authorizationId && !flow.discovery && <button className="ll-button" disabled={Boolean(pending)} onClick={() => void cancelSelection()}>Cancel pending connection</button>}
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
      return <article className="ll-calendar-connection" key={connection.connectionId}>
        <header><div><h4>{providerName}</h4><p className="ll-calendar-account-identity">Account: {connection.providerAccountId}</p></div><span className="ll-chip">{connection.status === "active" ? "Connected" : connection.status === "provisioning" ? "Connecting" : "Disconnected"}</span></header>
        {connection.status === "disconnected" ? <><p>{revocationStatusText(connection)}</p>{canAuthorize && <button className="ll-button" disabled={Boolean(pending)} onClick={() => { if (authorizationProvider) void connect(authorizationProvider, connection.connectionId); }}>{reconnectLabel}</button>}</> : <>
          {connection.credentialStatus === "reconnect_required" && <p className="ll-inline-warning" role="status">This account needs to reconnect before Life Links can read or change its provider events.</p>}
          <p>Select which already-linked calendars appear in your Calendar view. Visibility does not change agent access.</p>
          {!calendars.length && <p>No calendars have been selected for this account.</p>}
          <div className="ll-connected-calendar-list">{calendars.map((view) => {
            const canWrite = view.capabilities.read && (view.capabilities.create || view.capabilities.update || view.capabilities.delete);
            return <div className="ll-connected-calendar" key={view.calendar.id}>
              <div><label className="ll-checkbox-label"><input type="checkbox" checked={view.visible} disabled={!active || Boolean(pending) || (!view.visible && !view.capabilities.read)} onChange={(event) => void update(view, { visible: event.target.checked })} />{view.providerDisplayName || view.calendar.title}</label><small>{view.calendar.timeZone} · {providerCapabilityText(view)}</small></div>
              <CalendarAgentAccessSelect value={view.calendar.agentAccess} canRead={view.capabilities.read} canWrite={canWrite} disabled={!active || Boolean(pending)} writeLabel={view.capabilities.update ? "Read and edit" : "Read and allowed changes"} onChange={(agentAccess) => void update(view, { agentAccess })} />
            </div>;
          })}</div>
          <p>An agent also needs the connected Calendar-v2 grant, and can never exceed the provider's permissions.</p>
          {authorizationProvider && active ? <div><button className="ll-button" disabled={Boolean(pending) || flow?.loading} onClick={() => void controller.loadCalendarConnectionDiscovery(connection.connectionId, lifetime.current?.signal).catch(() => undefined)}>Choose additional calendars</button><button className="ll-button" disabled={Boolean(pending)} onClick={() => void refresh(connection.connectionId)}>Refresh events</button>{canAuthorize && <button className="ll-button" disabled={Boolean(pending)} onClick={() => void connect(authorizationProvider, connection.connectionId)}>{reconnectLabel}</button>}</div> : <p>Finding additional calendars for this account is not available yet.</p>}
          {disconnectId === connection.connectionId ? <div className="ll-calendar-disconnect-confirmation" role="group" aria-label={`Confirm disconnect ${providerName}`}>
            <strong>Disconnect {providerName}?</strong><p>Life Links will stop using this account and remove its cached events from this view. Your original calendars and events at {providerName} will not be deleted. Provider access revocation may remain pending or fail; its status will be shown separately.</p>
            <button className="ll-button" disabled={Boolean(pending)} onClick={() => setDisconnectId(null)}>Cancel</button><button className="ll-button ll-danger" disabled={Boolean(pending)} onClick={() => void disconnect(connection)}>{pending === connection.connectionId ? "Disconnecting…" : "Yes, disconnect"}</button>
          </div> : <button className="ll-button" disabled={Boolean(pending)} onClick={() => setDisconnectId(connection.connectionId)}>Disconnect account</button>}
        </>}
      </article>;
    })}</div>
  </section>;
}

function CalendarAgentAccessSelect({ value, onChange, disabled = false, canRead = true, canWrite = true, writeLabel = "Read and edit" }: {
  value: CalendarAgentAccess;
  onChange(value: CalendarAgentAccess): void;
  disabled?: boolean;
  canRead?: boolean;
  canWrite?: boolean;
  writeLabel?: string;
}) {
  return <label>Agent access<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as CalendarAgentAccess)}><option value="none">No access</option><option value="read" disabled={!canRead}>Read only</option><option value="write" disabled={!canRead || !canWrite}>{writeLabel}</option></select></label>;
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
