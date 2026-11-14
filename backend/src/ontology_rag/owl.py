# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Generic OWL / RDF handling with rdflib.

Three jobs, the same for every format the sample reads (Turtle, RDF/XML, N-Triples, N3, JSON-LD):

* :func:`parse_rdf`: bytes/text -> ``rdflib.Graph`` (format sniffed from the file name or content;
  nothing is fetched while parsing).
* :func:`ontology_view`: the ontology as a plain graph for the browser: class hierarchy,
  object/data properties (domains and ranges flattened through ``owl:unionOf``), named
  individuals. This is what the explorer draws and highlights.
* :func:`classification_prompt`: the ontology rendered as a *controlled vocabulary* a vision
  model must answer with. The rule that makes this work for any ontology: a class that has
  named individuals is a **value class** (its individuals are the allowed values of the
  properties whose range it is); every other class is an **entity class** that can be located
  in an image. Classes annotated ``visual = false`` are schema-only and never offered. A property
  of the photo as a whole (``fo:for``: the occasion of a look) is listed in a section of its own
  (:class:`Vocabulary`).
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from rdflib import DCTERMS, OWL, RDF, RDFS, SKOS, BNode, Graph, Literal, URIRef
from rdflib.namespace import split_uri
from rdflib.util import guess_format

# Annotation used by the sample's ontologies to keep schema-only classes out of vision prompts.
VISUAL_FLAG = URIRef("http://example.org/multimodal-ai-knowledge-graph/fashion#visual")
CONCEPT_ID = URIRef("http://example.org/multimodal-ai-knowledge-graph/fashion#conceptId")

# An ontology the browser uploads (tab 1, per request) and one read from a domain folder (the
# deployer's; fashion.ttl is 0.1 MB). Two numbers because the upload is the untrusted one.
MAX_UPLOAD_BYTES = 1 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024

# The rdflib parsers an upload may name. The others (TriG, N-Quads, TriX, HexTuples) are dataset
# formats this sample never reads, so the parser plugins behind them are never reached.
FORMATS = ("turtle", "xml", "nt", "n3", "json-ld")
_DOCTYPE = re.compile(rb"<!DOCTYPE", re.IGNORECASE)


