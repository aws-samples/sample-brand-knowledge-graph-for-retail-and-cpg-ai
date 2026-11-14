// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type DomainInfo, type GraphCounts } from '../../api';
import { withoutNewWork } from '../../domain';
import { GoodToKnow, InCpg, Lead, Notice, YourTurn } from '../retriever/Callouts';
import { ModelSelect } from '../shared/ModelSelect';
import { NextTab } from '../shared/NextTab';
import { Stage } from '../shared/Stage';
import { useModelChoice } from '../shared/useModels';
import { BatchGraph } from './BatchGraph';
import { GraphCountsView } from './GraphCountsView';
import { PipelinePanel } from './PipelinePanel';
import { RunResults } from './RunResults';
import { RunSummaryCard } from './RunSummaryCard';
import { ArticleStep } from './ArticleStep';
import { BatchPreview } from './BatchPreview';
import { batchEntries, batchSummary } from './batchView';
import { ShootPicker } from './ShootPicker';
import { SourcePicker } from './SourcePicker';
import { elapsedLabel, progressOf, referencingIds, rowsOf, writtenIds, type SourceRow } from './runView';
import { useRun } from './useRun';
import { SHOOT, useSources } from './useSources';

// The garment whose looks tab 2 counts before and after: the cold-open question's.
const WATCH = 'white sneakers';

/**
 * Tab 2, "Hydrate the graph": the participant adds the brand's new shoot to the style DNA, in four
 * steps. 1 what the graph holds (the counts, and one number to watch: the looks with white
 * sneakers); 2 the batch (the new shoot, all selected; a domain without one starts with the first
 * batch its manifests mark, shown as tiles: BatchPreview); 3 the run (classify → validate → MERGE per
 * photo, one Step Functions execution when deployed: useRun); 4 what landed (the same counts,
 * before → after, the run's results and its graph); 5 beyond photos: an article of the brand's
 * journal about a look of the shoot, its own run (ArticleStep). The options, your own uploads and how it works
 * are deep dives under the steps (the query console is tab 3, Explore the graph). `domain` is the ontology folder chosen in
 * tab 0; `wording` is its `domain.json`, whose nouns the batch graph uses.
 */
