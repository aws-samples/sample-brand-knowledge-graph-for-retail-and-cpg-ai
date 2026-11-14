# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Framework-neutral HTTP routing behind the Lambda handler (lambda_handler.api_handler).

Each route takes ``(service, query_params, body_dict)`` and returns ``(status, payload)``, so the
tests drive the same routes the deployed API serves.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import time
from collections.abc import Callable

from ontology_rag import (
    classify,
    guardrail,
    lakehouse,
    lenses,
    payoff,
    previews,
    setup,
    trends,
)
from ontology_rag.errors import NotReady, aws_error_code, aws_message, public_message, redact_arns
from ontology_rag.hidden import strip_hidden
from ontology_rag.ontologies import EXAMPLE_SETS, SAFE_FILE, parse_upload
from ontology_rag.owl import MAX_UPLOAD_BYTES
from ontology_rag.pipeline import MAX_TEXT_CHARS
from ontology_rag.service import MAX_EXPLORE_IDS, Service

log = logging.getLogger(__name__)
Route = Callable[[Service, dict, dict], tuple[int, dict]]

# The largest photo a request may carry (decoded bytes). Bedrock Converse takes images up to
# about 3.75 MB raw on current models; the web app checks the same limit on the file before it
# encodes it (web/src/limits.ts), so one number is told to the user on both sides.
MAX_IMAGE_BYTES = 4 * 1024 * 1024

# The shapes of the ids a request may carry; anything else is a 400 before a route runs with it.
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")  # an ontology folder
_RUN_ID = re.compile(r"^run-[0-9]{8}-[0-9]{6}-[a-f0-9]{4}$")  # pipeline.new_run_id
_JOB_ID = re.compile(r"^lake-[0-9a-f]{12}$")  # jobs.Jobs, prefix lake
_GRAPH_JOB_ID = trends.GRAPH_JOB_ID  # trends.graph_start: graph-<32 hex>
# A Lambda request id: a UUID. The log route filters the API's log group
# by this string, so a looser shape would let any word of the log lines through as a filter.
_REQUEST_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# A Lambda log stream: date/[version]instance, with the function name before the version when the
# function logs to a log group the stack names (LoggingConfig), as the API does.
_LOG_STREAM = re.compile(
    r"^\d{4}/\d{2}/\d{2}/([A-Za-z0-9_-]{1,64})?\[(\$LATEST|\d+)\][0-9a-f]{32}$"
)
# AgentCore Runtime session ids: at least 33 characters (one per browser tab, see GraphQuery.tsx).
_SESSION_ID = re.compile(r"^[A-Za-z0-9-]{33,100}$")
# A graph node id (item:atlas-trench, st:1a2b3c4d-1, attribute:dressy-(nickname)).
_NODE_ID = re.compile(r"^[A-Za-z0-9_.:#()-]{1,200}$")
# Neptune Analytics ExecuteQuery errors that mean "this query is wrong", not "the service is down".
_BAD_QUERY = {"ValidationException", "MalformedQueryException", "UnprocessableException"}


def _int(v, default: int, lo: int = 1, hi: int = 50) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _image(body: dict) -> tuple[bytes, str]:
    data = body.get("image_base64") or ""
    if data.startswith("data:"):
        # data URL: data:image/png;base64,....
        header, _, data = data.partition(",")
        fmt_match = re.search(r"image/(\w+)", header)
        body.setdefault("format", fmt_match.group(1) if fmt_match else "jpeg")
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image_base64 is not valid base64") from exc
    if not raw:
        raise ValueError("image_base64 is required")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"image larger than {MAX_IMAGE_BYTES // 1024 // 1024} MB")
    fmt = str(body.get("format") or "jpeg").lower().lstrip(".")
    if fmt not in ("jpeg", "jpg", "png", "webp", "gif"):
        raise ValueError(f"unsupported image format {fmt!r}")
    return raw, {"jpg": "jpeg"}.get(fmt, fmt)


# ------------------------------------------------------------------ handlers
def health(svc, q, b):
    return 200, svc.health()


def summary(svc, q, b):
    return 200, svc.summary()


def ontology(svc, q, b):
    return 200, svc.ontology_json()


def nodes(svc, q, b):
    label = str(q.get("label") or "Item")
    if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", label):
        return 400, {"error": "invalid label"}
    return 200, {"label": label, "nodes": svc.nodes(label, _int(q.get("limit"), 200, 1, 1000))}


def node(svc, q, b):
    node_id = str(q.get("id") or b.get("id") or "")
    if not node_id:
        return 400, {"error": "id is required"}
    result = svc.node(node_id)
    return (200, result) if result else (404, {"error": f"node {node_id} not found"})


