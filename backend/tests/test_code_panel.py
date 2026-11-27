# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The How-it-works panels' contract with the source: the code sets the API serves, the diagram
nodes their snippets are attached to (``code_panel_nodes.json``, which the web app's tests read
too), and every highlight still finding its line in the live code."""

from __future__ import annotations

from ontology_rag import api, code_panel
from ontology_rag.api import dispatch
from ontology_rag.code_panel import CODE_MARKS

KINDS = {"bedrock", "cache", "model", "ontology", "image", "prompt", "feedback", "output"}


def test_the_route_the_builders_and_the_node_file_name_the_same_code_sets():
    assert set(api._CODE_SETS) == set(code_panel.CODE_SETS) == set(code_panel.NODE_IDS)


def test_every_snippet_names_nodes_of_its_panels_diagram():
    for code_set, allowed in code_panel.NODE_IDS.items():
        for s in code_panel.snippets(code_set):
            unknown = set(s["nodes"]) - set(allowed)
            assert s["nodes"] and not unknown, (
                f"{code_set}/{s['id']}: not in the diagram: {unknown}"
            )


def test_code_panel_marks_resolve_on_the_live_source(loaded_service):
    """Every highlight in CODE_MARKS must still find its line in the function it annotates;
    a mark that no longer matches means the source changed and the note points nowhere."""
    by_id: dict[str, dict] = {}
    for code_set in api._CODE_SETS:
        status, code = dispatch(loaded_service, "GET", "/api/explorer/code", {"set": code_set}, {})
        assert status == 200
        for s in code["snippets"]:
            by_id.setdefault(s["id"], s)
    for sid, marks in CODE_MARKS.items():
        assert sid in by_id, f"CODE_MARKS has marks for unknown snippet {sid!r}"
        resolved = by_id[sid]["highlights"]
        assert len(resolved) == len(marks), (
            f"{sid}: {len(marks) - len(resolved)} mark(s) no longer match the source: "
            + ", ".join(m[1] for m in marks if not any(h["note"] == m[3] for h in resolved))
        )
        n_lines = len(by_id[sid]["code"].splitlines())
        for h in resolved:
            assert 1 <= h["start"] <= h["end"] <= n_lines
            assert h["kind"] in KINDS
    # tab 1 reads like the five steps: every step has code, and the teaching points are marked
    # (the ontology from S3, the photo, the prompt, the request with model, parameters and the
    # cache checkpoint, the Bedrock call, the check against the ontology)
    explorer = dispatch(loaded_service, "GET", "/api/explorer/code", {"set": "explorer"}, {})[1]
    steps = {n: [s for s in explorer["snippets"] if n in s["steps"]] for n in range(1, 6)}
    assert all(steps.values())
    kinds = {h["kind"] for n in steps for s in steps[n] for h in s["highlights"]}
    assert {"bedrock", "cache", "model", "prompt", "ontology", "image", "output"} <= kinds
    call = by_id["s4_call"]["highlights"]
    assert {"cache", "model", "bedrock"} <= {h["kind"] for h in call}
    # error handling is not part of the walk-through
    assert not any("except" in s["code"] for s in explorer["snippets"] if s["id"] != "s4_models")
    # tab 2: the orchestration and the insertion into Neptune, numbered 1-5
    pipe = dispatch(loaded_service, "GET", "/api/explorer/code", {"set": "pipeline"}, {})[1]
    assert {n for s in pipe["snippets"] for n in s["steps"]} == {1, 2, 3, 4, 5}
    # the pipeline set shows the state machine definition itself, as JSON, and the cypher
    assert (
        by_id["asl"]["language"] == "json" and '"QueryLanguage": "JSONata"' in by_id["asl"]["code"]
    )
    assert (
        by_id["p_cypher"]["language"] == "cypher" and "MERGE (n:Item" in by_id["p_cypher"]["code"]
    )
    assert dispatch(loaded_service, "GET", "/api/explorer/code", {"set": "nope"}, {})[0] == 400


def test_the_explorer_code_route_lists_the_five_steps_with_real_source(loaded_service):
    st, code = dispatch(loaded_service, "GET", "/api/explorer/code", {}, {})
    assert st == 200
    ids = [s["id"] for s in code["snippets"]]
    assert ids[:3] == ["s1_ontology", "s1_vocabulary", "s2_image"] and "route" in ids
    assert all(
        s["nodes"] and s["file"].startswith("backend/src/ontology_rag/") for s in code["snippets"]
    )
    assert all("def " in s["code"] or "class " in s["code"] for s in code["snippets"])
    assert {step for s in code["snippets"] for step in s["steps"]} == {1, 2, 3, 4, 5}


def test_the_trends_agents_show_the_prompts_they_get(loaded_service):
    """Both agent methods of tab 6's trends question list their prompts as text, first in their
    step: the question each agent gets (the template, with what its placeholders stand for) and
    the agents' system prompts. The text is the constant the code sends, only wrapped for reading."""
    from ontology_rag import lake_agent, query_agent, trends

    def entries(code_set: str) -> dict[str, dict]:
        snippets = dispatch(loaded_service, "GET", "/api/explorer/code", {"set": code_set}, {})[1]
        return {s["id"]: s for s in snippets["snippets"]}

    def words(text: str) -> list[str]:
        return text.split()

    graph, lake = entries("trends_graph"), entries("trends_lake")
    for sid, constant in [
        ("t_question", trends.AGENT_QUESTION),
        ("t_agent_system", query_agent.SYSTEM_PROMPT),
    ]:
        shown = graph[sid]
        assert shown["language"] == "text"
        body = "\n".join(ln for ln in shown["code"].splitlines() if not ln.startswith("# "))
        assert words(body) == words(constant), sid
    assert words(lake["k_question"]["code"].split("\n\n", 1)[1]) == words(trends.LAKE_QUESTION)
    assert words(lake["k_prompt"]["code"]) == words(lake_agent.SYSTEM_PROMPT)
    # the placeholders are explained above the question, and every line fits the panel
    assert "# {new}" in graph["t_question"]["code"] and "# {skip}" in lake["k_question"]["code"]
    assert max(len(ln) for ln in graph["t_question"]["code"].splitlines()[5:]) <= 100
    # the question comes first in its step
    step_2 = [sid for sid, s in graph.items() if 2 in s["steps"]]
    step_3 = [sid for sid, s in lake.items() if 3 in s["steps"]]
    assert step_2[0] == "t_question" and step_3[0] == "k_question"


