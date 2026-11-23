// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Thin API client: every request goes to the API's Lambda function URL, signed with the signed-in
 * user's AWS credentials (signing.ts). IAM decides at the URL whether the request runs.
 */
import { signIn } from './auth';
import { forgetCredentials, signedRequest } from './signing';
import type { Web } from './components/graph/webView';

export type Node = { id: string; labels: string[]; props: Record<string, any> };
export type Edge = { source: string; target: string; type: string; props: Record<string, any> };
export type Evidence = {
  id: string;
  label: string;
  name: string;
  kind: string;
  via: string[];
  score: number | null;
  rationale: string;
  seed_id: string;
  props: Record<string, any>;
};
/**
 * What a node of tab 3's evidence tree came from (`GET /api/graph/source`, previews.py): the photo
 * (a data URL) and the text of its page, with where they were found. `source.kind`: product page,
 * look, editorial, tab 2 photo, tab 2 text, example photo, or graph (only what the graph holds).
 * `description` is the node's own text in the graph, `quote` a statement to find in `text`.
 * A category, attribute value or line has no source of its own: `origins` are the photos and
 * pages it was seen in (at most three, the tree's nodes first), `origins_total` how many items,
 * looks and articles link to it.
 */
export type NodeSource = SourcePreview & { origins?: NodeOrigin[]; origins_total?: number };
export type SourcePreview = {
  id: string;
  label: string;
  name: string;
  source: { kind: string; title: string; doc_id: string | null };
  photo: { data_url: string; content_type: string; bytes: number } | null;
  photo_note: string;
  text: string;
  description: string;
  quote: string;
};
/** A photo or page a vocabulary node was seen in; `via`: the nodes seen there and how they link to it (IS_CATEGORY, HAS_PART, HAS_ATTRIBUTE, FROM_LINE, or ILLUSTRATES for an article about one). */
export type NodeOrigin = SourcePreview & { via: { id: string; label: string; name: string; edge: string }[] };
/** The code sets of the "How this works" panels: tab 1, tab 2 (pipeline and query), tabs 4 and 5 (the retriever), tab 6 (the trends question: the two agents and the clouds). */
export type CodeSet = 'explorer' | 'pipeline' | 'query' | 'rt_catalog' | 'rt_rag' | 'rt_graph' | 'rt_payoff' | 'trends_graph' | 'trends_lake' | 'lens_trends';
/**
 * One step of an agent run (a call to the MCP server, a guard decision or a model turn), as tab 3's
 * query agent and tab 6's two trends agents report it (mcp_agent.agent_result). `at_ms`: when the
 * step started, in ms from the run's start. A model turn has its text, stop reason and tokens, and
 * `reasoning` (the model's reasoning summary, when it returns one as text) or `redacted` (it
 * reasoned, but not as readable text).
 */
