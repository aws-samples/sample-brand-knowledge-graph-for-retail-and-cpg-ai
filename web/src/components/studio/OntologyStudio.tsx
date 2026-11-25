// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useState } from 'react';
import type { OntoNode } from '../../api';
import { GoodToKnow, Lead, Notice, YourTurn } from '../retriever/Callouts';
import { NextTab } from '../shared/NextTab';
import { Stage } from '../shared/Stage';
import { useModelChoice } from '../shared/useModels';
import { ArchitecturePanel } from './ArchitecturePanel';
import { boxesOf, ImageCanvas, type Box } from './ImageCanvas';
import { localName, OntologyGraph } from './OntologyGraph';
import { OntologyFile } from './OntologyFile';
import { BoxInOntology, OntologyDetails } from './OntologyPanel';
import { RunDetails, RunTabs } from './ResultsPanel';
import { OtherAisles } from './OtherAisles';
import { PhotoBar } from './StudioToolbar';
import { useClassification } from './useClassification';
import { useImageChoice } from './useImageChoice';
import { useOntologyChoice } from './useOntologyChoice';

/** The map in step 1 highlights one name at a time (the focus), never a whole box. */
const NO_HIGHLIGHT = new Set<string>();

/**
 * The words step 1 suggests looking up (the ontology's local names, shown as their button text):
 * a kind of garment, one of its details, a part, then values the session's questions use.
 */
const SUGGESTED: [string, string][] = [
  ['Coat', 'Coat'],
  ['hasLength', 'hasLength'],
  ['Lapel', 'Lapel'],
  ['nickname_blazer', 'blazer'],
  ['silhouette_wide-leg', 'wide leg'],
  ['Shoe', 'Shoe'],
  ['textile-finishing-manufacturing-techniques_pleat', 'pleat'],
];

/**
 * Tab 1, "Ontology explorer": where the session's line starts (a photo, what the model sees in it,
 * the graph). The tab opens on step 1; there is no intro. Four steps:
 *
 *   1 Meet the ontology              : what it holds (the four counts), look up a word (search,
 *                                      suggested words, or a click in the map: OntologyGraph, one
 *                                      name at a time), everything the ontology says about it
 *                                      (OntologyDetails, inline), and the file itself in a
 *                                      line-numbered viewer that jumps to the selected term's
 *                                      definition (OntologyFile, in the Inspect expander)
 *   2 Use a multimodal vision model  : the photo and the vision model, one button each (PhotoBar),
 *                                      Classify; the photo with its boxes, and next to it the
 *                                      selected box, named with the ontology's terms (BoxInOntology)
 *   3 The model's answer after the   : the entities named with the ontology's terms, the check's
 *     ontology check                   removals struck through, what the ontology could not express,
 *                                      and the prompt, reply and request (RunDetails)
 *   4 Explore possible ontologies    : the same shape in the browse-only domains of ontologies/,
 *     for other retail domains         read from the API (OtherAisles)
 *
 * How it works sits between steps 3 and 4; the hand-off to tab 2 comes last. Prompt caching is
 * always on. Click a box and it shows next to the photo, named with the ontology's terms; click a
 * name (there, in the map or the details) and the boxes that use it light up on the photo. The
 * server round trips live in three hooks: the ontology (useOntologyChoice), the image
 * (useImageChoice) and the classify calls, cached per (ontology, image, model, caching)
 * (useClassification). The results, the image and the result shown outlive a switch to another tab
 * and a reload (studioCache.ts); the model is remembered like the other tabs'.
 */
const MODEL_KEY = 'studio.model';

