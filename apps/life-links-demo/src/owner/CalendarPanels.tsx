import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  MapPin,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import type { CalendarRecord } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { ActionMenu } from "./FieldLedgerPrimitives";
import type { CalendarDialogState } from "./CalendarDialogs";
import {
  CALENDAR_WEEKDAYS,
  buildCalendarDisplayEvents,
  calendarLoadRange,
  calendarRange,
  calendarTitle,
  eventStartDate,
  formatCalendarTime,
  formatDate,
  recurrenceSummary,
  resolvedTimeZone,
  shiftCalendarAnchor,
  supportedTimeZones,
  type CalendarDisplayEvent,
  type CalendarView
} from "./calendar";

type CalendarPanelProps = {
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
  onOpenDialog(dialog: NonNullable<CalendarDialogState>): void;
  onOpenDetails(): void;
};

export function CalendarWorkspacePanel({ controller, snapshot, onOpenDialog, onOpenDetails }: CalendarPanelProps) {
  const selected = snapshot.calendarWorkspace.selectedEvent;
  const initialZone = readStoredTimeZone();
  const [view, setView] = useState<CalendarView>("month");
  const [timeZone, setTimeZone] = useState(initialZone);
  const [anchorDate, setAnchorDate] = useState<string | null>(() => selected ? eventStartDate(selected, initialZone) : null);
  const [selectedDate, setSelectedDate] = useState<string | null>(anchorDate);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);
  const calendars = snapshot.calendarWorkspace.calendars.filter((calendar) => !calendar.deletedAt);
  const visibleSet = useMemo(() => new Set(visibleCalendarIds), [visibleCalendarIds]);
  const range = useMemo(() => calendarRange(view, anchorDate ?? "1970-01-01"), [anchorDate, view]);
  const loadRange = useMemo(() => calendarLoadRange(range), [range]);
  const clock = snapshot.calendarWorkspace.clock?.timeZone === timeZone ? snapshot.calendarWorkspace.clock : null;

  useEffect(() => {
    setVisibleCalendarIds((current) => {
      const valid = current.filter((id) => calendars.some((calendar) => calendar.id === id));
      return valid.length || !calendars.length ? valid : calendars.map((calendar) => calendar.id);
    });
  }, [snapshot.calendarWorkspace.calendars]);

  useEffect(() => {
    const abort = new AbortController();
    void controller.loadCalendarClock(timeZone, abort.signal).catch(() => undefined);
    return () => abort.abort();
  }, [controller, timeZone]);

  useEffect(() => {
    if (!clock) return;
    setAnchorDate((current) => current ?? clock.today);
    setSelectedDate((current) => current ?? clock.today);
  }, [clock?.serverTime, clock?.timeZone, clock?.today]);

  useEffect(() => {
    if (!anchorDate) return;
    const abort = new AbortController();
    void controller.loadCalendarWindow({ ...loadRange, signal: abort.signal }).catch(() => undefined);
    return () => abort.abort();
  }, [anchorDate, controller, loadRange.endDate, loadRange.startDate]);

  useEffect(() => {
    if (!selected) return;
    const date = eventStartDate(selected, timeZone);
    setAnchorDate(date);
    setSelectedDate(date);
  }, [selected?.event.id, selected?.event.currentRevisionId, timeZone]);

  const events = useMemo(() => buildCalendarDisplayEvents({
    nativeEvents: snapshot.calendarWorkspace.events,
    routineOccurrences: snapshot.routineWorkspace.calendarOccurrences,
    routines: snapshot.routineWorkspace.routines,
    calendars,
    startDate: range.startDate,
    endDate: range.endDate,
    timeZone,
    visibleCalendarIds: visibleSet
  }), [
    calendars,
    range.endDate,
    range.startDate,
    snapshot.calendarWorkspace.events,
    snapshot.routineWorkspace.calendarOccurrences,
    snapshot.routineWorkspace.routines,
    timeZone,
    visibleSet
  ]);
  const eventsByDate = useMemo(() => groupByDate(events), [events]);

  function move(direction: -1 | 1) {
    if (!anchorDate) return;
    const next = shiftCalendarAnchor(anchorDate, view, direction);
    setAnchorDate(next);
    setSelectedDate(next);
  }
  function showToday() {
    if (!clock) return;
    setAnchorDate(clock.today);
    setSelectedDate(clock.today);
  }
  function chooseView(next: CalendarView) {
    if (selectedDate) setAnchorDate(selectedDate);
    setView(next);
  }
  function chooseTimeZone(next: string) {
    setTimeZone(next);
    try { localStorage.setItem("life-links-calendar-time-zone", next); } catch { /* preference only */ }
  }
  function toggleCalendar(calendarId: string) {
    setVisibleCalendarIds((ids) => ids.includes(calendarId) ? ids.filter((id) => id !== calendarId) : [...ids, calendarId]);
  }
  function openEvent(event: CalendarDisplayEvent) {
    if (event.source === "routine" && event.routineId) {
      void controller.openRoutine(event.routineId);
      return;
    }
    if (event.eventId) {
      void controller.openCalendarEvent(event.eventId);
      onOpenDetails();
    }
  }

  if (!anchorDate || !selectedDate || !clock) {
    return <section className="ll-calendar-workspace" aria-labelledby="ll-calendar-title"><div className="ll-title-row ll-calendar-page-title"><div><h1 id="ll-calendar-title">My Calendar</h1><p className="ll-subtitle">Loading the current date for {timeZone}…</p></div></div>{snapshot.calendarWorkspace.error && <p className="ll-inline-warning" role="alert">{snapshot.calendarWorkspace.error}</p>}</section>;
  }
  const today = clock.today;
  return <section className="ll-calendar-workspace" aria-labelledby="ll-calendar-title">
    <div className="ll-title-row ll-calendar-page-title">
      <div><h1 id="ll-calendar-title">My Calendar</h1><p className="ll-subtitle">{events.length} visible entries · {calendars.length} {calendars.length === 1 ? "calendar" : "calendars"}</p></div>
      <ActionMenu label="Add to My Calendar" className="ll-icon-button ll-primary ll-main-plus" items={[
        { label: "New event", icon: <CalendarDays size={17} />, onClick: () => onOpenDialog({ kind: "new-event", date: selectedDate }) },
        { label: "Manage calendars", icon: <Settings2 size={17} />, onClick: () => onOpenDialog({ kind: "manage-calendars" }) }
      ]}><Plus size={24} /></ActionMenu>
    </div>

    <div className="ll-calendar-toolbar">
      <div className="ll-calendar-navigation" aria-label="Calendar navigation">
        <button className="ll-button" type="button" onClick={() => move(-1)} aria-label={`Previous ${view}`}><ChevronLeft size={16} />Previous</button>
        <button className="ll-button ll-calendar-today-button" type="button" onClick={showToday}>Today</button>
        <button className="ll-button" type="button" onClick={() => move(1)} aria-label={`Next ${view}`}>Next<ChevronRight size={16} /></button>
      </div>
      <div className="ll-view-switch ll-calendar-view-switch" role="group" aria-label="Calendar view">
        {(["month", "week", "day", "agenda"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate} onClick={() => chooseView(candidate)}>{capitalize(candidate)}</button>)}
      </div>
    </div>

    <div className="ll-calendar-options">
      <details className="ll-calendar-filter"><summary><CalendarDays size={15} />Calendars</summary><div className="ll-calendar-filter-menu">
        {calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={visibleSet.has(calendar.id)} onChange={() => toggleCalendar(calendar.id)} /><span className="ll-calendar-color" style={{ background: calendar.color }} />{calendar.title}{calendar.isDefault && <small>Default</small>}</label>)}
        <label className="ll-calendar-projection-filter"><input type="checkbox" checked disabled /><span className="ll-calendar-color ll-routine-color" />Routine plans<small>Projection</small></label>
        <button className="ll-text-button" type="button" onClick={() => onOpenDialog({ kind: "manage-calendars" })}><Settings2 size={14} />Manage</button>
      </div></details>
      <label className="ll-calendar-zone"><span>View time zone</span><select value={timeZone} onChange={(event) => chooseTimeZone(event.target.value)}>{supportedTimeZones().map((zone) => <option value={zone} key={zone}>{zone}</option>)}</select></label>
    </div>

    <div className="ll-calendar-heading"><div><h2 aria-live="polite">{calendarTitle(view, anchorDate, timeZone)}</h2><p>Times shown in {timeZone}. All-day events keep their calendar dates.</p></div>{snapshot.calendarWorkspace.loading && <span className="ll-muted" role="status">Updating…</span>}</div>
    {(snapshot.calendarWorkspace.error || snapshot.routineWorkspace.calendarError) && <p className="ll-inline-warning" role="alert">{snapshot.calendarWorkspace.error || snapshot.routineWorkspace.calendarError}</p>}

    {view === "month" && <MonthView anchorDate={anchorDate} days={range.days} eventsByDate={eventsByDate} selectedDate={selectedDate} today={today} timeZone={timeZone} onSelectDate={setSelectedDate} onOpenEvent={openEvent} />}
    {view === "week" && <WeekView days={range.days} eventsByDate={eventsByDate} selectedDate={selectedDate} today={today} timeZone={timeZone} onSelectDate={(date) => { setSelectedDate(date); setAnchorDate(date); }} onOpenEvent={openEvent} />}
    {view === "day" && <AgendaView days={[anchorDate]} eventsByDate={eventsByDate} today={today} timeZone={timeZone} onOpenEvent={openEvent} />}
    {view === "agenda" && <AgendaView days={range.days.filter((day) => (eventsByDate.get(day)?.length ?? 0) > 0)} eventsByDate={eventsByDate} today={today} timeZone={timeZone} onOpenEvent={openEvent} />}
    {view === "month" && <section className="ll-calendar-selected-agenda"><h3>{formatDate(selectedDate, timeZone, { weekday: "long", month: "long", day: "numeric" })}</h3><EventList events={eventsByDate.get(selectedDate) ?? []} timeZone={timeZone} onOpenEvent={openEvent} /></section>}
  </section>;
}

