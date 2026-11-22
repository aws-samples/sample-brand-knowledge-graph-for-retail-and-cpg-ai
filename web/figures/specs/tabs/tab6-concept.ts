// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 6, the concept: the same graph, three people asking (backend/src/ontology_rag/lenses.py,
 * trends.py; web/src/components/lenses/LensesTab.tsx). The buyer, the merchandiser and the
 * creative director each read the graph that tabs 2 and 3 built. The trends question has three
 * methods over three stores, with one definition of emerging.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const STEP = '#69717b';

const GRAPH = { x: 540, y: 0, w: 520, h: 350 };
const METHODS = { x: 0, y: 410, w: 1600, h: 200 };

export const tab6Concept: FigureSpec = {
  width: 1600,
  height: 680,
  large: true,
  nodes: [
    { kind: 'group', id: 'buyer', x: 0, y: 0, w: 480, h: 160, title: 'The buyer', color: STEP },
    { kind: 'note', id: 'buyer-q', parent: 'buyer', x: 30, y: 60, w: 420, title: 'What do the stylists use that we do not sell?', text: "the looks' garments with no catalog product", color: STEP },
    { kind: 'group', id: 'merch', x: 0, y: 190, w: 480, h: 160, title: 'The merchandiser', color: STEP },
    { kind: 'note', id: 'merch-q', parent: 'merch', x: 30, y: 250, w: 420, title: 'Which pairings are our signature?', text: 'pairs of kinds counted across looks, per occasion', color: STEP },

    {
      kind: 'group',
      id: 'graph',
      x: GRAPH.x,
      y: GRAPH.y,
      w: GRAPH.w,
      h: GRAPH.h,
      title: 'The graph',
      sub: 'what tabs 2 and 3 built',
      color: LOOK,
      handles: [
        { id: 't-l1', side: 'l', at: 80 / GRAPH.h, type: 'target' },
        { id: 't-l2', side: 'l', at: 270 / GRAPH.h, type: 'target' },
      ],
    },
    { kind: 'entity', id: 'look', parent: 'graph', x: 570, y: 70, label: 'Look', color: LOOK },
    { kind: 'entity', id: 'occasion', parent: 'graph', x: 850, y: 70, label: 'Occasion', color: OCCASION },
    { kind: 'entity', id: 'item', parent: 'graph', x: 710, y: 165, label: 'Item', color: ITEM, vec: true },
    { kind: 'entity', id: 'category', parent: 'graph', x: 570, y: 270, label: 'Category', color: CATEGORY },
    { kind: 'entity', id: 'attribute', parent: 'graph', x: 850, y: 270, label: 'Attribute', color: ATTRIBUTE },

    { kind: 'group', id: 'creative', x: 1120, y: 0, w: 480, h: 350, title: 'The creative director', color: STEP },
    { kind: 'note', id: 'onbrand', parent: 'creative', x: 1150, y: 60, w: 420, title: 'Is this new photo on-brand?', text: "a photo compared with the lookbook's looks", color: STEP },
    { kind: 'note', id: 'emerging', parent: 'creative', x: 1150, y: 190, w: 420, title: 'What is emerging this season?', text: "the new items of tab 2's shoot against the lookbook", color: STEP },

    {
      kind: 'group',
      id: 'methods',
      x: METHODS.x,
      y: METHODS.y,
      w: METHODS.w,
      h: METHODS.h,
      title: 'The trends question, three methods',
      sub: 'one question, three stores, the same definition of emerging',
      color: ITEM,
      handles: [{ id: 't-t3', side: 't', at: 1360 / METHODS.w, type: 'target' }],
    },
    { kind: 'note', id: 'm1', parent: 'methods', x: 30, y: 480, w: 480, title: '1  Ask the graph agent', text: 'openCypher over the graph: counts per kind and value', color: ITEM },
    { kind: 'note', id: 'm2', parent: 'methods', x: 560, y: 480, w: 480, title: '2  Export to Apache Iceberg tables', text: 'then ask the data agent: SQL over the same rows', color: ITEM },
    { kind: 'note', id: 'm3', parent: 'methods', x: 1090, y: 480, w: 480, title: '3  Explore the clouds', text: "the garments' vectors grouped in the browser, each cloud described by a model", color: ITEM },
  ],
  edges: [
    { id: 'for', from: 'look', fromHandle: 's-r', to: 'occasion', toHandle: 't-l', kind: 'data', label: 'FOR', color: OCCASION },
    { id: 'contains', from: 'look', fromHandle: 's-b', to: 'item', toHandle: 't-t', kind: 'data', label: 'CONTAINS', color: LOOK, labelDx: -75, labelDy: 0 },
    { id: 'iscat', from: 'item', fromHandle: 's-b1', to: 'category', toHandle: 't-t', kind: 'data', label: 'IS_CATEGORY', color: CATEGORY, labelDx: -75, labelDy: 0 },
    { id: 'hasattr', from: 'item', fromHandle: 's-b2', to: 'attribute', toHandle: 't-t', kind: 'data', label: 'HAS_ATTRIBUTE', color: ATTRIBUTE, labelDx: 85, labelDy: 0 },
    { id: 'q-buyer', from: 'buyer', fromHandle: 's-r', to: 'graph', toHandle: 't-l1', kind: 'data', label: 'openCypher' },
    { id: 'q-merch', from: 'merch', fromHandle: 's-r', to: 'graph', toHandle: 't-l2', kind: 'data', label: 'openCypher' },
    { id: 'q-creative', from: 'creative', fromHandle: 's-l', to: 'graph', toHandle: 't-r', kind: 'data', label: 'openCypher,\nvectors' },
    { id: 'three', from: 'creative', fromHandle: 's-b', to: 'methods', toHandle: 't-t3', kind: 'control', label: 'three ways to answer it' },
  ],
  legend: [
    { kind: 'data', text: 'a question read from the graph, or an edge of the graph' },
    { kind: 'control', text: 'which question the methods answer' },
  ],
};
