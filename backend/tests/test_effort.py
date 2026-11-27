# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The reasoning effort of the trends agents (B1 design D5, B1-RULES 1.1 to 1.5): the levels each
model offers and the request fields of each, the refusals, the request of every caller without an
effort unchanged, and what the agents' loop keeps of a turn's reasoning (the trace, the
conversation), with fake Converse responses."""

from __future__ import annotations

import asyncio
import contextlib
import copy
import time
from types import SimpleNamespace

import pytest

from ontology_rag import agent_runtime, classify, lake_agent, mcp_agent, payoff, query_agent, vision
from ontology_rag.vision import model_info, with_effort

SONNET = "global.anthropic.claude-sonnet-5-5"
OPUS = "global.anthropic.claude-opus-5-5"
HAIKU = "global.anthropic.claude-haiku-5-5"
SOL = "global.openai.gpt-6.1-sol"
TERRA = "global.openai.gpt-6.1-terra"
ASTRA = "global.openai.gpt-6-astra"
NOVA = "global.amazon.nova-2-lite-v1:0"
GROK = "global.xai.grok-4.7"
KIMI = "global.moonshotai.kimi-k3"
NOT_OFFERED = (
    "global.openai.gpt-5.6-sol",
    "us.amazon.nova-pro-v1:0",
    "global.anthropic.claude-opus-5",
    "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    "us.example.unknown-model-v1",
)

THINK = {"thinking": {"type": "adaptive", "display": "summarized"}}
GROK_LOW = {"reasoning": {"effort": "low"}}

# B1-RULES 1.1 and 1.2: per model, the levels (in order), what "default" means, whether the
# reasoning is readable, the family, and the request fields each level adds.
EXPECTED = {
    SONNET: (
        "high",
        True,
        "anthropic",
        {
            "default": THINK,
            "low": {**THINK, "output_config": {"effort": "low"}},
            "medium": {**THINK, "output_config": {"effort": "medium"}},
            "high": {**THINK, "output_config": {"effort": "high"}},
        },
    ),
    OPUS: (
        "medium",
        True,
        "anthropic",
        {
            "default": THINK,
            "low": {**THINK, "output_config": {"effort": "low"}},
            "medium": {**THINK, "output_config": {"effort": "medium"}},
            "high": {**THINK, "output_config": {"effort": "high"}},
        },
    ),
    HAIKU: (
        "medium",
        True,
        "anthropic",
        {
            "default": THINK,
            "off": {"thinking": {"type": "disabled"}},
            "low": {**THINK, "output_config": {"effort": "low"}},
            "medium": {**THINK, "output_config": {"effort": "medium"}},
            "high": {**THINK, "output_config": {"effort": "high"}},
        },
    ),
    SOL: (
        "medium",
        False,
        "openai",
        {
            "default": {},
            "low": {"reasoning": {"effort": "low"}},
            "medium": {"reasoning": {"effort": "medium"}},
            "high": {"reasoning": {"effort": "high"}},
        },
    ),
    # Terra and Astra took the same three levels as Sol in a tool loop (9 Nov 2026)
    TERRA: (
        "medium",
        False,
        "openai",
        {"default": {}, **{e: {"reasoning": {"effort": e}} for e in ("low", "medium", "high")}},
    ),
    ASTRA: (
        "medium",
        False,
        "openai",
        {"default": {}, **{e: {"reasoning": {"effort": e}} for e in ("low", "medium", "high")}},
    ),
    # Nova medium spent its first turn reasoning in the live runs (9 Nov 2026): not offered
    NOVA: (
        "off",
        False,
        "nova",
        {
            "default": {},
            "low": {"reasoningConfig": {"type": "enabled", "maxReasoningEffort": "low"}},
        },
    ),
    # Grok's own fields keep "low" (every caller sends it); "medium" replaces it in the agents
    GROK: (
        "low",
        False,
        "grok",
        {"default": GROK_LOW, "medium": {"reasoning": {"effort": "medium"}}},
    ),
}


def tool():
    """An MCP tool definition, as the agents read it."""
    return SimpleNamespace(name="run_sql", description="SQL", input_schema={"type": "object"})


# ---------------------------------------------------------------------- the registry
def test_every_model_offers_its_levels_with_the_fields_of_each():
    for model_id, (means, readable, family, fields) in EXPECTED.items():
        model = model_info(model_id)
        assert model.reasoning == {
            "levels": list(fields),
            "default_means": means,
            "readable": readable,
            "family": family,
        }, model_id
        assert model.reasoning["levels"][0] == "default"
        assert model.reasoning_note is None and model.effort is None
        for effort, extra in fields.items():
            ran = with_effort(model, effort)
            assert ran.effort == effort and ran.request_fields == extra, (model_id, effort)
            # both agents send exactly these fields, with the same output budget at every level
            for request in (
                query_agent.plan(ran, "q", None, "schema", [tool()]),
                lake_agent.plan(ran, "q", tool()),
            ):
                assert request.get("additionalModelRequestFields", {}) == extra, (model_id, effort)
                assert request["inferenceConfig"]["maxTokens"] == min(model.max_tokens, 4096)
        assert model.request_fields == ({} if model_id != GROK else GROK_LOW)  # never mutated


def test_the_models_without_a_setting_say_why():
    kimi = model_info(KIMI)
    assert kimi.reasoning is None and kimi.strip_reasoning_history
    assert kimi.reasoning_note == (
        "Reasoning effort: set by the model. Kimi K3 always reasons at its highest level through "
        "the Converse API, so this agent cannot change it."
    )
    for model_id in NOT_OFFERED:
        model = model_info(model_id)
        assert model.reasoning is None and not model.strip_reasoning_history, model_id
        assert model.reasoning_note == (
            f"Reasoning effort: this sample offers no setting for {model.name}; it runs at the "
            "model's own default."
        )
    assert model_info("us.example.unknown-model-v1").name == "us.example.unknown-model-v1"
    assert not any(model_info(m).strip_reasoning_history for m in EXPECTED)


def test_the_catalog_the_browser_reads_has_the_reasoning_and_its_note():
    sonnet, kimi = model_info(SONNET).to_dict(), model_info(KIMI).to_dict()
    assert sonnet["reasoning"] == {
        "levels": ["default", "low", "medium", "high"],
        "default_means": "high",
        "readable": True,
        "family": "anthropic",
    }
    assert sonnet["reasoning_note"] is None
    assert kimi["reasoning"] is None and kimi["reasoning_note"].startswith("Reasoning effort: set")
    # the run's own state is not part of the catalog
    assert "effort" not in sonnet and "strip_reasoning_history" not in sonnet


def test_the_models_route_lists_the_reasoning_of_every_answer_model(loaded_service):
    from ontology_rag.api import dispatch

    status, out = dispatch(loaded_service, "GET", "/api/ask/models", {}, {})
    assert status == 200
    by_id = {m["id"]: m for m in out["models"]}
    assert by_id[GROK]["reasoning"]["levels"] == ["default", "medium"]
    assert by_id[KIMI]["reasoning"] is None and by_id[KIMI]["reasoning_note"]
    assert all("reasoning" in m and "reasoning_note" in m for m in out["models"])


def test_a_level_a_model_does_not_offer_is_refused():
    with pytest.raises(ValueError) as refused:
        with_effort(model_info(SONNET), "xhigh")
    assert str(refused.value) == (
        "effort 'xhigh' is not offered for Claude Sonnet 5.5: default, low, medium, high"
    )
    for effort in ("off", "max", "none", "", "HIGH", 3, ["low"]):
        with pytest.raises(ValueError, match="is not offered for Claude Sonnet 5.5"):
            with_effort(model_info(SONNET), effort)
    for model_id, effort in [
        (NOVA, "medium"),
        (NOVA, "high"),
        (GROK, "high"),
        (GROK, "low"),
        (TERRA, "off"),
        (ASTRA, "xhigh"),
    ]:
        with pytest.raises(ValueError, match="is not offered for"):
            with_effort(model_info(model_id), effort)
    for model_id in (KIMI, *NOT_OFFERED):
        model = model_info(model_id)
        for effort in ("default", "low"):
            with pytest.raises(ValueError) as refused:
                with_effort(model, effort)
            assert str(refused.value) == (
                f"effort is not offered for {model.name}: it has no reasoning setting in this sample"
            )


def test_no_effort_is_no_change_at_all():
    for model_id in (*EXPECTED, KIMI, *NOT_OFFERED):
        model = model_info(model_id)
        assert with_effort(model, None) is model
    # tab 3's query agent sends none: its request is the one of before (test_vision pins it)
    sonnet = model_info(SONNET)
    assert "additionalModelRequestFields" not in query_agent.plan(sonnet, "q", None, "s", [tool()])
    assert "additionalModelRequestFields" not in lake_agent.plan(sonnet, "q", tool())


def test_classification_and_the_answer_helper_still_ask_grok_for_low():
    """The callers that never choose an effort read the registry's fields: Grok's "low"."""
    grok = model_info(GROK)

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
    with_effort(grok, "medium")  # a run at medium leaves the registry as it was
    classify.call_model(bedrock, grok, "system", [{"text": "x"}], prompt_caching=True)
    payoff._converse(SimpleNamespace(bedrock=bedrock, settings=None), GROK, "system", "user")
    assert [r["additionalModelRequestFields"] for r in bedrock.requests] == [GROK_LOW, GROK_LOW]
    assert payoff._extra(GROK) == {"additionalModelRequestFields": GROK_LOW}
    assert vision.request_fields(GROK) == GROK_LOW


# ---------------------------------------------------------------------- the runtime checks it too
def test_the_query_agents_runtime_refuses_an_effort_the_model_does_not_offer(monkeypatch):
    monkeypatch.setenv("ANSWER_MODEL_IDS", f"{SONNET},{KIMI}")
    monkeypatch.setenv("GRAPH_ID", "g-test000000")
    out = agent_runtime.handle({"text": "x", "model_id": SONNET, "effort": "xhigh"})
    assert out == {
        "error": "effort 'xhigh' is not offered for Claude Sonnet 5.5: default, low, medium, high",
        "status": 400,
    }
    out = agent_runtime.handle({"text": "x", "model_id": KIMI, "effort": "default"})
    assert out == {
        "error": "effort is not offered for Kimi K3: it has no reasoning setting in this sample",
        "status": 400,
    }
    settings = agent_runtime.AgentSettings()
    _, _, model = agent_runtime._validate(
        {"text": "x", "model_id": SONNET, "effort": "low"}, settings
    )
    assert model.effort == "low" and model.request_fields["output_config"] == {"effort": "low"}
    _, _, model = agent_runtime._validate(
        {"text": "x", "model_id": SONNET, "effort": None}, settings
    )
    assert model is model_info(SONNET)  # tab 3's request: no setting


def test_the_service_sends_the_effort_to_the_runtime_and_the_resolved_model_in_process(
    loaded_service, monkeypatch
):
    svc = loaded_service
    sent = []
    monkeypatch.setattr(svc, "_agentcore_job", object())  # never a real client: no AWS call
    monkeypatch.setattr(svc, "query_agent_status", lambda: {"available": True, "host": "agentcore"})
    monkeypatch.setattr(
        svc, "invoke_runtime", lambda arn, payload, *a, **k: sent.append(payload) or {"rows": []}
    )
    svc.query_agent("q", None, SONNET, None, 300, effort="high")
    svc.query_agent("q", None, SONNET)  # tab 3: no effort
    job, tab_3 = sent
    assert job["model_id"] == SONNET and job["effort"] == "high" and job["deadline_s"] == 300
    assert tab_3["effort"] is None and "deadline_s" not in tab_3
    with pytest.raises(ValueError, match="effort 'xhigh' is not offered"):
        svc.query_agent("q", None, SONNET, effort="xhigh")
    ran = {}
    monkeypatch.setattr(
        svc, "query_agent_status", lambda: {"available": True, "host": "in-process"}
    )
    monkeypatch.setattr(query_agent, "run", lambda s, t, e, model, *a: ran.update(m=model) or {})
    svc.query_agent("q", None, GROK, effort="medium")
    assert ran["m"].effort == "medium" and ran["m"].request_fields == {
        "reasoning": {"effort": "medium"}
    }


def test_the_lake_agents_runtime_gets_the_effort_in_its_ask_task(loaded_service, monkeypatch):
    from ontology_rag import lakehouse

    svc = loaded_service
    sent = []
    monkeypatch.setattr(lakehouse, "require", lambda svc: {"host": "agentcore"})
    monkeypatch.setattr(
        lakehouse, "_runtime", lambda svc, task, session: sent.append(task) or {"job_id": "lake-1"}
    )
    out = lakehouse.ask(svc, "What is emerging?", NOVA, None, "low")
    assert out == {"job_id": "lake-1", "host": "agentcore"}
    assert sent == [{"task": "ask", "text": "What is emerging?", "model_id": NOVA, "effort": "low"}]
    lakehouse.ask(svc, "What is emerging?", NOVA, None)  # no effort: null, the request of before
    assert sent[-1]["effort"] is None
    with pytest.raises(ValueError, match="effort 'high' is not offered for Amazon Nova 2 Lite"):
        lakehouse.ask(svc, "What is emerging?", NOVA, None, "high")
    assert len(sent) == 2  # refused before the runtime was called


# ---------------------------------------------------------------------- the loop and the trace
class FakeClient:
    """An MCP client with one tool; the agent's ``execute`` below answers it."""

    async def list_tools(self):
        return SimpleNamespace(tools=[SimpleNamespace(name="count_rows")])


