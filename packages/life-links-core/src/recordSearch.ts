/** Owner-private discovery references; a hit never grants access to its target. */
export const RECORD_SEARCH_CATEGORIES = ["life_links", "collections", "routines", "history", "calendar", "attachments"] as const;
export type RecordSearchCategory = (typeof RECORD_SEARCH_CATEGORIES)[number];
export const MAX_RECORD_SEARCH_QUERY_LENGTH = 2048;
export const MAX_RECORD_SEARCH_LIMIT = 25;
export const DEFAULT_RECORD_SEARCH_LIMIT = 10;
export const MAX_RECORD_SEARCH_SNIPPET_LENGTH = 240;

export type RecordSearchReference =
  | { kind: "life_link"; lifeLinkId: string }
  | { kind: "collection"; collectionId: string; sectionId?: string }
  | { kind: "routine"; routineId: string; routineRevisionId?: string; routineStepId?: string }
  | { kind: "session"; routineId: string; sessionId: string; routineRevisionId: string }
  | { kind: "calendar_event"; authority: "native"; calendarId: string; eventId: string }
  | { kind: "calendar_event"; authority: "provider"; connectionId: string; calendarId: string; providerEventId: string }
  | { kind: "attachment"; lifeLinkId: string; mediaId: string; revision?: string; offset?: number };

export type RecordSearchHit = {
  id: string;
  category: RecordSearchCategory;
  title: string;
  snippet: string;
  matchedField: string;
  reference: RecordSearchReference;
  subtitle?: string;
};

export type RecordSearchPage = {
  category: RecordSearchCategory;
  results: RecordSearchHit[];
  nextCursor: string | null;
  /** Canonical source records examined in this page, including nonmatches. */
  scanned: number;
  /** Explicit source-coverage and availability notices, not inferred absence. */
  warnings: string[];
};

export type RecordSearchInput = {
  q: string;
  category: RecordSearchCategory;
  cursor?: string | null;
  limit?: number;
};
