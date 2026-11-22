# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The ingest pipeline: sources → classify (validated against the ontology) → MERGE → summary.

Offline the three steps run in a thread pool (``LocalRunner``); the tests drive them through
the same routes the browser uses and check the graph that comes out."""

from __future__ import annotations

import base64
import json
import time
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fakes import TEST_MODEL, FakeS3Vectors, fake_converse

from ontology_rag import lambda_handler, pipeline, vision
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.owl import local_name
from ontology_rag.service import Service

TINY_PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40).decode()
POST = (
    "A navy double-breasted wool coat over straight high-waist jeans, a white crew-neck t-shirt "
    "and brown lace-up ankle boots; a gray herringbone scarf on top."
)


def _wait(svc, run_id: str, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, payload = dispatch(svc, "GET", "/api/pipeline/runs", {"id": run_id}, {})
        assert status == 200
        if payload["status"] != "RUNNING":
            return payload
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def _start(svc, sources: list[dict], **extra) -> dict:
    status, payload = dispatch(
        svc, "POST", "/api/pipeline/runs", {}, {"model_id": TEST_MODEL, "sources": sources, **extra}
    )
    assert status == 200, payload
    assert payload["status"] == "RUNNING" and payload["execution"]["runner"] == "local"
    return payload["run"]


# ---------------------------------------------------------------------- example texts next to the images
def test_example_articles_are_listed_next_to_the_images(loaded_service):
    status, detail = dispatch(
        loaded_service, "GET", "/api/ontologies/detail", {"id": "fashion"}, {}
    )
    assert status == 200
    assert detail["articles"] == len(detail["articles_list"]) == 6
    first = detail["articles_list"][0]
    assert (
        first["file"].endswith(".md") and first["title"] and first["kind"] and first["chars"] > 100
    )
    assert first["pairs_with_image"] in {e["file"] for e in detail["examples_list"]}

    status, listing = dispatch(
        loaded_service, "GET", "/api/ontologies/articles", {"id": "fashion"}, {}
    )
    assert status == 200 and [a["file"] for a in listing["articles"]] == [
        a["file"] for a in detail["articles_list"]
    ]
    status, text = dispatch(
        loaded_service,
        "GET",
        "/api/ontologies/article",
        {"id": "fashion", "file": first["file"]},
        {},
    )
    assert status == 200 and text["title"] == first["title"] and "#" in text["text"]
    # README.md in the folder is documentation, not a sample; unknown files are 404
    assert "README.md" not in {a["file"] for a in listing["articles"]}
    assert (
        dispatch(
            loaded_service,
            "GET",
            "/api/ontologies/article",
            {"id": "fashion", "file": "../x.md"},
            {},
        )[0]
        == 404
    )


# ---------------------------------------------------------------------- a run, end to end (offline)
def test_run_classifies_photos_and_texts_and_merges_them_into_the_graph(loaded_service):
    svc = loaded_service
    before = svc.summary()["nodes"]
    run = _start(
        svc,
        [
            {"kind": "image", "example": "01-trench-coat-sweater-dress.jpg"},
            {"kind": "text", "example": "05-layering-knits.md"},
            {"kind": "text", "title": "My post", "text": POST, "source": "test"},
            {
                "kind": "image",
                "image_base64": f"data:image/png;base64,{TINY_PNG}",
                "name": "my photo",
            },
        ],
        line_id="line:utility",
    )
    assert run["ontology_id"] == "fashion" and run["line_id"] == "line:utility"
    # the run input carries names and keys, never bytes
    assert run["sources"][0] == {
        "index": 0,
        "kind": "image",
        "example": "01-trench-coat-sweater-dress.jpg",
    }
    assert (
        run["sources"][2]["key"].startswith(f"uploads/{run['run_id']}/02")
        and "text" not in run["sources"][2]
    )
    assert run["sources"][3]["key"].endswith(".png") and run["sources"][3]["label"] == "my photo"

    status = _wait(svc, run["run_id"])
    assert status["status"] == "SUCCEEDED" and status["execution"]["runner"] == "local"
    records = sorted(status["records"], key=lambda r: r["index"])
    assert [r["status"] for r in records] == ["ingested"] * 4
    assert (
        records[1]["label"] == "Layering knits without the bulk"
        and records[3]["label"] == "my photo"
    )

    # texts have no pixels: every bbox is null; photos keep their boxes
    assert all(e["bbox"] is None for e in records[1]["result"]["entities"])
    # ... and no photo properties, even when the model answered some for the text
    assert records[1]["result"]["photo_properties"] == {}
    assert records[1]["result"]["photo_property_iris"] == {}
    assert all(e["bbox"] for e in records[0]["result"]["entities"])
    # the per-source record does not repeat the (identical) ontology prompt
    assert "system" not in records[0]["result"]["prompt"] and records[0]["result"]["prompt"]["user"]

    summary = status["summary"]
    assert summary["sources"] == {"total": 4, "ingested": 4, "failed": 0}
    assert summary["added"]["items"] == 12 and summary["added"]["looks"] == 2
    assert summary["added"]["articles"] == 2 and summary["added"]["statements"] == 2
    after = svc.summary()["nodes"]
    assert after["Item"] == before["Item"] + 12 and after["Look"] == before["Look"] + 2
    assert (
        after["Article"] == before["Article"] + 2 and after["Statement"] == before["Statement"] + 2
    )
    assert (
        summary["graph"]["before"]["Item"] == before["Item"] and summary["graph"]["after"] == after
    )
    # what the sources share: the same categories from every source
    assert (
        summary["shared"]
        and summary["shared"][0]["items"] == 4
        and summary["shared"][0]["sources"] == 4
    )
    assert summary["shared"][0]["label"] == "Category"
    # ontology feedback is aggregated across the batch
    assert summary["feedback"][0]["sources"] == [0, 1, 2, 3]
    assert summary["tokens"]["cache_read_tokens"] > 0  # the ontology prefix came from the cache

    # the graph: an Item per entity keyed by the source digest, its Look / Article context
    ing = records[0]["ingest"]
    item = svc.node(ing["items"][0]["id"])
    assert item["props"]["run"] == run["run_id"] and item["props"]["model"] == TEST_MODEL
    assert item["props"]["source"] == records[0]["label"] and item["props"]["image_key"].startswith(
        "example:"
    )
    kinds = {n["edge"]["type"] for n in item["neighbors"]}
    assert {"IS_CATEGORY", "FROM_LINE", "CONTAINS"} <= kinds
    look = svc.node(ing["look"])
    assert look["labels"] == ["Look"]  # its occasion: track O's tests (C5)
    text_ing = records[2]["ingest"]
    st = svc.node(text_ing["statement"])
    assert (
        st["props"]["text"].startswith("A navy double-breasted")
        and st["props"]["article"] == text_ing["article"]
    )
    assert {n["node"]["id"] for n in st["neighbors"] if n["edge"]["type"] == "ILLUSTRATES"} == {
        i["id"] for i in text_ing["items"]
    }

    # the batch graph explorer: everything the run wrote plus what it links to
    status_code, graph = dispatch(svc, "GET", "/api/pipeline/graph", {"id": run["run_id"]}, {})
    assert status_code == 200 and graph["run_id"] == run["run_id"]
    labels = {n["labels"][0] for n in graph["nodes"]}
    assert {"Item", "Look", "Article", "Statement", "Category", "Line"} <= labels
    assert {"IS_CATEGORY", "CONTAINS", "ILLUSTRATES", "HAS_STATEMENT"} <= {
        e["type"] for e in graph["edges"]
    }
    assert set(graph["centers"]) >= {i["id"] for i in ing["items"]} | {ing["look"]}

    assert "documents" not in records[0]["ingest"]  # tab 2 writes the graph, not the catalog
    look_node = svc.store.get_node(ing["look"])
    assert look_node.props["image_key"].startswith("example:")

    # recent runs
    status_code, runs = dispatch(svc, "GET", "/api/pipeline/runs", {}, {})
    assert (
        status_code == 200
        and runs["runs"][0]["run_id"] == run["run_id"]
        and runs["runs"][0]["sources"] == 4
    )


def test_running_the_same_sources_twice_adds_nothing(loaded_service):
    svc = loaded_service
    run = _start(
        svc,
        [
            {"kind": "image", "example": "02-sheath-dress-knee-high-boots.jpg"},
            {"kind": "text", "example": "02-sheath-dress-post.md"},
        ],
    )
    first = _wait(svc, run["run_id"])["summary"]
    again = _start(
        svc,
        [
            {"kind": "image", "example": "02-sheath-dress-knee-high-boots.jpg"},
            {"kind": "text", "example": "02-sheath-dress-post.md"},
        ],
    )
    second = _wait(svc, again["run_id"])["summary"]
    assert second["graph"]["before"] == first["graph"]["after"]
    assert second["graph"]["after"] == second["graph"]["before"]  # MERGE on content-derived ids
    assert second["added"]["items"] == first["added"]["items"] == 6


def test_start_validates_the_request(loaded_service):
    svc = loaded_service
    bad = [
        ({}, "sources"),
        ({"sources": []}, "sources"),
        (
            {"sources": [{"kind": "image", "example": "01-trench-coat-sweater-dress.jpg"}]},
            "model_id",
        ),
        ({"model_id": TEST_MODEL, "sources": [{"kind": "video", "example": "x"}]}, "kind"),
        (
            {"model_id": TEST_MODEL, "sources": [{"kind": "image", "example": "nope.jpg"}]},
            "unknown example",
        ),
        ({"model_id": TEST_MODEL, "sources": [{"kind": "text", "text": "too short"}]}, "text"),
        ({"model_id": TEST_MODEL, "sources": [{"kind": "image", "image_base64": "!!"}]}, "base64"),
        (
            {
                "model_id": TEST_MODEL,
                "sources": [{"kind": "image", "example": "01-trench-coat-sweater-dress.jpg"}] * 21,
            },
            "at most",
        ),
        # line_id becomes the items' FROM_LINE target: a Line node of the graph, or nothing
        (
            {
                "model_id": TEST_MODEL,
                "line_id": "item:utility-beanie",
                "sources": [{"kind": "text", "text": POST}],
            },
            "not a Line node",
        ),
        (
            {
                "model_id": TEST_MODEL,
                "line_id": "line:nope",
                "sources": [{"kind": "text", "text": POST}],
            },
            "not a Line node",
        ),
        (
            {
                "model_id": TEST_MODEL,
                "line_id": "line:" + "x" * 120,
                "sources": [{"kind": "text", "text": POST}],
            },
            "not a Line node",
        ),
    ]
    for body, needle in bad:
        status, payload = dispatch(svc, "POST", "/api/pipeline/runs", {}, body)
        assert status == 400 and needle in payload["error"], (body, payload)
    status, payload = dispatch(
        svc,
        "POST",
        "/api/pipeline/runs",
        {},
        {
            "model_id": TEST_MODEL,
            "ontology_id": "nope",
            "sources": [{"kind": "text", "text": POST}],
        },
    )
    assert status == 404
    assert (
        dispatch(svc, "GET", "/api/pipeline/runs", {"id": "run-20260101-000000-abcd"}, {})[0] == 404
    )
    assert dispatch(svc, "GET", "/api/pipeline/runs", {"id": "../etc"}, {})[0] == 400
    assert (
        dispatch(svc, "GET", "/api/pipeline/graph", {"id": "run-20260101-000000-abcd"}, {})[0]
        == 404
    )


# ---------------------------------------------------------------------- the steps, one at a time
class ThrottlingBedrock:
    """Fails the first call like Bedrock under load, then answers like the fake."""

    def __init__(self, code: str = "ThrottlingException", fail_times: int = 1):
        self.code, self.remaining, self.calls = code, fail_times, 0

    def converse(self, **request):

        self.calls += 1
        if self.remaining:
            self.remaining -= 1
            exc = Exception(f"{self.code} from a fake client")
            exc.response = {"Error": {"Code": self.code, "Message": "slow down"}}  # type: ignore[attr-defined]
            raise exc
        return fake_converse(request, request["system"][0]["text"])


@pytest.fixture
def bedrock_service(settings):
    svc = Service(
        replace(settings, vision_model_ids=("global.anthropic.claude-sonnet-5-5",)),
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        s3vectors=FakeS3Vectors(),  # load_sample fills the catalog index: never a real one
    )
    svc.load_sample(reset=True)
    return svc


def _run_for(svc, sources: list[dict], model_id="global.anthropic.claude-sonnet-5-5") -> dict:
    return {
        "run_id": pipeline.new_run_id(),
        "ontology_id": "fashion",
        "model_id": model_id,
        "prompt_caching": True,
        "line_id": "line:utility",
        "sources": [{"index": i, **s} for i, s in enumerate(sources)],
        "graph_before": svc.store.summary()["nodes"],
    }


def test_classify_builds_one_request_shape_for_photos_and_texts(bedrock_service):
    svc = bedrock_service
    svc.bedrock = ThrottlingBedrock(fail_times=0)
    seen = []
    original = svc.bedrock.converse

    def spy(**request):
        seen.append(request)
        return original(**request)

    svc.bedrock.converse = spy
    run = _run_for(
        svc,
        [
            {"kind": "image", "example": "08-pinstripe-suit.jpg"},
            {"kind": "text", "example": "03-fitting-room-pinstripe-suit.md"},
        ],
    )
    photo = pipeline.classify_source(svc, run, run["sources"][0])
    text = pipeline.classify_source(svc, run, run["sources"][1])
    assert photo["status"] == text["status"] == "classified"
    img_req, txt_req = seen
    # the same system prompt with the cache checkpoint, for both kinds of source
    assert img_req["system"] == txt_req["system"] and img_req["system"][1] == {
        "cachePoint": {"type": "default"}
    }
    assert img_req["modelId"] == txt_req["modelId"] == "global.anthropic.claude-sonnet-5-5"
    assert (
        "image" in img_req["messages"][0]["content"][0]
        and img_req["messages"][0]["content"][0]["image"]["format"] == "jpeg"
    )
    # the uploaded text sits inside <source_text> tags, the instruction after it
    source = txt_req["messages"][0]["content"][0]["text"]
    assert source.startswith("<source_text>\n# Fitting-room notes")
    assert source.endswith("\n</source_text>")
    # the instruction in the domain's words (domain.json), for the text as for the photo
    domain = svc.catalog.entry("fashion").domain()
    assert txt_req["messages"][0]["content"][1]["text"] == vision.text_instruction(domain)
    assert "describes an outfit" in txt_req["messages"][0]["content"][1]["text"]
    assert "every garment, accessory" in img_req["messages"][0]["content"][1]["text"]
    assert photo["label"] == "pinstripe suit, silk blouse, slides"
    assert text["label"] == "Fitting-room notes: the pinstripe suit"
    assert len(photo["digest"]) == 8 and photo["digest"] != text["digest"]


def test_throttling_is_retryable_and_access_denied_is_not(bedrock_service):
    svc = bedrock_service
    run = _run_for(svc, [{"kind": "image", "example": "08-pinstripe-suit.jpg"}])
    svc.bedrock = ThrottlingBedrock("ThrottlingException")
    with pytest.raises(pipeline.RetryableError):  # Step Functions' Retry block takes it from here
        pipeline.classify_source(svc, run, run["sources"][0])
    svc.bedrock = ThrottlingBedrock("AccessDeniedException", fail_times=5)
    out = pipeline.classify_source(svc, run, run["sources"][0])
    assert out["status"] == "error" and out["error"].startswith("AccessDeniedException")
    # an error record passes through ingest untouched and is kept for the browser
    assert pipeline.ingest_source(svc, run, out) == out
    assert svc.blobs.get_json(pipeline.record_key(run["run_id"], 0))["status"] == "error"
    # the local runner retries like the state machine does, then ingests
    svc.bedrock = ThrottlingBedrock("ThrottlingException", fail_times=1)
    svc.runner.start(run)
    deadline = time.time() + 15
    while svc.runner.status(run["run_id"])["status"] == "RUNNING" and time.time() < deadline:
        time.sleep(0.05)
    assert svc.runner.status(run["run_id"])["status"] == "SUCCEEDED" and svc.bedrock.calls == 2


def test_ingest_keeps_only_what_the_ontology_knows(bedrock_service):
    svc = bedrock_service
    run = _run_for(svc, [{"kind": "text", "example": "01-three-ways-trench.md"}])
    svc.bedrock = ThrottlingBedrock(fail_times=0)
    classified = pipeline.classify_source(svc, run, run["sources"][0])
    # doctor the validated result the way a sloppy model would: an unknown class, a group instead
    # of a leaf, a valid attribute and a part
    view = svc.catalog.view("fashion").to_dict()
    iri = {local_name(n["id"]): n["id"] for n in view["nodes"]}
    ents = classified["result"]["entities"]
    ents[0].update(
        {
            "class": "Coat",
            "class_iri": iri["Coat"],
            "label": "belted trench coat",
            "attribute_iris": {iri["hasSilhouette"]: iri["silhouette_a-line"]},
            "attributes": {"hasSilhouette": "a-line"},
            "parts": [
                {
                    "id": "e1.p1",
                    "class": "Lapel",
                    "class_iri": iri["Lapel"],
                    "label": "notched lapel",
                    "bbox": None,
                    "relation": "hasPart",
                    "relation_iri": iri["hasPart"],
                }
            ],
        }
    )
    ents[1].update({"class": "Spaceship", "class_iri": None, "label": "a spaceship"})
    ents[2].update(
        {
            "class": "UpperBodyGarment",
            "class_iri": iri["UpperBodyGarment"],
            "label": "something on top",
        }
    )
    compact = pipeline.ingest_source(svc, run, classified)
    assert compact["status"] == "ingested" and len(compact["items"]) == 1
    assert compact["items"][0] == {
        "id": f"item:{classified['digest']}-e1-coat",
        "name": "belted trench coat",
        "category": "coat",
        "attributes": {"silhouette": "silhouette:a-line"},
        "parts": ["lapel"],
    }
    assert compact["skipped"] == [
        "'a spaceship': class 'Spaceship' is not in the ontology",
        "'something on top': UpperBodyGarment has subclasses, so it is a group and not a category",
    ]
    node = svc.node(compact["items"][0]["id"])
    edges = {(n["edge"]["type"], n["node"]["id"]) for n in node["neighbors"]}
    assert {
        ("IS_CATEGORY", "category:coat"),
        ("HAS_ATTRIBUTE", "attribute:silhouette:a-line"),
        ("HAS_PART", "category:lapel"),
        ("FROM_LINE", "line:utility"),
    } <= edges
    assert [
        n["edge"]["props"] for n in node["neighbors"] if n["edge"]["type"] == "HAS_ATTRIBUTE"
    ] == [{"family": "silhouette"}]
    assert node["props"]["confidence"] == 0.5 and node["props"]["description"].startswith(
        "Coat seen in"
    )
    # the text became an Article with one Statement illustrating the item
    art = svc.node(compact["article"])
    assert (
        art["props"]["source"] == "AnyCompany Fashion House Journal"
        and art["props"]["published"] == "2026-09-14"
    )


def test_summary_counts_shared_vocabulary_and_gaps(bedrock_service):
    svc = bedrock_service
    results = [
        {
            "index": 0,
            "kind": "image",
            "label": "a",
            "status": "ingested",
            "digest": "x",
            "model_id": "m",
            "look": "look:x",
            "article": None,
            "statement": None,
            "skipped": [],
            "issues": 1,
            "items": [
                {
                    "id": "i1",
                    "name": "coat",
                    "category": "coat",
                    "attributes": {"silhouette": "silhouette:a-line"},
                    "parts": ["lapel", "pocket"],
                },
                {
                    "id": "i2",
                    "name": "jeans",
                    "category": "pants",
                    "attributes": {"silhouette": "silhouette:straight"},
                    "parts": ["pocket"],
                },
            ],
            "feedback": [
                {
                    "kind": "value",
                    "suggestion": "add value chunky to hasKnitGauge",
                    "observed": "chunky knit",
                }
            ],
            "metrics": {
                "latency_ms": 10,
                "input_tokens": 1,
                "cache_read_tokens": 2,
                "cache_write_tokens": 0,
                "output_tokens": 3,
            },
        },
        {
            "index": 1,
            "kind": "text",
            "label": "b",
            "status": "ingested",
            "digest": "y",
            "model_id": "m",
            "look": None,
            "article": "article:y",
            "statement": "st:y-1",
            "skipped": ["z"],
            "issues": 0,
            "items": [
                {
                    "id": "i3",
                    "name": "coat",
                    "category": "coat",
                    "attributes": {"silhouette": "silhouette:a-line"},
                    "parts": [],
                }
            ],
            "feedback": [
                {
                    "kind": "value",
                    "suggestion": "Add value CHUNKY to hasKnitGauge",
                    "observed": "chunky",
                }
            ],
            "metrics": {
                "latency_ms": 10,
                "input_tokens": 1,
                "cache_read_tokens": 2,
                "cache_write_tokens": 0,
                "output_tokens": 3,
            },
        },
        {
            "index": 2,
            "kind": "image",
            "label": "c",
            "status": "error",
            "error": "AccessDeniedException: no",
        },
    ]
    run = _run_for(svc, [{"kind": "image", "example": "08-pinstripe-suit.jpg"}] * 3)
    summary = pipeline.summarize(svc, run, results)
    assert summary["sources"] == {"total": 3, "ingested": 2, "failed": 1}
    assert summary["added"] == {
        "items": 3,
        "looks": 1,
        "articles": 1,
        "statements": 1,
        "skipped_entities": 1,
        "validation_issues": 1,
    }
    shared = {(s["id"], s["items"], s["sources"]) for s in summary["shared"]}
    assert shared == {
        ("category:coat", 2, 2),
        ("attribute:silhouette:a-line", 2, 2),
        ("category:pocket", 2, 1),
    }
    assert summary["feedback"] == [
        {
            "kind": "value",
            "suggestion": "add value chunky to hasKnitGauge",
            "observed": "chunky knit",
            "sources": [0, 1],
        }
    ]
    assert summary["tokens"]["cache_read_tokens"] == 4 and summary["results"] == results
    assert svc.blobs.get_json(f"runs/{run['run_id']}/summary.json") == summary


# ---------------------------------------------------------------------- the Lambda and the state machine
def test_pipeline_lambda_dispatches_the_steps(loaded_service, monkeypatch):
    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    run = _run_for(
        loaded_service,
        [{"kind": "text", "example": "04-biker-jacket-weekend-post.md"}],
        model_id=TEST_MODEL,
    )
    classified = lambda_handler.pipeline_handler(
        {"step": "classify", "run": run, "source": run["sources"][0]}, None
    )
    assert classified["status"] == "classified"
    compact = lambda_handler.pipeline_handler(
        {"step": "ingest", "run": run, "classified": classified}, None
    )
    assert compact["status"] == "ingested" and compact["article"]
    summary = lambda_handler.pipeline_handler(
        {"step": "summarize", "run": run, "results": [compact]}, None
    )
    assert summary["sources"]["ingested"] == 1
    with pytest.raises(ValueError):
        lambda_handler.pipeline_handler({"step": "dance"}, None)


def test_state_machine_definition_is_consistent():
    asl = pipeline.state_machine_definition()
    assert asl["QueryLanguage"] == "JSONata"
    states = asl["States"]
    map_state = states[asl["StartAt"]]
    assert map_state["Type"] == "Map" and map_state["MaxConcurrency"] == 4
    inner = map_state["ItemProcessor"]["States"]
    assert set(inner) == {"Classify", "Ingest", "Record failure"}
    for name in ("Classify", "Ingest"):
        task = inner[name]
        assert task["Arguments"]["FunctionName"] == "${PipelineFunctionArn}"
        assert task["Arguments"]["Payload"]["step"] == name.lower()
        assert (
            "RetryableError" in task["Retry"][0]["ErrorEquals"]
            and task["Retry"][0]["JitterStrategy"] == "FULL"
        )
        assert task["Catch"][0]["Next"] == "Record failure"
    assert (
        states["Summarize"]["Arguments"]["Payload"]["step"] == "summarize"
        and states["Summarize"]["End"]
    )
    # every Next points at a state that exists
    for group in (states, inner):
        for st in group.values():
            if "Next" in st:
                assert st["Next"] in group
    assert json.dumps(asl)  # serialisable as the CDK definition body


def test_step_functions_runner_names_the_execution_after_the_run():
    from datetime import UTC, datetime

    class Fake:
        class exceptions:  # mirrors the boto3 client attribute
            class ExecutionDoesNotExist(Exception):
                pass

        def __init__(self):
            self.started = []

        def start_execution(self, **kw):
            self.started.append(kw)
            return {
                "executionArn": kw["stateMachineArn"].replace(":stateMachine:", ":execution:")
                + ":"
                + kw["name"]
            }

        def describe_execution(self, executionArn):
            if executionArn.endswith("missing"):
                raise Fake.exceptions.ExecutionDoesNotExist()
            return {
                "executionArn": executionArn,
                "status": "SUCCEEDED",
                "startDate": datetime(2026, 9, 30, 12, 0, 0, tzinfo=UTC),
                "stopDate": datetime(2026, 9, 30, 12, 1, 0, tzinfo=UTC),
            }

    arn = "arn:aws:states:us-east-1:123456789012:stateMachine:MultimodalAiKnowledgeGraph-IngestPipeline"
    runner = pipeline.StepFunctionsRunner(arn, client=Fake())
    run = {"run_id": "run-20260930-120000-abcd", "sources": []}
    started = runner.start(run)
    assert runner._client.started[0]["name"] == "run-20260930-120000-abcd"
    assert json.loads(runner._client.started[0]["input"]) == run
    assert started["arn"].endswith(
        ":execution:MultimodalAiKnowledgeGraph-IngestPipeline:run-20260930-120000-abcd"
    )
    assert started["console_url"].startswith("https://us-east-1.console.aws.amazon.com/states/")
    status = runner.status("run-20260930-120000-abcd")
    assert status["status"] == "SUCCEEDED" and status["stopped_at"] == "2026-09-30T12:01:00+00:00"
    assert runner.status("missing")["status"] == "UNKNOWN"


# ---------------------------------------------------------------------- failures, as tab 2 shows them
ROLE = "arn:aws:sts::111111111111:assumed-role/MultimodalAiKnowledgeGraph-PipelineRole/fn"
LAMBDA_CAUSE = json.dumps(
    {
        "errorMessage": f"User: {ROLE} is not authorized",
        "errorType": "AccessDeniedException",
        "requestId": "5f0c2a8e-0000-4000-8000-000000000000",
        "stackTrace": ['  File "/var/task/ontology_rag/lambda_handler.py", line 131, in handler\n'],
    }
)
SHOWN = "AccessDeniedException: User: <arn> is not authorized"


def test_a_failed_execution_reports_type_and_message_only():
    from datetime import UTC, datetime

    class FailedExecution:
        class exceptions:
            class ExecutionDoesNotExist(Exception):
                pass

        def describe_execution(self, executionArn):
            return {
                "executionArn": executionArn,
                "status": "FAILED",
                "startDate": datetime(2026, 9, 30, 12, 0, 0, tzinfo=UTC),
                "error": "States.TaskFailed",
                "cause": LAMBDA_CAUSE,
            }

    arn = "arn:aws:states:us-east-1:123456789012:stateMachine:IngestPipeline"
    status = pipeline.StepFunctionsRunner(arn, client=FailedExecution()).status("run-1")
    assert status["status"] == "FAILED" and status["error"] == SHOWN


def test_failed_sources_reach_the_browser_without_trace_or_arn():
    """A source that failed in Step Functions (Record failure: ``Error: `` and the first 300
    characters of Lambda's error JSON) and one the local runner recorded, read back by the
    route tab 2 polls."""
    run_id = "run-20260930-120000-abcd"
    blobs = pipeline.MemoryBlobStore()
    blobs.put_json(f"runs/{run_id}/run.json", {"run_id": run_id, "sources": []})
    recorded = f"AccessDeniedException: {LAMBDA_CAUSE[:300]}"
    blobs.put_json(f"runs/{run_id}/00.json", {"index": 0, "status": "error", "error": recorded})
    blobs.put_json(f"runs/{run_id}/01.json", {"index": 1, "status": "ingested", "items": []})
    local = f"RuntimeError: {ROLE}\nTraceback (most recent call last):\n  File x"
    results = [{"index": 0, "status": "error", "error": recorded}, {"index": 1, "status": "ok"}]
    blobs.put_json(f"runs/{run_id}/summary.json", {"results": results, "sources": {"failed": 1}})

    class Runner:
        def status(self, run_id):
            return {"runner": "local", "status": "FAILED", "error": local}

    svc = SimpleNamespace(blobs=blobs, runner=Runner())
    status = pipeline.run_status(svc, run_id)
    assert status["records"][0]["error"] == SHOWN and "error" not in status["records"][1]
    assert status["summary"]["results"][0]["error"] == SHOWN
    assert status["summary"]["results"][1] == {"index": 1, "status": "ok"}
    assert status["execution"]["error"] == "RuntimeError: <arn>"
    text = json.dumps(status)
    assert "arn:aws" not in text and "/var/task" not in text and "Traceback" not in text
    # what is stored stays as it was, for the operator
    assert blobs.get_json(f"runs/{run_id}/00.json")["error"] == recorded


def test_a_run_without_a_line_gets_none_even_when_the_graph_has_lines(loaded_service):
    """The app never names a line, and a graph with two brands has lines of one of them only
    (the workshop's new shoot is AnyCompany Fashion House's, the first Line node AnyCompany Apparel's Utility): the batch
    gets no line, and its items no line property. Last in this file: its run adds items to the
    shared graph the counting tests above start from."""
    assert loaded_service.store.get_nodes("Line", 1)  # the graph has lines
    run = _start(
        loaded_service,
        [
            {
                "kind": "text",
                "title": "No line",
                "text": POST + " A grey wool coat.",
                "source": "test",
            }
        ],
    )
    assert run["line_id"] == ""
    assert _wait(loaded_service, run["run_id"])["status"] == "SUCCEEDED"
    items = [
        i
        for i in loaded_service.store.get_nodes("Item", 5000)
        if i.props.get("run") == run["run_id"]
    ]
    assert items and all(not i.props.get("line") for i in items)