@contextlib.asynccontextmanager
async def connect():
    yield FakeClient(), None


class Turns:
    """A ``bedrock-runtime`` client: turn 1 reasons (the blocks given) and asks for a tool, turn 2
    answers. Every request is copied as it was sent."""

    def __init__(self, reasoning: list[dict]):
        self.reasoning = reasoning
        self.requests: list[dict] = []

    def converse(self, **request):
        time.sleep(0.003)  # so every step starts later than the one before
        self.requests.append(copy.deepcopy(request))
        if len(self.requests) == 1:
            use = {"toolUseId": "t1", "name": "count_rows", "input": {"table": "t79"}}
            content = [*copy.deepcopy(self.reasoning), {"toolUse": use}]
            stop = "tool_use"
        else:
            content = [{"text": "1234 rows."}]
            stop = "end_turn"
        return {
            "output": {"message": {"role": "assistant", "content": content}},
            "stopReason": stop,
            "usage": {"inputTokens": 10, "outputTokens": 5},
        }


def _run(model, reasoning: list[dict]):
    """One run of the shared loop with ``model`` and a turn 1 that carries ``reasoning``."""
    bedrock = Turns(reasoning)
    svc = SimpleNamespace(bedrock=bedrock)

    async def prepare(client, log, tools, steps):
        await asyncio.sleep(0.003)  # the agent's own first step (a schema call) takes a moment
        return {
            "modelId": model.id,
            "system": [{"text": "Count the rows."}],
            "messages": [{"role": "user", "content": [{"text": "How many rows in t79?"}]}],
            "inferenceConfig": {"maxTokens": 100},
        }

    async def execute(client, log, name, args, steps):
        t0 = time.perf_counter()
        await asyncio.sleep(0.003)
        entry = mcp_agent.step("mcp", name, args, True, t0, "1 row", to_model="1234")
        entry["count"], entry["rows"] = 1, [{"n": 1234}]
        return mcp_agent.done(steps, entry)

    run = asyncio.run(mcp_agent.tool_loop(svc, model, connect, prepare, execute, 60, 1, 6))
    result = mcp_agent.agent_result(run, "How many rows in t79?", None, model, "count_rows", {})
    return bedrock, result


