// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { api, isStoredPhotoKey, type Edge, type Node, type Noun } from '../../api';
import { StoredPhoto } from '../shared/StoredPhoto';
import { defaultMeasure, textRows } from '../shared/textLayout';
import { canvasMeasure, pathD, tint } from '../tree/svg';
import { openingZoom, TREE_PAD, useElementWidth, useTreeCamera, type Rect } from '../tree/useTreeCamera';
import { BADGE_GAP, depthStops, displayName, isSection, RT_FONTS, runTreeLayout, SUFFIX_GAP, THUMB, THUMB_GAP, type RtLink, type RtNode, type RunGraph } from './runTreeLayout';

/** Box colors (the palette of the other trees); components are drawn in the Group blue. */
const COLORS: Record<string, string> = {
  article: '#b18cf0',
  statement: '#7d2ef1',
  look: '#0d7f8f',
  source: '#414d5c',
  item: '#ff9900',
  category: '#0972d3',
  part: '#5a9be0',
  attribute: '#037f0c',
  related: '#ff9900',
};
const legendOf = (noun: Noun): { role: RtNode['role']; label: string }[] => [
  { role: 'article', label: 'Article' },
  { role: 'statement', label: 'Statement' },
  { role: 'look', label: 'Look (photo)' },
  { role: 'item', label: `Item (${noun.singular})` },
  { role: 'category', label: 'Category' },
  { role: 'part', label: 'component' },
  { role: 'attribute', label: 'Attribute value' },
];
const FONT_FAMILY = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const MIN_H = 300;
const MAX_H = 720;

type Focus = Node & { neighbors: { edge: Edge; node: Node }[] };

/**
 * What a run wrote, as a forest of top-down trees (layout in runTreeLayout.ts): one tree per
 * source (an article and its statement, or the look of a photo) down to the items the model
 * found in it, and under each item a column of what the ontology resolved it to: category,
 * components, values.
 * Plain SVG like tab 3's evidence tree: the wheel scrolls, Ctrl/⌘ + wheel zooms, drag pans,
 * "Fit" shows everything. Click a box for its properties and edges; a node drawn under several
 * items lights up everywhere it is drawn. `highlight` (a row or a shared node picked above)
 * outlines those ids and brings their tree into view. The depth slider cuts every tree at a tier
 * (sources … what the items resolved to); "+N" on a box unfolds
 * just that box, "−" folds it again. `noun` is the domain's word for an item (fashion: garment).
 */
