// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Tab 6, "What else the graph knows": the same style DNA graph, a different person asking. Three
 * personas (the buyer, the merchandiser, the creative director), three or four questions
 * ("lenses") each. Each lens is a count in the graph, then a model that explains the numbers
 * citing only them; "Is this new photo on-brand?" is a check instead (vector search, a walk, a
 * helper model, a rule), and "What are the emerging trends?" three methods side by side: an agent
 * on the graph, a data agent on the graph exported to Iceberg tables, and a map of the garments'
 * vectors (a cloud picked on it, walked in the graph, then described).
 *
 * This file holds the words on screen. The queries, the numbers and the model calls come from the
 * API (backend lenses.py, `GET /api/lenses`, `POST /api/lenses/*`).
 */
import type { CheckPiece, ExampleInfo, Verdict } from '../../api';
import { NEW_WORK } from '../../domain';

export type PersonaId = 'buyer' | 'merch' | 'creative';

export type Persona = {
  id: PersonaId;
  title: string;
  /** what they are responsible for, in one line */
  role: string;
  /** what they want from the graph */
  wants: string;
};

/** A lens's extra input: a piece to start from, a photo, or a cloud picked on a map of the garments. */
export type LensInput = { kind: 'garment'; label: string; placeholder: string; value: string; chips: string[] } | { kind: 'photo'; label: string } | { kind: 'map' };

export type Lens = {
  id: string;
  persona: PersonaId;
  question: string;
  /** what this count does, in one or two sentences */
  lead: string;
  input?: LensInput;
  /** counts pieces found by vector search (the "pieces, not categories" note applies) */
  usesPieces: boolean;
  notice: string;
  /** why this needs a graph, not a vector store or a recommendation engine */
  whyGraph: string;
  /** the same question for a beauty brand (task 19: curatorial, never inventory) */
  beauty: string;
};

export const PERSONAS: Persona[] = [
  { id: 'buyer', title: 'The buyer', role: 'Decides what the brand stocks next season.', wants: 'What should we buy, and what are we buying that nobody styles?' },
  { id: 'merch', title: 'The merchandiser', role: 'Decides what is featured, bundled and placed side by side on the site.', wants: 'Which pieces carry the brand, and what belongs next to what?' },
  { id: 'creative', title: 'The creative director', role: 'Owns the brand’s look: the shoots, the style guide, what is on-brand.', wants: 'What is our style, in numbers, and does this new work fit it?' },
];

