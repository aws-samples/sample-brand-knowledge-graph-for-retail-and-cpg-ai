# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Background jobs the browser polls.

Three things can take longer than the 115 s an API call may take: the data agent of
tab 6's trends question (a question is several SQL queries of a few seconds each), its graph agent
(up to 5 minutes, query_agent.py). The data agent runs as a :class:`Jobs` entry: one thread per
job, its record kept in this process (the lake agent's microVM on AgentCore Runtime, polled in the
same session) and read back by id (``GET /api/trends/lake/ask?id=``).
Deployed, the graph agent's run is in the pipeline function instead, its record in the data bucket
(:class:`FunctionJobs`, ``GET /api/trends/graph?id=``).
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid

from ontology_rag.errors import public_message

log = logging.getLogger(__name__)

# Where the records of the trends question's graph agent jobs (graph-<id>) live in the data bucket
# (the stack expires jobs/ after a day).
TREND_RECORDS = "jobs/trends/"


class Jobs:
    def __init__(self, keep: int = 20, prefix: str = "job"):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self.keep = keep  # how many records to remember; the oldest go first
        self.prefix = prefix  # job ids are <prefix>-<12 hex digits>

    def start(self, fn, *args, kind: str = "", job_id: str | None = None) -> dict:
        """Run ``fn(*args)`` in a thread; the job is ``running`` until it returns (``done``, with
        its return value as ``result``) or raises (``failed``, with the message as ``error``).
        ``job_id``: the caller's own id (default ``<prefix>-<12 hex digits>``)."""
        job_id = job_id or f"{self.prefix}-{uuid.uuid4().hex[:12]}"
        job = {
            "job_id": job_id,
            "kind": kind,
            "status": "running",
            "step": "",
            "started_at": time.time(),
        }
        with self._lock:
            self._jobs[job_id] = job
            for old in sorted(self._jobs.values(), key=lambda j: j["started_at"])[: -self.keep]:
                self._jobs.pop(old["job_id"], None)

        def target() -> None:
            try:
                update = {"status": "done", "result": fn(*args)}
            except Exception as exc:
                log.exception("job %s (%s) failed", job_id, kind)
                update = {"status": "failed", "error": public_message(exc)[:1000]}
            with self._lock:
                job.update(update, ended_at=time.time())

        threading.Thread(target=target, name=job_id, daemon=True).start()
        return self.get(job_id)

    def progress(self, text: str) -> None:
        """Called from inside a job: what it is doing now (the thread is named after the job)."""
        with self._lock:
            job = self._jobs.get(threading.current_thread().name)
            if job is not None:
                job["step"] = text
                log.info("%s: %s", job["kind"] or job["job_id"], text)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return self._view(job) if job else None

    def latest(self) -> dict | None:
        with self._lock:
            job = max(self._jobs.values(), key=lambda j: j["started_at"], default=None)
            return self._view(job) if job else None

    def running(self) -> bool:
        with self._lock:
            return any(j["status"] == "running" for j in self._jobs.values())

    @staticmethod
    def _view(job: dict) -> dict:
        out = dict(job)
        out["elapsed_s"] = round((out.get("ended_at") or time.time()) - out["started_at"], 1)
        return out


