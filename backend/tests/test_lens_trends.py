# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6, "What are the emerging trends we see this season?" (lenses.trends_*), over a stub graph
and model: the map of worn garments with their int8 vectors, the walk from a clicked cloud, the
two descriptions and the routes."""

from __future__ import annotations

import base64
import math
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest

from ontology_rag import lenses, payoff, trends
from ontology_rag.api import dispatch
from ontology_rag.errors import NotReady


@dataclass
class N:
    id: str
    props: dict = field(default_factory=dict)


LOOKS = [N("look:a"), N("look:b"), N("look:c")]
ITEMS = [
    N("item:1", {"name": "cream wide-leg trousers", "category": "pants"}),
    N("item:2", {"name": "white oversized shirt (left)", "category": "shirt"}),
    N("item:3", {"name": "cream pleated trousers", "category": "pants", "run": "run-1"}),
    N("item:4", {"name": "black loafer", "run": "run-1"}),  # no category prop: its edge says
    N("item:9", {"name": "white sneakers from an article", "category": "shoe"}),  # in no look
]
CONTAINS = {
    "look:a": {"item:1", "item:2"},
    "look:b": {"item:1", "item:4"},
    "look:c": {"item:3", "item:2"},
}
VECTORS = {
    "item:1": [0.5, -0.25, 0.0],
    "item:2": [0.0, 2.0, -1.0],
    "item:3": [0.1, 0.1, 0.1],
    "item:4": [-3.0, 0.0, 1.5],
    "item:9": [1.0, 1.0, 1.0],
}


def walk_row(look, garment, name, category, new=False, occasion="Professional", attrs=()):
    return {
        "look": look,
        "look_name": f"{look} name",
        "image_key": f"whimsikora/looks/{look[5:]}.jpg",
        "occasion": occasion,
        "garment": garment,
        "garment_name": name,
        "category": category,
        "new": new,
        "attributes": list(attrs),
    }


WALK = [
    walk_row("look:a", "item:1", "cream wide-leg trousers", "pants", attrs=["wide leg"]),
    walk_row("look:a", "item:2", "white oversized shirt (left)", "shirt", attrs=["oversized"]),
    walk_row("look:b", "item:1", "cream wide-leg trousers", "pants", attrs=["wide leg"]),
    walk_row("look:b", "item:4", "black loafer", "shoe", new=True, occasion=None),
    walk_row("look:c", "item:3", "cream pleated trousers", "pants", new=True, occasion="Weekend",
             attrs=["pleat", "wide leg"]),
    walk_row("look:c", "item:2", "white oversized shirt (right)", "shirt", occasion="Weekend",
             attrs=["oversized"]),
]  # fmt: skip


class StubStore:
    """The store calls the map makes (get_nodes, neighbor_ids, get_embeddings) over a fixed
    graph, and the walk's rows for any openCypher."""

    def __init__(self, items=ITEMS, rows=WALK):
        self.items, self.rows, self.queries = items, rows, []

    def get_nodes(self, label, limit=500):
        nodes = {
            "Look": LOOKS,
            "Item": self.items,
            "Category": [N("category:shoe", {"name": "shoe"})],
        }
        return nodes.get(label, [])[:limit]

    def neighbor_ids(self, ids, types, direction="out"):
        if types == ["CONTAINS"]:
            return {i: set(CONTAINS.get(i, ())) for i in ids}
        if types == ["IS_CATEGORY"]:
            return {i: {"category:shoe"} for i in ids if i == "item:4"}
        return {}

    def get_embeddings(self, ids):
        return {i: VECTORS[i] for i in ids if i in VECTORS}

    def query(self, cypher, params=None):
        self.queries.append((cypher, params or {}))
        return self.rows


class StubBedrock:
    def __init__(self):
        self.requests = []

    def converse(self, **request):
        self.requests.append(request)
        system = request["system"][0]["text"]
        items = "row numbers" in system
        text = "Wide-leg trousers [1][2]." if items else "Worn to work [A][B]."
        # the items call reads 300 tokens from the prompt cache; the looks call reports no cache
        usage = (
            {"inputTokens": 800, "outputTokens": 120, "cacheReadInputTokens": 300}
            if items
            else {"inputTokens": 600, "outputTokens": 90}
        )
        return {"output": {"message": {"content": [{"text": text}]}}, "usage": usage}


