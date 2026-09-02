import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CalendarAuthorizationDiscovery, CalendarConnectionSelectionInput } from "@life-links/core";
import { CalendarProviderGateway, assertAgentGrant, calendarProviderCredentialHandle, calendarProviderLocalCalendarId, type CalendarProviderCredentialHandle } from "./calendar-provider-gateway.js";
import type { CalendarProviderCredentialResolver, CalendarProviderCredentialRevoker } from "./calendar-provider-credentials.js";
import { CalendarSecretCipher, type CalendarSecretRow, type CalendarSecretStore } from "./calendar-secret-store.js";
import type { MicrosoftCalendarAuth, MicrosoftCalendarTokenState } from "./calendar-microsoft-auth.js";
import type { GoogleCalendarAuth, GoogleCalendarTokenState } from "./calendar-google-auth.js";

export type CalendarAuthorizationProvider = "microsoft" | "google";
const PROVIDERS = { microsoft: "microsoft-graph-calendar", google: "google-calendar" } as const;
export function calendarAuthorizationProvider(providerKey: string): CalendarAuthorizationProvider {
  if (providerKey === PROVIDERS.microsoft) return "microsoft";
  if (providerKey === PROVIDERS.google) return "google";
  throw new CalendarAuthorizationError("authorization_unavailable");
}
type Authorization = {
  // Missing only in the already-deployed Microsoft payload format.
  provider?: CalendarAuthorizationProvider;
  sessionId: string;
  stateHash: string;
  nonce: string;
  codeVerifier: string;
  status: "pending" | "redeeming" | "authorized" | "completed" | "failed";
  credentialId: string;
  connectionId: string;
  reconnect: boolean;
  expectedProviderAccountId: string | null;
  providerAccountId: string | null;
  selectedCalendarIds: string[] | null;
  agentAccessByCalendarId?: CalendarConnectionSelectionInput["agentAccessByCalendarId"];
};
type Credential = (MicrosoftCalendarTokenState | GoogleCalendarTokenState) & {
  provider?: CalendarAuthorizationProvider; status: "ready" | "reconnect_required"; connectionId: string
};
export type CalendarCredentialCleanup = (input: {
  ownerId: string; connectionId: string; credentialHandle: CalendarProviderCredentialHandle; providerAccountId: string;
  replacementCredentialHandle?: CalendarProviderCredentialHandle;
}) => Promise<void>;

export class CalendarAuthorizationError extends Error {
  constructor(readonly code: "authorization_failed" | "authorization_unavailable" | "session_expired" | "cancelled" | "authorization_not_found" | "calendar_selection_invalid") {
    super(code);
  }
}

/** Owns the connection credentials, never provider calendar/event business authority. */
export class CalendarAuthorizationService implements CalendarProviderCredentialResolver, CalendarProviderCredentialRevoker {
  #beforeRevoke?: CalendarCredentialCleanup;
  setBeforeRevoke(cleanup: CalendarCredentialCleanup) { this.#beforeRevoke = cleanup; }
  constructor(
    readonly secrets: CalendarSecretStore,
    private readonly cipher: CalendarSecretCipher,
    private readonly microsoft: MicrosoftCalendarAuth | undefined,
    private readonly gateway: () => CalendarProviderGateway,
    private readonly now: () => Date = () => new Date(),
    private readonly google?: GoogleCalendarAuth
  ) {}

  supportsProvider(provider: CalendarAuthorizationProvider): boolean {
    return provider === "microsoft" ? Boolean(this.microsoft) : Boolean(this.google);
  }
  #auth(provider: CalendarAuthorizationProvider) {
    const auth = provider === "microsoft" ? this.microsoft : this.google;
    if (!auth) throw new CalendarAuthorizationError("authorization_unavailable");
    return auth;
  }