def graph_source(svc, q, b):
    """The photo or page a node of tab 3's evidence tree came from (previews.py): the preview next
    to a box. ``domain`` is the ontology folder whose example photos the node may name, ``near``
    the tree's other nodes (comma-separated, closest first): a category's photos and pages from
    the tree come first."""
    node_id = str(q.get("id") or "")
    domain = str(q.get("domain") or "")
    near = [i for i in str(q.get("near") or "").split(",") if i]
    if not _NODE_ID.match(node_id):
        return 400, {"error": "id must be a graph node id"}
    if domain and not _ID.match(domain):
        return 400, {"error": "domain must be an ontology folder id"}
    if len(near) > previews.MAX_NEAR or not all(_NODE_ID.match(i) for i in near):
        return 400, {"error": f"near must be at most {previews.MAX_NEAR} graph node ids"}
    try:
        result = svc.node_source(node_id, domain or None, near)
    except KeyError:
        return 404, {"error": f"ontology {domain!r} not found"}
    return (200, result) if result else (404, {"error": f"node {node_id} not found"})


def photo(svc, q, b):
    """One of a data set's photos by its stable key (a look's ``image_key``, a catalog product's),
    as a data URL inside JSON, so the browser reads it like any other answer. Only keys of the
    form ``<set>/<sub>/<file>`` (previews.STORED_PHOTO)."""
    key = str(q.get("key") or "")
    if not previews.is_stored_photo(key):
        return 400, {"error": previews.STORED_PHOTO_RULE}
    try:
        return 200, svc.photo(key)
    except FileNotFoundError:
        return 404, {"error": f"photo {key} is not stored in this deployment"}


def explore(svc, q, b):
    ids = [i for i in str(q.get("ids") or b.get("ids") or "").split(",") if i]
    if isinstance(b.get("ids"), list):
        ids = [str(i) for i in b["ids"]]
    label = str(q.get("label") or b.get("label") or "")
    hops = _int(q.get("hops") or b.get("hops"), 1, 1, 3)
    limit = _int(q.get("limit") or b.get("limit"), 200, 1, 1000)
    if not ids and not label:
        return 400, {"error": "ids or label is required"}
    if len(ids) > MAX_EXPLORE_IDS:
        return 400, {"error": f"at most {MAX_EXPLORE_IDS} ids"}
    return 200, svc.explore(ids, label, hops, limit)


# ------------------------------------------------------------------ tab 4 · Build the retriever
_CATALOG_KEY = re.compile(r"^[A-Za-z0-9_.:\-]{1,200}$")
_NODE_ID = re.compile(r"^[A-Za-z0-9_.:\-]{1,200}$")


def _question(b: dict) -> str:
    question = str(b.get("question") or "").strip()
    if not question:
        raise ValueError("question is required")
    return question[:2000]


def _model(svc, b: dict) -> str:
    return svc.answer_model(str(b.get("model_id") or "") or None).id


def catalog_info(svc, q, b):
    """Stage 1 and tab 0's product count: the catalog index (S3 Vectors): where it is, its shape,
    its size."""
    return 200, payoff.catalog_info(svc)


def catalog_items(svc, q, b):
    return 200, payoff.catalog_browse(svc, _int(q.get("n"), 12, 1, 50))


def catalog_item(svc, q, b):
    key = str(q.get("key") or "")
    if not _CATALOG_KEY.match(key):
        return 400, {"error": "key must be a catalog item key"}
    return 200, payoff.catalog_item(svc, key)


def catalog_search(svc, q, b):
    """Stage 1: raw similarity search on the catalog."""
    text = str(b.get("query") or "").strip()
    if not text:
        return 400, {"error": "query is required"}
    return 200, payoff.catalog_query(
        svc, text[: payoff.MAX_SEARCH_CHARS], _int(b.get("k"), 6, 1, 20)
    )


def retriever_llm(svc, q, b):
    """Tab 0's cold open: the model on its own, the same prompt as tab 5's first column."""
    return 200, payoff.llm_only(svc, _model(svc, b), _question(b))


def retriever_plan(svc, q, b):
    """Stage 2a: the model's own taste, as catalog searches."""
    return 200, payoff.plan(svc, _model(svc, b), _question(b))


def retriever_rag(svc, q, b):
    """Stage 2b: the (edited) searches through the catalog, then the answer."""
    searches = b.get("searches")
    return 200, payoff.rag(
        svc, _model(svc, b), _question(b), payoff.clean_searches(searches) if searches else None
    )


def retriever_anchors(svc, q, b):
    """Stage 3a: the way into the graph, by vector search on its garments."""
    return 200, payoff.find_anchors(svc, _question(b))


