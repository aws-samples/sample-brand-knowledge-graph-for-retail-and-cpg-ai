# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The small graph API the rest of the package is written against."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class Node:
    id: str
    labels: list[str]
    props: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return self.labels[0] if self.labels else ""

    @property
    def name(self) -> str:
        return str(
            self.props.get("name") or self.props.get("title") or self.props.get("text") or self.id
        )

    def to_dict(self) -> dict:
        return {"id": self.id, "labels": list(self.labels), "props": dict(self.props)}


@dataclass
class Edge:
    source: str
    target: str
    type: str
    props: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "props": dict(self.props),
        }


class GraphStore(Protocol):
    """What a back end must provide. Ids are caller-assigned strings (``~id`` on Neptune)."""

    # --- writes (idempotent: MERGE semantics)
    def merge_nodes(self, label: str, rows: list[dict]) -> None: ...
    def merge_edges(self, edge_type: str, rows: list[dict]) -> None: ...
    def upsert_embeddings(self, rows: list[dict]) -> None: ...
    def delete_all(self) -> None: ...

    # --- reads
    def get_embeddings(self, node_ids: list[str]) -> dict[str, list[float]]:
        """The stored vectors of these nodes (those without one are left out)."""
        ...

    def get_node(self, node_id: str) -> Node | None: ...
    def get_nodes(self, label: str, limit: int = 500) -> list[Node]: ...
    def topk(
        self, embedding: list[float], k: int, labels: list[str]
    ) -> list[tuple[Node, float]]: ...
    def neighbors(
        self, node_id: str, edge_types: list[str] | None = None, direction: str = "both"
    ) -> list[tuple[Edge, Node]]: ...
    def neighbor_ids(
        self, node_ids: list[str], edge_types: list[str], direction: str = "out"
    ) -> dict[str, set[str]]:
        """The nodes at the other end of several nodes' edges of these types, at once: one round
        trip. ``direction`` "out" (the default) follows the edges from the nodes, "in" follows
        them to the nodes (a garment's looks: ``(:Look)-[:CONTAINS]->(garment)``)."""
        ...

    def subgraph(
        self, center_ids: list[str], hops: int = 1, limit: int = 200
    ) -> tuple[list[Node], list[Edge]]: ...
    def summary(self) -> dict: ...

    # --- escape hatch (tab 3's query agent, GraphRAG, the lenses); the in-memory store raises NotImplementedError
    def query(self, cypher: str, params: dict | None = None) -> list[dict]: ...
