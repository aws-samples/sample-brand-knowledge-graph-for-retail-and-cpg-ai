# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Who may call the API is IAM's decision, not the sample's code: the function URL accepts only
requests signed with the identity pool's signed-in role (infra/lib/auth.ts). These tests pin that
the API carries no token check of its own and no library for one."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from ontology_rag.api import ROUTES, dispatch

BACKEND = Path(__file__).resolve().parents[1]


def test_the_router_serves_a_request_without_any_token(loaded_service):
    status, body = dispatch(loaded_service, "GET", "/api/health", {}, {})
    assert status == 200 and "error" not in body


def test_there_is_no_sign_in_config_route_and_no_auth_module():
    assert ("GET", "/api/auth/config") not in ROUTES  # the browser reads /config.json instead
    assert importlib.util.find_spec("ontology_rag.auth") is None


def test_the_api_zip_carries_no_jwt_library():
    pinned = (BACKEND / "lambda-requirements.txt").read_text().lower()
    for name in ("pyjwt", "cryptography", "cffi", "pycparser"):
        assert f"\n{name}==" not in pinned, name
    assert "pyjwt" not in (BACKEND / "pyproject.toml").read_text().lower()