def _signed(text: str) -> dict:
    return {"reasoningContent": {"reasoningText": {"text": text, "signature": "c2lnbmVk"}}}


def test_a_claude_turn_keeps_its_thinking_in_the_conversation_and_shows_the_summary():
    block = _signed("The table is t79; I count its rows.")
    model = with_effort(model_info(SONNET), "low")
    bedrock, result = _run(model, [block])
    sent_back = bedrock.requests[1]["messages"][1]
    assert sent_back["role"] == "assistant" and sent_back["content"][0] == block  # unchanged
    turn = result["steps"][1]
    assert turn["kind"] == "model" and turn["summary"] == "→ count_rows"
    assert turn["reasoning"] == "The table is t79; I count its rows."
    assert "redacted" not in turn
    assert result["effort"] == "low" and result["answer"] == "1234 rows."
    assert "reasoning" not in result["steps"][-1]  # the answer turn did not reason


def test_a_claude_summary_is_cut_for_the_browser_and_has_no_hidden_characters():
    model = model_info(SONNET)
    blocks = [_signed("\U000e0041" + "a" * 900), _signed("b" * 900)]
    bedrock, result = _run(model, blocks)
    shown = result["steps"][1]["reasoning"]
    assert len(shown) == mcp_agent.TO_BROWSER_CHARS and shown.startswith("a" * 900 + "\n\n")
    assert result["effort"] is None  # tab 3's runs carry no effort
    # the model gets its signed reasoning back byte for byte, hidden character included: a changed
    # text no longer matches its signature (the browser's copy above is the cleaned one)
    assert bedrock.requests[1]["messages"][1]["content"][:2] == blocks


