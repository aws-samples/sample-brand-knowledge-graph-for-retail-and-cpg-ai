// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { ClassifyResult } from '../../api';
import recorded from './__fixtures__/classify.opus55.json';
import { PROMPT_ID, promptSnippet } from './promptSnippet';

/**
 * The "prompt actually sent" tab is built from a real classify response (Claude Opus 5.5 on the
 * blazer example, captured as a fixture). Every mark must land on the line it describes.
 */
const result = recorded as unknown as ClassifyResult;

const lineAt = (code: string, n: number) => code.split('\n')[n - 1];

describe('promptSnippet', () => {
  it('lays out system prompt, user turn and request in that order', () => {
    const s = promptSnippet(result);
    expect(s.id).toBe(PROMPT_ID);
    expect(s.language).toBe('markdown');
    const lines = s.code.split('\n');
    expect(lines[0]).toMatch(/^# ===== system prompt \(9.682 chars/); // thousands separator is locale-dependent
    expect(lines[1]).toMatch(/^You classify what is visible in a photo using ONLY the vocabulary/);
    const user = lines.findIndex((l) => l.startsWith('# ===== user turn'));
    const req = lines.findIndex((l) => l.startsWith('# ===== request as sent'));
    expect(user).toBeGreaterThan(10);
    expect(req).toBeGreaterThan(user);
    expect(lines[user + 1]).toBe(result.prompt.user);
    expect(lines.slice(req + 1).join('\n')).toBe(JSON.stringify(result.prompt.request, null, 2));
  });

  it('marks the ontology sections, the image, the model, the cache checkpoint and the config', () => {
    const s = promptSnippet(result);
    const byKind = (k: string) => s.highlights.filter((h) => h.kind === k);
    // ontology: entity classes, relations, attribute properties and the whole photo, contiguous and in order inside the system prompt
    const onto = byKind('ontology');
    expect(onto).toHaveLength(4);
    expect(lineAt(s.code, onto[0].start)).toBe('## Entity classes (things you can locate in the image)');
    expect(lineAt(s.code, onto[1].start)).toBe('## Relations between entities (name: domain -> range)');
    expect(lineAt(s.code, onto[2].start)).toMatch(/^## Attribute properties/);
    expect(onto[0].end + 1).toBe(onto[1].start);
    expect(onto[1].end + 1).toBe(onto[2].start);
    expect(lineAt(s.code, onto[3].start)).toBe('## The whole photo (name: allowed values)');
    expect(onto[2].end + 1).toBe(onto[3].start);
    // the ontology-feedback ask sits between the attribute values and the output rules
    const fb = byKind('feedback');
    expect(fb).toHaveLength(1);
    expect(lineAt(s.code, fb[0].start)).toBe('## Ontology feedback');
    expect(onto[3].end + 1).toBe(fb[0].start);
    expect(lineAt(s.code, fb[0].start + 1)).toMatch(/you are also its reviewer/);
    // output rules end where the system prompt ends
    const out = byKind('output')[0];
    expect(lineAt(s.code, out.start)).toBe('## Output');
    expect(fb[0].end + 1).toBe(out.start);
    expect(lineAt(s.code, out.start + 2)).toContain('"ontology_feedback": [{"observed":');
    expect(lineAt(s.code, out.end)).toMatch(/only values from the allowed list\.$/);
    expect(lineAt(s.code, out.end + 1)).toBe('');
    // the user turn carries the pixel size
    const img = byKind('image');
    expect(lineAt(s.code, img[0].start)).toMatch(/^The image is 576x1024 pixels/);
    // the image content block in the request
    expect(lineAt(s.code, img[1].start).trim()).toBe('"image": {');
    // model id + inference config
    const model = byKind('model');
    expect(lineAt(s.code, model[0].start).trim()).toBe('"modelId": "global.anthropic.claude-opus-5-5",');
    expect(model[0].note).toContain('third-party');
    expect(lineAt(s.code, model[1].start).trim()).toBe('"inferenceConfig": {');
    expect(model[1].end).toBe(s.code.split('\n').length - 1); // closes just before the final "}"
    // the cache checkpoint: the whole {"cachePoint": {"type": "default"}} object
    const cache = byKind('cache');
    expect(cache).toHaveLength(1);
    expect(s.code.split('\n').slice(cache[0].start - 1, cache[0].end).map((l) => l.trim())).toEqual(['{', '"cachePoint": {', '"type": "default"', '}']);
    // the system[0] reference to the prompt
    const prompt = byKind('prompt');
    expect(lineAt(s.code, prompt[1].start).trim()).toBe('"text": "<ontology prompt, 9682 chars>"');
    // every mark is a valid, ordered range
    for (const h of s.highlights) expect(h.end).toBeGreaterThanOrEqual(h.start);
  });

  it('explains a missing checkpoint: caching off, or a model that takes no checkpoint', () => {
    const noCache = { ...result, prompt_caching: false, prompt: { ...result.prompt, request: { ...result.prompt.request, system: [result.prompt.request.system[0]] } } };
    const off = promptSnippet(noCache as ClassifyResult);
    const cacheOff = off.highlights.find((h) => h.kind === 'cache')!;
    expect(cacheOff.note).toMatch(/switched off/);
    expect(lineAt(off.code, cacheOff.start).trim()).toBe('"system": [');
    const gpt = promptSnippet({ ...noCache, model: { ...result.model, id: 'global.openai.gpt-5.6-sol', name: 'GPT-5.6 Sol', explicit_cache: false } } as ClassifyResult);
    expect(gpt.highlights.find((h) => h.kind === 'cache')!.note).toMatch(/GPT-5\.6 Sol takes no cache checkpoint/);
    expect(gpt.highlights.find((h) => h.kind === 'model')!.note).toContain('gpt-5.6-sol');
    // tab 1 always asks for caching: a model without a checkpoint is still explained, not left unmarked
    const gptOn = promptSnippet({ ...noCache, prompt_caching: true, model: { ...result.model, id: 'global.openai.gpt-5.6-sol', name: 'GPT-5.6 Sol', explicit_cache: false } } as ClassifyResult);
    expect(gptOn.highlights.find((h) => h.kind === 'cache')!.note).toMatch(/takes no cache checkpoint/);
  });
});
