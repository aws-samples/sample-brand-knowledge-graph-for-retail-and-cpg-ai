// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type CodeHighlight, type OntoNode } from '../../api';
import { CodeViewer } from '../arch/CodeViewer';
import { localName } from './treeLayout';

/**
 * Step 1's "Inspect: the ontology file": the OWL document as the app reads it (the Turtle of the
 * domain folder, `GET /api/ontologies/file`), in the app's code viewer, with Turtle highlighting
 * and line numbers. The text is read once, the first time the expander opens, and kept in
 * component state. While the viewer is open, selecting a term in step 1 (the search, the map, the
 * Your turn links, a name in the details) scrolls the viewer's own box to the line that defines
 * the term and marks it; the page itself does not move.
 */
const NO_MARKS: CodeHighlight[] = [];

export function OntologyFile({
  ontologyId,
  file,
  node,
  text: given = null,
  defaultOpen = false,
}: {
  ontologyId: string;
  file: string;
  /** The term selected in step 1, or null. */
  node: OntoNode | null;
  /** The text, when the caller already has it (tests); otherwise it is read when the expander opens. */
  text?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState<string | null>(given);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // whether the file has been asked for (once per ontology; again after an error)
  const asked = useRef(given !== null);

  // read the file once, the first time the expander opens
  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    setLoading(true);
    setError('');
    api.ontologyFile(ontologyId).then(
      (r) => {
        setText(r.text);
        setLoading(false);
      },
      (e: Error) => {
        asked.current = false;
        setError(e.message);
        setLoading(false);
      },
    );
  }, [open, ontologyId]);

  const lineCount = useMemo(() => (text === null ? 0 : text.replace(/\n$/, '').split('\n').length), [text]);
  const hit = useMemo(() => (text !== null && node ? definitionLine(text, node.id) : null), [text, node]);

  const term = node ? localName(node.id) : '';
  return (
    <details className="xp xp-inspect" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        Inspect: the ontology file ({file})<span className="xp-hint">the OWL source, as the app reads it</span>
      </summary>
      {open && (
        <>
          {loading && (
            <p className="muted small">
              <span className="spinner" /> Reading {file}…
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {text !== null && (
            <>
              <p className="muted small onto-file-note">
                {node ? (hit !== null ? `Showing the definition of ${term} (line ${hit + 1}).` : `${term} has no definition line of its own in this file.`) : `${lineCount.toLocaleString()} lines. Select a term in step 1 to jump to its definition.`}
              </p>
              <div role="region" aria-label={`${file}, read-only`}>
                <CodeViewer code={text} language="turtle" highlights={NO_MARKS} focusLine={hit === null ? null : hit + 1} maxHeight={480} />
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}

/** The `@prefix p: <iri> .` (or SPARQL-style `PREFIX p: <iri>`) declarations of a Turtle text, prefix by IRI. */
function prefixesOf(lines: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const decl = /^\s*(?:@prefix|PREFIX)\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/i;
  for (const l of lines) {
    const m = decl.exec(l);
    if (!m) continue;
    const iri = m[2];
    out.set(iri, [...(out.get(iri) ?? []), m[1] ?? '']);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The 0-based line that defines the term `iri` in a Turtle `text`: the subject line of its block,
 * written with the prefix whose IRI is the term's namespace (`fo:Coat a owl:Class ;`) or as the
 * full IRI in angle brackets. The match is anchored at the line start and ends at whitespace or
 * the end of the line, so `fo:Coat` never matches `fo:CoatPart` or `fo:Coat-lining`. Null when the
 * term has no line of its own (a term from another file, or one only referred to).
 */
export function definitionLine(text: string, iri: string): number | null {
  const lines = text.split('\n');
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
  const namespace = cut >= 0 ? iri.slice(0, cut + 1) : '';
  const local = cut >= 0 ? iri.slice(cut + 1) : iri;
  const patterns = [new RegExp(`^<${escapeRe(iri)}>(?=\\s|$)`)];
  if (local) for (const p of prefixesOf(lines).get(namespace) ?? []) patterns.push(new RegExp(`^${escapeRe(p)}:${escapeRe(local)}(?=\\s|$)`));
  const i = lines.findIndex((l) => patterns.some((re) => re.test(l)));
  return i < 0 ? null : i;
}
