// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec, NodeSpec } from '../../kit';

/**
 * Tab 6, the second concept: the three personas, their questions in the app's own words
 * (web/src/components/lenses/lenses.ts) and the technique from the earlier tabs that answers each
 * (backend/src/ontology_rag/lenses.py). Most questions are a count in the graph. "What should sit
 * next to this piece on the page?" and "Is this new photo on-brand?" find the nearest garments or
 * looks by embedding similarity, then walk the graph. The trends question is the clusters of the
 * first concept. Breaking photos down with the ontology built the graph that every question reads.
 */
const STEP = '#69717b';
const TECH = '#2f6fb0';

const GX = 0;
const GW = 720;
const QX = 25;
const QW = 600;
// A question note is one line high; the questions of a persona sit QSTEP px apart.
const QSTEP = 58;
const TX = 1100;
const TW = 480;

type Persona = { id: string; title: string; wants: string; y: number; questions: string[] };
const PERSONAS: Persona[] = [
  {
    id: 'buyer',
    title: 'The buyer',
    wants: 'What should we buy, and what are we buying that nobody styles?',
    y: 0,
    questions: ['What do our stylists use that we don’t sell?', 'Which products did no stylist ever style?', 'What does each occasion lean on?'],
  },
  {
    id: 'merch',
    title: 'The merchandiser',
    wants: 'Which pieces carry the brand, and what belongs next to what?',
    y: 270,
    questions: ['Which pieces hold the most looks together?', 'Which pairings are the brand’s signature?', 'What should sit next to this piece on the page?'],
  },
  {
    id: 'creative',
    title: 'The creative director',
    wants: 'What is our style, in numbers, and does this new work fit it?',
    y: 540,
    questions: ['Is this new photo on-brand?', 'What are the emerging trends we see this season?', 'What is our style, per occasion?', 'Where is the lookbook thin?'],
  },
];

// The techniques, in the order of the tabs that teach them, and the vertical middle of each.
const TECHNIQUES = [
  { id: 'breakdown', title: 'Break a photo down with the ontology', text: 'Tabs 1 and 2. It built the graph that every question here reads.', mid: 60 },
  { id: 'count', title: 'Count and query the graph in openCypher', text: 'Tab 3', mid: 260 },
  { id: 'similar', title: 'Find the nearest nodes by embedding similarity', text: 'Tab 4', mid: 467 },
  { id: 'walk', title: 'Walk the graph for context and sources (GraphRAG)', text: 'Tabs 4 and 5', mid: 621 },
  { id: 'cluster', title: 'Cluster embeddings and read the clusters with the graph', text: 'Tab 6', mid: 760 },
];

// Which technique answers which question: [persona, question index, technique, x of the arrow's
// vertical leg]. The arrows into one technique share one vertical leg where they can. The two
// questions that use two techniques sit level with one each, so only one arrow of each bends.
const ANSWERS: [string, number, string, number?][] = [
  ['buyer', 0, 'count'],
  ['buyer', 1, 'count'],
  ['buyer', 2, 'count'],
  ['merch', 0, 'count'],
  ['merch', 1, 'count'],
  ['merch', 2, 'similar'],
  ['merch', 2, 'walk', 900],
  ['creative', 0, 'similar', 960],
  ['creative', 0, 'walk'],
  ['creative', 1, 'cluster'],
  ['creative', 2, 'count'],
  ['creative', 3, 'count'],
];
const BUS: Record<string, number> = { count: 820, similar: 880, walk: 940, cluster: 1030 };

const nodes: NodeSpec[] = [
  ...PERSONAS.flatMap((p): NodeSpec[] => [
    { kind: 'group', id: p.id, x: GX, y: p.y, w: GW, h: 55 + p.questions.length * QSTEP + 12, title: p.title, sub: p.wants, color: STEP },
    ...p.questions.map((q, i): NodeSpec => ({ kind: 'note', id: `${p.id}-${i}`, parent: p.id, x: QX, y: p.y + 55 + i * QSTEP, w: QW, title: q, text: '', color: STEP })),
  ]),
  ...TECHNIQUES.map((t): NodeSpec => ({ kind: 'note', id: t.id, x: TX, y: t.mid - 35, w: TW, title: t.title, text: t.text, color: TECH })),
];

export const tab6Personas: FigureSpec = {
  width: 1580,
  height: 900,
  large: true,
  nodes,
  edges: ANSWERS.map(([persona, i, tech, x]) => ({ id: `${persona}-${i}-${tech}`, from: `${persona}-${i}`, fromHandle: 's-r', to: tech, toHandle: 't-l', kind: 'data' as const, centerX: x ?? BUS[tech] })),
  legend: [{ kind: 'data', text: 'which technique answers the question' }],
};
