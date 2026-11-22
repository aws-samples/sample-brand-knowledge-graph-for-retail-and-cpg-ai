// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogHit, CatalogQuery, ExampleInfo } from '../../api';
import { visibleText } from '../../visibleText';
import { forgetKept, resetKept, setKept } from '../shared/kept';
import { SHOP_K, SHOP_REQUESTS, ShopItYourself } from './ShopItYourself';
import { MeetTheBrand, StartTab } from './StartTab';

// Nothing here reaches the network: the searches and the cold open run only on a click, and
// renderToStaticMarkup runs no effects.
vi.mock('../../auth', () => ({ signIn: async () => {} }));

/** The box as a reader sees it: tags dropped, the escaped characters back. */
const text = (html: string) => visibleText(html);
/** The same, with a space where a tag was, so the words of neighbouring elements stay apart. */
const spaced = (html: string) => visibleText(html, ' ').replace(/\s+/g, ' ');

const apparel = { name: 'AnyCompany Apparel', description: 'AnyCompany Apparel is a contemporary label built on three lines.' };
const fashionHouse = { name: 'AnyCompany Fashion House', description: 'A fictional luxury brand.' };
const photo = (file: string, batch?: string) => ({ file, title: file, ...(batch ? { batch } : {}) }) as ExampleInfo;

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetKept();
  forgetKept('');
});
afterEach(() => vi.unstubAllGlobals());

