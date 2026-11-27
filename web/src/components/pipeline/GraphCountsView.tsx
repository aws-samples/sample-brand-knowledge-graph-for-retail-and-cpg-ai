// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { GraphCounts } from '../../api';

type Row = { label: string; now: number; before?: number; watch?: boolean };

/** The rows tab 2 compares: looks, garments, looks per occasion, and the looks with the watched garment. */
export function countRows(now: GraphCounts, before?: GraphCounts | null): Row[] {
  const rows: Row[] = [
    { label: 'Looks', now: now.looks, before: before?.looks },
    { label: 'Garments in them', now: now.garments, before: before?.garments },
    ...now.occasions.map((o) => ({ label: `${o.name} looks`, now: o.looks, before: before?.occasions.find((b) => b.name === o.name)?.looks ?? (before ? 0 : undefined) })),
  ];
  if (now.watch) rows.push({ label: `Looks with ${now.watch.text}`, now: now.watch.looks, before: before?.watch?.looks, watch: true });
  return rows;
}

/**
 * Tab 2's counts: what the graph holds (step 1), or, with `before`, what the batch changed
 * (step 4: "101 → 111"). The looks with the watched garment are the number to remember.
 */
export function GraphCountsView({ now, before = null }: { now: GraphCounts; before?: GraphCounts | null }) {
  return (
    <dl className="counts">
      {countRows(now, before).map((r) => {
        const moved = r.before !== undefined && r.before !== r.now;
        return (
          <div key={r.label} className={`count${r.watch ? ' watch' : ''}${moved ? ' moved' : ''}`}>
            <dt>{r.label}</dt>
            <dd>
              {r.before !== undefined ? (
                <>
                  <span className="muted">{r.before.toLocaleString()}</span> → <b>{r.now.toLocaleString()}</b>
                  {moved && <span className="count-delta"> {r.now > r.before! ? '+' : ''}{(r.now - r.before!).toLocaleString()}</span>}
                </>
              ) : (
                <b>{r.now.toLocaleString()}</b>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
