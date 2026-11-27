// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { GraphColumn, SmartGrade } from '../../api';

const MARK: Record<SmartGrade, string> = { exact: 'exact', similar: 'similar', no: '' };

/**
 * What the smart retriever did, in plain steps: how the model read the question, how it graded
 * the closest garments for each start piece and which ones it started from, the looks the same
 * traversal found, what the filter kept and dropped, and what the lookbook did not have. Used in
 * "Where it breaks" and in tab 5, "Compare GraphRAG with traditional methods".
 */
export function SmartSteps({ graph }: { graph: GraphColumn }) {
  if (!graph.smart || !graph.plan || !graph.starts) return null;
  const { plan, starts, target } = graph;
  const looks = graph.guidance.looks.length;
  return (
    <ol className="small rt-under">
      <li>
        <b>The model read the question.</b> Start from: <b>{plan.start.join(', ')}</b>
        {plan.find && (
          <>
            {' '}
            · Looking for: <b>{plan.find}</b>
          </>
        )}
        {plan.must.length > 0 && (
          <>
            {' '}
            · Must be: <b>{plan.must.join(', ')}</b>
          </>
        )}
      </li>
      {starts.map((s) => {
        const kept = new Set(s.kept);
        const count = (g: SmartGrade) => Object.values(s.grades ?? {}).filter((x) => x === g).length;
        return (
          <li key={s.text}>
            <b>
              Vector search found the {s.candidates.length} closest to “{s.text}”, and the model graded each one.
            </b>{' '}
            {s.grades && (
              <>
                {count('exact')} exact, {count('similar')} similar.{' '}
              </>
            )}
            {s.exact ? 'It starts from the exact matches.' : 'No exact match, so it starts from the similar ones.'}
            <ul className="rt-kept">
              {s.candidates.map((c) => {
                const grade = s.grades?.[c.id];
                return (
                  <li key={c.id} className={kept.has(c.id) ? 'rt-anchor' : 'rt-not-anchor'}>
                    {kept.has(c.id) ? '✓ ' : ''}
                    {c.name}
                    {grade && MARK[grade] && <span className="muted"> · {MARK[grade]}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
      <li>
        {target ? (
          <>
            <b>The same traversal</b> from those garments: <b>{target.looks_before}</b> look{target.looks_before === 1 ? '' : 's'}. Keeping only the ones with {target.find}: <b>{target.looks_after}</b>.
            {target.dropped.length > 0 && <span className="muted"> The other {target.dropped.length} have no {target.find}.</span>}
          </>
        ) : (
          <>
            <b>The same traversal</b> from those garments: <b>{looks}</b> look{looks === 1 ? '' : 's'}.
          </>
        )}
      </li>
      {(graph.notes ?? []).length > 0 && (
        <li>
          <b>Told the model:</b> {graph.notes!.join(' ')}
        </li>
      )}
    </ol>
  );
}
