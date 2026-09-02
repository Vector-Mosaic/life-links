import { describe, expect, it } from "vitest";
import { createCanonicalCalendar, createCanonicalExternalCalendar } from "@life-links/core";

import {
  CalendarProviderGateway,
  CalendarProviderGatewayError,
  InMemoryCalendarProviderStateStore,
  ProviderTransientError,
  calendarProviderCredentialHandle,
  type CalendarProviderCommand,
  type CalendarProviderWindow,
  type ProviderEventContent,
  type ProviderEventSnapshot
} from "../src/calendar-provider-gateway.js";
import { DeterministicFakeCalendarProviderAdapter } from "../src/calendar-provider-fake.js";
import { PostgresCalendarProviderStateStore } from "../src/calendar-provider-postgres.js";

const OWNER_ID = "owner-calendar-test";
const CONNECTION_ID = "connection-fake-one";
const CALENDAR_ID = "calendar-11111111-1111-4111-8111-111111111111";
const PROVIDER_KEY = "deterministic-fake";
const PROVIDER_ACCOUNT_ID = "account-fake-one";
const PROVIDER_CALENDAR_ID = "provider-calendar-one";
const WINDOW: CalendarProviderWindow = {
  startUtc: "2026-01-01T00:00:00.000Z",
  endUtc: "2027-01-01T00:00:00.000Z"
};
const WRITABLE = { read: true, create: true, update: true, delete: true };
const LOCAL_CALENDAR_FIELDS = {
  title: "Family calendar",
  color: "#2f6f5f",
  timeZone: "America/New_York",
  isDefault: false
} as const;

function timed(title: string, start = "2026-09-01T14:00:00.000Z"): ProviderEventContent {
  const end = new Date(Date.parse(start) + 3_600_000).toISOString();
  return {
    title,
    description: `${title} details`,
    location: "Test room",
    status: "confirmed",
    providerSeriesId: null,
    span: {
      kind: "timed",
      startUtc: start,
      endUtc: end,
      sourceTimeZone: "America/New_York",
      floatingLocalStart: null,
      floatingLocalEnd: null
    }
  };
}

function clock() {
  let tick = 0;
  return () => new Date(Date.parse("2026-09-01T12:00:00.000Z") + tick++ * 1_000);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the deterministic fake boundary.");
}

function fake(seedEvents: ProviderEventSnapshot[] = [], capabilities = WRITABLE) {
  return new DeterministicFakeCalendarProviderAdapter(PROVIDER_KEY, PROVIDER_ACCOUNT_ID, [{
    providerCalendarId: PROVIDER_CALENDAR_ID,
    displayName: "Qualified fake calendar",
    capabilities,
    events: seedEvents
  }]);
}

function providerBinding() {
  return {
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    providerKey: PROVIDER_KEY,
    providerAccountId: PROVIDER_ACCOUNT_ID,
    calendarId: CALENDAR_ID,
    providerCalendarId: PROVIDER_CALENDAR_ID,
    providerDisplayName: "Qualified fake calendar",
    capabilities: WRITABLE,
    agentGrant: "none" as const,
    visible: true
  };
}

