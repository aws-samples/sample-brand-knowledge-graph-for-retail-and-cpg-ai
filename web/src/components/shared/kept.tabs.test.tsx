// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentResult, LensCount, LensExplain, PayoffResult, RagColumn, TrendsMap } from '../../api';
import { LENSES } from '../lenses/lenses';
import { LensesTab, SEASONS } from '../lenses/LensesTab';
import { AskStylist } from '../payoff/AskStylist';
import { GraphQuery } from '../query/GraphQuery';
import { BuildRetriever } from '../retriever/BuildRetriever';
import { stageKey, tabKey } from '../retriever/keys';
import { ColdOpen } from '../setup/ColdOpen';
import recorded from './__fixtures__/agent.trace.json';
import { forgetKept, resetKept, setKept, syncKeptVersion } from './kept';

// What each tab shows when it opens again: the kept answers, as a request that landed while
// another tab was open (or before a reload) left them. The diagrams and the payoff columns are
// not what these tests are about.
vi.mock('../../auth', () => ({ signIn: async () => {} }));
// requests go out unsigned to the API path, as the tests' fetch stubs expect
vi.mock('../../signing', () => ({ signedRequest: async (_m: string, path: string, headers: Record<string, string>) => ({ url: path, headers }), forgetCredentials: () => {} }));
vi.mock('../retriever/RetrieverArchitecture', () => ({ RetrieverHowItWorks: () => null }));
vi.mock('../query/QueryArchitecture', () => ({ QueryArchitecture: () => null }));
vi.mock('../lenses/TrendsArchitecture', () => ({ LensesHowItWorks: () => null }));
vi.mock('../payoff/PayoffTab', () => ({ PayoffView: ({ result }: { result: PayoffResult }) => <p>{`columns: ${result.columns.graph.answer}`}</p> }));

const DONE = <T,>(value: T) => ({ status: 'done' as const, value });

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetKept();
  forgetKept('');
});
afterEach(() => vi.unstubAllGlobals());

