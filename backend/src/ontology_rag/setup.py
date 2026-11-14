# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 0 · Start here, its What's deployed expander: the AWS resources this sample runs on.

The CloudFormation stack creates and owns every resource; this module only reports them
(``GET /api/setup``, :func:`status`). It also holds the pre-flight a developer runs before a
deploy, ``ontology-rag check-models`` (:func:`check_models`): a CLI step, not a route, because
every check spends model calls.
"""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor

from ontology_rag.embeddings import INDEX
from ontology_rag.errors import public_message
from ontology_rag.vision import model_info

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------- what is set up
def status(svc, neptune=None) -> dict:
    """Everything tab 0 shows: the Region, the graph, the vector indexes, where the agents run,
    the models and the guardrail. The same shape on every call, with the account id of every ARN
    withheld (:func:`redact_account`)."""
    s = svc.settings
    out = {
        "region": s.region,
        "identity": DEPLOYED_IDENTITY,
        "graph": {
            "active": s.graph_backend,
            "graph_id": s.graph_id or None,
            "neptune": neptune_status(s, s.graph_id, neptune) if s.graph_id else None,
            # The VPC the graph is reachable from and its private endpoint there, from the API's
            # environment (no AWS call).
            "network": {"vpc_id": s.vpc_id, "endpoint_id": s.graph_endpoint_id}
            if s.vpc_id
            else None,
        },
        # The product catalog: one index of an Amazon S3 Vectors bucket, what RAG and GraphRAG
        # search.
        "catalog": {
            "configured": bool(svc.s3vectors),
            "vector_bucket": s.vector_bucket or None,
            "catalog_index": s.catalog_index if s.vector_bucket else None,
            "dimension": s.embedding_dimension,
        },
        "agent": agent_status(svc),
        "models": {
            "embedding": s.embedding_model_id,
            "vision": list(s.vision_model_ids),
            "answer": list(s.answer_model_ids),
        },
        # The Amazon Bedrock guardrail on what a participant types (guardrail.py, the stack's).
        "guardrail": {
            "configured": bool(s.guardrail_id),
            "guardrail_id": s.guardrail_id or None,
            "version": s.guardrail_version or None,
        },
    }
    # The browser gets resource names but not the account id the ARNs carry (the same
    # information the identity block withholds).
    return redact_account(out)


_ACCOUNT_IN_ARN = re.compile(r"(arn:[^:]*:[^:]*:[^:]*:)\d{12}:")


def redact_account(value):
    """The same structure with the 12-digit account id of every ARN replaced by ``…``."""
    if isinstance(value, str):
        return _ACCOUNT_IN_ARN.sub(r"\1…:", value)
    if isinstance(value, dict):
        return {k: redact_account(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_account(v) for v in value]
    return value


# The API runs as the stack's execution role; its account id and role ARN are not the browser's
# business, so no STS call is made and the UI only names the source.
DEPLOYED_IDENTITY = {"account": None, "arn": None, "source": "the stack's execution role"}


def neptune_status(settings, graph_id: str, neptune=None) -> dict:
    neptune = neptune or _client("neptune-graph", settings.region)
    try:
        g = neptune.get_graph(graphIdentifier=graph_id)
    except Exception as exc:  # noqa: BLE001 - deleted outside the app, no permission, …
        log.warning("GetGraph %s failed: %s", graph_id, exc)
        return {"graph_id": graph_id, "status": "UNKNOWN", "error": public_message(exc)[:300]}
    out = {
        "graph_id": graph_id,
        "name": g.get("name"),
        "status": g.get("status"),
        "memory": g.get("provisionedMemory"),
        "public": g.get("publicConnectivity"),
        "dimension": (g.get("vectorSearchConfiguration") or {}).get("dimension"),
        "endpoint": g.get("endpoint"),
        # the graph's page in the Neptune console (Analytics, Graphs)
        "console_url": f"https://{settings.region}.console.aws.amazon.com/neptune/home"
        f"?region={settings.region}#analytics-graph-details:id={graph_id}",
    }
    if out["status"] == "AVAILABLE":
        try:
            summary = neptune.get_graph_summary(graphIdentifier=graph_id)["graphSummary"]
            out["nodes"], out["edges"] = summary.get("numNodes"), summary.get("numEdges")
        except Exception as exc:  # noqa: BLE001 - counts are a nicety
            log.info("graph summary of %s unavailable: %s", graph_id, exc)
    return out


def agent_status(svc) -> dict:
    """Where tab 3's query agent runs: on the stack's AgentCore Runtime, or (the tests) in this
    process."""
    now = svc.query_agent_status()
    return {
        "host": now["host"],
        "available": now["available"],
        "reason": now["reason"],
        "runtime_arn": svc.settings.agent_runtime_arn or None,
    }


# ---------------------------------------------------------------------- Amazon Bedrock access
def check_models(svc) -> dict:
    """The pre-flight before a deploy (``ontology-rag check-models``): one tiny request per model
    the sample uses, a Converse "reply OK" per vision and answer model and one Nova embedding.
    Any answer means the account may call the model."""
    s = svc.settings
    roles: dict[str, set[str]] = {}
    for mid in s.vision_model_ids:
        roles.setdefault(mid, set()).add("vision")
    for mid in s.answer_model_ids:
        roles.setdefault(mid, set()).add("answer")

    def converse(model_id: str) -> dict:
        t0 = time.perf_counter()
        try:
            svc.bedrock.converse(
                modelId=model_id,
                messages=[{"role": "user", "content": [{"text": "Reply with OK."}]}],
                inferenceConfig={"maxTokens": 64},
            )
            ok, error = True, None
        except Exception as exc:  # noqa: BLE001 - the error is the answer
            log.warning("model check %s: %s", model_id, exc)
            ok, error = False, public_message(exc)[:400]
        return {"ok": ok, "error": error, "ms": int((time.perf_counter() - t0) * 1000)}

    def embed() -> dict:
        t0 = time.perf_counter()
        try:
            svc.embedder.embed_text("ping", INDEX)
            ok, error = True, None
        except Exception as exc:  # noqa: BLE001
            log.warning("model check %s: %s", s.embedding_model_id, exc)
            ok, error = False, public_message(exc)[:400]
        return {"ok": ok, "error": error, "ms": int((time.perf_counter() - t0) * 1000)}

    with ThreadPoolExecutor(8) as pool:
        futures = {mid: pool.submit(converse, mid) for mid in roles}
        embedding = pool.submit(embed)
        rows = [
            {
                "id": s.embedding_model_id,
                "name": "Amazon Nova Multimodal Embeddings",
                "roles": ["embedding"],
                **embedding.result(),
            }
        ]
        for mid, fut in futures.items():
            rows.append(
                {"id": mid, "name": _name(mid), "roles": sorted(roles[mid]), **fut.result()}
            )
    return {"models": rows, "ok": all(r["ok"] for r in rows)}


# ---------------------------------------------------------------------- helpers
def _client(service: str, region: str):
    import boto3

    return boto3.client(service, region_name=region)


def _name(model_id: str) -> str:
    try:
        return model_info(model_id).name
    except (KeyError, ValueError):
        return model_id
