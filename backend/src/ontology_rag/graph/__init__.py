# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Graph back ends: Amazon Neptune Analytics (openCypher), and an in-memory store for the tests."""

from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.graph.neptune import NeptuneAnalyticsStore
from ontology_rag.graph.store import Edge, GraphStore, Node

__all__ = ["Edge", "GraphStore", "Node", "make_store"]


def make_store(settings) -> GraphStore:
    if settings.graph_backend == "neptune":
        return NeptuneAnalyticsStore(
            graph_id=settings.graph_id,
            region=settings.region,
            endpoint_url=settings.graph_endpoint_url or None,
        )
    return InMemoryStore()
