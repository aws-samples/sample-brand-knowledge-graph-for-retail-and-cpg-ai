# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Vision validation (vision.py: the answer against the ontology, the model registry, the usage
block) and the explorer routes that classify an image with the fake Bedrock client."""

import json
from dataclasses import replace

import pytest
from conftest import ONTOLOGIES, ONTOLOGY
from fakes import TEST_MODEL, FakeBedrock, fake_converse
from test_owl import MINI_TTL

from ontology_rag import classify, owl, vision
from ontology_rag.api import dispatch
from ontology_rag.config import DEFAULT_VISION_MODEL_IDS, Settings
from ontology_rag.embeddings import MockEmbedder
from ontology_rag.graph.memory import InMemoryStore
from ontology_rag.service import Service


def test_validate_maps_names_and_reports_unknowns():
    view = owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion")
    voc = owl.vocabulary(view)
    answer = {
        "entities": [
            {
                "id": "e1",
                "class": "coat",
                "label": "trench",
                "bbox": [100, 50, 900, 800],
                "confidence": 0.9,
                "attributes": {
                    "hasSilhouette": "straight",
                    "hasNecklineType": "v-neck",
                    "hasWaistline": "no such value",
                    "bogus": "x",
                },
                "parts": [
                    {"class": "Lapel", "bbox": [200, 100, 400, 300]},
                    {"class": "Button", "bbox": [1, 1, 2, 2]},
                ],
            },
            {"id": "e2", "class": "Spaceship", "bbox": [0, 0, 10, 10]},
            {"id": "e3", "class": "Shoe", "bbox": [500, 1000, 600, 1000]},
        ],
        "notes": "n",
    }
    parsed, issues = vision.validate(json.dumps(answer), voc)
    ents = {e["id"]: e for e in parsed["entities"]}
    assert ents["e1"]["class"] == "Coat" and ents["e1"]["class_iri"].endswith("#Coat")
    assert ents["e1"]["attributes"] == {"hasSilhouette": "straight", "hasNecklineType": "v-neck"}
    assert (
        ents["e1"]["parts"][0]["class"] == "Lapel"
        and ents["e1"]["parts"][0]["relation"] == "hasPart"
    )
    assert ents["e2"]["class_iri"] is None and ents["e3"]["bbox"] is None
    joined = " | ".join(issues)
    assert (
        "hasWaistline=" in joined
        and "bogus" in joined
        and "Button" in joined
        and "Spaceship" in joined
    )
    assert "degenerate bbox" in joined
    # no photo properties asked for (no image class), none kept
    assert parsed["photo_properties"] == {} and parsed["photo_property_iris"] == {}


FO = "http://example.org/multimodal-ai-knowledge-graph/fashion#"


@pytest.mark.parametrize(
    ("answered", "kept", "issue"),
    [
        ({"for": "Professional"}, {"for": "Professional"}, None),
        ({"for": "business casual"}, {"for": "Business casual"}, None),  # its pref label
        # the occasion Dress, never the garment class of the same name
        ({"For": "Dress"}, {"for": "Dress"}, None),
        ({"for": "Cocktail"}, {}, "photo property for: 'Cocktail' is not an allowed value"),
        ({"for": "Coat"}, {}, "photo property for: 'Coat' is not an allowed value"),
        ({"for": ["Casual", "Evening"]}, {}, "photo property for: \"['Casual', 'Evening']\""),
        ({"weather": "Sunny"}, {}, "unknown photo property 'weather'"),
        ({"for": None}, {}, None),
        ("Evening", {}, None),  # not an object: ignored
    ],
)
def test_validate_keeps_only_an_allowed_value_of_a_photo_property(answered, kept, issue):
    view = owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion")
    voc = owl.vocabulary(view, classify.IMAGE_CLASS)
    answer = {"entities": [], "photo_properties": answered}
    parsed, issues = vision.validate(json.dumps(answer), voc)
    assert parsed["photo_properties"] == kept
    iris = {f"{FO}for": f"{FO}occasion_{v.lower().replace(' ', '_')}" for v in kept.values()}
    assert parsed["photo_property_iris"] == iris
    if issue is None:
        assert issues == []
    else:
        assert len(issues) == 1 and issues[0].startswith(issue)


def test_check_answer_keeps_the_photos_occasion(loaded_service):
    view = classify.load_ontology(loaded_service, "fashion")
    sonnet = vision.model_info("global.anthropic.claude-sonnet-5-5")
    system_prompt, user_turn = classify.build_prompt(view, (b"x", "jpeg"))
    assert "## The whole photo (name: allowed values)" in system_prompt
    request = {"system": [{"text": system_prompt}], "messages": [{"content": user_turn}]}
    text = json.dumps({"entities": [], "photo_properties": {"for": "Evening"}})
    response = {"output": {"message": {"content": [{"text": text}]}}}
    result = classify.check_answer(view, sonnet, system_prompt, request, response, 10)
    assert result["photo_properties"] == {"for": "Evening"}
    assert result["photo_property_iris"] == {f"{FO}for": f"{FO}occasion_evening"}


def test_validate_salvages_truncated_output_and_dedupes_parts():
    voc = owl.vocabulary(owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion"))
    truncated = (
        '{"entities": [{"id": "e1", "class": "Jumpsuit", "bbox": [349, 140, 746, 906], "parts": '
        '[{"class": "Pocket", "bbox": [612, 368, 688, 405]}, {"class": "Pocket", "bbox": [612, 368, 688, 405]}]}, '
        '{"id": "e2", "class": "Belt", "bbox": [400, 400, 600, 450]}, {"id": "e3", "class": "Shoe", "bbox": [1, 2'
    )
    parsed, issues = vision.validate(truncated, voc)
    assert [(e["id"], e["class"], len(e["parts"])) for e in parsed["entities"]] == [
        ("e1", "Jumpsuit", 1),
        ("e2", "Belt", 0),
    ]
    assert any("truncated" in i for i in issues)


def test_validate_keeps_only_a_short_plain_entity_id():
    """The id becomes part of the item's node id in the graph: a model steered into a path, a
    space or 500 characters gets the default id of its position instead, and so do its parts
    and any feedback that named it."""
    voc = owl.vocabulary(owl.ontology_view(owl.load_graph(ONTOLOGY), "fashion"))
    answer = {
        "entities": [
            {"id": "../a b", "class": "Coat", "parts": [{"class": "Lapel"}]},
            {"id": "x" * 500, "class": "Shoe"},
            {"id": "jacket_2-b", "class": "Belt"},
            {"id": 7, "class": "Belt"},
        ],
        "ontology_feedback": [
            {"entity": "../a b", "kind": "value", "suggestion": "add value Teal"},
            {"entity": "jacket_2-b", "kind": "value", "suggestion": "add value Ochre"},
        ],
    }
    parsed, _ = vision.validate(json.dumps(answer), voc)
    ids = [e["id"] for e in parsed["entities"]]
    assert ids == ["e1", "e2", "jacket_2-b", "7"]
    assert parsed["entities"][0]["parts"][0]["id"] == "e1.p1"
    assert [f["entity"] for f in parsed["feedback"]] == [None, "jacket_2-b"]


def test_validate_tidies_ontology_feedback(loaded_service):
    voc = owl.vocabulary(loaded_service.ontology_view("fashion"))
    answer = {
        "entities": [{"id": "e1", "class": "Jacket", "label": "blazer", "bbox": [1, 2, 3, 4]}],
        "ontology_feedback": [
            {
                "observed": "small gold brooch on the lapel",
                "entity": "e1",
                "kind": "Class",
                "suggestion": "add class Brooch under OtherAccessory (or a new Jewelry group)",
            },
            {
                "observed": "oversized fit",
                "entity": "e9",
                "kind": "value",
                "suggestion": "add value 'oversized' to hasSilhouette",
            },
            {"kind": "value"},  # nothing said: dropped
            "not an object",
            {
                "observed": "pinstripe",
                "kind": "pattern",
                "suggestion": "add value pinstripe to hasTextilePattern",
            },
        ]
        + [{"observed": f"x{i}", "suggestion": f"s{i}"} for i in range(10)],
        "notes": "n",
    }
    parsed, issues = vision.validate(json.dumps(answer), voc)
    fb = parsed["feedback"]
    assert (
        len(fb) == 8
    )  # capped like the prompt asks: 8 usable items (3 real + 5 fillers), junk skipped
    assert (
        fb[0]
        == {
            "observed": "small gold brooch on the lapel",
            "entity": "e1",
            "kind": "class",
            "suggestion": "add class Brooch under OtherAccessory (or a new Jewelry group)",
            "already_known": [],  # Brooch is genuinely missing (the parent it names is not what it proposes)
        }
    )
    assert fb[1]["entity"] is None  # e9 is not an entity of this answer
    # "oversized" already is a silhouette value: the flag tells the reviewer the model just missed it
    assert fb[1]["already_known"] == ["oversized"]
    assert fb[2]["kind"] == "other" and fb[2]["already_known"] == []  # pinstripe is new
    # proposals in other phrasings, with and without quotes / the kind word
    known = vision.ontology_feedback(
        {
            "ontology_feedback": [
                {"suggestion": "Add PocketSquare under OtherAccessory."},
                {"suggestion": "Add 'Belt' as a class under WaistAccessory"},
                {"suggestion": "introduce a new value smooth leather for hasLeatherType"},
                {"suggestion": "Add Cuff under GarmentPart."},
                {"suggestion": "add class Earring under OtherAccessory"},
            ]
        },
        set(),
        voc,
    )
    # a sleeve cuff is still missing; the sample's own jewelry classes are known
    assert [k["already_known"] for k in known] == [[], ["belt"], [], [], ["earring"]]
    assert not issues  # feedback never produces validation issues
    assert vision.validate("garbage", voc)[0]["feedback"] == []


def test_validate_handles_non_json():
    voc = owl.vocabulary(owl.ontology_view(owl.parse_rdf(MINI_TTL), "mini"))
    parsed, issues = vision.validate("I cannot help with that.", voc)
    assert parsed["entities"] == [] and issues and "not JSON" in issues[0]


def test_model_registry():
    assert vision.model_info("global.anthropic.claude-sonnet-5-5").explicit_cache
    assert not vision.model_info("global.anthropic.claude-sonnet-5-5").supports_temperature
    guessed = vision.model_info("eu.someprovider.new-model-v1:0")
    assert guessed.provider == "someprovider" and guessed.third_party
    assert [m.id for m in vision.registry(("a", "b"))] == ["a", "b"]
    assert "mock" not in vision.KNOWN_MODELS  # the UI only ever offers real Bedrock models


def test_a_call_the_browser_waits_for_gets_one_attempt_inside_the_api_function(settings):
    """CloudFront waits 120 s for the API and the function stops after 115 s, so a model call the
    API waits for gets one attempt of 100 s and 5 s to connect: a slow call ends with the API's own
    error. botocore's ``max_attempts`` counts retries, hence ``total_max_attempts``. The pipeline
    function's calls wait for no browser: 120 s and up to three attempts."""
    api_call = vision.bedrock_client("us-east-1")._client_config
    assert (api_call.read_timeout, api_call.connect_timeout) == (100, 5)
    assert api_call.retries == {"total_max_attempts": 1, "mode": "standard"}
    background = vision.bedrock_client("us-east-1", background=True)._client_config
    assert background.read_timeout == 120
    assert background.retries == {"total_max_attempts": 3, "mode": "standard"}
    # the API's Service and the pipeline function's (lambda_handler.pipeline_handler)
    kwargs = {"store": InMemoryStore(), "embedder": MockEmbedder(256), "s3vectors": object()}
    assert Service(settings, **kwargs).bedrock._client_config.read_timeout == 100
    assert Service(settings, background=True, **kwargs).bedrock._client_config.read_timeout == 120