export const LENSES: Lens[] = [
  // ---------------------------------------------------------------- the buyer
  {
    id: 'gaps',
    persona: 'buyer',
    question: 'What do our stylists use that we don’t sell?',
    lead: 'Count how many of the brand’s looks use each piece, then count the catalog’s products of that piece. The pieces the stylists keep using with nothing to buy are a buy list.',
    usesPieces: true,
    notice: 'Every row is backed by looks: before ordering, a buyer can open the looks that use the piece and see how the stylists wear it.',
    whyGraph: 'The catalog alone knows what you sell. Only the graph knows what your stylists use, and how often. The gap sits between the two stores.',
    beauty: 'Which steps do our regimens call for that we don’t make?',
  },
  {
    id: 'orphans',
    persona: 'buyer',
    question: 'Which products did no stylist ever style?',
    lead: 'The other direction: start from the catalog’s product types, and for each one ask whether any of the brand’s looks wears it.',
    usesPieces: false,
    notice: 'These are the products a shopper lands on with no answer to “what goes with it”. You find them here before a shopper does.',
    whyGraph: 'A recommendation engine can only say a product sells slowly. The graph says why: no stylist has ever shown how to wear it.',
    beauty: 'Which products appear in no regimen?',
  },
  {
    id: 'occasion-range',
    persona: 'buyer',
    question: 'What does each occasion lean on?',
    lead: 'For each occasion, compare how often a piece appears there with how often it appears in all looks. A lift above 1 means the occasion leans on it.',
    usesPieces: true,
    notice: 'This is the range per occasion, straight from the brand’s own looks: what to buy deep for each one.',
    whyGraph: 'Occasion is an edge in the graph (Look → FOR → Occasion), so “per occasion” is one more hop, not a new model.',
    beauty: 'What does each skin type lean on?',
  },

  // ---------------------------------------------------------------- the merchandiser
  {
    id: 'heroes',
    persona: 'merch',
    question: 'Which pieces hold the most looks together?',
    lead: 'Count, for each piece, how many looks and how many occasions it appears in. The pieces that cross every occasion are the backbone of the brand.',
    usesPieces: true,
    notice: 'A hero piece is the one the stylists build the most looks around, whether or not it sells best. Feature it, and each of its looks can sell the other pieces in it.',
    whyGraph: 'This is a question about connections: how many looks a piece links to. In a graph that is a count of edges. A vector store has no edges to count.',
    beauty: 'Which product is in the most regimens?',
  },
  {
    id: 'pairings',
    persona: 'merch',
    question: 'Which pairings are the brand’s signature?',
    lead: 'Count how often two pieces are worn in the same look, and compare it with how often they would meet by chance (the lift). Two lists come out: the staples, the clothes and shoes worn together most, and the signatures, the pairs worn together far more than chance.',
    usesPieces: true,
    notice: 'Staples and signatures are different answers. A staple is common: blazers and wide-leg trousers are both everywhere, so they meet often, about as often as chance says. A signature is a choice: two pieces the stylists put together far more than chance. Staples are your core bundles; signatures are what makes the brand this brand.',
    whyGraph: 'Customers-who-bought finds what is popular together. This finds what the stylists put together on purpose, and every pair links to the looks that prove it.',
    beauty: 'Which products are always layered together, like a vitamin C serum and an SPF?',
  },
  {
    id: 'next-to',
    persona: 'merch',
    question: 'What should sit next to this piece on the page?',
    lead: 'Start from one piece, walk to every look it is in, and count what else is worn there. That is the order to place things on its product page.',
    input: { kind: 'garment', label: 'Start from', placeholder: 'a piece, e.g. blazer', value: 'blazer', chips: ['blazer', 'white sneakers', 'midi dress', 'trench coat'] },
    usesPieces: true,
    notice: 'This is the same walk GraphRAG makes in tab 4, from a piece to its looks to what else is in them. Here it ranks a page instead of writing an answer.',
    whyGraph: 'Two hops: piece → look → other pieces. One line of openCypher; a join over three tables in SQL; not possible in a vector store.',
    beauty: 'What comes before and after this serum in a routine?',
  },

  // ---------------------------------------------------------------- the creative director
  {
    id: 'on-brand',
    persona: 'creative',
    question: 'Is this new photo on-brand?',
    lead: 'Show the graph an outfit it has never seen: a new shoot, a supplier sample, a competitor’s look, a street-style shot. A vector search finds the brand’s looks closest to it, and a walk in the graph lists what they wear. Then a helper model compares the outfit with those looks, piece by piece.',
    input: { kind: 'photo', label: 'An outfit the graph has never seen' },
    usesPieces: false,
    notice: 'The similarity score tells you how close the outfit is to the brand overall. The closest looks in the graph show what they wear, so the next step can point at the exact piece that is off.',
    whyGraph: 'The vector search finds the closest looks, but it is one number per photo. The walk to their garments is what lets the helper say which piece is off and what the brand wears instead, with the looks as receipts.',
    beauty: 'Does this new formula fit our rules: no retinol with strong acids, fragrance-free for sensitive skin?',
  },
  {
    id: 'trends',
    persona: 'creative',
    question: 'What are the emerging trends we see this season?',
    lead: 'Three ways to answer the same question, one card each. Method 1 asks an agent that writes its own openCypher on the graph. Method 2 exports the graph to Iceberg tables and asks a data agent that writes SQL. Method 3 puts every worn garment on a map, and you explore its clouds. Side by side, at the end, puts their runs next to each other.',
    input: { kind: 'map' },
    usesPieces: false,
    notice: 'The methods do not count the same thing. The two agents count the pieces of content tab 2 added against the lookbook’s garments; the clouds count the garments worn in the new looks against the garments worn in the lookbook’s looks. Each card says its definition: compare the answers, not only the numbers.',
    whyGraph: 'The vectors find the cloud: pieces that mean the same thing. Only the graph says which looks wear them, what they are worn with and for which occasion, so the model can describe how the brand wears the trend, not only the pieces.',
    beauty: 'Which ingredients and textures are new this season?',
  },
  {
    id: 'style-guide',
    persona: 'creative',
    question: 'What is our style, per occasion?',
    lead: 'For each occasion, the details its looks lean on: the ontology’s own attributes (wide leg, pleat, midi…), against how often they appear in all looks. Then the model writes the style guide from those numbers only.',
    usesPieces: false,
    notice: 'The stylists never wrote this style guide down. You just read it out of their photos, with a count behind every line.',
    whyGraph: 'The ontology made every detail the same word in every look (“wide leg”, not “wide-legged” or “palazzo”), so the graph can count them.',
    beauty: 'What is our routine, per skin concern?',
  },
  {
    id: 'thin',
    persona: 'creative',
    question: 'Where is the lookbook thin?',
    lead: 'Take the pieces the brand uses a lot, and count them per occasion. The occasions where a well-used piece barely appears are a brief for the next shoot, or a rule the brand keeps on purpose.',
    usesPieces: true,
    notice: 'A thin spot is where GraphRAG has little to say. Fill it with a shoot, ingest it in tab 2, and GraphRAG has more looks to answer from. Some gaps are on purpose (no wide-leg trousers with a dress): the creative director decides which.',
    whyGraph: 'Counting what is missing needs exact structure: every look, every occasion, every piece. A vector search ranks what is close, it never says “none”.',
    beauty: 'Which skin concerns have few regimens?',
  },
];

