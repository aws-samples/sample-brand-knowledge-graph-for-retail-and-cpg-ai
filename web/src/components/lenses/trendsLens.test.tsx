// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, Health, TrendsDescribe } from '../../api';
import recorded from '../shared/__fixtures__/agent.trace.json';
import { LENSES, agentOff, lakeOff, NO_QUERY, noAnswer, NOTHING_NEW, SIDE_BY_SIDE } from './lenses';
import { MethodError } from './TrendsAgentMethods';
import type { DoneEntry, MethodEntry, TrendsState } from './trendsCache';
import { MetricLine } from './trendsPieces';
import { TrendsMethods } from './TrendsQuestion';
import { scoreRows, TrendsScoreboard } from './TrendsScoreboard';

vi.mock('../../auth', () => ({ signIn: async () => {} }));
// requests go out unsigned to the API path, as the tests' fetch stubs expect
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));

const lens = LENSES.find((l) => l.id === 'trends')!;
const AGENT = recorded as unknown as AgentResult;
const EMPTY: TrendsState = { graph: null, lake: null, lakeExport: null, history: { graph: [], lake: [] } };
const health = (available: boolean, reason = ''): Health => ({
  ok: true,
  graph_backend: 'neptune',
  embedder: 'nova',
  embedding_dimension: 1024,
  ontology: { name: 'fashion', version: '1' },
  write_queries: false,
  query_agent: { available, reason, host: 'agentcore' },
});
const graphDone: DoneEntry = {
  status: 'done',
  modelId: AGENT.model.id,
  effort: 'low',
  startedAt: 1,
  ms: 21_400,
  at: 2,
  result: { agent: AGENT, groups: [], totals: { new: 3, new_items: 4, base: 54, left_out: [] }, metrics: { total_ms: 19_000, llm_calls: 3, tool_calls: 4, images: 0, tokens: AGENT.metrics.tokens }, question: AGENT.text },
};
const finding = (text: string) => ({ text, system: '', user: '', ms: 3000, tokens: { input: 900, output: 120, cache_read: 0, cache_write: 0 } });
const DESCRIBE: TrendsDescribe = { items: finding('Wide legs [1].'), looks: finding('Worn to the office [A].'), model: 'global.anthropic.claude-sonnet-5-5', ms: 3200, tokens: { input: 1800, output: 240, cache_read: 0, cache_write: 0 } };

