// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BatchPreview } from './BatchPreview';
import type { BatchEntry } from './batchView';

const entries: BatchEntry[] = [
  { key: 'img:04.jpg', kind: 'photo', title: 'hoodie shorts white sneakers', file: '04.jpg' },
  { key: 'up:1', kind: 'your photo', title: 'mine.png', dataUrl: 'data:image/png;base64,AA' },
  { key: 'txt:04.md', kind: 'text', title: 'Weekend uniform', file: '04.md', label: 'social post', meta: 'AnyCompany Apparel · 2026-08-30' },
  { key: 'up:2', kind: 'your text', title: 'My note', meta: '1,200 chars' },
];

describe('BatchPreview', () => {
  it('shows every source of the batch under its heading, each with a button that leaves it out', () => {
    const html = renderToStaticMarkup(<BatchPreview heading="Your batch: 2 photos and 2 texts" ontologyId="fashion" entries={entries} thumbs={{ '04.jpg': 'data:image/jpeg;base64,BB' }} disabled={false} onRemove={() => {}} />);
    expect(html).toContain('Your batch: 2 photos and 2 texts');
    for (const e of entries) expect(html).toContain(`aria-label="leave out ${e.title}"`);
    expect(html).toContain('src="data:image/jpeg;base64,BB"');
    expect(html).toContain('src="data:image/png;base64,AA"');
    // an example text opens its preview inline; your own text has no file to preview
    expect(html.match(/Preview as article/g)).toHaveLength(1);
    expect(html).toContain('aria-controls="batch-article-preview"');
    expect(html).toContain('social post');
  });

  it('waits for a photo that is not loaded yet, and disables the buttons while a run goes', () => {
    const html = renderToStaticMarkup(<BatchPreview heading="Your batch: 1 photo" ontologyId="fashion" entries={entries.slice(0, 1)} thumbs={{}} disabled onRemove={() => {}} />);
    expect(html).toContain('loading…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="leave out hoodie shorts white sneakers"/);
  });
});
