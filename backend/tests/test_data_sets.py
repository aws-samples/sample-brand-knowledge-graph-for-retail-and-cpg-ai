# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""A domain's data sets (``ontologies/<id>/datasets/<set>/``, design A1): how they are found, how
their example photos and texts join the domain's lists, what the S3 mirror takes of them, how
the graph loader loads every set into one graph and the catalog index, and how a set's photos
are served. The tests run on a copy of the ontologies folder with the tiny set next to anycompany-apparel
(conftest.ontologies_with_tiny)."""

import base64
import io
import json
import logging
import shutil
from dataclasses import replace
from types import SimpleNamespace

import pytest
from conftest import TINY, ontologies_with_tiny, tiny_settings
from fakes import FakeBedrock, FakeS3Vectors

from ontology_rag import api, classify, payoff, pipeline
from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.ontologies import OntologyCatalog, S3Sync, parse_upload
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

DOMAIN_PHOTOS = 8  # the sample's fashion domain: 8 example photos, 12 pieces, 6 texts
DOMAIN_ARTICLES = 6


@pytest.fixture()
def tree(tmp_path):
    return ontologies_with_tiny(tmp_path)


def _entry(tree):
    return OntologyCatalog(tree).entry("fashion")


class _Bucket:
    """Just enough of boto3's S3 client: the paginated listing and the download S3Sync uses, and
    GetObject (classify.read_object), over a dict of keys."""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.downloads: list[str] = []
        self.reads: list[str] = []

    def get_paginator(self, name):
        bucket = self

        class Paginator:
            def paginate(self, Bucket, Prefix):
                keys = sorted(k for k in bucket.objects if k.startswith(Prefix))
                yield {
                    "Contents": [
                        {
                            "Key": k,
                            "ETag": str(hash(bucket.objects[k])),
                            "Size": len(bucket.objects[k]),
                        }
                        for k in keys
                    ]
                }

        return Paginator()

    def download_file(self, Bucket, Key, Filename):
        self.downloads.append(Key)
        with open(Filename, "wb") as fh:
            fh.write(self.objects[Key])

    def get_object(self, Bucket, Key):
        self.reads.append(Key)
        return {"Body": io.BytesIO(self.objects[Key])}


def _objects(tree, prefix="ontologies/") -> dict[str, bytes]:
    return {
        prefix + p.relative_to(tree).as_posix(): p.read_bytes()
        for p in tree.rglob("*")
        if p.is_file() and p.suffix != ".py"
    }


# ---------------------------------------------------------------------- discovery
def test_the_sets_are_the_safe_named_folders_with_a_readme(tree):
    sets = tree / "fashion" / "datasets"
    for name in ("aaa", "Bad Name", "_hidden", "no-readme"):
        (sets / name).mkdir()
        if name != "no-readme":
            (sets / name / "README.md").write_text("# a set\n")
    (sets / "loose.json").write_text("{}")
    cat = OntologyCatalog(tree)
    entry = cat.entry("fashion")
    assert entry.data_sets() == [
        "aaa",
        "anycompany-apparel",
        "anycompany-fashion-house",
        "tiny",
    ]  # sorted
    assert entry.set_dir("tiny") == sets / "tiny"
    assert cat.summary(entry)["data_sets"] == [
        "aaa",
        "anycompany-apparel",
        "anycompany-fashion-house",
        "tiny",
    ]
    assert parse_upload("@prefix : <http://x/> . <http://x/o> a <http://x/C> .")["data_sets"] == []


def test_a_domain_without_a_datasets_folder_has_no_sets(tmp_path):
    folder = tmp_path / "mini"
    folder.mkdir()
    (folder / "mini.ttl").write_text("@prefix : <http://x/> . <http://x/o> a <http://x/C> .")
    assert OntologyCatalog(tmp_path).entry("mini").data_sets() == []


def test_a_set_in_the_old_layout_lists_nothing(tree):
    """One layout: a set's photos and texts outside ``examples/`` are not examples, and the
    old ``sample/`` folder holds no data set."""
    tiny = tree / "fashion" / "datasets" / "tiny"
    shutil.copytree(tiny / "examples" / "images", tiny / "images")
    shutil.rmtree(tiny / "examples")
    old = tree / "fashion" / "sample" / "old"
    old.mkdir(parents=True)
    (old / "README.md").write_text("# an old set\n")
    entry = _entry(tree)
    assert entry.data_sets() == ["anycompany-apparel", "anycompany-fashion-house", "tiny"]
    assert len(entry.examples()) == DOMAIN_PHOTOS and len(entry.articles()) == DOMAIN_ARTICLES


# ---------------------------------------------------------------------- the example lists
def test_the_domains_examples_come_first_then_each_sets(tree):
    entry = _entry(tree)
    photos = entry.examples()
    assert len(photos) == DOMAIN_PHOTOS + 2
    assert all("data_set" not in p for p in photos[:DOMAIN_PHOTOS])
    h1, nw1 = photos[DOMAIN_PHOTOS:]
    assert (h1["file"], h1["data_set"], h1["batch"], h1["occasion"]) == (
        "h1.jpg",
        "tiny",
        "new-shoot",
        "dress",
    )
    assert (nw1["file"], nw1["batch"], nw1["origin"]) == (
        "nw1.jpg",
        "new-work",
        "From the Tiny studio's spring fittings",
    )
    assert nw1["title"] == "sage tailoring" and nw1["content_type"] == "image/jpeg"
    assert len(entry.items()) == 12  # the tiny set has no examples/items/ folder
    texts = entry.articles()
    assert len(texts) == DOMAIN_ARTICLES + 1 and texts[-1]["file"] == "a1.md"
    assert texts[-1]["data_set"] == "tiny" and texts[-1]["batch"] == "new-shoot"
    assert all("data_set" not in a for a in texts[:DOMAIN_ARTICLES])


def test_a_folder_lists_its_manifest_first_then_the_rest_by_name(tree):
    images = tree / "fashion" / "datasets" / "tiny" / "examples" / "images"
    shutil.copy(images / "h1.jpg", images / "a0.jpg")  # not in the manifest, first by name
    files = [e["file"] for e in _entry(tree).examples()[DOMAIN_PHOTOS:]]
    assert files == ["h1.jpg", "nw1.jpg", "a0.jpg"]


def test_a_set_file_named_like_a_listed_one_is_skipped_and_logged_once(tree, caplog):
    images = tree / "fashion" / "datasets" / "tiny" / "examples" / "images"
    (images / "01-trench-coat-sweater-dress.jpg").write_bytes(b"\xff\xd8 not the domain's photo")
    entry = _entry(tree)
    with caplog.at_level(logging.WARNING, logger="ontology_rag.ontologies"):
        listed = [e["file"] for e in entry.examples()]
        entry.examples()
    assert listed.count("01-trench-coat-sweater-dress.jpg") == 1
    path = entry.example_path("01-trench-coat-sweater-dress.jpg")
    # the domain's own photo
    assert path == tree / "fashion" / "examples" / "images" / "01-trench-coat-sweater-dress.jpg"
    skipped = [
        r for r in caplog.records if "01-trench-coat-sweater-dress.jpg is skipped" in r.getMessage()
    ]
    assert len(skipped) == 1


def test_a_set_file_resolves_and_an_unlisted_one_raises(tree):
    entry = _entry(tree)
    tiny = tree / "fashion" / "datasets" / "tiny"
    assert entry.example_path("h1.jpg") == tiny / "examples" / "images" / "h1.jpg"
    title, text = entry.article_text("a1.md")
    assert title == "The camel coat, two ways" and text.startswith("# The camel coat")
    for file, name in [
        ("l1.jpg", "images"),  # a look photo of media/looks/: the loader's, not an example
        ("looks/l1.jpg", "images"),
        ("../tiny/examples/images/h1.jpg", "images"),
        ("manifest.json", "images"),
        ("h1.jpg", "items"),  # an example photo is not a piece
    ]:
        with pytest.raises(FileNotFoundError):
            entry.example_path(file, name)
    for file in ("README.md", "manifest.json", "../a1.md", "graph.json"):
        with pytest.raises(FileNotFoundError):
            entry.article_text(file)


def test_the_sets_lists_are_added_to_the_domains_without_duplicates(tree):
    """In set order (anycompany-apparel, then tiny), after the domain's own."""
    domain = _entry(tree).domain()
    own = json.loads((tree / "fashion" / "domain.json").read_text())
    apparel = json.loads(
        (tree / "fashion" / "datasets" / "anycompany-apparel" / "domain.json").read_text()
    )
    assert domain["example_questions"] == (
        own["example_questions"] + apparel["example_questions"] + ["What goes with the camel coat?"]
    )  # the tiny set's trench question is the domain's: once
    assert domain["photo_questions"] == own["photo_questions"] + apparel["photo_questions"]
    questions = [e["question"] for e in domain["query_examples"]]
    tiny = "Which looks of the brand Tiny are for a dress occasion?"
    assert questions == (
        [e["question"] for e in own["query_examples"]]
        + [e["question"] for e in apparel["query_examples"]]
        + [tiny]
    )
    assert domain["name"] == "Fashion"  # a set's other keys are not read
    # a worked example whose question is listed already is dropped, whatever its query
    tiny_domain = tree / "fashion" / "datasets" / "tiny" / "domain.json"
    tiny_domain.write_text(
        json.dumps({"query_examples": [{"question": questions[0], "cypher": "MATCH (n) RETURN n"}]})
    )
    again = _entry(tree).domain()["query_examples"]
    assert [e["question"] for e in again] == [q for q in questions if q != tiny]
    assert again[0]["cypher"] != "MATCH (n) RETURN n"


