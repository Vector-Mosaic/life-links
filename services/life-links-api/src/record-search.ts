import { createHash } from "node:crypto";
import {
  deriveLifeLinkPhysicalLocator,
  DEFAULT_RECORD_SEARCH_LIMIT, MAX_RECORD_SEARCH_LIMIT, MAX_RECORD_SEARCH_QUERY_LENGTH,
  MAX_RECORD_SEARCH_SNIPPET_LENGTH, RECORD_SEARCH_CATEGORIES,
  type CalendarActor, type RecordSearchCategory, type RecordSearchHit, type RecordSearchInput,
  type RecordSearchPage, type RecordSearchReference, type RoutineValue
} from "@life-links/core";
import type { LifeLinksStore, LifeLinkMediaFile } from "./store.js";
import { CalendarProviderGatewayError, type CalendarProviderGateway } from "./calendar-provider-gateway.js";

const SCAN_BUDGET = 30;
const FILE_BUDGET = 2;
type Field = [name: string, text: string];
type Traversal = {
  version: 1; owner: string; q: string; category: RecordSearchCategory;
  outer: string | null; target: string | null; nextOuter: string | null;
  inner: string | null; phase: "root" | "children";
};
type AttachmentSearchReader = {
  search(file: LifeLinkMediaFile, query: string, signal?: AbortSignal): Promise<{
    revision: string; matched: boolean; snippet: string; offset: number | null;
    status: string; reason: string | null; warnings: string[];
  }>;
};

export class RecordSearchError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** One owner/category traversal; cursors contain positions, never credentials or authority. */
export class RecordSearchService {
  constructor(private readonly store: LifeLinksStore, private readonly gateway?: CalendarProviderGateway,
    private readonly attachments?: AttachmentSearchReader) {}

