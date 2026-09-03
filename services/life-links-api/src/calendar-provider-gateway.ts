import { createHash, randomUUID } from "node:crypto";

import {
  createCanonicalExternalCalendar,
  normalizeCalendarId,
  normalizeCalendarIanaTimeZone,
  type CalendarAgentAccess,
  type CalendarConnectionView,
  type CalendarConnectedCalendarView,
  type CalendarConnectedCalendarPatch,
  type CalendarProviderCapabilities,
  type CalendarRecord,
  type ProviderEventSpan,
  type ProviderEventContent,
  type ProviderEventSnapshot,
  type CalendarProviderEventProjection
} from "@life-links/core";

export type { CalendarProviderCapabilities, ProviderTimedEventSpan, ProviderAllDayEventSpan,
  ProviderEventSpan, ProviderEventContent, ProviderEventSnapshot, CalendarProviderEventProjection } from "@life-links/core";

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

/** Stable canonical identity for this account connection and exact remote Calendar. */
export function calendarProviderLocalCalendarId(connectionId: string, providerCalendarId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([connectionId, providerCalendarId])).digest("hex");
  return normalizeCalendarId(`calendar-${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`);
}
export type CalendarAgentGrant = CalendarAgentAccess;
export type CalendarProviderConnectionStatus = CalendarConnectionView["status"];
export type CalendarProviderRevocationStatus = CalendarConnectionView["remoteRevocationStatus"];

export type ProviderAccountIdentity = {
  providerKey: CalendarProviderKey;
  providerAccountId: string;
};

export type CalendarProviderConnectionRecord = CalendarConnectionView & {
  credentialHandle: CalendarProviderCredentialHandle | null;
};

export type CalendarProviderConnectionView = CalendarConnectionView;

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
  isDefault?: boolean;
  timeZone?: string;
  capabilities: CalendarProviderCapabilities;
};

