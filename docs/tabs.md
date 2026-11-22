# The tabs

One section per tab of the web app, in the order of the tab bar. Every tab but tab 0 has a "How it
works" panel (tab 0 only shows what one looks like): the architecture as a numbered diagram, the
steps of the last request, and the code of each step read from the live source
(`backend/src/ontology_rag/code_panel.py`; a test fails when a refactor moves a marked line). The README has a short summary of each tab; this page has the detail.

**What a tab keeps.** The app shows one tab at a time, so a tab's state would go with every switch.
Instead, every answer from a model or an agent, and the inputs behind it (the question, the photo,
the model, an edited query), is kept for the browser tab: in memory for the page and in session
storage (`web/src/components/shared/kept.ts`; tab 1 uses `studioCache.ts`, tab 6's agent methods
`trendsCache.ts`). Leave a tab and come back, or reload the page, and the answers are still there.
A request still running when you leave lands while you are away and shows when you come back;
after a reload it is gone and its step is ready to run again. Every run button stays, so running a
step again replaces its answer. Signing out clears all of it; so does closing the browser tab.

## 0 · Start here

The app opens on this tab, in six numbered steps, then the link to tab 1.

1. **One question, asked to a model on its own.** The white sneakers question ("What should I wear
   with white sneakers?") goes to the answer model with no brand behind it (`POST
   /api/retriever/llm`, the same call as tab 5's first column), then what to notice. The answer is
   kept for the browser tab, so it is still there after a visit to another tab. Come back while the
   model is still answering, and the step shows "Asking…", then the answer when it lands.
2. **Shop it yourself.** The shopper's problem, felt before any technology is named. Four requests
   a shopper might type into a product search, as buttons in this order: "What goes with white
   sneakers?", "A sleeveless dress, not black", "A trench over denim", "A blue shirt with a white
   collar". Choosing one runs the catalog's similarity search on the deployed catalog (`POST
   /api/catalog/search {query, k: 6}`, the read-only search tab 4's stage 1 opens up) and lists the
   six nearest products: name, kind and colour, with the product photo when the catalog has one
   (`image_key`; the sample's own text catalog has none). Under the list, one line per request
   says what the shopper wanted and what came back (an outfit, and more shoes; a colour ruled out,
   and how many of the products are black anyway; two pieces in one order, and coats, denim or
   both, matched apart; a colour per part, and shirts in one colour each). The lines are written
   in the component (`web/src/components/setup/ShopItYourself.tsx`), not by a model; the first
   three read the results, because what comes back depends on the catalog (the sample's own 62
   products return a white shoe with shoes in other colours, a black dress first and coats with
   denim pants; a larger catalog returns six white sneakers, six black dresses and six trench
   coats). The results of all four requests and the request on show are kept for the browser tab;
   the step counts as done once one request ran, and a failed search shows its error and keeps
   the line.

   Once a request ran, the step gives the business problem (*What to notice*): the brand's
   stylists chose the pairings in every look they shot, that knowledge sits in photos nothing can
   query, and a larger embedding model does not close the gap, with the three sources as links
   (SugarCrepe on attribute binding, NegBench on negation, RAGSearch on multi-hop questions).
   Then *Good to know: Three terms* defines taxonomy (the tree of kinds), ontology (the taxonomy
   plus the details, values, relations and rules: the fixed list of words the vision model has to
   use) and graph data (the brand's looks and garments as nodes and edges in those words), and one
   sentence teases tab 1 (the ontology the photos are read with) and tabs 2 and 3 (the graph built
   from them, and shown).
3. **What you'll build**: the graph (a vision model on Amazon Bedrock describes each look photo
   with the ontology's terms only; an AWS Step Functions pipeline stores every look, its garments
   and its occasion in Amazon Neptune Analytics; GraphRAG answers from those looks, and the graph
   is a new data source), a three-row table **The same question, three answers** (LLM only, RAG,
   GraphRAG: who chose what to suggest, and what each can show you), and **Meet the brand**: the
   brands in the graph, from the `Brand` nodes `GET /api/summary` returns (`brands`: name and
   description, sorted by name). The title is "Meet the brand: `<name>`", or "Meet the brands: `<a>`
   and `<b>`" with several. Each brand's description comes from its data set's `brand.json`. The box
   adds the looks counted in the graph and the products in the catalog index, a sentence on the
   new shoot only when the domain has example photos marked `"batch": "new-shoot"` (with their
   count), and one on how the photos were made only when the domain has example photos. A count
   not read yet is left out; no name or count is written in the code. The step closes with **The
   tabs, one after another**: what you do in each tab and the point it makes (click a row to open
   that tab), then what you take away.
4. **How to read every tab**: the numbered steps, the callouts (*Your turn*, *What to notice*,
   *Good to know*, *In CPG*), the *Inspect* and *How it works* expanders (open *How it works* as
   you go: the AWS services behind the step as a numbered diagram, with the code of each step) and
   the optional parts.
5. **Same shape, another aisle**: the same graph for beauty, home and food (what the brand shows,
   one piece in it, what it is for, the curatorial rule), with a link to tab 1, step 4, where the
   three browse-only ontologies are.
6. **What's deployed in your account**: one card per resource, read-only. The stack owns every
   resource; the cards report them with console links and nothing here creates, starts or deletes
   anything (`GET /api/setup`, `backend/src/ontology_rag/setup.py`; the routes `POST /api/setup/*`
   are gone and answer 404). A checklist on top shows the domain, the graph, the query agent and
   the product catalog at a glance.

The closing line says the app guides you with numbered steps, so you can follow it without the
workshop guide; the guide explains the ideas behind each tab when you want more.

The cards of step 6:

**Domain.** The folder under `ontologies/` whose ontology, example photos and example texts the
other tabs work with. The card lists every folder that is a full domain with its name, id, class
and value counts, the number of example photos and texts, the description from its `domain.json`
and its data sets (the folders under its `datasets/`). The sample ships one domain, `fashion`, and
three browse-only ontologies (`beauty`, `home`, `food`, `"browse_only": true` in their
`domain.json`), which the card leaves out: tab 1 shows them in step 4. Another domain is one more
folder next to them.

The choice is remembered by the browser and drives the other tabs: tabs 1 and 2 classify against
its ontology with its example photos and texts and the wording of its classification instruction,
tab 5 offers its single pieces and tab 6 its new-work photos. The graph
holds one vocabulary, the ontology `ONTOLOGY_PATH` points at, loaded with every data set of its
domain at deploy. Choosing another domain does not reload it, and the card says so; when the chosen
domain is not the graph's, a notice says that ingesting its photos and texts in tab 2 adds them to
the graph. The deployed API lists every folder in the data bucket.

**The graph: Amazon Neptune Analytics.** Its status, id, node and edge counts and size, and that it
is private: reachable only from the stack's VPC, through its private graph endpoint. The counts
came through that endpoint.

**Query agent: Amazon Bedrock AgentCore Runtime.** Tab 3's agent on the Amazon Neptune MCP server:
the runtime the API invokes, with its console link. The API may call
`bedrock-agentcore:InvokeAgentRuntime` and nothing else on it.

**Product catalog: Amazon S3 Vectors.** One vector bucket with one index, `catalog`, with the
stack's embedding dimension and cosine distance: the products, embedded from their text and filled
at deploy with the data sets' products. RAG and GraphRAG search the same catalog (tabs 4 and 5).
The card names it as `s3vectors://<bucket>/catalog`.

**The API, the ingest pipeline and the photos.** The API function and its IAM-protected function URL, the ingest
state machine (up to 4 photos at a time), the data bucket with the brand's photos, tab 2's uploads
and run records, and the embedding model, with their console links.

**Amazon Bedrock models.** The models the deployment uses, grouped by what each is used for. There
is nothing to create: the account needs access to them in the Region. `ontology-rag check-models`
(the backend venv of `make setup`) sends each one a request of a few tokens and the embedding model
one word, prints one line per model and exits with 1 when any of these calls fails, which makes it
the pre-flight to run before `cdk deploy`.

**Guardrail: Amazon Bedrock Guardrails.** What the stack's guardrail checks, and that it runs only
on the model calls that carry text the participant wrote.

## 1 · Ontology explorer

The tab shows three things: multimodal models on Amazon Bedrock, an ontology used as a contract, and
several models compared on the same task.

1. **The ontology.** The domain chosen in tab 0. It is parsed with [rdflib](https://rdflib.readthedocs.io/) and drawn as a
   top-down tree: the root classes on the top row, subclasses below them, leaf classes and values
   stacked in columns under their parent, joined by orthogonal connectors that never cross. Object
   properties are dashed arrows from domain to range, drawn when you switch them on or select a
   class.

   Labels are part of the drawing and grow as you zoom. A **depth** slider cuts the hierarchy (a
   `+N` badge counts the folded subclasses); the **classes / properties / values / KG schema**
   switches turn layers on and off. Search, click a node or its label, or **Expand** for a
   full-window view.
2. **The image.** One of the domain's example photos (`ontologies/fashion/examples/images/`) or an upload of
   your own (JPEG, PNG, WebP or GIF, up to 4 MB: the image travels base64-encoded in a JSON body, the
   Lambda function URL accepts 6 MB request payloads, and the API refuses decoded images above 4 MB,
   `api.MAX_IMAGE_BYTES`).
3. **The vision model.** Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5, GPT-6.1 Sol, GPT-6.1 Terra and
   GPT-6 Astra, Amazon Nova 2 Lite, Grok 4.7 and Kimi K3 by default (`VISION_MODEL_IDS` to change). **Classify** runs
   the chosen one. The ontology is rendered as the system prompt (the cached prefix, for the models
   that take a cache checkpoint); the model returns entities with 0-1000 bounding boxes, ontology
   attribute values and parts, plus at most one value per *photo property* for the photo as a whole (fashion has one,
   `for`: the occasion, one of the ontology's nine), and the pipeline validates every answer
   against the ontology. Unknown classes and values are reported, never kept. The results show
   the photo's values above the entities ("Occasion: Professional · the photo as a whole"). The
   five steps read top to bottom in `backend/src/ontology_rag/classify.py`: one `bedrock-runtime` Converse request for every
   provider, through `global.` cross-Region inference profiles; current-generation models only, and
   superseded ids (Sonnet 4.x, Opus 4.x, Haiku 3.5, GPT-5.4 and 5.5) are refused with their
   replacement.
4. **Boxes and nodes.** Click a box on the image and the classes, values and properties it uses light
   up in the ontology tree; click an ontology node and the boxes that use it light up in the image.
5. **Ontology feedback.** The prompt also makes the model the ontology's reviewer. Whatever it saw
   but could not express with the vocabulary (an item with no class, a value not in the allowed list,
   a missing component or relation) comes back as structured `ontology_feedback`: what was observed,
   for which entity, and how it would extend the ontology. The **Ontology improvements** tab of the
   results panel shows this model's advice and, once several models have run on the image, every
   model's merged, so a proposal several models make independently stands out. Proposals that name
   something the ontology already has are flagged *already known*: the model missed it, which is a
   prompt problem rather than a gap.
6. **The results panel.** Parsed entities; the model output as formatted JSON (fold and unfold,
   expand or collapse all, copy, or the raw text); the system prompt and the request; a metrics table
   with latency and input, cache-read, cache-write and output tokens per model (the tab always
   sends a cache checkpoint where the model takes one). The **System prompt** tab lays the prompt out for reading (the instruction, the
   class hierarchy as a tree, relations as domain to range, every attribute property with its allowed
   values as chips, the section *The whole photo* with each photo property's values and their
   definitions, the feedback ask and the output contract) with a raw-text switch. For fashion 1.2.0
   the system prompt is 9,682 characters. Every result is
   cached in the browser per ontology, image and model until you clear it.
7. **The Ontology panel.** The statistics of the loaded ontology and, once you select an element,
   everything the ontology says about it: superclasses and subclasses, the properties whose domain it
   is with their ranges and allowed values, the classes it connects to and through which properties,
   or, for a property, its domain, range and sub-properties. Every name is a link into the ontology.
8. **Other aisles** (step 4, if you have time): the same shape in other catalogs. The choices are
   the ontology of steps 1 to 3 and the browse-only domains `GET /api/ontologies` lists (beauty,
   home and food in the sample), each read once with `GET /api/ontologies/detail`: the kinds a
   model could name, the families of detail, the allowed values, the prompt's size, the map and
   the details, starting from the words of the domain's `start_with`.

**How this works** is the architecture as a numbered diagram (React Flow): **1** the ontology read
from S3 and parsed with rdflib, **2** the photo read from S3, **3** the prompt built in Lambda, **4**
the Converse call to Bedrock (model, inference parameters, prompt caching), **5** the answer
validated against the ontology; browser, Amazon Cognito and CloudWatch are drawn grayed, as context. The
lines animate while a request is on that leg.

Click a number or a service to inspect it: the S3 tiles open the prefix in the S3 console; the Lambda
tile shows the latest invocation (request id, cold or warm start, handler time, billed duration and
memory from the `REPORT` line) and the log lines of that request (a deployment with
`-c explorerLogs=true` only; the lines are not redacted); the Bedrock tile aggregates every
model called so far.

Under the details, **Essential code** shows the functions of the selected step in an IDE-style view
(syntax colors, line numbers), served from the source files. Numbered gutter marks point at where
Bedrock is called, how the cache checkpoint is placed, and how the model id and the ontology travel
with the image in one Converse request. Under *Render the ontology as text (the system prompt)*, a
nested **rendered prompt** item shows that function's output for the selected ontology before any
model is called; once a model has answered, a tab marked with a star shows the exact system prompt,
user turn and Converse request of the latest call with the same marks.

Deployed, the `ontologies/` folder lives in the data bucket (`OntologiesLocation` output) and the
API re-lists it every minute, so a new domain folder uploaded to the bucket appears in tab 0 without
a redeploy; the copy bundled with the Lambda is the fallback. The same five steps from Python:

```python
# classify.py: the Converse request is built in the open
from ontology_rag import classify
from ontology_rag.service import Service

svc = Service()                                                       # AWS_REGION, ONTOLOGIES_BUCKET, VISION_MODEL_IDS
view = classify.load_ontology(svc, "fashion")                         # 1. the OWL file (and domain.json) → rdflib view
image = classify.load_image(svc, "fashion", "01-trench-coat-sweater-dress.jpg")  # 2. the photo from <domain>/examples/images/, as bytes
system_prompt, user_turn = classify.build_prompt(view, image)         # 3. ontology = system prompt
model = svc.vision_model("global.anthropic.claude-opus-5-5")          # a global cross-Region inference profile
request, response, ms = classify.call_model(svc.bedrock, model, system_prompt, user_turn, prompt_caching=True)  # 4.
result = classify.check_answer(view, model, system_prompt, request, response, ms)  # 5. checked against the ontology
result["entities"], result["issues"], result["feedback"], result["metrics"]
```

## 2 · Hydrate the graph

The second tab takes what the explorer does for one photo, applies it to a batch of photos and
texts, and writes the result into the graph, which turns the classifier's answers into a knowledge
graph. One click starts one AWS Step Functions execution:

![The ingest pipeline: the browser sends sources to the Lambda API, which stores the uploads in Amazon S3 and starts a Step Functions execution. A Map state runs classify and ingest for each source, four at a time; classify calls Amazon Bedrock, ingest embeds and MERGEs into Neptune Analytics; a summarize step closes the run.](../assets/ingest-pipeline.png)

```
Map over the sources (4 at a time)
  ├─ Classify   Lambda: ontology as the system prompt (cached for the models that take a checkpoint),
  │             the photo or the text as the user turn, one Bedrock Converse call, the answer
  │             validated against the ontology
  └─ Ingest     Lambda: the validated answer as OWL individuals of the ontology (rdflib), mapped
                onto nodes and edges by generic rules, MERGEd into Neptune Analytics
Summarize       Lambda: node counts before and after, what the sources share, ontology feedback
```

Its first step shows where you start: the graph's counts before the batch.

1. **Pick sources.** The domain is the one chosen in tab 0 (the control opens that tab). Its example
   photos and example texts (`ontologies/fashion/examples/articles/`: an editorial on the trench coat,
   social posts bylined "AnyCompany Fashion House · social post", fitting-room notes on a pinstripe suit, a
   journal piece on layering knits) or your own photos and `.md`/`.txt` files. A domain with a new
   shoot (examples marked `"batch": "new-shoot"`) starts with the shoot selected; the sample has
   none and starts with its first batch (`"batch": "first"`: photos 01, 04 and 08 and the texts about
   them, one with white sneakers). Step 2 shows the batch as tiles before the run, each with a ×
   that leaves it out; *Preview as article* shows a text inline as a blog page. More sources, and
   your own, are under *Deep dives*, whose list ends with a link back to step 3. One vision model
   for the whole batch.
2. **Run** and watch the execution: the progress bar polls the run's records and the architecture
   panel animates the leg each source is on; the tile links to the execution in the Step Functions
   console.
3. **Results per source.** The entities with their class (`Category`), attribute values
   (`HAS_ATTRIBUTE`), components (`HAS_PART`) and the graph node each became; a photo also shows its
   boxes, and its look's occasion. Entities the ontology has no class for are skipped and listed,
   never invented: the validation is the same `vision.validate` the explorer uses.
4. **The summary.** How many items, looks, articles and statements the batch added (ids derive from
   the content, so re-running the same sources updates the same nodes; a photo the model reads
   differently the second time may add an entity), tokens with cache reads and writes across the
   batch, the **vocabulary the sources share**, and the ontology feedback merged across sources. A
   photo of a sheath dress and a post about it meet on `dress`, `nickname:sheath-dress`,
   `neckline-type:round` and `leather:suede` (the clutch) because both were classified against
   the same ontology, not because the words matched.
5. **The graph the run wrote**, as a forest of top-down trees (`web/src/components/pipeline/runTreeLayout.ts`):
   one tree per source (an article with the statement the model read, or the look of a photo with its
   thumbnail) down to the garments found in it, and under each garment what the ontology resolved:
   `IS_CATEGORY`, `HAS_PART`, `HAS_ATTRIBUTE`. A node the graph holds once but several garments use is
   drawn under each of them with a **×N** badge; click it and every copy lights up.

   Two hops out, **+N** counts the lookbook garments on the same node and each garment lists the lookbook
   garments sharing the most of its vocabulary. The **Depth** slider cuts every tree at a tier; a box
   whose children are cut carries **+N** and unfolds on its own. The wheel scrolls, Ctrl/⌘ + wheel
   zooms, *Jump to a source* and *Fit* navigate.
6. **How this works** draws the Map over the sources around the classify and ingest Lambdas, then the
   summarize Lambda, inside a Step Functions box, with S3, Bedrock and Neptune Analytics outside it:
   **1** the Map, **2** the classify call, **3** the ingest call, **4** the MERGE into Neptune, **5** the
   summary. **Essential code** per step: the state machine definition
   (`backend/src/ontology_rag/pipeline.asl.json`, JSONata, the same file CDK deploys), the
   one-function-three-steps Lambda, the CDK construct, the ingest step, the answer as OWL individuals,
   the OWL to property-graph rules (`kg.py`) and the openCypher `MERGE` statements. The ingest tile
   shows the Turtle of the individuals the latest source became.

**From the model's answer to the graph, through OWL** (`backend/src/ontology_rag/kg.py`). The
validated answer is first expressed as OWL individuals of the ontology itself (`item a fo:Item ;
fo:isCategory fo:Coat ; fo:hasSilhouette fo:silhouette_a-line ; fo:hasPart fo:Lapel`; the photo an
`fo:Look` that `fo:contains` its items), then mapped onto the property graph by four rules that name
no fashion term: `rdf:type` becomes the label, a literal a property, an IRI an edge (a sub-property
takes its super-property's name and keeps its range on the edge: `HAS_ATTRIBUTE {family}`), and an
ontology term a shared vocabulary node keyed by its `fo:conceptId`.

**The occasion of a look.** A photo's look gets at most one occasion, written through OWL as
`look fo:for fo:occasion_x` and mapped onto `(:Look)-[:FOR]->(:Occasion)`. The example's manifest
comes first (a new shoot's photos carry the occasion they were shot for, resolved against the
ontology's occasions, hidden labels included), then the model's answer to the prompt's section on
the photo as a whole (one of the ontology's nine, checked against the list), then none. The look's
`occasion` property is the name of the occasion it got. A text gets none.

One table, `KG_SCHEMA`, names the ontology's knowledge-graph classes and properties, so another
ontology edits that table, not the code. Neptune Analytics can also bulk-load the same individuals as
N-Triples (`CALL neptune.load({format: 'ntriples', ...})`); it then keeps full IRIs as vertex labels
and edge types, which is why this sample maps them to the short labels the openCypher queries use.

The state machine input carries file names and S3 keys only, never bytes, so a run stays far below
the 256 KB state size limit however many sources it has (20 per run by default). Transient Bedrock
and Neptune errors are raised as `RetryableError` and retried by the state machine with exponential
backoff and jitter; any other error fails that source only and the batch continues. Uploads expire
after a day and run records after a week (S3 lifecycle rules).

## 3 · Explore the graph

The whole graph: the brand's lookbook and everything tab 2 added, in three steps.

1. **What the graph holds**: the node counts from `GET /api/summary`, the brand's looks (brands,
   looks, garments, occasions, articles and their statements) apart from the rest (the ontology's
   groups, categories, attribute families and values, and the product lines), and the number of
   looks added in tab 2.
2. **The web: every look, connected** (`GET /api/graph/web`): every look and every garment in
   them as one graph, with the kinds of garment and the occasions that have a look (an occasion no
   look is for is left out). Search a garment (*white sneaker*, *black blazer*, *gold hoop*) and
   every look it is in lights up; click a look, a garment, a kind or an occasion and what it links
   to lights up, with its photo in the side panel. *show details* adds the attribute values as
   nodes. *Inspect* shows the openCypher that loaded the web.
3. **Query it yourself: openCypher, or plain words.** Example openCypher statements about the
   brand's looks (what is in the graph, looks per occasion, what you ingested in tab 2, what is worn
   with white sneakers, the details the brand uses most, an article and the look it is about), the
   ontology in the graph, vector search from inside openCypher, two broken ones (a missing
   parenthesis, a Neo4j-only procedure) and questions in plain words. Pick one, edit it or type
   your own, and **Run** it on Neptune Analytics. The panel is read-only: write clauses run only
   where `ALLOW_WRITE_QUERIES=true`, and the sample offers no write example. In *What is worn with
   white sneakers*, the first line is `WITH 'white' AS color, 'sneaker' AS kind`: the query matches
   both as words in the garment's name (the label the vision model wrote), not as an ontology class,
   and the ontology has no sneaker class. Edit it to `'black'` and `'loafer'` to compare what the
   brand wears with each.

**The query agent.** When Neptune rejects the text (a typo, a Neo4j-only procedure, plain words), the
text and Neptune's message go to an agent on the
[Amazon Neptune MCP server](https://github.com/awslabs/mcp/tree/main/src/amazon-neptune-mcp-server)
(`backend/src/ontology_rag/query_agent.py`), or straight to it with **Ask the agent**. In 3b, the
questions in plain words, **Ask the agent** is the main button; **Run** shows Neptune's refusal as
the expected first step, in a grey note, before the agent takes over. The agent is
a Bedrock Converse tool loop with the model picked in the panel; its tools are the server's own. It
starts `awslabs.amazon-neptune-mcp-server` as a stdio subprocess pointed at the graph, reads the
schema through `get_graph_schema`, hands the tools to the model as the Converse `toolConfig` and
forwards each `toolUse` to the server. The system prompt holds the rules, the schema and the
domain's worked examples (`query_examples` in `domain.json`: question and query pairs tested on
this graph), so the model starts from patterns that run on Neptune Analytics.

A rejected query comes back to the model with Neptune's message, so it fixes the query and runs it
again (at most 6 tool calls, about 70 s). The panel shows the model's answer, the query that ran, its
rows, every step and where the agent ran.

The agent runs on
[Amazon Bedrock AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html),
not in the API function: the API calls `InvokeAgentRuntime`, and AgentCore runs the loop and its MCP
server in a microVM of their own, one session per browser tab and signed-in user (a session ends
after 10 idle minutes, at most after 2 hours). The runtime is a code zip (`backend/agentcore/main.py`
on the AgentCore SDK, Python 3.14 on arm64, started through `opentelemetry-instrument`; platform
version V2 where AgentCore offers it).

The agent only reads: a guard refuses write clauses before they reach the server, and the only
graph permission of the runtime's execution role is `neptune-graph:ReadDataViaQuery`. Beyond the
graph, the role may call the listed models, apply the guardrail, write the runtime's logs, traces
and metrics, and read the CDK bootstrap assets bucket, where AgentCore Runtime loads the agent's
code zip from. Its own **How the query works** panel numbers the path: **1** openCypher on Neptune, **2**
`InvokeAgentRuntime`, **3** the MCP server, **4** the plan, **5** validate and execute, **6** the
result.

## 4 · Build the retriever

The retrieval behind a style answer, one stage at a time; each stage unlocks when the one before it
has run (`web/src/components/retriever/`, `backend/src/ontology_rag/payoff.py`). The question on top
(white sneakers first, then a black blazer, wide-leg trousers, or your own) drives stages 2 to 5;
stage 1 searches for what it names ("white sneakers"). A new question starts stages 2 to 5 over.

![RAG and GraphRAG side by side: both search the same product catalog in Amazon S3 Vectors and answer with the same prompt; RAG plans its searches with a model, GraphRAG takes them from three of the brand's looks found by a vector search on the graph and a read-only traversal.](../assets/rag-vs-graphrag.png)
Two stores, one job each:

| Store | What it holds | Who reads it |
|---|---|---|
| the catalog index (Amazon S3 Vectors, `catalog`) | the products the shop sells, embedded from their text (`payoff.catalog_name`, `payoff.catalog_text`); no styling knowledge, no price. In production this is the retailer's product search (often OpenSearch) | RAG and GraphRAG, through the same catalog search |
| the graph (Neptune Analytics) and its vector index | the brand's looks: each look, the garments in it named with the ontology's terms, its occasion (a catalog set's products are in it as items) | GraphRAG |

1. **The catalog: a vector store of products.** What the index holds (`GET /api/catalog`: the
   index, how many products, their dimension, the distance metric and the embedding model), a
   page of products to open (`GET /api/catalog/items?n=`), one product as stored
   (`GET /api/catalog/item?key=`: the text that was embedded, its metadata and its vector), and a
   raw search (`POST /api/catalog/search {query, k}`, k 3, 6 or 10 in the tab, 1 to 20 on the
   route, default 6): the search embedded, its vector shown, the nearest products with their
   cosine distance. A search for white sneakers returns more white sneakers. No answer: this is
   what similarity search returns. The graph loader fills the index at deploy, one data set after
   the other: a graph-export set's `catalog.json` as it is (precomputed vectors), or a
   catalog-format set's `items.json` embedded from text.
2. **RAG: real products, the model's taste.** *Plan the searches* (`POST /api/retriever/plan`):
   the model reads the question and plans 3 to 6 catalog searches from its own taste
   (`payoff.PLANNER_SYSTEM`; at most 6 searches of at most 120 characters), with one sentence on
   why. The searches are one per line in a box you can edit, and *Inspect* shows the planner
   prompt, the question and the model's reply. *Search the catalog and answer*
   (`POST /api/retriever/rag {question, searches?}`) runs them through the catalog search: each
   search embedded, its 3 nearest products of the kind it names (`K_PER_SEARCH = 3`), names
   de-duplicated, so up to 18 products. The model answers from those, citing lines of the form
   `[n] Item: <name>. <text>`. The result shows the searches, the products with the search that
   found them and their distance, the answer with its citations and, under *Inspect*, the system
   prompt and the user message (the question and the numbered products). Its sources: "N catalog
   products (they exist; nothing says they go together)". No one at the brand chose these searches.
3. **GraphRAG, the starting garments: vector search on the graph.** The question embedded and
   matched against the garments in Neptune Analytics' own vector index
   (`POST /api/retriever/anchors`): the nearest garments, and every garment worn in a look within a
   band of the closest such garment becomes a starting garment (an `anchor` in the API).
4. **Walk the graph.** The traversal (`payoff.TRAVERSAL`, shown read-only): from the starting
   garments to every look they are in (`CONTAINS`), each look's occasion (`FOR`), and the other
   garments in those looks with their kind and details (`POST /api/retriever/traverse`). Then the
   result counted per kind of garment: what is worn with the starting garments, in how many of the looks. A count
   is a number of distinct looks, not of rows or garments ("shoe 3 of 5": 3 of the 5 looks have a
   shoe worn with the starting garments), and the other shoe of a starting garment's pair is not
   counted.
5. **GraphRAG's answer, with sources** (`POST /api/retriever/graphrag`): the occasions and the
   "worn with" counts as style patterns, three of the brand's looks with up to four of their pieces
   (one per kind) each matched to one product through the same catalog search as RAG (no product
   when the catalog sells nothing of that kind), and the answer
   built on those looks, with the sources tree (the
   traversal behind each citation).
6. **Where it breaks, and the fix.** A question with two pieces and a color ("What sneakers go with
   a blue pleated midi dress?"): the simple version starts from what is closest to the whole
   question; the smart one (`POST /api/retriever/smart`) adds a model call that reads the question
   (what to start from, what is looked for, what must match), one model call per start piece that
   grades the closest garments as exact, similar or no, and one filter after the traversal that keeps only the pieces
   asked for. Everything else is the same vector search, traversal, catalog matching and answer
   prompt. *Inspect* shows the two new model calls and the filter.

RAG and GraphRAG share the catalog, the search and the answer prompt
(`payoff.ANSWER_SYSTEM`); they differ only in where the guidance comes from (the model's own taste
for RAG, the brand's looks for GraphRAG). Each stage has its **How it works** panel with the code
that ran: what is embedded for a product, the index write and the query for stage 1; the planner
prompt, the plan, the catalog search and the answer prompt for stage 2; the starting garments, the
traversal, the count, the catalog search and the answer for stages 3 to 5.

## 5 · Same question, three answers

One question answered three ways side by side, with the same answer model
(`POST /api/payoff {question, model_id?, searches?, image_base64?}`, the three in parallel; without
`searches` RAG's model plans its own): **LLM only** (the model on its own, no retrieval), **RAG**
(the model's own taste, on real products from the catalog) and **GraphRAG** (the brand's looks,
with the smart retriever of tab 4's stage 6). The questions start with the white sneakers question
of tab 0. Each column says first who chose what to suggest, then:

- **LLM only**: the answer, and "Where it came from": nothing to show.
- **RAG** ("The model's own taste, on real products"): the answer, **The searches the model made
  up, from its own taste**, and **What the catalog returned**: the products each search found,
  with the search and the distance. Its sources: "N catalog products (they exist; nothing says they
  go together)".
- **GraphRAG**: the answer, what the brand's looks say (the starting garments, the occasions with
  their counts), three of the brand's looks matched to the catalog, and the evidence it was given.

Every column has *Inspect: exactly what the model was given* (the system prompt and the user
message; RAG's also the search planner prompt, GraphRAG's also the traversal). A notice under the
columns says what is fair: RAG and GraphRAG search the same catalog, so both can suggest similar
products, and the difference is who chose what to look for. RAG's searches come from the model's
own taste, the internet's average, so no one at the brand chose them. GraphRAG's come from the
brand's own looks: it walks the graph from the garments the question names to every look they are
in, counts, and sends the pieces of three of those looks through the same catalog search. Below,
**GraphRAG's sources: the looks behind the answer and the walk that found them**: click a citation
or an evidence line and its path back to the brand's looks lights up.

**Style recommendation: ask with a photo.** Switch to *A photo (Style recommendation)*, pick one of the
domain's single pieces (`ontologies/fashion/examples/items/`, `GET /api/ontologies/examples?id=fashion&set=items`)
or drop your own photo of one piece, and ask again ("What goes with this?", "Which shoes go with
this?", "Which bag goes with this?"). All three columns see the photo; RAG's planner sees it when
it plans the searches. Only GraphRAG embeds the photo, to find its starting garments (Amazon Nova
multimodal embeddings put images and text in one space): the same vector search on the graph's
garments and the same traversal, keeping only the kind of piece the question asks for. No vision
model describes the photo first. A photo of a whole outfit becomes one vector for everything in
it, so the tab asks for a photo of one piece.

## 6 · What else the graph knows

Tab 6 hands the same graph to a buyer, a merchandiser and a creative director, each with questions
of their own. Most are a count in the graph, then a model that explains the numbers citing only
them. The lenses that count per occasion (*What does each occasion lean on?*, *Which pieces hold
the most looks together?*, *What is our style, per occasion?*, *Where is the lookbook thin?*) count
AnyCompany Apparel's looks too on the sample's own deploy: the loader links them to the ontology's occasions
(see [graph-model.md](graph-model.md#occasions)), and *Where is the lookbook thin?* starts from the
occasions that have a look.

The creative director's first question, *Is this new photo on-brand?*, is a check instead. The
photo (one of the domain's example photos marked `"batch": "new-work"`, or your own) is embedded
and matched against the looks in the graph's vector index; the 5 nearest looks of the brand's own
lookbook come back, the looks without a `run` (so never a look tab 2 added, which now has an
occasion too), with their garments and their occasion ("no occasion" when a look has none).
A helper model then compares the outfit with those looks piece by piece, and a fixed rule sets the
verdict: only the main pieces count (clothes, outerwear, shoes); none off is on-brand, some off is
partly, more than half off is off-brand.

### The creative director's trends question

The creative director's second question, *What are the emerging trends we see this
season?*, is answered three ways on one page: three numbered method cards, then a **Side by side**
card that compares them. Methods 1 and 2 are agents on an MCP server; method 3 is a map of the
garments' vectors (`web/src/components/lenses/`; `backend/src/ontology_rag/trends.py` for methods 1
and 2, `lakehouse.py` and `lake_agent.py` for method 2, `lenses.py` for method 3;
[docs/emerging-trends.md](emerging-trends.md) has the method notes).

*Emerging* is the same idea in all three: what the new content has more of than what the brand
already had. A group's **lift** is its share of the new over its share of the old, add-half smoothed
and computed in code; above 1.5 counts as emerging. What is counted differs; each card says its
definition in one sentence, and the side-by-side card's caption repeats it:

- Methods 1 and 2 count the pieces of content tab 2 added (one per photo or text, so a photo's two
  shoes count once; items under 0.5 confidence stay out) against all the lookbook's garments (the Item nodes without a `run`).
- Method 3 counts the garments worn in the new looks against the garments of the lookbook's looks.

1. **Method 1 · Ask the graph agent** (Amazon Neptune MCP server). The question in plain words, with
   the definition of emerging and the graph's totals filled in (`trends.AGENT_QUESTION`), goes to the
   query agent of tab 3. It reads the schema and writes its own openCypher, which runs on Neptune
   Analytics through the
   [Amazon Neptune MCP server](https://github.com/awslabs/mcp/tree/main/src/amazon-neptune-mcp-server)
   (read-only: a guard refuses write clauses). The node ids in its rows name the groups, and code
   counts each group again (`groups_from_rows`): the agent's own numbers are shown, never used.
   Only what both sides are described in is compared: components and value families the lookbook
   never uses are left out.

   **Ask the graph agent** starts a background job of up to 5 minutes, longer than one API call may
   take. While it runs, the card shows the job's step and the seconds so far, polled every 2 s.
   The ingest pipeline's function runs the job and calls the query agent's AgentCore Runtime with a
   300 s deadline, in a session of the job's own, so tab 3's agent never waits behind it. Done, the
   card shows the agent's answer, the groups (their properties, in how many new pieces and on how
   many lookbook garments, the lift, the items around them), the trace, *The question it got* (the
   exact prompt) and a metrics line: model, effort, time, turns, tool calls and tokens.
2. **Method 2 · Export to Iceberg, ask the data agent** (Amazon S3 Tables MCP server). **Export the
   graph to Iceberg tables** writes every item and every edge to the vocabulary into two Apache
   Iceberg tables, `items` and `item_features` (`lake_tables.json`), in the sample's own S3 table
   bucket (namespace `brand_graph`), with PyIceberg through the S3 Tables Iceberg REST endpoint (no
   Glue Data Catalog integration, nothing account-wide). The card then lists the tables and their row
   counts.

   **Ask the data agent** is enabled whenever the lakehouse is ready; its title says when the tables
   were last written. It gives the same definition as method 1, written for the tables
   (`trends.LAKE_QUESTION`), to an agent whose one tool is `query_database` of the
   [S3 Tables MCP server](https://github.com/awslabs/mcp/tree/main/src/s3-tables-mcp-server)
   (read-only; Daft SQL over PyIceberg). It writes the SQL and fixes it until it runs; the groups in
   its rows are counted again by method 1's code, so the numbers shown are the tables', whatever SQL
   the agent wrote.
   The agent runs on an AgentCore Runtime of its own (its role reaches the table bucket and the
   models, never the graph), as a background job the browser polls in its own session. Done, the
   card shows the same parts as method 1.
3. **Method 3 · Explore the clouds** (Neptune Analytics vector index and openCypher). **Draw the
   map**: every garment the brand's looks wear comes to the browser with its vector (one byte per
   number). The browser groups them on the full vectors (a graph of each garment's 10 most similar
   ones, then Louvain communities) and lays them out with t-SNE over a density heat map. The table
   under the map lists the clouds by lift, or by size while the graph has no new shoot. A cloud with
   no lookbook garment has no lookbook share to compare with: the smoothing still gives it a lift in
   the hundreds, so the map, the table and the describe prompt say "new shoot only" instead, and
   its bar is full while the other bars scale to the largest lift of the clouds with lookbook
   garments. The ten largest clouds have a colour each; the smaller ones are grey. A lookbook
   garment's vector embeds its name, kind, line and details, a new garment's the name and
   description the pipeline's model wrote (`pipeline.vectors`). So a cloud can mix kinds whose
   descriptions read alike, for example pieces of the same new shoot; the panel's notice says to
   read a cloud's pieces and looks before calling it a trend. Pick a cloud
   and the API walks from its garments to every look that wears one and to what else is worn there
   (the walk is editable openCypher). **Describe the cloud** makes two Converse calls side by side:
   one on the cloud's numbered garments, one on its lettered looks, each claim citing a garment `[3]`
   or a look `[B]`.

   A click on the map picks, measured in pixels: the number badge under the pointer; else the
   nearest garment dot within 14 px (the same reach across and up); else the cloud that dominates
   the heat under the pointer, when the density there is at least 5 % of the map's maximum. A click
   on empty space keeps the selection. With a cloud selected, the other clouds' heat stays visible at
   35 % of its usual opacity, so the next cloud can be picked on the map as well as in the table. The
   badges (clouds of 5 or more garments, and the selected one) are also buttons over the canvas,
   reachable with the keyboard and labeled "Cloud `<n>`: `<size>` garments, lift `<x>`" (or "new shoot
   only"); smaller clouds are picked from the table.
4. **Side by side**: one row per finished run. Methods 1 and 2 keep their latest finished run and the
   one before it, the older row marked "(earlier run)" in the Method cell; method 3 keeps its last
   run only. The columns are Method, Model, Effort, Time, Where the time went (model, tools),
   Model calls, Tool calls, Tokens in, out, cache read, cache write and total (input + output +
   cache read + cache write; the method cards show the same numbers with the same labels), and
   Result. Method 3's row shows the describe model, the effort as "not set", the map,
   walk and describe times added up, 2 model calls and 2 tool calls (the map query and the walk),
   and the tokens of the two describe calls. The caption reads: "Methods 1 and 2 count pieces of
   content against the lookbook's garments; method 3 counts garments in looks against the garments worn
   in the lookbook's looks. No winner: compare the answers."

**The agent trace.** Methods 1 and 2 draw the agent's run as a picture (`AgentTrace` in
`web/src/components/shared/`; tab 3 uses it too, inside its collapsed *What the agent did*):

- a header with the MCP server, its version and transport, where the agent ran (AgentCore Runtime or
  the API process) and the trace id;
- a time bar with one segment per step, placed at the step's start and as long as the step, colored
  by kind (model turn, tool call, guard);
- two lanes, "Model · `<name>` on Amazon Bedrock" and "MCP server · `<server>`", with one box per step
  in order and an arrow to the next. A model turn shows what it asked for (for example
  "→ run_opencypher_query"), its tokens and seconds, its stop reason when it is neither a tool call
  nor the answer (for example `max_tokens`), and the summary of its reasoning when the model returns
  one as text. A tool call shows its query (openCypher or SQL), the rows or the error, and its
  seconds. A guard step sits in the MCP lane and says what it refused and why.

Each box is a button: a click opens its details under the trace (the full query, what went back to
the model, the model's text, the reasoning summary), and a second click or Escape closes them. Under
the trace of a model whose reasoning is not readable, the card says "`<name>` does not return its
reasoning as text."

**The deep dives.** Methods 1 and 2 each have *Deep dive: the agent's model and reasoning effort*,
with **Agent model** (the answer models, `ANSWER_MODEL_IDS`) and **Reasoning effort** (the levels the
chosen model offers). Method 3 has *Deep dive: the model that describes the cloud*, with **Model**
only: describing is two fixed model calls, not an agent loop. Each method remembers its choice in the
browser (local storage). When the newly chosen model does not offer the chosen effort, the method
falls back to that model's Default before anything is sent. Every result names the model and effort
that actually ran, as the backend reports them, and the side-by-side card shows those.

| Model | Reasoning effort offered | Default stands for | Reasoning in the trace |
|---|---|---|---|
| Claude Sonnet 5.5 | Default, Low, Medium, High | High | the summary |
| Claude Opus 5.5 | Default, Low, Medium, High | Medium | the summary |
| Claude Haiku 5.5 | Default, Off, Low, Medium, High | Medium | the summary, none at Off |
| GPT-6.1 Sol | Default, Low, Medium, High | Medium (a label: the model card does not name the level) | not readable (encrypted) |
| GPT-6.1 Terra, GPT-6 Astra | Default, Low, Medium, High | Medium (a label) | not readable (encrypted) |
| Amazon Nova 2 Lite | Default, Low | Off | not readable ("[REDACTED]") |
| Grok 4.7 | Default, Medium | Low (the sample's own setting, sent with every Grok call) | not readable (encrypted) |
| Kimi K3 | none | | |
| Any other model (GPT-5.6 Sol, Nova Pro, Claude Opus 5, Claude Haiku 4.5) | none | | |

The control shows Default with the level it stands for, for example "Default (high)". In place of
the control, Kimi K3 says "Reasoning effort: set by the model. Kimi K3 always reasons at its highest
level through the Converse API, so this agent cannot change it." Any other model without levels says
"Reasoning effort: this sample offers no setting for `<name>`; it runs at the model's own default."

The effort reaches the model in the agent's Converse request, as `additionalModelRequestFields`
merged over the model's own request fields (`vision.with_effort`): for Claude, adaptive `thinking`
with a summarized display, plus `output_config.effort` for Low, Medium and High (`thinking` disabled
for Haiku's Off); for GPT and Grok, `reasoning.effort`; for Nova, `reasoningConfig` with
`maxReasoningEffort`. Default sends nothing extra for GPT and Nova; for Grok 4.7 the model's own
request fields ask for low with every call. The output budget stays 4,096 tokens per turn at every
level, so a turn that thinks too long stops with `max_tokens` in the trace. For Kimi K3 the loop
removes the reasoning blocks of earlier turns before the next request, as its model card asks for
Converse. Tab 3's query agent and every call outside the two agents send no effort, so their
requests are unchanged.

**What survives a tab switch.** Methods 1 and 2 keep their running job or their result, and the
finished run before it for Side by side, for the browser tab (session storage), with the model and
effort: leave tab 6 and come back, and a running
job's poll resumes. Method 3 keeps its map, the cloud picked, its walk and its descriptions, and the
other lenses keep their counts, explanations and photo checks, with the choices behind them
(`shared/kept.ts`). The map is kept without the garments' vectors, which only the layout reads.
When the graph's data changes (a new tab 2 batch), every result in tab 6 is cleared; the choices and
edited queries stay.

**Nothing to count yet.** Before tab 2's first batch, methods 1 and 2 say "Nothing new in the graph
yet: ingest the first batch in tab 2 first." with an **Open tab 2** button. When an agent is not
available, method 1 says "The graph agent is not available: `<reason>`." and method 2 "The lakehouse
is not set up: `<reason>`." Method 3 still draws the map and ranks the clouds by size.

Each method has its **How it works** panel: a numbered diagram, the steps and the code, including
the TypeScript that runs in the browser. Method 1's has three steps: **1** new items against the
lookbook (Neptune Analytics), **2** ask the graph agent (the agent on AgentCore Runtime talks to its
model on Amazon Bedrock, with tools, and to Neptune Analytics through the Neptune MCP server:
openCypher, read-only), **3** count each group again (Lambda). Method 2's has seven: the graph as
rows, overwrite the Iceberg tables, ask the data agent, the S3 Tables MCP server, the plan, validate
and execute, the result counted again. Method 3's has five: every worn garment's vector, the map and
its clouds, the walk, describe the pieces, describe their looks. The prompts are entries of the code
lists, as text: the question each agent gets first in its step (with what its placeholders stand
for), then the agent's system prompt, and method 3's two describe prompts. After an agent run, a ★
entry shows the question exactly as the agent got it, with the graph's numbers filled in.
