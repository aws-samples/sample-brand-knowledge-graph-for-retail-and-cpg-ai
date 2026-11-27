// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo, useState } from 'react';
import { extractJson, previewOf, sizeLabel } from './jsonText';

/**
 * Formatted, collapsible JSON: objects and arrays fold (native <details>, so keyboard and screen
 * readers work), short arrays of numbers or words stay on one line, long strings are shortened
 * with a toggle. `JsonPanel` adds the toolbar: expand all, collapse, copy, the raw text.
 */
const SHORT_ARRAY_CHARS = 60;
const LONG_STRING = 160;

export function JsonPanel({ raw, value, label }: { raw?: string; value?: unknown; label: string }) {
  const parsed = useMemo(() => (value !== undefined ? { value, before: '', after: '' } : extractJson(raw ?? '')), [raw, value]);
  // Remounting the tree with a new open depth is what "expand all" / "collapse" do.
  const [fold, setFold] = useState({ depth: 4, n: 0 });
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!parsed) {
    return (
      <>
        <p className="muted">
          The {label} is not valid JSON. This often happens when a reply stops at the token limit. It is shown as it came back. The API still recovers the entities it can read.
        </p>
        <pre className="code-block">{raw}</pre>
      </>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(parsed.value, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="json-panel">
      <div className="json-toolbar">
        <button type="button" className="small secondary" onClick={() => setFold((f) => ({ depth: 99, n: f.n + 1 }))}>
          Expand all
        </button>
        <button type="button" className="small secondary" onClick={() => setFold((f) => ({ depth: 1, n: f.n + 1 }))}>
          Collapse all
        </button>
        <button type="button" className="small secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
        {raw !== undefined && (
          <label className="json-raw-toggle">
            <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> raw text
          </label>
        )}
        <span className="muted">
          {raw !== undefined ? `${raw.length.toLocaleString()} characters` : label}
          {parsed.before || parsed.after ? ' · text around the JSON shown below it' : ''}
        </span>
      </div>
      {showRaw ? (
        <pre className="code-block">{raw}</pre>
      ) : (
        <div className="json-tree" key={fold.n}>
          <JsonNode value={parsed.value} depth={0} openDepth={fold.depth} last />
        </div>
      )}
      {!showRaw && (parsed.before || parsed.after) && (
        <p className="muted">
          <b>Outside the JSON:</b> {[parsed.before, parsed.after].filter(Boolean).join(' … ')}
        </p>
      )}
    </div>
  );
}

function JsonNode({ name, value, depth, openDepth, last }: { name?: string | number; value: unknown; depth: number; openDepth: number; last: boolean }) {
  const comma = last ? '' : ',';
  const key =
    typeof name === 'string' ? (
      <>
        <span className="jt-key">&quot;{name}&quot;</span>
        <span className="jt-punct">: </span>
      </>
    ) : null;

  if (value === null || typeof value !== 'object') {
    return (
      <div className="jt-line">
        {key}
        <Primitive value={value} />
        {comma}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  const entries: [string | number, unknown][] = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  if (!entries.length || (isArray && isShortArray(value))) {
    return (
      <div className="jt-line">
        {key}
        {open}
        {entries.map(([i, v], n) => (
          <span key={i}>
            {n > 0 && ', '}
            <Primitive value={v} />
          </span>
        ))}
        {close}
        {comma}
      </div>
    );
  }
  return (
    <details className="jt-node" open={depth < openDepth}>
      <summary className="jt-line">
        {key}
        {open}
        <span className="jt-fold">
          {' '}
          {previewOf(value) && <span className="jt-preview">{previewOf(value)}</span>}
          {' … '}
          {close}
          {comma}
        </span>
        <span className="jt-size">{sizeLabel(value)}</span>
      </summary>
      <div className="jt-children">
        {entries.map(([k, v], i) => (
          <JsonNode key={k} name={k} value={v} depth={depth + 1} openDepth={openDepth} last={i === entries.length - 1} />
        ))}
      </div>
      <div className="jt-line">
        {close}
        {comma}
      </div>
    </details>
  );
}

/** `[387, 280, 862, 800]` and `["collar", "sleeve"]` read better on one line. */
function isShortArray(values: unknown[]): boolean {
  return values.every((v) => v === null || typeof v !== 'object') && JSON.stringify(values).length <= SHORT_ARRAY_CHARS;
}

function Primitive({ value }: { value: unknown }) {
  const [full, setFull] = useState(false);
  if (typeof value === 'string') {
    const long = value.length > LONG_STRING;
    return (
      <>
        <span className="jt-string">
          &quot;{long && !full ? value.slice(0, LONG_STRING) + '…' : value}&quot;
        </span>
        {long && (
          <button type="button" className="jt-more" onClick={() => setFull((f) => !f)}>
            {full ? 'shorter' : `${value.length.toLocaleString()} chars`}
          </button>
        )}
      </>
    );
  }
  if (typeof value === 'number') return <span className="jt-number">{value}</span>;
  if (typeof value === 'boolean') return <span className="jt-bool">{String(value)}</span>;
  return <span className="jt-null">null</span>;
}
