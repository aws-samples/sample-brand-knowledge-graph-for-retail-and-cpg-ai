// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fragment, useEffect, useId, useState } from 'react';
import type { AgentResult, AgentStep } from '../../api';
import { Glyph } from '../arch/flow';
import { stepLabel } from '../query/queryView';

/**
 * An agent run as a picture (tab 3's query agent, tab 6's graph agent and data agent): the facts
 * of the run, a time bar with one segment per step, and two lanes, the model's and the MCP
 * server's, one box per step in order. A box is a button: it opens the step's details under the
 * trace (the full query, what went back to the model, the model's text and reasoning); a second
 * click or Escape closes them. `open`: the step shown open at first. `readable`: whether the model
 * returns its reasoning as text (from the model catalog; unknown when absent).
 */
export function AgentTrace({ result, open = null, header = true, readable }: { result: AgentResult; open?: number | null; header?: boolean; readable?: boolean }) {
  const [shown, setShown] = useState<number | null>(open);
  useEffect(() => setShown(open), [open]);
  const detailId = useId();
  const bar = timeline(result.steps);
  const store = storeOf(result);
  const step = result.steps.find((s) => s.n === shown) ?? null;
  const toggle = (n: number) => setShown(shown === n ? null : n);
  // the sentence is for a model that keeps its reasoning to itself: a model known to return it as
  // text (readable) never gets it; one the caller knows nothing about gets it after a redacted turn
  const hidden = readable === false || (readable !== true && result.steps.some((s) => s.redacted));
  return (
    <div
      className="agent-trace-view"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && shown !== null) {
          e.stopPropagation();
          setShown(null);
        }
      }}
    >
      {header && (
        <p className="muted small at-facts">
          MCP server <code>{result.mcp.server}</code> {result.mcp.version} over {result.mcp.transport} · {result.runtime?.host === 'agentcore' ? 'on Amazon Bedrock AgentCore Runtime' : 'in the API process'}
          {result.runtime?.trace_id ? (
            <>
              {' '}
              · trace <code>{result.runtime.trace_id}</code>
            </>
          ) : null}
        </p>
      )}
      <div className="at-bar" role="img" aria-label={`time line: ${result.steps.length} steps in ${secs(bar.total)}`}>
        {bar.spans.map((s) => (
          <span
            key={s.n}
            className={`at-seg kind-${s.kind}${s.ok ? '' : ' failed'}${shown === s.n ? ' active' : ''}`}
            style={{ left: `${(s.at / bar.total) * 100}%`, width: `${Math.max((s.ms / bar.total) * 100, 0.6)}%` }}
            title={`${s.n} · ${s.label} · ${secs(s.ms)}`}
          />
        ))}
      </div>
      <div className="at-bar-scale muted small">
        <span>0 s</span>
        <span className="at-legend">
          <i className="at-key kind-model" /> model turn <i className="at-key kind-mcp" /> tool call <i className="at-key kind-guard" /> guard
        </span>
        <span>{secs(bar.total)}</span>
      </div>
      <div className="at-lanes">
        <div className="at-lane-head" style={{ gridColumn: 1, gridRow: 1 }}>
          <Icon service="bedrock" />
          <span>
            <b>
              Model · {result.model.name} on Amazon Bedrock
            </b>
          </span>
        </div>
        <div className="at-lane-head" style={{ gridColumn: 2, gridRow: 1 }}>
          <Icon service="mcp" />
          <span>
            <b>MCP server · {result.mcp.server}</b>
            <span className="at-store muted small">
              <Icon service={store.service} small /> {store.label}
            </span>
          </span>
        </div>
        {result.steps.map((s, i) => {
          const next = result.steps[i + 1];
          return (
            <Fragment key={s.n}>
              <button
                type="button"
                className={`at-box kind-${s.kind}${s.ok ? '' : ' failed'}${shown === s.n ? ' active' : ''}`}
                style={{ gridColumn: lane(s) === 'model' ? 1 : 2, gridRow: 2 + i * 2 }}
                aria-expanded={shown === s.n}
                aria-controls={shown === s.n ? detailId : undefined}
                onClick={() => toggle(s.n)}
              >
                <StepBox step={s} />
              </button>
              {next && <Arrow from={lane(s)} to={lane(next)} row={3 + i * 2} />}
            </Fragment>
          );
        })}
      </div>
      {step && <StepDetail id={detailId} step={step} at={bar.spans.find((x) => x.n === step.n)?.at ?? 0} onClose={() => setShown(null)} />}
      {hidden && <p className="muted small at-note">{result.model.name} does not return its reasoning as text.</p>}
    </div>
  );
}

/** An official AWS Architecture Icon (awsIcons.ts), sized for a lane head. */
function Icon({ service, small = false }: { service: 'bedrock' | 'mcp' | 'neptune' | 's3'; small?: boolean }) {
  return (
    <span className={`at-icon${small ? ' small' : ''}`} aria-hidden="true">
      <Glyph service={service} />
    </span>
  );
}

