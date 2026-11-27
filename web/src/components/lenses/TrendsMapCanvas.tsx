// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import type { TrendsMap as TrendsMapData } from '../../api';
import { Notice } from '../retriever/Callouts';
import { COLORED_CLOUDS, groupColor } from './trendsColors';
import { badged, BADGE_RADIUS, density, FADED, heatPixel, liftBar, liftPhrase, liftText, nearest, pickAt, ranked, REACH, type Layout } from './trendsMap';

const HEIGHT = 460;

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * The season on one map: every worn garment a point, a heat map of where they are dense, each
 * cell coloured by the cloud that holds most of it, and each cloud's number. Hover a garment for
 * its cloud. Click a number, a garment or a cloud's coloured area to pick it (pickAt), with or
 * without a cloud picked already; the numbers are also buttons, for the keyboard. Small clouds
 * have no number: pick them in the table under the map (sorted by lift).
 */
export function TrendsMap({ map, lay, selected, onSelect, disabled }: { map: TrendsMapData; lay: Layout; selected: number | null; onSelect: (cloud: number) => void; disabled: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heat = useMemo(() => density(lay.xy, lay.groupOf), [lay]);
  // the heat layer: each cell in its cloud's colour, as strong as the density there; with a
  // selection, its own density on top and the other clouds still visible, faded
  const heatImage = useMemo(() => {
    const img = new ImageData(heat.size, heat.size);
    const ownMax = selected === null ? 1 : Math.max(...heat.byGroup[selected]) || 1;
    heat.value.forEach((_, c) => {
      const { group, alpha } = heatPixel(heat, c, selected, ownMax);
      const [r, gr, b] = rgb(groupColor(group));
      img.data.set([r, gr, b, alpha], c * 4);
    });
    return img;
  }, [heat, selected]);

  const toCanvas = (i: number): [number, number] => [lay.xy[i * 2] * width, lay.xy[i * 2 + 1] * HEIGHT];

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = HEIGHT * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const off = document.createElement('canvas');
    off.width = heat.size;
    off.height = heat.size;
    off.getContext('2d')?.putImageData(heatImage, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, width, HEIGHT);
    // garments: the lookbook small, the new shoot larger with a dark ring; other clouds faded once one is picked
    map.items.forEach((item, i) => {
      const [x, y] = toCanvas(i);
      const r = item.new ? 4.5 : 3;
      ctx.globalAlpha = selected !== null && lay.groupOf[i] !== selected ? FADED : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = groupColor(lay.groupOf[i]);
      ctx.fill();
      ctx.lineWidth = item.new ? 1.5 : 0.8;
      ctx.strokeStyle = item.new ? '#16191f' : '#ffffff';
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // each cloud's number at its center, as in the table
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const g of badged(lay.groups, selected)) {
      const [x, y] = [g.center[0] * width, g.center[1] * HEIGHT];
      ctx.beginPath();
      ctx.arc(x, y, BADGE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = g.id === selected ? '#16191f' : 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.strokeStyle = groupColor(g.id);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = g.id === selected ? '#ffffff' : '#16191f';
      ctx.fillText(String(g.id + 1), x, y + 0.5);
    }
    if (hover !== null) {
      const [x, y] = toCanvas(hover);
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#16191f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }); // redraw on every render: cheap for at most 1,000 points

  // the pointer in the map's own px (the canvas is drawn at `width` × HEIGHT)
  const at = (e: RMouseEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * width, ((e.clientY - rect.top) / rect.height) * HEIGHT];
  };

  const tipCloud = hover !== null ? lay.groups[lay.groupOf[hover]] : null;
  const [tx, ty] = hover !== null ? toCanvas(hover) : [0, 0];
  const order = ranked(lay.groups, map.totals.new);
  const maxSize = Math.max(...lay.groups.map((g) => g.size), 1);
  return (
    <div className="ln-result">
      <p className="ln-headline">
        {map.n.toLocaleString()} garments worn in the brand&apos;s looks, {lay.groups.length} clouds
      </p>
      <p className="muted small">
        {(map.ms / 1000).toFixed(1)} s to read the vectors · {map.totals.new} from the new shoot, {map.totals.base} from the lookbook · {map.dim.toLocaleString()} numbers each
        {map.truncated ? ` · the first ${map.n.toLocaleString()} garments only` : ''}
        {map.unplaced ? ` · ${map.unplaced} worn garments have no vector yet, so they are not on the map` : ''}
      </p>
      <div className="trend-map ln-trends-map" ref={wrap}>
        <canvas
          ref={canvas}
          style={{ width: '100%', height: HEIGHT, cursor: hover !== null && !disabled ? 'pointer' : 'default' }}
          role="img"
          aria-label={`map of ${map.n} garments in ${lay.groups.length} clouds; pick a cloud by its number on the map, or in the table under the map`}
          onPointerMove={(e) => {
            const [x, y] = at(e);
            setHover(nearest(lay.xy, x, y, REACH, width, HEIGHT));
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            if (disabled) return;
            const [x, y] = at(e);
            const g = pickAt(lay, heat, x, y, width, HEIGHT, selected);
            if (g !== null) onSelect(g);
          }}
        />
        {badged(lay.groups, selected).map((g) => (
          <button
            key={g.id}
            type="button"
            className={`ln-trends-badge${g.id === selected ? ' active' : ''}`}
            style={{ left: g.center[0] * width, top: g.center[1] * HEIGHT }}
            aria-label={`Cloud ${g.id + 1}: ${g.size} garments, ${liftPhrase(g)}`}
            aria-pressed={g.id === selected}
            disabled={disabled}
            onClick={() => onSelect(g.id)}
          />
        ))}
        {tipCloud && hover !== null && (
          <div className="trend-tip" style={{ left: Math.min(tx + 12, width - 280), top: Math.min(ty + 12, HEIGHT - 110) }}>
            <b>
              Cloud {tipCloud.id + 1}: {tipCloud.label}
            </b>
            <div className="muted">
              {tipCloud.size} garments · {tipCloud.new} new shoot, {tipCloud.base} lookbook{map.totals.new ? ` · ${liftPhrase(tipCloud)}` : ''}
            </div>
            <div>
              {map.items[hover].name}
              {map.items[hover].category ? <span className="muted"> ({map.items[hover].category})</span> : null}
            </div>
          </div>
        )}
      </div>
      <p className="trend-legend muted">
        Each dot is a garment (ringed: from the new shoot), each colour a cloud
        {lay.groups.length > COLORED_CLOUDS ? `: the ${COLORED_CLOUDS} largest have a colour each, the smaller clouds are grey` : ''}. lift = the cloud&apos;s share of the new shoot over its share of
        the lookbook; above 1.5 emerging, around 1 established, below 1 fading. A cloud with no lookbook garment has no share to compare with: it says <i>new shoot only</i>.
      </p>
      {map.totals.new === 0 && (
        <Notice title="No new shoot in the graph yet">
          <p>Every garment comes from the lookbook, so no cloud can grow: the clouds are ranked by size. Ingest a few looks in tab 2, then draw the map again.</p>
        </Notice>
      )}
      <div className="ln-trends-clouds">
        <table className="metrics compact">
          <thead>
            <tr>
              <th>cloud</th>
              <th>its words</th>
              <th>garments</th>
              <th>new shoot</th>
              <th>{map.totals.new ? 'lift' : 'size'}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((g) => (
              <tr key={g.id} className={g.id === selected ? 'active' : ''} onClick={() => !disabled && onSelect(g.id)}>
                <td>
                  <span className="ln-trends-swatch" style={{ background: groupColor(g.id) }} /> {g.id + 1}
                </td>
                <td>{g.label}</td>
                <td>{g.size}</td>
                <td>{g.new}</td>
                <td>
                  <span className="ln-bar-cell">
                    <span className="ln-bar-track">
                      <span className={`ln-bar${map.totals.new && g.lift >= 1.5 ? ' ln-trends-emerging' : ''}`} style={{ width: `${(map.totals.new ? liftBar(g, lay.groups) : g.size / maxSize) * 100}%` }} />
                    </span>
                    <span>{map.totals.new ? liftText(g) : g.size}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
