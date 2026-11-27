# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The explorer tab's web: the whole graph of the brand's looks in one response (looks, garments, kinds, occasions,
the journal's statements; with details the attribute values), and the openCypher that ran. The
in-memory graph has no openCypher, so a stub store answers the statements."""

from ontology_rag import service as service_mod
from ontology_rag.api import dispatch
from ontology_rag.graph.memory import InMemoryStore


class WebStore(InMemoryStore):
    """Answers the explorer's three statements; one edge points at a node the web leaves out."""

    def query(self, cypher, params=None):
        if cypher == service_mod.WEB_NODES:
            return [
                {
                    "id": "look:new",
                    "label": "Look",
                    "name": "new",
                    "image_key": "example:x.jpg",
                    "run": "run-1",
                },
                {
                    "id": "item:a",
                    "label": "Item",
                    "name": "white sneaker",
                    "image_key": None,
                    "run": "run-1",
                },
                {
                    "id": "category:shoe",
                    "label": "Category",
                    "name": "shoe",
                    "image_key": None,
                    "run": None,
                },
            ]
        if cypher == service_mod.WEB_EDGES:
            return [
                {"source": "look:new", "type": "CONTAINS", "target": "item:a"},
                {"source": "item:a", "type": "IS_CATEGORY", "target": "category:shoe"},
                {"source": "look:new", "type": "FOR", "target": "occasion:not-returned"},
            ]
        if cypher == service_mod.WEB_DETAILS:
            return [
                {
                    "source": "item:a",
                    "type": "HAS_ATTRIBUTE",
                    "target": "attribute:leather",
                    "name": "leather",
                }
            ]
        return super().query(cypher, params)


def test_the_web_holds_the_style_dna_and_the_statements_that_ran(loaded_service, monkeypatch):
    monkeypatch.setattr(loaded_service, "store", WebStore())
    status, web = dispatch(loaded_service, "GET", "/api/graph/web", {}, {})
    assert status == 200
    assert {n["label"] for n in web["nodes"]} == {"Look", "Item", "Category"}
    # only edges between nodes it returns
    assert [e["type"] for e in web["edges"]] == ["CONTAINS", "IS_CATEGORY"]
    assert web["cypher"] == [service_mod.WEB_NODES, service_mod.WEB_EDGES]
    status, web = dispatch(loaded_service, "GET", "/api/graph/web", {"details": "1"}, {})
    assert {
        "id": "attribute:leather",
        "label": "Attribute",
        "name": "leather",
        "image_key": None,
        "run": None,
    } in web["nodes"]
    assert web["edges"][-1] == {
        "source": "item:a",
        "type": "HAS_ATTRIBUTE",
        "target": "attribute:leather",
    }
    assert web["cypher"][-1] == service_mod.WEB_DETAILS


def test_the_in_memory_graph_says_it_needs_neptune(loaded_service):
    status, out = dispatch(loaded_service, "GET", "/api/graph/web", {}, {})
    assert status == 409 and "Neptune Analytics" in out["error"]
