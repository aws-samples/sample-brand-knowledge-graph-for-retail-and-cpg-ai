# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Load the ontology and a catalog into the graph, then attach embeddings.

Everything is ``MERGE``-based, so loading is idempotent: re-running updates properties and
adds what is missing. Embeddings are written last, in their own statements, because vector
writes on Neptune Analytics are durable-on-write and not atomic.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path

from ontology_rag.embeddings import INDEX, Embedder
from ontology_rag.graph.store import GraphStore
from ontology_rag.models import Article, Item, Look, PairingRule, Statement
from ontology_rag.ontology import Ontology, resolve_value

log = logging.getLogger(__name__)


class Loader:
    def __init__(self, store: GraphStore, ontology: Ontology, embedder: Embedder):
        self.store = store
        self.ontology = ontology
        self.embedder = embedder

    # ------------------------------------------------------------------ ontology
    def load_ontology(self) -> dict[str, int]:
        o = self.ontology
        self.store.merge_nodes(
            "Group",
            [
                {"id": f"group:{g.id}", "props": {"name": g.name, "label": g.label, "kind": g.kind}}
                for g in o.groups.values()
            ],
        )
        self.store.merge_nodes(
            "Category",
            [
                {
                    "id": f"category:{c.id}",
                    "props": {
                        "name": c.name,
                        "short": c.id,
                        "taxonomy_id": c.taxonomy_id,
                        "kind": c.kind,
                    },
                }
                for c in o.categories.values()
            ],
        )
        self.store.merge_edges(
            "IN_GROUP",
            [
                {"source": f"category:{c.id}", "target": f"group:{c.group}"}
                for c in o.categories.values()
            ],
        )
        self.store.merge_nodes(
            "AttributeFamily",
            [{"id": f"family:{f.id}", "props": {"name": f.name}} for f in o.families.values()],
        )
        self.store.merge_edges(
            "APPLIES_TO",
            [
                {"source": f"family:{f.id}", "target": f"group:{g}"}
                for f in o.families.values()
                for g in f.applies_to
                if g in o.groups
            ],
        )
        self.store.merge_nodes(
            "Attribute",
            [
                {"id": f"attribute:{a.id}", "props": {"name": a.name, "taxonomy_id": a.taxonomy_id}}
                for a in o.attributes.values()
            ],
        )
        self.store.merge_edges(
            "IN_FAMILY",
            [
                {"source": f"attribute:{a.id}", "target": f"family:{a.family}"}
                for a in o.attributes.values()
            ],
        )
        # The vocabulary values (the occasions): every one is in the graph after a deploy, so a
        # look of any data set, or of tab 2, links to the same node.
        vocab: dict[str, dict[str, dict]] = defaultdict(dict)
        for v in o.vocab_nodes:
            vocab[v["label"]][v["id"]] = {"id": v["id"], "props": {"name": v["name"]}}
        for label, rows in vocab.items():
            self.store.merge_nodes(label, list(rows.values()))
        return {
            "Group": len(o.groups),
            "Category": len(o.categories),
            "AttributeFamily": len(o.families),
            "Attribute": len(o.attributes),
            **{label: len(rows) for label, rows in vocab.items()},
        }

    # ------------------------------------------------------------------ catalog
    def load_catalog(self, catalog: dict, with_embeddings: bool = True) -> dict:
        brand = catalog["brand"]
        self.store.merge_nodes(
            "Brand",
            [
                {
                    "id": brand["id"],
                    "props": {"name": brand["name"], "description": brand["description"]},
                }
            ],
        )
        lines = catalog["lines"]
        self.store.merge_nodes(
            "Line",
            [
                {
                    "id": l["id"],
                    "props": {
                        "name": l["name"],
                        "description": l["description"],
                        "season": l["season"],
                    },
                }
                for l in lines
            ],
        )
        self.store.merge_edges(
            "OF_BRAND", [{"source": l["id"], "target": l["brand_id"]} for l in lines]
        )

        items = [Item(**i) for i in catalog["items"]]
        self.upsert_items(items, with_embeddings=with_embeddings)

        looks = [Look(**l) for l in catalog["looks"]]
        unresolved = self.upsert_looks(looks, with_embeddings=with_embeddings)

        for r in catalog.get("pairing_rules", []):
            self.add_rule(PairingRule(**r))

        for a in catalog.get("articles", []):
            statements = [Statement(**s) for s in a["statements"]]
            self.upsert_article(
                Article(a["id"], a["title"], a["source"], a["published"], statements),
                with_embeddings=with_embeddings,
            )

        return {
            "Item": len(items),
            "Look": len(looks),
            "PairingRule": len(catalog.get("pairing_rules", [])),
            "Article": len(catalog.get("articles", [])),
            "Statement": sum(len(a["statements"]) for a in catalog.get("articles", [])),
            "unresolved": unresolved,  # looks whose occasion text names no value of the ontology
        }

    def load_catalog_dir(self, path: str | Path, with_embeddings: bool = True) -> dict:
        p = Path(path)
        catalog = {
            key: json.loads((p / f"{key}.json").read_text())
            for key in ("brand", "lines", "items", "looks", "pairing_rules", "articles")
            if (p / f"{key}.json").exists()
        }
        return self.load_catalog(catalog, with_embeddings=with_embeddings)

    # ------------------------------------------------------------------ pieces
    def upsert_items(
        self,
        items: list[Item],
        with_embeddings: bool = True,
        image_bytes: dict[str, tuple[bytes, str]] | None = None,
    ) -> None:
        self.store.merge_nodes(
            "Item",
            [
                {
                    "id": i.id,
                    "props": {
                        "name": i.name,
                        "description": i.description,
                        "color": i.color,
                        "material": i.material,
                        "image_key": i.image_key,
                        "category": i.category_id,
                        "line": i.line_id,
                        **i.props,
                    },
                }
                for i in items
            ],
        )
        self.store.merge_edges(
            "IS_CATEGORY", [{"source": i.id, "target": f"category:{i.category_id}"} for i in items]
        )
        self.store.merge_edges(
            "FROM_LINE", [{"source": i.id, "target": i.line_id} for i in items if i.line_id]
        )
        self.store.merge_edges(
            "HAS_ATTRIBUTE",
            [
                {"source": i.id, "target": f"attribute:{aid}", "props": {"family": fam}}
                for i in items
                for fam, aid in i.attributes.items()
            ],
        )
        if with_embeddings:
            rows = []
            for i in items:
                if image_bytes and i.id in image_bytes:
                    data, fmt = image_bytes[i.id]
                    vec = self.embedder.embed_image(data, fmt, INDEX)
                else:
                    cat = self.ontology.categories.get(i.category_id)
                    vec = self.embedder.embed_text(
                        i.embedding_text(cat.name if cat else "", i.line_id.split(":")[-1]), INDEX
                    )
                rows.append({"id": i.id, "embedding": vec})
            self.store.upsert_embeddings(rows)

    def upsert_looks(
        self,
        looks: list[Look],
        with_embeddings: bool = True,
        image_bytes: dict[str, tuple[bytes, str]] | None = None,
    ) -> list[dict]:
        """Looks are outfits; when a look comes from a photo, ``image_bytes[look.id]`` makes the
        photo itself the look's vector (Nova multimodal embeddings put images and text in one
        space), otherwise the vector is the text of name, description and item names. Each look
        links to the vocabulary values its texts name (:meth:`link_vocabulary`); the looks that
        name none are returned."""
        self.store.merge_nodes(
            "Look",
            [
                {
                    "id": l.id,
                    "props": {
                        "name": l.name,
                        "occasion": l.occasion,
                        "description": l.description,
                        **l.props,
                    },
                }
                for l in looks
            ],
        )
        self.store.merge_edges(
            "CONTAINS", [{"source": l.id, "target": iid} for l in looks for iid in l.item_ids]
        )
        unresolved = self.link_vocabulary(looks)
        if with_embeddings:
            rows = []
            for l in looks:
                if image_bytes and l.id in image_bytes:
                    data, fmt = image_bytes[l.id]
                    vec = self.embedder.embed_image(data, fmt, INDEX)
                else:
                    names = [n.name for n in (self.store.get_node(i) for i in l.item_ids) if n]
                    vec = self.embedder.embed_text(l.embedding_text(names), INDEX)
                rows.append({"id": l.id, "embedding": vec})
            self.store.upsert_embeddings(rows)
        return unresolved

    def link_vocabulary(self, looks: list[Look]) -> list[dict]:
        """Each look to the vocabulary value its text names, through the ontology's property:
        for the property of the look to the occasions, the look's field named like their class
        (``occasion: "evening / formal"``) is matched (:func:`ontology.resolve_value`) and
        ``Look -FOR-> Occasion`` written, the edge type the property's (``kg.edge_type_of``). A
        look whose text names nothing keeps the text and gets no edge; it is logged and
        returned as ``{look, text}``."""
        by_property: dict[str, list[dict]] = defaultdict(list)
        for v in self.ontology.vocab_nodes:
            by_property[v["property"]["iri"]].append(v)
        edges: dict[str, list[dict]] = defaultdict(list)
        unresolved: list[dict] = []
        for values in by_property.values():
            field = values[0]["class"]["concept_id"]  # the record's field: its class's id
            for l in looks:
                text = str(getattr(l, field, "") or l.props.get(field) or "")
                if not text:
                    continue
                value = resolve_value(text, values)
                if value is None:
                    unresolved.append({"look": l.id, "text": text})
                    continue
                edges[value["property"]["edge"]].append({"source": l.id, "target": value["id"]})
        for edge_type, rows in edges.items():
            self.store.merge_edges(edge_type, rows)
        if unresolved:
            log.info("looks whose text names no vocabulary value: %s", unresolved)
        return unresolved

    def upsert_article(self, article: Article, with_embeddings: bool = True) -> None:
        self.store.merge_nodes(
            "Article",
            [
                {
                    "id": article.id,
                    "props": {
                        "title": article.title,
                        "name": article.title,
                        "source": article.source,
                        "published": article.published,
                    },
                }
            ],
        )
        self.store.merge_nodes(
            "Statement",
            [
                {"id": s.id, "props": {"text": s.text, "name": s.text[:80], "article": article.id}}
                for s in article.statements
            ],
        )
        self.store.merge_edges(
            "HAS_STATEMENT", [{"source": article.id, "target": s.id} for s in article.statements]
        )
        self.store.merge_edges(
            "ILLUSTRATES",
            [{"source": s.id, "target": t} for s in article.statements for t in s.illustrates],
        )
        if with_embeddings:
            self.store.upsert_embeddings(
                [
                    {"id": s.id, "embedding": self.embedder.embed_text(s.text, INDEX)}
                    for s in article.statements
                ]
            )

    def add_rule(self, rule: PairingRule) -> dict:
        """Write curatorial knowledge as an edge: the catalog's pairing rules, one by one."""
        props = {"rationale": rule.rationale, "occasion": rule.occasion, "source": rule.source}
        if rule.level == "category":
            src = (
                rule.source_id
                if rule.source_id.startswith("category:")
                else f"category:{rule.source_id}"
            )
            dst = (
                rule.target_id
                if rule.target_id.startswith("category:")
                else f"category:{rule.target_id}"
            )
            self.store.merge_edges("PAIRS_WITH", [{"source": src, "target": dst, "props": props}])
            return {"edge": "PAIRS_WITH", "source": src, "target": dst, "props": props}
        self.store.merge_edges(
            "LAYERED_WITH", [{"source": rule.source_id, "target": rule.target_id, "props": props}]
        )
        return {
            "edge": "LAYERED_WITH",
            "source": rule.source_id,
            "target": rule.target_id,
            "props": props,
        }