# ---------------------------------------------------------------------- reading a set's examples
def test_classify_reads_a_set_photo_at_its_place_in_the_bucket(tree):
    bucket = _Bucket(_objects(tree))
    svc = SimpleNamespace(
        settings=SimpleNamespace(ontologies_bucket="data-bucket", ontologies_prefix="ontologies/"),
        s3=bucket,
        catalog=OntologyCatalog(tree),
    )
    data, image_format = classify.load_image(svc, "fashion", "h1.jpg")
    assert bucket.reads == ["ontologies/fashion/datasets/tiny/examples/images/h1.jpg"]
    assert data == (TINY / "examples" / "images" / "h1.jpg").read_bytes() and image_format == "jpeg"
    classify.load_image(
        svc, "fashion", "01-trench-coat-sweater-dress.jpg"
    )  # the domain's own, as before
    assert bucket.reads[-1] == "ontologies/fashion/examples/images/01-trench-coat-sweater-dress.jpg"
    # a local run reads the same path below the local folder
    local = SimpleNamespace(
        settings=SimpleNamespace(ontologies_bucket="", ontologies_dir=tree),
        catalog=OntologyCatalog(tree),
    )
    assert (
        classify.load_image(local, "fashion", "nw1.jpg")[0]
        == (TINY / "examples" / "images" / "nw1.jpg").read_bytes()
    )