export function CalendarDetailPanel({ controller, snapshot, onOpenDialog }: Pick<CalendarPanelProps, "controller" | "snapshot" | "onOpenDialog">) {
  const selected = snapshot.calendarWorkspace.selectedEvent;
  if (!selected) return <div className="ll-empty">Select a Calendar event to see its exact time, authority, recurrence, and connected context.</div>;
  const calendar = snapshot.calendarWorkspace.calendars.find((candidate) => candidate.id === selected.event.calendarId);
  const revision = selected.currentRevision;
  const deleted = Boolean(selected.event.deletedAt);
  const target = selected.event.lineage.kind === "recurrence_master"
    ? { scope: "series" as const, masterEventId: selected.event.id }
    : { scope: "event" as const, eventId: selected.event.id };
  return <article className="ll-detail-content ll-calendar-detail" data-calendar-event-id={selected.event.id}>
    <p className="ll-context-row">My Calendar / {calendar?.title ?? "Calendar"}</p>
    <div className="ll-title-row ll-detail-title-row"><h2>{revision.title}</h2>{!deleted && <ActionMenu label={`Actions for ${revision.title}`} className="ll-icon-button ll-primary ll-detail-plus" items={[
      { label: selected.event.lineage.kind === "recurrence_master" ? "Edit series" : "Edit event", icon: <Pencil size={17} />, onClick: () => onOpenDialog({ kind: "edit-event", eventId: selected.event.id }) },
      { label: selected.event.lineage.kind === "recurrence_master" ? "Delete series" : "Delete event", icon: <Trash2 size={17} />, onClick: () => onOpenDialog({ kind: "delete-event", eventId: selected.event.id }), danger: true }
    ]}><Plus size={21} /></ActionMenu>}</div>
    <div className="ll-detail-badges"><span className="ll-chip ll-neutral">Life Links native</span><span className="ll-chip ll-blue">{calendar?.title ?? selected.event.calendarId}</span>{deleted && <span className="ll-chip ll-copper">Deleted</span>}</div>
    {deleted && snapshot.calendarWorkspace.latestTombstone && <section className="ll-calendar-restore"><p>This event is softly deleted. Its exact last revision is still available to restore.</p><button className="ll-button" onClick={() => void controller.restoreNativeCalendarEvent(selected.event.id, selected.event.currentRevisionId, snapshot.calendarWorkspace.latestTombstone!.id)}><RotateCcw size={16} />Restore</button></section>}
    <section className="ll-calendar-when"><Clock3 size={20} /><div><strong>{formatEventSpan(revision, calendar)}</strong><span>{revision.span.kind === "zoned" ? revision.span.timeZone : "All-day calendar dates"}</span></div></section>
    {revision.location && <section className="ll-calendar-when"><MapPin size={20} /><div><strong>{revision.location}</strong><span>Recorded location</span></div></section>}
    {revision.description && <section className="ll-detail-section"><h3>Description</h3><p className="ll-preserve-lines">{revision.description}</p></section>}
    <section className="ll-detail-section"><h3>Recurrence</h3><p>{recurrenceSummary(revision.recurrence)}</p><small className="ll-muted">This UI edits the exact event or the whole series. Occurrence splitting is not presented until that API contract exists.</small></section>
    <section className="ll-detail-section"><h3>Authority</h3><dl className="ll-calendar-facts"><div><dt>Write authority</dt><dd>Life Links</dd></div><div><dt>Source</dt><dd>{calendar?.source ?? "native"}</dd></div><div><dt>Status</dt><dd>{revision.status}</dd></div><div><dt>Revision</dt><dd>{revision.revisionNumber}</dd></div></dl></section>
    <section className="ll-detail-section"><h3>Connected context</h3>{revision.subjectLinks.length ? <ul className="ll-routine-context-list">{revision.subjectLinks.map((link, index) => <li key={`${link.kind}-${index}`}><span className="ll-chip ll-neutral">{subjectKind(link.kind)}</span><span>{subjectId(link)}</span></li>)}</ul> : <p className="ll-muted">No Life Link, Collection, or Routine context attached.</p>}</section>
    <details className="ll-record-meta"><summary>Calendar event details</summary><dl><dt>Event ID</dt><dd>{selected.event.id}</dd><dt>Calendar ID</dt><dd>{selected.event.calendarId}</dd><dt>Revision ID</dt><dd>{selected.event.currentRevisionId}</dd><dt>Updated</dt><dd>{new Date(selected.event.updatedAt).toLocaleString()}</dd></dl></details>
  </article>;
}

