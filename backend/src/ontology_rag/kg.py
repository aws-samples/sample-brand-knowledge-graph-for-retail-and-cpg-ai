# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""From the model's answer to the knowledge graph: generic, driven by the ontology.

Three plain functions, used by the ingest step of the pipeline (``pipeline.ingest_source``):

1. :func:`to_owl`: the validated answer as **OWL individuals** (an rdflib graph) that use the
   ontology's own classes and properties. Every entity becomes an individual of the ontology's
   item class, linked to the class the model chose, to each attribute value (a named individual of
   the ontology) and to each part class; the source becomes one more individual: a look that
   contains the items and has the photo's own values (its occasion), or a statement that
   illustrates them.
2. :func:`to_property_graph`: **any** RDF graph of individuals → labeled nodes and typed edges,
   by four rules that know nothing about fashion (see the function).
3. :func:`write`: MERGE those nodes and edges into Neptune Analytics, one openCypher statement
   per label and per edge type.

Only :data:`KG_SCHEMA` names terms of the ontology (its knowledge-graph schema: ``fo:Item``,
``fo:isCategory``, ``fo:Look`` …). Another ontology names its own classes and properties there;
nothing else changes.
"""

from __future__ import annotations

import re
from collections import defaultdict

from rdflib import RDF, RDFS, Graph, Literal, Namespace, URIRef

from ontology_rag.graph.store import Edge, Node
from ontology_rag.owl import local_name, vocabulary

# The individuals the pipeline creates get IRIs in this namespace; the part after it is their
# id in the property graph (``item:…``, ``look:…``), so RDF and graph ids map one to one.
KG = Namespace("urn:multimodal-ai-knowledge-graph:kg:")

# How a classification result is expressed with the ontology's knowledge-graph schema: local
# names of classes and properties declared in the ontology (fashion.ttl, "KG schema").
KG_SCHEMA = {
    "item": "Item",  # every entity the model found is an individual of this class …
    "category": "isCategory",  # … linked to the ontology class the model chose
    "part": "hasPart",  # … and to the classes of its parts (when the model names no relation)
    "line": "fromLine",  # … and to the product line the batch belongs to
    "description": "description",  # datatype property: one line of text per item
    "image": ("Look", "contains"),  # a photo: one individual that contains the items
    "text": ("Statement", "illustrates"),  # a text: one statement that illustrates them …
    "article": ("Article", "hasStatement"),  # … in one article
}

# Ontology terms used as values become shared vocabulary nodes (rule 4 of to_property_graph); a
# vocabulary value, such as an occasion, becomes a node of its own class (vocabulary_nodes).
VOCABULARY = {
    "class": ("Category", "category"),  # label, id prefix
    "individual": ("Attribute", "attribute"),
    "family": ("AttributeFamily", "family"),  # the class of a named individual
}


# ---------------------------------------------------------------------- 1. answer → OWL
def to_owl(view: dict, classified: dict, source: dict) -> tuple[Graph, list[str]]:
    """The validated answer of one source as OWL individuals, plus what was left out and why.

    ``classified`` is the classify step's record (``result.entities`` with ``class_iri``,
    ``attribute_iris`` and ``parts``); ``source`` holds the run's context: ``label``, ``kind``,
    ``line_id``, ``run_id``, ``key`` and the article metadata for a text. A photo's own values
    (``{property IRI: value IRI}``) are ``source["photo_property_iris"]`` when the run decided
    them (the pipeline puts an example's manifest first), else the model's
    (``result.photo_property_iris``).
    """
    term = {local_name(n["id"]): URIRef(n["id"]) for n in view["nodes"]}
    node = {n["id"]: n for n in view["nodes"]}
    g = Graph()
    g.bind("kg", KG)
    for prefix, namespace in (view.get("prefixes") or {}).items():  # fo:, skos:, … for Turtle
        g.bind(prefix, namespace)

    items: list[URIRef] = []
    skipped: list[str] = []
    for ent in classified["result"]["entities"]:
        reason = skip_reason(ent, view)
        if reason:
            skipped.append(reason)
            continue
        items.append(add_item(g, term, node[ent["class_iri"]], ent, classified, source))

    if items and source["kind"] == "image":
        photo = source.get("photo_property_iris")
        if photo is None:
            photo = classified["result"].get("photo_property_iris") or {}
        vocab = {(v["property"]["iri"], v["iri"]): v for v in vocabulary_nodes(view)}
        values = [vocab[pair] for pair in photo.items() if pair in vocab]
        add_look(g, term, classified["digest"], items, source, values)
    elif items:
        add_article(g, term, classified["digest"], items, source)
    return g, skipped


def add_item(g: Graph, term: dict, cls: dict, ent: dict, classified: dict, source: dict) -> URIRef:
    """One entity as an individual: its class in the KG schema, category, values, parts."""
    item = KG[f"item:{classified['digest']}-{ent['id']}-{slug(ent['class'])}"]
    g.add((item, RDF.type, term[KG_SCHEMA["item"]]))  # a fo:Item
    g.add((item, RDFS.label, Literal(ent["label"] or ent["class"])))
    g.add((item, term[KG_SCHEMA["category"]], URIRef(ent["class_iri"])))  # fo:isCategory fo:Coat
    for prop, value in ent["attribute_iris"].items():
        g.add((item, URIRef(prop), URIRef(value)))  # fo:hasSilhouette fo:silhouette_a-line
    for part in ent["parts"]:
        relation = part["relation_iri"] or term[KG_SCHEMA["part"]]
        g.add((item, URIRef(relation), URIRef(part["class_iri"])))  # fo:hasPart fo:Lapel
    if source["line_id"]:
        g.add((item, term[KG_SCHEMA["line"]], KG[source["line_id"]]))

    values = ", ".join(ent["attributes"].values())
    description = f"{ent['class']} seen in {source['label']}" + (f"; {values}" if values else "")
    g.add((item, term[KG_SCHEMA["description"]], Literal(description)))
    provenance = {  # plain literals → node properties
        "category": concept_id(cls),
        "line": source["line_id"],
        "confidence": ent["confidence"] if ent["confidence"] is not None else -1,
        "model": classified["model_id"],
        "run": source["run_id"],
        "source": source["label"],
        "image_key": source["key"],
    }
    for key, value in provenance.items():
        g.add((item, KG[key], Literal(value)))
    return item


def skip_reason(ent: dict, view: dict) -> str | None:
    """Only entities whose class is in the ontology, and is a leaf class, become items."""
    if not ent["class_iri"]:
        return f"{ent['label'] or ent['class']!r}: class {ent['class']!r} is not in the ontology"
    has_subclasses = any(
        e["type"] == "subClassOf" and e["target"] == ent["class_iri"] for e in view["edges"]
    )
    if has_subclasses:
        return (
            f"{ent['label']!r}: {ent['class']} has subclasses, so it is a group and not a category"
        )
    return None


def add_look(
    g: Graph, term: dict, digest: str, items: list[URIRef], source: dict, values=()
) -> None:
    """A photo: one individual that contains the items (its vector is the photo itself), with
    the photo's own ``values`` (:func:`vocabulary_nodes`: the occasion), one triple each and the
    value's name as a property named after its class (``occasion: "Evening"``)."""
    cls, contains = KG_SCHEMA["image"]
    look = KG[f"look:{digest}"]
    g.add((look, RDF.type, term[cls]))
    g.add((look, RDFS.label, Literal(source["label"])))
    for item in items:
        g.add((look, term[contains], item))
    names = ", ".join(str(g.value(i, RDFS.label)) for i in items)
    g.add((look, KG["description"], Literal(f"Outfit in a photo: {names}")))
    for value in values:
        g.add((look, URIRef(value["property"]["iri"]), URIRef(value["iri"])))  # fo:for
        g.add((look, KG[value["class"]["concept_id"]], Literal(value["name"])))
    g.add((look, KG["image_key"], Literal(source["key"])))
    g.add((look, KG["run"], Literal(source["run_id"])))


def add_article(g: Graph, term: dict, digest: str, items: list[URIRef], source: dict) -> None:
    """A text: an article with one statement that illustrates the items (its vector is the text)."""
    article_cls, has_statement = KG_SCHEMA["article"]
    statement_cls, illustrates = KG_SCHEMA["text"]
    article, statement = KG[f"article:{digest}"], KG[f"st:{digest}-1"]
    g.add((article, RDF.type, term[article_cls]))
    g.add((article, RDFS.label, Literal(source["label"])))
    g.add((article, KG["title"], Literal(source["label"])))
    g.add((article, KG["source"], Literal(source.get("source") or "")))
    g.add((article, KG["published"], Literal(source.get("published") or "")))
    g.add((article, term[has_statement], statement))
    g.add((statement, RDF.type, term[statement_cls]))
    g.add((statement, RDFS.label, Literal(source["text"][:80])))
    g.add((statement, KG["text"], Literal(source["text"][:2000])))
    g.add((statement, KG["article"], Literal(f"article:{digest}")))
    for item in items:
        g.add((statement, term[illustrates], item))


# ---------------------------------------------------------------------- 2. OWL → property graph
def to_property_graph(g: Graph, view: dict) -> tuple[list[Node], list[Edge]]:
    """Any graph of OWL individuals as labeled nodes and typed edges.

    Rule 1  ``(s rdf:type C)``      → node ``s`` with label ``C``                   (:Item)
    Rule 2  ``(s P "literal")``     → property ``P`` of node ``s``                  {description: …}
    Rule 3  ``(s P o)``, ``o`` an IRI → edge ``s -[P]-> o``, ``P`` in UPPER_SNAKE    -[:CONTAINS]->
            A sub-property takes the type of its top super-property and keeps its range on the
            edge: ``hasSilhouette ⊑ hasAttribute`` → ``-[:HAS_ATTRIBUTE {family: "silhouette"}]->``
    Rule 4  ``o`` an ontology term → a vocabulary node shared by every source: a class becomes
            ``(:Category)``, a named individual ``(:Attribute)-[:IN_FAMILY]->(:AttributeFamily)``,
            a vocabulary value a node of its class (``(:Occasion)``, :func:`vocabulary_nodes`)
    """
    terms = {n["id"]: n for n in view["nodes"]}
    vocab = {v["iri"]: v for v in vocabulary_nodes(view)}
    nodes: dict[str, Node] = {}
    edges: list[Edge] = []
    for s, p, o in sorted(g):  # sorted: the same answer always gives the same statements
        subject = nodes.setdefault(graph_id(s, terms, vocab), Node(graph_id(s, terms, vocab), []))
        if p == RDF.type:  # rule 1
            subject.labels.append(local_name(o))
        elif isinstance(o, Literal):  # rule 2
            subject.props[property_key(p)] = o.toPython()
        else:  # rule 3
            edge_type, props = edge_type_of(str(p), terms)
            edges.append(Edge(subject.id, graph_id(o, terms, vocab), edge_type, props))
            if str(o) in terms:  # rule 4
                vocabulary_node(terms[str(o)], terms, nodes, edges, vocab)
    return list(nodes.values()), edges


def graph_id(iri, terms: dict, vocab: dict | None = None) -> str:
    """The graph id of an IRI: an individual of the pipeline keeps the part after the KG
    namespace; a vocabulary value (``vocab``: :func:`vocabulary_nodes` by IRI) is its concept id
    (``occasion:evening``); any other ontology term is ``<prefix>:<conceptId>``
    (``category:coat``)."""
    iri = str(iri)
    if iri.startswith(str(KG)):
        return iri[len(str(KG)) :]
    if vocab and iri in vocab:
        return vocab[iri]["id"]
    term = terms.get(iri)
    if term is None:
        return local_name(iri)
    kind = "individual" if term["kind"] == "individual" else "class"
    return f"{VOCABULARY[kind][1]}:{concept_id(term)}"


def property_key(predicate) -> str:
    """rdfs:label is the node's ``name``; any other predicate's local name is the property key."""
    if predicate == RDFS.label:
        return "name"
    iri = str(predicate)
    return iri[len(str(KG)) :] if iri.startswith(str(KG)) else local_name(iri)


def edge_type_of(prop_iri: str, terms: dict) -> tuple[str, dict]:
    """``hasPart`` → ``HAS_PART``; a sub-property → its top super-property, with its range kept."""
    prop, top = terms.get(prop_iri, {}), prop_iri
    for _ in range(8):  # climb rdfs:subPropertyOf to the most general property of the ontology
        parents = [x for x in terms.get(top, {}).get("super") or [] if x in terms]
        if not parents:
            break
        top = parents[0]
    props = {}
    if top != prop_iri and prop.get("range"):
        props["family"] = concept_id(terms[prop["range"][0]])
    return re.sub(r"(?<!^)(?=[A-Z])", "_", local_name(top)).upper(), props


def vocabulary_node(
    term: dict, terms: dict, nodes: dict[str, Node], edges: list[Edge], vocab: dict | None = None
) -> None:
    """Rule 4: the ontology term an edge points at, as a node (once per term)."""
    tid = graph_id(term["id"], terms, vocab)
    if tid in nodes:
        return
    if vocab and term["id"] in vocab:  # an occasion: (:Occasion {name}), no family
        nodes[tid] = Node(tid, [vocab[term["id"]]["label"]], {"name": vocab[term["id"]]["name"]})
        return
    name = term.get("pref_label") or term.get("label") or local_name(term["id"])
    if term["kind"] != "individual":
        nodes[tid] = Node(tid, [VOCABULARY["class"][0]], {"name": name})
        return
    nodes[tid] = Node(tid, [VOCABULARY["individual"][0]], {"name": name})
    family = terms[term["types"][0]]  # the class the value belongs to, e.g. Silhouette
    fid = f"{VOCABULARY['family'][1]}:{concept_id(family)}"
    nodes.setdefault(
        fid, Node(fid, [VOCABULARY["family"][0]], {"name": family.get("label") or fid})
    )
    edges.append(Edge(tid, fid, "IN_FAMILY"))


def vocabulary_nodes(view: dict) -> list[dict]:
    """The vocabulary values of the ontology as graph nodes: the values of the photo properties
    of :data:`KG_SCHEMA`'s image class (``owl.Vocabulary``: ``fo:for`` → the occasions). Each is
    labelled with its class's local name, has its concept id as id and its pref label as name
    (``(:Occasion {id: "occasion:evening", name: "Evening"})``); ``labels`` are every label a data
    text may match (pref, label, alt and hidden labels), ``class`` the property's range and
    ``property`` the photo property with its edge type (``FOR``). The deploy writes them all
    (``Loader.load_ontology``), so a look links to one, from the loader or from tab 2."""
    voc = vocabulary(view, KG_SCHEMA["image"][0])
    terms = {n["id"]: n for n in view["nodes"]}
    out = []
    for prop in sorted(voc.photo_props, key=lambda p: p["id"]):
        edge, _ = edge_type_of(prop["id"], terms)
        for rng in prop["range"]:
            for value in voc.values_under(rng):
                own = terms.get((value.get("types") or [rng])[0], terms[rng])
                name = value.get("pref_label") or value.get("label") or local_name(value["id"])
                labels = [name, value.get("label", ""), *value.get("alt_labels", [])]
                labels += value.get("hidden_labels", [])
                out.append(
                    {
                        "label": local_name(own["id"]),
                        "id": concept_id(value),
                        "name": name,
                        "labels": list(dict.fromkeys(x for x in labels if x)),
                        "iri": value["id"],
                        "class": {"iri": rng, "concept_id": concept_id(terms[rng])},
                        "property": {
                            "iri": prop["id"],
                            "name": local_name(prop["id"]),
                            "edge": edge,
                        },
                    }
                )
    return out


def concept_id(term: dict) -> str:
    """The ontology's stable machine id of a term (``fo:conceptId``), else its local name."""
    return term.get("concept_id") or local_name(term["id"]).lower()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "thing"


# ---------------------------------------------------------------------- 3. → Neptune
def write(store, nodes: list[Node], edges: list[Edge]) -> dict:
    """MERGE the nodes, then the edges (both ends must exist), one statement per label / type.

    ``store.merge_nodes`` / ``merge_edges`` run ``UNWIND $rows … MERGE`` on Neptune Analytics
    (``graph/neptune.py``): idempotent, so ingesting the same source twice changes nothing.
    """
    by_label: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        by_label[n.label].append({"id": n.id, "props": n.props})
    for label, rows in by_label.items():
        store.merge_nodes(label, rows)

    by_type: dict[str, list[dict]] = defaultdict(list)
    for e in edges:
        by_type[e.type].append({"source": e.source, "target": e.target, "props": e.props})
    for edge_type, rows in by_type.items():
        store.merge_edges(edge_type, rows)
    return {
        "nodes": {k: len(v) for k, v in by_label.items()},
        "edges": {k: len(v) for k, v in by_type.items()},
    }
