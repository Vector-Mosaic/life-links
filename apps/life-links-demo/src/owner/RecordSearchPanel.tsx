import { Search } from "lucide-react";
import { RECORD_SEARCH_CATEGORIES, type RecordSearchCategory } from "@life-links/core";
import type { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";

const labels: Record<RecordSearchCategory, string> = {
  life_links: "Life Links & items", collections: "Collections & sections", routines: "Routines & steps",
  history: "Routine history", calendar: "Calendar events", attachments: "Attachments"
};

const coverageLabels: Record<string, string> = {
  provider_events_include_synchronized_cache_only: "Connected-calendar results cover events already synchronized into LifeLinks.",
  provider_event_cache_unavailable: "Connected-calendar events could not be searched right now.",
  attachment_search_uses_extractable_text_without_automatic_ocr_or_transcription: "Attachment search does not include OCR or video transcripts.",
  some_attachments_have_limited_text_coverage: "Some attachments are unreadable, image-only, or have limited extracted text; those contents were not fully searched.",
  attachment_text_reader_unavailable: "Document text could not be searched right now. File names can still match.",
  attachment_changed_during_search: "An attachment changed during this search. Search again to check its current contents.",
  some_attachment_text_unavailable: "Some attachment contents could not be searched right now.",
  life_link_paths_may_be_incomplete: "Some recorded location paths may be incomplete."
};

export function RecordSearchPanel({ controller, snapshot }: { controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot }) {
  const state = snapshot.recordSearch;
  const loading = RECORD_SEARCH_CATEGORIES.some((category) => state.groups[category].loading);
  return <section className="ll-search-screen" aria-label="Whole-app search">
    <form className="ll-search-form" onSubmit={(event) => { event.preventDefault(); void controller.searchRecords(); }}>
      <Search size={19} /><input aria-label="Search records" placeholder="Search items, routines, events, and attachment text"
        maxLength={2048} value={snapshot.lifeLinkSearchQuery} onChange={(event) => controller.setLifeLinkSearchQuery(event.target.value)} />
      <button className="ll-button ll-primary" disabled={!snapshot.lifeLinkSearchQuery.trim()}>Search</button>
    </form>
    <p className="ll-muted">Items, notes and purpose · Routines and completed history · Calendar events · Document text</p>
    {loading && <div className="ll-button-row"><p role="status">Searching… Results appear as each area is checked.</p><button className="ll-text-button" onClick={() => controller.cancelRecordSearch()}>Stop search</button></div>}
    {state.query && <>
      <p className="ll-muted">Results for “{state.query}”</p>
      {RECORD_SEARCH_CATEGORIES.map((category) => {
        const group = state.groups[category];
        return <section className="ll-detail-section" key={category} aria-label={labels[category]} aria-busy={group.loading}>
          <h3>{labels[category]}{group.results.length ? ` · ${group.results.length}${group.nextCursor ? "+" : ""}` : ""}</h3>
          {category === "calendar" && <p className="ll-muted">Native events and events already synchronized from connected calendars. Hidden overlay calendars are still searchable.</p>}
          {category === "attachments" && <p className="ll-muted">File names and extractable document text. Image-only and unreadable files are reported below; search does not run OCR or video transcription.</p>}
          {group.results.map((hit) => <div className="ll-search-result" key={hit.id}>
            <button className="ll-search-open" onClick={() => void controller.openRecordSearchHit(hit)}>
              <strong>{hit.title}</strong>{hit.subtitle && <span>{hit.subtitle}</span>}
              {hit.snippet && <small>{hit.snippet}</small>}<small>Matched: {hit.matchedField}</small>
            </button>
          </div>)}
          {group.loading && <p className="ll-muted" role="status">Checking {labels[category].toLowerCase()}… {group.scanned} checked.</p>}
          {group.warnings.length > 0 && <ul className="ll-inline-warning">{group.warnings.map((warning) => <li key={warning}>{coverageLabels[warning] ?? warning}</li>)}</ul>}
          {group.error && <p className="ll-inline-warning" role="alert">{group.error}</p>}
          {!group.loading && group.searched && !group.error && !group.nextCursor && !group.results.length &&
            <p className="ll-muted">{group.warnings.length ? "No matches in the content that could be searched." : "No matches."}</p>}
          {!group.loading && (!group.searched || group.nextCursor || group.error) &&
            <button className="ll-text-button" onClick={() => void controller.loadMoreRecordSearch(category)}>
              {group.error ? "Continue search" : group.searched ? "Load more results" : `Search ${labels[category].toLowerCase()}`}
            </button>}
        </section>;
      })}
    </>}
  </section>;
}
