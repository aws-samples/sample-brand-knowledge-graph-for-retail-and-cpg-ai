// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { AgentResult } from '../../api';
import { GROUP_LABEL, QUERY_EXAMPLES } from './examples';
import { SESSION_ID, agentSessionId, agentSummary, columnsOf, failedQueries, formatCell, handOver, runtimeLine, stepLabel } from './queryView';

const result: AgentResult = {
  text: 'Which categories have the most items?',
  error_in: "MalformedQueryException: Invalid input 'Which'",
  model: { id: 'global.anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  answer: 'Jackets lead.',
  query: 'MATCH (i:Item)-[:IS_CATEGORY]->(c:Category) RETURN c.name AS category, count(i) AS items',
  rows: [{ category: 'jacket', items: 9 }],
  count: 1,
  stopped: null,
  effort: null,
  steps: [
    { n: 1, kind: 'mcp', name: 'list_tools', input: {}, ok: true, ms: 3, summary: '4 tools', error: null, to_model: '' },
    { n: 2, kind: 'mcp', name: 'get_graph_schema', input: {}, ok: true, ms: 900, summary: '10 node labels', error: null, to_model: '…' },
    { n: 3, kind: 'model', name: 'Claude Sonnet 5.5', input: {}, ok: true, ms: 3000, summary: '→ run_opencypher_query', error: null, to_model: '' },
    { n: 4, kind: 'mcp', name: 'run_opencypher_query', input: { query: 'MATCH (' }, ok: false, ms: 80, summary: 'bad', error: 'bad', to_model: '' },
    { n: 5, kind: 'guard', name: 'run_opencypher_query', input: { query: 'MATCH (n) DELETE n' }, ok: false, ms: 0, summary: 'no', error: 'no', to_model: '' },
  ],
  metrics: { total_ms: 8400, model_ms: 7000, tool_ms: 1000, turns: 3, tool_calls: 2, tokens: { input: 1200, output: 300, cache_read: 2500, cache_write: 0 } },
  mcp: { server: 'awslabs.amazon-neptune-mcp-server', version: '1.1.1', transport: 'stdio', endpoint: 'neptune-graph://g-1', tools: [], offered_to_model: [] },
  runtime: { host: 'agentcore', invoke_ms: 9200, session_id: 'query-agent-1', invocations_in_session: 1, session_age_s: 0 },
};

describe('query view', () => {
  it('collects the columns of every row in first-seen order', () => {
    expect(columnsOf([{ a: 1, b: 2 }, { c: 3, a: 4 }])).toEqual(['a', 'b', 'c']);
    expect(columnsOf([])).toEqual([]);
  });

  it('formats nodes as label + properties, without the embedding', () => {
    expect(formatCell({ '~id': 'item:1', '~labels': ['Item'], '~properties': { name: 'Trench', embedding: [0.1] } })).toBe('Item {"name":"Trench"}');
    expect(formatCell({ '~id': 'e1', '~type': 'IS_CATEGORY', '~properties': {} })).toBe('IS_CATEGORY {}');
    expect(formatCell(null)).toBe('');
    expect(formatCell(['a', 'b'])).toBe('[\n "a",\n "b"\n]');
    expect(formatCell(3)).toBe('3');
  });

  it('hands only rejected queries to the agent', () => {
    expect(handOver(400)).toBe(true);
    for (const status of [403, 409, 501, 502, undefined]) expect(handOver(status)).toBe(false);
  });

  it('summarises an agent run', () => {
    expect(agentSummary(result)).toBe('3 model turns · 2 tool calls · 8.4 s · 4,000 tokens (2,500 cached)');
    expect(failedQueries(result)).toBe(1);
    // tab 6's data agent: Daft's rejections of its SQL count the same way
    const sql = { ...result, steps: result.steps.map((s) => (s.name === 'run_opencypher_query' ? { ...s, name: 'query_database' } : s)) };
    expect(failedQueries(sql)).toBe(1);
    expect(result.steps.map(stepLabel)).toEqual([
      'MCP · list_tools',
      'MCP · get_graph_schema',
      'Claude Sonnet 5.5 → run_opencypher_query',
      'MCP · run_opencypher_query',
      'guard · run_opencypher_query',
    ]);
  });

  it('keeps one AgentCore session id per browser tab', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const uuid = () => '01234567-89ab-cdef-0123-456789abcdef';
    const id = agentSessionId(storage, uuid);
    expect(id).toBe('query-agent-01234567-89ab-cdef-0123-456789abcdef');
    expect(SESSION_ID.test(id)).toBe(true); // AgentCore: at least 33 characters
    expect(agentSessionId(storage, () => 'other')).toBe(id); // the same tab keeps it
    store.set('query.agent-session', 'too-short');
    expect(agentSessionId(storage, uuid)).toBe(id); // an invalid id is replaced
  });

  it('says where the agent ran', () => {
    expect(runtimeLine(result)).toBe('on Amazon Bedrock AgentCore Runtime · new session (its microVM started for this request) · 9.2 s round trip');
    const warm = { ...result, runtime: { host: 'agentcore' as const, invoke_ms: 4100, invocations_in_session: 3, session_age_s: 300 } };
    expect(runtimeLine(warm)).toBe('on Amazon Bedrock AgentCore Runtime · warm session (request 3, 5 min old) · 4.1 s round trip');
    expect(runtimeLine({ ...result, runtime: { host: 'in-process', invoke_ms: 6000 } })).toBe('in the API process (no AgentCore Runtime set up) · 6.0 s round trip');
    expect(runtimeLine({ ...result, runtime: undefined })).toBe('');
  });

  it("ships one example list for the explorer: the brand's looks, the graph, the agent's", () => {
    expect(new Set(QUERY_EXAMPLES.map((e) => e.kind))).toEqual(new Set(['cypher', 'broken', 'question']));
    // every group a button sits in has its label, and no row is left empty but the writes
    expect(new Set(QUERY_EXAMPLES.map((e) => e.group))).toEqual(new Set(['looks', 'graph', 'vector', 'broken', 'question']));
    for (const e of QUERY_EXAMPLES) expect(GROUP_LABEL[e.group]).toBeTruthy();
    expect(new Set(QUERY_EXAMPLES.map((e) => e.title)).size).toBe(QUERY_EXAMPLES.length);
    // no write is offered by default, and nothing names John's old brand
    for (const e of QUERY_EXAMPLES) expect(e.kind).not.toBe('write');
    const texts = QUERY_EXAMPLES.map((e) => e.text).join('\n');
    for (const needle of ['(l:Look)-[:FOR]->(o:Occasion)', 'l.run IS NOT NULL', '-[:ILLUSTRATES]->(l:Look)', 'AttributeFamily', 'neptune.algo.vectors.topK.byNode']) expect(texts).toContain(needle);
    for (const gone of ['Black tie', 'Waxed field jacket', 'LAYERED_WITH']) expect(texts).not.toContain(gone);
  });
});
