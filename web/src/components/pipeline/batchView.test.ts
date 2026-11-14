// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { ArticleInfo, ExampleInfo } from '../../api';
import { batchEntries, batchSummary } from './batchView';
import type { Upload } from './SourcePicker';
import { FIRST, SHOOT, defaultBatch } from './useSources';

const photo = (file: string, batch?: string): ExampleInfo => ({ file, title: file.replace(/\.jpg$/, ''), bytes: 1, content_type: 'image/jpeg', prompt: '', model_id: '', ...(batch ? { batch } : {}) });
const text = (file: string, pairs = '', batch?: string): ArticleInfo => ({
  file,
  title: `title of ${file}`,
  kind: 'social post',
  source: 'Velloway',
  published: '2026-09-01',
  chars: 900,
  pairs_with_image: pairs,
  ...(batch ? { batch } : {}),
});

describe('defaultBatch', () => {
  it('starts with the new shoot when the domain has one', () => {
    const d = { examples_list: [photo('a.jpg', SHOOT), photo('b.jpg', FIRST), photo('c.jpg', SHOOT)], articles_list: [text('t.md', 'b.jpg', FIRST)] };
    expect([...defaultBatch(d)]).toEqual(['img:a.jpg', 'img:c.jpg']);
  });

  it('else with the photos and texts the manifests mark as the first batch', () => {
    const d = { examples_list: [photo('a.jpg'), photo('b.jpg', FIRST)], articles_list: [text('s.md', 'a.jpg'), text('t.md', 'b.jpg', FIRST)] };
    expect([...defaultBatch(d)]).toEqual(['img:b.jpg', 'txt:t.md']);
  });

  it('else with three texts and the photos they describe', () => {
    const d = { examples_list: [photo('a.jpg'), photo('b.jpg')], articles_list: [text('1.md', 'a.jpg'), text('2.md'), text('3.md', 'b.jpg'), text('4.md', 'b.jpg')] };
    expect([...defaultBatch(d)].sort()).toEqual(['img:a.jpg', 'img:b.jpg', 'txt:1.md', 'txt:2.md', 'txt:3.md']);
  });

  it('else with three photos, never the new work of tab 6', () => {
    const d = { examples_list: [photo('n.jpg', 'new-work'), photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')], articles_list: [] };
    expect([...defaultBatch(d)]).toEqual(['img:a.jpg', 'img:b.jpg', 'img:c.jpg']);
  });
});

describe('batchEntries', () => {
  const examples = [photo('a.jpg', SHOOT), photo('b.jpg')];
  const articles = [text('t.md', 'b.jpg')];
  const uploads: Upload[] = [
    { key: 'up:1', kind: 'image', name: 'mine.png', dataUrl: 'data:image/png;base64,AA', bytes: 10 },
    { key: 'up:2', kind: 'text', title: 'My note', text: 'x'.repeat(1200), bytes: 1200 },
  ];

  it('lists what is selected in the pickers order, photos, texts, then uploads', () => {
    const selected = new Set(['up:2', 'txt:t.md', 'img:b.jpg', 'img:a.jpg', 'up:1']);
    const entries = batchEntries(selected, examples, articles, uploads);
    expect(entries.map((e) => [e.key, e.kind])).toEqual([
      ['img:a.jpg', 'photo'],
      ['img:b.jpg', 'photo'],
      ['txt:t.md', 'text'],
      ['up:1', 'your photo'],
      ['up:2', 'your text'],
    ]);
    expect(entries[2]).toMatchObject({ label: 'social post', meta: 'Velloway · 2026-09-01' });
    expect(entries[4]).toMatchObject({ title: 'My note', meta: '1,200 chars' });
  });

  it('leaves out what another picker shows and keys no list knows', () => {
    const entries = batchEntries(new Set(['img:a.jpg', 'img:b.jpg', 'img:gone.jpg']), examples, articles, uploads, new Set(['img:a.jpg']));
    expect(entries.map((e) => e.key)).toEqual(['img:b.jpg']);
  });
});

describe('batchSummary', () => {
  it('counts photos and texts in words', () => {
    const entries = batchEntries(new Set(['img:a.jpg', 'img:b.jpg', 'txt:t.md']), [photo('a.jpg'), photo('b.jpg')], [text('t.md')], []);
    expect(batchSummary(entries)).toBe('2 photos and 1 text');
    expect(batchSummary(entries.slice(0, 1))).toBe('1 photo');
    expect(batchSummary(entries.slice(2))).toBe('1 text');
  });
});
