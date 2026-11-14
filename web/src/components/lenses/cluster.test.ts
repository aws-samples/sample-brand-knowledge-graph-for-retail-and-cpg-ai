// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { decodeVectors, groupLabels, knnGraph, lift, louvain, similarities, words } from './cluster';
import { density, normalise, pca2, tsne } from './embed2d';

/** Two tight bundles of directions in 8-D, as the API sends them (int8, base64). */
function bundles(per = 6): { b64: string; n: number; dim: number } {
  const dim = 8;
  const bytes: number[] = [];
  for (let g = 0; g < 2; g++) {
    for (let i = 0; i < per; i++) {
      const v = Array.from({ length: dim }, (_, d) => (d < 4 === (g === 0) ? 100 : 0) + ((i * 7 + d * 3) % 11) - 5);
      const scale = 127 / Math.max(...v.map(Math.abs));
      for (const x of v) bytes.push(Math.round(x * scale) & 0xff);
    }
  }
  return { b64: btoa(String.fromCharCode(...bytes)), n: per * 2, dim };
}

describe('decodeVectors', () => {
  it('reads signed bytes and normalises each row', () => {
    const b64 = btoa(String.fromCharCode(127, 0x81 /* -127 */, 0, 0));
    const [v] = decodeVectors(b64, 1, 4);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2);
    expect(v[1]).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe('knnGraph + louvain', () => {
  it('finds the two bundles in the full space', () => {
    const { b64, n, dim } = bundles();
    const vecs = decodeVectors(b64, n, dim);
    const sim = similarities(vecs);
    const edges = knnGraph(sim, n, 3);
    for (const [a, b, w] of edges) {
      expect(a).toBeLessThan(b); // each pair once
      expect(w).toBeGreaterThan(0);
    }
    const groups = louvain(n, edges);
    expect(new Set(groups.slice(0, 6)).size).toBe(1);
    expect(new Set(groups.slice(6)).size).toBe(1);
    expect(groups[0]).not.toBe(groups[6]);
  });

  it('keeps two cliques apart when a weak edge joins them, and numbers groups by size', () => {
    const clique = (ids: number[]) => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b, 1] as [number, number, number]));
    const edges = [...clique([0, 1, 2]), ...clique([3, 4, 5, 6]), [2, 3, 0.05] as [number, number, number]];
    const groups = louvain(7, edges);
    expect(groups).toEqual([1, 1, 1, 0, 0, 0, 0]);
  });
});

describe('labels and lift', () => {
  it('names each group by the words it uses more than the others', () => {
    const texts = ['trench coat beige trench', 'trench coat double breasted', 'linen shirt summer', 'linen trousers summer'];
    const labels = groupLabels(texts, [0, 0, 1, 1], 2);
    expect(labels[0]).toContain('trench');
    expect(labels[1]).toContain('linen');
    expect(words('The Trench-coat, and a BELT')).toEqual(['trench-coat', 'belt']);
  });

  it('leaves out words that are in more than half of all items (the brand, page fields)', () => {
    const texts = Array.from({ length: 12 }, (_, i) => `velloway material ${i < 6 ? 'trench gabardine' : 'linen terrace'}`);
    const labels = groupLabels(texts, texts.map((_, i) => (i < 6 ? 0 : 1)), 3);
    expect(labels.flat()).not.toContain('velloway');
    expect(labels.flat()).not.toContain('material');
    expect(labels[0]).toEqual(['gabardine', 'trench']);
  });

  it('computes the same lift as the API', () => {
    expect(lift(3, 3, 0, 54)).toBeCloseTo(3.5 / 4 / (0.5 / 55));
    expect(lift(0, 0, 0, 0)).toBe(1);
  });
});

describe('map', () => {
  it('t-SNE keeps the two bundles apart, from a deterministic PCA start', () => {
    const { b64, n, dim } = bundles(8);
    const vecs = decodeVectors(b64, n, dim);
    const init = pca2(vecs);
    expect(pca2(vecs)).toEqual(init);
    const xy = normalise(tsne(similarities(vecs), n, init, { iterations: 300 }));
    const centre = (from: number) => [0, 1].map((a) => Array.from({ length: 8 }, (_, i) => xy[(from + i) * 2 + a]).reduce((s, x) => s + x, 0) / 8);
    const [a, b] = [centre(0), centre(8)];
    const spread = (from: number, c: number[]) => Math.max(...Array.from({ length: 8 }, (_, i) => Math.hypot(xy[(from + i) * 2] - c[0], xy[(from + i) * 2 + 1] - c[1])));
    const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(gap).toBeGreaterThan(spread(0, a) + spread(8, b));
    for (const x of xy) expect(x >= 0 && x <= 1).toBe(true);
  });

  it('draws the density around the points', () => {
    const xy = Float32Array.from([0.25, 0.25, 0.75, 0.75]);
    const grid = density(xy, [1, 0], 20, 0.05);
    expect(grid[5 * 20 + 5]).toBeGreaterThan(grid[15 * 20 + 15]); // only the first point weighs
  });
});
