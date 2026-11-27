# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The ingest pipeline: classify sources against the ontology, validate, MERGE into the graph.

Three step functions do the work: :func:`classify_source`, :func:`ingest_source` and
:func:`summarize`. Deployed, AWS Step Functions runs them (``pipeline.asl.json``: a Map over the
sources with retries, then the summary; ``lambda_handler.pipeline_handler`` is the Lambda entry).
In the tests the same functions run in a thread pool (:class:`LocalRunner`). Same code, same
results.

A *source* is an example image or text from the domain's ``examples/images/`` or
``examples/articles/`` folder (or a data set's), referenced by file name, or an upload stored in
the data bucket under ``uploads/<run_id>/``, referenced by key.
The state machine input carries names and keys only, never bytes, so it stays far below the
256 KB state size limit however many sources a run has.

The two kinds of source share one contract: the ontology rendered as the system prompt
(identical for every source, hence cacheable), one user turn with the source and a short
instruction, one JSON answer validated against the ontology (:func:`vision.validate`). Only what
resolves to an ontology class or value reaches the graph; the rest is reported, per source.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from ontology_rag import classify, guardrail, kg
from ontology_rag.embeddings import INDEX
from ontology_rag.errors import aws_error_code, public_message, public_pipeline_error
from ontology_rag.graph.store import Edge, Node
from ontology_rag.ontology import resolve_value

log = logging.getLogger(__name__)

UPLOADS_PREFIX = "uploads/"  # user-uploaded sources, one folder per run (expire after a day)
RUNS_PREFIX = "runs/"  # run input, one record per source, summary
MAX_SOURCES = 20
MAX_TEXT_CHARS = 20_000
ASL_PATH = Path(__file__).with_name("pipeline.asl.json")

# Bedrock / Neptune error codes worth another attempt. Raised as RetryableError so that Step
# Functions' Retry (exponential backoff with jitter) handles them instead of the hand-written retry
# loop every batch job otherwise grows.
RETRYABLE_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
    "ModelNotReadyException",
    "ConcurrentModificationException",
    "InternalServerException",
}


class RetryableError(Exception):
    """A transient failure; the orchestrator retries the step with backoff."""


# ---------------------------------------------------------------------- where sources and records live
# Bytes and JSON documents by key: the data bucket when deployed, memory or a folder in the tests.
class MemoryBlobStore:
    def __init__(self):
        self._data: dict[str, bytes] = {}

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        self._data[key] = data

    def get_bytes(self, key: str) -> bytes:
        return self._data[key]

    def put_json(self, key: str, obj: dict) -> None:
        self._data[key] = json.dumps(obj).encode()

    def get_json(self, key: str) -> dict | None:
        raw = self._data.get(key)
        return json.loads(raw) if raw is not None else None

    def list_keys(self, prefix: str) -> list[str]:
        keys = list(self._data)  # a snapshot: the local runner's threads write while a poll reads
        return sorted(k for k in keys if k.startswith(prefix))

    def list_page(self, prefix: str, limit: int, token: str | None = None):
        """Up to ``limit`` keys in key order and the token of the next page (None after the
        last), like one ListObjectsV2 call. Here the token is the last key returned."""
        keys = [k for k in self.list_keys(prefix) if not token or k > token]
        return keys[:limit], (keys[limit - 1] if len(keys) > limit else None)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)


