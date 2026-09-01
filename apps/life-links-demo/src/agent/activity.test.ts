import { describe, expect, it } from "vitest";

import {
  agentActivityLabel,
  createAgentActivityEntry,
  instrumentAgentToolCatalog
} from "./activity";

describe("redacted agent activity", () => {
  it("records image metadata/bytes readiness without asserting model vision or retaining pixels", async () => {
    const activities: ReturnType<typeof createAgentActivityEntry>[] = [];
    for (const status of ["described", "bytes_ready"]) {
      const [tool] = instrumentAgentToolCatalog([{ name: "read_life_link_attachment", description: "test", inputSchema: {},
        execute: async () => ({ ok: true, lifeLinkId: "life-link-1", status, sourceRevision: "PRIVATE-HASH", image: { mimeType: "image/png", data: "PRIVATE-PIXELS" } }) }], (entry) => activities.push(entry));
      await tool.execute({ representation: "image" });
    }
    expect(agentActivityLabel(activities[0])).toBe("Read attachment image metadata");
    expect(agentActivityLabel(activities[1])).toBe("Prepared attachment image bytes for the agent");
    expect(JSON.stringify(activities)).not.toMatch(/PRIVATE|model_seen|image\.data/);
  });

  it("records an attachment read without retaining its filename, text or warnings", async () => {
    const activities: ReturnType<typeof createAgentActivityEntry>[] = [];
    const [tool] = instrumentAgentToolCatalog([{ name: "read_life_link_attachment", description: "test", inputSchema: {},
      execute: async () => ({ ok: true, lifeLinkId: "life-link-1", fileName: "PRIVATE-FILENAME", text: "PRIVATE-CONTENT", warnings: ["PRIVATE-WARNING"] }) }], (entry) => activities.push(entry));
    await tool.execute({ lifeLinkId: "life-link-1" });
    expect(activities[0].affectedLifeLinkIds).toEqual(["life-link-1"]);
    expect(agentActivityLabel(activities[0])).toBe("Read attachment information");
    expect(JSON.stringify(activities)).not.toContain("PRIVATE");
  });
  it("retains only bounded stable IDs and enumerated visible effects", () => {
    const entry = createAgentActivityEntry({
      tool: "update_life_link_content",
      outcome: "succeeded",
      affectedLifeLinkIds: ["life-link-1", "life-link-1", "x".repeat(200)],
      visibleEffect: "life_link_content_updated",
      errorCode: null
    }, {
      id: "activity-1",
      occurredAt: "2026-08-26T00:00:00.000Z"
    });

    expect(entry.affectedLifeLinkIds).toEqual(["life-link-1", "x".repeat(96)]);
    expect(agentActivityLabel(entry)).toBe("Updated Life Link content");
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

  it("records Collection identity without retaining purpose, Sections, assignments, or private notes", async () => {
    const activities: ReturnType<typeof createAgentActivityEntry>[] = [];
    const [tool] = instrumentAgentToolCatalog([{
      name: "inspect_collection", description: "test", inputSchema: { type: "object" },
      execute: async () => ({ ok: true, collection: { id: "collection-stable", title: "Private trip", purpose: "Sensitive purpose", notes: "Private notes" }, sections: [{ id: "section-1", title: "Private section" }], members: [{ id: "life-link-1", title: "Private item" }], visibleEffect: "collection_opened" })
    }], (entry) => activities.push(entry));
    await tool.execute({ collectionId: "collection-stable", privateInput: "secret input" });
    expect(activities[0]).toMatchObject({ tool: "inspect_collection", affectedCollectionIds: ["collection-stable"], visibleEffect: "collection_opened", outcome: "succeeded" });
    expect(JSON.stringify(activities[0])).not.toMatch(/Private|Sensitive|secret|purpose|notes|section-1/);
  });
});
