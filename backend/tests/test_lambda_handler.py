# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The Lambda entry points: the API handler's invocation record, the graph loader's CloudFormation
protocol and watchdog, and the site deploy's copy."""

from __future__ import annotations

import base64
import json
import threading
from types import SimpleNamespace

import pytest
from fakes import TEST_MODEL

from ontology_rag import lambda_handler, telemetry


def _lambda_event(method, path, body=None, query=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method}},
        "queryStringParameters": query or {},
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
    }


# ---------------------------------------------------------------------- the API
def test_lambda_api_handler_wraps_dispatch(loaded_service, monkeypatch):
    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    resp = lambda_handler.api_handler(_lambda_event("GET", "/api/summary"), None)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["nodes"]["Item"] > 0
    resp = lambda_handler.api_handler(
        _lambda_event("POST", "/api/graph/explore", {"label": "Line"}), None
    )
    assert resp["statusCode"] == 200 and json.loads(resp["body"])["centers"]
    bad = _lambda_event("POST", "/api/ask")
    bad["body"], bad["isBase64Encoded"] = base64.b64encode(b"{not json").decode(), True
    assert lambda_handler.api_handler(bad, None)["statusCode"] == 400


def test_lambda_handler_answers_400_for_bodies_it_cannot_read(loaded_service, monkeypatch):
    """Bad base64, bytes that are not UTF-8 and JSON that is not an object are the caller's
    mistake (400), not an unhandled error (500)."""
    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    for body, encoded, error in [
        ("@@not base64@@", True, "body must be JSON"),
        (base64.b64encode(b"\xff\xfe{}").decode(), True, "body must be JSON"),
        ("[1, 2, 3]", False, "body must be a JSON object"),
        ('"a string"', False, "body must be a JSON object"),
    ]:
        event = _lambda_event("POST", "/api/ask")
        event["body"], event["isBase64Encoded"] = body, encoded
        resp = lambda_handler.api_handler(event, None)
        assert resp["statusCode"] == 400 and json.loads(resp["body"]) == {"error": error}, body


def test_lambda_handler_attaches_invocation_and_cold_start(loaded_service, monkeypatch):
    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    monkeypatch.setattr(lambda_handler, "_cold", True)
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "demo-fn")
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "1024")
    ctx = SimpleNamespace(
        aws_request_id="req-abc-123", log_group_name="/aws/lambda/demo-fn", log_stream_name="2026/x"
    )
    event = {
        "rawPath": "/api/vision/classify",
        "requestContext": {"http": {"method": "POST"}},
        "body": json.dumps(
            {"ontology_id": "fashion", "example": "08-pinstripe-suit.jpg", "model_id": TEST_MODEL}
        ),
    }
    first = json.loads(lambda_handler.api_handler(event, ctx)["body"])["invocation"]
    assert first["cold_start"] is True and first["function_name"] == "demo-fn"
    assert first["memory_mb"] == 1024 and first["log_stream"] == "2026/x"
    second = json.loads(lambda_handler.api_handler(event, ctx)["body"])["invocation"]
    assert second["cold_start"] is False and second["request_id"] == "req-abc-123"
    # the request's own log lines are in the ring buffer under its id
    assert any(
        f"classify model={TEST_MODEL}" in e["message"]
        for e in telemetry.buffered_events("req-abc-123")
    )


# ---------------------------------------------------------------------- the graph loader
class _Context:
    """A Lambda context with a clock: ``remaining`` milliseconds until the function timeout."""

    log_stream_name = "2026/10/11/[$LATEST]abc"

    def __init__(self, remaining: int = 900_000):
        self.remaining = remaining

    def get_remaining_time_in_millis(self) -> int:
        return self.remaining


_LOADER_EVENT = {
    "RequestType": "Update",
    "ResponseURL": "https://cloudformation-custom-resource-response.example/x",
    "StackId": "s",
    "RequestId": "r",
    "LogicalResourceId": "GraphLoader",
    "ResourceProperties": {"Reset": "false"},
}


def test_loader_custom_resource_protocol(loaded_service, monkeypatch):
    sent = {}

    def fake_urlopen(req, timeout=30):
        sent["url"] = req.full_url
        sent["body"] = json.loads(req.data)

        class R:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return R()

    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    monkeypatch.setattr(lambda_handler.urllib.request, "urlopen", fake_urlopen)
    lambda_handler.loader_handler(_LOADER_EVENT, _Context())
    assert sent["body"]["Status"] == "SUCCESS"
    loaded = json.loads(sent["body"]["Data"]["Loaded"])
    assert loaded["ontology"]["Category"] == 50 and loaded["sets"]["velloway"]["Item"] == 55
    # a result past CloudFormation's 4 KB for response data: node totals per set
    monkeypatch.setattr(lambda_handler, "LOADED_MAX_CHARS", 50)
    lambda_handler.loader_handler(_LOADER_EVENT, _Context())
    totals = json.loads(sent["body"]["Data"]["Loaded"])
    assert totals == {
        set_id: sum(counts.get(k, 0) for k in ("Item", "Look", "Article", "Statement"))
        for set_id, counts in loaded["sets"].items()
    }
    lambda_handler.loader_handler({**_LOADER_EVENT, "RequestType": "Delete"}, _Context())
    assert sent["body"]["Status"] == "SUCCESS"


def test_the_custom_resource_answers_only_an_https_response_url(monkeypatch):
    """CloudFormation's ResponseURL is a pre-signed https S3 URL; a ``file:`` or plain http URL
    in the event is refused before any request."""
    opened = []
    monkeypatch.setattr(lambda_handler.urllib.request, "urlopen", lambda *a, **k: opened.append(a))
    for url in ("file:///etc/hosts", "http://169.254.169.254/latest/meta-data/", ""):
        event = {**_LOADER_EVENT, "RequestType": "Delete", "ResponseURL": url}
        with pytest.raises(ValueError, match="https"):
            lambda_handler.loader_handler(event, _Context())
    assert opened == []


def test_loader_answers_failed_before_the_function_timeout(loaded_service, monkeypatch):
    """A load that is still running when the clock runs out is reported, not left to
    CloudFormation's one-hour wait; a load that raises is reported with its message."""
    responses = []
    monkeypatch.setattr(
        lambda_handler,
        "_cfn_respond",
        lambda event, context, status, physical_id, data, reason="": responses.append(
            (status, reason)
        ),
    )
    monkeypatch.setattr(lambda_handler, "_service", loaded_service)
    monkeypatch.setattr(lambda_handler, "LOADER_MARGIN_MS", 10_000)
    never_done = threading.Event()
    monkeypatch.setattr(loaded_service, "load_sample", lambda **kw: never_done.wait())
    lambda_handler.loader_handler(_LOADER_EVENT, _Context(remaining=5_000))
    assert responses == [("FAILED", lambda_handler.LOADER_TIMEOUT_REASON)]
    assert "cdk destroy" in lambda_handler.LOADER_TIMEOUT_REASON
    never_done.set()

    def boom(**kw):
        raise RuntimeError("AccessDeniedException: no Bedrock access")

    monkeypatch.setattr(loaded_service, "load_sample", boom)
    monkeypatch.setattr(lambda_handler.time, "sleep", lambda s: None)  # the retries, at once
    lambda_handler.loader_handler(_LOADER_EVENT, _Context())
    assert responses[-1] == ("FAILED", "AccessDeniedException: no Bedrock access")