CONVERSE_OK = {
    "output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
    "stopReason": "end_turn",
    "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
    "metrics": {"latencyMs": 1},
}


class _Body:
    """The raw body of a botocore ``AWSResponse``."""

    def __init__(self, data: bytes):
        self.data = data

    def stream(self, **_):
        yield self.data


def _sends(client, failures):
    """Answer the client's sends here instead of over the network: raise the next exception of
    ``failures``, then answer every later send with CONVERSE_OK. Returns the list of sends."""
    from botocore.awsrequest import AWSResponse

    sent = []

    def send(request, **_):
        sent.append(request.url)
        if len(sent) <= len(failures):
            raise failures[len(sent) - 1]
        body = json.dumps(CONVERSE_OK).encode()
        return AWSResponse(request.url, 200, {"Content-Type": "application/json"}, _Body(body))

    client.meta.events.register("before-send", send)
    return sent


@pytest.fixture
def fake_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "example-secret")  # pragma: allowlist secret
    monkeypatch.delenv("AWS_SESSION_TOKEN", raising=False)
    monkeypatch.delenv("AWS_PROFILE", raising=False)


def test_a_reset_connection_gets_one_more_attempt_and_a_read_timeout_none(fake_credentials):
    """A NAT gateway resets a connection that has been idle for 350 s, and botocore reuses open
    connections: the first call after a quiet spell failed at once with ConnectionClosedError,
    and tab 4 showed "internal error" (tester, 13 Nov 2026). A call the browser waits for gets
    one more attempt for that error only; a read timeout still ends it (the retry would outlast
    the API function), and a second reset ends it too."""
    from botocore.exceptions import ConnectionClosedError, ReadTimeoutError

    call = {"modelId": "m", "messages": [{"role": "user", "content": [{"text": "hi"}]}]}
    reset = ConnectionClosedError(endpoint_url="https://bedrock-runtime/m")
    client = vision.bedrock_client("us-east-1")
    sent = _sends(client, [reset])
    assert client.converse(**call)["output"]["message"]["content"][0]["text"] == "ok"
    assert len(sent) == 2
    client = vision.bedrock_client("us-east-1")
    sent = _sends(client, [reset, reset])
    with pytest.raises(ConnectionClosedError):
        client.converse(**call)
    assert len(sent) == 2
    client = vision.bedrock_client("us-east-1")
    sent = _sends(client, [ReadTimeoutError(endpoint_url="https://bedrock-runtime/m")])
    with pytest.raises(ReadTimeoutError):
        client.converse(**call)
    assert len(sent) == 1


