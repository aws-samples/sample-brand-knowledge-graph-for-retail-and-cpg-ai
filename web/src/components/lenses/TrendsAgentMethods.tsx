// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useContext, useEffect, useMemo, useState } from 'react';
import { api, type Health, type LakeStatus, type VisionModel } from '../../api';
import { AgentAnswer } from '../query/GraphQuery';
import { agentSessionId } from '../query/queryView';
import { Lead } from '../retriever/Callouts';
import { AnswerText } from '../shared/AnswerText';
import { OpenTabContext } from '../shared/NextTab';
import { useNow } from '../shared/useNow';
import { AgentDeepDive, useAgentChoice } from './AgentDeepDive';
import { agentPromptSnippet } from './agentPrompt';
import { agentProgress, askAgent } from './agentMethods';
import { effortText } from './effort';
import { agentOff, lakeOff, NO_QUERY, noAnswer, NOTHING_NEW, TRENDS_METHODS } from './lenses';
import { setLakeExport, type AgentMethodId, type AgentRun, type LakeExportRun, type MethodEntry } from './trendsCache';
import { TrendsAgentsHowItWorks, type AgentsCtx } from './TrendsAgentsArchitecture';
import { POLL_MS } from './trendsJob';
import { GroupsTable, IDLE, MetricLine, type Run } from './trendsPieces';

/**
 * Methods 1 and 2 of "What are the emerging trends we see this season?": each a card with its
 * lead and definition of new against old, its run controls, the result (the agent's answer, the
 * groups counted again in code, the agent's trace, the question it got), its deep dive (the
 * agent's model and reasoning effort) and its How it works. The runs live in trendsCache, so they
 * survive a tab switch and a reload.
 */

/** Method 1 · Ask the graph agent (the Neptune MCP server). `health.query_agent` says whether the agent is available. */
export function GraphAgentMethod({ health, entry }: { health: Health | null; entry: MethodEntry | null }) {
  const choice = useAgentChoice('graph');
  const [open, setOpen] = useState(false);
  const running = entry?.status === 'running';
  const now = useNow(running);
  const ready = !!health?.query_agent?.available;
  const done = entry?.status === 'done' ? entry : null;
  const run = done?.result ?? null;
  const prompt = useMemo(() => (run?.agent ? agentPromptSnippet('graph', run.question, run.agent.model.name) : null), [run]);
  const ctx: AgentsCtx = {
    busy: running ? 'agent' : '',
    detail: {
      neptune: run ? `${run.totals.new_items} new items · ${run.totals.base} lookbook garments` : undefined,
      agent: run ? `${run.metrics.llm_calls} turns · ${run.metrics.tool_calls ?? 0} tool calls` : undefined,
    },
  };
  const m = TRENDS_METHODS.graph;
  return (
    <section className="card ln-method" aria-labelledby="ln-method-graph">
      <h3 id="ln-method-graph">{m.title}</h3>
      <Lead>{m.lead}</Lead>
      <p className="small ln-method-def">
        <b>New against old:</b> {m.definition}
      </p>
      {health && !ready && <p className="notice text">{agentOff(health.query_agent?.reason || 'it needs Neptune Analytics (tab 0)')}</p>}
      <div className="row trend-controls">
        <button onClick={() => askAgent('graph', choice.modelId, choice.effort)} disabled={running || !ready || !choice.modelId} title="Sends the definition of emerging, in plain words, to the agent">
          Ask the graph agent
        </button>
        <Asking model={choice.model} effort={choice.effort} />
      </div>
      {running && (
        <p className="muted" role="status">
          <span className="spinner" /> {agentProgress(entry.step)} · {((now - entry.startedAt) / 1000).toFixed(0)} s
        </p>
      )}
      {entry?.status === 'error' && <MethodError entry={entry} method="graph" />}
      {done && run && <AgentRunView run={run} ms={done.ms} models={choice.models} what="the agent" />}
      <AgentDeepDive id="ln-trends-graph" model={choice.model} modelId={choice.modelId} effort={choice.effort} onModel={choice.setModelId} onEffort={choice.setEffort} disabled={running} />
      <div className="method-explainer">
        <TrendsAgentsHowItWorks method="graph" ctx={ctx} finishedAt={done?.at} open={open} onToggle={setOpen} extra={prompt} />
      </div>
    </section>
  );
}