export function IngestPipeline({ onChanged, domain, wording }: { onChanged: () => void; domain: string; wording: DomainInfo }) {
  const { models, modelId, setModelId, error: modelsError } = useModelChoice('vision');
  const [promptCaching, setPromptCaching] = useState(true);
  const sources = useSources(domain);
  const run = useRun(onChanged);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const { status, running, starting } = run;

  // ---------------------------------------------------------------- the counts, before and after
  const [before, setBefore] = useState<GraphCounts | null>(null);
  const [after, setAfter] = useState<GraphCounts | null>(null);
  const [countsError, setCountsError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .graphCounts(WATCH)
      .then((c) => live && (setBefore(c), setCountsError('')))
      .catch((e) => live && setCountsError(e.message));
    return () => {
      live = false;
    };
  }, []);
  // when a run finishes, count again: step 4 compares with the counts from before the run
  const finished = !!status && !running && status.status !== 'RUNNING';
  const finishedRun = finished ? status!.run.run_id : '';
  useEffect(() => {
    if (!finishedRun) return;
    let live = true;
    api
      .graphCounts(WATCH)
      .then((c) => live && setAfter(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [finishedRun, run.graphVersion]);

  async function start() {
    if (!sources.detail || !modelId) return;
    setSharedId(null);
    setSelectedRow(null);
    setAfter(null);
    // the counts right before this run are the "before" of step 4
    api
      .graphCounts(WATCH)
      .then(setBefore)
      .catch(() => undefined);
    const { sources: batch, images } = sources.requests();
    // no product lines in the brand's graph: each look gets its occasion instead (the pipeline)
    const started = await run.start({ ontology_id: domain, model_id: modelId, prompt_caching: promptCaching, line_id: '', sources: batch }, images);
    if (started) setPanelOpen(false);
  }
  function openRun(id: string) {
    setSharedId(null);
    setSelectedRow(null);
    run.openRun(id);
  }

  // ---------------------------------------------------------------- derived
  const rows = useMemo(() => rowsOf(status), [status]);
  const progress = progressOf(status);
  const currentRow: SourceRow | undefined = rows.find((r) => r.index === selectedRow);
  const highlight = useMemo(() => (sharedId ? referencingIds(status, sharedId) : writtenIds(currentRow)), [sharedId, status, currentRow]);
  const { thumbs } = sources;
  const { runImages } = run;
  const imageFor = useCallback(
    (row: SourceRow) => {
      if (!status) return null;
      const spec = status.run.sources[row.index];
      if (spec?.example) return thumbs[spec.example] ?? null;
      return runImages[status.run.run_id]?.[row.index] ?? null;
    },
    [status, thumbs, runImages],
  );
  // the photo of a Look in the run tree: its image_key is the source key ("example:<file>" or an upload)
  const statusRef = useRef(status);
  statusRef.current = status;
  const runKey = status?.run.run_id;
  const thumbFor = useCallback(
    (imageKey: string) => {
      if (imageKey.startsWith('example:') && thumbs[imageKey.slice('example:'.length)]) return thumbs[imageKey.slice('example:'.length)];
      const st = statusRef.current;
      const spec = st?.run.sources.find((x) => x.key === imageKey || (x.example && `example:${x.example}` === imageKey));
      if (!st || !spec) return null;
      return spec.example ? (thumbs[spec.example] ?? null) : (runImages[st.run.run_id]?.[spec.index] ?? null);
    },
    // the run's sources do not change while it runs: re-create it per run, not per poll
    [thumbs, runImages, runKey],
  );
  const detail = sources.detail;
  const shoot = useMemo(() => (detail?.examples_list ?? []).filter((e) => e.batch === SHOOT), [detail]);
  const shootArticles = useMemo(() => (detail?.articles_list ?? []).filter((a) => a.batch === SHOOT), [detail]);
  const hasShoot = shoot.length > 0;
  // until the domain's examples are read, the page names neither the new shoot nor a first batch
  const loading = !detail;
  // step 2's preview: every selected source the shoot picker does not show (on a domain without a
  // shoot, the whole batch; with one, what was added under Deep dives)
  const shootKeys = useMemo(() => new Set(shoot.map((e) => `img:${e.file}`)), [shoot]);
  const batch = useMemo(
    () => batchEntries(sources.selected, withoutNewWork(detail?.examples_list ?? []), detail?.articles_list ?? [], sources.uploads, shootKeys),
    [sources.selected, detail, sources.uploads, shootKeys],
  );
  const batchHeading = loading
    ? 'Loading the batch…'
    : hasShoot
      ? `Also in the batch, from Deep dives: ${batchSummary(batch)}`
      : batch.length
        ? `Your batch: ${batchSummary(batch)}`
        : 'Nothing is selected yet: pick photos and texts under Deep dives below.';
  // the photos of the batch that show the garment step 1 counts (the shoot's, or the first batch's)
  const photoTitles = hasShoot ? shoot.map((e) => e.title) : batch.filter((e) => e.kind === 'photo' || e.kind === 'your photo').map((e) => e.title);
  const watchPhotos = photoTitles.filter((t) => /white (platform )?sneakers/i.test(t)).length;
  // the link under Deep dives: back to step 3, with the keyboard focus on its Run button
  const runButton = useRef<HTMLButtonElement>(null);
  const backToRun = () => {
    document.getElementById('stage-3')?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    runButton.current?.focus({ preventScroll: true });
  };
  const canRun = !!detail && !!modelId && sources.selected.size > 0 && !running && !starting;
  const error = modelsError || sources.error || run.error;
  const stepFunctions = status?.execution.runner === 'step-functions';
  const ingested = status?.summary?.sources.ingested ?? 0;

  return (
    <div className="stack studio">
      {error && <p className="error">{error}</p>}

      {/* ------------------------------------------------------------ the intro */}
      <div className="card">
        <h2>{loading ? 'Hydrate the graph' : hasShoot ? 'Hydrate the graph: ingest the new shoot' : 'Hydrate the graph: ingest new photos and texts'}</h2>
        <Lead>
          The graph already holds the brand&apos;s style DNA: every look of its lookbook, decomposed into garments with the ontology you saw in tab 1.{' '}
          {loading ? null : hasShoot ? (
            <>Now the brand has a new shoot, {shoot.length} looks nobody has decomposed yet. Your job is to add them to the graph.</>
          ) : (
            <>Now you add photos and texts nobody has decomposed yet. A first batch is already selected.</>
          )}
        </Lead>
        <ol className="po-intro-steps">
          <li>
            <b>Look at what the graph holds</b>, and remember one number.
          </li>
          <li>
            <b>Pick the batch:</b> {hasShoot ? 'the new shoot' : 'a first batch of photos and texts'}, already selected.
          </li>
          <li>
            <b>Run the pipeline</b> and watch it in AWS Step Functions.
          </li>
          <li>
            <b>See what landed:</b> the same numbers again, and the new looks in the graph.
          </li>
          <li>
            <b>Beyond photos:</b> run an article from the brand&apos;s journal through the same pipeline.
          </li>
        </ol>
      </div>

      {/* ------------------------------------------------------------ 1. where you start */}
      <Stage n={1} title="Where you start: the brand's graph" sub="What the graph holds before your batch." locked={null} done={!!before}>
        {countsError && <p className="error small">{countsError}</p>}
        {!before && !countsError && (
          <p className="muted">
            <span className="spinner" /> Counting the graph…
          </p>
        )}
        {before && <GraphCountsView now={before} />}
        {before?.watch && (
          <Notice title="The number to remember">
            <p>
              <b>{before.watch.looks}</b> {before.watch.looks === 1 ? 'look has' : 'looks have'} {WATCH}. {watchPhotos > 0 && (
                <>
                  {watchPhotos} {watchPhotos === 1 ? 'photo' : 'photos'} of {hasShoot ? 'the new shoot' : 'your batch'} {watchPhotos === 1 ? 'shows' : 'show'} them too, and the vision model usually finds them.{' '}
                </>
              )}
              Watch this number in step 4.
            </p>
          </Notice>
        )}
      </Stage>

      {/* ------------------------------------------------------------ 2. the batch */}
      <Stage
        n={2}
        title={hasShoot ? 'Pick the batch: the new shoot' : 'Pick the batch'}
        sub={hasShoot ? "Looks from the brand's latest shoot that are not in the graph yet." : 'The photos and texts you add to the graph.'}
        locked={null}
        done={sources.selected.size > 0}
      >
        {!loading && (
          <YourTurn>
            {hasShoot ? (
              <p>
                All the looks are selected. Click a photo to leave it out, or keep them all. Then go to step 3. You can also add your own photos or texts under <i>Deep dives</i> below.
              </p>
            ) : (
              <p>
                The batch below is already selected. Press × on a source to leave it out, or keep them all. Then go to step 3. To add more, open <i>Add your own photos or texts</i> under <i>Deep dives</i> below.
              </p>
            )}
          </YourTurn>
        )}
        {hasShoot && <ShootPicker shoot={shoot} thumbs={thumbs} selected={sources.selected} disabled={running} onToggle={sources.toggle} onSelectAll={sources.selectAll} />}
        {(!hasShoot || batch.length > 0) && <BatchPreview heading={batchHeading} ontologyId={domain} entries={batch} thumbs={thumbs} disabled={running} onRemove={sources.toggle} />}
        {hasShoot && (
          <GoodToKnow>
            <p>
              Each look carries the occasion it was shot for, from the shoot&apos;s manifest. The pipeline writes it into the graph as <code>(:Look)-[:FOR]-&gt;(:Occasion)</code>, so the new looks count
              exactly like the brand&apos;s own.
            </p>
          </GoodToKnow>
        )}
        {!loading && !hasShoot && (
          <GoodToKnow>
            <p>
              The model also picks each photo&apos;s occasion from the ontology&apos;s list (the classification prompt has it: tab 1&apos;s Inspect shows it). The pipeline writes it as <code>(:Look)-[:FOR]-&gt;(:Occasion)</code>.
            </p>
          </GoodToKnow>
        )}
      </Stage>

      {/* ------------------------------------------------------------ 3. the run */}
      <Stage n={3} title="Run the pipeline" sub="Every photo through the same steps: classify, validate, MERGE." locked={sources.selected.size ? null : hasShoot ? 'Select at least one look in step 2.' : 'Select at least one source in step 2.'} done={finished && ingested > 0}>
        <Lead>
          Press <b>Run</b>. Each photo goes to the vision model with the ontology as its prompt. The answer is checked against the ontology, then merged into Neptune Analytics as a look and its garments. One
          execution runs the whole batch, a few photos at a time. It takes about a minute.
        </Lead>
        <div className="row run-row">
          <button ref={runButton} disabled={!canRun} onClick={start} className={starting || running ? 'busy' : ''}>
            {starting ? (
              <>
                <span className="spinner light" /> Starting…
              </>
            ) : running ? (
              <>
                <span className="spinner light" /> Running…
              </>
            ) : (
              `Run the pipeline (${sources.selected.size} source${sources.selected.size === 1 ? '' : 's'})`
            )}
          </button>
          {status && (
            <div className="progress grow" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}>
              <div className={`bar${progress.finished ? ' done' : ''}`} style={{ transform: `scaleX(${Math.max(4, progress.pct) / 100})` }} />
              <span>
                {running
                  ? `Step Functions · ${progress.done} of ${progress.total} sources through${progress.done === progress.total ? ' · summarizing' : ''} · ${elapsedLabel(status.execution.started_at ?? status.run.started_at, undefined, run.now)}`
                  : `${status.status} · ${progress.total} sources, ${progress.failed} failed · ${elapsedLabel(status.execution.started_at ?? status.run.started_at, status.execution.stopped_at ?? status.summary?.finished_at)}`}
              </span>
            </div>
          )}
        </div>
        {status && stepFunctions && status.execution.console_url && (
          <YourTurn title="Your turn: open the execution">
            <p>
              <a href={status.execution.console_url} target="_blank" rel="noopener noreferrer">
                Open this execution in the Step Functions console ↗
              </a>
              . The graph view shows the steps: <b>Classify</b> and <b>Ingest</b> run once per photo inside a <b>Map</b>, then <b>Summarize</b>. Click a step to see its input and output: the vision
              model&apos;s answer, then what was merged.
            </p>
          </YourTurn>
        )}
        {status && <RunResults rows={rows} selected={selectedRow} onSelect={(i) => (setSelectedRow(i), setSharedId(null))} imageFor={imageFor} />}
      </Stage>

      {/* ------------------------------------------------------------ 4. what landed */}
      <Stage n={4} title="What landed" sub="The same counts again, and the new looks in the graph." locked={finished ? null : 'Run the pipeline in step 3 first.'} done={finished && !!after}>
        {after && before ? (
          <>
            <GraphCountsView now={after} before={before} />
            <Notice>
              <p>
                The batch is now part of the brand&apos;s DNA, counted like every other look.
                {after.watch && before.watch && after.watch.looks !== before.watch.looks && (
                  <>
                    {' '}
                    Looks with {WATCH}: <b>{before.watch.looks}</b> → <b>{after.watch.looks}</b>. Ask tab 4 or 5 about {WATCH} again and the new looks are in the answer&apos;s receipts.
                  </>
                )}
              </p>
            </Notice>
            <InCpg>
              <p>
                The same pipeline reads a beauty brand&apos;s regimen photos and routine guides. Each regimen lands as a node with its products, the skin type it is for, and its steps in order, counted
                like the brand&apos;s own.
              </p>
            </InCpg>
          </>
        ) : (
          finished && (
            <p className="muted">
              <span className="spinner" /> Counting again…
            </p>
          )
        )}
        {status && (
          <>
            <RunSummaryCard status={status} highlighted={sharedId} onShared={(id) => (setSharedId(id), id && setSelectedRow(null))} />
            {(status.records.length > 0 || status.summary) && <BatchGraph runId={status.run.run_id} version={run.graphVersion} highlight={highlight} thumbFor={thumbFor} noun={wording.noun} />}
          </>
        )}
      </Stage>

      {/* ------------------------------------------------------------ 5. beyond photos */}
      {shootArticles.length > 0 && (
        <Stage n={5} title="Beyond photos: an article about a look" sub="The same pipeline on another kind of unstructured content." locked={finished ? null : 'Ingest the new shoot in step 3 first.'} done={false}>
          <ArticleStep domain={domain} articles={shootArticles} thumbs={thumbs} modelId={modelId} promptCaching={promptCaching} onChanged={onChanged} noun={wording.noun} />
        </Stage>
      )}

      {/* ------------------------------------------------------------ deep dives */}
      <div className="card deep-dives">
        <h3>Deep dives</h3>
        <details className="xp">
          <summary>
            Options: the vision model, prompt caching, recent runs<span className="xp-hint">the same for the whole batch</span>
          </summary>
          <div className="toolbar">
            <ModelSelect id="p-model" label="Vision model (one for the whole batch)" kind="vision" value={modelId} onChange={setModelId} disabled={running} cacheNote className="grow-2" />
            <div className="field">
              <label htmlFor="p-caching">Prompt caching</label>
              <label className="check control" htmlFor="p-caching">
                <input id="p-caching" type="checkbox" checked={promptCaching} disabled={running} onChange={(e) => setPromptCaching(e.target.checked)} /> {promptCaching ? 'on' : 'off'}
              </label>
            </div>
            {run.recent.length > 0 && (
              <div className="field grow-1">
                <label htmlFor="p-recent">Recent runs</label>
                <select id="p-recent" className="secondary" value="" disabled={running} onChange={(e) => e.target.value && openRun(e.target.value)}>
                  <option value="">Open a recent run…</option>
                  {run.recent.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {r.started_at.replace('T', ' ').slice(0, 16)} · {r.sources} sources · {models.find((m) => m.id === r.model_id)?.name ?? r.model_id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {detail && (
            <p className="muted small">
              The ontology prompt is about {detail.prompt_tokens_estimate.toLocaleString()} tokens. Every entity that resolves to one of its {detail.entity_classes} classes becomes a garment in the graph.
            </p>
          )}
        </details>
        <details className="xp">
          <summary>
            Add your own photos or texts<span className="xp-hint">uploads, and the domain&apos;s other example photos and texts</span>
          </summary>
          <SourcePicker
            ontologyId={domain}
            examples={withoutNewWork(detail?.examples_list ?? []).filter((e) => e.batch !== SHOOT)}
            articles={(detail?.articles_list ?? []).filter((a) => a.batch !== SHOOT)}
            thumbs={thumbs}
            uploads={sources.uploads}
            selected={sources.selected}
            disabled={running}
            onToggle={sources.toggle}
            onSelectAll={sources.selectAll}
            onAddUploads={sources.addUploads}
            onRemoveUpload={sources.removeUpload}
          />
          <p className="back-to-run">
            <button type="button" className="linklike" onClick={backToRun}>
              <span aria-hidden>↑ </span>Back to step 3: run the pipeline ({sources.selected.size} source{sources.selected.size === 1 ? '' : 's'})
            </button>
          </p>
        </details>
      </div>
      <PipelinePanel status={status} models={models} detail={detail} open={panelOpen} onToggle={setPanelOpen} />
      <NextTab to="graph">
        <p>
          Your new {hasShoot ? 'looks are' : 'photos and texts are'} in the graph now. Tab 3 shows the whole graph at once: the brand&apos;s lookbook and the {hasShoot ? 'shoot' : 'sources'} you just added, as one web you
          can explore and query.
        </p>
      </NextTab>
    </div>
  );
}
