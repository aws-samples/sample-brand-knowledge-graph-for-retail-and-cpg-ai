# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Amazon Neptune Analytics back end (openCypher over the ``neptune-graph`` data plane)."""

from __future__ import annotations

import json
import math
import re

from ontology_rag.graph import cypher as Q
from ontology_rag.graph.store import Edge, Node

_LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_WRITE_RE = re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP)\b"
    r"|neptune\.algo\.vectors\.(upsert|remove)|neptune\.load|\.mutate\b",
    re.IGNORECASE,
)
# CALL neptune.read({source: "s3://...", format: "csv"}) reads an S3 object with the caller's
# credentials: outside the graph. The name may be quoted with backticks (`neptune`.`read`).
_S3_READ_RE = re.compile(r"\bneptune`?\s*\.\s*`?read\b", re.IGNORECASE)


# openCypher lets a name be quoted with backticks and spaced around its dots
# (`neptune`.`algo`.`pageRank`.`mutate`, neptune . load): drop both before matching.
_QUOTE_OR_DOT_SPACE_RE = re.compile(r"`|\s*\.\s*")


def _plain_names(cypher: str) -> str:
    return _QUOTE_OR_DOT_SPACE_RE.sub(lambda m: "" if m.group(0) == "`" else ".", cypher)


def is_write_query(cypher: str) -> bool:
    """Cheap keyword guard used by the query console when write access is disabled, and by the
    query agent always. ``*.mutate`` algorithm variants write their results into the graph, and
    ``neptune.read`` reads S3, so both are refused like a write. A convenience, not the control:
    the deployed API's role may only read the graph unless write queries are allowed."""
    # The keywords on the text as written (a backtick next to DELETE is a word boundary), the
    # procedure names on the text without quotes and dot spacing.
    plain = _plain_names(cypher)
    return bool(_WRITE_RE.search(cypher) or _WRITE_RE.search(plain)) or reads_s3(cypher)


def reads_s3(cypher: str) -> bool:
    """``CALL neptune.read()``: refused by the console even where write queries are allowed,
    because it would read S3 with the API's role."""
    return bool(_S3_READ_RE.search(cypher))


