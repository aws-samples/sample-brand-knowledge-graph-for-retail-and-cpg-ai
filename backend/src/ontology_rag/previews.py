# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""What the sources tree and the graph views show next to a node: the photo it came from.

A node keeps where its photo is in its ``image_key``:

- ``<set>/<sub>/<file>`` (``<set>/looks/…``, ``<set>/products/…``): one of a data set's photos, a
  look's or a product's, at ``ontologies/<domain>/datasets/<set>/media/<sub>/<file>`` in the data
  bucket;
- ``example:<file>``: an example photo of the domain's ``examples/images/`` (or a data set's) that
  tab 2 ingested;
- ``upload:uploads/<run>/<nn>.<ext>``: a photo uploaded in tab 2, kept in the data bucket for the
  run (uploads expire after a day);
- anything else shows what the graph holds: its description, or a statement's text.

A node of the vocabulary (a category, an attribute value, a line: ``ORIGIN_LABELS``) has no photo
of its own, so ``origins_of`` walks the graph to where it was seen: the items, looks and articles
that link to it (an item IS_CATEGORY, HAS_PART, HAS_ATTRIBUTE, FROM_LINE), and the articles whose
statements ILLUSTRATE those items, each previewed by the rules above. The nodes of the evidence
tree come first (``near``, closest first), then what tab 2 ingested, and one photo shows once with
every node seen in it.

Only the keys these rules name are read, so a request can reach nothing else in the bucket.
"""

from __future__ import annotations

import base64
import re
from collections.abc import Callable

from ontology_rag.graph.store import Node

# The largest photo a preview carries: its data URL stays well under the 6 MB a Lambda response
# may have (an upload may be up to 4 MB, api.MAX_IMAGE_BYTES). The origins of one node share it.
MAX_PHOTO_BYTES = 3 * 1024 * 1024
MAX_TEXT_CHARS = 4000
EXAMPLE = "example:"  # the image_key of an example photo (examples/images/, pipeline.source_key)
_TAB2_ID = re.compile(r"^(?:item|look|article|st):([0-9a-f]{8})(?:-|$)")  # kg.add_item, add_look …
_IMAGE_FILE = re.compile(r"\.(?:jpe?g|png|webp|gif)$", re.IGNORECASE)  # a text's key names its .md
_SOURCES = {"Item", "Look", "Article", "Statement"}  # the nodes a photo or a text came from
# The vocabulary nodes whose preview shows where they were seen, and how many of those it shows.
ORIGIN_LABELS = {"Category", "Attribute", "Line"}
MAX_ORIGINS = 3
MAX_ORIGIN_READS = 8  # photos read at most per request
MAX_ILLUSTRATED = 4  # items whose illustrating statements are looked up
MAX_NEAR = 30

# example_photo(file) -> (bytes, content type); raises FileNotFoundError when the domain has none.
ExamplePhoto = Callable[[str], tuple[bytes, str]]
# A data set's photos under stable keys, ``<set>/<sub>/<file>``: a look's photo (its image_key) or a
# product shot (the catalog's metadata), stored at datasets/<set>/media/<sub>/<file> of the graph's
# domain (Service.stored_photo). Three segments: the set and the sub folder as safe ids, an image
# file name, so a key can name nothing but a photo of a set's media/<sub>/ folders.
STORED_PHOTO = re.compile(
    r"^[a-z0-9][a-z0-9_-]{0,63}/[a-z0-9][a-z0-9_-]{0,63}/"  # the set, its sub folder (SAFE_ID)
    r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(?:jpe?g|png|webp)$"  # an image file name
)
STORED_PHOTO_RULE = "key must name a data set's photo: <set>/<sub folder>/<file>.jpg|png|webp"
# stored_photo(key) -> (bytes, content type); raises FileNotFoundError when it is not there.
StoredPhoto = Callable[[str], tuple[bytes, str]]
# A photo uploaded in tab 2 (pipeline.source_key, pipeline.start_run): its run's folder of uploads.
UPLOAD = "upload:"
_UPLOAD_KEY = re.compile(
    r"^uploads/run-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}/[0-9]{2}\.(jpe?g|png|webp|gif)$"
)


def is_stored_photo(key: str) -> bool:
    """Whether ``key`` names a data set's photo (STORED_PHOTO), with no ``..`` anywhere in it."""
    return bool(STORED_PHOTO.match(key)) and ".." not in key


