// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Edge, Node, Noun } from '../../api';
import { defaultMeasure, displayText, labelPadding, textRows, wrapText, type Measure } from '../shared/textLayout';
import type { Point } from '../tree/svg';

/**
 * Deterministic top-down layout of what one ingest run wrote (tab 2), drawn like the trees of
 * tabs 1 and 3: one tree per source, side by side, wrapping into rows.
 *
 *   Article ─HAS_STATEMENT→ Statement ─ILLUSTRATES→ Item …     (a text source)
 *   Look ─CONTAINS→ Item …                                     (a photo source)
 *   Item: a column of what the ontology resolved via IS_CATEGORY, HAS_PART, HAS_ATTRIBUTE
 *         (and, two hops out, the catalog items sharing the most of that vocabulary)
 *
 * Rules:
 *  - Sources sit on level 0, statements on level 1, the garments (Items) on the next level of
 *    their row; all boxes of a level are top-aligned and the feature columns start on one line.
 *  - Tidy tree: every subtree owns a vertical band, bands are packed left → right, a parent is
 *    centered over its first and last child. Bands never overlap, so no two lines ever cross.
 *  - The features of an Item hang in one column off a rail under its left edge (tab 1's compact
 *    org chart), in sections headed by the edge type.
 *  - A source with more garments than fit the row width puts them in tiers: tier 0 right under
 *    the source, every further tier under the deepest column of the one above, reached by a
 *    spine down the left edge of the source's band; still nothing crosses.
 *  - A category, component or value the graph holds once but several garments use is drawn under
 *    each of them (a tree has no shared children) and carries a "×N" badge; the renderer
 *    lights up every copy of a node when one is selected. Two hops out, "+N" counts the other
 *    items (catalog, earlier runs) on the same node.
 *  - Items a source holds from earlier runs (the ids derive from the content, so re-ingesting a
 *    text reuses its statement) are counted on the source, not drawn.
 *  - Depth cuts the trees by tier (depthStops): sources, statements, garments, what they
 *    resolved to, the closest catalog items. A box whose children are cut carries a "+N" fold
 *    control; `open` unfolds single boxes below the cut (they carry "−" to fold again).
 *
 * The texts name the items in the domain's words (`noun`, from its `domain.json`; this comment
 * says garments, as the fashion domain does). Every box is centered on `x`/`y`, sizes in graph
 * units; the drawing starts at (MARGIN, MARGIN).
 */

export type RunGraph = { centers: string[]; nodes: Node[]; edges: Edge[] };
type RunRole = 'article' | 'statement' | 'look' | 'source' | 'item' | 'category' | 'part' | 'attribute' | 'related';
type RtBadge = { text: string; kind: 'shared' | 'more'; w: number; title: string };

export type RtNode = {
  /** Unique per box: a node the graph holds once can be drawn under several garments. */
  key: string;
  /** The graph node id ('' for the box that collects items without a source). */
  id: string;
  role: RunRole;
  /** Graph label (Item, Category, Attribute, Article …). */
  nodeLabel: string;
  label: string;
  /** The name as drawn (wrapped; one line in a feature column). */
  lines: string[];
  /** Second line of a source / item box. */
  sub: string;
  /** Muted text after the name of a feature (the attribute family, "part" …). */
  suffix: string;
  nameW: number;
  badges: RtBadge[];
  title: string;
  /** Written by this run. */
  isNew: boolean;
  /** Garments of this run on this node (features). */
  shared: number;
  thumb?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: number;
  bold: boolean;
  level: number;
  parentKey: string | null;
  /** In a feature column (the connector is the rail + a tick into the left side). */
  stacked: boolean;
  /** Derived (two hops, via shared vocabulary), not an edge of the graph. */
  derived: boolean;
  /** Children cut by the depth (the box shows "+N"), and what they are. */
  folded: number;
  foldTitle: string;
  /** Unfolded below the cut through `open` (the box shows "−"). */
  unfolded: boolean;
  /** Width of the fold control at the right end of the sub line (0 = none). */
  foldW: number;
};
export type RtLink = { from: string; to: string; points: Point[]; type: string; derived: boolean };
type RtLabel = { text: string; type: string; parentKey: string; x: number; y: number; anchor: 'middle' | 'start'; w: number; h: number; derived: boolean };
type RunTreeStats = { sources: number; items: number; features: number; shared: number; related: number; earlier: number };
export type RunTreeLayout = {
  nodes: RtNode[];
  links: RtLink[];
  labels: RtLabel[];
  width: number;
  height: number;
  /** Counted on the whole forest, whatever the depth. */
  stats: RunTreeStats;
  lines: string[];
  /** Every node hidden by the depth, with the box it is folded into (a node can sit under several garments). */
  foldedInto: { id: string; key: string }[];
  /** The deepest tier this forest has (depthStops index). */
  maxDepth: number;
};
export type RunTreeOptions = {
  measure?: Measure;
  /** Rows of trees wrap at this width (graph units); a wider tree gets a row of its own. */
  rowWidth?: number;
  /** 2: the catalog items sharing a garment's vocabulary are in the graph; list the closest. */
  hops?: number;
  /** Data URL of a source photo, by the Look's `image_key`. */
  thumbFor?: (imageKey: string) => string | null | undefined;
  /** Draw tiers 0 … depth of depthStops (default: everything). */
  depth?: number;
  /** Box keys unfolded below the cut: all their children are drawn. */
  open?: ReadonlySet<string>;
  /** The domain's word for an item (fashion: garment); the neutral default when absent. */
  noun?: Noun;
};

