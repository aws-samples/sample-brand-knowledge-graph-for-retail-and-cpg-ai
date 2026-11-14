# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6's trends question, method 1: the graph agent as a background job (locally a thread,
deployed the pipeline function), with the model and reasoning effort chosen, its groups counted
again. The vector method, the tested query and the analyst's explanation are gone (404 / 400)."""

import io
import json
import threading
import time

import pytest
from fakes import TEST_MODEL, FakeBedrock

from ontology_rag import jobs, lambda_handler, query_agent, trends
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service


@pytest.fixture()
def svc(settings):
    """A service of its own: the tests add new items to it."""
    s = Service(
        settings,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
    )
    s.load_sample(reset=True, with_embeddings=False)
    return s


# ---------------------------------------------------------------------- the definition
def test_lift_is_smoothed_share_over_share():
    assert trends.lift(0, 0, 0, 0) == 1.0
    assert trends.lift(3, 3, 0, 54) == pytest.approx((3.5 / 4) / (0.5 / 55))
    assert trends.lift(1, 20, 10, 100) < 1  # rarer in the new content than in the lookbook


def _add_new_items(svc):
    """Three confident new trench coats (knee, double-breasted, a lapel, the trench-coat nickname
    the lookbook has once) and one the vision model was unsure about; the shoes of photo 1 in a
    leopard print, a value family (``animal``) the lookbook never uses."""
    store = svc.store
    rows = [
        {
            "id": f"item:new{n}",
            "props": {
                "name": f"new coat {n}",
                "run": "run-1",
                "confidence": c,
                "source": f"photo {n}",
            },
        }
        for n, c in ((1, 0.9), (2, 0.95), (3, -1), (4, 0.3))
    ]
    # the left and the right shoe of photo 1: two items, one piece of evidence
    shoes = [
        {
            "id": f"item:shoe-{side}",
            "props": {
                "name": f"{side} shoe",
                "run": "run-1",
                "confidence": 0.9,
                "source": "photo 1",
            },
        }
        for side in ("left", "right")
    ]
    store.merge_nodes("Item", rows + shoes)
    store.merge_edges(
        "IS_CATEGORY", [{"source": s["id"], "target": "category:shoe"} for s in shoes]
    )
    store.merge_edges(
        "HAS_ATTRIBUTE", [{"source": s["id"], "target": "attribute:animal:leopard"} for s in shoes]
    )
    ids = [r["id"] for r in rows]
    store.merge_edges("IS_CATEGORY", [{"source": i, "target": "category:coat"} for i in ids])
    store.merge_edges(
        "HAS_ATTRIBUTE",
        [
            {"source": i, "target": t}
            for i in ids
            for t in (
                "attribute:length:knee",
                "attribute:opening-type:double-breasted",
                "attribute:nickname:trench-coat",
            )
        ],
    )
    store.merge_edges("HAS_PART", [{"source": i, "target": "category:lapel"} for i in ids])


def _wait_graph(svc, job_id: str, timeout: float = 5.0) -> dict:
    """Poll the graph agent's job as the browser does, until it is no longer running."""
    deadline = time.time() + timeout
    while True:
        status, job = dispatch(svc, "GET", "/api/trends/graph", {"id": job_id}, {})
        assert status == 200, job
        if job["status"] != "running":
            return job
        assert time.time() < deadline, job
        time.sleep(0.01)


AGENT_ROWS = {
    "answer": "Knee-length double-breasted coats.",
    "query": "MATCH …",
    "effort": "low",
    "rows": [
        {
            "a_id": "attribute:length:knee",
            "a_name": "knee",
            "b_id": "attribute:opening-type:double-breasted",
            "b_name": "double breasted",
            "support_new": 3,
            "support_base": 0,
            "lift": 96.2,
        },
        {"a_id": "attribute:animal:leopard", "b_id": "category:shoe"},
    ],
    "metrics": {"turns": 3, "tool_calls": 2, "tokens": {"input": 9000, "output": 600}},
}


