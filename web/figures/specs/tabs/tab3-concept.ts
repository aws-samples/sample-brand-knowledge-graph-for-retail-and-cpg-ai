// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 3, the concept: what the graph is, and why following its links counts exactly. Left, the
 * graph model (the base of web/figures/specs/graph-model.ts, compacted); right, a worked count on
 * two looks that both wear the white sneaker, the question tab 3 asks the graph.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const TEXT = '#c0392b';
const OTHER = '#69717b';

const A = 40;
const B = 280;
const C = 600;
const D = 840;
const R0 = 100;
const R1 = 290;
const R2 = 460;
const R3 = 630;
const H = 760;

export const tab3Concept: FigureSpec = {
  width: 1610,
  height: H + 10,
  large: true,
  nodes: [
    { kind: 'group', id: 'ontology', x: 0, y: 0, w: 520, h: H, title: 'The ontology', sub: 'loaded once from the OWL file', color: CATEGORY, dashed: true },
    { kind: 'group', id: 'brand', x: 560, y: 0, w: 520, h: H, title: "The brand's knowledge", sub: 'data sets at deploy, tab 2 at run time', color: LOOK, dashed: true },
    { kind: 'entity', id: 'family', parent: 'ontology', x: A, y: R0, label: 'AttributeFamily', props: 'name', color: OTHER },
    { kind: 'entity', id: 'group', parent: 'ontology', x: B, y: R0, label: 'Group', props: 'upperbody, wholebody, ...', color: OTHER },
    {
      kind: 'entity',
      id: 'category',
      parent: 'ontology',
      x: B,
      y: R1,
      label: 'Category',
      props: 'coat, shoe, collar, ...',
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

    { kind: 'group', id: 'count', x: 1110, y: 0, w: 500, h: H, title: 'A count, by following links', sub: "tab 3's question", color: OTHER, dashed: true },
    { kind: 'entity', id: 'lookA', parent: 'count', x: 1150, y: R0, label: 'Professional look', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'lookB', parent: 'count', x: 1370, y: R0, label: 'Business casual', props: 'Look', color: LOOK },
    { kind: 'entity', id: 'sneaker', parent: 'count', x: 1280, y: 250, label: 'white sneaker', props: 'Item (right foot), worn in both', color: ITEM },
    { kind: 'entity', id: 'bag', parent: 'count', x: 1130, y: 400, label: 'leather bag', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'tote', parent: 'count', x: 1390, y: 400, label: 'canvas tote', props: 'Item', color: ITEM },
    { kind: 'entity', id: 'shoe', parent: 'count', x: 1280, y: 530, label: 'shoe', props: 'Category', color: CATEGORY },
    {
      kind: 'note',
      id: 'why',
      parent: 'count',
      x: 1130,
      y: 625,
      w: 460,
      title: 'Looks with a white sneaker that wear a bag: 2',
      text: 'Vector search would return the nearest garments. The walk returns a number you can check.',
      color: OTHER,
    },
  ],
  edges: [
    { id: 'applies', from: 'family', fromHandle: 's-r', to: 'group', toHandle: 't-l', kind: 'data', label: 'APPLIES_TO', labelDy: -34 },
    { id: 'infamily', from: 'attribute', fromHandle: 's-t', to: 'family', toHandle: 't-b', kind: 'data', label: 'IN_FAMILY' },
    { id: 'ingroup', from: 'category', fromHandle: 's-t', to: 'group', toHandle: 't-b', kind: 'data', label: 'IN_GROUP' },
    { id: 'pairs', from: 'category', fromHandle: 's-l1', to: 'category', toHandle: 't-t1', kind: 'data', label: 'PAIRS_WITH', color: CATEGORY, labelDx: -30, labelDy: -14 },
    { id: 'iscat', from: 'item', fromHandle: 's-l1', to: 'category', toHandle: 't-r1', kind: 'data', label: 'IS_CATEGORY' },
    { id: 'haspart', from: 'item', fromHandle: 's-l2', to: 'category', toHandle: 't-r2', kind: 'data', label: 'HAS_PART', labelDy: 14 },
    { id: 'hasattr', from: 'item', fromHandle: 's-b1', to: 'attribute', toHandle: 't-r', kind: 'data', label: 'HAS_ATTRIBUTE' },
    { id: 'layered', from: 'item', fromHandle: 's-r1', to: 'item', toHandle: 't-t3', kind: 'data', label: 'LAYERED_WITH', color: ITEM, labelDx: 40, labelDy: -14 },
    { id: 'fromline', from: 'item', fromHandle: 's-t', to: 'line', toHandle: 't-b', kind: 'data', label: 'FROM_LINE' },
    { id: 'ofbrand', from: 'line', fromHandle: 's-r', to: 'brandnode', toHandle: 't-l', kind: 'data', label: 'OF_BRAND', labelDy: -34 },
    { id: 'contains', from: 'look', fromHandle: 's-t', to: 'item', toHandle: 't-b', kind: 'data', label: 'CONTAINS', labelDy: -60 },
    { id: 'for', from: 'look', fromHandle: 's-l', to: 'occasion', toHandle: 't-r', kind: 'data', label: 'FOR' },
    { id: 'hasstatement', from: 'article', fromHandle: 's-t', to: 'statement', toHandle: 't-b', kind: 'data', label: 'HAS_STATEMENT' },
    { id: 'illustrates-item', from: 'statement', fromHandle: 's-l', to: 'item', toHandle: 't-r', kind: 'data', label: 'ILLUSTRATES', centerX: 822 },
    { id: 'illustrates-look', from: 'statement', fromHandle: 's-l2', to: 'look', toHandle: 't-r', kind: 'data', centerX: 830 },

    { id: 'a-sneaker', from: 'lookA', fromHandle: 's-b2', to: 'sneaker', toHandle: 't-t1', kind: 'data', label: 'CONTAINS', labelDx: -20 },
    { id: 'b-sneaker', from: 'lookB', fromHandle: 's-b1', to: 'sneaker', toHandle: 't-t2', kind: 'data', label: 'CONTAINS', labelDx: 20 },
    { id: 'a-bag', from: 'lookA', fromHandle: 's-b1', to: 'bag', toHandle: 't-t1', kind: 'data', label: 'CONTAINS', labelDy: 60 },
    { id: 'b-tote', from: 'lookB', fromHandle: 's-b2', to: 'tote', toHandle: 't-t2', kind: 'data', label: 'CONTAINS', labelDy: 60 },
    { id: 'sneaker-shoe', from: 'sneaker', fromHandle: 's-b', to: 'shoe', toHandle: 't-t', kind: 'data', label: 'IS_CATEGORY', labelDy: 80 },
  ],
  legend: [],
};