const ITEM: Noun = { singular: 'item', plural: 'items' };
/** What each depth adds: tier 0 the sources … tier 4 the closest catalog items (two hops out). */
export const depthStops = (noun: Noun) => ['sources', 'statements', noun.plural, 'categories, components, values', 'closest garments in the brand\'s looks'];
/** What a "+N" folds away, by tier: [one, several]. */
const foldWhat = (noun: Noun): [string, string][] => [
  ['source', 'sources'],
  ['statement', 'statements'],
  [noun.singular, noun.plural],
  ['category, component or value', 'categories, components and values'],
  ['closest garment in the brand\'s looks', 'closest garments in the brand\'s looks'],
];

export const RT_FONTS = { source: 13, statement: 12, item: 12.5, feature: 11, header: 9.5, badge: 9.5, sub: 10.5, link: 10 } as const;
/** Box bottom → next level's box top; the bus runs half way. */
const GAP_Y = 56;
const TICK = 10;
const SIBLING_GAP = 22;
const TREE_GAP = 56;
const ROW_GAP = 72;
const INDENT = 12;
/** Spine → the first garment of a tiered source. */
const SPINE_GAP = 18;
const STACK_TOP = 12;
const STACK_GAP = 4;
const SECTION_GAP = 6;
const HEADER_H = 15;
const MARGIN = 24;
export const THUMB = 46;
export const THUMB_GAP = 8;
export const BADGE_GAP = 5;
export const SUFFIX_GAP = 6;
/** Width of the "−" fold control. */
const FOLD_MIN_W = 18;
const LABEL_H = 13;
/** Closest catalog items listed per garment, two hops out. */
const RELATED = 3;

const FEATURE_EDGES = ['IS_CATEGORY', 'HAS_PART', 'HAS_ATTRIBUTE'] as const;
const SECTION_TEXT: Record<string, string> = { IS_CATEGORY: 'IS_CATEGORY', HAS_PART: 'HAS_PART', HAS_ATTRIBUTE: 'HAS_ATTRIBUTE', RELATED: 'closest in the brand\'s looks' };
/** Readable attribute families (`textile-pattern` → pattern). */
const FAMILY: Record<string, string> = {
  'textile-pattern': 'pattern',
  'opening-type': 'opening',
  'neckline-type': 'neckline',
  'non-textile-material-type': 'material',
  'textile-finishing-manufacturing-techniques': 'finishing',
  'collar-type': 'collar',
  'lapel-type': 'lapel',
  'pocket-type': 'pocket',
  'sleeve-type': 'sleeve',
};
/** Labels that head a garment's feature column (the rest are edge types between levels). */
export const isSection = (type: string) => (FEATURE_EDGES as readonly string[]).includes(type) || type === 'RELATED';
const familyLabel = (f: string) => FAMILY[f] ?? f.replace(/-type$/, '').replace(/-/g, ' ');
const sectionText = (type: string) => SECTION_TEXT[type] ?? type;

// ---------------------------------------------------------------------- text helpers