def test_the_pipeline_reads_a_set_photo_and_text(tree):
    svc = SimpleNamespace(catalog=OntologyCatalog(tree))
    run = {"ontology_id": "fashion"}
    photo, meta = pipeline.load_source(svc, run, {"kind": "image", "example": "h1.jpg"})
    assert photo == (TINY / "examples" / "images" / "h1.jpg").read_bytes()
    assert meta["occasion"] == "dress" and meta["name"] == "h1.jpg"
    text, meta = pipeline.load_source(svc, run, {"kind": "text", "example": "a1.md"})
    assert text.startswith("# The camel coat") and meta["source"] == "Tiny Journal"
    paired = svc.catalog.entry("fashion").example_path(meta["pairs_with_image"])
    assert paired == tree / "fashion" / "datasets" / "tiny" / "examples" / "images" / "h1.jpg"


# ---------------------------------------------------------------------- the mirror (S3Sync)
def test_the_mirror_leaves_out_set_data_and_media(tree, tmp_path):
    bucket = _Bucket(_objects(tree))
    cache = tmp_path / "cache"
    S3Sync("data-bucket", "ontologies/", cache, client=bucket).sync()
    tiny = cache / "fashion" / "datasets" / "tiny"
    for kept in (
        "README.md",
        "domain.json",
        "examples/images/h1.jpg",
        "examples/images/manifest.json",
        "examples/articles/a1.md",
    ):
        assert (tiny / kept).is_file(), kept
    for left_out in ("graph.json", "vectors.json", "catalog.json", "media/looks/l1.jpg"):
        assert not (tiny / left_out).exists(), left_out
    assert (cache / "fashion" / "datasets" / "README.md").is_file()  # not a set's file
    assert not (cache / "fashion" / "datasets" / "anycompany-apparel" / "items.json").exists()
    assert (
        cache / "fashion" / "examples" / "images" / "01-trench-coat-sweater-dress.jpg"
    ).is_file()
    assert not any("/looks/" in k or k.endswith("graph.json") for k in bucket.downloads)

    loader_cache = tmp_path / "loader"
    loader = S3Sync(
        "data-bucket", "ontologies/", loader_cache, client=bucket, include_set_data=True
    )
    loader.sync()
    tiny = loader_cache / "fashion" / "datasets" / "tiny"
    for kept in (
        "graph.json",
        "vectors.json",
        "catalog.json",
        "README.md",
        "examples/images/h1.jpg",
    ):
        assert (tiny / kept).is_file(), kept
    assert not (tiny / "media" / "looks" / "l1.jpg").exists()  # never the media
    assert (loader_cache / "fashion" / "datasets" / "anycompany-apparel" / "items.json").is_file()


