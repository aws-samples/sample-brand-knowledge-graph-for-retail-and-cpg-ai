# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The Converse tool loop both agents run: the query agent over the Amazon Neptune MCP server
(query_agent.py: tab 3, and the graph agent of tab 6's trends question) and the data agent over
the S3 Tables MCP server (lake_agent.py, the trends question's method 2).

An agent here is a Bedrock model with the tools of an MCP server; the tools are not written in
this repository. For every request :func:`tool_loop`

1. connects to the server and lists its tools. ``connect`` yields the MCP client and the
   server's log: a stdio subprocess (:func:`stdio_server`), the server kept for the session on
   AgentCore Runtime (``query_agent.SessionServer``), or an in-process server in the tests;
2. lets the agent build the first request (``prepare``: the schema call and the plan of the
   query agent, the tables' schema and the one tool of the data agent);
3. runs the loop: one Converse turn, then every ``toolUse`` of the answer through the agent's
   ``execute`` (its read-only guard, the MCP ``call_tool``), the results as the next user turn,
   until the model answers without a tool, the tool budget is spent or the deadline is near;
4. hands back a :class:`Run`, which :func:`agent_result` turns into the one result shape the
   browser shows for both agents.

The step records (:func:`step`, :func:`model_step`) are what the browser draws as the agent's
trace: each with its start (``at_ms``) and length (``ms``), a model turn with its reasoning summary
when the model returns one as text; ``to_model`` is what went back to the model, bounded by the
agent (rows as JSON, compacted).
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import os
import site
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from ontology_rag import guardrail, hidden
from ontology_rag.vision import ModelInfo, token_usage

TO_MODEL_CHARS = 9000  # the longest tool result a step keeps (the agents cut their rows before)
TO_BROWSER_CHARS = 1500  # the browser gets a preview of it; the rows travel in the result


@dataclass
class Run:
    """What one loop produced: the trace, the answer, why it stopped (``None``, ``tools``,
    ``time``), the token usage, the tools the server offered, when it started, and how many
    steps were made before the model's first turn (list_tools, a schema call: not tool calls the
    model asked for)."""

    steps: list[dict]
    answer: str
    stopped: str | None
    tokens: dict
    offered: list[str]
    started: float
    fixed: int


async def tool_loop(
    svc,
    model: ModelInfo,
    connect,
    prepare,
    execute,
    deadline_s: float,
    model_turn_s: float,
    max_tool_calls: int,
    progress=None,
    tool_s: float | None = None,
    typed: tuple[str, ...] = (),
) -> Run:
    """Steps 1-3 above. ``prepare(client, log, tools, steps) -> request`` and ``execute(client,
    log, name, args, steps) -> step`` are the agent's; a model turn is not started when it might
    not end before the deadline. With ``tool_s`` (the longest a tool call may take), neither is a
    tool call: the run then ends within ``deadline_s`` (a background job's, query_agent.py).
    ``progress(text)``, when given, hears of every model turn and tool call (a background job
    shows it to the browser). ``typed``: what the person typed (the question), checked by the
    guardrail on every turn (guardrail.py); the schema and the tool results are not."""
    report = progress or (lambda text: None)
    started = time.perf_counter()
    steps: list[dict] = []
    tokens = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    answer, stopped, failure, offered, fixed = "", None, None, [], 0
    async with connect() as (client, log):  # 1. the MCP server
        try:
            listed = await client.list_tools()
            offered = [t.name for t in listed.tools]
            done(steps, step("mcp", "list_tools", {}, True, started, f"{len(offered)} tools"))
            request = await prepare(client, log, listed.tools, steps)  # 2. the first request
            fixed = len(steps)
            while True:
                if time.perf_counter() - started > deadline_s - model_turn_s:
                    stopped = "time"
                    break
                t0 = time.perf_counter()
                request = hidden.clean_request(request)  # invisible characters out, every turn
                request = guardrail.mark(getattr(svc, "settings", None), request, typed)
                response = await asyncio.to_thread(svc.bedrock.converse, **request)  # 3. a turn
                guardrail.check(response)
                message = response["output"]["message"]
                request["messages"].append(history(model, message))
                uses = [b["toolUse"] for b in message["content"] if "toolUse" in b]
                said = "".join(b.get("text", "") for b in message["content"])
                said = hidden.strip_hidden(said).strip()
                turn = done(steps, model_step(model, response, t0, uses, said, tokens))
                report(f"model turn {sum(s['kind'] == 'model' for s in steps)}: {turn['summary']}")
                if not uses:
                    answer = said
                    break
                if sum(s["kind"] != "model" for s in steps) - fixed >= max_tool_calls:
                    stopped, answer = "tools", said
                    break
                results = []
                for use in uses:  # every toolUse through the agent's guard and the MCP server
                    args = hidden.clean_value(use.get("input") or {})  # sanitized, then guarded
                    late = tool_s is not None
                    late = late and time.perf_counter() - started > deadline_s - tool_s
                    if late:  # it might not end before the deadline: answered, never run
                        error = "not run: the agent's time is up"
                        now = time.perf_counter()
                        called = done(
                            steps, step("guard", use["name"], args, False, now, "", error)
                        )
                    else:
                        called = await execute(client, log, use["name"], args, steps)
                    results.append(tool_result(use["toolUseId"], called))
                    n = sum(s["kind"] != "model" for s in steps) - fixed
                    report(f"tool call {n}: {called['name']}, {called['summary']}"[:300])
                request["messages"].append({"role": "user", "content": results})
        except Exception as exc:  # noqa: BLE001 - re-raised below, outside the client's task group
            failure = exc
    if failure:
        raise failure
    return Run(steps, answer, stopped, tokens, offered, started, fixed)


def agent_result(
    run: Run, text: str, error_in: str | None, model: ModelInfo, final_tool: str, mcp: dict
) -> dict:
    """Step 4: the last successful call of ``final_tool`` is the answer's query and its rows the
    result; ``mcp`` says which server answered (the agent fills in its package and endpoint)."""
    steps = run.steps
    final = next((s for s in reversed(steps) if s["name"] == final_tool and s["ok"]), None)
    return {
        "text": text,
        "error_in": error_in,
        "model": {"id": model.id, "name": model.name},
        "effort": model.effort,
        "answer": run.answer,
        "query": final["input"].get("query") if final else None,
        "rows": final["rows"] if final else [],
        "count": final["count"] if final else 0,
        "stopped": run.stopped,
        # each step with its start, in ms from the run's (the trace's time bar)
        "steps": [{**public(s), "at_ms": at_ms(s, run.started)} for s in steps],
        "metrics": {
            "total_ms": int((time.perf_counter() - run.started) * 1000),
            "model_ms": sum(s["ms"] for s in steps if s["kind"] == "model"),
            "tool_ms": sum(s["ms"] for s in steps if s["kind"] != "model"),
            "turns": sum(s["kind"] == "model" for s in steps),
            "tool_calls": sum(s["kind"] != "model" for s in steps) - run.fixed,
            "tokens": run.tokens,
        },
        "mcp": {**mcp, "transport": "stdio", "tools": run.offered},
    }


# ---------------------------------------------------------------------- the steps of the trace
def step(kind, name, args, ok, t0, summary="", error=None, to_model=None) -> dict:
    return {
        "kind": kind,  # mcp · guard · model
        "name": name,
        "input": args,
        "ok": ok,
        "t0": t0,  # when it started (perf_counter): agent_result turns it into at_ms
        "ms": int((time.perf_counter() - t0) * 1000),
        "summary": summary if ok else (error or ""),
        "error": None if ok else error,
        "to_model": ((to_model or "") if ok else f"{name} failed: {error}")[:TO_MODEL_CHARS],
    }


def at_ms(entry: dict, started: float) -> int:
    """When a step started, in ms from the start of the run."""
    return max(0, int((entry.get("t0", started) - started) * 1000))


def done(steps: list[dict], entry: dict) -> dict:
    entry["n"] = len(steps) + 1
    steps.append(entry)
    return entry


def model_step(model: ModelInfo, response: dict, t0, uses: list[dict], said: str, tokens) -> dict:
    usage = token_usage(response)
    for key, n in usage.items():
        tokens[key] += n
    wants = ", ".join(u["name"] for u in uses)
    entry = step("model", model.name, {}, True, t0, f"→ {wants}" if uses else "→ answer")
    entry["text"] = said[:TO_BROWSER_CHARS]
    entry["stop_reason"] = response.get("stopReason")
    entry["tokens"] = usage
    entry.update(reasoning_of(model, response["output"]["message"]))
    return entry


def reasoning_of(model: ModelInfo, message: dict) -> dict:
    """What the trace shows of a turn's reasoning: the summary of a model that returns it as text
    (Claude, ``reasoning``), or ``redacted`` when a turn reasoned and the text is not readable
    (an encrypted ``redactedContent`` block, Nova's "[REDACTED]." placeholder)."""
    readable = bool(model.reasoning and model.reasoning.get("readable"))
    texts, redacted = [], False
    for block in message.get("content") or []:
        thought = block.get("reasoningContent") if isinstance(block, dict) else None
        if not isinstance(thought, dict):
            continue
        if "redactedContent" in thought:
            redacted = True
        text = (thought.get("reasoningText") or {}).get("text")
        if isinstance(text, str) and text:
            if readable:
                texts.append(text)
            else:
                redacted = True
    out: dict = {}
    summary = hidden.strip_hidden("\n\n".join(texts)).strip()
    if summary:
        out["reasoning"] = summary[:TO_BROWSER_CHARS]
    if redacted:
        out["redacted"] = True
    return out


def history(model: ModelInfo, message: dict) -> dict:
    """The model's message as the conversation keeps it: unchanged (a Claude thinking block must
    go back as it came), or without its reasoning blocks for a model that fails on them (Kimi K3)."""
    if not model.strip_reasoning_history:
        return message
    content = [b for b in message.get("content") or [] if "reasoningContent" not in b]
    return {**message, "content": content}


def tool_result(tool_use_id: str, entry: dict) -> dict:
    """A step as the Converse ``toolResult`` block the model reads next."""
    return {
        "toolResult": {
            "toolUseId": tool_use_id,
            "content": [{"text": entry["to_model"] or "(no output)"}],
            "status": "success" if entry["ok"] else "error",
        }
    }


def public(entry: dict) -> dict:
    """A step as the browser gets it: no rows (the result has them), no start time (``at_ms``
    instead), what went back to the model shortened."""
    out = {k: v for k, v in entry.items() if k not in ("rows", "t0")}
    if len(out.get("to_model") or "") > TO_BROWSER_CHARS:
        out["to_model"] = out["to_model"][:TO_BROWSER_CHARS] + " …"
    return out


# ---------------------------------------------------------------------- the server as a subprocess
@contextlib.asynccontextmanager
async def stdio_server(params: dict):
    """An MCP server as a subprocess, spoken to over stdio. Its stderr goes to a file the client
    reads back after a failed tool call: MCP SDK 2.x withholds the text of a failed call from the
    client (the result only says "Error executing tool …") and logs it on the server's stderr."""
    from mcp import Client, StdioServerParameters
    from mcp.client.stdio import stdio_client

    with server_log() as (errlog, reader):
        async with Client(stdio_client(StdioServerParameters(**params), errlog=errlog)) as client:
            yield client, reader


@contextlib.contextmanager
def server_log():
    """A temporary file for the server's stderr: appended to by the subprocess, read by us."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "mcp-server.log"
        with open(path, "a", encoding="utf-8") as errlog, open(path, encoding="utf-8") as reader:
            yield errlog, reader


def subprocess_env(region: str, package: str, extra: dict[str, str]) -> dict[str, str]:
    """The subprocess's environment: this process's credentials (on AgentCore Runtime the
    runtime's execution role), the region, no logging but errors, no telemetry (OpenTelemetry
    off, and DO_NOT_TRACK for the libraries that phone home, such as Daft in the S3 Tables MCP
    server), plus the server's own variables. ``package`` is the server's Python package: a code
    zip (AgentCore Runtime) is put on the PYTHONPATH so a fresh interpreter finds it."""
    env = {
        **os.environ,
        "AWS_REGION": region,
        "AWS_DEFAULT_REGION": region,
        "FASTMCP_LOG_LEVEL": "ERROR",
        "OTEL_SDK_DISABLED": "true",
        "DO_NOT_TRACK": "true",
        **extra,
    }
    # opentelemetry-instrument (AgentCore Observability) puts its sitecustomize first on the
    # PYTHONPATH; the subprocess would load every instrumentation again (seconds per request) and
    # report spans outside the agent's trace. The server runs uninstrumented.
    paths = [p for p in env.get("PYTHONPATH", "").split(os.pathsep) if p]
    paths = [p for p in paths if not p.rstrip("/\\").endswith("auto_instrumentation")]
    root = package_root(package)
    if root and root not in paths:
        paths.insert(0, root)
    env.pop("PYTHONPATH", None)
    if paths:
        env["PYTHONPATH"] = os.pathsep.join(paths)
    return env


def installed(module: str) -> bool:
    """Whether ``module`` can be imported here. ``importlib.util.find_spec`` raises
    ``ModuleNotFoundError`` for a dotted name whose parent package is absent (the API Lambda has no
    ``awslabs`` package at all: the MCP servers live in the agents' zips), so that case is a plain
    ``False`` here rather than a 500 on tab 0."""
    try:
        return importlib.util.find_spec(module) is not None
    except ModuleNotFoundError:
        return False


def package_root(package: str) -> str | None:
    """The directory an MCP server package was installed into, when a fresh interpreter would
    not find it by itself (a deployment zip rather than a virtual environment); ``None`` when
    the package is not installed. Never the venv's own site-packages: a PYTHONPATH that points
    there breaks Python tools such as a credential_process the subprocess's boto3 may start."""
    spec = importlib.util.find_spec(package) if installed(package) else None
    if spec is None or not spec.origin:
        return None
    root = str(Path(spec.origin).resolve().parents[2])
    default = {str(Path(p).resolve()) for p in site.getsitepackages()}
    return None if root in default else root


def first_exception(group: BaseExceptionGroup) -> BaseException:
    """anyio task groups wrap what went wrong inside them: the innermost first exception."""
    exc: BaseException = group
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc
