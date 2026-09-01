import {
  ProviderCursorExpiredError,
  ProviderRevisionConflictError,
  ProviderTransientError,
  type CalendarProviderAdapter,
  type CalendarProviderCapabilities,
  type CalendarProviderDiscovery,
  type CalendarProviderSyncBatch,
  type CalendarProviderWindow,
  type ProviderEventContent,
  type ProviderEventSnapshot
} from "./calendar-provider-gateway.js";

export type DeterministicFakeCalendar = {
  providerCalendarId: string;
  displayName: string;
  capabilities: CalendarProviderCapabilities;
  events?: ProviderEventSnapshot[];
};

type Change =
  | { sequence: number; kind: "upsert"; event: ProviderEventSnapshot }
  | { sequence: number; kind: "delete"; providerEventId: string; providerRevision: string };

type ChangeInput =
  | { kind: "upsert"; event: ProviderEventSnapshot }
  | { kind: "delete"; providerEventId: string; providerRevision: string };

type CommandReceipt =
  | { fingerprint: string; kind: "create"; providerEventId: string }
  | { fingerprint: string; kind: "update" | "delete" };

type FakeCalendarState = {
  definition: DeterministicFakeCalendar;
  events: Map<string, ProviderEventSnapshot>;
  changes: Change[];
  sequence: number;
};

export type DeterministicFakeCalendarMetrics = {
  discoveryCalls: number;
  fetchCalls: Array<{
    providerAccountId: string;
    providerCalendarId: string;
    syncCursor: string | null;
    window: CalendarProviderWindow;
    maxEvents: number;
  }>;
  commandAttempts: Record<"create" | "update" | "delete", number>;
  commandApplies: Record<"create" | "update" | "delete", number>;
  revokeCalls: number;
  activeFetches: number;
  maxConcurrentFetches: number;
};

/**
 * Deterministic provider adapter used to qualify the gateway contract without
 * implying support for any live calendar provider.
 */