/** The words of a statement after its markdown heading and byline: what the source actually says. */
export function statementSnippet(text: unknown): string {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^[_*].*[_*]$/.test(l) && !/^[-*_=]{3,}$/.test(l));
  return lines
    .join(' ')
    .replace(/\*\*|__|[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const naturalOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

// ---------------------------------------------------------------------- the forest

type Section = { type: string; derived: boolean; entries: T[]; w: number; headerY: number };
type T = RtNode & {
  parent: T | null;
  kids: T[];
  linkType: string;
  sections: Section[];
  band: number;
  boxLeft: number;
  kidLeft: number[];
  /** Indices into `kids`, one list per tier (one tier unless the garments are too many for a row). */
  tiers: number[][];
  /** x of the spine to the lower tiers, relative to the band's left edge. */
  spine: number;
  stackLeft: number;
  rail: number;
};

type Index = {
  node: Map<string, Node>;
  out: (id: string, type: string) => Edge[];
  into: (id: string, type: string) => Edge[];
  label: (id: string) => string;
};

function indexGraph(g: RunGraph): Index {
  const node = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Edge[]>();
  const into = new Map<string, Edge[]>();
  const seen = new Set<string>();
  for (const e of g.edges) {
    const k = `${e.source}\u0000${e.type}\u0000${e.target}`;
    if (seen.has(k) || !node.has(e.source) || !node.has(e.target)) continue;
    seen.add(k);
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    into.set(e.target, [...(into.get(e.target) ?? []), e]);
  }
  return {
    node,
    out: (id, type) => (out.get(id) ?? []).filter((e) => e.type === type),
    into: (id, type) => (into.get(id) ?? []).filter((e) => e.type === type),
    label: (id) => node.get(id)?.labels?.[0] ?? '',
  };
}

function nameOf(n: Node | undefined, id: string): string {
  const p = n?.props ?? {};
  return displayText(p.name ?? p.title ?? p.short ?? p.text) || id;
}

/** A graph node's name for the details panel: its name, title, text or short label, cut at 42 characters. */
export function displayName(n: Node): string {
  const p = n.props ?? {};
  const s = String(p.name ?? p.title ?? p.text ?? p.short ?? n.id);
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

function blank(key: string, id: string, role: RunRole, parent: T | null, linkType: string): T {
  return {
    key,
    id,
    role,
    nodeLabel: '',
    label: '',
    lines: [],
    sub: '',
    suffix: '',
    nameW: 0,
    badges: [],
    title: '',
    isNew: false,
    shared: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    font: RT_FONTS.feature,
    bold: false,
    level: 0,
    parentKey: parent?.key ?? null,
    stacked: false,
    derived: false,
    folded: 0,
    foldTitle: '',
    unfolded: false,
    foldW: 0,
    parent,
    kids: [],
    linkType,
    sections: [],
    band: 0,
    boxLeft: 0,
    kidLeft: [],
    tiers: [],
    spine: 0,
    stackLeft: 0,
    rail: 0,
  };
}

function buildForest(graph: RunGraph, g: Index, opts: RunTreeOptions) {
  const centers = new Set(graph.centers.filter((c) => g.node.has(c)));
  const isNewItem = (id: string) => centers.has(id) && g.label(id) === 'Item';
  const featureEdges = (id: string) => FEATURE_EDGES.flatMap((t) => g.out(id, t));
  /** Garments of this run, and other items, with an edge to a vocabulary node. */
  const usedBy = (fid: string) => {
    const ids = new Set(FEATURE_EDGES.flatMap((t) => g.into(fid, t)).map((e) => e.source));
    const all = [...ids].filter((i) => g.label(i) === 'Item');
    return { runItems: all.filter(isNewItem).length, others: all.filter((i) => !isNewItem(i)) };
  };
  const hops = opts.hops ?? 1;
  const noun = opts.noun ?? ITEM;
  const placed = new Set<string>();
  const roots: T[] = [];
  let earlierTotal = 0;

  const itemsUnder = (id: string, type: string) => {
    const targets = g.out(id, type).map((e) => e.target);
    const fresh = targets.filter((t) => isNewItem(t) && !placed.has(t)).sort(naturalOrder);
    const earlier = targets.filter((t) => g.label(t) === 'Item' && !centers.has(t)).length;
    earlierTotal += earlier;
    return { fresh, earlier };
  };
  const countSub = (head: string, fresh: number, earlier: number) =>
    `${head} · ${fresh} item${fresh === 1 ? '' : 's'}${earlier ? ` · +${earlier} from earlier runs` : ''}`;

  const addItem = (id: string, parent: T, type: string) => {
    placed.add(id);
    const n = g.node.get(id);
    const t = blank(`${parent.key}/${id}`, id, 'item', parent, type);
    t.nodeLabel = 'Item';
    t.isNew = true;
    t.label = nameOf(n, id);
    const conf = Number(n?.props?.confidence);
    t.sub = Number.isFinite(conf) && n?.props?.confidence !== undefined ? `Item · confidence ${conf.toFixed(2)}` : 'Item';
    t.title = [`Item: ${t.label}`, n?.props?.description ? String(n.props.description) : '', `written by this run${n?.props?.model ? ` · ${n.props.model}` : ''}`, 'click to see its properties and edges']
      .filter(Boolean)
      .join('\n');
    parent.kids.push(t);
    // the vocabulary the ontology resolved, one section per edge type
    const sections: Section[] = [];
    for (const type of FEATURE_EDGES) {
      const edges = g.out(id, type).filter((e, i, all) => all.findIndex((x) => x.target === e.target) === i);
      if (!edges.length) continue;
      const entries = edges.map((e) => feature(t, e, type));
      if (type === 'HAS_ATTRIBUTE') entries.sort((a, b) => a.suffix.localeCompare(b.suffix) || a.label.localeCompare(b.label));
      else entries.sort((a, b) => a.label.localeCompare(b.label));
      sections.push({ type, derived: false, entries, w: 0, headerY: 0 });
    }
    if (hops >= 2) {
      const related = closest(id);
      if (related.length) sections.push({ type: 'RELATED', derived: true, entries: related.map((r) => relatedBox(t, r)), w: 0, headerY: 0 });
    }
    t.sections = sections;
  };

  const feature = (item: T, e: Edge, type: string): T => {
    const n = g.node.get(e.target);
    const role: RunRole = type === 'IS_CATEGORY' ? 'category' : type === 'HAS_PART' ? 'part' : 'attribute';
    const f = blank(`${item.key}/${e.target}`, e.target, role, item, type);
    f.nodeLabel = g.label(e.target);
    f.label = nameOf(n, e.target);
    const family = typeof e.props?.family === 'string' ? e.props.family : '';
    // the section header says category / part; a value whose name does not carry its family gets it
    f.suffix = role === 'attribute' && family && !/\)$/.test(f.label) ? familyLabel(family) : '';
    f.stacked = true;
    const use = usedBy(e.target);
    f.shared = use.runItems;
    if (use.runItems > 1) f.badges.push({ text: `×${use.runItems}`, kind: 'shared', w: 0, title: `${use.runItems} ${noun.plural} of this run use this node` });
    if (hops >= 2 && use.others.length) f.badges.push({ text: `+${use.others.length}`, kind: 'more', w: 0, title: `and ${use.others.length} other item${use.others.length === 1 ? '' : 's'} in the graph (the brand\'s looks or earlier runs)` });
    f.title = [
      `${f.nodeLabel}: ${f.label}${family ? ` (${family})` : ''}`,
      `${type}: ${role === 'part' ? `a component of the ${noun.singular}` : role === 'category' ? `what the ${noun.singular} is` : `a value of the ${noun.singular}`}`,
      use.runItems > 1 ? `one node in the graph, used by ${use.runItems} ${noun.plural} of this run, drawn under each` : `used by this ${noun.singular} only, in this run`,
      hops >= 2 && use.others.length ? `also on ${use.others.length} other item${use.others.length === 1 ? '' : 's'}: ${use.others.slice(0, 6).map((o) => nameOf(g.node.get(o), o)).join(', ')}${use.others.length > 6 ? ' …' : ''}` : '',
      'click to light up every copy and see its edges',
    ]
      .filter(Boolean)
      .join('\n');
    return f;
  };

  /** Two hops out: the items outside this run sharing the most of a garment's vocabulary. */
  const closest = (id: string) => {
    const mine = featureEdges(id).map((e) => e.target);
    const myCategory = new Set(g.out(id, 'IS_CATEGORY').map((e) => e.target));
    const score = new Map<string, { shared: string[]; sameCategory: boolean }>();
    for (const f of new Set(mine)) {
      for (const e of FEATURE_EDGES.flatMap((t) => g.into(f, t))) {
        const other = e.source;
        if (other === id || isNewItem(other) || g.label(other) !== 'Item') continue;
        const s = score.get(other) ?? { shared: [], sameCategory: false };
        if (!s.shared.includes(f)) s.shared.push(f);
        if (e.type === 'IS_CATEGORY' && myCategory.has(f)) s.sameCategory = true;
        score.set(other, s);
      }
    }
    return [...score]
      .sort(([a, x], [b, y]) => y.shared.length - x.shared.length || Number(y.sameCategory) - Number(x.sameCategory) || nameOf(g.node.get(a), a).localeCompare(nameOf(g.node.get(b), b)))
      .slice(0, RELATED)
      .map(([other, s]) => ({ id: other, shared: s.shared }));
  };

  const relatedBox = (item: T, r: { id: string; shared: string[] }): T => {
    const n = g.node.get(r.id);
    const t = blank(`${item.key}/~${r.id}`, r.id, 'related', item, 'RELATED');
    t.nodeLabel = 'Item';
    t.label = nameOf(n, r.id);
    t.suffix = `${r.shared.length} shared`;
    t.stacked = true;
    t.derived = true;
    const where = n?.props?.run ? `an item from ${n.props.run}` : 'a garment of the brand\'s looks';
    t.title = [`Item: ${t.label}`, `${where}, sharing ${r.shared.length} node${r.shared.length === 1 ? '' : 's'} with ${item.label}:`, r.shared.map((f) => nameOf(g.node.get(f), f)).join(', '), `two hops: ${noun.singular} → shared node ← this item`, 'click to see its properties and edges']
      .filter(Boolean)
      .join('\n');
    return t;
  };

  const sourceBox = (id: string, role: RunRole): T => {
    const n = g.node.get(id);
    const t = blank(id, id, role, null, '');
    t.nodeLabel = g.label(id);
    t.isNew = centers.has(id);
    return Object.assign(t, { label: nameOf(n, id) });
  };

  const addStatement = (id: string, parent: T | null) => {
    const n = g.node.get(id);
    const t = parent ? blank(`${parent.key}/${id}`, id, 'statement', parent, 'HAS_STATEMENT') : sourceBox(id, 'statement');
    t.nodeLabel = 'Statement';
    t.isNew = centers.has(id);
    t.label = statementSnippet(n?.props?.text) || nameOf(n, id);
    placed.add(id);
    const { fresh, earlier } = itemsUnder(id, 'ILLUSTRATES');
    t.sub = countSub('Statement', fresh.length, earlier);
    const text = String(n?.props?.text ?? '');
    t.title = ['Statement (the text the model read)', text.length > 400 ? `${text.slice(0, 397).trim()}…` : text.trim()].join('\n');
    if (parent) parent.kids.push(t);
    else roots.push(t);
    // the look the text is about (an article of the new shoot), with its photo: drawn first
    for (const e of g.out(id, 'ILLUSTRATES').filter((x) => g.label(x.target) === 'Look')) {
      const lk = g.node.get(e.target);
      const b = blank(`${t.key}/${e.target}`, e.target, 'look', t, 'ILLUSTRATES');
      b.nodeLabel = 'Look';
      b.label = nameOf(lk, e.target);
      b.sub = 'Look · the look this text is about';
      const key = typeof lk?.props?.image_key === 'string' ? lk.props.image_key : '';
      const thumb = key ? opts.thumbFor?.(key) : null;
      if (thumb) b.thumb = thumb;
      b.title = [`Look: ${b.label}`, 'the statement ILLUSTRATES this look: the text is about it', 'click to see its properties and edges'].join('\n');
      t.kids.push(b);
    }
    for (const it of fresh) addItem(it, t, 'ILLUSTRATES');
  };

  const addArticle = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    const n = g.node.get(id);
    const t = sourceBox(id, 'article');
    const p = n?.props ?? {};
    t.sub = ['Article', p.source, p.published].filter(Boolean).join(' · ');
    t.title = [`Article: ${t.label}`, t.sub, 'a text source of this run'].join('\n');
    roots.push(t);
    for (const e of g.out(id, 'HAS_STATEMENT').sort((a, b) => naturalOrder(a.target, b.target))) if (!placed.has(e.target)) addStatement(e.target, t);
  };

  const addLook = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    const n = g.node.get(id);
    const t = sourceBox(id, 'look');
    const { fresh, earlier } = itemsUnder(id, 'CONTAINS');
    // the occasion the look is for (Look -FOR-> Occasion), on its sub-line
    const occasion = g.out(id, 'FOR').map((e) => nameOf(g.node.get(e.target), e.target))[0];
    t.sub = countSub(occasion ? `Look · ${occasion}` : 'Look · photo', fresh.length, earlier);
    const key = typeof n?.props?.image_key === 'string' ? n.props.image_key : '';
    const thumb = key ? opts.thumbFor?.(key) : null;
    if (thumb) t.thumb = thumb;
    t.title = [`Look: ${t.label}`, occasion ? `for ${occasion}` : '', n?.props?.description ? String(n.props.description) : '', 'a photo source'].filter(Boolean).join('\n');
    roots.push(t);
    // a text about this look (Statement -ILLUSTRATES-> Look), drawn first under it
    for (const e of g.into(id, 'ILLUSTRATES').filter((x) => g.label(x.source) === 'Statement')) {
      const st = g.node.get(e.source);
      const b = blank(`${t.key}/${e.source}`, e.source, 'statement', t, 'ILLUSTRATES');
      b.nodeLabel = 'Statement';
      b.label = statementSnippet(st?.props?.text) || nameOf(st, e.source);
      b.sub = 'Statement · a text about this look';
      b.title = ['Statement: a text about this look (it ILLUSTRATES the look)', String(st?.props?.text ?? '').slice(0, 400)].join('\n');
      t.kids.push(b);
    }
    for (const it of fresh) addItem(it, t, 'CONTAINS');
  };

  // the sources, in the order the run wrote them
  for (const c of graph.centers) {
    if (!g.node.has(c) || placed.has(c)) continue;
    const label = g.label(c);
    if (label === 'Article') addArticle(c);
    else if (label === 'Look') addLook(c);
    else if (label === 'Statement') {
      const art = g.into(c, 'HAS_STATEMENT')[0]?.source;
      if (art) addArticle(art);
      else addStatement(c, null);
    } else if (label === 'Item') {
      const st = g.into(c, 'ILLUSTRATES').find((e) => g.label(e.source) === 'Statement')?.source;
      const look = g.into(c, 'CONTAINS').find((e) => g.label(e.source) === 'Look')?.source;
      const art = st ? g.into(st, 'HAS_STATEMENT')[0]?.source : undefined;
      if (art) addArticle(art);
      else if (st && !placed.has(st)) addStatement(st, null);
      else if (look) addLook(look);
    }
  }
  const orphans = graph.centers.filter((c) => isNewItem(c) && !placed.has(c)).sort(naturalOrder);
  if (orphans.length) {
    const t = blank('~orphans', '', 'source', null, '');
    t.nodeLabel = 'Run';
    t.label = `Other ${noun.plural} of this run`;
    t.sub = `${orphans.length} item${orphans.length === 1 ? '' : 's'} · no source node in view`;
    t.title = 'Items written by this run whose look or statement is not in the loaded graph';
    roots.push(t);
    for (const it of orphans) addItem(it, t, 'WROTE');
  }

  const lineNames = new Set<string>();
  for (const c of centers) if (isNewItem(c)) for (const e of g.out(c, 'FROM_LINE')) lineNames.add(nameOf(g.node.get(e.target), e.target));
  return { roots, earlier: earlierTotal, lines: [...lineNames].sort() };
}

