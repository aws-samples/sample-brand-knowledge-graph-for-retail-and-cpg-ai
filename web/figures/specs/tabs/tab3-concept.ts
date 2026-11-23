// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 3, the concept: an agent talks to the graph through an MCP server. You ask in plain words;
 * the query agent reads the schema through the Amazon Neptune MCP server's get_graph_schema tool,
 * writes openCypher, runs it with run_opencypher_query, and hands back the answer with the query
 * and the rows it was built from (backend/src/ontology_rag/query_agent.py).
 */
const OTHER = '#69717b';
const AGENT = '#01a88d';
const MCP = '#232f3e';
const QUERY = '#2f6fb0';

const YOU = { x: 0, y: 60, w: 270 };
const AG = { x: 390, y: 40, w: 360, h: 230 };
const SRV = { x: 930, y: 40, w: 380, h: 330 };
const NEP = { x: 1430, y: 140 };
const LANE_UP = 0.3;
const LANE_DOWN = 0.72;

export const tab3Concept: FigureSpec = {
  width: 1700,
  height: 460,
  large: true,
  nodes: [
    { kind: 'note', id: 'you', x: YOU.x, y: YOU.y, w: YOU.w, title: 'You ask in plain words', text: 'Which bags go with white sneakers?', color: OTHER },

    {
      kind: 'group',
      id: 'agent',
      x: AG.x,
      y: AG.y,
      w: AG.w,
      h: AG.h,
      title: 'Query agent',
      sub: 'a model that plans, calls tools and checks results',
      icon: 'agentcore',
      color: AGENT,
      handles: [
        { id: 't-l1', side: 'l', at: LANE_UP, type: 'target' },
        { id: 's-l2', side: 'l', at: LANE_DOWN, type: 'source' },
        { id: 's-r1', side: 'r', at: 0.32, type: 'source' },
        { id: 's-r2', side: 'r', at: 0.55, type: 'source' },
        { id: 't-r3', side: 'r', at: 0.84, type: 'target' },
      ],
    },
    {
      kind: 'note',
      id: 'cypher',
      x: AG.x,
      y: AG.y + AG.h + 30,
      w: 420,
      title: 'openCypher',
      text: "MATCH (l:Look)-[:CONTAINS]->(:Item)-[:IS_CATEGORY]->(:Category {name: 'shoe'}) RETURN l.name, count(*)",
      color: QUERY,
    },

    {
      kind: 'group',
      id: 'server',
      x: SRV.x,
      y: SRV.y,
      w: SRV.w,
      h: SRV.h,
      title: 'Amazon Neptune MCP server',
      icon: 'mcp',
      color: MCP,
      handles: [
        { id: 's-l3', side: 'l', at: 0.86, type: 'source' },
        { id: 's-r1', side: 'r', at: 0.38, type: 'source' },
        { id: 't-r2', side: 'r', at: 0.62, type: 'target' },
      ],
    },
    { kind: 'entity', id: 'schema', parent: 'server', x: SRV.x + 30, y: SRV.y + 60, label: 'get_graph_schema', props: 'describe the schema: node types, relations, properties', color: OTHER },
    { kind: 'entity', id: 'query', parent: 'server', x: SRV.x + 30, y: SRV.y + 190, label: 'run_opencypher_query', props: 'query the data', color: OTHER },

    { kind: 'tile', id: 'neptune', icon: 'neptune', x: NEP.x, y: NEP.y, title: 'Neptune Analytics', sub: 'the graph data', handles: [{ id: 't-l1', side: 'l', at: 0.3, type: 'target' }, { id: 's-l2', side: 'l', at: 0.72, type: 'source' }] },
  ],
  edges: [
    { id: 'question', from: 'you', fromHandle: 's-r', to: 'agent', toHandle: 't-l1', kind: 'data', label: 'the question', labelDy: -2 },
    { id: 'answer', from: 'agent', fromHandle: 's-l2', to: 'you', toHandle: 't-b', kind: 'data', label: 'the answer, the query\nand the rows', labelDy: -2 },
    { id: 'read-schema', from: 'agent', fromHandle: 's-r1', to: 'schema', toHandle: 't-l', kind: 'control', label: '1 read the schema', labelDy: -2 },
    { id: 'run-query', from: 'agent', fromHandle: 's-r2', to: 'query', toHandle: 't-l', kind: 'control', label: '2 write and run\nopenCypher', labelDy: -2 },
    { id: 'rows-back', from: 'server', fromHandle: 's-l3', to: 'agent', toHandle: 't-r3', kind: 'data', label: 'rows', labelDy: -2 },
    { id: 'to-graph', from: 'server', fromHandle: 's-r1', to: 'neptune', toHandle: 't-l1', kind: 'data', label: 'openCypher', labelDy: -2 },
    { id: 'rows', from: 'neptune', fromHandle: 's-l2', to: 'server', toHandle: 't-r2', kind: 'data', label: 'rows', labelDy: -2 },
  ],
  legend: [
    { kind: 'data', text: 'a question, a query, rows and the answer' },
    { kind: 'control', text: 'a tool call' },
  ],
};
