// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec, NodeSpec, EdgeSpec } from '../../kit';

/**
 * Tab 6, the second concept: who asks, what they want to do, and which technique of the earlier
 * tabs does it. Left, the three personas in the app's own words (web/src/components/lenses/lenses.ts).
 * Middle, their use cases as pills in the persona's colour: the app's questions condensed into
 * business words. Right, the four techniques in plain words with the tab that teaches each, and
 * under them the graph that tabs 1 and 2 built, which every technique reads. An arrow from a pill
 * to a technique means the sample answers that use case with it (backend/src/ontology_rag/lenses.py):
 * most use cases are counts in the graph; "what belongs next to a product" and "is this on-brand"
 * find the nearest garments or looks by embedding similarity, then walk the graph; the trends are
 * the clusters of the first concept, and the style in numbers is a count. Every arrow wears the
 * colour of its persona.
 */
const BUYER = '#2e9e6b';
const MERCH = '#e07b00';
const CREATIVE = '#7b3fb0';
const TECH = '#232f3e';

// The three columns: persons, their use cases, the techniques.
const AX = 0;
const AW = 300;
const UX = 400;
const UW = 450;
const TX = 1160;
const TW = 490;
// Where an arrow from a person to a use case turns.
const BEND_X = 350;

// Rendered heights (measured once; the notes and pills wrap their text), so that a node can be
// placed by its vertical middle and the straight arrows meet their handles at the same y.
const H = { actor: 164, plan: 88, feature: 111, place: 68, check: 68, read: 111, analytics: 84, alike: 66, pairings: 84, groups: 66 };
// The vertical middle of each person and each use case. Within a person 60 px between the pills,
// 80 px between persons.
const Y = { plan: 110, feature: 300, place: 450, check: 598, read: 748 };
const MID = { buyer: Y.plan, merch: (Y.feature + Y.place) / 2, creative: (Y.check + Y.read) / 2 };
// Source handles on a pill with two arrows out, target handles on a note with two arrows in, as
// fractions of the height. Two arrows run straight: the buyer's pill into the analytics note's
// first handle (20 %), and the placing pill's lower handle into the pairings note's first handle,
// so those notes' tops follow from the pills' middles.
const LOW = 0.65;
const UPPER = 0.3;
const LOWER = 0.7;
// The top of each technique note and of the wide note under them.
const TY = {
  analytics: Y.plan - 0.2 * H.analytics,
  alike: 310,
  pairings: Y.place - H.place / 2 + LOW * H.place - UPPER * H.pairings,
  groups: 592,
  graph: 716,
};
const top = (mid: number, h: number) => mid - h / 2;

const nodes: NodeSpec[] = [
  { kind: 'actor', id: 'buyer', x: AX, y: top(MID.buyer, H.actor), w: AW, label: 'The buyer', sub: 'What should we buy, and what are we buying that nobody styles?', color: BUYER },
  {
    kind: 'actor',
    id: 'merch',
    x: AX,
    y: top(MID.merch, H.actor),
    w: AW,
    label: 'The merchandiser',
    sub: 'Which pieces carry the brand, and what belongs next to what?',
    color: MERCH,
    handles: [
      { id: 's-r1', side: 'r', at: 0.42, type: 'source' },
      { id: 's-r2', side: 'r', at: 0.58, type: 'source' },
    ],
  },
  {
    kind: 'actor',
    id: 'creative',
    x: AX,
    y: top(MID.creative, H.actor),
    w: AW,
    label: 'The creative director',
    sub: 'What is our style, in numbers, and does this new work fit it?',
    color: CREATIVE,
    handles: [
      { id: 's-r1', side: 'r', at: 0.42, type: 'source' },
      { id: 's-r2', side: 'r', at: 0.58, type: 'source' },
    ],
  },

  { kind: 'bubble', id: 'plan', x: UX, y: top(Y.plan, H.plan), w: UW, text: "Plan next season's buy", sub: 'what the stylists use that we do not sell, what nobody styled, what each occasion leans on', color: BUYER },
  { kind: 'bubble', id: 'feature', x: UX, y: top(Y.feature, H.feature), w: UW, text: "Feature the brand's signature pieces and pairings", sub: 'which pieces hold the most looks together, which pairings are the signature', color: MERCH },
  {
    kind: 'bubble',
    id: 'place',
    x: UX,
    y: top(Y.place, H.place),
    w: UW,
    text: 'Place what belongs next to a product',
    sub: 'what should sit next to this piece on the page',
    color: MERCH,
    handles: [
      { id: 's-r1', side: 'r', at: 1 - LOW, type: 'source' },
      { id: 's-r2', side: 'r', at: LOW, type: 'source' },
    ],
  },
  {
    kind: 'bubble',
    id: 'check',
    x: UX,
    y: top(Y.check, H.check),
    w: UW,
    text: 'Check whether new work is on-brand',
    sub: 'is this new photo on-brand',
    color: CREATIVE,
    handles: [
      { id: 's-r1', side: 'r', at: 1 - LOW, type: 'source' },
      { id: 's-r2', side: 'r', at: LOW, type: 'source' },
    ],
  },
  {
    kind: 'bubble',
    id: 'read',
    x: UX,
    y: top(Y.read, H.read),
    w: UW,
    text: "Read the season's trends and the style in numbers",
    sub: 'what is emerging, what is our style per occasion, where the lookbook is thin',
    color: CREATIVE,
    handles: [
      { id: 's-r1', side: 'r', at: 1 - LOW, type: 'source' },
      { id: 's-r2', side: 'r', at: LOW, type: 'source' },
    ],
  },

  {
    kind: 'note',
    id: 'analytics',
    x: TX,
    y: TY.analytics,
    w: TW,
    title: 'Run analytics on the graph data',
    text: 'Tab 3. Counts and comparisons in openCypher, every answer with its rows.',
    color: TECH,
    handles: [
      { id: 't-l1', side: 'l', at: 0.2, type: 'target' },
      { id: 't-l2', side: 'l', at: 0.5, type: 'target' },
      { id: 't-l3', side: 'l', at: 0.8, type: 'target' },
    ],
  },
  {
    kind: 'note',
    id: 'alike',
    x: TX,
    y: TY.alike,
    w: TW,
    title: 'Find what looks or reads alike',
    text: 'Tab 4. Embedding similarity over the garments and looks.',
    color: TECH,
    handles: [
      { id: 't-l1', side: 'l', at: UPPER, type: 'target' },
      { id: 't-l2', side: 'l', at: LOWER, type: 'target' },
    ],
  },
  {
    kind: 'note',
    id: 'pairings',
    x: TX,
    y: TY.pairings,
    w: TW,
    title: "Follow the brand's own pairings and show their sources",
    text: 'Tabs 4 and 5. The graph walk behind GraphRAG; every suggestion names its look.',
    color: TECH,
    handles: [
      { id: 't-l1', side: 'l', at: UPPER, type: 'target' },
      { id: 't-l2', side: 'l', at: LOWER, type: 'target' },
    ],
  },
  { kind: 'note', id: 'groups', x: TX, y: TY.groups, w: TW, title: 'Group what is alike and explain the groups with the graph', text: 'Tab 6. Clusters of embeddings, read with the graph data.', color: TECH },
  { kind: 'note', id: 'graph', x: TX, y: TY.graph, w: TW, title: 'Where the graph comes from', text: 'All of it reads the graph that tabs 1 and 2 built by breaking every photo down with the ontology.', color: TECH },
];

