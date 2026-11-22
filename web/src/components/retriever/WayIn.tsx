// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { RetrieverAnchors, RetrieverTemplates } from '../../api';
import { Busy, type Async } from '../payoff/parts';
import { GoodToKnow, Notice } from './Callouts';
import { Vector } from './StageCatalog';

/**
 * Stage 3a, the starting garments: what the button does, in three steps, each with its result once it ran.
 * (1) the question becomes a vector, (2) one openCypher call finds the nearest garments in Neptune
 * Analytics' vector index (the query is shown before and after it runs), (3) the API picks the
 * garments to start from.
 */
export function WayIn({ question, templates, anchors, onRun }: { question: string; templates: RetrieverTemplates | null; anchors: Async<RetrieverAnchors>; onRun: () => void }) {
  const a = anchors.status === 'done' ? anchors.value : null;
  const p = templates?.anchor;
  const ids = new Set(a?.garments.map((g) => g.id) ?? []);
  return (
    <>
      <p>
        GraphRAG starts by finding the garments in the graph that match your question. It&apos;s a vector search, like stage 1, but on the garments in the brand&apos;s looks instead of the product catalog.
        The button runs three steps:
      </p>

      <ol className="rt-under">
        <li>
          <b>Turn the question into a vector</b>
          <p className="small">
            Amazon Bedrock turns “{question}” into a list of numbers. It uses the same model that was used for every garment in the graph, so similar meanings end up close together.
          </p>
          {a && <Vector v={a.vector} />}
        </li>
        <li>
          <b>Find the closest garments</b>
          <p className="small">
            Neptune Analytics searches its vector index for the {p?.candidates ?? 60} garments closest to that vector. This is the query it runs:
          </p>
          <pre className="code-block rt-query">{a?.query ?? templates?.anchor_query ?? 'Loading the query…'}</pre>
          <GoodToKnow>
            <p>
              <code>vertexFilter</code> limits the search to garments. A lower <code>score</code> means a closer match. The vector is pasted into the query because Neptune doesn&apos;t accept it as a
              parameter.
            </p>
          </GoodToKnow>
          {a && (
            <>
              <p className="small">The {a.candidates.length} closest:</p>
              <table className="rt-table">
                <thead>
                  <tr>
                    <th>garment</th>
                    <th>type</th>
                    <th title="lower is closer">score</th>
                    <th>in a look</th>
                  </tr>
                </thead>
                <tbody>
                  {a.candidates.map((c) => (
                    <tr key={c.id} className={ids.has(c.id) ? 'rt-anchor' : 'rt-not-anchor'}>
                      <td>{c.name}</td>
                      <td>{c.category}</td>
                      <td>{c.distance}</td>
                      <td>{c.in_look ? 'yes' : <span title="in the graph from an article, worn in no look: the traversal could not start here">no</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </li>
        <li>
          <b>Keep the closest ones</b>
          <p className="small">
            The app keeps every garment that is almost as close as the best match (a score within {p?.band ?? 0.1} of it), whatever its type, as long as a look wears it: stage 4 starts at the
            looks of the starting garments, so a garment in no look leads nowhere.
          </p>
          <Notice>
            <p>
              This is semantic search: it matches meaning, not exact words. Ask about a black blazer and you also get grey blazers, and a black top worn under a blazer. That&apos;s fine here: those come
              from looks that have a blazer too.
            </p>
          </Notice>
          {a && (
            <Notice title="Result">
              <p>
                <b>{a.garments.length}</b> garments to start from (highlighted above)
                {a.types && Object.keys(a.types).length > 1 && <>: {Object.entries(a.types).map(([c, n]) => `${n} ${c}`).join(', ')}</>}. Stage 4 walks the graph from these.
                {a.unworn > 0 && (
                  <>
                    {' '}
                    <b>{a.unworn}</b> of the closest garments {a.unworn === 1 ? 'was' : 'were'} skipped: an article tab 2 ingested put {a.unworn === 1 ? 'it' : 'them'} in the graph, but no look wears{' '}
                    {a.unworn === 1 ? 'it' : 'them'}.
                  </>
                )}
              </p>
            </Notice>
          )}
        </li>
      </ol>

      <button onClick={onRun} disabled={anchors.status === 'running'}>
        Find the starting garments
      </button>
      <Busy state={anchors} text="Searching the graph…" />
    </>
  );
}
