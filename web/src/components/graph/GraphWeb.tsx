// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { prefersReducedMotion } from '../shared/motion';
import { useElementWidth } from '../tree/useTreeCamera';
import type { Adjacency, Web } from './webView';

/** The colour of each kind of node, and its radius on the canvas (a kind or an occasion grows with what links to it). */
export const WEB_COLORS: Record<string, string> = {
  Look: '#ff9900',
  Item: '#8a9ba8',
  Category: '#2f6fb0',
  Occasion: '#7b3fb0',
  Attribute: '#2e9e6b',
  Statement: '#c0392b',
  Article: '#c0392b',
};
export const WEB_LEGEND: [string, string][] = [
  ['Look', 'a look (ringed: you added it)'],
  ['Item', 'a garment'],
  ['Category', 'a kind of garment'],
  ['Occasion', 'an occasion'],
  ['Attribute', 'a detail'],
  ['Statement', 'a text about a look'],
];
const HEIGHT = 620;
// photos drawn on lit-up looks at most (each is one image to decode)
const MAX_PHOTOS = 40;

type GNode = { id: string; label: string; name: string; isNew: boolean; deg: number; x?: number; y?: number };
type GLink = { source: string | GNode; target: string | GNode; type: string };

function radius(n: GNode): number {
  if (n.label === 'Occasion') return 9;
  if (n.label === 'Category' || n.label === 'Attribute') return Math.min(9, 2.5 + Math.sqrt(n.deg) / 2.5);
  if (n.label === 'Look') return 4.5;
  if (n.label === 'Article' || n.label === 'Statement') return 3.5;
  return 2;
}
const idOf = (end: string | GNode) => (typeof end === 'string' ? end : end.id);

/**
 * The brand's looks as one web (react-force-graph-2d): every look, garment, kind of garment, occasion
 * and text, and with details the attribute values. `lit` is what to light up (a click or a search);
 * the rest fades. Lit looks show their photo (`photoOf`, loaded as data URLs). Clicking a node calls
 * `onPick`; clicking the background clears.
 */
