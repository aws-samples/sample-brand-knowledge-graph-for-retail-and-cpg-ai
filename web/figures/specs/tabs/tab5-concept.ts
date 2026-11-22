// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 5, the concept: three answers to one question, and what each can show for itself
 * (backend/src/ontology_rag/payoff.py, run and tree). Who chose the evidence differs; the
 * question, the answer model and the catalog are the same. A photo takes GraphRAG's path through
 * the same vector space.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const STEP = '#69717b';
const RAG = '#0972d3';

const GW = 500;
const GH = 290;
const NW = GW - 60;
const G = [0, 550, 1100];
const CHAIN = { y: 450, h: 300 };

export const tab5Concept: FigureSpec = {
  width: 1600,
  height: 820,
  large: true,
  nodes: [
    { kind: 'group', id: 'llm', x: G[0], y: 0, w: GW, h: GH, title: 'LLM only', sub: 'the question alone', color: STEP },
    { kind: 'note', id: 'llm-who', parent: 'llm', x: G[0] + 30, y: 70, w: NW, title: 'Who chose', text: "the model's own taste", color: STEP },
    { kind: 'note', id: 'llm-show', parent: 'llm', x: G[0] + 30, y: 170, w: NW, title: 'What it can show', text: 'nothing: no source', color: STEP },

    { kind: 'group', id: 'rag', x: G[1], y: 0, w: GW, h: GH, title: 'RAG', sub: 'the catalog', color: RAG },
    { kind: 'note', id: 'rag-who', parent: 'rag', x: G[1] + 30, y: 70, w: NW, title: 'Who chose', text: "the model's own taste, on real products", color: RAG },
    { kind: 'note', id: 'rag-show', parent: 'rag', x: G[1] + 30, y: 170, w: NW, title: 'What it can show', text: 'products that exist; nothing says they go together', color: RAG },

    { kind: 'group', id: 'graphrag', x: G[2], y: 0, w: GW, h: GH, title: 'GraphRAG', sub: "the brand's looks, then the catalog", color: LOOK },
    { kind: 'note', id: 'graph-who', parent: 'graphrag', x: G[2] + 30, y: 70, w: NW, title: 'Who chose', text: "the brand's own looks", color: LOOK },
    { kind: 'note', id: 'graph-show', parent: 'graphrag', x: G[2] + 30, y: 170, w: NW, title: 'What it can show', text: 'the looks each suggestion comes from, with counts', color: LOOK },

    {
      kind: 'note',
      id: 'shared',
      x: 0,
      y: 350,
      w: 1600,
      title: 'The same question, the same answer model, the same catalog',
      text: 'Only the evidence differs: none, products the model searched for, or the looks the brand wears.',
      color: STEP,
      handles: [
        { id: 't-t-llm', side: 't', at: (G[0] + GW / 2) / 1600, type: 'target' },
        { id: 't-t-rag', side: 't', at: (G[1] + GW / 2) / 1600, type: 'target' },
        { id: 't-t-graph', side: 't', at: (G[2] + GW / 2) / 1600, type: 'target' },
      ],
    },

    { kind: 'group', id: 'photo', x: 0, y: CHAIN.y, w: 1600, h: CHAIN.h, title: 'A photo instead of a question', sub: "GraphRAG's path, from one picture", color: ITEM },
    { kind: 'note', id: 'p1', parent: 'photo', x: 30, y: CHAIN.y + 70, w: 300, title: 'A photo of one piece', text: 'the garment you want to wear', color: ITEM },
    { kind: 'note', id: 'p2', parent: 'photo', x: 436, y: CHAIN.y + 70, w: 300, title: 'Nova embeds the photo', text: 'text and images share one vector space', color: ITEM },
    { kind: 'note', id: 'p3', parent: 'photo', x: 842, y: CHAIN.y + 70, w: 300, title: 'The same vector search', text: 'finds the starting garments', color: ITEM },
    { kind: 'note', id: 'p4', parent: 'photo', x: 1248, y: CHAIN.y + 70, w: 322, title: 'The same walk', text: 'the same catalog search and prompt', color: ITEM },
    { kind: 'note', id: 'only', parent: 'photo', x: 30, y: CHAIN.y + 190, w: 1540, title: 'Only GraphRAG embeds the photo', text: "RAG's planner looks at the photo and plans its catalog searches from what it sees. LLM only describes it.", color: ITEM },
  ],
  edges: [
    { id: 'e-llm', from: 'llm', fromHandle: 's-b', to: 'shared', toHandle: 't-t-llm', kind: 'data', label: 'no evidence' },
    { id: 'e-rag', from: 'rag', fromHandle: 's-b', to: 'shared', toHandle: 't-t-rag', kind: 'data', label: 'numbered products' },
    { id: 'e-graph', from: 'graphrag', fromHandle: 's-b', to: 'shared', toHandle: 't-t-graph', kind: 'data', label: 'looks, counts, products' },
    { id: 'c1', from: 'p1', fromHandle: 's-r', to: 'p2', toHandle: 't-l', kind: 'data' },
    { id: 'c2', from: 'p2', fromHandle: 's-r', to: 'p3', toHandle: 't-l', kind: 'data', label: 'one vector', labelDy: -26 },
    { id: 'c3', from: 'p3', fromHandle: 's-r', to: 'p4', toHandle: 't-l', kind: 'data' },
  ],
  legend: [{ kind: 'data', text: 'what goes to the answer prompt, or from one step to the next' }],
};