  async search(ownerId: string, input: RecordSearchInput, options: {
    actor?: CalendarActor; signal?: AbortSignal; authorize?: () => Promise<void>;
  } = {}): Promise<RecordSearchPage> {
    const { q, category, limit } = normalizeInput(input);
    const actor = options.actor ?? "human";
    const admit = async () => {
      options.signal?.throwIfAborted();
      await options.authorize?.();
      if (actor === "agent") {
        const user = await this.store.getUserById(ownerId);
        if (!user?.agentConnectedAt || user.agentToolCatalogId !== "life-links-search-v4") {
          throw new RecordSearchError(403, "search_agent_connection_required");
        }
      }
      options.signal?.throwIfAborted();
    };
    await admit();
    const state = decodeCursor(input.cursor, ownerId, q, category);
    const results: RecordSearchHit[] = [];
    const attachmentSources = new Map<string, string>();
    const warnings = new Set<string>();
    let scanned = 0;
    let files = 0;
    let done = false;
    const advance = () => {
      done = state.nextOuter === null;
      state.outer = state.nextOuter; state.target = null; state.inner = null; state.phase = "root";
    };
    const hit = (id: string, title: string, fields: Field[], reference: RecordSearchReference, subtitle?: string) => {
      const match = fields.find(([, text]) => text.toLocaleLowerCase("en-US").includes(q));
      if (!match) return;
      results.push({ id, category, title, snippet: snippet(match[1], q), matchedField: match[0], reference,
        ...(subtitle ? { subtitle } : {}) });
    };
    if (category === "life_links") {
      const page = await this.store.searchLifeLinks(ownerId, q, { cursor: state.outer, limit });
      for (const item of page.items) {
        const detail = await this.store.getLifeLinkDetail(ownerId, item.lifeLink.id, { limit: 1 });
        if (!detail) continue;
        const path = item.path.items.map((entry) => entry.title).join(" / ");
        const locator = deriveLifeLinkPhysicalLocator(item.path);
        const content = item.matchClass === "recorded_path" ? path : item.matchClass === "context"
          // Match the canonical physical search's NFKC/trim/lowercase rule,
          // while retaining the original recorded text in the returned excerpt.
          ? Object.values(detail.lifeLink.context).map((value) => typeof value === "object" && value !== null ? value.text : "")
            .find((text) => text.normalize("NFKC").trim().toLowerCase().includes(q.normalize("NFKC").trim().toLowerCase())) ?? ""
          : item.matchClass === "body" ? detail.lifeLink.body : item.matchClass === "exact_qr" ? item.lifeLink.qrId ?? "" : item.lifeLink.title;
        results.push({ id: `life_link:${item.lifeLink.id}`, category, title: item.lifeLink.title,
          snippet: snippet(content, q), matchedField: item.matchClass, reference: { kind: "life_link", lifeLinkId: item.lifeLink.id },
          subtitle: `${path}${locator ? ` · QR locator: ${locator.title} · ${locator.qrId}` : ""}${item.path.truncated ? " · Recorded path incomplete" : ""}` });
      }
      state.outer = page.nextCursor; done = page.nextCursor === null; scanned = page.items.length;
      if (page.truncated) warnings.add("life_link_paths_may_be_incomplete");
    } else while (!done && scanned < SCAN_BUDGET && results.length < limit && files < FILE_BUDGET) {
      await admit();
      if (category === "routines") {
        const page = await this.store.listRoutines(ownerId, { cursor: state.outer, limit: 1 }, actor);
        const summary = page.items[0]; scanned++;
        state.nextOuter = page.nextCursor;
        if (summary) {
          const detail = await this.store.getRoutine(ownerId, summary.id, actor);
          if (detail && !detail.routine.archivedAt) {
            const { revision, steps } = detail.currentRevision;
            const fields: Field[] = [["title", revision.title], ["purpose", revision.purpose], ["instructions", revision.instructions]];
            const group = detail.routine.groupId ? await this.store.getRoutineGroup(ownerId, detail.routine.groupId) : null;
            if (group) fields.push(["group", `${group.title}\n${group.notes}`]);
            const definitionMatches = fields.some(([, text]) => text.toLocaleLowerCase("en-US").includes(q));
            const matchingStep = steps.find((step) => [step.activityTitle, step.instructions, valueText(step.plannedValues)]
              .some((text) => text.toLocaleLowerCase("en-US").includes(q)));
            if (matchingStep) fields.push(["step", `${matchingStep.activityTitle}\n${matchingStep.instructions}\n${valueText(matchingStep.plannedValues)}`]);
            hit(`routine:${summary.id}`, revision.title, fields, { kind: "routine", routineId: summary.id,
              routineRevisionId: revision.id, ...(!definitionMatches && matchingStep ? { routineStepId: matchingStep.id } : {}) });
          }
        }
        advance();
      } else if (category === "history") {
        const page = await this.store.listRoutineSessions(ownerId, null, { cursor: state.outer, limit: 1 });
        const record = page.items[0]; scanned++;
        state.nextOuter = page.nextCursor;
        if (record) {
          const [session, revision] = await Promise.all([
            this.store.getRoutineSession(ownerId, record.id),
            this.store.getRoutineRevision(ownerId, record.routineId, record.routineRevisionId)
          ]);
          if (session) {
            const fields: Field[] = revision ? [["recorded_title", revision.revision.title], ["recorded_purpose", revision.revision.purpose],
              ["recorded_instructions", revision.revision.instructions], ...revision.steps.map((step): Field =>
                ["recorded_step", `${step.activityTitle}\n${step.instructions}\n${valueText(step.plannedValues)}`])] : [];
            for (const result of session.stepResults) {
              fields.push(["original_result", `${result.original.notes}\n${valueText(result.original.actualValues)}\n${valueText(result.original.proposedNextValues)}`],
                ["effective_result", `${valueText(result.effectiveActualValues)}\n${valueText(result.effectiveProposedNextValues)}`]);
              for (const amendment of result.amendments) fields.push(["correction", `${amendment.note}\n${valueText(amendment.correctedActualValues ?? [])}\n${valueText(amendment.correctedProposedNextValues ?? [])}`]);
            }
            fields.push(...session.sessionAmendments.map((amendment): Field => ["session_note", amendment.note]));
            hit(`session:${record.id}`, revision?.revision.title ?? "Completed Routine", fields,
              { kind: "session", routineId: record.routineId, sessionId: record.id, routineRevisionId: record.routineRevisionId }, record.completedAt);
          }
        }
        advance();
      } else if (category === "collections") {
        if (state.phase === "root") {
          const page = await this.store.listCollections(ownerId, { cursor: state.outer, limit: 1 });
          const collection = page.items[0]; scanned++; state.nextOuter = page.nextCursor;
          if (!collection) { advance(); continue; }
          state.target = collection.id; state.phase = "children";
          hit(`collection:${collection.id}`, collection.title, [["title", collection.title], ["purpose", collection.purpose], ["notes", collection.notes]],
            { kind: "collection", collectionId: collection.id });
        } else {
          const collection = await this.store.getCollection(ownerId, state.target!);
          if (!collection) { scanned++; advance(); continue; }
          const page = await this.store.listCollectionSections(ownerId, collection.id, { cursor: state.inner, limit: 1 });
          scanned++;
          const section = page?.items[0];
          if (section) hit(`section:${section.id}`, section.title, [["section_title", section.title]],
            { kind: "collection", collectionId: collection.id, sectionId: section.id }, collection.title);
          state.inner = page?.nextCursor ?? null;
          if (!state.inner) advance();
        }
      } else if (category === "calendar") {
        warnings.add("provider_events_include_synchronized_cache_only");
        if (state.phase === "root") {
          const page = await this.store.listCalendars(ownerId, { cursor: state.outer, limit: 1 }, actor);
          const calendar = page.items[0]; scanned++; state.nextOuter = page.nextCursor;
          if (!calendar || calendar.deletedAt) { advance(); continue; }
          state.target = calendar.id; state.phase = "children";
        } else {
          const calendar = await this.store.getCalendar(ownerId, state.target!, actor);
          if (!calendar || calendar.deletedAt) { scanned++; advance(); continue; }
          if (calendar.source === "native") {
            const page = await this.store.listCalendarEvents(ownerId, { calendarId: calendar.id, cursor: state.inner, limit: 1 }, actor);
            scanned++;
            const event = page.items[0];
            if (event && !event.event.deletedAt) hit(`calendar:native:${event.event.id}`, event.currentRevision.title,
              [["title", event.currentRevision.title], ["description", event.currentRevision.description], ["location", event.currentRevision.location]],
              { kind: "calendar_event", authority: "native", calendarId: calendar.id, eventId: event.event.id }, calendar.title);
            state.inner = page.nextCursor;
          } else if (this.gateway) {
            try {
              const page = await this.gateway.pageCalendarProjections(ownerId, calendar.id, state.inner, 1, actor === "human" ? "owner" : "agent");
              scanned++;
              const event = page.items[0];
              if (event) hit(`calendar:provider:${event.connectionId}:${event.calendarId}:${event.providerEventId}`, event.content.title,
                [["title", event.content.title], ["description", event.content.description ?? ""], ["location", event.content.location ?? ""]],
                { kind: "calendar_event", authority: "provider", connectionId: event.connectionId, calendarId: event.calendarId, providerEventId: event.providerEventId },
                `${calendar.title} · synchronized ${event.synchronizedAt}`);
              state.inner = page.nextAfter;
            } catch (error) {
              if (!(error instanceof CalendarProviderGatewayError) || !["calendar_not_found", "connection_not_found", "connection_inactive", "calendar_read_only", "agent_calendar_access_denied"].includes(error.code)) throw error;
              scanned++; state.inner = null;
            }
          } else { scanned++; state.inner = null; warnings.add("provider_event_cache_unavailable"); }
          if (!state.inner) advance();
        }
      } else if (category === "attachments") {
        warnings.add("attachment_search_uses_extractable_text_without_automatic_ocr_or_transcription");
        if (state.phase === "root") {
          const page = await this.store.listRecordSearchLifeLinks(ownerId, { cursor: state.outer, limit: 1 });
          const record = page.items[0]; scanned++; state.nextOuter = page.nextCursor;
          if (!record) { advance(); continue; }
          state.target = record.id; state.phase = "children";
        } else {
          const detail = await this.store.getLifeLinkDetail(ownerId, state.target!, { limit: 1 });
          const media = detail?.lifeLink.media.filter((item) => !state.inner || item.id > state.inner)
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
          if (!detail || !media) { scanned++; advance(); continue; }
          state.inner = media.id; scanned++; files++;
          const file = await this.store.getLifeLinkMedia(ownerId, detail.lifeLink.id, media.id);
          if (!file) continue;
          const resultId = `attachment:${detail.lifeLink.id}:${media.id}`;
          const source = attachmentIdentity(file);
          attachmentSources.set(resultId, source);
          if (!this.attachments) {
            warnings.add("attachment_text_reader_unavailable");
            hit(resultId, media.fileName, [["file_name", media.fileName]], { kind: "attachment", lifeLinkId: detail.lifeLink.id, mediaId: media.id }, detail.lifeLink.title);
            continue;
          }
          let text;
          try { text = await this.attachments.search(file, q, options.signal); }
          catch (error) {
            options.signal?.throwIfAborted();
            // Text extraction availability does not remove filename discovery.
            // No exception text, document text, or provider diagnostics are exposed.
            warnings.add("some_attachment_text_unavailable");
            hit(resultId, media.fileName, [["file_name", media.fileName]], { kind: "attachment", lifeLinkId: detail.lifeLink.id, mediaId: media.id }, detail.lifeLink.title);
            continue;
          }
          await admit();
          const currentFile = await this.store.getLifeLinkMedia(ownerId, detail.lifeLink.id, media.id);
          if (!currentFile || attachmentIdentity(currentFile) !== source) { warnings.add("attachment_changed_during_search"); continue; }
          if (text.status !== "ready" || text.warnings.length) warnings.add("some_attachments_have_limited_text_coverage");
          for (const warning of text.warnings) warnings.add(warning);
          if (text.matched) results.push({ id: resultId, category, title: media.fileName,
            snippet: text.snippet, matchedField: "attachment_contents", subtitle: detail.lifeLink.title,
            reference: { kind: "attachment", lifeLinkId: detail.lifeLink.id, mediaId: media.id, revision: text.revision,
              ...(text.offset === null ? {} : { offset: text.offset }) } });
          else hit(resultId, media.fileName, [["file_name", media.fileName]],
            { kind: "attachment", lifeLinkId: detail.lifeLink.id, mediaId: media.id, revision: text.revision }, detail.lifeLink.title);
        }
      }
    }
    // An earlier hit must not outlive access removed while later records were scanned.
    for (let index = results.length - 1; index >= 0; index--) {
      const reference = results[index]!.reference;
      if (reference.kind === "calendar_event") {
        let available = false;
        try {
          const calendar = await this.store.getCalendar(ownerId, reference.calendarId, actor);
          const event = reference.authority === "native" ? await this.store.getCalendarEvent(ownerId, reference.eventId, actor) : null;
          available = Boolean(calendar && !calendar.deletedAt && (reference.authority === "native"
            ? event && !event.event.deletedAt
            : await this.gateway?.getProjection(ownerId, reference.connectionId, reference.calendarId, reference.providerEventId, actor === "human" ? "owner" : "agent")));
        } catch (error) {
          if (!(error instanceof CalendarProviderGatewayError)) throw error;
          if (!["calendar_not_found", "connection_not_found", "connection_inactive", "calendar_read_only", "agent_calendar_access_denied"].includes(error.code)) throw error;
        }
        if (!available) results.splice(index, 1);
      } else if (reference.kind === "attachment") {
        const current = await this.store.getLifeLinkMedia(ownerId, reference.lifeLinkId, reference.mediaId);
        if (!current || attachmentIdentity(current) !== attachmentSources.get(results[index]!.id)) results.splice(index, 1);
      }
    }
    await admit();
    return { category, results, nextCursor: done ? null : encodeCursor(state), scanned, warnings: [...warnings].sort() };
  }
}

