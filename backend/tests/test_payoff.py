# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The payoff (payoff.py): three columns over a fake graph, a fake catalog index and a fake model.

The in-memory graph has no openCypher engine, so the traversal's rows come from a stub store; the
aggregation, the evidence numbering, the tree and the route's validation are what is tested.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import pytest

from ontology_rag import api, lenses, payoff
from ontology_rag.api import dispatch
from ontology_rag.errors import NotReady


@dataclass
class N:
    id: str
    props: dict = field(default_factory=dict)


class StubStore:
    """topk -> sneakers (and one far-off bag); query -> the traversal's rows for two looks.
    Every garment is worn in a look unless ``unworn`` names it (an article's garment)."""

    def __init__(self, unworn: set[str] | None = None):
        self.queries = []
        self.unworn = unworn or set()

    def neighbor_ids(self, node_ids, edge_types, direction="out"):
        assert direction == "in" and edge_types == ["CONTAINS"]
        return {n: (set() if n in self.unworn else {f"look-of-{n}"}) for n in node_ids}

    def topk(self, embedding, k, labels):
        return [
            (N("g1", {"name": "white sneaker (left)", "category": "shoe"}), 1.40),
            (N("g2", {"name": "white sneaker (right)", "category": "shoe"}), 1.41),
            (N("g3", {"name": "white platform sneaker", "category": "shoe"}), 1.45),
            (N("b9", {"name": "black tote bag", "category": "bag"}), 1.42),
            (N("g4", {"name": "brown boot", "category": "shoe"}), 1.90),
        ]

    def query(self, cypher, params):
        self.queries.append((cypher, params))
        row = lambda look, occ, gid, name, cat, attrs: {
            "look": look,
            "look_name": f"{look}.png",
            "occasion": occ,
            "garment": gid,
            "garment_name": name,
            "category": cat,
            "attributes": attrs,
        }
        return [
            row("lk1", "Professional", "p1", "cream wide-leg trousers", "pants", ["wide leg"]),
            row(
                "lk1",
                "Professional",
                "e1",
                "gold hoop earring (left)",
                "earring, ear stud, hoop",
                ["metal"],
            ),
            row(
                "lk1",
                "Professional",
                "e2",
                "gold hoop earring (right)",
                "earring, ear stud, hoop",
                ["metal"],
            ),
            row("lk2", "Professional", "p2", "black wide-leg trousers", "pants", ["wide leg"]),
            row("lk2", "Professional", "j1", "black double-breasted blazer", "jacket", ["blazer"]),
            row("lk3", "Dress", "e3", "gold hoop earrings", "earring, ear stud, hoop", ["metal"]),
        ]

    def get_nodes(self, label, limit):
        return (
            [N("brand:anycompany-fashion-house", {"name": "AnyCompany Fashion House"})]
            if label == "Brand"
            else []
        )


class StubVectors:
    def __init__(self, missing=False):
        self.missing, self.calls = missing, []

    def get_vectors(self, vectorBucketName, indexName, keys, **_):
        return {
            "vectors": [
                {
                    "key": keys[0],
                    "data": {"float32": [0.6, 0.8] + [0.0] * 14},
                    "metadata": {"name": "White leather sneakers", "text": "sneakers"},
                }
            ]
        }

    def query_vectors(self, vectorBucketName, indexName, queryVector, topK, **_):
        self.calls.append(indexName)
        if self.missing:
            raise type("NotFoundException", (Exception,), {})("index not found")
        name = f"item for {len(self.calls)}"
        dup = {
            "key": f"dup{len(self.calls)}",
            "distance": 0.6,
            "metadata": {
                "name": "Gold metal hoop earrings",
                "text": "hoops",
                "category": "accessory",
            },
        }
        return {
            "vectors": [
                {
                    "key": f"k{len(self.calls)}",
                    "distance": 0.5,
                    "metadata": {"name": name, "text": f"{name} text"},
                },
                dup,
                dict(dup, key=f"dupb{len(self.calls)}"),
            ]
        }


class StubBedrock:
    def __init__(self):
        self.requests = []

    def converse(self, **request):
        self.requests.append(request)
        system = request["system"][0]["text"]
        if "Plan the product catalog searches" in system:
            text = json.dumps({"searches": ["dark jeans", "white tee"], "why": "casual basics"})
        elif "numbered evidence" in system:
            text = "Lead with the pattern [1], then the item [2]."
        else:
            text = "White sneakers go with anything casual."
        return {
            "output": {"message": {"content": [{"reasoningContent": {}}, {"text": text}]}},
            "usage": {"inputTokens": 10, "outputTokens": 5},
        }


@dataclass
class Settings:
    vector_bucket: str = "bucket"
    catalog_index: str = "catalog"


class StubEmbedder:
    def embed_text(self, text, purpose):
        return [0.1, 0.2]


@dataclass
class Model:
    id: str = "global.anthropic.claude-sonnet-5-5"

    def to_dict(self):
        return {"id": self.id}


