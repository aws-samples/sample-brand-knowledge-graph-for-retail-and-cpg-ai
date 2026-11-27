// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeRun,
  clearRuns,
  MAX_STORED_CHARS,
  MAX_UPLOAD_CHARS,
  recallImage,
  rememberImage,
  resetStudioCache,
  runStore,
  saveRuns,
  setActiveRun,
  subscribe,
} from './studioCache';
import type { RequestInfo, RunState } from './types';

/**
 * Tab 1 keeps its classify results, the result shown and its image when another tab opens (the
 * page's memory) and across a reload (sessionStorage). `resetStudioCache` stands in for a reload:
 * the next call reads sessionStorage again.
 */

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

const request = { modelId: 'm', promptCaching: true } as unknown as RequestInfo;
const done = (finishedAt: number, padding = ''): RunState => ({ status: 'done', startedAt: finishedAt - 1000, finishedAt, request, result: { entities: [], padding } as never });

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('sessionStorage', storage);
  resetStudioCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('the classify results of tab 1', () => {
  it('outlive a switch to another tab and a reload, finished runs only', () => {
    runStore().set('fashion|abc|model-a|true', done(2000));
    runStore().set('fashion|abc|model-b|true', { status: 'running', startedAt: 1500, request });
    saveRuns();
    expect(runStore().size).toBe(2); // another mount of the tab in this page sees both
    resetStudioCache(); // a reload
    expect([...runStore().keys()]).toEqual(['fashion|abc|model-a|true']);
    expect(runStore().get('fashion|abc|model-a|true')?.status).toBe('done');
  });

  it('keep the newest runs that fit the storage budget', () => {
    const big = 'x'.repeat(Math.floor(MAX_STORED_CHARS / 2));
    runStore().set('old', done(1000, big));
    runStore().set('new', done(3000, big));
    runStore().set('newer', done(4000, 'small'));
    saveRuns();
    resetStudioCache();
    expect([...runStore().keys()].sort()).toEqual(['new', 'newer']);
  });

  it('remember the result shown, and Clear results forgets everything', () => {
    runStore().set('k', done(1000));
    saveRuns();
    setActiveRun('k');
    resetStudioCache();
    expect(activeRun()).toBe('k');
    clearRuns();
    expect(runStore().size).toBe(0);
    resetStudioCache();
    expect(runStore().size).toBe(0);
    expect(activeRun()).toBe('');
    expect(storage.length).toBe(0);
  });

  it('tell every mount when a run changes, until it unsubscribes', () => {
    const seen = vi.fn();
    const stop = subscribe(seen);
    saveRuns();
    stop();
    saveRuns();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stay in memory when sessionStorage is full', () => {
    storage.failWrites = true;
    runStore().set('k', done(1000));
    expect(() => saveRuns()).not.toThrow();
    expect(() => setActiveRun('k')).not.toThrow();
    expect(runStore().has('k')).toBe(true);
  });
});

describe('the image of tab 1', () => {
  it('is kept with its pixels in memory and by name in sessionStorage', () => {
    const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    rememberImage('fashion', { image: { kind: 'example', file: '01.jpg', title: 'trench', dataUrl, from: 'fashion' }, hash: 'h1' });
    expect(recallImage('fashion').memory?.hash).toBe('h1');
    expect(storage.getItem('studio.image.v1.fashion')).not.toContain(dataUrl);
    resetStudioCache();
    expect(recallImage('fashion')).toEqual({ memory: null, stored: { kind: 'example', file: '01.jpg', title: 'trench', from: 'fashion' } });
    expect(recallImage('other').stored).toBeNull();
  });

  it('stores an upload only while it is small', () => {
    const small = 'data:image/png;base64,' + 'B'.repeat(100);
    rememberImage('fashion', { image: { kind: 'upload', name: 'me.png', dataUrl: small }, hash: 'h2' });
    resetStudioCache();
    expect(recallImage('fashion').stored).toEqual({ kind: 'upload', name: 'me.png', dataUrl: small });
    const large = 'data:image/png;base64,' + 'C'.repeat(MAX_UPLOAD_CHARS);
    rememberImage('fashion', { image: { kind: 'upload', name: 'big.png', dataUrl: large }, hash: 'h3' });
    expect(recallImage('fashion').memory?.hash).toBe('h3'); // this page keeps it
    resetStudioCache();
    expect(recallImage('fashion').stored).toBeNull(); // a reload starts from the default photo
  });
});