def retriever_traverse(svc, q, b):
    """Stage 3b: the traversal from the anchors (read-only), its rows and counts."""
    anchors = b.get("anchors")
    if not isinstance(anchors, list) or not anchors or len(anchors) > payoff.MAX_ANCHORS:
        return 400, {"error": f"anchors must be a list of 1 to {payoff.MAX_ANCHORS} node ids"}
    if not all(isinstance(a, str) and _NODE_ID.match(a) for a in anchors):
        return 400, {"error": "anchors must be node ids"}
    return 200, payoff.traverse(svc, anchors, str(b.get("cypher") or payoff.TRAVERSAL))


def retriever_graphrag(svc, q, b):
    """Stage 3d: the guidance through the same catalog search, then the answer."""
    return 200, payoff.graphrag(
        svc, _model(svc, b), _question(b), str(b.get("cypher") or payoff.TRAVERSAL)
    )


def retriever_understand(svc, q, b):
    """The smart retriever, step 1 alone: the question as start pieces, a target, must-haves."""
    return 200, payoff.understand(svc, _model(svc, b), _question(b))


def retriever_smart(svc, q, b):
    """The smart retriever: understand the question, the same search and traversal, the filter
    on what is looked for, and the answer with notes on what the lookbook does not have."""
    return 200, payoff.smart_graphrag(svc, _model(svc, b), _question(b))


def retriever_templates(svc, q, b):
    """Stage 3a's query before it runs and the numbers that pick the anchors; stage 3b's
    traversal, shown read-only in tab 4."""
    return 200, {
        "anchor_query": payoff.anchor_query(None, dimension=svc.settings.embedding_dimension),
        "anchor": {
            "candidates": payoff.ANCHOR_CANDIDATES,
            "shown": payoff.ANCHOR_SHOWN,
            "band": payoff.ANCHOR_BAND,
        },
        "traversal": payoff.TRAVERSAL,
    }


def payoff_route(svc, q, b):
    """ "Same question, three answers": LLM only, RAG on the product catalog and GraphRAG on the style DNA
    (the smart retriever), each with its receipts; with the participant's own traversal and
    searches when given. Style recommendation: with the shopper's photo of one piece
    (``image_base64``), which all three see and GraphRAG embeds to find the way in."""
    searches = b.get("searches")
    return 200, payoff.run(
        svc,
        _question(b),
        str(b.get("model_id") or "") or None,
        str(b.get("cypher") or "") or None,
        payoff.clean_searches(searches) if searches else None,
        _image(b) if b.get("image_base64") else None,
    )


def ask_models(svc, q, b):
    return 200, svc.answer_models()


# ------------------------------------------------------------------ tab 6 · What else the graph knows
def lenses_list(svc, q, b):
    """Every lens's steps, the openCypher the tab shows and lets the participant edit."""
    return 200, lenses.catalog_of_lenses()


def lenses_count(svc, q, b):
    """Run one lens: the pieces' vector search, the (edited) openCypher, any catalog step."""
    return 200, lenses.count(
        svc, str(b.get("lens") or ""), str(b.get("cypher") or "") or None, str(b.get("start") or "")
    )


def lenses_explain(svc, q, b):
    """A model explains the numbers the count returned, citing only them."""
    columns, rows = b.get("columns"), b.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return 400, {"error": "columns and rows are required"}
    if (
        len(columns) > 12
        or len(rows) > lenses.MAX_ROWS
        or any(not isinstance(r, list) for r in rows)
    ):
        return 400, {"error": f"at most 12 columns and {lenses.MAX_ROWS} rows"}
    return 200, lenses.explain(
        svc,
        _model(svc, b),
        str(b.get("lens") or ""),
        [str(c)[:60] for c in columns],
        [[str(x)[:120] if isinstance(x, str) else x for x in r[:12]] for r in rows],
    )


def _check_photo(svc, b: dict) -> tuple[bytes, str]:
    """The outfit to check: one of a domain's listed example photos (``ontology_id``, default the
    graph's domain, and ``example``, its file name; a data set's new work is listed there too),
    or an upload. KeyError for an unknown domain, FileNotFoundError for an unlisted file."""
    if "photo_key" in b:
        raise ValueError(
            "photo_key is not read any more: send ontology_id and example (the file name of a "
            "listed example photo), or an upload"
        )
    example = str(b.get("example") or "")
    if not example:
        return _image(b)
    oid = str(b.get("ontology_id") or svc.ontology_id)
    if not _ID.match(oid):
        raise ValueError("ontology_id must be an ontology folder id")
    if not SAFE_FILE.match(example):
        raise ValueError("example must be the file name of a listed example photo")
    return classify.load_image(svc, oid, example)


def _photo_not_found(svc, b: dict, exc: Exception) -> tuple[int, dict]:
    if isinstance(exc, KeyError):
        return 404, {
            "error": f"ontology {str(b.get('ontology_id') or svc.ontology_id)!r} not found"
        }
    return 404, {"error": f"example {str(b.get('example'))!r} not found"}


