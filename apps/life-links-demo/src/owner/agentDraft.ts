import {
  LINK_BODY_DOC_VERSION,
  createLinkBodyDocFromPlainText,
  type LinkBodyDoc,
  type PrivacyStatus
} from "@life-links/core";

import type { AgentLifeLinkDraftProposal } from "../workspace/types";

export type AgentDraftEditorContent = {
  title: string;
  body: string;
  bodyDoc: LinkBodyDoc;
  bodyDocVersion: number;
  privacy: PrivacyStatus;
};

export function applyAgentDraftToEditorContent(
  current: AgentDraftEditorContent,
  proposal: AgentLifeLinkDraftProposal
): AgentDraftEditorContent {
  const proposesTitle = proposal.proposedFields.includes("title");
  const proposesBody = proposal.proposedFields.includes("body");

  return {
    ...current,
    title: proposesTitle ? proposal.after.title : current.title,
    body: proposesBody ? proposal.after.body : current.body,
    bodyDoc: proposesBody ? createLinkBodyDocFromPlainText(proposal.after.body) : current.bodyDoc,
    bodyDocVersion: proposesBody ? LINK_BODY_DOC_VERSION : current.bodyDocVersion
  };
}
