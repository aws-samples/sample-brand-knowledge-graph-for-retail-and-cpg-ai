// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { OntologyView } from '../../api';
import fashion from './__fixtures__/fashion.view.json';
import {
  curveBetween,
  displayName,
  extentOf as extentOfNodes,
  fitCamera,
  FONTS,
  initialDepthFor,
  labelPadding,
  LEGIBLE_PX,
  localName,
  openingCamera,
  ROW,
  treeLayout,
  type Layout,
  type LayoutNode,
  type LayoutOptions,
  type Point,
} from './treeLayout';

/**
 * The layout is pure geometry, so its promises are checked here rather than by eye: boxes never
 * overlap, tree connectors never cross each other or run through a label, the depth cut and the
 * layer switches hide exactly what they say, and the opening view is legible.
 */

// Text width without a canvas: the average glyph of a UI font is ~0.55 em, bold ~0.6 em.
const measure = (text: string, font: number, bold: boolean) => text.length * font * (bold ? 0.6 : 0.55);

const base: LayoutOptions = { depth: 99, hierarchy: true, properties: false, individuals: false, schema: false, pinned: new Set(), measure };
const view = fashion as unknown as OntologyView;
const F = 'http://example.org/multimodal-ai-knowledge-graph/fashion#';

const IRI = 'http://example.org/t#';
const cls = (name: string, depth: number, root: string, extra: Partial<OntologyView['nodes'][number]> = {}) =>
  ({ id: IRI + name, key: name, label: name, kind: 'class' as const, depth, root, visual: true, individuals: 0, ...extra }) as OntologyView['nodes'][number];
const sub = (child: string, parent: string) => ({ source: IRI + child, target: IRI + parent, type: 'subClassOf' as const, label: 'subClassOf' });

/** Two roots, one deep branch, one value class with individuals, two object properties. */
const tiny: OntologyView = {
  id: 't',
  name: 'tiny',
  iri: IRI,
  version: '',
  license: '',
  source: '',
  comment: '',
  prefixes: {},
  nodes: [
    cls('Thing', 0, 'Thing'),
    cls('Garment', 1, 'Thing'),
    cls('Jacket', 2, 'Thing'),
    cls('Coat', 2, 'Thing'),
    cls('Parka', 3, 'Thing'),
    cls('Attribute', 0, 'Attribute'),
    cls('Colour', 1, 'Attribute', { individuals: 2 }),
    cls('Schema', 0, 'Schema', { visual: false }),
    { id: IRI + 'red', key: 'red', label: 'red', kind: 'individual', types: [IRI + 'Colour'], root: 'Attribute', depth: 2, visual: true },
    { id: IRI + 'blue', key: 'blue', label: 'blue', kind: 'individual', types: [IRI + 'Colour'], root: 'Attribute', depth: 2, visual: true },
    { id: IRI + 'hasColour', key: 'hasColour', label: 'hasColour', kind: 'objectProperty', domain: [IRI + 'Garment'], range: [IRI + 'Colour'], visual: true },
    { id: IRI + 'pairsWith', key: 'pairsWith', label: 'pairsWith', kind: 'objectProperty', domain: [IRI + 'Jacket'], range: [IRI + 'Coat'], visual: true },
    { id: IRI + 'hidden', key: 'hidden', label: 'hidden', kind: 'objectProperty', domain: [IRI + 'Schema'], range: [IRI + 'Garment'], visual: false },
  ],
  edges: [
    sub('Garment', 'Thing'),
    sub('Jacket', 'Garment'),
    sub('Coat', 'Garment'),
    sub('Parka', 'Coat'),
    sub('Colour', 'Attribute'),
    { source: IRI + 'red', target: IRI + 'Colour', type: 'type', label: 'a' },
    { source: IRI + 'blue', target: IRI + 'Colour', type: 'type', label: 'a' },
    { source: IRI + 'Garment', target: IRI + 'Colour', type: 'property', label: 'hasColour', property: IRI + 'hasColour' },
    { source: IRI + 'Jacket', target: IRI + 'Coat', type: 'property', label: 'pairsWith', property: IRI + 'pairsWith' },
    { source: IRI + 'Schema', target: IRI + 'Garment', type: 'property', label: 'hidden', property: IRI + 'hidden' },
  ],
  stats: {},
};