def lenses_check_looks(svc, q, b):
    """Is this photo on-brand, steps 1-2: vector search on the looks, the walk to their garments."""
    try:
        photo = _check_photo(svc, b)
    except (KeyError, FileNotFoundError) as exc:
        return _photo_not_found(svc, b, exc)
    return 200, lenses.check_looks(svc, photo, str(b.get("cypher") or "") or None)


def lenses_check_pieces(svc, q, b):
    """Step 3: the helper model per piece, then the fixed rule."""
    looks = b.get("looks")
    if not isinstance(looks, list) or not looks or not all(isinstance(x, dict) for x in looks):
        return 400, {"error": "looks (from the vector search and the walk) are required"}
    try:
        photo = _check_photo(svc, b)
    except (KeyError, FileNotFoundError) as exc:
        return _photo_not_found(svc, b, exc)
    return 200, lenses.check_pieces(svc, _model(svc, b), photo, looks[: lenses.CHECK_LOOKS])


def _cloud_ids(b: dict) -> list[str]:
    """The cloud the participant clicked on the trends map: 1 to MAX_CLOUD_ITEMS node ids."""
    ids = b.get("ids")
    if not isinstance(ids, list) or not ids or len(ids) > lenses.MAX_CLOUD_ITEMS:
        raise ValueError(f"ids must be a list of 1 to {lenses.MAX_CLOUD_ITEMS} node ids")
    if not all(isinstance(i, str) and _NODE_ID.match(i) for i in ids):
        raise ValueError("ids must be node ids")
    return ids


def lenses_trends_map(svc, q, b):
    """Emerging trends, step 1: every worn garment with its vector, for the browser's map."""
    return 200, lenses.trends_map(svc)


def lenses_trends_cloud(svc, q, b):
    """Step 3: the clicked cloud, walked to its looks and what is worn there (the edited walk)."""
    return 200, lenses.trends_cloud(svc, _cloud_ids(b), str(b.get("cypher") or "") or None)


def lenses_trends_describe(svc, q, b):
    """Steps 4 and 5: the walk again, here, then the model describes the pieces and their looks."""
    return 200, lenses.describe(
        svc, _model(svc, b), _cloud_ids(b), str(b.get("cypher") or "") or None
    )


# ------------------------------------------------------------------ tab 6 · the trends question
def trends_graph(svc, q, b):
    """Method 1: the graph agent finds groups of properties the new items share more than the
    catalog's, with the model and reasoning ``effort`` chosen. It may work for up to 5 minutes,
    so this starts a job (trends.graph_start) and returns its id; ``GET /api/trends/graph?id=``
    polls it."""
    if (b.get("mode") or "agent") != "agent":
        return 400, {"error": "mode must be agent: the tested query was removed"}
    model_id = str(b.get("model_id") or "") or None
    return 200, trends.graph_start(svc, model_id, b.get("effort"))


def trends_graph_poll(svc, q, b):
    """Method 1, polled: ``running`` (with what the agent does), ``done`` (the groups and the
    agent's answer) or ``failed`` (the error); 404 for an id that is no job of yours."""
    job_id = str(q.get("id") or "")
    if not _GRAPH_JOB_ID.match(job_id):
        return 400, {"error": "id must be a job id (graph-<32 hex>)"}
    job = trends.graph_poll(svc, job_id)
    return (200, job) if job else (404, {"error": f"job {job_id} not found"})


def trends_lake(svc, q, b):
    """Method 2: the table bucket, its tables (when last written) and where the agent runs."""
    return 200, lakehouse.status(svc)


def trends_lake_export(svc, q, b):
    """Method 2, step 1: the graph's items and vocabulary over both Iceberg tables (in the browser
    tab's runtime session, so the export warms the microVM the question then runs in)."""
    session_id = str(b.get("session_id") or "") or None
    if session_id and not _SESSION_ID.match(session_id):
        return 400, {"error": "session_id must be 33-100 letters, digits or dashes"}
    try:
        return 200, lakehouse.export(svc, session_id)
    except RuntimeError as exc:  # the lake agent's runtime failed (its own message)
        return 502, {"error": str(exc)[:1000]}


def trends_lake_ask(svc, q, b):
    """Method 2, step 2: start the data agent (``POST``, with the model and reasoning ``effort``
    chosen) or poll it (``GET ?id=&session_id=``)."""
    session_id = str(b.get("session_id") or q.get("session_id") or "") or None
    if session_id and not _SESSION_ID.match(session_id):
        return 400, {"error": "session_id must be 33-100 letters, digits or dashes"}
    try:
        if q.get("id"):
            job_id = str(q["id"])
            if not _JOB_ID.match(job_id):
                return 400, {"error": "id must be a job id (lake-<12 hex>)"}
            return 200, trends.lake_poll(svc, job_id, session_id)
        model_id = str(b.get("model_id") or "") or None
        return 200, trends.lake_start(svc, model_id, session_id, b.get("effort"))
    except RuntimeError as exc:
        return 502, {"error": str(exc)[:1000]}


