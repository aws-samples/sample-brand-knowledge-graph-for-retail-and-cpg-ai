// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, type AgentResult, type GraphGroups, type LakeJob } from '../../api';
import recorded from '../shared/__fixtures__/agent.trace.json';
import { askAgent, resumeAgent } from './agentMethods';
import { clearTrends, resetTrendsCache, setLakeExport, setMethod, syncDataVersion, trendsState, TRENDS_KEY, type MethodEntry } from './trendsCache';

vi.mock('../../auth', () => ({ signIn: async () => {} }));
// requests go out unsigned to the API path, as the tests' fetch stubs expect
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));

const AGENT = recorded as unknown as AgentResult;
const GROUPS: GraphGroups = {
  mode: 'agent',
  groups: [],
  totals: { new: 3, new_items: 4, base: 54, left_out: [] },
  agent: AGENT,
  metrics: { total_ms: 19_000, llm_calls: 3, tool_calls: 4, images: 0, tokens: { input: 6100, output: 4886, cache_read: 9600, cache_write: 4800 } },
};
const JOB_ID = `graph-${'c'.repeat(32)}`;
const SESSION = `query-agent-${'d'.repeat(36)}`;

// sessionStorage of one browser tab, kept across "reloads" (resetTrendsCache drops the page's memory)
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) });
  resetTrendsCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const done: MethodEntry = { status: 'done', modelId: AGENT.model.id, effort: 'low', startedAt: 1, result: { ...GROUPS, question: AGENT.text }, ms: 19_400, at: 2 };

