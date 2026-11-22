// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isStoredPhotoKey, type DomainInfo, type Summary } from '../../api';
import { Inspect } from '../payoff/parts';
import { QUERY_EXAMPLES } from '../query/examples';
import { GraphQuery } from '../query/GraphQuery';
import { GoodToKnow, InCpg, Lead, Notice, YourTurn } from '../retriever/Callouts';
import { NextTab } from '../shared/NextTab';
import { Stage } from '../shared/Stage';
import { loadStoredPhoto } from '../shared/StoredPhoto';
import { GraphWeb, WEB_COLORS } from './GraphWeb';
import { adjacency, describe, lightUp, search, type Web } from './webView';

// The brand's looks (what they are made of) and the ontology (the vocabulary), as labels.
const DNA = ['Look', 'Item', 'Occasion', 'Article', 'Statement', 'Brand'];
const LABEL_NAME: Record<string, string> = { Item: 'garments', Look: 'looks', Occasion: 'occasions', Article: 'articles', Statement: 'statements', Brand: 'brand', Category: 'categories', Attribute: 'details (attribute values)', AttributeFamily: 'attribute families', Group: 'groups' };
const KIND: Record<string, string> = { Look: 'Look', Item: 'Garment', Category: 'Kind of garment', Occasion: 'Occasion', Attribute: 'Detail', Statement: 'Text about a look', Article: 'Article' };
// photos fetched for lit looks at most
const MAX_PHOTOS = 40;

/** A look's photo as a data URL: an example photo of the domain (a look ingested in tab 2) or one of the brand's stored photos. */
async function photoOf(domain: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  if (key.startsWith('example:')) return api.exampleImage(domain, key.slice('example:'.length)).then((r) => r.data_url, () => null);
  if (isStoredPhotoKey(key)) return loadStoredPhoto(key);
  return null;
}

/**
 * "Explore the graph": the whole graph, the brand's lookbook and what tab 2 added. Three
 * steps: what the graph holds (looks and garments next to the ontology's vocabulary); the web
 * (every look, garment, kind of garment, occasion and text as one graph: search a garment or click
 * a node and what it connects lights up); query it yourself, in openCypher or in plain words (the
 * query console and its agent on the Amazon Neptune MCP server).
 */
