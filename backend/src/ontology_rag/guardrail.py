# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Amazon Bedrock Guardrails on the text a participant types.

The stack creates one guardrail (infra/lib/guardrail.ts: content filters, prompt attacks, and
profanity on the typed text only) and names it in ``GUARDRAIL_ID`` and ``GUARDRAIL_VERSION``. It
is applied per call, and only to calls that carry free-form input: a typed question, an uploaded
text, the rows of a query the participant wrote. :func:`mark` wraps that text in ``guardContent`` blocks and adds the
guardrail to the request. Once a request holds a ``guardContent`` block, the guardrail checks only
those blocks and the model's reply: the system prompt, the ontology and the evidence the app
wrote are not checked (Bedrock user guide, "Include a guardrail with the Converse API").
A call with nothing typed in it goes without the guardrail, and so does every call when
``GUARDRAIL_ID`` is not set (the tests).

A blocked call comes back with ``stopReason`` ``guardrail_intervened`` and the guardrail's own
message instead of the model's reply; :func:`check` turns it into :class:`Blocked`, which the API
answers with a 422 and the plain sentence the screen shows.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from ontology_rag import hidden

INTERVENED = "guardrail_intervened"


class Blocked(Exception):
    """A model call the guardrail stopped: the API's 422, with a sentence a person can read."""


def enabled(settings) -> bool:
    """Whether a guardrail is configured (the deployed stack sets one)."""
    return bool(getattr(settings, "guardrail_id", ""))


def config(settings) -> dict:
    """The ``guardrailConfig`` of a Converse request: the stack's guardrail, with its trace (it
    says what was blocked)."""
    return {
        "guardrailIdentifier": settings.guardrail_id,
        "guardrailVersion": getattr(settings, "guardrail_version", "") or "DRAFT",
        "trace": "enabled",
    }


def mark(settings, request: dict, typed: Iterable[str | None]) -> dict:
    """``request`` with every ``typed`` piece of its user messages in a ``guardContent`` block and
    the guardrail's config added. The model reads the same text as before: a text block is only
    cut where a typed piece starts and ends. A piece not found as it was typed (cut short, or
    changed on the way) puts the whole user text under the guardrail instead: more is checked,
    never less. Nothing typed, or no guardrail configured: the request as it is."""
    pieces = [p for p in (hidden.strip_hidden(t or "").strip() for t in typed) if p]
    if not enabled(settings) or not pieces:
        return request
    messages = [dict(m) for m in request.get("messages", [])]
    found: set[str] = set()
    for m in messages:
        if m.get("role") != "user":
            continue
        content = []
        for block in m.get("content", []):
            if "text" in block:
                parts, hits = _split(block["text"], pieces)
                content.extend(parts)
                found |= hits
            elif "guardContent" in block:  # marked on an earlier turn (an agent's loop)
                content.append(block)
                guarded = block["guardContent"].get("text", {}).get("text", "")
                found |= {p for p in pieces if p in guarded}
            else:
                content.append(block)
        m["content"] = content
    if found != set(pieces):
        messages = [_guard_all(m) if m.get("role") == "user" else m for m in messages]
    return {**request, "messages": messages, "guardrailConfig": config(settings)}


def check(response: dict) -> None:
    """Raise :class:`Blocked` when the guardrail stopped the call."""
    if response.get("stopReason") == INTERVENED:
        raise Blocked(reason(response))


def reason(response: dict) -> str:
    """What the screen says about a blocked call: which side was flagged, and for what."""
    trace = (response.get("trace") or {}).get("guardrail") or {}
    if _flagged(trace.get("inputAssessment")):
        side, found = "the text you typed", _what(trace.get("inputAssessment"))
    elif _flagged(trace.get("outputAssessments")):
        found = _what(trace.get("outputAssessments"))
        why = f" ({', '.join(found)})" if found else ""
        return (
            f"The guardrail stopped this request: it flagged the model's reply{why}. "
            "Run it again: the model words its reply differently each time."
        )
    else:
        side, found = "this request", []
    why = f" ({', '.join(found)})" if found else ""
    return f"The guardrail stopped this request: it flagged {side}{why}. Try other words."


# ---------------------------------------------------------------------- helpers
def _guard(text: str) -> dict:
    return {"guardContent": {"text": {"text": text}}}


def _split(text: str, pieces: list[str]) -> tuple[list[dict], set[str]]:
    """``text`` as content blocks, every occurrence of a piece (longest first) in a guardContent
    block. A gap of only whitespace joins the guarded text next to it, since Converse rejects a
    blank text block."""
    spans: list[tuple[int, int]] = []
    hits: set[str] = set()
    for p in sorted(set(pieces), key=len, reverse=True):
        start = text.find(p)
        while start != -1:
            end = start + len(p)
            if not any(start < e and end > b for b, e in spans):
                spans.append((start, end))
                hits.add(p)
            start = text.find(p, end)
    if not spans:
        return [{"text": text}], hits
    spans.sort()
    blocks: list[dict] = []
    pos = 0
    for b, e in spans:
        gap = text[pos:b]
        if gap.strip():
            blocks.append({"text": gap})
        elif gap and blocks and "guardContent" in blocks[-1]:
            blocks[-1]["guardContent"]["text"]["text"] += gap
        elif gap:
            b = pos  # leading whitespace goes into this guarded piece
        blocks.append(_guard(text[b:e]))
        pos = e
    rest = text[pos:]
    if rest.strip():
        blocks.append({"text": rest})
    elif rest:
        blocks[-1]["guardContent"]["text"]["text"] += rest
    return blocks, hits


def _guard_all(message: dict) -> dict:
    """Every text of a user message under the guardrail (guarded pieces joined back in place)."""
    content = []
    for block in message.get("content", []):
        if "guardContent" in block:
            text = block["guardContent"]["text"]["text"]
        elif "text" in block:
            text = block["text"]
        else:
            content.append(block)
            continue
        if content and "guardContent" in content[-1]:
            content[-1]["guardContent"]["text"]["text"] += text
        else:
            content.append(_guard(text))
    return {**message, "content": content}


def _assessments(value) -> list[dict]:
    """The trace's assessments as a flat list: ``inputAssessment`` maps a guardrail to one,
    ``outputAssessments`` to a list."""
    out: list[dict] = []
    for v in (value or {}).values():
        out.extend(v if isinstance(v, list) else [v])
    return [a for a in out if isinstance(a, dict)]


def _flagged(value) -> bool:
    """Whether any policy of these assessments blocked (whatever its kind)."""
    return '"BLOCKED"' in json.dumps(value or {}, default=str)


def _what(value) -> list[str]:
    """The names of what was blocked, in plain words: "prompt attack", "insults", "profanity"."""
    names: list[str] = []
    for a in _assessments(value):
        for f in (a.get("contentPolicy") or {}).get("filters", []):
            if f.get("action") == "BLOCKED":
                names.append(str(f.get("type", "")).lower().replace("_", " "))
        words = a.get("wordPolicy") or {}
        for w in words.get("managedWordLists", []):
            if w.get("action") == "BLOCKED":
                names.append(str(w.get("type", "")).lower())
        if any(w.get("action") == "BLOCKED" for w in words.get("customWords", [])):
            names.append("a blocked word")
        for t in (a.get("topicPolicy") or {}).get("topics", []):
            if t.get("action") == "BLOCKED":
                names.append(str(t.get("name", "a denied topic")))
    return list(dict.fromkeys(n for n in names if n))