def test_the_agentcore_clients_also_retry_a_reset_connection_once(settings, fake_credentials):
    """The API's calls to the query agent (tab 3, and the trends job) try once, like the model
    calls, and get the same one retry for a reset connection."""
    from botocore.exceptions import ConnectionClosedError

    kwargs = {"store": InMemoryStore(), "embedder": MockEmbedder(256), "s3vectors": object()}
    svc = Service(settings, **kwargs)
    for client in (svc.agentcore, svc.agentcore_job):
        reset = ConnectionClosedError(endpoint_url="https://bedrock-agentcore/x")
        sent = _sends(client, [reset, reset])
        with pytest.raises(ConnectionClosedError):
            client.invoke_agent_runtime(agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/x", payload=b"{}")
        assert len(sent) == 2


def test_registry_offers_current_generation_models_through_inference_profiles():
    offered = list(vision.KNOWN_MODELS.values())
    # cross-Region inference everywhere: every id is an inference-profile id, global. preferred
    assert all(m.id.split(".")[0] in ("global", "us") for m in offered)
    assert (
        sum(m.id.startswith("global.") for m in offered) >= len(offered) - 1
    )  # Nova Pro has no global profile
    # the defaults are the first nine, every one through a global profile; four more ids stay
    # known for deployments that chose them (Opus 5, Haiku 4.5, GPT-5.6 Sol, Nova Pro)
    defaults = [m.id for m in offered[:9]]
    assert tuple(defaults) == DEFAULT_VISION_MODEL_IDS
    assert all(m.startswith("global.") for m in defaults)
    # the current generation of every multimodal family on Bedrock, four third-party, one first-party
    assert {m.provider for m in offered if m.third_party} == {
        "Anthropic",
        "OpenAI",
        "xAI",
        "Moonshot AI",
    }
    assert {m.provider for m in offered if not m.third_party} == {"Amazon"}
    # measured on Converse (2026-11-02): no new model takes a temperature; GPT-6 writes a cache at
    # a checkpoint, Grok and Kimi refuse one
    assert not any(vision.KNOWN_MODELS[m].supports_temperature for m in defaults[:6] + defaults[7:])
    assert vision.KNOWN_MODELS["global.openai.gpt-6.1-sol"].explicit_cache
    assert not vision.KNOWN_MODELS["global.openai.gpt-5.6-sol"].explicit_cache
    for m in ("global.xai.grok-4.7", "global.moonshotai.kimi-k3"):
        assert not vision.KNOWN_MODELS[m].explicit_cache
        assert vision.KNOWN_MODELS[m].cache_min_tokens is None
    # Grok 4.7 thinks at "high" effort unless told otherwise: every request asks for "low";
    # Kimi K3 reasons at its highest effort whatever Converse says, so it gets the output budget
    assert vision.request_fields("global.xai.grok-4.7") == {"reasoning": {"effort": "low"}}
    assert vision.KNOWN_MODELS["global.moonshotai.kimi-k3"].max_tokens == 32768
    assert all(not vision.request_fields(m) for m in defaults if "grok" not in m)


def test_every_request_carries_the_models_own_fields():
    """Grok's effort reaches classification, the answer helper and both agents; other models send
    no additionalModelRequestFields at all."""
    from ontology_rag import lake_agent, payoff, query_agent

    grok = vision.model_info("global.xai.grok-4.7")
    sonnet = vision.model_info("global.anthropic.claude-sonnet-5-5")

    class Bedrock:
        def __init__(self):
            self.requests = []

        def converse(self, **request):
            self.requests.append(request)
            return {
                "output": {"message": {"content": [{"text": "ok"}]}},
                "usage": {},
                "stopReason": "end_turn",
            }

    bedrock = Bedrock()
    for model in (grok, sonnet):
        classify.call_model(bedrock, model, "system", [{"text": "x"}], prompt_caching=True)
    assert bedrock.requests[0]["additionalModelRequestFields"] == {"reasoning": {"effort": "low"}}
    assert "additionalModelRequestFields" not in bedrock.requests[1]

    class Svc:
        settings = None

    svc = Svc()
    svc.bedrock = bedrock
    payoff._converse(svc, grok.id, "system", "user")
    assert bedrock.requests[-1]["additionalModelRequestFields"] == {"reasoning": {"effort": "low"}}
    payoff._converse(svc, sonnet.id, "system", "user")
    assert "additionalModelRequestFields" not in bedrock.requests[-1]

    tool = type(
        "T", (), {"name": "run_sql", "description": "SQL", "input_schema": {"type": "object"}}
    )()
    assert query_agent.plan(grok, "q", None, "schema", [tool])["additionalModelRequestFields"]
    assert "additionalModelRequestFields" not in query_agent.plan(
        sonnet, "q", None, "schema", [tool]
    )
    assert lake_agent.plan(grok, "q", tool)["additionalModelRequestFields"]
    assert "additionalModelRequestFields" not in lake_agent.plan(sonnet, "q", tool)
    # superseded ids fail loudly with the replacement, with or without a CRIS prefix
    for retired, replacement in [
        ("global.anthropic.claude-sonnet-4-6", "global.anthropic.claude-sonnet-5-5"),
        ("us.anthropic.claude-opus-4-7-20260115-v1:0", "global.anthropic.claude-opus-5"),
        (
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "global.anthropic.claude-haiku-4-5-20251001-v1:0",
        ),
        ("openai.gpt-5.5", "global.openai.gpt-5.6-sol"),
    ]:
        with pytest.raises(ValueError, match=f"superseded.*{replacement}"):
            vision.model_info(retired)
    # ... and the check reaches the API as a 400, not a model call
    stale = Settings(vision_model_ids=("us.anthropic.claude-sonnet-4-6",))
    assert stale.vision_model_ids == ("us.anthropic.claude-sonnet-4-6",)


@pytest.fixture
def bedrock_service(settings):
    """A Service with two models enabled whose Bedrock client is a fake; the route builds real requests."""
    return Service(
        replace(
            settings,
            vision_model_ids=(
                "global.anthropic.claude-sonnet-5-5",
                "global.amazon.nova-2-lite-v1:0",
            ),
        ),
        store=InMemoryStore(),
        embedder=MockEmbedder(256),
        bedrock=FakeBedrock(),
    )


def test_route_builds_the_converse_request_in_the_open(bedrock_service):
    """The request literal in api.vision_classify: system = ontology (+ cachePoint), user turn =
    image bytes + instruction, per-model inference config, modelId the only provider-specific field."""
    svc = bedrock_service
    prompt = owl.classification_prompt(svc.ontology_view("fashion"), classify.IMAGE_CLASS)
    jpg = (ONTOLOGIES / "fashion" / "examples" / "images" / "08-pinstripe-suit.jpg").read_bytes()
    body = {"ontology_id": "fashion", "example": "08-pinstripe-suit.jpg", "prompt_caching": True}

    st, r = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {**body, "model_id": "global.anthropic.claude-sonnet-5-5"},
    )
    assert st == 200
    req = svc.bedrock.requests[-1]
    assert req["modelId"] == "global.anthropic.claude-sonnet-5-5"
    assert req["system"] == [{"text": prompt}, {"cachePoint": {"type": "default"}}]
    content = req["messages"][0]["content"]
    assert content[0]["image"] == {"format": "jpeg", "source": {"bytes": jpg}}
    assert "576x1024" in content[1]["text"] and content[1]["text"] == r["prompt"]["user"]
    assert req["inferenceConfig"] == {"maxTokens": 8192}  # Claude 5: no temperature
    assert r["prompt_caching"] is True and r["metrics"]["cache_read_tokens"] > 0
    # the preview in the response elides the two big payloads and nothing else
    preview = r["prompt"]["request"]
    assert preview["system"][0] == {"text": f"<ontology prompt, {len(prompt)} chars>"}
    assert preview["system"][1] == {"cachePoint": {"type": "default"}}
    assert preview["messages"][0]["content"][0]["image"]["source"] == {
        "bytes": f"<{len(jpg)} bytes>"
    }
    assert preview["inferenceConfig"] == req["inferenceConfig"]

    # caching off: no checkpoint, and the fake moves the prompt back into inputTokens
    st, off = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {**body, "prompt_caching": False, "model_id": "global.anthropic.claude-sonnet-5-5"},
    )
    assert svc.bedrock.requests[-1]["system"] == [{"text": prompt}]
    assert off["prompt_caching"] is False and off["metrics"]["cache_read_tokens"] == 0
    assert off["metrics"]["input_tokens"] > r["metrics"]["input_tokens"]

    # Nova: the explicit checkpoint like Anthropic, temperature 0.3, maxTokens capped at 5,000
    st, nova = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {**body, "model_id": "global.amazon.nova-2-lite-v1:0"},
    )
    nreq = svc.bedrock.requests[-1]
    assert nreq["system"] == [{"text": prompt}, {"cachePoint": {"type": "default"}}]
    assert nreq["inferenceConfig"] == {"maxTokens": 5000, "temperature": 0.3}
    assert nova["prompt_caching"] is True and nova["metrics"]["cache_eligible"] is True

    # a model the deployment does not offer is a 400, before any call
    n = len(svc.bedrock.requests)
    st, err = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {**body, "model_id": "global.anthropic.claude-opus-5"},
    )
    assert st == 400 and "not enabled" in err["error"] and len(svc.bedrock.requests) == n