function scriptedProvisioningPool(failBindingInsert = false) {
  const statements: string[] = [];
  const client = {
    async query(statement: string) {
      const normalized = statement.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT * FROM calendar_provider_connections")) {
        return {
          rowCount: 1,
          rows: [{
            connection_id: CONNECTION_ID,
            owner_id: OWNER_ID,
            provider_key: PROVIDER_KEY,
            provider_account_id: PROVIDER_ACCOUNT_ID,
            status: "provisioning",
            credential_handle: "vault-handle",
            connected_at: "2026-09-01T12:00:00.000Z",
            disconnected_at: null,
            remote_revocation_status: "not_required",
            remote_revocation_attempted_at: null,
            remote_revocation_error_code: null
          }]
        };
      }
      if (failBindingInsert && normalized.startsWith("INSERT INTO calendar_provider_bindings")) {
        throw new Error("binding insert failed");
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  return {
    statements,
    pool: { async connect() { return client; } }
  };
}

async function connected(input: {
  seedEvents?: ProviderEventSnapshot[];
  agentGrant?: "none" | "read" | "write";
  capabilities?: typeof WRITABLE;
} = {}) {
  const adapter = fake(input.seedEvents, input.capabilities);
  const store = new InMemoryCalendarProviderStateStore();
  const gateway = new CalendarProviderGateway([adapter], store, { now: clock(), maxInitialWindowDays: 366 });
  const rawVaultRecordId = "vault-record-that-must-never-leave-the-server";
  const result = await gateway.connectExternalAccount({
    ownerId: OWNER_ID,
    connectionId: CONNECTION_ID,
    providerKey: PROVIDER_KEY,
    expectedProviderAccountId: PROVIDER_ACCOUNT_ID,
    credentialHandle: calendarProviderCredentialHandle(rawVaultRecordId),
    calendars: [{
      calendarId: CALENDAR_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      ...LOCAL_CALENDAR_FIELDS,
      agentGrant: input.agentGrant
    }],
    initialWindow: WINDOW
  });
  return { adapter, store, gateway, result, rawVaultRecordId };
}

describe("provider-neutral Calendar gateway", () => {
  it("stages discovery without a connection and retries completed selection without resetting grants", async () => {
    const adapter = fake();
    const store = new InMemoryCalendarProviderStateStore();
    const gateway = new CalendarProviderGateway([adapter], store, { now: clock(), maxInitialWindowDays: 366 });
    const identity = { ownerId: OWNER_ID, providerKey: PROVIDER_KEY, expectedProviderAccountId: PROVIDER_ACCOUNT_ID,
      credentialHandle: calendarProviderCredentialHandle("discovery-vault-handle") };
    const discovery = await gateway.discoverExternalCalendars(identity);
    expect(discovery.calendars[0].providerCalendarId).toBe(PROVIDER_CALENDAR_ID);
    expect(await store.listConnections(OWNER_ID)).toEqual([]);
    const input = { ...identity, connectionId: CONNECTION_ID, initialWindow: WINDOW,
      calendars: [{ calendarId: CALENDAR_ID, providerCalendarId: PROVIDER_CALENDAR_ID, ...LOCAL_CALENDAR_FIELDS }] };
    await gateway.connectExternalAccount(input);
    await gateway.setCalendarAgentGrant({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, agentGrant: "write",
      expectedUpdatedAt: (await store.getCanonicalCalendar(CALENDAR_ID))!.updatedAt });
    const fetches = adapter.metrics().fetchCalls.length;
    const retried = await gateway.connectExternalAccount(input);
    expect(retried.calendars[0].agentGrant).toBe("write");
    expect(adapter.metrics().fetchCalls).toHaveLength(fetches);
    expect(await store.listConnections(OWNER_ID)).toHaveLength(1);
  });

  it("recovers uncertain update and delete from exact provider readback without redispatch", async () => {
    const seed = { providerEventId: "uncertain-event", providerRevision: "r1", content: timed("Before") };
    const { adapter, gateway, store } = await connected({ seedEvents: [seed] });
    const update: CalendarProviderCommand = { kind: "update", commandId: "uncertain-update", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", providerEventId: seed.providerEventId,
      expectedProviderRevision: seed.providerRevision, content: timed("After") };
    adapter.failOnceAfterCommit(update.commandId);
    await expect(gateway.executeCommand(update)).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await store.getOutbox(update.commandId))?.dispatchEvidence?.phase).toBe("dispatched");
    const updated = await gateway.executeCommand(update);
    if (updated.kind === "delete") throw new Error("Expected update");
    expect(updated.event.content.title).toBe("After");
    expect(adapter.metrics().commandAttempts.update).toBe(1);
    const deletion: CalendarProviderCommand = { kind: "delete", commandId: "uncertain-delete", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", providerEventId: seed.providerEventId,
      expectedProviderRevision: updated.event.providerRevision };
    adapter.failOnceAfterCommit(deletion.commandId);
    await expect(gateway.executeCommand(deletion)).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await gateway.executeCommand(deletion)).kind).toBe("delete");
    expect(adapter.metrics().commandAttempts.delete).toBe(1);
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).toBeNull();
  });

  it("adds exact discovered calendars to an existing account with default-deny grants and retry-safe identities", async () => {
    const secondaryId = "calendar-22222222-2222-4222-8222-222222222222";
    const adapter = new DeterministicFakeCalendarProviderAdapter(PROVIDER_KEY, PROVIDER_ACCOUNT_ID, [
      { providerCalendarId: PROVIDER_CALENDAR_ID, displayName: "First", capabilities: WRITABLE },
      { providerCalendarId: "secondary-calendar", displayName: "Second", capabilities: WRITABLE }
    ]);
    const store = new InMemoryCalendarProviderStateStore();
    const gateway = new CalendarProviderGateway([adapter], store, { now: clock(), maxInitialWindowDays: 366 });
    await gateway.connectExternalAccount({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, providerKey: PROVIDER_KEY,
      expectedProviderAccountId: PROVIDER_ACCOUNT_ID, credentialHandle: calendarProviderCredentialHandle("selection-handle"),
      initialWindow: WINDOW, calendars: [{ calendarId: CALENDAR_ID, providerCalendarId: PROVIDER_CALENDAR_ID, ...LOCAL_CALENDAR_FIELDS }] });
    const selection = { ownerId: OWNER_ID, connectionId: CONNECTION_ID, initialWindow: WINDOW,
      calendars: [{ calendarId: secondaryId, providerCalendarId: "secondary-calendar", ...LOCAL_CALENDAR_FIELDS, agentGrant: "write" as const }] };
    await expect(gateway.selectExternalCalendars({ ...selection, calendars: [...selection.calendars,
      { ...selection.calendars[0], calendarId: "calendar-33333333-3333-4333-8333-333333333333", providerCalendarId: "not-discovered" }]
    })).rejects.toMatchObject({ code: "provider_identity_mismatch" });
    expect(await store.getCanonicalCalendar(secondaryId)).toBeNull();
    await gateway.selectExternalCalendars(selection);
    await gateway.selectExternalCalendars(selection);
    expect(await store.listCalendars(CONNECTION_ID)).toHaveLength(2);
    expect((await store.getCanonicalCalendar(secondaryId))?.agentAccess).toBe("none");
  });

  it("a changed visible window fetches a complete snapshot without deleting events outside that window", async () => {
    const seed = { providerEventId: "outside-new-window", providerRevision: "r1", content: timed("Keep September") };
    const { adapter, gateway, store } = await connected({ seedEvents: [seed] });
    adapter.expireCursor((await store.getSyncState(CONNECTION_ID, CALENDAR_ID))!.syncCursor!);
    const october = { startUtc: "2026-10-01T00:00:00.000Z", endUtc: "2026-11-01T00:00:00.000Z" };
    await gateway.synchronizeCalendar({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, window: october });
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).not.toBeNull();
    expect(adapter.metrics().fetchCalls.at(-1)).toMatchObject({ syncCursor: null, window: october });
  });

  it("reconnects an active exact account with stable Calendar IDs, fresh grants and no old queued replay", async () => {
    const { adapter, gateway, store } = await connected({ agentGrant: "write" });
    const command: CalendarProviderCommand = { kind: "create", commandId: "before-reauthorization", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", content: timed("Old pending command") };
    adapter.failOnceAfterCommit(command.commandId);
    await expect(gateway.executeCommand(command)).rejects.toBeInstanceOf(ProviderTransientError);
    const oldConnection = (await store.getConnection(CONNECTION_ID))!;
    const nextHandle = calendarProviderCredentialHandle("replacement-credential");
    let cleanupCalls = 0;
    // The deterministic fake normally revokes the whole fake server. Here the
    // credential owner removes just the exact old application cache, like MSAL.
    adapter.revokeConnection = async ({ credentialHandle }) => {
      expect(credentialHandle).toBe(oldConnection.credentialHandle);
      expect((await store.getConnection(CONNECTION_ID))?.status).toBe("disconnected");
      cleanupCalls++;
    };
    await gateway.reconnectConnection({ ownerId: OWNER_ID, connectionId: CONNECTION_ID,
      expectedProviderAccountId: PROVIDER_ACCOUNT_ID, credentialHandle: nextHandle, initialWindow: WINDOW }, {
      beforeCredentialReplacement: async (input) => {
        expect(input).toMatchObject({ credentialHandle: oldConnection.credentialHandle, replacementCredentialHandle: nextHandle });
        expect((await store.getCanonicalCalendar(CALENDAR_ID))?.agentAccess).toBe("none");
      }
    });
    const reconnected = (await store.getConnection(CONNECTION_ID))!;
    expect(reconnected).toMatchObject({ status: "active", credentialHandle: nextHandle });
    expect(reconnected.connectedAt > oldConnection.connectedAt).toBe(true);
    expect((await store.listCalendars(CONNECTION_ID)).map((row) => row.calendarId)).toEqual([CALENDAR_ID]);
    expect((await store.getCanonicalCalendar(CALENDAR_ID))?.agentAccess).toBe("none");
    expect(await gateway.listRetryableCommands()).toEqual([]);
    await expect(gateway.executeCommand(command)).rejects.toMatchObject({ code: "connection_inactive" });
    expect(cleanupCalls).toBe(1);
    await gateway.reconnectConnection({ ownerId: OWNER_ID, connectionId: CONNECTION_ID,
      expectedProviderAccountId: PROVIDER_ACCOUNT_ID, credentialHandle: nextHandle, initialWindow: WINDOW });
    expect(cleanupCalls).toBe(1);
  });

  it("uses an acknowledged create identity after readback failure rather than posting again", async () => {
    const { adapter, gateway, store } = await connected();
    const read = adapter.readEvent.bind(adapter);
    let failed = false;
    adapter.readEvent = async (input) => { if (!failed) { failed = true; throw new ProviderTransientError("Read interrupted"); } return read(input); };
    const command: CalendarProviderCommand = { kind: "create", commandId: "acknowledged-create", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", content: timed("One event") };
    await expect(gateway.executeCommand(command)).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await store.getOutbox(command.commandId))?.dispatchEvidence).toMatchObject({ phase: "acknowledged", providerEventId: expect.any(String) });
    expect((await gateway.executeCommand(command)).kind).toBe("create");
    expect(adapter.metrics().commandAttempts.create).toBe(1);
  });

  it("does not overwrite a later provider edit while recovering an uncertain update", async () => {
    const seed = { providerEventId: "racing-event", providerRevision: "r1", content: timed("Before") };
    const { adapter, gateway } = await connected({ seedEvents: [seed] });
    const command: CalendarProviderCommand = { kind: "update", commandId: "racing-update", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", providerEventId: seed.providerEventId,
      expectedProviderRevision: seed.providerRevision, content: timed("Requested") };
    adapter.failOnceAfterCommit(command.commandId);
    await expect(gateway.executeCommand(command)).rejects.toBeInstanceOf(ProviderTransientError);
    adapter.externalUpdate(PROVIDER_CALENDAR_ID, seed.providerEventId, timed("Later provider change"));
    await expect(gateway.executeCommand(command)).rejects.toMatchObject({ code: "provider_revision_conflict" });
    expect(adapter.metrics().commandAttempts.update).toBe(1);
  });

  it("requires live agent admission before dispatch and replay and never schedules agent retries", async () => {
    const { adapter, gateway } = await connected({ agentGrant: "write" });
    const command: CalendarProviderCommand = { kind: "create", commandId: "live-agent-create", ownerId: OWNER_ID,
      connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "agent", content: timed("Agent request") };
    await expect(gateway.executeCommand(command)).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
    let admits = 0;
    await expect(gateway.executeCommand(command, { authorizeAgent: async () => {
      if (++admits === 3) throw new CalendarProviderGatewayError("agent_calendar_access_denied", "Disconnected");
    } })).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
    expect(adapter.eventCount(PROVIDER_CALENDAR_ID)).toBe(0);
    expect(await gateway.listRetryableCommands()).toEqual([]);
    await gateway.executeCommand(command, { authorizeAgent: async () => {} });
    await expect(gateway.executeCommand(command, { authorizeAgent: async () => {
      throw new CalendarProviderGatewayError("agent_calendar_access_denied", "Disconnected");
    } })).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
  });

  it("refuses invitation, conferencing, and recurring provider writes using authoritative current state", async () => {
    for (const patch of [
      { outboundEffects: { attendeeCount: 1, hasOnlineMeeting: false } },
      { outboundEffects: { attendeeCount: 0, hasOnlineMeeting: true } },
      { providerSeriesId: "series-one", providerRecurrence: { kind: "occurrence" as const, originalStartUtc: "2026-09-01T14:00:00.000Z" } }
    ]) {
      const seed = { providerEventId: "restricted-event", providerRevision: "r1", content: { ...timed("Read only"), ...patch } };
      const { adapter, gateway, store } = await connected({ seedEvents: [seed] });
      await expect(gateway.executeCommand({ kind: "delete", commandId: "restricted-delete", ownerId: OWNER_ID,
        connectionId: CONNECTION_ID, calendarId: CALENDAR_ID, actor: "owner", providerEventId: seed.providerEventId,
        expectedProviderRevision: seed.providerRevision })).rejects.toMatchObject({ code: "provider_event_read_only" });
      expect(adapter.metrics().commandAttempts.delete).toBe(0);
      expect((await store.getOutbox("restricted-delete"))?.status).toBe("rejected");
      expect(await gateway.listRetryableCommands()).toEqual([]);
    }
  });

  it("rechecks live agent read admission immediately before synchronization and before publication", async () => {
    const { adapter, gateway } = await connected({ agentGrant: "read" });
    const before = adapter.metrics().fetchCalls.length;
    let admits = 0;
    await expect(gateway.synchronizeCalendar({ ownerId: OWNER_ID, connectionId: CONNECTION_ID, calendarId: CALENDAR_ID,
      window: WINDOW, actor: "agent", authorizeAgent: async () => {
        if (++admits === 2) throw new CalendarProviderGatewayError("agent_calendar_access_denied", "Disconnected");
      } })).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
    expect(adapter.metrics().fetchCalls).toHaveLength(before);
  });

  it("binds exact provider identities, performs a bounded initial import, and never returns its credential handle", async () => {
    const seed: ProviderEventSnapshot = {
      providerEventId: "provider-event-seed",
      providerRevision: "r1",
      content: timed("Existing provider event")
    };
    const { adapter, store, gateway, result, rawVaultRecordId } = await connected({ seedEvents: [seed], agentGrant: "read" });

    expect(result.connection).toEqual({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerKey: PROVIDER_KEY,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      status: "active",
      connectedAt: "2026-09-01T12:00:00.000Z",
      disconnectedAt: null,
      remoteRevocationStatus: "not_required",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    });
    expect(result.calendars[0]).toMatchObject({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      providerKey: PROVIDER_KEY,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      providerDisplayName: "Qualified fake calendar",
      agentGrant: "read",
      capabilities: WRITABLE
    });
    expect(await store.getCanonicalCalendar(CALENDAR_ID)).toEqual({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      ...LOCAL_CALENDAR_FIELDS,
      source: "external",
      agentAccess: "read",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
      deletedAt: null
    });
    const initialCall = adapter.metrics().fetchCalls[0];
    expect(initialCall).toMatchObject({
      providerAccountId: PROVIDER_ACCOUNT_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      syncCursor: null,
      maxEvents: 2_000,
      window: WINDOW
    });
    expect(await gateway.listProjections(OWNER_ID, CONNECTION_ID, CALENDAR_ID)).toEqual([
      expect.objectContaining({
        providerEventId: seed.providerEventId,
        providerRevision: seed.providerRevision,
        providerCalendarId: PROVIDER_CALENDAR_ID,
        providerAccountId: PROVIDER_ACCOUNT_ID
      })
    ]);
    const serialized = JSON.stringify({ result, projections: await gateway.listProjections(OWNER_ID, CONNECTION_ID, CALENDAR_ID) });
    expect(serialized).not.toContain(rawVaultRecordId);
    expect(serialized).not.toContain("credentialHandle");
  });

  it("executes create/read/edit/delete through a durable idempotent outbox and reads provider truth back", async () => {
    const { adapter, store, gateway } = await connected({ agentGrant: "write" });
    const create: CalendarProviderCommand = {
      kind: "create",
      commandId: "command-create-one",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("Created exactly once")
    };
    adapter.failOnceAfterCommit(create.commandId);
    await expect(gateway.executeCommand(create, { authorizeAgent: async () => {} })).rejects.toBeInstanceOf(ProviderTransientError);
    expect((await store.getOutbox(create.commandId))?.status).toBe("pending");
    expect(await store.getOutbox(create.commandId)).toMatchObject({
      attempts: 1,
      lastErrorCode: "provider_transient",
      nextAttemptAt: expect.any(String),
      leaseOwner: null,
      leaseExpiresAt: null
    });

    const created = await gateway.executeCommand(create, { authorizeAgent: async () => {} });
    expect(created.kind).toBe("create");
    if (created.kind === "delete") throw new Error("Expected a created event.");
    expect(created.event).toMatchObject({
      providerKey: PROVIDER_KEY,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      content: { title: "Created exactly once" }
    });
    expect(await gateway.executeCommand(create, { authorizeAgent: async () => {} })).toEqual(created);
    expect(adapter.metrics()).toMatchObject({
      commandAttempts: { create: 2, update: 0, delete: 0 },
      commandApplies: { create: 1, update: 0, delete: 0 }
    });
    expect(adapter.eventCount(PROVIDER_CALENDAR_ID)).toBe(1);

    const updated = await gateway.executeCommand({
      kind: "update",
      commandId: "command-update-one",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "owner",
      providerEventId: created.event.providerEventId,
      expectedProviderRevision: created.event.providerRevision,
      content: timed("Updated and read back")
    }, { authorizeAgent: async () => {} });
    expect(updated.kind).toBe("update");
    if (updated.kind === "delete") throw new Error("Expected an updated event.");
    expect(updated.event.content.title).toBe("Updated and read back");
    expect(updated.event.providerRevision).not.toBe(created.event.providerRevision);

    const providerChanged = adapter.externalUpdate(
      PROVIDER_CALENDAR_ID,
      updated.event.providerEventId,
      timed("Provider changed this concurrently")
    );
    const staleUpdate: CalendarProviderCommand = {
      kind: "update",
      commandId: "command-update-stale",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "owner",
      providerEventId: updated.event.providerEventId,
      expectedProviderRevision: updated.event.providerRevision,
      content: timed("Must not overwrite provider truth")
    };
    await expect(gateway.executeCommand(staleUpdate, { authorizeAgent: async () => {} })).rejects.toMatchObject({
      code: "provider_revision_conflict",
      details: { currentProviderRevision: providerChanged.providerRevision }
    });
    expect((await store.getOutbox(staleUpdate.commandId))?.status).toBe("conflict");

    const deleted = await gateway.executeCommand({
      kind: "delete",
      commandId: "command-delete-one",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      providerEventId: providerChanged.providerEventId,
      expectedProviderRevision: providerChanged.providerRevision
    }, { authorizeAgent: async () => {} });
    expect(deleted).toEqual({
      kind: "delete",
      providerEventId: providerChanged.providerEventId,
      deletedProviderRevision: providerChanged.providerRevision
    });
    expect(adapter.eventCount(PROVIDER_CALENDAR_ID)).toBe(0);
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, providerChanged.providerEventId)).toBeNull();
    expect(await store.getTombstone(CONNECTION_ID, CALENDAR_ID, providerChanged.providerEventId)).toMatchObject({
      cause: "life_links_command",
      deletedProviderRevision: providerChanged.providerRevision
    });

    await expect(gateway.executeCommand({ ...create, content: timed("Different arguments") }, { authorizeAgent: async () => {} })).rejects.toMatchObject({
      code: "idempotency_conflict"
    });
  });

  it("treats webhook delivery as a hint, recovers expired cursors, and never resurrects a tombstoned event", async () => {
    const seed: ProviderEventSnapshot = {
      providerEventId: "provider-event-sync",
      providerRevision: "r1",
      content: timed("Before provider update")
    };
    const { adapter, store, gateway } = await connected({ seedEvents: [seed] });
    adapter.externalUpdate(PROVIDER_CALENDAR_ID, seed.providerEventId, timed("After provider update"));
    await gateway.acceptWebhookHint({
      hintId: "hint-one",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      receivedAt: "2026-09-01T12:10:00.000Z"
    });
    expect((await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId))?.content.title).toBe("Before provider update");
    expect(await gateway.reconcileWebhookHint({ ownerId: OWNER_ID, hintId: "hint-one", window: WINDOW })).toEqual({
      calendarsReconciled: 1
    });
    const updatedProjection = await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId);
    expect(updatedProjection?.content.title).toBe("After provider update");

    const deletedSnapshot = adapter.externalDelete(PROVIDER_CALENDAR_ID, seed.providerEventId);
    const cursorBeforeRecovery = (await store.getSyncState(CONNECTION_ID, CALENDAR_ID))?.syncCursor;
    expect(cursorBeforeRecovery).toBeTruthy();
    adapter.expireCursor(cursorBeforeRecovery!);
    const recovery = await gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    });
    expect(recovery.recoveredExpiredCursor).toBe(true);
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).toBeNull();
    expect(await store.getTombstone(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).toMatchObject({
      cause: "expired_cursor_recovery_missing",
      deletedProviderRevision: updatedProjection?.providerRevision
    });

    adapter.injectStaleUpsert(PROVIDER_CALENDAR_ID, deletedSnapshot);
    await gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    });
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).toBeNull();
    expect(await store.getTombstone(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).not.toBeNull();
  });

  it("revokes credentials and all agent authority on disconnect without deleting provider events", async () => {
    const seed: ProviderEventSnapshot = {
      providerEventId: "provider-event-retained",
      providerRevision: "r1",
      content: timed("Provider event must survive disconnect")
    };
    const { adapter, store, gateway, rawVaultRecordId } = await connected({ seedEvents: [seed], agentGrant: "write" });
    const disconnected = await gateway.disconnectConnection({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      localProjectionDisposition: "retain_private_stale"
    });

    expect(disconnected).toMatchObject({
      status: "disconnected",
      disconnectedAt: expect.any(String),
      remoteRevocationStatus: "succeeded",
      remoteRevocationAttemptedAt: expect.any(String),
      remoteRevocationErrorCode: null
    });
    expect(JSON.stringify(disconnected)).not.toContain(rawVaultRecordId);
    expect(adapter.isRevoked()).toBe(true);
    expect(adapter.metrics().revokeCalls).toBe(1);
    expect(adapter.eventCount(PROVIDER_CALENDAR_ID)).toBe(1);
    expect((await store.getConnection(CONNECTION_ID))?.credentialHandle).toBeNull();
    expect(await store.listCalendars(CONNECTION_ID)).toEqual([
      expect.objectContaining({ agentGrant: "none", visible: false })
    ]);
    expect(await store.getProjection(CONNECTION_ID, CALENDAR_ID, seed.providerEventId)).not.toBeNull();
    await expect(gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    })).rejects.toMatchObject({ code: "connection_inactive" });
  });

  it("enforces provider capability and per-calendar agent grants independently", async () => {
    const readOnly = { read: true, create: false, update: false, delete: false };
    const { gateway } = await connected({ capabilities: readOnly, agentGrant: "read" });
    await expect(gateway.executeCommand({
      kind: "create",
      commandId: "command-agent-write-denied",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("Must remain read only")
    }, { authorizeAgent: async () => {} })).rejects.toMatchObject({ code: "calendar_read_only" });

    const noAgent = await connected({ agentGrant: "none" });
    await expect(noAgent.gateway.executeCommand({
      kind: "create",
      commandId: "command-no-agent-grant",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("Must require an explicit grant")
    }, { authorizeAgent: async () => {} })).rejects.toBeInstanceOf(CalendarProviderGatewayError);
    await expect(noAgent.gateway.executeCommand({
      kind: "create",
      commandId: "command-no-agent-grant-two",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("Still denied")
    }, { authorizeAgent: async () => {} })).rejects.toMatchObject({ code: "agent_calendar_access_denied" });
    expect(await noAgent.gateway.setCalendarAgentGrant({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      agentGrant: "write",
      expectedUpdatedAt: (await noAgent.store.getCanonicalCalendar(CALENDAR_ID))!.updatedAt
    })).toMatchObject({ agentGrant: "write" });
    await expect(noAgent.gateway.executeCommand({
      kind: "create",
      commandId: "command-agent-grant-now-write",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("Explicitly authorized")
    }, { authorizeAgent: async () => {} })).resolves.toMatchObject({ kind: "create" });
  });

  it("fails locally closed before best-effort remote revocation and retains an explicit retry state", async () => {
    const { adapter, store, gateway } = await connected({ agentGrant: "write" });
    adapter.failRevocation();

    await expect(gateway.disconnectConnection({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      localProjectionDisposition: "retain_private_stale"
    })).resolves.toMatchObject({
      status: "disconnected",
      remoteRevocationStatus: "failed",
      remoteRevocationErrorCode: "provider_revoke_failed"
    });
    expect(await store.getConnection(CONNECTION_ID)).toMatchObject({
      status: "disconnected",
      credentialHandle: expect.any(String),
      remoteRevocationStatus: "failed"
    });
    expect(await store.listCalendars(CONNECTION_ID)).toEqual([
      expect.objectContaining({ agentGrant: "none", visible: false })
    ]);
    await expect(gateway.listProjections(OWNER_ID, CONNECTION_ID, CALENDAR_ID, "agent"))
      .rejects.toMatchObject({ code: "connection_inactive" });

    adapter.failRevocation(false);
    await expect(gateway.disconnectConnection({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      localProjectionDisposition: "retain_private_stale"
    })).resolves.toMatchObject({ remoteRevocationStatus: "succeeded" });
    expect((await store.getConnection(CONNECTION_ID))?.credentialHandle).toBeNull();
    expect(adapter.metrics().revokeCalls).toBe(2);
  });

  it("closes a failed provision locally even when remote rollback revocation also fails", async () => {
    const adapter = fake();
    adapter.failNextFetch(new ProviderTransientError("Initial provider import failed."));
    adapter.failRevocation();
    const store = new InMemoryCalendarProviderStateStore();
    const gateway = new CalendarProviderGateway([adapter], store, { now: clock() });

    await expect(gateway.connectExternalAccount({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerKey: PROVIDER_KEY,
      expectedProviderAccountId: PROVIDER_ACCOUNT_ID,
      credentialHandle: calendarProviderCredentialHandle("rollback-vault-handle"),
      calendars: [{
        calendarId: CALENDAR_ID,
        providerCalendarId: PROVIDER_CALENDAR_ID,
        ...LOCAL_CALENDAR_FIELDS,
        agentGrant: "write"
      }],
      initialWindow: WINDOW
    })).rejects.toThrow("Initial provider import failed.");

    expect(await store.getConnection(CONNECTION_ID)).toMatchObject({
      status: "disconnected",
      remoteRevocationStatus: "failed",
      remoteRevocationErrorCode: "provider_revoke_failed"
    });
    expect(await store.listCalendars(CONNECTION_ID)).toEqual([]);
    expect(await store.getCanonicalCalendar(CALENDAR_ID)).toBeNull();
  });

  it("serializes syncs per calendar and rejects a stale cursor-state completion", async () => {
    const { adapter, store, gateway } = await connected();
    adapter.externalCreate(PROVIDER_CALENDAR_ID, "event-for-serialized-sync", timed("Serialized sync"));
    const release = adapter.holdNextFetch();
    const first = gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    });
    await waitUntil(() => adapter.metrics().activeFetches === 1);
    const second = gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    });
    await Promise.resolve();
    expect(adapter.metrics().maxConcurrentFetches).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(adapter.metrics().maxConcurrentFetches).toBe(1);

    const stale = await store.getSyncState(CONNECTION_ID, CALENDAR_ID);
    if (!stale) throw new Error("Expected synchronization state.");
    const advanced = { ...stale, syncCursor: `${stale.syncCursor}-advanced`, lastReconciledAt: "2026-09-02T00:00:00.000Z" };
    await store.applySyncMutation({
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      expectedState: stale,
      upserts: [],
      tombstones: [],
      removedProviderEventIds: [],
      state: advanced
    });
    await expect(store.applySyncMutation({
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      expectedState: stale,
      upserts: [],
      tombstones: [],
      removedProviderEventIds: [],
      state: { ...stale, syncCursor: `${stale.syncCursor}-stale-writer` }
    })).rejects.toMatchObject({ code: "sync_state_conflict" });
    expect((await store.getSyncState(CONNECTION_ID, CALENDAR_ID))?.syncCursor).toBe(advanced.syncCursor);
  });

  it("claims each outbox attempt so concurrent dispatches cannot call the provider twice", async () => {
    const { adapter, store, gateway } = await connected({ agentGrant: "write" });
    const release = adapter.holdNextCreate();
    const command: CalendarProviderCommand = {
      kind: "create",
      commandId: "command-concurrent-create",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "agent",
      content: timed("One provider dispatch")
    };
    const first = gateway.executeCommand(command, { authorizeAgent: async () => {} });
    await waitUntil(() => adapter.metrics().commandAttempts.create === 1);
    await expect(gateway.executeCommand(command, { authorizeAgent: async () => {} })).rejects.toMatchObject({ code: "command_in_progress" });
    expect(adapter.metrics().commandAttempts.create).toBe(1);
    expect(await store.getOutbox(command.commandId)).toMatchObject({
      status: "processing",
      attempts: 1,
      leaseOwner: expect.any(String),
      leaseExpiresAt: expect.any(String)
    });
    release();
    await expect(first).resolves.toMatchObject({ kind: "create" });
    expect(adapter.metrics()).toMatchObject({
      commandAttempts: { create: 1, update: 0, delete: 0 },
      commandApplies: { create: 1, update: 0, delete: 0 }
    });
  });

  it("normalizes exact provider instants, validates real all-day dates, and verifies readback identity", async () => {
    const offsetSeed: ProviderEventSnapshot = {
      providerEventId: "provider-offset-event",
      providerRevision: "r1",
      content: timed("Offset event", "2026-09-01T10:00:00-04:00")
    };
    const { adapter, gateway } = await connected({ seedEvents: [offsetSeed], agentGrant: "write" });
    expect((await gateway.getProjection(OWNER_ID, CONNECTION_ID, CALENDAR_ID, offsetSeed.providerEventId))?.content.span)
      .toMatchObject({ startUtc: "2026-09-01T14:00:00.000Z", endUtc: "2026-09-01T15:00:00.000Z" });

    adapter.returnWrongIdOnNextRead("wrong-provider-event-id");
    await expect(gateway.executeCommand({
      kind: "create",
      commandId: "command-wrong-readback-id",
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      actor: "owner",
      content: timed("Readback identity must match")
    }, { authorizeAgent: async () => {} })).rejects.toMatchObject({ code: "provider_readback_failed" });

    const malformed: ProviderEventSnapshot = {
      providerEventId: "provider-invalid-all-day",
      providerRevision: "r9",
      content: {
        title: "Invalid calendar date",
        description: null,
        location: null,
        providerSeriesId: null,
        status: "confirmed",
        span: { kind: "all_day", startDate: "2026-02-30", endDateExclusive: "2026-03-03" }
      }
    };
    adapter.injectStaleUpsert(PROVIDER_CALENDAR_ID, malformed);
    await expect(gateway.synchronizeCalendar({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      window: WINDOW
    })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("allows owner and explicitly granted agent reads while hiding ungranted calendars", async () => {
    const seed: ProviderEventSnapshot = {
      providerEventId: "provider-readable-event",
      providerRevision: "r1",
      content: timed("Readable only with a grant")
    };
    const granted = await connected({ seedEvents: [seed], agentGrant: "read" });
    expect(await granted.gateway.listCalendars(OWNER_ID, CONNECTION_ID, "agent")).toHaveLength(1);
    await expect(granted.gateway.getProjection(OWNER_ID, CONNECTION_ID, CALENDAR_ID, seed.providerEventId, "agent"))
      .resolves.toMatchObject({ providerEventId: seed.providerEventId });

    const denied = await connected({ seedEvents: [seed], agentGrant: "none" });
    expect(await denied.gateway.listCalendars(OWNER_ID, CONNECTION_ID, "agent")).toEqual([]);
    await expect(denied.gateway.listProjections(OWNER_ID, CONNECTION_ID, CALENDAR_ID, "agent"))
      .rejects.toMatchObject({ code: "agent_calendar_access_denied" });
    expect(await denied.gateway.listProjections(OWNER_ID, CONNECTION_ID, CALENDAR_ID, "owner")).toHaveLength(1);
  });

  it("refuses a provider binding to a native or mismatched canonical Calendar", async () => {
    const store = new InMemoryCalendarProviderStateStore();
    const credentialHandle = calendarProviderCredentialHandle("provision-pair-test-handle");
    await store.saveConnection({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerKey: PROVIDER_KEY,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      status: "provisioning",
      credentialHandle,
      connectedAt: "2026-09-01T12:00:00.000Z",
      disconnectedAt: null,
      remoteRevocationStatus: "not_required",
      remoteRevocationAttemptedAt: null,
      remoteRevocationErrorCode: null
    });
    const nativeCalendar = createCanonicalCalendar({
      id: CALENDAR_ID,
      ownerId: OWNER_ID,
      ...LOCAL_CALENDAR_FIELDS,
      createdAt: "2026-09-01T12:00:00.000Z"
    });
    await expect(store.provisionCalendar(nativeCalendar, {
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerKey: PROVIDER_KEY,
      providerAccountId: PROVIDER_ACCOUNT_ID,
      calendarId: CALENDAR_ID,
      providerCalendarId: PROVIDER_CALENDAR_ID,
      providerDisplayName: "Remote provider label",
      capabilities: WRITABLE,
      agentGrant: "none",
      visible: true
    })).rejects.toMatchObject({ code: "provider_identity_mismatch" });
    expect(await store.getCanonicalCalendar(CALENDAR_ID)).toBeNull();
    expect(await store.listCalendars(CONNECTION_ID)).toEqual([]);
  });

  it("rejects noncanonical local Calendar identities before creating provider bindings", async () => {
    const adapter = fake();
    const gateway = new CalendarProviderGateway([adapter], new InMemoryCalendarProviderStateStore());
    await expect(gateway.connectExternalAccount({
      ownerId: OWNER_ID,
      connectionId: CONNECTION_ID,
      providerKey: PROVIDER_KEY,
      expectedProviderAccountId: PROVIDER_ACCOUNT_ID,
      credentialHandle: calendarProviderCredentialHandle("canonical-id-test-handle"),
      calendars: [{
        calendarId: "calendar-local-one",
        providerCalendarId: PROVIDER_CALENDAR_ID,
        ...LOCAL_CALENDAR_FIELDS
      }],
      initialWindow: WINDOW
    })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("PostgreSQL provider Calendar provisioning transaction", () => {
  const externalCalendar = () => createCanonicalExternalCalendar({
    id: CALENDAR_ID,
    ownerId: OWNER_ID,
    ...LOCAL_CALENDAR_FIELDS,
    createdAt: "2026-09-01T12:00:00.000Z"
  });

  it("creates the canonical Calendar and binding in one committed transaction", async () => {
    const scripted = scriptedProvisioningPool();
    const store = new PostgresCalendarProviderStateStore(scripted.pool as never);
    await store.provisionCalendar(externalCalendar(), providerBinding());

    expect(scripted.statements[0]).toBe("BEGIN");
    expect(scripted.statements).toEqual(expect.arrayContaining([
      expect.stringMatching(/^INSERT INTO calendars /),
      expect.stringMatching(/^INSERT INTO calendar_provider_bindings /)
    ]));
    expect(scripted.statements.at(-1)).toBe("COMMIT");
  });

  it("rolls the transaction back when the binding cannot be created", async () => {
    const scripted = scriptedProvisioningPool(true);
    const store = new PostgresCalendarProviderStateStore(scripted.pool as never);
    await expect(store.provisionCalendar(externalCalendar(), providerBinding()))
      .rejects.toThrow("binding insert failed");

    expect(scripted.statements).toContain("ROLLBACK");
    expect(scripted.statements).not.toContain("COMMIT");
  });
});
