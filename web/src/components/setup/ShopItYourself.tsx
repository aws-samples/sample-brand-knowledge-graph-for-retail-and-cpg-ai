// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { api, type CatalogHit, type CatalogQuery } from '../../api';
import { Busy, runInto, type Async } from '../payoff/parts';
import { GoodToKnow, Lead, Notice, YourTurn } from '../retriever/Callouts';
import { useKept } from '../shared/kept';
import { StoredPhoto } from '../shared/StoredPhoto';

/** The words that make a product a shoe, in its kind or its name. */
const SHOE = /\b(shoe|sneaker|trainer|boot|mule|loafer|sandal|pump|heel)s?\b/i;
const isShoe = (h: CatalogHit) => SHOE.test(`${h.type} ${h.name}`);
/** How many of the products a request returned are shoes, and how many of those are white. */
export const shoeHits = (hits: CatalogHit[]) => ({ shoes: hits.filter(isShoe).length, white: hits.filter((h) => isShoe(h) && /\bwhite\b/i.test(`${h.color} ${h.name}`)).length });
/** How many of the products a request returned are black (the colour the second request rules out). */
export const blackHits = (hits: CatalogHit[]) => hits.filter((h) => /\bblack\b/i.test(`${h.color} ${h.name}`)).length;
/** How many of the products a request returned are coats, and how many are denim (the third request's two pieces). */
export const pieceHits = (hits: CatalogHit[]) => ({
  coats: hits.filter((h) => /\b(trench|coat)s?\b/i.test(`${h.type} ${h.name}`)).length,
  denim: hits.filter((h) => /\bdenim\b/i.test(`${h.type} ${h.name}`)).length,
});

/**
 * The four requests a shopper might type into a product search, in the order the buttons show
 * them, each with the line that says what the shopper wanted and what came back. The lines are
 * written here, not by a model. The first three read the results, because what comes back depends
 * on the catalog: the sample's own 62 products return a white shoe and shoes in other colours, a
 * black dress first, coats and denim pants; a larger catalog returns six white sneakers, six black
 * dresses and six trench coats. The fourth line holds for both: shirts in one colour each.
 */
export const SHOP_REQUESTS: { request: string; line: string | ((hits: CatalogHit[]) => string) }[] = [
  {
    request: 'What goes with white sneakers?',
    line: (hits) => {
      const { shoes, white } = shoeHits(hits);
      if (shoes === 0) return 'The shopper wanted an outfit. The search returned no outfit, only what looks or sounds alike.';
      const came = white === hits.length ? 'only more white shoes' : shoes === hits.length ? 'only more shoes' : `${shoes} more shoes`;
      return `The shopper wanted an outfit. The search returned ${came}, because it finds what looks or sounds alike.`;
    },
  },
  {
    request: 'A sleeveless dress, not black',
    line: (hits) => {
      const black = blackHits(hits);
      const came = black === 0 ? 'it matched "dress" and ignored the rest' : black === 1 ? 'one of the products is black' : `${black} of the ${hits.length} products are black`;
      return `The shopper ruled a colour out. A similarity search has no way to say 'not': ${came}.`;
    },
  },
  {
    request: 'A trench over denim',
    line: (hits) => {
      const { coats, denim } = pieceHits(hits);
      const one = 'it matched one word and ignored how the two pieces combine';
      const came =
        coats && denim ? 'matched the two words and ignored how they combine' : coats ? `returned ${coats === hits.length ? 'only coats' : 'coats'} and no denim: ${one}` : denim ? `returned denim and no coat: ${one}` : 'matched what looks or sounds alike and ignored how the two pieces combine';
      return `The shopper wanted two pieces worn in one order. The search ${came}.`;
    },
  },
  {
    request: 'A blue shirt with a white collar',
    line: 'The shopper wanted each colour on its own part. The search returned shirts and tops in one colour each: it cannot pin a colour to a part.',
  },
];

/** How many products one request shows: the same k as tab 4's first search. */
export const SHOP_K = 6;

/** The research behind the "What to notice" box, as short links. */
const SOURCES: { label: string; href: string }[] = [
  { label: 'SugarCrepe (NeurIPS 2023)', href: 'https://arxiv.org/abs/2306.14610' },
  { label: 'NegBench (CVPR 2025)', href: 'https://arxiv.org/abs/2501.09425' },
  { label: 'RAGSearch (2026)', href: 'https://arxiv.org/abs/2604.09666' },
];

type Results = Record<string, Async<CatalogQuery>>;
const RESULTS_KEY = 'shopIt.results';
const PICKED_KEY = 'shopIt.picked';
const IDLE = { status: 'idle' } as const;

/** Whether a request ran (it answered or it failed): the step counts as done either way. */
const ran = (r: Async<unknown> | undefined) => r?.status === 'done' || r?.status === 'error';

/** The kept results of the four requests (kept.ts) and whether any of them ran. */
export function useShopItYourself(): { results: Results; done: boolean } {
  const [results] = useKept<Results>(RESULTS_KEY, {});
  return { results, done: Object.values(results).some(ran) };
}

