// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetKept, KEPT_PREFIX, keptValue, MAX_KEPT_CHARS, resetKept, setKept, syncKeptVersion, type Codec } from './kept';

// sessionStorage of one browser tab, kept across "reloads" (resetKept drops the page's memory)
let stored: Map<string, string>;
let full = false;
function fakeStorage() {
  return {
    get length() {
      return stored.size;
    },
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new DOMException('quota', 'QuotaExceededError');
      stored.set(k, v);
    },
    removeItem: (k: string) => void stored.delete(k),
  };
}
beforeEach(() => {
  stored = new Map();
  full = false;
  vi.stubGlobal('sessionStorage', fakeStorage());
  resetKept();
});
afterEach(() => vi.unstubAllGlobals());

const answer = { status: 'done', value: { answer: 'Pair them with wide-leg trousers [1].' } };

describe('kept values', () => {
  it('starts from the initial value and survives a tab switch (memory) and a reload (sessionStorage)', () => {
    expect(keptValue('rag.answer', { status: 'idle' })).toEqual({ status: 'idle' });
    setKept('rag.answer', answer);
    expect(keptValue('rag.answer', { status: 'idle' })).toBe(answer);
    expect(JSON.parse(stored.get(`${KEPT_PREFIX}rag.answer`)!)).toEqual(answer);
    resetKept(); // a reload
    expect(keptValue('rag.answer', { status: 'idle' })).toEqual(answer);
  });

  it('follows the initial value until something is set under the key', () => {
    expect(keptValue('catalog.text', 'white sneakers')).toBe('white sneakers');
    expect(keptValue('catalog.text', 'black blazer')).toBe('black blazer');
    expect(stored.size).toBe(0);
    setKept('catalog.text', 'loafers');
    expect(keptValue('catalog.text', 'black blazer')).toBe('loafers');
  });

  it('takes an updater, as useState does, also for a key no tab has read yet', () => {
    setKept<Record<string, number>>('counts', (m) => ({ ...m, a: 1 }));
    setKept<Record<string, number>>('counts', (m) => ({ ...m, b: 2 }));
    expect(keptValue('counts', {})).toEqual({ a: 1, b: 2 });
  });

  it('brings a request that was running at the reload back as idle, at any depth', () => {
    setKept('agent', { status: 'running', startedAt: 5, why: 'asked' });
    setKept('lens', { buyer: { status: 'running' }, merch: answer });
    resetKept();
    expect(keptValue('agent', null)).toEqual({ status: 'idle' });
    expect(keptValue('lens', {})).toEqual({ buyer: { status: 'idle' }, merch: answer });
  });

  it('keeps a running request in memory, so the tab shows it when it is open again', () => {
    setKept('agent', { status: 'running', startedAt: 5 });
    expect(keptValue('agent', null)).toEqual({ status: 'running', startedAt: 5 });
  });

  it('keeps a value too long for sessionStorage in memory only, and drops the older stored copy', () => {
    setKept('photo', 'data:image/png;base64,small');
    const big = `data:image/png;base64,${'A'.repeat(MAX_KEPT_CHARS)}`;
    setKept('photo', big);
    expect(keptValue('photo', null)).toBe(big);
    expect(stored.has(`${KEPT_PREFIX}photo`)).toBe(false);
    resetKept();
    expect(keptValue('photo', null)).toBeNull();
  });

  it('drops the older stored copy when sessionStorage is full', () => {
    setKept('answer', 'first');
    full = true;
    setKept('answer', 'second');
    expect(keptValue('answer', '')).toBe('second');
    resetKept();
    expect(keptValue('answer', '')).toBe('');
  });

  it('works in memory without sessionStorage', () => {
    vi.stubGlobal('sessionStorage', undefined);
    setKept('answer', 'in memory');
    expect(keptValue('answer', '')).toBe('in memory');
  });

  it('forgets a prefix in memory and in sessionStorage, and the next read starts from the latest initial value', () => {
    setKept('retriever.fashion.stage.rag', answer);
    setKept('retriever.fashion.question', 'What goes with a black blazer?');
    resetKept();
    setKept('retriever.fashion.stage.catalog.text', 'white sneakers');
    forgetKept('retriever.fashion.stage.');
    expect(keptValue('retriever.fashion.stage.catalog.text', 'black blazer')).toBe('black blazer');
    expect(keptValue('retriever.fashion.stage.rag', { status: 'idle' })).toEqual({ status: 'idle' });
    expect(keptValue('retriever.fashion.question', '')).toBe('What goes with a black blazer?');
    expect([...stored.keys()]).toEqual([`${KEPT_PREFIX}retriever.fashion.question`]);
  });

  it('drops a late write through a setter handed out before the key was forgotten', () => {
    const epoch = 0; // what useKept's setter was bound to when the request started
    setKept('retriever.fashion.stage.rag.answer', { status: 'running' }, undefined, epoch);
    forgetKept('retriever.fashion.stage.'); // a new question
    setKept('retriever.fashion.stage.rag.answer', answer, undefined, epoch); // the old question's answer lands
    expect(keptValue('retriever.fashion.stage.rag.answer', { status: 'idle' })).toEqual({ status: 'idle' });
    setKept('retriever.fashion.stage.rag.answer', answer, undefined, 1); // a setter from after the forget
    expect(keptValue('retriever.fashion.stage.rag.answer', { status: 'idle' })).toBe(answer);
  });

  it('forgets what was counted on an older graph, and nothing on the first sync of a page', () => {
    setKept('lens.fashion.explains', { 'new-season': answer });
    expect(syncKeptVersion('lens.', 0)).toBe(false);
    expect(keptValue('lens.fashion.explains', {})).toEqual({ 'new-season': answer });
    expect(syncKeptVersion('lens.', 1)).toBe(true);
    expect(keptValue('lens.fashion.explains', {})).toEqual({});
    expect(syncKeptVersion('lens.', 1)).toBe(false);
  });

  it('stores through a codec a value JSON cannot hold as it is', () => {
    const codec: Codec<Float32Array> = { save: (v) => Array.from(v), load: (s) => Float32Array.from(s as number[]) };
    setKept('xy', new Float32Array([0.25, 0.5]), codec);
    resetKept();
    const back = keptValue('xy', new Float32Array(), codec);
    expect(back).toBeInstanceOf(Float32Array);
    expect(Array.from(back)).toEqual([0.25, 0.5]);
  });
});
