// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ExampleInfo, GraphCounts } from '../../api';
import { countRows, GraphCountsView } from './GraphCountsView';
import { ShootPicker } from './ShootPicker';
import { occasionLabel } from './useSources';

const BEFORE: GraphCounts = {
  looks: 101,
  garments: 760,
  occasions: [
    { name: 'Professional', looks: 40 },
    { name: 'Dress', looks: 30 },
  ],
  watch: { text: 'white sneakers', label: 'white sneaker', looks: 13 },
};
const AFTER: GraphCounts = {
  looks: 111,
  garments: 838,
  occasions: [
    { name: 'Professional', looks: 43 },
    { name: 'Dress', looks: 33 },
    { name: 'Business casual', looks: 4 },
  ],
  watch: { text: 'white sneakers', label: 'white sneaker', looks: 16 },
};

describe("tab 2's counts", () => {
  it('lists the totals, the occasions and the watched garment last', () => {
    const rows = countRows(BEFORE);
    expect(rows.map((r) => r.label)).toEqual(['Looks', 'Garments in them', 'Professional looks', 'Dress looks', 'Looks with white sneakers']);
    expect(rows[rows.length - 1]).toMatchObject({ now: 13, watch: true });
  });

  it('compares with the counts from before the run, a new occasion from zero', () => {
    const rows = countRows(AFTER, BEFORE);
    expect(rows.find((r) => r.label === 'Looks')).toMatchObject({ before: 101, now: 111 });
    expect(rows.find((r) => r.label === 'Business casual looks')).toMatchObject({ before: 0, now: 4 });
    const html = renderToStaticMarkup(<GraphCountsView now={AFTER} before={BEFORE} />);
    expect(html).toContain('<b>16</b>');
    expect(html).toContain('+3');
  });

  it('shows each look of the shoot with its occasion, and how many are selected', () => {
    const shoot = [
      { file: 'a.jpg', title: 'white sneakers, black tote', occasion: 'business_casual', batch: 'new-shoot' },
      { file: 'b.jpg', title: 'navy pea coat', occasion: 'dress', batch: 'new-shoot' },
    ] as ExampleInfo[];
    const html = renderToStaticMarkup(<ShootPicker shoot={shoot} thumbs={{}} selected={new Set(['img:a.jpg'])} disabled={false} onToggle={() => {}} onSelectAll={() => {}} />);
    expect(html).toContain('1 of 2 looks selected');
    expect(html).toContain('Business casual');
    expect(html).toContain('aria-pressed="true"');
    expect(occasionLabel('business_casual')).toBe('Business casual');
  });
});
