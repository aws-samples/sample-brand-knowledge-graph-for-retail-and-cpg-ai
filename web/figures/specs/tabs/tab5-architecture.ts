// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 5, how the three answers are built (backend/src/ontology_rag/payoff.py, run and tree;
 * web/src/components/retriever/RetrieverArchitecture.tsx, rt_payoff). The badges are the five
 * steps of the guide's walk-through: 1 three in parallel, 2 LLM only, 3 RAG, 4 GraphRAG, 5 the
 * sources drawn in the browser. A photo instead of a question takes the dashed path: the API has
 * Nova embed it, and that vector is GraphRAG's starting point.
 */
const C0 = 0;
const C1 = 490;
const C2 = 890;
const C3 = 1330;
const R0 = 0;
const R1 = 230;
const R2 = 460;

export const tab5Architecture: FigureSpec = {
  width: 1600,
  height: 620,
  large: true,
  nodes: [
    {
      kind: 'tile',
      id: 'browser',
      icon: 'browser',
      x: C0,
      y: R1,
      title: 'Browser',
      sub: 'tab 5: three answers, the sources tree',
      steps: [5],
      handles: [{ id: 't-r2', side: 'r', at: 0.8, type: 'target' }],
    },
    {
      kind: 'tile',
      id: 'api',
      icon: 'lambda',
      x: C1,
      y: R1,
      title: 'AWS Lambda',
      sub: 'the API: one request, three columns at once',
      steps: [1],
      handles: [{ id: 's-l2', side: 'l', at: 0.8, type: 'source' }],
    },
    { kind: 'tile', id: 'vectors', icon: 's3vectors', x: C2, y: R0, title: 'Amazon S3 Vectors', sub: 'RAG: your searches through the catalog', steps: [3] },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: C2, y: R2, title: 'Neptune Analytics', sub: 'GraphRAG: the starting garments, the walk', steps: [4] },
    { kind: 'tile', id: 'answer', icon: 'bedrock', x: C3, y: R1, title: 'Amazon Bedrock', sub: 'the answer model, one prompt for all', steps: [2] },
    { kind: 'tile', id: 'nova', icon: 'bedrock', x: C0 + 17, y: R2, title: 'Amazon Bedrock', sub: 'Nova embeds the photo', muted: true },
  ],
  edges: [
    { id: 'request', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'a question, or a photo' },
    { id: 'result', from: 'api', fromHandle: 's-l2', to: 'browser', toHandle: 't-r2', kind: 'data', label: 'three answers, GraphRAG\'s path', labelDy: 24 },
    { id: 'llm', from: 'api', fromHandle: 's-r', to: 'answer', toHandle: 't-l', kind: 'data', label: 'LLM only: the question alone' },
    { id: 'rag', from: 'api', fromHandle: 's-t', to: 'vectors', toHandle: 't-l', kind: 'data', label: 'RAG: the catalog', labelDx: -20, labelDy: -10 },
    { id: 'graph', from: 'api', fromHandle: 's-b', to: 'neptune', toHandle: 't-l', kind: 'data', label: 'GraphRAG: the looks, then\nthe same catalog search', labelDx: -20, labelDy: 10 },
    { id: 'products', from: 'vectors', fromHandle: 's-r', to: 'answer', toHandle: 't-t', kind: 'data', label: 'numbered products', labelDx: 40, labelDy: -26 },
    { id: 'looks', from: 'neptune', fromHandle: 's-r', to: 'answer', toHandle: 't-b', kind: 'data', label: 'the looks, counts,\ntheir pieces\' products', labelDx: 50, labelDy: 44 },
    { id: 'photo', from: 'api', fromHandle: 's-b1', to: 'nova', toHandle: 't-t', kind: 'control', label: 'Style recommendation: the photo\'s\nembedding is GraphRAG\'s starting point', centerY: R2 - 60, labelDx: 20, labelDy: 46 },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'control', text: 'a photo instead of a question' },
    { kind: 'step', text: '1 to 5: the steps under the figure' },
  ],
};