class StubService:
    def __init__(self, missing_index=False):
        self.store = StubStore()
        self.s3vectors = StubVectors(missing_index)
        self.bedrock = StubBedrock()
        self.embedder = StubEmbedder()
        self.settings = Settings()

    def answer_model(self, model_id):
        return Model(model_id or Model.id)


def test_guidance_anchors_aggregates_and_counts_per_look():
    g = payoff.guidance(StubService(), "What goes with white sneakers?")
    # anchors: every garment within ANCHOR_BAND of the closest, whatever its type (the nearby bag
    # is in, the far boot is out)
    assert [a["id"] for a in g["anchor"]["garments"]] == ["g1", "g2", "g3", "b9"]
    assert g["anchor"]["types"] == {"shoe": 3, "bag": 1}
    assert g["anchor"]["category"] == "shoe"  # the most common type: a label, not a filter
    assert g["anchor"]["nearest"] == "white sneaker"
    assert {lk["id"] for lk in g["looks"]} == {"lk1", "lk2", "lk3"}
    assert g["occasion"] == [{"name": "Professional", "count": 2}, {"name": "Dress", "count": 1}]
    cats = {c["name"]: c for c in g["categories"]}
    # counted per look, not per garment: the left and right earrings of lk1 count once
    assert (
        cats["pants"]["count"] == 2
        and cats["earring"]["count"] == 2
        and cats["jacket"]["count"] == 1
    )
    assert set(cats["pants"]["colors"]) == {"cream", "black"}
    assert cats["earring"]["search"] == "gold hoop earring"  # a real garment, without its side
    assert "wide leg" in cats["pants"]["details"]


class ArticleStore(StubStore):
    """The closest garments come from an article tab 2 ingested (white leather sneakers, white
    knee socks…): they are in the graph, in no look. The brand's own white sneakers come next,
    just outside the band the article's garments would set."""

    def __init__(self):
        super().__init__(unworn={"a1", "a2", "a3", "a4"})

    def topk(self, embedding, k, labels):
        article = [
            (N("a1", {"name": "white leather sneakers", "category": "shoe"}), 1.301),
            (N("a2", {"name": "white knee socks", "category": "sock"}), 1.315),
            (N("a3", {"name": "ivory crinkled cotton shirt", "category": "shirt"}), 1.350),
            (N("a4", {"name": "large black leather tote", "category": "bag"}), 1.387),
        ]
        return article + [(n, round(d + 0.005, 3)) for n, d in super().topk(embedding, k, labels)]


def test_anchors_are_garments_worn_in_a_look_not_an_articles():
    """An article's garments would take every anchor of the workshop's own question and the
    traversal would find no look (seen on 2026-11-02): the band is measured on worn garments."""
    svc = StubService()
    svc.store = ArticleStore()
    a = payoff.find_anchors(svc, "what goes with white sneakers?")
    assert [g["id"] for g in a["garments"]] == ["g1", "g2", "g3", "b9"]
    assert a["nearest"] == "white sneaker" and a["category"] == "shoe"
    assert a["unworn"] == 4
    # the search is shown as it ran: the article's hits stay in the list, marked
    by_id = {c["id"]: c for c in a["candidates"]}
    assert by_id["a1"]["in_look"] is False and by_id["g1"]["in_look"] is True
    assert [c["id"] for c in a["candidates"]][:5] == ["a1", "a2", "a3", "a4", "g1"]
    assert "b9" in by_id  # every anchor is listed, even past the usual length
    g = payoff.guidance(svc, "what goes with white sneakers?")
    assert {lk["id"] for lk in g["looks"]} == {"lk1", "lk2", "lk3"}


def test_anchors_need_at_least_one_worn_garment():
    svc = StubService()
    svc.store = StubStore(unworn={"g1", "g2", "g3", "b9", "g4"})
    with pytest.raises(NotReady, match="none of the closest garments is in a look"):
        payoff.find_anchors(svc, "what goes with white sneakers?")


class BlazerStore(StubStore):
    """The nearest garment is a top worn under a blazer; most of the rest are jackets, in colors."""

    def topk(self, embedding, k, labels):
        return [
            (
                N("t1", {"name": "black top with deep neckline under blazer", "category": "top"}),
                1.45,
            ),
            (N("j1", {"name": "black double-breasted blazer", "category": "jacket"}), 1.47),
            (N("j2", {"name": "gray pinstriped blazer", "category": "jacket"}), 1.48),
            (N("j3", {"name": "black oversized blazer", "category": "jacket"}), 1.49),
            (N("c1", {"name": "long black blazer-coat", "category": "coat"}), 1.49),
            (N("j4", {"name": "cream blazer", "category": "jacket"}), 1.50),
        ]