export type AgentStep = { n: number; kind: 'model' | 'mcp' | 'guard'; name: string; input: Record<string, unknown>; ok: boolean; ms: number; at_ms?: number; summary: string; error: string | null; to_model: string; text?: string; stop_reason?: string; tokens?: { input: number; output: number; cache_read: number; cache_write: number }; reasoning?: string; redacted?: boolean; count?: number };
export type AgentResult = {
  text: string;
  error_in: string | null;
  model: { id: string; name: string };
  answer: string;
  query: string | null;
  rows: Record<string, unknown>[];
  count: number;
  stopped: null | 'tools' | 'time';
  /** The reasoning effort the request was built with (`default`, `low`...), null when none was set. */
  effort: string | null;
  steps: AgentStep[];
  metrics: { total_ms: number; model_ms: number; tool_ms: number; turns: number; tool_calls: number; tokens: { input: number; output: number; cache_read: number; cache_write: number } };
  mcp: { server: string; version: string; transport: string; endpoint: string; tools: string[]; offered_to_model: string[] };
  /** Where the agent ran: on Amazon Bedrock AgentCore Runtime, which the stack sets up (`in-process` only for an API without a runtime, as in the backend's tests). */
  runtime?: AgentRuntimeInfo;
};
type AgentRuntimeInfo = {
  host: 'agentcore' | 'in-process';
  /** The API's wait for InvokeAgentRuntime (or for the in-process loop), cold start included. */
  invoke_ms?: number;
  arn?: string;
  qualifier?: string;
  session_id?: string | null;
  trace_id?: string | null;
  /** Requests this session's microVM has served, this one included (1 = a new session). */
  invocations_in_session?: number;
  session_age_s?: number;
};
export type QueryResult = { rows: Record<string, unknown>[]; count: number; ms: number };
/** One numbered line of a payoff column's evidence; `tree_ids`: the traversal-tree nodes it lights up. */
export type PayoffEvidence = {
  n: number;
  /** `note`: what the smart retriever found no exact match for (payoff.smart_guidance). */
  kind: 'pattern' | 'look' | 'item' | 'note';
  look_id?: string;
  look?: string;
  label: string;
  text: string;
  tree_ids: string[];
  search?: string;
  distance?: number;
  image_key?: string;
  category?: string;
};
export type PayoffTreeNode = { id: string; kind: 'anchor' | 'look' | 'category' | 'item'; label: string; sub?: string; count?: number; node_id?: string; image_key?: string };
export type PayoffTree = { nodes: PayoffTreeNode[]; edges: { source: string; target: string }[] };
export type PayoffReceipts = { kind: 'none' | 'catalog' | 'looks'; count: number; label: string };
type PayoffBase = { answer: string; cited?: number[]; evidence: PayoffEvidence[]; receipts: PayoffReceipts; metrics: Record<string, number> };
export type PayoffGuidance = {
  /** The starting garments: every garment within `band` of the closest one; `types` counts them, `category` is the most common. */
  anchor: { category: string; label: string; nearest: string; types?: Record<string, number>; band?: number; garments: { id: string; name: string; distance: number }[] };
  looks: { id: string; name: string; occasion: string }[];
  occasion: { name: string; count: number }[];
  categories: { id: string; name: string; looks: string[]; count: number; colors: string[]; details: string[]; examples: string[]; search: string }[];
  traversal: string;
};
/** The model on its own (payoff.llm_only): tab 0's cold open and tab 5's first column. */
export type LlmColumn = PayoffBase & { mode: 'llm'; inspect: { system: string; user: string } };
export type RagColumn = PayoffBase & { mode: 'rag'; plan: { searches: string[]; why: string }; inspect: { planner_system: string; system: string; user: string } };
/** One of the brand's looks GraphRAG built a "way to wear it" on, each piece matched to one catalog item. */
export type FeaturedLook = {
  letter: string;
  id: string;
  name: string;
  occasion: string;
  garments: { name: string; category: string }[];
  /** `item` null: the catalog sells nothing of that kind (no substitute is offered). */
  pieces: { piece: string; category: string; item: string | null; key: string; distance: number | null }[];
};
export type GraphColumn = PayoffBase & {
  mode: 'graph';
  guidance: PayoffGuidance;
  featured: FeaturedLook[];
  searches: string[];
  tree: PayoffTree;
  inspect: { system: string; user: string };
  /** The smart retriever (payoff.smart_graphrag): how the model read the question, what it kept, what did not match. */
  smart?: boolean;
  plan?: SmartPlan;
  /** The "read the question" call as sent and answered. */
  plan_inspect?: ModelCall;
  starts?: SmartStart[];
  /** The filter on what the shopper is looking for: looks before and after, and the ones it dropped. */
  target?: { find: string; looks_before: number; looks_after: number; dropped: { id: string; name: string; occasion: string }[] } | null;
  notes?: string[];
  /** The filter after the traversal, in words ("" when the question looks for nothing in particular). */
  target_rule?: string;
  /** Style recommendation (payoff.photo_graphrag): the photo's embedding found the starting garments. */
  photo_way_in?: PhotoWayIn;
};
/** How a photo found the starting garments: its embedding, the same vector search and band, the same traversal. */
export type PhotoWayIn = {
  garments: number;
  label: string;
  nearest: string;
  looks: number;
  band: number;
  query: string;
  vector: { dimension: number; first: number[]; norm: number };
  /** What the question asks for ("shoes"), "" for a whole outfit. */
  find: string;
  find_inspect: ModelCall;
};
/** One model call as it ran: the system prompt, the user message, the reply. */
export type ModelCall = { system: string; user: string; reply: string };
/** How the model read the question: the pieces to start from, what the shopper wants, the must-haves. */
export type SmartPlan = { start: string[]; find: string; must: string[] };
/** One start piece: the closest garments by vector search (and its query), the ones the model kept (and the call), whether one matched exactly. */
export type SmartGrade = 'exact' | 'similar' | 'no';
export type SmartStart = {
  text: string;
  candidates: { id: string; name: string; category: string; distance: number }[];
  kept: string[];
  exact: boolean;
  /** The model's grade per garment id. */
  grades?: Record<string, SmartGrade>;
  query?: string;
  inspect?: ModelCall;
};
/** `POST /api/payoff`: one question, three answers, each with its sources (`receipts`; payoff.py). */
export type PayoffResult = {
  question: string;
  /** What the shopper gave: a question alone, or a photo of one piece with it (Style recommendation). */
  input?: 'question' | 'photo';
  model: VisionModel;
  ms: number;
  columns: {
    llm: LlmColumn;
    rag: RagColumn;
    graph: GraphColumn;
  };
};
// ---- tab 3 · Build the retriever, stage by stage
export type VectorPreview = { dimension: number; first: number[]; norm: number };
export type CatalogInfo = { bucket: string; index: string; dimension: number; distance_metric: string; data_type: string; non_filterable: string[]; count: number; embedding_model: string };
/** `GET /api/photo`: a stored photo as a data URL. */
export type StoredPhoto = { key: string; data_url: string; content_type: string; bytes: number };
/**
 * Whether a key names one of the data sets' stored photos (the same rule as previews.STORED_PHOTO):
 * `<set>/<sub>/<file>`, a look photo or product shot under `media/<sub>/` of the set's folder.
 */
