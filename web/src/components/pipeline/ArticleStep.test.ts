// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { runLabel } from './ArticleStep';

describe("tab 2's article step", () => {
  it('names the picked articles on the run button', () => {
    expect(runLabel(1)).toBe('Run the pipeline on the article');
    expect(runLabel(3)).toBe('Run the pipeline on 3 articles');
  });

  it('says what to do when the pick was clicked away, instead of "0 articles"', () => {
    expect(runLabel(0)).toBe('Pick an article above to run it');
    expect(runLabel(0)).not.toMatch(/0 articles/);
  });
});
