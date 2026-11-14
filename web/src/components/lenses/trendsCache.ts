// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useSyncExternalStore } from 'react';
import type { AgentResult, GraphGroup, GraphGroups, LakeExport, TrendMetrics } from '../../api';

/**
 * What the trends question's two agent methods keep when another tab opens (App unmounts a tab on
 * every switch) or the page reloads: per method, the job still running (its id, the browser tab's
 * session, when it started) or the finished result, with the model and effort asked for. It lives
 * once per page (memory) and in the browser tab's sessionStorage (`lens.trends.v1`), on the
 * pattern of tab 1's studioCache. A running job is polled again when the lens mounts
 * (agentMethods.resumeAgent). The latest two finished runs of each method are kept for Side by
 * side. New data in the graph (App's `dataVersion`) clears both methods and their history.
 */
export const TRENDS_KEY = 'lens.trends.v1';

export type AgentMethodId = 'graph' | 'lake';
/** Methods 1 and 2 done, in one shape: the agent's run, its groups counted again in code, the question it got. */
export type AgentRun = { agent: AgentResult | null; groups: GraphGroup[]; totals: GraphGroups['totals']; metrics: TrendMetrics; question: string };
/** What the browser asked for; the result echoes what actually ran. */
type Asked = { modelId: string; effort: string | null; startedAt: number };
export type MethodEntry =
  | (Asked & { status: 'running'; jobId: string; sessionId?: string; step: string })
  | (Asked & { status: 'done'; result: AgentRun; ms: number; at: number })
  | (Asked & { status: 'error'; error: string; code?: number });
export type RunningEntry = Extract<MethodEntry, { status: 'running' }>;
export type DoneEntry = Extract<MethodEntry, { status: 'done' }>;
export type LakeExportRun = { result: LakeExport; ms: number; at: number };
/** Per method, its finished runs, newest first: Side by side shows the latest and the one before it. */
export type DoneHistory = Record<AgentMethodId, DoneEntry[]>;
export type TrendsState = { graph: MethodEntry | null; lake: MethodEntry | null; lakeExport: LakeExportRun | null; history: DoneHistory };

/** How many finished runs per method Side by side keeps: the latest and the one before it. */
export const KEPT_RUNS = 2;

const EMPTY: TrendsState = { graph: null, lake: null, lakeExport: null, history: { graph: [], lake: [] } };
type Store = { state: TrendsState; version: number; listeners: Set<() => void> };
let store: Store | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null; // storage disabled (some private modes, sandboxed frames)
  }
}

/** A job whose start never answered has no id to poll: it is gone after a reload. */
const keep = (e: MethodEntry | null | undefined): MethodEntry | null => (e && !(e.status === 'running' && !e.jobId) ? e : null);

function load(): Store {
  if (store) return store;
  let state = EMPTY;
  try {
    const raw = storage()?.getItem(TRENDS_KEY);
    const read = raw ? (JSON.parse(raw) as Partial<TrendsState>) : null;
    if (read) {
      const graph = keep(read.graph);
      const lake = keep(read.lake);
      // an older save has no history: its finished entry is the latest run
      const hist = (method: AgentMethodId, entry: MethodEntry | null): DoneEntry[] => {
        const saved = read.history?.[method];
        const list = Array.isArray(saved) ? saved.filter((e) => e?.status === 'done') : entry?.status === 'done' ? [entry] : [];
        return list.slice(0, KEPT_RUNS);
      };
      state = { graph, lake, lakeExport: read.lakeExport ?? null, history: { graph: hist('graph', graph), lake: hist('lake', lake) } };
    }
  } catch {
    // unreadable: start empty
  }
  // App's graph version starts at 0 on every page load: results kept from before a reload belong to
  // version 0, and a first sync with any other version means the graph changed since.
  store = { state, version: 0, listeners: new Set() };
  return store;
}

function save(next: TrendsState): void {
  const s = load();
  s.state = next;
  try {
    if (!next.graph && !next.lake && !next.lakeExport && !next.history.graph.length && !next.history.lake.length) storage()?.removeItem(TRENDS_KEY);
    else storage()?.setItem(TRENDS_KEY, JSON.stringify(next));
  } catch {
    // over quota: memory keeps it for this page
  }
  for (const fn of s.listeners) fn();
}

export function trendsState(): TrendsState {
  return load().state;
}

/**
 * Set a method's entry. A finished run is also kept in the method's history (the latest and the one
 * before it), so starting the next run, which replaces the entry, does not lose it.
 */
export function setMethod(method: AgentMethodId, entry: MethodEntry | null): void {
  const state = load().state;
  const history = { ...state.history };
  if (entry?.status === 'done') history[method] = [entry, ...history[method].filter((e) => e.startedAt !== entry.startedAt)].slice(0, KEPT_RUNS);
  save({ ...state, [method]: entry, history });
}

export function setLakeExport(run: LakeExportRun | null): void {
  save({ ...load().state, lakeExport: run });
}

/** Forget both methods and the export (memory and sessionStorage). */
export function clearTrends(): void {
  save(EMPTY);
}

/**
 * The graph's version as App counts it (0 on every page load, bumped when the graph is cleared,
 * reloaded or switched and when a tab 2 run finishes). A version other than the last one seen
 * means the graph changed: the results are stale and cleared, and a job still running is no longer
 * polled. Returns whether it cleared.
 */
export function syncDataVersion(version: number): boolean {
  const s = load();
  if (s.version === version) return false;
  s.version = version;
  clearTrends();
  return true;
}

export function subscribeTrends(fn: () => void): () => void {
  const s = load();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

/** The state, re-rendered on every change by any mount or any job. */
export function useTrends(): TrendsState {
  return useSyncExternalStore(subscribeTrends, trendsState, trendsState);
}

/** Tests: drop the page's memory so the next call reads sessionStorage again (a reload). */
export function resetTrendsCache(): void {
  store = null;
}
