// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type AgentResult, type GraphGroups, type GraphJob } from '../../api';
import { AgentAnswer } from '../query/GraphQuery';
import { agentProgress, graphCalls } from './agentMethods';
import { LAKE_LIMIT_MS, POLL_LIMIT_MS, POLL_MS, runJob } from './trendsJob';

vi.mock('../../auth', () => ({ signIn: async () => {} }));
// requests go out unsigned to the API path, as the tests' fetch stubs expect
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));

const JOB_ID = `graph-${'b'.repeat(32)}`;
const AGENT: AgentResult = {
  text: 'Find what is EMERGING in this brand graph.',
  error_in: null,
  model: { id: 'global.anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  answer: 'Knee-length double-breasted coats are emerging.',
  query: 'MATCH (i:Item)-[:HAS_ATTRIBUTE]->(a:Attribute) RETURN id(a) AS a_id',
  rows: [{ a_id: 'attribute:length:knee' }],
  count: 1,
  stopped: null,
  effort: 'low',
  steps: [
    { n: 1, kind: 'mcp', name: 'list_tools', input: {}, ok: true, ms: 3, at_ms: 0, summary: '4 tools', error: null, to_model: '' },
    { n: 2, kind: 'model', name: 'Claude Sonnet 5.5', input: {}, ok: true, ms: 41_000, at_ms: 3, summary: '→ run_opencypher_query', error: null, to_model: '' },
    { n: 3, kind: 'mcp', name: 'run_opencypher_query', input: { query: 'MATCH …' }, ok: true, ms: 900, at_ms: 41_003, summary: '1 rows', error: null, to_model: '' },
  ],
  metrics: { total_ms: 212_000, model_ms: 200_000, tool_ms: 12_000, turns: 9, tool_calls: 8, tokens: { input: 90_000, output: 4_000, cache_read: 0, cache_write: 0 } },
  mcp: { server: 'awslabs.amazon-neptune-mcp-server', version: '1.1.1', transport: 'stdio', endpoint: 'neptune-graph://g-1', tools: [], offered_to_model: [] },
  runtime: { host: 'agentcore', invoke_ms: 214_000, session_id: `trends-${JOB_ID}` },
};
const RESULT: GraphGroups = {
  mode: 'agent',
  groups: [],
  totals: { new: 3, new_items: 4, base: 54, left_out: [] },
  agent: AGENT,
  metrics: { total_ms: 215_000, llm_calls: 9, tool_calls: 8, images: 0, tokens: { input: 90_000, output: 4_000, cache_read: 0, cache_write: 0 } },
};
const running = (step: string): GraphJob => ({ job_id: JOB_ID, status: 'running', step, elapsed_s: 1 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the trends question, method 1: the graph agent as a background job', () => {
  it('starts the job with the model and effort, polls it by its id every 2 s with what the agent does, and returns its groups', async () => {
    const start = vi.spyOn(api, 'trendGraphAgent').mockResolvedValue(running('queued for the pipeline function'));
    const replies: GraphJob[] = [
      running('on AgentCore Runtime: writing and running openCypher (up to 300 s)'),
      { job_id: JOB_ID, status: 'done', step: "counting the groups in the agent's rows", elapsed_s: 214.2, result: RESULT },
    ];
    const poll = vi.spyOn(api, 'trendGraphPoll').mockImplementation(async () => replies.shift()!);
    const sleeps: number[] = [];
    const steps: string[] = [];
    const started: string[] = [];
    const out = await runJob(graphCalls('global.anthropic.claude-sonnet-5-5', 'low'), {
      onStep: (s) => steps.push(s),
      alive: () => true,
      onStarted: (job) => started.push(job.job_id),
      sleep: async (ms) => void sleeps.push(ms),
    }, 'the graph agent');
    expect(out).toBe(RESULT);
    expect(start.mock.calls).toEqual([['global.anthropic.claude-sonnet-5-5', 'low']]);
    expect(started).toEqual([JOB_ID]);
    expect(poll.mock.calls).toEqual([[JOB_ID], [JOB_ID]]);
    expect(POLL_MS).toBe(2000);
    expect(sleeps).toEqual([2000, 2000]);
    expect(steps).toEqual(['queued for the pipeline function', 'on AgentCore Runtime: writing and running openCypher (up to 300 s)']);
  });

  it('rejects with the error of a failed job; gives up after 12 minutes, counted from when it started', async () => {
    vi.spyOn(api, 'trendGraphAgent').mockResolvedValue(running(''));
    const error = 'RuntimeError: query agent runtime: the MCP server could not read the graph';
    vi.spyOn(api, 'trendGraphPoll').mockResolvedValue({ job_id: JOB_ID, status: 'failed', elapsed_s: 30, error });
    const watch = { onStep: () => {}, alive: () => true, sleep: async () => {} };
    await expect(runJob(graphCalls('m', null), watch, 'the graph agent')).rejects.toThrow(error);
    vi.spyOn(api, 'trendGraphPoll').mockResolvedValue(running('model turn 3: → run_opencypher_query'));
    let t = 0;
    const late = runJob(graphCalls('m', null), { onStep: () => {}, alive: () => true, sleep: async (ms) => void (t += ms), now: () => t }, 'the graph agent');
    await expect(late).rejects.toThrow('the graph agent did not finish within 12 minutes');
    expect(POLL_LIMIT_MS).toBe(12 * 60 * 1000);
    // a job picked up after a reload: the limit counts from its start, not from the reload
    t = POLL_LIMIT_MS;
    const resumed = runJob(graphCalls('m', null), { onStep: () => {}, alive: () => true, startedAt: 0, sleep: async () => {}, now: () => t + 1 }, 'the graph agent');
    await expect(resumed).rejects.toThrow('within 12 minutes');
    // the data agent's own limit
    t = 0;
    const lake = runJob(graphCalls('m', null), { onStep: () => {}, alive: () => true, limitMs: LAKE_LIMIT_MS, sleep: async (ms) => void (t += ms), now: () => t }, 'the data agent');
    await expect(lake).rejects.toThrow('the data agent did not finish within 6 minutes');
  });

  it('stops polling once nobody waits for it (the results were cleared, or a new run replaced it)', async () => {
    vi.spyOn(api, 'trendGraphAgent').mockResolvedValue(running(''));
    let alive = true;
    const poll = vi.spyOn(api, 'trendGraphPoll').mockImplementation(async () => running('model turn 1: → get_graph_schema'));
    const sleep = async () => {
      if (poll.mock.calls.length === 1) alive = false;
    };
    await expect(runJob(graphCalls('m', null), { onStep: () => {}, alive: () => alive, sleep }, 'the graph agent')).resolves.toBeNull();
    expect(poll).toHaveBeenCalledTimes(1); // no request after that
  });

  it('words what the agent is doing while it runs', () => {
    expect(agentProgress('model turn 2: → run_opencypher_query')).toBe('The agent is querying… model turn 2: → run_opencypher_query');
    expect(agentProgress('')).toBe('The agent is querying… starting the background job');
  });

  it("once done, the agent's own answer and what it did: folded in tab 3, open in the trends methods", () => {
    const folded = renderToStaticMarkup(<AgentAnswer result={RESULT.agent!} />);
    expect(folded).toContain('Knee-length double-breasted coats are emerging.');
    expect(folded).toContain('<details class="agent-steps"><summary>What the agent did: 3 steps');
    const open = renderToStaticMarkup(<AgentAnswer result={RESULT.agent!} showAnswer={false} traceOpen />);
    expect(open).not.toContain('<details class="agent-steps">');
    expect(open).not.toContain('Knee-length double-breasted coats are emerging.');
    expect(open).toContain('What the agent did: 3 steps');
    expect(open).toContain('Model · Claude Sonnet 5.5 on Amazon Bedrock');
  });
});
