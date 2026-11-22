# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6's trends question, method 2: the graph as Iceberg tables (lakehouse.py) and the data
agent over them (lake_agent.py), with the S3 Tables MCP server and Bedrock replaced by scripts."""

from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import time
from types import SimpleNamespace

import pytest
from fakes import TEST_MODEL, FakeBedrock, FakeS3Vectors

from ontology_rag import agent_runtime, lake_agent, lakehouse, mcp_agent, trends
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service
from ontology_rag.vision import model_info

ARN = "arn:aws:s3tables:us-east-1:111122223333:bucket/multimodal-ai-knowledge-graph-test"
SQL = (
    "SELECT a.feature_id AS a_id, b.feature_id AS b_id, COUNT(DISTINCT i.source) AS support_new "
    "FROM item_features a JOIN item_features b ON a.item_id = b.item_id JOIN items i ON "
    "i.item_id = a.item_id WHERE a.feature_id < b.feature_id AND i.origin = 'new' "
    "GROUP BY a.feature_id, b.feature_id"
)


@pytest.fixture()
def svc(settings):
    from dataclasses import replace

    s = Service(
        replace(settings, table_bucket_arn=ARN),
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),  # a reset load empties the catalog index first
    )
    s.load_sample(reset=True, with_embeddings=False)
    store = s.store
    store.merge_nodes(
        "Item",
        [
            {
                "id": f"item:new{n}",
                "props": {
                    "name": f"new coat {n}",
                    "run": "r1",
                    "confidence": 0.9,
                    "source": f"photo {n}",
                },
            }
            for n in (1, 2, 3)
        ],
    )
    ids = ["item:new1", "item:new2", "item:new3"]
    store.merge_edges("IS_CATEGORY", [{"source": i, "target": "category:coat"} for i in ids])
    store.merge_edges(
        "HAS_ATTRIBUTE",
        [
            {"source": i, "target": t}
            for i in ids
            for t in ("attribute:length:knee", "attribute:opening-type:double-breasted")
        ],
    )
    store.merge_edges("HAS_PART", [{"source": i, "target": "category:lapel"} for i in ids])
    return s


# ---------------------------------------------------------------------- the tables
def test_rows_are_the_graph_in_the_shape_of_the_tables(svc):
    out = lakehouse.rows(svc)
    items, features = out["tables"]["items"], out["tables"]["item_features"]
    names = {t: [f["name"] for f in spec["fields"]] for t, spec in lakehouse.TABLES.items()}
    assert all(list(r) == names["items"] for r in items)
    assert all(list(r) == names["item_features"] for r in features)
    new = {r["item_id"]: r for r in items if r["origin"] == "new"}
    assert set(new) == {"item:new1", "item:new2", "item:new3"}
    assert new["item:new1"]["source"] == "photo 1" and new["item:new1"]["confidence"] == 0.9
    assert new["item:new1"]["category_id"] == "category:coat"
    lookbook = [r for r in items if r["origin"] == "lookbook"]
    assert lookbook and all(r["source"] is None and r["run_id"] is None for r in lookbook)
    mine = [r for r in features if r["item_id"] == "item:new1"]
    assert {(r["relation"], r["feature_id"]) for r in mine} == {
        ("IS_CATEGORY", "category:coat"),
        ("HAS_ATTRIBUTE", "attribute:length:knee"),
        ("HAS_ATTRIBUTE", "attribute:opening-type:double-breasted"),
        ("HAS_PART", "category:lapel"),
    }
    knee = next(r for r in mine if r["feature_id"] == "attribute:length:knee")
    assert knee["kind"] == "attribute" and knee["family"] == "length" and knee["name"]
    # the rows pass the check the runtime applies before it writes
    assert lakehouse.check(out["tables"])["items"] == items


def test_check_refuses_what_the_schema_does_not_have():
    good = {
        "items": [{"item_id": "item:x", "origin": "new", "confidence": "0.5"}],
        "item_features": [],
    }
    clean = lakehouse.check(good)
    assert clean["items"][0]["confidence"] == 0.5 and clean["items"][0]["name"] is None
    assert (
        "extra"
        not in lakehouse.check({**good, "items": [{**good["items"][0], "extra": 1}]})["items"][0]
    )
    for bad in (
        {"items": []},  # a table missing
        {**good, "other": []},  # a table the schema does not have
        {**good, "items": [{"origin": "new"}]},  # item_id is required
        {**good, "items": ["not a row"]},
    ):
        with pytest.raises(ValueError):
            lakehouse.check(bad)


class FakeS3Tables:
    """The s3tables call lakehouse.table_status makes (GetTable), with the tables that exist."""

    class exceptions:
        class NotFoundException(Exception):
            pass

    def __init__(self, tables):
        self.tables = set(tables)

    def get_table(self, tableBucketARN, namespace, name):
        if name not in self.tables:
            raise self.exceptions.NotFoundException()
        return {"modifiedAt": "2026-10-11T12:00:00Z", "createdAt": "2026-10-11T11:00:00Z"}


def test_table_status_reads_each_table_and_says_which_is_missing():
    out = lakehouse.table_status(FakeS3Tables({"items"}), ARN)
    assert out["table_bucket_arn"] == ARN and out["namespace"] == "brand_graph"
    assert out["tables"]["items"] == {
        "exists": True,
        "modified_at": "2026-10-11T12:00:00Z",
        "created_at": "2026-10-11T11:00:00Z",
    }
    assert out["tables"]["item_features"] == {"exists": False}


def test_write_overwrites_each_table_with_the_schema_types():
    pa = pytest.importorskip("pyarrow")
    types = {"string": pa.string(), "double": pa.float64()}

    class Table:
        def __init__(self, name):
            spec = lakehouse.TABLES[name]["fields"]
            arrow = pa.schema(
                [
                    pa.field(f["name"], types[f["type"]], nullable=not f.get("required"))
                    for f in spec
                ]
            )
            self.schema = lambda: SimpleNamespace(as_arrow=lambda: arrow)
            self.written = None

        def overwrite(self, data):
            self.written = data

        def current_snapshot(self):
            return SimpleNamespace(snapshot_id=42)

    tables = {n: Table(n) for n in lakehouse.TABLES}
    cat = SimpleNamespace(load_table=lambda full: tables[full.split(".", 1)[1]])
    rows = {
        "items": [{"item_id": "item:x", "origin": "new", "confidence": 0.7, "source": "photo"}],
        "item_features": [
            {
                "item_id": "item:x",
                "feature_id": "category:coat",
                "relation": "IS_CATEGORY",
                "kind": "category",
            }
        ],
    }
    out = lakehouse.write(cat, rows)
    assert out["items"]["rows"] == 1 and out["items"]["snapshot_id"] == 42
    assert tables["items"].written.column("confidence").to_pylist() == [0.7]
    assert tables["item_features"].written.num_rows == 1


# ---------------------------------------------------------------------- the agent's guard and parsing
def test_the_guard_lets_one_read_statement_through():
    assert lake_agent.is_read_query("SELECT 1")
    assert lake_agent.is_read_query("  with t AS (SELECT 1 AS x) SELECT x FROM t;")
    assert lake_agent.is_read_query("-- the pairs\nSELECT * FROM items")
    for bad in (
        "DELETE FROM items",
        "SELECT 1; DROP TABLE items",
        "INSERT INTO items VALUES ('x')",
        "SELECT * FROM items WHERE name = 'x' UNION SELECT * FROM items; UPDATE items SET name = 'y'",
        "CALL system.rollback_to_snapshot('items', 1)",
        # Daft table functions read any URL or local file, so they are refused too
        "SELECT * FROM read_csv('https://example.com/a.csv')",
        "SELECT * FROM items, read_json('/proc/self/environ')",
        "SELECT * FROM \"read_parquet\"('s3://x/y')",
        "SELECT * FROM `read_csv` ('https://example.com/a.csv')",
    ):
        assert not lake_agent.is_read_query(bad), bad


def test_the_guard_still_lets_a_normal_question_about_the_tables_through():
    assert lake_agent.is_read_query(
        "SELECT name, category FROM items WHERE confidence >= 0.5 AND name LIKE '%read%' LIMIT 50"
    )
    assert lake_agent.is_read_query(
        "SELECT f.name, COUNT(DISTINCT f.item_id) AS n FROM item_features f "
        "JOIN items i ON i.item_id = f.item_id GROUP BY f.name ORDER BY n DESC LIMIT 50"
    )


def test_rows_and_errors_are_read_from_the_servers_answer():
    assert lake_agent.table_rows({"columns": ["a", "n"], "rows": [["x", 1], ["y", 2]]}) == [
        {"a": "x", "n": 1},
        {"a": "y", "n": 2},
    ]
    assert lake_agent.table_rows({"result": {"columns": ["a"], "rows": [["x"]]}}) == [{"a": "x"}]
    log = (
        "Traceback (most recent call last):\n"
        "daft.exceptions.DaftCoreException: Not Yet Implemented: Execution of non-equality join\n"
        "Exception: Error executing query: Not Yet Implemented: Execution of non-equality join\n"
        "mcp.server.mcpserver.exceptions.UnexpectedToolError: Error executing tool query_database\n"
    )
    assert lake_agent.engine_error(log) == "Not Yet Implemented: Execution of non-equality join"


def test_the_server_runs_through_uvx_locally_and_from_the_zip_on_agentcore(svc, monkeypatch):
    # mcp_agent.installed is the one check both agents use (a dotted name whose parent is
    # missing is a plain False there); the test flips it between "not here" and "in the zip".
    monkeypatch.setattr(lake_agent.mcp_agent, "installed", lambda module: False)
    local = lake_agent.server_parameters(svc)
    args = local["args"]
    assert local["command"].endswith("uvx")
    assert args[args.index("--from") + 1] == "awslabs.s3-tables-mcp-server==0.1.1"
    assert args[args.index("--overrides") + 1].endswith("lake_overrides.txt")
    assert "--allow-write" not in " ".join(args)  # read-only mode
    assert local["env"]["MCP_SERVER_DISABLE_LOGGING"] == "1"
    monkeypatch.setattr(lake_agent.mcp_agent, "installed", lambda module: True)
    monkeypatch.setattr(lake_agent.mcp_agent, "package_root", lambda package: "/var/task")
    zipped = lake_agent.server_parameters(svc)
    assert (
        zipped["args"][0] == "-c" and "s3_tables_mcp_server.server import main" in zipped["args"][1]
    )
    assert zipped["env"]["PYTHONPATH"].split(":")[0].endswith("/var/task")


# ---------------------------------------------------------------------- the loop, with a scripted model
class ScriptedModel(FakeBedrock):
    """Each Converse turn of the data agent is the next entry: ("sql", query) or ("say", text)."""

    def __init__(self, script):
        super().__init__()
        self.script = list(script)

    def converse(self, **request):
        self.requests.append(copy.deepcopy(request))
        kind, value = self.script.pop(0)
        n = len(self.requests)
        if kind == "sql":
            content = [
                {
                    "toolUse": {
                        "toolUseId": f"t{n}",
                        "name": "query_database",
                        "input": {
                            "query": value,
                            "warehouse": "arn:aws:s3tables:eu-west-1:999999999999:bucket/someone-else",
                        },
                    }
                }
            ]
        else:
            content = [{"text": value}]
        return {
            "output": {"message": {"role": "assistant", "content": content}},
            "stopReason": "tool_use" if kind == "sql" else "end_turn",
            "usage": {"inputTokens": 700, "outputTokens": 90},
        }


class FakeServer:
    """The S3 Tables MCP server's two calls: list_tools, and query_database answering from a
    script: rows for a query that contains a key, an error (in the server's log) for the rest."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []
        self.log = SimpleNamespace(text="", read=lambda: self._read())

    def _read(self):
        out, self.log.text = self.log.text, ""
        return out

    async def list_tools(self):
        tools = [
            SimpleNamespace(name=n, description=f"{n}.\n\nmore")
            for n in ("list_tables", "query_database", "append_rows_to_table")
        ]
        return SimpleNamespace(tools=tools)

    async def call_tool(self, name, args, read_timeout_seconds=None):
        self.calls.append((name, args))
        for key, rows in self.answers.items():
            if key in args["query"]:
                data = {"columns": list(rows[0]), "rows": [list(r.values()) for r in rows]}
                return SimpleNamespace(
                    content=[SimpleNamespace(type="text", text=json.dumps(data))],
                    is_error=False,
                    structured_content=None,
                )
        self.log.text = "Exception: Error executing query: Not Yet Implemented: Execution of non-equality join\n"
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="Error executing tool query_database")],
            is_error=True,
            structured_content=None,
        )

    def connect(self):
        @contextlib.asynccontextmanager
        async def cm():
            yield self, self.log

        return cm()