// ---------------------------------------------------------------------- depth

/** The depthStops tier of a box: a root is a source whatever its kind. */
const tierOf = (t: T) => (t.parent === null ? 0 : t.role === 'statement' ? 1 : t.role === 'item' ? 2 : t.role === 'related' ? 4 : 3);

/** Cuts the tree below `depth` (except under `open` boxes); records what each box folds away. */
function fold(t: T, depth: number, open: ReadonlySet<string>, foldedInto: { id: string; key: string }[], noun: Noun): void {
  const opened = open.has(t.key);
  const shows = (k: T) => tierOf(k) <= depth || opened;
  const hidden = [...t.kids.filter((k) => !shows(k)), ...t.sections.flatMap((s) => s.entries.filter((e) => !shows(e)))];
  t.unfolded = opened && [...t.kids, ...t.sections.flatMap((s) => s.entries)].some((k) => tierOf(k) > depth);
  t.kids = t.kids.filter(shows);
  t.sections = t.sections.map((s) => ({ ...s, entries: s.entries.filter(shows) })).filter((s) => s.entries.length);
  t.folded = hidden.length;
  if (hidden.length) {
    const byTier = new Map<number, number>();
    for (const k of hidden) byTier.set(tierOf(k), (byTier.get(tierOf(k)) ?? 0) + 1);
    const what = [...byTier].map(([tier, n]) => `${n} ${foldWhat(noun)[tier][n === 1 ? 0 : 1]}`).join(' + ');
    t.foldTitle = `${what} below the depth cut\nclick to show them`;
  } else if (t.unfolded) t.foldTitle = 'unfolded below the depth cut\nclick to fold';
  for (const h of hidden) forEach(h, (n) => n.id && foldedInto.push({ id: n.id, key: t.key }));
  t.kids.forEach((k) => fold(k, depth, open, foldedInto, noun));
}

