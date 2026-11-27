# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The router: routes, status codes and the input checks every server shares."""

import base64
from dataclasses import replace

from test_errors import ROLE, FakeClientError

from ontology_rag import api
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.service import Service


class RecordingStore(InMemoryStore):
    """A graph that runs every openCypher query (no rows) and remembers it, like the console's
    Neptune Analytics graph."""

    def __init__(self):
        super().__init__()
        self.queries: list[str] = []

    def query(self, cypher, params=None):
        self.queries.append(cypher)
        return []


def _console(settings, store, allow_write_queries=True) -> Service:
    s = replace(settings, allow_write_queries=allow_write_queries)
    return Service(s, store=store, embedder=MockEmbedder(256), s3vectors=object())


def test_dispatch_routes(loaded_service):
    assert dispatch(loaded_service, "GET", "/api/health", {}, {})[0] == 200
    status, payload = dispatch(loaded_service, "GET", "/api/nodes", {"label": "Line"}, {})
    assert status == 200 and len(payload["nodes"]) == 3
    assert dispatch(loaded_service, "GET", "/api/nodes", {"label": "Bad;Label"}, {})[0] == 400
    assert dispatch(loaded_service, "GET", "/api/node", {"id": "nope"}, {})[0] == 404
    assert dispatch(loaded_service, "POST", "/api/payoff", {}, {})[0] == 400  # no question
    # the old Q&A tab's routes and the RAG store's are gone
    for method, path in [("POST", "/api/ask"), ("POST", "/api/look/decompose"), ("GET", "/api/rag/status"), ("POST", "/api/rag/ingest"), ("POST", "/api/admin/clear-rag")]:  # fmt: skip
        assert dispatch(loaded_service, method, path, {}, {})[0] == 404, path
    assert dispatch(loaded_service, "GET", "/api/nothing", {}, {})[0] == 404
    # October's trends method 1 (the vector store) and the analyst's explanation are gone too
    for method, path in [("GET", "/api/trends/vectors"), ("POST", "/api/trends/describe"), ("POST", "/api/trends/decompose"), ("GET", "/api/trends/decompose"), ("POST", "/api/trends/explain")]:  # fmt: skip
        assert dispatch(loaded_service, method, path, {}, {})[0] == 404, path
    # the rule editor's routes are gone: rules are the catalog's, or a write query in tab 2
    assert dispatch(loaded_service, "POST", "/api/rules", {}, {})[0] == 404
    assert dispatch(loaded_service, "DELETE", "/api/rules", {}, {})[0] == 404
    status, payload = dispatch(
        loaded_service, "POST", "/api/graph/query", {}, {"cypher": "MATCH (n) DETACH DELETE n"}
    )
    assert status == 403


def test_the_console_refuses_neptune_read_even_where_write_queries_are_allowed(settings):
    """neptune.read() reads S3 with the API's role (uploads, run records), so the console
    refuses it whatever ALLOW_WRITE_QUERIES says; writes still run where it is true."""
    store = RecordingStore()
    svc = _console(settings, store, allow_write_queries=True)
    s3_read = "CALL neptune.read({source: 's3://data/uploads/x.csv', format: 'csv'}) YIELD row"
    status, payload = dispatch(svc, "POST", "/api/graph/query", {}, {"cypher": s3_read})
    assert status == 403 and "neptune.read" in payload["error"]
    write = "MATCH (n) DETACH DELETE n"
    assert dispatch(svc, "POST", "/api/graph/query", {}, {"cypher": write})[0] == 200
    assert store.queries == [write]  # the S3 read never reached the graph


def test_the_console_shows_neptunes_message_without_arns(settings):
    """A query Neptune rejects is a 400 with Neptune's words (where the query agent starts),
    with any ARN in them redacted like every other AWS message the browser gets."""

    class RejectingStore(RecordingStore):
        def query(self, cypher, params=None):
            raise FakeClientError(
                "MalformedQueryException", f"Invalid input near '(' on graph {ROLE}"
            )

    svc = _console(settings, RejectingStore(), allow_write_queries=False)
    status, payload = dispatch(svc, "POST", "/api/graph/query", {}, {"cypher": "MATCH (n RETURN n"})
    assert status == 400 and payload["neptune_error"] == "MalformedQueryException"
    assert payload["error"] == "MalformedQueryException: Invalid input near '(' on graph <arn>"


