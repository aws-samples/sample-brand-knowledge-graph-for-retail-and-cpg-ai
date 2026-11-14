# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""What every layer says about a failure: the exception the API maps to 409, the two readers of
an AWS SDK error (``botocore.exceptions.ClientError`` carries its code and message in
``exc.response["Error"]``; any other exception has only its type and text), and
:func:`public_message`, the one text about a failure that may leave the process for the browser
(:func:`public_pipeline_error` is the same for a failure the ingest pipeline recorded as text)."""

from __future__ import annotations

import json
import re

# An AWS SDK message names the caller's role, account and request when the caller is denied or
# throttled; the browser gets the code and one fixed phrase for those families instead.
_PHRASES = {
    "AccessDeniedException": "the API's role may not call this model or resource",
    "ThrottlingException": "the model is throttled, try again",
    "TooManyRequestsException": "the model is throttled, try again",
    "ServiceUnavailableException": "the service is unavailable right now, try again",
}
_ARN = re.compile(r"arn:[^\s]+")
# The two fields of Lambda's error JSON a user may read; also found in JSON cut off after them
_LAMBDA_FIELD = re.compile(r'"(errorType|errorMessage)"\s*:\s*"((?:[^"\\]|\\.)*)"')
MAX_PIPELINE_ERROR = 300


class NotReady(Exception):
    """The request needs something the stack or the user has not set up yet (409): e.g. GraphRAG
    before the graph holds a look."""


def aws_error_code(exc: BaseException) -> str | None:
    """The service's error code (``ThrottlingException``, ``AccessDeniedException``, …), or
    ``None`` for an exception that is not an AWS SDK error."""
    response = getattr(exc, "response", None) or {}  # botocore's network errors carry None
    return response.get("Error", {}).get("Code") or None


def aws_message(exc: BaseException) -> str:
    """``Code: message`` for an AWS SDK error, ``TypeName: text`` for anything else."""
    code = aws_error_code(exc)
    if code:
        return f"{code}: {exc.response['Error'].get('Message') or exc}"  # type: ignore[attr-defined]
    return f"{type(exc).__name__}: {exc}"


def public_message(exc: BaseException) -> str:
    """What the browser is told about a failure: the AWS error code with a fixed phrase for the
    families whose message names the caller's role or account, else the service's message with
    every ARN redacted; any other exception by its type and first line, redacted the same way.
    The full text belongs in the log (``log.exception`` where the error is caught), which the
    architecture panel shows the operator."""
    code = aws_error_code(exc)
    if code:
        text = _PHRASES.get(code) or exc.response["Error"].get("Message") or ""  # type: ignore[attr-defined]
        return _ARN.sub("<arn>", f"{code}: {text}")
    first_line = str(exc).splitlines()[0] if str(exc) else ""
    return _ARN.sub("<arn>", f"{type(exc).__name__}: {first_line}")


def public_pipeline_error(text: str) -> str:
    """A pipeline failure as tab 2 shows it: a Step Functions error and cause, or the error of a
    failed source's record. Lambda reports a failed step as JSON (``errorMessage``,
    ``errorType``, ``requestId`` and a ``stackTrace`` with the function's file paths): only
    ``errorType: errorMessage`` is kept. Any other text loses its stack trace. Every ARN is
    redacted and the result is at most 300 characters; the full text is in the pipeline
    function's log."""
    text = str(text or "")
    found = _lambda_error(text)
    if found is None:
        found = text.split("Traceback (most recent call last)", 1)[0]
        found = found.split('"stackTrace"', 1)[0]
    one_line = " ".join(found.split())
    return redact_arns(one_line)[:MAX_PIPELINE_ERROR]


def redact_arns(text: str) -> str:
    """``text`` with every ARN replaced by ``<arn>``: an ARN names the account and the role."""
    return _ARN.sub("<arn>", text)


def _lambda_error(text: str) -> str | None:
    """``errorType: errorMessage`` from Lambda's error JSON in ``text`` (after a prefix such as
    ``RuntimeError: ``), also when the JSON was cut off after those two fields; ``None`` when
    the text holds no such JSON."""
    start = text.find("{")
    if start == -1:
        return None
    try:
        doc = json.loads(text[start:])
    except ValueError:
        doc = {name: _json_string(value) for name, value in _LAMBDA_FIELD.findall(text[start:])}
    if not isinstance(doc, dict) or not (doc.get("errorMessage") or doc.get("errorType")):
        return None
    return f"{doc.get('errorType') or 'Error'}: {doc.get('errorMessage') or ''}"


def _json_string(body: str) -> str:
    """The text of a JSON string literal's body (``\\"`` and ``\\n`` decoded)."""
    try:
        return json.loads(f'"{body}"')
    except ValueError:
        return body
