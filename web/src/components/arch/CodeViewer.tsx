// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, themes, type Language } from 'prism-react-renderer';
import type { CodeHighlight } from '../../api';

/**
 * IDE-style code view: syntax colors (prism, "night owl" theme), line numbers, and a gutter of
 * colored marks for the lines worth looking at. Each mark has a note; the notes are listed as
 * a legend under the code and clicking one scrolls to (and flashes) its lines. `kinds` filters
 * the marks; the architecture panel uses it to say "show me only the caching lines".
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

const LANGS: Record<string, Language> = { python: 'python', typescript: 'tsx', json: 'json', markdown: 'markdown', text: 'markdown', cypher: 'sql' };

export function CodeViewer({ code, language, highlights, maxHeight = 560 }: { code: string; language: string; highlights: CodeHighlight[]; maxHeight?: number }) {
  const [flash, setFlash] = useState<number | null>(null); // index of the highlight being pointed at
  const [only, setOnly] = useState<CodeHighlight['kind'] | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => (only ? highlights.filter((h) => h.kind === only) : highlights), [highlights, only]);
  const byLine = useMemo(() => {
    const m = new Map<number, { h: CodeHighlight; i: number; first: boolean; last: boolean }>();
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

  return (
    <div className="ide">
      <Highlight theme={themes.nightOwl} code={code.replace(/\n$/, '')} language={LANGS[language] ?? 'markdown'}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <div className={`ide-body ${className}`} style={{ ...style, maxHeight }} ref={bodyRef} tabIndex={0}>
            <pre className="ide-pre">
              {tokens.map((line, i) => {
                const ln = i + 1;
                const mark = byLine.get(ln);
                const lineProps = getLineProps({ line });
                const cls = ['ide-line', mark ? `marked kind-${mark.h.kind}` : '', mark?.first ? 'mark-first' : '', mark?.last ? 'mark-last' : '', mark && flash === mark.i ? 'flash' : ''].filter(Boolean).join(' ');
                return (
                  <div key={ln} {...lineProps} className={`${lineProps.className ?? ''} ${cls}`} data-line={ln} style={mark ? { ...lineProps.style, ['--mark' as string]: KIND_META[mark.h.kind].color } : lineProps.style}>
                    <span className="ide-gutter" aria-hidden>
                      {mark?.first ? (
                        <button type="button" className="ide-pin" title={mark.h.note} onClick={() => goTo(mark.i)} tabIndex={-1}>
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
