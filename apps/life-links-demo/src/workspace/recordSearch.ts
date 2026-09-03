import { RECORD_SEARCH_CATEGORIES, type RecordSearchCategory, type RecordSearchInput, type RecordSearchPage } from "@life-links/core";

export type RecordSearchGroup = RecordSearchPage & { loading: boolean; searched: boolean; error: string };
export type RecordSearchState = { query: string; groups: Record<RecordSearchCategory, RecordSearchGroup> };

export function emptyRecordSearch(query = ""): RecordSearchState {
  return { query, groups: Object.fromEntries(RECORD_SEARCH_CATEGORIES.map((category) => [category, {
    category, results: [], nextCursor: null, scanned: 0, warnings: [], loading: false, searched: false, error: ""
  }])) as unknown as RecordSearchState["groups"] };
}

/** Continue through empty scan pages, stopping at one useful result page.
 * Every partial publication retains its continuation; cancellation never means
 * the sources were exhausted. The canonical server owns all matching/access. */
export async function collectRecordSearchPage(
  read: (input: RecordSearchInput, signal: AbortSignal) => Promise<RecordSearchPage>,
  input: RecordSearchInput,
  publish: (page: RecordSearchPage) => void,
  signal: AbortSignal
): Promise<RecordSearchPage> {
  const result: RecordSearchPage = { category: input.category, results: [], scanned: 0, nextCursor: input.cursor ?? null, warnings: [] };
  const seen = new Set<string>(input.cursor ? [input.cursor] : []);
  do {
    signal.throwIfAborted();
    const page = await read({ ...input, cursor: result.nextCursor, limit: (input.limit ?? 10) - result.results.length }, signal);
    signal.throwIfAborted();
    if (page.category !== input.category) throw new Error("Search returned the wrong record category.");
    if (page.nextCursor && seen.has(page.nextCursor)) throw new Error("Search could not finish: the server repeated a continuation.");
    if (page.nextCursor) seen.add(page.nextCursor);
    const hits = new Map([...result.results, ...page.results].map((hit) => [hit.id, hit]));
    result.results = [...hits.values()];
    result.scanned += page.scanned;
    result.warnings = [...new Set([...result.warnings, ...page.warnings])];
    result.nextCursor = page.nextCursor;
    publish({ ...result, results: [...result.results], warnings: [...result.warnings] });
  } while (result.nextCursor && result.results.length < (input.limit ?? 10));
  return result;
}
