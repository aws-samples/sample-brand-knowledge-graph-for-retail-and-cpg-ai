// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ArticleInfo, ExampleInfo } from '../../api';
import type { Upload } from './SourcePicker';

/** One selected source as step 2 of tab 2 shows it before the run. */
export type BatchEntry =
  | { key: string; kind: 'photo'; title: string; file: string }
  | { key: string; kind: 'text'; title: string; file: string; label: string; meta: string }
  | { key: string; kind: 'your photo'; title: string; dataUrl: string }
  | { key: string; kind: 'your text'; title: string; meta: string };

/**
 * The selected sources (keys `img:<file>`, `txt:<file>`, `up:<id>`) in the pickers' order: the
 * example photos, the example texts, then the uploads. `shown`: keys another picker already shows
 * (the new shoot's tiles), left out here. A key no list knows (a file gone after a domain change)
 * is skipped.
 */
export function batchEntries(selected: Set<string>, examples: ExampleInfo[], articles: ArticleInfo[], uploads: Upload[], shown: Set<string> = new Set()): BatchEntry[] {
  const want = (key: string) => selected.has(key) && !shown.has(key);
  const out: BatchEntry[] = [];
  for (const e of examples) {
    const key = `img:${e.file}`;
    if (want(key)) out.push({ key, kind: 'photo', title: e.title, file: e.file });
  }
  for (const a of articles) {
    const key = `txt:${a.file}`;
    if (want(key)) out.push({ key, kind: 'text', title: a.title, file: a.file, label: a.kind, meta: [a.source, a.published].filter(Boolean).join(' · ') });
  }
  for (const u of uploads) {
    if (!want(u.key)) continue;
    if (u.kind === 'image') out.push({ key: u.key, kind: 'your photo', title: u.name, dataUrl: u.dataUrl });
    else out.push({ key: u.key, kind: 'your text', title: u.title, meta: `${u.text.length.toLocaleString('en-US')} chars` });
  }
  return out;
}

/** "3 photos and 3 texts": what a batch holds, for the line above its tiles. */
export function batchSummary(entries: BatchEntry[]): string {
  const photos = entries.filter((e) => e.kind === 'photo' || e.kind === 'your photo').length;
  const texts = entries.length - photos;
  const part = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (!photos) return part(texts, 'text');
  if (!texts) return part(photos, 'photo');
  return `${part(photos, 'photo')} and ${part(texts, 'text')}`;
}