type Lane = 'model' | 'mcp';
const lane = (s: AgentStep): Lane => (s.kind === 'model' ? 'model' : 'mcp');
/** A normal turn asked for tools or answered; any other stop reason (max_tokens) is worth showing. */
const NORMAL_STOPS = new Set(['tool_use', 'end_turn']);
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);
export const queryOf = (s: AgentStep): string | null => (typeof s.input.query === 'string' && s.input.query ? s.input.query : null);

/** The data store behind the MCP server: Neptune Analytics, or the sample's S3 table bucket (no S3 Tables icon exists: the S3 one, labelled). */
function storeOf(r: AgentResult): { service: 'neptune' | 's3'; label: string } {
  return r.mcp.server.includes('s3-tables') ? { service: 's3', label: 'Amazon S3 Tables' } : { service: 'neptune', label: 'Amazon Neptune Analytics' };
}

export type Span = { n: number; kind: AgentStep['kind']; ok: boolean; label: string; at: number; ms: number };
/**
 * Each step's place on the time bar: its start (`at_ms`) and length. A step without `at_ms` (an
 * older API) starts where the step before it ended. `total` is the run's length, never 0.
 */
export function timeline(steps: AgentStep[]): { spans: Span[]; total: number } {
  let end = 0;
  const spans = steps.map((s) => {
    const at = s.at_ms ?? end;
    end = Math.max(end, at + s.ms);
    return { n: s.n, kind: s.kind, ok: s.ok, label: stepLabel(s), at, ms: s.ms };
  });
  return { spans, total: Math.max(end, 1) };
}

function StepBox({ step: s }: { step: AgentStep }) {
  const query = queryOf(s);
  const tokens = s.tokens;
  return (
    <>
      <span className="at-box-head">
        <span className="at-n">{s.n}</span>
        <b>{s.kind === 'model' ? s.summary : s.kind === 'guard' ? `guard · ${s.name}` : s.name}</b>
        <span className="muted">{secs(s.ms)}</span>
      </span>
      {s.kind === 'model' && tokens && (
        <span className="at-line muted">
          {tokens.input.toLocaleString('en-US')} in · {tokens.output.toLocaleString('en-US')} out{tokens.cache_read ? ` · ${tokens.cache_read.toLocaleString('en-US')} cached` : ''}
        </span>
      )}
      {s.kind === 'model' && s.stop_reason && !NORMAL_STOPS.has(s.stop_reason) && <span className="at-line at-stop">stopped: {s.stop_reason}</span>}
      {s.kind === 'model' && s.reasoning && <span className="at-line at-reasoning">{clip(s.reasoning, 160)}</span>}
      {s.kind === 'model' && !s.reasoning && s.redacted && <span className="at-line muted">reasoned, not returned as text</span>}
      {s.kind !== 'model' && query && <code className="at-line at-query">{clip(query.replace(/\s+/g, ' '), 90)}</code>}
      {s.kind === 'mcp' && <span className={`at-line ${s.ok ? 'muted' : 'agent-error'}`}>{s.ok ? s.summary : s.error}</span>}
      {s.kind === 'guard' && <span className="at-line agent-error">refused: {s.error ?? s.summary}</span>}
    </>
  );
}

/** Same lane: straight down; the other lane: across to it. */
function Arrow({ from, to, row }: { from: Lane; to: Lane; row: number }) {
  if (from === to)
    return (
      <span className="at-arrow" style={{ gridColumn: from === 'model' ? 1 : 2, gridRow: row }} aria-hidden="true">
        ↓
      </span>
    );
  return (
    <span className="at-arrow at-arrow-cross" style={{ gridColumn: '1 / 3', gridRow: row }} aria-hidden="true">
      {from === 'model' ? '↘' : '↙'}
    </span>
  );
}

function StepDetail({ id, step: s, at, onClose }: { id: string; step: AgentStep; at: number; onClose: () => void }) {
  const query = queryOf(s);
  return (
    <div className={`at-detail kind-${s.kind}`} id={id} role="region" aria-label={`step ${s.n}`}>
      <div className="row at-detail-head">
        <b>
          Step {s.n} · {stepLabel(s)}
        </b>
        <span className="muted small">
          started at {secs(at)} · took {secs(s.ms)}
          {s.stop_reason ? ` · stop reason ${s.stop_reason}` : ''}
        </span>
        <div className="spacer" />
        <button type="button" className="small secondary" onClick={onClose} aria-label="close the step's details">
          ×
        </button>
      </div>
      {query && (
        <>
          <div className="po-sec-label">{s.kind === 'guard' ? 'The query it refused' : 'The query'}</div>
          <pre className="code-block agent-step-query">{query}</pre>
        </>
      )}
      {s.error && <p className="agent-error">{s.error}</p>}
      {s.reasoning && (
        <>
          <div className="po-sec-label">The model&apos;s reasoning summary</div>
          <p className="agent-step-text at-reasoning-full">{s.reasoning}</p>
        </>
      )}
      {s.kind === 'model' && s.text && (
        <>
          <div className="po-sec-label">The model&apos;s text</div>
          <p className="agent-step-text">{s.text}</p>
        </>
      )}
      {s.to_model && (
        <>
          <div className="po-sec-label">What went back to the model</div>
          <pre className="code-block agent-step-out">{s.to_model}</pre>
        </>
      )}
    </div>
  );
}