def test_images_above_the_limit_are_refused_before_any_model_call(loaded_service):
    """One limit, told in megabytes: the web app checks the same number on the file."""
    too_big = base64.b64encode(b"\xff\xd8" + b"\0" * api.MAX_IMAGE_BYTES).decode()
    status, payload = dispatch(
        loaded_service,
        "POST",
        "/api/payoff",
        {},
        {"question": "What goes with this?", "image_base64": too_big, "model_id": "m"},
    )
    assert status == 400 and payload["error"] == "image larger than 4 MB"
    fits = base64.b64encode(b"\xff\xd8" + b"\0" * (api.MAX_IMAGE_BYTES - 2)).decode()
    status, payload = dispatch(
        loaded_service,
        "POST",
        "/api/payoff",
        {},
        {"question": "What goes with this?", "image_base64": fits, "model_id": "m"},
    )
    assert status == 400 and "not enabled" in payload["error"]  # past the size check: the model


def test_the_ontology_file_route_returns_the_document_as_text(loaded_service):
    """Tab 1's file viewer: the Turtle the app parses, as is, with the file's name and format;
    an unknown id is a 404 and a missing id a 400, like ``/api/ontologies/detail``."""
    status, payload = dispatch(loaded_service, "GET", "/api/ontologies/file", {"id": "fashion"}, {})
    assert status == 200
    assert payload["id"] == "fashion" and payload["file"] == "fashion.ttl"
    assert payload["format"] == "ttl"
    assert payload["text"].startswith("# SPDX-License-Identifier: CC-BY-4.0\n")
    assert "\nfo:Coat a owl:Class ;\n" in payload["text"]
    status, payload = dispatch(loaded_service, "GET", "/api/ontologies/file", {"id": "nope"}, {})
    assert status == 404 and payload["error"] == "ontology 'nope' not found"
    status, payload = dispatch(loaded_service, "GET", "/api/ontologies/file", {}, {})
    assert status == 400 and payload["error"] == "id is required"
    # a path is not an id: the id check refuses it before any file is read
    status, _ = dispatch(loaded_service, "GET", "/api/ontologies/file", {"id": "../fashion"}, {})
    assert status == 400


def test_a_subgraph_walk_starts_from_at_most_100_ids(loaded_service):
    ids = [f"item:{i}" for i in range(api.MAX_EXPLORE_IDS + 1)]
    status, payload = dispatch(loaded_service, "POST", "/api/graph/explore", {}, {"ids": ids})
    assert (status, payload) == (400, {"error": "at most 100 ids"})
    status, payload = dispatch(
        loaded_service, "GET", "/api/graph/explore", {"ids": ",".join(ids)}, {}
    )
    assert status == 400
    status, payload = dispatch(loaded_service, "POST", "/api/graph/explore", {}, {"ids": ids[:100]})
    assert status == 200 and payload["centers"] == ids[:100]


def test_an_uploaded_ontology_is_at_most_1_mb(loaded_service):
    status, payload = dispatch(
        loaded_service,
        "POST",
        "/api/vision/classify",
        {},
        {"owl_text": "#" * (api.MAX_UPLOAD_BYTES + 1), "model_id": "m"},
    )
    assert (status, payload) == (400, {"error": "owl_text must be a string of at most 1 MB"})
    status, payload = dispatch(
        loaded_service,
        "POST",
        "/api/ontologies/parse",
        {},
        {"text": "# " + "x" * api.MAX_UPLOAD_BYTES},
    )
    assert status == 400 and payload["error"] == "ontology document larger than 1 MB"


def test_stage_1_and_rag_search_the_catalog(loaded_service):
    """Tab 4's stage 1 browses and searches the catalog index; RAG plans its searches, or takes
    the participant's edited ones, and answers from the catalog's products."""
    status, info = dispatch(loaded_service, "GET", "/api/catalog", {}, {})
    assert status == 200 and info["count"] > 0
    status, page = dispatch(loaded_service, "GET", "/api/catalog/items", {"n": "3"}, {})
    assert status == 200 and len(page["items"]) == 3
    key = page["items"][0]["key"]
    status, item = dispatch(loaded_service, "GET", "/api/catalog/item", {"key": key}, {})
    assert status == 200 and item["key"] == key and item["vector"]
    status, hits = dispatch(
        loaded_service, "POST", "/api/catalog/search", {}, {"query": "loafers", "k": 3}
    )
    assert status == 200 and len(hits["hits"]) == 3
    ask = {"question": "What goes with a black blazer?"}
    status, planned = dispatch(loaded_service, "POST", "/api/retriever/plan", {}, ask)
    assert status == 200 and planned["searches"]
    edited = {**ask, "searches": ["black trousers"]}
    status, out = dispatch(loaded_service, "POST", "/api/retriever/rag", {}, edited)
    assert status == 200 and out["plan"]["searches"] == ["black trousers"]
    assert {e["kind"] for e in out["evidence"]} == {"item"} and out["receipts"]["kind"] == "catalog"
    assert dispatch(loaded_service, "POST", "/api/retriever/rag", {}, {})[0] == 400
    assert dispatch(loaded_service, "GET", "/api/documents", {}, {})[0] == 404
