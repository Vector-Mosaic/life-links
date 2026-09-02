import type { CalendarAgentAccess, CalendarRecord } from "./calendar.js";

/** Owner-private connection metadata. Credentials and vault handles are never part of this view. */
export type CalendarConnectionView = {
  ownerId: string;
  connectionId: string;
  providerKey: string;
  providerAccountId: string;
  /** Authenticated provider email for owner-only display; never an identity or permission key. */
  accountEmail?: string;
  status: "provisioning" | "active" | "disconnected";
  connectedAt: string;
  disconnectedAt: string | null;
  remoteRevocationStatus: "not_required" | "pending" | "succeeded" | "failed";
  remoteRevocationAttemptedAt: string | null;
  remoteRevocationErrorCode: "provider_revoke_failed" | null;
  credentialStatus?: "ready" | "reconnect_required" | "not_retained";
};

export type CalendarProviderCapabilities = {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

/** The canonical Calendar owns agentAccess; provider capabilities remain a separate upper bound. */
export type CalendarConnectedCalendarView = {
  calendar: CalendarRecord;
  connectionId: string;
  providerCalendarId: string;
  providerDisplayName: string;
  capabilities: CalendarProviderCapabilities;
  visible: boolean;
};

export type CalendarConnectedCalendarPatch = {
  visible?: boolean;
  agentAccess?: CalendarAgentAccess;
};

/** Explicit owner choices for exact discovered provider Calendar identities. */
export type CalendarConnectionSelectionInput = {
  selectedCalendarIds: string[];
  /** When supplied, keys must exactly match selectedCalendarIds. Omission preserves default-deny behavior. */
  agentAccessByCalendarId?: Record<string, CalendarAgentAccess>;
};

export type CalendarProviderAvailability = {
  providerKey: "google" | "microsoft";
  displayName: string;
  authorizationAvailable: boolean;
  reason?: "authorization_not_configured";
};

/** Selection data only; authorization codes, PKCE material and tokens remain server-private. */
export type CalendarAuthorizationDiscovery = {
  providerKey: "microsoft" | "google";
  providerAccountId: string;
  /** Optional owner-private label, not a substitute for providerAccountId. */
  accountEmail?: string;
  calendars: Array<{
    providerCalendarId: string;
    displayName: string;
    isDefault: boolean;
    /** Provider-supplied IANA zone; absent when the provider exposes none. */
    timeZone?: string;
    capabilities: CalendarProviderCapabilities;
  }>;
};
