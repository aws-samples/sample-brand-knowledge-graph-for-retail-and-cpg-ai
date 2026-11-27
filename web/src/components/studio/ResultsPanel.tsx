// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo, type ReactNode } from 'react';
import type { ClassifyResult, CodeHighlight, OntologyDetail, OntologyFeedback, VisionModel } from '../../api';
import { localName } from './treeLayout';
import { CodeViewer } from '../arch/CodeViewer';
import { JsonPanel } from '../arch/JsonTree';
import type { RunRow } from './types';

/** The prompt inspectors show the prompt in the code viewer without gutter marks. */
const NO_MARKS: CodeHighlight[] = [];

/**
 * A call's input tokens with the cached share: what the prompt cache served (read) and, on a
 * call that started the cache, what it stored (written). The total counts all three, as the
 * metrics table does.
 */
export function inputTokensText(m: Pick<ClassifyResult['metrics'], 'total_input_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>): string {
  const parts = [`${m.cache_read_tokens.toLocaleString()} read from the prompt cache`];
  if (m.cache_write_tokens) parts.push(`${m.cache_write_tokens.toLocaleString()} written to it`);
  return `${m.total_input_tokens.toLocaleString()} input tokens (${parts.join(', ')})`;
}

/**
 * Tab 1's results, in the pieces its steps use: the run tabs (one per model and caching setting,
 * when more than one ran), what came back for the run shown (step 3: the entities in the
 * ontology's terms with what the check removed, the check, what the ontology could not express,
 * and the prompt, the reply and the request behind expanders).
 */
export function RunTabs({ runs, models, activeKey, onSelect }: { runs: RunRow[]; models: VisionModel[]; activeKey: string; onSelect: (key: string) => void }) {
  const modelName = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  // Only models with explicit_cache are sent a cache checkpoint, so only their runs get the badge.
  const hasCheckpoint = (id: string) => models.find((m) => m.id === id)?.explicit_cache === true;
  if (runs.length < 2) return null;
  return (
    <div className="run-tabs" role="group" aria-label="model runs">
      {runs.map((r) => (
        <button key={r.key} aria-pressed={r.key === activeKey} className={r.key === activeKey ? 'active' : ''} onClick={() => onSelect(r.key)}>
          {modelName(r.modelId)} {hasCheckpoint(r.modelId) && <span className="muted">{r.caching ? 'cache on' : 'cache off'}</span>}
          {r.state.status === 'running' && <><span className="spinner" aria-hidden="true" /><span className="sr-only"> (running)</span></>}
          {r.state.status === 'error' && <span className="badge warn">error</span>}
        </button>
      ))}
    </div>
  );
}