const names = (layout: Layout) => layout.nodes.filter((n) => !n.attached).map((n) => localName(n.id)).sort();
const at = (l: Layout, name: string) => l.byId.get(IRI + name)!;

describe('treeLayout: filters', () => {
  it('cuts the hierarchy at the requested depth and counts what is folded away', () => {
    const l0 = treeLayout(tiny, { ...base, depth: 0 });
    expect(names(l0)).toEqual(['Attribute', 'Thing']);
    expect(at(l0, 'Thing').hiddenChildren).toBe(1); // Garment
    expect(l0.counts.hiddenClasses).toBe(5);
    const l1 = treeLayout(tiny, { ...base, depth: 1 });
    expect(names(l1)).toEqual(['Attribute', 'Colour', 'Garment', 'Thing']);
    expect(at(l1, 'Garment').hiddenChildren).toBe(2); // Jacket, Coat
    expect(at(l1, 'Colour').hiddenChildren).toBe(2); // red, blue (values off)
    expect(treeLayout(tiny, base).maxDepth).toBe(3);
  });

  it('"values" adds the individuals under their class; "KG schema" adds fo:visual false concepts', () => {
    expect(treeLayout(tiny, base).counts.values).toBe(0);
    const values = treeLayout(tiny, { ...base, individuals: true });
    expect(values.counts.values).toBe(2);
    expect(at(values, 'red').parentId).toBe(IRI + 'Colour');
    expect(values.links.filter((l) => l.kind === 'type')).toHaveLength(2);
    expect(names(treeLayout(tiny, base))).not.toContain('Schema');
    const schema = treeLayout(tiny, { ...base, schema: true, properties: true });
    expect(names(schema)).toContain('Schema');
    expect(schema.counts.properties).toBe(3);
  });

  it('"properties" is off by default: no property links, until switched on', () => {
    const off = treeLayout(tiny, base);
    expect(off.links.filter((l) => l.kind === 'property')).toHaveLength(0);
    expect(off.counts.properties).toBe(0);
    const on = treeLayout(tiny, { ...base, properties: true });
    expect(on.links.filter((l) => l.kind === 'property')).toHaveLength(2);
    expect(on.counts.properties).toBe(2);
    const fashionOff = treeLayout(view, { ...base, depth: 2, individuals: true });
    expect(fashionOff.links.filter((l) => l.kind === 'property')).toHaveLength(0);
  });

  it('with properties off, only the properties touching an emphasised node are drawn (and not counted)', () => {
    const l = treeLayout(tiny, { ...base, pinned: new Set([IRI + 'Garment']) });
    const props = l.links.filter((k) => k.kind === 'property');
    expect(props.map((k) => localName(k.property!))).toEqual(['hasColour']);
    expect(l.counts.properties).toBe(0);
    const byProperty = treeLayout(tiny, { ...base, pinned: new Set([IRI + 'pairsWith']) });
    expect(byProperty.links.filter((k) => k.kind === 'property').map((k) => localName(k.property!))).toEqual(['pairsWith']);
  });

  it('"classes" off keeps only the classes a property touches, without tree connectors', () => {
    const propsOnly = treeLayout(tiny, { ...base, hierarchy: false, properties: true });
    expect(names(propsOnly)).toEqual(['Coat', 'Colour', 'Garment', 'Jacket']);
    expect(propsOnly.links.filter((l) => l.kind === 'tree')).toHaveLength(0);
    expect(propsOnly.links.filter((l) => l.kind === 'property')).toHaveLength(2);
    expect(treeLayout(tiny, { ...base, hierarchy: false }).nodes).toHaveLength(0); // nothing to draw
  });

  it('a highlighted concept hidden by the filters is attached to its nearest visible ancestor', () => {
    const l = treeLayout(tiny, { ...base, depth: 1, pinned: new Set([IRI + 'Parka', IRI + 'red']) });
    const parka = at(l, 'Parka');
    expect(parka.attached).toBe(true);
    expect(parka.parentId).toBe(IRI + 'Garment'); // Coat is cut away, Garment is the nearest drawn ancestor
    expect(parka.y).toBeGreaterThan(at(l, 'Garment').y);
    expect(at(l, 'red').parentId).toBe(IRI + 'Colour');
    expect(l.links.filter((k) => k.kind === 'attach')).toHaveLength(2);
    expect(l.counts.classes).toBe(4); // attached nodes do not count as drawn classes
    expect(boxOverlaps(l)).toEqual([]);
  });
});

