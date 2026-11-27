// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The trends lens's map (method 3, "Explore the clouds"): the garments in two dimensions and a
 * heat map over them.
 *
 * Exact t-SNE (van der Maaten & Hinton, 2008) on the cosine distances, initialised with the two
 * principal components (PCA) so the same garments always draw the same map and the global layout
 * means something (Kobak & Linderman, 2021). The picture is only for looking and clicking: the
 * clouds come from the full vectors (cluster.ts). The heat map is a Gaussian kernel density of the
 * points.
 */

/** The two principal components of the rows, by power iteration (deterministic start). */
export function pca2(vecs: Float32Array[]): Float32Array {
  const n = vecs.length;
  const dim = vecs[0]?.length ?? 0;
  const mean = new Float64Array(dim);
  for (const v of vecs) for (let d = 0; d < dim; d++) mean[d] += v[d] / n;
  const X = vecs.map((v) => Float64Array.from(v, (x, d) => x - mean[d]));
  const comps: Float64Array[] = [];
  for (let c = 0; c < 2; c++) {
    let w = Float64Array.from({ length: dim }, (_, d) => Math.sin(d + 1 + c * 7)); // fixed start
    for (let it = 0; it < 60; it++) {
      const proj = X.map((row) => row.reduce((s, x, d) => s + x * w[d], 0));
      const next = new Float64Array(dim);
      X.forEach((row, i) => {
        for (let d = 0; d < dim; d++) next[d] += row[d] * proj[i];
      });
      for (const prev of comps) {
        const dot = next.reduce((s, x, d) => s + x * prev[d], 0);
        for (let d = 0; d < dim; d++) next[d] -= dot * prev[d];
      }
      const norm = Math.hypot(...next) || 1;
      w = next.map((x) => x / norm);
    }
    comps.push(w);
  }
  const out = new Float32Array(n * 2);
  X.forEach((row, i) => {
    out[i * 2] = row.reduce((s, x, d) => s + x * comps[0][d], 0);
    out[i * 2 + 1] = row.reduce((s, x, d) => s + x * comps[1][d], 0);
  });
  return out;
}

export type TsneOptions = { perplexity?: number; iterations?: number; exaggeration?: number };

/** Exact t-SNE of the points whose cosine similarities are `sim` (n × n); returns n × 2. */
export function tsne(sim: Float32Array, n: number, init: Float32Array, opts: TsneOptions = {}): Float32Array {
  if (n < 3) return Float32Array.from(init);
  const perplexity = Math.min(opts.perplexity ?? 15, (n - 1) / 3);
  const iterations = opts.iterations ?? (n <= 300 ? 750 : 400);
  const exaggerate = opts.exaggeration ?? 12;
  const P = affinities(sim, n, perplexity);

  // PCA init, scaled to a standard deviation of 1e-4 on the first axis (openTSNE's default)
  let sd = 0;
  for (let i = 0; i < n; i++) sd += init[i * 2] ** 2 / n;
  const scale = 1e-4 / (Math.sqrt(sd) || 1);
  const Y = Float64Array.from(init, (x) => x * scale);
  const update = new Float64Array(n * 2);
  const gains = new Float64Array(n * 2).fill(1);
  const lr = Math.max(n / exaggerate, 50);
  const num = new Float64Array(n * n);
  const grad = new Float64Array(n * 2);

  for (let it = 0; it < iterations; it++) {
    const early = it < 250;
    const ex = early ? exaggerate : 1;
    const momentum = early ? 0.5 : 0.8;
    let Z = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i * 2] - Y[j * 2];
        const dy = Y[i * 2 + 1] - Y[j * 2 + 1];
        const q = 1 / (1 + dx * dx + dy * dy);
        num[i * n + j] = q;
        num[j * n + i] = q;
        Z += 2 * q;
      }
    }
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = num[i * n + j];
        const mult = (ex * P[i * n + j] - q / Z) * q;
        grad[i * 2] += 4 * mult * (Y[i * 2] - Y[j * 2]);
        grad[i * 2 + 1] += 4 * mult * (Y[i * 2 + 1] - Y[j * 2 + 1]);
      }
    }
    for (let d = 0; d < n * 2; d++) {
      gains[d] = Math.sign(grad[d]) !== Math.sign(update[d]) ? gains[d] + 0.2 : Math.max(gains[d] * 0.8, 0.01);
      update[d] = momentum * update[d] - lr * gains[d] * grad[d];
      Y[d] += update[d];
    }
    // keep the map centered
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += Y[i * 2] / n;
      cy += Y[i * 2 + 1] / n;
    }
    for (let i = 0; i < n; i++) {
      Y[i * 2] -= cx;
      Y[i * 2 + 1] -= cy;
    }
  }
  return Float32Array.from(Y);
}

