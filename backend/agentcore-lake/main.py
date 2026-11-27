# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Amazon Bedrock AgentCore Runtime entry point of the lake agent (tab 6's trends question, method 2).

AgentCore starts this file (``opentelemetry-instrument main.py``) in the session's microVM and
sends every ``InvokeAgentRuntime`` request to ``POST /invocations`` on port 8080. The work is
``ontology_rag.agent_runtime.handle_lake``: ``export`` writes the rows the API read from the graph
into the sample's Iceberg tables (PyIceberg); ``ask`` starts the data agent (a Converse tool loop
over the S3 Tables MCP server, lake_agent.py) as a background job of this microVM, and ``poll``
returns it (the API polls in the same session, so it reaches the same microVM).

Startup starts the S3 Tables MCP server once (``query_agent.SessionServer``): on platform version
V2 it is part of the snapshot every session is restored from. While a job runs, ``/ping`` reports
the session busy (``add_async_task``), so AgentCore does not reclaim it as idle.
"""

import logging
import os
import sys

import mcp.client.stdio  # noqa: F401 - imported at startup, with the SDK below
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext

from ontology_rag import agent_runtime, lake_agent, query_agent
from ontology_rag.errors import public_message

app = BedrockAgentCoreApp()
log = logging.getLogger("lake-agent")


def start_server():
    if os.environ.get("AGENT_SESSION_SERVER", "true").lower() == "false":
        return None
    server = query_agent.SessionServer(
        agent_runtime.LakeSettings(), starter=lake_agent.start_server, name="s3tables-mcp"
    )
    try:
        seconds = server.start(timeout_s=180)
        print(f"lake agent: MCP server started in {seconds:.1f} s", file=sys.stderr, flush=True)
    except Exception:
        log.exception("lake agent: the MCP server did not start; the first request retries")
    return server


@app.entrypoint
def invoke(payload: dict, context: RequestContext) -> dict:
    try:
        out = agent_runtime.handle_lake(payload, context.session_id, server=server)
    except Exception as exc:  # the caller gets the reason without ARNs, the log the traceback
        log.exception("lake agent failed")
        return {"error": public_message(exc)[:1000], "status": 502}
    if out.get("status") == "running" and out.get("job_id"):
        _busy(out["job_id"])
    return out


def _busy(job_id: str) -> None:
    """Report the session busy until the job ends (the SDK's async-task bookkeeping)."""
    import threading

    add = getattr(app, "add_async_task", None)
    done = getattr(app, "complete_async_task", None)
    if not add or not done:
        return
    task = add(f"lake-agent {job_id}")

    def watch() -> None:
        jobs = agent_runtime.lake_jobs()
        while (job := jobs.get(job_id)) and job["status"] == "running":
            threading.Event().wait(2)
        done(task)

    threading.Thread(target=watch, daemon=True).start()


server = start_server()

if __name__ == "__main__":
    app.run()
