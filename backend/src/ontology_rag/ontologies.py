# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The ``ontologies/`` folder: one sub-folder per domain, its example content next to the ontology.

Layout (see ``ontologies/README.md``)::

    ontologies/
    └── <id>/
        ├── <id>.ttl             # the ontology (Turtle, RDF/XML, N-Triples, JSON-LD all work)
        ├── domain.json          # optional: name, prompt wording and example questions of the domain
        ├── README.md            # attribution + modeling notes
        ├── examples/            # inputs to try in the app, never loaded into the graph
        │   ├── images/          # whole photos to classify against it (+ optional manifest.json)
        │   ├── items/           # optional: single pieces like those in them, tab 5's examples
        │   └── articles/        # texts for the ingest pipeline (+ optional manifest.json)
        └── datasets/            # optional: the domain's data sets (brands), see datasets/README.md
            └── <set>/           # README.md (required), domain.json, data files, media/<sub>/,
                                 # examples/ (the same shape as the domain's)

Anything dropped into that layout shows up in the Setup tab's domain list and in the example
drop-downs. A data set's examples are listed after the domain's own (their ``data_set`` names the
set) and its ``domain.json`` lists are added to the domain's. Its data files and its photos under
``media/<sub>/`` are read only by the graph loader, at deploy, and by ``Service.stored_photo``.
Uploaded ontologies never touch the disk: they are parsed per request (``parse_upload``).

Deployed, the folder lives in S3 (``ONTOLOGIES_BUCKET`` / ``ONTOLOGIES_PREFIX``): ``S3Sync``
mirrors the prefix into a local cache directory (``/tmp`` on Lambda) and re-lists it every
minute, so a new domain folder uploaded to the bucket appears without a redeploy. It leaves out
the data sets' data files (except on the graph loader) and their media. The copy bundled with
the Lambda code stays as the fallback when the bucket is unset or unreachable.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import re
import shutil
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger(__name__)

from ontology_rag.kg import KG_SCHEMA
from ontology_rag.owl import (
    OntologyView,
    classification_prompt,
    content_hash,
    estimate_tokens,
    load_graph,
    ontology_view,
    parse_rdf,
    vocabulary,
)

# The class a photo becomes in the graph: its properties are the prompt's "whole photo" section.
IMAGE_CLASS = KG_SCHEMA["image"][0]

ONTOLOGY_SUFFIXES = (".ttl", ".owl", ".rdf", ".xml", ".nt", ".jsonld", ".n3")
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".gif")
ARTICLE_SUFFIXES = (".md", ".txt")
MAX_ARTICLE_CHARS = 20_000
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SAFE_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
# The example image sets of a domain folder: ``examples/images/`` (whole photos, tabs 1 and 2) and
# ``examples/items/`` (one piece per image, like those worn in them: tab 5's Style recommendation).
EXAMPLE_SETS = ("images", "items")
# The domain's data sets: ``datasets/<set>/`` folders with a README.md (datasets/README.md).
DATASETS_DIR = "datasets"
# The inputs to try in the app, of the domain and of each set: ``examples/<kind>/``.
EXAMPLES_DIR = "examples"
# A set's own photos, served by key (``<set>/<sub>/<file>``): ``media/<sub>/<file>``.
MEDIA_DIR = "media"
# The kinds of example inputs (folders of ``examples/``), with the list their manifest keeps the
# files in and the suffixes listed.
EXAMPLE_FOLDERS = {
    "images": ("examples", IMAGE_SUFFIXES),
    "items": ("items", IMAGE_SUFFIXES),
    "articles": ("articles", ARTICLE_SUFFIXES),
}
# The list keys of a set's domain.json, added to the domain's (by value; query examples by
# question). Every other key comes from the domain's own file.
SET_DOMAIN_LISTS = ("example_questions", "photo_questions", "query_examples")
_CLASHES: set[tuple[str, str]] = set()  # set example names skipped (and logged) in this process

