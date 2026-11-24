// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogHit, CatalogQuery } from '../../api';
import { forgetKept, resetKept, setKept } from '../shared/kept';
import { stageKey } from './keys';
import { StageCatalog } from './StageCatalog';

// Nothing here reaches the network: the index is read in an effect, and renderToStaticMarkup runs no effects.
vi.mock('../../auth', () => ({ signIn: async () => {} }));

const hit = (name: string, type: string, color: string, image_key = ''): CatalogHit => ({ key: name.toLowerCase().replace(/\s+/g, '-'), search: 'q', distance: 0.8, name, category: 'c', type, color, image_key, text: name });
const done = (hits: CatalogHit[]) => ({ status: 'done' as const, value: { query: 'a blue shirt', k: 6, vector: { dimension: 1024, first: [0.01], norm: 1 }, hits, metrics: { embed_ms: 190, search_ms: 62 } } satisfies CatalogQuery });

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetKept();
  forgetKept('');
});
afterEach(() => vi.unstubAllGlobals());

describe('StageCatalog (tab 4, stage 1): the hits table', () => {
  it('lists a text catalog without thumbnails', () => {
    setKept(stageKey('fashion', 'catalog.search'), done([hit('White shoe', 'shoe', 'white'), hit('Sand suede shoe', 'shoe', 'sand')]));
    const html = renderToStaticMarkup(<StageCatalog domain="fashion" subject="white sneakers" onDone={() => {}} />);
    expect(html).toContain('<td>White shoe</td>');
    expect(html).not.toContain('stored-photo');
  });

  it('marks a product without a photo when the other hits have one', () => {
    setKept(stageKey('fashion', 'catalog.search'), done([hit('Light blue cotton utility shirt', 'utility shirt', 'light blue', 'anycompany-fashion-house/products/item_1.jpg'), hit('Sage cotton top', 'top', 'sage')]));
    const html = renderToStaticMarkup(<StageCatalog domain="fashion" subject="a blue shirt" onDone={() => {}} />);
    expect(html).toContain('aria-label="Light blue cotton utility shirt: loading"');
    expect(html).toContain('<span class="stored-photo thumb placeholder no-photo" role="img" aria-label="Sage cotton top: no photo in the catalog" title="No photo in the catalog">');
  });
});
