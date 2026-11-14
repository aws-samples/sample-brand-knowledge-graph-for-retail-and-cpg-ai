// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClassifyResult } from '../../api';
import recorded from './__fixtures__/classify.opus55.json';
import { PromptView } from './PromptView';

/** The readable prompt, rendered to static HTML from the recorded Opus 5.5 response. */
const result = recorded as unknown as ClassifyResult;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');

describe('PromptView', () => {
  it('lays the fashion prompt out as instruction, class tree, relations, attributes, feedback ask and output contract', () => {
    const html = renderToStaticMarkup(<PromptView system={result.prompt.system} user={result.prompt.user} tokens={result.metrics.prompt_tokens_estimate} />);
    const t = text(html);
    // summary strip
    expect(t).toMatch(/9.682 chars ≈ [\d.,]+ tokens/);
    expect(t).toContain('classes');
    expect(t).toContain('1 relation ');
    expect(t).toContain('attribute properties');
    // instruction callout
    expect(t).toContain('instruction You classify what is visible in a photo using ONLY the vocabulary');
    // section headers with hints
    expect(t).toContain('Entity classes (things you can locate in the image)');
    expect(t).toContain('Relations between entities (name: domain -> range)');
    expect(t).toContain('Attribute properties (name (applies to ...): allowed values)');
    expect(t).toContain('The whole photo (name: allowed values)'); // the look's occasion (version 1.2.0)
    expect(t).toContain('For a photo of an outfit, choose at most one value per property');
    expect(html).toContain('<span class="chip static kind-individual">Professional (Tailored office wear.)</span>');
    expect(t).toContain('Ontology feedback');
    expect(t).toContain('Output');
    // the class tree: nested lists, monospace names, labels and synonym chips
    expect(html).toContain('<ul class="prompt-tree root">');
    expect(html.match(/<ul class="prompt-tree">/g)!.length).toBeGreaterThan(5);
    expect(html).toContain('<span class="class-name">Headband</span>');
    expect(html).toContain('<span class="class-name">Headwear</span><span class="muted class-label">: Head</span>');
    expect(t).toMatch(/Headband\s+also:\s+hair accessory\s+head covering/);
    // relations as a table row: name, domain, arrow, range
    expect(t).toMatch(/hasPart\s+Apparel\s+→\s+GarmentComponent/);
    // attribute properties: name, "applies to" chips, value chips; long lists are folded
    expect(t).toMatch(/hasLength\s+applies to\s+UpperBodyGarment\s+LowerBodyGarment\s+WholeBodyGarment/);
    expect(html).toContain('<span class="chip static kind-individual">midi</span>');
    // long value lists fold after 20: hasSilhouette and hasNecklineType have 25 values each
    expect(t.match(/\+5 more/g)).toHaveLength(2);
    expect(t).not.toMatch(/wide leg/); // the 25th silhouette value is behind the fold …
    expect(t).not.toContain('v-neck'); // … and so is the 25th neckline value
    expect(t).toContain('sleeveless'); // hasLength has 15 values: all shown, no fold
    // feedback ask kept as prose, in its own coloured block
    expect(html).toContain('prompt-section kind-text feedback');
    expect(t).toContain('you are also its reviewer');
    // output contract: lead, indented shape, numbered rules
    expect(t).toContain('Return ONLY a JSON object, no prose, with this shape:');
    expect(html).toContain('<pre class="code-block prompt-shape">{\n  &quot;entities&quot;: [\n    {');
    expect(html.match(/<ol class="prompt-rules">/g)).toHaveLength(1);
    expect(html.match(/<li>/g)!.length).toBeGreaterThanOrEqual(5);
    expect(t).toContain('propose an improvement to the ontology');
    expect(t).not.toContain('at most 12 entities');
    // the user turn under it
    expect(t).toContain('user turn the image as bytes, then: The image is 576x1024 pixels');
    // raw text is not rendered until asked
    expect(html).not.toContain('prompt-raw');
  });

  it('shows the raw text when asked, unchanged', () => {
    const html = renderToStaticMarkup(<PromptView system={result.prompt.system} defaultRaw />);
    expect(html).toContain('<pre class="code-block prompt-raw">');
    expect(html).not.toContain('prompt-tree');
    const raw = /<pre class="code-block prompt-raw">([\s\S]*?)<\/pre>/.exec(html)![1];
    expect(raw.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')).toBe(result.prompt.system);
  });

  it('renders without a user turn: the "rendered prompt" item shows the selected ontology before any call', () => {
    // the architecture panel feeds it detail.prompt (GET /api/ontologies/detail), the same text the
    // route later sends as the system prompt: no run needed, no user turn to show
    const html = renderToStaticMarkup(<PromptView system={result.prompt.system} tokens={3006} />);
    expect(html).not.toContain('prompt-user');
    expect(text(html)).toMatch(/9.682 chars ≈ 3.006 tokens/); // thousands separator is locale-dependent
    expect(html).toContain('<span class="class-name">Apparel</span>');
  });
});
