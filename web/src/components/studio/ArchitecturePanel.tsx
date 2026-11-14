// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo, type ReactNode } from 'react';
import type { Architecture, ClassifyResult, CodeSnippet, OntologyDetail, VisionModel } from '../../api';
import { ArchitectureDiagram, Flight, type Def } from '../arch/ArchitectureDiagram';
import type { NodeStatus } from '../arch/flow';
import type { Step } from '../arch/panelBits';
import { promptSnippet } from '../arch/promptSnippet';
import { useArchitecture } from '../arch/useArchitecture';
import { NodeDetails } from './ArchitectureDetails';
import { notebookSnippet } from './notebookSnippet';
import type { RequestInfo, RunRow } from './types';

/**
 * "How this works" for tab 1: the classify request as a numbered architecture diagram. The five
 * numbers are the walk-through (the ontology from S3, the photo from S3, the prompt, the Bedrock
 * call, the validation), and each one opens its explanation, what that service did for the
 * latest call (ArchitectureDetails) and the essential code of the step. Browser, Amazon Cognito
 * and CloudWatch are drawn as context only. Lines animate while a model call is in flight.
 */
export type NodeId = 'browser' | 'cognito' | 's3-ontology' | 's3-images' | 'lambda' | 'bedrock' | 'cloudwatch' | 'output';

/** What the diagram shows live: the deployment, the ontology, the runs of this tab. */
type Ctx = {
  arch: Architecture | null;
  detail: OntologyDetail | null;
  ontologyId: string;
  models: VisionModel[];
  running: RunRow[];
  runningLabel: string;
  latestRequest: RequestInfo | undefined;
  latestResult: ClassifyResult | null;
};

/** The walk-through: one numbered step per service that matters. */
const STEPS: Step<NodeId>[] = [
  { n: 1, node: 's3-ontology', title: 'The ontology, from S3', summary: 'The Lambda reads the OWL file from S3. rdflib parses it into classes, properties and allowed values.' },
  { n: 2, node: 's3-images', title: 'The photo, from S3', summary: 'The Lambda reads an example image from S3 as raw bytes. An uploaded photo arrives in the request body.' },
  { n: 3, node: 'lambda', title: 'The prompt', summary: 'The ontology becomes the system prompt. The photo and one instruction form the user turn.' },
  { n: 4, node: 'bedrock', title: 'The Bedrock call', summary: 'One Converse request with the model, its inference parameters and, where the model takes one, a prompt-cache checkpoint.' },
  { n: 5, node: 'output', title: 'Validate the answer', summary: 'The Lambda checks every class, value and part against the ontology. Anything not in it is reported.' },
];

const st = (active: boolean, done = false): NodeStatus => (active ? 'active' : done ? 'done' : 'idle');
const s3Of = (arch: Architecture | null) => (arch?.ontologies.kind === 's3' ? arch.ontologies : null);

