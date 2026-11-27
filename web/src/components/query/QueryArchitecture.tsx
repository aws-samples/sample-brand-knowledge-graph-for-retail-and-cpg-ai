// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';
import type { AgentResult } from '../../api';
import { ArchitectureDiagram, Flight, type Def } from '../arch/ArchitectureDiagram';
import type { NodeStatus } from '../arch/flow';
import type { Step } from '../arch/panelBits';

/**
 * "How the query works" for the query panel: the direct openCypher call, and the agent that takes
 * over when Neptune rejects the text: a Converse tool loop whose tools come from the Amazon
 * Neptune MCP server. The API function only invokes it: the loop and the MCP server (its stdio
 * subprocess) run on Amazon Bedrock AgentCore Runtime, one microVM per browser tab's session.
 */
type NodeId = 'browser' | 'api' | 'agent' | 'mcp' | 'neptune' | 'bedrock';

/** What the diagram shows live: the two calls in flight, the agent's last result, the graph. */
type Ctx = {
  direct: boolean;
  agent: boolean;
  result: AgentResult | null;
  graphId: string;
};

const STEPS: Step<NodeId>[] = [
  { n: 1, node: 'neptune', title: 'Run as openCypher', summary: 'The API runs the text on Neptune Analytics (ExecuteQuery). Rows go to the table. A rejection goes to step 2.' },
  { n: 2, node: 'agent', title: 'Invoke the agent on AgentCore Runtime', summary: "The API calls InvokeAgentRuntime with the text and Neptune's error. Each browser tab gets one session and one microVM." },
  { n: 3, node: 'mcp', title: 'The Neptune MCP server', summary: "A subprocess on stdio, pointed at the graph. It starts with the session's microVM. The agent lists its tools and reads the schema through it." },
  { n: 4, node: 'bedrock', title: 'Plan with the MCP tools', summary: "Converse: the text, Neptune's error, the schema and the domain's worked examples, with the server's tools as the toolConfig." },
  { n: 5, node: 'mcp', title: 'Validate and execute', summary: "Each toolUse passes a read-only guard, then goes to the server. Neptune's error goes back to the model." },
  { n: 6, node: 'api', title: 'The result', summary: 'The API returns the last query that ran, its rows, and two or three sentences from the model.' },
];

