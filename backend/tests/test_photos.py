# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""A data set's photos under stable keys ``<set>/<sub>/<file>`` (previews.STORED_PHOTO), stored at
``ontologies/<domain>/datasets/<set>/media/<sub>/<file>``: a look's preview, GET /api/photo."""

import shutil
from dataclasses import replace

import pytest
from conftest import ONTOLOGY
from fakes import FakeBedrock, FakeS3Vectors

from ontology_rag import api, previews
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 100


# Where Service.stored_photo looks for the key tiny/<sub>/<file>: below the bucket's ontologies/
# prefix (the data bucket, the blob store here), else the same path in the local folder.
BUCKET = "ontologies/fashion/datasets/tiny/media/"


@pytest.fixture
def svc(settings, tmp_path):
    ontologies = tmp_path / "ontologies"
    (ontologies / "fashion").mkdir(parents=True)
    shutil.copy(ONTOLOGY, ontologies / "fashion" / "fashion.ttl")
    local = ontologies / "fashion" / "datasets" / "tiny" / "media" / "looks"
    local.mkdir(parents=True)
    (local / "local.jpg").write_bytes(JPEG)
    s = Service(
        replace(settings, ontologies_dir=ontologies),
        store=InMemoryStore(),
        embedder=MockEmbedder(8),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    s.blobs.put_bytes(BUCKET + "products/p1.jpg", JPEG, "image/jpeg")
    s.blobs.put_bytes(BUCKET + "looks/bucket.jpg", JPEG, "image/jpeg")
    return s


@pytest.mark.parametrize(
    "key,ok",
    [
        ("whimsikora/looks/fashion_dress_1.jpg", True),
        ("whimsikora/products/item_-123.jpg", True),
        ("tiny/looks/l1.jpeg", True),
        ("velloway/other_sub-2/a.PNG.webp", True),  # any set, any sub folder (safe ids)
        ("whimsikora/looks/../runs/x.jpg", False),
        ("whimsikora/looks/a..jpg", False),  # no ".." anywhere
        ("Whimsikora/looks/a.jpg", False),  # a set id is lower case
        ("whimsikora/Looks/a.jpg", False),
        ("_tiny/looks/a.jpg", False),
        ("tiny/looks/.a.jpg", False),
        ("runs/run-1/run.json", False),
        ("whimsikora/looks/a.json", False),
        ("whimsikora/looks/a.gif", False),
        ("whimsikora/looks/sub/a.jpg", False),  # three segments, not four
        ("looks/a.jpg", False),  # nor two
        ("example:01-trench-coat-sweater-dress.jpg", False),
        ("upload:uploads/run-20261109-101010-abcd/00.jpg", False),
        ("", False),
    ],
)
def test_only_a_set_photo_key_is_allowed(key, ok):
    assert previews.is_stored_photo(key) is ok


def test_a_look_previews_its_photo_from_the_bucket_or_the_repository(svc):
    for name in ("bucket", "local"):
        svc.store.merge_nodes(
            "Look",
            [
                {
                    "id": f"look:{name}",
                    "props": {"name": name, "image_key": f"tiny/looks/{name}.jpg"},
                }
            ],
        )
        out = svc.node_source(f"look:{name}")
        assert out["photo"]["content_type"] == "image/jpeg", name
        assert out["photo"]["data_url"].startswith("data:image/jpeg;base64,")
        assert out["source"]["kind"] == "lookbook photo"


def test_a_missing_photo_says_so(svc):
    svc.store.merge_nodes(
        "Look", [{"id": "look:gone", "props": {"image_key": "tiny/looks/gone.jpg"}}]
    )
    out = svc.node_source("look:gone")
    assert out["photo"] is None
    assert out["photo_note"] == "its photo is not stored in this deployment"


def test_the_photo_route(svc):
    status, body = api.photo(svc, {"key": "tiny/products/p1.jpg"}, {})
    assert status == 200 and body["bytes"] == len(JPEG) and body["key"] == "tiny/products/p1.jpg"
    assert api.photo(svc, {"key": "tiny/looks/local.jpg"}, {})[0] == 200  # the local folder's
    assert api.photo(svc, {"key": "tiny/products/none.jpg"}, {})[0] == 404
    assert api.photo(svc, {"key": "other/products/p1.jpg"}, {})[0] == 404  # not that set's
    status, body = api.photo(svc, {"key": "runs/run-1/run.json"}, {})
    assert status == 400 and body["error"] == previews.STORED_PHOTO_RULE
    assert ("GET", "/api/photo") in api.ROUTES


def test_a_photo_over_the_cap_is_refused(svc, monkeypatch):
    monkeypatch.setattr(previews, "MAX_PHOTO_BYTES", 10)
    with pytest.raises(ValueError, match="too large"):
        svc.photo("tiny/products/p1.jpg")
