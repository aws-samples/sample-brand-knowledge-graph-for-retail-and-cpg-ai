// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { OntoEdge, OntoNode, OntologyView } from '../../api';

/**
 * Deterministic top-down tree layout ("org chart") for an ontology view.
 *
 * The rules, in the order they are applied:
 *  1. Roots sit side by side on the top row, in the order of the ontology; every subClassOf
 *     level below is one row (ROW graph units) lower.
 *  2. Tidy tree: a node whose children have children of their own spreads them horizontally on
 *     the next row and sits centered above the first and last of them. Every subtree owns a
 *     vertical *band* of the picture and sibling bands are placed side by side, so nothing in one
 *     subtree can ever collide with another subtree, however deep it grows.
 *  3. Compact org chart: leaf children (no drawn children of their own, values included) are
 *     stacked in a column hanging off a vertical rail, instead of being spread out. This keeps the
 *     tree narrow. Next to spread subtrees the column comes first (left); very long columns wrap
 *     into several columns of at most MAX_COLUMN items.
 *  4. Connectors are orthogonal elbows only: down from the parent to a horizontal bus, across,
 *     and down into the child (spread), or a rail with a short tick into each leaf (stack). They
 *     stay inside their subtree's band and between rows, so tree lines never cross each other or
 *     a label. Only multiple inheritance and object properties can cross the tree: they are thin
 *     dashed curves, and only drawn on demand (the properties switch, or an emphasized node).
 *
 * Every node is a horizontal label box; `x`/`y` is the center of the box. All sizes are in graph
 * units (1 unit = 1 px at zoom 1), so the text zooms with the boxes.
 */
export type LayoutOptions = {
  /** Show classes with depth <= this (0 = roots only). */
  depth: number;
  hierarchy: boolean;
  properties: boolean;
  individuals: boolean;
  schema: boolean;
  /** IRIs that must be drawn even when the filters hide them (highlighted by the image side). */
  pinned: Set<string>;
  /** Text width in graph units for a label at a font size. */
  measure: (text: string, font: number, bold: boolean) => number;
};

export type Point = [number, number];

export type LayoutNode = {
  id: string;
  node: OntoNode;
  /** Tree level: 0 = the roots on the top row. */
  level: number;
  /** Center of the label box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** No drawn children (the label carries a "+N" badge when children are hidden). */
  leaf: boolean;
  /** On the top row: drawn as a box filled with its root color. */
  root: boolean;
  /** In a column under its parent: the connector comes in from the left (rail + tick). */
  stacked: boolean;
  font: number;
  bold: boolean;
  parentId: string | null;
  /** Subclasses / values not drawn because of the depth cut or the layer switches. */
  hiddenChildren: number;
  /** Drawn only because it is highlighted (hangs off its nearest visible ancestor). */
  attached: boolean;
};

export type LayoutLink = {
  source: string;
  target: string;
  kind: 'tree' | 'type' | 'extra' | 'attach' | 'property';
  property?: string;
  label?: string;
  /**
   * tree / type / attach: orthogonal polyline from the parent box to the child box.
   * property / extra: cubic Bézier `[start, control1, control2, end]` (see `curveBetween`).
   */
  path?: Point[];
};

export type Extent = { minX: number; minY: number; maxX: number; maxY: number };

export type Layout = {
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  links: LayoutLink[];
  /** Bounding box of all label boxes. */
  extent: Extent;
  /** Deepest class depth in the whole ontology (drives the depth slider). */
  maxDepth: number;
  counts: { classes: number; values: number; properties: number; hiddenClasses: number };
};

export const FONTS = { root: 12, inner: 11, leaf: 10, value: 8.5 } as const;

/** Vertical distance between two rows of the tidy tree (center to center). */
export const ROW = 64;
/** Horizontal gap between sibling subtrees. */
const SIBLING_GAP = 18;
/** Horizontal gap between two root subtrees on the top row. */
const ROOT_GAP = 40;
/** Gap between two columns of the same stack. */
const COLUMN_GAP = 14;
/** The rail of a stack starts this far right of its parent's left edge. */
const INDENT = 10;
/** Rail → left edge of a stacked leaf. */
const TICK = 8;
/** Parent's bottom edge → first stacked leaf, when the stack hangs right under its parent. */
const STACK_TOP = 10;
/** Longer stacks wrap into several columns. */
const MAX_COLUMN = 24;
/** Gap between a label and its "+N" badge. */
const BADGE_GAP = 4;

