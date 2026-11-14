# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Tab 6, "What else the graph knows" (lenses.py), over a stub graph, catalog and model. The
in-memory graph has no openCypher, so the store returns scripted rows; what is tested is the
piece search, the catalog steps, the guard on edited queries, the verdict rule and the routes."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from types import SimpleNamespace

import pytest

from ontology_rag import lenses
from ontology_rag.api import dispatch


@dataclass
class N:
    id: str
    props: dict = field(default_factory=dict)


class StubStore:
    """topk: two garments near any piece (g1 closer to sneakers), and an article's garment in no
    look closer still; looks for a photo; query: rows by which statement it is."""

    def __init__(self, rows=None):
        self.rows, self.queries = rows or {}, []

    def topk(self, embedding, k, labels):
        if labels == ["Look"]:
            return [
                (N("lk1", {"image_key": "whimsikora/looks/a.jpg"}), 0.6),
                (N("stray", {"run": "r1"}), 0.65),  # a tab 2 upload
                (N("lk2"), 0.7),
            ]
        # embedding[0] tells which piece asked: sneakers own g1, loafers own g2, both find g3
        if embedding[0] == 1.0:
            return [(N("article"), 1.0), (N("g1"), 1.40), (N("g3"), 1.45), (N("far"), 1.90)]
        return [(N("g2"), 1.30), (N("g3"), 1.32)]

    def neighbor_ids(self, ids, types, direction="out"):
        # every garment is worn in a look but the article's (tab 2 puts it in the graph alone)
        return {i: set() if i == "article" else {"lk1"} for i in ids}

    def query(self, cypher, params=None):
        self.queries.append((cypher, params or {}))
        if "count(i) AS n" in cypher:
            return [{"n": 3}]
        for marker, rows in self.rows.items():
            if marker in cypher:
                return rows
        return []


class StubEmbedder:
    def embed_text(self, text, purpose=""):
        return [1.0 if "sneaker" in text else 0.0, 0.0]

    def embed_image(self, raw, fmt, purpose=""):
        return [0.5, 0.5]


class StubVectors:
    def list_vectors(self, **_):
        meta = [
            {"name": "White leather sneakers", "type": "sneakers"},
            {"name": "Black penny loafers", "type": "penny loafers"},
            {"name": "Navy wide-leg pants", "type": "wide-leg pants"},
        ]
        return {"vectors": [{"key": f"k{i}", "metadata": m} for i, m in enumerate(meta)]}


class StubBedrock:
    def __init__(self, reply):
        self.reply, self.requests = reply, []

    def converse(self, **request):
        self.requests.append(request)
        return {"output": {"message": {"content": [{"text": self.reply}]}}, "usage": {}}


def _svc(rows=None, reply="Fine [1]."):
    return SimpleNamespace(
        store=StubStore(rows),
        embedder=StubEmbedder(),
        s3vectors=StubVectors(),
        bedrock=StubBedrock(reply),
        settings=SimpleNamespace(vector_bucket="vb", catalog_index="catalog"),
    )


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    monkeypatch.setattr(lenses, "PIECES", ["sneakers", "loafers"])
    lenses._pieces_cache.clear()
    lenses._embedded.clear()


def test_a_garment_two_pieces_find_goes_to_the_closest():
    got = {p["piece"]: sorted(p["ids"]) for p in lenses.pieces(_svc())}
    # g3 is 0.05 from the best worn sneaker match and 0.02 from the best loafer: a loafer; the
    # article's garment is closer than g1 but in no look, so it neither counts nor sets the band
    assert got == {"sneakers": ["g1"], "loafers": ["g2", "g3"]}


def test_count_runs_the_default_query_with_the_pieces_and_returns_a_table():
    svc = _svc(
        {
            "looks, count(DISTINCT o) AS occasions": [
                {"piece": "sneakers", "looks": 12, "occasions": 3}
            ]
        }
    )
    out = lenses.count(svc, "heroes")
    assert out["columns"] == ["piece", "looks", "occasions"]
    assert out["rows"] == [["sneakers", 12, 3]]
    assert out["edited"] is False and out["pieces"] == 2
    assert "sneakers is in 12 looks" in out["headline"]
    cypher, params = svc.store.queries[-1]
    assert cypher == lenses.HEROES and {p["piece"] for p in params["pieces"]} == {
        "sneakers",
        "loafers",
    }


