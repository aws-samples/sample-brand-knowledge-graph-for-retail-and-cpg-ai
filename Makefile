# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Convenience targets. Each directory also works on its own (see its README).
PY := backend/.venv/bin

.PHONY: setup test build synth sample-data ontology network-cleanup clean

setup:            ## create the Python venv and install everything (npm ci: the lock files as they are)
	cd backend && uv venv .venv && uv pip install -e '.[dev,agent]'
	cd infra && npm ci --no-audit --no-fund
	cd web && npm ci --no-audit --no-fund

test:             ## pytest (offline) + CDK assertions + web type-check/build
	cd backend && $(CURDIR)/$(PY)/pytest -q && $(CURDIR)/$(PY)/ruff check src tests
	cd infra && npx jest
	cd web && npm test && npm run build

build:            ## web/dist, the site the stack publishes (cdk deploy bundles the Lambda and agent zips itself)
	cd web && npm run build

synth:            ## the CloudFormation template (needs a bootstrapped account to deploy)
	cd infra && npx cdk synth --quiet

sample-data:      ## regenerate ontologies/fashion/datasets/anycompany-apparel from backend/src/ontology_rag/synth.py
	$(PY)/ontology-rag synth

ontology:         ## rebuild ontologies/fashion/fashion.ttl from the Fashionpedia catalog (downloads it)
	$(PY)/python ontologies/fashion/build_fashion_ontology.py

network-cleanup:  ## after cdk destroy: delete the VPC the stack keeps, once AgentCore has released its interfaces (up to 8 hours); ARGS=--delete to delete
	cd backend && .venv/bin/ontology-rag network-cleanup $(ARGS)

clean:
	rm -rf infra/cdk.out infra/build web/dist backend/.pytest_cache backend/.ruff_cache