def test_a_skipped_key_counts_as_absent(tree, tmp_path):
    bucket = _Bucket(_objects(tree))
    sync = S3Sync("data-bucket", "ontologies/", tmp_path / "cache", client=bucket)
    assert sync.sync() == {"beauty", "fashion", "food", "home"}  # the first sync takes every domain
    tiny = "ontologies/fashion/datasets/tiny/"
    bucket.objects[tiny + "graph.json"] = b"{}"  # a set's data changed
    bucket.objects[tiny + "media/looks/l9.jpg"] = b"\xff\xd8"
    assert sync.sync(force=True) == set()  # nothing the mirror takes changed
    del bucket.objects[tiny + "vectors.json"]
    assert sync.sync(force=True) == set()
    del bucket.objects[tiny + "examples/images/h1.jpg"]  # an example went
    assert sync.sync(force=True) == {"fashion"}
    cached = tmp_path / "cache" / "fashion" / "datasets" / "tiny" / "examples" / "images" / "h1.jpg"
    assert not cached.exists()


@pytest.mark.parametrize(
    "rel,plain,loader",
    [
        ("fashion/fashion.ttl", True, True),
        ("fashion/examples/images/01-x.jpg", True, True),
        ("fashion/datasets/README.md", True, True),
        ("fashion/datasets/tiny/README.md", True, True),
        ("fashion/datasets/tiny/domain.json", True, True),
        ("fashion/datasets/tiny/examples/images/h1.jpg", True, True),
        ("fashion/datasets/tiny/examples/images/manifest.json", True, True),
        ("fashion/datasets/tiny/examples/items/p.jpg", True, True),
        ("fashion/datasets/tiny/examples/articles/a1.md", True, True),
        ("fashion/datasets/tiny/graph.json", False, True),
        ("fashion/datasets/tiny/holdouts.json", False, True),
        ("fashion/datasets/anycompany-apparel/items.json", False, True),
        ("fashion/datasets/tiny/media/looks/l1.jpg", False, False),
        ("fashion/datasets/tiny/media/products/p1.jpg", False, False),
        ("fashion/datasets/tiny/examples/README.md", False, False),
        ("fashion/datasets/tiny/examples/images/looks/l1.jpg", False, False),
        ("fashion/datasets/tiny/examples/other/x.jpg", False, False),
        ("fashion/datasets/tiny/images/h1.jpg", False, False),  # the old layout: not an example
        ("fashion/datasets/tiny/notes.txt", False, False),
        ("fashion/datasets/tiny/other/x.json", False, False),
    ],
)
def test_the_mirrors_rule_for_a_key(rel, plain, loader, tmp_path):
    assert S3Sync("b", "ontologies/", tmp_path).keeps(rel) is plain
    assert S3Sync("b", "ontologies/", tmp_path, include_set_data=True).keeps(rel) is loader


