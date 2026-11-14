// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The explorer's web, as data: the adjacency of the style DNA (`GET /api/graph/web`), what lights
 * up when a node is clicked or a word is searched, and the counts the side panel says. Pure, so it
 * is tested without a canvas.
 */
export type WebNode = { id: string; label: string; name: string | null; image_key: string | null; run: string | null };
export type WebEdge = { source: string; type: string; target: string };
export type Web = { nodes: WebNode[]; edges: WebEdge[]; cypher: string[] };

export type Adjacency = {
  byId: Map<string, WebNode>;
  out: Map<string, WebEdge[]>;
  into: Map<string, WebEdge[]>;
};

export function adjacency(web: Web): Adjacency {
  const byId = new Map(web.nodes.map((n) => [n.id, n]));
  const out = new Map<string, WebEdge[]>();
  const into = new Map<string, WebEdge[]>();
  for (const e of web.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!into.has(e.target)) into.set(e.target, []);
    out.get(e.source)!.push(e);
    into.get(e.target)!.push(e);
  }
  return { byId, out, into };
}

const outOf = (a: Adjacency, id: string, type?: string) => (a.out.get(id) ?? []).filter((e) => !type || e.type === type);
const intoOf = (a: Adjacency, id: string, type?: string) => (a.into.get(id) ?? []).filter((e) => !type || e.type === type);

/** The looks a garment is in (CONTAINS), or the look a statement is about (ILLUSTRATES). */
function looksOfGarment(a: Adjacency, id: string): string[] {
  return intoOf(a, id, 'CONTAINS').map((e) => e.source);
}

/** The garments that link to a shared node (a kind, a detail), and the looks they are in. */
function garmentsAndLooks(a: Adjacency, id: string): { garments: string[]; looks: string[] } {
  const garments = intoOf(a, id).filter((e) => e.type === 'IS_CATEGORY' || e.type === 'HAS_ATTRIBUTE').map((e) => e.source);
  const looks = [...new Set(garments.flatMap((g) => looksOfGarment(a, g)))];
  return { garments, looks };
}

/**
 * What lights up for a clicked node: the node, what it links to, and the looks that makes it
 * meet. A look: its garments, their kinds, its occasion and a text about it. A garment: its look
 * and its kind and details. A kind or a detail: every garment of it and every look they are in. An
 * occasion: every look for it. A statement or an article: the look it is about.
 */
export function lightUp(a: Adjacency, id: string): Set<string> {
  const n = a.byId.get(id);
  const lit = new Set<string>([id]);
  if (!n) return lit;
  const add = (ids: string[]) => ids.forEach((x) => lit.add(x));
  if (n.label === 'Look') {
    const garments = outOf(a, id, 'CONTAINS').map((e) => e.target);
    add(garments);
    add(garments.flatMap((g) => outOf(a, g, 'IS_CATEGORY').map((e) => e.target)));
    add(outOf(a, id, 'FOR').map((e) => e.target));
    add(intoOf(a, id, 'ILLUSTRATES').map((e) => e.source));
  } else if (n.label === 'Item') {
    add(looksOfGarment(a, id));
    add(outOf(a, id).map((e) => e.target));
  } else if (n.label === 'Category' || n.label === 'Attribute') {
    const { garments, looks } = garmentsAndLooks(a, id);
    add(garments);
    add(looks);
  } else if (n.label === 'Occasion') {
    add(intoOf(a, id, 'FOR').map((e) => e.source));
  } else if (n.label === 'Statement') {
    add(outOf(a, id, 'ILLUSTRATES').map((e) => e.target));
    add(intoOf(a, id, 'HAS_STATEMENT').map((e) => e.source));
  } else if (n.label === 'Article') {
    const statements = outOf(a, id, 'HAS_STATEMENT').map((e) => e.target);
    add(statements);
    add(statements.flatMap((s) => outOf(a, s, 'ILLUSTRATES').map((e) => e.target)));
  }
  return lit;
}

/** Every garment whose name holds all the words of `text`, and the looks they are in ("white sneaker": 15 looks). */
export function search(a: Adjacency, text: string): { garments: string[]; looks: string[] } {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { garments: [], looks: [] };
  const garments = [...a.byId.values()].filter((n) => n.label === 'Item' && words.every((w) => (n.name ?? '').toLowerCase().includes(w))).map((n) => n.id);
  const looks = [...new Set(garments.flatMap((g) => looksOfGarment(a, g)))];
  return { garments, looks };
}

/** What the side panel says about a node, in counts and the ids it lists. */
export function describe(a: Adjacency, id: string): { line: string; looks: string[]; garments: string[] } {
  const n = a.byId.get(id);
  if (!n) return { line: '', looks: [], garments: [] };
  const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (n.label === 'Look') {
    const garments = outOf(a, id, 'CONTAINS').map((e) => e.target);
    const occasion = outOf(a, id, 'FOR').map((e) => a.byId.get(e.target)?.name)[0];
    const texts = intoOf(a, id, 'ILLUSTRATES').length;
    return { line: [plural(garments.length, 'garment'), occasion ? `for ${occasion}` : '', texts ? plural(texts, 'text about it', 'texts about it') : ''].filter(Boolean).join(' · '), looks: [], garments };
  }
  if (n.label === 'Item') {
    const looks = looksOfGarment(a, id);
    const kind = outOf(a, id, 'IS_CATEGORY').map((e) => a.byId.get(e.target)?.name)[0];
    return { line: [kind ? `a ${kind}` : '', looks.length ? `in ${plural(looks.length, 'look')}` : 'named in a text'].filter(Boolean).join(' · '), looks, garments: [] };
  }
  if (n.label === 'Category' || n.label === 'Attribute') {
    const { garments, looks } = garmentsAndLooks(a, id);
    return { line: `${plural(garments.length, 'garment')} in ${plural(looks.length, 'look')}`, looks, garments };
  }
  if (n.label === 'Occasion') {
    const looks = intoOf(a, id, 'FOR').map((e) => e.source);
    return { line: plural(looks.length, 'look'), looks, garments: [] };
  }
  const looks = n.label === 'Statement' ? outOf(a, id, 'ILLUSTRATES').filter((e) => a.byId.get(e.target)?.label === 'Look').map((e) => e.target) : [];
  return { line: looks.length ? 'about a look' : '', looks, garments: [] };
}
