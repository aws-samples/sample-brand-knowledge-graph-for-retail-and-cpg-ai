# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""A photo's garments in the graph's vocabulary, read only (used by tab 5's method 1, until task 12
reworks it).

The photo goes through exactly what a photo goes through before ingestion (the classify steps of
tabs 1 and 2), and :func:`garments_of` turns each validated entity of a leaf class
(``kg.skip_reason``, as ingest) into a :class:`Garment` with the ids of the vocabulary nodes ingest
would link it to (``kg.graph_id``, ``kg.edge_type_of``): its Category, its Attribute values (with
their family), its component Categories. The same thing twice (a pair of boots) is one garment.
Nothing is written.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ontology_rag import kg
from ontology_rag.graph.store import Node
from ontology_rag.owl import local_name

MAX_GARMENTS = 12
MAX_VALUES = 24
_ID = re.compile(r"^(category|attribute):[A-Za-z0-9_.:()\-]{1,120}$")


@dataclass
class Garment:
    """One garment of the photo, in the graph's vocabulary. Not a node of the graph: the evidence
    tree draws it between the question and the catalog items it matches."""

    id: str  # garment:<n>
    name: str  # the vision model's label: "beige double-breasted trench coat"
    class_name: str  # the ontology class (local name): "Coat"
    category_id: str  # category:coat, the node ingest would link it to with IS_CATEGORY
    category: str  # the category's name
    values: list[dict] = field(
        default_factory=list
    )  # [{id, name, family}], linked by HAS_ATTRIBUTE
    parts: list[dict] = field(default_factory=list)  # [{id, name}], linked by HAS_PART
    entities: list[str] = field(default_factory=list)  # the classification's entity ids (e1, e2 …)
    confidence: float | None = None
    in_graph: bool | None = None  # the graph has the category node (set by decompose_photo)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "class": self.class_name,
            "category_id": self.category_id,
            "category": self.category,
            "values": self.values,
            "parts": self.parts,
            "entities": self.entities,
            "confidence": self.confidence,
            "in_graph": self.in_graph,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Garment:
        """A garment the browser sends back with its question (as ``decompose_photo`` returned
        it). The ids only ever look nodes up; they are checked for shape, not trusted further."""
        if not isinstance(d, dict):
            raise ValueError("each garment must be an object")  # noqa: TRY004 (a 400 for the caller)
        gid, cat = str(d.get("id") or ""), str(d.get("category_id") or "")
        if not re.match(r"^garment:\d{1,3}$", gid) or not _ID.match(cat):
            raise ValueError("a garment needs an id garment:<n> and a category_id category:<x>")

        def vocab(rows, keys: tuple[str, ...]) -> list[dict]:
            out = []
            for r in (rows if isinstance(rows, list) else [])[:MAX_VALUES]:
                if isinstance(r, dict) and _ID.match(str(r.get("id") or "")):
                    out.append({k: str(r.get(k) or "")[:120] for k in keys})
            return out

        return cls(
            id=gid,
            name=str(d.get("name") or d.get("category") or cat)[:200],
            class_name=str(d.get("class") or "")[:80],
            category_id=cat,
            category=str(d.get("category") or cat.split(":", 1)[1])[:120],
            values=vocab(d.get("values"), ("id", "name", "family")),
            parts=vocab(d.get("parts"), ("id", "name")),
            entities=[str(e)[:20] for e in (d.get("entities") or [])][:8],
            confidence=d["confidence"] if isinstance(d.get("confidence"), (int, float)) else None,
        )

    def node(self) -> Node:
        return Node(
            self.id,
            ["Garment"],
            {
                "name": self.name,
                "category": self.category,
                "values": ", ".join(v["name"] for v in self.values),
                "parts": ", ".join(p["name"] for p in self.parts),
                "count": max(1, len(self.entities)),
            },
        )

    def vocabulary(self) -> dict[str, str]:
        """The value and component node ids of the garment, with their names."""
        return {v["id"]: v["name"] for v in self.values} | {p["id"]: p["name"] for p in self.parts}

    def summary(self) -> str:
        bits = [self.category]
        if self.values:
            bits.append(", ".join(v["name"] for v in self.values))
        if self.parts:
            bits.append("parts: " + ", ".join(p["name"] for p in self.parts))
        twice = f" ×{len(self.entities)}" if len(self.entities) > 1 else ""
        return f"{self.name}{twice} ({'; '.join(bits)})"


def garments_of(view: dict, entities: list[dict]) -> tuple[list[Garment], list[str]]:
    """The validated entities of a classification as garments in the graph's vocabulary, and the
    ones left out (with the reason ingest gives: not in the ontology, a group not a leaf class)."""
    terms = {n["id"]: n for n in view["nodes"]}
    out: list[Garment] = []
    skipped: list[str] = []
    for ent in entities:
        reason = kg.skip_reason(ent, view)
        if reason:
            skipped.append(reason)
            continue
        values = []
        for prop, value in (ent.get("attribute_iris") or {}).items():
            if value not in terms:
                continue
            _, props = kg.edge_type_of(prop, terms)  # HAS_ATTRIBUTE {family}
            values.append(
                {
                    "id": kg.graph_id(value, terms),
                    "name": _name(terms[value]),
                    "family": props.get("family", ""),
                }
            )
        parts = []
        for p in ent.get("parts") or []:
            iri = p.get("class_iri")
            if iri in terms and not any(x["id"] == kg.graph_id(iri, terms) for x in parts):
                parts.append({"id": kg.graph_id(iri, terms), "name": _name(terms[iri])})
        category_id = kg.graph_id(ent["class_iri"], terms)
        name = str(ent.get("label") or ent["class"])
        twin = next((g for g in out if _same(g, category_id, name, values)), None)
        if twin:  # the same garment twice: the left and the right boot
            twin.entities.append(str(ent["id"]))
            twin.name = _SIDE.sub("", twin.name).strip() or twin.name  # "ankle boot", not "…, left"
            twin.values = _union(twin.values, values, ("family", "name"))
            twin.parts = _union(twin.parts, parts, ("name",))
            continue
        out.append(
            Garment(
                id="",
                name=str(ent.get("label") or ent["class"]),
                class_name=str(ent["class"]),
                category_id=category_id,
                category=_name(terms[ent["class_iri"]]),
                values=sorted(values, key=lambda v: (v["family"], v["name"])),
                parts=sorted(parts, key=lambda p: p["name"]),
                entities=[str(ent["id"])],
                confidence=ent.get("confidence"),
            )
        )
    garments = sorted(out, key=lambda g: -(g.confidence or 0))[:MAX_GARMENTS]
    for n, g in enumerate(garments, start=1):
        g.id = f"garment:{n}"
    return garments, skipped


_SIDE = re.compile(r"[\s,(]*\b(left|right)\b.*$", re.IGNORECASE)


def _same(g: Garment, category_id: str, name: str, values: list[dict]) -> bool:
    """A pair: the same category and the same values, or the same name but for left / right."""
    if g.category_id != category_id:
        return False
    same_values = {v["id"] for v in g.values} == {v["id"] for v in values}
    mine, theirs = (_SIDE.sub("", x).strip().lower() for x in (g.name, name))
    return same_values or (bool(mine) and mine == theirs)


def _union(a: list[dict], b: list[dict], keys: tuple[str, ...]) -> list[dict]:
    have = {x["id"] for x in a}
    return sorted(
        [*a, *(x for x in b if x["id"] not in have)], key=lambda x: tuple(x[k] for k in keys)
    )


def _name(term: dict) -> str:
    return term.get("pref_label") or term.get("label") or local_name(term["id"])