export function OntologyStudio({ domain }: { domain: string }) {
  const [query, setQuery] = useState('');
  const [focusNode, setFocusNode] = useState<OntoNode | null>(null);
  const [browsed, setBrowsed] = useState(false);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [showParts, setShowParts] = useState(true);
  const [archOpen, setArchOpen] = useState(false);
  // prompt caching is always on: the ontology prompt is the same for every photo
  const promptCaching = true;
  const { models, modelId, setModelId, error: modelsError } = useModelChoice('vision', MODEL_KEY);
  const ontology = useOntologyChoice(domain);
  const image = useImageChoice(() => resetSelection(), domain);
  const runs = useClassification(ontology, image);
  const { detail, examples } = ontology;
  const { shown, shownResult } = runs;
  // The first example photo of the domain is the default image, so the tab is ready to classify
  // as soon as it opens (a deployed run showed "Classify" greyed out until a photo was chosen).
  // A remembered image (studioCache.ts) wins; if it can no longer be read, the default follows.
  useEffect(() => {
    if (!image.image && !image.loading && examples.list.length) image.pickExample(examples.from, examples.list[0]);
  }, [examples.from, examples.list, image.loading]);

  function resetSelection() {
    setSelectedBox(null);
    setFocusNode(null);
    runs.showNone();
  }
  /** Select an ontology element (graph click, search hit, chip in the details) and show its details in step 1. */
  function selectNode(n: OntoNode | null, fromGraph = false) {
    setFocusNode(n);
    setSelectedBox(null);
    if (n) setBrowsed(true);
    if (n && !fromGraph) document.getElementById('ontology-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** A name in the box view: its details in step 1, the box stays selected. */
  function openDetails(n: OntoNode | null) {
    if (!n) return;
    setFocusNode(n);
    setBrowsed(true);
    document.getElementById('ontology-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------------------------------------------------------------- bidirectional highlighting
  const boxes = useMemo(() => (shownResult ? boxesOf(shownResult.entities) : []), [shownResult]);
  const activeBoxes = useMemo(() => {
    const s = new Set<string>();
    if (selectedBox) s.add(selectedBox.key);
    if (focusNode) {
      const iri = focusNode.id;
      for (const b of boxes) {
        const e = b.entity;
        const hit =
          b.kind === 'part'
            ? b.part?.class_iri === iri || b.part?.relation_iri === iri
            : e.class_iri === iri || Object.keys(e.attribute_iris).includes(iri) || Object.values(e.attribute_iris).includes(iri) || e.parts.some((p) => p.class_iri === iri);
        if (hit) s.add(b.key);
      }
    }
    return s;
  }, [selectedBox, focusNode, boxes]);

  // ---------------------------------------------------------------- search in the ontology
  const matches = useMemo(() => {
    if (!detail || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return detail.view.nodes.filter((n) => localName(n.id).toLowerCase().includes(q) || n.label.toLowerCase().includes(q) || (n.pref_label ?? '').toLowerCase().includes(q)).slice(0, 12);
  }, [detail, query]);
  const suggested = useMemo(
    () => SUGGESTED.map(([name, text]) => ({ node: detail?.view.nodes.find((n) => localName(n.id) === name), text })).filter((s): s is { node: OntoNode; text: string } => !!s.node),
    [detail],
  );
  const look = (name: string) => () => {
    const n = detail?.view.nodes.find((x) => localName(x.id) === name);
    if (n) selectNode(n);
  };

  const img = image.image;
  const error = modelsError || ontology.error || image.error;
  const imageName = img ? (img.kind === 'example' ? img.title : img.name) : 'Photo';

  return (
    <>
      {/* the other tabs open with a visible h2; kept outside .stack so its sibling spacing does not move step 1 */}
      <h2 className="sr-only">Ontology explorer</h2>
      <div className="stack studio">
        {error && <p className="error">{error}</p>}

        {/* ------------------------------------------------------------ 1. meet the ontology */}
        <Stage n={1} title="Meet the ontology" sub="The kinds of garment, their details, and the values each detail allows." locked={null} done={browsed}>
          <Lead>
            An ontology is a shared vocabulary that lists the kinds of garment (coat, trousers, shoe), the details each kind can have (length, neckline, silhouette) and the values each detail allows
            (mini, midi, maxi). The vision model may answer only with these words, so a midi skirt is <i>midi</i> in every look and you can count midi skirts across the whole graph later.
          </Lead>
          {detail ? (
            <dl className="counts">
              <div className="count">
                <dt>kinds the model may name</dt>
                <dd>
                  <b>{detail.entity_classes}</b>
                </dd>
              </div>
              <div className="count">
                <dt>families of detail</dt>
                <dd>
                  <b>{detail.value_classes}</b>
                </dd>
              </div>
              <div className="count">
                <dt>allowed values</dt>
                <dd>
                  <b>{detail.stats.individuals}</b>
                </dd>
              </div>
              <div className="count">
                <dt>as a prompt</dt>
                <dd>
                  <b>≈ {detail.prompt_tokens_estimate.toLocaleString()}</b> tokens
                </dd>
              </div>
            </dl>
          ) : (
            ontology.loading && (
              <p className="muted">
                <span className="spinner" aria-hidden="true" /> Reading the ontology…
              </p>
            )
          )}
          <YourTurn>
            <ol className="po-intro-steps">
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('Coat')}>
                  <b>Coat</b>
                </button>
                . The list is what the model can say about a coat (its length, silhouette, opening and parts).
              </li>
              <li>
                Click{' '}
                <button type="button" className="linklike" onClick={look('hasLength')}>
                  <b>hasLength</b>
                </button>{' '}
                in that list. These are the only lengths the model may answer with.
              </li>
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('Lapel')}>
                  <b>Lapel</b>
                </button>
                . It is a part, linked to the garment by <code>hasPart</code>.
              </li>
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('nickname_blazer')}>
                  <b>blazer</b>
                </button>
                . Here blazer is a value, not a kind of garment. The model says <i>jacket</i>, with the nickname <i>blazer</i>.
              </li>
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('silhouette_wide-leg')}>
                  <b>wide leg</b>
                </button>
                , a silhouette. See which detail accepts it and which kinds of garment can have it.
              </li>
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('Shoe')}>
                  <b>Shoe</b>
                </button>
                . This ontology has no <i>sneaker</i>. White sneakers are a shoe, and &ldquo;white sneakers&rdquo; is only the label the model writes. Remember this for tab 4.
              </li>
              <li>
                Look up{' '}
                <button type="button" className="linklike" onClick={look('textile-finishing-manufacturing-techniques_pleat')}>
                  <b>pleat</b>
                </button>
                . It is a finishing, so a pleated skirt is a skirt with the finishing <i>pleat</i>.
              </li>
            </ol>
          </YourTurn>
          <div className="row explore-filter" style={{ position: 'relative' }}>
            <input className="po-question" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Look up a word, e.g. coat, midi, lapel, hasSilhouette" aria-label="search the ontology" />
            {suggested.map(({ node: n, text }) => (
              <button key={n.id} className={`small secondary${focusNode?.id === n.id ? ' active' : ''}`} aria-pressed={focusNode?.id === n.id} onClick={() => selectNode(n)}>
                {text}
              </button>
            ))}
            {matches.length > 0 && (
              <div className="search-pop">
                {matches.map((n) => (
                  <button
                    key={n.id}
                    className="secondary small"
                    onClick={() => {
                      selectNode(n);
                      setQuery('');
                    }}
                  >
                    <span className={`pill kind-${n.kind}`}>{n.kind === 'individual' ? 'value' : n.kind}</span> {localName(n.id)}
                    {n.label && n.label.toLowerCase() !== localName(n.id).toLowerCase() ? ` (${n.label})` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          {detail && <OntologyGraph view={detail.view} highlight={NO_HIGHLIGHT} focus={focusNode?.id ?? null} height={460} onNodeClick={(n) => n && selectNode(n)} />}
          <OntologyDetails detail={detail} node={focusNode} hitCount={focusNode ? activeBoxes.size : 0} onNavigate={(n) => selectNode(n)} />
          {detail && !ontology.isUpload && <OntologyFile key={ontology.ontologyId} ontologyId={ontology.ontologyId} file={detail.file} node={focusNode} />}
          <Notice>
            <p>
              The vocabulary is closed. For a coat&apos;s length the model may answer only with one of the allowed values. Anything else fails the check in step 3, so the same garment gets the same words in
              every photo.
            </p>
            <p>
              <b>In CPG:</b> swap the ontology. A beauty ontology lists product types (serum, cleanser, SPF), ingredients, finishes and skin concerns, so the same call reads a product shot or a regimen photo
              in those words. The last step of this tab shows one.
            </p>
          </Notice>
        </Stage>

        {/* ------------------------------------------------------------ 2. the photo through a vision model */}
        <Stage n={2} title="Use a multimodal vision model to break the photo down into the ontology's terms" sub="The ontology is the model's instructions and the photo is the question." locked={null} done={!!shownResult}>
          <Lead>
            Press <b>Classify</b>. The model on Amazon Bedrock gets the ontology as its instructions and the photo.
          </Lead>
          <PhotoBar ontology={ontology} image={image} runs={runs} models={models} modelId={modelId} onModel={setModelId} promptCaching={promptCaching} />
          <div className="studio-grid">
            <div className="card">
              <h3 style={{ margin: '0 0 0.4rem' }}>{selectedBox ? 'How the model named this box' : 'What a box means'}</h3>
              {selectedBox ? (
                <>
                  <BoxInOntology detail={detail} box={selectedBox} onNavigate={openDetails} />
                  <p className="muted small">Click a name to see its details in step 1. Click another box on the photo to see it here.</p>
                </>
              ) : (
                <p className="muted">{shownResult ? 'Click a box on the photo. Its kind, each detail with the value the model picked, and its parts show here.' : 'Press Classify, then click a box on the photo to see how the model named that garment.'}</p>
              )}
            </div>

            <div className="card">
              <div className="row" style={{ alignItems: 'center', marginBottom: '0.4rem' }}>
                <h3 style={{ margin: 0, flex: '1 1 auto' }}>{imageName}</h3>
                <label className="check" style={{ flex: '0 0 auto' }}>
                  <input type="checkbox" checked={showParts} onChange={(e) => setShowParts(e.target.checked)} /> show parts
                </label>
                {shownResult && (
                  <span className="muted" style={{ flex: '0 0 auto' }}>
                    {shownResult.model.name} · {shownResult.entities.length} entities · {boxes.filter((b) => b.kind === 'part').length} parts
                  </span>
                )}
              </div>
              <ImageCanvas
                src={img?.dataUrl ?? null}
                boxes={boxes}
                active={activeBoxes}
                showParts={showParts}
                onSelect={(b) => {
                  setSelectedBox(b);
                  setFocusNode(null);
                }}
                onHover={() => undefined}
              />
              {shown?.status === 'running' && (
                <p className="muted" role="status">
                  <span className="spinner" aria-hidden="true" /> Calling {models.find((m) => m.id === runs.activeKey.split('|')[2])?.name ?? 'the model'}…
                </p>
              )}
              {shown?.status === 'error' && <p className="error">{shown.error}</p>}
              {!img && <p className="muted">Pick an example photo or upload one to get started.</p>}
              {!shownResult && img && shown?.status !== 'running' && !runs.anyRunning && <p className="muted">Press Classify above.</p>}
            </div>
          </div>
          <YourTurn>
            <p>
              When the boxes appear, click one on the photo. The left side shows how the model named it: its kind, each detail with the value it picked, and its parts. Click a name there. Its
              details open in step 1, and every box that uses it lights up on the photo. Then try another photo, or your own.
            </p>
          </YourTurn>
        </Stage>

        {/* ------------------------------------------------------------ 3. the answer after the check */}
        <Stage n={3} title="The model's answer after the ontology check" sub="What passed, what failed and what was sent." locked={shownResult ? null : 'Classify a photo in step 2 first.'} done={!!shownResult}>
          <RunTabs runs={runs.runList} models={models} activeKey={runs.activeKey} onSelect={runs.setActiveKey} />
          {shown?.status === 'error' && <p className="error">{shown.error}</p>}
          {shownResult && <RunDetails result={shownResult} detail={detail} onRerun={runs.rerun} />}
          <Notice>
            <p>
              Every kind and value in the table is a word of the ontology, so it can become a node in the graph. When the model strays, the check says so instead of letting a new word in. The same detail
              always has the same name, so the graph stays countable.
            </p>
          </Notice>
          <GoodToKnow>
            <p>
              The model sees the ontology and the current photo only. It does not see the graph&apos;s data, that is, how other photos were classified, and it does not see the graph&apos;s own classes (Look,
              Item, Article, Statement, Brand). In tab 2 the pipeline turns its answer into a look and its garments and merges them into Amazon Neptune Analytics.
            </p>
          </GoodToKnow>
        </Stage>

        {/* ------------------------------------------------------------ how it works */}
        <ArchitecturePanel runs={runs.allRuns} models={models} detail={detail} ontologyId={ontology.isUpload ? examples.from : ontology.ontologyId} open={archOpen} onToggle={setArchOpen} />

        {/* ------------------------------------------------------------ 4. other retail domains */}
        <OtherAisles fashion={detail} />

        {/* ------------------------------------------------------------ next */}
        <NextTab to="ingest">
          <p>
            Here one photo went through one model call. Tab 2 sends the brand&apos;s new shoot through the same call, checks each answer the same way, and merges the looks into
            the graph.
          </p>
        </NextTab>
      </div>
    </>
  );
}