def graph_clear(svc, q, b):
    try:
        return 200, svc.clear_graph()
    except PermissionError as exc:
        return 403, {"error": str(exc)}


def pipeline_start(svc, q, b):
    """Start an ingest run: a batch of sources (example images and texts by name, or uploads)
    through classify → validate → MERGE, orchestrated by Step Functions when deployed."""
    raw_sources = b.get("sources")
    if not isinstance(raw_sources, list) or not raw_sources:
        return 400, {"error": "sources (a non-empty list) is required"}
    model_id = str(b.get("model_id") or "")
    if not model_id:
        return 400, {"error": "model_id is required"}
    sources = [_source(i, s) for i, s in enumerate(raw_sources)]
    try:
        return 200, svc.start_run(
            _ontology_id(q, b) or svc.ontology_id,
            model_id,
            bool(b.get("prompt_caching", True)),
            str(b.get("line_id") or ""),
            sources,
        )
    except KeyError as exc:
        return 404, {"error": f"ontology {exc.args[0]!r} not found"}


def _source(i: int, s) -> dict:
    """One source as ``pipeline.start_run`` takes it: an example by name, an uploaded photo
    (decoded and size-checked) or an uploaded text. A ``ValueError`` is the caller's 400
    (``dispatch``); the kind and the number of sources are ``start_run``'s to check."""
    if not isinstance(s, dict):
        raise ValueError(f"source {i} must be an object")  # noqa: TRY004 - a 400 for the caller
    kind = str(s.get("kind") or "")
    if s.get("example"):
        return {"kind": kind, "example": str(s["example"])}
    if kind == "image":
        try:
            raw, fmt = _image(s)
        except ValueError as exc:
            raise ValueError(f"source {i}: {exc}") from None
        return {
            "kind": kind,
            "bytes": raw,
            "format": fmt,
            "label": strip_hidden(str(s.get("name") or ""))[:120],
        }
    # stored as the model will read it: without invisible characters (hidden.py)
    text = strip_hidden(str(s.get("text") or "")).strip()
    if kind == "text" and len(text) < 20:
        raise ValueError(f"source {i}: text (>= 20 chars) is required")
    return {
        "kind": kind,
        "text": text[:MAX_TEXT_CHARS],
        "title": strip_hidden(str(s.get("title") or "")).strip()[:200],
        "source": strip_hidden(str(s.get("source") or "upload"))[:120],
        "published": str(s.get("published") or "")[:20],
    }


def pipeline_runs(svc, q, b):
    run_id = str(q.get("id") or b.get("run_id") or "")
    if not run_id:
        return 200, svc.list_runs(_int(q.get("limit"), 12, 1, 50))
    if not _RUN_ID.match(run_id):
        return 400, {"error": "invalid run id"}
    status = svc.run_status(run_id)
    if status is None:
        return 404, {"error": f"run {run_id!r} not found"}
    return 200, status


def pipeline_graph(svc, q, b):
    run_id = str(q.get("id") or b.get("run_id") or "")
    if not _RUN_ID.match(run_id):
        return 400, {"error": "a valid run id is required"}
    graph = svc.run_graph(
        run_id, _int(q.get("hops") or b.get("hops"), 1, 1, 2), _int(q.get("limit"), 400, 1, 1000)
    )
    if graph is None:
        return 404, {"error": f"run {run_id!r} not found"}
    return 200, graph


def graph_web(svc, q, b):
    """The explorer: the whole style DNA as one web; ``details=1`` adds the attribute values."""
    return 200, svc.graph_web(str(q.get("details") or "") in ("1", "true"))


def graph_counts(svc, q, b):
    """Tab 2's before and after: looks, garments, looks per occasion, and the looks the simple
    retriever finds for ``watch`` (a short garment description, default white sneakers)."""
    watch = str(q.get("watch") or "white sneakers").strip()
    if len(watch) > payoff.MAX_SEARCH_CHARS:
        return 400, {"error": f"watch is longer than {payoff.MAX_SEARCH_CHARS} characters"}
    return 200, svc.graph_counts(watch)


