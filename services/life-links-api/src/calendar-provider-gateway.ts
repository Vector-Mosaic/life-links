import { createHash, randomUUID } from "node:crypto";

import {
  createCanonicalExternalCalendar,
  normalizeCalendarId,
  type CalendarRecord
} from "@life-links/core";

/**
 * Server-only reference to a credential-vault record. Provider adapters may
 * use the handle with their injected vault client, but gateway results never
 * include it. This is deliberately not an OAuth token or refresh token.
 */
declare const calendarProviderCredentialHandleBrand: unique symbol;
export type CalendarProviderCredentialHandle = string & {
  readonly [calendarProviderCredentialHandleBrand]: true;
};

export function calendarProviderCredentialHandle(vaultRecordId: string): CalendarProviderCredentialHandle {
  const value = vaultRecordId.trim();
  if (!value || value.length > 256) {
    throw new CalendarProviderGatewayError("invalid_credential_handle", "A bounded credential-vault handle is required.");
  }
  return value as CalendarProviderCredentialHandle;
}

export type CalendarProviderKey = string;
export type CalendarAgentGrant = "none" | "read" | "write";
export type CalendarProviderConnectionStatus = "provisioning" | "active" | "disconnected";
export type CalendarProviderRevocationStatus = "not_required" | "pending" | "succeeded" | "failed";

export type CalendarProviderCapabilities = {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type ProviderAccountIdentity = {
  providerKey: CalendarProviderKey;
  providerAccountId: string;
};

export type CalendarProviderConnectionRecord = ProviderAccountIdentity & {
  ownerId: string;
  connectionId: string;
  status: CalendarProviderConnectionStatus;
  credentialHandle: CalendarProviderCredentialHandle | null;
  connectedAt: string;
  disconnectedAt: string | null;
  remoteRevocationStatus: CalendarProviderRevocationStatus;
  remoteRevocationAttemptedAt: string | null;
  remoteRevocationErrorCode: "provider_revoke_failed" | null;
};

export type CalendarProviderConnectionView = Omit<CalendarProviderConnectionRecord, "credentialHandle">;

/**
 * Provider-specific metadata bound to one canonical Life Links Calendar.
 * `calendarId` is the canonical Calendar identity; this is deliberately not
 * another application Calendar record or title/time-zone authority.
 */
export type CalendarProviderBindingRecord = ProviderAccountIdentity & {
  ownerId: string;
  connectionId: string;
  calendarId: string;
  providerCalendarId: string;
  providerDisplayName: string;
  capabilities: CalendarProviderCapabilities;
  agentGrant: CalendarAgentGrant;
  visible: boolean;
};

export type CalendarProviderSelection = {
  calendarId: string;
  providerCalendarId: string;
  title: string;
  color: string;
  timeZone: string;
  isDefault: boolean;
  visible?: boolean;
  agentGrant?: CalendarAgentGrant;
};

export type ProviderTimedEventSpan = {
  kind: "timed";
  startUtc: string;
  endUtc: string;
  sourceTimeZone: string | null;
  floatingLocalStart: string | null;
  floatingLocalEnd: string | null;
};

export type ProviderAllDayEventSpan = {
  kind: "all_day";
  startDate: string;
  endDateExclusive: string;
};

export type ProviderEventSpan = ProviderTimedEventSpan | ProviderAllDayEventSpan;

export type ProviderEventContent = {
  title: string;
  description: string | null;
  location: string | null;
  span: ProviderEventSpan;
  providerSeriesId: string | null;
  status: "confirmed" | "tentative" | "canceled";
};

export type ProviderEventSnapshot = {
  providerEventId: string;
  providerRevision: string;
  content: ProviderEventContent;
  /**
   * An adapter may set this only after an authoritative provider read proves
   * that an event deleted at the named revision was deliberately restored.
   */
  revivesProviderRevision?: string;
};

export type CalendarProviderEventProjection = ProviderAccountIdentity & {
  ownerId: string;
  connectionId: string;
  calendarId: string;
  providerCalendarId: string;
  providerEventId: string;
  providerRevision: string;
  content: ProviderEventContent;
  synchronizedAt: string;
};

export type CalendarProviderEventTombstone = ProviderAccountIdentity & {
  ownerId: string;
  connectionId: string;
  calendarId: string;
  providerCalendarId: string;
  providerEventId: string;
  deletedProviderRevision: string;
  deletedAt: string;
  cause: "provider_delta" | "expired_cursor_recovery_missing" | "life_links_command";
};

export type CalendarProviderWindow = {
  startUtc: string;
  endUtc: string;
};

export type CalendarProviderSyncState = {
  connectionId: string;
  calendarId: string;
  syncCursor: string | null;
  lastReconciledAt: string | null;
  lastRecoveryAt: string | null;
};

export type CalendarProviderSyncBatch = {
  upserts: ProviderEventSnapshot[];
  deletions: Array<{ providerEventId: string; providerRevision: string }>;
  nextSyncCursor: string;
  /** Initial and recovery reads must be complete for the requested window. */
  completeWindowSnapshot: boolean;
  truncated: boolean;
};

export type CalendarProviderDiscoveredCalendar = {
  providerCalendarId: string;
  displayName: string;
  capabilities: CalendarProviderCapabilities;
};

export type CalendarProviderDiscovery = ProviderAccountIdentity & {
  calendars: CalendarProviderDiscoveredCalendar[];
};

export type CalendarProviderAdapter = {
  readonly providerKey: CalendarProviderKey;
  discover(input: { credentialHandle: CalendarProviderCredentialHandle }): Promise<CalendarProviderDiscovery>;
  fetchChanges(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    syncCursor: string | null;
    window: CalendarProviderWindow;
    maxEvents: number;
  }): Promise<CalendarProviderSyncBatch>;
  readEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
  }): Promise<ProviderEventSnapshot | null>;
  createEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    commandId: string;
    content: ProviderEventContent;
  }): Promise<{ providerEventId: string }>;
  updateEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
    content: ProviderEventContent;
  }): Promise<void>;
  deleteEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
  }): Promise<void>;
  revokeConnection(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
  }): Promise<void>;
};

export class ProviderCursorExpiredError extends Error {
  constructor() {
    super("The provider synchronization cursor expired.");
    this.name = "ProviderCursorExpiredError";
  }
}

export class ProviderRevisionConflictError extends Error {
  constructor(readonly currentProviderRevision: string | null) {
    super("The provider event revision no longer matches.");
    this.name = "ProviderRevisionConflictError";
  }
}

export class ProviderTransientError extends Error {
  constructor(message = "The provider operation did not complete reliably.") {
    super(message);
    this.name = "ProviderTransientError";
  }
}

export type CalendarProviderCommand =
  | {
      kind: "create";
      commandId: string;
      ownerId: string;
      connectionId: string;
      calendarId: string;
      actor: "owner" | "agent";
      content: ProviderEventContent;
    }
  | {
      kind: "update";
      commandId: string;
      ownerId: string;
      connectionId: string;
      calendarId: string;
      actor: "owner" | "agent";
      providerEventId: string;
      expectedProviderRevision: string;
      content: ProviderEventContent;
    }
  | {
      kind: "delete";
      commandId: string;
      ownerId: string;
      connectionId: string;
      calendarId: string;
      actor: "owner" | "agent";
      providerEventId: string;
      expectedProviderRevision: string;
    };

export type CalendarProviderCommandResult =
  | { kind: "create" | "update"; event: CalendarProviderEventProjection }
  | { kind: "delete"; providerEventId: string; deletedProviderRevision: string };

export type CalendarProviderOutboxRecord = {
  commandId: string;
  fingerprint: string;
  command: CalendarProviderCommand;
  status: "pending" | "processing" | "succeeded" | "conflict";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: "provider_transient" | "provider_unknown" | null;
  result: CalendarProviderCommandResult | null;
  conflictRevision: string | null;
};

export type CalendarProviderWebhookHint = {
  hintId: string;
  ownerId: string;
  connectionId: string;
  providerAccountId: string;
  providerCalendarId: string | null;
  receivedAt: string;
  status: "pending" | "reconciled";
  reconciledAt: string | null;
};

export type CalendarProviderSyncMutation = {
  connectionId: string;
  calendarId: string;
  expectedState: CalendarProviderSyncState | null;
  upserts: CalendarProviderEventProjection[];
  tombstones: CalendarProviderEventTombstone[];
  removedProviderEventIds: string[];
  state: CalendarProviderSyncState;
};

/**
 * Persistence port for the provider boundary. A durable implementation must
 * create a canonical external Calendar and its provider binding in one
 * transaction, roll incomplete provisioning back only after local closure,
 * make reserveOutbox/claimOutbox atomic by commandId, enforce lease ownership
 * on completion, and applySyncMutation transactionally with its expected-state
 * CAS, cursor, projections, and tombstones.
 */
