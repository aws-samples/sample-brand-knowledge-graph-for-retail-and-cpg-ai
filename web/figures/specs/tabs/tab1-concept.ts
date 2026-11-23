// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 1, the concept: the ontology and a photo go in, graph data and proposals come out. The
 * ontology is the system prompt of a multimodal model on Amazon Bedrock (cached, since it is the
 * same text for every photo); the photo is the question. What comes back is a classification
 * with its relations, validated against the ontology, plus proposals for terms the ontology lacks.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const OTHER = '#69717b';
const FILE = '#232f3e';
const PROPOSAL = '#c0392b';

const LEFT_W = 340;
const TILE_X = 430;
const GX = 940;
const GW = 660;
const GY = 60;
const GH = 470;

export const tab1Concept: FigureSpec = {
  width: 1600,
  height: 680,
  large: true,
  nodes: [
    {
      kind: 'note',
      id: 'ontology',
      x: 0,
      y: 120,
      w: LEFT_W,
      title: 'The ontology (one OWL file)',
      text: 'The kinds of garment, the details each kind can have, the values each detail allows, and how they relate. The fixed list of words the model may use.',
      color: FILE,
    },
    { kind: 'note', id: 'photo', x: 0, y: 460, w: LEFT_W, title: 'One look photo', text: "A photo from the brand's lookbook, or your own.", color: OTHER },

    { kind: 'tile', id: 'model', icon: 'bedrock', x: TILE_X, y: 300, title: 'Multimodal model', sub: 'on Amazon Bedrock', handles: [{ id: 's-r2', side: 'r', at: 0.75, type: 'source' }] },
    {
      kind: 'note',
      id: 'caching',
      x: TILE_X - 30,
      y: 410,
      w: 330,
      title: 'Prompt caching',
      text: 'The ontology is the same text for every photo, so Amazon Bedrock keeps it in a cache. Later calls read it from there and cost less.',
      color: OTHER,
    },

    { kind: 'group', id: 'graph', x: GX, y: GY, w: GW, h: GH, title: 'Graph data', sub: "what the model saw, with the ontology's terms", color: LOOK },
    { kind: 'entity', id: 'look', parent: 'graph', x: GX + 200, y: GY + 60, label: 'Look', props: 'the photo', color: LOOK },
    { kind: 'entity', id: 'occasion', parent: 'graph', x: GX + 440, y: GY + 60, label: 'Occasion', props: 'Casual', color: OCCASION },
    { kind: 'entity', id: 'item1', parent: 'graph', x: GX + 20, y: GY + 210, label: 'Item', props: 'white lace-up sneakers', color: ITEM },
    { kind: 'entity', id: 'item2', parent: 'graph', x: GX + 230, y: GY + 210, label: 'Item', props: 'indigo denim pants', color: ITEM },
    { kind: 'entity', id: 'item3', parent: 'graph', x: GX + 440, y: GY + 210, label: 'Item', props: 'navy wool blazer', color: ITEM },
    { kind: 'entity', id: 'category', parent: 'graph', x: GX + 20, y: GY + 370, label: 'Category', props: 'shoe', color: CATEGORY },
    { kind: 'entity', id: 'attribute', parent: 'graph', x: GX + 440, y: GY + 370, label: 'Attribute', props: 'length: ankle', color: ATTRIBUTE },

    {
      kind: 'note',
      id: 'proposals',
      x: GX,
      y: GY + GH + 30,
      w: GW,
      title: 'Proposals for the ontology',
      text: "What the model saw but could not say with the ontology's terms, in its own words. The owners read them and the ontology grows.",
      color: PROPOSAL,
    },
  ],
  edges: [
    { id: 'terms', from: 'ontology', fromHandle: 's-r', to: 'model', toHandle: 't-t', kind: 'data', label: 'the terms, as the system prompt', labelDx: 12, labelDy: -20 },
    { id: 'question', from: 'photo', fromHandle: 's-t', to: 'model', toHandle: 't-l', kind: 'data', label: 'the question', labelDy: -2 },
    { id: 'classification', from: 'model', fromHandle: 's-r', to: 'graph', toHandle: 't-l', kind: 'data', label: 'a classification\nwith its relations', labelDy: -2 },
    { id: 'proposals', from: 'model', fromHandle: 's-r2', to: 'proposals', toHandle: 't-l', kind: 'data', centerX: 860 },
    { id: 'validated', from: 'graph', fromHandle: 's-t', to: 'ontology', toHandle: 't-t', kind: 'control', label: 'is validated against', labelDy: -2 },

    { id: 'for', from: 'look', fromHandle: 's-r', to: 'occasion', toHandle: 't-l', kind: 'data', label: 'FOR' },
    { id: 'c1', from: 'look', fromHandle: 's-b1', to: 'item1', toHandle: 't-t', kind: 'data' },
    { id: 'c2', from: 'look', fromHandle: 's-b', to: 'item2', toHandle: 't-t', kind: 'data', label: 'CONTAINS', labelDx: 70 },
    { id: 'c3', from: 'look', fromHandle: 's-b2', to: 'item3', toHandle: 't-t', kind: 'data' },
    { id: 'iscat', from: 'item1', fromHandle: 's-b', to: 'category', toHandle: 't-t', kind: 'data', label: 'IS_CATEGORY' },
    { id: 'hasattr', from: 'item3', fromHandle: 's-b', to: 'attribute', toHandle: 't-t', kind: 'data', label: 'HAS_ATTRIBUTE' },
  ],
  legend: [
    { kind: 'data', text: 'what goes in and comes out' },
    { kind: 'control', text: 'the check: every kind, value and part must be in the ontology' },
  ],
};