def _available(svc, monkeypatch, host: str = "in-process") -> None:
    monkeypatch.setattr(
        svc, "query_agent_status", lambda: {"available": True, "host": host, "reason": ""}
    )


# ---------------------------------------------------------------------- method 1 · the job
def test_the_graph_agent_is_a_job_that_reads_the_groups_from_the_agents_rows(svc, monkeypatch):
    _add_new_items(svc)
    asked = {}
    steps = []
    progress = svc.graph_jobs.progress
    monkeypatch.setattr(
        svc.graph_jobs, "progress", lambda text: (steps.append(text), progress(text))
    )

    def fake_agent(text, error, model_id, session_id, deadline_s=None, progress=None, effort=None):
        asked.update(
            text=text, model_id=model_id, session_id=session_id, deadline_s=deadline_s,
            effort=effort,
        )  # fmt: skip
        progress("model turn 1: → run_opencypher_query")
        assert release.wait(5)  # until the test has seen the job running
        return AGENT_ROWS

    release = threading.Event()
    monkeypatch.setattr(svc, "query_agent", fake_agent)
    _available(svc, monkeypatch)
    body = {"model_id": TEST_MODEL, "effort": "low"}  # no mode: the agent is the only one
    status, job = dispatch(svc, "POST", "/api/trends/graph", {}, body)
    assert status == 200, job
    # a background job (locally a thread of the API process): its id at once, the groups polled
    assert job["status"] == "running" and trends.GRAPH_JOB_ID.match(job["job_id"])
    release.set()
    done = _wait_graph(svc, job["job_id"])
    assert done["status"] == "done", done
    out = done["result"]
    # the agent may work for 5 minutes, in a runtime session of the job's own, at the effort chosen
    assert asked["deadline_s"] == query_agent.MAX_DEADLINE_S == 300
    assert asked["session_id"] == f"trends-{job['job_id']}"
    assert asked["model_id"] == TEST_MODEL and asked["effort"] == "low"
    assert steps == [
        "reading the new items and the lookbook from the graph",
        "in this process: writing and running openCypher (up to 300 s)",
        "model turn 1: → run_opencypher_query",
        "counting the groups in the agent's rows",
    ]
    assert "WITH a `run`" in asked["text"] and ": 3 sources)" in asked["text"]
    assert "`attribute:animal:`" in asked["text"]  # told what the lookbook cannot compare
    assert out["mode"] == "agent"
    totals = out["totals"]
    assert totals["new"] == 3  # pieces of content: the unsure coat is left out, the shoes are one
    assert totals["new_items"] == 5 and totals["base"] > 40
    assert totals["left_out"] == ["attribute:animal"]  # the lookbook never uses that family
    first, second = out["groups"]
    assert [f["id"] for f in first["features"]] == [
        "attribute:length:knee",
        "attribute:opening-type:double-breasted",
    ]
    assert first["support_new"] == 3 and first["lift"] >= 1.5  # counted here, not by the agent
    assert {i["id"] for i in first["items_new"]} <= {"item:new1", "item:new2", "item:new3"}
    assert [f["id"] for f in second["features"]] == ["category:shoe"]  # the animal print dropped
    assert out["agent"]["answer"] == "Knee-length double-breasted coats."  # shown at the end
    assert out["agent"]["effort"] == "low"  # the effort that ran, for the metrics line
    assert out["metrics"]["llm_calls"] == 3 and out["metrics"]["tool_calls"] == 2
    assert out["metrics"]["tokens"] == {
        "input": 9000,
        "output": 600,
        "cache_read": 0,
        "cache_write": 0,
    }


