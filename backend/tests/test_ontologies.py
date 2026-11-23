# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The browse-only ontologies next to fashion (``ontologies/beauty``, ``home``, ``food``): the API
lists and details them for tab 1 step 4, tab 0 never offers them, and the pipeline refuses to
ingest against them (``domain.json`` ``"browse_only": true``)."""

import json

import pytest
from conftest import ONTOLOGIES
from fakes import TEST_MODEL, FakeBedrock, FakeS3Vectors

from ontology_rag.api import dispatch
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.ontologies import OntologyCatalog
from ontology_rag.owl import local_name
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

BROWSE_ONLY = {
    "beauty": "Beauty and skincare",
    "home": "Home furnishings",
    "food": "Food and beverage",
}
POST = (
    "A navy double-breasted wool coat over straight high-waist jeans, a white crew-neck t-shirt "
    "and brown lace-up ankle boots; a gray herringbone scarf on top."
)


@pytest.mark.parametrize("oid", sorted(BROWSE_ONLY))
def test_each_aisle_is_a_folder_in_the_fashion_shape(oid):
    folder = ONTOLOGIES / oid
    assert (folder / f"{oid}.ttl").is_file() and (folder / "README.md").is_file()
    raw = json.loads((folder / "domain.json").read_text())
    assert raw["browse_only"] is True and raw["name"] == BROWSE_ONLY[oid]
    detail = OntologyCatalog(ONTOLOGIES).detail(oid)
    assert detail["domain"]["browse_only"] is True and detail["domain"]["name"] == BROWSE_ONLY[oid]
    assert detail["examples"] == 0 and detail["data_sets"] == []
    # the three words tab 1 step 4 starts with are names in the ontology's map
    names = {local_name(n["id"]) for n in detail["view"]["nodes"]}
    start = detail["domain"]["start_with"]
    assert len(start) == 3 and set(start) <= names, set(start) - names


def test_a_browse_only_ontology_is_never_ingested_against(settings):
    svc = Service(
        settings,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    body = {"model_id": TEST_MODEL, "sources": [{"kind": "text", "text": POST}]}
    for oid in sorted(BROWSE_ONLY):
        status, payload = dispatch(
            svc, "POST", "/api/pipeline/runs", {}, {**body, "ontology_id": oid}
        )
        assert status == 400, payload
        assert payload["error"] == f"{oid} is a browse-only ontology: it has no data to ingest"
    assert svc.blobs.list_keys("") == []  # refused before any upload or run input is written


def test_a_browse_only_ontology_cannot_be_the_graphs_domain(settings):
    from dataclasses import replace

    svc = Service(
        replace(settings, ontology_path=ONTOLOGIES / "beauty" / "beauty.ttl"),
        store=InMemoryStore(),
        embedder=MockEmbedder(settings.embedding_dimension),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    with pytest.raises(ValueError, match='beauty is browse-only: drop "browse_only"'):
        svc.load_sample()
    assert svc.store.summary()["nodes"] == {}  # refused before anything was written


def test_tab_1_renders_the_prompt_the_model_gets_with_the_whole_photo_section():
    prompt = OntologyCatalog(ONTOLOGIES).detail("fashion")["prompt"]
    assert "## The whole photo (name: allowed values)" in prompt
    assert "## The whole photo" not in OntologyCatalog(ONTOLOGIES).detail("beauty")["prompt"]


@pytest.mark.parametrize("oid", ["fashion", *sorted(BROWSE_ONLY)])
def test_the_catalog_serves_each_ontology_file_as_it_is_on_disk(oid):
    """``OntologyCatalog.file_text``: the whole document, not capped, with its name and format."""
    served = OntologyCatalog(ONTOLOGIES).file_text(oid)
    path = ONTOLOGIES / oid / f"{oid}.ttl"
    assert served == {"id": oid, "file": f"{oid}.ttl", "format": "ttl", "text": path.read_text()}
    assert "@prefix owl: <http://www.w3.org/2002/07/owl#> ." in served["text"]
    with pytest.raises(KeyError):
        OntologyCatalog(ONTOLOGIES).file_text("nope")