def test_a_nova_turn_is_redacted_and_kept():
    block = {"reasoningContent": {"reasoningText": {"text": "[REDACTED]."}}}
    bedrock, result = _run(with_effort(model_info(NOVA), "low"), [block])
    assert bedrock.requests[1]["messages"][1]["content"][0] == block
    turn = result["steps"][1]
    assert turn["redacted"] is True and "reasoning" not in turn


@pytest.mark.parametrize("model_id", [SOL, GROK])
def test_an_encrypted_turn_is_redacted_and_kept(model_id):
    block = {"reasoningContent": {"redactedContent": b"\x00\x01encrypted"}}
    bedrock, result = _run(with_effort(model_info(model_id), "medium"), [block])
    assert bedrock.requests[1]["messages"][1]["content"][0] == block  # bytes go back unchanged
    turn = result["steps"][1]
    assert turn["redacted"] is True and "reasoning" not in turn


def test_a_kimi_turn_loses_its_reasoning_before_the_next_turn():
    blocks = [_signed("thinking hard"), {"reasoningContent": {"redactedContent": b"\x02"}}]
    bedrock, result = _run(model_info(KIMI), blocks)
    sent_back = bedrock.requests[1]["messages"][1]
    assert sent_back["role"] == "assistant"
    assert [list(b) for b in sent_back["content"]] == [["toolUse"]]  # only the tool call
    turn = result["steps"][1]
    assert turn["redacted"] is True and "reasoning" not in turn  # Kimi's text is not shown


def test_every_step_says_when_it_started():
    _, result = _run(model_info(SONNET), [])
    steps = result["steps"]
    assert [s["kind"] for s in steps] == ["mcp", "model", "mcp", "model"]
    assert steps[0]["at_ms"] == 0  # list_tools counts from the start of the run
    starts = [s["at_ms"] for s in steps]
    assert starts == sorted(starts) and len(set(starts)) == len(starts)  # each after the last
    assert all("t0" not in s for s in steps) and all("rows" not in s for s in steps)
    assert all(s["at_ms"] + s["ms"] <= result["metrics"]["total_ms"] + 1 for s in steps)
    assert not any("reasoning" in s or "redacted" in s for s in steps)  # no reasoning returned