function normalizeInput(input: RecordSearchInput) {
  if (typeof input.q !== "string" || !input.q.trim() || input.q.length > MAX_RECORD_SEARCH_QUERY_LENGTH ||
      !RECORD_SEARCH_CATEGORIES.includes(input.category) || (input.cursor != null && typeof input.cursor !== "string")) {
    throw new RecordSearchError(400, "invalid_record_search");
  }
  const limit = input.limit ?? DEFAULT_RECORD_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORD_SEARCH_LIMIT) throw new RecordSearchError(400, "invalid_record_search");
  return { q: input.q.trim().toLocaleLowerCase("en-US"), category: input.category, limit };
}

function encodeCursor(state: Traversal): string { return Buffer.from(JSON.stringify(state)).toString("base64url"); }
function decodeCursor(cursor: string | null | undefined, owner: string, q: string, category: RecordSearchCategory): Traversal {
  const queryDigest = createHash("sha256").update(q).digest("hex");
  const initial: Traversal = { version: 1, owner, q: queryDigest, category, outer: null, target: null, nextOuter: null, inner: null, phase: "root" };
  if (!cursor) return initial;
  try {
    if (cursor.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Traversal;
    if (!value || Object.keys(value).sort().join() !== Object.keys(initial).sort().join() || value.version !== 1 ||
        value.owner !== owner || value.q !== queryDigest || value.category !== category ||
        !["root", "children"].includes(value.phase) ||
        [value.outer, value.target, value.nextOuter, value.inner].some((field) => field !== null && (typeof field !== "string" || field.length > 4096)) ||
        (value.phase === "children" && !value.target)) throw new Error();
    return value;
  } catch { throw new RecordSearchError(400, "invalid_record_search_cursor"); }
}

function snippet(text: string, q: string): string {
  const start = Math.max(0, text.toLocaleLowerCase("en-US").indexOf(q) - 60);
  // Do not split a surrogate pair at either end of a bounded snippet.
  let from = start; if (from && /[\uDC00-\uDFFF]/.test(text[from]!)) from--;
  let end = Math.min(text.length, from + MAX_RECORD_SEARCH_SNIPPET_LENGTH);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
  return text.slice(from, end);
}

function valueText(values: RoutineValue[]): string {
  return values.map((value) => `${value.label}: ${value.kind === "text" ? value.text : value.kind === "quantity" ? `${value.amount} ${value.unit}` :
    value.kind === "duration" ? `${value.seconds} seconds` : String(value.value)}`).join("\n");
}

function attachmentIdentity(file: LifeLinkMediaFile): string {
  return createHash("sha256").update(file.media.mimeType).update("\0").update(file.media.fileName).update("\0").update(file.data).digest("hex");
}
