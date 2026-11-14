// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState } from 'react';
import { forgetKept, useKept } from '../shared/kept';
import { NextTab } from '../shared/NextTab';
import { Stage } from '../shared/Stage';
import { InCpg } from './Callouts';
import { stageKey, stagesOf, tabKey } from './keys';
import { StageBreaks } from './StageBreaks';
import { StageCatalog } from './StageCatalog';
import { StageAnswer, StageWalk, StageWayIn, useGraphRetriever } from './StageGraph';
import { StageRag } from './StageRag';

const QUESTIONS = ['What should I wear with white sneakers?', 'What goes with a black blazer?', 'What do I wear with wide-leg trousers?'];

/** What the question asks about, for stage 1's search box: "What goes with a black blazer?" ->
 * "black blazer"; a question without "with …" is searched as it is. */
export function subjectOf(question: string): string {
  const m = /\bwith\s+(?:a\s+|an\s+|the\s+|my\s+|some\s+)?([^?.!]+)/i.exec(question);
  return (m ? m[1] : question).replace(/[?.!\s]+$/, '').trim() || question;
}

/**
 * "Build the retriever": the catalog (a vector store of products), RAG on it, GraphRAG with the
 * participant's own traversal, then where that simple version breaks and the smart one. Each
 * stage unlocks when the one before it has run; changing the question restarts stages 2 to 5
 * (GraphRAG is three of them: the way in, the traversal, the answer; useGraphRetriever). All of it
 * is kept across tab switches and reloads (keys.ts), so an answer is still there when you return.
 * The three answers side by side are the next tab, "Same question, three answers" (AskStylist).
 */
export function BuildRetriever({ domain }: { domain: string }) {
  // the question, every stage and what unlocks the next are kept across tab switches and reloads (keys.ts)
  const [question, setQuestion] = useKept(tabKey(domain, 'question'), QUESTIONS[0]);
  const [draft, setDraft] = useKept(tabKey(domain, 'draft'), QUESTIONS[0]);
  const [catalogDone, setCatalogDone] = useKept(tabKey(domain, 'catalogDone'), false);
  const [searches, setSearches] = useKept<string[] | null>(stageKey(domain, 'searches'), null);
  const [cypher, setCypher] = useKept<string | null>(stageKey(domain, 'cypher'), null);
  const [breaksDone, setBreaksDone] = useKept(tabKey(domain, 'breaksDone'), false);
  const g = useGraphRetriever(question, domain);

  const [notice, setNotice] = useState('');
  const ask = (q: string) => {
    const next = q.trim();
    if (!next) return;
    setDraft(next);
    if (next !== question) {
      forgetKept(stagesOf(domain));
      setQuestion(next);
      setNotice(`Stage 1 now searches for “${subjectOf(next)}”; stages 2 to 5 use this question and start over.`);
    } else {
      setNotice('This is already the question for stages 2 to 5.');
    }
    document.getElementById('stage-1')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Build the retriever</h2>
        <p className="muted">
          Build the retrieval behind a style answer, one step at a time. You&apos;ll search the product catalog, build plain RAG on it, build GraphRAG yourself on the brand&apos;s style DNA, then see where
          your simple version breaks and how a smarter one fixes it.
        </p>
        <div className="row po-ask">
          <input className="po-question" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(draft)} aria-label="the customer's question" />
          <button onClick={() => ask(draft)} disabled={!draft.trim()}>
            Use this question
          </button>
        </div>
        <div className="row po-chips">
          {QUESTIONS.map((q) => (
            <button key={q} className={`secondary small${q === question ? ' active' : ''}`} onClick={() => ask(q)} aria-pressed={q === question}>
              {q}
            </button>
          ))}
        </div>
        <p className="small rt-current" key={question}>
          The question: <b>{question}</b> · stage 1 searches for <b>“{subjectOf(question)}”</b>
        </p>
        {notice && (
          <p className="notice small" role="status">
            {notice}{' '}
            <button className="small secondary" onClick={() => setNotice('')} aria-label="dismiss">
              ×
            </button>
          </p>
        )}
      </div>

      <Stage n={1} title="The catalog: a vector store of products" sub="What an embedding is, and what similarity search returns." locked={null} done={catalogDone}>
        <StageCatalog domain={domain} subject={subjectOf(question)} onDone={() => setCatalogDone(true)} />
      </Stage>

      <Stage n={2} title="RAG: real products, the model's taste" sub="The model plans catalog searches from its own knowledge." locked={catalogDone ? null : 'Run a catalog search in stage 1 first.'} done={!!searches}>
        <StageRag domain={domain} question={question} onDone={setSearches} />
      </Stage>

      <Stage n={3} title="GraphRAG, the way in: vector search on the graph" sub="Find the garments in the brand's looks that the question is about." locked={searches ? null : 'Get a RAG answer in stage 2 first.'} done={g.anchors.status === 'done'}>
        <StageWayIn g={g} />
      </Stage>

      <Stage n={4} title="Walk the graph" sub="The traversal from those garments to every look and what is worn with them." locked={g.anchors.status === 'done' ? null : 'Find the way in in stage 3 first.'} done={g.ready}>
        <StageWalk g={g} />
      </Stage>

      <Stage n={5} title="GraphRAG's answer, with receipts" sub="The brand's taste through the same catalog search as RAG." locked={g.ready ? null : 'Run the traversal in stage 4 first.'} done={!!cypher}>
        <StageAnswer g={g} domain={domain} onDone={setCypher} />
        <InCpg>
          <p>
            &ldquo;What goes with this vitamin C serum?&rdquo; takes the same way in (the closest products in the brand&apos;s regimens) and the same walk (every regimen it is in, and what else is in
            them). A catalog search alone would return more serums.
          </p>
        </InCpg>
      </Stage>

      <Stage n={6} title="Where it breaks, and the fix" sub="A question with two pieces and a color: your retriever, then a smarter one." locked={cypher ? null : 'Get a GraphRAG answer in stage 5 first.'} done={breaksDone}>
        <StageBreaks domain={domain} onDone={() => setBreaksDone(true)} />
      </Stage>
      <NextTab to="stylist">
        <p>
          Ask the white sneakers question from tab 0 again, and see three answers side by side (the model on its own, RAG, and GraphRAG with the smart retriever), with the receipts behind each.
        </p>
      </NextTab>
    </div>
  );
}