/** Height of one stacked item (its box plus the gap to the next one). */
const pitch = (font: number) => font * 1.9;
/** Height of a label box; roots are a little taller. */
const boxHeight = (font: number, root: boolean) => font * 1.5 + (root ? 4 : 0);
/** Horizontal padding inside a label box, on each side. */
export const labelPadding = (font: number) => font * 0.6;

export function localName(iri: string): string {
  const s = iri.split(/[#/]/).pop();
  return s || iri;
}

/**
 * What is written in a node's box. Classes are named by their IRI local name (it *is* the label,
 * e.g. `UpperBodyGarment`); values carry a human label (`blazer`) that beats their IRI local
 * name (`nickname_blazer`).
 */
export function displayName(n: OntoNode): string {
  if (n.kind === 'individual' && n.label && n.label.toLowerCase() !== localName(n.id).toLowerCase()) return n.label;
  return localName(n.id);
}

// ---------------------------------------------------------------------- internal tree

/** A drawn node while the layout is computed: sizes first, then band offsets, then positions. */
type TNode = {
  id: string;
  n: OntoNode;
  parent: TNode | null;
  level: number;
  /** Drawn children, attached ones last. */
  kids: TNode[];
  attached: boolean;
  hidden: number;
  font: number;
  bold: boolean;
  w: number;
  h: number;
  x: number;
  y: number;
  stacked: boolean;
  /** Width of the band owned by this subtree. */
  band: number;
  /** Left edge of the box, as an offset from the band's left edge. */
  boxLeft: number;
  /** Leaf children, stacked in columns (rule 3). */
  stack: Stack | null;
  /** Children with children of their own, spread on the next row (rule 2). */
  spread: { kid: TNode; left: number }[];
};
type Column = { items: TNode[]; /** rail offset from the stack's left edge */ rail: number; /** absolute rail x */ x: number };
type Stack = { /** offset from the band's left edge */ left: number; columns: Column[]; width: number };

const hasKids = (t: TNode) => t.kids.length > 0;

export function treeLayout(view: OntologyView, o: LayoutOptions): Layout {
  const v = visibleForest(view, o);
  if (!v.roots.length) return empty(v.maxDepth);

  // 1. the drawn tree, plus the pinned concepts hanging off their nearest drawn ancestor
  const drawn = new Map<string, TNode>();
  const build = (id: string, parent: TNode | null): TNode => {
    const t = newNode(id, v.byIri.get(id)!, parent, false);
    drawn.set(id, t);
    t.kids = (v.children.get(id) ?? []).map((c) => build(c, t));
    return t;
  };
  const forest = v.roots.map((r) => build(r, null));
  attachPinned(view, o.pinned, v.byIri, drawn);

  // 2. label boxes
  for (const t of drawn.values()) {
    const drawnKids = v.children.get(t.id)?.length ?? 0;
    sizeBox(t, drawnKids, Math.max(0, (v.childCount.get(t.id) ?? 0) - drawnKids), o.measure);
  }

  // 3. bands (post-order), then positions (pre-order); root bands side by side on the top row
  let cursor = 0;
  for (const r of forest) {
    measure(r);
    r.y = 0;
    place(r, cursor);
    cursor += r.band + ROOT_GAP;
  }

  // 4. orthogonal connectors
  const paths = new Map<string, Point[]>();
  forest.forEach((r) => connect(r, paths));

  const nodes = [...drawn.values()].map((t) => toLayoutNode(t, !(v.children.get(t.id)?.length)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = treeLinks(drawn, paths, o.hierarchy);

  // 5. the links that may cross the tree: extra parents and object properties
  const touchesPinned = (...ids: (string | undefined)[]) => ids.some((id) => !!id && o.pinned.has(id));
  if (o.hierarchy) {
    for (const [c, p] of v.extraParents) {
      if (!byId.has(c) || !byId.has(p) || !(o.properties || touchesPinned(c, p))) continue;
      links.push({ source: c, target: p, kind: 'extra', label: 'subClassOf', path: curveBetween(byId.get(c)!, byId.get(p)!) });
    }
  }
  const bothDrawn = (e: OntoEdge) => byId.has(e.source) && byId.has(e.target);
  const toggled = o.properties ? v.propertyEdges.filter(bothDrawn) : [];
  const emphasised = o.properties ? [] : v.propertyEdges.filter((e) => bothDrawn(e) && touchesPinned(e.source, e.target, e.property));
  for (const e of [...toggled, ...emphasised]) {
    links.push({ source: e.source, target: e.target, kind: 'property', property: e.property, label: e.label, path: curveBetween(byId.get(e.source)!, byId.get(e.target)!) });
  }

  const drawnClasses = nodes.filter((n) => n.node.kind === 'class' && !n.attached).length;
  return {
    nodes,
    byId,
    links,
    extent: extentOf(nodes),
    maxDepth: v.maxDepth,
    counts: {
      classes: drawnClasses,
      values: nodes.filter((n) => n.node.kind === 'individual' && !n.attached).length,
      // what the properties switch shows; edges drawn only because a node is emphasized do not count
      properties: new Set(toggled.map((e) => e.property)).size,
      hiddenClasses: v.classes.filter((n) => n.visual !== false || o.schema).length - drawnClasses,
    },
  };
}

// ---------------------------------------------------------------------- what is visible

type Visible = {
  byIri: Map<string, OntoNode>;
  classes: OntoNode[];
  maxDepth: number;
  roots: string[];
  /** Drawn children per node (subclasses first, then values), in ontology order. */
  children: Map<string, string[]>;
  /** Further visible parents of a class (multiple inheritance), as [child, parent]. */
  extraParents: [string, string][];
  /** All children (drawn or not) per class, for the "+N" badge. */
  childCount: Map<string, number>;
  /** Object-property edges that pass the KG-schema switch. */
  propertyEdges: OntoEdge[];
};

/** Which classes and values pass the filters, and the tree they form (the first parent wins). */
function visibleForest(view: OntologyView, o: LayoutOptions): Visible {
  const byIri = new Map(view.nodes.map((n) => [n.id, n]));
  const classes = view.nodes.filter((n) => n.kind === 'class');
  const maxDepth = classes.reduce((m, n) => Math.max(m, n.depth ?? 0), 0);

  const classShown = (n: OntoNode) => n.kind === 'class' && (n.visual !== false || o.schema) && (n.depth ?? 0) <= o.depth;
  let visibleClasses = new Set(classes.filter(classShown).map((n) => n.id));
  const propertyEdges = view.edges.filter((e) => {
    if (e.type !== 'property' || !e.property) return false;
    const p = byIri.get(e.property);
    return !!p && (p.visual !== false || o.schema);
  });
  if (!o.hierarchy) {
    // Properties-only view: keep the classes that take part in a drawn property.
    const shown = o.properties ? propertyEdges.filter((e) => visibleClasses.has(e.source) && visibleClasses.has(e.target)) : [];
    const touched = new Set(shown.flatMap((e) => [e.source, e.target]));
    visibleClasses = new Set([...visibleClasses].filter((id) => touched.has(id)));
  }

  const parentOf = new Map<string, string>();
  const extraParents: [string, string][] = [];
  const childCount = new Map<string, number>();
  for (const e of view.edges) {
    if (e.type === 'subClassOf') {
      childCount.set(e.target, (childCount.get(e.target) ?? 0) + 1);
      if (visibleClasses.has(e.source) && visibleClasses.has(e.target)) {
        if (!parentOf.has(e.source)) parentOf.set(e.source, e.target);
        else extraParents.push([e.source, e.target]);
      }
    } else if (e.type === 'type') {
      childCount.set(e.target, (childCount.get(e.target) ?? 0) + 1);
    }
  }
  const individuals = new Map<string, string>(); // individual -> class it hangs on
  if (o.individuals) {
    for (const e of view.edges) {
      if (e.type === 'type' && visibleClasses.has(e.target) && !individuals.has(e.source) && byIri.get(e.source)?.kind === 'individual') individuals.set(e.source, e.target);
    }
  }

  const children = new Map<string, string[]>();
  const push = (p: string, c: string) => children.set(p, [...(children.get(p) ?? []), c]);
  const roots: string[] = [];
  for (const id of visibleClasses) {
    const p = parentOf.get(id);
    if (p) push(p, id);
    else roots.push(id);
  }
  for (const [ind, cls] of individuals) push(cls, ind);
  return { byIri, classes, maxDepth, roots, children, extraParents, childCount, propertyEdges };
}

function newNode(id: string, n: OntoNode, parent: TNode | null, attached: boolean): TNode {
  return {
    id,
    n,
    parent,
    level: parent ? parent.level + 1 : 0,
    kids: [],
    attached,
    hidden: 0,
    font: FONTS.leaf,
    bold: false,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    stacked: false,
    band: 0,
    boxLeft: 0,
    stack: null,
    spread: [],
  };
}

/**
 * Highlighted concepts hidden by the filters hang off their nearest drawn ancestor (as its last
 * children), so a box clicked in the image can always be traced back into the ontology.
 */
function attachPinned(view: OntologyView, pinned: Set<string>, byIri: Map<string, OntoNode>, drawn: Map<string, TNode>): void {
  for (const id of pinned) {
    if (drawn.has(id)) continue;
    const n = byIri.get(id);
    if (!n || (n.kind !== 'class' && n.kind !== 'individual')) continue;
    const anchor = nearestDrawnAncestor(view.edges, n, drawn);
    if (!anchor) continue;
    const t = newNode(id, n, anchor, true);
    anchor.kids.push(t);
    drawn.set(id, t);
  }
}

function nearestDrawnAncestor(edges: OntoEdge[], n: OntoNode, drawn: Map<string, TNode>): TNode | undefined {
  let cur = n.id;
  for (let hops = 0; hops < 12; hops++) {
    const up = n.kind === 'individual' && hops === 0 ? firstEdge(edges, cur, 'type') : firstEdge(edges, cur, 'subClassOf');
    if (!up) return undefined;
    const anchor = drawn.get(up);
    if (anchor) return anchor;
    cur = up;
  }
  return undefined;
}

/** Font and box size: roots 12 bold, classes with drawn subclasses 11 bold, leaves 10, values 8.5. */
function sizeBox(t: TNode, drawnKids: number, hidden: number, measure: LayoutOptions['measure']): void {
  const root = t.level === 0;
  if (t.n.kind === 'individual') [t.font, t.bold] = [FONTS.value, false];
  else if (root) [t.font, t.bold] = [FONTS.root, true];
  else if (drawnKids && !t.attached) [t.font, t.bold] = [FONTS.inner, true];
  else [t.font, t.bold] = [FONTS.leaf, false];
  t.hidden = t.attached ? 0 : hidden;
  const badge = t.hidden ? BADGE_GAP + measure(`+${t.hidden}`, t.font * 0.8, false) : 0;
  t.w = measure(displayName(t.n), t.font, t.bold) + badge + 2 * labelPadding(t.font);
  t.h = boxHeight(t.font, root);
}

// ---------------------------------------------------------------------- bands (post-order)

/** How wide is the band of each subtree, and where do the box, the stack and the subtrees sit in it. */
function measure(t: TNode): void {
  const inner = t.kids.filter(hasKids);
  const leaves = t.kids.filter((k) => !hasKids(k));
  inner.forEach(measure);
  if (!t.kids.length) t.band = t.w;
  else if (!inner.length) measureStackOnly(t, leaves);
  else measureSpread(t, leaves, inner);
}

/** Rule 3: only leaves below. The box sits at the left of its band, the stack hangs off a rail under it. */
function measureStackOnly(t: TNode, leaves: TNode[]): void {
  const stack = stackOf(leaves);
  stack.left = Math.min(INDENT, t.w / 2); // the rail leaves from the parent's bottom edge
  t.stack = stack;
  t.boxLeft = 0;
  t.band = Math.max(t.w, stack.left + stack.width);
}

/**
 * Rule 2: the row below is [stack of leaves?] [subtree] [subtree] …, separated by SIBLING_GAP.
 * The parent is centered between the first and last places its connector goes down to (the rails
 * of the stack, the box centers of the subtrees); if it is wider than that, the row moves right.
 */
function measureSpread(t: TNode, leaves: TNode[], inner: TNode[]): void {
  const anchors: number[] = [];
  let cursor = 0;
  if (leaves.length) {
    t.stack = stackOf(leaves);
    anchors.push(...t.stack.columns.map((c) => c.rail));
    cursor = t.stack.width + SIBLING_GAP;
  }
  for (const kid of inner) {
    t.spread.push({ kid, left: cursor });
    anchors.push(cursor + kid.boxLeft + kid.w / 2);
    cursor += kid.band + SIBLING_GAP;
  }
  const span = cursor - SIBLING_GAP;
  const centre = (anchors[0] + anchors[anchors.length - 1]) / 2;
  const shift = Math.max(0, t.w / 2 - centre);
  if (t.stack) t.stack.left += shift;
  for (const s of t.spread) s.left += shift;
  t.boxLeft = centre + shift - t.w / 2;
  t.band = Math.max(span + shift, t.boxLeft + t.w);
}

/** Leaves in columns of at most MAX_COLUMN items, balanced, side by side. */
function stackOf(leaves: TNode[]): Stack {
  const per = Math.ceil(leaves.length / Math.ceil(leaves.length / MAX_COLUMN));
  const columns: Column[] = [];
  let rail = 0;
  for (let i = 0; i < leaves.length; i += per) {
    const items = leaves.slice(i, i + per);
    columns.push({ items, rail, x: 0 });
    rail += TICK + Math.max(...items.map((k) => k.w)) + COLUMN_GAP;
  }
  return { left: 0, columns, width: rail - COLUMN_GAP };
}

// ---------------------------------------------------------------------- positions (pre-order)

/** Absolute positions; `left` is the left edge of t's band and t.y is set by the caller. */
function place(t: TNode, left: number): void {
  t.x = left + t.boxLeft + t.w / 2;
  if (t.stack) placeStack(t, t.stack, left + t.stack.left);
  for (const s of t.spread) {
    s.kid.y = t.y + ROW;
    place(s.kid, left + s.left);
  }
}

/** Beside spread subtrees the stack starts on the children's row; alone, right under its parent. */
function placeStack(t: TNode, stack: Stack, left: number): void {
  const first = stack.columns[0].items[0];
  const top = t.spread.length ? t.y + ROW - pitch(first.font) / 2 : t.y + t.h / 2 + STACK_TOP;
  for (const col of stack.columns) {
    col.x = left + col.rail;
    let y = top;
    for (const item of col.items) {
      item.x = col.x + TICK + item.w / 2;
      item.y = y + pitch(item.font) / 2;
      item.stacked = true;
      y += pitch(item.font);
    }
  }
}

// ---------------------------------------------------------------------- connectors

/** Rule 4: the orthogonal connector from t to each of its children, keyed by the child. */
function connect(t: TNode, out: Map<string, Point[]>): void {
  const bottom = t.y + t.h / 2;
  if (t.spread.length) {
    // down to the bus half way to the next row, across, then down into each child
    const bus = t.y + ROW / 2;
    const drop: Point[] = [[t.x, bottom], [t.x, bus]];
    for (const { kid } of t.spread) out.set(kid.id, polyline([...drop, [kid.x, bus], [kid.x, kid.y - kid.h / 2]]));
    for (const col of t.stack?.columns ?? []) {
      for (const item of col.items) out.set(item.id, polyline([...drop, [col.x, bus], ...tick(col, item)]));
    }
  } else if (t.stack) {
    // the first rail runs straight down from the parent; further columns hang off a short bus
    const [first, ...rest] = t.stack.columns;
    const bus = bottom + STACK_TOP / 2;
    for (const item of first.items) out.set(item.id, polyline([[first.x, bottom], ...tick(first, item)]));
    for (const col of rest) {
      for (const item of col.items) out.set(item.id, polyline([[first.x, bottom], [first.x, bus], [col.x, bus], ...tick(col, item)]));
    }
  }
  t.spread.forEach(({ kid }) => connect(kid, out));
}

/** Down the rail to the item's middle, then right into its left edge. */
const tick = (col: Column, item: TNode): Point[] => [
  [col.x, item.y],
  [item.x - item.w / 2, item.y],
];

/**
 * Snaps coordinates that differ from the previous point by rounding noise only, then drops
 * repeated points (a child straight below its parent has no elbow): every segment stays exactly
 * horizontal or vertical.
 */
function polyline(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const [x, y] of points) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push([x, y]);
      continue;
    }
    const p: Point = [Math.abs(x - prev[0]) < 1e-6 ? prev[0] : x, Math.abs(y - prev[1]) < 1e-6 ? prev[1] : y];
    if (p[0] !== prev[0] || p[1] !== prev[1]) out.push(p);
  }
  return out;
}

function treeLinks(drawn: Map<string, TNode>, paths: Map<string, Point[]>, hierarchy: boolean): LayoutLink[] {
  const links: LayoutLink[] = [];
  for (const t of drawn.values()) {
    if (!t.parent) continue;
    const path = paths.get(t.id);
    if (t.attached) links.push({ source: t.parent.id, target: t.id, kind: 'attach', path });
    else if (t.n.kind === 'individual') links.push({ source: t.id, target: t.parent.id, kind: 'type', label: 'a', path });
    else if (hierarchy) links.push({ source: t.id, target: t.parent.id, kind: 'tree', label: 'subClassOf', path });
  }
  return links;
}

type Box = Pick<LayoutNode, 'x' | 'y' | 'width' | 'height' | 'stacked'>;

/**
 * Cubic Bézier `[start, control1, control2, end]` for a link that is not part of the tree.
 * Each end leaves its box where the box has room: a stacked leaf from the side facing the other
 * box (its column has neighbours above and below), any other box from its top edge, a little
 * towards the other box (the bottom edge and the top center belong to tree connectors). Two
 * boxes on one row are thus joined by an arc over the row rather than a line through it.
 * A self-reference is a small loop on the box's right side.
 */
export function curveBetween(a: Box, b: Box): Point[] {
  if (a.x === b.x && a.y === b.y) {
    const r = a.x + a.width / 2;
    const q = a.height / 4;
    return [[r, a.y - q], [r + 18, a.y - q - 10], [r + 18, a.y + q + 10], [r, a.y + q]];
  }
  const [p0, t0] = curveEnd(a, b);
  const [p3, t3] = curveEnd(b, a);
  const k = clamp(0.3 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), 18, 44);
  return [p0, [p0[0] + t0[0] * k, p0[1] + t0[1] * k], [p3[0] + t3[0] * k, p3[1] + t3[1] * k], p3];
}

