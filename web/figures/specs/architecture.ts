// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { TILE, type FigureSpec } from '../kit';

/**
 * The deployed stack (infra/lib/multimodal-ai-knowledge-graph-stack.ts, agents.ts, auth.ts,
 * network.ts). Coordinates are absolute CSS pixels on a grid: columns c0 to c3, rows r0 to r3.
 * Large type (the workshop guide shows it about 1,000 px wide): tiles W wide, muted ones WM.
 */
const W = TILE.large.width;
const WM = TILE.large.muted;
const c0 = 110;
const c1 = 450;
const c2 = 810;
const c3 = 1300;
const r0 = 290;
const r1 = 490;
const r2 = 690;
const r3 = 880;
/** A large tile's height with a two-line subtitle (measured): the VPC's right handles sit at the middle of Bedrock's and the data bucket's tiles. */
const H = 83;

export const architecture: FigureSpec = {
  width: 1600,
  height: 1030,
  large: true,
  nodes: [
    { kind: 'tile', id: 'browser', icon: 'browser', x: c0, y: 0, title: 'Browser', sub: 'the React app' },

    { kind: 'group', id: 'cloud', x: 60, y: 130, w: 1536, h: 860, title: 'AWS Cloud', icon: 'cloud', color: '#232f3e', dashed: false },
    { kind: 'tile', id: 'cognito', parent: 'cloud', icon: 'cognito', x: c0, y: r0, title: 'Amazon Cognito', sub: 'user pool, identity pool', steps: [1] },
    { kind: 'tile', id: 'cloudfront', parent: 'cloud', icon: 'cloudfront', x: c0, y: r1, title: 'Amazon CloudFront', sub: 'serves the site', steps: [2] },
    { kind: 'tile', id: 'site', parent: 'cloud', icon: 's3', x: c0, y: r2, title: 'Amazon S3', sub: 'site bucket: web/dist' },
    { kind: 'tile', id: 'deploy', parent: 'cloud', icon: 'lambda', x: c0 + 15, y: r3, title: 'BucketDeployment', sub: 'copies site and ontologies/', muted: true, steps: [7] },

    {
      kind: 'group',
      id: 'vpc',
      parent: 'cloud',
      x: 410,
      y: 170,
      w: 740,
      h: 650,
      title: 'VPC',
      sub: 'two private subnets, no public subnet',
      icon: 'vpc',
      color: '#8c4fff',
      steps: [6],
      handles: [
        { id: 's-r1', side: 'r', at: (r1 + H / 2 - 170) / 650, type: 'source' },
        { id: 's-r2', side: 'r', at: (r2 + H / 2 - 170) / 650, type: 'source' },
      ],
    },
    {
      kind: 'group',
      id: 'agentcore',
      parent: 'vpc',
      x: 430,
      y: 240,
      w: 670,
      h: 150,
      title: 'AgentCore Runtime',
      icon: 'agentcore',
      color: '#01a88d',
      steps: [5],
      // under the API's top handle (its middle)
      handles: [{ id: 't-b0', side: 'b', at: (c1 + W / 2 - 430) / 670, type: 'target' }],
    },
    {
      kind: 'tile',
      id: 'lake',
      parent: 'agentcore',
      icon: 'agentcore',
      x: c1,
      y: r0,
      title: 'Lake agent',
      sub: 'S3 Tables MCP server',
      handles: [{ id: 's-t3', side: 't', at: 0.93, type: 'source' }],
    },
    { kind: 'tile', id: 'query', parent: 'agentcore', icon: 'agentcore', x: c2, y: r0, title: 'Query agent', sub: 'Neptune MCP server, read-only' },
    {
      kind: 'tile',
      id: 'api',
      parent: 'vpc',
      icon: 'lambda',
      x: c1,
      y: r1,
      title: 'AWS Lambda · API',
      sub: 'function URL, IAM auth',
      steps: [3],
      handles: [
        { id: 's-b0', side: 'b', at: 0.1, type: 'source' },
        { id: 's-b3', side: 'b', at: 0.7, type: 'source' },
      ],
    },
    {
      kind: 'tile',
      id: 'neptune',
      parent: 'vpc',
      icon: 'neptune',
      x: c2,
      y: r1,
      title: 'Neptune Analytics',
      sub: 'graph + vector index, private endpoint',
      handles: [{ id: 't-l2', side: 'l', at: 0.8, type: 'target' }],
    },
    { kind: 'tile', id: 'loader', parent: 'vpc', icon: 'lambda', x: c1 + 50, y: r2, title: 'GraphLoader', sub: 'loads the graph at deploy', muted: true, steps: [7] },
    {
      kind: 'group',
      id: 'sfn',
      parent: 'vpc',
      x: c2 - 20,
      y: r2 - 55,
      w: W + 40,
      h: 155,
      title: 'AWS Step Functions',
      icon: 'stepfunctions',
      color: '#e7157b',
      steps: [4],
    },
    { kind: 'tile', id: 'pipeline', parent: 'sfn', icon: 'lambda', x: c2, y: r2, title: 'Lambda · pipeline', sub: 'classify, ingest, summarize' },

    { kind: 'tile', id: 'tables', parent: 'cloud', icon: 's3tables', x: c3, y: r0, title: 'Amazon S3 Tables', sub: 'two Iceberg tables' },
    { kind: 'tile', id: 'bedrock', parent: 'cloud', icon: 'bedrock', x: c3, y: r1, title: 'Amazon Bedrock', sub: 'Converse, Nova embeddings' },
    { kind: 'tile', id: 'data', parent: 'cloud', icon: 's3', x: c3, y: r2, title: 'Amazon S3', sub: 'data bucket: ontologies, runs' },
    {
      kind: 'tile',
      id: 'vectors',
      parent: 'cloud',
      icon: 's3vectors',
      x: c1,
      y: r3,
      title: 'Amazon S3 Vectors',
      sub: 'index catalog: the products',
      handles: [
        { id: 't-t0', side: 't', at: 0.1, type: 'target' },
        // under the GraphLoader's bottom handle (its middle); the loader sits at c1 + 50
        { id: 't-t3', side: 't', at: (50 + WM / 2) / W, type: 'target' },
      ],
    },
    { kind: 'tile', id: 'authsetup', parent: 'cloud', icon: 'lambda', x: c3 + 15, y: r3, title: 'AuthSetup', sub: 'sets the sign-in password', muted: true, steps: [7] },
  ],
  edges: [
    { id: 'signin', from: 'browser', fromHandle: 's-b', to: 'cognito', toHandle: 't-t', kind: 'control', label: 'sign-in, AWS credentials', labelDy: -50 },
    { id: 'https', from: 'browser', fromHandle: 's-l', to: 'cloudfront', toHandle: 't-l', kind: 'data', label: 'HTTPS, the site', labelDx: 40, labelDy: 150 },
    // down the gap between the first column's tiles and the VPC (x = 410)
    { id: 'api', from: 'browser', fromHandle: 's-r', to: 'api', toHandle: 't-l', kind: 'data', label: 'SigV4-signed', centerX: (c0 + W + 410) / 2, labelDx: -10, labelDy: 120 },
    { id: 'site', from: 'cloudfront', fromHandle: 's-b', to: 'site', toHandle: 't-t', kind: 'data', label: '/' },
    { id: 'copy', from: 'deploy', fromHandle: 's-t', to: 'site', toHandle: 't-b', kind: 'deploy' },
    { id: 'graph', from: 'api', fromHandle: 's-r', to: 'neptune', toHandle: 't-l', kind: 'data', label: 'queries' },
    { id: 'invoke', from: 'api', fromHandle: 's-t', to: 'agentcore', toHandle: 't-b0', kind: 'control', label: 'InvokeAgentRuntime' },
    { id: 'cypher', from: 'query', fromHandle: 's-b', to: 'neptune', toHandle: 't-t', kind: 'data', label: 'openCypher' },
    { id: 'sql', from: 'lake', fromHandle: 's-t3', to: 'tables', toHandle: 't-t', kind: 'data', label: 'SQL', offset: 68 },
    { id: 'start', from: 'api', fromHandle: 's-b3', to: 'sfn', toHandle: 't-t1', kind: 'control', label: 'StartExecution', centerY: 605 },
    { id: 'merge', from: 'pipeline', fromHandle: 's-r', to: 'neptune', toHandle: 't-r', kind: 'data', label: 'MERGE', offset: 40, labelDx: 2, labelDy: -30 },
    // up the gap between the loader (c1 + 50, WM wide) and the second column
    { id: 'load', from: 'loader', fromHandle: 's-r', to: 'neptune', toHandle: 't-l2', kind: 'deploy', centerX: (c1 + 50 + WM + c2) / 2 },
    { id: 'put', from: 'loader', fromHandle: 's-b', to: 'vectors', toHandle: 't-t3', kind: 'deploy', label: 'products', labelDy: 8 },
    { id: 'lookup', from: 'api', fromHandle: 's-b0', to: 'vectors', toHandle: 't-t0', kind: 'data', label: 'QueryVectors', labelDy: 125 },
    // the NAT gateway carries every AWS API call but the data bucket's, not only Bedrock's (docs/architecture.md, "Why these choices")
    { id: 'models', from: 'vpc', fromHandle: 's-r1', to: 'bedrock', toHandle: 't-l', kind: 'data', label: 'NAT gateway\nBedrock and the\nother AWS APIs' },
    { id: 'bucket', from: 'vpc', fromHandle: 's-r2', to: 'data', toHandle: 't-l', kind: 'data', label: 'gateway endpoint' },
  ],
  legend: [
    { kind: 'data', text: 'data at request time' },
    { kind: 'control', text: 'a call that starts work' },
    { kind: 'deploy', text: 'deploy time' },
    { kind: 'step', text: 'a step of the walk-through' },
  ],
};
