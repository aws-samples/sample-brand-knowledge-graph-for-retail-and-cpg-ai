// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Architecture, type ClassifyResult, type LogsResponse, type OntologyDetail, type VisionModel } from '../../api';
import { Detail, Stat } from '../arch/panelBits';
import type { NodeId } from './ArchitecturePanel';
import type { RunRow } from './types';

/**
 * The detail box under tab 1's diagram, per selected node: the request the browser sent, how it
 * is signed (Amazon Cognito), the two S3 prefixes, the latest Lambda invocation with its log lines
 * (read back from CloudWatch, or the function's in-process ring buffer), the Bedrock calls so far, and the
 * validated answer.
 */
export function NodeDetails({
  id,
  arch,
  runs,
  latest,
  latestResult,
  models,
  detail,
  ontologyId,
}: {
  id: NodeId;
  arch: Architecture | null;
  runs: RunRow[];
  latest: RunRow | undefined;
  latestResult: ClassifyResult | null;
  models: VisionModel[];
  detail: OntologyDetail | null;
  ontologyId: string;
}) {
  const req = latest?.state.request;
  const inv = latestResult?.invocation;
  const s3 = arch?.ontologies.kind === 's3' ? arch.ontologies : null;
  const consoleLink = (key: string, label: string) =>
    arch?.console[key] ? (
      <a className="button-link" href={arch.console[key]} target="_blank" rel="noopener noreferrer">
        {label} ↗
      </a>
    ) : null;
  const s3Link = (suffix: string, label: string) =>
    arch?.console.s3_prefix_template && s3 ? (
      <a className="button-link" href={arch.console.s3_prefix_template.replace('{prefix}', encodeURIComponent(`${s3.prefix}${ontologyId}/${suffix}`))} target="_blank" rel="noopener noreferrer">
        {label} ↗
      </a>
    ) : null;

  switch (id) {
    case 'browser':
      return (
        <Detail title="Request from the browser" links={null}>
          {req ? (
            <dl className="kv">
              <dt>route</dt>
              <dd>
                <code>POST /api/vision/classify</code>
              </dd>
              <dt>ontology</dt>
              <dd>
                {req.ontologyUpload ? (
                  <>
                    <code>owl_text</code>: {req.ontologyFile} uploaded with the request (never stored)
                  </>
                ) : (
                  <>
                    <code>ontology_id: "{req.ontologyId}"</code>, resolved on the server
                  </>
                )}
              </dd>
              <dt>image</dt>
              <dd>
                {req.example ? (
                  <>
                    <code>example: "{req.example}"</code>, read from S3 by the Lambda. Only the name travels in the request.
                  </>
                ) : (
                  <>
                    <code>image_base64</code>: {req.imageLabel}, {(req.imageBytes / 1024).toFixed(0)} KB in the request body
                  </>
                )}
              </dd>
              <dt>model · caching</dt>
              <dd>
                {models.find((m) => m.id === req.modelId)?.name ?? req.modelId} ·{' '}
                {!req.promptCaching ? 'prompt caching off' : models.find((m) => m.id === req.modelId)?.explicit_cache ? 'prompt caching on: a cache checkpoint after the ontology' : 'no cache checkpoint: this model caches on its own or not at all'}
              </dd>
              <dt>headers</dt>
              <dd>
                <code>authorization</code> = the SigV4 signature, with <code>x-amz-date</code>, <code>x-amz-security-token</code> and <code>x-amz-content-sha256</code> (the body&apos;s SHA-256)
              </dd>
            </dl>
          ) : (
            <p className="muted">Run a model. This box then describes the request it sent.</p>
          )}
        </Detail>
      );
    case 'cognito':
      return (
        <Detail title="Amazon Cognito" links={null}>
          <ul className="plain">
            <li>You sign in to the user pool. The identity pool exchanges your ID token for temporary AWS credentials of one IAM role, which may call this API&apos;s Lambda function URL and nothing else.</li>
            <li>
              The browser signs every request with those credentials (SigV4) and sends it to the function URL. Its auth type is <code>AWS_IAM</code>: Lambda runs the function only when IAM allows the signer. The function&apos;s code checks no token.
            </li>
            <li>The function stops at 115 s and a model call at 100 s, so a slow call ends with the API&apos;s own error. The large vision models take 20 to 65 s per image.</li>
          </ul>
        </Detail>
      );
    case 's3-ontology':
      return (
        <Detail title="Amazon S3: the ontology" links={s3Link('', 'Open this ontology in the S3 console')}>
          <dl className="kv">
            <dt>location</dt>
            <dd>
              {s3 ? (
                <code>
                  {s3.uri}
                  {ontologyId}/
                </code>
              ) : (
                '…'
              )}
            </dd>
            {detail && (
              <>
                <dt>file</dt>
                <dd>
                  <code>{detail.file || 'uploaded'}</code> · {detail.format || 'rdf'} · {detail.stats.triples?.toLocaleString()} triples · {detail.stats.classes} classes · {detail.stats.individuals} values
                </dd>
              </>
            )}
            <dt>read</dt>
            <dd>
              <code>GetObject</code> on every classify request, then rdflib parses it (~50 ms)
              {s3 && (
                <>
                  {' '}
                  · the API re-reads the bucket listing ({s3.objects} objects) every 60 s, so a new ontology folder appears without a redeploy
                  {s3.error && <span className="error"> last listing error: {s3.error}</span>}
                </>
              )}
            </dd>
            <dt>then</dt>
            <dd>classes, properties and named individuals as plain dicts, which become the system prompt in step 3</dd>
          </dl>
        </Detail>
      );
    case 's3-images':
      return (
        <Detail title="Amazon S3: example images" links={s3Link('examples/images/', 'Open the example images folder in the S3 console')}>
          <dl className="kv">
            <dt>location</dt>
            <dd>
              <code>
                {s3 ? s3.uri : arch?.ontologies.dir + '/'}
                {ontologyId}/examples/images/
              </code>{' '}
              or a data set&apos;s <code>{ontologyId}/datasets/&lt;set&gt;/examples/images/</code>
            </dd>
            <dt>examples</dt>
            <dd>
              {detail ? `${detail.examples_list.length} synthetic images (+ manifest.json with the generation prompts)` : '…'}
            </dd>
            <dt>read</dt>
            <dd>
              <code>GetObject</code> for the photo the request names. The raw bytes go into the Converse request (step 3).
            </dd>
            <dt>uploads</dt>
            <dd>Your own photos never go to S3. They travel base64-encoded in the request body and stay in memory.</dd>
          </dl>
        </Detail>
      );
    case 'lambda':
      return (
        <Detail
          title="AWS Lambda: latest call"
          links={
            <>
              {consoleLink('lambda', 'Open the function code')}
              {consoleLink('lambda_monitoring', 'Monitoring')}
              {consoleLink('log_group', 'Open the log group')}
            </>
          }
        >
          <LambdaStats latest={latest} latestResult={latestResult} arch={arch} />
          <LogDump inv={inv} arch={arch} />
        </Detail>
      );
    case 'bedrock':
      return (
        <Detail title="Amazon Bedrock: the models called so far" links={consoleLink('bedrock', 'Open the Bedrock model catalog')}>
          <BedrockStats runs={runs} models={models} region={arch?.region} />
        </Detail>
      );
    case 'cloudwatch':
      return (
        <Detail title="Amazon CloudWatch Logs" links={consoleLink('log_group', 'Open the log group')}>
          <p className="muted" style={{ marginTop: 0 }}>
            {`Every invocation writes START, the application's log lines and a REPORT line (duration, billed duration, memory) to ${arch?.function.log_group ?? "the function's log group"}. The API reads back its own log group, filtered by request id.`}
          </p>
          <LogDump inv={inv} arch={arch} />
        </Detail>
      );
    case 'output':
      return (
        <Detail title="The validated answer: latest call" links={null}>
          {latestResult ? (
            <>
              <dl className="kv">
                <dt>entities</dt>
                <dd>
                  {latestResult.entities.length} with {latestResult.entities.filter((e) => e.bbox).length} boxes · {latestResult.entities.reduce((n, e) => n + e.parts.length, 0)} parts · {latestResult.issues.length} validation issue
                  {latestResult.issues.length === 1 ? '' : 's'} · {latestResult.feedback.length} ontology suggestion{latestResult.feedback.length === 1 ? '' : 's'}
                </dd>
                <dt>usage</dt>
                <dd>
                  <code>{JSON.stringify(latestResult.usage)}</code>
                </dd>
                <dt>stop reason</dt>
                <dd>{latestResult.stop_reason || 'n/a'}</dd>
                <dt>invocation</dt>
                <dd>{inv ? <code>{inv.request_id}</code> : 'n/a'}</dd>
              </dl>
              <p className="muted">
                Every class, attribute value and part name was resolved against the ontology before it reached the browser. The boxes are drawn from <code>bbox</code> on a 0–1000 scale.
              </p>
            </>
          ) : (
            <p className="muted">Run a model to see the response here.</p>
          )}
        </Detail>
      );
  }
}