def _svc(**store):
    return SimpleNamespace(store=StubStore(**store), bedrock=StubBedrock())


def _decode(b64: str, n: int, dim: int) -> list[list[int]]:
    raw = base64.b64decode(b64)
    assert len(raw) == n * dim
    return [[b - 256 if b > 127 else b for b in raw[i * dim : (i + 1) * dim]] for i in range(n)]


def _cos(a, b) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True)) / math.hypot(*a) / math.hypot(*b)


# ---------------------------------------------------------------------- step 1: the map
def test_the_map_has_every_worn_garment_and_only_those():
    m = lenses.trends_map(_svc())
    assert [i["id"] for i in m["items"]] == ["item:1", "item:2", "item:3", "item:4"]
    assert m["n"] == 4 and m["dim"] == 3 and m["truncated"] is False and m["unplaced"] == 0
    by_id = {i["id"]: i for i in m["items"]}
    assert by_id["item:1"] == {
        "id": "item:1",
        "name": "cream wide-leg trousers",
        "category": "pants",
        "new": False,
        "looks": 2,
    }
    assert by_id["item:3"]["new"] is True and by_id["item:4"]["new"] is True
    assert by_id["item:4"]["category"] == "shoe"  # from its IS_CATEGORY edge
    assert m["totals"] == {"new": 2, "base": 2}


def test_the_int8_vectors_keep_each_garments_direction():
    m = lenses.trends_map(_svc())
    decoded = _decode(m["vectors"], m["n"], m["dim"])
    for item, vec in zip(m["items"], decoded, strict=True):
        assert max(abs(x) for x in vec) == 127
        assert _cos(vec, VECTORS[item["id"]]) > 0.999


def test_the_map_is_cut_at_max_map_items(monkeypatch):
    monkeypatch.setattr(lenses, "MAX_MAP_ITEMS", 2)
    m = lenses.trends_map(_svc())
    assert m["truncated"] is True and [i["id"] for i in m["items"]] == ["item:1", "item:2"]
    assert m["totals"] == {"new": 0, "base": 2}


def test_a_graph_with_no_worn_garment_says_so():
    with pytest.raises(NotReady, match="no worn garments"):
        lenses.trends_map(_svc(items=[ITEMS[-1]]))


def test_the_map_runs_on_the_in_memory_store(loaded_service):
    status, m = dispatch(loaded_service, "GET", "/api/lenses/trends/map", {}, {})
    assert status == 200 and m["n"] == len(m["items"]) > 0 and m["dim"] > 0
    assert len(base64.b64decode(m["vectors"])) == m["n"] * m["dim"]
    assert all(i["looks"] >= 1 for i in m["items"])
    assert [i["id"] for i in m["items"]] == sorted(i["id"] for i in m["items"])


# ---------------------------------------------------------------------- step 3: the walk
def test_the_cloud_walks_to_its_looks_and_counts_in_code():
    svc = _svc()
    c = lenses.trends_cloud(svc, ["item:1", "item:3"])
    cypher, params = svc.store.queries[-1]
    assert cypher == lenses.CLOUD_WALK and params == {"ids": ["item:1", "item:3"]}
    assert c["edited"] is False and c["query"] == lenses.CLOUD_WALK
    assert [i["id"] for i in c["items"]] == ["item:1", "item:3"]  # in the order found
    trousers = c["items"][0]
    assert trousers["looks"] == 2 and trousers["attributes"] == ["wide leg"]
    assert trousers["colors"] == ["cream"] and trousers["new"] is False
    assert c["items"][1]["attributes"] == ["pleat", "wide leg"] and c["items"][1]["new"] is True
    # every look wears one cloud garment: by id then; letters in that order
    assert [(lk["letter"], lk["id"]) for lk in c["looks"]] == [
        ("A", "look:a"),
        ("B", "look:b"),
        ("C", "look:c"),
    ]
    a, b, cc = c["looks"]
    assert a["garments"] == ["cream wide-leg trousers", "white oversized shirt"]  # sides cleaned
    assert a["from_cloud"] == ["cream wide-leg trousers"] and a["new"] is False
    assert b["new"] is True and b["occasion"] == "Professional"
    assert cc["garments"] == ["cream pleated trousers", "white oversized shirt"]  # one shirt
    assert c["counts"] == {
        "items": 2,
        "new": 1,
        "looks": 3,
        "occasions": {"Professional": 2, "Weekend": 1},
        "categories": {"pants": 2},
        "details": {"wide leg": 2, "pleat": 1},
    }


