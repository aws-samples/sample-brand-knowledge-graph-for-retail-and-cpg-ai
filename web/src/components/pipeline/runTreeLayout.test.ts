// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import hops1 from './__fixtures__/runGraph.hops1.json';
import hops2 from './__fixtures__/runGraph.hops2.json';
import { runTreeLayout, statementSnippet, type RunGraph, type RunTreeLayout } from './runTreeLayout';

/** A real run (six sources: three texts and the three photos they describe) read back from the graph. */
const g1 = hops1 as unknown as RunGraph;
const g2 = hops2 as unknown as RunGraph;

type Rect = { l: number; r: number; t: number; b: number; what: string };
type Seg = { x1: number; y1: number; x2: number; y2: number; link: string; parent: string };

const boxes = (l: RunTreeLayout): Rect[] => [
  ...l.nodes.map((n) => ({ l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.y - n.h / 2, b: n.y + n.h / 2, what: `box ${n.key}` })),
  ...l.labels.map((x) => {
    const left = x.anchor === 'middle' ? x.x - x.w / 2 : x.x;
    return { l: left, r: left + x.w, t: x.y - x.h / 2, b: x.y + x.h / 2, what: `label ${x.parentKey}:${x.text}` };
  }),
];

const segments = (l: RunTreeLayout): Seg[] =>
  l.links.flatMap((k) =>
    k.points.slice(1).map((p, i) => ({ x1: k.points[i][0], y1: k.points[i][1], x2: p[0], y2: p[1], link: `${k.from}→${k.to}`, parent: k.from })),
  );

const overlaps = (a: Rect, b: Rect) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;

/** A vertical and a horizontal segment that cross in their interiors (shared end points do not count). */
function crosses(a: Seg, b: Seg): boolean {
  const va = Math.abs(a.x1 - a.x2) < 1e-6;
  const vb = Math.abs(b.x1 - b.x2) < 1e-6;
  if (va === vb) return false; // parallel: lines of one parent share their trunk, that is not a crossing
  const [v, h] = va ? [a, b] : [b, a];
  const x = v.x1;
  const y = h.y1;
  const inside = (p: number, lo: number, hi: number) => p > Math.min(lo, hi) + 0.5 && p < Math.max(lo, hi) - 0.5;
  return inside(x, h.x1, h.x2) && inside(y, v.y1, v.y2);
}

/** Does a segment run through a box (not its own end boxes)? */
function cutsBox(s: Seg, r: Rect): boolean {
  const [l, rr, t, b] = [r.l + 0.5, r.r - 0.5, r.t + 0.5, r.b - 0.5];
  if (Math.abs(s.x1 - s.x2) < 1e-6) return s.x1 > l && s.x1 < rr && Math.max(s.y1, s.y2) > t && Math.min(s.y1, s.y2) < b;
  return s.y1 > t && s.y1 < b && Math.max(s.x1, s.x2) > l && Math.min(s.x1, s.x2) < rr;
}

function checkClean(l: RunTreeLayout) {
  const rects = boxes(l);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j]), `${rects[i].what} overlaps ${rects[j].what}`).toBe(false);
  const segs = segments(l);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].parent === segs[j].parent) continue; // siblings share their parent's trunk and bus
      expect(crosses(segs[i], segs[j]), `${segs[i].link} crosses ${segs[j].link}`).toBe(false);
    }
  }
  const keyBox = new Map(l.nodes.map((n) => [n.key, n]));
  for (const k of l.links) {
    for (const s of segments({ ...l, links: [k] })) {
      for (const n of l.nodes) {
        if (n.key === k.from || n.key === k.to) continue;
        expect(cutsBox(s, { l: n.x - n.w / 2, r: n.x + n.w / 2, t: n.y - n.h / 2, b: n.y + n.h / 2, what: n.key }), `${s.link} runs through ${n.key}`).toBe(false);
      }
    }
    expect(keyBox.has(k.from) && keyBox.has(k.to)).toBe(true);
  }
  for (const k of l.links) for (let i = 1; i < k.points.length; i++) {
    const [a, b] = [k.points[i - 1], k.points[i]];
    expect(Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6, `${k.from}→${k.to} is orthogonal`).toBe(true);
  }
}