export const isStoredPhotoKey = (key: string | undefined): key is string =>
  !!key && /^[a-z0-9][a-z0-9_-]{0,63}\/[a-z0-9][a-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(?:jpe?g|png|webp)$/.test(key) && !key.includes('..');
export type CatalogHit = { key: string; search: string; distance: number; name: string; category: string; type: string; color: string; image_key: string; text: string };
export type CatalogItem = CatalogHit & { metadata: Record<string, string>; vector: VectorPreview };
export type CatalogQuery = { query: string; k: number; vector: VectorPreview; hits: CatalogHit[]; metrics: { embed_ms: number; search_ms: number } };
export type RetrieverTemplates = {
  /** Stage 3a's statement before it runs (a placeholder where the question's vector goes). */
  anchor_query: string;
  /** How 3a picks the starting garments (`anchors`): the hits it asks for, how many it lists, the distance band it keeps. */
  anchor: { candidates: number; shown: number; band: number };
  /** Stage 3b's traversal, shown read-only: from the starting garments to every look and what is worn with them. */
  traversal: string;
};
export type RetrieverPlan = { searches: string[]; why: string; inspect: { system: string; user: string; reply: string }; metrics: Record<string, number> };
export type RetrieverAnchors = PayoffGuidance['anchor'] & {
  /** The closest garments as the search returned them; `in_look` false: in no look (an article's garment), never a starting garment. */
  candidates: { id: string; name: string; category: string; distance: number; in_look: boolean }[];
  /** How many of the closest garments were skipped because no look wears them. */
  unworn: number;
  /** The openCypher statement that ran on Neptune Analytics, the question's vector shortened. */
  query: string;
  /** The question's embedding: its size, first numbers and norm. */
  vector: VectorPreview;
  metrics: { anchor_ms: number };
};
export type RetrieverTraversal = {
  cypher: string;
  rows: number;
  columns: string[];
  preview: Record<string, unknown>[];
  looks: PayoffGuidance['looks'];
  occasion: PayoffGuidance['occasion'];
  categories: PayoffGuidance['categories'];
  metrics: { traverse_ms: number; rows: number };
};
export type Summary = {
  backend: string;
  graph_id?: string;
  nodes: Record<string, number>;
  edges: Record<string, number>;
  embeddings?: number;
  /** The graph's Brand nodes, sorted by name: tab 0's "What you'll build" names them (description "" when the data set gives none). */
  brands?: { name: string; description: string }[];
};
export type Health = {
  ok: boolean;
  graph_backend: string;
  graph_id?: string | null;
  deployed?: boolean;
  embedder: string;
  embedding_dimension: number;
  ontology: { name: string; version: string };
  write_queries: boolean;
  query_agent?: { available: boolean; reason: string; host?: 'agentcore' | 'in-process' | null; runtime_arn?: string; server?: string };
  catalog?: { configured: boolean; vector_bucket: string; catalog_index: string };
};
// ---------------------------------------------------------------- ontology explorer types
export type OntoNode = {
  id: string;
  key: string;
  label: string;
  pref_label?: string;
  kind: 'class' | 'individual' | 'objectProperty' | 'dataProperty';
  comment?: string;
  concept_id?: string;
  alt_labels?: string[];
  root?: string;
  depth?: number;
  visual?: boolean;
  individuals?: number;
  types?: string[];
  domain?: string[];
  range?: string[];
  super?: string[];
  symmetric?: boolean;
};
export type OntoEdge = { source: string; target: string; type: 'subClassOf' | 'type' | 'property' | 'subPropertyOf'; label: string; property?: string };
export type OntologyView = {
  id: string;
  name: string;
  iri: string;
  version: string;
  license: string;
  source: string;
  comment: string;
  prefixes: Record<string, string>;
  nodes: OntoNode[];
  edges: OntoEdge[];
  stats: Record<string, any>;
};
/**
 * `domain.json` next to an ontology (ontologies/README.md): how the domain is named, the words of
 * the classification instruction, the examples tab 3 offers, and the wording the prompts
 * and the UI use for its things. Every field has a neutral value when the folder omits it.
 */
export type DomainInfo = {
  name: string;
  description: string;
  /** An ontology to read, not to work with (no data): tab 0 does not offer it, tab 2 cannot ingest against it, tab 1 step 4 lists it. */
  browse_only: boolean;
  /** The class and property names tab 1 step 4 starts with (`Serum`, `hasKeyIngredient`, `Dropper`). */
  start_with: string[];
  subject: string;
  scene: string;
  example_questions: string[];
  photo_questions: string[];
  /** The first sentence of the answer's system prompt, and who writes the answer (fashion: stylist). */
  persona: { answer: string; role: string };
  /** The domain's word for one thing a photo shows (fashion: garment). */
  noun: Noun;
  /** User-facing labels: the name of tab 3, and what a curated edge is called (fashion: brand rule). */
  labels: { qa_tab: string; rule: string; rules: string };
};
export type Noun = { singular: string; plural: string };
export type OntologySummary = {
  id: string;
  name: string;
  file: string;
  format: string;
  iri: string;
  version: string;
  license: string;
  source: string;
  stats: Record<string, any>;
  entity_classes: number;
  value_classes: number;
  attribute_properties: number;
  relation_properties: number;
  examples: number;
  articles: number;
  prompt_tokens_estimate: number;
  domain: DomainInfo;
  /** The domain's data sets (brands): the folders `ontologies/<domain>/datasets/<set>/`, sorted. The graph's domain has them all loaded at deploy. */
  data_sets: string[];
};
export type ExampleInfo = {
  file: string;
  title: string;
  bytes: number;
  content_type: string;
  prompt: string;
  model_id: string;
  category?: string;
  source?: string;
  /** Tab 2's batch this photo belongs to (`new-shoot`: the brand's new looks, not in the graph yet; `first`: what tab 2 starts with when there is no new shoot; `new-work`: tab 6 only). */
  batch?: string;
  /** The occasion its look is for (`business_casual`): the pipeline writes Look -FOR-> Occasion. */
  occasion?: string;
  /** Where the photo comes from (a new shoot, a supplier sample, street style): the source line of tab 6's new work. */
  origin?: string;
  /** The data set whose `examples/images/` holds it; absent for the domain's own `examples/images/`. */
  data_set?: string;
};
/**
 * `GET /api/graph/counts`: tab 2's before and after. `watch`: the looks the graph walk of tab 4
 * finds for a garment (white sneakers); null while the graph holds no look with such a garment.
 */
export type GraphCounts = {
  looks: number;
  garments: number;
  occasions: { name: string; looks: number }[];
  watch: { text: string; label: string; looks: number } | null;
};
/** `images`: the domain's whole example photos (tabs 1 and 2); `items`: single pieces like those in them (tab 3). */
export type ExampleSet = 'images' | 'items';
/** The `set` query parameter of the examples routes; the whole photos are the default and need none. */
const setParam = (set: ExampleSet) => (set === 'images' ? '' : `&set=${set}`);
/** An example text (editorial piece, social post, product notes) next to the example images. */
export type ArticleInfo = {
  file: string;
  title: string;
  kind: string;
  source: string;
  published: string;
  chars: number;
  pairs_with_image: string;
  /** Tab 2: a text about a look of the new shoot (`new-shoot`), or part of the first batch (`first`). */
  batch?: string;
  /** The data set whose `examples/articles/` holds it; absent for the domain's own `examples/articles/`. */
  data_set?: string;
};
export type OntologyDetail = OntologySummary & { view: OntologyView; prompt: string; examples_list: ExampleInfo[]; articles_list: ArticleInfo[]; readme: string };
/**
 * The reasoning efforts an agent may ask a model for (vision.py): `levels` are the wire ids in the
 * order the UI lists them, always `default` first; `default_means` is the level `default` stands
 * for; `readable` is whether the model returns its reasoning as text.
 */
export type Reasoning = { levels: string[]; default_means: string; readable: boolean; family: 'anthropic' | 'openai' | 'nova' | 'grok' };
export type VisionModel = {
  id: string;
  name: string;
  provider: string;
  third_party: boolean;
  explicit_cache: boolean;
  cache_min_tokens: number | null;
  supports_temperature: boolean;
  notes: string;
  /** null: no effort setting; `reasoning_note` then says why, in the sentence the UI shows instead of the control. */
  reasoning: Reasoning | null;
  reasoning_note: string | null;
};
type BBox = [number, number, number, number] | null;
type Part = { id: string; class: string; class_iri: string; label: string; bbox: BBox; relation: string; relation_iri: string | null };
export type Entity = {
  id: string;
  class: string;
  class_iri: string | null;
  label: string;
  confidence: number | null;
  bbox: BBox;
  attributes: Record<string, string>;
  attribute_iris: Record<string, string>;
  parts: Part[];
};
type ClassifyMetrics = {
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_input_tokens: number;
  cache_hit_ratio: number;
  prompt_tokens_estimate: number;
  cache_min_tokens: number | null;
  cache_eligible: boolean;
};
/** Who served the request: the Lambda handler attaches it to classify responses. */
type Invocation = {
  request_id: string;
  runtime: 'lambda' | 'local';
  function_name: string | null;
  memory_mb: number | null;
  log_group: string | null;
  log_stream: string | null;
  cold_start: boolean;
  region: string | null;
  started_at: string;
  handler_ms: number;
  /** The signed-in user's `sub` (null when sign-in is off). */
  user?: string | null;
};
/** The model's advice on extending the ontology: what it saw but could not express, and how it would add it. */
export type OntologyFeedback = {
  observed: string;
  entity: string | null;
  kind: 'class' | 'value' | 'property' | 'relation' | 'other';
  suggestion: string;
  /** Names the suggestion proposes to add that the ontology already has (the model missed them). */
  already_known: string[];
};
export type ClassifyResult = {
  model: VisionModel;
  ontology_id: string;
  prompt_caching: boolean;
  entities: Entity[];
  /** The values of the photo as a whole, by property (`{for: 'Professional'}`: the look's occasion), and the same as IRIs; empty for an ontology without such a property. */
  photo_properties?: Record<string, string>;
  photo_property_iris?: Record<string, string>;
  feedback: OntologyFeedback[];
  notes: string;
  issues: string[];
  raw_text: string;
  stop_reason: string;
  prompt: { system: string; user: string; request: any };
  usage: Record<string, number>;
  metrics: ClassifyMetrics;
  invocation?: Invocation;
};
/** A range of lines in a code snippet worth looking at, with the teaching point it makes. */
export type CodeHighlight = { kind: 'bedrock' | 'cache' | 'model' | 'ontology' | 'image' | 'prompt' | 'feedback' | 'output'; start: number; end: number; note: string };
/** One entry of the code panel: `steps` are the numbered steps of the diagram it explains, `nodes` the diagram nodes it belongs to. */
export type CodeSnippet = { id: string; title: string; language: string; file: string; code: string; steps: number[]; nodes: string[]; highlights: CodeHighlight[] };

// ---------------------------------------------------------------------- tab 6 · the trends question, methods 1 and 2 (trends.py, lakehouse.py)
/** Token usage, the same four counters for every method of the trends question. */
export type TrendTokens = { input: number; output: number; cache_read: number; cache_write: number };
export type TrendMetrics = {
  total_ms: number;
  load_ms?: number;
  group_ms?: number;
  llm_calls: number;
  tool_calls?: number;
  images: number;
  tokens: TrendTokens;
};
type GroupFeature = { id: string; name: string; kind: 'attribute' | 'category'; family: string };
export type GraphGroup = {
  id: string;
  features: GroupFeature[];
  support_new: number;
  support_base: number;
  lift: number;
  items_new: { id: string; name: string; source: string }[];
  items_base: { id: string; name: string; line: string }[];
  also: (GroupFeature & { count: number })[];
};
/** Method 1's result: the groups read from the graph agent's rows, counted again in code, and the agent's own run. */
export type GraphGroups = {
  mode: 'agent';
  groups: GraphGroup[];
  totals: { new: number; new_items: number; base: number; left_out: string[] };
  agent: AgentResult | null;
  metrics: TrendMetrics;
};
/**
 * Method 1, the graph agent, is a background job of up to 5 minutes (`POST /api/trends/graph`, then
 * `GET ?id=` until it is not running): `step` says what the agent is doing, `result` is the groups
 * with the agent's own run once done.
 */
export type GraphJob = { job_id: string; status: 'running' | 'done' | 'failed'; step?: string; elapsed_s: number; error?: string; result?: GraphGroups };
/** Method 2: the sample's S3 table bucket, its two Iceberg tables and where the data agent runs. */
export type LakeStatus = {
  configured: boolean;
  available: boolean;
  reason: string;
  host?: 'agentcore' | 'in-process';
  runtime_arn?: string | null;
  server: string;
  server_version?: string;
  table_bucket_arn?: string;
  namespace?: string;
  tables?: Record<string, { exists: boolean; modified_at?: string; created_at?: string }>;
  error?: string;
};
export type LakeExport = {
  tables: Record<string, { rows: number; ms: number; snapshot_id: number | null }>;
  table_bucket_arn: string;
  namespace: string;
  runtime: AgentRuntimeInfo | null;
  metrics: { total_ms: number; read_ms: number; write_ms: number };
};
export type LakeJob = {
  job_id: string;
  status: 'running' | 'done' | 'failed';
  elapsed_s: number;
  error?: string;
  host?: 'agentcore' | 'in-process';
  question?: string;
  result?: { agent: AgentResult; groups: GraphGroup[]; totals: GraphGroups['totals']; metrics: TrendMetrics & { recount_ms: number } };
};
type OntologyLocation = {
  kind: 'local' | 's3';
  serving: string;
  dir?: string;
  bucket?: string;
  prefix?: string;
  uri?: string;
  region?: string | null;
  cache_dir?: string;
  objects?: number;
  synced_at?: string | null;
  error?: string | null;
};
export type Architecture = {
  deployed: boolean;
  runtime: 'lambda' | 'local';
  region: string;
  function: { name: string | null; memory_mb: number | null; runtime: string | null; log_group: string | null; handler: string };
  ontologies: OntologyLocation;
  models: { llm: string; vision_model_ids: string[]; llm_model_id: string };
  graph: { backend: string; graph_id: string | null };
  pipeline: {
    runner: 'step-functions' | 'local';
    state_machine_arn: string | null;
    state_machine_name: string | null;
    function_name: string | null;
    max_concurrency: number | null;
    uploads: string;
    records: string;
    embedding_model_id: string;
  };
  logs: { enabled: boolean; source: 'cloudwatch' | 'memory' };
  console: Record<string, string>;
};

// ---- ingest pipeline
/** A source as the browser sends it: an example by name, or an upload. */
export type SourceRequest =
  | { kind: 'image' | 'text'; example: string }
  | { kind: 'image'; image_base64: string; name: string }
  | { kind: 'text'; title: string; text: string; source?: string; published?: string };
/** A source as the run input carries it: names and keys only, never bytes. */
export type SourceSpec = {
  index: number;
  kind: 'image' | 'text';
  example?: string;
  key?: string;
  format?: string;
  label?: string;
  title?: string;
  source?: string;
  published?: string;
};
export type RunInput = {
  run_id: string;
  ontology_id: string;
  model_id: string;
  prompt_caching: boolean;
  line_id: string;
  sources: SourceSpec[];
  started_at: string;
  /** The graph the run writes into (older runs have none). */
  graph?: { backend: 'memory' | 'neptune'; graph_id: string | null };
  graph_before: Record<string, number>;
};
/** Tab 0 · Start here, its What's deployed expander: the AWS resources the stack created for this sample (`GET /api/setup`, setup.py). */
type NeptuneGraphStatus = {
  graph_id: string;
  name?: string;
  status: string;
  memory?: number;
  public?: boolean;
  dimension?: number;
  endpoint?: string;
  console_url?: string;
  nodes?: number;
  edges?: number;
  error?: string;
};
/** The same keys on every call; the account id of every ARN in it is withheld (`…`). */
export type SetupStatus = {
  region: string;
  /** No STS call: the API runs as the stack's execution role, and its account and ARN stay out of the browser. */
  identity: { account: null; arn: null; source: string };
  graph: {
    active: 'neptune' | 'memory';
    graph_id: string | null;
    neptune: NeptuneGraphStatus | null;
    /** The stack's VPC and the graph's private endpoint in it; null on a stack without a VPC. */
    network: { vpc_id: string; endpoint_id: string } | null;
  };
  /** The product catalog: one index of an Amazon S3 Vectors bucket, what RAG and GraphRAG search. */
  catalog: { configured: boolean; vector_bucket: string | null; catalog_index: string | null; dimension: number };
  agent: AgentSetup;
  models: { embedding: string; vision: string[]; answer: string[] };
  /** The Amazon Bedrock guardrail on what a participant types (backend guardrail.py). */
  guardrail: { configured: boolean; guardrail_id: string | null; version: string | null };
};
/** Tab 0: where tab 3's query agent runs (the stack's AgentCore Runtime). */
export type AgentSetup = { host: 'agentcore' | 'in-process' | null; available: boolean; reason: string; runtime_arn: string | null };
export type Execution = {
  runner: 'step-functions' | 'local';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED' | 'UNKNOWN';
  arn?: string;
  console_url?: string;
  started_at?: string;
  stopped_at?: string;
  error?: string;
};
type IngestedItem = { id: string; name: string; category: string; attributes: Record<string, string>; parts: string[] };
/** The compact per-source result the Ingest step returns to the state machine. */
type Ingested = {
  index: number;
  kind: 'image' | 'text';
  label: string;
  digest: string;
  model_id: string;
  status: 'ingested';
  items: IngestedItem[];
  look: string | null;
  article: string | null;
  /** A photo: the occasion its look is for (Look -FOR-> Occasion), when known. */
  occasion?: string | null;
  /** A text about one of the example photos: the look its statement ILLUSTRATES (that photo ingested first). */
  about_look?: string | null;
  statement: string | null;
  skipped: string[];
  issues: number;
  feedback: { kind: OntologyFeedback['kind']; suggestion: string; observed: string }[];
  metrics: Pick<ClassifyMetrics, 'latency_ms' | 'input_tokens' | 'cache_read_tokens' | 'cache_write_tokens' | 'output_tokens'>;
  ms: { classify: number; ingest: number };
};
/** One record per source in runs/<run>/NN.json: the classify result plus what ingest wrote. */
export type RunRecord = {
  index: number;
  kind: 'image' | 'text';
  label: string;
  status: 'classified' | 'ingested' | 'error';
  digest?: string;
  model_id?: string;
  ms?: number;
  error?: string;
  result?: ClassifyResult;
  ingest?: Ingested;
  /** What the ingest step wrote, as OWL individuals (Turtle). */
  owl?: string;
};
type SharedNode = { label: 'Category' | 'Attribute'; id: string; name: string; items: number; sources: number };
export type RunSummary = {
  run_id: string;
  finished_at: string;
  sources: { total: number; ingested: number; failed: number };
  added: { items: number; looks: number; articles: number; statements: number; skipped_entities: number; validation_issues: number };
  shared: SharedNode[];
  feedback: (Ingested['feedback'][number] & { sources: number[] })[];
  tokens: Record<string, number>;
  graph: { before: Record<string, number> | null; after: Record<string, number> };
  results: (Ingested | { index: number; kind: string; label: string; status: 'error'; error: string })[];
};
export type RunStatus = { run: RunInput; status: Execution['status']; execution: Execution; records: RunRecord[]; summary: RunSummary | null };
export type RunListEntry = { run_id: string; ontology_id: string; model_id: string; started_at: string; sources: number };
type LogEvent = { ts: number | null; message: string; level?: string; stream?: string | null; request_id?: string };
type LogReport = { duration_ms: number; billed_ms: number; memory_mb: number; max_memory_used_mb: number; init_ms: number | null };
export type LogsResponse = {
  request_id: string;
  source: 'cloudwatch' | 'memory';
  log_group: string | null;
  events: LogEvent[];
  report: LogReport | null;
  pending: boolean;
  console_url: string | null;
  error: string | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}


/**
 * The deployed API answers at most 10 requests at a time (its reserved concurrency, a cost ceiling
 * in the stack); above that Lambda answers 429. A GET changes nothing, so it is retried after a
 * short wait (four tries, about 4 s in all) instead of failing.
 */
const GET_RETRIES = 4;
const RETRY_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- tab 6 · What else the graph knows (lenses.py)
/** One step of a lens: openCypher the participant can edit, or a note on a vector search, the catalog or a model. */
export type LensStep = { label: string; code: string; editable: boolean };
export type LensCatalog = { lenses: Record<string, { steps: LensStep[]; question: string }> };
export type LensCell = string | number | boolean | null;
export type LensCount = { lens: string; columns: string[]; rows: LensCell[][]; headline: string; query: string; edited: boolean; pieces: number; start_garments: number; ms: number };
export type LensExplain = { text: string; system: string; user: string; ms: number; model: string };
export type CheckLook = { letter: string; id: string; occasion: string | null; distance: number; image_key: string; garments: string[] };
export type CheckLooks = { looks: CheckLook[]; mean_distance: number; query: string; edited: boolean; vector: { dimension: number; first: number[]; norm: number }; ms: number };
export type CheckPiece = { piece: string; main: boolean; fits: boolean; looks: string[]; note: string };
export type Verdict = 'on-brand' | 'partly' | 'off-brand';
export type CheckPieces = { pieces: CheckPiece[]; verdict: Verdict; summary: string; system: string; user: string; reply: string; rule: string; ms: number; model: string };
/**
 * "What are the emerging trends we see this season?": every garment worn in a look, with its vector
 * (int8, each scaled so its largest |x| is 127: cluster.decodeVectors), `new` when tab 2 ingested it
 * (the new shoot), `looks` how many looks wear it. `totals` count the items returned.
 */
export type TrendsMapItem = { id: string; name: string; category: string; new: boolean; looks: number };
/** `unplaced`: worn garments with no vector in the index, so not on the map (the backend reports it; absent means none). */
export type TrendsMap = { n: number; dim: number; vectors: string; items: TrendsMapItem[]; totals: { new: number; base: number }; truncated: boolean; unplaced?: number; ms: number };
/** A cloud after the walk: its own garments, then the looks that wear them (lettered, most cloud pieces first). */
export type TrendsCloudItem = { id: string; name: string; category: string; new: boolean; attributes: string[]; colors: string[]; looks: number };
export type TrendsCloudLook = { letter: string; id: string; name: string; occasion: string | null; image_key: string | null; new: boolean; from_cloud: string[]; garments: string[] };
export type TrendsCloud = {
  items: TrendsCloudItem[];
  looks: TrendsCloudLook[];
  counts: { items: number; new: number; looks: number; occasions: Record<string, number>; categories: Record<string, number>; details: Record<string, number> };
  query: string;
  edited: boolean;
  ms: number;
};
/** The two descriptions: the cloud's pieces (citing [n]), then how the brand wears them (citing [A]); `model` is the id that ran, `tokens` each call's and both together. */
export type TrendsFinding = { text: string; system: string; user: string; ms: number; tokens: TrendTokens };
export type TrendsDescribe = { items: TrendsFinding; looks: TrendsFinding; model: string; ms: number; tokens: TrendTokens };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce<T>(method, path, body);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429 || method !== 'GET' || attempt >= GET_RETRIES) throw e;
      await sleep(RETRY_MS * attempt + Math.random() * RETRY_MS);
    }
  }
}