class FileBlobStore(MemoryBlobStore):
    """A stand-in for the data bucket when none is set: one file per key under ``root``
    (``Settings.local_data_dir``/blobs), so run records outlive the process."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError(f"bad key {key!r}")
        return path

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get_bytes(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise KeyError(key) from exc

    def put_json(self, key: str, obj: dict) -> None:
        self.put_bytes(key, json.dumps(obj).encode())

    def get_json(self, key: str) -> dict | None:
        try:
            return json.loads(self.get_bytes(key))
        except KeyError:
            return None

    def list_keys(self, prefix: str) -> list[str]:
        if not self.root.exists():
            return []
        keys = (p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file())
        return sorted(k for k in keys if k.startswith(prefix))

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3BlobStore:
    def __init__(self, bucket: str, region: str | None = None, client=None):
        self.bucket = bucket
        self.region = region
        self._client = client

    def client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client("s3", region_name=self.region)
        return self._client

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        self.client().put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get_bytes(self, key: str) -> bytes:
        return self.client().get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def put_json(self, key: str, obj: dict) -> None:
        self.put_bytes(key, json.dumps(obj).encode(), "application/json")

    def get_json(self, key: str) -> dict | None:
        try:
            return json.loads(self.get_bytes(key))
        except self.client().exceptions.NoSuchKey:
            return None

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        for page in (
            self.client()
            .get_paginator("list_objects_v2")
            .paginate(Bucket=self.bucket, Prefix=prefix)
        ):
            keys += [o["Key"] for o in page.get("Contents", [])]
        return sorted(keys)

    def list_page(self, prefix: str, limit: int, token: str | None = None):
        """One ListObjectsV2 call: up to ``limit`` keys (``MaxKeys``) and S3's continuation
        token for the next page, None after the last."""
        args = {"Bucket": self.bucket, "Prefix": prefix, "MaxKeys": limit}
        if token:
            args["ContinuationToken"] = token
        try:
            page = self.client().list_objects_v2(**args)
        except Exception as exc:
            if aws_error_code(exc) == "InvalidArgument":  # a token S3 did not hand out
                raise ValueError("the page token is not valid: read the list again") from exc
            raise
        keys = [o["Key"] for o in page.get("Contents", [])]
        return keys, page.get("NextContinuationToken") if page.get("IsTruncated") else None

    def delete(self, key: str) -> None:
        self.client().delete_object(Bucket=self.bucket, Key=key)


# ---------------------------------------------------------------------- the three steps
def classify_source(svc, run: dict, source: dict) -> dict:
    """Step 1: one source (a photo or a text) against the ontology, with the explorer's own
    functions (``classify.py``).

    The system prompt is the ontology, the same text for every source of the run: with prompt
    caching the first call writes it to the cache and every following call reads it. A text takes
    the photo's place in the user turn and gets the same JSON answer, without bounding boxes.
    """
    view = classify.load_ontology(svc, run["ontology_id"])
    model = svc.vision_model(run["model_id"])
    data, meta = load_source(svc, run, source)  # bytes for a photo, str for a text
    if source["kind"] == "image":
        system_prompt, user_turn = classify.build_prompt(
            view, (data, source.get("format") or "jpeg")
        )
    else:
        system_prompt, user_turn = classify.build_text_prompt(view, data)

    base = {
        "index": source["index"],
        "kind": source["kind"],
        "label": meta["label"],
        "digest": digest_of(data),  # ids derive from the content: re-ingesting is idempotent
        "model_id": model.id,
    }
    try:
        request, response, latency_ms = classify.call_model(
            svc.bedrock,
            model,
            system_prompt,
            user_turn,
            run.get("prompt_caching", True),
            svc.settings,
            typed=(data,) if source["kind"] == "text" else (),  # an uploaded text: the guardrail
        )
    except Exception as exc:
        code = aws_error_code(exc) or type(exc).__name__
        if code in RETRYABLE_CODES:
            raise RetryableError(f"{code}: {exc}") from exc  # Step Functions retries with backoff
        log.error("source %s: the model call failed: %s", source["index"], exc)
        said = str(exc) if isinstance(exc, guardrail.Blocked) else public_message(exc)
        return {**base, "status": "error", "error": said[:300]}
    result = classify.check_answer(view, model, system_prompt, request, response, latency_ms)
    if source["kind"] == "text":
        for ent in result["entities"]:  # a text has no pixels: coordinates are noise
            ent["bbox"] = None
            for part in ent["parts"]:
                part["bbox"] = None
        # the photo as a whole: a text has none (the prompt asks to leave it out; a model may not)
        result["photo_properties"], result["photo_property_iris"] = {}, {}
    result["prompt"].pop("system", None)  # the ontology prompt is the same for every source
    svc.log_classify(result, len(data) if isinstance(data, bytes) else len(data.encode()))
    return {**base, "status": "classified", "ms": latency_ms, "result": result}


def ingest_source(svc, run: dict, classified: dict) -> dict:
    """Step 2: the validated answer into Neptune Analytics, through OWL (``kg.py``).

    1. the answer as OWL individuals of the ontology (rdflib): ``item a fo:Item ; fo:isCategory
       fo:Coat ; fo:hasSilhouette fo:silhouette_a-line``, the photo as a ``fo:Look`` that
       ``fo:contains`` the items, a text as a ``fo:Statement`` that ``fo:illustrates`` them;
    2. those individuals as labeled nodes and typed edges, by generic RDF → property-graph rules;
    3. MERGE into the graph; ids derive from the source content, so a second run changes nothing;
    4. one vector per item (its description) and one for the source (the photo or the text).

    A photo's look gets the occasion it is for (``Look -FOR-> Occasion``, :func:`photo_values`:
    the example's manifest, else the model's answer), so it counts like the brand's own looks;
    and before the MERGE a text about one of the
    domain's example photos is linked to that photo's look (``Statement -ILLUSTRATES-> Look``,
    :func:`add_look_link`), so GraphRAG can quote what the brand wrote about the look.
    """
    if classified.get("status") != "classified":
        svc.blobs.put_json(record_key(run["run_id"], classified["index"]), classified)
        return classified  # an error record is kept for the browser and passes on to the summary
    started = time.perf_counter()
    source = run["sources"][classified["index"]]
    data, meta = load_source(svc, run, source)
    view = classify.load_ontology(svc, run["ontology_id"])
    photo = photo_values(view, source["kind"], classified["result"], meta)  # the look's occasion
    context = {
        "kind": source["kind"],
        "label": classified["label"],
        "run_id": run["run_id"],
        "line_id": run.get("line_id") or "",
        "key": source_key(source),
        "text": data if isinstance(data, str) else "",
        "source": meta["source"],
        "published": meta["published"],
        "photo_property_iris": {prop: value["iri"] for prop, value in photo.items()},
    }

    individuals, skipped = kg.to_owl(view, classified, context)  # 1. OWL individuals
    nodes, edges = kg.to_property_graph(individuals, view)  # 2. nodes + edges
    about = add_look_link(svc, run, nodes, edges, meta)  # 2c. a text about a look
    kg.write(svc.store, nodes, edges)  # 3. MERGE into Neptune Analytics
    svc.store.upsert_embeddings(vectors(svc, nodes, data, source))  # 4. vectors

    result = classified["result"]
    by_label = {label: [n for n in nodes if n.label == label] for label in {n.label for n in nodes}}
    look = by_label.get(kg.KG_SCHEMA["image"][0], [None])[0]
    # the occasion only when a look was written (no garment accepted: no look, no occasion)
    occasion = (", ".join(value["name"] for value in photo.values()) or None) if look else None
    article = by_label.get(kg.KG_SCHEMA["article"][0], [None])[0]
    statement = by_label.get(kg.KG_SCHEMA["text"][0], [None])[0]
    compact = {  # what flows on to the summary: small, no prompts, no raw text
        **{k: classified[k] for k in ("index", "kind", "label", "digest", "model_id")},
        "status": "ingested",
        "items": [item_summary(n, edges) for n in by_label.get(kg.KG_SCHEMA["item"], [])],
        "look": look.id if look else None,
        "article": article.id if article else None,
        "statement": statement.id if statement else None,
        "occasion": occasion,
        "about_look": about,
        "skipped": skipped,
        "issues": len(result["issues"]),
        "feedback": [
            {"kind": f["kind"], "suggestion": f["suggestion"], "observed": f["observed"]}
            for f in result["feedback"]
        ],
        "metrics": {
            k: result["metrics"][k]
            for k in (
                "latency_ms",
                "input_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
                "output_tokens",
            )
        },
        "ms": {"classify": classified["ms"], "ingest": int((time.perf_counter() - started) * 1000)},
    }
    record = {**classified, "status": "ingested", "ingest": compact}
    record["owl"] = individuals.serialize(format="turtle")  # what was written, as OWL
    svc.blobs.put_json(record_key(run["run_id"], classified["index"]), record)
    return compact


def vectors(svc, nodes: list[Node], data: bytes | str, source: dict) -> list[dict]:
    """Nova multimodal embeddings, one vector space for images and text: the photo itself for a
    look, the text for a statement, the name and description for every item."""
    rows = []
    for n in nodes:
        if n.label == kg.KG_SCHEMA["item"]:
            vec = svc.embedder.embed_text(f"{n.props['name']}. {n.props['description']}", INDEX)
        elif n.label == kg.KG_SCHEMA["image"][0]:
            vec = svc.embedder.embed_image(data, source.get("format") or "jpeg", INDEX)
        elif n.label == kg.KG_SCHEMA["text"][0]:
            vec = svc.embedder.embed_text(n.props["text"], INDEX)
        else:
            continue
        rows.append({"id": n.id, "embedding": vec})
    return rows


def item_summary(item: Node, edges: list[Edge]) -> dict:
    """An item as the browser and the summary step see it: its category, values and parts."""
    out = [e for e in edges if e.source == item.id]
    return {
        "id": item.id,
        "name": item.props["name"],
        "category": item.props["category"],
        "attributes": {
            e.props["family"]: e.target.split(":", 1)[1] for e in out if "family" in e.props
        },
        "parts": sorted(e.target.split(":", 1)[1] for e in out if e.type == "HAS_PART"),
    }


def summarize(svc, run: dict, results: list[dict]) -> dict:
    """Step 3: what the batch added, what its sources have in common, what the ontology lacks."""
    ok = [r for r in results if r.get("status") == "ingested"]
    failed = [r for r in results if r.get("status") != "ingested"]
    items = [(r, it) for r in ok for it in r["items"]]
    # Vocabulary nodes referenced by more than one item, the graph's answer to "what do these
    # sources share": the same category, the same attribute value, the same component.
    shared: Counter[tuple[str, str]] = Counter()
    sources_of: dict[tuple[str, str], set[int]] = {}
    for r, it in items:
        refs = [("Category", f"category:{it['category']}")]
        refs += [("Attribute", f"attribute:{v}") for v in it["attributes"].values()]
        refs += [("Category", f"category:{p}") for p in it["parts"]]
        for ref in refs:
            shared[ref] += 1
            sources_of.setdefault(ref, set()).add(r["index"])
    # Ontology feedback across the batch: the same gap reported from several sources ranks first.
    gaps: dict[str, dict] = {}
    for r in ok:
        for f in r["feedback"]:
            key = f"{f['kind']}|{f['suggestion'].lower()[:80]}"
            g = gaps.setdefault(key, {**f, "sources": []})
            g["sources"].append(r["index"])
    tokens = Counter()
    for r in ok:
        tokens.update(r["metrics"])
    summary = {
        "run_id": run["run_id"],
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": {"total": len(results), "ingested": len(ok), "failed": len(failed)},
        "added": {
            "items": len(items),
            "looks": sum(1 for r in ok if r.get("look")),
            "articles": sum(1 for r in ok if r.get("article")),
            "statements": sum(1 for r in ok if r.get("statement")),
            "skipped_entities": sum(len(r["skipped"]) for r in ok),
            "validation_issues": sum(r["issues"] for r in ok),
        },
        "shared": [
            {
                "label": label,
                "id": nid,
                "name": nid.split(":", 1)[1],
                "items": n,
                "sources": len(sources_of[(label, nid)]),
            }
            for (label, nid), n in shared.most_common()
            if n > 1
        ][:40],
        "feedback": sorted(gaps.values(), key=lambda g: -len(g["sources"]))[:12],
        "tokens": dict(tokens),
        "graph": {"before": run.get("graph_before"), "after": svc.store.summary().get("nodes", {})},
        "results": results,
    }
    svc.blobs.put_json(f"{RUNS_PREFIX}{run['run_id']}/summary.json", summary)
    return summary


# ---------------------------------------------------------------------- helpers shared by the steps
def load_source(svc, run: dict, source: dict) -> tuple[bytes | str, dict]:
    """The source content plus ``{"label", "source", "published"}``: an example by name from the
    ontology folder (metadata from its manifest), an upload by key from the blob store."""
    if source.get("example"):
        entry = svc.catalog.entry(run["ontology_id"])
        if source["kind"] == "image":
            path = entry.example_path(source["example"])
            ex = next((e for e in entry.examples() if e["file"] == path.name), {})
            return path.read_bytes(), {
                "label": ex.get("title") or path.stem,
                "source": "example",
                "published": "",
                "occasion": ex.get("occasion", ""),
                "name": path.name,
            }
        title, text = entry.article_text(source["example"])
        meta = next((a for a in entry.articles() if a["file"] == source["example"]), {})
        return text, {
            "label": title,
            "source": meta.get("source") or "example",
            "published": meta.get("published") or "",
            "kind": meta.get("kind") or "text",
            "pairs_with_image": meta.get("pairs_with_image") or "",
        }
    raw = svc.blobs.get_bytes(source["key"])
    if source["kind"] == "image":
        label = source.get("label") or source["key"].rsplit("/", 1)[-1]
        return raw, {"label": label, "source": "upload", "published": "", "name": label}
    return raw.decode("utf-8", errors="replace"), {
        "label": source.get("title") or "uploaded text",
        "source": source.get("source") or "upload",
        "published": source.get("published") or "",
    }


def occasion_of(values: list[dict], wanted: str) -> dict | None:
    """The value an example's manifest names (``wanted``: ``business_casual``), among the
    ontology's ``values`` of one photo property (``kg.vocabulary_nodes``), matched like a data
    set's text (:func:`ontology.resolve_value`). Never a new value, and never a guess from the
    photo's file name."""
    return resolve_value(wanted, values) if wanted.strip() else None


