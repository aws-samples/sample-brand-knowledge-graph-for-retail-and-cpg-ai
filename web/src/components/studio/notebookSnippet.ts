// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { CodeSnippet } from '../../api';

/** The five steps as a script, for the domain chosen in tab 0 and its first example photo. */
export const notebookSnippet = (ontologyId: string, example = '<example>.jpg'): CodeSnippet => ({
  id: 'notebook',
  title: 'The five steps from a notebook (same functions)',
  language: 'python',
  file: 'backend/src/ontology_rag/classify.py',
  steps: [3],
  nodes: ['lambda', 'browser'],
  highlights: [
    { kind: 'ontology', start: 6, end: 6, note: '1 · the ontology from S3 (ONTOLOGIES_BUCKET) or the local folder' },
    { kind: 'image', start: 7, end: 7, note: '2 · the photo, as bytes' },
    { kind: 'prompt', start: 8, end: 8, note: '3 · system prompt + user turn' },
    { kind: 'model', start: 10, end: 11, note: 'every model the deployment offers (VISION_MODEL_IDS)' },
    { kind: 'cache', start: 12, end: 13, note: '4 · the Converse call, with a cache checkpoint where the model supports one' },
    { kind: 'output', start: 14, end: 14, note: '5 · checked against the ontology' },
    { kind: 'cache', start: 16, end: 17, note: 'the cache counters of this call' },
  ],
  code: `from ontology_rag import classify
from ontology_rag.service import Service

svc = Service()  # settings from the environment: AWS_REGION, ONTOLOGIES_BUCKET, VISION_MODEL_IDS

${`view = classify.load_ontology(svc, "${ontologyId}")`.padEnd(77)}# 1. the ontology
${`image = classify.load_image(svc, "${ontologyId}", "${example}")`.padEnd(77)}# 2. the photo
system_prompt, user_turn = classify.build_prompt(view, image)                # 3. the prompt

for model_id in svc.settings.vision_model_ids:
    model = svc.vision_model(model_id)
    request, response, ms = classify.call_model(                             # 4. Bedrock
        svc.bedrock, model, system_prompt, user_turn, prompt_caching=True)
    result = classify.check_answer(view, model, system_prompt, request, response, ms)  # 5.
    m = result["metrics"]
    print(model.name, m["latency_ms"], "ms · input", m["input_tokens"],
          "· cache read", m["cache_read_tokens"], "· cache write", m["cache_write_tokens"])
    for e in result["entities"]:
        print("  ", e["class"], e["bbox"], e["attributes"], [p["class"] for p in e["parts"]])
    print("   not in the ontology:", result["issues"])`,
});
