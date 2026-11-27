// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reasoning, VisionModel } from '../../api';
import { AgentDeepDive, DescribeDeepDive } from './AgentDeepDive';
import { effortFor, effortLabel, effortOptions, effortText } from './effort';

const model = (name: string, reasoning: Reasoning | null, note: string | null = null): VisionModel => ({
  id: `global.${name.toLowerCase().replace(/ /g, '-')}`,
  name,
  provider: '',
  third_party: false,
  explicit_cache: false,
  cache_min_tokens: null,
  supports_temperature: true,
  notes: '',
  reasoning,
  reasoning_note: note,
});
// as GET /api/ask/models lists them (vision.py's registry)
const SONNET = model('Claude Sonnet 5.5', { levels: ['default', 'low', 'medium', 'high'], default_means: 'high', readable: true, family: 'anthropic' });
const HAIKU = model('Claude Haiku 5.5', { levels: ['default', 'off', 'low', 'medium', 'high'], default_means: 'medium', readable: true, family: 'anthropic' });
const TERRA = model('GPT-6.1 Terra', { levels: ['default', 'low', 'medium', 'high'], default_means: 'medium', readable: false, family: 'openai' });
const NOVA = model('Amazon Nova 2 Lite', { levels: ['default', 'low'], default_means: 'off', readable: false, family: 'nova' });
const GROK = model('Grok 4.7', { levels: ['default', 'medium'], default_means: 'low', readable: false, family: 'grok' });
const KIMI_NOTE = 'Reasoning effort: set by the model. Kimi K3 always reasons at its highest level through the Converse API, so this agent cannot change it.';
const KIMI = model('Kimi K3', null, KIMI_NOTE);
const OTHER = model('Claude Opus 5', null, "Reasoning effort: this sample offers no setting for Claude Opus 5; it runs at the model's own default.");

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the reasoning effort per model', () => {
  it("lists each model's levels in its order, Default with what it stands for", () => {
    expect(effortOptions(SONNET).map((o) => o.label)).toEqual(['Default (high)', 'Low', 'Medium', 'High']);
    expect(effortOptions(HAIKU).map((o) => o.label)).toEqual(['Default (medium)', 'Off', 'Low', 'Medium', 'High']);
    expect(effortOptions(TERRA).map((o) => o.label)).toEqual(['Default (medium)', 'Low', 'Medium', 'High']);
    expect(effortOptions(NOVA).map((o) => o.label)).toEqual(['Default (off)', 'Low']);
    expect(effortOptions(GROK).map((o) => o.id)).toEqual(['default', 'medium']);
    expect(effortOptions(KIMI)).toEqual([]);
    expect(effortOptions(undefined)).toEqual([]);
  });

  it('sends a remembered level the model offers, else its default; nothing for a model with no setting', () => {
    expect(effortFor(SONNET, 'high')).toBe('high');
    expect(effortFor(GROK, 'high')).toBe('default'); // Grok offers default and medium only
    expect(effortFor(SONNET, 'off')).toBe('default'); // only Haiku can switch reasoning off
    expect(effortFor(HAIKU, 'off')).toBe('off');
    expect(effortFor(KIMI, 'high')).toBeNull();
    expect(effortFor(OTHER, 'default')).toBeNull();
    expect(effortFor(undefined, 'low')).toBeNull();
  });

  it('words what ran: the label, or "not set"', () => {
    expect(effortText('default', SONNET)).toBe('Default (high)');
    expect(effortText('medium', GROK)).toBe('Medium');
    expect(effortText(null, KIMI)).toBe('not set');
    expect(effortLabel('default', null)).toBe('Default');
  });
});

describe('the deep dives', () => {
  const dive = (m: VisionModel, effort: string | null) =>
    renderToStaticMarkup(<AgentDeepDive id="t" model={m} modelId={m.id} effort={effort} onModel={() => {}} onEffort={() => {}} disabled={false} />);

  it("offers the agent's model and the levels of the chosen model, collapsed", () => {
    const html = dive(SONNET, 'low');
    expect(html).toMatch(/^<details class="xp"><summary>Deep dive: the agent&#x27;s model and reasoning effort/);
    expect(html).toContain('<label for="t-model">Agent model</label>');
    expect(html).toContain('<label for="t-effort">Reasoning effort</label>');
    expect([...html.matchAll(/<option value="([a-z]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => `${m[1]}=${m[2]}`)).toEqual(['default=Default (high)', 'low=Low', 'medium=Medium', 'high=High']);
    expect(html).toContain('<option value="low" selected="">Low</option>');
    expect(html).toContain('4,096 output tokens');
  });

  it("shows the model's sentence in place of the control when it has no setting", () => {
    const kimi = dive(KIMI, null);
    expect(kimi).not.toContain('Reasoning effort</label>');
    expect(kimi).toContain(KIMI_NOTE);
    expect(dive(OTHER, null)).toContain('this sample offers no setting for Claude Opus 5; it runs at the model&#x27;s own default.');
  });

  it("method 3's deep dive: a model only", () => {
    const html = renderToStaticMarkup(<DescribeDeepDive modelId="" onModel={() => {}} disabled={false} />);
    expect(html).toContain('<summary>Deep dive: the model that describes the cloud</summary>');
    expect(html).toContain('<label for="ln-trends-describe-model">Model</label>');
    expect(html).not.toContain('Reasoning effort</label>');
  });
});
