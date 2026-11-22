# `ontology-rag`: the backend package

Python package behind the sample: ontology parsing and the ontology as a classification prompt,
image and text classification with Amazon Bedrock vision models, the ingest pipeline steps, Amazon
Nova multimodal embeddings, graph loading and GraphRAG retrieval on Amazon Neptune Analytics, the
product catalog and RAG on Amazon S3 Vectors, grounded answers, the query agent on the Amazon
Neptune MCP server and the lake agent on the S3 Tables MCP server (with their Amazon Bedrock
AgentCore Runtime entry points, `agentcore/main.py` and `agentcore-lake/main.py`), the deploy-time
sign-in setup and the Lambda handlers.

```bash
uv venv .venv && source .venv/bin/activate
uv pip install -e '.[dev,agent]'         # what `make setup` installs
pytest -q                                # no AWS: in-memory graph, mock embedder, fake Bedrock client
ruff check src tests && ruff format --check src tests
```

Install extras: `agent` (the Amazon Neptune MCP server the query agent starts), `lake` (PyIceberg and
PyArrow for the trends question's export into Iceberg tables, which the lake agent's runtime runs
when deployed) and `dev` (pytest, ruff).

## Command line

```bash
ontology-rag synth                 # regenerate ../ontologies/fashion/datasets/anycompany-apparel from synth.py
ontology-rag check-models          # pre-flight before `cdk deploy`: one small request per Bedrock model; exit 1 when one fails
ontology-rag network-cleanup       # after `cdk destroy`: report the VPC the stack keeps; --delete deletes it once AgentCore has released its interfaces (--stack NAME, --wait MINUTES; exit 3 while they are held)
```

None of the three needs the graph: the stack's graph is reachable only from the stack's VPC, so the
package runs against it only inside the deployed functions and runtimes. A change is tested here
and deployed with `npx cdk deploy` from `infra/`.

The package reads its settings from the environment (`src/ontology_rag/config.py`); the stack sets
them on each function. The defaults call Amazon Bedrock: `EMBEDDER=nova` (Amazon Nova multimodal
embeddings) and `LLM_MODEL_ID` (Claude Sonnet 5.5 through its global inference profile) as the
default answer model. `EMBEDDER=mock` replaces the embeddings with a deterministic stand-in, which
is what the tests use.

## Dependencies and deployment packages

The runtime dependencies are `boto3` and `rdflib` (`pyproject.toml`). The Lambda zip vendors
rdflib, pyparsing and boto3 with its dependencies: the 9 pins of `lambda-requirements.in`, resolved
with hashes into `lambda-requirements.txt`, which `infra/lib/bundling.ts` installs with
`--require-hashes` (CPython 3.14 x86_64 wheels, no Docker).

Deployed, the agents run on Amazon Bedrock AgentCore Runtime from zips of their own: `agentcore/main.py`
(the query agent) and `agentcore-lake/main.py` (the lake agent), this package and the pinned closure
of the respective `requirements.txt` (AgentCore SDK, ADOT, the MCP server) as Linux arm64 wheels for
Python 3.14 (`infra/lib/agents.ts`, `--require-hashes` too). Every pinned file carries the hash of
each wheel it allows, so a package swapped on the index cannot get into a zip. Regenerate the pins
after changing an `.in` file, and keep boto3 on one version across the three:

```bash
uv pip compile lambda-requirements.in --python-version 3.14 --python-platform x86_64-manylinux2014 \
  --only-binary :all: --generate-hashes -o lambda-requirements.txt
cd agentcore && uv pip compile requirements.in --python-version 3.14 \
  --python-platform aarch64-manylinux2014 --only-binary :all: --generate-hashes -o requirements.txt
cd ../agentcore-lake && uv pip compile requirements.in --override ../src/ontology_rag/lake_overrides.txt \
  --python-version 3.14 --python-platform aarch64-manylinux_2_28 --only-binary :all: --generate-hashes \
  -o requirements.txt
```

`make scan` at the repository root audits the three files for known vulnerabilities (pip-audit).
The lake agent's closure overrides the S3 Tables MCP server's own pins with
`src/ontology_rag/lake_overrides.txt` (the versions that have arm64 and Python 3.14 wheels); the same
file drives `uvx --overrides` when the server runs outside the lake agent's runtime.

## Layout

`src/ontology_rag/` is one flat package; `docs/architecture.md` lists every module with one line. The
"How it works" panels of the web app show snippets of this source with marked lines
(`code_panel.py`); `tests/test_code_panel.py::test_code_panel_marks_resolve_on_the_live_source`
fails when a refactor moves a marked line, so the panels cannot drift from the code.

Imports sit at the top of a module, with two exceptions: `boto3` (and the clients built from it)
is imported where it is used, so that `pytest -q` neither loads the SDK nor needs credentials
and runs offline in about 25 s; and the optional extras (`mcp`, `pyiceberg`, `pyarrow`) are imported
where they are used, so the package works without them.