  async start(ownerId: string, sessionId: string, reconnectConnectionId?: string,
    provider: CalendarAuthorizationProvider = "microsoft"): Promise<{ authorizationUrl: string }> {
    if (!ownerId || !sessionId) throw new CalendarAuthorizationError("session_expired");
    const auth = this.#auth(provider);
    const previous = reconnectConnectionId ? await this.gateway().getConnection(ownerId, reconnectConnectionId) : null;
    if (previous && previous.providerKey !== PROVIDERS[provider]) throw new CalendarAuthorizationError("authorization_failed");
    const id = randomUUID(), stateSecret = randomBytes(32).toString("base64url");
    const authorization: Authorization = {
      provider, sessionId, stateHash: sha(stateSecret), nonce: randomBytes(32).toString("base64url"),
      codeVerifier: randomBytes(48).toString("base64url"), status: "pending",
      credentialId: randomUUID(), connectionId: previous?.connectionId ?? randomUUID(), reconnect: Boolean(previous),
      expectedProviderAccountId: previous?.providerAccountId ?? null, providerAccountId: null, selectedCalendarIds: null
    };
    const row = this.#row(id, ownerId, "authorization", authorization, 10 * 60_000);
    const authorizationUrl = await auth.authorizationUrl({ state: `${id}.${stateSecret}`, nonce: authorization.nonce,
      codeChallenge: createHash("sha256").update(authorization.codeVerifier).digest("base64url") });
    await this.secrets.create(row);
    return { authorizationUrl };
  }