# What ``domain.json`` next to the ontology may say about its domain; every key is optional and a
# folder without the file gets these. ``subject`` and ``scene`` are the words of the per-request
# instruction ("Classify every <subject> …", "The text inside <source_text> above describes
# <scene>"; see vision.py,
# which fills in neutral words when they are empty); the questions are what the web app offers
# as examples in tab 3. ``persona`` opens the answer prompt (``answer``) and names who writes
# the answer (``role``), ``noun`` is what the graph
# holds (tab 3's photo note and evidence lines, the question to the agent), ``labels`` are the
# web app's words for tab 3 and for a pairing rule. ``query_examples`` are worked examples
# for tab 3's query agent ({question, cypher} pairs that run on this domain's graph), written
# into its system prompt as few-shot examples (query_agent.worked_examples). ``browse_only``
# marks an ontology to read, not to work with: no data, so tab 0 does not offer it and the
# pipeline refuses to ingest against it; tab 1 step 4 lists it, starting from the class and
# property names in ``start_with``.
# Nested blocks are merged key by key, so a file may set one word and keep the rest.
DOMAIN_DEFAULTS: dict = {
    "name": "",  # the ontology's own name when empty
    "description": "",
    "browse_only": False,
    "start_with": [],
    "subject": "",
    "scene": "",
    "example_questions": [],
    "photo_questions": [],
    "persona": {
        "answer": "You answer questions about the items in the knowledge graph.",
        "role": "assistant",
    },
    "noun": {"singular": "item", "plural": "items"},
    "labels": {
        "qa_tab": "Q&A + Recommendation",
        "rule": "rule",
        "rules": "rules",
    },
    "query_examples": [],
}


