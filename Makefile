# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Convenience targets. Each directory also works on its own (see its README).
PY := backend/.venv/bin

.PHONY: setup test scan build figures synth sample-data ontology network-cleanup clean

setup:            ## create the Python venv and install everything (npm ci: the lock files as they are)
	cd backend && uv venv .venv && uv pip install -e '.[dev,agent]'
	cd infra && npm ci --no-audit --no-fund
	cd web && npm ci --no-audit --no-fund

test:             ## pytest (offline) + CDK assertions + web type-check/build
	cd backend && $(CURDIR)/$(PY)/pytest -q && $(CURDIR)/$(PY)/ruff check src tests
	cd infra && npx jest
	cd web && npm test && npm run build

scan:             ## security scans: secrets against the audited baseline, Python SAST, advisories of the three deployed closures
	# exit 3 = the hook only refreshed line numbers in the baseline (commit the file); 1 = a new secret
	uvx --from detect-secrets==1.5.0 detect-secrets-hook --baseline .secrets.baseline $$(git ls-files -co --exclude-standard); \
	  rc=$$?; if [ $$rc -ne 0 ] && [ $$rc -ne 3 ]; then exit $$rc; fi
	uvx --from bandit==1.9.4 bandit -r backend/src backend/agentcore backend/agentcore-lake -ll -q
	uvx --from pip-audit==2.10.1 pip-audit -r backend/lambda-requirements.txt --require-hashes --disable-pip --progress-spinner off
	uvx --from pip-audit==2.10.1 pip-audit -r backend/agentcore/requirements.txt --require-hashes --disable-pip --progress-spinner off
	uvx --from pip-audit==2.10.1 pip-audit -r backend/agentcore-lake/requirements.txt --require-hashes --disable-pip --progress-spinner off

build:            ## web/dist, the site the stack publishes (cdk deploy bundles the Lambda and agent zips itself)
	cd web && npm run build

figures:          ## render the README figures into assets/ from the app's diagram components (Playwright, Chromium)
	cd web && npx tsc -p figures && node figures/render.mjs

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
