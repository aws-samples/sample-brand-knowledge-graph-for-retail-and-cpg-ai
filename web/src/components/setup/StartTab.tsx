// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type ExampleInfo, type OntologySummary, type Summary } from '../../api';
import { TABS, type Tab } from '../../tabs';
import { SHOOT } from '../pipeline/useSources';
import { GoodToKnow, InCpg, Notice, YourTurn } from '../retriever/Callouts';
import { NextTab } from '../shared/NextTab';
import { Stage } from '../shared/Stage';
import { Takeaways } from '../shared/Takeaways';
import { ColdOpen, useColdOpen } from './ColdOpen';
import { SetupDetails } from './SetupTab';
import { ShopItYourself, useShopItYourself } from './ShopItYourself';

/** Tab 0's list: what you do in each tab, and the point it makes. */
const PATH: { id: Tab; what: string; point: string }[] = [
  { id: 'explore', what: 'Send one photo through a vision model and read its answer, written with the ontology’s terms.', point: 'Every photo gets the same words for the same garment.' },
  { id: 'ingest', what: 'Add new photos and texts to the graph with an AWS Step Functions pipeline.', point: 'The pipeline turns photos into looks you can query.' },
  { id: 'graph', what: 'See every look as one web, then query it in openCypher and in plain words.', point: 'Looks connect through what they share.' },
  { id: 'ask', what: 'Search the product catalog, build RAG on it, walk the graph, then see where it breaks.', point: 'A similarity search finds what sounds alike; the graph finds what is worn together.' },
  { id: 'stylist', what: 'Ask the white sneakers question to a model on its own, to RAG and to GraphRAG, then start from a photo instead (Style recommendation).', point: 'GraphRAG shows the look behind each suggestion.' },
  { id: 'lenses', what: 'Questions a buyer, a merchandiser and a creative director can ask the same graph.', point: 'Buyers, merchandisers and creative directors query the same graph.' },
];

/** Tab 2's row when the domain has a new shoot (example photos marked `"batch": "new-shoot"`). */
const PATH_SHOOT = 'Add the brand’s new shoot to the graph with an AWS Step Functions pipeline.';

const labelOf = (id: Tab) => TABS.find((t) => t.id === id)?.label ?? id;

/** Names as one phrase: "A", "A and B", "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * The first sentence of "What you'll build": the brands in the graph (`GET /api/summary` `brands`),
 * the looks counted in the graph and the products counted in the catalog. Nothing here is named in
 * code; a count or a name not read yet is left out, and the sentence still reads.
 */
export function brandsSentence(brands: { name: string }[], looks: number | undefined, products: number | null): string {
  const who = brands.length ? listed(brands.map((b) => b.name)) : 'the brand';
  const what = looks ? `${looks.toLocaleString()} looks from ${who}` : `the looks of ${who}`;
  const catalog = products ? `a catalog of ${products.toLocaleString()} products` : 'a product catalog';
  return `Your account holds ${what} and ${catalog}.`;
}

/**
 * Tab 0, "Start here", in five numbered steps: 1 the cold open (the white sneakers question asked
 * to a model on its own), 2 the shopper's search (four shopper requests through the catalog's
 * similarity search, the business problem, the terms to note and the tease into tab 1), 3 what you
 * will build (one paragraph on the brands, the graph and the steps, then the tabs table and what
 * you will take away), 4 how to read every tab (the step, the callouts, the Inspect and How it
 * works expanders, the optional parts), 5 what is deployed in the account (SetupDetails: the setup
 * cards, status only). Then the link to tab 1.
 */