@dataclass(frozen=True)
class OntologyEntry:
    id: str
    path: Path
    images_dir: Path
    articles_dir: Path

    def domain(self) -> dict:
        """``domain.json`` next to the ontology, over :data:`DOMAIN_DEFAULTS`: a missing file or
        key keeps the default; a nested block keeps the defaults for the keys it leaves out. Each
        data set's ``domain.json`` then adds its :data:`SET_DOMAIN_LISTS` (example questions,
        photo questions, worked query examples), in set order, without duplicates."""
        raw = _read_json(self.path.parent / "domain.json")
        out = {}
        for key, default in DOMAIN_DEFAULTS.items():
            value = raw.get(key, default)
            if isinstance(default, dict):
                value = {**default, **value} if isinstance(value, dict) else default
            out[key] = value
        for set_id in self.data_sets():
            extra = _read_json(self.set_dir(set_id) / "domain.json")
            for key in SET_DOMAIN_LISTS:
                if not isinstance(out[key], list) or not isinstance(extra.get(key), list):
                    continue
                merged = list(out[key])  # a new list: the default's stays as it is
                if key == "query_examples":
                    seen = {e.get("question") for e in merged if isinstance(e, dict)}
                    for e in extra[key]:
                        if isinstance(e, dict) and e.get("question") not in seen:
                            seen.add(e.get("question"))
                            merged.append(e)
                else:
                    for q in extra[key]:
                        if q not in merged:
                            merged.append(q)
                out[key] = merged
        return out

    def data_sets(self) -> list[str]:
        """The ids of the domain's data sets: the folders ``datasets/<id>/`` with a safe name and
        a ``README.md``, sorted."""
        root = self.path.parent / DATASETS_DIR
        if not root.is_dir():
            return []
        return sorted(
            f.name
            for f in root.iterdir()
            if f.is_dir() and SAFE_ID.match(f.name) and (f / "README.md").is_file()
        )

    def set_dir(self, set_id: str) -> Path:
        """The folder of one data set (``datasets/<set_id>/``)."""
        return self.path.parent / DATASETS_DIR / set_id

    def _listed(self, kind: str) -> list[tuple[Path, dict, str]]:
        """``(file, manifest row, data set)`` of every example of ``kind`` (a key of
        :data:`EXAMPLE_FOLDERS`): the domain's own ``examples/<kind>/`` first (data set ""), then
        each data set's. In a folder, the files its manifest lists come first in that order, then
        the rest by name. A set's file whose name is already listed is skipped (logged once)."""
        manifest_key, suffixes = EXAMPLE_FOLDERS[kind]
        own = {"images": self.images_dir, "items": self.items_dir, "articles": self.articles_dir}
        folders = [(own[kind], "")] + [
            (self.set_dir(s) / EXAMPLES_DIR / kind, s) for s in self.data_sets()
        ]
        out: list[tuple[Path, dict, str]] = []
        seen: set[str] = set()
        for folder, set_id in folders:
            manifest = _manifest(folder, manifest_key)
            files = {f.name: f for f in _files(folder, suffixes)}
            order = [n for n in manifest if n in files] + [n for n in files if n not in manifest]
            for name in order:
                if name in seen:
                    if (str(folder), name) not in _CLASHES:
                        _CLASHES.add((str(folder), name))
                        log.warning(
                            "%s/%s is skipped: an example of that name is listed already",
                            folder,
                            name,
                        )
                    continue
                seen.add(name)
                out.append((files[name], manifest.get(name, {}), set_id))
        return out

    def examples(self) -> list[dict]:
        """Example images (``examples/images/``, then each data set's) with their manifest
        metadata: anything dropped into a folder is listed, the manifest only decorates and
        orders."""
        return [
            {**_image_entry(f, meta), "prompt": meta.get("prompt", ""), **_of_set(set_id)}
            for f, meta, set_id in self._listed("images")
        ]

    @property
    def items_dir(self) -> Path:
        return self.path.parent / EXAMPLES_DIR / "items"

    def items(self) -> list[dict]:
        """Single pieces (``examples/items/``, product photos of garments like those in the
        example photos) with their manifest metadata: the category
        and the photo whose garment each one is like (``source``). Listed like
        :meth:`examples`; tab 5 offers these, tabs 1 and 2 the whole photos."""
        return [
            {
                **_image_entry(f, meta),
                "prompt": "",
                "category": str(meta.get("category") or ""),
                "source": str(meta.get("source") or ""),
                **_of_set(set_id),
            }
            for f, meta, set_id in self._listed("items")
        ]

    def example_set(self, name: str = "images") -> list[dict]:
        """One of :data:`EXAMPLE_SETS`: the whole photos or the single pieces."""
        if name not in EXAMPLE_SETS:
            raise ValueError(f"set must be one of {', '.join(EXAMPLE_SETS)}")
        return self.items() if name == "items" else self.examples()

    def example_path(self, file: str, name: str = "images") -> Path:
        """Resolve an example file name safely (no traversal, must exist in the listing of the
        set ``name``): the file in the domain's folder or in the data set it is listed from."""
        if name not in EXAMPLE_SETS:
            raise ValueError(f"set must be one of {', '.join(EXAMPLE_SETS)}")
        listed = {f.name: f for f, _, _ in self._listed(name)}
        if not SAFE_FILE.match(file or "") or file not in listed:
            raise FileNotFoundError(file)
        return listed[file]

    def articles(self) -> list[dict]:
        """Example texts (``examples/articles/``, then each data set's; ``*.md`` / ``*.txt``) with
        their manifest metadata, same idea as :meth:`examples`."""
        out = []
        for f, meta, set_id in self._listed("articles"):
            text = f.read_text(encoding="utf-8", errors="replace")
            out.append(
                {
                    "file": f.name,
                    "title": meta.get("title") or _first_heading(text) or f.stem,
                    "kind": meta.get("kind", "text"),
                    "source": meta.get("source", ""),
                    "published": meta.get("published", ""),
                    "chars": len(text),
                    "pairs_with_image": meta.get("pairs_with_image", ""),
                    # tab 2: a text about a look of the new shoot (the batch the photos are in)
                    **({"batch": str(meta["batch"])} if meta.get("batch") else {}),
                    **_of_set(set_id),
                }
            )
        return out

    def article_text(self, file: str) -> tuple[str, str]:
        """``(title, text)`` of one example text; the text is capped like an uploaded article."""
        listed = {f.name: (f, meta) for f, meta, _ in self._listed("articles")}
        if not SAFE_FILE.match(file or "") or file not in listed:
            raise FileNotFoundError(file)
        path, meta = listed[file]
        text = path.read_text(encoding="utf-8", errors="replace")
        title = meta.get("title") or _first_heading(text) or path.stem
        return title, text[:MAX_ARTICLE_CHARS]


