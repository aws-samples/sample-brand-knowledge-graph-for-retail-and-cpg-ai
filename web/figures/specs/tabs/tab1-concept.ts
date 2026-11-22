// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 1, the concept: one ontology file, three jobs. The file is the vision model's instructions
 * (the system prompt), the check every answer goes through, and the vocabulary the graph's nodes
 * link to. The check sends proposals back: terms the ontology lacks, so the ontology grows.
 */
const CATEGORY = '#2f6fb0';
const OCCASION = '#7b3fb0';
const ATTRIBUTE = '#2e9e6b';
const PROMPT = '#8c4fff';
const CHECK = '#c0392b';
const FILE = '#232f3e';

const GX = 520;
const GW = 880;

export const tab1Concept: FigureSpec = {
  width: 1400,
  height: 640,
  large: true,
  nodes: [
    {
      kind: 'note',
      id: 'file',
      x: 0,
      y: 230,
      w: 380,
      title: 'fashion.ttl, the ontology',
      text: '64 garment kinds, 11 attribute families with 81 values, 9 occasions. One OWL file, the same for every tab.',
      color: FILE,
    },

    { kind: 'group', id: 'prompt', x: GX, y: 0, w: GW, h: 160, title: "Job 1: the model's instructions", sub: 'the system prompt of every classify call', color: PROMPT },
    { kind: 'note', id: 'prompt-note', parent: 'prompt', x: GX + 30, y: 55, w: GW - 60, title: 'Describe the photo with these terms only', text: 'The kinds, their parts and the allowed values go into the prompt as a list. The model picks from the list.', color: PROMPT },

    {
      kind: 'group',
      id: 'check',
      x: GX,
      y: 200,
      w: GW,
      h: 180,
      title: 'Job 2: the check',
      sub: 'after every answer',
      color: CHECK,
      handles: [{ id: 's-l1', side: 'l', at: 0.78, type: 'source' }],
    },
    {
      kind: 'note',
      id: 'check-note',
      parent: 'check',
      x: GX + 30,
      y: 255,
      w: GW - 60,
      title: 'Every kind, value and part is looked up in the ontology',
      text: 'Anything not in it is reported as what the ontology could not express, next to the answer.',
      color: CHECK,
    },

    { kind: 'group', id: 'vocab', x: GX, y: 420, w: GW, h: 170, title: "Job 3: the graph's vocabulary", sub: "tab 2's nodes link to these", color: CATEGORY },
    { kind: 'entity', id: 'category', parent: 'vocab', x: GX + 60, y: 490, label: 'Category', props: 'shirt, coat, shoe, collar, ...', color: CATEGORY },
    { kind: 'entity', id: 'attribute', parent: 'vocab', x: GX + 340, y: 490, label: 'Attribute', props: 'length: sleeveless, ...', color: ATTRIBUTE },
    { kind: 'entity', id: 'occasion', parent: 'vocab', x: GX + 620, y: 490, label: 'Occasion', props: 'Casual, Evening, ... (9)', color: OCCASION },
  ],
  edges: [
    { id: 'to-prompt', from: 'file', fromHandle: 's-r', to: 'prompt', toHandle: 't-l', kind: 'data', label: 'the terms, as text', labelDx: -115, labelDy: -30 },
    { id: 'to-check', from: 'file', fromHandle: 's-r', to: 'check', toHandle: 't-l', kind: 'data' },
    { id: 'to-vocab', from: 'file', fromHandle: 's-r', to: 'vocab', toHandle: 't-l', kind: 'data', label: 'the terms, as nodes', labelDx: -115, labelDy: 30 },
    { id: 'proposals', from: 'check', fromHandle: 's-l1', to: 'file', toHandle: 't-b', kind: 'control', label: 'proposals: terms the ontology lacks', centerX: 440, labelDx: -60, labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'what the file gives' },
    { kind: 'control', text: 'what comes back, so the ontology grows' },
  ],
};