def photo_values(view: dict, kind: str, result: dict, meta: dict) -> dict[str, dict]:
    """The photo's own values, one per photo property of the ontology (the occasion its look is
    for): the example's manifest value when it names one (:func:`occasion_of`; the manifest's
    field is named like the property's class, ``occasion``), else the model's answer (the
    validated ``result.photo_property_iris``), else none. ``kg.add_look`` writes each as one edge
    (``Look -FOR-> Occasion``) and its name on the look. ``{property IRI: value}``, empty for a
    text."""
    if kind != "image":
        return {}
    by_property: dict[str, list[dict]] = {}
    for value in kg.vocabulary_nodes(view):
        by_property.setdefault(value["property"]["iri"], []).append(value)
    answered = result.get("photo_property_iris") or {}
    chosen: dict[str, dict] = {}
    for prop, values in by_property.items():
        manifest = occasion_of(values, str(meta.get(values[0]["class"]["concept_id"]) or ""))
        model = next((v for v in values if v["iri"] == answered.get(prop)), None)
        if manifest or model:
            chosen[prop] = manifest or model
    return chosen


def add_look_link(svc, run: dict, nodes: list[Node], edges: list[Edge], meta: dict) -> str | None:
    """A text about one of the domain's example photos (its manifest's ``pairs_with_image``): its
    statement ``-ILLUSTRATES->`` that photo's look. The look's id comes from the photo's content
    (``look:<digest>``, as the photo's own ingest names it), and the link is only made when the
    look is in the graph: ingest the photo first. Returns the look's id, or None."""
    image = str(meta.get("pairs_with_image") or "")
    statement = next((n for n in nodes if n.label == kg.KG_SCHEMA["text"][0]), None)
    if not image or statement is None:
        return None
    try:
        path = svc.catalog.entry(run["ontology_id"]).example_path(image)
        look_id = f"look:{digest_of(path.read_bytes())}"
    except (KeyError, ValueError, OSError):
        return None
    if svc.store.get_node(look_id) is None:
        return None
    edges.append(Edge(statement.id, look_id, "ILLUSTRATES", {}))
    return look_id