def _first_heading(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _of_set(set_id: str) -> dict:
    """What a listing adds to an example of a data set: the set's id."""
    return {"data_set": set_id} if set_id else {}


def _files(folder: Path, suffixes: tuple[str, ...]) -> list[Path]:
    """The example files of a folder, by name: a safe name with one of ``suffixes``, no README;
    none when the folder is missing."""
    if not folder.is_dir():
        return []
    return [
        f
        for f in sorted(folder.iterdir())
        if f.suffix.lower() in suffixes
        and SAFE_FILE.match(f.name)
        and f.name.lower() != "readme.md"
    ]


def _manifest(folder: Path, key: str) -> dict[str, dict]:
    """``manifest.json`` of an example folder, by file name (its list under ``key``)."""
    rows = _read_json(folder / "manifest.json").get(key, [])
    return {
        e["file"]: e for e in rows if isinstance(rows, list) and isinstance(e, dict) and "file" in e
    }


def _image_entry(f: Path, meta: dict) -> dict:
    """What an example listing says about one image: its title (the manifest's, or the file name
    without its number), size, type and the model that made or cut it."""
    return {
        "file": f.name,
        "title": meta.get("title") or f.stem.split("-", 1)[-1].replace("-", " "),
        "bytes": f.stat().st_size,
        "content_type": mimetypes.guess_type(f.name)[0] or "application/octet-stream",
        "model_id": meta.get("model_id", ""),
        # tab 2's batch (the brand's new shoot), the occasion its look is for and, for new work
        # tab 6 checks, where the photo comes from, when the manifest says so
        **{k: str(meta[k]) for k in ("batch", "occasion", "origin") if meta.get(k)},
    }


def _read_json(path: Path) -> dict:
    """A JSON object from an optional file (a manifest, ``domain.json``): ``{}`` when the file is
    missing, unreadable or not an object, so a folder without one still lists."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


class S3Sync:
    """Mirror ``s3://bucket/prefix`` into ``cache_dir`` (the ``ontologies/`` layout, one level down).

    Cheap by design: one paginated ListObjectsV2 per ``ttl`` seconds; only objects whose ETag or
    size changed are downloaded, objects that disappeared from the bucket are removed locally.
    ``sync()`` returns the ontology ids whose files changed so cached views can be dropped.

    Of a data set (``<id>/datasets/<set>/``) the mirror takes what the app lists (:meth:`keeps`):
    its README, ``domain.json`` and example inputs. ``include_set_data`` (the graph loader only)
    adds its data files; its photos under ``media/<sub>/`` stay in the bucket, where
    ``Service.stored_photo`` reads them one at a time.
    """

    def __init__(
        self,
        bucket: str,
        prefix: str,
        cache_dir: Path,
        client=None,
        region: str | None = None,
        ttl: float = 60.0,
        include_set_data: bool = False,
    ):
        self.bucket = bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self.cache_dir = Path(cache_dir)
        self.ttl = ttl
        self.region = region
        self.include_set_data = include_set_data
        self._client = client
        self._index: dict[str, tuple[str, int]] = {}  # key -> (etag, size)
        self._checked_at = 0.0
        self.synced_at: str | None = None
        self.error: str | None = None

    @property
    def uri(self) -> str:
        return f"s3://{self.bucket}/{self.prefix}"

    def keeps(self, rel: str) -> bool:
        """Whether the mirror takes ``rel`` (a key below the prefix). Everything outside a data
        set; of ``<id>/datasets/<set>/<rest>``: ``README.md``, ``domain.json`` and the files
        directly in ``examples/images/``, ``examples/items/`` or ``examples/articles/``; with
        ``include_set_data`` also the set's other top-level ``*.json`` files (its data). Never a
        file under ``media/``."""
        parts = rel.split("/")
        if len(parts) < 4 or parts[1] != DATASETS_DIR:
            return True
        rest = parts[3:]
        if len(rest) == 1:
            name = rest[0]
            return name in ("README.md", "domain.json") or (
                self.include_set_data and name.endswith(".json")
            )
        return len(rest) == 3 and rest[0] == EXAMPLES_DIR and rest[1] in EXAMPLE_FOLDERS

    def client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client("s3", region_name=self.region)
        return self._client

    def sync(self, force: bool = False) -> set[str]:
        """Bring the cache up to date; returns the ontology ids (top-level folders) that changed."""
        now = time.monotonic()
        if not force and self._checked_at and now - self._checked_at < self.ttl:
            return set()
        self._checked_at = now
        s3 = self.client()
        listed: dict[str, tuple[str, int]] = {}
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=self.prefix
        ):
            for obj in page.get("Contents", []):
                rel = obj["Key"][len(self.prefix) :]
                if not rel or rel.endswith("/") or ".." in rel.split("/"):
                    continue
                if not self.keeps(rel):  # a set's data or media: as if it were not there
                    continue
                listed[rel] = (obj.get("ETag", ""), int(obj.get("Size", 0)))
        changed: set[str] = set()

        def folder(rel: str) -> str | None:
            return rel.split("/", 1)[0] if "/" in rel else None  # top-level files are no ontology

        for rel, (etag, size) in listed.items():
            if self._index.get(rel) == (etag, size) and (self.cache_dir / rel).exists():
                continue
            target = self.cache_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(self.bucket, self.prefix + rel, str(target))
            if folder(rel):
                changed.add(folder(rel))  # type: ignore[arg-type]
        for rel in set(self._index) - set(listed):
            (self.cache_dir / rel).unlink(missing_ok=True)
            if folder(rel):
                changed.add(folder(rel))  # type: ignore[arg-type]
        for entry_dir in list(self.cache_dir.glob("*")) if self.cache_dir.is_dir() else []:
            if entry_dir.is_dir() and not any(k.startswith(entry_dir.name + "/") for k in listed):
                shutil.rmtree(
                    entry_dir, ignore_errors=True
                )  # whole ontology removed from the bucket
        self._index = listed
        self.synced_at = datetime.now(UTC).isoformat(timespec="seconds")
        self.error = None
        if changed:
            log.info(
                "synced %d objects from %s (%s changed)", len(listed), self.uri, sorted(changed)
            )
        return changed

    def location(self) -> dict:
        return {
            "kind": "s3",
            "bucket": self.bucket,
            "prefix": self.prefix,
            "uri": self.uri,
            "region": self.region,
            "cache_dir": str(self.cache_dir),
            "objects": len(self._index),
            "synced_at": self.synced_at,
            "error": self.error,
        }


class OntologyCatalog:
    """Built-in ontologies (from the folder, or its S3 mirror) with parsed views cached per process."""

    def __init__(self, root: Path, source: S3Sync | None = None):
        self.fallback_root = Path(root)
        self.source = source
        self.root = source.cache_dir if source else self.fallback_root
        self._views: dict[str, OntologyView] = {}
        self._prompts: dict[str, str] = {}

    # ------------------------------------------------------------------ discovery
    def refresh(self, force: bool = False) -> None:
        """Pull changes from S3 (throttled). On failure keep serving the last good copy, or the
        copy bundled with the code when nothing has been synced yet."""
        if not self.source:
            return
        try:
            changed = self.source.sync(force)
        except Exception as exc:  # noqa: BLE001 - S3 unreachable / denied: degrade, don't fail
            self.source.error = f"{type(exc).__name__}: {exc}"
            log.warning("ontology sync from %s failed: %s", self.source.uri, self.source.error)
            self.root = self.source.cache_dir if self.source.synced_at else self.fallback_root
            return
        self.root = self.source.cache_dir
        for oid in changed:
            self._views.pop(oid, None)
            self._prompts.pop(oid, None)

    def location(self) -> dict:
        if self.source:
            return {**self.source.location(), "serving": str(self.root)}
        return {"kind": "local", "dir": str(self.root), "serving": str(self.root)}

    def entries(self) -> list[OntologyEntry]:
        self.refresh()
        out: list[OntologyEntry] = []
        if not self.root.is_dir():
            return out
        for folder in sorted(self.root.iterdir()):
            if not folder.is_dir() or not SAFE_ID.match(folder.name):
                continue
            files = [f for f in sorted(folder.iterdir()) if f.suffix.lower() in ONTOLOGY_SUFFIXES]
            preferred = [f for f in files if f.stem == folder.name] or files
            if preferred:
                examples = folder / EXAMPLES_DIR
                out.append(
                    OntologyEntry(
                        folder.name, preferred[0], examples / "images", examples / "articles"
                    )
                )
        return out

    def entry(self, ontology_id: str) -> OntologyEntry:
        for e in self.entries():
            if e.id == ontology_id:
                return e
        raise KeyError(ontology_id)

    # ------------------------------------------------------------------ views
    def view(self, ontology_id: str) -> OntologyView:
        if ontology_id not in self._views:
            entry = self.entry(ontology_id)
            self._views[ontology_id] = ontology_view(load_graph(entry.path), ontology_id)
        return self._views[ontology_id]

    def prompt(self, ontology_id: str) -> str:
        if ontology_id not in self._prompts:
            self._prompts[ontology_id] = classification_prompt(self.view(ontology_id), IMAGE_CLASS)
        return self._prompts[ontology_id]

    def summary(self, entry: OntologyEntry) -> dict:
        view = self.view(entry.id)
        voc = vocabulary(view, IMAGE_CLASS)
        prompt = self.prompt(entry.id)
        domain = entry.domain()
        return {
            "id": entry.id,
            "name": view.name or entry.id,
            "file": entry.path.name,
            "format": entry.path.suffix.lstrip("."),
            "iri": view.iri,
            "version": view.version,
            "license": view.license,
            "source": view.source,
            "stats": view.stats,
            "entity_classes": len(voc.entity_classes),
            "value_classes": len(voc.value_classes),
            "attribute_properties": len(voc.attribute_props),
            "relation_properties": len(voc.relation_props),
            "examples": len(entry.examples()),
            "articles": len(entry.articles()),
            "data_sets": entry.data_sets(),
            "prompt_tokens_estimate": estimate_tokens(prompt),
            "domain": {**domain, "name": domain["name"] or view.name or entry.id},
        }

    def detail(self, ontology_id: str) -> dict:
        entry = self.entry(ontology_id)
        view = self.view(ontology_id)
        return {
            **self.summary(entry),
            "view": view.to_dict(),
            "prompt": self.prompt(ontology_id),
            "examples_list": entry.examples(),
            "articles_list": entry.articles(),
            "readme": _readme(entry.path.parent),
        }


def parse_upload(text: str, filename: str | None = None, fmt: str | None = None) -> dict:
    """Parse an uploaded ontology document into the same detail shape as a built-in one."""
    graph = parse_rdf(text, filename=filename, fmt=fmt)
    view_id = f"upload-{content_hash(text)}"
    view = ontology_view(graph, view_id)
    if filename:
        view.name = view.name or Path(filename).stem
    voc = vocabulary(view, IMAGE_CLASS)
    prompt = classification_prompt(view, IMAGE_CLASS)
    return {
        "id": view_id,
        "name": view.name or view_id,
        "file": filename or "",
        "format": fmt or "",
        "iri": view.iri,
        "version": view.version,
        "license": view.license,
        "source": view.source,
        "stats": view.stats,
        "entity_classes": len(voc.entity_classes),
        "value_classes": len(voc.value_classes),
        "attribute_properties": len(voc.attribute_props),
        "relation_properties": len(voc.relation_props),
        "examples": 0,
        "articles": 0,
        "data_sets": [],
        "prompt_tokens_estimate": estimate_tokens(prompt),
        "domain": {**DOMAIN_DEFAULTS, "name": view.name or view_id},  # no folder, no domain.json
        "view": view.to_dict(),
        "prompt": prompt,
        "examples_list": [],
        "articles_list": [],
        "readme": "",
    }


def _readme(folder: Path) -> str:
    for name in ("README.md", "readme.md"):
        p = folder / name
        if p.exists():
            return p.read_text()[:20000]
    return ""
