# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Invisible characters a model still reads.

Two ranges of code points render as nothing in a browser but reach a model as text:

* the Unicode tag characters U+E0000 to U+E007F, which mirror ASCII (U+E0041 is a hidden "A"), so
  a sentence written in them is an instruction the user cannot see in an uploaded text, a
  question or a model's answer;
* lone surrogates U+D800 to U+DFFF, which are halves of a UTF-16 pair and no character on their
  own; a JSON string can carry one (``"\\ud800"``), and text that holds one cannot be encoded as
  UTF-8.

:func:`strip_hidden` removes these two ranges and nothing else: emoji, accented letters and
every other script stay as they are (only the subdivision flags of England, Scotland and Wales,
which are spelled with tag characters, turn into a plain black flag). :func:`clean_request`
applies it to every string of a Converse request, right before the call; the call sites also
strip the text of the response before anything checks or stores it, and ``vision.validate``
cleans the parsed JSON, where escapes such as ``"\\udb40\\udc41"`` decode to tag characters.
"""

from __future__ import annotations

TAG_CHARACTERS = range(0xE0000, 0xE0080)
SURROGATES = range(0xD800, 0xE000)
# str.translate drops every code point mapped to None
_HIDDEN = dict.fromkeys([*TAG_CHARACTERS, *SURROGATES])


def strip_hidden(text: str) -> str:
    """``text`` without tag characters and lone surrogates. One pass is enough: removing code
    points cannot create new ones, so a second call changes nothing."""
    return text.translate(_HIDDEN)


def clean_value(value):
    """Every string inside a JSON-like value (dicts, lists, strings) through
    :func:`strip_hidden`; anything else (photo bytes, numbers, ``None``) as it is. Keys are left
    alone: they are the request's field names, written in this code."""
    if isinstance(value, str):
        return strip_hidden(value)
    if isinstance(value, dict):
        return {key: clean_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    return value


def _clean_message(message):
    """One message through :func:`clean_value`, except the ``reasoningContent`` blocks of the
    model's own turns: they go back as the model returned them, because a reasoning text changed
    by one character no longer matches its signature and the model refuses the request. They are
    the model's output, not text a person or a tool wrote."""
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return clean_value(message)
    content = message.get("content")
    out = clean_value({key: item for key, item in message.items() if key != "content"})
    if isinstance(content, list):
        out["content"] = [
            block if isinstance(block, dict) and "reasoningContent" in block else clean_value(block)
            for block in content
        ]
    elif content is not None:
        out["content"] = clean_value(content)
    return out


def clean_request(request: dict) -> dict:
    """A copy of a Converse request whose system prompt, messages (texts, ``toolUse`` inputs,
    ``toolResult`` contents) and tool descriptions hold no hidden characters; ``modelId`` and the
    inference parameters are copied as they are, and so are the reasoning blocks of the model's
    own earlier turns (:func:`_clean_message`)."""
    cleaned = dict(request)
    for key in ("system", "toolConfig"):
        if key in cleaned:
            cleaned[key] = clean_value(cleaned[key])
    if isinstance(cleaned.get("messages"), list):
        cleaned["messages"] = [_clean_message(m) for m in cleaned["messages"]]
    elif "messages" in cleaned:
        cleaned["messages"] = clean_value(cleaned["messages"])
    return cleaned
