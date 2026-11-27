// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogHit, CatalogQuery } from '../../api';
import { visibleText } from '../../visibleText';
import { forgetKept, resetKept, setKept } from '../shared/kept';
import { SHOP_K, SHOP_REQUESTS, ShopItYourself } from './ShopItYourself';
import { brandsSentence, StartTab } from './StartTab';

// Nothing here reaches the network: the searches and the cold open run only on a click, and
// renderToStaticMarkup runs no effects.
vi.mock('../../auth', () => ({ signIn: async () => {} }));

/** The page as a reader sees it: tags dropped with a space in their place, the escaped characters back. */
const spaced = (html: string) => visibleText(html, ' ').replace(/\s+/g, ' ');

const apparel = { name: 'AnyCompany Apparel', description: 'AnyCompany Apparel is a contemporary label built on three lines.' };
const fashionHouse = { name: 'AnyCompany Fashion House', description: 'A fictional luxury brand.' };

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetKept();
  forgetKept('');
});
afterEach(() => vi.unstubAllGlobals());

describe('brandsSentence (tab 0, step 3)', () => {
  it('names every brand of the graph with the counts it has read', () => {
    expect(brandsSentence([apparel, fashionHouse], 20, 62)).toBe('Your account holds 20 looks from AnyCompany Apparel and AnyCompany Fashion House and a catalog of 62 products.');
    expect(brandsSentence([apparel], 120, 527)).toBe('Your account holds 120 looks from AnyCompany Apparel and a catalog of 527 products.');
  });

  it('leaves out what it has not read yet, with no stand-in count or brand', () => {
    expect(brandsSentence([], undefined, null)).toBe('Your account holds the looks of the brand and a product catalog.');
    expect(brandsSentence([apparel], undefined, null)).toBe('Your account holds the looks of AnyCompany Apparel and a product catalog.');
    expect(brandsSentence([], 19, 55)).toBe('Your account holds 19 looks from the brand and a catalog of 55 products.');
  });
});

const hit = (name: string, type: string, color: string, image_key = ''): CatalogHit => ({ key: name.toLowerCase().replace(/\s+/g, '-'), search: 'q', distance: 0.8, name, category: 'c', type, color, image_key, text: name });
const result = (query: string, hits: CatalogHit[]): CatalogQuery => ({ query, k: SHOP_K, vector: { dimension: 1024, first: [0.01], norm: 1 }, hits, metrics: { embed_ms: 190, search_ms: 62 } });
const DONE = <T,>(value: T) => ({ status: 'done' as const, value });

const SNEAKERS = 'What goes with white sneakers?';
// what the sample's own 62-product catalog returned for it (k = 6)
const sneakerHits = [hit('White shoe', 'shoe', 'white'), hit('White linen shorts', 'shorts', 'white'), hit('Sand suede shoe', 'shoe', 'sand'), hit('Black satin shoe', 'shoe', 'black'), hit('Black patent leather shoe', 'shoe', 'black'), hit('Black leather bag', 'bag', 'black')];