def test_check_answer_reads_usage_and_bedrock_latency(loaded_service):
    view = loaded_service.ontology_view("fashion")
    prompt = owl.classification_prompt(view)
    sonnet = vision.model_info("global.anthropic.claude-sonnet-5-5")
    request = {
        "modelId": sonnet.id,
        "system": [{"text": prompt}, {"cachePoint": {"type": "default"}}],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"image": {"format": "jpeg", "source": {"bytes": b"x"}}},
                    {"text": "go"},
                ],
            }
        ],
        "inferenceConfig": {"maxTokens": 8192},
    }
    response = fake_converse(request, prompt)
    result = classify.check_answer(view, sonnet, prompt, request, response, latency_ms=999)
    assert (
        result["prompt_caching"] is True and result["metrics"]["latency_ms"] == 42
    )  # metrics.latencyMs wins
    u = response["usage"]
    assert result["metrics"]["total_input_tokens"] == u["inputTokens"] + u["cacheReadInputTokens"]
    assert result["entities"] and result["feedback"] and result["prompt"]["user"] == "go"


def test_image_size_from_headers():
    jpg = (ONTOLOGIES / "fashion" / "examples" / "images" / "01-trench-coat-sweater-dress.jpg").read_bytes()
    assert vision.image_size(jpg) == (576, 1024)
    assert vision.image_size(b"not an image") is None


