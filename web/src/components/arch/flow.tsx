// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { AWS_ICONS } from './awsIcons';

/**
 * Building blocks of the architecture diagrams (React Flow): a service node with its official AWS
 * Architecture Icon and the numbered step badges of the walk-through (like the diagrams of the AWS
 * Solutions Library); a zone, the dashed box that groups the nodes of one orchestrator (Step Functions, a Map
 * state); and an edge whose dashes travel along the path: slowly when idle, fast with "packets"
 * while a request is on that leg, and pulsing once when the response comes back.
 */
export type Service = 'browser' | 'cloudfront' | 'cognito' | 'lambda' | 'bedrock' | 's3' | 'cloudwatch' | 'output' | 'stepfunctions' | 'neptune' | 's3vectors' | 'mcp' | 'agentcore';
export type NodeStatus = 'idle' | 'active' | 'done' | 'off';
type ServiceNodeData = {
  service: Service;
  title: string;
  subtitle: string;
  status: NodeStatus;
  badge?: string;
  link?: boolean;
  /** Numbered steps of the walk-through that happen here (orange circles on the corner). */
  steps?: number[];
  /** Context, not part of the walk-through: drawn smaller and greyed. */
  muted?: boolean;
};
export type ServiceNodeType = Node<ServiceNodeData, 'service'>;
type ZoneNodeData = { title: string; subtitle?: string; tone: 'sfn' | 'map' | 'lambda' | 'agentcore'; steps?: number[]; selected?: boolean };
export type ZoneNodeType = Node<ZoneNodeData, 'zone'>;
type FlowEdgeData = { label?: string; active?: boolean; done?: boolean; muted?: boolean };

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
  return (
    <div className={`svc-node svc-${data.service} status-${data.status}${selected ? ' selected' : ''}${data.muted ? ' muted' : ''}`} title={data.link ? 'Opens the AWS console in a new tab' : undefined}>
      <StepBadges steps={data.steps} />
      {/* one target + one source handle per side (invisible); edges pick them by id */}
      {(['Left', 'Top', 'Right', 'Bottom'] as const).map((side) => (
        <span key={side}>
          <Handle type="target" position={Position[side]} id={`t-${side[0].toLowerCase()}`} className="svc-handle" />
          <Handle type="source" position={Position[side]} id={`s-${side[0].toLowerCase()}`} className="svc-handle" />
        </span>
      ))}
      <Handle type="target" position={Position.Top} id="t-t2" className="svc-handle" style={{ left: '70%' }} />
      <Handle type="target" position={Position.Top} id="t-t1" className="svc-handle" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="s-b1" className="svc-handle" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="s-b2" className="svc-handle" style={{ left: '70%' }} />
      <div className="svc-icon" aria-hidden>
        <Glyph service={data.service} />
      </div>
      <div className="svc-text">
        <div className="svc-title">
          {data.title}
          {data.link && <span className="svc-ext" aria-hidden>↗</span>}
        </div>
        <div className="svc-sub">{data.subtitle}</div>
      </div>
      {data.status === 'active' && <><span className="spinner svc-spinner" aria-hidden="true" /><span className="sr-only"> (in flight)</span></>}
      {data.badge && <span className="svc-badge">{data.badge}</span>}
    </div>
  );
}

/** The numbered circles of the walk-through; clicking the node selects its (first) step. */
function StepBadges({ steps }: { steps?: number[] }) {
  if (!steps?.length) return null;
  return (
    <span className="step-badges" aria-label={`step ${steps.join(' and ')}`}>
      {steps.map((n) => (
        <span key={n} className="step-badge">
          {n}
        </span>
      ))}
    </span>
  );
}

/** A dashed box around the nodes one orchestrator runs (its children are positioned inside it). */
export function ZoneNode({ data }: NodeProps<ZoneNodeType>) {
  return (
    <div className={`zone zone-${data.tone}${data.selected ? ' selected' : ''}`}>
      <div className="zone-head">
        <StepBadges steps={data.steps} />
        {data.tone !== 'map' && (
          <span className="zone-icon" aria-hidden>
            <Glyph service={data.tone === 'sfn' ? 'stepfunctions' : data.tone === 'agentcore' ? 'agentcore' : 'lambda'} />
          </span>
        )}
        <span className="zone-title">{data.title}</span>
        {data.subtitle && <span className="zone-sub">{data.subtitle}</span>}
      </div>
    </div>
  );
}

export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps) {
  const d = (data ?? {}) as FlowEdgeData;
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 });
  const cls = `flow-edge${d.active ? ' active' : ''}${d.done ? ' done' : ''}${d.muted ? ' muted' : ''}`;
  // Labels of horizontal legs sit just above the line so they never cover the tiles they join.
  const horizontal = Math.abs(sourceY - targetY) < 2;
  const transform = horizontal ? `translate(-50%, -100%) translate(${labelX}px, ${labelY - 7}px)` : `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`;
  return (
    <>
      <BaseEdge id={id} path={path} className={cls} markerEnd={markerEnd} />
      {(d.active || d.done) &&
        [0, 0.5].map((offset) => (
          <circle key={offset} r={4} className={`flow-packet${d.done ? ' done' : ''}`}>
            <animateMotion dur="1.1s" begin={`${offset * 1.1}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
      {d.label && (
        <EdgeLabelRenderer>
          <div className={`flow-label${d.active ? ' active' : ''}${horizontal ? ' above' : ''}`} style={{ transform }}>
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Every icon as a data URL, built once at module load. */
const ICON_URLS = Object.fromEntries(
  Object.entries(AWS_ICONS).map(([service, icon]) => [service, 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">${icon.body}</svg>`)]),
) as Record<keyof typeof AWS_ICONS, string>;

/** The official AWS Architecture Icon of a service: the constant SVG of awsIcons.ts, shown as an image. */
export function Glyph({ service }: { service: Service }) {
  const icon = AWS_ICONS[service];
  return <img alt="" className={icon.tile ? 'aws-icon tile' : 'aws-icon'} src={ICON_URLS[service]} />;
}
