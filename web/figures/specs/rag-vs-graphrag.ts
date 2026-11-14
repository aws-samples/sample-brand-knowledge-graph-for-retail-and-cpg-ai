// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../kit';

/** Tabs 4 and 5: RAG and GraphRAG share the catalog, the search and the answer prompt (backend/src/ontology_rag/payoff.py). */
export const ragVsGraphrag: FigureSpec = {
  width: 1600,
  height: 560,
  nodes: [
    { kind: 'tile', id: 'question', icon: 'browser', x: 0, y: 200, title: 'Question', sub: 'or a photo of one piece', steps: [1] },
    { kind: 'group', id: 'rag', x: 310, y: 20, w: 300, h: 160, title: 'RAG', sub: "the model's own taste", color: '#0972d3' },
    { kind: 'tile', id: 'planner', parent: 'rag', icon: 'bedrock', x: 345, y: 85, title: 'Amazon Bedrock', sub: 'plans 3 to 6 searches', steps: [2] },
    { kind: 'group', id: 'graphrag', x: 310, y: 320, w: 640, h: 170, title: 'GraphRAG', sub: "the brand's looks", color: '#ff9900' },
    { kind: 'tile', id: 'embed', parent: 'graphrag', icon: 'bedrock', x: 345, y: 385, title: 'Amazon Bedrock', sub: 'Nova embeds the question', steps: [4] },
    { kind: 'tile', id: 'neptune', parent: 'graphrag', icon: 'neptune', x: 690, y: 385, title: 'Neptune Analytics', sub: 'way in, then a read-only walk', steps: [5] },
    { kind: 'tile', id: 'catalog', icon: 's3vectors', x: 1030, y: 200, title: 'Amazon S3 Vectors', sub: 'catalog: the same search', steps: [3] },
    {
      kind: 'tile',
      id: 'answer',
      icon: 'bedrock',
      x: 1370,
      y: 200,
      title: 'Amazon Bedrock',
      sub: 'one answer prompt, cites evidence',
      steps: [6],
      handles: [{ id: 't-b2', side: 'b', at: 0.5, type: 'target' }],
    },
  ],
  edges: [
    { id: 'q-rag', from: 'question', fromHandle: 's-t', to: 'planner', toHandle: 't-l', kind: 'data', label: 'the question' },
    { id: 'q-graph', from: 'question', fromHandle: 's-b', to: 'embed', toHandle: 't-l', kind: 'data', label: 'the question' },
    { id: 'searches', from: 'planner', fromHandle: 's-r', to: 'catalog', toHandle: 't-t', kind: 'data', label: 'its searches: 3 products each' },
    { id: 'vector', from: 'embed', fromHandle: 's-r', to: 'neptune', toHandle: 't-l', kind: 'data', label: 'vector' },
    { id: 'pieces', from: 'neptune', fromHandle: 's-r', to: 'catalog', toHandle: 't-b', kind: 'data', label: "three looks' pieces: 1 product each", labelDx: 30 },
    { id: 'products', from: 'catalog', fromHandle: 's-r', to: 'answer', toHandle: 't-l', kind: 'data', label: 'products' },
    { id: 'patterns', from: 'neptune', fromHandle: 's-b', to: 'answer', toHandle: 't-b2', kind: 'data', label: 'the looks, occasions, what is worn together', offset: 42 },
  ],
  legend: [
    { kind: 'data', text: 'data' },
    { kind: 'step', text: 'RAG: 1, 2, 3, 6. GraphRAG: 1, 4, 5, 3, 6' },
  ],
};
