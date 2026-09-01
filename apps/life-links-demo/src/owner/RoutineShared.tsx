import type {
  RoutineScheduleRecord,
  RoutineScheduleRule,
  RoutineValue,
  RoutineValueKind
} from "@life-links/core";

export type RoutineWorkspaceTab = "routines" | "history";

export const ROUTINE_VALUE_KINDS: RoutineValueKind[] = ["number", "quantity", "duration", "text", "boolean"];

export type RoutineDialogState =
  | { kind: "new-group" }
  | { kind: "new-activity" }
  | { kind: "new-routine" }
  | { kind: "revise-routine" }
  | { kind: "new-schedule" }
  | { kind: "edit-schedule"; scheduleId: string }
  | { kind: "run"; occurrenceId?: string | null }
  | { kind: "correct-session"; sessionId: string; stepResultId?: string | null }
  | null;

export type RoutineValueDraft = {
  id: string;
  key: string;
  label: string;
  kind: RoutineValueKind;
  raw: string;
  unit: string;
};

export function routineEntityId(prefix: string): string {
  return `${prefix}${crypto.randomUUID()}`;
}

export function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatRoutineDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function formatRoutineValue(value: RoutineValue): string {
  if (value.kind === "number") return String(value.value);
  if (value.kind === "quantity") return `${value.amount} ${value.unit}`;
  if (value.kind === "duration") {
    if (value.seconds % 3600 === 0) return `${value.seconds / 3600} hr`;
    if (value.seconds % 60 === 0) return `${value.seconds / 60} min`;
    return `${value.seconds} sec`;
  }
  if (value.kind === "boolean") return value.value ? "Yes" : "No";
  return value.text || "Empty text";
}

export function formatRoutineSchedule(rule: RoutineScheduleRule): string {
  const time = formatLocalTime(rule.localTime);
  if (rule.kind === "once") return `${formatLocalDate(rule.localDate)} at ${time}`;
  if (rule.kind === "daily") {
    const cadence = rule.intervalDays === 1 ? "Daily" : `Every ${rule.intervalDays} days`;
    return `${cadence} at ${time}${rule.endDate ? ` through ${formatLocalDate(rule.endDate)}` : ""}`;
  }
  const days = rule.weekdays.map((day) => day.slice(0, 3)).join(", ");
  const cadence = rule.intervalWeeks === 1 ? "Weekly" : `Every ${rule.intervalWeeks} weeks`;
  return `${cadence} on ${days} at ${time}${rule.endDate ? ` through ${formatLocalDate(rule.endDate)}` : ""}`;
}

export function routineScheduleMeta(schedule: RoutineScheduleRecord): string {
  return `${formatRoutineSchedule(schedule.rule)} · ${schedule.rule.timeZone}${schedule.active ? "" : " · Paused"}`;
}

export function routineValueToDraft(value: RoutineValue): RoutineValueDraft {
  return {
    id: crypto.randomUUID(),
    key: value.key,
    label: value.label,
    kind: value.kind,
    raw: value.kind === "number" ? String(value.value)
      : value.kind === "quantity" ? String(value.amount)
        : value.kind === "duration" ? String(value.seconds)
          : value.kind === "boolean" ? String(value.value)
            : value.text,
    unit: value.kind === "quantity" ? value.unit : ""
  };
}

export function blankRoutineValueDraft(): RoutineValueDraft {
  return { id: crypto.randomUUID(), key: "", label: "", kind: "number", raw: "", unit: "" };
}

export function draftToRoutineValue(draft: RoutineValueDraft, reservedKeys: Set<string>): RoutineValue {
  const label = draft.label.trim();
  if (!label) throw new Error("Every planned value needs a label.");
  let key = draft.key.trim() || slugValueKey(label);
  if (!key) key = "value";
  let candidate = key;
  let suffix = 2;
  while (reservedKeys.has(candidate)) candidate = `${key.slice(0, 59)}-${suffix++}`;
  reservedKeys.add(candidate);
  const number = Number(draft.raw);
  if (draft.kind === "number") {
    if (!draft.raw.trim() || !Number.isFinite(number)) throw new Error(`${label} needs a number.`);
    return { key: candidate, label, kind: "number", value: number };
  }
  if (draft.kind === "quantity") {
    const unit = draft.unit.trim();
    if (!draft.raw.trim() || !Number.isFinite(number)) throw new Error(`${label} needs an amount.`);
    if (!unit) throw new Error(`${label} needs a unit.`);
    return { key: candidate, label, kind: "quantity", amount: number, unit };
  }
  if (draft.kind === "duration") {
    if (!draft.raw.trim() || !Number.isSafeInteger(number) || number < 0) {
      throw new Error(`${label} needs a whole number of seconds.`);
    }
    return { key: candidate, label, kind: "duration", seconds: number };
  }
  if (draft.kind === "boolean") return { key: candidate, label, kind: "boolean", value: draft.raw === "true" };
  return { key: candidate, label, kind: "text", text: draft.raw };
}

export function resultDraftValue(template: RoutineValue, raw: string): RoutineValue | null {
  if (raw === "") return null;
  if (template.kind === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${template.label} needs a number.`);
    return { ...template, value };
  }
  if (template.kind === "quantity") {
    const amount = Number(raw);
    if (!Number.isFinite(amount)) throw new Error(`${template.label} needs an amount.`);
    return { ...template, amount };
  }
  if (template.kind === "duration") {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error(`${template.label} needs whole seconds.`);
    return { ...template, seconds };
  }
  if (template.kind === "boolean") return { ...template, value: raw === "true" };
  return { ...template, text: raw };
}

export function routineValueRaw(value: RoutineValue): string {
  if (value.kind === "number") return String(value.value);
  if (value.kind === "quantity") return String(value.amount);
  if (value.kind === "duration") return String(value.seconds);
  if (value.kind === "boolean") return String(value.value);
  return value.text;
}

export function RoutineValueList({ values, empty = "No values recorded" }: { values: readonly RoutineValue[]; empty?: string }) {
  if (!values.length) return <span className="ll-muted">{empty}</span>;
  return <dl className="ll-routine-values">{values.map((value) => <div key={value.key}>
    <dt>{value.label}</dt><dd>{formatRoutineValue(value)}</dd>
  </div>)}</dl>;
}

function slugValueKey(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString([], { dateStyle: "medium" });
}

function formatLocalTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const parsed = new Date(2000, 0, 1, hour, minute);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
