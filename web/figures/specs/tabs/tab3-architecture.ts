// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { FigureSpec } from '../../kit';

/**
 * Tab 3, how a query runs (web/src/components/query/QueryArchitecture.tsx,
 * backend/src/ontology_rag/api.py graph_query, agent_runtime.py). The badges are the six steps
 * of the guide's walk-through: 1 run as openCypher, 2 invoke the agent, 3 the Neptune MCP server,
 * 4 plan with the MCP tools, 5 validate and execute (the server, then Neptune), 6 the result.
 */
const ACR = { x: 330, y: 280, w: 920, h: 190 };
const API_X = 360;
const R0 = 80;
const W = 270;

export const tab3Architecture: FigureSpec = {
  width: 1600,
  height: 720,
  large: true,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: 0, y: R0, title: 'Browser', sub: 'tab 3: a query or a question', muted: true },
    { kind: 'tile', id: 'api', icon: 'lambda', x: API_X, y: R0, title: 'AWS Lambda', sub: 'the API: query, then invoke', steps: [6] },
    { kind: 'tile', id: 'neptune', icon: 'neptune', x: 1330, y: R0, title: 'Neptune Analytics', sub: 'the graph, read-only openCypher', steps: [1, 5] },

    {
      kind: 'group',
      id: 'acr',
      x: ACR.x,
      y: ACR.y,
      w: ACR.w,
      h: ACR.h,
      title: 'Amazon Bedrock AgentCore Runtime',
      sub: 'one session and one microVM per browser tab',
      icon: 'agentcore',
      color: '#01a88d',
      handles: [{ id: 't-t1', side: 't', at: (API_X + W / 2 - ACR.x) / ACR.w, type: 'target' }],
    },
    { kind: 'tile', id: 'agent', parent: 'acr', icon: 'agentcore', x: 380, y: 350, title: 'The query agent', sub: 'a Converse tool loop', steps: [2] },
    { kind: 'tile', id: 'mcp', parent: 'acr', icon: 'mcp', x: 940, y: 350, title: 'Neptune MCP server', sub: 'stdio subprocess, read-only guard', steps: [3, 5] },

    { kind: 'tile', id: 'bedrock', icon: 'bedrock', x: 380, y: 560, title: 'Amazon Bedrock', sub: 'Converse, tools as toolConfig', steps: [4] },
  ],
  edges: [
    { id: 'text', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'the text' },
    { id: 'result', from: 'api', fromHandle: 's-t', to: 'browser', toHandle: 't-t', kind: 'data', label: 'the last query, its rows, two or three sentences', offset: 40 },
    { id: 'execute', from: 'api', fromHandle: 's-r', to: 'neptune', toHandle: 't-l', kind: 'data', label: 'ExecuteQuery: your text as openCypher' },
    { id: 'invoke', from: 'api', fromHandle: 's-b', to: 'acr', toHandle: 't-t1', kind: 'control', label: "InvokeAgentRuntime: the text and Neptune's error", labelDx: 230 },
    { id: 'tools', from: 'agent', fromHandle: 's-r', to: 'mcp', toHandle: 't-l', kind: 'data', label: 'list tools, schema, queries' },
    { id: 'plan', from: 'agent', fromHandle: 's-b', to: 'bedrock', toHandle: 't-t', kind: 'data', label: 'Converse: text, error, schema, worked examples', labelDx: 260, labelDy: 20 },
    { id: 'cypher', from: 'mcp', fromHandle: 's-r', to: 'neptune', toHandle: 't-b', kind: 'data', label: 'openCypher, read-only', labelDy: 0 },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'control', text: 'a call that starts work' },
    { kind: 'step', text: '1 to 6: the steps under the figure' },
  ],
};