function LambdaStats({ latest, latestResult, arch }: { latest: RunRow | undefined; latestResult: ClassifyResult | null; arch: Architecture | null }) {
  const inv = latestResult?.invocation;
  if (!latest) return <p className="muted">No call yet. Press Classify, then come back here.</p>;
  const st = latest.state;
  const wall = st.status !== 'running' ? st.finishedAt - st.startedAt : 0;
  const model = latestResult?.metrics.latency_ms ?? 0;
  return (
    <div className="stat-strip small">
      <Stat label="request id" value={inv?.request_id ?? (st.status === 'error' ? 'error' : 'n/a')} mono />
      <Stat label="start" value={inv?.cold_start ? 'cold' : 'warm'} hint="cold = this container's first invocation (imports, S3 sync, rdflib parse)" />
      <Stat label="handler" value={inv ? `${inv.handler_ms.toLocaleString()} ms` : 'n/a'} hint="time inside the Lambda handler" />
      <Stat label="of which model" value={model ? `${model.toLocaleString()} ms` : 'n/a'} hint="Bedrock Converse latency (metrics.latencyMs)" />
      <Stat label="round trip" value={wall ? `${wall.toLocaleString()} ms` : 'n/a'} hint="measured in the browser: function URL + Lambda + Bedrock" />
      <Stat label="memory" value={inv?.memory_mb ? `${inv.memory_mb} MB` : arch?.function.memory_mb ? `${arch.function.memory_mb} MB` : 'n/a'} />
      <Stat label="runtime" value={inv ? (arch?.function.runtime?.replace('AWS_Lambda_', '') ?? 'lambda') : 'n/a'} />
    </div>
  );
}