# ---------------------------------------------------------------------- parsing
def parse_rdf(
    data: bytes | str,
    filename: str | None = None,
    fmt: str | None = None,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> Graph:
    """Parse an ontology document. Raises ``ValueError`` on empty, oversized, unparseable input,
    and on the two document shapes that would make rdflib reach out of the process: a JSON-LD
    ``@context`` given as a URL (rdflib fetches it: a request to any host the uploader names) and
    an RDF/XML DOCTYPE (entity expansion keeps the parser busy for seconds before expat gives
    up). The ontologies the sample ships carry their context inline and declare no DOCTYPE."""
    raw = data.encode("utf-8") if isinstance(data, str) else data
    if not raw or not raw.strip():
        raise ValueError("ontology document is empty")
    if len(raw) > max_bytes:
        raise ValueError(f"ontology document larger than {max_bytes // 1024 // 1024} MB")
    fmt = fmt or (guess_format(filename) if filename else None) or _sniff_format(raw)
    if fmt not in FORMATS:
        raise ValueError(f"unsupported ontology format {fmt!r}")
    if fmt == "json-ld" and _fetches_context(raw):
        raise ValueError("JSON-LD uploads must carry their @context inline, not as a URL")
    if fmt == "xml" and (_DOCTYPE.search(raw) or b"\x00" in raw):
        # A NUL byte means UTF-16 (every UTF-16 "<" has one, UTF-8 text never does), where the
        # DOCTYPE check above would not see "<!DOCTYPE" but expat would still expand entities
        raise ValueError("RDF/XML uploads must be UTF-8 and must not declare a DOCTYPE")
    g = Graph()
    try:
        g.parse(data=raw, format=fmt)
    except Exception as exc:  # rdflib raises many exception types (SAX, BadSyntax, ...)
        # The parser's message, on one line and short: it is shown in the browser as it is.
        detail = " ".join(str(exc).split())[:120]
        raise ValueError(
            f"could not parse ontology as {fmt}: {type(exc).__name__}: {detail}"
        ) from exc
    if len(g) == 0:
        raise ValueError("ontology document contains no triples")
    return g


def load_graph(path: str | Path) -> Graph:
    p = Path(path)
    return parse_rdf(p.read_bytes(), filename=p.name, max_bytes=MAX_FILE_BYTES)


def _fetches_context(raw: bytes) -> bool:
    """True when any ``@context`` in the document (top level, nested or scoped to a term) is a
    string or a list with a string in it, or when a context dict carries ``@import``: the two
    forms rdflib resolves over HTTP. A document that is not JSON is left to the parser's error."""
    try:
        doc = json.loads(raw)
    except ValueError:
        return False
    stack = [doc]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            ctx = node.get("@context")
            contexts = ctx if isinstance(ctx, list) else [ctx]
            if any(isinstance(c, str) for c in contexts) or "@import" in node:
                return True
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return False


def _sniff_format(raw: bytes) -> str:
    head = raw.lstrip()[:400].decode("utf-8", errors="ignore")
    if head.startswith("<?xml") or "<rdf:RDF" in head or "<owl:Ontology" in head:
        return "xml"
    if head.startswith(("{", "[")):
        return "json-ld"
    if re.search(r"^\s*(@prefix|PREFIX|@base|BASE)\b", head, flags=re.MULTILINE):
        return "turtle"
    if re.match(r"^<[^>]+>\s+<[^>]+>\s+", head):
        return "nt"
    return "turtle"


# ---------------------------------------------------------------------- view model
@dataclass
class OntologyView:
    id: str
    name: str
    iri: str
    version: str
    license: str
    source: str
    comment: str
    prefixes: dict[str, str]
    nodes: list[dict]
    edges: list[dict]
    stats: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "iri": self.iri,
            "version": self.version,
            "license": self.license,
            "source": self.source,
            "comment": self.comment,
            "prefixes": self.prefixes,
            "nodes": self.nodes,
            "edges": self.edges,
            "stats": self.stats,
        }


def _label(g: Graph, node: URIRef) -> str:
    """Display label: ``rdfs:label`` first, then ``skos:prefLabel``, else the short name."""
    for pred in (RDFS.label, SKOS.prefLabel):
        for lit in g.objects(node, pred):
            if isinstance(lit, Literal):
                return str(lit)
    return short_name(g, node)


def _pref_label(g: Graph, node: URIRef) -> str:
    """Full preferred label (may carry a disambiguating qualifier such as ``polo (collar)``)."""
    for lit in g.objects(node, SKOS.prefLabel):
        if isinstance(lit, Literal):
            return str(lit)
    return ""


def short_name(g: Graph, node: URIRef) -> str:
    """``fo:Coat`` style name using the graph's prefixes, else the IRI local part."""
    try:
        return g.namespace_manager.normalizeUri(node)
    except Exception:  # noqa: BLE001
        try:
            return split_uri(node)[1]
        except ValueError:
            return str(node)


def local_name(node: URIRef) -> str:
    s = str(node)
    return re.split(r"[#/]", s)[-1] or s


def _flatten(g: Graph, node) -> list[URIRef]:
    """Expand an ``owl:unionOf`` (or plain class) into its named members."""
    if node is None:
        return []
    if isinstance(node, URIRef):
        return [node]
    if isinstance(node, BNode):
        for lst in g.objects(node, OWL.unionOf):
            out: list[URIRef] = []
            for member in g.items(lst):
                out.extend(_flatten(g, member))
            return out
        for lst in g.objects(node, OWL.intersectionOf):
            out = []
            for member in g.items(lst):
                out.extend(_flatten(g, member))
            return out
    return []


def _literal(g: Graph, subject, pred) -> str:
    for v in g.objects(subject, pred):
        return str(v)
    return ""


