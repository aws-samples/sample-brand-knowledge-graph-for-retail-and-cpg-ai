// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec, RowSpec } from '../kit';

/** The ontologies/ folder contract (ontologies/README.md, backend/src/ontology_rag/ontologies.py, infra/lib/bundling.ts). */
const GRAPH = '#8c2f8f';
const APP = '#0b5fb0';
const KEY = '#3d7a10';

const lines: [number, string, string, boolean, string?][] = [
  [0, 'ontologies/', '', true],
  [1, 'README.md', '', false],
  [1, '<domain>/', 'one folder per domain', true],
  [2, '<domain>.ttl', 'the ontology', false, 'graph'],
  [2, 'domain.json', 'optional: names, wording, worked queries', false],
  [2, 'README.md', 'attribution and modeling notes', false],
  [2, 'build_*.py, generate_*.py', 'scripts that made the files, never deployed', false],
  [2, 'examples/', 'inputs to try in the app', true, 'app'],
  [3, 'images/', 'whole photos', true],
  [3, 'items/', 'single pieces', true],
  [3, 'articles/', 'texts', true],
  [2, 'datasets/', 'one folder per brand', true],
  [3, 'README.md', 'what a data set is, its two formats', false],
  [3, '<set>/', '', true],
  [4, 'README.md', 'required: the app lists a set by this file', false],
  [4, 'brand.json, items.json, looks.json, ...', 'the data files', false, 'graph'],
  [4, 'domain.json', 'optional', false],
  [4, 'media/<sub>/', "the data's own photos", true, 'key'],
  [4, 'examples/', "optional: the domain's examples/ shape", true, 'app'],
];

const ROW = 34;
const TOP = 10;
const rows: RowSpec[] = lines.map(([depth, name, note, folder, mark], i) => ({ kind: 'row', id: `r${i}`, x: 0, y: TOP + i * ROW, depth, name, note, folder, mark }));
const y = (i: number) => TOP + i * ROW;

export const dataLayout: FigureSpec = {
  width: 1060,
  height: TOP + lines.length * ROW + 20,
  nodes: [
    ...rows,
    {
      kind: 'note',
      id: 'graph',
      x: 740,
      y: y(2) - 10,
      w: 320,
      title: 'Loaded into the graph at deploy',
      text: "The GraphLoader reads the ontology and each set's data files once. It writes the graph and the catalog index.",
      color: GRAPH,
    },
    {
      kind: 'note',
      id: 'app',
      x: 740,
      y: y(8) - 6,
      w: 320,
      title: 'Offered in the app, never loaded',
      text: 'The tabs list these photos and texts. Tab 2 ingests one when you ask.',
      color: APP,
    },
    {
      kind: 'note',
      id: 'key',
      x: 740,
      y: y(15),
      w: 320,
      title: 'Served by key',
      text: "A node's image_key names a photo here. The API reads it from the data bucket when the app shows it.",
      color: KEY,
    },
  ],
  edges: [
    { id: 'g1', from: 'graph', fromHandle: 's-l', to: 'r3', toHandle: 't-r', kind: 'data', color: GRAPH, centerX: 650 },
    { id: 'g2', from: 'graph', fromHandle: 's-l', to: 'r15', toHandle: 't-r', kind: 'data', color: GRAPH, centerX: 650 },
    { id: 'a1', from: 'app', fromHandle: 's-l', to: 'r7', toHandle: 't-r', kind: 'data', color: APP, centerX: 700 },
    { id: 'a2', from: 'app', fromHandle: 's-l', to: 'r18', toHandle: 't-r', kind: 'data', color: APP, centerX: 700 },
    { id: 'k1', from: 'key', fromHandle: 's-l', to: 'r17', toHandle: 't-r', kind: 'data', color: KEY, centerX: 675 },
  ],
  legend: [],
};