/**
 * Photos are many small requests a page asks for at once (ten thumbnails, the looks of a search):
 * at most PHOTO_SLOTS run together, the rest wait their turn, so the page leaves room under the
 * API's cap for its other requests.
 */
const PHOTO_SLOTS = 4;
let photosRunning = 0;
const photoQueue: (() => void)[] = [];
async function photoRequest<T>(path: string): Promise<T> {
  if (photosRunning >= PHOTO_SLOTS) await new Promise<void>((r) => photoQueue.push(r));
  photosRunning++;
  try {
    return await request<T>('GET', path);
  } finally {
    photosRunning--;
    photoQueue.shift()?.();
  }
}

/**
 * True for Lambda's own refusal at the function URL, not one of the API's errors (`{"error": ...}`).
 * A missing permission comes as `{"Message": ...}`; a bad, stale or expired signature or token as
 * `{"message": ...}`.
 */
function refusedByIam(status: number, json: any): boolean {
  if (status !== 403 || json?.error !== undefined) return false;
  return typeof json?.Message === 'string' || typeof json?.message === 'string';
}

async function requestOnce<T>(method: string, path: string, body?: unknown, renewed = false): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const signed = await signedRequest(method, path, headers, payload);
  if (!signed) {
    // nobody is signed in: sign in, this request is lost
    await signIn();
    throw new ApiError(401, 'sign-in required');
  }
  let res: Response;
  try {
    res = await fetch(signed.url, { method, headers: signed.headers, body: payload });
  } catch (e) {
    // A refusal at the URL can come back without CORS headers, which the browser reports as a
    // network error: try once more with fresh credentials.
    if (renewed) throw e;
    forgetCredentials();
    return requestOnce<T>(method, path, body, true);
  }
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, `non-JSON response (${res.status})`);
  }
  if (refusedByIam(res.status, json)) {
    // expired or no longer valid credentials: once with fresh ones, then sign in again
    forgetCredentials();
    if (!renewed) return requestOnce<T>(method, path, body, true);
    await signIn();
    throw new ApiError(403, 'sign-in required');
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? `request failed (${res.status})`);
  return json as T;
}

