// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { SetupStatus } from '../../api';
import { guardrailsConsoleUrl, ReadyPill } from './setupView';

/**
 * The Amazon Bedrock guardrail the stack creates (infra/lib/guardrail.ts): what it checks, and
 * that it runs only on the model calls that carry text the participant wrote.
 */
export function GuardrailCard({ s }: { s: SetupStatus }) {
  const g = s.guardrail;
  return (
    <section className="card setup-card">
      <h3>
        Guardrail: Amazon Bedrock Guardrails <ReadyPill ok={g.configured} optional />
      </h3>
      <p className="muted">
        Checks the text you write for hate, insults, sexual content, violence, misconduct, prompt attacks and profanity, and the model&apos;s reply to it for hate,
        insults, sexual content, violence and misconduct. It runs
        only on model calls that carry your own text: a question you type, a text you upload in tab 2, the rows of a query you wrote. The app&apos;s own prompts and
        the photos are not checked. If it stops a request, the tab says so in one line.
      </p>
      {g.configured ? (
        <>
          <p>
            <code>{g.guardrail_id}</code> · version {g.version ?? 'draft'}
          </p>
          <div className="setup-actions">
            <a className="button-link" href={guardrailsConsoleUrl(s.region)} target="_blank" rel="noopener noreferrer">
              Guardrails console ↗
            </a>
          </div>
        </>
      ) : (
        <p>No guardrail is configured, so the model calls go without one. The stack creates one.</p>
      )}
    </section>
  );
}