PAIRS = [
    {
        "a_id": "attribute:length:knee",
        "a_name": "knee",
        "b_id": "attribute:opening-type:double-breasted",
        "b_name": "double breasted",
        "support_new": 3,
        "support_base": 0,
        "lift": 96.2,
    },
    {
        "a_id": "attribute:animal:leopard",
        "b_id": "category:coat",
        "support_new": 3,
        "support_base": 0,
        "lift": 50.0,
    },
]


def test_the_agent_fixes_its_sql_and_never_leaves_the_sample_bucket(svc):
    server = FakeServer({"WHERE a.feature_id < b.feature_id": PAIRS})
    svc.bedrock = ScriptedModel(
        [
            (
                "sql",
                SQL.replace(
                    "WHERE a.feature_id < b.feature_id AND", "AND a.feature_id < b.feature_id WHERE"
                ),
            ),
            ("sql", "DELETE FROM items"),
            ("sql", SQL),
            ("say", "Knee-length double-breasted coats are emerging: 3 of 3 pieces, lift 96."),
        ]
    )
    out = lake_agent.run(svc, "What is emerging?", model_info(TEST_MODEL), server.connect)
    kinds = [(s["kind"], s["ok"]) for s in out["steps"]]
    assert kinds == [
        ("mcp", True),
        ("model", True),
        ("mcp", False),
        ("model", True),
        ("guard", False),
        ("model", True),
        ("mcp", True),
        ("model", True),
    ]
    assert "non-equality join" in out["steps"][2]["error"]  # Daft's message, from the log
    assert len(server.calls) == 2  # the DELETE never reached the server
    for _, args in server.calls:  # whatever the model sent, the sample's bucket and endpoint
        assert args["warehouse"] == ARN and args["namespace"] == "brand_graph"
        assert args["uri"] == "https://s3tables.us-east-1.amazonaws.com/iceberg"
    assert out["query"] == SQL and out["rows"][0]["a_id"] == "attribute:length:knee"
    assert out["answer"].startswith("Knee-length") and out["metrics"]["tool_calls"] == 3
    assert out["mcp"]["server"] == "awslabs.s3-tables-mcp-server" and out["mcp"][
        "offered_to_model"
    ] == ["query_database"]
    first = svc.bedrock.requests[0]
    assert (
        "Table item_features" in first["system"][0]["text"]
        and "non-equality" not in first["system"][0]["text"]
    )
    spec = first["toolConfig"]["tools"][0]["toolSpec"]
    assert list(spec["inputSchema"]["json"]["properties"]) == [
        "query"
    ]  # only the SQL is the model's


