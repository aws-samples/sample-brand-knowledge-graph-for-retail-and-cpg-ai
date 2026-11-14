# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""S3-backed ontology catalog, the log buffer and the architecture routes."""

from __future__ import annotations

import logging
import shutil
import time

import pytest
from conftest import ONTOLOGIES
from fakes import TEST_MODEL

from ontology_rag import telemetry
from ontology_rag.api import dispatch
from ontology_rag.ontologies import OntologyCatalog, S3Sync


# ---------------------------------------------------------------------- fake S3
class FakeS3:
    """Just enough of boto3's S3 client for S3Sync: list (paginated) + download."""

    def __init__(self, objects: dict[str, bytes]):
        self.objects = dict(objects)
        self.downloads: list[str] = []

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        s3 = self

        class P:
            def paginate(self, Bucket, Prefix):
                items = sorted(k for k in s3.objects if k.startswith(Prefix))
                for i in range(0, len(items), 3):  # several pages
                    yield {
                        "Contents": [
                            {
                                "Key": k,
                                "ETag": f'"{hash(s3.objects[k]) & 0xFFFF:x}"',
                                "Size": len(s3.objects[k]),
                            }
                            for k in items[i : i + 3]
                        ]
                    }

        return P()

    def download_file(self, Bucket, Key, Filename):
        self.downloads.append(Key)
        with open(Filename, "wb") as fh:
            fh.write(self.objects[Key])


def _fashion_objects(prefix="ontologies/") -> dict[str, bytes]:
    out = {}
    for p in (ONTOLOGIES / "fashion").rglob("*"):
        if p.is_file() and p.suffix != ".py":
            out[prefix + p.relative_to(ONTOLOGIES).as_posix()] = p.read_bytes()
    out[prefix + "fashion/"] = b""  # folder marker objects are ignored
    return out


def test_s3_sync_mirrors_prefix_and_tracks_changes(tmp_path):
    fake = FakeS3(_fashion_objects())
    sync = S3Sync("demo-bucket", "ontologies", tmp_path / "cache", client=fake, ttl=60)
    changed = sync.sync()
    assert changed == {"fashion"}
    assert (tmp_path / "cache" / "fashion" / "fashion.ttl").exists()
    assert (tmp_path / "cache" / "fashion" / "examples" / "images" / "manifest.json").exists()
    assert (tmp_path / "cache" / "fashion" / "examples" / "articles" / "manifest.json").exists()
    assert (tmp_path / "cache" / "fashion" / "domain.json").exists()
    n = len(fake.downloads)
    assert sync.sync() == set() and len(fake.downloads) == n  # within ttl: no listing at all
    assert sync.sync(force=True) == set() and len(fake.downloads) == n  # unchanged ETags
    fake.objects["ontologies/fashion/README.md"] = b"# changed"
    fake.objects["ontologies/mini/mini.ttl"] = b"@prefix : <http://x/> ."
    assert sync.sync(force=True) == {"fashion", "mini"}
    assert (tmp_path / "cache" / "mini" / "mini.ttl").read_bytes() == b"@prefix : <http://x/> ."
    del fake.objects["ontologies/mini/mini.ttl"]
    assert sync.sync(force=True) == {"mini"}
    assert not (tmp_path / "cache" / "mini").exists()
    loc = sync.location()
    assert loc["kind"] == "s3" and loc["uri"] == "s3://demo-bucket/ontologies/" and loc["synced_at"]


