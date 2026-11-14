# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""In-memory graph with the same semantics as the Neptune Analytics store, for the tests.

It runs no openCypher (:meth:`InMemoryStore.query`), so the tests stub what needs it.
"""

from __future__ import annotations

from ontology_rag.embeddings import squared_distance
from ontology_rag.graph.store import Edge, Node


class InMemoryStore:
    def __init__(self):
        self.nodes: dict[str, Node] = {}
        self.edges: dict[tuple[str, str, str], Edge] = {}
        self.embeddings: dict[str, list[float]] = {}

    # ------------------------------------------------------------------ writes
    def merge_nodes(self, label: str, rows: list[dict]) -> None:
        for r in rows:
            node = self.nodes.get(r["id"])
            if node is None:
                node = Node(r["id"], [label], {})
                self.nodes[r["id"]] = node
            elif label not in node.labels:
                node.labels.append(label)
            node.props.update({k: v for k, v in (r.get("props") or {}).items() if v is not None})

    def merge_edges(self, edge_type: str, rows: list[dict]) -> None:
        for r in rows:
            if r["source"] not in self.nodes or r["target"] not in self.nodes:
                # Mirrors MATCH-then-MERGE: missing endpoints produce no edge.
                continue
            key = (r["source"], edge_type, r["target"])
            edge = self.edges.get(key)
            if edge is None:
                edge = Edge(r["source"], r["target"], edge_type, {})
                self.edges[key] = edge
            edge.props.update({k: v for k, v in (r.get("props") or {}).items() if v is not None})

    def upsert_embeddings(self, rows: list[dict]) -> None:
        for r in rows:
            if r["id"] in self.nodes:
                self.embeddings[r["id"]] = list(r["embedding"])

    def delete_all(self) -> None:
        self.nodes.clear()
        self.edges.clear()
        self.embeddings.clear()

    # ------------------------------------------------------------------ reads
    def get_node(self, node_id: str) -> Node | None:
        return self.nodes.get(node_id)

    def get_nodes(self, label: str, limit: int = 500) -> list[Node]:
        return [n for n in self.nodes.values() if label in n.labels][:limit]

    def get_embeddings(self, node_ids: list[str]) -> dict[str, list[float]]:
        return {i: list(self.embeddings[i]) for i in node_ids if i in self.embeddings}

    def topk(self, embedding: list[float], k: int, labels: list[str]) -> list[tuple[Node, float]]:
        scored = []
        for nid, vec in self.embeddings.items():
            node = self.nodes[nid]
            if labels and not any(l in node.labels for l in labels):
                continue
            scored.append((node, squared_distance(embedding, vec)))
        scored.sort(key=lambda t: t[1])
        return scored[:k]

    def neighbors(
        self, node_id: str, edge_types: list[str] | None = None, direction: str = "both"
    ) -> list[tuple[Edge, Node]]:
        out = []
        for (s, t, d), edge in self.edges.items():
            if edge_types and t not in edge_types:
                continue
            if s == node_id and direction in ("out", "both"):
                out.append((edge, self.nodes[d]))
            elif d == node_id and direction in ("in", "both"):
                out.append((edge, self.nodes[s]))
        return out

    def neighbor_ids(
        self, node_ids: list[str], edge_types: list[str], direction: str = "out"
    ) -> dict[str, set[str]]:
        wanted = set(node_ids)
        out: dict[str, set[str]] = {n: set() for n in node_ids if n in self.nodes}
        for s, t, d in self.edges:
            if t not in edge_types:
                continue
            if direction == "in" and d in wanted:
                out.setdefault(d, set()).add(s)
            elif direction != "in" and s in wanted:
                out.setdefault(s, set()).add(d)
        return out

    def subgraph(
        self, center_ids: list[str], hops: int = 1, limit: int = 200
    ) -> tuple[list[Node], list[Edge]]:
        seen = {c for c in center_ids if c in self.nodes}
        frontier = set(seen)
        edges: dict[tuple, Edge] = {}
        for _ in range(max(1, min(int(hops), 3))):
            nxt = set()
            for nid in frontier:
                for edge, other in self.neighbors(nid):
                    edges[(edge.source, edge.type, edge.target)] = edge
                    if other.id not in seen:
                        nxt.add(other.id)
                    if len(edges) >= limit:
                        break
            seen |= nxt
            frontier = nxt
        return [self.nodes[i] for i in seen], list(edges.values())[:limit]

    def summary(self) -> dict:
        nodes: dict[str, int] = {}
        for n in self.nodes.values():
            nodes[n.label] = nodes.get(n.label, 0) + 1
        edges: dict[str, int] = {}
        for e in self.edges.values():
            edges[e.type] = edges.get(e.type, 0) + 1
        return {
            "backend": "memory",
            "nodes": nodes,
            "edges": edges,
            "embeddings": len(self.embeddings),
        }

    def query(self, cypher: str, params: dict | None = None) -> list[dict]:
        raise NotImplementedError(
            "The in-memory store does not execute openCypher. Set GRAPH_BACKEND=neptune to use the query console."
        )
