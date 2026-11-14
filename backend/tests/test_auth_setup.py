# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""The ``Custom::AuthSetup`` handler: the stack's one Cognito user gets the password Secrets
Manager generated, as a permanent one, and CloudFormation hears about a failure.

Who may call the API is not the sample's code: the function URL accepts only IAM-signed requests
from the identity pool's signed-in role (infra/lib/auth.ts, infra/test/stack.test.ts).
"""

from __future__ import annotations

import logging
import secrets

from ontology_rag import lambda_handler

POOL = "us-east-1_TestPool1"


PASSWORD = secrets.token_urlsafe(18) + "-1!"


class FakeSecrets:
    def get_secret_value(self, SecretId):
        return {"ARN": SecretId, "SecretString": PASSWORD}


class FakeCognito:
    def __init__(self, error: Exception | None = None):
        self.calls: list[dict] = []
        self.error = error

    def admin_set_user_password(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return {}


def _auth_setup(monkeypatch, cognito: FakeCognito) -> list[tuple]:
    import boto3

    clients = {"secretsmanager": FakeSecrets(), "cognito-idp": cognito}
    monkeypatch.setattr(boto3, "client", lambda name, **kw: clients[name])
    responses: list[tuple] = []
    monkeypatch.setattr(
        lambda_handler,
        "_cfn_respond",
        lambda event, context, status, physical_id, data, reason="": responses.append(
            (status, physical_id, data, reason)
        ),
    )
    return responses


EVENT = {
    "RequestType": "Create",
    "ResponseURL": "https://cloudformation-custom-resource-response.example/x",
    "StackId": "s",
    "RequestId": "r",
    "LogicalResourceId": "AuthSetup",
    "ResourceProperties": {
        "UserPoolId": POOL,
        "Username": "participant",
        "SecretArn": "arn:aws:secretsmanager:us-east-1:111111111111:secret:multimodal-ai-knowledge-graph/x/sign-in-AbCdEf",  # pragma: allowlist secret
        "Version": "1",
    },
}


def test_auth_setup_sets_the_generated_password_permanently(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    cognito = FakeCognito()
    responses = _auth_setup(monkeypatch, cognito)
    lambda_handler.auth_setup_handler(EVENT, None)
    assert cognito.calls == [
        {"UserPoolId": POOL, "Username": "participant", "Password": PASSWORD, "Permanent": True}
    ]
    assert responses == [("SUCCESS", f"auth-setup-{POOL}", {}, "")]
    assert PASSWORD not in caplog.text
    # Delete has nothing to undo; Update sets it again
    lambda_handler.auth_setup_handler(
        {**EVENT, "RequestType": "Delete", "PhysicalResourceId": f"auth-setup-{POOL}"}, None
    )
    assert len(cognito.calls) == 1 and responses[-1][:2] == ("SUCCESS", f"auth-setup-{POOL}")
    lambda_handler.auth_setup_handler({**EVENT, "RequestType": "Update"}, None)
    assert len(cognito.calls) == 2 and responses[-1][0] == "SUCCESS"


def test_auth_setup_reports_a_failure_to_cloudformation(monkeypatch):
    responses = _auth_setup(monkeypatch, FakeCognito(RuntimeError("InvalidPasswordException")))
    lambda_handler.auth_setup_handler(EVENT, None)
    assert responses[-1][0] == "FAILED" and "InvalidPasswordException" in responses[-1][3]