describe('the answers a tab keeps', () => {
  it("tab 0 shows the cold open's answer and 'Ask again'", () => {
    const answer = { answer: 'Try them with straight jeans.', inspect: { system: 's', user: 'u' }, metrics: { ms: 2100 } };
    setKept('coldOpen.result', { answer });
    const html = renderToStaticMarkup(<ColdOpen />);
    expect(html).toContain('Try them with straight jeans.');
    expect(html).toContain('Ask again');
  });

  it("tab 0 says 'Asking…' when it opens again while the model still answers", () => {
    setKept('coldOpen.asking', { status: 'running' });
    expect(renderToStaticMarkup(<ColdOpen />)).toContain('Asking…');
  });

  it("tab 3 shows the query agent's answer and the text it was given", () => {
    const agent = recorded as unknown as AgentResult;
    setKept('query.explorer.text', 'which looks have white sneakers?');
    setKept('query.explorer.way', '3b');
    setKept('query.explorer.agent', { status: 'done', result: agent, why: 'asked' });
    const html = renderToStaticMarkup(<GraphQuery title="explorer" examples={[]} guided />);
    expect(html).toContain('which looks have white sneakers?');
    expect(html).toMatch(/aria-selected="true"[^>]*><span class="rt-substep-n">3b</);
    expect(html).toContain(agent.model.name);
  });

  it("tab 4 keeps the question, RAG's answer and the stages it unlocked", () => {
    const rag = {
      mode: 'rag',
      answer: 'Wear it with charcoal trousers [1].',
      evidence: [],
      receipts: { kind: 'products', label: '6 catalog products' },
      plan: { searches: ['charcoal trousers'], why: 'a blazer needs trousers' },
      inspect: { planner_system: 'p', system: 's', user: 'u' },
    } as unknown as RagColumn;
    setKept(tabKey('fashion', 'question'), 'What goes with a black blazer?');
    setKept(tabKey('fashion', 'catalogDone'), true);
    setKept(stageKey('fashion', 'searches'), ['charcoal trousers']);
    setKept(stageKey('fashion', 'rag.answer'), DONE(rag));
    const html = renderToStaticMarkup(<BuildRetriever domain="fashion" />);
    expect(html).toContain('The question: <b>What goes with a black blazer?</b>');
    expect(html).toContain('Wear it with charcoal trousers');
    expect(html).not.toContain('Run a catalog search in stage 1 first.');
    expect(html).not.toContain('Get a RAG answer in stage 2 first.');
    expect(html).toContain('Find the way in in stage 3 first.');
  });

  it('tab 4 starts stages 2 to 5 over for a new question, and keeps stage 1 done', () => {
    setKept(tabKey('fashion', 'catalogDone'), true);
    setKept(stageKey('fashion', 'searches'), ['charcoal trousers']);
    forgetKept(`retriever.fashion.stage.`); // what BuildRetriever does for a new question
    const html = renderToStaticMarkup(<BuildRetriever domain="fashion" />);
    expect(html).not.toContain('Run a catalog search in stage 1 first.');
    expect(html).toContain('Get a RAG answer in stage 2 first.');
  });

  it('tab 5 keeps the three answers and the question they answer', () => {
    const result = { columns: { graph: { answer: 'From the Weekend Errands look [A].' } }, model: { name: 'Claude Haiku 5.5' }, ms: 14_200, input: 'question' } as unknown as PayoffResult;
    setKept('stylist.fashion.questions', { question: 'What goes with a black blazer?', photo: 'What goes with this?' });
    setKept('stylist.fashion.result', DONE(result));
    const html = renderToStaticMarkup(<AskStylist domain="fashion" />);
    expect(html).toContain('value="What goes with a black blazer?"');
    expect(html).toContain('Claude Haiku 5.5 · 14.2 s for all three');
    expect(html).toContain('columns: From the Weekend Errands look [A].');
  });

  it("tab 6 keeps a lens's count and the model's explanation, until the graph changes", () => {
    const lens = LENSES.find((l) => !l.input)!;
    const persona = lens.persona;
    const count: LensCount = { lens: lens.id, columns: ['garment', 'looks'], rows: [['white sneakers', 12]], headline: '12 looks', query: 'MATCH', edited: false, pieces: 1, start_garments: 1, ms: 300 };
    const explain: LensExplain = { text: 'White sneakers anchor 12 looks [1].', system: 's', user: 'u', ms: 2500, model: 'm' };
    setKept('lens.input.fashion.persona', persona);
    setKept('lens.input.fashion.lens', lens.id);
    setKept('lens.result.fashion.counts', { [lens.id]: DONE(count) });
    setKept('lens.result.fashion.explains', { [lens.id]: DONE(explain) });
    const page = () => renderToStaticMarkup(<LensesTab domain="fashion" health={null} dataVersion={0} />);
    expect(page()).toContain('White sneakers anchor 12 looks');
    syncKeptVersion('lens.result.', 1); // a tab 2 run finished
    expect(page()).not.toContain('White sneakers anchor 12 looks');
  });

  it("tab 6 keeps the trends map without its vectors, and its layout's positions as numbers", () => {
    const map = { n: 2, dim: 2, vectors: 'AAAAAAAAgD8=', items: [], totals: { new: 1, base: 1 }, truncated: false, ms: 900 } as unknown as TrendsMap;
    const lay = { xy: new Float32Array([0.25, 0.5, 0.75, 1]), groupOf: [0, 0], groups: [] };
    const stored = JSON.parse(JSON.stringify(SEASONS.save({ trends: DONE({ map, lay }), other: { status: 'idle' } })));
    expect(stored.trends.value.map.vectors).toBe('');
    const back = SEASONS.load(stored);
    expect(back.other).toEqual({ status: 'idle' });
    const season = back.trends.status === 'done' ? back.trends.value : null;
    expect(season?.lay.xy).toBeInstanceOf(Float32Array);
    expect(Array.from(season!.lay.xy)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(season?.map.ms).toBe(900);
  });
});
