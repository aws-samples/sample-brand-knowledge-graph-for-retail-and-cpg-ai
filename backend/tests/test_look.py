# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""A photo's garments in the graph's vocabulary (look.py): the nodes ingest would link each one to,
read only."""

import json

import pytest

from ontology_rag import classify, look, owl, vision

# What a vision model answers for a photo of a trench coat over a pair of shoes, in the shape the
# ontology prompt asks for; one entity the ontology has no class for, one that names a group.
ANSWER = {
    "entities": [
        {
            "id": "e1",
            "class": "Coat",
            "label": "stone trench coat, double breasted",
            "bbox": [200, 80, 800, 760],
            "confidence": 0.95,
            "attributes": {
                "hasLength": "knee (length)",
                "hasOpeningType": "double breasted",
                "hasTextilePattern": "plain (pattern)",
            },
            "parts": [
                {"class": "Lapel", "label": "notched lapel", "bbox": None, "relation": "hasPart"}
            ],
        },
        {
            "id": "e2",
            "class": "Shoe",
            "label": "brown leather shoe, left",
            "bbox": [300, 880, 480, 990],
            "confidence": 0.9,
            "attributes": {"hasTextilePattern": "plain (pattern)"},
            "parts": [],
        },
        {
            "id": "e3",
            "class": "Shoe",
            "label": "brown leather shoe, right",
            "bbox": [520, 880, 700, 990],
            "confidence": 0.9,
            "attributes": {"hasTextilePattern": "plain (pattern)"},
            "parts": [],
        },
        {
            "id": "e4",
            "class": "Spaceship",
            "label": "a toy",
            "bbox": None,
            "confidence": 0.2,
            "attributes": {},
            "parts": [],
        },
        {
            "id": "e5",
            "class": "UpperBodyGarment",
            "label": "something on top",
            "bbox": None,
            "confidence": 0.3,
            "attributes": {},
            "parts": [],
        },
    ],
    "ontology_feedback": [],
    "notes": "",
}


def _garments(svc):
    view = classify.load_ontology(svc, "fashion")
    validated, _ = vision.validate(json.dumps(ANSWER), owl.vocabulary(view))
    return look.garments_of(view, validated["entities"])


def test_garments_are_the_vocabulary_nodes_ingest_links_to(loaded_service):
    garments, skipped = _garments(loaded_service)
    coat, shoes = garments
    assert coat.category_id == "category:coat" and coat.id == "garment:1"
    assert {v["id"] for v in coat.values} == {
        "attribute:length:knee",
        "attribute:opening-type:double-breasted",
        "attribute:textile-pattern:plain",
    }
    assert {v["family"] for v in coat.values} == {"length", "opening-type", "textile-pattern"}
    assert [p["id"] for p in coat.parts] == ["category:lapel"]
    # the pair of shoes is one garment
    assert shoes.category_id == "category:shoe" and shoes.entities == ["e2", "e3"]
    assert shoes.name == "brown leather shoe"  # the pair, not its left half
    assert "×2" in shoes.summary()
    # the same reasons ingest gives for leaving an entity out
    assert len(skipped) == 2 and any("group" in s for s in skipped)
    # the ids are the nodes the catalog's items already hang off
    store = loaded_service.store
    for vid in [coat.category_id, shoes.category_id, *coat.vocabulary()]:
        assert store.get_node(vid) is not None, vid


def test_garment_from_dict_checks_the_ids():
    ok = look.Garment.from_dict(
        {
            "id": "garment:1",
            "category_id": "category:coat",
            "values": [{"id": "attribute:length:knee", "name": "knee"}, {"id": "DROP TABLE"}],
        }
    )
    assert [v["id"] for v in ok.values] == ["attribute:length:knee"]
    with pytest.raises(ValueError):
        look.Garment.from_dict({"id": "garment:1", "category_id": "MATCH (n) DETACH DELETE n"})
    with pytest.raises(ValueError):
        look.Garment.from_dict("garment:1")


# A photo of one piece (tab 5's example items, ontologies/fashion/examples/items/): the shoes alone.


# What Amazon Nova 2 Lite answered for a photo of a checked blazer cut out of an outfit photo
# (as a customer might take it): the blazer, and the edges of what is worn around it. The turtleneck is the
# most confident and the skirt's box is the widest, so neither order nor one box decides alone.