const TEXT: Record<number, ReactNode> = {
  1: (
    <ul>
      <li>
        The text goes to the API unchanged. It runs on Neptune Analytics with <code>ExecuteQuery</code> (language <code>OPEN_CYPHER</code>). The ingest pipeline&apos;s <code>MERGE</code>{' '}
        statements use the same call.
      </li>
      <li>
        Rows come back as JSON and fill the table. Neptune may reject the text: a syntax error, a function it does not have, or a question in plain words. Then the API answers 400 with Neptune&apos;s own
        message, and the browser hands the text and the message to the agent.
      </li>
      <li>Write clauses run only where the deployment allows them (<code>ALLOW_WRITE_QUERIES</code>); the agent never writes.</li>
    </ul>
  ),
  2: (
    <ul>
      <li>
        The API does not run the agent itself. It calls <code>InvokeAgentRuntime</code> on an Amazon Bedrock AgentCore Runtime with the text, Neptune&apos;s error, the model picked above and
        the graph id. The call is SigV4-signed. The API&apos;s role may invoke this one runtime and nothing else.
      </li>
      <li>
        Every browser tab has its own <code>runtimeSessionId</code>. AgentCore gives every session its own microVM with isolated CPU, memory and file system. The tab&apos;s next request reaches the
        same warm microVM. After 10 idle minutes, or 2 hours at most, AgentCore removes the microVM and wipes its memory.
      </li>
      <li>
        The agent is a code zip (direct code deployment) instead of a container image. It is <code>main.py</code> on the AgentCore SDK, Python 3.14 on arm64. It starts through{' '}
        <code>opentelemetry-instrument</code>, so its traces and metrics go to CloudWatch. On platform version V2, AgentCore restores a snapshot of the started agent for each new session. This keeps cold
        starts short.
      </li>
      <li>
        The runtime&apos;s execution role is the only identity the agent and its MCP server have. It allows Bedrock <code>InvokeModel</code> for the listed models and{' '}
        <code>neptune-graph:ReadDataViaQuery</code> on this graph. IAM refuses a write, in addition to the guard of step 5.
      </li>
    </ul>
  ),
  3: (
    <ul>
      <li>
        This repository does not define the agent&apos;s tools. They come from the Amazon Neptune MCP server (<code>awslabs.amazon-neptune-mcp-server</code>), the server an IDE starts with{' '}
        <code>uvx awslabs.amazon-neptune-mcp-server</code>.
      </li>
      <li>
        When the session&apos;s microVM starts, the agent starts the server as a subprocess on stdio with <code>NEPTUNE_ENDPOINT=neptune-graph://&lt;graph id&gt;</code>. It keeps the server for every
        request of the session, because a new Python process on a fresh microVM&apos;s disk took 17 s. For each request, the agent asks for the tools
        (<code>tools/list</code>). It reads the graph&apos;s schema through <code>get_graph_schema</code>: node labels, relationship types, their properties and which label connects to which.
      </li>
      <li>The server inherits the execution role&apos;s credentials. It runs without the agent&apos;s OpenTelemetry instrumentation, which would load again for seconds on every start.</li>
    </ul>
  ),
  4: (
    <ul>
      <li>
        The agent sends one Bedrock Converse request with the model picked above. The system prompt holds the rules, the domain&apos;s worked examples and the schema. For the models that take a cache checkpoint,
        it is cached and read again on every turn. The user turn holds the text and Neptune&apos;s error.
      </li>
      <li>
        The worked examples are question and query pairs from the domain&apos;s <code>domain.json</code> (<code>query_examples</code>), each tested on this graph. They show the model patterns that work on
        Neptune Analytics, such as a case-insensitive name lookup, rules in both directions and the latest run. So fewer queries fail and need a second try.
      </li>
      <li>
        The MCP tools become the Converse <code>toolConfig</code> unchanged: name, description, and the JSON schema the server published. The model may call <code>run_opencypher_query</code> and{' '}
        <code>get_graph_schema</code>. The agent leaves out the server&apos;s Gremlin tool, because Neptune Analytics has no Gremlin.
      </li>
    </ul>
  ),
  5: (
    <ul>
      <li>
        Every <code>toolUse</code> passes a read-only guard first (no <code>CREATE</code>, <code>MERGE</code>, <code>SET</code>, <code>DELETE</code>, <code>REMOVE</code>, <code>*.mutate</code>). Then it
        goes to the server with MCP <code>tools/call</code>, and the server runs it on the graph.
      </li>
      <li>
        A rejected query comes back to the model as an error <code>toolResult</code> carrying Neptune&apos;s message. The MCP SDK only reports &quot;Error executing tool&quot;, so the client reads the message
        from the server&apos;s log. The model fixes the query and runs it again. The limit is 6 tool calls, about 70 s.
      </li>
      <li>The first 20 rows go back to the model too. This lets the model check that the query answers the question. When a query returns nothing, the model can look up actual values.</li>
    </ul>
  ),
  6: (
    <ul>
      <li>
        The last query that ran is the answer&apos;s query. The panel shows it, its rows, and the model&apos;s two or three sentences about them. You can edit the query and run it yourself.
      </li>
      <li>
        The result goes back through the API as the answer of <code>InvokeAgentRuntime</code>. It also says where it ran: the session, whether its microVM was new or warm, and how long the API waited for
        the round trip.
      </li>
      <li>
        &quot;What the agent did&quot; draws the run: a time bar with every model turn and tool call at its start, then two lanes, the model&apos;s and the MCP server&apos;s, one box
        per step. Click a box for the query it sent and what came back.
      </li>
    </ul>
  ),
};

const st = (active: boolean, done = false): NodeStatus => (active ? 'active' : done ? 'done' : 'idle');

