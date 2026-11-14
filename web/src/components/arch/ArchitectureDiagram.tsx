// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useRef, useState, type ReactNode } from 'react';
import { Background, MarkerType, ReactFlow, type Edge, type EdgeTypes, type NodeMouseHandler, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CodeSet, CodeSnippet, OntologyDetail } from '../../api';
import { FlowEdge, ServiceNode, ZoneNode, type NodeStatus, type Service, type ServiceNodeType, type ZoneNodeType } from './flow';
import { CodeBrowser, FitOnResize, StepList, usePulse, useSnippets, type Step } from './panelBits';

/**
 * The "How it works" panel every tab has, in the style of the AWS Solutions Library architecture
 * pages: a React Flow diagram of the services that matter with numbered badges, the steps under
 * it, what the selected step does, the tab's own detail box for the selected node, and the
 * essential code of the step (the API's snippets for `codeSet`, plus `locals` that live in the
 * browser). A tab describes its panel as data (a `Def`: the steps, the texts, the geometry of
 * the nodes and edges, the legend) and passes the live context the geometry depends on (`ctx`);
 * the diagram adds the response pulse and owns the selection:
 *
 *   - clicking a step selects it and its node;
 *   - clicking a box selects its first step, else (a context node, such as the browser) the box
 *     alone: the step text disappears and the code browser lists what is attached to the node;
 *   - a zone may stand for a node (`selectAs`): clicking it selects that node.
 *
 * `onNodeClick` is for a side effect besides selecting (the S3 tiles open the console).
 */

/** What the diagram knows while it draws: the tab's own context plus the response pulse. */
export type Live<Ctx> = Ctx & { pulse: boolean };

/** A service tile. Its badges and greying follow from `Def.steps`: a node without a step is context. */
export type ServiceBox<NodeId extends string> = {
  id: NodeId;
  service: Service;
  x: number;
  y: number;
  title: string;
  sub: string;
  status: NodeStatus;
  /** Drawn inside this zone; `x`/`y` are then relative to it. */
  parent?: string;
  /** The tile opens a console link (drawn with ↗; the tab's `onNodeClick` opens it). */
  link?: boolean;
  badge?: string;
};
/** A dashed box around the nodes one orchestrator runs (Step Functions, a Map state, a Lambda, AgentCore). */
type ZoneBox<NodeId extends string> = {
  zone: true;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  sub?: string;
  tone: ZoneNodeType['data']['tone'];
  parent?: string;
  /** Clicking the zone selects this node, and the zone is drawn selected with it. */
  selectAs?: NodeId;
};
export type DiagramNode<NodeId extends string> = ServiceBox<NodeId> | ZoneBox<NodeId>;
export type DiagramEdge<NodeId extends string> = {
  id: string;
  source: NodeId;
  sourceHandle: string;
  target: NodeId;
  targetHandle: string;
  label?: string;
  /** A request is on this leg (orange, packets travel) / its response came back (green, once) / context only. */
  active?: boolean;
  done?: boolean;
  muted?: boolean;
};

/** A panel as data. The functions get the tab's context with the pulse added. */
export type Def<NodeId extends string, Ctx> = {
  title: string;
  /** The muted line next to the title (" · click a number" is appended). */
  summary: string | ((ctx: Live<Ctx>) => string);
  steps: Step<NodeId>[];
  /** What each step does, in a few lines; the code browser below shows how. */
  text: Record<number, ReactNode> | ((ctx: Live<Ctx>) => Record<number, ReactNode>);
  nodes: (ctx: Live<Ctx>) => DiagramNode<NodeId>[];
  edges: (ctx: Live<Ctx>) => DiagramEdge<NodeId>[];
  /** The line in the diagram's corner: what is in flight, else how to read the numbers. */
  legend: (ctx: Live<Ctx>) => ReactNode;
  /** Canvas height in px (470) and the fit padding (0.12). */
  height?: number;
  padding?: number;
};

export type Selection<NodeId extends string> = { step: number | null; node: NodeId };

const nodeTypes: NodeTypes = { service: ServiceNode as NodeTypes[string], zone: ZoneNode as NodeTypes[string] };
const edgeTypes: EdgeTypes = { flow: FlowEdge };
const MARKER = { active: '#ff9900', done: '#037f0c', idle: '#9aa5b1' };
const NO_SNIPPETS: CodeSnippet[] = [];

type FlowNode = ServiceNodeType | ZoneNodeType;

/** The selection a click on `boxId` makes: the first step of the node it stands for, else the node alone. */
export function selectionFor<NodeId extends string, Ctx>(def: Def<NodeId, Ctx>, boxes: DiagramNode<NodeId>[], boxId: string): Selection<NodeId> {
  const box = boxes.find((b) => b.id === boxId);
  const node = (box && 'zone' in box && box.selectAs) || (boxId as NodeId);
  return { step: def.steps.find((s) => s.node === node)?.n ?? null, node };
}

