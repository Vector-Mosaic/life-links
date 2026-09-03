// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { RecordSearchPanel } from "./RecordSearchPanel";
import { AttachmentList } from "./AttachmentList";
import { getLifeLinkAttachmentContent } from "../api";

vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), getLifeLinkAttachmentContent: vi.fn() }));

describe("whole-app Search UI", () => {
  let host: HTMLDivElement; let root: Root; let snapshot: LifeLinksWorkspaceSnapshot;
  let actions: Record<string, ReturnType<typeof vi.fn>>;
  let controller: LifeLinksWorkspaceController;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const baseline = new LifeLinksWorkspaceController(); snapshot = structuredClone(baseline.getSnapshot()); baseline.dispose();
    snapshot.recordSearch.query = "workout"; snapshot.lifeLinkSearchQuery = "workout";
    actions = { searchRecords: vi.fn(), setLifeLinkSearchQuery: vi.fn(), cancelRecordSearch: vi.fn(), loadMoreRecordSearch: vi.fn(), openRecordSearchHit: vi.fn() };
    controller = actions as unknown as LifeLinksWorkspaceController;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<RecordSearchPanel controller={controller} snapshot={snapshot} />)); };

  it("shows all categories and submits through whole-app search", async () => {
    await render();
    for (const label of ["Life Links & items", "Collections & sections", "Routines & steps", "Routine history", "Calendar events", "Attachments"]) expect(host.textContent).toContain(label);
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(actions.searchRecords).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("No matches.");
  });
  it("keeps partial document coverage visible and opens the exact historical source", async () => {
    const hit = { id: "session:s1", category: "history" as const, title: "Previous strength workout", snippet: "Original: 50 kg", matchedField: "original_result",
      reference: { kind: "session" as const, routineId: "r1", sessionId: "s1", routineRevisionId: "old-revision" } };
    snapshot.recordSearch.groups.history = { ...snapshot.recordSearch.groups.history, results: [hit], searched: true };
    snapshot.recordSearch.groups.attachments = { ...snapshot.recordSearch.groups.attachments, searched: true, nextCursor: "continue", warnings: ["An image-only document could not be searched."] };
    await render();
    expect(host.textContent).toContain("An image-only document could not be searched.");
    const open = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(hit.title))!;
    await act(async () => open.click());
    expect(actions.openRecordSearchHit).toHaveBeenCalledWith(hit);
    const more = [...host.querySelectorAll("button")].find((button) => button.textContent === "Load more results")!;
    await act(async () => more.click());
    expect(actions.loadMoreRecordSearch).toHaveBeenCalledWith("attachments");
  });
  it("preserves an exact attachment source on retry instead of silently switching revisions", async () => {
    const revision = "a".repeat(64);
    vi.mocked(getLifeLinkAttachmentContent).mockRejectedValue(new Error("Attachment changed. Search again."));
    await act(async () => root.render(<AttachmentList lifeLinkId="item-1" attachments={[
      { id: "media-1", kind: "document", mimeType: "text/plain", fileName: "Workout notes.txt", sizeBytes: 8000, url: "/private/media-1" }
    ]} searchTarget={{ mediaId: "media-1", revision, offset: 5000 }} />));
    expect(getLifeLinkAttachmentContent).toHaveBeenLastCalledWith("item-1", "media-1", expect.objectContaining({ revision, offset: 5000 }));
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(getLifeLinkAttachmentContent).toHaveBeenLastCalledWith("item-1", "media-1", expect.objectContaining({ revision, offset: 5000 }));
  });
});