def ontology_view(g: Graph, view_id: str) -> OntologyView:
    """Plain-graph rendering of the ontology (classes, properties, individuals, edges)."""
    classes, individuals = _classes_and_individuals(g)
    obj_props = {p for p in g.subjects(RDF.type, OWL.ObjectProperty) if isinstance(p, URIRef)}
    data_props = {p for p in g.subjects(RDF.type, OWL.DatatypeProperty) if isinstance(p, URIRef)}
    parents: dict[URIRef, list[URIRef]] = {
        c: [p for p in g.objects(c, RDFS.subClassOf) if isinstance(p, URIRef) and p in classes]
        for c in classes
    }
    nodes, edges = _class_nodes(g, classes, parents, individuals)
    for builder, members in (
        (_individual_nodes, individuals),
        (_property_nodes, obj_props | data_props),
    ):
        more_nodes, more_edges = builder(g, members, classes, parents)
        nodes += more_nodes
        edges += more_edges
    onto = next(iter(g.subjects(RDF.type, OWL.Ontology)), None)
    stats = {
        "triples": len(g),
        "classes": len(classes),
        "individuals": len(individuals),
        "object_properties": len(obj_props),
        "data_properties": len(data_props),
        "roots": sorted(local_name(c) for c in classes if not parents.get(c)),
        "max_depth": max((depth_of(c, parents) for c in classes), default=0),
    }
    return OntologyView(
        id=view_id,
        name=_literal(g, onto, RDFS.label) if onto else view_id,
        iri=str(onto) if onto else "",
        version=_literal(g, onto, OWL.versionInfo) if onto else "",
        license=_literal(g, onto, DCTERMS.license) if onto else "",
        source=_literal(g, onto, DCTERMS.source) if onto else "",
        comment=_literal(g, onto, RDFS.comment) if onto else "",
        prefixes={p: str(ns) for p, ns in g.namespaces() if p},
        nodes=nodes,
        edges=edges,
        stats=stats,
    )


def _classes_and_individuals(g: Graph) -> tuple[set[URIRef], set[URIRef]]:
    """The named classes (declared, or referenced only implicitly as a superclass or as the type
    of an individual) and the named individuals."""
    classes = {c for c in g.subjects(RDF.type, OWL.Class) if isinstance(c, URIRef)}
    for s, _, o in g.triples((None, RDFS.subClassOf, None)):
        if isinstance(s, URIRef):
            classes.add(s)
        if isinstance(o, URIRef):
            classes.add(o)
    individuals = {i for i in g.subjects(RDF.type, OWL.NamedIndividual) if isinstance(i, URIRef)}
    for i in individuals:
        for t in g.objects(i, RDF.type):
            if isinstance(t, URIRef) and t != OWL.NamedIndividual and t not in (OWL.Class,):
                classes.add(t)
    classes -= {OWL.Thing, OWL.Nothing, OWL.Class, OWL.NamedIndividual}
    return classes, individuals


def root_of(c: URIRef, parents: dict, seen=None) -> URIRef:
    """The top of a class's first superclass chain (itself when it has none)."""
    seen = seen or set()
    if c in seen or not parents.get(c):
        return c
    seen.add(c)
    return root_of(parents[c][0], parents, seen)


def depth_of(c: URIRef, parents: dict, seen=None) -> int:
    seen = seen or set()
    if c in seen or not parents.get(c):
        return 0
    seen.add(c)
    return 1 + depth_of(parents[c][0], parents, seen)


def _visual(g: Graph, node) -> bool:
    """``fo:visual false`` marks a schema-only term the vision model is never offered."""
    return _literal(g, node, VISUAL_FLAG).lower() not in ("false", "0")


