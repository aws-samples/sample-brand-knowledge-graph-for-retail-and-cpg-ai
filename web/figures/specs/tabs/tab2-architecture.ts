// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 2, how the pipeline is built (backend/src/ontology_rag/pipeline.asl.json, pipeline.py,
 * kg.py; web/src/components/pipeline/PipelinePanel.tsx). The badges are the five steps of the
 * guide's walk-through: 1 the Step Functions Map, 2 classify, 3 ingest, 4 the MERGE into Neptune
 * Analytics, 5 summarize once per run.
 */
/** A large tile's height with a two-line subtitle (measured). */
const H = 83;
const SFN = { x: 700, y: 20, w: 940, h: 290 };
const R1 = 170;
const R2 = 450;

export const tab2Architecture: FigureSpec = {
  width: 1640,
  height: 590,
  large: true,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: 0, y: R1, title: 'Browser', sub: 'tab 2: photos, texts', muted: true },
    { kind: 'tile', id: 'api', icon: 'lambda', x: 300, y: R1, title: 'AWS Lambda', sub: 'the API: start, then poll', muted: true },
    { kind: 'tile', id: 'photos', icon: 's3', x: 440, y: R2, title: 'Amazon S3', sub: 'photos and run records', muted: true },

    {
      kind: 'group',
      id: 'sfn',
      x: SFN.x,
      y: SFN.y,
      w: SFN.w,
      h: SFN.h,
      title: 'AWS Step Functions',
      sub: 'one execution per run',
      icon: 'stepfunctions',
      color: '#e7157b',
      steps: [1],
      handles: [{ id: 't-l1', side: 'l', at: (R1 + H / 2 - SFN.y) / SFN.h, type: 'target' }],
    },
    { kind: 'zone', id: 'map', parent: 'sfn', x: 725, y: 90, w: 620, h: 195, title: 'Map: one iteration per source, four at a time', tone: 'map' },
    {
      kind: 'tile',
      id: 'classify',
      parent: 'map',
      icon: 'lambda',
      x: 750,
      y: R1,
      title: 'AWS Lambda',
      sub: 'classify: the five steps of tab 1',
      steps: [2],
      handles: [{ id: 't-b1', side: 'b', at: 0.25, type: 'target' }],
    },
    { kind: 'tile', id: 'ingest', parent: 'map', icon: 'lambda', x: 1060, y: R1, title: 'AWS Lambda', sub: 'ingest: nodes and edges', steps: [3] },
    { kind: 'tile', id: 'summarize', parent: 'sfn', icon: 'lambda', x: 1360, y: R1, title: 'AWS Lambda', sub: 'summarize, once per run', steps: [5] },

    { kind: 'tile', id: 'vision', icon: 'bedrock', x: 750, y: R2, title: 'Amazon Bedrock', sub: 'the vision model', muted: true },
    { kind: 'tile', id: 'embed', icon: 'bedrock', x: 1040, y: R2, title: 'Amazon Bedrock', sub: 'Nova Multimodal Embeddings', muted: true },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: 1360, y: R2, title: 'Neptune Analytics', sub: 'the graph, in a private VPC', steps: [4] },
  ],
  edges: [
    { id: 'sources', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'sources', labelDx: 10 },
    { id: 'poll', from: 'browser', fromHandle: 's-t', to: 'api', toHandle: 't-t', kind: 'control', label: 'polls every 2 s', offset: 40 },
    { id: 'uploads', from: 'api', fromHandle: 's-b', to: 'photos', toHandle: 't-t1', kind: 'data', label: 'uploads', labelDx: -45 },
    { id: 'start', from: 'api', fromHandle: 's-r', to: 'sfn', toHandle: 't-l1', kind: 'control', label: 'StartExecution' },
    { id: 'bytes', from: 'photos', fromHandle: 's-t', to: 'classify', toHandle: 't-b1', kind: 'data', label: 'photo bytes' },
    { id: 'converse', from: 'classify', fromHandle: 's-b2', to: 'vision', toHandle: 't-t', kind: 'data', label: 'Converse' },
    { id: 'next', from: 'classify', fromHandle: 's-r', to: 'ingest', toHandle: 't-l', kind: 'data', label: 'checked answer', labelDy: -60 },
    { id: 'embed', from: 'ingest', fromHandle: 's-b1', to: 'embed', toHandle: 't-t', kind: 'data', label: 'one vector per\nitem and source' },
    { id: 'merge', from: 'ingest', fromHandle: 's-b2', to: 'neptune', toHandle: 't-t1', kind: 'data', label: 'MERGE', labelDx: 40 },
    { id: 'last', from: 'ingest', fromHandle: 's-r', to: 'summarize', toHandle: 't-l', kind: 'control', label: 'all done', labelDy: -60 },
    { id: 'summary', from: 'summarize', fromHandle: 's-b2', to: 'neptune', toHandle: 't-t2', kind: 'data', label: 'node counts, after' },
  ],
  legend: [
    { kind: 'data', text: 'data' },
    { kind: 'control', text: 'a call that starts work, or a poll' },
    { kind: 'step', text: '1 to 5: the steps under the figure' },
  ],
};
