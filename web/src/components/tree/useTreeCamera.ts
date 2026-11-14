// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp } from './svg';

/**
 * Pan and zoom for the SVG trees (tab 2's run tree, tab 3's evidence tree): the opening view fits
 * the width while labels stay legible, the wheel zooms (or pans), drag pans, "Fit" shows
 * everything, and keyboard focus pans just enough to show the focused box. The view refits on
 * a new layout or a resize until the user zooms or pans.
 */
export type Cam = { k: number; x: number; y: number };
export type Rect = { l: number; t: number; r: number; b: number };
/** `readable`: the smallest opening zoom (13 px labels stay ≥ 11 px on screen). */
const TREE_ZOOM = { min: 0.1, max: 3, fit: 1.25, readable: 0.85 };
export const TREE_PAD = 16;

/** The zoom the view opens at: the whole width when that keeps labels legible. */
export function openingZoom(viewWidth: number, contentWidth: number): number {
  return clamp(Math.max((viewWidth - 2 * TREE_PAD) / Math.max(1, contentWidth), TREE_ZOOM.readable), TREE_ZOOM.min, TREE_ZOOM.fit);
}

/** The width of an element, kept up to date. */
export function useElementWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || fallback));
    ro.observe(el);
    setWidth(el.clientWidth || fallback);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}

export function useTreeCamera({
  width,
  height,
  content,
  anchorX,
  wheel = 'zoom',
}: {
  width: number;
  height: number;
  /** Size of the drawing in graph units; a new object (a new layout) refits the view. */
  content: { width: number; height: number };
  /** Graph x to center when the drawing is wider than the view at a legible zoom; null = its left edge. */
  anchorX: number | null;
  /** 'zoom': the wheel zooms. 'pan': the wheel pans, Ctrl/⌘ + wheel (and a trackpad pinch) zooms. */
  wheel?: 'zoom' | 'pan';
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cam, setCam] = useState<Cam>({ k: 1, x: 0, y: 0 });
  const size = useRef({ width, height });
  size.current = { width, height };
  /** The user zoomed or panned since the last automatic fit: resizing no longer refits. */
  const touched = useRef(false);
  /** The next new drawing keeps the view (the caller moves it, e.g. to keep a clicked box in place). */
  const held = useRef(false);

  const fitWidth = useCallback(
    (w: number): Cam => {
      const k = openingZoom(w, content.width);
      const x = content.width * k <= w ? (w - content.width * k) / 2 : anchorX === null ? TREE_PAD / 2 : w / 2 - anchorX * k;
      return { k, x, y: TREE_PAD / 2 };
    },
    [content, anchorX],
  );
  const fitAll = useCallback((): Cam => {
    const k = clamp(Math.min((width - 2 * TREE_PAD) / content.width, (height - 2 * TREE_PAD) / content.height), TREE_ZOOM.min, TREE_ZOOM.fit);
    return { k, x: (width - content.width * k) / 2, y: (height - content.height * k) / 2 };
  }, [content, width, height]);
  useEffect(() => {
    if (held.current) held.current = false;
    else touched.current = false;
  }, [content]);
  useEffect(() => {
    if (!touched.current) setCam(fitWidth(width));
  }, [fitWidth, width]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    touched.current = true;
    setCam((c) => {
      const k = clamp(c.k * factor, TREE_ZOOM.min, TREE_ZOOM.max);
      return { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
    });
  }, []);
  const fit = useCallback(() => {
    touched.current = true;
    setCam(fitAll());
  }, [fitAll]);

  // wheel: a native non-passive listener, so the page does not scroll while zooming or panning.
  // In 'pan' mode the page scrolls on once the drawing's top or bottom edge is in view.
  const camRef = useRef(cam);
  camRef.current = cam;
  const contentRef = useRef(content);
  contentRef.current = content;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (wheel === 'pan' && !e.ctrlKey && !e.metaKey) {
        const { width: w, height: h } = size.current;
        const c = camRef.current;
        const [cw, ch] = [contentRef.current.width * c.k, contentRef.current.height * c.k];
        const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY * unit, 0] : [e.deltaX * unit, e.deltaY * unit];
        const m = TREE_PAD / 2;
        // a drawing that fits stays put; a larger one pans until its edge reaches the view's
        const pan = (pos: number, d: number, view: number, extent: number) => (extent <= view - 2 * m ? pos : clamp(pos - d, Math.min(pos, view - m - extent), Math.max(pos, m)));
        const [x, y] = [pan(c.x, dx, w, cw), pan(c.y, dy, h, ch)];
        if (Math.abs(x - c.x) < 0.5 && Math.abs(y - c.y) < 0.5) return; // at the edge: the page scrolls
        e.preventDefault();
        touched.current = true;
        setCam({ ...c, x, y });
        return;
      }
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * unit * (wheel === 'pan' ? 0.003 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt, wheel]);

  // drag to pan; a drag that started on a box does not select it
  const drag = useRef<{ id: number; x: number; y: number; cam: Cam; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, cam, moved: false };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    touched.current = true;
    setCam({ ...d.cam, x: d.cam.x + dx, y: d.cam.y + dy });
  };
  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.moved) {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setDragging(false);
  };

  /** Pan just enough to show a rectangle (graph units), for keyboard focus. */
  const reveal = useCallback((rect: Rect, margin = 24) => {
    setCam((c) => {
      const { width: w, height: h } = size.current;
      const [l, r, t, b] = [c.x + rect.l * c.k, c.x + rect.r * c.k, c.y + rect.t * c.k, c.y + rect.b * c.k];
      const dx = l < margin ? margin - l : r > w - margin ? w - margin - r : 0;
      const dy = t < margin ? margin - t : b > h - margin ? h - margin - b : 0;
      if (!dx && !dy) return c;
      touched.current = true;
      return { ...c, x: c.x + dx, y: c.y + dy };
    });
  }, []);

  /** Bring a region into view: its top-left corner (or its center, when it fits) near the top of the view. */
  const focusOn = useCallback((rect: Rect) => {
    setCam((c) => {
      const { width: w, height: h } = size.current;
      const [l, r, t, b] = [c.x + rect.l * c.k, c.x + rect.r * c.k, c.y + rect.t * c.k, c.y + rect.b * c.k];
      if (l >= TREE_PAD && r <= w - TREE_PAD && t >= TREE_PAD && b <= h - TREE_PAD) return c;
      touched.current = true;
      const fitsX = (rect.r - rect.l) * c.k <= w - 2 * TREE_PAD;
      const x = fitsX ? w / 2 - ((rect.l + rect.r) / 2) * c.k : TREE_PAD - rect.l * c.k;
      return { ...c, x, y: TREE_PAD * 2 - rect.t * c.k };
    });
  }, []);

  /** Keep the current view through the next layout change instead of refitting. */
  const hold = useCallback(() => {
    held.current = true;
    touched.current = true;
  }, []);

  return {
    svgRef,
    cam,
    setCam,
    hold,
    dragging,
    suppressClick,
    zoomAt,
    fit,
    reveal,
    focusOn,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
