# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 2 and the occasion of a look: an example's manifest names it (the new shoot), else the
model answers it from the ontology's closed list, and ``Look -FOR-> Occasion`` is written through
OWL (``fo:for``); the counts route gives the before and after. The sample's own data has no new
shoot, so the runs use the tiny data set (conftest.TINY)."""

import pytest
from conftest import ONTOLOGY, ontologies_with_tiny

from ontology_rag import kg, owl, pipeline
from ontology_rag.api import dispatch
from ontology_rag.graph.store import Edge
from ontology_rag.ontologies import OntologyCatalog

FO = "http://example.org/multimodal-ai-knowledge-graph/fashion#"
FOR = f"{FO}for"


@pytest.fixture(scope="module")
def view() -> dict:
    return owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion").to_dict()


def test_the_manifests_occasion_is_one_of_the_ontologys_never_a_file_name_guess(view):
    values = kg.vocabulary_nodes(view)
    assert pipeline.occasion_of(values, "business_casual")["id"] == "occasion:business_casual"
    assert pipeline.occasion_of(values, "Business casual")["id"] == "occasion:business_casual"
    assert pipeline.occasion_of(values, "gala")["id"] == "occasion:formal"  # a hidden label
    # never a new occasion
    assert pipeline.occasion_of(values, "cocktail party") is None
    assert pipeline.occasion_of(values, "") is None
    # an upload has no manifest: its file name no longer names its occasion
    meta = {"name": "fashion_business_casual_20241206_160614_1.jpg", "source": "upload"}
    assert pipeline.photo_values(view, "image", {}, meta) == {}


@pytest.mark.parametrize(
    ("manifest", "answered", "expected"),
    [
        ("business_casual", "occasion_smart_casual", "occasion:business_casual"),  # the manifest
        ("", "occasion_evening", "occasion:evening"),  # no manifest occasion: the model's answer
        ("cocktail", "occasion_evening", "occasion:evening"),  # a manifest text naming none
        ("dress", None, "occasion:dress"),
        ("", None, None),  # neither: no occasion
    ],
)
def test_one_occasion_per_look_the_manifest_first_then_the_model(
    view, manifest, answered, expected
):
    result = {"photo_property_iris": {FOR: FO + answered} if answered else {}}
    chosen = pipeline.photo_values(view, "image", result, {"occasion": manifest})
    assert [v["id"] for v in chosen.values()] == ([expected] if expected else [])
    assert list(chosen) == ([FOR] if expected else [])
    # a text has no occasion, whatever the model says
    assert pipeline.photo_values(view, "text", result, {"occasion": manifest}) == {}


def _classified(photo_property_iris: dict) -> dict:
    shoe = {
        "id": "e1",
        "class": "Shoe",
        "class_iri": f"{FO}Shoe",
        "label": "white sneaker",
        "confidence": 0.9,
        "attributes": {},
        "attribute_iris": {},
        "parts": [],
    }
    result = {"entities": [shoe], "photo_property_iris": photo_property_iris}
    return {"digest": "1a2b3c4d", "model_id": "m", "result": result}


def _context(**extra) -> dict:
    return {
        "kind": "image",
        "label": "new look",
        "run_id": "r1",
        "line_id": "",
        "key": "k",
        **extra,
    }


def test_the_look_gets_one_for_edge_and_the_occasions_name(view):
    """The occasion the run decided goes into OWL (``look fo:for fo:occasion_professional``) and
    from there, by the generic rules, to one FOR edge, the occasion's name on the look and the
    same Occasion node the deploy writes (no family, no placeholder text)."""
    classified = _classified({FOR: f"{FO}occasion_evening"})  # the model said Evening …
    context = _context(photo_property_iris={FOR: f"{FO}occasion_professional"})  # … the run won
    individuals, skipped = kg.to_owl(view, classified, context)
    assert skipped == []
    assert "fo:for fo:occasion_professional" in individuals.serialize(format="turtle")
    nodes, edges = kg.to_property_graph(individuals, view)
    look = next(n for n in nodes if n.label == "Look")
    assert look.props["occasion"] == "Professional"
    assert [e for e in edges if e.type == "FOR"] == [
        Edge("look:1a2b3c4d", "occasion:professional", "FOR", {})
    ]
    occasion = next(n for n in nodes if n.id == "occasion:professional")
    assert (occasion.labels, occasion.props) == (["Occasion"], {"name": "Professional"})
    assert not any(e.source == occasion.id for e in edges)  # no IN_FAMILY: it is no attribute
    assert "ingested photo" not in str([n.props for n in nodes])


def test_without_the_runs_decision_the_models_answer_is_written_and_without_one_none(view):
    individuals, _ = kg.to_owl(view, _classified({FOR: f"{FO}occasion_evening"}), _context())
    nodes, edges = kg.to_property_graph(individuals, view)
    assert [e.target for e in edges if e.type == "FOR"] == ["occasion:evening"]
    individuals, _ = kg.to_owl(view, _classified({}), _context())
    nodes, edges = kg.to_property_graph(individuals, view)
    look = next(n for n in nodes if n.label == "Look")
    assert "occasion" not in look.props and not any(e.type == "FOR" for e in edges)


def test_the_new_shoot_is_listed_with_its_occasions(tmp_path):
    examples = OntologyCatalog(ontologies_with_tiny(tmp_path)).entry("fashion").examples()
    shoot = [e for e in examples if e.get("batch") == "new-shoot"]
    assert [(e["file"], e["occasion"], e["data_set"]) for e in shoot] == [
        ("h1.jpg", "dress", "tiny")
    ]
    assert all(e["title"] for e in shoot)
    # the other example photos carry no occasion
    assert all("occasion" not in e for e in examples if e not in shoot)


def test_the_counts_route_gives_the_totals_on_the_in_memory_graph(loaded_service):
    status, out = dispatch(loaded_service, "GET", "/api/graph/counts", {}, {})
    nodes = loaded_service.store.summary()["nodes"]
    assert status == 200 and out["looks"] == nodes.get("Look", 0)
    assert out["garments"] == nodes.get("Item", 0)
    assert out["occasions"] == [] and out["watch"] is None  # no openCypher in memory
    long = {"watch": "x" * 200}
    assert dispatch(loaded_service, "GET", "/api/graph/counts", long, {})[0] == 400


def test_a_photo_of_the_new_shoot_lands_with_its_occasion(tiny_service):
    """The whole local run: classify (a fake model), MERGE, and the look -FOR-> its occasion,
    the one the tiny set's graph has."""
    import test_pipeline as tp

    svc = tiny_service
    file = "h1.jpg"
    run = tp._start(svc, [{"kind": "image", "example": file}])
    done = tp._wait(svc, run["run_id"], timeout=30)
    assert done["status"] == "SUCCEEDED", done
    ing = done["records"][0]["ingest"]
    assert ing["occasion"] == "Dress"
    look = svc.store.get_node(ing["look"])
    assert look.props["occasion"] == "Dress"
    assert look.props["image_key"] == f"example:{file}"
    targets = {m.id for e, m in svc.store.neighbors(look.id) if e.type == "FOR"}
    assert targets == {"occasion:dress"}


