// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The tabs themselves are not under test here (some draw on a canvas and need a browser).
vi.mock('./auth', () => ({ signIn: async () => {}, signOut: () => {} }));
vi.mock('./signing', () => ({ signedRequest: async () => null, forgetCredentials: () => {} }));
vi.mock('./components/Explorer', () => ({ Explorer: () => null }));
vi.mock('./components/graph/ExploreGraph', () => ({ ExploreGraph: () => null }));
vi.mock('./components/pipeline/IngestPipeline', () => ({ IngestPipeline: () => null }));
vi.mock('./components/setup/SetupTab', () => ({ SetupDetails: () => null }));

describe('the app', () => {
  it('opens on tab 0 · Start here', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { default: App } = await import('./App');
    const html = renderToStaticMarkup(<App />);
    vi.unstubAllGlobals();
    expect(html).toContain('<button class="active">0 · Start here</button>');
    expect(html.match(/class="active"/g)).toHaveLength(1);
    // tab 3 explores the graph, tab 4 builds the retriever, tab 5 asks with it (a question or a photo)
    // tab 6 asks the graph other questions (who is asking), the emerging trends among them: no tab of their own
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect([...nav.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual([
      '0 · Start here',
      '1 · Ontology explorer',
      '2 · Hydrate the graph',
      '3 · Explore the graph',
      '4 · Build the retriever',
      '5 · Compare GraphRAG with traditional methods',
      '6 · What else the graph knows · BONUS',
    ]);
    // no buttons in the header that wipe the graph or the vector store
    expect(html).not.toContain('Clear graph');
    expect(html).not.toContain('Clear RAG');
  });

  it('opens on the tab a link names (?tab=), and on tab 0 for anything else', async () => {
    const { default: App, tabFromSearch } = await import('./App');
    expect(tabFromSearch('?tab=ask')).toBe('ask');
    expect(tabFromSearch('?tab=explore&x=1')).toBe('explore');
    expect(tabFromSearch('?tab=admin')).toBe('setup');
    expect(tabFromSearch('?tab=qa')).toBe('setup'); // the old Q&A tab's link
    expect(tabFromSearch('?tab=trends')).toBe('setup'); // the old trends tab's link: its methods are in tab 6
    expect(tabFromSearch('')).toBe('setup');
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('location', { search: '?tab=explore', href: 'https://d111.cloudfront.net/?tab=explore' });
    const html = renderToStaticMarkup(<App />);
    vi.unstubAllGlobals();
    expect(html).toContain('<button class="active">1 · Ontology explorer</button>');
  });
});
