// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * "What are the emerging trends we see this season?", method 3: the map and its clouds, in the
 * browser (cluster.ts, embed2d.ts).
 *
 * Every garment worn in a look arrives as an int8 vector. The clouds are found on the full
 * vectors: a k-nearest-neighbour graph on cosine similarity, then Louvain communities. The picture
 * is only for looking and clicking: exact t-SNE on the same similarities, started from the two
 * principal components so the same graph always draws the same map. Each cloud gets its lift, the
 * share of the new shoot it holds over the share of the lookbook it holds (add-half smoothed).
 */
import type { TrendsMap } from '../../api';
import { decodeVectors, groupLabels, knnGraph, lift, louvain, similarities } from './cluster';
import { density as kernelDensity, normalise, pca2, tsne } from './embed2d';

/** Neighbours per garment in the kNN graph the clouds are found on. */
export const K_NEIGHBOURS = 10;
/** The most garments of one cloud the walk takes (lenses.MAX_CLOUD_ITEMS). */
export const MAX_CLOUD_ITEMS = 200;
/** The heat map's grid, cells per side. */
export const GRID = 72;
/** How close (in px, the same across and up) the pointer must be to a garment to hover it or pick its cloud. */
export const REACH = 14;
/** A cloud's number badge: its radius in px, and the smallest cloud that gets one (the selected one always does). */
export const BADGE_RADIUS = 10;
export const BADGE_MIN = 5;
/** A heat cell picks its cloud from this share of the map's densest cell up; below it the click lands on empty space. */
export const HEAT_FLOOR = 0.05;
/** With a cloud selected, the other clouds' heat and garments at this share of their usual opacity. */
export const FADED = 0.35;

export type MapInput = Pick<TrendsMap, 'n' | 'dim' | 'vectors' | 'items' | 'totals'>;
export type Cloud = {
  id: number;
  /** the garments in it, as indices into the map's items */
  indices: number[];
  size: number;
  new: number;
  base: number;
  lift: number;
  /** its words (class-based TF-IDF over the garment names), or "cloud n" */
  label: string;
  /** the mean position of its garments on the map, in [0, 1]² */
  center: [number, number];
};
export type Layout = { xy: Float32Array; groupOf: number[]; groups: Cloud[] };

/** The whole method: decode, group on the full vectors, lay out in 2-D, describe each cloud. */
export function layout(map: MapInput): Layout {
  const vecs = decodeVectors(map.vectors, map.n, map.dim);
  const sim = similarities(vecs);
  const groupOf = louvain(map.n, knnGraph(sim, map.n, Math.min(K_NEIGHBOURS, map.n - 1)));
  // tsne's defaults are the old method's: perplexity 15, 750 iterations up to 300 points, 400 above
  const xy = normalise(tsne(sim, map.n, pca2(vecs)));
  return { xy, groupOf, groups: cloudsOf(map, xy, groupOf) };
}

