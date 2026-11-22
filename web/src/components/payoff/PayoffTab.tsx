// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, type ReactNode } from 'react';
import type { PayoffResult } from '../../api';
import { AnswerText } from '../shared/AnswerText';
import { Notice } from '../retriever/Callouts';
import { SmartSteps } from '../retriever/SmartSteps';
import { Chips, EvidenceList, FeaturedLooks, GraphReceipts, Inspect, Receipts } from './parts';
import { PhotoSteps } from './PhotoSteps';

type ColumnKey = 'llm' | 'rag' | 'graph';
// Who chose what each column suggests: the one difference that matters, shown first in every column.
const HEAD: Record<ColumnKey, { title: string; who: string; how: string }> = {
  llm: {
    title: 'LLM only',
    who: "The model's own taste",
    how: 'No retrieval. The model answers from what it learned online: no products, nothing to check.',
  },
  rag: {
    title: 'RAG',
    who: "The model's own taste, on real products",
    how: 'The model made up its searches from its own taste, then the catalog found real products for them. No one at the brand chose these, and nothing says they go together.',
  },
  graph: {
    title: 'GraphRAG',
    who: "The brand's own looks",
    how: "The brand's stylists chose these pairings: every suggestion comes from one of its looks, then the same catalog search finds the products.",
  },
};

/** One numbered part of a column, set off from the next by a rule and a label. */
function Section({ n, label, hint, children }: { n: number; label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="po-sec">
      <div className="po-sec-label">
        <span className="po-sec-n">{n}</span>
        {label}
        {hint && <span className="xp-hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The payoff: one question three ways, side by side, each with its sources, then GraphRAG's tree.
 * `photo`: the shopper's photo when the question came with one (Style recommendation).
 */
export function PayoffView({ result, domain, photo = null }: { result: PayoffResult; domain: string; photo?: string | null }) {
  const [active, setActive] = useState<Record<ColumnKey, number | null>>({ llm: null, rag: null, graph: null });
  const cite = (k: ColumnKey) => (n: number) => setActive((a) => ({ ...a, [k]: a[k] === n ? null : n }));
  const graph = result.columns.graph;
  return (
    <>
      <div className="po-grid">
        {(['llm', 'rag', 'graph'] as ColumnKey[]).map((k) => {
          const c = result.columns[k];
          return (
            <div key={k} className={`card po-column po-column-${k}`}>
              <div className="po-column-head">
                <h3>{HEAD[k].title}</h3>
                <Receipts kind={c.receipts.kind} label={c.receipts.label} />
              </div>
              <div className={`po-who po-who-${k}`}>
                <div className="po-who-label">Who chose what to suggest</div>
                <b>{HEAD[k].who}</b>
                <p>{HEAD[k].how}</p>
              </div>
              <Section n={1} label="The answer">
                <AnswerText text={c.answer} active={active[k]} onCite={cite(k)} />
              </Section>
              {k === 'llm' && (
                <Section n={2} label="Where it came from">
                  <p className="po-noreceipts">Nothing to show: no source behind any of it.</p>
                </Section>
              )}
              {k === 'rag' && (
                <>
                  <Section n={2} label="The searches the model made up, from its own taste">
                    <Chips items={result.columns.rag.plan.searches} />
                    <p className="small muted">No stylist or merchandiser at the brand chose these searches.</p>
                  </Section>
                  <Section n={3} label="What the catalog returned" hint="the evidence the answer cites">
                    <EvidenceList evidence={c.evidence} active={active.rag} onPick={cite('rag')} />
                  </Section>
                </>
              )}
              {k === 'graph' && (
                <>
                  <Section n={2} label="What the brand's looks say">
                    {graph.photo_way_in ? (
                      <PhotoSteps graph={graph} photo={photo} />
                    ) : graph.smart ? (
                      <SmartSteps graph={graph} />
                    ) : (
                      <p className="small">
                        <b>{graph.guidance.anchor.garments.length}</b> “{graph.guidance.anchor.label}” garments by vector search → <b>{graph.guidance.looks.length}</b> looks
                      </p>
                    )}
                    <p className="small">Occasions: {graph.guidance.occasion.map((o) => `${o.name} ${o.count}`).join(' · ')}</p>
                  </Section>
                  <Section n={3} label="Three of the brand's looks, matched to the catalog">
                    <FeaturedLooks featured={graph.featured} />
                  </Section>
                  <Section n={4} label="The evidence it was given" hint="the lines the answer cites">
                    <EvidenceList evidence={c.evidence} active={active.graph} onPick={cite('graph')} />
                  </Section>
                </>
              )}
              <Inspect
                title="Inspect: exactly what the model was given"
                parts={[
                  ...(k === 'rag' ? ([['search planner prompt', result.columns.rag.inspect.planner_system]] as [string, string][]) : []),
                  ['system prompt', c.inspect.system],
                  ['user message (the question and the evidence)', c.inspect.user],
                  ...(k === 'graph' ? ([['the traversal (openCypher)', graph.guidance.traversal]] as [string, string][]) : []),
                ]}
              />
            </div>
          );
        })}
      </div>
      <Notice>
        <p>
          RAG and GraphRAG can suggest similar products: both search the same catalog. The difference is <b>who chose what to look for</b>. RAG&apos;s searches come from the model&apos;s own taste, the
          internet&apos;s average, so nothing says the brand&apos;s merchandisers would ever pair them. GraphRAG&apos;s come from the brand&apos;s own looks, and it can show you which ones.
        </p>
        {result.input === 'photo' && (
          <p>
            All three saw the same photo. GraphRAG&apos;s step 2 shows how the photo found the starting garments: no description, no words. The photo&apos;s own embedding went into the same vector search a question
            uses, and from there everything ran exactly as before.
          </p>
        )}
      </Notice>
      <GraphReceipts graph={graph} domain={domain} active={active.graph} onActive={(n) => setActive((a) => ({ ...a, graph: n }))} />
    </>
  );
}
