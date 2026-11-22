// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 4, the concept: the walk as a logical diagram (backend/src/ontology_rag/payoff.py). A vector
 * search finds the starting garments; the walk follows CONTAINS backwards to every look that wears
 * one, FOR to each look's occasion, and CONTAINS forwards to everything worn in those looks. The
 * counts per kind are an example, not a measurement. RAG skips the walk.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const OCCASION = '#7b3fb0';
const STEP = '#69717b';
const RAG = '#0972d3';

const GY = 0;
const GH = 640;
const AX = 320;
const BX = 660;
const CX = 1300;

export const tab4Concept: FigureSpec = {
  width: 1620,
  height: 810,
  large: true,
  nodes: [
    { kind: 'note', id: 'question', x: 0, y: 272, w: 250, title: 'The question', text: 'What should I wear with white sneakers?', color: STEP },
    { kind: 'note', id: 'rag', x: 0, y: 460, w: 250, title: 'RAG skips the walk', text: 'The model plans the catalog searches from its own taste. The looks are never read.', color: RAG },

    { kind: 'group', id: 'starts', x: AX, y: GY, w: 280, h: GH, title: 'Starting garments', color: ITEM },
    { kind: 'entity', id: 's1', parent: 'starts', x: AX + 40, y: 110, label: 'Item', props: 'white sneaker (right)', color: ITEM },
    { kind: 'entity', id: 's2', parent: 'starts', x: AX + 40, y: 240, label: 'Item', props: 'white sneaker (left)', color: ITEM },
    { kind: 'entity', id: 's3', parent: 'starts', x: AX + 40, y: 370, label: 'Item', props: 'white shoe', color: ITEM },

    { kind: 'group', id: 'looks', x: BX, y: GY, w: 580, h: GH, title: 'The looks that wear them', sub: 'and the occasion of each', color: LOOK },
    { kind: 'entity', id: 'l1', parent: 'looks', x: BX + 40, y: 100, label: 'Look', props: 'Casual look A', color: LOOK },
    { kind: 'entity', id: 'l2', parent: 'looks', x: BX + 40, y: 250, label: 'Look', props: 'Casual look B', color: LOOK },
    { kind: 'entity', id: 'l3', parent: 'looks', x: BX + 40, y: 400, label: 'Look', props: 'Smart casual look', color: LOOK },
    { kind: 'entity', id: 'l4', parent: 'looks', x: BX + 40, y: 550, label: 'Look', props: 'Business casual look', color: LOOK },
    { kind: 'entity', id: 'o1', parent: 'looks', x: BX + 340, y: 175, label: 'Occasion', props: 'casual', color: OCCASION, handles: [{ id: 't-l1', side: 'l', at: 0.3, type: 'target' }, { id: 't-l2', side: 'l', at: 0.7, type: 'target' }] },
    { kind: 'entity', id: 'o2', parent: 'looks', x: BX + 340, y: 400, label: 'Occasion', props: 'smart casual', color: OCCASION },
    { kind: 'entity', id: 'o3', parent: 'looks', x: BX + 340, y: 550, label: 'Occasion', props: 'business casual', color: OCCASION },

    { kind: 'group', id: 'worn', x: CX, y: GY, w: 320, h: GH, title: 'Worn in those looks, by kind', color: ITEM },
    { kind: 'entity', id: 'w1', parent: 'worn', x: CX + 60, y: 100, label: 'Item', props: 'bag: 3 of 4 looks', color: ITEM },
    { kind: 'entity', id: 'w2', parent: 'worn', x: CX + 60, y: 250, label: 'Item', props: 'earring: 3 of 4 looks', color: ITEM },
    { kind: 'entity', id: 'w3', parent: 'worn', x: CX + 60, y: 400, label: 'Item', props: 'pants: 2 of 4 looks', color: ITEM },
    { kind: 'entity', id: 'w4', parent: 'worn', x: CX + 60, y: 550, label: 'Item', props: 'jacket: 2 of 4 looks', color: ITEM },

    { kind: 'note', id: 'kept', parent: 'starts', x: AX + 20, y: 510, w: 240, title: 'Kept if a look wears them', text: 'a garment no look wears cannot start a walk', color: ITEM },
    { kind: 'note', id: 'three', x: BX, y: 700, w: 580, title: 'Three typical looks', text: 'one per occasion first; their pieces go to the catalog search and the answer prompt', color: LOOK },
    { kind: 'note', id: 'example', x: CX, y: 700, w: 320, title: 'The counts are an example', text: 'your graph gives its own numbers', color: STEP },
  ],
  edges: [
    { id: 'q', from: 'question', fromHandle: 's-r', to: 'starts', toHandle: 't-l', kind: 'data', label: 'vector search' },
    { id: 'contains-back', from: 'starts', fromHandle: 's-r', to: 'looks', toHandle: 't-l', kind: 'data', label: 'CONTAINS,\nfollowed backwards' },
    { id: 'contains', from: 'looks', fromHandle: 's-r', to: 'worn', toHandle: 't-l', kind: 'data', label: 'CONTAINS' },
    { id: 'for1', from: 'l1', fromHandle: 's-r', to: 'o1', toHandle: 't-l1', kind: 'data', label: 'FOR', color: OCCASION, labelDx: -30 },
    { id: 'for2', from: 'l2', fromHandle: 's-r', to: 'o1', toHandle: 't-l2', kind: 'data', label: 'FOR', color: OCCASION, labelDx: -30 },
    { id: 'for3', from: 'l3', fromHandle: 's-r', to: 'o2', toHandle: 't-l', kind: 'data', label: 'FOR', color: OCCASION },
    { id: 'for4', from: 'l4', fromHandle: 's-r', to: 'o3', toHandle: 't-l', kind: 'data', label: 'FOR', color: OCCASION },
    { id: 'pick', from: 'looks', fromHandle: 's-b', to: 'three', toHandle: 't-t', kind: 'data', label: 'rows counted per look' },
    { id: 'ragskip', from: 'rag', fromHandle: 's-b', to: 'three', toHandle: 't-l', kind: 'control', label: "RAG: the model's own searches", labelDx: 0, labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'what the walk follows' },
    { kind: 'control', text: 'the path RAG takes instead' },
  ],
};
