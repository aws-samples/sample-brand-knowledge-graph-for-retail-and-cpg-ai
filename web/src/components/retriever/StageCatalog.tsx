// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type CatalogHit, type CatalogInfo, type CatalogItem, type CatalogQuery, type VectorPreview } from '../../api';
import { Busy, runInto, type Async } from '../payoff/parts';
import { useKept } from '../shared/kept';
import { StoredPhoto } from '../shared/StoredPhoto';
import { GoodToKnow, Lead, Notice, SubStep } from './Callouts';
import { stageKey, tabKey } from './keys';
import { RetrieverHowItWorks } from './RetrieverArchitecture';

const IDLE = { status: 'idle' } as const;

/** An embedding at a glance: its first numbers, how many there are, its length. */
export function Vector({ v }: { v: VectorPreview }) {
  return (
    <div className="rt-vector" aria-label={`a vector of ${v.dimension} numbers`}>
      <code>
        [{v.first.map((x) => x.toFixed(3)).join(', ')}, … {v.dimension - v.first.length} more]
      </code>
      <span className="muted small">
        {' '}
        {v.dimension} numbers · length {v.norm}
      </span>
    </div>
  );
}

function Hits({ hits }: { hits: CatalogHit[] }) {
  return (
    <table className="rt-table">
      <thead>
        <tr>
          <th>#</th>
          <th aria-label="photo" />
          <th>item</th>
          <th>type</th>
          <th>color</th>
          <th title="cosine distance: 0 is identical, smaller is closer">distance</th>
        </tr>
      </thead>
      <tbody>
        {hits.map((h, i) => (
          <tr key={h.key}>
            <td>{i + 1}</td>
            <td>
              <StoredPhoto photoKey={h.image_key} alt={h.name} className="stored-photo thumb" />
            </td>
            <td>{h.name}</td>
            <td>{h.type}</td>
            <td>{h.color}</td>
            <td>{h.distance}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Stage 1, the catalog: what a vector store of products holds (a record: text, metadata and its
 * embedding) and what similarity search does with a query. Done once a search has run.
 */
export function StageCatalog({ domain, subject, onDone }: { domain: string; subject: string; onDone: () => void }) {
  const [info, setInfo] = useState<Async<CatalogInfo>>({ status: 'idle' });
  const [items, setItems] = useState<CatalogHit[]>([]);
  const [item, setItem] = useState<Async<CatalogItem>>({ status: 'idle' });
  // kept until the question changes: then the box holds the new subject and the old results go
  // (BuildRetriever forgets the stages; until you type, the box follows the subject)
  const [text, setText] = useKept(stageKey(domain, 'catalog.text'), subject);
  const [k, setK] = useKept(tabKey(domain, 'catalog.k'), 6);
  const [search, setSearch] = useKept<Async<CatalogQuery>>(stageKey(domain, 'catalog.search'), IDLE);

  const open = async () => {
    const got = await runInto(setInfo, api.catalogInfo);
    if (got) setItems((await api.catalogItems(10)).items);
  };
  const [finished, setFinished] = useState<number>();
  const run = async () => {
    if (await runInto(setSearch, () => api.catalogSearch(text, k))) {
      setFinished(Date.now());
      onDone();
    }
  };
  // Read the index once, when the stage opens.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!opened) {
      setOpened(true);
      void open();
    }
  });

  return (
    <div className="rt-stage-body">
      <Lead>
        The catalog is a <b>vector store</b>: every product&apos;s text was turned into a list of numbers (an <i>embedding</i>) by the same model, and stored in an index. Similar text gets nearby numbers, so a
        search is a question turned into numbers, and the index returns the nearest products.
      </Lead>
      <GoodToKnow>
        <p>
          In production this is your product search (often OpenSearch); here it is <b>Amazon S3 Vectors</b>.
        </p>
      </GoodToKnow>

      <SubStep n="1a">What the index holds</SubStep>
      <Busy state={info} text="Reading the index…" />
      {info.status === 'done' && (
        <div className="rt-facts">
          <span>Amazon S3 Vectors</span>
          <span>
            index <b>{info.value.index}</b>
          </span>
          <span>
            <b>{info.value.count}</b> products
          </span>
          <span>
            <b>{info.value.dimension}</b> numbers each
          </span>
          <span>{info.value.distance_metric} distance</span>
          <span>{info.value.embedding_model}</span>
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="muted small">Open a product to see what is stored for it:</p>
          <div className="po-chips row">
            {items.map((i) => (
              <button key={i.key} className="secondary small" onClick={() => runInto(setItem, () => api.catalogItem(i.key))}>
                {i.name}
              </button>
            ))}
          </div>
        </>
      )}
      <Busy state={item} text="Reading the record…" />
      {item.status === 'done' && (
        <div className="rt-record">
          <div>
            <b>{item.value.name}</b> <span className="muted small">key {item.value.key}</span>
          </div>
          <div className="rt-record-row">
            <span className="po-inspect-label">the text that was embedded</span>
            <p className="small">{item.value.text}</p>
          </div>
          <div className="rt-record-row">
            <span className="po-inspect-label">its metadata (filterable: category, type, color)</span>
            <p className="small">
              {Object.entries(item.value.metadata)
                .filter(([key]) => key !== 'text')
                .map(([key, v]) => `${key}: ${v}`)
                .join(' · ')}
            </p>
          </div>
          <div className="rt-record-row">
            <span className="po-inspect-label">its embedding</span>
            <Vector v={item.value.vector} />
          </div>
        </div>
      )}

      <SubStep n="1b">Search it</SubStep>
      <div className="row rt-search">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && run()} aria-label="catalog search" />
        <label className="check">
          k{' '}
          <select value={k} onChange={(e) => setK(Number(e.target.value))}>
            {[3, 6, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button onClick={run} disabled={!text.trim() || search.status === 'running'}>
          Search the catalog
        </button>
      </div>
      <Busy state={search} text="Embedding the query and searching…" />
      {search.status === 'done' && (
        <>
          <div className="rt-record-row">
            <span className="po-inspect-label">your query, embedded ({search.value.metrics.embed_ms} ms)</span>
            <Vector v={search.value.vector} />
          </div>
          <Hits hits={search.value.hits} />
          <Notice>
            <p>
              Every hit is <b>similar</b> to what you asked for. None of them tells you what <b>goes with</b> it. Similarity is a good start; it is not an answer about pairings.
            </p>
            <p>Try another search, then go on to stage 2.</p>
          </Notice>
        </>
      )}
      <RetrieverHowItWorks set="rt_catalog" running={info.status === 'running' || item.status === 'running' || search.status === 'running'} finishedAt={finished} />
    </div>
  );
}
