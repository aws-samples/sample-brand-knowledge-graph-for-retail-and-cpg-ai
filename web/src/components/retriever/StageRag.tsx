// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState } from 'react';
import { api, type RagColumn, type RetrieverPlan } from '../../api';
import { Busy, Chips, Inspect, runInto, type Async } from '../payoff/parts';
import { useKept } from '../shared/kept';
import { GoodToKnow, Lead, SubStep } from './Callouts';
import { stageKey } from './keys';
import { RetrievalResult } from './RetrievalResult';
import { RetrieverHowItWorks } from './RetrieverArchitecture';

const IDLE = { status: 'idle' } as const;

/**
 * Stage 2, RAG: the model turns the question into catalog searches from its own taste (2a, the
 * participant can edit them), the catalog returns real items, the model answers (2b). Done once
 * an answer is in; `onDone` hands back the searches that produced it.
 */
export function StageRag({ domain, question, onDone }: { domain: string; question: string; onDone: (searches: string[]) => void }) {
  // kept until the question changes (BuildRetriever forgets the stages)
  const [plan, setPlan] = useKept<Async<RetrieverPlan>>(stageKey(domain, 'rag.plan'), IDLE);
  const [searches, setSearches] = useKept(stageKey(domain, 'rag.searches'), '');
  const [answer, setAnswer] = useKept<Async<RagColumn>>(stageKey(domain, 'rag.answer'), IDLE);
  const [active, setActive] = useState<number | null>(null);

  const runPlan = async () => {
    const p = await runInto(setPlan, () => api.retrieverPlan(question));
    if (p) setSearches(p.searches.join('\n'));
  };
  const list = searches
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const [finished, setFinished] = useState<number>();
  const runAnswer = async () => {
    setActive(null);
    if (await runInto(setAnswer, () => api.retrieverRag(question, list))) {
      setFinished(Date.now());
      onDone(list);
    }
  };
  const pick = (n: number) => setActive(active === n ? null : n);

  return (
    <div className="rt-stage-body">
      <Lead>
        Plain RAG with a smart planner, what a good retail team ships today: the model reads the question, decides what to look for <b>from its own fashion knowledge</b>, and searches the catalog from
        stage 1 for real products.
      </Lead>

      <SubStep n="2a">The model plans the searches</SubStep>
      <button onClick={runPlan} disabled={plan.status === 'running'}>
        Plan the searches
      </button>
      <Busy state={plan} text="The model is planning…" />
      {plan.status === 'done' && (
        <>
          <p className="small">
            <b>Its reasoning:</b> {plan.value.why}
          </p>
          <label className="po-inspect-label" htmlFor="rag-searches">
            Its searches, one per line
          </label>
          <textarea id="rag-searches" className="code rt-searches" rows={Math.max(3, list.length + 1)} value={searches} onChange={(e) => setSearches(e.target.value)} spellCheck={false} />
          <GoodToKnow>Edit them if you like: this is the model&apos;s taste, not the brand&apos;s.</GoodToKnow>
          <Inspect parts={[['planner prompt', plan.value.inspect.system], ['question', plan.value.inspect.user], ['the model’s reply', plan.value.inspect.reply]]} />
        </>
      )}

      <SubStep n="2b">Search the catalog and answer</SubStep>
      <button onClick={runAnswer} disabled={!list.length || answer.status === 'running'}>
        Search the catalog and answer
      </button>
      <Busy state={answer} text="Searching the catalog, then answering…" />
      {answer.status === 'done' && (
        <RetrievalResult
          who="RAG"
          receipts={answer.value.receipts}
          searched={
            <>
              <p className="small">
                The catalog, with searches the model <b>made up from its own taste</b>. No stylist or merchandiser at the brand chose them:
              </p>
              <Chips items={answer.value.plan.searches} />
            </>
          }
          found={<p className="small">{answer.value.evidence.length} real products from the catalog, the closest to each search.</p>}
          answer={answer.value.answer}
          evidence={answer.value.evidence}
          active={active}
          onPick={pick}
          inspect={[
            ['system prompt', answer.value.inspect.system],
            ['user message (the question and the evidence)', answer.value.inspect.user],
          ]}
          notice={
            <p>
              Real products, with citations. But open a citation: it points at a <b>product</b>, which proves the item exists, not that it goes with anything. The taste that chose these searches is the
              internet&apos;s.
            </p>
          }
        />
      )}
      <RetrieverHowItWorks set="rt_rag" running={plan.status === 'running' || answer.status === 'running'} finishedAt={finished} />
    </div>
  );
}