export class DeterministicFakeCalendarProviderAdapter implements CalendarProviderAdapter {
  readonly #calendars = new Map<string, FakeCalendarState>();
  readonly #receipts = new Map<string, CommandReceipt>();
  readonly #expiredCursors = new Set<string>();
  readonly #failAfterCommitOnce = new Set<string>();
  readonly #failedAfterCommit = new Set<string>();
  #failRevocation = false;
  #nextFetchFailure: Error | null = null;
  #nextReadbackProviderEventId: string | null = null;
  #nextFetchGate: Promise<void> | null = null;
  #releaseNextFetch: (() => void) | null = null;
  #nextCreateGate: Promise<void> | null = null;
  #releaseNextCreate: (() => void) | null = null;
  readonly #metrics: DeterministicFakeCalendarMetrics = {
    discoveryCalls: 0,
    fetchCalls: [],
    commandAttempts: { create: 0, update: 0, delete: 0 },
    commandApplies: { create: 0, update: 0, delete: 0 },
    revokeCalls: 0,
    activeFetches: 0,
    maxConcurrentFetches: 0
  };
  #eventCounter = 0;
  #revisionCounter = 0;
  #revoked = false;

  constructor(
    readonly providerKey: string,
    readonly providerAccountId: string,
    calendars: DeterministicFakeCalendar[]
  ) {
    for (const definition of calendars) {
      if (this.#calendars.has(definition.providerCalendarId)) throw new Error("Duplicate fake calendar identity.");
      const events = new Map<string, ProviderEventSnapshot>();
      for (const event of definition.events ?? []) {
        if (events.has(event.providerEventId)) throw new Error("Duplicate fake event identity.");
        events.set(event.providerEventId, cloneSnapshot(event));
        this.#revisionCounter = Math.max(this.#revisionCounter, revisionNumber(event.providerRevision));
      }
      this.#calendars.set(definition.providerCalendarId, {
        definition: { ...definition, capabilities: { ...definition.capabilities }, events: undefined },
        events,
        changes: [],
        sequence: 0
      });
    }
  }

  metrics(): DeterministicFakeCalendarMetrics {
    return {
      discoveryCalls: this.#metrics.discoveryCalls,
      fetchCalls: this.#metrics.fetchCalls.map((call) => ({ ...call, window: { ...call.window } })),
      commandAttempts: { ...this.#metrics.commandAttempts },
      commandApplies: { ...this.#metrics.commandApplies },
      revokeCalls: this.#metrics.revokeCalls,
      activeFetches: this.#metrics.activeFetches,
      maxConcurrentFetches: this.#metrics.maxConcurrentFetches
    };
  }

  eventCount(providerCalendarId: string): number { return this.#calendar(providerCalendarId).events.size; }
  isRevoked(): boolean { return this.#revoked; }
  failOnceAfterCommit(commandId: string) { this.#failAfterCommitOnce.add(commandId); }
  expireCursor(cursor: string) { this.#expiredCursors.add(cursor); }
  failRevocation(value = true) { this.#failRevocation = value; }
  failNextFetch(error: Error) { this.#nextFetchFailure = error; }
  returnWrongIdOnNextRead(providerEventId: string) { this.#nextReadbackProviderEventId = providerEventId; }
  holdNextFetch(): () => void {
    if (this.#nextFetchGate) throw new Error("A fake fetch is already held.");
    this.#nextFetchGate = new Promise<void>((resolve) => { this.#releaseNextFetch = resolve; });
    return () => { this.#releaseNextFetch?.(); this.#releaseNextFetch = null; };
  }
  holdNextCreate(): () => void {
    if (this.#nextCreateGate) throw new Error("A fake create is already held.");
    this.#nextCreateGate = new Promise<void>((resolve) => { this.#releaseNextCreate = resolve; });
    return () => { this.#releaseNextCreate?.(); this.#releaseNextCreate = null; };
  }

  async discover(): Promise<CalendarProviderDiscovery> {
    this.#assertActive();
    this.#metrics.discoveryCalls++;
    return {
      providerKey: this.providerKey,
      providerAccountId: this.providerAccountId,
      calendars: [...this.#calendars.values()].map(({ definition }) => ({
        providerCalendarId: definition.providerCalendarId,
        displayName: definition.displayName,
        capabilities: { ...definition.capabilities }
      }))
    };
  }

  async fetchChanges(input: {
    providerAccountId: string;
    providerCalendarId: string;
    syncCursor: string | null;
    window: CalendarProviderWindow;
    maxEvents: number;
  }): Promise<CalendarProviderSyncBatch> {
    this.#assertActive();
    this.#assertAccount(input.providerAccountId);
    this.#metrics.fetchCalls.push({ ...input, window: { ...input.window } });
    this.#metrics.activeFetches++;
    this.#metrics.maxConcurrentFetches = Math.max(this.#metrics.maxConcurrentFetches, this.#metrics.activeFetches);
    try {
      const gate = this.#nextFetchGate;
      this.#nextFetchGate = null;
      if (gate) await gate;
      const failure = this.#nextFetchFailure;
      this.#nextFetchFailure = null;
      if (failure) throw failure;
      const calendar = this.#calendar(input.providerCalendarId);
      if (input.syncCursor && this.#expiredCursors.has(input.syncCursor)) throw new ProviderCursorExpiredError();
      if (!input.syncCursor) {
        const current = [...calendar.events.values()]
          .filter((event) => overlaps(event.content, input.window))
          .sort((left, right) => left.providerEventId.localeCompare(right.providerEventId));
        return {
          upserts: current.slice(0, input.maxEvents).map(cloneSnapshot),
          deletions: [],
          nextSyncCursor: cursor(calendar.sequence),
          completeWindowSnapshot: current.length <= input.maxEvents,
          truncated: current.length > input.maxEvents
        };
      }
      const after = parseCursor(input.syncCursor);
      const changes = calendar.changes.filter((change) => change.sequence > after);
      const limited = changes.slice(0, input.maxEvents);
      return {
        upserts: limited
          .filter((change): change is Extract<Change, { kind: "upsert" }> => change.kind === "upsert")
          .map((change) => cloneSnapshot(change.event)),
        deletions: limited
          .filter((change): change is Extract<Change, { kind: "delete" }> => change.kind === "delete")
          .map((change) => ({ providerEventId: change.providerEventId, providerRevision: change.providerRevision })),
        nextSyncCursor: cursor(calendar.sequence),
        completeWindowSnapshot: false,
        truncated: changes.length > input.maxEvents
      };
    } finally {
      this.#metrics.activeFetches--;
    }
  }

  async readEvent(input: {
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
  }): Promise<ProviderEventSnapshot | null> {
    this.#assertActive();
    this.#assertAccount(input.providerAccountId);
    const event = this.#calendar(input.providerCalendarId).events.get(input.providerEventId);
    if (!event) return null;
    const result = cloneSnapshot(event);
    if (this.#nextReadbackProviderEventId) {
      result.providerEventId = this.#nextReadbackProviderEventId;
      this.#nextReadbackProviderEventId = null;
    }
    return result;
  }

  async createEvent(input: {
    providerAccountId: string;
    providerCalendarId: string;
    commandId: string;
    content: ProviderEventContent;
  }): Promise<{ providerEventId: string }> {
    this.#assertActive();
    this.#assertAccount(input.providerAccountId);
    this.#metrics.commandAttempts.create++;
    const gate = this.#nextCreateGate;
    this.#nextCreateGate = null;
    if (gate) await gate;
    const fingerprint = fingerprintOf({
      kind: "create",
      providerAccountId: input.providerAccountId,
      providerCalendarId: input.providerCalendarId,
      content: input.content
    });
    const receipt = this.#receipt(input.commandId, fingerprint, "create");
    if (receipt) return { providerEventId: receipt.providerEventId };
    const calendar = this.#calendar(input.providerCalendarId);
    let providerEventId: string;
    do providerEventId = `fake-event-${++this.#eventCounter}`;
    while (calendar.events.has(providerEventId));
    const event: ProviderEventSnapshot = {
      providerEventId,
      providerRevision: this.#nextRevision(),
      content: cloneContent(input.content)
    };
    calendar.events.set(providerEventId, event);
    this.#record(calendar, { kind: "upsert", event });
    this.#receipts.set(input.commandId, { fingerprint, kind: "create", providerEventId });
    this.#metrics.commandApplies.create++;
    this.#maybeFailAfterCommit(input.commandId);
    return { providerEventId };
  }

  async updateEvent(input: {
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
    content: ProviderEventContent;
  }): Promise<void> {
    this.#assertActive();
    this.#assertAccount(input.providerAccountId);
    this.#metrics.commandAttempts.update++;
    const fingerprint = fingerprintOf({
      kind: "update",
      providerAccountId: input.providerAccountId,
      providerCalendarId: input.providerCalendarId,
      providerEventId: input.providerEventId,
      expectedProviderRevision: input.expectedProviderRevision,
      content: input.content
    });
    if (this.#receipt(input.commandId, fingerprint, "update")) return;
    const calendar = this.#calendar(input.providerCalendarId);
    const current = calendar.events.get(input.providerEventId);
    if (!current || current.providerRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(current?.providerRevision ?? null);
    }
    const event: ProviderEventSnapshot = {
      providerEventId: current.providerEventId,
      providerRevision: this.#nextRevision(),
      content: cloneContent(input.content)
    };
    calendar.events.set(event.providerEventId, event);
    this.#record(calendar, { kind: "upsert", event });
    this.#receipts.set(input.commandId, { fingerprint, kind: "update" });
    this.#metrics.commandApplies.update++;
    this.#maybeFailAfterCommit(input.commandId);
  }

  async deleteEvent(input: {
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
  }): Promise<void> {
    this.#assertActive();
    this.#assertAccount(input.providerAccountId);
    this.#metrics.commandAttempts.delete++;
    const fingerprint = fingerprintOf({
      kind: "delete",
      providerAccountId: input.providerAccountId,
      providerCalendarId: input.providerCalendarId,
      providerEventId: input.providerEventId,
      expectedProviderRevision: input.expectedProviderRevision
    });
    if (this.#receipt(input.commandId, fingerprint, "delete")) return;
    const calendar = this.#calendar(input.providerCalendarId);
    const current = calendar.events.get(input.providerEventId);
    if (!current || current.providerRevision !== input.expectedProviderRevision) {
      throw new ProviderRevisionConflictError(current?.providerRevision ?? null);
    }
    calendar.events.delete(input.providerEventId);
    this.#record(calendar, {
      kind: "delete",
      providerEventId: input.providerEventId,
      providerRevision: current.providerRevision
    });
    this.#receipts.set(input.commandId, { fingerprint, kind: "delete" });
    this.#metrics.commandApplies.delete++;
    this.#maybeFailAfterCommit(input.commandId);
  }

  async revokeConnection(input: { providerAccountId: string }): Promise<void> {
    this.#assertAccount(input.providerAccountId);
    this.#metrics.revokeCalls++;
    if (this.#failRevocation) throw new ProviderTransientError("Deterministic remote revocation failure.");
    this.#revoked = true;
  }

  externalCreate(providerCalendarId: string, providerEventId: string, content: ProviderEventContent): ProviderEventSnapshot {
    const calendar = this.#calendar(providerCalendarId);
    if (calendar.events.has(providerEventId)) throw new Error("The fake provider event already exists.");
    const event = { providerEventId, providerRevision: this.#nextRevision(), content: cloneContent(content) };
    calendar.events.set(providerEventId, event);
    this.#record(calendar, { kind: "upsert", event });
    return cloneSnapshot(event);
  }

  externalUpdate(providerCalendarId: string, providerEventId: string, content: ProviderEventContent): ProviderEventSnapshot {
    const calendar = this.#calendar(providerCalendarId);
    if (!calendar.events.has(providerEventId)) throw new Error("The fake provider event does not exist.");
    const event = { providerEventId, providerRevision: this.#nextRevision(), content: cloneContent(content) };
    calendar.events.set(providerEventId, event);
    this.#record(calendar, { kind: "upsert", event });
    return cloneSnapshot(event);
  }

  externalDelete(providerCalendarId: string, providerEventId: string): ProviderEventSnapshot {
    const calendar = this.#calendar(providerCalendarId);
    const current = calendar.events.get(providerEventId);
    if (!current) throw new Error("The fake provider event does not exist.");
    calendar.events.delete(providerEventId);
    this.#record(calendar, { kind: "delete", providerEventId, providerRevision: current.providerRevision });
    return cloneSnapshot(current);
  }

  injectStaleUpsert(providerCalendarId: string, event: ProviderEventSnapshot) {
    this.#record(this.#calendar(providerCalendarId), { kind: "upsert", event: cloneSnapshot(event) });
  }

  #calendar(providerCalendarId: string): FakeCalendarState {
    const calendar = this.#calendars.get(providerCalendarId);
    if (!calendar) throw new Error("Unknown fake provider calendar.");
    return calendar;
  }

  #assertAccount(providerAccountId: string) {
    if (providerAccountId !== this.providerAccountId) throw new Error("Fake provider account identity mismatch.");
  }

  #assertActive() {
    if (this.#revoked) throw new Error("Fake provider credential authorization was revoked.");
  }

  #nextRevision(): string { return `r${++this.#revisionCounter}`; }

  #record(calendar: FakeCalendarState, change: ChangeInput) {
    calendar.sequence++;
    calendar.changes.push({ ...change, sequence: calendar.sequence } as Change);
  }

  #receipt(commandId: string, fingerprint: string, kind: "create"): Extract<CommandReceipt, { kind: "create" }> | null;
  #receipt(commandId: string, fingerprint: string, kind: "update" | "delete"): Extract<CommandReceipt, { kind: "update" | "delete" }> | null;
  #receipt(commandId: string, fingerprint: string, kind: CommandReceipt["kind"]): CommandReceipt | null {
    const receipt = this.#receipts.get(commandId);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint || receipt.kind !== kind) throw new Error("Fake provider command identity conflict.");
    return receipt;
  }

  #maybeFailAfterCommit(commandId: string) {
    if (this.#failAfterCommitOnce.has(commandId) && !this.#failedAfterCommit.has(commandId)) {
      this.#failedAfterCommit.add(commandId);
      throw new ProviderTransientError("Deterministic failure after the provider committed the command.");
    }
  }
}

function cloneContent(content: ProviderEventContent): ProviderEventContent {
  return { ...content, span: { ...content.span } };
}
function cloneSnapshot(snapshot: ProviderEventSnapshot): ProviderEventSnapshot {
  return { ...snapshot, content: cloneContent(snapshot.content) };
}
function cursor(sequence: number): string { return `fake-cursor:${sequence}`; }
function parseCursor(value: string): number {
  const match = /^fake-cursor:(\d+)$/.exec(value);
  if (!match) throw new ProviderCursorExpiredError();
  return Number(match[1]);
}
function revisionNumber(value: string): number {
  const match = /^r(\d+)$/.exec(value);
  return match ? Number(match[1]) : 0;
}
function overlaps(content: ProviderEventContent, window: CalendarProviderWindow): boolean {
  const windowStart = Date.parse(window.startUtc);
  const windowEnd = Date.parse(window.endUtc);
  if (content.span.kind === "timed") {
    return Date.parse(content.span.startUtc) < windowEnd && Date.parse(content.span.endUtc) > windowStart;
  }
  return Date.parse(`${content.span.startDate}T00:00:00.000Z`) < windowEnd &&
    Date.parse(`${content.span.endDateExclusive}T00:00:00.000Z`) > windowStart;
}
function fingerprintOf(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}
