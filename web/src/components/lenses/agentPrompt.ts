// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { CodeHighlight, CodeSnippet } from '../../api';
import { PROMPT_ID } from '../arch/promptSnippet';

/**
 * The ★ entry of method 1's and method 2's "How it works" code list: the question the agent got
 * in its latest run, with this graph's numbers filled in (the template is the first entry of the
 * step, read from the API). The agents wrap it in a tag as the user turn; the system prompt is the
 * entry under it. Wrapped at 100 characters for reading, like the API's prompt entries.
 */
export type AgentKind = 'graph' | 'lake';

const KIND: Record<AgentKind, { tag: string; step: number; system: string; source: string }> = {
  graph: { tag: 'request', step: 2, system: "The agent's system prompt", source: 'trends.agent_question' },
  lake: { tag: 'question', step: 3, system: "The data agent's system prompt", source: 'trends.lake_question' },
};

/** Greedy word wrap, paragraph by paragraph (a word longer than `width` keeps its own line). */
export function wrap(text: string, width = 100): string {
  return text
    .split('\n')
    .map((para) => {
      const lines: string[] = [];
      let line = '';
      for (const word of para.split(' ')) {
        if (line && line.length + 1 + word.length > width) {
          lines.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      return [...lines, line].join('\n');
    })
    .join('\n');
}

export function agentPromptSnippet(kind: AgentKind, question: string, modelName: string): CodeSnippet {
  const k = KIND[kind];
  const sections = [
    `# ===== user turn: the question, with this graph's numbers (${question.length.toLocaleString()} chars) =====`,
    `<${k.tag}>`,
    wrap(question),
    `</${k.tag}>`,
    '',
    `# ===== system prompt: "${k.system}" in this list, then ${kind === 'graph' ? "the domain's worked examples and the graph's schema" : "the tables' schema"} =====`,
  ];
  const code = sections.join('\n');
  const lines = code.split('\n');
  const at = (needle: string) => lines.findIndex((ln) => ln.includes(needle)) + 1; // 1-based, 0 = not found
  const h: CodeHighlight[] = [];
  const push = (kind: CodeHighlight['kind'], line: number, note: string) => {
    if (line > 0) h.push({ kind, start: line, end: line, note });
  };
  push('prompt', 3, 'the definition of emerging, in plain words: the agent writes the query itself');
  push('output', at('lift = '), "the lift with this graph's totals filled in");
  push('output', at('a_id'), 'the columns its last query must return');
  push('prompt', lines.length, 'the rules it follows come first, as the system prompt');
  return {
    id: PROMPT_ID,
    title: `The prompt actually sent to the agent (${modelName})`,
    language: 'text',
    file: `${k.source}(...) of the latest run, wrapped for reading`,
    steps: [k.step],
    nodes: ['agent'],
    code,
    highlights: h,
  };
}