def test_method_1_is_three_steps_and_the_removed_methods_are_gone(loaded_service):
    """The graph agent's panel: new items against the lookbook (1), ask the graph agent (2), count
    each group again (3). The vector method, the tested query and the analyst are gone."""
    graph = {s["id"]: s for s in code_panel.snippets("trends_graph")}
    assert list(graph) == ["t_items", "t_question", "t_agent_system", "t_agent", "t_agent_job",
                           "t_group"]  # fmt: skip
    assert {n for s in graph.values() for n in s["steps"]} == {1, 2, 3}
    assert graph["t_items"]["steps"] == [1] and graph["t_group"]["steps"] == [3]
    assert code_panel.NODE_IDS["trends_graph"] == ["agent", "browser", "lambda", "neptune", "llm"]
    assert "trends_vector" not in code_panel.CODE_SETS and "trends_vector" not in api._CODE_SETS
    assert not {"t_cooc", "t_explain", "t_analyst", "t_list", "t_ask"} & set(CODE_MARKS)
    status, _ = dispatch(loaded_service, "GET", "/api/explorer/code", {"set": "trends_vector"}, {})
    assert status == 400
    # the effort the deep dive chose is in the code the panel shows, and so is its check
    job = graph["t_agent_job"]["code"]
    assert "with_effort(svc.answer_model(model_id), effort)" in job and "def effort_fields" in job
