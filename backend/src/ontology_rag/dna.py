# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The brand's style DNA as files, loaded at deploy.

The DNA is what the ingest pipeline built from the brand's lookbook: the looks, the garments in
them (each linked to its Category, Attribute and part Categories of the ontology), the occasion of
each look and the brand. It was exported once from a graph (``ontology-rag export-dna``, last in
commit f2e9f99); :func:`load` MERGEs it into the graph with the vectors it was exported with, so a
deploy makes no Bedrock call and every account gets the same graph.

The ontology's own nodes (Group, Category, AttributeFamily, Attribute) are not in the files: the
loader builds them from the ``.ttl`` first (``Loader.load_ontology``), and the DNA's edges point at
them by id.

Files in the export folder:

``graph.json``
    ``{"nodes": [{"id", "label", "props"}], "edges": [{"type", "source", "target", "props"}]}``
``vectors.json``
    ``{"dimension": n, "vectors": {node id: base64 of n little-endian float32}}``: exact, and a
    third the size of the same numbers as JSON.

What the export changed on the way out:

* ``run`` was dropped from every node: the DNA is the baseline, and only what a participant
  ingests later carries a run (tab 6 compares the two).
* ``image_key`` names the look's photo under a stable key in the data bucket (``<set>/looks/...``)
  instead of an upload that expires.
"""

from __future__ import annotations

import base64
import json
import struct
from collections.abc import Iterable
from pathlib import Path

from ontology_rag.graph.store import GraphStore

GRAPH_FILE = "graph.json"
VECTORS_FILE = "vectors.json"

# The labels the DNA is made of, in load order (an edge's ends must exist before the edge).
LABELS = ("Brand", "Occasion", "Look", "Item")


def encode_vector(vec: Iterable[float]) -> str:
    """The export's vector format (base64 of little-endian float32), :func:`decode_vector`'s inverse."""
    vals = list(vec)
    return base64.b64encode(struct.pack(f"<{len(vals)}f", *vals)).decode()


def decode_vector(text: str) -> list[float]:
    raw = base64.b64decode(text)
    return list(struct.unpack(f"<{len(raw) // 4}f", raw))


def counts(graph: dict, n_vectors: int) -> dict:
    by_label: dict[str, int] = {}
    for n in graph["nodes"]:
        by_label[n["label"]] = by_label.get(n["label"], 0) + 1
    by_type: dict[str, int] = {}
    for e in graph["edges"]:
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    return {"nodes": by_label, "edges": by_type, "vectors": n_vectors}


def read(path: str | Path) -> tuple[dict, dict[str, list[float]], int]:
    """The export in ``path``: the graph, its vectors and their dimension."""
    p = Path(path)
    graph = json.loads((p / GRAPH_FILE).read_text())
    vfile = p / VECTORS_FILE
    data = json.loads(vfile.read_text()) if vfile.exists() else {"dimension": 0, "vectors": {}}
    vectors = {i: decode_vector(t) for i, t in data["vectors"].items()}
    return graph, vectors, int(data.get("dimension") or 0)


def load(store: GraphStore, path: str | Path, dimension: int | None = None) -> dict:
    """MERGE the export in ``path`` into ``store`` (the ontology must be loaded first: the edges
    into it are dropped otherwise), then write the vectors as they are. ``dimension``: the graph's
    vector index, checked against the export's so a mismatch fails before anything is written."""
    graph, vectors, dim = read(path)
    if dimension and vectors and dim != dimension:
        raise ValueError(
            f"the export's vectors have {dim} dimensions, the graph's index {dimension}"
        )
    by_label: dict[str, list[dict]] = {}
    for n in graph["nodes"]:
        by_label.setdefault(n["label"], []).append({"id": n["id"], "props": n["props"]})
    labels = [label for label in LABELS if label in by_label] + sorted(set(by_label) - set(LABELS))
    for label in labels:
        store.merge_nodes(label, by_label[label])
    by_type: dict[str, list[dict]] = {}
    for e in graph["edges"]:
        by_type.setdefault(e["type"], []).append(
            {"source": e["source"], "target": e["target"], "props": e.get("props") or {}}
        )
    for etype in sorted(by_type):
        store.merge_edges(etype, by_type[etype])
    store.upsert_embeddings([{"id": i, "embedding": v} for i, v in vectors.items()])
    return counts(graph, len(vectors))