def test_catalog_serves_from_s3_cache_and_falls_back(tmp_path):
    fake = FakeS3(_fashion_objects())
    sync = S3Sync("demo-bucket", "ontologies/", tmp_path / "cache", client=fake)
    cat = OntologyCatalog(ONTOLOGIES, source=sync)
    entries = cat.entries()
    assert [e.id for e in entries] == ["fashion"]
    assert entries[0].path == tmp_path / "cache" / "fashion" / "fashion.ttl"
    assert len(entries[0].examples()) == 8 and len(entries[0].articles()) == 6
    # the sets' READMEs and domain.json, not their data, and never the photos under media/<sub>/
    assert entries[0].data_sets() == ["velloway", "whimsikora"]
    sets = tmp_path / "cache" / "fashion" / "datasets"
    assert not (sets / "velloway" / "items.json").exists()
    assert not (sets / "whimsikora" / "items.json").exists()
    assert not any((sets / "whimsikora").rglob("*.jpg"))
    assert cat.view("fashion").stats["classes"] == 83  # 1.2.0 adds fo:Occasion
    assert cat.location()["serving"] == str(tmp_path / "cache")

    # bucket becomes unreachable: keep serving the synced copy
    def boom(*a, **k):
        raise RuntimeError("AccessDenied")

    fake.get_paginator = boom
    cat.refresh(force=True)
    assert cat.source.error and cat.root == tmp_path / "cache"
    assert [e.id for e in cat.entries()] == ["fashion"]

    # never synced at all (fresh container, S3 down): fall back to the bundled folder
    shutil.rmtree(tmp_path / "cache")
    cat2 = OntologyCatalog(
        ONTOLOGIES, source=S3Sync("b", "ontologies/", tmp_path / "c2", client=fake)
    )
    ids = [e.id for e in cat2.entries()]
    assert ids == ["beauty", "fashion", "food", "home"] and cat2.root == ONTOLOGIES
    assert "AccessDenied" in cat2.location()["error"]


# ---------------------------------------------------------------------- telemetry
def test_ring_buffer_tags_records_with_request_id():
    telemetry.install()
    token = telemetry.request_id_var.set("req-1")
    logging.getLogger("t").info("hello %s", "world")
    telemetry.request_id_var.reset(token)
    logging.getLogger("t").info("other")
    mine = telemetry.buffered_events("req-1")
    assert mine and mine[-1]["message"].endswith("hello world") and mine[-1]["level"] == "INFO"
    assert all(e["request_id"] == "req-1" for e in mine)


def test_parse_report_and_console_links():
    events = [
        {"ts": 1, "message": "START RequestId: abc Version: $LATEST"},
        {
            "ts": 2,
            "message": "REPORT RequestId: abc\tDuration: 1234.56 ms\tBilled Duration: 1235 ms\t"
            "Memory Size: 1024 MB\tMax Memory Used: 151 MB\tInit Duration: 812.30 ms\t",
        },
    ]
    r = telemetry.parse_report(events)
    assert r == {
        "duration_ms": 1234.56,
        "billed_ms": 1235,
        "memory_mb": 1024,
        "max_memory_used_mb": 151,
        "init_ms": 812.3,
    }
    assert telemetry.parse_report(events[:1]) is None
    links = telemetry.console_links(
        "eu-central-1", "my-fn", "/aws/lambda/my-fn", "my-bucket", "ontologies/"
    )
    assert links["lambda"].endswith("#/functions/my-fn?tab=code")
    assert links["log_group"].endswith("log-group/$252Faws$252Flambda$252Fmy-fn")
    assert links["s3_ontologies"] == (
        "https://s3.console.aws.amazon.com/s3/buckets/my-bucket?region=eu-central-1&prefix=ontologies%2F"
    )
    assert "{prefix}" in links["s3_prefix_template"] and "bedrock" in links["bedrock"]


def test_cloudwatch_events_pages_and_sorts():
    calls = []

    class FakeLogs:
        def filter_log_events(self, **kw):
            calls.append(kw)
            if "nextToken" not in kw:
                return {
                    "events": [{"timestamp": 5, "message": "second\n", "logStreamName": "s"}],
                    "nextToken": "t1",
                }
            return {"events": [{"timestamp": 1, "message": "first", "logStreamName": "s"}]}

    before = time.time()
    events = telemetry.cloudwatch_events("/aws/lambda/x", "abc-123", 50, "s", client=FakeLogs())
    assert [e["message"] for e in events] == ["first", "second"]
    assert calls[0]["filterPattern"] == '"abc-123"' and calls[0]["logStreamNames"] == ["s"]
    # the panel asks right after its call: a quarter of an hour of the log group, not two hours
    assert abs(calls[0]["startTime"] / 1000 - (before - 15 * 60)) < 5


# ---------------------------------------------------------------------- routes
def test_log_viewer_is_off_unless_explorer_logs_is_true(monkeypatch):
    """The log lines are not redacted: the route is opt-in (the stack's -c explorerLogs=true)."""
    from ontology_rag.config import Settings

    monkeypatch.delenv("EXPLORER_LOGS", raising=False)
    assert Settings().expose_logs is False
    monkeypatch.setenv("EXPLORER_LOGS", "true")
    assert Settings().expose_logs is True