describe('treeLayout: names', () => {
  it('classes are named by their IRI, values by their human label', () => {
    const jacket = view.nodes.find((n) => n.id.endsWith('#Jacket'))!;
    expect(displayName(jacket)).toBe('Jacket');
    const blazer = view.nodes.find((n) => n.id.endsWith('#nickname_blazer'))!;
    expect(blazer.kind).toBe('individual');
    expect(displayName(blazer)).toBe('blazer');
    expect(localName(blazer.id)).toBe('nickname_blazer');
    // the box is sized for the displayed name
    const l = treeLayout(view, { ...base, depth: 2, individuals: true });
    const box = l.byId.get(blazer.id)!;
    expect(box.font).toBe(FONTS.value);
    expect(box.width).toBeCloseTo(measure('blazer', FONTS.value, false) + 2 * labelPadding(FONTS.value), 6);
  });
});

describe('treeLayout: geometry', () => {
  it('puts the roots side by side on the top row, in ontology order, and every child below its parent', () => {
    for (const l of [treeLayout(tiny, { ...base, individuals: true, schema: true }), treeLayout(view, { ...base, depth: 2, individuals: true })]) {
      const roots = l.nodes.filter((n) => !n.parentId);
      expect(roots.every((r) => r.root && r.y === 0 && r.level === 0)).toBe(true);
      const xs = roots.map((r) => r.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect(Math.min(...l.nodes.map((n) => n.y))).toBe(0);
      for (const n of l.nodes) {
        if (!n.parentId) continue;
        const p = l.byId.get(n.parentId)!;
        expect(n.y, localName(n.id)).toBeGreaterThan(p.y);
        expect(n.level).toBe(p.level + 1);
      }
    }
    // Occasion (the sample's own, version 1.2.0) has no superclass: a root of its own
    expect(treeLayout(view, base).nodes.filter((n) => n.root).map((n) => localName(n.id))).toEqual(['Apparel', 'Attribute', 'GarmentComponent', 'Occasion']);
  });

  it('spreads children that have children of their own on the next row, parent centred above them', () => {
    const l = treeLayout(view, { ...base, depth: 2 });
    const apparel = l.byId.get(F + 'Apparel')!;
    const kids = l.nodes.filter((n) => n.parentId === apparel.id);
    expect(kids.length).toBe(9);
    expect(kids.every((k) => k.y === apparel.y + ROW && !k.stacked)).toBe(true);
    for (let i = 1; i < kids.length; i++) expect(kids[i].x - kids[i].width / 2).toBeGreaterThan(kids[i - 1].x + kids[i - 1].width / 2 + 15);
    expect(apparel.x).toBeCloseTo((kids[0].x + kids[kids.length - 1].x) / 2, 6);
  });

  it('stacks leaf children in a column under their parent, starting right of its left edge', () => {
    const l = treeLayout(tiny, { ...base, individuals: true });
    const colour = at(l, 'Colour');
    const [red, blue] = [at(l, 'red'), at(l, 'blue')];
    expect(red.stacked && blue.stacked).toBe(true);
    expect(red.x - red.width / 2).toBeCloseTo(blue.x - blue.width / 2, 9); // one column, left-aligned
    expect(red.x - red.width / 2).toBeGreaterThan(colour.x - colour.width / 2);
    expect(red.y).toBeGreaterThan(colour.y + colour.height / 2);
    expect(blue.y - red.y).toBeCloseTo(FONTS.value * 1.9, 6);
    // mixed children: the leaf (Jacket) goes in a column left of the subtree (Coat → Parka), on the same row
    const [garment, jacket, coat] = [at(l, 'Garment'), at(l, 'Jacket'), at(l, 'Coat')];
    expect(jacket.stacked).toBe(true);
    expect(coat.stacked).toBe(false);
    expect(jacket.y).toBe(coat.y);
    expect(coat.y).toBe(garment.y + ROW);
    expect(jacket.x).toBeLessThan(coat.x);
    expect(garment.x).toBeGreaterThan(jacket.x - jacket.width / 2);
    expect(garment.x).toBeLessThan(coat.x);
  });

  it('wraps a very long stack into several columns (153 nicknames)', () => {
    const l = treeLayout(view, { ...base, depth: 2, individuals: true });
    const nicknames = l.nodes.filter((n) => n.parentId === F + 'Nickname');
    expect(nicknames.length).toBe(153);
    const columns = new Set(nicknames.map((n) => Math.round(n.x - n.width / 2)));
    expect(columns.size).toBeGreaterThan(1);
    for (const left of columns) expect(nicknames.filter((n) => Math.round(n.x - n.width / 2) === left).length).toBeLessThanOrEqual(24);
  });

  const cases: [string, OntologyView, Partial<LayoutOptions>][] = [
    ['fashion, first view', view, { depth: initialDepthFor(view) }],
    ['fashion, every class', view, { depth: 2 }],
    ['fashion, every class + values', view, { depth: 99, individuals: true }],
    ['fashion, with the KG schema', view, { depth: 99, schema: true, individuals: true }],
    ['fashion, properties only', view, { depth: 2, hierarchy: false, properties: true }],
    ['fashion, pinned values with values off', view, { depth: 1, pinned: new Set([F + 'nickname_blazer', F + 'Jacket', F + 'Sleeve']) }],
    ['tiny, values', tiny, { individuals: true }],
    ['tiny, pinned', tiny, { depth: 1, pinned: new Set([IRI + 'Parka', IRI + 'red']) }],
  ];

  it.each(cases)('no two boxes overlap: %s', (_, v, opts) => {
    const l = treeLayout(v, { ...base, ...opts });
    expect(l.nodes.length).toBeGreaterThan(0);
    const overlaps = boxOverlaps(l);
    expect(overlaps, overlaps.map(([a, b]) => `${localName(a.id)} × ${localName(b.id)}`).join(', ')).toEqual([]);
  });

  it.each(cases)('tree connectors are orthogonal and never cross: %s', (_, v, opts) => {
    const l = treeLayout(v, { ...base, ...opts });
    const segs = connectorSegments(l);
    for (const s of segs) expect(s.a[0] === s.b[0] || s.a[1] === s.b[1], `diagonal segment of ${s.link}`).toBe(true);
    const crossings: string[] = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[i].link !== segs[j].link && properlyCross(segs[i], segs[j])) crossings.push(`${segs[i].link} × ${segs[j].link}`);
      }
    }
    expect(crossings.slice(0, 5)).toEqual([]);
  });

  it.each(cases)('no tree connector runs through a box other than its own two: %s', (_, v, opts) => {
    const l = treeLayout(v, { ...base, ...opts });
    const hits: string[] = [];
    for (const s of connectorSegments(l)) {
      for (const n of l.nodes) {
        if (n.id === s.source || n.id === s.target) continue;
        if (segmentHitsBox(s, n)) hits.push(`${s.link} through ${localName(n.id)}`);
      }
    }
    expect(hits.slice(0, 5)).toEqual([]);
  });

  it('every tree connector starts on its parent box and ends on its child box', () => {
    const l = treeLayout(view, { ...base, depth: 2, individuals: true, pinned: new Set([F + 'Sleeve']) });
    for (const k of l.links.filter((k) => k.kind === 'tree' || k.kind === 'type' || k.kind === 'attach')) {
      const [child, parent] = k.kind === 'attach' ? [l.byId.get(k.target)!, l.byId.get(k.source)!] : [l.byId.get(k.source)!, l.byId.get(k.target)!];
      const path = k.path!;
      expect(onBoxEdge(path[0], parent)).toBe(true);
      expect(onBoxEdge(path[path.length - 1], child)).toBe(true);
    }
  });

  it('opens at the deepest cut that keeps the class count readable', () => {
    expect(initialDepthFor(view)).toBe(1); // 26 classes at depth 1, 72 at depth 2
    expect(initialDepthFor(view, 100)).toBe(2);
    expect(initialDepthFor(tiny)).toBe(3); // small ontology: everything
    expect(initialDepthFor({ ...tiny, nodes: tiny.nodes.filter((n) => (n.depth ?? 0) === 0) })).toBe(0); // roots only
  });
});

