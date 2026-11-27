# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Runtime settings, read from the environment.

The stack sets the variables on every function it deploys (the Neptune Analytics graph, the data
bucket, the Amazon S3 Vectors bucket and its indexes, the agents' runtimes). The tests build
:class:`Settings` directly, with the in-memory graph and the fakes. :func:`load_settings` reads
the environment once, at start.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path


def repo_root() -> Path:
    """Best-effort repository root (backend/src/ontology_rag -> repo): the directory that holds
    the ``ontologies/`` folder and ``backend/pyproject.toml``."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "ontologies").is_dir() and (parent / "backend" / "pyproject.toml").exists():
            return parent
    # Lambda bundle layout: ontologies/ is copied next to the package.
    return here.parents[1]


# Vision models offered by the ontology explorer (comma-separated model / inference-profile ids
# in VISION_MODEL_IDS). Defaults: the current generation of every multimodal model family on
# Bedrock through global cross-Region inference profiles (vision.KNOWN_MODELS, first nine);
# superseded model ids are refused with their replacement (vision.RETIRED_MODELS). A workshop
# or a deployment narrows the list with VISION_MODEL_IDS (cdk -c visionModelIds=...).
DEFAULT_VISION_MODEL_IDS = (
    "global.anthropic.claude-sonnet-5-5",
    "global.anthropic.claude-opus-5-5",
    "global.anthropic.claude-haiku-5-5",
    "global.openai.gpt-6.1-sol",
    "global.openai.gpt-6.1-terra",
    "global.openai.gpt-6-astra",
    "global.amazon.nova-2-lite-v1:0",
    "global.xai.grok-4.7",
    "global.moonshotai.kimi-k3",
)

# Models offered for the grounded answers of tab 3 (ANSWER_MODEL_IDS); the default answer model
# is LLM_MODEL_ID. Any Converse text model works; this list mirrors the vision one.
DEFAULT_ANSWER_MODEL_IDS = DEFAULT_VISION_MODEL_IDS

# The domain whose ontology the graph is loaded with when ONTOLOGY_PATH is not set: the folder
# <ontologies_dir>/<DEFAULT_DOMAIN>/<DEFAULT_DOMAIN>.ttl. The sample ships this one; the CDK stack
# mirrors it (infra/lib/multimodal-ai-knowledge-graph-stack.ts: DEFAULT_DOMAIN, the -c defaultDomain= context).
DEFAULT_DOMAIN = "fashion"

# Where the API mirrors the ontology folders from S3 when it runs on Lambda.
LAMBDA_CACHE_DIR = "/tmp/ontologies"  # nosec B108  # /tmp is the only writable path on Lambda


@dataclass(frozen=True)
class Settings:
    """The values; :func:`load_settings` fills them in from the environment. The resources the
    stack names (the graph, the vector bucket, the table bucket, the agents' runtimes) default to
    "not set up" here, so a test that builds the settings never reaches a real one."""

    region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "us-east-1"))

    # Graph back end: "neptune" (the Neptune Analytics graph GRAPH_ID, deployed) or "memory" (the
    # tests' in-memory graph).
    graph_backend: str = "memory"
    graph_id: str = ""
    # Optional explicit data-plane endpoint override (normally resolved from GRAPH_ID).
    graph_endpoint_url: str = field(
        default_factory=lambda: os.environ.get("GRAPH_ENDPOINT_URL", "")
    )
    # Deployed, the graph is reachable only from the stack's VPC, through its private graph
    # endpoint; the stack names both on the API function (VPC_ID, GRAPH_ENDPOINT_ID: the
    # endpoint's VPC endpoint id) for tab 0. Empty in the tests.
    vpc_id: str = field(default_factory=lambda: os.environ.get("VPC_ID", ""))
    graph_endpoint_id: str = field(default_factory=lambda: os.environ.get("GRAPH_ENDPOINT_ID", ""))
    # Allow the /api/graph/query console to run write clauses (`cdk deploy -c allowWriteQueries=true`).
    allow_write_queries: bool = field(
        default_factory=lambda: os.environ.get("ALLOW_WRITE_QUERIES", "false").lower() == "true"
    )
    # The query agent runs on Amazon Bedrock AgentCore Runtime when this is set (the stack's
    # runtime), in this process otherwise (the tests, with the `agent` extra).
    agent_runtime_arn: str = ""
    agent_runtime_qualifier: str = field(
        default_factory=lambda: os.environ.get("AGENT_RUNTIME_QUALIFIER", "DEFAULT")
    )
    # Tab 6, the trends question's method 2: the stack's S3 table bucket the graph is exported
    # to, and the lake agent's AgentCore Runtime (in this process when it is not set, with the S3
    # Tables MCP server through uvx).
    table_bucket_arn: str = ""
    lake_runtime_arn: str = ""

    # Embeddings: "nova" (Amazon Nova Multimodal Embeddings; the tests inject a mock).
    embedder: str = field(default_factory=lambda: os.environ.get("EMBEDDER", "nova"))
    embedding_model_id: str = field(
        default_factory=lambda: os.environ.get(
            "EMBEDDING_MODEL_ID", "amazon.nova-2-multimodal-embeddings-v1:0"
        )
    )
    embedding_dimension: int = field(
        default_factory=lambda: int(os.environ.get("EMBEDDING_DIMENSION", "1024"))
    )

    # The default answer model (tab 3 and the agents pick from ANSWER_MODEL_IDS; this is the one
    # chosen when a request names none).
    llm_model_id: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_ID", "global.anthropic.claude-sonnet-5-5")
    )
    # Models offered by the Style Q&A tab (tab 3) for the grounded answer. It is its own list, so the
    # answer model is chosen independently of the classification model of tabs 1 and 2. The
    # default answer model is LLM_MODEL_ID.
    answer_model_ids: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.environ.get("ANSWER_MODEL_IDS", ",".join(DEFAULT_ANSWER_MODEL_IDS)).split(
                ","
            )
            if m.strip()
        )
    )
    # The Amazon Bedrock guardrail on what a participant types (guardrail.py; the stack creates
    # it). Empty = no guardrail: every call goes as it is (the tests).
    guardrail_id: str = field(default_factory=lambda: os.environ.get("GUARDRAIL_ID", ""))
    guardrail_version: str = field(default_factory=lambda: os.environ.get("GUARDRAIL_VERSION", ""))
    # The stack's Amazon S3 Vectors bucket (VECTOR_BUCKET). Empty = none: the routes that search
    # it answer 409.
    vector_bucket: str = ""
    # Its product catalog index (payoff.py): real items only, no styling knowledge. RAG and
    # GraphRAG both search it (tabs 4 and 5).
    catalog_index: str = field(default_factory=lambda: os.environ.get("CATALOG_INDEX", "catalog"))
    # Vision models selectable in the ontology explorer and the ingest pipeline (Bedrock Converse).
    vision_model_ids: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.environ.get("VISION_MODEL_IDS", ",".join(DEFAULT_VISION_MODEL_IDS)).split(
                ","
            )
            if m.strip()
        )
    )

    # Folder of domains: <ontologies_dir>/<id>/<id>.ttl (+ domain.json, examples/, datasets/). The
    # graph's own vocabulary is ONTOLOGY_PATH (default: DEFAULT_DOMAIN's ontology in that folder).
    ontologies_dir: Path = field(
        default_factory=lambda: Path(os.environ.get("ONTOLOGIES_DIR", repo_root() / "ontologies"))
    )
    # Deployed, the folder is mirrored from S3 (see ontologies.S3Sync); empty bucket = the
    # repository's folder (the tests).
    ontologies_bucket: str = field(default_factory=lambda: os.environ.get("ONTOLOGIES_BUCKET", ""))
    ontologies_prefix: str = field(
        default_factory=lambda: os.environ.get("ONTOLOGIES_PREFIX", "ontologies/")
    )
    ontologies_cache_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "ONTOLOGIES_CACHE_DIR",
                LAMBDA_CACHE_DIR
                if os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
                else repo_root() / ".cache" / "ontologies",
            )
        )
    )
    # The mirror also takes the data files of the domains' data sets (ontologies/<id>/datasets/):
    # "true" on the graph loader only, which reads them once at deploy (Service.load_sample).
    mirror_set_data: bool = field(
        default_factory=lambda: os.environ.get("MIRROR_SAMPLE_DATA", "").lower() == "true"
    )
    # Let the architecture panel read this API's own log events (per request id). Off = 404.
    # Off unless EXPLORER_LOGS=true: the lines are not redacted (the stack's -c explorerLogs=true).
    expose_logs: bool = field(
        default_factory=lambda: os.environ.get("EXPLORER_LOGS", "false").lower() == "true"
    )
    # The ingest pipeline: with a state machine ARN the API starts Step Functions executions
    # (deployed); without one the same steps run in a thread pool of this process (the tests).
    pipeline_state_machine_arn: str = field(
        default_factory=lambda: os.environ.get("PIPELINE_STATE_MACHINE_ARN", "")
    )
    pipeline_function_name: str = field(
        default_factory=lambda: os.environ.get("PIPELINE_FUNCTION_NAME", "")
    )
    ontology_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "ONTOLOGY_PATH",
                Path(os.environ.get("ONTOLOGIES_DIR", repo_root() / "ontologies"))
                / DEFAULT_DOMAIN
                / f"{DEFAULT_DOMAIN}.ttl",
            )
        )
    )
    # A writable folder for the file blob store used when no data bucket is set (/tmp on Lambda).
    local_data_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("LOCAL_DATA_DIR", repo_root() / "data" / "local")
        )
    )

    top_k: int = field(default_factory=lambda: int(os.environ.get("TOP_K", "6")))


def load_settings() -> Settings:
    """The settings of this process, from the environment (read once): the variables the stack
    sets, and the "not set up" defaults for the resources it names when one is missing."""
    env = os.environ.get
    return replace(
        Settings(),
        graph_backend=env("GRAPH_BACKEND") or "memory",
        graph_id=env("GRAPH_ID", ""),
        agent_runtime_arn=env("AGENT_RUNTIME_ARN", ""),
        table_bucket_arn=env("TABLE_BUCKET_ARN", ""),
        lake_runtime_arn=env("LAKE_RUNTIME_ARN", ""),
        vector_bucket=env("VECTOR_BUCKET", ""),
    )
