// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect } from 'react';
import { ApiError, api, type GraphGroups, type GraphJob, type LakeJob } from '../../api';
import { agentSessionId } from '../query/queryView';
import { setMethod, syncDataVersion, trendsState, useTrends, type AgentMethodId, type AgentRun, type RunningEntry } from './trendsCache';
import { LAKE_LIMIT_MS, POLL_LIMIT_MS, runJob, type Job, type JobCalls } from './trendsJob';

/**
 * Methods 1 and 2 of the trends question run their agent as a background job the browser polls
 * (trendsJob.runJob). The poll lives in this module, not in a component: it goes on while another
 * tab is open, and writes every change to trendsCache, which the cards read. After a reload the
 * lens picks a running job up again (`resumeAgent`).
 */

/** The running line of method 1: what the agent is doing, as the API words it. */
export const agentProgress = (step: string) => `The agent is querying… ${step || 'starting the background job'}`;

type LakeResult = NonNullable<LakeJob['result']>;

/** Method 1: the graph agent on the Neptune MCP server, a job of up to 5 minutes. */
export const graphCalls = (modelId: string, effort: string | null): JobCalls<GraphGroups, GraphJob> => ({
  start: () => api.trendGraphAgent(modelId, effort),
  poll: (jobId) => api.trendGraphPoll(jobId),
});
/** Method 2: the data agent on the S3 Tables MCP server, in the browser tab's AgentCore session. */
export const lakeCalls = (modelId: string, effort: string | null, sessionId?: string): JobCalls<LakeResult, LakeJob> => ({
  start: () => api.trendLakeAsk(modelId, effort, sessionId),
  poll: (jobId) => api.trendLakePoll(jobId, sessionId),
});

/** Both results in the shape the cards and the scoreboard read. */
export const fromGraph = (g: GraphGroups): AgentRun => ({ agent: g.agent, groups: g.groups, totals: g.totals, metrics: g.metrics, question: g.agent?.text ?? '' });
export const fromLake = (r: LakeResult, question: string): AgentRun => ({ agent: r.agent, groups: r.groups, totals: r.totals, metrics: r.metrics, question: question || r.agent.text });

// the jobs this page polls now, so a resume never polls one twice
const polling = new Set<string>();

/** Start a method's agent with the model and effort chosen in its deep dive. */
export function askAgent(method: AgentMethodId, modelId: string, effort: string | null): Promise<void> {
  const entry: RunningEntry = { status: 'running', jobId: '', step: '', modelId, effort, startedAt: Date.now(), ...(method === 'lake' ? { sessionId: agentSessionId() } : {}) };
  setMethod(method, entry);
  return follow(method, entry);
}

/** After a reload: poll a job that was still running again (once; no new job is started). */
export function resumeAgent(method: AgentMethodId): Promise<void> {
  const entry = trendsState()[method];
  if (entry?.status !== 'running' || !entry.jobId) return Promise.resolve();
  return follow(method, entry);
}

/** The trends state for a mount of the lens: cleared when the graph changed, running jobs picked up again. */
export function useAgentMethods(dataVersion: number) {
  useEffect(() => {
    syncDataVersion(dataVersion);
    resumeAgent('graph');
    resumeAgent('lake');
  }, [dataVersion]);
  return useTrends();
}

async function follow(method: AgentMethodId, asked: RunningEntry): Promise<void> {
  const key = `${method}:${asked.startedAt}`;
  if (polling.has(key)) return;
  polling.add(key);
  // still this run: not cleared by new data, not replaced by another run
  const mine = () => {
    const e = trendsState()[method];
    return e?.status === 'running' && e.startedAt === asked.startedAt;
  };
  // a new job id or step, written once (no write when nothing changed)
  const update = (patch: Partial<RunningEntry>) => {
    const e = trendsState()[method] as RunningEntry;
    if (mine() && Object.entries(patch).some(([k, v]) => e[k as keyof RunningEntry] !== v)) setMethod(method, { ...e, ...patch });
  };
  const { modelId, effort, startedAt } = asked;
  try {
    const run =
      method === 'graph'
        ? await poll(graphCalls(modelId, effort), asked, 'the graph agent', POLL_LIMIT_MS, mine, update, (g) => fromGraph(g))
        : await poll(lakeCalls(modelId, effort, asked.sessionId), asked, 'the data agent', LAKE_LIMIT_MS, mine, update, (r, first) => fromLake(r, first?.question ?? ''));
    if (run === null || !mine()) return;
    setMethod(method, { status: 'done', modelId, effort, startedAt, result: run, ms: Date.now() - startedAt, at: Date.now() });
  } catch (e) {
    if (mine()) setMethod(method, { status: 'error', modelId, effort, startedAt, error: e instanceof Error ? e.message : String(e), code: e instanceof ApiError ? e.status : undefined });
  } finally {
    polling.delete(key);
  }
}

/** One job, new or picked up again (then `start` is a poll), into the cards' shape. */
async function poll<T, J extends Job<T>>(
  calls: JobCalls<T, J>,
  asked: RunningEntry,
  what: string,
  limitMs: number,
  alive: () => boolean,
  update: (patch: Partial<RunningEntry>) => void,
  convert: (result: T, first: J | null) => AgentRun,
): Promise<AgentRun | null> {
  let first: J | null = null;
  const jobCalls = asked.jobId ? { start: () => calls.poll(asked.jobId), poll: calls.poll } : calls;
  const result = await runJob<T, J>(
    jobCalls,
    {
      alive,
      startedAt: asked.startedAt,
      limitMs,
      onStarted: (job) => {
        first = job;
        update({ jobId: job.job_id });
      },
      onStep: (step) => update({ step }),
    },
    what,
  );
  return result === null ? null : convert(result, first);
}