def test_the_simple_way_in_keeps_the_closest_by_meaning_whatever_the_type_or_color():
    svc = StubService()
    svc.store = BlazerStore()
    g = payoff.guidance(svc, "What goes with a black blazer?")
    # the top worn under a blazer, the gray and cream blazers and the coat all stay: meaning, not words
    assert [a["id"] for a in g["anchor"]["garments"]] == ["t1", "j1", "j2", "j3", "c1", "j4"]
    assert g["anchor"]["category"] == "jacket"
    assert g["anchor"]["label"] == "black blazer"  # the words most of their names share


class SmartBedrock(StubBedrock):
    """The understand and choose steps of the smart retriever, then the stub's answer."""

    def __init__(self, grades):
        super().__init__()
        self.grades = grades

    def converse(self, **request):
        system = request["system"][0]["text"]
        if "say how to look it up" in system:
            text = json.dumps({"start": ["black blazer"], "find": "", "must": ["black"]})
        elif "You grade garments" in system:
            text = json.dumps({"grades": self.grades})
        else:
            return super().converse(**request)
        self.requests.append(request)
        return {"output": {"message": {"content": [{"text": text}]}}, "usage": {}}


def test_the_smart_way_in_lets_the_model_keep_the_matching_garments():
    svc = StubService()
    svc.store = BlazerStore()
    # j1 and j3 are exact, j2 similar, the top no; junk numbers and grades are ignored
    svc.bedrock = SmartBedrock(
        {
            "1": "no",
            "2": "exact",
            "3": "similar",
            "4": "exact",
            "99": "exact",
            "x": "exact",
            "5": "?",
        }
    )
    g = payoff.smart_guidance(svc, "m", "What goes with a black blazer?")
    assert g["plan"] == {"start": ["black blazer"], "find": "", "must": ["black"]}
    assert g["starts"][0]["kept"] == ["j1", "j3"]
    assert [a["id"] for a in g["anchor"]["garments"]] == ["j1", "j3"]
    assert g["notes"] == []
    # the traversal ran from those two only
    assert svc.store.queries[-1][1]["anchors"] == ["j1", "j3"]
    # the model sees the numbered garments
    choose_req = svc.bedrock.requests[1]["messages"][0]["content"][0]["text"]
    assert "1. black top with deep neckline under blazer" in choose_req
    # both new calls are returned as sent and as answered, for Inspect
    assert g["plan_inspect"]["system"] == payoff.UNDERSTAND_SYSTEM
    assert g["plan_inspect"]["user"] == "Question: What goes with a black blazer?"
    assert '"start"' in g["plan_inspect"]["reply"]
    assert g["starts"][0]["inspect"]["system"] == payoff.CHOOSE_SYSTEM
    assert g["starts"][0]["inspect"]["user"] == choose_req
    assert g["starts"][0]["query"].startswith("CALL neptune.algo.vectors.topK.byEmbedding(")


def test_no_exact_match_is_said_and_the_closest_are_used():
    svc = StubService()
    svc.store = BlazerStore()
    svc.bedrock = SmartBedrock({"1": "no", "2": "similar"})  # no exact one: start from the similar
    g = payoff.smart_guidance(svc, "m", "a black velvet blazer")
    assert g["starts"][0]["exact"] is False
    assert g["notes"] == [
        (
            "No exact match for black blazer in the lookbook, so the vector search found the "
            "closest garments: black double-breasted blazer."
        )
    ]


def test_what_is_looked_for_filters_the_garments_worn_with():
    rows = [
        {"look": "l1", "garment": "a", "garment_name": "white lace-up sneaker", "category": "shoe"},
        {"look": "l1", "garment": "b", "garment_name": "black pump", "category": "shoe"},
        {"look": "l2", "garment": "c", "garment_name": "tan tote bag", "category": "bag"},
    ]
    assert [r["garment"] for r in payoff._target_rows(rows, "sneakers")] == ["a"]
    assert payoff._target_rows(rows, "loafers") == []
    # by type: no shoe is *named* shoe ("slide sandal", "mule flat"), but every one is of type shoe
    shoes = [
        {"look": "l1", "garment": "s", "garment_name": "cream slide sandal", "category": "shoe"},
        {
            "look": "l2",
            "garment": "m",
            "garment_name": "black pointed mule flat",
            "category": "shoe",
        },
        {"look": "l2", "garment": "t", "garment_name": "tan suede clutch", "category": "bag"},
    ]
    assert [r["garment"] for r in payoff._target_rows(shoes, "shoes")] == ["s", "m"]


def test_names_lose_their_side_and_nouns_get_a_proper_plural():
    assert payoff._clean("white sneaker (left)") == "white sneaker"
    assert payoff._clean("hoop earring, right") == "hoop earring"
    assert payoff._clean("gold earring (left side of image)") == "gold earring"
    assert payoff._clean("cream slide sandal (right foot)") == "cream slide sandal"
    assert payoff._plural("white sneaker") == "white sneakers"
    assert payoff._plural("pleated midi dress") == "pleated midi dresses"
    assert payoff._plural("gold watch") == "gold watches"
    assert payoff._without_name(
        "Tan leather clutch. Structured tan leather.", "Tan leather clutch"
    ) == ("Structured tan leather.")


