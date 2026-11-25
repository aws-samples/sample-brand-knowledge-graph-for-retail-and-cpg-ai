// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Architecture, OntologyDetail, RunStatus, VisionModel } from '../../api';
import { ConsoleLink, Detail, Stat } from '../arch/panelBits';
import type { NodeId } from './PipelinePanel';
import { deltaRows, elapsedLabel, progressOf, rowsOf, tokenTotals } from './runView';

/** The detail box under tab 2's diagram, per selected node: what that service did in the run being watched. */
export function PipelineDetails({ id, arch, status, models, detail }: { id: NodeId; arch: Architecture | null; status: RunStatus | null; models: VisionModel[]; detail: OntologyDetail | null }) {
  const p = arch?.pipeline;
  const ex = status?.execution;
  const rows = rowsOf(status);
  const records = status?.records.filter((r) => r.result) ?? [];
  const runPrefix = status ? `runs/${status.run.run_id}/` : 'runs/<run>/';
  const latestOwl = [...(status?.records ?? [])].reverse().find((r) => r.owl)?.owl;
  const s3Link = (prefix: string, label: string) => (arch?.console.s3_prefix_template ? <ConsoleLink href={arch.console.s3_prefix_template.replace('{prefix}', encodeURIComponent(prefix))} label={label} /> : null);

  switch (id) {
    case 's3':
      return (
        <Detail title="Amazon S3: sources in, records out" links={<>{s3Link(runPrefix, 'Open this run in the S3 console')}{s3Link('uploads/', 'uploads/')}</>}>
          <dl className="kv">
            <dt>examples</dt>
            <dd>
              <code>
                {arch?.ontologies.kind === 's3' ? arch.ontologies.uri : arch?.ontologies.dir + '/'}
                {status?.run.ontology_id ?? detail?.id ?? '<domain>'}/examples/images/
              </code>{' '}
              holds the photos, and <code>examples/articles/</code> next to it holds the texts (a data set&apos;s are under <code>datasets/&lt;set&gt;/examples/</code>). The run references them by name, and the classify step reads them on the server.
            </dd>
            <dt>uploads</dt>
            <dd>
              <code>{p?.uploads ?? '…'}</code>: the files the browser sent, one folder per run. They expire after a day.
            </dd>
            <dt>records</dt>
            <dd>
              <code>{p?.records ?? '…'}</code>: <code>run.json</code>, then one <code>NN.json</code> per source when the ingest step finishes it, and <code>summary.json</code> at the end. They show the progress without touching the execution history.
              {status && (
                <>
                  {' '}
                  This run: {status.records.length} of {status.run.sources.length} records{status.summary ? ' + summary' : ''}.
                </>
              )}
            </dd>
          </dl>
        </Detail>
      );
    case 'sfn':
      return (
        <Detail
          title="AWS Step Functions: the execution"
          links={
            <>
              <ConsoleLink href={ex?.console_url} label="Open this execution" />
              <ConsoleLink href={arch?.console.state_machine} label="Open the state machine" />
            </>
          }
        >
          <div className="stat-strip small">
            <Stat label="status" value={ex?.status ?? 'n/a'} />
            <Stat label="sources" value={status ? `${progressOf(status).done} / ${progressOf(status).total}` : 'n/a'} hint="ingested or failed / total" />
            <Stat label="concurrency" value={p?.max_concurrency ?? 4} hint="MaxConcurrency of the Map state. It sets how many sources, and so how many Bedrock calls, run at once." />
            <Stat label="elapsed" value={elapsedLabel(ex?.started_at, ex?.stopped_at)} />
          </div>
          {ex?.error && <p className="error" role="alert">{ex.error}</p>}
        </Detail>
      );
    case 'classify':
      return (
        <Detail title="Lambda · classify: this run" links={<ConsoleLink href={arch?.console.pipeline_lambda} label="Open the pipeline function" />}>
          {records.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="metrics compact">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Latency</th>
                    <th>Input</th>
                    <th>Cache read</th>
                    <th>Cache write</th>
                    <th>Output</th>
                    <th>Entities</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const m = r.result!.metrics;
                    return (
                      <tr key={r.index} className="static">
                        <td>
                          <span className="muted">{r.kind === 'image' ? 'photo' : 'text'}</span> {r.label}
                        </td>
                        <td>{(m.latency_ms / 1000).toFixed(1)} s</td>
                        <td>{m.input_tokens.toLocaleString()}</td>
                        <td className={m.cache_read_tokens ? 'good' : ''}>{m.cache_read_tokens.toLocaleString()}</td>
                        <td>{m.cache_write_tokens.toLocaleString()}</td>
                        <td>{m.output_tokens.toLocaleString()}</td>
                        <td>{r.result!.entities.length}</td>
                        <td>{r.result!.issues.length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No source is classified yet. Each row will show the Converse usage block: the fresh input tokens and the ontology prefix tokens read from the cache.</p>
          )}
          <p className="muted">
            The system prompt is the ontology, and it is the same for every source. For the models that take a cache checkpoint (Claude, Amazon Nova, and GPT-6 and later), the first call writes it to the cache and the other calls read it. What each source adds to the cost is its photo or text plus the answer. A text goes through the same prompt, with its <code>bbox</code> set to null.
          </p>
        </Detail>
      );
    case 'bedrock':
      return (
        <Detail title="Amazon Bedrock: one vision model, one embedding model" links={<ConsoleLink href={arch?.console.bedrock} label="Open the model catalog" />}>
          <dl className="kv">
            <dt>classification</dt>
            <dd>
              {status ? (
                <>
                  <b>{models.find((m) => m.id === status.run.model_id)?.name ?? status.run.model_id}</b> <code>{status.run.model_id}</code> · prompt caching {status.run.prompt_caching ? 'on' : 'off'} · Converse API on <code>bedrock-runtime</code>
                </>
              ) : (
                <>the model picked in the toolbar, through the Converse API</>
              )}
            </dd>
            <dt>embeddings</dt>
            <dd>
              <code>{p?.embedding_model_id ?? 'amazon.nova-2-multimodal-embeddings-v1:0'}</code>: it embeds the text of every Item and Statement, and the photo itself for a Look. Images and text share one vector space.
            </dd>
            {status && (
              <>
                <dt>this run</dt>
                <dd>
                  {tokenTotals(status).calls} classify call{tokenTotals(status).calls === 1 ? '' : 's'} · {tokenTotals(status).input.toLocaleString()} fresh input tokens · {tokenTotals(status).cacheRead.toLocaleString()} read from the cache · {tokenTotals(status).cacheWrite.toLocaleString()} written · {tokenTotals(status).output.toLocaleString()} output
                </dd>
              </>
            )}
          </dl>
        </Detail>
      );
    case 'ingest':
      return (
        <Detail title="Lambda · ingest: this run" links={<ConsoleLink href={arch?.console.pipeline_lambda} label="Open the pipeline function" />}>
          {rows.some((r) => r.record?.ingest) ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="metrics compact">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Items</th>
                    <th>Context</th>
                    <th>Skipped</th>
                    <th>Ingest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.record?.ingest)
                    .map((r) => {
                      const ing = r.record!.ingest!;
                      return (
                        <tr key={r.index} className="static">
                          <td>{r.label}</td>
                          <td>
                            {ing.items.length} · {ing.items.reduce((n, i) => n + Object.keys(i.attributes).length, 0)} values · {ing.items.reduce((n, i) => n + i.parts.length, 0)} parts
                          </td>
                          <td>{ing.look ? 'Look CONTAINS' : ing.article ? 'Article → Statement ILLUSTRATES' : 'n/a'}</td>
                          <td className={ing.skipped.length ? 'warn' : ''}>{ing.skipped.length}</td>
                          <td>{(ing.ms.ingest / 1000).toFixed(1)} s</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No source ingested yet.</p>
          )}
          {latestOwl ? (
            <>
              <p className="muted" style={{ marginBottom: '0.3rem' }}>
                This is what the latest source became before it was written: OWL individuals of the ontology, in Turtle. Its run record keeps a copy.
              </p>
              <pre className="owl-turtle">{latestOwl}</pre>
            </>
          ) : (
            <p className="muted">Start a run to see, in Turtle, the OWL individuals that each source becomes.</p>
          )}
        </Detail>
      );
    case 'neptune':
      return (
        <Detail title="Amazon Neptune Analytics: the graph" links={<ConsoleLink href={arch?.console.neptune} label="Open Neptune in the console" />}>
          <dl className="kv">
            <dt>graph</dt>
            <dd>{arch?.graph.graph_id ? <code>{arch.graph.graph_id}</code> : '…'}</dd>
            <dt>how</dt>
            <dd>
              openCypher over the <code>neptune-graph</code> API (<code>ExecuteQuery</code>, SigV4). It needs no driver. Deployed, the call goes from the stack's private subnets to the graph's private endpoint. Nodes and edges go in with <code>UNWIND $rows … MERGE</code>, in batches of 200. Vectors go in with <code>neptune.algo.vectors.upsert</code>, in batches of 25.
            </dd>
          </dl>
          {status?.summary ? (
            <table className="metrics compact">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>before</th>
                  <th>after</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {deltaRows(status.summary.graph.before, status.summary.graph.after)
                  .filter((d) => d.delta !== 0)
                  .map((d) => (
                    <tr key={d.label} className="static">
                      <td>
                        <span className={`pill ${d.label}`}>{d.label}</span>
                      </td>
                      <td>{d.before.toLocaleString()}</td>
                      <td>{d.after.toLocaleString()}</td>
                      <td className="good">+{d.delta}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">The node counts before and after the run appear here once the summary step has run.</p>
          )}
        </Detail>
      );
    case 'summary':
      return (
        <Detail title="Lambda · summarize: this run" links={null}>
          {status?.summary ? (
            <ul className="plain">
              <li>
                <b>{status.summary.added.items}</b> items, {status.summary.added.looks} looks, {status.summary.added.articles} articles from {status.summary.sources.ingested} of {status.summary.sources.total} sources. {status.summary.added.skipped_entities} entities skipped, {status.summary.added.validation_issues} values dropped.
              </li>
              <li>
                <b>{status.summary.shared.length}</b> vocabulary nodes referenced by more than one new item: the shared categories, values and components.
              </li>
              <li>
                <b>{status.summary.feedback.length}</b> distinct ontology suggestions, with the ones reported by several sources first.
              </li>
            </ul>
          ) : (
            <p className="muted">This step runs once and gets the compact result of every iteration. It reports the node counts before and after, what the sources share, and the ontology feedback across the batch. It writes <code>summary.json</code> and returns it as the execution output.</p>
          )}
        </Detail>
      );
  }
}
