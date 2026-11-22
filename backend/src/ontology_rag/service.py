# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Application facade shared by the Lambda functions (the API, the pipeline, the loader) and the
CLI."""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import time
import uuid
from pathlib import Path

from ontology_rag import (
    code_panel,
    dna,
    guardrail,
    jobs,
    payoff,
    pipeline,
    previews,
    query_agent,
    telemetry,
)
from ontology_rag.classify import s3_client
from ontology_rag.config import Settings, load_settings
from ontology_rag.embeddings import make_embedder
from ontology_rag.errors import NotReady, public_message
from ontology_rag.graph import make_store
from ontology_rag.graph.neptune import is_write_query, reads_s3
from ontology_rag.loader import Loader
from ontology_rag.ontologies import DATASETS_DIR, MEDIA_DIR, OntologyCatalog, S3Sync, parse_upload
from ontology_rag.ontology import load_ontology
from ontology_rag.vision import (
    API_CALL_TIMEOUT_S,
    CONNECT_TIMEOUT_S,
    bedrock_client,
    model_info,
    registry,
    retry_reset_connection,
    with_effort,
)

log = logging.getLogger(__name__)

# Centres of one subgraph walk (``explore``, ``run_graph``): the statement unwinds the ids and
# walks ``hops`` edges from each, so its cost grows with every id a request names.
MAX_EXPLORE_IDS = 100
# The explorer tab's web: the brand's looks as one graph (looks, their garments, the kinds and
# occasions they share, the journal's statements), and with ``details`` the attribute values too.
# Every occasion of the ontology is in the graph; the web draws only those with a look.
WEB_NODES = """MATCH (n) WHERE n:Look OR n:Item OR n:Category OR n:Statement OR n:Article
RETURN id(n) AS id, labels(n)[0] AS label, coalesce(n.name, n.title, left(n.text, 60)) AS name,
       n.image_key AS image_key, n.run AS run