# ---------------------------------------------------------------------- routes (fake Bedrock)
def test_explorer_routes(loaded_service):
    svc = loaded_service
    st, p = dispatch(svc, "GET", "/api/ontologies", {}, {})
    listed = {o["id"]: o for o in p["ontologies"]}
    assert st == 200 and sorted(listed) == ["beauty", "fashion", "food", "home"]
    assert p["default"] == "fashion" and listed["fashion"]["domain"]["name"] == "Fashion"
    # the aisles are listed to browse, with the words tab 1 step 4 starts with
    assert [i for i, o in listed.items() if not o["domain"]["browse_only"]] == ["fashion"]
    assert listed["beauty"]["domain"]["start_with"] == ["Serum", "hasKeyIngredient", "Dropper"]
    st, p = dispatch(svc, "GET", "/api/ontologies/detail", {"id": "fashion"}, {})
    # 400 nodes and, since version 1.2.0, the class Occasion, its 9 values and the property for
    assert st == 200 and len(p["view"]["nodes"]) == 411 and len(p["examples_list"]) == 8
    st, _ = dispatch(svc, "GET", "/api/ontologies/detail", {"id": "nope"}, {})
    assert st == 404
    st, p = dispatch(
        svc,
        "GET",
        "/api/ontologies/example-image",
        {"id": "fashion", "file": "08-pinstripe-suit.jpg"},
        {},
    )
    assert st == 200 and p["data_url"].startswith("data:image/jpeg;base64,")
    st, _ = dispatch(
        svc, "GET", "/api/ontologies/example-image", {"id": "fashion", "file": "../fashion.ttl"}, {}
    )
    assert st == 404
    st, p = dispatch(svc, "GET", "/api/vision/models", {}, {})
    assert st == 200 and "offline" not in p and p["models"][0]["id"] == TEST_MODEL
    assert all(m["id"] != "mock" for m in p["models"])
    st, p = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {"ontology_id": "fashion", "example": "02-sheath-dress-knee-high-boots.jpg", "model_id": TEST_MODEL},
    )
    assert (
        st == 200
        and p["entities"]
        and p["metrics"]["total_input_tokens"] > 0
        and p["prompt"]["system"]
    )
    assert "576x1024" in p["prompt"]["user"]
    assert "every garment, accessory and garment component" in p["prompt"]["user"]
    st, p = dispatch(
        svc,
        "POST",
        "/api/vision/classify",
        {},
        {
            "owl_text": MINI_TTL,
            "model_id": TEST_MODEL,
            "image_base64": "data:image/png;base64,aGVsbG8=",
        },
    )
    assert st == 200 and p["ontology_id"].startswith("upload-")
    st, p = dispatch(svc, "POST", "/api/vision/classify", {}, {"model_id": TEST_MODEL})
    assert st == 400
    st, p = dispatch(
        svc, "POST", "/api/ontologies/parse", {}, {"text": MINI_TTL, "filename": "mini.ttl"}
    )
    assert st == 200 and p["stats"]["classes"] == 6
    st, p = dispatch(svc, "GET", "/api/explorer/code", {}, {})
    assert st == 200 and "s1_ontology" in [x["id"] for x in p["snippets"]]
    assert all("def " in x["code"] or "class " in x["code"] for x in p["snippets"])
    # five numbered steps, each with code
    assert {step for x in p["snippets"] for step in x["steps"]} == {1, 2, 3, 4, 5}
