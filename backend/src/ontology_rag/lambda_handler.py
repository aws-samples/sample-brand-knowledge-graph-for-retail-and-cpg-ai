# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""AWS Lambda entry points.

* ``api_handler``: the HTTP API behind a Lambda function URL (payload format 2.0), which the
  browser calls directly. The URL's AuthType is AWS_IAM: Lambda runs the function only for
  requests signed with the signed-in user's credentials from the stack's Cognito identity pool
  (infra/lib/auth.ts), so this code checks no token.
* ``pipeline_handler``: the ingest pipeline's steps (classify · ingest · summarize), invoked by
  the Step Functions state machine in ``pipeline.asl.json``, and the graph agent's job of tab 6's
  trends question, invoked by the API asynchronously (``trends.graph_job``).
* ``loader_handler``: CloudFormation custom resource that loads the ontology and every data set
  of the graph's domain (with embeddings) into the Neptune Analytics graph at deploy time, so the
  demo is ready the moment the stack is green. It answers FAILED itself when the load cannot
  finish before the function timeout, instead of leaving CloudFormation to wait an hour.
* ``auth_setup_handler``: CloudFormation custom resource that gives the stack's one Cognito
  user the password generated in Secrets Manager, so the first sign-in works with it.

The custom resources speak the CloudFormation response protocol directly (no framework) and
run from the stack's one code zip, the API's.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
import traceback
import urllib.request
import uuid
from datetime import UTC, datetime

from ontology_rag import pipeline, trends
from ontology_rag.api import dispatch
from ontology_rag.service import Service
from ontology_rag.telemetry import request_id_var

log = logging.getLogger()
log.setLevel(logging.INFO)

_service = None
_cold = True  # flipped after the first invocation this container handles


def _svc(background: bool = False):
    """The function's one Service, made on its first request. ``background``: the pipeline
    function's, whose model calls no browser waits for (``Service.bedrock``)."""
    global _service
    if _service is None:
        _service = Service(background=background)
    return _service