def _term(g: Graph, node: URIRef, kind: str) -> dict:
    """What every node of the view carries: ids, labels, synonyms and the concept id; hidden
    labels (``skos:hiddenLabel``, words to match data texts with, never shown) and a definition."""
    return {
        "id": str(node),
        "key": short_name(g, node),
        "label": _label(g, node),
        "pref_label": _pref_label(g, node),
        "kind": kind,
        "comment": _literal(g, node, RDFS.comment),
        "concept_id": _literal(g, node, CONCEPT_ID),
        "alt_labels": [str(a) for a in g.objects(node, SKOS.altLabel)],
        "hidden_labels": sorted(str(h) for h in g.objects(node, SKOS.hiddenLabel)),
        "definition": _literal(g, node, SKOS.definition),
    }


def _class_nodes(g: Graph, classes: set, parents: dict, individuals: set) -> tuple[list, list]:
    """One node per class with its root and depth in the hierarchy, one ``subClassOf`` edge per
    named superclass."""
    count = Counter(t for i in individuals for t in g.objects(i, RDF.type) if t in classes)
    nodes, edges = [], []
    for c in sorted(classes, key=str):
        nodes.append(
            {
                **_term(g, c, "class"),
                "root": local_name(root_of(c, parents)),
                "depth": depth_of(c, parents),
                "visual": _visual(g, c),
                "individuals": count[c],
            }
        )
        for p in parents.get(c, []):
            edges.append(
                {"source": str(c), "target": str(p), "type": "subClassOf", "label": "subClassOf"}
            )
    return nodes, edges


def _individual_nodes(g: Graph, individuals: set, classes: set, parents: dict) -> tuple[list, list]:
    """One node per named individual, placed under its first type, one ``type`` edge per type."""
    nodes, edges = [], []
    for i in sorted(individuals, key=str):
        types = [t for t in g.objects(i, RDF.type) if t in classes]
        nodes.append(
            {
                **_term(g, i, "individual"),
                "root": local_name(root_of(types[0], parents)) if types else "",
                "depth": (depth_of(types[0], parents) + 1) if types else 0,
                "visual": True,
                "types": [str(t) for t in types],
            }
        )
        for t in types:
            edges.append({"source": str(i), "target": str(t), "type": "type", "label": "a"})
    return nodes, edges


def _property_nodes(g: Graph, props: set, classes: set, parents: dict) -> tuple[list, list]:
    """One node per object or data property with its domains and ranges (``owl:unionOf``
    flattened); an object property draws one edge from every domain to every range."""
    nodes, edges = [], []
    for p in sorted(props, key=str):
        kind = "objectProperty" if (p, RDF.type, OWL.ObjectProperty) in g else "dataProperty"
        domains = [str(d) for d in _flatten_all(g, p, RDFS.domain)]
        ranges = [str(r) for r in _flatten_all(g, p, RDFS.range)]
        supers = [str(s) for s in g.objects(p, RDFS.subPropertyOf) if isinstance(s, URIRef)]
        nodes.append(
            {
                "id": str(p),
                "key": short_name(g, p),
                "label": _label(g, p),
                "kind": kind,
                "comment": _literal(g, p, RDFS.comment),
                "domain": domains,
                "range": ranges,
                "super": supers,
                "symmetric": (p, RDF.type, OWL.SymmetricProperty) in g,
                "visual": _visual(g, p),
            }
        )
        if kind == "objectProperty":
            for d in domains:
                for r in ranges:
                    edges.append(
                        {
                            "source": d,
                            "target": r,
                            "type": "property",
                            "label": short_name(g, p),
                            "property": str(p),
                        }
                    )
        for s in supers:
            edges.append(
                {"source": str(p), "target": s, "type": "subPropertyOf", "label": "subPropertyOf"}
            )
    return nodes, edges


def _flatten_all(g: Graph, subject, pred) -> list[URIRef]:
    out: list[URIRef] = []
    for o in g.objects(subject, pred):
        out.extend(_flatten(g, o))
    return out


