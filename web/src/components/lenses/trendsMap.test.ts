// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { TrendsMapItem } from '../../api';
import { lift } from './cluster';
import { BADGE_MIN, FADED, cloudIds, density, heatPixel, layout, liftBar, liftPhrase, liftText, nearest, newShootOnly, pickAt, ranked, type Cloud, type Heat, type Layout, type MapInput } from './trendsMap';

/**
 * Three clear groups of garments: each a direction in an 8-dimension space with a little noise,
 * packed as the API packs them (int8, each vector scaled so its largest |x| is 127). The trousers
 * are mostly the new shoot, the loafers and the shirts are the lookbook.
 */
const DIM = 8;
const PER = 10;
const NAMES = ['cream wide-leg trousers', 'black leather loafers', 'white cotton shirt'];

function synthetic(): MapInput {
  const bytes: number[] = [];
  const items: TrendsMapItem[] = [];
  for (let g = 0; g < 3; g++) {
    for (let k = 0; k < PER; k++) {
      const v = Array.from({ length: DIM }, (_, d) => (d === g ? 1 : 0.08 * Math.sin(7 * g + 3 * k + d)));
      const scale = 127 / Math.max(...v.map(Math.abs));
      bytes.push(...v.map((x) => Math.round(x * scale) & 0xff));
      items.push({ id: `item:${g}-${k}`, name: `${NAMES[g]} ${k}`, category: '', new: g === 0 && k < 8, looks: 1 });
    }
  }
  const fresh = items.filter((i) => i.new).length;
  return { n: items.length, dim: DIM, vectors: btoa(String.fromCharCode(...bytes)), items, totals: { new: fresh, base: items.length - fresh } };
}

const map = synthetic();
const lay = layout(map);

