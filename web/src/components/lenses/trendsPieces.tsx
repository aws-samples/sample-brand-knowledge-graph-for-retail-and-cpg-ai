// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { GraphGroups, TrendMetrics, TrendTokens } from '../../api';

/** A request's state in the trends question's cards: idle, running since, done with its result and time, or failed. */
export type Run<T> = { status: 'idle' } | { status: 'running'; startedAt: number } | { status: 'done'; result: T; ms: number; at: number } | { status: 'error'; error: string };
export const IDLE = { status: 'idle' } as const;

export const tok = (t: TrendTokens) => t.input + t.output + t.cache_read + t.cache_write;

/** One run's numbers, the same way for every method: the model and effort that ran, the time, the calls, the tokens. */
export function MetricLine({ m, wall, model, effort, extra }: { m: TrendMetrics; wall: number; model?: string; effort?: string; extra?: string }) {
  return (
    <div className="ask-metrics">
      {model && (
        <span>
          <b>{model}</b>
          {effort ? ` · effort ${effort}` : ''}
        </span>
      )}
      <span title="from the request to the result, measured in the browser">{(wall / 1000).toFixed(1)} s</span>
      <span>
        {m.llm_calls} model turn{m.llm_calls === 1 ? '' : 's'}
        {m.tool_calls !== undefined ? ` · ${m.tool_calls} tool call${m.tool_calls === 1 ? '' : 's'}` : ''}
      </span>
      <span title={`input ${m.tokens.input} · output ${m.tokens.output} · cache read ${m.tokens.cache_read} · cache write ${m.tokens.cache_write}`}>
        {tok(m.tokens).toLocaleString()} tokens ({m.tokens.input.toLocaleString()} in · {m.tokens.output.toLocaleString()} out · {m.tokens.cache_read.toLocaleString()} cache read ·{' '}
        {m.tokens.cache_write.toLocaleString()} cache write)
      </span>
      {extra && <span className="muted">{extra}</span>}
    </div>
  );
}

/** The groups an agent's rows name, counted again in code: properties, new pieces, lookbook garments, lift, and what is adjacent in the graph. */
export function GroupsTable({ groups }: { groups: GraphGroups['groups'] }) {
  return (
    <div className="table-wrap">
      <table className="results trend-table">
        <thead>
          <tr>
            <th>group</th>
            <th>properties</th>
            <th title="new pieces of content (photos, texts) with every property of the group">new</th>
            <th title="lookbook garments with every property of the group">lookbook</th>
            <th>lift</th>
            <th>adjacent in the graph</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>
                <b>{g.id}</b>
              </td>
              <td>
                {g.features.map((f) => (
                  <span key={f.id} className={`pill ${f.kind === 'category' ? 'Category' : 'Attribute'}`} title={f.id}>
                    {f.name}
                    {f.family && !f.name.includes('(') ? ` (${f.family})` : ''}
                  </span>
                ))}
              </td>
              <td>{g.support_new}</td>
              <td>{g.support_base}</td>
              <td>
                <b>{g.lift.toFixed(1)}</b>
              </td>
              <td className="trend-adjacent">
                <div>
                  <span className="muted">new: </span>
                  {g.items_new.map((i) => i.name).join('; ') || 'n/a'}
                </div>
                <div>
                  <span className="muted">lookbook: </span>
                  {g.items_base.map((i) => i.name).join('; ') || 'none'}
                </div>
                {g.also.length > 0 && (
                  <div>
                    <span className="muted">also shared: </span>
                    {g.also.map((f) => `${f.name} ×${f.count}`).join(', ')}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