export function ExploreGraph({ domain, dataVersion }: { domain: string; wording: DomainInfo; dataVersion: number }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [web, setWeb] = useState<Web | null>(null);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [focus, setFocus] = useState(0);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    api.summary().then((s) => live && setSummary(s), (e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [dataVersion]);
  useEffect(() => {
    let live = true;
    setError('');
    api.graphWeb(details).then((w) => live && setWeb(w), (e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [dataVersion, details]);

  const adj = useMemo(() => (web ? adjacency(web) : null), [web]);
  const hits = useMemo(() => (adj && searched ? search(adj, searched) : null), [adj, searched]);
  const lit = useMemo(() => {
    if (!adj) return null;
    if (selected) return lightUp(adj, selected);
    if (hits) return new Set([...hits.garments, ...hits.looks]);
    return null;
  }, [adj, selected, hits]);

  // the photos of what is lit (looks), and of the selected look, for the canvas and the panel
  useEffect(() => {
    if (!adj || !lit) return;
    const keys = [...lit]
      .map((id) => adj.byId.get(id))
      .filter((n) => n?.label === 'Look' && n.image_key)
      .slice(0, MAX_PHOTOS)
      .map((n) => n!.image_key!)
      .filter((k) => !(k in photos));
    let live = true;
    // a photo that cannot be loaded is kept as '' so the panel says so instead of waiting
    keys.forEach((k) => photoOf(domain, k).then((url) => live && setPhotos((p) => ({ ...p, [k]: url ?? '' }))));
    return () => {
      live = false;
    };
  }, [lit]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((id: string | null) => {
    setSelected(id);
    setFocus((f) => f + 1);
  }, []);
  const runSearch = (text: string) => {
    setQuery(text);
    setSearched(text.trim());
    setSelected(null);
    setFocus((f) => f + 1);
  };
  const clear = () => {
    setQuery('');
    setSearched('');
    setSelected(null);
    setFocus((f) => f + 1);
  };
  const firstOf = (label: string, test: (name: string, run: string | null) => boolean = () => true) => web?.nodes.find((n) => n.label === label && test(n.name ?? '', n.run))?.id ?? null;
  const addedSneakerLook = adj
    ? (web?.nodes.find((n) => n.label === 'Look' && n.run && (adj.out.get(n.id) ?? []).some((e) => e.type === 'CONTAINS' && /white.*sneaker/i.test(adj.byId.get(e.target)?.name ?? '')))?.id ?? null)
    : null;

  const counts = summary?.nodes ?? {};
  const dna = DNA.filter((l) => counts[l]);
  const vocabulary = Object.keys(counts).filter((l) => !DNA.includes(l));
  const added = web?.nodes.filter((n) => n.label === 'Look' && n.run).length ?? 0;

  return (
    <div className="stack">
      <div className="card">
        <h2>Explore the graph</h2>
        <Lead>
          You saw one photo become nodes in tab 1, and a batch of them land in tab 2. This tab is the whole graph: the brand&apos;s lookbook and everything you added. See what it holds, explore it as one
          web of relationships, then query it yourself, in openCypher or in plain words.
        </Lead>
        <p className="muted tab-uses">Uses the graph, with the looks tab 2 added.</p>
        {error && <p className="error">{error}</p>}
      </div>

      {/* ------------------------------------------------------------ 1. what the graph holds */}
      <Stage n={1} title="What the graph holds" sub="The brand's looks and the ontology's vocabulary, in one graph." locked={null} done={!!summary}>
        {summary ? (
          <>
            <div className="po-sec-label">The brand&apos;s looks: what they are made of</div>
            <dl className="counts">
              {dna.map((l) => (
                <div key={l} className="count">
                  <dt>{LABEL_NAME[l] ?? l}</dt>
                  <dd>
                    <b>{counts[l].toLocaleString()}</b>
                  </dd>
                </div>
              ))}
              {added > 0 && (
                <div className="count watch">
                  <dt>looks you added in tab 2</dt>
                  <dd>
                    <b>{added}</b>
                  </dd>
                </div>
              )}
            </dl>
            <div className="po-sec-label">The ontology: the vocabulary every garment is described in</div>
            <dl className="counts">
              {vocabulary.map((l) => (
                <div key={l} className="count">
                  <dt>{LABEL_NAME[l] ?? l}</dt>
                  <dd>
                    <b>{counts[l].toLocaleString()}</b>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          !error && (
            <p className="muted">
              <span className="spinner" /> Counting the graph…
            </p>
          )
        )}
      </Stage>

      {/* ------------------------------------------------------------ 2. the web */}
      <Stage n={2} title="The web: every look, connected" sub="All those photos and texts, as one graph of relationships." locked={null} done={!!selected || !!searched}>
        <Lead>
          This is every look of the brand and every garment in them, as one graph. Each orange dot is a look, each grey one a garment. The blue nodes are kinds of garment and the purple ones occasions.
          The pipeline drew every link from what the model found in the photos and texts.
        </Lead>
        <YourTurn>
          <ol className="po-intro-steps">
            <li>
              Search <b>white sneaker</b>: every look with white sneakers lights up, with its photo.
            </li>
            <li>
              Click a look you added in tab 2 (a teal ring){addedSneakerLook && (
                <>
                  {' '}
                  or{' '}
                  <button type="button" className="linklike" onClick={() => pick(addedSneakerLook)}>
                    open one with white sneakers
                  </button>
                </>
              )}
              : its garments, their kinds and its occasion light up.
            </li>
            <li>
              Click its shoe&apos;s <b>kind</b> (the blue node): now every look with that kind of shoe lights up, from the whole lookbook.
            </li>
          </ol>
        </YourTurn>
        <div className="row explore-filter">
          <input className="po-question" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch(query)} placeholder="Search a garment, e.g. white sneaker" aria-label="search a garment" />
          <button onClick={() => runSearch(query)} disabled={!query.trim()}>
            Search
          </button>
          {['white sneaker', 'black blazer', 'gold hoop'].map((q) => (
            <button key={q} className="small secondary" onClick={() => runSearch(q)}>
              {q}
            </button>
          ))}
          <button className="small secondary" onClick={() => pick(firstOf('Occasion', (n) => n === 'Professional'))}>
            Professional looks
          </button>
          {web?.nodes.some((n) => n.label === 'Statement') && (
            <button className="small secondary" onClick={() => pick(firstOf('Statement'))}>
              a text about a look
            </button>
          )}
          {(selected || searched) && (
            <button className="small secondary" onClick={clear}>
              Show everything
            </button>
          )}
          <label className="check" title="Adds the attribute values (wide leg, metal, plain…) as nodes: more links, a denser web">
            <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> show details
          </label>
        </div>
        {hits && !selected && (
          <p className="small">
            <b>“{searched}”</b>: {hits.garments.length} garment{hits.garments.length === 1 ? '' : 's'} in <b>{hits.looks.length}</b> look{hits.looks.length === 1 ? '' : 's'}.
          </p>
        )}
        {!web && !error && (
          <p className="muted">
            <span className="spinner" /> Loading the whole graph…
          </p>
        )}
        {web && adj && (
          <div className="explore-grid">
            <GraphWeb web={web} adj={adj} lit={lit} selected={selected} onPick={pick} photos={photos} focus={focus} />
            <WebDetails adj={adj} id={selected} photos={photos} onPick={pick} />
          </div>
        )}
        <Notice>
          <p>
            Looks never link to each other directly. They meet through what they share: a kind of garment, a detail, an occasion. That is the walk GraphRAG makes in tab 4: from a garment to every look
            it is in, and to what else is worn there.
          </p>
        </Notice>
        <InCpg>
          <p>Regimens meet the same way. Click a vitamin C serum and every routine it is in lights up, with the cleanser before it and the SPF after it.</p>
        </InCpg>
        {web && <Inspect title="Inspect: the openCypher that loaded this web" parts={web.cypher.map((q, i) => [['the nodes', 'the relationships', 'the details'][i] ?? `statement ${i + 1}`, q] as [string, string])} />}
      </Stage>

      {/* ------------------------------------------------------------ 3. query it yourself */}
      <Stage n={3} title="Query it yourself: openCypher, or plain words" sub="The same graph, any question. Read-only." locked={null} done={false}>
        <GraphQuery title="explorer" examples={QUERY_EXAMPLES} dataVersion={dataVersion} guided />
        <GoodToKnow>
          <p>The agent runs on Amazon Bedrock AgentCore Runtime with the Neptune MCP server, read-only.</p>
        </GoodToKnow>
      </Stage>
      <NextTab to="ask">
        <p>You walked the graph by hand. Tab 4 turns that walk into a retriever: a catalog search, RAG on it, then GraphRAG on the graph walk.</p>
      </NextTab>
    </div>
  );
}

/** The side panel: what the clicked node is, its counts, and the looks or garments it links to (click to go there). */
function WebDetails({ adj, id, photos, onPick }: { adj: ReturnType<typeof adjacency>; id: string | null; photos: Record<string, string>; onPick: (id: string) => void }) {
  if (!id)
    return (
      <aside className="po-detail po-detail-empty">
        <p className="muted small">Click a node to see what it is and what it connects to. Search a garment to light up every look it is in.</p>
      </aside>
    );
  const n = adj.byId.get(id);
  if (!n) return null;
  const d = describe(adj, id);
  const photo = n.image_key ? photos[n.image_key] : undefined;
  const photoNote = !n.image_key ? 'No photo stored for this look.' : photo === '' ? 'The photo could not be loaded.' : 'Loading the photo…';
  const listed = (d.looks.length ? d.looks : d.garments).slice(0, 24);
  return (
    <aside className="po-detail">
      <div className="po-detail-kind" style={{ background: WEB_COLORS[n.label] ?? '#999', color: '#fff' }}>
        {KIND[n.label] ?? n.label}
        {n.run && n.label === 'Look' ? ' · added in tab 2' : ''}
      </div>
      {n.label === 'Look' && (photo ? <img className="po-detail-photo" src={photo} alt={n.name ?? 'the look'} /> : <p className="muted small">{photoNote}</p>)}
      <p>
        <b>{n.name}</b>
      </p>
      {d.line && <p className="small">{d.line}</p>}
      {listed.length > 0 && (
        <>
          <div className="po-inspect-label">{d.looks.length ? 'the looks' : 'its garments'} (click one)</div>
          <ul className="po-detail-list">
            {listed.map((x) => {
              const m = adj.byId.get(x);
              return (
                <li key={x}>
                  <button type="button" className="linklike" onClick={() => onPick(x)}>
                    {m?.name ?? x}
                  </button>
                </li>
              );
            })}
            {(d.looks.length || d.garments.length) > listed.length && <li className="muted">… {(d.looks.length || d.garments.length) - listed.length} more</li>}
          </ul>
        </>
      )}
      {n.label === 'Look' && d.garments.length > 0 && (
        <p className="muted small">Click a garment, then its kind, to walk from this look to every other look that shares it.</p>
      )}
    </aside>
  );
}
