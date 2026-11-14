// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Starting points for the query console of the explorer tab (written for the brand's style DNA:
 * looks, their garments, occasions and the journal articles linked to them). `cypher` runs as is;
 * `broken` fails on Neptune on purpose (a typo, a Neo4j-only procedure) so the agent has something
 * to fix; `question` is plain words, which Neptune cannot parse, so the agent writes the query;
 * `write` changes the graph (runs only where the deployment allows writes, never through the
 * agent; none are offered by default). `group` is the row the button sits in. Every `cypher`
 * example was run on the deployed graph (proof/try_examples.py).
 */
type QueryKind = 'cypher' | 'broken' | 'question' | 'write';
export type QueryGroup = 'looks' | 'graph' | 'vector' | 'broken' | 'question' | 'write';
export type QueryExample = { title: string; text: string; kind: QueryKind; group: QueryGroup };

export const QUERY_EXAMPLES: QueryExample[] = [
  // ---- the brand's looks
  {
    kind: 'cypher',
    group: 'looks',
    title: 'What is in the graph',
    text: 'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS nodes ORDER BY nodes DESC',
  },
  {
    kind: 'cypher',
    group: 'looks',
    title: 'Looks per occasion',
    text: `MATCH (l:Look)-[:FOR]->(o:Occasion)
RETURN o.name AS occasion, count(l) AS looks ORDER BY looks DESC`,
  },
  {
    kind: 'cypher',
    group: 'looks',
    title: 'What you ingested in tab 2',
    text: `MATCH (l:Look) WHERE l.run IS NOT NULL
OPTIONAL MATCH (l)-[:FOR]->(o:Occasion)
OPTIONAL MATCH (l)-[:CONTAINS]->(i:Item)
RETURN l.name AS look, o.name AS occasion, count(i) AS garments, l.run AS run
ORDER BY run DESC`,
  },
  {
    kind: 'cypher',
    group: 'looks',
    title: 'What is worn with white sneakers',
    // the colour and the kind on the first line, so the participant edits one line (black loafer)
    text: `WITH 'white' AS color, 'sneaker' AS kind
MATCH (l:Look)-[:CONTAINS]->(s:Item)
WHERE toLower(s.name) CONTAINS color AND toLower(s.name) CONTAINS kind
WITH DISTINCT l, kind
MATCH (l)-[:CONTAINS]->(o:Item)-[:IS_CATEGORY]->(c:Category)
WHERE NOT toLower(o.name) CONTAINS kind
RETURN c.name AS worn_with, count(DISTINCT l) AS looks ORDER BY looks DESC LIMIT 10`,
  },
  {
    kind: 'cypher',
    group: 'looks',
    title: 'The details the brand uses most',
    text: `MATCH (i:Item)-[:HAS_ATTRIBUTE]->(a:Attribute)
RETURN a.name AS detail, count(DISTINCT i) AS garments ORDER BY garments DESC LIMIT 15`,
  },
  {
    kind: 'cypher',
    group: 'looks',
    title: 'An article and the look it is about',
    text: `MATCH (a:Article)-[:HAS_STATEMENT]->(s:Statement)-[:ILLUSTRATES]->(l:Look)
RETURN a.title AS article, l.name AS look, left(s.text, 120) AS says`,
  },
  // ---- the graph itself: vector search and the ontology
  {
    kind: 'cypher',
    group: 'graph',
    title: 'The ontology itself is in the graph',
    text: `MATCH (f:AttributeFamily)-[:APPLIES_TO]->(g:Group)
RETURN f.name AS family, collect(g.name) AS applies_to ORDER BY family`,
  },
  // ---- vector search, in the same graph (the colour and the kind on the first line, as above)
  {
    kind: 'cypher',
    group: 'vector',
    title: 'The garments closest to one',
    text: `WITH 'white' AS color, 'sneaker' AS kind
MATCH (seed:Item) WHERE toLower(seed.name) CONTAINS color AND toLower(seed.name) CONTAINS kind
WITH seed LIMIT 1
CALL neptune.algo.vectors.topK.byNode(seed, {topK: 10})
YIELD node, score
WITH seed, node, score WHERE node:Item AND node <> seed
RETURN seed.name AS seed, node.name AS closest_garment, round(score * 1000) / 1000 AS distance
ORDER BY distance`,
  },
  {
    kind: 'cypher',
    group: 'vector',
    title: 'Vector search, then the graph: their looks',
    text: `WITH 'white' AS color, 'sneaker' AS kind
MATCH (seed:Item) WHERE toLower(seed.name) CONTAINS color AND toLower(seed.name) CONTAINS kind
WITH seed LIMIT 1
CALL neptune.algo.vectors.topK.byNode(seed, {topK: 10})
YIELD node, score
WITH node, score WHERE node:Item
MATCH (l:Look)-[:CONTAINS]->(node)
OPTIONAL MATCH (l)-[:FOR]->(o:Occasion)
RETURN node.name AS closest_garment, round(score * 1000) / 1000 AS distance, l.name AS in_look, o.name AS occasion
ORDER BY distance`,
  },
  // ---- for the agent
  {
    kind: 'broken',
    group: 'broken',
    title: 'Missing parenthesis',
    text: `MATCH (l:Look)-[:FOR]->(o:Occasion
RETURN o.name AS occasion, count(l) AS looks ORDER BY looks DESC`,
  },
  {
    kind: 'broken',
    group: 'broken',
    title: 'Neo4j-only procedure',
    text: 'CALL db.labels() YIELD label RETURN label',
  },
  {
    kind: 'question',
    group: 'question',
    title: 'Which bags go with white sneakers?',
    text: 'In the looks with white sneakers, which bags are worn, and in how many looks?',
  },
  {
    kind: 'question',
    group: 'question',
    title: 'What did the new shoot add?',
    text: 'Which looks were ingested in tab 2 (they have a run property), and what garments are in them?',
  },
  {
    kind: 'question',
    group: 'question',
    title: 'What makes a Professional look?',
    text: 'Which kinds of garment appear in the most Professional looks?',
  },
];
/** The label in front of each row of example buttons, in display order. */
export const GROUP_LABEL: Record<QueryGroup, string> = {
  looks: "openCypher · the brand's looks",
  graph: 'openCypher · the ontology, in the same graph',
  vector: 'vector search, in the same graph',
  broken: 'broken on purpose, so the agent fixes it',
  question: 'plain words, so the agent writes the query',
  write: 'writes (only where the deployment allows)',
};
