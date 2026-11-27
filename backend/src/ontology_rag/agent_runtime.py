# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The query agent (tab 3, and method 1 of tab 6's trends question) as an Amazon Bedrock
AgentCore Runtime agent.

Deployed, the API no longer runs the agent: it calls ``InvokeAgentRuntime`` and AgentCore runs
:func:`handle` in a microVM of its own per session: the Converse tool loop of query_agent.py,
unchanged, and the Amazon Neptune MCP server as its stdio subprocess. The runtime's execution role
is the only identity the agent and the server have: Bedrock ``InvokeModel`` and
``neptune-graph:ReadDataViaQuery`` on one graph, nothing else.

The zip AgentCore runs is built by infra/ (``copyAgentBundle``): ``main.py`` at its root wraps
:func:`handle` in the AgentCore SDK's ``BedrockAgentCoreApp`` (``POST /invocations``, ``GET
/ping`` on port 8080), started through ``opentelemetry-instrument`` for AgentCore Observability.
This module itself has no AgentCore dependency, so it is tested like the rest of the package.

The trends question's lake agent (lake_agent.py) runs on a runtime of its own
(backend/agentcore-lake/main.py → :func:`handle_lake`): its execution role may read and write the
sample's S3 table bucket and call the answer models, and has no access to the graph; the API sends
it the rows to export.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

from ontology_rag import guardrail, jobs, lake_agent, lakehouse, query_agent
from ontology_rag.vision import bedrock_client, model_info, with_effort

MAX_TEXT = 4000
MAX_ERROR = 2000
# Per-process state, set on the first request and not at import: on AgentCore Runtime V2 the process
# is started once and restored from a snapshot for every session, so a value computed at import
# time (a timestamp, a client with live connections) would be the snapshot's, not the session's.
_SESSION = {"started": 0.0, "invocations": 0, "bedrock": None, "bedrock_background": None}
_LAKE = {"jobs": None, "catalog": None}


def _ids(name: str, default: str = "") -> tuple[str, ...]:
    return tuple(m.strip() for m in os.environ.get(name, default).split(",") if m.strip())


@dataclass(frozen=True)
class AgentSettings:
    """What the agent needs from its environment (set on the runtime by the CDK stack)."""

    graph_id: str = field(default_factory=lambda: os.environ.get("GRAPH_ID", ""))
    region: str = field(
        default_factory=lambda: (
            os.environ.get("GRAPH_REGION")
            or os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        )
    )
    answer_model_ids: tuple[str, ...] = field(default_factory=lambda: _ids("ANSWER_MODEL_IDS"))
    llm_model_id: str = field(default_factory=lambda: os.environ.get("LLM_MODEL_ID", ""))
    # The guardrail on the typed question (guardrail.py); empty: none.
    guardrail_id: str = field(default_factory=lambda: os.environ.get("GUARDRAIL_ID", ""))
    guardrail_version: str = field(default_factory=lambda: os.environ.get("GUARDRAIL_VERSION", ""))


@dataclass(frozen=True)
class LakeSettings:
    """The lake agent's environment (its own runtime, set by the CDK stack): the sample's table
    bucket and the models it may use. ``table_bucket_arn`` and ``region`` are what
    lake_agent.execute fills into every query_database call."""

    table_bucket_arn: str = field(default_factory=lambda: os.environ.get("TABLE_BUCKET_ARN", ""))
    region: str = field(
        default_factory=lambda: (
            os.environ.get("LAKE_REGION")
            or os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        )
    )
    answer_model_ids: tuple[str, ...] = field(default_factory=lambda: _ids("ANSWER_MODEL_IDS"))
    llm_model_id: str = field(default_factory=lambda: os.environ.get("LLM_MODEL_ID", ""))


@dataclass
class AgentContext:
    """The two things an agent loop reads from the service: settings and a Bedrock client."""

    settings: AgentSettings | LakeSettings
    bedrock: object


# ---------------------------------------------------------------------- the query agent
def handle(
    payload: dict, session_id: str | None = None, bedrock=None, connect=None, server=None
) -> dict:
    """One invocation: ``{text, error?, model_id?, effort?, graph_id?, examples?, deadline_s?}``
    in, the agent's result out, or ``{"error", "status"}`` for a request the agent cannot serve.
    ``effort`` is the reasoning effort of the run (vision.with_effort; ``None``: no setting).
    ``examples`` are the graph domain's worked examples the API sends along
    (query_agent.clean_examples drops what is not a read-only {question, cypher} pair);
    ``deadline_s`` is a background job's (the trends question's, at most
    query_agent.MAX_DEADLINE_S; without it the limits of an answer the API waits for). ``server``
    is the session's :class:`query_agent.SessionServer` (main.py); without one, the MCP server is
    started for this request (``connect``: the tests' in-process server)."""
    runtime = _session_runtime(session_id)
    settings = AgentSettings()
    try:
        text, error, model = _validate(payload, settings)
        limits = query_agent.limits_for(payload.get("deadline_s"))
    except (TypeError, ValueError) as exc:
        return {"error": str(exc), "status": 400}
    if not settings.graph_id:
        return {"error": "the runtime has no GRAPH_ID", "status": 500}
    if payload.get("graph_id") and payload["graph_id"] != settings.graph_id:
        return {
            "error": f"this agent serves graph {settings.graph_id}, not {payload['graph_id']}",
            "status": 409,
        }
    context = AgentContext(settings, _session_bedrock(settings.region, bedrock))
    examples = query_agent.clean_examples(payload.get("examples"))
    try:
        if server is not None and connect is None:
            result = server.run(context, text, error, model, examples, limits)
        else:
            result = query_agent.run(context, text, error, model, connect, examples, limits)
    except guardrail.Blocked as exc:
        return {"error": str(exc), "status": 422}
    result["runtime"] = {**runtime, **_server_facts(server, "request")}
    return result


