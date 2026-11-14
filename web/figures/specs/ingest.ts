// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../kit';

/** Tab 2's ingest pipeline (backend/src/ontology_rag/pipeline.asl.json, pipeline.py, kg.py). */
export const ingest: FigureSpec = {
  width: 1640,
  height: 540,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: 0, y: 150, title: 'Browser', sub: 'tab 2: photos and texts', steps: [5] },
    { kind: 'tile', id: 'api', icon: 'lambda', x: 340, y: 150, title: 'Lambda · API', sub: 'POST /api/pipeline/runs', steps: [1] },
    { kind: 'tile', id: 'data', icon: 's3', x: 340, y: 420, title: 'Amazon S3', sub: 'data bucket: uploads/, runs/' },
    {
      kind: 'group',
      id: 'sfn',
      x: 720,
      y: 30,
      w: 920,
      h: 250,
      title: 'AWS Step Functions',
      sub: 'one execution per run',
      icon: 'stepfunctions',
      color: '#e7157b',
      handles: [
        { id: 't-l1', side: 'l', at: (188 - 30) / 250, type: 'target' },
        { id: 's-b0', side: 'b', at: 0.04, type: 'source' },
      ],
    },
    { kind: 'zone', id: 'map', parent: 'sfn', x: 745, y: 85, w: 600, h: 165, title: 'Map: one iteration per source, 4 at a time', tone: 'map' },
    {
      kind: 'tile',
      id: 'classify',
      parent: 'map',
      icon: 'lambda',
      x: 770,
      y: 150,
      title: 'Classify',
      sub: 'one Converse call, then validate',
      steps: [2],
      handles: [{ id: 's-b3', side: 'b', at: 0.7, type: 'source' }],
    },
    { kind: 'tile', id: 'ingest', parent: 'map', icon: 'lambda', x: 1080, y: 150, title: 'Ingest', sub: 'answer to OWL to nodes and edges', steps: [3] },
    { kind: 'tile', id: 'summary', parent: 'sfn', icon: 'lambda', x: 1385, y: 150, title: 'Summarize', sub: 'what the batch added', steps: [4] },
    { kind: 'tile', id: 'bedrock', icon: 'bedrock', x: 830, y: 420, title: 'Amazon Bedrock', sub: 'vision model, Nova embeddings' },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: 1180, y: 420, title: 'Neptune Analytics', sub: 'Item, Look, Article, Statement' },
  ],
  edges: [
    { id: 'sources', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'sources' },
    { id: 'poll', from: 'browser', fromHandle: 's-t', to: 'api', toHandle: 't-t', kind: 'control', label: 'GET every 2 s', offset: 40 },
    { id: 'uploads', from: 'api', fromHandle: 's-b', to: 'data', toHandle: 't-t', kind: 'data', label: 'uploads, run.json' },
    { id: 'start', from: 'api', fromHandle: 's-r', to: 'sfn', toHandle: 't-l1', kind: 'control', label: 'StartExecution' },
    { id: 'next', from: 'classify', fromHandle: 's-r', to: 'ingest', toHandle: 't-l', kind: 'data', label: 'checked answer' },
    { id: 'last', from: 'ingest', fromHandle: 's-r', to: 'summary', toHandle: 't-l', kind: 'control', label: 'all done' },
    { id: 'converse', from: 'classify', fromHandle: 's-b3', to: 'bedrock', toHandle: 't-t1', kind: 'data', label: 'Converse' },
    { id: 'embed', from: 'ingest', fromHandle: 's-b1', to: 'bedrock', toHandle: 't-t2', kind: 'data', label: 'embeddings' },
    { id: 'merge', from: 'ingest', fromHandle: 's-b2', to: 'neptune', toHandle: 't-t1', kind: 'data', label: 'MERGE' },
    { id: 'records', from: 'sfn', fromHandle: 's-b0', to: 'data', toHandle: 't-r', kind: 'data', label: 'NN.json, summary.json', labelDx: -10, labelDy: -40 },
  ],
  legend: [
    { kind: 'data', text: 'data' },
    { kind: 'control', text: 'a call that starts work, or a poll' },
    { kind: 'step', text: 'a step of the walk-through' },
  ],
};
