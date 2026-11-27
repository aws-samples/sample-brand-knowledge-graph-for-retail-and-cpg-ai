// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunStatus } from '../../api';
import fixture from './__fixtures__/run.status.json';
import { RunSummaryCard } from './RunSummaryCard';

const status = fixture as unknown as RunStatus;

describe('RunSummaryCard', () => {
  it('renders the headline, the graph delta, the shared nodes and the aggregated feedback', () => {
    const html = renderToStaticMarkup(<RunSummaryCard status={status} highlighted={null} onShared={() => {}} />);
    expect(html).toContain('Added 9 items, 1 look, 2 articles (2 statements) from 3 of 3 sources');
    expect(html).toMatch(/Item<\/span><\/td><td>54<\/td><td>63<\/td><td class="good">\+9/);
    expect(html).toContain('What the sources share');
    expect(html).toContain('3 items from 3 sources');
    expect(html).toContain('Ontology feedback across the batch');
    expect(html).toContain('from 3 sources');
  });

  it('marks the highlighted shared node and waits for the summary while it is pending', () => {
    const shared = status.summary!.shared[0].id;
    const html = renderToStaticMarkup(<RunSummaryCard status={status} highlighted={shared} onShared={() => {}} />);
    expect(html).toContain('class="shared active"');
    const pending = renderToStaticMarkup(<RunSummaryCard status={{ ...status, summary: null, status: 'RUNNING' }} highlighted={null} onShared={() => {}} />);
    expect(pending).toContain('The summary step runs once every source is through.');
  });
});
