# Architecture

This page explains how the deployed stack is put together and why. The README's
[Architecture](../README.md#architecture) section has the short version with a numbered
walk-through of the figure below.

![Architecture of the deployed stack: the browser signs in with Amazon Cognito, loads the site from Amazon CloudFront and calls the Lambda API's function URL with signed requests; in a VPC with two private subnets, the API, the Step Functions ingest pipeline, the two agents on AgentCore Runtime and the GraphLoader reach a private Neptune Analytics graph; Amazon Bedrock, the data bucket, Amazon S3 Vectors and Amazon S3 Tables outside the VPC.](../assets/architecture.png)

[Text version of the diagram](#text-version-of-the-diagram) at the end of this page lists every
resource, route and role in one block.

## Why these choices

* **Neptune Analytics.** Memory-optimized, created in minutes, with a built-in vector index and
  the `neptune.algo.vectors.*` procedures, so vector search and graph traversal run in one engine
  and one query language. Neptune Database would need a separate vector store. The smallest graph
  (16 m-NCU, no replica) is enough for the sample.
* **IAM decides who may call the API.** No API Gateway, no token check in the sample's code. The
  browser signs in to the Cognito user pool (managed login, authorization code with PKCE,
  `oidc-client-ts`), trades the ID token at a Cognito identity pool for temporary credentials of one
  role, signs every request with the AWS SDK's SigV4 signer (`web/src/signing.ts`) and calls the
  API's Lambda function URL directly. The URL's auth type is `AWS_IAM`, and the role may invoke that
  function and nothing else. The requests reach the function through the Lambda service, so its place
  in the stack's private subnets changes nothing for them. API Gateway was ruled out because its
  integrations stop after 29 to 30 s, and the largest vision models take up to 65 s per image.
  The browser learns the ids it needs from `/config.json`, which the stack writes into the site
  bucket at deploy time; the function URL's CORS setting names the site's origin.
* **A NAT gateway, not interface endpoints, for simplicity.** The graph answers only on its private
  endpoint, so the API, the pipeline, the loader and both agents run in two private subnets. They
  reach Amazon S3 through a gateway endpoint, which is free, and Amazon Bedrock and the other AWS
  APIs they call (AgentCore, Neptune Analytics, CloudWatch Logs, Amazon S3 Vectors, Amazon S3
  Tables, Step Functions and Lambda) through one regional NAT gateway. Interface endpoints (AWS
  PrivateLink) would keep those calls off the internet, but they take one endpoint per service, each
  billed in both Availability Zones: eight endpoints cost about $3.80 per day, the NAT gateway about
  $2.40 (us-east-1, November 2026). A new AWS client in the code would also need its own endpoint
  before its calls work. The sample is about ontologies and GraphRAG, not network isolation, so it
  takes the simpler path. The price is that the functions and agents can reach any HTTPS host
  through the NAT gateway ([security.md](security.md#network-and-delivery)). In production, give
  the private subnets interface endpoints for the services they call and no route to the internet,
  or filter their egress by domain name with Amazon Route 53 Resolver DNS Firewall or AWS Network
  Firewall.
* **Deploy-time loading as a custom resource.** The graph is populated when the stack turns green,
  so a 60-minute session explores and mutates a populated graph instead of waiting for extraction.
  The loader fails fast with a reason when it cannot finish before its timeout, so a failed deploy
  rolls back instead of waiting an hour.
* **One way to deploy.** `cdk deploy` builds the Lambda zip, the two agent zips, the ontologies
  folder and the web build into CDK assets in the bootstrap bucket. Every setting a deployer may
  change is a `-c key=value` with a default (`infra/lib/context.ts`), so a CI job deploys the same
  stack with its own values.
* **cdk-nag in the test suite.** The AWS Solutions rules run on the stacks of the app in `npx jest` and
  at `cdk synth`; an unacknowledged finding fails both. Every acknowledgment sits next to its
  resource with a reason (`infra/lib/nag.ts`, the `acknowledge*` helpers).
* **Five steps, read top to bottom.** `classify.py` is the explorer's whole path as five flat
  functions: `load_ontology` (the OWL file and `domain.json`, rdflib), `load_image`, `build_prompt`
  (ontology = system prompt; photo and instruction = user turn), `call_model` (the Converse request
  as a literal) and `check_answer` (`vision.validate` plus the `usage` block as metrics).
  `api.vision_classify` calls them in order; errors are mapped to 400/404/403/502 once, in
  `api.dispatch`.
* **The same request for every provider.** Every model (Anthropic, OpenAI, Amazon, xAI and Moonshot
  AI) gets the same Converse request; only `modelId` changes, plus the per-model fields its
  `vision.ModelInfo` names (`request_fields`, for example Grok's reasoning effort). The vision
  models always run on Bedrock, and the tests hand the service a fake client (`tests/fakes.py`).
* **Each timeout stops before the one around it.** The largest models need 20 to 65 s per image.
  The API function stops after 115 s, and a call it waits for, to a model or to the query agent, gets
  100 s and one attempt (`vision.API_CALL_TIMEOUT_S`), so a slow call ends with the API's own JSON
  error instead of the function's timeout. Only a connection that was closed before any answer
  gets a second attempt (`vision.retry_reset_connection`): the NAT gateway drops a connection that
  has been idle for 350 s, and botocore reuses open connections. The pipeline's steps and the lake
  agent's job wait for no browser: 120 s per model call and up to three attempts. Work that cannot
  fit in one call is a job the browser polls: tab 6's graph agent (trends method 1, up to 300 s) runs in the pipeline
  function, which the API invokes asynchronously. The function stops after 360 s; for the agent it
  waits 5 s + 345 s for the query agent's runtime, which starts no model turn or tool call that
  might not end within the 300 s (`query_agent.py` has the whole chain). Tab 3's query panel keeps the agent's synchronous 70 s.
* **Current-generation models through inference profiles.** `vision.KNOWN_MODELS` offers
  current-generation models only, through `global.` cross-Region inference profiles wherever they
  exist (`us.` for Nova Pro): four third-party families (Anthropic, OpenAI, xAI and Moonshot AI) next
  to the first-party Nova models; `-c visionModelIds=` narrows the list per deployment. `vision.RETIRED_MODELS` makes
  `model_info` refuse superseded ids (Sonnet 4.x, Opus 4.x, Haiku 3.5, GPT-5.4 and 5.5) with their
  replacement.
* **The `bedrock-runtime` endpoint.** It and `bedrock-mantle` run on the same engine at the same
  price, but cross-Region inference is only available on `bedrock-runtime`, which AWS recommends for
  new applications.
* **Ontologies live in the data bucket.** They are data, kept out of the code.
  `ontologies.S3Sync` mirrors the prefix into `/tmp` (one ListObjectsV2 per minute, downloads only changed ETags), so a domain folder
  uploaded to the bucket shows up in tab 0 without a redeploy; the copy bundled in the Lambda zip is
  the fallback when the bucket is unset or unreachable. Of a data set (`<domain>/datasets/<set>/`)
  the mirror and the zip keep only its `README.md`, `domain.json` and examples (the files directly
  in `examples/images/`, `examples/items/` and `examples/articles/`). Only the graph loader mirrors
  its data files (`MIRROR_SAMPLE_DATA=true`), at deploy; the photos of its `media/<sub>/` folders
  stay in the bucket and the API reads one when the app shows it. A large set therefore does not
  lengthen a cold start, and a set reaches the graph only through a deploy from the repository
  folder.
* **A domain is a folder.** `ontologies/<domain>/` holds the ontology, `domain.json` (name, the
  words of the classification instruction, the query agent's worked examples, `browse_only` and
  `start_with`, the noun tab 2 uses), the examples to try in `examples/` (`images/`, `items/`,
  `articles/`) and the data sets loaded at deploy in `datasets/`.
  The browser chooses the domain in tab 0 and the other tabs follow; no domain id is hard-coded in
  the code outside the default `ONTOLOGY_PATH` (`config.DEFAULT_DOMAIN`, the stack's `defaultDomain`).
  A browse-only folder (`beauty/`, `home/`, `food/`) is read in tab 1, step 4 only.
* **One prompt, two retrievals.** RAG and GraphRAG share the catalog, the search and the answer
  prompt (`payoff.ANSWER_SYSTEM`); they differ only in where the guidance comes from. The
  catalog index holds the products, embedded from their text, with no styling knowledge: in
  production this is the retailer's product search (often OpenSearch). RAG's model plans its
  catalog searches from its own taste (`payoff.PLANNER_SYSTEM`); GraphRAG takes what to look for
  from three of the brand's looks, found by walking the graph. Both send their searches through
  the same `payoff.catalog_search`, so the products are real in both answers and only GraphRAG's
  say why they go together.
* **Occasions come from the ontology.** The ontology lists the occasions (`fo:Occasion`, `fo:for`),
  the deploy writes them as nodes, a catalog set's text is matched to them and tab 2's model picks
  one from the prompt's list. The loader, the OWL mapping (`kg.py`) and `ontology.py` take the
  class, the property and the values from the ontology; what is named in code is the data's own
  field (a catalog look's and an example manifest's `occasion`) and the queries that read the graph
  ([graph-model.md](graph-model.md#occasions)).
* **The system explains itself.** Every classify response carries an *invocation* record (request
  id, cold or warm start, memory, log stream) and `GET /api/explorer/architecture` and `/logs` return
  the resource names and the request's own CloudWatch log events (`telemetry.py`, with an
  in-process ring buffer as the fallback). The web app turns this into an interactive diagram with
  console links.
* **Step Functions for the batch, plain functions for the steps.** The ingest pipeline is three
  functions in `pipeline.py` (`classify_source`, `ingest_source`, `summarize`) and one state machine
  (`pipeline.asl.json`, JSONata: a `Map` with `MaxConcurrency` 4, `Retry` with backoff and jitter
  on `RetryableError`, a `Catch` that records the failed source, then the summary). The same file
  is the CDK definition and the first snippet the web panel shows. In the tests, `LocalRunner` runs
  the three functions in a thread pool.
* **The state machine carries names and keys.** It never carries bytes. The run input lists example file names and S3 keys
  (`uploads/<run>/NN.*` for browser uploads); each step reads what it needs from the data bucket. A
  20-source run is a few KB of state. Per-source records (`runs/<run>/NN.json`) and the summary are
  written to S3 by the steps, so `GET /api/pipeline/runs?id=` shows progress during the execution
  and the result after; the API holds no state between polls.
* **Ids derive from content.** An ingested item is `item:<sha256(source)[:8]>-<entity id>-<class>`,
  a photo's look `look:<digest>`, a text's article `article:<digest>`; everything is written with
  `MERGE`, so re-running a batch updates the same looks, articles and items. A vision model can,
  however, read a photo differently the second time, and a renumbered entity is a new item id, so
  `MERGE`-only ingestion is safe to re-run but not a guarantee of zero growth.
* **The query agent calls the unmodified MCP server.** It defines no tools of its own. `query_agent.py` starts the unmodified
  `awslabs.amazon-neptune-mcp-server` as a stdio subprocess, lists its tools and passes them to
  Bedrock Converse as the `toolConfig` unchanged; each `toolUse` goes back as an MCP `tools/call`.
  The loop is capped at 6 tool calls and about 70 s, inside the API's 100 s wait for the agent
  (tab 6's agent job asks for 300 s and 12 tool calls per request, `deadline_s`, checked by the runtime).
  The model only gets `get_graph_schema` and `run_opencypher_query`; a keyword guard refuses writes.
  The system prompt adds the domain's worked examples (`domain.json` `query_examples`, few-shot
  question and query pairs, read-only and capped); deployed, the API sends them with the request,
  because the runtime has no ontology folder.
* **Neptune's error message is read from the server's log.** MCP SDK 2.x withholds a crashed tool's
  text from the result ("Error executing tool …"), so the client launches the server with plain-text
  logging and reads Neptune's message back from its stderr, which is what the model needs to fix the
  query. The lake agent reads Daft's error the same way.
* **The agents run on AgentCore Runtime.** They do not run in the API function. An agent that starts a
  subprocess, runs a model loop for up to 70 s and executes queries a model wrote is a different
  workload from an HTTP API. The API calls `InvokeAgentRuntime`; AgentCore runs the loop and its MCP
  server in a microVM per session, with an execution role that is the agent's only identity. The
  runtime is a code zip of Linux arm64 wheels for Python 3.14, no container image and no ECR
  repository.
* **One session per browser tab.** A tab's next request reaches the same warm microVM and the same
  MCP server, started with the session; the session id is a random UUID the tab chose. Per-session
  values (start time, the Bedrock client) are taken in the handler at request time, because platform
  version V2 restores a snapshot for consistent cold starts.
* **Startup cost moved out of the request.** Starting the MCP server in a new session's microVM took
  17 s on the first deployment (a cold disk), so the server starts when the session starts.
  Because `/var/task` is read-only, the zip ships precompiled CPython 3.14 bytecode (a warm start went from 2.7 s to 0.8 s). A request the agent cannot serve is answered with HTTP 200 and
  `{error, status}`: a non-2xx from the agent would reach the API as a bare `RuntimeClientError`.
* **Observability stays opt-in.** The runtimes' X-Ray trace delivery needs CloudWatch Transaction
  Search, an account-wide switch; the stack leaves it alone and `-c agentTracing=true` enables the
  delivery once it is on. Every function and the state machine write to stack-owned 30-day log
  groups that `cdk destroy` removes. The two runtimes write to the log groups AgentCore creates for
  them (`/aws/bedrock-agentcore/runtimes/<id>-DEFAULT`), which the stack does not own: they stay
  after `cdk destroy` ([deploy.md](deploy.md#cleanup)).

## Backend package (`backend/`)

```
owl.py          rdflib: parse any OWL/RDF → view (classes, properties, individuals) → vocabulary (attribute properties, photo properties and their
                vocabulary classes) → cacheable classification prompt; parse_rdf allowlists the formats, refuses a JSON-LD @context given as a URL
                and an RDF/XML DOCTYPE (nothing is fetched), caps uploads at 1 MB
ontologies.py   the ontologies/ folder: catalog of domains (ttl, domain.json, examples/{images,items,articles}/, the data sets in datasets/), S3 mirror (S3Sync),
                per-request parsing of uploads, DOMAIN_DEFAULTS (browse_only, start_with)
classify.py     the explorer's five steps: load_ontology / load_image / build_prompt / call_model / check_answer; build_text_prompt for texts
vision.py       model registry (current models + superseded ids), bedrock_client / token_metrics / token_usage / request_preview, validate() (entities and
                photo properties) + ontology_feedback(), the classification instruction worded with the domain's subject and scene, extract_json,
                the reasoning effort each model offers to the agents (ModelInfo.reasoning, with_effort)
errors.py       NotReady (the API's 409), aws_error_code / aws_message (what a botocore ClientError, or any other exception, says),
                public_message (what the browser is told: the error code with a fixed phrase for denied and throttled calls, every ARN redacted; the full text goes to the log)
guardrail.py    Amazon Bedrock Guardrails on free-form input, per call (guardContent blocks around the participant's text)
hidden.py       removes Unicode tag characters and lone surrogates from text sent to or read from a model
kg.py           the model's answer → OWL individuals (rdflib) → generic RDF → property-graph rules → MERGE; the vocabulary values' graph form (occasion:<id>)
code_panel.py   the "essential code" snippets of the panels, read from the live source, with their marks; code_panel_nodes.json: the diagram boxes per code set
pipeline.py     the ingest pipeline: classify_source / ingest_source (the graph) / summarize, the occasion of a photo (photo_values),
                blob stores (S3, file, memory), run input/status, StepFunctionsRunner (LocalRunner for the tests)
pipeline.asl.json  the Step Functions state machine (JSONata): deployed by CDK, shown in the web panel
telemetry.py    request-id context + log ring buffer, CloudWatch Logs reader (REPORT line), AWS console deep links
ontology.py     load_ontology: the OWL file → the flat model the loader and the catalog validation use (groups, categories, families, values, the vocabulary
                nodes); resolve_value: a data set's text → a vocabulary value
models.py       the catalog's dataclasses (Item, Look, PairingRule, Article, Statement, ...)
embeddings.py   Nova / Mock, INDEX vs *_RETRIEVAL purposes
loader.py       MERGE ontology (with its vocabulary values) + catalog (each look linked to its occasion), upsert vectors     graph/  store protocol, neptune
                (openCypher), memory (the tests), cypher statements
dna.py          a style DNA export (graph.json, vectors.json, catalog.json) MERGEd at deploy with the vectors it ships, no model call
payoff.py       tabs 4 and 5: the catalog index (index_data_set, catalog_info / catalog_browse / catalog_item / catalog_query, catalog_search), RAG
                (PLANNER_SYSTEM, plan, rag), GraphRAG (find_anchors, TRAVERSAL, traverse, aggregate, graphrag), the smart retriever (understand,
                choose, smart_graphrag), the photo way in (photo_graphrag), LLM only, the three side by side (run); one answer prompt
previews.py     the receipts tree's previews: the photo a node names (a data set's, an example, a tab 2 upload), origins_of for a vocabulary node
look.py         a photo's garments in the graph's vocabulary (no route calls it; test_look.py does)
trends.py       tab 6's trends question, methods 1 and 2: the new items against the catalog (_items), the graph agent's question (AGENT_QUESTION) and its job,
                the data agent's question (LAKE_QUESTION), the groups counted again from the agents' rows (groups_from_rows), lift
lenses.py       tab 6: the personas' counts and the on-brand check (the brand's own looks: those without a run); the trends question's method 3 (the worn
                garments' vectors for the map, the cloud walk, the two describe calls with their tokens)
lakehouse.py    tab 6, trends method 2: the graph as rows of two Iceberg tables (lake_tables.json), the S3 table bucket (boto3), the write (PyIceberg, S3 Tables Iceberg REST);
                the service functions status / require / export / ask / poll the routes call
mcp_agent.py    the Converse tool loop both agents share (tool_loop, Run, agent_result), the stdio MCP server, the subprocess environment, the step records (start, duration, reasoning summary)
lake_agent.py   tab 6, trends method 2: the data agent over the S3 Tables MCP server's query_database (read-only; uvx outside the runtime): its prompt, plan and guard
query_agent.py  tab 3's query agent over the Amazon Neptune MCP server's tools (stdio subprocess, kept per session on AgentCore Runtime), read-only guard, Neptune's error from the server log
agent_runtime.py  both agents as AgentCore Runtime request handlers (validation, the runtime's graph, session info); backend/agentcore/main.py and agentcore-lake/main.py wrap it
jobs.py         background jobs the browser polls (Jobs in a process, FunctionJobs through the pipeline function): tab 6's two trends agents
setup.py        tab 0's What's deployed: status (read-only, every ARN redacted) and check_models (`ontology-rag check-models`, not a route)
config.py       Settings from the environment, DEFAULT_DOMAIN, the model lists, repo_root
service.py      facade used by api.py and the Lambda handlers (Service: the graph, the embedder, the indexes, the domain wording, invoke_runtime for both
                agents, the data sets' load)     api.py   framework-neutral routes and the error mapping
lambda_handler  api / pipeline / loader / auth-setup handlers        network_cleanup.py  the VPC a destroyed stack leaves (`ontology-rag network-cleanup`)
synth.py        deterministic synthetic catalog (AnyCompany Apparel)
cli.py          `ontology-rag`: synth, check-models, network-cleanup
```

Design constraints:

* **Few runtime dependencies.** The Lambda API runs on boto3 and rdflib (with pyparsing), all
  pinned with hashes in `backend/lambda-requirements.txt` and vendored
  into the zip by `infra/lib/bundling.ts` instead of relying on the runtime's own boto3, so there is
  no Docker step.
  The optional `lake` extra adds PyIceberg and PyArrow for the export of tab 6's trends method 2 outside the runtime; deployed,
  that write happens in the lake agent's runtime.
* **Back-end protocol** (`GraphStore`) with an in-memory implementation that mirrors the Neptune
  semantics, so the test suite runs offline and deterministically.
* **Explicit evidence.** RAG and GraphRAG return numbered evidence rows (`n`, `kind`, `label`,
  `text`, `tree_ids`); the model sees the numbered lines and must cite them. The UI renders a
  citation as the product it came from (RAG) or as its path in the receipts tree (GraphRAG).

## Request flows

**Sign-in and the signed request** (IAM decides at the function URL; the API's code checks nothing)
1. the browser loads the site and reads `/config.json` (`web/src/config.ts`), which the stack wrote
   into the site bucket at deploy time: `region`, `userPoolId`, `clientId`, `domain`,
   `identityPoolId`, `apiUrl`
2. `web/src/auth.ts` builds an `oidc-client-ts` `UserManager` from it (authority
   `https://cognito-idp.<region>.amazonaws.com/<pool>`, authorization code with PKCE, scope
   `openid email profile`, tokens in `sessionStorage`) and sends the browser to the managed login
   page; `?code=&state=` on the way back is exchanged for the tokens
3. `web/src/signing.ts` trades the ID token at the identity pool for temporary credentials of the
   signed-in role (`fromCognitoIdentityPool`: GetId, then GetCredentialsForIdentity), kept in memory
   until five minutes before they expire
4. `web/src/api.ts` signs every request with `SignatureV4` (service `lambda`) and sends it to
   `apiUrl`. The function URL (`AWS_IAM`) runs the function only when the signature is valid and the
   role may invoke it; otherwise Lambda answers 403 (`{"Message": ...}` for a missing permission,
   `{"message": ...}` for a bad or expired signature or token) and the app tries once with fresh
   credentials, then signs in again
5. `api.dispatch` routes the request; it reads no token and names no user. The AgentCore
   `runtimeSessionId` is the tab's own random id
6. `Custom::AuthSetup` (`lambda_handler.auth_setup_handler`) runs at deploy time: it reads the
   generated password from the Secrets Manager secret and sets it on the Cognito user as a permanent
   password; the password is never an output or a log line

**The catalog index** (`payoff.py`; filled at deploy only)
1. at deploy, `Service._load_set` calls `payoff.index_data_set` for every data set, after the
   graph: a style DNA set's `catalog.json` goes in as it is (`put_catalog_vectors`, its precomputed
   vectors, the dimension checked first, no model call); a catalog-format set's `items.json` is
   embedded from text (`index_catalog_items`, then `index_catalog`: each product's
   `catalog_text`, embedded with Nova `INDEX`, 6 workers)
2. `PutVectors` 200 at a time, key the product id (a second run overwrites); `index_catalog` writes
   the metadata `product_id`, `name` (`catalog_name`), `category`, `type`, `color`, `image_key` and `text`
   (`name` and `text` are non-filterable: filterable metadata is capped at 2 KB per vector). The
   sample's deploy writes 62 products (AnyCompany Apparel 55, the AnyCompany Fashion House excerpt 7); the loader's result
   reports `catalog` per set
3. nothing else writes the index: tab 2's ingest writes the graph only, and
   `POST /api/admin/clear-graph` empties the graph and leaves the catalog as it is (only with
   `-c allowWriteQueries=true`; otherwise 403)

**Build the retriever, Same question, three answers** (tabs 4 and 5, `payoff.py`; `GET /api/catalog`,
`GET /api/catalog/items?n=`, `GET /api/catalog/item?key=`, `POST /api/catalog/search {query, k?}`,
`POST /api/retriever/llm|plan|rag|anchors|traverse|graphrag|understand|smart`, `GET /api/retriever/templates`,
`POST /api/payoff {question, model_id?, cypher?, searches?, image_base64?}`, `GET /api/ask/models`)
1. stage 1: `catalog_info` reads the index (`GetIndex`) and counts its products (`ListVectors`,
   every page); `catalog_browse` lists a page of products with their metadata (`n` 1 to 50,
   default 12); `catalog_item` reads one record with its vector (`GetVectors`); `catalog_query`
   embeds the text (`QUERY_TEXT`) and runs one `QueryVectors` for the k nearest products (1 to
   20, default 6) with their distances. Without a vector bucket every catalog call is a 409; a
   missing index is a 409 that says the GraphLoader fills it at deploy
2. RAG: `plan` asks the model for 3 to 6 catalog searches from its own taste (`PLANNER_SYSTEM`,
   JSON `{searches, why}`; `clean_searches` keeps at most `MAX_SEARCHES` = 6 of at most
   `MAX_SEARCH_CHARS` = 120 characters). `rag` takes those, or the participant's edited ones, and
   runs `catalog_search`: each search embedded (`QUERY_TEXT`), its `K_PER_SEARCH` = 3 nearest
   products of the kind the search names (its head noun), names de-duplicated, so at most 18
   products. The evidence lines are `[n] Item: <name>. <text>`, and `_answer` writes the cited
   answer with `ANSWER_SYSTEM`, the prompt GraphRAG uses too. Evidence rows `kind: "item"` with
   the search that found them, the distance and the `image_key`; receipts "N catalog items (they
   exist; nothing says they go together)"; `inspect` carries the planner prompt as well
3. GraphRAG, the participant's version: `find_anchors` embeds the question and runs
   `topK.byEmbedding` over the graph's garments (`ANCHOR_CANDIDATES`), the anchors are the garments
   worn in a look within `ANCHOR_BAND` of the closest such garment; `traverse` runs `TRAVERSAL` (from the anchors
   to every look that `CONTAINS` them, its `FOR` occasion, the other garments with their category
   and attributes; read-only, an edited query checked by `clean_cypher`); `aggregate` counts it per
   kind of garment; `graphrag` turns the occasions and the "worn with" counts into style patterns,
   features three of the looks, matches up to four of their pieces (one per kind, `LOOK_PIECES`) to
   one product each with `catalog_search` on the catalog index (a piece with no hit stays
   unmatched) and answers with `ANSWER_SYSTEM`. The response carries the evidence, the
   featured looks and the receipts tree
4. the smart retriever (`smart_graphrag`, stage 6 and tab 5): `understand` (one model call: the
   start pieces, what is looked for, the words that must match), `choose` (one model call per start
   piece: the closest garments graded exact, similar or no), then the same traversal with a filter
   that keeps only the kind looked for. With a photo (`photo_graphrag`) the photo's embedding is
   the way in, the traversal is the same, and `understand` gives only what is looked for
5. `POST /api/payoff` → `payoff.run`: LLM only, RAG (the participant's edited `searches` when
   given, else the planner's; with a photo, the planner and the answer see it) and GraphRAG (the
   smart retriever; the photo's with a photo; the simple one with a participant's `cypher`) in
   three threads, with one answer model (`ANSWER_MODEL_IDS`, default `LLM_MODEL_ID`). Only
   GraphRAG embeds the photo, for its way in
6. `GET /api/graph/source?id=<node>&domain=<ontology>&near=` (`previews.py`): what the receipts
   tree shows next to a box. The node is read from the graph, and only the photo its `image_key`
   names is read: a data set's photo (`<set>/<sub>/<file>`, in the set's `media/<sub>/`), an
   example photo of the domain's or a set's `examples/images/` (`example:<file>`) or a tab 2
   upload of the run's folder (`upload:uploads/<run>/<nn>`, shape-checked); otherwise the preview
   is what the graph holds (a description, a statement's text). A photo over 3 MB is left out with
   a note (the Lambda response limit). A Category, Attribute
   or Line has no photo of its own, so `origins_of` walks to where it was seen: the items, looks and
   articles that link to it (IS_CATEGORY, HAS_PART, HAS_ATTRIBUTE, FROM_LINE) and the articles whose
   statements ILLUSTRATE those items, at most 8 photos read per request. The tree's own nodes come
   first (`near`, closest first), then what tab 2 ingested, and one photo shows once with every node
   seen in it. `GET /api/photo?key=<set>/<sub>/<file>` reads one data set photo by its key

**Emerging trends** (tab 6, the creative director's trends question: `trends.py`, `lakehouse.py`,
`lenses.py`, `web/src/components/lenses/`). Lift =
`((n_new + 0.5) / (N_new + 1)) / ((n_base + 0.5) / (N_base + 1))`, computed in code for every
method; methods 1 and 2 count tab 2's pieces of content against the catalog's items, method 3 the
garments worn in new looks against the lookbook's:
1. The deep dives: `GET /api/ask/models` lists every answer model with `reasoning` (`levels`,
   `default_means`, `readable`, `family`; `null` for a model without a setting) and
   `reasoning_note` (the sentence shown in place of the control, for example Kimi K3's).
   `vision.with_effort(model, effort)` checks the id against `levels` and returns the model with
   its family's fields merged over `request_fields` and `effort` set; `with_effort(model, None)` is
   the model unchanged, so tab 3's query agent and every call outside the two agents send what they
   sent before. The merged fields reach only the agents' `plan`, as `additionalModelRequestFields`;
   `maxTokens` stays at most 4,096 for every level. A level the model does not offer is a 400
   (`effort 'xhigh' is not offered for Claude Sonnet 5.5: default, low, medium, high`), and so is
   any effort for a model without levels
2. Method 1: `POST /api/trends/graph {model_id, effort}` → `trends._items`: every Item, its
   `IS_CATEGORY` / `HAS_ATTRIBUTE` targets in one round trip (`store.neighbor_ids`), only the
   dimensions the catalog uses, new items under 0.5 confidence out; then a job (`trends.graph_start`:
   the agent, the model, the effort and the new items checked, 409 when there are none; the id
   `graph-<32 hex>` returned at once; `GET /api/trends/graph?id=` polls it, every 2 s from the
   browser) that sends `agent_question` to `Service.query_agent` with `deadline_s` 300, in a runtime
   session of its own (`trends-<job id>`), with `effort` next to `model_id` in the payload
   (`agent_runtime._validate` resolves it again in the runtime and answers a refused level with its
   usual 400). Deployed, the API writes the record to `jobs/trends/<id>.json` in the data bucket
   (kept a day) and invokes the pipeline function with `InvocationType Event` (`jobs.FunctionJobs`;
   IAM: `lambda:InvokeFunction` on that one function), which runs step `trends_graph` (IAM:
   `bedrock-agentcore:InvokeAgentRuntime` on the query agent's runtime only); without a pipeline
   function (the tests) a thread of the API process runs it. The node ids in the agent's rows name the groups, and `_group` counts
   each one again (pieces of content by `source`, adjacent items and properties). A `mode` other
   than `agent` is a 400: the October tested query and the explain call are gone, and the vector
   method's routes (`GET /api/trends/vectors`, `POST /api/trends/describe`, `/api/trends/decompose`,
   `POST /api/trends/explain`) answer 404
3. Method 2, the export: `POST /api/trends/lake/export` → `lakehouse.export` → `lakehouse.rows` (every Item, its
   `IS_CATEGORY` / `HAS_ATTRIBUTE` / `HAS_PART` targets, three `neighbor_ids` round trips) → without
   a lake runtime (the tests) `lakehouse.write` (PyIceberg REST catalog on `https://s3tables.<region>.amazonaws.com/iceberg`,
   SigV4 `s3tables`, warehouse = the table bucket ARN; `overwrite` per table), deployed
   `Service.invoke_runtime` on the lake agent `{task: export, tables}` (checked against
   `lake_tables.json`, then the same write)
4. Method 2, the question: `POST /api/trends/lake/ask {model_id, session_id, effort}` →
   `trends.lake_question` (method 1's definition for the tables) → `lakehouse.ask`: a background job
   (`jobs.Jobs`: in the lake agent's microVM as `{task: ask, effort}`, in the API process without a
   runtime, then
   `GET …/lake/ask?id=&session_id=` → `lakehouse.poll` → `{task: poll}` in the same session). `lake_agent.run` starts
   the S3 Tables MCP server read-only (runtime: `python -c LAUNCH` from the zip, kept per session;
   outside the runtime `uvx --overrides lake_overrides.txt --from awslabs.s3-tables-mcp-server==0.1.1`) and runs
   `mcp_agent.tool_loop`, which offers `query_database` with only `query`, fills in warehouse / namespace / uri, guards for one
   read-only SELECT and reads Daft's error from the server's log. Once done, `trends.lake_poll`
   counts the groups in its rows again (`groups_from_rows`, the same code as method 1)
5. Both agents' results (`mcp_agent.agent_result`) carry `effort` (the id the request was built
   with, or `null`), and every step `at_ms` (milliseconds from the run's start) next to its `ms`.
   A model step keeps its text, stop reason and tokens, and adds `reasoning` (the turn's reasoning
   summary, at most 1,500 characters, only from a model whose reasoning is readable: Claude) or
   `redacted: true` (an encrypted or placeholder reasoning block). For a model with
   `ModelInfo.strip_reasoning_history` (Kimi K3) the loop removes `reasoningContent` blocks from an
   assistant turn before it appends it; every other model's turn goes back unchanged. The browser
   draws the steps with `AgentTrace` (`web/src/components/shared/`) and keeps each method's job or
   result in session storage (`lens.trends.v1`), cleared when the graph's data changes
6. Method 3: `GET /api/lenses/trends/map` → `lenses.trends_map`: every garment a look wears, its
   vector as int8 (scaled to its largest component) and whether it is new. In the browser
   (`cluster.ts`, `embed2d.ts`, `trendsMap.ts`, unit-tested): L2-normalize, cosine 10-nearest-neighbor
   graph, Louvain, per-cloud lift; PCA → exact t-SNE; Gaussian KDE heat; `pickAt` decides a click
   in pixels (a badge, the nearest dot within 14 px, the dominant cloud of a heat cell above 5 % of
   the maximum, else nothing). `POST /api/lenses/trends/cloud` walks from the cloud's garments to
   their looks and what is worn there (`CLOUD_WALK`, or the participant's edit). `POST
   /api/lenses/trends/describe {ids, cypher?, model_id?}` walks again, counts the lift
   (`season_totals`, `trends_lift`) and makes two Converse calls in parallel (`describe_items`,
   `describe_looks`, through `payoff._converse`) with the model method 3's deep dive chose; the
   result carries `tokens` (`input`, `output`, `cache_read`, `cache_write`) per finding and in
   total, which the side-by-side card adds up

![The ingest pipeline: the browser sends sources to the Lambda API, which stores the uploads in Amazon S3 and starts a Step Functions execution. A Map state runs classify and ingest for each source, four at a time; classify calls Amazon Bedrock, ingest embeds and MERGEs into Neptune Analytics; a summarize step closes the run. The browser polls the API every 2 seconds.](../assets/ingest-pipeline.png)

**Ingest pipeline** (`POST /api/pipeline/runs`, `GET /api/pipeline/runs[?id=]`,
`GET /api/pipeline/graph?id=`, `GET /api/ontologies/articles|article`)
1. the route normalizes the sources (example photos and texts by file name, uploads as bytes or
   text) and `pipeline.start_run` stores the uploads under `uploads/<run>/`, writes `run.json`
   (ontology, model, caching, line, the source list, node counts *before*) and hands the run to the
   runner: `StartExecution` with the run as input and the run id as execution name (in the tests,
   a thread of `LocalRunner`)
2. `classify_source` (step 1, once per source, up to 4 in parallel): the ontology as the system
   prompt (cached for the models that take a cache checkpoint), the photo (`image` block + `vision.user_instruction`) or the text (`text` block +
   `vision.text_instruction`, `bbox` null) as the user turn, one Converse call with the same request
   shape as the explorer's `/api/vision/classify`, then `classify.check_answer` validates the answer
   against the ontology; throttling becomes `RetryableError` for the state machine's `Retry`, anything
   else an error record for that source
3. `ingest_source` (step 2), through OWL (`kg.py`): `to_owl` expresses every validated entity whose
   class is a leaf class as an individual of the ontology's KG schema (`fo:Item` with
   `fo:isCategory`, the attribute properties and `fo:hasPart`), a photo as an `fo:Look` that
   `fo:contains` the items, a text as an `fo:Article` whose `fo:Statement` `fo:illustrates` them.
   `to_property_graph` maps that RDF graph onto nodes and edges by four generic rules (`rdf:type`
   becomes the label, a literal a property, an IRI an edge named after the top super-property, an
   ontology term a shared vocabulary node keyed by `fo:conceptId`), and `write` MERGEs them, nodes
   first, so the edges always find their ends.

   Vectors: the photo for a look, the text for a statement, name + description for an item. A
   photo's look gets its occasion before `to_owl` (`pipeline.photo_values`: the example's manifest,
   else the model's validated `photo_properties`, else none) and `kg.add_look` writes it as
   `look fo:for fo:occasion_x`. Entities the ontology cannot name are listed under `skipped`; the
   record, with the individuals as Turtle, goes to `runs/<run>/NN.json`. The ingest writes the
   graph only: the pipeline function has no S3 Vectors access
4. `summarize` (step 3, once): sources ingested / failed, what was added, the vocabulary nodes
   referenced by more than one item (*what the sources share*), ontology feedback merged across
   sources, token totals, node counts *after* → `runs/<run>/summary.json`
5. `GET /api/pipeline/runs?id=` returns the run input, the orchestrator's status
   (`DescribeExecution`, or `LocalRunner`'s in the tests), every record written so far and the summary once
   it exists; the browser polls it every 2 s. `GET /api/pipeline/graph?id=&hops=1|2` is `explore`
   around the ids the run wrote (its items, look/article/statement) so the tab can draw the new
   nodes with the vocabulary they use (1 hop) or plus the catalog items sharing it (2 hops)
The tests run all of it without AWS: a fake `bedrock-runtime` client answers in the Converse shape
and `MemoryBlobStore` stands in for S3.

**Ontology explorer** (`GET /api/ontologies[/detail|/examples|/example-image|/articles|/article]`,
`POST /api/ontologies/parse`, `GET /api/vision/models`, `POST /api/vision/classify`,
`GET /api/explorer/code|architecture|logs`)
0. `GET /api/ontologies` lists the domain folders (`ontologies/<domain>/<domain>.ttl` with
   `domain.json` and `examples/`) as `{"ontologies": [summary, ...], "default": "<id>"}`; `default`
   is the domain whose ontology the graph is loaded with, and every summary carries the folder's
   `domain.json` under `domain` (name, description, `browse_only`, `start_with`, subject, scene,
   example questions, photo questions, `persona`, `noun`, `labels`, `query_examples`) and the
   names of its data sets under `data_sets` (the folders of `datasets/`). Tab 0's Domain card
   renders the list without the browse-only domains, which tab 1 step 4 reads with
   `/detail`; the browser remembers the choice and the other tabs read that domain's examples
   through `/examples` and `/articles` (`/examples` and `/example-image` take `set=images`, the
   whole photos and the default, or `set=items`, the single pieces of `examples/items/` tab 5
   offers; any other set is a 400). `noun` is tab 2's word for what the graph holds; the question
   lists, `persona` and `labels` are returned and read by no tab
1. the ontology (a domain folder or an uploaded document) is parsed with rdflib into a plain graph
   view; a class with named individuals is a *value class*, every other visible class an *entity class*
2. `classification_prompt()` renders entity classes, relations and attribute properties with their
   allowed values, then *The whole photo* (each photo property with its values and their
   definitions, only for an ontology that has one: fashion's `for`), then the *ontology feedback* ask (report what you cannot express and how you
   would extend the ontology, as structured `ontology_feedback` items) and the output shape. The
   text is deterministic, so it can be the cached prefix
3. one `bedrock-runtime` Converse call per selected model, made directly in the route. The user turn
   is the image plus a short instruction worded with the domain's `subject` and `scene` from
   `domain.json` ("Classify every garment, accessory and garment component visible in this image
   using the ontology"; an uploaded ontology gets the neutral "entity and component"); `cachePoint`
   after the system prompt for the models that take one (Claude, Amazon Nova, and GPT-6 and later;
   `ModelInfo.explicit_cache`). Tab 1 always asks for caching; the pipeline has a switch
4. `validate()` resolves every class / property / value back to ontology IRIs, checks the domain of
   each attribute property against the entity's class, checks each photo property's value against
   its range (`photo_properties`, `photo_property_iris`), and lists everything that does not map;
   `ontology_feedback()` tidies the model's proposals (kind, entity, at most 8) and flags the names
   a proposal wants to add that the ontology already has: such a proposal means the model did not find
   the name
5. the output budget is per model (`ModelInfo.max_tokens`: 8,192 by default so reasoning models
   finish; 5,000 for Amazon Nova, its hard cap)
6. the response carries entities with 0-1000 bounding boxes, the feedback items, the raw text, the
   exact request, the `usage` block and derived metrics (latency, uncached / cache-read /
   cache-write tokens, hit ratio)
The browser caches each (ontology, image, model, caching) result until the user clears it.

**Ontology drawing** (`web/src/components/studio/treeLayout.ts`, pure geometry, unit-tested)
- a top-down tidy tree: the root classes side by side on the top row, every `subClassOf` level one
  row lower; a class whose children have children spreads them on the next row and sits centered
  above them, each subtree in its own vertical band so subtrees never collide
- leaf children (values included) are stacked in a column under their parent, hanging off a rail
  (an org-chart layout that keeps the tree narrow); very long columns wrap
- connectors are orthogonal elbows (down to a bus, across and down, or a rail with a tick), so tree
  lines never cross each other or a label; object properties and multiple inheritance are the only
  lines that may cross, drawn as dashed curves only when switched on or touching a selected node
- the depth slider, the layer switches and the highlighted concepts (attached to their nearest
  visible ancestor when the filters hide them) are inputs of the layout, so every state is
  deterministic and the tests can assert on it (`treeLayout.test.ts`: no box overlaps, no crossing
  or label-piercing connector in every filter combination, a legible first view)
- rendering is a canvas (react-force-graph-2d with the simulation switched off: fixed positions,
  custom node/link painters); labels are drawn in graph units so they scale with the zoom

**Run tree** (tab 2, `web/src/components/pipeline/runTreeLayout.ts`, pure geometry, unit-tested on a
real six-source run): the same rules, applied to what one ingest run wrote, read back with
`GET /api/pipeline/graph?id=<run>&hops=1|2`
- one tree per source, side by side and wrapping into rows as wide as the panel: `Article
  -HAS_STATEMENT-> Statement -ILLUSTRATES-> Item`, `Look -CONTAINS-> Item`; garments of one row on
  one level
- under each Item, a column off a rail: sections `IS_CATEGORY`, `HAS_PART`, `HAS_ATTRIBUTE`; a node
  several garments use is drawn under each (a tree has no shared children) with a `×N` badge, and
  the renderer lights up every copy when one is selected; two hops out, `+N` counts the other items
  on the node and a dashed section lists the three catalog items sharing the most vocabulary
- depth is an input of the layout: `depth` cuts every tree at a tier (`DEPTH_STOPS`: sources,
  statements, garments, categories / components / values, closest catalog items) and `open`
  unfolds single boxes below the cut; a box with cut children carries a `+N` control, a hidden node
  is mapped to the box it is folded into (highlights land there), and the counts above the tree stay
  those of the whole run
- a source with more garments than fit the row puts them in tiers, the lower ones reached by a spine
  down the left edge of the source's band; tidy-tree bands still guarantee no overlaps and no
  crossings (`runTreeLayout.test.ts` checks boxes, labels, crossings and lines through boxes)
- rendering is plain SVG with the camera the web of tab 3 also uses (`web/src/components/tree/`):
  the wheel scrolls until an edge is reached, Ctrl/⌘ + wheel zooms, drag pans, Fit
"Run all models" fires every request at once (`Promise.all`); the Lambda scales out, so wall time is
the slowest model's time.

**Architecture panel** (`GET /api/explorer/architecture`, `GET /api/explorer/logs?request_id=`)
1. `architecture()` reports where the API runs (Lambda function name, memory, log group from the
   runtime environment; `local` outside Lambda, as in the tests), where the ontologies come from
   (S3 location + sync state, or the bundled folder), the enabled models, and console deep links
2. `dispatch()` attaches the handler's *invocation* record to classify responses; the request id is
   also set in a `contextvars` variable so every log line written during the request is tagged
3. `logs(request_id)` (only with `-c explorerLogs=true`; otherwise the route says 404 and the panel
   says log access is off) filters the function's own log group by the quoted request id (Lambda prefixes
   START/END/REPORT and every `logging` record with it), parses the `REPORT` line into duration /
   billed duration / memory, and falls back to the in-process ring buffer when CloudWatch has not
   delivered yet or cannot be read. The browser polls a few times until the REPORT line lands.
4. `explorer_code()` serves the real functions (`inspect.getsource`) with *highlights*: `CODE_MARKS`
   names, per snippet, the lines worth looking at by a literal pattern (kind · start · end · note),
   and `resolve_marks` turns them into line ranges on the live source. A mark that no longer matches
   is dropped rather than misplaced, and `test_code_panel_marks_resolve_on_the_live_source` fails so
   the note is fixed with the code. `code_panel_nodes.json` lists, per code set, the boxes of the
   diagram that shows it; the web test `arch/nodeIds.test.ts` reads the same file.

   Every tab's "How it works" panel is one component, `web/src/components/arch/ArchitectureDiagram.tsx`:
   a tab describes its panel as data (a `Def`: the steps, their texts, the geometry of the nodes and
   edges, the legend) and the component draws the React Flow diagram, owns the selection and shows
   the API's snippets for the panel's code set. `web/src/components/shared/` holds what the tabs
   share besides the panel: the model catalog and its select, the remembered choices, the ticker.

   The browser renders snippets with prism-react-renderer (Night Owl theme) and adds two items of
   its own. Under the `owl.classification_prompt` snippet, a nested *rendered prompt* item shows the
   function's output for the ontology selected in the toolbar (`detail.prompt` from
   `GET /api/ontologies/detail`, so it works before any model call) laid out for reading:
   `arch/promptText.ts` parses the `## ` sections and `- ` bullets the function writes back into a class
   tree, relations, attribute properties with value chips, the photo properties with their values
   and definitions, the feedback ask and the indented output shape, and `arch/PromptView.tsx`
   renders it with a raw-text switch.

   Once a model has answered, the tab marked with a star (`promptSnippet()`) builds from the latest
   call the system prompt, user turn and Converse request, marked the same way (ontology sections,
   cache checkpoint, image block, model id, inference config). `PromptView` is also the *System
   prompt* tab of the results panel.

## Extending

* New domain: add `ontologies/<domain>/` with `<domain>.ttl`, `domain.json` and examples in
  `examples/images/` and `examples/articles/` (see `ontologies/README.md`); it appears in tab 0,
  tabs 1 and 2 classify against it, and its `domain.json` words the classification instruction
  (`subject`, `scene`) and the query agent's worked examples; with `"browse_only": true` it shows
  in tab 1, step 4 only. To load a different catalog into the graph, add it as a data set folder under `datasets/` of the graph's
  domain (`ONTOLOGY_PATH`). No setting picks a set; the loader takes every folder under the domain's
  `datasets/` (`ontologies/fashion/datasets/README.md`).
* Agentic access: expose the `Service` methods as tools (for example an MCP server) so an agent can
  decide when to traverse; the graph store already returns structured evidence.
* Scale: for catalogs beyond a few hundred thousand nodes, batch-load with `neptune.load` from S3
  (CSV with an `embedding:vector` column) instead of `MERGE` statements.

## Related AWS open source

The sample builds its graph from an ontology and walks it with its own code, so it uses no GraphRAG
library. These AWS projects cover neighboring cases:

* [GraphRAG Toolkit: lexical graph](https://github.com/awslabs/graphrag-toolkit/tree/main/lexical-graph)
  builds a graph from documents without a schema (chunks, statements, topics, facts and entities) in
  Neptune and a vector store. Use it when you have documents but no ontology.
* [GraphRAG Toolkit: BYOKG-RAG](https://github.com/awslabs/graphrag-toolkit/tree/main/byokg-rag)
  answers questions over a knowledge graph you already have, with agentic, scoring, path and query
  retrievers on Neptune Analytics. Tab 3's query agent borrows its few-shot query examples. Its
  dependencies include PyTorch, so plan for a container image rather than a Lambda package.
* [Unified Knowledge Graph RAG on AWS](https://github.com/awslabs/unified-kg-rag-on-aws)
  reimplements Microsoft GraphRAG and LightRAG on Neptune and Amazon OpenSearch Service for large,
  multilingual document collections. It answers questions about a whole corpus that need community
  summaries, which this sample's local walk does not answer.
* [Amazon Bedrock Knowledge Bases GraphRAG](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-build-graphs.html)
  is the managed option. It extracts entities and relationships from your documents into Neptune
  Analytics without graph modeling on your side.
* [nx-neptune](https://github.com/awslabs/nx-neptune) projects data lake tables (S3 Tables,
  S3 Vectors and other sources) into Neptune Analytics to run graph algorithms on them. That is the
  opposite direction of tab 6's export from the graph to Iceberg.
* The two agents use the [Amazon Neptune MCP server](https://github.com/awslabs/mcp/tree/main/src/amazon-neptune-mcp-server)
  and the [Amazon S3 Tables MCP server](https://github.com/awslabs/mcp/tree/main/src/s3-tables-mcp-server)
  as published.

## Text version of the diagram

```
Browser ──HTTPS──▶ CloudFront distribution  (response headers policy: CSP, HSTS, nosniff, DENY framing unless -c frameAncestors= names origins; standard logs → logs bucket)
   │                └── /            → S3 site bucket (web/dist and /config.json, origin access control)
   ├──code + PKCE──▶ Amazon Cognito user pool  (managed login; one user, password in a Secrets Manager secret)
   ├──ID token────▶ Amazon Cognito identity pool  (no guest identities, no classic flow) → temporary credentials of the
   │                signed-in role: lambda:InvokeFunctionUrl + lambda:InvokeFunction on the API function, nothing else
   └──SigV4──────▶ Lambda function URL  (AuthType AWS_IAM; CORS: the site's origin, GET and POST, no cookies)
                                          │  ontology_rag.lambda_handler.api_handler  (reads no token: IAM let the request through)
                                          ├── Amazon Neptune Analytics graph  (openCypher, vector index 1024-d)
                                          ├── Amazon S3 Vectors bucket, one index (1024-d, cosine): catalog (the products, filled at deploy;
                                          │                           RAG's searches and GraphRAG's looks' pieces go through it, tabs 4 and 5)
                                          ├── Amazon S3 data bucket  (ontologies/<domain>/<domain>.ttl + domain.json + examples/ + datasets/<set>/,
                                          │                           mirrored to /tmp (a data set's data files and media left out), re-listed every 60 s;
                                          │                           uploads/<run>/ and runs/<run>/ for the ingest pipeline;
                                          │                           jobs/trends/<id>.json: tab 6's graph agent jobs (trends method 1))
                                          ├── Amazon CloudWatch Logs  (its own log group, read back per request id for the architecture panel)
                                          ├── AWS Step Functions  (ingest pipeline: StartExecution / DescribeExecution; logged and traced)
                                          │     └── Lambda  ontology_rag.lambda_handler.pipeline_handler  (classify · ingest · summarize)
                                          │           ├── Amazon Bedrock (Converse: the vision model; InvokeModel: Nova embeddings)
                                          │           ├── Amazon Neptune Analytics (MERGE)  and  Amazon S3 (one record per source)
                                          │           └── tab 6's graph agent job (trends method 1), invoked by the API: InvokeAgentRuntime
                                          │                 on the query agent, deadline 300 s, a session per job; the function's 360 s
                                          ├── Amazon Bedrock AgentCore Runtime  (tab 3's query agent: InvokeAgentRuntime, one session per browser tab,
                                          │     │                                 the tab's random session id;
                                          │     │                                 tab 6's graph agent job: from the pipeline function, a session of its own)
                                          │     └── microVM per session: main.py (AgentCore SDK, Python 3.14 arm64, opentelemetry-instrument)
                                          │           ├── query agent loop  (Bedrock Converse with the MCP tools)
                                          │           └── Amazon Neptune MCP server  (stdio subprocess, started with the session)
                                          │                 └── Amazon Neptune Analytics  (ExecuteQuery; execution role: ReadDataViaQuery only)
                                          ├── Amazon Bedrock AgentCore Runtime  (tab 6's lake agent, trends method 2: export · ask · poll, in the browser tab's session)
                                          │     └── microVM per session: main.py (AgentCore SDK, Python 3.14 arm64, PyIceberg, PyArrow, Daft)
                                          │           ├── export: PyIceberg overwrite of items + item_features
                                          │           ├── data agent loop  (a background job: Bedrock Converse with query_database)
                                          │           └── S3 Tables MCP server  (stdio subprocess, read-only, kept for the session)
                                          │                 └── Amazon S3 Tables  (Iceberg REST endpoint; execution role: the sample's table bucket only)
                                          ├── Amazon S3 Tables  (GetTable only: when the tables were last written)
                                          └── Amazon Bedrock (Converse API)
                                               ├── amazon.nova-2-multimodal-embeddings-v1:0  (text + image embeddings)
                                               ├── Claude Sonnet 5.5 via global inference profile (default answer model)
                                               ├── the answers (tabs 0, 4, 5, 6) and the agents: the answer models in ANSWER_MODEL_IDS
                                               └── Ontology explorer / ingest pipeline: any vision model in VISION_MODEL_IDS
                                                   (Claude Sonnet 5.5 / Opus 5.5 / Haiku 5.5, GPT-6.1 Sol / Terra, GPT-6 Astra, Nova 2 Lite, Grok 4.7, Kimi K3)

Roles: each of the four Lambda functions of the sample (API, pipeline, GraphLoader, AuthSetup) has a
role of its own that writes to its own 30-day log group; the Bedrock statements name the configured inference profiles.
The API may invoke the two runtimes and describe the executions of its state machine; the pipeline function may invoke
the query agent's runtime only (tab 6's graph agent job). The query agent's role may call
Bedrock InvokeModel and read the graph, the lake agent's may reach the table bucket and the models, never the graph.
Both runtimes log to the groups the service creates, /aws/bedrock-agentcore/runtimes/<id>-DEFAULT (outside the stack); ADOT
(opentelemetry-instrument) sends the agents' spans to CloudWatch once Transaction Search is enabled.

Logs bucket: CloudFront standard logs under cloudfront/, S3 server access logs of the site bucket under site/ and of
the data bucket under data/, all expiring after 30 days.

Deploy time: the ontologies/ folder is uploaded to the data bucket and the web build to the site bucket
(BucketDeployment, from CDK assets); then Custom::GraphLoader (Lambda) reads from the bucket and loads the ontology and
every data set of the graph's domain into the graph (catalog-format sets with embeddings computed at deploy, style-DNA
sets as exported, no model call) and the sets' products into the catalog index (S3 Vectors); Custom::AuthSetup
(Lambda) sets the generated password on the Cognito user.
```