/** What came back for one run: the entities, the check, the ontology's gaps, then what was sent. */
export function RunDetails({
  result,
  detail,
  onRerun,
}: {
  result: ClassifyResult;
  detail: OntologyDetail | null;
  onRerun: (modelId: string, caching: boolean) => void;
}) {
  const removed = useMemo(() => removedByEntity(result, detail), [result, detail]);
  const inRows = Object.values(removed).reduce((n, list) => n + list.length, 0);
  const general = result.issues.filter((i) => !ENTITY_OF.test(i));
  const unknownKinds = result.entities.filter((e) => !e.class_iri).length;
  return (
    <>
      <ResultSection title={`What ${result.model.name} found, named with the ontology's terms (${result.entities.length})`} first>
        <PhotoProperties result={result} detail={detail} />
        <EntitiesTable result={result} detail={detail} removed={removed} />
      </ResultSection>

      <ResultSection title="The check: what the model said that is not in the ontology">
        {result.issues.length === 0 ? (
          <p>Nothing. Every kind, detail, value and part the model named is in the ontology.</p>
        ) : (
          <>
            {inRows + unknownKinds > 0 && (
              <p>
                {inRows > 0 && (
                  <>
                    <b>{inRows}</b> answer{inRows === 1 ? '' : 's'} removed, struck through in the table above.{' '}
                  </>
                )}
                {unknownKinds > 0 && (
                  <>
                    <b>{unknownKinds}</b> kind{unknownKinds === 1 ? '' : 's'} not in the ontology, flagged in the table. These do not reach the graph.
                  </>
                )}
              </p>
            )}
            {general.length > 0 && (
              <ul style={{ margin: '0 0 0.4rem 1.1rem' }}>
                {general.map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </ResultSection>

      <ResultSection title={`What the ontology could not express (${result.feedback.length}): the model's ideas to extend it`}>
        <FeedbackTable items={result.feedback} />
      </ResultSection>

      <ResultSection title="The model's note">
        {result.notes ? <p>{result.notes}</p> : <p className="muted">The model left no note.</p>}
        <p className="muted small">
          {(result.metrics.latency_ms / 1000).toFixed(1)} s · {inputTokensText(result.metrics)}, {result.metrics.output_tokens.toLocaleString()} output ·{' '}
          <button type="button" className="linklike" onClick={() => onRerun(result.model.id, result.prompt_caching)} title="Discards the kept result and calls the model again">
            call the model again
          </button>
        </p>
      </ResultSection>

      <ResultSection title="Exactly what was sent and what came back">
        <details className="xp xp-inspect">
          <summary>
            Inspect: the prompt<span className="xp-hint">about {result.metrics.prompt_tokens_estimate.toLocaleString()} tokens; the system part is the same for every photo</span>
          </summary>
          <p className="muted small">
            <code>owl.classification_prompt()</code> renders the system prompt from the ontology. It is the same for every photo, so it can be cached. The user turn is the photo and this text.
          </p>
          <div className="po-inspect-label">system prompt</div>
          <CodeViewer code={result.prompt.system} language="prompt" highlights={NO_MARKS} wrap maxHeight={480} />
          <div className="po-inspect-label">user turn (with the photo)</div>
          <CodeViewer code={result.prompt.user} language="prompt" highlights={NO_MARKS} wrap maxHeight={160} />
        </details>
        <details className="xp xp-inspect">
          <summary>
            Inspect: what the model sent back<span className="xp-hint">its answer as JSON, with each box&apos;s coordinates</span>
          </summary>
          <JsonPanel raw={result.raw_text} label="model output" />
        </details>
        <details className="xp xp-inspect">
          <summary>
            Inspect: the request sent to Amazon Bedrock<span className="xp-hint">one Converse call</span>
          </summary>
          <JsonPanel value={result.prompt.request} label="Converse request (ontology prompt and image bytes elided)" />
        </details>
      </ResultSection>
    </>
  );
}

/**
 * What the model said about the photo as a whole, one property each, named by the class of its
 * values: "Occasion: Professional" for fashion's `for`. Only checked values come back (the API drops
 * the others and lists them under the check), so nothing shows for an ontology without such a property.
 */
function PhotoProperties({ result, detail }: { result: ClassifyResult; detail: OntologyDetail | null }) {
  const entries = Object.entries(result.photo_properties ?? {});
  if (!entries.length) return null;
  return (
    <p className="photo-properties">
      {entries.map(([prop, value], i) => (
        <span key={prop}>
          {i > 0 && ' · '}
          <b>{photoPropertyLabel(prop, detail)}:</b> {value}
        </span>
      ))}
      <span className="muted"> · the photo as a whole</span>
    </p>
  );
}

/** A photo property by the class of its values ("for" → "Occasion"), else by its own name. */
export function photoPropertyLabel(prop: string, detail: OntologyDetail | null): string {
  const nodes = detail?.view.nodes ?? [];
  const range = nodes.find((n) => n.kind === 'objectProperty' && localName(n.id) === prop)?.range?.[0];
  const cls = range ? nodes.find((n) => n.id === range) : undefined;
  return cls?.label || (range ? localName(range) : prop);
}

/** One part of step 3: a heading the size of the other tabs' sub-steps, a divider above all but the first. */
function ResultSection({ title, first = false, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section className={`result-section${first ? ' first' : ''}`}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- what the check removed, per row

/** The check's messages that name a row end in "(entity <id>)". */
const ENTITY_OF = /\(entity ([^)\s]+)\)$/;

/** One answer the check took out of a row: a detail (and the value the model gave) or a part, and why. */
export type Removed = { what: 'detail' | 'part'; prop: string; value: string; why: string };

/**
 * The check's messages, sorted to their rows, with the value the model gave (read back from its
 * own reply, which keeps everything it said). "Unknown entity class" is not here: the row itself
 * is flagged.
 */
export function removedByEntity(result: ClassifyResult, detail: OntologyDetail | null): Record<string, Removed[]> {
  const raw = rawEntities(result.raw_text);
  const label = (name: string) => detail?.view.nodes.find((n) => localName(n.id) === name)?.label?.toLowerCase() || name;
  const out: Record<string, Removed[]> = {};
  for (const issue of result.issues) {
    const m = ENTITY_OF.exec(issue);
    if (!m) continue;
    const id = m[1];
    const said = (prop: string) => {
      const attrs = raw.get(id)?.attributes ?? {};
      const key = Object.keys(attrs).find((k) => norm(k) === norm(prop));
      return key ? String(attrs[key] ?? '') : '';
    };
    let r: Removed | null = null;
    let x: RegExpExecArray | null;
    if ((x = /^(\S+) does not apply to (\S+) /.exec(issue))) r = { what: 'detail', prop: x[1], value: said(x[1]), why: `not a detail of a ${label(x[2])}` };
    else if ((x = /^(\S+?)=(['"])(.*)\2 is not an allowed value /.exec(issue))) r = { what: 'detail', prop: x[1], value: x[3], why: 'not an allowed value' };
    else if ((x = /^unknown attribute property (['"])(.*)\1 /.exec(issue))) r = { what: 'detail', prop: x[2], value: said(x[2]), why: 'not a detail in the ontology' };
    else if ((x = /^unknown part class (['"])(.*)\1 /.exec(issue))) r = { what: 'part', prop: x[2], value: '', why: 'not in the ontology' };
    if (r) (out[id] ??= []).push(r);
  }
  return out;
}

/** "hasTextilePattern", "textile pattern", "TextilePattern" compare equal. */
const norm = (s: string) => s.toLowerCase().replace(/^has/, '').replace(/[^a-z]/g, '');

/** The entities of the model's own reply by id (its JSON may sit inside prose or a code fence). */
function rawEntities(text: string): Map<string, { attributes?: Record<string, unknown> }> {
  const out = new Map<string, { attributes?: Record<string, unknown> }>();
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    (parsed.entities ?? []).forEach((e: any, i: number) => out.set(typeof e?.id === 'string' && e.id ? e.id : `e${i + 1}`, e));
  } catch {
    // no JSON to read: the removed answers show without the value the model gave
  }
  return out;
}

/** One model's advice on the ontology, as it came back (tidied by the API). */
function FeedbackTable({ items }: { items: OntologyFeedback[] }) {
  if (!items.length)
    return (
      <p className="muted">
        The model reported nothing it could not express. Either the ontology covered what it saw, or the model skipped the request. Smaller models often skip it.
      </p>
    );
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        The prompt asks the model to report what it saw that the vocabulary cannot express, and how it would extend the ontology. <b>Already known</b> means the ontology has that term and the model missed it:
        a prompt problem, not a gap.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="metrics feedback">
          <thead>
            <tr>
              <th>#</th>
              <th>Observed</th>
              <th>Kind</th>
              <th>Suggested extension</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f, i) => (
              <tr key={i} className={`static${f.already_known.length ? ' known' : ''}`}>
                <td>{i + 1}</td>
                <td>{f.observed || <span className="muted">n/a</span>}</td>
                <td>
                  <span className={`pill fb-${f.kind}`}>{f.kind}</span>
                </td>
                <td>
                  {f.suggestion}
                  {f.already_known.length > 0 && (
                    <div className="muted">
                      already known: {f.already_known.map((k) => <code key={k}>{k}</code>).reduce<ReactNode[]>((acc, el, j) => (j ? [...acc, ', ', el] : [el]), [])}
                    </div>
                  )}
                </td>
                <td>{f.entity ? <code>{f.entity}</code> : <span className="muted">n/a</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The entities named with the ontology's terms, in step 1's colors (kinds and parts blue, details purple,
 * values green; not clickable). The check's removals are struck through in their row.
 */
function EntitiesTable({ result, detail, removed }: { result: ClassifyResult; detail: OntologyDetail | null; removed: Record<string, Removed[]> }) {
  if (!result.entities.length) return <p className="muted">The model returned no entities that map onto the ontology.</p>;
  const nodeLabel = (iri: string) => detail?.view.nodes.find((n) => n.id === iri)?.label || localName(iri);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="metrics entities">
        <thead>
          <tr>
            <th>Kind (the ontology&apos;s word)</th>
            <th>Label (the model&apos;s own words)</th>
            <th>Details (ontology terms)</th>
            <th>Parts</th>
            <th>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {result.entities.map((e) => {
            const gone = removed[e.id] ?? [];
            return (
              <tr key={e.id} className={e.class_iri ? '' : 'unknown'}>
                <td>
                  {e.class_iri ? <span className="chip static kind-class">{e.class}</span> : <b>{e.class}</b>}
                  {!e.class_iri && <span className="badge warn">not in the ontology</span>}
                </td>
                <td>{e.label}</td>
                <td>
                  {Object.entries(e.attribute_iris).map(([prop, val]) => (
                    <div key={prop} className="ent-detail">
                      <span className="chip static kind-objectProperty">{localName(prop)}</span> → <span className="chip static kind-individual">{nodeLabel(val)}</span>
                    </div>
                  ))}
                  {gone
                    .filter((r) => r.what === 'detail')
                    .map((r, i) => (
                      <div key={`x${i}`} className="ent-detail ent-removed">
                        <s>
                          {r.prop}
                          {r.value && <> → {r.value}</>}
                        </s>{' '}
                        <span className="ent-why">removed: {r.why}</span>
                      </div>
                    ))}
                </td>
                <td>
                  <span className="chips">
                    {e.parts.map((p) => (
                      <span key={p.id} className="chip static kind-class">
                        {p.class}
                      </span>
                    ))}
                  </span>
                  {gone
                    .filter((r) => r.what === 'part')
                    .map((r, i) => (
                      <div key={`p${i}`} className="ent-detail ent-removed">
                        <s>{r.prop}</s> <span className="ent-why">removed: {r.why}</span>
                      </div>
                    ))}
                </td>
                <td>{e.confidence != null ? `${Math.round(e.confidence * 100)}%` : 'n/a'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
