// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fragment } from 'react';
import type { OntologySummary } from '../../api';

/** A domain's data sets as a list of ids (`anycompany-apparel, anycompany-fashion-house`). */
function SetIds({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i ? ', ' : ''}
          <code>{id}</code>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The domain every other tab works with: a folder under ontologies/ with its ontology, example
 * photos and texts (under `examples/`), questions, and its data sets (brands) under `datasets/`.
 * A choice of the browser, not of the stack; `graphDomain` is the one the graph is loaded with,
 * with every one of its data sets.
 */
export function DomainCard({ domain, ontologies, onDomain, graphDomain }: { domain: string; ontologies: OntologySummary[]; onDomain: (id: string) => void; graphDomain: string }) {
  const domainName = ontologies.find((o) => o.id === domain)?.domain.name ?? domain;
  const graphDomainName = ontologies.find((o) => o.id === graphDomain)?.domain.name ?? graphDomain;
  const graphSets = ontologies.find((o) => o.id === graphDomain)?.data_sets ?? [];
  // a browse-only ontology has no data to work with: tab 1 step 4 shows it, this card does not offer it
  const choices = ontologies.filter((o) => !o.domain.browse_only);
  return (
    <section className="card setup-card">
      <h3>
        Domain: the ontology and its example content <span className="setup-pill ok">{domainName}</span>
      </h3>
      <p className="muted">
        Tabs 1 and 2 classify against the chosen domain&apos;s ontology and use its example photos, texts and questions. A domain is a folder{' '}
        <code>ontologies/&lt;domain&gt;/</code> in the data bucket with a <code>domain.json</code>, the ontology file, its examples in <code>examples/</code>, and its data sets (brands) in{' '}
        <code>datasets/&lt;set&gt;/</code>. The sample ships one domain, fashion (<code>ontologies/fashion/</code>), and three browse-only ontologies (<code>beauty</code>, <code>home</code>,{' '}
        <code>food</code>) to read in tab 1, step 4; they have no data, so they are not offered here. To add a domain, create a folder next to them (see <code>ontologies/README.md</code>) and it
        shows up here. Your browser remembers the choice.
      </p>
      <div className="setup-choice" role="radiogroup" aria-label="domain">
        {choices.map((o) => {
          const sets = o.data_sets ?? [];
          return (
            <label key={o.id} className={`setup-option${o.id === domain ? ' on' : ''}`}>
              <input type="radio" name="domain" checked={o.id === domain} onChange={() => onDomain(o.id)} />
              <span>
                <b>{o.domain.name}</b>
                <small>
                  <code>{o.id}</code> · {o.name} · {o.stats.classes} classes · {o.stats.individuals} values · {o.examples} example photos · {o.articles} example texts
                  {o.domain.description ? ` · ${o.domain.description}` : ''}
                </small>
                <small>
                  {sets.length ? (
                    <>
                      Data sets: <SetIds ids={sets} />, each a folder <code>ontologies/{o.id}/datasets/&lt;set&gt;/</code>
                      {o.id === graphDomain && <>, loaded into the graph at deploy</>}
                    </>
                  ) : (
                    <>
                      No data sets yet: add one as a folder <code>ontologies/{o.id}/datasets/&lt;set&gt;/</code>
                    </>
                  )}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      <p className="muted">
        The graph holds one vocabulary, the {graphDomainName} ontology (<code>{graphDomain}</code>)
        {graphSets.length ? (
          <>
            , and every data set of that domain (<SetIds ids={graphSets} />), loaded at deploy
          </>
        ) : null}
        . Choosing another domain here does not reload the graph.
      </p>
      {graphDomain && graphDomain !== domain && (
        <p className="notice text">
          The graph holds the <code>{graphDomain}</code> vocabulary and its data sets, not this domain&apos;s. To add this domain&apos;s photos and texts to the graph, ingest them in tab 2.
        </p>
      )}
    </section>
  );
}