def test_an_edited_query_runs_read_only():
    svc = _svc({"RETURN 1 AS x": [{"x": 1}]})
    out = lenses.count(svc, "style-guide", "MATCH (n) RETURN 1 AS x")
    assert out["edited"] is True and out["rows"] == [[1]]
    with pytest.raises(PermissionError):
        lenses.count(svc, "style-guide", "MATCH (n) DETACH DELETE n")
    with pytest.raises(ValueError):
        lenses.count(svc, "nope")


def test_gaps_puts_the_pieces_with_no_product_first():
    rows = [
        {"piece": "loafers", "looks": 9},
        {"piece": "sneakers", "looks": 12},
        {"piece": "hoop earrings", "looks": 20},
    ]
    out = lenses.count(_svc({"RETURN p.piece AS piece, count(DISTINCT l) AS looks": rows}), "gaps")
    # "penny loafers" names loafers; nothing names hoop earrings
    assert out["rows"][0] == ["hoop earrings", 20, 0]
    assert ["loafers", 9, 1] in out["rows"] and ["sneakers", 12, 1] in out["rows"]
    assert out["headline"].startswith("1 piece the stylists use in 5+ looks has")


def test_orphans_finds_the_product_types_no_look_wears():
    rows = [
        {"look": "lk1", "garment": "white sneaker (left)"},
        {"look": "lk2", "garment": "navy wide-leg trousers"},
    ]
    out = lenses.count(_svc({"RETURN id(l) AS look, i.name AS garment": rows}), "orphans")
    # wide-leg pants match wide-leg trousers (pants and trousers count as one)
    assert out["rows"][0] == ["penny loafers", 1, 0]
    assert ["wide-leg pants", 1, 1] in out["rows"] and ["sneakers", 1, 1] in out["rows"]


def test_next_to_needs_a_piece_and_starts_from_its_garments():
    svc = _svc({"$start": [{"worn_with": "loafers", "looks": 4, "of_looks": 6}]})
    out = lenses.count(svc, "next-to", start="white sneakers")
    assert out["start_garments"] == 2 and "Looks with white sneakers: 6" in out["headline"]
    assert sorted(svc.store.queries[-1][1]["start"]) == ["g1", "g3"]
    with pytest.raises(ValueError):
        lenses.count(svc, "next-to")


def test_explain_sends_only_the_numbered_rows():
    svc = _svc()
    out = lenses.explain(svc, "m", "gaps", ["piece", "looks"], [["rings", 10]])
    assert out["text"] == "Fine [1]."
    assert "[1] rings | 10" in out["user"] and "buyer" in out["system"]
    with pytest.raises(ValueError):
        lenses.explain(svc, "m", "gaps", ["piece"], [])


@pytest.mark.parametrize(
    "fits,expected",
    [
        ([True, True, True], "on-brand"),
        ([True, True, True, False], "partly"),
        ([True, True, False, False], "partly"),
        ([True, False, False], "off-brand"),
    ],
)
def test_the_verdict_rule_counts_main_pieces_only(fits, expected):
    pieces = [{"main": True, "fits": f} for f in fits] + [{"main": False, "fits": False}]
    assert lenses.verdict(pieces) == expected


def test_the_check_keeps_the_brands_looks_and_the_helper_cites_only_them():
    walk = [
        {
            "look": "lk1",
            "occasion": "Professional",
            "garment": "white sneaker (left)",
            "kind": "shoe",
        },
        # tab 2 gives an upload an occasion too, so the run is what tells it from the lookbook
        {"look": "stray", "occasion": "Dress", "garment": "red cap", "kind": "hat"},
        {"look": "lk2", "occasion": None, "garment": "black pump", "kind": "shoe"},
    ]
    reply = json.dumps(
        {
            "pieces": [
                {
                    "piece": "cowboy boots",
                    "main": True,
                    "fits": False,
                    "looks": ["A", "Z"],
                    "note": "no boots",
                },
                {"piece": "blazer", "main": True, "fits": True, "looks": ["B"], "note": "ok"},
            ],
            "summary": "s",
        }
    )
    svc = _svc({"WHERE id(l) IN $looks": walk}, reply=reply)
    c = lenses.check_looks(svc, (b"img", "jpeg"))
    assert [x["id"] for x in c["looks"]] == ["lk1", "lk2"]  # the stray (a run's) is left out
    assert [x["occasion"] for x in c["looks"]] == ["Professional", None]  # None: "no occasion"
    assert c["looks"][0]["garments"] == ["white sneaker"]
    assert "Look B (no occasion, distance 0.70)" in lenses.check_evidence(c["looks"])
    p = lenses.check_pieces(svc, "m", (b"img", "jpeg"), c["looks"])
    assert p["verdict"] == "partly" and p["pieces"][0]["looks"] == ["A"]  # Z is not a look shown
    assert "Look A (Professional" in p["user"]


