# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6's trends question ("What are the emerging trends we see this season?", the creative
director): the two agent methods, compared on the same graph (see docs/emerging-trends.md). The
question's third method, the clouds, is lenses.py's.

"Emerging" is the same for both methods: what the **new content** (the photos and texts tab 2
ingested; ``run`` set on their items) has more of than the **baseline**, the brand's lookbook. A
group's lift is its share of the new content over its share of the lookbook (smoothed); it is
computed here, never by a model.

Method 1: ask the graph agent (Amazon Neptune MCP server)
    :func:`graph_start`: tab 3's query agent gets the definition in plain words
    (:data:`AGENT_QUESTION`) and writes its own openCypher, as a background job of up to 5
    minutes; :func:`groups_from_rows` counts the groups in its rows again (:func:`_group`).
Method 2: export to Iceberg, ask the data agent (Amazon S3 Tables MCP server)
    lakehouse.py writes the graph's items and features to two Iceberg tables; :func:`lake_start`
    gives the data agent the same definition for SQL (:data:`LAKE_QUESTION`), and
    :func:`lake_poll` counts its groups with the same code.

Each agent run uses the model and reasoning effort the participant chose (vision.with_effort), and
every result carries ``metrics``: wall time, model turns, tool calls and tokens.
"""

from __future__ import annotations

import re
import secrets
import time
from collections import Counter

from ontology_rag import jobs, lakehouse, query_agent
from ontology_rag.errors import NotReady
from ontology_rag.vision import with_effort

MIN_CONFIDENCE = 0.5  # ingested items the vision model was unsure about stay out of the counts
TOP_GROUPS = 8


def lift(n_new: int, total_new: int, n_base: int, total_base: int) -> float:
    """Share of the new content over share of the lookbook, with add-half smoothing (a group the
    lookbook does not have at all does not divide by zero, and 1 of 2 is not a trend of 50 %)."""
    return ((n_new + 0.5) / (total_new + 1)) / ((n_base + 0.5) / (total_base + 1))


# ====================================================================== the graph's two sides
# What an item is described by on both sides: its category and its values. Components (HAS_PART)
# come from ingestion only (the lookbook's items carry none), so comparing them would call every
# component "emerging"; the same goes for a value family the lookbook never uses (``_dimension``).
FEATURE_EDGES = ["IS_CATEGORY", "HAS_ATTRIBUTE"]


def _dimension(feature_id: str) -> str:
    """``category:coat`` → ``category``; ``attribute:length:knee`` → ``attribute:length``."""
    kind, _, rest = feature_id.partition(":")
    return kind if kind != "attribute" else f"attribute:{rest.split(':', 1)[0]}"


def _items(svc) -> tuple[list, list, dict[str, set[str]], dict[str, str], list[str]]:
    """The new items (``run`` set, confident enough) and the lookbook's, the vocabulary each links
    to (one round trip, only in the dimensions the lookbook is described in), the names of the
    vocabulary nodes, and the dimensions left out."""
    items = svc.store.get_nodes("Item", 5000)
    new = [i for i in items if i.props.get("run") and _confident(i)]
    base = [i for i in items if not i.props.get("run")]
    links = svc.store.neighbor_ids([i.id for i in new + base], FEATURE_EDGES)
    dims = {_dimension(f) for i in base for f in links.get(i.id, set())}
    left_out = sorted({_dimension(f) for fs in links.values() for f in fs} - dims)
    links = {k: {f for f in fs if _dimension(f) in dims} for k, fs in links.items()}
    names = {
        n.id: n.name
        for label in ("Attribute", "Category")
        for n in svc.store.get_nodes(label, 5000)
    }
    return new, base, links, names, left_out


def _confident(item) -> bool:
    try:
        c = float(item.props.get("confidence", 1))
    except (TypeError, ValueError):
        return True
    return c < 0 or c >= MIN_CONFIDENCE  # -1 = the model gave none


def _members(feature_ids: list[str], items: list, links: dict[str, set[str]]) -> list:
    want = set(feature_ids)
    return [i for i in items if want <= links.get(i.id, set())]


def _pieces(items: list) -> int:
    """How many pieces of content the items stand for: a new item counts once per source it was
    ingested from (a photo's left and right shoe are one piece of evidence; so is a photo ingested
    twice), a lookbook garment is one garment."""
    return len(
        {
            ("source", i.props.get("source") or i.props.get("run")) if i.props.get("run") else i.id
            for i in items
        }
    )


def _feature(fid: str, names: dict[str, str]) -> dict:
    kind, _, rest = fid.partition(":")
    family = rest.split(":", 1)[0] if kind == "attribute" else ""
    return {"id": fid, "name": names.get(fid, rest.split(":")[-1]), "kind": kind, "family": family}


def _group(gid: str, feats: list[str], new, base, links, names) -> dict:
    """One group: its properties, how many new and lookbook items have them all, its lift, and
    what is adjacent in the graph: the items themselves and the other properties the group's new
    items share (the context a model needs to say what the trend looks like)."""
    mn, mb = _members(feats, new, links), _members(feats, base, links)
    around = Counter(f for i in mn for f in links.get(i.id, set()) if f not in feats)
    return {
        "id": gid,
        "features": [_feature(f, names) for f in feats],
        "support_new": _pieces(mn),
        "support_base": len(mb),
        "lift": round(lift(_pieces(mn), _pieces(new), len(mb), len(base)), 2),
        "items_new": [
            {"id": i.id, "name": i.name, "source": i.props.get("source", "")} for i in mn[:6]
        ],
        "items_base": [
            {"id": i.id, "name": i.name, "line": str(i.props.get("line", "")).split(":")[-1]}
            for i in mb[:6]
        ],
        "also": [{**_feature(f, names), "count": c} for f, c in around.most_common(5) if c >= 2],
    }


def groups_from_rows(rows: list, new, base, links, names, left_out) -> list[dict]:
    """An agent's rows (method 1's openCypher, method 2's SQL) as groups: the vocabulary node ids
    in each row (only ones the graph has, in dimensions both sides use), counted again by
    :func:`_group`, so every method's numbers come from the same code."""
    groups = []
    dims = {_dimension(f) for i in base for f in links.get(i.id, set())}
    for row in rows:
        if not isinstance(row, dict):
            continue
        feats = [
            str(v)
            for v in row.values()
            if isinstance(v, str) and re.match(r"^(attribute|category):", v)
        ]
        feats = [
            f
            for f in dict.fromkeys(feats)
            if f in names and _dimension(f) in dims and _dimension(f) not in left_out
        ]
        if feats:
            groups.append(_group(f"G{len(groups) + 1}", feats[:3], new, base, links, names))
        if len(groups) >= TOP_GROUPS:
            break
    return groups