function LogDump({ inv, arch }: { inv: ClassifyResult['invocation'] | undefined; arch: Architecture | null }) {
  const { logs, loading, error, refresh } = useLogs(inv?.request_id, inv?.log_stream, arch?.logs.enabled !== false);
  if (!inv) return null;
  if (arch && !arch.logs.enabled) return <p className="muted">Log access is off on this deployment. Deploy with -c explorerLogs=true to show the request's log lines here.</p>;
  const report = logs?.report;
  return (
    <div className="log-dump">
      <div className="row" style={{ alignItems: 'center', marginBottom: '0.3rem' }}>
        <span className="muted" style={{ flex: '1 1 auto' }}>
          Log lines of request <code>{inv.request_id}</code>
          {logs && <> · from {logs.source === 'cloudwatch' ? 'CloudWatch Logs' : 'the container’s in-memory buffer'}</>}
          {logs?.pending && <> · REPORT line not delivered yet (CloudWatch delivers it a few seconds after the call)</>}
          {loading && <span className="spinner" />}
        </span>
        <button className="small secondary" style={{ flex: '0 0 auto' }} onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>
      {report && (
        <div className="stat-strip small">
          <Stat label="duration" value={`${Math.round(report.duration_ms).toLocaleString()} ms`} />
          <Stat label="billed" value={`${report.billed_ms.toLocaleString()} ms`} />
          <Stat label="max memory used" value={`${report.max_memory_used_mb} / ${report.memory_mb} MB`} />
          <Stat label="init" value={report.init_ms ? `${Math.round(report.init_ms).toLocaleString()} ms` : 'n/a'} hint="cold-start initialisation" />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {logs?.error && <p className="muted">CloudWatch could not be read ({logs.error}). Showing the container buffer instead.</p>}
      <pre className="code-block logs">
        {logs && logs.events.length
          ? logs.events.map((e) => `${e.ts ? new Date(e.ts).toISOString().slice(11, 23) : '            '}  ${e.message}`).join('\n')
          : loading
            ? 'loading…'
            : 'no log events yet. Press Refresh in a few seconds.'}
      </pre>
    </div>
  );
}

function useLogs(requestId: string | undefined, logStream: string | null | undefined, enabled: boolean) {
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const attempts = useRef(0);
  const load = useCallback(() => {
    if (!requestId || !enabled) return;
    setLoading(true);
    setError('');
    api
      .logs(requestId, logStream)
      .then((r) => {
        setLogs(r);
        // CloudWatch is eventually consistent: poll a few times until the REPORT line has landed.
        if (r.pending && attempts.current < 4) {
          attempts.current += 1;
          setTimeout(load, 2500);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [requestId, logStream, enabled]);
  useEffect(() => {
    attempts.current = 0;
    setLogs(null);
    const t = setTimeout(load, 800); // give the platform a moment before the first read
    return () => clearTimeout(t);
  }, [load]);
  return { logs, loading, error, refresh: () => { attempts.current = 0; load(); } };
}

function BedrockStats({ runs, models, region }: { runs: RunRow[]; models: VisionModel[]; region?: string }) {
  const done = runs.filter((r) => r.state.status === 'done') as (RunRow & { state: { status: 'done'; result: ClassifyResult; finishedAt: number } })[];
  if (!done.length) return <p className="muted">No model has been called yet. Each call will appear here with its latency and its cached and uncached token usage.</p>;
  type Agg = { model: VisionModel; calls: number; latency: number[]; input: number; cacheRead: number; cacheWrite: number; output: number };
  const agg = new Map<string, Agg>();
  for (const r of done) {
    const m = r.state.result.metrics;
    const a = agg.get(r.modelId) ?? { model: r.state.result.model, calls: 0, latency: [], input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    a.calls += 1;
    a.latency.push(m.latency_ms);
    a.input += m.input_tokens;
    a.cacheRead += m.cache_read_tokens;
    a.cacheWrite += m.cache_write_tokens;
    a.output += m.output_tokens;
    agg.set(r.modelId, a);
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  const rows = Array.from(agg.values()).sort((a, b) => a.model.name.localeCompare(b.model.name));
  const total = rows.reduce((s, a) => s + a.calls, 0);
  const checkpoint = models.filter((m) => m.explicit_cache);
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {total} call{total === 1 ? '' : 's'} across {rows.length} model{rows.length === 1 ? '' : 's'}
        {region ? ` in ${region}` : ''} (all images and ontologies in this tab). Token counts come from the Converse <code>usage</code> block. “Cached” means <code>cacheReadInputTokens</code>, the prefix the model did not process again.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="metrics">
          <thead>
            <tr>
              <th>Model</th>
              <th>Calls</th>
              <th>Latency avg</th>
              <th>Input uncached</th>
              <th>Cache read</th>
              <th>Cache write</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.model.id} className="static">
                <td>
                  {a.model.name}
                  <div className="muted">
                    <code>{a.model.id}</code>
                  </div>
                </td>
                <td>{a.calls}</td>
                <td>{(avg(a.latency) / 1000).toFixed(1)} s</td>
                <td>{Math.round(a.input / a.calls).toLocaleString()}</td>
                <td className={a.cacheRead ? 'good' : ''}>{Math.round(a.cacheRead / a.calls).toLocaleString()}</td>
                <td>{Math.round(a.cacheWrite / a.calls).toLocaleString()}</td>
                <td>{Math.round(a.output / a.calls).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        {checkpoint.length} of the {models.length} offered models take a cache checkpoint
        {checkpoint.length ? `: ${checkpoint.map((m) => (m.cache_min_tokens ? `${m.name} (from ${m.cache_min_tokens.toLocaleString('en-US')} tokens of prefix)` : m.name)).join(', ')}` : ''}. The others get no
        checkpoint and cache a repeated prefix on their own or not at all. Model ids starting with <code>global.</code> are cross-Region inference profiles.
      </p>
    </>
  );
}
