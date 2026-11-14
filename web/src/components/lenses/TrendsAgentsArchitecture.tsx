// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';
import type { CodeSnippet } from '../../api';
import { ArchitectureDiagram, Flight, type Def, type DiagramEdge, type ServiceBox } from '../arch/ArchitectureDiagram';
import type { Service } from '../arch/flow';
import type { Step } from '../arch/panelBits';

/**
 * "How it works" for methods 1 and 2 of the trends question (tab 6), in the style of the other
 * tabs: a numbered diagram of the services involved, the steps under it, what each step does and
 * its essential code, the Python from the API (code sets trends_graph / trends_lake). A node is
 * active while one of the requests it takes part in (`busy`) is in flight; `ctx.detail` replaces
 * its subtitle with live numbers.
 */
export type AgentsMethod = 'graph' | 'lake';
type NodeId = 'browser' | 'lambda' | 'llm' | 'neptune' | 'agent' | 's3tables' | 'mcp';
export type AgentsCtx = { busy: string; detail: Partial<Record<NodeId, string>> };

type Box = Pick<ServiceBox<NodeId>, 'id' | 'service' | 'x' | 'y' | 'title' | 'sub'> & { busy: string[] };
type Leg = Pick<DiagramEdge<NodeId>, 'id' | 'source' | 'sourceHandle' | 'target' | 'targetHandle' | 'label'> & { busy: string[] };
type Static = { title: string; summary: string; steps: Step<NodeId>[]; text: Record<number, ReactNode>; nodes: Box[]; edges: Leg[] };

/** A method's panel from its static geometry: which requests light each node and leg up. */
function methodDef({ nodes, edges, ...rest }: Static): Def<NodeId, AgentsCtx> {
  return {
    ...rest,
    nodes: ({ busy, detail, pulse }) => nodes.map(({ busy: on, ...n }) => ({ ...n, sub: detail[n.id] ?? n.sub, status: on.includes(busy) ? 'active' : pulse ? 'done' : 'idle' })),
    edges: ({ busy, pulse }) => edges.map(({ busy: on, ...e }) => ({ ...e, active: on.includes(busy), done: pulse && !on.includes(busy) })),
    legend: ({ busy }) => (busy ? <Flight>request in flight</Flight> : <>Follow the numbers 1–{rest.steps.length}. Greyed boxes are context.</>),
  };
}

const svc = (id: NodeId, service: Service, x: number, y: number, title: string, sub: string, busy: string[]): Box => ({ id, service, x, y, title, sub, busy });
const leg = (id: string, source: NodeId, sourceHandle: string, target: NodeId, targetHandle: string, label: string, busy: string[]): Leg => ({ id, source, sourceHandle, target, targetHandle, label, busy });

