# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""What a failure tells the browser (errors.public_message): the AWS error code, never the role,
account or request the SDK message names; and the places that use it."""

from __future__ import annotations

import json
import logging
import time

from ontology_rag import errors, jobs
from ontology_rag.api import ROUTES, dispatch

ROLE = "arn:aws:sts::111111111111:assumed-role/MultimodalAiKnowledgeGraph-ApiRole/ontology-api"


class FakeClientError(Exception):
    """A botocore ClientError as the API sees it: the module name and ``response``."""

    __module__ = "botocore.exceptions"

    def __init__(self, code: str, message: str):
        super().__init__(
            f"An error occurred ({code}) when calling the Converse operation: {message}"
        )
        self.response = {"Error": {"Code": code, "Message": message}}


def test_denied_and_throttled_calls_get_a_fixed_phrase():
    denied = FakeClientError(
        "AccessDeniedException",
        f"User: {ROLE} is not authorized to perform: bedrock:InvokeModel on resource: "
        "arn:aws:bedrock:us-east-1::foundation-model/x with an explicit deny",
    )
    assert errors.public_message(denied) == (
        "AccessDeniedException: the API's role may not call this model or resource"
    )
    assert errors.public_message(FakeClientError("ThrottlingException", "Too many requests")) == (
        "ThrottlingException: the model is throttled, try again"
    )
    # the full text is still there for the log
    assert ROLE in errors.aws_message(denied)


def test_other_messages_keep_their_words_without_the_arns():
    exc = FakeClientError(
        "ValidationException",
        f"Invocation of model {ROLE} with on-demand throughput isn't supported",
    )
    assert errors.public_message(exc) == (
        "ValidationException: Invocation of model <arn> with on-demand throughput isn't supported"
    )
    plain = RuntimeError(f"the MCP server could not read {ROLE}\nTraceback (most recent call last)")
    assert errors.public_message(plain) == "RuntimeError: the MCP server could not read <arn>"
    assert errors.public_message(KeyError()) == "KeyError: "


def test_the_router_answers_an_aws_error_with_the_public_message(
    loaded_service, monkeypatch, caplog
):
    caplog.set_level(logging.ERROR)

    def denied(svc, q, b):
        raise FakeClientError("AccessDeniedException", f"User: {ROLE} is not authorized")

    def throttled(svc, q, b):
        raise FakeClientError("ThrottlingException", "Too many requests, please wait")

    monkeypatch.setitem(ROUTES, ("GET", "/api/summary"), denied)
    monkeypatch.setitem(ROUTES, ("GET", "/api/ontology"), throttled)
    status, body = dispatch(loaded_service, "GET", "/api/summary", {}, {})
    assert status == 403 and "arn:" not in body["error"]
    assert (
        body["error"] == "AccessDeniedException: the API's role may not call this model or resource"
    )
    assert ROLE in caplog.text  # the operator reads it in the log
    status, body = dispatch(loaded_service, "GET", "/api/ontology", {}, {})
    assert (status, body) == (
        502,
        {"error": "ThrottlingException: the model is throttled, try again"},
    )


def test_a_network_error_of_the_sdk_is_answered_and_not_an_internal_error(loaded_service, monkeypatch):
    """botocore's network errors (a reset connection, a read timeout) carry ``response=None``: the
    router answers them with their type and first line (502), as the troubleshooting page says,
    and does not fail on the missing error code."""
    from botocore.exceptions import ConnectionClosedError, ReadTimeoutError

    url = "https://bedrock-runtime.us-east-1.amazonaws.com/model/m/converse"
    for exc in (ConnectionClosedError(endpoint_url=url), ReadTimeoutError(endpoint_url=url)):
        assert exc.response is None and errors.aws_error_code(exc) is None

        def fail(svc, q, b, exc=exc):
            raise exc

        monkeypatch.setitem(ROUTES, ("GET", "/api/summary"), fail)
        status, body = dispatch(loaded_service, "GET", "/api/summary", {}, {})
        assert status == 502 and body["error"].startswith(f"{type(exc).__name__}: "), body
        assert url in body["error"]


def test_a_failed_job_reports_the_public_message():
    def fail():
        raise FakeClientError("AccessDeniedException", f"User: {ROLE} may not create the graph")

    runner = jobs.Jobs(prefix="test")
    job_id = runner.start(fail, kind="create the graph")["job_id"]
    deadline = time.time() + 5
    while (job := runner.get(job_id))["status"] == "running":
        assert time.time() < deadline
        time.sleep(0.01)
    assert job["status"] == "failed" and "arn:" not in job["error"]
    assert (
        job["error"] == "AccessDeniedException: the API's role may not call this model or resource"
    )


# ---------------------------------------------------------------------- pipeline failures (tab 2)
TRACE = [
    '  File "/var/task/ontology_rag/lambda_handler.py", line 131, in pipeline_handler\n',
    '  File "/var/task/ontology_rag/pipeline.py", line 254, in ingest_source\n',
]
LAMBDA_ERROR = json.dumps(
    {
        "errorMessage": f"User: {ROLE} is not authorized to perform: neptune-graph:WriteDataViaQuery",
        "errorType": "AccessDeniedException",
        "requestId": "5f0c2a8e-0000-4000-8000-000000000000",
        "stackTrace": TRACE,
    }
)


def test_a_pipeline_error_keeps_type_and_message_without_trace_or_arn():
    expected = (
        "AccessDeniedException: User: <arn> is not authorized to perform: "
        "neptune-graph:WriteDataViaQuery"
    )
    # a failed execution: DescribeExecution's error and the whole cause
    assert errors.public_pipeline_error(f"States.TaskFailed: {LAMBDA_ERROR}") == expected
    # a failed source: the state machine's Record failure keeps 300 characters of the cause,
    # cut off inside the stack trace
    recorded = f"AccessDeniedException: {LAMBDA_ERROR[:300]}"
    assert "stackTrace" in recorded and not recorded.endswith("}")
    assert errors.public_pipeline_error(recorded) == expected
    # any other text loses its trace and its ARNs, on one line
    local = f"RuntimeError: could not read {ROLE}\nTraceback (most recent call last):\n  File x"
    assert errors.public_pipeline_error(local) == "RuntimeError: could not read <arn>"
    assert errors.public_pipeline_error("States.Timeout: ") == "States.Timeout:"
    # at most 300 characters, and the same text a second time
    long = errors.public_pipeline_error("ValueError: " + "x" * 1000)
    assert len(long) == errors.MAX_PIPELINE_ERROR
    assert errors.public_pipeline_error(expected) == expected
    assert errors.redact_arns(f"graph {ROLE} denied") == "graph <arn> denied"
