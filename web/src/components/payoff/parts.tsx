// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type FeaturedLook, type GraphColumn, type NodeSource, type PayoffEvidence } from '../../api';
import { StoredPhoto } from '../shared/StoredPhoto';
import { PayoffTree } from './PayoffTree';

/** A request's state: what each stage's button and result area show. */
export type Async<T> = { status: 'idle' } | { status: 'running' } | { status: 'done'; value: T } | { status: 'error'; error: string };

/** Run `fn` into `set`, as idle → running → done | error. */
export async function runInto<T>(set: (s: Async<T>) => void, fn: () => Promise<T>): Promise<T | null> {
  set({ status: 'running' });
  try {
    const value = await fn();
    set({ status: 'done', value });
    return value;
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export function Busy({ state, text }: { state: Async<unknown>; text: string }) {
  if (state.status === 'running')
    return (
      <p className="muted">
        <span className="spinner" /> {text}
      </p>
    );
  if (state.status === 'error') return <p className="error">{state.error}</p>;
  return null;
}

/** Each look's source preview (its photo and the garments in it), fetched once per look: the same
 * preview the evidence tree uses. */
const sourceCache = new Map<string, NodeSource>();

export function useLookSources(lookIds: string[], domain: string): Record<string, NodeSource> {
  const [sources, setSources] = useState<Record<string, NodeSource>>({});
  const key = lookIds.join(',');
  useEffect(() => {
    let live = true;
    const ids = key ? key.split(',') : [];
    const todo = ids.filter((id) => !sourceCache.has(id));
    const publish = () => live && setSources(Object.fromEntries(ids.filter((id) => sourceCache.has(id)).map((id) => [id, sourceCache.get(id)!])));
    publish();
    (async () => {
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(
          todo.slice(i, i + 4).map(async (id) => {
            try {
              sourceCache.set(id, await api.nodeSource(id, domain));
            } catch {
              /* no preview for this look: the tree keeps its placeholder */
            }
          }),
        );
        publish();
      }
    })();
    return () => {
      live = false;
    };
  }, [key, domain]);
  return sources;
}

/** "Outfit in a photo: a, b, b, c" -> [a, b ×2, c]. */
export function garmentsOf(description: string): { name: string; n: number }[] {
  const list = description.replace(/^[^:]*:\s*/, '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const g of list) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts].map(([name, n]) => ({ name, n }));
}

export function Receipts({ kind, label }: { kind: string; label: string }) {
  return <span className={`po-receipts po-receipts-${kind}`}>{kind === 'none' ? 'Receipts: none' : `Receipts: ${label}`}</span>;
}

/** What exactly ran: prompts, messages, queries. Collapsed until opened. */
export function Inspect({ title = 'Inspect: exactly what ran', parts, open = false }: { title?: string; parts: [string, string][]; open?: boolean }) {
  return (
    <details className="po-inspect xp xp-inspect" open={open}>
      <summary>
        {title}
        <span className="xp-hint">the prompts and data, as sent</span>
      </summary>
      {parts.map(([label, text]) => (
        <div key={label}>
          <div className="po-inspect-label">{label}</div>
          <pre className="code po-pre">{text}</pre>
        </div>
      ))}
    </details>
  );
}

export function EvidenceList({ evidence, active, onPick }: { evidence: PayoffEvidence[]; active: number | null; onPick: (n: number) => void }) {
  return (
    <ol className="po-evidence">
      {evidence.map((e) => (
        <li key={e.n} className={`po-ev po-ev-${e.kind}${active === e.n ? ' active' : ''}`}>
          <button type="button" className="po-ev-n" onClick={() => onPick(e.n)} aria-label={`select evidence ${e.n}`}>
            [{e.n}]
          </button>
          <span>
            {e.kind === 'item' ? e.label : <b>{e.label}</b>}
            {e.kind === 'look' && <span className="muted"> · {e.text.replace(/^Look [A-Z]: /, '')}</span>}
            {e.kind === 'note' && <span className="muted"> · {e.text}</span>}
            {e.search && <span className="muted"> · searched “{e.search}”</span>}
            {e.distance !== undefined && <span className="muted"> · {e.distance}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** GraphRAG's three looks: each a real look of the brand's, its pieces matched to catalog items. */
export function FeaturedLooks({ featured }: { featured: FeaturedLook[] }) {
  return (
    <ol className="po-featured">
      {featured.map((f) => (
        <li key={f.id}>
          <b>
            Look {f.letter} · {f.occasion || 'look'}
          </b>
          <ul>
            {f.pieces.map((p) => (
              <li key={p.key + p.piece}>
                <span className="muted">{p.piece}</span> →{' '}
                {p.item ? (
                  <>
                    {p.item} <span className="muted small">({p.distance})</span>
                  </>
                ) : (
                  <span className="po-nomatch">not in the catalog</span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function Chips({ items, kind = 'rag' }: { items: string[]; kind?: 'rag' | 'graph' }) {
  return (
    <div className="po-searches">
      {items.map((s) => (
        <span key={s} className={`po-search${kind === 'graph' ? ' po-search-graph' : ''}`}>
          {s}
        </span>
      ))}
    </div>
  );
}

/**
 * GraphRAG's receipts: the traversal tree. `active`: the selected evidence number (from the
 * answer's citations or the evidence list), which lights its path; clicking a box selects the
 * evidence that ends there, or lights the box and its neighbours.
 */
/** What the details panel shows for the box clicked in the tree. */
function NodeDetail({ graph, id, sources, onPick }: { graph: GraphColumn; id: string | null; sources: Record<string, NodeSource>; onPick: (id: string) => void }) {
  const node = graph.tree.nodes.find((n) => n.id === id);
  if (!node)
    return (
      <aside className="po-detail po-detail-empty">
        <p className="muted small">Click a box in the tree to see what it is: a look's full photo and garments, a kind of garment and the looks it is worn in, a catalog item and why it was found.</p>
      </aside>
    );
  const g = graph.guidance;
  const n = g.looks.length;
  const catOf = (cid: string) => g.categories.find((c) => c.id === cid);
  const looksOf = (cid: string) => graph.tree.edges.filter((e) => e.target === cid).map((e) => e.source);
  const thumb = (lid: string) => sources[lid]?.photo?.data_url;
  const LookStrip = ({ ids }: { ids: string[] }) => (
    <div className="po-detail-strip">
      {ids.map((lid) => (
        <button key={lid} className="po-detail-thumb" onClick={() => onPick(lid)} title={g.looks.find((l) => l.id === lid)?.occasion}>
          {thumb(lid) ? <img src={thumb(lid)} alt={`look ${lid}`} /> : <span className="spinner" />}
        </button>
      ))}
    </div>
  );

  if (node.kind === 'look') {
    const src = sources[node.id];
    const feeds = graph.tree.edges.filter((e) => e.source === node.id && e.target.startsWith('cat:')).map((e) => catOf(e.target)?.name ?? e.target);
    return (
      <aside className="po-detail">
        <div className="po-detail-kind po-k-look">Look · {node.label}</div>
        {src?.photo ? <img className="po-detail-photo" src={src.photo.data_url} alt={`the look ${node.sub}`} /> : <p className="muted small">{src ? src.photo_note || 'No photo stored for this look.' : 'Loading the photo…'}</p>}
        <p className="muted small">{node.sub}</p>
        {src?.description && (
          <>
            <div className="po-inspect-label">the garments the pipeline found in it</div>
            <ul className="po-detail-list">
              {garmentsOf(src.description).map((x) => (
                <li key={x.name}>
                  {x.name}
                  {x.n > 1 && <span className="muted"> ×{x.n}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {feeds.length > 0 && (
          <p className="small">
            Counted in: <b>{feeds.join(', ')}</b>
          </p>
        )}
      </aside>
    );
  }
  if (node.kind === 'category') {
    const c = catOf(node.id);
    return (
      <aside className="po-detail">
        <div className="po-detail-kind po-k-category">Worn with · {node.label}</div>
        <p>
          In <b>{c?.count}</b> of {n} looks.
        </p>
        {c && (
          <dl className="po-detail-facts">
            {c.colors.length > 0 && (
              <>
                <dt>colors</dt>
                <dd>{c.colors.join(', ')}</dd>
              </>
            )}
            {c.details.length > 0 && (
              <>
                <dt>details</dt>
                <dd>{c.details.join(', ')}</dd>
              </>
            )}
            <dt>examples</dt>
            <dd>{c.examples.join('; ')}</dd>
            <dt>the search it became</dt>
            <dd>“{c.search}”</dd>
          </dl>
        )}
        <div className="po-inspect-label">the looks it is worn in</div>
        <LookStrip ids={looksOf(node.id)} />
      </aside>
    );
  }
  if (node.kind === 'item') {
    const ev = graph.evidence.find((e) => e.tree_ids[e.tree_ids.length - 1] === node.id);
    const cid = graph.tree.edges.find((e) => e.target === node.id)?.source ?? '';
    return (
      <aside className="po-detail">
        <div className="po-detail-kind po-k-item">Catalog item</div>
        <StoredPhoto photoKey={node.image_key} alt={node.label} className="stored-photo product" />
        <p>
          <b>{node.label}</b>
        </p>
        {ev && <p className="small">{ev.text.replace(/^Item:\s*/, '')}</p>}
        <dl className="po-detail-facts">
          <dt>found by searching</dt>
          <dd>“{ev?.search}”</dd>
          <dt>distance</dt>
          <dd>{ev?.distance}</dd>
          <dt>because</dt>
          <dd>
            {catOf(cid)?.name} is worn with {g.anchor.label}s in {catOf(cid)?.count} of {n} looks
          </dd>
        </dl>
        <div className="po-inspect-label">those looks</div>
        <LookStrip ids={looksOf(cid)} />
      </aside>
    );
  }
  return (
    <aside className="po-detail">
      <div className="po-detail-kind po-k-anchor">The way in · vector search</div>
      <p>
        <b>{g.anchor.garments.length}</b> “{g.anchor.label}” garments, the {g.anchor.category} nearest to the question, in <b>{n}</b> looks.
      </p>
      <div className="po-inspect-label">the anchor garments (cosine distance to the question)</div>
      <ul className="po-detail-list">
        {g.anchor.garments.slice(0, 12).map((x) => (
          <li key={x.id}>
            {x.name} <span className="muted">{x.distance}</span>
          </li>
        ))}
        {g.anchor.garments.length > 12 && <li className="muted">… {g.anchor.garments.length - 12} more</li>}
      </ul>
    </aside>
  );
}

export function GraphReceipts({ graph, domain, active, onActive, title, children }: { graph: GraphColumn; domain: string; active: number | null; onActive: (n: number | null) => void; title?: string; children?: ReactNode }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const lookIds = useMemo(() => graph.tree.nodes.filter((n) => n.kind === 'look').map((n) => n.id), [graph]);
  const sources = useLookSources(lookIds, domain);
  const thumbs = useMemo(() => Object.fromEntries(Object.entries(sources).flatMap(([id, s]) => (s.photo ? [[id, s.photo.data_url]] : []))), [sources]);
  useEffect(() => {
    setPicked(null);
    setSelected(null);
  }, [graph]);
  const lit = useMemo(() => {
    if (active !== null) return new Set(graph.evidence.find((e) => e.n === active)?.tree_ids ?? []);
    if (!picked) return null;
    const set = new Set([picked]);
    for (const e of graph.tree.edges) {
      if (e.source === picked) set.add(e.target);
      if (e.target === picked) set.add(e.source);
    }
    return set;
  }, [graph, active, picked]);
  const pick = (id: string) => {
    setSelected(id);
    const ev = graph.evidence.find((e) => e.tree_ids[e.tree_ids.length - 1] === id);
    if (ev) {
      setPicked(null);
      onActive(ev.n);
    } else {
      onActive(null);
      setPicked(id);
    }
  };
  return (
    <div className="card">
      <h3>{title ?? "GraphRAG's receipts: the traversal behind the answer"}</h3>
      <p className="muted small">Click a citation or an evidence line to light up its path back to the brand's looks. Click a box to see its details.</p>
      {children}
      <div className="po-receipts-grid">
        <PayoffTree tree={graph.tree} lit={lit} thumbs={thumbs} selected={selected} onPick={pick} />
        <NodeDetail graph={graph} id={selected} sources={sources} onPick={pick} />
      </div>
    </div>
  );
}
