# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The receipts tree and the graph views preview a node with the photo it came from (previews.py,
GET /api/graph/source), found by its own ``image_key``: one of the brand's stored photos, an
example photo, or a photo uploaded in tab 2; otherwise what the graph itself holds."""

import base64

import pytest
from conftest import ONTOLOGIES
from fakes import FakeBedrock, FakeS3Vectors

from ontology_rag import previews
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.graph.store import Node
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

EXAMPLE = "01-trench-coat-sweater-dress.jpg"
EXAMPLE_BYTES = (ONTOLOGIES / "fashion" / "examples" / "images" / EXAMPLE).read_bytes()
JPEG = b"\xff\xd8\xff\xe0" + b"photo of the source" * 10
RUN = "run-20261014-101500-ab12"
UPLOAD = f"uploads/{RUN}/01.jpeg"


def _get(svc, query):
    return dispatch(svc, "GET", "/api/graph/source", query, {})


def _bytes_of(preview) -> bytes:
    return base64.b64decode(preview["photo"]["data_url"].split(",", 1)[1])


@pytest.fixture
def tab2_service(settings):
    """A graph with what tab 2 writes (an item and a look from an uploaded photo, an item from an
    example photo, an article and its statement from a text), and the uploaded photo in the data
    bucket."""
    svc = Service(
        settings,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    upload_key = f"upload:{UPLOAD}"
    svc.store.merge_nodes(
        "Item",
        [
            {
                "id": "item:1a2b3c4d-e1-coat",
                "props": {"name": "beige trench coat", "image_key": upload_key, "run": RUN},
            },
            {
                "id": "item:5e6f7a8b-e1-coat",
                "props": {"name": "stone trench", "image_key": f"example:{EXAMPLE}", "run": RUN},
            },
            {
                "id": "item:lb-ankle-boots-0edacddc",
                "props": {"name": "Tan ankle boots", "description": "Cognac-tan ankle boots."},
            },
        ],
    )
    svc.store.merge_nodes(
        "Look",
        [
            {"id": "look:1a2b3c4d", "props": {"name": "trench", "image_key": upload_key}},
            {
                "id": "look:lb-business-casual",
                "props": {"name": "Business casual", "image_key": "lookbook/fashion_1.png"},
            },
        ],
    )
    svc.store.merge_nodes("Article", [{"id": "article:9f8e7d6c", "props": {"title": "A post"}}])
    svc.store.merge_nodes(
        "Statement",
        [
            {
                "id": "st:9f8e7d6c-1",
                "props": {"text": "Wear the trench open.", "article": "article:9f8e7d6c"},
            }
        ],
    )
    svc.blobs.put_bytes(UPLOAD, JPEG, "image/jpeg")
    return svc


def test_an_uploaded_photo_is_read_from_its_run(tab2_service):
    st, item = _get(tab2_service, {"id": "item:1a2b3c4d-e1-coat"})
    assert st == 200 and item["source"] == {
        "kind": "tab 2 photo",
        "title": "01.jpeg",
        "doc_id": None,
    }
    assert _bytes_of(item) == JPEG and item["photo"]["content_type"] == "image/jpeg"
    _, look = _get(tab2_service, {"id": "look:1a2b3c4d"})
    assert _bytes_of(look) == JPEG
    # uploads expire after a day: the preview says so instead of failing
    tab2_service.blobs.delete(UPLOAD)
    _, item = _get(tab2_service, {"id": "item:1a2b3c4d-e1-coat"})
    assert item["photo"] is None and "expired" in item["photo_note"]


def test_an_example_photo_is_read_from_the_domain(tab2_service):
    st, item = _get(tab2_service, {"id": "item:5e6f7a8b-e1-coat", "domain": "fashion"})
    assert st == 200 and _bytes_of(item) == EXAMPLE_BYTES
    assert item["source"] == {"kind": "example photo", "title": EXAMPLE, "doc_id": None}


def test_a_stored_photo_of_the_brand_is_read_by_its_key():
    look = Node("look:x", ["Look"], {"image_key": "whimsikora/looks/fashion_1.jpg"})
    p = previews.source_of(
        look, MemoryBlobStore(), lambda f: (b"", ""), stored_photo=lambda k: (JPEG, "image/jpeg")
    )
    assert _bytes_of(p) == JPEG
    assert p["source"] == {"kind": "lookbook photo", "title": "fashion_1.jpg", "doc_id": None}


def test_a_statement_shows_its_text_and_a_node_without_a_photo_what_the_graph_holds(
    tab2_service,
):
    st, statement = _get(tab2_service, {"id": "st:9f8e7d6c-1"})
    assert st == 200 and statement["photo"] is None
    assert statement["quote"] == "Wear the trench open." == statement["description"]
    _, boots = _get(tab2_service, {"id": "item:lb-ankle-boots-0edacddc"})
    assert (boots["photo"], boots["photo_note"]) == (None, "")
    assert boots["description"] == "Cognac-tan ankle boots." and boots["source"]["kind"] == "graph"


def test_a_photo_that_is_not_stored_or_too_large_is_named_not_sent(tab2_service, monkeypatch):
    st, look = _get(tab2_service, {"id": "look:lb-business-casual"})
    assert st == 200 and look["photo"] is None
    assert look["photo_note"] == "its photo is not stored in this deployment"
    # an example key outside the domain's listing reads nothing
    bad = Node("item:x", ["Item"], {"image_key": "example:../../secret.jpg"})
    p = previews.source_of(
        bad, tab2_service.blobs, lambda f: tab2_service.example_image("fashion", f)
    )
    assert p["photo"] is None and "not among the domain's example photos" in p["photo_note"]
    monkeypatch.setattr(previews, "MAX_PHOTO_BYTES", 10)
    _, item = _get(tab2_service, {"id": "item:1a2b3c4d-e1-coat"})
    assert item["photo"] is None and item["photo_note"].startswith("its photo is too large")


def test_an_upload_key_can_only_name_a_photo_of_a_run(tab2_service):
    """The key comes from the graph; only uploads/<run>/<nn>.<image> is ever read."""
    tab2_service.blobs.put_bytes("secrets/key.jpeg", b"secret", "image/jpeg")
    for key in ("upload:secrets/key.jpeg", f"upload:uploads/{RUN}/../../secrets/key.jpeg", f"upload:uploads/{RUN}/01.txt"):  # fmt: skip
        p = previews.source_of(Node("item:x", ["Item"], {"image_key": key}), tab2_service.blobs, lambda f: (b"", ""))  # fmt: skip
        assert p["photo"] is None and p["source"]["kind"] == "graph", key


def test_the_route_checks_its_input(loaded_service):
    assert _get(loaded_service, {})[0] == 400
    assert _get(loaded_service, {"id": "item:../x/y"}) == (
        400,
        {"error": "id must be a graph node id"},
    )
    st, body = _get(loaded_service, {"id": "item:atlas-trench", "domain": "../fashion"})
    assert (st, body) == (400, {"error": "domain must be an ontology folder id"})
    assert _get(loaded_service, {"id": "item:nothing-like-it"})[0] == 404
    assert _get(loaded_service, {"id": "item:atlas-trench", "domain": "no-such-domain"})[0] == 404
    assert _get(loaded_service, {"id": "item:atlas-trench", "domain": "fashion"})[0] == 200


# --- a category, an attribute value or a line: where it was seen (previews.origins_of)


def test_the_trees_nodes_come_first(loaded_service):
    _, plain = _get(loaded_service, {"id": "line:atlas"})
    seen_in = [m for _, m in loaded_service.store.neighbors("line:atlas", direction="in")]
    last = max(seen_in, key=lambda m: (m.name.lower(), m.id)).id  # shown last without near
    assert last not in [o["id"] for o in plain["origins"]]
    _, near = _get(loaded_service, {"id": "line:atlas", "near": f"look:nothing,{last}"})
    assert near["origins"][0]["id"] == last and near["origins"][0]["via"][0]["edge"] == "FROM_LINE"


def test_nodes_of_one_photo_share_its_preview_and_photos_share_the_budget(
    tab2_service, monkeypatch
):
    store = tab2_service.store
    second = f"uploads/{RUN}/02.jpeg"
    store.merge_nodes(
        "Item",
        [
            {
                "id": "item:1a2b3c4d-e2-belt",
                "props": {"name": "brown belt", "image_key": f"upload:{UPLOAD}", "run": "r"},
            },
            {
                "id": "item:9a8b7c6d-e1-coat",
                "props": {"name": "navy coat", "image_key": f"upload:{second}", "run": "r"},
            },
        ],
    )
    tab2_service.blobs.put_bytes(second, JPEG, "image/jpeg")
    store.merge_nodes("Attribute", [{"id": "attribute:color:beige", "props": {"name": "beige"}}])
    rows = [{"source": i, "target": "attribute:color:beige", "props": {"family": "color"}} for i in ("item:1a2b3c4d-e1-coat", "item:1a2b3c4d-e2-belt", "item:9a8b7c6d-e1-coat")]  # fmt: skip
    store.merge_edges("HAS_ATTRIBUTE", rows)
    store.merge_edges(
        "ILLUSTRATES", [{"source": "st:9f8e7d6c-1", "target": "item:1a2b3c4d-e1-coat"}]
    )

    st, p = _get(tab2_service, {"id": "attribute:color:beige"})
    assert st == 200 and p["origins_total"] == 3
    photo, other, text = p["origins"]
    # the coat and the belt were seen in the same photo: one preview naming both
    assert photo["source"]["title"] == "01.jpeg" and _bytes_of(photo) == JPEG
    assert [v["name"] for v in photo["via"]] == ["beige trench coat", "brown belt"]
    assert other["source"]["title"] == "02.jpeg" and _bytes_of(other) == JPEG
    assert text["label"] == "Statement" and text["quote"] == "Wear the trench open."
    assert text["via"] == [
        {"id": "item:1a2b3c4d-e1-coat", "label": "Item", "name": "beige trench coat", "edge": "ILLUSTRATES"}
    ]  # fmt: skip

    # one response carries at most MAX_PHOTO_BYTES of photos: a photo over what is left is named
    monkeypatch.setattr(previews, "MAX_PHOTO_BYTES", len(JPEG) + 10)
    _, p = _get(tab2_service, {"id": "attribute:color:beige"})
    assert p["origins"][0]["photo"] and p["origins"][1]["photo"] is None
    assert p["origins"][1]["photo_note"].startswith("its photo is left out")


def test_a_node_with_a_source_of_its_own_has_no_origins(loaded_service):
    _, item = _get(loaded_service, {"id": "item:atlas-field-jacket"})
    assert "origins" not in item
    _, part = _get(loaded_service, {"id": "category:pocket"})  # a part no catalog item names
    assert (part["origins"], part["origins_total"]) == ([], 0)


def test_near_is_checked(loaded_service):
    too_many = ",".join(f"item:x{i}" for i in range(previews.MAX_NEAR + 1))
    assert _get(loaded_service, {"id": "category:coat", "near": too_many})[0] == 400
    st, body = _get(loaded_service, {"id": "category:coat", "near": "item:a,../../x"})
    assert st == 400 and body["error"].startswith("near must be")


def test_an_item_seen_in_an_example_text_has_no_photo_to_miss(tab2_service):
    node = Node("item:9f8e7d6c-e1-belt", ["Item"], {"image_key": "example:02-sheath-dress-post.md"})
    p = previews.source_of(
        node, tab2_service.blobs, lambda f: tab2_service.example_image("fashion", f)
    )
    assert (p["photo"], p["photo_note"]) == (None, "") and p["source"]["kind"] == "graph"
