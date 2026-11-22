// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 0, the problem: what a similarity search does with a shopper's request, and where the
 * brand's answer lives. The four requests and what the sample's own catalog search returned for
 * them (k = 6, 62 products, 22 Nov 2026) are the ones tab 0 lets a participant try. The looks at
 * the bottom are illustrative: two looks share the white sneaker, two share the trench coat.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const OTHER = '#69717b';
const SEARCH = '#2f6fb0';

const ASK_X = 0;
const RET_X = 1000;
const NOTE_W = 340;
const ROWS = [50, 140, 230, 320];
const TILE_X = 582;
const TILE_Y = 190;
const LOOK_Y = 530;
const ITEM_Y = 690;

export const tab0Problem: FigureSpec = {
  width: 1400,
  height: 820,
  large: true,
  nodes: [
    { kind: 'group', id: 'ask', x: ASK_X, y: 0, w: 400, h: 410, title: 'A shopper asks', color: OTHER },
    { kind: 'note', id: 'ask1', parent: 'ask', x: ASK_X + 30, y: ROWS[0], w: NOTE_W, title: 'What goes with white sneakers?', text: "a count over the brand's looks", color: OTHER },
    { kind: 'note', id: 'ask2', parent: 'ask', x: ASK_X + 30, y: ROWS[1], w: NOTE_W, title: 'A sleeveless dress, not black', text: 'a negation', color: OTHER },
    { kind: 'note', id: 'ask3', parent: 'ask', x: ASK_X + 30, y: ROWS[2], w: NOTE_W, title: 'A trench over denim', text: 'an order of layers', color: OTHER },
    { kind: 'note', id: 'ask4', parent: 'ask', x: ASK_X + 30, y: ROWS[3], w: NOTE_W, title: 'A blue shirt with a white collar', text: 'two colours, each on its own part', color: OTHER },

    { kind: 'tile', id: 'search', icon: 's3vectors', x: TILE_X, y: TILE_Y, title: 'Similarity search', sub: 'nearest products by meaning', muted: true },

    { kind: 'group', id: 'ret', x: RET_X, y: 0, w: 400, h: 410, title: 'What it returns', color: SEARCH },
    { kind: 'note', id: 'ret1', parent: 'ret', x: RET_X + 30, y: ROWS[0], w: NOTE_W, title: 'More white shoes', text: 'White shoe, Sand suede shoe, Black satin shoe', color: SEARCH },
    { kind: 'note', id: 'ret2', parent: 'ret', x: RET_X + 30, y: ROWS[1], w: NOTE_W, title: 'A black dress first', text: 'Black crepe dress, Sage cupro dress, Black jacket', color: SEARCH },
    { kind: 'note', id: 'ret3', parent: 'ret', x: RET_X + 30, y: ROWS[2], w: NOTE_W, title: 'A coat and a dress', text: 'Stone gabardine coat, Beige coat, White linen dress', color: SEARCH },
    { kind: 'note', id: 'ret4', parent: 'ret', x: RET_X + 30, y: ROWS[3], w: NOTE_W, title: 'Shirts in every colour', text: 'Sage cotton top, Navy linen shirt, Ivory silk shirt', color: SEARCH },

    { kind: 'group', id: 'looks', x: 0, y: 470, w: 1000, h: 300, title: "The brand's looks", sub: 'each arrow: the look CONTAINS the garment', color: LOOK },
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
      y: 470,
      w: 370,
      title: 'The answer is a relationship',
      text: 'What the stylists wore together, for which occasion. It sits in photos that nothing can query, until tab 2 turns them into this graph.',
      color: LOOK,
    },
  ],
  edges: [
    { id: 'q1', from: 'ask1', fromHandle: 's-r', to: 'search', toHandle: 't-l', kind: 'data' },
    { id: 'q2', from: 'ask2', fromHandle: 's-r', to: 'search', toHandle: 't-l', kind: 'data' },
    { id: 'q3', from: 'ask3', fromHandle: 's-r', to: 'search', toHandle: 't-l', kind: 'data' },
    { id: 'q4', from: 'ask4', fromHandle: 's-r', to: 'search', toHandle: 't-l', kind: 'data' },
    { id: 'r1', from: 'search', fromHandle: 's-r', to: 'ret1', toHandle: 't-l', kind: 'data' },
    { id: 'r2', from: 'search', fromHandle: 's-r', to: 'ret2', toHandle: 't-l', kind: 'data' },
    { id: 'r3', from: 'search', fromHandle: 's-r', to: 'ret3', toHandle: 't-l', kind: 'data' },
    { id: 'r4', from: 'search', fromHandle: 's-r', to: 'ret4', toHandle: 't-l', kind: 'data' },
    { id: 'a-sneaker', from: 'lookA', fromHandle: 's-b1', to: 'sneaker', toHandle: 't-t1', kind: 'data', label: 'CONTAINS' },
    { id: 'a-bag', from: 'lookA', fromHandle: 's-b2', to: 'bag', toHandle: 't-t1', kind: 'data' },
    { id: 'b-sneaker', from: 'lookB', fromHandle: 's-b1', to: 'sneaker', toHandle: 't-t2', kind: 'data', centerY: 650 },
    { id: 'b-trench', from: 'lookB', fromHandle: 's-b2', to: 'trench', toHandle: 't-t1', kind: 'data' },
    { id: 'c-trench', from: 'lookC', fromHandle: 's-b1', to: 'trench', toHandle: 't-t2', kind: 'data', centerY: 650 },
    { id: 'c-denim', from: 'lookC', fromHandle: 's-b2', to: 'denim', toHandle: 't-t2', kind: 'data', label: 'CONTAINS' },
  ],
  legend: [{ kind: 'data', text: 'a request, and what comes back' }],
};