def graph_query(svc, q, b):
    cypher = str(b.get("cypher") or "").strip()
    if not cypher:
        return 400, {"error": "cypher is required"}
    params = b.get("params") or {}
    if not isinstance(params, dict):
        return 400, {"error": "params must be an object"}
    try:
        return 200, svc.query(cypher[:10000], params)
    except PermissionError as exc:
        return 403, {"error": str(exc)}
    except NotImplementedError as exc:
        return 501, {"error": str(exc)}
    except Exception as exc:
        # Neptune rejected the query (syntax, unknown function, …): the caller's mistake, and the
        # message the query agent starts from: a 400 with Neptune's own words, ARNs redacted.
        code = aws_error_code(exc)
        if code in _BAD_QUERY:
            return 400, {"error": redact_arns(aws_message(exc))[:2000], "neptune_error": code}
        raise


def graph_agent(svc, q, b):
    """Tab 2's query agent: a question in plain words, or a query that failed (``error``: what
    Neptune said), answered by a model through the Amazon Neptune MCP server, on Amazon Bedrock
    AgentCore Runtime when deployed (``session_id``: the browser tab's runtime session)."""
    text = str(b.get("text") or "").strip()
    if not text:
        return 400, {"error": "text is required"}
    error = str(b.get("error") or "").strip()[:2000] or None
    model_id = str(b.get("model_id") or "") or None
    session_id = str(b.get("session_id") or "") or None
    if session_id and not _SESSION_ID.match(session_id):
        return 400, {"error": "session_id must be 33-100 letters, digits or dashes"}
    try:
        return 200, svc.query_agent(text[:4000], error, model_id, session_id)
    except RuntimeError as exc:  # the agent failed on AgentCore Runtime (its own message)
        return 502, {"error": str(exc)[:1000]}


# ------------------------------------------------------------------ tab 0 · Start here (read-only status)
def setup_status(svc, q, b):
    return 200, setup.status(svc)


# ------------------------------------------------------------------ ontology explorer
def _ontology_id(q: dict, b: dict) -> str | None:
    oid = str(q.get("id") or b.get("ontology_id") or b.get("id") or "").strip()
    return oid if _ID.match(oid) else None


def ontologies(svc, q, b):
    return 200, svc.ontologies()


def ontology_detail(svc, q, b):
    oid = _ontology_id(q, b)
    if not oid:
        return 400, {"error": "id is required"}
    try:
        return 200, svc.ontology_detail(oid)
    except KeyError:
        return 404, {"error": f"ontology {oid!r} not found"}


def ontology_parse(svc, q, b):
    text = b.get("text")
    if not isinstance(text, str) or not text.strip():
        return 400, {"error": "text (the ontology document) is required"}
    try:
        return 200, svc.parse_ontology(
            text, str(b.get("filename") or "") or None, b.get("format") or None
        )
    except ValueError as exc:
        return 400, {"error": str(exc)}


def _example_set(q: dict, b: dict) -> str | None:
    """``set``: ``images`` (the whole photos, the default) or ``items`` (single pieces, tab 3)."""
    name = str(q.get("set") or b.get("set") or "images")
    return name if name in EXAMPLE_SETS else None


def examples(svc, q, b):
    oid = _ontology_id(q, b)
    if not oid:
        return 400, {"error": "id is required"}
    set_name = _example_set(q, b)
    if not set_name:
        return 400, {"error": f"set must be one of {', '.join(EXAMPLE_SETS)}"}
    try:
        return 200, svc.examples(oid, set_name)
    except KeyError:
        return 404, {"error": f"ontology {oid!r} not found"}


def example_image(svc, q, b):
    """Example image as a data URL inside JSON, so the browser reads it like any other answer."""
    oid = _ontology_id(q, b)
    file = str(q.get("file") or b.get("file") or "")
    if not oid or not file:
        return 400, {"error": "id and file are required"}
    set_name = _example_set(q, b)
    if not set_name:
        return 400, {"error": f"set must be one of {', '.join(EXAMPLE_SETS)}"}
    try:
        raw, ctype = svc.example_image(oid, file, set_name)
    except (KeyError, FileNotFoundError):
        return 404, {"error": f"example {file!r} not found"}
    return 200, {
        "file": file,
        "content_type": ctype,
        "data_url": f"data:{ctype};base64,{base64.b64encode(raw).decode()}",
    }


def articles(svc, q, b):
    """Example texts (editorial, social posts) next to the example images."""
    oid = _ontology_id(q, b)
    if not oid:
        return 400, {"error": "id is required"}
    try:
        return 200, svc.articles(oid)
    except KeyError:
        return 404, {"error": f"ontology {oid!r} not found"}


def article_text(svc, q, b):
    oid = _ontology_id(q, b)
    file = str(q.get("file") or b.get("file") or "")
    if not oid or not file:
        return 400, {"error": "id and file are required"}
    try:
        title, text = svc.article_text(oid, file)
    except (KeyError, FileNotFoundError):
        return 404, {"error": f"article {file!r} not found"}
    return 200, {"file": file, "title": title, "text": text}


