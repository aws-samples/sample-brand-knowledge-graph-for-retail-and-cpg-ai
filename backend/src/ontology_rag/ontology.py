# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Load the ontology and turn it into the graph's vocabulary and validation rules.

The ontology is the *controlled vocabulary* every other component is grounded in:

* the graph loader turns it into ``Group``/``Category``/``AttributeFamily``/``Attribute`` nodes,
  and its vocabulary values (the occasions) into nodes of their own class (``vocab_nodes``),
* a catalog's attributes are validated against it (unknown values are rejected, not invented:
  ``synth.py``), and a look's occasion text is matched against it (:func:`resolve_value`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from rdflib import DCTERMS, OWL, RDF, RDFS, SKOS, Literal, Namespace, URIRef

from ontology_rag import kg
from ontology_rag.owl import load_graph, ontology_view


@dataclass(frozen=True)
class Category:
    id: str
    name: str
    group: str
    taxonomy_id: str
    kind: str  # "item" (wearable) or "part" (garment part / closure / decoration)


@dataclass(frozen=True)
class Attribute:
    id: str
    name: str
    family: str
    taxonomy_id: str


@dataclass(frozen=True)
class AttributeFamily:
    id: str
    name: str
    applies_to: tuple[str, ...]


@dataclass(frozen=True)
class Group:
    id: str
    name: str
    label: str
    kind: str


@dataclass
class Ontology:
    name: str
    version: str
    groups: dict[str, Group]
    categories: dict[str, Category]
    families: dict[str, AttributeFamily]
    attributes: dict[str, Attribute]
    source: dict = field(default_factory=dict)
    # The vocabulary values as graph nodes (kg.vocabulary_nodes): label, id, name, labels, iri,
    # class and property, e.g. (:Occasion {id: "occasion:evening"}) reached by FOR from a Look.
    vocab_nodes: list[dict] = field(default_factory=list)

    # ------------------------------------------------------------------ lookups
    def attributes_in_family(self, family_id: str) -> list[Attribute]:
        return [a for a in self.attributes.values() if a.family == family_id]

    def families_for_group(self, group_id: str) -> list[AttributeFamily]:
        return [f for f in self.families.values() if group_id in f.applies_to]

    def resolve_attribute(self, family_id: str, value: str) -> Attribute | None:
        """Match an attribute inside a family by id or by name (qualifier-insensitive)."""
        if not value:
            return None
        v = value.strip().lower()
        if v in self.attributes and self.attributes[v].family == family_id:
            return self.attributes[v]
        for a in self.attributes_in_family(family_id):
            if v == a.name.lower() or v == _strip_qualifier(a.name):
                return a
        return None

    def validate_attributes(
        self, category_id: str, raw: dict[str, str]
    ) -> tuple[dict[str, str], list[str]]:
        """Keep only attribute values that exist in the ontology.

        Returns ``(valid {family_id: attribute_id}, rejected ["family=value", ...])``.
        Only families that apply to the category's group are accepted.
        """
        cat = self.categories.get(category_id)
        allowed = {f.id for f in self.families_for_group(cat.group)} if cat else set(self.families)
        valid: dict[str, str] = {}
        rejected: list[str] = []
        for fam, value in (raw or {}).items():
            if not value:
                continue
            fam_id = fam.strip().lower().replace(" ", "-")
            if fam_id not in allowed:
                rejected.append(f"{fam}={value} (family not applicable)")
                continue
            attr = self.resolve_attribute(fam_id, str(value))
            if attr is None:
                rejected.append(f"{fam}={value} (not in ontology)")
            else:
                valid[fam_id] = attr.id
        return valid, rejected


def _strip_qualifier(name: str) -> str:
    return re.sub(r"\s*\(.*?\)", "", name).strip().lower()


