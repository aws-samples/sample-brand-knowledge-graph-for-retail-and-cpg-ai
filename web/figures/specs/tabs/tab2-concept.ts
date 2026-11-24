// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 2, the concept: one ingest flow for every kind of source. Photos, texts and photo-text pairs
 * go through the same four steps in AWS Step Functions, drawn as one column from top to bottom
 * (build the model's context, classify, validate against the ontology, write), and land in Amazon
 * Neptune Analytics as graph data next to one embedding per garment, so a similarity search and a
 * graph walk use the same store.
 */
const LOOK = '#ff9900';
const ITEM = '#8a9ba8';
const OCCASION = '#7b3fb0';
const OTHER = '#69717b';
const SFN = '#e7157b';
const NEPTUNE = '#8c4fff';
const EMBED = '#2f6fb0';

const SRC = { x: 0, y: 0, w: 240, h: 330 };
const NOTE_W = 200;
// The four steps in one column; the rendered heights (measured) place the next step 40 px under
// the one before, so the arrows between them are short and vertical.
const STEP_W = 300;
const STEP_H = [84, 66, 102, 84];
const STEP_GAP = 40;
// The zone is wider than its column so that its title fits on one line.
const ZONE = { x: 410, y: 0, w: STEP_W + 120, h: 0 };
const COL = ZONE.x + 60;
const ROWS = STEP_H.map((_, i) => ZONE.y + 50 + STEP_H.slice(0, i).reduce((a, b) => a + b + STEP_GAP, 0));
ZONE.h = ROWS[3] + STEP_H[3] + 20 - ZONE.y;
const STEP1_CY = ROWS[0] + STEP_H[0] / 2;
const STEP4_CY = ROWS[3] + STEP_H[3] / 2;
// The Neptune group sits low enough that step 4's arrow enters it on a straight line.
const NEP = { x: 1040, y: 60, w: 660, h: 460 };
const GD = { x: NEP.x + 20, y: NEP.y + 50, w: 360, h: 390 };
const EM = { x: GD.x + GD.w + 20, y: NEP.y + 50, w: 240, h: 390 };

export const tab2Concept: FigureSpec = {
  width: 1700,
  height: 640,
  large: true,
  nodes: [
    { kind: 'group', id: 'sources', x: SRC.x, y: SRC.y, w: SRC.w, h: SRC.h, title: 'Unstructured sources', color: OTHER, handles: [{ id: 's-r1', side: 'r', at: (STEP1_CY - SRC.y) / SRC.h, type: 'source' }] },
    { kind: 'note', id: 'photos', parent: 'sources', x: SRC.x + 20, y: SRC.y + 55, w: NOTE_W, title: 'Photos', text: 'a shoot', color: OTHER },
    { kind: 'note', id: 'texts', parent: 'sources', x: SRC.x + 20, y: SRC.y + 150, w: NOTE_W, title: 'Texts', text: 'articles, a style guide', color: OTHER },
    { kind: 'note', id: 'pair', parent: 'sources', x: SRC.x + 20, y: SRC.y + 245, w: NOTE_W, title: 'A photo with its text', text: 'the two together', color: OTHER },

    { kind: 'zone', id: 'flow', x: ZONE.x, y: ZONE.y, w: ZONE.w, h: ZONE.h, title: 'The ingest flow (AWS Step Functions)', tone: 'sfn' },
    { kind: 'note', id: 'step1', parent: 'flow', x: COL, y: ROWS[0], w: STEP_W, title: "1 Build the model's context", text: "The ontology, the brand's lines and occasions, and the paired text or photo.", color: SFN },
    { kind: 'note', id: 'step2', parent: 'flow', x: COL, y: ROWS[1], w: STEP_W, title: '2 Classify with a multimodal model', text: 'The same call as tab 1, once per source.', color: SFN },
    { kind: 'note', id: 'step3', parent: 'flow', x: COL, y: ROWS[2], w: STEP_W, title: '3 Validate against the ontology', text: 'Only kinds, values and parts the ontology has become graph data; the rest is reported.', color: SFN },
    { kind: 'note', id: 'step4', parent: 'flow', x: COL, y: ROWS[3], w: STEP_W, title: '4 Write graph data and the sources', text: 'Each look, its garments, its occasion, and a link to the photo or text it came from.', color: SFN },

    { kind: 'group', id: 'neptune', x: NEP.x, y: NEP.y, w: NEP.w, h: NEP.h, title: 'Amazon Neptune Analytics', icon: 'neptune', color: NEPTUNE, dashed: false, handles: [{ id: 't-l1', side: 'l', at: (STEP4_CY - NEP.y) / NEP.h, type: 'target' }] },
    { kind: 'group', id: 'graphdata', parent: 'neptune', x: GD.x, y: GD.y, w: GD.w, h: GD.h, title: 'Graph data', color: LOOK },
    { kind: 'entity', id: 'look', parent: 'graphdata', x: GD.x + 20, y: GD.y + 55, label: 'Look', props: 'the photo', color: LOOK },
    { kind: 'entity', id: 'item', parent: 'graphdata', x: GD.x + 20, y: GD.y + 180, label: 'Item', props: 'a garment in the look', color: ITEM },
    { kind: 'entity', id: 'occasion', parent: 'graphdata', x: GD.x + 140, y: GD.y + 300, label: 'Occasion', props: 'Casual', color: OCCASION },
    { kind: 'group', id: 'embeddings', parent: 'neptune', x: EM.x, y: EM.y, w: EM.w, h: EM.h, title: 'Embeddings', sub: 'one vector per garment', color: EMBED },
    { kind: 'entity', id: 'vec1', parent: 'embeddings', x: EM.x + 20, y: EM.y + 75, label: 'Item', props: 'white lace-up sneakers', color: ITEM, vec: true },
    { kind: 'entity', id: 'vec2', parent: 'embeddings', x: EM.x + 20, y: EM.y + 175, label: 'Item', props: 'indigo denim pants', color: ITEM, vec: true },
    { kind: 'entity', id: 'vec3', parent: 'embeddings', x: EM.x + 20, y: EM.y + 275, label: 'Item', props: 'navy wool blazer', color: ITEM, vec: true },

    {
      kind: 'note',
      id: 'together',
      x: NEP.x,
      y: NEP.y + NEP.h + 25,
      w: NEP.w,
      title: 'One store for both',
      text: 'Graph data and embeddings sit side by side in one graph, so a similarity search and a graph walk use the same store.',
      color: NEPTUNE,
    },
  ],
  edges: [
    { id: 'in', from: 'sources', fromHandle: 's-r1', to: 'step1', toHandle: 't-l', kind: 'data', label: 'one flow for\nevery kind of source', labelDx: -6 },
    { id: 's12', from: 'step1', fromHandle: 's-b', to: 'step2', toHandle: 't-t', kind: 'data' },
    { id: 's23', from: 'step2', fromHandle: 's-b', to: 'step3', toHandle: 't-t', kind: 'data' },
    { id: 's34', from: 'step3', fromHandle: 's-b', to: 'step4', toHandle: 't-t', kind: 'data' },
    { id: 'out', from: 'step4', fromHandle: 's-r', to: 'neptune', toHandle: 't-l1', kind: 'data', label: 'graph data plus\nthe source links' },

    { id: 'contains', from: 'look', fromHandle: 's-b', to: 'item', toHandle: 't-t', kind: 'data', label: 'CONTAINS' },
    { id: 'for', from: 'look', fromHandle: 's-r', to: 'occasion', toHandle: 't-t', kind: 'data', label: 'FOR', labelDx: 16, labelDy: 40 },
  ],
  legend: [{ kind: 'data', text: 'what each step hands on' }],
};