# ---------------------------------------------------------------------- API
def api_handler(event, context):
    """Lambda function URL (payload 2.0) -> shared router. The invocation record that the
    architecture panel shows (request id, cold start, memory, log stream) is built here and
    attached to the classify response by ``dispatch``."""
    global _cold
    cold, _cold = _cold, False
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "GET")
    path = event.get("rawPath", "/")
    query = event.get("queryStringParameters") or {}
    request_id = getattr(context, "aws_request_id", "") or str(uuid.uuid4())
    body: dict = {}
    raw = event.get("body")
    if raw:
        try:
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw).decode("utf-8")
            body = json.loads(raw)
        except ValueError:  # bad base64 (binascii.Error), bad UTF-8 and bad JSON are all one
            return _json(400, {"error": "body must be JSON"})
        if not isinstance(body, dict):
            return _json(400, {"error": "body must be a JSON object"})
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    invocation = {
        "request_id": request_id,
        "runtime": "lambda",
        "function_name": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
        "memory_mb": int(os.environ.get("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "0") or 0) or None,
        "log_group": getattr(context, "log_group_name", None),
        "log_stream": getattr(context, "log_stream_name", None),
        "cold_start": cold,
        "region": os.environ.get("AWS_REGION"),
        "started_at": datetime.now(UTC).isoformat(timespec="milliseconds"),
    }
    try:
        try:
            status, payload = dispatch(_svc(), method, path, query, body, invocation)
        except Exception as exc:  # noqa: BLE001 - surface as 500 with a request id, log the trace
            log.error("unhandled error: %s\n%s", exc, traceback.format_exc())
            status, payload = 500, {"error": "internal error", "request_id": request_id}
        log.info(
            "%s %s -> %d in %d ms%s",
            method,
            path,
            status,
            int((time.perf_counter() - started) * 1000),
            " (cold start)" if cold else "",
        )
    finally:
        request_id_var.reset(token)
    return _json(status, payload)


def _json(status: int, payload: dict) -> dict:
    headers = {"content-type": "application/json", "cache-control": "no-store"}
    return {"statusCode": status, "headers": headers, "body": json.dumps(payload, default=str)}


# ---------------------------------------------------------------------- ingest pipeline steps
def pipeline_handler(event, context):
    """Run the pipeline step Step Functions asks for: one of three, chosen by ``event["step"]``.

    The state machine (``pipeline.asl.json``) invokes this function for every source twice
    (classify, then ingest) and once more for the summary. A ``RetryableError`` (Bedrock
    throttling, a concurrent MERGE) surfaces as the Lambda error type of that name, which the
    state machine's Retry block matches; any other exception fails the source, not the run.
    The API invokes it too, asynchronously, for the trends question's graph agent job
    (``trends_graph``, which calls the query agent's runtime with the job's model and reasoning
    effort); it writes its progress and then its result or its error into the job record.
    """
    step = event.get("step")
    token = request_id_var.set(getattr(context, "aws_request_id", "") or str(uuid.uuid4()))
    try:
        svc = _svc(background=True)
        if step == "classify":
            return pipeline.classify_source(svc, event["run"], event["source"])
        if step == "ingest":
            return pipeline.ingest_source(svc, event["run"], event["classified"])
        if step == "summarize":
            return pipeline.summarize(svc, event["run"], event["results"])
        if step == trends.GRAPH_STEP:
            return trends.graph_job(svc, str(event.get("job_id") or ""))
        raise ValueError(f"unknown pipeline step {step!r}")
    finally:
        request_id_var.reset(token)


# ---------------------------------------------------------------------- CFN custom resources
# Respond FAILED while there is still time to do so: a handler that is killed by the function
# timeout sends nothing, and CloudFormation then waits an hour before it rolls the stack back.
LOADER_MARGIN_MS = 60_000
LOADER_TIMEOUT_REASON = (
    "graph load did not finish before the function timeout; run `cdk destroy` and deploy again"
)
# CloudFormation keeps at most 4 KB of a custom resource's response data. A load result longer
# than this (many data sets) goes into ``Loaded`` as node totals per set; the log has all of it.
LOADED_MAX_CHARS = 3_500
# set counts that are no nodes
_NOT_NODES = {"vectors", "catalog", "PairingRule"}


def _loaded(result: dict) -> str:
    """The ``Loaded`` attribute: the load result as JSON, or ``{set: node total}`` when the whole
    result would not fit CloudFormation's limit (a skipped set keeps its reason)."""
    full = json.dumps(result)
    if len(full) <= LOADED_MAX_CHARS:
        return full
    return json.dumps(
        {
            set_id: counts.get("skipped")
            or sum(v for k, v in counts.items() if isinstance(v, int) and k not in _NOT_NODES)
            for set_id, counts in result.get("sets", {}).items()
        }
    )


def loader_handler(event, context):
    """``Custom::GraphLoader``: load the ontology and every data set of the graph's domain (with
    embeddings; Service.load_sample) into the stack's graph on Create and Update; Delete has
    nothing to undo (the graph goes with the stack). The load runs in a worker thread so the
    handler can watch the clock."""
    request_type = event.get("RequestType")
    physical_id = (
        event.get("PhysicalResourceId") or f"graph-loader-{event.get('LogicalResourceId', 'x')}"
    )
    if request_type not in ("Create", "Update"):
        _cfn_respond(event, context, "SUCCESS", physical_id, {})
        return
    props = event.get("ResourceProperties", {})
    outcome: dict = {}

    def load() -> None:
        try:
            outcome["result"] = _retry(
                lambda: _svc().load_sample(
                    reset=str(props.get("Reset", "false")).lower() == "true",
                    with_embeddings=str(props.get("WithEmbeddings", "true")).lower() == "true",
                ),
                attempts=6,
                delay=20,
            )
        except Exception as exc:  # noqa: BLE001 - reported to CloudFormation as the reason
            log.error("loader failed: %s\n%s", exc, traceback.format_exc())
            outcome["error"] = str(exc)[:900]

    worker = threading.Thread(target=load, daemon=True)
    worker.start()
    while worker.is_alive() and context.get_remaining_time_in_millis() > LOADER_MARGIN_MS:
        worker.join(timeout=5)
    if worker.is_alive():
        log.error("loader watchdog: %s", LOADER_TIMEOUT_REASON)
        _cfn_respond(event, context, "FAILED", physical_id, {}, reason=LOADER_TIMEOUT_REASON)
    elif "error" in outcome:
        _cfn_respond(event, context, "FAILED", physical_id, {}, reason=outcome["error"])
    else:
        log.info("loaded the ontology and the data sets: %s", json.dumps(outcome["result"]))
        data = {"Loaded": _loaded(outcome["result"])}
        _cfn_respond(event, context, "SUCCESS", physical_id, data)


def _retry(fn, attempts: int, delay: int):
    """Transient failures are retried: right after creation the graph or its private endpoint may
    not accept queries yet. No AWS page gives that delay; the retry costs nothing when the first
    attempt works."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            last = exc
            log.warning("attempt %d/%d failed: %s", i + 1, attempts, exc)
            if i < attempts - 1:
                # A fixed wait on purpose: the graph needs time to accept queries (see above).
                time.sleep(delay)  # nosemgrep
    raise last  # type: ignore[misc]


def auth_setup_handler(event, context):
    """``Custom::AuthSetup``: set the password Secrets Manager generated (``SecretArn``) on the
    stack's Cognito user (``UserPoolId``, ``Username``), as a permanent one, so the first sign-in
    is a sign-in and not a password change. Create and Update set it; Delete has nothing to undo
    (the user goes with the pool). The password itself is never logged."""
    import boto3

    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {})
    physical_id = event.get("PhysicalResourceId") or f"auth-setup-{props.get('UserPoolId', 'x')}"
    try:
        if request_type in ("Create", "Update"):
            secret = boto3.client("secretsmanager").get_secret_value(SecretId=props["SecretArn"])
            boto3.client("cognito-idp").admin_set_user_password(
                UserPoolId=props["UserPoolId"],
                Username=props["Username"],
                Password=secret["SecretString"],
                Permanent=True,
            )
            log.info(
                "auth setup done for user %s in pool %s", props["Username"], props["UserPoolId"]
            )
        _cfn_respond(event, context, "SUCCESS", physical_id, {})
    except Exception as exc:  # noqa: BLE001
        log.error("auth setup failed: %s\n%s", exc, traceback.format_exc())
        _cfn_respond(event, context, "FAILED", physical_id, {}, reason=str(exc)[:900])


def _cfn_respond(
    event, context, status: str, physical_id: str, data: dict, reason: str = ""
) -> None:
    # CloudFormation puts a pre-signed https S3 URL in the event; anything else (a file: URL, a
    # plain http host) is refused before a request is made
    url = str(event.get("ResponseURL") or "")
    if not url.startswith("https://"):
        raise ValueError("the custom resource event's ResponseURL must be an https URL")
    body = json.dumps(
        {
            "Status": status,
            "Reason": reason
            or f"see CloudWatch log stream {getattr(context, 'log_stream_name', '')}",
            "PhysicalResourceId": physical_id,
            "StackId": event["StackId"],
            "RequestId": event["RequestId"],
            "LogicalResourceId": event["LogicalResourceId"],
            "NoEcho": False,
            "Data": data,
        }
    ).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={"content-type": ""})
    # the pre-signed S3 URL CloudFormation put in the event; the only URL this function opens
    with urllib.request.urlopen(req, timeout=30) as resp:  # nosec B310  # see above
        log.info("cfn response: %s", resp.status)
