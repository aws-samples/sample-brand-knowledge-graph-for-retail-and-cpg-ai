// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClassifyResult } from '../../api';
import recorded from './__fixtures__/classify.opus55.json';
import { CodeViewer, KIND_META } from './CodeViewer';
import { promptSnippet } from './promptSnippet';
import { visibleText } from '../../visibleText';

/** The viewer is rendered to static HTML: syntax tokens, line numbers, gutter pins and notes. */
const converseSource = `def classify(bedrock, model, system_prompt, image, use_cache):
    \"\"\"A stand-in for the request builder + the call, just to render.\"\"\"
    system: list[dict] = [{"text": system_prompt}]
    if use_cache and model.explicit_cache:
        system.append({"cachePoint": {"type": "default"}})
    resp = bedrock.converse(
        modelId=model.id, system=system, messages=messages, inferenceConfig=inference
    )
    return resp
`;

describe('CodeViewer', () => {
  it('renders every line with a number, prism tokens and the marks in the gutter', () => {
    const html = renderToStaticMarkup(
      <CodeViewer
        code={converseSource}
        language="python"
        highlights={[
          { kind: 'prompt', start: 3, end: 3, note: 'the ontology is the system prompt' },
          { kind: 'cache', start: 4, end: 5, note: 'cache checkpoint after the ontology' },
          { kind: 'bedrock', start: 6, end: 8, note: 'the Converse call' },
        ]}
      />,
    );
    expect(html.match(/token-line ide-line/g)).toHaveLength(9); // one div per source line
    expect(html).toContain('<span class="ide-no">9</span>');
    expect(html).toMatch(/class="token keyword"[^>]*>def</); // prism did tokenize python
    expect(html).toMatch(/class="token string"[^>]*>&quot;cachePoint&quot;/);
    // marked lines carry the kind class and the colour variable; the first line of a mark gets the pin
    expect(html.match(/marked kind-cache/g)).toHaveLength(2);
    expect(html.match(/marked kind-bedrock/g)).toHaveLength(3);
    expect(html.match(/class="ide-pin" title="/g)).toHaveLength(3);
    expect(html).toContain(`--mark:${KIND_META.cache.color}`);
    // notes legend: all three, numbered, with their line ranges
    expect(html).toContain('L4–5');
    expect(html).toContain('the Converse call');
    expect(html).toContain('prompt caching'); // kind filter chips
  });

  it('renders the real prompt of a classify response as markdown with its marks', () => {
    const snippet = promptSnippet(recorded as unknown as ClassifyResult);
    const html = renderToStaticMarkup(<CodeViewer code={snippet.code} language={snippet.language} highlights={snippet.highlights} />);
    const lines = snippet.code.split('\n').length;
    expect(html.match(/token-line ide-line/g)).toHaveLength(lines);
    expect(visibleText(html)).toContain('## Entity classes (things you can locate in the image)'); // markdown headings are tokenized
    expect(html.match(/class="ide-pin" title="/g)).toHaveLength(snippet.highlights.length);
    expect(html).toContain('the cache checkpoint');
  });

  it('renders code without highlights and without the notes block', () => {
    const html = renderToStaticMarkup(<CodeViewer code={'x = 1\n'} language="python" highlights={[]} />);
    expect(html).not.toContain('ide-notes');
    expect(html.match(/token-line ide-line/g)).toHaveLength(1);
  });

  it('marks the focus line, and only that one', () => {
    const html = renderToStaticMarkup(<CodeViewer code={converseSource} language="python" highlights={[]} focusLine={3} />);
    const focused = html.match(/class="token-line ide-line focus"[^>]*data-line="(\d+)"/g) ?? [];
    expect(focused).toHaveLength(1);
    expect(focused[0]).toContain('data-line="3"');
    expect(renderToStaticMarkup(<CodeViewer code={converseSource} language="python" highlights={[]} focusLine={null} />)).not.toContain('ide-line focus');
  });

  it('wraps long lines only when asked to', () => {
    expect(renderToStaticMarkup(<CodeViewer code={'a long line\n'} language="prompt" highlights={[]} wrap />)).toMatch(/class="ide-body prism-code language-prompt wrap"/);
    expect(renderToStaticMarkup(<CodeViewer code={'a long line\n'} language="prompt" highlights={[]} />)).toMatch(/class="ide-body prism-code language-prompt"/);
  });

  it('knows the Turtle and prompt grammars', () => {
    expect(renderToStaticMarkup(<CodeViewer code={'fo:Coat a owl:Class .'} language="turtle" highlights={[]} />)).toMatch(/class="token prefixed-name class-name"[^>]*>Coat</);
    expect(renderToStaticMarkup(<CodeViewer code={'## Output\n- Coat: a coat'} language="prompt" highlights={[]} />)).toMatch(/class="token heading function"[^>]*>## Output</);
  });
});
