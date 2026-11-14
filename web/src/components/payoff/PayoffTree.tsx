// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo } from 'react';
import type { PayoffTree as Tree } from '../../api';
import { tint } from '../tree/svg';
import { HEADER_H, litEdges, payoffTreeLayout, type PlacedNode } from './payoffTreeLayout';
import { safeImageUrl } from './safeImage';

/** The kinds' colors, the evidence tree's palette (Garment, Look, Category, Item). */
const COLOR = { anchor: '#c7158a', look: '#0d7f8f', category: '#0972d3', item: '#ff9900' } as const;
const HEADINGS = {
  anchor: '1 · vector search: the way in',
  look: '2 · every look they are in',
  category: '3 · worn with them, in how many looks',
  item: '4 · the same catalog search',
} as const;
/** The look photos are portrait (9:16 and 3:4): a portrait box, and the whole photo inside it. */
const THUMB_W = 30;
const THUMB_H = 42;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * GraphRAG's receipts: the traversal behind the answer, drawn. `lit`: the nodes the selected
 * evidence line points at (everything else dims); `thumbs`: look photos by node id, loaded lazily.
 */
export function PayoffTree({
  tree,
  lit,
  thumbs,
  selected = null,
  onPick,
}: {
  tree: Tree;
  lit: Set<string> | null;
  thumbs: Record<string, string>;
  /** The box whose details are open: outlined. */
  selected?: string | null;
  onPick: (nodeId: string) => void;
}) {
  const layout = useMemo(() => payoffTreeLayout(tree), [tree]);
  const litE = useMemo(() => (lit ? litEdges(layout, lit) : null), [layout, lit]);
  const dim = (id: string) => lit !== null && !lit.has(id);

  const box = (n: PlacedNode) => {
    const c = COLOR[n.kind];
    const photo = n.kind === 'look' ? safeImageUrl(thumbs[n.id]) : undefined;
    const textX = n.x + (n.kind === 'look' ? THUMB_W + 14 : 10);
    const tx = n.x + 6;
    const ty = n.y + (n.h - THUMB_H) / 2;
    const maxChars = n.kind === 'look' ? 22 : n.kind === 'item' ? 30 : 24;
    return (
      <g
        key={n.id}
        className={`po-node po-${n.kind}${dim(n.id) ? ' po-dim' : ''}${lit?.has(n.id) ? ' po-lit' : ''}${selected === n.id ? ' po-selected' : ''}`}
        aria-pressed={selected === n.id}
        onClick={() => onPick(n.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(n.id)}
        aria-label={`${n.kind} ${n.label}${n.count ? `, in ${n.count} looks` : ''}`}
      >
        <title>{[n.label, n.sub].filter(Boolean).join('\n')}</title>
        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} fill={tint(c, 0.1)} stroke={c} strokeWidth={selected === n.id ? 3 : lit?.has(n.id) ? 2.5 : 1.2} />
        {n.kind === 'look' && (
          <>
            <rect x={tx} y={ty} width={THUMB_W} height={THUMB_H} rx={3} fill="#fff" stroke={tint(c, 0.35)} />
            {photo && <image href={photo} x={tx} y={ty} width={THUMB_W} height={THUMB_H} preserveAspectRatio="xMidYMid meet" />}
          </>
        )}
        <text x={textX} y={n.y + (n.sub ? n.h / 2 - 3 : n.h / 2 + 4)} className="po-label">
          {cut(n.label, maxChars)}
        </text>
        {n.sub && (
          <text x={textX} y={n.y + n.h / 2 + 13} className="po-sub">
            {cut(n.sub, maxChars + 6)}
          </text>
        )}
        {n.count !== undefined && (
          <g>
            <rect x={n.x + n.w - 44} y={n.y + 8} width={36} height={20} rx={10} fill={c} />
            <text x={n.x + n.w - 26} y={n.y + 22} className="po-count" textAnchor="middle">
              {n.count}
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="po-canvas">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ minWidth: 760 }} role="img" aria-label="GraphRAG's traversal: anchor garments, their looks, what is worn with them, and catalog items">
        {layout.columns.map((col) => (
          <text key={col.kind} x={col.x} y={12 + HEADER_H / 2} className="po-heading">
            {HEADINGS[col.kind]}
          </text>
        ))}
        {layout.edges.map((e) => {
          const k = `${e.source}>${e.target}`;
          const on = litE?.has(k);
          return <path key={k} d={e.d} className={`po-link${on ? ' po-link-lit' : ''}${litE && !on ? ' po-dim' : ''}`} />;
        })}
        {layout.nodes.map(box)}
      </svg>
    </div>
  );
}