# ---------------------------------------------------------------------- vocabulary for vision prompts
@dataclass
class Vocabulary:
    """What a vision model may answer with, derived from the ontology view.

    With the ontology's image class (the class a whole photo becomes, ``Look``), a **photo
    property** is an object property, not abstract and not ``visual = false``, whose every domain
    is that class and whose every range is a value class (``fo:for`` → ``fo:Occasion``). The model
    answers it for the photo as a whole. Its ranges are **vocabulary classes** and their
    individuals **vocabulary values**: the deploy writes them as graph nodes of their own
    (``kg.vocabulary_nodes``). A photo property is not an attribute property."""

    entity_classes: dict[str, dict]  # key -> node (classes that can appear in an image)
    value_classes: dict[str, dict]  # key -> node (classes whose individuals are attribute values)
    attribute_props: list[dict]  # object properties with a value-class range
    relation_props: list[dict]  # object properties between entity classes
    values: dict[str, list[dict]]  # value class id -> individuals
    by_key: dict[str, dict]  # lower-cased key/label/alt/concept_id -> node (for validation)
    children: dict[str, list[str]] = field(default_factory=dict)  # class id -> direct subclasses
    parents: dict[str, list[str]] = field(default_factory=dict)  # class id -> direct superclasses
    photo_props: list[dict] = field(default_factory=list)  # the image class's own properties
    vocab_classes: dict[str, dict] = field(default_factory=dict)  # the photo properties' ranges

    def is_a(self, class_id: str, ancestor_id: str) -> bool:
        """True when ``class_id`` equals or is a (transitive) subclass of ``ancestor_id``."""
        seen, todo = set(), [class_id]
        while todo:
            cid = todo.pop()
            if cid == ancestor_id:
                return True
            if cid in seen:
                continue
            seen.add(cid)
            todo += self.parents.get(cid, [])
        return False

    def values_under(self, class_id: str) -> list[dict]:
        """Individuals of a value class and of all its descendants."""
        out, seen, todo = [], set(), [class_id]
        while todo:
            cid = todo.pop()
            if cid in seen:
                continue
            seen.add(cid)
            out += self.values.get(cid, [])
            todo += self.children.get(cid, [])
        return out


def vocabulary(view: OntologyView | dict, image_class: str | None = None) -> Vocabulary:
    """The vocabulary of the view. ``image_class`` is the local name of the class a whole photo
    becomes (callers that know ``kg.KG_SCHEMA`` pass its image class, ``Look``); without it there
    are no photo properties (see :class:`Vocabulary`)."""
    d = view.to_dict() if isinstance(view, OntologyView) else view
    classes = [n for n in d["nodes"] if n["kind"] == "class"]
    individuals = [n for n in d["nodes"] if n["kind"] == "individual"]
    values: dict[str, list[dict]] = defaultdict(list)
    for i in individuals:
        for t in i.get("types", []):
            values[t].append(i)
    # A class is a value class when it or its descendants carry individuals.
    children: dict[str, list[str]] = defaultdict(list)
    parents: dict[str, list[str]] = defaultdict(list)
    for e in d["edges"]:
        if e["type"] == "subClassOf":
            children[e["target"]].append(e["source"])
            parents[e["source"]].append(e["target"])

    def has_values(cid: str, seen=None) -> bool:
        seen = seen or set()
        if cid in seen:
            return False
        seen.add(cid)
        return bool(values.get(cid)) or any(has_values(c, seen) for c in children.get(cid, []))

    value_classes = {n["id"]: n for n in classes if has_values(n["id"])}
    entity_classes = {
        n["id"]: n for n in classes if n["id"] not in value_classes and n.get("visual", True)
    }
    # Properties that other properties specialise (e.g. a generic hasAttribute) are abstract.
    abstract = {s for p in d["nodes"] if p["kind"] == "objectProperty" for s in p.get("super", [])}
    attribute_props, relation_props, photo_props = [], [], []
    for p in d["nodes"]:
        if p["kind"] != "objectProperty" or p["id"] in abstract or not p.get("visual", True):
            continue
        dom, rng = p.get("domain", []), p.get("range", [])
        if rng and all(r in value_classes for r in rng):
            if image_class and dom and all(local_name(URIRef(x)) == image_class for x in dom):
                photo_props.append(p)  # of the photo as a whole: fo:for → fo:Occasion
            elif not dom or any(x in entity_classes for x in dom):  # a value of a visible thing
                attribute_props.append(p)
        elif (
            rng and any(r in entity_classes for r in rng) and all(x in entity_classes for x in dom)
        ):
            relation_props.append(p)
    vocab_classes = {r: value_classes[r] for p in photo_props for r in p["range"]}
    by_key: dict[str, dict] = {}
    for n in d["nodes"]:
        for k in [
            n.get("key"),
            n.get("label"),
            n.get("concept_id"),
            local_name(URIRef(n["id"])),
            n["id"],
        ]:
            if k:
                by_key.setdefault(str(k).lower(), n)
        for a in n.get("alt_labels", []):
            by_key.setdefault(a.lower(), n)
    return Vocabulary(
        entity_classes,
        value_classes,
        attribute_props,
        relation_props,
        dict(values),
        by_key,
        dict(children),
        dict(parents),
        photo_props,
        vocab_classes,
    )


