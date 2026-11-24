# Develop

This page covers the local loop: the test suites and the command line. The app itself runs only as
deployed. The graph is private to the stack's VPC, so a laptop cannot reach it, and the sample has
no local server.

## Contents

* [Change, test, deploy](#change-test-deploy)
* [The command line](#the-command-line)
* [Python extras](#python-extras)
* [Tests](#tests)
* [Where the code is](#where-the-code-is)

## Change, test, deploy

```bash
make setup        # backend/.venv (uv, the dev and agent extras), npm ci in infra/ and web/
make test         # offline: pytest and ruff, the CDK assertions with cdk-nag, the web tests, type-check and build
make build && (cd infra && npx cdk deploy)    # build the site, then deploy the stack again
```

`make test` runs without AWS: a fake Bedrock client, an in-memory graph and a stand-in embedder.
`npx cdk deploy` in `infra/` builds the Lambda and agent zips itself.

## The command line

`backend/.venv/bin/ontology-rag` has three commands. None of them needs the graph.

* `synth` regenerates the AnyCompany Apparel data set (`ontologies/fashion/datasets/anycompany-apparel/`) from
  `backend/src/ontology_rag/synth.py`. `make sample-data` runs it.
* `check-models` sends every Bedrock model the sample uses one small request. It exits with 1 when
  one of them fails. Run it before a deploy, with the deploy's credentials and `AWS_REGION`.
* `network-cleanup` reports the VPC a destroyed stack left, and with `--delete` deletes it.
  `make network-cleanup` runs it (see [deploy.md](deploy.md#cleanup)).

## Python extras

| Extra | What it adds |
|---|---|
| `dev` | pytest and ruff |
| `agent` | the Amazon Neptune MCP server the query agent starts |
| `lake` | PyIceberg and PyArrow, for the Iceberg write of tab 6's trends method 2; deployed, the lake agent's runtime runs it |

`make setup` installs `dev` and `agent`. [backend/README.md](../backend/README.md) has the package's
own commands and how to regenerate the pinned requirement files.

## Tests

`make test` runs the backend's pytest suite and ruff, the CDK assertions (with cdk-nag) and the web
tests, then type-checks and builds the site. On GitHub,
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs `make setup` and `make test` on every
pull request to `main` and every push to `main`, with uv 0.12.22, Python 3.14 and Node.js 26. A pull
request merges only when its `test` check passes.

The three deployment zips are built from requirement files pinned with hashes;
[backend/README.md](../backend/README.md) says how to regenerate them and how to audit them for
known vulnerabilities.

## Where the code is

| Folder | What it holds |
|---|---|
| `backend/src/ontology_rag/` | The API, the pipeline steps, retrieval, the two agents, the CLI. [architecture.md](architecture.md#backend-package-backend) lists every module |
| `backend/agentcore/`, `backend/agentcore-lake/` | The entry points of the two agent runtimes |
| `infra/lib/` | The CDK stack (`multimodal-ai-knowledge-graph-stack.ts`) and its parts: `agents`, `auth`, `bundling`, `context`, `function-logging`, `guardrail`, `models`, `nag`, `network` |
| `web/src/components/arch/` | The "How it works" panel every tab shares. A panel is a `Def`: its steps, texts and diagram geometry |
| `web/src/components/shared/` | The model catalog, the remembered choices, the elapsed-time ticker and the agent trace |
| `web/src/components/<tab>/` | One folder per tab: `setup`, `studio`, `pipeline`, `graph`, `query`, `retriever`, `payoff`, `lenses`; `tree` holds the SVG camera and helpers that tabs 2, 3 and 5 share |
