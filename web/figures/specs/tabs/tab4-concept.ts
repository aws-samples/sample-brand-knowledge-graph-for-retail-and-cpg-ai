// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 4, the concept: RAG and GraphRAG on the same question, one lane each. RAG answers from the
 * top-k matches of an embedding similarity search, pieces that look or sound alike. GraphRAG uses
 * the same similarity search only to find the starting garments, then walks the graph (the looks
 * they are in, the other garments worn there, the occasion) and answers from those looks, naming
 * each look as its source (backend/src/ontology_rag/payoff.py). The garments are examples.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const OCCASION = '#7b3fb0';
const STEP = '#69717b';
const RAG = '#0972d3';

const LANE = { x: 240, w: 1400 };
const RAG_LANE = { y: 0, h: 240 };
const GRAPH_LANE = { y: 390, h: 540 };
const WALK = { x: 505, y: 445, w: 850, h: 460 };
// The vertical middle of the RAG lane's row and of the walk, where the lanes' notes sit.
const RAG_MID = 137;
const GRAPH_MID = 693;

export const tab4Concept: FigureSpec = {
  width: 1640,
  height: 990,
  large: true,
  nodes: [
    { kind: 'note', id: 'question', x: 0, y: 275, w: 200, title: 'The question', text: 'What should I wear with white sneakers?', color: STEP },

    { kind: 'group', id: 'rag', x: LANE.x, y: RAG_LANE.y, w: LANE.w, h: RAG_LANE.h, title: 'RAG', sub: 'embedding similarity only', color: RAG },
    { kind: 'note', id: 'rag-sim', parent: 'rag', x: 265, y: RAG_MID - 42, w: 210, title: 'Embedding similarity', text: 'the nearest chunks or products by meaning', color: RAG },
    { kind: 'group', id: 'topk', parent: 'rag', x: 530, y: 55, w: 460, h: 165, title: 'The top-k matches', color: ITEM },
    { kind: 'entity', id: 'k1', parent: 'topk', x: 555, y: 105, label: 'white sneakers', color: ITEM },
    { kind: 'entity', id: 'k2', parent: 'topk', x: 775, y: 105, label: 'white trainers', color: ITEM },
    { kind: 'entity', id: 'k3', parent: 'topk', x: 555, y: 160, label: 'white canvas shoe', color: ITEM },
    { kind: 'entity', id: 'k4', parent: 'topk', x: 775, y: 160, label: 'white high-tops', color: ITEM },
    { kind: 'note', id: 'rag-answer', parent: 'rag', x: 1390, y: RAG_MID - 60, w: 230, title: 'Answer', text: 'The model writes from these pieces. It has what looks or sounds alike, and no relation between them.', color: RAG },

    {
      kind: 'note',
      id: 'choose',
      x: 265,
      y: 268,
      w: 1375,
      title: 'You choose the walk',
      text: 'From the matching nodes, you decide which relations to follow and how far: the garment, the looks it is in, what else is worn there, the occasion. That is the richer context.',
      color: LOOK,
    },

    { kind: 'group', id: 'graphrag', x: LANE.x, y: GRAPH_LANE.y, w: LANE.w, h: GRAPH_LANE.h, title: 'GraphRAG', sub: 'embedding similarity, then a walk through the graph', color: LOOK },
    { kind: 'note', id: 'graph-sim', parent: 'graphrag', x: 265, y: GRAPH_MID - 42, w: 210, title: 'Embedding similarity', text: 'the matching nodes, where the walk starts', color: LOOK },
    {
      kind: 'group',
      id: 'walk',
      parent: 'graphrag',
      x: WALK.x,
      y: WALK.y,
      w: WALK.w,
      h: WALK.h,
      title: 'The graph walk',
      color: LOOK,
      handles: [{ id: 's-r-mid', side: 'r', at: (GRAPH_MID - WALK.y) / WALK.h, type: 'source' }],
    },
    { kind: 'entity', id: 'start', parent: 'walk', x: 530, y: 659, label: 'white sneakers', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'look1', parent: 'walk', x: 800, y: 541, label: 'a casual look', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'occasion', parent: 'walk', x: 800, y: 659, label: 'Casual', props: 'Occasion', color: OCCASION },
    { kind: 'entity', id: 'look2', parent: 'walk', x: 800, y: 777, label: 'a weekend look', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'w1', parent: 'walk', x: 1130, y: 500, label: 'denim jacket', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w2', parent: 'walk', x: 1130, y: 582, label: 'tote bag', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w3', parent: 'walk', x: 1130, y: 736, label: 'wide-leg jeans', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'w4', parent: 'walk', x: 1130, y: 818, label: 'crossbody bag', props: 'Item', color: ITEM },
    { kind: 'note', id: 'graph-answer', parent: 'graphrag', x: 1390, y: GRAPH_MID - 60, w: 230, title: 'Answer with sources', text: 'The model writes from the looks. Each suggestion names the look it came from, so you can check it.', color: LOOK },
  ],
  edges: [
    { id: 'q-rag', from: 'question', fromHandle: 's-r', to: 'rag-sim', toHandle: 't-l', kind: 'data', centerX: 222 },
    { id: 'q-graph', from: 'question', fromHandle: 's-r', to: 'graph-sim', toHandle: 't-l', kind: 'data', centerX: 222 },
    { id: 'rag-topk', from: 'rag-sim', fromHandle: 's-r', to: 'topk', toHandle: 't-l', kind: 'data' },
    { id: 'rag-ans', from: 'topk', fromHandle: 's-r', to: 'rag-answer', toHandle: 't-l', kind: 'data' },
    { id: 'graph-start', from: 'graph-sim', fromHandle: 's-r', to: 'start', toHandle: 't-l', kind: 'data' },
    { id: 'in1', from: 'start', fromHandle: 's-r', to: 'look1', toHandle: 't-l', kind: 'data', label: 'IN' },
    { id: 'in2', from: 'start', fromHandle: 's-r', to: 'look2', toHandle: 't-l', kind: 'data', label: 'IN' },
    { id: 'for1', from: 'look1', fromHandle: 's-b', to: 'occasion', toHandle: 't-t', kind: 'data', label: 'FOR', color: OCCASION },
    { id: 'for2', from: 'look2', fromHandle: 's-t', to: 'occasion', toHandle: 't-b', kind: 'data', label: 'FOR', color: OCCASION },
    { id: 'c1', from: 'look1', fromHandle: 's-r', to: 'w1', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: 1018, labelDx: 56, labelDy: -35.5 },
    { id: 'c2', from: 'look1', fromHandle: 's-r', to: 'w2', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: 1018, labelDx: 56, labelDy: 5.5 },
    { id: 'c3', from: 'look2', fromHandle: 's-r', to: 'w3', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: 1018, labelDx: 56, labelDy: -35.5 },
    { id: 'c4', from: 'look2', fromHandle: 's-r', to: 'w4', toHandle: 't-l', kind: 'data', label: 'CONTAINS', color: LOOK, centerX: 1018, labelDx: 56, labelDy: 5.5 },
    { id: 'graph-ans', from: 'walk', fromHandle: 's-r-mid', to: 'graph-answer', toHandle: 't-l', kind: 'data' },
  ],
  legend: [{ kind: 'data', text: 'what goes from one step to the next, or a relation in the graph' }],
};
