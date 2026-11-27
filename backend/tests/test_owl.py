# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""OWL parsing, the view and the classification prompt (owl.py), the flat ontology model
(ontology.py) and the ontology catalog with its domain folders (ontologies.py)."""

import json
import socket
import urllib.request

import pytest
from conftest import ONTOLOGIES, ONTOLOGY
from rdflib import DCTERMS, RDF, RDFS, SKOS, Graph, Namespace, URIRef

from ontology_rag import kg, owl, vision
from ontology_rag.ontologies import DOMAIN_DEFAULTS, OntologyCatalog, parse_upload
from ontology_rag.ontology import load_ontology

MINI_TTL = """
@prefix : <http://example.org/mini#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix fo: <http://example.org/multimodal-ai-knowledge-graph/fashion#> .
<http://example.org/mini> a owl:Ontology ; rdfs:label "Mini" ; owl:versionInfo "0.1" .
:Vehicle a owl:Class ; rdfs:label "vehicle" .
:Car a owl:Class ; rdfs:subClassOf :Vehicle .
:Bike a owl:Class ; rdfs:subClassOf :Vehicle .
:Wheel a owl:Class ; rdfs:label "wheel" .
:Colour a owl:Class .
:red a owl:NamedIndividual, :Colour ; rdfs:label "red" .
:blue a owl:NamedIndividual, :Colour ; rdfs:label "blue" .
:hasColour a owl:ObjectProperty ; rdfs:domain :Vehicle ; rdfs:range :Colour .
:hasWheel a owl:ObjectProperty ; rdfs:domain :Vehicle ; rdfs:range :Wheel .
:Invoice a owl:Class ; fo:visual false .
"""


# ---------------------------------------------------------------------- owl.py
def test_parse_rdf_sniffs_turtle_and_rejects_garbage():
    g = owl.parse_rdf(MINI_TTL)
    assert len(g) > 10
    with pytest.raises(ValueError) as err:
        owl.parse_rdf("this is not turtle @@@")
    # the parser's message reaches the browser: its class and one short line, nothing more
    text = str(err.value)
    prefix = "could not parse ontology as turtle: BadSyntax: "
    assert text.startswith(prefix) and "\n" not in text and len(text) <= len(prefix) + 120
    with pytest.raises(ValueError):
        owl.parse_rdf("   ")
    with pytest.raises(ValueError, match="unsupported ontology format 'trig'"):
        owl.parse_rdf(MINI_TTL, fmt="trig")
    with pytest.raises(ValueError, match="larger than 1 MB"):
        owl.parse_rdf("# " + "x" * owl.MAX_UPLOAD_BYTES, filename="big.ttl")


JSONLD_CLASS = {"@id": "http://example.org/x#A", "@type": "http://www.w3.org/2002/07/owl#Class"}
INLINE_CONTEXT = {"label": "http://www.w3.org/2000/01/rdf-schema#label"}


def _no_network(monkeypatch):
    """rdflib fetches remote contexts through urllib; refusing both the function and the socket
    behind it makes any attempt a test failure."""

    def refuse(*args, **kwargs):
        raise AssertionError("the parser must not open a connection")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.mark.parametrize(
    "doc",
    [
        {"@context": "http://127.0.0.1:1/ctx", **JSONLD_CLASS},
        {"@context": ["http://127.0.0.1:1/ctx", INLINE_CONTEXT], **JSONLD_CLASS},
        {"@context": {**INLINE_CONTEXT, "@import": "http://127.0.0.1:1/ctx"}, **JSONLD_CLASS},
        # a scoped context on a term, and one on a nested node
        {
            "@context": {"label": {"@id": "http://x/l", "@context": "http://127.0.0.1:1/c"}},
            **JSONLD_CLASS,
        },
        {"@graph": [{"@context": "http://127.0.0.1:1/ctx", **JSONLD_CLASS}]},
    ],
)
def test_json_ld_with_a_remote_context_is_refused(doc, monkeypatch):
    _no_network(monkeypatch)
    with pytest.raises(ValueError, match="must carry their @context inline, not as a URL"):
        owl.parse_rdf(json.dumps(doc), filename="upload.jsonld")


def test_json_ld_with_an_inline_context_parses_without_a_network_call(monkeypatch):
    _no_network(monkeypatch)
    g = owl.parse_rdf(json.dumps({"@context": INLINE_CONTEXT, **JSONLD_CLASS, "label": "A"}))
    assert len(g) == 2


def test_rdf_xml_with_a_doctype_is_refused_before_parsing():
    bomb = """<?xml version="1.0"?>