const page = (trends: TrendsState, h: Health | null = health(true)) => renderToStaticMarkup(<TrendsMethods lens={lens} health={h} dataVersion={0} trends={trends} />);

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the creative director's trends question", () => {
  it('shows three numbered method cards, each with its definition of new against old, then Side by side', () => {
    const html = page(EMPTY);
    const titles = [...html.matchAll(/<h3 id="ln-method-[a-z]+">([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Method 1 · Ask the graph agent', 'Method 2 · Export to Iceberg, ask the data agent', 'Method 3 · Explore the clouds']);
    expect(html.match(/<b>New against old:<\/b>/g)).toHaveLength(3);
    expect(html).toContain('the same definition as method 1');
    for (const label of ['Ask the graph agent', 'Export the graph to Iceberg tables', 'Ask the data agent']) expect(html).toContain(`>${label}</button>`);
    // methods 1 and 2: a deep dive each, and a How it works panel each
    expect(html.match(/Deep dive: the agent&#x27;s model and reasoning effort/g)).toHaveLength(2);
    expect(html).toContain('How method 1 works: the graph agent on the Amazon Neptune MCP server');
    expect(html).toContain('How method 2 works: the graph as Iceberg tables');
    const board = renderToStaticMarkup(<TrendsScoreboard graph={[]} lake={[]} clouds={null} />);
    expect(board).toContain('<h3 id="ln-side-by-side">Side by side</h3>');
    expect(board).toContain(SIDE_BY_SIDE.caption);
    expect(SIDE_BY_SIDE.caption).toBe('Methods 1 and 2 count pieces of content against the lookbook’s garments; method 3 counts garments in looks against the garments worn in the lookbook’s looks. No winner: compare the answers.');
  });

  it('says why the graph agent is off, and the button waits', () => {
    const html = page(EMPTY, health(false, 'needs Neptune Analytics (tab 0).'));
    expect(html).toContain('The graph agent is not available: needs Neptune Analytics (tab 0).');
    expect(html).toMatch(/<button disabled="" title="[^"]*">Ask the graph agent<\/button>/);
    expect(agentOff('no runtime')).toBe('The graph agent is not available: no runtime.');
    expect(lakeOff('no S3 table bucket.')).toBe('The lakehouse is not set up: no S3 table bucket.');
  });

  it('shows a running job with what the agent does and the seconds; the result with the model and effort that ran, open trace and the question', () => {
    const running = page({ ...EMPTY, graph: { status: 'running', jobId: 'graph-x', step: 'model turn 2: → run_opencypher_query', modelId: 'm', effort: 'low', startedAt: Date.now() } });
    expect(running).toContain('The agent is querying… model turn 2: → run_opencypher_query · 0 s');
    const html = page({ ...EMPTY, graph: graphDone });
    expect(html).toContain('<b>Claude Sonnet 5.5</b> · effort Low');
    expect(html).toContain('21.4 s');
    expect(html).toContain('The groups, counted again in code');
    expect(html).toContain('What the agent did: 8 steps');
    expect(html).toContain('Model · Claude Sonnet 5.5 on Amazon Bedrock');
    expect(html).toContain('<summary class="muted">The question it got</summary>');
  });

  it('says why a run ended without an answer or a query', () => {
    const turn = { n: 2, kind: 'model' as const, name: 'Amazon Nova 2 Lite', input: {}, ok: true, ms: 21_000, at_ms: 5, summary: '→ answer', error: null, to_model: '', text: '', stop_reason: 'max_tokens', redacted: true };
    const cut: AgentResult = { ...AGENT, answer: '', query: null, rows: [], count: 0, steps: [AGENT.steps[0], turn] };
    const html = page({ ...EMPTY, graph: { ...graphDone, result: { ...graphDone.result, agent: cut } } as MethodEntry });
    expect(html).toContain(noAnswer('max_tokens').replace(/'/g, '&#x27;')); // as React escapes it
    expect(noAnswer('max_tokens')).toBe("No answer: the model's last turn used all its output tokens (stopped: max_tokens), its reasoning included. Try a lower reasoning effort.");
    expect(html).toContain(NO_QUERY);
    expect(html).not.toContain('name no vocabulary node');
    expect(noAnswer('malformed_tool_use')).toBe("No answer: the model's last turn stopped on malformed_tool_use.");
    expect(noAnswer('end_turn')).toBe('No answer.');
    expect(noAnswer(undefined)).toBe('No answer.');
  });

  it('turns "no new items" into the way to tab 2; other errors as they came', () => {
    const error = (code: number | undefined, text: string): Extract<MethodEntry, { status: 'error' }> => ({ status: 'error', error: text, code, modelId: 'm', effort: null, startedAt: 1 });
    const none = renderToStaticMarkup(<MethodError entry={error(409, 'no new items yet: ingest photos or texts in tab 2 first')} method="graph" />);
    expect(none).toContain(NOTHING_NEW);
    expect(NOTHING_NEW).toBe('Nothing new in the graph yet: ingest the first batch in tab 2 first.');
    expect(none).toContain('>Open tab 2</button>');
    expect(renderToStaticMarkup(<MethodError entry={error(409, 'the query agent runtime is not set up')} method="graph" />)).toContain('The graph agent is not available: the query agent runtime is not set up.');
    expect(renderToStaticMarkup(<MethodError entry={error(400, "effort 'xhigh' is not offered for Claude Sonnet 5.5: default, low, medium, high")} method="lake" />)).toBe(
      '<p class="error" role="alert">effort &#x27;xhigh&#x27; is not offered for Claude Sonnet 5.5: default, low, medium, high</p>',
    );
  });

  it('puts each method that ran in one row, measured the same way, method 3 with its describe model and no effort', () => {
    const rows = scoreRows([graphDone], [], { mapMs: 4800, walkMs: 900, describe: DESCRIBE, cloud: 'cloud 2, wide · leg, lift 3.40' }, []);
    expect(rows.map((r) => r.method)).toEqual(['Method 1 · Ask the graph agent', 'Method 3 · Explore the clouds']);
    expect(rows[0]).toMatchObject({ model: 'Claude Sonnet 5.5', effort: 'Low', ms: 21_400, parts: 'model 15.8 s · tools 3.1 s', calls: 3, tools: 4, found: '0 groups' });
    expect(rows[1]).toMatchObject({ model: 'global.anthropic.claude-sonnet-5-5', effort: 'not set', ms: 4800 + 900 + 3200, calls: 2, tools: 2, tokens: DESCRIBE.tokens, found: 'cloud 2, wide · leg, lift 3.40' });
    const board = renderToStaticMarkup(<TrendsScoreboard graph={[graphDone]} lake={[]} clouds={null} />);
    expect(board).toContain('<b>Method 1 · Ask the graph agent</b>');
    expect(board).toContain('<th>effort</th>');
  });

  it('shows the latest run and the one before it per agent method, the older marked "(earlier run)"', () => {
    const earlier: DoneEntry = { ...graphDone, effort: 'high', startedAt: 0, ms: 40_000 };
    const rows = scoreRows([graphDone, earlier], [], null, []);
    expect(rows.map((r) => r.method)).toEqual(['Method 1 · Ask the graph agent', 'Method 1 · Ask the graph agent (earlier run)']);
    expect(rows.map((r) => r.ms)).toEqual([21_400, 40_000]);
    expect(renderToStaticMarkup(<TrendsScoreboard graph={[graphDone, earlier]} lake={[]} clouds={null} />)).toContain('(earlier run)');
  });

  it('gives the method cards and Side by side the same token numbers and labels', () => {
    const t = { input: 100, output: 50, cache_read: 3401, cache_write: 7 };
    const metrics = { ...graphDone.result.metrics, tokens: t };
    const entry: DoneEntry = { ...graphDone, result: { ...graphDone.result, metrics } };
    const [row] = scoreRows([entry], [], null, []);
    expect(row.tokens).toEqual(t);
    const board = renderToStaticMarkup(<TrendsScoreboard graph={[entry]} lake={[]} clouds={null} />);
    expect(board).toContain('<th>cache read</th><th>cache write</th>');
    expect(board).toContain('<td>3,401</td><td>7</td><td><b>3,558</b></td>');
    const card = renderToStaticMarkup(<MetricLine m={metrics} wall={1000} />);
    expect(card).toContain('3,558 tokens');
    expect(card).toContain('100 in');
    expect(card).toContain('50 out');
    expect(card).toContain('3,401 cache read');
    expect(card).toContain('7 cache write');
  });
});
