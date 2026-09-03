import { describe, expect, it, vi } from "vitest";
import type { RecordSearchPage } from "@life-links/core";
import { collectRecordSearchPage, emptyRecordSearch } from "./recordSearch";

const empty: RecordSearchPage = { category: "history", results: [], nextCursor: null, scanned: 1, warnings: [] };
describe("bounded whole-app search continuation", () => {
  it("continues empty source pages and preserves coverage and an exact result cursor", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ...empty, nextCursor: "next", warnings: ["partial"] })
      .mockResolvedValueOnce({ ...empty, results: [{ id: "s1", category: "history", title: "Old workout", snippet: "Actual: 90 kg", matchedField: "original_result",
        reference: { kind: "session", routineId: "r1", sessionId: "s1", routineRevisionId: "rev1" } }], nextCursor: "later" });
    const publish = vi.fn();
    const result = await collectRecordSearchPage(read, { q: "90", category: "history", limit: 1 }, publish, new AbortController().signal);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toEqual({ q: "90", category: "history", cursor: "next", limit: 1 });
    expect(result).toMatchObject({ scanned: 2, nextCursor: "later", warnings: ["partial"] });
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("never publishes a late cancelled page", async () => {
    const cancellation = new AbortController(); const publish = vi.fn();
    const read = vi.fn(async () => { cancellation.abort(); return empty; });
    await expect(collectRecordSearchPage(read, { q: "old", category: "history" }, publish, cancellation.signal)).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });
  it("reports a repeating cursor rather than claiming the category was exhausted", async () => {
    await expect(collectRecordSearchPage(async () => ({ ...empty, nextCursor: "same" }),
      { q: "old", category: "history", cursor: "same" }, vi.fn(), new AbortController().signal)).rejects.toThrow("repeated");
  });
  it("starts every category unsearched, not falsely empty", () => {
    expect(Object.values(emptyRecordSearch().groups).every((group) => !group.searched && !group.loading)).toBe(true);
  });
});