def _words(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def resolve_value(text: str, values: list[dict]) -> dict | None:
    """The vocabulary value a data text names, among ``values`` (the ``vocab_nodes`` of one
    property), or None.

    The text is split on "/" ("evening / formal") and its facets are tried in order: the first
    that resolves wins. A facet resolves when it equals one of a value's ``labels`` (pref, label,
    alt and hidden labels; case and punctuation aside, so "business_casual" is Business casual),
    else when one of those labels is in it as whole words, the longest label first ("casual
    weekend" is Casual). Only ``values`` are tried, so "Dress" the occasion never matches the
    garment class, and a weather word ("cold weather") resolves to nothing.
    """
    labels = sorted(
        ((_words(label), v) for v in values for label in v["labels"] if _words(label)),
        key=lambda pair: -len(pair[0]),
    )
    for facet in (_words(f) for f in re.split(r"/", text or "")):
        if not facet:
            continue
        exact = next((v for label, v in labels if label == facet), None)
        if exact is not None:
            return exact
        for label, v in labels:
            if re.search(rf"(?:^| ){re.escape(label)}(?: |$)", facet):
                return v
    return None


def load_ontology(path: str | Path) -> Ontology:
    """Map the OWL ontology (``ontologies/<name>/<name>.ttl``) onto the pipeline's flat model
    (groups, categories, families, attributes).

    Conventions the OWL file follows (see ``ontologies/fashion/build_fashion_ontology.py``):

    * every concept the pipeline needs carries ``fo:conceptId``, the stable id used in prompts,
      graph nodes and the sample data (``coat``, ``silhouette:a-line``, ...);
    * groups are the direct subclasses of ``fo:Apparel`` (wearables) and ``fo:GarmentComponent``
      (parts); categories are their subclasses;
    * attribute families are the subclasses of ``fo:Attribute``; attribute values are their
      named individuals;
    * applicability is the ``rdfs:domain`` (an ``owl:unionOf`` groups) of the ``has<Family>``
      property whose range is the family;
    * vocabulary values are the named individuals of the range of a property of the image class
      (``kg.vocabulary_nodes``; the occasions of a look), whatever their namespace.
    """
    g = load_graph(path)
    FO = Namespace("http://example.org/multimodal-ai-knowledge-graph/fashion#")

    def lit(subject, pred, default: str = "") -> str:
        for v in g.objects(subject, pred):
            if isinstance(v, Literal):
                return str(v)
        return default

    def val(subject, pred) -> str:
        """Literal or IRI value as a string (licenses and sources are IRIs)."""
        return str(next(iter(g.objects(subject, pred)), ""))

    def concept_id(node) -> str:
        return lit(node, FO.conceptId)

    def union_members(node) -> list:
        if isinstance(node, URIRef):
            return [node]
        out = []
        for lst in g.objects(node, OWL.unionOf):
            out.extend(g.items(lst))
        return out

    groups: dict[str, Group] = {}
    group_of_class: dict[URIRef, str] = {}
    for root, kind in ((FO.Apparel, "item"), (FO.GarmentComponent, "part")):
        for cls in sorted(g.subjects(RDFS.subClassOf, root), key=str):
            gid = concept_id(cls)
            if not gid:
                continue
            groups[gid] = Group(
                id=gid,
                name=lit(cls, SKOS.prefLabel, gid),
                label=lit(cls, RDFS.label, gid),
                kind=kind,
            )
            group_of_class[cls] = gid

    categories: dict[str, Category] = {}
    for cls, gid in group_of_class.items():
        for cat in sorted(g.subjects(RDFS.subClassOf, cls), key=str):
            cid = concept_id(cat)
            if not cid:
                continue
            categories[cid] = Category(
                id=cid,
                name=lit(cat, SKOS.prefLabel, cid),
                group=gid,
                taxonomy_id=lit(cat, FO.taxonomyId),
                kind=groups[gid].kind,
            )

    families: dict[str, AttributeFamily] = {}
    family_of_class: dict[URIRef, str] = {}
    for cls in sorted(g.subjects(RDFS.subClassOf, FO.Attribute), key=str):
        fid = concept_id(cls)
        if not fid:
            continue
        applies: list[str] = []
        for prop in g.subjects(RDFS.range, cls):
            for dom in g.objects(prop, RDFS.domain):
                applies += [group_of_class[m] for m in union_members(dom) if m in group_of_class]
        families[fid] = AttributeFamily(fid, lit(cls, SKOS.prefLabel, fid), tuple(applies))
        family_of_class[cls] = fid

    attributes: dict[str, Attribute] = {}
    for ind in sorted(g.subjects(RDF.type, OWL.NamedIndividual), key=str):
        fam = next(
            (family_of_class[t] for t in g.objects(ind, RDF.type) if t in family_of_class), None
        )
        aid = concept_id(ind)
        if fam is None or not aid:
            continue
        attributes[aid] = Attribute(
            id=aid,
            name=lit(ind, SKOS.prefLabel, aid),
            family=fam,
            taxonomy_id=lit(ind, FO.taxonomyId),
        )

    onto = next(iter(g.subjects(RDF.type, OWL.Ontology)), None)
    view = ontology_view(g, Path(path).stem).to_dict()
    return Ontology(
        name=Path(path).stem,
        version=lit(onto, OWL.versionInfo, "0") if onto else "0",
        source={
            "name": lit(onto, RDFS.label) if onto else "",
            "url": val(onto, DCTERMS.source) if onto else "",
            "license": val(onto, DCTERMS.license) if onto else "",
        },
        groups=groups,
        categories=categories,
        families=families,
        attributes=attributes,
        vocab_nodes=kg.vocabulary_nodes(view),
    )
