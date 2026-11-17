// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, MarkerType, Position, type Edge, type EdgeProps, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { AWS_ICONS } from '../src/components/arch/awsIcons';
import { ServiceNode, ZoneNode, type Service, type ServiceNodeType, type ZoneNodeType } from '../src/components/arch/flow';
import { EXTRA_ICONS } from './icons';

/**
 * The pieces a figure is made of. Service tiles and orchestrator zones are the app's own
 * components (web/src/components/arch/flow.tsx), so a figure looks like the tabs' "How it works"
 * panels. The rest is what a static picture needs and a panel does not: tiles with icons the app
 * does not use, labelled groups with handles (the VPC), the graph model's node types, folder-tree
 * rows and callouts, and an edge that tells data flow from control flow without animation.
 */
type IconName = Service | keyof typeof EXTRA_ICONS;
type Side = 'l' | 't' | 'r' | 'b';
/** An extra handle on a side, at a fraction of its length (the defaults sit in the middle). */
type HandleAt = { id: string; side: Side; at: number; type: 'source' | 'target' };
type Base = { id: string; x: number; y: number; parent?: string };

export type TileSpec = Base & { kind: 'tile'; icon: IconName; title: string; sub: string; steps?: number[]; muted?: boolean; badge?: string; handles?: HandleAt[] };
export type ZoneSpec = Base & { kind: 'zone'; w: number; h: number; title: string; sub?: string; tone: ZoneNodeType['data']['tone']; steps?: number[] };
export type GroupSpec = Base & { kind: 'group'; w: number; h: number; title: string; sub?: string; icon?: IconName; color: string; dashed?: boolean; steps?: number[]; handles?: HandleAt[] };
export type EntitySpec = Base & { kind: 'entity'; label: string; props?: string; color: string; vec?: boolean; handles?: HandleAt[] };
export type RowSpec = Base & { kind: 'row'; depth: number; name: string; note?: string; folder?: boolean; mark?: string };
export type NoteSpec = Base & { kind: 'note'; w: number; title: string; text: string; color: string; handles?: HandleAt[] };
export type NodeSpec = TileSpec | ZoneSpec | GroupSpec | EntitySpec | RowSpec | NoteSpec;

/** data: a request or its payload; control: a call that starts work elsewhere; deploy: only at deploy time. */
export type EdgeKind = 'data' | 'control' | 'deploy';
export type EdgeSpec = {
  id: string;
  from: string;
  fromHandle: string;
  to: string;
  toHandle: string;
  kind: EdgeKind;
  label?: string;
  /** Where the smooth-step path turns, when the default midpoint would run through a tile. */
  centerX?: number;
  centerY?: number;
  /** How far the path runs out of a handle before it turns (20). */
  offset?: number;
  /** Moves the label off the path's midpoint. */
  labelDx?: number;
  labelDy?: number;
  color?: string;
};
export type LegendItem = { kind: EdgeKind | 'step'; text: string };
/** `large`: text about a fifth larger and wider tiles, for a figure that a page shows about 1,000 px wide (the workshop guide). */
export type FigureSpec = { width: number; height: number; nodes: NodeSpec[]; edges: EdgeSpec[]; legend: LegendItem[]; large?: boolean };

/**
 * Tile widths in px. main.tsx hands them to the CSS (`--svc-w`, `--svc-muted-w`); a spec that
 * places a handle by a tile's width reads them here, so the two never disagree.
 */
export const TILE = { normal: { width: 240, muted: 210 }, large: { width: 270, muted: 236 } } as const;
export const tileOf = (spec: Pick<FigureSpec, 'large'>) => TILE[spec.large ? 'large' : 'normal'];

const SIDES: Record<Side, Position> = { l: Position.Left, t: Position.Top, r: Position.Right, b: Position.Bottom };
const STROKE: Record<EdgeKind, string> = { data: '#546e7a', control: '#8a96a3', deploy: '#b3bcc6' };

