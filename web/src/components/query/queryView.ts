// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { AgentResult, AgentStep } from '../../api';

/** The columns of a result: every key of every row, in first-seen order. */
export function columnsOf(rows: Record<string, unknown>[]): string[] {
  return Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
}

/** One cell as text. Whole nodes and edges (`~id`, `~labels`, `~properties`) read as `Label {props}`. */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  const obj = v as Record<string, any>;
  if (obj['~properties']) {
    const props = { ...obj['~properties'] };
    delete props.embedding;
    const label = (obj['~labels'] ?? (obj['~type'] ? [obj['~type']] : [])).join(':');
    return `${label} ${JSON.stringify(props)}`.trim();
  }
  return JSON.stringify(v, null, 1);
}

/**
 * Whether a failed direct query goes to the agent: only when Neptune rejected the text itself (400:
 * a syntax error, an unknown function, or plain words). A write refused by the endpoint (403), a
 * missing graph (501) or a service error is not something the agent can fix.
 */
export function handOver(status: number | undefined): boolean {
  return status === 400;
}

/** A short line for one step of the agent's trace. */
export function stepLabel(s: AgentStep): string {
  if (s.kind === 'model') return `${s.name} ${s.summary}`;
  if (s.kind === 'guard') return `guard · ${s.name}`;
  return `MCP · ${s.name}`;
}

/** The headline numbers of an agent run. */
export function agentSummary(r: AgentResult): string {
  const m = r.metrics;
  const tokens = m.tokens.input + m.tokens.output + m.tokens.cache_read;
  const parts = [
    `${m.turns} model turn${m.turns === 1 ? '' : 's'}`,
    `${m.tool_calls} tool call${m.tool_calls === 1 ? '' : 's'}`,
    `${(m.total_ms / 1000).toFixed(1)} s`,
    `${tokens.toLocaleString('en-US')} tokens${m.tokens.cache_read ? ` (${m.tokens.cache_read.toLocaleString('en-US')} cached)` : ''}`,
  ];
  return parts.join(' · ');
}

/** How many of the agent's queries the engine rejected before one ran (the guard's refusals not counted). */
export function failedQueries(r: AgentResult): number {
  return r.steps.filter((s) => s.kind === 'mcp' && (s.name === 'run_opencypher_query' || s.name === 'query_database') && !s.ok).length;
}

const SESSION_KEY = 'query.agent-session';
/** What AgentCore Runtime accepts as a runtimeSessionId (the API checks the same pattern). */
export const SESSION_ID = /^[A-Za-z0-9-]{33,100}$/;

/**
 * The AgentCore Runtime session of this browser tab: one id per tab (sessionStorage), so the
 * tab's requests reach the same warm microVM and two tabs never share one.
 */
export function agentSessionId(storage: Pick<Storage, 'getItem' | 'setItem'> = sessionStorage, uuid: () => string = () => crypto.randomUUID()): string {
  const known = storage.getItem(SESSION_KEY);
  if (known && SESSION_ID.test(known)) return known;
  const id = `query-agent-${uuid()}`;
  storage.setItem(SESSION_KEY, id);
  return id;
}

/** Where the agent ran, in one line (after "Ran"): AgentCore Runtime (new or warm session) or the API process. */
export function runtimeLine(r: AgentResult): string {
  const rt = r.runtime;
  if (!rt) return '';
  const trip = rt.invoke_ms !== undefined ? `${(rt.invoke_ms / 1000).toFixed(1)} s round trip` : '';
  if (rt.host !== 'agentcore') return ['in the API process (no AgentCore Runtime set up)', trip].filter(Boolean).join(' · ');
  const n = rt.invocations_in_session ?? 1;
  const age = rt.session_age_s ?? 0;
  const session = n <= 1 ? 'new session (its microVM started for this request)' : `warm session (request ${n}, ${age < 120 ? `${age} s` : `${Math.round(age / 60)} min`} old)`;
  return ['on Amazon Bedrock AgentCore Runtime', session, trip].filter(Boolean).join(' · ');
}