/**
 * The outfits for "Is this new photo on-brand?": the domain's example photos marked as new work
 * (`"batch": "new-work"` in a manifest of its `examples/images/` or of a data set's), photos the
 * graph has never seen, in the order the API lists them. Each shows its title as the outfit and its
 * `origin` as the source line.
 */
export function newWorkPhotos(examples: ExampleInfo[]): ExampleInfo[] {
  return examples.filter((e) => e.batch === NEW_WORK);
}

/** What the photo lens says when the domain has no new work to check. */
export const NO_NEW_WORK = 'This domain has no example photos marked as new work. Add some with "batch": "new-work" in a manifest of its examples/images/ folder.';

/** The fixed rule that sets the verdict (the model's own verdict hedged); the backend applies it, this mirrors it for the screen. */
export const VERDICT_RULE = 'Only the main pieces count (clothes, outerwear, shoes). None off: on-brand. Some off: partly. More than half off: off-brand.';

export function verdictOf(pieces: Pick<CheckPiece, 'main' | 'fits'>[]): Verdict {
  const main = pieces.filter((p) => p.main);
  const off = main.filter((p) => !p.fits).length;
  if (off === 0) return 'on-brand';
  return off * 2 > main.length ? 'off-brand' : 'partly';
}

/** The lenses of one persona, in order. */
export function lensesOf(persona: PersonaId): Lens[] {
  return LENSES.filter((l) => l.persona === persona);
}

/** The explanation as text and citations, so [n] can be drawn as a link to row n. */
export function splitCitations(text: string): (string | number)[] {
  return text.split(/\[(\d+)\]/).map((part, i) => (i % 2 ? Number(part) : part));
}

/** A citation in a finding: a row or item number ([3]) or a look's letter ([B]). */
export type Citation = { kind: 'item'; n: number } | { kind: 'look'; letter: string };

