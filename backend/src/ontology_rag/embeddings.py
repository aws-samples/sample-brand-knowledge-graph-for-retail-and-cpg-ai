# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Embedders: Amazon Nova Multimodal Embeddings (text + image in one vector space) and a mock.

Nova request/response shape (InvokeModel, ``amazon.nova-2-multimodal-embeddings-v1:0``)::

    {"taskType": "SINGLE_EMBEDDING",
     "singleEmbeddingParams": {
        "embeddingPurpose": "GENERIC_INDEX",          # index side
        "embeddingDimension": 1024,                   # 256 | 384 | 1024 | 3072
        "text": {"truncationMode": "END", "value": "..."}
        # or "image": {"format": "jpeg", "source": {"bytes": "<base64>"}}
     }}
    -> {"embeddings": [{"embeddingType": "TEXT", "embedding": [...]}]}

Because text and images land in the same space, an image query can retrieve text-described
items and vice versa: Looks are embedded from their photos, Items from their text.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
from typing import Protocol


class Embedder(Protocol):
    dimension: int

    def embed_text(self, text: str, purpose: str = "GENERIC_INDEX") -> list[float]: ...

    def embed_image(
        self, image_bytes: bytes, image_format: str = "jpeg", purpose: str = "GENERIC_INDEX"
    ) -> list[float]: ...


# Purposes: use GENERIC_INDEX when writing to the index, and a *_RETRIEVAL purpose for queries.
INDEX = "GENERIC_INDEX"
QUERY_TEXT = "GENERIC_RETRIEVAL"  # our index mixes text- and image-derived vectors


class NovaEmbedder:
    """Amazon Nova Multimodal Embeddings via Amazon Bedrock ``InvokeModel``."""

    def __init__(
        self, model_id: str, dimension: int = 1024, region: str | None = None, client=None
    ):
        if client is None:
            import boto3

            client = boto3.client("bedrock-runtime", region_name=region)
        self._client = client
        self.model_id = model_id
        self.dimension = dimension

    def _invoke(self, params: dict) -> list[float]:
        body = {
            "taskType": "SINGLE_EMBEDDING",
            "singleEmbeddingParams": {"embeddingDimension": self.dimension, **params},
        }
        resp = self._client.invoke_model(
            modelId=self.model_id,
            body=json.dumps(body),
            accept="application/json",
            contentType="application/json",
        )
        payload = json.loads(resp["body"].read())
        return payload["embeddings"][0]["embedding"]

    def embed_text(self, text: str, purpose: str = INDEX) -> list[float]:
        return self._invoke(
            {"embeddingPurpose": purpose, "text": {"truncationMode": "END", "value": text[:8000]}}
        )

    def embed_image(
        self, image_bytes: bytes, image_format: str = "jpeg", purpose: str = INDEX
    ) -> list[float]:
        fmt = {"jpg": "jpeg"}.get(image_format.lower(), image_format.lower())
        return self._invoke(
            {
                "embeddingPurpose": purpose,
                "image": {
                    "detailLevel": "STANDARD_IMAGE",
                    "format": fmt,
                    "source": {"bytes": base64.b64encode(image_bytes).decode("ascii")},
                },
            }
        )


class MockEmbedder:
    """Deterministic bag-of-words embedding for tests and offline demos.

    Tokens are hashed into buckets so texts sharing words are close; images are hashed
    by content so the same bytes always give the same vector. Good enough to exercise
    the retrieval pipeline end-to-end without calling Bedrock.
    """

    def __init__(self, dimension: int = 1024):
        self.dimension = dimension

    def _bucket(self, token: str) -> int:
        # a stable bucket per token, not a security use of the hash
        digest = hashlib.sha256(token.encode()).hexdigest()
        return int(digest, 16) % self.dimension

    def embed_text(self, text: str, purpose: str = INDEX) -> list[float]:
        vec = [0.0] * self.dimension
        tokens = [
            t
            for t in "".join(ch if ch.isalnum() else " " for ch in text.lower()).split()
            if len(t) > 2
        ]
        for tok in tokens:
            vec[self._bucket(tok)] += 1.0
            vec[self._bucket(tok[:4])] += 0.5  # crude stemming so "jacket"/"jackets" overlap
        return _normalise(vec)

    def embed_image(
        self, image_bytes: bytes, image_format: str = "jpeg", purpose: str = INDEX
    ) -> list[float]:
        vec = [0.0] * self.dimension
        digest = hashlib.sha256(image_bytes).digest()
        for i, b in enumerate(digest):
            vec[(i * 37 + b) % self.dimension] += 1.0
        return _normalise(vec)


def _normalise(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def squared_distance(a: list[float], b: list[float]) -> float:
    """Neptune Analytics reports the squared Euclidean distance as ``score`` (lower = closer)."""
    return sum((x - y) * (x - y) for x, y in zip(a, b))


def make_embedder(kind: str, model_id: str, dimension: int, region: str) -> Embedder:
    if kind == "nova":
        return NovaEmbedder(model_id=model_id, dimension=dimension, region=region)
    return MockEmbedder(dimension=dimension)