export const DEFS: Record<AgentsMethod, Def<NodeId, AgentsCtx>> = {
  graph: methodDef({
    title: 'How method 1 works: the graph agent on the Amazon Neptune MCP server',
    summary: 'Neptune Analytics · AgentCore · Lambda · Bedrock',
    steps: [
      { n: 1, node: 'neptune', title: 'New items against the lookbook', summary: 'One openCypher round trip reads every Item with its category and values: the new pieces of content and the lookbook.' },
      { n: 2, node: 'agent', title: 'Ask the graph agent', summary: 'The agent on AgentCore Runtime talks to its model, with tools, and to Neptune Analytics through the Neptune MCP server: openCypher, read-only.' },
      { n: 3, node: 'lambda', title: 'Count each group again', summary: "Code reads the vocabulary ids in the agent's rows and counts each group with the same pieces of content and lift." },
    ],
    text: {
      1: (
        <ul>
          <li>
            This step reads the graph that tab 2 built. An ingested item has a <code>run</code> and the <code>source</code> it came from. A lookbook garment has neither. Items the vision model was unsure
            about (confidence &lt; 0.5) stay out.
          </li>
          <li>
            One query returns each item&apos;s <code>IS_CATEGORY</code> and <code>HAS_ATTRIBUTE</code> targets. The comparison only uses what both sides are described in. Otherwise components
            (<code>HAS_PART</code>) and value families the lookbook never uses would all look emerging.
          </li>
          <li>Evidence counts in pieces of content. The left and the right shoe of one photo are one piece. With no new item in the graph, the job does not start.</li>
        </ul>
      ),
      2: (
        <ul>
          <li>
            The agent is tab 3&apos;s query agent. It gets the definition of emerging and the lift formula in plain words, with this graph&apos;s totals filled in. It reads the schema through the Amazon
            Neptune MCP server, writes its own openCypher, runs it and fixes it. A read-only guard checks every query before the server runs it.
          </li>
          <li>
            Its model on Amazon Bedrock (the <b>Agent model</b> of the deep dive) gets the server&apos;s tools as its <code>toolConfig</code>, and the <b>Reasoning effort</b> chosen there with every
            turn. The trace above shows each turn, with its reasoning summary when the model returns one as text.
          </li>
          <li>
            <b>The prompt</b> is the first entry of the code list below. It holds the question (<code>trends.AGENT_QUESTION</code>), then the agent&apos;s system prompt. After a run, ★ shows the
            question exactly as the agent got it.
          </li>
          <li>
            Writing, running and fixing its own queries takes longer than one API call may take (115 s). So the agent runs as a background job of up to 5 minutes. The API answers at once with a job id,
            and the browser polls it every 2 s. The API invokes the ingest pipeline&apos;s function asynchronously. That function calls <code>InvokeAgentRuntime</code> on the query agent, in a
            session of its own, with a 300 s deadline, and writes the result to the data bucket (<code>jobs/trends/</code>).
          </li>
        </ul>
      ),
      3: (
        <ul>
          <li>
            The node ids in the agent&apos;s rows name the groups. Code counts each group again: in how many new pieces it occurs, on how many lookbook garments, and its lift. A model never computes the
            numbers in the table.
          </li>
          <li>It also adds what is adjacent in the graph: the new items and the lookbook garments themselves, and the other properties its new items share.</li>
        </ul>
      ),
    },
    nodes: [
      svc('agent', 'agentcore', 800, 0, 'Graph agent · Neptune MCP', 'AgentCore Runtime', ['agent']),
      svc('browser', 'browser', 0, 220, 'Browser', 'polls the job', ['agent']),
      svc('lambda', 'lambda', 400, 220, 'AWS Lambda · trends', 'trends.graph_start · graph_groups (a job)', ['agent']),
      svc('neptune', 'neptune', 800, 220, 'Neptune Analytics', 'items · categories · values', ['agent']),
      svc('llm', 'bedrock', 1200, 0, "Amazon Bedrock · the agent's model", 'the agent model of the deep dive', ['agent']),
    ],
    edges: [
      leg('e-req', 'browser', 's-r', 'lambda', 't-l', 'ask · poll', ['agent']),
      leg('e-items', 'lambda', 's-r', 'neptune', 't-l', 'items + properties (openCypher)', ['agent']),
      leg('e-agent', 'lambda', 's-t', 'agent', 't-l', 'the question · up to 300 s', ['agent']),
      leg('e-mcp', 'agent', 's-b', 'neptune', 't-t', 'MCP · openCypher, read-only', ['agent']),
      leg('e-llm', 'agent', 's-r', 'llm', 't-l', 'Converse + MCP tools', ['agent']),
    ],
  }),
  lake: methodDef({
    title: 'How method 2 works: the graph as Iceberg tables, a data agent on the S3 Tables MCP server',
    summary: 'Neptune Analytics · S3 Tables · AgentCore · MCP · Bedrock',
    steps: [
      { n: 1, node: 'neptune', title: 'The graph as rows', summary: 'Three openCypher round trips read every item and every edge to the vocabulary.' },
      { n: 2, node: 's3tables', title: 'Overwrite the Iceberg tables', summary: 'PyIceberg writes items and item_features to the sample’s table bucket through the S3 Tables Iceberg REST endpoint.' },
      { n: 3, node: 'agent', title: 'Ask the data agent', summary: 'The data agent gets the same definition of emerging as method 1, written for the tables. It runs as a background job that the browser polls.' },
      { n: 4, node: 'mcp', title: 'The S3 Tables MCP server', summary: 'The server starts read-only on stdio. The agent may call one of its tools: query_database.' },
      { n: 5, node: 'llm', title: 'The plan', summary: 'The model gets rules, the tables’ schema and the question, and writes the SQL.' },
      { n: 6, node: 'mcp', title: 'Validate and execute', summary: 'A read-only guard checks the SQL, then Daft runs it over the tables. An error goes back to the model to fix.' },
      { n: 7, node: 'lambda', title: 'The result, counted again', summary: 'You see the SQL that answered, its rows and the agent’s explanation. The same code as method 1 counts its groups again.' },
    ],
    text: {
      1: (
        <ul>
          <li>
            <b>Export the graph to Iceberg tables</b> reads every Item, new (tab 2) or lookbook, with its provenance. It also reads every <code>IS_CATEGORY</code>, <code>HAS_ATTRIBUTE</code> and <code>HAS_PART</code> edge to the ontology&apos;s vocabulary. The result is two tables of rows (<code>lake_tables.json</code>, which the CDK stack also reads).
          </li>
          <li>The export includes everything, also the components and value families the lookbook never uses. As for method 1&apos;s agent, the question in step 3 says which rows to compare.</li>
        </ul>
      ),
      2: (
        <ul>
          <li>
            PyIceberg writes to one Amazon S3 table bucket of the sample (namespace <code>brand_graph</code>). It goes through the S3 Tables Iceberg REST endpoint (SigV4, warehouse = the bucket&apos;s ARN). There is no Glue Data Catalog integration, and nothing is account-wide. Each export adds one new Iceberg snapshot per table.
          </li>
          <li>
            The API has no PyArrow, and the lake agent has no access to the graph. So the API reads the rows and sends them to the lake agent&apos;s runtime. The runtime checks every row against the schema and writes the tables.
          </li>
          <li>The export is an offline step, like ingestion. The panel shows its time apart from the analysis.</li>
        </ul>
      ),
      3: (
        <ul>
          <li>
            The question has the same definition as method 1, written for tables. It compares new pieces of content (<code>COUNT(DISTINCT source)</code>) with lookbook garments. It gives the lift formula with the totals filled in and says what not to compare. It also lists the columns the last query must return. The agent then explains the trends itself.
          </li>
          <li>
            <b>The prompt</b> is the first entry of the code list below (<code>trends.LAKE_QUESTION</code>). The data agent&apos;s system prompt is under step 5. After a run, ★ shows the question exactly as the agent got it.
          </li>
          <li>
            A query takes seconds. A question takes up to a few minutes, which is longer than an API call may take (115 s). So the agent runs as a background job, in the lake agent&apos;s microVM on Amazon Bedrock AgentCore Runtime. The API polls in the browser tab&apos;s session, so it reaches the same microVM.
          </li>
        </ul>
      ),
      4: (
        <ul>
          <li>
            The S3 Tables MCP server (<code>awslabs.s3-tables-mcp-server</code> 0.1.1) runs read-only (no <code>--allow-write</code>) as a stdio subprocess. It starts once per session, from the packages installed in the lake agent&apos;s runtime. The server pins exact versions that do not exist for Linux arm64 / Python 3.14, so the runtime&apos;s build overrides them (<code>lake_overrides.txt</code>).
          </li>
          <li>The server offers 16 tools. The model gets one of them, <code>query_database</code>, reduced to its <code>query</code> argument.</li>
        </ul>
      ),
      5: (
        <ul>
          <li>
            The system prompt holds SQL rules and what Daft&apos;s SQL can and cannot do (joins on equality only). It describes the two tables and what every column means. It asks for named trends with their numbers, and a warning when the evidence is thin. The prompt is cached where the model caches explicitly.
          </li>
          <li>
            The data agent runs a Bedrock Converse tool loop with the <b>Agent model</b> of this method&apos;s deep dive, and the <b>Reasoning effort</b> chosen there with every turn.
          </li>
        </ul>
      ),
      6: (
        <ul>
          <li>
            A guard lets one read-only <code>SELECT</code> (or <code>WITH … SELECT</code>) through. The server checks it again. The code fills in the warehouse, namespace and endpoint. So the model cannot point the server at another bucket, and the runtime&apos;s role can only reach this one.
          </li>
          <li>
            Daft runs the SQL over the Iceberg tables. The MCP SDK withholds errors, so the code reads them from the server&apos;s log. An error goes back to the model, which fixes the SQL and runs it again (up to six calls).
          </li>
        </ul>
      ),
      7: (
        <ul>
          <li>The last query that ran is the answer&apos;s query. The panel shows its rows, the agent&apos;s explanation and every step the agent took.</li>
          <li>
            The vocabulary ids in its rows name the groups. The same code as method 1 counts them again, with the same pieces of content and the same lift. So you can compare the numbers of the two agents.
          </li>
        </ul>
      ),
    },
    nodes: [
      svc('neptune', 'neptune', 400, 0, 'Neptune Analytics', 'items + their vocabulary', ['export', 'ask']),
      svc('browser', 'browser', 0, 220, 'Browser', 'polls the job', ['export', 'ask']),
      svc('lambda', 'lambda', 400, 220, 'AWS Lambda · trends', 'lakehouse.rows · lake_start · lake_poll', ['export', 'ask']),
      svc('agent', 'agentcore', 800, 220, 'Lake agent · AgentCore Runtime', 'export · Converse tool loop (job)', ['export', 'ask']),
      svc('s3tables', 's3', 1200, 220, 'Amazon S3 Tables', 'brand_graph · items, item_features', ['export', 'ask']),
      svc('llm', 'bedrock', 800, 0, "Amazon Bedrock · the agent's model", 'the agent model of the deep dive', ['ask']),
      svc('mcp', 'mcp', 800, 440, 'S3 Tables MCP server', 'read-only · query_database (Daft)', ['ask']),
    ],
    edges: [
      leg('e-req', 'browser', 's-r', 'lambda', 't-l', 'export · ask · poll', ['export', 'ask']),
      leg('e-graph', 'lambda', 's-t', 'neptune', 't-b', 'items + vocabulary (openCypher)', ['export', 'ask']),
      leg('e-run', 'lambda', 's-r', 'agent', 't-l', 'rows · question', ['export', 'ask']),
      leg('e-write', 'agent', 's-r', 's3tables', 't-l', 'PyIceberg overwrite', ['export']),
      leg('e-llm', 'agent', 's-t', 'llm', 't-b', 'Converse tool loop', ['ask']),
      leg('e-mcp', 'agent', 's-b', 'mcp', 't-t', 'stdio', ['ask']),
      leg('e-sql', 'mcp', 's-r', 's3tables', 't-b', 'Daft SQL · Iceberg REST', ['ask']),
    ],
  }),
};

const CODE_SET = { graph: 'trends_graph', lake: 'trends_lake' } as const;

/** A method's "How it works": `extra` is the ★ entry of the code list, the prompt the agent got in the latest run (agentPrompt.ts). */
export function TrendsAgentsHowItWorks({
  method,
  ctx,
  finishedAt,
  open,
  onToggle,
  extra = null,
}: {
  method: AgentsMethod;
  ctx: AgentsCtx;
  finishedAt?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  extra?: CodeSnippet | null;
}) {
  return <ArchitectureDiagram def={DEFS[method]} ctx={ctx} codeSet={CODE_SET[method]} extra={extra} finishedAt={finishedAt} open={open} onToggle={onToggle} />;
}