def test_a_graph_job_starts_only_when_it_can_run_and_reports_its_failure(svc, monkeypatch):
    # the in-memory graph has no openCypher: the agent is not available, refused at once
    status, out = dispatch(svc, "POST", "/api/trends/graph", {}, {})
    assert status == 409 and "Neptune Analytics" in out["error"]
    _available(svc, monkeypatch)
    status, out = dispatch(svc, "POST", "/api/trends/graph", {}, {})
    assert status == 409 and out["error"].startswith("no new items yet") and "tab 2" in out["error"]
    _add_new_items(svc)
    assert dispatch(svc, "POST", "/api/trends/graph", {}, {"model_id": "x"})[0] == 400
    # an effort the model does not offer, or any effort for a model without a setting: a 400
    status, out = dispatch(svc, "POST", "/api/trends/graph", {}, {"effort": "xhigh"})
    assert (status, out["error"]) == (
        400,
        "effort 'xhigh' is not offered for Claude Sonnet 5.5: default, low, medium, high",
    )
    kimi = {"model_id": "global.moonshotai.kimi-k3", "effort": "default"}
    status, out = dispatch(svc, "POST", "/api/trends/graph", {}, kimi)
    assert (status, out["error"]) == (
        400,
        "effort is not offered for Kimi K3: it has no reasoning setting in this sample",
    )
    # the tested query is gone: any mode but the agent's is refused
    for mode in ("query", "louvain"):
        status, out = dispatch(svc, "POST", "/api/trends/graph", {}, {"mode": mode})
        assert (status, out["error"]) == (400, "mode must be agent: the tested query was removed")

    class Throttled(Exception):
        """A botocore ClientError as the API sees it (its module and ``response``)."""

        __module__ = "botocore.exceptions"

        def __init__(self):
            super().__init__("An error occurred (ThrottlingException): Too many requests")
            self.response = {"Error": {"Code": "ThrottlingException", "Message": "Too many"}}

    for error, shown in [
        (
            RuntimeError("query agent runtime: the MCP server could not read the graph"),
            "RuntimeError: query agent runtime: the MCP server could not read the graph",
        ),
        (Throttled(), "ThrottlingException: the model is throttled, try again"),
    ]:

        def failing_agent(*args, error=error, **kwargs):
            raise error

        monkeypatch.setattr(svc, "query_agent", failing_agent)
        _, job = dispatch(svc, "POST", "/api/trends/graph", {}, {"mode": "agent"})
        failed = _wait_graph(svc, job["job_id"])
        assert failed["status"] == "failed" and "result" not in failed
        assert failed["error"] == shown
    assert dispatch(svc, "GET", "/api/trends/graph", {"id": "graph-" + "0" * 32}, {})[0] == 404
    for bad in ("", "decompose-" + "0" * 32, "graph-../../x", "graph-" + "0" * 12):
        assert dispatch(svc, "GET", "/api/trends/graph", {"id": bad}, {})[0] == 400, bad


def test_the_removed_methods_answer_404(svc):
    """Method 1 of October (the vector store: map, describe, decompose) and the analyst's
    explanation have no route any more."""
    for method, path in [
        ("GET", "/api/trends/vectors"),
        ("POST", "/api/trends/describe"),
        ("POST", "/api/trends/decompose"),
        ("GET", "/api/trends/decompose"),
        ("POST", "/api/trends/explain"),
    ]:
        status, out = dispatch(svc, method, path, {}, {})
        assert status == 404 and out["error"] == f"no route for {method} {path}", path
    for gone in ("vector_map", "decompose_start", "explain_groups", "co_occurrence_groups"):
        assert not hasattr(trends, gone), gone
    assert not hasattr(svc, "decompose_jobs")


# ---------------------------------------------------------------------- deployed
class StubLambda:
    """The Lambda client the API invokes the pipeline function with: records the calls."""

    def __init__(self, error: Exception | None = None):
        self.calls: list[dict] = []
        self.error = error

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {"StatusCode": 202}


def _deployed(svc, client) -> None:
    """The API as deployed: the graph agent's job goes to the pipeline function, its record to
    the data bucket."""
    svc.graph_jobs = jobs.FunctionJobs(
        svc.blobs, jobs.TREND_RECORDS, "PipelineFunction", client=client
    )


def _record_key(job_id: str) -> str:
    return f"jobs/trends/{job_id}.json"


