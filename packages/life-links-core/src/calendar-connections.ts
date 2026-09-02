import type { CalendarAgentAccess, CalendarRecord } from "./calendar.js";

/** Owner-private connection metadata. Credentials and vault handles are never part of this view. */
export type CalendarConnectionView = {
  ownerId: string;
  connectionId: string;
  providerKey: string;
  providerAccountId: string;
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

export type CalendarProviderAvailability = {
  providerKey: "google" | "microsoft";
  displayName: string;
  authorizationAvailable: boolean;
  reason?: "authorization_not_configured";
};

/** Selection data only; authorization codes, PKCE material and tokens remain server-private. */
export type CalendarAuthorizationDiscovery = {
  providerKey: "microsoft";
  providerAccountId: string;
  calendars: Array<{
    providerCalendarId: string;
    displayName: string;
    isDefault: boolean;
    capabilities: CalendarProviderCapabilities;
  }>;
};
