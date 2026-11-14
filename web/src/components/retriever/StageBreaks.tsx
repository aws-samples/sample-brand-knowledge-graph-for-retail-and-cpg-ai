// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState } from 'react';
import { api, type GraphColumn } from '../../api';
import { AnswerText } from '../shared/AnswerText';
import { useKept } from '../shared/kept';
import { Busy, EvidenceList, GraphReceipts, Inspect, runInto, type Async } from '../payoff/parts';
import { GoodToKnow, Lead, Notice } from './Callouts';
import { tabKey } from './keys';
import { SmartSteps } from './SmartSteps';

type Side = 'simple' | 'smart';

const HARD_QUESTION = 'What sneakers go with a blue pleated midi dress?';
const IDLE = { status: 'idle' } as const;

function simpleSummary(g: GraphColumn): string {
  const a = g.guidance.anchor;
  const types = a.types ? Object.entries(a.types).map(([c, n]) => `${n} ${c}`).join(', ') : '';
  return `Started from ${a.garments.length} garments${types ? ` (${types})` : ''}, which led to ${g.guidance.looks.length} looks.`;
}

/** What was sent to the model for the answer: the same prompt for both versions, different evidence. */
function AnswerInspect({ g }: { g: GraphColumn }) {
  return (
    <Inspect
      title="Inspect: exactly what the model was given for the answer"
      parts={[
        ['system prompt', g.inspect.system],
        ['user message (the question and the evidence)', g.inspect.user],
        ['the traversal (openCypher)', g.guidance.traversal],
      ]}
    />
  );
}

/** What the smart version adds to the simple one: two model calls and one filter, each as it ran. */
export function WhatChanged({ g }: { g: GraphColumn }) {
  const parts: [string, string][] = [];
  if (g.plan_inspect) {
    parts.push(['1 · Read the question: the prompt', g.plan_inspect.system], ['1 · what was sent', g.plan_inspect.user], ['1 · what the model replied', g.plan_inspect.reply]);
  }
  (g.starts ?? []).forEach((s, i) => {
    const tag = (g.starts?.length ?? 0) > 1 ? ` (“${s.text}”)` : '';
    if (s.inspect) {
      if (i === 0) parts.push(['2 · Grade the closest garments: the prompt', s.inspect.system]);
      parts.push([`2 · what was sent${tag}`, s.inspect.user], [`2 · what the model replied${tag}`, s.inspect.reply]);
    }
    if (s.query) parts.push([`2 · the vector search that found them${tag}`, s.query]);
  });
  if (g.target_rule) parts.push(['3 · Keep only what is looked for', g.target_rule]);
  return (
    <Notice title="What made it smarter">
      <ol className="rt-changed-list">
        <li>
          <b>A model call reads the question</b> before anything is searched: what to start from, what you&apos;re looking for, what must match.
        </li>
        <li>
          <b>A model call grades the closest garments</b> as exact, similar or no. Vector search still finds them; the app starts from the exact ones, or the similar ones when there&apos;s no exact match.
        </li>
        {g.target_rule && (
          <li>
            <b>One filter after the traversal</b> keeps only the pieces you asked for.
          </li>
        )}
      </ol>
      <p>Everything else is your version: the same vector search, traversal, catalog search and answer prompt.</p>
      {parts.length > 0 ? (
        <Inspect title="Inspect: the two new model calls and the filter" parts={parts} />
      ) : (
        <p className="small muted">The API is older than this page: restart it to see the prompts and replies here.</p>
      )}
    </Notice>
  );
}

/**
 * The retriever tab's last stage: a question the simple retriever can't handle (two pieces and a
 * color), run with the simple version and then with the smart one, side by side: the answers with
 * their evidence, what each sent to the model, what the smart one adds, and both graphs below.
 */
