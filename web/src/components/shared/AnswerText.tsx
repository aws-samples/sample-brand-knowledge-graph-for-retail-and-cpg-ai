// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fragment, useMemo, useState, type ReactNode } from 'react';

/**
 * An answer's Markdown, just enough of it: paragraphs, "- " bullets, **bold** and [n] citations.
 * The [n] markers are buttons that select the evidence they cite.
 */
export function AnswerText({ text, active, onCite }: { text: string; active: number | null; onCite: (n: number) => void }) {
  const blocks = useMemo(() => toBlocks(text), [text]);
  const [focus, setFocus] = useState<number | null>(null);
  const spans = (line: string, bold = true): ReactNode[] =>
    line.split(bold ? /(\*\*[^*]+\*\*|\[\d+\])/ : /(\[\d+\])/).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) {
        const n = Number(cite[1]);
        return (
          <button key={i} type="button" className={`cite${active === n || focus === n ? ' active' : ''}`} onClick={() => (setFocus(n), onCite(n))} aria-label={`show evidence ${n}`}>
            [{n}]
          </button>
        );
      }
      // bold text may carry citations of its own: "**Start with the Site day look [3]:**"
      if (bold && part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{spans(part.slice(2, -2), false)}</strong>;
      return <Fragment key={i}>{part}</Fragment>;
    });
  return (
    <div className="answer">
      {blocks.map((b, i) =>
        b.kind === 'list' ? (
          <ul key={i}>
            {b.lines.map((l, j) => (
              <li key={j}>{spans(l)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{spans(b.lines.join(' '))}</p>
        ),
      )}
    </div>
  );
}

function toBlocks(text: string): { kind: 'p' | 'list'; lines: string[] }[] {
  const out: { kind: 'p' | 'list'; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      out.push({ kind: 'p', lines: [] });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'list') last.lines.push(bullet[1]);
      else out.push({ kind: 'list', lines: [bullet[1]] });
    } else if (last?.kind === 'p' && last.lines.length) last.lines.push(line);
    else out.push({ kind: 'p', lines: [line.replace(/^#+\s+/, '')] });
  }
  return out.filter((b) => b.lines.length);
}