// ---------------------------------------------------------------------- boxes

function forEach(t: T, fn: (t: T) => void): void {
  fn(t);
  t.kids.forEach((k) => forEach(k, fn));
  for (const s of t.sections) s.entries.forEach(fn);
}

function sizeBox(t: T, measure: Measure): void {
  if (t.stacked) {
    t.font = RT_FONTS.feature;
    t.bold = false;
    t.lines = wrapText(t.label, 30, 1);
    const pad = labelPadding(t.font);
    t.nameW = measure(t.lines[0], t.font, false);
    const suffix = t.suffix ? SUFFIX_GAP + measure(t.suffix, RT_FONTS.badge, false) : 0;
    for (const b of t.badges) b.w = measure(b.text, RT_FONTS.badge, true) + 8;
    const badges = t.badges.reduce((s, b) => s + BADGE_GAP + b.w, 0);
    t.w = pad + t.nameW + suffix + badges + pad;
    t.h = t.font * 1.2 + 8;
    return;
  }
  const [font, bold, max] =
    t.role === 'item' ? [RT_FONTS.item, true, 26] : t.role === 'statement' ? [RT_FONTS.statement, false, 34] : [RT_FONTS.source, true, 28];
  t.font = font;
  t.bold = bold;
  t.lines = wrapText(t.label, max, 2);
  const rows = textRows(t.font, t.lines.length, !!t.sub);
  const text = Math.max(...t.lines.map((l) => measure(l, t.font, t.bold)));
  t.foldW = t.folded ? measure(`+${t.folded}`, RT_FONTS.badge, true) + 10 : t.unfolded ? FOLD_MIN_W : 0;
  const subW = (t.sub ? measure(t.sub, RT_FONTS.sub, false) : 0) + (t.foldW ? BADGE_GAP + t.foldW : 0);
  t.nameW = text;
  t.w = (t.thumb ? THUMB + THUMB_GAP : 0) + Math.max(text, subW) + 2 * rows.padX;
  t.h = Math.max(rows.height, t.thumb ? THUMB + 8 : 0);
}

