// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useSyncExternalStore } from 'react';

/**
 * What a tab keeps when another tab opens. App unmounts a tab on every switch, so an answer from
 * a model or an agent lived only as long as its tab was shown. `useKept` is `useState` whose value
 * lives once per page (memory) and in the browser tab's sessionStorage under `kept.<key>`, so a
 * visit to another tab, or a reload, finds it again. Running a step again replaces it.
 *
 * A request still running when its tab closes writes its answer here when it lands, and the tab
 * shows it once it is open again. After a reload that request is gone: a kept
 * `{ status: 'running' }`, at any depth, comes back as `{ status: 'idle' }`. A value longer than
 * `MAX_KEPT_CHARS` once stored (a large uploaded photo) stays in memory only. Sign-out removes
 * every kept value (auth.ts). Tab 1 (studioCache) and tab 6's agent methods (trendsCache) have
 * their own stores.
 */
export const KEPT_PREFIX = 'kept.';
/** Characters of one value kept in sessionStorage (its quota is about 5 MB per origin). */
export const MAX_KEPT_CHARS = 750_000;

/** How a value that does not survive JSON as it is (a Float32Array) is stored and read back. */
export type Codec<T> = { save: (value: T) => unknown; load: (stored: unknown) => T };
type Next<T> = T | ((prev: T) => T);

type Store = {
  values: Map<string, unknown>;
  initials: Map<string, unknown>;
  listeners: Map<string, Set<() => void>>;
  versions: Map<string, number>;
  /** bumped when a key is forgotten: a setter handed out before (a request still running) no longer writes */
  epochs: Map<string, number>;
};
let store: Store | null = null;

function load(): Store {
  store ??= { values: new Map(), initials: new Map(), listeners: new Map(), versions: new Map(), epochs: new Map() };
  return store;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage disabled (some private modes, sandboxed frames)
  }
}

/** A request that was running when the page closed did not survive it. */
const idleIfRunning = (_key: string, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) && (v as { status?: unknown }).status === 'running' ? { status: 'idle' } : v);

function readStored<T>(key: string, codec?: Codec<T>): { value: T } | null {
  try {
    const raw = storage()?.getItem(KEPT_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw, idleIfRunning);
    return { value: codec ? codec.load(parsed) : (parsed as T) };
  } catch {
    return null; // unreadable: start from the initial value
  }
}

function writeStored<T>(key: string, value: T, codec?: Codec<T>): void {
  const s = storage();
  if (!s) return;
  try {
    const raw = JSON.stringify(codec ? codec.save(value) : value);
    if (raw.length > MAX_KEPT_CHARS) s.removeItem(KEPT_PREFIX + key);
    else s.setItem(KEPT_PREFIX + key, raw);
  } catch {
    // over quota: memory keeps it for this page, and an older copy must not come back after a reload
    try {
      s.removeItem(KEPT_PREFIX + key);
    } catch {
      /* nothing kept */
    }
  }
}

function notify(key: string): void {
  for (const fn of load().listeners.get(key) ?? []) fn();
}

/**
 * The kept value under `key`: in memory, else from sessionStorage, else `initial`. The initial
 * value is not stored, so a key nothing was set under follows it (stage 1's search box follows the
 * question until you type in it). It must be a primitive or a constant: React compares snapshots
 * by reference.
 */
export function keptValue<T>(key: string, initial: T, codec?: Codec<T>): T {
  const s = load();
  s.initials.set(key, initial);
  if (!s.values.has(key)) {
    const stored = readStored(key, codec);
    if (!stored) return initial;
    s.values.set(key, stored.value);
  }
  return s.values.get(key) as T;
}

/**
 * Set the value under `key`, from any component or from a request that outlived its tab. With
 * `epoch` (useKept's setter), a write that comes after the key was forgotten is dropped: the answer
 * to an old question does not land in the new one's stage.
 */
export function setKept<T>(key: string, next: Next<T>, codec?: Codec<T>, epoch?: number): void {
  const s = load();
  if (epoch !== undefined && epoch !== (s.epochs.get(key) ?? 0)) return;
  const prev = keptValue(key, s.initials.get(key) as T, codec); // reads a stored value into memory
  const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
  if (s.values.has(key) && Object.is(value, prev)) return;
  s.values.set(key, value);
  writeStored(key, value, codec);
  notify(key);
}

/** Forget every value whose key starts with `prefix` (memory and sessionStorage): its tab starts that part over. */
export function forgetKept(prefix: string): void {
  const s = load();
  const keys = new Set([...s.values.keys(), ...s.initials.keys(), ...s.listeners.keys()].filter((k) => k.startsWith(prefix)));
  const st = storage();
  try {
    const names: string[] = [];
    for (let i = 0; st && i < st.length; i++) names.push(st.key(i) ?? '');
    for (const name of names) if (name.startsWith(KEPT_PREFIX + prefix)) st?.removeItem(name);
  } catch {
    /* storage disabled */
  }
  for (const k of keys) {
    s.values.delete(k);
    s.epochs.set(k, (s.epochs.get(k) ?? 0) + 1);
  }
  for (const k of keys) notify(k);
}

/**
 * The graph's version as App counts it (0 on every page load, bumped when a tab 2 run finishes).
 * A version other than the last one seen under `prefix` means the graph changed: its kept values
 * are counted on an older graph and are forgotten. Returns whether it forgot. The rule of
 * trendsCache.syncDataVersion.
 */
export function syncKeptVersion(prefix: string, version: number): boolean {
  const s = load();
  if ((s.versions.get(prefix) ?? 0) === version) return false;
  s.versions.set(prefix, version);
  forgetKept(prefix);
  return true;
}

function listen(key: string, fn: () => void): () => void {
  const s = load();
  const set = s.listeners.get(key) ?? new Set();
  set.add(fn);
  s.listeners.set(key, set);
  return () => {
    set.delete(fn);
    if (!set.size) s.listeners.delete(key);
  };
}

/** `useState` kept across tab switches and reloads under `key`; `codec` for a value JSON cannot hold as it is. */
export function useKept<T>(key: string, initial: T, codec?: Codec<T>): [T, (next: Next<T>) => void] {
  const subscribe = useCallback((fn: () => void) => listen(key, fn), [key]);
  const get = () => keptValue(key, initial, codec);
  const value = useSyncExternalStore(subscribe, get, get);
  const epoch = load().epochs.get(key) ?? 0;
  const set = useCallback((next: Next<T>) => setKept(key, next, codec, epoch), [key, codec, epoch]);
  return [value, set];
}

/** Tests: drop the page's memory so the next read goes to sessionStorage again (a reload). */
export function resetKept(): void {
  store = null;
}