/** The symmetric input affinities P: per point, a Gaussian over squared distances whose
 * bandwidth is found by bisection to give the target perplexity. */
function affinities(sim: Float32Array, n: number, perplexity: number): Float64Array {
  const P = new Float64Array(n * n);
  const target = Math.log(perplexity);
  const row = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = Infinity;
    let beta = 1;
    for (let tries = 0; tries < 60; tries++) {
      let sum = 0;
      let dSum = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) {
          row[j] = 0;
          continue;
        }
        const d2 = Math.max(0, 2 - 2 * sim[i * n + j]); // ‖a−b‖² of unit vectors
        row[j] = Math.exp(-beta * d2);
        sum += row[j];
        dSum += d2 * row[j];
      }
      sum = sum || 1e-12;
      const entropy = Math.log(sum) + (beta * dSum) / sum;
      if (Math.abs(entropy - target) < 1e-5) break;
      if (entropy > target) {
        lo = beta;
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2;
      } else {
        hi = beta;
        beta = (beta + lo) / 2;
      }
    }
    const sum = row.reduce((s, x) => s + x, 0) || 1e-12;
    for (let j = 0; j < n; j++) P[i * n + j] = row[j] / sum;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = Math.max((P[i * n + j] + P[j * n + i]) / (2 * n), 1e-12);
      P[i * n + j] = p;
      P[j * n + i] = p;
    }
  }
  return P;
}

/** The points scaled into [pad, 1 − pad]² (keeping the aspect ratio). */
export function normalise(xy: Float32Array, pad = 0.06): Float32Array {
  const n = xy.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xy[i * 2]);
    maxX = Math.max(maxX, xy[i * 2]);
    minY = Math.min(minY, xy[i * 2 + 1]);
    maxY = Math.max(maxY, xy[i * 2 + 1]);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const s = (1 - 2 * pad) / span;
  const ox = (1 - (maxX - minX) * s) / 2;
  const oy = (1 - (maxY - minY) * s) / 2;
  return Float32Array.from({ length: n * 2 }, (_, k) => (k % 2 === 0 ? ox + (xy[k] - minX) * s : oy + (xy[k] - minY) * s));
}

/** A size × size grid of Gaussian kernel density over normalized points, each with a weight. */
export function density(xy: Float32Array, weights: number[], size = 72, bandwidth = 0.05): Float32Array {
  const grid = new Float32Array(size * size);
  const reach = Math.ceil(3 * bandwidth * size);
  const n = xy.length / 2;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (!w) continue;
    const cx = xy[i * 2] * size;
    const cy = xy[i * 2 + 1] * size;
    for (let gy = Math.max(0, Math.floor(cy) - reach); gy <= Math.min(size - 1, Math.floor(cy) + reach); gy++) {
      for (let gx = Math.max(0, Math.floor(cx) - reach); gx <= Math.min(size - 1, Math.floor(cx) + reach); gx++) {
        const dx = (gx + 0.5 - cx) / size;
        const dy = (gy + 0.5 - cy) / size;
        grid[gy * size + gx] += w * Math.exp(-(dx * dx + dy * dy) / (2 * bandwidth * bandwidth));
      }
    }
  }
  return grid;
}