# ====================================================================== method 1 · the graph agent
# The prompt of method 1's agent: the definition of emerging in plain words. {new} and {base} are
# counted in the graph when the agent starts (new pieces of content, lookbook items), {new_1} and
# {base_1} are the same plus one (the lift's smoothing), {skip} names the value families the
# lookbook never uses. How it works shows this template; the job's result has the text it became.
AGENT_QUESTION = (
    "Find what is EMERGING in this brand graph. The new content is the Item nodes WITH a `run` "
    "property and a `source` (the photo or text it was ingested from: {new} sources); count "
    "only those whose `confidence` is -1 or at least 0.5, and count them by DISTINCT `source` "
    "(a pair of shoes is one piece of evidence); the baseline is the lookbook, the Item nodes WITHOUT "
    "`run` ({base} garments). Items link to Attribute nodes (HAS_ATTRIBUTE) and Category nodes "
    "(IS_CATEGORY); ignore HAS_PART (the lookbook has no components){skip}.\n"
    "In one read-only query: for pairs of distinct Attribute or Category nodes a and b that "
    "are both linked from the same new items of at least 2 sources, count those sources "
    "(support_new) and the lookbook garments (support_base) linked to both, and return the top 10 "
    "rows by lift = ((support_new + 0.5) / {new_1}) / ((support_base + 0.5) / {base_1}), with "
    "the columns a_id (id(a)), a_name, b_id (id(b)), b_name, support_new, support_base, lift. "
    "Then name each pair in plain words."
)


def agent_question(n_new: int, n_base: int, left_out: list[str]) -> str:
    """Method 1: :data:`AGENT_QUESTION` with this graph's numbers."""
    families = ", ".join(f"`{d}:`" for d in left_out if d.startswith("attribute:"))
    skip = f" and the Attribute nodes whose id starts with {families} (the lookbook has none)"
    return AGENT_QUESTION.format(
        new=n_new, base=n_base, new_1=n_new + 1, base_1=n_base + 1, skip=skip if families else ""
    )


