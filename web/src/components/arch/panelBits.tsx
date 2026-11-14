// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fragment, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';
import { api, type CodeSet, type CodeSnippet, type OntologyDetail } from '../../api';
import { CodeViewer } from './CodeViewer';
import { PromptView } from './PromptView';
import { PROMPT_ID } from './promptSnippet';

/**
 * Pieces shared by the "How it works" panels of tabs 1 to 4 (ArchitectureDiagram draws them):
 * the numbered step list, the per-node detail box, the small statistics strip, the response
 * pulse, the fit-on-resize helper for React Flow and the code browser (the snippets of a step).
 */

/** One numbered step of a panel's walk-through: what happens, and on which diagram node. */
export type Step<NodeId extends string = string> = { n: number; title: string; summary: string; node: NodeId };

/**
 * The numbered steps under the diagram, in the style of the AWS Solutions Library architecture
 * pages: the numbers match the badges on the diagram; clicking one selects its node and code.
 */
export function StepList({ steps, active, onSelect }: { steps: Step[]; active: number | null; onSelect: (n: number) => void }) {
  return (
    <ol className="step-list" aria-label="how it works, step by step">
      {steps.map((s) => (
        <li key={s.n}>
          <button className={s.n === active ? 'active' : ''} onClick={() => onSelect(s.n)} aria-current={s.n === active ? 'step' : undefined}>
            <span className="step-badge">{s.n}</span>
            <span>
              <b>{s.title}</b>
              <small>{s.summary}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function Detail({ title, links, children }: { title: string; links: ReactNode; children: ReactNode }) {
  return (
    <section className="arch-detail">
      <div className="arch-detail-head">
        <h4>{title}</h4>
        <div className="arch-links">{links}</div>
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, mono }: { label: string; value: string | number; hint?: string; mono?: boolean }) {
  return (
    <div className="stat" title={hint}>
      <div className={`stat-value${mono ? ' mono' : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** A console deep link as a small button, or nothing when the deployment has no such link. */
export function ConsoleLink({ href, label }: { href: string | undefined; label: string }) {
  if (!href) return null;
  return (
    <a className="button-link" href={href} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  );
}

/** True for ~2.5 s after the given timestamp changes (drives the "response delivered" pulse). */
export function usePulse(stamp: number | string | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!stamp) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 2500);
    return () => clearTimeout(t);
  }, [stamp]);
  return on;
}

/** Keep the whole diagram in view when the panel opens or the window is resized (`target`: the diagram's wrapper). */
export function FitOnResize({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      fitView({ padding: 0.12, duration: first ? 0 : 200 });
      first = false;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, target]);
  return null;
}

/**
 * The API's code snippets for one panel (`set`), read once the panel opens, plus snippets that
 * live in the browser (`locals`, which may change with the domain; keep them memoized).
 */
export function useSnippets(open: boolean, set: CodeSet, locals: CodeSnippet[]): CodeSnippet[] | null {
  const [remote, setRemote] = useState<CodeSnippet[] | null>(null);
  useEffect(() => {
    if (!open || remote) return;
    api
      .explorerCode(set)
      .then((r) => setRemote(r.snippets))
      .catch(() => setRemote([]));
  }, [open, remote, set]);
  return useMemo(() => (remote ? [...remote, ...locals] : null), [remote, locals]);
}

/** The server-side snippet id of `owl.classification_prompt` (see `Service.explorer_code`). */
const RENDER_SNIPPET_ID = 'prompt';
const RENDERED_ID = '__rendered_prompt__';

/**
 * The essential code of the selected step: a list of snippets on the left, the marked-up source
 * on the right. Without a step (a context node such as the browser is selected) it lists the
 * snippets attached to that node. `extra` is a ★ snippet built in the browser from the latest
 * call (the prompt actually sent). Under the snippet that renders the ontology prompt, a nested
 * item shows that prompt for the ontology currently selected (`detail`).
 */
export function CodeBrowser({ step, node, snippets, extra, detail }: { step: number | null; node: string; snippets: CodeSnippet[] | null; extra?: CodeSnippet | null; detail: OntologyDetail | null }) {
  const [all, setAll] = useState(false);
  const [active, setActive] = useState<string>('');
  const list = useMemo(() => {
    if (!snippets) return [];
    const belongs = (s: CodeSnippet) => all || (step ? s.steps.includes(step) : s.nodes.includes(node));
    const base = snippets.filter(belongs);
    return extra && belongs(extra) ? [extra, ...base] : base;
  }, [snippets, step, node, all, extra]);
  const rendered = active === RENDERED_ID && !!detail && list.some((s) => s.id === RENDER_SNIPPET_ID);
  const current = list.find((s) => s.id === active) ?? list[0];
  const starred = list.filter((s) => s.id === PROMPT_ID).length;
  useEffect(() => setActive(list[0]?.id ?? ''), [step, node, all]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!snippets) return <p className="muted">Loading code…</p>;
  return (
    <section className="arch-code">
      <div className="arch-detail-head">
        <h4>{all ? 'Essential code: every step' : step ? `Essential code of step ${step}` : 'Essential code'}</h4>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show every step
        </label>
      </div>
      {list.length === 0 ? (
        <p className="muted">This element is context and has no numbered step. Pick a number above to see its code.</p>
      ) : (
        <div className="code-layout">
          <nav className="code-nav" aria-label="code snippets">
            {list.map((s, i) => (
              <Fragment key={s.id}>
                <button className={`${!rendered && s.id === current?.id ? 'active' : ''}${s.id === PROMPT_ID ? ' prompt-tab' : ''}`} onClick={() => setActive(s.id)}>
                  <span className="muted">{s.id === PROMPT_ID ? '★' : all ? `step ${s.steps.join('+') || '–'}` : i + 1 - starred} · </span>
                  {s.title}
                </button>
                {s.id === RENDER_SNIPPET_ID && detail && (
                  <button className={`sub${rendered ? ' active' : ''}`} onClick={() => setActive(RENDERED_ID)} title="the output of this function for the ontology selected above">
                    <span className="muted">↳ </span>
                    rendered prompt: {detail.name}
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
          {rendered && detail ? (
            <div className="code-body">
              <div className="muted code-meta">
                <code>owl.classification_prompt(view)</code> · {detail.name} · {detail.prompt.length.toLocaleString()} chars ≈ {detail.prompt_tokens_estimate.toLocaleString()} tokens
                <button className="small secondary" style={{ float: 'right' }} onClick={() => navigator.clipboard?.writeText(detail.prompt)} aria-label="copy the rendered prompt">
                  copy
                </button>
              </div>
              <PromptView key={detail.id} system={detail.prompt} tokens={detail.prompt_tokens_estimate} />
            </div>
          ) : (
            current && (
              <div className="code-body">
                <div className="muted code-meta">
                  <code>{current.file}</code> · {current.language}
                  {current.highlights.length > 0 && <> · {current.highlights.length} {current.highlights.length === 1 ? 'thing' : 'things'} to look at (numbered in the gutter)</>}
                  <button className="small secondary" style={{ float: 'right' }} onClick={() => navigator.clipboard?.writeText(current.code)} aria-label="copy snippet">
                    copy
                  </button>
                </div>
                <CodeViewer key={current.id} code={current.code} language={current.language} highlights={current.highlights} />
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}
