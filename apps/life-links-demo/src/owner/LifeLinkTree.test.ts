import { describe, expect, it } from "vitest";
import type { LifeLinkSummary } from "@life-links/core";

import type { LifeLinkBranchState } from "../workspace/types";
import { buildVisibleLifeLinkRows } from "./LifeLinkTree";

describe("LifeLinkTree", () => {
  it("flattens a 50-level expanded hierarchy iteratively with stable identity", () => {
    const nodes = Array.from({ length: 51 }, (_, index) => node(index));
    const children: Record<string, LifeLinkBranchState> = {};
    for (let index = 0; index < nodes.length - 1; index += 1) {
      children[nodes[index].id] = branch([nodes[index + 1]]);
    }
    children[nodes[nodes.length - 1].id] = branch([]);

    const rows = buildVisibleLifeLinkRows([nodes[0]], children, nodes.slice(0, -1).map((item) => item.id));
    const lifeLinkRows = rows.filter((row) => row.kind === "life-link");

    expect(lifeLinkRows).toHaveLength(51);
    expect(lifeLinkRows.at(-1)).toMatchObject({ kind: "life-link", depth: 50, lifeLink: { id: "life-link-50" } });
    expect(new Set(lifeLinkRows.map((row) => row.lifeLink.id)).size).toBe(51);
  });

  it("keeps duplicate titles distinct and places pagination after loaded children", () => {
    const root = node(0);
    const duplicateA = { ...node(1), title: "Shelf" };
    const duplicateB = { ...node(2), title: "Shelf" };
    const rows = buildVisibleLifeLinkRows(
      [root],
      {
        [root.id]: { ...branch([duplicateA, duplicateB]), nextCursor: "next", truncated: true }
      },
      [root.id]
    );

    expect(rows.map((row) => row.kind === "life-link" ? row.lifeLink.id : `more:${row.parentId}`)).toEqual([
      root.id,
      duplicateA.id,
      duplicateB.id,
      `more:${root.id}`
    ]);
  });

  it("keeps a selected deep-link path visible while an ancestor branch is only partially known", () => {
    const root = node(0);
    const shelf = node(1);
    const bin = node(2);
    const rows = buildVisibleLifeLinkRows(
      [root],
      {
        [root.id]: { ...branch([shelf]), loaded: false },
        [shelf.id]: { ...branch([bin]), loaded: false }
      },
      [root.id, shelf.id]
    );

    expect(rows.map((row) => row.kind === "life-link" ? row.lifeLink.id : `load:${row.parentId}`)).toEqual([
      root.id,
      shelf.id,
      bin.id,
      `load:${shelf.id}`,
      `load:${root.id}`
    ]);
    expect(rows.filter((row) => row.kind === "load-more")).toEqual([
      expect.objectContaining({ parentId: shelf.id, parentTitle: shelf.title, loaded: false, canLoad: true }),
      expect.objectContaining({ parentId: root.id, parentTitle: root.title, loaded: false, canLoad: true })
    ]);
  });
});

function node(index: number): LifeLinkSummary {
  return {
    id: `life-link-${index}`,
    parentId: index ? `life-link-${index - 1}` : null,
    qrId: null,
    title: `Level ${index}`,
    privacy: "private",
    browsingRole: index < 50 ? "container" : "item",
    updatedAt: "2026-08-26T00:00:00.000Z",
    childCount: index < 50 ? 1 : 0
  };
}

function branch(items: LifeLinkSummary[]): LifeLinkBranchState {
  return { items, nextCursor: null, truncated: false, loaded: true, loading: false };
}
