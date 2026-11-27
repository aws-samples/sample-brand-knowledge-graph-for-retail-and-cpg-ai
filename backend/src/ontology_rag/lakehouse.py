# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6's trends question, method 2: the graph as Apache Iceberg tables in an Amazon S3 table
bucket.

The sample owns one table bucket with one namespace and two tables (``lake_tables.json``, read by
infra/ too): ``items`` (every Item node, new or lookbook) and ``item_features`` (every edge from
an item to the ontology's vocabulary: its category, values and components). :func:`export` reads
them out of the graph (:func:`rows`, three round trips) and overwrites both tables (:func:`write`:
PyIceberg through the S3 Tables Iceberg REST endpoint, SigV4-signed, warehouse = the table bucket's
ARN). A data agent then queries them through the S3 Tables MCP server (lake_agent.py): :func:`ask`
starts it as a background job, :func:`poll` reads the job back.

The CDK stack creates the bucket, the namespace and both tables; :func:`table_status` reads their
state with boto3 only. Writing needs PyIceberg and PyArrow: the lake agent's runtime has them and
the API Lambda has neither, so the API sends the rows to the runtime (:func:`status` says where
the writer runs).
"""

from __future__ import annotations

import importlib.util
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# lake_agent reads the table spec below; each module uses the other only inside its functions.
from ontology_rag import lake_agent
from ontology_rag.errors import NotReady
from ontology_rag.vision import with_effort

SPEC = json.loads(Path(__file__).with_name("lake_tables.json").read_text())
NAMESPACE: str = SPEC["namespace"]
TABLES: dict[str, dict] = SPEC["tables"]
RELATIONS = ("IS_CATEGORY", "HAS_ATTRIBUTE", "HAS_PART")
MAX_ROWS = 200_000


def rest_uri(region: str) -> str:
    return f"https://s3tables.{region}.amazonaws.com/iceberg"


# ---------------------------------------------------------------------- method 2, as the API runs it
def status(svc) -> dict:
    """Whether method 2 can run: the table bucket and its tables, and where the agent runs: on
    its AgentCore Runtime, or in this process (the S3 Tables MCP server through uvx)."""
    s = svc.settings
    if not s.table_bucket_arn:
        return {
            "configured": False,
            "available": False,
            "reason": "no S3 table bucket: the stack creates it",
            "server": lake_agent.SERVER_PACKAGE,
        }
    try:
        tables = table_status(svc.s3tables, s.table_bucket_arn)
    except Exception as exc:  # noqa: BLE001 - deleted outside the app, no permission, …
        tables = {"table_bucket_arn": s.table_bucket_arn, "error": str(exc)[:300]}
    if s.lake_runtime_arn:
        host, ok, reason = "agentcore", True, ""
        writer_ok, writer_reason = True, ""
    else:
        host = "in-process"
        ok, reason = lake_agent.available()
        writer_ok, writer_reason = available()
    return {
        "configured": True,
        "available": ok and writer_ok,
        "reason": reason or writer_reason,
        "host": host,
        "runtime_arn": s.lake_runtime_arn or None,
        "server": lake_agent.SERVER_PACKAGE,
        "server_version": lake_agent.SERVER_VERSION,
        **tables,
    }


def require(svc) -> dict:
    out = status(svc)
    if not out["available"]:
        raise NotReady(out["reason"])
    return out


def export(svc, session_id: str | None = None) -> dict:
    """Method 2, step 1: the graph's items and their vocabulary as rows, written over both
    Iceberg tables by PyIceberg in this process, or by the lake agent's runtime (the API
    Lambda has no PyArrow; the runtime has no access to the graph)."""
    host = require(svc)["host"]
    started = time.perf_counter()
    read = rows(svc)
    t0 = time.perf_counter()
    if host == "agentcore":
        out = _runtime(svc, {"task": "export", "tables": read["tables"]}, session_id)
        written, runtime = out["tables"], out.get("runtime")
    else:
        if svc.lake_catalog is None:  # one REST catalog per process: its credentials are refreshed
            svc.lake_catalog = catalog(svc.settings.table_bucket_arn, svc.settings.region)
        written, runtime = write(svc.lake_catalog, read["tables"]), {"host": "in-process"}
    return {
        "tables": written,
        "table_bucket_arn": svc.settings.table_bucket_arn,
        "namespace": NAMESPACE,
        "runtime": runtime,
        "metrics": {
            "total_ms": int((time.perf_counter() - started) * 1000),
            "read_ms": read["read_ms"],
            "write_ms": int((time.perf_counter() - t0) * 1000),
        },
    }


def ask(
    svc, text: str, model_id: str | None, session_id: str | None, effort: str | None = None
) -> dict:
    """Method 2, step 2: the data agent as a background job, here or on its runtime (in the
    browser tab's session, so the poll reaches the same microVM), with the model and the reasoning
    ``effort`` chosen (vision.with_effort; the runtime checks both again)."""
    host = require(svc)["host"]
    model = with_effort(svc.answer_model(model_id), effort)
    if host == "agentcore":
        task = {"task": "ask", "text": text, "model_id": model.id, "effort": model.effort}
        out = _runtime(svc, task, session_id)
        return {**out, "host": "agentcore"}

    def work() -> dict:
        started = time.perf_counter()
        out = lake_agent.run(svc, text, model, svc.lake_connect)
        out["runtime"] = {
            "host": "in-process",
            "invoke_ms": int((time.perf_counter() - started) * 1000),
        }
        return out

    return {**svc.lake_jobs.start(work), "host": "in-process"}


def poll(svc, job_id: str, session_id: str | None) -> dict:
    if svc.settings.lake_runtime_arn:
        return _runtime(svc, {"task": "poll", "job_id": job_id}, session_id)
    job = svc.lake_jobs.get(job_id)
    if job is None:
        raise KeyError(f"no such job: {job_id}")
    return job


def _runtime(svc, payload: dict, session_id: str | None) -> dict:
    """``InvokeAgentRuntime`` on the lake agent's runtime (export, ask, poll)."""
    return svc.invoke_runtime(svc.settings.lake_runtime_arn, payload, session_id, "lake agent")


# ---------------------------------------------------------------------- the rows
def rows(svc) -> dict:
    """Both tables' rows, read from the graph: every Item with its provenance, and every edge
    from an item to the vocabulary (one ``neighbor_ids`` round trip per relation)."""
    started = time.perf_counter()
    store = svc.store
    items = store.get_nodes("Item", 50_000)
    ids = [i.id for i in items]
    with ThreadPoolExecutor(max_workers=len(RELATIONS)) as pool:
        links = dict(zip(RELATIONS, pool.map(lambda r: store.neighbor_ids(ids, [r]), RELATIONS)))
    names = {
        n.id: n.name for label in ("Attribute", "Category") for n in store.get_nodes(label, 5000)
    }
    item_rows, feature_rows = [], []
    for i in items:
        p = i.props
        new = bool(p.get("run"))
        category = next(iter(sorted(links["IS_CATEGORY"].get(i.id, set()))), "")
        item_rows.append(
            {
                "item_id": i.id,
                "name": i.name,
                "category_id": category or None,
                "category": names.get(category) if category else None,
                "origin": "new" if new else "lookbook",
                "source": (str(p.get("source") or "") or None) if new else None,
                "run_id": str(p.get("run")) if new else None,
                "confidence": _float(p.get("confidence")) if new else None,
                "line": (str(p.get("line") or "") or None) if not new else None,
            }
        )
        for relation in RELATIONS:
            for fid in sorted(links[relation].get(i.id, set())):
                kind, _, rest = fid.partition(":")
                feature_rows.append(
                    {
                        "item_id": i.id,
                        "feature_id": fid,
                        "relation": relation,
                        "kind": kind,
                        "family": rest.split(":", 1)[0] if kind == "attribute" else None,
                        "name": names.get(fid, rest.split(":")[-1]),
                    }
                )
    return {
        "tables": {"items": item_rows, "item_features": feature_rows},
        "read_ms": int((time.perf_counter() - started) * 1000),
    }


def _float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def check(tables: dict) -> dict[str, list[dict]]:
    """The rows as the schema wants them: known tables, known columns, the right types. The lake
    agent's runtime calls this on what the API sends it before it writes anything."""
    if not isinstance(tables, dict) or set(tables) != set(TABLES):
        raise ValueError(f"tables must be {sorted(TABLES)}")
    out = {}
    for name, spec in TABLES.items():
        rows_in = tables[name]
        if not isinstance(rows_in, list) or len(rows_in) > MAX_ROWS:
            raise ValueError(f"{name}: a list of at most {MAX_ROWS} rows")
        clean = []
        for r in rows_in:
            if not isinstance(r, dict):
                raise ValueError(f"{name}: every row is an object")  # noqa: TRY004 - a 400
            row = {}
            for f in spec["fields"]:
                v = r.get(f["name"])
                if v is None:
                    if f.get("required"):
                        raise ValueError(f"{name}.{f['name']} is required")
                    row[f["name"]] = None
                elif f["type"] == "double":
                    row[f["name"]] = float(v)
                else:
                    row[f["name"]] = str(v)[:2000]
            clean.append(row)
        out[name] = clean
    return out


# ---------------------------------------------------------------------- the tables (boto3 only)
def table_status(client, arn: str) -> dict:
    """Each table: when it was last written (``modifiedAt``), read with boto3 so the API can tell."""
    tables = {}
    for table in TABLES:
        try:
            t = client.get_table(tableBucketARN=arn, namespace=NAMESPACE, name=table)
            modified = t.get("modifiedAt")
            tables[table] = {
                "exists": True,
                "modified_at": modified.isoformat() if hasattr(modified, "isoformat") else modified,
                "created_at": _iso(t.get("createdAt")),
            }
        except client.exceptions.NotFoundException:
            tables[table] = {"exists": False}
    return {"table_bucket_arn": arn, "namespace": NAMESPACE, "tables": tables}


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


# ---------------------------------------------------------------------- the write (PyIceberg)
def available() -> tuple[bool, str]:
    for module in ("pyiceberg", "pyarrow"):
        if importlib.util.find_spec(module) is None:
            return False, f"{module} is not installed (uv pip install -e '.[lake]')"
    return True, ""


def catalog(arn: str, region: str):
    """The table bucket as a PyIceberg REST catalog (the S3 Tables Iceberg REST endpoint)."""
    from pyiceberg.catalog import load_catalog

    return load_catalog(
        "s3tables",
        **{
            "type": "rest",
            "uri": rest_uri(region),
            "warehouse": arn,
            "rest.sigv4-enabled": "true",
            "rest.signing-name": "s3tables",
            "rest.signing-region": region,
        },
    )


def write(cat, tables: dict) -> dict:
    """Overwrite both tables with the rows (one Iceberg snapshot each)."""
    import pyarrow as pa

    tables = check(tables)
    out = {}
    for name, table_rows in tables.items():
        t0 = time.perf_counter()
        table = cat.load_table(f"{NAMESPACE}.{name}")
        data = pa.Table.from_pylist(table_rows, schema=table.schema().as_arrow())
        table.overwrite(data)
        snapshot = table.current_snapshot()
        out[name] = {
            "rows": len(table_rows),
            "ms": int((time.perf_counter() - t0) * 1000),
            "snapshot_id": snapshot.snapshot_id if snapshot else None,
        }
    return out
