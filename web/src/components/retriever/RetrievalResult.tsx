// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState, type ReactNode } from 'react';
import type { PayoffEvidence } from '../../api';
import { AnswerText } from '../shared/AnswerText';
import { EvidenceList, Inspect, Receipts } from '../payoff/parts';
import { Notice } from './Callouts';

/**
 * One retriever's result, laid out the same way for RAG and GraphRAG so they compare at a glance:
 * 1 what it searched for, 2 what it found, 3 the answer, 4 the evidence it was given (closed until
 * a citation is clicked), then Inspect and what to notice.
 */
export function RetrievalResult({
  who,
  receipts,
  searched,
  found,
  answer,
  evidence,
  active,
  onPick,
  inspect,
  notice,
}: {
  who: string;
  receipts: { kind: string; label: string };
  searched: ReactNode;
  found: ReactNode;
  answer: string;
  evidence: PayoffEvidence[];
  active: number | null;
  onPick: (n: number) => void;
  inspect: [string, string][];
  notice?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // a citation in the answer opens the evidence, so the highlighted line is in view
  useEffect(() => {
    if (active !== null) setOpen(true);
  }, [active]);
  return (
    <div className="rt-answer">
      <div className="po-column-head">
        <b>{who}&apos;s answer</b>
        <Receipts kind={receipts.kind} label={receipts.label} />
      </div>
      <section className="rt-result-part">
        <div className="rt-result-label">1 · What it searched for</div>
        {searched}
      </section>
      <section className="rt-result-part">
        <div className="rt-result-label">2 · What it found</div>
        {found}
      </section>
      <section className="rt-result-part">
        <div className="rt-result-label">3 · The answer</div>
        <AnswerText text={answer} active={active} onCite={onPick} />
      </section>
      <details className="rt-evidence xp" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          4 · The evidence it was given ({evidence.length} lines)
          <span className="xp-hint">opens when you click a citation</span>
        </summary>
        <EvidenceList evidence={evidence} active={active} onPick={onPick} />
      </details>
      <Inspect parts={inspect} />
      {notice && <Notice>{notice}</Notice>}
    </div>
  );
}