def vision_models(svc, q, b):
    return 200, svc.vision_models()


def vision_classify(svc, q, b):
    """Classify one image against one ontology with one Bedrock model: the five steps of
    :mod:`ontology_rag.classify`, in order.

    Bad input raises ``ValueError`` (400), an unknown ontology or example ``KeyError`` /
    ``FileNotFoundError`` (404); a Bedrock error comes back for that model (403 / 502); see
    :func:`dispatch`.
    """
    oid = _ontology_id(q, b)
    owl_text = b.get("owl_text")  # an uploaded ontology, parsed per request and never stored
    if owl_text is not None and (not isinstance(owl_text, str) or len(owl_text) > MAX_UPLOAD_BYTES):
        raise ValueError(
            f"owl_text must be a string of at most {MAX_UPLOAD_BYTES // 1024 // 1024} MB"
        )
    if not oid and not owl_text:
        raise ValueError("ontology_id or owl_text is required")
    model = svc.vision_model(str(b.get("model_id") or ""))
    example = str(b.get("example") or "")

    if owl_text:
        view = parse_upload(owl_text, str(b.get("owl_filename") or "") or None)["view"]
    else:
        view = classify.load_ontology(svc, oid)  # 1. the ontology from S3
    image = classify.load_image(svc, oid or svc.ontology_id, example) if example else _image(b)
    system_prompt, user_turn = classify.build_prompt(view, image)  # 3. the prompt
    request, response, latency_ms = classify.call_model(  # 4. Bedrock Converse
        svc.bedrock, model, system_prompt, user_turn, bool(b.get("prompt_caching", True))
    )
    result = classify.check_answer(view, model, system_prompt, request, response, latency_ms)  # 5.
    svc.log_classify(result, len(image[0]))
    return 200, result


_CODE_SETS = (
    "rt_catalog",
    "rt_rag",
    "rt_graph",
    "rt_payoff",
    "explorer",
    "pipeline",
    "query",
    "trends_graph",
    "trends_lake",
    "lens_trends",
)


def explorer_code(svc, q, b):
    code_set = str(q.get("set") or b.get("set") or "explorer")
    if code_set not in _CODE_SETS:
        return 400, {"error": "set must be one of " + ", ".join(_CODE_SETS)}
    return 200, svc.explorer_code(code_set)


def explorer_architecture(svc, q, b):
    return 200, svc.architecture()


