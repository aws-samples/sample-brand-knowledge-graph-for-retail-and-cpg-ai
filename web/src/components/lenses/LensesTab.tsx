// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useState } from 'react';
import { syncKeptVersion, useKept, type Codec } from '../shared/kept';
import { NextTab } from '../shared/NextTab';
import {
  api,
  type CheckLook,
  type CheckLooks,
  type CheckPieces,
  type ExampleInfo,
  type Health,
  type LensCatalog,
  type LensCell,
  type LensCount,
  type LensExplain,
  type TrendsCloud as CloudWalk,
  type TrendsDescribe,
  type TrendsMap as SeasonMap,
  type Verdict,
} from '../../api';
import { Busy, Inspect, runInto, useLookSources, type Async } from '../payoff/parts';
import { GoodToKnow, InCpg, Lead, Notice, YourTurn } from '../retriever/Callouts';
import { Stage } from '../shared/Stage';
import { Takeaways } from '../shared/Takeaways';
import { useModelChoice } from '../shared/useModels';
import { DescribeDeepDive } from './AgentDeepDive';
import { useAgentMethods } from './agentMethods';
import { lensesOf, newWorkPhotos, NO_NEW_WORK, PERSONAS, splitCitations, TRENDS_METHODS, VERDICT_RULE, type PersonaId } from './lenses';
import { LensesHowItWorks } from './TrendsArchitecture';
import { TrendsCloud, TrendsFindings } from './TrendsCloud';
import { TrendsMap } from './TrendsMapCanvas';
import { cloudIds, layout, liftPhrase, MAX_CLOUD_ITEMS, type Layout } from './trendsMap';
import { TrendsMethods } from './TrendsQuestion';
import { TrendsScoreboard, type CloudsRun } from './TrendsScoreboard';

const VERDICT_LINE: Record<Verdict, string> = { 'on-brand': 'On-brand', partly: 'Partly on-brand', 'off-brand': 'Off-brand' };
const IDLE = { status: 'idle' } as const;
const NONE = {};
/**
 * Where this tab keeps what it ran (shared/kept.ts), per domain: the results under `RESULTS`, which
 * a change of the graph forgets (the rule trendsCache applies to methods 1 and 2), and the
 * choices and edits under `INPUTS`, which stay.
 */
const RESULTS = 'lens.result.';
const INPUTS = 'lens.input.';

/**
 * One result per key (a lens, the photo lens and its photo, the trends lens and its cloud), in a
 * map of request states kept under `keptKey`; a request that lands after the tab closed is kept too.
 */
function useResults<T>(keptKey: string, codec?: Codec<Record<string, Async<T>>>) {
  const [all, setAll] = useKept<Record<string, Async<T>>>(keptKey, NONE, codec);
  const into = useCallback((key: string) => (s: Async<T>) => setAll((m) => ({ ...m, [key]: s })), [setAll]);
  const get = (key: string): Async<T> => all[key] ?? IDLE;
  /** whether a result under `prefix` is done (a lens with one result per cloud) */
  const anyDone = (prefix: string) => Object.entries(all).some(([k, s]) => k.startsWith(prefix) && s.status === 'done');
  /** forget every result under `prefix`: a new map has new clouds */
  const clear = useCallback((prefix: string) => setAll((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(prefix)))), [setAll]);
  return { get, into, anyDone, clear };
}

/** The trends lens's map: the garments as the API sent them, and their layout and clouds. */
type Season = { map: SeasonMap; lay: Layout };
type StoredSeason = { map: SeasonMap; lay: Omit<Layout, 'xy'> & { xy: number[] } };
/**
 * A map is kept without its vectors (only the layout reads them, and they are megabytes), with its
 * layout's positions as a plain list (JSON cannot hold a Float32Array).
 */
export const SEASONS: Codec<Record<string, Async<Season>>> = {
  save: (all) =>
    Object.fromEntries(
      Object.entries(all).map(([k, s]) => [k, s.status === 'done' ? { status: 'done', value: { map: { ...s.value.map, vectors: '' }, lay: { ...s.value.lay, xy: Array.from(s.value.lay.xy) } } } : s]),
    ),
  load: (stored) =>
    Object.fromEntries(
      Object.entries(stored as Record<string, Async<StoredSeason>>).map(([k, s]) => [k, s.status === 'done' ? { status: 'done', value: { ...s.value, lay: { ...s.value.lay, xy: Float32Array.from(s.value.lay.xy) } } } : s]),
    ),
};