# ---------------------------------------------------------------------- loading every set
def test_every_set_of_the_domain_is_loaded_into_one_graph(tiny_service):
    svc = tiny_service
    out = svc.load_sample(reset=True)
    assert set(out) == {"ontology", "sets", "seconds"}
    assert list(out["sets"]) == ["anycompany-apparel", "anycompany-fashion-house", "tiny"]
    assert out["ontology"]["Category"] == 50
    assert out["sets"]["tiny"] == {
        "Brand": 1,
        "Occasion": 1,
        "Look": 2,
        "Item": 3,
        "vectors": 5,
        "catalog": 1,
    }
    apparel = out["sets"]["anycompany-apparel"]
    assert apparel["Item"] == 55 and apparel["Look"] == 19 and apparel["catalog"] == 55
    nodes = svc.store.summary()["nodes"]
    # the ontology's 9 occasions; the tiny set's Dress is one of them (the same id)
    assert nodes["Brand"] == 3 and nodes["Look"] == 2 + 19 + 1 and nodes["Occasion"] == 9
    assert payoff._brand(svc) == "AnyCompany Apparel, AnyCompany Fashion House and Tiny"
    # the catalog index holds the products of both formats
    rows = svc.s3vectors.vectors
    assert rows["tiny-p1"]["metadata"]["image_key"] == "tiny/products/p1.jpg"  # as exported
    trench = rows["utility-trench"]["metadata"]
    assert trench["image_key"] == "" and trench["type"] == "coat" and trench["category"]
    assert trench["name"] == payoff.catalog_name(
        {"color": "stone", "material": "cotton gabardine", "type": "coat"}
    )
    assert len(rows["utility-trench"]["data"]["float32"]) == 8  # embedded from its text


def test_every_look_of_every_format_is_for_an_occasion_of_the_ontology(tiny_service):
    """The deploy writes the ontology's 9 occasions; a catalog set's looks link to them by their
    occasion text (AnyCompany Apparel's "evening / formal" is Evening), a DNA set's by its own FOR edges
    (tiny's Dress). One look of AnyCompany Apparel is for "cold weather": no occasion, reported."""
    svc = tiny_service
    out = svc.load_sample(reset=True)
    assert out["ontology"]["Occasion"] == 9
    assert out["sets"]["anycompany-apparel"]["unresolved"] == [
        {"look": "look:utility-cold-snap", "text": "cold weather"}
    ]
    assert out["sets"]["anycompany-fashion-house"]["unresolved"] == []
    looks_for: dict[str, int] = {}
    for occasion in svc.store.get_nodes("Occasion", 50):
        n = sum(1 for e, _ in svc.store.neighbors(occasion.id, ["FOR"], "in"))
        if n:
            looks_for[occasion.props["name"]] = n
    assert looks_for == {
        "Evening": 6,
        "Resort": 5,
        "Casual": 3,
        "Outdoor": 2,
        "Professional": 2,  # AnyCompany Apparel's "business / smart" and the excerpt's look
        "Smart casual": 1,
        "Dress": 2,  # tiny's two looks
    }
    # one FOR per look; the catalog look keeps its own words
    assert svc.store.summary()["edges"]["FOR"] == 21
    evening = svc.store.get_node("look:evening-black-tie")
    assert evening.props["occasion"] == "evening / formal"