describe('the trends map', () => {
  it('finds the three groups on the full vectors', () => {
    expect(lay.groups).toHaveLength(3);
    for (let g = 0; g < 3; g++) {
      const members = new Set(lay.groupOf.slice(g * PER, (g + 1) * PER));
      expect(members.size).toBe(1);
    }
    expect(new Set(lay.groupOf).size).toBe(3);
    expect(lay.groups.map((c) => c.size)).toEqual([PER, PER, PER]);
  });

  it('names each cloud by its words and counts its lift in code', () => {
    const trousers = lay.groups[lay.groupOf[0]];
    const loafers = lay.groups[lay.groupOf[PER]];
    expect(trousers.label).toMatch(/trousers|wide-leg|cream/);
    expect(trousers.new).toBe(8);
    expect(trousers.base).toBe(2);
    // (8 + 0.5) / 9 over (2 + 0.5) / 23
    expect(trousers.lift).toBeCloseTo(8.5 / 9 / (2.5 / 23), 6);
    expect(trousers.lift).toBeGreaterThan(1.5);
    expect(loafers.lift).toBeLessThan(1);
    expect(ranked(lay.groups, map.totals.new)[0].id).toBe(trousers.id);
  });

  it('ranks the clouds by size when no new shoot is in the graph', () => {
    const groups = [
      { ...lay.groups[0], size: 3, lift: 9 },
      { ...lay.groups[1], size: 7, lift: 1 },
    ];
    expect(ranked(groups, 0).map((c) => c.size)).toEqual([7, 3]);
    expect(ranked(groups, 5).map((c) => c.lift)).toEqual([9, 1]);
  });

  it('says "new shoot only" for a cloud with no lookbook garment, and keeps the other bars readable', () => {
    // 10 new garments of 21, none of 1,300 lookbook garments: the smoothing alone gives 1,300
    const only = { new: 10, base: 0, lift: lift(10, 21, 0, 1300) };
    const grown = { new: 6, base: 20, lift: lift(6, 21, 20, 1300) };
    const fading = { new: 1, base: 400, lift: lift(1, 21, 400, 1300) };
    expect(only.lift).toBeGreaterThan(1000);
    expect(newShootOnly(only)).toBe(true);
    expect(liftText(only)).toBe('new shoot only');
    expect(liftPhrase(only)).toBe('new shoot only');
    expect(newShootOnly(grown)).toBe(false);
    expect(liftText(grown)).toBe(grown.lift.toFixed(2));
    expect(liftPhrase(grown)).toBe(`lift ${grown.lift.toFixed(2)}`);
    // an empty cloud of the new shoot is not "new shoot only"
    expect(newShootOnly({ new: 0, base: 0 })).toBe(false);
    const all = [only, grown, fading];
    expect(liftBar(only, all)).toBe(1);
    expect(liftBar(grown, all)).toBe(1);
    expect(liftBar(fading, all)).toBeCloseTo(fading.lift / grown.lift, 6);
  });

  it('lays the map out in the unit square', () => {
    expect(lay.xy).toHaveLength(map.n * 2);
    for (const v of lay.xy) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('finds the garment nearest to a point, and none off the points', () => {
    const i = PER + 3;
    expect(lay.groupOf[nearest(lay.xy, lay.xy[i * 2] + 0.005, lay.xy[i * 2 + 1], 0.03)!]).toBe(lay.groupOf[i]);
    expect(nearest(lay.xy, -1, -1, 0.03)).toBeNull();
  });

  it('draws a density whose cells add up to the clouds’ own densities', () => {
    const heat = density(lay.xy, lay.groupOf, 24);
    expect(heat.byGroup).toHaveLength(3);
    const total = heat.value.reduce((s, x) => s + x, 0);
    const parts = heat.byGroup.reduce((s, g) => s + g.reduce((t, x) => t + x, 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(parts, 3);
    expect(heat.max).toBe(Math.max(...heat.value));
    // the cell under a garment belongs to that garment's cloud
    for (const i of [0, PER, 2 * PER]) {
      const cell = Math.min(23, Math.floor(lay.xy[i * 2 + 1] * 24)) * 24 + Math.min(23, Math.floor(lay.xy[i * 2] * 24));
      expect(heat.group[cell]).toBe(lay.groupOf[i]);
    }
  });

  it('walks at most the cap of a cloud, the new shoot first', () => {
    const trousers = lay.groups[lay.groupOf[0]];
    const ids = cloudIds(map, lay.xy, trousers, 8);
    expect(ids).toHaveLength(8);
    expect(ids.every((id) => map.items.find((x) => x.id === id)!.new)).toBe(true);
    expect(cloudIds(map, lay.xy, trousers)).toHaveLength(PER);
  });
});

/**
 * A map drawn 500 × 400 px with three clouds: 0 and 1 have number badges (BADGE_MIN garments or
 * more), 2 is small and has none unless it is selected. One garment each. A 10 × 10 heat grid:
 * cloud 1 dominates the centre cell, cloud 0 two cells in the corners, one just above 5 % of
 * the densest, one just below.
 */
const W = 500;
const H = 400;
const cloud = (id: number, size: number, center: [number, number]): Cloud => ({ id, indices: [id], size, new: 0, base: size, lift: 1, label: `cloud ${id + 1}`, center });
const toy: Layout = {
  xy: Float32Array.from([0.3, 0.2, 0.8, 0.7, 0.5, 0.2]),
  groupOf: [0, 1, 2],
  groups: [cloud(0, BADGE_MIN + 1, [0.2, 0.2]), cloud(1, BADGE_MIN + 1, [0.8, 0.8]), cloud(2, 2, [0.5, 0.3])],
};
function toyHeat(): Heat {
  const size = 10;
  const value = new Float32Array(size * size);
  const group = new Int32Array(size * size).fill(-1);
  const byGroup = [0, 1, 2].map(() => new Float32Array(size * size));
  const put = (row: number, col: number, g: number, v: number) => {
    value[row * size + col] = v;
    group[row * size + col] = g;
    byGroup[g][row * size + col] = v;
  };
  put(5, 5, 1, 1);
  put(0, 9, 0, 0.06);
  put(9, 0, 0, 0.04);
  return { value, group, byGroup, max: 1, size };
}
const heat = toyHeat();
const pick = (x: number, y: number, selected: number | null = null) => pickAt(toy, heat, x, y, W, H, selected);

describe('picking a cloud on the map (in px)', () => {
  it('picks the cloud whose number badge is under the pointer', () => {
    expect(pick(102, 82)).toBe(0); // badge of cloud 0 at (100, 80); its garment is 48 px away
    expect(pick(400, 318)).toBe(1);
    // a small cloud has no badge: there it is empty space, unless it is the selected one
    expect(pick(250, 120)).toBeNull();
    expect(pick(250, 120, 2)).toBe(2);
  });

  it('measures the reach in px, so it is a circle on a map wider than it is high', () => {
    expect(nearest(toy.xy, 163, 80, 14, W, H)).toBe(0);
    expect(nearest(toy.xy, 150, 93, 14, W, H)).toBe(0);
    expect(nearest(toy.xy, 150, 95, 14, W, H)).toBeNull();
  });

  it('picks the cloud of a garment within 14 px, across and up alike', () => {
    expect(pick(163, 80)).toBe(0); // the garment of cloud 0 is at (150, 80)
    expect(pick(150, 93)).toBe(0);
    expect(pick(250, 93)).toBe(2); // a small cloud's garment is a target without a badge
    expect(pick(150, 96)).toBeNull(); // 16 px: out of reach, and the heat there is empty
  });

  it("picks the cloud that holds the heat cell under the pointer, from 5 % of the map's densest", () => {
    expect(pick(275, 220)).toBe(1); // the centre cell, cloud 1's
    expect(pick(475, 20)).toBe(0); // 6 %
    expect(pick(25, 380)).toBeNull(); // 4 %
  });

  it('picks nothing on empty space, so a selection stays', () => {
    expect(pick(25, 200)).toBeNull();
    expect(pick(25, 200, 1)).toBeNull();
  });

  it('switches from a selected cloud to another by its badge, its garment or its heat', () => {
    expect(pick(400, 318, 0)).toBe(1);
    expect(pick(400, 285, 0)).toBe(1); // cloud 1's garment at (400, 280)
    expect(pick(275, 220, 0)).toBe(1);
    expect(pick(102, 82, 1)).toBe(0);
  });

  it("keeps the other clouds' heat visible at 35 % when one is selected", () => {
    const centre = 5 * 10 + 5;
    expect(heatPixel(heat, centre, null, 1)).toEqual({ group: 1, alpha: 150 });
    expect(heatPixel(heat, centre, 0, 0.06)).toEqual({ group: 1, alpha: Math.round(150 * FADED) });
    expect(heatPixel(heat, centre, 1, 1)).toEqual({ group: 1, alpha: 190 });
    expect(FADED).toBe(0.35);
  });
});