function iconUrl(name: IconName): { url: string; tile: boolean } {
  const icon = name in EXTRA_ICONS ? EXTRA_ICONS[name as keyof typeof EXTRA_ICONS] : AWS_ICONS[name as Service];
  return { url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">${icon.body}</svg>`), tile: icon.tile };
}

/** A source and a target handle in the middle of every side, the 30 % / 70 % ones ServiceNode has, and any extras. */
function Handles({ extra = [] }: { extra?: HandleAt[] }) {
  const sides = Object.keys(SIDES) as Side[];
  const fixed: HandleAt[] = [
    ...sides.flatMap((s) => [
      { id: `s-${s}`, side: s, at: 0.5, type: 'source' as const },
      { id: `t-${s}`, side: s, at: 0.5, type: 'target' as const },
    ]),
    { id: 't-t1', side: 't', at: 0.3, type: 'target' },
    { id: 't-t2', side: 't', at: 0.7, type: 'target' },
    { id: 's-b1', side: 'b', at: 0.3, type: 'source' },
    { id: 's-b2', side: 'b', at: 0.7, type: 'source' },
  ];
  return (
    <>
      {[...fixed, ...extra].map((h) => {
        const along = h.side === 't' || h.side === 'b' ? { left: `${h.at * 100}%` } : { top: `${h.at * 100}%` };
        return <Handle key={h.id} id={h.id} type={h.type} position={SIDES[h.side]} className="svc-handle" style={along} />;
      })}
    </>
  );
}

function Badges({ steps }: { steps?: number[] }) {
  if (!steps?.length) return null;
  return (
    <span className="step-badges">
      {steps.map((n) => (
        <span key={n} className="step-badge">
          {n}
        </span>
      ))}
    </span>
  );
}

/** A tile ServiceNode cannot draw (an icon the app does not use, or extra handles); the same markup and classes. */
function ExtraTile({ data }: NodeProps<Node<TileSpec>>) {
  const icon = iconUrl(data.icon);
  return (
    <div className={`svc-node status-idle${data.muted ? ' muted' : ''}`}>
      <Badges steps={data.steps} />
      <Handles extra={data.handles} />
      <div className="svc-icon">
        <img alt="" className={icon.tile ? 'aws-icon tile' : 'aws-icon'} src={icon.url} />
      </div>
      <div className="svc-text">
        <div className="svc-title">{data.title}</div>
        <div className="svc-sub">{data.sub}</div>
      </div>
      {data.badge && <span className="svc-badge">{data.badge}</span>}
    </div>
  );
}

/** An AWS group box (the VPC, a set of managed services): a zone with any icon, a colour and handles. */
function Group({ data }: NodeProps<Node<GroupSpec>>) {
  const style: CSSProperties = { borderColor: data.color, background: `${data.color}08`, borderStyle: data.dashed === false ? 'solid' : 'dashed' };
  return (
    <div className="zone fig-group" style={style}>
      <Handles extra={data.handles} />
      <div className="zone-head">
        <Badges steps={data.steps} />
        {data.icon && (
          <span className="zone-icon">
            <img alt="" src={iconUrl(data.icon).url} />
          </span>
        )}
        <span className="zone-title">{data.title}</span>
        {data.sub && <span className="zone-sub">{data.sub}</span>}
      </div>
    </div>
  );
}

/** A node type of the graph model, coloured as tab 3's web colours it. */
function Entity({ data }: NodeProps<Node<EntitySpec>>) {
  return (
    <div className="fig-entity" style={{ borderColor: data.color }}>
      <Handles extra={data.handles} />
      <span className="fig-entity-dot" style={{ background: data.color }} />
      <span className="fig-entity-label">{data.label}</span>
      {data.vec && <span className="fig-vec">vector</span>}
      {data.props && <div className="fig-entity-props">{data.props}</div>}
    </div>
  );
}

/** One line of a folder tree. */
function Row({ data }: NodeProps<Node<RowSpec>>) {
  const icon = iconUrl('folder');
  return (
    <div className={`fig-row${data.mark ? ` mark-${data.mark}` : ''}`} style={{ paddingLeft: data.depth * 26 }}>
      <Handles />
      {data.folder ? <img alt="" className="fig-row-icon" src={icon.url} /> : <span className="fig-row-file" />}
      <code className="fig-row-name">{data.name}</code>
      {data.note && <span className="fig-row-note">{data.note}</span>}
    </div>
  );
}

/** A callout box. */
function Note({ data }: NodeProps<Node<NoteSpec>>) {
  return (
    <div className="fig-note" style={{ width: data.w, borderColor: data.color }}>
      <Handles extra={data.handles} />
      <div className="fig-note-title" style={{ color: data.color }}>
        {data.title}
      </div>
      <div className="fig-note-text">{data.text}</div>
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  service: ServiceNode as NodeTypes[string],
  zone: ZoneNode as NodeTypes[string],
  extra: ExtraTile as NodeTypes[string],
  box: Group as NodeTypes[string],
  entity: Entity as NodeTypes[string],
  row: Row as NodeTypes[string],
  note: Note as NodeTypes[string],
};

/** A smooth-step edge like the app's FlowEdge, without animation; solid for data, dashed for control and deploy. */
function FigureEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<EdgeSpec>>) {
  const d = data!;
  const [path, midX, midY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, centerX: d.centerX, centerY: d.centerY, offset: d.offset });
  const style: CSSProperties = { stroke: d.color ?? STROKE[d.kind] };
  // As in the app's FlowEdge, a label of a horizontal leg sits just above the line; others sit on it.
  const horizontal = Math.abs(sourceY - targetY) < 2;
  const x = midX + (d.labelDx ?? 0);
  const y = midY + (d.labelDy ?? 0);
  const transform = horizontal && d.labelDy === undefined ? `translate(-50%, -100%) translate(${x}px, ${y - 4}px)` : `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  return (
    <>
      <BaseEdge id={id} path={path} className={`flow-edge fig-edge ${d.kind}`} style={style} markerEnd={markerEnd} />
      {d.label && (
        <EdgeLabelRenderer>
          <div className={`flow-label fig-label ${d.kind}`} style={{ transform, ...(d.label.includes('\n') ? { whiteSpace: 'pre', textAlign: 'center', lineHeight: 1.25 } : {}) }}>
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { figure: FigureEdge };

/**
 * React Flow nodes from the specs; a tile whose icon the app has is the app's own ServiceNode.
 * Specs give absolute coordinates; React Flow wants a child's relative to its parent.
 */
export function toNodes(specs: NodeSpec[]): Node[] {
  const at = new Map(specs.map((s) => [s.id, s]));
  return specs.map((s) => {
    const parent = s.parent ? at.get(s.parent)! : { x: 0, y: 0 };
    const base = { id: s.id, position: { x: s.x - parent.x, y: s.y - parent.y }, parentId: s.parent, draggable: false, selectable: false };
    if (s.kind === 'tile' && s.icon in AWS_ICONS && !s.handles) {
      const data: ServiceNodeType['data'] = { service: s.icon as Service, title: s.title, subtitle: s.sub, status: 'idle', steps: s.steps, muted: s.muted, badge: s.badge };
      return { ...base, type: 'service', data };
    }
    if (s.kind === 'tile') return { ...base, type: 'extra', data: s };
    if (s.kind === 'zone') {
      const data: ZoneNodeType['data'] = { title: s.title, subtitle: s.sub, tone: s.tone, steps: s.steps };
      return { ...base, type: 'zone', style: { width: s.w, height: s.h }, data };
    }
    if (s.kind === 'group') return { ...base, type: 'box', style: { width: s.w, height: s.h }, data: s };
    return { ...base, type: s.kind, data: s };
  });
}

export function toEdges(specs: EdgeSpec[]): Edge[] {
  return specs.map((e) => ({
    id: e.id,
    source: e.from,
    sourceHandle: e.fromHandle,
    target: e.to,
    targetHandle: e.toHandle,
    type: 'figure',
    zIndex: 1,
    data: e,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.color ?? STROKE[e.kind] },
  }));
}

/** The line in the figure's corner: what a solid and a dashed line mean, and how to read the numbers. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="fig-legend">
      {items.map((item) => (
        <span key={item.text} className="fig-legend-item">
          {item.kind === 'step' ? (
            <span className="step-badge fig-legend-badge">1</span>
          ) : (
            <svg width="34" height="10" aria-hidden>
              <line x1="1" y1="5" x2="33" y2="5" className={`fig-edge ${item.kind}`} style={{ stroke: STROKE[item.kind] }} />
            </svg>
          )}
          {item.text}
        </span>
      ))}
    </div>
  );
}