// ---------------------------------------------------------------------- bands (post-order)

function measureBand(t: T, labelW: (type: string) => number, maxTier: number): void {
  if (t.role === 'item') {
    t.boxLeft = 0;
    t.stackLeft = Math.min(INDENT, t.w / 2);
    const widths = t.sections.flatMap((s) => [s.w, ...s.entries.map((e) => e.w)]);
    t.band = widths.length ? Math.max(t.w, t.stackLeft + TICK + Math.max(...widths)) : t.w;
    return;
  }
  t.kidLeft = [];
  t.tiers = [];
  t.spine = 0;
  if (!t.kids.length) {
    t.band = t.w;
    t.boxLeft = 0;
    return;
  }
  t.kids.forEach((k) => measureBand(k, labelW, maxTier));
  // a lone child carries its parent's edge label right of its rise: make room for it
  const lone = t.kids.length === 1;
  const widths = t.kids.map((k) => Math.max(k.band, lone ? 2 * (labelW(k.linkType) + 8) : 0));
  // garments in tiers when one row of them is wider than the row (greedy, in order)
  const tiered = t.kids.every((k) => k.role === 'item') && widths.reduce((s, w) => s + w + SIBLING_GAP, -SIBLING_GAP) > maxTier;
  if (tiered) {
    let span = Infinity;
    widths.forEach((w, i) => {
      if (span + SIBLING_GAP + w > maxTier - SPINE_GAP) {
        t.tiers.push([i]);
        span = w;
      } else {
        t.tiers[t.tiers.length - 1].push(i);
        span += SIBLING_GAP + w;
      }
    });
  } else t.tiers = [t.kids.map((_, i) => i)];
  const base = tiered ? SPINE_GAP : 0;
  const spans: number[] = [];
  for (const tier of t.tiers) {
    let cursor = base;
    for (const i of tier) {
      t.kidLeft[i] = cursor + (widths[i] - t.kids[i].band) / 2;
      cursor += widths[i] + SIBLING_GAP;
    }
    spans.push(cursor - SIBLING_GAP);
  }
  const anchor = (i: number) => t.kidLeft[i] + t.kids[i].boxLeft + t.kids[i].w / 2;
  const first = t.tiers[0];
  const centre = (anchor(first[0]) + anchor(first[first.length - 1])) / 2;
  const shift = Math.max(0, t.w / 2 - centre);
  t.kidLeft = t.kidLeft.map((l) => l + shift);
  t.spine = shift;
  t.boxLeft = centre + shift - t.w / 2;
  t.band = Math.max(Math.max(...spans) + shift, t.boxLeft + t.w);
}

