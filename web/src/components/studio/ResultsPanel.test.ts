// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import type { ClassifyResult } from '../../api';
import { inputTokensText, removedByEntity } from './ResultsPanel';

/** A reply as the API returns it: the model's own JSON (inside prose) and the check's messages. */
const result = (issues: string[], entities: unknown[]) =>
  ({ issues, raw_text: `Here is the answer:\n${JSON.stringify({ entities })}\nDone.` }) as unknown as ClassifyResult;

describe('what the check removed, per row', () => {
  it('puts each message on the row it names, with the value the model gave', () => {
    const r = removedByEntity(
      result(
        ["hasNonTextileMaterial='leather' is not an allowed value (entity e4)", 'hasTextilePattern does not apply to Bag (entity e7)'],
        [
          { id: 'e4', class: 'Shoe', attributes: { hasNonTextileMaterial: 'leather' } },
          { id: 'e7', class: 'Bag', attributes: { textilePattern: 'plain (pattern)' } },
        ],
      ),
      null,
    );
    expect(r.e4).toEqual([{ what: 'detail', prop: 'hasNonTextileMaterial', value: 'leather', why: 'not an allowed value' }]);
    expect(r.e7).toEqual([{ what: 'detail', prop: 'hasTextilePattern', value: 'plain (pattern)', why: 'not a detail of a Bag' }]);
  });
  it('reads unknown details and parts, and leaves the messages without a row out', () => {
    const r = removedByEntity(
      result(["unknown attribute property 'sheen' (entity e1)", "unknown part class 'Strap' (entity e1)", 'invalid bbox for entity e2: [1]'], [{ id: 'e1', attributes: { sheen: 'glossy' } }]),
      null,
    );
    expect(r.e1).toEqual([
      { what: 'detail', prop: 'sheen', value: 'glossy', why: 'not a detail in the ontology' },
      { what: 'part', prop: 'Strap', value: '', why: 'not in the ontology' },
    ]);
    expect(Object.keys(r)).toEqual(['e1']);
  });
  it('still lists a removal when the reply has no JSON to read', () => {
    const r = removedByEntity({ issues: ['hasLength does not apply to Shoe (entity e3)'], raw_text: 'no json' } as unknown as ClassifyResult, null);
    expect(r.e3[0].value).toBe('');
  });
});

describe("the model's note line", () => {
  it('shows the cached share of the input, not only the total', () => {
    expect(inputTokensText({ total_input_tokens: 12345, cache_read_tokens: 11200, cache_write_tokens: 0 })).toBe('12,345 input tokens (11,200 read from the prompt cache)');
  });
  it('names what the call wrote to the cache when it started it', () => {
    expect(inputTokensText({ total_input_tokens: 12345, cache_read_tokens: 0, cache_write_tokens: 11200 })).toBe('12,345 input tokens (0 read from the prompt cache, 11,200 written to it)');
  });
});