/** Where a curve leaves `box` on its way to `other`, and its direction there. */
function curveEnd(box: Box, other: Box): [Point, Point] {
  const dir = other.x >= box.x ? 1 : -1;
  if (box.stacked) return [[box.x + (dir * box.width) / 2, box.y], [dir, 0]];
  return [[box.x + (dir * box.width) / 4, box.y - box.height / 2], [0, -1]];
}

function toLayoutNode(t: TNode, leaf: boolean): LayoutNode {
  return {
    id: t.id,
    node: t.n,
    level: t.level,
    x: t.x,
    y: t.y,
    width: t.w,
    height: t.h,
    leaf,
    root: t.level === 0,
    stacked: t.stacked,
    font: t.font,
    bold: t.bold,
    parentId: t.parent?.id ?? null,
    hiddenChildren: t.hidden,
    attached: t.attached,
  };
}

/** Bounding box of the label boxes of `nodes`. */
export function extentOf(nodes: Box[]): Extent {
  const e: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of nodes) {
    e.minX = Math.min(e.minX, n.x - n.width / 2);
    e.maxX = Math.max(e.maxX, n.x + n.width / 2);
    e.minY = Math.min(e.minY, n.y - n.height / 2);
    e.maxY = Math.max(e.maxY, n.y + n.height / 2);
  }
  return e.minX <= e.maxX ? e : { minX: -10, minY: -10, maxX: 10, maxY: 10 };
}