/** React Flow nodes from the boxes: badges from the steps, selection from the current node. */
export function flowNodes<NodeId extends string, Ctx>(def: Def<NodeId, Ctx>, boxes: DiagramNode<NodeId>[], selected: NodeId): FlowNode[] {
  return boxes.map((b) => {
    const steps = def.steps.filter((s) => s.node === b.id).map((s) => s.n);
    if ('zone' in b) {
      return {
        id: b.id,
        type: 'zone',
        position: { x: b.x, y: b.y },
        parentId: b.parent,
        style: { width: b.width, height: b.height },
        draggable: false,
        selectable: false,
        data: { title: b.title, subtitle: b.sub, tone: b.tone, steps: steps.length ? steps : undefined, selected: (b.selectAs ?? b.id) === selected },
      };
    }
    return {
      id: b.id,
      type: 'service',
      position: { x: b.x, y: b.y },
      parentId: b.parent,
      selected: b.id === selected,
      draggable: false,
      data: { service: b.service, title: b.title, subtitle: b.sub, status: b.status, steps: steps.length ? steps : undefined, muted: !steps.length, link: b.link, badge: b.badge },
    };
  });
}

/** React Flow edges: animated by their state; drawn above the zones' boxes when there are zones. */
export function flowEdges<NodeId extends string>(edges: DiagramEdge<NodeId>[], aboveZones: boolean): Edge[] {
  return edges.map(({ id, source, sourceHandle, target, targetHandle, ...data }) => ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: 'flow',
    zIndex: aboveZones ? 1 : undefined,
    data,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: data.active ? MARKER.active : data.done ? MARKER.done : MARKER.idle },
  }));
}

/** For a legend: a request on its way (orange dot), or a response just delivered (green). */
export function Flight({ done = false, children }: { done?: boolean; children: ReactNode }) {
  return (
    <>
      <span className="dot" style={{ background: done ? MARKER.done : MARKER.active }} /> {children}
    </>
  );
}

export function ArchitectureDiagram<NodeId extends string, Ctx>({
  def,
  ctx,
  codeSet,
  locals = NO_SNIPPETS,
  extra = null,
  detail = null,
  finishedAt,
  error = '',
  open,
  onToggle,
  onNodeClick,
  details,
}: {
  def: Def<NodeId, Ctx>;
  ctx: Ctx;
  codeSet: CodeSet;
  /** Snippets that live in the browser (memoize them). */
  locals?: CodeSnippet[];
  /** A ★ snippet built from the latest call (the prompt actually sent). */
  extra?: CodeSnippet | null;
  /** The ontology selected in the tab: the code browser renders its prompt under the render snippet. */
  detail?: OntologyDetail | null;
  /** Changes when a response arrives: the diagram pulses green for a moment. */
  finishedAt?: number | string;
  error?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onNodeClick?: (node: NodeId) => void;
  /** The tab's detail box for the selected node (what that service did for the latest call). */
  details?: (node: NodeId) => ReactNode;
}) {
  const [sel, setSel] = useState<Selection<NodeId>>({ step: def.steps[0].n, node: def.steps[0].node });
  const pulse = usePulse(finishedAt);
  const snippets = useSnippets(open, codeSet, locals);
  const wrap = useRef<HTMLDivElement>(null);
  const live: Live<Ctx> = { ...ctx, pulse };
  const boxes = def.nodes(live);
  const nodes = flowNodes(def, boxes, sel.node);
  const edges = flowEdges(def.edges(live), boxes.some((b) => 'zone' in b));
  const text = typeof def.text === 'function' ? def.text(live) : def.text;
  const summary = typeof def.summary === 'function' ? def.summary(live) : def.summary;

  const selectStep = (n: number) => setSel({ step: n, node: def.steps[n - 1].node });
  const onClick: NodeMouseHandler = (_e, node) => {
    const next = selectionFor(def, boxes, node.id);
    setSel(next);
    onNodeClick?.(next.node);
  };

  return (
    <details className="card panel arch-panel" open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)}>
      <summary>
        <h3>{def.title}</h3>
        <span className="xp-hint">{summary} · click a number</span>
      </summary>
      {error && <p className="error">{error}</p>}
      {open && (
        <>
          <div className={`flow-wrap flow-${codeSet}`} style={{ height: def.height ?? 470 }} ref={wrap}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: def.padding ?? 0.12 }}
              onNodeClick={onClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnScroll={false}
              preventScrolling={false}
              zoomOnDoubleClick={false}
              minZoom={0.4}
              maxZoom={1.6}
            >
              <Background gap={18} size={1} color="#e6eaee" />
              <FitOnResize target={wrap} />
            </ReactFlow>
            <div className="flow-legend muted">{def.legend(live)}</div>
          </div>
          <StepList steps={def.steps} active={sel.step} onSelect={selectStep} />
          <div className="arch-details">
            {sel.step && (
              <section className="arch-detail">
                <div className="arch-detail-head">
                  <h4>
                    Step {sel.step} · {def.steps[sel.step - 1].title}
                  </h4>
                </div>
                <div className="step-intro">{text[sel.step]}</div>
              </section>
            )}
            {details?.(sel.node)}
            <CodeBrowser step={sel.step} node={sel.node} snippets={snippets} extra={extra} detail={detail} />
          </div>
        </>
      )}
    </details>
  );
}