class JobAgentCore:
    """``bedrock-agentcore`` for the pipeline function's long call: answers with the agent's rows."""

    def __init__(self):
        self.calls: list[dict] = []
        self.peek = lambda: None  # what the test looks at while the agent works

    def invoke_agent_runtime(self, **kw):
        self.calls.append(kw)
        self.peek()
        body = {**AGENT_ROWS, "runtime": {"host": "agentcore"}}
        return {"response": io.BytesIO(json.dumps(body).encode()), "traceId": "1-a-b"}


ARN = "arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/OntologyQueryAgent-AbCdE12345"


def _wait_step(svc, job_id: str) -> str:
    status, job = dispatch(svc, "GET", "/api/trends/graph", {"id": job_id}, {})
    assert status == 200 and job["status"] == "running", job
    return job["step"]


def test_deployed_the_pipeline_function_runs_the_agent_with_5_minutes(svc, monkeypatch):
    _add_new_items(svc)
    client = StubLambda()
    _deployed(svc, client)
    from dataclasses import replace

    svc.settings = replace(svc.settings, agent_runtime_arn=ARN)
    _available(svc, monkeypatch, "agentcore")
    svc._agentcore = None  # tab 3's client: never made for the job
    svc._agentcore_job = JobAgentCore()
    body = {"model_id": TEST_MODEL, "effort": "high"}
    status, job = dispatch(svc, "POST", "/api/trends/graph", {}, body)
    assert status == 200, job
    assert job["status"] == "running" and job["step"] == "queued for the pipeline function"
    assert svc._agentcore_job.calls == []  # nothing runs in the API
    (call,) = client.calls
    assert call["FunctionName"] == "PipelineFunction" and call["InvocationType"] == "Event"
    event = json.loads(call["Payload"])
    assert event == {"step": "trends_graph", "job_id": job["job_id"]}
    record = svc.blobs.get_json(_record_key(job["job_id"]))
    assert record["input"] == {"model_id": TEST_MODEL, "effort": "high"} and "user" not in record
    status, polled = dispatch(svc, "GET", "/api/trends/graph", {"id": job["job_id"]}, {})
    assert status == 200 and polled["status"] == "running"
    assert "input" not in polled  # the poll does not show it

    # the pipeline function's handler, as Lambda calls it with that event
    monkeypatch.setattr(lambda_handler, "_service", svc)
    steps = []
    svc._agentcore_job.peek = lambda: steps.append(_wait_step(svc, job["job_id"]))
    lambda_handler.pipeline_handler(event, None)
    # while the agent works, the poll says where (the browser shows it with the seconds)
    assert steps == ["on AgentCore Runtime: writing and running openCypher (up to 300 s)"]
    (invoked,) = svc._agentcore_job.calls
    assert invoked["agentRuntimeArn"] == ARN
    assert invoked["runtimeSessionId"] == f"trends-{job['job_id']}"  # a session of its own
    sent = json.loads(invoked["payload"])
    assert sent["deadline_s"] == 300 and sent["model_id"] == TEST_MODEL
    assert sent["effort"] == "high"  # from the job's record to the runtime, which checks it again
    assert svc._agentcore is None
    done = _wait_graph(svc, job["job_id"])
    assert done["status"] == "done", done
    assert done["step"] == "counting the groups in the agent's rows"
    out = done["result"]
    assert out["agent"]["answer"] == "Knee-length double-breasted coats."
    assert [f["id"] for f in out["groups"][0]["features"]] == [
        "attribute:length:knee",
        "attribute:opening-type:double-breasted",
    ]
    assert trends.graph_poll(svc, "graph-" + "0" * 32) is None  # an unknown id: the API's 404
    # Lambda delivers the event again: the agent does not run twice
    lambda_handler.pipeline_handler(event, None)
    assert len(svc._agentcore_job.calls) == 1
    with pytest.raises(ValueError):
        trends.graph_job(svc, "../runs/x")
    # the step of October's decompose job is gone from the pipeline function
    with pytest.raises(ValueError, match="unknown pipeline step"):
        lambda_handler.pipeline_handler({"step": "trends_decompose", "job_id": "x"}, None)


