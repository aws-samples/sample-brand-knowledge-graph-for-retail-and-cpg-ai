// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { RunRecord, RunStatus, RunSummary, SourceSpec } from '../../api';

/**
 * Pure helpers that turn a run's status document into what the tab shows: one row per source
 * (with or without a record yet), progress, the graph delta and the ids a row wrote.
 */

type RowStatus = 'pending' | 'classified' | 'ingested' | 'error';
export type SourceRow = {
  index: number;
  kind: 'image' | 'text';
  label: string;
  status: RowStatus;
  record?: RunRecord;
  error?: string;
};

/** Display name of a source before its record exists (the record carries the resolved label). */
export function sourceLabel(spec: SourceSpec): string {
  return spec.label || spec.title || spec.example || spec.key?.split('/').pop() || `source ${spec.index + 1}`;
}

/** One row per source, in order: the record when the steps wrote one, else the summary's result
 * (a failure the state machine recorded without a record), else pending. */
export function rowsOf(status: RunStatus | null): SourceRow[] {
  if (!status) return [];
  const records = new Map(status.records.map((r) => [r.index, r]));
  const results = new Map((status.summary?.results ?? []).map((r) => [r.index, r]));
  return status.run.sources.map((spec) => {
    const record = records.get(spec.index);
    if (record) {
      return { index: spec.index, kind: spec.kind, label: record.label || sourceLabel(spec), status: record.status, record, error: record.error };
    }
    const result = results.get(spec.index);
    if (result && result.status === 'error') {
      return { index: spec.index, kind: spec.kind, label: result.label || sourceLabel(spec), status: 'error', error: result.error };
    }
    return { index: spec.index, kind: spec.kind, label: sourceLabel(spec), status: 'pending' };
  });
}

export type Progress = { total: number; done: number; failed: number; pct: number; finished: boolean; running: boolean };

export function progressOf(status: RunStatus | null): Progress {
  if (!status) return { total: 0, done: 0, failed: 0, pct: 0, finished: false, running: false };
  const rows = rowsOf(status);
  const done = rows.filter((r) => r.status === 'ingested' || r.status === 'error').length;
  const failed = rows.filter((r) => r.status === 'error').length;
  const running = status.status === 'RUNNING';
  const finished = !running && status.status !== 'UNKNOWN';
  const total = rows.length;
  // the summary step counts as the last slice of the bar
  const pct = total ? Math.min(100, Math.round(((done + (status.summary ? 1 : 0)) / (total + 1)) * 100)) : 0;
  return { total, done, failed, pct, finished, running };
}

export type DeltaRow = { label: string; before: number; after: number; delta: number };

/** Node counts by label before and after the run, largest additions first. */
export function deltaRows(before: Record<string, number> | null | undefined, after: Record<string, number> | null | undefined): DeltaRow[] {
  const labels = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(labels)
    .map((label) => {
      const b = before?.[label] ?? 0;
      const a = after?.[label] ?? 0;
      return { label, before: b, after: a, delta: a - b };
    })
    .sort((x, y) => y.delta - x.delta || x.label.localeCompare(y.label));
}

/** Every node id a row wrote: its items and its look / article / statement. */
export function writtenIds(row: SourceRow | undefined): Set<string> {
  const ing = row?.record?.ingest;
  if (!ing) return new Set();
  return new Set([...ing.items.map((i) => i.id), ...[ing.look, ing.article, ing.statement].filter((x): x is string => !!x)]);
}

/** The items of a run that reference a shared vocabulary node (category, value or component),
 * plus the node itself: what lights up in the graph when a "shared" entry is clicked. */
export function referencingIds(status: RunStatus | null, sharedId: string): Set<string> {
  const out = new Set<string>([sharedId]);
  for (const rec of status?.records ?? []) {
    for (const it of rec.ingest?.items ?? []) {
      const refs = [`category:${it.category}`, ...Object.values(it.attributes).map((v) => `attribute:${v}`), ...it.parts.map((p) => `category:${p}`)];
      if (refs.includes(sharedId)) out.add(it.id);
    }
  }
  return out;
}

/** "1 m 12 s" between two ISO timestamps (or until now while the run is going). */
export function elapsedLabel(startedAt: string | undefined, stoppedAt: string | undefined, now = Date.now()): string {
  if (!startedAt) return 'n/a';
  const start = Date.parse(startedAt);
  const stop = stoppedAt ? Date.parse(stoppedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return 'n/a';
  const s = Math.max(0, Math.round((stop - start) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`;
}

/** Sum of the per-source token counters (falls back to the records while the summary is pending). */
export function tokenTotals(status: RunStatus | null): { input: number; cacheRead: number; cacheWrite: number; output: number; calls: number } {
  const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 };
  for (const rec of status?.records ?? []) {
    const m = rec.result?.metrics;
    if (!m) continue;
    t.calls += 1;
    t.input += m.input_tokens;
    t.cacheRead += m.cache_read_tokens;
    t.cacheWrite += m.cache_write_tokens;
    t.output += m.output_tokens;
  }
  return t;
}

/** The text of a text source as it was sent to the model, without the `<source_text>` tags the
 * request wraps it in. With a guardrail the text sits in a `guardContent` block between two text
 * blocks that hold the tags (backend guardrail.py), so the user turn's blocks are joined first.
 * Runs from before the tags have none: their first block is the text. */
export function sourceText(record: RunRecord | undefined): string {
  const content = record?.result?.prompt?.request?.messages?.[0]?.content;
  if (!Array.isArray(content)) return '';
  const textOf = (block: { text?: unknown; guardContent?: { text?: { text?: unknown } } }): string => {
    if (typeof block?.text === 'string') return block.text;
    const guarded = block?.guardContent?.text?.text;
    return typeof guarded === 'string' ? guarded : '';
  };
  const tagged = /<source_text>\n([\s\S]*?)\n<\/source_text>/.exec(content.map(textOf).join(''));
  return tagged ? tagged[1] : textOf(content[0]);
}

export function summaryHeadline(summary: RunSummary): string {
  const a = summary.added;
  const bits = [`${a.items} item${a.items === 1 ? '' : 's'}`];
  if (a.looks) bits.push(`${a.looks} look${a.looks === 1 ? '' : 's'}`);
  if (a.articles) bits.push(`${a.articles} article${a.articles === 1 ? '' : 's'} (${a.statements} statement${a.statements === 1 ? '' : 's'})`);
  return bits.join(', ');
}
