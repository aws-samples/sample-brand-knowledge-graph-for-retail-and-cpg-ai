// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { RunStatus } from '../../api';
import fixture from './__fixtures__/run.status.json';
import { deltaRows, elapsedLabel, progressOf, referencingIds, rowsOf, sourceLabel, sourceText, summaryHeadline, tokenTotals, writtenIds } from './runView';

const status = fixture as unknown as RunStatus;

describe('rowsOf', () => {
  it('gives one row per source in order, with the record when there is one', () => {
    const rows = rowsOf(status);
    expect(rows.map((r) => [r.index, r.kind, r.status])).toEqual([
      [0, 'image', 'ingested'],
      [1, 'text', 'ingested'],
      [2, 'text', 'ingested'],
    ]);
    expect(rows[0].label).toBe('trench coat jeans');
    expect(rows[1].label).toBe('Three ways to wear the trench this autumn');
    expect(rows[2].label).toBe('Cold snap');
  });

  it('shows pending sources and failures the state machine recorded without a record', () => {
    const partial: RunStatus = {
      ...status,
      status: 'RUNNING',
      records: status.records.slice(0, 1),
      summary: null,
    };
    expect(rowsOf(partial).map((r) => r.status)).toEqual(['ingested', 'pending', 'pending']);
    const failed: RunStatus = {
      ...status,
      records: status.records.slice(0, 1),
      summary: { ...status.summary!, results: [{ index: 2, kind: 'text', label: 'Cold snap', status: 'error', error: 'AccessDeniedException: no model access' }] },
    };
    const rows = rowsOf(failed);
    expect(rows[2]).toMatchObject({ status: 'error', error: 'AccessDeniedException: no model access' });
    expect(rows[1].status).toBe('pending');
  });

  it('labels a source before its record exists', () => {
    expect(sourceLabel({ index: 0, kind: 'image', example: '01-trench-coat-sweater-dress.jpg' })).toBe('01-trench-coat-sweater-dress.jpg');
    expect(sourceLabel({ index: 3, kind: 'image', key: 'uploads/run-x/03.png', label: 'my photo' })).toBe('my photo');
    expect(sourceLabel({ index: 4, kind: 'text', key: 'uploads/run-x/04.txt', title: 'Cold snap' })).toBe('Cold snap');
    expect(sourceLabel({ index: 5, kind: 'text', key: 'uploads/run-x/05.txt' })).toBe('05.txt');
    expect(sourceLabel({ index: 6, kind: 'text' })).toBe('source 7');
  });
});

describe('progressOf', () => {
  it('counts finished sources and leaves the last slice of the bar for the summary', () => {
    expect(progressOf(null)).toEqual({ total: 0, done: 0, failed: 0, pct: 0, finished: false, running: false });
    expect(progressOf(status)).toEqual({ total: 3, done: 3, failed: 0, pct: 100, finished: true, running: false });
    const running: RunStatus = { ...status, status: 'RUNNING', records: status.records.slice(0, 2), summary: null };
    expect(progressOf(running)).toEqual({ total: 3, done: 2, failed: 0, pct: 50, finished: false, running: true });
  });
});

describe('graph delta and highlights', () => {
  it('lists node counts before and after, biggest additions first', () => {
    const rows = deltaRows(status.summary!.graph.before, status.summary!.graph.after);
    expect(rows[0]).toEqual({ label: 'Item', before: 54, after: 63, delta: 9 });
    expect(rows.find((r) => r.label === 'Article')).toEqual({ label: 'Article', before: 5, after: 7, delta: 2 });
    expect(rows.find((r) => r.label === 'Category')?.delta).toBe(0);
    expect(deltaRows(null, { Item: 2 })).toEqual([{ label: 'Item', before: 0, after: 2, delta: 2 }]);
  });

  it('collects the ids a source wrote: its items and its look / article / statement', () => {
    const rows = rowsOf(status);
    const photo = writtenIds(rows[0]);
    expect(photo.size).toBe(4);
    expect(Array.from(photo).some((id) => id.startsWith('look:'))).toBe(true);
    const text = writtenIds(rows[2]);
    expect(Array.from(text).filter((id) => id.startsWith('article:') || id.startsWith('st:')).length).toBe(2);
    expect(writtenIds(undefined).size).toBe(0);
  });

  it('finds the items of the run that reference a shared vocabulary node', () => {
    const shared = status.summary!.shared[0];
    expect(shared.label).toBe('Category');
    const ids = referencingIds(status, shared.id);
    expect(ids.has(shared.id)).toBe(true);
    expect(ids.size).toBe(1 + shared.items);
    expect(referencingIds(status, 'category:nothing-like-this').size).toBe(1);
  });
});

describe('small formatters', () => {
  it('formats elapsed time and token totals', () => {
    expect(elapsedLabel('2026-09-30T12:00:00+00:00', '2026-09-30T12:01:12+00:00')).toBe('1 m 12 s');
    expect(elapsedLabel('2026-09-30T12:00:00+00:00', undefined, Date.parse('2026-09-30T12:00:07+00:00'))).toBe('7 s');
    expect(elapsedLabel(undefined, undefined)).toBe('n/a');
    const t = tokenTotals(status);
    expect(t.calls).toBe(3);
    expect(t.cacheRead).toBe(status.summary!.tokens.cache_read_tokens);
    expect(t.output).toBe(360);
  });

  it('recovers the text of a text source from the request preview and words the headline', () => {
    expect(sourceText(status.records[2])).toMatch(/^Quilted puffer jacket/);
    expect(sourceText(status.records[2])).not.toContain('source_text');
    expect(sourceText(status.records[0])).toBe('');
    // a run recorded before the request wrapped the text in <source_text> tags
    const untagged = { result: { prompt: { request: { messages: [{ content: [{ text: 'Plain notes' }] }] } } } };
    expect(sourceText(untagged as unknown as RunStatus['records'][number])).toBe('Plain notes');
    // with a guardrail the text is a guardContent block between the tags (tab 2 showed only
    // "<source_text>" for every text source of a deployed stack, 13 Nov 2026)
    const guarded = {
      result: {
        prompt: {
          request: {
            messages: [
              {
                content: [
                  { text: '<source_text>\n' },
                  { guardContent: { text: { text: 'An ivory shirt.\n\nWhite sneakers.' } } },
                  { text: '\n</source_text>' },
                  { text: 'The text inside <source_text> above describes an outfit.' },
                ],
              },
            ],
          },
        },
      },
    };
    expect(sourceText(guarded as unknown as RunStatus['records'][number])).toBe('An ivory shirt.\n\nWhite sneakers.');
    expect(summaryHeadline(status.summary!)).toBe('9 items, 1 look, 2 articles (2 statements)');
  });
});
