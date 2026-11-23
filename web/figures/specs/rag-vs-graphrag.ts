// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../kit';

/**
 * Tabs 4 and 5: the question on the left, the answer on the right, and two swim lanes between them.
 * RAG (red, top) lets the answer model plan 3 to 6 catalog searches from the question. GraphRAG
 * (blue, bottom) embeds the question, finds three of the brand's looks in Neptune Analytics and
 * searches the catalog once per piece of those looks. Both lanes end in the same two shared tiles:
 * the product catalog in Amazon S3 Vectors and the answer prompt on Amazon Bedrock. GraphRAG's
 * answer also gets the looks, their occasions and what is worn together
 * (backend/src/ontology_rag/payoff.py).
 */
const RAG = '#c0392b';
const GRAPH = '#2f6fb0';
const ANSWER = '#232f3e';

const TILE_W = 270;
// A tile whose sub wraps to two lines, and a note of the width below with its three-line text.
const TILE_H = 83;
const NOTE_H = 120;
// The lanes: the same x, width and height; the RAG lane at the top, the GraphRAG lane at the bottom,
// a gap of ROW_GAP between each lane and the middle row, and room for the legend under the lower lane.
const LANE = { x: 160, w: 650, h: 160, pad: 20, tileY: 55 };
const ROW_GAP = 120;
const RAG_LANE_Y = 0;
const MID = LANE.h + ROW_GAP + TILE_H / 2;
const GRAPH_LANE_Y = MID + TILE_H / 2 + ROW_GAP;
const HEIGHT = GRAPH_LANE_Y + LANE.h + 60;
const LANE_RIGHT = LANE.x + LANE.w;
// Where the two edges into S3 Vectors turn: between the lanes' right border and the S3 Vectors tile.
const TURN_X = LANE_RIGHT + 28;
const CATALOG_X = TURN_X + 27;
const ANSWER_X = CATALOG_X + TILE_W + 78;
const NOTE_X = ANSWER_X + TILE_W + 95;
const NOTE_W = 1800 - NOTE_X;

export const ragVsGraphrag: FigureSpec = {
  width: 1800,
  height: HEIGHT,
  large: true,
  nodes: [
    { kind: 'tile', id: 'question', icon: 'browser', x: 0, y: MID - TILE_H / 2, title: 'Question', sub: 'or a photo of one piece' },

    { kind: 'group', id: 'rag', x: LANE.x, y: RAG_LANE_Y, w: LANE.w, h: LANE.h, title: 'RAG', sub: "the model's own taste", color: RAG, fill: `${RAG}14` },
    { kind: 'tile', id: 'planner', parent: 'rag', icon: 'bedrock', x: LANE.x + LANE.pad, y: RAG_LANE_Y + LANE.tileY, title: 'Amazon Bedrock', sub: 'plans 3 to 6 catalog searches' },

    { kind: 'group', id: 'graphrag', x: LANE.x, y: GRAPH_LANE_Y, w: LANE.w, h: LANE.h, title: 'GraphRAG', sub: "the brand's looks", color: GRAPH, fill: `${GRAPH}14` },
    { kind: 'tile', id: 'embed', parent: 'graphrag', icon: 'bedrock', x: LANE.x + LANE.pad, y: GRAPH_LANE_Y + LANE.tileY, title: 'Amazon Bedrock', sub: 'Nova embeds the question' },
    {
      kind: 'tile',
      id: 'neptune',
      parent: 'graphrag',
      icon: 'neptune',
      x: LANE_RIGHT - LANE.pad - TILE_W,
      y: GRAPH_LANE_Y + LANE.tileY,
      title: 'Neptune Analytics',
      sub: 'finds three looks, then walks to their pieces',
      handles: [{ id: 's-r2', side: 'r', at: 0.75, type: 'source' }],
    },

    {
      kind: 'tile',
      id: 'catalog',
      icon: 's3vectors',
      x: CATALOG_X,
      y: MID - TILE_H / 2,
      title: 'Amazon S3 Vectors',
      sub: 'the product catalog, one search for both',
      handles: [
        { id: 't-l1', side: 'l', at: 0.3, type: 'target' },
        { id: 't-l2', side: 'l', at: 0.7, type: 'target' },
      ],
    },
    { kind: 'tile', id: 'answer', icon: 'bedrock', x: ANSWER_X, y: MID - TILE_H / 2, title: 'Amazon Bedrock', sub: 'one prompt for both, cites evidence' },
    { kind: 'note', id: 'result', x: NOTE_X, y: MID - NOTE_H / 2, w: NOTE_W, title: 'The answer', text: "RAG: products the model chose. GraphRAG: the brand's own pairings, each with the look it came from.", color: ANSWER },
  ],
  edges: [
    { id: 'q-rag', from: 'question', fromHandle: 's-t', to: 'planner', toHandle: 't-l', kind: 'data', color: RAG, label: 'the question', labelDx: -59, labelDy: 10 },
    { id: 'q-graph', from: 'question', fromHandle: 's-b', to: 'embed', toHandle: 't-l', kind: 'data', color: GRAPH, label: 'the question', labelDx: -59, labelDy: -10 },
    { id: 'searches', from: 'planner', fromHandle: 's-r', to: 'catalog', toHandle: 't-l1', kind: 'data', color: RAG, label: 'its searches, 3 products each', centerX: TURN_X, labelDx: 122, labelDy: 19 },
    { id: 'vector', from: 'embed', fromHandle: 's-r', to: 'neptune', toHandle: 't-l', kind: 'data', color: GRAPH, label: 'a vector' },
    { id: 'pieces', from: 'neptune', fromHandle: 's-r', to: 'catalog', toHandle: 't-l2', kind: 'data', color: GRAPH, label: "the three looks' pieces, 1 product each", centerX: TURN_X, labelDx: 157, labelDy: -36 },
    { id: 'products', from: 'catalog', fromHandle: 's-r', to: 'answer', toHandle: 't-l', kind: 'data', label: 'products' },
    { id: 'patterns', from: 'neptune', fromHandle: 's-r2', to: 'answer', toHandle: 't-b', kind: 'data', color: GRAPH, label: 'the looks, their occasions, what is worn together', labelDy: -17 },
    { id: 'final', from: 'answer', fromHandle: 's-r', to: 'result', toHandle: 't-l', kind: 'data', label: 'the answer' },
  ],
  legend: [
    { kind: 'data', text: 'the RAG path', color: RAG },
    { kind: 'data', text: 'the GraphRAG path', color: GRAPH },
    { kind: 'data', text: 'shared by both' },
  ],
};