function MonthView({ anchorDate, days, eventsByDate, selectedDate, today, timeZone, onSelectDate, onOpenEvent }: {
  anchorDate: string; days: string[]; eventsByDate: Map<string, CalendarDisplayEvent[]>; selectedDate: string; today: string; timeZone: string;
  onSelectDate(date: string): void; onOpenEvent(event: CalendarDisplayEvent): void;
}) {
  const month = anchorDate.slice(0, 7);
  return <div className="ll-calendar-month-scroll"><table className="ll-calendar-month"><caption className="ll-visually-hidden">{calendarTitle("month", anchorDate, timeZone)}</caption>
    <thead><tr>{CALENDAR_WEEKDAYS.map((day) => <th key={day}><span className="ll-calendar-weekday-long">{day}</span><span className="ll-calendar-weekday-short">{day.slice(0, 3)}</span></th>)}</tr></thead>
    <tbody>{chunk(days, 7).map((week) => <tr key={week[0]}>{week.map((date) => { const entries = eventsByDate.get(date) ?? []; return <td key={date} className={`${date.slice(0, 7) !== month ? "outside-month " : ""}${date === selectedDate ? "selected" : ""}`}>
      <button className="ll-calendar-date-button" aria-current={date === today ? "date" : undefined} aria-pressed={date === selectedDate} onClick={() => onSelectDate(date)}>{Number(date.slice(-2))}</button>
      <div className="ll-calendar-cell-events">{entries.slice(0, 3).map((event) => <EventButton event={event} timeZone={timeZone} compact onOpen={onOpenEvent} key={event.id} />)}{entries.length > 3 && <button className="ll-calendar-more" onClick={() => onSelectDate(date)}>+{entries.length - 3} more</button>}</div>
    </td>; })}</tr>)}</tbody>
  </table></div>;
}

