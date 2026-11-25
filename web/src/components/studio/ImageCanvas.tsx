// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useRef, useState } from 'react';
import type { Entity } from '../../api';

export type Box = { key: string; kind: 'entity' | 'part'; entity: Entity; part?: Entity['parts'][number]; bbox: [number, number, number, number]; label: string };

/** Flatten entities + parts into drawable boxes (only those with a valid bbox). */
export function boxesOf(entities: Entity[]): Box[] {
  const out: Box[] = [];
  for (const e of entities) {
    if (e.bbox) out.push({ key: e.id, kind: 'entity', entity: e, bbox: e.bbox, label: `${e.class}${e.label ? ' · ' + e.label : ''}` });
    for (const p of e.parts) {
      if (p.bbox) out.push({ key: p.id, kind: 'part', entity: e, part: p, bbox: p.bbox, label: `${p.class}${p.label ? ' · ' + p.label : ''}` });
    }
  }
  return out;
}

const ENTITY = '#ff9900';
const PART = '#0972d3';
const ACTIVE = '#d91515';

/**
 * The image with model bounding boxes drawn on a canvas overlay (bbox coordinates are on a
 * 0-1000 scale of the image width/height). Hover/click a box -> `onSelect`; `active` keys are
 * emphasized (driven from the ontology graph side too, so highlighting works both ways).
 */
export function ImageCanvas({
  src,
  boxes,
  active,
  showParts,
  onSelect,
  onHover,
}: {
  src: string | null;
  boxes: Box[];
  active: Set<string>;
  showParts: boolean;
  onSelect: (box: Box | null) => void;
  onHover?: (box: Box | null) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const update = () => setSize({ w: img.clientWidth, h: img.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(img);
    update();
    return () => ro.disconnect();
  }, [src]);

  const visible = boxes.filter((b) => showParts || b.kind === 'entity');

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    const anyActive = active.size > 0;
    // Draw entities first, parts on top; active boxes last so they stay visible.
    const ordered = [...visible].sort((a, b) => Number(active.has(a.key) || hover === a.key) - Number(active.has(b.key) || hover === b.key) || Number(a.kind === 'part') - Number(b.kind === 'part'));
    for (const b of ordered) {
      const [x0, y0, x1, y1] = b.bbox;
      const x = (x0 / 1000) * size.w;
      const y = (y0 / 1000) * size.h;
      const w = ((x1 - x0) / 1000) * size.w;
      const h = ((y1 - y0) / 1000) * size.h;
      const isActive = active.has(b.key) || hover === b.key;
      const color = isActive ? ACTIVE : b.kind === 'entity' ? ENTITY : PART;
      ctx.globalAlpha = anyActive && !isActive ? 0.35 : 1;
      ctx.lineWidth = isActive ? 3 : b.kind === 'entity' ? 2 : 1.2;
      ctx.strokeStyle = color;
      ctx.setLineDash(b.kind === 'part' && !isActive ? [4, 3] : []);
      ctx.strokeRect(x, y, w, h);
      if (isActive) {
        ctx.fillStyle = color + '22';
        ctx.fillRect(x, y, w, h);
      }
      // label chip
      const text = b.label.length > 34 ? b.label.slice(0, 32) + '…' : b.label;
      ctx.font = `${isActive ? 'bold ' : ''}11px sans-serif`;
      const tw = ctx.measureText(text).width + 8;
      const ly = y > 16 ? y - 16 : y + 2;
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillRect(x, ly, tw, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + 4, ly + 11);
    }
    ctx.globalAlpha = 1;
  }, [visible, active, hover, size]);

  function hit(evt: React.MouseEvent): Box | null {
    const c = canvasRef.current;
    if (!c || !size.w) return null;
    const r = c.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / size.w) * 1000;
    const py = ((evt.clientY - r.top) / size.h) * 1000;
    // Smallest box containing the point wins (parts before their entity).
    let best: Box | null = null;
    let bestArea = Infinity;
    for (const b of visible) {
      const [x0, y0, x1, y1] = b.bbox;
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
        const area = (x1 - x0) * (y1 - y0);
        if (area < bestArea) {
          best = b;
          bestArea = area;
        }
      }
    }
    return best;
  }

  if (!src) {
    return (
      <div className="dropzone" style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="muted">Pick an example or upload an image to start.</span>
      </div>
    );
  }
  return (
    <>
      <div className="image-stage">
        <img ref={imgRef} src={src} alt={`the photo with ${boxes.length} detected boxes`} onLoad={() => setSize({ w: imgRef.current?.clientWidth ?? 0, h: imgRef.current?.clientHeight ?? 0 })} />
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          onMouseMove={(e) => {
            const b = hit(e);
            const k = b?.key ?? null;
            if (k !== hover) {
              setHover(k);
              onHover?.(b);
            }
          }}
          onMouseLeave={() => {
            setHover(null);
            onHover?.(null);
          }}
          onClick={(e) => onSelect(hit(e))}
          aria-hidden="true"
        />
      </div>
      {/* keyboard and screen reader path to the boxes drawn on the canvas */}
      {visible.length > 0 && (
        <div className="row po-chips box-buttons" role="group" aria-label="boxes on the photo">
          {visible.map((b) => (
            <button key={b.key} type="button" className={`small secondary${active.has(b.key) ? ' active' : ''}`} aria-pressed={active.has(b.key)} onClick={() => onSelect(b)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
