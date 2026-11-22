# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The graph export files (dna.py): that they load into the graph as they are."""

import json
import shutil

import pytest
from conftest import ONTOLOGY

from ontology_rag import dna
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.loader import Loader


def _with_ontology(ontology) -> InMemoryStore:
    store = InMemoryStore()
    Loader(store, ontology, MockEmbedder(8)).load_ontology()
    return store


def _write_export(folder) -> None:
    """Two lookbook looks with a garment each, their occasion and the brand, in the files'
    format (the export that made AnyCompany Fashion House's set wrote them like this)."""
    nodes = [
        {"id": "brand:anycompany-fashion-house", "label": "Brand", "props": {"name": "AnyCompany Fashion House"}},
        {"id": "occasion:dress", "label": "Occasion", "props": {"name": "Dress"}},
    ]
    edges = [{"type": "HAS_OCCASION", "source": "brand:anycompany-fashion-house", "target": "occasion:dress"}]
    vectors = {}
    for lid, name in (
        ("look:aaaa1111", "fashion_dress_1.png"),
        ("look:bbbb2222", "fashion_dress_2.png"),
    ):
        iid = f"item:{lid[5:]}-e1-shoe"
        key = f"export/looks/{name}"
        nodes += [
            {
                "id": lid,
                "label": "Look",
                "props": {"name": name, "image_key": key, "occasion": "Dress"},
            },
            {
                "id": iid,
                "label": "Item",
                "props": {"name": "white sneaker", "category": "shoe", "image_key": key},
            },
        ]
        edges += [
            {"type": "CONTAINS", "source": lid, "target": iid, "props": {}},
            {"type": "FOR", "source": lid, "target": "occasion:dress", "props": {}},
            {"type": "IS_CATEGORY", "source": iid, "target": "category:shoe", "props": {}},
        ]
        vectors[lid], vectors[iid] = dna.encode_vector([0.5] * 8), dna.encode_vector([0.25] * 8)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / dna.GRAPH_FILE).write_text(json.dumps({"nodes": nodes, "edges": edges}))
    (folder / dna.VECTORS_FILE).write_text(json.dumps({"dimension": 8, "vectors": vectors}))


def test_vectors_round_trip_exactly():
    vec = [0.1, -2.5, 3.25, 0.0]
    got = dna.decode_vector(dna.encode_vector(vec))
    assert got == pytest.approx(vec, abs=1e-7)


def test_load_merges_the_files_into_the_graph(ontology, tmp_path):
    _write_export(tmp_path)
    target = _with_ontology(ontology)
    loaded = dna.load(target, tmp_path, dimension=8)
    assert loaded["nodes"] == {"Brand": 1, "Occasion": 1, "Look": 2, "Item": 2}
    assert loaded["edges"] == {"HAS_OCCASION": 1, "CONTAINS": 2, "FOR": 2, "IS_CATEGORY": 2}
    assert loaded["vectors"] == 4
    assert target.get_node("look:aaaa1111").props["name"] == "fashion_dress_1.png"
    assert ("item:aaaa1111-e1-shoe", "IS_CATEGORY", "category:shoe") in target.edges
    assert ("look:aaaa1111", "FOR", "occasion:dress") in target.edges
    assert target.get_embeddings(["look:aaaa1111"])["look:aaaa1111"] == pytest.approx([0.5] * 8)
    # loading twice changes nothing (MERGE)
    dna.load(target, tmp_path)
    assert target.summary()["nodes"]["Look"] == 2


def test_an_export_folder_loads_the_graph_and_catalog_without_calling_a_model(settings, tmp_path):
    from dataclasses import replace

    from fakes import FakeBedrock, FakeS3Vectors

    from ontology_rag import payoff
    from ontology_rag.pipeline import MemoryBlobStore
    from ontology_rag.service import Service

    # a domain folder of its own whose one data set is the export (ontologies/fashion/datasets/)
    domain = tmp_path / "ontologies" / "fashion"
    folder = domain / "datasets" / "export"
    folder.mkdir(parents=True)
    shutil.copy(ONTOLOGY, domain / "fashion.ttl")
    (folder / "README.md").write_text("# export\n")
    _write_export(folder)
    (folder / payoff.CATALOG_FILE).write_text(
        json.dumps(
            {
                "dimension": 8,
                "items": [
                    {
                        "key": "p1",
                        "metadata": {"name": "White sneakers"},
                        "vector": dna.encode_vector([0.1] * 8),
                    }
                ],
            }
        )
    )

    class NoEmbedder(MockEmbedder):
        def embed_text(self, *a, **k):
            raise AssertionError("the export carries its vectors")

        embed_image = embed_text

    s3v = FakeS3Vectors()
    svc = Service(
        replace(
            settings,
            ontologies_dir=domain.parent,
            ontology_path=domain / "fashion.ttl",
            embedding_dimension=8,
        ),
        store=InMemoryStore(),
        embedder=NoEmbedder(8),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=s3v,
    )
    result = svc.load_sample(reset=True)
    assert list(result["sets"]) == ["export"] and result["ontology"]["Category"] > 0
    counts = result["sets"]["export"]
    assert counts["Look"] == 2 and counts["Item"] == 2 and counts["vectors"] == 4
    assert counts["catalog"] == 1 and "p1" in s3v.vectors
    assert svc.store.summary()["nodes"]["Category"] > 0  # the ontology came first
    assert ("item:aaaa1111-e1-shoe", "IS_CATEGORY", "category:shoe") in svc.store.edges


def test_load_refuses_a_dimension_mismatch(ontology, tmp_path):
    _write_export(tmp_path)
    target = _with_ontology(ontology)
    with pytest.raises(ValueError, match="dimensions"):
        dna.load(target, tmp_path, dimension=1024)
    assert target.get_nodes("Look") == []