def test_anchors_show_the_query_that_ran():
    from ontology_rag.graph import cypher

    svc = StubService()
    svc.store = BlazerStore()
    svc.embedder.embed_text = lambda text, purpose: [0.01] * 1024  # the real model's size
    a = payoff.find_anchors(svc, "What goes with a black blazer?")
    q = a["query"]
    assert a["vector"]["dimension"] == 1024
    assert q.startswith("CALL neptune.algo.vectors.topK.byEmbedding(")
    assert f"topK: {payoff.ANCHOR_CANDIDATES}" in q
    assert '{equals: {property: "~label", value: "Item"}}' in q
    assert f"… {a['vector']['dimension'] - 4:,} more]" in q  # the vector, shortened
    # the shown statement is the store's own template, only the vector differs
    full = cypher.TOPK_BY_EMBEDDING.format(
        embedding="V", k=payoff.ANCHOR_CANDIDATES, vertex_filter=cypher.vertex_filter(["Item"])
    ).strip()
    assert q.split("embedding: ")[0] == full.split("embedding: ")[0]
    assert q.split("more],")[1] == full.split("V,")[1]


def test_the_way_in_query_is_shown_before_it_runs():
    from ontology_rag import api

    svc = StubService()
    svc.settings = type("S", (), {"embedding_dimension": 1024})()
    status, t = api.retriever_templates(svc, {}, {})
    assert status == 200
    assert "embedding: <the question's vector: 1,024 numbers>" in t["anchor_query"]
    assert t["anchor_query"].startswith("CALL neptune.algo.vectors.topK.byEmbedding(")
    assert t["anchor"] == {
        "candidates": payoff.ANCHOR_CANDIDATES,
        "shown": payoff.ANCHOR_SHOWN,
        "band": payoff.ANCHOR_BAND,
    }


def test_words_drop_plurals_and_shared_name_keeps_common_words():
    assert payoff._words("White Sneakers, wide-leg trousers, dress") == [
        "white",
        "sneaker",
        "wide-leg",
        "trouser",
        "dress",
    ]
    assert (
        payoff._shared_name(
            ["cream wide-leg trousers", "navy wide-leg trousers (left)", "beige wide-leg trousers"]
        )
        == "wide-leg trouser"
    )


def test_catalog_search_dedupes_names_and_uses_the_catalog_index():
    svc = StubService()
    hits = payoff.catalog_search(svc, ["a", "b"])
    names = [h["name"] for h in hits]
    assert names.count("Gold metal hoop earrings") == 1
    assert set(svc.s3vectors.calls) == {"catalog"}


def test_head_noun_names_the_kind_a_search_asks_for():
    assert payoff.head_noun("silver rings on hand") == "ring"
    assert payoff.head_noun("tan suede cropped trucker-style jacket with snap buttons") == "jacket"
    assert payoff.head_noun("light wash wide-leg cropped jeans") == "jean"
    assert payoff.head_noun("white sneaker (left)") == "sneaker"
    assert payoff.head_noun("midi slip skirt in neutral tone") == "skirt"


class KindVectors(StubVectors):
    """The nearest item to a ring search is a necklace; the nearest to a jeans search, culottes."""

    def query_vectors(self, vectorBucketName, indexName, queryVector, topK, **_):
        self.calls.append(indexName)

        def v(key, name, kind, d):
            return {
                "key": key,
                "distance": d,
                "metadata": {"name": name, "type": kind, "text": name},
            }

        return {
            "vectors": [
                v("n1", "Silver chain necklace", "chain necklace", 0.77),
                v("c1", "Cream wide-leg culottes", "wide-leg culottes", 0.80),
                v("j1", "Light blue denim jeans", "jeans", 0.81),
                v("t1", "Navy wide-leg trousers", "wide-leg trousers", 0.82),
            ]
        }


def test_catalog_search_returns_only_items_of_the_kind_searched_for():
    svc = StubService()
    svc.s3vectors = KindVectors()
    by_search = {
        h["search"]: h["name"]
        for h in payoff.catalog_search(
            svc, ["light wash jeans", "silver rings on hand", "black pants"], k=1
        )
    }
    assert by_search["light wash jeans"] == "Light blue denim jeans"  # not the nearer culottes
    assert (
        "silver rings on hand" not in by_search
    )  # no ring in the catalog: nothing, not a necklace
    assert by_search["black pants"] == "Cream wide-leg culottes"  # pants and culottes are one kind


def test_catalog_search_without_the_index_is_not_ready():
    with pytest.raises(NotReady):
        payoff.catalog_search(StubService(missing_index=True), ["a"])


def _no_vector_bucket() -> StubService:
    svc = StubService()
    svc.s3vectors, svc.settings, svc.auth = None, Settings(vector_bucket=""), None
    return svc


