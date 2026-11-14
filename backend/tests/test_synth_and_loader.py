# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import json

from conftest import VELLOWAY

from ontology_rag import synth
from ontology_rag.synth import build_catalog, write_catalog


def test_catalog_is_ontology_grounded(ontology):
    catalog = build_catalog(ontology)
    assert len(catalog["items"]) >= 50
    for item in catalog["items"]:
        assert item["category_id"] in ontology.categories
        for fam, aid in item["attributes"].items():
            assert aid in ontology.attributes
            assert ontology.attributes[aid].family == fam
    look_items = {i for l in catalog["looks"] for i in l["item_ids"]}
    assert look_items <= {i["id"] for i in catalog["items"]}


def test_write_catalog_is_deterministic(ontology, tmp_path):
    a = write_catalog(ontology, tmp_path / "a")
    b = write_catalog(ontology, tmp_path / "b")
    assert a == b
    assert (tmp_path / "a" / "items.json").read_text() == (
        tmp_path / "b" / "items.json"
    ).read_text()
    assert "fictional" in (tmp_path / "a" / "README.md").read_text().lower()


def test_committed_sample_matches_generator(ontology, settings):
    """ontologies/fashion/datasets/velloway must be regenerated with `ontology-rag synth` whenever
    synth.py changes."""
    assert VELLOWAY == settings.ontologies_dir / "fashion" / "datasets" / synth.SET_ID
    committed = json.loads((VELLOWAY / "items.json").read_text())
    assert committed == build_catalog(ontology)["items"]
    assert (VELLOWAY / "README.md").read_text() == synth.SAMPLE_README


def test_loader_builds_expected_graph(loaded_service):
    summary = loaded_service.summary()
    nodes, edges = summary["nodes"], summary["edges"]
    assert nodes["Category"] == 50 and nodes["Attribute"] == 294 and nodes["Group"] == 12
    assert nodes["Item"] >= 50 and nodes["Look"] >= 15 and nodes["Statement"] >= 20
    for edge in (
        "IS_CATEGORY",
        "FROM_LINE",
        "HAS_ATTRIBUTE",
        "CONTAINS",
        "LAYERED_WITH",
        "PAIRS_WITH",
        "HAS_STATEMENT",
        "ILLUSTRATES",
        "IN_GROUP",
        "IN_FAMILY",
        "APPLIES_TO",
        "OF_BRAND",
    ):
        assert edges.get(edge, 0) > 0, edge
    # Every Item/Look/Statement carries an embedding.
    assert summary["embeddings"] == nodes["Item"] + nodes["Look"] + nodes["Statement"]


def test_the_load_reports_the_ontology_and_each_set(loaded_service):
    """The sample's domain has two data sets in the catalog format: velloway, and whimsikora (one
    look of a second brand, the one with white sneakers): their items, looks and articles in the
    graph and their products in the catalog index (the fake vector bucket)."""
    out = loaded_service.load_sample(reset=False)
    assert set(out) == {"ontology", "sets", "seconds"}
    assert list(out["sets"]) == ["velloway", "whimsikora"]
    assert out["ontology"]["Category"] == 50 and out["ontology"]["Attribute"] == 294
    velloway = out["sets"]["velloway"]
    assert velloway["Item"] == 55 and velloway["Look"] >= 15 and velloway["catalog"] == 55
    whimsikora = out["sets"]["whimsikora"]
    assert whimsikora["Item"] == 7 and whimsikora["Look"] == 1 and whimsikora["catalog"] == 7


def test_loading_twice_is_idempotent(loaded_service):
    before = loaded_service.summary()
    loaded_service.load_sample(reset=False)
    assert loaded_service.summary() == before


def test_the_white_sneakers_look_is_one_look_in_words_of_the_ontology(ontology):
    """``whimsikora/``: one look of the workshop's second brand, in the catalog format, so the
    sample's question about white sneakers has a look to answer from. Every piece is in the look,
    in the ontology's words, and the photo the look and its pieces name is in the set."""
    folder = VELLOWAY.parent / "whimsikora"
    items = json.loads((folder / "items.json").read_text())
    (look,) = json.loads((folder / "looks.json").read_text())
    assert look["item_ids"] == [i["id"] for i in items] and len(items) == 7
    assert [i["name"] for i in items if i["category_id"] == "shoe"] == ["white lace-up sneakers"]
    for i in items:
        assert i["category_id"] in ontology.categories
        for family, attribute in i["attributes"].items():
            assert ontology.attributes[attribute].family == family
    keys = {i["image_key"] for i in items} | {look["props"]["image_key"]}
    assert len(keys) == 1
    (key,) = keys
    set_id, rest = key.split("/", 1)
    assert set_id == folder.name and (folder / "media" / rest).is_file()