def graph_groups(
    svc,
    model_id: str | None = None,
    session_id: str | None = None,
    deadline_s: float | None = None,
    progress=None,
    effort: str | None = None,
) -> dict:
    """Method 1: groups of properties the new items share more than the lookbook's, with their
    adjacent items. The agent finds them (it writes its own openCypher through the Amazon Neptune
    MCP server, with the model and ``effort`` chosen), and :func:`_group` counts each again, the
    same code as method 2's. It runs as a background job (:func:`graph_start`), which gives it
    ``deadline_s`` and hears from ``progress(text)`` what it is doing."""
    report = progress or (lambda text: None)
    started = time.perf_counter()
    report("reading the new items and the lookbook from the graph")
    new, base, links, names, left_out = _items(svc)
    load_ms = int((time.perf_counter() - started) * 1000)
    totals = {"new": _pieces(new), "new_items": len(new), "base": len(base), "left_out": left_out}
    if not new:
        raise NotReady("no new items yet: ingest photos or texts in tab 2 first")
    t = time.perf_counter()
    report(_agent_step(svc, deadline_s))
    agent = svc.query_agent(
        agent_question(_pieces(new), len(base), left_out),
        None,
        model_id,
        session_id,
        deadline_s=deadline_s,
        progress=report,
        effort=effort,
    )
    report("counting the groups in the agent's rows")
    groups = groups_from_rows(agent.get("rows") or [], new, base, links, names, left_out)
    m = agent.get("metrics") or {}
    tok = m.get("tokens") or {}
    return {
        "mode": "agent",
        "groups": groups,
        "totals": totals,
        "agent": agent,
        "metrics": {
            "total_ms": int((time.perf_counter() - started) * 1000),
            "load_ms": load_ms,
            "group_ms": int((time.perf_counter() - t) * 1000),
            "llm_calls": int(m.get("turns", 0) or 0),
            "tool_calls": int(m.get("tool_calls", 0) or 0),
            "images": 0,
            "tokens": {
                k: int(tok.get(k, 0) or 0) for k in ("input", "output", "cache_read", "cache_write")
            },
        },
    }


# ---------------------------------------------------------------------- method 1 as a job
# The agent writes, runs and fixes its own openCypher; on a large graph or with a slow model that
# takes longer than the 70 s an API call leaves it. As a job it may work for 5 minutes
# (query_agent.MAX_DEADLINE_S, where the whole chain of limits is): the API starts it and the
# browser polls (``POST``, then ``GET /api/trends/graph?id=``); without a pipeline function (the
# tests) a thread of this process (jobs.Jobs), deployed an asynchronous invocation of the pipeline function (jobs.FunctionJobs),
# which calls the agent's runtime and writes the result into the record under jobs/trends/.
GRAPH_STEP = "trends_graph"  # the pipeline function's event["step"] (lambda_handler)
GRAPH_KIND = "trends graph agent"
GRAPH_JOB_ID = re.compile(r"^graph-[0-9a-f]{32}$")  # graph_start's ids


def _agent_step(svc, deadline_s: float | None) -> str:
    where = "on AgentCore Runtime" if svc.settings.agent_runtime_arn else "in this process"
    limit = f" (up to {deadline_s:.0f} s)" if deadline_s else ""
    return f"{where}: writing and running openCypher{limit}"


def graph_start(svc, model_id: str | None = None, effort: str | None = None) -> dict:
    """Method 1, started: what a request can get wrong is checked now (the agent is available, the
    model is offered and so is the effort, the graph has new items), the agent's run goes to a job
    with the job's deadline. The job id is 128 random bits; the job's runtime session is its own."""
    status = svc.query_agent_status()
    if not status["available"]:
        raise NotReady(status["reason"])
    model = with_effort(svc.answer_model(model_id), effort)  # a level it does not offer: a 400
    inputs = {"model_id": model.id, "effort": model.effort}
    if not _items(svc)[0]:
        raise NotReady("no new items yet: ingest photos or texts in tab 2 first")
    job_id = f"graph-{secrets.token_hex(16)}"
    runner = svc.graph_jobs
    if isinstance(runner, jobs.FunctionJobs):  # deployed: the pipeline function runs it
        return runner.start(job_id, GRAPH_STEP, inputs, GRAPH_KIND)

    def work() -> dict:  # without a pipeline function: a thread of this process
        return _graph_agent(svc, job_id, inputs, runner.progress)

    return runner.start(work, kind=GRAPH_KIND, job_id=job_id)


def _graph_agent(svc, job_id: str, inputs: dict, progress) -> dict:
    """The job's work: :func:`graph_groups`, in a runtime session named after the job (so tab 3's
    requests never queue behind it), with the deadline of a background job and the effort the job
    was started with."""
    return graph_groups(
        svc,
        inputs["model_id"],
        f"trends-{job_id}",
        deadline_s=query_agent.MAX_DEADLINE_S,
        progress=progress,
        effort=inputs.get("effort"),
    )


