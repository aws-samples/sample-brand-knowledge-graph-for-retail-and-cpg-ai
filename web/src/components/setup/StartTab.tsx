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

/** Tab 0's list: what you do in each tab, and the point it makes. */
const PATH: { id: Tab; what: string; point: string }[] = [
  { id: 'explore', what: 'Send one photo through a vision model and read its answer in the ontology’s words.', point: 'Every photo gets the same words for the same garment.' },
  { id: 'ingest', what: 'Add new photos and texts to the graph with an AWS Step Functions pipeline.', point: 'The pipeline turns photos into looks you can query.' },
  { id: 'graph', what: 'See every look as one web, then query it in openCypher and in plain words.', point: 'Looks connect through what they share.' },
  { id: 'ask', what: 'Search the product catalog, build RAG on it, walk the graph, then see where it breaks.', point: 'A similarity search finds what sounds alike; the graph finds what is worn together.' },
  { id: 'stylist', what: 'Ask the white sneakers question three ways, then start from a photo instead (Style recommendation).', point: 'GraphRAG shows the look behind each suggestion.' },
  { id: 'lenses', what: 'Questions a buyer, a merchandiser and a creative director can ask the same graph.', point: 'Buyers, merchandisers and creative directors query the same graph.' },
];

/** The same graph in each aisle: what a look, a piece, its purpose and a pairing rule are called there. */
const SAME_SHAPE: [string, string, string, string, string][] = [
  ['What the brand shows', 'Look', 'Regimen', 'Room scene', 'Spread'],
  ['One piece in it', 'Garment', 'Product', 'Piece', 'Product'],
  ['What it is for', 'Occasion', 'Skin type or concern', 'Room', 'Meal occasion'],
  ['The curatorial rule', 'pairs with', 'applied before, conflicts with', 'placed with', 'served with'],
];

/** Tab 2's row when the domain has a new shoot (example photos marked `"batch": "new-shoot"`). */
const PATH_SHOOT = 'Add the brand’s new shoot to the graph with an AWS Step Functions pipeline.';

const labelOf = (id: Tab) => TABS.find((t) => t.id === id)?.label ?? id;

/** Names as one phrase: "A", "A and B", "A, B and C". */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** One brand in "Meet the brand": its description, led by its name when the description does not say it. */
function BrandLine({ name, description }: { name: string; description: string }) {
  return description.includes(name) ? (
    <>{description}</>
  ) : (
    <>
      <b>{name}</b>: {description}
    </>
  );
}

/**
 * "Meet the brand": the graph's brands (`GET /api/summary` `brands`) with their descriptions, the
 * looks and products counted in the graph and the catalog, the new shoot (the domain's example
 * photos marked `"batch": "new-shoot"`) and, when the domain has example photos, how they were
 * made. Nothing here is named in code; a count not read yet (null) is left out.
 */
export function MeetTheBrand({
  brands,
  looks,
  products,
  examples,
}: {
  brands: { name: string; description: string }[];
  looks: number | undefined;
  products: number | null;
  examples: ExampleInfo[] | null;
}) {
  const several = brands.length > 1;
  const shoot = (examples ?? []).filter((e) => e.batch === SHOOT).length;
  return (
    <GoodToKnow title={brands.length ? `Meet the ${several ? 'brands' : 'brand'}: ${listed(brands.map((b) => b.name))}` : 'Meet the brand'}>
      {brands
        .filter((b) => b.description)
        .map((b) => (
          <p key={b.name}>
            <BrandLine name={b.name} description={b.description} />
          </p>
        ))}
      <p>
        {several ? "The stylists' taste is in the brands' lookbooks" : "The stylists' taste is in the lookbook"}
        {looks ? (
          <>
            : <b>{looks.toLocaleString()} looks</b>
          </>
        ) : null}
        , already in the graph as {several ? "each brand's" : "the brand's"} style DNA (each look, its garments and its occasion). The catalog
        {products ? (
          <>
            {' '}
            of <b>{products.toLocaleString()} products</b>
          </>
        ) : null}{' '}
        sits in a separate vector store.
        {shoot ? ` A new shoot of ${shoot} look${shoot === 1 ? '' : 's'} is waiting for you to add in tab 2.` : null}
        {examples?.length ? ' Image models on Amazon Bedrock made the photos.' : null}
      </p>
      <p>
        This sample uses fashion, but the same approach works for other aisles: beauty, home furnishings, food and beverage. See{' '}
        <a
          href="#same-shape"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('stage-5')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          Same shape, another aisle
        </a>{' '}
        below.
      </p>
    </GoodToKnow>
  );
}

