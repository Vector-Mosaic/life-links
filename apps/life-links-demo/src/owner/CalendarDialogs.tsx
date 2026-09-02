import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Cloud, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  CalendarEventEditTargetInput,
  CalendarEventStatus,
  CalendarAgentAccess,
  CalendarConnectedCalendarPatch,
  CalendarConnectedCalendarView,
  CalendarConnectionView,
  CalendarRecurrenceEnd,
  CalendarRecurrenceRule,
  CalendarWeekday
} from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import type { AgentCalendarDeletionPreview } from "../agent/calendarToolHandlers";
import { Dialog } from "./FieldLedgerPrimitives";
import { recurrenceSummary, resolvedTimeZone, supportedTimeZones } from "./calendar";

export type CalendarDialogState =
  | { kind: "new-event"; date: string }
  | { kind: "edit-event"; eventId: string }
  | { kind: "delete-event"; eventId: string }
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
  return <CalendarEventDialog {...props} eventId={props.dialog.kind === "edit-event" ? props.dialog.eventId : null} initialDate={props.dialog.kind === "new-event" ? props.dialog.date : null} />;
}

export function AgentCalendarDeletionDialog({ preview, onConfirm, onCancel }: {
  preview: AgentCalendarDeletionPreview;
  onConfirm(): void;
  onCancel(): void;
}) {
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

function CalendarEventDialog({ controller, snapshot, onClose, eventId, initialDate }: Props & { eventId: string | null; initialDate: string | null }) {
  const existing = eventId ? snapshot.calendarWorkspace.events.find((item) => item.event.id === eventId) ?? snapshot.calendarWorkspace.selectedEvent : null;
  const calendars = snapshot.calendarWorkspace.calendars.filter((calendar) => !calendar.deletedAt);
  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0];
  const existingCalendar = calendars.find((calendar) => calendar.id === existing?.event.calendarId);
  const existingSpan = existing?.currentRevision.span;
  const [calendarId, setCalendarId] = useState(existingCalendar?.id ?? defaultCalendar?.id ?? "");
  const [title, setTitle] = useState(existing?.currentRevision.title ?? "");
  const [description, setDescription] = useState(existing?.currentRevision.description ?? "");
  const [location, setLocation] = useState(existing?.currentRevision.location ?? "");
  const [status, setStatus] = useState<CalendarEventStatus>(existing?.currentRevision.status ?? "confirmed");
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
    if (!existing && calendar) setTimeZone(calendar.timeZone);
  }, [calendarId]);

  const recurrence = useMemo(() => buildRecurrence({ frequency, interval, weekdays, startDate, endKind, untilDate, count }), [count, endKind, frequency, interval, startDate, untilDate, weekdays]);
  async function submit() {
    setSaving(true); setError("");
    try {
      if (!calendarId) throw new Error("Choose a Calendar.");
      if (!title.trim()) throw new Error("Add an event title.");
      if (endDate < startDate) throw new Error("The end date cannot be before the start date.");
      const span = allDay
        ? { kind: "all_day" as const, startDate, endDateExclusive: nextDate(endDate) }
        : { kind: "zoned" as const, startLocalDateTime: `${startDate}T${startTime}`, endLocalDateTime: `${endDate}T${endTime}`, timeZone };
      if (existing) {
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

  return <Dialog title={existing ? (existing.event.lineage.kind === "recurrence_master" ? "Edit Calendar series" : "Edit Calendar event") : "New Calendar event"} onClose={onClose} wide>
    <form className="ll-form ll-calendar-event-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="ll-calendar-form-grid"><label>Calendar<select required value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>{calendars.map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.title}{calendar.isDefault ? " (default)" : ""}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as CalendarEventStatus)}><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option><option value="canceled">Canceled</option></select></label></div>
      <label>Title<input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Description<textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Location<input maxLength={500} value={location} onChange={(event) => setLocation(event.target.value)} /></label>
      <label className="ll-checkbox-label"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />All-day event</label>
      <div className="ll-calendar-form-grid"><label>Starts<input type="date" required value={startDate} onChange={(event) => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value); }} /></label>{!allDay && <label>Start time<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>}
        <label>Ends<input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>{!allDay && <label>End time<input type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>}</div>
      {!allDay && <label>Event time zone<select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>}
      <fieldset className="ll-calendar-recurrence"><legend>Repeats</legend><div className="ll-calendar-form-grid"><label>Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="none" disabled={existing?.event.lineage.kind === "recurrence_master"}>Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{frequency !== "none" && <label>Every<input type="number" min={1} max={366} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>}</div>
        {frequency === "weekly" && <div className="ll-calendar-weekday-picker" aria-label="Repeat on">{WEEKDAYS.map((day) => <label key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => setWeekdays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day])} />{capitalize(day.slice(0, 3))}</label>)}</div>}
        {frequency !== "none" && <div className="ll-calendar-form-grid"><label>Ends<select value={endKind} onChange={(event) => setEndKind(event.target.value as CalendarRecurrenceEnd["kind"])}><option value="never">Never</option><option value="until">On a date</option><option value="count">After a count</option></select></label>{endKind === "until" && <label>Last date<input type="date" min={startDate} value={untilDate} onChange={(event) => setUntilDate(event.target.value)} /></label>}{endKind === "count" && <label>Occurrences<input type="number" min={1} max={10000} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>}</div>}
        {recurrence && <p className="ll-muted">{recurrenceSummary(recurrence)}</p>}
      </fieldset>
      {existing?.event.lineage.kind === "recurrence_master" && <p className="ll-inline-note">This changes the whole series. Per-occurrence and this-and-future splitting remain unavailable until their API behavior is complete.</p>}
      {(error || snapshot.calendarWorkspace.error) && <p className="ll-inline-warning" role="alert">{error || snapshot.calendarWorkspace.error}</p>}
      <footer><button type="button" className="ll-button" onClick={onClose}>Cancel</button><button className="ll-button ll-primary" disabled={saving || !title.trim() || !calendarId}><Check size={16} />{saving ? "Saving…" : "Save event"}</button></footer>
    </form>
  </Dialog>;
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
    <CalendarConnectionsSection controller={controller} management={snapshot.calendarWorkspace.connectionManagement} />
  </div></Dialog>;
}

