# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Amazon Bedrock AgentCore Runtime entry point of the query agent (tab 3 and tab 6's method 1).

AgentCore starts this file (``opentelemetry-instrument main.py``) in the session's microVM and
sends every ``InvokeAgentRuntime`` request to ``POST /invocations`` on port 8080; ``GET /ping`` is
the SDK's health check. The work is ``ontology_rag.agent_runtime.handle``: the Converse tool loop
over the Amazon Neptune MCP server (query_agent.py). The SDK runs this sync handler in a worker
thread, so ``/ping`` keeps answering while the agent works.

Startup (module scope, before ``app.run()``) imports everything and starts the Amazon Neptune MCP
server, which then serves every request of the session (``query_agent.SessionServer``). On platform
version V2, AgentCore snapshots the started process (the server included) and restores the
snapshot for every new session, so that work is done once per runtime version; values that belong
to one session (its start time, its Bedrock client) are taken in the handler.

A request the agent cannot serve is answered with HTTP 200 and ``{"error", "status"}``: a non-2xx
status from the agent would reach the caller as a bare ``RuntimeClientError`` (424) without the
reason, and the API maps ``status`` to its own response (400, 409, 502).
"""

import logging
import os
import sys

import mcp.client.stdio  # noqa: F401 - imported at startup, with the SDK below
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext

from ontology_rag import agent_runtime, query_agent
from ontology_rag.errors import public_message

app = BedrockAgentCoreApp()
log = logging.getLogger("query-agent")


def start_server():
    """The session's Amazon Neptune MCP server, started now (no graph call). If it fails to
    start, the first request tries again (and reports why)."""
    if os.environ.get("AGENT_SESSION_SERVER", "true").lower() == "false":
        return None
    server = query_agent.SessionServer(agent_runtime.AgentSettings())
    try:
        seconds = server.start()
        print(f"query agent: MCP server started in {seconds:.1f} s", file=sys.stderr, flush=True)
    except Exception:
        log.exception("query agent: the MCP server did not start; the first request retries")
    return server


@app.entrypoint
def invoke(payload: dict, context: RequestContext) -> dict:
    try:
        return agent_runtime.handle(payload, context.session_id, server=server)
    except Exception as exc:  # the caller gets the reason without ARNs, the log the traceback
        log.exception("query agent failed")
        return {"error": public_message(exc)[:1000], "status": 502}


server = start_server()

if __name__ == "__main__":
    app.run()
