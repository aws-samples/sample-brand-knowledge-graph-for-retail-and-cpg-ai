// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** Small drawing helpers shared by the SVG trees (tab 2's run tree, tab 3's evidence tree). */

export type Point = [number, number];

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** An opaque mix of `hex` with white: `a` = share of the color. */
export function tint(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const mix = (c: string) => Math.round(255 - (255 - parseInt(c, 16)) * a);
  return `rgb(${mix(m[1])}, ${mix(m[2])}, ${mix(m[3])})`;
}

/** SVG path for an orthogonal polyline with its elbows rounded off (radius r, less on short segments). */
export function pathD(pts: Point[], r = 5): string {
  if (pts.length < 2) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const lin = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const lout = Math.hypot(n[0] - q[0], n[1] - q[1]);
    const rr = Math.min(r, lin / 2, lout / 2);
    const straight = Math.abs((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0])) < 1e-6;
    if (rr < 0.5 || straight) {
      d += ` L${f(q[0])} ${f(q[1])}`;
      continue;
    }
    const a: Point = [q[0] - ((q[0] - p[0]) / lin) * rr, q[1] - ((q[1] - p[1]) / lin) * rr];
    const b: Point = [q[0] + ((n[0] - q[0]) / lout) * rr, q[1] + ((n[1] - q[1]) / lout) * rr];
    d += ` L${f(a[0])} ${f(a[1])} Q${f(q[0])} ${f(q[1])} ${f(b[0])} ${f(b[1])}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last[0])} ${f(last[1])}`;
}

/** Canvas text measurement for the tree layouts (cached; falls back to `fallback` without a DOM). */
export function canvasMeasure(fontFamily: string, fallback: (text: string, font: number, bold: boolean) => number) {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  const cache = new Map<string, number>();
  return (text: string, font: number, bold: boolean) => {
    if (!ctx) return fallback(text, font, bold);
    const key = `${bold ? 'b' : 'r'}${font}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = `${bold ? 600 : 400} ${font}px ${fontFamily}`;
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}