@pytest.mark.parametrize(
    "call",
    [
        lambda svc: payoff.catalog_info(svc),
        lambda svc: payoff.catalog_browse(svc),
        lambda svc: payoff.catalog_item(svc, "p1"),
        lambda svc: payoff.catalog_query(svc, "white sneakers", 3),
        lambda svc: payoff.catalog_search(svc, ["white sneakers"]),
        lambda svc: payoff.index_catalog(svc, [{"product_id": "p1"}]),
        lambda svc: payoff.put_catalog_vectors(svc, "catalog.json"),
    ],
    ids=["info", "browse", "item", "query", "search", "index", "put"],
)
def test_every_catalog_call_without_a_vector_bucket_says_the_stack_creates_it(call):
    # svc.s3vectors is None here: a call that named one of its methods first would raise
    # AttributeError (a 500), not the 409
    with pytest.raises(NotReady, match="the catalog index is not set up: the stack creates it"):
        call(_no_vector_bucket())


def test_the_catalog_route_without_a_vector_bucket_answers_409():
    status, body = dispatch(_no_vector_bucket(), "GET", "/api/catalog", {}, {})
    assert status == 409
    assert body["error"] == "the catalog index is not set up: the stack creates it"


def test_a_missing_catalog_index_is_filled_by_the_graph_loader():
    with pytest.raises(NotReady, match="'catalog' does not exist yet: the GraphLoader fills it"):
        payoff.catalog_search(StubService(missing_index=True), ["a"])


def test_run_uses_the_smart_retriever_unless_a_traversal_is_given():
    svc = StubService()
    svc.bedrock = SmartBedrock({"1": "exact", "2": "exact"})
    out = payoff.run(svc, "What goes with white sneakers?")
    graph = out["columns"]["graph"]
    assert graph["smart"] is True and graph["mode"] == "graph"
    assert graph["plan"]["start"] == ["black blazer"]  # what the stub's model read
    assert [g["id"] for g in graph["guidance"]["anchor"]["garments"]] == ["g1", "g2"]
    # with the participant's own traversal: the simple retriever, with that traversal
    out = payoff.run(svc, "What goes with white sneakers?", cypher=payoff.TRAVERSAL)
    assert "smart" not in out["columns"]["graph"]


def test_run_returns_three_columns_with_their_receipts():
    svc = StubService()
    out = payoff.run(svc, "What goes with white sneakers?", cypher=payoff.TRAVERSAL)
    llm, rag, graph = (out["columns"][k] for k in ("llm", "rag", "graph"))
    assert llm["receipts"]["kind"] == "none" and llm["evidence"] == []
    assert rag["receipts"]["kind"] == "catalog" and rag["plan"]["searches"] == [
        "dark jeans",
        "white tee",
    ]
    assert graph["receipts"] == {
        "kind": "looks",
        "count": 3,
        "label": "3 AnyCompany Fashion House looks, with the walk that found them",
    }
    # GraphRAG: the patterns first (the thread), then each featured look followed by its items
    kinds = [e["kind"] for e in graph["evidence"]]
    assert kinds[0] == "pattern" and kinds.index("look") == kinds.count("pattern")
    assert kinds[kinds.index("look") + 1] == "item"
    assert graph["evidence"][0]["tree_ids"][0] == "anchor"
    assert [f["letter"] for f in graph["featured"]] == ["A", "B", "C"]
    # the answer is asked for three ways to wear it, and never an outside source
    assert "Three ways to wear it" in graph["inspect"]["system"]
    assert "Never cite or mention a source" in graph["inspect"]["system"]
    assert graph["cited"] == [1, 2]
    # RAG and GraphRAG answer with the same prompt; only the evidence differs
    answer_systems = {
        r["system"][0]["text"]
        for r in svc.bedrock.requests
        if "numbered evidence" in r["system"][0]["text"]
    }
    assert len(answer_systems) == 1
    assert rag["inspect"]["system"] == graph["inspect"]["system"]


def test_featured_looks_are_the_most_typical_one_per_occasion_first():
    g = payoff.guidance(StubService(), "q")
    # kinds worn with the anchors: pants in 2 looks, earring in 2, jacket in 1
    assert g["kind_counts"] == {"pants": 2, "earring": 2, "jacket": 1}
    # lk1 (pants + earring = 4) is the most typical Professional look, lk3 the only Dress one,
    # then lk2 (pants + jacket = 3)
    assert [lk["id"] for lk in payoff.featured_looks(g)] == ["lk1", "lk3", "lk2"]
    lk1 = next(lk for lk in g["looks"] if lk["id"] == "lk1")
    # one piece per kind, the left and right earrings are one garment
    assert payoff.look_pieces(lk1, g["kind_counts"]) == [
        {"name": "cream wide-leg trousers", "category": "pants"},
        {"name": "gold hoop earring", "category": "earring"},
    ]


