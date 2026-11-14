# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import pytest

from ontology_rag.ontology import resolve_value


def test_ontology_counts(ontology):
    assert len(ontology.categories) == 50
    assert len(ontology.attributes) == 294
    assert len(ontology.families) == 11
    # 27 main apparel categories from Fashionpedia plus the sample's 4 jewelry categories;
    # 19 parts, closures and decorations
    kinds = [c.kind for c in ontology.categories.values()]
    assert kinds.count("item") == 31 and kinds.count("part") == 19


def test_jewelry_categories_are_the_samples_own(ontology):
    """Fashionpedia has no jewelry: the sample adds four categories to the other accessories,
    without a Fashionpedia taxonomy id, with their synonyms in the name like Fashionpedia's."""
    jewelry = {c.id: c for c in ontology.categories.values() if not c.taxonomy_id}
    assert {cid: (c.name, c.group, c.kind) for cid, c in jewelry.items()} == {
        "earring": ("earring, ear stud, hoop", "others", "item"),
        "necklace": ("necklace, pendant, choker", "others", "item"),
        "bracelet": ("bracelet, bangle, cuff bracelet", "others", "item"),
        "ring": ("ring", "others", "item"),
    }
    families = {f.id for f in ontology.families_for_group("others")}
    assert families == {"non-textile-material-type", "animal", "leather"}
    valid, _ = ontology.validate_attributes("earring", {"non-textile-material-type": "metal"})
    assert valid == {"non-textile-material-type": "non-textile-material-type:metal"}


def test_resolve_attribute_ignores_qualifier(ontology):
    a = ontology.resolve_attribute("neckline-type", "crew")
    assert a is not None and a.name == "crew (neck)"
    assert ontology.resolve_attribute("neckline-type", "crew (neck)").id == a.id
    assert ontology.resolve_attribute("silhouette", "made-up") is None


def test_validate_attributes_rejects_unknown_and_inapplicable(ontology):
    valid, rejected = ontology.validate_attributes(
        "jacket",
        {"silhouette": "oversized", "waistline": "high waist", "textile-pattern": "plaid"},
    )
    assert valid == {"silhouette": "silhouette:oversized"}
    assert any("waistline" in r and "not applicable" in r for r in rejected)
    assert any("plaid" in r and "not in ontology" in r for r in rejected)


def test_the_occasions_are_vocabulary_nodes_not_attributes(ontology):
    """The occasions are no attribute family (the 294 values and 11 families stay): they are the
    vocabulary values of the look's property ``for``, nodes of their own class."""
    assert len(ontology.vocab_nodes) == 9
    assert {v["label"] for v in ontology.vocab_nodes} == {"Occasion"}
    assert {v["property"]["name"] for v in ontology.vocab_nodes} == {"for"}
    assert not any(a.startswith("occasion:") for a in ontology.attributes)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # one facet: equal to a label, case and punctuation aside
        ("Professional", "occasion:professional"),
        ("smart casual", "occasion:smart_casual"),
        ("business_casual", "occasion:business_casual"),  # a manifest's slug
        ("gala", "occasion:formal"),  # a hidden label
        # compound texts: the facets in order, the first that resolves wins
        ("evening / formal", "occasion:evening"),
        ("resort / evening", "occasion:resort"),
        ("work / outdoors", "occasion:outdoor"),  # "work" names none, "outdoors" does
        ("evening / cold weather", "occasion:evening"),
        ("business / smart", "occasion:professional"),
        # a label inside a facet as whole words, the longest label first
        ("casual weekend", "occasion:casual"),
        ("smart casual dinner", "occasion:smart_casual"),
        # weather is no occasion, and part of a word is no match
        ("cold weather", None),
        ("warm weather", None),
        ("my-dresses", None),
        ("", None),
    ],
)
def test_a_data_text_resolves_to_one_occasion_or_none(ontology, text, expected):
    value = resolve_value(text, ontology.vocab_nodes)
    assert (value["id"] if value else None) == expected


def test_dress_the_occasion_never_matches_the_garment_class(ontology):
    """The word Dress is an occasion and a garment class (fo:Dress): only occasions are tried."""
    assert resolve_value("Dress", ontology.vocab_nodes)["iri"].endswith("#occasion_dress")
    assert "dress" in ontology.categories  # the garment class is still there, untouched
