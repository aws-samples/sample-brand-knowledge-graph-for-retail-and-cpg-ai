# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Ontology-grounded GraphRAG: extraction, embedding, graph loading, retrieval and grounding.

The package is intentionally dependency-light (boto3 only) so the same code runs in
AWS Lambda, on AgentCore Runtime and in the tests. Two pluggable back ends make it testable
offline:

* :mod:`ontology_rag.graph.memory`: an in-memory graph that mirrors the openCypher
  semantics used against Amazon Neptune Analytics (:mod:`ontology_rag.graph.neptune`).
* :class:`ontology_rag.embeddings.MockEmbedder`: deterministic embeddings that stand
  in for Amazon Nova Multimodal Embeddings.
"""

__version__ = "0.1.0"