def test_a_set_without_data_is_reported_skipped(tiny_service):
    empty = tiny_service.catalog.root / "fashion" / "datasets" / "empty"
    empty.mkdir()
    (empty / "README.md").write_text("# no data yet\n")
    out = tiny_service.load_sample()
    assert out["sets"]["empty"] == {"skipped": "no graph.json or items.json"}
    assert list(out["sets"]) == ["anycompany-apparel", "anycompany-fashion-house", "empty", "tiny"]


def test_without_a_vector_bucket_the_sets_load_into_the_graph_only(settings, tmp_path):
    svc = Service(
        replace(tiny_settings(settings, ontologies_with_tiny(tmp_path)), vector_bucket=""),
        store=InMemoryStore(),
        embedder=MockEmbedder(8),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
    )
    assert svc.s3vectors is None
    out = svc.load_sample(reset=True)
    assert (
        "catalog" not in out["sets"]["tiny"] and "catalog" not in out["sets"]["anycompany-apparel"]
    )


def test_the_deployed_loader_reads_the_sets_from_its_mirror(settings, tmp_path):
    """MIRROR_SAMPLE_DATA (the graph loader): the mirror is refreshed and takes the sets' data;
    a mirror that cannot be read fails the load instead of loading the graph without them."""
    tree = ontologies_with_tiny(tmp_path / "bucket")
    s = replace(tiny_settings(settings, tree), mirror_set_data=True)
    svc = Service(
        s,
        store=InMemoryStore(),
        embedder=MockEmbedder(8),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    with pytest.raises(RuntimeError, match="ONTOLOGIES_BUCKET"):
        svc.load_sample()  # no bucket at all: no data sets

    bucket = _Bucket(_objects(tree))
    bundled = tmp_path / "bundled"  # what the Lambda zip carries: no set data
    shutil.copytree(tree, bundled, ignore=shutil.ignore_patterns("graph.json", "vectors.json"))
    sync = S3Sync(
        "data-bucket", "ontologies/", tmp_path / "cache", client=bucket, include_set_data=True
    )
    svc.catalog = OntologyCatalog(bundled, source=sync)
    out = svc.load_sample(reset=True)
    assert out["sets"]["tiny"]["Look"] == 2 and out["sets"]["tiny"]["vectors"] == 5
    assert svc.catalog.root == tmp_path / "cache"

    class Down:
        def get_paginator(self, name):
            raise RuntimeError("AccessDenied")

    svc.catalog = OntologyCatalog(
        bundled,
        source=S3Sync(
            "data-bucket", "ontologies/", tmp_path / "c2", client=Down(), include_set_data=True
        ),
    )
    with pytest.raises(RuntimeError, match="bucket data-bucket .*AccessDenied"):
        svc.load_sample()


def test_the_service_mirror_takes_set_data_only_on_the_loader(settings):
    s = replace(settings, ontologies_bucket="data-bucket")
    fakes = {"s3": object(), "blobs": MemoryBlobStore(), "s3vectors": FakeS3Vectors()}
    plain = Service(s, store=InMemoryStore(), embedder=MockEmbedder(8), **fakes)
    loader = Service(
        replace(s, mirror_set_data=True),
        store=InMemoryStore(),
        embedder=MockEmbedder(8),
        **fakes,
    )
    assert plain.catalog.source.include_set_data is False
    assert loader.catalog.source.include_set_data is True


# ---------------------------------------------------------------------- a set's stored photos
def test_a_stored_photo_comes_from_the_bucket_else_the_local_folder(tiny_service):
    svc = tiny_service
    local = (TINY / "media" / "looks" / "l1.jpg").read_bytes()
    assert svc.stored_photo("tiny/looks/l1.jpg") == (local, "image/jpeg")  # the local folder
    with pytest.raises(FileNotFoundError):
        svc.stored_photo("tiny/looks/l2.jpg")  # graph.json names it, the fixture leaves it out
    assert dispatch(svc, "GET", "/api/photo", {"key": "tiny/looks/l2.jpg"}, {})[0] == 404
    svc.blobs.put_bytes(
        "ontologies/fashion/datasets/tiny/media/looks/l2.jpg", b"\xff\xd8 l2", "image/jpeg"
    )
    assert svc.stored_photo("tiny/looks/l2.jpg") == (b"\xff\xd8 l2", "image/jpeg")  # the bucket
    with pytest.raises(ValueError):
        svc.stored_photo("tiny/media/looks/l1.jpg")  # four segments: not a key


# ---------------------------------------------------------------------- the brands
@pytest.mark.parametrize(
    "names,phrase",
    [
        ([], "the brand"),
        (["AnyCompany Apparel"], "AnyCompany Apparel"),
        (
            ["AnyCompany Fashion House", "AnyCompany Apparel"],
            "AnyCompany Apparel and AnyCompany Fashion House",
        ),
        (
            ["AnyCompany Apparel", "Tiny", "AnyCompany Fashion House"],
            "AnyCompany Apparel, AnyCompany Fashion House and Tiny",
        ),
    ],
)
def test_the_brand_names_every_brand_node(names, phrase):
    store = InMemoryStore()
    if names:
        store.merge_nodes(
            "Brand", [{"id": f"brand:{n.lower()}", "props": {"name": n}} for n in names]
        )
    assert payoff._brand(SimpleNamespace(store=store)) == phrase


# ---------------------------------------------------------------------- tab 6's photo to check
def test_the_photo_to_check_is_a_listed_example_or_an_upload(tiny_service):
    svc = tiny_service
    nw1 = (TINY / "examples" / "images" / "nw1.jpg").read_bytes()
    assert api._check_photo(svc, {"ontology_id": "fashion", "example": "nw1.jpg"}) == (nw1, "jpeg")
    assert api._check_photo(svc, {"example": "nw1.jpg"}) == (nw1, "jpeg")  # the graph's domain
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 40
    upload = {"image_base64": base64.b64encode(png).decode(), "format": "png"}
    assert api._check_photo(svc, upload) == (png, "png")
    for bad, words in [
        ({"photo_key": "anycompany-fashion-house/new-work/a.jpg"}, "ontology_id and example"),
        ({"ontology_id": "../x", "example": "nw1.jpg"}, "ontology_id"),
        ({"ontology_id": "fashion", "example": "../images/nw1.jpg"}, "example"),
    ]:
        with pytest.raises(ValueError, match=words):
            api._check_photo(svc, bad)


def test_the_lens_routes_answer_404_for_an_unknown_domain_or_photo(tiny_service):
    for path, extra in (
        ("/api/lenses/check/looks", {}),
        ("/api/lenses/check/pieces", {"looks": [{"letter": "A"}]}),
    ):
        status, body = dispatch(
            tiny_service,
            "POST",
            path,
            {},
            {"ontology_id": "knitwear", "example": "nw1.jpg", **extra},
        )
        assert status == 404 and "knitwear" in body["error"], path
        status, body = dispatch(
            tiny_service, "POST", path, {}, {"ontology_id": "fashion", "example": "l1.jpg", **extra}
        )
        assert status == 404 and "l1.jpg" in body["error"], path


def test_the_summary_names_each_brand_with_its_brand_json_description(loaded_service):
    """Tab 0's "Meet the brand" reads the graph's Brand nodes: every set's brand with the
    description of its ``brand.json``, sorted by name."""
    sets = loaded_service.settings.ontologies_dir / "fashion" / "datasets"
    files = [
        json.loads((sets / s / "brand.json").read_text())
        for s in ("anycompany-apparel", "anycompany-fashion-house")
    ]
    expected = [{"name": raw["name"], "description": raw["description"]} for raw in files]
    status, summary = dispatch(loaded_service, "GET", "/api/summary", {}, {})
    assert status == 200 and summary["brands"] == expected
    assert [b["name"] for b in expected] == ["AnyCompany Apparel", "AnyCompany Fashion House"]
    assert all(b["description"] for b in expected) and summary["nodes"]["Brand"] == 2