def source_key(source: dict) -> str:
    return (
        f"example:{source['example']}"
        if source.get("example")
        else f"upload:{source.get('key', '')}"
    )


def digest_of(data: bytes | str) -> str:
    """A short content digest for node ids (re-ingesting the same source changes nothing); not a
    security use of the hash."""
    raw = data if isinstance(data, bytes) else data.encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:8]


def record_key(run_id: str, index: int) -> str:
    return f"{RUNS_PREFIX}{run_id}/{index:02d}.json"


def new_run_id() -> str:
    """Also the Step Functions execution name: unique, sortable, [A-Za-z0-9-] only."""
    return f"run-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def state_machine_definition() -> dict:
    return json.loads(ASL_PATH.read_text())


# ---------------------------------------------------------------------- the API side of a run
def start_run(
    svc, ontology_id: str, model_id: str, prompt_caching: bool, line_id: str, sources: list[dict]
) -> dict:
    """Store the uploads, write the run input, hand the batch to the orchestrator.

    ``sources`` are normalized by the route: ``{"kind", "example"}`` for an example by name,
    ``{"kind": "image", "bytes", "format", "label"}`` or ``{"kind": "text", "title", "text", ...}``
    for uploads. Uploads go to ``uploads/<run_id>/`` in the data bucket; the run input only
    carries their keys.
    """
    if not sources:
        raise ValueError("at least one source is required")
    if len(sources) > MAX_SOURCES:
        raise ValueError(f"at most {MAX_SOURCES} sources per run")
    entry = svc.catalog.entry(ontology_id)  # KeyError → 404 in the route
    if entry.domain()["browse_only"]:
        # an ontology to read in tab 1 step 4: no data, and no Look to write a photo into
        raise ValueError(f"{ontology_id} is a browse-only ontology: it has no data to ingest")
    svc.vision_model(model_id)  # ValueError → 400 when the model is not enabled
    run_id = new_run_id()
    specs: list[dict] = []
    for i, s in enumerate(sources):
        kind = s.get("kind")
        if kind not in ("image", "text"):
            raise ValueError(f"source {i}: kind must be image or text")
        spec: dict = {"index": i, "kind": kind}
        if s.get("example"):
            known = {e["file"] for e in (entry.examples() if kind == "image" else entry.articles())}
            if s["example"] not in known:
                raise ValueError(f"source {i}: unknown example {s['example']!r}")
            spec["example"] = s["example"]
        elif kind == "image":
            key = f"{UPLOADS_PREFIX}{run_id}/{i:02d}.{s['format']}"
            svc.blobs.put_bytes(key, s["bytes"], f"image/{s['format']}")
            spec.update(key=key, format=s["format"], label=s.get("label") or f"upload {i + 1}")
        else:
            key = f"{UPLOADS_PREFIX}{run_id}/{i:02d}.txt"
            svc.blobs.put_bytes(key, s["text"].encode("utf-8"), "text/plain; charset=utf-8")
            spec.update(
                key=key,
                title=s.get("title") or f"upload {i + 1}",
                source=s.get("source") or "upload",
                published=s.get("published") or "",
            )
        specs.append(spec)
    # A batch has no product line unless the request names one: the graph can hold several
    # brands, and a new shoot or an upload belongs to none of their lines.
    if line_id and (
        len(line_id) > 120 or "Line" not in getattr(svc.store.get_node(line_id), "labels", [])
    ):
        # the id becomes the items' ``fromLine`` target and ``line`` property: a Line node, or none
        raise ValueError(f"line_id {line_id[:120]!r} is not a Line node of the graph")
    run = {
        "run_id": run_id,
        "ontology_id": ontology_id,
        "model_id": model_id,
        "prompt_caching": bool(prompt_caching),
        "line_id": line_id,
        "sources": specs,
        "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
        # the graph this run writes into
        "graph": {"backend": svc.settings.graph_backend, "graph_id": svc.settings.graph_id or None},
        "graph_before": svc.store.summary().get("nodes", {}),
    }
    svc.blobs.put_json(f"{RUNS_PREFIX}{run_id}/run.json", run)
    execution = svc.runner.start(run)  # Step Functions deployed, a thread pool in the tests
    return {"run": run, "status": "RUNNING", "execution": execution}


