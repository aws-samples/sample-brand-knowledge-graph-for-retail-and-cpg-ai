// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 2, the concept: from a photo to facts. One look photo is classified with the ontology's
 * terms, checked, written as OWL individuals and mapped by generic rules onto nodes and edges
 * (backend/src/ontology_rag/pipeline.py, kg.py). A text takes the shorter path to Statement nodes.
 * Two photos with the same kind of garment meet at the same Category node.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const TEXT = '#c0392b';
const STEP = '#69717b';

const GX = 760;
const GY = 200;

export const tab2Concept: FigureSpec = {
  width: 1500,
  height: 690,
  large: true,
  nodes: [
    { kind: 'note', id: 'photo', x: 0, y: 0, w: 220, title: 'One look photo', text: "from the brand's shoot, one source of many", color: STEP },
    { kind: 'note', id: 'classify', x: 270, y: 0, w: 280, title: 'Classify', text: "garments, parts and details, with the ontology's terms", color: STEP },
    { kind: 'note', id: 'check', x: 600, y: 0, w: 260, title: 'Check', text: 'every term is looked up in the ontology', color: STEP },
    { kind: 'note', id: 'owl', x: 910, y: 0, w: 260, title: 'OWL individuals', text: 'one individual per garment, typed by its kind', color: STEP },
    { kind: 'note', id: 'rules', x: 1220, y: 0, w: 280, title: 'Generic rules', text: 'a class becomes a Category node, a value an Attribute node, a part a HAS_PART edge', color: STEP },

    { kind: 'group', id: 'graph', x: GX, y: GY, w: 740, h: 420, title: 'The nodes and edges', sub: 'what the ingest step writes into the graph', color: LOOK },
    { kind: 'entity', id: 'look', parent: 'graph', x: 1000, y: 260, label: 'Look', props: 'the photo, its name', color: LOOK, handles: [{ id: 't-l1', side: 'l', at: 0.5, type: 'target' }] },
    { kind: 'entity', id: 'occasion', parent: 'graph', x: 1270, y: 260, label: 'Occasion', props: 'one of the 9', color: OCCASION },
    { kind: 'entity', id: 'item1', parent: 'graph', x: 880, y: 390, label: 'Item', props: 'a garment in the photo', color: ITEM },
    { kind: 'entity', id: 'item2', parent: 'graph', x: 1120, y: 390, label: 'Item', props: 'another garment', color: ITEM },
    { kind: 'entity', id: 'category', parent: 'graph', x: 790, y: 520, label: 'Category', props: 'its kind, from the ontology', color: CATEGORY },
    { kind: 'entity', id: 'attribute', parent: 'graph', x: 1270, y: 520, label: 'Attribute', props: 'a value, from the ontology', color: ATTRIBUTE },

    { kind: 'note', id: 'text', x: 0, y: 260, w: 240, title: 'One text', text: 'an article or a post', color: TEXT },
    { kind: 'entity', id: 'statement', x: 300, y: 270, label: 'Statement', props: 'one claim from the text', color: TEXT },
    {
      kind: 'note',
      id: 'merge',
      x: 0,
      y: 440,
      w: 600,
      title: 'Where looks meet',
      text: 'A second photo with the same kind of garment links to the SAME Category node, so looks meet through what they share.',
      color: CATEGORY,
    },
  ],
  edges: [
    { id: 's1', from: 'photo', fromHandle: 's-r', to: 'classify', toHandle: 't-l', kind: 'data' },
    { id: 's2', from: 'classify', fromHandle: 's-r', to: 'check', toHandle: 't-l', kind: 'data' },
    { id: 's3', from: 'check', fromHandle: 's-r', to: 'owl', toHandle: 't-l', kind: 'data' },
    { id: 's4', from: 'owl', fromHandle: 's-r', to: 'rules', toHandle: 't-l', kind: 'data' },
    { id: 's5', from: 'rules', fromHandle: 's-b', to: 'graph', toHandle: 't-t', kind: 'data', label: 'nodes and edges', labelDy: 0 },

    { id: 'for', from: 'look', fromHandle: 's-r', to: 'occasion', toHandle: 't-l', kind: 'data', label: 'FOR', labelDy: -42 },
    { id: 'c1', from: 'look', fromHandle: 's-b1', to: 'item1', toHandle: 't-t2', kind: 'data', label: 'CONTAINS', labelDx: -60 },
    { id: 'c2', from: 'look', fromHandle: 's-b2', to: 'item2', toHandle: 't-t1', kind: 'data' },
    { id: 'iscat', from: 'item1', fromHandle: 's-b1', to: 'category', toHandle: 't-t2', kind: 'data', label: 'IS_CATEGORY', labelDx: -75 },
    { id: 'hasattr', from: 'item2', fromHandle: 's-b2', to: 'attribute', toHandle: 't-t1', kind: 'data', label: 'HAS_ATTRIBUTE', labelDx: 85 },

    { id: 't1', from: 'text', fromHandle: 's-r', to: 'statement', toHandle: 't-l', kind: 'data' },
    { id: 'illustrates', from: 'statement', fromHandle: 's-r', to: 'look', toHandle: 't-l1', kind: 'data', label: 'ILLUSTRATES' },
    { id: 'same', from: 'merge', fromHandle: 's-r', to: 'category', toHandle: 't-l', kind: 'control', label: 'same node', labelDx: -10, labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'what each step hands on' },
    { kind: 'control', text: 'a link, not a step' },
  ],
};
