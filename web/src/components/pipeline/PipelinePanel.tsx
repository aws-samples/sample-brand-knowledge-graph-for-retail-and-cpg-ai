// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';
import type { Architecture, CodeSnippet, OntologyDetail, RunStatus, VisionModel } from '../../api';
import { ArchitectureDiagram, Flight, type Def } from '../arch/ArchitectureDiagram';
import type { NodeStatus } from '../arch/flow';
import type { Step } from '../arch/panelBits';
import { useArchitecture } from '../arch/useArchitecture';
import { PipelineDetails } from './PipelineDetails';
import { progressOf, tokenTotals } from './runView';

/**
 * "How this works" for the ingest pipeline: what Step Functions orchestrates, drawn inside a
 * Step Functions box (the Map over the sources, the classify and ingest Lambdas per source, the
 * summary), with the services it calls outside: S3, Bedrock, Neptune Analytics. The numbers
 * are the walk-through: the Map (1), the classify call (2), the ingest call (3), the MERGE into
 * Neptune (4), the summary (5). Click one for what it did in this run and its essential code.
 */
export type NodeId = 's3' | 'sfn' | 'classify' | 'bedrock' | 'ingest' | 'neptune' | 'summary';

/** What the diagram shows live: the deployment and the run being watched. */
type Ctx = { arch: Architecture | null; status: RunStatus | null; models: VisionModel[] };

/** The walk-through: the Lambda calls Step Functions makes and the insertion into Neptune. */
const STEPS: Step<NodeId>[] = [
  { n: 1, node: 'sfn', title: 'Step Functions: a Map over the sources', summary: 'One iteration per photo or text, four at a time. Each iteration makes two Lambda calls.' },
  { n: 2, node: 'classify', title: 'Lambda · classify', summary: 'The five steps of tab 1 for one source: ontology prompt, Converse call, checked answer.' },
  { n: 3, node: 'ingest', title: 'Lambda · ingest', summary: 'The checked answer becomes OWL individuals. Generic rules map them onto nodes and edges.' },
  { n: 4, node: 'neptune', title: 'Neptune Analytics: MERGE', summary: 'One openCypher MERGE per label and edge type, plus one vector per item and source.' },
  { n: 5, node: 'summary', title: 'Lambda · summarize', summary: 'Once per run: what the batch added, what its sources share, what the ontology lacks.' },
];

const st = (active: boolean, done = false): NodeStatus => (active ? 'active' : done ? 'done' : 'idle');

/** Where the run is: working through its sources, summarizing them, or done. */
function phases(status: RunStatus | null) {
  const progress = progressOf(status);
  const running = progress.running;
  return {
    progress,
    running,
    working: running && progress.done < progress.total,
    summarizing: running && progress.total > 0 && progress.done === progress.total && !status?.summary,
  };
}

/** What each step does; the code browser below shows how. */
const STEP_TEXT: Record<number, ReactNode> = {
  1: (
    <ul>
      <li>
        A run is one execution of a JSONata state machine (<code>pipeline.asl.json</code>, deployed by CDK). Its input is the run document: the ontology, the model, the caching switch and the sources. The sources are file names or S3 keys, never bytes.
      </li>
      <li>
        A Map state runs one iteration per source, four at a time. The batch takes as long as its slowest source. At most four Bedrock calls run in parallel.
      </li>
      <li>
        Each iteration invokes the same Lambda function twice: <code>step: "classify"</code>, then <code>step: "ingest"</code> with the classify output. At the end, <code>step: "summarize"</code> runs once with the result of every iteration.
      </li>
    </ul>
  ),
  2: (
    <ul>
      <li>The five steps of tab 1 for one source: the ontology from S3 as the system prompt, the photo (or a text) as the user turn, one Converse call, the answer checked against the ontology.</li>
      <li>The system prompt is the same for every source of the run. For the models that take a cache checkpoint (Claude, Amazon Nova, and GPT-6 and later), the first call writes it to the prompt cache and the following calls read it.</li>
      <li>The output is the list of entities that resolved to ontology classes and values. Step 3 takes it as input.</li>
    </ul>
  ),
  3: (
    <ul>
      <li>
        <b>The answer as OWL</b>: every entity becomes an individual of the ontology itself (<code>item a fo:Item ; fo:isCategory fo:Coat ; fo:hasSilhouette fo:silhouette_a-line ; fo:hasPart fo:Lapel</code>). The photo becomes an <code>fo:Look</code> that <code>fo:contains</code> its items. A text becomes an <code>fo:Statement</code> that <code>fo:illustrates</code> them.
      </li>
      <li>
        <b>From OWL to a property graph by four generic rules</b>: <code>rdf:type</code> → node label, literal → node property, IRI → edge, ontology term → a shared vocabulary node keyed by its <code>fo:conceptId</code>. An edge from a sub-property takes its super-property's name, so <code>hasSilhouette</code> → <code>HAS_ATTRIBUTE {'{family: silhouette}'}</code>.
      </li>
      <li>
        That code names no fashion term. One table, <code>KG_SCHEMA</code>, names the knowledge-graph classes and properties of the ontology. For another ontology, you change that table and leave the code as it is.
      </li>
    </ul>
  ),
  4: (
    <ul>
      <li>
        The step runs one openCypher <code>UNWIND $rows … MERGE</code> per node label, then one per edge type. It calls the <code>neptune-graph</code> ExecuteQuery API with SigV4. It needs no driver. Deployed, the call goes from the stack's private subnets to the graph's private endpoint. Vectors go in with <code>neptune.algo.vectors.upsert</code>.
      </li>
      <li>Ids derive from the source content and from the ontology's concept ids. So every source meets on the same vocabulary nodes. Running a batch twice updates the same nodes, though a re-read photo may add entities.</li>
      <li>
        The result has the shapes the GraphRAG tabs query: <code>(:Item)-[:IS_CATEGORY]-&gt;(:Category)</code>, <code>-[:HAS_ATTRIBUTE]-&gt;(:Attribute)</code>, <code>(:Look)-[:CONTAINS]-&gt;(:Item)</code>, <code>(:Statement)-[:ILLUSTRATES]-&gt;(:Item)</code>.
      </li>
    </ul>
  ),
  5: (
    <ul>
      <li>It runs once with the compact result of every iteration: node counts before and after, the vocabulary nodes that several new items share, and the ontology feedback across the batch.</li>
      <li>
        It writes the summary to <code>summary.json</code>, next to the per-source records, and returns it as the execution output. This tab polls the records while the run is going.
      </li>
    </ul>
  ),
};