export const DEF: Def<NodeId, Ctx> = {
  title: 'How the query works: openCypher first, then an agent on the Amazon Neptune MCP server',
  summary: 'Lambda · Neptune Analytics · AgentCore Runtime · MCP · Bedrock',
  steps: STEPS,
  text: TEXT,
  height: 500,
  padding: 0.1,
  // Geometry (px): the API zone top left, Neptune top right on the same row, so the direct query is
  // one straight leg above the AgentCore zone; InvokeAgentRuntime leaves the API downwards outside
  // the AgentCore zone and enters it through its left border, below the zone title; Bedrock sits
  // under the agent loop. No leg crosses another or runs through a title.
  nodes: ({ direct, agent, result, graphId, pulse }) => {
    const m = result?.metrics;
    const rt = result?.runtime;
    const session = rt?.host === 'agentcore' ? ((rt.invocations_in_session ?? 1) <= 1 ? 'new session' : `warm · request ${rt.invocations_in_session}`) : '';
    return [
      { zone: true, id: 'fn', selectAs: 'api', x: 280, y: 0, width: 290, height: 140, title: 'AWS Lambda', sub: 'API function', tone: 'lambda' },
      { zone: true, id: 'acr', selectAs: 'agent', x: 470, y: 200, width: 800, height: 180, title: 'Amazon Bedrock AgentCore Runtime', sub: 'one microVM per session (browser tab)', tone: 'agentcore' },
      { id: 'browser', service: 'browser', x: 0, y: 60, title: 'Browser', sub: 'query or question', status: st(direct || agent, pulse) },
      { id: 'api', parent: 'fn', service: 'lambda', x: 36, y: 60, title: 'API · query + invoke', sub: rt?.invoke_ms !== undefined ? `${(rt.invoke_ms / 1000).toFixed(1)} s round trip` : 'api.graph_query', status: st(direct || agent, pulse) },
      { id: 'agent', parent: 'acr', service: 'agentcore', x: 60, y: 80, title: 'Agent · Converse tool loop', sub: m ? `${m.turns} turns · ${(m.total_ms / 1000).toFixed(1)} s${session ? ` · ${session}` : ''}` : 'agent_runtime.handle', status: st(agent) },
      { id: 'mcp', parent: 'acr', service: 'mcp', x: 420, y: 80, title: 'Amazon Neptune MCP server', sub: result ? `v${result.mcp.version} · ${m?.tool_calls ?? 0} tool calls` : 'stdio subprocess · one per session', status: st(agent) },
      { id: 'neptune', service: 'neptune', x: 1340, y: 60, title: 'Neptune Analytics', sub: graphId || 'openCypher', status: st(direct || agent, pulse) },
      { id: 'bedrock', service: 'bedrock', x: 530, y: 470, title: 'Amazon Bedrock · Converse', sub: result ? result.model.name : 'the model above', status: st(agent) },
    ];
  },
  edges: ({ direct, agent, pulse }) => [
    { id: 'e-text', source: 'browser', sourceHandle: 's-r', target: 'api', targetHandle: 't-l', label: 'text', active: direct || agent },
    { id: 'e-direct', source: 'api', sourceHandle: 's-r', target: 'neptune', targetHandle: 't-l', label: 'ExecuteQuery · openCypher', active: direct, done: pulse && !agent },
    { id: 'e-invoke', source: 'api', sourceHandle: 's-b', target: 'agent', targetHandle: 't-l', label: 'InvokeAgentRuntime', active: agent },
    { id: 'e-stdio', source: 'agent', sourceHandle: 's-r', target: 'mcp', targetHandle: 't-l', label: 'MCP over stdio', active: agent },
    { id: 'e-mcp', source: 'mcp', sourceHandle: 's-r', target: 'neptune', targetHandle: 't-b', label: 'ExecuteQuery · read-only', active: agent, done: pulse },
    { id: 'e-llm', source: 'agent', sourceHandle: 's-b', target: 'bedrock', targetHandle: 't-t', label: 'Converse + MCP tools', active: agent },
  ],
  legend: ({ direct, agent }) =>
    agent ? <Flight>the agent is working</Flight> : direct ? <Flight>query in flight</Flight> : <>Follow the numbers 1–6. When the query runs, step 1 is all that happens. Steps 2–6 happen only when Neptune rejects the query or you ask the agent.</>,
};

export function QueryArchitecture({ direct, agent, result, finishedAt, graphId, open, onToggle }: Ctx & { finishedAt?: number; open: boolean; onToggle: (open: boolean) => void }) {
  return <ArchitectureDiagram def={DEF} ctx={{ direct, agent, result, graphId }} codeSet="query" finishedAt={finishedAt} open={open} onToggle={onToggle} />;
}
