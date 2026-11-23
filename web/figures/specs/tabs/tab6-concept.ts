// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 6, the first concept: clusters of embeddings show a trend, the graph data explains it
 * (method 3 of the trends question: backend/src/ontology_rag/lenses.py, web/src/components/lenses/).
 * Every garment the looks wear has a vector; similar vectors form clusters; a cluster with a larger
 * share of the new shoot than of the lookbook is emerging (the lift). A walk in the graph from the
 * cluster's garments shows what they share: a detail, a kind, the looks that wear them and their
 * occasion. The garments are examples.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';

const LEFT = { x: 0, y: 0, w: 480, h: 685 };
const CX = 600;
const CW = 250;
// The three clusters, top to bottom; A is the one that is mostly new.
const CY = [0, 235, 470];
const CH = 215;
const RIGHT = { x: 1010, y: 0, w: 670, h: 450 };
const SUB = { x: 1035, y: 55, w: 250, h: 260 };
const SX = 1455;
// The vertical middles of the shared nodes the cluster's garments link to.
const ATTR_MID = 104;
const CAT_MID = 186;
const LOOK_MID = 268;

const mid = (i: number) => CY[i] + CH / 2;
const cluster = (i: number, title: string, sub: string, color: string, labels: string[]) => [
  { kind: 'group' as const, id: `cl${i}`, x: CX, y: CY[i], w: CW, h: CH, title, sub, color },
  ...labels.map((label, j) => ({ kind: 'entity' as const, id: `cl${i}-${j}`, parent: `cl${i}`, x: CX + 25, y: CY[i] + 50 + j * 52, label, color: ITEM, vec: true })),
];

export const tab6Concept: FigureSpec = {
  width: 1680,
  height: 750,
  large: true,
  nodes: [
    {
      kind: 'group',
      id: 'all',
      x: LEFT.x,
      y: LEFT.y,
      w: LEFT.w,
      h: LEFT.h,
      title: 'Embeddings of every garment the looks wear',
      color: ITEM,
      handles: CY.map((_, i) => ({ id: `s-r${i}`, side: 'r' as const, at: mid(i) / LEFT.h, type: 'source' as const })),
    },
    ...[
      [30, 60, 'wide jeans'],
      [255, 105, 'sneaker'],
      [60, 160, 'blazer'],
      [265, 215, 'loafer'],
      [25, 270, 'wide pants'],
      [245, 330, 'trench'],
      [70, 390, 'culottes'],
      [255, 450, 'mule'],
      [40, 510, 'parka'],
    ].map(([x, y, label], j) => ({ kind: 'entity' as const, id: `v${j}`, parent: 'all', x: x as number, y: (y as number) + 40, label: label as string, color: ITEM, vec: true })),

    ...cluster(0, 'Cluster A', 'mostly new', LOOK, ['wide jeans', 'wide pants', 'culottes']),
    ...cluster(1, 'Cluster B', '', ITEM, ['sneaker', 'loafer', 'mule']),
    ...cluster(2, 'Cluster C', '', ITEM, ['blazer', 'trench', 'parka']),

    { kind: 'group', id: 'why', x: RIGHT.x, y: RIGHT.y, w: RIGHT.w, h: RIGHT.h, title: 'The graph data that explains the cluster', color: LOOK },
    {
      kind: 'group',
      id: 'garments',
      parent: 'why',
      x: SUB.x,
      y: SUB.y,
      w: SUB.w,
      h: SUB.h,
      title: "Cluster A's garments",
      color: ITEM,
      handles: [
        { id: 't-l-a', side: 'l', at: (mid(0) - SUB.y) / SUB.h, type: 'target' },
        { id: 's-attr', side: 'r', at: (ATTR_MID - SUB.y) / SUB.h, type: 'source' },
        { id: 's-cat', side: 'r', at: (CAT_MID - SUB.y) / SUB.h, type: 'source' },
        { id: 's-look', side: 'r', at: (LOOK_MID - SUB.y) / SUB.h, type: 'source' },
      ],
    },
    { kind: 'entity', id: 'g0', parent: 'garments', x: SUB.x + 25, y: SUB.y + 55, label: 'wide jeans', color: ITEM },
    { kind: 'entity', id: 'g1', parent: 'garments', x: SUB.x + 25, y: SUB.y + 115, label: 'wide pants', color: ITEM },
    { kind: 'entity', id: 'g2', parent: 'garments', x: SUB.x + 25, y: SUB.y + 175, label: 'culottes', color: ITEM },
    { kind: 'entity', id: 'attr', parent: 'why', x: SX, y: ATTR_MID - 34, label: 'wide leg', props: 'Attribute (silhouette)', color: ATTRIBUTE },
    { kind: 'entity', id: 'cat', parent: 'why', x: SX, y: CAT_MID - 34, label: 'pants', props: 'Category', color: CATEGORY },
    { kind: 'entity', id: 'look', parent: 'why', x: SX, y: LOOK_MID - 34, label: 'their looks', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'occ', parent: 'why', x: SX, y: LOOK_MID + 84, label: 'Casual', props: 'Occasion', color: OCCASION },

    {
      kind: 'note',
      id: 'lift',
      x: RIGHT.x,
      y: 490,
      w: RIGHT.w,
      title: 'A cluster that is mostly new is an emerging trend',
      text: "The lift is the cluster's share of the new shoot divided by its share of the lookbook.",
      color: LOOK,
    },
  ],
  edges: [
    { id: 'to-a', from: 'all', fromHandle: 's-r0', to: 'cl0', toHandle: 't-l', kind: 'data' },
    { id: 'to-b', from: 'all', fromHandle: 's-r1', to: 'cl1', toHandle: 't-l', kind: 'data', label: 'group by\nsimilarity', labelDy: -30 },
    { id: 'to-c', from: 'all', fromHandle: 's-r2', to: 'cl2', toHandle: 't-l', kind: 'data' },
    { id: 'walk', from: 'cl0', fromHandle: 's-r', to: 'garments', toHandle: 't-l-a', kind: 'data', label: 'walk the graph\nfrom its garments', labelDy: -30 },
    { id: 'has', from: 'garments', fromHandle: 's-attr', to: 'attr', toHandle: 't-l', kind: 'data', label: 'HAS_ATTRIBUTE', color: ATTRIBUTE },
    { id: 'iscat', from: 'garments', fromHandle: 's-cat', to: 'cat', toHandle: 't-l', kind: 'data', label: 'IS_CATEGORY', color: CATEGORY },
    { id: 'in', from: 'garments', fromHandle: 's-look', to: 'look', toHandle: 't-l', kind: 'data', label: 'IN', color: LOOK },
    { id: 'for', from: 'look', fromHandle: 's-b', to: 'occ', toHandle: 't-t', kind: 'data', label: 'FOR', color: OCCASION },
  ],
  legend: [{ kind: 'data', text: 'from one step to the next, or a relation in the graph' }],
};