export const DEF: Def<NodeId, Ctx> = {
  title: 'How this works: what Step Functions runs, and how it lands in Neptune',
  summary: ({ arch }) => (arch ? `${arch.region} · Step Functions → Lambda → Bedrock / Neptune Analytics` : 'Step Functions · Lambda · Bedrock · Neptune Analytics'),
  steps: STEPS,
  text: STEP_TEXT,
  height: 520,
  padding: 0.08,
  nodes: ({ arch, status, models, pulse }) => {
    const { progress, running, working, summarizing } = phases(status);
    const model = models.find((m) => m.id === status?.run.model_id);
    const tokens = tokenTotals(status);
    const added = status?.summary?.added.items;
    return [
      // Step Functions, and inside it the Map state with the two Lambda calls per source
      { zone: true, id: 'sfn', x: 290, y: 30, width: 1010, height: 280, title: 'AWS Step Functions · ingest state machine', sub: arch?.pipeline.state_machine_name ?? 'pipeline.asl.json', tone: 'sfn' },
      { zone: true, id: 'map', parent: 'sfn', selectAs: 'sfn', x: 24, y: 52, width: 640, height: 196, title: `Map · one iteration per source, ${arch?.pipeline.max_concurrency ?? 4} at a time`, sub: running ? `${progress.done} of ${progress.total} sources through` : undefined, tone: 'map' },
      { id: 'classify', parent: 'map', service: 'lambda', x: 30, y: 80, title: 'Lambda · classify', sub: model ? `${model.name} · ontology prompt` : 'source → Bedrock → checked answer', status: st(working) },
      { id: 'ingest', parent: 'map', service: 'lambda', x: 390, y: 80, title: 'Lambda · ingest', sub: added !== undefined ? `${added} items as OWL → graph` : 'answer → OWL → nodes + edges', status: st(working) },
      { id: 'summary', parent: 'sfn', service: 'lambda', x: 740, y: 132, title: 'Lambda · summarize', sub: status?.summary ? `+${status.summary.added.items} items · ${status.summary.shared.length} shared` : 'graph delta · shared · gaps', status: st(summarizing, pulse) },
      // the services the steps call
      { id: 's3', service: 's3', x: 0, y: 162, title: 'Amazon S3 · data bucket', sub: 'sources in · run records out', status: st(running), link: !!arch?.console.s3_prefix_template },
      { id: 'bedrock', service: 'bedrock', x: 397, y: 490, title: 'Amazon Bedrock', sub: tokens.calls ? `${tokens.calls} calls · ${tokens.cacheRead.toLocaleString()} cached tokens` : 'Converse · Nova embeddings', status: st(working) },
      { id: 'neptune', service: 'neptune', x: 747, y: 490, title: 'Neptune Analytics', sub: arch?.graph.graph_id ?? 'openCypher · vector index', status: st(working, pulse), link: !!arch?.console.neptune },
    ];
  },
  edges: ({ status, pulse }) => {
    const { running, working, summarizing } = phases(status);
    return [
      { id: 'e-src', source: 's3', sourceHandle: 's-r', target: 'classify', targetHandle: 't-l', label: 'sources by name / key', active: working, muted: !running },
      { id: 'e-step', source: 'classify', sourceHandle: 's-r', target: 'ingest', targetHandle: 't-l', label: 'checked answer', active: working },
      { id: 'e-sum', source: 'ingest', sourceHandle: 's-r', target: 'summary', targetHandle: 't-l', label: 'results', active: summarizing, done: pulse },
      { id: 'e-br', source: 'classify', sourceHandle: 's-b', target: 'bedrock', targetHandle: 't-t1', label: 'Converse', active: working },
      { id: 'e-emb', source: 'ingest', sourceHandle: 's-b1', target: 'bedrock', targetHandle: 't-t2', label: 'embeddings', active: working, muted: true },
      { id: 'e-nep', source: 'ingest', sourceHandle: 's-b2', target: 'neptune', targetHandle: 't-t', label: 'openCypher MERGE', active: working },
    ];
  },
  legend: ({ status, pulse }) => {
    const { progress, running } = phases(status);
    if (running) return <Flight>run in progress · {progress.done} of {progress.total} sources through</Flight>;
    if (pulse) return <Flight done>summary delivered</Flight>;
    return <>Follow the numbers 1–5. Step Functions orchestrates everything inside the pink box.</>;
  },
};