@pytest.fixture
def logs_on(loaded_service, monkeypatch):
    from dataclasses import replace

    monkeypatch.setattr(
        loaded_service, "settings", replace(loaded_service.settings, expose_logs=True)
    )
    return loaded_service


def test_architecture_and_logs_routes(logs_on):
    loaded_service = logs_on
    st, arch = dispatch(loaded_service, "GET", "/api/explorer/architecture", {}, {})
    # the tests run outside Lambda: no function facts, and the handler is the one the stack deploys
    assert st == 200 and arch["deployed"] is False and arch["function"]["name"] is None
    assert arch["function"]["handler"] == "ontology_rag.lambda_handler.api_handler"
    assert arch["ontologies"]["kind"] == "local" and "offline" not in arch["models"]
    assert "bedrock" in arch["console"] and "lambda" not in arch["console"]
    assert arch["logs"] == {"enabled": True, "source": "memory"}

    inv = {"request_id": "11111111-2222-3333-4444-555555555555", "runtime": "local"}
    st, p = dispatch(
        loaded_service,
        "POST",
        "/api/vision/classify",
        {},
        {"ontology_id": "fashion", "example": "08-pinstripe-suit.jpg", "model_id": TEST_MODEL},
        invocation=inv,
    )
    assert st == 200 and p["invocation"]["request_id"] == inv["request_id"]
    assert p["invocation"]["handler_ms"] >= 0
    # other routes never carry the record
    st, p = dispatch(loaded_service, "GET", "/api/vision/models", {}, {}, invocation=inv)
    assert st == 200 and "invocation" not in p

    token = telemetry.request_id_var.set(inv["request_id"])
    logging.getLogger("ontology_rag.test").info("classify model=mock latency_ms=42")
    telemetry.request_id_var.reset(token)
    st, logs = dispatch(
        loaded_service, "GET", "/api/explorer/logs", {"request_id": inv["request_id"]}, {}
    )
    assert st == 200 and logs["source"] == "memory" and logs["pending"] is False
    assert any("classify model=mock" in e["message"] for e in logs["events"])


def test_logs_route_takes_only_a_request_uuid_and_a_lambda_stream_name(logs_on):
    """The request id is the log filter: a word ("unhandled") would match every line that
    carries it, for requests the caller never made."""
    loaded_service = logs_on
    uuid = "0f3a9c2e-1b4d-4e5f-8a6b-7c8d9e0f1a2b"
    for request_id in ("x", "unhandled", "Traceback", uuid.upper(), uuid + "0"):
        st, p = dispatch(
            loaded_service, "GET", "/api/explorer/logs", {"request_id": request_id}, {}
        )
        assert st == 400 and "UUID" in p["error"], request_id
    stream = "2026/10/11/[$LATEST]0123456789abcdef0123456789abcdef"
    # a function that logs to a log group the stack names: Lambda adds the function name
    named = "2026/11/12/MultimodalAiKnowledgeGraph-ApiFunctionCE271BD4-kRQlQPV5zTFY[$LATEST]652518bf22c9432680ac519721f0cc11"
    for ok in (stream, named):
        st, p = dispatch(
            loaded_service,
            "GET",
            "/api/explorer/logs",
            {"request_id": uuid, "log_stream": ok},
            {},
        )
        assert st == 200, ok
    for bad in (
        "s",
        "../other-group",
        stream + "x",
        stream.replace("$LATEST", "prod"),
        named.replace("-kRQ", "/kRQ"),
        named.replace("CE271", "CE 271"),
    ):
        st, p = dispatch(
            loaded_service, "GET", "/api/explorer/logs", {"request_id": uuid, "log_stream": bad}, {}
        )
        assert st == 400 and "log_stream" in p["error"], bad


def test_logs_route_can_be_disabled(loaded_service, monkeypatch):
    from dataclasses import replace

    monkeypatch.setattr(
        loaded_service, "settings", replace(loaded_service.settings, expose_logs=False)
    )
    st, p = dispatch(
        loaded_service,
        "GET",
        "/api/explorer/logs",
        {"request_id": "11111111-2222-3333-4444-555555555555"},
        {},
    )
    assert st == 404 and "disabled" in p["error"]
