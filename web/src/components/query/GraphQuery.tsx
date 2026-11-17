// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, type AgentResult, type Health, type QueryResult } from '../../api';
import { AgentTrace } from '../shared/AgentTrace';
import { useKept } from '../shared/kept';
import { ModelSelect } from '../shared/ModelSelect';
import { useModelChoice } from '../shared/useModels';
import { useNow } from '../shared/useNow';
import { useStoredFlag } from '../shared/useStoredChoice';
import { YourTurn } from '../retriever/Callouts';
import { GROUP_LABEL, type QueryExample, type QueryGroup } from './examples';
import { QueryArchitecture } from './QueryArchitecture';
import { agentSessionId, agentSummary, columnsOf, failedQueries, formatCell, handOver, runtimeLine } from './queryView';

const MODEL_KEY = 'query.model';
const IDLE = { status: 'idle' } as const;
const FALLBACK_KEY = 'query.fallback';

type Direct = { status: 'idle' } | { status: 'running' } | { status: 'done'; result: QueryResult } | { status: 'error'; error: string; code?: number };
type Agent =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; why: 'failed' | 'asked' }
  | { status: 'done'; result: AgentResult; why: 'failed' | 'asked' }
  | { status: 'error'; error: string };

/**
 * Query the graph: openCypher as typed, run on Neptune Analytics. When Neptune rejects the text (a
 * typo, a Neo4j-only function, or a question in plain words), the text and Neptune's message go to
 * an agent that works through the Amazon Neptune MCP server (query_agent.py): it reads the schema,
 * writes a read-only query, runs it, reads the error and fixes the query until it runs. The agent
 * runs on Amazon Bedrock AgentCore Runtime, one session per browser tab (agentSessionId).
 */
