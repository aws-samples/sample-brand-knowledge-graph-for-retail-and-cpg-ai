# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The openCypher statements run against Amazon Neptune Analytics.

They are collected here (rather than inlined) because they *are* the teaching material:
the workshop shows each one right before the UI runs it.

Notes on Neptune Analytics specifics:

* ``~id`` is a Neptune extension that lets ``MERGE``/``MATCH`` use caller-assigned node ids.
* The vector index is created with the graph (one index, fixed dimension) and is written
  with ``neptune.algo.vectors.upsert`` and searched with ``neptune.algo.vectors.topK.byEmbedding``
  (a vector) or ``topK.byNode`` (a node's own vector).
  ``score`` is the squared Euclidean distance (lower = closer).
* Vector writes are durable immediately and not atomic, so upserts are kept in their own
  statements and are idempotent (safe to retry).
* Algorithm arguments must be variables, not expressions: ``neptune.algo.vectors.upsert(n,
  row.embedding)`` is a ValidationException ("Expected LIST or NODE or ANY but received …
  Property"), so the vector is bound with ``WITH … AS embedding`` first.
"""

from __future__ import annotations

# ------------------------------------------------------------------ writes
MERGE_NODES = """
UNWIND $rows AS row
MERGE (n:{label} {{`~id`: row.id}})
SET n += row.props
RETURN count(n) AS merged
"""

MERGE_EDGES = """
UNWIND $rows AS row
MATCH (a {{`~id`: row.source}}), (b {{`~id`: row.target}})
MERGE (a)-[r:{edge_type}]->(b)
SET r += row.props
RETURN count(r) AS merged
"""

UPSERT_EMBEDDINGS = """
UNWIND $rows AS row
MATCH (n {`~id`: row.id})
WITH n, row.embedding AS embedding
CALL neptune.algo.vectors.upsert(n, embedding)
YIELD success
RETURN count(success) AS upserted
"""

DELETE_ALL = "MATCH (n) DETACH DELETE n"

# A node's vector, read back (the graph export, dna.py).
GET_EMBEDDINGS = """
MATCH (n) WHERE id(n) IN $ids
CALL neptune.algo.vectors.get(n)
YIELD node, embedding
RETURN id(node) AS id, embedding
"""

# ------------------------------------------------------------------ reads
GET_NODE = """
MATCH (n {`~id`: $id})
RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
"""

GET_NODES_BY_LABEL = """
MATCH (n:{label})
RETURN id(n) AS id, labels(n) AS labels, properties(n) AS props
LIMIT $limit
"""

# Vector similarity search restricted to the labels that carry embeddings.
# vertexFilter is a JSON structure; ``orAll`` needs at least two entries so callers
# expand a single label to a plain ``equals``. Neptune Analytics accepts no ``$parameters``
# inside CALL and needs the embedding as a static list, so the store writes the vector and k
# into the statement (``NeptuneAnalyticsStore.topk``, ``vector_literal``).
TOPK_BY_EMBEDDING = """
CALL neptune.algo.vectors.topK.byEmbedding({{
  embedding: {embedding},
  topK: {k},
  vertexFilter: {vertex_filter}
}})
YIELD node, score
RETURN id(node) AS id, labels(node) AS labels, properties(node) AS props, score
ORDER BY score ASC
"""

NEIGHBORS_OUT = """
MATCH (n {`~id`: $id})-[r]->(m)
WHERE size($types) = 0 OR type(r) IN $types
RETURN id(n) AS source, id(m) AS target, type(r) AS type, properties(r) AS rprops,
       labels(m) AS labels, properties(m) AS props
"""

NEIGHBORS_IN = """
MATCH (n {`~id`: $id})<-[r]-(m)
WHERE size($types) = 0 OR type(r) IN $types
RETURN id(m) AS source, id(n) AS target, type(r) AS type, properties(r) AS rprops,
       labels(m) AS labels, properties(m) AS props
"""

# Style recommendation: what several items link to at once (their values and components).
NEIGHBOR_IDS_OUT = """
UNWIND $ids AS nid
MATCH (n {`~id`: nid})-[r]->(m)
WHERE type(r) IN $types
RETURN nid AS source, id(m) AS target
"""

NEIGHBOR_IDS_IN = """
UNWIND $ids AS nid
MATCH (n {`~id`: nid})<-[r]-(m)
WHERE type(r) IN $types
RETURN nid AS source, id(m) AS target
"""

SUBGRAPH = """
UNWIND $ids AS cid
MATCH (c {{`~id`: cid}})-[r*1..{hops}]-(m)
UNWIND r AS rel
WITH DISTINCT rel, startNode(rel) AS s, endNode(rel) AS e
RETURN id(s) AS sid, labels(s) AS slabels, properties(s) AS sprops,
       id(e) AS eid, labels(e) AS elabels, properties(e) AS eprops,
       type(rel) AS type, properties(rel) AS rprops
LIMIT $limit
"""

NODE_COUNTS = "MATCH (n) RETURN labels(n) AS labels, count(n) AS count"
EDGE_COUNTS = "MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count"


def vertex_filter(labels: list[str]) -> str:
    """Render a ``vertexFilter`` literal for one or more node labels."""
    if not labels:
        return "{}"
    if len(labels) == 1:
        return f'{{equals: {{property: "~label", value: "{labels[0]}"}}}}'
    clauses = ", ".join(f'{{equals: {{property: "~label", value: "{l}"}}}}' for l in labels)
    return f"{{orAll: [{clauses}]}}"