function WeekView({ days, eventsByDate, selectedDate, today, timeZone, onSelectDate, onOpenEvent }: {
  days: string[]; eventsByDate: Map<string, CalendarDisplayEvent[]>; selectedDate: string; today: string; timeZone: string;
  onSelectDate(date: string): void; onOpenEvent(event: CalendarDisplayEvent): void;
}) {
  return <div className="ll-calendar-week">{days.map((date) => <section className={`ll-calendar-week-day${selectedDate === date ? " selected" : ""}`} key={date}><button className="ll-calendar-day-heading" aria-current={date === today ? "date" : undefined} onClick={() => onSelectDate(date)}><strong>{formatDate(date, timeZone, { weekday: "long" })}</strong><span>{formatDate(date, timeZone, { month: "short", day: "numeric" })}</span></button><EventList events={eventsByDate.get(date) ?? []} timeZone={timeZone} onOpenEvent={onOpenEvent} compactEmpty /></section>)}</div>;
}

function AgendaView({ days, eventsByDate, today, timeZone, onOpenEvent }: { days: string[]; eventsByDate: Map<string, CalendarDisplayEvent[]>; today: string; timeZone: string; onOpenEvent(event: CalendarDisplayEvent): void }) {
  if (!days.length) return <div className="ll-empty"><CalendarDays size={25} /><strong>No entries in this range</strong><p>Native events and planned Routine occurrences will appear together here.</p></div>;
  return <div className="ll-calendar-agenda">{days.map((date) => <section key={date} className="ll-calendar-agenda-day"><header><span>{date === today ? "Today" : formatDate(date, timeZone, { weekday: "short" })}</span><strong>{formatDate(date, timeZone, { month: "long", day: "numeric", year: "numeric" })}</strong></header><EventList events={eventsByDate.get(date) ?? []} timeZone={timeZone} onOpenEvent={onOpenEvent} /></section>)}</div>;
}