export const api = {
  health: () => request<Health>('GET', '/api/health'),
  summary: () => request<Summary>('GET', '/api/summary'),
  ontology: () => request<any>('GET', '/api/ontology'),
  nodes: (label: string, limit = 500) => request<{ nodes: Node[] }>('GET', `/api/nodes?label=${encodeURIComponent(label)}&limit=${limit}`),
  node: (id: string) => request<Node & { neighbors: { edge: Edge; node: Node }[] }>('GET', `/api/node?id=${encodeURIComponent(id)}`),
  /** The photo or page a graph node came from, for the evidence tree's preview; `domain`: whose example photos it may name, `near`: the tree's nodes, closest first. */
  nodeSource: (id: string, domain?: string, near: string[] = []) =>
    request<NodeSource>(
      'GET',
      `/api/graph/source?id=${encodeURIComponent(id)}${domain ? `&domain=${encodeURIComponent(domain)}` : ''}${near.length ? `&near=${encodeURIComponent(near.join(','))}` : ''}`,
    ),
  explore: (ids: string[], hops = 1, limit = 200) =>
    request<{ centers: string[]; nodes: Node[]; edges: Edge[] }>('POST', '/api/graph/explore', { ids, hops, limit }),
  exploreLabel: (label: string, hops = 1) =>
    request<{ centers: string[]; nodes: Node[]; edges: Edge[] }>('POST', '/api/graph/explore', { label, hops }),
  /** "Same question, three answers": LLM only, RAG on the product catalog and GraphRAG (the smart retriever) side by side; a traversal makes GraphRAG the simple one with it, `searches` are RAG's edited ones. */
  /** With `image` (a data URL of one piece): Style recommendation, all three see the photo. */
  payoff: (question: string, opts: { cypher?: string; searches?: string[]; image?: string } = {}) => {
    const { image, ...rest } = opts;
    return request<PayoffResult>('POST', '/api/payoff', { question, ...rest, ...(image ? { image_base64: image } : {}) });
  },
  // tab 6 · What else the graph knows (lenses.py)
  lenses: () => request<LensCatalog>('GET', '/api/lenses'),
  lensCount: (lens: string, opts: { cypher?: string; start?: string } = {}) => request<LensCount>('POST', '/api/lenses/count', { lens, ...opts }),
  lensExplain: (lens: string, columns: string[], rows: LensCell[][]) => request<LensExplain>('POST', '/api/lenses/explain', { lens, columns, rows }),
  /** "Is this new photo on-brand?": one of the domain's example photos by name (`example`), as tab 6 lists them. */
  lensCheckLooks: (domain: string, example: string, cypher?: string) =>
    request<CheckLooks>('POST', '/api/lenses/check/looks', { ontology_id: domain, example, ...(cypher ? { cypher } : {}) }),
  lensCheckPieces: (domain: string, example: string, looks: CheckLook[]) => request<CheckPieces>('POST', '/api/lenses/check/pieces', { ontology_id: domain, example, looks }),
  lensTrendsMap: () => request<TrendsMap>('GET', '/api/lenses/trends/map'),
  lensTrendsCloud: (ids: string[], cypher?: string) => request<TrendsCloud>('POST', '/api/lenses/trends/cloud', { ids, ...(cypher ? { cypher } : {}) }),
  lensTrendsDescribe: (ids: string[], cypher?: string, modelId?: string) =>
    request<TrendsDescribe>('POST', '/api/lenses/trends/describe', { ids, ...(cypher ? { cypher } : {}), ...(modelId ? { model_id: modelId } : {}) }),
  // tab 4 · Build the retriever, stage by stage (payoff.py)
  /** Stage 1 and tab 0's product count: the catalog index RAG and GraphRAG search. */
  catalogInfo: () => request<CatalogInfo>('GET', '/api/catalog'),
  catalogItems: (n = 12) => request<{ items: CatalogHit[] }>('GET', `/api/catalog/items?n=${n}`),
  catalogItem: (key: string) => request<CatalogItem>('GET', `/api/catalog/item?key=${encodeURIComponent(key)}`),
  catalogSearch: (query: string, k = 6) => request<CatalogQuery>('POST', '/api/catalog/search', { query, k }),
  retrieverTemplates: () => request<RetrieverTemplates>('GET', '/api/retriever/templates'),
  /** Tab 0's cold open: the model on its own, the same prompt as tab 5's first column. */
  retrieverLlm: (question: string) => request<LlmColumn>('POST', '/api/retriever/llm', { question }),
  /** Stage 2a: the model plans its catalog searches; 2b: those (or the participant's edited ones) through the catalog, then the answer. */
  retrieverPlan: (question: string) => request<RetrieverPlan>('POST', '/api/retriever/plan', { question }),
  retrieverRag: (question: string, searches?: string[]) => request<RagColumn>('POST', '/api/retriever/rag', { question, ...(searches ? { searches } : {}) }),
  retrieverAnchors: (question: string) => request<RetrieverAnchors>('POST', '/api/retriever/anchors', { question }),
  retrieverTraverse: (anchors: string[], cypher: string) => request<RetrieverTraversal>('POST', '/api/retriever/traverse', { anchors, cypher }),
  retrieverGraphrag: (question: string, cypher: string) => request<GraphColumn>('POST', '/api/retriever/graphrag', { question, cypher }),
  /** The smart retriever: the model reads the question, keeps the matching garments; the same traversal and answer. */
  retrieverSmart: (question: string) => request<GraphColumn>('POST', '/api/retriever/smart', { question }),
  askModels: () => request<{ models: VisionModel[]; default: string }>('GET', '/api/ask/models'),
  query: (cypher: string, params: Record<string, unknown> = {}) => request<QueryResult>('POST', '/api/graph/query', { cypher, params }),
  graphAgent: (text: string, error: string | null, modelId: string, sessionId?: string) =>
    request<AgentResult>('POST', '/api/graph/agent', { text, error, model_id: modelId, session_id: sessionId }),
  /** The explorer: the whole graph of the brand's looks as one web (`details`: the attribute values too), and the openCypher that loaded it. */
  graphWeb: (details = false) => request<Web>('GET', `/api/graph/web${details ? '?details=1' : ''}`),
  graphCounts: (watch = 'white sneakers') => request<GraphCounts>('GET', `/api/graph/counts?watch=${encodeURIComponent(watch)}`),
  // tab 6 · the trends question: method 1 (the graph agent) and method 2 (the Iceberg tables and the data agent)
  /** `effort`: a level of the model's `reasoning.levels`, or null for a model with no setting. */
  trendGraphAgent: (modelId: string, effort: string | null) => request<GraphJob>('POST', '/api/trends/graph', { model_id: modelId, effort }),
  trendGraphPoll: (jobId: string) => request<GraphJob>('GET', `/api/trends/graph?id=${encodeURIComponent(jobId)}`),
  trendLake: () => request<LakeStatus>('GET', '/api/trends/lake'),
  trendLakeExport: (sessionId?: string) => request<LakeExport>('POST', '/api/trends/lake/export', { session_id: sessionId }),
  trendLakeAsk: (modelId: string, effort: string | null, sessionId?: string) => request<LakeJob>('POST', '/api/trends/lake/ask', { model_id: modelId, session_id: sessionId, effort }),
  trendLakePoll: (jobId: string, sessionId?: string) =>
    request<LakeJob>('GET', `/api/trends/lake/ask?id=${encodeURIComponent(jobId)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`),
  // tab 0 · Start here
  setup: () => request<SetupStatus>('GET', '/api/setup'),
  // ontology explorer
  /** Every domain folder, and `default`: the one whose ontology the graph is loaded with. */
  ontologies: () => request<{ ontologies: OntologySummary[]; default: string }>('GET', '/api/ontologies'),
  ontologyDetail: (id: string) => request<OntologyDetail>('GET', `/api/ontologies/detail?id=${encodeURIComponent(id)}`),
  parseOntology: (text: string, filename: string) => request<OntologyDetail>('POST', '/api/ontologies/parse', { text, filename }),
  examples: (id: string, set: ExampleSet = 'images') =>
    request<{ ontology_id: string; set: ExampleSet; examples: ExampleInfo[] }>('GET', `/api/ontologies/examples?id=${encodeURIComponent(id)}${setParam(set)}`),
  /** One of the data sets' stored photos by its stable key (a look's image_key, a product's): previews.STORED_PHOTO. */
  photo: (key: string) => photoRequest<StoredPhoto>(`/api/photo?key=${encodeURIComponent(key)}`),
  exampleImage: (id: string, file: string, set: ExampleSet = 'images') =>
    photoRequest<{ file: string; content_type: string; data_url: string }>(
      `/api/ontologies/example-image?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}${setParam(set)}`,
    ),
  articles: (id: string) => request<{ ontology_id: string; articles: ArticleInfo[] }>('GET', `/api/ontologies/articles?id=${encodeURIComponent(id)}`),
  articleText: (id: string, file: string) =>
    request<{ file: string; title: string; text: string }>('GET', `/api/ontologies/article?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`),
  visionModels: () => request<{ models: VisionModel[] }>('GET', '/api/vision/models'),
  classify: (body: {
    ontology_id?: string;
    owl_text?: string;
    owl_filename?: string;
    example?: string;
    image_base64?: string;
    model_id: string;
    prompt_caching: boolean;
  }) => request<ClassifyResult>('POST', '/api/vision/classify', body),
  explorerCode: (set: CodeSet = 'explorer') => request<{ snippets: CodeSnippet[] }>('GET', `/api/explorer/code?set=${set}`),
  // ingest pipeline
  startRun: (body: { ontology_id: string; model_id: string; prompt_caching: boolean; line_id: string; sources: SourceRequest[] }) =>
    request<{ run: RunInput; status: 'RUNNING'; execution: Execution }>('POST', '/api/pipeline/runs', body),
  runStatus: (runId: string) => request<RunStatus>('GET', `/api/pipeline/runs?id=${encodeURIComponent(runId)}`),
  listRuns: (limit = 12) => request<{ runs: RunListEntry[] }>('GET', `/api/pipeline/runs?limit=${limit}`),
  runGraph: (runId: string, hops = 1, limit = 400) =>
    request<{ run_id: string; centers: string[]; nodes: Node[]; edges: Edge[] }>('GET', `/api/pipeline/graph?id=${encodeURIComponent(runId)}&hops=${hops}&limit=${limit}`),
  architecture: () => request<Architecture>('GET', '/api/explorer/architecture'),
  logs: (requestId: string, logStream?: string | null, limit = 200) =>
    request<LogsResponse>(
      'GET',
      `/api/explorer/logs?request_id=${encodeURIComponent(requestId)}&limit=${limit}${logStream ? `&log_stream=${encodeURIComponent(logStream)}` : ''}`,
    ),
};

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
