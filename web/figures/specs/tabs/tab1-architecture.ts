// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 1, how one classify call is built (web/src/components/studio/ArchitecturePanel.tsx,
 * backend/src/ontology_rag/vision.py). The badges are the five steps of the guide's walk-through:
 * 1 the ontology from S3, 2 the photo from S3, 3 the prompt, 4 the Bedrock call, 5 the check.
 */
const C0 = 0;
const C1 = 700;
const C2 = 1200;
const R0 = 40;
const R1 = 260;
const R2 = 480;

export const tab1Architecture: FigureSpec = {
  width: 1500,
  height: 650,
  large: true,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: C0, y: R1, title: 'Browser', sub: 'the React app, tab 1', muted: true },

    { kind: 'group', id: 'cloud', x: 300, y: 0, w: 1200, h: 600, title: 'AWS Cloud', icon: 'cloud', color: '#232f3e', dashed: false },
    { kind: 'tile', id: 'cognito', parent: 'cloud', icon: 'cognito', x: 360, y: R0, title: 'Amazon Cognito', sub: 'sign-in, AWS credentials', muted: true },
    { kind: 'tile', id: 'ontology', parent: 'cloud', icon: 's3', x: C1, y: R0, title: 'Amazon S3', sub: 'the ontology (OWL file)', steps: [1] },
    { kind: 'tile', id: 'photos', parent: 'cloud', icon: 's3', x: 1050, y: R0, title: 'Amazon S3', sub: 'the example photos', steps: [2] },
    { kind: 'tile', id: 'lambda', parent: 'cloud', icon: 'lambda', x: C1, y: R1, title: 'AWS Lambda', sub: 'classify: prompt, call, check', steps: [3] },
    { kind: 'tile', id: 'bedrock', parent: 'cloud', icon: 'bedrock', x: C2, y: R1, title: 'Amazon Bedrock', sub: 'Converse, the chosen vision model', steps: [4] },
    { kind: 'tile', id: 'output', parent: 'cloud', icon: 'output', x: C1, y: R2, title: 'Validated answer', sub: 'entities, and what the ontology lacks', steps: [5] },
    { kind: 'tile', id: 'logs', parent: 'cloud', icon: 'cloudwatch', x: C2, y: R2, title: 'Amazon CloudWatch Logs', sub: 'one log group', muted: true },
  ],
  edges: [
    { id: 'signin', from: 'browser', fromHandle: 's-t', to: 'cognito', toHandle: 't-l', kind: 'control', label: 'sign-in, AWS credentials', labelDx: -100, labelDy: 0 },
    { id: 'request', from: 'browser', fromHandle: 's-r', to: 'lambda', toHandle: 't-l', kind: 'data', label: 'photo or example, model' },
    { id: 'owl', from: 'ontology', fromHandle: 's-b', to: 'lambda', toHandle: 't-t1', kind: 'data', label: 'OWL file' },
    { id: 'bytes', from: 'photos', fromHandle: 's-b', to: 'lambda', toHandle: 't-t2', kind: 'data', label: 'photo bytes', labelDx: 60 },
    { id: 'converse', from: 'lambda', fromHandle: 's-r', to: 'bedrock', toHandle: 't-l', kind: 'data', label: 'Converse call\nsystem prompt + photo' },
    { id: 'check', from: 'lambda', fromHandle: 's-b', to: 'output', toHandle: 't-t', kind: 'data', label: 'the answer, checked', labelDx: -95 },
    { id: 'logs', from: 'lambda', fromHandle: 's-b2', to: 'logs', toHandle: 't-t', kind: 'control', label: 'logs', labelDx: 100 },
    { id: 'result', from: 'output', fromHandle: 's-l', to: 'browser', toHandle: 't-b', kind: 'data', label: 'entities and issues', centerX: 270, labelDx: 0, labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'control', text: 'a call that starts work, or a side effect' },
    { kind: 'step', text: '1 to 5: the steps under the figure' },
  ],
};
