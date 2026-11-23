# Develop

This page covers the local loop: the test suites, the command line, the scans and the figures of
the README. The app itself runs only as deployed. The graph is private to the stack's VPC, so a
laptop cannot reach it, and the sample has no local server.

## Contents

* [Change, test, deploy](#change-test-deploy)
* [The command line](#the-command-line)
* [Python extras](#python-extras)
* [Tests and scans](#tests-and-scans)
* [Figures](#figures)
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

## Tests and scans

```bash
make test        # pytest and ruff (offline), CDK assertions with cdk-nag, web tests, type-check and build
make scan        # detect-secrets against .secrets.baseline, bandit on the Python, pip-audit on the three hashed requirement files
```

On GitHub, [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs `make setup` and `make test`
on every pull request to `main` and every push to `main`, with uv 0.12.22, Python 3.14 and
Node.js 26. A pull request merges only when its `test` check passes.

`make scan` needs [uv](https://docs.astral.sh/uv/), whose `uvx` fetches the scanners. It fails on a
secret that is not in the baseline, on a bandit finding of medium severity or above, or on a known
vulnerability in `backend/lambda-requirements.txt`, `backend/agentcore/requirements.txt` or
`backend/agentcore-lake/requirements.txt`. Clear a new false positive with
`# pragma: allowlist secret` on its line, or with `uvx detect-secrets audit .secrets.baseline`.

## Figures

The figures under `assets/` are rendered from the app's own diagram components, so they look like
the tabs' "How it works" panels.

```bash
make figures     # type-checks web/figures/, then writes assets/<name>.png (2x) and assets/<name>.svg
```

`web/figures/` holds the renderer: a page that draws one figure with React Flow and the app's
`ServiceNode` and `ZoneNode` (`web/src/components/arch/flow.tsx`) and `web/src/styles.css`, and
`render.mjs`, which serves the page with Vite and captures each figure with Playwright. Each figure
is a spec in `web/figures/specs/`: tiles, groups and edges at fixed coordinates. The specs under
`web/figures/specs/tabs/` are the figures of each tab, the concept behind it (tab 6 has two) and how its
steps are built (the AWS Solutions Library style: numbered tiles, then one numbered line per step in the
text that shows the figure); they render into `assets/tabs/`, and a workshop built on the sample
shows the same files. The renderer is not part of the app build or the app's tests. Playwright
needs a Chromium build; install it once with `cd web && npx playwright install chromium`.

After you change a spec or the app's diagram style, run `make figures` and look at every PNG: no
edge may cross a tile, and no text may be cut off.

## Where the code is

| Folder | What it holds |
|---|---|
| `backend/src/ontology_rag/` | The API, the pipeline steps, retrieval, the two agents, the CLI. [architecture.md](architecture.md#backend-package-backend) lists every module |
| `backend/agentcore/`, `backend/agentcore-lake/` | The entry points of the two agent runtimes |
| `infra/lib/` | The CDK stack (`multimodal-ai-knowledge-graph-stack.ts`) and its parts: `agents`, `auth`, `bundling`, `context`, `function-logging`, `guardrail`, `models`, `nag`, `network` |
| `web/src/components/arch/` | The "How it works" panel every tab shares. A panel is a `Def`: its steps, texts and diagram geometry |
| `web/src/components/shared/` | The model catalog, the remembered choices, the elapsed-time ticker and the agent trace |
| `web/src/components/<tab>/` | One folder per tab: `setup`, `studio`, `pipeline`, `graph`, `query`, `retriever`, `payoff`, `lenses`; `tree` holds the SVG camera and helpers that tabs 2, 3 and 5 share |
| `web/figures/` | The figure renderer (see [Figures](#figures)) |
