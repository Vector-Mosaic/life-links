import { describe, expect, it } from "vitest";
import { AGENT_GUIDE_SECTIONS, REMOTE_AGENT_INSTRUCTIONS } from "./agent-guide.js";

describe("curated agent guide", () => {
  it("provides concise initialization and separately bounded discoverable sections", () => {
    expect(Buffer.byteLength(REMOTE_AGENT_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(2400);
    expect(REMOTE_AGENT_INSTRUCTIONS).toContain("untrusted data");
    expect(REMOTE_AGENT_INSTRUCTIONS).toContain("model boolean");
    expect(new Set(AGENT_GUIDE_SECTIONS.map((section) => section.id)).size).toBe(AGENT_GUIDE_SECTIONS.length);
    for (const section of AGENT_GUIDE_SECTIONS) {
      expect(section.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(section.title.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(section.content, "utf8")).toBeLessThanOrEqual(4096);
    }
  });

  it("retains the built-domain workflows and every required illustrative example", () => {
    expect(AGENT_GUIDE_SECTIONS.map((section) => section.id)).toEqual([
      "getting-started", "physical-life-links", "collections", "search-and-attachments",
      "qr-and-find", "routines-and-history", "calendar", "changes-and-permissions",
      "camping-example", "filament-example", "makeup-example", "workshop-example"
    ]);
    expect(AGENT_GUIDE_SECTIONS.find((section) => section.id === "filament-example")?.content).toContain("sensor-measured");
    expect(AGENT_GUIDE_SECTIONS.find((section) => section.id === "makeup-example")?.content).toContain("Possession alone does not prove liking");
    expect(AGENT_GUIDE_SECTIONS.find((section) => section.id === "routines-and-history")?.content).toContain("Corrections append");
    const changes = AGENT_GUIDE_SECTIONS.find((section) => section.id === "changes-and-permissions")!.content;
    expect(changes).toContain("awaiting_confirmation means pending");
    expect(changes).toContain("Never call the app-only confirmation tool yourself");
  });
});
