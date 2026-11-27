// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { OntoNode, OntologyView } from '../../api';
import { displayName, fitCamera, initialDepthFor, labelPadding, localName, openingCamera, treeLayout, ZOOM, type Camera, type Layout, type LayoutLink, type LayoutNode, type Point } from './treeLayout';

export { localName };

/** Classes are colored by their top-level root; values, properties and the KG schema have fixed colors. */
const ROOT_PALETTE = ['#0972d3', '#ff9900', '#0d7f8f', '#d91515', '#5a9be0', '#8c6d1f', '#c33da5', '#2e8b57', '#b8860b'];
const C = { value: '#037f0c', property: '#7d2ef1', schema: '#7d8998', emphasis: '#ff9900', ink: '#16191f', dim: '#9aa5b1', path: '#414d5c' };
/**
 * Tree connectors are opaque: several children share their parent's drop and bus, so a
 * translucent color would get darker wherever lines overlap.
 */
const LINE = { tree: '#c0c6c9', treeDim: '#e5e8ea', type: '#a8d5ab', typeDim: '#e2efe3' };
const FONT_FAMILY = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const fontString = (size: number, bold: boolean) => `${bold ? 600 : 400} ${size}px ${FONT_FAMILY}`;

export type GraphFilter = { depth: number; hierarchy: boolean; properties: boolean; individuals: boolean; schema: boolean };

type GNode = { id: string; x: number; y: number; fx: number; fy: number; ln: LayoutNode };
type GLink = { source: string | GNode; target: string | GNode; ll: LayoutLink };

/**
 * The ontology as a top-down tree: roots on the top row, subclasses below, leaf classes and values
 * stacked in columns under their parent (see treeLayout.ts). Labels are boxes drawn in graph
 * units, so they zoom with the tree; the controls above the canvas cut the tree at a depth and
 * switch layers. Object properties are dashed curves, drawn when switched on or when they touch an
 * emphasized node.
 *
 * `highlight` = IRIs to emphasise (from the image side); `focus` = the selected element (a class,
 * value or property IRI). Clicking a node calls `onNodeClick`; the background clears the focus.
 */
