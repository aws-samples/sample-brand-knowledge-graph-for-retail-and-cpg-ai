# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The domain's wording (``ontologies/<id>/domain.json``: persona, noun, labels) is read for the
fashion domain as written, and a folder without the file gets the neutral words."""

from __future__ import annotations

from conftest import ONTOLOGIES

from ontology_rag.ontologies import DOMAIN_DEFAULTS, OntologyCatalog


def _domain(ontology_id: str) -> dict:
    return OntologyCatalog(ONTOLOGIES).entry(ontology_id).domain()


def test_fashion_reads_its_wording_from_domain_json():
    domain = _domain("fashion")
    assert domain["persona"] == {
        "answer": "You are the in-house stylist for a fashion brand.",
        "role": "stylist",
    }
    assert domain["noun"] == {"singular": "garment", "plural": "garments"}
    assert domain["labels"] == {
        "qa_tab": "Style Q&A + Style recommendation",
        "rule": "brand rule",
        "rules": "brand rules",
    }


def test_a_domain_without_the_file_gets_the_neutral_wording(tmp_path):
    folder = tmp_path / "mini"
    folder.mkdir()
    (folder / "mini.ttl").write_text("@prefix : <http://x/> . <http://x/o> a <http://x/C> .")
    (folder / "domain.json").write_text('{"noun": {"plural": "vehicles"}}')  # one word set
    domain = OntologyCatalog(tmp_path).entry("mini").domain()
    assert domain["persona"] == DOMAIN_DEFAULTS["persona"] and domain["labels"]["rule"] == "rule"
    assert domain["noun"] == {"singular": "item", "plural": "vehicles"}  # the rest kept
