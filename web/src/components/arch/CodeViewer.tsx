// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, themes, type Language, type RenderProps, type Token } from 'prism-react-renderer';
import type { CodeHighlight } from '../../api';
import { PROMPT, TURTLE } from './grammars';

/**
 * IDE-style code view: syntax colors (prism, "night owl" theme), line numbers, and a gutter of
 * colored marks for the lines worth looking at. Each mark has a note; the notes are listed as
 * a legend under the code and clicking one scrolls to (and flashes) its lines. `kinds` filters
 * the marks; the architecture panel uses it to say "show me only the caching lines".
 *
 * Two options serve the long texts of tab 1's inspectors: `wrap` wraps long lines (prose such as
 * the prompt) instead of scrolling sideways, and `focusLine` marks one line and scrolls the
 * viewer's own body to it, centred, without moving the page (the ontology file viewer follows the
 * term selected in step 1 this way).
 */
export const KIND_META: Record<CodeHighlight['kind'], { label: string; color: string }> = {
  bedrock: { label: 'Bedrock call', color: '#01a88d' },
  model: { label: 'model', color: '#5a9be0' },
  cache: { label: 'prompt caching', color: '#ff9900' },
  ontology: { label: 'ontology', color: '#0972d3' },
  image: { label: 'image', color: '#c33da5' },
  prompt: { label: 'prompt', color: '#e7c000' },
  feedback: { label: 'ontology feedback', color: '#2e8b57' },
  output: { label: 'output / errors', color: '#9aa5b1' },
};

const LANGS: Record<string, Language> = { python: 'python', typescript: 'tsx', json: 'json', markdown: 'markdown', text: 'markdown', cypher: 'sql', turtle: TURTLE, prompt: PROMPT };

type LineMark = { h: CodeHighlight; i: number; first: boolean; last: boolean };
type LineRender = Pick<RenderProps, 'getLineProps' | 'getTokenProps'>;

/**
 * One source line. Memoised on what can change for it (its tokens, its mark, the flash and the
 * focus), not on the prism prop getters and the pin handler, which are new functions on every
 * render but pure functions of the fixed theme and of `shown` (a new `shown` gives every marked
 * line a new mark). The ontology file has about 2,900 lines; without this, every term selected in
 * step 1 would re-render all of them.
 */
const Line = memo(
  function Line({ line, ln, mark, flash, focus, onPin, getLineProps, getTokenProps }: { line: Token[]; ln: number; mark: LineMark | undefined; flash: boolean; focus: boolean; onPin: (i: number) => void } & LineRender) {
    const lineProps = getLineProps({ line });
    const cls = ['ide-line', mark ? `marked kind-${mark.h.kind}` : '', mark?.first ? 'mark-first' : '', mark?.last ? 'mark-last' : '', flash ? 'flash' : '', focus ? 'focus' : ''].filter(Boolean).join(' ');
    return (
      <div {...lineProps} className={`${lineProps.className ?? ''} ${cls}`} data-line={ln} style={mark ? { ...lineProps.style, ['--mark' as string]: KIND_META[mark.h.kind].color } : lineProps.style}>
        <span className="ide-gutter" aria-hidden>
          {mark?.first ? (
            <button type="button" className="ide-pin" title={mark.h.note} onClick={() => onPin(mark.i)} tabIndex={-1}>
              {mark.i + 1}
            </button>
          ) : null}
        </span>
        <span className="ide-no">{ln}</span>
        <span className="ide-code">
          {line.map((token, k) => (
            <span key={k} {...getTokenProps({ token })} />
          ))}
        </span>
      </div>
    );
  },
  (a, b) => a.line === b.line && a.ln === b.ln && a.mark === b.mark && a.flash === b.flash && a.focus === b.focus,
);

export function CodeViewer({
  code,
  language,
  highlights,
  maxHeight = 560,
  wrap = false,
  focusLine = null,
}: {
  code: string;
  language: string;
  highlights: CodeHighlight[];
  maxHeight?: number;
  /** Wrap long lines (prose) instead of scrolling sideways. */
  wrap?: boolean;
  /** A 1-based line to mark and bring into view inside the viewer, or null. */
  focusLine?: number | null;
}) {
  const [flash, setFlash] = useState<number | null>(null); // index of the highlight being pointed at
  const [only, setOnly] = useState<CodeHighlight['kind'] | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (only ? highlights.filter((h) => h.kind === only) : highlights), [highlights, only]);
  const byLine = useMemo(() => {
    const m = new Map<number, LineMark>();
    shown.forEach((h, i) => {
      for (let ln = h.start; ln <= h.end; ln++) if (!m.has(ln)) m.set(ln, { h, i, first: ln === h.start, last: ln === h.end });
    });
    return m;
  }, [shown]);
  const kindsPresent = useMemo(() => Array.from(new Set(highlights.map((h) => h.kind))), [highlights]);
  useEffect(() => setOnly(null), [code]);

  const goTo = (i: number) => {
    const h = shown[i];
    setFlash(i);
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-line="${h.start}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => setFlash((f) => (f === i ? null : f)), 1800);
  };

  // bring the focus line to the middle of the viewer's own body; the page does not move
  useEffect(() => {
    const body = bodyRef.current;
    if (focusLine === null || !body) return;
    const line = body.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
    if (!line) return;
    const top = line.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTop = Math.max(0, top - body.clientHeight / 2 + line.offsetHeight / 2);
  }, [focusLine, code, language]);

  return (
    <div className="ide">
      <Highlight theme={themes.nightOwl} code={code.replace(/\n$/, '')} language={LANGS[language] ?? 'markdown'}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <div className={`ide-body ${className}${wrap ? ' wrap' : ''}`} style={{ ...style, maxHeight }} ref={bodyRef} tabIndex={0}>
            <pre className="ide-pre">
              {tokens.map((line, i) => {
                const ln = i + 1;
                const mark = byLine.get(ln);
                return <Line key={ln} line={line} ln={ln} mark={mark} flash={mark !== undefined && flash === mark.i} focus={focusLine === ln} onPin={goTo} getLineProps={getLineProps} getTokenProps={getTokenProps} />;
              })}
            </pre>
          </div>
        )}
      </Highlight>
      {highlights.length > 0 && (
        <div className="ide-notes">
          <div className="ide-kinds" role="group" aria-label="filter highlights">
            <button type="button" className={`chip${only ? '' : ' active'}`} onClick={() => setOnly(null)}>
              all {highlights.length}
            </button>
            {kindsPresent.map((k) => (
              <button type="button" key={k} className={`chip${only === k ? ' active' : ''}`} style={{ ['--mark' as string]: KIND_META[k].color }} onClick={() => setOnly(only === k ? null : k)}>
                <i className="dot" style={{ background: KIND_META[k].color }} /> {KIND_META[k].label}
              </button>
            ))}
          </div>
          <ol className="ide-note-list">
            {shown.map((h, i) => (
              <li key={`${h.start}-${h.kind}`} className={flash === i ? 'flash' : ''} style={{ ['--mark' as string]: KIND_META[h.kind].color }}>
                <button type="button" onClick={() => goTo(i)}>
                  <span className="ide-pin static">{i + 1}</span>
                  <span className="muted">
                    L{h.start}
                    {h.end > h.start ? `–${h.end}` : ''}
                  </span>{' '}
                  {h.note}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
