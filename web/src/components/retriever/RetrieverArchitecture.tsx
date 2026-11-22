// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, type ReactNode } from 'react';
import type { CodeSet } from '../../api';
import { ArchitectureDiagram, Flight, type Def, type DiagramEdge, type ServiceBox } from '../arch/ArchitectureDiagram';
import type { Service } from '../arch/flow';
import type { Step } from '../arch/panelBits';

/**
 * "How it works" for the stages of tab 4 (build the retriever) and tab 5, in the style of
 * the other tabs: a numbered diagram of the services a stage uses, the steps under it, what each
 * step does, and its essential code (the live source, code sets rt_catalog / rt_rag / rt_graph /
 * rt_payoff in code_panel.py). A box lights up while the stage's request is in flight; a context
 * box (no step) stays grey.
 */
export type RetrieverSet = Extract<CodeSet, 'rt_catalog' | 'rt_rag' | 'rt_graph' | 'rt_payoff'>;
type NodeId = 'browser' | 'lambda' | 'products' | 'embed' | 'vectors' | 'planner' | 'neptune' | 'llm';
export type RetrieverCtx = { running: boolean };
type Box = Pick<ServiceBox<NodeId>, 'id' | 'service' | 'x' | 'y' | 'title' | 'sub'> & { live?: boolean };
type Leg = Pick<DiagramEdge<NodeId>, 'id' | 'source' | 'sourceHandle' | 'target' | 'targetHandle' | 'label'> & { muted?: boolean };
type Static = { title: string; summary: string; steps: Step<NodeId>[]; text: Record<number, ReactNode>; nodes: Box[]; edges: Leg[]; height?: number };

/** A stage's panel from its static geometry: live boxes and legs light up while it runs. */
function stageDef({ nodes, edges, ...rest }: Static): Def<NodeId, RetrieverCtx> {
  return {
    ...rest,
    nodes: ({ running, pulse }) => nodes.map(({ live = true, ...n }) => ({ ...n, status: live && running ? 'active' : live && pulse ? 'done' : 'idle' })),
    edges: ({ running, pulse }) => edges.map(({ muted = false, ...e }) => ({ ...e, muted, active: running && !muted, done: pulse && !muted })),
    legend: ({ running }) => (running ? <Flight>request in flight</Flight> : <>Follow the numbers 1–{rest.steps.length}. Greyed boxes are context.</>),
  };
}
const box = (id: NodeId, service: Service, x: number, y: number, title: string, sub: string, live = true): Box => ({ id, service, x, y, title, sub, live });
const leg = (id: string, source: NodeId, sourceHandle: string, target: NodeId, targetHandle: string, label: string, muted = false): Leg => ({ id, source, sourceHandle, target, targetHandle, label, muted });

