// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { TrendTokens, TrendsDescribe, VisionModel } from '../../api';
import { useModels } from '../shared/useModels';
import { effortText } from './effort';
import { SIDE_BY_SIDE, TRENDS_METHODS } from './lenses';
import type { DoneEntry } from './trendsCache';
import { tok } from './trendsPieces';

/** Method 3's last description, with the map and the walk it came from (their times add up to the row's). */
export type CloudsRun = { mapMs: number; walkMs: number; describe: TrendsDescribe; cloud: string };
export type ScoreRow = { method: string; model: string; effort: string; ms: number; parts: string; calls: number; tools: number; tokens: TrendTokens; found: string };

const ZERO: TrendTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The mark on the older of a method's two rows. */
export const EARLIER_RUN = '(earlier run)';

/**
 * One row per finished run, measured the same way: the model and effort that ran (from the
 * backend), the time in the browser and where it went, model and tool calls, tokens. Methods 1 and
 * 2 give their latest finished run and the one before it (marked "(earlier run)"); method 3 gives
 * its last run only. Each list is newest first.
 */
export function scoreRows(graph: DoneEntry[], lake: DoneEntry[], clouds: CloudsRun | null, models: VisionModel[]): ScoreRow[] {
  const rows: ScoreRow[] = [];
  const name = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  for (const [entries, title] of [
    [graph, TRENDS_METHODS.graph.title],
    [lake, TRENDS_METHODS.lake.title],
  ] as const) {
    entries.forEach((entry, i) => {
      const { agent, metrics, groups } = entry.result;
      rows.push({
        method: i === 0 ? title : `${title} ${EARLIER_RUN}`,
        model: agent?.model.name ?? name(entry.modelId),
        effort: effortText(agent ? agent.effort : entry.effort, models.find((m) => m.id === (agent?.model.id ?? entry.modelId))),
        ms: entry.ms,
        parts: agent ? `model ${secs(agent.metrics.model_ms)} · tools ${secs(agent.metrics.tool_ms)}` : '',
        calls: metrics.llm_calls,
        tools: metrics.tool_calls ?? 0,
        tokens: metrics.tokens,
        found: plural(groups.length, 'group'),
      });
    });
  }
  if (clouds) {
    const d = clouds.describe;
    rows.push({
      method: TRENDS_METHODS.clouds.title,
      model: name(d.model),
      effort: 'not set',
      ms: clouds.mapMs + clouds.walkMs + d.ms,
      parts: `model ${secs(d.ms)} · tools ${secs(clouds.mapMs + clouds.walkMs)} (the map and the walk)`,
      calls: 2,
      tools: 2,
      tokens: d.tokens ?? ZERO,
      found: clouds.cloud,
    });
  }
  return rows;
}

/** "Side by side": the three methods' last runs in one table, with no winner. */
export function TrendsScoreboard({ graph, lake, clouds }: { graph: DoneEntry[]; lake: DoneEntry[]; clouds: CloudsRun | null }) {
  const { models } = useModels('answer');
  const rows = scoreRows(graph, lake, clouds, models);
  return (
    <section className="card" aria-labelledby="ln-side-by-side">
      <h3 id="ln-side-by-side">{SIDE_BY_SIDE.title}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {SIDE_BY_SIDE.caption}
      </p>
      {rows.length === 0 ? (
        <p className="muted">Run a method above to see it here.</p>
      ) : (
        <div className="table-wrap">
          <table className="metrics trend-score">
            <thead>
              <tr>
                <th>method</th>
                <th>model</th>
                <th>effort</th>
                <th>time</th>
                <th title="the model's turns, then the tool calls (methods 1 and 2: MCP; method 3: the map and the walk)">where the time went</th>
                <th>model calls</th>
                <th>tool calls</th>
                <th>tokens in</th>
                <th>out</th>
                <th>cache read</th>
                <th>cache write</th>
                <th>total tokens</th>
                <th>result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.method}>
                  <td>
                    <b>{r.method}</b>
                  </td>
                  <td className="wrap">{r.model}</td>
                  <td>{r.effort}</td>
                  <td>
                    <b>{secs(r.ms)}</b>
                  </td>
                  <td className="muted wrap">{r.parts}</td>
                  <td>{r.calls}</td>
                  <td>{r.tools}</td>
                  <td>{r.tokens.input.toLocaleString()}</td>
                  <td>{r.tokens.output.toLocaleString()}</td>
                  <td>{r.tokens.cache_read.toLocaleString()}</td>
                  <td>{r.tokens.cache_write.toLocaleString()}</td>
                  <td>
                    <b>{tok(r.tokens).toLocaleString()}</b>
                  </td>
                  <td className="muted wrap">{r.found}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
