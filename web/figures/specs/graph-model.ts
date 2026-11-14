// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../kit';

/**
 * The graph model of docs/graph-model.md: the ontology's node types on the left, the brand's on
 * the right. Colours are tab 3's (WEB_COLORS in web/src/components/graph/GraphWeb.tsx); the
 * types tab 3 does not draw are grey.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const TEXT = '#c0392b';
const OTHER = '#69717b';

const A = 40;
const B = 330;
const C = 690;
const D = 1010;
const R0 = 90;
const R1 = 270;
const R2 = 430;
const R3 = 590;

export const graphModel: FigureSpec = {
  width: 1260,
  height: 705,
  nodes: [
    { kind: 'group', id: 'ontology', x: 0, y: 0, w: 580, h: 700, title: 'The ontology', sub: 'loaded once from the OWL file', color: CATEGORY, dashed: true },
    { kind: 'group', id: 'brand', x: 640, y: 0, w: 620, h: 700, title: "The brand's knowledge", sub: 'data sets at deploy, tab 2 at run time', color: LOOK, dashed: true },
    { kind: 'entity', id: 'family', parent: 'ontology', x: A, y: R0, label: 'AttributeFamily', props: 'name', color: OTHER },
    { kind: 'entity', id: 'group', parent: 'ontology', x: B, y: R0, label: 'Group', props: 'upperbody, wholebody, ...', color: OTHER },
    {
      kind: 'entity',
      id: 'category',
      parent: 'ontology',
      x: B,
      y: R1,
      label: 'Category',
      props: 'coat, sneaker, collar, ...',
      color: CATEGORY,
      handles: [
        { id: 't-r1', side: 'r', at: 0.3, type: 'target' },
        { id: 't-r2', side: 'r', at: 0.75, type: 'target' },
        { id: 's-l1', side: 'l', at: 0.3, type: 'source' },
      ],
    },
    { kind: 'entity', id: 'attribute', parent: 'ontology', x: A, y: R2, label: 'Attribute', props: 'length:knee, ...', color: ATTRIBUTE },
    { kind: 'entity', id: 'occasion', parent: 'ontology', x: B, y: R3, label: 'Occasion', props: 'casual, evening, ... (9)', color: OCCASION },
    { kind: 'entity', id: 'line', parent: 'brand', x: C, y: R0, label: 'Line', props: 'name, season', color: OTHER },
    { kind: 'entity', id: 'brandnode', parent: 'brand', x: D, y: R0, label: 'Brand', props: 'name, description', color: OTHER },
    {
      kind: 'entity',
      id: 'item',
      parent: 'brand',
      x: C,
      y: R1,
      label: 'Item',
      props: 'name, color, material',
      color: ITEM,
      vec: true,
      handles: [
        { id: 's-l1', side: 'l', at: 0.3, type: 'source' },
        { id: 's-l2', side: 'l', at: 0.75, type: 'source' },
        { id: 's-r1', side: 'r', at: 0.25, type: 'source' },
        { id: 't-t3', side: 't', at: 0.85, type: 'target' },
      ],
    },
    { kind: 'entity', id: 'statement', parent: 'brand', x: D, y: R2, label: 'Statement', props: 'text', color: TEXT, vec: true, handles: [{ id: 's-l2', side: 'l', at: 0.75, type: 'source' }] },
    { kind: 'entity', id: 'look', parent: 'brand', x: C, y: R3, label: 'Look', props: 'name, occasion text', color: LOOK, vec: true },
    { kind: 'entity', id: 'article', parent: 'brand', x: D, y: R3, label: 'Article', props: 'title, source', color: TEXT },
  ],
  edges: [
    { id: 'applies', from: 'family', fromHandle: 's-r', to: 'group', toHandle: 't-l', kind: 'data', label: 'APPLIES_TO' },
    { id: 'infamily', from: 'attribute', fromHandle: 's-t', to: 'family', toHandle: 't-b', kind: 'data', label: 'IN_FAMILY' },
    { id: 'ingroup', from: 'category', fromHandle: 's-t', to: 'group', toHandle: 't-b', kind: 'data', label: 'IN_GROUP' },
    { id: 'pairs', from: 'category', fromHandle: 's-l1', to: 'category', toHandle: 't-t1', kind: 'data', label: 'PAIRS_WITH', color: CATEGORY, labelDx: -30, labelDy: -14 },
    { id: 'iscat', from: 'item', fromHandle: 's-l1', to: 'category', toHandle: 't-r1', kind: 'data', label: 'IS_CATEGORY' },
    { id: 'haspart', from: 'item', fromHandle: 's-l2', to: 'category', toHandle: 't-r2', kind: 'data', label: 'HAS_PART', labelDy: 14 },
    { id: 'hasattr', from: 'item', fromHandle: 's-b1', to: 'attribute', toHandle: 't-r', kind: 'data', label: 'HAS_ATTRIBUTE' },
    { id: 'layered', from: 'item', fromHandle: 's-r1', to: 'item', toHandle: 't-t3', kind: 'data', label: 'LAYERED_WITH', color: ITEM, labelDx: 40, labelDy: -14 },
    { id: 'fromline', from: 'item', fromHandle: 's-t', to: 'line', toHandle: 't-b', kind: 'data', label: 'FROM_LINE' },
    { id: 'ofbrand', from: 'line', fromHandle: 's-r', to: 'brandnode', toHandle: 't-l', kind: 'data', label: 'OF_BRAND' },
    { id: 'contains', from: 'look', fromHandle: 's-t', to: 'item', toHandle: 't-b', kind: 'data', label: 'CONTAINS' },
    { id: 'for', from: 'look', fromHandle: 's-l', to: 'occasion', toHandle: 't-r', kind: 'data', label: 'FOR' },
    { id: 'hasstatement', from: 'article', fromHandle: 's-t', to: 'statement', toHandle: 't-b', kind: 'data', label: 'HAS_STATEMENT' },
    { id: 'illustrates-item', from: 'statement', fromHandle: 's-l', to: 'item', toHandle: 't-r', kind: 'data', label: 'ILLUSTRATES', centerX: 945 },
    { id: 'illustrates-look', from: 'statement', fromHandle: 's-l2', to: 'look', toHandle: 't-r', kind: 'data', centerX: 960 },
  ],
  legend: [],
};