def _validate(payload: dict, settings: AgentSettings | LakeSettings):
    if not isinstance(payload, dict):
        raise TypeError("the payload must be a JSON object")
    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("text is required")
    error = str(payload.get("error") or "").strip()[:MAX_ERROR] or None
    model_id = str(payload.get("model_id") or "") or settings.llm_model_id
    if settings.answer_model_ids and model_id not in settings.answer_model_ids:
        raise ValueError(f"model {model_id!r} is not enabled (ANSWER_MODEL_IDS)")
    # the run's reasoning effort, checked against the model's levels here too (a 400)
    return text[:MAX_TEXT], error, with_effort(model_info(model_id), payload.get("effort"))


def _session_runtime(session_id: str | None) -> dict:
    """Count the invocation and describe the session: the ``runtime`` block of every answer."""
    if not _SESSION["started"]:
        _SESSION["started"] = time.time()
    _SESSION["invocations"] += 1
    return {
        "host": "agentcore",
        "session_id": session_id,
        "invocations_in_session": _SESSION["invocations"],
        "session_age_s": int(time.time() - _SESSION["started"]),
    }


def _session_bedrock(region: str, bedrock=None, background: bool = False):
    """One ``bedrock-runtime`` client per session, made on the first request and reused. The
    query agent answers while the API waits (one attempt of at most 100 s per model turn, under
    the API's own 100 s wait for the agent; the trends question's background job keeps that much
    in reserve, query_agent.JOB_MODEL_TURN_S); the lake agent's job runs in the ``background``
    (vision.bedrock_client)."""
    if bedrock is not None:
        return bedrock
    key = "bedrock_background" if background else "bedrock"
    if _SESSION[key] is None:
        _SESSION[key] = bedrock_client(region, background=background)
    return _SESSION[key]


def _server_facts(server, unit: str) -> dict:
    """Whether the MCP server was kept for the session (main.py) or started for this ``unit``."""
    return {
        "mcp_server": "kept for the session" if server is not None else f"started for this {unit}",
        "mcp_server_starts": server.starts if server is not None else None,
    }


# ---------------------------------------------------------------------- the lake agent
def handle_lake(
    payload: dict, session_id: str | None = None, bedrock=None, server=None, catalog=None
) -> dict:
    """One invocation of the lake agent's runtime, by ``task``:

    * ``export``: ``{tables: {items: [...], item_features: [...]}}`` (the API read them from the
      graph): checked against lake_tables.json, then both Iceberg tables overwritten (PyIceberg,
      the S3 Tables Iceberg REST endpoint);
    * ``ask``, ``{text, model_id?, effort?}``: the agent starts as a background job of this
      microVM; returns ``{job_id, status}``;
    * ``poll``, ``{job_id}``: the job's state, and its result when done (same session).
    """
    runtime = _session_runtime(session_id)
    settings = LakeSettings()
    if not settings.table_bucket_arn:
        return {"error": "the runtime has no TABLE_BUCKET_ARN", "status": 500}
    if not isinstance(payload, dict):
        return {"error": "the payload must be a JSON object", "status": 400}
    task = payload.get("task")
    if task == "export":
        return _lake_export(payload, settings, runtime, catalog)
    if task == "poll":
        return _lake_poll(payload, runtime)
    if task == "ask":
        return _lake_ask(payload, settings, runtime, bedrock, server)
    return {"error": "task must be export, ask or poll", "status": 400}


def lake_jobs() -> jobs.Jobs:
    """The session's background jobs (main.py watches them to report the session busy)."""
    if _LAKE["jobs"] is None:
        _LAKE["jobs"] = jobs.Jobs(prefix="lake")
    return _LAKE["jobs"]


def _lake_export(payload: dict, settings: LakeSettings, runtime: dict, catalog) -> dict:
    try:
        tables = lakehouse.check(payload.get("tables"))
    except (TypeError, ValueError) as exc:
        return {"error": str(exc), "status": 400}
    t0 = time.perf_counter()
    if catalog is None:
        if _LAKE["catalog"] is None:  # one REST catalog per session (its token is reused)
            _LAKE["catalog"] = lakehouse.catalog(settings.table_bucket_arn, settings.region)
        catalog = _LAKE["catalog"]
    written = lakehouse.write(catalog, tables)
    return {
        "tables": written,
        "write_ms": int((time.perf_counter() - t0) * 1000),
        "runtime": runtime,
    }


def _lake_poll(payload: dict, runtime: dict) -> dict:
    job = lake_jobs().get(str(payload.get("job_id") or ""))
    if job is None:
        return {"error": "no such job in this session", "status": 404}
    return {**job, "runtime": runtime}


def _lake_ask(payload: dict, settings: LakeSettings, runtime: dict, bedrock, server) -> dict:
    try:
        text, _, model = _validate(payload, settings)
    except (TypeError, ValueError) as exc:
        return {"error": str(exc), "status": 400}
    context = AgentContext(settings, _session_bedrock(settings.region, bedrock, background=True))

    def work() -> dict:
        if server is not None:
            out = server.call(lake_agent.agent_loop, context, text, model)
        else:
            out = lake_agent.run(context, text, model)
        out["runtime"] = {**runtime, **_server_facts(server, "job")}
        return out

    return {**lake_jobs().start(work), "runtime": runtime}
