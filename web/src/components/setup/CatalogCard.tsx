// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { SetupStatus } from '../../api';
import { ReadyPill, vectorBucketConsoleUrl } from './setupView';

/** The product catalog tabs 4 and 5 search: the stack's Amazon S3 Vectors bucket and its `catalog` index. */
export function CatalogCard({ s }: { s: SetupStatus }) {
  const c = s.catalog;
  return (
    <section className="card setup-card">
      <h3>
        Product catalog: Amazon S3 Vectors <ReadyPill ok={c.configured} />
      </h3>
      <p className="muted">
        RAG and GraphRAG search the same product catalog: one vector bucket with one index ({c.dimension} dimensions, cosine), filled at deploy with the data sets&apos; products.
      </p>
      {c.configured ? (
        <>
          {c.catalog_index && (
            <p>
              <code>
                s3vectors://{c.vector_bucket}/{c.catalog_index}
              </code>
            </p>
          )}
          {c.vector_bucket && (
            <div className="setup-actions">
              <a className="button-link" href={vectorBucketConsoleUrl(s.region, c.vector_bucket)} target="_blank" rel="noopener noreferrer">
                S3 Vectors console ↗
              </a>
            </div>
          )}
        </>
      ) : (
        <p>No vector bucket is configured, so tabs 4 and 5 cannot search for products.</p>
      )}
    </section>
  );
}