export function GraphQuery({
  title,
  intro,
  examples,
  dataVersion = 0,
  guided = false,
}: {
  title: string;
  intro?: ReactNode;
  examples: QueryExample[];
  dataVersion?: number;
  /** The explorer's step 3: 3a openCypher, 3b plain words, one editor; the options folded away. */
  guided?: boolean;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [graphId, setGraphId] = useState('');
  // the text, the way (3a to 3c) and both results are kept across tab switches and reloads (kept.ts)
  const kept = `query.${title}.`;
  const [text, setText] = useKept(`${kept}text`, examples[0]?.text ?? '');
  const { models, modelId, setModelId, error: modelsError } = useModelChoice('answer', MODEL_KEY);
  const [fallback, setFallback] = useStoredFlag(FALLBACK_KEY, true);
  const [direct, setDirect] = useKept<Direct>(`${kept}direct`, IDLE);
  const [agent, setAgent] = useKept<Agent>(`${kept}agent`, IDLE);
  const [ranText, setRanText] = useKept(`${kept}ran`, '');
  const [finishedAt, setFinishedAt] = useState<number>();
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState('');
  // the agent's elapsed time, while it works
  const now = useNow(agent.status === 'running');

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api
      .architecture()
      .then((a) => setGraphId(a.graph.graph_id ?? ''))
      .catch(() => undefined);
  }, [dataVersion]);

  const neptune = health?.graph_backend === 'neptune';
  const agentReady = !!health?.query_agent?.available;
  const onAgentCore = health?.query_agent?.host === 'agentcore';
  const busy = direct.status === 'running' || agent.status === 'running';

  async function askAgent(q: string, neptuneError: string | null, why: 'failed' | 'asked') {
    setAgent({ status: 'running', startedAt: Date.now(), why });
    try {
      const result = await api.graphAgent(q, neptuneError, modelId, agentSessionId());
      setAgent({ status: 'done', result, why });
    } catch (e: any) {
      setAgent({ status: 'error', error: e.message });
    } finally {
      setFinishedAt(Date.now());
    }
  }

  async function run() {
    const q = text.trim();
    if (!q) return;
    setRanText(q);
    setAgent({ status: 'idle' });
    setDirect({ status: 'running' });
    try {
      const result = await api.query(q);
      setDirect({ status: 'done', result });
      setFinishedAt(Date.now());
    } catch (e: any) {
      const code = e instanceof ApiError ? e.status : undefined;
      setDirect({ status: 'error', error: e.message, code });
      if (fallback && agentReady && handOver(code)) await askAgent(q, e.message, 'failed');
      else setFinishedAt(Date.now());
    }
  }

  function askDirectly() {
    const q = text.trim();
    if (!q) return;
    setRanText(q);
    setDirect({ status: 'idle' });
    askAgent(q, null, 'asked');
  }

  const groups = (Object.keys(GROUP_LABEL) as QueryGroup[]).filter((g) => examples.some((e) => e.group === g));
  const agentResult = agent.status === 'done' ? agent.result : null;
  const [way, setWay] = useKept<Way>(`${kept}way`, '3a');
  // a new way loads its first example into the editor
  const chooseWay = (w: Way) => {
    setWay(w);
    const first = examples.find((e) => GUIDED.find((g) => g.id === w)!.groups.includes(e.group));
    if (first) setText(first.text);
  };
  const chips = (pick: (e: QueryExample) => boolean) =>
    examples.filter(pick).map((e) => (
      <button key={e.title} className={`secondary small query-example kind-${e.kind}${text === e.text ? ' active' : ''}`} onClick={() => setText(e.text)} disabled={busy} title={e.text}>
        {e.title}
      </button>
    ));
  const editor = (
    <>
      <div className="field">
        <label htmlFor={`query-text-${title}`}>{guided ? 'The query, or your question (edit freely)' : 'openCypher, or a question in plain words (edit freely)'}</label>
        <textarea
          id={`query-text-${title}`}
          className="code"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy && run()}
          spellCheck={false}
        />
      </div>
    </>
  );
  // 3b asks in plain words, so the agent is the main way there; Run shows why it takes an agent
  const agentFirst = guided && way === '3b';
  const runButton = (
    <button className={agentFirst ? 'secondary' : undefined} onClick={run} disabled={busy || !text.trim() || !neptune} title="Run the text as openCypher (Ctrl/⌘ + Enter)">
      {direct.status === 'running' ? 'Running…' : 'Run'}
    </button>
  );
  const agentButton = (
    <button className={agentFirst ? undefined : 'secondary'} onClick={askDirectly} disabled={busy || !text.trim() || !agentReady || !modelId} title="Skips the openCypher attempt. The agent writes the query.">
      {agent.status === 'running' ? 'Agent working…' : 'Ask the agent'}
    </button>
  );
  const buttons = agentFirst ? (
    <>
      {agentButton}
      {runButton}
    </>
  ) : (
    <>
      {runButton}
      {agentButton}
    </>
  );
  // In 3b Neptune refusing the text is the expected first step before the agent, not an error
  const expectedRefusal = agentFirst && direct.status === 'error' && handOver(direct.code);
  const notices = (
    <>
      {health && neptune && !agentReady && <p className="notice text">The agent is off: {health.query_agent?.reason}</p>}
      {(error || modelsError) && <p className="error">{error || modelsError}</p>}
    </>
  );

  return (
    <>
      {guided ? (
        <div className="query-guided">
          {notices}
          <div className="row query-switch" role="tablist" aria-label="ways to query the graph">
            {GUIDED.map((g) => (
              <button key={g.id} role="tab" aria-selected={way === g.id} className={way === g.id ? '' : 'secondary'} onClick={() => chooseWay(g.id)} disabled={busy}>
                <span className="rt-substep-n">{g.id}</span> {g.title}
              </button>
            ))}
          </div>
          {way === '3a' && (
            <YourTurn>
              <p>
                Pick a query and press <b>Run</b>: it runs on Neptune Analytics as written, read-only. Then edit it: in <b>What is worn with white sneakers</b>, the first line is{' '}
                <code>WITH &apos;white&apos; AS color, &apos;sneaker&apos; AS kind</code>. It matches <code>color</code> and <code>kind</code> as words in each garment&apos;s name (the label the vision model
                wrote), not as an ontology class: the ontology has no sneaker class. Change the line to <code>WITH &apos;black&apos; AS color, &apos;loafer&apos; AS kind</code> and run it again, then
                compare which kinds are worn with each: the brand styles loafers differently.
              </p>
            </YourTurn>
          )}
          {way === '3b' && (
            <YourTurn>
              <p>
                Pick a question, or write your own. Two ways to send it, both end with openCypher on the graph. Press <b>Ask the agent</b>: an agent on the Amazon Neptune MCP server reads the
                graph&apos;s schema through the server, writes the openCypher, runs it and shows you the query, so you can check it or edit it. Or press <b>Run</b> to see why it takes an agent: Neptune
                cannot parse plain words, so it refuses the question, as expected, and the app hands the question to the agent with Neptune&apos;s error.
              </p>
            </YourTurn>
          )}
          {way === '3c' && (
            <>
              <p className="small">
                Every garment also has a vector: its name and details embedded by Amazon Nova, stored in the same Neptune Analytics graph. 3a followed links, which is exact. Vector search finds the
                garments closest in meaning, which is similar, not exact. It is how GraphRAG finds its way into the graph in tab 4.
              </p>
              <YourTurn>
                <ol className="po-intro-steps">
                  <li>
                    Run <b>The garments closest to one</b> (white sneakers), then change the first line to <code>WITH &apos;black&apos; AS color, &apos;blazer&apos; AS kind</code>. Cream, grey and navy
                    blazers come back too: close in meaning, the color is not a filter.
                  </li>
                  <li>
                    Run <b>Vector search, then the graph</b>: the same search, then one hop to the looks those garments are in. Vector search finds the way in, the graph does the rest.
                  </li>
                </ol>
              </YourTurn>
              <p className="muted small">
                The distance is between the two vectors: the lower, the closer. <code>neptune.algo.vectors.topK.byNode</code> is the graph&apos;s own vector index, called from openCypher.
              </p>
            </>
          )}
          <div className="query-examples">{chips((e) => (GUIDED.find((g) => g.id === way)?.groups ?? []).includes(e.group))}</div>
          {editor}
          <div className="row query-controls">
            <div className="spacer" />
            {buttons}
          </div>
          <details className="xp">
            <summary>
              Options<span className="xp-hint">the agent&apos;s model, when the agent takes over, example queries that fail on purpose</span>
            </summary>
            <div className="row query-controls">
              <ModelSelect id={`query-model-${title}`} label="Agent model" kind="answer" value={modelId} onChange={setModelId} disabled={busy} style={{ flex: '0 1 260px' }} />
              <label className="check">
                <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> hand a rejected query to the agent
              </label>
            </div>
            <p className="muted small">Broken on purpose: Neptune rejects these, and the agent reads the error and fixes the query.</p>
            <div className="query-examples">{chips((e) => e.group === 'broken' || e.group === 'write')}</div>
          </details>
        </div>
      ) : (
      <div className="card query-card">
        <h2>
          {title}{' '}
          {health && <span className={`badge ${health.write_queries ? 'warn' : 'ok'}`}>{health.write_queries ? 'read/write' : 'read-only'}</span>}
        </h2>
        <p className="muted">
          {intro ?? (
            <>
              Run openCypher against the graph on Neptune Analytics. Neptune may reject the text, for example a typo, a Neo4j-only function or a question in plain words. Then the text goes to an agent on the
              Amazon Neptune MCP server. The agent reads the graph&apos;s schema through the server and writes a read-only query. It runs the query, reads Neptune&apos;s error and fixes the query until it runs.
            </>
          )}
        </p>
        {health && neptune && !agentReady && <p className="notice text">The agent is off: {health.query_agent?.reason}</p>}
        {(error || modelsError) && <p className="error">{error || modelsError}</p>}

        <div className="query-examples">
          {groups.map((group) => (
            <div key={group} className="query-example-row">
              <span className="muted query-example-kind">{GROUP_LABEL[group]}</span>
              {examples
                .filter((e) => e.group === group)
                .map((e) => (
                  <button key={e.title} className={`secondary small query-example kind-${e.kind}`} onClick={() => setText(e.text)} disabled={busy} title={e.text}>
                    {e.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor={`query-text-${title}`}>openCypher, or a question in plain words (edit freely)</label>
          <textarea
            id={`query-text-${title}`}
            className="code"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy && run()}
            spellCheck={false}
          />
        </div>
        <div className="row query-controls">
          <ModelSelect id={`query-model-${title}`} label="Agent model" kind="answer" value={modelId} onChange={setModelId} disabled={busy} style={{ flex: '0 1 260px' }} />
          <label className="check">
            <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> hand a rejected query to the agent
          </label>
          <div className="spacer" />
          <button onClick={run} disabled={busy || !text.trim() || !neptune} title="Run the text as openCypher (Ctrl/⌘ + Enter)">
            {direct.status === 'running' ? 'Running…' : 'Run'}
          </button>
          <button className="secondary" onClick={askDirectly} disabled={busy || !text.trim() || !agentReady || !modelId} title="Skips the openCypher attempt. The agent writes the query.">
            {agent.status === 'running' ? 'Agent working…' : 'Ask the agent'}
          </button>
        </div>
      </div>
      )}

      {direct.status !== 'idle' && (
        <div className="card query-result">
          <h3>
            openCypher on Neptune Analytics{' '}
            {direct.status === 'done' && (
              <span className="muted">
                · {direct.result.count} row{direct.result.count === 1 ? '' : 's'} · {direct.result.ms} ms
              </span>
            )}
          </h3>
          {direct.status === 'running' && (
            <p className="muted">
              <span className="spinner" /> running…
            </p>
          )}
          {direct.status === 'done' && <ResultTable rows={direct.result.rows} />}
          {direct.status === 'error' && expectedRefusal && (
            <div className="notice text query-expected">
              <p>
                <b>Expected:</b> Neptune reads only openCypher, so it refused the question.{' '}
                {agent.status === 'idle' ? (
                  agentReady ? (
                    <button className="small" onClick={() => askAgent(ranText, direct.error, 'failed')} disabled={busy}>
                      Hand it to the agent
                    </button>
                  ) : null
                ) : (
                  <>The app handed it to the agent below, with Neptune&apos;s message:</>
                )}
              </p>
              <p className="muted small">
                <code className="wrap">{direct.error}</code>
              </p>
            </div>
          )}
          {direct.status === 'error' && !expectedRefusal && (
            <>
              <p className="error">{direct.error}</p>
              {handOver(direct.code) ? (
                agent.status === 'idle' ? (
                  <p className="muted">
                    Neptune rejected the text.{' '}
                    {agentReady ? (
                      <button className="small" onClick={() => askAgent(ranText, direct.error, 'failed')} disabled={busy}>
                        Hand it to the agent
                      </button>
                    ) : null}
                  </p>
                ) : (
                  <p className="muted">Neptune rejected the text. The app sent it to the agent below, together with Neptune&apos;s message.</p>
                )
              ) : null}
            </>
          )}
        </div>
      )}

      {agent.status !== 'idle' && (
        <div className="card query-agent">
          <h3>
            Agent on the Amazon Neptune MCP server{' '}
            <span className="muted">
              · {agent.status === 'done' ? agent.result.model.name : models.find((m) => m.id === modelId)?.name ?? modelId}
              {agent.status === 'done' && <> · {agentSummary(agent.result)}</>}
            </span>
          </h3>
          {agent.status === 'running' && (
            <p className="muted">
              <span className="spinner" /> {agent.why === 'failed' ? 'Neptune rejected the text. ' : ''}
              {onAgentCore ? 'On AgentCore Runtime, the agent' : 'The agent'} is reading the schema through the MCP server, writing a query and running it …{' '}
              {((now - agent.startedAt) / 1000).toFixed(0)} s
            </p>
          )}
          {agent.status === 'error' && <p className="error">{agent.error}</p>}
          {agentResult?.runtime && <p className="muted agent-runtime">Ran {runtimeLine(agentResult)}</p>}
          {agentResult && <AgentAnswer result={agentResult} onEdit={(q) => setText(q)} />}
        </div>
      )}

      <QueryArchitecture
        direct={direct.status === 'running'}
        agent={agent.status === 'running'}
        result={agentResult}
        finishedAt={finishedAt}
        graphId={graphId}
        open={panelOpen}
        onToggle={setPanelOpen}
      />
    </>
  );
}

/**
 * The agent's answer, the query that ran with its rows, and every step it took, drawn by
 * AgentTrace. Tab 3 folds the trace into "What the agent did" (the workshop's screenshots wait
 * for `details.agent-steps`); tab 6's trends methods show it open (`traceOpen`) and their answer
 * on their own (`showAnswer` false). `readable`: whether the model returns its reasoning as text.
 */
export function AgentAnswer({
  result,
  onEdit,
  showAnswer = true,
  traceOpen = false,
  readable,
}: {
  result: AgentResult;
  onEdit?: (query: string) => void;
  showAnswer?: boolean;
  traceOpen?: boolean;
  readable?: boolean;
}) {
  const rejected = failedQueries(result);
  const lake = result.mcp.server.includes('s3-tables'); // tab 6's data agent: SQL over Iceberg tables
  const engine = lake ? 'the engine' : 'Neptune';
  const reach = lake ? "the sample's table bucket only" : 'reads the graph only';
  return (
    <>
      {showAnswer && result.answer && <p className="agent-answer">{result.answer}</p>}
      {result.stopped && (
        <p className="notice text">
          The agent stopped after {result.stopped === 'tools' ? `${result.metrics.tool_calls} tool calls` : 'the time budget'}. The rows below are from the last query that ran.
        </p>
      )}
      {result.query ? (
        <>
          <div className="agent-query-head">
            <b>The query that ran</b>
            <span className="muted">
              {rejected ? `${rejected} rejected by ${engine} before this one · ` : ''}
              {result.count} row{result.count === 1 ? '' : 's'}
            </span>
            {onEdit && (
              <button className="small secondary" onClick={() => onEdit(result.query!)}>
                Edit it above
              </button>
            )}
          </div>
          <pre className="code-block agent-query">{result.query}</pre>
          <ResultTable rows={result.rows} />
        </>
      ) : (
        <p className="muted">No query ran successfully.</p>
      )}
      {traceOpen ? (
        <div className="agent-steps open">
          <div className="po-sec-label">What the agent did: {result.steps.length} steps</div>
          <AgentTrace result={result} readable={readable} />
        </div>
      ) : (
        <details className="agent-steps">
          <summary>
            What the agent did: {result.steps.length} steps · MCP server <code>{result.mcp.server}</code> {result.mcp.version} over {result.mcp.transport} ·{' '}
            {`AgentCore Runtime's execution role (${reach}) + read-only guard`}
            {result.runtime?.trace_id ? <> · trace <code>{result.runtime.trace_id}</code></> : null}
          </summary>
          <AgentTrace result={result} header={false} readable={readable} />
        </details>
      )}
    </>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="muted">No rows.</p>;
  const columns = columnsOf(rows);
  return (
    <div className="query-table">
      <table className="results">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>
                  <pre>{formatCell(r[c])}</pre>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The guided console's three ways to query the graph, and the example rows each one offers. */
type Way = '3a' | '3b' | '3c';
const GUIDED: { id: Way; title: string; groups: QueryGroup[] }[] = [
  { id: '3a', title: 'Write openCypher', groups: ['looks', 'graph'] },
  { id: '3b', title: 'Ask in plain words', groups: ['question'] },
  { id: '3c', title: 'Vector search', groups: ['vector'] },
];
