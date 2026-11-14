// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { ClassifyResult, CodeHighlight, CodeSnippet } from '../../api';

export const PROMPT_ID = '__prompt__';

/**
 * The prompt of the latest call as a snippet: the system prompt (the ontology, rendered) with
 * the user turn and the request preview appended, marked up so the reader sees where the
 * ontology, the cache checkpoint, the image and the model id sit in what Bedrock received.
 */
export function promptSnippet(r: ClassifyResult): CodeSnippet {
  const system = r.prompt.system.replace(/\n$/, '');
  const request = JSON.stringify(r.prompt.request, null, 2);
  const sections = [
    `# ===== system prompt (${r.prompt.system.length.toLocaleString()} chars ≈ ${r.metrics.prompt_tokens_estimate.toLocaleString()} tokens), rendered from the ontology, identical for every image =====`,
    system,
    '',
    '# ===== user turn: the image (as bytes) followed by this text =====',
    r.prompt.user,
    '',
    '# ===== request as sent to bedrock-runtime Converse (image bytes and the prompt text elided) =====',
    request,
  ];
  const code = sections.join('\n');
  const lines = code.split('\n');
  const at = (needle: string, from = 0) => lines.findIndex((ln, i) => i >= from && ln.includes(needle)) + 1; // 1-based, 0 = not found
  const sysStart = 2;
  const sysEnd = 1 + system.split('\n').length;
  const h: CodeHighlight[] = [];
  const push = (kind: CodeHighlight['kind'], start: number, end: number, note: string) => {
    if (start > 0 && end >= start) h.push({ kind, start, end, note });
  };
  push('prompt', sysStart, sysStart, 'the instruction: use ONLY the ontology vocabulary, never invent');
  const ent = at('## Entity classes');
  const rel = at('## Relations between entities');
  const attr = at('## Attribute properties');
  const photo = at('## The whole photo');
  const fb = at('## Ontology feedback');
  const out = at('## Output');
  push('ontology', ent, (rel || attr || photo || fb || out || sysEnd + 1) - 1, 'entity classes with synonyms, indented by hierarchy: what the model may locate');
  if (rel) push('ontology', rel, (attr || photo || fb || out || sysEnd + 1) - 1, 'relations: name, domain → range (e.g. hasPart: Apparel -> GarmentComponent)');
  if (attr) push('ontology', attr, (photo || fb || out || sysEnd + 1) - 1, 'attribute properties with their allowed values: the only words allowed in "attributes"');
  if (photo) push('ontology', photo, (fb || out || sysEnd + 1) - 1, 'the photo as a whole: the look\'s occasion, one of the listed values, the only words allowed in "photo_properties"');
  if (fb) push('feedback', fb, (out || sysEnd + 1) - 1, 'the ask that makes the model an ontology reviewer: what it saw but could not express, and how it would extend the ontology');
  if (out) push('output', out, sysEnd, 'the JSON shape and the rules (0–1000 bbox scale, leaf classes, allowed values only)');
  const userLine = at('bbox values are on the', sysEnd) || sysEnd + 3;
  push('image', userLine, userLine, 'the per-request text: pixel size (from the image header) + the fixed instruction');
  const reqStart = at('"modelId"');
  push('model', reqStart, reqStart, `modelId: ${r.model.id}${r.model.third_party ? ' (third-party model, same request shape)' : ''}`);
  const sysRef = at('"<ontology prompt', reqStart);
  push('prompt', sysRef, sysRef, 'system[0]: the ontology prompt above');
  const cp = at('"cachePoint"', reqStart);
  if (cp) push('cache', cp - 1, cp + 2, 'system[1]: the cache checkpoint; everything before it is the cached prefix');
  else if (r.prompt_caching === false || !r.model.explicit_cache) {
    const sysArr = at('"system": [', reqStart);
    push('cache', sysArr, sysArr, r.model.explicit_cache ? 'no cachePoint: caching was switched off for this call' : `no cachePoint: ${r.model.name} takes no cache checkpoint (it caches on its own or not at all)`);
  }
  const img = at('"image": {', reqStart);
  if (img) push('image', img, img + 4, 'the image content block (bytes elided here)');
  const inf = at('"inferenceConfig"', reqStart);
  if (inf) push('model', inf, lines.length - 1, 'per-model inference config (maxTokens; temperature only where the model accepts it)');
  return {
    id: PROMPT_ID,
    title: `The prompt actually sent to ${r.model.name}`,
    language: 'markdown',
    file: 'GET result.prompt (system · user · request) of the latest call',
    steps: [3],
    nodes: ['lambda', 'bedrock'],
    code,
    highlights: h,
  };
}
