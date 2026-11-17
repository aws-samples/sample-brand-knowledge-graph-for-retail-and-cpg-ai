# Build a brand knowledge graph for retail and CPG AI

Multimodal AI knowledge graph with ontology-grounded GraphRAG on AWS.

A brand's styling knowledge is a set of relationships: which pieces go together, why, and for which
occasion. A vector index finds similar text but does not store relationships. This sample stores an
apparel ontology and a fictional brand's styling rules as a knowledge graph in Amazon Neptune
Analytics, with a multimodal vector index. It then answers the same styling question two ways with
Amazon Bedrock: RAG over the product catalog in Amazon S3 Vectors, and GraphRAG over the graph,
which shows the path behind every citation.

The web app has seven tabs. They take you from an ontology explorer that classifies photos with
several vision models, through an ingest pipeline on AWS Step Functions and two agents on Amazon
Bedrock AgentCore Runtime, to the comparison itself. The sample is the take-home of the re:Invent
2026 builders' session IND416, *Build a brand knowledge graph for retail and CPG AI*.

> [!IMPORTANT]
> This is sample code, for non-production usage. You should work with your security and legal teams
> to meet your organizational security, regulatory and compliance requirements before deployment.

> [!NOTE]
> All catalog data is synthetic: two fictional brands, Velloway and Whimsikora. The photos are
> Whimsikora's lookbook photos and product shots, generated on Amazon Bedrock with Amazon Nova Canvas,
> and show no real person. No customer data is included. [Bring your own data](#bring-your-own-data)
> shows how to add your own catalog.

## Contents

* [What you get](#what-you-get)
* [Architecture](#architecture)
* [Prerequisites](#prerequisites)
* [Deploy](#deploy)
* [Sign in and verify](#sign-in-and-verify)
* [Cost](#cost)
* [Clean up](#clean-up)
* [Bring your own data](#bring-your-own-data)
* [Security](#security)
* [Documentation](#documentation)
* [Repository layout](#repository-layout)

## What you get

Every tab but tab 0 has a "How it works" panel with the architecture, the request flow and the code
that ran. [docs/tabs.md](docs/tabs.md) walks through each tab.

* **0 · Start here.** One question asked to a model on its own, what you will build, the brands in
  the graph, and what the stack deployed in your account, read-only.
* **1 · Ontology explorer.** The ontology drawn as a tree, and a photo classified against it by
  several vision models, with bounding boxes, validation and token metrics.
* **2 · Hydrate the graph.** A batch of photos and texts goes through AWS Step Functions into the
  graph. The tab shows the batch, the counts before and after, and the graph the run wrote.
* **3 · Explore the graph.** The whole graph as one web, and questions in plain words answered by an
  agent that writes openCypher through the Amazon Neptune MCP server.
* **4 · Build the retriever.** The catalog search, RAG with searches the model plans, the way into
  the graph by vector search, the traversal and GraphRAG's answer, stage by stage.
* **5 · Same question, three answers.** One question, or a photo, answered by a model on its own, by
  RAG and by GraphRAG with the same model, side by side with their receipts.
* **6 · What else the graph knows.** The same graph for a buyer, a merchandiser and a creative
  director, and three ways to find this season's emerging trends.

RAG and GraphRAG share the catalog, the search and the answer prompt. They differ in where the
searches come from: RAG's model plans them from its own taste, and GraphRAG takes them from three of
the brand's looks in the graph.

![RAG and GraphRAG side by side. Both search the same product catalog in Amazon S3 Vectors and answer with the same prompt in Amazon Bedrock. RAG plans 3 to 6 searches with a model; GraphRAG embeds the question, finds the brand's looks in Neptune Analytics and searches the catalog for their pieces.](assets/rag-vs-graphrag.png)

The IND416 session's workshop builds on this sample by adding a larger data set. The workshop is
not part of this repository.

## Architecture

![Architecture of the deployed stack. The browser signs in with Amazon Cognito, loads the site from Amazon S3 through Amazon CloudFront and calls the Lambda API's function URL with requests signed by AWS credentials from a Cognito identity pool. In a VPC with two private subnets, the API, the Step Functions ingest pipeline, the two agents on AgentCore Runtime and the GraphLoader reach a private Neptune Analytics graph. Amazon Bedrock and the other AWS APIs are reached through a NAT gateway, the data bucket through a gateway endpoint; the API queries the catalog index in Amazon S3 Vectors and the lake agent queries Amazon S3 Tables.](assets/architecture.png)

1. You sign in to an Amazon Cognito user pool (authorization code with PKCE). A Cognito identity
   pool gives the browser temporary AWS credentials of one IAM role, which may call the API and
   nothing else.
2. Amazon CloudFront serves the React site from an S3 bucket.
3. The browser signs each API request with those credentials (SigV4) and sends it to the API's
   Lambda function URL, whose IAM auth lets only that role through. The API classifies photos with Amazon
   Bedrock, searches the product catalog in Amazon S3 Vectors and queries the graph in Amazon
   Neptune Analytics.
4. Tab 2 starts an AWS Step Functions execution. A `Map` state classifies up to four sources at a
   time, the ingest step writes the validated entities into the graph, and a summary step closes
   the run.
5. Tabs 3 and 6 call two agents on Amazon Bedrock AgentCore Runtime. The query agent writes
   read-only openCypher through the Amazon Neptune MCP server. The lake agent writes SQL over an
   Iceberg export of the graph in Amazon S3 Tables through the S3 Tables MCP server.
6. The graph has no public endpoint. The API, the pipeline, the loader and both agents run in two
   private subnets and reach it through a private graph endpoint. They reach Amazon S3 through a
   gateway endpoint and the other AWS APIs through a NAT gateway, a choice for simplicity
   ([why not interface endpoints](docs/architecture.md#why-these-choices)).
7. At deploy, `GraphLoader` loads the ontology and every data set into the graph and the catalog
   index, and `AuthSetup` sets the generated sign-in password. A `BucketDeployment` copies the site
   and the `ontologies/` folder to their buckets.

[docs/architecture.md](docs/architecture.md) has the request flows, the design decisions and a
list of every backend module.

## Prerequisites

* Node.js 20 or newer with npm, and Python 3.11 or newer for the tests and the command line. The
  deployed functions and agents run on Python 3.14.
* [uv](https://docs.astral.sh/uv/), recommended. It builds the Lambda and agent packages from Linux
  wheels without Docker; `pip` works too.
* AWS CDK v2 (`npx cdk`, installed by `npm ci` in `infra/`) and an account bootstrapped in the
  target Region (`npx cdk bootstrap`). The default bootstrap role is enough; a narrower role needs
  the permissions in [docs/deploy.md](docs/deploy.md#permissions).
* A Region with every service and model the sample uses. The sample is tested in `us-east-1`. Neptune
  Analytics, S3 Vectors, S3 Tables, AgentCore Runtime, the Nova 2 multimodal embedding model and the
  `global.` and `us.` inference profiles are not in every Region. A Region that lacks one fails in
  CloudFormation after several minutes.
* Amazon Bedrock model access in that Region before the deploy:
  `amazon.nova-2-multimodal-embeddings-v1:0` (the deploy calls it), Claude Sonnet 5.5
  (`global.anthropic.claude-sonnet-5-5`, the default answer and classification model) and the
  vision models you want in tab 1. Anthropic models need the one-time use-case form in the Bedrock
  console.

Deploy into a sandbox account without production workloads.

## Deploy

```bash
git clone https://github.com/aws-samples/sample-brand-knowledge-graph-for-retail-and-cpg-ai.git
cd sample-brand-knowledge-graph-for-retail-and-cpg-ai
make setup                                    # backend/.venv, npm ci in infra/ and web/
make build                                    # web/dist, the site the stack publishes
backend/.venv/bin/ontology-rag check-models   # pre-flight, with the deploy's credentials and AWS_REGION
cd infra && npx cdk deploy --parameters SignInEmail=you@example.com
```

`check-models` sends every Bedrock model the sample uses one small request and reports the ones the
account may not call. `SignInEmail` is the address of the one user the stack creates, used only for
account recovery.

The deploy takes 25 to 35 minutes. At the end, the `GraphLoader` custom resource loads the ontology
and both data sets into the graph and the catalog index. If it fails, the first deploy rolls back;
fix the cause and run `npx cdk deploy` again.

Every setting is a `-c key=value` with a default. The two a first deploy may need are
`-c vpcAzIds=` (a Region whose Availability Zone IDs the stack does not know) and
`-c defaultDomain=` (another ontology folder). [docs/deploy.md](docs/deploy.md#configuration) lists
them all, with the stack outputs and the troubleshooting steps.

## Sign in and verify

The stack creates one user, `participant` by default. Its password is generated into AWS Secrets
Manager; the `SignInPasswordSecret` output names the secret.

```bash
aws secretsmanager get-secret-value --secret-id <SignInPasswordSecret> --query SecretString --output text
```

1. Open the `SiteUrl` output and sign in on the Cognito page. The header shows *signed in as* and the
   user's email, and tab 0 lists the stack's resources.
2. In tab 5, choose *Ask all three* with the default question. Three answers appear side by side,
   each with its receipts. GraphRAG's receipts draw the traversal behind its citations.
3. `curl -i <ApiUrl>api/health` (the output ends with a slash) returns `403` with
   `{"Message":"Forbidden"}`. The function URL runs the API only for requests signed by the
   signed-in user's role.

[docs/deploy.md](docs/deploy.md#sign-in) has the sign-in details, and
[docs/security.md](docs/security.md#who-may-call-the-api-iam) explains how IAM decides who may call the API.

## Cost

| Resource | Billed while idle? | How to stop it |
|---|---|---|
| Neptune Analytics graph (16 m-NCU, no replica, the smallest configuration) | Yes, per m-NCU-hour; the dominant cost | `npx cdk destroy` |
| Amazon Bedrock (classification, answers, embeddings, the agents) | No; per input and output token, images included | Nothing to do |
| AgentCore Runtime (two runtimes) | No; CPU and memory while a session is active (sessions end after 10 idle minutes, at most after 2 hours) | Nothing to do |
| Amazon S3 Vectors (one bucket and index: the product catalog) | Storage of the vectors, plus requests | Destroyed with the stack |
| Amazon S3 Tables (one table bucket, two tables) | Storage and requests, plus table maintenance | Destroyed with the stack |
| S3 buckets: site, data, logs | Storage and requests; logs expire after 30 days, uploads after 1 day, run records after 7 days | Destroyed with the stack |
| CloudFront, Lambda, Step Functions, CloudWatch Logs (30-day retention), X-Ray | Per request, invocation, transition and ingested data; nothing while idle | Nothing to do |
| Amazon Cognito (Essentials plan) | The free tier covers the one user | Destroyed with the stack |
| AWS Secrets Manager (the sign-in password) | Yes, per secret-month | Destroyed with the stack |
| Regional NAT gateway with its two public IPv4 addresses (the private subnets' way to the AWS APIs) | Yes: about $2.40 per day, plus $0.045 per GB it processes | `npx cdk destroy` |
| Private graph endpoint (one network interface in each of the two subnets) | Yes: $0.48 per day, plus $0.01 per GB | `npx cdk destroy` |

Pricing pages: [Neptune Analytics](https://aws.amazon.com/neptune/pricing/),
[Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/),
[AgentCore](https://aws.amazon.com/bedrock/agentcore/pricing/),
[Amazon S3](https://aws.amazon.com/s3/pricing/) (S3 Vectors and S3 Tables included),
[Amazon Cognito](https://aws.amazon.com/cognito/pricing/),
[AWS Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/). The two network rows are
us-east-1 prices of November 2026, from the [Amazon VPC](https://aws.amazon.com/vpc/pricing/) and
[AWS PrivateLink](https://aws.amazon.com/privatelink/pricing/) pricing pages.

## Clean up

```bash
cd infra && npx cdk destroy
# up to 8 hours later, once AgentCore has released the agents' network interfaces in the VPC:
cd .. && make network-cleanup ARGS=--delete
```

`npx cdk destroy` removes everything billed per hour. Nothing is backed up, so take a Neptune
Analytics snapshot first if you want to keep the graph. The stack keeps its VPC for up to 8 hours,
because AgentCore holds network interfaces in it; the VPC has no hourly cost, and
`make network-cleanup` deletes it. A few log groups that the service and aws-cdk-lib create also
remain. [docs/deploy.md](docs/deploy.md#cleanup) lists them.

## Bring your own data

A domain folder under `ontologies/` holds two kinds of input. **Examples** are photos and texts to
try in the app; the deploy never loads them into the graph. **Data sets** are the graph's data, one
folder per brand, loaded at deploy.

![The ontologies folder: one folder per domain with its ontology, examples to try and data sets, one per brand. Callouts mark what the deploy loads into the graph (the ontology and each set's data files), what the app only offers (the examples folders) and what the API serves by key (a set's media folder).](assets/data-layout.png)

The sample ships two data sets in the fashion domain. Velloway is a synthetic catalog of 55 items,
19 looks, 44 pairing rules and 5 articles, generated by `ontology-rag synth`. Whimsikora is one look
of a second fictional brand with its photo, so the graph holds a look with white sneakers, the
garment the example question asks about.

To bring your own catalog, add a data set folder and deploy again:
[docs/bring-your-own-data.md](docs/bring-your-own-data.md) walks through it.
[ontologies/README.md](ontologies/README.md) explains how an ontology is read and how to add a
domain.

## Security

The deployed site requires sign-in with Amazon Cognito, and IAM decides who may call the API: its
Lambda function URL accepts only requests signed with the signed-in user's role from a Cognito
identity pool. The graph is private to the stack's VPC. Each function and agent
has a role of its own, and the agents can only run read-only queries.

The stack is built for one trusted user. The two residual risks to close first, before more people
use it, are these:

* There is no AWS WAF web ACL and no per-user quota, so every signed-in request may call Amazon
  Bedrock.
* There is one shared user, and MFA is optional.

[docs/security.md](docs/security.md) describes every trust boundary and lists all residual risks.
See [SECURITY.md](SECURITY.md) and [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) to
report a security issue.

## Documentation

| Page | What it covers |
|---|---|
| [docs/tabs.md](docs/tabs.md) | Every tab, step by step |
| [docs/architecture.md](docs/architecture.md) | The deployed stack, the design decisions, the request flows, the backend modules |
| [docs/graph-model.md](docs/graph-model.md) | The node and edge types, occasions, ids and vectors |
| [docs/bring-your-own-data.md](docs/bring-your-own-data.md) | How to add your own catalog as a data set |
| [docs/emerging-trends.md](docs/emerging-trends.md) | Tab 6's three trend methods, with measurements |
| [docs/deploy.md](docs/deploy.md) | Permissions, configuration, outputs, sign-in, troubleshooting, cleanup |
| [docs/security.md](docs/security.md) | Trust boundaries and residual risks |
| [docs/develop.md](docs/develop.md) | Tests, scans, the command line and the figures |
| [ontologies/README.md](ontologies/README.md) | The folder layout, `domain.json`, adding a domain |

The sample builds its graph from an ontology and walks it with its own code.
[docs/architecture.md](docs/architecture.md#related-aws-open-source) lists AWS open-source projects
for neighboring cases, such as a graph built from documents without an ontology.

## Repository layout

```
ontologies/   the ontologies: fashion/ (the domain the graph uses, with its examples and data sets),
              beauty/, home/, food/ (browse-only)
backend/      Python package and tests: the API, the pipeline steps, retrieval, the two agents, the CLI
infra/        CDK app and tests
web/          React app; web/figures/ renders the figures in assets/
docs/         the pages listed above
assets/       the figures of this README and the docs
```

`make test` runs every suite offline, and `make scan` runs the secret, static-analysis and
dependency checks. [docs/develop.md](docs/develop.md) has the details.

## Contributing

See [CONTRIBUTING](CONTRIBUTING.md) for how to report issues and propose changes.

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
The one exception is `ontologies/fashion/fashion.ttl`, which is derived from the Fashionpedia
ontology and licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), not MIT-0.
Third-party content and attributions: [THIRD-PARTY-LICENSES](THIRD-PARTY-LICENSES).
