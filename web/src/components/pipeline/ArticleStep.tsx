// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useState } from 'react';
import type { ArticleInfo, Noun } from '../../api';
import { GoodToKnow, Lead, YourTurn } from '../retriever/Callouts';
import { ArticleViewer } from './ArticleViewer';
import { BatchGraph } from './BatchGraph';
import { RunResults } from './RunResults';
import { elapsedLabel, progressOf, rowsOf } from './runView';
import { useRun } from './useRun';

const TEXT_RUN_KEY = 'oaai.pipeline.textrun';

/**
 * The run button's label for the number of picked articles. A click on a picked tile unpicks it,
 * so the count can drop to 0: the button then says what to do instead of "0 articles".
 */
export function runLabel(picked: number): string {
  if (!picked) return 'Pick an article above to run it';
  return `Run the pipeline on ${picked === 1 ? 'the article' : `${picked} articles`}`;
}
// the article preview's element id here (the sources panel of the same tab has its own)
const STEP_PREVIEW_ID = 'article-step-preview';

/**
 * Tab 2, step 5: the same pipeline on another kind of unstructured content, an article of the
 * brand's journal about a look of the new shoot. Its own run (the photos' run of steps 3 and 4 is
 * left as it is): the garments the text names become items, the text a statement, and that
 * statement is linked to the look the article is about (`about_look`).
 */
export function ArticleStep({
  domain,
  articles,
  thumbs,
  modelId,
  promptCaching,
  onChanged,
  noun,
}: {
  domain: string;
  /** The shoot's articles (`batch` in the manifest), each naming its look (`pairs_with_image`). */
  articles: ArticleInfo[];
  /** The example photos' data URLs, by file: the look each article is about. */
  thumbs: Record<string, string>;
  modelId: string;
  promptCaching: boolean;
  onChanged: () => void;
  noun: Noun;
}) {
  const run = useRun(onChanged, TEXT_RUN_KEY);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(articles.slice(0, 1).map((a) => a.file)));
  const [preview, setPreview] = useState<string | null>(null);
  const { status, running, starting } = run;
  const progress = progressOf(status);
  const rows = rowsOf(status);
  const ingested = status?.records.flatMap((r) => (r.status === 'ingested' && r.ingest ? [r.ingest] : [])) ?? [];
  const toggle = (file: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(file)) n.delete(file);
      else n.add(file);
      return n;
    });
  const start = () =>
    run.start(
      { ontology_id: domain, model_id: modelId, prompt_caching: promptCaching, line_id: '', sources: [...picked].map((file) => ({ kind: 'text', example: file })) },
      {},
    );
  const lookOf = (file: string) => articles.find((a) => a.file === file)?.pairs_with_image ?? '';
  // a look's photo in the graph: the example photos (the shoot) are already loaded
  const thumbFor = useCallback((key: string) => (key.startsWith('example:') ? (thumbs[key.slice('example:'.length)] ?? null) : null), [thumbs]);
  const noHighlight = useState(() => new Set<string>())[0];

  return (
    <>
      <Lead>
        The brand&apos;s taste is not only in photos. Its journal, product notes and social posts describe looks too, in plain text. The same pipeline reads a text with the same ontology prompt as a
        photo: the garments the text names become garments in the graph, and the text becomes a statement. Because these articles are about looks you just added, each statement is linked to its look.
      </Lead>
      <YourTurn>
        <p>
          Pick one of the brand&apos;s journal articles below, then run it. Each one is about a look of the new shoot. A click on an article picks it and a second click unpicks it; <i>Read the
          article</i> opens it and keeps your pick.
        </p>
      </YourTurn>
      <div className="source-tiles texts">
        {articles.map((a) => {
          const on = picked.has(a.file);
          const look = thumbs[a.pairs_with_image];
          return (
            <div key={a.file} className={`source-tile text with-link${on ? ' on' : ''}`}>
              <button type="button" className="tile-body" disabled={running} onClick={() => toggle(a.file)} aria-pressed={on}>
                {look && <img src={look} alt="the look this article is about" />}
                <span className="source-kind">{a.kind}</span>
                <span className="source-title">{a.title}</span>
                <span className="muted source-meta">
                  {a.source}
                  {a.published ? ` · ${a.published}` : ''}
                </span>
              </button>
              <button type="button" className={`tile-link${preview === a.file ? ' active' : ''}`} onClick={() => setPreview((p) => (p === a.file ? null : a.file))} aria-expanded={preview === a.file} aria-controls={STEP_PREVIEW_ID}>
                {preview === a.file ? 'Close the article' : 'Read the article'}
              </button>
            </div>
          );
        })}
      </div>
      {preview && <ArticleViewer ontologyId={domain} file={preview} onClose={() => setPreview(null)} id={STEP_PREVIEW_ID} />}
      <div className="row run-row">
        <button disabled={!picked.size || !modelId || running || starting} onClick={start} className={starting || running ? 'busy' : ''}>
          {starting || running ? (
            <>
              <span className="spinner light" /> {starting ? 'Starting…' : 'Running…'}
            </>
          ) : (
            runLabel(picked.size)
          )}
        </button>
        {status && (
          <div className="progress grow" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}>
            <div className={`bar${progress.finished ? ' done' : ''}`} style={{ transform: `scaleX(${Math.max(4, progress.pct) / 100})` }} />
            <span>
              {running
                ? `${progress.done} of ${progress.total} through · ${elapsedLabel(status.execution.started_at ?? status.run.started_at, undefined, run.now)}`
                : `${status.status} · ${progress.total} article${progress.total === 1 ? '' : 's'}, ${progress.failed} failed`}
            </span>
          </div>
        )}
      </div>
      {run.error && <p className="error small">{run.error}</p>}
      {status && <RunResults rows={rows} selected={null} onSelect={() => undefined} imageFor={() => null} />}
      {ingested.map((ing) => {
        const file = status?.run.sources[ing.index]?.example ?? '';
        const photo = thumbs[lookOf(file)];
        return (
          <div key={ing.index} className="article-link">
            {photo && <img src={photo} alt="the look the article is about" />}
            <p className="small">
              {ing.about_look ? (
                <>
                  <b>{ing.label}</b> became the statement <code>{ing.statement}</code>, now linked to its look: <code>(:Statement)-[:ILLUSTRATES]-&gt;(:Look)</code> <code>{ing.about_look}</code>. The
                  brand&apos;s own words about the look now sit in the graph next to its garments.
                </>
              ) : (
                <>
                  <b>{ing.label}</b> became the statement <code>{ing.statement}</code>, but it is not linked to a look: the look it is about is not in the graph yet. Ingest the new shoot in step 3, then
                  run the article again.
                </>
              )}
            </p>
          </div>
        );
      })}
      {status && (status.records.length > 0 || status.summary) && <BatchGraph runId={status.run.run_id} version={run.graphVersion} highlight={noHighlight} thumbFor={thumbFor} noun={noun} />}
      <GoodToKnow>
        <p>
          Any text works the same way: a product description, a review, a stylist&apos;s note. Add your own under <i>Deep dives</i>. The model also reports what the ontology cannot express yet (the
          feedback in the results), which is how an ontology owner knows what to add.
        </p>
      </GoodToKnow>
    </>
  );
}
