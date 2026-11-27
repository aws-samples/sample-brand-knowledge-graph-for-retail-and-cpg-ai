// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type Architecture } from '../../api';

/**
 * What John's cards do not cover: the API on AWS Lambda, the ingest pipeline on AWS Step Functions
 * and the data bucket with the brand's photos, from the route behind tab 1's "How it works"
 * (`GET /api/explorer/architecture`), with their console links.
 */
export function PipelineCard() {
  const [arch, setArch] = useState<Architecture | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.architecture().then(setArch, (e) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!arch) return null;
  const c = arch.console;
  const bucket = arch.ontologies.kind === 's3' ? arch.ontologies.bucket : null;
  const link = (href: string | undefined, text: string) =>
    href ? (
      <a className="button-link" href={href} target="_blank" rel="noopener noreferrer">
        {text} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : null;
  return (
    <section className="card setup-card">
      <h3>The API, the ingest pipeline and the photos</h3>
      <dl className="kv">
        <dt>API</dt>
        <dd>{arch.function.name ? <code>{arch.function.name}</code> : <span className="muted">the API function</span>} · AWS Lambda, called through its function URL with IAM auth</dd>
        <dt>Ingest pipeline</dt>
        <dd>
          {arch.pipeline.state_machine_name ? <code>{arch.pipeline.state_machine_name}</code> : <span className="muted">the ingest state machine</span>} · AWS Step Functions, up to{' '}
          {arch.pipeline.max_concurrency ?? 4} photos at a time (tab 2)
        </dd>
        <dt>Photos and run records</dt>
        <dd>{bucket ? <code>s3://{bucket}</code> : <span className="muted">the data bucket</span>} · the brand&apos;s look and product photos, tab 2&apos;s uploads and runs</dd>
        <dt>Embeddings</dt>
        <dd>
          <code>{arch.pipeline.embedding_model_id}</code> · one model for text and photos
        </dd>
      </dl>
      <div className="setup-actions">
        {link(c.lambda, 'Lambda console')}
        {link(c.state_machine, 'Step Functions console')}
        {link(c.s3_bucket, 'S3 console')}
        {link(c.log_group ?? c.cloudwatch, 'CloudWatch Logs')}
      </div>
    </section>
  );
}