class NeptuneAnalyticsStore:
    def __init__(
        self, graph_id: str, region: str | None = None, endpoint_url: str | None = None, client=None
    ):
        if not graph_id:
            raise ValueError("GRAPH_ID is required for the neptune back end")
        self.graph_id = graph_id
        if client is None:
            import boto3
            from botocore.config import Config

            kwargs = {
                "region_name": region,
                "config": Config(read_timeout=120, retries={"max_attempts": 3}),
            }
            if endpoint_url:
                kwargs["endpoint_url"] = endpoint_url
            client = boto3.client("neptune-graph", **kwargs)
        self._client = client

    # ------------------------------------------------------------------ raw
    def query(self, cypher: str, params: dict | None = None) -> list[dict]:
        kwargs = {
            "graphIdentifier": self.graph_id,
            "queryString": cypher,
            "language": "OPEN_CYPHER",
        }
        if params:
            kwargs["parameters"] = params
        resp = self._client.execute_query(**kwargs)
        payload = resp["payload"].read()
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        return json.loads(payload).get("results", [])

    # ------------------------------------------------------------------ writes
    def merge_nodes(self, label: str, rows: list[dict]) -> None:
        _check_label(label)
        for chunk in _chunks(rows, 200):
            self.query(
                Q.MERGE_NODES.format(label=label),
                {"rows": [{"id": r["id"], "props": _clean(r.get("props", {}))} for r in chunk]},
            )

    def merge_edges(self, edge_type: str, rows: list[dict]) -> None:
        _check_label(edge_type)
        for chunk in _chunks(rows, 200):
            self.query(
                Q.MERGE_EDGES.format(edge_type=edge_type),
                {
                    "rows": [
                        {
                            "source": r["source"],
                            "target": r["target"],
                            "props": _clean(r.get("props", {})),
                        }
                        for r in chunk
                    ]
                },
            )

    def upsert_embeddings(self, rows: list[dict]) -> None:
        # Vector writes are not atomic; keep batches small and the statement idempotent.
        for chunk in _chunks(rows, 25):
            self.query(
                Q.UPSERT_EMBEDDINGS,
                {"rows": [{"id": r["id"], "embedding": r["embedding"]} for r in chunk]},
            )

    def delete_all(self) -> None:
        self.query(Q.DELETE_ALL)

    # ------------------------------------------------------------------ reads
    def get_node(self, node_id: str) -> Node | None:
        rows = self.query(Q.GET_NODE, {"id": node_id})
        return _node(rows[0]) if rows else None

    def get_embeddings(self, node_ids: list[str]) -> dict[str, list[float]]:
        out: dict[str, list[float]] = {}
        for chunk in _chunks(list(node_ids), 50):
            for r in self.query(Q.GET_EMBEDDINGS, {"ids": chunk}):
                if r.get("embedding"):
                    out[r["id"]] = [float(x) for x in r["embedding"]]
        return out

    def get_nodes(self, label: str, limit: int = 500) -> list[Node]:
        _check_label(label)
        return [
            _node(r) for r in self.query(Q.GET_NODES_BY_LABEL.format(label=label), {"limit": limit})
        ]

    def topk(self, embedding: list[float], k: int, labels: list[str]) -> list[tuple[Node, float]]:
        for l in labels:
            _check_label(l)
        # Neptune Analytics takes no query parameters inside CALL, and the embedding must be a
        # static list, so the vector and k are written into the statement as literals.
        rows = self.query(
            Q.TOPK_BY_EMBEDDING.format(
                embedding=vector_literal(embedding),
                k=int(k),
                vertex_filter=Q.vertex_filter(labels),
            )
        )
        return [(_node(r), float(r["score"])) for r in rows]

    def neighbors(
        self, node_id: str, edge_types: list[str] | None = None, direction: str = "both"
    ) -> list[tuple[Edge, Node]]:
        types = edge_types or []
        out: list[tuple[Edge, Node]] = []
        if direction in ("out", "both"):
            for r in self.query(Q.NEIGHBORS_OUT, {"id": node_id, "types": types}):
                out.append(
                    (
                        Edge(r["source"], r["target"], r["type"], _clean(r.get("rprops") or {})),
                        _node({**r, "id": r["target"]}),
                    )
                )
        if direction in ("in", "both"):
            for r in self.query(Q.NEIGHBORS_IN, {"id": node_id, "types": types}):
                out.append(
                    (
                        Edge(r["source"], r["target"], r["type"], _clean(r.get("rprops") or {})),
                        _node({**r, "id": r["source"]}),
                    )
                )
        return out

    def neighbor_ids(
        self, node_ids: list[str], edge_types: list[str], direction: str = "out"
    ) -> dict[str, set[str]]:
        out: dict[str, set[str]] = {n: set() for n in node_ids}
        template = Q.NEIGHBOR_IDS_IN if direction == "in" else Q.NEIGHBOR_IDS_OUT
        if node_ids:
            for r in self.query(template, {"ids": list(node_ids), "types": edge_types}):
                out.setdefault(r["source"], set()).add(r["target"])
        return out

    def subgraph(
        self, center_ids: list[str], hops: int = 1, limit: int = 200
    ) -> tuple[list[Node], list[Edge]]:
        hops = max(1, min(int(hops), 3))
        nodes: dict[str, Node] = {}
        edges: dict[tuple, Edge] = {}
        for c in center_ids:
            n = self.get_node(c)
            if n:
                nodes[n.id] = n
        for r in self.query(Q.SUBGRAPH.format(hops=hops), {"ids": center_ids, "limit": limit}):
            s = Node(r["sid"], r["slabels"], _strip_embedding(r["sprops"]))
            e = Node(r["eid"], r["elabels"], _strip_embedding(r["eprops"]))
            nodes.setdefault(s.id, s)
            nodes.setdefault(e.id, e)
            edges.setdefault(
                (s.id, r["type"], e.id), Edge(s.id, e.id, r["type"], _clean(r.get("rprops") or {}))
            )
        return list(nodes.values()), list(edges.values())

    def summary(self) -> dict:
        nodes = {}
        for r in self.query(Q.NODE_COUNTS):
            label = (r["labels"] or ["(none)"])[0]
            nodes[label] = nodes.get(label, 0) + int(r["count"])
        edges = {r["type"]: int(r["count"]) for r in self.query(Q.EDGE_COUNTS)}
        return {"backend": "neptune", "graph_id": self.graph_id, "nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------- helpers
def vector_literal(embedding: list[float]) -> str:
    """An embedding as an openCypher list literal (7 significant digits, the float32 precision)."""
    values = [float(x) for x in embedding]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("an embedding must not contain NaN or infinity")
    return "[" + ",".join(f"{v:.7g}" for v in values) + "]"


def _check_label(label: str) -> None:
    if not _LABEL_RE.match(label):
        raise ValueError(f"invalid label/edge type: {label!r}")


def _chunks(rows: list, size: int):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def _clean(props: dict) -> dict:
    """Neptune property values must be scalars or lists of scalars; drop None/dicts."""
    out = {}
    for k, v in (props or {}).items():
        if v is None or isinstance(v, dict):
            continue
        if isinstance(v, (list, tuple)):
            v = [x for x in v if isinstance(x, (str, int, float, bool))]
        out[k] = v
    return out


def _strip_embedding(props: dict | None) -> dict:
    props = dict(props or {})
    props.pop("embedding", None)
    return props


def _node(row: dict) -> Node:
    return Node(row["id"], list(row.get("labels") or []), _strip_embedding(row.get("props")))