describe('MeetTheBrand (tab 0)', () => {
  it('names every brand of the graph with its description and the counts it has read', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[apparel, fashionHouse]} looks={20} products={62} examples={[photo('01.jpg', 'first'), photo('02.jpg')]} />));
    expect(html).toContain('Meet the brands: AnyCompany Apparel and AnyCompany Fashion House');
    expect(html).toContain('AnyCompany Apparel is a contemporary label built on three lines.');
    // a description that does not say the name is led by it
    expect(html).toContain('AnyCompany Fashion House: A fictional luxury brand.');
    expect(html).toContain("The stylists' taste is in the brands' lookbooks: 20 looks, already in the graph (each look, its garments and its occasion).");
    expect(html).toContain('The catalog of 62 products sits in a separate vector store.');
    expect(html).toContain('Image models on Amazon Bedrock made the photos.');
    expect(html).not.toContain('new shoot');
    expect(html).toContain('This sample uses fashion');
  });

  it('says the new shoot only with new-shoot photos, with their count', () => {
    const examples = [photo('a.jpg', 'new-shoot'), photo('b.jpg', 'new-shoot'), photo('c.jpg', 'new-work')];
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[apparel]} looks={120} products={527} examples={examples} />));
    expect(html).toContain('Meet the brand: AnyCompany Apparel');
    expect(html).toContain("The stylists' taste is in the lookbook: 120 looks, already in the graph (each look, its garments and its occasion).");
    expect(html).toContain('A new shoot of 2 looks is waiting for you to add in tab 2.');
  });

  it('leaves out what it has not read yet, with no stand-in count, brand or shoot', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[]} looks={undefined} products={null} examples={null} />));
    expect(html).toContain('Meet the brand');
    expect(html).not.toContain('Meet the brand:');
    expect(html).toContain("The stylists' taste is in the lookbook, already in the graph (each look, its garments and its occasion).");
    expect(html).toContain('The catalog sits in a separate vector store.');
    expect(html).not.toMatch(/\d/);
    expect(html).not.toContain('new shoot');
    expect(html).not.toContain('image model');
  });

  it('says nothing of how photos were made when the domain has none', () => {
    const html = text(renderToStaticMarkup(<MeetTheBrand brands={[{ name: 'AnyCompany Apparel', description: '' }]} looks={19} products={55} examples={[]} />));
    expect(html).toContain('Meet the brand: AnyCompany Apparel');
    expect(html).not.toContain('AnyCompany Apparel:');
    expect(html).not.toContain('image model');
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
    expect(seen).not.toContain('Three terms');
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
  });

  it('gives the business problem with its sources, the three terms and the tease once a request ran', () => {
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)) });
    setKept('shopIt.picked', SNEAKERS);
    const html = renderToStaticMarkup(<ShopItYourself />);
    const seen = spaced(html);
    expect(seen).toContain('The brand has already answered these questions.');
    expect(seen).toContain('score 62 to 75 on attribute swaps where people score 97 to 100');
    expect(seen).toContain('trails GraphRAG by 27 to 28 points on multi-hop questions');
    for (const href of ['https://arxiv.org/abs/2306.14610', 'https://arxiv.org/abs/2501.09425', 'https://arxiv.org/abs/2604.09666'])
      expect(html).toContain(`<a href="${href}" target="_blank" rel="noreferrer">`);
    expect(seen).toContain('Three terms');
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
    expect(html).toContain('<p class="error">HTTP 403</p>');
    const seen = spaced(html);
    expect(seen).toContain("A similarity search has no way to say 'not': it matched \"dress\" and ignored the rest.");
    expect(seen).toContain('Three terms'); // the step still teaches
  });

  it('counts the black products the second request returned, because that depends on the catalog', () => {
    const dress = 'A sleeveless dress, not black';
    const hits = (...colors: string[]) => colors.map((color, i) => ({ key: `d${i}`, search: dress, distance: 0.8, name: `${color} dress`, category: 'wholebody', type: 'dress', color, image_key: '', text: '' }));
    setKept('shopIt.picked', dress);
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Black', 'Sage', 'White', 'Black', 'Navy', 'Black'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain("has no way to say 'not': 3 of the 6 products are black.");
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Sage', 'Black'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain("has no way to say 'not': one of the products is black.");
    setKept('shopIt.results', { [dress]: DONE(result(dress, hits('Sage', 'White'))) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('it matched "dress" and ignored the rest.');
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
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned only coats and no denim: it matched one word and ignored how the two pieces combine.');
    setKept('shopIt.results', { [trench]: DONE(result(trench, [coats[0], hit('White linen dress', 'dress', 'white')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned coats and no denim: it matched one word');
    setKept('shopIt.results', { [trench]: DONE(result(trench, [hit('Indigo denim jacket', 'jacket', 'indigo')])) });
    expect(spaced(renderToStaticMarkup(<ShopItYourself />))).toContain('The search returned denim and no coat: it matched one word');
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

  it('has six numbered steps, Shop it yourself second, and the tabs folded into step 3', () => {
    const html = page();
    const titles = [...html.matchAll(/<h3 id="stage-(\d)">([^<]*)<\/h3>/g)].map((m) => `${m[1]} ${visibleText(m[2])}`);
    expect(titles).toEqual(['1 One question, asked to a model on its own', '2 Shop it yourself', '3 What you’ll build', '4 How to read every tab', '5 Same shape, another aisle', '6 What’s deployed in your account']);
    const seen = spaced(html);
    expect(seen).toContain('The tabs, one after another');
    expect(seen).toContain('Send one photo through a vision model and read its answer, written with the ontology’s terms.');
    expect(seen).not.toContain('Why a graph');
    expect(seen).not.toContain("What you'll see at the end");
  });

  it('compares the three answers in a table and tells the reader the app can be followed alone', () => {
    const seen = spaced(page());
    expect(seen).toContain('The same question, three answers');
    expect(seen).toContain("LLM only The model's own taste Nothing: no source behind any of it");
    expect(seen).toContain("RAG The model's own taste, on real products Products that exist, and nothing that says they go together");
    expect(seen).toContain("GraphRAG The brand's own looks The looks each suggestion comes from, with counts");
    expect(seen).toContain('Open How it works as you go: it shows the AWS services behind the step as a numbered diagram, with the code of each step.');
    expect(seen).toContain('The app guides you with numbered steps, so you can follow it without the workshop guide; the guide explains the ideas behind each tab when you want more.');
  });

  it('marks step 2 done once one request ran', () => {
    expect(page()).not.toMatch(/<span class="rt-step done">2/);
    setKept('shopIt.results', { [SNEAKERS]: DONE(result(SNEAKERS, sneakerHits)) });
    expect(page()).toMatch(/<span class="rt-step done">2/);
  });
});
