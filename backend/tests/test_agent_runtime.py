# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 2's query agent on Amazon Bedrock AgentCore Runtime.

* the runtime side: ``agent_runtime.handle`` (what main.py runs in the microVM): validation, the
  one graph it serves, and the agent loop against the in-process Neptune MCP server;
* main.py itself, with the AgentCore SDK replaced by a stand-in (the SDK is in the agent zip,
  not in the test environment);
* the API side: ``Service.invoke_agent_runtime`` with a fake ``bedrock-agentcore`` client, the
  ``/api/graph/agent`` route and its session id.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import types
from dataclasses import replace
from pathlib import Path

import pytest

pytest.importorskip("awslabs.amazon_neptune_mcp_server")

from test_query_agent import GOOD, ROWS, FakeGraph, ScriptedAgent, in_process

from ontology_rag import agent_runtime, api, mcp_agent, query_agent, vision
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

GRAPH = "g-test000000"
ARN = "arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/OntologyQueryAgent-AbCdE12345"
SESSION = "tab-0123456789abcdef0123456789abcdef"  # 36 characters (AgentCore: at least 33)
SONNET = "global.anthropic.claude-sonnet-5-5"


@pytest.fixture
def graph(monkeypatch):
    from awslabs.amazon_neptune_mcp_server import server as neptune_mcp

    fake = FakeGraph()
    monkeypatch.setattr(neptune_mcp, "_graph", fake)
    return fake


@pytest.fixture
def runtime_env(monkeypatch):
    """The environment the CDK stack gives the runtime."""
    monkeypatch.setenv("GRAPH_ID", GRAPH)
    monkeypatch.setenv("GRAPH_REGION", "us-east-1")
    monkeypatch.setenv("LLM_MODEL_ID", SONNET)
    monkeypatch.setenv("ANSWER_MODEL_IDS", f"{SONNET},us.amazon.nova-pro-v1:0")
    monkeypatch.setattr(
        agent_runtime, "_SESSION", {"started": 0.0, "invocations": 0, "bedrock": None}
    )


# ---------------------------------------------------------------------- in the microVM
def test_handle_runs_the_agent_loop_and_reports_the_session(runtime_env, graph):
    bedrock = ScriptedAgent([("run", GOOD), ("say", "Jackets lead.")])
    out = agent_runtime.handle(
        {"text": "categories?", "graph_id": GRAPH}, SESSION, bedrock, in_process
    )
    assert out["query"] == GOOD and out["rows"] == ROWS and out["answer"] == "Jackets lead."
    assert out["model"]["id"] == SONNET  # LLM_MODEL_ID when the request names none
    assert out["mcp"]["endpoint"] == f"neptune-graph://{GRAPH}"
    assert out["runtime"]["host"] == "agentcore" and out["runtime"]["session_id"] == SESSION
    assert out["runtime"]["invocations_in_session"] == 1
    again = agent_runtime.handle(
        {"text": "again", "model_id": SONNET},
        SESSION,
        ScriptedAgent([("say", "Same.")]),
        in_process,
    )
    assert again["runtime"]["invocations_in_session"] == 2  # the same process: a warm session


@pytest.mark.parametrize(
    ("payload", "status", "words"),
    [
        ({}, 400, "text is required"),
        ("not an object", 400, "JSON object"),
        ({"text": "x", "model_id": "global.anthropic.claude-opus-5"}, 400, "not enabled"),
        ({"text": "x", "graph_id": "g-other00000"}, 409, "serves graph g-test000000"),
    ],
)
def test_handle_refuses_what_it_cannot_serve(runtime_env, payload, status, words):
    out = agent_runtime.handle(payload, SESSION, bedrock=object(), connect=None)
    assert out["status"] == status and words in out["error"]


def test_handle_needs_its_graph(runtime_env, monkeypatch):
    monkeypatch.delenv("GRAPH_ID")
    assert agent_runtime.handle({"text": "x"}, SESSION, bedrock=object())["status"] == 500


def test_the_mcp_server_runs_without_the_agents_instrumentation(monkeypatch):
    svc = types.SimpleNamespace(settings=types.SimpleNamespace(graph_id=GRAPH, region="eu-west-1"))
    otel = "/var/task/opentelemetry/instrumentation/auto_instrumentation"
    monkeypatch.setenv("PYTHONPATH", f"{otel}:/var/task")
    monkeypatch.setattr(mcp_agent, "package_root", lambda package: "/var/task")
    env = query_agent.server_parameters(svc)["env"]
    assert env["PYTHONPATH"] == "/var/task"  # the zip root, not ADOT's sitecustomize
    assert env["OTEL_SDK_DISABLED"] == "true"
    assert env["DO_NOT_TRACK"] == "true"  # no third-party usage pings from the server's libraries
    assert (
        env["NEPTUNE_ENDPOINT"] == f"neptune-graph://{GRAPH}" and env["AWS_REGION"] == "eu-west-1"
    )
    monkeypatch.delenv("PYTHONPATH")
    monkeypatch.setattr(mcp_agent, "package_root", lambda package: None)  # a venv
    assert "PYTHONPATH" not in query_agent.server_parameters(svc)["env"]