/**
 * The finding as text and citations, both kinds: [n] for an item, [A] for a look, and a list in
 * one pair of brackets ([1, 4] or [A, C]) as one citation each.
 */
export function splitCitationLetters(text: string): (string | Citation)[] {
  const out: (string | Citation)[] = [];
  text.split(/\[((?:\d+|[A-Z])(?:\s*,\s*(?:\d+|[A-Z]))*)\]/).forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) out.push(part);
      return;
    }
    for (const ref of part.split(/\s*,\s*/)) out.push(/\d/.test(ref) ? { kind: 'item', n: Number(ref) } : { kind: 'look', letter: ref });
  });
  return out;
}

/** The trends question's three methods: their titles, what each does and its definition of new against old (backend trends.py for 1 and 2, lenses.py for 3). */
export const TRENDS_METHODS = {
  graph: {
    title: 'Method 1 · Ask the graph agent',
    lead: 'The agent gets the definition of emerging in plain words and writes its own openCypher through the Amazon Neptune MCP server. The groups it returns are counted again in code.',
    definition: 'a piece of content tab 2 added (a photo or a text) is new; every garment of the lookbook is old. A group of properties emerges when its share of the new pieces is well above its share of the lookbook (lift above 1.5).',
  },
  lake: {
    title: 'Method 2 · Export to Iceberg, ask the data agent',
    lead: 'The graph’s garments and features are written to two Apache Iceberg tables in the sample’s S3 table bucket. A data agent explores them with SQL through the Amazon S3 Tables MCP server. The groups it returns are counted again in code.',
    definition: 'the same definition as method 1: the pieces of content tab 2 added against the lookbook’s garments.',
  },
  clouds: {
    title: 'Method 3 · Explore the clouds',
    lead: 'Every garment the brand’s looks wear becomes a point on a map: close in meaning is close on the map. The clouds are groups found on the full vectors, and a cloud with more of the new shoot than of the lookbook is emerging.',
    definition: 'a garment worn in a look tab 2 added (the new shoot) is new; every other garment the lookbook’s looks wear is old. A cloud emerges when its share of the new shoot is above its share of the lookbook.',
    notice: 'The vectors only say which pieces are alike. The lift says whether a cloud grows: its share of the new shoot over its share of the lookbook, counted in code. A cloud can mix kinds of pieces whose descriptions share words, for example pieces of the same new shoot, so a high lift alone does not make a trend. Click the cloud with the highest lift, then read its words, its pieces and the looks that wear them before you call it the season’s trend.',
  },
} as const;

/** The scoreboard under the three methods. */
export const SIDE_BY_SIDE = {
  title: 'Side by side',
  caption: 'Methods 1 and 2 count pieces of content against the lookbook’s garments; method 3 counts garments in looks against the garments worn in the lookbook’s looks. No winner: compare the answers.',
} as const;

/** No new item in the graph yet, so no agent run (the API answers 409). */
export const NOTHING_NEW = 'Nothing new in the graph yet: ingest the first batch in tab 2 first.';
/** A reason from the API as the end of a sentence (no double period). */
const clause = (reason: string) => reason.trim().replace(/\.+$/, '');
export const agentOff = (reason: string) => `The graph agent is not available: ${clause(reason)}.`;
export const lakeOff = (reason: string) => `The lakehouse is not set up: ${clause(reason)}.`;

/**
 * A finished run without an answer: what the model's last turn stopped on, when that was not the
 * end of its turn (max_tokens: the turn spent its output tokens, the reasoning counts toward them).
 */
export function noAnswer(stop: string | undefined): string {
  if (!stop || stop === 'end_turn' || stop === 'tool_use') return 'No answer.';
  if (stop === 'max_tokens') return "No answer: the model's last turn used all its output tokens (stopped: max_tokens), its reasoning included. Try a lower reasoning effort.";
  return `No answer: the model's last turn stopped on ${stop}.`;
}
/** A finished run whose agent never ran a query: no rows to count groups in. */
export const NO_QUERY = 'No group: the agent ran no query.';