def test_deployed_a_job_record_without_an_effort_runs_with_none(svc, monkeypatch):
    """A record written before the effort existed (or by a caller that sent none) still runs:
    the agent gets no setting, the request of before."""
    _add_new_items(svc)
    _deployed(svc, StubLambda())
    _available(svc, monkeypatch)
    _, job = dispatch(svc, "POST", "/api/trends/graph", {}, {})
    record = svc.blobs.get_json(_record_key(job["job_id"]))
    assert record["input"] == {"model_id": TEST_MODEL, "effort": None}
    del record["input"]["effort"]
    svc.blobs.put_json(_record_key(job["job_id"]), record)
    asked = {}

    def fake_agent(*args, effort="unset", **kwargs):
        asked["effort"] = effort
        return AGENT_ROWS

    monkeypatch.setattr(svc, "query_agent", fake_agent)
    trends.graph_job(svc, job["job_id"])
    assert asked == {"effort": None} and _wait_graph(svc, job["job_id"])["status"] == "done"


def test_deployed_a_job_no_function_finishes_reads_failed(svc, monkeypatch):
    _add_new_items(svc)
    _deployed(svc, StubLambda())
    _available(svc, monkeypatch)
    ran = []
    monkeypatch.setattr(svc, "query_agent", lambda *a, **k: ran.append(a) or AGENT_ROWS)
    limits = jobs.FunctionJobs

    def start_and_age(**fields) -> str:
        _, job = dispatch(svc, "POST", "/api/trends/graph", {}, {})
        record = svc.blobs.get_json(_record_key(job["job_id"]))
        record.update({k: time.time() - v for k, v in fields.items()})
        svc.blobs.put_json(_record_key(job["job_id"]), record)
        return job["job_id"]

    # the event reaches the function after QUEUE_S (throttled): it refuses the stale job
    late = start_and_age(started_at=limits.QUEUE_S + 1)
    trends.graph_job(svc, late)
    assert not ran
    assert "waited" in _wait_graph(svc, late)["error"]
    # Lambda retries an invocation that timed out: the record says it started RUN_S ago
    retried = start_and_age(started_at=limits.RUN_S + 2, worker_started_at=limits.RUN_S + 1)
    trends.graph_job(svc, retried)
    assert not ran
    assert "stopped before it finished" in _wait_graph(svc, retried)["error"]
    # nobody writes the result: the poll gives up after QUEUE_S + RUN_S
    lost = start_and_age(started_at=limits.QUEUE_S + limits.RUN_S + 1)
    failed = _wait_graph(svc, lost)
    assert failed["status"] == "failed" and "no result after 660 s" in failed["error"]


def test_deployed_a_failed_invocation_fails_the_start_and_the_record(svc, monkeypatch):
    class Throttled(Exception):
        __module__ = "botocore.exceptions"

        def __init__(self):
            super().__init__("An error occurred (TooManyRequestsException): Rate exceeded")
            self.response = {"Error": {"Code": "TooManyRequestsException", "Message": "Rate"}}

    _add_new_items(svc)
    _deployed(svc, StubLambda(Throttled()))
    _available(svc, monkeypatch)
    status, out = dispatch(svc, "POST", "/api/trends/graph", {}, {})
    assert status == 502 and out["error"].startswith("TooManyRequestsException")
    (key,) = svc.blobs.list_keys("jobs/trends/")
    assert svc.blobs.get_json(key)["status"] == "failed"


def test_the_agent_prompts_name_the_baseline_the_lookbook_and_match_the_lake_origin():
    """Tab 6's baseline is the lookbook's garments (the Item nodes without ``run``); "catalog" is
    the product catalog, so neither prompt uses the word, and method 2's origin value is the one
    the lake export writes."""
    for text in (trends.agent_question(12, 491, []), trends.lake_question(12, 491, [])):
        assert "catalog" not in text.lower()
        assert "lookbook" in text and "491 garments" in text
    assert "origin = 'lookbook'" in trends.lake_question(12, 491, [])
