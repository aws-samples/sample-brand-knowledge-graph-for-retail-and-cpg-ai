# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 0 · Start here, What's deployed: the read-only status of the stack's resources, the model
check before a deploy, and the settings read from the environment. Fake control-plane clients
(neptune-graph, s3tables), an in-memory graph."""

from __future__ import annotations

import json
import re
from dataclasses import replace

import pytest

from ontology_rag import api, setup
from ontology_rag.config import load_settings
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

ACCOUNT = "123456789012"
GRAPH_ID = "g-test000001"


class FakeNeptuneControl:
    """The neptune-graph control plane: one AVAILABLE graph."""

    def __init__(self):
        self.calls: list[str] = []

    def get_graph(self, graphIdentifier):
        self.calls.append(graphIdentifier)
        return {"id": graphIdentifier, "name": "t", "status": "AVAILABLE", "provisionedMemory": 16}

    def get_graph_summary(self, graphIdentifier):
        return {"graphSummary": {"numNodes": 3, "numEdges": 1}}


class FakeTables:
    """The s3tables client lakehouse.status reads: both tables exist."""

    class exceptions:
        NotFoundException = KeyError

    def get_table(self, tableBucketARN, namespace, name):
        return {"modifiedAt": "2026-11-09T10:00:00Z", "createdAt": "2026-11-01T10:00:00Z"}


@pytest.fixture
def svc(settings, tmp_path, monkeypatch):
    """A fresh service per test over a small in-memory graph, without a vector bucket."""
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    s = replace(settings, local_data_dir=tmp_path, vector_bucket="", graph_backend="memory")
    store = InMemoryStore()
    store.merge_nodes("Item", [{"id": "item:a", "props": {"name": "A"}}])
    return Service(s, store=store, embedder=MockEmbedder(256), blobs=MemoryBlobStore())


@pytest.fixture
def neptune(monkeypatch):
    fake = FakeNeptuneControl()
    monkeypatch.setattr(setup, "_client", lambda service, region: {"neptune-graph": fake}[service])
    return fake


def _as_deployed(svc, fakes3vectors) -> None:
    """The settings the stack gives the API function: the graph, the vector bucket, the agents'
    runtimes and the table bucket, every ARN with an account id in it."""
    svc.settings = replace(
        svc.settings,
        graph_backend="neptune",
        graph_id=GRAPH_ID,
        vector_bucket="multimodal-ai-knowledge-graph-vectors",
        agent_runtime_arn=f"arn:aws:bedrock-agentcore:us-east-1:{ACCOUNT}:runtime/query-x",
        lake_runtime_arn=f"arn:aws:bedrock-agentcore:us-east-1:{ACCOUNT}:runtime/lake-x",
        table_bucket_arn=f"arn:aws:s3tables:us-east-1:{ACCOUNT}:bucket/lake",
        guardrail_id="gr-1",
        guardrail_version="1",
    )
    svc.s3vectors = fakes3vectors
    svc.s3tables = FakeTables()


def test_setup_status_has_one_shape_and_withholds_the_account(svc, neptune):
    from fakes import FakeS3Vectors

    _as_deployed(svc, FakeS3Vectors())
    status, body = api.dispatch(svc, "GET", "/api/setup", {}, {})
    assert status == 200
    assert set(body) == {
        "region",
        "identity",
        "graph",
        "catalog",
        "agent",
        "models",
        "guardrail",
    }
    # no STS call: the account id and the role ARN stay out of the browser
    assert body["identity"] == setup.DEPLOYED_IDENTITY
    assert body["identity"]["account"] is None and body["identity"]["arn"] is None
    assert body["graph"]["active"] == "neptune" and body["graph"]["graph_id"] == GRAPH_ID
    assert body["graph"]["neptune"]["status"] == "AVAILABLE"
    assert body["graph"]["neptune"]["nodes"] == 3 and body["graph"]["network"] is None
    # tab 0's link opens the graph's page in the Neptune console (the URL its Graphs list links)
    assert body["graph"]["neptune"]["console_url"] == (
        "https://us-east-1.console.aws.amazon.com/neptune/home"
        f"?region=us-east-1#analytics-graph-details:id={GRAPH_ID}"
    )
    assert neptune.calls == [GRAPH_ID]
    assert body["catalog"] == {
        "configured": True,
        "vector_bucket": "multimodal-ai-knowledge-graph-vectors",
        "catalog_index": "catalog",
        "dimension": svc.settings.embedding_dimension,
    }
    assert set(body["agent"]) == {"host", "available", "reason", "runtime_arn"}
    assert body["agent"]["host"] == "agentcore" and body["agent"]["available"] is True
    assert body["agent"]["runtime_arn"] == "arn:aws:bedrock-agentcore:us-east-1:…:runtime/query-x"
    assert body["guardrail"] == {"configured": True, "guardrail_id": "gr-1", "version": "1"}
    assert body["models"]["embedding"] == svc.settings.embedding_model_id
    # ... and neither does the account id inside any ARN of the status
    assert not re.search(r"\b\d{12}\b", json.dumps(body))
    assert setup.redact_account(
        {"a": ["arn:aws:s3tables:us-east-1:123456789012:bucket/x"], "n": 3}
    ) == {"a": ["arn:aws:s3tables:us-east-1:…:bucket/x"], "n": 3}


def test_setup_status_without_a_graph_or_a_vector_bucket(svc, neptune):
    """The same keys when a resource is missing (the tests' service): nulls, no AWS call."""
    body = api.dispatch(svc, "GET", "/api/setup", {}, {})[1]
    assert body["graph"] == {"active": "memory", "graph_id": None, "neptune": None, "network": None}
    assert body["catalog"]["configured"] is False
    assert body["catalog"]["vector_bucket"] is None
    assert body["catalog"]["catalog_index"] is None
    assert body["agent"]["host"] is None and body["agent"]["runtime_arn"] is None
    assert body["guardrail"]["configured"] is False
    assert neptune.calls == []


def test_the_removed_setup_routes_answer_404(svc):
    """Tab 0 no longer creates or deletes anything, and the header no longer loads the sample:
    the stack owns every resource and the loader fills the graph at deploy."""
    for path, payload in [
        ("/api/setup/graph", {"action": "create"}),
        ("/api/setup/catalog", {"action": "create"}),
        ("/api/setup/lake", {"action": "create"}),
        ("/api/setup/agent", {"action": "use", "host": "in-process"}),
        ("/api/setup/models/check", {}),
        ("/api/admin/load-sample", {"reset": True}),
    ]:
        status, body = api.dispatch(svc, "POST", path, {}, payload)
        assert status == 404 and "no route" in body["error"], path


def test_tab_0_names_the_graphs_vpc_and_private_endpoint(svc, monkeypatch):
    """The graph is reachable only from the stack's VPC, through its private graph endpoint;
    tab 0 names both from the API's environment (VPC_ID, GRAPH_ENDPOINT_ID), with no AWS call.
    A stack without a VPC has no network block."""
    made: list[str] = []
    monkeypatch.setattr(setup, "_client", lambda service, region: made.append(service))
    assert setup.status(svc)["graph"]["network"] is None
    svc.settings = replace(
        svc.settings, vpc_id="vpc-0a1b2c3d4e5f67890", graph_endpoint_id="vpce-0f9e8d7c6b5a43210"
    )
    status, body = api.dispatch(svc, "GET", "/api/setup", {}, {})
    assert status == 200
    assert body["graph"]["network"] == {
        "vpc_id": "vpc-0a1b2c3d4e5f67890",
        "endpoint_id": "vpce-0f9e8d7c6b5a43210",
    }
    assert made == []  # no client was built: the ids come from the settings


def test_model_check_calls_each_model_once(svc):
    class Bedrock:
        def __init__(self):
            self.models: list[str] = []

        def converse(self, **request):
            self.models.append(request["modelId"])
            if "kimi-k3" in request["modelId"]:
                raise RuntimeError("AccessDeniedException: no access")
            return {"output": {"message": {"content": [{"text": "OK"}]}}}

    svc.bedrock = Bedrock()
    out = setup.check_models(svc)
    ids = set(svc.settings.vision_model_ids) | set(svc.settings.answer_model_ids)
    assert sorted(svc.bedrock.models) == sorted(ids)  # each model once, whatever its roles
    rows = {r["id"]: r for r in out["models"]}
    assert rows[svc.settings.embedding_model_id]["ok"] is True
    assert rows["global.moonshotai.kimi-k3"]["ok"] is False and out["ok"] is False
    assert rows["global.anthropic.claude-sonnet-5-5"]["roles"] == ["answer", "vision"]


def test_check_models_cli_prints_one_line_per_model(svc, monkeypatch, capsys):
    """`ontology-rag check-models`, the pre-flight before `cdk deploy`: id and verdict per model,
    exit status 1 when the account may not call one of them."""
    from ontology_rag import cli

    class Bedrock:
        def converse(self, **request):
            if "kimi-k3" in request["modelId"]:
                raise RuntimeError("AccessDeniedException: no access")
            return {"output": {"message": {"content": [{"text": "OK"}]}}}

    svc.bedrock = Bedrock()
    monkeypatch.setattr("ontology_rag.service.Service", lambda settings: svc)
    assert cli.main(["check-models"]) == 1
    lines = capsys.readouterr().out.strip().splitlines()
    rows = dict(line.split(None, 1) for line in lines)
    expected = {svc.settings.embedding_model_id, *svc.settings.vision_model_ids}
    expected |= set(svc.settings.answer_model_ids)
    assert set(rows) == expected
    assert (
        rows["global.moonshotai.kimi-k3"] == "error: RuntimeError: AccessDeniedException: no access"
    )
    assert rows[svc.settings.embedding_model_id] == "ok"


def test_the_cli_keeps_only_the_tools_that_need_no_graph(capsys):
    from ontology_rag import cli

    for gone in ("serve", "load", "ask", "graph-up", "agent-up", "lake-up", "export-dna"):
        with pytest.raises(SystemExit):
            cli.main([gone])
    capsys.readouterr()


def test_settings_come_from_the_environment_only(tmp_path, monkeypatch):
    """A record a former local run left in LOCAL_DATA_DIR is not read any more."""
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    for name in ("GRAPH_BACKEND", "GRAPH_ID", "VECTOR_BUCKET", "CATALOG_INDEX"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / "graph.json").write_text(json.dumps({"graph_id": "g-1", "use": True}))
    (tmp_path / "rag.json").write_text(json.dumps({"vector_bucket": "old-bucket"}))
    s = load_settings()
    assert s.graph_backend == "memory" and s.graph_id == "" and s.vector_bucket == ""
    assert s.catalog_index == "catalog"
    monkeypatch.setenv("GRAPH_BACKEND", "neptune")
    monkeypatch.setenv("GRAPH_ID", "g-2")
    monkeypatch.setenv("VECTOR_BUCKET", "the-stacks-bucket")
    monkeypatch.setenv("CATALOG_INDEX", "products")
    s = load_settings()
    assert (s.graph_backend, s.graph_id) == ("neptune", "g-2")
    assert (s.vector_bucket, s.catalog_index) == ("the-stacks-bucket", "products")