describe('runTreeLayout', () => {
  it('draws one tree per source: article → statement → garments, look → garments, every new garment once', () => {
    const l = runTreeLayout(g1);
    const roots = l.nodes.filter((n) => n.parentKey === null);
    expect(roots.map((r) => r.role)).toEqual(['article', 'article', 'article', 'look', 'look', 'look']);
    const newItems = g1.centers.filter((c) => g1.nodes.find((n) => n.id === c)?.labels[0] === 'Item');
    const drawn = l.nodes.filter((n) => n.role === 'item').map((n) => n.id);
    expect([...drawn].sort()).toEqual([...newItems].sort());
    // the trench article: its statement holds the ten garments the text describes
    const trench = roots[0];
    expect(trench.label).toBe('Three ways to wear the trench this autumn');
    const st = l.nodes.find((n) => n.parentKey === trench.key)!;
    expect(st.role).toBe('statement');
    expect(st.lines[0]).toMatch(/^The trench coat is the one piece/);
    expect(l.nodes.filter((n) => n.parentKey === st.key && n.role === 'item')).toHaveLength(10);
    // a garment's column is exactly its category, components and values
    const coat = l.nodes.find((n) => n.id === 'item:5e9403d5-e1-coat')!;
    const feats = l.nodes.filter((n) => n.parentKey === coat.key);
    const want = g1.edges.filter((e) => e.source === coat.id && ['IS_CATEGORY', 'HAS_PART', 'HAS_ATTRIBUTE'].includes(e.type)).map((e) => e.target);
    expect(feats.map((f) => f.id).sort()).toEqual([...new Set(want)].sort());
    expect(feats.every((f) => f.stacked && f.x - f.w / 2 > coat.x - coat.w / 2)).toBe(true);
    expect(l.lines).toEqual(['Utility']);
  });

  it('marks vocabulary several garments share (×N) and lays the forest out without overlaps or crossings', () => {
    const l = runTreeLayout(g1, { rowWidth: 1500 });
    const plain = l.nodes.filter((n) => n.id === 'attribute:textile-pattern:plain');
    expect(plain.length).toBeGreaterThan(3); // drawn under every garment that uses it
    expect(plain.every((n) => n.badges.some((b) => b.kind === 'shared' && b.text === `×${plain.length}`))).toBe(true);
    expect(new Set(plain.map((n) => n.key)).size).toBe(plain.length);
    expect(l.stats.shared).toBeGreaterThan(5);
    checkClean(l);
  });

  it('puts the garments of a wide source in tiers, reached by a spine, and keeps the layout clean', () => {
    const l = runTreeLayout(g1, { rowWidth: 900 });
    const st = l.nodes.find((n) => n.role === 'statement' && n.lines[0].startsWith('The trench coat'))!;
    const tops = new Set(l.nodes.filter((n) => n.parentKey === st.key).map((n) => Math.round(n.y - n.h / 2)));
    expect(tops.size).toBeGreaterThan(1);
    expect(l.labels.filter((x) => x.parentKey === st.key && x.text === 'ILLUSTRATES').length).toBe(tops.size);
    checkClean(l);
    expect(l.width).toBeLessThan(1000);
  });

  it('two hops out: lists the closest catalog items under each garment, dashed', () => {
    const l = runTreeLayout(g2, { hops: 2, rowWidth: 1500 });
    const related = l.nodes.filter((n) => n.role === 'related');
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((n) => n.derived && /^\d+ shared$/.test(n.suffix))).toBe(true);
    const perItem = new Map<string, number>();
    for (const r of related) perItem.set(r.parentKey!, (perItem.get(r.parentKey!) ?? 0) + 1);
    expect(Math.max(...perItem.values())).toBeLessThanOrEqual(3);
    expect(l.links.filter((k) => k.derived).length).toBe(related.length);
    expect(l.nodes.some((n) => n.badges.some((b) => b.kind === 'more'))).toBe(true);
    // two hops out the graph has 54 catalog items more, but the tree still has one box per garment
    expect(l.nodes.filter((n) => n.role === 'item')).toHaveLength(runTreeLayout(g1).stats.items);
    checkClean(l);
  });

  it('cuts every tree at a depth, folds what it cuts into "+N", and unfolds single boxes through `open`', () => {
    const full = runTreeLayout(g2, { hops: 2, rowWidth: 1500 });
    expect(full.maxDepth).toBe(4);
    expect(runTreeLayout(g1).maxDepth).toBe(3);
    const roles = (l: RunTreeLayout) => new Set(l.nodes.map((n) => n.role));
    // depth 0: the six sources, each folding its statement or its garments, named in the domain's words (neutral: items)
    const d0 = runTreeLayout(g2, { hops: 2, rowWidth: 1500, depth: 0 });
    expect(d0.nodes.map((n) => n.role)).toEqual(['article', 'article', 'article', 'look', 'look', 'look']);
    expect(d0.nodes.every((n) => n.folded > 0 && n.foldW > 0 && !n.unfolded)).toBe(true);
    expect(d0.nodes.find((n) => n.role === 'look')!.foldTitle).toMatch(/^\d+ items below the depth cut/);
    expect(d0.nodes.find((n) => n.role === 'article')!.foldTitle).toMatch(/^1 statement below the depth cut/);
    const fashion = runTreeLayout(g2, { hops: 2, rowWidth: 1500, depth: 0, noun: { singular: 'garment', plural: 'garments' } });
    expect(fashion.nodes.find((n) => n.role === 'look')!.foldTitle).toMatch(/^\d+ garments below the depth cut/);
    // depth 2: garments, no columns; each garment folds exactly its column
    const d2 = runTreeLayout(g2, { hops: 2, rowWidth: 1500, depth: 2 });
    expect(roles(d2)).toEqual(new Set(['article', 'statement', 'look', 'item']));
    for (const it of d2.nodes.filter((n) => n.role === 'item')) {
      expect(it.folded).toBe(full.nodes.filter((n) => n.parentKey === it.key).length);
    }
    // depth 3: everything but the catalog items, which fold into their garment
    const d3 = runTreeLayout(g2, { hops: 2, rowWidth: 1500, depth: 3 });
    expect(roles(d3).has('related')).toBe(false);
    expect(d3.nodes.filter((n) => n.role === 'attribute').length).toBe(full.nodes.filter((n) => n.role === 'attribute').length);
    // the counts describe the whole run, whatever the cut
    for (const l of [d0, d2, d3]) expect(l.stats).toEqual(full.stats);
    // a hidden node is folded into every box it hangs under
    const plain = d2.foldedInto.filter((f) => f.id === 'attribute:textile-pattern:plain');
    expect(plain.length).toBe(full.nodes.filter((n) => n.id === 'attribute:textile-pattern:plain').length);
    expect(plain.every((f) => d2.nodes.find((n) => n.key === f.key)?.role === 'item')).toBe(true);
    // unfold one garment at depth 2: its column comes back (catalog items included), the rest stay folded
    const coat = d2.nodes.find((n) => n.id === 'item:5e9403d5-e1-coat')!;
    const opened = runTreeLayout(g2, { hops: 2, rowWidth: 1500, depth: 2, open: new Set([coat.key]) });
    const coat2 = opened.nodes.find((n) => n.key === coat.key)!;
    expect(coat2.unfolded && coat2.folded === 0).toBe(true);
    expect(opened.nodes.filter((n) => n.parentKey === coat.key).length).toBe(coat.folded);
    expect(opened.nodes.filter((n) => n.stacked && n.parentKey !== coat.key)).toHaveLength(0);
    // every cut is as clean as the full tree
    for (const l of [d0, d2, d3, opened]) checkClean(l);
  });

  it('copes with a run whose sources are not in view, and with nothing at all', () => {
    const item = g1.nodes.find((n) => n.id === 'item:5e9403d5-e1-coat')!;
    const lone: RunGraph = { centers: [item.id], nodes: [item], edges: [] };
    const l = runTreeLayout(lone);
    expect(l.nodes.map((n) => n.role)).toEqual(['source', 'item']);
    const empty = runTreeLayout({ centers: [], nodes: [], edges: [] });
    expect(empty.nodes).toEqual([]);
    expect(empty.width).toBeGreaterThan(0);
  });

  it('reads the words of a statement, not its heading and byline', () => {
    expect(statementSnippet('# Title\n\n_AnyCompany Apparel Journal · editorial · 2026-09-14_\n\nThe **trench** coat is cut\ndouble breasted.')).toBe('The trench coat is cut double breasted.');
  });
});