def test_the_model_gets_a_whole_result_of_wide_rows_the_browser_a_short_one(svc):
    wide = [{"a_id": f"attribute:x:{n}", "a_name": "n" * 250, "lift": n} for n in range(10)]
    server = FakeServer({"SELECT": wide})
    steps: list[dict] = []
    step = asyncio.run(
        lake_agent.execute(svc, server, server.log, "query_database", {"query": SQL}, steps)
    )
    assert step["ok"] and step["count"] == 10
    assert "attribute:x:9" in step["to_model"]  # the tenth row reaches the model …
    assert step["to_model"].startswith('10 rows: {"columns": ["a_id", "a_name", "lift"]')
    public = mcp_agent.public(step)
    assert len(public["to_model"]) <= 1502 and "rows" not in public  # … the browser gets a preview


def test_method_2_runs_as_a_job_and_its_groups_are_counted_again(svc, monkeypatch):
    server = FakeServer({"SELECT": PAIRS})
    svc.lake_connect = server.connect
    svc.bedrock = ScriptedModel([("sql", SQL), ("say", "Double-breasted knee coats.")])
    monkeypatch.setattr(
        lakehouse, "status", lambda svc: {"available": True, "reason": "", "host": "in-process"}
    )
    # an effort the model does not offer is refused before the graph is read
    refused = {"model_id": TEST_MODEL, "effort": "max"}
    status, out = dispatch(svc, "POST", "/api/trends/lake/ask", {}, refused)
    assert (status, out["error"]) == (
        400,
        "effort 'max' is not offered for Claude Sonnet 5.5: default, low, medium, high",
    )
    assert not svc.bedrock.requests
    body = {"model_id": TEST_MODEL, "effort": "medium"}
    status, job = dispatch(svc, "POST", "/api/trends/lake/ask", {}, body)
    assert status == 200 and job["status"] == "running" and job["job_id"].startswith("lake-")
    assert "COUNT(DISTINCT source): 3 pieces" in job["question"]
    for _ in range(100):
        status, out = dispatch(svc, "GET", "/api/trends/lake/ask", {"id": job["job_id"]}, {})
        if out["status"] != "running":
            break
        time.sleep(0.05)
    assert status == 200 and out["status"] == "done", out
    r = out["result"]
    first, second = r["groups"]
    assert [f["id"] for f in first["features"]] == [
        "attribute:length:knee",
        "attribute:opening-type:double-breasted",
    ]
    assert first["support_new"] == 3  # counted by method 1's code, not taken from the rows
    assert [f["id"] for f in second["features"]] == ["category:coat"]  # the animal print dropped
    assert r["metrics"]["llm_calls"] == 2 and r["metrics"]["tool_calls"] == 1
    assert r["agent"]["runtime"]["host"] == "in-process"
    # the effort chosen reached every turn of the in-process agent, and the result says which ran
    assert r["agent"]["effort"] == "medium"
    for request in svc.bedrock.requests:
        assert request["additionalModelRequestFields"] == {
            "thinking": {"type": "adaptive", "display": "summarized"},
            "output_config": {"effort": "medium"},
        }
        assert request["inferenceConfig"]["maxTokens"] == 4096
    assert dispatch(svc, "GET", "/api/trends/lake/ask", {"id": "lake-000000000000"}, {})[0] == 404
    assert dispatch(svc, "GET", "/api/trends/lake/ask", {"id": "../etc"}, {})[0] == 400