// ---------------------------------------------------------------------- positions (pre-order)

/** Lowest box edge in a subtree (feature columns included). */
function bottomOf(t: T): number {
  let b = t.y + t.h / 2;
  forEach(t, (n) => (b = Math.max(b, n.y + n.h / 2)));
  return b;
}

/** Absolute positions; `left` is the left edge of t's band. `top` / `stackTop`: box tops and column tops by level. */
function place(t: T, left: number, top: number[], stackTop: number[]): void {
  t.x = left + t.boxLeft + t.w / 2;
  t.y = top[t.level] + t.h / 2;
  if (t.role === 'item') {
    t.rail = t.x - t.w / 2 + t.stackLeft;
    let y = stackTop[t.level];
    for (const s of t.sections) {
      s.headerY = y + HEADER_H / 2;
      y += HEADER_H;
      for (const e of s.entries) {
        e.x = t.rail + TICK + e.w / 2;
        e.y = y + e.h / 2;
        e.level = t.level + 1;
        y += e.h + STACK_GAP;
      }
      y += SECTION_GAP;
    }
    return;
  }
  t.tiers.forEach((tier, j) => {
    let [tTop, sTop] = [top, stackTop];
    if (j > 0) {
      // under the deepest column of the tier above
      const level = t.kids[tier[0]].level;
      const above = Math.max(...t.tiers[j - 1].map((i) => bottomOf(t.kids[i])));
      const boxTop = above + GAP_Y;
      const tallest = Math.max(...tier.map((i) => t.kids[i].h));
      tTop = top.map((v, l) => (l === level ? boxTop : v));
      sTop = stackTop.map((v, l) => (l === level ? boxTop + tallest + STACK_TOP : v));
    }
    for (const i of tier) place(t.kids[i], left + t.kidLeft[i], tTop, sTop);
  });
  t.spine += left;
}

// ---------------------------------------------------------------------- connectors and labels

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * Spread children: down from the parent to a bus right above them, across, down into each child
 * (one edge-type label per tier, under the bus right of the first drop). A feature column: the rail from the garment's
 * bottom, a tick into each box; derived entries continue the rail dashed.
 */
function connect(t: T, top: number[], links: RtLink[], labels: RtLabel[], labelW: (type: string) => number): void {
  if (t.role === 'item') {
    const start = t.y + t.h / 2;
    let lastSolid = start;
    for (const s of t.sections) {
      labels.push({ text: sectionText(s.type), type: s.type, parentKey: t.key, x: t.rail + TICK, y: s.headerY, anchor: 'start', w: s.w, h: LABEL_H, derived: s.derived });
      for (const e of s.entries) {
        const from = s.derived ? lastSolid : start;
        links.push({ from: t.key, to: e.key, points: dedupe([[t.rail, from], [t.rail, e.y], [e.x - e.w / 2, e.y]]), type: s.type, derived: s.derived });
        if (!s.derived) lastSolid = e.y;
      }
    }
    return;
  }
  if (!t.kids.length) return;
  const type = t.kids[0].linkType;
  const busOf = (tier: number[]) => Math.min(...tier.map((i) => t.kids[i].y - t.kids[i].h / 2)) - GAP_Y / 2;
  const bus0 = busOf(t.tiers[0]);
  const trunk: Point[] = [
    [t.x, t.y + t.h / 2],
    [t.x, bus0],
  ];
  t.tiers.forEach((tier, j) => {
    const bus = busOf(tier);
    // tier 0 hangs off the trunk; a lower tier off the spine, down the band's left edge
    const head: Point[] = j === 0 ? trunk : [...trunk, [t.spine, bus0], [t.spine, bus]];
    for (const i of tier) {
      const k = t.kids[i];
      links.push({ from: t.key, to: k.key, points: dedupe([...head, [k.x, bus], [k.x, k.y - k.h / 2]]), type: k.linkType, derived: false });
    }
    // the edge type, right of the first drop (between two drops, so it crosses no line)
    if (type !== 'WROTE') labels.push({ text: type, type, parentKey: t.key, x: t.kids[tier[0]].x + 6, y: bus + 14, anchor: 'start', w: labelW(type), h: LABEL_H, derived: false });
  });
  for (const k of t.kids) connect(k, top, links, labels, labelW);
}

// ---------------------------------------------------------------------- the layout