def test_tree_links_anchor_looks_categories_and_items():
    graph = payoff.graphrag(StubService(), "m", "q")
    t = graph["tree"]
    kinds = [n["kind"] for n in t["nodes"]]
    assert kinds.count("anchor") == 1 and kinds.count("look") == 3 and kinds.count("category") == 3
    ids = {n["id"] for n in t["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in t["edges"])
    pants = next(c for c in graph["guidance"]["categories"] if c["name"] == "pants")
    assert {e["source"] for e in t["edges"] if e["target"] == pants["id"]} == set(pants["looks"])
    # the featured looks carry their letter, and every item hangs off a kind or a look
    assert next(n for n in t["nodes"] if n["id"] == "lk1")["label"] == "Look A · Professional"
    items = [n["id"] for n in t["nodes"] if n["kind"] == "item"]
    assert items and all(any(e["target"] == i for e in t["edges"]) for i in items)


def test_route_requires_a_question(loaded_service):
    assert dispatch(loaded_service, "POST", "/api/payoff", {}, {})[0] == 400


# ---------------------------------------------------------------------- Style recommendation
PHOTO = (b"\xff\xd8 a jpeg", "jpeg")


class PhotoEmbedder(StubEmbedder):
    def __init__(self):
        self.images = []

    def embed_image(self, data, fmt, purpose):
        self.images.append((data, fmt, purpose))
        return [0.3, 0.4]


class FindBedrock(SmartBedrock):
    """The "read the question" step says what is looked for; no grading is ever asked for."""

    def __init__(self, find=""):
        super().__init__({})
        self.find = find

    def converse(self, **request):
        system = request["system"][0]["text"]
        assert "You grade garments" not in system
        if "say how to look it up" in system:
            self.requests.append(request)
            text = json.dumps({"start": ["this"], "find": self.find, "must": []})
            return {"output": {"message": {"content": [{"text": text}]}}, "usage": {}}
        return super().converse(**request)


def photo_service(find=""):
    svc = StubService()
    svc.embedder = PhotoEmbedder()
    svc.bedrock = FindBedrock(find)
    return svc


def test_a_photo_is_the_way_in_with_the_same_search_and_traversal():
    svc = photo_service()
    out = payoff.run(svc, "What goes with this?", photo=PHOTO)
    assert out["input"] == "photo"
    # the photo itself was embedded, as a query, with the same model
    assert svc.embedder.images == [(PHOTO[0], "jpeg", payoff.QUERY_TEXT)]
    graph = out["columns"]["graph"]
    # the same band as a question: the three sneakers and the tote within 0.10, not the boot
    assert [g["id"] for g in graph["guidance"]["anchor"]["garments"]] == ["g1", "g2", "g3", "b9"]
    # the traversal, then the anchors' sides (their pairs are left out of the counts)
    assert [q for q, _ in svc.store.queries[-2:]] == [payoff.TRAVERSAL, payoff.ANCHOR_SIDES]
    way = graph["photo_way_in"]
    assert way["garments"] == 4 and way["looks"] == 3 and way["find"] == ""
    assert way["query"].startswith("CALL neptune.algo.vectors.topK.byEmbedding(")
    assert graph["target"] is None and "smart" not in graph
    assert graph["tree"]["nodes"][0]["sub"].endswith("on your photo")


def test_all_three_columns_see_the_same_photo():
    svc = photo_service()
    out = payoff.run(svc, "What goes with this?", photo=PHOTO)
    sent = [
        r for r in svc.bedrock.requests if "say how to look it up" not in r["system"][0]["text"]
    ]
    # LLM only, RAG's planner, RAG's answer, GraphRAG's answer
    assert len(sent) == 4
    for r in sent:
        content = r["messages"][0]["content"]
        assert content[0] == {"image": {"format": "jpeg", "source": {"bytes": PHOTO[0]}}}
        assert r["system"][0]["text"].endswith(payoff.PHOTO_NOTE)
    for k in ("llm", "rag", "graph"):
        inspect = out["columns"][k]["inspect"]
        assert inspect["user"].startswith(payoff.PHOTO_SHOWN)
        assert inspect["system"].endswith(payoff.PHOTO_NOTE)
    # RAG and GraphRAG still answer with the same prompt
    assert (
        out["columns"]["rag"]["inspect"]["system"] == out["columns"]["graph"]["inspect"]["system"]
    )


def test_a_photo_with_a_question_for_one_kind_keeps_only_that_kind():
    svc = photo_service(find="trousers")
    graph = payoff.run(svc, "Which trousers go with this?", photo=PHOTO)["columns"]["graph"]
    assert graph["photo_way_in"]["find"] == "trousers"
    assert [c["name"] for c in graph["guidance"]["categories"]] == ["pants"]
    assert graph["target"]["looks_before"] == 3 and graph["target"]["looks_after"] == 2
    assert graph["target_rule"] == payoff.TARGET_RULE


def test_without_a_photo_no_image_is_sent():
    svc = StubService()
    payoff.run(svc, "What goes with white sneakers?", cypher=payoff.TRAVERSAL)
    for r in svc.bedrock.requests:
        assert all("image" not in c for c in r["messages"][0]["content"])
        assert payoff.PHOTO_NOTE not in r["system"][0]["text"]


def test_the_route_takes_a_photo_and_checks_it(loaded_service):
    bad = {"question": "What goes with this?", "image_base64": "not base64!"}
    assert dispatch(loaded_service, "POST", "/api/payoff", {}, bad)[0] == 400


# ---------------------------------------------------------------------- the stages


def test_the_traversal_returns_the_looks_and_the_garments_worn_with_the_anchors():
    """Tab 4 shows the traversal read-only (no quiz): what it returns is what stage 5 counts."""
    svc = StubService()
    t = payoff.traverse(svc, ["g1", "g2"], payoff.TRAVERSAL)
    assert t["rows"] == 6 and len(t["preview"]) == 6
    assert {"look", "garment", "garment_name", "category", "attributes"} <= set(t["columns"])
    assert t["categories"] and "checks" not in t
    assert svc.store.queries[0][1] == {"anchors": ["g1", "g2"]}


def test_a_write_or_a_traversal_without_the_anchors_is_refused():
    with pytest.raises(PermissionError):
        payoff.traverse(StubService(), ["g1"], "MATCH (n) WHERE id(n) IN $anchors DETACH DELETE n")
    with pytest.raises(ValueError):
        payoff.traverse(StubService(), ["g1"], "MATCH (l:Look) RETURN id(l) AS look")


class LooksOnlyStore(StubStore):
    """What a traversal sent to the API without its second hop returns: the looks, no garments."""

    def query(self, cypher, params):
        self.queries.append((cypher, params))
        return [
            {"look": "lk1", "look_name": "lk1.png", "occasion": "Professional"},
            {"look": "lk2", "look_name": "lk2.png", "occasion": "Dress"},
        ]


def test_graphrag_needs_garments_from_the_traversal():
    svc = StubService()
    svc.store = LooksOnlyStore()
    looks_only = "MATCH (l:Look)-[:CONTAINS]->(s:Item) WHERE id(s) IN $anchors RETURN id(l) AS look"
    with pytest.raises(ValueError, match="no garments"):
        payoff.graphrag(svc, "m", "q", looks_only)


def test_rag_with_edited_searches_skips_the_planner():
    svc = StubService()
    out = payoff.rag(svc, "m", "q", ["  black loafers  ", ""])
    assert out["plan"] == {"searches": ["black loafers"], "why": "your searches from stage 2"}
    systems = [r["system"][0]["text"] for r in svc.bedrock.requests]
    assert not any("Plan the product catalog searches" in s for s in systems)


class TwoObjectsBedrock(StubBedrock):
    """A planner that answers with two JSON objects, one per line. On the demo stack this showed
    as "Extra data: line 2 column 1 (char 61)" in tab 5's RAG column (14 Nov 2026)."""

    def converse(self, **request):
        if "Plan the product catalog searches" not in request["system"][0]["text"]:
            return super().converse(**request)
        self.requests.append(request)
        text = '{"searches": ["camel coat"], "why": "w"}\n{"searches": ["tan boots"], "why": "x"}'
        return {"output": {"message": {"content": [{"text": text}]}}, "usage": {}}


def test_the_planner_reads_the_first_of_two_json_objects():
    svc = StubService()
    svc.bedrock = TwoObjectsBedrock()
    out = payoff.plan(svc, "m", "What goes with a camel coat?")
    assert out["searches"] == ["camel coat"] and out["why"] == "w"


@pytest.mark.parametrize(
    "reply",
    [
        'Here is the plan:\n{"searches": ["camel coat"], "why": "w"}\nI hope it helps.',
        '```json\n{"searches": ["camel coat"], "why": "w"}\n```',
        '{"searches": ["camel coat"], "why": "w"} {"searches": ["tan boots"]}',
    ],
)
def test_the_first_json_object_is_read_whatever_is_around_it(reply):
    assert payoff._json_of(reply) == {"searches": ["camel coat"], "why": "w"}


@pytest.mark.parametrize(
    ("reply", "says"),
    [
        ("No JSON in this reply.", "holds no JSON"),
        # cut off by maxTokens: the first piece is complete, but it is not the reply's object
        ('{"pieces": [{"piece": "blazer", "fits": true}, {"piece": "bo', "no complete JSON object"),
    ],
)
def test_a_reply_without_a_complete_object_says_so(reply, says):
    with pytest.raises(ValueError, match=says):
        payoff._json_of(reply)


def test_every_prompt_that_wants_json_asks_for_one_object():
    for system in (
        payoff.PLANNER_SYSTEM,
        payoff.UNDERSTAND_SYSTEM,
        payoff.CHOOSE_SYSTEM,
        lenses.CHECK_SYSTEM,
    ):
        assert payoff.ONE_JSON in system


def test_catalog_item_and_query_show_the_vector():
    svc = StubService()
    item = payoff.catalog_item(svc, "item_1")
    assert item["name"] == "White leather sneakers"
    assert item["vector"]["dimension"] == 16 and item["vector"]["norm"] == 1.0
    q = payoff.catalog_query(svc, "white sneakers", 3)
    assert q["vector"]["dimension"] == 2 and len(q["hits"]) == 3  # raw: no de-duplication
    assert set(svc.s3vectors.calls) == {"catalog"}


def test_the_model_on_its_own_has_no_source_and_the_same_prompt_as_tab_5():
    svc = StubService()
    status, out = api.retriever_llm(svc, {}, {"question": "What goes with white sneakers?"})
    assert status == 200 and out["mode"] == "llm" and out["answer"]
    assert out["evidence"] == [] and out["receipts"]["kind"] == "none"
    assert out["inspect"]["system"] == payoff.LLM_ONLY_SYSTEM
    assert out["inspect"]["user"] == "What goes with white sneakers?"
    # the same call as the first column of "Same question, three answers"
    column = payoff.run(svc, "What goes with white sneakers?", cypher=payoff.TRAVERSAL)
    assert column["columns"]["llm"]["inspect"] == out["inspect"]


def test_stage_routes_validate_their_input(loaded_service):
    def post(path, body):
        return dispatch(loaded_service, "POST", path, {}, body)[0]

    assert post("/api/retriever/llm", {}) == 400
    assert post("/api/catalog/search", {}) == 400
    assert post("/api/retriever/anchors", {}) == 400
    assert post("/api/retriever/traverse", {"anchors": []}) == 400
    assert post("/api/retriever/traverse", {"anchors": ["bad id!"]}) == 400
    assert dispatch(loaded_service, "GET", "/api/catalog/item", {"key": "../x"}, {})[0] == 400
    status, body = dispatch(loaded_service, "GET", "/api/retriever/templates", {}, {})
    assert (
        status == 200 and body["traversal"] == payoff.TRAVERSAL and "$anchors" in body["traversal"]
    )
    assert not {"starter", "hints", "solution"} & set(body)  # tab 4 shows the traversal, no quiz


def test_the_other_shoe_of_an_anchors_pair_is_not_counted_as_worn_with_it():
    """The anchor is "white sneaker (left)"; the shoe marked "(right)" in its look is the same pair,
    not a piece worn with it. A shoe in a look without a sided anchor, an earring with a side and a
    second bag still count, and every count is a number of looks."""
    row = lambda look, gid, name, cat: {
        "look": look,
        "look_name": look,
        "occasion": "Casual",
        "garment": gid,
        "garment_name": name,
        "category": cat,
        "attributes": [],
    }
    rows = [
        row("l1", "r1", "white and gray sneaker (right)", "shoe"),  # the anchor's mate
        row("l1", "b1", "tan tote bag", "bag"),
        row("l1", "e1", "gold hoop earring (left)", "earring, ear stud, hoop"),  # one earring: worn
        row("l2", "r2", "white sneaker (right)", "shoe"),  # its anchor names no side: worn with it
        row("l3", "b3", "tan tote bag", "bag"),
        row("l3", "b4", "straw bag", "bag"),  # two bags in one look: still one look
    ]
    sides = {"l1": {("shoe", "left")}}
    counts = {c["name"]: c["count"] for c in payoff.aggregate(rows, sides)["categories"]}
    assert counts == {"bag": 2, "earring": 1, "shoe": 1}
    # without the anchors' sides nothing is left out
    plain = {c["name"]: c["count"] for c in payoff.aggregate(rows)["categories"]}
    assert plain == {"bag": 2, "earring": 1, "shoe": 2}


class SidedAnchorStore(StubStore):
    """The anchors' own rows name their side; the traversal returns the other shoe of the pair."""

    def query(self, cypher, params):
        self.queries.append((cypher, params))
        if cypher == payoff.ANCHOR_SIDES:
            return [
                {"look": "lk1", "anchor_name": "white sneaker (left)", "anchor_category": "shoe"}
            ]
        return [
            {
                "look": "lk1",
                "look_name": "lk1.png",
                "occasion": "Casual",
                "garment": "r1",
                "garment_name": "white sneaker (right)",
                "category": "shoe",
                "attributes": [],
            },
            {
                "look": "lk1",
                "look_name": "lk1.png",
                "occasion": "Casual",
                "garment": "t1",
                "garment_name": "tan tote bag",
                "category": "bag",
                "attributes": [],
            },
        ]


def test_the_traversal_reads_the_anchors_sides_and_leaves_their_pairs_out():
    svc = StubService()
    svc.store = SidedAnchorStore()
    t = payoff.traverse(svc, ["g1"], payoff.TRAVERSAL)
    assert [c["name"] for c in t["categories"]] == ["bag"]
    assert any(q == payoff.ANCHOR_SIDES and p == {"anchors": ["g1"]} for q, p in svc.store.queries)
