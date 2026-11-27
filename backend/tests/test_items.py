# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 5's example pieces (``ontologies/fashion/examples/items/``): synthetic product photos of
single garments like those worn in the example photos (product shots of the AnyCompany Fashion House catalog),
listed by ``OntologyEntry.items`` and served by the examples routes with ``set=items``; tabs 1 and
2 keep the whole photos (the default set)."""

import json

import pytest
from conftest import ONTOLOGIES

from ontology_rag import vision
from ontology_rag.api import dispatch
from ontology_rag.ontologies import EXAMPLE_SETS, OntologyCatalog

FASHION = ONTOLOGIES / "fashion"
ITEMS = FASHION / "examples" / "items"
# The categories a customer asks about (outerwear, tops, bottoms, dresses, shoes, bags), as the
# graph names them; no garment parts and no small accessories.
PIECE_CATEGORIES = {
    "coat", "jacket", "cardigan", "sweater", "top", "shirt", "vest", "pants", "shorts", "skirt",
    "dress", "jumpsuit", "shoe", "bag",
}  # fmt: skip


def _manifest() -> list[dict]:
    return json.loads((ITEMS / "manifest.json").read_text())["items"]


def test_the_manifest_describes_every_piece_and_where_it_comes_from():
    items = _manifest()
    files = sorted(p.name for p in ITEMS.glob("*.jpg"))
    assert sorted(i["file"] for i in items) == files and 8 <= len(files) <= 12
    photos = {p.name for p in (FASHION / "examples" / "images").glob("*.jpg")}
    for item in items:
        assert {"file", "title", "category", "source", "product", "image_model_id"} <= set(item)
        # like a garment of an example photo, numbered after it
        assert item["source"] in photos and item["file"][:2] == item["source"][:2]
        assert item["category"] in PIECE_CATEGORIES and item["title"]
        # a product shot of the AnyCompany Fashion House catalog, made with Amazon Nova Canvas
        assert item["image_model_id"] == "amazon.nova-canvas-v1:0" and "AnyCompany Fashion House" in item["product"]
        # classified the way tab 3 decomposes a photo: one main garment of the expected class
        assert item["check"]["passed"] and item["check"]["model_id"]
        assert not any(int(a.rsplit(", ", 1)[1].rstrip("%)")) >= 30 for a in item["check"]["also"])
        # and inspected: no lettering, logo, person or obvious defect
        assert item["inspection"]["passed"]
    assert len({i["category"] for i in items}) >= 5  # spread across categories
    readme = (ITEMS / "README.md").read_text()
    assert "synthetic product photos" in readme.lower() and "same license" in readme


@pytest.mark.parametrize("item", _manifest(), ids=lambda i: i["file"])
def test_each_piece_is_a_small_jpeg(item):
    data = (ITEMS / item["file"]).read_bytes()
    width, height = vision.image_size(data)
    assert [width, height] == item["size"] and len(data) < 300_000
    assert max(width, height) <= 1024 and min(width, height) >= 512


def test_the_catalog_lists_the_pieces_apart_from_the_photos():
    entry = OntologyCatalog(ONTOLOGIES).entry("fashion")
    assert EXAMPLE_SETS == ("images", "items") and entry.items_dir == ITEMS
    pieces = entry.items()
    assert [p["file"] for p in pieces] == sorted(i["file"] for i in _manifest())
    coat = next(p for p in pieces if p["file"] == "01-trench-coat.jpg")
    assert coat["title"] == "trench coat" and coat["category"] == "coat"
    assert coat["source"] == "01-trench-coat-sweater-dress.jpg" and coat["content_type"] == "image/jpeg"
    assert entry.example_set("items") == pieces and entry.example_set() == entry.examples()
    assert len(entry.examples()) == 8  # the whole photos stay what tabs 1 and 2 get
    assert entry.example_path("01-trench-coat.jpg", "items") == ITEMS / "01-trench-coat.jpg"
    for file, name in [
        ("01-trench-coat.jpg", "images"),  # a piece is not a photo
        ("01-trench-coat-sweater-dress.jpg", "items"),  # nor the other way round
        ("../images/01-trench-coat-sweater-dress.jpg", "items"),
        ("manifest.json", "items"),
        ("README.md", "items"),
    ]:
        with pytest.raises(FileNotFoundError):
            entry.example_path(file, name)
    with pytest.raises(ValueError):
        entry.example_set("articles")


def test_a_folder_without_items_lists_none(tmp_path):
    folder = tmp_path / "mini"
    folder.mkdir()
    (folder / "mini.ttl").write_text("@prefix : <http://x/> . <http://x/o> a <http://x/C> .")
    assert OntologyCatalog(tmp_path).entry("mini").items() == []


def test_the_examples_routes_take_the_set(loaded_service):
    get = lambda path, q: dispatch(loaded_service, "GET", path, q, {})
    st, p = get("/api/ontologies/examples", {"id": "fashion", "set": "items"})
    assert st == 200 and p["set"] == "items" and len(p["examples"]) == len(_manifest())
    assert all(e["category"] and e["source"] for e in p["examples"])
    st, p = get("/api/ontologies/examples", {"id": "fashion"})  # the default: the whole photos
    assert st == 200 and p["set"] == "images" and len(p["examples"]) == 8
    st, p = get(
        "/api/ontologies/example-image",
        {"id": "fashion", "set": "items", "file": "04-white-sneakers.jpg"},
    )
    assert st == 200 and p["data_url"].startswith("data:image/jpeg;base64,")
    # validated like the id: another set is a 400, a file of the other set a 404
    for path in ("/api/ontologies/examples", "/api/ontologies/example-image"):
        q = {"id": "fashion", "set": "../articles", "file": "04-white-sneakers.jpg"}
        st, p = get(path, q)
        assert st == 400 and p["error"] == "set must be one of images, items"
    st, _ = get("/api/ontologies/example-image", {"id": "fashion", "file": "04-white-sneakers.jpg"})
    assert st == 404
    st, _ = get(
        "/api/ontologies/example-image",
        {"id": "fashion", "set": "items", "file": "04-biker-jacket-jeans-sneakers.jpg"},
    )
    assert st == 404
