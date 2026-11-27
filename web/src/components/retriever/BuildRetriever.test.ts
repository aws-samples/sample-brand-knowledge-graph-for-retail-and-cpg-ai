// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { subjectOf } from './BuildRetriever';

describe('subjectOf', () => {
  it("takes what the question asks about for stage 1's search", () => {
    expect(subjectOf('What should I wear with white sneakers?')).toBe('white sneakers');
    expect(subjectOf('What goes with a black blazer?')).toBe('black blazer');
    expect(subjectOf('What do I wear with wide-leg trousers?')).toBe('wide-leg trousers');
  });

  it('searches a question without "with …" as it is', () => {
    expect(subjectOf('Black tie without a dress shirt')).toBe('Black tie without a dress shirt');
  });
});