describe('treeLayout: camera', () => {
  it('the first view fits the whole tree into 700×600 with legible labels', () => {
    const l = treeLayout(view, { ...base, depth: initialDepthFor(view) });
    expect(l.counts.classes).toBeLessThanOrEqual(40);
    const cam = openingCamera(l, 700, 600);
    expect(cam.whole).toBe(true);
    expect(cam.zoom * FONTS.leaf).toBeGreaterThanOrEqual(LEGIBLE_PX);
    expectInView(cam, l.extent, 700, 600);
  });

  it('a tree too wide to read when fitted opens at a legible zoom, roots at the top, on the first root', () => {
    for (const opts of [{ depth: 2 }, { depth: 99, individuals: true }]) {
      const l = treeLayout(view, { ...base, ...opts });
      expect(fitCamera(l.extent, 700, 600).zoom * FONTS.leaf).toBeLessThan(LEGIBLE_PX);
      const cam = openingCamera(l, 700, 600);
      expect(cam.whole).toBe(false);
      expect(cam.zoom * FONTS.leaf).toBeGreaterThanOrEqual(LEGIBLE_PX);
      const viewTop = cam.y - 300 / cam.zoom;
      expect(viewTop).toBeLessThan(l.extent.minY); // the top row is in view…
      expect(l.extent.minY - viewTop).toBeLessThan(80 / cam.zoom); // …at the top of the canvas
      const apparel = l.byId.get(F + 'Apparel')!;
      expect(Math.abs(apparel.x - cam.x)).toBeLessThan(350 / cam.zoom - apparel.width / 2); // the first root is in view
      expect(cam.x - 350 / cam.zoom).toBeGreaterThanOrEqual(l.extent.minX - 20 / cam.zoom); // no empty margin on the left
    }
  });

  it('a tall, narrow tree opens on its top rows, fitted', () => {
    // a chain of 12 classes, the last one with 20 subclasses: too tall to read when fitted
    const chain: OntologyView = {
      ...tiny,
      nodes: [...Array.from({ length: 12 }, (_, i) => cls(`C${i}`, i, 'C0')), ...Array.from({ length: 20 }, (_, i) => cls(`Leaf${i}`, 12, 'C0'))],
      edges: [...Array.from({ length: 11 }, (_, i) => sub(`C${i + 1}`, `C${i}`)), ...Array.from({ length: 20 }, (_, i) => sub(`Leaf${i}`, 'C11'))],
    };
    const l = treeLayout(chain, base);
    expect(fitCamera(l.extent, 700, 600).zoom * FONTS.leaf).toBeLessThan(LEGIBLE_PX);
    const cam = openingCamera(l, 700, 600);
    expect(cam.whole).toBe(false);
    expect(cam.zoom * FONTS.leaf).toBeGreaterThanOrEqual(LEGIBLE_PX);
    expectInView(cam, extentOfNodes(l.nodes.filter((n) => n.level <= 1)), 700, 600);
  });

  it('"Fit" fits everything, whatever the zoom', () => {
    const l = treeLayout(view, { ...base, depth: 99, individuals: true, schema: true });
    expectInView(fitCamera(l.extent, 700, 600), l.extent, 700, 600);
  });
});

