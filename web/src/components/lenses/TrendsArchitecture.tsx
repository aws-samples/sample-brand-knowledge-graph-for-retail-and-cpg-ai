// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, type ReactNode } from 'react';
import type { CodeSet } from '../../api';
import { ArchitectureDiagram, Flight, type Def, type DiagramEdge, type ServiceBox } from '../arch/ArchitectureDiagram';
import type { Service } from '../arch/flow';
import type { Step } from '../arch/panelBits';

/**
 * "How it works" for "What are the emerging trends we see this season?" (tab 6, code set
 * lens_trends in code_panel.py), in the style of tab 3's panels: the services the lens uses,
 * numbered as the steps run, what each step does and its essential code. Every box lights up
 * while one of the lens's requests is in flight.
 */
export type LensSet = Extract<CodeSet, 'lens_trends'>;
type NodeId = 'browser' | 'lambda' | 'neptune' | 'llm';
export type LensCtx = { running: boolean };
type Box = Pick<ServiceBox<NodeId>, 'id' | 'service' | 'x' | 'y' | 'title' | 'sub'>;
type Leg = Pick<DiagramEdge<NodeId>, 'id' | 'source' | 'sourceHandle' | 'target' | 'targetHandle' | 'label'>;

const box = (id: NodeId, service: Service, x: number, y: number, title: string, sub: string): Box => ({ id, service, x, y, title, sub });
const leg = (id: string, source: NodeId, sourceHandle: string, target: NodeId, targetHandle: string, label: string): Leg => ({ id, source, sourceHandle, target, targetHandle, label });

const NODES: Box[] = [
  box('browser', 'browser', 0, 220, 'Browser', 'the map and its clouds'),
  box('lambda', 'lambda', 400, 220, 'AWS Lambda · API', 'lenses.trends_*'),
  box('neptune', 'neptune', 800, 220, 'Neptune Analytics', 'vector index + openCypher'),
  box('llm', 'bedrock', 400, 440, 'Amazon Bedrock', 'two Converse calls'),
];
const EDGES: Leg[] = [
  leg('e-q', 'browser', 's-r', 'lambda', 't-l', 'draw the map · walk a cloud · describe it'),
  leg('e-nep', 'lambda', 's-r', 'neptune', 't-l', 'the vectors · the walk'),
  leg('e-llm', 'lambda', 's-b', 'llm', 't-t', 'the pieces · the looks'),
];
const STEPS: Step<NodeId>[] = [
  { n: 1, node: 'neptune', title: 'Every worn garment’s vector', summary: 'The garments the brand’s looks wear, their names and kinds, and their vectors from the graph’s own index.' },
  { n: 2, node: 'browser', title: 'The map and its clouds', summary: 'Your browser groups the garments on the full vectors, lays them out in 2-D, draws the density and counts each cloud’s lift.' },
  { n: 3, node: 'neptune', title: 'The walk', summary: 'Your openCypher walks from the cloud’s garments to every look that wears one, and everything worn in those looks.' },
  { n: 4, node: 'llm', title: 'Describe the pieces', summary: 'A model gets the cloud’s numbered garments and their counts, and names what they have in common.' },
  { n: 5, node: 'llm', title: 'Describe their looks', summary: 'A model gets the lettered looks, the cloud’s pieces marked, and says how the brand wears them.' },
];
const TEXT: Record<number, ReactNode> = {
  1: (
    <ul>
      <li>
        <code>trends_map</code> lists every look, then the garments they contain, so a garment no look wears (a tab 2 article&apos;s) is left out. A garment with a <code>run</code> property was ingested
        in tab 2: the new shoot. The rest is the lookbook.
      </li>
      <li>Each vector is 1,024 numbers. It travels as one byte per number (scaled so its largest is 127): about 1 MB for the whole season.</li>
    </ul>
  ),
  2: (
    <ul>
      <li>
        The clouds come from the full vectors, never from the picture: a graph of each garment&apos;s 10 most similar ones (cosine), then Louvain communities on that graph (<code>layout</code> in{' '}
        <code>trendsMap.ts</code>).
      </li>
      <li>The picture is exact t-SNE on the same similarities, started from the two principal components, so the same graph always draws the same map. The heat is a Gaussian kernel density.</li>
      <li>
        A cloud&apos;s <b>lift</b> is its share of the new shoot over its share of the lookbook, counted in code (add-half smoothed). Above 1.5 it is emerging.
      </li>
    </ul>
  ),
  3: (
    <ul>
      <li>
        <code>trends_cloud</code> runs <code>CLOUD_WALK</code> (or your edit, read-only) with the cloud&apos;s garments as <code>$ids</code>: every look that wears one (<code>CONTAINS</code>), every
        garment in those looks with its kind and details, and each look&apos;s occasion (<code>FOR</code>).
      </li>
      <li>The rows are counted in code: per garment its details, colors and looks; the looks ranked by how many of the cloud&apos;s pieces they wear, lettered A, B, C.</li>
    </ul>
  ),
  4: (
    <ul>
      <li>
        <code>describe_items</code> runs the walk again on the server (it never trusts rows from the browser) and sends the numbered garments, the cloud&apos;s size, how many are from the new shoot and
        its lift. The prompt (<code>TRENDS_ITEMS_SYSTEM</code>) asks for the trend in two or three words, the details and colors that define it, and whether the evidence is thin.
      </li>
      <li>Every claim cites a garment, [n]: click a citation to see its row.</li>
    </ul>
  ),
  5: (
    <ul>
      <li>
        <code>describe_looks</code> sends the lettered looks, each with everything it wears and the cloud&apos;s pieces marked <code>*</code>. The prompt (<code>TRENDS_LOOKS_SYSTEM</code>) asks for the
        occasions, what the pieces are worn with, what stays the same and what the new shoot changes.
      </li>
      <li>Every claim cites a look, [A]. Only the graph knows those looks: the vectors found the cloud, the walk found how it is worn.</li>
    </ul>
  ),
};

export const DEF: Def<NodeId, LensCtx> = {
  title: 'How it works: the season’s trends, from vectors to looks',
  summary: 'Neptune Analytics · Lambda · Bedrock · your browser',
  height: 520,
  steps: STEPS,
  text: TEXT,
  nodes: ({ running, pulse }) => NODES.map((n) => ({ ...n, status: running ? 'active' : pulse ? 'done' : 'idle' })),
  edges: ({ running, pulse }) => EDGES.map((e) => ({ ...e, active: running, done: pulse })),
  legend: ({ running }) => (running ? <Flight>request in flight</Flight> : <>Follow the numbers 1–{STEPS.length}.</>),
};

/** The lens's "How it works": collapsed until opened; lights up while `running`, pulses on `finishedAt`. */
export function LensesHowItWorks({ set, running, finishedAt }: { set: LensSet; running: boolean; finishedAt?: number }) {
  const [open, setOpen] = useState(false);
  return <ArchitectureDiagram def={DEF} ctx={{ running }} codeSet={set} finishedAt={finishedAt} open={open} onToggle={setOpen} />;
}