export const DEF: Def<NodeId, Ctx> = {
  title: 'How this works: five steps, live, with the essential code',
  summary: ({ arch }) => (arch ? `${arch.region} · S3 → Lambda → Bedrock` : 'S3 · Lambda · Bedrock'),
  steps: STEPS,
  text: ({ ontologyId, detail }) => stepText(ontologyId, detail),
  nodes: ({ arch, detail, ontologyId, models, running, runningLabel, latestRequest, latestResult, pulse }) => {
    const busy = running.length > 0;
    const s3 = s3Of(arch);
    const usesBuiltIn = !!latestRequest && !latestRequest.ontologyUpload;
    const usesExample = !!latestRequest && !!latestRequest.example;
    const names = runningLabel.split(', ').filter(Boolean);
    const file = detail?.file || `${ontologyId}.ttl`;
    const fn = arch?.function.name;
    return [
      // the walk-through: S3 (1, 2) → Lambda (3) → Bedrock (4) → validated answer (5)
      { id: 's3-ontology', service: 's3', x: 430, y: 0, title: 'Amazon S3 · the ontology', sub: s3 ? `${s3.bucket}/${s3.prefix}${ontologyId}/${file}` : `${ontologyId}/${file}`, status: st(busy && usesBuiltIn), link: !!s3 },
      { id: 's3-images', service: 's3', x: 760, y: 0, title: 'Amazon S3 · example photos', sub: detail ? `${detail.examples_list.length} photos · ${ontologyId}/examples/images/` : 'examples/images/*.jpg', status: st(busy && usesExample), link: !!s3 },
      { id: 'lambda', service: 'lambda', x: 595, y: 200, title: 'AWS Lambda · classify', sub: fn ? `${fn.slice(0, 30)}${fn.length > 30 ? '…' : ''}` : 'api.vision_classify', status: st(busy), badge: busy ? `${running.length} in flight` : undefined },
      { id: 'bedrock', service: 'bedrock', x: 960, y: 200, title: 'Amazon Bedrock', sub: busy ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : latestResult ? `${latestResult.model.name} · ${(latestResult.metrics.latency_ms / 1000).toFixed(1)} s` : `${models.length} models · Converse API`, status: st(busy) },
      { id: 'output', service: 'output', x: 595, y: 390, title: 'Validated answer', sub: latestResult ? `${latestResult.entities.length} entities · ${latestResult.issues.length} issues` : 'entities checked against the ontology', status: st(false, pulse) },
      // context: how the request gets there and where the logs go
      { id: 'browser', service: 'browser', x: 0, y: 205, title: 'Browser', sub: latestRequest ? latestRequest.imageLabel : 'React app', status: st(busy, pulse) },
      { id: 'cognito', service: 'cognito', x: 0, y: 0, title: 'Amazon Cognito', sub: 'sign-in, AWS credentials', status: st(false) },
      { id: 'cloudwatch', service: 'cloudwatch', x: 975, y: 395, title: 'CloudWatch Logs', sub: 'one log group', status: st(false) },
    ];
  },
  edges: ({ running, latestRequest, pulse }) => {
    const busy = running.length > 0;
    const usesBuiltIn = !!latestRequest && !latestRequest.ontologyUpload;
    const usesExample = !!latestRequest && !!latestRequest.example;
    return [
      { id: 'e-onto', source: 's3-ontology', sourceHandle: 's-b', target: 'lambda', targetHandle: 't-t1', label: 'GetObject .ttl → rdflib', active: busy && usesBuiltIn, muted: !usesBuiltIn && !!latestRequest },
      { id: 'e-img', source: 's3-images', sourceHandle: 's-b', target: 'lambda', targetHandle: 't-t2', label: 'GetObject photo', active: busy && usesExample, muted: !usesExample && !!latestRequest },
      { id: 'e-br', source: 'lambda', sourceHandle: 's-r', target: 'bedrock', targetHandle: 't-l', label: 'Converse request', active: busy },
      { id: 'e-val', source: 'lambda', sourceHandle: 's-b', target: 'output', targetHandle: 't-t', label: 'answer → ontology check', done: pulse },
      { id: 'e-creds', source: 'browser', sourceHandle: 's-t', target: 'cognito', targetHandle: 't-b', muted: true },
      { id: 'e-req', source: 'browser', sourceHandle: 's-r', target: 'lambda', targetHandle: 't-l', label: 'SigV4 · function URL', muted: true, active: busy },
      { id: 'e-back', source: 'output', sourceHandle: 's-l', target: 'browser', targetHandle: 't-b', label: 'JSON → boxes on the image', muted: !pulse, done: pulse },
      { id: 'e-logs', source: 'lambda', sourceHandle: 's-b2', target: 'cloudwatch', targetHandle: 't-t', muted: true },
    ];
  },
  legend: ({ running, runningLabel, pulse }) =>
    running.length ? <Flight>request in flight: {runningLabel}</Flight> : pulse ? <Flight done>response delivered</Flight> : <>Follow the numbers 1–5. Greyed services are context: they show how the request arrives and where the logs go.</>,
};

export function ArchitecturePanel({ runs, models, detail, ontologyId, open, onToggle }: { runs: RunRow[]; models: VisionModel[]; detail: OntologyDetail | null; ontologyId: string; open: boolean; onToggle: (open: boolean) => void }) {
  const { arch, error } = useArchitecture(open);
  // what is happening right now, and the latest call that finished
  const { running, latest, latestResult, latestRequest, runningLabel } = useMemo(() => {
    const running = runs.filter((r) => r.state.status === 'running');
    const finished = runs.filter((r) => r.state.status !== 'running').sort((a, b) => (b.state as { finishedAt: number }).finishedAt - (a.state as { finishedAt: number }).finishedAt);
    const latest = finished[0];
    const latestResult = latest?.state.status === 'done' ? latest.state.result : null;
    const latestRequest = (running[0] ?? latest)?.state.request;
    const runningLabel = running.map((r) => models.find((m) => m.id === r.modelId)?.name ?? r.modelId).join(', ');
    return { running, latest, latestResult, latestRequest, runningLabel };
  }, [runs, models]);
  const finishedAt = latest && latest.state.status !== 'running' ? latest.state.finishedAt : undefined;
  // the ★ entry of the code browser: the prompt actually sent by the latest call, marked up
  const promptTab = useMemo<CodeSnippet | null>(() => (latestResult ? promptSnippet(latestResult) : null), [latestResult]);
  // the notebook snippet names the domain and its first example photo, so it runs as pasted
  const locals = useMemo(() => [notebookSnippet(ontologyId, detail?.examples_list[0]?.file)], [ontologyId, detail]);
  const ctx: Ctx = { arch, detail, ontologyId, models, running, runningLabel, latestRequest, latestResult };

  // The S3 tiles are links: open the exact prefix in the console (new tab), as well as selecting.
  const openConsole = (id: NodeId) => {
    const s3 = s3Of(arch);
    if ((id !== 's3-ontology' && id !== 's3-images') || !arch?.console.s3_prefix_template || !s3) return;
    const prefix = `${s3.prefix}${ontologyId}/${id === 's3-images' ? 'examples/images/' : ''}`;
    window.open(arch.console.s3_prefix_template.replace('{prefix}', encodeURIComponent(prefix)), '_blank', 'noopener');
  };

  return (
    <ArchitectureDiagram
      def={DEF}
      ctx={ctx}
      codeSet="explorer"
      locals={locals}
      extra={promptTab}
      detail={detail}
      finishedAt={finishedAt}
      error={error}
      open={open}
      onToggle={onToggle}
      onNodeClick={openConsole}
      details={(id) => <NodeDetails id={id} arch={arch} runs={runs} latest={latest} latestResult={latestResult} models={models} detail={detail} ontologyId={ontologyId} />}
    />
  );
}