def explorer_logs(svc, q, b):
    """Log events of one earlier request (its id comes back in every classify response)."""
    request_id = str(q.get("request_id") or b.get("request_id") or "")
    if not _REQUEST_ID.match(request_id):
        return 400, {"error": "request_id must be the request's UUID"}
    stream = str(q.get("log_stream") or b.get("log_stream") or "") or None
    if stream and not _LOG_STREAM.match(stream):
        return 400, {"error": "log_stream must be a Lambda log stream name"}
    try:
        return 200, svc.logs(request_id, _int(q.get("limit"), 200, 1, 1000), stream)
    except PermissionError as exc:
        return 404, {"error": str(exc)}


ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/api/health"): health,
    ("GET", "/api/summary"): summary,
    ("GET", "/api/ontology"): ontology,
    ("GET", "/api/nodes"): nodes,
    ("GET", "/api/node"): node,
    ("GET", "/api/graph/explore"): explore,
    ("GET", "/api/graph/source"): graph_source,
    ("GET", "/api/photo"): photo,
    ("POST", "/api/graph/explore"): explore,
    ("POST", "/api/payoff"): payoff_route,
    ("GET", "/api/lenses"): lenses_list,
    ("POST", "/api/lenses/count"): lenses_count,
    ("POST", "/api/lenses/explain"): lenses_explain,
    ("POST", "/api/lenses/check/looks"): lenses_check_looks,
    ("POST", "/api/lenses/check/pieces"): lenses_check_pieces,
    ("GET", "/api/lenses/trends/map"): lenses_trends_map,
    ("POST", "/api/lenses/trends/cloud"): lenses_trends_cloud,
    ("POST", "/api/lenses/trends/describe"): lenses_trends_describe,
    ("GET", "/api/catalog"): catalog_info,
    ("GET", "/api/catalog/items"): catalog_items,
    ("GET", "/api/catalog/item"): catalog_item,
    ("POST", "/api/catalog/search"): catalog_search,
    ("GET", "/api/retriever/templates"): retriever_templates,
    ("POST", "/api/retriever/llm"): retriever_llm,
    ("POST", "/api/retriever/plan"): retriever_plan,
    ("POST", "/api/retriever/rag"): retriever_rag,
    ("POST", "/api/retriever/anchors"): retriever_anchors,
    ("POST", "/api/retriever/traverse"): retriever_traverse,
    ("POST", "/api/retriever/graphrag"): retriever_graphrag,
    ("POST", "/api/retriever/understand"): retriever_understand,
    ("POST", "/api/retriever/smart"): retriever_smart,
    ("GET", "/api/ask/models"): ask_models,
    ("POST", "/api/admin/clear-graph"): graph_clear,
    # tab 6 · the trends question's agent methods (method 3, the clouds, is /api/lenses/trends/*)
    ("POST", "/api/trends/graph"): trends_graph,
    ("GET", "/api/trends/graph"): trends_graph_poll,
    ("GET", "/api/trends/lake"): trends_lake,
    ("POST", "/api/trends/lake/export"): trends_lake_export,
    ("POST", "/api/trends/lake/ask"): trends_lake_ask,
    ("GET", "/api/trends/lake/ask"): trends_lake_ask,
    ("POST", "/api/graph/query"): graph_query,
    ("POST", "/api/graph/agent"): graph_agent,
    # tab 0 · Start here (read-only status)
    ("GET", "/api/setup"): setup_status,
    # ingest pipeline
    ("POST", "/api/pipeline/runs"): pipeline_start,
    ("GET", "/api/pipeline/runs"): pipeline_runs,
    ("GET", "/api/pipeline/graph"): pipeline_graph,
    ("GET", "/api/graph/counts"): graph_counts,
    ("GET", "/api/graph/web"): graph_web,
    # ontology explorer
    ("GET", "/api/ontologies"): ontologies,
    ("GET", "/api/ontologies/detail"): ontology_detail,
    ("POST", "/api/ontologies/parse"): ontology_parse,
    ("GET", "/api/ontologies/examples"): examples,
    ("GET", "/api/ontologies/example-image"): example_image,
    ("GET", "/api/ontologies/articles"): articles,
    ("GET", "/api/ontologies/article"): article_text,
    ("GET", "/api/vision/models"): vision_models,
    ("POST", "/api/vision/classify"): vision_classify,
    ("GET", "/api/explorer/code"): explorer_code,
    ("GET", "/api/explorer/architecture"): explorer_architecture,
    ("GET", "/api/explorer/logs"): explorer_logs,
}

# Responses that carry the invocation record (request id, cold start, ...) so the browser can
# look the call up again in the architecture panel.
_WITH_INVOCATION = {"/api/vision/classify"}


def dispatch(
    svc: Service,
    method: str,
    path: str,
    query: dict,
    body: dict,
    invocation: dict | None = None,
) -> tuple[int, dict]:
    """One request through the router. Who may send it is decided before the code runs: the
    function URL accepts only requests signed by a principal IAM lets invoke the function (the
    signed-in user's role, infra/lib/auth.ts)."""
    path = path.rstrip("/") or "/"
    route = ROUTES.get((method.upper(), path))
    if route is None:
        return 404, {"error": f"no route for {method} {path}"}
    started = time.perf_counter()
    try:
        status, payload = route(svc, query or {}, body or {})
    except guardrail.Blocked as exc:  # the guardrail stopped a model call: say so, plainly
        return 422, {"error": str(exc), "blocked": True}
    except ValueError as exc:
        return 400, {"error": str(exc)}
    except PermissionError as exc:
        return 403, {"error": str(exc)}
    except NotReady as exc:
        return 409, {"error": str(exc)}
    except (KeyError, FileNotFoundError) as exc:
        return 404, {"error": f"not found: {exc}"}
    except Exception as exc:
        aws = _aws_error(exc)
        if aws is None:
            raise
        return aws
    if invocation and status == 200 and path in _WITH_INVOCATION and isinstance(payload, dict):
        payload["invocation"] = {
            **invocation,
            "handler_ms": int((time.perf_counter() - started) * 1000),
        }
    return status, payload


# Errors that mean "this caller or model may not do that", not "the service is broken".
_DENIED = {
    "AccessDeniedException",
    "ResourceNotFoundException",
    "ExpiredTokenException",
    "UnrecognizedClientException",
}


def _aws_error(exc: Exception) -> tuple[int, dict] | None:
    """An AWS SDK error (botocore ``ClientError`` / ``BotoCoreError``) as a 403 / 502 response
    the browser can show next to the model it called; ``None`` for anything else. The browser
    gets ``public_message`` (no role, account or request in it), the log the whole text."""
    module = type(exc).__module__ or ""
    if not module.startswith(("botocore", "boto3")):
        return None
    code = aws_error_code(exc) or type(exc).__name__
    log.error("AWS SDK error: %s", exc)
    return 403 if code in _DENIED else 502, {"error": public_message(exc)[:400]}
