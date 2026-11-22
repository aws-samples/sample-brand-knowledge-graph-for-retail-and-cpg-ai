// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 6, how the trends question's three methods are built (backend/src/ontology_rag/trends.py,
 * lenses.py, agents/; web/src/components/lenses/TrendsArchitecture.tsx and
 * TrendsAgentsArchitecture.tsx). The badges are the six steps of the guide's walk-through: 1 new
 * items against the lookbook, 2 the graph agent, 3 the export to Iceberg tables, 4 the data agent,
 * 5 the vector map, 6 describe a cloud. Amazon Bedrock appears twice: the agents' models, and the
 * model that describes a cloud for the API.
 */
const C0 = 0;
const C1 = 370;
const GROUP = { x: 690, y: 0, w: 700, h: 360 };
const A1 = 710;
const A2 = 1060;
const C4 = 1430;
const RA = 120;
const RM = 250;
const RS = 400;
const RAPI = 260;

export const tab6Architecture: FigureSpec = {
  width: 1700,
  height: 650,
  large: true,
  nodes: [
    {
      kind: 'tile',
      id: 'browser',
      icon: 'browser',
      x: C0,
      y: RAPI,
      title: 'Browser',
      sub: 'tab 6: the questions, the vector map',
      steps: [5],
      handles: [{ id: 't-r2', side: 'r', at: 0.8, type: 'target' }],
    },
    {
      kind: 'tile',
      id: 'api',
      icon: 'lambda',
      x: C1,
      y: RAPI,
      title: 'AWS Lambda',
      sub: 'the API: queries, the export, the agents',
      steps: [3],
      handles: [{ id: 's-l2', side: 'l', at: 0.8, type: 'source' }],
    },

    {
      kind: 'group',
      id: 'agentcore',
      x: GROUP.x,
      y: GROUP.y,
      w: GROUP.w,
      h: GROUP.h,
      title: 'Amazon Bedrock AgentCore Runtime',
      icon: 'agentcore',
      color: '#01a88d',
      handles: [{ id: 't-l1', side: 'l', at: 100 / GROUP.h, type: 'target' }],
    },
    { kind: 'tile', id: 'graph-agent', parent: 'agentcore', icon: 'agentcore', x: A2, y: RA, title: 'Graph agent', sub: 'method 1: openCypher, counts', steps: [2] },
    { kind: 'tile', id: 'graph-mcp', parent: 'agentcore', icon: 'mcp', x: A2, y: RM, title: 'Neptune MCP server', sub: 'read-only, on stdio', steps: [2] },
    {
      kind: 'tile',
      id: 'data-agent',
      parent: 'agentcore',
      icon: 'agentcore',
      x: A1,
      y: RA,
      title: 'Data agent',
      sub: 'method 2: SQL over the tables',
      steps: [4],
    },
    { kind: 'tile', id: 'data-mcp', parent: 'agentcore', icon: 'mcp', x: A1, y: RM, title: 'S3 Tables MCP server', sub: 'read-only, on stdio', steps: [4] },

    { kind: 'tile', id: 'models', icon: 'bedrock', x: C4, y: RA, title: 'Amazon Bedrock', sub: 'the agents\' models, Converse with tools', steps: [2, 4] },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: A2, y: RS, title: 'Neptune Analytics', sub: 'the graph, with every garment\'s vector', steps: [1, 5] },
    { kind: 'tile', id: 'tables', icon: 's3tables', x: A1, y: RS, title: 'Amazon S3 Tables', sub: 'two Apache Iceberg tables', steps: [3, 4] },
    { kind: 'tile', id: 'describe', icon: 'bedrock', x: C4, y: RS, title: 'Amazon Bedrock', sub: 'describes a cloud of garments', steps: [6] },
  ],
  edges: [
    { id: 'request', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'ask, export, poll' },
    { id: 'result', from: 'api', fromHandle: 's-l2', to: 'browser', toHandle: 't-r2', kind: 'data', label: 'rows, answers,\nthe vectors (5)', labelDy: 36 },
    { id: 'invoke', from: 'api', fromHandle: 's-t', to: 'agentcore', toHandle: 't-l1', kind: 'control', label: 'InvokeAgentRuntime:\na question (2, 4),\nthe rows to write (3)', labelDx: -175, labelDy: 0 },
    { id: 'cypher', from: 'api', fromHandle: 's-b', to: 'neptune', toHandle: 't-b', kind: 'data', label: 'openCypher: items and values (1), the graph as rows (3), the vectors (5)', offset: 40, labelDx: -90 },
    { id: 'describe', from: 'api', fromHandle: 's-b2', to: 'describe', toHandle: 't-b', kind: 'data', label: 'Converse: describe a cloud (6)', offset: 80, labelDx: 420 },
    { id: 'stdio1', from: 'graph-agent', fromHandle: 's-b', to: 'graph-mcp', toHandle: 't-t', kind: 'control', label: 'stdio', labelDx: 50 },
    { id: 'stdio2', from: 'data-agent', fromHandle: 's-b', to: 'data-mcp', toHandle: 't-t', kind: 'control', label: 'stdio', labelDx: 50 },
    { id: 'model1', from: 'graph-agent', fromHandle: 's-r', to: 'models', toHandle: 't-l', kind: 'data', label: 'Converse,\nthe MCP tools (2)', labelDy: 34 },
    { id: 'model2', from: 'data-agent', fromHandle: 's-t', to: 'models', toHandle: 't-t', kind: 'data', label: 'Converse tool loop, the MCP tool (4)', offset: 50, labelDx: 300 },
    { id: 'write', from: 'data-agent', fromHandle: 's-l', to: 'tables', toHandle: 't-l', kind: 'data', label: 'PyIceberg (3)', offset: 40, labelDx: -20, labelDy: 120 },
    { id: 'read1', from: 'graph-mcp', fromHandle: 's-b', to: 'neptune', toHandle: 't-t', kind: 'data', label: 'openCypher, read-only (2)', labelDx: 0, labelDy: 0 },
    { id: 'read2', from: 'data-mcp', fromHandle: 's-b', to: 'tables', toHandle: 't-t', kind: 'data', label: 'SQL, read-only (4)', labelDx: 0, labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'control', text: 'a call that starts work' },
    { kind: 'step', text: '1 to 6: the steps under the figure' },
  ],
};
