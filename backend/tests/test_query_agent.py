# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The query agent of tab 2 with the real Amazon Neptune MCP server.

Two set-ups, both with Bedrock replaced by a script (``ScriptedAgent``):

* in process: the server's own ``mcp`` object over the SDK's in-memory transport, with the graph
  object behind it (``server._graph``) replaced by ``FakeGraph``;
* end to end: the server started exactly as the API starts it (stdio subprocess, ``LAUNCH``),
  pointed at a local HTTP stand-in for the Neptune Analytics ``ExecuteQuery`` API. This is the
  test that covers reading Neptune's error back from the server's log.
"""

from __future__ import annotations

import contextlib
import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from typing import ClassVar

import pytest

pytest.importorskip("awslabs.amazon_neptune_mcp_server")

from awslabs.amazon_neptune_mcp_server import server as neptune_mcp
from awslabs.amazon_neptune_mcp_server.exceptions import NeptuneException
from awslabs.amazon_neptune_mcp_server.models import (
    GraphSchema,
    Node,
    Property,
    Relationship,
    RelationshipPattern,
)

from ontology_rag import api, query_agent, vision
from ontology_rag.errors import NotReady
from ontology_rag.graph.neptune import is_write_query
from ontology_rag.vision import model_info

MODEL = model_info("global.anthropic.claude-sonnet-5-5")
BAD = "MATCH (i:Item)-[:IS_CATEGORY]->(c:Category RETURN c.name AS category, count(i) AS items"
GOOD = "MATCH (i:Item)-[:IS_CATEGORY]->(c:Category) RETURN c.name AS category, count(i) AS items"
ROWS = [{"category": "jacket", "items": 9}, {"category": "dress", "items": 7}]


class ScriptedAgent:
    """A ``bedrock-runtime`` client for the agent loop: each Converse turn is the next entry of
    the script: ``("run", query)`` asks for run_opencypher_query, ``("say", text)`` answers."""

    def __init__(self, script):
        self.script = list(script)
        self.requests: list[dict] = []

    def converse(self, **request):
        self.requests.append(copy.deepcopy(request))  # the loop appends to the same messages
        kind, value = self.script.pop(0)
        n = len(self.requests)
        if kind == "run":
            content = [
                {"text": "Running it."},
                {
                    "toolUse": {
                        "toolUseId": f"t{n}",
                        "name": "run_opencypher_query",
                        "input": {"query": value},
                    }
                },
            ]
        else:
            content = [{"text": value}]
        return {
            "output": {"message": {"role": "assistant", "content": content}},
            "stopReason": "tool_use" if kind == "run" else "end_turn",
            "usage": {"inputTokens": 900, "outputTokens": 60, "cacheReadInputTokens": 0},
            "metrics": {"latencyMs": 5},
        }


class FakeGraph:
    """Stands in for the server's NeptuneServer: a schema, and openCypher that fails on
    unbalanced parentheses (like Neptune's parser) and returns ROWS otherwise."""

    def __init__(self):
        self.queries: list[str] = []

    def status(self):
        return "Available"

    def schema(self):
        return GraphSchema(
            nodes=[
                Node(labels="Item", properties=[Property(name="name", type=["String"])]),
                Node(labels="Category", properties=[Property(name="name", type=["String"])]),
            ],
            relationships=[Relationship(type="IS_CATEGORY", properties=[])],
            relationship_patterns=[
                RelationshipPattern(left_node="Item", relation="IS_CATEGORY", right_node="Category")
            ],
        )

    def query_opencypher(self, query, parameters=None):
        self.queries.append(query)
        if query.count("(") != query.count(")"):
            raise NeptuneException({"message": "An error occurred", "details": "Invalid input"})
        return ROWS

    def query_gremlin(self, query):
        raise NotImplementedError


def _svc(script, graph_id="g-test000000"):
    return SimpleNamespace(
        bedrock=ScriptedAgent(script),
        settings=SimpleNamespace(graph_id=graph_id, region="us-east-1"),
    )


@pytest.fixture
def graph(monkeypatch):
    fake = FakeGraph()
    monkeypatch.setattr(neptune_mcp, "_graph", fake)
    return fake


@contextlib.asynccontextmanager
async def in_process():
    from mcp import Client

    async with Client(neptune_mcp.mcp) as client:
        yield client, None  # no subprocess, so no server log to read back


# ---------------------------------------------------------------------- in process
def test_agent_fixes_a_failed_query_through_the_mcp_tools(graph):
    svc = _svc([("run", BAD), ("run", GOOD), ("say", "Jackets lead with 9 items.")])
    out = query_agent.run(svc, BAD, "MalformedQueryException: Invalid input", MODEL, in_process)

    assert out["query"] == GOOD and out["rows"] == ROWS and out["count"] == 2
    assert out["answer"] == "Jackets lead with 9 items." and out["stopped"] is None
    assert graph.queries == [BAD, GOOD]  # both went through the MCP server
    kinds = [(s["kind"], s["name"], s["ok"]) for s in out["steps"]]
    assert kinds == [
        ("mcp", "list_tools", True),
        ("mcp", "get_graph_schema", True),
        ("model", MODEL.name, True),
        ("mcp", "run_opencypher_query", False),
        ("model", MODEL.name, True),
        ("mcp", "run_opencypher_query", True),
        ("model", MODEL.name, True),
    ]
    assert [s["n"] for s in out["steps"]] == list(range(1, 8))

    first, second = svc.bedrock.requests[0], svc.bedrock.requests[1]
    # the MCP tools the model may call, with the JSON schema the server published
    specs = [t["toolSpec"] for t in first["toolConfig"]["tools"]]
    assert [s["name"] for s in specs] == ["get_graph_schema", "run_opencypher_query"]
    assert "query" in specs[1]["inputSchema"]["json"]["properties"]
    # the schema (read through the server) is in the system prompt, cached for Claude
    assert "(:Item)-[:IS_CATEGORY]->(:Category)" in first["system"][0]["text"]
    assert first["system"][1] == {"cachePoint": {"type": "default"}}
    assert "temperature" not in first["inferenceConfig"]  # Claude 5.x takes none
    # the request and Neptune's error are the user turn
    user = first["messages"][0]["content"][0]["text"]
    assert BAD in user and "MalformedQueryException" in user
    # the failed call went back to the model as an error toolResult
    tool_result = second["messages"][-1]["content"][0]["toolResult"]
    assert tool_result["status"] == "error" and tool_result["toolUseId"] == "t1"
    assert out["mcp"]["tools"] == [
        "get_graph_status",
        "get_graph_schema",
        "run_opencypher_query",
        "run_gremlin_query",
    ]
    assert out["metrics"]["turns"] == 3 and out["metrics"]["tool_calls"] == 2


def test_agent_never_sends_a_write_to_the_server(graph):
    svc = _svc([("run", "MATCH (n) DETACH DELETE n"), ("say", "I can only read the graph.")])
    out = query_agent.run(svc, "delete everything", None, MODEL, in_process)

    assert graph.queries == []  # the guard answered; the server never saw it
    guard = out["steps"][3]
    assert guard["kind"] == "guard" and not guard["ok"] and "read-only" in guard["error"]
    assert out["query"] is None and out["rows"] == []
    result = svc.bedrock.requests[1]["messages"][-1]["content"][0]["toolResult"]
    assert result["status"] == "error"


def test_agent_never_sends_neptune_read_to_the_server(graph):
    """CALL neptune.read() reads an S3 object with the runtime's role: outside the graph."""
    s3_read = "CALL neptune.read({source: 's3://b/k', format: 'csv'}) YIELD row RETURN row"
    svc = _svc([("run", s3_read), ("say", "I can only read the graph.")])
    out = query_agent.run(svc, "read s3://b/k", None, MODEL, in_process)

    assert graph.queries == []  # the guard answered; the server never saw it
    guard = out["steps"][3]
    assert guard["kind"] == "guard" and not guard["ok"] and "neptune.read" in guard["error"]
    assert "neptune.read (it reads S3)" in query_agent.SYSTEM_PROMPT


def test_agent_stops_after_the_tool_budget(graph):
    script = [("run", GOOD)] * (query_agent.MAX_TOOL_CALLS + 1) + [("say", "never reached")]
    out = query_agent.run(_svc(script), "categories?", None, MODEL, in_process)
    assert out["stopped"] == "tools"
    assert out["metrics"]["tool_calls"] == query_agent.MAX_TOOL_CALLS
    assert out["query"] == GOOD and out["rows"] == ROWS


def test_a_background_job_asks_for_5_minutes_and_nothing_else():
    """Tab 4's agent job: its deadline travels in the request, so the runtime checks it."""
    default = query_agent.limits_for()
    assert (default.deadline_s, default.model_turn_s, default.max_tool_calls) == (70, 12, 6)
    assert default.tool_s is None  # tab 2 and tab 3: the synchronous path as it was
    job = query_agent.limits_for(300)
    assert job == query_agent.Limits(300.0, 105.0, 12, 25.0)
    # a model turn's whole budget: the runtime's client (5 s to connect, 100 s to read, 1 attempt)
    assert query_agent.JOB_MODEL_TURN_S == vision.CONNECT_TIMEOUT_S + vision.API_CALL_TIMEOUT_S
    assert query_agent.JOB_MAX_TOOL_CALLS == 2 * query_agent.MAX_TOOL_CALLS
    for bad in (301, 105, 0, -1, float("nan"), float("inf"), "300", True, [300]):
        with pytest.raises(ValueError, match="deadline_s"):
            query_agent.limits_for(bad)


def test_a_job_may_make_twice_the_tool_calls_and_reports_each_step(graph):
    script = [("run", GOOD)] * (query_agent.JOB_MAX_TOOL_CALLS + 1) + [("say", "never reached")]
    heard: list[str] = []
    limits = query_agent.limits_for(300)
    out = query_agent.run(
        _svc(script), "categories?", None, MODEL, in_process, (), limits, heard.append
    )
    assert out["stopped"] == "tools" and out["metrics"]["tool_calls"] == 12
    assert out["limits"] == {
        "deadline_s": 300.0,
        "model_turn_s": 105.0,
        "max_tool_calls": 12,
        "tool_s": 25.0,
    }
    assert heard[0] == "model turn 1: → run_opencypher_query"
    assert heard[1].startswith("tool call 1: run_opencypher_query, ")
    assert len(heard) == 2 * 12 + 1  # every turn and every call, the last turn too


class SlowAgent(ScriptedAgent):
    """A first model turn that takes ``turn_s`` seconds on the loop's clock."""

    def __init__(self, script, clock: dict, turn_s: float):
        super().__init__(script)
        self.clock, self.turn_s = clock, turn_s

    def converse(self, **request):
        self.clock["t"] += self.turn_s
        return super().converse(**request)


@pytest.mark.parametrize(
    ("limits", "ran"),
    [
        (query_agent.limits_for(300), []),  # 280 s in: a 25 s query might end after 300 s
        (query_agent.limits_for(), [GOOD]),  # the synchronous path runs it, as before
    ],
)
def test_a_job_starts_no_tool_call_that_might_not_end_before_its_deadline(
    graph, monkeypatch, limits, ran
):
    from ontology_rag import mcp_agent

    clock = {"t": 0.0}
    monkeypatch.setattr(mcp_agent, "time", SimpleNamespace(perf_counter=lambda: clock["t"]))
    svc = _svc([])
    svc.bedrock = SlowAgent([("run", GOOD), ("say", "never reached")], clock, 280)
    out = query_agent.run(svc, "categories?", None, MODEL, in_process, (), limits)
    assert graph.queries == ran and out["stopped"] == "time"
    if not ran:
        late = out["steps"][-1]
        assert late["kind"] == "guard" and late["error"] == "not run: the agent's time is up"


def test_neptune_error_reads_the_server_log():
    log = (
        "Traceback (most recent call last):\n"
        "botocore.errorfactory.ValidationException: An error occurred (ValidationException) …\n"
        "awslabs.amazon_neptune_mcp_server.exceptions.NeptuneException: {'message': 'An error "
        "occurred while executing the query.', 'details': 'An error occurred "
        "(MalformedQueryException) when calling the ExecuteQuery operation: Invalid input "
        "\\'RETURN\\': expected \\')\\''}\n"
        "\nThe above exception was the direct cause of the following exception:\n\n"
        "mcp.server.mcpserver.exceptions.UnexpectedToolError: Error executing tool x\n"
    )
    assert (
        query_agent.neptune_error(log)
        == "MalformedQueryException: Invalid input 'RETURN': expected ')'"
    )
    assert query_agent.neptune_error("nothing here") is None


def test_write_guard_covers_mutate_algorithms():
    assert is_write_query("CALL neptune.algo.pageRank.mutate({writeProperty: 'rank'})")
    assert is_write_query("match (n) detach delete n")
    assert not is_write_query("MATCH (n:Item) RETURN n.name AS name, n.settled AS s")


def test_write_guard_reads_backtick_quoted_and_spaced_names():
    """openCypher lets a procedure name be quoted per part and spaced around its dots."""
    for cypher in (
        "CALL `neptune`.`algo`.`pageRank`.`mutate`({writeProperty: 'x'})",
        "CALL neptune.algo.pageRank.`mutate`({writeProperty: 'x'})",
        "CALL `neptune.algo.pageRank.mutate`({writeProperty: 'x'})",
        "CALL neptune . load({source: 's3://b/k', format: 'csv'})",
        "CALL `neptune`.`load`({source: 's3://b/k', format: 'csv'})",
        "CALL `neptune`.`algo`.`vectors`.`upsert`('id', [0.1])",
        "CALL neptune.algo.vectors.`remove`('id')",
        "CALL `neptune`.`read`({source: 's3://b/k', format: 'csv'})",
        "MATCH (`n`) DETACH DELETE`n`",
    ):
        assert is_write_query(cypher), cypher
    for cypher in (
        "MATCH (n) RETURN n.name AS `a.b`",
        "MATCH (n:`Item`) WHERE n.price > 1.5 RETURN n.`name`",
        "CALL neptune.algo.pageRank({numOfIterations: 5}) YIELD node, rank RETURN rank",
    ):
        assert not is_write_query(cypher), cypher


def test_service_and_route_need_neptune(loaded_service):
    assert loaded_service.health()["query_agent"]["available"] is False
    with pytest.raises(NotReady):
        loaded_service.query_agent("which categories have the most items?")
    status, body = api.dispatch(loaded_service, "POST", "/api/graph/agent", {}, {})
    assert status == 400
    status, body = api.dispatch(
        loaded_service, "POST", "/api/graph/agent", {}, {"text": "categories?"}
    )
    assert status == 409 and "Neptune Analytics" in body["error"]


def test_query_code_panel_has_the_agent(loaded_service):
    status, body = api.dispatch(loaded_service, "GET", "/api/explorer/code", {"set": "query"}, {})
    assert status == 200
    ids = [s["id"] for s in body["snippets"]]
    assert ids == [
        "q_direct",
        "q_invoke",
        "q_server",
        "m_loop",
        "q_plan",
        "q_prompt",
        "q_execute",
        "q_result",
    ]
    steps = {s["id"]: s["steps"] for s in body["snippets"]}
    assert steps["q_invoke"] == [2] and steps["q_result"] == [6]  # the panel's six steps


# ---------------------------------------------------------------------- end to end (stdio)
class _Neptune(BaseHTTPRequestHandler):
    """The ExecuteQuery API (POST /queries, rest-json) of one tiny graph."""

    queries: ClassVar[list[str]] = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])) or b"{}")
        query = body.get("query", "")
        type(self).queries.append(query)
        if "pg_schema" in query:
            return self._send(200, {"results": [{"schema": _PG_SCHEMA}]})
        if query.count("(") != query.count(")"):
            message = "Invalid input 'RETURN': expected ')'"
            return self._send(400, {"message": message}, "MalformedQueryException")
        return self._send(200, {"results": ROWS})

    def _send(self, status, payload, error_type=None):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        if error_type:
            self.send_header("x-amzn-ErrorType", error_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


_PG_SCHEMA = {
    "labelTriples": [{"~from": "Item", "~type": "IS_CATEGORY", "~to": "Category"}],
    "nodeLabels": ["Item", "Category"],
    "nodeLabelDetails": {
        "Item": {"properties": {"name": {"datatypes": ["String"]}}},
        "Category": {"properties": {"name": {"datatypes": ["String"]}}},
    },
    "edgeLabels": ["IS_CATEGORY"],
    "edgeLabelDetails": {"IS_CATEGORY": {"properties": {}}},
}


def test_stdio_server_and_neptunes_error_end_to_end(monkeypatch):
    http = ThreadingHTTPServer(("127.0.0.1", 0), _Neptune)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    _Neptune.queries = []
    for key, value in {
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test",  # pragma: allowlist secret
        "AWS_SESSION_TOKEN": "test",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    try:
        # neptune-graph://<host:port> is the server's custom-endpoint form (plain HTTP)
        svc = _svc(
            [("run", BAD), ("run", GOOD), ("say", "Two categories.")],
            graph_id=f"127.0.0.1:{http.server_address[1]}",
        )
        out = query_agent.run(svc, "categories by item count", None, MODEL)
    finally:
        http.shutdown()

    failed = out["steps"][3]
    assert failed["name"] == "run_opencypher_query" and not failed["ok"]
    # MCP only said "Error executing tool …"; Neptune's words came from the server's log
    assert failed["error"] == "MalformedQueryException: Invalid input 'RETURN': expected ')'"
    assert (
        "expected ')'"
        in svc.bedrock.requests[1]["messages"][-1]["content"][0]["toolResult"]["content"][0]["text"]
    )
    assert out["query"] == GOOD and out["rows"] == ROWS
    assert BAD in _Neptune.queries and GOOD in _Neptune.queries


# ---------------------------------------------------------------------- worked examples
SHOT = {"question": "How many items per line?", "cypher": "MATCH (i:Item) RETURN i.line, count(i)"}


def test_worked_examples_go_into_the_cached_system_prompt(graph):
    svc = _svc([("run", GOOD), ("say", "Jackets lead.")])
    query_agent.run(svc, "categories?", None, MODEL, in_process, [SHOT])
    system = svc.bedrock.requests[0]["system"]
    text = system[0]["text"]
    assert "Worked examples" in text and SHOT["question"] in text and SHOT["cypher"] in text
    # rules, then the examples, then the schema: one prefix, cached as a whole
    assert text.index("Worked examples") < text.index("Graph schema")
    assert system[1] == {"cachePoint": {"type": "default"}}


def test_without_examples_the_prompt_has_no_examples_block(graph):
    svc = _svc([("run", GOOD), ("say", "Jackets lead.")])
    query_agent.run(svc, "categories?", None, MODEL, in_process)
    assert "Worked examples" not in svc.bedrock.requests[0]["system"][0]["text"]


def test_clean_examples_keeps_only_read_only_pairs():
    long = {"question": "q", "cypher": "MATCH (n) RETURN n " + "x" * query_agent.MAX_EXAMPLE_CHARS}
    kept = query_agent.clean_examples(
        [
            SHOT,
            {"question": "wipe it", "cypher": "MATCH (n) DETACH DELETE n"},  # a write
            {"question": "no query"},
            "not a dict",
            long,
        ]
        + [SHOT] * 10
    )
    assert kept[0] == SHOT and len(kept) == query_agent.MAX_EXAMPLES
    assert all(not is_write_query(e["cypher"]) for e in kept)
    assert query_agent.clean_examples("not a list") == () == query_agent.clean_examples(None)


def test_the_fashion_domain_ships_read_only_examples(loaded_service):
    """domain.json's query_examples reach the agent as they are written: none is dropped."""
    shipped = loaded_service.domain["query_examples"]
    assert len(shipped) >= 3
    assert len(query_agent.clean_examples(shipped)) == len(shipped)


def test_clear_graph_needs_write_queries(loaded_service, monkeypatch):
    """The deployed API's role may not write the graph unless write queries are allowed."""
    from dataclasses import replace

    from ontology_rag.graph.memory import InMemoryStore

    # a store of its own: the session's loaded graph stays as it is
    store = InMemoryStore()
    store.merge_nodes("Brand", [{"id": "b1", "props": {"name": "B"}}])
    monkeypatch.setattr(loaded_service, "store", store)
    before = store.summary().get("nodes", {})
    assert sum(before.values()) == 1
    status, body = api.dispatch(loaded_service, "POST", "/api/admin/clear-graph", {}, {})
    assert (
        status == 403 and "read-only" in body["error"] and "allowWriteQueries=true" in body["error"]
    )
    assert store.summary().get("nodes", {}) == before
    monkeypatch.setattr(
        loaded_service, "settings", replace(loaded_service.settings, allow_write_queries=True)
    )
    status, body = api.dispatch(loaded_service, "POST", "/api/admin/clear-graph", {}, {})
    assert status == 200 and body["nodes_deleted"] == sum(before.values())
