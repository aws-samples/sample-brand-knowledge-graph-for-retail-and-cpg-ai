// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ReactNode } from 'react';

/**
 * The retriever tab's reading aids, so a stage is not one wall of black text: the lead sentence
 * (what this step does), "What to notice" (the takeaway), "Good to know" (a side fact), "Your
 * turn" (the participant does something), "In CPG" (the same point in another aisle: retail and
 * CPG, curatorial only), and a numbered sub-step heading.
 */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="rt-lead">{children}</p>;
}

export function Notice({ title = 'What to notice', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rt-box rt-notice" role="note">
      <div className="rt-box-title">{title}</div>
      {children}
    </div>
  );
}

export function GoodToKnow({ title = 'Good to know', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rt-box rt-know" role="note">
      <div className="rt-box-title">{title}</div>
      {children}
    </div>
  );
}

export function YourTurn({ title = 'Your turn', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rt-box rt-turn">
      <div className="rt-box-title">{title}</div>
      {children}
    </div>
  );
}

export function InCpg({ title = 'In CPG', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rt-box rt-cpg" role="note">
      <div className="rt-box-title">{title}</div>
      {children}
    </div>
  );
}

export function SubStep({ n, children }: { n: string; children: ReactNode }) {
  return (
    <h4 className="rt-substep">
      <span className="rt-substep-n">{n}</span>
      {children}
    </h4>
  );
}
