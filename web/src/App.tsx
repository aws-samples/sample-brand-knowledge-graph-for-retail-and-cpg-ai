// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useState } from 'react';
import { api, type Health, type OntologySummary, type Summary } from './api';
import { signOut } from './auth';
import { Explorer } from './components/Explorer';
import { ExploreGraph } from './components/graph/ExploreGraph';
import { LensesTab } from './components/lenses/LensesTab';
import { IngestPipeline } from './components/pipeline/IngestPipeline';
import { AskStylist } from './components/payoff/AskStylist';
import { BuildRetriever } from './components/retriever/BuildRetriever';
import { StartTab } from './components/setup/StartTab';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { OpenTabContext } from './components/shared/NextTab';
import { useStoredChoice } from './components/shared/useStoredChoice';
import { DOMAIN_KEY, pickDomain } from './domain';

import { TAB_IDS, TABS, type Tab } from './tabs';
/** The tab a link asks for (`?tab=ask`, for a slide that embeds one tab), else tab 0. */
export function tabFromSearch(search: string): Tab {
  const wanted = new URLSearchParams(search).get('tab');
  return TAB_IDS.includes(wanted as Tab) ? (wanted as Tab) : 'setup';
}

/** `user`: who is signed in (email or username); null when sign-in is off (the tests). */
export default function App({ user = null }: { user?: string | null }) {
  const [tab, showTab] = useState<Tab>(() => tabFromSearch(typeof location === 'undefined' ? '' : location.search));
  // The URL follows the tab (`?tab=`), so a reload or a copied link opens the same tab.
  const setTab = useCallback((t: Tab) => {
    showTab(t);
    const url = new URL(location.href);
    url.searchParams.set('tab', t);
    history.replaceState(null, '', url);
  }, []);
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  // Bumped on every change of the graph's content: every finished tab 2 run. Tab 6's trends
  // methods drop results counted on an older graph when it changes.
  const [graphVersion, setGraphVersion] = useState(0);
  // The domain (an ontology folder with its example photos and texts) every tab works with:
  // chosen in tab 0, remembered by the browser. `graphDomain` is the one the graph is loaded with.
  const [ontologies, setOntologies] = useState<OntologySummary[] | null>(null);
  const [graphDomain, setGraphDomain] = useState('');
  const [stored, chooseDomain] = useStoredChoice(DOMAIN_KEY, '');
  const domain = ontologies ? pickDomain(stored, graphDomain, ontologies) : '';

  const refresh = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.health(), api.summary()]);
      setHealth(h);
      setSummary(s);
      setError('');
    } catch (e: any) {
      setError(`API unreachable: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    api
      .ontologies()
      .then((r) => {
        setOntologies(r.ontologies);
        setGraphDomain(r.default);
      })
      .catch((e) => setError(`API unreachable: ${e.message}`));
  }, [refresh]);

  // A tab 2 run finished: new looks or texts are in the graph.
  const onIngested = useCallback(() => {
    setGraphVersion((v) => v + 1);
    refresh();
  }, [refresh]);

  const current = ontologies?.find((o) => o.id === domain);
  const nodes = summary?.nodes ?? {};
  const totalNodes = Object.values(nodes).reduce((a, b) => a + b, 0);
  const totalEdges = Object.values(summary?.edges ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Multimodal AI knowledge graph</h1>
          <div className="sub">Brand knowledge graph on Amazon Neptune Analytics · GraphRAG with Amazon Bedrock</div>
        </div>
        <div className="spacer" />
        {health && (
          <div className="app-status">
            <button className="status-item" onClick={() => setTab('setup')} title={`Neptune Analytics ${health.graph_id ?? ''}. Open tab 0 · Start here`}>
              <i className="status-dot ok" aria-hidden="true" />
              Neptune Analytics
            </button>
            <span className="status-item">
              <i className={`status-dot ${health.embedder === 'nova' ? 'ok' : 'warn'}`} aria-hidden="true" />
              embeddings {health.embedder}
            </span>
            {summary && (
              <span className="status-item">
                {totalNodes} nodes · {totalEdges} edges
              </span>
            )}
          </div>
        )}
        {user && (
          <div className="header-actions account" role="group" aria-label="account">
            <span className="sub">
              signed in as <b>{user}</b>
            </span>
            <button className="small ghost" onClick={signOut} title="End the session with Amazon Cognito">
              Sign out
            </button>
          </div>
        )}
      </header>
      <nav className="tabs" aria-label="workshop steps">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {error && <p className="error">{error}</p>}
        {!current && !error && <p className="muted">{ontologies?.length === 0 ? 'No domain folder found: add one under ontologies/ (see ontologies/README.md).' : 'Reading the domains…'}</p>}
        <OpenTabContext.Provider value={setTab}>
        <ErrorBoundary resetKey={tab}>
          {current && tab === 'ask' && <BuildRetriever domain={current.id} />}
          {current && tab === 'stylist' && <AskStylist domain={current.id} />}
          {current && tab === 'setup' && (
            <StartTab domain={current.id} ontologies={ontologies ?? []} onDomain={chooseDomain} graphDomain={graphDomain} summary={summary} onOpenTab={setTab} />
          )}
          {current && tab === 'ingest' && (
            <IngestPipeline onChanged={onIngested} domain={current.id} wording={current.domain} />
          )}
          {current && tab === 'explore' && <Explorer domain={current.id} />}
          {current && tab === 'graph' && <ExploreGraph domain={current.id} wording={current.domain} dataVersion={graphVersion} />}
          {current && tab === 'lenses' && <LensesTab domain={current.id} health={health} dataVersion={graphVersion} />}
        </ErrorBoundary>
        </OpenTabContext.Provider>
      </main>
      <footer>
        All brands, catalog data and example photos are fictional and synthetic, and image models on Amazon Bedrock generated the images. This is sample code for non-production use, MIT-0. The
        fashion ontology is derived from the <a href="https://fashionpedia.github.io/home/index.html">Fashionpedia</a> ontology (CC BY 4.0, modified). See ontologies/fashion/README.md.
      </footer>
    </>
  );
}
