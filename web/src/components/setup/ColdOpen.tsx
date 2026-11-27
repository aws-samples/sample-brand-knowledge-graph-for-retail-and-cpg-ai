// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { api, type LlmColumn } from '../../api';
import { AnswerText } from '../shared/AnswerText';
import { useKept } from '../shared/kept';
import { Inspect } from '../payoff/parts';
import { Lead, Notice, YourTurn } from '../retriever/Callouts';

/** The question the workshop starts with, and asks again three ways in tab 5. */
export const COLD_OPEN_QUESTION = 'What should I wear with white sneakers?';

/** Shown only when the model cannot be reached, marked as an example. */
export const EXAMPLE_ANSWER =
  'White sneakers work best with outfits that echo their clean, casual feel. Try them with straight or slim jeans and a crisp white tee, with a casual summer dress, or with chinos and an oxford shirt for smart casual. Keep the rest of the look simple so the sneakers stay the fresh, easy note.';

type Kept = { answer: LlmColumn } | { example: string };
const RESULT_KEY = 'coldOpen.result';
const ASKING_KEY = 'coldOpen.asking';
const IDLE = { status: 'idle' } as const;

/** The answer kept for this browser tab's session (kept.ts), if the question was asked already. */
export function useColdOpen(): [Kept | null, (next: Kept | null) => void] {
  return useKept<Kept | null>(RESULT_KEY, null);
}

/**
 * Tab 0's step 1, the cold open: the shopper's question, asked to a model on its own (the same
 * call as tab 5's first column, `POST /api/retriever/llm`), then what to notice. The answer is
 * kept (kept.ts), so it is still there after a visit to another tab or a reload; come back while
 * the model still answers, and the step says "Asking…" until the answer lands.
 */
export function ColdOpen() {
  const [result, setResult] = useColdOpen();
  const [asking, setAsking] = useKept<{ status: 'idle' | 'running' }>(ASKING_KEY, IDLE);
  const busy = asking.status === 'running';

  const ask = async () => {
    setAsking({ status: 'running' });
    let next: Kept;
    try {
      next = { answer: await api.retrieverLlm(COLD_OPEN_QUESTION) };
    } catch (e) {
      next = { example: e instanceof Error ? e.message : String(e) };
    }
    setResult(next);
    setAsking(IDLE);
  };

  const answer = result && 'answer' in result ? result.answer : null;
  return (
    <>
      <Lead>
        A shopper asks: <b>&ldquo;{COLD_OPEN_QUESTION}&rdquo;</b> Ask a model on its own, with no brand data and no search.
      </Lead>
      <YourTurn>
        <p>
          Choose <b>Ask a model on its own</b>.
        </p>
      </YourTurn>
      <div className="row">
        <button type="button" onClick={ask} disabled={busy}>
          {busy ? 'Asking…' : result ? 'Ask again' : 'Ask a model on its own'}
        </button>
        {answer && <span className="muted small">answered in {(answer.metrics.ms / 1000).toFixed(1)} s</span>}
      </div>

      {result && (
        <>
          {answer ? (
            <div className="cold-open-answer">
              <AnswerText text={answer.answer} active={null} onCite={() => undefined} />
            </div>
          ) : (
            <div className="cold-open-answer">
              <p className="muted small">The model could not be reached just now, so here is an example answer from an earlier run. Try again in a moment.</p>
              <AnswerText text={EXAMPLE_ANSWER} active={null} onCite={() => undefined} />
            </div>
          )}
          <Notice>
            <p>
              The answer sounds sure of itself, but it is <b>one point of view, stated as fact, with no source</b>. Any brand would get the same list. No stylist chose these
              pieces, and you cannot check any of it.
            </p>
          </Notice>
          {answer && (
            <Inspect
              title="Inspect: exactly what the model was given"
              parts={[
                ['system prompt', answer.inspect.system],
                ['user message', answer.inspect.user],
                ['the reply', answer.answer],
              ]}
            />
          )}
        </>
      )}
    </>
  );
}