export function GraphWeb({
  web,
  adj,
  lit,
  selected,
  onPick,
  photos,
  focus,
}: {
  web: Web;
  adj: Adjacency;
  lit: Set<string> | null;
  selected: string | null;
  onPick: (id: string | null) => void;
  /** Data URLs of looks' photos, by image key. */
  photos: Record<string, string>;
  /** Bumped to fly the camera to what is lit. */
  focus: number;
}) {
  const fg = useRef<any>(null);
  const { ref: wrap, width } = useElementWidth<HTMLDivElement>(900);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [decoded, setDecoded] = useState(0);

  const data = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of web.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const nodes: GNode[] = web.nodes.map((n) => ({ id: n.id, label: n.label, name: n.name ?? n.id, isNew: !!n.run && n.label === 'Look', deg: deg.get(n.id) ?? 0 }));
    const links: GLink[] = web.edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
    return { nodes, links };
  }, [web]);

  // a looser layout than the default: the kinds and occasions pull their garments and looks around them
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force('charge')?.strength(-18);
    g.d3Force('link')?.distance((l: GLink) => (l.type === 'CONTAINS' ? 10 : l.type === 'FOR' ? 60 : 25));
    g.d3ReheatSimulation?.();
  }, [data]);

  // fly to what is lit (a search or a click), or back to everything
  useEffect(() => {
    const g = fg.current;
    if (!g || !focus) return;
    const t = setTimeout(() => g.zoomToFit(600, 50, lit ? (n: GNode) => lit.has(n.id) : undefined), 50);
    return () => clearTimeout(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const imageOf = useCallback(
    (id: string): HTMLImageElement | null => {
      const key = adj.byId.get(id)?.image_key ?? '';
      const url = photos[key];
      if (!url) return null;
      let img = images.current.get(key);
      if (!img) {
        img = new Image();
        img.onload = () => setDecoded((k) => k + 1); // draw it once it is decoded
        img.src = url;
        images.current.set(key, img);
      }
      return img.complete ? img : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adj, photos, decoded],
  );
  const photoLooks = useMemo(() => new Set(lit ? [...lit].filter((id) => adj.byId.get(id)?.label === 'Look').slice(0, MAX_PHOTOS) : []), [lit, adj]);

  const drawNode = useCallback(
    (n: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const on = !lit || lit.has(n.id);
      const r = radius(n);
      ctx.globalAlpha = on ? 1 : 0.12;
      const img = on && n.label === 'Look' && photoLooks.has(n.id) ? imageOf(n.id) : null;
      if (img) {
        const w = r * 2.6;
        const h = w * 1.5;
        ctx.save();
        ctx.beginPath();
        ctx.rect(n.x! - w / 2, n.y! - h / 2, w, h);
        ctx.clip();
        ctx.drawImage(img, n.x! - w / 2, n.y! - h / 2, w, h);
        ctx.restore();
        ctx.strokeStyle = n.isNew ? '#0f8b8d' : WEB_COLORS.Look;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(n.x! - w / 2, n.y! - h / 2, w, h);
      } else {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
        ctx.fillStyle = WEB_COLORS[n.label] ?? '#999';
        ctx.fill();
        if (n.isNew) {
          ctx.strokeStyle = '#0f8b8d';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      if (n.id === selected) {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // names: the kinds and occasions always, the rest once lit and close enough to read
      const named = n.label === 'Occasion' || ((n.label === 'Category' || n.label === 'Attribute') && (on || scale > 2)) || (lit?.has(n.id) && scale > 2.2 && n.label !== 'Look');
      if (named && on) {
        const font = Math.max(3, 11 / scale);
        ctx.font = `${n.label === 'Occasion' ? '600 ' : ''}${font}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#1b2733';
        ctx.fillText(n.name.length > 28 ? `${n.name.slice(0, 27)}…` : n.name, n.x!, n.y! + r + 1.5);
      }
      ctx.globalAlpha = 1;
    },
    [lit, selected, photoLooks, imageOf],
  );

  const linkColor = useCallback(
    (l: GLink) => {
      if (!lit) return 'rgba(120,135,150,0.18)';
      return lit.has(idOf(l.source)) && lit.has(idOf(l.target)) ? 'rgba(30,60,90,0.55)' : 'rgba(120,135,150,0.04)';
    },
    [lit],
  );

  return (
    <div className={`graph-panel${expanded ? ' expanded' : ''}`}>
      <div className="graph-controls">
        <span className="muted small">
          {web.nodes.length.toLocaleString()} nodes · {web.edges.length.toLocaleString()} relationships
        </span>
        <span className="spacer" />
        <button type="button" className="small secondary" onClick={() => fg.current?.zoomToFit(500, 40)}>
          Fit
        </button>
        <button type="button" className="small secondary" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Close ✕' : 'Expand ⤢'}
        </button>
      </div>
      <div className="graph-wrap" ref={wrap} style={expanded ? undefined : { height: HEIGHT }}>
        <div role="img" aria-label={`${web.nodes.length} nodes and ${web.edges.length} relationships: looks, garments, kinds of garment and occasions; use the search box and the side panel to move through them`}>
          <ForceGraph2D
            ref={fg}
            width={expanded ? window.innerWidth - 40 : width}
            height={expanded ? window.innerHeight - 120 : HEIGHT}
            graphData={data}
            backgroundColor="#ffffff"
            cooldownTicks={prefersReducedMotion() ? 0 : 250}
            warmupTicks={40}
            onEngineStop={() => !lit && fg.current?.zoomToFit(400, 30)}
            nodeRelSize={1}
            nodeVal={(n: any) => radius(n) ** 2}
            nodeLabel={(n: any) => `${n.label === 'Item' ? 'Garment' : n.label === 'Category' ? 'Kind' : n.label === 'Attribute' ? 'Detail' : n.label}: ${n.name}`}
            nodeCanvasObjectMode={() => 'replace'}
            nodeCanvasObject={drawNode as any}
            linkColor={linkColor as any}
            linkWidth={(l: any) => (lit && lit.has(idOf(l.source)) && lit.has(idOf(l.target)) ? 0.8 : 0.3)}
            onNodeClick={(n: any) => onPick(n.id)}
            onBackgroundClick={() => onPick(null)}
            enableNodeDrag={false}
          />
        </div>
        <div className="graph-legend">
          {WEB_LEGEND.filter(([label]) => web.nodes.some((n) => n.label === label)).map(([label, text]) => (
            <span key={label}>
              <i className="dot" style={{ background: WEB_COLORS[label] }} /> {text}
            </span>
          ))}
        </div>
        <div className="graph-hint muted" aria-hidden>
          scroll to zoom · drag to pan · click a node
        </div>
      </div>
    </div>
  );
}