export function runTreeLayout(graph: RunGraph, opts: RunTreeOptions = {}): RunTreeLayout {
  const measure = opts.measure ?? defaultMeasure;
  const rowWidth = Math.max(600, opts.rowWidth ?? 1400);
  const labelW = (type: string) => measure(sectionText(type), RT_FONTS.link, true) + 6;
  const g = indexGraph(graph);
  const { roots, earlier, lines } = buildForest(graph, g, opts);

  // 0. counts on the whole forest, then the depth cut
  const all: T[] = [];
  roots.forEach((r) => forEach(r, (t) => all.push(t)));
  const stats: RunTreeStats = {
    sources: roots.length,
    items: all.filter((t) => t.role === 'item').length,
    features: new Set(all.filter((t) => t.stacked && t.role !== 'related').map((t) => t.id)).size,
    shared: new Set(all.filter((t) => t.stacked && t.role !== 'related' && t.shared > 1).map((t) => t.id)).size,
    related: new Set(all.filter((t) => t.role === 'related').map((t) => t.id)).size,
    earlier,
  };
  const maxDepth = all.reduce((m, t) => Math.max(m, tierOf(t)), 0);
  const foldedInto: { id: string; key: string }[] = [];
  const open = opts.open ?? new Set<string>();
  for (const r of roots) fold(r, opts.depth ?? Infinity, open, foldedInto, opts.noun ?? ITEM);

  // 1. boxes
  for (const r of roots) {
    forEach(r, (t) => sizeBox(t, measure));
    forEach(r, (t) => t.sections.forEach((s) => (s.w = measure(sectionText(s.type), RT_FONTS.header, true))));
  }

  // 2. bands, then rows of trees (greedy, in source order)
  for (const r of roots) measureBand(r, labelW, rowWidth);
  const rows: T[][] = [];
  let width = 0;
  for (const r of roots) {
    const row = rows[rows.length - 1];
    if (row && width + TREE_GAP + r.band <= rowWidth) {
      row.push(r);
      width += TREE_GAP + r.band;
    } else {
      rows.push([r]);
      width = r.band;
    }
  }

  // 3. per row: levels (a row with statements puts its garments on level 2), positions
  let yTop = 0;
  const rowTop = new Map<T, number[]>();
  for (const row of rows) {
    const all: T[] = [];
    row.forEach((r) => forEach(r, (t) => all.push(t)));
    const itemLevel = all.some((t) => t.role === 'statement' && t.parent) ? 2 : 1;
    for (const t of all) {
      if (t.stacked) continue;
      t.level = t.role === 'item' ? itemLevel : t.role === 'statement' && t.parent ? 1 : 0;
    }
    const levelH = new Array<number>(itemLevel + 1).fill(0);
    for (const t of all) if (!t.stacked) levelH[t.level] = Math.max(levelH[t.level], t.h);
    const top: number[] = [yTop];
    for (let l = 1; l <= itemLevel; l++) top[l] = top[l - 1] + levelH[l - 1] + GAP_Y;
    const stackTop = top.map((y, l) => y + levelH[l] + STACK_TOP);
    let x = 0;
    for (const r of row) {
      place(r, x, top, stackTop);
      x += r.band + TREE_GAP;
    }
    const bottom = Math.max(...all.map((t) => t.y + t.h / 2));
    yTop = bottom + ROW_GAP;
    for (const r of row) rowTop.set(r, top);
  }

  // 4. connectors and labels
  const links: RtLink[] = [];
  const labels: RtLabel[] = [];
  for (const r of roots) connect(r, rowTop.get(r)!, links, labels, labelW);

  // 5. translate the drawing to (MARGIN, MARGIN)
  const nodes: T[] = [];
  roots.forEach((r) => forEach(r, (t) => nodes.push(t)));
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const t of nodes) {
    grow(t.x - t.w / 2, t.y - t.h / 2);
    grow(t.x + t.w / 2, t.y + t.h / 2);
  }
  for (const l of labels) {
    const left = l.anchor === 'middle' ? l.x - l.w / 2 : l.x;
    grow(left, l.y - l.h / 2);
    grow(left + l.w, l.y + l.h / 2);
  }
  if (!nodes.length) [minX, minY, maxX, maxY] = [0, 0, 0, 0];
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  for (const l of links) l.points = l.points.map(([x, y]) => [x + dx, y + dy] as Point);
  for (const l of labels) {
    l.x += dx;
    l.y += dy;
  }

  return {
    nodes: nodes.map((t) => ({
      key: t.key,
      id: t.id,
      role: t.role,
      nodeLabel: t.nodeLabel,
      label: t.label,
      lines: t.lines,
      sub: t.sub,
      suffix: t.suffix,
      nameW: t.nameW,
      badges: t.badges,
      title: t.title,
      isNew: t.isNew,
      shared: t.shared,
      thumb: t.thumb,
      x: t.x + dx,
      y: t.y + dy,
      w: t.w,
      h: t.h,
      font: t.font,
      bold: t.bold,
      level: t.level,
      parentKey: t.parentKey,
      stacked: t.stacked,
      derived: t.derived,
      folded: t.folded,
      foldTitle: t.foldTitle,
      unfolded: t.unfolded,
      foldW: t.foldW,
    })),
    links,
    labels,
    width: maxX - minX + 2 * MARGIN,
    height: maxY - minY + 2 * MARGIN,
    stats,
    lines,
    foldedInto,
    maxDepth,
  };
}