def test_the_looks_with_most_of_the_cloud_come_first_and_at_most_twelve(monkeypatch):
    rows = [walk_row(f"look:{n:02d}", "item:1", "cream trousers", "pants") for n in range(14)]
    rows += [walk_row("look:13", "item:3", "cream pleated trousers", "pants", new=True)]
    c = lenses.trends_cloud(_svc(rows=rows), ["item:1", "item:3"])
    assert c["looks"][0]["id"] == "look:13" and c["looks"][0]["letter"] == "A"
    assert len(c["looks"]) == lenses.MAX_CLOUD_LOOKS and c["looks"][-1]["letter"] == "L"
    assert c["counts"]["looks"] == 14  # every look the walk reached, not only the ones shown


def test_an_edited_walk_runs_read_only_and_from_the_cloud():
    svc = _svc()
    edit = lenses.CLOUD_WALK.replace("collect(DISTINCT a.name)", "collect(a.name)")
    assert lenses.trends_cloud(svc, ["item:1"], edit)["edited"] is True
    with pytest.raises(PermissionError):
        lenses.trends_cloud(svc, ["item:1"], "MATCH (n) DETACH DELETE n")
    with pytest.raises(ValueError, match=r"\$ids"):
        lenses.trends_cloud(svc, ["item:1"], "MATCH (l:Look)-[:CONTAINS]->(i:Item) RETURN 1")
    with pytest.raises(ValueError, match="1 to 200"):
        lenses.trends_cloud(svc, [])


# ---------------------------------------------------------------------- steps 4-5: the models
def test_describe_sends_both_prompts_with_the_lift_computed_in_code():
    svc = _svc()
    out = lenses.describe(svc, "m", ["item:1", "item:3"])
    assert out["model"] == "m" and out["items"]["text"] == "Wide-leg trousers [1][2]."
    assert out["looks"]["text"] == "Worn to work [A][B]."
    systems = {r["system"][0]["text"] for r in svc.bedrock.requests}
    assert systems == {lenses.TRENDS_ITEMS_SYSTEM, lenses.TRENDS_LOOKS_SYSTEM}
    # the cloud: 1 of the season's 2 new garments, 1 of its 2 lookbook garments
    lift = round(trends.lift(1, 2, 1, 2), 2)
    items = out["items"]["user"]
    assert f"Lift: {lift:.2f}" in items and "2 garments, 1 from the new shoot" in items
    assert "The evidence is thin" in items  # 1 new piece: fewer than 3
    assert "[1] cream wide-leg trousers | pants | details: wide leg | colors: cream" in items
    assert "[2] cream pleated trousers" in items and "| new shoot" in items
    looks = out["looks"]["user"]
    assert (
        "Look A (Professional, lookbook): *cream wide-leg trousers; white oversized shirt" in looks
    )
    assert "Look B (Professional, new shoot)" in looks
    assert out["items"]["system"] == lenses.TRENDS_ITEMS_SYSTEM and out["looks"]["ms"] >= 0


def test_describe_returns_the_tokens_of_each_finding_and_their_sum():
    """Method 3's row of the side-by-side table counts the same tokens as the agents' rows."""
    out = lenses.describe(_svc(), "m", ["item:1", "item:3"])
    assert out["items"]["tokens"] == {
        "input": 800,
        "output": 120,
        "cache_read": 300,
        "cache_write": 0,
    }
    assert out["looks"]["tokens"] == {"input": 600, "output": 90, "cache_read": 0, "cache_write": 0}
    assert out["tokens"] == {"input": 1400, "output": 210, "cache_read": 300, "cache_write": 0}
    assert set(out) == {"items", "looks", "model", "ms", "tokens"}


