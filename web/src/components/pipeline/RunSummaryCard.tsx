// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { RunStatus } from '../../api';
import { deltaRows, summaryHeadline, tokenTotals } from './runView';

/**
 * What the batch did to the graph: node counts before and after, what the sources turned out to
 * share (the same categories, values and components: the graph's way of saying "these belong
 * together") and the ontology feedback aggregated across every source.
 */
export function RunSummaryCard({ status, highlighted, onShared }: { status: RunStatus; highlighted: string | null; onShared: (id: string | null) => void }) {
  const s = status.summary;
  if (!s) {
    return (
      <div className="card">
        <h3>Summary</h3>
        <p className="muted" role="status">
          <span className="spinner" aria-hidden="true" /> The summary step runs once every source is through.
        </p>
      </div>
    );
  }
  const delta = deltaRows(s.graph.before, s.graph.after).filter((d) => d.delta !== 0 || ['Item', 'Look', 'Article', 'Statement'].includes(d.label));
  const t = tokenTotals(status);
  return (
    <div className="card summary-card">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, flex: '1 1 auto' }}>
          Added {summaryHeadline(s)} from {s.sources.ingested} of {s.sources.total} source{s.sources.total === 1 ? '' : 's'}
        </h3>
        <span className="muted">
          {s.added.skipped_entities} entit{s.added.skipped_entities === 1 ? 'y' : 'ies'} skipped (not in the ontology) · {s.added.validation_issues} value{s.added.validation_issues === 1 ? '' : 's'} dropped
          {s.sources.failed ? <span className="error"> · {s.sources.failed} failed</span> : ''}
        </span>
      </div>

      <div className="summary-grid">
        <section>
          <h4>Graph before → after</h4>
          <table className="metrics compact">
            <thead>
              <tr>
                <th>Label</th>
                <th>before</th>
                <th>after</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {delta.map((d) => (
                <tr key={d.label} className="static">
                  <td>
                    <span className={`pill ${d.label}`}>{d.label}</span>
                  </td>
                  <td>{d.before.toLocaleString()}</td>
                  <td>{d.after.toLocaleString()}</td>
                  <td className={d.delta > 0 ? 'good' : ''}>{d.delta > 0 ? `+${d.delta}` : d.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Ids derive from the content. A second run over the same sources updates the same looks, articles and items and does not duplicate them. If the model classifies a photo differently, the run adds the new entities and deletes nothing. Tokens: {t.input.toLocaleString()} fresh input, {t.cacheRead.toLocaleString()} read from the cache, {t.cacheWrite.toLocaleString()} written, {t.output.toLocaleString()} output across {t.calls} call
            {t.calls === 1 ? '' : 's'}.
          </p>
        </section>

        <section>
          <h4>What the sources share</h4>
          {s.shared.length ? (
            <ul className="plain shared-list">
              {s.shared.slice(0, 14).map((n) => (
                <li key={n.id}>
                  <button className={`shared${highlighted === n.id ? ' active' : ''}`} onClick={() => onShared(highlighted === n.id ? null : n.id)} aria-pressed={highlighted === n.id} title={`highlight ${n.id} and the items that reference it in the graph`}>
                    <span className={`pill ${n.label}`}>{n.label === 'Attribute' ? 'value' : 'category'}</span> <b>{n.name}</b>
                    <span className="muted">
                      {' '}
                      · {n.items} item{n.items === 1 ? '' : 's'} from {n.sources} source{n.sources === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No node is referenced by more than one item yet. Add a second source.</p>
          )}
          <p className="muted">Every entity became an Item with IS_CATEGORY / HAS_ATTRIBUTE / HAS_PART edges to the ontology's nodes. This list shows the nodes that more than one new item uses. Click one to light it up in the graph.</p>
        </section>

        <section>
          <h4>Ontology feedback across the batch</h4>
          {s.feedback.length ? (
            <ul className="plain feedback-list">
              {s.feedback.slice(0, 8).map((f, i) => (
                <li key={i}>
                  <span className={`pill fb-${f.kind}`}>{f.kind}</span> <b>{f.suggestion}</b>
                  <div className="muted">
                    {f.observed} · from {f.sources.length} source{f.sources.length === 1 ? '' : 's'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">The model reported nothing it could not express.</p>
          )}
          <p className="muted">A gap that several sources report is the one to add to the ontology first.</p>
        </section>
      </div>
    </div>
  );
}