describe('the trends cache', () => {
  it('stores each method in the browser tab, and a reload finds it again', () => {
    setMethod('graph', done);
    setLakeExport({ result: { tables: { items: { rows: 62, ms: 900, snapshot_id: 1 } }, table_bucket_arn: 'arn', namespace: 'brand_graph', runtime: null, metrics: { total_ms: 1, read_ms: 1, write_ms: 1 } }, ms: 1200, at: 3 });
    expect(JSON.parse(stored.get(TRENDS_KEY)!).graph.result.agent.model.name).toBe('Claude Sonnet 5.5');
    resetTrendsCache(); // a reload
    expect(trendsState().graph).toEqual(done);
    expect(trendsState().lake).toBeNull();
    expect(trendsState().lakeExport?.ms).toBe(1200);
  });

  it('keeps a running job with its id for a reload; one whose start never answered is gone', () => {
    setMethod('graph', { status: 'running', jobId: JOB_ID, step: 'model turn 2', modelId: 'm', effort: 'high', startedAt: 5 });
    setMethod('lake', { status: 'running', jobId: '', step: '', modelId: 'm', effort: null, startedAt: 6, sessionId: SESSION });
    resetTrendsCache();
    expect(trendsState().graph).toMatchObject({ status: 'running', jobId: JOB_ID, effort: 'high' });
    expect(trendsState().lake).toBeNull();
  });

  it('picks a running graph job up again after a reload: polls it by its id, starts nothing new', async () => {
    setMethod('graph', { status: 'running', jobId: JOB_ID, step: '', modelId: AGENT.model.id, effort: 'low', startedAt: Date.now() - 30_000 });
    resetTrendsCache();
    const start = vi.spyOn(api, 'trendGraphAgent');
    const poll = vi.spyOn(api, 'trendGraphPoll').mockResolvedValue({ job_id: JOB_ID, status: 'done', elapsed_s: 30, result: GROUPS });
    await resumeAgent('graph');
    expect(start).not.toHaveBeenCalled();
    expect(poll.mock.calls).toEqual([[JOB_ID]]);
    const entry = trendsState().graph;
    expect(entry?.status).toBe('done');
    if (entry?.status !== 'done') return;
    expect(entry.result.question).toBe(AGENT.text);
    expect(entry.effort).toBe('low');
    expect(entry.ms).toBeGreaterThanOrEqual(30_000);
    await resumeAgent('graph'); // done: nothing to pick up
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("picks a running data agent job up in the browser tab's session; the question is the agent's own text", async () => {
    setMethod('lake', { status: 'running', jobId: 'lake-0123456789ab', step: '', modelId: 'm', effort: 'medium', startedAt: Date.now(), sessionId: SESSION });
    const result: NonNullable<LakeJob['result']> = { agent: AGENT, groups: [], totals: GROUPS.totals, metrics: { ...GROUPS.metrics, recount_ms: 4 } };
    // the poll's record carries no question (only the start response does)
    const poll = vi.spyOn(api, 'trendLakePoll').mockResolvedValue({ job_id: 'lake-0123456789ab', status: 'done', elapsed_s: 40, result });
    await resumeAgent('lake');
    expect(poll.mock.calls).toEqual([['lake-0123456789ab', SESSION]]);
    const entry = trendsState().lake;
    expect(entry?.status === 'done' && entry.result.question).toBe(AGENT.text);
  });

  it('starts a job with the model and effort; a graph with nothing new is an error the card can word (409)', async () => {
    vi.spyOn(api, 'trendGraphAgent').mockRejectedValue(new ApiError(409, 'no new items yet: ingest photos or texts in tab 2 first'));
    await askAgent('graph', 'global.anthropic.claude-haiku-5-5', 'off');
    expect(api.trendGraphAgent).toHaveBeenCalledWith('global.anthropic.claude-haiku-5-5', 'off');
    expect(trendsState().graph).toMatchObject({ status: 'error', code: 409, effort: 'off', modelId: 'global.anthropic.claude-haiku-5-5' });
  });

  it('clears both methods when the graph changes (a new graph version), and keeps them across a reload', () => {
    setMethod('graph', done);
    setMethod('lake', { ...done, modelId: 'other' });
    expect(syncDataVersion(0)).toBe(false); // App's version on page load: kept
    expect(syncDataVersion(0)).toBe(false);
    expect(trendsState().graph).not.toBeNull();
    expect(syncDataVersion(1)).toBe(true);
    expect(trendsState()).toEqual({ graph: null, lake: null, lakeExport: null, history: { graph: [], lake: [] } });
    expect(stored.has(TRENDS_KEY)).toBe(false);
    // a reload starts at App's first version again: the stored results are kept
    setMethod('graph', done);
    resetTrendsCache();
    expect(syncDataVersion(0)).toBe(false);
    expect(trendsState().graph).toEqual(done);
    // a reload, then the graph changes before tab 6 opens (a tab 2 run, a sample load): cleared
    resetTrendsCache();
    expect(syncDataVersion(2)).toBe(true);
    expect(trendsState().graph).toBeNull();
    setMethod('graph', done);
    clearTrends();
    expect(trendsState().graph).toBeNull();
  });

  it('keeps the latest finished run and the one before it per method, and drops the oldest on a third', () => {
    const run = (n: number): MethodEntry => ({ ...done, startedAt: n, effort: `e${n}` });
    setMethod('graph', run(1));
    setMethod('graph', { status: 'running', jobId: JOB_ID, step: '', modelId: 'm', effort: null, startedAt: 2 }); // the next run replaces the entry
    expect(trendsState().history.graph.map((e) => e.startedAt)).toEqual([1]);
    setMethod('graph', run(2));
    expect(trendsState().history.graph.map((e) => e.startedAt)).toEqual([2, 1]);
    setMethod('graph', run(3));
    expect(trendsState().history.graph.map((e) => e.startedAt)).toEqual([3, 2]);
    expect(trendsState().history.lake).toEqual([]);
    // a reload keeps both
    resetTrendsCache();
    expect(trendsState().history.graph.map((e) => e.startedAt)).toEqual([3, 2]);
  });

  it('forgets both kept runs when the graph changes', () => {
    syncDataVersion(0);
    setMethod('graph', { ...done, startedAt: 1 });
    setMethod('graph', { ...done, startedAt: 2 });
    expect(trendsState().history.graph).toHaveLength(2);
    expect(syncDataVersion(1)).toBe(true);
    expect(trendsState().history.graph).toEqual([]);
    expect(stored.has(TRENDS_KEY)).toBe(false);
  });
});