  async callback(input: { ownerId: string; sessionId: string; state: string; code?: string; error?: string;
    provider?: CalendarAuthorizationProvider }): Promise<string> {
    const pieces = input.state.split(".");
    if (pieces.length !== 2 || !/^[a-f0-9-]{36}$/.test(pieces[0]) || !/^[A-Za-z0-9_-]{43}$/.test(pieces[1])) {
      throw new CalendarAuthorizationError("authorization_failed");
    }
    const [id, stateSecret] = pieces;
    // Consume before exchanging the code: failed, cancelled and repeated callbacks cannot reuse state.
    const authorization = await this.secrets.locked(id, async (row) => {
      const state = this.#authorization(row, input.ownerId, input.sessionId);
      if ((state.provider ?? "microsoft") !== (input.provider ?? "microsoft") || state.status !== "pending"
        || !timingSafeEqual(Buffer.from(state.stateHash), Buffer.from(sha(stateSecret)))) {
        throw new CalendarAuthorizationError("authorization_failed");
      }
      state.status = input.error ? "failed" : "redeeming";
      return { row: this.#updated(row!, state), value: state };
    });
    if (input.error) throw new CalendarAuthorizationError(input.error === "access_denied" ? "cancelled" : "authorization_failed");
    try {
      if (!input.code || input.code.length > 16_384) throw new CalendarAuthorizationError("authorization_failed");
      const provider = authorization.provider ?? "microsoft";
      const tokens = await this.#auth(provider).redeem({ code: input.code, nonce: authorization.nonce, codeVerifier: authorization.codeVerifier });
      if (authorization.expectedProviderAccountId && tokens.providerAccountId !== authorization.expectedProviderAccountId) {
        throw new CalendarAuthorizationError("authorization_failed");
      }
      await this.secrets.create(this.#row(authorization.credentialId, input.ownerId, "credential", {
        ...tokens, provider, status: "ready", connectionId: authorization.connectionId
      }, 30 * 60_000));
      await this.secrets.locked(id, async (row) => {
        const current = this.#authorization(row, input.ownerId, input.sessionId);
        if (current.status !== "redeeming") throw new CalendarAuthorizationError("authorization_failed");
        current.status = "authorized"; current.providerAccountId = tokens.providerAccountId;
        current.codeVerifier = ""; current.nonce = "";
        return { row: { ...this.#updated(row!, current), expiresAt: new Date(this.now().getTime() + 30 * 60_000).toISOString() }, value: undefined };
      });
      return id;
    } catch {
      await this.secrets.locked(authorization.credentialId, async () => ({ row: null, value: undefined }));
      throw new CalendarAuthorizationError("authorization_failed");
    }
  }

  async discover(ownerId: string, sessionId: string, id: string): Promise<CalendarAuthorizationDiscovery> {
    const state = await this.#readAuthorization(ownerId, sessionId, id);
    const provider = state.provider ?? "microsoft";
    const discovery = await this.gateway().discoverExternalCalendars({ ownerId, providerKey: PROVIDERS[provider],
      expectedProviderAccountId: state.providerAccountId!, credentialHandle: calendarProviderCredentialHandle(state.credentialId) });
    return { providerKey: provider, providerAccountId: discovery.providerAccountId,
      calendars: discovery.calendars.map((calendar) => ({ ...calendar, isDefault: calendar.isDefault === true })) };
  }

  async complete(ownerId: string, sessionId: string, id: string, selectedCalendarIds: string[],
    agentAccessByCalendarId?: CalendarConnectionSelectionInput["agentAccessByCalendarId"]) {
    const input = readCalendarConnectionSelection({ selectedCalendarIds,
      ...(agentAccessByCalendarId === undefined ? {} : { agentAccessByCalendarId }) });
    // Commit the validated selection before gateway effects, which use their
    // own transactions and can survive a failed authorization completion.
    const calendars = await this.secrets.locked(id, async (row) => {
      const state = this.#authorization(row, ownerId, sessionId);
      if (!state.providerAccountId || !["authorized", "completed"].includes(state.status)) throw new CalendarAuthorizationError("authorization_failed");
      if (state.selectedCalendarIds && selectionIdentity(state) !== selectionIdentity(input)) {
        throw new CalendarAuthorizationError("calendar_selection_invalid");
      }
      if (state.status === "completed") return { row, value: null };
      const credentialHandle = calendarProviderCredentialHandle(state.credentialId);
      const discovery = await this.gateway().discoverExternalCalendars({ ownerId, providerKey: PROVIDERS[state.provider ?? "microsoft"],
        expectedProviderAccountId: state.providerAccountId, credentialHandle });
      const selection = selectedCalendarIds.map((providerCalendarId) => {
        const remote = discovery.calendars.find((calendar) => calendar.providerCalendarId === providerCalendarId);
        if (!remote) throw new CalendarAuthorizationError("calendar_selection_invalid");
        const agentGrant = input.agentAccessByCalendarId?.[providerCalendarId] ?? "none";
        assertAgentGrant(agentGrant, remote.capabilities);
        return { calendarId: calendarProviderLocalCalendarId(state.connectionId, providerCalendarId), providerCalendarId,
          title: remote.displayName, color: "#4f8fbd", timeZone: remote.timeZone ?? "UTC", isDefault: false, visible: true, agentGrant };
      });
      state.selectedCalendarIds = [...selectedCalendarIds];
      state.agentAccessByCalendarId = input.agentAccessByCalendarId;
      return { row: this.#updated(row!, state), value: selection };
    });
    return this.secrets.locked(id, async (row) => {
      // Revalidate after reacquiring the lock: cancellation or another exact
      // retry may have completed while the committed selection was unlocked.
      const state = this.#authorization(row, ownerId, sessionId);
      if (!state.providerAccountId || !["authorized", "completed"].includes(state.status)) throw new CalendarAuthorizationError("authorization_failed");
      if (!state.selectedCalendarIds || selectionIdentity(state) !== selectionIdentity(input)) {
        throw new CalendarAuthorizationError("calendar_selection_invalid");
      }
      if (state.status === "completed") return { row, value: {
        connection: await this.gateway().getConnection(ownerId, state.connectionId),
        calendars: await this.gateway().listManagedCalendars(ownerId, state.connectionId)
      } };
      if (!calendars) throw new CalendarAuthorizationError("authorization_failed");
      const credentialHandle = calendarProviderCredentialHandle(state.credentialId);
      if (state.reconnect) {
        await this.gateway().reconnectConnection({ ownerId, connectionId: state.connectionId,
          expectedProviderAccountId: state.providerAccountId, credentialHandle, initialWindow: this.initialWindow(),
          calendars },
        { beforeCredentialReplacement: this.#beforeRevoke });
        await this.gateway().selectExternalCalendars({ ownerId, connectionId: state.connectionId, calendars, initialWindow: this.initialWindow() });
      } else await this.gateway().connectExternalAccount({ ownerId, connectionId: state.connectionId,
        providerKey: PROVIDERS[state.provider ?? "microsoft"], expectedProviderAccountId: state.providerAccountId,
        credentialHandle, calendars, initialWindow: this.initialWindow() });
      await this.secrets.locked(state.credentialId, async (credential) => {
        if (!credential || credential.ownerId !== ownerId) throw new CalendarAuthorizationError("authorization_failed");
        return { row: { ...credential, expiresAt: null }, value: undefined };
      });
      state.status = "completed";
      return { row: this.#updated(row!, state), value: {
        connection: await this.gateway().getConnection(ownerId, state.connectionId),
        calendars: await this.gateway().listManagedCalendars(ownerId, state.connectionId)
      } };
    });
  }

  async cancel(ownerId: string, sessionId: string, id: string): Promise<void> {
    await this.secrets.locked(id, async (row) => {
      const state = this.#authorization(row, ownerId, sessionId);
      if (state.status !== "completed") {
        const connection = await this.gateway().store.getConnection(state.connectionId);
        if (connection?.ownerId === ownerId && connection.credentialHandle === state.credentialId) {
          // A response/commit may fail after provisioning. Close only the exact
          // connection created by this attempt before removing its credential.
          await this.gateway().disconnectConnection({ ownerId, connectionId: state.connectionId, localProjectionDisposition: "purge" });
          const closed = await this.gateway().store.getConnection(state.connectionId);
          if (closed?.credentialHandle !== state.credentialId) await this.secrets.locked(state.credentialId, async () => ({ row: null, value: undefined }));
        } else await this.secrets.locked(state.credentialId, async () => ({ row: null, value: undefined }));
      }
      return { row: null, value: undefined };
    });
  }

  async resolve(input: { credentialHandle: CalendarProviderCredentialHandle; providerKey: string }) {
    const provider = calendarAuthorizationProvider(input.providerKey);
    this.#auth(provider);
    const result = await this.secrets.locked(input.credentialHandle, async (row) => {
      if (!row || row.purpose !== "credential" || (row.expiresAt && row.expiresAt <= this.now().toISOString())) {
        throw new CalendarAuthorizationError("authorization_failed");
      }
      const credential = this.cipher.open<Credential>(row);
      if ((credential.provider ?? "microsoft") !== provider) throw new CalendarAuthorizationError("authorization_failed");
      try {
        const refreshed = provider === "google"
          ? await this.google!.refresh(credential)
          : await this.microsoft!.refresh(credential as MicrosoftCalendarTokenState);
        if (refreshed.state.providerAccountId !== credential.providerAccountId) throw new CalendarAuthorizationError("authorization_failed");
        return { row: this.#updated(row, { ...refreshed.state, provider, connectionId: credential.connectionId, status: "ready" }),
          value: { accessToken: refreshed.accessToken, providerAccountId: credential.providerAccountId,
            ...(refreshed.renewedAccessToken === true ? { renewedAccessToken: true as const } : {}) } };
      } catch {
        return { row: this.#updated(row, { ...credential, status: "reconnect_required" }), value: null };
      }
    });
    if (!result) throw new CalendarAuthorizationError("authorization_failed");
    return result;
  }

  async revoke(input: { credentialHandle: CalendarProviderCredentialHandle; providerKey: string; providerAccountId: string }): Promise<void> {
    const provider = calendarAuthorizationProvider(input.providerKey);
    const cleanup = await this.secrets.locked(input.credentialHandle, async (row) => {
      if (!row) return { row, value: null };
      const credential = this.cipher.open<Credential>(row);
      if (row.purpose !== "credential" || (credential.provider ?? "microsoft") !== provider
        || credential.providerAccountId !== input.providerAccountId) throw new CalendarAuthorizationError("authorization_failed");
      return { row, value: { ownerId: row.ownerId, connectionId: credential.connectionId,
        credentialHandle: input.credentialHandle, providerAccountId: input.providerAccountId } };
    });
    if (cleanup) await this.#beforeRevoke?.(cleanup);
    await this.secrets.locked(input.credentialHandle, async (row) => {
      if (row && (row.purpose !== "credential" || (this.cipher.open<Credential>(row).provider ?? "microsoft") !== provider
        || this.cipher.open<Credential>(row).providerAccountId !== input.providerAccountId)) {
        throw new CalendarAuthorizationError("authorization_failed");
      }
      // Remove only this application's retained credential. Provider-side consent may remain.
      return { row: null, value: undefined };
    });
  }

  async credentialStatus(ownerId: string, connectionId: string): Promise<"ready" | "reconnect_required" | "not_retained"> {
    const connection = await this.gateway().store.getConnection(connectionId);
    if (!connection || connection.ownerId !== ownerId || !connection.credentialHandle) return "not_retained";
    return this.secrets.locked(connection.credentialHandle, async (row) => {
      if (!row || row.ownerId !== ownerId || row.purpose !== "credential") return { row, value: "not_retained" as const };
      return { row, value: this.cipher.open<Credential>(row).status };
    });
  }

  initialWindow() {
    const today = this.now();
    today.setUTCHours(0, 0, 0, 0);
    return { startUtc: new Date(today.getTime() - 90 * 86_400_000).toISOString(), endUtc: new Date(today.getTime() + 270 * 86_400_000).toISOString() };
  }
  async #readAuthorization(ownerId: string, sessionId: string, id: string) {
    return this.secrets.locked(id, async (row) => {
      const state = this.#authorization(row, ownerId, sessionId);
      if (!state.providerAccountId || !["authorized", "completed"].includes(state.status)) throw new CalendarAuthorizationError("authorization_failed");
      return { row, value: state };
    });
  }
  #authorization(row: CalendarSecretRow | null, ownerId: string, sessionId: string): Authorization {
    if (!row || row.ownerId !== ownerId || row.purpose !== "authorization") throw new CalendarAuthorizationError("authorization_not_found");
    if (!row.expiresAt || row.expiresAt <= this.now().toISOString()) throw new CalendarAuthorizationError("session_expired");
    const state = this.cipher.open<Authorization>(row);
    if (state.sessionId !== sessionId) throw new CalendarAuthorizationError("session_expired");
    return state;
  }
  #row(id: string, ownerId: string, purpose: CalendarSecretRow["purpose"], data: unknown, ttlMs: number): CalendarSecretRow {
    return { id, ownerId, purpose, encryptedPayload: this.cipher.seal({ id, ownerId, purpose }, data), expiresAt: new Date(this.now().getTime() + ttlMs).toISOString() };
  }
  #updated(row: CalendarSecretRow, data: unknown): CalendarSecretRow { return { ...row, encryptedPayload: this.cipher.seal(row, data) }; }
}

/** One closed request grammar shared by initial authorization and additional selection. */
export function readCalendarConnectionSelection(value: unknown): CalendarConnectionSelectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CalendarAuthorizationError("calendar_selection_invalid");
  const input = value as Record<string, unknown>;
  const ids = input.selectedCalendarIds;
  if (Object.keys(input).some((key) => !["selectedCalendarIds", "agentAccessByCalendarId"].includes(key))
    || !Array.isArray(ids) || !ids.length || ids.length > 50
    || ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 512)
    || new Set(ids).size !== ids.length) throw new CalendarAuthorizationError("calendar_selection_invalid");
  if (input.agentAccessByCalendarId === undefined) return { selectedCalendarIds: [...ids] };
  const grants = input.agentAccessByCalendarId;
  if (!grants || typeof grants !== "object" || Array.isArray(grants)
    || Object.keys(grants).length !== ids.length
    || Object.keys(grants).some((key) => !ids.includes(key))
    || ids.some((id) => !Object.prototype.hasOwnProperty.call(grants, id)
      || !["none", "read", "write"].includes((grants as Record<string, string>)[id]))) {
    throw new CalendarAuthorizationError("calendar_selection_invalid");
  }
  return { selectedCalendarIds: [...ids], agentAccessByCalendarId: { ...grants } as NonNullable<CalendarConnectionSelectionInput["agentAccessByCalendarId"]> };
}

function selectionIdentity(input: { selectedCalendarIds: string[] | null; agentAccessByCalendarId?: CalendarConnectionSelectionInput["agentAccessByCalendarId"] }): string {
  return JSON.stringify([...(input.selectedCalendarIds ?? [])].sort().map((id) => [id, input.agentAccessByCalendarId?.[id] ?? "none"]));
}

function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
