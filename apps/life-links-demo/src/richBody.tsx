import type { ReactNode } from "react";

import {
  createLinkBodyDocFromPlainText,
  normalizeLinkBodyHref,
  normalizeLinkBodyDoc,
  type LinkBodyDoc,
  type LinkBodyDocMark,
  type LinkBodyDocNode
} from "@life-links/core";

type RichBodyRendererProps = {
  body: string;
  bodyDoc?: LinkBodyDoc | null;
  emptyText?: string;
};

export function RichBodyRenderer({ body, bodyDoc, emptyText = "No content yet." }: RichBodyRendererProps) {
  const doc = normalizeLinkBodyDoc(bodyDoc) ?? createLinkBodyDocFromPlainText(body);
  if (!doc.content?.length) {
    return <p className="formatted-body-empty">{emptyText}</p>;
  }
  return <div className="formatted-body">{doc.content.map((node, index) => renderDocNode(node, `rich-${index}`))}</div>;
}

function renderDocNode(node: LinkBodyDocNode, key: string): ReactNode {
  if (node.type === "heading") {
    const level = Number(node.attrs?.level ?? 2);
    if (level === 1) {
      return <h2 key={key}>{renderInlineContent(node, key)}</h2>;
    }
    if (level === 3) {
      return <h4 key={key}>{renderInlineContent(node, key)}</h4>;
    }
    return <h3 key={key}>{renderInlineContent(node, key)}</h3>;
  }
  if (node.type === "bulletList") {
    return (
      <ul key={key} className="body-list">
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`}>{renderInlineContent(item, `${key}-${index}`)}</li>
        ))}
      </ul>
    );
  }
  if (node.type === "orderedList") {
    return (
      <ol key={key} className="body-list">
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`}>{renderInlineContent(item, `${key}-${index}`)}</li>
        ))}
      </ol>
    );
  }
  if (node.type === "taskList") {
    return (
      <ul key={key} className="body-list checklist">
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`}>
            <input type="checkbox" checked={Boolean(item.attrs?.checked)} readOnly aria-label="To-do item" />
            <span>{renderInlineContent(item, `${key}-${index}`)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (node.type === "blockquote") {
    return <blockquote key={key}>{renderInlineContent(node, key)}</blockquote>;
  }
  if (node.type === "horizontalRule") {
    return <hr key={key} />;
  }
  return <p key={key}>{renderInlineContent(node, key)}</p>;
}

function renderInlineContent(node: LinkBodyDocNode, key: string): ReactNode[] {
  return (node.content ?? []).flatMap((child, index) => renderInlineNode(child, `${key}-inline-${index}`));
}

function renderInlineNode(node: LinkBodyDocNode, key: string): ReactNode[] {
  if (node.type === "hardBreak") {
    return [<br key={key} />];
  }
  if (node.type === "text") {
    return [applyMarks(node.text ?? "", node.marks ?? [], key)];
  }
  return renderInlineContent(node, key);
}

function applyMarks(text: string, marks: LinkBodyDocMark[], key: string): ReactNode {
  return marks.reduce<ReactNode>((current, mark, index) => {
    if (mark.type === "bold") {
      return <strong key={`${key}-bold-${index}`}>{current}</strong>;
    }
    if (mark.type === "italic") {
      return <em key={`${key}-italic-${index}`}>{current}</em>;
    }
    if (mark.type === "link") {
      const href = normalizeLinkBodyHref(mark.attrs?.href);
      if (href) {
        return (
          <a key={`${key}-link-${index}`} href={href} target="_blank" rel="noopener noreferrer">
            {current}
          </a>
        );
      }
    }
    return current;
  }, <span key={key}>{text}</span>);
}