function EventList({ events, timeZone, onOpenEvent, compactEmpty = false }: { events: CalendarDisplayEvent[]; timeZone: string; onOpenEvent(event: CalendarDisplayEvent): void; compactEmpty?: boolean }) {
  if (!events.length) return compactEmpty ? <p className="ll-calendar-no-events">No entries</p> : <p className="ll-muted">Nothing scheduled.</p>;
  return <div className="ll-calendar-agenda-events">{events.map((event) => <EventButton event={event} timeZone={timeZone} onOpen={onOpenEvent} key={event.id} />)}</div>;
}

function EventButton({ event, timeZone, onOpen, compact = false }: { event: CalendarDisplayEvent; timeZone: string; onOpen(event: CalendarDisplayEvent): void; compact?: boolean }) {
  return <button className={`ll-calendar-event ll-calendar-source-${event.source}`} style={{ borderLeftColor: event.color }} title={`${formatCalendarTime(event, timeZone)} · ${event.title}`} onClick={() => onOpen(event)}>
    <span className="ll-calendar-event-time">{formatCalendarTime(event, timeZone)}</span><span className="ll-calendar-event-title">{event.title}</span>{!compact && <><span className="ll-calendar-event-status">{event.source === "routine" ? "Routine plan" : event.status}</span>{event.source === "routine" ? <Play size={13} /> : <ExternalLink size={13} />}</>}
  </button>;
}

function formatEventSpan(revision: LifeLinksWorkspaceSnapshot["calendarWorkspace"]["selectedEvent"] extends infer _ ? NonNullable<LifeLinksWorkspaceSnapshot["calendarWorkspace"]["selectedEvent"]>["currentRevision"] : never, calendar?: CalendarRecord): string {
  if (revision.span.kind === "all_day") return `${revision.span.startDate} through ${previousDate(revision.span.endDateExclusive)} · all day`;
  const formatter = new Intl.DateTimeFormat([], { dateStyle: "full", timeStyle: "short", timeZone: revision.span.timeZone });
  return `${formatter.format(new Date(revision.span.startInstant))} – ${formatter.format(new Date(revision.span.endInstant))}${calendar ? ` · ${calendar.title}` : ""}`;
}

function previousDate(value: string): string { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }
function groupByDate(events: CalendarDisplayEvent[]): Map<string, CalendarDisplayEvent[]> { const groups = new Map<string, CalendarDisplayEvent[]>(); for (const event of events) groups.set(event.date, [...(groups.get(event.date) ?? []), event]); return groups; }
function chunk<T>(items: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size)); return result; }
function readStoredTimeZone(): string { try { const stored = localStorage.getItem("life-links-calendar-time-zone"); if (stored) { new Intl.DateTimeFormat("en", { timeZone: stored }); return stored; } } catch { /* use device zone */ } return resolvedTimeZone(); }
function capitalize(value: string): string { return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value; }
function subjectKind(kind: string): string { return kind.split("_").map(capitalize).join(" "); }
function subjectId(link: Record<string, unknown>): string { return String(link.lifeLinkId ?? link.collectionId ?? link.routineId ?? link.scheduleId ?? link.occurrenceId ?? link.sessionId ?? "Connected record"); }