function CalendarConnectionsSection({ controller, management }: {
  controller: LifeLinksWorkspaceController;
  management: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["connectionManagement"];
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
    <p>New account connections are not available yet. Google Calendar and Microsoft Outlook sign-in will be enabled after their OAuth connection is ready.</p>
    {management.providers.map((provider) => <button className="ll-button" key={provider.providerKey} disabled title="Account authorization is not available yet"><Cloud size={16} />Connect {provider.displayName}</button>)}
    {management.loading && <p role="status">Loading Calendar connections…</p>}
    {(management.error || error) && <div className="ll-inline-warning" role="alert"><p>{error || management.error}</p><button className="ll-button" disabled={management.loading || Boolean(pending)} onClick={() => { setError(""); void controller.loadCalendarConnections(lifetime.current?.signal).catch(() => undefined); }}>Retry loading connections</button></div>}
    {management.loaded && !management.error && !management.connections.length && <p>No external accounts are connected.</p>}
    <div className="ll-calendar-connection-list">{management.connections.map((connection) => {
      const providerName = management.providers.find((provider) => provider.providerKey === connection.providerKey)?.displayName ?? connection.providerKey;
      const calendars = management.calendars.filter((view) => view.connectionId === connection.connectionId && !view.calendar.deletedAt);
      const active = connection.status === "active";
      return <article className="ll-calendar-connection" key={connection.connectionId}>
        <header><div><h4>{providerName}</h4><p className="ll-calendar-account-identity">Account: {connection.providerAccountId}</p></div><span className="ll-chip">{connection.status === "active" ? "Connected" : connection.status === "provisioning" ? "Connecting" : "Disconnected"}</span></header>
        {connection.status === "disconnected" ? <p>{revocationStatusText(connection)}</p> : <>
          <p>Select which already-linked calendars appear in your Calendar view. Visibility does not change agent access.</p>
          {!calendars.length && <p>No calendars have been selected for this account.</p>}
          <div className="ll-connected-calendar-list">{calendars.map((view) => {
            const canWrite = view.capabilities.read && (view.capabilities.create || view.capabilities.update || view.capabilities.delete);
            return <div className="ll-connected-calendar" key={view.calendar.id}>
              <div><label className="ll-checkbox-label"><input type="checkbox" checked={view.visible} disabled={!active || Boolean(pending) || (!view.visible && !view.capabilities.read)} onChange={(event) => void update(view, { visible: event.target.checked })} />{view.providerDisplayName || view.calendar.title}</label><small>{view.calendar.timeZone} · {providerCapabilityText(view)}</small></div>
              <CalendarAgentAccessSelect value={view.calendar.agentAccess} canRead={view.capabilities.read} canWrite={canWrite} disabled={!active || Boolean(pending)} writeLabel={view.capabilities.update ? "Read and edit" : "Read and allowed changes"} onChange={(agentAccess) => void update(view, { agentAccess })} />
            </div>;
          })}</div>
          <p>Finding additional calendars for this account is not available yet. An agent also needs the connected Calendar-v2 grant, and can never exceed the provider's permissions.</p>
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
  if (connection.remoteRevocationStatus === "succeeded") return "Life Links access is off and provider access was revoked. Original provider events were not deleted.";
  if (connection.remoteRevocationStatus === "pending") return "Life Links access is off. Provider access revocation is still pending; your original provider events were not deleted.";
  if (connection.remoteRevocationStatus === "failed") return "Life Links access is off, but provider access revocation failed. Review this app's access in your provider account. Original provider events were not deleted.";
  return "Life Links access is off. No remote revocation was required; original provider events were not deleted.";
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