def graph_poll(svc, job_id: str) -> dict | None:
    """The job as it is now (``running`` with its ``step``, ``done`` with the result of
    :func:`graph_groups`, or ``failed`` with the error); ``None`` for an unknown id."""
    return svc.graph_jobs.get(job_id)


def graph_job(svc, job_id: str) -> dict | None:
    """The pipeline function's side of the job (``lambda_handler.pipeline_handler``, step
    ``trends_graph``): the agent's run on its AgentCore runtime, waited for with
    Service.agentcore_job, then the groups counted and the result written into the record."""
    if not GRAPH_JOB_ID.match(job_id):
        raise ValueError(f"not a graph agent job id: {job_id!r}")
    runner = jobs.FunctionJobs(svc.blobs, jobs.TREND_RECORDS)
    return runner.run(job_id, lambda inputs, progress: _graph_agent(svc, job_id, inputs, progress))


# ====================================================================== method 2 · the lakehouse
# The prompt of method 2's data agent: the same definition as method 1, for the tables. The
# placeholders are those of AGENT_QUESTION; {skip} names the value families as SQL patterns.
LAKE_QUESTION = (
    "Discover what is EMERGING in this brand's content, and explain why. The new content is "
    "the rows of items with origin = 'new' (ingested from photos and texts; count only those "
    "with confidence = -1 or confidence >= 0.5), counted as pieces of content with COUNT(DISTINCT "
    "source): {new} pieces. The baseline is the lookbook, origin = 'lookbook', counted as "
    "garments: {base} garments. Compare only what both are described in: item_features rows with "
    "relation IS_CATEGORY or HAS_ATTRIBUTE (the lookbook has no HAS_PART rows){skip}.\n"
    "Find pairs of distinct features a and b (a.feature_id < b.feature_id) on the same "
    "new item in at least 2 pieces of content; for each pair count the pieces (support_new) "
    "and the lookbook garments with both (support_base), and rank by "
    "lift = ((support_new + 0.5) / {new_1}.0) / ((support_base + 0.5) / {base_1}.0). "
    "The last query you run must return the top 10 pairs with the columns a_id, a_name, b_id, "
    "b_name, support_new, support_base, lift. Then name the trends and explain them."
)


def lake_question(n_new: int, n_base: int, left_out: list[str]) -> str:
    """Method 2: :data:`LAKE_QUESTION` with this graph's numbers."""
    families = ", ".join(f"'{d}:%'" for d in left_out if d.startswith("attribute:"))
    skip = f" and no feature_id LIKE {families} (the lookbook has none)"
    return LAKE_QUESTION.format(
        new=n_new, base=n_base, new_1=n_new + 1, base_1=n_base + 1, skip=skip if families else ""
    )


def lake_start(
    svc, model_id: str | None, session_id: str | None, effort: str | None = None
) -> dict:
    """Method 2, step 2: the question to the data agent (a background job), with the model and
    ``effort`` chosen; both are checked before the graph is read (a 400)."""
    model = with_effort(svc.answer_model(model_id), effort)
    new, base, _, _, left_out = _items(svc)
    if not new:
        raise NotReady("no new items yet: ingest photos or texts in tab 2 first")
    question = lake_question(_pieces(new), len(base), left_out)
    job = lakehouse.ask(svc, question, model.id, session_id, model.effort)
    return {**job, "question": question}


def lake_poll(svc, job_id: str, session_id: str | None) -> dict:
    """The job's state; once done, the groups in the agent's rows, counted again by the same
    code as method 1's (so the methods compare), and the run's numbers."""
    job = lakehouse.poll(svc, job_id, session_id)
    if job.get("status") != "done":
        return job
    agent = job.get("result") or {}
    started = time.perf_counter()
    new, base, links, names, left_out = _items(svc)
    groups = groups_from_rows(agent.get("rows") or [], new, base, links, names, left_out)
    m = agent.get("metrics") or {}
    tok = m.get("tokens") or {}
    return {
        **{k: v for k, v in job.items() if k != "result"},
        "result": {
            "agent": agent,
            "groups": groups,
            "totals": {
                "new": _pieces(new),
                "new_items": len(new),
                "base": len(base),
                "left_out": left_out,
            },
            "metrics": {
                "total_ms": int(m.get("total_ms", 0) or 0),
                "recount_ms": int((time.perf_counter() - started) * 1000),
                "llm_calls": int(m.get("turns", 0) or 0),
                "tool_calls": int(m.get("tool_calls", 0) or 0),
                "images": 0,
                "tokens": {
                    k: int(tok.get(k, 0) or 0)
                    for k in ("input", "output", "cache_read", "cache_write")
                },
            },
        },
    }
