import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight, LoaderCircle, QrCode } from "lucide-react";
import type { LifeLinkSummary } from "@life-links/core";

import type { LifeLinkBranchState } from "../workspace/types";

export type VisibleLifeLinkTreeRow =
  | {
      kind: "life-link";
      lifeLink: LifeLinkSummary;
      depth: number;
      expanded: boolean;
      branch: LifeLinkBranchState | null;
    }
  | {
      kind: "load-more";
      parentId: string;
      depth: number;
      loading: boolean;
      loaded: boolean;
      canLoad: boolean;
      parentTitle: string;
    };

export function buildVisibleLifeLinkRows(
  roots: LifeLinkSummary[],
  children: Record<string, LifeLinkBranchState>,
  expandedIds: readonly string[]
): VisibleLifeLinkTreeRow[] {
  const expanded = new Set(expandedIds);
  const visited = new Set<string>();
  const rows: VisibleLifeLinkTreeRow[] = [];
  const stack: Array<
    | { kind: "life-link"; lifeLink: LifeLinkSummary; depth: number }
    | {
        kind: "load-more";
        parentId: string;
        parentTitle: string;
        depth: number;
        loading: boolean;
        loaded: boolean;
        canLoad: boolean;
      }
  > = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ kind: "life-link", lifeLink: roots[index], depth: 0 });
  }

  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.kind === "load-more") {
      rows.push(entry);
      continue;
    }
    if (visited.has(entry.lifeLink.id)) {
      continue;
    }
    visited.add(entry.lifeLink.id);
    const branch = children[entry.lifeLink.id] ?? null;
    const isExpanded = expanded.has(entry.lifeLink.id);
    rows.push({ kind: "life-link", lifeLink: entry.lifeLink, depth: entry.depth, expanded: isExpanded, branch });
    if (!isExpanded || !branch) {
      continue;
    }
    if (!branch.loaded || branch.nextCursor || branch.truncated || branch.loading) {
      stack.push({
        kind: "load-more",
        parentId: entry.lifeLink.id,
        depth: entry.depth + 1,
        loading: branch.loading,
        loaded: branch.loaded,
        canLoad: !branch.loaded || Boolean(branch.nextCursor),
        parentTitle: entry.lifeLink.title || "Untitled Life Link"
      });
    }
    for (let index = branch.items.length - 1; index >= 0; index -= 1) {
      stack.push({ kind: "life-link", lifeLink: branch.items[index], depth: entry.depth + 1 });
    }
  }
  return rows;
}

export function LifeLinkTree({
  roots,
  children,
  expandedIds,
  selectedId,
  highlightedId,
  onToggle,
  onSelect,
  onLoadMore
}: {
  roots: LifeLinkSummary[];
  children: Record<string, LifeLinkBranchState>;
  expandedIds: readonly string[];
  selectedId: string | null;
  highlightedId: string | null;
  onToggle(lifeLinkId: string): void;
  onSelect(lifeLinkId: string): void;
  onLoadMore(parentId: string): void;
}) {
  const rows = buildVisibleLifeLinkRows(roots, children, expandedIds);
  if (!rows.length) {
    return <div className="empty-state">Create your first top-level Life Link.</div>;
  }

  return (
    <div className="life-link-tree" role="tree" aria-label="My Life Links hierarchy">
      {rows.map((row) => {
        if (row.kind === "load-more") {
          return (
            <button
              key={`more:${row.parentId}`}
              className="life-link-tree-more"
              style={{ "--tree-depth": row.depth } as CSSProperties}
              onClick={() => onLoadMore(row.parentId)}
              disabled={row.loading || !row.canLoad}
              aria-label={
                row.loading
                  ? `Loading children of ${row.parentTitle}`
                  : row.canLoad
                    ? `${row.loaded ? "Load more children of" : "Load children of"} ${row.parentTitle}`
                    : `Additional children of ${row.parentTitle} were omitted by the bounded response`
              }
            >
              {row.loading ? <LoaderCircle className="spin" size={15} /> : null}
              <span>
                {row.loading
                  ? "Loading children"
                  : row.canLoad
                    ? row.loaded
                      ? `Load more children of ${row.parentTitle}`
                      : `Load children of ${row.parentTitle}`
                    : "Additional children omitted by the bounded response"}
              </span>
            </button>
          );
        }
        const { lifeLink } = row;
        const hasChildren = lifeLink.childCount > 0 || Boolean(row.branch?.items.length);
        const classNames = [
          "life-link-tree-row",
          selectedId === lifeLink.id ? "selected" : "",
          highlightedId === lifeLink.id ? "highlighted" : ""
        ].filter(Boolean).join(" ");
        return (
          <div
            key={lifeLink.id}
            className={classNames}
            style={{ "--tree-depth": row.depth } as CSSProperties}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selectedId === lifeLink.id}
            aria-expanded={hasChildren ? row.expanded : undefined}
            data-life-link-id={lifeLink.id}
          >
            <button
              className="life-link-tree-toggle"
              onClick={() => onToggle(lifeLink.id)}
              disabled={!hasChildren}
              aria-label={
                hasChildren
                  ? row.expanded
                    ? `Collapse ${lifeLink.title}`
                    : `Expand ${lifeLink.title}`
                  : `${lifeLink.title || "Untitled Life Link"} has no children`
              }
            >
              {hasChildren ? (row.expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />) : <span />}
            </button>
            <button className="life-link-tree-select" onClick={() => onSelect(lifeLink.id)}>
              <span className="life-link-tree-title">{lifeLink.title || "Untitled Life Link"}</span>
              <span className="life-link-tree-meta">
                <code>{shortIdentity(lifeLink.id)}</code>
                {lifeLink.qrId ? <QrCode size={13} aria-label={`QR ${lifeLink.qrId}`} /> : null}
                {lifeLink.childCount ? <small>{lifeLink.childCount}</small> : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function shortIdentity(id: string) {
  return id.length <= 22 ? id : `${id.slice(0, 13)}...${id.slice(-5)}`;
}
