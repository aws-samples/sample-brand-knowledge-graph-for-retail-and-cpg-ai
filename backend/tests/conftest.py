# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import shutil
from dataclasses import replace
from pathlib import Path

import pytest
from fakes import FakeBedrock, FakeS3Vectors

from ontology_rag.config import Settings
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.ontology import load_ontology
from ontology_rag.pipeline import MemoryBlobStore
from ontology_rag.service import Service

REPO = Path(__file__).resolve().parents[2]
ONTOLOGIES = REPO / "ontologies"
ONTOLOGY = ONTOLOGIES / "fashion" / "fashion.ttl"
APPAREL = (
    ONTOLOGIES / "fashion" / "datasets" / "anycompany-apparel"
)  # the sample's own data set (synth.py)
# A second data set of the fashion domain, small enough to read (fixtures/sets/tiny/README.md).
TINY = Path(__file__).resolve().parent / "fixtures" / "sets" / "tiny"


def ontologies_with_tiny(root: Path) -> Path:
    """A copy of the repository's ``ontologies/`` folder under ``root`` with the tiny data set
    as ``fashion/datasets/tiny/``, next to anycompany-apparel; the copy's path."""
    out = root / "ontologies"
    shutil.copytree(ONTOLOGIES, out, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(TINY, out / "fashion" / "datasets" / "tiny")
    return out


def tiny_settings(settings, ontologies: Path):
    """The test settings on such a copy, with the tiny set's vector dimension (8)."""
    return replace(
        settings,
        ontologies_dir=ontologies,
        ontology_path=ontologies / "fashion" / "fashion.ttl",
        embedding_dimension=8,
    )


@pytest.fixture(scope="session")
def ontology():
    return load_ontology(ONTOLOGY)


@pytest.fixture(scope="session")
def settings(tmp_path_factory):
    # local_data_dir, the graph, the vector index, the table bucket and the agents' runtimes are
    # set explicitly: the tests never touch data/local or a real Neptune graph / S3 Vectors index /
    # table bucket / AgentCore Runtime. The API holds no sign-in setting: IAM decides at the
    # function URL who may call it (test_no_token_code.py).
    return Settings(
        graph_backend="memory",
        graph_id="",
        embedder="mock",
        ontologies_dir=ONTOLOGIES,
        ontology_path=ONTOLOGY,
        local_data_dir=tmp_path_factory.mktemp("local"),
        embedding_dimension=256,
        allow_write_queries=False,
        vector_bucket="test-vectors",
        agent_runtime_arn="",
        table_bucket_arn="",
        lake_runtime_arn="",
    )


@pytest.fixture(scope="session")
def loaded_service(settings):
    """One fully loaded in-memory graph for the whole test session (loading is deterministic).
    Bedrock and S3 Vectors are the fakes from ``fakes.py``: requests are built for real, only
    the calls are faked."""
    svc = Service(
        settings,
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    svc.load_sample(reset=True)
    return svc


@pytest.fixture()
def tiny_service(settings, tmp_path):
    """A service on a copy of the ontologies folder with two data sets of the fashion domain
    (anycompany-apparel and tiny), both loaded into its in-memory graph; Bedrock and S3 Vectors are fakes."""
    svc = Service(
        tiny_settings(settings, ontologies_with_tiny(tmp_path)),
        store=InMemoryStore(),
        embedder=MockEmbedder(8),
        bedrock=FakeBedrock(),
        blobs=MemoryBlobStore(),
        s3vectors=FakeS3Vectors(),
    )
    svc.load_sample(reset=True)
    return svc
