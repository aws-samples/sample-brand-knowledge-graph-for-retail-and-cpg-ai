// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { PayoffTree } from '../../api';
import { COLUMN_ORDER, litEdges, payoffTreeLayout } from './payoffTreeLayout';

const tree: PayoffTree = {
  nodes: [
    { id: 'anchor', kind: 'anchor', label: 'white sneaker' },
    { id: 'lk1', kind: 'look', label: 'Professional', node_id: 'lk1' },
    { id: 'lk2', kind: 'look', label: 'Dress', node_id: 'lk2' },
    { id: 'cat:pants', kind: 'category', label: 'pants', count: 2 },
    { id: 'cat:bag', kind: 'category', label: 'bag', count: 1 },
    { id: 'item:b', kind: 'item', label: 'Tan suede clutch' },
    { id: 'item:p', kind: 'item', label: 'Cream wide-leg trousers' },
  ],
  edges: [
    { source: 'anchor', target: 'lk1' },
    { source: 'anchor', target: 'lk2' },
    { source: 'lk1', target: 'cat:pants' },
    { source: 'lk2', target: 'cat:pants' },
    { source: 'lk1', target: 'cat:bag' },
    { source: 'cat:bag', target: 'item:b' },
    { source: 'cat:pants', target: 'item:p' },
  ],
};

describe('payoffTreeLayout', () => {
  const layout = payoffTreeLayout(tree);

  it('places the four kinds in four columns, left to right', () => {
    const colX = COLUMN_ORDER.map((k) => layout.nodes.find((n) => n.kind === k)!.x);
    expect([...colX].sort((a, b) => a - b)).toEqual(colX);
    expect(new Set(colX).size).toBe(4);
  });

  it('stacks a column without overlap and keeps everything inside the drawing', () => {
    for (const k of COLUMN_ORDER) {
      const col = layout.nodes.filter((n) => n.kind === k).sort((a, b) => a.y - b.y);
      col.slice(1).forEach((n, i) => expect(n.y).toBeGreaterThanOrEqual(col[i].y + col[i].h));
    }
    for (const n of layout.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it('orders the items by their category', () => {
    const items = layout.nodes.filter((n) => n.kind === 'item').sort((a, b) => a.y - b.y);
    expect(items.map((n) => n.id)).toEqual(['item:p', 'item:b']); // pants come before bag
  });

  it('draws every edge between placed nodes and lights only edges between lit nodes', () => {
    expect(layout.edges).toHaveLength(tree.edges.length);
    const lit = litEdges(layout, new Set(['anchor', 'lk1', 'cat:pants']));
    expect([...lit].sort()).toEqual(['anchor>lk1', 'lk1>cat:pants']);
  });
});
