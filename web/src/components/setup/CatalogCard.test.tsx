// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../api';
import { CatalogCard } from './CatalogCard';

/** Tab 0's product catalog card: one S3 Vectors bucket and its `catalog` index (`catalog` block of `GET /api/setup`). */
const status = (catalog: SetupStatus['catalog']) => ({ region: 'us-east-1', catalog }) as SetupStatus;
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");

describe('CatalogCard', () => {
  it('names the catalog index RAG and GraphRAG search, with the console link', () => {
    const html = renderToStaticMarkup(<CatalogCard s={status({ configured: true, vector_bucket: 'kg-vectors', catalog_index: 'catalog', dimension: 1024 })} />);
    expect(text(html)).toContain('Product catalog: Amazon S3 Vectors');
    expect(text(html)).toContain('RAG and GraphRAG search the same product catalog');
    expect(text(html)).toContain('s3vectors://kg-vectors/catalog');
    expect(text(html)).not.toContain('documents');
    expect(html).toContain('https://us-east-1.console.aws.amazon.com/s3/vectors/bucket/kg-vectors?region=us-east-1');
  });

  it('says so when the stack has no vector bucket', () => {
    const html = renderToStaticMarkup(<CatalogCard s={status({ configured: false, vector_bucket: null, catalog_index: null, dimension: 1024 })} />);
    expect(html).toContain('No vector bucket is configured');
    expect(html).not.toContain('s3vectors://');
  });
});