export function BatchGraph({
  runId,
  load: loadGraph,
  version,
  highlight,
  thumbFor,
  noun,
  title = 'The graph this run wrote and what it connects to',
  centerBadge = 'written by this run',
}: {
  /** The run to draw (tab 2); or `load`, any graph in the same shape (the explorer's look). */
  runId?: string;
  load?: () => Promise<RunGraph>;
  version: number;
  highlight: Set<string>;
  thumbFor?: (imageKey: string) => string | null | undefined;
  noun: Noun;
  title?: string;
  /** What the details panel says about a node the graph is centred on. */
  centerBadge?: string;
}) {
  // one hop from what the run wrote: what each garment resolved to
  const hops = 1;
  const [graph, setGraph] = useState<RunGraph>({ centers: [], nodes: [], edges: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** null: as deep as the trees go. */
  const [depth, setDepth] = useState<number | null>(null);
  /** Boxes unfolded below the cut ("+N"); reset whenever the depth, the hops or the run change. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const g = loadGraph ? await loadGraph() : await api.runGraph(runId ?? '', hops, 400);
      setGraph({ centers: g.centers, nodes: g.nodes, edges: g.edges });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [runId, hops, loadGraph]);
  useEffect(() => {
    load();
  }, [load, version]);
  useEffect(() => {
    setSelected(null);
    setFocus(null);
    setOpen(new Set());
  }, [runId]);
  useEffect(() => setOpen(new Set()), [depth, hops]);

  // ---------------------------------------------------------------- layout: rows of trees as wide as the panel
  const { ref: wrap, width } = useElementWidth<HTMLDivElement>(900);
  const measure = useMemo(() => canvasMeasure(FONT_FAMILY, defaultMeasure), []);
  const rowWidth = Math.max(600, width - 2 * TREE_PAD - 48);
  const layout = useMemo(() => runTreeLayout(graph, { measure, rowWidth, hops, thumbFor, depth: depth ?? undefined, open, noun }), [graph, measure, rowWidth, hops, thumbFor, depth, open, noun]);
  const maxDepth = layout.maxDepth;
  const shownDepth = Math.min(depth ?? maxDepth, maxDepth);
  const height = Math.round(Math.min(MAX_H, Math.max(MIN_H, layout.height * openingZoom(width, layout.width) + 2 * TREE_PAD)));
  const content = useMemo(() => ({ width: layout.width, height: layout.height }), [layout]);
  const { svgRef, cam, setCam, hold, dragging, suppressClick, zoomAt, fit, reveal, focusOn, handlers } = useTreeCamera({ width, height, content, anchorX: null, wheel: 'pan' });
  const byKey = useMemo(() => new Map(layout.nodes.map((n) => [n.key, n])), [layout]);
  const roots = useMemo(() => layout.nodes.filter((n) => n.parentKey === null), [layout]);
  const rectOf = useCallback(
    (keys: (k: string) => boolean): Rect | null => {
      const ns = layout.nodes.filter((n) => keys(n.key));
      if (!ns.length) return null;
      return { l: Math.min(...ns.map((n) => n.x - n.w / 2)), r: Math.max(...ns.map((n) => n.x + n.w / 2)), t: Math.min(...ns.map((n) => n.y - n.h / 2)), b: Math.max(...ns.map((n) => n.y + n.h / 2)) };
    },
    [layout],
  );
  const treeRect = useCallback((rootKey: string) => rectOf((k) => k === rootKey || k.startsWith(`${rootKey}/`)), [rectOf]);

  // ---------------------------------------------------------------- emphasis
  const hl = useMemo(() => {
    const s = new Set<string>();
    for (const id of highlight) s.add(id);
    if (selected) s.add(selected);
    return s;
  }, [highlight, selected]);
  // a node the depth cut hides is outlined on the box it is folded into
  const hlKeys = useMemo(
    () => new Set([...layout.nodes.filter((n) => hl.has(n.id)).map((n) => n.key), ...layout.foldedInto.filter((f) => hl.has(f.id)).map((f) => f.key)]),
    [layout, hl],
  );
  /** Highlighted boxes and their ancestors up to the source. */
  const path = useMemo(() => {
    const s = new Set<string>();
    for (const k of hlKeys) for (let cur: RtNode | undefined = byKey.get(k); cur; cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined) s.add(cur.key);
    return s;
  }, [hlKeys, byKey]);
  const dim = hlKeys.size > 0;

  // a row picked above (its look / article is highlighted): bring its tree into view
  const hlRoot = roots.find((r) => highlight.has(r.id))?.key ?? null;
  useEffect(() => {
    if (!hlRoot) return;
    const r = treeRect(hlRoot);
    if (r) focusOn(r);
  }, [hlRoot, treeRect, focusOn]);

  // "+N" / "−" on a box: (un)fold just that box and keep it where it was on screen
  const anchor = useRef<{ key: string; sx: number; sy: number } | null>(null);
  const toggleFold = (n: RtNode, e?: MouseEvent | KeyboardEvent) => {
    e?.stopPropagation();
    if (suppressClick.current) return;
    anchor.current = { key: n.key, sx: cam.x + n.x * cam.k, sy: cam.y + n.y * cam.k };
    hold();
    setOpen((o) => {
      const next = new Set(o);
      if (n.unfolded) {
        // folding a box folds what was unfolded under it too
        for (const k of o) if (k === n.key || k.startsWith(`${n.key}/`)) next.delete(k);
      } else next.add(n.key);
      return next;
    });
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const n = layout.nodes.find((x) => x.key === a.key);
    if (n) setCam((c) => ({ ...c, x: a.sx - n.x * c.k, y: a.sy - n.y * c.k }));
  }, [layout, setCam]);

  async function pick(id: string) {
    if (!id) return;
    if (selected === id) {
      setSelected(null);
      setFocus(null);
      return;
    }
    setSelected(id);
    try {
      setFocus(await api.node(id));
    } catch (e: any) {
      setError(e.message);
    }
  }
  /** From the details panel: select a neighbour and show its first copy in the tree. */
  function pickNeighbour(id: string) {
    pick(id);
    const n = layout.nodes.find((x) => x.id === id);
    if (n) reveal({ l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.y - n.h / 2, b: n.y + n.h / 2 });
  }
  const onBox = (n: RtNode) => {
    if (suppressClick.current) return;
    pick(n.id);
  };
  const onBoxKey = (e: KeyboardEvent<SVGGElement>, n: RtNode) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(n.id);
  };

  // ---------------------------------------------------------------- connectors, in paint order
  const strokes = useMemo(() => {
    const onPath = (l: RtLink) => path.has(l.from) && (path.has(l.to) || hlKeys.has(l.to));
    return layout.links
      .map((l) => ({ l, emph: onPath(l) }))
      .sort((a, b) => Number(a.emph) - Number(b.emph) || Number(b.l.derived) - Number(a.l.derived))
      .map(({ l, emph }) => ({
        key: `${l.from}>${l.to}`,
        d: pathD(l.points),
        cls: ['rt-link', l.derived && 'rt-link-derived', emph && 'rt-link-path', dim && !emph && 'rt-dim'].filter(Boolean).join(' '),
        title: l.derived ? `shares vocabulary with the ${noun.singular} (two hops: ${noun.singular} → node ← item)` : l.type,
      }));
  }, [layout, path, hlKeys, dim]);

  const copies = selected ? layout.nodes.filter((n) => n.id === selected).length : 0;
  const s = layout.stats;
  const empty = !loading && !layout.nodes.length;
  const many = noun.plural;
  const ariaLabel = `What this run wrote: ${s.sources} source${s.sources === 1 ? '' : 's'}, ${s.items} ${many}, ${s.features} ontology nodes, ${s.shared} of them shared by several ${many}.`;
  const stops = depthStops(noun);

  return (
    <div className="card run-tree-card">
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: '1 1 auto' }}>{title}</h3>
        <button className="small secondary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </div>
      <p className="muted" style={{ margin: '0.3rem 0 0.5rem' }}>
        {s.sources} source{s.sources === 1 ? '' : 's'} → {s.items} {many} → {s.features} ontology nodes, {s.shared} of them used by several {many}
        {layout.lines.length ? <> · all in line {layout.lines.join(', ')}</> : null}. Each tree starts at a source and goes down to the {many} found in it. A source is an article with the statement the model read, or the look of a photo. Under each {noun.singular} you see what the ontology resolved: its category, its components and its values. A node the graph holds once but several {many} use is drawn under each of them, marked <b>×N</b>: that is where items from different sources meet.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="ev-tree">
        <div className="ev-toolbar">
          {maxDepth > 0 && (
            <label className="rt-depth" title="Cuts every tree at a tier. +N on a box unfolds just that box.">
              <span>Depth</span>
              <input
                type="range"
                min={0}
                max={maxDepth}
                step={1}
                value={shownDepth}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  setDepth(d >= maxDepth ? null : d);
                }}
                aria-label="tree depth"
                aria-valuetext={`${shownDepth} of ${maxDepth}: down to ${stops[shownDepth]}`}
              />
              <span className="muted">
                {shownDepth}/{maxDepth} · down to {stops[shownDepth]}
              </span>
            </label>
          )}
          <div className="ev-legend" aria-hidden>
            {legendOf(noun).filter((x) => layout.nodes.some((n) => n.role === x.role)).map((x) => (
              <span key={x.role}>
                <i className="ev-swatch" style={{ borderColor: COLORS[x.role] }} /> {x.label}
              </span>
            ))}
            <span>
              <i className="rt-swatch-badge">×N</i> shared by N {many}
            </span>
          </div>
          <span className="ev-spacer" />
          {roots.length > 1 && (
            <select
              className="small rt-jump"
              value=""
              onChange={(e) => {
                const r = e.target.value ? treeRect(e.target.value) : null;
                if (r) focusOn(r);
              }}
              aria-label="Jump to a source"
            >
              <option value="">Jump to a source…</option>
              {roots.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label.length > 48 ? `${r.label.slice(0, 46)}…` : r.label}
                </option>
              ))}
            </select>
          )}
          <span className="ev-hint" aria-hidden>
            scroll · ⌘/Ctrl + scroll to zoom · drag to pan
          </span>
          <button type="button" className="small secondary" onClick={() => zoomAt(1 / 1.25, width / 2, height / 2)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="small secondary" onClick={() => zoomAt(1.25, width / 2, height / 2)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="small secondary" onClick={fit} title="Fit every tree into the view">
            Fit
          </button>
        </div>
        <div className="ev-canvas" ref={wrap} style={{ height }}>
          <svg ref={svgRef} className={`ev-svg${dragging ? ' ev-dragging' : ''}`} width={width} height={height} role="group" aria-label={ariaLabel} style={{ fontFamily: FONT_FAMILY }} {...handlers}>
            <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
              <g className="ev-links">
                {strokes.map((st) => (
                  <g key={st.key}>
                    <title>{st.title}</title>
                    <path className="ev-link-hit" d={st.d} />
                    <path className={st.cls} d={st.d} />
                  </g>
                ))}
              </g>
              <g className="ev-link-labels">
                {layout.labels.map((l) => (
                  <text
                    key={`${l.parentKey}:${l.text}:${l.y}`}
                    className={`${isSection(l.type) ? 'rt-section' : 'ev-link-label'}${l.derived ? ' rt-section-derived' : ''}${dim && !path.has(l.parentKey) ? ' ev-dim' : ''}`}
                    x={l.x}
                    y={l.y}
                    textAnchor={l.anchor}
                    dominantBaseline="central"
                    fontSize={isSection(l.type) ? RT_FONTS.header : RT_FONTS.link}
                  >
                    {l.text}
                  </text>
                ))}
              </g>
              <g className="ev-nodes">
                {layout.nodes.map((n, i) => (
                  <Box key={n.key} n={n} index={i} highlighted={hlKeys.has(n.key)} faded={dim && !path.has(n.key)} onClick={() => onBox(n)} onKeyDown={(e) => onBoxKey(e, n)} onFocus={() => reveal({ l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.y - n.h / 2, b: n.y + n.h / 2 })} />
                ))}
              </g>
              <g className="rt-folds">
                {layout.nodes
                  .filter((n) => n.foldW)
                  .map((n) => (
                    <FoldControl key={n.key} n={n} faded={dim && !path.has(n.key)} onToggle={(e) => toggleFold(n, e)} />
                  ))}
              </g>
            </g>
          </svg>
          {empty && (
            <div className="ev-empty muted" role="status">
              {error ? 'The graph could not be read.' : 'The graph holds nothing from this run.'}
            </div>
          )}
          {focus && (
            <aside className="rt-details" aria-label="node details">
              <button className="small secondary rt-details-close" onClick={() => pick(focus.id)} aria-label="close the details">
                ×
              </button>
              <h4>
                <span className={`pill ${focus.labels[0]}`}>{focus.labels[0]}</span> {displayName(focus)}
              </h4>
              {focus.labels[0] === 'Look' && <FocusPhoto imageKey={String(focus.props.image_key ?? '')} thumbFor={thumbFor} alt={displayName(focus)} />}
              <p className="muted rt-details-meta">
                <code>{focus.id}</code>
                {graph.centers.includes(focus.id) && <span className="badge ok">{centerBadge}</span>}
                {copies > 1 && <span className="badge">drawn {copies}×, under every {noun.singular} that uses it</span>}
              </p>
              <dl className="kv">
                {Object.entries(focus.props)
                  .filter(([k]) => k !== 'embedding')
                  .map(([k, v]) => (
                    <KV key={k} k={k} v={v} />
                  ))}
              </dl>
              <h4>Relationships ({focus.neighbors.length})</h4>
              <div className="rt-details-edges">
                {focus.neighbors.map(({ edge, node }, i) => (
                  <div key={i} className="evidence-item" onClick={() => pickNeighbour(node.id)} onKeyDown={(e) => e.key === 'Enter' && pickNeighbour(node.id)} role="button" tabIndex={0}>
                    <span className="path">{edge.source === focus.id ? `-[:${edge.type}]->` : `<-[:${edge.type}]-`}</span> <span className={`pill ${node.labels[0]}`}>{node.labels[0]}</span> {displayName(node)}
                    {edge.props?.family && <div className="rationale">family: {edge.props.family}</div>}
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function Box({
  n,
  index,
  highlighted,
  faded,
  onClick,
  onKeyDown,
  onFocus,
}: {
  n: RtNode;
  index: number;
  highlighted: boolean;
  faded: boolean;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<SVGGElement>) => void;
  onFocus: () => void;
}) {
  const color = COLORS[n.role] ?? '#7d8998';
  const selectable = !!n.id;
  const cls = ['ev-node', 'rt-node', `rt-${n.role}`, n.derived && 'rt-derived', highlighted && 'ev-highlight', faded && 'ev-dim'].filter(Boolean).join(' ');
  const common = {
    className: cls,
    transform: `translate(${n.x - n.w / 2} ${n.y - n.h / 2})`,
    tabIndex: selectable ? 0 : undefined,
    role: selectable ? 'button' : undefined,
    'aria-label': selectable ? `${n.nodeLabel} ${n.label}${n.badges.length ? `, ${n.badges.map((b) => b.title).join(', ')}` : ''}${highlighted ? ' (selected)' : ''}` : undefined,
    onClick: selectable ? onClick : undefined,
    onKeyDown: selectable ? onKeyDown : undefined,
    onFocus: selectable ? onFocus : undefined,
  };
  if (n.stacked) {
    const pad = n.font * 0.6;
    let bx = n.w - pad;
    const badges = [...n.badges].reverse().map((b) => {
      bx -= b.w;
      const at = bx;
      bx -= BADGE_GAP;
      return { ...b, x: at };
    });
    const bh = RT_FONTS.badge * 1.45;
    return (
      <g {...common}>
        <title>{n.title}</title>
        {highlighted && <rect className="ev-ring" x={-3} y={-3} width={n.w + 6} height={n.h + 6} rx={7} />}
        <rect className="ev-box" width={n.w} height={n.h} rx={4} fill={n.derived ? '#fffaf2' : '#ffffff'} stroke={color} />
        <text className="ev-label" x={pad} y={n.h / 2} fontSize={n.font} dominantBaseline="central">
          {n.lines[0]}
        </text>
        {n.suffix && (
          <text className="ev-sub" x={pad + n.nameW + SUFFIX_GAP} y={n.h / 2} fontSize={RT_FONTS.badge} dominantBaseline="central">
            {n.suffix}
          </text>
        )}
        {badges.map((b) => (
          <g key={b.text}>
            <rect className={`rt-badge rt-badge-${b.kind}`} x={b.x} y={(n.h - bh) / 2} width={b.w} height={bh} rx={bh / 2} />
            <text className={`rt-badge-text rt-badge-text-${b.kind}`} x={b.x + b.w / 2} y={n.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={RT_FONTS.badge} fontWeight={600}>
              {b.text}
            </text>
          </g>
        ))}
      </g>
    );
  }
  const rows = textRows(n.font, n.lines.length, !!n.sub);
  const textX = (n.thumb ? THUMB + THUMB_GAP : 0) + rows.padX;
  const dy = (n.h - rows.height) / 2;
  const fill = n.role === 'item' ? tint(color, 0.12) : n.role === 'look' || n.role === 'article' ? tint(color, 0.1) : '#ffffff';
  const clip = `rt-thumb-${index}`;
  return (
    <g {...common}>
      <title>{n.title}</title>
      {highlighted && <rect className="ev-ring" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={9} />}
      <rect className="ev-box" width={n.w} height={n.h} rx={6} fill={fill} stroke={color} />
      {n.thumb && (
        <>
          <clipPath id={clip}>
            <rect x={4} y={4} width={THUMB} height={n.h - 8} rx={4} />
          </clipPath>
          <image href={n.thumb} x={4} y={4} width={THUMB} height={n.h - 8} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
        </>
      )}
      <text className="ev-label" fontSize={n.font} fontWeight={n.bold ? 600 : 400} dominantBaseline="central">
        {n.lines.map((line, i) => (
          <tspan key={i} x={textX} y={dy + rows.lineY[i]}>
            {line}
          </tspan>
        ))}
      </text>
      {n.sub && (
        <text className="ev-sub" x={textX} y={dy + rows.subY} dominantBaseline="central" fontSize={RT_FONTS.sub}>
          {n.sub}
        </text>
      )}
    </g>
  );
}

/** "+N" (children cut by the depth: unfold) or "−" (unfolded below the cut: fold), at the right end of a box's sub line. */
function FoldControl({ n, faded, onToggle }: { n: RtNode; faded: boolean; onToggle: (e: MouseEvent | KeyboardEvent) => void }) {
  const rows = textRows(n.font, n.lines.length, !!n.sub);
  const h = RT_FONTS.badge * 1.6;
  const x = n.x + n.w / 2 - rows.padX - n.foldW;
  const y = n.y - n.h / 2 + (n.h - rows.height) / 2 + rows.subY;
  return (
    <g
      className={`rt-fold${n.unfolded ? ' rt-fold-open' : ''}${faded ? ' ev-dim' : ''}`}
      transform={`translate(${x} ${y - h / 2})`}
      role="button"
      tabIndex={0}
      aria-label={n.unfolded ? `fold ${n.label}` : `show ${n.folded} more under ${n.label}`}
      aria-expanded={n.unfolded}
      onClick={onToggle}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onToggle(e);
      }}
    >
      <title>{n.foldTitle}</title>
      <rect width={n.foldW} height={h} rx={h / 2} />
      <text x={n.foldW / 2} y={h / 2} textAnchor="middle" dominantBaseline="central" fontSize={RT_FONTS.badge} fontWeight={600}>
        {n.unfolded ? '−' : `+${n.folded}`}
      </text>
    </g>
  );
}

function KV({ k, v }: { k: string; v: unknown }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
    </>
  );
}

/**
 * A look's photo at full size in the details panel: a source of this run (an example photo or an
 * upload, already loaded for the tree's thumbnails) or one of the brand's stored photos (a
 * lookbook look it connects to). Nothing for a look without a photo.
 */
function FocusPhoto({ imageKey, thumbFor, alt }: { imageKey: string; thumbFor?: (imageKey: string) => string | null | undefined; alt: string }) {
  if (!imageKey) return null;
  // an upload's key is upload:<its key in the bucket>; the run's sources name it without the prefix
  const local = thumbFor?.(imageKey) ?? thumbFor?.(imageKey.replace(/^upload:/, ''));
  if (local) return <img className="rt-details-photo" src={local} alt={`the photo of ${alt}`} />;
  if (isStoredPhotoKey(imageKey)) return <StoredPhoto photoKey={imageKey} alt={`the photo of ${alt}`} className="rt-details-photo" />;
  return null;
}
