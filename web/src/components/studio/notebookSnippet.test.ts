// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { notebookSnippet } from './notebookSnippet';

const lineAt = (code: string, n: number) => code.split('\n')[n - 1];

describe('the notebook snippet of tab 1', () => {
  it('names the chosen domain and its example photo on the highlighted lines', () => {
    const s = notebookSnippet('furniture', '01-armchair.jpg');
    expect(lineAt(s.code, 6)).toMatch(/^view = classify\.load_ontology\(svc, "furniture"\)\s+# 1\. the ontology$/);
    expect(lineAt(s.code, 7)).toMatch(/^image = classify\.load_image\(svc, "furniture", "01-armchair\.jpg"\)\s+# 2\. the photo$/);
    expect(lineAt(s.code, 8)).toContain('classify.build_prompt(view, image)');
    expect(s.highlights.map((h) => [h.start, h.end])).toEqual([[6, 6], [7, 7], [8, 8], [10, 11], [12, 13], [14, 14], [16, 17]]);
  });

  it('keeps the script runnable while the examples are not known yet', () => {
    expect(lineAt(notebookSnippet('fashion').code, 7)).toContain('"<example>.jpg"');
  });
});