export function StartTab({
  domain,
  ontologies,
  onDomain,
  graphDomain,
  summary,
  onOpenTab,
}: {
  domain: string;
  ontologies: OntologySummary[];
  onDomain: (id: string) => void;
  graphDomain: string;
  summary: Summary | null;
  onOpenTab: (t: Tab) => void;
}) {
  const [products, setProducts] = useState<number | null>(null);
  useEffect(() => {
    api.catalogInfo().then(
      (c) => setProducts(c.count),
      () => undefined,
    );
  }, []);
  // the domain's example photos: whether the new shoot tab 2 adds is there
  const [examples, setExamples] = useState<ExampleInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    setExamples(null);
    if (domain)
      api.examples(domain).then(
        (r) => live && setExamples(r.examples),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [domain]);
  const looks = summary?.nodes?.Look;
  const brands = (summary?.brands ?? []).filter((b) => b.name);
  const shoot = (examples ?? []).filter((e) => e.batch === SHOOT).length;
  const [coldOpen] = useColdOpen();
  const asked = coldOpen !== null;
  const shopped = useShopItYourself().done;

  return (
    <div className="stack start-tab">
      {/* ------------------------------------------------------------ 1 the cold open */}
      <Stage n={1} title="What happens when you ask a model on its own about fashion?" sub="What a model says when no brand is behind it." locked={null} done={asked}>
        <ColdOpen />
      </Stage>
      {/* ------------------------------------------------------------ 2 the shopper's search */}
      <Stage
        n={2}
        title="Similarity search alone gives confusing answers in a domain like fashion"
        sub="Try requests a shopper might type into the product search that regular RAG is built on."
        locked={null}
        done={shopped}
      >
        <ShopItYourself />
      </Stage>
      {/* ------------------------------------------------------------ 3 what you will build, then the tabs */}
      <Stage n={3} title="What you’ll build" sub="A brand knowledge graph and the tabs that get you there." locked={null} done={false}>
        <p>
          {brandsSentence(brands, looks, products)} You will build a smart way to break outfits down with the help of the brand&apos;s style and AI, and a consistent way to load those
          outfit breakdowns as a graph. To get there, you explore the ontology, send photos through a vision model that uses its terms, store the looks in Amazon Neptune Analytics,
          build the retriever and compare the answers. The table lists the tabs in order, and a click on a row opens that tab.
        </p>
        <table className="metrics start-path">
          <thead>
            <tr>
              <th>Tab</th>
              <th>What you do</th>
              <th>The point it makes</th>
            </tr>
          </thead>
          <tbody>
            {PATH.map((p) => (
              <tr key={p.id} onClick={() => onOpenTab(p.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpenTab(p.id)}>
                <td>
                  <b>{labelOf(p.id)}</b>
                </td>
                <td>{p.id === 'ingest' && shoot ? PATH_SHOOT : p.what}</td>
                <td>{p.point}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>What you&apos;ll take away</h4>
        <Takeaways />
      </Stage>
      {/* ------------------------------------------------------------ 4 how to read every tab */}
      <Stage n={4} title="How to read every tab" sub="How to tell the main path from the optional parts." locked={null} done={false}>
        <p>Every tab works the same way. Follow the numbered steps and the orange boxes. Open the rest when you want to go deeper.</p>
        <div className="legend-grid">
          <div className="legend-sample">
            <div className="rt-stage-head">
              <span className="rt-step">1</span>
              <span className="rt-step done">1</span>
            </div>
          </div>
          <p>
            <b>A numbered step.</b> It turns green when you finish it. Some steps unlock when the one before is done.
          </p>

          <div className="legend-sample">
            <YourTurn>
              <p>Search white sneaker.</p>
            </YourTurn>
          </div>
          <p>
            <b>Your turn:</b> something to do or try. This is the main path.
          </p>

          <div className="legend-sample">
            <Notice>
              <p>A similarity search finds what sounds alike.</p>
            </Notice>
          </div>
          <p>
            <b>What to notice:</b> the point of the step.
          </p>

          <div className="legend-sample">
            <GoodToKnow>
              <p>A side fact.</p>
            </GoodToKnow>
          </div>
          <p>
            <b>Good to know:</b> background. Skip it if you are short of time.
          </p>

          <div className="legend-sample">
            <InCpg>
              <p>The same point for a beauty brand.</p>
            </InCpg>
          </div>
          <p>
            <b>In CPG</b> (green): the same idea in another aisle, beauty mostly. One per tab.
          </p>

          <div className="legend-sample">
            <details className="xp xp-inspect">
              <summary>Inspect: exactly what ran</summary>
              <pre className="code po-pre">the prompt, the query or the reply, as sent</pre>
            </details>
            <details className="card panel arch-panel">
              <summary>How it works: the AWS services and the code</summary>
              <p className="muted small">The service diagram, with the live code of each step.</p>
            </details>
          </div>
          <p>
            <b>Inspect</b> and <b>How it works</b> (blue label): exactly what was sent and what came back, and the AWS services behind a step. Open How it works as you go. It shows
            the services as a numbered diagram, with the code of each step.
          </p>

          <div className="legend-sample">
            <span className="muted small">If you have time · Deep dives</span>
          </div>
          <p>
            <b>Optional parts:</b> steps marked <i>if you have time</i>, and deep dives at the bottom of a tab. Tab 6 is a bonus.
          </p>
        </div>
      </Stage>

      {/* ------------------------------------------------------------ 5 what is deployed */}
      <Stage n={5} title="What’s deployed in your account" sub="If you have time: the AWS resources behind the app." locked={null} done={false}>
        <SetupDetails domain={domain} ontologies={ontologies} onDomain={onDomain} graphDomain={graphDomain} />
      </Stage>

      {/* ------------------------------------------------------------ begin */}
      <NextTab to="explore" lead="Begin with">
        <p>Go through the tabs in order, at your own pace. The app guides you with numbered steps, so you can follow it without the workshop guide.</p>
      </NextTab>
    </div>
  );
}
