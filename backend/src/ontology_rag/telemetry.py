# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""What the explorer's architecture panel reads back from the running system.

* ``request_id_var`` and ``RingBufferHandler``: every log record is tagged with the request it
  belongs to and kept in a small in-memory ring (the fallback on Lambda when CloudWatch Logs
  cannot be read).
* ``cloudwatch_events`` / ``parse_report``: the invocation's own log events straight from
  CloudWatch Logs, including the ``REPORT`` line with billed duration and memory.
* ``console_links``: deep links into the AWS console for the resources the request touched.

Nothing here is needed to *serve* the API; it exists so the UI can show what happened.
"""

from __future__ import annotations

import contextvars
import logging
import re
import threading
import time
from collections import deque
from urllib.parse import quote

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


class RingBufferHandler(logging.Handler):
    """Keeps the last ``capacity`` records in memory, each tagged with the current request id."""

    def __init__(self, capacity: int = 2000):
        super().__init__()
        self.records: deque[dict] = deque(maxlen=capacity)
        self._lock = threading.Lock()
        self.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": int(record.created * 1000),
                "level": record.levelname,
                "message": self.format(record),
                "request_id": request_id_var.get(""),
            }
        except Exception:  # noqa: BLE001 - never let logging break the request
            return
        with self._lock:
            self.records.append(entry)

    def query(self, request_id: str | None = None, limit: int = 200) -> list[dict]:
        with self._lock:
            items = list(self.records)
        if request_id:
            items = [r for r in items if r["request_id"] == request_id]
        return items[-limit:]


_handler: RingBufferHandler | None = None


def install(capacity: int = 2000) -> RingBufferHandler:
    """Attach the ring buffer to the root logger once (idempotent)."""
    global _handler
    if _handler is None:
        _handler = RingBufferHandler(capacity)
        root = logging.getLogger()
        root.addHandler(_handler)
        if root.level > logging.INFO or root.level == logging.NOTSET:
            root.setLevel(logging.INFO)
    return _handler


def buffered_events(request_id: str | None, limit: int = 200) -> list[dict]:
    return install().query(request_id, limit)


# ---------------------------------------------------------------------- CloudWatch Logs
def cloudwatch_events(
    log_group: str,
    request_id: str,
    limit: int = 200,
    log_stream: str | None = None,
    lookback_s: int = 15 * 60,
    client=None,
) -> list[dict]:
    """The log events of one invocation. Lambda prefixes START/END/REPORT and every record
    written through ``logging`` with the request id, so a quoted filter pattern is exact. The
    panel asks right after the call it made, so a quarter of an hour back is enough."""
    if client is None:
        import boto3

        client = boto3.client("logs")
    kwargs: dict = {
        "logGroupName": log_group,
        "filterPattern": f'"{request_id}"',
        "startTime": int((time.time() - lookback_s) * 1000),
        "limit": min(max(limit, 1), 1000),
    }
    if log_stream:
        kwargs["logStreamNames"] = [log_stream]
    events: list[dict] = []
    for _ in range(5):  # a few pages at most; one invocation is a handful of lines
        resp = client.filter_log_events(**kwargs)
        events.extend(
            {
                "ts": e.get("timestamp"),
                "message": (e.get("message") or "").rstrip("\n"),
                "stream": e.get("logStreamName"),
            }
            for e in resp.get("events", [])
        )
        token = resp.get("nextToken")
        if not token or len(events) >= limit:
            break
        kwargs["nextToken"] = token
    events.sort(key=lambda e: e.get("ts") or 0)
    return events[:limit]


_REPORT = re.compile(
    r"Duration:\s*(?P<duration>[\d.]+)\s*ms\s+Billed Duration:\s*(?P<billed>\d+)\s*ms\s+"
    r"Memory Size:\s*(?P<memory>\d+)\s*MB\s+Max Memory Used:\s*(?P<used>\d+)\s*MB"
    r"(?:\s+Init Duration:\s*(?P<init>[\d.]+)\s*ms)?"
)


def parse_report(events: list[dict]) -> dict | None:
    """Billed duration / memory from Lambda's ``REPORT`` line, when it is among the events."""
    for e in events:
        m = _REPORT.search(e.get("message") or "")
        if m:
            return {
                "duration_ms": float(m["duration"]),
                "billed_ms": int(m["billed"]),
                "memory_mb": int(m["memory"]),
                "max_memory_used_mb": int(m["used"]),
                "init_ms": float(m["init"]) if m["init"] else None,
            }
    return None


# ---------------------------------------------------------------------- console deep links
def console_links(
    region: str,
    function_name: str | None = None,
    log_group: str | None = None,
    bucket: str | None = None,
    prefix: str = "",
    state_machine_arn: str | None = None,
    pipeline_function_name: str | None = None,
    graph_id: str | None = None,
) -> dict[str, str]:
    """Deep links for the architecture panels. Hash routes fall back to the service home page
    if the console changes, so a stale route degrades gracefully."""
    base = f"https://{region}.console.aws.amazon.com"
    links: dict[str, str] = {
        "bedrock": f"{base}/bedrock/home?region={region}#/model-catalog",
        "cloudwatch": f"{base}/cloudwatch/home?region={region}#logsV2:log-groups",
    }
    if function_name:
        fn = quote(function_name, safe="")
        links["lambda"] = f"{base}/lambda/home?region={region}#/functions/{fn}?tab=code"
        links["lambda_monitoring"] = (
            f"{base}/lambda/home?region={region}#/functions/{fn}?tab=monitoring"
        )
    if pipeline_function_name:
        fn = quote(pipeline_function_name, safe="")
        links["pipeline_lambda"] = f"{base}/lambda/home?region={region}#/functions/{fn}?tab=code"
        links["pipeline_lambda_monitoring"] = (
            f"{base}/lambda/home?region={region}#/functions/{fn}?tab=monitoring"
        )
    if state_machine_arn:
        links["state_machine"] = (
            f"{base}/states/home?region={region}#/statemachines/view/{state_machine_arn}"
        )
        links["execution_template"] = (
            f"{base}/states/home?region={region}#/v2/executions/details/{{arn}}"
        )
    if graph_id:
        links["neptune"] = f"{base}/neptune/home?region={region}#graphs"
    if log_group:
        # The console double-encodes the log group name: "/" -> %2F -> $252F.
        encoded = quote(log_group, safe="").replace("%", "$25")
        links["log_group"] = (
            f"{base}/cloudwatch/home?region={region}#logsV2:log-groups/log-group/{encoded}"
        )
    if bucket:
        links["s3_bucket"] = (
            f"https://s3.console.aws.amazon.com/s3/buckets/{bucket}?region={region}"
        )
        links["s3_prefix_template"] = links["s3_bucket"] + "&prefix={prefix}"
        links["s3_ontologies"] = links["s3_prefix_template"].format(prefix=quote(prefix, safe=""))
    return links