describe('treeLayout: property curves', () => {
  it('runs from the source box to the target box; a self-reference is a loop on the box', () => {
    const l = treeLayout(tiny, { ...base, properties: true, individuals: true });
    const colour = l.links.find((k) => k.property === IRI + 'hasColour')!;
    expect(colour.path).toHaveLength(4);
    expect(onBoxEdge(colour.path![0], at(l, 'Garment'))).toBe(true);
    expect(onBoxEdge(colour.path![3], at(l, 'Colour'))).toBe(true);
    const box = at(l, 'Thing');
    const loop = curveBetween(box, box);
    expect(onBoxEdge(loop[0], box) && onBoxEdge(loop[3], box)).toBe(true);
    expect(loop[1][0]).toBeGreaterThan(box.x + box.width / 2);
  });

  it('joins two boxes of one row by an arc over the row, and enters a stacked leaf from the side', () => {
    const l = treeLayout(view, { ...base, depth: 2, individuals: true, properties: true });
    const [upper, length] = [l.byId.get(F + 'UpperBodyGarment')!, l.byId.get(F + 'Length')!];
    expect(upper.y).toBe(length.y);
    const arc = l.links.find((k) => k.property === F + 'hasLength' && k.source === upper.id)!.path!;
    expect(arc[0][1]).toBe(upper.y - upper.height / 2);
    expect(arc[1][1]).toBeLessThan(arc[0][1]); // leaves upwards…
    expect(arc[2][1]).toBeLessThan(arc[3][1]); // …and comes down into the target
    const d1 = treeLayout(view, { ...base, depth: 1, properties: true });
    const [legs, nickname] = [d1.byId.get(F + 'LegsAndFeetwear')!, d1.byId.get(F + 'Nickname')!];
    expect(legs.stacked && nickname.stacked).toBe(true);
    const side = d1.links.find((k) => k.property === F + 'hasNickname' && k.source === legs.id)!.path!;
    expect(side[0]).toEqual([legs.x + legs.width / 2, legs.y]); // right side of the source, towards the target
    expect(side[3]).toEqual([nickname.x - nickname.width / 2, nickname.y]); // left side of the target
  });
});