def test_the_check_needs_a_look_of_the_lookbook():
    """Only the tab 2 upload has garments in the walk: no look of the lookbook to compare with."""
    walk = [{"look": "stray", "occasion": "Dress", "garment": "red cap", "kind": "hat"}]
    svc = _svc({"WHERE id(l) IN $looks": walk})
    with pytest.raises(lenses.NotReady, match="no look of the brand's lookbook is in the graph"):
        lenses.check_looks(svc, (b"img", "jpeg"))


def test_routes(loaded_service):
    status, body = dispatch(loaded_service, "GET", "/api/lenses", {}, {})
    assert status == 200 and len(body["lenses"]) == 10
    assert all(any(s["editable"] for s in v["steps"]) for v in body["lenses"].values())
    assert dispatch(loaded_service, "POST", "/api/lenses/explain", {}, {"lens": "gaps"})[0] == 400
    assert (
        dispatch(loaded_service, "POST", "/api/lenses/check/pieces", {}, {"photo_key": "x"})[0]
        == 400
    )
    # the old field: a 400 that names the new ones (ontology_id and example, tests in
    # test_data_sets.py)
    old_key = {"photo_key": "whimsikora/new-work/a.jpg", "looks": [{"letter": "A"}]}
    status, body = dispatch(loaded_service, "POST", "/api/lenses/check/pieces", {}, old_key)
    assert status == 400 and "ontology_id and example" in body["error"]


def test_a_piece_also_finds_the_garments_its_name_says_in_its_own_category():
    names = {
        "g1": ("white sneaker (left)", "shoe"),
        "g9": ("white leather sneakers", "shoe"),  # missed by the vector search, found by name
        "g7": ("tote with sneaker charm", "bag, wallet"),  # names it, but it is a bag: left out
        "r1": ("gold ring", "ring"),
        "t1": ("black tote with gold ring hardware", "bag, wallet"),
    }
    got = {
        p["piece"]: p
        for p in lenses.assign(names, {"sneakers": [("g1", 0.0)], "rings": [("r1", 0.0)]})
    }
    assert got["sneakers"]["ids"] == ["g1", "g9"] and got["sneakers"]["main"] is True
    assert got["rings"]["ids"] == ["r1"] and got["rings"]["main"] is False
    assert got["rings"]["category"] == "ring"


def test_pairings_come_as_staples_and_signatures():
    pieces = [
        {"piece": p, "main": m}
        for p, m in [
            ("blazer", True),
            ("wide-leg trousers", True),
            ("pumps", True),
            ("hoop earrings", False),
            ("clutch", False),
        ]
    ]
    rows = [
        {
            "piece": "hoop earrings",
            "worn_with": "wide-leg trousers",
            "looks_together": 23,
            "lift": 1.1,
        },
        {"piece": "blazer", "worn_with": "wide-leg trousers", "looks_together": 7, "lift": 1.2},
        {"piece": "pumps", "worn_with": "wide-leg trousers", "looks_together": 8, "lift": 1.3},
        {"piece": "clutch", "worn_with": "pumps", "looks_together": 5, "lift": 3.6},
        {
            "piece": "blazer",
            "worn_with": "clutch",
            "looks_together": 3,
            "lift": 9.0,
        },  # too few looks
    ]
    out = lenses.split_pairings(rows, pieces)
    assert [(r["list"], r["piece"], r["worn_with"]) for r in out] == [
        ("staple", "pumps", "wide-leg trousers"),
        ("staple", "blazer", "wide-leg trousers"),
        (
            "signature",
            "clutch",
            "pumps",
        ),  # hoop earrings + trousers: 23 looks, but only 1.1x chance
    ]
    cols = ["list", "piece", "worn_with", "looks_together", "lift"]
    head = lenses.headline("pairings", cols, [[r[c] for c in cols] for r in out])
    assert head.startswith(
        "The staple: pumps with wide-leg trousers, in 8 looks. The signature: clutch with pumps, 3.6×"
    )
