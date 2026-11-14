# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Domain records that become graph nodes and edges.

The graph model (see ``docs/graph-model.md``)::

    (:Brand)<-[:OF_BRAND]-(:Line)<-[:FROM_LINE]-(:Item)-[:IS_CATEGORY]->(:Category)-[:IN_GROUP]->(:Group)
    (:Item)-[:HAS_ATTRIBUTE]->(:Attribute)-[:IN_FAMILY]->(:AttributeFamily)-[:APPLIES_TO]->(:Group)
    (:Item)-[:HAS_PART {label}]->(:Category)                      # components of an ingested item
    (:Item)-[:LAYERED_WITH {rule, source}]->(:Item)              # item-level pairing (curatorial)
    (:Category)-[:PAIRS_WITH {occasion, rationale, source}]->(:Category)  # category-level brand rule
    (:Look)-[:CONTAINS]->(:Item)
    (:Look)-[:FOR]->(:Occasion)               # the occasions are the ontology's (fo:for), loader.py
    (:Article)-[:HAS_STATEMENT]->(:Statement)-[:ILLUSTRATES]->(:Look|:Item)

``Item``, ``Look`` and ``Statement`` nodes carry an ``embedding`` in the graph's single
vector index; everything else is pure structure.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Brand:
    id: str
    name: str
    description: str = ""


@dataclass
class Line:
    id: str
    name: str
    brand_id: str
    description: str = ""
    season: str = ""


@dataclass
class Item:
    id: str
    name: str
    category_id: str
    line_id: str
    description: str = ""
    color: str = ""
    material: str = ""
    attributes: dict[str, str] = field(default_factory=dict)  # family_id -> attribute_id
    image_key: str = ""  # optional path/URI of a product image (bring-your-own data)
    # Extra node properties, e.g. provenance written by the ingest pipeline (run, model, confidence).
    props: dict[str, str | int | float] = field(default_factory=dict)

    def embedding_text(self, category_name: str = "", line_name: str = "") -> str:
        attrs = ", ".join(a.split(":", 1)[-1].replace("-", " ") for a in self.attributes.values())
        parts = [
            self.name,
            f"{category_name or self.category_id} from the {line_name or self.line_id} line",
            " ".join(p for p in (self.color, self.material) if p),
            self.description,
            f"attributes: {attrs}" if attrs else "",
        ]
        return ". ".join(p.strip() for p in parts if p and p.strip())


@dataclass
class Look:
    id: str
    name: str
    occasion: str  # the data's words; Loader.link_vocabulary links the occasion it names
    description: str
    item_ids: list[str]
    props: dict[str, str | int | float] = field(default_factory=dict)  # extra node properties

    def embedding_text(self, item_names: list[str] | None = None) -> str:
        items = ", ".join(item_names or self.item_ids)
        return f"{self.name}: {self.description}. Occasion: {self.occasion}. Items: {items}."


@dataclass
class Statement:
    id: str
    text: str
    illustrates: list[str] = field(default_factory=list)  # Look or Item ids


@dataclass
class Article:
    id: str
    title: str
    source: str
    published: str
    statements: list[Statement]


@dataclass
class PairingRule:
    """Curatorial knowledge as an edge.

    ``level="category"`` creates ``(:Category)-[:PAIRS_WITH]->(:Category)``;
    ``level="item"`` creates ``(:Item)-[:LAYERED_WITH]->(:Item)``.
    """

    source_id: str
    target_id: str
    level: str  # "category" | "item"
    rationale: str = ""
    occasion: str = ""
    source: str = "brand-stylist"


def to_dict(obj) -> dict:
    return asdict(obj)
