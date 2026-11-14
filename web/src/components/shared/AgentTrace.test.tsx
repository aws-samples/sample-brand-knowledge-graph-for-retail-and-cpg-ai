// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentResult } from '../../api';
import recorded from './__fixtures__/agent.trace.json';
import { AgentTrace, timeline } from './AgentTrace';

// A graph agent run with every kind of step: MCP calls, a guard refusal, model turns with a
// reasoning summary, a redacted turn and a max_tokens stop, a failed query, a step without at_ms.
const run = recorded as unknown as AgentResult;
const html = (props: Partial<Parameters<typeof AgentTrace>[0]> = {}) => renderToStaticMarkup(<AgentTrace result={run} {...props} />);
const boxes = (out: string) => [...out.matchAll(/<button type="button" class="at-box ([^"]*)"[^>]*style="grid-column:(\d)/g)].map((m) => [m[1].split(' ')[0], Number(m[2])]);

describe('the agent trace', () => {
  it('says which MCP server ran where, and the trace id', () => {
    const out = html();
    expect(out).toContain('MCP server <code>awslabs.amazon-neptune-mcp-server</code> 1.1.1 over stdio · on Amazon Bedrock AgentCore Runtime');
    expect(out).toContain('trace <code>1-6731a2b4-0123456789abcdef01234567</code>');
    expect(html({ header: false })).not.toContain('over stdio');
  });

  it('puts every step on the time bar at its start; a step without at_ms after the one before it', () => {
    const bar = timeline(run.steps);
    expect(bar.spans.map((s) => s.at)).toEqual([0, 1200, 2100, 8500, 8800, 8800, 13900, 14600]);
    expect(bar.total).toBe(18900);
    const out = html();
    expect(out.match(/class="at-seg /g)).toHaveLength(8);
    expect(out).toContain('class="at-seg kind-guard failed"');
    expect(out).toContain('aria-label="time line: 8 steps in 18.9 s"');
    expect(timeline([]).total).toBe(1);
  });

  it('draws two lanes, the model and the MCP server, one box per step, each a button', () => {
    const out = html();
    expect(out).toContain('Model · Claude Sonnet 5.5 on Amazon Bedrock');
    expect(out).toContain('MCP server · awslabs.amazon-neptune-mcp-server');
    expect(out).toContain('Amazon Neptune Analytics');
    expect(boxes(out)).toEqual([
      ['kind-mcp', 2],
      ['kind-mcp', 2],
      ['kind-model', 1],
      ['kind-mcp', 2],
      ['kind-guard', 2],
      ['kind-model', 1],
      ['kind-mcp', 2],
      ['kind-model', 1],
    ]);
    // an arrow between consecutive boxes: down in a lane, across between them
    expect(out.match(/class="at-arrow[^"]*"/g)).toHaveLength(7);
    expect(out).toContain('↘');
    expect(out).toContain('↙');
    // the lake agent's server reads the sample's table bucket
    const lake = { ...run, mcp: { ...run.mcp, server: 'awslabs.s3-tables-mcp-server' } };
    expect(renderToStaticMarkup(<AgentTrace result={lake} />)).toContain('Amazon S3 Tables');
  });

  it('shows what a model turn asked for, its tokens, an unusual stop and its reasoning summary', () => {
    const out = html();
    expect(out).toContain('<b>→ run_opencypher_query</b>');
    expect(out).toContain('5,200 in · 410 out');
    expect(out).toContain('stopped: max_tokens');
    expect(out).not.toContain('stopped: tool_use');
    expect(out).toContain('The new content is the Item nodes with a run property.');
    expect(out).toContain('reasoned, not returned as text');
  });

  it('shows a tool call with its query and rows, a failed one with its error, the guard with what it refused', () => {
    const out = html();
    expect(out).toContain('1 rows');
    expect(out).toContain('MalformedQueryException: Variable `nme` not defined');
    expect(out).toContain('<b>guard · run_opencypher_query</b>');
    expect(out).toContain('refused: a write query: the agent reads the graph only');
    expect(out).toContain('MATCH (n) DETACH DELETE n');
  });

  it('opens no step by default; a step opened by prop shows its details under the trace', () => {
    expect(html()).not.toContain('class="at-detail');
    const out = html({ open: 3 });
    expect(out).toContain('class="at-detail kind-model"');
    expect(out).toContain('Step 3 · Claude Sonnet 5.5 → run_opencypher_query');
    expect(out).toContain('started at 2.1 s · took 6.4 s · stop reason tool_use');
    expect(out).toContain('The model&#x27;s reasoning summary');
    expect(out).toContain('I will count the new pieces per attribute first.');
    expect(out).toContain('aria-label="close the step&#x27;s details"');
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(1);
    const tool = html({ open: 4 });
    expect(tool).toContain('The query</div>');
    expect(tool).toContain('What went back to the model');
    expect(html({ open: 5 })).toContain('The query it refused');
  });

  it('says when the model does not return its reasoning as text', () => {
    expect(html()).toContain('Claude Sonnet 5.5 does not return its reasoning as text.'); // a redacted turn, nothing known
    expect(renderToStaticMarkup(<AgentTrace result={run} readable />)).not.toContain('does not return its reasoning'); // Claude: readable
    const plain = { ...run, steps: run.steps.map((s) => ({ ...s, redacted: undefined })) };
    expect(renderToStaticMarkup(<AgentTrace result={plain} />)).not.toContain('does not return its reasoning');
    expect(renderToStaticMarkup(<AgentTrace result={plain} readable={false} />)).toContain('does not return its reasoning as text.');
  });
});