describe('ShopItYourself (tab 0, step 2)', () => {
  it('shows the four requests as buttons, in order, and nothing of the lesson before one ran', () => {
    const html = renderToStaticMarkup(<ShopItYourself />);
    const labels = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => visibleText(m[1]));
    expect(labels).toEqual(['What goes with white sneakers?', 'A sleeveless dress, not black', 'A trench over denim', 'A blue shirt with a white collar']);
    expect(SHOP_REQUESTS.map((r) => r.request)).toEqual(labels);
    const seen = spaced(html);
    expect(seen).toContain('Choose a request.');
    expect(seen).not.toContain('What to notice');
    expect(seen).not.toContain('Terms to note');
    expect(seen).not.toContain('Next, tab 1');
  });

  it('lists the kept products of the request on show, with the line under them', () => {
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)) });
    setKept('shopIt.picked', SNEAKERS);
    const html = renderToStaticMarkup(<ShopItYourself />);
    const seen = spaced(html);
    for (const h of sneakerHits) expect(seen).toContain(h.name);
    expect(seen).toContain('White shoe shoe, white');
    expect(seen).toContain('The shopper wanted an outfit. The search returned 4 more shoes, because it finds what looks or sounds alike.');
    // the request on show is the pressed toggle; a text catalog has no photos, so no thumbnail
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>What goes with white sneakers\?<\/button>/);
    expect(html).not.toContain('stored-photo');
  });

  it('shows a thumbnail when the catalog has a photo of the product', () => {
    const hits = [hit('Navy denim jacket', 'jacket', 'navy', 'anycompany-apparel/products/navy-denim-jacket.jpg')];
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, hits)) });
    setKept('shopIt.picked', SNEAKERS);
    const html = renderToStaticMarkup(<ShopItYourself />);
    expect(html).toContain('class="stored-photo thumb placeholder"');
    expect(html).toContain('aria-label="Navy denim jacket: loading"');
    expect(html).not.toContain('no-photo');
  });

  it('marks a product without a photo as such when the other products have one (two catalogs, one of them text only)', () => {
    // the fourth request on the workshop's two catalogs: five Fashion House shirts with photos, one Apparel top without
    const BLUE = 'A blue shirt with a white collar';
    const hits = [
      hit('Light blue cotton utility shirt', 'utility shirt', 'light blue', 'anycompany-fashion-house/products/item_1.jpg'),
      hit('White cotton button-up shirt', 'button-up shirt', 'white', 'anycompany-fashion-house/products/item_2.jpg'),
      hit('Sage cotton top', 'top', 'sage'),
    ];
    setKept('shopIt.results', { [BLUE]: DONE(result(BLUE, hits)) });
    setKept('shopIt.picked', BLUE);
    const html = renderToStaticMarkup(<ShopItYourself />);
    // the same square as the loading placeholder, marked and explained, so the rows stay aligned
    expect(html).toContain('<span class="stored-photo thumb placeholder no-photo" role="img" aria-label="Sage cotton top: no photo in the catalog" title="No photo in the catalog">');
    expect(html).toContain('aria-label="Light blue cotton utility shirt: loading"');
    expect(html.match(/class="stored-photo thumb placeholder"/g)).toHaveLength(2);
    expect(spaced(html)).toContain('Sage cotton top top, sage');
  });

  it('gives the business problem without a source list, the terms to note and the tease once a request ran', () => {
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)) });
    setKept('shopIt.picked', SNEAKERS);
    const html = renderToStaticMarkup(<ShopItYourself />);
    const seen = spaced(html);
    expect(seen).toContain('The brand has already answered these questions.');
    expect(seen).toContain('Embedding models have gaps that a larger model does not close. Image and text embedding models score 62 to 75 on attribute swaps where people score 97 to 100');
    expect(seen).toContain('trails GraphRAG by 27 to 28 points on multi-hop questions');
    expect(seen).not.toContain('Sources');
    expect(html).not.toContain('arxiv.org');
    expect(seen).toContain('Terms to note');
    expect(seen).toContain('Taxonomy The tree of kinds.');
    expect(seen).toContain('Ontology The taxonomy plus the details each kind can have');
    expect(seen).toContain("Graph data The brand's looks and garments stored as nodes and edges");
    expect(seen).toContain("Next, tab 1 opens the ontology the brand's photos are read with, and tabs 2 and 3 build the graph from them and show it.");
  });

  it('keeps the fixed line when the search failed, and shows the error in the small style', () => {
    const dress = 'A sleeveless dress, not black';
    setKept('shopIt.results', { [dress]: { status: 'error', error: 'HTTP 403' } });
    setKept('shopIt.picked', dress);
    const html = renderToStaticMarkup(<ShopItYourself />);
    expect(html).toContain('<p class="error" role="alert">HTTP 403</p>');
    const seen = spaced(html);
    expect(seen).toContain("A similarity search has no way to say 'not'. It matched \"dress\" and ignored the rest.");
    expect(seen).toContain('Terms to note'); // the step still teaches
  });

  it('counts the black products the second request returned, because that depends on the catalog', () => {
    const dress = 'A sleeveless dress, not black';
    const hits = (...colors: string[]) => colors.map((color, i) => ({ key: `d${i}`, search: dress, distance: 0.8, name: `${color} dress`, category: 'wholebody', type: 'dress', color, image_key: '', text: '' }));
    setKept('shopIt.picked', dress);
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Black', 'Sage', 'White', 'Black', 'Navy', 'Black'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain("has no way to say 'not'. 3 of the 6 products are black.");
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Sage', 'Black'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain("has no way to say 'not'. One of the products is black.");
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Sage', 'White'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('It matched "dress" and ignored the rest.');
  });

  it('says what the first request returned: only white shoes on a larger catalog, no shoes at all, or how many shoes', () => {
    const sneakers = (...names: string[]) => names.map((name) => hit(name, /platform/.test(name) ? 'platform sneakers' : 'sneakers', 'white'));
    setKept('shopIt.picked', SNEAKERS);
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakers('White leather sneakers', 'White leather sneakers', 'White leather platform sneakers', 'White leather sneakers', 'White leather sneakers', 'White leather sneakers'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned only more white shoes, because it finds what looks or sounds alike.');
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, [hit('Tan leather boots', 'boots', 'tan'), hit('Black mules', 'mules', 'black')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned only more shoes, because');
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, [hit('White linen shorts', 'shorts', 'white'), hit('White tee', 'tee', 'white')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The shopper wanted an outfit. The search returned no outfit, only what looks or sounds alike.');
  });

  it('says whether the third request returned coats, denim or both, because that depends on the catalog', () => {
    const trench = 'A trench over denim';
    setKept('shopIt.picked', trench);
    // the sample's own catalog: coats and denim pants among the six
    const mixed = [hit('Stone cotton gabardine coat', 'coat', 'stone'), hit('Beige coat', 'coat', 'beige'), hit('White linen dress', 'dress', 'white'), hit('Indigo selvedge denim pants', 'pants', 'indigo'), hit('Olive linen jumpsuit', 'jumpsuit', 'olive'), hit('Navy linen cotton shirt', 'shirt', 'navy')];
    setKept('shopIt.results', { [trench]: DONE(result(trench, mixed)) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The shopper wanted two pieces worn in one order. The search matched the two words and ignored how they combine.');
    // a larger catalog: six trench coats, no denim
    const coats = ['Beige cotton gabardine trench coat', 'Beige cotton gabardine trench coat', 'Beige cotton sleeveless trench coat', 'Cream cotton blend trench coat', 'Navy wool trench coat', 'Beige cotton gabardine trench coat'].map((n) => hit(n, 'trench coat', 'beige'));
    setKept('shopIt.results', { [trench]: DONE(result(trench, coats)) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned only coats and no denim. It matched one word and ignored how the two pieces combine.');
    setKept('shopIt.results', { [trench]: DONE(result(trench, [coats[0], hit('White linen dress', 'dress', 'white')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned coats and no denim. It matched one word');
    setKept('shopIt.results', { [trench]: DONE(result(trench, [hit('Indigo denim jacket', 'jacket', 'indigo')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned denim and no coat. It matched one word');
    setKept('shopIt.results', { [trench]: { status: 'error', error: 'HTTP 500' } });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search matched what looks or sounds alike and ignored how the two pieces combine.');
  });

  it("says 'Searching…' on the request that still runs and shows the other requests as run", () => {
    const trench = 'A trench over denim';
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)), [trench]: { status: 'running' } });
    setKept('shopIt.picked', trench);
    const html = renderToStaticMarkup(<ShopItYourself />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Searching…<\/button>/);
    expect(spaced(html)).toContain('Searching the catalog…');
    expect(spaced(html)).not.toContain('worn in one order'); // the trench line waits for its result
    expect(html).toContain('start-shop-ran'); // the sneakers request is marked as run
  });
});

describe('StartTab (tab 0)', () => {
  const summary = { backend: 'neptune', nodes: { Look: 20 }, edges: {}, brands: [apparel] } as unknown as Parameters<typeof StartTab>[0]['summary'];
  const page = () => renderToStaticMarkup(<StartTab domain="fashion" ontologies={[]} onDomain={() => undefined} graphDomain="fashion" summary={summary} onOpenTab={() => undefined} />);

  it('has five numbered steps, the shopper’s search second, and the tabs folded into step 3', () => {
    const html = page();
    const titles = [...html.matchAll(/<h3 id="stage-(\d)">([^<]*)<\/h3>/g)].map((m) => `${m[1]} ${visibleText(m[2])}`);
    expect(titles).toEqual([
      '1 What happens when you ask a model on its own about fashion?',
      '2 Similarity search alone gives confusing answers in a domain like fashion',
      '3 What you’ll build',
      '4 How to read every tab',
      '5 What’s deployed in your account',
    ]);
    expect(html).not.toContain('id="stage-6"');
    const seen = spaced(html);
    expect(seen).toContain('Send one photo through a vision model and read its answer, written with the ontology’s terms.');
    expect(seen).toContain('The table lists the tabs in order, and a click on a row opens that tab.');
    expect(seen).not.toContain('The tabs, one after another');
    expect(seen).not.toContain('Same shape, another aisle');
    expect(seen).not.toContain('Why a graph');
    expect(seen).not.toContain("What you'll see at the end");
  });

  it('introduces what you build in one paragraph, from the brands it has read, with no separate brand box or answers table', () => {
    const seen = spaced(page());
    expect(seen).toContain('Your account holds 20 looks from AnyCompany Apparel and a product catalog.');
    expect(seen).toContain("You will build a smart way to break outfits down with the help of the brand's style and AI, and a consistent way to load those outfit breakdowns as a graph.");
    expect(seen).toContain('To get there, you explore the ontology, send photos through a vision model that uses its terms, store the looks in Amazon Neptune Analytics, build the retriever and compare the answers.');
    expect(seen).not.toContain('Meet the brand');
    expect(seen).not.toContain('The same question, three answers');
    expect(seen).not.toContain('Everything is already deployed');
  });

  it('lists three takeaways as techniques and tells the reader the app can be followed alone', () => {
    const html = page();
    const seen = spaced(html);
    expect(seen).toContain("What you'll take away");
    const takeaways = [...html.matchAll(/<li><b>([^<]*)<\/b>/g)].map((m) => visibleText(m[1]));
    expect(takeaways).toEqual([
      'An ontology breaks outfits down into consistent, countable terms.',
      'Graph data is what makes GraphRAG work.',
      "The same graph answers the business's own questions.",
    ]);
    expect(seen).toContain('the creative director asks whether a new photo is on-brand.');
    expect(seen).toContain('Open How it works as you go. It shows the services as a numbered diagram, with the code of each step.');
    expect(seen).toContain('the same idea in another aisle, beauty mostly. One per tab.');
    expect(seen).toContain('The app guides you with numbered steps, so you can follow it without the workshop guide.');
    expect(seen).not.toContain('the guide explains the ideas behind each tab');
  });

  it('marks step 2 done once one request ran', () => {
    expect(page()).not.toMatch(/<span class="rt-step done">2/);
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)) });
    expect(page()).toMatch(/<span class="rt-step done">2/);
  });
});