/** What each step does, in a few lines, for the domain chosen in tab 0; the code browser below shows how. */
const stepText = (ontologyId: string, detail: OntologyDetail | null): Record<number, ReactNode> => ({
  1: (
    <ul>
      <li>
        The ontology is one OWL file, <code>ontologies/{ontologyId}/{detail?.file ?? `${ontologyId}.ttl`}</code> in the data bucket. Its example photos and texts sit next to it.
      </li>
      <li>
        The Lambda reads it with <code>GetObject</code>. rdflib parses it into RDF triples ({detail?.stats.triples ? `${Number(detail.stats.triples).toLocaleString()} for this ontology` : 'a few thousand for an ontology this size'}). Parsing takes about 50 ms, so it runs on every request.
      </li>
      <li>
        The triples become what the model can use: entity classes for what can be seen (Coat, Lapel …), attribute properties with their allowed values (hasSilhouette → a-line, …), and relations (hasPart). Classes marked <code>fo:visual false</code> are the knowledge-graph schema. They stay out.
      </li>
    </ul>
  ),
  2: (
    <ul>
      <li>
        Example photos sit in the domain&apos;s <code>examples/images/</code> folder next to the ontology, or in the <code>examples/images/</code> folder of one of its data sets (<code>datasets/&lt;set&gt;/examples/images/</code>). The request names one, and the Lambda reads it with <code>GetObject</code>.
      </li>
      <li>
        Bedrock takes the raw bytes and a format name (<code>jpeg</code>, <code>png</code>, <code>webp</code>, <code>gif</code>). The request carries no base64 and no S3 URI.
      </li>
      <li>A photo you upload travels base64-encoded in the request body. The Lambda turns it into the same (bytes, format) pair.</li>
    </ul>
  ),
  3: (
    <ul>
      <li>
        <b>System prompt = the ontology as text</b>: the task (“use ONLY this vocabulary”), the entity classes as an indented tree, the relations, every attribute property with its allowed values, the request for ontology feedback, and the JSON shape of the answer.
      </li>
      <li>
        <b>User turn = the photo, then one instruction</b>: an <code>image</code> content block, then a text block. The text block gives the pixel size (“bbox on a 0–1000 scale”) and the ask in the domain&apos;s words ({detail?.domain.subject ? `“classify every ${detail.domain.subject}”` : 'from its domain.json'}).
      </li>
      <li>
        Everything that is the same for every photo is in the system prompt. That makes it cacheable in step 4. To read it, open “rendered prompt” in the code list. After a call, ★ shows the prompt actually sent.
      </li>
    </ul>
  ),
  4: (
    <ul>
      <li>
        Every provider gets the same Converse request on <code>bedrock-runtime</code>. Only <code>modelId</code> changes. The ids are cross-Region inference profiles (<code>global.…</code>), so Bedrock serves the call from the Region with capacity.
      </li>
      <li>
        <b>Inference parameters per model</b>: <code>maxTokens</code> is 8,192, and Amazon Nova caps it at 5,000. A <code>temperature</code> is set only where the model accepts one.
      </li>
      <li>
        <b>Prompt caching</b>: for the models that take a cache checkpoint (Claude, Amazon Nova, and GPT-6 and later), a <code>cachePoint</code> block follows the ontology text. The first call writes that prefix to the cache (<code>cacheWriteInputTokens</code>). Calls in the next five minutes read it (<code>cacheReadInputTokens</code>) for a fraction of the input price and latency. Each of these models caches only from a minimum prefix length. The other models get no checkpoint: they cache a repeated prefix on their own or not at all. This tab always sends the checkpoint where the model takes one. The table below shows each model&apos;s cache reads and writes.
      </li>
    </ul>
  ),
  5: (
    <ul>
      <li>The answer must be the JSON object the prompt asked for.</li>
      <li>
        Each class must be an entity class of the ontology. Each attribute must apply to that class (its <code>rdfs:domain</code>). Its value must be a named individual of the property&apos;s range. Each part must be an entity class.
      </li>
      <li>
        Everything that resolves is kept with its IRI. The IRI links a box on the photo to the ontology tree above. Everything that does not resolve is listed under <b>issues</b> and is not kept. The model&apos;s <b>ontology feedback</b> says what it saw but could not express.
      </li>
    </ul>
  ),
});
