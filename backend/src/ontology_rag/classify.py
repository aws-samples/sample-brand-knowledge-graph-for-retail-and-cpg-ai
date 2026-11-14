# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Classify a photo against an OWL ontology with Amazon Bedrock: the five steps of tab 1.

1. :func:`load_ontology`: the OWL file from S3, parsed with rdflib into plain dicts
2. :func:`load_image`: the photo from S3, as raw bytes
3. :func:`build_prompt`: the ontology as the system prompt; the photo and one instruction as the user turn
4. :func:`call_model`: one Converse request for every provider, with prompt caching
5. :func:`check_answer`: every class, value and part resolved against the ontology; token usage

``api.vision_classify`` runs them in this order for the ontology explorer; the ingest pipeline
(``pipeline.classify_source``) runs the same functions for every source of a batch.
"""

from __future__ import annotations

import time

import rdflib
import rdflib.util

from ontology_rag import guardrail, hidden, owl, vision
from ontology_rag.kg import KG_SCHEMA
from ontology_rag.vision import ModelInfo

# The class a whole photo becomes in the graph (fo:Look): its properties are the photo's own
# values, the occasion of a look, which the prompt asks for and the check resolves.
IMAGE_CLASS = KG_SCHEMA["image"][0]


def s3_client(region: str | None = None):
    """The S3 client :func:`read_object` uses (only created when a bucket is configured)."""
    import boto3

    return boto3.client("s3", region_name=region)


def read_object(svc, key: str) -> bytes:
    """One object of the ontologies bucket: ``s3:GetObject`` when deployed, the repository's
    ``ontologies/`` folder without a bucket (the tests)."""
    s = svc.settings
    if not s.ontologies_bucket:
        return (s.ontologies_dir / key).read_bytes()
    obj = svc.s3.get_object(Bucket=s.ontologies_bucket, Key=s.ontologies_prefix + key)
    return obj["Body"].read()


# ---------------------------------------------------------------------- step 1
def load_ontology(svc, ontology_id: str) -> dict:
    """Step 1, the ontology: an OWL file in S3 (``ontologies/<id>/<id>.ttl``), parsed with rdflib.

    The result is the ontology as plain dicts (classes with their subclass tree, object and data
    properties with domain and range, named individuals as the allowed attribute values). This is
    what the prompt is rendered from (step 3) and what the answer is checked against (step 5).
    Parsing the 2,400 triples of the sample's ontology takes about 50 ms, so it happens per request.
    The folder's ``domain.json`` rides along: step 3 words the instruction with it.
    """
    entry = svc.catalog.entry(ontology_id)  # which file in the folder is the ontology
    data = read_object(svc, f"{ontology_id}/{entry.path.name}")  # the OWL document (Turtle here)
    file_format = rdflib.util.guess_format(entry.path.name) or "turtle"  # .ttl · .owl · .jsonld …
    graph = rdflib.Graph().parse(data=data, format=file_format)  # RDF triples
    view = owl.ontology_view(graph, ontology_id).to_dict()  # classes · properties · individuals
    return {**view, "domain": entry.domain()}  # + the domain's wording for the user turn


# ---------------------------------------------------------------------- step 2
def load_image(svc, ontology_id: str, file: str) -> tuple[bytes, str]:
    """Step 2, the photo: a listed example image of the domain (``examples/images/``, or of one of
    its data sets, under ``datasets/<set>/examples/images/``) in S3, as raw bytes.

    Bedrock takes the bytes themselves (no base64, no S3 URI) plus a format name. A photo you
    upload in the browser arrives base64-encoded in the request body instead and ends up as the
    same ``(bytes, format)`` pair.
    """
    path = svc.catalog.entry(ontology_id).example_path(file)  # only listed example files
    data = read_object(svc, path.relative_to(svc.catalog.root).as_posix())  # its key in S3
    image_format = path.suffix.lstrip(".").lower().replace("jpg", "jpeg")  # jpeg · png · webp · gif
    return data, image_format


# ---------------------------------------------------------------------- step 3
def build_prompt(view: dict, image: tuple[bytes, str]) -> tuple[str, list[dict]]:
    """Step 3, the prompt.

    * The **system prompt** is the ontology rendered as text: entity classes as an indented tree,
      the relations, every attribute property with its allowed values, then the JSON shape of the
      answer. It is the same text for every image, which is what makes it cacheable (step 4).
    * The **user turn** carries what changes per request: the photo as an image block, then one
      short instruction with the photo's pixel size (it steadies the bounding boxes), worded for
      the domain ("every garment, accessory and garment component").
    """
    system_prompt = owl.classification_prompt(view, IMAGE_CLASS)
    user_turn = [
        {"image": {"format": image[1], "source": {"bytes": image[0]}}},
        {"text": vision.user_instruction(image, view.get("domain"))},
    ]
    return system_prompt, user_turn


def build_text_prompt(view: dict, text: str) -> tuple[str, list[dict]]:
    """Step 3 for a text (the ingest pipeline): the same system prompt; the
    text takes the photo's place in the user turn, and the instruction says there are no pixels,
    so no boxes. The text sits inside <source_text> tags, so the model can tell where the
    uploaded text ends and the instruction begins (a label, not a security control)."""
    system_prompt = owl.classification_prompt(view, IMAGE_CLASS)
    source_text = f"<source_text>\n{text}\n</source_text>"
    user_turn = [{"text": source_text}, {"text": vision.text_instruction(view.get("domain"))}]
    return system_prompt, user_turn


# ---------------------------------------------------------------------- step 4
def call_model(
    bedrock,
    model: ModelInfo,
    system_prompt: str,
    user_turn: list[dict],
    prompt_caching: bool,
    settings=None,
    typed: tuple[str, ...] = (),
) -> tuple[dict, dict, int]:
    """Step 4: one Converse request, the same shape for Anthropic, OpenAI and Amazon models.

    Prompt caching: a ``cachePoint`` block after the ontology marks everything before it as the
    cached prefix. The first call writes it to the cache (``cacheWriteInputTokens`` in the usage),
    every call within the next five minutes reads it (``cacheReadInputTokens``) at a fraction of the
    input price and latency. Anthropic and Amazon Nova models take the explicit checkpoint once the
    prefix reaches their minimum size (``model.cache_min_tokens``); OpenAI models cache a repeated
    prefix on their own on Converse, so their request is the same either way.
    ``typed``: an uploaded text, which goes through the guardrail of ``settings`` (guardrail.py);
    a photo and the ontology do not.
    """
    system = [{"text": system_prompt}]
    if prompt_caching and model.explicit_cache:
        system.append({"cachePoint": {"type": "default"}})

    inference = {"maxTokens": model.max_tokens}  # room for a dozen entities with parts
    if model.supports_temperature:  # Claude 5, GPT-5.6 and 6, Grok and Kimi reject a temperature
        inference["temperature"] = model.temperature

    request = {
        "modelId": model.id,  # e.g. global.anthropic.claude-opus-5-5: a cross-Region inference profile
        "system": system,
        "messages": [{"role": "user", "content": user_turn}],
        "inferenceConfig": inference,
    }
    if model.request_fields:  # a model's own settings, e.g. Grok 4.7's reasoning effort
        request["additionalModelRequestFields"] = dict(model.request_fields)
    request = hidden.clean_request(request)  # no invisible characters into the model (hidden.py)
    request = guardrail.mark(settings, request, typed)  # only an uploaded text
    started = time.perf_counter()
    response = bedrock.converse(**request)  # bedrock-runtime Converse API
    latency_ms = int((time.perf_counter() - started) * 1000)
    guardrail.check(response)
    return request, response, latency_ms


# ---------------------------------------------------------------------- step 5
def check_answer(
    view: dict,
    model: ModelInfo,
    system_prompt: str,
    request: dict,
    response: dict,
    latency_ms: int,
) -> dict:
    """Step 5: validate the answer against the ontology and read the token usage.

    The model's text must be the JSON object the prompt asked for. Every class, attribute property,
    value and part is looked up in the ontology, and so is the photo's own value (its occasion,
    ``photo_properties``): what exists is kept with its IRI, what does not is listed in
    ``issues`` and never kept. The model cannot add vocabulary by answering.
    """
    text = "".join(block.get("text", "") for block in response["output"]["message"]["content"])
    text = hidden.strip_hidden(text)  # invisible characters out first, then the check
    answer, issues = vision.validate(text, owl.vocabulary(view, IMAGE_CLASS))
    return {
        "model": model.to_dict(),
        "ontology_id": view.get("id"),
        "prompt_caching": any("cachePoint" in block for block in request["system"]),
        "entities": answer["entities"],  # with class_iri, attribute_iris, parts[].class_iri
        "photo_properties": answer["photo_properties"],  # the photo as a whole: {"for": "Evening"}
        "photo_property_iris": answer["photo_property_iris"],  # the same as IRIs, for kg.to_owl
        "feedback": answer["feedback"],  # what the model could not express with the ontology
        "notes": answer["notes"],
        "issues": issues,  # what the model said that the ontology does not have
        "raw_text": text,
        "stop_reason": response.get("stopReason", ""),
        "prompt": {
            "system": system_prompt,
            "user": request["messages"][0]["content"][-1]["text"],
            "request": vision.request_preview(request, system_prompt),
        },
        "usage": response.get("usage") or {},
        "metrics": vision.token_metrics(response, model, system_prompt, latency_ms),
    }
