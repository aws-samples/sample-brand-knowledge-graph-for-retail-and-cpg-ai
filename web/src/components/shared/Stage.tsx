// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';

/**
 * One numbered step of a tab that is a chain of steps (Build the retriever, the ingest pipeline):
 * its number (filled green once done), title and one line under it, and its content, or why it is
 * still locked.
 */
export function Stage({ n, title, sub, locked, done, children }: { n: number; title: string; sub: string; locked: string | null; done: boolean; children: ReactNode }) {
  return (
    <section className={`card rt-stage${locked ? ' rt-locked' : ''}`} aria-labelledby={`stage-${n}`}>
      <div className="rt-stage-head">
        <span className={`rt-step${done ? ' done' : ''}`}>
          {n}
          {done && <span className="sr-only"> (done)</span>}
        </span>
        <div>
          <h3 id={`stage-${n}`}>{title}</h3>
          <p className="muted small">{sub}</p>
        </div>
      </div>
      {locked ? <p className="muted small rt-locked-note">{locked}</p> : children}
    </section>
  );
}