class FunctionJobs:
    """Deployed: work that outlasts an API call, run in another Lambda function and polled through
    the API (the trends question's graph agent, in the pipeline function).

    :meth:`start` (the API) writes the job record into the data bucket (``<prefix><id>.json``: the
    input, ``running``) and invokes the function asynchronously
    (``InvocationType="Event"``: Lambda queues the event and answers 202 at once). :meth:`run`
    (the function) does the work and writes its progress, then the result (``done``) or the error
    (``failed``), into the same record. :meth:`get` (the API) reads it back for the browser. A job
    no function finishes (it never started, or it timed out) reads ``failed`` after ``QUEUE_S +
    RUN_S``.
    """

    QUEUE_S = (
        300  # the longest a job waits for its function to start (Lambda retries throttled events)
    )
    RUN_S = 360  # the function's timeout (infra: PIPELINE_FUNCTION_TIMEOUT_S, 6 minutes)

    def __init__(self, blobs, prefix: str, function_name: str = "", client=None, region=None):
        self.blobs = blobs  # the data bucket (pipeline.S3BlobStore)
        self.prefix = prefix
        self.function_name = function_name  # the API's: the function it invokes
        self._client = client
        self.region = region

    def client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client("lambda", region_name=self.region)
        return self._client

    def key(self, job_id: str) -> str:
        return f"{self.prefix}{job_id}.json"

    def start(self, job_id: str, step: str, inputs: dict, kind: str = "") -> dict:
        """Write the record and queue the work: the function gets ``{"step": step, "job_id": id}``
        and reads the input from the record (an event stays small whatever the input is)."""
        record = {
            "job_id": job_id,
            "kind": kind,
            "status": "running",
            "step": "queued for the pipeline function",
            "started_at": time.time(),
            "input": inputs,
        }
        self.blobs.put_json(self.key(job_id), record)
        try:
            self.client().invoke(
                FunctionName=self.function_name,
                InvocationType="Event",
                Payload=json.dumps({"step": step, "job_id": job_id}).encode(),
            )
        except Exception as exc:
            self._finish(record, {"status": "failed", "error": public_message(exc)[:1000]})
            raise
        return self._view(record)

    def get(self, job_id: str) -> dict | None:
        """The job as the browser sees it; ``None`` for no such job. The id is the job's only
        handle: 128 random bits (trends.graph_start), known to the browser tab that started it."""
        record = self.blobs.get_json(self.key(job_id))
        if record is None:
            return None
        limit = self.QUEUE_S + self.RUN_S
        if record["status"] == "running" and time.time() - record["started_at"] > limit:
            error = f"no result after {limit} s: the job's function stopped (see its log)"
            return self._finish(record, {"status": "failed", "error": error})
        return self._view(record)

    def run(self, job_id: str, fn) -> dict | None:
        """In the function: ``fn(inputs, progress)`` on the job's input, its return value the
        result. Lambda delivers an event again after a timeout (and now and then twice), so a
        record that is no longer waiting is never run a second time."""
        record = self.blobs.get_json(self.key(job_id))
        if record is None or record.get("status") != "running":
            log.warning("job %s: no running record, nothing to do", job_id)
            return None
        now = time.time()
        if record.get("worker_started_at"):
            if now - record["worker_started_at"] < self.RUN_S:
                log.warning("job %s: delivered again while it runs, ignored", job_id)
                return None
            error = "the job's function stopped before it finished (a timeout?); start it again"
            return self._finish(record, {"status": "failed", "error": error})
        if now - record["started_at"] > self.QUEUE_S:
            error = f"the job waited {now - record['started_at']:.0f} s for its function; start it again"
            return self._finish(record, {"status": "failed", "error": error})
        record.update(worker_started_at=now, step="started")
        self.blobs.put_json(self.key(job_id), record)

        def progress(text: str) -> None:
            record["step"] = text
            self.blobs.put_json(self.key(job_id), record)
            log.info("%s: %s", record.get("kind") or job_id, text)

        try:
            update = {"status": "done", "result": fn(record["input"], progress)}
        except Exception as exc:
            log.exception("job %s (%s) failed", job_id, record.get("kind"))
            update = {"status": "failed", "error": public_message(exc)[:1000]}
        return self._finish(record, update)

    def _finish(self, record: dict, update: dict) -> dict:
        record.update(update, ended_at=time.time())
        self.blobs.put_json(self.key(record["job_id"]), record)
        return self._view(record)

    @staticmethod
    def _view(record: dict) -> dict:
        """What the poll returns: the record without its input."""
        out = {k: v for k, v in record.items() if k not in ("input", "worker_started_at")}
        out["elapsed_s"] = round((out.get("ended_at") or time.time()) - out["started_at"], 1)
        return out