/**
 * Depth for the first view: the deepest cut that still shows at most `limit` classes, never
 * shallower than the first level below the roots. Deeper levels are one slider move away, and
 * the "+N" badges say what is folded.
 */
export function initialDepthFor(view: OntologyView, limit = 40): number {
  const classes = view.nodes.filter((n) => n.kind === 'class' && n.visual !== false);
  const maxDepth = classes.reduce((m, n) => Math.max(m, n.depth ?? 0), 0);
  let depth = Math.min(1, maxDepth);
  for (let d = 1; d <= maxDepth; d++) {
    if (classes.filter((n) => (n.depth ?? 0) <= d).length <= limit) depth = d;
    else break;
  }
  return depth;
}

function firstEdge(edges: OntoEdge[], source: string, type: OntoEdge['type']): string | undefined {
  return edges.find((e) => e.type === type && e.source === source)?.target;
}

function empty(maxDepth: number): Layout {
  return { nodes: [], byId: new Map(), links: [], extent: { minX: -10, minY: -10, maxX: 10, maxY: 10 }, maxDepth, counts: { classes: 0, values: 0, properties: 0, hiddenClasses: 0 } };
}

// ---------------------------------------------------------------------- camera

/** Where the canvas looks: center in graph units, zoom = screen px per graph unit. */
export type Camera = { x: number; y: number; zoom: number; /** everything is in view */ whole: boolean };