export const DEFS: Record<RetrieverSet, Def<NodeId, RetrieverCtx>> = {
  rt_catalog: stageDef({
    title: 'How it works: a vector store of products (Amazon S3 Vectors)',
    summary: 'Bedrock · S3 Vectors · Lambda',
    steps: [
      { n: 1, node: 'products', title: 'The products', summary: 'Each product as text: what it is, its kind, fit and description. No styling knowledge, no price.' },
      { n: 2, node: 'embed', title: 'Embed them', summary: 'Amazon Nova Multimodal Embeddings turns each product’s text into 1,024 numbers.' },
      { n: 3, node: 'vectors', title: 'Store them in an index', summary: 'PutVectors writes one vector per product, keyed by its id, with its name, kind and color as metadata.' },
      { n: 4, node: 'lambda', title: 'Embed the search', summary: 'Your search is embedded with the same model, so it lands in the same space as the products.' },
      { n: 5, node: 'vectors', title: 'The nearest products', summary: 'QueryVectors returns the k products closest to the search (cosine distance).' },
    ],
    text: {
      1: (
        <ul>
          <li>
            The catalog is what a retailer already has: one record per product. Only <i>what the product is</i> goes into the text that is embedded (<code>catalog_text</code>): its color, material and
            kind, its fit, its description.
          </li>
          <li>Nothing about what it is worn with. That knowledge lives in the graph, not here, so the two stores never overlap.</li>
        </ul>
      ),
      2: (
        <ul>
          <li>
            Amazon Nova Multimodal Embeddings maps text (and images) to a vector of 1,024 numbers. Texts that mean similar things get vectors that point in similar directions.
          </li>
          <li>The products were embedded once, ahead of time; the search you type is embedded live.</li>
        </ul>
      ),
      3: (
        <ul>
          <li>
            The index is an Amazon S3 Vectors index: float32 vectors, cosine distance. It is created once (<code>create_catalog_index</code>), then <code>PutVectors</code> writes the products 200 at a time.
          </li>
          <li>Category, type and color are filterable metadata; the name and the text come back with each hit. In production this is often OpenSearch: the idea is the same.</li>
        </ul>
      ),
      4: (
        <ul>
          <li>
            The API (AWS Lambda) embeds your search with the <b>same</b> model as the products, so a search and a product can be compared directly.
          </li>
        </ul>
      ),
      5: (
        <ul>
          <li>
            <code>QueryVectors</code> returns the k nearest products and their distance (0 is the same direction, smaller is closer).
          </li>
          <li>
            Ask for white sneakers and you get white sneakers: <b>similar</b>, which is a good start. It does not tell you what <b>goes with</b> them.
          </li>
        </ul>
      ),
    },
    nodes: [
      box('products', 's3', 0, 0, 'Product catalog', 'name, kind, color, description'),
      box('embed', 'bedrock', 400, 0, 'Amazon Bedrock · Nova', 'text → 1,024 numbers'),
      box('vectors', 's3vectors', 800, 0, 'Amazon S3 Vectors', 'index “catalog” · cosine'),
      box('browser', 'browser', 0, 220, 'Browser', 'stage 1 · your search', false),
      box('lambda', 'lambda', 400, 220, 'AWS Lambda · API', 'payoff.catalog_query'),
    ],
    edges: [
      leg('e-text', 'products', 's-r', 'embed', 't-l', 'each product’s text (once)', true),
      leg('e-put', 'embed', 's-r', 'vectors', 't-l', 'PutVectors (once)', true),
      leg('e-q', 'browser', 's-r', 'lambda', 't-l', 'your search'),
      leg('e-qe', 'lambda', 's-t', 'embed', 't-b', 'embed the search'),
      leg('e-qv', 'lambda', 's-r', 'vectors', 't-b', 'QueryVectors · k nearest'),
    ],
  }),

  rt_rag: stageDef({
    title: 'How it works: RAG on the catalog',
    summary: 'Bedrock · S3 Vectors · Lambda',
    steps: [
      { n: 1, node: 'planner', title: 'Plan the searches', summary: 'One Converse call: the model turns the question into catalog searches, from its own fashion knowledge.' },
      { n: 2, node: 'embed', title: 'Embed each search', summary: 'The same model as stage 1 embeds every search.' },
      { n: 3, node: 'vectors', title: 'Search the catalog', summary: 'The nearest products of the kind each search names (a search for rings returns rings or nothing).' },
      { n: 4, node: 'llm', title: 'The answer', summary: 'The products go to the model as numbered evidence, with the question. It answers with three ways to wear it, citing them.' },
    ],
    text: {
      1: (
        <ul>
          <li>
            This is plain RAG with a smart planner: the model decides <i>what to look for</i> (<code>PLANNER_SYSTEM</code>). Its taste is the internet&apos;s: jeans, tees, sweaters.
          </li>
          <li>You can edit its searches in step 2a; the rest of the pipeline is the same either way.</li>
        </ul>
      ),
      2: <ul><li>Each search is embedded exactly as in stage 1, so it lands among the products.</li></ul>,
      3: (
        <ul>
          <li>
            <code>catalog_search</code> keeps the nearest products <b>of the kind the search names</b> (its head noun: &ldquo;silver rings on hand&rdquo; → ring). If the catalog sells none, it returns
            nothing rather than the nearest necklace.
          </li>
          <li>GraphRAG uses this exact function in stage 5: the same catalog and the same rule, one product per piece of a look.</li>
        </ul>
      ),
      4: (
        <ul>
          <li>
            The answer prompt (<code>ANSWER_SYSTEM</code>) is the one GraphRAG gets too: three ways to wear it, built only from the numbered evidence, every claim cited, never a source that is not in the
            evidence.
          </li>
          <li>RAG&apos;s evidence is products only, so its citations prove an item exists, not that it goes with anything.</li>
        </ul>
      ),
    },
    nodes: [
      box('planner', 'bedrock', 400, 0, 'Amazon Bedrock · planner', 'question → searches'),
      box('embed', 'bedrock', 800, 0, 'Amazon Bedrock · Nova', 'each search → 1,024 numbers'),
      box('browser', 'browser', 0, 220, 'Browser', 'stage 2', false),
      box('lambda', 'lambda', 400, 220, 'AWS Lambda · API', 'payoff.rag'),
      box('vectors', 's3vectors', 800, 220, 'Amazon S3 Vectors', 'the catalog index'),
      box('llm', 'bedrock', 400, 440, 'Amazon Bedrock · answer', 'products + question → Converse'),
    ],
    edges: [
      leg('e-q', 'browser', 's-r', 'lambda', 't-l', 'the question (and your searches)'),
      leg('e-plan', 'lambda', 's-t', 'planner', 't-b', 'plan the searches'),
      leg('e-emb', 'lambda', 's-r', 'embed', 't-l', 'embed each search'),
      leg('e-qv', 'lambda', 's-r', 'vectors', 't-l', 'QueryVectors per search'),
      leg('e-ans', 'lambda', 's-b', 'llm', 't-t', 'evidence + question'),
    ],
  }),

  rt_graph: stageDef({
    title: 'How it works: GraphRAG on the brand’s looks',
    summary: 'Bedrock · Neptune Analytics · S3 Vectors · Lambda',
    height: 520,
    steps: [
      { n: 1, node: 'embed', title: 'Embed the question', summary: 'Nova embeds the question, the same model as the catalog and the graph’s garments.' },
      { n: 2, node: 'neptune', title: 'The starting garments', summary: 'Vector search on the graph’s garments (Neptune’s own index): the closest by meaning.' },
      { n: 3, node: 'neptune', title: 'The traversal', summary: 'The openCypher walks from the starting garments to every look and what is worn with them. Read-only.' },
      { n: 4, node: 'lambda', title: 'Count, pick three looks', summary: 'Rows counted per look: occasions, kinds worn with them; three typical looks, one per occasion first.' },
      { n: 5, node: 'vectors', title: 'The same catalog search', summary: 'Each piece of those looks goes through stage 2’s catalog search: one real product per piece.' },
      { n: 6, node: 'llm', title: 'The answer', summary: 'The patterns, the looks and their products go to the model with RAG’s prompt.' },
    ],
    text: {
      1: <ul><li>The question is embedded once. The graph&apos;s garments were embedded by the ingest pipeline (tab 2) with the same model, so the question and the garments are comparable.</li></ul>,
      2: (
        <ul>
          <li>
            Neptune Analytics keeps its own vector index on the graph&apos;s nodes. <code>find_anchors</code> asks it for the garments nearest to the question. Two vector stores, one job each: S3 Vectors
            holds the products, Neptune&apos;s index finds where to start in the graph.
          </li>
          <li>Every garment almost as close as the best match is kept, whatever its type: those are the starting garments the traversal begins at.</li>
        </ul>
      ),
      3: (
        <ul>
          <li>
            The traversal starts at <code>$anchors</code>, finds every look they are in (<code>CONTAINS</code>), then the other garments in those looks with their kind (<code>IS_CATEGORY</code>), details (
            <code>HAS_ATTRIBUTE</code>) and each look&apos;s occasion (<code>FOR</code>).
          </li>
          <li>The guard refuses a write before it reaches the graph, and a traversal that does not start from the starting garments.</li>
        </ul>
      ),
      4: (
        <ul>
          <li>
            <code>aggregate</code> counts distinct looks, not rows or garments: &ldquo;bag in 12 of 13 looks&rdquo; means 12 looks have at least one bag worn with the starting garments. The other shoe of a starting garment&apos;s pair is left out. Those counts are the pattern, and the source behind every claim.
          </li>
          <li><code>featured_looks</code> picks the three most typical looks, the best of each occasion first, so the three ways to wear it differ.</li>
        </ul>
      ),
      5: (
        <ul>
          <li>
            The brand&apos;s taste decides what to search for; the catalog search is <b>exactly</b> RAG&apos;s (stage 2). That is the whole comparison: same catalog, same search, different taste.
          </li>
        </ul>
      ),
      6: <ul><li>The same answer prompt as RAG. GraphRAG&apos;s evidence carries the brand&apos;s own looks and counts, so its citations lead back to the looks: the sources tree below the answer.</li></ul>,
    },
    nodes: [
      box('embed', 'bedrock', 400, 0, 'Amazon Bedrock · Nova', 'question → 1,024 numbers'),
      box('browser', 'browser', 0, 220, 'Browser', 'stage 3 · the traversal', false),
      box('lambda', 'lambda', 400, 220, 'AWS Lambda · API', 'payoff.graphrag'),
      box('neptune', 'neptune', 800, 220, 'Neptune Analytics', 'vector index + openCypher'),
      box('llm', 'bedrock', 400, 440, 'Amazon Bedrock · answer', 'looks + products → Converse'),
      box('vectors', 's3vectors', 800, 440, 'Amazon S3 Vectors', 'the catalog index (stage 1)'),
    ],
    edges: [
      leg('e-q', 'browser', 's-r', 'lambda', 't-l', 'question + traversal'),
      leg('e-emb', 'lambda', 's-t', 'embed', 't-b', 'embed the question'),
      leg('e-nep', 'lambda', 's-r', 'neptune', 't-l', 'starting garments · the traversal'),
      leg('e-cat', 'lambda', 's-b2', 'vectors', 't-l', 'each piece → the same search'),
      leg('e-ans', 'lambda', 's-b1', 'llm', 't-t', 'looks + products + question'),
    ],
  }),

  rt_payoff: stageDef({
    title: 'How it works: three answers side by side',
    summary: 'Lambda · Bedrock · S3 Vectors · Neptune Analytics',
    height: 520,
    steps: [
      { n: 1, node: 'lambda', title: 'Three in parallel', summary: 'One request runs the three columns at once: the same question and the same model.' },
      { n: 2, node: 'llm', title: 'LLM only', summary: 'The question alone. No retrieval, no evidence, no sources.' },
      { n: 3, node: 'vectors', title: 'RAG', summary: 'Your searches from stage 2 through the catalog, then the shared answer prompt.' },
      { n: 4, node: 'neptune', title: 'GraphRAG', summary: 'The traversal from stage 3, the looks, the same catalog search, the shared answer prompt.' },
      { n: 5, node: 'browser', title: 'The sources', summary: 'GraphRAG’s path, drawn: starting garments → looks → what is worn with them → catalog products.' },
    ],
    text: {
      1: <ul><li><code>run</code> starts the three columns in a thread pool. Each column is the function you ran in its stage; nothing new happens here.</li></ul>,
      2: <ul><li>A plain prompt and the question: the model&apos;s own taste, stated with confidence and no source. This is the answer you got in tab 0.</li></ul>,
      3: <ul><li>RAG with the searches you kept in stage 2. Its sources are catalog products: they exist, but nothing says they go together.</li></ul>,
      4: <ul><li>GraphRAG with the traversal you wrote in stage 3. Its sources are the brand&apos;s own looks, with counts.</li></ul>,
      5: <ul><li><code>tree</code> turns GraphRAG&apos;s retrieval into the drawing under the answers. Click a citation to light its path; click a box for the look&apos;s photo and garments.</li></ul>,
    },
    nodes: [
      box('browser', 'browser', 0, 220, 'Browser', 'stage 4 · the sources tree'),
      box('lambda', 'lambda', 400, 220, 'AWS Lambda · API', 'payoff.run'),
      box('llm', 'bedrock', 800, 0, 'LLM only · Amazon Bedrock', 'question → answer'),
      box('vectors', 's3vectors', 800, 220, 'RAG · S3 Vectors + Bedrock', 'your searches → catalog'),
      box('neptune', 'neptune', 800, 440, 'GraphRAG · Neptune + S3 Vectors', 'the traversal → looks → catalog'),
    ],
    edges: [
      leg('e-q', 'browser', 's-r', 'lambda', 't-l', 'question + your searches + traversal'),
      leg('e-llm', 'lambda', 's-t', 'llm', 't-l', 'LLM only'),
      leg('e-rag', 'lambda', 's-r', 'vectors', 't-l', 'RAG'),
      leg('e-graph', 'lambda', 's-b', 'neptune', 't-l', 'GraphRAG'),
    ],
  }),
};

/** One stage's "How it works": collapsed until opened; lights up while `running`, pulses on `finishedAt`. */
export function RetrieverHowItWorks({ set, running, finishedAt }: { set: RetrieverSet; running: boolean; finishedAt?: number }) {
  const [open, setOpen] = useState(false);
  return <ArchitectureDiagram def={DEFS[set]} ctx={{ running }} codeSet={set} finishedAt={finishedAt} open={open} onToggle={setOpen} />;
}
