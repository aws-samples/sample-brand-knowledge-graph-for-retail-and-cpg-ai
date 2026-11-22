// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 4, how the retriever's stages are built (backend/src/ontology_rag/payoff.py,
 * web/src/components/retriever/RetrieverArchitecture.tsx). The badges are the six stages of the
 * guide's walk-through: 1 the catalog at deploy, 2 search the catalog, 3 RAG, 4 the starting
 * garments, 5 the walk, 6 the answer. A tile that several stages use carries each of their numbers.
 * Every catalog search runs through the API, so the searches of RAG and of the walk's looks share
 * the API's QueryVectors edge.
 */
const C0 = 0;
const C1 = 440;
const C2 = 840;
const C3 = 1280;
const R0 = 0;
const R1 = 230;
const R2 = 460;
const R3 = 690;
/** The gap between the second and the third column, where the walk's edge turns. */
const GAP = (C2 + 270 + C3) / 2;

export const tab4Architecture: FigureSpec = {
  width: 1630,
  height: 840,
  large: true,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: C0, y: R1, title: 'Browser', sub: 'tab 4: the six stages', muted: true },
    {
      kind: 'tile',
      id: 'api',
      icon: 'lambda',
      x: C1,
      y: R1,
      title: 'AWS Lambda',
      sub: 'the API: search, RAG, the walk',
      steps: [2, 5],
      handles: [{ id: 's-r2', side: 'r', at: 0.8, type: 'source' }],
    },
    { kind: 'tile', id: 'answer', icon: 'bedrock', x: C2, y: R0, title: 'Amazon Bedrock', sub: 'the answer model, Converse', steps: [3, 6] },
    { kind: 'tile', id: 'embed', icon: 'bedrock', x: C2, y: R2, title: 'Amazon Bedrock', sub: 'Nova Multimodal Embeddings', steps: [1, 4] },
    { kind: 'tile', id: 'loader', icon: 'lambda', x: C2 + 17, y: R3, title: 'GraphLoader', sub: 'fills the catalog at deploy', muted: true, steps: [1] },
    { kind: 'tile', id: 'vectors', icon: 's3vectors', x: C3, y: R1, title: 'Amazon S3 Vectors', sub: 'index catalog: every product', steps: [2, 3] },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: C3, y: R2, title: 'Neptune Analytics', sub: 'the brand\'s looks, with a vector index', steps: [4, 5] },
  ],
  edges: [
    { id: 'request', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'a search, a question,\nyour openCypher' },
    { id: 'converse', from: 'api', fromHandle: 's-t', to: 'answer', toHandle: 't-l', kind: 'data', label: 'Converse: plan RAG\'s searches\n(3), write the answer (3, 6)', labelDx: -20, labelDy: -10 },
    { id: 'embed', from: 'api', fromHandle: 's-b', to: 'embed', toHandle: 't-l', kind: 'data', label: 'embed the search (2)\nor the question (4)', labelDx: -20, labelDy: 10 },
    { id: 'query', from: 'api', fromHandle: 's-r', to: 'vectors', toHandle: 't-l', kind: 'data', label: 'QueryVectors: your search (2), RAG\'s searches (3),\nthe looks\' pieces (5)', labelDy: -36 },
    { id: 'walk', from: 'api', fromHandle: 's-r2', to: 'neptune', toHandle: 't-l', kind: 'data', label: 'the walk (5):\nread-only openCypher,\nrows back', centerX: GAP, labelDy: 0 },
    { id: 'starts', from: 'embed', fromHandle: 's-b2', to: 'neptune', toHandle: 't-b', kind: 'data', label: 'vector search on the graph\'s garments (4)', offset: 40, labelDx: 60 },
    { id: 'texts', from: 'loader', fromHandle: 's-t', to: 'embed', toHandle: 't-b', kind: 'deploy', label: 'every product\'s text', labelDx: -120 },
    { id: 'put', from: 'loader', fromHandle: 's-r', to: 'vectors', toHandle: 't-r', kind: 'deploy', label: 'PutVectors (1)', offset: 40, labelDx: 70 },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'deploy', text: 'at deploy time' },
    { kind: 'step', text: '1 to 6: the stages under the figure' },
  ],
};
