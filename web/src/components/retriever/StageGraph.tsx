// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type GraphColumn, type RetrieverAnchors, type RetrieverTemplates, type RetrieverTraversal } from '../../api';
import { Busy, FeaturedLooks, GraphReceipts, runInto, type Async } from '../payoff/parts';
import { useKept } from '../shared/kept';
import { GoodToKnow, Lead, Notice, SubStep, YourTurn } from './Callouts';
import { stageKey } from './keys';
import { RetrievalResult } from './RetrievalResult';
import { RetrieverHowItWorks } from './RetrieverArchitecture';
import { WayIn } from './WayIn';

const IDLE = { status: 'idle' } as const;

function cell(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v === null || v === undefined) return '';
  return String(v);
}

function Preview({ t }: { t: RetrieverTraversal }) {
  const rows = t.preview.slice(0, 10);
  return (
    <div className="table-wrap">
      <table className="rt-table">
        <thead>
          <tr>
            {t.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {t.columns.map((c) => (
                <td key={c}>{cell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.rows > rows.length && <p className="muted small">the first {rows.length} of {t.rows} rows</p>}
    </div>
  );
}

/** Where stage 4 stands: not run yet, run but nothing to count (no garment worn with the starting garments), or ready for stage 5. */
export function walkState(walked: RetrieverTraversal | null): 'none' | 'empty' | 'ready' {
  if (!walked) return 'none';
  return walked.categories.length > 0 ? 'ready' : 'empty';
}

/**
 * GraphRAG's state across its three stages (the starting garments, the traversal, the answer): the starting garments,
 * the traversal's result, the answer. The traversal is the API's (`templates.traversal`), shown
 * read-only. All three are kept across tab switches and reloads; a new question starts them over
 * (BuildRetriever forgets the stages).
 */
export function useGraphRetriever(question: string, domain: string) {
  const [templates, setTemplates] = useState<RetrieverTemplates | null>(null);
  const [templatesError, setTemplatesError] = useState('');
  const [anchors, setAnchors] = useKept<Async<RetrieverAnchors>>(stageKey(domain, 'graph.anchors'), IDLE);
  const [walk, setWalk] = useKept<Async<RetrieverTraversal>>(stageKey(domain, 'graph.walk'), IDLE);
  const [answer, setAnswer] = useKept<Async<GraphColumn>>(stageKey(domain, 'graph.answer'), IDLE);
  const [finishedAt, setFinishedAt] = useState<number>();
  useEffect(() => {
    api
      .retrieverTemplates()
      .then(setTemplates)
      .catch((e) => setTemplatesError(e instanceof Error ? e.message : String(e)));
  }, []);
  const ids = anchors.status === 'done' ? anchors.value.garments.map((g) => g.id) : [];
  const walked = walk.status === 'done' ? walk.value : null;
  const state = walkState(walked);
  const cypher = templates?.traversal ?? '';
  return {
    question,
    templates,
    templatesError,
    anchors,
    findWayIn: () => runInto(setAnchors, () => api.retrieverAnchors(question)),
    ids,
    cypher,
    walk,
    walked,
    runWalk: () => runInto(setWalk, () => api.retrieverTraverse(ids, cypher)),
    state,
    /** the traversal in the box ran and returned what can be counted: garments worn with the starting garments, with their kind */
    ready: state === 'ready',
    answer,
    runAnswer: async () => {
      if (await runInto(setAnswer, () => api.retrieverGraphrag(question, cypher))) {
        setFinishedAt(Date.now());
        return true;
      }
      return false;
    },
    finishedAt,
    running: anchors.status === 'running' || walk.status === 'running' || answer.status === 'running',
  };
}
export type GraphRetriever = ReturnType<typeof useGraphRetriever>;

/** Stage 3: the starting garments. Vector search on the graph's garments finds where to start. */
export function StageWayIn({ g }: { g: GraphRetriever }) {
  return (
    <div className="rt-stage-body">
      <Lead>
        Now the brand&apos;s taste. The graph holds the <b>brand&apos;s looks</b>, decomposed from its own look photos: each look, the garments in it, and its occasion. No products. GraphRAG uses vector
        search to find the <b>starting garments</b>, then walks the relationships.
      </Lead>
      <WayIn question={g.question} templates={g.templates} anchors={g.anchors} onRun={g.findWayIn} />
    </div>
  );
}

/** Stage 4: the walk. The traversal from the starting garments, read-only: run it and see it counted. */
export function StageWalk({ g }: { g: GraphRetriever }) {
  const t = g.walked;
  return (
    <div className="rt-stage-body">
      <YourTurn title="Your turn: run the traversal">
        <p>
          The traversal below begins at the starting garments (<code>$anchors</code>), finds every look they are in, then walks to the other garments of those looks, with their kind and details, and each
          look&apos;s occasion. Read it, then choose <b>Run the traversal</b>.
        </p>
      </YourTurn>
      {g.templatesError && <p className="error">Could not load the traversal: {g.templatesError}. Reload the page to try again.</p>}
      <textarea className="code rt-cypher" rows={9} value={g.cypher} readOnly spellCheck={false} aria-label="the traversal, openCypher (read-only)" />
      <div className="row rt-buttons">
        <button onClick={g.runWalk} disabled={!g.ids.length || !g.cypher || g.walk.status === 'running'} title={g.ids.length ? '' : 'find the starting garments first (stage 3)'}>
          Run the traversal
        </button>
      </div>
      <GoodToKnow>Read-only: the graph refuses a write.</GoodToKnow>
      <Busy state={g.walk} text="Walking the graph…" />
      {t && (
        <>
          <p className="small">
            <b>{t.looks.length}</b> looks, <b>{t.rows}</b> rows in {t.metrics.traverse_ms} ms.
          </p>
          <details className="rt-raw xp">
            <summary>
              The rows it returned
              <span className="xp-hint">{t.rows} rows, the first 10 shown</span>
            </summary>
            <Preview t={t} />
          </details>
        </>
      )}

      <SubStep n="Σ">What the traversal found, counted</SubStep>
      {!t && <p className="muted small">Run the traversal first.</p>}
      {t && !g.ready && <p className="muted small">Nothing to count: no look wears other garments with the starting garments.</p>}
      {t && g.ready && (
        <>
          <p className="small">
            Occasion: <b>{t.occasion.map((o) => `${o.name} ${o.count}/${t.looks.length}`).join(' · ')}</b>
          </p>
          <table className="rt-table">
            <thead>
              <tr>
                <th>worn with</th>
                <th>in looks</th>
                <th>colors</th>
                <th>details</th>
                <th>a typical one</th>
              </tr>
            </thead>
            <tbody>
              {t.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <b>{c.count}</b> of {t.looks.length}
                  </td>
                  <td>{c.colors.join(', ')}</td>
                  <td>{c.details.join(', ')}</td>
                  <td>{c.search}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Notice>
            <p>
              Each count is a number of distinct looks, not of rows or garments: &ldquo;shoe 3 of 5&rdquo; means 3 of the 5 looks have a shoe worn with the starting garments, however many shoes or rows they have. The other shoe
              of a starting garment&apos;s pair is not counted. These counts are the brand&apos;s taste, from its own looks. The next stage hands them to the same catalog search as RAG.
            </p>
          </Notice>
        </>
      )}
    </div>
  );
}

/** Stage 5: the brand's taste through the same catalog search, and the answer with its sources. */
export function StageAnswer({ g, domain, onDone }: { g: GraphRetriever; domain: string; onDone: (cypher: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const pick = (n: number) => setActive(active === n ? null : n);
  const a = g.answer.status === 'done' ? g.answer.value : null;
  return (
    <div className="rt-stage-body">
      <Lead>Hand the brand&apos;s taste to the catalog, and answer.</Lead>
      <button
        onClick={async () => {
          setActive(null);
          if (await g.runAnswer()) onDone(g.cypher);
        }}
        disabled={!g.ready || g.answer.status === 'running'}
      >
        Search the catalog with the brand&apos;s taste and answer
      </button>
      <Busy state={g.answer} text="Searching the catalog with the guidance, then answering…" />
      {a && (
        <>
          <RetrievalResult
            who="GraphRAG"
            receipts={a.receipts}
            searched={
              <p className="small">
                The brand&apos;s looks: <b>{a.guidance.anchor.garments.length}</b> “{a.guidance.anchor.label}” garments by vector search, then the traversal: <b>{a.guidance.looks.length}</b> looks (
                {a.guidance.occasion.map((o) => `${o.name} ${o.count}`).join(' · ')}).
              </p>
            }
            found={
              <>
                <p className="small">
                  Three of the brand&apos;s own looks from the traversal (the most typical, one per occasion first), each piece searched in the <b>same catalog</b> as stage 2:
                </p>
                <FeaturedLooks featured={a.featured} />
              </>
            }
            answer={a.answer}
            evidence={a.evidence}
            active={active}
            onPick={pick}
            inspect={[
              ['system prompt (the same as RAG’s)', a.inspect.system],
              ['user message (the question and the evidence)', a.inspect.user],
              ['the traversal', a.guidance.traversal],
            ]}
            notice={
              <p>
                The same catalog, the same search and the same answer prompt as RAG. What changed is who chose what to look for: the brand&apos;s own looks, not the internet. Click a citation and follow its
                path in the graph below.
              </p>
            }
          />
          <GraphReceipts graph={a} domain={domain} active={active} onActive={setActive} />
        </>
      )}
      <RetrieverHowItWorks set="rt_graph" running={g.running} finishedAt={g.finishedAt} />
    </div>
  );
}