/** Each cloud's size, how many of it are from the new shoot, its lift, words and center. */
export function cloudsOf(map: Pick<MapInput, 'items' | 'totals'>, xy: Float32Array, groupOf: number[]): Cloud[] {
  const labels = groupLabels(
    map.items.map((i) => i.name),
    groupOf,
  );
  const count = Math.max(-1, ...groupOf) + 1;
  return Array.from({ length: count }, (_, id) => {
    const indices = groupOf.flatMap((g, i) => (g === id ? [i] : []));
    const fresh = indices.filter((i) => map.items[i].new).length;
    const base = indices.length - fresh;
    const center: [number, number] = [mean(indices.map((i) => xy[i * 2])), mean(indices.map((i) => xy[i * 2 + 1]))];
    return { id, indices, size: indices.length, new: fresh, base, lift: lift(fresh, map.totals.new, base, map.totals.base), label: labels[id].join(' · ') || `cloud ${id + 1}`, center };
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** The clouds in the table's order: by lift, or by size when the graph holds no new shoot (every lift is then the same story). */
export function ranked(groups: Cloud[], totalNew: number): Cloud[] {
  return [...groups].sort((a, b) => (totalNew ? b.lift - a.lift : 0) || b.size - a.size || a.id - b.id);
}

/**
 * A cloud with no lookbook garment has no lookbook share to compare with: the smoothing still
 * gives it a number, in the hundreds on a large lookbook, so the map says "new shoot only" instead.
 */
export function newShootOnly(cloud: Pick<Cloud, 'new' | 'base'>): boolean {
  return cloud.base === 0 && cloud.new > 0;
}

/** A cloud's lift as the map and the table show it. */
export function liftText(cloud: Pick<Cloud, 'new' | 'base' | 'lift'>): string {
  return newShootOnly(cloud) ? 'new shoot only' : cloud.lift.toFixed(2);
}

/** The same in a sentence: "lift 1.83", or "new shoot only". */
export function liftPhrase(cloud: Pick<Cloud, 'new' | 'base' | 'lift'>): string {
  return newShootOnly(cloud) ? 'new shoot only' : `lift ${cloud.lift.toFixed(2)}`;
}

/**
 * The length of a cloud's lift bar, 0 to 1: its lift over the largest lift of the clouds that
 * have lookbook garments, so one "new shoot only" cloud does not shrink every other bar to nothing.
 * A "new shoot only" cloud gets the full bar.
 */
export function liftBar(cloud: Pick<Cloud, 'new' | 'base' | 'lift'>, groups: Pick<Cloud, 'new' | 'base' | 'lift'>[]): number {
  if (newShootOnly(cloud)) return 1;
  const top = Math.max(1, ...groups.filter((g) => !newShootOnly(g)).map((g) => g.lift));
  return Math.min(1, cloud.lift / top);
}

export type Heat = {
  /** the density of every garment, per cell (row-major, `size` × `size`) */
  value: Float32Array;
  /** the cloud that holds most of a cell's density, per cell (-1 where there is none) */
  group: Int32Array;
  /** each cloud's own density, to draw the selected cloud on its own */
  byGroup: Float32Array[];
  max: number;
  size: number;
};

/** The heat map: a Gaussian kernel density of the garments on the map, and which cloud dominates each cell. */
export function density(xy: Float32Array, groupOf: number[], size = GRID, bandwidth = 0.04): Heat {
  const count = Math.max(-1, ...groupOf) + 1;
  const byGroup = Array.from({ length: count }, (_, g) =>
    kernelDensity(
      xy,
      groupOf.map((x) => (x === g ? 1 : 0)),
      size,
      bandwidth,
    ),
  );
  const value = new Float32Array(size * size);
  const group = new Int32Array(size * size).fill(-1);
  for (let c = 0; c < size * size; c++) {
    let best = 0;
    for (let g = 0; g < count; g++) {
      value[c] += byGroup[g][c];
      if (byGroup[g][c] > best) {
        best = byGroup[g][c];
        group[c] = g;
      }
    }
  }
  return { value, group, byGroup, max: Math.max(0, ...value), size };
}

/**
 * The garment nearest to (x, y) within `radius`, else null. Positions are in [0, 1]²; with the
 * map's `width` and `height` in px, (x, y) and `radius` are in px too, so the reach is a circle.
 */
export function nearest(xy: Float32Array, x: number, y: number, radius: number, width = 1, height = 1): number | null {
  let best: number | null = null;
  let bestD = radius;
  for (let i = 0; i < xy.length / 2; i++) {
    const d = Math.hypot(xy[i * 2] * width - x, xy[i * 2 + 1] * height - y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The clouds drawn with a number badge: those of BADGE_MIN garments or more, and the selected one. */
export function badged(groups: Cloud[], selected: number | null): Cloud[] {
  return groups.filter((g) => g.size >= BADGE_MIN || g.id === selected);
}

/**
 * The cloud a click at (x, y) px of a `width` × `height` map picks: the number badge under the
 * pointer; else the cloud of the nearest garment within REACH px; else the cloud that holds most
 * of the heat cell under the pointer, if that cell is at least HEAT_FLOOR of the densest; else
 * null (a click on empty space keeps the selection).
 */
export function pickAt(lay: Layout, heat: Heat, x: number, y: number, width: number, height: number, selected: number | null): number | null {
  let badge: number | null = null;
  let closest = BADGE_RADIUS;
  for (const g of badged(lay.groups, selected)) {
    const d = Math.hypot(g.center[0] * width - x, g.center[1] * height - y);
    if (d <= closest) {
      closest = d;
      badge = g.id;
    }
  }
  if (badge !== null) return badge;
  const i = nearest(lay.xy, x, y, REACH, width, height);
  if (i !== null) return lay.groupOf[i];
  const col = Math.min(heat.size - 1, Math.max(0, Math.floor((x / width) * heat.size)));
  const row = Math.min(heat.size - 1, Math.max(0, Math.floor((y / height) * heat.size)));
  const cell = row * heat.size + col;
  return heat.max > 0 && heat.value[cell] >= HEAT_FLOOR * heat.max && heat.group[cell] >= 0 ? heat.group[cell] : null;
}

/**
 * One heat cell as drawn: the cloud whose colour it takes and its alpha (0 to 255). Without a
 * selection, the dominant cloud, as strong as the density. With one, the selected cloud's own
 * density on top, and the other clouds' heat at FADED of its usual opacity, whichever is stronger.
 */
export function heatPixel(heat: Heat, cell: number, selected: number | null, ownMax: number): { group: number; alpha: number } {
  const usual = Math.min(1, heat.value[cell] / (heat.max || 1)) ** 0.8 * 150;
  if (selected === null) return { group: heat.group[cell], alpha: Math.round(usual) };
  const own = heat.byGroup[selected][cell];
  const mine = Math.min(1, own / (ownMax || 1)) ** 0.8 * 190;
  const others = Math.min(1, (heat.value[cell] - own) / (heat.max || 1)) ** 0.8 * 150 * FADED;
  return mine >= others || heat.group[cell] === selected ? { group: selected, alpha: Math.round(mine) } : { group: heat.group[cell], alpha: Math.round(others) };
}

/** The ids the walk takes for a cloud: all of them, or, past MAX_CLOUD_ITEMS, the new shoot's first, then the closest to its center. */
export function cloudIds(map: Pick<MapInput, 'items'>, xy: Float32Array, cloud: Cloud, max = MAX_CLOUD_ITEMS): string[] {
  const away = (i: number) => Math.hypot(xy[i * 2] - cloud.center[0], xy[i * 2 + 1] - cloud.center[1]);
  return [...cloud.indices]
    .sort((a, b) => Number(map.items[b].new) - Number(map.items[a].new) || away(a) - away(b) || a - b)
    .slice(0, max)
    .map((i) => map.items[i].id);
}
