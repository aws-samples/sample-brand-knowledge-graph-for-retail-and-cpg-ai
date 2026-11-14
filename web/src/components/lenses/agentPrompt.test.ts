// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { PROMPT_ID } from '../arch/promptSnippet';
import { agentPromptSnippet, wrap } from './agentPrompt';

// The question method 1's graph agent got in a run (trends.agent_question with 12 new pieces, 491 lookbook garments).
const QUESTION =
  'Find what is EMERGING in this brand graph. The new content is the Item nodes WITH a `run` property and a `source` (the photo or text it was ingested from: 12 sources); count only those whose `confidence` is -1 or at least 0.5.\n' +
  'In one read-only query: return the top 10 rows by lift = ((support_new + 0.5) / 13) / ((support_base + 0.5) / 492), with the columns a_id (id(a)), a_name, b_id (id(b)), b_name. Then name each pair in plain words.';

describe('the prompt an agent got, as the ★ entry of the code list', () => {
  it('wraps every paragraph at 100 characters and keeps every word', () => {
    const out = wrap(QUESTION);
    expect(Math.max(...out.split('\n').map((l) => l.length))).toBeLessThanOrEqual(100);
    expect(out.split(/\s+/)).toEqual(QUESTION.split(/\s+/));
    expect(out.split('\n').length).toBeGreaterThan(QUESTION.split('\n').length);
  });

  it("shows the graph agent's question in its <request> tag, in step 2, with the numbers marked", () => {
    const s = agentPromptSnippet('graph', QUESTION, 'Claude Sonnet 5.5');
    expect(s.id).toBe(PROMPT_ID);
    expect(s.steps).toEqual([2]);
    expect(s.nodes).toEqual(['agent']);
    expect(s.title).toBe('The prompt actually sent to the agent (Claude Sonnet 5.5)');
    const lines = s.code.split('\n');
    expect(lines[1]).toBe('<request>');
    expect(s.code).toContain('</request>');
    expect(s.code).toContain("the domain's worked examples and the graph's schema");
    const lift = s.highlights.find((h) => h.note.includes('lift'));
    expect(lift && lines[lift.start - 1]).toContain('lift = ');
    expect(s.highlights.every((h) => h.start >= 1 && h.end <= lines.length)).toBe(true);
  });

  it("shows the data agent's question in its <question> tag, in step 3", () => {
    const s = agentPromptSnippet('lake', QUESTION, 'GPT-5.6 Sol');
    expect(s.steps).toEqual([3]);
    expect(s.code.split('\n')[1]).toBe('<question>');
    expect(s.code).toContain("the tables' schema");
  });
});
