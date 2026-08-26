import { describe, expect, it } from "vitest";

import { createLinkBodyDocFromPlainText, type LinkBodyDoc } from "@life-links/core";

import { applyAgentDraftToEditorContent, type AgentDraftEditorContent } from "./agentDraft";
import type { AgentLifeLinkDraftProposal } from "../workspace/types";

const richBodyDoc: LinkBodyDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Keep this structure" }]
    }
  ]
};

const current: AgentDraftEditorContent = {
  title: "Human title in progress",
  body: "Keep this structure",
  bodyDoc: richBodyDoc,
  bodyDocVersion: 7,
  privacy: "private"
};

function proposal(proposedFields: Array<"title" | "body">): AgentLifeLinkDraftProposal {
  return {
    lifeLinkId: "life-link-1",
    baseUpdatedAt: "2026-08-26T12:00:00.000Z",
    proposedFields,
    before: {
      title: "Server title",
      body: "Server body"
    },
    after: {
      title: "Agent title",
      body: "Agent body"
    },
    sourceLifeLinkIds: [],
    createdAt: "2026-08-26T12:01:00.000Z"
  };
}

describe("applyAgentDraftToEditorContent", () => {
  it("applies a title-only proposal without flattening the current rich body", () => {
    const result = applyAgentDraftToEditorContent(current, proposal(["title"]));

    expect(result).toEqual({ ...current, title: "Agent title" });
    expect(result.bodyDoc).toBe(richBodyDoc);
  });

  it("replaces only the body document when body was explicitly proposed", () => {
    const result = applyAgentDraftToEditorContent(current, proposal(["body"]));

    expect(result).toEqual({
      ...current,
      body: "Agent body",
      bodyDoc: createLinkBodyDocFromPlainText("Agent body"),
      bodyDocVersion: 1
    });
    expect(result.title).toBe("Human title in progress");
    expect(result.privacy).toBe("private");
  });

  it("applies both proposed content fields while preserving privacy", () => {
    const result = applyAgentDraftToEditorContent(current, proposal(["title", "body"]));

    expect(result.title).toBe("Agent title");
    expect(result.body).toBe("Agent body");
    expect(result.privacy).toBe("private");
  });
});
