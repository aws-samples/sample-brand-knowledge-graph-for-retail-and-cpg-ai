# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json

import pytest

from ontology_rag.graph import cypher as Q
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.graph.neptune import NeptuneAnalyticsStore, is_write_query, reads_s3


def test_explore_and_nodes(loaded_service):
    svc = loaded_service
    sub = svc.explore(ids=["item:utility-field-jacket"], hops=1)
    assert any(n["id"] == "category:jacket" for n in sub["nodes"])
    assert any(e["type"] == "LAYERED_WITH" for e in sub["edges"])
    assert len(svc.nodes("Line")) == 3


def test_query_console_guard(loaded_service):
    with pytest.raises(PermissionError):
        loaded_service.query("MATCH (n) DETACH DELETE n")
    with pytest.raises(NotImplementedError):
        loaded_service.query("MATCH (n) RETURN count(n)")


def test_write_query_detection():
    assert is_write_query("MERGE (n:Item {`~id`: 'x'})")
    assert is_write_query("CALL neptune.algo.vectors.upsert(n, [1.0])")
    assert not is_write_query("MATCH (n:Item) RETURN n.name, n.description LIMIT 5")
    # neptune.read() reads S3 with the caller's credentials: refused like a write
    s3_read = "CALL neptune.read({source:'s3://b/k', format:'csv'}) YIELD row RETURN row"
    assert is_write_query(s3_read) and reads_s3(s3_read)
    assert is_write_query("CALL `neptune`.`read`({source:'s3://b/k', format:'csv'}) YIELD row")
    assert reads_s3("call Neptune.Read({source:'s3://b/k', format:'parquet'}) yield row return row")
    assert not reads_s3("MATCH (n:Item) WHERE n.name CONTAINS 'neptune.reader' RETURN n.name")


class _FakeNeptuneClient:
    """Records queries and answers like the neptune-graph data plane."""

    def __init__(self):
        self.calls = []

    def execute_query(self, **kwargs):
        self.calls.append(kwargs)
        rows = []
        if "topK.byEmbedding" in kwargs["queryString"]:
            rows = [
                {
                    "id": "item:x",
                    "labels": ["Item"],
                    "props": {"name": "X", "embedding": [0.1]},
                    "score": 0.5,
                }
            ]
        elif "count(n) AS merged" in kwargs["queryString"]:
            rows = [{"merged": len(kwargs["parameters"]["rows"])}]

        class _Body:
            def read(self_inner):
                return json.dumps({"results": rows}).encode()

        return {"payload": _Body()}


def test_neptune_store_renders_valid_cypher():
    client = _FakeNeptuneClient()
    store = NeptuneAnalyticsStore("g-123", region="us-east-1", client=client)
    store.merge_nodes("Item", [{"id": "item:x", "props": {"name": "X", "skip": None}}])
    q = client.calls[-1]
    assert q["graphIdentifier"] == "g-123" and q["language"] == "OPEN_CYPHER"
    assert "MERGE (n:Item {`~id`: row.id})" in q["queryString"]
    assert q["parameters"]["rows"][0]["props"] == {"name": "X"}  # None dropped

    hits = store.topk([0.1, 0.2], 3, ["Item", "Statement"])
    assert hits[0][0].id == "item:x" and hits[0][1] == 0.5
    assert "embedding" not in hits[0][0].props  # never leak vectors to callers
    rendered = client.calls[-1]["queryString"]
    assert (
        'orAll: [{equals: {property: "~label", value: "Item"}}, {equals: {property: "~label", value: "Statement"}}]'
        in rendered
    )
    # Neptune Analytics takes no $parameters inside CALL and a static embedding only: the vector
    # and k are literals in the statement
    assert "embedding: [0.1,0.2]" in rendered and "topK: 3" in rendered
    assert "$" not in rendered and "parameters" not in client.calls[-1]
    with pytest.raises(ValueError):
        store.topk([float("nan")], 3, ["Item"])

    # algorithm arguments must be variables: the vector is bound with WITH before the CALL
    store.upsert_embeddings([{"id": "item:x", "embedding": [0.1, 0.2]}])
    upsert = client.calls[-1]["queryString"]
    assert "WITH n, row.embedding AS embedding" in upsert
    assert "neptune.algo.vectors.upsert(n, embedding)" in upsert

    with pytest.raises(ValueError):
        store.merge_nodes("Bad Label; DROP", [])
    assert Q.vertex_filter(["Item"]) == '{equals: {property: "~label", value: "Item"}}'


def test_neptune_neighbor_ids_follow_the_direction_asked():
    """``neighbor_ids(..., direction="in")`` renders the incoming template: a garment's looks."""

    class Client(_FakeNeptuneClient):
        def execute_query(self, **kwargs):
            self.calls.append(kwargs)
            q = kwargs["queryString"]
            rows = (
                [{"source": "item:x", "target": "look:1"}]
                if "<-[r]-" in q
                else [{"source": "item:x", "target": "category:coat"}]
            )

            class _Body:
                def read(self_inner):
                    return json.dumps({"results": rows}).encode()

            return {"payload": _Body()}

    store = NeptuneAnalyticsStore("g-123", region="us-east-1", client=Client())
    assert store.neighbor_ids(["item:x"], ["CONTAINS"], direction="in") == {"item:x": {"look:1"}}
    assert store.neighbor_ids(["item:x"], ["IS_CATEGORY"]) == {"item:x": {"category:coat"}}


def test_memory_neighbor_ids_follow_the_direction_asked():
    store = InMemoryStore()
    store.merge_nodes("Look", [{"id": "look:1"}])
    store.merge_nodes("Item", [{"id": "item:x"}, {"id": "item:y"}])
    store.merge_edges("CONTAINS", [{"source": "look:1", "target": "item:x"}])
    worn = store.neighbor_ids(["item:x", "item:y"], ["CONTAINS"], direction="in")
    assert worn == {"item:x": {"look:1"}, "item:y": set()}
    assert store.neighbor_ids(["look:1"], ["CONTAINS"]) == {"look:1": {"item:x"}}


def test_neptune_neighbors_are_the_other_endpoint():
    """NEIGHBORS_OUT / _IN rows carry source and target ids, no "id": the neighbour is the target
    of an outgoing edge and the source of an incoming one."""

    class Client(_FakeNeptuneClient):
        def execute_query(self, **kwargs):
            self.calls.append(kwargs)
            q = kwargs["queryString"]
            row = {
                "type": "IS_CATEGORY",
                "rprops": {},
                "labels": ["Category"],
                "props": {"name": "coat"},
            }
            if "<-[r]-" in q:
                rows = [{**row, "source": "item:y", "target": "category:coat", "labels": ["Item"]}]
            else:
                rows = [{**row, "source": "item:x", "target": "category:coat"}]

            class _Body:
                def read(self_inner):
                    return json.dumps({"results": rows}).encode()

            return {"payload": _Body()}

    store = NeptuneAnalyticsStore("g-123", region="us-east-1", client=Client())
    ((edge, node),) = store.neighbors("item:x", ["IS_CATEGORY"], "out")
    assert node.id == "category:coat" and node.label == "Category" and edge.source == "item:x"
    ((edge, node),) = store.neighbors("category:coat", None, "in")
    assert node.id == "item:y" and edge.target == "category:coat"
