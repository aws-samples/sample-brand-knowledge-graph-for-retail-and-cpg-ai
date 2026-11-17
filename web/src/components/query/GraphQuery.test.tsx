// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult } from '../../api';
import recorded from '../shared/__fixtures__/agent.trace.json';
import { forgetKept, resetKept, setKept } from '../shared/kept';
import { GraphQuery } from './GraphQuery';

// Tab 3's step 3 as it renders from kept state: 3a runs openCypher, 3b asks in plain words.
vi.mock('../../auth', () => ({ signIn: async () => {} }));
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));
vi.mock('./QueryArchitecture', () => ({ QueryArchitecture: () => null }));

const QUESTION = 'In the looks with white sneakers, which bags are worn, and in how many looks?';
const REFUSAL = 'ValidationException: Invalid input I: expected init (line 1, column 1 (offset: 0))';

/** Kept state of a question Neptune refused (400) and the agent then answered. */
function refused(way: '3a' | '3b') {
  setKept('query.explorer.way', way);
  setKept('query.explorer.text', QUESTION);
  setKept('query.explorer.ran', QUESTION);
  setKept('query.explorer.direct', { status: 'error', error: REFUSAL, code: 400 });
  setKept('query.explorer.agent', { status: 'done', result: recorded as unknown as AgentResult, why: 'failed' });
  return renderToStaticMarkup(<GraphQuery title="explorer" examples={[]} guided />);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetKept();
  forgetKept('');
});
afterEach(() => vi.unstubAllGlobals());

describe('tab 3, step 3', () => {
  it("3b shows Neptune's refusal of a question in plain words as the expected first step", () => {
    const html = refused('3b');
    expect(html).toContain('query-expected');
    expect(html).toContain('<b>Expected:</b> Neptune reads only openCypher, so it refused the question.');
    expect(html).toContain('The app handed it to the agent below');
    expect(html).toContain(REFUSAL);
    expect(html).not.toContain('<p class="error">');
  });

  it("3a keeps Neptune's message as an error: there the text was meant as openCypher", () => {
    const html = refused('3a');
    expect(html).toContain(`<p class="error">${REFUSAL}</p>`);
    expect(html).not.toContain('query-expected');
  });

  it('3b makes Ask the agent the main button, and Run the second', () => {
    setKept('query.explorer.way', '3b');
    const html = renderToStaticMarkup(<GraphQuery title="explorer" examples={[]} guided />);
    expect(html).toMatch(/<button(?![^>]*class="secondary")[^>]*>Ask the agent<\/button><button class="secondary"[^>]*>Run<\/button>/);
  });

  it('3a keeps Run as the main button', () => {
    setKept('query.explorer.way', '3a');
    const html = renderToStaticMarkup(<GraphQuery title="explorer" examples={[]} guided />);
    expect(html).toMatch(/<button(?![^>]*class="secondary")[^>]*>Run<\/button><button class="secondary"[^>]*>Ask the agent<\/button>/);
  });
});
