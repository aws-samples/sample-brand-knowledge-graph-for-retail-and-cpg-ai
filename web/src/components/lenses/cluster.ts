// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The trends lens's clouds (method 3, "Explore the clouds"): the garments grouped by similarity,
 * in the browser.
 *
 * The vectors arrive as int8 (each scaled to its largest component, see lenses.trends_map);
 * cosine similarity only needs their direction, so they are decoded and L2-normalized. Clouds
 * are found in the full 1,024-dimension space, never on the 2-D picture: a k-nearest-neighbour
 * graph (cosine), then Louvain community detection on it: the clustering of BERTopic-style
 * pipelines without a density parameter to tune. Each cloud is named by class-based TF-IDF:
 * the words its garments use more than the other clouds do.
 */

/** The int8 vectors as L2-normalized float rows. */
export function decodeVectors(b64: string, n: number, dim: number): Float32Array[] {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const out: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(dim);
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      const b = raw[i * dim + d];
      const x = b > 127 ? b - 256 : b; // two's complement
      v[d] = x;
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (let d = 0; d < dim; d++) v[d] /= norm;
    out.push(v);
  }
  return out;
}

/** Cosine similarity of every pair (the rows are unit vectors): an n × n matrix, row-major. */
export function similarities(vecs: Float32Array[]): Float32Array {
  const n = vecs.length;
  const sim = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      let dot = 0;
      const a = vecs[i];
      const b = vecs[j];
      for (let d = 0; d < a.length; d++) dot += a[d] * b[d];
      sim[i * n + j] = dot;
      sim[j * n + i] = dot;
    }
  }
  return sim;
}

export type WeightedEdge = [number, number, number];

/** The symmetric k-nearest-neighbour graph: i–j when j is among i's k most similar items or
 * the other way round, weighted by their (positive) cosine similarity. */
export function knnGraph(sim: Float32Array, n: number, k: number): WeightedEdge[] {
  const best = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const order = Array.from({ length: n }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => sim[i * n + b] - sim[i * n + a] || a - b)
      .slice(0, k);
    for (const j of order) {
      const w = Math.max(sim[i * n + j], 0);
      if (w <= 0) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      best.set(key, Math.max(best.get(key) ?? 0, w));
    }
  }
  return [...best.entries()].map(([key, w]) => {
    const [a, b] = key.split('-').map(Number);
    return [a, b, w];
  });
}

/**
 * Louvain community detection (Blondel et al., 2008): move each node to the neighbouring
 * community that raises modularity most, until nothing moves; collapse the communities into
 * nodes; repeat until no level improves. Deterministic: nodes are visited in index order and a
 * tie keeps the node where it is. Returns the community of every node, numbered 0… by size.
 */
export function louvain(n: number, edges: WeightedEdge[], resolution = 1): number[] {
  // adjacency of the current level (A_ij, symmetric; a self-loop holds a community's inner weight)
  let adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [a, b, w] of edges) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  let membership = Array.from({ length: n }, (_, i) => i);
  for (let level = 0; level < 20; level++) {
    const { community, moved } = localMoving(adj, resolution);
    if (!moved) break;
    const ids = renumber(community);
    membership = membership.map((m) => ids[m]);
    adj = aggregate(adj, ids);
  }
  return bySize(membership);
}

function localMoving(adj: Map<number, number>[], resolution: number): { community: number[]; moved: boolean } {
  const n = adj.length;
  const k = adj.map((row) => [...row.values()].reduce((s, w) => s + w, 0)); // row sums (degree)
  const m2 = k.reduce((s, x) => s + x, 0) || 1; // Σ A_ij = 2m
  const community = Array.from({ length: n }, (_, i) => i);
  const total = [...k]; // Σ_tot of each community
  let moved = false;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const own = community[i];
      total[own] -= k[i];
      const into = new Map<number, number>(); // weight from i into each neighbouring community
      for (const [j, w] of adj[i]) if (j !== i) into.set(community[j], (into.get(community[j]) ?? 0) + w);
      const gain = (c: number) => (into.get(c) ?? 0) - (resolution * total[c] * k[i]) / m2;
      let bestC = own;
      let bestGain = gain(own);
      for (const c of [...into.keys()].sort((a, b) => a - b)) {
        const g = gain(c);
        if (g > bestGain + 1e-12) {
          bestGain = g;
          bestC = c;
        }
      }
      total[bestC] += k[i];
      if (bestC !== own) {
        community[i] = bestC;
        changed = moved = true;
      }
    }
    if (!changed) break;
  }
  return { community, moved };
}