def run_status(svc, run_id: str) -> dict | None:
    """The run input, the orchestrator's status and every per-source record written so far."""
    run = svc.blobs.get_json(f"{RUNS_PREFIX}{run_id}/run.json")
    if run is None:
        return None
    records = [
        svc.blobs.get_json(k)
        for k in svc.blobs.list_keys(f"{RUNS_PREFIX}{run_id}/")
        if re.search(r"/\d\d\.json$", k)
    ]
    summary = svc.blobs.get_json(f"{RUNS_PREFIX}{run_id}/summary.json")
    execution = svc.runner.status(run_id)
    # A failed source's error goes to the browser: no stack trace, no ARN (Record failure in the
    # state machine keeps the first 300 characters of Lambda's error JSON)
    records = [public_errors(r) for r in records if r]
    if summary and summary.get("results"):
        summary = {**summary, "results": [public_errors(r) for r in summary["results"]]}
    if execution.get("error"):
        execution = {**execution, "error": public_pipeline_error(execution["error"])}
    return {
        "run": run,
        "status": execution["status"],
        "execution": execution,
        "records": records,
        "summary": summary,
    }


def public_errors(record: dict) -> dict:
    """A per-source record or result as the browser gets it: its ``error``, if any, through
    ``errors.public_pipeline_error``."""
    if not isinstance(record, dict) or not record.get("error"):
        return record
    return {**record, "error": public_pipeline_error(record["error"])}