def content_type_of(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower()
    return {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[
        ext
    ]


def stored_photo_preview(stored_photo: StoredPhoto, key: str) -> dict:
    """``GET /api/photo``: one of a data set's photos as a data URL. ValueError for a key that
    is not ``<set>/<sub>/<file>`` (STORED_PHOTO), FileNotFoundError when it is not stored."""
    if not is_stored_photo(key):
        raise ValueError(STORED_PHOTO_RULE)
    photo, note = _photo(*stored_photo(key))
    if photo is None:
        raise ValueError(note)
    return {"key": key, **photo}


def source_of(
    node: Node,
    blobs,
    example_photo: ExamplePhoto,
    photo_budget: int | None = None,
    stored_photo: StoredPhoto | None = None,
) -> dict:
    """The preview of one node: the photo it came from (a data URL, by its ``image_key``), with
    where it was found. ``description`` is the node's own text in the graph and ``quote`` a
    statement's. ``photo_budget``: the bytes left for photos when several previews share one
    response (origins_of)."""
    budget = MAX_PHOTO_BYTES if photo_budget is None else photo_budget
    source = {"kind": "graph", "title": "", "doc_id": None}
    photo, note = None, ""
    key = str(node.props.get("image_key") or "")
    if key.startswith(EXAMPLE) and not _IMAGE_FILE.search(key):
        key = ""  # an item seen in an example text: its key names the text, not a photo
    if stored_photo and is_stored_photo(key):
        try:
            photo, note = _photo(*stored_photo(key), budget)
        except (KeyError, FileNotFoundError):
            note = "its photo is not stored in this deployment"
        source = {"kind": "lookbook photo", "title": key.rsplit("/", 1)[-1], "doc_id": None}
    elif key.startswith(EXAMPLE):
        file = key[len(EXAMPLE) :]
        try:
            photo, note = _photo(*example_photo(file), budget)
        except (KeyError, FileNotFoundError):
            note = f"its photo {file} is not among the domain's example photos"
        source = {"kind": "example photo", "title": file, "doc_id": None}
    elif key.startswith(UPLOAD) and _UPLOAD_KEY.match(key[len(UPLOAD) :]):
        upload = key[len(UPLOAD) :]
        try:
            photo, note = _photo(blobs.get_bytes(upload), _upload_type(upload), budget)
        except (KeyError, FileNotFoundError):
            note = "its photo was uploaded for one run and has expired"
        except Exception as exc:  # S3: NoSuchKey once the upload expired
            if "NoSuchKey" not in type(exc).__name__ and "NoSuchKey" not in str(exc):
                raise
            note = "its photo was uploaded for one run and has expired"
        source = {"kind": "tab 2 photo", "title": upload.rsplit("/", 1)[-1], "doc_id": None}
    elif key and not key.startswith(UPLOAD):
        note = "its photo is not stored in this deployment"
    description = str(node.props.get("text") or node.props.get("description") or "")
    return {
        "id": node.id,
        "label": node.label,
        "name": node.name,
        "source": source,
        "photo": photo,
        "photo_note": note,
        "text": "",
        "description": _cut(description),
        "quote": description if node.label == "Statement" else "",
    }


def origins_of(
    node: Node,
    store,
    blobs,
    example_photo: ExamplePhoto,
    near: list[str] | tuple = (),
    stored_photo: StoredPhoto | None = None,
) -> tuple[list[dict], int]:
    """Where a vocabulary node (ORIGIN_LABELS) was seen: up to MAX_ORIGINS previews (source_of)
    of the items, looks and articles that link to it, and of an article illustrating one of those
    items. Each carries ``via``: the nodes seen in that photo or page and how they link to this
    node. Returns them and how many nodes link to it directly."""
    rank = {nid: i for i, nid in enumerate(near[:MAX_NEAR])}

    def order(m: Node) -> tuple:
        return (rank.get(m.id, len(rank)), 0 if _TAB2_ID.match(m.id) else 1, m.name.lower(), m.id)

    direct = sorted(
        ((e, m) for e, m in store.neighbors(node.id, direction="in") if m.label in _SOURCES),
        key=lambda em: order(em[1]),
    )
    items = [m for _, m in direct if m.label == "Item"][:MAX_ILLUSTRATED]
    about = []  # (statement, the item it illustrates), the closest items first
    for item in items:
        for _, st in store.neighbors(item.id, ["ILLUSTRATES"], "in"):
            if st.label == "Statement":
                about.append((st, item))
    candidates = [
        (m, {"id": m.id, "label": m.label, "name": m.name, "edge": e.type}) for e, m in direct
    ]
    articles = [
        (st, {"id": it.id, "label": it.label, "name": it.name, "edge": "ILLUSTRATES"})
        for st, it in about
    ]
    # one slot is kept for an article when there is one, the rest go to the closest sources
    first = MAX_ORIGINS - 1 if articles else MAX_ORIGINS
    out: list[dict] = []
    by_key: dict[str, dict] = {}
    left = {"reads": MAX_ORIGIN_READS, "photo": MAX_PHOTO_BYTES}

    def take(pool: list, room: int) -> None:
        for cand, via in pool:
            key = _origin_key(cand)
            if key in by_key:
                if all(v["id"] != via["id"] for v in by_key[key]["via"]):
                    by_key[key]["via"].append(via)
                continue
            if room <= 0 or len(out) >= MAX_ORIGINS or left["reads"] <= 0:
                continue
            left["reads"] -= 1
            p = source_of(
                cand, blobs, example_photo, photo_budget=left["photo"], stored_photo=stored_photo
            )
            if p["photo"]:
                left["photo"] -= p["photo"]["bytes"]
            by_key[key] = {**p, "via": [via]}
            out.append(by_key[key])
            room -= 1

    take(candidates, first)
    take(articles, MAX_ORIGINS - len(out))
    take(candidates, MAX_ORIGINS - len(out))  # no article: the remaining slot goes to a source
    return out, len(direct)


def _origin_key(node: Node) -> str:
    """Nodes seen in the same photo share one preview: their photo's key, else (a statement) their
    article, else the node itself."""
    key = str(node.props.get("image_key") or "")
    if key.startswith((EXAMPLE, UPLOAD)) or is_stored_photo(key):
        return key
    if node.label == "Statement":
        return str(node.props.get("article") or node.id)
    return node.id


def _upload_type(key: str) -> str:
    ext = key.rsplit(".", 1)[-1].lower()
    return "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"


def _photo(raw: bytes, content_type: str, budget: int | None = None) -> tuple[dict | None, str]:
    if len(raw) > MAX_PHOTO_BYTES:
        return None, f"its photo is too large to preview ({len(raw) / 1024 / 1024:.1f} MB)"
    if budget is not None and len(raw) > budget:
        return None, "its photo is left out, the photos above fill this preview"
    data_url = f"data:{content_type};base64,{base64.b64encode(raw).decode()}"
    return {"data_url": data_url, "content_type": content_type, "bytes": len(raw)}, ""


def _cut(text: str) -> str:
    text = text.strip()
    return text if len(text) <= MAX_TEXT_CHARS else text[: MAX_TEXT_CHARS - 1].rstrip() + "…"