def test_method_2_needs_a_table_bucket(settings):
    s = Service(
        settings,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
    )
    status, out = dispatch(s, "GET", "/api/trends/lake", {}, {})
    assert status == 200 and out["configured"] is False
    assert out["reason"] == "no S3 table bucket: the stack creates it"
    assert dispatch(s, "POST", "/api/trends/lake/export", {}, {})[0] == 409


# ---------------------------------------------------------------------- the lake agent's runtime
def test_the_runtime_checks_exports_and_runs_asks_as_jobs(monkeypatch):
    monkeypatch.setenv("TABLE_BUCKET_ARN", ARN)
    monkeypatch.setenv("ANSWER_MODEL_IDS", TEST_MODEL)
    monkeypatch.setattr(agent_runtime, "_LAKE", {"jobs": None, "catalog": None})
    assert agent_runtime.handle_lake({"task": "export", "tables": {"items": []}})["status"] == 400
    assert agent_runtime.handle_lake({"task": "nope"})["status"] == 400
    assert (
        agent_runtime.handle_lake({"task": "ask", "text": "x", "model_id": "other.model"})["status"]
        == 400
    )
    # the runtime checks the effort against the model's levels too, before any job starts
    refused = agent_runtime.handle_lake(
        {"task": "ask", "text": "x", "model_id": TEST_MODEL, "effort": "off"}
    )
    assert refused == {
        "error": "effort 'off' is not offered for Claude Sonnet 5.5: default, low, medium, high",
        "status": 400,
    }
    written = {}
    monkeypatch.setattr(
        lakehouse,
        "write",
        lambda cat, tables: written.setdefault("t", tables) and {"items": {"rows": 1}},
    )
    out = agent_runtime.handle_lake(
        {
            "task": "export",
            "tables": {"items": [{"item_id": "item:x", "origin": "new"}], "item_features": []},
        },
        catalog=object(),
    )
    assert (
        out["tables"] == {"items": {"rows": 1}} and written["t"]["items"][0]["item_id"] == "item:x"
    )

    server = FakeServer({"SELECT": PAIRS})

    class Session:  # what main.py keeps: query_agent.SessionServer.call on its loop
        starts = 1

        def call(self, fn, *args):
            return asyncio.run(fn(*args, server.connect))

    bedrock = ScriptedModel([("sql", SQL), ("say", "Coats.")])
    job = agent_runtime.handle_lake(
        {"task": "ask", "text": "What is emerging?", "model_id": TEST_MODEL, "effort": "low"},
        "s-1",
        bedrock=bedrock,
        server=Session(),
    )
    assert job["status"] == "running"
    for _ in range(100):
        polled = agent_runtime.handle_lake({"task": "poll", "job_id": job["job_id"]}, "s-1")
        if polled["status"] != "running":
            break
        time.sleep(0.05)
    assert polled["status"] == "done" and polled["result"]["answer"] == "Coats."
    assert polled["result"]["effort"] == "low"
    assert bedrock.requests[0]["additionalModelRequestFields"]["output_config"] == {"effort": "low"}
    assert polled["result"]["runtime"]["mcp_server"] == "kept for the session"
    assert (
        agent_runtime.handle_lake({"task": "poll", "job_id": "lake-ffffffffffff"})["status"] == 404
    )


def test_lake_question_is_method_1s_definition_for_the_tables():
    q = trends.lake_question(7, 54, ["attribute:nickname"])
    assert "COUNT(DISTINCT source): 7 pieces" in q and "54 garments" in q
    assert "/ 8.0) / ((support_base + 0.5) / 55.0)" in q
    assert "relation IS_CATEGORY or HAS_ATTRIBUTE" in q and "'attribute:nickname:%'" in q
