# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The catalog index as a file (a graph-export set's ``catalog.json``): put back at deploy without
embedding."""

import json
from types import SimpleNamespace

import pytest
from fakes import FakeS3Vectors

from ontology_rag import dna, payoff


def _svc(dim: int = 4):
    settings = SimpleNamespace(vector_bucket="b", catalog_index="catalog", embedding_dimension=dim)
    return SimpleNamespace(s3vectors=FakeS3Vectors(), settings=settings)


def _write(path, n: int, dim: int = 4):
    """A ``catalog.json`` as a graph-export set ships it: key, metadata, base64 float32 vector."""
    items = [
        {
            "key": f"p{i:04d}",
            "metadata": {"name": f"Product {i}", "image_key": f"tiny/products/p{i:04d}.jpg"},
            "vector": dna.encode_vector([i / 10] * dim),
        }
        for i in range(n)
    ]
    path.write_text(json.dumps({"dimension": dim, "items": items}))


def test_put_fills_the_catalog_index_200_at_a_time(tmp_path):
    path = tmp_path / payoff.CATALOG_FILE
    _write(path, 450)
    dst = _svc()
    calls = []
    real = dst.s3vectors.put_vectors
    dst.s3vectors.put_vectors = lambda **kw: calls.append(len(kw["vectors"])) or real(**kw)
    assert payoff.put_catalog_vectors(dst, path) == {"indexed": 450}
    assert calls == [200, 200, 50]
    assert dst.s3vectors.vectors["p0007"]["data"]["float32"] == pytest.approx([0.7] * 4)
    assert dst.s3vectors.vectors["p0007"]["metadata"]["image_key"] == "tiny/products/p0007.jpg"
    assert set(dst.s3vectors.indexes) == {"catalog"}  # the only index there is


def test_put_refuses_a_dimension_mismatch(tmp_path):
    path = tmp_path / payoff.CATALOG_FILE
    _write(path, 3)
    dst = _svc(dim=1024)
    with pytest.raises(ValueError, match="dimensions"):
        payoff.put_catalog_vectors(dst, path)
    assert dst.s3vectors.vectors == {}