def test_an_article_about_a_look_of_the_shoot_is_linked_to_it(tiny_service):
    """The text's statement -ILLUSTRATES-> the look its manifest names, once that look is in."""
    import test_pipeline as tp

    svc = tiny_service
    article = "a1.md"
    # before its photo is ingested: no link (the look is not in the graph)
    run = tp._start(svc, [{"kind": "text", "example": article}])
    early = tp._wait(svc, run["run_id"], timeout=30)["records"][0]["ingest"]
    assert early["about_look"] is None
    photo = "h1.jpg"
    run = tp._start(svc, [{"kind": "image", "example": photo}])
    look_id = tp._wait(svc, run["run_id"], timeout=30)["records"][0]["ingest"]["look"]
    run = tp._start(svc, [{"kind": "text", "example": article}])
    ing = tp._wait(svc, run["run_id"], timeout=30)["records"][0]["ingest"]
    assert ing["about_look"] == look_id
    linked = {m.id for e, m in svc.store.neighbors(ing["statement"]) if e.type == "ILLUSTRATES"}
    assert look_id in linked


def test_the_shoots_article_is_about_one_of_its_looks(tmp_path):
    entry = OntologyCatalog(ontologies_with_tiny(tmp_path)).entry("fashion")
    shoot = {e["file"] for e in entry.examples() if e.get("batch") == "new-shoot"}
    texts = [a for a in entry.articles() if a.get("batch") == "new-shoot"]
    assert len(texts) == 1 and all(a["pairs_with_image"] in shoot for a in texts)
    assert all(a["source"] == "Tiny Journal" and a["data_set"] == "tiny" for a in texts)


@pytest.mark.parametrize(
    ("photo", "expected"),
    [
        ("nw1.jpg", ("Evening", "occasion:evening")),  # no manifest occasion: the model's answer
        ("h1.jpg", ("Dress", "occasion:dress")),  # the shoot's manifest wins over the model
    ],
)
def test_the_models_occasion_lands_when_the_manifest_has_none(
    tiny_service, monkeypatch, photo, expected
):
    """The whole local run with a model that answers the photo's occasion (Evening)."""
    import json

    import fakes
    import test_pipeline as tp

    plain = fakes.fake_converse

    def answers_evening(request, system_prompt):
        response = plain(request, system_prompt)
        block = response["output"]["message"]["content"][0]
        block["text"] = json.dumps(
            {**json.loads(block["text"]), "photo_properties": {"for": "Evening"}}
        )
        return response

    monkeypatch.setattr(fakes, "fake_converse", answers_evening)
    svc = tiny_service
    run = tp._start(svc, [{"kind": "image", "example": photo}])
    done = tp._wait(svc, run["run_id"], timeout=30)
    assert done["status"] == "SUCCEEDED", done
    record = done["records"][0]
    assert record["result"]["photo_properties"] == {"for": "Evening"}  # what the model said
    ing = record["ingest"]
    assert ing["occasion"] == expected[0]
    look = svc.store.get_node(ing["look"])
    assert look.props["occasion"] == expected[0]
    assert [m.id for e, m in svc.store.neighbors(look.id) if e.type == "FOR"] == [expected[1]]
