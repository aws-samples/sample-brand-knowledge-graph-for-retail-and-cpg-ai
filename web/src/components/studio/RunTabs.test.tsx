// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { VisionModel } from '../../api';
import { RunTabs } from './ResultsPanel';
import type { RunRow } from './types';

const models = [
  { id: 'a', name: 'Claude Sonnet 5.5', explicit_cache: true },
  { id: 'b', name: 'GPT-5.6 Sol', explicit_cache: false },
] as unknown as VisionModel[];
const run = (modelId: string): RunRow => ({ key: modelId, modelId, caching: true, state: { status: 'done' } }) as unknown as RunRow;

describe('the run tabs', () => {
  it('show the cache badge only for a model that is sent a cache checkpoint', () => {
    const html = renderToStaticMarkup(<RunTabs runs={[run('a'), run('b')]} models={models} activeKey="a" onSelect={() => {}} />);
    expect(html.match(/cache on/g)).toHaveLength(1);
    expect(html.indexOf('Claude Sonnet 5.5')).toBeLessThan(html.indexOf('cache on'));
    expect(html.indexOf('cache on')).toBeLessThan(html.indexOf('GPT-5.6 Sol'));
  });
});
