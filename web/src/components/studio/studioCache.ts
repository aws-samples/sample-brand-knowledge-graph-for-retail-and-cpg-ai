// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { RunState } from './types';

/**
 * What tab 1 keeps when another tab opens: App unmounts a tab on every switch, so the classify
 * results, the result on the image and the image lived only as long as the tab was shown. They
 * live here instead, once per page (memory), and in the browser tab's sessionStorage, so a reload
 * of the page, or of a slide deck's frame that embeds tab 1, finds them again. sessionStorage
 * holds the finished runs (newest first, up to `MAX_STORED_CHARS`), the key of the result shown
 * and, per domain, the image: an example photo by name (it is fetched again), an upload as its
 * data URL only up to `MAX_UPLOAD_CHARS`. A run still in flight when the tab closes lands in
 * memory and is stored when it finishes; listeners (`subscribe`) re-render the tab that shows it.
 * "Clear results" empties both.
 */

const RUNS_KEY = 'studio.runs.v1';
const ACTIVE_KEY = 'studio.active.v1';
const IMAGE_KEY = 'studio.image.v1.';
/** Characters of finished runs kept in sessionStorage (its quota is about 5 MB per origin). */
export const MAX_STORED_CHARS = 1_500_000;
/** Largest upload (data URL characters) kept in sessionStorage; bigger ones stay in memory. */
export const MAX_UPLOAD_CHARS = 1_000_000;

export type StoredImage =
  | { kind: 'example'; file: string; title: string; from: string }
  | { kind: 'upload'; name: string; dataUrl: string };
export type RememberedImage = { image: { kind: 'example'; file: string; title: string; dataUrl: string; from: string } | { kind: 'upload'; name: string; dataUrl: string }; hash: string };

type Store = { runs: Map<string, RunState>; active: string; images: Map<string, RememberedImage>; listeners: Set<() => void> };
let store: Store | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage disabled (some private modes, sandboxed frames)
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // over quota: memory keeps everything for this page, the next reload starts without it
  }
}

function load(): Store {
  if (store) return store;
  const runs = new Map<string, RunState>();
  for (const [key, state] of read<[string, RunState][]>(RUNS_KEY) ?? []) if (state?.status === 'done') runs.set(key, state);
  store = { runs, active: read<string>(ACTIVE_KEY) ?? '', images: new Map(), listeners: new Set() };
  return store;
}

/** The runs of tab 1, shared by every mount of it in this page. */
export function runStore(): Map<string, RunState> {
  return load().runs;
}

/** Store the finished runs, newest first, as many as fit in `MAX_STORED_CHARS`; tell the listeners. */
export function saveRuns(): void {
  const s = load();
  const done = [...s.runs.entries()].filter(([, r]) => r.status === 'done').sort((a, b) => (b[1] as { finishedAt: number }).finishedAt - (a[1] as { finishedAt: number }).finishedAt);
  const kept: [string, RunState][] = [];
  let size = 2;
  for (const entry of done) {
    const n = JSON.stringify(entry).length + 1;
    if (size + n > MAX_STORED_CHARS) continue;
    kept.push(entry);
    size += n;
  }
  write(RUNS_KEY, kept);
  for (const fn of s.listeners) fn();
}

/** Forget every run (memory and sessionStorage). */
export function clearRuns(): void {
  const s = load();
  s.runs.clear();
  s.active = '';
  write(RUNS_KEY, null);
  write(ACTIVE_KEY, null);
  for (const fn of s.listeners) fn();
}

export function activeRun(): string {
  return load().active;
}

export function setActiveRun(key: string): void {
  const s = load();
  s.active = key;
  write(ACTIVE_KEY, key || null);
}

/** Called whenever a run changes state, by any mount of the tab. Returns the unsubscribe. */
export function subscribe(fn: () => void): () => void {
  const s = load();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

/** The image tab 1 last showed for `domain`: in memory (with its pixels), or what sessionStorage names. */
export function recallImage(domain: string): { memory: RememberedImage | null; stored: StoredImage | null } {
  const memory = load().images.get(domain) ?? null;
  return { memory, stored: memory ? null : read<StoredImage>(IMAGE_KEY + domain) };
}

export function rememberImage(domain: string, remembered: RememberedImage): void {
  load().images.set(domain, remembered);
  const img = remembered.image;
  if (img.kind === 'example') write(IMAGE_KEY + domain, { kind: 'example', file: img.file, title: img.title, from: img.from });
  else write(IMAGE_KEY + domain, img.dataUrl.length <= MAX_UPLOAD_CHARS ? { kind: 'upload', name: img.name, dataUrl: img.dataUrl } : null);
}

export function forgetImage(domain: string): void {
  load().images.delete(domain);
  write(IMAGE_KEY + domain, null);
}

/** Tests: drop the page's memory so the next call reads sessionStorage again. */
export function resetStudioCache(): void {
  store = null;
}
