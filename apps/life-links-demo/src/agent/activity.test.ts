import { describe, expect, it } from "vitest";

import {
  agentActivityLabel,
  createAgentActivityEntry,
  instrumentAgentToolCatalog
} from "./activity";

describe("redacted agent activity", () => {
  it("retains only bounded stable IDs and enumerated visible effects", () => {
    const entry = createAgentActivityEntry({
      tool: "draft_life_link_update",
      outcome: "succeeded",
      affectedLifeLinkIds: ["life-link-1", "life-link-1", "x".repeat(200)],
      visibleEffect: "unsaved_draft_staged",
      errorCode: null
    }, {
      id: "activity-1",
      occurredAt: "2026-08-26T00:00:00.000Z"
    });

    expect(entry.affectedLifeLinkIds).toEqual(["life-link-1", "x".repeat(96)]);
    expect(agentActivityLabel(entry)).toBe("Staged an unsaved Life Link draft");
    expect(JSON.stringify(entry)).not.toMatch(/title|body|path|arguments|payload/i);
  });

  it("produces content-free failure labels", () => {
    const entry = createAgentActivityEntry({
      tool: "search_my_life_links",
      outcome: "failed",
      affectedLifeLinkIds: [],
      visibleEffect: null,
      errorCode: "invalid_input"
    }, { id: "activity-2", occurredAt: "2026-08-26T00:00:00.000Z" });

    expect(agentActivityLabel(entry)).toBe("Search could not complete");
  });

  it("records tool outcomes without copying titles, bodies, paths, or raw input", async () => {
    const activities: ReturnType<typeof createAgentActivityEntry>[] = [];
    const [definition] = instrumentAgentToolCatalog([{
      name: "open_life_link",
      description: "test",
      inputSchema: { type: "object" },
      execute: async () => ({
        ok: true,
        lifeLinkId: "life-link-1",
        title: "Private camera bag",
        body: "Private body",
        recordedPath: "Home / Private camera bag"
      })
    }], (entry) => activities.push(entry));

    await definition.execute({ raw: "must not be retained" });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      tool: "open_life_link",
      outcome: "succeeded",
      affectedLifeLinkIds: ["life-link-1"],
      visibleEffect: "life_link_opened"
    });
    const serialized = JSON.stringify(activities[0]);
    expect(serialized).not.toContain("Private camera bag");
    expect(serialized).not.toContain("Private body");
    expect(serialized).not.toContain("Home /");
    expect(serialized).not.toContain("must not be retained");
  });
});