function renumber(community: number[]): number[] {
  const ids = new Map<number, number>();
  return community.map((c) => {
    if (!ids.has(c)) ids.set(c, ids.size);
    return ids.get(c)!;
  });
}

function aggregate(adj: Map<number, number>[], ids: number[]): Map<number, number>[] {
  const size = Math.max(...ids) + 1;
  const out: Map<number, number>[] = Array.from({ length: size }, () => new Map());
  adj.forEach((row, i) => {
    for (const [j, w] of row) out[ids[i]].set(ids[j], (out[ids[i]].get(ids[j]) ?? 0) + w);
  });
  return out;
}

/** Community 0 is the largest; equal sizes keep their order of first appearance. */
function bySize(membership: number[]): number[] {
  const count = new Map<number, number>();
  membership.forEach((c) => count.set(c, (count.get(c) ?? 0) + 1));
  const first = new Map<number, number>();
  membership.forEach((c, i) => first.has(c) || first.set(c, i));
  const order = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || first.get(a)! - first.get(b)!);
  const rank = new Map(order.map((c, r) => [c, r]));
  return membership.map((c) => rank.get(c)!);
}

/** Share of the new content over share of the lookbook, smoothed: the same formula as trends.lift. */
export function lift(nNew: number, totalNew: number, nBase: number, totalBase: number): number {
  return (nNew + 0.5) / (totalNew + 1) / ((nBase + 0.5) / (totalBase + 1));
}

const STOP = new Set(
  (
    'the and for with from this that are was were has have had not but you your our its into over under than then them they their there these those what when where which who whom why how all any can each few more most other some such only own same very will just also out off one two new look looks wear worn wearing item items page product brand catalog photo text like make made over about after before between both during through well non type' +
    ' der die das und mit von'
  ).split(' '),
);

/** Lower-case words of three letters or more, without stop words. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}[\p{L}-]{2,}/gu) ?? []).filter((w) => !STOP.has(w));
}

/**
 * Class-based TF-IDF (Grootendorst, BERTopic): each group's text as one document; a word scores
 * high when it is frequent in the group and rare across the groups. The top words name the group.
 * Words in more than half of all items (the brand's name, the fields of a product page) name
 * nothing and are left out.
 */
export function groupLabels(texts: string[], groupOf: number[], top = 3): string[][] {
  const groups = Math.max(-1, ...groupOf) + 1;
  const tokens = texts.map(words);
  const df = new Map<string, number>();
  for (const ws of tokens) for (const w of new Set(ws)) df.set(w, (df.get(w) ?? 0) + 1);
  const common = (w: string) => texts.length >= 10 && df.get(w)! / texts.length > 1 / 2;
  const tf: Map<string, number>[] = Array.from({ length: groups }, () => new Map());
  const all = new Map<string, number>();
  tokens.forEach((ws, i) => {
    for (const w of ws) {
      if (common(w)) continue;
      tf[groupOf[i]].set(w, (tf[groupOf[i]].get(w) ?? 0) + 1);
      all.set(w, (all.get(w) ?? 0) + 1);
    }
  });
  const avg = [...all.values()].reduce((s, x) => s + x, 0) / Math.max(groups, 1);
  return tf.map((freq) => {
    const size = [...freq.values()].reduce((s, x) => s + x, 0) || 1;
    return [...freq.entries()]
      .map(([w, f]) => [w, (f / size) * Math.log(1 + avg / all.get(w)!)] as const)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, top)
      .map(([w]) => w);
  });
}