describe('runTreeLayout: an article about a look', () => {
  it('draws the look its statement ILLUSTRATES under the statement, with its photo', () => {
    const graph = {
      centers: ['article:9f8e7d6c', 'st:9f8e7d6c-1', 'item:9f8e7d6c-e1-shoe'],
      nodes: [
        { id: 'article:9f8e7d6c', labels: ['Article'], props: { title: 'White sneakers with a denim skirt', source: 'AnyCompany Fashion House Journal' } },
        { id: 'st:9f8e7d6c-1', labels: ['Statement'], props: { text: 'The look we kept coming back to…', article: 'article:9f8e7d6c' } },
        { id: 'item:9f8e7d6c-e1-shoe', labels: ['Item'], props: { name: 'white leather sneaker' } },
        { id: 'look:1a2b3c4d', labels: ['Look'], props: { name: 'denim skirt look', image_key: 'example:fashion_1.jpg' } },
      ],
      edges: [
        { source: 'article:9f8e7d6c', target: 'st:9f8e7d6c-1', type: 'HAS_STATEMENT', props: {} },
        { source: 'st:9f8e7d6c-1', target: 'item:9f8e7d6c-e1-shoe', type: 'ILLUSTRATES', props: {} },
        { source: 'st:9f8e7d6c-1', target: 'look:1a2b3c4d', type: 'ILLUSTRATES', props: {} },
      ],
    } as unknown as RunGraph;
    const layout = runTreeLayout(graph, { thumbFor: (k) => (k === 'example:fashion_1.jpg' ? 'data:image/jpeg;base64,AA' : null) });
    const look = layout.nodes.find((n) => n.id === 'look:1a2b3c4d');
    expect(look).toBeDefined();
    expect(look!.thumb).toBe('data:image/jpeg;base64,AA');
    expect(layout.links.some((l) => l.to === look!.key && l.type === 'ILLUSTRATES')).toBe(true);
    // the garment the text names is still drawn under the statement
    expect(layout.nodes.some((n) => n.id === 'item:9f8e7d6c-e1-shoe')).toBe(true);
  });
});