<!DOCTYPE rdf:RDF [ <!ENTITY a "aaaaaaaaaa"> <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"> ]>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Class rdf:about="http://x#A"/></rdf:RDF>"""
    with pytest.raises(ValueError, match="must not declare a DOCTYPE"):
        owl.parse_rdf(bomb, filename="bomb.owl")
    plain = """<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Class rdf:about="http://x#A"/></rdf:RDF>"""
    assert len(owl.parse_rdf(plain, filename="plain.owl")) == 1


def test_rdf_xml_in_utf_16_is_refused_before_parsing():
    """In UTF-16 the bytes of "<!DOCTYPE" are "<\\0!\\0D\\0...", which the DOCTYPE check does not
    see, while expat reads the encoding from the first bytes and would expand the entities. As a
    JSON string (the upload route) the document is its UTF-16 bytes read as Latin-1."""
    bomb = """<?xml version="1.0"?>
<!DOCTYPE rdf:RDF [ <!ENTITY a "aaaaaaaaaa"> <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"> ]>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Class rdf:about="http://x#A"/></rdf:RDF>"""
    as_json_string = bomb.encode("utf-16-le").decode("latin-1")
    with pytest.raises(ValueError, match="must be UTF-8 and must not declare a DOCTYPE"):
        owl.parse_rdf(as_json_string, filename="bomb.owl")
    with pytest.raises(ValueError, match="must be UTF-8"):
        owl.parse_rdf(bomb.encode("utf-16"), fmt="xml")  # with a byte order mark


def test_view_and_vocabulary_on_a_generic_ontology():
    view = owl.ontology_view(owl.parse_rdf(MINI_TTL), "mini")
    kinds = {n["kind"] for n in view.nodes}
    assert kinds == {"class", "individual", "objectProperty"}
    assert view.stats["classes"] == 6 and view.stats["individuals"] == 2
    voc = owl.vocabulary(view)
    names = {owl.local_name(k) for k in voc.entity_classes}
    assert names == {
        "Vehicle",
        "Car",
        "Bike",
        "Wheel",
    }  # Colour is a value class, Invoice non-visual
    assert {owl.local_name(k) for k in voc.value_classes} == {"Colour"}
    assert [owl.local_name(p["id"]) for p in voc.attribute_props] == ["hasColour"]
    assert [owl.local_name(p["id"]) for p in voc.relation_props] == ["hasWheel"]
    assert voc.is_a(
        str(next(k for k in voc.entity_classes if k.endswith("Car"))),
        str(next(k for k in voc.entity_classes if k.endswith("Vehicle"))),
    )


def test_classification_prompt_is_deterministic_and_lists_values():
    view = owl.ontology_view(owl.parse_rdf(MINI_TTL), "mini")
    p1, p2 = owl.classification_prompt(view), owl.classification_prompt(view)
    assert p1 == p2
    assert "- Vehicle" in p1 and "  - Car" in p1 and "Invoice" not in p1
    assert "hasColour (applies to Vehicle): blue, red" in p1
    assert "hasWheel: Vehicle -> Wheel" in p1
    assert '"entities"' in p1


# A generic ontology whose photo becomes a Scene (schema only, like fashion's Look): the weather
# of the scene is a property of the photo as a whole.
SCENE_TTL = (
    MINI_TTL
    + """
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
:Scene a owl:Class ; fo:visual false .
:Weather a owl:Class .
:sunny a owl:NamedIndividual, :Weather ; skos:prefLabel "Sunny" ; skos:definition "Clear sky." .
:rainy a owl:NamedIndividual, :Weather ; skos:prefLabel "Rainy" ; skos:hiddenLabel "wet" .
:during a owl:ObjectProperty ; rdfs:domain :Scene ; rdfs:range :Weather .
"""
)
WHOLE = (
    "For a photo of an outfit, choose at most one value per property for the outfit as a whole, "
    'or leave the property out when no value fits. For a text, leave "photo_properties" out.'
)


def test_a_property_of_the_image_class_is_asked_for_the_photo_as_a_whole():
    view = owl.ontology_view(owl.parse_rdf(SCENE_TTL), "scene")
    voc = owl.vocabulary(view, "Scene")
    assert [owl.local_name(p["id"]) for p in voc.photo_props] == ["during"]
    assert [owl.local_name(c) for c in voc.vocab_classes] == ["Weather"]
    assert [owl.local_name(p["id"]) for p in voc.attribute_props] == ["hasColour"]
    by_name = {owl.local_name(n["id"]): n for n in view.nodes}
    assert by_name["rainy"]["hidden_labels"] == ["wet"] and by_name["rainy"]["definition"] == ""
    assert by_name["sunny"]["definition"] == "Clear sky."
    prompt = owl.classification_prompt(view, "Scene")
    section = prompt.split("## The whole photo (name: allowed values)\n", 1)[1].split("\n\n")[0]
    # one line per property: each value's pref label, its definition in parentheses when it has one
    assert section.splitlines() == [WHOLE, "- during: Rainy; Sunny (Clear sky.)"]
    assert prompt.index("## Attribute properties") < prompt.index("## The whole photo")
    assert prompt.index("## The whole photo") < prompt.index("## Ontology feedback")
    assert (
        '"relation": "<relation property>"}]}], "photo_properties": {"<property>": '
        '"<allowed value>"}, "ontology_feedback": ' in prompt
    )
    # without the image class, or without such a property, the prompt is what it was
    plain = owl.classification_prompt(view)
    assert "## The whole photo" not in plain and "photo_properties" not in plain
    mini = owl.ontology_view(owl.parse_rdf(MINI_TTL), "mini")
    assert owl.classification_prompt(mini, "Scene") == owl.classification_prompt(mini)


def test_the_fashion_prompt_asks_for_the_looks_occasion(loaded_service):
    view = loaded_service.ontology_view("fashion")
    prompt = owl.classification_prompt(view, kg.KG_SCHEMA["image"][0])
    assert (
        "\n- for: Business casual (An office without a suit.); Casual (Relaxed everyday wear.); "
        "Dress (A day look built around a dress.); Evening (An evening out: dinner, drinks, a "
        "show.); Formal (Black tie and formal events.); Outdoor (Outdoor work and weather.); "
        "Professional (Tailored office wear.); Resort (Warm-weather travel and resort days.); "
        "Smart casual (Casual pieces dressed up a step.)\n" in prompt
    )
    assert "night out" not in prompt  # hidden labels are for matching data, never shown
    # the occasion is not offered as an attribute of a garment
    assert "- for (applies to" not in prompt
    # the aisles have no property of a whole photo: their prompts do not change
    for aisle in ("beauty", "food", "home"):
        aisle_view = owl.ontology_view(owl.load_graph(ONTOLOGIES / aisle / f"{aisle}.ttl"), aisle)
        assert owl.classification_prompt(aisle_view, "Look") == owl.classification_prompt(
            aisle_view
        )


def test_fashion_view_matches_pipeline_ontology(ontology):
    view = owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion")
    concept_ids = {n["concept_id"] for n in view.nodes if n.get("concept_id")}
    expected = (
        set(ontology.groups)
        | set(ontology.categories)
        | set(ontology.families)
        | set(ontology.attributes)
        | {v["id"] for v in ontology.vocab_nodes}  # occasion:evening, …
        | {v["class"]["concept_id"] for v in ontology.vocab_nodes}  # occasion
    )
    assert concept_ids == expected
    voc = owl.vocabulary(view, kg.KG_SCHEMA["image"][0])
    # Knowledge-graph schema classes are not offered to the vision model.
    assert not any(
        owl.local_name(k) in {"Look", "Item", "Article", "Statement", "Line", "Brand"}
        for k in voc.entity_classes
    )
    assert len(voc.attribute_props) == 11 and [
        owl.local_name(p["id"]) for p in voc.relation_props
    ] == ["hasPart"]
    # the look's occasion is a property of the photo as a whole, not an attribute of a garment
    assert [owl.local_name(p["id"]) for p in voc.photo_props] == ["for"]
    assert [owl.local_name(c) for c in voc.vocab_classes] == ["Occasion"]
    assert "Occasion" not in {owl.local_name(k) for k in voc.entity_classes}
    # without the image class there is no photo property, and "for" is no attribute either:
    # its domain (Look) is not a class the model can locate
    plain = owl.vocabulary(view)
    assert plain.photo_props == [] and len(plain.attribute_props) == 11


def test_the_occasions_are_the_samples_own_and_their_graph_nodes_follow_the_ontology(ontology):
    """Version 1.2.0 adds a closed list of occasions (CC BY 4.0: marked as changes): the class,
    nine named individuals with a definition and the property for. Their graph form: a node
    labelled with the class, the concept id as id, the pref label as name, reached by FOR."""
    fo = Namespace("http://example.org/multimodal-ai-knowledge-graph/fashion#")
    g = owl.load_graph(ONTOLOGY)
    note = "Added by this sample; not part of the Fashionpedia ontology."
    individuals = sorted(g.subjects(RDF.type, fo.Occasion))
    assert len(individuals) == 9
    for term in [fo.Occasion, fo["for"], *individuals]:
        assert str(g.value(term, SKOS.editorialNote)) == note
    assert all(g.value(i, SKOS.definition) for i in individuals)
    assert str(g.value(fo.occasion_dress, fo.conceptId)) == "occasion:dress"  # the DNA's id
    view = owl.ontology_view(g, "fashion")
    assert "a closed vocabulary of occasions" in view.comment
    nodes = {v["id"]: v for v in ontology.vocab_nodes}
    assert sorted(nodes) == [
        "occasion:business_casual",
        "occasion:casual",
        "occasion:dress",
        "occasion:evening",
        "occasion:formal",
        "occasion:outdoor",
        "occasion:professional",
        "occasion:resort",
        "occasion:smart_casual",
    ]
    evening = nodes["occasion:evening"]
    assert (evening["label"], evening["name"], evening["property"]["edge"]) == (
        "Occasion",
        "Evening",
        "FOR",
    )
    assert evening["labels"] == ["Evening", "dinner", "night out"]  # hidden labels match data
    assert evening["class"]["concept_id"] == "occasion"
    assert evening["iri"] == str(fo.occasion_evening)
    # an answer that names an occasion becomes the same node the deploy writes
    terms = {n["id"]: n for n in view.to_dict()["nodes"]}
    vocab = {v["iri"]: v for v in ontology.vocab_nodes}
    assert kg.graph_id(fo.occasion_evening, terms, vocab) == "occasion:evening"
    assert kg.graph_id(fo["silhouette_a-line"], terms, vocab) == "attribute:silhouette:a-line"
    nodes_out, edges_out = {}, []
    kg.vocabulary_node(terms[str(fo.occasion_evening)], terms, nodes_out, edges_out, vocab)
    (node,) = nodes_out.values()
    assert (node.id, node.labels, node.props, edges_out) == (
        "occasion:evening",
        ["Occasion"],
        {"name": "Evening"},
        [],
    )


def test_owl_loader_maps_the_ontology_onto_the_flat_model():
    o = load_ontology(ONTOLOGY)
    assert o.name == "fashion" and o.version == "1.2.0"
    assert o.source["license"].startswith("https://creativecommons.org/licenses/by/4.0")
    assert o.categories["coat"].group == "wholebody" and o.categories["coat"].kind == "item"
    assert set(o.families["waistline"].applies_to) == {"lowerbody", "wholebody"}
    assert o.attributes["nickname:polo-shirt"].name == "polo (shirt)"


def test_the_samples_own_classes_are_marked_in_the_owl():
    """CC BY 4.0 asks that changes are indicated: every category from Fashionpedia carries its
    taxonomy id, every category the sample adds (the jewelry) carries an editorial note instead,
    and the ontology's own comment lists the addition."""
    fo = Namespace("http://example.org/multimodal-ai-knowledge-graph/fashion#")
    g = owl.load_graph(ONTOLOGY)
    groups = set(g.subjects(RDFS.subClassOf, fo.Apparel)) | set(
        g.subjects(RDFS.subClassOf, fo.GarmentComponent)
    )
    categories = {c for grp in groups for c in g.subjects(RDFS.subClassOf, grp)}
    added = {c for c in categories if (c, fo.taxonomyId, None) not in g}
    assert sorted(owl.local_name(c) for c in added) == ["Bracelet", "Earring", "Necklace", "Ring"]
    for c in added:
        assert str(g.value(c, SKOS.editorialNote)) == (
            "Added by this sample; not part of the Fashionpedia ontology."
        )
        assert g.value(c, RDFS.subClassOf) == fo.OtherAccessory and g.value(c, RDFS.comment)
    assert not any((c, SKOS.editorialNote, None) in g for c in categories - added)
    onto = owl.ontology_view(g, "fashion")
    assert "four jewelry categories that Fashionpedia does not have" in onto.comment
    voc = owl.vocabulary(onto)
    assert owl.local_name(voc.by_key["bangle"]["id"]) == "Bracelet"
    assert "cuff" not in voc.by_key and "chain" not in voc.by_key  # sleeve cuffs, chain belts


def test_prompt_asks_for_ontology_feedback(loaded_service):
    prompt = owl.classification_prompt(loaded_service.ontology_view("fashion"))
    assert "## Ontology feedback" in prompt
    assert prompt.index("## Ontology feedback") < prompt.index("## Output")
    # the model is asked for improvements from what it saw but the ontology could not express …
    assert (
        "propose an improvement to the ontology" in prompt and "kept you from expressing" in prompt
    )
    # … and no longer to cap its answer
    assert "at most 12 entities" not in prompt and "Keep the answer compact" not in prompt
    assert (
        '"ontology_feedback": [{"observed":' in prompt
        and '"kind": "class|value|property|relation"' in prompt
    )


# ---------------------------------------------------------------------- catalog + examples
def test_catalog_lists_fashion_with_examples():
    cat = OntologyCatalog(ONTOLOGIES)
    ids = [e.id for e in cat.entries()]
    assert ids == ["beauty", "fashion", "food", "home"]
    # fashion is the only domain the tabs work with; the aisles are there to browse (tab 1 step 4)
    assert [e.id for e in cat.entries() if not e.domain()["browse_only"]] == ["fashion"]
    entry = cat.entry("fashion")
    files = [e["file"] for e in entry.examples()]
    assert len(files) == 8 and files[0] == "01-trench-coat-sweater-dress.jpg"
    assert entry.examples()[0]["model_id"]  # manifest metadata merged in
    with pytest.raises(FileNotFoundError):
        entry.example_path("../fashion.ttl")
    assert entry.images_dir == ONTOLOGIES / "fashion" / "examples" / "images"
    assert len(entry.articles()) == 6
    assert entry.articles_dir == ONTOLOGIES / "fashion" / "examples" / "articles"
    detail = cat.detail("fashion")
    assert detail["entity_classes"] == 64 and detail["prompt"].startswith("You classify")
    # domain.json: the domain's name and the words of the per-request instruction
    assert detail["domain"]["name"] == "Fashion"
    assert detail["domain"]["subject"] == "garment, accessory and garment component"
    assert detail["domain"]["scene"] == "an outfit"
    assert len(detail["domain"]["example_questions"]) == 5  # 1 of the domain, 4 of anycompany-apparel
    # the sample's data sets: its own brand, and one look of a second brand (white sneakers)
    assert detail["data_sets"] == ["anycompany-apparel", "anycompany-fashion-house"]
    assert "rule_examples" not in detail["domain"]  # the rule editor and its placeholders are gone


def test_tab_2_first_batch_is_marked_in_the_manifests_and_shows_white_sneakers():
    """The sample has no new shoot, so tab 2 starts with the examples marked ``"batch": "first"``
    (web ``defaultBatch``): three photos and the three texts about them, one of them with white
    sneakers, the garment of the sample's example question that step 1 counts."""
    entry = OntologyCatalog(ONTOLOGIES).entry("fashion")
    photos = {e["file"]: e for e in entry.examples() if e.get("batch") == "first"}
    texts = {a["file"]: a for a in entry.articles() if a.get("batch") == "first"}
    assert sorted(photos) == [
        "01-trench-coat-sweater-dress.jpg",
        "04-biker-jacket-jeans-sneakers.jpg",
        "08-pinstripe-suit.jpg",
    ]
    assert sorted(texts) == [
        "01-three-ways-trench.md",
        "03-fitting-room-pinstripe-suit.md",
        "04-biker-jacket-weekend-post.md",
    ]
    assert {a["pairs_with_image"] for a in texts.values()} == set(photos)
    # step 1's count of the batch's photos with the garment reads the title (IngestPipeline.tsx)
    sneakers = [e for e in photos.values() if "white sneakers" in e["title"]]
    assert [e["file"] for e in sneakers] == ["04-biker-jacket-jeans-sneakers.jpg"]
    _, text = entry.article_text("04-biker-jacket-weekend-post.md")
    assert "sneakers: white" in text.lower()


def test_domain_defaults_without_domain_json(tmp_path):
    """A folder with only an ontology lists, with the neutral domain and the neutral wording."""
    folder = tmp_path / "mini"
    folder.mkdir()
    (folder / "mini.ttl").write_text(MINI_TTL)
    cat = OntologyCatalog(tmp_path)
    entry = cat.entry("mini")
    assert entry.examples() == [] and entry.articles() == []
    domain = entry.domain()
    assert domain == {**DOMAIN_DEFAULTS, "example_questions": [], "photo_questions": []}
    assert cat.summary(entry)["domain"]["name"] == "Mini"  # the ontology's own name
    assert vision.user_instruction((b"", "png"), domain) == (
        "Classify every entity and component visible in this image using the ontology. "
        "Return only the JSON object."
    )
    assert vision.text_instruction(domain).startswith(
        "The text inside <source_text> above describes a scene."
    )
    # the fashion wording is the one the sample always had
    fashion = OntologyCatalog(ONTOLOGIES).entry("fashion").domain()
    assert vision.user_instruction((b"", "png"), fashion) == (
        "Classify every garment, accessory and garment component visible in this image using the "
        "ontology. Return only the JSON object."
    )
    assert vision.text_instruction(fashion).startswith(
        "The text inside <source_text> above describes an outfit. Classify every garment, "
        "accessory and garment component it mentions"
    )


def test_parse_upload_produces_detail_shape():
    d = parse_upload(MINI_TTL, "mini.ttl")
    assert d["id"].startswith("upload-") and d["name"] == "Mini"
    assert d["stats"]["classes"] == 6 and d["examples_list"] == []


def test_the_fashion_ontology_says_it_is_cc_by_and_not_mit0():
    """fashion.ttl is derived from the Fashionpedia ontology: its first lines and its
    dcterms:rights say that it is licensed under CC BY 4.0 and that the repository's MIT-0
    license does not apply to it (a rebuild must keep both)."""
    assert ONTOLOGY.read_text(encoding="utf-8").splitlines()[0] == (
        "# SPDX-License-Identifier: CC-BY-4.0"
    )
    g = Graph().parse(ONTOLOGY)
    onto = URIRef("http://example.org/multimodal-ai-knowledge-graph/fashion")
    assert str(g.value(onto, DCTERMS.license)) == "https://creativecommons.org/licenses/by/4.0/"
    rights = str(g.value(onto, DCTERMS.rights))
    assert "not under the MIT-0 license" in rights and "do not endorse" in rights
    assert "MIT-0" not in str(g.value(onto, DCTERMS.creator))