export type CalendarProviderDiscovery = ProviderAccountIdentity & {
  accountEmail?: string;
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
    authorizeDispatch?: () => Promise<void>;
  }): Promise<{ providerEventId: string }>;
  updateEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
    content: ProviderEventContent;
    authorizeDispatch?: () => Promise<void>;
  }): Promise<void>;
  deleteEvent(input: {
    credentialHandle: CalendarProviderCredentialHandle;
    providerAccountId: string;
    providerCalendarId: string;
    providerEventId: string;
    commandId: string;
    expectedProviderRevision: string;
    authorizeDispatch?: () => Promise<void>;
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
  status: "pending" | "processing" | "succeeded" | "conflict" | "rejected";
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
  dispatchEvidence: CalendarProviderDispatchEvidence | null;
};

/** Durable uncertainty marker, written before provider I/O, never an assertion of success. */
export type CalendarProviderDispatchEvidence = {
  phase: "dispatched" | "acknowledged";
  providerEventId: string | null;
  dispatchedAt: string;
  desiredFingerprint: string | null;
};

export type CalendarProviderSynchronizationTarget = {
  ownerId: string;
  connectionId: string;
  calendarId: string;
  providerKey: string;
};

export type CalendarProviderConnectionExpectation = Pick<CalendarProviderConnectionRecord, "status" | "credentialHandle"> & {
  connectedAt?: string;
  requireIdleOutbox?: boolean;
  removalAt?: string;
  requireRetainedCalendars?: boolean;
};

export type CalendarProviderBindingUpdateOptions = {
  expectedUpdatedAt: string;
  updatedAt: string;
} | { provisioningConnection: CalendarProviderConnectionExpectation };

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
  expectedCalendarUpdatedAt?: string;
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
  listConnections(ownerId: string): Promise<CalendarProviderConnectionRecord[]>;
  getConnection(connectionId: string): Promise<CalendarProviderConnectionRecord | null>;
  saveConnection(connection: CalendarProviderConnectionRecord): Promise<void>;
  reserveConnection(connection: CalendarProviderConnectionRecord): Promise<{ record: CalendarProviderConnectionRecord; created: boolean }>;
  transitionConnection(connection: CalendarProviderConnectionRecord, expected: CalendarProviderConnectionExpectation): Promise<boolean>;
  listSynchronizationTargets(input: { providerKey?: string; limit: number; after: { connectionId: string; calendarId: string } | null }): Promise<CalendarProviderSynchronizationTarget[]>;
  listRetryableCommands(input: { providerKey?: string; limit: number; now: string }): Promise<Pick<CalendarProviderCommand, "commandId" | "ownerId" | "connectionId" | "calendarId">[]>;
  listRevocationTargets(input: { providerKey?: string; limit: number; now: string }): Promise<Array<{ ownerId: string; connectionId: string }>>;
  listCalendars(connectionId: string, includeRemoved?: boolean): Promise<CalendarProviderBindingRecord[]>;
  getCalendar(connectionId: string, calendarId: string): Promise<CalendarProviderBindingRecord | null>;
  getCanonicalCalendar(calendarId: string): Promise<CalendarRecord | null>;
  getManagedCalendar(connectionId: string, calendarId: string): Promise<CalendarConnectedCalendarView | null>;
  provisionCalendar(calendar: CalendarRecord, binding: CalendarProviderBindingRecord, options?: { providerTimeZone?: string; expectedRemovedUpdatedAt?: string }): Promise<void>;
  updateCalendarBinding(calendar: CalendarProviderBindingRecord, options?: CalendarProviderBindingUpdateOptions): Promise<void>;
  rollbackProvisioning(connectionId: string, removal?: { expectedConnectedAt: string; now?: string }): Promise<void>;
  assertRemovalSafe(connectionId: string, calendarId?: string, now?: string): Promise<void>;
  removeConnectedCalendar(input: { ownerId: string; connectionId: string; calendarId: string; expectedUpdatedAt: string; deletedAt: string }): Promise<void>;
  getSyncState(connectionId: string, calendarId: string): Promise<CalendarProviderSyncState | null>;
  listProjections(connectionId: string, calendarId: string): Promise<CalendarProviderEventProjection[]>;
  findCalendarConnection(ownerId: string, calendarId: string): Promise<string | null>;
  pageProjections(connectionId: string, calendarId: string, after: string | null, limit: number): Promise<{ items: CalendarProviderEventProjection[]; nextAfter: string | null }>;
  getProjection(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventProjection | null>;
  getTombstone(connectionId: string, calendarId: string, providerEventId: string): Promise<CalendarProviderEventTombstone | null>;
  applySyncMutation(mutation: CalendarProviderSyncMutation): Promise<void>;
  reserveOutbox(record: CalendarProviderOutboxRecord, expectedCalendarUpdatedAt?: string): Promise<{ record: CalendarProviderOutboxRecord; created: boolean }>;
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
      | "calendar_settings_conflict"
      | "agent_calendar_access_denied"
      | "provider_batch_incomplete"
      | "sync_state_conflict"
      | "idempotency_conflict"
      | "command_in_progress"
      | "provider_retry_later"
      | "outbox_lease_lost"
      | "provider_revision_conflict"
      | "provider_readback_failed"
      | "provider_event_read_only"
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
    const previous = await this.store.getConnection(input.connectionId);
    if (previous && (previous.ownerId !== input.ownerId || previous.providerKey !== input.providerKey
      || previous.providerAccountId !== input.expectedProviderAccountId)) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The connection is bound to another exact account.");
    }
    if (previous?.status === "disconnected") {
      throw new CalendarProviderGatewayError("connection_inactive", "Use explicit reconnect for a disconnected account.");
    }
    const connectedAt = previous?.connectedAt ?? this.#now().toISOString();
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
    if (previous?.status === "active") {
      const bound = await this.store.listCalendars(previous.connectionId);
      if (bound.length !== selections.length || selections.some((selection) => !bound.some((binding) =>
        binding.calendarId === selection.calendar.id && binding.providerCalendarId === selection.providerCalendarId))) {
        throw new CalendarProviderGatewayError("idempotency_conflict", "The connection was completed with a different Calendar selection.");
      }
      return { connection: safeConnection(previous), calendars: bound.map(cloneCalendar) };
    }
    const discovery = await this.discoverExternalCalendars(input);
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
      ...(discovery.accountEmail === undefined ? {} : { accountEmail: discovery.accountEmail }),
      status: "provisioning",
      credentialHandle: input.credentialHandle,
      connectedAt,
      disconnectedAt: null,
      remoteRevocationStatus: "not_required",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    };
    const reserved = await this.store.reserveConnection(connection);
    connection = reserved.record;
    if (connection.ownerId !== input.ownerId || connection.providerKey !== input.providerKey
      || connection.providerAccountId !== input.expectedProviderAccountId || connection.credentialHandle !== input.credentialHandle) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The connection identity or credential changed during selection.");
    }
    if (connection.status === "active") return this.connectExternalAccount(input);
    if (connection.status !== "provisioning") throw new CalendarProviderGatewayError("connection_inactive", "The connection is no longer being provisioned.");
    try {
      for (let index = 0; index < calendars.length; index += 1) {
        const timeZone = discovered.get(selections[index].providerCalendarId)?.timeZone;
        await this.store.provisionCalendar({ ...selections[index].calendar, createdAt: connection.connectedAt, updatedAt: connection.connectedAt }, calendars[index],
          timeZone === undefined ? undefined : { providerTimeZone: timeZone });
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
      const active: CalendarProviderConnectionRecord = { ...connection, status: "active", accountEmail: discovery.accountEmail ?? connection.accountEmail };
      if (!await this.store.transitionConnection(active, connection)) {
        const latest = await this.store.getConnection(connection.connectionId);
        if (!latest || latest.status !== "active" || latest.credentialHandle !== connection.credentialHandle) {
          throw new CalendarProviderGatewayError("connection_inactive", "The connection changed before provisioning completed.");
        }
      }
      connection = active;
    } catch (error) {
      const latest = await this.store.getConnection(connection.connectionId);
      if (reserved.created && latest?.status === "provisioning" && latest.credentialHandle === connection.credentialHandle) {
        const locallyClosed = await this.#closeConnectionLocally(latest, "retain_private_stale");
        try {
          await this.store.rollbackProvisioning(connection.connectionId);
        } finally {
          await this.#attemptRemoteRevocation(locallyClosed);
        }
      }
      throw error;
    }
    return { connection: safeConnection(connection), calendars: calendars.map(cloneCalendar) };
  }

  async discoverExternalCalendars(input: {
    ownerId: string; providerKey: string; expectedProviderAccountId: string; credentialHandle: CalendarProviderCredentialHandle;
  }): Promise<CalendarProviderDiscovery> {
    assertIdentifier(input.ownerId, "ownerId");
    assertIdentifier(input.expectedProviderAccountId, "expectedProviderAccountId");
    const discovery = normalizeDiscovery(await this.#adapter(input.providerKey).discover({ credentialHandle: input.credentialHandle }));
    if (discovery.providerKey !== input.providerKey || discovery.providerAccountId !== input.expectedProviderAccountId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The authorized provider account did not match the selected account.");
    }
    return discovery;
  }

  async discoverConnectionCalendars(input: { ownerId: string; connectionId: string }): Promise<CalendarProviderDiscovery> {
    const connection = await this.#ownedConnection(input.ownerId, input.connectionId, false);
    const discovery = await this.discoverExternalCalendars({ ...input, providerKey: connection.providerKey,
      expectedProviderAccountId: connection.providerAccountId, credentialHandle: requiredCredential(connection) });
    const current = await this.#ownedConnection(input.ownerId, input.connectionId, false);
    if (current.providerKey !== connection.providerKey || current.providerAccountId !== connection.providerAccountId
      || current.credentialHandle !== connection.credentialHandle
      || !await this.store.transitionConnection({ ...current, accountEmail: discovery.accountEmail ?? current.accountEmail }, current)) {
      throw new CalendarProviderGatewayError("connection_inactive", "The account connection changed during discovery.");
    }
    return discovery;
  }

  async selectExternalCalendars(input: {
    ownerId: string; connectionId: string; calendars: CalendarProviderSelection[]; initialWindow: CalendarProviderWindow;
  }): Promise<CalendarConnectedCalendarView[]> {
    const connection = await this.#ownedConnection(input.ownerId, input.connectionId, false);
    const admittedCalendars = new Map(await Promise.all(input.calendars.map(async (calendar) =>
      [calendar.calendarId, await this.store.getCanonicalCalendar(calendar.calendarId)] as const)));
    const window = normalizeWindow(input.initialWindow, this.#maxInitialWindowDays);
    const discovery = await this.discoverConnectionCalendars(input);
    if (!input.calendars.length) throw new CalendarProviderGatewayError("invalid_input", "Select at least one Calendar.");
    const seenLocal = new Set<string>();
    const seenProvider = new Set<string>();
    const existing = await this.store.listCalendars(connection.connectionId);
    const selections = input.calendars.map((value) => {
      const selection = normalizeCalendarSelection(value, input.ownerId, this.#now().toISOString());
      if (seenProvider.has(selection.providerCalendarId) || seenLocal.has(selection.calendar.id)) {
        throw new CalendarProviderGatewayError("invalid_input", "Calendar selections must be unique.");
      }
      seenProvider.add(selection.providerCalendarId); seenLocal.add(selection.calendar.id);
      const remote = discovery.calendars.find((entry) => entry.providerCalendarId === selection.providerCalendarId);
      if (!remote) throw new CalendarProviderGatewayError("provider_identity_mismatch", "The selected Calendar was not discovered in this account.");
      if (!remote.capabilities.read) throw new CalendarProviderGatewayError("calendar_read_only", "The selected Calendar is not readable.");
      assertAgentGrant(selection.agentGrant, remote.capabilities);
      const bound = existing.find((entry) => entry.providerCalendarId === selection.providerCalendarId);
      if (bound && value.agentGrant !== undefined && bound.agentGrant !== selection.agentGrant) {
        throw new CalendarProviderGatewayError("calendar_settings_conflict", "An already connected Calendar keeps its current access; edit its settings separately.");
      }
      return { selection, remote };
    });
    for (const { selection, remote } of selections) {
      await this.store.provisionCalendar(selection.calendar, {
        ownerId: input.ownerId, connectionId: input.connectionId, providerKey: connection.providerKey,
        providerAccountId: connection.providerAccountId, calendarId: selection.calendar.id,
        providerCalendarId: remote.providerCalendarId, providerDisplayName: remote.displayName,
        capabilities: remote.capabilities, agentGrant: selection.agentGrant, visible: selection.visible
      }, { providerTimeZone: remote.timeZone, expectedRemovedUpdatedAt:
        admittedCalendars.get(selection.calendar.id)?.deletedAt ? admittedCalendars.get(selection.calendar.id)!.updatedAt : undefined });
      await this.synchronizeCalendar({ ownerId: input.ownerId, connectionId: input.connectionId,
        calendarId: selection.calendar.id, window });
    }
    return this.listManagedCalendars(input.ownerId, input.connectionId);
  }

  async reconnectConnection(input: {
    ownerId: string; connectionId: string; expectedProviderAccountId: string;
    credentialHandle: CalendarProviderCredentialHandle; initialWindow: CalendarProviderWindow;
    calendars?: CalendarProviderSelection[];
  }, options: { beforeCredentialReplacement?: (input: {
    ownerId: string; connectionId: string; providerAccountId: string;
    credentialHandle: CalendarProviderCredentialHandle; replacementCredentialHandle: CalendarProviderCredentialHandle;
  }) => Promise<void> } = {}): Promise<CalendarProviderConnectionView> {
    let previous = await this.#ownedConnection(input.ownerId, input.connectionId, true);
    if (previous.providerAccountId !== input.expectedProviderAccountId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "Reconnect must authorize the same exact account.");
    }
    const window = normalizeWindow(input.initialWindow, this.#maxInitialWindowDays);
    if (previous.status === "active" && previous.credentialHandle === input.credentialHandle) return safeConnection(previous);
    const discovery = await this.discoverExternalCalendars({ ...input, providerKey: previous.providerKey });
    const grants = new Map<string, CalendarAgentGrant>();
    const selectedLocalIds = new Set<string>();
    for (const value of input.calendars ?? []) {
      const selection = normalizeCalendarSelection(value, input.ownerId, this.#now().toISOString());
      const remote = discovery.calendars.find((entry) => entry.providerCalendarId === selection.providerCalendarId);
      if (!remote || grants.has(selection.providerCalendarId) || selectedLocalIds.has(selection.calendar.id)) {
        throw new CalendarProviderGatewayError("provider_identity_mismatch", "Reconnect requires unique exact discovered Calendars.");
      }
      assertAgentGrant(selection.agentGrant, remote.capabilities);
      grants.set(selection.providerCalendarId, selection.agentGrant);
      selectedLocalIds.add(selection.calendar.id);
    }
    const bindings = await this.store.listCalendars(previous.connectionId);
    if (previous.status === "provisioning" && previous.credentialHandle !== input.credentialHandle) {
      throw new CalendarProviderGatewayError("idempotency_conflict", "Reconnect is already bound to another authorization attempt.");
    }
    if (previous.credentialHandle && previous.credentialHandle !== input.credentialHandle) {
      previous = await this.#closeConnectionLocally(previous, "purge");
      await options.beforeCredentialReplacement?.({ ownerId: input.ownerId, connectionId: input.connectionId,
        providerAccountId: previous.providerAccountId, credentialHandle: requiredCredential(previous),
        replacementCredentialHandle: input.credentialHandle });
      previous = await this.#attemptRemoteRevocation(previous);
      if (previous.remoteRevocationStatus !== "succeeded") {
        throw new ProviderTransientError("The previous Calendar authorization has not finished local credential cleanup.");
      }
    }
    const reconnecting: CalendarProviderConnectionRecord = { ...previous, status: "provisioning", credentialHandle: input.credentialHandle,
      accountEmail: discovery.accountEmail ?? previous.accountEmail,
      connectedAt: previous.status === "provisioning" ? previous.connectedAt : this.#now().toISOString(),
      disconnectedAt: null, remoteRevocationStatus: "not_required", remoteRevocationAttemptedAt: null, remoteRevocationErrorCode: null };
    if (!await this.store.transitionConnection(reconnecting, { ...previous, requireRetainedCalendars: true })) {
      throw new CalendarProviderGatewayError("connection_inactive", "The account connection changed during reconnect.");
    }
    for (const binding of bindings) {
      const remote = discovery.calendars.find((entry) => entry.providerCalendarId === binding.providerCalendarId);
      if (!remote) {
        // Provider calendar deletion or loss of access does not change the
        // authenticated account. Retain its local identity without reviving
        // stale access, projections or synchronization under the new grant.
        await this.store.updateCalendarBinding({ ...binding, visible: false, agentGrant: "none",
          capabilities: { read: false, create: false, update: false, delete: false } }, { provisioningConnection: reconnecting });
        continue;
      }
      if (remote.timeZone !== undefined) {
        const canonical = await this.store.getCanonicalCalendar(binding.calendarId);
        if (!canonical) throw new CalendarProviderGatewayError("calendar_not_found", "The canonical external Calendar was not found.");
        await this.store.provisionCalendar(canonical, { ...binding, agentGrant: canonical.agentAccess }, { providerTimeZone: remote.timeZone });
      }
      await this.store.updateCalendarBinding({ ...binding, capabilities: remote.capabilities, providerDisplayName: remote.displayName,
        visible: true, agentGrant: grants.get(binding.providerCalendarId) ?? "none" }, { provisioningConnection: reconnecting });
      await this.synchronizeCalendar({ ownerId: input.ownerId, connectionId: input.connectionId, calendarId: binding.calendarId,
        window, allowProvisioning: true });
    }
    const active: CalendarProviderConnectionRecord = { ...reconnecting, status: "active" };
    if (!await this.store.transitionConnection(active, reconnecting)) {
      throw new CalendarProviderGatewayError("connection_inactive", "The account changed before reconnect completed.");
    }
    return safeConnection(active);
  }

  async listSynchronizationTargets(input: { providerKey?: string; limit?: number; cursor?: string } = {}) {
    const limit = boundedPageLimit(input.limit, 100);
    const after = input.cursor ? decodeSynchronizationCursor(input.cursor) : null;
    const rows = await this.store.listSynchronizationTargets({ providerKey: input.providerKey, limit: limit + 1, after });
    const targets = rows.slice(0, limit);
    return { targets, nextCursor: rows.length > limit
      ? Buffer.from(JSON.stringify({ connectionId: targets.at(-1)!.connectionId, calendarId: targets.at(-1)!.calendarId }), "utf8").toString("base64url")
      : null };
  }

  async listRetryableCommands(input: { providerKey?: string; limit?: number } = {}) {
    return this.store.listRetryableCommands({ ...input, limit: boundedPageLimit(input.limit, 50), now: this.#now().toISOString() });
  }

  async retryCommand(commandId: string) {
    const record = await this.store.getOutbox(commandId);
    if (!record || record.command.actor !== "owner") {
      throw new CalendarProviderGatewayError("agent_calendar_access_denied", "A background worker cannot dispatch page-agent commands.");
    }
    return this.executeCommand(record.command);
  }

  async retryPendingRevocations(input: { providerKey?: string; limit?: number } = {}) {
    const targets = await this.store.listRevocationTargets({ ...input, limit: boundedPageLimit(input.limit, 10), now: this.#now().toISOString() });
    let completed = 0;
    for (const target of targets) {
      const current = await this.store.getConnection(target.connectionId);
      if (current?.status !== "disconnected" || current.ownerId !== target.ownerId) continue;
      // Continue only this exact closed credential epoch. Re-entering the public
      // disconnect command could close a newer reconnect that won this race.
      const result = await this.#attemptRemoteRevocation(current);
      if (result.remoteRevocationStatus === "succeeded") completed++;
    }
    return { attempted: targets.length, completed };
  }

  async getConnection(ownerId: string, connectionId: string): Promise<CalendarProviderConnectionView> {
    return safeConnection(await this.#ownedConnection(ownerId, connectionId, true));
  }

  async listConnections(ownerId: string): Promise<CalendarProviderConnectionView[]> {
    assertIdentifier(ownerId, "ownerId");
    const connections = await this.store.listConnections(ownerId);
    const visible = await Promise.all(connections.map(async (connection) =>
      await this.#removedConnection(connection) ? null : safeConnection(connection)));
    return visible.filter((connection): connection is CalendarProviderConnectionView => connection !== null);
  }

  async listManagedCalendars(ownerId: string, connectionId: string): Promise<CalendarConnectedCalendarView[]> {
    await this.#ownedConnection(ownerId, connectionId, true);
    const bindings = await this.store.listCalendars(connectionId);
    return Promise.all(bindings.map((binding) => this.#managedCalendar(binding)));
  }

  async removeConnectedCalendar(input: { ownerId: string; connectionId: string; calendarId: string; expectedUpdatedAt: string }): Promise<{ removed: true }> {
    await this.#ownedConnection(input.ownerId, input.connectionId, true);
    await this.store.removeConnectedCalendar({ ...input, deletedAt: this.#now().toISOString() });
    return { removed: true };
  }

  async removeCalendarConnection(input: { ownerId: string; connectionId: string; expectedConnectedAt: string }): Promise<{ removed: true }> {
    const connection = await this.store.getConnection(input.connectionId);
    if (!connection || connection.ownerId !== input.ownerId) throw new CalendarProviderGatewayError("connection_not_found", "The calendar connection was not found.");
    if (connection.connectedAt !== input.expectedConnectedAt) throw new CalendarProviderGatewayError("calendar_settings_conflict", "The account was reconnected after this removal was prepared.");
    if (await this.#removedConnection(connection)) return { removed: true };
    await this.store.assertRemovalSafe(connection.connectionId, undefined, this.#now().toISOString());
    await this.disconnectConnection({ ...input, localProjectionDisposition: "purge" });
    const closed = await this.store.getConnection(connection.connectionId);
    if (!closed || closed.connectedAt !== input.expectedConnectedAt || closed.status !== "disconnected" || closed.credentialHandle !== null) {
      throw new CalendarProviderGatewayError("connection_inactive", "The account is disabled, but credential cleanup must finish before it can be removed.");
    }
    await this.store.rollbackProvisioning(connection.connectionId, { expectedConnectedAt: input.expectedConnectedAt, now: this.#now().toISOString() });
    return { removed: true };
  }

  async #removedConnection(connection: CalendarProviderConnectionRecord): Promise<boolean> {
    return connection.status === "disconnected" && connection.credentialHandle === null &&
      (await this.store.listCalendars(connection.connectionId, true)).length === 0;
  }

  async updateCalendarSettings(input: {
    ownerId: string;
    connectionId: string;
    calendarId: string;
    expectedUpdatedAt: string;
    patch: CalendarConnectedCalendarPatch;
  }): Promise<CalendarConnectedCalendarView> {
    const calendarId = canonicalCalendarId(input.calendarId);
    await this.#ownedConnection(input.ownerId, input.connectionId, false);
    const binding = await this.store.getCalendar(input.connectionId, calendarId);
    if (!binding || binding.ownerId !== input.ownerId) {
      throw new CalendarProviderGatewayError("calendar_not_found", "The exact provider Calendar was not found.");
    }
    const current = await this.#managedCalendar(binding);
    if (!isRecord(input.patch) || !Object.keys(input.patch).length
      || Object.keys(input.patch).some((key) => key !== "visible" && key !== "agentAccess")
      || (input.patch.visible !== undefined && typeof input.patch.visible !== "boolean")) {
      throw new CalendarProviderGatewayError("invalid_input", "Calendar settings contain missing or unsupported fields.");
    }
    const expectedUpdatedAt = normalizeUtcInstant(input.expectedUpdatedAt, "expectedUpdatedAt");
    if (expectedUpdatedAt !== current.calendar.updatedAt) {
      throw new CalendarProviderGatewayError("calendar_settings_conflict", "Calendar settings changed. Reload before saving.");
    }
    const agentGrant = input.patch.agentAccess === undefined
      ? current.calendar.agentAccess
      : normalizeAgentGrant(input.patch.agentAccess);
    assertAgentGrant(agentGrant, binding.capabilities);
    if (input.patch.visible === true && !binding.capabilities.read) {
      throw new CalendarProviderGatewayError("calendar_read_only", "The provider Calendar is unavailable and cannot be displayed.");
    }
    const changed = { ...binding, agentGrant, visible: input.patch.visible ?? binding.visible };
    await this.store.updateCalendarBinding(changed, {
      expectedUpdatedAt,
      updatedAt: nextCalendarSettingsTimestamp(this.#now().toISOString(), current.calendar.updatedAt)
    });
    return this.#managedCalendar(changed);
  }

  async #managedCalendar(binding: CalendarProviderBindingRecord): Promise<CalendarConnectedCalendarView> {
    const managed = await this.store.getManagedCalendar(binding.connectionId, binding.calendarId);
    const calendar = managed?.calendar;
    if (!calendar || calendar.ownerId !== binding.ownerId || calendar.source !== "external" || calendar.deletedAt !== null) {
      throw new CalendarProviderGatewayError("calendar_not_found", "The canonical external Calendar was not found.");
    }
    return managed!;
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
    expectedUpdatedAt: string;
  }): Promise<CalendarProviderBindingRecord> {
    await this.updateCalendarSettings({ ...input, patch: { agentAccess: input.agentGrant } });
    return (await this.store.getCalendar(input.connectionId, input.calendarId))!;
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

  /** Cache-only bounded discovery; permission is rechecked before and after storage. */
  async pageProjections(ownerId: string, connectionId: string, calendarId: string, after: string | null,
    limit: number, actor: "owner" | "agent" = "owner") {
    assertActor(actor);
    calendarId = canonicalCalendarId(calendarId);
    if (after !== null) assertIdentifier(after, "after");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new CalendarProviderGatewayError("invalid_input", "Invalid cache page size.");
    await this.#ownedCalendar(ownerId, connectionId, calendarId, "read", actor, false);
    const page = await this.store.pageProjections(connectionId, calendarId, after, limit);
    await this.#ownedCalendar(ownerId, connectionId, calendarId, "read", actor, false);
    return { items: page.items.map(cloneProjection), nextAfter: page.nextAfter };
  }

  async pageCalendarProjections(ownerId: string, calendarId: string, after: string | null,
    limit: number, actor: "owner" | "agent" = "owner") {
    const connectionId = await this.store.findCalendarConnection(ownerId, canonicalCalendarId(calendarId));
    if (!connectionId) throw new CalendarProviderGatewayError("calendar_not_found", "The provider Calendar was not found.");
    return this.pageProjections(ownerId, connectionId, calendarId, after, limit, actor);
  }

  async synchronizeCalendar(input: {
    ownerId: string;
    connectionId: string;
    calendarId: string;
    window: CalendarProviderWindow;
    allowProvisioning?: boolean;
    actor?: "owner" | "agent";
    authorizeAgent?: () => Promise<void>;
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
    actor?: "owner" | "agent";
    authorizeAgent?: () => Promise<void>;
  }): Promise<{ recoveredExpiredCursor: boolean; upserted: number; deleted: number; cursor: string }> {
    let expectedCalendarUpdatedAt: string | undefined;
    const admit = async () => {
      if (input.actor === "agent") {
        if (!input.authorizeAgent) throw new CalendarProviderGatewayError("agent_calendar_access_denied", "Live page-agent admission is required to synchronize.");
        await input.authorizeAgent();
      }
      const owned = await this.#ownedCalendar(
      input.ownerId,
      input.connectionId,
      input.calendarId,
      "read",
      input.actor ?? "owner",
      input.allowProvisioning ?? false
      );
      if (expectedCalendarUpdatedAt !== undefined && owned.canonical.updatedAt !== expectedCalendarUpdatedAt) {
        throw new CalendarProviderGatewayError("calendar_settings_conflict", "The Calendar changed while synchronization was in progress.");
      }
      expectedCalendarUpdatedAt ??= owned.canonical.updatedAt;
      return owned;
    };
    let { connection, calendar } = await admit();
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
      ({ connection, calendar } = await admit());
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
      ({ connection, calendar } = await admit());
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
      syncCursor: batch.nextSyncCursor,
      lastReconciledAt: now,
      lastRecoveryAt: recoveredExpiredCursor ? now : currentState.lastRecoveryAt
    };
    await admit();
    await this.store.applySyncMutation({
      connectionId: connection.connectionId,
      calendarId: calendar.calendarId,
      expectedCalendarUpdatedAt,
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

  async executeCommand(inputCommand: CalendarProviderCommand, options: { authorizeAgent?: () => Promise<void> } = {}): Promise<CalendarProviderCommandResult> {
    const command = normalizeCommand(inputCommand);
    const access = command.kind === "create" ? "create" : command.kind === "update" ? "update" : "delete";
    let expectedCalendarUpdatedAt: string | undefined;
    const admit = async () => {
      if (command.actor === "agent") {
        if (!options.authorizeAgent) throw new CalendarProviderGatewayError("agent_calendar_access_denied", "A live page-agent admission is required.");
        await options.authorizeAgent();
      }
      const owned = await this.#ownedCalendar(command.ownerId, command.connectionId, command.calendarId, access, command.actor, false);
      if (expectedCalendarUpdatedAt !== undefined && owned.canonical.updatedAt !== expectedCalendarUpdatedAt) {
        throw new CalendarProviderGatewayError("calendar_settings_conflict", "The Calendar changed while the provider command was in progress.");
      }
      expectedCalendarUpdatedAt ??= owned.canonical.updatedAt;
      return owned;
    };
    let { connection, calendar } = await admit();
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
      conflictRevision: null,
      dispatchEvidence: null
    }, expectedCalendarUpdatedAt);
    if (!reserved.created && reserved.record.fingerprint !== fingerprint) {
      throw new CalendarProviderGatewayError("idempotency_conflict", "The command identity is bound to different arguments.");
    }
    if (reserved.record.createdAt < connection.connectedAt && reserved.record.status !== "succeeded") {
      throw new CalendarProviderGatewayError("connection_inactive", "An earlier authorization's pending command cannot run after reconnect.");
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
      if (claimed.record.status === "succeeded" && claimed.record.result) {
        await admit();
        return cloneResult(claimed.record.result);
      }
      if (claimed.record.status === "conflict") {
        throw new CalendarProviderGatewayError("provider_revision_conflict", "The command previously conflicted at the provider.", {
          currentProviderRevision: claimed.record.conflictRevision
        });
      }
      if (claimed.record.status === "rejected") {
        throw new CalendarProviderGatewayError("provider_event_read_only", "This command was refused because its provider effects are not admitted.");
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
      ({ connection, calendar } = await admit());
      let recoveredUpdate: ProviderEventSnapshot | null = null;
      let deleteAlreadyMissing = false;
      if (command.kind === "create") {
        assertStandaloneProviderWrite(command.content);
      } else {
        const current = await adapter.readEvent({ credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId, providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId });
        if (current) {
          if (current.providerEventId !== command.providerEventId) {
            throw new CalendarProviderGatewayError("provider_readback_failed", "The provider returned another event identity.");
          }
          assertStandaloneProviderWrite(current.content);
        }
        if (outbox.dispatchEvidence) {
          if (command.kind === "update" && current
            && writableContentFingerprint(current.content) === outbox.dispatchEvidence.desiredFingerprint) recoveredUpdate = current;
          if (command.kind === "delete" && !current) deleteAlreadyMissing = true;
        }
        if (!recoveredUpdate && !deleteAlreadyMissing) {
          if (!current || current.providerRevision !== command.expectedProviderRevision) {
            throw new ProviderRevisionConflictError(current?.providerRevision ?? null);
          }
          if (outbox.dispatchEvidence?.phase === "acknowledged") {
            throw new ProviderTransientError("The acknowledged provider mutation has not yet been observed.");
          }
        }
      }
      const acknowledgedCreateId = command.kind === "create" && outbox.dispatchEvidence?.phase === "acknowledged"
        ? outbox.dispatchEvidence.providerEventId : null;
      const needsDispatch = !recoveredUpdate && !deleteAlreadyMissing && !acknowledgedCreateId;
      if (needsDispatch) {
        ({ connection, calendar } = await admit());
        outbox = { ...outbox, dispatchEvidence: {
          phase: "dispatched", providerEventId: command.kind === "create" ? null : command.providerEventId,
          dispatchedAt: this.#now().toISOString(),
          desiredFingerprint: command.kind === "delete" ? null : writableContentFingerprint(command.content)
        } };
        if (!await this.store.saveOutbox(outbox, leaseOwner)) {
          throw new CalendarProviderGatewayError("outbox_lease_lost", "The command lost its lease before provider dispatch.");
        }
      }
      const acknowledge = async (providerEventId: string) => {
        outbox = { ...outbox, dispatchEvidence: { ...outbox.dispatchEvidence!, phase: "acknowledged", providerEventId } };
        if (!await this.store.saveOutbox(outbox, leaseOwner)) {
          throw new CalendarProviderGatewayError("outbox_lease_lost", "The provider outcome is uncertain after an outbox lease change.");
        }
      };
      let result: CalendarProviderCommandResult;
      const dispatchCredential = requiredCredential(connection);
      const dispatchEpoch = connection.connectedAt;
      const authorizeDispatch = async () => {
        const current = await admit();
        if (current.connection.credentialHandle !== dispatchCredential || current.connection.connectedAt !== dispatchEpoch) {
          throw new CalendarProviderGatewayError("connection_inactive", "Calendar authorization changed before provider dispatch.");
        }
      };
      if (command.kind === "create") {
        const created = acknowledgedCreateId ? { providerEventId: acknowledgedCreateId } : await adapter.createEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          commandId: command.commandId,
          authorizeDispatch,
          content: cloneContent(command.content)
        });
        if (!isRecord(created)) {
          throw new CalendarProviderGatewayError("provider_readback_failed", "The provider create response has an invalid shape.");
        }
        assertIdentifier(created.providerEventId, "providerEventId");
        if (!acknowledgedCreateId) await acknowledge(created.providerEventId);
        await admit();
        const event = await this.#readback(adapter, connection, calendar, created.providerEventId, expectedCalendarUpdatedAt!);
        result = { kind: "create", event };
      } else if (command.kind === "update") {
        if (!recoveredUpdate) {
          await adapter.updateEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId,
          commandId: command.commandId,
          authorizeDispatch,
          expectedProviderRevision: command.expectedProviderRevision,
          content: cloneContent(command.content)
          });
          await acknowledge(command.providerEventId);
        }
        await admit();
        const event = await this.#readback(adapter, connection, calendar, command.providerEventId, expectedCalendarUpdatedAt!, recoveredUpdate ?? undefined);
        result = { kind: "update", event };
      } else {
        if (!deleteAlreadyMissing) {
          await adapter.deleteEvent({
          credentialHandle: requiredCredential(connection),
          providerAccountId: connection.providerAccountId,
          providerCalendarId: calendar.providerCalendarId,
          providerEventId: command.providerEventId,
          commandId: command.commandId,
          authorizeDispatch,
          expectedProviderRevision: command.expectedProviderRevision
          });
          await acknowledge(command.providerEventId);
        }
        await admit();
        const readback = deleteAlreadyMissing ? null : await adapter.readEvent({
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
          expectedCalendarUpdatedAt,
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
      if (error instanceof CalendarProviderGatewayError && error.code === "provider_event_read_only") {
        await this.store.saveOutbox({ ...outbox, status: "rejected", updatedAt: this.#now().toISOString(),
          nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null, lastErrorCode: "provider_unknown" }, leaseOwner);
        throw error;
      }
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
    expectedConnectedAt?: string;
    localProjectionDisposition: "retain_private_stale" | "purge";
  }): Promise<CalendarProviderConnectionView> {
    if (input.localProjectionDisposition !== "purge" && input.localProjectionDisposition !== "retain_private_stale") {
      throw new CalendarProviderGatewayError("invalid_input", "An explicit local projection disposition is required.");
    }
    const connection = await this.#ownedConnection(input.ownerId, input.connectionId, true);
    if (input.expectedConnectedAt !== undefined && connection.connectedAt !== input.expectedConnectedAt) {
      throw new CalendarProviderGatewayError("calendar_settings_conflict", "The account changed after removal was prepared.");
    }
    if (connection.status === "disconnected" && input.localProjectionDisposition === "purge") {
      await this.store.purgeConnectionProjections(connection.connectionId);
    }
    const locallyClosed = connection.status === "disconnected"
      ? connection
      : await this.#closeConnectionLocally(connection, input.localProjectionDisposition, input.expectedConnectedAt !== undefined);
    const finalConnection = locallyClosed.remoteRevocationStatus === "succeeded"
      ? locallyClosed
      : await this.#attemptRemoteRevocation(locallyClosed);
    return safeConnection(finalConnection);
  }

  async #closeConnectionLocally(
    connection: CalendarProviderConnectionRecord,
    localProjectionDisposition: "retain_private_stale" | "purge",
    requireIdleOutbox = false
  ): Promise<CalendarProviderConnectionRecord> {
    const disconnected: CalendarProviderConnectionRecord = {
      ...connection,
      status: "disconnected",
      disconnectedAt: connection.disconnectedAt ?? this.#now().toISOString(),
      remoteRevocationStatus: connection.remoteRevocationStatus === "succeeded" ? "succeeded" : "pending",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    };
    // Persist the inactive connection first. Even if a later cleanup write or
    // provider call fails, every gateway operation now fails closed.
    if (!await this.store.transitionConnection(disconnected, { ...connection, requireIdleOutbox, removalAt: this.#now().toISOString() })) {
      const current = await this.store.getConnection(connection.connectionId);
      if (current?.status === "disconnected" && current.credentialHandle === connection.credentialHandle && current.connectedAt === connection.connectedAt) return current;
      throw new CalendarProviderGatewayError("connection_inactive", "The connection changed before local closure.");
    }
    for (const calendar of await this.store.listCalendars(connection.connectionId)) {
      await this.store.updateCalendarBinding({ ...calendar, agentGrant: "none", visible: false });
    }
    if (localProjectionDisposition === "purge") {
      await this.store.purgeConnectionProjections(connection.connectionId);
    }
    return disconnected;
  }

  async #attemptRemoteRevocation(connection: CalendarProviderConnectionRecord): Promise<CalendarProviderConnectionRecord> {
    if (!connection.credentialHandle || !this.#adapters.has(connection.providerKey)) {
      const pending = {
        ...connection,
        remoteRevocationStatus: "pending" as const
      };
      if (await this.store.transitionConnection(pending, connection)) return pending;
      return (await this.store.getConnection(connection.connectionId))!;
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
      if (await this.store.transitionConnection(succeeded, connection)) return succeeded;
      return (await this.store.getConnection(connection.connectionId))!;
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
      if (await this.store.transitionConnection(failed, connection)) return failed;
      return (await this.store.getConnection(connection.connectionId))!;
    }
  }

  async #readback(
    adapter: CalendarProviderAdapter,
    connection: CalendarProviderConnectionRecord,
    calendar: CalendarProviderBindingRecord,
    providerEventId: string,
    expectedCalendarUpdatedAt: string,
    observed?: ProviderEventSnapshot
  ): Promise<CalendarProviderEventProjection> {
    const snapshot = observed ?? await adapter.readEvent({
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
      expectedCalendarUpdatedAt,
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
    if (!connection || connection.ownerId !== ownerId || await this.#removedConnection(connection)) {
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
  ): Promise<{ connection: CalendarProviderConnectionRecord; calendar: CalendarProviderBindingRecord; canonical: CalendarRecord }> {
    const connection = await this.store.getConnection(connectionId);
    if (!connection || connection.ownerId !== ownerId) {
      throw new CalendarProviderGatewayError("connection_not_found", "The calendar connection was not found.");
    }
    if (connection.status !== "active" && !(allowProvisioning && connection.status === "provisioning")) {
      throw new CalendarProviderGatewayError("connection_inactive", "The calendar connection is not active.");
    }
    const calendar = await this.store.getCalendar(connectionId, calendarId);
    const canonical = await this.store.getCanonicalCalendar(calendarId);
    if (!calendar || calendar.ownerId !== ownerId || !canonical || canonical.ownerId !== ownerId || canonical.deletedAt !== null) {
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
    return { connection, calendar, canonical };
  }
}

/** Deterministic non-durable store for adapter qualification and local tests. */
export class InMemoryCalendarProviderStateStore implements CalendarProviderStateStore {
  readonly #connections = new Map<string, CalendarProviderConnectionRecord>();
  readonly #canonicalCalendars = new Map<string, CalendarRecord>();
  readonly #calendars = new Map<string, Omit<CalendarProviderBindingRecord, "agentGrant">>();
  readonly #syncStates = new Map<string, CalendarProviderSyncState>();
  readonly #projections = new Map<string, CalendarProviderEventProjection>();
  readonly #tombstones = new Map<string, CalendarProviderEventTombstone>();
  readonly #outbox = new Map<string, CalendarProviderOutboxRecord>();
  readonly #hints = new Map<string, CalendarProviderWebhookHint>();

  async listConnections(ownerId: string) {
    return [...this.#connections.values()].filter((connection) => connection.ownerId === ownerId)
      .sort((left, right) => left.connectedAt.localeCompare(right.connectedAt) || left.connectionId.localeCompare(right.connectionId))
      .map((connection) => cloneConnection(connection)!);
  }
  async getConnection(connectionId: string) { return cloneConnection(this.#connections.get(connectionId) ?? null); }
  async saveConnection(connection: CalendarProviderConnectionRecord) { this.#connections.set(connection.connectionId, cloneConnection(connection)!); }
  async reserveConnection(connection: CalendarProviderConnectionRecord) {
    const existing = this.#connections.get(connection.connectionId);
    if (existing) return { record: cloneConnection(existing)!, created: false };
    this.#connections.set(connection.connectionId, cloneConnection(connection)!);
    return { record: cloneConnection(connection)!, created: true };
  }
  async transitionConnection(connection: CalendarProviderConnectionRecord, expected: CalendarProviderConnectionExpectation) {
    const current = this.#connections.get(connection.connectionId);
    if (!current || current.ownerId !== connection.ownerId || current.providerKey !== connection.providerKey
      || current.providerAccountId !== connection.providerAccountId || current.status !== expected.status
      || current.credentialHandle !== expected.credentialHandle
      || (expected.connectedAt !== undefined && current.connectedAt !== expected.connectedAt)) return false;
    if (expected.requireRetainedCalendars && ![...this.#calendars.values()].some((binding) => binding.connectionId === connection.connectionId)) return false;
    if (expected.requireIdleOutbox) this.#assertRemovalSafe(connection.connectionId, undefined, expected.removalAt);
    this.#connections.set(connection.connectionId, cloneConnection(connection)!);
    return true;
  }
  async listSynchronizationTargets(input: { providerKey?: string; limit: number; after: { connectionId: string; calendarId: string } | null }) {
    return [...this.#calendars.values()].filter((binding) => {
      const connection = this.#connections.get(binding.connectionId);
      return connection?.status === "active" && this.#canonicalCalendars.get(binding.calendarId)?.deletedAt === null
        && binding.capabilities.read && (!input.providerKey || binding.providerKey === input.providerKey)
        && (!input.after || binding.connectionId > input.after.connectionId
          || (binding.connectionId === input.after.connectionId && binding.calendarId > input.after.calendarId));
    }).sort((a, b) => a.connectionId.localeCompare(b.connectionId) || a.calendarId.localeCompare(b.calendarId))
      .slice(0, input.limit).map(({ ownerId, connectionId, calendarId, providerKey }) => ({ ownerId, connectionId, calendarId, providerKey }));
  }
  async listRetryableCommands(input: { providerKey?: string; limit: number; now: string }) {
    const now = Date.parse(input.now);
    return [...this.#outbox.values()].filter((record) => {
      const connection = this.#connections.get(record.command.connectionId);
      return record.command.actor === "owner" && connection?.status === "active"
        && this.#canonicalCalendars.get(record.command.calendarId)?.deletedAt === null
        && record.createdAt >= connection.connectedAt && (!input.providerKey || connection.providerKey === input.providerKey)
        && (record.status === "pending" || record.status === "processing")
        && (!record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now)
        && (!record.leaseExpiresAt || Date.parse(record.leaseExpiresAt) <= now);
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commandId.localeCompare(b.commandId)).slice(0, input.limit)
      .map(({ command }) => ({ commandId: command.commandId, ownerId: command.ownerId, connectionId: command.connectionId, calendarId: command.calendarId }));
  }
  async listRevocationTargets(input: { providerKey?: string; limit: number; now: string }) {
    return [...this.#connections.values()].filter((row) => row.status === "disconnected" && row.credentialHandle
      && row.remoteRevocationStatus !== "succeeded" && (!input.providerKey || row.providerKey === input.providerKey)
      && (!row.remoteRevocationAttemptedAt || Date.parse(row.remoteRevocationAttemptedAt) <= Date.parse(input.now) - 60_000))
      .sort((a,b) => (a.remoteRevocationAttemptedAt ?? "").localeCompare(b.remoteRevocationAttemptedAt ?? ""))
      .slice(0,input.limit).map(({ownerId,connectionId}) => ({ownerId,connectionId}));
  }
  async listCalendars(connectionId: string, includeRemoved = false) {
    return [...this.#calendars.values()].filter((calendar) => calendar.connectionId === connectionId &&
      (includeRemoved || this.#canonicalCalendars.get(calendar.calendarId)?.deletedAt === null))
      .map((calendar) => this.#bindingView(calendar));
  }
  async getCalendar(connectionId: string, calendarId: string) {
    const calendar = this.#calendars.get(calendarKey(connectionId, calendarId));
    return calendar ? this.#bindingView(calendar) : null;
  }
  #bindingView(binding: Omit<CalendarProviderBindingRecord, "agentGrant">): CalendarProviderBindingRecord {
    const canonical = this.#canonicalCalendars.get(binding.calendarId);
    if (!canonical) throw new CalendarProviderGatewayError("calendar_not_found", "The canonical external Calendar was not found.");
    return { ...binding, capabilities: { ...binding.capabilities }, agentGrant: canonical.agentAccess };
  }
  async getCanonicalCalendar(calendarId: string) {
    const calendar = this.#canonicalCalendars.get(calendarId);
    return calendar ? { ...calendar } : null;
  }
  async getManagedCalendar(connectionId: string, calendarId: string): Promise<CalendarConnectedCalendarView | null> {
    const binding = this.#calendars.get(calendarKey(connectionId, calendarId));
    const calendar = this.#canonicalCalendars.get(calendarId);
    return binding && calendar ? {
      calendar: { ...calendar }, connectionId,
      providerCalendarId: binding.providerCalendarId, providerDisplayName: binding.providerDisplayName,
      capabilities: { ...binding.capabilities }, visible: binding.visible
    } : null;
  }
  async provisionCalendar(calendar: CalendarRecord, binding: CalendarProviderBindingRecord, options?: { providerTimeZone?: string; expectedRemovedUpdatedAt?: string }) {
    assertCalendarProvisioningPair(calendar, binding);
    const providerTimeZone = options?.providerTimeZone === undefined ? undefined : normalizeCalendarIanaTimeZone(options.providerTimeZone);
    const connection = this.#connections.get(binding.connectionId);
    if (!connection || (connection.status !== "provisioning" && connection.status !== "active") || connection.ownerId !== calendar.ownerId
      || connection.providerKey !== binding.providerKey || connection.providerAccountId !== binding.providerAccountId) {
      throw new CalendarProviderGatewayError(
        "provider_identity_mismatch",
        "A canonical external Calendar may only be provisioned by its exact active provisioning connection."
      );
    }
    const key = calendarKey(binding.connectionId, binding.calendarId);
    const existing = this.#calendars.get(key);
    if (existing && existing.ownerId === binding.ownerId && existing.providerKey === binding.providerKey
      && existing.providerAccountId === binding.providerAccountId && existing.providerCalendarId === binding.providerCalendarId) {
      const canonical = this.#canonicalCalendars.get(calendar.id);
      if (canonical?.deletedAt !== null && canonical?.deletedAt !== undefined) {
        if (options?.expectedRemovedUpdatedAt !== canonical.updatedAt) throw new CalendarProviderGatewayError("calendar_settings_conflict", "The removed Calendar requires a fresh explicit selection.");
        const updatedAt = new Date(Math.max(Date.parse(calendar.updatedAt), Date.parse(canonical.updatedAt) + 1, Date.parse(canonical.deletedAt) + 1)).toISOString();
        this.#canonicalCalendars.set(calendar.id, { ...calendar, timeZone: providerTimeZone ?? calendar.timeZone,
          createdAt: canonical.createdAt, updatedAt, deletedAt: null });
        this.#calendars.set(key, cloneCalendar(binding));
        return;
      }
      if (!canonical || canonical.ownerId !== calendar.ownerId || canonical.source !== "external" || canonical.deletedAt !== null) {
        throw new CalendarProviderGatewayError("provider_identity_mismatch", "The canonical external Calendar is unavailable.");
      }
      if (providerTimeZone !== undefined && canonical.timeZone !== providerTimeZone) {
        this.#canonicalCalendars.set(canonical.id, { ...canonical, timeZone: providerTimeZone,
          updatedAt: nextCalendarSettingsTimestamp(new Date().toISOString(), canonical.updatedAt) });
      }
      return;
    }
    if (this.#canonicalCalendars.has(calendar.id) || this.#calendars.has(key)
      || [...this.#calendars.values()].some((candidate) => candidate.ownerId === binding.ownerId
        && (candidate.calendarId === binding.calendarId || (candidate.connectionId === binding.connectionId && candidate.providerCalendarId === binding.providerCalendarId)))) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The external Calendar identity is already provisioned.");
    }
    if (calendar.isDefault && [...this.#canonicalCalendars.values()].some((candidate) =>
      candidate.ownerId === calendar.ownerId && candidate.isDefault && candidate.deletedAt === null)) {
      throw new CalendarProviderGatewayError("invalid_input", "The owner already has a default Calendar.");
    }
    this.#canonicalCalendars.set(calendar.id, { ...calendar, ...(providerTimeZone === undefined ? {} : { timeZone: providerTimeZone }) });
    const { agentGrant: _grant, ...metadata } = cloneCalendar(binding);
    this.#calendars.set(key, metadata);
  }
  async updateCalendarBinding(calendar: CalendarProviderBindingRecord, options?: CalendarProviderBindingUpdateOptions) {
    const key = calendarKey(calendar.connectionId, calendar.calendarId);
    const existing = this.#calendars.get(key);
    const canonical = this.#canonicalCalendars.get(calendar.calendarId);
    if (!existing || !canonical) {
      throw new CalendarProviderGatewayError("calendar_not_found", "The canonical external Calendar binding was not found.");
    }
    assertCalendarProvisioningPair({ ...canonical, agentAccess: calendar.agentGrant }, calendar);
    if (existing.ownerId !== calendar.ownerId || existing.providerKey !== calendar.providerKey
      || existing.providerAccountId !== calendar.providerAccountId
      || existing.providerCalendarId !== calendar.providerCalendarId) {
      throw new CalendarProviderGatewayError("provider_identity_mismatch", "The provider Calendar binding identity cannot change.");
    }
    if (options && "provisioningConnection" in options) {
      const connection = this.#connections.get(calendar.connectionId);
      if (connection?.status !== "provisioning" || connection.status !== options.provisioningConnection.status
        || connection.credentialHandle !== options.provisioningConnection.credentialHandle) {
        throw new CalendarProviderGatewayError("connection_inactive", "The reconnect changed before its Calendar permissions were saved.");
      }
    }
    if (options && "expectedUpdatedAt" in options && (canonical.updatedAt !== options.expectedUpdatedAt
      || this.#connections.get(calendar.connectionId)?.status !== "active")) {
      throw new CalendarProviderGatewayError("calendar_settings_conflict", "Calendar settings changed. Reload before saving.");
    }
    this.#canonicalCalendars.set(canonical.id, {
      ...canonical,
      agentAccess: calendar.agentGrant,
      updatedAt: options && "updatedAt" in options ? options.updatedAt : nextCalendarSettingsTimestamp(new Date().toISOString(), canonical.updatedAt)
    });
    const { agentGrant: _grant, ...metadata } = cloneCalendar(calendar);
    this.#calendars.set(key, metadata);
  }
  async rollbackProvisioning(connectionId: string, removal?: { expectedConnectedAt: string; now?: string }) {
    this.#assertRemovalSafe(connectionId, undefined, removal?.now);
    const connection = this.#connections.get(connectionId);
    if (!connection || connection.status !== "disconnected" || (removal &&
      (connection.connectedAt !== removal.expectedConnectedAt || connection.credentialHandle !== null))) {
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
    for (const [key, value] of this.#projections) if (value.connectionId === connectionId) this.#projections.delete(key);
    for (const [key, value] of this.#tombstones) if (value.connectionId === connectionId) this.#tombstones.delete(key);
    for (const binding of bindings) {
      this.#calendars.delete(calendarKey(binding.connectionId, binding.calendarId));
      this.#canonicalCalendars.delete(binding.calendarId);
      this.#syncStates.delete(calendarKey(binding.connectionId, binding.calendarId));
    }
    for (const [key, record] of this.#outbox) {
      if (record.command.connectionId === connectionId) this.#outbox.delete(key);
    }
    for (const [key, hint] of this.#hints) if (hint.connectionId === connectionId) this.#hints.delete(key);
  }
  async assertRemovalSafe(connectionId: string, calendarId?: string, now?: string) {
    this.#assertRemovalSafe(connectionId, calendarId, now);
  }
  #assertRemovalSafe(connectionId: string, calendarId?: string, now?: string) {
    const connection = this.#connections.get(connectionId);
    const at = now === undefined ? Date.now() : Date.parse(now);
    if ([...this.#outbox.values()].some((record) => record.command.connectionId === connectionId &&
      (calendarId === undefined || record.command.calendarId === calendarId) &&
      ((record.leaseOwner !== null && (record.leaseExpiresAt === null || Date.parse(record.leaseExpiresAt) > at)) ||
        (connection?.status !== "disconnected" && record.createdAt >= (connection?.connectedAt ?? "") &&
          (record.status === "processing" || (record.status === "pending" && record.dispatchEvidence)))))) {
      throw new CalendarProviderGatewayError("command_in_progress", "A provider write is still in progress or awaiting reconciliation; remove this Calendar after it settles.");
    }
  }
  async removeConnectedCalendar(input: { ownerId: string; connectionId: string; calendarId: string; expectedUpdatedAt: string; deletedAt: string }) {
    const connection = this.#connections.get(input.connectionId);
    const key = calendarKey(input.connectionId, input.calendarId);
    const binding = this.#calendars.get(key);
    const canonical = this.#canonicalCalendars.get(input.calendarId);
    if (!connection || connection.ownerId !== input.ownerId || !binding || binding.ownerId !== input.ownerId ||
      !canonical || canonical.ownerId !== input.ownerId || canonical.source !== "external") {
      throw new CalendarProviderGatewayError("calendar_not_found", "The exact external Calendar was not found.");
    }
    if (canonical.updatedAt !== input.expectedUpdatedAt) throw new CalendarProviderGatewayError("calendar_settings_conflict", "The Calendar changed after removal was prepared.");
    if (canonical.deletedAt !== null) return;
    this.#assertRemovalSafe(input.connectionId, input.calendarId, input.deletedAt);
    // Retain the pre-removal revision for exact retry; restoration advances it.
    this.#canonicalCalendars.set(input.calendarId, { ...canonical, title: "Removed calendar", color: "#2f6f5f", timeZone: "UTC",
      deletedAt: input.deletedAt, agentAccess: "none", isDefault: false });
    this.#calendars.set(key, { ...binding, providerDisplayName: "Removed calendar", visible: false });
    this.#syncStates.delete(key);
    for (const [event, record] of this.#projections) if (record.connectionId === input.connectionId && record.calendarId === input.calendarId) this.#projections.delete(event);
    for (const [event, record] of this.#tombstones) if (record.connectionId === input.connectionId && record.calendarId === input.calendarId) this.#tombstones.delete(event);
    for (const [command, record] of this.#outbox) if (record.command.connectionId === input.connectionId && record.command.calendarId === input.calendarId) {
      // Only an inert identity/fingerprint marker survives, never event content.
      const original = record.command;
      this.#outbox.set(command, { ...record, command: { kind: "delete", commandId: original.commandId,
        ownerId: original.ownerId, connectionId: original.connectionId, calendarId: original.calendarId, actor: original.actor,
        providerEventId: original.kind === "create" ? "removed" : original.providerEventId,
        expectedProviderRevision: original.kind === "create" ? "removed" : original.expectedProviderRevision },
        status: "rejected", result: null, dispatchEvidence: null, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, updatedAt: input.deletedAt });
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
  async pageProjections(connectionId: string, calendarId: string, after: string | null, limit: number) {
    const rows = [...this.#projections.values()]
      .filter((row) => row.connectionId === connectionId && row.calendarId === calendarId && (after === null || row.providerEventId > after))
      .sort((a, b) => a.providerEventId < b.providerEventId ? -1 : a.providerEventId > b.providerEventId ? 1 : 0);
    const items = rows.slice(0, limit).map(cloneProjection);
    return { items, nextAfter: rows.length > limit ? items.at(-1)!.providerEventId : null };
  }
  async findCalendarConnection(ownerId: string, calendarId: string) {
    return [...this.#calendars.values()].find((row) => row.ownerId === ownerId && row.calendarId === calendarId)?.connectionId ?? null;
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
    const connection = this.#connections.get(mutation.connectionId);
    if (!connection || (connection.status !== "active" && connection.status !== "provisioning")) {
      throw new CalendarProviderGatewayError("connection_inactive", "A disconnected account cannot publish synchronized events.");
    }
    const key = calendarKey(mutation.connectionId, mutation.calendarId);
    const calendar = this.#canonicalCalendars.get(mutation.calendarId);
    if (!calendar || calendar.deletedAt !== null || (mutation.expectedCalendarUpdatedAt !== undefined && calendar.updatedAt !== mutation.expectedCalendarUpdatedAt)) {
      throw new CalendarProviderGatewayError("calendar_settings_conflict", "The Calendar was removed or changed before synchronization committed.");
    }
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
  async reserveOutbox(record: CalendarProviderOutboxRecord, expectedCalendarUpdatedAt?: string) {
    if (expectedCalendarUpdatedAt !== undefined) {
      const canonical = this.#canonicalCalendars.get(record.command.calendarId);
      const connection = this.#connections.get(record.command.connectionId);
      if (!canonical || canonical.deletedAt !== null || canonical.updatedAt !== expectedCalendarUpdatedAt || connection?.status !== "active") {
        throw new CalendarProviderGatewayError("calendar_settings_conflict", "The Calendar changed before the command was queued.");
      }
    }
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
    if (current.fingerprint !== input.fingerprint || current.status === "succeeded" || current.status === "conflict" || current.status === "rejected") {
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
    for (const [key, state] of this.#syncStates) if (state.connectionId === connectionId) this.#syncStates.delete(key);
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
      agentAccess: calendar.agentAccess,
      createdAt: calendar.createdAt
    });
  } catch {
    throw new CalendarProviderGatewayError("invalid_input", "The canonical external Calendar is invalid.");
  }
  if (calendar.source !== "external" || calendar.deletedAt !== null
    || !Number.isFinite(Date.parse(calendar.updatedAt)) || Date.parse(calendar.updatedAt) < Date.parse(normalized.updatedAt)
    || calendar.id !== normalized.id || calendar.ownerId !== normalized.ownerId
    || calendar.title !== normalized.title || calendar.color !== normalized.color
    || calendar.timeZone !== normalized.timeZone || calendar.isDefault !== normalized.isDefault
    || calendar.agentAccess !== normalized.agentAccess || binding.agentGrant !== calendar.agentAccess
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
  const { credentialHandle: _credentialHandle, accountEmail: storedEmail, ...safe } = connection;
  const accountEmail = normalizeProviderAccountEmail(storedEmail);
  return { ...safe, ...(accountEmail === undefined ? {} : { accountEmail }) };
}

function nextCalendarSettingsTimestamp(now: string, previous: string): string {
  return new Date(Math.max(Date.parse(now), Date.parse(previous) + 1)).toISOString();
}

function requiredCredential(connection: CalendarProviderConnectionRecord): CalendarProviderCredentialHandle {
  if (!connection.credentialHandle) {
    throw new CalendarProviderGatewayError("connection_inactive", "The calendar connection has no active credential authorization.");
  }
  return connection.credentialHandle;
}

export function assertAgentGrant(grant: CalendarAgentGrant, capabilities: CalendarProviderCapabilities) {
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
    if (candidate.timeZone !== undefined) assertBoundedString(candidate.timeZone, "timeZone", 100);
    let timeZone: string | undefined;
    if (candidate.timeZone !== undefined) {
      try { timeZone = normalizeCalendarIanaTimeZone(candidate.timeZone); }
      catch { throw new CalendarProviderGatewayError("invalid_input", "The provider Calendar time zone is invalid."); }
    }
    return {
      providerCalendarId: candidate.providerCalendarId,
      displayName: candidate.displayName,
      ...(typeof candidate.isDefault === "boolean" ? { isDefault: candidate.isDefault } : {}),
      ...(timeZone === undefined ? {} : { timeZone }),
      capabilities: normalizeCapabilities(candidate.capabilities)
    };
  });
  if (new Set(calendars.map((calendar) => calendar.providerCalendarId)).size !== calendars.length) {
    throw new CalendarProviderGatewayError("provider_identity_mismatch", "Provider discovery returned duplicate Calendar identities.");
  }
  const accountEmail = normalizeProviderAccountEmail(input.accountEmail);
  return { providerKey: input.providerKey, providerAccountId: input.providerAccountId,
    ...(accountEmail === undefined ? {} : { accountEmail }), calendars };
}

/** Provider-supplied owner display metadata only. Missing/malformed labels never redefine account identity. */
export function normalizeProviderAccountEmail(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value)
    ? value : undefined;
}

function normalizeSyncBatch(input: CalendarProviderSyncBatch): CalendarProviderSyncBatch {
  if (!isRecord(input) || !Array.isArray(input.upserts) || !Array.isArray(input.deletions) ||
      typeof input.completeWindowSnapshot !== "boolean" || typeof input.truncated !== "boolean") {
    throw new CalendarProviderGatewayError("invalid_input", "The provider synchronization response has an invalid shape.");
  }
  assertBoundedString(input.nextSyncCursor, "nextSyncCursor", 65_536);
  if (!input.nextSyncCursor) throw new CalendarProviderGatewayError("invalid_input", "A synchronization cursor is required.");
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
  if (Object.keys(content).some((key) => !["title", "description", "location", "span", "providerSeriesId", "status", "providerRecurrence", "outboundEffects"].includes(key))) {
    throw new CalendarProviderGatewayError("invalid_input", "Provider event content contains unsupported fields.");
  }
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
  const providerRecurrence = content.providerRecurrence;
  if (providerRecurrence !== undefined && (!isRecord(providerRecurrence)
    || !["single", "series_master", "occurrence", "exception"].includes(providerRecurrence.kind)
    || (providerRecurrence.originalStartUtc !== null && typeof providerRecurrence.originalStartUtc !== "string"))) {
    throw new CalendarProviderGatewayError("invalid_input", "Provider recurrence metadata is invalid.");
  }
  const outboundEffects = content.outboundEffects;
  if (outboundEffects !== undefined && (!isRecord(outboundEffects) || !Number.isSafeInteger(outboundEffects.attendeeCount)
    || outboundEffects.attendeeCount < 0 || typeof outboundEffects.hasOnlineMeeting !== "boolean")) {
    throw new CalendarProviderGatewayError("invalid_input", "Provider effects metadata is invalid.");
  }
  return { title: content.title, description, location, span, providerSeriesId, status: content.status,
    ...(providerRecurrence === undefined ? {} : { providerRecurrence: { kind: providerRecurrence.kind,
      originalStartUtc: providerRecurrence.originalStartUtc === null ? null : normalizeUtcInstant(providerRecurrence.originalStartUtc, "originalStartUtc") } }),
    ...(outboundEffects === undefined ? {} : { outboundEffects: { ...outboundEffects } }) };
}

function normalizeCommand(command: CalendarProviderCommand): CalendarProviderCommand {
  if (!isRecord(command) || (command.kind !== "create" && command.kind !== "update" && command.kind !== "delete")) {
    throw new CalendarProviderGatewayError("invalid_input", "The provider command has an invalid shape.");
  }
  if (Object.keys(command).some((key) => !["kind", "commandId", "ownerId", "connectionId", "calendarId", "actor",
    ...(command.kind === "delete" ? [] : ["content"]), ...(command.kind === "create" ? [] : ["providerEventId", "expectedProviderRevision"])].includes(key))) {
    throw new CalendarProviderGatewayError("invalid_input", "Provider command contains unsupported fields or scope.");
  }
  assertIdentifier(command.commandId, "commandId");
  assertIdentifier(command.ownerId, "ownerId");
  assertIdentifier(command.connectionId, "connectionId");
  assertActor(command.actor);
  const calendarId = canonicalCalendarId(command.calendarId);
  const content = command.kind === "delete" ? undefined : normalizeContent(command.content);
  if (content) assertStandaloneProviderWrite(content);
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
        agentAccess: agentGrant,
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
  return { ...content, span: { ...content.span },
    ...(content.providerRecurrence ? { providerRecurrence: { ...content.providerRecurrence } } : {}),
    ...(content.outboundEffects ? { outboundEffects: { ...content.outboundEffects } } : {}) };
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
  return { ...value, command: cloneCommand(value.command), result: value.result ? cloneResult(value.result) : null,
    dispatchEvidence: value.dispatchEvidence ? { ...value.dispatchEvidence } : null };
}

function boundedPageLimit(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new CalendarProviderGatewayError("invalid_input", "A page limit from 1 to 100 is required.");
  return value;
}

function decodeSynchronizationCursor(cursor: string): { connectionId: string; calendarId: string } {
  try {
    if (cursor.length > 2048) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    assertIdentifier(value.connectionId, "connectionId");
    canonicalCalendarId(value.calendarId);
    return { connectionId: value.connectionId, calendarId: value.calendarId };
  } catch { throw new CalendarProviderGatewayError("invalid_input", "The synchronization cursor is invalid."); }
}

export function assertStandaloneProviderWrite(content: ProviderEventContent): void {
  if (content.providerSeriesId || (content.providerRecurrence && content.providerRecurrence.kind !== "single")
    || (content.outboundEffects && (content.outboundEffects.attendeeCount > 0 || content.outboundEffects.hasOnlineMeeting))) {
    throw new CalendarProviderGatewayError("provider_event_read_only", "Invitations, conferencing, and recurring provider mutations are not admitted by this release.");
  }
}

function writableContentFingerprint(content: ProviderEventContent): string {
  const span = content.span.kind === "all_day" ? content.span : {
    kind: "timed", startUtc: normalizeUtcInstant(content.span.startUtc, "startUtc"), endUtc: normalizeUtcInstant(content.span.endUtc, "endUtc")
  };
  return createHash("sha256").update(stableFingerprint({ title: content.title, description: content.description || null,
    location: content.location || null, status: content.status, span })).digest("hex");
}