export function StageBreaks({ domain, onDone }: { domain: string; onDone: () => void }) {
  // the question, both answers and the graph shown are kept across tab switches and reloads (keys.ts)
  const [question, setQuestion] = useKept(tabKey(domain, 'breaks.question'), HARD_QUESTION);
  const [simple, setSimple] = useKept<Async<GraphColumn>>(tabKey(domain, 'breaks.simple'), IDLE);
  const [smart, setSmart] = useKept<Async<GraphColumn>>(tabKey(domain, 'breaks.smart'), IDLE);
  const [cite, setCite] = useState<Record<Side, number | null>>({ simple: null, smart: null });
  // one graph under the two columns: the version asked last, or the one a citation was clicked in
  const [shown, setShown] = useKept<Side>(tabKey(domain, 'breaks.shown'), 'simple');
  // a citation in the answer or a number in the list selects that evidence line; again clears it
  const pick = (side: Side) => (n: number) => {
    setShown(side);
    setCite((c) => ({ ...c, [side]: c[side] === n ? null : n }));
  };
  const select = (side: Side) => (n: number | null) => setCite((c) => ({ ...c, [side]: n }));
  const graphs: Record<Side, GraphColumn | null> = {
    simple: simple.status === 'done' ? simple.value : null,
    smart: smart.status === 'done' ? smart.value : null,
  };
  const graph = graphs[shown] ?? graphs.simple ?? graphs.smart;
  const graphSide: Side = graphs[shown] ? shown : graphs.simple ? 'simple' : 'smart';

  return (
    <div className="rt-stage-body">
      <Lead>Your retriever starts from whatever is closest to the whole question. That works when the question is about one piece. Try one that names two pieces and a color.</Lead>
      <div className="row po-ask">
        <input className="po-question" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="a harder question" />
      </div>

      <div className="po-grid rt-breaks">
        <div className="card po-column">
          <h4>The simple version (yours)</h4>
          <button
            onClick={async () => {
              if (await runInto(setSimple, () => api.retrieverGraphrag(question, ''))) setShown('simple');
            }}
            disabled={!question.trim() || simple.status === 'running'}
          >
            Ask the simple version
          </button>
          <Busy state={simple} text="Searching the graph and answering…" />
          {simple.status === 'done' && (
            <>
              <p className="small">{simpleSummary(simple.value)}</p>
              {question === HARD_QUESTION && (
                <Notice title="What went wrong">
                  <p>
                    The question mentions sneakers and a pleated midi dress, so the search started from sneakers, dresses and skirts all at once. And it can&apos;t look for just sneakers.
                  </p>
                </Notice>
              )}
              <AnswerText text={simple.value.answer} active={cite.simple} onCite={pick('simple')} />
              <h4>Evidence</h4>
              <EvidenceList evidence={simple.value.evidence} active={cite.simple} onPick={pick('simple')} />
              <AnswerInspect g={simple.value} />
            </>
          )}
        </div>

        <div className="card po-column">
          <h4>The smart version</h4>
          <button
            onClick={async () => {
              if (await runInto(setSmart, () => api.retrieverSmart(question))) {
                setShown('smart');
                onDone();
              }
            }}
            disabled={!question.trim() || smart.status === 'running'}
          >
            Ask the smart version
          </button>
          <Busy state={smart} text="Reading the question, searching the graph, answering…" />
          {smart.status === 'done' && (
            <>
              <SmartSteps graph={smart.value} />
              <AnswerText text={smart.value.answer} active={cite.smart} onCite={pick('smart')} />
              <h4>Evidence</h4>
              <EvidenceList evidence={smart.value.evidence} active={cite.smart} onPick={pick('smart')} />
              <WhatChanged g={smart.value} />
              <AnswerInspect g={smart.value} />
            </>
          )}
        </div>
      </div>

      {graph && (
        <>
          <div className="row rt-graph-switch" role="group" aria-label="whose graph to show">
            <span className="small">The graph:</span>
            {(['simple', 'smart'] as Side[]).map((side) => (
              <button key={side} className={`small${graphSide === side ? '' : ' secondary'}`} aria-pressed={graphSide === side} disabled={!graphs[side]} onClick={() => setShown(side)}>
                {side === 'simple' ? 'Simple version' : 'Smart version'}
              </button>
            ))}
          </div>
          <GraphReceipts
            key={graphSide}
            graph={graph}
            domain={domain}
            active={cite[graphSide]}
            onActive={select(graphSide)}
            title={`The ${graphSide} version's graph: what it started from, the looks, what it found`}
          />
        </>
      )}

      <GoodToKnow>
        <p>The next tab, “Same question, three answers”, uses the smart version.</p>
      </GoodToKnow>
    </div>
  );
}