export interface CalendarProviderStateStore {
  getConnection(connectionId: string): Promise<CalendarProviderConnectionRecord | null>;
  saveConnection(connection: CalendarProviderConnectionRecord): Promise<void>;
  listCalendars(connectionId: string): Promise<CalendarProviderBindingRecord[]>;
  getCalendar(connectionId: string, calendarId: string): Promise<CalendarProviderBindingRecord | null>;
  provisionCalendar(calendar: CalendarRecord, binding: CalendarProviderBindingRecord): Promise<void>;
  updateCalendarBinding(calendar: CalendarProviderBindingRecord): Promise<void>;
  rollbackProvisioning(connectionId: string): Promise<void>;
  getSyncState(connectionId: string, calendarId: string): Promise<CalendarProviderSyncState | null>;
  listProjections(connectionId: string, calendarId: string): Promise<CalendarProviderEventProjection[]>;
  getProjection(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventProjection | null>;
  getTombstone(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventTombstone | null>;
  applySyncMutation(mutation: CalendarProviderSyncMutation): Promise<void>;
  reserveOutbox(record: CalendarProviderOutboxRecord): Promise<{ record: CalendarProviderOutboxRecord; created: boolean }>;
  claimOutbox(input: {
    commandId: string;
    fingerprint: string;
    leaseOwner: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }): Promise<{ record: CalendarProviderOutboxRecord; claimed: boolean }>;
  saveOutbox(record: CalendarProviderOutboxRecord, expectedLeaseOwner: string): Promise<boolean>;
  getOutbox(commandId: string): Promise<CalendarProviderOutboxRecord | null>;
  reserveWebhookHint(hint: CalendarProviderWebhookHint): Promise<{ hint: CalendarProviderWebhookHint; created: boolean }>;
  saveWebhookHint(hint: CalendarProviderWebhookHint): Promise<void>;
  getWebhookHint(hintId: string): Promise<CalendarProviderWebhookHint | null>;
  purgeConnectionProjections(connectionId: string): Promise<void>;
}

export class CalendarProviderGatewayError extends Error {
  constructor(
    readonly code:
      | "invalid_credential_handle"
      | "invalid_input"
      | "provider_not_registered"
      | "provider_identity_mismatch"
      | "connection_not_found"
      | "connection_inactive"
      | "calendar_not_found"
      | "calendar_read_only"
      | "agent_calendar_access_denied"
      | "provider_batch_incomplete"
      | "sync_state_conflict"
      | "idempotency_conflict"
      | "command_in_progress"
      | "provider_retry_later"
      | "outbox_lease_lost"
      | "provider_revision_conflict"
      | "provider_readback_failed"
      | "webhook_hint_not_found",
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CalendarProviderGatewayError";
  }
}

export type CalendarProviderGatewayOptions = {
  now?: () => Date;
  maxInitialWindowDays?: number;
  maxEventsPerSync?: number;
  outboxLeaseMs?: number;
  outboxRetryBaseMs?: number;
  outboxRetryMaxMs?: number;
};

export class CalendarProviderGateway {
  readonly #adapters: Map<CalendarProviderKey, CalendarProviderAdapter>;
  readonly #now: () => Date;
  readonly #maxInitialWindowDays: number;
  readonly #maxEventsPerSync: number;
  readonly #outboxLeaseMs: number;
  readonly #outboxRetryBaseMs: number;
  readonly #outboxRetryMaxMs: number;
  readonly #syncFlights = new Map<string, Promise<unknown>>();

  constructor(
    adapters: CalendarProviderAdapter[],
    readonly store: CalendarProviderStateStore,
    options: CalendarProviderGatewayOptions = {}
  ) {
    this.#adapters = new Map();
    for (const adapter of adapters) {
      if (!adapter.providerKey || this.#adapters.has(adapter.providerKey)) {
        throw new CalendarProviderGatewayError("invalid_input", "Provider adapter keys must be non-empty and unique.");
      }
      this.#adapters.set(adapter.providerKey, adapter);
    }
    this.#now = options.now ?? (() => new Date());
    this.#maxInitialWindowDays = options.maxInitialWindowDays ?? 366;
    this.#maxEventsPerSync = options.maxEventsPerSync ?? 2_000;
    this.#outboxLeaseMs = options.outboxLeaseMs ?? 30_000;
    this.#outboxRetryBaseMs = options.outboxRetryBaseMs ?? 1_000;
    this.#outboxRetryMaxMs = options.outboxRetryMaxMs ?? 60_000;
    if (this.#outboxLeaseMs <= 0 || this.#outboxRetryBaseMs <= 0 || this.#outboxRetryMaxMs < this.#outboxRetryBaseMs) {
      throw new CalendarProviderGatewayError("invalid_input", "Outbox lease and retry bounds must be positive and ordered.");
    }
  }

  async connectExternalAccount(input: {
    ownerId: string;
    connectionId: string;
    providerKey: string;
    expectedProviderAccountId: string;
    credentialHandle: CalendarProviderCredentialHandle;
    calendars: CalendarProviderSelection[];
    initialWindow: CalendarProviderWindow;
  }): Promise<{ connection: CalendarProviderConnectionView; calendars: CalendarProviderBindingRecord[] }> {
    assertIdentifier(input.ownerId, "ownerId");
    assertIdentifier(input.connectionId, "connectionId");
    assertIdentifier(input.expectedProviderAccountId, "expectedProviderAccountId");
    const initialWindow = normalizeWindow(input.initialWindow, this.#maxInitialWindowDays);
    if (!input.calendars.length) {
      throw new CalendarProviderGatewayError("invalid_input", "At least one exact provider calendar must be selected.");
    }
    const connectedAt = this.#now().toISOString();
    const selections = input.calendars.map((selection) =>
      normalizeCalendarSelection(selection, input.ownerId, connectedAt)
    );
    const seenLocal = new Set<string>();
    const seenProvider = new Set<string>();
    for (const selection of selections) {
      if (seenLocal.has(selection.calendar.id) || seenProvider.has(selection.providerCalendarId)) {
        throw new CalendarProviderGatewayError("invalid_input", "Calendar identities must be unique within a connection.");
      }
      seenLocal.add(selection.calendar.id);
      seenProvider.add(selection.providerCalendarId);
    }
    const adapter = this.#adapter(input.providerKey);
    const discovery = normalizeDiscovery(await adapter.discover({ credentialHandle: input.credentialHandle }));
    if (discovery.providerKey !== input.providerKey || discovery.providerAccountId !== input.expectedProviderAccountId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The authorized provider account did not match the selected account.");
    }
    const existing = await this.store.getConnection(input.connectionId);
    if (existing) {
      throw new CalendarProviderGatewayError("invalid_input", "The connection identity is already in use.");
    }
    const discovered = new Map(discovery.calendars.map((calendar) => [calendar.providerCalendarId, calendar]));
    const calendars: CalendarProviderBindingRecord[] = [];
    for (const selection of selections) {
      const remote = discovered.get(selection.providerCalendarId);
      if (!remote) {
        throw new CalendarProviderGatewayError("provider_identity_mismatch", "A selected calendar was not discovered in the authorized account.");
      }
      assertAgentGrant(selection.agentGrant, remote.capabilities);
      calendars.push({
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        providerKey: input.providerKey,
        providerAccountId: discovery.providerAccountId,
        calendarId: selection.calendar.id,
        providerCalendarId: selection.providerCalendarId,
        providerDisplayName: remote.displayName,
        capabilities: { ...remote.capabilities },
        agentGrant: selection.agentGrant,
        visible: selection.visible
      });
    }
    let connection: CalendarProviderConnectionRecord = {
      ownerId: input.ownerId,
      connectionId: input.connectionId,
      providerKey: input.providerKey,
      providerAccountId: discovery.providerAccountId,
      status: "provisioning",
      credentialHandle: input.credentialHandle,
      connectedAt,
      disconnectedAt: null,
      remoteRevocationStatus: "not_required",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    };
    await this.store.saveConnection(connection);
    try {
      for (let index = 0; index < calendars.length; index += 1) {
        await this.store.provisionCalendar(selections[index].calendar, calendars[index]);
      }
      for (const calendar of calendars) {
        await this.synchronizeCalendar({
          ownerId: input.ownerId,
          connectionId: input.connectionId,
          calendarId: calendar.calendarId,
          window: initialWindow,
          allowProvisioning: true
        });
      }
      connection = { ...connection, status: "active" };
      await this.store.saveConnection(connection);
    } catch (error) {
      const locallyClosed = await this.#closeConnectionLocally(connection, "retain_private_stale");
      try {
        await this.store.rollbackProvisioning(connection.connectionId);
      } finally {
        await this.#attemptRemoteRevocation(locallyClosed);
      }
      throw error;
    }
    return { connection: safeConnection(connection), calendars: calendars.map(cloneCalendar) };
  }

  async getConnection(ownerId: string, connectionId: string): Promise<CalendarProviderConnectionView> {
    return safeConnection(await this.#ownedConnection(ownerId, connectionId, true));
  }

  async listCalendars(
    ownerId: string,
    connectionId: string,
    actor: "owner" | "agent" = "owner"
  ): Promise<CalendarProviderBindingRecord[]> {
    assertActor(actor);
    await this.#ownedConnection(ownerId, connectionId, false);
    const calendars = await this.store.listCalendars(connectionId);
    return calendars
      .filter((calendar) => actor === "owner" || calendar.agentGrant === "read" || calendar.agentGrant === "write")
      .map(cloneCalendar);
  }

  async setCalendarAgentGrant(input: {
    ownerId: string;
    connectionId: string;
    calendarId: string;
    agentGrant: CalendarAgentGrant;
  }): Promise<CalendarProviderBindingRecord> {
    const calendarId = canonicalCalendarId(input.calendarId);
    const { calendar } = await this.#ownedCalendar(
      input.ownerId,
      input.connectionId,
      calendarId,
      "read",
      "owner",
      false
    );
    const agentGrant = normalizeAgentGrant(input.agentGrant);
    assertAgentGrant(agentGrant, calendar.capabilities);
    const changed = { ...calendar, agentGrant };
    await this.store.updateCalendarBinding(changed);
    return cloneCalendar(changed);
  }

  async listProjections(
    ownerId: string,
    connectionId: string,
    calendarId: string,
    actor: "owner" | "agent" = "owner"
  ): Promise<CalendarProviderEventProjection[]> {
    assertActor(actor);
    calendarId = canonicalCalendarId(calendarId);
    await this.#ownedCalendar(ownerId, connectionId, calendarId, "read", actor, false);
    return (await this.store.listProjections(connectionId, calendarId)).map(cloneProjection);
  }

  async getProjection(
    ownerId: string,
    connectionId: string,
    calendarId: string,
    providerEventId: string,
    actor: "owner" | "agent" = "owner"
  ): Promise<CalendarProviderEventProjection | null> {
    assertActor(actor);
    calendarId = canonicalCalendarId(calendarId);
    assertIdentifier(providerEventId, "providerEventId");
    await this.#ownedCalendar(ownerId, connectionId, calendarId, "read", actor, false);
    const projection = await this.store.getProjection(connectionId, calendarId, providerEventId);
    return projection ? cloneProjection(projection) : null;
  }

  async synchronizeCalendar(input: {
    ownerId: string;
    connectionId: string;
    calendarId: string;
    window: CalendarProviderWindow;
    allowProvisioning?: boolean;
  }): Promise<{ recoveredExpiredCursor: boolean; upserted: number; deleted: number; cursor: string }> {
    const normalizedInput = {
      ...input,
      calendarId: canonicalCalendarId(input.calendarId),
      window: normalizeWindow(input.window, this.#maxInitialWindowDays)
    };
    const key = calendarKey(normalizedInput.connectionId, normalizedInput.calendarId);
    const previous = this.#syncFlights.get(key) ?? Promise.resolve();
    const flight = previous
      .catch(() => undefined)
      .then(() => this.#synchronizeCalendarOnce(normalizedInput));
    this.#syncFlights.set(key, flight);
    try {
      return await flight;
    } finally {
      if (this.#syncFlights.get(key) === flight) this.#syncFlights.delete(key);
    }
  }

  async #synchronizeCalendarOnce(input: {
    ownerId: string;
    connectionId: string;
    calendarId: string;
    window: CalendarProviderWindow;
    allowProvisioning?: boolean;
  }): Promise<{ recoveredExpiredCursor: boolean; upserted: number; deleted: number; cursor: string }> {
    const { connection, calendar } = await this.#ownedCalendar(
      input.ownerId,
      input.connectionId,
      input.calendarId,
      "read",
      "owner",
      input.allowProvisioning ?? false
    );
    const adapter = this.#adapter(connection.providerKey);
    const storedState = await this.store.getSyncState(connection.connectionId, calendar.calendarId);
    const currentState = storedState ?? {
      connectionId: connection.connectionId,
      calendarId: calendar.calendarId,
      syncCursor: null,
      lastReconciledAt: null,
      lastRecoveryAt: null
    };
    let batch: CalendarProviderSyncBatch;
    let recoveredExpiredCursor = false;
    try {
      batch = normalizeSyncBatch(await adapter.fetchChanges({
        credentialHandle: requiredCredential(connection),
        providerAccountId: connection.providerAccountId,
        providerCalendarId: calendar.providerCalendarId,
        syncCursor: currentState.syncCursor,
        window: input.window,
        maxEvents: this.#maxEventsPerSync
      }));
    } catch (error) {
      if (!(error instanceof ProviderCursorExpiredError) || !currentState.syncCursor) throw error;
      recoveredExpiredCursor = true;
      batch = normalizeSyncBatch(await adapter.fetchChanges({
        credentialHandle: requiredCredential(connection),
        providerAccountId: connection.providerAccountId,
        providerCalendarId: calendar.providerCalendarId,
        syncCursor: null,
        window: input.window,
        maxEvents: this.#maxEventsPerSync
      }));
    }
    if (batch.truncated || ((currentState.syncCursor === null || recoveredExpiredCursor) && !batch.completeWindowSnapshot)) {
      throw new CalendarProviderGatewayError(
        "provider_batch_incomplete",
        "The provider did not return a complete bounded synchronization result."
      );
    }
    const now = this.#now().toISOString();
    const upserts: CalendarProviderEventProjection[] = [];
    const tombstones: CalendarProviderEventTombstone[] = [];
    const removed = new Set<string>();
    for (const deletion of batch.deletions) {
      assertIdentifier(deletion.providerEventId, "providerEventId");
      assertIdentifier(deletion.providerRevision, "providerRevision");
      removed.add(deletion.providerEventId);
      tombstones.push(tombstoneFor(connection, calendar, deletion.providerEventId, deletion.providerRevision, now, "provider_delta"));
    }
    const observed = new Set<string>();
    for (const event of batch.upserts) {
      observed.add(event.providerEventId);
      const tombstone = tombstones.find((candidate) => candidate.providerEventId === event.providerEventId) ??
        await this.store.getTombstone(connection.connectionId, calendar.calendarId, event.providerEventId);
      if (tombstone && event.revivesProviderRevision !== tombstone.deletedProviderRevision) {
        continue;
      }
      upserts.push(projectionFor(connection, calendar, event, now));
    }
    if (recoveredExpiredCursor) {
      for (const projection of await this.store.listProjections(connection.connectionId, calendar.calendarId)) {
        if (!eventOverlapsWindow(projection.content.span, input.window) || observed.has(projection.providerEventId) || removed.has(projection.providerEventId)) {
          continue;
        }
        removed.add(projection.providerEventId);
        tombstones.push(tombstoneFor(
          connection,
          calendar,
          projection.providerEventId,
          projection.providerRevision,
          now,
          "expired_cursor_recovery_missing"
        ));
      }
    }
    const state: CalendarProviderSyncState = {
      ...currentState,
      syncCursor: nonEmpty(batch.nextSyncCursor, "nextSyncCursor"),
      lastReconciledAt: now,
      lastRecoveryAt: recoveredExpiredCursor ? now : currentState.lastRecoveryAt
    };
    await this.store.applySyncMutation({
      connectionId: connection.connectionId,
      calendarId: calendar.calendarId,
      expectedState: storedState,
      upserts,
      tombstones,
      removedProviderEventIds: [...removed],
      state
    });
    return {
      recoveredExpiredCursor,
      upserted: upserts.length,
      deleted: removed.size,
      cursor: state.syncCursor!
    };
  }

  async acceptWebhookHint(input: Omit<CalendarProviderWebhookHint, "status" | "reconciledAt">): Promise<CalendarProviderWebhookHint> {
    assertIdentifier(input.hintId, "hintId");
    const connection = await this.#ownedConnection(input.ownerId, input.connectionId, false);
    if (connection.providerAccountId !== input.providerAccountId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The webhook account did not match the connection.");
    }
    if (input.providerCalendarId !== null) {
      const calendars = await this.store.listCalendars(connection.connectionId);
      if (!calendars.some((calendar) => calendar.providerCalendarId === input.providerCalendarId)) {
        throw new CalendarProviderGatewayError("provider_identity_mismatch", "The webhook calendar did not match the connection.");
      }
    }
    const hint: CalendarProviderWebhookHint = {
      ...input,
      receivedAt: normalizeUtcInstant(input.receivedAt, "receivedAt"),
      status: "pending",
      reconciledAt: null
    };
    const reserved = await this.store.reserveWebhookHint(hint);
    if (!reserved.created && hintIdentityFingerprint(reserved.hint) !== hintIdentityFingerprint(hint)) {
      throw new CalendarProviderGatewayError("idempotency_conflict", "The webhook hint identity is bound to another notification.");
    }
    return { ...reserved.hint };
  }

  async reconcileWebhookHint(input: {
    ownerId: string;
    hintId: string;
    window: CalendarProviderWindow;
  }): Promise<{ calendarsReconciled: number }> {
    const hint = await this.store.getWebhookHint(input.hintId);
    if (!hint || hint.ownerId !== input.ownerId) {
      throw new CalendarProviderGatewayError("webhook_hint_not_found", "The webhook hint was not found.");
    }
    if (hint.status === "reconciled") return { calendarsReconciled: 0 };
    const calendars = (await this.store.listCalendars(hint.connectionId)).filter(
      (calendar) => hint.providerCalendarId === null || calendar.providerCalendarId === hint.providerCalendarId
    );
    for (const calendar of calendars) {
      await this.synchronizeCalendar({
        ownerId: input.ownerId,
        connectionId: hint.connectionId,
        calendarId: calendar.calendarId,
        window: input.window
      });
    }
    await this.store.saveWebhookHint({
      ...hint,
      status: "reconciled",
      reconciledAt: this.#now().toISOString()
    });
    return { calendarsReconciled: calendars.length };
  }

  async executeCommand(inputCommand: CalendarProviderCommand): Promise<CalendarProviderCommandResult> {
    const command = normalizeCommand(inputCommand);
    const access = command.kind === "create" ? "create" : command.kind === "update" ? "update" : "delete";
    const { connection, calendar } = await this.#ownedCalendar(
      command.ownerId,
      command.connectionId,
      command.calendarId,
      access,
      command.actor,
      false
    );
    const now = this.#now().toISOString();
    const fingerprint = commandFingerprint(command);
    const reserved = await this.store.reserveOutbox({
      commandId: command.commandId,
      fingerprint,
      command: cloneCommand(command),
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      lastAttemptAt: null,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      result: null,
      conflictRevision: null
    });
    if (!reserved.created && reserved.record.fingerprint !== fingerprint) {
      throw new CalendarProviderGatewayError("idempotency_conflict", "The command identity is bound to different arguments.");
    }
    const leaseOwner = `calendar-outbox-${randomUUID()}`;
    const claimedAt = this.#now().toISOString();
    const claimed = await this.store.claimOutbox({
      commandId: command.commandId,
      fingerprint,
      leaseOwner,
      claimedAt,
      leaseExpiresAt: new Date(Date.parse(claimedAt) + this.#outboxLeaseMs).toISOString()
    });
    if (!claimed.claimed) {
      if (claimed.record.fingerprint !== fingerprint) {
        throw new CalendarProviderGatewayError("idempotency_conflict", "The command identity is bound to different arguments.");
      }
      if (claimed.record.status === "succeeded" && claimed.record.result) return cloneResult(claimed.record.result);
      if (claimed.record.status === "conflict") {
        throw new CalendarProviderGatewayError("provider_revision_conflict", "The command previously conflicted at the provider.", {
          currentProviderRevision: claimed.record.conflictRevision
        });
      }
      if (claimed.record.nextAttemptAt && Date.parse(claimed.record.nextAttemptAt) > Date.parse(claimedAt)) {
        throw new CalendarProviderGatewayError("provider_retry_later", "The provider command is waiting for its bounded retry delay.", {
          nextAttemptAt: claimed.record.nextAttemptAt,
          attempts: claimed.record.attempts
        });
      }
      throw new CalendarProviderGatewayError("command_in_progress", "The same provider command is already being processed.", {
        leaseExpiresAt: claimed.record.leaseExpiresAt,
        attempts: claimed.record.attempts
      });
    }
    let outbox = claimed.record;
    if (outbox.status === "conflict") {
      throw new CalendarProviderGatewayError("provider_revision_conflict", "The command previously conflicted at the provider.", {
        currentProviderRevision: outbox.conflictRevision
      });
    }
    const adapter = this.#adapter(connection.providerKey);
    try {
      let result: CalendarProviderCommandResult;
      if (command.kind === "create") {
        const created = await adapter.createEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          commandId: command.commandId,
          content: cloneContent(command.content)
        });
        if (!isRecord(created)) {
          throw new CalendarProviderGatewayError("provider_readback_failed", "The provider create response has an invalid shape.");
        }
        assertIdentifier(created.providerEventId, "providerEventId");
        const event = await this.#readback(adapter, connection, calendar, created.providerEventId);
        result = { kind: "create", event };
      } else if (command.kind === "update") {
        await adapter.updateEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId,
          commandId: command.commandId,
          expectedProviderRevision: command.expectedProviderRevision,
          content: cloneContent(command.content)
        });
        const event = await this.#readback(adapter, connection, calendar, command.providerEventId);
        result = { kind: "update", event };
      } else {
        await adapter.deleteEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId,
          commandId: command.commandId,
          expectedProviderRevision: command.expectedProviderRevision
        });
        const readback = await adapter.readEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId
        });
        if (readback) {
          throw new CalendarProviderGatewayError("provider_readback_failed", "The provider still returned the deleted event.");
        }
        const deletedAt = this.#now().toISOString();
        const tombstone = tombstoneFor(
          connection,
          calendar,
          command.providerEventId,
          command.expectedProviderRevision,
          deletedAt,
          "life_links_command"
        );
        const storedState = await this.store.getSyncState(connection.connectionId, calendar.calendarId);
        const state = storedState ?? {
          connectionId: connection.connectionId,
          calendarId: calendar.calendarId,
          syncCursor: null,
          lastReconciledAt: null,
          lastRecoveryAt: null
        };
        await this.store.applySyncMutation({
          connectionId: connection.connectionId,
          calendarId: calendar.calendarId,
          expectedState: storedState,
          upserts: [],
          tombstones: [tombstone],
          removedProviderEventIds: [command.providerEventId],
          state
        });
        result = {
          kind: "delete",
          providerEventId: command.providerEventId,
          deletedProviderRevision: command.expectedProviderRevision
        };
      }
      outbox = {
        ...outbox,
        status: "succeeded",
        result: cloneResult(result),
        updatedAt: this.#now().toISOString(),
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null
      };
      if (!await this.store.saveOutbox(outbox, leaseOwner)) {
        throw new CalendarProviderGatewayError("outbox_lease_lost", "Provider command completion lost its outbox lease.");
      }
      return cloneResult(result);
    } catch (error) {
      if (error instanceof ProviderRevisionConflictError) {
        outbox = {
          ...outbox,
          status: "conflict",
          conflictRevision: error.currentProviderRevision,
          updatedAt: this.#now().toISOString(),
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null
        };
        if (!await this.store.saveOutbox(outbox, leaseOwner)) {
          throw new CalendarProviderGatewayError("outbox_lease_lost", "Provider conflict completion lost its outbox lease.");
        }
        throw new CalendarProviderGatewayError("provider_revision_conflict", "The provider event changed before this command was applied.", {
          currentProviderRevision: error.currentProviderRevision
        });
      }
      if (error instanceof CalendarProviderGatewayError && error.code === "outbox_lease_lost") throw error;
      const failedAt = this.#now().toISOString();
      const retryDelayMs = Math.min(
        this.#outboxRetryMaxMs,
        this.#outboxRetryBaseMs * 2 ** Math.min(Math.max(outbox.attempts - 1, 0), 16)
      );
      const pending: CalendarProviderOutboxRecord = {
        ...outbox,
        status: "pending",
        updatedAt: failedAt,
        nextAttemptAt: new Date(Date.parse(failedAt) + retryDelayMs).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: error instanceof ProviderTransientError ? "provider_transient" : "provider_unknown"
      };
      if (!await this.store.saveOutbox(pending, leaseOwner)) {
        throw new CalendarProviderGatewayError("outbox_lease_lost", "Provider command failure lost its outbox lease.");
      }
      throw error;
    }
  }

  async disconnectConnection(input: {
    ownerId: string;
    connectionId: string;
    localProjectionDisposition: "retain_private_stale" | "purge";
  }): Promise<CalendarProviderConnectionView> {
    const connection = await this.#ownedConnection(input.ownerId, input.connectionId, true);
    if (connection.status === "disconnected" && input.localProjectionDisposition === "purge") {
      await this.store.purgeConnectionProjections(connection.connectionId);
    }
    const locallyClosed = connection.status === "disconnected"
      ? connection
      : await this.#closeConnectionLocally(connection, input.localProjectionDisposition);
    const finalConnection = locallyClosed.remoteRevocationStatus === "succeeded"
      ? locallyClosed
      : await this.#attemptRemoteRevocation(locallyClosed);
    return safeConnection(finalConnection);
  }

  async #closeConnectionLocally(
    connection: CalendarProviderConnectionRecord,
    localProjectionDisposition: "retain_private_stale" | "purge"
  ): Promise<CalendarProviderConnectionRecord> {
    const disconnected: CalendarProviderConnectionRecord = {
      ...connection,
      status: "disconnected",
      disconnectedAt: connection.disconnectedAt ?? this.#now().toISOString(),
      remoteRevocationStatus: connection.credentialHandle ? "pending" : "succeeded",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    };
    // Persist the inactive connection first. Even if a later cleanup write or
    // provider call fails, every gateway operation now fails closed.
    await this.store.saveConnection(disconnected);
    for (const calendar of await this.store.listCalendars(connection.connectionId)) {
      await this.store.updateCalendarBinding({ ...calendar, agentGrant: "none", visible: false });
    }
    if (localProjectionDisposition === "purge") {
      await this.store.purgeConnectionProjections(connection.connectionId);
    }
    return disconnected;
  }

  async #attemptRemoteRevocation(connection: CalendarProviderConnectionRecord): Promise<CalendarProviderConnectionRecord> {
    if (!connection.credentialHandle) {
      const succeeded = {
        ...connection,
        remoteRevocationStatus: "succeeded" as const,
        remoteRevocationAttemptedAt: connection.remoteRevocationAttemptedAt ?? this.#now().toISOString(),
        remoteRevocationErrorCode: null
      };
      await this.store.saveConnection(succeeded);
      return succeeded;
    }
    const attemptedAt = this.#now().toISOString();
    try {
      await this.#adapter(connection.providerKey).revokeConnection({
        credentialHandle: connection.credentialHandle,
        providerAccountId: connection.providerAccountId
      });
      const succeeded: CalendarProviderConnectionRecord = {
        ...connection,
        credentialHandle: null,
        remoteRevocationStatus: "succeeded",
        remoteRevocationAttemptedAt: attemptedAt,
        remoteRevocationErrorCode: null
      };
      await this.store.saveConnection(succeeded);
      return succeeded;
    } catch {
      // Retain only the server-side vault handle so an explicit retry can
      // revoke remotely. Local use remains impossible because status is
      // already disconnected and every calendar grant is already removed.
      const failed: CalendarProviderConnectionRecord = {
        ...connection,
        remoteRevocationStatus: "failed",
        remoteRevocationAttemptedAt: attemptedAt,
        remoteRevocationErrorCode: "provider_revoke_failed"
      };
      await this.store.saveConnection(failed);
      return failed;
    }
  }

  async #readback(
    adapter: CalendarProviderAdapter,
    connection: CalendarProviderConnectionRecord,
    calendar: CalendarProviderBindingRecord,
    providerEventId: string
  ): Promise<CalendarProviderEventProjection> {
    const snapshot = await adapter.readEvent({
      credentialHandle: requiredCredential(connection),
      providerAccountId: connection.providerAccountId,
      providerCalendarId: calendar.providerCalendarId,
      providerEventId
    });
    if (!isRecord(snapshot) || snapshot.providerEventId !== providerEventId) {
      throw new CalendarProviderGatewayError("provider_readback_failed", "The provider did not return the committed event.");
    }
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const projection = projectionFor(connection, calendar, normalizedSnapshot, this.#now().toISOString());
    const storedState = await this.store.getSyncState(connection.connectionId, calendar.calendarId);
    const state = storedState ?? {
      connectionId: connection.connectionId,
      calendarId: calendar.calendarId,
      syncCursor: null,
      lastReconciledAt: null,
      lastRecoveryAt: null
    };
    await this.store.applySyncMutation({
      connectionId: connection.connectionId,
      calendarId: calendar.calendarId,
      expectedState: storedState,
      upserts: [projection],
      tombstones: [],
      removedProviderEventIds: [],
      state
    });
    return projection;
  }

  #adapter(providerKey: string): CalendarProviderAdapter {
    const adapter = this.#adapters.get(providerKey);
    if (!adapter) {
      throw new CalendarProviderGatewayError("provider_not_registered", "No qualified adapter is registered for this provider key.");
    }
    return adapter;
  }

  async #ownedConnection(ownerId: string, connectionId: string, allowDisconnected: boolean): Promise<CalendarProviderConnectionRecord> {
    const connection = await this.store.getConnection(connectionId);
    if (!connection || connection.ownerId !== ownerId) {
      throw new CalendarProviderGatewayError("connection_not_found", "The calendar connection was not found.");
    }
    if (!allowDisconnected && connection.status !== "active") {
      throw new CalendarProviderGatewayError("connection_inactive", "The calendar connection is not active.");
    }
    return connection;
  }

  async #ownedCalendar(
    ownerId: string,
    connectionId: string,
    calendarId: string,
    access: "read" | "create" | "update" | "delete",
    actor: "owner" | "agent",
    allowProvisioning: boolean
  ): Promise<{ connection: CalendarProviderConnectionRecord; calendar: CalendarProviderBindingRecord }> {
    const connection = await this.store.getConnection(connectionId);
    if (!connection || connection.ownerId !== ownerId) {
      throw new CalendarProviderGatewayError("connection_not_found", "The calendar connection was not found.");
    }
    if (connection.status !== "active" && !(allowProvisioning && connection.status === "provisioning")) {
      throw new CalendarProviderGatewayError("connection_inactive", "The calendar connection is not active.");
    }
    const calendar = await this.store.getCalendar(connectionId, calendarId);
    if (!calendar || calendar.ownerId !== ownerId) {
      throw new CalendarProviderGatewayError("calendar_not_found", "The exact provider calendar was not found.");
    }
    if (!calendar.capabilities[access]) {
      throw new CalendarProviderGatewayError("calendar_read_only", `The provider calendar does not allow ${access}.`);
    }
    if (actor === "agent") {
      const permitted = access === "read" ? calendar.agentGrant === "read" || calendar.agentGrant === "write" : calendar.agentGrant === "write";
      if (!permitted) {
        throw new CalendarProviderGatewayError("agent_calendar_access_denied", "The connected agent does not have this calendar permission.");
      }
    }
    return { connection, calendar };
  }
}