def test_the_answer_helper_reports_the_prompt_caches_part_of_the_input():
    class Cached:
        def converse(self, **request):
            usage = {"inputTokens": 40, "outputTokens": 9, "cacheWriteInputTokens": 1800}
            return {"output": {"message": {"content": [{"text": "ok"}]}}, "usage": usage}

    out = payoff._converse(SimpleNamespace(bedrock=Cached(), settings=None), "m", "sys", "user")
    assert (out["input_tokens"], out["cache_read_tokens"], out["cache_write_tokens"]) == (
        40,
        0,
        1800,
    )


def test_a_cloud_with_no_lookbook_garment_gets_no_lift_number():
    """The map says "new shoot only" for such a cloud; the model gets the same words, not the
    smoothed lift (in the hundreds on a large lookbook)."""
    garment = {"category": "pants", "attributes": [], "colors": [], "looks": 1, "new": True}
    items = [{**garment, "name": f"garment {n}"} for n in range(3)]
    lift = lenses.trends_lift(items, {"new": 20, "base": 1300})
    assert lift > 100
    text = lenses.items_evidence({"items": items}, lift)
    assert lenses.NEW_SHOOT_ONLY in text and f"{lift:.2f}" not in text
    assert "3 garments, 3 from the new shoot, 0 from the lookbook" in text
    # one lookbook garment is enough for a lift
    mixed = items + [{**garment, "name": "lookbook garment", "new": False}]
    assert lenses.NEW_SHOOT_ONLY not in lenses.items_evidence({"items": mixed}, 1.25)
    assert "Lift: 1.25 (" in lenses.items_evidence({"items": mixed}, 1.25)


def test_the_evidence_never_cuts_a_row_in_half(monkeypatch):
    monkeypatch.setattr(lenses, "MAX_EVIDENCE_CHARS", 400)
    items = [
        {"name": f"garment {n}", "category": "pants", "attributes": [], "colors": [], "looks": 1,
         "new": True}
        for n in range(40)
    ]  # fmt: skip
    text = lenses.items_evidence({"items": items}, 1.5)
    assert len(text) <= 400 and text.endswith("more garments not listed)")
    assert all(line.endswith("new shoot") for line in text.splitlines() if line.startswith("["))


def test_a_cloud_the_walk_does_not_reach_is_not_described():
    with pytest.raises(ValueError, match="nothing to describe"):
        lenses.describe(_svc(rows=[]), "m", ["item:1"])


def test_the_prompts_have_no_em_dash():
    for text in (lenses.TRENDS_ITEMS_SYSTEM, lenses.TRENDS_LOOKS_SYSTEM, lenses.CLOUD_WALK):
        assert "\u2014" not in text and "\u2013" not in text


# ---------------------------------------------------------------------- the routes
def test_the_lens_is_listed_with_one_editable_step(loaded_service):
    status, body = dispatch(loaded_service, "GET", "/api/lenses", {}, {})
    lens = body["lenses"]["trends"]
    assert status == 200 and lens["question"] == "What are the emerging trends we see this season?"
    assert [s["editable"] for s in lens["steps"]] == [False, False, True]
    assert lens["steps"][2]["code"] == lenses.CLOUD_WALK
    assert all("\n" not in s["code"] for s in lens["steps"][:2])
    order = [k for k, v in lenses.PERSONA.items() if v == "creative director"]
    assert order == ["on-brand", "trends", "style-guide", "thin"]
    assert list(body["lenses"]).index("trends") == list(body["lenses"]).index("on-brand") + 1


@pytest.mark.parametrize("path", ["/api/lenses/trends/cloud", "/api/lenses/trends/describe"])
@pytest.mark.parametrize(
    "body",
    [{}, {"ids": []}, {"ids": "item:1"}, {"ids": ["item:1 OR 1=1"]}, {"ids": [1]},
     {"ids": [f"item:{n}" for n in range(201)]}],
)  # fmt: skip
def test_bad_cloud_ids_are_a_400(loaded_service, path, body):
    assert dispatch(loaded_service, "POST", path, {}, body)[0] == 400


def test_count_and_explain_do_not_run_the_map_lens():
    with pytest.raises(ValueError):
        lenses.count(_svc(), "trends")
    with pytest.raises(ValueError):
        lenses.explain(_svc(), "m", "trends", ["a"], [[1]])