/** The six products one request returned, compact: photo when the catalog has one, name, kind, colour. */
function Products({ hits }: { hits: CatalogHit[] }) {
  return (
    <ol className="start-shop-list">
      {hits.map((h) => (
        <li key={h.key}>
          <StoredPhoto photoKey={h.image_key} alt={h.name} className="stored-photo thumb" />
          <span>
            <b>{h.name}</b>
            <span className="muted">
              {' '}
              {[h.type, h.color].filter(Boolean).join(', ')}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Tab 0's step 2, "Shop it yourself": the shopper's problem, felt before any technology is named.
 * Four requests, each a button; choosing one runs the catalog's similarity search
 * (`POST /api/catalog/search`, the read-only search tab 4's stage 1 opens up) on the deployed
 * catalog and lists the six nearest products, then one line on what the shopper wanted and what
 * came back (SHOP_REQUESTS). The results of all four requests and the request on show are kept
 * (kept.ts), so they survive a tab switch and a reload. Once one request ran, the step shows the business
 * problem (What to notice, with its sources), the three terms (Good to know) and the tease into
 * tab 1. A failed search shows its error in the app's small style and keeps the line.
 */
export function ShopItYourself() {
  const [results, setResults] = useKept<Results>(RESULTS_KEY, {});
  const [picked, setPicked] = useKept<string>(PICKED_KEY, '');
  const shown = SHOP_REQUESTS.find((r) => r.request === picked) ?? null;
  const state: Async<CatalogQuery> = shown ? (results[shown.request] ?? IDLE) : IDLE;
  const anyRan = Object.values(results).some(ran);

  const run = (request: string) => {
    setPicked(request);
    void runInto(
      (s) => setResults((prev) => ({ ...prev, [request]: s })),
      () => api.catalogSearch(request, SHOP_K),
    );
  };

  return (
    <>
      <Lead>
        A shopper types a request into the brand&apos;s product search. Try four of them on the products in your account, and read what comes back.
      </Lead>
      <YourTurn>
        <p>
          Choose a request. The search returns the six closest products. Try all four.
        </p>
      </YourTurn>
      <div className="row start-shop-requests" role="group" aria-label="shopper requests">
        {SHOP_REQUESTS.map(({ request }) => {
          const r = results[request];
          const running = r?.status === 'running';
          return (
            <button
              key={request}
              type="button"
              className={`secondary${ran(r) ? ' start-shop-ran' : ''}`}
              aria-pressed={picked === request}
              disabled={running}
              onClick={() => run(request)}
            >
              {ran(r) && picked !== request && (
                <span className="start-shop-check" aria-hidden="true">
                  {'\u2713 '}
                </span>
              )}
              {running ? 'Searching…' : request}
            </button>
          );
        })}
      </div>

      {shown && (
        <div className="start-shop-result">
          <Busy state={state} text="Searching the catalog…" />
          {state.status === 'done' && (state.value.hits.length ? <Products hits={state.value.hits} /> : <p className="muted small">The catalog returned no products for this request.</p>)}
          {ran(state) && <p className="start-shop-line">{typeof shown.line === 'function' ? shown.line(state.status === 'done' ? state.value.hits : []) : shown.line}</p>}
        </div>
      )}

      {anyRan && (
        <>
          <Notice>
            <p>
              The brand has already answered these questions. Its stylists chose the pairings in every look they shot, for each occasion. That knowledge sits in thousands of photos
              that nothing can query, so it never reaches the shopper. A larger embedding model does not close the gap: image and text embedding models score 62 to 75 on attribute
              swaps where people score 97 to 100, they stay near chance on negation, and dense retrieval trails GraphRAG by 27 to 28 points on multi-hop questions.
            </p>
            <p className="small muted">
              Sources:{' '}
              {SOURCES.map((s, i) => (
                <span key={s.href}>
                  {i > 0 && ', '}
                  <a href={s.href} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                </span>
              ))}
            </p>
          </Notice>
          <GoodToKnow title="Three terms">
            <dl className="start-terms">
              <dt>Taxonomy</dt>
              <dd>The tree of kinds. A coat is a kind of whole-body garment. The ontology has no sneaker class: a sneaker is a shoe with a name.</dd>
              <dt>Ontology</dt>
              <dd>
                The taxonomy plus the details each kind can have, the values each detail allows, the relations between kinds and the rules. It is the fixed list of words the vision
                model has to use, so every photo is described the same way.
              </dd>
              <dt>Graph data</dt>
              <dd>The brand&apos;s looks and garments stored as nodes and edges in those words, so you can count them and follow the links.</dd>
            </dl>
          </GoodToKnow>
          <p className="start-shop-tease">Next, tab 1 opens the ontology the brand&apos;s photos are read with, and tabs 2 and 3 build the graph from them and show it.</p>
        </>
      )}
    </>
  );
}