export function PipelinePanel({ status, models, detail, open, onToggle }: { status: RunStatus | null; models: VisionModel[]; detail: OntologyDetail | null; open: boolean; onToggle: (open: boolean) => void }) {
  const { arch, error } = useArchitecture(open);
  const ctx: Ctx = { arch, status, models };
  // The S3 and Neptune tiles are links: open this run's records, or the graph, in the console (new tab).
  const openConsole = (id: NodeId) => {
    if (id === 's3' && arch?.console.s3_prefix_template && status) {
      window.open(arch.console.s3_prefix_template.replace('{prefix}', encodeURIComponent(`runs/${status.run.run_id}/`)), '_blank', 'noopener');
    }
    if (id === 'neptune' && arch?.console.neptune) window.open(arch.console.neptune, '_blank', 'noopener');
  };
  return (
    <ArchitectureDiagram
      def={DEF}
      ctx={ctx}
      codeSet="pipeline"
      locals={LOCAL_SNIPPETS}
      detail={detail}
      finishedAt={status?.summary?.finished_at}
      error={error}
      open={open}
      onToggle={onToggle}
      onNodeClick={openConsole}
      details={(id) => <PipelineDetails id={id} arch={arch} status={status} models={models} detail={detail} />}
    />
  );
}

// ---------------------------------------------------------------- code that lives in the CDK
const CDK_SNIPPET: CodeSnippet = {
  id: 'p_cdk',
  title: 'CDK: the state machine from the JSON file and the Lambda it invokes',
  language: 'typescript',
  file: 'infra/lib/multimodal-ai-knowledge-graph-stack.ts',
  steps: [1],
  nodes: ['sfn'],
  highlights: [
    { kind: 'model', start: 2, end: 7, note: 'one function, three steps. 5 minutes covers the slowest vision model' },
    { kind: 'bedrock', start: 8, end: 9, note: 'it calls Bedrock and writes to Neptune Analytics' },
    { kind: 'ontology', start: 10, end: 11, note: 'reads the ontology and the sources; writes only run records' },
    { kind: 'output', start: 14, end: 18, note: 'the definition is the JSON file shown here, with the function ARN substituted in' },
    { kind: 'output', start: 19, end: 19, note: 'the state machine may invoke the function and nothing else' },
  ],
  code: `// The pipeline function: classify · ingest · summarize, chosen by event.step
const pipelineFn = new lambda.Function(this, 'PipelineFunction', {
  runtime, code,
  handler: 'ontology_rag.lambda_handler.pipeline_handler',
  memorySize: 1024,
  timeout: cdk.Duration.minutes(5),
});
pipelineFn.addToRolePolicy(graphAccess);           // neptune-graph:ReadDataViaQuery / WriteDataViaQuery
pipelineFn.addToRolePolicy(bedrockAccess);         // bedrock:InvokeModel (Converse, embeddings)
ontologiesBucket.grantRead(pipelineFn);            // ontologies, example sources, uploads
ontologiesBucket.grantPut(pipelineFn, 'runs/*');   // one record per source + summary

// The state machine: the same JSON the web app shows, with the function ARN substituted
const stateMachine = new sfn.StateMachine(this, 'IngestPipeline', {
  definitionBody: sfn.DefinitionBody.fromString(fs.readFileSync('backend/src/ontology_rag/pipeline.asl.json', 'utf8')),
  definitionSubstitutions: { PipelineFunctionArn: pipelineFn.functionArn, Partition: cdk.Aws.PARTITION },
  timeout: cdk.Duration.minutes(30),
});
pipelineFn.grantInvoke(stateMachine);`,
};

const LOCAL_SNIPPETS: CodeSnippet[] = [CDK_SNIPPET];
