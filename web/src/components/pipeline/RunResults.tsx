// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo, useState } from 'react';
import type { Entity, RunRecord } from '../../api';
import { ImageCanvas, boxesOf, type Box } from '../studio/ImageCanvas';
import { sourceText, type SourceRow } from './runView';

/**
 * One row per source with its status, and the selected source in detail: the photo with the
 * boxes the model drew (or the text), the entities that made it into the graph, what was
 * skipped and why, and the model's ontology feedback.
 */
export function RunResults({ rows, selected, onSelect, imageFor }: { rows: SourceRow[]; selected: number | null; onSelect: (index: number) => void; imageFor: (row: SourceRow) => string | null }) {
  const row = rows.find((r) => r.index === selected) ?? rows.find((r) => r.status !== 'pending') ?? rows[0];
  return (
    <div className="results-grid">
      <div className="card source-rows">
        <h3>Sources · {rows.length}</h3>
        <ol className="plain">
          {rows.map((r) => (
            <li key={r.index}>
              <button className={`source-row${row?.index === r.index ? ' active' : ''} st-${r.status}`} onClick={() => onSelect(r.index)} aria-pressed={row?.index === r.index}>
                <span className="source-kind">{r.kind === 'image' ? 'photo' : 'text'}</span>
                <span className="source-title">{r.label}</span>
                <RowStatus row={r} />
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="card">{row ? <RowDetail row={row} src={imageFor(row)} /> : <p className="muted">No sources.</p>}</div>
    </div>
  );
}

function RowStatus({ row }: { row: SourceRow }) {
  const ing = row.record?.ingest;
  switch (row.status) {
    case 'pending':
      return (
        <span className="muted source-meta">
          <span className="spinner" aria-hidden="true" /> waiting · classify → ingest
        </span>
      );
    case 'classified':
      return (
        <span className="muted source-meta">
          <span className="spinner" aria-hidden="true" /> classified · ingesting…
        </span>
      );
    case 'error':
      return <span className="source-meta error">failed · {row.error?.split(':')[0] ?? 'error'}</span>;
    case 'ingested':
      return (
        <span className="source-meta">
          <b>{ing?.items.length ?? 0}</b> item{ing?.items.length === 1 ? '' : 's'}
          {ing?.look ? ' · look' : ''}
          {ing?.article ? ' · article' : ''}
          {ing?.skipped.length ? <span className="warn"> · {ing.skipped.length} skipped</span> : ''}
          {' · '}
          {((ing?.metrics.latency_ms ?? 0) / 1000).toFixed(1)} s
        </span>
      );
  }
}

function RowDetail({ row, src }: { row: SourceRow; src: string | null }) {
  const [active, setActive] = useState<Box | null>(null);
  const [view, setView] = useState<'entities' | 'feedback' | 'raw'>('entities');
  const rec = row.record;
  const result = rec?.result;
  const boxes = useMemo(() => (result ? boxesOf(result.entities) : []), [result]);
  const ingestedIds = useMemo(() => new Set(rec?.ingest?.items.map((i) => i.id) ?? []), [rec]);
  if (row.status === 'pending') {
    return (
      <>
        <h3>{row.label}</h3>
        <p className="muted" role="status">
          <span className="spinner" aria-hidden="true" /> Waiting for the classify step (one Bedrock call) and the ingest step (MERGE + embeddings).
        </p>
      </>
    );
  }
  if (row.status === 'error' || !result) {
    return (
      <>
        <h3>{row.label}</h3>
        <p className="error" role="alert">{row.error ?? 'failed'}</p>
        <p className="muted">This source failed. The other sources carried on, and the summary counts this one under “failed”. The state machine retries throttling errors. It does not retry model access errors.</p>
      </>
    );
  }
  const text = row.kind === 'text' ? sourceText(rec) : '';
  const ing = rec?.ingest;
  return (
    <>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, flex: '1 1 auto' }}>{row.label}</h3>
        <span className="muted">
          {result.model.name} · {(result.metrics.latency_ms / 1000).toFixed(1)} s · {result.metrics.cache_read_tokens ? `${result.metrics.cache_read_tokens.toLocaleString()} cached tokens` : `${result.metrics.input_tokens.toLocaleString()} input tokens`}
        </span>
      </div>
      {row.kind === 'image' ? (
        src ? (
          <ImageCanvas src={src} boxes={boxes} active={new Set(active ? [active.key] : [])} showParts onSelect={setActive} />
        ) : (
          <p className="muted">The photo was uploaded in another browser session. The tab shows only its results.</p>
        )
      ) : (
        <pre className="source-text">{text || '(text not in the record)'}</pre>
      )}
      <div className="row" style={{ margin: '0.6rem 0 0.3rem' }}>
        <div className="btn-group small">
          <button className={view === 'entities' ? '' : 'secondary'} onClick={() => setView('entities')}>
            Entities → graph ({result.entities.length})
          </button>
          <button className={view === 'feedback' ? '' : 'secondary'} onClick={() => setView('feedback')}>
            Ontology feedback ({result.feedback.length})
          </button>
          <button className={view === 'raw' ? '' : 'secondary'} onClick={() => setView('raw')}>
            Raw model output
          </button>
        </div>
      </div>
      {view === 'entities' && (
        <>
          <EntityRows entities={result.entities} ingested={ingestedIds} digest={rec?.digest ?? ''} active={active} onHover={setActive} />
          {ing && (ing.skipped.length > 0 || result.issues.length > 0) && (
            <details className="skipped">
              <summary>
                {ing.skipped.length} entit{ing.skipped.length === 1 ? 'y' : 'ies'} skipped · {result.issues.length} validation issue{result.issues.length === 1 ? '' : 's'}
              </summary>
              <ul className="plain">
                {ing.skipped.map((s, i) => (
                  <li key={`s${i}`} className="warn">
                    not ingested: {s}
                  </li>
                ))}
                {result.issues.map((s, i) => (
                  <li key={`i${i}`} className="muted">
                    dropped: {s}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {ing && (
            <p className="muted written">
              Written: {ing.items.length} Item{ing.items.length === 1 ? '' : 's'}
              {ing.look && (
                <>
                  {' '}
                  · Look <code>{ing.look}</code> CONTAINS them (the photo is its vector)
                  {ing.occasion && (
                    <>
                      , FOR the occasion <b>{ing.occasion}</b>
                    </>
                  )}
                </>
              )}
              {ing.article && (
                <>
                  {' '}
                  · Article <code>{ing.article}</code> → Statement <code>{ing.statement}</code> ILLUSTRATES them (the text is its vector)
                </>
              )}
            </p>
          )}
        </>
      )}
      {view === 'feedback' && <Feedback result={result} />}
      {view === 'raw' && <pre className="code-block">{result.raw_text}</pre>}
    </>
  );
}

function EntityRows({ entities, ingested, digest, active, onHover }: { entities: Entity[]; ingested: Set<string>; digest: string; active: Box | null; onHover: (b: Box | null) => void }) {
  if (!entities.length) return <p className="muted">The model returned no entities that map onto the ontology.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="metrics entities compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Class → Category</th>
            <th>Label</th>
            <th>Attributes → HAS_ATTRIBUTE</th>
            <th>Parts → HAS_PART</th>
            <th>Graph node</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => {
            const id = itemIdOf(digest, e, ingested);
            const isActive = active?.entity.id === e.id;
            return (
              <tr key={e.id} className={`${isActive ? 'active' : ''}${!id ? ' unknown' : ''}`} tabIndex={0} onMouseEnter={() => onHover(e.bbox ? { key: e.id, kind: 'entity', entity: e, bbox: e.bbox, label: e.label } : null)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(e.bbox ? { key: e.id, kind: 'entity', entity: e, bbox: e.bbox, label: e.label } : null)} onBlur={() => onHover(null)}>
                <td>{e.id}</td>
                <td>
                  <b>{e.class}</b>
                  {!e.class_iri && <span className="badge warn">not in ontology</span>}
                </td>
                <td>{e.label}</td>
                <td>{Object.values(e.attributes).join(', ') || <span className="muted">n/a</span>}</td>
                <td>{e.parts.map((p) => p.class).join(', ') || <span className="muted">n/a</span>}</td>
                <td>{id ? <code>{id}</code> : <span className="warn">skipped</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Item id the ingest step derived for an entity (same rule as pipeline.ingest_source). */
function itemIdOf(digest: string, e: Entity, ingested: Set<string>): string | null {
  const slug = e.class.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'thing';
  const id = `item:${digest}-${e.id}-${slug}`;
  return ingested.has(id) ? id : null;
}

function Feedback({ result }: { result: NonNullable<RunRecord['result']> }) {
  if (!result.feedback.length) return <p className="muted">The model reported nothing it could not express with this ontology.</p>;
  return (
    <ul className="plain feedback-list">
      {result.feedback.map((f, i) => (
        <li key={i}>
          <span className={`pill fb-${f.kind}`}>{f.kind}</span> <b>{f.suggestion}</b>
          <div className="muted">
            observed: {f.observed}
            {f.already_known.length > 0 && <> · already in the ontology: {f.already_known.join(', ')}</>}
          </div>
        </li>
      ))}
    </ul>
  );
}
