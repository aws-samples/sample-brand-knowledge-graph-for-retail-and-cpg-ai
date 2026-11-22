// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState } from 'react';
import { useKept } from '../shared/kept';
import { NextTab } from '../shared/NextTab';
import { api, type PayoffResult } from '../../api';
import { GoodToKnow, InCpg, Lead } from '../retriever/Callouts';
import { RetrieverHowItWorks } from '../retriever/RetrieverArchitecture';
import { Busy, runInto, type Async } from './parts';
import { PayoffView } from './PayoffTab';
import { PhotoPicker } from './PhotoPicker';

const QUESTIONS = [
  'What should I wear with white sneakers?',
  'What goes with a black blazer?',
  'What sneakers go with a blue pleated midi dress?',
  'What do I wear with wide-leg trousers?',
];
// With a photo: the question is about the piece in it.
const PHOTO_QUESTIONS = ['What goes with this?', 'Which shoes go with this?', 'Which bag goes with this?'];

type Input = 'question' | 'photo';
const START_QUESTIONS: Record<Input, string> = { question: QUESTIONS[0], photo: PHOTO_QUESTIONS[0] };
const IDLE = { status: 'idle' } as const;

/**
 * "Same question, three answers": three answers side by side (the model on its own, RAG on the
 * product catalog, GraphRAG on the brand's looks), each with its sources. The shopper asks with a
 * question, or with a photo of one piece (Style recommendation): all three see the photo, and
 * GraphRAG's starting garments come from the photo's own embedding in the same vector search.
 */
export function AskStylist({ domain }: { domain: string }) {
  // the inputs, the three answers and the photo they were asked with are kept across tab switches
  // and reloads (shared/kept.ts); a photo too large for sessionStorage survives tab switches only
  const kept = `stylist.${domain}.`;
  const [input, setInput] = useKept<Input>(`${kept}input`, 'question');
  const [questions, setQuestions] = useKept(`${kept}questions`, START_QUESTIONS);
  const [photo, setPhoto] = useKept<string | null>(`${kept}photo`, null);
  const [result, setResult] = useKept<Async<PayoffResult>>(`${kept}result`, IDLE);
  // the photo the shown answers were asked with (the picker may have moved on since)
  const [askedPhoto, setAskedPhoto] = useKept<string | null>(`${kept}askedPhoto`, null);
  const [finishedAt, setFinishedAt] = useState<number>();

  const question = questions[input];
  const setQuestion = (q: string) => setQuestions((all) => ({ ...all, [input]: q }));
  const withPhoto = input === 'photo';
  const ready = !!question.trim() && (!withPhoto || !!photo) && result.status !== 'running';
  const chips = withPhoto ? PHOTO_QUESTIONS : QUESTIONS;

  const ask = async () => {
    if (!ready) return;
    const image = withPhoto ? photo : null;
    if (await runInto(setResult, () => api.payoff(question.trim(), image ? { image } : {}))) {
      setAskedPhoto(image);
      setFinishedAt(Date.now());
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Same question, three answers</h2>
        <Lead>
          This tab puts it all together. A shopper can ask in two ways: with a question, or with a photo of a piece they already have. You try both, and each time three answers come back side by side:
          the model on its own, RAG on the product catalog, and GraphRAG on the brand&apos;s looks.
        </Lead>
        <p className="muted tab-uses">Uses the smart retriever of tab 4.</p>
        <ol className="po-intro-steps">
          <li>
            <b>Ask with a question.</b> Start with the white sneakers question you asked in tab 0. GraphRAG uses the smart retriever you saw at the end of the last tab. Compare what each answer can show you to
            back it up.
          </li>
          <li>
            <b>Then ask with a photo (Style recommendation).</b> Switch to the photo, pick a piece and ask again. GraphRAG runs the same engine. Only the input changes.
          </li>
        </ol>
        <InCpg>
          <p>
            In beauty, the same question would be: &ldquo;I have oily, acne-prone skin and use a vitamin C serum. What else should I add, and what should I avoid?&rdquo; A model on its own gives safe,
            generic advice. GraphRAG would answer from the brand&apos;s own regimens and rules: what to add, in which order, and what not to combine (retinol with strong acids), each with its source.
          </p>
        </InCpg>

        <div className="row po-input-switch" role="group" aria-label="ask with">
          <span className="small">Ask with:</span>
          {(['question', 'photo'] as Input[]).map((k) => (
            <button key={k} className={`small${input === k ? '' : ' secondary'}`} aria-pressed={input === k} onClick={() => setInput(k)} disabled={result.status === 'running'}>
              {k === 'question' ? '1 · A question' : '2 · A photo (Style recommendation)'}
            </button>
          ))}
        </div>

        {withPhoto && (
          <>
            <Lead>
              Shoppers often have the piece already. They show it instead of describing it: here is my coat, what goes with it? This is <b>Style recommendation</b>. Pick a photo of one piece, then ask all
              three.
            </Lead>
            <GoodToKnow title="How a photo finds the starting garments">
              <ul>
                <li>
                  The embedding model you used for questions (Amazon Nova multimodal embeddings) reads images too. Images and text land in the same vector space, so a photo of white sneakers sits close to
                  the words &quot;white sneakers&quot;.
                </li>
                <li>
                  So GraphRAG embeds the photo itself and runs the same vector search on the graph&apos;s garments. No vision model describes it first. The garments were embedded from text, and the photo
                  still finds the right kind of piece.
                </li>
                <li>From there nothing changes: the same traversal, the same catalog search, the same answer prompt.</li>
                <li>LLM only and RAG get the same photo in their prompts, so the comparison stays fair.</li>
                <li>Use a photo of one piece. A photo of a whole outfit becomes one vector for everything in it, so the search can&apos;t tell which piece you mean.</li>
              </ul>
            </GoodToKnow>
            <PhotoPicker domain={domain} photo={photo} onPhoto={setPhoto} disabled={result.status === 'running'} />
          </>
        )}

        <div className="row po-ask">
          <input className="po-question" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} aria-label="your question" />
          <button onClick={ask} disabled={!ready}>
            Ask all three
          </button>
        </div>
        {withPhoto && !photo && <p className="muted small">Pick a photo first.</p>}
        <div className="row po-chips">
          {chips.map((q) => (
            <button key={q} className={`secondary small${q === question ? ' active' : ''}`} onClick={() => setQuestion(q)} aria-pressed={q === question}>
              {q}
            </button>
          ))}
        </div>
        <Busy state={result} text="The model, RAG and GraphRAG are answering in parallel (about 15 s)…" />
        {result.status === 'done' && (
          <p className="muted small">{`${result.value.model.name} · ${(result.value.ms / 1000).toFixed(1)} s for all three${result.value.input === 'photo' ? ' · with your photo' : ''}`}</p>
        )}
        <RetrieverHowItWorks set="rt_payoff" running={result.status === 'running'} finishedAt={finishedAt} />
      </div>
      {result.status === 'done' && <PayoffView result={result.value} domain={domain} photo={askedPhoto} />}
      <NextTab to="lenses" lead="Bonus:">
        <p>If you have time: the same graph answers more than &ldquo;what goes with this?&rdquo;. Tab 6 asks it the questions a buyer, a merchandiser and a creative director would.</p>
      </NextTab>
    </div>
  );
}
