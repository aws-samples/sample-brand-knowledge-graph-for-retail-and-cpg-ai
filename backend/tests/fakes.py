# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Test doubles for AWS: a ``bedrock-runtime`` client that answers like a vision model.

The app always talks to Amazon Bedrock; the tests hand the Service this fake instead, so every
request is built for real and only the network call is replaced.
"""

from __future__ import annotations

import base64
import io
import json
import re
import threading
import time
from collections import Counter
from types import MappingProxyType

from ontology_rag.owl import estimate_tokens

# A model with explicit prompt caching, so cache on / off behaves like the real thing.
TEST_MODEL = "global.anthropic.claude-sonnet-5-5"


def fake_converse(request: dict, system_prompt: str) -> dict:
    """A Converse-shaped response: two or three leaf classes of the prompt as entities, usage that
    mirrors what caching does (the prompt tokens move from ``inputTokens`` to
    ``cacheReadInputTokens`` when the request carries a ``cachePoint``)."""
    leaves = re.findall(r"^\s{4,}- ([A-Za-z0-9]+)", system_prompt, flags=re.MULTILINE)[:3] or [
        "Thing"
    ]
    boxes = [[280, 120, 720, 620], [330, 600, 690, 940], [300, 900, 700, 990]]
    entities = [
        {
            "id": f"e{i + 1}",
            "class": cls,
            "label": f"fake {cls.lower()}",
            "bbox": boxes[i],
            "confidence": 0.5,
            "attributes": {},
            "parts": [],
        }
        for i, cls in enumerate(leaves)
    ]
    prompt_tokens = estimate_tokens(system_prompt) + 40
    cached = any("cachePoint" in s for s in request["system"])
    text = json.dumps(
        {
            "entities": entities,
            "ontology_feedback": [
                {
                    "observed": "a wristwatch on the left arm",
                    "entity": "e1",
                    "kind": "class",
                    "suggestion": "add class Watch under ArmsAndHandsAccessory (fake suggestion)",
                }
            ],
            "notes": "fake answer",
        }
    )
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": "end_turn",
        "usage": {
            "inputTokens": 40 if cached else prompt_tokens + 40,
            "outputTokens": 120,
            "cacheReadInputTokens": prompt_tokens if cached else 0,
            "cacheWriteInputTokens": 0,
        },
        "metrics": {"latencyMs": 42},
    }


class FakeBedrock:
    """Records every ``converse(**request)`` and answers like the model the request is for: the
    answer prompt (tab 3, answer.py) gets a cited answer, everything else a vision answer."""

    def __init__(self):
        self.requests: list[dict] = []

    def converse(self, **request):
        self.requests.append(request)
        if "Answer only from the numbered evidence" in request["system"][0]["text"]:
            return fake_answer(request)
        return fake_converse(request, request["system"][0]["text"])


def fake_answer(request: dict) -> dict:
    """A grounded answer that cites the first two numbered evidence lines it was given."""
    user = request["messages"][0]["content"][-1]["text"]
    numbers = re.findall(r"^\[(\d+)\]", user, flags=re.MULTILINE)[:2]
    text = (
        "Wear it with " + " and ".join(f"this [{n}]" for n in numbers) + "."
        if numbers
        else "The evidence does not say."
    )
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "usage": {"inputTokens": 100, "outputTokens": 20},
        "metrics": {"latencyMs": 7},
        "stopReason": "end_turn",
    }


class FakeS3Vectors:
    """Amazon S3 Vectors indexes in dicts, one per ``indexName``: PutVectors, QueryVectors
    (cosine), ListVectors, GetVectors and DeleteVectors with the request and response shapes of
    the real API. ``calls`` records ``(operation, indexName)`` in order; an index named in
    ``missing`` answers ``NotFoundException`` as a real index the stack has not created yet."""

    def __init__(self, missing: tuple[str, ...] = (), dimension: int = 256):
        self.indexes: dict[str, dict[str, dict]] = {}
        self.calls: list[tuple[str, str]] = []
        self.missing = set(missing)
        self.dimension = dimension  # GetIndex's answer for an index with no vectors yet

    @property
    def vectors(self) -> MappingProxyType:
        """The ``catalog`` index, read-only."""
        return MappingProxyType(self.indexes.get("catalog", {}))

    def _index(self, operation: str, name: str) -> dict[str, dict]:
        self.calls.append((operation, name))
        if name in self.missing:
            raise _ClientError("NotFoundException")
        return self.indexes.setdefault(name, {})

    def get_index(self, vectorBucketName, indexName):
        index = self._index("GetIndex", indexName)
        first = next(iter(index.values()), None)
        return {
            "index": {
                "indexName": indexName,
                "dataType": "float32",
                "dimension": len(first["data"]["float32"]) if first else self.dimension,
                "distanceMetric": "cosine",
            }
        }

    def put_vectors(self, vectorBucketName, indexName, vectors):
        index = self._index("PutVectors", indexName)
        for v in vectors:
            index[v["key"]] = v
        return {}

    def query_vectors(
        self,
        vectorBucketName,
        indexName,
        queryVector,
        topK,
        returnMetadata=False,
        returnDistance=False,
        **_,
    ):
        index = self._index("QueryVectors", indexName)
        q = queryVector["float32"]
        scored = sorted(
            ((1.0 - _cosine(q, v["data"]["float32"]), v) for v in index.values()),
            key=lambda t: t[0],
        )[:topK]
        out = []
        for distance, v in scored:
            hit = {"key": v["key"]}
            if returnDistance:
                hit["distance"] = distance
            if returnMetadata:
                hit["metadata"] = v["metadata"]
            out.append(hit)
        return {"vectors": out, "distanceMetric": "cosine"}

    def list_vectors(
        self,
        vectorBucketName,
        indexName,
        maxResults=1000,
        nextToken=None,
        returnData=False,
        returnMetadata=False,
        **_,
    ):
        index = self._index("ListVectors", indexName)
        keys = sorted(index)
        start = int(nextToken or 0)
        page = keys[start : start + maxResults]
        out = []
        for k in page:
            v = {"key": k}
            if returnData:
                v["data"] = index[k]["data"]
            if returnMetadata:
                v["metadata"] = index[k].get("metadata", {})
            out.append(v)
        result = {"vectors": out}
        if start + maxResults < len(keys):
            result["nextToken"] = str(start + maxResults)
        return result

    def get_vectors(
        self, vectorBucketName, indexName, keys, returnData=False, returnMetadata=False
    ):
        index = self._index("GetVectors", indexName)
        out = []
        for k in keys:
            if k in index:
                v = {"key": k}
                if returnData:
                    v["data"] = index[k]["data"]
                if returnMetadata:
                    v["metadata"] = index[k].get("metadata", {})
                out.append(v)
        return {"vectors": out}

    def delete_vectors(self, vectorBucketName, indexName, keys):
        index = self._index("DeleteVectors", indexName)
        for k in keys:
            index.pop(k, None)
        return {}


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = sum(x * x for x in a) ** 0.5 or 1.0
    nb = sum(y * y for y in b) ** 0.5 or 1.0
    return dot / (na * nb)


class _ClientError(Exception):
    """botocore's ClientError as far as ``errors.aws_error_code`` reads it."""

    def __init__(self, code: str):
        super().__init__(code)
        self.response = {"Error": {"Code": code, "Message": code}}