/**
 * Method 2 · Export to Iceberg, ask the data agent (the S3 Tables MCP server). The lakehouse's
 * status (`GET /api/trends/lake`) is read on mount and when the graph changes; the export is
 * remembered next to the agent's run.
 */
export function LakeAgentMethod({ entry, exported, dataVersion }: { entry: MethodEntry | null; exported: LakeExportRun | null; dataVersion: number }) {
  const choice = useAgentChoice('lake');
  const [status, setStatus] = useState<LakeStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [exp, setExp] = useState<Run<null>>(IDLE);
  const [open, setOpen] = useState(false);
  const running = entry?.status === 'running';
  const exporting = exp.status === 'running';
  const now = useNow(running || exporting);

  const refresh = () =>
    api
      .trendLake()
      .then((s) => (setStatus(s), setStatusError('')))
      .catch((e) => setStatusError(e.message));
  useEffect(() => {
    refresh();
  }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportTables() {
    setExp({ status: 'running', startedAt: Date.now() });
    const t0 = performance.now();
    try {
      const result = await api.trendLakeExport(agentSessionId());
      setLakeExport({ result, ms: performance.now() - t0, at: Date.now() });
      setExp(IDLE);
      refresh();
    } catch (e: any) {
      setExp({ status: 'error', error: e.message });
    }
  }

  const tables = status?.tables ?? {};
  const written = Object.values(tables).filter((t) => t.modified_at);
  const lastWritten = written.length ? new Date(Math.max(...written.map((t) => Date.parse(t.modified_at!)))).toLocaleString() : '';
  const ready = !!status?.configured && !!status?.available;
  const done = entry?.status === 'done' ? entry : null;
  const run = done?.result ?? null;
  const prompt = useMemo(() => (run?.agent && run.question ? agentPromptSnippet('lake', run.question, run.agent.model.name) : null), [run]);
  const ctx: AgentsCtx = {
    busy: exporting ? 'export' : running ? 'ask' : '',
    detail: {
      s3tables: exported ? `${Object.entries(exported.result.tables).map(([n, t]) => `${n} ${t.rows}`).join(' · ')} rows` : undefined,
      agent: status?.host === 'agentcore' ? 'export · Converse tool loop (job)' : status?.host === 'in-process' ? 'in the API process' : undefined,
      mcp: run ? `${run.metrics.tool_calls ?? 0} query_database call${run.metrics.tool_calls === 1 ? '' : 's'}` : undefined,
    },
  };
  const m = TRENDS_METHODS.lake;
  return (
    <section className="card ln-method" aria-labelledby="ln-method-lake">
      <h3 id="ln-method-lake">{m.title}</h3>
      <Lead>{m.lead}</Lead>
      <p className="small ln-method-def">
        <b>New against old:</b> {m.definition}
      </p>
      {statusError && <p className="error">{statusError}</p>}
      {status && !ready && <p className="notice text">{lakeOff(status.reason || 'the stack creates it')}</p>}
      {status?.configured && (
        <p className="muted trend-lake-status">
          <code>{status.table_bucket_arn}</code> · namespace <code>{status.namespace}</code> ·{' '}
          {Object.entries(tables)
            .map(([n, t]) => `${n}: ${t.exists ? (t.modified_at ? `written ${new Date(t.modified_at).toLocaleString()}` : 'exists') : 'missing'}`)
            .join(' · ')}{' '}
          · agent {status.host === 'agentcore' ? 'on its AgentCore Runtime' : 'in the API process'}
        </p>
      )}
      <div className="row trend-controls">
        <button className="secondary" onClick={exportTables} disabled={!ready || exporting || running}>
          Export the graph to Iceberg tables
        </button>
        <button
          onClick={() => askAgent('lake', choice.modelId, choice.effort)}
          disabled={!ready || exporting || running || !choice.modelId}
          title={lastWritten ? `The data agent queries the tables, last written ${lastWritten}` : 'The tables have not been written yet: export the graph first'}
        >
          Ask the data agent
        </button>
        <Asking model={choice.model} effort={choice.effort} />
      </div>
      {exp.status === 'running' && (
        <p className="muted" role="status">
          <span className="spinner" /> reading the graph, writing both tables … {((now - exp.startedAt) / 1000).toFixed(0)} s
        </p>
      )}
      {exp.status === 'error' && <p className="error">{exp.error}</p>}
      {exported && (
        <div className="ask-metrics">
          <span>export {(exported.ms / 1000).toFixed(1)} s</span>
          <span>read the graph {(exported.result.metrics.read_ms / 1000).toFixed(1)} s</span>
          <span>
            write {(exported.result.metrics.write_ms / 1000).toFixed(1)} s ({exported.result.runtime?.host === 'agentcore' ? "the lake agent's runtime" : 'this process'})
          </span>
          <span>
            {Object.entries(exported.result.tables)
              .map(([n, t]) => `${n} ${t.rows.toLocaleString()} rows`)
              .join(' · ')}
          </span>
        </div>
      )}
      {running && (
        <p className="muted" role="status">
          <span className="spinner" /> The data agent is writing and running SQL (a background job, polled every {POLL_MS / 1000} s) … {((now - entry.startedAt) / 1000).toFixed(0)} s
        </p>
      )}
      {entry?.status === 'error' && <MethodError entry={entry} method="lake" />}
      {done && run && <AgentRunView run={run} ms={done.ms} models={choice.models} what="the data agent" />}
      <AgentDeepDive id="ln-trends-lake" model={choice.model} modelId={choice.modelId} effort={choice.effort} onModel={choice.setModelId} onEffort={choice.setEffort} disabled={running} />
      <div className="method-explainer">
        <TrendsAgentsHowItWorks method="lake" ctx={ctx} finishedAt={done?.at ?? exported?.at} open={open} onToggle={setOpen} extra={prompt} />
      </div>
    </section>
  );
}

/** Next to the button: the model and effort the next run asks for (set in the deep dive). */
function Asking({ model, effort }: { model: VisionModel | undefined; effort: string | null }) {
  if (!model) return null;
  return (
    <span className="muted small">
      {model.name} · effort {effortText(effort, model)}
    </span>
  );
}

/** A failed run: no new items in the graph (409) asks for tab 2's first batch; anything else as it came. */
export function MethodError({ entry, method }: { entry: Extract<MethodEntry, { status: 'error' }>; method: AgentMethodId }) {
  const openTab = useContext(OpenTabContext);
  if (entry.code === 409 && /new items/i.test(entry.error))
    return (
      <p className="notice text">
        {NOTHING_NEW}{' '}
        <button className="small" onClick={() => openTab('ingest')}>
          Open tab 2
        </button>
      </p>
    );
  if (entry.code === 409 && method === 'graph') return <p className="notice text">{agentOff(entry.error)}</p>;
  return <p className="error">{entry.error}</p>;
}

/**
 * A finished run of either agent: its numbers (the model and effort that ran, from the backend),
 * the agent's answer, the groups counted again in code, the query that answered with its rows,
 * the trace, and the exact question it got.
 */
export function AgentRunView({ run, ms, models, what }: { run: AgentRun; ms: number; models: VisionModel[]; what: string }) {
  const agent = run.agent;
  const model = models.find((x) => x.id === agent?.model.id);
  const t = run.totals;
  const lastTurn = agent?.steps.filter((s) => s.kind === 'model').at(-1);
  return (
    <div className="ln-method-result">
      <MetricLine
        m={run.metrics}
        wall={ms}
        model={agent?.model.name}
        effort={effortText(agent?.effort, model)}
        extra={`${t.new} new pieces of content (${t.new_items} items) · ${t.base} lookbook garments${t.left_out.length ? ` · not compared: ${t.left_out.join(', ')}` : ''} · ${agent?.runtime?.host === 'agentcore' ? 'on AgentCore Runtime' : 'in the API process'}`}
      />
      <div className="po-sec-label">The answer</div>
      {agent?.answer ? <AnswerText text={agent.answer} active={null} onCite={() => undefined} /> : <p className="muted">{noAnswer(lastTurn?.stop_reason)}</p>}
      <div className="po-sec-label">The groups, counted again in code</div>
      {run.groups.length ? (
        <GroupsTable groups={run.groups} />
      ) : agent && !agent.query ? (
        <p className="muted">{NO_QUERY}</p>
      ) : (
        <p className="muted">No group: the rows of {what} name no vocabulary node. See its query below.</p>
      )}
      {agent && <AgentAnswer result={agent} showAnswer={false} traceOpen readable={model?.reasoning?.readable} />}
      {run.question && (
        <details className="agent-question">
          <summary className="muted">The question it got</summary>
          <pre className="code-block">{run.question}</pre>
        </details>
      )}
    </div>
  );
}