/** Smallest on-screen size (px) of a 10-unit leaf label that the opening view accepts. */
export const LEGIBLE_PX = 8;
/** Screen padding around the tree: room for the legend (top left) and the hint line (bottom). */
const PAD = { top: 52, side: 16, bottom: 28 };
export const ZOOM = { min: 0.05, max: 1.6 };

/** Zoom and center that fit `e` into a `w`×`h` canvas (the "Fit" button); a tree hangs from the top. */
export function fitCamera(e: Extent, w: number, h: number): Camera {
  const availW = Math.max(40, w - 2 * PAD.side);
  const availH = Math.max(40, h - PAD.top - PAD.bottom);
  const zoom = clamp(Math.min(availW / (e.maxX - e.minX), availH / (e.maxY - e.minY)), ZOOM.min, ZOOM.max);
  return { ...topAligned(e, (e.minX + e.maxX) / 2, zoom, h), whole: true };
}

/**
 * The view after a structural change, in order of preference:
 *  1. the whole tree, when it is legible that way;
 *  2. the top rows (roots + first level) fitted, roots at the top of the canvas;
 *  3. when even those are too wide: the legible zoom, roots at the top, centered on the roots row
 *     if it fits, else on the first root; the rest of the tree is a pan away ("Fit" shows all).
 */
export function openingCamera(l: Layout, w: number, h: number): Camera {
  const all = fitCamera(l.extent, w, h);
  const legible = (zoom: number) => zoom * FONTS.leaf >= LEGIBLE_PX;
  if (!l.nodes.length || legible(all.zoom)) return all;
  const top = extentOf(l.nodes.filter((n) => n.level <= 1));
  const fit = fitCamera(top, w, h).zoom;
  if (legible(fit)) return topAligned(l.extent, (top.minX + top.maxX) / 2, fit, h);
  const zoom = LEGIBLE_PX / FONTS.leaf;
  const roots = l.nodes.filter((n) => n.level === 0);
  const row = extentOf(roots);
  const half = (w / 2 - PAD.side) / zoom; // half the visible width, in graph units
  const x = row.maxX - row.minX <= 2 * half ? (row.minX + row.maxX) / 2 : clamp(roots[0].x, l.extent.minX + half, l.extent.maxX - half);
  return topAligned(l.extent, x, zoom, h);
}

/** Camera centered on `x` with the top of `e` just below the canvas's top padding. */
function topAligned(e: Extent, x: number, zoom: number, h: number): Camera {
  return { x, y: e.minY + (h / 2 - PAD.top) / zoom, zoom, whole: false };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
