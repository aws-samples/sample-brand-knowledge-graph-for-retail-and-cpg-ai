// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { PayoffTree, PayoffTreeNode } from '../../api';

/**
 * GraphRAG's receipts as a left-to-right drawing: the anchor garments (found by vector search) →
 * every look they're in → what's worn with them in those looks (with counts) → the catalog items
 * the guidance found. Four columns, each stacked top to bottom and centered on the tallest one;
 * items are ordered by their category so the links barely cross.
 */
export const COLUMN_ORDER: PayoffTreeNode['kind'][] = ['anchor', 'look', 'category', 'item'];
const COLUMN_W: Record<PayoffTreeNode['kind'], number> = { anchor: 180, look: 230, category: 210, item: 240 };
const ROW_H: Record<PayoffTreeNode['kind'], number> = { anchor: 64, look: 50, category: 58, item: 40 };
const GAP_X = 80;
const GAP_Y = 8;
const PAD = 12;
export const HEADER_H = 26;

export type PlacedNode = PayoffTreeNode & { x: number; y: number; w: number; h: number };
export type PlacedEdge = { source: string; target: string; d: string };
export type PayoffLayout = { width: number; height: number; nodes: PlacedNode[]; edges: PlacedEdge[]; columns: { kind: PayoffTreeNode['kind']; x: number; w: number }[] };

export function payoffTreeLayout(tree: PayoffTree): PayoffLayout {
  const byKind = new Map(COLUMN_ORDER.map((k) => [k, [] as PayoffTreeNode[]]));
  for (const n of tree.nodes) byKind.get(n.kind)?.push(n);
  // items follow their category's order (the edge category -> item says which)
  const parent = new Map(tree.edges.map((e) => [e.target, e.source]));
  const catOrder = new Map((byKind.get('category') ?? []).map((c, i) => [c.id, i]));
  byKind.get('item')?.sort((a, b) => (catOrder.get(parent.get(a.id) ?? '') ?? 99) - (catOrder.get(parent.get(b.id) ?? '') ?? 99));

  const colHeight = (k: PayoffTreeNode['kind']) => {
    const n = byKind.get(k)?.length ?? 0;
    return n ? n * ROW_H[k] + (n - 1) * GAP_Y : 0;
  };
  const tallest = Math.max(...COLUMN_ORDER.map(colHeight));
  const nodes: PlacedNode[] = [];
  const columns: PayoffLayout['columns'] = [];
  let x = PAD;
  for (const k of COLUMN_ORDER) {
    const list = byKind.get(k) ?? [];
    let y = PAD + HEADER_H + (tallest - colHeight(k)) / 2;
    for (const n of list) {
      nodes.push({ ...n, x, y, w: COLUMN_W[k], h: ROW_H[k] });
      y += ROW_H[k] + GAP_Y;
    }
    columns.push({ kind: k, x, w: COLUMN_W[k] });
    x += COLUMN_W[k] + GAP_X;
  }
  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges: PlacedEdge[] = [];
  for (const e of tree.edges) {
    const s = at.get(e.source);
    const t = at.get(e.target);
    if (!s || !t) continue;
    const x1 = s.x + s.w;
    const y1 = s.y + s.h / 2;
    const x2 = t.x;
    const y2 = t.y + t.h / 2;
    const xm = (x1 + x2) / 2;
    edges.push({ source: e.source, target: e.target, d: `M${x1},${y1} C${xm},${y1} ${xm},${y2} ${x2},${y2}` });
  }
  return { width: x - GAP_X + PAD, height: PAD * 2 + HEADER_H + tallest, nodes, edges, columns };
}

/** The nodes an evidence line lights up, plus the edges between two lit nodes. */
export function litEdges(layout: PayoffLayout, lit: Set<string>): Set<string> {
  return new Set(layout.edges.filter((e) => lit.has(e.source) && lit.has(e.target)).map((e) => `${e.source}>${e.target}`));
}