UNION
MATCH (n:Occasion)<-[:FOR]-(:Look) WITH DISTINCT n
RETURN id(n) AS id, labels(n)[0] AS label, coalesce(n.name, n.title, left(n.text, 60)) AS name,
       n.image_key AS image_key, n.run AS run"""
WEB_EDGES = """MATCH (a)-[r:CONTAINS|IS_CATEGORY|FOR|ILLUSTRATES|HAS_STATEMENT]->(b)
WHERE (a:Look OR a:Item OR a:Statement OR a:Article) AND NOT b:Group
RETURN id(a) AS source, type(r) AS type, id(b) AS target"""
WEB_DETAILS = """MATCH (i:Item)-[:HAS_ATTRIBUTE]->(a:Attribute)
RETURN id(i) AS source, 'HAS_ATTRIBUTE' AS type, id(a) AS target, a.name AS name"""
NEEDS_OPENCYPHER = (
    "The explorer needs openCypher. The stack's Neptune Analytics graph has it; the in-memory "
    "graph doesn't."
)
# Tab 2's counts per occasion (graph_counts).
OCCASION_COUNTS = (
    "MATCH (l:Look)-[:FOR]->(o:Occasion) RETURN o.name AS name, count(DISTINCT l) AS looks "
    "ORDER BY looks DESC, name"
)


class Service:
    def __init__(
        self,
        settings: Settings | None = None,
        store=None,
        embedder=None,
        bedrock=None,
        s3=None,
        blobs=None,
        s3vectors=None,
        mcp_connect=None,
        agentcore=None,
        background: bool = False,
    ):
        self.settings = settings or load_settings()
        s = self.settings
        # The query agent's connection to the Neptune MCP server: None = start it on stdio per
        # request (query_agent.start_server); the tests connect an in-process server instead.
        self.mcp_connect = mcp_connect
        self._agentcore = agentcore  # bedrock-agentcore data plane (InvokeAgentRuntime), lazily
        self._agentcore_job = agentcore  # the same, waiting longer: the trends graph agent's job
        self._s3tables = None  # the s3tables client, on first use (Service.s3tables)
        # The background jobs the browser polls (jobs.py): the trends question's data agent. That
        # method (lakehouse.py) also keeps the PyIceberg catalog the export writes through (made
        # on first use) and, in the tests, the in-process MCP server the agent connects to
        # instead of starting one.
        self.lake_jobs = jobs.Jobs(prefix="lake")
        self.lake_catalog = None
        self.lake_connect = None
        self._domain = None  # the graph's domain wording, read on first use (Service.domain)
        self.ontology = load_ontology(s.ontology_path)
        self.store = store or make_store(s)
        self.embedder = embedder or make_embedder(
            s.embedder, s.embedding_model_id, s.embedding_dimension, s.region
        )
        self.loader = Loader(self.store, self.ontology, self.embedder)
        # The mirror of the ontologies bucket; only the graph loader's takes the data sets' data
        # files too (MIRROR_SAMPLE_DATA), so the other functions never download them.
        source = (
            S3Sync(
                s.ontologies_bucket,
                s.ontologies_prefix,
                s.ontologies_cache_dir,
                region=s.region,
                include_set_data=s.mirror_set_data,
            )
            if s.ontologies_bucket
            else None
        )
        self.catalog = OntologyCatalog(s.ontologies_dir, source=source)
        # The bedrock-runtime client every Converse call goes through (classify, answers, the
        # agents in this process), with the timeouts of a browser request; ``background``: the
        # pipeline function's, whose steps no browser waits for (vision.bedrock_client). And the
        # S3 client that reads the ontology and example images (classify.py).
        self.bedrock = bedrock or bedrock_client(s.region, background=background)
        self.s3 = s3 or (s3_client(s.region) if s.ontologies_bucket else None)
        # The ingest pipeline: sources and run records live in the data bucket (without one, as in
        # the tests, a folder: Settings.local_data_dir); Step Functions runs the steps when a state
        # machine is configured, a thread pool otherwise.
        self.blobs = blobs or (
            pipeline.S3BlobStore(s.ontologies_bucket, s.region)
            if s.ontologies_bucket
            else pipeline.FileBlobStore(s.local_data_dir / "blobs")
        )
        # The product catalog (tabs 4 and 5, payoff.py): an index of the Amazon S3 Vectors bucket.
        self.s3vectors = s3vectors or (
            payoff.s3vectors_client(s.region) if s.vector_bucket else None
        )
        self.runner = (
            pipeline.StepFunctionsRunner(s.pipeline_state_machine_arn, s.region)
            if s.pipeline_state_machine_arn
            else pipeline.LocalRunner(self)
        )
        # The trends question's graph agent job (trends.graph_start): deployed, the API starts it
        # in the pipeline function and reads its record in the data bucket (jobs.FunctionJobs);
        # otherwise it is a thread of this process.
        self.graph_jobs = (
            jobs.FunctionJobs(
                self.blobs, jobs.TREND_RECORDS, s.pipeline_function_name, region=s.region
            )
            if s.pipeline_function_name
            else jobs.Jobs(prefix="graph")
        )
        telemetry.install()

    # ------------------------------------------------------------------ where this runs
    @property
    def deployed(self) -> bool:
        """On Lambda the CloudFormation stack owns every resource and the graph is Neptune."""
        return bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))

    @property
    def ontology_id(self) -> str:
        """The folder under ``ontologies/`` the graph's vocabulary comes from (ONTOLOGY_PATH): the
        domain a route works with when the browser names none."""
        return self.settings.ontology_path.parent.name

    @property
    def domain(self) -> dict:
        """The wording of the graph's domain (``ontologies/<id>/domain.json`` over the defaults):
        the persona of the answer prompt, the noun for what the graph holds, the
        labels. A request that names no ontology (tab 3's question, the trends methods) uses it."""
        if self._domain is None:
            self._domain = self.catalog.entry(self.ontology_id).domain()
        return self._domain

    @property
    def agentcore(self):
        """The ``bedrock-agentcore`` client the API invokes the agents through: one attempt (an
        agent run is not idempotent work to retry blindly) and the timeouts of every call the API
        waits for (vision.API_CALL_TIMEOUT_S: 100 s, under the function's 115 s)."""
        if self._agentcore is None:
            self._agentcore = _agentcore_client(self.settings.region, API_CALL_TIMEOUT_S)
        return self._agentcore

    @property
    def agentcore_job(self):
        """The same client for the trends graph agent's job (trends.graph_job, in the pipeline
        function): one attempt, and it waits query_agent.JOB_READ_S for the agent, whose deadline
        is query_agent.MAX_DEADLINE_S (the chain of limits is commented there)."""
        if self._agentcore_job is None:
            self._agentcore_job = _agentcore_client(self.settings.region, query_agent.JOB_READ_S)
        return self._agentcore_job

    @property
    def s3tables(self):
        """The ``s3tables`` client (boto3): the bucket's tables and when they were written."""
        if self._s3tables is None:
            import boto3

            self._s3tables = boto3.client("s3tables", region_name=self.settings.region)
        return self._s3tables

    @s3tables.setter
    def s3tables(self, client) -> None:
        self._s3tables = client

    def invoke_runtime(
        self, arn: str, payload: dict, session_id: str | None, name: str, client=None
    ) -> dict:
        """``InvokeAgentRuntime`` on one of the two agents' runtimes: the request goes to the
        agent on AgentCore Runtime. One session id per browser tab (a random UUID the tab chose), so
        follow-up requests reach the same warm microVM. A request the agent cannot serve comes back as the API's own
        400 / 404 / 409 / 502. ``client``: a background job's (``agentcore_job``)."""
        s = self.settings
        session_id = session_id or f"{name.replace(' ', '-')}-{uuid.uuid4()}"
        started = time.perf_counter()
        response = (client or self.agentcore).invoke_agent_runtime(
            agentRuntimeArn=arn,
            qualifier=s.agent_runtime_qualifier,
            runtimeSessionId=session_id,
            contentType="application/json",
            accept="application/json",
            payload=json.dumps(payload).encode(),
        )
        result = json.loads(response["response"].read() or b"{}")
        if result.get("error"):
            status = int(result.get("status") or 502)
            if status == 422:  # the guardrail stopped the agent's model call: its own sentence
                raise guardrail.Blocked(result["error"])
            exc = {400: ValueError, 404: KeyError, 409: NotReady}.get(status, RuntimeError)
            raise exc(f"{name} runtime: {result['error']}")
        runtime = result.setdefault("runtime", {})
        if isinstance(runtime, dict):
            runtime.update(
                arn=arn,
                qualifier=s.agent_runtime_qualifier,
                session_id=response.get("runtimeSessionId") or session_id,
                trace_id=response.get("traceId"),
                invoke_ms=int((time.perf_counter() - started) * 1000),
            )
        return result

    # ------------------------------------------------------------------ meta
    def health(self) -> dict:
        s = self.settings
        return {
            "ok": True,
            "graph_backend": s.graph_backend,
            "graph_id": s.graph_id or None,
            "deployed": self.deployed,
            "embedder": s.embedder,
            "embedding_dimension": s.embedding_dimension,
            "ontology": {"name": self.ontology.name, "version": self.ontology.version},
            "write_queries": s.allow_write_queries,
            "query_agent": self.query_agent_status(),
            "catalog": {
                "configured": bool(self.s3vectors),
                "vector_bucket": s.vector_bucket,
                "catalog_index": s.catalog_index,
            },
        }

    def summary(self) -> dict:
        """The store's counts and the graph's brands with their descriptions (tab 0's "Meet the
        brand"), read from the Brand nodes rather than named in the web app."""
        brands = [
            {
                "name": str(b.props.get("name") or b.id),
                "description": str(b.props.get("description") or ""),
            }
            for b in self.store.get_nodes("Brand", 20)
        ]
        return {**self.store.summary(), "brands": sorted(brands, key=lambda b: b["name"])}

    def ontology_json(self) -> dict:
        """The pipeline vocabulary as flat JSON (groups, categories, families, attributes)."""
        o = self.ontology
        return {
            "name": o.name,
            "version": o.version,
            "source": o.source,
            "groups": [g.__dict__ for g in o.groups.values()],
            "categories": [c.__dict__ for c in o.categories.values()],
            "attribute_families": [
                {"id": f.id, "name": f.name, "applies_to": list(f.applies_to)}
                for f in o.families.values()
            ],
            "attributes": [a.__dict__ for a in o.attributes.values()],
        }

    # ------------------------------------------------------------------ ontology explorer
    def ontologies(self) -> dict:
        """Every domain folder, and which one the graph holds, so the browser never guesses."""
        return {
            "ontologies": [self.catalog.summary(e) for e in self.catalog.entries()],
            "default": self.ontology_id,
        }

    def ontology_detail(self, ontology_id: str) -> dict:
        return self.catalog.detail(ontology_id)

    def parse_ontology(self, text: str, filename: str | None, fmt: str | None) -> dict:
        return parse_upload(text, filename, fmt)

    def examples(self, ontology_id: str, set_name: str = "images") -> dict:
        """The example images of a domain: ``images`` (whole photos) or ``items`` (single pieces
        like those in them, tab 3's examples)."""
        listed = self.catalog.entry(ontology_id).example_set(set_name)
        return {"ontology_id": ontology_id, "set": set_name, "examples": listed}

    def example_image(
        self, ontology_id: str, file: str, set_name: str = "images"
    ) -> tuple[bytes, str]:
        path = self.catalog.entry(ontology_id).example_path(file, set_name)
        return path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    def articles(self, ontology_id: str) -> dict:
        return {"ontology_id": ontology_id, "articles": self.catalog.entry(ontology_id).articles()}

    def article_text(self, ontology_id: str, file: str) -> tuple[str, str]:
        return self.catalog.entry(ontology_id).article_text(file)

    def vision_models(self) -> dict:
        return {"models": [m.to_dict() for m in registry(self.settings.vision_model_ids)]}

    def vision_model(self, model_id: str):
        """The registry entry for a model the deployment offers (``VISION_MODEL_IDS``). Superseded
        ids raise with their replacement (see ``vision.RETIRED_MODELS``)."""
        if model_id not in self.settings.vision_model_ids:
            raise ValueError(f"model {model_id!r} is not enabled (VISION_MODEL_IDS)")
        return model_info(model_id)

    def ontology_view(
        self, ontology_id: str | None, owl_text: str | None = None, owl_filename: str | None = None
    ) -> dict:
        """The plain-graph view of a built-in ontology (cached per process) or of an uploaded
        document (parsed per request, never stored)."""
        if owl_text:
            return parse_upload(owl_text, owl_filename)["view"]
        return self.catalog.view(ontology_id or self.ontology_id).to_dict()

    def log_classify(self, result: dict, image_bytes: int) -> None:
        """One log line per model call: what the architecture panel shows for the request."""
        m = result["metrics"]
        log.info(
            "classify model=%s ontology=%s image=%d bytes caching=%s latency_ms=%d "
            "input=%d cache_read=%d cache_write=%d output=%d entities=%d issues=%d stop=%s",
            result["model"]["id"],
            result["ontology_id"],
            image_bytes,
            result["prompt_caching"],
            m["latency_ms"],
            m["input_tokens"],
            m["cache_read_tokens"],
            m["cache_write_tokens"],
            m["output_tokens"],
            len(result["entities"]),
            len(result["issues"]),
            result["stop_reason"],
        )

    # ------------------------------------------------------------------ architecture panel
    def architecture(self) -> dict:
        """Where this API runs and what it talks to, for the interactive architecture diagram.

        On Lambda the runtime sets AWS_LAMBDA_FUNCTION_NAME / _MEMORY_SIZE / _LOG_GROUP_NAME;
        outside Lambda (the tests) those are absent and the function's console links are omitted.
        """
        s = self.settings
        env = os.environ
        fn = env.get("AWS_LAMBDA_FUNCTION_NAME")
        log_group = env.get("AWS_LAMBDA_LOG_GROUP_NAME")
        location = self.catalog.location()
        links = telemetry.console_links(
            s.region,
            function_name=fn,
            log_group=log_group,
            bucket=location.get("bucket"),
            prefix=location.get("prefix", ""),
            state_machine_arn=s.pipeline_state_machine_arn or None,
            pipeline_function_name=s.pipeline_function_name or None,
            graph_id=s.graph_id or None,
        )
        asl = pipeline.state_machine_definition()
        map_state = next(iter(asl["States"].values()))
        return {
            "deployed": bool(fn),
            "runtime": "lambda" if fn else "local",
            "region": s.region,
            "function": {
                "name": fn,
                "memory_mb": int(env.get("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "0") or 0) or None,
                "runtime": env.get("AWS_EXECUTION_ENV"),
                "log_group": log_group,
                "handler": "ontology_rag.lambda_handler.api_handler",
            },
            "ontologies": location,
            "models": {
                "vision_model_ids": list(s.vision_model_ids),
                "llm_model_id": s.llm_model_id,
            },
            "graph": {"backend": s.graph_backend, "graph_id": s.graph_id or None},
            "pipeline": {
                "runner": "step-functions" if s.pipeline_state_machine_arn else "local",
                "state_machine_arn": s.pipeline_state_machine_arn or None,
                "state_machine_name": s.pipeline_state_machine_arn.rsplit(":", 1)[-1]
                if s.pipeline_state_machine_arn
                else None,
                "function_name": s.pipeline_function_name or None,
                "max_concurrency": map_state.get("MaxConcurrency"),
                "uploads": f"s3://{s.ontologies_bucket}/{pipeline.UPLOADS_PREFIX}"
                if s.ontologies_bucket
                else "in memory",
                "records": f"s3://{s.ontologies_bucket}/{pipeline.RUNS_PREFIX}"
                if s.ontologies_bucket
                else "in memory",
                "embedding_model_id": s.embedding_model_id,
            },
            "logs": {
                "enabled": s.expose_logs,
                "source": "cloudwatch" if (fn and log_group) else "memory",
            },
            "console": links,
        }

    def logs(self, request_id: str, limit: int = 200, log_stream: str | None = None) -> dict:
        """Log events of one request: CloudWatch Logs on Lambda (with the REPORT line once it
        has landed), the in-process ring buffer outside Lambda (the tests) or when CloudWatch
        cannot be read."""
        if not self.settings.expose_logs:
            raise PermissionError("log access is disabled (EXPLORER_LOGS=false)")
        log_group = os.environ.get("AWS_LAMBDA_LOG_GROUP_NAME")
        source, error, events = "memory", None, []
        if log_group:
            try:
                events = telemetry.cloudwatch_events(log_group, request_id, limit, log_stream)
                source = "cloudwatch"
            except Exception as exc:  # noqa: BLE001 - missing logs:FilterLogEvents etc.
                log.warning("FilterLogEvents on %s failed: %s", log_group, exc)
                error = public_message(exc)[:300]
        if not events:
            # Same container that served the request? Then its ring buffer has the lines already
            # (CloudWatch delivers a few seconds later); otherwise the caller retries shortly.
            buffered = telemetry.buffered_events(request_id, limit)
            if buffered:
                events, source = buffered, "memory"
        links = telemetry.console_links(self.settings.region, log_group=log_group)
        return {
            "request_id": request_id,
            "source": source,
            "log_group": log_group,
            "events": events,
            "report": telemetry.parse_report(events),
            "pending": bool(log_group)
            and not any("REPORT RequestId" in (e.get("message") or "") for e in events),
            "console_url": links.get("log_group"),
            "error": error,
        }

    def explorer_code(self, code_set: str = "explorer") -> dict:
        """The essential code of tab 1 (``"explorer"``) or tab 2 (``"pipeline"``), read from the
        live source with its highlights (see :mod:`ontology_rag.code_panel`)."""
        return {"snippets": code_panel.snippets(code_set)}

    # ------------------------------------------------------------------ loading
    def load_sample(self, reset: bool = False, with_embeddings: bool = True) -> dict:
        """The ontology, then every data set of the graph's domain
        (``ontologies/<id>/datasets/<set>/``), MERGEd into one graph: a graph export
        (``graph.json``: its nodes and stored vectors, no model call) or a catalog (``items.json``
        and the files next to it, embedded here). Each set's products also go into the catalog
        index when a vector bucket is configured (payoff.index_data_set; a catalog's only with
        embeddings). Deployed, this is the graph loader's work: its mirror is refreshed first and
        must hold the sets' data files (MIRROR_SAMPLE_DATA), else the load fails rather than load
        the graph without them.

        ``{"ontology": counts, "sets": {set: counts}, "seconds": n}``; a set with neither file
        is reported as skipped."""
        t0 = time.time()
        source = self.catalog.source
        if self.settings.mirror_set_data:
            if source is None:
                raise RuntimeError("MIRROR_SAMPLE_DATA=true needs ONTOLOGIES_BUCKET: no data sets")
            self.catalog.refresh(force=True)
            if source.error or self.catalog.root != source.cache_dir:
                raise RuntimeError(
                    f"the data sets could not be read from bucket {source.bucket} "
                    f"({source.uri}): {source.error or 'nothing synced'}"
                )
        entry = self.catalog.entry(self.ontology_id)
        if entry.domain().get("browse_only"):  # an ontology to read in tab 1, not a graph's
            raise ValueError(
                f'{self.ontology_id} is browse-only: drop "browse_only" from its domain.json '
                "to deploy it as the graph's domain"
            )
        if reset:
            self.store.delete_all()
        out = {"ontology": self.loader.load_ontology(), "sets": {}}
        for set_id in entry.data_sets():
            out["sets"][set_id] = self._load_set(entry.set_dir(set_id), with_embeddings)
        out["seconds"] = round(time.time() - t0, 1)
        return out

    def _load_set(self, folder: Path, with_embeddings: bool) -> dict:
        """One data set into the graph, then its products into the catalog index."""
        if (folder / dna.GRAPH_FILE).exists():
            # A brand's looks, exported once (dna.py): MERGE plus the stored vectors, and the
            # catalog index from its file. No model is called for the graph.
            loaded = dna.load(self.store, folder, self.settings.embedding_dimension)
            counts = {**loaded["nodes"], "vectors": loaded["vectors"]}
        elif (folder / payoff.ITEMS_FILE).exists():
            counts = self.loader.load_catalog_dir(folder, with_embeddings=with_embeddings)
        else:
            return {"skipped": f"no {dna.GRAPH_FILE} or {payoff.ITEMS_FILE}"}
        self._brand_text(folder)
        if self.s3vectors and self.settings.vector_bucket:
            indexed = payoff.index_data_set(self, folder, embed=with_embeddings)
            if indexed is not None:
                counts["catalog"] = indexed
        return counts

    def _brand_text(self, folder: Path) -> None:
        """A set's ``brand.json`` gives its Brand node the description, whatever the set's format
        (a graph export carries the brand's name only)."""
        path = folder / "brand.json"
        if not path.exists():
            return
        brand = json.loads(path.read_text())
        by_name = {n.props.get("name"): n.id for n in self.store.get_nodes("Brand", 50)}
        brand_id = brand.get("id") or by_name.get(brand.get("name"))
        if brand_id and brand.get("description"):
            self.store.merge_nodes(
                "Brand", [{"id": brand_id, "props": {"description": brand["description"]}}]
            )

    def clear_graph(self) -> dict:
        """Empty the graph (the catalog index is not touched). Only where write queries are
        allowed: elsewhere the deployed API's role may not write the graph."""
        if not self.settings.allow_write_queries:
            raise PermissionError(
                "This stack is read-only, so the graph cannot be cleared here. To allow it, deploy "
                "the stack with -c allowWriteQueries=true in an account of your own."
            )
        before = self.store.summary().get("nodes", {})
        self.store.delete_all()
        return {"nodes_deleted": sum(before.values())}

    # ------------------------------------------------------------------ the answer models
    def answer_models(self) -> dict:
        return {
            "models": [m.to_dict() for m in registry(self.settings.answer_model_ids)],
            "default": self.settings.llm_model_id,
        }

    def answer_model(self, model_id: str | None):
        model_id = model_id or self.settings.llm_model_id
        if model_id not in self.settings.answer_model_ids:
            raise ValueError(f"model {model_id!r} is not enabled (ANSWER_MODEL_IDS)")
        return model_info(model_id)

    # ------------------------------------------------------------------ ingest pipeline
    def start_run(
        self,
        ontology_id: str,
        model_id: str,
        prompt_caching: bool,
        line_id: str,
        sources: list[dict],
    ) -> dict:
        return pipeline.start_run(self, ontology_id, model_id, prompt_caching, line_id, sources)

    def run_status(self, run_id: str) -> dict | None:
        return pipeline.run_status(self, run_id)

    def list_runs(self, limit: int = 12) -> dict:
        return {"runs": pipeline.list_runs(self, limit)}

    def run_graph(self, run_id: str, hops: int = 1, limit: int = 400) -> dict | None:
        """The subgraph around everything a run wrote: its items, looks, articles and statements,
        plus the categories, values and components they share with each other and the catalog.
        A large run wrote more centres than one walk takes; the first ones draw the batch graph."""
        status = pipeline.run_status(self, run_id)
        if status is None:
            return None
        ids = pipeline.created_ids(status)[:MAX_EXPLORE_IDS]
        return {**self.explore(ids, "", hops, limit), "run_id": run_id}

    def graph_counts(self, watch: str = "") -> dict:
        """Tab 2's before and after: how many looks and garments the graph holds, the looks per
        occasion, and how many looks the graph walk of tab 4 finds for ``watch`` ("white
        sneakers"): the number a batch of new looks moves. An in-memory graph (the tests) has no
        openCypher, so it gets the totals only."""
        nodes = self.store.summary().get("nodes", {})
        out = {
            "looks": nodes.get("Look", 0),
            "garments": nodes.get("Item", 0),
            "occasions": [],
            "watch": None,
        }
        try:
            out["occasions"] = self.store.query(OCCASION_COUNTS, {})
            if watch:
                g = payoff.guidance(self, watch)
                out["watch"] = {
                    "text": watch,
                    "label": g["anchor"]["label"],
                    "looks": len(g["looks"]),
                }
        except (NotImplementedError, NotReady):
            pass
        return out

    def graph_web(self, details: bool = False) -> dict:
        """The explorer's web (WEB_NODES, WEB_EDGES; with ``details`` WEB_DETAILS and the attribute
        nodes): every node and edge of the brand's looks in one response, and the statements that ran,
        so the tab can show them. Edges only between nodes it returns."""
        try:
            nodes = self.store.query(WEB_NODES, {})
            edges = self.store.query(WEB_EDGES, {})
            statements = [WEB_NODES, WEB_EDGES]
            if details:
                rows = self.store.query(WEB_DETAILS, {})
                attrs = {r["target"]: r["name"] for r in rows}
                nodes += [
                    {"id": a, "label": "Attribute", "name": n, "image_key": None, "run": None}
                    for a, n in attrs.items()
                ]
                edges += [{k: r[k] for k in ("source", "type", "target")} for r in rows]
                statements.append(WEB_DETAILS)
        except NotImplementedError as exc:
            raise NotReady(NEEDS_OPENCYPHER) from exc
        ids = {n["id"] for n in nodes}
        edges = [e for e in edges if e["source"] in ids and e["target"] in ids]
        return {"nodes": nodes, "edges": edges, "cypher": statements}

    # ------------------------------------------------------------------ exploration
    def nodes(self, label: str, limit: int = 200) -> list[dict]:
        return [n.to_dict() for n in self.store.get_nodes(label, limit)]

    def node(self, node_id: str) -> dict | None:
        n = self.store.get_node(node_id)
        if n is None:
            return None
        return {
            **n.to_dict(),
            "neighbors": [
                {"edge": e.to_dict(), "node": m.to_dict()} for e, m in self.store.neighbors(node_id)
            ],
        }

    def node_source(
        self, node_id: str, ontology_id: str | None = None, near: list[str] | None = None
    ) -> dict | None:
        """What tab 3's evidence tree previews next to a node (previews.py): the photo or page
        it came from, and for a category, attribute value or line the photos and pages it was
        seen in (``origins``, the tree's nodes in ``near`` first). ``ontology_id`` names the
        domain whose example photos ``example:`` keys refer to (default: the graph's). None for a
        node the graph does not have."""
        node = self.store.get_node(node_id)
        if node is None:
            return None
        oid = ontology_id or self.ontology_id
        self.catalog.entry(oid)  # an unknown domain is a KeyError (404) before anything is read

        def photo(file: str) -> tuple[bytes, str]:
            return self.example_image(oid, file)

        out = previews.source_of(node, self.blobs, photo, stored_photo=self.stored_photo)
        if node.label in previews.ORIGIN_LABELS:
            out["origins"], out["origins_total"] = previews.origins_of(
                node, self.store, self.blobs, photo, near or [], stored_photo=self.stored_photo
            )
        return out

    def stored_photo(self, key: str) -> tuple[bytes, str]:
        """One of a data set's photos by its stable key ``<set>/<sub>/<file>`` (a look's
        ``image_key``, a product's in the catalog; previews.STORED_PHOTO): the file
        ``datasets/<set>/media/<sub>/<file>`` of the graph's domain, read from the data bucket
        (``ontologies/<id>/datasets/...``, where the stack copies the ontologies folder), else from
        ``Settings.ontologies_dir`` (the copy bundled with the function, the repository's folder in
        the tests). FileNotFoundError when neither has it."""
        if not previews.is_stored_photo(key):
            raise ValueError(f"not a stored photo key: {key!r}")
        from botocore.exceptions import ClientError

        set_id, sub, file = key.split("/")
        rel = f"{self.ontology_id}/{DATASETS_DIR}/{set_id}/{MEDIA_DIR}/{sub}/{file}"
        try:
            data = self.blobs.get_bytes(self.settings.ontologies_prefix + rel)
        # not in the bucket (NoSuchKey, or 403 without ListBucket), or a blob store without it
        # (the tests): the copy under ontologies_dir
        except (KeyError, FileNotFoundError, ClientError):
            local = self.settings.ontologies_dir / rel
            if not local.is_file():
                raise FileNotFoundError(key) from None
            data = local.read_bytes()
        return data, previews.content_type_of(key)

    def photo(self, key: str) -> dict:
        """``GET /api/photo``: a stored photo as a data URL (previews.stored_photo_preview)."""
        return previews.stored_photo_preview(self.stored_photo, key)

    def explore(
        self, ids: list[str] | None = None, label: str = "", hops: int = 1, limit: int = 200
    ) -> dict:
        centers = list(ids or [])
        if label and not centers:
            centers = [n.id for n in self.store.get_nodes(label, 12)]
        nodes, edges = self.store.subgraph(centers, hops, limit)
        return {
            "centers": centers,
            "nodes": [n.to_dict() for n in nodes],
            "edges": [e.to_dict() for e in edges],
        }

    def query(self, cypher: str, params: dict | None = None) -> dict:
        # neptune.read() would read any S3 object the API's role can read (uploads, run
        # records), so the console refuses it even where write queries are allowed
        if reads_s3(cypher):
            raise PermissionError("CALL neptune.read() is refused on this endpoint: it reads S3")
        if not self.settings.allow_write_queries and is_write_query(cypher):
            raise PermissionError(
                "This stack's query panel is read-only, so write queries do not run. To allow them, "
                "deploy the stack with -c allowWriteQueries=true in an account of your own."
            )
        t0 = time.time()
        rows = self.store.query(cypher, params or {})
        return {"rows": rows, "count": len(rows), "ms": int((time.time() - t0) * 1000)}

    # ------------------------------------------------------------------ query agent (tab 3)
    def query_agent_status(self) -> dict:
        """Whether tab 3 can hand a failed query or a question to the Neptune MCP agent, and
        where it runs: on Amazon Bedrock AgentCore Runtime (deployed), or in this process (the
        tests)."""
        s = self.settings
        if s.graph_backend != "neptune":
            return {
                "available": False,
                "host": None,
                "reason": "the in-memory graph has no openCypher engine; the agent and the "
                "console need the stack's Neptune Analytics graph",
            }
        if s.agent_runtime_arn:
            return {
                "available": True,
                "host": "agentcore",
                "reason": "",
                "runtime_arn": s.agent_runtime_arn,
                "server": query_agent.SERVER_PACKAGE,
            }
        ok, reason = query_agent.available()
        return {
            "available": ok,
            "host": "in-process" if ok else None,
            "reason": reason,
            "server": query_agent.SERVER_PACKAGE,
        }

    def query_agent(
        self,
        text: str,
        error: str | None = None,
        model_id: str | None = None,
        session_id: str | None = None,
        deadline_s: float | None = None,
        progress=None,
        effort: str | None = None,
    ) -> dict:
        """A question in plain words, or an openCypher query that failed (with Neptune's error):
        the agent writes, runs and fixes a read-only query through the Neptune MCP server, on
        AgentCore Runtime when one is configured and in this process otherwise. ``deadline_s``:
        a background job's (the trends question's, query_agent.limits_for); without it the limits
        of an answer the API waits for. ``effort``: the run's reasoning effort (vision.with_effort;
        tab 3 sends none, so its request is the one of before). ``progress(text)`` hears of every
        step of an agent in this process."""
        status = self.query_agent_status()
        if not status["available"]:
            raise NotReady(status["reason"])
        model = with_effort(self.answer_model(model_id), effort)
        limits = query_agent.limits_for(deadline_s)
        # the graph domain's worked examples (domain.json query_examples): few-shot pairs
        examples = query_agent.clean_examples(self.domain.get("query_examples"))
        if status["host"] == "agentcore":
            return self.invoke_agent_runtime(
                text, error, model.id, session_id, examples, deadline_s, model.effort
            )
        started = time.perf_counter()
        result = query_agent.run(
            self, text, error, model, self.mcp_connect, examples, limits, progress
        )
        result["runtime"] = {
            "host": "in-process",
            "invoke_ms": int((time.perf_counter() - started) * 1000),
        }
        return result

    def invoke_agent_runtime(
        self,
        text: str,
        error: str | None,
        model_id: str,
        session_id: str | None = None,
        examples: tuple = (),
        deadline_s: float | None = None,
        effort: str | None = None,
    ) -> dict:
        """The query agent's request to its AgentCore Runtime (``invoke_runtime``): the text,
        Neptune's error, the model and its reasoning effort (``None``: no setting; the runtime
        checks it again), the graph the runtime must serve and the domain's worked examples (the
        runtime has no ontology folder of its own). A background job's request also carries its
        ``deadline_s`` and is waited for longer (``agentcore_job``)."""
        s = self.settings
        payload = {
            "text": text,
            "error": error,
            "model_id": model_id,
            "effort": effort,
            "graph_id": s.graph_id,
            "examples": list(examples),
        }
        if deadline_s is None:
            return self.invoke_runtime(s.agent_runtime_arn, payload, session_id, "query agent")
        payload["deadline_s"] = deadline_s
        return self.invoke_runtime(
            s.agent_runtime_arn, payload, session_id, "query agent", self.agentcore_job
        )


# ---------------------------------------------------------------------- tab 3 helpers
def _agentcore_client(region: str, read_timeout: float):
    """A ``bedrock-agentcore`` client with one attempt (an agent run is not idempotent work to
    retry blindly), the connect timeout of every call and the read timeout given. A call whose
    connection was closed before any answer is tried once more (vision.retry_reset_connection):
    when a NAT gateway reset an idle connection, the request never reached the agent."""
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "bedrock-agentcore",
        region_name=region,
        config=Config(
            read_timeout=read_timeout,
            connect_timeout=CONNECT_TIMEOUT_S,
            retries={"total_max_attempts": 1, "mode": "standard"},
        ),
    )
    return retry_reset_connection(client)
