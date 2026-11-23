// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 5, the concept: a photo as the question, GraphRAG's path from left to right
 * (backend/src/ontology_rag/payoff.py, photo_guidance and photo_graphrag). Amazon Nova Multimodal
 * Embeddings turns the photo into one vector in the same space as the garments' text, the same
 * vector search finds the starting garments, the same walk reaches the looks that contain them and
 * what else is worn there, and the model answers from those looks. Only the input differs from a
 * typed question. The garments are examples.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const STEP = '#69717b';

// The step notes along the top, and the row under them where each step's result sits.
const N = [
  { x: 0, w: 220 },
  { x: 265, w: 250 },
  { x: 560, w: 250 },
  { x: 855, w: 560 },
  { x: 1460, w: 220 },
];
const ROW = 150;
// The step notes differ in height; the arrows between them run at one height (LINE px from the top).
const LINE = 40;
const along = (h: number) => [
  { id: 'in', side: 'l' as const, at: LINE / h, type: 'target' as const },
  { id: 'out', side: 'r' as const, at: LINE / h, type: 'source' as const },
];

export const tab5Concept: FigureSpec = {
  width: 1680,
  height: 610,
  large: true,
  nodes: [
    { kind: 'note', id: 'n1', x: N[0].x, y: 0, w: N[0].w, title: '1. A photo of one piece', text: "The shopper's own, or an example.", color: STEP, handles: along(84) },
    { kind: 'note', id: 'n2', x: N[1].x, y: 0, w: N[1].w, title: '2. Embed the photo', text: "Amazon Nova Multimodal Embeddings puts it in the same vector space as the garments' text.", color: STEP, handles: along(120) },
    { kind: 'note', id: 'n3', x: N[2].x, y: 0, w: N[2].w, title: '3. Find the nearest nodes', text: "Embedding similarity on the graph's garments finds the starting garments.", color: STEP, handles: along(102) },
    { kind: 'note', id: 'n4', x: N[3].x, y: 0, w: N[3].w, title: '4. Walk the graph', text: 'The looks that contain them, and the other garments worn there.', color: LOOK, handles: along(66) },
    { kind: 'note', id: 'n5', x: N[4].x, y: 0, w: N[4].w, title: '5. The outfit with its sources', text: 'The model writes the answer from those looks. Each suggestion names its look.', color: LOOK, handles: along(125) },

    { kind: 'group', id: 'r2', x: N[1].x, y: ROW, w: N[1].w, h: 110, title: 'The photo as a vector', color: ITEM },
    { kind: 'entity', id: 'vec', parent: 'r2', x: N[1].x + 25, y: ROW + 50, label: 'the photo', color: ITEM, vec: true },

    { kind: 'group', id: 'r3', x: N[2].x, y: ROW, w: N[2].w, h: 220, title: 'The starting garments', color: ITEM },
    { kind: 'entity', id: 's1', parent: 'r3', x: N[2].x + 25, y: ROW + 50, label: 'white sneakers', props: 'Item', color: ITEM },
    { kind: 'entity', id: 's2', parent: 'r3', x: N[2].x + 25, y: ROW + 132, label: 'white trainers', props: 'Item', color: ITEM },

    { kind: 'group', id: 'r4', x: N[3].x, y: ROW, w: N[3].w, h: 400, title: 'The looks and what they wear', color: LOOK },
    { kind: 'entity', id: 'look1', parent: 'r4', x: N[3].x + 20, y: ROW + 91, label: 'a casual look', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'look2', parent: 'r4', x: N[3].x + 20, y: ROW + 271, label: 'a weekend look', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'w1', parent: 'r4', x: N[3].x + 345, y: ROW + 50, label: 'denim jacket', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w2', parent: 'r4', x: N[3].x + 345, y: ROW + 132, label: 'tote bag', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w3', parent: 'r4', x: N[3].x + 345, y: ROW + 230, label: 'wide-leg jeans', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w4', parent: 'r4', x: N[3].x + 345, y: ROW + 312, label: 'crossbody bag', props: 'Item', color: ITEM },

    { kind: 'note', id: 'typed', x: N[4].x, y: ROW, w: N[4].w, title: 'A typed question', text: 'The same flow answers it. Only the input changes.', color: STEP },
  ],
  edges: [
    { id: 'c12', from: 'n1', fromHandle: 'out', to: 'n2', toHandle: 'in', kind: 'data' },
    { id: 'c23', from: 'n2', fromHandle: 'out', to: 'n3', toHandle: 'in', kind: 'data' },
    { id: 'c34', from: 'n3', fromHandle: 'out', to: 'n4', toHandle: 'in', kind: 'data' },
    { id: 'c45', from: 'n4', fromHandle: 'out', to: 'n5', toHandle: 'in', kind: 'data' },
    { id: 'r2', from: 'n2', fromHandle: 's-b', to: 'r2', toHandle: 't-t', kind: 'data' },
    { id: 'r3', from: 'n3', fromHandle: 's-b', to: 'r3', toHandle: 't-t', kind: 'data' },
    { id: 'r4', from: 'n4', fromHandle: 's-b', to: 'r4', toHandle: 't-t', kind: 'data' },
    { id: 'k1', from: 'look1', fromHandle: 's-r', to: 'w1', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: N[3].x + 238, labelDx: 53, labelDy: -35.5 },
    { id: 'k2', from: 'look1', fromHandle: 's-r', to: 'w2', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: N[3].x + 238, labelDx: 53, labelDy: 5.5 },
    { id: 'k3', from: 'look2', fromHandle: 's-r', to: 'w3', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: N[3].x + 238, labelDx: 53, labelDy: -35.5 },
    { id: 'k4', from: 'look2', fromHandle: 's-r', to: 'w4', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: N[3].x + 238, labelDx: 53, labelDy: 5.5 },
  ],
  legend: [{ kind: 'data', text: 'from one step to the next, or a relation in the graph' }],
};