/**
 * "What else the graph knows" (tab 6, a bonus): the same graph, a different person asking. Pick
 * who is asking (the buyer, the merchandiser, the creative director), pick one of their questions,
 * count it in the graph (the openCypher shown, editable), then have a model explain the numbers,
 * citing only them. "Is this new photo on-brand?" is a check: vector search on the looks, the walk
 * to their garments, a helper model per piece, a fixed rule. "What are the emerging trends?" is
 * three methods and a scoreboard: the graph agent (method 1) and the data agent on the graph's
 * Iceberg tables (method 2), background jobs kept in trendsCache across tab switches and reloads,
 * then a map (method 3): every worn garment's vector, laid out and grouped in the browser, a cloud
 * picked on it, walked in the graph, then described in two model calls. Every other result, and
 * the choices behind it, is kept across tab switches and reloads too (shared/kept.ts). `health`
 * says whether the graph agent is available; `dataVersion` changes when the graph does, and a
 * change forgets the results counted on the older graph.
 */
export function LensesTab({ domain, health, dataVersion }: { domain: string; health: Health | null; dataVersion: number }) {
  // every choice, edit and result is kept across tab switches and reloads; a new graph forgets the results
  const input = (part: string) => `${INPUTS}${domain}.${part}`;
  const results = (part: string) => `${RESULTS}${domain}.${part}`;
  useEffect(() => {
    syncKeptVersion(RESULTS, dataVersion);
  }, [dataVersion]);
  const [persona, setPersona] = useKept<PersonaId>(input('persona'), 'buyer');
  const lenses = lensesOf(persona);
  const [lensId, setLensId] = useKept(input('lens'), lenses[0].id);
  const lens = lenses.find((l) => l.id === lensId) ?? lenses[0];
  const [catalog, setCatalog] = useState<Async<LensCatalog>>(IDLE);
  const [garment, setGarment] = useKept<Record<string, string>>(input('garment'), NONE);
  // the photo lens's outfits: the domain's example photos marked as new work, picked by file name
  const [newWork, setNewWork] = useState<Async<ExampleInfo[]>>(IDLE);
  const [photoId, setPhotoId] = useKept<string | null>(input('photo'), null);
  // the participant's edit of a lens's openCypher (its one editable step)
  const [edits, setEdits] = useKept<Record<string, string>>(input('edits'), NONE);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [activeLook, setActiveLook] = useState<string | null>(null);

  const counts = useResults<LensCount>(results('counts'));
  const explains = useResults<LensExplain>(results('explains'));
  const checks = useResults<CheckLooks>(results('checks'));
  const verdicts = useResults<CheckPieces>(results('verdicts'));
  // the trends lens: the map per lens, the walk and the description per lens and cloud
  const seasons = useResults<Season>(results('seasons'), SEASONS);
  const walks = useResults<CloudWalk>(results('walks'));
  const describes = useResults<TrendsDescribe>(results('describes'));
  const [picked, setPicked] = useKept<Record<string, number>>(results('picked'), NONE);
  const [finishedAt, setFinishedAt] = useState<number>();
  // the trends lens's methods 1 and 2 (agent jobs), and method 3's model and last description for the scoreboard
  const trends = useAgentMethods(dataVersion);
  const describer = useModelChoice('answer', 'lens.trends.describe.model');
  const [cloudsRun, setCloudsRun] = useKept<CloudsRun | null>(results('cloudsRun'), null);

  useEffect(() => {
    runInto(setCatalog, () => api.lenses());
  }, []);
  useEffect(() => {
    let live = true;
    runInto(
      (s) => live && setNewWork(s),
      async () => newWorkPhotos((await api.ontologyDetail(domain)).examples_list),
    );
    return () => {
      live = false;
    };
  }, [domain]);
  useEffect(() => {
    setActiveRow(null);
    setActiveLook(null);
  }, [lens.id, photoId, picked]);

  const who = PERSONAS.find((x) => x.id === persona)!;
  const usesPhoto = lens.input?.kind === 'photo';
  const usesMap = lens.input?.kind === 'map';
  const outfits = newWork.status === 'done' ? newWork.value : [];
  const photo = outfits.find((x) => x.file === photoId) ?? null;
  const key = usesPhoto ? `${lens.id}:${photoId ?? ''}` : lens.id;
  const steps = catalog.status === 'done' ? (catalog.value.lenses[lens.id]?.steps ?? []) : [];
  const editableAt = steps.findIndex((s) => s.editable);
  const defaultCode = editableAt >= 0 ? steps[editableAt].code : '';
  const code = edits[lens.id] ?? defaultCode;
  const edited = code !== defaultCode;
  const garmentValue = lens.input?.kind === 'garment' ? (garment[lens.id] ?? lens.input.value) : '';

  const count = usesPhoto ? checks.get(key) : counts.get(key);
  const explained = usesPhoto ? verdicts.get(key) : explains.get(key);
  const counted = count.status === 'done';

  const drawn = seasons.get(lens.id);
  const season = drawn.status === 'done' ? drawn.value : null;
  const cloud = usesMap && season && picked[lens.id] !== undefined ? season.lay.groups[picked[lens.id]] : null;
  const cloudKey = `${lens.id}:${cloud?.id ?? ''}`;
  const walk = cloud ? walks.get(cloudKey) : IDLE;
  const described = cloud ? describes.get(cloudKey) : IDLE;
  const mapRunning = [drawn, walk, described].some((x) => x.status === 'running');
  const busy = count.status === 'running' || explained.status === 'running' || mapRunning;

  const choosePersona = (id: PersonaId) => {
    setPersona(id);
    setLensId(lensesOf(id)[0].id);
  };
  const finish = () => setFinishedAt(Date.now());
  const drawMap = () => {
    if (busy) return;
    setPicked((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== lens.id)));
    walks.clear(`${lens.id}:`);
    describes.clear(`${lens.id}:`);
    runInto(seasons.into(lens.id), async () => {
      const map = await api.lensTrendsMap();
      await new Promise((r) => setTimeout(r, 30)); // let the spinner paint before the maths
      return { map, lay: layout(map) };
    }).then(finish);
  };
  const walkCloud = (id: number) => {
    if (busy || !season) return;
    const key = `${lens.id}:${id}`;
    setPicked((p) => ({ ...p, [lens.id]: id }));
    describes.into(key)(IDLE);
    runInto(walks.into(key), () => api.lensTrendsCloud(cloudIds(season.map, season.lay.xy, season.lay.groups[id]), edited ? code : undefined)).then(finish);
  };
  /** A cloud already walked shows its walk again; any other is walked now. */
  const pickCloud = (id: number) => {
    if (walks.get(`${lens.id}:${id}`).status === 'done') setPicked((p) => ({ ...p, [lens.id]: id }));
    else walkCloud(id);
  };
  const describeCloud = () => {
    if (busy || !season || !cloud || walk.status !== 'done') return;
    // the same walk as shown above: the server runs it again, it never takes rows from the browser
    const cypher = walk.value.edited ? walk.value.query : undefined;
    const run = { mapMs: season.map.ms, walkMs: walk.value.ms, cloud: `cloud ${cloud.id + 1}, ${cloud.label}${season.map.totals.new ? `, ${liftPhrase(cloud)}` : ''}` };
    runInto(describes.into(cloudKey), () => api.lensTrendsDescribe(cloudIds(season.map, season.lay.xy, cloud), cypher, describer.modelId || undefined)).then((d) => {
      if (d) setCloudsRun({ ...run, describe: d });
      finish();
    });
  };
  const runCount = () => {
    if (busy) return;
    if (usesMap) {
      if (cloud) walkCloud(cloud.id);
      else drawMap();
      return;
    }
    const cypher = edited ? code : undefined;
    if (usesPhoto) {
      if (!photo) return;
      verdicts.into(key)(IDLE);
      runInto(checks.into(key), () => api.lensCheckLooks(domain, photo.file, cypher));
    } else {
      explains.into(key)(IDLE);
      runInto(counts.into(key), () => api.lensCount(lens.id, { cypher, ...(lens.input?.kind === 'garment' ? { start: garmentValue } : {}) }));
    }
  };
  const runExplain = () => {
    if (busy || count.status !== 'done') return;
    if (usesPhoto && photo) {
      const looks = (count.value as CheckLooks).looks;
      runInto(verdicts.into(key), () => api.lensCheckPieces(domain, photo.file, looks));
    } else {
      const c = count.value as LensCount;
      runInto(explains.into(key), () => api.lensExplain(lens.id, c.columns, c.rows));
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>
          What else the graph knows <span className="ln-bonus">Bonus</span>
        </h2>
        <Lead>
          Until now one person asked the graph one kind of question: a shopper, asking what goes with a piece. But the graph holds the brand&apos;s whole style, counted and connected. This tab keeps
          the same graph and changes who is asking.
        </Lead>
        <ol className="po-intro-steps">
          <li>
            <b>Pick who is asking:</b> the buyer, the merchandiser or the creative director.
          </li>
          <li>
            <b>Pick one of their questions,</b> and count it in the graph. You see the openCypher that runs, and you can edit it.
          </li>
          <li>
            <b>Explain it.</b> A model turns the numbers into a finding. It gets only the numbers, and cites them line by line.
          </li>
        </ol>

        <h3 className="ln-pick-title">Who is asking? Pick one</h3>
        <div className="ln-personas" role="radiogroup" aria-label="who is asking">
          {PERSONAS.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={persona === x.id}
              className={`ln-persona ln-persona-${x.id}${persona === x.id ? ' active' : ''}`}
              onClick={() => choosePersona(x.id)}
              disabled={busy}
            >
              <span className="ln-persona-head">
                <span className="ln-persona-n">{i + 1}</span>
                <b>{x.title}</b>
              </span>
              <span className="ln-persona-role">{x.role}</span>
              <span className="ln-persona-wants">{x.wants}</span>
            </button>
          ))}
        </div>

        <h3 className="ln-pick-title">{who.title}&apos;s questions. Pick one</h3>
        <div className={`ln-questions ln-questions-${persona}`} role="radiogroup" aria-label={`${who.title}'s questions`}>
          {lenses.map((l, i) => {
            const done =
              l.input?.kind === 'photo'
                ? outfits.some((x) => verdicts.get(`${l.id}:${x.file}`).status === 'done')
                : l.input?.kind === 'map'
                  ? describes.anyDone(`${l.id}:`) || trends.graph?.status === 'done' || trends.lake?.status === 'done'
                  : explains.get(l.id).status === 'done';
            return (
              <button key={l.id} type="button" role="radio" aria-checked={l.id === lens.id} className={`ln-question${l.id === lens.id ? ' active' : ''}`} onClick={() => setLensId(l.id)} disabled={busy}>
                <span className={`ln-question-n${done ? ' done' : ''}`}>
                  {i + 1}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
                {l.question}
              </button>
            );
          })}
        </div>
        <InCpg title="The same question in beauty">
          <p>{lens.beauty}</p>
        </InCpg>
      </div>

      {/* ------------------------------------------------------------ the trends question: its lead, methods 1 and 2, method 3's card */}
      {usesMap && <TrendsMethods lens={lens} health={health} dataVersion={dataVersion} trends={trends} />}

      {/* ------------------------------------------------------------ 1. count it */}
      <Stage n={1} title={usesMap ? 'Map the season' : usesPhoto ? 'Find the closest looks' : 'Count it in the graph'} sub={lens.question} locked={null} done={usesMap ? !!season : counted}>
        {!usesMap && <Lead>{lens.lead}</Lead>}
        {lens.input?.kind === 'garment' && (
          <YourTurn>
            <p>Pick the piece to start from, or type your own.</p>
            <div className="row po-ask">
              <span className="small">{lens.input.label}</span>
              <input
                className="po-question"
                value={garmentValue}
                onChange={(e) => setGarment((g) => ({ ...g, [lens.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && runCount()}
                placeholder={lens.input.placeholder}
                aria-label={lens.input.label}
              />
            </div>
            <div className="row po-chips">
              {lens.input.chips.map((c) => (
                <button key={c} className={`secondary small${c === garmentValue ? ' active' : ''}`} onClick={() => setGarment((g) => ({ ...g, [lens.id]: c }))}>
                  {c}
                </button>
              ))}
            </div>
          </YourTurn>
        )}
        {usesPhoto && <Busy state={newWork} text="Reading the domain’s example photos…" />}
        {usesPhoto && newWork.status === 'done' && outfits.length === 0 && <p className="muted">{NO_NEW_WORK}</p>}
        {usesPhoto && outfits.length > 0 && (
          <YourTurn>
            <p>Pick an outfit the graph has never seen. Some are on-brand, some are not: guess before you run it.</p>
            <div className="ln-photos" role="radiogroup" aria-label="an outfit to check">
              {outfits.map((x) => {
                const v = verdicts.get(`${lens.id}:${x.file}`);
                return (
                  <button key={x.file} type="button" role="radio" aria-checked={photoId === x.file} className={`ln-photo${photoId === x.file ? ' active' : ''}`} onClick={() => setPhotoId(x.file)} disabled={busy}>
                    <ExamplePhoto domain={domain} file={x.file} alt={x.title} />
                    {x.origin && <span className="ln-photo-source">{x.origin}</span>}
                    <span className="ln-photo-outfit">{x.title}</span>
                    {v.status === 'done' && <span className={`ln-photo-expect ln-expect-${v.value.verdict}`}>{v.value.verdict}</span>}
                  </button>
                );
              })}
            </div>
          </YourTurn>
        )}
        {lens.usesPieces && (
          <GoodToKnow title="Pieces, not categories">
            <p>
              The ontology&apos;s kinds are broad: &quot;shoe&quot; is in almost every look. So this counts finer pieces (sneakers, loafers, a blazer…). Each piece finds its garments two ways: the
              way tab 4 finds its way in (its words embedded, a vector search on the graph&apos;s garments, everything within 0.10 of the closest), and the garments whose name says the piece, if
              they are in the same ontology category (a tote &quot;with ring hardware&quot; is not a ring). In production you would add these pieces to the ontology as subclasses.
            </p>
          </GoodToKnow>
        )}

        <div className="po-sec-label">What runs</div>
        {catalog.status === 'running' && (
          <p className="muted small">
            <span className="spinner" /> Loading the queries…
          </p>
        )}
        {catalog.status === 'error' && <p className="error">{catalog.error}</p>}
        {steps.map((step, i) =>
          step.editable ? (
            <div key={step.label} className="field ln-step">
              <div className="row ln-step-head">
                <label className="po-inspect-label" htmlFor={`ln-${lens.id}-${i}`}>
                  {step.label}
                </label>
                <span className="small muted">edit freely, read-only</span>
                {edited && (
                  <button type="button" className="linklike small" onClick={() => setEdits((all) => ({ ...all, [lens.id]: defaultCode }))}>
                    reset
                  </button>
                )}
              </div>
              <textarea
                id={`ln-${lens.id}-${i}`}
                className="code"
                rows={Math.min(16, code.split('\n').length + 1)}
                value={code}
                onChange={(e) => setEdits((all) => ({ ...all, [lens.id]: e.target.value }))}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && runCount()}
                spellCheck={false}
              />
            </div>
          ) : (
            <div key={step.label} className="ln-step">
              <div className="po-inspect-label">{step.label}</div>
              {step.code.includes('\n') ? <pre className="code po-pre">{step.code}</pre> : <p className="small ln-step-note">{step.code}</p>}
            </div>
          ),
        )}

        {usesMap ? (
          <>
            <div className="row">
              <button onClick={drawMap} disabled={busy || steps.length === 0}>
                {season ? 'Draw it again' : 'Draw the map'}
              </button>
            </div>
            <Busy state={drawn} text="Reading every worn garment’s vector (about 5 s), then laying out the map in your browser…" />
          </>
        ) : (
          <>
            <div className="row">
              <button onClick={runCount} disabled={busy || steps.length === 0 || (usesPhoto && !photo)}>
                {counted ? 'Run again' : usesPhoto ? 'Run the search and the walk' : 'Run the count'}
              </button>
              {usesPhoto && !photo && outfits.length > 0 && <span className="muted small">Pick an outfit first.</span>}
            </div>
            <Busy state={count} text={usesPhoto ? 'Embedding the photo, searching the looks, walking to their garments…' : 'Counting in the graph (the first count also finds every piece: about 10 s)…'} />
          </>
        )}

        {count.status === 'done' && usesPhoto && <ClosestLooks check={count.value as CheckLooks} domain={domain} active={activeLook} onActive={setActiveLook} />}
        {count.status === 'done' && !usesPhoto && <ResultTable result={count.value as LensCount} active={activeRow} onActive={setActiveRow} />}
        {count.status === 'done' && (
          <Notice>
            <p>{lens.notice}</p>
          </Notice>
        )}
        {usesMap && season && (
          <>
            <YourTurn>
              <p>Pick a cloud: click it on the map, or a row of the table under it. The walk (the openCypher above, step 3) brings its garments and every look that wears one.</p>
            </YourTurn>
            <TrendsMap map={season.map} lay={season.lay} selected={cloud?.id ?? null} onSelect={pickCloud} disabled={busy} />
            <Notice>
              <p>{TRENDS_METHODS.clouds.notice}</p>
            </Notice>
          </>
        )}
        {cloud && (
          <>
            <div className="row">
              <span className="small">
                Cloud {cloud.id + 1}: <b>{cloud.label}</b>
                {cloud.size > MAX_CLOUD_ITEMS ? ` · ${cloud.size} garments, the walk takes ${MAX_CLOUD_ITEMS}: the new shoot’s first, then the closest to its center` : ''}
              </span>
              {walk.status !== 'running' && walk.status !== 'idle' && (
                <button className="secondary small" onClick={() => walkCloud(cloud.id)} disabled={busy}>
                  {edited ? 'Walk it again with your edit' : 'Walk it again'}
                </button>
              )}
            </div>
            <Busy state={walk} text="Walking from the cloud’s garments to every look that wears them…" />
            {walk.status === 'done' && (
              <TrendsCloud cloud={walk.value} label={`Cloud ${cloud.id + 1}`} domain={domain} activeItem={activeRow} activeLook={activeLook} onItem={setActiveRow} onLook={setActiveLook} />
            )}
          </>
        )}
      </Stage>

      {/* ------------------------------------------------------------ 2. explain it */}
      {usesMap ? (
        <>
          <Stage
            n={2}
            title="Describe it"
            sub="A model describes the cloud's pieces, then how the brand wears them, citing only them."
            locked={walk.status === 'done' ? null : season ? 'Click a cloud on the map first.' : 'Draw the map first.'}
            done={described.status === 'done'}
          >
            <Lead>
              Two calls to a model. The first gets the cloud&apos;s numbered garments, with its size and lift counted in code, and names the trend. The second gets the lettered looks that wear them and
              says how the brand wears it. Every claim points back to a garment or a look: click a citation to see it.
            </Lead>
            <DescribeDeepDive modelId={describer.modelId} onModel={describer.setModelId} disabled={busy} />
            <div className="row">
              <button onClick={describeCloud} disabled={busy || walk.status !== 'done'}>
                {described.status === 'done' ? 'Describe it again' : 'Describe the cloud'}
              </button>
            </div>
            <Busy state={described} text="Two model calls side by side: one describes the pieces, one their looks (about 5 s)…" />
            {described.status === 'done' && (
              <>
                <TrendsFindings result={described.value} activeItem={activeRow} activeLook={activeLook} onItem={setActiveRow} onLook={setActiveLook} />
                <GoodToKnow title="Why this needs a graph">
                  <p>{lens.whyGraph}</p>
                </GoodToKnow>
                <Inspect
                  title="Inspect: what the model was sent, twice"
                  parts={[
                    ['the pieces: system prompt', described.value.items.system],
                    ['the pieces: the message (the only evidence)', described.value.items.user],
                    ['the looks: system prompt', described.value.looks.system],
                    ['the looks: the message (the only evidence)', described.value.looks.user],
                  ]}
                />
              </>
            )}
          </Stage>
          <LensesHowItWorks set="lens_trends" running={mapRunning} finishedAt={finishedAt} />
          <TrendsScoreboard graph={trends.history.graph} lake={trends.history.lake} clouds={cloudsRun} />
        </>
      ) : (
        <Stage
          n={2}
          title={usesPhoto ? 'Compare it, piece by piece' : 'Explain it'}
          sub={usesPhoto ? 'A helper model compares the outfit with those looks only.' : 'A model turns the numbers into a finding, citing only them.'}
          locked={counted ? null : usesPhoto ? 'Run the search and the walk first.' : 'Run the count first.'}
          done={explained.status === 'done'}
        >
          {usesPhoto ? (
            <>
              <Lead>
                Counting can&apos;t tell whether cowboy boots are close to the brand&apos;s shoes. That is a judgment, so a helper model makes it: it gets the photo and the closest looks&apos; garments from
                the walk, and nothing else about the brand. For each piece it says fits or off, and names the looks behind it.
              </Lead>
              <GoodToKnow title="The verdict is a fixed rule, not the model's word">
                <p>{VERDICT_RULE} Asked for a verdict, the model hedged (&quot;partly&quot; for every off-brand outfit). A rule over its piece-by-piece answer is steady.</p>
              </GoodToKnow>
            </>
          ) : (
            <Lead>The model gets the numbered rows above and nothing else. Every claim it makes points back to a row: click a citation to see it.</Lead>
          )}
          <div className="row">
            <button onClick={runExplain} disabled={busy || !counted}>
              {usesPhoto ? (explained.status === 'done' ? 'Compare again' : 'Compare it') : explained.status === 'done' ? 'Explain again' : 'Explain it'}
            </button>
          </div>
          <Busy state={explained} text={usesPhoto ? 'The helper is comparing the outfit with the looks (about 5 s)…' : 'The model is reading the numbers (about 5 s)…'} />
          {explained.status === 'done' && usesPhoto && (
            <>
              <PieceCheck result={explained.value as CheckPieces} looks={count.status === 'done' ? (count.value as CheckLooks).looks : []} domain={domain} active={activeLook} onActive={setActiveLook} />
              <GoodToKnow title="Why this needs a graph">
                <p>{lens.whyGraph}</p>
              </GoodToKnow>
              <Inspect
                title="Inspect: what the helper was sent, and its reply"
                parts={[
                  ['system prompt', (explained.value as CheckPieces).system],
                  ['the message (after the photo)', (explained.value as CheckPieces).user],
                  ['the reply', (explained.value as CheckPieces).reply],
                ]}
              />
            </>
          )}
          {explained.status === 'done' && !usesPhoto && (
            <>
              <Finding text={(explained.value as LensExplain).text} onCite={setActiveRow} active={activeRow} />
              <GoodToKnow title="Why this needs a graph">
                <p>{lens.whyGraph}</p>
              </GoodToKnow>
              <Inspect
                title="Inspect: what the model was sent"
                parts={[
                  ['system prompt', (explained.value as LensExplain).system],
                  ['the message (the only evidence)', (explained.value as LensExplain).user],
                ]}
              />
            </>
          )}
        </Stage>
      )}
      <div className="card">
        <h3>That is the end of the hands-on: what to take away</h3>
        <Takeaways />
      </div>
      <NextTab to="setup" lead="Back to">
        <p>Tab 0 has the white sneakers question and the overview, if you want to look back.</p>
      </NextTab>
    </div>
  );
}

// the outfits' thumbnails, fetched once per page (`<domain>/<file>` → data URL, null when it failed)
const thumbCache = new Map<string, Promise<string | null>>();

/** One of the domain's example photos by name (`GET /api/ontologies/example-image`), loaded lazily, with a quiet placeholder while it loads or when it is missing. */
function ExamplePhoto({ domain, file, alt }: { domain: string; file: string; alt: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const k = `${domain}/${file}`;
    let p = thumbCache.get(k);
    if (!p) {
      p = api.exampleImage(domain, file).then(
        (r) => r.data_url,
        () => null,
      );
      thumbCache.set(k, p);
    }
    let live = true;
    setSrc(undefined);
    p.then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [domain, file]);
  if (!src) return <span className="ln-photo-img placeholder" role="img" aria-label={src === null ? `${alt}: no photo` : `${alt}: loading`} />;
  return <img className="ln-photo-img" src={src} alt={alt} loading="lazy" />;
}

/** The numbers: a headline, then a numbered table (the first number column drawn as bars). Clicking a row marks it. */
const LIST_TITLE: Record<string, string> = { staple: 'Staples: the clothes and shoes worn together most', signature: 'Signatures: worn together far more than chance (5+ looks)' };

function ResultTable({ result, active, onActive }: { result: LensCount; active: number | null; onActive: (n: number | null) => void }) {
  // a `list` column splits the rows into groups (the pairings' staples and signatures): a heading row each, not a cell
  const grouped = result.columns[0] === 'list';
  const shown = grouped ? result.columns.slice(1) : result.columns;
  const cells = (row: LensCell[]) => (grouped ? row.slice(1) : row);
  const bar = shown.findIndex((_, j) => result.rows.some((r) => typeof cells(r)[j] === 'number'));
  const max = bar < 0 ? 0 : Math.max(...result.rows.map((r) => Number(cells(r)[bar]) || 0), 1);
  return (
    <div className="ln-result">
      <p className="ln-headline">{result.headline}</p>
      <p className="muted small">
        {(result.ms / 1000).toFixed(1)} s{result.pieces ? ` · ${result.pieces} pieces found by vector search` : ''}
        {result.start_garments ? ` · the piece you typed found ${result.start_garments} garments` : ''}
        {result.edited ? ' · your edited query' : ''}
      </p>
      {result.rows.length > 0 && (
        <table className="metrics compact">
          <thead>
            <tr>
              <th>#</th>
              {shown.map((c) => (
                <th key={c}>{c.replace(/_/g, ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => [
              grouped && (i === 0 || result.rows[i - 1][0] !== row[0]) && (
                <tr key={`g${i}`} className="static ln-group">
                  <td colSpan={shown.length + 1}>{LIST_TITLE[String(row[0])] ?? String(row[0])}</td>
                </tr>
              ),
              <tr key={i} className={active === i + 1 ? 'active' : ''} onClick={() => onActive(active === i + 1 ? null : i + 1)}>
                <td className="muted">{i + 1}</td>
                {cells(row).map((cell, j) => (
                  <td key={j}>
                    {j === bar ? (
                      <span className="ln-bar-cell">
                        <span className="ln-bar-track">
                          <span className="ln-bar" style={{ width: `${(Number(cell) / max) * 100}%` }} />
                        </span>
                        <span>{String(cell)}</span>
                      </span>
                    ) : (
                      String(cell ?? '')
                    )}
                  </td>
                ))}
              </tr>,
            ])}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The photo lens after the search and the walk: how close the outfit is, and the closest looks with what they wear. */
function ClosestLooks({ check, domain, active, onActive }: { check: CheckLooks; domain: string; active: string | null; onActive: (l: string | null) => void }) {
  const photos = useLookPhotos(check.looks, domain);
  return (
    <div className="ln-result">
      <p className="ln-headline">
        The 5 closest looks are {check.mean_distance.toFixed(2)} away on average{' '}
        <span className="muted small">(the brand&apos;s own photos sit about 0.6 from their closest looks; lower is closer)</span>
      </p>
      <p className="muted small">
        {(check.ms / 1000).toFixed(1)} s · the photo as {check.vector.dimension.toLocaleString()} numbers{check.edited ? ' · your edited walk' : ''}
      </p>
      <div className="ln-looks">
        {check.looks.map((l) => (
          <LookCard key={l.letter} look={l} photo={photos[l.id]} active={active === l.letter} onClick={() => onActive(active === l.letter ? null : l.letter)} />
        ))}
      </div>
    </div>
  );
}

/**
 * The closest looks' photos, by the same source preview tabs 3 and 5 use: it reads every kind of
 * photo key (the lookbook's stored photos, tab 2's example photos, a participant's uploads), not
 * only the stored ones. Undefined while loading; null when the look has no photo.
 */
function useLookPhotos(looks: CheckLook[], domain: string): Record<string, string | null | undefined> {
  const sources = useLookSources(
    looks.map((l) => l.id),
    domain,
  );
  return Object.fromEntries(looks.map((l) => [l.id, sources[l.id] ? (sources[l.id].photo?.data_url ?? null) : undefined]));
}

/** One of the closest looks: its photo, letter, occasion, distance and what it wears. */
function LookCard({ look, photo, active, onClick }: { look: CheckLook; photo: string | null | undefined; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ln-look${active ? ' active' : ''}`} onClick={onClick}>
      {photo ? (
        <img className="ln-look-img" src={photo} alt={`look ${look.letter}`} loading="lazy" />
      ) : (
        <span className="ln-look-img placeholder" role="img" aria-label={photo === null ? `look ${look.letter}: no photo` : `look ${look.letter}: loading`} />
      )}
      <span className="ln-look-head">
        <b>Look {look.letter}</b> · {look.occasion ?? 'no occasion'} · {look.distance.toFixed(2)}
      </span>
      <span className="ln-look-garments">
        {look.garments.slice(0, 6).join(' · ')}
        {look.garments.length > 6 ? ` · +${look.garments.length - 6} more` : ''}
      </span>
    </button>
  );
}

/** The photo lens after the helper: the verdict (the rule), then each piece, fits or off, with its looks. */
function PieceCheck({ result, looks, domain, active, onActive }: { result: CheckPieces; looks: CheckLook[]; domain: string; active: string | null; onActive: (l: string | null) => void }) {
  const photos = useLookPhotos(looks, domain);
  const main = result.pieces.filter((x) => x.main);
  const off = main.filter((x) => !x.fits).length;
  return (
    <div className="ln-result">
      <div className={`ln-verdict ln-expect-${result.verdict}`}>
        <b>{VERDICT_LINE[result.verdict]}</b>
        <span>
          {off} of {main.length} main pieces off
        </span>
        <span className="muted small">{(result.ms / 1000).toFixed(1)} s</span>
      </div>
      <table className="metrics compact">
        <thead>
          <tr>
            <th>piece</th>
            <th></th>
            <th>the looks</th>
            <th>why</th>
          </tr>
        </thead>
        <tbody>
          {result.pieces.map((x) => (
            <tr key={x.piece} className={`static${x.fits ? '' : ' ln-off'}`}>
              <td>
                {x.piece}
                {!x.main && <div className="muted small">accessory, not counted</div>}
              </td>
              <td>
                <span className={`ln-fit ${x.fits ? 'yes' : 'no'}`}>{x.fits ? 'fits' : 'off'}</span>
              </td>
              <td>
                {x.looks.map((l) => (
                  <button key={l} type="button" className={`ln-cite${active === l ? ' active' : ''}`} onClick={() => onActive(active === l ? null : l)} title={`look ${l}`}>
                    {l}
                  </button>
                ))}
              </td>
              <td>{x.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">{result.summary}</p>
      {looks
        .filter((l) => l.letter === active)
        .map((l) => (
          <div key={l.letter} className="ln-look-pop">
            <LookCard look={l} photo={photos[l.id]} active onClick={() => onActive(null)} />
          </div>
        ))}
    </div>
  );
}

/** The model's finding, with each [n] drawn as a link to row n. */
function Finding({ text, active, onCite }: { text: string; active: number | null; onCite: (n: number | null) => void }) {
  return (
    <div className="ln-finding">
      <div className="po-who-label">The finding</div>
      <p>
        {splitCitations(text).map((part, i) =>
          typeof part === 'number' ? (
            <button key={i} type="button" className={`ln-cite${active === part ? ' active' : ''}`} onClick={() => onCite(active === part ? null : part)} title={`row ${part}`}>
              {part}
            </button>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  );
}