// Person to use case: one straight arrow, or two that bend as mirror images.
const asks: EdgeSpec[] = [
  { id: 'buyer-plan', from: 'buyer', fromHandle: 's-r', to: 'plan', toHandle: 't-l', kind: 'data', color: BUYER },
  { id: 'merch-feature', from: 'merch', fromHandle: 's-r1', to: 'feature', toHandle: 't-l', kind: 'data', color: MERCH, centerX: BEND_X },
  { id: 'merch-place', from: 'merch', fromHandle: 's-r2', to: 'place', toHandle: 't-l', kind: 'data', color: MERCH, centerX: BEND_X },
  { id: 'creative-check', from: 'creative', fromHandle: 's-r1', to: 'check', toHandle: 't-l', kind: 'data', color: CREATIVE, centerX: BEND_X },
  { id: 'creative-read', from: 'creative', fromHandle: 's-r2', to: 'read', toHandle: 't-l', kind: 'data', color: CREATIVE, centerX: BEND_X },
];

// Use case to technique: every arrow has its own vertical leg (centerX) and its own target handle,
// so no two share a segment. The two straight ones need neither. The vertical legs run, left to
// right, in the order of the pills top to bottom, and the long arrow from the trends pill up to the
// analytics note is the second from the right: there it crosses only the last legs of four others,
// at right angles.
const uses: EdgeSpec[] = [
  { id: 'plan-analytics', from: 'plan', fromHandle: 's-r', to: 'analytics', toHandle: 't-l1', kind: 'data', color: BUYER },
  { id: 'feature-analytics', from: 'feature', fromHandle: 's-r', to: 'analytics', toHandle: 't-l2', kind: 'data', color: MERCH, centerX: 920 },
  { id: 'place-alike', from: 'place', fromHandle: 's-r1', to: 'alike', toHandle: 't-l1', kind: 'data', color: MERCH, centerX: 960 },
  { id: 'place-pairings', from: 'place', fromHandle: 's-r2', to: 'pairings', toHandle: 't-l1', kind: 'data', color: MERCH },
  { id: 'check-alike', from: 'check', fromHandle: 's-r1', to: 'alike', toHandle: 't-l2', kind: 'data', color: CREATIVE, centerX: 1000 },
  { id: 'check-pairings', from: 'check', fromHandle: 's-r2', to: 'pairings', toHandle: 't-l2', kind: 'data', color: CREATIVE, centerX: 1040 },
  { id: 'read-analytics', from: 'read', fromHandle: 's-r1', to: 'analytics', toHandle: 't-l3', kind: 'data', color: CREATIVE, centerX: 1080 },
  { id: 'read-groups', from: 'read', fromHandle: 's-r2', to: 'groups', toHandle: 't-l', kind: 'data', color: CREATIVE, centerX: 1120 },
];

export const tab6Personas: FigureSpec = {
  width: 1660,
  height: 850,
  large: true,
  nodes,
  edges: [...asks, ...uses],
  legend: [
    { kind: 'data', text: 'the buyer', color: BUYER },
    { kind: 'data', text: 'the merchandiser', color: MERCH },
    { kind: 'data', text: 'the creative director', color: CREATIVE },
  ],
};
