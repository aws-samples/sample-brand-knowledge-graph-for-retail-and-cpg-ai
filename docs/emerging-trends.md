# Emerging trends (tab 6, the creative director): method notes and measurements

Tab 6's creative director asks *What are the emerging trends we see this season?* The page
answers it three ways: **1** a graph agent on the Amazon Neptune MCP server, **2** a data agent on
an Iceberg export of the graph in Amazon S3 Tables, and **3** a map of the worn garments' vectors
walked in the graph. This page compares the three with how the field does it (as of October 2026), lists the
design decisions, documents the reasoning-effort settings of the agents and records the
measurements. Sources are linked inline. Method 2 uses option A of the last section.

## What "emerging" means here

The field separates *popular* from *emerging*: the biggest cluster is usually the established style.
Every serious method measures change against a baseline: a topic's share now against its share
before ([BERTopic topics over time](https://maartengr.github.io/BERTopic/getting_started/topicsovertime/topicsovertime.html)),
a burst in a stream's rate ([Kleinberg, KDD 2002](https://dl.acm.org/doi/10.1145/775047.775061)), a
residual over a fitted trend ([GeoStyle, ICCV 2019](https://arxiv.org/abs/1908.11412)).

In this sample the stream is **the new content**, what tab 2 ingests (`run` set on its nodes), and
the baseline is what the brand already had. A group's **lift** is its share of the new divided by its
share of the baseline, add-half smoothed:
`((n_new + 0.5) / (N_new + 1)) / ((n_base + 0.5) / (N_base + 1))`. It is computed in code; the
models only explain numbers they are given. The methods count different things, and each card
says which:

| | methods 1 and 2 (`trends.py`) | method 3 (`lenses.py`) |
|---|---|---|
| new | the pieces of content tab 2 added (one per photo or text), items under 0.5 confidence left out | the garments worn in the new looks |
| baseline | every catalog item | every other garment worn in a look of the lookbook |
| what is grouped | the vocabulary the items link to (`IS_CATEGORY`, `HAS_ATTRIBUTE`) in the dimensions the catalog uses | the garments' vectors from the graph's vector index, as clouds |

A text that tab 2 ingests links its items to a statement, not to a look, so methods 1 and 2 count
it and method 3 does not. One definition for all three is an open choice.

## The state of the art, in four families

| Family | Representative work | Core idea | Emergence |
|---|---|---|---|
| Embedding clusters | [BERTopic](https://arxiv.org/abs/2203.05794) (2022), [Clio](https://arxiv.org/abs/2412.13678) (2024), [TopicGPT](https://arxiv.org/abs/2311.01449) (2024), [LLooM](https://arxiv.org/abs/2404.12259) (CHI 2024) | embed, cluster in the full space, label with c-TF-IDF or an LLM; 2-D maps ([UMAP](https://arxiv.org/abs/1802.03426), [Nomic Atlas](https://docs.nomic.ai/atlas/capabilities/data-interface), [Embedding Atlas](https://arxiv.org/abs/2505.06386)) to navigate and lasso | share per time window, afterwards |
| Controlled attribute vocabulary | [Fashion Forward](https://arxiv.org/abs/1705.06394) (ICCV 2017), [GeoStyle](https://arxiv.org/abs/1908.11412) (ICCV 2019), [KERN](https://arxiv.org/abs/2005.03297) (ICMR 2020), VLM attribute extraction ([2024](https://arxiv.org/abs/2405.17533)) | decompose images and text into a fixed set of attributes, then count attributes and their combinations over time | attribute share and forecast |
| Graphs | [GraphRAG](https://arxiv.org/abs/2404.16130) (2024), [LightRAG](https://arxiv.org/abs/2410.05779) (2024), Louvain / [Leiden](https://www.nature.com/articles/s41598-019-41695-z), [FP-Growth](https://dl.acm.org/doi/abs/10.1145/342009.335372) association rules | communities and co-occurring properties, summarized by an LLM | support / lift between windows |
| Tables + agents | text-to-SQL over a lakehouse ([BIRD](https://arxiv.org/abs/2305.03111), [Spider 2.0](https://arxiv.org/abs/2411.07763)) | an agent writes SQL over documented tables | SQL aggregates over time windows |

Known pitfalls ([misreading t-SNE](https://distill.pub/2016/misread-tsne),
[2-D embeddings distort](https://pmc.ncbi.nlm.nih.gov/articles/PMC10434946/),
[text-to-SQL accuracy](https://arxiv.org/abs/2305.03111)): popularity read as emergence; clusters
read off a 2-D projection (cluster in the full space, use the map to navigate); clusters driven by
boilerplate rather than style; hub attributes (black, plain) gluing groups together; LLM summaries
that invent a trend or its cause; small-count bursts (1 to 4 is "+300 %"); text-to-query answers
that are silently wrong; unfair comparisons (different corpora, offline cost mixed into online cost,
image tokens compared with text tokens).

## The three methods against it

| | Closest in the literature | Strength | Gap |
|---|---|---|---|
| **1 · Ask the graph agent**: the Neptune MCP agent writes openCypher for properties the new content shares more than the catalog; code counts its groups again | GraphRAG, over a curated ontology instead of an LLM-extracted graph | the vocabulary is controlled; relationships are explicit | free-form openCypher is fragile; hub attributes |
| **2 · Export to Iceberg, ask the data agent**: the graph exported to Iceberg tables in S3 Tables, a data agent queries them with SQL; code counts its groups again | text-to-SQL analytics | time windows and lift are natural in SQL | text-to-SQL accuracy; the export goes stale |
| **3 · Explore the clouds**: the worn garments' vectors grouped in the full space, drawn as a heat map; a cloud walked in the graph to its looks, then described by two model calls | Atlas-style map and LLM labels, over the graph's garments instead of raw documents | finds pieces that mean the same thing whatever the stylists called them; the walk adds the looks, what is worn with the pieces and the occasions | a 2-D map misleads if read as the clusters; a cloud with few new garments is thin evidence |

## Design decisions

1. **One idea of emergence, computed in code.** Lift of the new content against what the brand
   had, with add-half smoothing; every method reports it and every explanation is asked to cite it.
   The two definitions of what is counted are stated on each card, not hidden.
2. **One output contract and one scoreboard.** Every run records its wall time, where the time
   went, model calls, tool calls and tokens (fresh input, output, cache reads and writes), and the
   model and reasoning effort that actually ran, so the methods can be compared side by side on the
   same graph. Embeddings, ingestion and the export are offline costs and are not counted per
   question.
3. **Method 1 is the agent alone.** The agent gets the definition in plain words and writes its own
   openCypher; the October tab's tested query and its separate "explain" call are gone. Lift
   down-weights hub attributes; ingested items under 0.5 confidence are left out. The agent gets up
   to 5 minutes (a background job the browser polls, run by the pipeline function), because
   writing, running and fixing queries over the whole graph does not always fit in the 70 s an API
   call leaves it; its answer comes at the end, not a timeout.
4. **Method 2 gets method 1's definition, and the same recount.** The data agent's question is
   method 1's written for the tables (pieces of content, the lift formula with the totals filled
   in, what not to compare); the vocabulary ids in its rows are counted again by method 1's code, so
   a wrong SQL query shows up as numbers that disagree instead of as a convincing wrong answer.
5. **Method 3 clusters in the full space.** The garments' vectors come from the graph's own vector
   index (one byte per number, about 1 MB for a season), the browser builds a graph of each
   garment's 10 most similar ones and finds its communities (Louvain), and the 2-D map (t-SNE from
   a PCA start) is only for navigation. A click picks a badge, a garment dot or a cloud's heat,
   measured in pixels, so another cloud is reachable on the map while one is selected.
6. **Explanations are grounded.** The agents' prompts carry the definition and the totals, and ask
   for the vocabulary ids behind every group. Method 3's describe calls get numbered garments and
   lettered looks only, cite them (`[3]`, `[B]`) and say when the evidence does not show a trend.
7. **Only what both sides are described in is compared.** The catalog's items have no components
   (`HAS_PART`) and never use one value family (`animal`); left in, every component of an ingested
   item has an infinite-looking lift. Methods 1 and 2 compare categories and the value families the
   catalog uses, and report what they left out.
8. **Evidence counts in pieces of content, not items** (methods 1 and 2). Ingestion makes one item
   per entity, so a photo's left and right shoe would count twice; the agents' groups are counted
   in distinct sources (`source`: one photo or text, even when it was ingested twice).
9. **Numbers never come from the browser or the agent.** The agents' groups are counted again on
   the server from their node ids; the agents' own counts are shown, not used. Method 3's describe
   sends only garment ids: the server walks again and counts the lift before it reaches a prompt.
10. **The agent's model and reasoning effort are part of the run.** Each agent method has a deep
    dive to choose them, the trace draws every model turn and tool call on a time bar, and a
    readable reasoning summary appears in the trace where the model returns one (next section).

## Reasoning effort

The two agents let you choose how much the model reasons before it answers each turn (*Deep dive:
the agent's model and reasoning effort*). Each family takes the setting in its own field of the
Converse request's `additionalModelRequestFields` and accepts its own values. Checked on 9 November
2026 against the AWS documentation and with Converse calls in us-east-1:

| Family | Converse field | Values the model accepts | When nothing is sent | Reasoning returned on Converse |
|---|---|---|---|---|
| Claude Sonnet 5.5, Opus 5.5, Haiku 5.5 ([adaptive thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html)) | `thinking: {type: adaptive, display: summarized}` with `output_config: {effort}` | low, medium, high, xhigh, max; Haiku 5.5 also turns off (`thinking: {type: disabled}`) | adaptive, at high on Sonnet 5.5 and at medium on Opus 5.5 and Haiku 5.5 ([Sonnet](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html), [Opus](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html), [Haiku](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html) model cards) | a readable summary with `display: summarized`, empty text without it |
| GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Astra ([Sol model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html), [OpenAI parameters](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-openai.html)) | `reasoning: {effort}` | Sol: low, medium, high, xhigh, max (`none` is refused); Terra and Astra: low, medium and high confirmed in a tool loop (9 Nov 2026) | reasons; the level is not documented | encrypted (`redactedContent`); a summary only with `reasoning.summary` |
| Amazon Nova 2 Lite ([extended thinking](https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html)) | `reasoningConfig: {type: enabled, maxReasoningEffort}` | low, medium, high | no reasoning | the text is always "[REDACTED]" |
| Grok 4.7 ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html)) | `reasoning: {effort}` | low, medium, high, xhigh (`none` is refused) | high | encrypted |
| Kimi K3 ([model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k3.html)) | none that Converse applies: `reasoning_effort` is accepted but neither checked nor applied | n/a on Converse | max | not confirmed (every test call was throttled) |

No model reports its reasoning tokens apart on Converse: they are inside `outputTokens`, so the
output tokens in the trace include the thinking.

What the sample offers ([docs/tabs.md](tabs.md#the-creative-directors-trends-question)
has the table per model), and why:

* **A short list per model, Default first.** Default shows the level it stands for, for example
  "Default (high)" for Claude Sonnet 5.5, and the trends methods always send an explicit choice.
  Tab 3's query agent and every call outside the two agents send none, so their requests are
  unchanged.
* **No xhigh or max.** Both agents cap a turn's output at 4,096 tokens, and thinking counts toward
  it. Grok 4.7 at xhigh spent all 4,096 tokens thinking and returned no answer.
* **No Grok high.** One Grok 4.7 call at its default high took 44 s and 3,142 output tokens on a
  one-line counting puzzle; in an agent loop its turns can outlast the agents' per-turn read
  timeout of 100 s. The sample sends low with every Grok call (Default) and offers medium as the
  step up.
* **No Nova medium or high.** At medium, 5 of 6 agent runs on 9 November 2026 ended on their first
  turn without a query: 4 spent all 4,096 tokens reasoning (`max_tokens`), 1 returned
  `malformed_tool_use`. High needs a request without `temperature` and `maxTokens`, which the agents
  send, and it spent 8,025 tokens and 24 s on the same puzzle.
* **No "none" for GPT or Grok.** Both refuse it.
* **No GPT reasoning summaries.** With `reasoning.summary` on, the next turn fails unless the
  reasoning block is removed from the history, and the model then loses its own reasoning. GPT's
  reasoning stays encrypted, and the trace says so.
* **Claude's reasoning blocks go back unchanged.** The agent passes each turn's reasoning block back
  as it came, as the
  [preserved thinking rules](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-thinking-block-binding.html)
  require (a changed signature is a 400). Sonnet 5.5 and Opus 5.5 cannot turn thinking off, so only
  Haiku 5.5 offers Off.
* **No setting for Kimi K3.** Converse does not apply one. Its model card also says a multi-turn
  Converse request fails when it includes reasoning blocks of earlier turns, so the loop removes
  them for Kimi K3.

## Measurements

Measured in October 2026 on the sample after one tab 2 batch of the example photos and texts it
had then, since replaced (59 new items from 7 pieces of content against the catalog's items, 54
at the time of the measurement and 55 now; Claude Sonnet 5.5, local API, one to three runs each),
before the reasoning effort could be chosen. The graph agent's time excludes the separate explain
call the tab had then. Rerun for your own numbers.

| method | time | model calls | tokens (fresh in / out / cached) |
|---|---|---|---|
| 1 · graph agent (8 groups) | 16 to 26 s | 2 to 3 | 3.1 to 5.7 k / 1.9 to 2.3 k / 3.9 to 5.8 k |
| 2 · Iceberg tables, data agent (8 groups) | export 13 to 28 s (offline), then 32 s in the API process, 40 to 55 s on AgentCore Runtime | 2 to 3 | 2.9 to 5.5 k / 1.9 to 2.9 k / 2.7 to 4.0 k |

Both agents wrote a correct co-occurrence query on their first attempt and found the same top groups
as a fixed query the tab had then (crew-neck tops, midi floral dresses, double-breasted coats).
Method 2's time goes mostly into `query_database`: each call opens the catalog and reads both tables
again (15 s locally, 21 to 32 s on AgentCore for the self-join), which is why it runs as a
background job. Method 3 has not been measured on this page.

### Reasoning effort, 9 November 2026

Measured on the deployed sample in us-east-1, both agents on AgentCore Runtime, with 12 new pieces
of content against 62 catalog items. One run per level unless the row says otherwise. The time runs
from the start to the result as the browser polls it, every 5 s.

| method | model | effort | time | model turns | output tokens | groups |
|---|---|---|---|---|---|---|
| 1 | Claude Sonnet 5.5 | low, high | 28 s, 36 s | 2, 3 | 1,417, 2,064 | 8 |
| 1 | Claude Opus 5.5 | default, high | 28 s, 22 s | 2, 2 | 1,432, 1,582 | 8 |
| 1 | Claude Haiku 5.5 | off, high | 17 s, 22 s | 3, 2 | 1,205, 2,494 | 8 |
| 1 | GPT-6.1 Sol | high | 22 s | 2 | 676 | 8 |
| 1 | GPT-6.1 Terra | medium | 22 s | 2 | 709 | 8 |
| 1 | GPT-6 Astra | high | 27 s | 2 | 1,306 | 8 |
| 1 | Amazon Nova 2 Lite | low | 33 s | 3 | 3,600 | 8 |
| 1 | Grok 4.7 | medium | 44 s | 3 | 3,082 | 8 |
| 2 | Claude Sonnet 5.5 | default | 23 s | 2 | 2,108 | 8 |
| 2 | GPT-6.1 Sol | medium, high | 41 s, 28 s | 3, 2 | 1,170, 1,400 | 8 |
| 2 | GPT-6.1 Terra | low, medium, high | 6 s, 51 s, 12 s | 2, 3, 2 | 551, 1,874, 1,265 | 8 |
| 2 | GPT-6 Astra | low, medium, high | 12 s, 17 s, 28 s | 2, 3, 3 | 680, 1,188, 1,727 | 8 |
| 2 | Amazon Nova 2 Lite | low | 23 s | 3 | 3,270 | 8 |
| 1 and 2 | Amazon Nova 2 Lite | medium, 6 runs | 22 to 59 s | 1 in 5 runs | 4,096 (the cap) in 4 runs | 0 in 5 runs |

Every level the sample offers found the same 8 groups. On this small graph the effort changed the
time and the tokens, not the result, and one run per level does not rank the levels: GPT-6.1 Terra
took 51 s at medium (three turns) and 12 s at high (two). Nova 2 Lite at medium is why the sample
offers Nova only Default and Low. Method 3's describe step with Claude Haiku 5.5 took 5.5 s, with
1,543 input and 1,473 output tokens. Every Kimi K3 run was refused with a `ThrottlingException`: the
account's quota "Global cross-region model inference tokens per minute for Moonshot AI Kimi K3"
(L-2B5A3FA2, adjustable) was 0.

## Limitations

* No planted-trend benchmark yet: injecting a rising bundle of attributes and measuring each
  method's recall ([as Clio validated itself](https://arxiv.org/abs/2412.13678)) would turn the
  comparison into a score.
* Methods 1 and 2 and method 3 count different things (pieces of content against catalog items,
  garments in looks against the lookbook), so their numbers do not line up.
* Leiden communities on an attribute co-occurrence projection in Neptune Analytics
  ([algorithms](https://docs.aws.amazon.com/neptune-analytics/latest/userguide/algorithms.html))
  are not used; methods 1 and 2 ask the agents for pairs of properties.
* The measurements are one to three runs each, without P50 / P95 times; the agents are
  nondeterministic. The reasoning effort runs are one per level (Nova 2 Lite medium six), and Kimi
  K3's behavior on Converse is taken from its model card: every call in the test account was
  throttled.

## Why the S3 Tables MCP server: Athena compared

The sample only uses resources it creates. Amazon Athena reads S3 Tables only through the Glue Data
Catalog integration, whose `s3tablescatalog` catalog is one per account and Region, shared with
everything else in the account, created by an "enable integration" step, and in some accounts
governed by Lake Formation ([Athena and S3 Tables](https://docs.aws.amazon.com/athena/latest/ug/gdc-register-s3-table-bucket-cat.html),
[the integration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-tables-integration-overview.html));
the AWS Data Processing MCP server reaches S3 Tables only through Athena. The
[S3 Tables MCP server](https://github.com/awslabs/mcp/tree/main/src/s3-tables-mcp-server) queries a
table bucket through the S3 Tables Iceberg REST endpoint (PyIceberg) and needs nothing but the table
bucket the sample creates, so option A below is the one built.

| | storage | agent's tools | self-contained | what changes from the description |
|---|---|---|---|---|
| **A (built)** | an S3 table bucket the sample creates (Iceberg via the S3 Tables REST endpoint, written with PyIceberg) | [S3 Tables MCP server](https://github.com/awslabs/mcp/tree/main/src/s3-tables-mcp-server) | yes | the MCP server is the S3 Tables one, not Data Processing |
| B | Iceberg tables in a general-purpose bucket and a Glue database the sample creates, queried with Athena | [Data Processing MCP server](https://github.com/awslabs/mcp/tree/main/src/aws-dataprocessing-mcp-server) | yes | the tables are not S3 Tables |
| C | an S3 table bucket, queried with Athena through the account's `s3tablescatalog` | Data Processing MCP server | no: enables or reuses an account-wide integration | nothing |

What option A requires:

* **The server's pins.** `awslabs.s3-tables-mcp-server` 0.1.1 pins exact versions; its PyIceberg
  (0.10.0) has no Linux arm64 wheels and none for Python 3.13+, so it cannot run on AgentCore
  Runtime as published, and its boto3 and MCP SDK pins clash with the rest of the sample. It runs on
  the versions of `lake_overrides.txt` (PyIceberg 0.12, PyArrow 25, Daft 0.7.26, MCP SDK 2.3):
  through `uvx --overrides` outside the runtime, in an environment of its own, and compiled into
  the lake agent's zip when deployed (476 MB unpacked, about 170 MB zipped: within AgentCore's
  750 / 250 MB).
* **A runtime of its own.** The lake agent's role reaches the table bucket (read, and commit table
  snapshots for the export) and the models; the query agent's keeps reading the graph only. The
  API reads the graph and sends the rows; the runtime checks them against the schema and writes.
* **The engine's limits, in the prompt.** Daft's SQL has no non-equality join conditions (`ON
  a.x < b.x` fails; it belongs in `WHERE`); the system prompt says so, and the engine's error, which
  the MCP SDK withholds from the client, is read from the server's log and sent back.
* **A background job.** Each `query_database` call opens the catalog and reads the tables again,
  so a question takes about a minute; the API starts it as a background job and the browser polls
  (on AgentCore, in the same session, so the poll reaches the microVM that runs it).
* **Only the SQL is the model's.** The tool is offered with its `query` argument only; the
  warehouse, namespace and endpoint are filled in by the code, a guard lets one read-only `SELECT`
  through, and the server, started without `--allow-write`, checks again.