class FakeSessionServer:
    """Stands in for query_agent.SessionServer in main.py: no subprocess."""

    def __init__(self, settings, fail=False):
        self.settings, self.fail, self.starts = settings, fail, 0

    def start(self):
        if self.fail:
            raise RuntimeError("no server")
        self.starts += 1
        return 1.5


def _load_main(monkeypatch, server_class=FakeSessionServer):
    """backend/agentcore/main.py with stand-ins for the AgentCore SDK and the session server."""
    monkeypatch.setattr(query_agent, "SessionServer", server_class)
    runtime = types.ModuleType("bedrock_agentcore.runtime")

    class App:
        def entrypoint(self, fn):
            self.handler = fn
            return fn

    runtime.BedrockAgentCoreApp = App
    runtime.RequestContext = object
    monkeypatch.setitem(sys.modules, "bedrock_agentcore", types.ModuleType("bedrock_agentcore"))
    monkeypatch.setitem(sys.modules, "bedrock_agentcore.runtime", runtime)
    path = Path(__file__).resolve().parents[1] / "agentcore" / "main.py"
    spec = importlib.util.spec_from_file_location("agentcore_main", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_main_answers_failures_with_a_status_not_an_http_error(monkeypatch, runtime_env):
    main = _load_main(monkeypatch)
    context = types.SimpleNamespace(session_id=SESSION)
    seen = {}

    def handle(payload, session_id, server=None):
        seen["session"], seen["server"] = session_id, server
        return {"answer": "ok"}

    monkeypatch.setattr(agent_runtime, "handle", handle)
    assert main.app.handler({"text": "x"}, context) == {"answer": "ok"}
    assert seen["session"] == SESSION and seen["server"] is main.server  # the session's server

    def boom(payload, session_id, server=None):
        raise RuntimeError("the MCP server could not read the graph")

    monkeypatch.setattr(agent_runtime, "handle", boom)
    out = main.app.handler({"text": "x"}, context)
    assert out["status"] == 502 and "could not read the graph" in out["error"]


def test_main_starts_the_session_server_at_startup(monkeypatch, runtime_env, capsys):
    main = _load_main(monkeypatch)
    assert main.server.starts == 1 and main.server.settings.graph_id == GRAPH
    assert (
        "started in 1.5 s" in capsys.readouterr().err
    )  # at import: before app.run() and a V2 snapshot
    failing = _load_main(monkeypatch, lambda settings: FakeSessionServer(settings, fail=True))
    assert failing.server is not None  # a failed start does not stop the agent; requests retry
    monkeypatch.setenv("AGENT_SESSION_SERVER", "false")
    assert _load_main(monkeypatch).server is None  # every request starts its own server


def test_the_session_server_serves_every_request_and_restarts(monkeypatch, runtime_env, graph):
    monkeypatch.setattr(query_agent, "start_server", lambda svc: in_process())
    server = query_agent.SessionServer(agent_runtime.AgentSettings())
    try:
        assert server.start() >= 0 and server.starts == 1
        for answer in ("One.", "Two."):
            bedrock = ScriptedAgent([("run", GOOD), ("say", answer)])
            out = agent_runtime.handle({"text": "categories?"}, SESSION, bedrock, server=server)
            assert out["answer"] == answer and out["rows"] == ROWS
        assert server.starts == 1 and out["runtime"]["mcp_server"] == "kept for the session"
        server.close()  # a server that ended is started again by the next request
        out = agent_runtime.handle(
            {"text": "again"}, SESSION, ScriptedAgent([("say", "Three.")]), server=server
        )
        assert out["answer"] == "Three." and server.starts == 2
        server.max_age_s = 0  # an old server is replaced: the next one reads the schema again
        agent_runtime.handle(
            {"text": "x"}, SESSION, ScriptedAgent([("say", "Four.")]), server=server
        )
        assert server.starts == 3
    finally:
        server.close()


def test_the_session_server_starts_the_real_server_without_calling_the_graph(monkeypatch):
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.setenv(key, "test")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    settings = types.SimpleNamespace(graph_id="127.0.0.1:9", region="us-east-1")  # nothing listens
    server = query_agent.SessionServer(settings)
    try:
        assert server.start() > 0 and server._conn is not None
    finally:
        server.close()
    assert server._conn is None


# ---------------------------------------------------------------------- the API side
class FakeAgentCore:
    """``bedrock-agentcore``: InvokeAgentRuntime answers with the next scripted body."""

    def __init__(self, *bodies):
        self.bodies = list(bodies)
        self.calls: list[dict] = []

    def invoke_agent_runtime(self, **kw):
        self.calls.append(kw)
        body = self.bodies.pop(0)
        return {
            "response": io.BytesIO(json.dumps(body).encode()),
            "runtimeSessionId": kw["runtimeSessionId"],
            "traceId": "1-abc-def",
            "statusCode": 200,
        }


@pytest.fixture
def agent_svc(settings, tmp_path, monkeypatch):
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    s = replace(
        settings,
        local_data_dir=tmp_path,
        graph_backend="neptune",
        graph_id=GRAPH,
        agent_runtime_arn=ARN,
        answer_model_ids=(SONNET,),
        llm_model_id=SONNET,
    )
    return Service(
        s,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        blobs=MemoryBlobStore(),
        agentcore=FakeAgentCore(),
    )


def test_the_api_invokes_the_runtime_with_the_tabs_session(agent_svc):
    agent_svc._agentcore.bodies.append(
        {
            "query": GOOD,
            "rows": ROWS,
            "count": 2,
            "runtime": {"host": "agentcore", "session_id": SESSION},
        }
    )
    status, body = api.dispatch(
        agent_svc, "POST", "/api/graph/agent", {}, {"text": "categories?", "session_id": SESSION}
    )
    assert status == 200 and body["rows"] == ROWS
    call = agent_svc._agentcore.calls[0]
    assert call["agentRuntimeArn"] == ARN and call["qualifier"] == "DEFAULT"
    assert call["runtimeSessionId"] == SESSION
    assert call["contentType"] == call["accept"] == "application/json"
    sent = json.loads(call["payload"])
    examples = sent.pop("examples")
    # tab 3 chooses no reasoning effort: the payload says so, and the runtime keeps the request
    sent_model = {"model_id": SONNET, "effort": None}
    assert sent == {"text": "categories?", "error": None, **sent_model, "graph_id": GRAPH}
    # the graph domain's worked examples travel along: the runtime has no ontology folder
    assert examples and all(set(e) == {"question", "cypher"} for e in examples)
    runtime = body["runtime"]
    assert (
        runtime["arn"] == ARN and runtime["trace_id"] == "1-abc-def" and runtime["invoke_ms"] >= 0
    )
    assert agent_svc.health()["query_agent"]["host"] == "agentcore"


def test_without_a_session_id_the_api_makes_one(agent_svc):
    agent_svc._agentcore.bodies.append({"rows": []})
    agent_svc.query_agent("categories?")
    assert len(agent_svc._agentcore.calls[0]["runtimeSessionId"]) >= 33


@pytest.mark.parametrize(("status", "http"), [(400, 400), (409, 409), (502, 502), (500, 502)])
def test_what_the_runtime_refuses_maps_to_the_apis_status(agent_svc, status, http):
    agent_svc._agentcore.bodies.append({"error": "no", "status": status})
    code, body = api.dispatch(agent_svc, "POST", "/api/graph/agent", {}, {"text": "x"})
    assert code == http and "agent runtime: no" in body["error"]


def test_the_session_id_is_checked(agent_svc):
    for bad in ("short", "x" * 101, "has spaces in it and is long enough to pass 33"):
        code, body = api.dispatch(
            agent_svc, "POST", "/api/graph/agent", {}, {"text": "x", "session_id": bad}
        )
        assert code == 400 and "session_id" in body["error"]
    assert agent_svc._agentcore.calls == []


def test_the_api_waits_100_s_for_the_agent_and_the_agent_stops_well_before(settings, monkeypatch):
    """The API waits for the agent as long as for a model call (one attempt of 100 s, under the
    function's 115 s). The agent starts no model turn after 58 s of its 70 s, which leaves 30 s
    for the last turn's tool calls, a new session's first start and the way back. Its model turns
    are calls a browser waits for; the lake agent's job runs in the background."""
    svc = Service(settings, store=InMemoryStore(), embedder=MockEmbedder(256), s3vectors=object())
    waits = svc.agentcore._client_config
    assert (waits.read_timeout, waits.connect_timeout) == (vision.API_CALL_TIMEOUT_S, 5)
    assert waits.retries == {"total_max_attempts": 1, "mode": "standard"}
    assert (query_agent.DEADLINE_S, query_agent.MODEL_TURN_S) == (70, 12)
    assert query_agent.DEADLINE_S + 30 <= vision.API_CALL_TIMEOUT_S
    monkeypatch.setitem(agent_runtime._SESSION, "bedrock", None)
    monkeypatch.setitem(agent_runtime._SESSION, "bedrock_background", None)
    turns = agent_runtime._session_bedrock("us-east-1")
    job = agent_runtime._session_bedrock("us-east-1", background=True)
    assert (turns._client_config.read_timeout, job._client_config.read_timeout) == (100, 120)
    assert agent_runtime._session_bedrock("us-east-1") is turns  # one per session, reused


def test_a_background_job_gets_5_minutes_in_the_microvm(runtime_env, graph):
    """Tab 4's agent job sends ``deadline_s``; the runtime checks it, tab 2's requests send none."""
    job = agent_runtime.handle(
        {"text": "categories?", "deadline_s": 300},
        SESSION,
        ScriptedAgent([("run", GOOD), ("say", "Jackets lead.")]),
        in_process,
    )
    assert job["answer"] == "Jackets lead." and job["limits"]["deadline_s"] == 300
    assert job["limits"]["max_tool_calls"] == 12 and job["limits"]["tool_s"] == 25
    tab2 = agent_runtime.handle(
        {"text": "categories?"}, SESSION, ScriptedAgent([("say", "Same.")]), in_process
    )
    assert tab2["limits"] == {
        "deadline_s": 70.0,
        "model_turn_s": 12.0,
        "max_tool_calls": 6,
        "tool_s": None,
    }
    for bad in (900, 10, "300", True):
        out = agent_runtime.handle({"text": "x", "deadline_s": bad}, SESSION, bedrock=object())
        assert out["status"] == 400 and "deadline_s" in out["error"], bad


def test_the_job_waits_345_s_for_the_agent_inside_the_pipeline_functions_360_s(settings):
    """The chain of tab 4's agent job (query_agent.py says why): the function's 360 s hold the
    5 s connect and 345 s read of its one call, which hold the agent's 300 s and 45 s for a new
    session's start and the way back; the agent's turns and tool calls end within its 300 s."""
    from ontology_rag import jobs

    svc = Service(settings, store=InMemoryStore(), embedder=MockEmbedder(256), s3vectors=object())
    waits = svc.agentcore_job._client_config
    assert (waits.read_timeout, waits.connect_timeout) == (query_agent.JOB_READ_S, 5) == (345, 5)
    assert waits.retries == {"total_max_attempts": 1, "mode": "standard"}
    assert svc.agentcore_job is not svc.agentcore  # tab 2 keeps its 100 s
    assert svc.agentcore._client_config.read_timeout == vision.API_CALL_TIMEOUT_S
    assert jobs.FunctionJobs.RUN_S == 360
    assert vision.CONNECT_TIMEOUT_S + query_agent.JOB_READ_S + 10 == jobs.FunctionJobs.RUN_S
    assert query_agent.MAX_DEADLINE_S + 45 == query_agent.JOB_READ_S
    assert query_agent.JOB_MODEL_TURN_S == vision.CONNECT_TIMEOUT_S + vision.API_CALL_TIMEOUT_S


def test_the_api_side_of_a_job_sends_its_deadline_and_waits_longer(agent_svc):
    job_client = FakeAgentCore({"rows": ROWS, "runtime": {"host": "agentcore"}})
    agent_svc._agentcore_job = job_client
    session = "trends-graph-" + "a" * 32
    out = agent_svc.query_agent("emerging?", None, None, session, deadline_s=300)
    assert out["rows"] == ROWS and agent_svc._agentcore.calls == []  # not tab 2's client
    (call,) = job_client.calls
    assert call["runtimeSessionId"] == session and call["agentRuntimeArn"] == ARN
    assert json.loads(call["payload"])["deadline_s"] == 300
    with pytest.raises(ValueError, match="deadline_s"):  # checked before it leaves the API
        agent_svc.query_agent("emerging?", deadline_s=301)
    assert len(job_client.calls) == 1


def test_in_process_when_no_runtime_is_set(agent_svc, graph):
    agent_svc.settings = replace(agent_svc.settings, agent_runtime_arn="")
    agent_svc.mcp_connect = in_process
    agent_svc.bedrock = ScriptedAgent([("run", GOOD), ("say", "Two.")])
    out = agent_svc.query_agent("categories?")
    assert out["runtime"]["host"] == "in-process" and out["rows"] == ROWS
    assert agent_svc._agentcore.calls == []


def test_installed_is_false_when_the_parent_package_is_missing():
    # importlib.util.find_spec raises for a dotted name whose parent is absent; the API Lambda
    # has no `awslabs` package (the MCP servers live in the agents' zips) and tab 0 asks anyway.
    from ontology_rag import mcp_agent

    assert mcp_agent.installed("awslabs_not_installed_anywhere.some_server") is False
    assert mcp_agent.installed("json") is True
    assert mcp_agent.package_root("awslabs_not_installed_anywhere.some_server") is None
