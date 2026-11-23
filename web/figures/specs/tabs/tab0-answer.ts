// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 0, where the brand's answer lives: three of the brand's looks and the garments they contain,
 * as the graph tab 2 builds from the lookbook photos. The looks are illustrative: two looks share
 * the white sneaker, two share the trench coat. The note on the right says why a similarity search
 * over products cannot give this answer: it is a relationship, not a product.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';

const LOOK_Y = 60;
const ITEM_Y = 220;

export const tab0Answer: FigureSpec = {
  width: 1400,
  height: 320,
  large: true,
  nodes: [
    { kind: 'group', id: 'looks', x: 0, y: 0, w: 1000, h: 300, title: "The brand's looks", sub: 'each arrow: the look CONTAINS the garment', color: LOOK },
    { kind: 'entity', id: 'lookA', parent: 'looks', x: 40, y: LOOK_Y, label: 'Casual look', props: 'for: Casual', color: LOOK },
    { kind: 'entity', id: 'lookB', parent: 'looks', x: 400, y: LOOK_Y, label: 'Smart casual look', props: 'for: Smart casual', color: LOOK },
    { kind: 'entity', id: 'lookC', parent: 'looks', x: 760, y: LOOK_Y, label: 'Outdoor look', props: 'for: Outdoor', color: LOOK },
    { kind: 'entity', id: 'sneaker', parent: 'looks', x: 40, y: ITEM_Y, label: 'White sneaker', props: 'worn in two looks', color: ITEM },
    { kind: 'entity', id: 'bag', parent: 'looks', x: 280, y: ITEM_Y, label: 'Leather bag', props: 'worn in one look', color: ITEM },
    { kind: 'entity', id: 'trench', parent: 'looks', x: 520, y: ITEM_Y, label: 'Trench coat', props: 'worn in two looks', color: ITEM },
    { kind: 'entity', id: 'denim', parent: 'looks', x: 760, y: ITEM_Y, label: 'Denim pants', props: 'worn in one look', color: ITEM },

    {
      kind: 'note',
      id: 'answer',
      x: 1030,
      y: 0,
      w: 370,
      title: 'The answer is a relationship',
      text: 'What the stylists wore together, for which occasion. It sits in photos that nothing can query, until tab 2 turns them into this graph.',
      color: LOOK,
    },
  ],
  edges: [
    { id: 'a-sneaker', from: 'lookA', fromHandle: 's-b1', to: 'sneaker', toHandle: 't-t1', kind: 'data', label: 'CONTAINS' },
    { id: 'a-bag', from: 'lookA', fromHandle: 's-b2', to: 'bag', toHandle: 't-t1', kind: 'data' },
    { id: 'b-sneaker', from: 'lookB', fromHandle: 's-b1', to: 'sneaker', toHandle: 't-t2', kind: 'data', centerY: 180 },
    { id: 'b-trench', from: 'lookB', fromHandle: 's-b2', to: 'trench', toHandle: 't-t1', kind: 'data' },
    { id: 'c-trench', from: 'lookC', fromHandle: 's-b1', to: 'trench', toHandle: 't-t2', kind: 'data', centerY: 180 },
    { id: 'c-denim', from: 'lookC', fromHandle: 's-b2', to: 'denim', toHandle: 't-t2', kind: 'data', label: 'CONTAINS' },
  ],
  legend: [],
};