class FakeS3:
    """The calls ``pipeline.S3BlobStore`` makes on boto3's S3 client, over a dict: PutObject,
    GetObject, DeleteObject and ListObjectsV2 (``MaxKeys`` up to 1,000, an opaque
    ``ContinuationToken``, the paginator). ``calls`` counts the requests by operation and
    ``latency`` (seconds) is slept before each one, so a test can tell what a bucket of N
    documents costs in requests and in time."""

    class exceptions:  # boto3's spelling: client.exceptions.NoSuchKey
        class NoSuchKey(Exception):
            pass

    def __init__(self, latency: float = 0.0):
        self.objects: dict[str, bytes] = {}
        self.calls: Counter[str] = Counter()
        self.latency = latency
        self._lock = threading.Lock()

    def _call(self, op: str) -> None:
        with self._lock:
            self.calls[op] += 1
        if self.latency:
            time.sleep(self.latency)

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self._call("PutObject")
        self.objects[Key] = bytes(Body)
        return {}

    def get_object(self, Bucket, Key):
        self._call("GetObject")
        if Key not in self.objects:
            raise self.exceptions.NoSuchKey(Key)
        return {"Body": io.BytesIO(self.objects[Key])}

    def delete_object(self, Bucket, Key):
        self._call("DeleteObject")
        self.objects.pop(Key, None)
        return {}

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000, ContinuationToken=None, **_):
        self._call("ListObjectsV2")
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        if ContinuationToken:
            try:
                after = base64.urlsafe_b64decode(ContinuationToken.encode()).decode()
            except ValueError as exc:  # S3: 400 InvalidArgument for a token it did not issue
                raise _ClientError("InvalidArgument") from exc
            keys = [k for k in keys if k > after]
        page = keys[: min(MaxKeys, 1000)]
        out = {"Contents": [{"Key": k} for k in page], "KeyCount": len(page)}
        out["IsTruncated"] = len(keys) > len(page)
        if out["IsTruncated"]:
            out["NextContinuationToken"] = base64.urlsafe_b64encode(page[-1].encode()).decode()
        return out

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        s3 = self

        class Paginator:
            def paginate(self, Bucket, Prefix=""):
                token = None
                while True:
                    page = s3.list_objects_v2(Bucket, Prefix, ContinuationToken=token)
                    yield page
                    token = page.get("NextContinuationToken")
                    if not token:
                        return

        return Paginator()


class Counted:
    """Any client, with every method call counted by name (``calls``) and ``latency`` seconds
    slept before it: wraps ``FakeS3Vectors`` the way ``FakeS3`` counts its own requests."""

    def __init__(self, inner, latency: float = 0.0):
        self.inner = inner
        self.calls: Counter[str] = Counter()
        self.latency = latency

    def __getattr__(self, name):
        target = getattr(self.inner, name)
        if not callable(target):
            return target

        def call(*args, **kwargs):
            self.calls[name] += 1
            if self.latency:
                time.sleep(self.latency)
            return target(*args, **kwargs)

        return call