/** Deterministic non-durable store for adapter qualification and local tests. */
export class InMemoryCalendarProviderStateStore implements CalendarProviderStateStore {
  readonly #connections = new Map<string, CalendarProviderConnectionRecord>();
  readonly #canonicalCalendars = new Map<string, CalendarRecord>();
  readonly #calendars = new Map<string, CalendarProviderBindingRecord>();
  readonly #syncStates = new Map<string, CalendarProviderSyncState>();
  readonly #projections = new Map<string, CalendarProviderEventProjection>();
  readonly #tombstones = new Map<string, CalendarProviderEventTombstone>();
  readonly #outbox = new Map<string, CalendarProviderOutboxRecord>();
  readonly #hints = new Map<string, CalendarProviderWebhookHint>();

  async getConnection(connectionId: string) { return cloneConnection(this.#connections.get(connectionId) ?? null); }
  async saveConnection(connection: CalendarProviderConnectionRecord) { this.#connections.set(connection.connectionId, cloneConnection(connection)!); }
  async listCalendars(connectionId: string) {
    return [...this.#calendars.values()].filter((calendar) => calendar.connectionId === connectionId).map(cloneCalendar);
  }
  async getCalendar(connectionId: string, calendarId: string) {
    return cloneCalendarOrNull(this.#calendars.get(calendarKey(connectionId, calendarId)) ?? null);
  }
  async getCanonicalCalendar(calendarId: string) {
    const calendar = this.#canonicalCalendars.get(calendarId);
    return calendar ? { ...calendar } : null;
  }
  async provisionCalendar(calendar: CalendarRecord, binding: CalendarProviderBindingRecord) {
    assertCalendarProvisioningPair(calendar, binding);
    const connection = this.#connections.get(binding.connectionId);
    if (!connection || connection.status !== "provisioning" || connection.ownerId !== calendar.ownerId
      || connection.providerKey !== binding.providerKey || connection.providerAccountId !== binding.providerAccountId) {
      throw new CalendarProviderGatewayError(
        "provider_identity_mismatch",
        "A canonical external Calendar may only be provisioned by its exact active provisioning connection."
      );
    }
    const key = calendarKey(binding.connectionId, binding.calendarId);
    if (this.#canonicalCalendars.has(calendar.id) || this.#calendars.has(key)
      || [...this.#calendars.values()].some((candidate) => candidate.ownerId === binding.ownerId
        && (candidate.calendarId === binding.calendarId || candidate.providerCalendarId === binding.providerCalendarId))) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The external Calendar identity is already provisioned.");
    }
    if (calendar.isDefault && [...this.#canonicalCalendars.values()].some((candidate) =>
      candidate.ownerId === calendar.ownerId && candidate.isDefault && candidate.deletedAt === null)) {
      throw new CalendarProviderGatewayError("invalid_input", "The owner already has a default Calendar.");
    }
    this.#canonicalCalendars.set(calendar.id, { ...calendar });
    this.#calendars.set(key, cloneCalendar(binding));
  }
  async updateCalendarBinding(calendar: CalendarProviderBindingRecord) {
    const key = calendarKey(calendar.connectionId, calendar.calendarId);
    const existing = this.#calendars.get(key);
    const canonical = this.#canonicalCalendars.get(calendar.calendarId);
    if (!existing || !canonical) {
      throw new CalendarProviderGatewayError("calendar_not_found", "The canonical external Calendar binding was not found.");
    }
    assertCalendarProvisioningPair(canonical, calendar);
    if (existing.ownerId !== calendar.ownerId || existing.providerKey !== calendar.providerKey
      || existing.providerAccountId !== calendar.providerAccountId
      || existing.providerCalendarId !== calendar.providerCalendarId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The provider Calendar binding identity cannot change.");
    }
    this.#calendars.set(key, cloneCalendar(calendar));
  }
  async rollbackProvisioning(connectionId: string) {
    const connection = this.#connections.get(connectionId);
    if (!connection || connection.status !== "disconnected") {
      throw new CalendarProviderGatewayError(
        "connection_inactive",
        "Calendar provisioning can only be rolled back after the connection is closed."
      );
    }
    const bindings = [...this.#calendars.values()].filter((binding) => binding.connectionId === connectionId);
    for (const binding of bindings) {
      const canonical = this.#canonicalCalendars.get(binding.calendarId);
      if (!canonical || canonical.source !== "external" || canonical.ownerId !== binding.ownerId) {
        throw new CalendarProviderGatewayError(
          "provider_identity_mismatch",
          "Calendar provisioning rollback encountered a noncanonical external Calendar."
        );
      }
    }
    await this.purgeConnectionProjections(connectionId);
    for (const binding of bindings) {
      this.#calendars.delete(calendarKey(binding.connectionId, binding.calendarId));
      this.#canonicalCalendars.delete(binding.calendarId);
      this.#syncStates.delete(calendarKey(binding.connectionId, binding.calendarId));
    }
    for (const [key, record] of this.#outbox) {
      if (record.command.connectionId === connectionId) this.#outbox.delete(key);
    }
  }
  async getSyncState(connectionId: string, calendarId: string) {
    const state = this.#syncStates.get(calendarKey(connectionId, calendarId));
    return state ? { ...state } : null;
  }
  async listProjections(connectionId: string, calendarId: string) {
    return [...this.#projections.values()]
      .filter((projection) => projection.connectionId === connectionId && projection.calendarId === calendarId)
      .map(cloneProjection);
  }
  async getProjection(connectionId: string, calendarId: string, providerEventId: string) {
    const projection = this.#projections.get(eventKey(connectionId, calendarId, providerEventId));
    return projection ? cloneProjection(projection) : null;
  }
  async getTombstone(connectionId: string, calendarId: string, providerEventId: string) {
    const tombstone = this.#tombstones.get(eventKey(connectionId, calendarId, providerEventId));
    return tombstone ? { ...tombstone } : null;
  }
  async applySyncMutation(mutation: CalendarProviderSyncMutation) {
    const key = calendarKey(mutation.connectionId, mutation.calendarId);
    const currentState = this.#syncStates.get(key) ?? null;
    if (!syncStateEquals(currentState, mutation.expectedState)) {
      throw new CalendarProviderGatewayError("sync_state_conflict", "Calendar synchronization state changed before commit.", {
        expectedCursor: mutation.expectedState?.syncCursor ?? null,
        currentCursor: currentState?.syncCursor ?? null
      });
    }
    for (const providerEventId of mutation.removedProviderEventIds) {
      this.#projections.delete(eventKey(mutation.connectionId, mutation.calendarId, providerEventId));
    }
    for (const tombstone of mutation.tombstones) {
      this.#tombstones.set(eventKey(tombstone.connectionId, tombstone.calendarId, tombstone.providerEventId), { ...tombstone });
      this.#projections.delete(eventKey(tombstone.connectionId, tombstone.calendarId, tombstone.providerEventId));
    }
    for (const projection of mutation.upserts) {
      this.#projections.set(eventKey(projection.connectionId, projection.calendarId, projection.providerEventId), cloneProjection(projection));
      this.#tombstones.delete(eventKey(projection.connectionId, projection.calendarId, projection.providerEventId));
    }
    this.#syncStates.set(key, { ...mutation.state });
  }
  async reserveOutbox(record: CalendarProviderOutboxRecord) {
    const existing = this.#outbox.get(record.commandId);
    if (existing) return { record: cloneOutbox(existing), created: false };
    this.#outbox.set(record.commandId, cloneOutbox(record));
    return { record: cloneOutbox(record), created: true };
  }
  async claimOutbox(input: {
    commandId: string;
    fingerprint: string;
    leaseOwner: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) {
    const current = this.#outbox.get(input.commandId);
    if (!current) throw new Error("The outbox command must be reserved before it is claimed.");
    if (current.fingerprint !== input.fingerprint || current.status === "succeeded" || current.status === "conflict") {
      return { record: cloneOutbox(current), claimed: false };
    }
    const nowMs = Date.parse(input.claimedAt);
    const leaseActive = current.status === "processing" && current.leaseExpiresAt !== null && Date.parse(current.leaseExpiresAt) > nowMs;
    const retryDelayed = current.nextAttemptAt !== null && Date.parse(current.nextAttemptAt) > nowMs;
    if (leaseActive || retryDelayed) return { record: cloneOutbox(current), claimed: false };
    const claimed: CalendarProviderOutboxRecord = {
      ...current,
      status: "processing",
      attempts: current.attempts + 1,
      updatedAt: input.claimedAt,
      lastAttemptAt: input.claimedAt,
      nextAttemptAt: null,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      lastErrorCode: null
    };
    this.#outbox.set(input.commandId, cloneOutbox(claimed));
    return { record: cloneOutbox(claimed), claimed: true };
  }
  async saveOutbox(record: CalendarProviderOutboxRecord, expectedLeaseOwner: string) {
    const current = this.#outbox.get(record.commandId);
    if (!current || current.status !== "processing" || current.leaseOwner !== expectedLeaseOwner) return false;
    this.#outbox.set(record.commandId, cloneOutbox(record));
    return true;
  }
  async getOutbox(commandId: string) { const record = this.#outbox.get(commandId); return record ? cloneOutbox(record) : null; }
  async reserveWebhookHint(hint: CalendarProviderWebhookHint) {
    const existing = this.#hints.get(hint.hintId);
    if (existing) return { hint: { ...existing }, created: false };
    this.#hints.set(hint.hintId, { ...hint });
    return { hint: { ...hint }, created: true };
  }
  async saveWebhookHint(hint: CalendarProviderWebhookHint) { this.#hints.set(hint.hintId, { ...hint }); }
  async getWebhookHint(hintId: string) { const hint = this.#hints.get(hintId); return hint ? { ...hint } : null; }
  async purgeConnectionProjections(connectionId: string) {
    for (const [key, projection] of this.#projections) if (projection.connectionId === connectionId) this.#projections.delete(key);
    for (const [key, tombstone] of this.#tombstones) if (tombstone.connectionId === connectionId) this.#tombstones.delete(key);
  }
}

export function assertCalendarProvisioningPair(
  calendar: CalendarRecord,
  binding: CalendarProviderBindingRecord
): void {
  let normalized: CalendarRecord;
  try {
    normalized = createCanonicalExternalCalendar({
      id: calendar.id,
      ownerId: calendar.ownerId,
      title: calendar.title,
      color: calendar.color,
      timeZone: calendar.timeZone,
      isDefault: calendar.isDefault,
      createdAt: calendar.createdAt
    });
  } catch {
    throw new CalendarProviderGatewayError("invalid_input", "The canonical external Calendar is invalid.");
  }
  if (calendar.source !== "external" || calendar.deletedAt !== null
    || calendar.updatedAt !== normalized.updatedAt
    || calendar.id !== normalized.id || calendar.ownerId !== normalized.ownerId
    || calendar.title !== normalized.title || calendar.color !== normalized.color
    || calendar.timeZone !== normalized.timeZone || calendar.isDefault !== normalized.isDefault
    || calendar.createdAt !== normalized.createdAt
    || binding.calendarId !== calendar.id || binding.ownerId !== calendar.ownerId) {
    throw new CalendarProviderGatewayError(
      "provider_identity_mismatch",
      "The provider binding must target its exact canonical external Calendar identity."
    );
  }
  assertIdentifier(binding.connectionId, "connectionId");
  assertIdentifier(binding.providerKey, "providerKey");
  assertIdentifier(binding.providerAccountId, "providerAccountId");
  assertIdentifier(binding.providerCalendarId, "providerCalendarId");
  assertBoundedString(binding.providerDisplayName, "providerDisplayName", 1_000);
  const capabilities = normalizeCapabilities(binding.capabilities);
  assertAgentGrant(normalizeAgentGrant(binding.agentGrant), capabilities);
  if (typeof binding.visible !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "Calendar visibility must be boolean.");
  }
}

function safeConnection(connection: CalendarProviderConnectionRecord): CalendarProviderConnectionView {
  const { credentialHandle: _credentialHandle, ...safe } = connection;
  return { ...safe };
}

function requiredCredential(connection: CalendarProviderConnectionRecord): CalendarProviderCredentialHandle {
  if (!connection.credentialHandle) {
    throw new CalendarProviderGatewayError("connection_inactive", "The calendar connection has no active credential authorization.");
  }
  return connection.credentialHandle;
}

function assertAgentGrant(grant: CalendarAgentGrant, capabilities: CalendarProviderCapabilities) {
  if (grant !== "none" && !capabilities.read) {
    throw new CalendarProviderGatewayError("invalid_input", "Agent access cannot exceed provider read capability.");
  }
  if (grant === "write" && !(capabilities.create || capabilities.update || capabilities.delete)) {
    throw new CalendarProviderGatewayError("invalid_input", "Agent write access cannot exceed provider write capability.");
  }
}

function normalizeAgentGrant(value: unknown): CalendarAgentGrant {
  if (value !== "none" && value !== "read" && value !== "write") {
    throw new CalendarProviderGatewayError("invalid_input", "Calendar agent grant is invalid.");
  }
  return value;
}

function normalizeWindow(window: CalendarProviderWindow, maxDays: number): CalendarProviderWindow {
  if (!isRecord(window)) throw new CalendarProviderGatewayError("invalid_input", "A synchronization window is required.");
  const startUtc = normalizeUtcInstant(window.startUtc, "window.startUtc");
  const endUtc = normalizeUtcInstant(window.endUtc, "window.endUtc");
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > maxDays * 86_400_000) {
    throw new CalendarProviderGatewayError("invalid_input", `A positive synchronization window of at most ${maxDays} days is required.`);
  }
  return { startUtc, endUtc };
}

function normalizeDiscovery(input: CalendarProviderDiscovery): CalendarProviderDiscovery {
  if (!isRecord(input) || !Array.isArray(input.calendars)) {
    throw new CalendarProviderGatewayError("invalid_input", "The provider discovery response has an invalid shape.");
  }
  assertIdentifier(input.providerKey, "providerKey");
  assertIdentifier(input.providerAccountId, "providerAccountId");
  const calendars = input.calendars.map((candidate) => {
    if (!isRecord(candidate)) throw new CalendarProviderGatewayError("invalid_input", "A discovered provider calendar has an invalid shape.");
    assertIdentifier(candidate.providerCalendarId, "providerCalendarId");
    assertBoundedString(candidate.displayName, "displayName", 1_000);
    return {
      providerCalendarId: candidate.providerCalendarId,
      displayName: candidate.displayName,
      capabilities: normalizeCapabilities(candidate.capabilities)
    };
  });
  if (new Set(calendars.map((calendar) => calendar.providerCalendarId)).size !== calendars.length) {
    throw new CalendarProviderGatewayError("provider_identity_mismatch", "Provider discovery returned duplicate Calendar identities.");
  }
  return { providerKey: input.providerKey, providerAccountId: input.providerAccountId, calendars };
}

function normalizeSyncBatch(input: CalendarProviderSyncBatch): CalendarProviderSyncBatch {
  if (!isRecord(input) || !Array.isArray(input.upserts) || !Array.isArray(input.deletions) ||
      typeof input.completeWindowSnapshot !== "boolean" || typeof input.truncated !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "The provider synchronization response has an invalid shape.");
  }
  assertIdentifier(input.nextSyncCursor, "nextSyncCursor");
  const deletions = input.deletions.map((candidate) => {
    if (!isRecord(candidate)) throw new CalendarProviderGatewayError("invalid_input", "A provider deletion has an invalid shape.");
    assertIdentifier(candidate.providerEventId, "providerEventId");
    assertIdentifier(candidate.providerRevision, "providerRevision");
    return { providerEventId: candidate.providerEventId, providerRevision: candidate.providerRevision };
  });
  return {
    upserts: input.upserts.map((snapshot) => normalizeSnapshot(snapshot)),
    deletions,
    nextSyncCursor: input.nextSyncCursor,
    completeWindowSnapshot: input.completeWindowSnapshot,
    truncated: input.truncated
  };
}

function normalizeSnapshot(snapshot: ProviderEventSnapshot): ProviderEventSnapshot {
  if (!isRecord(snapshot)) throw new CalendarProviderGatewayError("invalid_input", "A provider event has an invalid shape.");
  assertIdentifier(snapshot.providerEventId, "providerEventId");
  assertIdentifier(snapshot.providerRevision, "providerRevision");
  if (snapshot.revivesProviderRevision !== undefined) assertIdentifier(snapshot.revivesProviderRevision, "revivesProviderRevision");
  return {
    providerEventId: snapshot.providerEventId,
    providerRevision: snapshot.providerRevision,
    content: normalizeContent(snapshot.content as ProviderEventContent),
    ...(snapshot.revivesProviderRevision === undefined ? {} : { revivesProviderRevision: snapshot.revivesProviderRevision })
  };
}

function normalizeContent(content: ProviderEventContent): ProviderEventContent {
  if (!isRecord(content)) throw new CalendarProviderGatewayError("invalid_input", "Provider event content has an invalid shape.");
  assertBoundedString(content.title, "title", 1_000);
  if (!content.title.trim()) {
    throw new CalendarProviderGatewayError("invalid_input", "An event title is required.");
  }
  const description = normalizeNullableString(content.description, "description", 100_000);
  const location = normalizeNullableString(content.location, "location", 10_000);
  const providerSeriesId = normalizeNullableString(content.providerSeriesId, "providerSeriesId", 512);
  if (content.status !== "confirmed" && content.status !== "tentative" && content.status !== "canceled") {
    throw new CalendarProviderGatewayError("invalid_input", "The provider event status is invalid.");
  }
  if (!isRecord(content.span)) throw new CalendarProviderGatewayError("invalid_input", "A provider event span is required.");
  let span: ProviderEventSpan;
  if (content.span.kind === "timed") {
    const startUtc = normalizeUtcInstant(content.span.startUtc, "span.startUtc");
    const endUtc = normalizeUtcInstant(content.span.endUtc, "span.endUtc");
    if (Date.parse(endUtc) <= Date.parse(startUtc)) {
      throw new CalendarProviderGatewayError("invalid_input", "A valid timed event span is required.");
    }
    span = {
      kind: "timed",
      startUtc,
      endUtc,
      sourceTimeZone: normalizeNullableString(content.span.sourceTimeZone, "sourceTimeZone", 256),
      floatingLocalStart: normalizeNullableString(content.span.floatingLocalStart, "floatingLocalStart", 128),
      floatingLocalEnd: normalizeNullableString(content.span.floatingLocalEnd, "floatingLocalEnd", 128)
    };
  } else if (content.span.kind === "all_day") {
    const startDate = normalizeCalendarDate(content.span.startDate, "span.startDate");
    const endDateExclusive = normalizeCalendarDate(content.span.endDateExclusive, "span.endDateExclusive");
    if (calendarDateToUtcMs(endDateExclusive) <= calendarDateToUtcMs(startDate)) {
      throw new CalendarProviderGatewayError("invalid_input", "A valid all-day date span is required.");
    }
    span = { kind: "all_day", startDate, endDateExclusive };
  } else {
    throw new CalendarProviderGatewayError("invalid_input", "The provider event span kind is invalid.");
  }
  return { title: content.title, description, location, span, providerSeriesId, status: content.status };
}

function normalizeCommand(command: CalendarProviderCommand): CalendarProviderCommand {
  if (!isRecord(command) || (command.kind !== "create" && command.kind !== "update" && command.kind !== "delete")) {
    throw new CalendarProviderGatewayError("invalid_input", "The provider command has an invalid shape.");
  }
  assertIdentifier(command.commandId, "commandId");
  assertIdentifier(command.ownerId, "ownerId");
  assertIdentifier(command.connectionId, "connectionId");
  assertActor(command.actor);
  const calendarId = canonicalCalendarId(command.calendarId);
  const content = command.kind === "delete" ? undefined : normalizeContent(command.content);
  if (command.kind !== "create") {
    assertIdentifier(command.providerEventId, "providerEventId");
    assertIdentifier(command.expectedProviderRevision, "expectedProviderRevision");
  }
  if (command.kind === "create") return { ...command, calendarId, content: content! };
  if (command.kind === "update") return { ...command, calendarId, content: content! };
  return { ...command, calendarId };
}

function canonicalCalendarId(value: unknown): string {
  try {
    return normalizeCalendarId(value);
  } catch {
    throw new CalendarProviderGatewayError("invalid_input", "calendarId must be a canonical Calendar prefixed UUID.");
  }
}

function normalizeCalendarSelection(
  value: unknown,
  ownerId: string,
  createdAt: string
): {
  calendar: CalendarRecord;
  providerCalendarId: string;
  visible: boolean;
  agentGrant: CalendarAgentGrant;
} {
  if (!isRecord(value)) {
    throw new CalendarProviderGatewayError("invalid_input", "A provider Calendar selection must be an object.");
  }
  const requiredKeys = ["calendarId", "providerCalendarId", "title", "color", "timeZone", "isDefault"];
  const allowedKeys = new Set([...requiredKeys, "visible", "agentGrant"]);
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new CalendarProviderGatewayError(
      "invalid_input",
      "A provider Calendar selection contains missing or unsupported fields."
    );
  }
  assertIdentifier(value.providerCalendarId, "providerCalendarId");
  assertBoundedString(value.title, "title", 120);
  assertBoundedString(value.color, "color", 64);
  assertBoundedString(value.timeZone, "timeZone", 100);
  if (typeof value.isDefault !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "Calendar default status must be boolean.");
  }
  if (value.visible !== undefined && typeof value.visible !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "Calendar visibility must be boolean.");
  }
  const agentGrant = normalizeAgentGrant(value.agentGrant ?? "none");
  try {
    return {
      calendar: createCanonicalExternalCalendar({
        id: canonicalCalendarId(value.calendarId),
        ownerId,
        title: value.title,
        color: value.color,
        timeZone: value.timeZone,
        isDefault: value.isDefault,
        createdAt
      }),
      providerCalendarId: value.providerCalendarId,
      visible: value.visible ?? true,
      agentGrant
    };
  } catch (error) {
    if (error instanceof CalendarProviderGatewayError) throw error;
    throw new CalendarProviderGatewayError(
      "invalid_input",
      "The canonical external Calendar fields are invalid."
    );
  }
}

function assertActor(value: unknown): asserts value is "owner" | "agent" {
  if (value !== "owner" && value !== "agent") {
    throw new CalendarProviderGatewayError("invalid_input", "The provider actor is invalid.");
  }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new CalendarProviderGatewayError("invalid_input", `${field} must be a string.`);
  nonEmpty(value, field);
  if (value.length > 512) throw new CalendarProviderGatewayError("invalid_input", `${field} is too long.`);
}

function assertBoundedString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new CalendarProviderGatewayError("invalid_input", `${field} must be a bounded string.`);
  }
}

function normalizeNullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  assertBoundedString(value, field, maxLength);
  return value;
}

function normalizeCapabilities(value: unknown): CalendarProviderCapabilities {
  if (!isRecord(value) || typeof value.read !== "boolean" || typeof value.create !== "boolean" ||
      typeof value.update !== "boolean" || typeof value.delete !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "Provider calendar capabilities have an invalid shape.");
  }
  return { read: value.read, create: value.create, update: value.update, delete: value.delete };
}

function normalizeUtcInstant(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new CalendarProviderGatewayError("invalid_input", `${field} must be an exact ISO instant.`);
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) throw new CalendarProviderGatewayError("invalid_input", `${field} must be an exact ISO instant.`);
  normalizeCalendarDate(match[1], field);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? "0");
  const offset = match[5];
  if (hour > 23 || minute > 59 || second > 59 ||
      (offset !== "Z" && offset !== "z" && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4, 6)) > 59)) ||
      !Number.isFinite(Date.parse(value))) {
    throw new CalendarProviderGatewayError("invalid_input", `${field} must be an exact ISO instant.`);
  }
  return new Date(value).toISOString();
}

function normalizeCalendarDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CalendarProviderGatewayError("invalid_input", `${field} must be a real calendar date.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new CalendarProviderGatewayError("invalid_input", `${field} must be a real calendar date.`);
  }
  return value;
}

function calendarDateToUtcMs(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new CalendarProviderGatewayError("invalid_input", `${field} is required.`);
  return value;
}

function projectionFor(
  connection: CalendarProviderConnectionRecord,
  calendar: CalendarProviderBindingRecord,
  snapshot: ProviderEventSnapshot,
  synchronizedAt: string
): CalendarProviderEventProjection {
  return {
    ownerId: connection.ownerId,
    connectionId: connection.connectionId,
    providerKey: connection.providerKey,
    providerAccountId: connection.providerAccountId,
    calendarId: calendar.calendarId,
    providerCalendarId: calendar.providerCalendarId,
    providerEventId: snapshot.providerEventId,
    providerRevision: snapshot.providerRevision,
    content: cloneContent(snapshot.content),
    synchronizedAt
  };
}

function tombstoneFor(
  connection: CalendarProviderConnectionRecord,
  calendar: CalendarProviderBindingRecord,
  providerEventId: string,
  providerRevision: string,
  deletedAt: string,
  cause: CalendarProviderEventTombstone["cause"]
): CalendarProviderEventTombstone {
  return {
    ownerId: connection.ownerId,
    connectionId: connection.connectionId,
    providerKey: connection.providerKey,
    providerAccountId: connection.providerAccountId,
    calendarId: calendar.calendarId,
    providerCalendarId: calendar.providerCalendarId,
    providerEventId,
    deletedProviderRevision: providerRevision,
    deletedAt,
    cause
  };
}

function eventOverlapsWindow(span: ProviderEventSpan, window: CalendarProviderWindow): boolean {
  const windowStart = Date.parse(window.startUtc);
  const windowEnd = Date.parse(window.endUtc);
  if (span.kind === "timed") {
    return Date.parse(span.startUtc) < windowEnd && Date.parse(span.endUtc) > windowStart;
  }
  return calendarDateToUtcMs(span.startDate) < windowEnd && calendarDateToUtcMs(span.endDateExclusive) > windowStart;
}

function syncStateEquals(left: CalendarProviderSyncState | null, right: CalendarProviderSyncState | null): boolean {
  if (left === null || right === null) return left === right;
  return left.connectionId === right.connectionId &&
    left.calendarId === right.calendarId &&
    left.syncCursor === right.syncCursor &&
    left.lastReconciledAt === right.lastReconciledAt &&
    left.lastRecoveryAt === right.lastRecoveryAt;
}

function commandFingerprint(command: CalendarProviderCommand): string {
  return createHash("sha256").update(stableFingerprint(command)).digest("hex");
}

function stableFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableFingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableFingerprint(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function hintIdentityFingerprint(hint: CalendarProviderWebhookHint): string {
  return stableFingerprint({
    hintId: hint.hintId,
    ownerId: hint.ownerId,
    connectionId: hint.connectionId,
    providerAccountId: hint.providerAccountId,
    providerCalendarId: hint.providerCalendarId,
    receivedAt: hint.receivedAt
  });
}

function calendarKey(connectionId: string, calendarId: string) { return `${connectionId}\u0000${calendarId}`; }
function eventKey(connectionId: string, calendarId: string, providerEventId: string) {
  return `${connectionId}\u0000${calendarId}\u0000${providerEventId}`;
}

function cloneContent(content: ProviderEventContent): ProviderEventContent {
  return { ...content, span: { ...content.span } };
}
function cloneProjection(value: CalendarProviderEventProjection): CalendarProviderEventProjection {
  return { ...value, content: cloneContent(value.content) };
}
function cloneCalendar(value: CalendarProviderBindingRecord): CalendarProviderBindingRecord {
  return { ...value, capabilities: { ...value.capabilities } };
}
function cloneCalendarOrNull(value: CalendarProviderBindingRecord | null) { return value ? cloneCalendar(value) : null; }
function cloneConnection(value: CalendarProviderConnectionRecord | null) { return value ? { ...value } : null; }
function cloneCommand<T extends CalendarProviderCommand>(value: T): T {
  return (value.kind === "delete" ? { ...value } : { ...value, content: cloneContent(value.content) }) as T;
}
function cloneResult(value: CalendarProviderCommandResult): CalendarProviderCommandResult {
  return value.kind === "delete" ? { ...value } : { ...value, event: cloneProjection(value.event) };
}
function cloneOutbox(value: CalendarProviderOutboxRecord): CalendarProviderOutboxRecord {
  return { ...value, command: cloneCommand(value.command), result: value.result ? cloneResult(value.result) : null };
}
