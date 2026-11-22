// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 0, the three terms: a taxonomy, an ontology and graph data, each with one example drawn
 * from the sample's fashion ontology (ontologies/fashion/fashion.ttl): the Apparel tree and its
 * groups, the shirt's two attribute families with their allowed values, the pairsWith relation and
 * one domain rule, then one look of the brand as nodes and edges in those terms.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';

const TX = 0;
const OX = 420;
const GX = 860;
const H = 650;

export const tab0Terms: FigureSpec = {
  width: 1500,
  height: H + 10,
  large: true,
  nodes: [
    { kind: 'group', id: 'taxonomy', x: TX, y: 0, w: 400, h: H, title: '1 Taxonomy', sub: 'a tree of kinds', color: CATEGORY },
    { kind: 'entity', id: 'apparel', parent: 'taxonomy', x: TX + 20, y: 60, label: 'Apparel', props: '64 garment kinds', color: CATEGORY },
    { kind: 'entity', id: 'upper', parent: 'taxonomy', x: TX + 180, y: 180, label: 'Upper body', props: 'jacket, shirt, sweater, ...', color: CATEGORY },
    { kind: 'entity', id: 'legs', parent: 'taxonomy', x: TX + 180, y: 290, label: 'Legs and feet', props: 'shoe, sock, tights, ...', color: CATEGORY },
    { kind: 'entity', id: 'whole', parent: 'taxonomy', x: TX + 180, y: 400, label: 'Whole body', props: 'coat, dress, ...', color: CATEGORY },
    { kind: 'note', id: 'nosneaker', parent: 'taxonomy', x: TX + 20, y: 530, w: 360, title: 'There is no sneaker kind', text: 'A sneaker is a shoe with a name. A kind is as fine as the taxonomy goes.', color: CATEGORY },

    { kind: 'group', id: 'ontology', x: OX, y: 0, w: 420, h: H, title: '2 Ontology', sub: 'plus details, values, relations, rules', color: ATTRIBUTE },
    {
      kind: 'entity',
      id: 'shirt',
      parent: 'ontology',
      x: OX + 80,
      y: 130,
      label: 'shirt',
      props: 'a kind from the taxonomy',
      color: CATEGORY,
      handles: [{ id: 's-l1', side: 'l', at: 0.3, type: 'source' }],
    },
    { kind: 'entity', id: 'length', parent: 'ontology', x: OX + 200, y: 240, label: 'hasLength', props: 'sleeveless, three quarter, wrist-length, ...', color: ATTRIBUTE },
    { kind: 'entity', id: 'neckline', parent: 'ontology', x: OX + 200, y: 345, label: 'hasNecklineType', props: 'collarless, boat, cowl, ...', color: ATTRIBUTE },
    {
      kind: 'note',
      id: 'rule',
      parent: 'ontology',
      x: OX + 20,
      y: 440,
      w: 380,
      title: 'A rule',
      text: 'hasNecklineType applies to upper-body and whole-body garments only. A shoe has no neckline.',
      color: ATTRIBUTE,
    },
    { kind: 'note', id: 'words', parent: 'ontology', x: OX + 20, y: 530, w: 380, title: 'Why it matters', text: 'This is the fixed list of words the vision model has to use.', color: ATTRIBUTE },

    { kind: 'group', id: 'graph', x: GX, y: 0, w: 640, h: H, title: '3 Graph data', sub: "the brand's looks as nodes and edges in those words", color: LOOK },
    { kind: 'entity', id: 'look', parent: 'graph', x: GX + 210, y: 60, label: 'Look', props: 'Smart casual look', color: LOOK },
    { kind: 'entity', id: 'occasion', parent: 'graph', x: GX + 440, y: 60, label: 'Occasion', props: 'Smart casual', color: OCCASION },
    { kind: 'entity', id: 'item1', parent: 'graph', x: GX + 105, y: 190, label: 'Item', props: 'White linen shirt', color: ITEM },
    { kind: 'entity', id: 'item2', parent: 'graph', x: GX + 325, y: 190, label: 'Item', props: 'Indigo denim pants', color: ITEM },
    { kind: 'entity', id: 'cat1', parent: 'graph', x: GX + 10, y: 320, label: 'Category', props: 'shirt', color: CATEGORY },
    { kind: 'entity', id: 'cat2', parent: 'graph', x: GX + 440, y: 320, label: 'Category', props: 'pants', color: CATEGORY },
    { kind: 'entity', id: 'attr', parent: 'graph', x: GX + 215, y: 450, label: 'Attribute', props: 'textile pattern: plain', color: ATTRIBUTE },
    { kind: 'note', id: 'built', parent: 'graph', x: GX + 20, y: 560, w: 600, title: 'What tabs 2 and 3 build and show', text: 'Two looks with the same kind of garment meet at the same Category node.', color: LOOK },
  ],
  edges: [
    { id: 'sub1', from: 'apparel', fromHandle: 's-b', to: 'upper', toHandle: 't-l', kind: 'data' },
    { id: 'sub2', from: 'apparel', fromHandle: 's-b', to: 'legs', toHandle: 't-l', kind: 'data' },
    { id: 'sub3', from: 'apparel', fromHandle: 's-b', to: 'whole', toHandle: 't-l', kind: 'data', label: 'is a kind of', labelDx: -30, labelDy: -110 },

    { id: 'pairs', from: 'shirt', fromHandle: 's-l1', to: 'shirt', toHandle: 't-t1', kind: 'data', label: 'pairsWith', color: CATEGORY, labelDx: -30, labelDy: -14 },
    { id: 'd1', from: 'shirt', fromHandle: 's-b', to: 'length', toHandle: 't-l', kind: 'data' },
    { id: 'd2', from: 'shirt', fromHandle: 's-b', to: 'neckline', toHandle: 't-l', kind: 'data' },

    { id: 'for', from: 'look', fromHandle: 's-r', to: 'occasion', toHandle: 't-l', kind: 'data', label: 'FOR', labelDy: -42 },
    { id: 'c1', from: 'look', fromHandle: 's-b1', to: 'item1', toHandle: 't-t2', kind: 'data', label: 'CONTAINS', labelDx: -60 },
    { id: 'c2', from: 'look', fromHandle: 's-b2', to: 'item2', toHandle: 't-t1', kind: 'data' },
    { id: 'ic1', from: 'item1', fromHandle: 's-b1', to: 'cat1', toHandle: 't-t2', kind: 'data', label: 'IS_CATEGORY', labelDx: -70 },
    { id: 'ic2', from: 'item2', fromHandle: 's-b2', to: 'cat2', toHandle: 't-t1', kind: 'data', label: 'IS_CATEGORY', labelDx: 70 },
    { id: 'ha1', from: 'item1', fromHandle: 's-b2', to: 'attr', toHandle: 't-t1', kind: 'data', label: 'HAS_ATTRIBUTE', labelDx: 50, labelDy: 10 },
    { id: 'ha2', from: 'item2', fromHandle: 's-b1', to: 'attr', toHandle: 't-t2', kind: 'data' },
  ],
  legend: [],
};