def list_runs(svc, limit: int = 12) -> list[dict]:
    keys = [k for k in svc.blobs.list_keys(RUNS_PREFIX) if k.endswith("/run.json")]
    out = []
    for k in sorted(keys, reverse=True)[:limit]:
        run = svc.blobs.get_json(k) or {}
        if run:
            out.append(
                {k: run[k] for k in ("run_id", "ontology_id", "model_id", "started_at") if k in run}
                | {"sources": len(run.get("sources", []))}
            )
    return out


def created_ids(status: dict) -> list[str]:
    """Node ids a run wrote: the centres of its subgraph in the batch graph explorer."""
    ids: list[str] = []
    for rec in status.get("records", []):
        ing = rec.get("ingest") or {}
        ids += [it["id"] for it in ing.get("items", [])]
        ids += [x for x in (ing.get("look"), ing.get("article"), ing.get("statement")) if x]
    return ids


# ---------------------------------------------------------------------- orchestrators
class LocalRunner:
    """The offline stand-in for Step Functions: the same three steps in a thread pool.

    Classification runs concurrently (that is where the time goes); graph writes are serialised
    because the in-memory store is not thread-safe. Retries on RetryableError mirror the state
    machine's Retry block.
    """

    def __init__(self, svc, concurrency: int = 3):
        self.svc = svc
        self.concurrency = concurrency
        self.runs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def start(self, run: dict) -> dict:
        self.runs[run["run_id"]] = {
            "runner": "local",
            "status": "RUNNING",
            "started_at": run.get("started_at") or datetime.now(UTC).isoformat(timespec="seconds"),
        }
        threading.Thread(target=self._execute, args=(run,), daemon=True).start()
        return self.runs[run["run_id"]]

    def status(self, run_id: str) -> dict:
        return self.runs.get(run_id) or {"runner": "local", "status": "UNKNOWN"}

    def _execute(self, run: dict) -> None:
        try:
            with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                results = list(pool.map(lambda s: self._one(run, s), run["sources"]))
            summarize(self.svc, run, results)
            self.runs[run["run_id"]]["status"] = "SUCCEEDED"
        except Exception as exc:
            log.exception("local pipeline run %s failed", run["run_id"])
            self.runs[run["run_id"]].update(status="FAILED", error=str(exc)[:300])
        self.runs[run["run_id"]]["stopped_at"] = datetime.now(UTC).isoformat(timespec="seconds")

    def _one(self, run: dict, source: dict) -> dict:
        label = source.get("label") or source.get("title") or source.get("example", "")
        failure = {
            "index": source["index"],
            "kind": source["kind"],
            "label": label,
            "status": "error",
        }
        for attempt in range(4):
            try:
                classified = classify_source(self.svc, run, source)
                with self._lock:
                    return ingest_source(self.svc, run, classified)
            except RetryableError as exc:
                log.warning("source %s attempt %d: %s", source["index"], attempt + 1, exc)
                failure["error"] = f"gave up after 4 attempts: {exc}"
                time.sleep(2**attempt)
            except Exception as exc:  # the record says why, the run goes on
                log.exception("source %s failed", source["index"])
                failure["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
                break
        self.svc.blobs.put_json(record_key(run["run_id"], source["index"]), failure)
        return failure


class StepFunctionsRunner:
    """Deployed: one execution per run, named after it; status from DescribeExecution."""

    def __init__(self, state_machine_arn: str, region: str | None = None, client=None):
        self.state_machine_arn = state_machine_arn
        self.region = region
        self._client = client

    def client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client("stepfunctions", region_name=self.region)
        return self._client

    def execution_arn(self, run_id: str) -> str:
        return self.state_machine_arn.replace(":stateMachine:", ":execution:") + f":{run_id}"

    def console_url(self, run_id: str) -> str:
        region = self.state_machine_arn.split(":")[3]
        return (
            f"https://{region}.console.aws.amazon.com/states/home?region={region}"
            f"#/v2/executions/details/{self.execution_arn(run_id)}"
        )

    def start(self, run: dict) -> dict:
        self.client().start_execution(
            stateMachineArn=self.state_machine_arn, name=run["run_id"], input=json.dumps(run)
        )
        return {
            "runner": "step-functions",
            "status": "RUNNING",
            "arn": self.execution_arn(run["run_id"]),
            "console_url": self.console_url(run["run_id"]),
        }

    def status(self, run_id: str) -> dict:
        try:
            ex = self.client().describe_execution(executionArn=self.execution_arn(run_id))
        except self.client().exceptions.ExecutionDoesNotExist:
            return {
                "runner": "step-functions",
                "status": "UNKNOWN",
                "arn": self.execution_arn(run_id),
            }
        out = {
            "runner": "step-functions",
            "status": ex["status"],
            "arn": ex["executionArn"],
            "console_url": self.console_url(run_id),
            "started_at": ex["startDate"].isoformat(timespec="seconds"),
        }
        if ex.get("stopDate"):
            out["stopped_at"] = ex["stopDate"].isoformat(timespec="seconds")
        if ex.get("error"):
            out["error"] = public_pipeline_error(f"{ex['error']}: {ex.get('cause', '')}")
        return out