/**
 * Tab 0, "Start here", in six numbered steps: 1 the cold open (the white sneakers question asked
 * to a model on its own), 2 what you will build, why it is needed and the difference you will see
 * at the end (and the brand), 3 the tabs one after another and what you will take away, 4 how to
 * read every tab (the step, the callouts, the Inspect and How it works expanders, the optional
 * parts), 5 the same shape in other aisles, 6 what is deployed in the account (SetupDetails: John's
 * setup cards, status only). Then the way into tab 1. Step 2's brand box is MeetTheBrand.
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
  // the domain's example photos: the new shoot tab 2 adds, and whether there are photos at all
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
  const several = brands.length > 1;
  const shoot = (examples ?? []).filter((e) => e.batch === SHOOT).length;
  const [coldOpen] = useColdOpen();
  const asked = coldOpen !== null;

  return (
    <div className="stack start-tab">
      {/* ------------------------------------------------------------ 1 the cold open */}
      <Stage n={1} title="One question, asked to a model on its own" sub="What a model says when no brand is behind it." locked={null} done={asked}>
        <ColdOpen />
      </Stage>
      {/* ------------------------------------------------------------ 2 what you will build, and why */}
      <Stage n={2} title="What you’ll build, and why" sub="A brand knowledge graph, the gap it fills, and the difference you will see at the end." locked={null} done={false}>
        <h4>The graph</h4>
        <p>
          A brand knowledge graph. A vision model on Amazon Bedrock reads the brand&apos;s look photos in the words of an ontology. An AWS Step Functions pipeline stores what it finds in Amazon
          Neptune Analytics: every look, the garments in it and its occasion. That is the brand&apos;s style DNA. Then you build a retriever that answers from those looks: GraphRAG.
        </p>
        <p>
          The graph is also a new data source. Once the stylists&apos; taste is a graph, you can count it and walk it, and it answers more than &ldquo;what goes with this?&rdquo;: what the stylists
          use that the brand doesn&apos;t sell, which pairings are the brand&apos;s signature, whether a new photo is on-brand.
        </p>
        <h4>Why a graph</h4>
        <p>
          A brand&apos;s own answer to that question is in its looks: the pairings its stylists chose, for each occasion. They sit in thousands of photos, and you
          can&apos;t query a photo. The usual tools don&apos;t fill the gap:
        </p>
        <ul>
          <li>
            <b>Vector search, and RAG built on it,</b> finds what is similar. Ask a product search what goes with white sneakers and it returns more white sneakers.
          </li>
          <li>
            <b>Recommendation engines</b> suggest what other shoppers bought. That says little about the pairings the brand&apos;s stylists chose.
          </li>
          <li>
            <b>Fine-tuning</b> on the brand&apos;s content changes the model&apos;s voice. The model can still make things up, and it can&apos;t show where a suggestion came from.
          </li>
        </ul>
        <h4>What you&apos;ll see at the end</h4>
        <p>
          You ask the white sneakers question again, three ways: a model on its own, RAG on the brand&apos;s product catalog, and GraphRAG on the brand&apos;s looks. All three can suggest outfits
          that look fine. RAG finds real products, but the model chose what to search for. GraphRAG answers from the brand&apos;s looks that contain the garment, and shows which look each suggestion
          comes from.
        </p>
        <p>Everything is already deployed in your own AWS account, with the {several ? "brands'" : "brand's"} data loaded.</p>
        <MeetTheBrand brands={brands} looks={looks} products={products} examples={examples} />
      </Stage>
      {/* ------------------------------------------------------------ 3 the tabs, and what you will take away */}
      <Stage n={3} title="The tabs, one after another" sub="What you do in each tab and the point it makes. Click a row to open that tab." locked={null} done={false}>
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
      {/* ------------------------------------------------------------ how to read every tab */}
      <Stage n={4} title="How to read every tab" sub="Where the main path is, and where the depth is." locked={null} done={false}>
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
            <b>In CPG</b> (green): the same idea in another aisle, beauty mostly. One per tab; see <i>Same shape, another aisle</i> below.
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
            <b>Inspect</b> and <b>How it works</b> (blue label): exactly what was sent and what came back, and the AWS services behind a step with their code. Open them when you want to see what
            really happened.
          </p>

          <div className="legend-sample">
            <span className="muted small">If you have time · Deep dives</span>
          </div>
          <p>
            <b>Optional parts:</b> steps marked <i>if you have time</i>, and deep dives at the bottom of a tab. Tab 6 is a bonus.
          </p>
        </div>
      </Stage>

      {/* ------------------------------------------------------------ same shape, another aisle */}
      <Stage n={5} title="Same shape, another aisle" sub="If you have time: the same graph for beauty, home and food." locked={null} done={false}>
        <p>
          The graph has the same shape in any aisle: what the brand shows, the pieces in it, what it is for, and the brand&apos;s rules about what goes together. Only the words change, and
          they come from the ontology. Swap the ontology, and the same pipeline and the same retriever work for another catalog.
        </p>
        <table className="metrics compact same-shape">
          <thead>
            <tr>
              <th />
              <th>Fashion (this sample)</th>
              <th>Beauty and skincare</th>
              <th>Home furnishings</th>
              <th>Food and beverage</th>
            </tr>
          </thead>
          <tbody>
            {SAME_SHAPE.map(([what, ...cells]) => (
              <tr key={what} className="static">
                <td className="muted">{what}</td>
                {cells.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          The three other ontologies are in tab 1, step 4 (<i>Other aisles</i>), to browse.{' '}
          <button type="button" className="linklike" onClick={() => onOpenTab('explore')}>
            Open tab 1
          </button>
        </p>
      </Stage>

      {/* ------------------------------------------------------------ what is deployed */}
      <Stage n={6} title="What’s deployed in your account" sub="If you have time: the AWS resources behind the app." locked={null} done={false}>
        <SetupDetails domain={domain} ontologies={ontologies} onDomain={onDomain} graphDomain={graphDomain} />
      </Stage>

      {/* ------------------------------------------------------------ begin */}
      <NextTab to="explore" lead="Begin with">
        <p>Go through the tabs in order, at your own pace. Start with tab 1.</p>
      </NextTab>
    </div>
  );
}