def classification_prompt(view: OntologyView | dict, image_class: str | None = None) -> str:
    """Render the vocabulary as the system prompt for image classification.

    The output is deterministic for a given ontology, which is what makes prompt caching work:
    the whole ontology block is the cached prefix and only the image changes per request.
    ``image_class`` (see :func:`vocabulary`) adds the section of the photo properties, the
    values the model answers for the photo as a whole (the occasion of a look).
    """
    d = view.to_dict() if isinstance(view, OntologyView) else view
    voc = vocabulary(d, image_class)
    parent_of: dict[str, str] = {}
    for e in d["edges"]:
        if e["type"] == "subClassOf":
            parent_of.setdefault(e["source"], e["target"])

    lines = [
        (
            f"You classify what is visible in a photo using ONLY the vocabulary of the ontology "
            f'"{d.get("name") or d.get("id")}". Never invent classes, properties or values that are '
            "not listed below; if something has no fitting class, leave it out."
        ),
        "",
        "## Entity classes (things you can locate in the image)",
        "Format: ClassName: label [also: synonyms]. Indented classes are subclasses of the class above.",
    ]

    # Group entity classes by their top-level root, then by parent.
    def emit(n: dict, indent: int, members: list[dict]) -> None:
        alts = f" [also: {', '.join(n['alt_labels'])}]" if n.get("alt_labels") else ""
        name = local_name(URIRef(n["id"]))
        label = n["label"] if n["label"].lower() != name.lower() else ""
        lines.append(f"{'  ' * indent}- {name}{': ' + label if label else ''}{alts}")
        kids = sorted(
            (m for m in members if parent_of.get(m["id"]) == n["id"]), key=lambda m: m["key"]
        )
        for k in kids:
            emit(k, indent + 1, members)

    for root in sorted({n["root"] for n in voc.entity_classes.values()}):
        members = [n for n in voc.entity_classes.values() if n["root"] == root]
        tops = sorted(
            (n for n in members if parent_of.get(n["id"]) not in voc.entity_classes),
            key=lambda n: n["key"],
        )
        for t in tops:
            emit(t, 0, members)

    if voc.relation_props:
        lines += ["", "## Relations between entities (name: domain -> range)"]
        for p in sorted(voc.relation_props, key=lambda p: p["key"]):
            dom = ", ".join(local_name(URIRef(x)) for x in p.get("domain", [])) or "any"
            rng = ", ".join(local_name(URIRef(x)) for x in p.get("range", [])) or "any"
            lines.append(f"- {local_name(URIRef(p['id']))}: {dom} -> {rng}")

    if voc.attribute_props:
        lines += ["", "## Attribute properties (name (applies to ...): allowed values)"]
        for p in sorted(voc.attribute_props, key=lambda p: p["key"]):
            dom = ", ".join(local_name(URIRef(x)) for x in p.get("domain", [])) or "any entity"
            vals: list[str] = []
            for r in p.get("range", []):
                vals += [
                    v.get("pref_label") or v.get("label") or local_name(URIRef(v["id"]))
                    for v in voc.values_under(r)
                ]
            lines.append(f"- {local_name(URIRef(p['id']))} (applies to {dom}): {', '.join(vals)}")

    if voc.photo_props:  # an ontology without them (the aisles) keeps the prompt it had
        whole = (
            "For a photo of an outfit, choose at most one value per property for the outfit as a "
            "whole, or leave the property out when no value fits. For a text, leave "
            '"photo_properties" out.'
        )
        lines += ["", "## The whole photo (name: allowed values)", whole]
        for p in sorted(voc.photo_props, key=lambda p: p["key"]):
            vals = []
            for r in p.get("range", []):
                for v in voc.values_under(r):
                    name = v.get("pref_label") or v.get("label") or local_name(URIRef(v["id"]))
                    vals.append(f"{name} ({v['definition']})" if v.get("definition") else name)
            lines.append(f"- {local_name(URIRef(p['id']))}: {'; '.join(vals)}")

    # The model as ontology reviewer: whatever it saw but could not express is worth more to the
    # ontology's owner than a bent answer, so the prompt asks for it, structured, next to the entities.
    feedback = (
        "This ontology is a work in progress and you are also its reviewer. Once you have classified "
        "the material (the photo or the text), look back at everything you saw in it that the "
        "ontology kept you from expressing: an item with no fitting class, a class too coarse to tell "
        "two things apart, a value missing from an attribute's allowed list, an attribute, component, "
        "material or relation the ontology does not have. Do not bend the vocabulary to fit: leave it "
        'out of the entities and propose an improvement to the ontology in "ontology_feedback" '
        "instead. For each improvement say what you observed, which entity it concerns (or null), and "
        "exactly how you would extend the ontology: a new class and its parent class, a new value and "
        "the property it belongs to, or a new property or relation with its domain and range. Be "
        "specific and brief; at most 8 items, the most useful first."
    )
    photo_shape = '"photo_properties": {"<property>": "<allowed value>"}, '
    shape = (
        '{"entities": [{"id": "e1", "class": "<EntityClass>", "label": "<short description>", '
        '"bbox": [x_min, y_min, x_max, y_max], "confidence": 0.0-1.0, '
        '"attributes": {"<attributeProperty>": "<allowed value>"}, '
        '"parts": [{"class": "<EntityClass>", "label": "<short>", "bbox": [x_min, y_min, x_max, y_max], '
        '"relation": "<relation property>"}]}], '
        + (photo_shape if voc.photo_props else "")
        + '"ontology_feedback": [{"observed": "<what is visible but cannot be expressed>", '
        '"entity": "<entity id or null>", "kind": "class|value|property|relation", '
        '"suggestion": "<how to extend the ontology, e.g. add value X to property P, add class C under D>"}], '
        '"notes": "<anything else you could not map to the ontology>"}'
    )
    rules = (
        "Coordinates are integers on a 0-1000 scale of the image width (x) and height (y), origin "
        "top-left. One entity per distinct visible object; put components (collars, pockets, zippers, "
        '...) in "parts" of the entity they belong to, each distinct component exactly once. Always '
        "use the most specific class in the hierarchy (a leaf, never its parent when a leaf fits). "
        "Only use attribute properties that apply to the entity's class and only values from the "
        "allowed list."
    )
    lines += [
        "",
        "## Ontology feedback",
        feedback,
        "",
        "## Output",
        "Return ONLY a JSON object, no prose, with this shape:",
        shape,
        rules,
    ]
    return "\n".join(lines)


def content_hash(data: bytes | str) -> str:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return hashlib.sha256(raw).hexdigest()[:16]


def estimate_tokens(text: str) -> int:
    """Rough token estimate for ontology text (~3 characters per token; measured 2.2-3.5 across
    Claude, GPT and Nova tokenizers on the fashion vocabulary). Only used to flag whether a
    model's prompt-cache minimum is likely met; the metrics table shows the real usage."""
    return max(1, len(text) // 3)