export function OntologyGraph({
  view,
  highlight,
  focus,
  height = 600,
  onNodeClick,
}: {
  view: OntologyView;
  highlight: Set<string>;
  focus: string | null;
  height?: number;
  onNodeClick: (node: OntoNode | null) => void;
}) {
  const maxDepth = useMemo(() => view.nodes.reduce((m, n) => (n.kind === 'class' ? Math.max(m, n.depth ?? 0) : m), 0), [view]);
  // First view: the deepest cut that still keeps the class count readable at a glance; the
  // slider goes deeper on demand and the "+N" badges say what is folded away.
  const initialDepth = useMemo(() => initialDepthFor(view), [view]);
  const [filter, setFilter] = useState<GraphFilter>({ depth: initialDepth, hierarchy: true, properties: false, individuals: false, schema: false });
  useEffect(() => setFilter((f) => ({ ...f, depth: initialDepth })), [view, initialDepth]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // ---------------------------------------------------------------- canvas size
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 700, h: height });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // ---------------------------------------------------------------- emphasis
  const focusNode = useMemo(() => (focus ? view.nodes.find((n) => n.id === focus) ?? null : null), [view, focus]);
  const emphasis = useMemo(() => {
    const s = new Set(highlight);
    if (focus) s.add(focus);
    // a data property has no curve to light up: emphasise the classes it applies to
    if (focusNode?.kind === 'dataProperty') for (const d of focusNode.domain ?? []) s.add(d);
    return s;
  }, [highlight, focus, focusNode]);
  const dim = emphasis.size > 0;

  // ---------------------------------------------------------------- layout
  const measure = useMemo(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return (text: string, font: number, bold: boolean) => {
      if (!ctx) return text.length * font * 0.6;
      ctx.font = fontString(font, bold);
      return ctx.measureText(text).width;
    };
  }, []);
  const pinnedKey = Array.from(emphasis).sort().join('|');
  const layout: Layout = useMemo(
    () => treeLayout(view, { ...filter, pinned: emphasis, measure }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, filter, pinnedKey, measure],
  );
  const roots = useMemo(() => {
    const names = Array.from(new Set(view.nodes.filter((n) => n.kind === 'class' && n.visual !== false).map((n) => n.root ?? ''))).sort();
    return new Map(names.map((name, i) => [name, ROOT_PALETTE[i % ROOT_PALETTE.length]]));
  }, [view]);
  const colorOf = useCallback(
    (n: OntoNode) => (n.kind === 'individual' ? C.value : n.visual === false ? C.schema : roots.get(n.root ?? '') ?? ROOT_PALETTE[0]),
    [roots],
  );
  /** Ancestor chain of the focused node; its path to the root is drawn darker. */
  const pathIds = useMemo(() => {
    const s = new Set<string>();
    let cur = focus ? layout.byId.get(focus) : undefined;
    while (cur) {
      s.add(cur.id);
      cur = cur.parentId ? layout.byId.get(cur.parentId) : undefined;
    }
    return s;
  }, [focus, layout]);
  const data = useMemo(() => {
    // Links are painted in array order and siblings share their parent's connector, so the
    // emphasized ones go last: otherwise a gray sibling would paint over the dark path.
    const weight = (ll: LayoutLink) => {
      const [a, b] = [ll.source, ll.target];
      const kind = { type: 0, tree: 1, extra: 2, attach: 3, property: 4 }[ll.kind];
      return kind + (pathIds.has(a) && pathIds.has(b) ? 10 : 0) + (emphasis.has(a) && emphasis.has(b) ? 20 : 0);
    };
    return {
      nodes: layout.nodes.map<GNode>((ln) => ({ id: ln.id, x: ln.x, y: ln.y, fx: ln.x, fy: ln.y, ln })),
      links: [...layout.links].sort((p, q) => weight(p) - weight(q)).map<GLink>((ll) => ({ source: ll.source, target: ll.target, ll })),
    };
  }, [layout, pathIds, emphasis]);

  // ---------------------------------------------------------------- camera
  // "Home": the whole tree if legible, else its top rows (openingCamera). No wheel zoom, so the page scrolls over the map.
  const fgRef = useRef<any>(null);
  const moveTo = useCallback((cam: Camera, ms: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.centerAt(cam.x, cam.y, ms);
    fg.zoom(cam.zoom, ms);
  }, []);
  /** "Fit": everything in view, however small. */
  const fitAll = useCallback((ms: number) => layout.nodes.length && moveTo(fitCamera(layout.extent, size.w, size.h), ms), [layout, size, moveTo]);
  // The camera moves only when what is drawn changes (the depth, the layer switches, the size, Expand),
  // never for a click or a search: zooming to the picked name pushed the details off screen. The
  // pinned focus can add a node to the layout, so the key leaves the layout itself out.
  const viewKey = `${filter.depth}|${filter.hierarchy}|${filter.properties}|${filter.individuals}|${filter.schema}|${size.w}|${size.h}|${expanded}`;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const l = layoutRef.current;
    if (!l.nodes.length) return;
    const id = requestAnimationFrame(() => moveTo(openingCamera(l, size.w, size.h), 0));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewKey, moveTo, layout.nodes.length > 0]);

  // ---------------------------------------------------------------- drawing
  const drawNode = useCallback(
    (g: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const ln = g.ln;
      const inE = emphasis.has(ln.id) || ln.attached;
      const isHover = ln.id === hoverId;
      const faded = dim && !inE && !isHover && !pathIds.has(ln.id);
      const color = colorOf(ln.node);
      const left = g.x - ln.width / 2;
      ctx.globalAlpha = faded ? 0.45 : 1;

      // the box: roots filled with their color, everything else white with a colored border
      roundRect(ctx, left, g.y - ln.height / 2, ln.width, ln.height, ln.root ? 5 : 3.5);
      ctx.fillStyle = ln.root ? color : '#fff';
      ctx.fill();
      ctx.lineWidth = inE || isHover ? (ln.id === focus ? 2.6 : 2) : 1;
      ctx.strokeStyle = inE || isHover ? C.emphasis : color;
      if (ln.attached) ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (ln.font * scale < 3.5 && !inE && !isHover) {
        ctx.globalAlpha = 1;
        return; // too small to read at this zoom; the boxes still show the shape of the tree
      }
      const pad = labelPadding(ln.font);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = fontString(ln.font, ln.bold);
      ctx.fillStyle = ln.root ? '#fff' : faded ? C.dim : C.ink;
      ctx.fillText(displayName(ln.node), left + pad, g.y);
      if (ln.hiddenChildren) {
        // "+N": children folded away by the depth cut or the layer switches
        ctx.textAlign = 'right';
        ctx.font = fontString(ln.font * 0.8, false);
        ctx.fillStyle = ln.root ? 'rgba(255,255,255,0.85)' : C.dim;
        ctx.fillText(`+${ln.hiddenChildren}`, left + ln.width - pad, g.y);
      }
      ctx.globalAlpha = 1;
    },
    [emphasis, hoverId, dim, colorOf, focus, pathIds],
  );

  const paintPointerArea = useCallback((g: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    // the whole label box is clickable / hoverable
    ctx.fillStyle = color;
    ctx.fillRect(g.x - g.ln.width / 2, g.y - g.ln.height / 2, g.ln.width, g.ln.height);
  }, []);

  /** How loud a property / extra-parent curve is: 2 = it belongs to the focus (bold, labeled), 1 = touches an emphasized node, 0 = background. */
  const curveLevel = useCallback(
    (ll: LayoutLink): 0 | 1 | 2 => {
      const propertyOn = !!ll.property && emphasis.has(ll.property);
      const [s, t] = [ll.source, ll.target];
      if (propertyOn || (!!focus && (s === focus || t === focus)) || s === hoverId || t === hoverId || (emphasis.has(s) && emphasis.has(t))) return 2;
      return emphasis.has(s) || emphasis.has(t) ? 1 : 0;
    },
    [emphasis, focus, hoverId],
  );

  /** Property and extra-parent links: thin dashed curves, the only lines allowed to cross the tree. */
  const drawCurve = useCallback(
    (ll: LayoutLink, ctx: CanvasRenderingContext2D) => {
      const pts = ll.path;
      if (!pts || pts.length < 4) return;
      const level = curveLevel(ll);
      const alpha = level === 2 ? 0.95 : level === 1 || !dim ? 0.5 : 0.12;
      const rgb = ll.kind === 'property' ? '125,46,241' : '65,77,92';
      ctx.strokeStyle = `rgba(${rgb},${alpha})`;
      ctx.fillStyle = `rgba(${rgb},${alpha})`;
      ctx.lineWidth = level === 2 ? 1.5 : 0.9;
      ctx.setLineDash(level === 2 ? [5, 3] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawArrow(ctx, pts[2], pts[3], level === 2 ? 6 : 4);
    },
    [curveLevel, dim],
  );

  /**
   * Property names of the loud curves, painted after the boxes so they are never hidden. A focused
   * node's curves fan out from it, so each name sits at the curve's other end, where they are apart.
   */
  const drawPropertyLabels = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      if (9.5 * scale < 5) return;
      ctx.font = fontString(9.5, true);
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.fillStyle = C.property;
      for (const ll of layout.links) {
        if (ll.kind !== 'property' || !ll.property || !ll.path || curveLevel(ll) < 2) continue;
        const spot = labelSpot(ll.path, ll.target === focus && ll.source !== focus);
        ctx.textAlign = spot.align;
        ctx.strokeText(localName(ll.property), spot.x, spot.y);
        ctx.fillText(localName(ll.property), spot.x, spot.y);
      }
    },
    [layout, curveLevel, focus],
  );

  const drawLink = useCallback(
    (l: GLink, ctx: CanvasRenderingContext2D) => {
      const s = l.source as GNode;
      const t = l.target as GNode;
      if (typeof s !== 'object' || typeof t !== 'object') return;
      const ll = l.ll;
      if (ll.kind === 'property' || ll.kind === 'extra') return drawCurve(ll, ctx);
      // tree / type / attach: an orthogonal elbow from the parent's box to the child's box
      const [child, parent] = ll.kind === 'attach' ? [t, s] : [s, t];
      const strong = emphasis.has(child.id) && emphasis.has(parent.id);
      const onPath = pathIds.has(child.id) && pathIds.has(parent.id);
      traceRounded(ctx, ll.path ?? [[parent.x, parent.y], [child.x, child.y]], 4);
      if (ll.kind === 'attach') {
        ctx.strokeStyle = 'rgba(255,153,0,0.9)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
      } else if (ll.kind === 'type') {
        ctx.strokeStyle = strong ? C.value : onPath ? C.path : dim ? LINE.typeDim : LINE.type;
        ctx.lineWidth = strong || onPath ? 1.6 : 1;
      } else {
        ctx.strokeStyle = strong ? C.ink : onPath ? C.path : dim ? LINE.treeDim : LINE.tree;
        ctx.lineWidth = strong || onPath ? 1.6 : 1;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    },
    [emphasis, dim, pathIds, drawCurve],
  );

  // ---------------------------------------------------------------- controls + legend
  const set = (patch: Partial<GraphFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const legendRoots = useMemo(() => {
    const present = new Set(layout.nodes.filter((n) => n.node.kind === 'class' && n.node.visual !== false).map((n) => n.node.root ?? ''));
    return Array.from(roots.entries()).filter(([name]) => present.has(name));
  }, [layout, roots]);
  const showSchema = layout.nodes.some((n) => n.node.visual === false);

  return (
    <div className={`graph-panel${expanded ? ' expanded' : ''}`}>
      <div className="graph-controls">
        <label className="depth" title="Show classes down to this depth of the subClassOf hierarchy">
          <span>Depth</span>
          <input type="range" min={0} max={maxDepth} step={1} value={filter.depth} onChange={(e) => set({ depth: Number(e.target.value) })} aria-label="hierarchy depth" />
          <span className="muted">
            ≤ {filter.depth} of {maxDepth}
          </span>
        </label>
        <label className="check" title="Shows the subClassOf hierarchy. When off, the graph shows only classes that take part in a property.">
          <input type="checkbox" checked={filter.hierarchy} onChange={(e) => set({ hierarchy: e.target.checked })} /> classes
        </label>
        <label className="check" title="Shows object properties as dashed arrows from domain to range. The selected node always shows its properties.">
          <input type="checkbox" checked={filter.properties} onChange={(e) => set({ properties: e.target.checked })} /> properties
        </label>
        <label className="check" title="Shows the named individuals. They are the allowed values of the attribute properties.">
          <input type="checkbox" checked={filter.individuals} onChange={(e) => set({ individuals: e.target.checked })} /> values
        </label>
        <label className="check" title="Shows the classes and properties marked fo:visual false. They form the knowledge-graph schema. The vision model does not get them.">
          <input type="checkbox" checked={filter.schema} onChange={(e) => set({ schema: e.target.checked })} /> KG schema
        </label>
        <span className="spacer" />
        <button type="button" className="small secondary" onClick={() => fitAll(400)} title="Fit the whole ontology into the view">
          Fit
        </button>
        <button type="button" className="small secondary" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Back to the page (Esc)' : 'Fill the window'}>
          {expanded ? 'Close ✕' : 'Expand ⤢'}
        </button>
      </div>
      <div className="graph-wrap" ref={wrap} style={expanded ? undefined : { height }}>
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="#ffffff"
          cooldownTicks={0}
          warmupTicks={0}
          enableNodeDrag={false}
          enableZoomInteraction={false}
          minZoom={ZOOM.min}
          maxZoom={6}
          nodeRelSize={1}
          nodeVal={(g: any) => (g.ln.height / 2) ** 2}
          nodeLabel={(g: any) => tooltip(g.ln, view)}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={drawNode as any}
          nodePointerAreaPaint={paintPointerArea as any}
          linkCanvasObjectMode={() => 'replace'}
          linkCanvasObject={drawLink as any}
          linkPointerAreaPaint={() => undefined}
          onRenderFramePost={drawPropertyLabels}
          onNodeClick={(g: any) => onNodeClick(g.ln.node)}
          onNodeHover={(g: any) => setHoverId(g ? g.id : null)}
          onBackgroundClick={() => onNodeClick(null)}
        />
        <div className="graph-legend" aria-hidden>
          {legendRoots.map(([name, color]) => (
            <span key={name}>
              <i className="dot" style={{ background: color }} /> {name || 'class'}
            </span>
          ))}
          {filter.individuals && (
            <span>
              <i className="dot" style={{ background: C.value }} /> value
            </span>
          )}
          {filter.properties && (
            <span>
              <i className="dash" style={{ background: C.property }} /> property (domain → range)
            </span>
          )}
          {showSchema && (
            <span>
              <i className="dot" style={{ background: C.schema }} /> KG schema
            </span>
          )}
          <span className="counts">
            {layout.counts.classes} classes{layout.counts.hiddenClasses ? ` (+${layout.counts.hiddenClasses} deeper)` : ''} · {layout.counts.properties} properties
            {filter.individuals ? ` · ${layout.counts.values} values` : ''}
          </span>
        </div>
        {layout.nodes.length === 0 && (
          <div className="graph-empty muted" role="status">
            Nothing to draw. Switch <b>classes</b> or <b>properties</b> back on{filter.depth === 0 ? ', or move the depth slider' : ''}.
          </div>
        )}
        <div className="graph-hint muted" aria-hidden>
          drag to pan · click a name for its details
        </div>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A polyline with its elbows rounded off (radius r, smaller on short segments). */
function traceRounded(ctx: CanvasRenderingContext2D, pts: Point[], r: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const room = Math.min(Math.hypot(q[0] - p[0], q[1] - p[1]), Math.hypot(n[0] - q[0], n[1] - q[1])) / 2;
    ctx.arcTo(q[0], q[1], n[0], n[1], Math.min(r, room));
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

/** Filled arrowhead at `tip`, pointing away from `from`. */
function drawArrow(ctx: CanvasRenderingContext2D, from: Point, tip: Point, len: number) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] - Math.cos(ang - 0.4) * len, tip[1] - Math.sin(ang - 0.4) * len);
  ctx.lineTo(tip[0] - Math.cos(ang + 0.4) * len, tip[1] - Math.sin(ang + 0.4) * len);
  ctx.closePath();
  ctx.fill();
}

/**
 * Where a curve's label goes: just outside one end (the target's, or the source's when
 * `atSource`), on the side the curve arrives from, so the text runs away from the box.
 */
function labelSpot(pts: Point[], atSource: boolean): { x: number; y: number; align: CanvasTextAlign } {
  const [end, ctrl] = atSource ? [pts[0], pts[1]] : [pts[3], pts[2]];
  const len = Math.hypot(ctrl[0] - end[0], ctrl[1] - end[1]) || 1;
  const [dx, dy] = [(ctrl[0] - end[0]) / len, (ctrl[1] - end[1]) / len];
  if (Math.abs(dx) > 0.5) return { x: end[0] + dx * 10, y: end[1] - 7, align: dx > 0 ? 'left' : 'right' };
  return { x: end[0], y: end[1] + dy * 12, align: 'center' };
}

/** Hover tooltip (HTML). Everything comes from the ontology document, so it is escaped. */
function tooltip(ln: LayoutNode, view: OntologyView): string {
  const n = ln.node;
  const kind = n.kind === 'individual' ? 'value' : n.visual === false ? 'class · KG schema' : ln.leaf && !ln.hiddenChildren ? 'class (leaf)' : 'class';
  const lines = [`<b>${esc(displayName(n))}</b> <span class="muted">${kind}</span>`];
  if (n.kind === 'individual' && displayName(n) !== localName(n.id)) lines.push(`<code>${esc(localName(n.id))}</code>`);
  else if (n.pref_label && n.pref_label.toLowerCase() !== localName(n.id).toLowerCase()) lines.push(esc(n.pref_label));
  if (n.comment) lines.push(`<span class="muted">${esc(n.comment.length > 160 ? n.comment.slice(0, 157) + '…' : n.comment)}</span>`);
  if (n.kind === 'class') {
    const subs = view.edges.filter((e) => e.type === 'subClassOf' && e.target === n.id).length;
    const props = view.nodes.filter((p) => (p.kind === 'objectProperty' || p.kind === 'dataProperty') && p.domain?.includes(n.id)).length;
    const facts = [subs ? `${subs} subclasses` : '', n.individuals ? `${n.individuals} values` : '', props ? `${props} properties` : ''].filter(Boolean);
    if (facts.length) lines.push(`<span class="muted">${facts.join(' · ')}</span>`);
  }
  lines.push('<span class="muted">click for details</span>');
  return `<div class="onto-tip">${lines.join('<br/>')}</div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