// ---------------------------------------------------------------------- helpers
type Seg = { a: Point; b: Point; link: string; source: string; target: string };

/** All segments of the tree / type / attach connectors, tagged with their link. */
function connectorSegments(l: Layout): Seg[] {
  const out: Seg[] = [];
  for (const k of l.links) {
    if (k.kind !== 'tree' && k.kind !== 'type' && k.kind !== 'attach') continue;
    const p = k.path!;
    const link = `${localName(k.source)}→${localName(k.target)}`;
    for (let i = 1; i < p.length; i++) out.push({ a: p[i - 1], b: p[i], link, source: k.source, target: k.target });
  }
  return out;
}

/** Proper crossing: each segment has the other's endpoints strictly on opposite sides (T-junctions and shared buses do not count). */
function properlyCross(s: Seg, t: Seg): boolean {
  const side = (p: Point, q: Point, r: Point) => {
    const c = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(c) < 1e-9 ? 0 : Math.sign(c);
  };
  return side(s.a, s.b, t.a) * side(s.a, s.b, t.b) < 0 && side(t.a, t.b, s.a) * side(t.a, t.b, s.b) < 0;
}

/** Does an axis-aligned segment enter the interior of a node's box? */
function segmentHitsBox(s: Seg, n: LayoutNode): boolean {
  const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
  const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
  const e = 0.5;
  return x1 > n.x - n.width / 2 + e && x0 < n.x + n.width / 2 - e && y1 > n.y - n.height / 2 + e && y0 < n.y + n.height / 2 - e;
}

function boxOverlaps(l: Layout): [LayoutNode, LayoutNode][] {
  const out: [LayoutNode, LayoutNode][] = [];
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const [a, b] = [l.nodes[i], l.nodes[j]];
      const apartX = Math.abs(a.x - b.x) >= (a.width + b.width) / 2;
      const apartY = Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
      if (!apartX && !apartY) out.push([a, b]);
    }
  }
  return out;
}

function onBoxEdge([x, y]: Point, n: LayoutNode): boolean {
  const [l, r, t, b] = [n.x - n.width / 2, n.x + n.width / 2, n.y - n.height / 2, n.y + n.height / 2];
  const near = (u: number, w: number) => Math.abs(u - w) < 1e-6;
  const inX = x >= l - 1e-6 && x <= r + 1e-6;
  const inY = y >= t - 1e-6 && y <= b + 1e-6;
  return ((near(y, t) || near(y, b)) && inX) || ((near(x, l) || near(x, r)) && inY);
}

function expectInView(cam: { x: number; y: number; zoom: number }, e: Layout['extent'], w: number, h: number) {
  const toScreen = (x: number, y: number) => [w / 2 + (x - cam.x) * cam.zoom, h / 2 + (y - cam.y) * cam.zoom];
  const [sx0, sy0] = toScreen(e.minX, e.minY);
  const [sx1, sy1] = toScreen(e.maxX, e.maxY);
  expect(sx0).toBeGreaterThanOrEqual(0);
  expect(sy0).toBeGreaterThanOrEqual(0);
  expect(sx1).toBeLessThanOrEqual(w);
  expect(sy1).toBeLessThanOrEqual(h);
}
