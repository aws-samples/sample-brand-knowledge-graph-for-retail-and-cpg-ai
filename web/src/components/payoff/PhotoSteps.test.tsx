// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GraphColumn, PhotoWayIn } from '../../api';
import { PhotoSteps } from './PhotoSteps';

/** GraphRAG from a photo (payoff.photo_graphrag): the steps say the photo went into the same search. */
const way: PhotoWayIn = {
  garments: 25,
  label: 'white sneaker',
  nearest: 'white sneaker',
  looks: 13,
  band: 0.1,
  query: 'CALL neptune.algo.vectors.topK.byEmbedding(…)',
  vector: { dimension: 1024, first: [0.01, -0.02], norm: 1 },
  find: '',
  find_inspect: { system: 's', user: 'Question: What goes with this?', reply: '{"find": ""}' },
};
const column = (extra: Partial<GraphColumn>) => ({ photo_way_in: way, notes: [], target: null, ...extra }) as unknown as GraphColumn;

describe('PhotoSteps', () => {
  it('shows the photo, the same vector search and the looks it found', () => {
    const html = renderToStaticMarkup(<PhotoSteps graph={column({})} photo="data:image/jpeg;base64,AAAA" />);
    expect(html).toContain('Your photo, embedded');
    expect(html).toContain('1,024 numbers');
    expect(html).toContain('25 garments within 0.1 of the closest, “white sneaker”');
    expect(html).toContain('13 looks with garments like it');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).toContain(way.query);
    expect(html).not.toContain('Looking for');
  });

  it('shows the filter when the question asks for one kind of piece', () => {
    const graph = column({
      photo_way_in: { ...way, find: 'shoes' },
      target: { find: 'shoes', looks_before: 13, looks_after: 9, dropped: [] },
    });
    const html = renderToStaticMarkup(<PhotoSteps graph={graph} photo={null} />);
    expect(html).toContain('Looking for: <b>shoes</b>');
    expect(html).toContain('Keeping only the ones with shoes: <b>9</b>');
    expect(html).toContain('reading the question');
  });

  it('renders nothing without a photo way in', () => {
    expect(renderToStaticMarkup(<PhotoSteps graph={column({ photo_way_in: undefined })} photo={null} />)).toBe('');
  });
});
